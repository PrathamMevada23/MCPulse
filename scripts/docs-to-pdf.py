#!/usr/bin/env python3
"""
Render the project documents to PDF and DOCX.

    scripts/docs-to-pdf.py docs/PROJECT_REPORT.md --pdf out.pdf --docx out.docx

Uses the markdown package to convert and xhtml2pdf (reportlab) to lay out the
PDF. The style sheet is deliberately simple: no flexbox or grid, because the
PDF engine only understands table based layout.
"""

from __future__ import annotations

import argparse
import html
import os
import re
import subprocess
import sys

import markdown

STYLE = """
@page {
    size: A4;
    margin: 1.6cm 1.5cm 1.8cm 1.5cm;
    @frame footer {
        -pdf-frame-content: content;
        margin: 0.8cm 1.5cm 0.6cm 1.5cm;
        height: 0.6cm;
    }
    @bottom-center {
        content: "MCPulse  -  MCP Server Monitoring & Performance Analytics Platform  -  page " counter(page) " of " counter(pages);
        font-family: Helvetica, sans-serif;
        font-size: 7.5pt;
        color: #6b7280;
    }
    @top-center {
        content: "MCA Semester III  -  Cloud Computing";
        font-family: Helvetica, sans-serif;
        font-size: 7.5pt;
        color: #9ca3af;
        padding-top: 0.4cm;
    }
}
body {
    font-family: Helvetica, sans-serif;
    font-size: 9.2pt;
    line-height: 1.45;
    color: #111827;
}
h1 {
    font-size: 17pt;
    color: #0b4f6c;
    border-bottom: 2.5pt solid #0b4f6c;
    padding-bottom: 4pt;
    margin-top: 2pt;
    margin-bottom: 10pt;
}
h2 {
    font-size: 12.5pt;
    color: #0b7285;
    margin-top: 13pt;
    margin-bottom: 5pt;
    border-bottom: 0.6pt solid #cbd5e1;
    padding-bottom: 2pt;
    page-break-after: avoid;
}
h3 {
    font-size: 10.5pt;
    color: #155e75;
    margin-top: 10pt;
    margin-bottom: 4pt;
    page-break-after: avoid;
}
h4 { font-size: 9.6pt; color: #374151; margin-top: 8pt; page-break-after: avoid; }
p { margin-top: 0; margin-bottom: 6pt; text-align: justify; }
ul, ol { margin-top: 2pt; margin-bottom: 7pt; }
li { margin-bottom: 2.5pt; }
strong { color: #0f172a; }
code {
    font-family: Courier, monospace;
    font-size: 8.2pt;
    background-color: #f1f5f9;
    padding: 0.5pt 2pt;
}
pre {
    font-family: Courier, monospace;
    font-size: 7.6pt;
    background-color: #f8fafc;
    border: 0.6pt solid #cbd5e1;
    padding: 6pt;
    margin-top: 5pt;
    margin-bottom: 8pt;
    line-height: 1.3;
}
pre code { background-color: #f8fafc; padding: 0; }
table {
    border-collapse: collapse;
    width: 100%;
    margin-top: 5pt;
    margin-bottom: 9pt;
    font-size: 8.2pt;
    page-break-inside: avoid;
}
th {
    background-color: #0b4f6c;
    color: #ffffff;
    text-align: left;
    padding: 4pt 5pt;
    border: 0.5pt solid #0b4f6c;
}
td {
    padding: 3.5pt 5pt;
    border: 0.5pt solid #cbd5e1;
    vertical-align: top;
}
tr:nth-child(even) td { background-color: #f8fafc; }
blockquote {
    border-left: 2.5pt solid #0ea5e9;
    background-color: #f0f9ff;
    margin: 6pt 0;
    padding: 5pt 8pt;
    font-size: 8.6pt;
}
hr { border: 0; border-top: 0.6pt solid #cbd5e1; margin: 10pt 0; }
img { max-width: 100%; }
a { color: #0369a1; text-decoration: none; }
"""


