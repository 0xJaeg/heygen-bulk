import { describe, expect, it } from "vitest"
import { HeyGenClient } from "./client.js"
import { HeyGenApiError } from "./errors.js"

type RecordedInit = {
  method?: string
  headers?: Record<string, string>
  body?: string
}

function makeClient(handler: (url: string) => { status?: number; body?: unknown }) {
  const calls: Array<{ url: string; init: RecordedInit }> = []
  const fetchImpl = (async (url: string | URL, init?: RecordedInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const { status = 200, body } = handler(String(url))
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (body === undefined ? "" : JSON.stringify(body)),
    }
  }) as unknown as typeof fetch
  const client = new HeyGenClient({
    apiKey: "k",
    baseUrl: "https://api.test",
    fetchImpl,
  })
  return { client, calls }
}

describe("HeyGenClient.createV2", () => {
  it("posts to /v2/video/generate with auth + avatar/voice and returns video_id", async () => {
    const { client, calls } = makeClient(() => ({
      body: { code: 100, data: { video_id: "vid_1" } },
    }))
    const id = await client.createV2({
      avatarId: "av_1",
      voiceId: "vo_1",
      inputText: "Hello",
      width: 1080,
      height: 1920,
    })
    expect(id).toBe("vid_1")
    expect(calls[0]!.url).toBe("https://api.test/v2/video/generate")
    expect(calls[0]!.init.method).toBe("POST")
    expect(calls[0]!.init.headers!["X-Api-Key"]).toBe("k")
    const body = JSON.parse(calls[0]!.init.body!)
    expect(body.video_inputs[0].character.avatar_id).toBe("av_1")
    expect(body.video_inputs[0].voice.voice_id).toBe("vo_1")
    expect(body.video_inputs[0].voice.input_text).toBe("Hello")
    expect(body.dimension).toEqual({ width: 1080, height: 1920 })
  })

  it("throws a HeyGenApiError when the API returns a non-100 code", async () => {
    const { client } = makeClient(() => ({
      body: { code: 40001, message: "bad avatar" },
    }))
    await expect(
      client.createV2({
        avatarId: "x",
        voiceId: "y",
        inputText: "z",
        width: 1,
        height: 1,
      })
    ).rejects.toBeInstanceOf(HeyGenApiError)
  })
})

describe("HeyGenClient.getStatusV2", () => {
  it("normalizes a completed status", async () => {
    const { client, calls } = makeClient(() => ({
      body: {
        code: 100,
        data: { status: "completed", video_url: "http://x/v.mp4", duration: 42 },
      },
    }))
    const s = await client.getStatusV2("vid_1")
    expect(s.state).toBe("completed")
    expect(s.videoUrl).toBe("http://x/v.mp4")
    expect(s.durationSec).toBe(42)
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/video_status.get?video_id=vid_1"
    )
  })

  it("maps a failed status and surfaces the error", async () => {
    const { client } = makeClient(() => ({
      body: { code: 100, data: { status: "failed", error: { message: "render failed" } } },
    }))
    const s = await client.getStatusV2("vid_1")
    expect(s.state).toBe("failed")
    expect(s.failure).toContain("render failed")
  })
})

describe("HeyGenClient error handling", () => {
  it("throws transient on 500 and rate_limited on 429", async () => {
    const five = makeClient(() => ({ status: 500, body: { message: "server error" } }))
    await expect(five.client.getStatusV2("v")).rejects.toMatchObject({
      kind: "transient",
    })
    const rate = makeClient(() => ({ status: 429, body: { message: "slow down" } }))
    await expect(rate.client.getStatusV2("v")).rejects.toMatchObject({
      kind: "rate_limited",
    })
  })
})

describe("HeyGenClient v3 + listVoices", () => {
  it("creates a v3 session and returns session_id", async () => {
    const { client, calls } = makeClient(() => ({
      body: { data: { session_id: "sess_1" } },
    }))
    const sid = await client.createV3({ prompt: "Make a promo", callbackId: "job_1" })
    expect(sid).toBe("sess_1")
    expect(calls[0]!.url).toBe("https://api.test/v3/video-agents")
  })

  it("returns the voices array", async () => {
    const { client } = makeClient(() => ({
      body: { code: 100, data: { voices: [{ voice_id: "v1", name: "Amy" }] } },
    }))
    expect(await client.listVoices()).toEqual([{ voice_id: "v1", name: "Amy" }])
  })
})

describe("HeyGenClient.listTemplates", () => {
  it("returns the templates array", async () => {
    const { client } = makeClient(() => ({
      body: { data: { templates: [{ template_id: "t1", name: "Promo" }] } },
    }))
    expect(await client.listTemplates()).toEqual([
      { template_id: "t1", name: "Promo" },
    ])
  })
})
