import { z } from "zod/v4"

/** Structured output for a single promo script. */
export const PromoScriptSchema = z.object({
  hook: z.string(),
  script: z.string(),
  title: z.string(),
})

export type PromoScript = z.infer<typeof PromoScriptSchema>
