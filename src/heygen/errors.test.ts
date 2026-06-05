import { describe, expect, it } from "vitest"
import { classifyError, HeyGenApiError } from "./errors.js"

describe("classifyError", () => {
  it("classifies 429 as rate_limited", () => {
    expect(classifyError({ status: 429 })).toBe("rate_limited")
  })

  it("classifies insufficient-credit messages as credit_exhausted", () => {
    expect(classifyError({ status: 400, message: "Insufficient credits" })).toBe(
      "credit_exhausted"
    )
    expect(classifyError({ status: 402, message: "quota exceeded" })).toBe(
      "credit_exhausted"
    )
  })

  it("classifies 5xx and missing-status (network) as transient", () => {
    expect(classifyError({ status: 500 })).toBe("transient")
    expect(classifyError({ status: 503 })).toBe("transient")
    expect(classifyError({ message: "network down" })).toBe("transient")
  })

  it("classifies other 4xx as permanent", () => {
    expect(classifyError({ status: 400, message: "invalid avatar_id" })).toBe(
      "permanent"
    )
    expect(classifyError({ status: 404 })).toBe("permanent")
  })
})

describe("HeyGenApiError", () => {
  it("carries kind, status, and code as own properties", () => {
    const e = new HeyGenApiError("boom", {
      status: 429,
      code: 1,
      kind: "rate_limited",
    })
    expect(e).toBeInstanceOf(Error)
    expect(e.kind).toBe("rate_limited")
    expect(e.status).toBe(429)
    expect(e.message).toBe("boom")
  })
})
