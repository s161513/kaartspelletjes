# Our own pixel-art sprites, drawn by code in the style of the packs in src/: hard
# pixels, four tones per material with the light from the top left, texture in the
# material (thatch courses, hide seams, wattle), a dark rim, a soft shadow.
# Used for what the packs don't have: the Stone and Bronze Age. build.py adds them
# to the atlas.

import math
from PIL import Image, ImageDraw

Color = tuple[int, int, int]
Tones = tuple[Color, Color, Color, Color]  # light, base, dark, darkest

STRAW: Tones = ((240, 196, 128), (217, 159, 105), (176, 118, 72), (128, 80, 52))
STRAW_OLD: Tones = ((214, 176, 110), (190, 142, 88), (150, 106, 64), (108, 72, 46))
HIDE: Tones = ((222, 188, 136), (194, 152, 100), (152, 112, 72), (104, 74, 50))
HIDE_PALE: Tones = ((232, 214, 172), (208, 184, 138), (166, 140, 100), (118, 96, 66))
WATTLE: Tones = ((178, 142, 98), (150, 114, 78), (118, 86, 58), (84, 60, 42))
DAUB: Tones = ((226, 196, 152), (198, 160, 112), (160, 124, 84), (116, 88, 60))
WOOD: Tones = ((156, 106, 66), (124, 82, 50), (94, 60, 38), (64, 40, 26))
STONE: Tones = ((177, 191, 155), (140, 160, 130), (100, 124, 108), (66, 92, 86))
PAINT = [(170, 56, 40), (52, 84, 136), (204, 152, 44)]
DOOR = (40, 26, 18)

W, H = 96, 96
AX, AY = 48, 72  # where the middle of the tile goes


def hash2(x: int, y: int, salt: int = 0) -> float:
    h = (x * 374761393 + y * 668265263 + salt * 2246822519) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFF) / 0x1000000


class Sprite:
    def __init__(self, w: int = W, h: int = H) -> None:
        self.w, self.h = w, h
        self.im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        self.px = self.im.load()

    def set(self, x: float, y: float, c: Color, a: int = 255) -> None:
        x, y = int(round(x)), int(round(y))
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[x, y] = (*c, a)

    def get(self, x: int, y: int) -> tuple[int, int, int, int]:
        return self.px[x, y] if 0 <= x < self.w and 0 <= y < self.h else (0, 0, 0, 0)

    def mask(self, poly: list[tuple[float, float]]) -> list[tuple[int, int]]:
        """The pixels inside a polygon (hard edges, no smoothing)."""
        m = Image.new("1", (self.w, self.h), 0)
        ImageDraw.Draw(m).polygon([(round(x), round(y)) for x, y in poly], fill=1)
        mp = m.load()
        return [(x, y) for y in range(self.h) for x in range(self.w) if mp[x, y]]

    def shadow(self, cx: float, cy: float, rx: float, ry: float) -> None:
        for y in range(self.h):
            for x in range(self.w):
                if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 and self.get(x, y)[3] == 0:
                    self.set(x, y, (10, 14, 10), 70)

    def line(self, x0: float, y0: float, x1: float, y1: float, c: Color) -> None:
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(n + 1):
            t = i / n
            self.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, c)

    def rim(self) -> None:
        """A dark rim round everything solid, from the color next to it."""
        src = self.im.copy().load()
        for y in range(self.h):
            for x in range(self.w):
                if src[x, y][3] == 255:
                    continue
                for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < self.w and 0 <= ny < self.h and src[nx, ny][3] == 255:
                        r, g, b, _ = src[nx, ny]
                        self.px[x, y] = (int(r * 0.4), int(g * 0.4), int(b * 0.44), 255)
                        break


def tone(t: Tones, u: float, grain: float = 0) -> Color:
    """Light from the left: u in -1..1 across the shape."""
    u += grain
    return t[0] if u < -0.45 else t[1] if u < 0.2 else t[2] if u < 0.65 else t[3]


