import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"

export type JobStatus =
  | "pending"
  | "submitted"
  | "processing"
  | "completed"
  | "failed"
  | "stuck"

export interface JobRecord {
  job_id: string
  run_id: string
  product_id: string
  variation_index: number
  engine: string
  status: JobStatus
  heygen_video_id: string | null
  session_id: string | null
  attempt: number
  failure: string | null
  video_url: string | null
  local_path: string | null
  duration_sec: number | null
  est_cost_usd: number | null
  title: string | null
  created_at: string
  updated_at: string
}

type PatchFields = Partial<Omit<JobRecord, "job_id" | "created_at">>

/**
 * SQLite-backed job ledger using Node's built-in `node:sqlite` (no native build).
 * Provides idempotent creation and resumability for the generation engine.
 */
export class JobStore {
  private readonly db: DatabaseSync

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`CREATE TABLE IF NOT EXISTS jobs (
      job_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      product_id TEXT,
      variation_index INTEGER,
      engine TEXT,
      status TEXT NOT NULL,
      heygen_video_id TEXT,
      session_id TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      failure TEXT,
      video_url TEXT,
      local_path TEXT,
      duration_sec REAL,
      est_cost_usd REAL,
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`)
  }

  /** Insert a fresh pending job; a no-op if it already exists (idempotent re-runs). */
  create(input: {
    jobId: string
    runId: string
    productId: string
    variationIndex: number
    engine: string
    title?: string | null
  }): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT OR IGNORE INTO jobs
         (job_id, run_id, product_id, variation_index, engine, status, attempt, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`
      )
      .run(
        input.jobId,
        input.runId,
        input.productId,
        input.variationIndex,
        input.engine,
        input.title ?? null,
        now,
        now
      )
  }

  get(jobId: string): JobRecord | undefined {
    return this.db.prepare(`SELECT * FROM jobs WHERE job_id = ?`).get(jobId) as
      | JobRecord
      | undefined
  }

  patch(jobId: string, fields: PatchFields): void {
    const keys = Object.keys(fields)
    if (keys.length === 0) return
    const set = keys.map((k) => `${k} = ?`).join(", ")
    const values = keys.map(
      (k) => (fields as Record<string, string | number | null>)[k] ?? null
    )
    this.db
      .prepare(`UPDATE jobs SET ${set}, updated_at = ? WHERE job_id = ?`)
      .run(...values, new Date().toISOString(), jobId)
  }

  all(runId?: string): JobRecord[] {
    if (runId) {
      return this.db
        .prepare(`SELECT * FROM jobs WHERE run_id = ?`)
        .all(runId) as unknown as JobRecord[]
    }
    return this.db.prepare(`SELECT * FROM jobs`).all() as unknown as JobRecord[]
  }

  close(): void {
    this.db.close()
  }
}
