import { createHash } from "node:crypto"
import type { AppConfig, Engine, Gender, Orientation } from "../config.js"
import type { Background } from "../heygen/types.js"
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
  avatarStyle?: string
  avatarScale?: number
  avatarOffset?: { x: number; y: number }
  background?: Background
  /** Avatar IV/V ("iv" engine) output controls. */
  aspectRatio?: string
  resolution?: string
  avatarEngine?: string
  caption?: boolean
  /** Spoken script text (used as V2 input_text, or the V3 agent prompt). */
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

/** A row's stable identity: explicit row_id, else a hash of its grounding fields. */
export function productKey(row: ProductRow): string {
  if (row.row_id) return row.row_id
  const h = createHash("sha1")
    .update(`${row.product_name}|${row.description ?? ""}`)
    .digest("hex")
    .slice(0, 12)
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
 * Precedence per field: explicit row override -> seeded pool rotation -> config default.
 * Fails (without spending a credit) when a V2 job has no avatar/voice available.
 */
export function buildJobSpec(args: {
  row: ProductRow
  script: PromoScript
  variationIndex: number
  config: AppConfig
}): BuildJobResult {
  const { row, script, variationIndex, config } = args
  const productId = productKey(row)
  const engine: Engine = row.engine ?? config.defaults.engine
  const jobId = stableJobId(productId, variationIndex, engine)

  const isIv = engine === "iv"
  const pool =
    engine === "iv"
      ? config.pools.iv
      : engine === "v3"
        ? config.pools.v3
        : config.pools.v2
  const gender: Gender = row.gender ?? config.defaults.gender ?? "female"
  const orientation: Orientation =
    row.orientation ??
    pickFromPool(config.pools.v2.formats, `${jobId}:fmt`) ??
    config.defaults.orientation
  const dims = DIMENSIONS[orientation]

  // "iv" pairs avatar[i] with its matched voice[i] (parallel arrays); v2/v3 pick
  // avatar and voice independently.
  let avatarId: string | undefined
  let voiceId: string | undefined
  if (isIv) {
    const i = seededIndex(pool.avatars[gender].length, `${jobId}:iv`)
    avatarId = row.avatar_id ?? (i < 0 ? undefined : pool.avatars[gender][i])
    voiceId = row.voice_id ?? (i < 0 ? undefined : pool.voices[gender][i])
  } else {
    avatarId = row.avatar_id ?? pickFromPool(pool.avatars[gender], `${jobId}:avatar`)
    voiceId = row.voice_id ?? pickFromPool(pool.voices[gender], `${jobId}:voice`)
  }

  if ((engine === "v2" || isIv) && (!avatarId || !voiceId)) {
    return {
      ok: false,
      productId,
      variationIndex,
      reason: `${engine} job needs an avatar and a voice, but none was provided and the pool is empty`,
    }
  }

  const caption = config.defaults.caption ?? false
  const background =
    engine === "v2"
      ? pickFromPool(config.pools.v2.backgrounds ?? [], `${jobId}:bg`)
      : undefined

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
      // Studio-avatar (v2) framing — omitted for the iv photo-avatar path.
      avatarStyle: isIv ? undefined : config.defaults.avatarStyle,
      avatarScale: isIv ? undefined : config.defaults.avatarScale,
      avatarOffset: isIv ? undefined : config.defaults.avatarOffset,
      background,
      // Avatar IV/V output controls (iv path only).
      aspectRatio: isIv ? ASPECT[orientation] : undefined,
      resolution: isIv ? config.defaults.resolution : undefined,
      avatarEngine: isIv ? config.defaults.avatarEngine : undefined,
      caption,
      script: script.script,
      title: script.title,
    },
  }
}
