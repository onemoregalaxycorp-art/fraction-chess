# Ищем плоскую игровую область диорамы: высота поверхности по линиям через центр + ортографический рендер сверху.
# Запуск: blender -b diorama.blend --python tools/board_probe.py -- out.png
import bpy, sys, json
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1:][0]
sc = bpy.context.scene
dg = bpy.context.evaluated_depsgraph_get()

def z_at(x, y):
    hit, loc, *_ = sc.ray_cast(dg, Vector((x, y, 5)), Vector((0, 0, -1)))
    return round(loc.z, 4) if hit else None

step = 0.005
xs = [round(-0.7 + i * step, 4) for i in range(int(1.4 / step) + 1)]
ys = [round(-0.9 + i * step, 4) for i in range(int(1.85 / step) + 1)]
res = {"row_y0": [[x, z_at(x, 0.0)] for x in xs], "col_x0": [[y, z_at(0.0, y)] for y in ys],
       "center": z_at(0, 0)}
with open(out + ".json", "w") as fh: json.dump(res, fh)

cam_data = bpy.data.cameras.new("Top"); cam_data.type = 'ORTHO'; cam_data.ortho_scale = 2.0
cam = bpy.data.objects.new("Top", cam_data); sc.collection.objects.link(cam)
cam.location = (0, 0, 3); cam.rotation_euler = (0, 0, 0); sc.camera = cam
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'FLAT'
sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x = sc.render.resolution_y = 1024
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
