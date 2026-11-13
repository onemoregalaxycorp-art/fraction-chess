# Diorama 8x8: take the Meshy swamp diorama (8x10 field), remove the two middle rows,
# make cells square and lay a real modelled 8x8 board of bevelled stone tiles on top.
# Run: blender -b swamp_chess_diorama.blend --python tools/make_board8.py -- out.glb [tris] [tex]
import bpy, bmesh, sys, json, random
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
out = args[0]
target = int(args[1]) if len(args) > 1 else 150000
tex = int(args[2]) if len(args) > 2 else 2048

# measured layout of the original diorama (Blender coords, Z up); rows 0..7 = game rows, -1 and 8 = extra
X0, CW, Y0, RH, ZS = -0.4434, 0.11036, -0.4676, 0.11841, -0.1286
CUT_A, CUT_B = Y0 + 3 * RH, Y0 + 5 * RH        # strip of 2 rows removed from the middle
SHIFT = CUT_B - CUT_A
FY0 = Y0 - RH                                    # new field: 8 rows starting at the old extra row
SY = CW / RH                                     # squash Y so the cells become square
def map_y(y):
    y = y if y < CUT_A else (CUT_A if y <= CUT_B else y - SHIFT)
    return FY0 + (y - FY0) * SY

dio = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
bpy.context.view_layer.objects.active = dio
for o in bpy.context.scene.objects: o.select_set(o == dio)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
dio.name = "Diorama"

tris = sum(len(p.vertices) - 2 for p in dio.data.polygons)
if tris > target:
    mod = dio.modifiers.new("Decimate", 'DECIMATE'); mod.ratio = target / tris
    bpy.ops.object.modifier_apply(modifier=mod.name)

for v in dio.data.vertices:
    v.co.y = map_y(v.co.y)
dio.data.update()

C = CW                                            # new square cell
FX0, FX1, FY1 = X0, X0 + 8 * C, FY0 + 8 * C
inset = 0.004
top_old = max((v.co.z for v in dio.data.vertices
               if FX0 + inset < v.co.x < FX1 - inset and FY0 + inset < v.co.y < FY1 - inset), default=ZS)
TOP = max(top_old, ZS) + 0.004
BOT = ZS - 0.03

for m in dio.data.materials:
    if not m or not m.use_nodes: continue
    for n in m.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image and n.image.size[0] > 0:
            to = [l.to_node.type for l in n.outputs[0].links]
            px = tex // 2 if 'SEPARATE_COLOR' in to else tex
            if n.image.size[0] > px: n.image.scale(px, px)

# ---------- stone textures (numpy noise) ----------
rng = np.random.default_rng(7)
def smooth_noise(n, cells):
    g = rng.random((cells + 1, cells + 1))
    xs = np.linspace(0, cells, n, endpoint=False)
    i = xs.astype(int); f = xs - i; f = f * f * (3 - 2 * f)
    a = g[np.ix_(i, i)]; b = g[np.ix_(i, i + 1)]; c = g[np.ix_(i + 1, i)]; d = g[np.ix_(i + 1, i + 1)]
    fx = f[None, :]; fy = f[:, None]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
def stone(n, base, moss, seedcells=(4, 9, 23, 61)):
    h = sum(smooth_noise(n, c) * w for c, w in zip(seedcells, (0.45, 0.28, 0.17, 0.10)))
    h = (h - h.min()) / (h.max() - h.min())
    grain = rng.random((n, n)) * 0.08                                     # fine stone grain
    m = np.clip((smooth_noise(n, 5) - 0.66) * 3, 0, 1) * 0.4             # light moss patches
    col = np.array(base)[None, None, :] * (0.82 + 0.3 * h[..., None] + grain[..., None])
    col = col * (1 - m[..., None]) + np.array(moss)[None, None, :] * m[..., None]
    rgba = np.ones((n, n, 4), np.float32); rgba[..., :3] = np.clip(col, 0, 1)
    return rgba
def make_image(name, rgba):
    n = rgba.shape[0]
    img = bpy.data.images.new(name, n, n, alpha=False)
    img.pixels.foreach_set(rgba.ravel()); img.pack(); return img
