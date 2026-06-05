import { readFile } from "node:fs/promises"
import { type ProductRow, validateRow } from "../schema/row.js"
import { parseCsv } from "./parse.js"

export type RowError = { index: number; issues: string[] }

export type ParseResult = {
  rows: ProductRow[]
  errors: RowError[]
  skipped: number
}

/** A source is a remote URL (published Google Sheet) if it starts with http(s). */
export function isUrl(source: string): boolean {
  return /^https?:\/\//i.test(source)
}

/** Parse + validate CSV content: valid non-skipped rows, errors, skipped count. */
export function parseRows(content: string): ParseResult {
  const records = parseCsv(content)
  const rows: ProductRow[] = []
  const errors: RowError[] = []
  let skipped = 0
  records.forEach((record, index) => {
    const result = validateRow(record, index)
    if (!result.ok) {
      errors.push({ index: result.index, issues: result.issues })
      return
    }
    if (result.row.skip) {
      skipped++
      return
    }
    rows.push(result.row)
  })
  return { rows, errors, skipped }
}

/** Read raw CSV bytes from a local file path or a published-CSV URL. */
export async function readSource(source: string): Promise<string> {
  if (isUrl(source)) {
    const res = await fetch(source)
    if (!res.ok) {
      throw new Error(`Failed to fetch source (HTTP ${res.status}): ${source}`)
    }
    return res.text()
  }
  return readFile(source, "utf8")
}

/** Load and validate product rows from a CSV file or published-CSV URL. */
export async function loadRows(source: string): Promise<ParseResult> {
  return parseRows(await readSource(source))
}
