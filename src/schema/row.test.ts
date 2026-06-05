import { describe, expect, it } from "vitest"
import { validateRow } from "./row.js"

const valid = {
  product_name: "Acme Widget",
  description: "A great widget that solves your problem.",
  call_to_action: "Shop now at acme.com",
}

describe("validateRow", () => {
  it("accepts a minimal valid row and applies defaults", () => {
    const r = validateRow(valid, 0)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.row.tone).toBe("energetic")
      expect(r.row.language).toBe("en")
      expect(r.row.num_variations).toBe(1)
      expect(r.row.skip).toBe(false)
      expect(r.row.engine).toBeUndefined()
    }
  })

  it("rejects a row missing a required field", () => {
    const r = validateRow({ product_name: "Acme", description: "Great" }, 1)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.index).toBe(1)
      expect(r.issues.join(" ")).toContain("call_to_action")
    }
  })

  it("coerces num_variations and rejects out-of-range values", () => {
    const ok = validateRow({ ...valid, num_variations: "3" }, 0)
    expect(ok).toMatchObject({ ok: true, row: { num_variations: 3 } })
    const bad = validateRow({ ...valid, num_variations: "9" }, 0)
    expect(bad.ok).toBe(false)
  })

  it("treats empty cells as absent so defaults apply", () => {
    const r = validateRow(
      { ...valid, tone: "", num_variations: "", price: "" },
      0
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.row.tone).toBe("energetic")
      expect(r.row.num_variations).toBe(1)
      expect(r.row.price).toBeUndefined()
    }
  })

  it("parses skip booleans without treating 'false' as truthy", () => {
    expect(validateRow({ ...valid, skip: "false" }, 0)).toMatchObject({
      ok: true,
      row: { skip: false },
    })
    expect(validateRow({ ...valid, skip: "true" }, 0)).toMatchObject({
      ok: true,
      row: { skip: true },
    })
  })

  it("maps human-friendly headers to canonical fields", () => {
    const r = validateRow(
      {
        "Product Name": "Acme Widget",
        Description: "A great widget.",
        CTA: "Buy now",
        Tone: "luxury",
      },
      0
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.row.product_name).toBe("Acme Widget")
      expect(r.row.tone).toBe("luxury")
    }
  })
})
