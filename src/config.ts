import "dotenv-flow/config"
import { z } from "zod/v4"

// "iv" = the Avatar IV/V photo-avatar path (POST /v3/videos), the default + workhorse;
// the tier (avatar_iv | avatar_v) is set by defaults.avatarEngine. "v3" = the opt-in
// video-agents auto-compose path.
export type Engine = "v3" | "iv"
export type Orientation = "portrait" | "landscape" | "square"
export type Gender = "male" | "female"

export interface AppConfig {
  models: { script: string }
  scriptWordBudget: { target: number; max: number }
  sampleSize: number
  rotation: "hash" | "round-robin"
  defaults: {
    engine: Engine
    orientation: Orientation
    gender?: Gender
    /** Avatar IV/V tier for the "iv" engine: "avatar_v" (newest) or "avatar_iv". */
    avatarEngine?: string
    /** Output resolution for the "iv" engine: "1080p" | "720p" | "4k". */
    resolution?: string
  }
  pools: {
    /** Shared photo-avatar pool (look ids + matched voices) for both engines. */
    iv: { avatars: Record<Gender, string[]>; voices: Record<Gender, string[]> }
  }
  paths: { outputs: string; cache: string; ledger: string }
  costGuard: { warnAboveVideos: number; requireConfirmAboveVideos: number }
  heygen: { pricePerMinuteUsd: Record<Engine, number> }
}

