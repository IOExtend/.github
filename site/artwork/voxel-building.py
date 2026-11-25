"""Draw the IOExtend landing illustration in a compact, pixel-aligned projection."""

from pathlib import Path

from PIL import Image, ImageDraw, PngImagePlugin


image = Image.new("RGBA", (272, 192))
draw = ImageDraw.Draw(image)
origin = (137, 107)


def point(x, y, z=0):
    return origin[0] + (x - y) * 8, origin[1] + (x + y) * 4 - z * 8


def polygon(vertices, color):
    draw.polygon([point(*vertex) for vertex in vertices], fill=color)


def line(vertices, color):
    draw.line([point(*vertex) for vertex in vertices], fill=color)


def block(x, y, z, width, depth, height, colors):
    right, front, top = x + width, y + depth, z + height
    polygon([(right, y, z), (right, front, z), (right, front, top), (right, y, top)], colors[2])
    polygon([(x, front, z), (right, front, z), (right, front, top), (x, front, top)], colors[1])
    polygon([(x, y, top), (right, y, top), (right, front, top), (x, front, top)], colors[0])


# Projected ground grid and registration marks extend the drawing beyond the model.
for offset in range(-7, 8):
    tone = "#405068" if offset == 0 else "#2d3647"
    line([(offset, -8, -2), (offset, 8, -2)], tone)
    line([(-8, offset, -2), (8, offset, -2)], tone)

for x, y in [(-7, 7), (7, -7), (-7, -3), (4, 7)]:
    px, py = point(x, y, -2)
    draw.line([(px - 3, py), (px + 3, py)], fill="#70839d")
    draw.line([(px, py - 3), (px, py + 3)], fill="#70839d")

palette = {
    "ground": ("#39465e", "#28354b", "#1d293c"),
    "foundation": ("#7289ad", "#42597b", "#293b5e"),
    "cyan": ("#a5f3fc", "#27b8d0", "#146384"),
    "blue": ("#93c5fd", "#4386e6", "#234b9f"),
    "purple": ("#d8b4fe", "#9860e1", "#5633a1"),
    "amber": ("#ffdb76", "#e89c3f", "#9b5d29"),
    "glass": ("#547fa9", "#315578", "#20395b"),
}

block(-6, -6, -2, 12, 12, 1, palette["ground"])
block(-5, -5, -1, 10, 10, 1, palette["foundation"])

# Rear wing, central column grid, and the two lower volumes.
block(-4, -4, 0, 4, 3, 4, palette["blue"])
for floor in (1, 2, 3):
    line([(-4, -1, floor), (0, -1, floor)], "#6da8ef")
    line([(0, -4, floor), (0, -1, floor)], "#2a5bae")

block(0, -4, 0, 4, 4, 6, palette["glass"])
for floor in (0, 2, 4, 6):
    block(0, -4, floor, 4, 4, 0.34, palette["cyan"])
for x in (0, 1.2, 2.4, 3.6):
    block(x, -0.4, 0.34, 0.35, 0.4, 6, palette["cyan"])
for y in (-3.6, -2.4, -1.2):
    block(3.65, y, 0.34, 0.35, 0.4, 6, palette["blue"])
block(0.5, -3.5, 6.34, 3, 3, 1, palette["blue"])
block(1, -3, 7.34, 2, 2, 1, palette["cyan"])

block(-4, 0, 0, 4, 4, 2, palette["amber"])
block(-4, 0, 2, 4, 2, 1, palette["amber"])
for x in (-3.5, -2.5, -1.5):
    line([(x, 4, 0.5), (x, 4, 1.5)], "#a76832")

block(0, 0, 0, 4, 4, 2, palette["purple"])
block(1, 1, 2, 3, 3, 1, palette["purple"])
for y in (0.5, 1.5, 2.5, 3.5):
    line([(4, y, 0.5), (4, y, 1.5)], "#7547b8")

# Detached register blocks carry the palette into the plan without obscuring its outline.
block(-7, 0, -1, 1, 1, 1, palette["amber"])
block(0, -7, -1, 1, 1, 1, palette["cyan"])
block(6, 4, -1, 1, 1, 1, palette["purple"])

metadata = PngImagePlugin.PngInfo()
metadata.add_text("Source", "Original parallel-projected geometry drawn by artwork/voxel-building.py for IOExtend.Web")
output = Path(__file__).resolve().parents[1] / "wwwroot" / "brand" / "voxel-building.png"
image.save(output, pnginfo=metadata, optimize=True)
