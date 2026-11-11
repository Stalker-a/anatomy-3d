"""Запуск: blender -b --disable-autoexec <file.blend> --python inspect_blend.py -- <out.json>
Выгружает дерево коллекций и список объектов (тип, число вершин, родитель)."""
import json
import sys

import bpy

out = sys.argv[sys.argv.index("--") + 1]


def walk(coll):
    return {
        "name": coll.name,
        "objects": [
            {"name": o.name, "type": o.type,
             "verts": len(o.data.vertices) if o.type == "MESH" else 0,
             "parent": o.parent.name if o.parent else None}
            for o in coll.objects
        ],
        "children": [walk(c) for c in coll.children],
    }


with open(out, "w", encoding="utf-8") as f:
    json.dump(walk(bpy.context.scene.collection), f, ensure_ascii=False, indent=1)
print("objects total:", len(bpy.data.objects))
