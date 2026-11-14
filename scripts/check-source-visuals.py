#!/usr/bin/env python3
"""Geometry regression fixtures, created locally without third-party paper PDFs.

Run after compiling native/platform/pdf-helper.swift:
    python3 scripts/check-source-visuals.py native/target/pdf-helper
"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile


def text(x, y, value):
    return f"BT /F1 10 Tf {x} {y} Td ({value}) Tj ET\n"


def pdf(path, streams):
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"", b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    kids = []
    for stream in streams:
        page_id = len(objects) + 1
        kids.append(f"{page_id} 0 R")
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents {page_id+1} 0 R >>".encode())
        data = stream.encode()
        objects.append(f"<< /Length {len(data)} >>\nstream\n".encode()+data+b"endstream")
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>".encode()
    data = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for n, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f"{n} 0 obj\n".encode()+obj+b"\nendobj\n")
    start = len(data)
    data.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        data.extend(f"{offset:010} 00000 n \n".encode())
    data.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF".encode())
    path.write_bytes(data)


def contains(v, x, y):
    left, top, width, height = v["rect"]
    return left <= x/600 <= left+width and top <= (800-y)/800 <= top+height


# Table 2 above a separate figure, including notes but excluding following prose.
p1 = text(40, 750, "Table 2")+text(40, 735, "Group comparison")
for y in [720, 700, 630]:
    p1 += f"40 {y} m 560 {y} l S\n"
p1 += text(45, 680, "Control    Patient    0.05")+text(40, 615, "Notes: values are means.")
p1 += text(40, 575, "2.2. Results and unrelated body text")
p1 += "100 180 400 220 re S\n"+text(100, 165, "Figure 1. A separate plot.")
# Cell segments, caption below; catches selecting a nearby prose separator instead.
p2 = ""
for y in [740, 720, 690, 660]:
    for x in [160, 200, 240, 280, 320]:
        p2 += f"{x} {y} m {x+40} {y} l S\n"
for x in range(160, 361, 40):
    p2 += f"{x} 660 m {x} 740 l S\n"
p2 += text(160, 640, "Table 1. Clinical characteristics.")
p2 += "160 580 m 560 580 l S\n"+text(160, 560, "Following body text.")
# A four-panel vector figure with a caption beside it. Include the bottom panels.
p3 = text(40, 745, "Fig. 2 | Four panels.")+text(40, 730, "Caption on the left.")
for y in [600, 430]:
    for x in [230, 400]:
        p3 += f"{x} {y} 150 140 re S\n"
p3 += text(235, 410, "Time (s)")+"40 390 m 560 390 l S\n"+text(40, 350, "Following prose.")
# A mention inside prose is not a figure caption.
p4 = text(40, 700, "Figure 6 illustrates a result mentioned in the body.")
# Unpunctuated captions and text-glyph dotted rules (journal table style).
p5 = text(40,750,"Table 3 Predictions under different mappings.")
for y in [720,690,610]:
    p5 += text(40,y,"."*170)
p5 += text(45,700,"Mapping       Similarity       Effort")+text(45,660,"Identity       unchanged        higher")+text(45,630,"Marginal       conditional      lower")
p5 += text(40,570,"This unrelated paragraph continues below the table and refers to")+text(40,558,"Fig. 7: a hypothetical scenario, not a caption.")
p6 = "100 400 400 300 re S\n"+text(100,380,"Figure A4 Appendix diagram without punctuation.")
helper = str(Path(sys.argv[1] if len(sys.argv)>1 else "native/target/pdf-helper").resolve())
with tempfile.TemporaryDirectory() as directory:
    source = Path(directory)/"geometry.pdf"
    pdf(source, [p1, p2, p3, p4, p5, p6])
    visuals = json.loads(subprocess.check_output([helper, "visuals", str(source)]))
    by_label = {(v["page"],v["label"]):v for v in visuals}
    assert len(visuals)==6, visuals
    assert all(v["cropped"] for v in visuals), visuals
    t = by_label[1,"Table 2"]
    assert contains(t,40,720) and contains(t,560,630) and contains(t,45,615), t
    assert not contains(t,100,575) and not contains(t,150,300), t
    grid=by_label[2,"Table 1"]
    assert contains(grid,160,740) and contains(grid,360,660), grid
    assert not contains(grid,200,580), grid
    side=by_label[3,"Figure 2"]
    assert contains(side,230,740) and contains(side,550,430), side
    assert not contains(side,100,745) and not contains(side,250,350), side
    dotted=by_label[5,"Table 3"]
    assert contains(dotted,45,700) and contains(dotted,45,630), dotted
    assert not contains(dotted,45,570), dotted
    assert contains(by_label[6,"Figure A4"],100,700)
    assert not any(v['label']=="Figure 7" for v in visuals), visuals
    for i,v in enumerate(visuals):
        target=Path(directory)/f"{i}.png"
        subprocess.run([helper,"crop",str(source),str(v["page"]),str(target),*map(str,v["rect"])],check=True)
        assert target.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
    print("6 extracted visuals: table notes, segmented grid, separate figure, side-caption panels, dotted text rules, appendix figure; prose excluded; PNG crops valid")
