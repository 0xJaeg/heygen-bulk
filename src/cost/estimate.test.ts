import { describe, expect, it } from "vitest"
import type { AppConfig } from "../config.js"
import type { ProductRow } from "../schema/row.js"
import { estimateCreditUsd, guardLevel, plannedVideoCount } from "./estimate.js"

const row = (over: Partial<ProductRow>): ProductRow => ({
  product_name: "P",
  description: "D",
  call_to_action: "C",
  tone: "energetic",
  language: "en",
  num_variations: 1,
  skip: false,
  ...over,
})

describe("plannedVideoCount", () => {
  it("sums num_variations and ignores skipped rows", () => {
    expect(
      plannedVideoCount([
        row({ num_variations: 2 }),
        row({ num_variations: 3 }),
        row({ skip: true, num_variations: 5 }),
      ])
    ).toBe(5)
  })
})

describe("guardLevel", () => {
  const guard: AppConfig["costGuard"] = {
    warnAboveVideos: 50,
    requireConfirmAboveVideos: 200,
  }
  it("escalates with the video count", () => {
    expect(guardLevel(10, guard)).toBe("ok")
    expect(guardLevel(100, guard)).toBe("warn")
    expect(guardLevel(500, guard)).toBe("confirm")
  })
})

describe("estimateCreditUsd", () => {
  it("multiplies videos by minutes by the per-minute rate", () => {
    expect(estimateCreditUsd(10, 30, 1)).toBe(5)
  })
})
