import { describe, expect, it } from "vitest"
import type { AppConfig } from "../config.js"
import type { ProductRow } from "../schema/row.js"
import type { PromoScript } from "../script/schema.js"
import {
  buildJobSpec,
  pickFromPool,
  productKey,
  seededIndex,
  stableJobId,
} from "./build-job.js"

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

describe("productKey", () => {
  it("uses an explicit row_id verbatim when present", () => {
    expect(productKey({ ...baseRow, row_id: "r1" })).toBe("r1")
  })

  it("collides for the same name + same provided script (a true duplicate)", () => {
    const a = productKey({ ...baseRow, script: "Same line." })
    const b = productKey({ ...baseRow, script: "Same line." })
    expect(a).toBe(b)
  })

  it("gives the same name + different provided scripts distinct ids", () => {
    // 5 testimonials for one product must become 5 videos, not collapse to 1.
    const a = productKey({ ...baseRow, script: "Testimonial one." })
    const b = productKey({ ...baseRow, script: "Testimonial two." })
    expect(a).not.toBe(b)
  })

  it("distinguishes the same script cast in different genders", () => {
    // One testimonial, a male and a female read = two videos, not one.
    const m = productKey({ ...baseRow, script: "Same words.", gender: "male" })
    const f = productKey({ ...baseRow, script: "Same words.", gender: "female" })
    expect(m).not.toBe(f)
  })

  it("still collides for two no-script rows with identical grounding", () => {
    const noScript: ProductRow = {
      product_name: "X",
      description: "same desc",
      call_to_action: "Buy",
      tone: "energetic",
      language: "en",
      num_variations: 1,
      skip: false,
    }
    expect(productKey(noScript)).toBe(productKey({ ...noScript }))
  })
})

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

  it("v3 uses the shared photo-avatar pool (same looks as iv)", () => {
    const row: ProductRow = { ...baseRow, engine: "v3" }
    const r = buildJobSpec({ row, script, variationIndex: 0, config: makeConfig() })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.spec.engine).toBe("v3")
      expect(["iv_f1", "iv_f2"]).toContain(r.spec.avatarId)
    }
  })

  it("allows a v3 job with an empty pool (agent auto-selects)", () => {
    const config = makeConfig({
      pools: {
        v3: { avatars: { female: [], male: [] }, voices: { female: [], male: [] } },
        iv: { avatars: { female: [], male: [] }, voices: { female: [], male: [] } },
      },
    })
    const row: ProductRow = { ...baseRow, engine: "v3" }
    const r = buildJobSpec({ row, script, variationIndex: 0, config })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.spec.avatarId).toBeUndefined()
  })

  it("round-robin applies to v3 too (paired avatar+voice by index)", () => {
    const config = makeConfig({ rotation: "round-robin" })
    const row: ProductRow = { ...baseRow, engine: "v3" }
    const r0 = buildJobSpec({ row, script, variationIndex: 0, config, rotationIndex: 0 })
    const r1 = buildJobSpec({ row, script, variationIndex: 0, config, rotationIndex: 1 })
    expect(r0.ok && r0.spec.avatarId).toBe("iv_f1")
    expect(r0.ok && r0.spec.voiceId).toBe("ivv_f1")
    expect(r1.ok && r1.spec.avatarId).toBe("iv_f2")
    expect(r1.ok && r1.spec.voiceId).toBe("ivv_f2")
  })

  it("round-robin: picks the paired avatar+voice at rotationIndex, wrapping the pool", () => {
    const config = makeConfig({ rotation: "round-robin" })
    const at = (rotationIndex: number) =>
      buildJobSpec({ row: baseRow, script, variationIndex: 0, config, rotationIndex })
    const r0 = at(0)
    const r1 = at(1)
    const r2 = at(2) // wraps: 2 % 2 === 0
    expect(r0.ok && r0.spec.avatarId).toBe("iv_f1")
    expect(r0.ok && r0.spec.voiceId).toBe("ivv_f1")
    expect(r1.ok && r1.spec.avatarId).toBe("iv_f2")
    expect(r1.ok && r1.spec.voiceId).toBe("ivv_f2")
    expect(r2.ok && r2.spec.avatarId).toBe("iv_f1")
  })
})

describe("per-row avatar_engine", () => {
  it("overrides the config default avatar engine on the spec", () => {
    // makeConfig default is avatar_v; the row asks for avatar_iv
    const row: ProductRow = { ...baseRow, avatar_engine: "avatar_iv" }
    const r = buildJobSpec({ row, script, variationIndex: 0, config: makeConfig() })
    expect(r.ok && r.spec.avatarEngine).toBe("avatar_iv")
  })

  it("falls back to the config default when unset", () => {
    const r = buildJobSpec({ row: baseRow, script, variationIndex: 0, config: makeConfig() })
    expect(r.ok && r.spec.avatarEngine).toBe("avatar_v")
  })

  it("leaves productKey byte-identical when avatar_engine is absent (backward-compatible)", () => {
    expect(productKey(baseRow)).toBe("p_61afbc55254b")
  })

  it("folds avatar_engine into identity only when set, so IV vs V don't collapse", () => {
    const iv: ProductRow = { ...baseRow, avatar_engine: "avatar_iv" }
    const v: ProductRow = { ...baseRow, avatar_engine: "avatar_v" }
    expect(productKey(iv)).not.toBe(productKey(v))
    expect(productKey(iv)).not.toBe(productKey(baseRow))
    // same engine + same content, differ only by avatar_engine → distinct job ids
    const jiv = buildJobSpec({ row: iv, script, variationIndex: 0, config: makeConfig() })
    const jv = buildJobSpec({ row: v, script, variationIndex: 0, config: makeConfig() })
    expect(jiv.ok && jv.ok && jiv.spec.jobId !== jv.spec.jobId).toBe(true)
  })
})
