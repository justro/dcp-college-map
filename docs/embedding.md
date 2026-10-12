# Embedding the map in the school website

The map ships as **one file** that you upload to your website's file manager and then reference
from a page, the same way you would embed a PDF or a video. Nothing else needs to be hosted and
no outside service is involved (the only external request is for the two brand web fonts from
Google Fonts).

There are two flavours of that file in the `dist/` folder of this repository. Download whichever
fits how your CMS lets you add content:

| File | Use it when | Size |
| --- | --- | --- |
| `dist/dcp-college-map.bundle.js` | Your page editor lets you add raw HTML with a `<script>` tag | ~1.4 MB |
| `dist/dcp-college-map.html` | You want an `<iframe>` (works in any "Embed" block, like the current Google My Maps embed) | ~1.4 MB |

Both contain the control, the map shapes, the data, and the school logos. They are regenerated
every time the data is refreshed (see [refreshing-data.md](refreshing-data.md)).

## Step 1: upload the file to your site

**Finalsite (current site).** In Composer, open the **Files** (resource manager) area, upload
`dcp-college-map.bundle.js` and/or `dcp-college-map.html` into a folder such as `college-map`,
then use the file's **Copy link** action to get its URL. If the resource manager refuses `.js`
uploads, upload only the `.html` file and use the iframe method below.

**Blackbaud (future site).** In the website's **Files & Media** (resources) manager, upload the
file(s) and copy the resulting URL in the same way.

**Anywhere else.** Any web space that serves static files works: the school's own web server, a
Cloudflare Pages or Netlify site, an S3 bucket. Copy the file there and use its URL.

Whatever the host, you end up with a URL such as
`https://www.depaulprep.org/files/college-map/dcp-college-map.bundle.js`. The examples below use
`YOUR-FILE-URL` as a placeholder for it.

## Step 2: put it on the page

### Option A: script tag (preferred when the editor allows raw HTML)

```html
<div data-dcp-college-map></div>
<script src="YOUR-FILE-URL/dcp-college-map.bundle.js" defer></script>
```

The control renders directly in the page, fills the column it is placed in, and grows to its
natural height. To change the heading, add `data-title="…"` to the `<div>`.

### Option B: iframe (works everywhere)

```html
<iframe src="YOUR-FILE-URL/dcp-college-map.html"
        title="Where DePaul Prep graduates go to college"
        width="100%" height="780"
        style="border:0; max-width:100%;"
        loading="lazy"></iframe>
```

This is the same mechanism as the current Google My Maps embed, so the content block that holds
the old iframe can hold this one. The fixed `height` is the one drawback: on a phone the control
stacks vertically and gets taller than 780px. Either pick a height for the layout you care most
about (780px suits a desktop column of 700px or wider; about 1400px for phones) and accept a scroll
bar inside the frame otherwise, or let the frame size itself with a few lines of script:

```html
<iframe id="dcp-map" src="YOUR-FILE-URL/dcp-college-map.html"
        title="Where DePaul Prep graduates go to college"
        width="100%" height="780" style="border:0; max-width:100%;" loading="lazy"></iframe>
<script>
  window.addEventListener("message", function (e) {
    if (e.data && e.data.type === "dcp-college-map:height") {
      document.getElementById("dcp-map").style.height = e.data.height + "px";
    }
  });
</script>
```

The control sends that message whenever its height changes (after loading, after resizing, and
after switching between the overview and a state).

## Updating the map each year

1. Follow [refreshing-data.md](refreshing-data.md) to produce new files in `dist/`.
2. Upload them to the file manager **over the old ones, keeping the same file names**, so the
   page's embed code does not change.
3. If the page still shows the old data afterwards, the site's cache (depaulprep.org sits behind
   Cloudflare) is serving the previous copy. Hard-refresh, or add a version tag to the URL in the
   embed code, e.g. `dcp-college-map.bundle.js?v=2027`, which forces every browser to fetch the new file.

## Notes for the CMS editors

- Finalsite's rich-text editor can strip `<script>` tags. Use an Embed/HTML element, or the iframe.
- Blackbaud's page builder has an **Embed** content type for iframes and a **Custom HTML** type for
  raw markup. If the HTML type sandboxes or strips scripts, use the iframe.
- If the school's IT team enforces a `Content-Security-Policy`, scripts and frames from the site's
  own domain are normally allowed; a file hosted elsewhere would need that host added to
  `script-src` or `frame-src`.
- The control's CSS is scoped under `.dcpcm` and it resets the properties site stylesheets most
  commonly leak (heading colors, button backgrounds, text transforms), so it should not restyle the
  rest of the page and vice versa.

## Checklist after embedding

- [ ] The map loads on desktop and on a phone.
- [ ] Hovering a state shows the tooltip; clicking it zooms in; "Back to map" returns.
- [ ] Flags show logos (a few schools without a public logo show their initials; that is expected).
- [ ] The "Class of …" buttons change the counts.
- [ ] Nothing else on the page looks different.

## Troubleshooting

| Problem | Likely cause and fix |
| --- | --- |
| Blank box, no map | The `<script>` was stripped by the editor. Use the iframe. |
| Browser downloads the file instead of running it | The file manager serves `.js` with the wrong type. Use the `.html` file in an iframe. |
| "Sorry, the college map could not be loaded" | Only possible with the multi-file version in `web/`; the single-file build has nothing to fetch. Check the URL in the embed code. |
| Side panel sits below the map on desktop | The column is narrower than about 760px, so the control stacks. Give it a wider column or accept the stacked layout. |
| Fonts differ from the rest of the site | Expected: the control uses the brand typefaces (Libre Bodoni, Source Sans 3). Change `--dcp-font-title` and `--dcp-font-body` in `web/dcp-college-map.css` and rebuild if the site should win. |
| Old data after an update | Cache. See "Updating the map each year". |

## The multi-file version

`web/` holds the same control as separate files (script, stylesheet, data JSON, logo images, map
shapes). It is what the demo page runs and what a developer would edit. It can be hosted as a folder
if the school ever prefers that; every path inside it is relative, so copying the whole folder to
any static host and pointing a script tag at `dcp-college-map.js` inside it works the same way.
