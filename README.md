# Fried Egg Golf — Webflow site scripts

Custom JavaScript for **thefriedegg.com** (Webflow), loaded from this repo via jsDelivr,
**pinned to a commit SHA** so the live site never changes without a deliberate update.

| Script | Used on | Loaded from |
|---|---|---|
| `feg/guides.js` → `feg/guides.min.js` | Guides Template (`/guides/<slug>`) | Page settings → Footer code |

## Deploying a change

1. Edit `feg/guides.js`, then rebuild the minified file:
   ```sh
   npx esbuild feg/guides.js --minify --target=es2020 --outfile=feg/guides.min.js
   ```
2. Commit and push. Note the new commit SHA.
3. In Webflow → Pages → Guides Template → Settings → **Footer code**, update the tag:
   ```html
   <script defer src="https://cdn.jsdelivr.net/gh/beau-fried-egg-golf/friedegg-webflow-scripts@<SHA>/feg/guides.min.js"></script>
   ```
4. Publish to the `webflow.io` staging subdomain first, check a few guides, then publish to production.

## How guide items are ordered (for editors)

On a Guide, the **Content Ordering** rich-text field decides the on-page order: one `{{slug}}`
per line, using the slug of the `[Guide] Course` or `[Guide] Location` item. Anything not listed
there is appended after the listed items (all Locations in their reference order, then all
Courses). Matching ignores case, spaces and invisible characters, so pasted tokens are safe —
but a slug that is simply missing from the field will fall to the bottom.

## History

`feg/guides.original.js` is the agency version this was forked from (Neon-Hive/webflow, Jan 2026),
kept for diffing. See the header comment in `feg/guides.js` for the list of fixes.
