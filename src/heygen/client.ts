import { classifyError, HeyGenApiError } from "./errors.js"
import type {
  Avatar,
  CreateV2Request,
  CreateV3Request,
  Template,
  VideoState,
  VideoStatus,
  Voice,
} from "./types.js"

interface ApiEnvelope {
  code?: number
  message?: string
  error?: { message?: string; code?: number; detail?: string }
  data?: unknown
}

export interface HeyGenClientOptions {
  apiKey: string
  baseUrl?: string
  fetchImpl?: typeof fetch
}

const STATE_MAP: Record<string, VideoState> = {
  pending: "pending",
  waiting: "pending",
  processing: "processing",
  in_progress: "processing",
  completed: "completed",
  success: "completed",
  failed: "failed",
  error: "failed",
}

function normalizeState(raw: string | undefined): VideoState {
  if (!raw) return "processing"
  return STATE_MAP[raw.toLowerCase()] ?? "processing"
}

function asFailure(err: unknown): string | null {
  if (err == null) return null
  if (typeof err === "string") return err
  if (typeof err === "object") {
    const e = err as { message?: string; detail?: string }
    return e.message ?? e.detail ?? JSON.stringify(err)
  }
  return String(err)
}

/** Typed HeyGen REST client. Inject `fetchImpl` to test without network. */
export class HeyGenClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(opts: HeyGenClientOptions) {
    this.apiKey = opts.apiKey
    this.baseUrl = opts.baseUrl ?? "https://api.heygen.com"
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  private async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiEnvelope> {
    const headers: Record<string, string> = { "X-Api-Key": this.apiKey }
    if (body !== undefined) headers["Content-Type"] = "application/json"

    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
    } catch (e) {
      throw new HeyGenApiError(`network error: ${(e as Error).message}`, {
        kind: "transient",
      })
    }

    const text = await res.text()
    let json: ApiEnvelope = {}
    if (text) {
      try {
        json = JSON.parse(text) as ApiEnvelope
      } catch {
        json = {}
      }
    }

    if (!res.ok) {
      const message = json.message ?? json.error?.message ?? `HTTP ${res.status}`
      throw new HeyGenApiError(message, {
        status: res.status,
        code: json.code ?? json.error?.code,
        kind: classifyError({ status: res.status, code: json.code, message }),
      })
    }

    // V2 endpoints return HTTP 200 with a `code` field; 100 means success.
    if (typeof json.code === "number" && json.code !== 100) {
      const message = json.message ?? `HeyGen error code ${json.code}`
      throw new HeyGenApiError(message, {
        status: res.status,
        code: json.code,
        kind: classifyError({ status: res.status, code: json.code, message }),
      })
    }

    return json
  }

  async createV2(input: CreateV2Request): Promise<string> {
    const voice: Record<string, unknown> = {
      type: "text",
      input_text: input.inputText,
      voice_id: input.voiceId,
    }
    if (input.speed !== undefined) voice.speed = input.speed

    const videoInput: Record<string, unknown> = {
      character: {
        type: "avatar",
        avatar_id: input.avatarId,
        avatar_style: "normal",
      },
      voice,
    }
    if (input.background) videoInput.background = input.background

    const body: Record<string, unknown> = {
      video_inputs: [videoInput],
      dimension: { width: input.width, height: input.height },
    }
    if (input.caption !== undefined) body.caption = input.caption
    if (input.title) body.title = input.title
    if (input.callbackId) body.callback_id = input.callbackId

    const env = await this.request("POST", "/v2/video/generate", body)
    return (env.data as { video_id: string }).video_id
  }

  async getStatusV2(
    videoId: string,
    statusPath = "/v1/video_status.get"
  ): Promise<VideoStatus> {
    const env = await this.request(
      "GET",
      `${statusPath}?video_id=${encodeURIComponent(videoId)}`
    )
    const d = (env.data ?? {}) as {
      status?: string
      video_url?: string
      duration?: number
      error?: unknown
    }
    return {
      state: normalizeState(d.status),
      videoUrl: d.video_url ?? null,
      durationSec: d.duration ?? null,
      failure: asFailure(d.error),
    }
  }

  async createV3(input: CreateV3Request): Promise<string> {
    const body: Record<string, unknown> = { prompt: input.prompt }
    if (input.avatarId) body.avatar_id = input.avatarId
    if (input.voiceId) body.voice_id = input.voiceId
    if (input.styleId) body.style_id = input.styleId
    if (input.orientation) body.orientation = input.orientation
    if (input.callbackUrl) body.callback_url = input.callbackUrl
    if (input.callbackId) body.callback_id = input.callbackId

    const env = await this.request("POST", "/v3/video-agents", body)
    return (env.data as { session_id: string }).session_id
  }

  async getSessionVideoId(sessionId: string): Promise<string | null> {
    const env = await this.request(
      "GET",
      `/v3/video-agents/${encodeURIComponent(sessionId)}`
    )
    return (env.data as { video_id?: string }).video_id ?? null
  }

  async getStatusV3(videoId: string): Promise<VideoStatus> {
    const env = await this.request(
      "GET",
      `/v3/videos/${encodeURIComponent(videoId)}`
    )
    const d = (env.data ?? {}) as {
      status?: string
      video_url?: string
      duration?: number
      failure_code?: string
      failure_message?: string
    }
    const failure = d.failure_message
      ? `${d.failure_code ?? "error"}: ${d.failure_message}`
      : null
    return {
      state: normalizeState(d.status),
      videoUrl: d.video_url ?? null,
      durationSec: d.duration ?? null,
      failure,
    }
  }

  async listAvatars(): Promise<Avatar[]> {
    const env = await this.request("GET", "/v2/avatars")
    return ((env.data ?? {}) as { avatars?: Avatar[] }).avatars ?? []
  }

  async listVoices(): Promise<Voice[]> {
    const env = await this.request("GET", "/v2/voices")
    return ((env.data ?? {}) as { voices?: Voice[] }).voices ?? []
  }

  async listTemplates(): Promise<Template[]> {
    const env = await this.request("GET", "/v2/templates")
    return ((env.data ?? {}) as { templates?: Template[] }).templates ?? []
  }
}
