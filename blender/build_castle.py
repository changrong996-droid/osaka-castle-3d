# Osaka Castle — whole-site build (v1): terrain from OSM, moats, surviving structures, Toyotomi-style tenshu.
# Run: Blender -b --python blender/build_castle.py   (repo root = ~/Hark/osaka-castle-3d)
import bpy, json, os, math, random
from mathutils import Vector
from mathutils.geometry import tessellate_polygon

ROOT = os.path.expanduser(os.environ.get("CASTLE_ROOT", "~/Hark/osaka-castle-3d"))
OUT = os.path.join(ROOT, "out"); os.makedirs(OUT, exist_ok=True)
TER = json.load(open(os.path.join(ROOT, "data", "terrain.json")))
E = TER["elev"]; WZ = E["water"] + 1.0  # water surface; land walls go down to E['water']

# ---------- clean ----------
for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras):
    for b in list(coll):
        if b.users == 0: coll.remove(b)

# ---------- tenshu (reuse its geometry kit) ----------
K = {"TENSHU_ONLY": True, "__name__": "tenshu"}
exec(open(os.path.join(ROOT, "tenshu", "build_tenshu.py")).read(), K)
ACC, MATS = K["ACC"], K["MATS"]
box, tube, skirt, sphere, cyl, add_geo, quad = K["box"], K["tube"], K["skirt"], K["sphere"], K["cyl"], K["add_geo"], K["quad"]
# r3: procedural ishigaki block texture (render only; GLB keeps flat colour)
try:
    _m = MATS["stone"]; _nt = _m.node_tree
    _b = next(n for n in _nt.nodes if n.type == 'BSDF_PRINCIPLED')
    _br = _nt.nodes.new('ShaderNodeTexBrick')
    _br.inputs["Color1"].default_value = (0.36, 0.33, 0.29, 1); _br.inputs["Color2"].default_value = (0.22, 0.20, 0.18, 1)
    _br.inputs["Mortar"].default_value = (0.08, 0.075, 0.07, 1); _br.inputs["Scale"].default_value = 0.6
    _br.inputs["Mortar Size"].default_value = 0.02; _br.inputs["Brick Width"].default_value = 1.6; _br.inputs["Row Height"].default_value = 0.8
    _co = _nt.nodes.new('ShaderNodeTexCoord'); _mp = _nt.nodes.new('ShaderNodeMapping')
    _nt.links.new(_co.outputs["Object"], _mp.inputs["Vector"]); _nt.links.new(_mp.outputs[0], _br.inputs["Vector"])
    _nt.links.new(_br.outputs["Color"], _b.inputs["Base Color"])
except Exception as e: print("stone tex skipped", e)
MATS["city"] = K["mat"]("CityGround", (0.32, 0.31, 0.29), 0.0, 0.95)
MATS["earth"] = K["mat"]("DryMoatEarth", (0.38, 0.27, 0.16), 0.0, 0.95)
MATS["wood"] = K["mat"]("Wood", (0.16, 0.09, 0.05), 0.0, 0.7)
MATS["iron"] = K["mat"]("BlackIron", (0.02, 0.02, 0.022), 0.6, 0.45)

def snapshot(): return {k: len(v[0]) for k, v in ACC.items()}
def xform_since(snap, cx, cy, cz, ang):
    c, s = math.cos(ang), math.sin(ang)
    for k, (V, F) in ACC.items():
        for i in range(snap.get(k, 0), len(V)):
            x, y, z = V[i]; V[i] = (cx + x * c - y * s, cy + x * s + y * c, cz + z)

tb = next(b for b in TER["buildings"] if b["type"] == "tenshu")
xform_since({}, tb["cx"], tb["cy"], tb["z"], tb["ang"] - math.pi / 2)

