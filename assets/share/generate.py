#!/usr/bin/env python3
"""Draws the share_deck figure for the README, in Tokyo Night Day and Tokyo Night.

Writes share-{light,dark}.src.svg (live <text>, editable) and share-{light,dark}.svg
(text converted to paths by Inkscape, so GitHub's <img> needs no fonts), then puts the
CSS animation back if Inkscape dropped it.

    python3 assets/share/generate.py

Needs inkscape and the Aptos and CaskaydiaMono Nerd Font fonts installed.
The values shown follow src/tools/share.ts and docs/sharing.md; the deck is illustrative.
"""

import re
import subprocess
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent
W, H = 900, 396

PALETTES = {
    "light": dict(
        bg="#e1e2e7", surface="#d0d5e3", border="#a8aecb", fg="#3760bf", muted="#6c739a",
        red="#f52a65", green="#587539", yellow="#8c6c3e", blue="#2e7de9", magenta="#9854f1",
        cyan="#007197", card="#e9eaef", on_accent="#ffffff",
    ),
    "dark": dict(
        bg="#1a1b26", surface="#24283b", border="#414868", fg="#c0caf5", muted="#7a83ad",
        red="#f7768e", green="#9ece6a", yellow="#e0af68", blue="#7aa2f7", magenta="#bb9af7",
        cyan="#7dcfff", card="#1f2335", on_accent="#1a1b26",
    ),
}

SANS = "Aptos"
MONO = "CaskaydiaMono Nerd Font"

# 15 s loop: left card, then the approval, then the right card, which is whole by
# about 4.8 s and holds for about 10 s before everything fades and starts again.
# Every group rests at opacity 1, so a renderer without animation shows the finished scene.
STYLE = """<style>
@media (prefers-reduced-motion: no-preference) {
  #step1 { animation: step1 15s ease-out infinite; }
  #step2 { animation: step2 15s ease-out infinite; }
  #step3 { animation: step3 15s ease-out infinite; }
}
@keyframes step1 { 0% { opacity: 0; } 6% { opacity: 1; } 96% { opacity: 1; } 100% { opacity: 0; } }
@keyframes step2 { 0%, 11% { opacity: 0; } 17% { opacity: 1; } 96% { opacity: 1; } 100% { opacity: 0; } }
@keyframes step3 { 0%, 24% { opacity: 0; } 32% { opacity: 1; } 96% { opacity: 1; } 100% { opacity: 0; } }
</style>"""


def text(x, y, s, fill, size=13, family=SANS, weight=400, anchor="start", italic=False):
    style = ' font-style="italic"' if italic else ""
    return (
        f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}"'
        f' fill="{fill}" text-anchor="{anchor}"{style}>{escape(s)}</text>'
    )


def spans(x, y, parts, size=12, family=MONO):
    """One line of differently coloured runs: parts is [(text, colour), ...]."""
    inner = "".join(f'<tspan fill="{c}">{escape(s)}</tspan>' for s, c in parts)
    return (
        f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" xml:space="preserve">'
        f"{inner}</text>"
    )


def chip(x_right, y, label, colour, p):
    w = len(label) * 7.2 + 18
    x = x_right - w
    return (
        f'<rect x="{x:.1f}" y="{y - 15}" width="{w:.1f}" height="22" rx="11" fill="none"'
        f' stroke="{colour}" stroke-width="1.4"/>'
        + text(x + w / 2, y, label, colour, 12, MONO, 400, "middle")
    )


def header(x, y, n, p, chip_label, chip_colour, x_right):
    return (
        f'<circle cx="{x + 11}" cy="{y - 5}" r="11" fill="{p["blue"]}"/>'
        + text(x + 11, y - 0.5, str(n), p["on_accent"], 13, SANS, 700, "middle")
        + text(x + 30, y, "share_deck", p["fg"], 15, MONO, 700)
        + chip(x_right, y - 1, chip_label, chip_colour, p)
    )


def card(x, y, w, h, p):
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{p["card"]}"'
        f' stroke="{p["border"]}" stroke-width="1"/>'
    )


