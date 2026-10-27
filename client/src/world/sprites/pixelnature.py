# Our own pixel-art ground details, in the colors of Yar's tileset: water with waves
# that come and go, banks along the water, and little flowers for the grass. build.py
# adds them to the atlas.
#
# Every tile sprite is the 64x32 ground diamond with its middle at (32, 16).
# Coordinates inside a tile: (u, v) in 0..1 along the tile's x and y axes, so
# u = 0 is the edge to tile (x-1, y), v = 0 the edge to (x, y-1).

import math
import os
from PIL import Image

from pixelart import Color, Sprite, hash2

HERE = os.path.dirname(os.path.abspath(__file__))

TW, TH = 64, 32
WATER: Color = (93, 143, 203)  # Yar's water
DEEP: Color = (84, 133, 195)
CREST: Color = (113, 156, 209)  # Yar's glint
FOAM: Color = (196, 222, 240)
SHALLOW: Color = (104, 158, 206)
WET_SAND: Color = (140, 112, 99)  # Yar's muddy bank
SAND: Color = (176, 146, 112)
SAND_LIGHT: Color = (204, 176, 132)
MUD: Color = (119, 80, 102)

WAVE_FRAMES = 4
"""Each frame of the water and the foam; the town shows them one after another."""


def diamond_mask() -> list[tuple[int, int]]:
    """The ground diamond exactly as Yar's grass covers it, so the tiles meet without seams."""
    yar = Image.open(os.path.join(HERE, "src", "yar-outside.png")).convert("RGBA")
    cell = yar.crop((0, 32, 64, 64)).load()
    return [(x, y) for y in range(TH) for x in range(TW) if cell[x, y][3] > 0]


def uv(x: int, y: int) -> tuple[float, float]:
    """Tile coordinates of pixel (x, y) of a tile sprite."""
    px, py = x + 0.5 - TW / 2, y + 0.5
    return py / TH + px / TW, py / TH - px / TW


# ---------- water ----------

def water(variant: int, frame: int, mask: list[tuple[int, int]]) -> Sprite:
    """
    A tile of water: a few darker patches, and short crests that rise, shine and
    sink again, each at its own moment, so the water moves without blinking.
    """
    s = Sprite(TW, TH)
    for x, y in mask:
        # Slow patches in diagonal bands, the way light falls on a river.
        n = math.sin((x + 2 * y) * 0.21 + variant * 2.1) + math.sin((x - 2 * y) * 0.13 + variant)
        s.set(x, y, DEEP if n < -1.55 and (x + y) % 2 == 0 else WATER)
    inside = set(mask)
    for i in range(9):
        cx = 6 + int(hash2(variant, i, 1) * (TW - 12))
        cy = 3 + int(hash2(variant, i, 2) * (TH - 6))
        life = (frame + int(hash2(variant, i, 3) * WAVE_FRAMES)) % WAVE_FRAMES
        # 0: flat, 1: a short ripple, 2: a crest with a shine, 3: it spreads and fades.
        drift = life  # the crest moves a little with the current
        length = (0, 3, 6, 5)[life]
        for k in range(length):
            px = cx + drift + k - length // 2
            if (px, cy) not in inside or (px, cy + 1) not in inside:
                continue
            if life == 3 and k % 2:
                continue
            # A light crest with its shadow under it.
            s.set(px, cy, CREST if life != 2 or k in (0, length - 1) else FOAM)
            if life >= 2 and 0 < k < length - 1:
                s.set(px, cy + 1, DEEP)
    return s


# ---------- banks ----------

def edge_dist(u: float, v: float, side: str) -> tuple[float, float]:
    """How far into the tile from that side (0 on it), and where along it (0..1)."""
    return {
        "NW": (u, v),  # tile (x-1, y)
        "NE": (v, 1 - u),  # tile (x, y-1)
        "SE": (1 - u, 1 - v),  # tile (x+1, y)
        "SW": (1 - v, u),  # tile (x, y+1)
        # A corner: land only on the diagonal tile, touching this one at a point.
        "N": (math.hypot(u, v) * 0.8, 0.5),
        "E": (math.hypot(1 - u, v) * 0.8, 0.5),
        "S": (math.hypot(1 - u, 1 - v) * 0.8, 0.5),
        "W": (math.hypot(u, 1 - v) * 0.8, 0.5),
    }[side]


