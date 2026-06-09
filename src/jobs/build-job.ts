import { createHash } from "node:crypto"
import type { AppConfig, Engine, Gender, Orientation } from "../config.js"
import type { ProductRow } from "../schema/row.js"
import type { PromoScript } from "../script/schema.js"

export interface JobSpec {
  jobId: string
  productId: string
  variationIndex: number
  engine: Engine
  gender: Gender
  orientation: Orientation
  width: number
  height: number
  avatarId?: string
  voiceId?: string
  /** Avatar IV/V ("iv" engine) output controls. */
  aspectRatio?: string
  resolution?: string
  avatarEngine?: string
  /** Spoken script text (the iv avatar's script, or the v3 agent prompt). */
  script: string
  title: string
}

export type BuildJobResult =
  | { ok: true; spec: JobSpec }
  | { ok: false; productId: string; variationIndex: number; reason: string }

const DIMENSIONS: Record<Orientation, { width: number; height: number }> = {
  portrait: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
}

/** HeyGen aspect_ratio string per orientation (used by the "iv" engine). */
const ASPECT: Record<Orientation, string> = {
  portrait: "9:16",
  landscape: "16:9",
  square: "1:1",
}

/**
 * A row's stable identity: explicit row_id, else a hash of everything that changes
 * the rendered video — the content (product_name + description + provided script)
 * and who-says-it-how (gender selects the avatar/voice pool; explicit avatar/voice
 * overrides; orientation sets framing). Engine is folded in by stableJobId.
 *
 * Without this, rows that share a product_name — five testimonials for one offer, or
 * one script cast in both genders — collapse to a single job and the extras are
 * silently dropped as duplicates. Byte-identical rows still collide, so re-runs stay
 * idempotent (a completed job isn't re-charged).
 */
export function productKey(row: ProductRow): string {
  if (row.row_id) return row.row_id
  const parts = [
    row.product_name,
    row.description ?? "",
    row.script ?? "",
    row.gender ?? "",
    row.orientation ?? "",
    row.avatar_id ?? "",
    row.voice_id ?? "",
  ]
  const h = createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 12)
  return `p_${h}`
}

/** Deterministic job id so re-runs reproduce the same job (and skip completed ones). */
export function stableJobId(
  productId: string,
  variationIndex: number,
  engine: string
): string {
  return createHash("sha1")
    .update(`${productId}:${variationIndex}:${engine}`)
    .digest("hex")
    .slice(0, 16)
}

/** Seeded, reproducible index into a list of length `len` (−1 when empty). */
export function seededIndex(len: number, seed: string): number {
  if (len === 0) return -1
  const n = createHash("sha1").update(seed).digest().readUInt32BE(0)
  return n % len
}

/** Seeded, reproducible choice from a pool. Returns undefined for an empty pool. */
export function pickFromPool<T>(items: readonly T[], seed: string): T | undefined {
  const i = seededIndex(items.length, seed)
  return i < 0 ? undefined : items[i]
}

/**
 * Resolve a product row + script into a HeyGen job spec.
 * Precedence per field: explicit row override -> pool rotation -> config default.
 * Pool rotation is either seeded-by-hash (stable per product, may repeat) or, when
 * `config.rotation === "round-robin"` and the caller passes a `rotationIndex`, the
 * next slot in the pool (distinct presenters within a run — the caller owns the
 * per-gender counter). Fails (no credit spent) when an "iv" job has no avatar/voice.
 */
export function buildJobSpec(args: {
  row: ProductRow
  script: PromoScript
  variationIndex: number
  config: AppConfig
  /** Round-robin position among same-gender pool-rotation rows (caller-supplied). */
  rotationIndex?: number
}): BuildJobResult {
  const { row, script, variationIndex, config, rotationIndex } = args
  const productId = productKey(row)
  const engine: Engine = row.engine ?? config.defaults.engine
  const jobId = stableJobId(productId, variationIndex, engine)

  const isIv = engine === "iv"
  const pool = isIv ? config.pools.iv : config.pools.v3
  const gender: Gender = row.gender ?? config.defaults.gender ?? "female"
  const orientation: Orientation = row.orientation ?? config.defaults.orientation
  const dims = DIMENSIONS[orientation]

  // "iv" pairs avatar[i] with its matched voice[i] (parallel arrays); v3 picks
  // avatar and voice independently (and tolerates an empty pool — the agent auto-selects).
  let avatarId: string | undefined
  let voiceId: string | undefined
  if (isIv) {
    const len = pool.avatars[gender].length
    let i: number
    if (config.rotation === "round-robin" && rotationIndex != null) {
      i = len === 0 ? -1 : rotationIndex % len
    } else {
      i = seededIndex(len, `${jobId}:iv`)
    }
    avatarId = row.avatar_id ?? (i < 0 ? undefined : pool.avatars[gender][i])
    voiceId = row.voice_id ?? (i < 0 ? undefined : pool.voices[gender][i])
  } else {
    avatarId = row.avatar_id ?? pickFromPool(pool.avatars[gender], `${jobId}:avatar`)
    voiceId = row.voice_id ?? pickFromPool(pool.voices[gender], `${jobId}:voice`)
  }

  if (isIv && (!avatarId || !voiceId)) {
    return {
      ok: false,
      productId,
      variationIndex,
      reason:
        "iv job needs an avatar and a voice, but none was provided and the pool is empty",
    }
  }

  return {
    ok: true,
    spec: {
      jobId,
      productId,
      variationIndex,
      engine,
      gender,
      orientation,
      width: dims.width,
      height: dims.height,
      avatarId,
      voiceId,
      // Avatar IV/V output controls (iv path only).
      aspectRatio: isIv ? ASPECT[orientation] : undefined,
      resolution: isIv ? config.defaults.resolution : undefined,
      avatarEngine: isIv ? config.defaults.avatarEngine : undefined,
      script: script.script,
      title: script.title,
    },
  }
}
