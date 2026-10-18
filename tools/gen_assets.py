"""
生成小程序图标资源（tabBar 3 组 + 环境音 5 个）。
用法：python tools/gen_assets.py
依赖：Pillow
"""

import math
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "miniprogram", "assets")

NORMAL = (100, 116, 139, 255)   # #64748B
ACTIVE = (129, 140, 248, 255)   # #818CF8
SOFT = (165, 180, 252, 255)     # #A5B4FC


def canvas(target_size, scale=4):
    side = target_size * scale
    return Image.new("RGBA", (side, side), (0, 0, 0, 0)), side


def save(image, side, name, target_size):
    image = image.resize((target_size, target_size), Image.LANCZOS)
    image.save(os.path.join(OUT, name))
    print("wrote", name)


def tab_home(color):
    img, side = canvas(81)
    d = ImageDraw.Draw(img)
    c = side // 2
    w = 12
    d.ellipse((54, 54, 270, 270), outline=color, width=w)
    d.line((c, c, c, 100), fill=color, width=w)
    d.line((c, c, 212, 190), fill=color, width=w)
    return img, side


def tab_stats(color):
    img, side = canvas(81)
    d = ImageDraw.Draw(img)
    widths = 42
    gap = 16
    start = 54
    heights = (54, 90, 126, 162)
    for i, h in enumerate(heights):
        x = start + i * (widths + gap)
        d.rounded_rectangle((x, 270 - h, x + widths, 270), radius=10, fill=color)
    return img, side


def tab_audio(color):
    img, side = canvas(81)
    d = ImageDraw.Draw(img)
    w = 24
    gap = 24
    heights = (60, 110, 150, 110, 60)
    x = 54
    for h in heights:
        top = 162 - h // 2
        d.rounded_rectangle((x, top, x + w, top + h), radius=12, fill=color)
        x += w + gap
    return img, side


def tab_sleep(color):
    img, side = canvas(81)
    mask = Image.new("L", (side, side), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse((72, 54, 252, 234), fill=255)
    md.ellipse((126, 30, 306, 210), fill=0)
    solid = Image.new("RGBA", (side, side), color)
    img.paste(solid, (0, 0), mask)
    return img, side


def drop(d, cx, cy, r):
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=SOFT)
    d.polygon(
        [(cx - r * 0.82, cy - r * 0.2), (cx, cy - r * 2.6), (cx + r * 0.82, cy - r * 0.2)],
        fill=SOFT,
    )


def icon_rain():
    img, side = canvas(96)
    d = ImageDraw.Draw(img)
    drop(d, 104, 232, 34)
    drop(d, 192, 186, 42)
    drop(d, 282, 238, 30)
    return img, side


def icon_wave():
    img, side = canvas(96)
    d = ImageDraw.Draw(img)
    for offset, width in ((0, 14), (70, 10)):
        points = []
        for x in range(54, 331, 3):
            y = 180 + offset + 42 * math.sin((x - 54) / 62.0)
            points.append((x, y))
        d.line(points, fill=SOFT, width=width, joint="curve")
    return img, side


def icon_fire():
    img, side = canvas(96)
    d = ImageDraw.Draw(img)
    # 火焰：三角 + 圆，拼成一个水滴形火苗
    d.polygon([(150, 182), (192, 72), (234, 182)], fill=SOFT)
    d.ellipse((154, 138, 230, 214), fill=SOFT)
    # 交叉木柴
    d.line((116, 268, 268, 306), fill=SOFT, width=15)
    d.line((268, 268, 116, 306), fill=SOFT, width=15)
    return img, side


def icon_noise():
    img, side = canvas(96)
    d = ImageDraw.Draw(img)
    spots = [
        (110, 110, 8), (192, 110, 13), (274, 110, 7),
        (110, 192, 12), (192, 192, 6), (274, 192, 11),
        (110, 274, 7), (192, 274, 10), (274, 274, 13),
    ]
    for x, y, r in spots:
        d.ellipse((x - r, y - r, x + r, y + r), fill=SOFT)
    return img, side


def icon_night():
    img, side = canvas(96)
    mask = Image.new("L", (side, side), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse((82, 84, 292, 294), fill=255)
    md.ellipse((150, 52, 360, 262), fill=0)
    solid = Image.new("RGBA", (side, side), SOFT)
    img.paste(solid, (0, 0), mask)
    d = ImageDraw.Draw(img)
    d.ellipse((284, 92, 306, 114), fill=SOFT)
    d.ellipse((310, 140, 326, 156), fill=SOFT)
    return img, side


def build_preview(names, path):
    cell = 128
    pad = 16
    sheet = Image.new("RGBA", (cell * len(names) + pad * (len(names) + 1), cell + pad * 2), (15, 23, 42, 255))
    for i, name in enumerate(names):
        icon = Image.open(os.path.join(OUT, name)).convert("RGBA").resize((cell, cell), Image.LANCZOS)
        sheet.alpha_composite(icon, (pad + i * (cell + pad), pad))
    sheet.save(path)


def main():
    os.makedirs(OUT, exist_ok=True)

    for color, suffix in ((NORMAL, ""), (ACTIVE, "-active")):
        img, side = tab_home(color)
        save(img, side, "tab-home%s.png" % suffix, 81)
        img, side = tab_stats(color)
        save(img, side, "tab-stats%s.png" % suffix, 81)
        img, side = tab_audio(color)
        save(img, side, "tab-audio%s.png" % suffix, 81)
        img, side = tab_sleep(color)
        save(img, side, "tab-sleep%s.png" % suffix, 81)

    for name, builder in (
        ("icon-rain", icon_rain),
        ("icon-wave", icon_wave),
        ("icon-fire", icon_fire),
        ("icon-noise", icon_noise),
        ("icon-night", icon_night),
    ):
        img, side = builder()
        save(img, side, name + ".png", 96)

    build_preview(
        [
            "tab-home.png", "tab-home-active.png",
            "tab-stats.png", "tab-stats-active.png",
            "tab-audio.png", "tab-audio-active.png",
            "tab-sleep.png", "tab-sleep-active.png",
        ],
        os.path.join(ROOT, "tools", "_preview-tabs.png"),
    )
    build_preview(
        ["icon-rain.png", "icon-wave.png", "icon-fire.png", "icon-noise.png", "icon-night.png"],
        os.path.join(ROOT, "tools", "_preview-audio.png"),
    )


if __name__ == "__main__":
    main()
