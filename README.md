# Personal Bookmarks

A fast, private bookmark dashboard. One URL in Chrome, 215 links, instant search.

**Live:** https://ritesh0710.github.io/personal-bookmarks/

Nothing here runs on your PC. The site is static files on GitHub Pages; the
bookmarks live in a private gist on your GitHub account. Delete this folder and
the site keeps working.

## Architecture

```
Chrome  ──►  GitHub Pages (static HTML/CSS/JS)  ──►  api.github.com  ──►  private gist
             no server, no build step                 your token          the data
```

| Piece | What it is |
|---|---|
| Frontend | Three files — `index.html`, `app.css`, `app.js`. No framework, no build, no npm, zero runtime dependencies. |
| Hosting | GitHub Pages, served from `main` at the repo root. |
| Data | One private GitHub gist holding `personal-bookmarks.json`. |
| Auth | A GitHub token with the `gist` scope, stored in your browser's `localStorage`. |
| Extras | Six self-contained dashboards under `tools/`, carried over from the old project. |

### Why a gist and not a database

The requirement was a hosted source of truth that survives losing this PC, is
free, and stays private. A gist meets all of it with no backend to run:

- **Private.** Bookmarks include capability URLs — a personal finance tracker, a
  PhonePe statement, Google Sheets and Docs ids. Those cannot sit in a public
  repo, and they don't: this repo holds code only. The gist id is not committed
  anywhere either; the app finds the gist by filename through the authenticated
  `/gists` listing, so nothing public points at your data.
- **Free and permanent.** No trial, no cold starts, no card on file, no second
  vendor to keep alive.
- **Versioned for free.** Every save is a gist revision, so the history is your
  backup — see *Backup* below.
- **Instant saves.** Writes go straight to the GitHub API, so a change is live
  on the next refresh. Committing data to the repo instead would mean waiting on
  a Pages rebuild after every edit.
- **Trivial to migrate.** The data is one plain JSON file. Export it, point
  anything else at it.

A serverless function plus a hosted database (Cloudflare KV, Supabase, and so
on) would also work, but adds an account, a deploy pipeline and a secret to
manage for a single-user list of links.

The trade-off: editing requires pasting a token into each browser once. Reading
requires it too, which is the point — the data is not public.

## First run on a new browser

1. Open the site. It asks for a token.
2. Create one at [github.com/settings/tokens/new](https://github.com/settings/tokens/new?scopes=gist&description=Personal%20Bookmarks) — tick **gist** and nothing else.
3. Paste it in. That browser remembers it; the app finds your gist by filename.

The token is only ever sent to `api.github.com`. It is never committed, and with
only the `gist` scope it cannot touch your repositories. *Sign out of this
browser* in the ⋮ menu clears it.

## Using it

| Key | Action |
|---|---|
| `/` or `Ctrl`+`K` | Focus search |
| `↑` `↓` | Move through results |
| `Enter` | Open the highlighted result |
| `N` | Add a bookmark |
| `Esc` | Clear search |

Search combines terms with AND across title, URL, description, category and
group — `youtube english` narrows to the English channels. Hover a card for the
edit pencil. Categories are managed from the ⋮ menu.

## Deployment

Push to `main` and GitHub Pages republishes in about a minute. There is no build
step and no CI to configure — Pages serves the repo root as-is. `.nojekyll`
keeps Jekyll from touching the files.

```bash
git add -A && git commit -m "..." && git push
```

**One rule when editing `app.css` or `app.js`:** bump the `?v=` number on both
links in `index.html`. Pages caches every file for 10 minutes, so without the
bump a browser can pair a fresh `index.html` with a stale stylesheet.

To work on it locally, open `index.html` through any static file server; there is
nothing to install. Local work is optional — the deployed site is the product.

### Network calls the site makes

Only two, both from your browser: `api.github.com` for your data, and
`www.google.com/s2/favicons` for site icons (which tells Google the domains in
your list, but never the full URLs). Icons that fail to load fall back to a
coloured letter badge — nothing breaks offline.

## Environment variables

None. There are no secrets in this repo and nothing to configure at build time.
The only credential is the token in your browser.

## Backup and migration

- **Export** — ⋮ → *Export backup* downloads `bookmarks-YYYY-MM-DD.json`.
- **Import** — ⋮ → *Import backup* replaces the gist contents with a file.
- **History** — the gist keeps every revision. Open the gist on GitHub and use
  *Revisions* to see or restore any earlier state.
- **Moving off GitHub** — the exported JSON is the whole dataset:
  `{ version, categories: [{id, name, desc}], bookmarks: [{id, title, url, desc, cat, group}] }`.

## What came from the old project

Rebuilt from `T150C`, which was a 257 KB generated HTML page plus a Python build
pipeline. Preserved: all 215 bookmarks, the 12-category taxonomy, the 28
sub-sections, and the six dashboards (now in `tools/`, deduplicated and hosted
rather than opened from disk). Dropped: `build.py`, `add.py`, the raw Chrome
export, the duplicate tracker, the base64 favicon inlining, and every local file
path. The old repo is untouched.
