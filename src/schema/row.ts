import { z } from "zod/v4"

export const ENGINES = ["v3", "iv"] as const
export const ORIENTATIONS = ["portrait", "landscape", "square"] as const
export const TONES = [
  "energetic",
  "professional",
  "friendly",
  "luxury",
  "playful",
] as const

/** Map "true"/"false"/"yes"/"1" CSV strings to real booleans (Boolean("false") is true). */
const csvBoolean = z.preprocess((v) => {
  if (typeof v === "boolean") return v
  if (typeof v !== "string") return undefined
  const s = v.trim().toLowerCase()
  if (["true", "1", "yes", "y"].includes(s)) return true
  if (["false", "0", "no", "n"].includes(s)) return false
  return v // leave invalid value for zod to flag
}, z.boolean())

/** Normalize gender cells: M/Male/Man -> male; F/Female/Woman -> female. */
const csvGender = z.preprocess((v) => {
  if (typeof v !== "string") return v
  const s = v.trim().toLowerCase()
  if (["m", "male", "man"].includes(s)) return "male"
  if (["f", "female", "woman"].includes(s)) return "female"
  return s
}, z.enum(["male", "female"]))

export const ProductRowSchema = z.object({
  // identity / idempotency
  row_id: z.string().trim().min(1).optional(),
  // required — needed to write a grounded promo
  product_name: z.string().trim().min(1),
  // Pre-written voiceover — if present, used verbatim (Claude is skipped).
  script: z.string().trim().min(1).optional(),
  // Required only when no script is provided (see refine below).
  description: z.string().trim().min(1).optional(),
  call_to_action: z.string().trim().min(1).optional(),
  // optional content
  key_benefits: z.string().trim().optional(),
  price: z.string().trim().optional(),
  target_audience: z.string().trim().optional(),
  tone: z.enum(TONES).default("energetic"),
  language: z.string().trim().default("en"),
  // per-row engine / render overrides (else defaults + pool rotation)
  engine: z.enum(ENGINES).optional(),
  gender: csvGender.optional(),
  avatar_id: z.string().trim().optional(),
  voice_id: z.string().trim().optional(),
  orientation: z.enum(ORIENTATIONS).optional(),
  num_variations: z.coerce.number().int().min(1).max(5).default(1),
  // escape hatch: skip a row without deleting it
  skip: csvBoolean.default(false),
}).refine(
  (r) => Boolean(r.script) || (Boolean(r.description) && Boolean(r.call_to_action)),
  {
    message:
      "description and call_to_action are required unless a script is provided",
    path: ["call_to_action"],
  }
)

export type ProductRow = z.infer<typeof ProductRowSchema>

export type ValidateResult =
  | { ok: true; row: ProductRow }
  | { ok: false; index: number; issues: string[] }

// Human header -> canonical field. Keys are normalized (see normKey).
const HEADER_ALIASES: Record<string, string> = invert({
  row_id: ["row id", "id", "row_id", "sku"],
  product_name: ["product name", "product", "name", "title", "product_name"],
  description: ["description", "desc", "about"],
  call_to_action: ["call to action", "cta", "call_to_action"],
  script: ["script", "vo", "voiceover", "voice over", "vsl", "talking script"],
  key_benefits: ["key benefits", "benefits", "features", "key_benefits"],
  price: ["price", "cost"],
  target_audience: ["target audience", "audience", "target", "target_audience"],
  tone: ["tone", "style"],
  language: ["language", "lang"],
  engine: ["engine"],
  avatar_id: ["avatar id", "avatar", "avatar_id"],
  voice_id: ["voice id", "voice", "voice_id"],
  gender: ["gender", "sex"],
  orientation: ["orientation", "format", "aspect"],
  num_variations: ["num variations", "variations", "num_variations", "count"],
  skip: ["skip", "disabled"],
})

function normKey(k: string): string {
  return k.trim().toLowerCase().replace(/[\s-]+/g, " ")
}

function invert(map: Record<string, string[]>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [canonical, variants] of Object.entries(map)) {
    for (const variant of variants) out[normKey(variant)] = canonical
  }
  return out
}

/**
 * Map arbitrary CSV headers to canonical fields, trim values, and drop empty
 * cells so optionals/defaults apply uniformly. Unknown columns pass through
 * (and are stripped by the schema).
 */
export function normalizeRow(
  raw: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    const canonical = HEADER_ALIASES[normKey(k)] ?? normKey(k).replace(/ /g, "_")
    const value = typeof v === "string" ? v.trim() : v
    if (value === "" || value == null) continue
    out[canonical] = value
  }
  return out
}

/** Validate one raw CSV row into a typed ProductRow, collecting issues. */
export function validateRow(
  raw: Record<string, string>,
  index: number
): ValidateResult {
  const parsed = ProductRowSchema.safeParse(normalizeRow(raw))
  if (parsed.success) return { ok: true, row: parsed.data }
  const issues = parsed.error.issues.map(
    (i) => `${i.path.join(".") || "(row)"}: ${i.message}`
  )
  return { ok: false, index, issues }
}
