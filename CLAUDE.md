# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Intent

A **standalone Node/TS service** that mass-produces short (<60s) AI-avatar promo
videos: a CSV/Google-Sheet of products → Claude writes one promo script per product
→ **HeyGen** renders the video. Built to QA a few samples, then scale to ~200–400/day.

`README.md` is the usage/reference doc. The approved design/plan is the architectural
source of truth: `/Users/christianjheggfermilan/.claude/plans/we-will-start-by-playful-galaxy.md`.

**Current state:** the full pipeline is implemented and unit-tested (84 tests) —
ingest → script-gen (cached) → HeyGen **Avatar IV/V** engine → `node:sqlite` ledger →
CLI (`dry-run`/`sample`/`approve`/`production`/`resume`) + `index.html` review page.
Validated end-to-end with audio on Avatar V.

**Default = `v3` (HeyGen Video Agent), "v3-strict" talking head.** The team compared
avatar_iv vs avatar_v (Avatar IV/V, the `iv` engine) vs the Video Agent and chose the
Video Agent constrained to a clean spokesperson: the engine **auto-wraps every v3 script
in a strict talking-head directive** (`heygen/v3-prompt.ts`) so it renders one continuous
shot — no b-roll/captions/scene-cuts (a vague prompt makes it auto-compose). Quality reads
on par with avatar_v at **~$2/min vs ~$3/min**. ⚠️ The agent *writes* its delivery, so
verbatim wording isn't guaranteed — set a row's `engine` to `iv` for an Avatar IV/V render
with an exact script. (The old v2 studio-avatar + composited-background path was removed —
git history has it.) **Presenter assignment is round-robin** (`config.rotation:
"round-robin"`, default): each video gets the next avatar/voice in its gender pool
(per-gender counter in `runPipeline`; `buildJobSpec` takes `rotationIndex`). Both engines
share one **photo-avatar pool** (`pools.iv`, ~15 female / 12 male public-stock looks vetted
via preview; `pools.v3` is unused). Remaining: confirm v3 verbatim fidelity; the team can
add their own uploaded looks by id.

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

Runs on Node `>=20` (developed on Node 26). `HEYGEN_API_KEY` is needed to render
(`.env` / `.env.local`); `ANTHROPIC_API_KEY` is **optional** — only required to *write*
a script for a row that has no `script` cell. An all-provided-script sheet (the default
workflow) needs no Anthropic key, and the CLI errors clearly up front if a row needs one.

**Operator shortcuts** (for the non-technical teammate — each bakes in
`--source data/products.csv`): `npm run check` (status) · `preview` (dry-run) ·
`sample` · `approve -- <id>` · `make` (production) · `pool` (list-pool). The product
list lives at **`data/products.csv`** (renamed from `examples/`); the one-page runbook
is **`HANDOFF.md`**.

## Architecture

Single-process Node/TS CLI. Data flow: **ingest → script (cached) → buildJobSpec →
engine (create/poll/download) → manifest + ledger**. Modules under `src/`:

