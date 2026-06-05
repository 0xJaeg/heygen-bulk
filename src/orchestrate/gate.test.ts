import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { isApproved, recordApproval } from "./gate.js"

describe("approval gate", () => {
  it("reports not-approved when no approvals file exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gate-"))
    expect(await isApproved("run1", join(dir, "approvals.json"))).toBe(false)
  })

  it("records an approval and reads it back idempotently", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gate-"))
    const path = join(dir, "approvals.json")
    await recordApproval("run1", path)
    await recordApproval("run1", path)
    expect(await isApproved("run1", path)).toBe(true)
    expect(await isApproved("run2", path)).toBe(false)
  })
})
