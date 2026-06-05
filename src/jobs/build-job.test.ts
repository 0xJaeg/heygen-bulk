import { describe, expect, it } from "vitest"
import type { AppConfig } from "../config.js"
import type { ProductRow } from "../schema/row.js"
import type { PromoScript } from "../script/schema.js"
import {
  buildJobSpec,
  pickFromPool,
  stableJobId,
} from "./build-job.js"

const script: PromoScript = {
  hook: "H",
  script: "Buy our thing now.",
  title: "Promo",
}

const baseRow: ProductRow = {
  product_name: "Acme",
  description: "A widget.",
  call_to_action: "Buy now",
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
    defaults: { engine: "v2", orientation: "portrait", numVariations: 1 },
    pools: {
      v2: {
        avatars: ["av_a", "av_b"],
        voices: ["vo_a", "vo_b"],
        formats: ["portrait"],
      },
      v3: { avatars: [], voices: [] },
    },
    paths: { outputs: "./outputs", cache: "./.cache", ledger: "./.data/runs.sqlite" },
    costGuard: { warnAboveVideos: 50, requireConfirmAboveVideos: 200 },
    heygen: {
      statusPathV2: "/v1/video_status.get",
      pricePerMinuteUsd: { v2: 1, v3: 2 },
    },
    ...over,
  }
}

describe("stableJobId", () => {
  it("is deterministic and varies by variation and engine", () => {
    const a = stableJobId("p1", 0, "v2")
    expect(stableJobId("p1", 0, "v2")).toBe(a)
    expect(stableJobId("p1", 1, "v2")).not.toBe(a)
    expect(stableJobId("p1", 0, "v3")).not.toBe(a)
  })
})

describe("pickFromPool", () => {
  it("is deterministic per seed and undefined for an empty pool", () => {
    const pool = ["x", "y", "z"]
    const a = pickFromPool(pool, "seed-1")
    expect(pickFromPool(pool, "seed-1")).toBe(a)
    expect(pool).toContain(a)
    expect(pickFromPool([], "seed-1")).toBeUndefined()
  })
})

describe("buildJobSpec", () => {
  it("builds a v2 spec from the pool with portrait dimensions", () => {
    const r = buildJobSpec({
      row: baseRow,
      script,
      variationIndex: 0,
      config: makeConfig(),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.spec.engine).toBe("v2")
      expect(makeConfig().pools.v2.avatars).toContain(r.spec.avatarId)
      expect(makeConfig().pools.v2.voices).toContain(r.spec.voiceId)
      expect(r.spec.width).toBe(1080)
      expect(r.spec.height).toBe(1920)
      expect(r.spec.script).toBe("Buy our thing now.")
      expect(r.spec.jobId).toMatch(/^[a-f0-9]+$/)
    }
  })

  it("honors per-row overrides", () => {
    const row: ProductRow = {
      ...baseRow,
      engine: "v2",
      avatar_id: "custom_av",
      voice_id: "custom_vo",
      orientation: "landscape",
    }
    const r = buildJobSpec({ row, script, variationIndex: 0, config: makeConfig() })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.spec.avatarId).toBe("custom_av")
      expect(r.spec.voiceId).toBe("custom_vo")
      expect(r.spec.orientation).toBe("landscape")
      expect(r.spec.width).toBe(1920)
      expect(r.spec.height).toBe(1080)
    }
  })

  it("fails a v2 job when the pool is empty and no override is given", () => {
    const config = makeConfig({
      pools: {
        v2: { avatars: [], voices: [], formats: ["portrait"] },
        v3: { avatars: [], voices: [] },
      },
    })
    const r = buildJobSpec({ row: baseRow, script, variationIndex: 0, config })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/avatar/i)
  })

  it("allows a v3 job without any avatar or voice", () => {
    const row: ProductRow = { ...baseRow, engine: "v3" }
    const config = makeConfig({
      pools: {
        v2: { avatars: [], voices: [], formats: ["portrait"] },
        v3: { avatars: [], voices: [] },
      },
    })
    const r = buildJobSpec({ row, script, variationIndex: 0, config })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.spec.engine).toBe("v3")
  })
})
