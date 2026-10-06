#!/usr/bin/env python3
"""Generate banner candidate A (flashcard stack meets the web).

Writes banner-{light,dark}.src.svg (with <text>, for editing) and converts the
text to outlines with Inkscape into banner-{light,dark}.svg, which is what the
README embeds. Needs the Aptos fonts installed and inkscape on PATH.

    python3 generate.py
"""
import math
import pathlib
import subprocess

HERE = pathlib.Path(__file__).resolve().parent
W, H = 1280, 320

THEMES = {
    "dark": dict(bg="#1a1b26", surface="#24283b", border="#414868", fg="#c0caf5",
                 muted="#565f89", red="#f7768e", green="#9ece6a", yellow="#e0af68",
                 blue="#7aa2f7", magenta="#bb9af7", cyan="#7dcfff", card="#24283b"),
    "light": dict(bg="#e1e2e7", surface="#d0d5e3", border="#a8aecb", fg="#3760bf",
                  muted="#8990b3", red="#f52a65", green="#587539", yellow="#8c6c3e",
                  blue="#2e7de9", magenta="#9854f1", cyan="#007197", card="#f4f5f8"),
}


def globe(c, cx, cy, r):
    """Minimal globe: outline, two meridians, two parallels, a few linked nodes."""
    s = [f'<g fill="none" stroke="{c["cyan"]}" stroke-width="2.5" stroke-linecap="round">',
         f'<circle cx="{cx}" cy="{cy}" r="{r}"/>',
         f'<ellipse cx="{cx}" cy="{cy}" rx="{r*0.42:.1f}" ry="{r}"/>',
         f'<line x1="{cx}" y1="{cy-r}" x2="{cx}" y2="{cy+r}"/>',
         f'<line x1="{cx-r}" y1="{cy}" x2="{cx+r}" y2="{cy}"/>']
    for f in (0.5,):
        dy = r * f
        hw = math.sqrt(r * r - dy * dy)
        s.append(f'<line x1="{cx-hw:.1f}" y1="{cy-dy:.1f}" x2="{cx+hw:.1f}" y2="{cy-dy:.1f}"/>')
        s.append(f'<line x1="{cx-hw:.1f}" y1="{cy+dy:.1f}" x2="{cx+hw:.1f}" y2="{cy+dy:.1f}"/>')
    s.append('</g>')
    # network: nodes on the globe joined by arcs
    nodes = [(cx - r * 0.42, cy - r * 0.5), (cx + r * 0.62, cy - r * 0.18),
             (cx + r * 0.2, cy + r * 0.62)]
    s.append(f'<g fill="none" stroke="{c["magenta"]}" stroke-width="2.5" stroke-linecap="round">')
    (ax, ay), (bx, by), (dx, dy) = nodes
    s.append(f'<path d="M{ax:.1f} {ay:.1f} Q{cx+r*0.15:.1f} {cy-r*0.75:.1f} {bx:.1f} {by:.1f}"/>')
    s.append(f'<path d="M{bx:.1f} {by:.1f} Q{cx+r*0.75:.1f} {cy+r*0.4:.1f} {dx:.1f} {dy:.1f}"/>')
    s.append('</g>')
    for x, y in nodes:
        s.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="7" fill="{c["bg"]}" '
                 f'stroke="{c["magenta"]}" stroke-width="3"/>')
    return "\n".join(s)


def card(c, x, y, w, h, angle, pivot, accent, front=False):
    px, py = pivot
    g = [f'<g transform="rotate({angle} {px} {py})">',
         f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{c["card"]}" '
         f'stroke="{c["border"]}" stroke-width="2.5"/>',
         f'<rect x="{x}" y="{y}" width="{w}" height="10" rx="0" fill="{accent}"/>'
         if False else
         f'<path d="M{x} {y+14} a14 14 0 0 1 14 -14 h{w-28} a14 14 0 0 1 14 14 v4 h-{w} z" '
         f'fill="{accent}"/>']
    if front:
        mid = y + h / 2 + 4
        lx = x + 22
        g += [
            # question half
            f'<text x="{lx}" y="{y+58}" font-family="Aptos Bold" font-weight="700" font-size="26" '
            f'fill="{c["blue"]}">Q</text>',
            f'<rect x="{lx+30}" y="{y+40}" width="{w-82}" height="8" rx="4" fill="{c["fg"]}" opacity="0.75"/>',
            f'<rect x="{lx+30}" y="{y+56}" width="{(w-82)*0.6:.0f}" height="8" rx="4" fill="{c["fg"]}" opacity="0.75"/>',
            # divider
            f'<line x1="{x+16}" y1="{mid}" x2="{x+w-16}" y2="{mid}" stroke="{c["border"]}" '
            f'stroke-width="2" stroke-dasharray="6 6"/>',
            # answer half
            f'<text x="{lx}" y="{mid+44}" font-family="Aptos Bold" font-weight="700" font-size="26" '
            f'fill="{c["green"]}">A</text>',
            f'<rect x="{lx+30}" y="{mid+26}" width="{(w-82)*0.8:.0f}" height="8" rx="4" fill="{c["muted"]}"/>',
            f'<rect x="{lx+30}" y="{mid+42}" width="{(w-82)*0.45:.0f}" height="8" rx="4" fill="{c["muted"]}"/>',
        ]
    g.append('</g>')
    return "\n".join(g)


def banner(name):
    c = THEMES[name]
    cw, ch = 190, 226
    cx0, cy0 = 146, 46
    pivot = (cx0 + cw / 2, cy0 + ch + 60)
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        '<title>anki-web-mcp: Search, download and share AnkiWeb decks from your assistant, '
        'on your own session.</title>',
        f'<rect width="{W}" height="{H}" rx="24" fill="{c["bg"]}" stroke="{c["border"]}" stroke-width="2"/>',
        globe(c, 416, 108, 68),
        card(c, cx0, cy0, cw, ch, -14, pivot, c["magenta"]),
        card(c, cx0, cy0, cw, ch, -6, pivot, c["blue"]),
        card(c, cx0, cy0, cw, ch, 3, pivot, c["cyan"], front=True),
        f'<text x="530" y="164" font-family="Aptos Display Bold" font-weight="700" font-size="92" '
        f'letter-spacing="-1.5" fill="{c["fg"]}">anki-web-<tspan fill="{c["blue"]}">mcp</tspan></text>',
        f'<text font-family="Aptos" font-size="27" fill="{c["fg"]}" opacity="0.8">'
        '<tspan x="534" y="214">Search, download and share AnkiWeb decks</tspan>'
        '<tspan x="534" y="250">from your assistant, on your own session.</tspan></text>',
        '</svg>',
    ]
    return "\n".join(parts) + "\n"


for name in THEMES:
    src = HERE / f"banner-{name}.src.svg"
    out = HERE / f"banner-{name}.svg"
    src.write_text(banner(name))
    subprocess.run(["inkscape", str(src), "--export-text-to-path", "--export-plain-svg",
                    f"--export-filename={out}"], check=True, capture_output=True)
    print(out, out.stat().st_size, "bytes")
