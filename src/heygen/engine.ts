import pLimit from "p-limit"
import type { JobSpec } from "../jobs/build-job.js"
import type { JobRecord, JobStore } from "../store/job-store.js"
import { backoffMs } from "./backoff.js"
import type { HeyGenClient } from "./client.js"
import { HeyGenApiError } from "./errors.js"
import type { VideoStatus } from "./types.js"

export interface EngineDeps {
  client: HeyGenClient
  store: JobStore
  download: (url: string, basename: string) => Promise<string>
  sleep: (ms: number) => Promise<void>
  pricePerMinuteUsd: { v3: number; iv: number }
  poll?: {
    base?: number
    factor?: number
    max?: number
    maxAttempts?: number
    sessionMaxAttempts?: number
  }
}

/** HeyGen credits are billed per second of video; estimate USD by engine rate. */
export function estimateCost(
  engine: string,
  durationSec: number | null,
  price: { v3: number; iv: number }
): number {
  if (durationSec == null) return 0
  const perMinute = engine === "v3" ? price.v3 : price.iv
  return (durationSec / 60) * perMinute
}

async function submit(spec: JobSpec, deps: EngineDeps): Promise<string> {
  if (spec.engine === "iv") {
    const videoId = await deps.client.createIvVideo({
      avatarId: spec.avatarId!,
      voiceId: spec.voiceId!,
      script: spec.script,
      aspectRatio: spec.aspectRatio!,
      resolution: spec.resolution!,
      avatarEngine: spec.avatarEngine!,
    })
    deps.store.patch(spec.jobId, { status: "submitted", heygen_video_id: videoId })
    return videoId
  }

  const sessionId = await deps.client.createV3({
    prompt: spec.script,
    avatarId: spec.avatarId,
    voiceId: spec.voiceId,
    orientation: spec.orientation === "landscape" ? "landscape" : "portrait",
    callbackId: spec.jobId,
  })
  deps.store.patch(spec.jobId, { status: "submitted", session_id: sessionId })
  const videoId = await resolveV3VideoId(sessionId, deps)
  deps.store.patch(spec.jobId, { heygen_video_id: videoId })
  return videoId
}

async function resolveV3VideoId(
  sessionId: string,
  deps: EngineDeps
): Promise<string> {
  const maxAttempts = deps.poll?.sessionMaxAttempts ?? 20
  for (let i = 0; i < maxAttempts; i++) {
    const videoId = await deps.client.getSessionVideoId(sessionId)
    if (videoId) return videoId
    await deps.sleep(backoffMs(i, { base: 5000, factor: 1.5, max: 15000 }))
  }
  throw new HeyGenApiError("v3 session produced no video_id", {
    kind: "transient",
  })
}

async function pollToTerminal(
  spec: JobSpec,
  videoId: string,
  deps: EngineDeps
): Promise<VideoStatus> {
  const maxAttempts = deps.poll?.maxAttempts ?? 60
  const base = deps.poll?.base ?? 20000
  const factor = deps.poll?.factor ?? 1.5
  const max = deps.poll?.max ?? 30000

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Both iv (/v3/videos) and v3 video-agents poll the same /v3/videos/{id} endpoint.
    const status = await deps.client.getStatusV3(videoId)
    if (status.state === "completed" || status.state === "failed") return status
    deps.store.patch(spec.jobId, { status: "processing" })
    await deps.sleep(backoffMs(attempt, { base, factor, max }))
  }
  return {
    state: "failed",
    videoUrl: null,
    durationSec: null,
    failure: "render timed out",
  }
}

/**
 * Run one job end-to-end: create (or resume an existing HeyGen video id) ->
 * poll to terminal -> download on success. Idempotent and resumable; never
 * re-creates a job that already has a HeyGen video id (avoids double charges).
 */
export async function processJob(
  spec: JobSpec,
  runId: string,
  deps: EngineDeps
): Promise<JobRecord> {
  deps.store.create({
    jobId: spec.jobId,
    runId,
    productId: spec.productId,
    variationIndex: spec.variationIndex,
    engine: spec.engine,
    title: spec.title,
  })
  const existing = deps.store.get(spec.jobId)
  if (existing && existing.status === "completed") return existing

  const videoId = existing?.heygen_video_id ?? (await submit(spec, deps))

  const status = await pollToTerminal(spec, videoId, deps)
  if (status.state !== "completed" || !status.videoUrl) {
    deps.store.patch(spec.jobId, {
      status: "failed",
      failure: status.failure ?? "no video url",
    })
    return deps.store.get(spec.jobId)!
  }

  const basename = `${spec.productId}_${spec.variationIndex}.mp4`
  const localPath = await deps.download(status.videoUrl, basename)
  deps.store.patch(spec.jobId, {
    status: "completed",
    video_url: status.videoUrl,
    local_path: localPath,
    duration_sec: status.durationSec,
    est_cost_usd: estimateCost(spec.engine, status.durationSec, deps.pricePerMinuteUsd),
  })
  return deps.store.get(spec.jobId)!
}

export interface RunSummary {
  completed: number
  failed: number
  skipped: number
  creditExhausted: boolean
  records: JobRecord[]
}

/**
 * Run many jobs with a concurrency cap. Retries transient/rate-limit failures
 * with backoff; stops launching new work (circuit-breaks) on credit exhaustion.
 */
export async function runJobs(
  specs: JobSpec[],
  runId: string,
  deps: EngineDeps & { concurrency: number; maxRetries?: number }
): Promise<RunSummary> {
  const limit = pLimit(deps.concurrency)
  const maxRetries = deps.maxRetries ?? 3
  const records: JobRecord[] = []
  let creditExhausted = false

  const runOne = async (spec: JobSpec): Promise<void> => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (creditExhausted) return
      try {
        records.push(await processJob(spec, runId, deps))
        return
      } catch (e) {
        const kind = e instanceof HeyGenApiError ? e.kind : "transient"
        if (kind === "credit_exhausted") {
          creditExhausted = true
          return
        }
        const retryable = kind === "transient" || kind === "rate_limited"
        if (retryable && attempt < maxRetries) {
          deps.store.patch(spec.jobId, { attempt: attempt + 1 })
          await deps.sleep(backoffMs(attempt, { base: 2000, factor: 2, max: 30000 }))
          continue
        }
        deps.store.patch(spec.jobId, {
          status: "failed",
          failure: (e as Error).message,
        })
        const rec = deps.store.get(spec.jobId)
        if (rec) records.push(rec)
        return
      }
    }
  }

  await Promise.all(specs.map((spec) => limit(() => runOne(spec))))

  return {
    completed: records.filter((r) => r.status === "completed").length,
    failed: records.filter((r) => r.status === "failed").length,
    skipped: specs.length - records.length,
    creditExhausted,
    records,
  }
}
