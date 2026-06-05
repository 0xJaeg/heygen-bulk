import type Anthropic from "@anthropic-ai/sdk"
import { describe, expect, it, vi } from "vitest"
import type { AppConfig } from "../config.js"
import type { HeyGenClient } from "../heygen/client.js"
import { type CachedScript, scriptCacheKey } from "../script/cache.js"
import { PROMPT_VERSION } from "../script/prompt.js"
import type { ProductRow } from "../schema/row.js"
import { JobStore } from "../store/job-store.js"
import { runPipeline } from "./run.js"

function makeConfig(over: Partial<AppConfig> = {}): AppConfig {
  return {
    models: { script: "m", qaScript: "m" },
    scriptWordBudget: { target: 130, max: 140 },
    sampleSize: 3,
    rotation: "hash",
    defaults: { engine: "v2", orientation: "portrait", numVariations: 1 },
    pools: {
      v2: { avatars: ["av_a"], voices: ["vo_a"], formats: ["portrait"] },
      v3: { avatars: [], voices: [] },
    },
    paths: { outputs: "./outputs", cache: "./.cache", ledger: ":memory:" },
    costGuard: { warnAboveVideos: 50, requireConfirmAboveVideos: 200 },
    heygen: {
      statusPathV2: "/v1/video_status.get",
      pricePerMinuteUsd: { v2: 1, v3: 2 },
    },
    ...over,
  }
}

const row = (over: Partial<ProductRow> = {}): ProductRow => ({
  product_name: "Acme",
  description: "A widget.",
  call_to_action: "Buy now",
  tone: "energetic",
  language: "en",
  num_variations: 1,
  skip: false,
  ...over,
})

function fakeCache(seed: Record<string, CachedScript> = {}) {
  const map = new Map<string, CachedScript>(Object.entries(seed))
  return {
    map,
    get: async (k: string) => map.get(k) ?? null,
    put: async (k: string, v: CachedScript) => {
      map.set(k, v)
    },
  }
}

function mocks() {
  const parse = vi.fn(async () => ({
    parsed_output: { hook: "H", script: "Generated.", title: "T" },
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  }))
  const createV2 = vi.fn(async () => "vid")
  const getStatusV2 = vi.fn(async () => ({
    state: "completed",
    videoUrl: "http://x/v.mp4",
    durationSec: 30,
    failure: null,
  }))
  return {
    parse,
    createV2,
    getStatusV2,
    anthropic: { messages: { parse } } as unknown as Anthropic,
    client: { createV2, getStatusV2 } as unknown as HeyGenClient,
  }
}

const io = () => ({
  download: vi.fn(async () => "/out/p.mp4"),
  sleep: vi.fn(async () => undefined),
})

describe("runPipeline", () => {
  it("generates a script, builds a spec, runs the engine, returns a completed entry", async () => {
    const { anthropic, client, createV2 } = mocks()
    const store = new JobStore(":memory:")
    const res = await runPipeline(
      { rows: [row()], runId: "run1", config: makeConfig(), model: "m", concurrency: 2 },
      { anthropic, client, store, cache: fakeCache(), ...io() }
    )
    expect(res.entries).toHaveLength(1)
    expect(res.entries[0]!.status).toBe("completed")
    expect(res.entries[0]!.script).toBe("Generated.")
    expect(res.totals.completed).toBe(1)
    expect(res.totals.est_cost_usd).toBeGreaterThan(0)
    expect(createV2).toHaveBeenCalledTimes(1)
    store.close()
  })

  it("reuses a cached script without calling Anthropic", async () => {
    const { anthropic, client, parse } = mocks()
    const store = new JobStore(":memory:")
    const r = row()
    const key = scriptCacheKey({
      model: "m",
      promptVersion: PROMPT_VERSION,
      row: r,
      variationIndex: 0,
    })
    const cache = fakeCache({
      [key]: {
        hook: "H",
        script: "Cached.",
        title: "T",
        model: "m",
        promptVersion: PROMPT_VERSION,
      },
    })
    const res = await runPipeline(
      { rows: [r], runId: "run1", config: makeConfig(), model: "m", concurrency: 1 },
      { anthropic, client, store, cache, ...io() }
    )
    expect(parse).not.toHaveBeenCalled()
    expect(res.entries[0]!.script).toBe("Cached.")
    store.close()
  })

  it("dry-run generates scripts + specs but never calls the engine", async () => {
    const { anthropic, client, createV2 } = mocks()
    const store = new JobStore(":memory:")
    const ioDeps = io()
    const res = await runPipeline(
      {
        rows: [row()],
        runId: "run1",
        config: makeConfig(),
        model: "m",
        concurrency: 1,
        dryRun: true,
      },
      { anthropic, client, store, cache: fakeCache(), ...ioDeps }
    )
    expect(createV2).not.toHaveBeenCalled()
    expect(ioDeps.download).not.toHaveBeenCalled()
    expect(res.entries[0]!.status).toBe("planned")
    expect(res.entries[0]!.script).toBe("Generated.")
    store.close()
  })

  it("collects build failures when the pool is empty", async () => {
    const { anthropic, client } = mocks()
    const store = new JobStore(":memory:")
    const config = makeConfig({
      pools: {
        v2: { avatars: [], voices: [], formats: ["portrait"] },
        v3: { avatars: [], voices: [] },
      },
    })
    const res = await runPipeline(
      { rows: [row()], runId: "run1", config, model: "m", concurrency: 1 },
      { anthropic, client, store, cache: fakeCache(), ...io() }
    )
    expect(res.buildFailures).toHaveLength(1)
    expect(res.entries).toHaveLength(0)
    store.close()
  })
})
