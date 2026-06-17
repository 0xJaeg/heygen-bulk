import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { createInterface } from "node:readline/promises"
import { Command } from "commander"
import { getAnthropic } from "./anthropic.js"
import { config, type Env, loadEnv } from "./config.js"
import {
  estimateCreditUsd,
  guardLevel,
  plannedVideoCount,
} from "./cost/estimate.js"
import { HeyGenClient } from "./heygen/client.js"
import { makeFileDownloader } from "./heygen/download.js"
import { type RowError, loadRows } from "./ingest/load.js"
import { type RunManifest, writeRun } from "./ledger/manifest.js"
import { recordApproval } from "./orchestrate/gate.js"
import { type PipelineResult, runPipeline } from "./orchestrate/run.js"
import { FileScriptCache } from "./script/cache.js"
import type { ProductRow } from "./schema/row.js"
import { JobStore } from "./store/job-store.js"

const ASSUMED_SECONDS = 50 // for pre-run cost estimates

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "")
}

/** Ask a yes/no question on the terminal; returns true only for y / yes. */
async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question(question)).trim().toLowerCase()
  rl.close()
  return answer === "y" || answer === "yes"
}

function requireHeygen(env: Env): void {
  if (!env.HEYGEN_API_KEY) {
    throw new Error("Missing HEYGEN_API_KEY in env (.env or .env.local)")
  }
}

function reportIngest(valid: number, errors: RowError[], skipped: number): void {
  console.log(`Ingested ${valid} valid rows (${skipped} skipped, ${errors.length} invalid).`)
  for (const e of errors) {
    console.log(`  row ${e.index}: ${e.issues.join("; ")}`)
  }
}

/** Human label for the default render engine (per-row overrides aside). */
function engineLabel(): string {
  return config.defaults.engine === "v3"
    ? "Video Agent · talking head"
    : `${config.defaults.avatarEngine} · ${config.defaults.resolution}`
}

/**
 * True (and prints an error) when rows need a *generated* script (no `script`
 * cell) but no ANTHROPIC_API_KEY is set. Provided-script rows need no key.
 */
function blockedOnMissingAnthropic(rows: ProductRow[], env: Env): boolean {
  const needGen = rows.filter((r) => !r.script).length
  if (needGen === 0 || env.ANTHROPIC_API_KEY) return false
  console.error(
    `${needGen} row(s) have no \`script\` and need Claude to write one, but ANTHROPIC_API_KEY isn't set.\n` +
      "Add a `script` to every row (no Anthropic key needed), or set ANTHROPIC_API_KEY in .env."
  )
  process.exitCode = 1
  return true
}

function printSummary(result: PipelineResult): void {
  const { totals, buildFailures, creditExhausted } = result
  console.log(
    `\nDone: ${totals.completed} completed · ${totals.failed} failed · ${totals.skipped} skipped · $${totals.est_cost_usd.toFixed(2)} est. cost`
  )
  if (buildFailures.length) {
    console.log(`${buildFailures.length} rows could not build a job spec:`)
    for (const f of buildFailures) console.log(`  ${f.productId}#${f.variationIndex}: ${f.reason}`)
  }
  if (creditExhausted) {
    console.log("⚠️  HeyGen credits were exhausted — top up and re-run to resume.")
  }
}

function toManifest(
  runId: string,
  mode: string,
  result: PipelineResult
): RunManifest {
  return {
    run_id: runId,
    mode,
    created_at: new Date().toISOString(),
    totals: result.totals,
    entries: result.entries,
  }
}

async function hasApproval(approvalsPath: string): Promise<boolean> {
  try {
    const data = JSON.parse(await readFile(approvalsPath, "utf8")) as {
      approved?: string[]
    }
    return Array.isArray(data.approved) && data.approved.length > 0
  } catch {
    return false
  }
}

async function executeRun(
  rows: ProductRow[],
  runId: string,
  runDir: string,
  env: Env
): Promise<PipelineResult> {
  const store = new JobStore(config.paths.ledger)
  const client = new HeyGenClient({
    apiKey: env.HEYGEN_API_KEY,
    baseUrl: env.HEYGEN_BASE_URL,
  })
  try {
    return await runPipeline(
      {
        rows,
        runId,
        config,
        model: config.models.script,
        concurrency: env.MAX_CONCURRENCY,
      },
      {
        anthropic: getAnthropic(),
        client,
        store,
        cache: new FileScriptCache(join(config.paths.cache, "scripts")),
        download: makeFileDownloader(runDir),
        sleep,
        onEvent: (rec, settled, total) => {
          const ok = rec.status === "completed"
          const tail = ok
            ? rec.duration_sec
              ? ` (${rec.duration_sec}s)`
              : ""
            : " — failed"
          console.log(`  ${ok ? "✓" : "✗"} [${settled}/${total}] ${rec.title ?? rec.product_id}${tail}`)
        },
      }
    )
  } finally {
    store.close()
  }
}

