# Сводка по .blend: объекты, полигоны, габариты, текстуры.
# Запуск: blender -b файл.blend --python tools/inspect_blend.py
import bpy, json
from mathutils import Vector

info = {"file": bpy.data.filepath.split("\\")[-1], "objects": [], "images": []}
mins, maxs = Vector((1e9, 1e9, 1e9)), Vector((-1e9, -1e9, -1e9))
for o in bpy.context.scene.objects:
    rec = {"name": o.name, "type": o.type}
    if o.type == 'MESH':
        rec["tris"] = sum(len(p.vertices) - 2 for p in o.data.polygons)
        rec["materials"] = [m.name for m in o.data.materials if m]
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mins = Vector(map(min, mins, w)); maxs = Vector(map(max, maxs, w))
    info["objects"].append(rec)
for im in bpy.data.images:
    info["images"].append({"name": im.name, "size": list(im.size)})
info["bbox_min"] = [round(v, 3) for v in mins]
info["bbox_max"] = [round(v, 3) for v in maxs]
print("@@INFO@@" + json.dumps(info, ensure_ascii=False))
