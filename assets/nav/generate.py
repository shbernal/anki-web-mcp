#!/usr/bin/env python3
"""
Builds the README's header nav buttons (assets/nav/) and the supported-browsers
strip (assets/browsers/), each in a light and a dark variant.

Text is outlined here with fontTools from the installed Aptos fonts, because an
SVG shown through <img> cannot load a font. Run from anywhere:

    python3 assets/nav/generate.py [--preview DIR]

--preview also writes PNG previews of every SVG on GitHub's #ffffff and
#0d1117 page backgrounds into DIR (needs rsvg-convert).

Glyph sources, embedded below so the script has no network or npm step:
- Browser logos: Simple Icons 16.34.0 (CC0 1.0), slugs googlechrome, brave,
  vivaldi, opera, arc, heliumbrowser. Simple Icons carries no Chromium glyph and
  removed Microsoft Edge at Microsoft's request, so both use a generic globe.
- Button icons and the globe: Lucide 1.52.0 (ISC License,
  Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part
  of Feather (MIT). All other copyright (c) for Lucide are held by Lucide
  Contributors 2022.)
"""

import argparse
import subprocess
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ASSETS = Path(__file__).resolve().parent.parent
FONT_DIR = Path("/usr/share/fonts/ttf-aptos")

# Tokyo Night (dark) and Tokyo Night Day (light).
THEMES = {
    "light": {
        "bg": "#e1e2e7",
        "surface": "#d0d5e3",
        "border": "#a8aecb",
        "fg": "#3760bf",
        "muted": "#8990b3",
        "accent": "#2e7de9",
    },
    "dark": {
        "bg": "#1a1b26",
        "surface": "#24283b",
        "border": "#414868",
        "fg": "#c0caf5",
        "muted": "#565f89",
        "accent": "#7aa2f7",
    },
}

# --- text outlining ---------------------------------------------------------

_fonts: dict[str, TTFont] = {}


def font(name: str) -> TTFont:
    if name not in _fonts:
        _fonts[name] = TTFont(FONT_DIR / name)
    return _fonts[name]


def text_width(text: str, face: str, size: float) -> float:
    f = font(face)
    cmap, hmtx = f.getBestCmap(), f["hmtx"]
    return sum(hmtx[cmap[ord(c)]][0] for c in text) * size / f["head"].unitsPerEm


def cap_height(face: str, size: float) -> float:
    f = font(face)
    return f["OS/2"].sCapHeight * size / f["head"].unitsPerEm


def outline(text: str, face: str, size: float, x: float, baseline: float) -> str:
    """One path `d` for `text` with its left edge at x, on `baseline`."""
    f = font(face)
    cmap, hmtx, glyphs = f.getBestCmap(), f["hmtx"], f.getGlyphSet()
    scale = size / f["head"].unitsPerEm
    pen = SVGPathPen(glyphs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    cursor = x
    for c in text:
        name = cmap[ord(c)]
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, cursor, baseline)))
        cursor += hmtx[name][0] * scale
    return pen.getCommands()


def centered(text: str, face: str, size: float, cx: float, baseline: float) -> str:
    return outline(text, face, size, cx - text_width(text, face, size) / 2, baseline)


# --- glyphs (24 x 24 viewBox) -----------------------------------------------

