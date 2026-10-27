# Our own pixel-art sprites for the buildings that take more than one tile
# (update 21): De Senaat (the center from the Bronze Age on, 3×3) in five looks
# through the eras, and the ten world wonders, each on its own tiles. Same style
# as pixelart.py: four tones per material, light from the top left, texture in
# the material, a dark rim. build.py adds them to the atlas.
#
# Geometry: P(u, v, h) is a point u tiles along the tile x axis and v along y
# from the middle of the building, h px up. A tile is a 64×32 diamond.

import math
from PIL import Image

from pixelart import STRAW, WOOD, Color, Sprite, Tones, cone, hash2, tone, wall
from pixeldecor import BRICK, DARK, GRANITE, MARBLE, SLATE, STEEL, digits, ellipse_fill, rect

W, H = 280, 280
AX, AY = 140, 206  # the middle of the building's tiles

SAND: Tones = ((236, 212, 150), (214, 182, 120), (180, 148, 92), (138, 110, 66))
SARSEN: Tones = ((196, 194, 178), (164, 162, 146), (128, 128, 116), (92, 94, 86))
COPPER: Tones = ((136, 206, 180), (96, 172, 146), (66, 134, 112), (44, 96, 82))
GLASS: Tones = ((170, 222, 246), (112, 176, 220), (72, 128, 180), (44, 84, 128))
CONCRETE: Tones = ((196, 198, 196), (166, 168, 166), (132, 134, 134), (98, 100, 102))
TERRACOTTA: Tones = ((214, 120, 80), (184, 92, 58), (146, 68, 44), (104, 48, 34))
IRON: Tones = ((150, 98, 70), (124, 74, 45), (96, 56, 34), (66, 38, 24))
GOLD: Color = (240, 196, 64)
EARTH: Tones = ((176, 140, 96), (150, 116, 78), (120, 92, 62), (88, 66, 46))
WHITE: Tones = ((252, 252, 250), (228, 230, 234), (190, 196, 206), (142, 150, 166))
RED: Tones = ((236, 96, 80), (204, 56, 48), (160, 36, 36), (112, 24, 28))
LIGHT: Color = (255, 236, 150)


def P(u: float, v: float, h: float = 0, ox: float = 0, oy: float = 0) -> tuple[float, float]:
    return (AX + ox + (u - v) * 32, AY + oy + (u + v) * 16 - h)


def g(x: int, y: int, salt: int, amount: float = 0.3) -> float:
    return (hash2(x, y, salt) - 0.5) * amount


def pad(s: Sprite, tiles: list[tuple[float, float]], t: Tones, kind: str = "slabs") -> None:
    """Paving under the building: one diamond per tile (u, v of the tile's middle)."""
    for tu, tv in tiles:
        cx, cy = P(tu, tv)
        for x, y in s.mask([(cx - 32, cy), (cx, cy - 16), (cx + 32, cy), (cx, cy + 16)]):
            # Tile coordinates inside this tile, 0..1.
            a = (y - cy) / 32 + (x - cx) / 64 + 0.5
            b = (y - cy) / 32 - (x - cx) / 64 + 0.5
            c = t[1] if hash2(int(a * 3), int(b * 3), int(tu * 7 + tv * 13)) > 0.3 else t[0]
            if kind == "slabs" and (a * 3 % 1 < 0.07 or b * 3 % 1 < 0.07):
                c = t[2]
            elif kind == "earth" and hash2(x, y, 5) < 0.06:
                c = t[2]
            elif kind == "panels" and (a * 4 % 1 < 0.05 or b * 4 % 1 < 0.05):
                c = t[3]
            s.set(x, y, c)


