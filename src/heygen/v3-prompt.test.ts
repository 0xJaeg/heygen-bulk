import { describe, expect, it } from "vitest"
import { talkingHeadPrompt } from "./v3-prompt.js"

describe("talkingHeadPrompt", () => {
  it("embeds the script verbatim and forbids b-roll / text / scene changes", () => {
    const p = talkingHeadPrompt("Buy our thing now.")
    expect(p).toContain("Buy our thing now.")
    expect(p).toMatch(/b-roll/i)
    expect(p).toMatch(/continuous shot|talking-head/i)
    expect(p).toMatch(/text|captions|graphics/i)
  })
})
