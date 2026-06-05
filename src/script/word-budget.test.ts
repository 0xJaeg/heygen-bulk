import { describe, expect, it } from "vitest"
import { countWords, trimToWords } from "./word-budget.js"

describe("countWords", () => {
  it("counts whitespace-separated words", () => {
    expect(countWords("Hello there friend")).toBe(3)
  })

  it("collapses whitespace runs and trims ends", () => {
    expect(countWords("  one   two\n three ")).toBe(3)
  })

  it("returns 0 for empty or whitespace-only text", () => {
    expect(countWords("   ")).toBe(0)
  })
})

describe("trimToWords", () => {
  it("returns the text unchanged when within budget", () => {
    const t = "Buy now. It is great."
    expect(trimToWords(t, 20)).toBe(t)
  })

  it("trims to the last full sentence that fits the budget", () => {
    const t = "One two three. Four five six. Seven eight nine."
    expect(trimToWords(t, 7)).toBe("One two three. Four five six.")
  })

  it("hard-cuts to the budget when no sentence boundary fits", () => {
    expect(trimToWords("alpha beta gamma delta epsilon", 3)).toBe(
      "alpha beta gamma"
    )
  })
})
