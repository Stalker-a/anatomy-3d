"""Извлекает пары «русский термин, latin term» из OCR-страниц раздела.

Запуск: python extract_terms.py <том> <первая стр. PDF> <последняя стр. PDF> <out.json>
Результат — сырые кандидаты с номерами страниц; дальше их вычищают вручную (terms_review).
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

CYR = "а-яёА-ЯЁ"
# Латинские буквы, похожие на кириллические, и наоборот
LAT2CYR = str.maketrans("aceopxyAEHKMOPCTBX", "асеорхуАЕНКМОРСТВХ")
CYR2LAT = str.maketrans("асеорхуАЕНКМОРСТВХ", "aceopxyAEHKMOPCTBX")


def fix_word(w: str) -> str:
    cyr = len(re.findall(f"[{CYR}]", w))
    lat = len(re.findall("[a-zA-Z]", w))
    if cyr and lat:
        return w.translate(LAT2CYR) if cyr >= lat else w.translate(CYR2LAT)
    return w


def clean(text: str) -> str:
    text = re.sub(r"-\n\s*", "", text)          # переносы слов
    text = re.sub(r"\s+", " ", text)
    text = " ".join(fix_word(w) for w in text.split(" "))
    text = re.sub(r"\bcM\.|\bсМ\.|\bcм\.", "см.", text)
    return text


# «Русское название, latin name» — латынь до запятой, скобки, точки с запятой или тире
PAIR = re.compile(
    rf"(?P<ru>[{CYR}][{CYR}\- ]{{2,90}}?)\s*,\s+"
    r"(?P<la>(?:(?:ligg|lig|mm|m|artt|art|a|v|n)\.\s?)?[a-z][a-z\-]*(?:\s+(?:et\s+)?[a-z][a-z\-\.]*){0,7})"
    r"(?=\s*[,;:()]|\s+—|\s*\.\s|\s*$)"
)
FIG = re.compile(r"(?:рис|рисунок)\.?\s*(\d{2,3})")
CAPTION = re.compile(rf"(?<!\d)(?P<num>\d{{3}})\.\s+(?P<ru>[{CYR}][{CYR}\- ]{{2,90}}?),\s+(?P<la>[a-z][a-z \-]{{2,80}}?)[,;.]")

# Слова, с которых не может начинаться термин (обрывки фраз)
STOP_HEAD = {"и", "или", "а", "но", "что", "это", "как", "при", "со", "с", "в", "на", "из", "к", "по", "от", "для"}


def strip_ru(ru: str) -> str:
    ru = ru.strip(" -")
    words = ru.split()
    # Термин — это хвост фразы: отрезаем вводные слова до последней запятой/тире уже сделал regex,
    # здесь убираем ведущие служебные слова
    while words and words[0].lower() in STOP_HEAD:
        words = words[1:]
    return " ".join(words)


def main(vol: str, first: int, last: int, out: str) -> None:
    pairs = defaultdict(lambda: {"pages": set(), "figs": set(), "ru_variants": defaultdict(int)})
    captions = []
    for i in range(first, last + 1):
        raw = (ROOT / "work" / "ocr" / vol / f"p{i:03d}.txt").read_text(encoding="utf-8")
        text = clean(raw)
        for m in CAPTION.finditer(text):
            captions.append({"fig": int(m["num"]), "ru": strip_ru(m["ru"]), "la": m["la"].strip(), "pdf_page": i})
        for m in PAIR.finditer(text):
            ru, la = strip_ru(m["ru"]), re.sub(r"\s+", " ", m["la"]).strip(" .")
            if len(la) < 3 or len(ru) < 3:
                continue
            key = la.lower()
            pairs[key]["ru_variants"][ru.lower()] += 1
            pairs[key]["pages"].add(i)
            tail = text[m.end(): m.end() + 40]
            pairs[key]["figs"].update(int(f) for f in FIG.findall(tail))
    result = [
        {"la": la, "ru": sorted(v["ru_variants"].items(), key=lambda kv: -kv[1]),
         "pdf_pages": sorted(v["pages"]), "figs": sorted(v["figs"])}
        for la, v in sorted(pairs.items())
    ]
    Path(out).write_text(json.dumps({"pairs": result, "captions": captions}, ensure_ascii=False, indent=1),
                         encoding="utf-8")
    print(f"пар: {len(result)}, подписей рисунков: {len(captions)}")


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4])
