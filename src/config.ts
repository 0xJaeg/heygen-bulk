import "dotenv-flow/config"
import { z } from "zod/v4"

// "iv" = the Avatar IV/V photo-avatar path (POST /v3/videos), the default + workhorse;
// the tier (avatar_iv | avatar_v) is set by defaults.avatarEngine. "v3" = the opt-in
// video-agents auto-compose path.
export type Engine = "v3" | "iv"
export type Orientation = "portrait" | "landscape" | "square"
export type Gender = "male" | "female"

export interface AppConfig {
  models: { script: string; qaScript: string }
  scriptWordBudget: { target: number; max: number }
  sampleSize: number
  rotation: "hash" | "round-robin"
  defaults: {
    engine: Engine
    orientation: Orientation
    numVariations: number
    gender?: Gender
    /** Avatar IV/V tier for the "iv" engine: "avatar_v" (newest) or "avatar_iv". */
    avatarEngine?: string
    /** Output resolution for the "iv" engine: "1080p" | "720p" | "4k". */
    resolution?: string
  }
  pools: {
    v3: { avatars: Record<Gender, string[]>; voices: Record<Gender, string[]> }
    /** Photo-avatar look ids + voices for the "iv" (Avatar IV/V) path. */
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
    qaScript: "claude-haiku-4-5",
  },
  scriptWordBudget: { target: 130, max: 140 },
  sampleSize: 3,
  rotation: "hash",
  defaults: {
    engine: "iv", // Avatar IV/V photo-avatar path (POST /v3/videos) — photorealistic
    avatarEngine: "avatar_v", // newest tier; "avatar_iv" is ~3x faster, near-identical quality
    resolution: "1080p",
    orientation: "portrait",
    numVariations: 1,
    gender: "female",
  },
  pools: {
    v3: {
      avatars: { female: [], male: [] },
      voices: { female: [], male: [] },
    },
    iv: {
      // HeyGen photo avatars (Avatar IV/V), portrait 1080x1920. avatars[gender][i]
      // is paired with voices[gender][i] (the avatar's matched default voice) — keep
      // the arrays parallel. Vet looks for props/context (e.g. a held mic + TV logo)
      // before adding; `npm run pool` lists more; swap in brand avatars later.
      avatars: {
        female: [
          "f20cdc89e0ec4b61bbe453d73019a997", // Madison
          "f594844a5f6c4167b525c9e2f5b07471", // Carolyn
          "f95484e160dd46d49bd3eff27a70efa0", // Gabrielle
          "f190ca47077d4d25b1c4d47ee76ef2d1", // Haley
        ],
        male: [
          "fa0e2cddcbb3451cb24faf528ccb51ea", // Archer
          "fd8a431e7abf4fc5afa7adf79bf993bc", // Sebastian
          "f43dde9e24a74be5847991a685372dad", // Callum
        ],
      },
      voices: {
        female: [
          "9e832936642b4277b639f283915a77e6", // Madison
          "8b43b00bd7f249ae8fa204b2a51d0f5a", // Carolyn
          "ca320fd62b784352af74d06a16a6ef3d", // Gabrielle
          "a3eb48d2cf3e4e02880556644e31bf35", // Haley
        ],
        male: [
          "f6e122316c2543bd891dd5e50044ff60", // Archer
          "f79b2addf87f46cdaadac019ef24fd23", // Sebastian
          "be6197b8b1bd4c10a3a37ca72759343d", // Callum
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
    // HeyGen meters BOTH avatar_iv and avatar_v at 20 credits/min (per HeyGen docs;
    // engine choice does NOT change cost — avatar_v is just slower to render). iv
    // USD/min here is a PLACEHOLDER — set it from your plan's credit→$ price, and
    // confirm actual consumption on the HeyGen dashboard before a big run.
    pricePerMinuteUsd: { v3: 2, iv: 4 },
  },
}

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "Missing ANTHROPIC_API_KEY"),
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
