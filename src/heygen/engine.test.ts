import { describe, expect, it, vi } from "vitest"
import type { JobSpec } from "../jobs/build-job.js"
import { JobStore } from "../store/job-store.js"
import type { HeyGenClient } from "./client.js"
import { estimateCost, processJob, runJobs } from "./engine.js"
import { HeyGenApiError } from "./errors.js"

function ivSpec(over: Partial<JobSpec> = {}): JobSpec {
  return {
    jobId: "j1",
    productId: "p1",
    variationIndex: 0,
    engine: "iv",
    gender: "female",
    orientation: "portrait",
    width: 1080,
    height: 1920,
    avatarId: "look_1",
    voiceId: "voice_1",
    aspectRatio: "9:16",
    resolution: "1080p",
    avatarEngine: "avatar_v",
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
    pricePerMinuteUsd: { v3: 2, iv: 4 },
  }
}

describe("estimateCost", () => {
  it("computes per-second cost by engine", () => {
    expect(estimateCost("iv", 60, { v3: 2, iv: 4 })).toBe(4)
    expect(estimateCost("iv", 30, { v3: 2, iv: 4 })).toBe(2)
    expect(estimateCost("v3", 30, { v3: 2, iv: 4 })).toBe(1)
    expect(estimateCost("iv", null, { v3: 2, iv: 4 })).toBe(0)
  })
})

describe("processJob", () => {
  it("creates via createIvVideo, polls /v3/videos, downloads, marks completed", async () => {
    const store = new JobStore(":memory:")
    const client = {
      createIvVideo: vi.fn(async () => "vid_1"),
      getStatusV3: vi
        .fn()
        .mockResolvedValueOnce(processing)
        .mockResolvedValueOnce(done()),
    }
    const d = deps(client, store)
    const rec = await processJob(ivSpec(), "run1", d)
    expect(rec.status).toBe("completed")
    expect(rec.local_path).toBe("/out/p1_0.mp4")
    expect(rec.duration_sec).toBe(30)
    expect(client.createIvVideo).toHaveBeenCalledTimes(1)
    expect(d.download).toHaveBeenCalledTimes(1)
    store.close()
  })

  it("passes the iv recipe (avatar/voice/aspect/resolution/engine) to createIvVideo", async () => {
    const store = new JobStore(":memory:")
    const createIvVideo = vi.fn(async () => "vid")
    const getStatusV3 = vi.fn(async () => done())
    await processJob(ivSpec(), "run1", deps({ createIvVideo, getStatusV3 }, store))
    expect(createIvVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        avatarId: "look_1",
        voiceId: "voice_1",
        aspectRatio: "9:16",
        resolution: "1080p",
        avatarEngine: "avatar_v",
      })
    )
    store.close()
  })

  it("marks failed and skips download on a failed status", async () => {
    const store = new JobStore(":memory:")
    const client = {
      createIvVideo: vi.fn(async () => "vid_1"),
      getStatusV3: vi.fn(async () => ({
        state: "failed",
        videoUrl: null,
        durationSec: null,
        failure: "render error",
      })),
    }
    const d = deps(client, store)
    const rec = await processJob(ivSpec(), "run1", d)
    expect(rec.status).toBe("failed")
    expect(rec.failure).toContain("render error")
    expect(d.download).not.toHaveBeenCalled()
    store.close()
  })

  it("resumes without re-creating when a video id already exists", async () => {
    const store = new JobStore(":memory:")
    store.create({ jobId: "j1", runId: "run1", productId: "p1", variationIndex: 0, engine: "iv" })
    store.patch("j1", { status: "submitted", heygen_video_id: "vid_existing" })
    const client = {
      createIvVideo: vi.fn(),
      getStatusV3: vi.fn(async () => done()),
    }
    const d = deps(client, store)
    const rec = await processJob(ivSpec(), "run1", d)
    expect(client.createIvVideo).not.toHaveBeenCalled()
    expect(client.getStatusV3).toHaveBeenCalledWith("vid_existing")
    expect(rec.status).toBe("completed")
    store.close()
  })

  it("skips a job that is already completed", async () => {
    const store = new JobStore(":memory:")
    store.create({ jobId: "j1", runId: "run1", productId: "p1", variationIndex: 0, engine: "iv" })
    store.patch("j1", { status: "completed" })
    const client = { createIvVideo: vi.fn(), getStatusV3: vi.fn() }
    const d = deps(client, store)
    const rec = await processJob(ivSpec(), "run1", d)
    expect(rec.status).toBe("completed")
    expect(client.createIvVideo).not.toHaveBeenCalled()
    expect(client.getStatusV3).not.toHaveBeenCalled()
    store.close()
  })
})

describe("runJobs", () => {
  it("processes multiple jobs to completion", async () => {
    const store = new JobStore(":memory:")
    const client = {
      createIvVideo: vi.fn(async () => "vid"),
      getStatusV3: vi.fn(async () => done()),
    }
    const summary = await runJobs(
      [ivSpec({ jobId: "j1", productId: "p1" }), ivSpec({ jobId: "j2", productId: "p2" })],
      "run1",
      { ...deps(client, store), concurrency: 2 }
    )
    expect(summary.completed).toBe(2)
    expect(summary.failed).toBe(0)
    store.close()
  })

  it("emits onEvent once per settled job with a running count", async () => {
    const store = new JobStore(":memory:")
    const client = {
      createIvVideo: vi.fn(async () => "vid"),
      getStatusV3: vi.fn(async () => done()),
    }
    const events: Array<{ status: string; settled: number; total: number }> = []
    const summary = await runJobs(
      [ivSpec({ jobId: "j1", productId: "p1" }), ivSpec({ jobId: "j2", productId: "p2" })],
      "run1",
      {
        ...deps(client, store),
        concurrency: 1,
        onEvent: (rec, settled, total) => events.push({ status: rec.status, settled, total }),
      }
    )
    expect(summary.completed).toBe(2)
    expect(events.map((e) => e.settled)).toEqual([1, 2])
    expect(events.every((e) => e.total === 2 && e.status === "completed")).toBe(true)
    store.close()
  })

  it("circuit-breaks when credits are exhausted", async () => {
    const store = new JobStore(":memory:")
    const client = {
      createIvVideo: vi.fn(async () => {
        throw new HeyGenApiError("no credits", { kind: "credit_exhausted" })
      }),
      getStatusV3: vi.fn(),
    }
    const summary = await runJobs(
      [
        ivSpec({ jobId: "j1", productId: "p1" }),
        ivSpec({ jobId: "j2", productId: "p2" }),
        ivSpec({ jobId: "j3", productId: "p3" }),
      ],
      "run1",
      { ...deps(client, store), concurrency: 1 }
    )
    expect(summary.creditExhausted).toBe(true)
    expect(summary.completed).toBe(0)
    store.close()
  })
})
