/**
 * Wrap a spoken script in the approved "v3-strict" directive so the HeyGen Video Agent
 * (`/v3/video-agents`) renders a clean talking head — one continuous shot of the
 * spokesperson, no b-roll, captions, graphics, or scene changes. A vague prompt makes
 * the agent auto-compose (b-roll + infographics); this strict wrapper is the version
 * the team approved.
 *
 * Caveat: the agent writes its own delivery, so verbatim wording is requested ("word
 * for word") but NOT guaranteed — use the `iv` engine for scripts that must be exact.
 */
export function talkingHeadPrompt(script: string): string {
  return (
    "A vertical talking-head video. One single continuous shot of the spokesperson " +
    "speaking directly to the camera. Do NOT add b-roll, stock footage, background " +
    "video, on-screen text, captions, graphics, or scene changes — only the person " +
    `talking. The spokesperson says, word for word: '${script}'`
  )
}
