import type Anthropic from "@anthropic-ai/sdk"
import { describe, expect, it, vi } from "vitest"
import type { ProductRow } from "../schema/row.js"
import { generateScript } from "./generate.js"

const row: ProductRow = {
  product_name: "Acme",
  description: "A great widget.",
  call_to_action: "Buy now",
  tone: "energetic",
  language: "en",
  num_variations: 1,
  skip: false,
}

const words = (n: number) =>
  Array.from({ length: n }, (_, i) => "w" + i).join(" ")

function makeAnthropic(scripts: string[]) {
  const parse = vi.fn()
  for (const s of scripts) {
    parse.mockResolvedValueOnce({
      parsed_output: { hook: "Hook", script: s, title: "Title" },
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    })
  }
  return { client: { messages: { parse } } as unknown as Anthropic, parse }
}

describe("generateScript", () => {
  it("returns the script without retrying when within budget", async () => {
    const { client, parse } = makeAnthropic(["Three word script."])
    const r = await generateScript({
      row,
      variationIndex: 0,
      anthropic: client,
      model: "claude-haiku-4-5",
      maxWords: 140,
    })
    expect(parse).toHaveBeenCalledTimes(1)
    expect(r.trimmed).toBe(false)
    expect(r.script.script).toBe("Three word script.")
  })

  it("retries once when the first draft exceeds the word budget", async () => {
    const { client, parse } = makeAnthropic([words(50), "Short enough."])
    const r = await generateScript({
      row,
      variationIndex: 0,
      anthropic: client,
      model: "m",
      maxWords: 10,
    })
    expect(parse).toHaveBeenCalledTimes(2)
    expect(r.trimmed).toBe(false)
    expect(r.script.script).toBe("Short enough.")
  })

  it("deterministically trims when still over budget after the retry", async () => {
    const { client, parse } = makeAnthropic([words(50), words(50)])
    const r = await generateScript({
      row,
      variationIndex: 0,
      anthropic: client,
      model: "m",
      maxWords: 10,
    })
    expect(parse).toHaveBeenCalledTimes(2)
    expect(r.trimmed).toBe(true)
    expect(r.script.script.split(/\s+/).length).toBe(10)
  })

  it("throws when the model returns no parsed output", async () => {
    const parse = vi.fn().mockResolvedValueOnce({
      parsed_output: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    })
    const client = { messages: { parse } } as unknown as Anthropic
    await expect(
      generateScript({ row, variationIndex: 0, anthropic: client, model: "m" })
    ).rejects.toThrow("script_parse_failed")
  })
})