def make_mat(name, img, rough):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; bsdf = nt.nodes["Principled BSDF"]
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
    nt.links.new(t.outputs[0], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    return m

mat_light = make_mat("TileLight", make_image("tile_light", stone(1024, (0.50, 0.52, 0.47), (0.20, 0.27, 0.12))), 0.82)
mat_dark = make_mat("TileDark", make_image("tile_dark", stone(1024, (0.085, 0.09, 0.085), (0.06, 0.10, 0.04))), 0.7)
mat_grout = bpy.data.materials.new("Grout"); mat_grout.use_nodes = True
mat_grout.node_tree.nodes["Principled BSDF"].inputs['Base Color'].default_value = (0.012, 0.014, 0.012, 1)
mat_grout.node_tree.nodes["Principled BSDF"].inputs['Roughness'].default_value = 1.0

# ---------- tiles ----------
GAP = 0.0028
random.seed(3)
def tiles_object(name, parity, mat):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    for gy in range(8):
        for gx in range(8):
            if (gx + gy) % 2 != parity: continue
            cx, cy = FX0 + (gx + 0.5) * C, FY0 + (gy + 0.5) * C
            hw = C / 2 - GAP
            res = bmesh.ops.create_cube(bm, size=1.0)
            vs = res['verts']
            for v in vs:
                v.co = Vector((cx + v.co.x * 2 * hw, cy + v.co.y * 2 * hw, (BOT + TOP) / 2 + v.co.z * (TOP - BOT)))
            edges = list({e for v in vs for e in v.link_edges})
            bmesh.ops.bevel(bm, geom=vs + edges, offset=0.0045, segments=2, affect='EDGES', profile=0.5)
            # UVs stay inside [0,1]: the texture does not tile
            ox, oy, rot = random.uniform(0.25, 0.75), random.uniform(0.55, 0.75), random.random() < 0.5
            new = set(bm.faces) - tiles_object.seen
            for f in new:
                for l in f.loops:
                    p = l.vert.co
                    u, w = (p.x - cx) / C, (p.y - cy) / C
                    if abs(f.normal.x) > 0.5: u = (p.z - TOP) / C
                    if abs(f.normal.y) > 0.5: w = (p.z - TOP) / C
                    if rot: u, w = w, u
                    l[uv].uv = (ox + u * 0.42, oy + w * 0.42)
            tiles_object.seen |= new
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(name, me); ob.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(ob)
    return ob
tiles_object.seen = set()
t_dark = tiles_object("TilesDark", 0, mat_dark)        # a1 (gx=0, gy=0) is dark
tiles_object.seen = set()
t_light = tiles_object("TilesLight", 1, mat_light)

bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1.0)
for v in bm.verts:
    v.co = Vector(((FX0 + FX1) / 2 + v.co.x * (8 * C + 0.004), (FY0 + FY1) / 2 + v.co.y * (8 * C + 0.004),
                   (BOT + TOP - 0.006) / 2 + v.co.z * (TOP - 0.006 - BOT)))
me = bpy.data.meshes.new("Grout"); bm.to_mesh(me); bm.free()
grout = bpy.data.objects.new("Grout", me); grout.data.materials.append(mat_grout)
bpy.context.scene.collection.objects.link(grout)

for o in bpy.context.scene.objects: o.select_set(o in (dio, t_dark, t_light, grout))
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True,
                          export_image_format='JPEG', export_jpeg_quality=85,
                          export_apply=True, export_yup=True)

res = {"out": out, "X0": FX0, "CW": C, "Y0": FY0, "RH": C, "ZS": TOP, "top_old": top_old,
       "map": {"cutA": CUT_A, "cutB": CUT_B, "shift": SHIFT, "fy0": FY0, "sy": SY},
       "candles": [[-0.371, map_y(0.697)], [0.367, map_y(0.703)]],
       "tris": sum(len(p.vertices) - 2 for p in dio.data.polygons)}
with open(out + ".json", "w") as fh: json.dump(res, fh, indent=1)

# top preview for checking
cam_data = bpy.data.cameras.new("Top"); cam_data.type = 'ORTHO'; cam_data.ortho_scale = 1.6
cam = bpy.data.objects.new("Top", cam_data); bpy.context.scene.collection.objects.link(cam)
cam.location = ((FX0 + FX1) / 2, (FY0 + FY1) / 2, 3); bpy.context.scene.camera = cam
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x = sc.render.resolution_y = 1024
sc.render.filepath = out + ".top.png"
bpy.ops.render.render(write_still=True)
