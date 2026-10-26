# Packs the pixel-art sources in src/ into one atlas (atlas.png + atlas.json) that the
# town loads once at startup. Run after changing a source or the list below:
#
#   python client/src/world/sprites/build.py      (needs Pillow)
#
# atlas.json: name -> [x, y, w, h, ax, ay, scale]. (ax, ay) is the point in the sprite
# that goes on the middle of its tile; scale is how big it is drawn (the City Sim
# sprites are made for 128 px tiles, ours are 64). Sources and licenses: CREDITS.md.
# Our own sprites for the Stone and Bronze Age are drawn by pixelart.py.

import json
import os
import sys
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pixelart  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")

# Yar's "Isometric 64x64 Outside Tileset": a 64x64 grid, the ground diamond in the
# lower half of a cell. (row, col) of the top cell, and how many cells high.
YAR = {
    "grass": [(0, c) for c in range(7)] + [(1, c) for c in range(8)] + [(2, c) for c in range(4)],
    "water": [(8, 4), (8, 5), (9, 7)],
    "rock": [(5, 0), (5, 1), (5, 2), (5, 3), (5, 6), (5, 9)],
    "mountain": [(5, 4), (5, 5), (5, 7), (5, 8)],
    "bush": [(12, 0), (12, 1), (12, 8), (12, 9)],
    "bushPicked": [(12, 6), (12, 7)],
    "rubble": [(6, 6), (6, 7), (6, 8)],
    "log": [(12, 4), (12, 5)],
}
YAR_TALL = {  # two cells high
    "pine": [(12, 2), (12, 3)],
    "tree": [(14, 0), (14, 2)],
}

# City Sim (sketchylogic): one sprite per file on white, for 128 px tiles.
CITYSIM = ["chapel", "clock", "crops", "fish", "fruit", "house", "inn", "tailor", "tavern", "thatched", "villa", "watchtower"]

# Pixel City (pixel32): sheets on white, for 32 px tiles. name -> (sheet, box); the
# box is the sprite's bounding box in the sheet.
PIXELCITY = {
    "pcPolice": ("municipal", (2, 24, 72, 73)),
    "pcHospital": ("municipal", (85, 26, 151, 72)),
    "pcFireStation": ("municipal", (166, 19, 236, 73)),
    "pcSchool": ("municipal", (244, 25, 314, 73)),
    "pcOutpost": ("municipal", (23, 88, 57, 117)),
    "pcClinic": ("municipal", (100, 88, 134, 117)),
    "pcFireSmall": ("municipal", (185, 89, 219, 118)),
    "pcSchoolhouse": ("municipal", (262, 89, 296, 118)),
    "pcIndustry0": ("municipal", (24, 138, 58, 165)),
    "pcIndustry1": ("municipal", (80, 137, 114, 166)),
    "pcIndustry2": ("municipal", (140, 136, 174, 167)),
    "pcIndustry3": ("municipal", (200, 141, 234, 167)),
    "pcIndustry4": ("municipal", (263, 138, 297, 170)),
    "pcStorage": ("municipal", (83, 184, 117, 216)),
    "pcWalkup0": ("brick", (20, 362, 70, 399)),
    "pcWalkup1": ("brick", (78, 358, 128, 399)),
    "pcWalkup2": ("brick", (136, 354, 186, 399)),
    "pcTenement0": ("brick", (182, 18, 234, 58)),
    "pcTenement1": ("brick", (72, 104, 124, 144)),
    "pcBrickTower0": ("brick", (172, 250, 210, 316)),
    "pcBrickTower1": ("brick", (231, 249, 297, 328)),
    "pcFlat0": ("city", (57, 228, 109, 291)),
    "pcFlat1": ("city", (59, 309, 111, 357)),
    "pcFlat2": ("city", (128, 306, 162, 357)),
    "pcFlat3": ("city", (128, 367, 162, 425)),
    "pcTower0": ("city", (12, 225, 46, 283)),
    "pcTower1": ("city", (127, 224, 161, 290)),
    "pcTower2": ("city", (177, 225, 211, 290)),
    "pcTower3": ("city", (177, 301, 211, 361)),
    "pcTower4": ("city", (12, 304, 46, 354)),
    "pcTower5": ("city", (177, 371, 211, 425)),
    "pcOffices": ("city", (10, 369, 62, 425)),
    "pcBlock": ("city", (302, 344, 337, 397)),
    "pcShop0": ("city", (265, 374, 299, 397)),
    "pcShop1": ("city", (265, 401, 299, 424)),
    "pcShop2": ("city", (303, 400, 337, 423)),
    "pcShop3": ("city", (340, 400, 374, 423)),
}