SIMPLE_ICONS = {
    "googlechrome": "M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-5.344 9.257c.206.01.413.016.621.016 6.627 0 12-5.373 12-12 0-1.54-.29-3.011-.818-4.364zM12 16.364a4.364 4.364 0 1 1 0-8.728 4.364 4.364 0 0 1 0 8.728Z",
    "brave": "M15.68 0l2.096 2.38s1.84-.512 2.709.358c.868.87 1.584 1.638 1.584 1.638l-.562 1.381.715 2.047s-2.104 7.98-2.35 8.955c-.486 1.919-.818 2.66-2.198 3.633-1.38.972-3.884 2.66-4.293 2.916-.409.256-.92.692-1.38.692-.46 0-.97-.436-1.38-.692a185.796 185.796 0 01-4.293-2.916c-1.38-.973-1.712-1.714-2.197-3.633-.247-.975-2.351-8.955-2.351-8.955l.715-2.047-.562-1.381s.716-.768 1.585-1.638c.868-.87 2.708-.358 2.708-.358L8.321 0h7.36zm-3.679 14.936c-.14 0-1.038.317-1.758.69-.72.373-1.242.637-1.409.742-.167.104-.065.301.087.409.152.107 2.194 1.69 2.393 1.866.198.175.489.464.687.464.198 0 .49-.29.688-.464.198-.175 2.24-1.759 2.392-1.866.152-.108.254-.305.087-.41-.167-.104-.689-.368-1.41-.741-.72-.373-1.617-.69-1.757-.69zm0-11.278s-.409.001-1.022.206-1.278.46-1.584.46c-.307 0-2.581-.434-2.581-.434S4.119 7.152 4.119 7.849c0 .697.339.881.68 1.243l2.02 2.149c.192.203.59.511.356 1.066-.235.555-.58 1.26-.196 1.977.384.716 1.042 1.194 1.464 1.115.421-.08 1.412-.598 1.776-.834.364-.237 1.518-1.19 1.518-1.554 0-.365-1.193-1.02-1.413-1.168-.22-.15-1.226-.725-1.247-.95-.02-.227-.012-.293.284-.851.297-.559.831-1.304.742-1.8-.089-.495-.95-.753-1.565-.986-.615-.232-1.799-.671-1.947-.74-.148-.068-.11-.133.339-.175.448-.043 1.719-.212 2.292-.052.573.16 1.552.403 1.632.532.079.13.149.134.067.579-.081.445-.5 2.581-.541 2.96-.04.38-.12.63.288.724.409.094 1.097.256 1.333.256s.924-.162 1.333-.256c.408-.093.329-.344.288-.723-.04-.38-.46-2.516-.541-2.961-.082-.445-.012-.45.067-.579.08-.129 1.059-.372 1.632-.532.573-.16 1.845.009 2.292.052.449.042.487.107.339.175-.148.069-1.332.508-1.947.74-.615.233-1.476.49-1.565.986-.09.496.445 1.241.742 1.8.297.558.304.624.284.85-.02.226-1.026.802-1.247.95-.22.15-1.413.804-1.413 1.169 0 .364 1.154 1.317 1.518 1.554.364.236 1.355.755 1.776.834.422.079 1.08-.4 1.464-1.115.384-.716.039-1.422-.195-1.977-.235-.555.163-.863.355-1.066l2.02-2.149c.341-.362.68-.546.68-1.243 0-.697-2.695-3.96-2.695-3.96s-2.274.436-2.58.436c-.307 0-.972-.256-1.585-.461-.613-.205-1.022-.206-1.022-.206z",
    "vivaldi": "M12 0C6.75 0 3.817 0 1.912 1.904.007 3.81 0 6.75 0 12s0 8.175 1.912 10.08C3.825 23.985 6.75 24 12 24c5.25 0 8.183 0 10.088-1.904C23.993 20.19 24 17.25 24 12s0-8.175-1.912-10.08C20.175.015 17.25 0 12 0zm-.168 3a9 9 0 016.49 2.648 9 9 0 010 12.704A9 9 0 1111.832 3zM7.568 7.496a1.433 1.433 0 00-.142.004A1.5 1.5 0 006.21 9.75l1.701 3c.93 1.582 1.839 3.202 2.791 4.822a1.417 1.417 0 001.41.75 1.5 1.5 0 001.223-.81l4.447-7.762A1.56 1.56 0 0018 8.768a1.5 1.5 0 10-2.828.914 2.513 2.513 0 01.256 1.119v.246a2.393 2.393 0 01-2.52 2.13 2.348 2.348 0 01-1.965-1.214c-.307-.51-.6-1.035-.9-1.553-.42-.72-.826-1.41-1.246-2.16a1.433 1.433 0 00-1.229-.754Z",
    "opera": "M8.051 5.238c-1.328 1.566-2.186 3.883-2.246 6.48v.564c.061 2.598.918 4.912 2.246 6.479 1.721 2.236 4.279 3.654 7.139 3.654 1.756 0 3.4-.537 4.807-1.471C17.879 22.846 15.074 24 12 24c-.192 0-.383-.004-.57-.014C5.064 23.689 0 18.436 0 12 0 5.371 5.373 0 12 0h.045c3.055.012 5.84 1.166 7.953 3.055-1.408-.93-3.051-1.471-4.81-1.471-2.858 0-5.417 1.42-7.14 3.654h.003zM24 12c0 3.556-1.545 6.748-4.002 8.945-3.078 1.5-5.946.451-6.896-.205 3.023-.664 5.307-4.32 5.307-8.74 0-4.422-2.283-8.075-5.307-8.74.949-.654 3.818-1.703 6.896-.205C22.455 5.25 24 8.445 24 12z",
    "arc": "M23.9371 8.5089c.1471-.7147.0367-1.4661-.3364-2.0967-.4203-.7094-1.1035-1.1876-1.9075-1.3506a2.9178 2.9178 0 0 0-.5623-.0578h-.0105c-1.3768 0-2.5329.988-2.8061 2.3385-.1629.7935-.4782 1.5607-.9196 2.2701a.263.263 0 0 1-.2363.1205.2627.2627 0 0 1-.2209-.1468l-2.8587-5.9906c-.3626-.762-1.0142-1.361-1.8235-1.5975-1.3873-.4099-2.8166.2838-3.4052 1.524L5.897 9.7333c-.0788.1629-.31.1576-.3784-.0053v-.0052a2.8597 2.8597 0 0 0-2.6642-1.7972c-.3784 0-.7515.0736-1.1088.2207-1.4714.6148-2.1283 2.349-1.5187 3.8203.557 1.3295 1.4714 2.5855 2.659 3.668.084.0788.1103.1997.063.3048l-.9563 2.0074c-.6727 1.4188-.1314 3.1477 1.2664 3.8571.4099.2049.846.31 1.298.31 1.1035 0 2.123-.6411 2.5959-1.6395l.825-1.7289a.254.254 0 0 1 .3048-.1366c1.0037.2732 2.0127.4204 3.0058.4204 1.1193 0 2.2229-.1682 3.2896-.4782a.2626.2626 0 0 1 .3101.1366l.8145 1.7131c.4834 1.0195 1.4924 1.7131 2.6169 1.7184.4572 0 .8986-.0999 1.3138-.3101 1.403-.7094 1.939-2.4435 1.2664-3.8676L19.875 15.787c-.0473-.1051-.0263-.226.0578-.3048 1.9864-1.8497 3.4525-4.2723 4.0043-6.9733ZM6.2121 20.0172a1.835 1.835 0 0 1-.6764.7622 1.8352 1.8352 0 0 1-.9788.2835c-.2733 0-.5518-.063-.8093-.1891-.9038-.4467-1.2454-1.5713-.8093-2.4804l.7935-1.6658c.0684-.1471.2575-.1997.3837-.1051.1681.1209.3415.2365.5202.3521.6989.4467 1.4293.825 2.1808 1.1351.1419.0578.205.2154.1419.352l-.7462 1.5555Zm5.0763-2.0442c-4.2092 0-8.6548-2.8534-10.1262-6.4951a1.8286 1.8286 0 0 1 1.009-2.3805c.2259-.0893.4571-.1366.683-.1366.7252 0 1.4084.431 1.6974 1.1456.9196 2.2806 4.0043 4.2092 6.7368 4.2092.4204 0 .8408-.042 1.256-.1156a.2643.2643 0 0 1 .2837.1419l1.3768 2.9007c.0683.1471-.0105.3205-.1629.3626-.8986.2365-1.8182.3678-2.7536.3678Zm-.599-4.9291.6358-1.3348c.0526-.1051.205-.1051.2575 0l.6201 1.3033c.042.0841-.0158.1891-.1051.2049-.268.0368-.536.0578-.7988.0578a5.0634 5.0634 0 0 1-.4887-.0263c-.1103-.0157-.1629-.1208-.1208-.2049Zm8.4604 7.8246a1.831 1.831 0 0 1-2.0329-.2788 1.8292 1.8292 0 0 1-.4316-.5778l-4.987-10.4836c-.0998-.2102-.3994-.2102-.4939 0l-1.545 3.2529a.2623.2623 0 0 1-.3205.1366c-1.051-.3626-2.0495-.9774-2.7904-1.7184a.2552.2552 0 0 1-.0473-.2943l3.3421-7.031c.1156-.247.2943-.4677.5203-.6201 1.051-.6884 2.2806-.2575 2.7378.7041l6.8577 14.4248c.4309.9144.0946 2.0389-.8093 2.4856Zm-1.4451-9.6481a.258.258 0 0 1 .0315-.2732c.783-1.0037 1.3558-2.1756 1.6028-3.421.1734-.867.9354-1.4714 1.7919-1.4714.1472 0 .2943.0158.4467.0526.9722.2417 1.5344 1.2507 1.3295 2.2333-.4835 2.3017-1.6816 4.3879-3.3159 6.0222-.1313.1314-.3468.0946-.4256-.0683l-1.4609-3.0742Z",
    "heliumbrowser": "M14.3081 22.2984 12 24l-2.3081-1.7016 1.0489-8.1189-6.5174 4.9661L1.5938 18l.321-2.8467L9.4808 12l-7.566-3.1533L1.5938 6l2.6296-1.1456 6.5174 4.9661-1.049-8.119L12 0l2.3081 1.7016-1.0488 8.1189 6.5173-4.9661L22.4062 6l-.321 2.8467L14.5192 12l7.566 3.1533.321 2.8467-2.6296 1.1456-6.5173-4.9661z",
}

