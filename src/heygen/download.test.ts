import { readFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { makeFileDownloader } from "./download.js"

describe("makeFileDownloader", () => {
  it("writes the fetched bytes to dir/basename and returns the path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dl-"))
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode("hello").buffer,
    })) as unknown as typeof fetch

    const download = makeFileDownloader(dir, fetchImpl)
    const path = await download("http://x/v.mp4", "out.mp4")

    expect(path).toBe(join(dir, "out.mp4"))
    expect(readFileSync(path, "utf8")).toBe("hello")
  })

  it("throws on a non-ok response", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dl-"))
    const fetchImpl = (async () => ({
      ok: false,
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as typeof fetch
    const download = makeFileDownloader(dir, fetchImpl)
    await expect(download("http://x/missing", "out.mp4")).rejects.toThrow("404")
  })
})
