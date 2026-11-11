"""Собирает раздел для сайта из вычищенного списка терминов и экспорта Z-Anatomy.

Запуск: python pipeline/build_section.py <id раздела>
Читает:  pipeline/<id>.terms.txt, pipeline/<id>.notes.txt (объяснения), pipeline/sections.json, pipeline/regions.json,
         work/export/<export>/{meshes,labels}.json, work/terms_raw_<id>.json (OCR-кандидаты для страниц и рисунков)
Пишет:   public/data/<id>.json, public/data/index.json, public/models/<id>.glb, work/coverage_<id>.txt
Падает с ошибкой, если привязка ссылается на несуществующий объект модели.
"""
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

from bones_ru import bone_ru

ROOT = Path(__file__).resolve().parent.parent
SIDE = re.compile(r"\.(e|o)?\d?(r|l)$")  # «Humerus.r», «Patellar ligament.el» → базовое имя


def base(name: str) -> str:
    return SIDE.sub("", name)


def norm_la(s: str) -> str:
    s = s.lower().replace("ligg.", "ligamenta ").replace("lig.", "ligamentum ")
    return re.sub(r"[^a-z]", "", s)


def parse_terms(path: Path):
    chapters, cur = [], None
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or (line.startswith("#") and not line.startswith("##")):
            continue
        if line.startswith("##"):
            cid, title, rng = [x.strip() for x in line[2:].split("|")]
            a, b = map(int, rng.split("-"))
            cur = {"id": cid, "title": title, "pdf": (a, b), "rows": []}
            chapters.append(cur)
            continue
        parts = [x.strip() for x in line.split("|")]
        row = {"ru": parts[0], "la": parts[1], "m": [], "p": None, "b": [], "ex": False}
        for f in parts[2:]:
            if f == "ex":
                row["ex"] = True
            elif f.startswith("m:"):
                row["m"] = [x.strip() for x in f[2:].split(";") if x.strip()]
            elif f.startswith("p:"):
                row["p"] = f[2:].strip()
            elif f.startswith("b:"):
                row["b"] = [x.strip() for x in f[2:].split(";") if x.strip()]
            else:
                raise ValueError(f"Неизвестное поле «{f}» в строке: {raw}")
        cur["rows"].append(row)
    return chapters


def parse_notes(path: Path):
    """Объяснения: «## глава», затем строки «la:», «lead:», «view:» (ракурс: ant, post, lat, med, sup, dorsal),
    «fact: Название | значение», «text:», «- Термин: объяснение»."""
    notes, cur = {}, None
    if not path.exists():
        return notes
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or (line.startswith("#") and not line.startswith("##")):
            continue
        if line.startswith("##"):
            cur = notes.setdefault(line[2:].strip(), {"la": "", "lead": "", "view": "ant", "facts": [], "text": [], "terms": {}})
        elif line.startswith("- "):
            name, _, expl = line[2:].partition(": ")
            cur["terms"][name.strip()] = expl.strip()
        else:
            key, _, val = line.partition(":")
            val = val.strip()
            if key == "fact":
                k, _, v = val.partition("|")
                cur["facts"].append([k.strip(), v.strip()])
            elif key == "text":
                cur["text"].append(val)
            elif key in ("la", "lead", "view"):
                cur[key] = val
            else:
                raise ValueError(f"Неизвестная строка в объяснениях: {raw}")
    return notes


# Группа структуры на странице сустава — по русскому названию
KINDS = [
    ("ligament", re.compile(r"связк|хорда|пучки|часть$", re.I)),
    # «сустав», «суставы» — но не «суставная поверхность» и не «суставной диск … сустава»
    ("joint", re.compile(r"^(?!суставн)(.*(?<![а-яё])сустав(ы|а|ов)?(?![а-яё])|.*(соединени|симфиз(?!иальн)"
                         r"|синдесмоз|синхондроз|шов|схиндилез|зубоальвеол))", re.I)),
    ("soft", re.compile(r"мембран|перепонк|диск|мениск|губа|губы|сумк|складк|жиров|капсул|влагалищ|ворсин"
                        r"|хрящ|кольцо|ядро|отросток|родничк|углублени|полост|зона", re.I)),
]