# ---------- terrain ----------
quad("water", (-900, -900, WZ), (900, -900, WZ), (900, 900, WZ), (-900, 900, WZ))
TOP = {"honmaru": "gravel", "ninomaru": "grass", "dry": "earth", "city": "city"}
for r in TER["regions"]:
    z, zb = r["z"], E["water"]
    rings = [r["outer"]] + r["holes"]
    pts = [Vector((x, y, z)) for ring in rings for x, y in ring]
    tris = tessellate_polygon([[Vector((x, y, z)) for x, y in ring] for ring in rings])
    add_geo(TOP[r["name"]], [tuple(p) for p in pts], [tuple(t[::-1]) if False else tuple(t) for t in tris])
    for ri, ring in enumerate(rings):
        n = len(ring); vs, fs = [], []
        area = sum(ring[i][0] * ring[(i + 1) % n][1] - ring[(i + 1) % n][0] * ring[i][1] for i in range(n))
        sg = (1 if area > 0 else -1) * (1 if ri == 0 else -1)  # +: outward = right of travel
        bat = min(0.22 * (z - zb), 6.0) if z > zb + 3 else 0.0   # ishigaki batter (fan slope)
        for i, (x, y) in enumerate(ring):
            px, py = ring[i - 1]; nx_, ny_ = ring[(i + 1) % n]
            tx, ty = nx_ - px, ny_ - py; L = math.hypot(tx, ty) or 1
            ox, oy = sg * ty / L, -sg * tx / L
            vs += [(x, y, z), (x + ox * bat, y + oy * bat, zb)]
        for i in range(n):
            j = (i + 1) % n; fs.append((2 * i, 2 * i + 1, 2 * j + 1, 2 * j))
        add_geo("stone", vs, fs)

# ---------- building kit (local coords: x along length w, y along depth d, z up) ----------
def windows(w, d, z0, h, nx, ny, size=(1.1, 0.9)):
    for side in (-1, 1):
        for i in range(nx):
            box("window", (-w / 2 + w * (i + .5) / nx, side * (d / 2 + .02), z0 + h * .55), (size[0], .1, size[1]))
        for i in range(ny):
            box("window", (side * (w / 2 + .02), -d / 2 + d * (i + .5) / ny, z0 + h * .55), (.1, size[0], size[1]))

def hip_roof(w, d, z0, ov, rise, up=0.6, top=(0.45, 0.12)):
    K["roof"](z0, w + 2 * ov, d + 2 * ov, w * top[0], d * top[1], rise, up)
    rl = w * top[0] + .4
    box("ridge", (0, 0, z0 + rise + .25), (rl, .5, .5))
    for sx in (-1, 1): sphere("ridge", (sx * rl / 2, 0, z0 + rise + .6), .45, (0.6, 0.5, 1.2))

def yagura2(b):
    w, d = b["w"] * .92, b["d"] * .92
    box("plaster", (0, 0, 3.4), (w, d, 6.8)); box("lacquer", (0, 0, .6), (w + .04, d + .04, 1.2))
    windows(w, d, 1.2, 5, max(2, int(w / 4)), max(2, int(d / 4)))
    K["roof"](6.5, w + 3.2, d + 3.2, w * .72, d * .72, 2.2, 0.6)
    w2, d2 = w * .72, d * .72
    box("plaster", (0, 0, 8.5 + 2.3), (w2, d2, 4.6))
    windows(w2, d2, 8.6, 3.6, max(2, int(w2 / 4)), max(2, int(d2 / 4)), (0.9, 0.8))
    hip_roof(w2, d2, 12.9, 1.6, 2.8)

def yaguramon(b):
    w, d = b["w"] * .95, b["d"] * .9
    box("stone", (0, 0, 2.5), (w, d, 5)); box("iron", (0, -d / 2 - .05, 2.2), (5.5, .2, 4.4))
    box("plaster", (0, 0, 7.5), (w, d, 5)); windows(w, d, 5, 4, max(2, int(w / 4)), 2)
    hip_roof(w, d, 9.7, 1.8, 2.8, 0.7)
    # r9: masugata court in front (-y): side stone walls + plaster parapet + outer gate
    L = 20.0; y1 = -d / 2 - L
    for sx in (-1, 1):
        box("stone", (sx * (w / 2 - .6), (-d / 2 + y1) / 2, 2.0), (1.2, L, 4)); box("plaster", (sx * (w / 2 - .6), (-d / 2 + y1) / 2, 4.9), (1.0, L, 1.8))
    box("stone", (0, y1, 2.0), (w, 1.2, 4)); box("plaster", (-w * .3, y1, 4.9), (w * .4, 1.0, 1.8)); box("plaster", (w * .3, y1, 4.9), (w * .4, 1.0, 1.8))
    box("iron", (0, y1, 2.6), (5, 1.3, 5.2)); box("plaster", (0, y1, 6.2), (6.5, 3.0, 1.8))
    hip_roof(6.5, 3.0, 7.0, 1.0, 1.6, 0.5)

