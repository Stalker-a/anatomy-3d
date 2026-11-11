"""OCR диапазона страниц тома: PDF -> PNG (400 dpi) -> Tesseract rus+lat -> work/ocr/<том>/pNNN.txt."""
import os
import subprocess
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
TESSERACT = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
BOOKS = Path(r"C:\Claude_AI\01_Учёба\книги\анатомия")
VOLUMES = {
    "t1": "Синельников - Атлас анатомии человека, том 1.pdf",
    "t2": "Синельников - Атлас анатомии человека, том 2.pdf",
    "t3": "241.biblioteka.pdf",
    "t4": "Синельников - Атлас анатомии человека, том 4.pdf",
}


def main(vol: str, first: int, last: int) -> None:
    out = ROOT / "work" / "ocr" / vol
    out.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, TESSDATA_PREFIX=str(ROOT / "tools" / "tessdata"))
    doc = pymupdf.open(BOOKS / VOLUMES[vol])
    for i in range(first, last + 1):  # индексы страниц PDF, с нуля
        txt = out / f"p{i:03d}.txt"
        if txt.exists():
            continue
        png = out / f"p{i:03d}.png"
        doc[i].get_pixmap(dpi=400).save(str(png))
        res = subprocess.run([TESSERACT, str(png), "-", "-l", "rus+lat", "--psm", "3"],
                             capture_output=True, env=env)
        txt.write_text(res.stdout.decode("utf-8"), encoding="utf-8")
        print(f"{vol} p{i}: {len(res.stdout)} байт", flush=True)


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]))