def wobble(a: float, salt: int) -> float:
    """A wavy bank line that is the same at both ends, so neighbors join up."""
    return 0.035 * math.sin(a * math.pi * 4 + salt) * math.sin(a * math.pi) + 0.02 * math.sin(a * math.pi * 2) ** 2


def bank(side: str, frame: int, mask: list[tuple[int, int]]) -> Sprite:
    """The bank on one side of a water tile (drawn over the water): sand, wet mud, foam."""
    s = Sprite(TW, TH)
    salt = "NW NE SE SW N E S W".split().index(side)
    for x, y in mask:
        u, v = uv(x, y)
        d, a = edge_dist(u, v, side)
        d -= wobble(a, salt)
        g = hash2(x, y, 9 + salt)
        if d < 0.07:
            s.set(x, y, SAND_LIGHT if g < 0.25 else SAND)
        elif d < 0.13:
            s.set(x, y, WET_SAND if g > 0.12 else MUD)
        elif d < 0.17:
            # Foam where the water laps on the bank, broken up differently each frame.
            if hash2(int(a * 24), frame, 4 + salt) > 0.3:
                s.set(x, y, FOAM)
            else:
                s.set(x, y, SHALLOW)
        elif d < 0.27 + 0.03 * math.sin(frame * math.pi / 2 + a * 9):
            if (x + y) % 2 == 0 or d < 0.21:
                s.set(x, y, SHALLOW)
    return s


SIDES = ["NW", "NE", "SE", "SW", "N", "E", "S", "W"]


# ---------- flowers ----------

PETALS: list[tuple[Color, Color]] = [  # (petal, its shadow side)
    ((250, 250, 240), (206, 208, 196)),  # daisies
    ((246, 214, 76), (204, 160, 40)),  # buttercups
    ((226, 72, 64), (168, 40, 40)),  # poppies
    ((156, 128, 230), (108, 88, 180)),  # violets
    ((244, 148, 196), (196, 96, 150)),  # pink clover
    ((120, 170, 238), (76, 120, 196)),  # forget-me-nots
]
HEART: Color = (250, 200, 60)
STEM: Color = (64, 116, 40)
LEAF: Color = (88, 140, 44)


def flower(s: Sprite, x: int, y: int, petal: tuple[Color, Color], tall: int) -> None:
    """One flower, its foot at (x, y): a stem, a leaf, and a head of a few pixels."""
    for k in range(tall):
        s.set(x, y - k, STEM)
    s.set(x + (1 if tall % 2 else -1), y - 1, LEAF)
    hy = y - tall
    light, dark = petal
    s.set(x - 1, hy, light)
    s.set(x + 1, hy, dark)
    s.set(x, hy - 1, light)
    s.set(x, hy + 1, dark)
    s.set(x, hy, HEART if petal != PETALS[1] else (236, 140, 30))


def flowers(kind: int) -> Sprite:
    """A little patch of one kind of flower, to scatter on the grass."""
    s = Sprite(20, 14)
    petal = PETALS[kind]
    n = 5 + kind % 3
    for i in range(n):
        x = 3 + int(hash2(kind, i, 21) * 14)
        y = 6 + int(hash2(kind, i, 22) * 7)
        flower(s, x, y, petal, 2 + int(hash2(kind, i, 23) * 2))
    return s


def all_sprites() -> list[tuple[str, Image.Image, float, float, float]]:
    mask = diamond_mask()
    out: list[tuple[str, Sprite, float, float]] = []
    for v in range(3):
        for f in range(WAVE_FRAMES):
            out.append((f"wave{v}_{f}", water(v, f, mask), TW / 2, TH / 2))
    for side in SIDES:
        for f in range(WAVE_FRAMES):
            out.append((f"bank{side}_{f}", bank(side, f, mask), TW / 2, TH / 2))
    for k in range(len(PETALS)):
        # The middle of the patch goes on the spot picked on the grass.
        out.append((f"bloom{k}", flowers(k), 10, 10))
    result = []
    for name, s, ax, ay in out:
        bb = s.im.getbbox() or (0, 0, 1, 1)
        result.append((name, s.im.crop(bb), ax - bb[0], ay - bb[1], 1.0))
    return result
