#!/usr/bin/env python3
"""Writes demo-light.svg and demo-dark.svg, the README's animated chat demo.

The scene is authored with <text> in Aptos and Aptos Mono, then Inkscape turns
the text into paths (an SVG in <img> cannot load fonts) and this script puts
its own <style> block back, since Inkscape does not keep it intact.

Every element's resting style is its final frame, so a renderer without CSS
animation shows the finished conversation.

Requires: python3, inkscape (1.x), the Aptos fonts.
Usage: python3 assets/demo/generate.py
"""

from __future__ import annotations

import re
import subprocess
import tempfile
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent

W, H = 900, 584
LOOP = 18.0  # seconds; the scene is finished by ~7.7 s and held until the loop restarts
FADE_OUT = (17.5, 18.0)

PALETTES = {
    "dark": dict(
        page="#1a1b26", surface="#24283b", inset="#1f2335", border="#414868",
        fg="#c0caf5", muted="#737aa2", red="#f7768e", green="#9ece6a",
        yellow="#e0af68", blue="#7aa2f7", magenta="#bb9af7", cyan="#7dcfff",
    ),
    "light": dict(
        page="#e1e2e7", surface="#d0d5e3", inset="#e9e9ed", border="#a8aecb",
        fg="#3760bf", muted="#6172b0", red="#f52a65", green="#587539",
        yellow="#8c6c3e", blue="#2e7de9", magenta="#9854f1", cyan="#007197",
    ),
}

SANS = "Aptos"
MONO = "Aptos Mono"

USER_TEXT = "Find a well-rated Japanese kanji deck and turn it into Markdown."
HOME = "/home/me/.anki-web-mcp/downloads"

# Illustrative AnkiWeb results, in search_shared_decks' rating order
# (thumbsUp minus thumbsDown, highest first).
ROWS = [
    ("Core Kanji 2000", 412, 9, "2,000"),
    ("Kanji by JLPT level, N5 to N1", 305, 12, "2,211"),
    ("Kanji radicals", 188, 4, "214"),
]


