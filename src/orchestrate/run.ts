import type Anthropic from "@anthropic-ai/sdk"
import type { AppConfig } from "../config.js"
import type { HeyGenClient } from "../heygen/client.js"
import { runJobs } from "../heygen/engine.js"
import { buildJobSpec, type JobSpec } from "../jobs/build-job.js"
import type { ManifestEntry } from "../ledger/manifest.js"
import { type CachedScript, scriptCacheKey } from "../script/cache.js"
import { generateScript } from "../script/generate.js"
import { PROMPT_VERSION } from "../script/prompt.js"
import type { PromoScript } from "../script/schema.js"
import type { ProductRow } from "../schema/row.js"
import type { JobStore } from "../store/job-store.js"

export interface ScriptCacheLike {
  get(key: string): Promise<CachedScript | null>
  put(key: string, value: CachedScript): Promise<void>
}

export interface PipelineDeps {
  anthropic: Anthropic
  client: HeyGenClient
  store: JobStore
  cache: ScriptCacheLike
  download: (url: string, basename: string) => Promise<string>
  sleep: (ms: number) => Promise<void>
}

export interface PipelineOptions {
  rows: ProductRow[]
  runId: string
  config: AppConfig
  model: string
  concurrency: number
  maxRetries?: number
  /** When true: generate scripts + job specs + cost preview, but do not call HeyGen. */
  dryRun?: boolean
}

export interface PipelineResult {
  entries: ManifestEntry[]
  buildFailures: Array<{ productId: string; variationIndex: number; reason: string }>
  totals: {
    completed: number
    failed: number
    skipped: number
    est_cost_usd: number
  }
  creditExhausted: boolean
}

/**
 * End-to-end run: per row × variation, reuse-or-generate a script (cached),
 * resolve a job spec, then (unless dryRun) drive the generation engine.
 */
export async function runPipeline(
  opts: PipelineOptions,
  deps: PipelineDeps
): Promise<PipelineResult> {
  const { rows, config, model } = opts
  const specs: JobSpec[] = []
  const scriptByJob = new Map<string, PromoScript>()
  const specByJob = new Map<string, JobSpec>()
  const buildFailures: PipelineResult["buildFailures"] = []
  const seenJobIds = new Set<string>()

  for (const row of rows) {
    // A provided script is used verbatim — no Claude, no auto-variations.
    const variations = row.script ? 1 : row.num_variations
    for (let v = 0; v < variations; v++) {
      let script: PromoScript
      if (row.script) {
        script = { hook: "", script: row.script, title: row.product_name }
      } else {
        const key = scriptCacheKey({
          model,
          promptVersion: PROMPT_VERSION,
          row,
          variationIndex: v,
        })
        const cached = await deps.cache.get(key)
        if (cached) {
          script = { hook: cached.hook, script: cached.script, title: cached.title }
        } else {
          const gen = await generateScript({
            row,
            variationIndex: v,
            anthropic: deps.anthropic,
            model,
            maxWords: config.scriptWordBudget.max,
          })
          script = gen.script
          await deps.cache.put(key, {
            hook: script.hook,
            script: script.script,
            title: script.title,
            model: gen.model,
            promptVersion: gen.promptVersion,
          })
        }
      }

      const built = buildJobSpec({ row, script, variationIndex: v, config })
      if (!built.ok) {
        buildFailures.push({
          productId: built.productId,
          variationIndex: built.variationIndex,
          reason: built.reason,
        })
        continue
      }
      // Guard against two rows resolving to the same job (e.g. duplicate
      // product_name with no row_id) — otherwise they'd silently collapse to one.
      if (seenJobIds.has(built.spec.jobId)) {
        buildFailures.push({
          productId: built.spec.productId,
          variationIndex: built.spec.variationIndex,
          reason:
            "duplicate id — another row resolves to the same job; give each row a unique row_id (or product_name)",
        })
        continue
      }
      seenJobIds.add(built.spec.jobId)
      specs.push(built.spec)
      scriptByJob.set(built.spec.jobId, script)
      specByJob.set(built.spec.jobId, built.spec)
    }
  }

  if (opts.dryRun) {
    const entries: ManifestEntry[] = specs.map((s) => ({
      product_id: s.productId,
      variation_index: s.variationIndex,
      engine: s.engine,
      avatar_id: s.avatarId ?? null,
      voice_id: s.voiceId ?? null,
      status: "planned",
      hook: scriptByJob.get(s.jobId)?.hook,
      script: scriptByJob.get(s.jobId)?.script,
      title: s.title,
    }))
    return {
      entries,
      buildFailures,
      totals: { completed: 0, failed: 0, skipped: 0, est_cost_usd: 0 },
      creditExhausted: false,
    }
  }

  const summary = await runJobs(specs, opts.runId, {
    client: deps.client,
    store: deps.store,
    download: deps.download,
    sleep: deps.sleep,
    pricePerMinuteUsd: config.heygen.pricePerMinuteUsd,
    concurrency: opts.concurrency,
    maxRetries: opts.maxRetries,
  })

  const entries: ManifestEntry[] = summary.records.map((rec) => {
    const script = scriptByJob.get(rec.job_id)
    const spec = specByJob.get(rec.job_id)
    return {
      product_id: rec.product_id,
      variation_index: rec.variation_index,
      engine: rec.engine,
      avatar_id: spec?.avatarId ?? null,
      voice_id: spec?.voiceId ?? null,
      status: rec.status,
      hook: script?.hook,
      script: script?.script,
      title: rec.title,
      video_url: rec.video_url,
      local_path: rec.local_path,
      duration_sec: rec.duration_sec,
      est_cost_usd: rec.est_cost_usd,
      failure: rec.failure,
    }
  })

  const est_cost_usd = summary.records.reduce(
    (sum, r) => sum + (r.est_cost_usd ?? 0),
    0
  )
  return {
    entries,
    buildFailures,
    totals: {
      completed: summary.completed,
      failed: summary.failed,
      skipped: summary.skipped,
      est_cost_usd,
    },
    creditExhausted: summary.creditExhausted,
  }
}
