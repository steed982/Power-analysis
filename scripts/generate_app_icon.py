#!/usr/bin/env python3
from PIL import Image, ImageDraw
import sys


def rounded_rect(draw: ImageDraw.ImageDraw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def build_icon(path: str, size: int = 1024):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background
    rounded_rect(draw, (40, 40, size - 40, size - 40), radius=220, fill=(30, 64, 175, 255))
    rounded_rect(draw, (70, 70, size - 70, size - 70), radius=200, fill=(41, 96, 255, 255))

    # Top bar
    rounded_rect(draw, (190, 220, size - 190, 330), radius=36, fill=(255, 255, 255, 220))

    # Bars (power chart style)
    bar_base = size - 210
    bars = [
        (220, 560, 330, bar_base),
        (390, 470, 500, bar_base),
        (560, 390, 670, bar_base),
        (730, 300, 840, bar_base),
    ]
    bar_colors = [
        (146, 205, 255, 235),
        (169, 228, 255, 235),
        (201, 242, 255, 240),
        (255, 211, 113, 240),
    ]
    for box, color in zip(bars, bar_colors):
        rounded_rect(draw, box, radius=26, fill=color)

    # Mini battery glyph
    rounded_rect(draw, (430, 248, 610, 304), radius=16, fill=(36, 74, 196, 255))
    rounded_rect(draw, (612, 264, 634, 288), radius=7, fill=(36, 74, 196, 255))
    rounded_rect(draw, (448, 264, 590, 288), radius=8, fill=(255, 255, 255, 230))

    img.save(path, "PNG")


def main():
    if len(sys.argv) != 2:
        print("usage: generate_app_icon.py <output-png>")
        sys.exit(1)
    build_icon(sys.argv[1])


if __name__ == "__main__":
    main()
