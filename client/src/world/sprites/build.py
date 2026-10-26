# Packs the pixel-art sources in src/ into one atlas (atlas.png + atlas.json) that the
# town loads once at startup. Run after changing a source or the list below:
#
#   python client/src/world/sprites/build.py      (needs Pillow)
#
# atlas.json: name -> [x, y, w, h, ax, ay, scale]. (ax, ay) is the point in the sprite
# that goes on the middle of its tile; scale is how big it is drawn (the City Sim
# sprites are made for 128 px tiles, ours are 64). Sources and licenses: CREDITS.md.

import json
import os
from PIL import Image

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
        out[name] = [px, py, im.width, im.height, ax, ay, scale]
    atlas.save(os.path.join(HERE, "atlas.png"), optimize=True)
    with open(os.path.join(HERE, "atlas.json"), "w") as f:
        json.dump(dict(sorted(out.items())), f, separators=(",", ":"))
    print(f"{len(out)} sprites, atlas {atlas.size[0]}x{atlas.size[1]}")


if __name__ == "__main__":
    main()