LUCIDE = {
    "globe": [
        '<circle cx="12" cy="12" r="10"/>',
        '<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>',
        '<path d="M2 12h20"/>',
    ],
    "download": [
        '<path d="M12 15V3"/>',
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
        '<path d="m7 10 5 5 5-5"/>',
    ],
    "log-in": [
        '<path d="m10 17 5-5-5-5"/>',
        '<path d="M15 12H3"/>',
        '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>',
    ],
    "wrench": [
        '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/>',
    ],
    "workflow": [
        '<rect width="8" height="8" x="3" y="3" rx="2"/>',
        '<path d="M7 11v4a2 2 0 0 0 2 2h4"/>',
        '<rect width="8" height="8" x="13" y="13" rx="2"/>',
    ],
    "book-open": [
        '<path d="M12 5v16"/>',
        '<path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"/>',
    ],
}


def lucide(name: str, x: float, y: float, size: float, color: str) -> str:
    s = size / 24
    return (
        f'<g transform="translate({x:g} {y:g}) scale({s:g})" fill="none" stroke="{color}" '
        f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + "".join(LUCIDE[name])
        + "</g>"
    )


def logo(slug: str, x: float, y: float, size: float, color: str) -> str:
    s = size / 24
    return (
        f'<path transform="translate({x:g} {y:g}) scale({s:g})" fill="{color}" '
        f'd="{SIMPLE_ICONS[slug]}"/>'
    )


