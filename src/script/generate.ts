import type Anthropic from "@anthropic-ai/sdk"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import type { ProductRow } from "../schema/row.js"
import { PROMPT_VERSION, renderRowPrompt, SYSTEM_PROMPT } from "./prompt.js"
import { type PromoScript, PromoScriptSchema } from "./schema.js"
import { countWords, trimToWords } from "./word-budget.js"

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number | null
  cache_creation_input_tokens: number | null
}

export type GenerateScriptArgs = {
  row: ProductRow
  variationIndex: number
  anthropic: Anthropic
  model: string
  /** Hard word ceiling for the spoken script. Defaults to 140 (~60s). */
  maxWords?: number
}

export type GenerateScriptResult = {
  script: PromoScript
  /** True if the script was deterministically trimmed after the retry. */
  trimmed: boolean
  model: string
  promptVersion: string
  usage: Usage[]
}

/**
 * Generate a <60s promo script for one product row. Enforces the word budget
 * via the prompt, then a single corrective retry, then a deterministic trim.
 */
export async function generateScript(
  args: GenerateScriptArgs
): Promise<GenerateScriptResult> {
  const { row, variationIndex, anthropic, model } = args
  const maxWords = args.maxWords ?? 140
  const usage: Usage[] = []

  const call = async (correction?: string): Promise<PromoScript> => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: renderRowPrompt(row, variationIndex) },
    ]
    if (correction) messages.push({ role: "user", content: correction })

    const res = await anthropic.messages.parse({
      model,
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
      messages,
      output_config: { format: zodOutputFormat(PromoScriptSchema) },
    })

    usage.push({
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      cache_read_input_tokens: res.usage.cache_read_input_tokens,
      cache_creation_input_tokens: res.usage.cache_creation_input_tokens,
    })
    if (!res.parsed_output) throw new Error("script_parse_failed")
    return res.parsed_output
  }

  let script = await call()
  if (countWords(script.script) > maxWords) {
    const over = countWords(script.script)
    script = await call(
      `Your previous script was ${over} words. Rewrite the script in ` +
        `${maxWords - 10} words or fewer, keeping the hook and the call to action.`
    )
  }

  let trimmed = false
  if (countWords(script.script) > maxWords) {
    script = { ...script, script: trimToWords(script.script, maxWords) }
    trimmed = true
  }

  return { script, trimmed, model, promptVersion: PROMPT_VERSION, usage }
}
