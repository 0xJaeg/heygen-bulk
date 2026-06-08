import { spawn } from "node:child_process"

/**
 * Cover-crop an image to width×height via ffmpeg (scale-to-fill then center-crop),
 * reading/writing through pipes so the source file is never touched. Returns PNG
 * bytes. Rejects if ffmpeg is missing or the input isn't a valid image — callers
 * fall back to the original bytes.
 */
export function ffmpegCoverResize(
  bytes: Uint8Array,
  width: number,
  height: number,
  blurSigma?: number
): Promise<Uint8Array> {
  const vf =
    `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}` +
    (blurSigma && blurSigma > 0 ? `,gblur=sigma=${blurSigma}` : "")
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-vf",
      vf,
      "-f",
      "image2pipe",
      "-vcodec",
      "png",
      "pipe:1",
    ])
    const out: Buffer[] = []
    const errs: Buffer[] = []
    ff.stdout.on("data", (d: Buffer) => out.push(d))
    ff.stderr.on("data", (d: Buffer) => errs.push(d))
    ff.on("error", reject)
    ff.on("close", (code) => {
      if (code === 0) resolve(new Uint8Array(Buffer.concat(out)))
      else reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(errs).toString()}`))
    })
    ff.stdin.on("error", () => {})
    ff.stdin.write(Buffer.from(bytes))
    ff.stdin.end()
  })
}