# The PDF engine only has the base Helvetica glyphs, so the status symbols used
# in the documents are replaced with plain text.
SYMBOLS = {
    "\u2705": "OK",
    "\u274c": "NO",
    "\u26a0\ufe0f": "!",
    "\u26a0": "!",
    "\u23f1": "stopwatch",
    "\u2192": "->",
    "\u2190": "<-",
    "\u2014": "-",
    "\u2013": "-",
    "\u2018": "'",
    "\u2019": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u00a0": " ",
    "\u2022": "-",
    "\u00b7": "-",
}


def strip_symbols(text: str) -> str:
    for symbol, replacement in SYMBOLS.items():
        text = text.replace(symbol, replacement)
    # Anything else outside the Latin-1 range would also render as a box.
    return "".join(ch if ord(ch) < 0x2500 else replacement for ch, replacement in
                   ((ch, SYMBOLS.get(ch, " ")) for ch in text))


def md_to_html(markdown_text: str, title: str) -> str:
    body = markdown.markdown(
        strip_symbols(markdown_text),
        extensions=["tables", "fenced_code", "sane_lists", "attr_list"],
    )
    # The ASCII diagrams in the documents use a monospace block; keep them
    # readable by wrapping them in <pre>.
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{html.escape(title)}</title>
<style>{STYLE}</style></head>
<body>{body}</body></html>"""


def to_pdf(html_text: str, out_path: str) -> None:
    from xhtml2pdf import pisa

    with open(out_path, "wb") as handle:
        status = pisa.CreatePDF(html_text, dest=handle, encoding="utf-8")
    if status.err:
        raise SystemExit(f"PDF rendering reported errors: {status.err}")


def to_docx(html_text: str, out_path: str) -> None:
    tmp = out_path + ".html"
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write(html_text)
    subprocess.run(
        ["textutil", "-convert", "docx", tmp, "-output", out_path],
        check=True,
        capture_output=True,
    )
    os.remove(tmp)


def main() -> int:
    parser = argparse.ArgumentParser(description="Render markdown to PDF and DOCX")
    parser.add_argument("source", help="markdown file")
    parser.add_argument("--all", action="store_true",
                        help="render every document in the submission folder")
    parser.add_argument("--pdf", help="output PDF path")
    parser.add_argument("--docx", help="output DOCX path")
    parser.add_argument("--html", help="also write the intermediate HTML")
    args = parser.parse_args()

    with open(args.source, encoding="utf-8") as handle:
        markdown_text = handle.read()

    title = re.search(r"^#\s+(.+)$", markdown_text, re.M)
    title = title.group(1) if title else os.path.basename(args.source)
    page = md_to_html(markdown_text, title)

    if args.html:
        with open(args.html, "w", encoding="utf-8") as handle:
            handle.write(page)
        print(f"html  -> {args.html}")

    if args.all:
        import glob
        for source in sorted(glob.glob("docs/*.md")):
            name = os.path.splitext(os.path.basename(source))[0]
            with open(source, encoding="utf-8") as handle:
                text = handle.read()
            heading = re.search(r"^#\s+(.+)$", text, re.M)
            sub = md_to_html(text, heading.group(1) if heading else name)
            out_pdf = os.path.join("docs/submission", f"{name}.pdf")
            to_pdf(sub, out_pdf)
            print(f"pdf   -> {out_pdf}  ({os.path.getsize(out_pdf) // 1024} KB)")

    if args.pdf:
        to_pdf(page, args.pdf)
        size = os.path.getsize(args.pdf)
        print(f"pdf   -> {args.pdf}  ({size // 1024} KB)")

    if args.docx:
        to_docx(page, args.docx)
        size = os.path.getsize(args.docx)
        print(f"docx  -> {args.docx}  ({size // 1024} KB)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