def mix(a: str, b: str, t: float) -> str:
    """a over b at opacity t, as an opaque colour."""
    pa = [int(a[i : i + 2], 16) for i in (1, 3, 5)]
    pb = [int(b[i : i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x * t + y * (1 - t)):02x}" for x, y in zip(pa, pb))


def text(x, y, content, *, size=15, family=SANS, fill, weight=400, anchor="start", id_=None):
    ident = f' id="{id_}"' if id_ else ""
    return (
        f'<text{ident} x="{x}" y="{y}" font-family="{family}" font-size="{size}" '
        f'font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" '
        f'xml:space="preserve">{content}</text>'
    )


def spans(x, y, parts, *, size=13, family=MONO, weight=400):
    """One line made of (text, colour, weight?) runs."""
    inner = "".join(
        f'<tspan fill="{p[1]}" font-weight="{p[2] if len(p) > 2 else weight}">{escape(p[0])}</tspan>'
        for p in parts
    )
    return (
        f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" '
        f'xml:space="preserve">{inner}</text>'
    )


class Timeline:
    """Collects per-element keyframes as CSS."""

    def __init__(self):
        self.rules: list[str] = []

    @staticmethod
    def pct(t: float) -> str:
        return f"{t / LOOP * 100:.3f}%"

    def appear(self, ident: str, at: float, dur: float = 0.35, rise: float = 6):
        p = self.pct
        out0, out1 = FADE_OUT
        self.rules.append(
            f"@keyframes {ident}{{"
            f"0%,{p(at)}{{opacity:0;transform:translateY({rise}px)}}"
            f"{p(at + dur)},{p(out0)}{{opacity:1;transform:translateY(0)}}"
            f"100%{{opacity:0;transform:translateY(0)}}}}"
            f"#{ident}{{animation:{ident} {LOOP}s ease-out infinite}}"
        )

    def blink(self, ident: str, start: float, end: float):
        """Visible only between start and end; hidden at rest."""
        p = self.pct
        self.rules.append(
            f"@keyframes {ident}{{"
            f"0%,{p(start)}{{opacity:0}}{p(start + 0.01)},{p(end)}{{opacity:1}}"
            f"{p(end + 0.01)},100%{{opacity:0}}}}"
            f"#{ident}{{opacity:0;animation:{ident} {LOOP}s linear infinite}}"
        )

    def pulse(self, ident: str, start: float, end: float):
        """A running indicator: on between start and end, hidden at rest."""
        p = self.pct
        mid = (start + end) / 2
        self.rules.append(
            f"@keyframes {ident}{{"
            f"0%,{p(start)}{{opacity:0}}{p(start + 0.05)}{{opacity:1}}"
            f"{p(mid)}{{opacity:.35}}{p(end - 0.05)}{{opacity:1}}"
            f"{p(end)},100%{{opacity:0}}}}"
            f"#{ident}{{opacity:0;animation:{ident} {LOOP}s linear infinite}}"
        )

    def typing(self, ident: str, start: float, end: float, width: float, chars: int):
        """Slides a cover off the text in character steps. At rest the cover
        sits past the clip (its x attribute), so it is invisible."""
        p = self.pct
        self.rules.append(
            f"@keyframes {ident}{{"
            f"0%,{p(start)}{{transform:translateX({-width:.1f}px);animation-timing-function:steps({chars},end)}}"
            f"{p(end)},100%{{transform:translateX(0)}}}}"
            f"#{ident}{{animation:{ident} {LOOP}s linear infinite}}"
        )

    def css(self) -> str:
        return "\n".join(self.rules)


def chip(tl, c, ident, y, name, args, result_lines, t_call, t_done, height):
    """A collapsed tool-call card: header, then the result once it lands."""
    x0, x1 = 30, W - 30
    out = [f'<g id="{ident}">']
    out.append(
        f'<rect x="{x0}" y="{y}" width="{x1 - x0}" height="{height}" rx="10" '
        f'fill="{c["surface"]}" stroke="{c["border"]}" stroke-width="1"/>'
    )
    # Tool glyph: a small bracketed square.
    out.append(
        f'<rect x="{x0 + 14}" y="{y + 11}" width="14" height="14" rx="3" fill="none" '
        f'stroke="{c["magenta"]}" stroke-width="1.6"/>'
        f'<path d="M{x0 + 18} {y + 15.5} l3 2.5 l-3 2.5" fill="none" stroke="{c["magenta"]}" '
        f'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
    )
    out.append(spans(x0 + 38, y + 23, [(name, c["blue"], 700)] + args, size=13.5))
    # Running dot, then a check.
    cx, cy = x1 - 22, y + 18
    out.append(f'<circle id="{ident}-run" cx="{cx}" cy="{cy}" r="4.5" fill="{c["yellow"]}"/>')
    tl.pulse(f"{ident}-run", t_call + 0.2, t_done)
    out.append(
        f'<g id="{ident}-ok"><circle cx="{cx}" cy="{cy}" r="8" fill="{c["green"]}" fill-opacity=".18"/>'
        f'<path d="M{cx - 3.6} {cy + 0.2} l2.5 2.6 l4.8 -5.2" fill="none" stroke="{c["green"]}" '
        f'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></g>'
    )
    tl.appear(f"{ident}-ok", t_done, 0.2, 0)
    # Result panel.
    top = y + 36
    out.append(
        f'<rect x="{x0 + 10}" y="{top}" width="{x1 - x0 - 20}" height="{height - 46}" rx="6" '
        f'fill="{c["inset"]}"/>'
    )
    out.append(f'<g id="{ident}-wait">')
    out.append(spans(x0 + 24, top + 20, [("running", c["muted"])], size=13))
    out.append("</g>")
    tl.blink(f"{ident}-wait", t_call + 0.2, t_done)
    out.append(f'<g id="{ident}-res">')
    for i, line in enumerate(result_lines):
        out.append(line(x0 + 24, top + 20 + i * 21))
    out.append("</g>")
    tl.appear(f"{ident}-res", t_done, 0.4, 4)
    out.append("</g>")
    tl.appear(ident, t_call)
    return "\n".join(out)


def scene(c: dict, user_width: float) -> tuple[str, str]:
    tl = Timeline()
    q = lambda s: f'"{s}"'  # noqa: E731
    parts: list[str] = []

    # Window.
    parts.append(
        f'<rect x=".5" y=".5" width="{W - 1}" height="{H - 1}" rx="14" fill="{c["page"]}" '
        f'stroke="{c["border"]}"/>'
        f'<path d="M1 44 H{W - 1}" stroke="{c["border"]}" stroke-opacity=".7"/>'
    )
    for i, col in enumerate((c["red"], c["yellow"], c["green"])):
        parts.append(f'<circle cx="{24 + i * 20}" cy="22" r="6" fill="{col}" fill-opacity=".85"/>')
    parts.append(text(W / 2, 27, "assistant", size=14, fill=c["muted"], anchor="middle", weight=600))

    # 1. The user's message types in.
    bx1 = W - 30
    pad = 18
    bw = user_width + 2 * pad
    bx0 = bx1 - bw
    by, bh = 62, 42
    tx = bx0 + pad
    bubble = mix(c["blue"], c["page"], 0.16)
    parts.append(
        f'<clipPath id="type-clip"><rect x="{tx - 2}" y="{by}" width="{user_width + 4}" height="{bh}"/></clipPath>'
    )
    parts.append(f'<g id="user">')
    parts.append(
        f'<rect x="{bx0}" y="{by}" width="{bw}" height="{bh}" rx="12" fill="{bubble}" '
        f'stroke="{c["blue"]}" stroke-opacity=".35"/>'
    )
    parts.append(text(tx, by + 26.5, escape(USER_TEXT), size=16, fill=c["fg"]))
    parts.append(
        f'<g clip-path="url(#type-clip)"><rect id="cover" x="{tx + user_width + 2}" y="{by + 2}" '
        f'width="{user_width + 4}" height="{bh - 4}" fill="{bubble}"/></g>'
    )
    parts.append("</g>")
    tl.appear("user", 0.3, 0.3, 4)
    tl.typing("cover", 0.6, 2.4, user_width + 4, len(USER_TEXT))

    mono_fg, muted = c["fg"], c["muted"]

    # 2. search_shared_decks.
    def heading(x, y):
        return spans(x, y, [("143 shared decks match \"kanji\"; showing 1-20.", muted)], size=13)

    def row_line(r):
        title, up, down, notes = r

        def draw(x, y):
            return (
                spans(x, y, [(title, mono_fg)], size=13)
                + spans(x + 470, y, [(f"+{up}", c["green"]), (f" / -{down}", muted)], size=13)
                + text(x + 790, y, f"{notes} notes", size=13, family=MONO, fill=muted, anchor="end")
            )

        return draw

    y1 = 120
    h1 = 46 + 20 + 4 * 21 - 4
    parts.append(
        chip(
            tl, c, "c1", y1, "search_shared_decks",
            [(" { query: ", muted), (q("kanji"), c["green"]), (", sort: ", muted),
             (q("rating"), c["green"]), (" }", muted)],
            [heading] + [row_line(r) for r in ROWS],
            2.8, 3.6, h1,
        )
    )

    # 3. download_shared_deck.
    y2 = y1 + h1 + 12
    h2 = 46 + 20 + 2 * 21 - 4

    def kv(key, value, colour=None):
        return lambda x, y: spans(x, y, [(f"{key}: ", muted), (value, colour or mono_fg)], size=13)

    parts.append(
        chip(
            tl, c, "c2", y2, "download_shared_deck",
            [(" { deck: ", muted), (q("798002504"), c["green"]), (" }", muted)],
            [kv("path", f"{HOME}/Core_Kanji_2000.apkg", c["cyan"]),
             kv("bytes", "4318208")],
            4.3, 5.1, h2,
        )
    )

    # 4. convert_deck_to_markdown.
    y3 = y2 + h2 + 12
    h3 = h2
    parts.append(
        chip(
            tl, c, "c3", y3, "convert_deck_to_markdown",
            [(" { path: ", muted), (q(f"{HOME}/Core_Kanji_2000.apkg"), c["green"]), (" }", muted)],
            [kv("markdownPath", f"{HOME}/Core_Kanji_2000/Core_Kanji_2000.md", c["cyan"]),
             lambda x, y: spans(x, y, [("cards: ", muted), ("2000", mono_fg), ("   mediaFiles: ", muted),
                                       ("0", mono_fg), ("   diagnosticCount: ", muted), ("0", mono_fg)], size=13)],
            5.8, 6.6, h3,
        )
    )

    # 5. The assistant's reply.
    y4 = y3 + h3 + 32
    parts.append('<g id="reply">')
    parts.append(
        text(34, y4, "Core Kanji 2000 is the best-rated match (+412 / -9). I downloaded it and converted all",
             size=16, fill=c["fg"])
    )
    parts.append(
        text(34, y4 + 24, "2,000 cards to ~/.anki-web-mcp/downloads/Core_Kanji_2000/Core_Kanji_2000.md.",
             size=16, fill=c["fg"])
    )
    parts.append("</g>")
    tl.appear("reply", 7.2, 0.5, 6)

    body = "\n".join(parts)
    return body, tl.css()


def svg(body: str, css: str = "") -> str:
    style = f"<style>{css}</style>" if css else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
        f'role="img" aria-label="An assistant searches AnkiWeb for a kanji deck, downloads it and '
        f'converts it to Markdown through anki-web-mcp">{style}\n{body}\n</svg>\n'
    )


