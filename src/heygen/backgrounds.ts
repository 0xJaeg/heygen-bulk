import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, extname, join } from "node:path"
import type { Background } from "./types.js"

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
}

interface Uploader {
  uploadAsset(bytes: Uint8Array, contentType: string): Promise<string>
}

async function readCache(path: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, string>
  } catch {
    return {}
  }
}

/**
 * Load every image in `dir` as a HeyGen image background. Each image is uploaded
 * once (keyed by content hash → asset id, cached at `cachePath`) so re-runs don't
 * re-upload. Returns an ordered list to rotate across videos. Empty if no dir.
 */
export async function loadBackgrounds(opts: {
  dir: string
  client: Uploader
  cachePath: string
  /** Cover-crop each image to this size before upload (so any source fills the frame). */
  target?: { width: number; height: number }
  resize?: (
    bytes: Uint8Array,
    width: number,
    height: number
  ) => Promise<Uint8Array>
  /** Appended to the cache key so changing processing (e.g. blur) re-uploads. */
  processTag?: string
}): Promise<Background[]> {
  let files: string[]
  try {
    files = (await readdir(opts.dir))
      .filter((f) => extname(f).toLowerCase() in MIME)
      .sort()
  } catch {
    return []
  }
  if (files.length === 0) return []

  const cache = await readCache(opts.cachePath)
  const backgrounds: Background[] = []
  let changed = false
  const tag =
    (opts.target ? `:${opts.target.width}x${opts.target.height}` : "") +
    (opts.processTag ?? "")

  for (const file of files) {
    const original = await readFile(join(opts.dir, file))
    const key = createHash("sha1").update(original).digest("hex") + tag
    let assetId = cache[key]
    if (!assetId) {
      let bytes: Uint8Array = original
      let contentType = MIME[extname(file).toLowerCase()] ?? "image/png"
      if (opts.target && opts.resize) {
        try {
          bytes = await opts.resize(original, opts.target.width, opts.target.height)
          contentType = "image/png"
        } catch {
          // resize unavailable / bad image — upload the original as-is
        }
      }
      assetId = await opts.client.uploadAsset(bytes, contentType)
      cache[key] = assetId
      changed = true
    }
    backgrounds.push({ type: "image", image_asset_id: assetId })
  }

  if (changed) {
    await mkdir(dirname(opts.cachePath), { recursive: true })
    await writeFile(opts.cachePath, JSON.stringify(cache, null, 2), "utf8")
  }
  return backgrounds
}
