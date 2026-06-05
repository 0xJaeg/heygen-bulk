import type { AppConfig } from "../config.js"
import type { ProductRow } from "../schema/row.js"

/** Total videos a run will produce (sum of variations across non-skipped rows). */
export function plannedVideoCount(rows: ProductRow[]): number {
  return rows.reduce((n, r) => n + (r.skip ? 0 : r.num_variations), 0)
}

export type GuardLevel = "ok" | "warn" | "confirm"

/** Decide whether a run is fine, should warn, or needs explicit confirmation. */
export function guardLevel(
  videoCount: number,
  guard: AppConfig["costGuard"]
): GuardLevel {
  if (videoCount > guard.requireConfirmAboveVideos) return "confirm"
  if (videoCount > guard.warnAboveVideos) return "warn"
  return "ok"
}

/** Rough HeyGen credit cost for a run, in USD. */
export function estimateCreditUsd(
  videoCount: number,
  avgDurationSec: number,
  pricePerMinuteUsd: number
): number {
  return videoCount * (avgDurationSec / 60) * pricePerMinuteUsd
}