def svg(width: float, height: float, title: str, body: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:g}" height="{height:g}" '
        f'viewBox="0 0 {width:g} {height:g}" role="img" aria-label="{title}">'
        f"<title>{title}</title>{body}</svg>\n"
    )


# --- nav buttons ------------------------------------------------------------

NAV = [
    ("install", "Install", "download"),
    ("sign-in", "Sign in", "log-in"),
    ("tools", "Tools", "wrench"),
    ("how-it-works", "How it works", "workflow"),
    ("docs", "Docs", "book-open"),
]
NAV_H, NAV_MARGIN, NAV_ICON, NAV_FONT, NAV_SIZE = 36, 6, 16, "Aptos-SemiBold.ttf", 14


def nav_button(label: str, icon: str, t: dict[str, str]) -> tuple[float, str]:
    pad_l, gap, pad_r = 14, 7, 16
    tw = text_width(label, NAV_FONT, NAV_SIZE)
    pill = round(pad_l + NAV_ICON + gap + tw + pad_r)
    width = pill + 2 * NAV_MARGIN
    mid = NAV_H / 2
    baseline = mid + cap_height(NAV_FONT, NAV_SIZE) / 2
    x0 = NAV_MARGIN
    body = (
        f'<rect x="{x0 + 0.5:g}" y="0.5" width="{pill - 1}" height="{NAV_H - 1}" '
        f'rx="{(NAV_H - 1) / 2:g}" fill="{t["surface"]}" stroke="{t["border"]}"/>'
        + lucide(icon, x0 + pad_l, mid - NAV_ICON / 2, NAV_ICON, t["accent"])
        + f'<path fill="{t["fg"]}" d="{outline(label, NAV_FONT, NAV_SIZE, x0 + pad_l + NAV_ICON + gap, baseline)}"/>'
    )
    return width, svg(width, NAV_H, label, body)


