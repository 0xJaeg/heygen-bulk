import { parse } from "csv-parse/sync"

export type RawRow = Record<string, string>

/** Parse CSV text into header-keyed records, stripping BOM and trimming. */
export function parseCsv(content: string): RawRow[] {
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as RawRow[]
}
