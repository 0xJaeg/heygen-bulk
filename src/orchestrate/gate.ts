import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

interface Approvals {
  approved: string[]
}

async function read(approvalsPath: string): Promise<Approvals> {
  try {
    const data = JSON.parse(await readFile(approvalsPath, "utf8")) as Approvals
    return { approved: Array.isArray(data.approved) ? data.approved : [] }
  } catch {
    return { approved: [] }
  }
}

/** Has a sample run been approved for production? */
export async function isApproved(
  runId: string,
  approvalsPath: string
): Promise<boolean> {
  return (await read(approvalsPath)).approved.includes(runId)
}

/** Record approval of a sample run so `--production` can proceed. Idempotent. */
export async function recordApproval(
  runId: string,
  approvalsPath: string
): Promise<void> {
  const data = await read(approvalsPath)
  if (!data.approved.includes(runId)) data.approved.push(runId)
  await mkdir(dirname(approvalsPath), { recursive: true })
  await writeFile(approvalsPath, JSON.stringify(data, null, 2), "utf8")
}
