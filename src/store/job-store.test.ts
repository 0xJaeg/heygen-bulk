import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { JobStore } from "./job-store.js"

function newStore() {
  return new JobStore(":memory:")
}

describe("JobStore", () => {
  it("creates a pending job and reads it back", () => {
    const store = newStore()
    store.create({
      jobId: "j1",
      runId: "r1",
      productId: "p1",
      variationIndex: 0,
      engine: "v2",
    })
    const j = store.get("j1")
    expect(j?.status).toBe("pending")
    expect(j?.attempt).toBe(0)
    store.close()
  })

  it("is idempotent: re-create does not overwrite an existing job", () => {
    const store = newStore()
    store.create({
      jobId: "j1",
      runId: "r1",
      productId: "p1",
      variationIndex: 0,
      engine: "v2",
    })
    store.patch("j1", { status: "completed", video_url: "http://x" })
    store.create({
      jobId: "j1",
      runId: "r1",
      productId: "p1",
      variationIndex: 0,
      engine: "v2",
    })
    expect(store.get("j1")?.status).toBe("completed")
    store.close()
  })

  it("patches fields and lists jobs by run", () => {
    const store = newStore()
    store.create({ jobId: "j1", runId: "r1", productId: "p1", variationIndex: 0, engine: "v2" })
    store.create({ jobId: "j2", runId: "r1", productId: "p2", variationIndex: 0, engine: "v2" })
    store.patch("j1", { status: "submitted", heygen_video_id: "vid_1" })
    const j1 = store.get("j1")
    expect(j1?.status).toBe("submitted")
    expect(j1?.heygen_video_id).toBe("vid_1")
    expect(store.all("r1")).toHaveLength(2)
    store.close()
  })

  it("creates the parent directory if it does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jobstore-"))
    const store = new JobStore(join(dir, "nested", "deep", "runs.sqlite"))
    store.create({
      jobId: "j1",
      runId: "r1",
      productId: "p1",
      variationIndex: 0,
      engine: "v2",
    })
    expect(store.get("j1")?.status).toBe("pending")
    store.close()
  })
})
