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

describe("HeyGenClient.createIvVideo", () => {
  it("posts an Avatar IV/V request to /v3/videos and returns video_id", async () => {
    const { client, calls } = makeClient(() => ({
      body: { data: { video_id: "iv_1" } },
    }))
    const id = await client.createIvVideo({
      avatarId: "look_1",
      voiceId: "voice_1",
      script: "Hi",
      aspectRatio: "9:16",
      resolution: "1080p",
      avatarEngine: "avatar_v",
    })
    expect(id).toBe("iv_1")
    expect(calls[0]!.url).toBe("https://api.test/v3/videos")
    expect(calls[0]!.init.method).toBe("POST")
    expect(calls[0]!.init.headers!["X-Api-Key"]).toBe("k")
    const body = JSON.parse(calls[0]!.init.body!)
    expect(body.type).toBe("avatar")
    expect(body.avatar_id).toBe("look_1")
    expect(body.voice_id).toBe("voice_1")
    expect(body.script).toBe("Hi")
    expect(body.aspect_ratio).toBe("9:16")
    expect(body.resolution).toBe("1080p")
    expect(body.engine).toEqual({ type: "avatar_v" })
  })

  it("throws a HeyGenApiError on a non-2xx response", async () => {
    const { client } = makeClient(() => ({
      status: 400,
      body: { error: { message: "bad avatar" } },
    }))
    await expect(
      client.createIvVideo({
        avatarId: "x",
        voiceId: "y",
        script: "z",
        aspectRatio: "9:16",
        resolution: "1080p",
        avatarEngine: "avatar_v",
      })
    ).rejects.toBeInstanceOf(HeyGenApiError)
  })
})

describe("HeyGenClient.getStatusV3", () => {
  it("normalizes a completed status (used by the iv path)", async () => {
    const { client, calls } = makeClient(() => ({
      body: { data: { status: "completed", video_url: "http://x/v.mp4", duration: 42 } },
    }))
    const status = await client.getStatusV3("vid_1")
    expect(calls[0]!.url).toBe("https://api.test/v3/videos/vid_1")
    expect(status.state).toBe("completed")
    expect(status.videoUrl).toBe("http://x/v.mp4")
    expect(status.durationSec).toBe(42)
  })

  it("normalizes a failed status with code + message", async () => {
    const { client } = makeClient(() => ({
      body: {
        data: { status: "failed", failure_code: "E1", failure_message: "render error" },
      },
    }))
    const status = await client.getStatusV3("vid_1")
    expect(status.state).toBe("failed")
    expect(status.failure).toContain("render error")
  })
})

describe("HeyGenClient.createV3", () => {
  it("posts a video-agents request to /v3/video-agents and returns session_id", async () => {
    const { client, calls } = makeClient(() => ({
      body: { data: { session_id: "sess_1" } },
    }))
    const id = await client.createV3({ prompt: "make a promo", orientation: "portrait" })
    expect(id).toBe("sess_1")
    expect(calls[0]!.url).toBe("https://api.test/v3/video-agents")
    const body = JSON.parse(calls[0]!.init.body!)
    expect(body.prompt).toBe("make a promo")
    expect(body.orientation).toBe("portrait")
  })
})