def block(s: Sprite, u0: float, u1: float, v0: float, v1: float, h: float, t: Tones, texture: str = "", base: float = 0, top: Color | None = None) -> None:
    """A box on the ground rectangle u0..u1 × v0..v1, from `base` to `base + h` px up."""
    b, e = base, base + h
    left = [P(u0, v1, b), P(u1, v1, b), P(u1, v1, e), P(u0, v1, e)]  # facing down-left: lit
    right = [P(u1, v1, b), P(u1, v0, b), P(u1, v0, e), P(u1, v1, e)]  # facing down-right: shade
    for face, k0, (sx, sy), slope in ((left, 1, P(u0, v1, e), 0.5), (right, 2, P(u1, v1, e), -0.5)):
        for x, y in s.mask(face):
            along = x - sx
            down = y - (sy + along * slope)
            k = k0
            if texture == "brick":
                row = int(down // 3)
                k += 1 if down % 3 < 1 or (int(along) + row * 3) % 6 == 0 else 0
            elif texture == "columns":
                # Columns with dark gaps between them, a band at the top and the bottom.
                k = k0 - 1 if int(along) % 9 in (1, 2) else k0 + 1 if int(along) % 9 in (5, 6, 7, 8) and 4 < down < h - 3 else k0
                if down < 3 or down > h - 2:
                    k = k0 - 1
            elif texture == "windows":
                lit = hash2(int(along) // 5, int(down) // 7, 3) < 0.35
                if int(along) % 5 in (2, 3) and int(down) % 7 in (2, 3, 4):
                    s.set(x, y, LIGHT if lit and texture == "windows" else (40, 52, 70))
                    continue
            elif texture == "glass":
                k = k0 + (1 if int(along) % 6 == 0 or int(down) % 6 == 0 else 0)
                if hash2(int(along) // 6, int(down) // 6, 9) < 0.15 and k == k0:
                    k = k0 - 1
            elif texture == "courses":
                k += 1 if int(down) % 4 == 0 else 0
            elif hash2(x, y, 31) < 0.05:
                k += 1
            s.set(x, y, t[max(0, min(3, k))])
    lid = [P(u0, v0, e), P(u1, v0, e), P(u1, v1, e), P(u0, v1, e)]
    for x, y in s.mask(lid):
        s.set(x, y, top or (t[0] if hash2(x, y, 32) > 0.08 else t[1]))


def gable(s: Sprite, u0: float, u1: float, v0: float, v1: float, h: float, rh: float, roof: Tones, wall_t: Tones, along_u: bool = True) -> None:
    """A gable roof on a box of height h: the ridge rh px higher, running along u (or v)."""
    if along_u:
        vm = (v0 + v1) / 2
        back = [P(u0, v0, h), P(u1, v0, h), P(u1, vm, h + rh), P(u0, vm, h + rh)]
        front = [P(u0, v1, h), P(u1, v1, h), P(u1, vm, h + rh), P(u0, vm, h + rh)]
        end = [P(u1, v1, h), P(u1, v0, h), P(u1, vm, h + rh)]
        planes = ((back, 2), (front, 1))
        end_k = 2
    else:
        um = (u0 + u1) / 2
        back = [P(u0, v0, h), P(u0, v1, h), P(um, v1, h + rh), P(um, v0, h + rh)]
        front = [P(u1, v0, h), P(u1, v1, h), P(um, v1, h + rh), P(um, v0, h + rh)]
        end = [P(u0, v1, h), P(u1, v1, h), P(um, v1, h + rh)]
        planes = ((back, 1), (front, 2))
        end_k = 1
    for poly, k in planes:
        for x, y in s.mask(poly):
            s.set(x, y, roof[min(3, k + (1 if y % 3 == 0 else 0))])
    for x, y in s.mask(end):
        s.set(x, y, wall_t[end_k])


def dome(s: Sprite, cx: float, base: float, r: float, t: Tones, ribs: int = 8) -> None:
    """A dome on a round drum rim at `base`: lit from the top left, with ribs."""
    for y in range(int(base - r) - 1, int(base + r / 2) + 1):
        for x in range(int(cx - r) - 1, int(cx + r) + 2):
            dx = (x + 0.5 - cx) / r
            if y <= base:
                dy = (y + 0.5 - base) / (r * 0.95)
                if dx * dx + dy * dy > 1:
                    continue
            else:
                if dx * dx + ((y + 0.5 - base) / (r / 2)) ** 2 > 1:
                    continue
            u = dx * 0.9 + 0.25 * (1 + (y - base) / r)
            c = tone(t, u, g(x, y, 7, 0.15))
            if ribs and y < base and abs(math.sin(math.asin(max(-1, min(1, dx))) * ribs / 2)) < 0.12:
                c = t[min(3, t.index(c) + 1)] if c in t else c
            s.set(x, y, c)
    for x in range(int(cx - r * 0.35), int(cx - r * 0.1)):
        s.set(x, base - r * 0.75, t[0])


def finish(s: Sprite) -> Sprite:
    s.rim()
    return s


def all_tiles(offsets: list[tuple[int, int]]) -> list[tuple[float, float]]:
    """Tile middles relative to the building's middle."""
    mu = sum(o[0] for o in offsets) / len(offsets)
    mv = sum(o[1] for o in offsets) / len(offsets)
    return [(o[0] - mu, o[1] - mv) for o in offsets]


SQ3 = all_tiles([(u, v) for v in (-1, 0, 1) for u in (-1, 0, 1)])
SQ2 = all_tiles([(u, v) for v in (0, 1) for u in (0, 1)])
CROSS = all_tiles([(0, 0), (-1, 0), (1, 0), (0, -1), (0, 1)])
ROW = all_tiles([(u, v) for v in (0, 1) for u in (-1, 0, 1)])


# ---------- De Senaat ----------

def banner(s: Sprite, x: float, y: float, h: int, c: Tones) -> None:
    s.line(x, y, x, y - h, WOOD[2])
    for k in range(9):
        for j in range(5 - k // 2):
            s.set(x + 1 + j, y - h + 1 + k, c[0] if j < 2 else c[1])


def senaat_hall() -> Sprite:
    """Bronze and Iron Age: a great round hall under straw on a plaza of packed earth, banners at the front."""
    s = Sprite(W, H)
    pad(s, SQ3, EARTH, "earth")
    # Benches of logs round the edge.
    for u, v in ((-1.2, 0.9), (0.9, 1.2), (1.25, -0.4), (-0.4, 1.3)):
        x, y = P(u, v)
        for k in range(-7, 8):
            for j in range(-1, 2):
                s.set(x + k, y + j + k * 0.5 * (1 if u > 0 else -1), WOOD[1 + (j > 0)])
    rx = 50
    wall(s, AX, AY, rx, 24, ((226, 196, 152), (198, 160, 112), (160, 124, 84), (116, 88, 60)), "wattle")
    cone(s, AX, AY - 24, rx * 1.1, 56, STRAW, "straw")
    # A big door with a lintel.
    for y in range(AY + 6, AY + 24):
        for x in range(AX - 8, AX + 7):
            s.set(x, y, (40, 26, 18))
    for x in range(AX - 10, AX + 9):
        s.set(x, AY + 5, WOOD[1])
    x, y = P(0.9, 1.5)
    banner(s, x, y, 40, RED)
    x, y = P(-1.5, 0.9)
    banner(s, x, y, 40, ((240, 204, 80), (204, 160, 40), (150, 110, 30), (100, 70, 20)))
    return finish(s)


def senaat_temple() -> Sprite:
    """Classical to Renaissance: a marble senate with columns all round, steps and a dome."""
    s = Sprite(W, H)
    pad(s, SQ3, ((236, 232, 222), (214, 208, 196), (176, 170, 158), (140, 134, 124)))
    for k, (a, h) in enumerate(((1.25, 4), (1.15, 4), (1.05, 4))):
        block(s, -a, a, -a, a, h, MARBLE, base=k * 4, top=MARBLE[0])
    block(s, -0.95, 0.95, -0.95, 0.95, 34, MARBLE, "columns", base=12)
    block(s, -1.0, 1.0, -1.0, 1.0, 5, MARBLE, "courses", base=46)
    # A temple roof of red tiles, the pediment at the front end with a frieze.
    gable(s, -1.0, 1.0, -1.0, 1.0, 51, 22, TERRACOTTA, MARBLE)
    cx, cy = P(1.0, 0, 58)
    ellipse_fill(s, cx, cy, 4, 3, GOLD)
    for k in range(-1, 2, 2):
        x, y = P(1.0, k * 0.5, 54)
        s.set(x, y, MARBLE[3])
        s.set(x + 1, y, MARBLE[3])
    return finish(s)


def senaat_parliament() -> Sprite:
    """Industrial and modern: a brick parliament with two wings, a stone portico and a copper dome."""
    s = Sprite(W, H)
    pad(s, SQ3, ((150, 150, 156), (128, 128, 134), (100, 100, 108), (74, 74, 82)))
    block(s, -1.25, 1.25, -0.6, 0.6, 30, BRICK, "windows")
    block(s, -1.3, 1.3, -0.65, 0.65, 4, GRANITE, base=30)
    block(s, -0.5, 0.5, -0.9, 0.9, 40, GRANITE, "columns")
    gable(s, -0.5, 0.5, -0.9, 0.9, 40, 12, SLATE, GRANITE, along_u=False)
    cx, cy = P(0, 0, 54)
    block(s, -0.3, 0.3, -0.3, 0.3, 12, GRANITE, "columns", base=50)
    dome(s, cx, cy - 8, 24, COPPER)
    s.line(cx, cy - 32, cx, cy - 46, (60, 60, 60))
    for k in range(6):
        for j in range(4):
            s.set(cx + 1 + k, cy - 46 + j, [(204, 52, 52), (240, 240, 240), (52, 84, 170)][j * 3 // 4])
    return finish(s)


def senaat_glass() -> Sprite:
    """The digital age: glass and steel, a see-through dome."""
    s = Sprite(W, H)
    pad(s, SQ3, CONCRETE, "slabs")
    block(s, -1.2, 1.2, -1.2, 1.2, 8, CONCRETE)
    block(s, -1.0, 1.0, -1.0, 1.0, 34, GLASS, "glass", base=8)
    block(s, -1.05, 1.05, -1.05, 1.05, 3, STEEL, base=42)
    cx, cy = P(0, 0, 45)
    dome(s, cx, cy, 36, GLASS, ribs=12)
    # Light from inside.
    for k in range(10):
        x, y = cx - 14 + k * 3, cy - 8 - (k % 3) * 4
        s.set(x, y, LIGHT)
    return finish(s)


def senaat_galactic() -> Sprite:
    """Space and sci-fi: a white saucer of a senate on a landing plaza, with purple lights."""
    s = Sprite(W, H)
    pad(s, SQ3, ((120, 124, 140), (100, 104, 120), (78, 82, 98), (56, 60, 76)), "panels")
    for u, v in SQ3:
        x, y = P(u * 1.3, v * 1.3)
        s.set(x, y, (200, 120, 255))
        s.set(x + 1, y, (200, 120, 255))
    # Legs, the saucer, a dome on top.
    for u, v in ((-0.7, 0), (0.7, 0), (0, -0.7), (0, 0.7)):
        x, y = P(u, v)
        s.line(x, y, x * 0.6 + AX * 0.4, y - 26, STEEL[2])
        s.line(x + 1, y, x * 0.6 + AX * 0.4 + 1, y - 26, STEEL[3])
    cx, cy = AX, AY - 34
    ellipse_fill(s, cx, cy + 4, 82, 22, WHITE[2])
    ellipse_fill(s, cx, cy, 82, 22, WHITE[1])
    ellipse_fill(s, cx - 8, cy - 4, 56, 13, WHITE[0])
    for k in range(14):
        a = math.pi * (0.08 + 0.84 * k / 13)
        s.set(cx + math.cos(a) * 78, cy + 4 + math.sin(a) * 20, (200, 120, 255))
    dome(s, cx, cy - 6, 34, ((214, 196, 255), (176, 140, 250), (130, 96, 210), (90, 62, 160)), ribs=0)
    return finish(s)


# ---------- the wonders ----------

def stonehenge() -> Sprite:
    """A ring of sarsen stones with lintels, two trilithons inside, on the grass."""
    s = Sprite(W, H)
    stones = []
    n = 14
    for i in range(n):
        a = i / n * math.pi * 2
        stones.append((math.cos(a) * 1.25, math.sin(a) * 1.25, i))
    stones.sort(key=lambda p: p[0] + p[1])
    for u, v, i in stones:
        if i == 9:  # a fallen one
            x, y = P(u, v)
            for k in range(-9, 10):
                for j in range(-2, 3):
                    s.set(x + k, y + j + k * 0.3, SARSEN[1 + (j > 0) + (j > 1)])
            continue
        block(s, u - 0.1, u + 0.1, v - 0.1, v + 0.1, 28, SARSEN, "x")
        if i % 2 == 0 and i != 8:
            u2, v2 = math.cos((i + 1) / n * math.pi * 2) * 1.25, math.sin((i + 1) / n * math.pi * 2) * 1.25
            (x1, y1), (x2, y2) = P(u, v, 28), P(u2, v2, 28)
            for k in range(0, 101):
                t = k / 100
                x, y = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
                for j in range(-4, 1):
                    s.set(x, y + j, SARSEN[0] if j == -4 else SARSEN[1] if j < -1 else SARSEN[2])
    # Two big trilithons in the middle.
    for du, dv in ((-0.45, -0.2), (0.2, -0.45)):
        block(s, du - 0.14, du - 0.04, dv - 0.1, dv + 0.1, 38, SARSEN)
        block(s, du + 0.04, du + 0.14, dv - 0.1, dv + 0.1, 38, SARSEN)
        block(s, du - 0.16, du + 0.16, dv - 0.12, dv + 0.12, 6, SARSEN, base=38)
    return finish(s)


def pyramid() -> Sprite:
    """A great pyramid of sandstone in courses, with a gold cap."""
    s = Sprite(W, H)
    a = 1.45
    apex = P(0, 0, 120)
    left = [P(-a, a), P(a, a), apex]
    right = [P(a, a), P(a, -a), apex]
    for poly, k in ((left, 1), (right, 2)):
        for x, y in s.mask(poly):
            c = SAND[k]
            if (y - apex[1]) % 6 == 0:
                c = SAND[min(3, k + 1)]
            elif hash2(x // 4, (y - int(apex[1])) // 6, 8) < 0.1:
                c = SAND[k - 1] if k == 2 else SAND[0]
            s.set(x, y, c)
    for x, y in s.mask([P(-0.12, 0.12, 103), P(0.12, 0.12, 103), apex]):
        s.set(x, y, GOLD if x < apex[0] else (204, 160, 40))
    for x, y in s.mask([P(0.12, 0.12, 103), P(0.12, -0.12, 103), apex]):
        s.set(x, y, (180, 140, 30))
    return finish(s)


def colossus(frame: int) -> Sprite:
    """A giant bronze figure on a stone plinth, a torch held high."""
    s = Sprite(W, H)
    pad(s, SQ2, GRANITE, "slabs")
    block(s, -0.6, 0.6, -0.6, 0.6, 26, GRANITE, "courses")
    base = P(0, 0, 26)
    cx, by = int(base[0]), int(base[1]) + 8
    # Legs apart, a robe, a broad chest, the head with rays, the arm up with the torch.
    for poly, k in (
        ([(cx - 12, by), (cx - 5, by), (cx - 4, by - 40), (cx - 10, by - 40)], 1),
        ([(cx + 4, by), (cx + 11, by), (cx + 9, by - 40), (cx + 3, by - 40)], 2),
        ([(cx - 14, by - 36), (cx + 13, by - 36), (cx + 12, by - 80), (cx - 13, by - 80)], 1),
        ([(cx - 4, by - 80), (cx + 4, by - 80), (cx + 4, by - 84), (cx - 4, by - 84)], 1),
        ([(cx + 9, by - 78), (cx + 15, by - 80), (cx + 24, by - 118), (cx + 18, by - 118)], 2),
        ([(cx - 13, by - 78), (cx - 7, by - 76), (cx - 10, by - 50), (cx - 16, by - 52)], 1),
    ):
        for x, y in s.mask(poly):
            u = (x - cx) / 14
            c = tone(IRON if k else IRON, u * 0.8, g(x // 2, y // 3, 4, 0.3))
            if (y - by) % 9 == 0 and by - 76 < y < by - 38:
                c = IRON[3]  # folds of the robe
            s.set(x, y, c)
    ellipse_fill(s, cx, by - 92, 8, 9, IRON[1])
    ellipse_fill(s, cx - 2, by - 94, 4, 4, IRON[0])
    for k in range(7):
        a = math.pi * (1.1 + 0.8 * k / 6)
        s.line(cx + math.cos(a) * 9, by - 92 + math.sin(a) * 9, cx + math.cos(a) * 15, by - 92 + math.sin(a) * 15, IRON[2])
    # The torch and its flame.
    rect(s, cx + 19, by - 126, cx + 23, by - 116, ((240, 196, 64), (204, 160, 40), (150, 110, 30), (100, 70, 20)))
    s.rim()
    for y in range(by - 140 - frame * 2, by - 126):
        w = (y - (by - 140 - frame * 2)) * 0.35
        for x in range(int(cx + 21 - w), int(cx + 21 + w) + 1):
            s.set(x + (frame if y < by - 134 else 0), y, (255, 236, 120) if abs(x - cx - 21) < w * 0.4 else (250, 140, 40))
    return s


def colosseum() -> Sprite:
    """An oval arena of three tiers of arches, sand inside."""
    s = Sprite(W, H)
    rx, ry, h = 92, 46, 48
    cy = AY
    stone = ((236, 222, 196), (212, 194, 162), (174, 154, 124), (132, 114, 90))
    # The top of the ring as if solid, then the arena floor and the inner back face.
    ellipse_fill(s, AX, cy - h, rx, ry, stone[2])
    ellipse_fill(s, AX, cy - h + 2, rx - 9, ry - 5, stone[3])
    ellipse_fill(s, AX, cy - 10, rx - 26, ry - 14, SAND[1])
    for k in range(40):
        a = k / 40 * math.pi * 2
        s.set(AX + math.cos(a) * (rx - 30) * hash2(k, 1, 2), cy - 10 + math.sin(a) * (ry - 18) * hash2(k, 2, 2), SAND[2])
    # Seats as rings on the inner face.
    for r in range(0, 4):
        for k in range(120):
            a = math.pi * (1 + k / 120)
            s.set(AX + math.cos(a) * (rx - 12 - r * 4), cy - h + 6 + r * 5 + math.sin(a) * (ry - 8 - r * 3), stone[1])
    wall(s, AX, cy, rx, h, stone, "")
    # Three tiers of dark arches on the front.
    for tier in range(3):
        for k in range(26):
            a = math.pi * (0.06 + 0.88 * k / 25)
            x = AX + math.cos(a) * rx
            ground = cy + math.sin(a) * ry
            top = ground - 6 - tier * 15
            for yy in range(int(top - 8), int(top)):
                for xx in range(int(x - 1), int(x + 2)):
                    if yy > top - 8 or abs(xx - x) < 1:
                        s.set(xx, yy, (70, 56, 44) if tier < 2 else (96, 80, 62))
            s.set(x, top - 9, stone[0])
    for x in range(AX - rx, AX + rx + 1):
        u = (x - AX) / rx
        s.set(x, cy - h + ry * math.sqrt(max(0, 1 - u * u)), stone[0])
    return finish(s)


def cathedral() -> Sprite:
    """A gothic cathedral in a cross: the nave along one axis, the transept along the other, two towers and a spire."""
    s = Sprite(W, H)
    stone = ((222, 214, 196), (196, 186, 166), (156, 146, 128), (114, 106, 94))
    roof = ((120, 116, 112), (92, 88, 86), (70, 68, 66), (50, 48, 48))
    pad(s, CROSS, GRANITE, "slabs")
    # The nave (back half first), the transept, the crossing tower, the front of the nave with the towers.
    block(s, -1.4, 0.3, -0.38, 0.38, 46, stone, "courses")
    gable(s, -1.4, 0.3, -0.38, 0.38, 46, 26, roof, stone)
    block(s, -0.38, 0.38, -1.4, 1.4, 46, stone, "courses")
    gable(s, -0.38, 0.38, -1.4, 1.4, 46, 26, roof, stone, along_u=False)
    block(s, 0.3, 1.0, -0.38, 0.38, 46, stone, "courses")
    gable(s, 0.3, 1.0, -0.38, 0.38, 46, 26, roof, stone)
    # Tall windows on the faces we see.
    for u in (-1.1, -0.8, 0.55, 0.8):
        x, y = P(u, 0.38, 14)
        for k in range(16):
            s.set(x, y - k, (60, 90, 160) if k < 14 else stone[2])
            s.set(x + 1, y + 0.5 - k, (90, 130, 200) if k < 13 else stone[2])
    # Two towers at the front end, a rose window between them.
    for v in (-0.38, 0.12):
        block(s, 1.0, 1.4, v, v + 0.26, 92, stone, "courses")
        cx, cy = P(1.2, v + 0.13, 92)
        cone(s, cx, cy + 4, 11, 30, roof, "")
    cx, cy = P(1.4, 0, 52)
    ellipse_fill(s, cx, cy, 6, 7, (70, 100, 180))
    ellipse_fill(s, cx, cy, 3, 4, (230, 120, 160))
    # A spire on the crossing.
    cx, cy = P(0, 0, 70)
    cone(s, cx, cy, 8, 46, roof, "")
    s.line(cx, cy - 46, cx, cy - 54, GOLD)
    s.line(cx - 3, cy - 51, cx + 3, cy - 51, GOLD)
    return finish(s)


def basilica() -> Sprite:
    """The great dome: a temple front with columns, a drum with windows, the dome and a lantern."""
    s = Sprite(W, H)
    pad(s, SQ3, ((236, 232, 222), (214, 208, 196), (176, 170, 158), (140, 134, 124)))
    for k, a in enumerate((1.3, 1.2)):
        block(s, -a, a, -a, a, 4, MARBLE, base=k * 4)
    block(s, -1.1, 1.1, -1.1, 1.1, 40, MARBLE, "columns", base=8)
    block(s, -1.15, 1.15, -1.15, 1.15, 5, MARBLE, "courses", base=48)
    cx, cy = P(0, 0, 53)
    # The drum.
    wall(s, cx, cy, 40, 18, MARBLE, "")
    for k in range(9):
        a = math.pi * (0.1 + 0.8 * k / 8)
        x, y = cx + math.cos(a) * 40, cy + math.sin(a) * 20 - 12
        for j in range(7):
            s.set(x, y + j - 2, (70, 80, 110))
    dome(s, cx, cy - 18, 40, ((176, 190, 206), (146, 160, 180), (112, 126, 148), (80, 92, 112)), ribs=10)
    wall(s, cx, cy - 58, 7, 9, MARBLE, "")
    cone(s, cx, cy - 67, 8, 8, MARBLE, "")
    s.line(cx, cy - 75, cx, cy - 84, GOLD)
    s.line(cx - 3, cy - 81, cx + 3, cy - 81, GOLD)
    return finish(s)


def eiffel(frame: int) -> Sprite:
    """An iron lattice tower on four legs, two platforms, a light at the top."""
    s = Sprite(W, H)
    pad(s, SQ3, ((168, 176, 120), (144, 152, 100), (116, 124, 82), (90, 96, 64)), "earth")
    top_h = 190
    legs = [(-1.25, -1.25), (1.25, -1.25), (-1.25, 1.25), (1.25, 1.25)]
    legs.sort(key=lambda p: p[0] + p[1])

    def at(u: float, v: float, f: float) -> tuple[float, float]:
        # Up the leg: the corners curve in towards the middle as it rises.
        k = (1 - f) ** 2.2
        return P(u * k, v * k, f * top_h)

    for u, v in legs:
        pts = [at(u, v, i / 40) for i in range(41)]
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            for o in range(-2, 3):
                w = max(0, 2 - int(math.hypot(x1 - AX, 0) / 60))
                if abs(o) <= w:
                    s.line(x1 + o, y1, x2 + o, y2, IRON[1] if o <= 0 else IRON[2])
        # Lattice: cross bracing between the legs.
    for i in range(1, 30):
        f = i / 30
        ring = [at(u, v, f) for u, v in ((-1.25, -1.25), (1.25, -1.25), (1.25, 1.25), (-1.25, 1.25))]
        if i % 3 == 0:
            for a, b in zip(ring, ring[1:] + ring[:1]):
                s.line(a[0], a[1], b[0], b[1], IRON[2])
    for f, w in ((0.22, 1.0), (0.5, 0.5)):
        corners = [at(u, v, f) for u, v in ((-1.25, -1.25), (1.25, -1.25), (1.25, 1.25), (-1.25, 1.25))]
        cx = sum(c[0] for c in corners) / 4
        cy = sum(c[1] for c in corners) / 4
        hw = (corners[1][0] - corners[3][0]) / 2 * 0.95
        # A deck you can see through: an iron rim with a railing.
        for x, y in s.mask([(cx - hw, cy), (cx, cy + hw / 2), (cx + hw, cy), (cx + hw, cy + 3), (cx, cy + hw / 2 + 3), (cx - hw, cy + 3)]):
            s.set(x, y, IRON[2] if x > cx else IRON[1])
        for k in range(0, int(hw * 2), 3):
            x = cx - hw + k
            y = cy + (hw - abs(x - cx)) / 2
            s.set(x, y - 1, IRON[0])
            s.set(x, y - 2, IRON[1])
    tx, ty = at(0, 0, 1)
    s.line(tx, ty, tx, ty - 14, IRON[3])
    s.rim()
    if frame == 0:
        for dx in range(-2, 3):
            for dy in range(-2, 3):
                if dx * dx + dy * dy <= 4:
                    s.set(tx + dx, ty - 16 + dy, LIGHT)
    return s


def skyscraper(frame: int) -> Sprite:
    """A glass tower in three steps, with a spire and a blinking light."""
    s = Sprite(W, H)
    pad(s, SQ2, CONCRETE, "slabs")
    block(s, -0.85, 0.85, -0.85, 0.85, 90, GLASS, "glass")
    block(s, -0.65, 0.65, -0.65, 0.65, 60, GLASS, "glass", base=90)
    block(s, -0.45, 0.45, -0.45, 0.45, 30, GLASS, "glass", base=150)
    block(s, -0.2, 0.2, -0.2, 0.2, 6, STEEL, base=180)
    tx, ty = P(0, 0, 186)
    s.line(tx, ty, tx, ty - 22, STEEL[1])
    s.rim()
    if frame == 0:
        for dx in (-1, 0, 1):
            s.set(tx + dx, ty - 23, (255, 60, 60))
        s.set(tx, ty - 24, (255, 60, 60))
    return s


def supercomputer(frame: int) -> Sprite:
    """A data hall: rows of black server racks with lights, pipes, and a glowing core."""
    s = Sprite(W, H)
    pad(s, ROW, ((150, 160, 176), (128, 138, 156), (100, 110, 128), (72, 80, 98)), "panels")
    for v in (-0.55, 0.05, 0.6):
        for u in (-1.2, -0.4, 0.4):
            block(s, u, u + 0.7, v, v + 0.3, 44, DARK, base=0)
            # Lights on the front of the rack.
            x0, y0 = P(u, v + 0.3, 40)
            for k in range(5):
                for j in range(7):
                    on = hash2(int(u * 10) + k, j + int(v * 10), 30 + frame) < 0.45
                    s.set(x0 + 4 + k * 4, y0 + 2 + j * 5 + (k * 4) * 0.5, (34, 240, 255) if on else (14, 80, 100))
    cx, cy = P(1.25, 0.3, 0)
    ellipse_fill(s, cx, cy - 4, 16, 8, STEEL[2])
    for k in range(5):
        r = 9 - k
        ellipse_fill(s, cx, cy - 20 - k * 4, r, r, (34 + k * 30, 240, 255), 255)
    s.rim()
    if frame == 1:
        for k in range(10):
            a = k / 10 * math.pi * 2
            s.set(cx + math.cos(a) * 14, cy - 28 + math.sin(a) * 7, (200, 255, 255))
    return s


def rocket(frame: int) -> Sprite:
    """A rocket on its launch pad next to the gantry tower, steam coming off it."""
    s = Sprite(W, H)
    pad(s, SQ3, CONCRETE, "slabs")
    block(s, -1.1, 1.1, -1.1, 1.1, 10, CONCRETE, "courses")
    # The gantry: a red lattice tower with an arm.
    gu, gv = -0.2, 0.85
    block(s, gu - 0.2, gu + 0.2, gv - 0.2, gv + 0.2, 150, RED, "courses", base=10)
    for k in range(0, 150, 10):
        (x1, y1), (x2, y2) = P(gu - 0.2, gv + 0.2, 10 + k), P(gu + 0.2, gv + 0.2, 20 + k)
        s.line(x1, y1, x2, y2, RED[3])
    (x1, y1), (x2, y2) = P(gu + 0.2, gv + 0.2, 120), P(0, 0, 130)
    s.line(x1, y1, x2, y2, RED[2])
    s.line(x1, y1 + 1, x2, y2 + 1, RED[3])
    # The rocket.
    cx, base = P(0, 0, 10)
    cx, base = int(cx), int(base)
    for y in range(base - 150, base + 1):
        k = (base - y) / 150
        w = 13 if k < 0.78 else 13 * (1 - (k - 0.78) / 0.22) ** 0.7
        for x in range(int(cx - w), int(cx + w) + 1):
            u = (x - cx) / max(1, w)
            c = tone(WHITE, u * 0.9 + 0.1)
            if k > 0.78:
                c = tone(RED, u * 0.9 + 0.1)
            elif 0.5 < k < 0.53:
                c = (40, 44, 56)
            s.set(x, y, c)
    ellipse_fill(s, cx - 2, base - 100, 4, 4, (110, 190, 240))
    for side in (-1, 1):
        for x, y in s.mask([(cx + side * 13, base), (cx + side * 26, base + 4), (cx + side * 13, base - 34)]):
            s.set(x, y, RED[1] if side < 0 else RED[2])
    s.rim()
    # Steam at the foot.
    for k in range(14):
        a = k / 14 * math.pi * 2 + frame
        r = 22 + 8 * hash2(k, frame, 3)
        ellipse_fill(s, cx + math.cos(a) * r, base + 6 + math.sin(a) * r / 3 - frame * 2, 5, 3, (236, 240, 244), 200)
    return s


def all_sprites() -> list[tuple[str, Image.Image, float, float, float]]:
    out: list[tuple[str, Sprite]] = [
        ("senaat0", senaat_hall()),
        ("senaat1", senaat_temple()),
        ("senaat2", senaat_parliament()),
        ("senaat3", senaat_glass()),
        ("senaat4", senaat_galactic()),
        ("wonderStonehenge", stonehenge()),
        ("wonderPyramid", pyramid()),
        ("wonderColosseum", colosseum()),
        ("wonderCathedral", cathedral()),
        ("wonderDome", basilica()),
    ] + [
        (f"{name}{f}", fn(f))
        for name, fn in (("wonderColossus", colossus), ("wonderEiffel", eiffel), ("wonderSkyscraper", skyscraper), ("wonderComputer", supercomputer), ("wonderRocket", rocket))
        for f in range(2)
    ]
    result = []
    for name, s in out:
        bb = s.im.getbbox()
        result.append((name, s.im.crop(bb), AX - bb[0], AY - bb[1], 1.0))
    return result
