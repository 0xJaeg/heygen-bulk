export type ErrorKind =
  | "rate_limited"
  | "credit_exhausted"
  | "transient"
  | "permanent"

const CREDIT_RE = /credit|insufficient|quota|balance/i

/** Classify a HeyGen failure so the engine knows whether to retry, back off, or stop. */
export function classifyError(input: {
  status?: number
  code?: number
  message?: string
}): ErrorKind {
  const { status, message } = input
  if (status === 429) return "rate_limited"
  if (message && CREDIT_RE.test(message)) return "credit_exhausted"
  if (status === undefined) return "transient" // network / timeout
  if (status >= 500) return "transient"
  return "permanent"
}

export class HeyGenApiError extends Error {
  readonly kind: ErrorKind
  readonly status?: number
  readonly code?: number

  constructor(
    message: string,
    opts: { status?: number; code?: number; kind: ErrorKind }
  ) {
    super(message)
    this.name = "HeyGenApiError"
    this.kind = opts.kind
    this.status = opts.status
    this.code = opts.code
  }
}
