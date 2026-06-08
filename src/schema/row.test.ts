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

  it("normalizes the gender column (male/female, incl. M/F and aliases)", () => {
    const male = validateRow({ ...valid, gender: "Male" }, 0)
    expect(male.ok).toBe(true)
    if (male.ok) expect(male.row.gender).toBe("male")

    const f = validateRow({ ...valid, gender: "F" }, 0)
    expect(f.ok).toBe(true)
    if (f.ok) expect(f.row.gender).toBe("female")

    const aliased = validateRow({ ...valid, Sex: "female" }, 0)
    expect(aliased.ok).toBe(true)
    if (aliased.ok) expect(aliased.row.gender).toBe("female")
  })

  it("accepts a provided script column, including aliases like VO", () => {
    const r1 = validateRow({ ...valid, script: "Pre-written voiceover." }, 0)
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.row.script).toBe("Pre-written voiceover.")

    const r2 = validateRow(
      { "Product Name": "Acme", Description: "x", CTA: "Buy", VO: "From VO column." },
      0
    )
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.row.script).toBe("From VO column.")
  })
})
