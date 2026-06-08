import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { Command } from "commander"
import { getAnthropic } from "./anthropic.js"
import { config, type Env, type Orientation, loadEnv } from "./config.js"
import {
  estimateCreditUsd,
  guardLevel,
  plannedVideoCount,
} from "./cost/estimate.js"
import { loadBackgrounds } from "./heygen/backgrounds.js"
import { HeyGenClient } from "./heygen/client.js"
import { makeFileDownloader } from "./heygen/download.js"
import { ffmpegCoverResize } from "./heygen/resize.js"
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

function orientationDims(o: Orientation): { width: number; height: number } {
  if (o === "landscape") return { width: 1920, height: 1080 }
  if (o === "square") return { width: 1080, height: 1080 }
  return { width: 1080, height: 1920 }
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
    const backgrounds = await loadBackgrounds({
      dir: config.paths.backgrounds,
      client,
      cachePath: join(config.paths.cache, "backgrounds.json"),
      target: orientationDims(config.defaults.orientation),
      resize: (bytes, w, h) =>
        ffmpegCoverResize(bytes, w, h, config.defaults.backgroundBlur),
      processTag: `:b${config.defaults.backgroundBlur ?? 0}`,
    })
    if (backgrounds.length > 0) {
      config.pools.v2.backgrounds = backgrounds
      console.log(
        `Using ${backgrounds.length} background image(s) from ${config.paths.backgrounds}/`
      )
    }
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
      }
    )
  } finally {
    store.close()
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
    console.log(`  HeyGen key:       ${env.HEYGEN_API_KEY ? "set" : "(missing)"}`)
    console.log(`  HeyGen base URL:  ${env.HEYGEN_BASE_URL}`)
    console.log(`  Max concurrency:  ${env.MAX_CONCURRENCY}`)
    console.log(`  Script model:     ${config.models.script}`)
    const av = config.pools.v2.avatars
    const vo = config.pools.v2.voices
    console.log(`  V2 avatars:       ${av.female.length} female / ${av.male.length} male`)
    console.log(`  V2 voices:        ${vo.female.length} female / ${vo.male.length} male`)
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
      "\nAssign the ids you want to src/config.ts → pools.v2 (by gender: male/female)."
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
    const store = new JobStore(":memory:")
    const result = await runPipeline(
      {
        rows,
        runId: "dry",
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
    store.close()
    for (const e of result.entries) {
      console.log(`\n— ${e.title ?? e.product_id} [${e.engine}] —`)
      console.log(e.script)
    }
    const videos = plannedVideoCount(rows)
    const est = estimateCreditUsd(videos, ASSUMED_SECONDS, config.heygen.pricePerMinuteUsd.v2)
    console.log(`\nPlanned: ${videos} videos. Est. HeyGen cost ≈ $${est.toFixed(2)} (~${ASSUMED_SECONDS}s each).`)
    if (result.buildFailures.length) {
      console.log(`${result.buildFailures.length} rows can't build a job — populate the pool in src/config.ts or add per-row avatar/voice.`)
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
    const runId = timestamp()
    const runDir = join(config.paths.outputs, `${runId}__SAMPLE`)
    const result = await executeRun(sampleRows, runId, runDir, env)
    const { indexPath } = await writeRun(runDir, toManifest(runId, "sample", result))
    printSummary(result)
    console.log(`\nReview the sample: open ${indexPath}`)
    console.log(`Approve for production:  tsx src/cli.ts approve ${runId}`)
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
          "Run `sample`, review the videos, then `approve <runId>` before production."
      )
      process.exitCode = 1
      return
    }
    const { rows, errors, skipped } = await loadRows(opts.source)
    reportIngest(rows.length, errors, skipped)
    const videos = plannedVideoCount(rows)
    const est = estimateCreditUsd(videos, ASSUMED_SECONDS, config.heygen.pricePerMinuteUsd.v2)
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
    const runDir = join(config.paths.outputs, runId)
    const result = await executeRun(rows, runId, runDir, env)
    await writeRun(runDir, toManifest(runId, "resume", result))
    printSummary(result)
  })

program.parseAsync()
