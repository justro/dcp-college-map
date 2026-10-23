# Refreshing the data

Do this once a year (or whenever the college counseling office updates its matriculation report).
It takes about ten minutes, most of it waiting for the script.

## What you need

- The matriculation report, exported from Naviance/SCOIR/Numbers as **Excel (.xlsx)** or **CSV**.
  It must contain these columns (any order, any capitalization):

  | Column | Example | Notes |
  | --- | --- | --- |
  | College | University of Iowa | Name as it appears in the report |
  | Class Of | 2027 | Graduating class |
  | City | Iowa City | Used to locate the school |
  | State | IA | Two-letter code for U.S. schools; province/region for others |
  | Country | US | `US`, or a country name/code such as `Italy`, `CA`, `GB` |

  Other columns are fine and are ignored. From Numbers: **File → Export To → CSV…** (or Excel).

- Python 3.9 or newer, and this repository cloned locally (`git clone https://github.com/justro/dcp-college-map.git`).
- An internet connection the first time new schools appear (for geocoding and logos).

## Steps

```bash
cd dcp-college-map
git pull

# 1. Put the export where the script looks for it (this folder is git-ignored)
cp ~/Downloads/college_matriculation_summary.xlsx data/raw/

# 2. One-time setup of the Python dependencies
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r scripts/requirements.txt

# 3. Build
python3 scripts/build_data.py
```

The script prints what it does. Look for three kinds of lines:

- `[ipeds-exact]`, `[ipeds-prefix]`, `[nominatim]` are normal: how each school was located.
- `[UNRESOLVED]` means a school could not be located. It will still appear in lists and counts but
  not get a flag. Fix it in `data/overrides.json` (below) and run again.
- `WARNING` at the end summarizes anything that needs attention.

The script finishes by regenerating the single-file builds in `dist/`. Preview them by opening
`dist/dcp-college-map.html` directly in a browser (double-click it) and clicking around.

Then publish:

1. **Upload** `dist/dcp-college-map.bundle.js` and/or `dist/dcp-college-map.html` to the website's
   file manager, replacing the previous copies and keeping the same file names. See
   [embedding.md](embedding.md#updating-the-map-each-year), including the note on cache busting.
2. **Commit** so the repository matches what is live:

   ```bash
   git add web/data web/logos data/logos dist data/geocode-cache.json data/overrides.json
   git commit -m "Update matriculation data for the Class of 2027"
   git push
   ```

   The push also refreshes the GitHub Pages demo, which is handy for checking a build on a phone.

### Script options

```
python3 scripts/build_data.py [path/to/export.xlsx] [--no-network] [--refetch-logos]
```

- With no path, the newest `.xlsx`/`.csv` in `data/raw/` is used.
- `--no-network` skips geocoding and logo downloads (fine for a re-run when nothing is new).
- `--refetch-logos` re-downloads every logo instead of keeping the ones already in `web/logos/`.
- `python3 scripts/bundle.py` on its own regenerates `dist/` from `web/` (for example after editing
  the CSS or dropping in a better logo). Run it with the venv active, like the build script; without
  Pillow it warns and produces a much larger file.

## Fixing things by hand: `data/overrides.json`

```json
{
  "aliases": {
    "Catholic University of the Sacred Heart": "Universita Cattolica del Sacro Cuore"
  },
  "schools": {
    "Universita Cattolica del Sacro Cuore": {
      "name": "Università Cattolica del Sacro Cuore",
      "lat": 45.4627, "lon": 9.1766,
      "website": "unicatt.it"
    },
    "Some College": { "logo": "some-college.png" },
    "Other College": { "logo": "https://example.edu/brand/logo.png" }
  }
}
```

- **`aliases`** merges a name in the export into another name. Use it when the same school shows up
  under two spellings.
- **`schools`** is keyed by the school name as it appears in the export (after aliases). Fields:
  - `name`: display name (accents, preferred capitalization). The script already tidies the
    export's federal (IPEDS) names: campus suffixes such as "-Main Campus" or "-Seattle Campus" are
    dropped and "St" becomes "St.". Use `name` for anything else ("Miami University-Oxford" is shown
    as "Miami University" this way).
  - `lat`, `lon`: coordinates, when the automatic lookup is wrong or missing. Google Maps
    right-click → the first item copies them.
  - `website`: domain used to find the logo and (if no coordinates are cached) nothing else.
  - `logo`: either a URL to download, or the filename of an image you have placed in `web/logos/`.
    Square PNGs or SVGs around 128–256px look best.

After editing overrides, run the script again. Overrides are applied on every run and always win.

### Better logos: `data/logos/`

Downloaded logos are often small website icons. To use a hand-picked image instead (for example
one from College Counseling's logo folder):

```bash
python3 scripts/add_logo.py university-of-iowa ~/Downloads/iowa-hawkeyes.png
python3 scripts/build_data.py --no-network
```

The first argument is the school's `id` from `web/data/matriculation.json`. The script trims empty
margins, centers the logo on a square, scales it to 192px, and saves it as
`data/logos/<school-id>.png` (SVGs are copied as they are). The build prefers a logo in
`data/logos/` over a downloaded one, even with `--refetch-logos`; only a `logo` set for the school
in `data/overrides.json` takes precedence, so remove that entry if you add a hand-picked logo
instead. PNG, JPEG, GIF, WebP and TIFF
work; convert Photoshop or Illustrator files to PNG first (on a Mac:
`sips -s format png logo.psd --out logo.png`). Square marks read better than wide wordmarks, since
logos are shown in a small square tile.

### When a school is located in the wrong place

Delete its entry from `data/geocode-cache.json` and re-run, or set `lat`/`lon` in overrides.

### When a new country appears

Countries are grouped into insets ("Canada", "Europe", "Asia & Pacific", "Middle East & Africa",
"Mexico & Caribbean"). The script knows about 30 common countries; an unknown one lands in an
"Other International" inset that shows the whole world. To place it properly, add the country to
`COUNTRY_ALIASES`, `COUNTRY_NAMES`, and `REGIONS` in `scripts/build_data.py`, and to `ISO_NUM` in
`web/dcp-college-map.js` (the ISO 3166-1 numeric code, e.g. Germany is `"276"`).

## Privacy

The export includes student names and ID numbers. The process is designed so they cannot reach
the website:

- `data/raw/` is listed in `.gitignore`, so the export can't be committed by accident.
- The script only ever writes aggregated per-school counts.
- Before writing, it verifies the output contains only the expected fields, no student ID values,
  and no "Last, First" name strings. If any check fails it stops without writing.

If you ever see a student name anywhere under `web/`, stop and do not push.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `No .xlsx or .csv export found` | Put the file in `data/raw/` or pass its path as the first argument |
| `openpyxl is required` | `pip install -r scripts/requirements.txt`, or export as CSV instead |
| A school is matched to the wrong IPEDS institution (check the `->` name in the log) | Add `lat`/`lon` (and `website`) to overrides |
| Logo is wrong or low quality | `python3 scripts/add_logo.py <school-id> <image>`, then re-run the build (see [Better logos](#better-logos-datalogos)) |
| Geocoder errors (`nominatim error …`) | Usually rate limiting or no network; re-run later. Cached schools are not re-requested |
| Website shows old data after uploading | The site cache is serving the old file; hard-refresh or add `?v=2027` to the embed URL |
