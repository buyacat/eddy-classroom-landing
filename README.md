# Eddy Classroom — landing

Bilingual (uk / en) marketing site for Eddy Classroom, built with Astro and
rendered to static HTML. Three interactive pieces carry the page: a cut-away
3D globe in the hero, a 3D model viewer in the library band, and a set of
animated SVG glyphs on the subject cards.

## Requirements

Node 18.17 or newer.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5178
```

## Scripts

| Script                  | What it does                                                        |
| ----------------------- | ------------------------------------------------------------------- |
| `npm run dev`           | Dev server on port 5178                                              |
| `npm run build`         | Static build into `dist/`                                            |
| `npm run build:pages`   | Build for the GitHub Pages preview (sets Astro's `base` sub-path)    |
| `npm run preview`       | Serve the last build                                                 |
| `npm run icons`         | Rasterise `src/assets/icon-src/*.svg` to 256px PNGs                  |
| `npm run check:layout`  | Verifies the globe's shells never overlap during the explode gesture |
| `npm run check:icons`   | Verifies drawn icons match the licensed pack's height/glare budget   |
| `npm run check:ambient` | Verifies ambient light pools fade out inside their own band          |

`check:ambient` needs the dev server plus a headless Chrome with remote
debugging on port 9333; the script header explains the invocation.

## Layout

```
src/
  pages/          index.astro (uk) and en/index.astro — both compose the same components
  layouts/        Layout.astro: <head>, metadata, JSON-LD, analytics
  components/     one band per file, each owning its own markup, styles and script
  data/uk|en/     all copy, as flat key/value JSON — no strings live in components
  scripts/        standalone TS modules for the two WebGL surfaces
  styles/         style.css: design tokens and the shared primitives (.btn, .card, .shot…)
  assets/         SVG sources for the hand-drawn icons
public/           static assets served as-is, plus the form endpoint
scripts/          build and design-contract checks, not shipped
```

### Copy and translation

Every user-visible string is a key in `src/data/<locale>/*.json`, read through
`t()` / `tArray()` (`src/utils/i18n.ts`). Both locales must carry the same key
set. Adding copy means adding a key, never a literal in a component.

### Paths

Root-relative URLs go through `withBase()` (`src/utils/url.ts`) so the site
works both at a domain root and under the GitHub Pages sub-path.

## Design contracts

Three visual rules are expensive to keep by eye, so they are scripted instead
of described: the globe's explode cascade, the ambient light pools, and the
icon set's material language. Each `check:*` script's header states the rule it
enforces and the numbers behind it. Run them after touching the globe, the band
backgrounds, or the icons.

## Lead form

The form posts to `public/send.php`, which relays through the Mandrill HTTP API.
The API key is read from the `MANDRILL_KEY` environment variable, or from a
`mandrill.key` file placed one level above the webroot — never from this repo.

## Deployment

`npm run build` outputs `dist/`, which is what gets deployed.

- `SITE_URL=https://example.com npm run build` also emits canonical, `og:url`
  and `hreflang` tags. Without it those are omitted rather than guessed.
- `npm run build:pages` builds the GitHub Pages preview instead.

## Conventions

- Comments explain constraints that are not visible in the code — a measured
  threshold, a browser quirk, a rule the layout depends on. Code that speaks
  for itself gets none.
- Code, comments and dev-script output are in English; Ukrainian lives in
  `src/data/uk/` and in user-facing copy only.
- Components are self-contained: markup, scoped styles and any script in one
  file. Only genuinely shared primitives belong in `style.css`.