def arc(cx: float, cy: float, rx: float, ry: float, a0: float, a1: float, n: int = 24) -> list[tuple[float, float]]:
    return [(cx + rx * math.cos(a0 + (a1 - a0) * i / n), cy + ry * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def wall(s: Sprite, cx: float, cy: float, rx: float, h: float, t: Tones, kind: str) -> None:
    """The front of a round wall, `h` high, standing on the ellipse at (cx, cy)."""
    ry = rx / 2
    poly = [(cx - rx, cy - h), (cx + rx, cy - h)] + arc(cx, cy, rx, ry, 0, math.pi)
    for x, y in s.mask(poly):
        u = (x - cx) / rx
        g = (hash2(x, y, 3) - 0.5) * 0.25
        c = tone(t, u * 0.9 + 0.1, g)
        # Height above the ground at this x, for the weave rows.
        ground = cy + ry * math.sqrt(max(0, 1 - u * u))
        up = ground - y
        if kind == "wattle" and int(up) % 3 == 0 and (x + int(up // 3)) % 4 < 2:
            c = t[min(3, t.index(c) + 1)] if c in t else c
        if kind == "daub" and hash2(x, y, 5) < 0.05:
            c = t[2]
        if kind == "stone" and up < 4:
            sc = tone(STONE, u, (hash2(x // 3, int(up) // 2, 7) - 0.5) * 0.8)
            c = sc if not (x + (int(up) // 2) * 2) % 4 == 0 else STONE[3]
        s.set(x, y, c)


def cone(s: Sprite, cx: float, cy: float, rx: float, h: float, t: Tones, kind: str, paint: Color | None = None) -> float:
    """A cone on the ellipse at (cx, cy); returns the apex y."""
    ry = rx / 2
    apex = cy - h
    poly = [(cx, apex), (cx + rx, cy)] + arc(cx, cy, rx, ry, 0, math.pi) + [(cx - rx, cy)]
    for x, y in s.mask(poly):
        # How far down the cone (0 at the top, 1 at the rim) and across it.
        k = max(0.02, min(1, (y - apex) / (cy - apex + ry * 0.6)))
        u = max(-1, min(1, (x - cx) / (rx * k + 0.01)))
        g = (hash2(x, y, 1) - 0.5) * 0.3
        c = tone(t, u, g)
        if kind == "straw":
            # Thatch courses: a dark line under each course, a light one on top.
            d = (y - apex - k * ry * math.sqrt(max(0, 1 - u * u)) * 0.9) / h
            f = (d * 6) % 1
            if f > 0.86:
                c = t[min(3, t.index(tone(t, u)) + 1)]
            elif f < 0.12 and u < 0.5:
                c = t[0]
            # Loose strands.
            if hash2(x, int(y // 2), 2) < 0.07:
                c = t[min(3, t.index(tone(t, u)) + 1)]
        elif kind == "hide":
            # Seams from the top, and a painted band.
            for su in (-0.62, -0.1, 0.42):
                if abs(u - su) < 0.06 + 0.5 / max(4, rx * k):
                    c = t[min(3, t.index(tone(t, u)) + 1)]
            if paint and 0.5 < k < 0.62:
                zig = abs(((x - cx) % 6) - 3) / 3
                if (k - 0.5) / 0.12 > zig * 0.8:
                    c = paint if u < 0.45 else tuple(int(v * 0.7) for v in paint)
        s.set(x, y, c)
    return apex


def door(s: Sprite, cx: float, cy: float, rx: float, hgt: float, frame: Tones | None = WOOD) -> None:
    """A door on the front of a round wall, a little to the left."""
    ry = rx / 2
    a = math.pi * 0.58
    dx = cx + rx * math.cos(a)
    dy = cy + ry * math.sin(a)
    w = max(2, round(rx / 4))
    for y in range(int(dy - hgt), int(dy) + 1):
        for x in range(int(dx - w), int(dx + w) + 1):
            top = dy - hgt + (abs(x - dx) / w) ** 2 * 2
            if y >= top:
                s.set(x, y, DOOR)
    if frame:
        for y in range(int(dy - hgt), int(dy) + 1):
            s.set(dx - w - 1, y, frame[1])
            s.set(dx + w + 1, y, frame[2])


def eave_shadow(s: Sprite, cx: float, cy: float, rx: float, depth: int = 2) -> None:
    """The roof's shadow on the top of the wall under it."""
    ry = rx / 2
    for x in range(int(cx - rx), int(cx + rx) + 1):
        u = (x - cx) / rx
        y0 = cy + ry * math.sqrt(max(0, 1 - u * u))
        for dy in range(depth):
            p = s.get(x, int(y0) + dy + 1)
            if p[3] == 255:
                s.set(x, int(y0) + dy + 1, (int(p[0] * 0.62), int(p[1] * 0.6), int(p[2] * 0.62)))


def poles(s: Sprite, cx: float, apex: float, spread: list[int]) -> None:
    for d in spread:
        s.line(cx, apex + 3, cx + d, apex - 6, WOOD[2])
        s.set(cx + d, apex - 6, WOOD[0])


# ---------- the sprites ----------

def tipi(paint: Color, hide: Tones, r: float = 14, h: float = 32) -> Sprite:
    s = Sprite()
    s.shadow(AX + 2, AY + 1, r + 4, (r + 4) / 2)
    apex = cone(s, AX, AY, r, h, hide, "hide", paint)
    poles(s, AX, apex, [-5, -2, 2, 5])
    # The door flap, folded open.
    for y in range(int(AY - 11), int(AY + 6)):
        k = (y - (AY - 11)) / 17
        for x in range(int(AX - 4 - k * 2), int(AX + 1 + k)):
            s.set(x, y, DOOR)
        s.set(AX + 2 + k, y, hide[0])
    s.rim()
    return s


def hut(rx: float, wall_h: float, roof_h: float, wall_t: Tones, straw: Tones, kind: str, overhang: float = 1.2) -> Sprite:
    s = Sprite()
    s.shadow(AX + 2, AY + 1, rx * overhang + 3, (rx * overhang + 3) / 2)
    wall(s, AX, AY, rx, wall_h, wall_t, kind)
    door(s, AX, AY, rx, min(wall_h - 1, 8))
    er = rx * overhang
    cone(s, AX, AY - wall_h, er, roof_h, straw, "straw")
    eave_shadow(s, AX, AY - wall_h, er)
    s.rim()
    return s


def roundhouse(rx: float, wall_h: float, roof_h: float, smoke_hole: bool = True) -> Sprite:
    s = Sprite()
    s.shadow(AX + 3, AY + 2, rx * 1.25 + 3, (rx * 1.25 + 3) / 2)
    wall(s, AX, AY, rx, wall_h, DAUB, "stone")
    door(s, AX, AY, rx, wall_h - 1)
    er = rx * 1.22
    apex = cone(s, AX, AY - wall_h, er, roof_h, STRAW, "straw")
    eave_shadow(s, AX, AY - wall_h, er)
    if smoke_hole:
        for x in range(AX - 2, AX + 3):
            s.set(x, apex + 3, STRAW[3])
    s.rim()
    return s


def lookout(level: int) -> Sprite:
    s = Sprite()
    s.shadow(AX + 2, AY + 1, 13, 6)
    top = AY - 26 - level * 4
    legs = [(-9, 0), (9, 0), (-3, 4), (3, -4)]
    for dx, dy in sorted(legs, key=lambda p: p[1]):
        x0, y0 = AX + dx, AY + dy
        x1, y1 = AX + dx * 0.7, top + dy * 0.7 + 2
        for o in (0, 1):
            s.line(x0 + o, y0, x1 + o, y1, WOOD[1] if o == 0 else WOOD[2])
    # Cross braces.
    s.line(AX - 9, AY - 4, AX + 6, top + 8, WOOD[2])
    # The platform: a diamond of planks with a rail.
    for x, y in s.mask([(AX - 12, top), (AX, top + 6), (AX + 12, top), (AX, top - 6)]):
        c = WOOD[0] if (x + y) % 4 else WOOD[1]
        s.set(x, y, c)
    for x, y in s.mask([(AX - 12, top), (AX, top + 6), (AX, top + 9), (AX - 12, top + 3)]):
        s.set(x, y, WOOD[2])
    for x, y in s.mask([(AX, top + 6), (AX + 12, top), (AX + 12, top + 3), (AX, top + 9)]):
        s.set(x, y, WOOD[3])
    # Posts on the corners and a little straw roof.
    for dx, dy in ((-10, 0), (10, 0), (0, 5)):
        s.line(AX + dx, top + dy, AX + dx, top + dy - 7, WOOD[2])
    cone(s, AX, top - 6, 14, 12, STRAW, "straw")
    # A red pennant.
    s.line(AX, top - 18, AX, top - 25, WOOD[3])
    for i in range(6):
        for j in range(-1 + i // 3, 2 - i // 3):
            s.set(AX + 1 + i, top - 24 + j, PAINT[0])
    s.rim()
    return s


def campfire() -> Sprite:
    s = Sprite()
    for i in range(9):
        a = i / 9 * math.pi * 2
        x = AX + math.cos(a) * 14
        y = AY + math.sin(a) * 7
        for yy in range(-2, 2):
            for xx in range(-3, 3):
                if (xx / 3) ** 2 + (yy / 2.2) ** 2 <= 1:
                    s.set(x + xx, y + yy, tone(STONE, xx / 3 - 0.2, (hash2(i, yy) - 0.5) * 0.3))
    # Crossed logs and embers.
    for x0, y0, x1, y1 in ((-9, 2, 8, -3), (-8, -3, 9, 2)):
        for o in (0, 1):
            s.line(AX + x0, AY + y0 + o, AX + x1, AY + y1 + o, WOOD[1 + o])
    for x, y in ((-2, 0), (1, -1), (3, 1), (-4, 1)):
        s.set(AX + x, AY + y, (255, 140, 40))
    s.rim()
    return s


def flame(i: int) -> Sprite:
    """Four frames of a fire, to go on the campfire."""
    s = Sprite()
    h = (16, 19, 15, 18)[i]
    lean = (0, 1, -1, 1)[i]
    for y in range(int(AY - h), AY + 1):
        k = (AY - y) / h  # 0 at the bottom, 1 at the tip
        w = 6 * (1 - k) ** 0.8 + 0.5
        cx = AX + lean * k * 3 + math.sin(k * 5 + i) * k
        for x in range(int(cx - w), int(cx + w) + 1):
            e = abs(x - cx) / w
            c = (255, 236, 120) if e < 0.35 and k < 0.6 else (252, 170, 40) if e < 0.7 else (226, 88, 30)
            if hash2(x, y, i) < 0.08 + k * 0.2 and e > 0.5:
                continue
            s.set(x, y, c)
    return s


def all_sprites() -> list[tuple[str, Image.Image, int, int, float]]:
    out: list[tuple[str, Sprite]] = [
        ("tipi0", tipi(PAINT[0], HIDE)),
        ("tipi1", tipi(PAINT[1], HIDE_PALE)),
        ("tipi2", tipi(PAINT[2], HIDE, 13, 29)),
        ("hutSmall", hut(8, 5, 11, WATTLE, STRAW, "wattle")),
        ("hut", hut(12, 7, 16, WATTLE, STRAW, "wattle")),
        ("hutStore", hut(15, 5, 12, WATTLE, STRAW_OLD, "wattle", 1.15)),
        ("roundhouseSmall", roundhouse(9, 5, 12, False)),
        ("roundhouse", roundhouse(15, 9, 22)),
        ("roundhouseStore", roundhouse(17, 6, 16)),
        ("lookout0", lookout(0)),
        ("lookout1", lookout(1)),
        ("campfire", campfire()),
    ] + [(f"flame{i}", flame(i)) for i in range(4)]
    result = []
    for name, s in out:
        bb = s.im.getbbox()
        result.append((name, s.im.crop(bb), AX - bb[0], AY - bb[1], 1.0))
    return result