- `ingest/` — `loadRows`: local CSV or published-Sheet CSV URL → `csv-parse` → per-row validate.
- `schema/row.ts` — `ProductRowSchema` (zod) + forgiving header mapping; empty cells → defaults. Optional `script` column (aliases VO/Voiceover/VSL): if set it's the spoken text used verbatim (Claude skipped) and `description`/`call_to_action` become optional (zod refine requires them only when no script). Optional `gender` (`male`/`female`, also `M`/`F`) selects a matching avatar+voice from the gender-split pool. Optional `avatar_engine` (`avatar_iv`/`avatar_v`) overrides `defaults.avatarEngine` per row (folded into the job id only when set, so existing sheets keep their ids) — used by `data/model-comparison.csv` to render the same script under both tiers side-by-side.
- `script/` — `generate` (Claude `messages.parse` + `zodOutputFormat`), `prompt` (cached system block + `PROMPT_VERSION`), `word-budget` (enforce <60s), `cache` (content-hash → reuse, drift-proof).
- `heygen/` — `client` (typed REST: `createIvVideo` → `/v3/videos`, `getStatusV3` → `/v3/videos/{id}` shared by both engines, V3 video-agents create/session, list avatars/voices/templates), `errors` (classify 429/credit/transient/permanent), `engine` (`processJob`/`runJobs`: concurrency cap, backoff polling, retries, credit circuit-breaker, download-on-complete; wraps v3 prompts via `v3-prompt`), `v3-prompt` (`talkingHeadPrompt` — the strict no-b-roll directive for the Video Agent), `download` (stream MP4 to disk).
- `jobs/build-job.ts` — stable `job_id`, **gender-aware** pool rotation (avatars/voices split male/female so a row's `gender` picks a matching pair), `buildJobSpec` (override → pool rotation → default). Rotation is round-robin (caller passes `rotationIndex`) or seeded-by-hash when no index is given.
- `store/job-store.ts` — `node:sqlite` ledger (idempotency + resume + cost).
- `cost/estimate.ts`, `ledger/manifest.ts` (manifest.json + index.html), `orchestrate/` (`run` pipeline + approval `gate`).

Two engines (per-row `engine`, else `defaults.engine = "v3"`): **v3** — the **default** —
HeyGen **Video Agent** (`POST /v3/video-agents`), auto-wrapped with the strict
talking-head prompt (`heygen/v3-prompt.ts`) for a clean spokesperson, ~$2/min, but writes
its own delivery (not guaranteed verbatim); **iv** — Avatar IV/V photorealistic **photo
avatars** via `POST /v3/videos`, ~$3/min, **guaranteed-verbatim** script (use per-row for
exact copy). Both render the same `pools.iv` looks. (The old `v2` studio-avatar engine was removed.)

## Conventions

- **ESM + NodeNext**: relative imports use the **`.js` extension** (e.g. `./config.js`). `zod` is imported as `zod/v4`.
- **Prettier**: no semicolons, double quotes, 2-space indent, trailing commas `es5`. Don't fight the formatter.
- **ESLint 9** flat config (`eslint.config.js`); avoid `any`.
- **Anthropic** (mirrors the sibling `email/apps/worker`): lazy `getAnthropic()` singleton; `messages.parse` + `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`; cached system block `cache_control: { type: "ephemeral", ttl: "1h" }`; default model `claude-haiku-4-5`.
- **Dependency injection for tests**: the engine/pipeline take injected `client`/`anthropic`/`download`/`sleep`; tests use mocks + a `:memory:` `JobStore` (no network, no keys).

## Gotchas (project-specific)

- **`node:sqlite`, NOT `better-sqlite3`** — `better-sqlite3` fails to compile on Node 26 (no prebuilt binary). The built-in needs no native build. `JobStore` `mkdir`s its parent dir before opening.
- **Download URLs expire (~7 days)** → the engine downloads each MP4 on completion; never store the signed `video_url` for later.
- **Avatar IV/V (`iv` engine, the default) = photo avatars, a different paradigm.** `client.createIvVideo` → `POST /v3/videos` `{type:"avatar", avatar_id:<photo-avatar look>, voice_id, script, aspect_ratio, resolution, engine:{type:"avatar_v"|"avatar_iv"}}`; poll the **same** `getStatusV3` (`GET /v3/videos/{id}`). The endpoint is **strict** (rejects unknown fields — `dimension`/`orientation`/`background`-as-string all 400); real engine tags are **`avatar_iv`/`avatar_v`** (NOT the docs' `avatar_4_*`). The photo avatar bakes in its own framing + background (no compositing/framing knobs); output size comes from `aspect_ratio`+`resolution`. Pool: `pools.iv` photo-avatar look ids, **parallel** with their matched default voices (`avatars[g][i]` ↔ `voices[g][i]`; `buildJobSpec` picks a shared index). Discover looks with avatar_iv/avatar_v support via `GET /v3/avatars/looks` (all `photo_avatar`). **Cost: 20 credits/min for BOTH avatar_iv and avatar_v** (HeyGen docs — engine choice doesn't change cost; avatar_v is just ~3× slower to render). Confirm the plan's credit→$ + balance on the dashboard before scale. **avatar_v fits real-human photo avatars (better lip-sync/gestures); avatar_iv suits stylized/non-human.**
- **Never re-create a job that has a `heygen_video_id`** — the engine re-polls the stored id instead (avoids double charges). `job_id = hash(productKey + variation + engine)`; `productKey` is the row's `row_id`, else a hash of everything that changes the rendered video — product_name + description + **provided script** + **gender** + orientation + avatar/voice overrides. (Hashing only product_name+description silently collapsed rows that share a name but differ by script or gender — e.g. several testimonials for one offer — into one job; the duplicate-id guard then dropped the rest. Give rows a unique `row_id` to be explicit.)
- **Script cache is content-hashed** by `model + promptVersion + grounding fields + variation` — approved QA scripts are reused verbatim and free at scale. Bump `PROMPT_VERSION` when changing the prompt.
- **Provided scripts bypass Claude** — a row's `script` column (if set) is used verbatim: no generation, no cache, no trim, `num_variations` ignored. Empty → Claude generates as before. So a sheet of all-provided scripts needs no Anthropic calls.
- **Cost**: Avatar IV/V = **20 HeyGen credits/min** (both tiers; per HeyGen docs); `pricePerMinuteUsd.iv` is a placeholder USD — set from the plan's credit→$. The cost guard warns/`--yes`-gates large runs. `MAX_CONCURRENCY` must match the HeyGen plan's concurrent-generation cap.
- **Review page**: `index.html` `<video src>` is a **basename** (resolves next to the file in the run dir) — keep it that way.

## Claude Code Skills

This is greenfield/standalone work — use **superpowers** skills (brainstorming,
TDD, systematic-debugging, verification-before-completion) and the **`claude-api`**
skill for any Anthropic SDK work. Use **context7** for current HeyGen API docs
(`/websites/heygen`, `/websites/developers_heygen`) rather than guessing endpoints.
