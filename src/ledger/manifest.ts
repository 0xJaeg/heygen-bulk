import { mkdir, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"

export interface ManifestEntry {
  product_id: string
  variation_index: number
  engine: string
  avatar_id?: string | null
  voice_id?: string | null
  status: string
  hook?: string
  script?: string
  title?: string | null
  video_url?: string | null
  local_path?: string | null
  duration_sec?: number | null
  est_cost_usd?: number | null
  failure?: string | null
}

export interface RunManifest {
  run_id: string
  mode: string
  created_at: string
  totals: {
    completed: number
    failed: number
    skipped: number
    est_cost_usd: number
  }
  entries: ManifestEntry[]
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Render a self-contained HTML review page for a run (the QA artifact). */
export function renderIndexHtml(manifest: RunManifest): string {
  const cards = manifest.entries
    .map(
      (e) => `
    <div class="card">
      <h2>${esc(e.title ?? e.product_id)} <span class="status ${esc(e.status)}">${esc(e.status)}</span></h2>
      <p class="meta">${esc(e.engine)} · ${esc(e.avatar_id ?? "—")} / ${esc(e.voice_id ?? "—")} · ${e.duration_sec ?? "?"}s · $${(e.est_cost_usd ?? 0).toFixed(2)}</p>
      ${e.local_path ? `<video controls width="320" src="${esc(basename(e.local_path))}"></video>` : ""}
      ${e.hook ? `<p class="hook"><strong>${esc(e.hook)}</strong></p>` : ""}
      <p class="script">${esc(e.script ?? "")}</p>
      ${e.failure ? `<p class="failure">${esc(e.failure)}</p>` : ""}
    </div>`
    )
    .join("\n")

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Promo videos — ${esc(manifest.run_id)}</title>
<style>
  body{font-family:system-ui,sans-serif;margin:2rem;background:#faf9f7;color:#222}
  .card{border:1px solid #e2ddd5;border-radius:10px;padding:1rem 1.25rem;margin:1rem 0;background:#fff}
  .status{font-size:.7rem;padding:.1rem .55rem;border-radius:99px;background:#eee;vertical-align:middle}
  .status.completed{background:#d8f5d8}.status.failed{background:#f5d8d8}
  .meta{color:#666;font-size:.85rem}
  .script{white-space:pre-wrap;line-height:1.5}
  .failure{color:#a00}
  video{border-radius:8px;margin:.5rem 0}
</style></head><body>
<h1>Promo videos — ${esc(manifest.mode)} run</h1>
<p>${manifest.totals.completed} completed · ${manifest.totals.failed} failed · ${manifest.totals.skipped} skipped · $${manifest.totals.est_cost_usd.toFixed(2)} est. cost</p>
${cards}
</body></html>`
}

/** Write manifest.json + index.html into a run directory. */
export async function writeRun(
  dir: string,
  manifest: RunManifest
): Promise<{ manifestPath: string; indexPath: string }> {
  await mkdir(dir, { recursive: true })
  const manifestPath = join(dir, "manifest.json")
  const indexPath = join(dir, "index.html")
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8")
  await writeFile(indexPath, renderIndexHtml(manifest), "utf8")
  return { manifestPath, indexPath }
}
