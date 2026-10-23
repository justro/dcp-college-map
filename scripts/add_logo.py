#!/usr/bin/env python3
"""
Add a hand-picked logo for one school.

    python3 scripts/add_logo.py <school-id> <image file>

The school id is the "id" in web/data/matriculation.json (e.g. university-of-iowa). The image is
trimmed of empty margins, centred on a square canvas and scaled to LOGO_PX, then saved as
data/logos/<school-id>.png. SVGs are copied as-is. The build script prefers a logo in data/logos/
over a downloaded one (only a "logo" set in data/overrides.json beats it), so it survives
--refetch-logos. Run build_data.py afterwards.

Needs Pillow (pip install -r scripts/requirements.txt). PNG, JPEG, GIF, WebP and TIFF all work;
convert PSD/AI/EPS files to PNG first (on a Mac: sips -s format png file.psd --out file.png).

build_data.py uses normalize() below for downloaded logos too, so both follow the same rules.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CURATED_DIR = ROOT / "data" / "logos"
LOGO_PX = 192
MARGIN = 0.06  # empty border left around the trimmed logo, as a share of the canvas


def content_box(img):
    """Bounding box of the logo itself as it looks on the map's white tile: the image is flattened
    onto white and trimmed to whatever differs from white, which handles transparent and white
    backgrounds alike. If the corners are mostly a solid colour, the image is left whole, since a
    coloured field is usually part of the design."""
    from PIL import Image, ImageChops
    flat = Image.new("RGBA", img.size, "white")
    flat.alpha_composite(img)
    flat = flat.convert("RGB")
    w, h = flat.size
    corners = [flat.getpixel(p) for p in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
    if sum(min(c) < 235 for c in corners) >= 3:
        return None
    diff = ImageChops.difference(flat, Image.new("RGB", flat.size, "white")).convert("L")
    return diff.point(lambda v: 255 if v > 24 else 0).getbbox()


def normalize(src, dest):
    """Trim, centre on a transparent square and scale down to LOGO_PX. `src` is a path or a
    file-like object. Writes a PNG to `dest` and returns its side length in pixels."""
    from PIL import Image
    img = Image.open(src)
    if img.format == "ICO" and hasattr(img, "ico"):  # an .ico holds several sizes: take the largest
        img.size = max(img.ico.sizes())
        img.load()
    img.seek(0)  # first frame of a GIF / multi-page TIFF
    img = img.convert("RGBA")
    box = content_box(img)
    if box:
        img = img.crop(box)
    side = round(max(img.size) / (1 - 2 * MARGIN))
    canvas = Image.new("RGBA", (side, side), (255, 255, 255, 0))
    # alpha_composite, not paste(mask=img): pasting would multiply the alpha by itself
    canvas.alpha_composite(img, ((side - img.width) // 2, (side - img.height) // 2))
    if side > LOGO_PX:
        canvas = canvas.resize((LOGO_PX, LOGO_PX), Image.LANCZOS)
    canvas.save(dest, "PNG", optimize=True)
    return canvas.width


def main(argv):
    if len(argv) != 2:
        sys.exit(__doc__)
    school_id, src = argv[0], Path(argv[1])
    if not re.fullmatch(r"[a-z0-9-]+", school_id):
        sys.exit(f"Not a school id: {school_id!r} (see the \"id\" fields in web/data/matriculation.json)")
    CURATED_DIR.mkdir(parents=True, exist_ok=True)
    # write to a temporary name first so a failed conversion leaves the previous logo in place
    tmp = CURATED_DIR / f".{school_id}.tmp"
    try:
        if src.suffix.lower() == ".svg":
            text = src.read_text(encoding="utf-8", errors="replace")
            if re.search(r"<script|\bon\w+\s*=|javascript:", text, flags=re.I):
                sys.exit(f"{src} contains scripting; export it as PNG instead")
            tmp.write_text(text, encoding="utf-8")
            dest = CURATED_DIR / f"{school_id}.svg"
        else:
            try:
                import PIL  # noqa
            except ImportError:
                sys.exit("Pillow is required: pip install -r scripts/requirements.txt")
            normalize(src, tmp)
            dest = CURATED_DIR / f"{school_id}.png"
        for old in CURATED_DIR.glob(f"{school_id}.*"):
            if old != dest:
                old.unlink()
        tmp.replace(dest)
    finally:
        tmp.unlink(missing_ok=True)
    print(f"wrote {dest.relative_to(ROOT)}")


if __name__ == "__main__":
    main(sys.argv[1:])
