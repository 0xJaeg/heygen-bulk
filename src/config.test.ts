import { describe, expect, it } from "vitest"
import { config } from "./config.js"

describe("config", () => {
  it("uses a current Claude model for script generation", () => {
    expect(config.models.script).toBe("claude-haiku-4-5")
  })

  it("enforces a sub-60s word budget", () => {
    expect(config.scriptWordBudget.target).toBeLessThanOrEqual(
      config.scriptWordBudget.max
    )
    expect(config.scriptWordBudget.max).toBeLessThanOrEqual(140)
  })

  it("defaults to the Avatar IV/V (iv) engine with a tier + resolution set", () => {
    expect(config.defaults.engine).toBe("iv")
    expect(config.defaults.avatarEngine).toBe("avatar_v")
    expect(config.defaults.resolution).toBe("1080p")
  })

  it("ships a gender-split iv photo-avatar pool with parallel avatar/voice arrays", () => {
    for (const g of ["male", "female"] as const) {
      expect(config.pools.iv.avatars[g].length).toBeGreaterThan(0)
      expect(config.pools.iv.avatars[g].length).toBe(config.pools.iv.voices[g].length)
    }
  })
})