/** Dry-run pass: scripts + presenter assignment for a preview, no HeyGen spend. */
async function planRun(rows: ProductRow[], env: Env): Promise<PipelineResult> {
  const store = new JobStore(":memory:")
  try {
    return await runPipeline(
      {
        rows,
        runId: "plan",
        config,
        model: config.models.script,
        concurrency: env.MAX_CONCURRENCY,
        dryRun: true,
      },
      {
        anthropic: getAnthropic(),
        client: new HeyGenClient({ apiKey: "", baseUrl: env.HEYGEN_BASE_URL }),
        store,
        cache: new FileScriptCache(join(config.paths.cache, "scripts")),
        download: async () => "",
        sleep,
      }
    )
  } finally {
    store.close()
  }
}

/** Show what a run will produce: each video's title, presenter, and script preview. */
function printPlan(result: PipelineResult): void {
  const { entries, buildFailures } = result
  const labels = new Map<string, string>()
  const presenter = (id: string | null | undefined): string => {
    if (!id) return "?"
    if (!labels.has(id)) labels.set(id, String.fromCharCode(65 + labels.size))
    return labels.get(id)! // A, B, C… — distinct letter per distinct presenter
  }
  const CAP = 12
  console.log("\nHere's what will be generated:")
  entries.slice(0, CAP).forEach((e, i) => {
    console.log(`  ${i + 1}. ${e.title ?? e.product_id}  ·  presenter ${presenter(e.avatar_id)}`)
    const text = (e.script ?? "").replace(/\s+/g, " ").trim()
    if (text) console.log(`     "${text.length > 72 ? `${text.slice(0, 72)}…` : text}"`)
  })
  if (entries.length > CAP) console.log(`  …and ${entries.length - CAP} more`)
  const distinct = new Set(entries.map((e) => e.avatar_id ?? "")).size
  console.log(
    `\n${entries.length} video${entries.length === 1 ? "" : "s"} · ${distinct} distinct presenter${distinct === 1 ? "" : "s"}.`
  )
  if (buildFailures.length) {
    console.log(`(${buildFailures.length} row(s) won't generate — run \`npm run preview\` to see why.)`)
  }
}

const program = new Command()
program
  .name("promo-video")
  .description("Generate <60s avatar promo videos from a product list via HeyGen")
  .version("0.1.0")

program
  .command("status")
  .description("Validate environment and show effective config")
  .action(() => {
    const env = loadEnv()
    console.log("✓ Environment OK")
    console.log(
      `  Anthropic key:    ${env.ANTHROPIC_API_KEY ? "set" : "(optional — only needed for rows with no script)"}`
    )
    console.log(`  HeyGen key:       ${env.HEYGEN_API_KEY ? "set" : "(missing)"}`)
    console.log(`  HeyGen base URL:  ${env.HEYGEN_BASE_URL}`)
    console.log(`  Max concurrency:  ${env.MAX_CONCURRENCY}`)
    console.log(`  Script model:     ${config.models.script}`)
    console.log(`  Engine:           ${config.defaults.engine} (${engineLabel()})`)
    const iv = config.pools.iv.avatars
    const vo = config.pools.iv.voices
    console.log(`  Pool avatars:     ${iv.female.length} female / ${iv.male.length} male`)
    console.log(`  Pool voices:      ${vo.female.length} female / ${vo.male.length} male`)
  })

program
  .command("list-pool")
  .description("List available HeyGen avatars and voices (Phase 0 discovery)")
  .action(async () => {
    const env = loadEnv()
    requireHeygen(env)
    const client = new HeyGenClient({
      apiKey: env.HEYGEN_API_KEY,
      baseUrl: env.HEYGEN_BASE_URL,
    })
    const [avatars, voices] = await Promise.all([
      client.listAvatars(),
      client.listVoices(),
    ])
    console.log(`Avatars (${avatars.length}):`)
    for (const a of avatars.slice(0, 50)) {
      console.log(`  ${a.avatar_id}${a.avatar_name ? `  (${a.avatar_name})` : ""}`)
    }
    console.log(`\nVoices (${voices.length}):`)
    for (const v of voices.slice(0, 50)) {
      const meta = [v.gender, v.language].filter(Boolean).join(", ")
      console.log(`  ${v.voice_id}  ${v.name ?? ""}${meta ? ` [${meta}]` : ""}`)
    }
    console.log(
      "\nFor Avatar IV/V, discover photo-avatar looks via GET /v3/avatars/looks and" +
        "\nassign them to src/config.ts → pools.iv (by gender, avatar paired with voice)."
    )
  })

