# Operator Guide — Making Promo Videos

For the person creating the videos. **No coding needed** — you edit a spreadsheet and
run one command.

---

## One-time setup (a developer does this once)

1. Install **Node.js 20+** (`brew install node` on a Mac).
2. In this project folder, run `npm install`.
3. Copy `.env.example` to `.env.local` and paste the `HEYGEN_API_KEY`.
   (`ANTHROPIC_API_KEY` is only needed if a product row has no script — when you
   write the script yourself in the sheet, you can skip it.)
4. Confirm it works: `npm run check` — it prints the effective config.

After that, your day-to-day is just the two steps below.

---

## Everyday flow

You work in the **Terminal**, inside this project folder.
*(Tip: in Finder, right-click the folder → “New Terminal at Folder”.)*

### 1. Edit your product list
Open **`data/products.csv`** (double-click → opens in Numbers/Excel). One row per
product:

| Column | What to put |
|---|---|
| `row_id` | *Optional.* A short id (e.g. `heart`, `love`). Only needed to separate two rows that are otherwise identical. |
| `product_name` | The product/offer name (fine to repeat — see below) |
| `script` | The exact words the avatar speaks — **keep under ~140 words (≈60s)** |
| `gender` | `male` or `female` — picks a matching presenter |
| `orientation` | Leave as `portrait` (TikTok / Reels / Shorts) |

💡 **One product, many videos is fine.** Rows that share a `product_name` but have a
**different script** (or a different `gender`) are kept as separate videos automatically
— ideal for several promos for the same offer. You'll only see a "duplicate" message if
two rows are *truly identical* (same product, same script, same gender); to keep both,
give one a `row_id` or change its wording.

Save it — keep the format as **CSV**.

### 2. Generate
```
npm start
```
It reads your sheet, then shows a **plan** before charging anything:

> `Here's what will be generated:`
> `  1. Before and After  ·  presenter A`
> `     "Before: I couldn't sit in a quiet room…"`
> `  2. Before and After  ·  presenter B`
> `     "A year ago my tinnitus was a 7 out of 10…"`
> `  …`
> ``
> `5 videos · 5 distinct presenters.`
> `Ready to generate 5 videos (avatar_v · 1080p) — est. cost ≈ $16.67.`
> `Generate 5 videos for ~$16.67? (y/n)`

- Type **`y`** and press Enter → it makes every video. As each one finishes you'll see a
  line like `✓ [2/5] Before and After (47s)`. When it's done it prints where the files
  are and a review link — `open outputs/…/index.html` — open that to watch them.
- Type **`n`** → nothing is made, no charge.

**"presenter A / B / C…"** are different avatars — the tool automatically gives each
video in a run a distinct presenter so they don't all look the same. Check the plan to
make sure the scripts and the count look right before you type `y`.

(Want the plan **without** the confirmation step? Run `npm run preview`.)

---

## Costs (no surprises)
- About **$2–$4 per video** (Avatar V is ~$4 per minute, and clips are under a minute).
- `npm start` **always shows the total and asks first** — nothing is charged until you type `y`.

## If something goes wrong
- **“missing API key”** → the keys in `.env.local` aren’t set (setup step 3).
- **“credits exhausted” / it stopped partway** → run `npm run resume -- <run id>`
  (the id is in the folder name under `outputs/`); finished videos are skipped, so
  you’re never charged twice.
- Still stuck? Send the developer the run id and the message you saw.

## Changing the presenters
The avatars + voices live in `src/config.ts` (`pools.iv`). Ask the developer to add or
swap them — pick neutral, professional looks (no held mics, logos, or holiday scenes).
