import type { ProductRow } from "../schema/row.js"

// Bump when SYSTEM_PROMPT or renderRowPrompt changes — invalidates the script cache.
export const PROMPT_VERSION = "1"

export const SYSTEM_PROMPT = `You write tight, punchy promo scripts for short (<60 second) videos read aloud by an AI avatar.

Rules:
- 110-135 words. Never exceed 140. This is spoken aloud and must finish under 60 seconds.
- Plain spoken text only. No stage directions, camera notes, emojis, markdown, or bracketed cues like [pause].
- Open with one strong hook that grabs attention in the first sentence.
- Match the requested tone.
- End on the provided call to action.
- Never invent facts, prices, features, or claims that are not in the input.`

/** Render the per-row user prompt. Field order is stable to preserve prompt-cache hits. */
export function renderRowPrompt(row: ProductRow, variationIndex: number): string {
  const lines = [
    `Product: ${row.product_name}`,
    `What it is: ${row.description}`,
    `Key benefits: ${row.key_benefits ?? "—"}`,
    `Price: ${row.price ?? "—"}`,
    `Audience: ${row.target_audience ?? "—"}`,
    `Tone: ${row.tone}`,
    `Call to action: ${row.call_to_action}`,
  ]
  if (row.num_variations > 1) {
    lines.push(
      `\nThis is variation ${variationIndex + 1} of ${row.num_variations}. ` +
        `Use a distinctly different hook and angle from a standard pitch.`
    )
  }
  return lines.join("\n")
}
