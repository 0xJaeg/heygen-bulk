/** Count whitespace-separated words. */
export function countWords(text: string): number {
  const t = text.trim()
  if (!t) return 0
  return t.split(/\s+/).length
}

/**
 * Deterministically trim text to at most `maxWords` words. Prefers cutting at
 * the last sentence boundary that fits; falls back to a hard word cut.
 */
export function trimToWords(text: string, maxWords: number): string {
  if (countWords(text) <= maxWords) return text.trim()

  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? []
  let acc = ""
  let count = 0
  for (const sentence of sentences) {
    const w = countWords(sentence)
    if (count + w > maxWords) break
    acc += sentence
    count += w
  }

  const trimmed = acc.trim()
  if (trimmed) return trimmed

  return text.trim().split(/\s+/).slice(0, maxWords).join(" ")
}
