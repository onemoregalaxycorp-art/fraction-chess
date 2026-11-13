# Быстрый рендер-превью модели (Workbench, цвет из текстуры) + какие текстуры куда подключены.
# Запуск: blender -b файл.blend --python tools/preview_blend.py -- out.png [top]
import bpy, sys, math, json
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
out, top = args[0], (len(args) > 1 and args[1] == "top")

# какие картинки к каким входам материала
links = []
for m in bpy.data.materials:
    if not m.use_nodes: continue
    for l in m.node_tree.links:
        if l.from_node.type == 'TEX_IMAGE' and l.from_node.image:
            links.append([l.from_node.image.name, l.to_node.type, l.to_socket.name])
print("@@LINKS@@" + json.dumps(links))

sc = bpy.context.scene
obj = [o for o in sc.objects if o.type == 'MESH'][0]
pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
center = sum(pts, Vector()) / 8
size = max((max(p[i] for p in pts) - min(p[i] for p in pts)) for i in range(3))

cam_data = bpy.data.cameras.new("PrevCam")
cam = bpy.data.objects.new("PrevCam", cam_data)
sc.collection.objects.link(cam)
if top:
    cam.location = center + Vector((0, -0.0001, size * 1.6))
else:
    cam.location = center + Vector((0, -size * 1.7, size * 0.35))       # смотрим с -Y (спереди)
d = center - cam.location
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
sc.camera = cam

sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x = 512
sc.render.resolution_y = 512
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
