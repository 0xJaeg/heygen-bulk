import "dotenv-flow/config"
import { z } from "zod/v4"
import type { Background } from "./heygen/types.js"

export type Engine = "v2" | "v3"
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
    /** HeyGen avatar framing: "normal" suits "(Upper Body)" avatars (natural medium shot). */
    avatarStyle?: string
    /** Avatar zoom (1 = native); a modest >1 makes the avatar taller to fill the 9:16 height. */
    avatarScale?: number
    /** Normalized translate (fraction of frame); positive y shifts the avatar down. */
    avatarOffset?: { x: number; y: number }
    /** Gaussian blur sigma applied to background images (depth-of-field look). 0 = off. */
    backgroundBlur?: number
    caption?: boolean
  }
  pools: {
    v2: {
      avatars: Record<Gender, string[]>
      voices: Record<Gender, string[]>
      formats: Orientation[]
      backgrounds?: Background[]
    }
    v3: { avatars: Record<Gender, string[]>; voices: Record<Gender, string[]> }
  }
  paths: { outputs: string; cache: string; ledger: string; backgrounds: string }
  costGuard: { warnAboveVideos: number; requireConfirmAboveVideos: number }
  heygen: { statusPathV2: string; pricePerMinuteUsd: Record<Engine, number> }
}

// Editable knobs + curated pool. Fill avatar/voice IDs after Phase 0 discovery
// (`npm run list-pool`). Per-row CSV values override these defaults.
export const config: AppConfig = {
  models: {
    script: "claude-haiku-4-5",
    qaScript: "claude-haiku-4-5",
  },
  scriptWordBudget: { target: 130, max: 140 },
  sampleSize: 3,
  rotation: "hash",
  defaults: {
    engine: "v2",
    orientation: "portrait",
    numVariations: 1,
    gender: "female",
    // "(Upper Body)" pool avatars (below) render at "normal" as a natural medium
    // shot filling the 9:16 width with the background edge-to-edge. avatarScale +
    // avatarOffset fill the frame *height*: scale (1.6) enlarges the avatar, and a
    // small downward offset.y (0.07) anchors it lower so the torso runs off the
    // BOTTOM edge (no desk/floor gap) while the head keeps headroom. Scaling alone
    // can't — a centered avatar crops the head at the top before the bottom fills.
    avatarStyle: "normal",
    avatarScale: 1.6,
    avatarOffset: { x: 0, y: 0.07 },
    backgroundBlur: 10, // soft depth-of-field blur on backgrounds
    caption: false,
  },
  pools: {
    v2: {
      // Assign avatars/voices by gender. Verify voice genders with `list-pool`.
      avatars: {
        // "(Upper Body)" looks — natural medium-shot framing that fills a 9:16
        // portrait at "normal" style. Swap in the teammate's brand avatars when
        // available (`npm run list-pool` to discover ids).
        female: [
          "Abigail_expressive_2024112501", // Abigail (Upper Body)
          "Aubrey_expressive_2024112701", // Aubrey (Upper Body)
        ],
        male: [
          "Marcus_expressive_2024120201", // Marcus (Upper Body)
          "francis_expressive_20240910", // Francis in Blazer (Upper Body)
        ],
      },
      voices: {
        // Custom brand voices have no gender metadata — these appear female
        // (confirmed via a sample). Verify the full set with the teammate.
        female: [
          "2823804c532c47a6945459cfb8b31df0", // John 5 tips Female
          "b2b8b2f48aa0490a9be65868483cd6c3", // Shocking Claim (confirmed female)
        ],
        // Placeholder standard male voice — swap for the teammate's male brand voice.
        male: [
          "88bb9ee1c81b466eb2a08fdde86d3619", // Adam Stone (standard, English, male)
        ],
      },
      formats: ["portrait"],
      // Placeholder brand background — replace with the teammate's actual
      // background once known (a brand image/video):
      //   { type: "image", url: "https://..." }  or  { type: "image", image_asset_id: "..." }
      //   { type: "video", url: "https://...", play_style: "loop" }
      // Add more entries to rotate backgrounds for variety.
      backgrounds: [{ type: "color", value: "#0B1F3A" }],
    },
    v3: {
      avatars: { female: [], male: [] },
      voices: { female: [], male: [] },
    },
  },
  paths: {
    outputs: "./outputs",
    cache: "./.cache",
    ledger: "./.data/runs.sqlite",
    // Drop background scene images here; each is uploaded to HeyGen once and
    // rotated across videos. Empty/absent → falls back to pools.v2.backgrounds.
    backgrounds: "./backgrounds",
  },
  costGuard: { warnAboveVideos: 50, requireConfirmAboveVideos: 200 },
  heygen: {
    // V2 status path is a config constant — docs show two variants and
    // v2/v3 video paths 404 for v2-created videos. Swap here if it changes.
    statusPathV2: "/v1/video_status.get",
    pricePerMinuteUsd: { v2: 1, v3: 2 },
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
