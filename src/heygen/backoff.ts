/** Geometric backoff delay (ms) for retry/poll attempt N, clamped to `max`. */
export function backoffMs(
  attempt: number,
  opts: { base: number; factor: number; max: number }
): number {
  const raw = opts.base * Math.pow(opts.factor, attempt)
  return Math.min(Math.round(raw), opts.max)
}
