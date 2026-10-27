# Our own pixel-art decorations (the things players put up to make the town nicer),
# in the style of pixelart.py: four tones per material with the light from the top
# left, texture in the material, a dark rim, a soft shadow. build.py adds them to
# the atlas as decor<Name>, with numbered frames for the ones that move.

import math
from PIL import Image

from pixelart import STONE, STRAW, WOOD, Color, Sprite, Tones, cone, hash2, tone, wall

W, H = 96, 112
AX, AY = 48, 88  # where the middle of the tile goes

MARBLE: Tones = ((250, 248, 242), (226, 222, 212), (190, 184, 172), (148, 142, 132))
GRANITE: Tones = ((196, 196, 200), (164, 164, 170), (128, 128, 136), (92, 92, 102))
MENHIR: Tones = ((182, 186, 184), (150, 156, 156), (116, 122, 126), (82, 88, 96))
BRONZE: Tones = ((214, 160, 96), (176, 120, 66), (134, 86, 46), (94, 58, 32))
SLATE: Tones = ((112, 122, 140), (84, 94, 112), (62, 70, 88), (42, 48, 62))
BRICK: Tones = ((178, 84, 52), (146, 62, 38), (114, 46, 30), (80, 32, 22))
STEEL: Tones = ((176, 186, 198), (138, 150, 166), (100, 112, 130), (66, 76, 94))
DARK: Tones = ((80, 86, 100), (58, 62, 76), (40, 44, 56), (26, 28, 38))
TOTEM: Tones = ((178, 104, 56), (150, 80, 40), (118, 60, 30), (84, 42, 22))
WATER: Color = (93, 143, 203)
LIGHT_WATER: Color = (150, 196, 236)
FOAM: Color = (214, 234, 250)
LICHEN: Color = (168, 176, 92)
MOSS: Color = (104, 132, 64)

# Blocky digits for "67", 5 wide and 7 high.
DIGITS = {
    "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
    "7": ["#####", "....#", "...#.", "..#..", "..#..", ".#...", ".#..."],
}


def grain(x: int, y: int, salt: int, amount: float = 0.3) -> float:
    return (hash2(x, y, salt) - 0.5) * amount


