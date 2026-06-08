import { describe, expect, it } from "vitest"
import type { AppConfig } from "../config.js"
import type { ProductRow } from "../schema/row.js"
import type { PromoScript } from "../script/schema.js"
import { buildJobSpec, pickFromPool, seededIndex, stableJobId } from "./build-job.js"

const script: PromoScript = {
  hook: "H",
  script: "Buy our thing now.",
  title: "Promo",
}

const baseRow: ProductRow = {
  product_name: "Acme",
  script: "Buy our thing now.",
  tone: "energetic",
  language: "en",
  num_variations: 1,
  skip: false,
}

function makeConfig(over: Partial<AppConfig> = {}): AppConfig {
  return {
    models: { script: "claude-haiku-4-5", qaScript: "claude-haiku-4-5" },
    scriptWordBudget: { target: 130, max: 140 },
    sampleSize: 3,
    rotation: "hash",
    defaults: {
      engine: "iv",
      orientation: "portrait",
      numVariations: 1,
      gender: "female",
      avatarEngine: "avatar_v",
      resolution: "1080p",
    },
    pools: {
      v3: {
        avatars: { female: [], male: [] },
        voices: { female: [], male: [] },
      },
      iv: {
        avatars: { female: ["iv_f1", "iv_f2"], male: ["iv_m1"] },
        voices: { female: ["ivv_f1", "ivv_f2"], male: ["ivv_m1"] },
      },
    },
    paths: {
      outputs: "./outputs",
      cache: "./.cache",
      ledger: "./.data/runs.sqlite",
    },
    costGuard: { warnAboveVideos: 50, requireConfirmAboveVideos: 200 },
    heygen: { pricePerMinuteUsd: { v3: 2, iv: 4 } },
    ...over,
  }
}

describe("stableJobId", () => {
  it("is deterministic and varies by variation and engine", () => {
    const a = stableJobId("p1", 0, "iv")
    expect(stableJobId("p1", 0, "iv")).toBe(a)
    expect(stableJobId("p1", 1, "iv")).not.toBe(a)
    expect(stableJobId("p1", 0, "v3")).not.toBe(a)
  })
})

describe("seededIndex / pickFromPool", () => {
  it("seededIndex is deterministic per seed and −1 for an empty list", () => {
    const a = seededIndex(3, "seed-1")
    expect(seededIndex(3, "seed-1")).toBe(a)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(3)
    expect(seededIndex(0, "seed-1")).toBe(-1)
  })

  it("pickFromPool is deterministic and undefined for an empty pool", () => {
    const pool = ["x", "y", "z"]
    const a = pickFromPool(pool, "seed-1")
    expect(pickFromPool(pool, "seed-1")).toBe(a)
    expect(pool).toContain(a)
    expect(pickFromPool([], "seed-1")).toBeUndefined()
  })
})

describe("buildJobSpec", () => {
  it("builds an iv spec: paired avatar+voice, aspect/resolution/engine, portrait dims", () => {
    const r = buildJobSpec({ row: baseRow, script, variationIndex: 0, config: makeConfig() })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.spec.engine).toBe("iv")
      expect(["iv_f1", "iv_f2"]).toContain(r.spec.avatarId)
      // avatar[i] is paired with voice[i]
      const i = ["iv_f1", "iv_f2"].indexOf(r.spec.avatarId!)
      expect(r.spec.voiceId).toBe(["ivv_f1", "ivv_f2"][i])
      expect(r.spec.aspectRatio).toBe("9:16")
      expect(r.spec.resolution).toBe("1080p")
      expect(r.spec.avatarEngine).toBe("avatar_v")
      expect(r.spec.width).toBe(1080)
      expect(r.spec.height).toBe(1920)
      expect(r.spec.script).toBe("Buy our thing now.")
      expect(r.spec.jobId).toMatch(/^[a-f0-9]+$/)
    }
  })

  it("honors per-row avatar/voice overrides", () => {
    const row: ProductRow = { ...baseRow, avatar_id: "my_look", voice_id: "my_voice" }
    const r = buildJobSpec({ row, script, variationIndex: 0, config: makeConfig() })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.spec.avatarId).toBe("my_look")
      expect(r.spec.voiceId).toBe("my_voice")
    }
  })

  it("selects avatar+voice from the row's gender pool", () => {
    const row: ProductRow = { ...baseRow, gender: "male" }
    const r = buildJobSpec({ row, script, variationIndex: 0, config: makeConfig() })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.spec.avatarId).toBe("iv_m1")
      expect(r.spec.voiceId).toBe("ivv_m1")
    }
  })

  it("respects an orientation override (landscape dims + aspect)", () => {
    const row: ProductRow = { ...baseRow, orientation: "landscape" }
    const r = buildJobSpec({ row, script, variationIndex: 0, config: makeConfig() })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.spec.orientation).toBe("landscape")
      expect(r.spec.width).toBe(1920)
      expect(r.spec.height).toBe(1080)
      expect(r.spec.aspectRatio).toBe("16:9")
    }
  })

  it("fails an iv job when the pool is empty and no override is given", () => {
    const config = makeConfig({
      pools: {
        v3: { avatars: { female: [], male: [] }, voices: { female: [], male: [] } },
        iv: { avatars: { female: [], male: [] }, voices: { female: [], male: [] } },
      },
    })
    const r = buildJobSpec({ row: baseRow, script, variationIndex: 0, config })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/avatar/i)
  })

  it("allows a v3 job without any avatar or voice (agent auto-selects)", () => {
    const row: ProductRow = { ...baseRow, engine: "v3" }
    const r = buildJobSpec({ row, script, variationIndex: 0, config: makeConfig() })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.spec.engine).toBe("v3")
  })
})