def rule(x1, x2, y, p):
    return f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="{p["border"]}" stroke-width="1"/>'


def arrow(x1, x2, y, p):
    return (
        f'<line x1="{x1}" y1="{y}" x2="{x2 - 7}" y2="{y}" stroke="{p["muted"]}" stroke-width="1.6"/>'
        f'<path d="M{x2 - 9},{y - 5} L{x2},{y} L{x2 - 9},{y + 5} Z" fill="{p["muted"]}"/>'
    )


def build(p):
    cw, top, ch = 350, 62, 314
    lx, rx = 24, W - 24 - 350
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        "<title>share_deck previews first and publishes only with confirm: true</title>",
        STYLE,
        f'<rect width="{W}" height="{H}" rx="14" fill="{p["bg"]}"/>',
        text(lx, 38, "Sharing takes two calls, with your yes in between", p["fg"], 18, SANS, 600),
        text(W - 24, 38, "nothing is public until call 2", p["muted"], 13, SANS, 400, "end"),
    ]

    # Call 1: the preview.
    x0, xr = lx + 16, lx + cw - 16
    k, v, s = p["muted"], p["fg"], p["green"]
    left = [
        card(lx, top, cw, ch, p),
        header(x0, 92, 1, p, "preview", p["yellow"], xr),
        spans(x0, 116, [("deck: ", k), ('"Spanish::Verbs"', s)]),
        rule(x0, xr, 128, p),
        text(x0, 150, "Preview only: nothing was published.", p["yellow"], 13, SANS, 600),
        spans(x0, 172, [("status: ", k), ('"preview"', p["yellow"])]),
        spans(x0, 191, [("deck.name: ", k), ('"Spanish::Verbs"', s)]),
        spans(x0, 210, [("title: ", k), ('"Spanish irregular verbs"', s)]),
        spans(x0, 229, [("tags: ", k), ('["spanish", "verbs"]', s)]),
        spans(x0, 248, [("sharesInLast7Days: ", k), ("0", p["magenta"]),
                        ("  sharesPerWeek: ", k), ("20", p["magenta"])]),
        spans(x0, 267, [("problems: ", k), ("[]", v)]),
        f'<rect x="{x0}" y="281" width="{cw - 32}" height="85" rx="6" fill="{p["surface"]}"/>',
        text(x0 + 10, 299, "Confirming also makes this declaration for you:", v, 12, SANS, 600),
        text(x0 + 10, 317, "“I declare that the material I am sharing is entirely", p["muted"], 12, SANS, 400, italic=True),
        text(x0 + 10, 333, "my own work, or I have obtained a license from the", p["muted"], 12, SANS, 400, italic=True),
        text(x0 + 10, 349, "intellectual property holder(s) to share it here.”", p["muted"], 12, SANS, 400, italic=True),
    ]
    out.append('<g id="step1">' + "".join(left) + "</g>")

    # Between the calls: the assistant waits for the user.
    mid = (lx + cw + rx) / 2
    bw = 116
    middle = [
        text(mid, 154, "The assistant shows", p["fg"], 13, SANS, 400, "middle"),
        text(mid, 171, "the preview and waits", p["fg"], 13, SANS, 400, "middle"),
        arrow(lx + cw + 6, mid - bw / 2 - 4, 214, p),
        f'<rect x="{mid - bw / 2}" y="196" width="{bw}" height="36" rx="18" fill="{p["blue"]}"/>',
        text(mid, 219, "Yes, share it", p["on_accent"], 14, SANS, 600, "middle"),
        arrow(mid + bw / 2 + 4, rx - 6, 214, p),
        text(mid, 258, "No yes, no", p["muted"], 13, SANS, 400, "middle"),
        text(mid, 275, "second call", p["muted"], 13, SANS, 400, "middle"),
    ]
    out.append('<g id="step2">' + "".join(middle) + "</g>")

    # Call 2: confirmed, read again from scratch, published.
    x0, xr = rx + 16, rx + cw - 16
    steps = [
        "Reads the deck and the share form again",
        "Refuses if any problem remains",
        "Posts deck-share with confirm_copyright set",
        "Polls deck-share-state every 5 s, up to 2 min",
    ]
    right = [
        card(rx, top, cw, ch, p),
        header(x0, 92, 2, p, "publish", p["green"], xr),
        spans(x0, 116, [("deck: ", k), ('"Spanish::Verbs"', s), (", ", k),
                        ("confirm: ", k), ("true", p["green"])]),
        rule(x0, xr, 128, p),
    ]
    for i, step in enumerate(steps):
        y = 150 + i * 19
        right.append(f'<circle cx="{x0 + 4}" cy="{y - 4}" r="2.6" fill="{p["cyan"]}"/>')
        right.append(text(x0 + 14, y, step, v, 13))
    right += [
        rule(x0, xr, 228, p),
        spans(x0, 250, [("status: ", k), ('"shared"', p["green"])]),
        spans(x0, 269, [("sharedId: ", k), ("1850391742", p["magenta"])]),
        spans(x0, 288, [("url:", k)]),
        spans(x0 + 8, 306, [('"https://ankiweb.net/shared/info/1850391742"', s)], size=11.5),
        f'<rect x="{x0}" y="320" width="{cw - 32}" height="46" rx="6" fill="{p["surface"]}"/>',
        text(x0 + 10, 339, "AnkiWeb hides a new listing from the public", v, 12, SANS, 400),
        text(x0 + 10, 355, "for 24 hours so copyright holders can check it.", v, 12, SANS, 400),
    ]
    out.append('<g id="step3">' + "".join(right) + "</g>")
    out.append("</svg>")
    return "\n".join(out)


