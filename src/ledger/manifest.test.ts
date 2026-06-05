import { readFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { renderIndexHtml, type RunManifest, writeRun } from "./manifest.js"

const manifest: RunManifest = {
  run_id: "run1",
  mode: "sample",
  created_at: "2026-06-05T00:00:00Z",
  totals: { completed: 1, failed: 0, skipped: 0, est_cost_usd: 0.5 },
  entries: [
    {
      product_id: "p1",
      variation_index: 0,
      engine: "v2",
      avatar_id: "av",
      voice_id: "vo",
      status: "completed",
      hook: "Hook!",
      script: "Buy now <today>.",
      title: "Acme",
      local_path: "outputs/run1__SAMPLE/p1_0.mp4",
      duration_sec: 30,
      est_cost_usd: 0.5,
    },
  ],
}

describe("renderIndexHtml", () => {
  it("includes title, status, and script, and escapes HTML", () => {
    const html = renderIndexHtml(manifest)
    expect(html).toContain("Acme")
    expect(html).toContain("completed")
    expect(html).toContain("Buy now &lt;today&gt;.")
    expect(html).toContain("p1_0.mp4")
  })
})

describe("renderIndexHtml video src", () => {
  it("uses the basename so the src resolves next to index.html in the run dir", () => {
    const html = renderIndexHtml(manifest)
    expect(html).toContain('src="p1_0.mp4"')
    expect(html).not.toContain('src="outputs/run1__SAMPLE/p1_0.mp4"')
  })
})

describe("writeRun", () => {
  it("writes manifest.json and index.html", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifest-"))
    const { manifestPath, indexPath } = await writeRun(dir, manifest)
    expect(JSON.parse(readFileSync(manifestPath, "utf8")).run_id).toBe("run1")
    expect(readFileSync(indexPath, "utf8")).toContain("<html")
  })
})
