export type VideoState = "pending" | "processing" | "completed" | "failed"

/** Engine-agnostic, normalized status returned by the client. */
export interface VideoStatus {
  state: VideoState
  videoUrl: string | null
  durationSec: number | null
  failure: string | null
}

export interface CreateV3Request {
  prompt: string
  avatarId?: string
  voiceId?: string
  styleId?: string
  orientation?: "portrait" | "landscape"
  callbackUrl?: string
  callbackId?: string
}

/** Avatar IV/V photo-avatar video (POST /v3/videos). */
export interface CreateIvVideoRequest {
  /** A photo-avatar look id. */
  avatarId: string
  voiceId: string
  script: string
  /** "9:16" | "16:9" | "4:5" | "5:4" | "1:1". */
  aspectRatio: string
  /** "1080p" | "720p" | "4k". */
  resolution: string
  /** Engine tier: "avatar_v" (newest) | "avatar_iv". */
  avatarEngine: string
}

export interface Avatar {
  avatar_id: string
  avatar_name?: string
}

export interface Voice {
  voice_id: string
  name?: string
  language?: string
  gender?: string
}

export interface Template {
  template_id: string
  name?: string
}
