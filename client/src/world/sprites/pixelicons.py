# Our own 16x16 pixel icons for the resources, the ones seen most in the HUD and the
# menus. Every other emoji on the page is baked into pixel art in the browser
# (client/src/pixelIcons.ts); these are drawn by hand so the main ones look the same
# on every computer. Each icon is a map of letters: "." is see-through, "k" the dark
# rim, the other letters come from its palette (light from the top left).
# build.py writes them to icons.png (one row, 16 px each) and icons.json (emoji -> index).

from PIL import Image

Color = tuple[int, int, int]

RIM: Color = (36, 24, 20)

ICONS: list[tuple[str, dict[str, Color], list[str]]] = [
    # voedsel: a leg of meat on the bone
    ("🍖", {"w": (246, 238, 220), "g": (198, 184, 160), "R": (232, 132, 84), "r": (190, 82, 50), "d": (126, 46, 30)}, [
        "................",
        "...........kk...",
        "..........kwwk..",
        ".........kwwwgk.",
        "........kwwgkk..",
        ".......kwwgk....",
        "....kkkwgk......",
        "...kRRRkkk......",
        "..kRRRRRrrk.....",
        ".kRRRRRrrrk.....",
        ".kRRRrrrrdk.....",
        ".kRrrrrrrdk.....",
        ".krrrrrrddk.....",
        "..kdrrrddk......",
        "...kkkkkk.......",
        "................",
    ]),
    # hout: a log with its rings
    ("🪵", {"L": (206, 162, 104), "l": (176, 128, 76), "B": (138, 90, 52), "b": (104, 64, 36), "d": (72, 44, 26)}, [
        "................",
        "................",
        "................",
        "......kkkkkkkk..",
        "....kkBBBBBBBBk.",
        "...kLLkBBbBBBBbk",
        "..kLllLkBBBBbBbk",
        "..kLlLlkBbBBBBdk",
        "..kLllLkBBBbBbdk",
        "..kLLLLkbBBBbbdk",
        "...kLLkbbbbbbddk",
        "....kkkkkkkkkkk.",
        "................",
        "................",
        "................",
        "................",
    ]),
    # steen: a grey rock
    ("🪨", {"W": (214, 214, 216), "L": (176, 176, 182), "M": (138, 138, 146), "D": (98, 98, 108)}, [
        "................",
        "................",
        "................",
        "......kkkk......",
        "....kkWWLLkk....",
        "...kWWLLLLMMk...",
        "..kWWLLLLMMMk...",
        "..kWLLLLMMMMDk..",
        ".kLLLLLMMMMMDk..",
        ".kLLLMMMMMMDDDk.",
        ".kLMMMMMMMDDDDk.",
        "..kMMMMDDDDDDk..",
        "...kkkkkkkkkk...",
        "................",
        "................",
        "................",
    ]),
    # brons: an ingot
    ("🥉", {"W": (246, 200, 140), "L": (216, 150, 84), "M": (176, 110, 56), "D": (122, 70, 34)}, [
        "................",
        "................",
        "................",
        "................",
        ".....kkkkkkkk...",
        "....kWWWWWWWLk..",
        "...kWWLLLLLLLk..",
        "..kWLLLLLLLLMk..",
        "..kkkkkkkkkkMDk.",
        "..kLLLLLLLLkMDk.",
        "..kLMMMMMMMkDk..",
        "..kMMMMMMMDkk...",
        "..kkkkkkkkkk....",
        "................",
        "................",
        "................",
    ]),
    # ijzer: an ingot
    ("⛓️", {"W": (226, 232, 240), "L": (170, 180, 194), "M": (124, 134, 150), "D": (82, 90, 106)}, [
        "................",
        "................",
        "................",
        "................",
        ".....kkkkkkkk...",
        "....kWWWWWWWLk..",
        "...kWWLLLLLLLk..",
        "..kWLLLLLLLLMk..",
        "..kkkkkkkkkkMDk.",
        "..kLLLLLLLLkMDk.",
        "..kLMMMMMMMkDk..",
        "..kMMMMMMMDkk...",
        "..kkkkkkkkkk....",
        "................",
        "................",
        "................",
    ]),
    # kolen: black lumps with a glint
    ("⚫", {"W": (120, 120, 132), "L": (72, 72, 82), "M": (46, 46, 54), "D": (26, 26, 32)}, [
        "................",
        "................",
        "................",
        "................",
        "......kkkk......",
        ".....kWLLMk.....",
        "....kWLLMMDk....",
        "....kLLMMMDk....",
        "..kkkLMMMDkkkk..",
        ".kWLLkMMDkWLMDk.",
        ".kLLMMkkkLLMMDk.",
        ".kLMMMDkLMMMDDk.",
        "..kMDDDkMMDDDk..",
        "...kkkk.kkkkk...",
        "................",
        "................",
    ]),
    # wapens: a sword
    ("🗡️", {"W": (240, 244, 250), "L": (184, 194, 208), "M": (120, 130, 148), "G": (222, 178, 64), "g": (160, 116, 36), "b": (110, 70, 40)}, [
        "................",
        "............kkk.",
        "...........kWWk.",
        "..........kWLMk.",
        ".........kWLMk..",
        "........kWLMk...",
        ".......kWLMk....",
        "..kk..kWLMk.....",
        "..kGkkWLMk......",
        "...kGkLMk.......",
        "....kGgk........",
        "...kbkkGk.......",
        "..kbbk.kGk......",
        ".kbbk...kk......",
        ".kkk............",
        "................",
    ]),
    # harnassen: a shield
    ("🛡️", {"W": (150, 190, 236), "L": (78, 132, 204), "M": (52, 94, 160), "D": (34, 62, 112), "G": (232, 196, 90), "g": (176, 136, 48)}, [
        "................",
        "..kkkkkkkkkkkk..",
        "..kGGGGGGGGGgk..",
        "..kGWWLLkLLMgk..",
        "..kGWLLLkLLMgk..",
        "..kGLLLLkLMMgk..",
        "..kGkkkkkkkkgk..",
        "..kGLLLLkMMMgk..",
        "..kgLLLMkMMDgk..",
        "...kgLMMkMDgk...",
        "...kgMMMkDDgk...",
        "....kgMMkDgk....",
        ".....kggggk.....",
        "......kkkk......",
        "................",
        "................",
    ]),
    # goud: a coin
    ("🪙", {"W": (255, 244, 170), "L": (246, 206, 72), "M": (214, 160, 40), "D": (156, 106, 22)}, [
        "................",
        "................",
        ".....kkkkkk.....",
        "....kWWLLLLk....",
        "...kWLLLLLLMk...",
        "..kWLLMMMMLLMk..",
        "..kWLMLLLLMLMk..",
        "..kLLMLWLLMLMk..",
        "..kLLMLLLLMLDk..",
        "..kLLMLLLLMMDk..",
        "..kLLLMMMMMMDk..",
        "...kLLLLLMMDk...",
        "....kMMMDDDk....",
        ".....kkkkkk.....",
        "................",
        "................",
    ]),
    # wol: a ball of yarn
    ("🧶", {"W": (250, 236, 240), "L": (232, 190, 204), "M": (200, 140, 164), "D": (150, 92, 118)}, [
        "................",
        "................",
        ".....kkkkk......",
        "...kkWWLLLkk....",
        "..kWWLMLLLLMk...",
        "..kWLMLLMLLMk...",
        ".kWLMLLMLLMLMk..",
        ".kLLMLMLLMLLMk..",
        ".kLMLLMLLMLMDk..",
        ".kLMLMLLMLLMDk..",
        "..kMLMLMLLMDk...",
        "..kMMMLMMMDDk...",
        "...kkDDDDDkkMk..",
        ".....kkkkk..kMk.",
        ".............kk.",
        "................",
    ]),
    # kennis: a scroll
    ("📜", {"W": (252, 240, 206), "L": (232, 210, 160), "M": (196, 166, 112), "D": (150, 118, 72), "i": (110, 84, 60)}, [
        "................",
        "..kkkkkkkkkkk...",
        ".kWWLLLLLLLLMk..",
        ".kLMkkkkkkkkMk..",
        "..kkWWWWWWWWk...",
        "...kWiiiiiWLk...",
        "...kWLLLLLLLk...",
        "...kWiiiiLLLk...",
        "...kWLLLLLLLk...",
        "...kWiiiiiiLk...",
        "...kLLLLLLLMk...",
        "..kkkkkkkkkkkk..",
        ".kWWLLLLLLLLMDk.",
        ".kLMMMMMMMMMMDk.",
        "..kkkkkkkkkkkk..",
        "................",
    ]),
    # olie: a barrel
    ("🛢️", {"W": (120, 132, 150), "L": (70, 84, 104), "M": (48, 58, 76), "D": (30, 36, 50), "b": (196, 120, 60)}, [
        "................",
        "....kkkkkkkk....",
        "...kWWLLLLLMk...",
        "...kkkkkkkkkk...",
        "...kWLLLLLMDk...",
        "...kWLLLLLMDk...",
        "...kbbbbbbbbk...",
        "...kWLLLLLMDk...",
        "...kWLLLLLMDk...",
        "...kWLLLLLMDk...",
        "...kbbbbbbbbk...",
        "...kWLLLLLMDk...",
        "...kLLLLLMMDk...",
        "....kkkkkkkk....",
        "................",
        "................",
    ]),
    # data: a floppy disk
    ("💾", {"B": (70, 100, 180), "b": (44, 66, 132), "S": (206, 212, 222), "s": (150, 158, 172), "W": (244, 244, 240), "L": (200, 200, 196)}, [
        "................",
        "..kkkkkkkkkkk...",
        "..kBkSSSSSkBbk..",
        "..kBkSSksSkBBk..",
        "..kBkSSksSkBBk..",
        "..kBkkkkkkkBBk..",
        "..kBBBBBBBBBBk..",
        "..kBkkkkkkkkBk..",
        "..kBkWWWWWWkBk..",
        "..kBkWLLLLWkBk..",
        "..kBkWWWWWWkBk..",
        "..kBkWLLLLWkbk..",
        "..kbkWWWWWWkbk..",
        "..kkkkkkkkkkkk..",
        "................",
        "................",
    ]),
    # titanium: a crystal
    ("🔷", {"W": (226, 244, 255), "L": (140, 200, 240), "M": (80, 146, 206), "D": (44, 92, 156)}, [
        "................",
        ".......kk.......",
        "......kWLk......",
        ".....kWWLMk.....",
        "....kWWLLMMk....",
        "...kWWLLLMMMk...",
        "..kWWLLLLMMMMk..",
        ".kWLLLLLLMMMMDk.",
        ".kLLLLLLMMMMDDk.",
        "..kLLLLLMMMDDk..",
        "...kLLLLMMDDk...",
        "....kLLLMDDk....",
        ".....kLLMDk.....",
        "......kLDk......",
        ".......kk.......",
        "................",
    ]),
    # antimaterie: a glowing core with an orbit
    ("⚛️", {"W": (255, 236, 255), "P": (232, 120, 255), "p": (164, 64, 214), "o": (120, 230, 255), "O": (60, 150, 210)}, [
        "................",
        "................",
        ".......kkk......",
        "......kooOk.....",
        ".....koOkkOk....",
        "..kkkoOkPPkOkk..",
        ".koooOkPWWPkoOk.",
        ".kOkkkPWWWPkkOk.",
        ".kOk.kpPWPpk.Ok.",
        ".kOkk.kpPpk.kOk.",
        "..kOOkkkkkkkOk..",
        "...kkOOOOOOOkk..",
        ".....kkkkkkk....",
        "................",
        "................",
        "................",
    ]),
]


def icon_image(palette: dict[str, Color], rows: list[str]) -> Image.Image:
    assert len(rows) == 16 and all(len(r) == 16 for r in rows), rows
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = im.load()
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == ".":
                continue
            px[x, y] = (*(RIM if ch == "k" else palette[ch]), 255)
    return im


def all_icons() -> tuple[Image.Image, dict[str, int]]:
    sheet = Image.new("RGBA", (16 * len(ICONS), 16), (0, 0, 0, 0))
    index: dict[str, int] = {}
    for i, (emoji, palette, rows) in enumerate(ICONS):
        sheet.alpha_composite(icon_image(palette, rows), (16 * i, 0))
        index[emoji] = i
    return sheet, index
