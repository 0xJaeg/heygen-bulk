import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { ProductRow } from "../schema/row.js"
import type { PromoScript } from "./schema.js"

export type ScriptCacheKeyArgs = {
  model: string
  promptVersion: string
  row: ProductRow
  variationIndex: number
}

/**
 * Stable cache key over only the fields that affect the generated script.
 * Re-runs skip Claude entirely on a hit, so approved scripts never drift or
 * get re-billed. Render/engine fields (avatar_id, voice_id, ...) are excluded.
 */
export function scriptCacheKey(args: ScriptCacheKeyArgs): string {
  const { model, promptVersion, row, variationIndex } = args
  const material = JSON.stringify({
    model,
    promptVersion,
    variationIndex,
    product_name: row.product_name,
    description: row.description,
    call_to_action: row.call_to_action,
    key_benefits: row.key_benefits ?? null,
    price: row.price ?? null,
    target_audience: row.target_audience ?? null,
    tone: row.tone,
    language: row.language,
  })
  return createHash("sha256").update(material).digest("hex").slice(0, 32)
}

export interface CachedScript extends PromoScript {
  model: string
  promptVersion: string
}

/** Persistent file-backed script cache: one JSON file per key. */
export class FileScriptCache {
  constructor(private readonly dir: string) {}

  private path(key: string): string {
    return join(this.dir, `${key}.json`)
  }

  async get(key: string): Promise<CachedScript | null> {
    try {
      return JSON.parse(await readFile(this.path(key), "utf8")) as CachedScript
    } catch {
      return null
    }
  }

  async put(key: string, value: CachedScript): Promise<void> {
    const file = this.path(key)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(value, null, 2), "utf8")
  }
}
