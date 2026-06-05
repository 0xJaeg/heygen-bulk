import "dotenv-flow/config"
import { z } from "zod/v4"

export type Engine = "v2" | "v3"
export type Orientation = "portrait" | "landscape" | "square"

export interface AppConfig {
  models: { script: string; qaScript: string }
  scriptWordBudget: { target: number; max: number }
  sampleSize: number
  rotation: "hash" | "round-robin"
  defaults: { engine: Engine; orientation: Orientation; numVariations: number }
  pools: {
    v2: { avatars: string[]; voices: string[]; formats: Orientation[] }
    v3: { avatars: string[]; voices: string[] }
  }
  paths: { outputs: string; cache: string; ledger: string }
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
  defaults: { engine: "v2", orientation: "portrait", numVariations: 1 },
  pools: {
    v2: {
      // Starter pool — edit freely (run `list-pool` to see all options).
      avatars: [
        "Abigail_expressive_2024112501", // Abigail (Upper Body)
        "Aditya_public_1", // Aditya in Blue blazer
        "Adriana_Business_Front_public", // Adriana Business Front
      ],
      voices: [
        "331f8b8067e74485a192275ae5e834bf", // Personal Story
        "b2b8b2f48aa0490a9be65868483cd6c3", // Shocking Claim
        "2823804c532c47a6945459cfb8b31df0", // John 5 tips Female
      ],
      formats: ["portrait"],
    },
    v3: { avatars: [], voices: [] },
  },
  paths: {
    outputs: "./outputs",
    cache: "./.cache",
    ledger: "./.data/runs.sqlite",
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
