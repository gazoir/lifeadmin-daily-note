#!/usr/bin/env python3
"""Embed the reference GB logo PNG inside an SVG wrapper for crisp vault serving."""
import base64
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "gb-logo-source.png"
OUT = ROOT / "assets" / "gb-logo.svg"

def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"Missing logo source PNG: {SRC}")
    png = SRC.read_bytes()
    b64 = base64.b64encode(png).decode("ascii")
    w, h = 320, 320
    try:
        from PIL import Image
        from io import BytesIO

        im = Image.open(BytesIO(png))
        w, h = im.size
    except Exception:
        pass
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        'xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'viewBox="0 0 {w} {h}" role="img" aria-label="Gracie Barra">\n'
        f'  <image width="{w}" height="{h}" preserveAspectRatio="xMidYMid meet" '
        f'xlink:href="data:image/png;base64,{b64}"/>\n'
        "</svg>\n"
    )
    OUT.write_text(svg, encoding="utf-8")
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")

if __name__ == "__main__":
    main()