def minify(svg):
    """Rounds path data to 0.1 px and drops Inkscape's ids, metadata and indentation."""

    def round_d(m):
        d = re.sub(r"-?\d+\.\d+", lambda n: f"{float(n.group()):.1f}".rstrip("0").rstrip("."), m.group(1))
        d = re.sub(r"\s*([a-zA-Z])\s*", r"\1", d)
        d = re.sub(r"\s*,\s*", ",", d)
        d = re.sub(r",-", "-", d)
        d = re.sub(r" -", "-", d)
        d = re.sub(r"(?<![\d.])0\.(\d)", r".\1", d)
        # "1.5 .6" and "1.5,.6" read as "1.5.6": a second point starts a new number.
        d = re.sub(r"(\.\d+)[ ,](?=\.)", r"\1", d)
        return f'd="{d}"'

    svg = re.sub(r'd="([^"]*)"', round_d, svg)
    svg = re.sub(r'\s(?:id|aria-label|xmlns:svg|version)="[^"]*"', lambda m: (
        m.group(0) if re.match(r'\sid="step\d"', m.group(0)) else ""), svg)
    svg = re.sub(r"<\?xml[^>]*>\s*", "", svg)
    svg = re.sub(r"<defs\s*/>", "", svg)
    svg = re.sub(r"\s+", " ", svg)
    svg = re.sub(r">\s+<", "><", svg)
    svg = re.sub(r"\s+(/?>)", r"\1", svg)
    return svg.strip() + "\n"


def outline(src, dst):
    subprocess.run(
        ["inkscape", str(src), "--export-text-to-path", "--export-plain-svg",
         f"--export-filename={dst}"],
        check=True, capture_output=True,
    )
    svg = minify(dst.read_text())
    # Inkscape may drop or rewrite the <style>; put the original back.
    svg = re.sub(r"<style.*?</style>", "", svg, flags=re.S)
    svg = re.sub(r"(<svg\b[^>]*>)", lambda m: m.group(1) + "\n" + STYLE, svg, count=1)
    for n in (1, 2, 3):
        if f'id="step{n}"' not in svg:
            raise SystemExit(f"{dst.name}: group step{n} lost its id")
    dst.write_text(svg)


def main():
    for name, palette in PALETTES.items():
        src = HERE / f"share-{name}.src.svg"
        dst = HERE / f"share-{name}.svg"
        src.write_text(build(palette))
        outline(src, dst)
        print(f"{dst.relative_to(HERE.parent.parent)}: {dst.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
