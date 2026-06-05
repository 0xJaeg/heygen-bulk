import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { ProductRow } from "../schema/row.js"
import { type CachedScript, FileScriptCache, scriptCacheKey } from "./cache.js"

const row: ProductRow = {
  product_name: "Acme",
  description: "A great widget.",
  call_to_action: "Buy now",
  tone: "energetic",
  language: "en",
  num_variations: 1,
  skip: false,
}

const key = (over: Partial<Parameters<typeof scriptCacheKey>[0]> = {}) =>
  scriptCacheKey({ model: "m", promptVersion: "1", row, variationIndex: 0, ...over })

describe("scriptCacheKey", () => {
  it("is deterministic for the same inputs", () => {
    expect(key()).toBe(key())
  })

  it("changes when a script-affecting field changes", () => {
    const base = key()
    expect(key({ variationIndex: 1 })).not.toBe(base)
    expect(key({ model: "m2" })).not.toBe(base)
    expect(key({ promptVersion: "2" })).not.toBe(base)
    expect(key({ row: { ...row, tone: "luxury" } })).not.toBe(base)
    expect(key({ row: { ...row, description: "Different." } })).not.toBe(base)
  })

  it("ignores fields that do not affect the script (e.g. avatar_id)", () => {
    expect(key({ row: { ...row, avatar_id: "av_123" } })).toBe(key())
  })
})

describe("FileScriptCache", () => {
  it("returns null on a miss and the stored value after put", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scriptcache-"))
    const cache = new FileScriptCache(dir)
    expect(await cache.get("abc")).toBeNull()
    const value: CachedScript = {
      hook: "H",
      script: "S",
      title: "T",
      model: "m",
      promptVersion: "1",
    }
    await cache.put("abc", value)
    expect(await cache.get("abc")).toEqual(value)
  })
})
