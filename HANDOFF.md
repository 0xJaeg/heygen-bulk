# Operator Guide — Making Promo Videos

For the person creating the videos. **No coding needed** — you edit a spreadsheet and
run a few simple commands in the Terminal.

---

## One-time setup (a developer does this once)

1. Install **Node.js 20+** and **ffmpeg** (`brew install node ffmpeg` on a Mac).
2. In this project folder, run `npm install`.
3. Copy `.env.example` to `.env.local` and paste the two API keys
   (`ANTHROPIC_API_KEY`, `HEYGEN_API_KEY`).
4. Confirm it works: `npm run check` — it prints the effective config.

After that, your day-to-day is just the steps below.

---

## Everyday flow

You work in the **Terminal**, inside this project folder.
*(Tip: in Finder, right-click the folder → “New Terminal at Folder”.)*

### 1. Edit your product list
Open **`data/products.csv`** (double-click → opens in Numbers/Excel). One row per
product:

| Column | What to put |
|---|---|
| `product_name` | The product name (required) |
| `gender` | `male` or `female` — picks a matching presenter |
| `script` | The exact words the avatar speaks (keep under ~140 words ≈ 60s) |
| `orientation` | Leave as `portrait` (TikTok / Reels / Shorts) |

Save it — keep the format as **CSV**.

### 2. Preview — free, no videos made
```
npm run preview
```
Shows each script and the estimated cost. **No money spent.** Fix the sheet if needed.

### 3. Make a few samples to review
```
npm run sample
```
Makes the first 3 videos, then prints a line like
`Review the sample: open outputs/2026-…__SAMPLE/index.html`.
Open that file in your browser to watch them.

### 4. Happy? Approve, then make them all
The sample run prints the **exact two commands** to run next — copy/paste them:
```
npm run approve -- 2026-…        ← the run id it showed you
npm run make
```
`npm run make` generates a video for **every** product in the sheet. Finished videos
land in the newest folder under `outputs/` (open its `index.html` to watch).

---

## Costs (no surprises)
- Roughly **$1 per minute** of video — a 30-second video ≈ **$0.50**.
- `npm run preview` always shows the estimate first and never spends.
- Large batches ask you to confirm before spending.

## If something goes wrong
- **“missing API key”** → the keys in `.env.local` aren’t set (setup step 3).
- **“ffmpeg not found”** → install ffmpeg (setup step 1).
- **A video failed** → run `npm run resume -- <run id>`; it skips the ones already
  done, so you’re never charged twice.
- Still stuck? Send the developer the run id and the message you saw.

## Changing the look
- **Backgrounds:** drop image files into the **`backgrounds/`** folder — they’re used
  automatically and rotated across videos.
- **Presenters (avatars/voices):** ask the developer; these live in `src/config.ts`.
