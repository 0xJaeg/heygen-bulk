export type VideoState = "pending" | "processing" | "completed" | "failed"

/** Engine-agnostic, normalized status returned by the client. */
export interface VideoStatus {
  state: VideoState
  videoUrl: string | null
  durationSec: number | null
  failure: string | null
}

export interface CreateV2Request {
  avatarId: string
  voiceId: string
  inputText: string
  width: number
  height: number
  speed?: number
  background?: { type: "color"; value: string } | { type: "image"; url: string }
  caption?: boolean
  title?: string
  callbackId?: string
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
