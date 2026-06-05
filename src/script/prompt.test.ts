import { describe, expect, it } from "vitest"
import type { ProductRow } from "../schema/row.js"
import { renderRowPrompt, SYSTEM_PROMPT } from "./prompt.js"

const base: ProductRow = {
  product_name: "Acme Widget",
  description: "A great widget.",
  call_to_action: "Buy now at acme.com",
  tone: "luxury",
  language: "en",
  num_variations: 1,
  skip: false,
}

describe("renderRowPrompt", () => {
  it("includes the product name, tone, and call to action", () => {
    const p = renderRowPrompt(base, 0)
    expect(p).toContain("Acme Widget")
    expect(p).toContain("luxury")
    expect(p).toContain("Buy now at acme.com")
  })

  it("adds a variation hint only when num_variations > 1", () => {
    expect(renderRowPrompt(base, 0)).not.toContain("variation")
    const multi = renderRowPrompt({ ...base, num_variations: 3 }, 1)
    expect(multi).toContain("variation 2 of 3")
  })
})

describe("SYSTEM_PROMPT", () => {
  it("states the sub-60-second word ceiling", () => {
    expect(SYSTEM_PROMPT).toContain("140")
  })
})
