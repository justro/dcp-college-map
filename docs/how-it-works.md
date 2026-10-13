# How the map works

This document is for whoever maintains the map: the school's web team, or a developer helping
them. It explains the moving parts, where things live, and what is safe to change.

## The short version

There are two halves:

1. **A build script** (`scripts/build_data.py`) that runs on someone's computer once a year. It
   reads the matriculation report, counts graduates per school, looks up where each school is and
   what its logo looks like, and writes one JSON file plus a folder of logo images.
2. **A web control** (`web/dcp-college-map.js` + `.css`) that runs in visitors' browsers. It loads
   that JSON file and draws the maps. It has no server, no database, and no build step.

Everything in `web/` is static files. A second script (`scripts/bundle.py`, run automatically at
the end of the build) packs all of it into the single files in `dist/`, which is what the school
uploads to its own website. GitHub Pages serves `web/` only as a demo.

## The data file

`web/data/matriculation.json` looks like this (abbreviated):

```json
{
  "generated": "2026-10-12",
  "source": "college_matriculation_summary.xlsx",
  "years": ["2024", "2025", "2026"],
  "totalStudents": 880,
  "schools": [
    {
      "id": "university-of-illinois-urbana-champaign",
      "name": "University of Illinois Urbana-Champaign",
      "city": "Champaign", "state": "IL", "stateName": "Illinois",
      "country": "US", "countryName": "United States", "region": "United States",
      "type": "Public, 4-year or above",
      "lat": 40.104718, "lon": -88.229114,
      "website": "illinois.edu",
      "logo": "logos/university-of-illinois-urbana-champaign.png",
      "total": 100,
      "byYear": { "2024": 18, "2025": 39, "2026": 43 }
    }
  ]
}
```

