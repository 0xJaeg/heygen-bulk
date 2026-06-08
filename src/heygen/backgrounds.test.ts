import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { loadBackgrounds } from "./backgrounds.js"

describe("loadBackgrounds", () => {
  it("uploads images once, caches asset ids, and reuses cache on re-run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bg-"))
    await writeFile(join(dir, "a.png"), Buffer.from([1, 2, 3]))
    await writeFile(join(dir, "b.png"), Buffer.from([4, 5, 6]))
    const cachePath = join(dir, "cache.json")
    let n = 0
    const uploadAsset = vi.fn(async () => `asset_${++n}`)

    const bgs = await loadBackgrounds({ dir, client: { uploadAsset }, cachePath })
    expect(bgs).toHaveLength(2)
    expect(bgs[0]).toEqual({ type: "image", image_asset_id: "asset_1" })
    expect(bgs[1]).toEqual({ type: "image", image_asset_id: "asset_2" })
    expect(uploadAsset).toHaveBeenCalledTimes(2)

    const bgs2 = await loadBackgrounds({ dir, client: { uploadAsset }, cachePath })
    expect(uploadAsset).toHaveBeenCalledTimes(2) // cache hit, no new uploads
    expect(bgs2).toHaveLength(2)
  })

  it("resizes images to the target before upload when a resizer is given", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bg-"))
    await writeFile(join(dir, "a.png"), Buffer.from([1, 2, 3]))
    const resized = new Uint8Array([9, 9, 9])
    const resize = vi.fn(async () => resized)
    const captured: Uint8Array[] = []
    const uploadAsset = vi.fn(async (bytes: Uint8Array) => {
      captured.push(bytes)
      return "asset_1"
    })
    const bgs = await loadBackgrounds({
      dir,
      client: { uploadAsset },
      cachePath: join(dir, "c.json"),
      target: { width: 1080, height: 1920 },
      resize,
    })
    expect(bgs).toEqual([{ type: "image", image_asset_id: "asset_1" }])
    expect(resize).toHaveBeenCalledWith(expect.any(Uint8Array), 1080, 1920)
    expect(captured[0]).toEqual(resized)
  })

  it("returns [] when the backgrounds dir does not exist", async () => {
    const uploadAsset = vi.fn(async () => "x")
    const result = await loadBackgrounds({
      dir: join(tmpdir(), "definitely-missing-bg-dir-xyz-123"),
      client: { uploadAsset },
      cachePath: join(tmpdir(), "x.json"),
    })
    expect(result).toEqual([])
    expect(uploadAsset).not.toHaveBeenCalled()
  })

  it("ignores non-image files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bg-"))
    await writeFile(join(dir, "a.png"), Buffer.from([1]))
    await writeFile(join(dir, "notes.txt"), "ignore me")
    const uploadAsset = vi.fn(async () => "asset_1")
    const bgs = await loadBackgrounds({
      dir,
      client: { uploadAsset },
      cachePath: join(dir, "c.json"),
    })
    expect(bgs).toHaveLength(1)
    expect(uploadAsset).toHaveBeenCalledTimes(1)
  })
})
