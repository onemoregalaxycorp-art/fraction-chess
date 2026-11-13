# Готовая доска-диорама Meshy с сеткой 8×8: облегчить, повернуть вокруг Z и экспортировать в GLB.
# Запуск: blender -b board.blend --python tools/convert_board.py -- out.glb <tris> <tex> <rot_deg>
#   rot_deg — поворот вокруг вертикали (против часовой), чтобы клетка a1 у белых была тёмной.
# Рядом пишется out.glb.top.png — ортографический вид сверху (ortho 2.0, центр 0,0, 1024 px) для разметки.
import bpy, sys, json, math
from mathutils import Matrix

out, target, tex, rot = sys.argv[sys.argv.index("--") + 1:][:4]
target, tex, rot = int(target), int(tex), float(rot)

obj = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
bpy.context.view_layer.objects.active = obj
for o in bpy.context.scene.objects: o.select_set(o == obj)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
if tris > target:
    mod = obj.modifiers.new("Decimate", 'DECIMATE'); mod.ratio = target / tris
    bpy.ops.object.modifier_apply(modifier=mod.name)

obj.data.transform(Matrix.Rotation(math.radians(rot), 4, 'Z'))
obj.data.update()

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
with open(out + ".json", "w") as fh:
    json.dump({"out": out, "tris_before": tris, "tris_after": sum(len(p.vertices) - 2 for p in obj.data.polygons), "rot": rot}, fh)

sc = bpy.context.scene
cam_data = bpy.data.cameras.new("Top"); cam_data.type = 'ORTHO'; cam_data.ortho_scale = 2.0
cam = bpy.data.objects.new("Top", cam_data); sc.collection.objects.link(cam)
cam.location = (0, 0, 3); cam.rotation_euler = (0, 0, 0); sc.camera = cam
sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'FLAT'; sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x = sc.render.resolution_y = 1024
sc.render.filepath = out + ".top.png"
bpy.ops.render.render(write_still=True)