# --- browsers strip ---------------------------------------------------------

# Order and platforms as in src/import/discovery.ts.
BROWSERS = [
    ("Chrome", "googlechrome", False),
    ("Chromium", None, False),
    ("Brave", "brave", False),
    ("Edge", None, False),
    ("Vivaldi", "vivaldi", False),
    ("Opera", "opera", False),
    ("Arc", "arc", True),
    ("Helium", "heliumbrowser", True),
]
STRIP_W, STRIP_H, STRIP_PAD, LOGO = 830, 128, 15, 36


def browsers_strip(t: dict[str, str]) -> str:
    col = (STRIP_W - 2 * STRIP_PAD) / len(BROWSERS)
    logo_y, name_base = 22, 84
    body = [
        f'<rect x="0.5" y="0.5" width="{STRIP_W - 1}" height="{STRIP_H - 1}" rx="12" '
        f'fill="{t["bg"]}" stroke="{t["border"]}"/>'
    ]
    for i, (name, slug, mac_only) in enumerate(BROWSERS):
        cx = STRIP_PAD + col * (i + 0.5)
        if slug is None:
            # No Simple Icons glyph (Chromium, Edge): a generic globe.
            body.append(lucide("globe", cx - LOGO / 2, logo_y, LOGO, t["fg"]))
        else:
            body.append(logo(slug, cx - LOGO / 2, logo_y, LOGO, t["fg"]))
        body.append(
            f'<path fill="{t["fg"]}" d="{centered(name, "Aptos.ttf", 14, cx, name_base)}"/>'
        )
        if mac_only:
            face, size = "Aptos-SemiBold.ttf", 10
            w = round(text_width("macOS", face, size) + 14)
            h, top = 17, 96
            body.append(
                f'<rect x="{cx - w / 2 + 0.5:g}" y="{top + 0.5}" width="{w - 1}" height="{h - 1}" '
                f'rx="{(h - 1) / 2:g}" fill="none" stroke="{t["border"]}"/>'
                f'<path fill="{t["fg"]}" d="{centered("macOS", face, size, cx, top + h / 2 + cap_height(face, size) / 2)}"/>'
            )
    title = "Supported browsers: Chrome, Chromium, Brave, Edge, Vivaldi, Opera, and on macOS Arc and Helium"
    return svg(STRIP_W, STRIP_H, title, "".join(body))


# --- main -------------------------------------------------------------------


def render(src: Path, out: Path, bg: str, zoom: int = 2) -> None:
    subprocess.run(
        ["rsvg-convert", "-z", str(zoom), "-b", bg, "-o", str(out), str(src)], check=True
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--preview", type=Path)
    args = parser.parse_args()

    nav_dir, browsers_dir = ASSETS / "nav", ASSETS / "browsers"
    nav_dir.mkdir(exist_ok=True)
    browsers_dir.mkdir(exist_ok=True)

    written: list[Path] = []
    for theme, t in THEMES.items():
        row = []
        for slug, label, icon in NAV:
            width, content = nav_button(label, icon, t)
            path = nav_dir / f"{slug}-{theme}.svg"
            path.write_text(content)
            written.append(path)
            row.append((width, content))
        path = browsers_dir / f"browsers-{theme}.svg"
        path.write_text(browsers_strip(t))
        written.append(path)

        if args.preview:
            # The five buttons side by side, as the README's centered row shows them.
            total, x, parts = sum(w for w, _ in row), 0.0, []
            for w, content in row:
                parts.append(content.replace("<svg ", f'<svg x="{x:g}" ', 1))
                x += w
            preview = args.preview / f"nav-row-{theme}.svg"
            preview.write_text(
                f'<svg xmlns="http://www.w3.org/2000/svg" width="{total:g}" height="{NAV_H}">'
                + "".join(parts)
                + "</svg>"
            )
            written.append(preview)

    for path in written:
        print(f"{path}  {path.stat().st_size} B")
        if args.preview:
            for name, bg in (("white", "#ffffff"), ("black", "#0d1117")):
                render(path, args.preview / f"{path.stem}-on-{name}.png", bg)


if __name__ == "__main__":
    main()
