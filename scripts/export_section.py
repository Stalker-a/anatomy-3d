"""Запуск: blender -b --disable-autoexec Startup.blend --python export_section.py -- <out_dir> <config.json>

config.json: {"collections": [...], "structure_collections": [...], "extra": [имена объектов из других коллекций]}
Экспортирует меши в один .glb (Draco), метки (FONT-объекты) — в labels.json, список мешей — в meshes.json."""
import json
import re
import sys
from pathlib import Path

import bpy

args = sys.argv[sys.argv.index("--") + 1:]
out_dir, config = Path(args[0]), json.loads(Path(args[1]).read_text(encoding="utf-8"))
out_dir.mkdir(parents=True, exist_ok=True)

# Служебные объекты Z-Anatomy: подписи (.t), выносные линии (.j/.i), заголовки групп (.g), прочее (.s)
SERVICE = re.compile(r"\.(g|j|i|s|t)$")


def objects_of(coll):
    yield from coll.objects
    for ch in coll.children:
        yield from objects_of(ch)


def is_structure(o):
    return o.type == "MESH" and not SERVICE.search(o.name) and (len(o.data.vertices) > 8 or len(o.modifiers) > 0)


meshes, labels, seen = [], [], set()
sources = [(c, objects_of(bpy.data.collections[c])) for c in config["collections"]]
extra = config.get("extra", [])  # базовые имена: берём сам объект и его варианты «имя.r», «имя.el» и т. п.
sources.append(("extra", (o for o in bpy.data.objects
                          if any(o.name == n or o.name.startswith(n + ".") for n in extra))))
for coll, objs in sources:
    for o in objs:
        if o.name in seen:
            continue
        seen.add(o.name)
        if is_structure(o):
            meshes.append((o, coll))
        elif o.type == "FONT":
            pos = o.matrix_world.translation
            # Дочерний меш из двух вершин — выносная линия; дальний от текста конец лежит на структуре
            anchor = None
            for ch in o.children:
                if ch.type == "MESH" and 2 <= len(ch.data.vertices) <= 4:
                    pts = [ch.matrix_world @ v.co for v in ch.data.vertices]
                    anchor = list(max(pts, key=lambda p: (p - pos).length))
            labels.append({"name": o.name, "parent": o.parent.name if o.parent else None,
                           "text": o.data.body, "pos": list(pos), "anchor": anchor})

for o in bpy.context.view_layer.objects:
    o.hide_set(False)
    o.select_set(False)
for o, _ in meshes:
    o.hide_viewport = False
    o.hide_render = False
    o.select_set(True)

bpy.ops.export_scene.gltf(
    filepath=str(out_dir / "model.glb"), export_format="GLB", use_selection=True,
    export_apply=True, export_materials="NONE", export_extras=False,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
)
structure = set(config.get("structure_collections", []))
(out_dir / "labels.json").write_text(json.dumps(labels, ensure_ascii=False, indent=1), encoding="utf-8")
(out_dir / "meshes.json").write_text(json.dumps(
    [{"name": o.name, "source": coll, "structure": coll in structure or coll == "extra"} for o, coll in meshes],
    ensure_ascii=False, indent=1), encoding="utf-8")
print(f"exported {len(meshes)} meshes, {len(labels)} labels")
