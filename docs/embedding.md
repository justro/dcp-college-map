# Embedding the map in the school website

The map is published at **https://justro.github.io/dcp-college-map/** and can be embedded in any
web page in two ways. Pick whichever your CMS makes easier; both show the same control and both
update automatically when the data is refreshed.

## Option A: script tag (preferred when the CMS allows custom HTML)

```html
<div data-dcp-college-map></div>
<script src="https://justro.github.io/dcp-college-map/dcp-college-map.js" defer></script>
```

The control renders directly in the page, fills the width of whatever column it is placed in, and
grows to its natural height. Optional attributes on the `<div>`:

```html
<div data-dcp-college-map
     data-title="Where Our Graduates Go"
     data-base="https://justro.github.io/dcp-college-map/"></div>
```

- `data-title` changes the heading.
- `data-base` is only needed if you copy the script somewhere else but want it to keep loading
  data and logos from the published location.

## Option B: iframe (works everywhere)

```html
<iframe src="https://justro.github.io/dcp-college-map/embed.html"
        title="Where DePaul Prep graduates go to college"
        width="100%" height="780"
        style="border:0; max-width:100%;"
        loading="lazy"></iframe>
```

This is the same mechanism as the current Google My Maps embed, so any CMS block that accepts the
old iframe accepts this one. The fixed `height` is the only drawback: on a phone the control
stacks vertically and gets taller than 780px. Two ways to handle that:

1. **Pick a height that fits the layout you care about** (780px is right for a desktop column of
   700px or more; use about 1400px for a phone-only page) and accept scrolling inside the frame
   otherwise.
2. **Auto-size with a few lines of script.** The control sends its height to the parent page
   whenever it changes:

   ```html
   <iframe id="dcp-map" src="https://justro.github.io/dcp-college-map/embed.html"
           title="Where DePaul Prep graduates go to college"
           width="100%" height="780" style="border:0; max-width:100%;" loading="lazy"></iframe>
   <script>
     window.addEventListener("message", function (e) {
       if (e.origin === "https://justro.github.io" && e.data && e.data.type === "dcp-college-map:height") {
         document.getElementById("dcp-map").style.height = e.data.height + "px";
       }
     });
   </script>
   ```

The embed page sends no cookies and loads nothing from the school's domain.

## Notes for the current site (Finalsite)

`depaulprep.org` is served by Finalsite Composer behind Cloudflare. The College Planning page
already embeds a Google My Maps iframe, so the simplest change is to edit that same content block
and replace the iframe with Option B. If the page editor offers an "Embed" or "HTML" element,
Option A also works there.

Finalsite's content filter can strip `<script>` tags from ordinary rich-text blocks. If the script
embed disappears after saving, use an Embed/HTML element, or fall back to the iframe.

## Notes for Blackbaud (future site)

Blackbaud's school website builder has an **Embed** content type for iframes and a **Custom HTML**
(sometimes labelled "HTML" or "Code") content type for raw markup:

- **Embed** block: paste the Option B iframe. This is the lowest-risk path.
- **Custom HTML** block: paste Option A. If Blackbaud strips the `<script>` tag or sandboxes the
  block, use the iframe instead.

Blackbaud sites are served over HTTPS, as is GitHub Pages, so there are no mixed-content issues.
If the school's IT team restricts third-party frames with a `Content-Security-Policy`, they will need
to allow `https://justro.github.io` in `frame-src` (iframe) or `script-src` and `connect-src`
(script embed).

## Hosting it yourself instead of GitHub Pages

Copy the entire `web/` folder from the repository to any static host (the school's own web space,
Blackbaud's file manager, S3, Netlify, …) and point the embed at that location:

```html
<div data-dcp-college-map></div>
<script src="https://www.depaulprep.org/college-map/dcp-college-map.js" defer></script>
```

All paths inside the control are relative to the script's own folder, so nothing else changes.
Keep the folder structure (`data/`, `logos/`, `vendor/`) intact. To update the data later, copy the
new `web/data/matriculation.json` and `web/logos/` over the old ones.

## Checklist after embedding

- [ ] The map loads on desktop and on a phone.
- [ ] Hovering a state shows the tooltip; clicking it zooms in; "Back to map" returns.
- [ ] Flags show logos (a few schools without a public logo show their initials; that is expected).
- [ ] The "Class of …" buttons change the counts.
- [ ] Nothing else on the page is restyled (the control's CSS is scoped under `.dcpcm`).

## Troubleshooting

| Problem | Likely cause and fix |
| --- | --- |
| Blank box, no map | Script was stripped by the CMS. Use the iframe. |
| "Sorry, the college map could not be loaded" | The browser could not fetch the data file. Check that `data-base` (if set) ends with `/` and that the site's CSP allows `justro.github.io`. |
| Map is squashed or the side panel is below the map on desktop | The containing column is narrower than ~760px, so the control stacks. Give it a wider column or accept the stacked layout. |
| Fonts look different from the rest of the site | Expected: the control loads its own brand fonts (Libre Bodoni and Source Sans 3). Adjust `--dcp-font-title` and `--dcp-font-body` in the CSS if the site should win. |
| Old data showing | GitHub Pages caches for up to 10 minutes; hard-refresh. |
