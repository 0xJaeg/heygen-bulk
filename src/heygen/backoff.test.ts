import { describe, expect, it } from "vitest"
import { backoffMs } from "./backoff.js"

describe("backoffMs", () => {
  it("returns the base delay at attempt 0", () => {
    expect(backoffMs(0, { base: 100, factor: 2, max: 1000 })).toBe(100)
  })

  it("grows geometrically with the attempt", () => {
    expect(backoffMs(1, { base: 100, factor: 2, max: 1000 })).toBe(200)
    expect(backoffMs(3, { base: 100, factor: 2, max: 1000 })).toBe(800)
  })

  it("clamps to the max delay", () => {
    expect(backoffMs(10, { base: 100, factor: 2, max: 1000 })).toBe(1000)
  })
})