def gate(b):
    if b["w"] > 15: return yaguramon(b)
    w, d = b["w"], b["d"]
    for sx in (-1, 1):
        box("iron", (sx * w * .36, 0, 3), (.9, .9, 6)); box("iron", (sx * w * .36, d * .4, 2.2), (.5, .5, 4.4))
    box("iron", (0, 0, 5.4), (w * .9, .7, .7))
    for sx in (-1, 1): box("iron", (sx * w * .17, -.1, 2.6), (w * .32, .22, 5))
    gw = w * .95; gz = 6.0
    quad("tile", (-gw / 2, -1.6, gz), (gw / 2, -1.6, gz), (gw / 2, 0, gz + 1.4), (-gw / 2, 0, gz + 1.4))
    quad("tile", (gw / 2, 1.6, gz), (-gw / 2, 1.6, gz), (-gw / 2, 0, gz + 1.4), (gw / 2, 0, gz + 1.4))
    box("ridge", (0, 0, gz + 1.5), (gw + .3, .4, .35))
    # gatehouse walls (masugata) hint: two short plaster walls
    for sx in (-1, 1): box("plaster", (sx * (w / 2 + 4), 0, 1.8), (8, .8, 3.6))

def kura(b):
    w, d = b["w"] * .95, b["d"] * .9
    box("plaster", (0, 0, 2.6), (w, d, 5.2)); box("stone" if b["name"] == "焔硝蔵" else "lacquer", (0, 0, .7), (w + .1, d + .1, 1.4))
    rz, rh, ov = 5.2, d * .35, 1.0
    quad("tile", (-w / 2 - ov, -d / 2 - ov, rz - .3), (w / 2 + ov, -d / 2 - ov, rz - .3), (w / 2 + ov, 0, rz + rh), (-w / 2 - ov, 0, rz + rh))
    quad("tile", (w / 2 + ov, d / 2 + ov, rz - .3), (-w / 2 - ov, d / 2 + ov, rz - .3), (-w / 2 - ov, 0, rz + rh), (w / 2 + ov, 0, rz + rh))
    for sx in (-1, 1): K["tri"]("plaster", (sx * w / 2, -d / 2, rz), (sx * w / 2, d / 2, rz), (sx * w / 2, 0, rz + rh - .1))
    box("ridge", (0, 0, rz + rh + .15), (w + 2 * ov + .2, .5, .4))

def hall(b):
    w, d = b["w"] * .85, b["d"] * .8
    box("wood", (0, 0, 2.5), (w, d, 5)); box("stone", (0, 0, .4), (w + 1.5, d + 1.5, .8))
    hip_roof(w, d, 4.8, 2.2, d * .35, 0.5, (0.55, 0.1))

def pavilion(b):
    w, d = b["w"] * .7, b["d"] * .7
    for sx in (-1, 1):
        for sy in (-1, 1): box("wood", (sx * w / 2, sy * d / 2, 1.5), (.3, .3, 3))
    cyl("stone", (0, 0, 0), 1.2, 1.2, 0.9)
    hip_roof(w, d, 3, 0.9, 1.6, 0.3, (0.2, 0.2))

def tamon(b):
    # footprint polygons are in world coords: build directly (no xform)
    z = b["z"]; fp, rf, rf2 = b["fp"], b["roof"], b["roof2"]
    def prism(poly, z0, z1, mside, mtop):
        vt = [Vector((x, y, z1)) for x, y in poly]
        add_geo(mtop, [tuple(v) for v in vt], [tuple(t) for t in tessellate_polygon([vt])])
        n = len(poly); vs, fs = [], []
        for x, y in poly: vs += [(x, y, z1), (x, y, z0)]
        for i in range(n):
            j = (i + 1) % n; fs.append((2 * i, 2 * j, 2 * j + 1, 2 * i + 1))
        add_geo(mside, vs, fs)
    prism(fp, z, z + 1.2, "lacquer", "lacquer"); prism(fp, z + 1.2, z + 5.5, "plaster", "plaster")
    prism(rf, z + 5.2, z + 5.8, "ridge", "tile")
    if rf2: prism(rf2, z + 5.8, z + 7.6, "tile", "ridge")

KIT = dict(yagura2=yagura2, gate=gate, kura=kura, hall=hall, pavilion=pavilion)
for b in TER["buildings"]:
    if b["type"] == "tenshu": continue
    if b["type"] == "tamon": tamon(b); continue
    s = snapshot(); KIT[b["type"]](b); xform_since(s, b["cx"], b["cy"], b["z"], b["ang"])

# ---------- trees ----------
def inside(x, y, ring):
    c = False; n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]; x2, y2 = ring[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-9) + x1: c = not c
    return c
# ---------- 土桥/坡道：樱门前，本丸南缘(z14)经干堀(z-3)降到二之丸(z4) ----------
def earth_ramp(x, y0, y1, z0, z1, width, steps=8):
    for i in range(steps):
        t = (i + 0.5) / steps; yy = y0 + (y1 - y0) * (i + 0.5) / steps; zt = z0 + (z1 - z0) * t
        ln = abs(y1 - y0) / steps + 0.05
        box("earth", (x, yy, (zt - 3.5) / 2), (width, ln, zt + 3.5))