// Editable knobs + curated pool. Discover photo-avatar looks with `npm run pool`.
// Per-row CSV values override these defaults.
export const config: AppConfig = {
  models: {
    script: "claude-haiku-4-5",
  },
  scriptWordBudget: { target: 130, max: 140 },
  sampleSize: 3,
  // round-robin: each video in a run gets the next presenter in its gender pool, so
  // same-gender videos don't repeat a face until the pool is exhausted. ("hash" =
  // stable-per-product but may repeat.)
  rotation: "round-robin",
  defaults: {
    // "v3" = HeyGen Video Agent, auto-wrapped with the strict talking-head prompt
    // (clean spokesperson, no b-roll) — the team-approved "v3-strict" default, ~$2/min.
    // Set a row's engine to "iv" for an Avatar IV/V render with guaranteed-verbatim script.
    engine: "v3",
    avatarEngine: "avatar_v", // used only by the "iv" engine (avatar_iv ~3x faster)
    resolution: "1080p", // used only by the "iv" engine
    orientation: "portrait",
    gender: "female",
  },
  pools: {
    iv: {
      // Shared photo-avatar pool for BOTH engines (iv = Avatar IV/V, v3 = Video Agent),
      // portrait. avatars[gender][i] pairs with voices[gender][i] (each look's default
      // voice) — keep the arrays parallel. Public HeyGen stock looks, vetted via preview
      // for props/odd framing (dropped Gabrielle's coffee cup). Discover more with
      // `GET /v3/avatars/looks`; the account also has team-uploaded looks (give an id to add).
      avatars: {
        female: [
          "f20cdc89e0ec4b61bbe453d73019a997", // Madison
          "f594844a5f6c4167b525c9e2f5b07471", // Carolyn
          "f190ca47077d4d25b1c4d47ee76ef2d1", // Haley
          "1bb65853237846fa9c2532b1d6a4364d", // Caroline
          "a24b2fb875694b99af6a794daa64c5b0", // Laura
          "6e323eb9c26c46939f215f2cfb3df490", // Angelina
          "79814be5a46144bfa1150769b303409d", // Grace
          "42a55aec7e364065b9f54f62c6323b67", // Eleonor
          "362dc4299917463d9725436fb63fe244", // Veronica
          "74a183e3046643e9b4be1f22b16ecf04", // Caroline (2)
          "6a639a96236a4c7c8d4620877b08fd93", // Theresa
          "9c119e35b83c431b9070f2150ca37c6c", // Madisson
          "a167c8feb5704bbabd8b4fb709acf54d", // Mabel
          "74f017511acb45b483ff5ffba279a3d2", // Rose
          "c9930d2025da49bda6d6b2ea2515e86a", // Lisa
        ],
        male: [
          "fa0e2cddcbb3451cb24faf528ccb51ea", // Archer
          "fd8a431e7abf4fc5afa7adf79bf993bc", // Sebastian
          "f43dde9e24a74be5847991a685372dad", // Callum
          "f74540715e814dc6b988a72cf75f5623", // Tony
          "557353f2ee384dc29ea9e475852f01d8", // Kyle
          "c34f220efe9e4c4c9f90be6522f01c9b", // Allan
          "a82fa44154b84fbeac5c7f619ae2fecd", // Raul
          "35ddf60b9ebd41c2b3f1aa990f1e8c59", // Stephen
          "394a2c2d972b4327ba284d6824935414", // Thomas
          "61393d68375b44bc9248ecf17818c7b8", // Julian
          "0bf5d156bcfc428a9f28846ee63548a0", // Raul (2)
          "726708ac8f124419878786d33319cae2", // Brent
        ],
      },
      voices: {
        female: [
          "9e832936642b4277b639f283915a77e6", // Madison
          "8b43b00bd7f249ae8fa204b2a51d0f5a", // Carolyn
          "a3eb48d2cf3e4e02880556644e31bf35", // Haley
          "fb0de32da8c4499f9b6e27245b8794c1", // Caroline
          "fb0de32da8c4499f9b6e27245b8794c1", // Laura
          "fb0de32da8c4499f9b6e27245b8794c1", // Angelina
          "3cf45fc7f6e543ac8262db872d773ef5", // Grace
          "2abc10c1bf8d4e02b01b309e00061053", // Eleonor
          "56df45cd319c4fa2b1ff15d5c08dd47f", // Veronica
          "fb0de32da8c4499f9b6e27245b8794c1", // Caroline (2)
          "fb0de32da8c4499f9b6e27245b8794c1", // Theresa
          "631dd538c7164a0992ed90f56176fe79", // Madisson
          "5d05bed2a62c4bf586edd4d657e2454f", // Mabel
          "2abc10c1bf8d4e02b01b309e00061053", // Rose
          "9bfc54ad124e4e038c42d048fd17ab5f", // Lisa
        ],
        male: [
          "f6e122316c2543bd891dd5e50044ff60", // Archer
          "f79b2addf87f46cdaadac019ef24fd23", // Sebastian
          "be6197b8b1bd4c10a3a37ca72759343d", // Callum
          "15a161960c5c468cb4da4838fd561e0c", // Tony
          "9cfe3785136147ea967c7632f52c8788", // Kyle
          "2134c0146ee045c7979a8e946e516a59", // Allan
          "453c20e1525a429080e2ad9e4b26f2cd", // Raul
          "a8fc4e3e29c84700bcb6a74ec68da7ab", // Stephen
          "9cfe3785136147ea967c7632f52c8788", // Thomas
          "3f72c69272ce4f46bdb7fd506643381e", // Julian
          "938c77c390b3453eb15993c08a6369ee", // Raul (2)
          "15a161960c5c468cb4da4838fd561e0c", // Brent
        ],
      },
    },
  },
  paths: {
    outputs: "./outputs",
    cache: "./.cache",
    ledger: "./.data/runs.sqlite",
  },
  costGuard: { warnAboveVideos: 50, requireConfirmAboveVideos: 200 },
  heygen: {
    // USD per minute of rendered video, by engine. Per HeyGen's published API pricing
    // (PAYG, 2026): `iv` photo avatars (avatar_iv AND avatar_v — same price; V is just
    // slower to render) ≈ $3/min at 1080p ($4/min at 4K — not reflected here, see
    // estimateCost); `v3` Video Agent ≈ $2/min. CONFIRM your exact $/min on the HeyGen
    // dashboard before any large run — pricing moved to USD PAYG in Feb 2026.
    pricePerMinuteUsd: { v3: 2, iv: 3 },
  },
}

const EnvSchema = z.object({
  // Optional: only needed to *generate* a script for a row that has no `script`.
  // With provided scripts (the default workflow), no Anthropic key is required.
  ANTHROPIC_API_KEY: z.string().default(""),
  // Optional here so `dry-run` (scripts only) works without it; commands that
  // call HeyGen check for it explicitly.
  HEYGEN_API_KEY: z.string().default(""),
  HEYGEN_BASE_URL: z.string().min(1).default("https://api.heygen.com"),
  MAX_CONCURRENCY: z.coerce.number().int().min(1).default(3),
})

export type Env = z.infer<typeof EnvSchema>

let cachedEnv: Env | undefined

/** Validate process.env once and cache it. Throws a readable error if invalid. */
export function loadEnv(): Env {
  if (cachedEnv) return cachedEnv
  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n")
    throw new Error(`Invalid environment:\n${issues}`)
  }
  cachedEnv = parsed.data
  return cachedEnv
}