def white_to_alpha(im: Image.Image) -> Image.Image:
    """Flood fill the white background from the borders, so white inside a sprite stays."""
    im = im.convert("RGBA")
    w, h = im.size
    p = im.load()
    stack = [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] + [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]
    seen = set()
    while stack:
        x, y = stack.pop()
        if (x, y) in seen or not (0 <= x < w and 0 <= y < h):
            continue
        seen.add((x, y))
        r, g, b, _ = p[x, y]
        if min(r, g, b) < 249:
            continue
        p[x, y] = (0, 0, 0, 0)
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    return im


def main() -> None:
    sprites: list[tuple[str, Image.Image, int, int, float]] = []

    yar = Image.open(os.path.join(SRC, "yar-outside.png")).convert("RGBA")

    def cell(name: str, r: int, c: int, rows: int) -> None:
        box = (c * 64, r * 64, c * 64 + 64, (r + rows) * 64)
        im = yar.crop(box)
        bb = im.getbbox()
        if name.startswith("grass") or name.startswith("water"):
            bb = (0, rows * 64 - 32, 64, rows * 64)  # exactly the diamond
        im = im.crop(bb)
        sprites.append((name, im, 32 - bb[0], rows * 64 - 16 - bb[1], 1))

    for kind, cells in YAR.items():
        for i, (r, c) in enumerate(cells):
            cell(f"{kind}{i}", r, c, 1)
    for kind, cells in YAR_TALL.items():
        for i, (r, c) in enumerate(cells):
            cell(f"{kind}{i}", r, c, 2)

    for name in CITYSIM:
        im = white_to_alpha(Image.open(os.path.join(SRC, "citysim", f"{name}.png")))
        bb = im.getbbox()
        w, h = im.size
        # The 128x64 ground diamond sits at the bottom of the picture.
        sprites.append((name, im.crop(bb), w // 2 - bb[0], h - 32 - bb[1], 0.5))

    sheets = {n: white_to_alpha(Image.open(os.path.join(SRC, "pixelcity", f"{n}.png"))) for n in ("municipal", "brick", "city")}
    for name, (sheet, box) in PIXELCITY.items():
        im = sheets[sheet].crop((box[0], box[1], box[2] + 1, box[3] + 1))
        im = im.crop(im.getbbox())
        w, h = im.size
        # Drawn about a tile wide: one-tile lots 1.5x, two-tile ones 1.25x, 2x2 as they are.
        scale = 1.5 if w <= 40 else 1.25 if w <= 56 else 1.0
        sprites.append((name, im, w / 2, h - 3 - w / 4 * 0.95, scale))

    sprites += pixelart.all_sprites()

    # Shelf packing, tallest first, 2 px apart.
    sprites.sort(key=lambda s: -s[1].height)
    width, x, y, shelf = 1024, 0, 0, 0
    places = []
    for s in sprites:
        im = s[1]
        if x + im.width > width:
            x, y, shelf = 0, y + shelf + 2, 0
        places.append((x, y))
        x += im.width + 2
        shelf = max(shelf, im.height)
    atlas = Image.new("RGBA", (width, y + shelf), (0, 0, 0, 0))
    out = {}
    for (name, im, ax, ay, scale), (px, py) in zip(sprites, places):
        atlas.alpha_composite(im, (px, py))
        out[name] = [px, py, im.width, im.height, round(ax, 1), round(ay, 1), scale]
    atlas.save(os.path.join(HERE, "atlas.png"), optimize=True)
    with open(os.path.join(HERE, "atlas.json"), "w") as f:
        json.dump(dict(sorted(out.items())), f, separators=(",", ":"))
    print(f"{len(out)} sprites, atlas {atlas.size[0]}x{atlas.size[1]}")


if __name__ == "__main__":
    main()