Only aggregate counts are stored. There is nothing about individual students, and the build script
checks for that before writing (see [refreshing-data.md](refreshing-data.md#privacy)).

State and country totals are not stored; the control adds them up in the browser so the
"Class of …" filter can recompute everything instantly.

## The build script, step by step

1. **Read the export.** Accepts `.xlsx` or `.csv`. Column headers are matched case-insensitively,
   so `College`, `Class Of`, `City`, `State`, `Country` work however they are capitalized. Other
   columns (`Student ID`, `Name`, `College Type`, …) are ignored or used only for the school's type.
2. **Apply aliases.** `data/overrides.json` → `aliases` merges two spellings of the same school
   (for example an Italian and an English name for the same university).
3. **Aggregate.** One record per school with `total` and `byYear` counts.
4. **Locate each school.**
   - U.S. schools are matched against `data/ipeds-institutions.csv`, a trimmed copy of the federal
     IPEDS directory (name, city, state, website, latitude, longitude for every U.S. institution).
     Matching is by normalized name, then by same-city prefix (handles "Arizona State University"
     vs. "Arizona State University Campus Immersion"), then a strict fuzzy match within the same city.
   - Anything unmatched (all international schools) is geocoded with OpenStreetMap's Nominatim
     service, first by school name and city, then by city alone. Nominatim allows one request per
     second, which the script respects.
   - Results are saved to `data/geocode-cache.json`, so later runs only look up new schools.
   - `data/overrides.json` → `schools` always wins, for hand-corrected coordinates.
5. **Fetch logos.** For each school with a known website, the script looks for a high-resolution
   icon declared in the site's HTML (`apple-touch-icon`, large `icon` links, SVG icons), then falls
   back to Google's and DuckDuckGo's favicon services. Images are normalized to PNG (SVGs kept as-is)
   and saved to `web/logos/<school-id>.png`. Existing logos are kept unless `--refetch-logos` is passed.
   Schools without a logo show their initials in a navy tile.
6. **Privacy check and write.** The output is checked for unexpected keys, student IDs, and
   name-like strings, then written to `web/data/matriculation.json`.
7. **Bundle.** `scripts/bundle.py` concatenates D3, topojson-client, the U.S. states and (lighter,
   110m) world shapes, the data, the stylesheet, and the control into `dist/dcp-college-map.bundle.js`,
   with every logo shrunk to 64px and inlined as a data URI. It also wraps the same script in a
   bare page, `dist/dcp-college-map.html`, for iframe use. The control detects the bundle through
   `window.DCP_COLLEGE_MAP_BUNDLE` and skips all network fetches when it is present.

### Reference files

| File | What it is | Edit by hand? |
| --- | --- | --- |
| `data/overrides.json` | Aliases and manual fixes | Yes, this is the place for fixes |
| `data/geocode-cache.json` | Automatic lookups so far | Rarely; delete an entry to force a re-lookup |
| `data/ipeds-institutions.csv` | IPEDS directory (HD2023) | No; replace with a newer IPEDS "HD" file if needed |
| `web/logos/` | Logo images | Yes, drop in a better image and point to it from overrides |

## The web control

`dcp-college-map.js` is a single self-contained script (no framework, no bundler). When it loads it:

1. Finds its own URL and uses that folder as the base for `data/`, `logos/`, and `vendor/`
   (override with `data-base="…"` on the container). In the single-file build everything is
   already in memory and this step is skipped.
2. Injects its stylesheet and the two brand web fonts (Libre Bodoni as a stand-in for Bodoni URW,
   Source Sans 3 as the web Source Sans Pro) from Google Fonts.
3. Loads D3 and topojson-client from `vendor/` unless the page already has them.
4. Fetches the data file plus two map topologies: `vendor/states-10m.json` (U.S. states from
   us-atlas) and `vendor/countries-50m.json` (world countries from world-atlas).
5. Renders into every `<div data-dcp-college-map>` (or `#dcp-college-map`) on the page.

### Views

- **Overview.** An Albers USA projection (Alaska and Hawaii inset) shaded with a six-step
  threshold scale: 0, 1–2, 3–9, 10–29, 30–99, 100+. A red star marks DePaul Prep.
- **Insets.** One cutout per international region that appears in the data. The region for each
  country is assigned in the build script (`REGIONS`), and the bounding box each inset shows is in
  the JS (`REGION_VIEWS`). Adding a new country means adding it to both lists plus the ISO number
  table (`ISO_NUM`) in the JS.
- **Detail.** Clicking a state or country cross-fades to a view fitted to that shape. For a
  country whose schools sit in one small area (Canada, where every school is in southern Ontario)
  the view zooms to a padded box around the schools instead, with neighbours drawn for context.
  Each school gets a pennant sized by its count. A small force simulation nudges overlapping flags
  apart (the Chicago cluster, for instance); the dot at the foot of each flag always stays on the
  school's true location, and a dotted leader joins it to the flag when the flag was moved.
- **Side panel.** Totals and the most-attended schools; in detail view, the full school list for
  the selected place. Hovering a list item highlights its flag, clicking it opens the flag's card.

### Interaction and accessibility

- Hover shows tooltips; click/tap on a flag pins its card (useful on touch screens).
- States, countries, and flags are focusable buttons: Tab to them, Enter to activate, Escape to go
  back. An `aria-live` region announces selections.
- Layout uses CSS container queries, so the control stacks vertically when *it* is narrower than
  about 760px, regardless of the page width. This matters inside CMS columns and iframes.
- Inside an iframe the control posts its height to the parent
  (`{ type: "dcp-college-map:height", height }`) so the embedding page can auto-size it.

### Customizing

| Want to change | Where |
| --- | --- |
| Heading text | `data-title="…"` on the container |
| Colors, fonts, radius | CSS custom properties at the top of `dcp-college-map.css` (`--dcp-navy`, …) |
| Choropleth breaks or palette | `BREAKS` and `COLORS` near the top of the JS |
| Which international regions exist and what they show | `REGIONS` in the build script, `REGION_VIEWS` + `ISO_NUM` in the JS |
| Home star | `HOME` constant in the JS |
| Number of schools in the overview list | `schoolListHtml(schools, 12, …)` in `renderPanel` |

### Browser support

Any browser from 2023 on: the only notable requirements are CSS container queries and `fetch`.
That covers current Chrome, Edge, Safari 16+, Firefox 110+, and iOS 16+.

## Hosting

The school hosts the map itself by uploading a file from `dist/` to its website's file manager;
see [embedding.md](embedding.md). The repository's GitHub Actions workflow
(`.github/workflows/pages.yml`) also publishes `web/` to GitHub Pages, but only as a demo and a
convenient place to preview a data refresh before uploading. The multi-file `web/` folder can be
copied to any static host too; the control only uses paths relative to its own script.
