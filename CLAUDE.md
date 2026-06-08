# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Intent

A **standalone Node/TS service** that mass-produces short (<60s) AI-avatar promo
videos: a CSV/Google-Sheet of products → Claude writes one promo script per product
→ **HeyGen** renders the video. Built to QA a few samples, then scale to ~200–400/day.

`README.md` is the usage/reference doc. The approved design/plan is the architectural
source of truth: `/Users/christianjheggfermilan/.claude/plans/we-will-start-by-playful-galaxy.md`.

**Current state (2026-06-05):** the full pipeline is implemented and unit-tested
(79 tests) — ingest → script-gen (cached) → HeyGen V2/V3 engine → `node:sqlite`
ledger → CLI (`dry-run`/`sample`/`approve`/`production`/`resume`) + `index.html`
review page. A first 4-video sample rendered end-to-end **with audio** (verified).

**Backgrounds & captions (resolved):** captions are off by default. Background
scene images go in the `backgrounds/` folder — each is uploaded to HeyGen once
(`client.uploadAsset` → `image_asset_id` cached in `.cache/backgrounds.json`) and
**rotated across videos** via the pool. Remaining: drop the teammate's actual
scene images into `backgrounds/`. The account has **0 saved templates**
(`GET /v2/templates` → empty); the Template path (`Save as Template` → fill the
script variable via `POST /v2/template/{id}/generate`) remains available for
HeyGen-composed multi-scene videos.

## Working Style

These four principles apply to every change (org standard; explicit task
instructions override them).

- **Think before coding** — state assumptions; surface tradeoffs; if unclear, stop and ask.
- **Simplicity first** — minimum code that solves the problem; nothing speculative.
- **Surgical changes** — touch only what the task requires; match existing style; don't refactor what isn't broken.
- **Goal-driven** — define success criteria and verify. This repo was built **test-first (TDD)** — write a failing test, watch it fail, then implement. After any change, run `npm test && npm run typecheck && npm run lint` and confirm green before claiming done.

**Before writing or modifying any Anthropic/Claude SDK code, consult the `claude-api`
skill** (model ids, `messages.parse` usage, caching) — don't guess SDK shapes.

## Commands

```bash
npm test            # vitest (every module is tested)   ⚠ NOT `tsx --test` (wrong runner)
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run format      # prettier --write

npx tsx src/cli.ts status            # validate env + show config
npx tsx src/cli.ts list-pool         # HeyGen avatars + voices
npx tsx src/cli.ts list-templates    # saved HeyGen templates
npx tsx src/cli.ts dry-run    --source <csv|url>          # scripts + cost, no spend
npx tsx src/cli.ts sample     --source <csv|url> --limit N
npx tsx src/cli.ts approve    <runId>
npx tsx src/cli.ts production --source <csv|url> [--yes]
npx tsx src/cli.ts resume     <runId> --source <csv|url>
```

Runs on Node `>=20` (developed on Node 26). `dry-run` needs only `ANTHROPIC_API_KEY`;
anything that renders also needs `HEYGEN_API_KEY` (`.env` / `.env.local`).

## Architecture

Single-process Node/TS CLI. Data flow: **ingest → script (cached) → buildJobSpec →
engine (create/poll/download) → manifest + ledger**. Modules under `src/`:

