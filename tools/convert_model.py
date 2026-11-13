# Облегчение модели Meshy и экспорт в GLB для игры.
# Запуск: blender -b in.blend --python tools/convert_model.py -- out.glb <target_tris> <tex_px> <piece|board>
#   piece — основание фигуры ставится в (0,0,0), высота приводится к 1.0
#   board — координаты не меняются (по ним размечена игровая сетка)
import bpy, sys, json
from mathutils import Vector

out, target, tex, mode = sys.argv[sys.argv.index("--") + 1:][:4]
target, tex = int(target), int(tex)

obj = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
bpy.context.view_layer.objects.active = obj
for o in bpy.context.scene.objects: o.select_set(o == obj)

tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
if tris > target:
    mod = obj.modifiers.new("Decimate", 'DECIMATE')
    mod.ratio = target / tris
    bpy.ops.object.modifier_apply(modifier=mod.name)

if mode == 'piece':
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    pts = [Vector(v.co) for v in obj.data.vertices]
    minz = min(p.z for p in pts); maxz = max(p.z for p in pts)
    cx = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
    cy = (min(p.y for p in pts) + max(p.y for p in pts)) / 2
    h = maxz - minz
    for v in obj.data.vertices:
        v.co = Vector(((v.co.x - cx) / h, (v.co.y - cy) / h, (v.co.z - minz) / h))
    obj.location = (0, 0, 0)

# текстуры: цвет и нормали — tex, карта металл/шероховатость — tex/2
for m in obj.data.materials:
    if not m or not m.use_nodes: continue
    for n in m.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image and n.image.size[0] > 0:
            to = [l.to_node.type for l in n.outputs[0].links]
            px = tex // 2 if 'SEPARATE_COLOR' in to else tex
            if n.image.size[0] > px: n.image.scale(px, px)

bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True,
                          export_image_format='JPEG', export_jpeg_quality=85,
                          export_apply=True, export_yup=True)
res = {"out": out, "tris_before": tris, "tris_after": sum(len(p.vertices) - 2 for p in obj.data.polygons)}
with open(out + ".json", "w") as fh: json.dump(res, fh)
