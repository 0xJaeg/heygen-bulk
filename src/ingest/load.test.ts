import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { isUrl, loadRows, parseRows } from "./load.js"

const here = dirname(fileURLToPath(import.meta.url))
const sampleCsv = join(here, "../../examples/products.sample.csv")

describe("isUrl", () => {
  it("distinguishes URLs from file paths", () => {
    expect(isUrl("https://docs.google.com/spreadsheets/d/x/gviz/tq")).toBe(true)
    expect(isUrl("http://example.com/data.csv")).toBe(true)
    expect(isUrl("./examples/products.sample.csv")).toBe(false)
    expect(isUrl("/abs/path/products.csv")).toBe(false)
  })
})

describe("parseRows", () => {
  it("returns valid rows, collects errors, and counts skipped", () => {
    const csv =
      "product_name,description,call_to_action,skip\n" +
      "Acme,Great widget,Buy now,false\n" +
      "Beta,,Buy now,false\n" +
      "Gamma,Nice product,Buy now,true\n"
    const result = parseRows(csv)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]!.product_name).toBe("Acme")
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.index).toBe(1)
    expect(result.skipped).toBe(1)
  })
})

describe("loadRows", () => {
  it("loads rows from a local CSV file", async () => {
    const result = await loadRows(sampleCsv)
    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.rows[0]!.product_name).toBeTruthy()
  })
})
