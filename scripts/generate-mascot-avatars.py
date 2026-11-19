"""Compose transparent square avatars from original HackUDC artwork (#934, H55).

Run: python3 scripts/generate-mascot-avatars.py (requires Pillow).
Only crop, scale, mirror, rotate and place existing pixels; never redraw them.
"""

from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "packages/shared/assets/mascots"
OUTPUT = ROOT / "packages/shared/assets/avatars"
SIZE = 384
FRAMES = ("center", "left", "right", "close", "top", "peek")
# Complete silhouettes, measured in a 700px-wide preview, and their face anchors.
ARTWORK = (
    ("emilia", (255, 65, 425, 445), (0.51, 0.13)),
    ("emilia-step", (205, 100, 510, 465), (0.83, 0.18)),
    ("crab", (220, 50, 460, 350), (0.5, 0.62)),
    ("shrimp", (210, 200, 440, 350), (0.78, 0.27)),
    ("shell", (240, 175, 455, 385), (0.5, 0.47)),
)

OUTPUT.mkdir(exist_ok=True)

# Remove the original portrait's blue matte, including blue antialiasing at edges.
original = Image.open(ROOT / "apps/web/public/onboarding/emilia-portrait.png").convert("RGBA")
matte = original.getpixel((0, 0))[:3]
pixels = []
for y in range(original.height):
    for x in range(original.width):
        r, g, b, _ = original.getpixel((x, y))
        alpha = max(0, min(1, 1 - (b - r) / max(1, matte[2] - matte[0])))
        if alpha <= 0.015:
            pixels.append((0, 0, 0, 0))
        else:
            rgb = tuple(
                max(0, min(255, round((v - base * (1 - alpha)) / alpha)))
                for v, base in zip((r, g, b), matte)
            )
            pixels.append(rgb + (round(255 * alpha),))
original.putdata(pixels)
original.resize((SIZE, SIZE), Image.Resampling.LANCZOS).save(
    OUTPUT / "emilia-original.png", optimize=True
)

for name, bounds, face in ARTWORK:
    image = Image.open(SOURCE / f"{name}.png").convert("RGBA")
    factor = image.width / 700
    silhouette = image.crop(tuple(round(value * factor) for value in bounds))
    for frame in FRAMES:
        art = silhouette.copy()
        face_x, face_y = face
        gull = name.startswith("emilia")
        scale = (
            dict(center=2.3, left=2.5, right=2.5, close=3.1, top=2.4, peek=2.6)
            if gull else
            dict(center=0.76, left=1.08, right=1.08, close=1.7, top=1.1, peek=1.15)
        )[frame]
        ratio = round(SIZE * scale) / max(art.size)
        art = art.resize(
            (round(art.width * ratio), round(art.height * ratio)),
            Image.Resampling.LANCZOS,
        )
        if frame == "right":
            art = ImageOps.mirror(art)
            face_x = 1 - face_x
        if gull and frame == "top":
            art = art.rotate(180)
            face_x, face_y = 1 - face_x, 1 - face_y
        if frame == "center" and not gull:
            left = round((SIZE - art.width) / 2)
            top = round((SIZE - art.height) / 2)
        else:
            x = dict(center=0.5, left=0.28, right=0.72, close=0.5, top=0.5, peek=0.5)[frame]
            y = dict(center=0.36, left=0.44, right=0.44, close=0.38, top=0.13, peek=0.73)[frame]
            if gull and frame == "top":
                y = 0.31
            if name == "crab" and frame == "peek":
                y = 0.81
            if name == "crab" and frame == "close":
                y = 0.77
            left = round(SIZE * x - art.width * face_x)
            top = round(SIZE * y - art.height * face_y)
        canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        canvas.alpha_composite(art, (left, top))
        canvas.save(OUTPUT / f"{name}-{frame}.png", optimize=True)