def measure(content: str, size: int) -> float:
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "m.svg"
        src.write_text(
            svg(text(0, 50, escape(content), size=size, fill="#000", id_="m"))
        )
        out = subprocess.run(
            ["inkscape", str(src), "--query-id=m", "--query-width"],
            capture_output=True, text=True, check=True,
        )
        return float(out.stdout.strip().splitlines()[-1])


_TOKEN = re.compile(r"[MmLlHhVvQqCcSsTtZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?")
_ARITY = {"m": 2, "l": 2, "h": 1, "v": 1, "q": 4, "t": 2, "c": 6, "s": 4, "z": 0}


def _num(value: float) -> str:
    out = f"{value:.1f}".rstrip("0").rstrip(".")
    if out in ("-0", ""):
        out = "0"
    return out.replace("0.", ".", 1) if out.startswith(("0.", "-0.")) else out


def compact_path(d: str) -> str:
    """Rewrites a path with relative commands at 0.1 px, measuring each delta
    from the rounded previous point so rounding never accumulates."""
    tokens = _TOKEN.findall(d)
    out: list[str] = []
    cur = [0.0, 0.0]  # exact current point
    shown = [0.0, 0.0]  # current point as written
    start = [0.0, 0.0]
    shown_start = [0.0, 0.0]
    i, cmd = 0, ""
    r = lambda v: round(v, 1)  # noqa: E731
    while i < len(tokens):
        if tokens[i].isalpha():
            cmd = tokens[i]
            i += 1
            if cmd in "Zz":
                out.append("z")
                cur, shown = start[:], shown_start[:]
                continue
        low = cmd.lower()
        n = _ARITY[low]
        args = [float(t) for t in tokens[i : i + n]]
        i += n
        rel = cmd.islower()
        if low == "h":
            x = cur[0] + args[0] if rel else args[0]
            out.append("h" + _num(r(x) - shown[0]))
            cur[0], shown[0] = x, r(x)
            continue
        if low == "v":
            y = cur[1] + args[0] if rel else args[0]
            out.append("v" + _num(r(y) - shown[1]))
            cur[1], shown[1] = y, r(y)
            continue
        pts = [(args[k], args[k + 1]) for k in range(0, n, 2)]
        if rel:
            pts = [(cur[0] + px, cur[1] + py) for px, py in pts]
        coords = []
        for px, py in pts:
            coords += [_num(r(px) - shown[0]), _num(r(py) - shown[1])]
        out.append(low + " ".join(coords).replace(" -", "-"))
        cur = list(pts[-1])
        shown = [r(cur[0]), r(cur[1])]
        if low == "m":
            start, shown_start = cur[:], shown[:]
            cmd = "l" if rel else "L"  # implicit lineto after moveto
    return "".join(out)