earth_ramp(-14, -242, -272, 14.0, 4.0, 10)
random.seed(3)
blds = [(b["cx"], b["cy"], max(b["w"], b["d"]) / 2 + 6) for b in TER["buildings"]]
def free(x, y): return all((x - bx) ** 2 + (y - by) ** 2 > r * r for bx, by, r in blds)
def tree(x, y, z, s):
    cyl("bark", (x, y, z), .35 * s, .2 * s, 5 * s, 6)
    for k in range(3):
        sphere("pine", (x + random.uniform(-1, 1) * s, y + random.uniform(-1, 1) * s, z + (3.8 + k * 1.1) * s), random.uniform(1.6, 2.4) * s, (1, 1, .45), 7, 5)
for r in TER["regions"]:
    if r["name"] == "city": continue
    xs = [p[0] for p in r["outer"]]; ys = [p[1] for p in r["outer"]]
    n = 380 if r["name"] == "ninomaru" and r["area"] > 100000 else (60 if r["name"] == "honmaru" else 25)
    placed = 0; tries = 0
    while placed < n and tries < n * 60:
        tries += 1
        x, y = random.uniform(min(xs), max(xs)), random.uniform(min(ys), max(ys))
        if inside(x, y, r["outer"]) and not any(inside(x, y, h) for h in r["holes"]) and free(x, y):
            # keep away from edges a bit: test 4 neighbours
            if math.sin(x*0.011+1.3)*math.cos(y*0.013+0.7)+0.5*math.sin((x+y)*0.02) < 0.15: continue  # 林地成簇，其余留作开阔草坪
            if all(inside(x + dx, y + dy, r["outer"]) for dx, dy in ((8, 0), (-8, 0), (0, 8), (0, -8))):
                tree(x, y, r["z"], random.uniform(0.8, 1.3)); placed += 1

# ---------- objects ----------
coll = K["build_objects"]("OsakaCastleSite")
sun = bpy.data.lights.new("Sun", "SUN"); sun.energy = 4.0; sun.angle = 0.02
so = bpy.data.objects.new("Sun", sun); so.rotation_euler = (math.radians(50), 0, math.radians(-40)); coll.objects.link(so)
w = bpy.context.scene.world or bpy.data.worlds.new("World"); bpy.context.scene.world = w; w.use_nodes = True
bg = next((n for n in w.node_tree.nodes if n.type == 'BACKGROUND'), None)
bg.inputs[0].default_value = (0.55, 0.68, 0.85, 1); bg.inputs[1].default_value = 0.8
cam = bpy.data.cameras.new("Cam"); cam.lens = 30; cam.clip_end = 5000
co = bpy.data.objects.new("Cam", cam); coll.objects.link(co)
co.location = (-520, -640, 380)
co.rotation_euler = (Vector((-30, -40, 0)) - co.location).to_track_quat('-Z', 'Y').to_euler()
sc = bpy.context.scene; sc.camera = co
sc.render.resolution_x, sc.render.resolution_y = 1600, 1000
sc.render.filepath = os.path.join(OUT, "site_preview.png")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "osaka_castle_site.blend"))
bpy.ops.render.render(write_still=True)
# ---------- fixed feedback views (same every round, so renders are comparable) ----------
VIEWS = {  # name: (camera location, look-at target, lens)
    "aerial":   ((-520, -640, 380), (-30, -40, 0), 30),
    "top":      ((0, -60, 1500), (0, -59, 0), 32),
    "otemon":   ((-330, -300, 12), (-240, -240, 8), 24),
    "tenshu":   ((40, -150, 22), (0, 0, 40), 28),
    "eastwall": ((172, -70, -3), (115, 40, 10), 22),
}
VD = os.path.join(OUT, "views"); os.makedirs(VD, exist_ok=True)
sc.render.resolution_x, sc.render.resolution_y = 1280, 800
for name, (loc, tgt, lens) in VIEWS.items():
    co.location = loc; cam.lens = lens
    co.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(VD, name + ".png")
    bpy.ops.render.render(write_still=True)
co.location = VIEWS["aerial"][0]; cam.lens = 30
co.rotation_euler = (Vector(VIEWS["aerial"][1]) - co.location).to_track_quat('-Z', 'Y').to_euler()
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "osaka_castle_site.glb"), export_format='GLB', export_lights=False, export_cameras=False)
print("CASTLE_OK", sum(len(v[0]) for v in ACC.values()), "verts")
