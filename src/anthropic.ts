import Anthropic from "@anthropic-ai/sdk"

let client: Anthropic | undefined

/**
 * Lazy singleton Anthropic client (mirrors email/apps/worker). The key is optional
 * — only an actual `messages` call (generating a script for a row with no `script`)
 * needs it, so we construct with a placeholder when it's absent rather than throw.
 * Provided-script runs never call the API, so they work with no key set. The CLI
 * checks for the key up front when a row actually needs generation.
 */
export function getAnthropic(): Anthropic {
  if (client) return client
  const apiKey = process.env.ANTHROPIC_API_KEY || "ANTHROPIC_API_KEY-not-set"
  client = new Anthropic({ apiKey })
  return client
}
