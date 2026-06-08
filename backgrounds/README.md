# Backgrounds

Drop scene background images here (`.png`, `.jpg`, `.jpeg`, `.webp`) — e.g. the
ones your teammate generates from prompts like *"cozy living room with natural
daylight"* or *"clean home office with a laptop and bookshelf"*.

On each `sample` / `production` / `resume` run, every image in this folder is
**uploaded to HeyGen once** (the returned `image_asset_id` is cached in
`.cache/backgrounds.json`, so re-runs don't re-upload) and then **rotated across
videos** as the avatar's background. Add or remove images freely — the rotation
pool is simply whatever's in this folder.

If this folder is empty, videos fall back to `pools.v2.backgrounds` in
`src/config.ts` (a placeholder color).

> Tip: portrait scenes (9:16) match the default video orientation best.