- `ingest/` — `loadRows`: local CSV or published-Sheet CSV URL → `csv-parse` → per-row validate.
- `schema/row.ts` — `ProductRowSchema` (zod) + forgiving header mapping; empty cells → defaults. Optional `script` column (aliases VO/Voiceover/VSL): if set it's the spoken text used verbatim (Claude skipped) and `description`/`call_to_action` become optional (zod refine requires them only when no script). Optional `gender` (`male`/`female`, also `M`/`F`) selects a matching avatar+voice from the gender-split pool.
- `script/` — `generate` (Claude `messages.parse` + `zodOutputFormat`), `prompt` (cached system block + `PROMPT_VERSION`), `word-budget` (enforce <60s), `cache` (content-hash → reuse, drift-proof).
- `heygen/` — `client` (typed REST: V2 create/status, V3 create/session/status, list avatars/voices/templates), `errors` (classify 429/credit/transient/permanent), `engine` (`processJob`/`runJobs`: concurrency cap, backoff polling, retries, credit circuit-breaker, download-on-complete), `download` (stream MP4 to disk).
- `jobs/build-job.ts` — stable `job_id`, seeded **gender-aware** pool rotation (avatars/voices split male/female so a row's `gender` picks a matching pair), `buildJobSpec` (override → default → rotation).
- `store/job-store.ts` — `node:sqlite` ledger (idempotency + resume + cost).
- `cost/estimate.ts`, `ledger/manifest.ts` (manifest.json + index.html), `orchestrate/` (`run` pipeline + approval `gate`).

Two engines: **V2** (avatar + curated pool, the workhorse) and **V3** (auto-compose, opt-in per row).

## Conventions

- **ESM + NodeNext**: relative imports use the **`.js` extension** (e.g. `./config.js`). `zod` is imported as `zod/v4`.
- **Prettier**: no semicolons, double quotes, 2-space indent, trailing commas `es5`. Don't fight the formatter.
- **ESLint 9** flat config (`eslint.config.js`); avoid `any`.
- **Anthropic** (mirrors the sibling `email/apps/worker`): lazy `getAnthropic()` singleton; `messages.parse` + `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`; cached system block `cache_control: { type: "ephemeral", ttl: "1h" }`; default model `claude-haiku-4-5`.
- **Dependency injection for tests**: the engine/pipeline take injected `client`/`anthropic`/`download`/`sleep`; tests use mocks + a `:memory:` `JobStore` (no network, no keys).

## Gotchas (project-specific)

- **`node:sqlite`, NOT `better-sqlite3`** — `better-sqlite3` fails to compile on Node 26 (no prebuilt binary). The built-in needs no native build. `JobStore` `mkdir`s its parent dir before opening.
- **HeyGen V2 needs a `background`** — supplied from the `backgrounds/` folder (images uploaded via `client.uploadAsset`, cached, rotated) or `pools.v2.backgrounds`; omitting it renders a bare default. Download URLs **expire (~7 days)** → the engine downloads on completion. The V2 status path is a **config constant** (`heygen.statusPathV2`) because docs show variants.
- **9:16 framing = avatar choice + scale + offset.** Use HeyGen **"(Upper Body)"** looks (the pool ships `Marcus`/`francis` male, `Abigail`/`Aubrey` female) at `defaults.avatarStyle: "normal"` — they're shot as a portrait medium shot (head + torso) that fills the 9:16 **width** with the background edge-to-edge. To fill the **height**: `defaults.avatarScale` (1.6) enlarges the avatar and `defaults.avatarOffset.y` (0.07, **positive = down**, normalized fraction) anchors it lower so the torso runs off the **bottom** edge (no desk/floor gap) while the head keeps headroom. Scale alone can't — a centered avatar crops the head at the top before the bottom fills; offset breaks that symmetry. Values locked via scale-sweep + offset render tests. **Tight landscape studio avatars** (e.g. `Aditya in Blue blazer`) pillarbox in 9:16 and only fill if zoomed hard, cropping to a **"resume" head-and-shoulders** — avoid for portrait. (Pick avatars by previewing `preview_image_url`; `GET /v2/avatars` exposes `avatar_name` — "(Upper Body)" in the name is the signal.) Background images are auto **cover-cropped + gaussian-blurred (`defaults.backgroundBlur`, sigma 10) to the video size via ffmpeg** before upload (`heygen/resize.ts`) — **ffmpeg must be on PATH**; the bg cache key includes a blur tag (`:b<sigma>`) so changing the blur re-uploads.
- **Never re-create a job that has a `heygen_video_id`** — the engine re-polls the stored id instead (avoids double charges). `job_id` is a stable hash of product+variation+engine.
- **Script cache is content-hashed** by `model + promptVersion + grounding fields + variation` — approved QA scripts are reused verbatim and free at scale. Bump `PROMPT_VERSION` when changing the prompt.
- **Provided scripts bypass Claude** — a row's `script` column (if set) is used verbatim: no generation, no cache, no trim, `num_variations` ignored. Empty → Claude generates as before. So a sheet of all-provided scripts needs no Anthropic calls.
- **Cost**: ≈ $1/min (V2), $2/min (V3); the cost guard warns/`--yes`-gates large runs. `MAX_CONCURRENCY` must match the HeyGen plan's concurrent-generation cap.
- **Review page**: `index.html` `<video src>` is a **basename** (resolves next to the file in the run dir) — keep it that way.

## Claude Code Skills

This is greenfield/standalone work — use **superpowers** skills (brainstorming,
TDD, systematic-debugging, verification-before-completion) and the **`claude-api`**
skill for any Anthropic SDK work. Use **context7** for current HeyGen API docs
(`/websites/heygen`, `/websites/developers_heygen`) rather than guessing endpoints.