def outline(source: str) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = Path(tmp) / "in.svg", Path(tmp) / "out.svg"
        src.write_text(source)
        subprocess.run(
            ["inkscape", str(src), "--export-text-to-path", "--export-plain-svg",
             f"--export-filename={dst}"],
            check=True, capture_output=True,
        )
        return dst.read_text()


def main() -> None:
    user_width = round(measure(USER_TEXT, 16), 1)
    for name, palette in PALETTES.items():
        body, css = scene(palette, user_width)
        authored = svg(body)
        (HERE / f"demo-{name}.src.svg").write_text(svg(body, css))
        plain = outline(authored)
        # Drop Inkscape's metadata and put our animation back in.
        plain = re.sub(r"<metadata.*?</metadata>", "", plain, flags=re.S)
        plain = re.sub(r"<sodipodi:namedview.*?/>", "", plain, flags=re.S)
        plain = re.sub(r"<style.*?</style>", "", plain, flags=re.S)
        plain = re.sub(r"(<svg\b[^>]*>)", lambda m: m.group(1) + f"<style>{css}</style>", plain, count=1)
        plain = re.sub(r'\sd="([^"]*)"', lambda m: f' d="{compact_path(m.group(1))}"', plain)
        plain = re.sub(r'\s(?:id="(?:path|circle|g|text|tspan|defs|svg)\d+"|xmlns:svg="[^"]*"|version="1.1")', "", plain)
        plain = re.sub(r"\n\s*\n", "\n", plain)
        (HERE / f"demo-{name}.svg").write_text(plain)
        print(f"demo-{name}.svg: {len(plain.encode()) // 1024} KB")


if __name__ == "__main__":
    main()
