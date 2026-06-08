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
    defaults: {
      engine: "v2",
      orientation: "portrait",
      numVariations: 1,
      gender: "female",
    },
    pools: {
      v2: {
        avatars: { female: ["av_a", "av_b"], male: ["av_m"] },
        voices: { female: ["vo_a", "vo_b"], male: ["vo_m"] },
        formats: ["portrait"],
      },
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
      backgrounds: "./backgrounds",
    },
    costGuard: { warnAboveVideos: 50, requireConfirmAboveVideos: 200 },
    heygen: {
      statusPathV2: "/v1/video_status.get",
      pricePerMinuteUsd: { v2: 1, v3: 2, iv: 4 },
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
      expect(makeConfig().pools.v2.avatars.female).toContain(r.spec.avatarId)
      expect(makeConfig().pools.v2.voices.female).toContain(r.spec.voiceId)
      expect(r.spec.width).toBe(1080)
      expect(r.spec.height).toBe(1920)
      expect(r.spec.script).toBe("Buy our thing now.")
      expect(r.spec.jobId).toMatch(/^[a-f0-9]+$/)
    }
  })

  it("builds an iv spec: paired avatar+voice, aspect/resolution, no v2 framing", () => {
    const config = makeConfig({
      defaults: {
        engine: "iv",
        orientation: "portrait",
        numVariations: 1,
        gender: "female",
        avatarEngine: "avatar_v",
        resolution: "1080p",
      },
    })
    const r = buildJobSpec({ row: baseRow, script, variationIndex: 0, config })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.spec.engine).toBe("iv")
      expect(config.pools.iv.avatars.female).toContain(r.spec.avatarId)
      // avatar[i] is paired with voice[i]
      const i = config.pools.iv.avatars.female.indexOf(r.spec.avatarId!)
      expect(r.spec.voiceId).toBe(config.pools.iv.voices.female[i])
      expect(r.spec.aspectRatio).toBe("9:16")
      expect(r.spec.resolution).toBe("1080p")
      expect(r.spec.avatarEngine).toBe("avatar_v")
      // v2-only framing knobs are omitted on the iv path
      expect(r.spec.background).toBeUndefined()
      expect(r.spec.avatarScale).toBeUndefined()
      expect(r.spec.avatarOffset).toBeUndefined()
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
        v2: {
          avatars: { female: [], male: [] },
          voices: { female: [], male: [] },
          formats: ["portrait"],
        },
        v3: {
          avatars: { female: [], male: [] },
          voices: { female: [], male: [] },
        },
        iv: {
          avatars: { female: [], male: [] },
          voices: { female: [], male: [] },
        },
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
        v2: {
          avatars: { female: [], male: [] },
          voices: { female: [], male: [] },
          formats: ["portrait"],
        },
        v3: {
          avatars: { female: [], male: [] },
          voices: { female: [], male: [] },
        },
        iv: {
          avatars: { female: [], male: [] },
          voices: { female: [], male: [] },
        },
      },
    })
    const r = buildJobSpec({ row, script, variationIndex: 0, config })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.spec.engine).toBe("v3")
  })

  it("applies captions and a rotated background from config", () => {
    const config = makeConfig({
      defaults: {
        engine: "v2",
        orientation: "portrait",
        numVariations: 1,
        gender: "female",
        caption: true,
      },
      pools: {
        v2: {
          avatars: { female: ["av_a"], male: [] },
          voices: { female: ["vo_a"], male: [] },
          formats: ["portrait"],
          backgrounds: [{ type: "color", value: "#101820" }],
        },
        v3: {
          avatars: { female: [], male: [] },
          voices: { female: [], male: [] },
        },
        iv: {
          avatars: { female: [], male: [] },
          voices: { female: [], male: [] },
        },
      },
    })
    const r = buildJobSpec({ row: baseRow, script, variationIndex: 0, config })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.spec.caption).toBe(true)
      expect(r.spec.background).toEqual({ type: "color", value: "#101820" })
    }
  })

  it("carries the configured avatar style onto the spec", () => {
    const config = makeConfig({
      defaults: {
        engine: "v2",
        orientation: "portrait",
        numVariations: 1,
        gender: "female",
        avatarStyle: "closeUp",
      },
    })
    const r = buildJobSpec({ row: baseRow, script, variationIndex: 0, config })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.spec.avatarStyle).toBe("closeUp")
  })

  it("carries the configured avatar scale onto the spec", () => {
    const config = makeConfig({
      defaults: {
        engine: "v2",
        orientation: "portrait",
        numVariations: 1,
        gender: "female",
        avatarScale: 1.4,
      },
    })
    const r = buildJobSpec({ row: baseRow, script, variationIndex: 0, config })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.spec.avatarScale).toBe(1.4)
  })

  it("selects avatar and voice from the row's gender pool", () => {
    const config = makeConfig()
    const male = buildJobSpec({
      row: { ...baseRow, gender: "male" },
      script,
      variationIndex: 0,
      config,
    })
    expect(male.ok).toBe(true)
    if (male.ok) {
      expect(male.spec.gender).toBe("male")
      expect(male.spec.avatarId).toBe("av_m")
      expect(male.spec.voiceId).toBe("vo_m")
    }

    const female = buildJobSpec({
      row: { ...baseRow, gender: "female" },
      script,
      variationIndex: 0,
      config,
    })
    expect(female.ok).toBe(true)
    if (female.ok) {
      expect(["av_a", "av_b"]).toContain(female.spec.avatarId)
      expect(["vo_a", "vo_b"]).toContain(female.spec.voiceId)
    }
  })
})
