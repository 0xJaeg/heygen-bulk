import { describe, expect, it } from "vitest"
import { parseCsv } from "./parse.js"

describe("parseCsv", () => {
  it("parses headers and rows into keyed records", () => {
    const rows = parseCsv("product_name,price\nAcme,$9\nBeta,$12\n")
    expect(rows).toEqual([
      { product_name: "Acme", price: "$9" },
      { product_name: "Beta", price: "$12" },
    ])
  })

  it("strips a UTF-8 BOM from the first header (Google Sheets export)", () => {
    const rows = parseCsv("﻿product_name,description\nAcme,Great\n")
    expect(Object.keys(rows[0]!)).toContain("product_name")
    expect(Object.keys(rows[0]!)).not.toContain("﻿product_name")
  })

  it("skips empty lines", () => {
    const rows = parseCsv("a,b\n1,2\n\n3,4\n")
    expect(rows).toHaveLength(2)
  })
})
