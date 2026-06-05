import Anthropic from "@anthropic-ai/sdk"

let client: Anthropic | undefined

/** Lazy singleton Anthropic client (mirrors email/apps/worker). */
export function getAnthropic(): Anthropic {
  if (client) return client
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY in env")
  }
  client = new Anthropic({ apiKey })
  return client
}