def prism(s: Sprite, cx: float, cy: float, hw: float, h: float, t: Tones, texture: str = "", top: Color | None = None) -> float:
    """
    An upright block on the ground diamond of half width `hw` round (cx, cy):
    the left face lit, the right face in shade, the top lightest. Returns the y of
    the top's middle.
    """
    hh = hw / 2
    left = [(cx - hw, cy), (cx, cy + hh), (cx, cy + hh - h), (cx - hw, cy - h)]
    right = [(cx, cy + hh), (cx + hw, cy), (cx + hw, cy - h), (cx, cy + hh - h)]
    lid = [(cx - hw, cy - h), (cx, cy + hh - h), (cx + hw, cy - h), (cx, cy - hh - h)]
    for face, base in ((left, 1), (right, 2)):
        for x, y in s.mask(face):
            k = base
            # How far down the face from its top edge (the same all along a course).
            down = y - (cy - h) - (hh - abs(x - cx) * 0.5)
            if texture == "brick":
                # Courses of bricks, the joints a tone darker.
                row = int(down // 3)
                joint = down % 3 < 1 or (x + row * 3) % 6 == 0
                k = base + 1 if joint else base
            elif texture == "band":
                # One course line round the middle.
                k = base + 1 if 0 <= down - h / 2 < 1 else base
            elif hash2(x, y, 31) < 0.06:
                k = base + 1
            s.set(x, y, t[min(3, k)])
    for x, y in s.mask(lid):
        s.set(x, y, top or (t[0] if hash2(x, y, 32) > 0.08 else t[1]))
    return cy - h


def pedestal(s: Sprite, cx: float, cy: float, hw: float, h: float, t: Tones) -> float:
    """A plinth: a wide foot, the block, and a lip on top. Returns the top's middle."""
    prism(s, cx, cy, hw + 2, 2, t)
    y = prism(s, cx, cy - 2, hw, h - 4, t, "band")
    return prism(s, cx, y, hw + 1.5, 2, t)


def ellipse_fill(s: Sprite, cx: float, cy: float, rx: float, ry: float, color, a: int = 255) -> None:
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                s.set(x, y, color, a)


def rect(s: Sprite, x0: float, y0: float, x1: float, y1: float, t: Tones, cx: float | None = None) -> None:
    """A filled box of pixels, shaded across by the light from the left."""
    cx = (x0 + x1) / 2 if cx is None else cx
    half = max(1.0, (x1 - x0) / 2)
    for y in range(int(y0), int(y1) + 1):
        for x in range(int(x0), int(x1) + 1):
            s.set(x, y, tone(t, (x - cx) / half * 0.8, grain(x, y, 33, 0.15)))


def digits(s: Sprite, text: str, x0: int, y0: int, k: int, face: Tones, depth: int, a: int = 255) -> None:
    """Blocky digits with their top left at (x0, y0), k px per cell, pushed out `depth` px."""
    cells = []
    for i, ch in enumerate(text):
        for r, row in enumerate(DIGITS[ch]):
            for c, on in enumerate(row):
                if on == "#":
                    cells.append((x0 + (i * 6 + c) * k, y0 + r * k))
    # The block behind the front first, up and to the right: lit on top, shaded on the side.
    body = set()
    for d in range(1, depth + 1):
        for x, y in cells:
            for yy in range(k):
                for xx in range(k):
                    body.add((x + xx + d, y + yy - d))
    front = {(x + xx, y + yy) for x, y in cells for yy in range(k) for xx in range(k)}
    for x, y in body - front:
        top = (x, y - 1) not in body
        s.set(x, y, face[0] if top else face[2], a)
    on = set(cells)
    for x, y in cells:
        for yy in range(k):
            for xx in range(k):
                # Light catches the top and left edges of the strokes.
                lit = (yy == 0 and (x, y - k) not in on) or (xx == 0 and (x - k, y) not in on)
                s.set(x + xx, y + yy, face[0] if lit else face[1], a)


# ---------- figures ----------

def figure(s: Sprite, cx: int, feet: int, t: Tones, kind: str) -> None:
    """A standing figure about 30 px high, its feet on y = feet."""
    hip = feet - 12
    waist = hip - 2
    chest = feet - 23  # the shoulders
    head = chest - 4  # the middle of the head
    # Legs, with a gap between them (David stands with his weight on one leg).
    lean = 1 if kind == "david" else 0
    rect(s, cx - 4, hip, cx - 1, feet, t, cx)
    rect(s, cx + 1, hip + lean, cx + 4, feet, t, cx)
    for y in range(hip, feet + 1):
        s.set(cx, y, t[3] if y > hip + 1 else t[2])
    # The body: broad shoulders, a narrower waist, the hips.
    for y in range(chest, hip + 1):
        w = 5 if y < chest + 3 else 4 if y < waist else 4
        rect(s, cx - w, y, cx + w, y, t, cx)
    # Neck and head.
    rect(s, cx - 1, chest - 1, cx + 1, chest, t, cx)
    if kind == "astronaut":
        ellipse_fill(s, cx, head - 1, 5.5, 5.5, t[0])
        ellipse_fill(s, cx + 1, head, 3.5, 3, (232, 176, 64))  # gold visor
        s.set(cx, head - 1, (255, 236, 160))
        rect(s, cx + 5, chest + 1, cx + 7, waist, t, cx)  # backpack
    else:
        ellipse_fill(s, cx, head - 1, 3.5, 4, t[1])
        s.set(cx - 2, head - 2, t[0])
        s.set(cx - 1, head - 3, t[0])
    arm = lambda x: rect(s, x - 1, chest + 1, x + 1, waist + 1, t, cx)  # noqa: E731
    if kind == "warrior":
        # A crested helmet, a round shield in front, a spear held up.
        for x in range(cx - 4, cx + 5):
            s.set(x, head - 4, t[2])
            s.set(x, head - 3, t[1])
        for i in range(7):
            s.set(cx - 3 + i, head - 5 - (1 if 0 < i < 6 else 0), (176, 52, 40))
            s.set(cx - 3 + i, head - 6 - (1 if 1 < i < 5 else 0), (206, 72, 52))
        arm(cx + 6)
        s.line(cx + 7, feet, cx + 7, head - 12, WOOD[1])
        s.line(cx + 8, feet, cx + 8, head - 12, WOOD[2])
        for i in range(4):
            for dx in range(-1 + i // 2, 2 - i // 2 + 1):
                s.set(cx + 7 + dx, head - 13 - i, t[0] if dx <= 0 else t[2])
        ellipse_fill(s, cx - 3, chest + 7, 5.5, 6, t[1])
        ellipse_fill(s, cx - 4, chest + 6, 3, 3.5, t[0])
        ellipse_fill(s, cx - 3, chest + 7, 1.5, 1.5, t[3])
    elif kind == "knight":
        # A helmet with a slit, a sword raised high, a kite shield.
        rect(s, cx - 4, head - 5, cx + 4, head + 2, t, cx)
        for x in range(cx - 3, cx + 4):
            s.set(x, head - 1, t[3])
        for k in range(4):
            s.set(cx, head - 6 - k, (176, 52, 40))
            s.set(cx + 1, head - 6 - k + 1, (140, 40, 32))
        rect(s, cx + 5, chest - 7, cx + 7, chest + 2, t, cx)  # the arm up
        s.line(cx + 4, chest - 8, cx + 9, chest - 8, (200, 160, 60))
        for y in range(chest - 22, chest - 8):
            s.set(cx + 6, y, t[0])
            s.set(cx + 7, y, t[2])
        s.set(cx + 6, chest - 23, t[0])
        for y in range(chest + 2, chest + 16):
            half = 5 if y < chest + 8 else max(0, 5 - (y - chest - 7) * 0.7)
            for x in range(int(cx - 4 - half), int(cx - 4 + half) + 1):
                cross = abs(x - (cx - 4)) <= 0 or y == chest + 6
                s.set(x, y, (204, 152, 44) if cross else (52, 84, 136) if x < cx - 4 else (40, 64, 110))
    elif kind == "david":
        # One hand at the shoulder (the sling), the other hanging; curls on the head.
        rect(s, cx - 7, chest - 3, cx - 5, chest + 4, t, cx)
        s.set(cx - 6, chest - 4, t[0])
        arm(cx + 6)
        for x, y in ((cx - 3, head - 4), (cx - 1, head - 5), (cx + 1, head - 5), (cx + 3, head - 4), (cx + 3, head - 2), (cx - 3, head - 2)):
            s.set(x, y, t[2])
            s.set(x + 1, y, t[1])
    elif kind == "astronaut":
        # Arms out, one holding a flag on a pole.
        arm(cx - 6)
        s.line(cx + 9, feet, cx + 9, head - 14, STEEL[1])
        s.line(cx + 10, feet, cx + 10, head - 14, STEEL[3])
        for y in range(head - 14, head - 6):
            for x in range(cx + 11, cx + 21):
                stripe = (y - (head - 14)) * 3 // 8
                s.set(x, y, [(204, 52, 52), (240, 240, 240), (52, 84, 170)][stripe])
        rect(s, cx + 6, chest + 1, cx + 8, chest + 4, t, cx)


def shadow(s: Sprite, rx: float) -> None:
    s.shadow(AX + 2, AY + 1, rx, rx / 2)


def finish(s: Sprite, rim: bool = True) -> Sprite:
    if rim:
        s.rim()
    return s


# ---------- the decorations ----------

def six_seven(frame: int) -> Sprite:
    """The 67 statue: big stone digits on a plinth, two hands going up and down in turn."""
    s = Sprite(W, H)
    shadow(s, 22)
    top = pedestal(s, AX, AY, 16, 10, GRANITE)
    digits(s, "67", AX - 16, int(top) - 22, 3, MARBLE, 2)
    for side, up in ((-1, frame == 0), (1, frame == 1)):
        x = AX + side * 23
        y = int(top) - (22 if up else 14)
        # A flat hand, palm up, with the thumb on the inside, weighing it up.
        for dx in range(-4, 5):
            s.set(x + dx, y, MARBLE[0])
            s.set(x + dx, y + 1, MARBLE[1] if abs(dx) < 4 else MARBLE[2])
            if abs(dx) < 3:
                s.set(x + dx, y + 2, MARBLE[2])
        for k in range(4):  # fingers
            s.set(x - side * 4 + side * 0, y - 1, MARBLE[1])
        s.set(x - side * 5, y - 1, MARBLE[0])
        s.set(x - side * 5, y - 2, MARBLE[0])
        rect(s, x - 1, y + 3, x + 1, y + 6, MARBLE)  # the wrist
    return finish(s)


def flowerbed() -> Sprite:
    """A raised bed edged with stones, full of tulips in rows."""
    s = Sprite(W, H)
    shadow(s, 26)
    hw = 22
    # The stone edge and the soil on top.
    prism(s, AX, AY, hw, 4, STONE, top=(92, 64, 44))
    for x, y in s.mask([(AX - hw + 3, AY - 4), (AX, AY - 4 + hw / 2 - 1.5), (AX + hw - 3, AY - 4), (AX, AY - 4 - hw / 2 + 1.5)]):
        s.set(x, y, (92, 64, 44) if hash2(x, y, 40) > 0.25 else (70, 48, 34))
    colors = [((236, 72, 72), (176, 40, 48)), ((248, 210, 72), (204, 156, 40)), ((244, 148, 196), (196, 96, 150)), ((250, 248, 240), (206, 206, 196))]
    # Rows across the bed, front ones last so they stand in front.
    rows = []
    for r in range(5):
        for c in range(6):
            u = (c + 0.5) / 6 - 0.5
            v = (r + 0.5) / 5 - 0.5
            x = AX + (u - v) * (hw - 4) * 1.0
            y = AY - 4 + (u + v) * (hw - 4) * 0.5
            rows.append((y, x, (r + c) % 4 if r % 2 else r % 4))
    for y, x, k in sorted(rows):
        x, y = int(round(x)), int(round(y))
        s.set(x, y, (64, 116, 40))
        s.set(x, y - 1, (64, 116, 40))
        s.set(x - 1, y, (88, 140, 44))
        s.set(x + 1, y - 1, (88, 140, 44))
        light, dark = colors[k]
        for dx, dy, c in ((-1, -3, light), (0, -3, light), (1, -3, dark), (-1, -2, light), (0, -2, dark), (1, -2, dark), (0, -4, light)):
            s.set(x + dx, y + dy, c)
    return finish(s)


def totem() -> Sprite:
    """A carved pole of four painted faces with spread wings on top."""
    s = Sprite(W, H)
    shadow(s, 12)
    red, teal, yellow, black = (196, 56, 40), (40, 140, 140), (232, 184, 56), (30, 24, 22)
    x0, x1 = AX - 6, AX + 6
    seg = 11
    for i in range(4):
        y1 = AY - i * seg
        y0 = y1 - seg + 1
        rect(s, x0, y0, x1, y1, TOTEM, AX)
        # Each segment has a face: brows, eyes, a beak or a mouth.
        paint = [teal, red, yellow, teal][i]
        ey = y0 + 3
        for dx in (-3, 2):
            s.set(AX + dx, ey - 1, paint)
            s.set(AX + dx + 1, ey - 1, paint)
            s.set(AX + dx, ey, (240, 236, 220))
            s.set(AX + dx + 1, ey, black)
        if i % 2 == 0:
            for k in range(3):  # a beak pointing down
                for x in range(AX - 1 + k // 2, AX + 2 - k // 2):
                    s.set(x, ey + 2 + k, red if i != 0 else yellow)
        else:
            for x in range(AX - 2, AX + 3):
                s.set(x, ey + 4, black)
                s.set(x, ey + 3, paint)
        for x in range(x0, x1 + 1):
            s.set(x, y1, TOTEM[3])
    top = AY - 4 * seg
    # Wings.
    for side in (-1, 1):
        for k in range(14):
            x = AX + side * (5 + k)
            yb = top + 2 - k // 3
            for y in range(yb - 4 + k // 4, yb + 1):
                c = red if (k + y) % 5 else black
                if k > 10:
                    c = black
                s.set(x, y, c)
    # The head on top.
    rect(s, AX - 4, top - 6, AX + 4, top + 1, TOTEM, AX)
    s.set(AX - 2, top - 3, (240, 236, 220))
    s.set(AX + 2, top - 3, (240, 236, 220))
    for k in range(3):
        s.set(AX - 1 + k, top - 1, yellow)
    s.set(AX, top, yellow)
    return finish(s)


def menhir() -> Sprite:
    """A tall standing stone, leaning a little, with lichen and a few stones at its foot."""
    s = Sprite(W, H)
    shadow(s, 16)
    poly = [(AX - 8, AY + 2), (AX - 9, AY - 14), (AX - 7, AY - 32), (AX - 3, AY - 42), (AX + 2, AY - 44),
            (AX + 6, AY - 36), (AX + 8, AY - 16), (AX + 8, AY + 1), (AX, AY + 4)]
    for x, y in s.mask(poly):
        u = (x - AX) / 8
        c = tone(MENHIR, u + 0.1, grain(x // 2, y // 3, 41, 0.35))
        # Facets: a ridge down the front.
        if abs(x - (AX + 1 + (AY - y) * 0.02)) < 0.6:
            c = MENHIR[2]
        if hash2(x // 2, y // 2, 42) < 0.08 and u < 0.4:
            c = LICHEN
        s.set(x, y, c)
    # Spiral carving.
    for a in range(0, 26):
        r = 1 + a * 0.18
        x = AX - 2 + math.cos(a * 0.7) * r
        y = AY - 24 + math.sin(a * 0.7) * r * 1.2
        s.set(x, y, MENHIR[3])
    for dx, dy, r in ((-12, 2, 3), (11, 1, 2.5), (-6, 6, 2)):
        ellipse_fill(s, AX + dx, AY + dy - 1, r, r * 0.7, STONE[1])
        s.set(AX + dx - 1, AY + dy - 2, STONE[0])
    for dx in (-10, 9, 12):
        s.set(AX + dx, AY + 3, MOSS)
        s.set(AX + dx, AY + 2, (120, 160, 70))
    return finish(s)


def statue(kind: str, t: Tones, base: Tones) -> Sprite:
    s = Sprite(W, H)
    shadow(s, 18)
    top = pedestal(s, AX, AY, 12, 12, base)
    figure(s, AX, int(top) + 1, t, kind)
    return finish(s)


def fountain(frame: int) -> Sprite:
    """A round marble basin with a column and a bowl, the water jumping out of it."""
    s = Sprite(W, H)
    shadow(s, 28)
    rx = 24
    # The basin's far rim, the water, then its near wall.
    ellipse_fill(s, AX, AY - 5, rx, rx / 2, MARBLE[2])
    ellipse_fill(s, AX, AY - 5, rx - 3, rx / 2 - 2, WATER)
    for k in range(10):  # ripples in the basin
        a = k / 10 * math.pi * 2 + frame * 0.6
        r = (k % 3 + 1) * 5 + frame % 2
        s.set(AX + math.cos(a) * r, AY - 5 + math.sin(a) * r / 2, LIGHT_WATER)
    wall(s, AX, AY, rx, 5, MARBLE, "")
    for x in range(AX - rx, AX + rx + 1):
        u = (x - AX) / rx
        y = AY - 5 + rx / 2 * math.sqrt(max(0, 1 - u * u))
        s.set(x, y, MARBLE[0])
    # The column and the upper bowl.
    rect(s, AX - 2, AY - 22, AX + 2, AY - 6, MARBLE, AX)
    ellipse_fill(s, AX, AY - 22, 8, 3, MARBLE[1])
    ellipse_fill(s, AX, AY - 23, 6, 2, WATER)
    for x in range(AX - 8, AX + 9):
        s.set(x, AY - 21 + (1 if abs(x - AX) < 6 else 0), MARBLE[2])
    s.rim()
    # Water: a jet from the top, falling from the bowl into the basin.
    for y in range(AY - 33 + frame % 2, AY - 23):
        s.set(AX, y, FOAM)
        if y % 2 == frame % 2:
            s.set(AX + (1 if y % 4 else -1), y, LIGHT_WATER)
    for side in (-1, 1):
        for k in range(10):
            p = (k + frame * 2.5) % 10 / 10
            x = AX + side * (7 + p * 9)
            y = AY - 22 + p * p * 16
            s.set(x, y, LIGHT_WATER if k % 3 else FOAM)
    for k in range(5):
        a = (k + frame) / 5 * math.pi
        s.set(AX + math.cos(a) * 4, AY - 34 + frame % 2 + math.sin(a) * 1.5, FOAM)
    return s


def clocktower() -> Sprite:
    """A brick clock tower with a slate spire. The clock says 6:07."""
    s = Sprite(W, H)
    shadow(s, 16)
    hw = 11
    top = prism(s, AX, AY, hw, 50, BRICK, "brick")
    # A stone band at the top of the walls.
    prism(s, AX, top + 2, hw + 1, 3, STONE)
    # The clock on the left face, round in the plane of the wall.
    cx = AX - hw / 2
    cy = top + 13 + hw / 4
    for y in range(int(cy) - 8, int(cy) + 9):
        for x in range(int(cx) - 6, int(cx) + 7):
            du = x + 0.5 - cx
            dv = y + 0.5 - cy - du * 0.5
            r = (du / 5.2) ** 2 + (dv / 6.2) ** 2
            if r <= 1:
                s.set(x, y, (200, 160, 60) if r > 0.62 else (246, 240, 220))
    s.line(cx, cy, cx, cy + 3, (30, 26, 22))  # hour hand at 6
    s.line(cx, cy, cx + 1, cy - 3, (30, 26, 22))  # minute hand at 7 past
    # A window under the clock on the right face.
    for y in range(int(top + 26), int(top + 33)):
        for x in range(int(AX + 4), int(AX + 7)):
            s.set(x, y - (x - AX) * 0.5, (40, 32, 30))
    # The spire.
    cone(s, AX, top - 2, hw + 3, 24, ((132, 142, 162), SLATE[1], SLATE[2], SLATE[3]), "")
    s.line(AX, top - 26, AX, top - 32, (200, 160, 60))
    return finish(s)


def neon(on: bool) -> Sprite:
    """A sign on a pole, 67 in pink neon tubes (one frame lit, one flickering out)."""
    s = Sprite(W, H)
    shadow(s, 12)
    rect(s, AX - 1, AY - 26, AX + 1, AY, STEEL, AX)
    rect(s, AX - 19, AY - 48, AX + 19, AY - 26, DARK, AX)
    pink = ((255, 168, 224), (255, 47, 179), (196, 30, 136), (120, 20, 90)) if on else ((150, 100, 130), (110, 70, 100), (80, 50, 74), (60, 40, 56))
    if on:
        # A glow on the board round the tubes.
        for y in range(AY - 46, AY - 27):
            for x in range(AX - 17, AX + 18):
                if hash2(x, y, 50) < 0.25:
                    s.set(x, y, (92, 40, 84))
    digits(s, "67", AX - 11, AY - 44, 2, pink, 0)
    s.rim()
    if on:
        for x in range(AX - 20, AX + 21, 4):
            s.set(x, AY - 50, (255, 120, 210), 120)
    return s


def holo_base() -> Sprite:
    """The projector of the hologram: a dark disc with cyan lights."""
    s = Sprite(W, H)
    shadow(s, 16)
    prism(s, AX, AY, 12, 3, DARK)
    ellipse_fill(s, AX, AY - 4, 7, 3.5, (34, 240, 255), 200)
    ellipse_fill(s, AX, AY - 4, 4, 2, (200, 255, 255))
    for k in range(6):
        a = k / 6 * math.pi * 2
        s.set(AX + math.cos(a) * 10, AY - 3 + math.sin(a) * 5, (34, 240, 255))
    return finish(s)


def holo() -> Sprite:
    """The hologram itself: a see-through 67 with scan lines (drawn floating, see draw.ts)."""
    s = Sprite(W, H)
    cyan = ((200, 255, 255), (34, 240, 255), (20, 160, 200), (10, 100, 140))
    digits(s, "67", AX - 17, AY - 44, 3, cyan, 2, 190)
    for y in range(AY - 46, AY - 18):
        if y % 3 == 0:
            for x in range(AX - 20, AX + 22):
                if s.get(x, y)[3] > 0:
                    s.set(x, y, (10, 120, 160), 120)
    # The beam from the projector.
    for y in range(AY - 22, AY - 4):
        w = (y - (AY - 22)) * 0.4
        for x in range(int(AX - 12 + w), int(AX + 12 - w) + 1):
            if (x + y) % 3 == 0 and s.get(x, y)[3] == 0:
                s.set(x, y, (34, 240, 255), 70)
    return s


def monument(frame: int) -> Sprite:
    """The mega-67: huge purple digits on a stepped dark plinth, glowing."""
    s = Sprite(W, H)
    shadow(s, 30)
    y = prism(s, AX, AY, 26, 4, DARK)
    y = prism(s, AX, y, 21, 4, DARK)
    y = prism(s, AX, y, 16, 3, SLATE)
    purple = ((232, 196, 255), (176, 107, 255), (124, 64, 204), (80, 36, 140))
    top = int(y) - 30
    digits(s, "67", AX - 17, top, 3, purple, 2)
    s.rim()
    # A glow round the digits, pulsing.
    solid = [(x, yy) for yy in range(s.h) for x in range(s.w) if s.get(x, yy)[3] == 255 and yy < y - 2]
    halo = {(x + dx, yy + dy) for x, yy in solid for dx in range(-3 - frame, 4 + frame) for dy in range(-3 - frame, 4 + frame) if dx * dx + dy * dy <= (3 + frame) ** 2}
    for x, yy in halo:
        if s.get(x, yy)[3] == 0 and hash2(x, yy, 60 + frame) < 0.5:
            s.set(x, yy, (176, 107, 255), 70 + 20 * frame)
    # A few sparks.
    for k in range(5):
        a = k * 1.3 + frame * 0.7
        s.set(AX + math.cos(a) * 24, top + 10 + math.sin(a) * 12, (255, 240, 255))
    return s


def all_sprites() -> list[tuple[str, Image.Image, float, float, float]]:
    out: list[tuple[str, Sprite]] = [
        ("decorSixSeven0", six_seven(0)),
        ("decorSixSeven1", six_seven(1)),
        ("decorFlowers", flowerbed()),
        ("decorTotem", totem()),
        ("decorMenhir", menhir()),
        ("decorWarrior", statue("warrior", GRANITE, GRANITE)),
        ("decorKnight", statue("knight", MARBLE, GRANITE)),
        ("decorDavid", statue("david", MARBLE, MARBLE)),
        ("decorAstronaut", statue("astronaut", ((248, 250, 252), (220, 226, 234), (176, 186, 200), (130, 140, 158)), STEEL)),
        ("decorClocktower", clocktower()),
        ("decorNeon0", neon(True)),
        ("decorNeon1", neon(False)),
        ("decorHoloBase", holo_base()),
        ("decorHolo", holo()),
        ("decorMonument0", monument(0)),
        ("decorMonument1", monument(1)),
    ] + [(f"decorFountain{i}", fountain(i)) for i in range(4)]
    result = []
    for name, s in out:
        bb = s.im.getbbox()
        result.append((name, s.im.crop(bb), AX - bb[0], AY - bb[1], 1.0))
    return result