program
  .command("list-templates")
  .description("List HeyGen templates (to match a designed look built in the app)")
  .action(async () => {
    const env = loadEnv()
    requireHeygen(env)
    const client = new HeyGenClient({
      apiKey: env.HEYGEN_API_KEY,
      baseUrl: env.HEYGEN_BASE_URL,
    })
    const templates = await client.listTemplates()
    console.log(`Templates (${templates.length}):`)
    for (const t of templates) console.log(`  ${t.template_id}  ${t.name ?? ""}`)
  })

program
  .command("dry-run")
  .description("Validate rows + generate scripts + estimate cost (no video spend)")
  .requiredOption("--source <pathOrUrl>", "CSV path or published Google-Sheet CSV URL")
  .action(async (opts: { source: string }) => {
    const env = loadEnv()
    const { rows, errors, skipped } = await loadRows(opts.source)
    reportIngest(rows.length, errors, skipped)
    if (blockedOnMissingAnthropic(rows, env)) return
    const result = await planRun(rows, env)
    for (const e of result.entries) {
      console.log(`\n— ${e.title ?? e.product_id} [${e.engine}] —`)
      console.log(e.script)
    }
    const videos = plannedVideoCount(rows)
    const est = estimateCreditUsd(videos, ASSUMED_SECONDS, config.heygen.pricePerMinuteUsd[config.defaults.engine])
    console.log(`\nPlanned: ${videos} videos. Est. HeyGen cost ≈ $${est.toFixed(2)} (~${ASSUMED_SECONDS}s each).`)
    if (result.buildFailures.length) {
      console.log(`\n${result.buildFailures.length} row(s) won't generate:`)
      for (const f of result.buildFailures) {
        console.log(`  • ${f.productId} (variation ${f.variationIndex}): ${f.reason}`)
      }
    }
  })

program
  .command("sample")
  .description("Generate a small QA batch (default from config.sampleSize) for review")
  .requiredOption("--source <pathOrUrl>", "CSV path or published Google-Sheet CSV URL")
  .option("--limit <n>", "number of sample videos")
  .action(async (opts: { source: string; limit?: string }) => {
    const env = loadEnv()
    requireHeygen(env)
    const limit = opts.limit ? parseInt(opts.limit, 10) : config.sampleSize
    const { rows, errors, skipped } = await loadRows(opts.source)
    reportIngest(rows.length, errors, skipped)
    const sampleRows = rows.slice(0, limit)
    if (blockedOnMissingAnthropic(sampleRows, env)) return
    const runId = timestamp()
    const runDir = join(config.paths.outputs, `${runId}__SAMPLE`)
    const result = await executeRun(sampleRows, runId, runDir, env)
    const { indexPath } = await writeRun(runDir, toManifest(runId, "sample", result))
    printSummary(result)
    console.log(`\nReview the sample: open ${indexPath}`)
    console.log(`If it looks good, approve it then make all the videos:`)
    console.log(`  npm run approve -- ${runId}`)
    console.log(`  npm run make`)
  })

