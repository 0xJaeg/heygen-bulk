import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { isUrl, loadRows, parseRows } from "./load.js"

describe("isUrl", () => {
  it("distinguishes URLs from file paths", () => {
    expect(isUrl("https://docs.google.com/spreadsheets/d/x/gviz/tq")).toBe(true)
    expect(isUrl("http://example.com/data.csv")).toBe(true)
    expect(isUrl("./data/products.csv")).toBe(false)
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
    const dir = await mkdtemp(join(tmpdir(), "loadrows-"))
    const csv = join(dir, "products.csv")
    await writeFile(
      csv,
      "product_name,description,call_to_action\nAcme,Great widget,Buy now\n"
    )
    const result = await loadRows(csv)
    expect(result.rows.length).toBe(1)
    expect(result.rows[0]!.product_name).toBe("Acme")
  })
})
