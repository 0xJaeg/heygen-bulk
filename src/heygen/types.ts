export type VideoState = "pending" | "processing" | "completed" | "failed"

/** Engine-agnostic, normalized status returned by the client. */
export interface VideoStatus {
  state: VideoState
  videoUrl: string | null
  durationSec: number | null
  failure: string | null
}

export type Background =
  | { type: "color"; value: string }
  | { type: "image"; url?: string; image_asset_id?: string }
  | {
      type: "video"
      url?: string
      video_asset_id?: string
      play_style?: string
    }

export interface CreateV2Request {
  avatarId: string
  /** "normal" | "closeUp" | "circle". "normal" suits "(Upper Body)" avatars in 9:16. */
  avatarStyle?: string
  /** Avatar zoom multiplier (1 = native). >1 makes the avatar taller/larger to fill the frame. */
  scale?: number
  /** Normalized translate (fraction of frame); positive y shifts the avatar down. */
  offset?: { x: number; y: number }
  voiceId: string
  inputText: string
  width: number
  height: number
  speed?: number
  background?: Background
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