program
  .command("start")
  .description("One-command run: show the plan + cost, confirm once, then generate all")
  .option("--source <pathOrUrl>", "CSV path or published Google-Sheet CSV URL", "data/products.csv")
  .option("--yes", "skip the confirmation prompt (for automation)")
  .action(async (opts: { source: string; yes?: boolean }) => {
    const env = loadEnv()
    requireHeygen(env)
    const { rows, errors, skipped } = await loadRows(opts.source)
    reportIngest(rows.length, errors, skipped)
    if (rows.length === 0) {
      console.error("No products to generate — check your CSV.")
      process.exitCode = 1
      return
    }
    if (blockedOnMissingAnthropic(rows, env)) return

    // Preview what will be made (scripts + presenter variety) before any spend.
    const plan = await planRun(rows, env)
    if (plan.entries.length === 0) {
      console.error("Nothing can be generated — run `npm run preview` to see why.")
      process.exitCode = 1
      return
    }
    printPlan(plan)

    const videos = plan.entries.length
    const est = estimateCreditUsd(
      videos,
      ASSUMED_SECONDS,
      config.heygen.pricePerMinuteUsd[config.defaults.engine]
    )
    const n = `${videos} video${videos === 1 ? "" : "s"}`
    console.log(
      `\nReady to generate ${n} (${engineLabel()}) — est. cost ≈ $${est.toFixed(2)}.`
    )
    console.log("Rendering runs on HeyGen and can take a few minutes per video — that's normal.")
    if (!opts.yes && !(await confirm(`\nGenerate ${n} for ~$${est.toFixed(2)}? (y/n) `))) {
      console.log("Cancelled — nothing was generated.")
      return
    }
    console.log(`\nGenerating ${n}… progress shows below as each finishes (safe to leave running):\n`)
    const runId = timestamp()
    const runDir = join(config.paths.outputs, runId)
    const result = await executeRun(rows, runId, runDir, env)
    const { indexPath } = await writeRun(runDir, toManifest(runId, "production", result))
    printSummary(result)
    console.log(
      `\n✅ ${result.totals.completed} video${result.totals.completed === 1 ? "" : "s"} ready in ${runDir}`
    )
    console.log(`   Review (click each to play):  open ${indexPath}`)
    if (result.totals.failed > 0) {
      console.log(
        `   ⚠ ${result.totals.failed} didn't render — run \`npm start\` again to retry; finished videos are skipped (not re-charged).`
      )
    }
  })

program
  .command("production")
  .description("Generate all eligible videos (requires an approved sample)")
  .requiredOption("--source <pathOrUrl>", "CSV path or published Google-Sheet CSV URL")
  .option("--yes", "bypass the cost-guard / approval confirmation")
  .action(async (opts: { source: string; yes?: boolean }) => {
    const env = loadEnv()
    requireHeygen(env)
    const approvalsPath = join(config.paths.outputs, "approvals.json")
    if (!(await hasApproval(approvalsPath)) && !opts.yes) {
      console.error(
        "Production is blocked: no approved sample run found.\n" +
          "Run `npm run sample`, review the videos, then `npm run approve -- <runId>` before `npm run make`."
      )
      process.exitCode = 1
      return
    }
    const { rows, errors, skipped } = await loadRows(opts.source)
    reportIngest(rows.length, errors, skipped)
    if (blockedOnMissingAnthropic(rows, env)) return
    const videos = plannedVideoCount(rows)
    const est = estimateCreditUsd(videos, ASSUMED_SECONDS, config.heygen.pricePerMinuteUsd[config.defaults.engine])
    console.log(`Planned: ${videos} videos. Est. HeyGen cost ≈ $${est.toFixed(2)}.`)
    if (guardLevel(videos, config.costGuard) === "confirm" && !opts.yes) {
      console.error(
        `This run exceeds the confirmation threshold (${config.costGuard.requireConfirmAboveVideos} videos). Re-run with --yes to proceed.`
      )
      process.exitCode = 1
      return
    }
    const runId = timestamp()
    const runDir = join(config.paths.outputs, runId)
    const result = await executeRun(rows, runId, runDir, env)
    const { indexPath } = await writeRun(runDir, toManifest(runId, "production", result))
    printSummary(result)
    console.log(`\nManifest + review: ${indexPath}`)
  })

program
  .command("approve")
  .description("Approve a sample run so production can proceed")
  .argument("<runId>", "the sample run id to approve")
  .action(async (runId: string) => {
    await recordApproval(runId, join(config.paths.outputs, "approvals.json"))
    console.log(`Approved ${runId}. You can now run production.`)
  })

program
  .command("resume")
  .description("Resume an interrupted run (skips completed jobs, re-polls in-flight)")
  .argument("<runId>", "the run id to resume")
  .requiredOption("--source <pathOrUrl>", "CSV path or published Google-Sheet CSV URL")
  .action(async (runId: string, opts: { source: string }) => {
    const env = loadEnv()
    requireHeygen(env)
    const { rows, errors, skipped } = await loadRows(opts.source)
    reportIngest(rows.length, errors, skipped)
    if (blockedOnMissingAnthropic(rows, env)) return
    const runDir = join(config.paths.outputs, runId)
    const result = await executeRun(rows, runId, runDir, env)
    await writeRun(runDir, toManifest(runId, "resume", result))
    printSummary(result)
  })

program.parseAsync()
