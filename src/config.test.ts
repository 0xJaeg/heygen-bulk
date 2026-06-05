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

  it("defaults to the controllable V2 engine", () => {
    expect(config.defaults.engine).toBe("v2")
  })
})
