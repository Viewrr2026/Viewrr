#!/usr/bin/env python3
"""Regenerate mobile icon/splash art from the production web icon.

Source of truth: client/public/icon-192.png (the live Viewrr web app icon —
#FF5A1F rounded square, white "V"). That asset is only 192x192, which is below
the 1024x1024 Expo requires, so instead of upscaling and blurring it we
re-render the SAME geometry at full size. Every number below was measured off
the production PNG (see the comments), so the output is geometrically identical,
just resolution-independent.

Run from the mobile/ directory:  python3 scripts/generate-icons.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

BRAND = (255, 90, 31, 255)  # #FF5A1F — --primary / theme-color on web
WHITE = (255, 255, 255, 255)

# ── Geometry measured from client/public/icon-192.png ─────────────────────────
SRC = 192.0
CORNER_R = 42.0 / SRC  # squircle corner radius as a fraction of the icon edge
# "V" outline, in 192-space, traced from the white pixel runs of the source:
#   row 48  -> runs (42,66) and (126,150)   [two 24px strokes begin]
#   row 116 -> inner edges cross            [strokes merge into one wedge]
#   row 145 -> white ends flat, 22px wide   [flat apex, not a sharp point]
V_OUTLINE = [
    (42.0, 48.0),
    (66.0, 48.0),
    (96.0, 115.8),
    (126.0, 48.0),
    (150.0, 48.0),
    (107.1, 145.0),
    (84.9, 145.0),
]

OUT = Path("assets/images")


def scaled(points: list[tuple[float, float]], size: int, scale: float = 1.0,
           dx: float = 0.0, dy: float = 0.0) -> list[tuple[float, float]]:
    k = size / SRC * scale
    cx = size / 2.0
    cy = size / 2.0
    return [
        (cx + (x - SRC / 2.0) * k + dx, cy + (y - SRC / 2.0) * k + dy)
        for x, y in points
    ]


def v_mark(size: int, colour: tuple[int, int, int, int], scale: float = 1.0) -> Image.Image:
    """The bare white "V", transparent background."""
    ss = 4  # supersample for clean diagonals
    img = Image.new("RGBA", (size * ss, size * ss), (0, 0, 0, 0))
    ImageDraw.Draw(img).polygon(scaled(V_OUTLINE, size * ss, scale), fill=colour)
    return img.resize((size, size), Image.LANCZOS)


def app_icon(size: int, *, squircle: bool = True) -> Image.Image:
    ss = 4
    img = Image.new("RGBA", (size * ss, size * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if squircle:
        d.rounded_rectangle(
            [0, 0, size * ss - 1, size * ss - 1],
            radius=CORNER_R * size * ss,
            fill=BRAND,
        )
    else:
        d.rectangle([0, 0, size * ss - 1, size * ss - 1], fill=BRAND)
    d.polygon(scaled(V_OUTLINE, size * ss), fill=WHITE)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    # iOS / store icon — full-bleed square, no rounding (the OS masks it), but
    # we keep the brand square so the mark sits identically to the web icon.
    app_icon(1024, squircle=False).save(OUT / "icon.png")

    # Splash mark: the complete icon (orange square + white V) on transparency,
    # so the splash reads exactly like the home-screen icon.
    app_icon(512).save(OUT / "splash-icon.png")
    app_icon(512).save(OUT / "splash-icon-dark.png")

    # Android adaptive icon: white V on the brand background, inset to the
    # 66% safe zone so the launcher's mask cannot clip it.
    v_mark(1024, WHITE, scale=0.62).save(OUT / "android-icon-foreground.png")
    Image.new("RGBA", (1024, 1024), BRAND).save(OUT / "android-icon-background.png")
    v_mark(1024, WHITE, scale=0.62).save(OUT / "android-icon-monochrome.png")

    # In-app mark, tinted at runtime via expo-image.
    v_mark(512, WHITE).save(OUT / "viewrr-mark.png")

    print("wrote:", ", ".join(sorted(p.name for p in OUT.glob("*.png"))))


if __name__ == "__main__":
    main()