def kind_of(ru: str) -> str:
    return next((k for k, rx in KINDS if rx.search(ru)), "bone")


def main(section_id: str) -> None:
    sections = json.loads((ROOT / "pipeline" / "sections.json").read_text(encoding="utf-8"))
    sec = next(s for v in sections["volumes"] for s in v["sections"] if s["id"] == section_id)
    exp = ROOT / "work" / "export" / sec["export"]
    meshes = json.loads((exp / "meshes.json").read_text(encoding="utf-8"))
    labels = json.loads((exp / "labels.json").read_text(encoding="utf-8"))
    raw = json.loads((ROOT / "work" / f"terms_raw_{section_id}.json").read_text(encoding="utf-8"))

    structures = sorted({base(m["name"]) for m in meshes if m["structure"]})
    bones = {base(m["name"]) for m in meshes if not m["structure"]}
    points = {}
    for lb in labels:
        if lb["name"].endswith(".t") and lb["anchor"]:
            points[re.sub(r"^\((.*)\)$", r"\1", lb["name"][:-2])] = lb
    # Страницы и рисунки из OCR: латынь → [(pdf-страница, рисунки)]
    ocr = {}
    for p in raw["pairs"]:
        ocr.setdefault(norm_la(p["la"]), []).append(p)

    notes = parse_notes(ROOT / "pipeline" / f"{section_id}.notes.txt")
    regions = json.loads((ROOT / "pipeline" / "regions.json").read_text(encoding="utf-8"))["regions"]
    region_of = {c: r["id"] for r in regions for c in r["chapters"]}

    errors, terms, out_chapters, ids_by_key = [], {}, [], {}
    for ch in parse_terms(ROOT / "pipeline" / f"{section_id}.terms.txt"):
        ids = []
        note = notes.get(ch["id"], {"la": "", "lead": "", "view": "ant", "facts": [], "text": [], "terms": {}})
        for name in note["terms"]:
            if not any(r["ru"] == name for r in ch["rows"]):
                errors.append(f"[{ch['id']}] объяснение к термину, которого нет в главе: «{name}»")
        for r in ch["rows"]:
            key = (r["ru"].lower(), r["la"].lower())
            if key in ids_by_key and not (r["m"] or r["p"] or r["b"]):
                ids.append(ids_by_key[key])  # повтор термина из другой главы
                if r["ru"] in note["terms"] and not terms[ids_by_key[key]]["note"]:
                    terms[ids_by_key[key]]["note"] = note["terms"][r["ru"]]
                continue
            tid = "t" + hashlib.md5(f"{r['ru']}|{r['la']}".encode()).hexdigest()[:8]
            ids_by_key[key] = tid
            ms = []
            for m in r["m"]:
                # «Intervertebral disc» → все «Intervertebral disc L3-L4»…, но «… of wrist joint» — уже другая структура
                found = [s for s in structures if s == m or (s.startswith(m + " ") and not s.startswith(m + " of "))]
                if not found:
                    errors.append(f"[{ch['id']}] {r['ru']}: нет 3D-структуры «{m}»")
                ms += found
            for b in r["b"]:
                if b not in bones:
                    errors.append(f"[{ch['id']}] {r['ru']}: нет кости «{b}»")
            point = parent = None
            if r["p"]:
                lb = points.get(r["p"])
                if not lb:
                    errors.append(f"[{ch['id']}] {r['ru']}: нет метки «{r['p']}»")
                else:
                    point, parent = [round(v, 5) for v in lb["anchor"]], lb["parent"]
            a, b = ch["pdf"]
            cands = [c for c in ocr.get(norm_la(r["la"]), [])]
            pages = sorted({pg for c in cands for pg in c["pdf_pages"] if a <= pg <= b}) or \
                sorted({pg for c in cands for pg in c["pdf_pages"]})
            figs = sorted({f for c in cands for f in c["figs"]})
            terms[tid] = {
                "ru": r["ru"], "la": r["la"], "meshes": ms, "point": point, "parent": parent,
                "context": r["b"], "example": r["ex"],
                "page": (pages[0] if pages else a) + sec["page_offset"], "figs": figs,
                "kind": kind_of(r["ru"]), "note": note["terms"].get(r["ru"], ""),
                # Обобщающий термин («Суставы нижней конечности»): не входит в кадр и подсветку главы
                "umbrella": bool(re.match(r"(Суставы |Связки и (соединения|суставы) )", r["ru"])),
            }
            ids.append(tid)
        if ch["id"] not in region_of:
            errors.append(f"[{ch['id']}] глава не входит ни в один регион (pipeline/regions.json)")
        bones_of_ch = []
        for tid in ids:
            t = terms[tid]
            for bone in t["context"] + ([base(t["parent"])] if t["parent"] else []):
                if bone not in bones_of_ch:
                    bones_of_ch.append(bone)
        out_chapters.append({"id": ch["id"], "title": ch["title"], "terms": ids, "region": region_of.get(ch["id"]),
                             "la": note["la"], "lead": note["lead"], "view": note["view"], "facts": note["facts"], "text": note["text"],
                             "bones": bones_of_ch, "pages": [a + sec["page_offset"], b + sec["page_offset"]]})

    if errors:
        print("ОШИБКИ ПРИВЯЗКИ:\n" + "\n".join(errors))
        sys.exit(1)

    bone_names = {}
    for b in sorted(bones):
        ru = bone_ru(b)
        if ru:
            bone_names[b] = ru
        elif any(b in c["bones"] for c in out_chapters):
            errors.append(f"Нет русского названия кости «{b}» (pipeline/bones_ru.py)")
    if errors:
        print("ОШИБКИ:\n" + "\n".join(errors))
        sys.exit(1)

    data = {"id": section_id, "volume": sec["volume"], "title": sec["title"],
            "model": f"models/{section_id}.glb", "structureMeshes": structures,
            "regions": [{k: r[k] for k in ("id", "title", "short", "lead", "chapters")} for r in regions],
            "boneNames": bone_names, "chapters": out_chapters, "terms": terms}
    pub = ROOT / "public"
    (pub / "data").mkdir(parents=True, exist_ok=True)
    (pub / "models").mkdir(parents=True, exist_ok=True)
    (pub / "data" / f"{section_id}.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    shutil.copy(exp / "model.glb", pub / "models" / f"{section_id}.glb")
    index = {"volumes": [{"title": v["title"], "sections": [{"id": s["id"], "title": s["title"]}
                                                           for s in v["sections"] if s.get("ready")]}
                         for v in sections["volumes"]]}
    index["volumes"] = [v for v in index["volumes"] if v["sections"]]
    (pub / "data" / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")

    # Отчёт о покрытии
    def level(t):
        return "mesh" if t["meshes"] else "point" if t["point"] else "bone" if t["context"] else "none"

    lines, total = [], {"mesh": 0, "point": 0, "bone": 0, "none": 0}
    for t in terms.values():
        total[level(t)] += 1
    for ch in out_chapters:
        c = {"mesh": 0, "point": 0, "bone": 0, "none": 0}
        for tid in dict.fromkeys(ch["terms"]):
            c[level(terms[tid])] += 1
        lines.append(f"{ch['title']}: 3D-объект {c['mesh']}, точка {c['point']}, кость {c['bone']}, нет {c['none']}")
    n = len(terms)
    summary = (f"Терминов: {n}. 3D-объект: {total['mesh']}, точка: {total['point']}, "
               f"подсветка кости: {total['bone']}, без привязки: {total['none']}")
    (ROOT / "work" / f"coverage_{section_id}.txt").write_text(summary + "\n\n" + "\n".join(lines), encoding="utf-8")
    print(summary)
    with_note = sum(1 for t in terms.values() if t["note"])
    print(f"С объяснением: {with_note} из {n}; глав с описанием: {sum(1 for c in out_chapters if c['lead'])} из {len(out_chapters)}")
    unused = [s for s in structures if not any(s in t["meshes"] for t in terms.values())]
    print(f"Структур модели без термина: {len(unused)}")


if __name__ == "__main__":
    main(sys.argv[1])
