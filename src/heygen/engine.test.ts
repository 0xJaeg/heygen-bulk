import { describe, expect, it, vi } from "vitest"
import type { JobSpec } from "../jobs/build-job.js"
import { JobStore } from "../store/job-store.js"
import type { HeyGenClient } from "./client.js"
import { estimateCost, processJob, runJobs } from "./engine.js"
import { HeyGenApiError } from "./errors.js"

function v2Spec(over: Partial<JobSpec> = {}): JobSpec {
  return {
    jobId: "j1",
    productId: "p1",
    variationIndex: 0,
    engine: "v2",
    gender: "female",
    orientation: "portrait",
    width: 1080,
    height: 1920,
    avatarId: "av_1",
    voiceId: "vo_1",
    script: "Buy now.",
    title: "Promo",
    ...over,
  }
}

const done = () => ({
  state: "completed",
  videoUrl: "http://x/v.mp4",
  durationSec: 30,
  failure: null,
})
const processing = {
  state: "processing",
  videoUrl: null,
  durationSec: null,
  failure: null,
}

function deps(client: object, store: JobStore) {
  return {
    client: client as unknown as HeyGenClient,
    store,
    download: vi.fn(async () => "/out/p1_0.mp4"),
    sleep: vi.fn(async () => undefined),
    pricePerMinuteUsd: { v2: 1, v3: 2, iv: 4 },
  }
}

describe("estimateCost", () => {
  it("computes per-second cost by engine", () => {
    expect(estimateCost("v2", 60, { v2: 1, v3: 2, iv: 4 })).toBe(1)
    expect(estimateCost("v3", 30, { v2: 1, v3: 2, iv: 4 })).toBe(1)
    expect(estimateCost("iv", 30, { v2: 1, v3: 2, iv: 4 })).toBe(2)
    expect(estimateCost("v2", null, { v2: 1, v3: 2, iv: 4 })).toBe(0)
  })
})

describe("processJob", () => {
  it("creates, polls to completion, downloads, and marks completed", async () => {
    const store = new JobStore(":memory:")
    const client = {
      createV2: vi.fn(async () => "vid_1"),
      getStatusV2: vi
        .fn()
        .mockResolvedValueOnce(processing)
        .mockResolvedValueOnce(done()),
    }
    const d = deps(client, store)
    const rec = await processJob(v2Spec(), "run1", d)
    expect(rec.status).toBe("completed")
    expect(rec.local_path).toBe("/out/p1_0.mp4")
    expect(rec.duration_sec).toBe(30)
    expect(client.createV2).toHaveBeenCalledTimes(1)
    expect(d.download).toHaveBeenCalledTimes(1)
    store.close()
  })

  it("marks failed and skips download on a failed status", async () => {
    const store = new JobStore(":memory:")
    const client = {
      createV2: vi.fn(async () => "vid_1"),
      getStatusV2: vi.fn(async () => ({
        state: "failed",
        videoUrl: null,
        durationSec: null,
        failure: "render error",
      })),
    }
    const d = deps(client, store)
    const rec = await processJob(v2Spec(), "run1", d)
    expect(rec.status).toBe("failed")
    expect(rec.failure).toContain("render error")
    expect(d.download).not.toHaveBeenCalled()
    store.close()
  })

  it("resumes without re-creating when a video id already exists", async () => {
    const store = new JobStore(":memory:")
    store.create({ jobId: "j1", runId: "run1", productId: "p1", variationIndex: 0, engine: "v2" })
    store.patch("j1", { status: "submitted", heygen_video_id: "vid_existing" })
    const client = {
      createV2: vi.fn(),
      getStatusV2: vi.fn(async () => done()),
    }
    const d = deps(client, store)
    const rec = await processJob(v2Spec(), "run1", d)
    expect(client.createV2).not.toHaveBeenCalled()
    expect(client.getStatusV2).toHaveBeenCalledWith("vid_existing", undefined)
    expect(rec.status).toBe("completed")
    store.close()
  })

  it("skips a job that is already completed", async () => {
    const store = new JobStore(":memory:")
    store.create({ jobId: "j1", runId: "run1", productId: "p1", variationIndex: 0, engine: "v2" })
    store.patch("j1", { status: "completed" })
    const client = { createV2: vi.fn(), getStatusV2: vi.fn() }
    const d = deps(client, store)
    const rec = await processJob(v2Spec(), "run1", d)
    expect(rec.status).toBe("completed")
    expect(client.createV2).not.toHaveBeenCalled()
    expect(client.getStatusV2).not.toHaveBeenCalled()
    store.close()
  })

  it("submits an iv job via createIvVideo and polls /v3/videos", async () => {
    const store = new JobStore(":memory:")
    const createIvVideo = vi.fn(async () => "iv_vid")
    const getStatusV3 = vi.fn(async () => done())
    const d = deps({ createIvVideo, getStatusV3 }, store)
    const rec = await processJob(
      v2Spec({
        engine: "iv",
        avatarId: "look_1",
        voiceId: "voice_1",
        aspectRatio: "9:16",
        resolution: "1080p",
        avatarEngine: "avatar_v",
      }),
      "run1",
      d
    )
    expect(createIvVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        avatarId: "look_1",
        voiceId: "voice_1",
        aspectRatio: "9:16",
        resolution: "1080p",
        avatarEngine: "avatar_v",
      })
    )
    expect(getStatusV3).toHaveBeenCalledWith("iv_vid")
    expect(rec.status).toBe("completed")
    store.close()
  })

  it("passes caption and background through to createV2", async () => {
    const store = new JobStore(":memory:")
    const createV2 = vi.fn(async () => "vid")
    const getStatusV2 = vi.fn(async () => done())
    const d = deps({ createV2, getStatusV2 }, store)
    await processJob(
      v2Spec({ caption: true, background: { type: "color", value: "#111" } }),
      "run1",
      d
    )
    expect(createV2).toHaveBeenCalledWith(
      expect.objectContaining({
        caption: true,
        background: { type: "color", value: "#111" },
      })
    )
    store.close()
  })
})

describe("runJobs", () => {
  it("processes multiple jobs to completion", async () => {
    const store = new JobStore(":memory:")
    const client = {
      createV2: vi.fn(async () => "vid"),
      getStatusV2: vi.fn(async () => done()),
    }
    const summary = await runJobs(
      [v2Spec({ jobId: "j1", productId: "p1" }), v2Spec({ jobId: "j2", productId: "p2" })],
      "run1",
      { ...deps(client, store), concurrency: 2 }
    )
    expect(summary.completed).toBe(2)
    expect(summary.failed).toBe(0)
    store.close()
  })

  it("circuit-breaks when credits are exhausted", async () => {
    const store = new JobStore(":memory:")
    const client = {
      createV2: vi.fn(async () => {
        throw new HeyGenApiError("no credits", { kind: "credit_exhausted" })
      }),
      getStatusV2: vi.fn(),
    }
    const summary = await runJobs(
      [
        v2Spec({ jobId: "j1", productId: "p1" }),
        v2Spec({ jobId: "j2", productId: "p2" }),
        v2Spec({ jobId: "j3", productId: "p3" }),
      ],
      "run1",
      { ...deps(client, store), concurrency: 1 }
    )
    expect(summary.creditExhausted).toBe(true)
    expect(summary.completed).toBe(0)
    store.close()
  })
})
