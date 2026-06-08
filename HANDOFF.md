# Operator Guide — Making Promo Videos

For the person creating the videos. **No coding needed** — you edit a spreadsheet and
run one command.

---

## One-time setup (a developer does this once)

1. Install **Node.js 20+** (`brew install node` on a Mac).
2. In this project folder, run `npm install`.
3. Copy `.env.example` to `.env.local` and paste the two API keys
   (`ANTHROPIC_API_KEY`, `HEYGEN_API_KEY`).
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
| `row_id` | A short **unique** id for each row (e.g. `heart`, `open`, `love`). Required whenever rows share a `product_name`. |
| `product_name` | The product/offer name (can repeat across rows if `row_id` is unique) |
| `script` | The exact words the avatar speaks — **keep under ~140 words (≈60s)** |
| `gender` | `male` or `female` — picks a matching presenter |
| `orientation` | Leave as `portrait` (TikTok / Reels / Shorts) |

⚠️ **Every row needs its own `row_id`.** If two rows share a `product_name` and have no
`row_id`, the tool treats them as the same video and only makes one. (You'll see a
"duplicate id" message if that happens.)

Save it — keep the format as **CSV**.

### 2. Generate
```
npm start
```
It reads your sheet, then shows something like:

> `Ready to generate 12 videos (avatar_v, 1080p) — est. cost ≈ $32.00.`
> `Generate 12 videos for ~$32.00? (y/n)`

- Type **`y`** and press Enter → it makes every video and prints a link
  (`Done. Watch them: open outputs/…/index.html`). Open that file to watch them.
- Type **`n`** → nothing is made, no charge.

That’s it. (Want to see the scripts + cost **without** making anything? Run
`npm run preview`.)

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
