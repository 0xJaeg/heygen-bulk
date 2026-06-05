import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * Build a downloader that streams a finished MP4 to `${dir}/${basename}`.
 * HeyGen download URLs expire (~7 days), so the engine downloads immediately on
 * completion. MP4s are small (<60s), so buffering in memory is fine.
 */
export function makeFileDownloader(dir: string, fetchImpl: typeof fetch = fetch) {
  return async (url: string, basename: string): Promise<string> => {
    const res = await fetchImpl(url)
    if (!res.ok) {
      throw new Error(`download failed (HTTP ${res.status}) for ${url}`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    await mkdir(dir, { recursive: true })
    const dest = join(dir, basename)
    await writeFile(dest, buf)
    return dest
  }
}
