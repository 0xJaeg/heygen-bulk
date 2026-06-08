import { classifyError, HeyGenApiError } from "./errors.js"
import type {
  Avatar,
  CreateIvVideoRequest,
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

  /**
   * Create an Avatar IV/V photo-avatar video (POST /v3/videos). Poll its status
   * with getStatusV3 (same /v3/videos/{id} endpoint). The avatar's own photo
   * supplies framing + background; output size is set by aspectRatio + resolution.
   */
  async createIvVideo(input: CreateIvVideoRequest): Promise<string> {
    const env = await this.request("POST", "/v3/videos", {
      type: "avatar",
      avatar_id: input.avatarId,
      voice_id: input.voiceId,
      script: input.script,
      aspect_ratio: input.aspectRatio,
      resolution: input.resolution,
      engine: { type: input.avatarEngine },
    })
    return (env.data as { video_id: string }).video_id
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
