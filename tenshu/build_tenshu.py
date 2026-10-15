# Blender script: Toyotomi-era Osaka Castle tenshu (1585), procedural reconstruction-style model
import bpy, math, os
from mathutils import Vector, Matrix

OUT = os.path.expanduser("~/Hark/osaka")
os.makedirs(OUT, exist_ok=True)

TONLY = globals().get('TENSHU_ONLY', False)
if not TONLY:
    # ---------- clean scene ----------
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.curves, bpy.data.lights, bpy.data.cameras):
        for b in list(coll):
            if b.users == 0:
                coll.remove(b)

# ---------- materials ----------
def mat(name, rgb, metal=0.0, rough=0.5):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree
    b = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if b is None:
        b = nt.nodes.new('ShaderNodeBsdfPrincipled')
        outn = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None) or nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(b.outputs[0], outn.inputs[0])
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    return m
MATS = {
    "lacquer": mat("BlackLacquer", (0.012, 0.011, 0.013), 0.0, 0.25),
    "tile":    mat("RoofTile", (0.035, 0.04, 0.05), 0.2, 0.45),
    "soffit":  mat("Soffit", (0.03, 0.02, 0.015), 0.0, 0.8),
    "gold":    mat("Gold", (1.0, 0.70, 0.22), 1.0, 0.22),
    "ridge":   mat("Ridge", (0.02, 0.022, 0.026), 0.2, 0.5),
    "stone":   mat("Stone", (0.30, 0.28, 0.25), 0.0, 0.95),
    "window":  mat("WindowDark", (0.003, 0.003, 0.004), 0.0, 0.6),
    "frame":   mat("WindowFrame", (0.05, 0.045, 0.04), 0.0, 0.5),
    "plaster": mat("Plaster", (0.85, 0.82, 0.75), 0.0, 0.9),
    "gravel":  mat("Gravel", (0.50, 0.47, 0.41), 0.0, 1.0),
    "grass":   mat("Grass", (0.12, 0.17, 0.07), 0.0, 1.0),
    "water":   mat("Water", (0.02, 0.07, 0.08), 0.3, 0.05),
    "pine":    mat("Pine", (0.03, 0.09, 0.04), 0.0, 0.9),
    "bark":    mat("Bark", (0.10, 0.06, 0.04), 0.0, 1.0),
}

# geometry accumulators per (material, smooth)
ACC = {}
def acc(m, smooth=False):
    k = (m, smooth)
    if k not in ACC: ACC[k] = ([], [])
    return ACC[k]
def add_geo(m, verts, faces, smooth=False):
    V, F = acc(m, smooth); o = len(V)
    V.extend(verts); F.extend([tuple(i + o for i in f) for f in faces])

def box(m, c, s, rz=0.0):
    cx, cy, cz = c; sx, sy, sz = s[0] / 2, s[1] / 2, s[2] / 2
    cs, sn = math.cos(rz), math.sin(rz)
    vs = []
    for dz in (-sz, sz):
        for dx, dy in ((-sx, -sy), (sx, -sy), (sx, sy), (-sx, sy)):
            vs.append((cx + dx * cs - dy * sn, cy + dx * sn + dy * cs, cz + dz))
    add_geo(m, vs, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])

def sphere(m, c, r, scale=(1, 1, 1), seg=12, rings=8):
    vs, fs = [], []
    for j in range(rings + 1):
        th = math.pi * j / rings
        for i in range(seg):
            ph = 2 * math.pi * i / seg
            vs.append((c[0] + r * scale[0] * math.sin(th) * math.cos(ph),
                       c[1] + r * scale[1] * math.sin(th) * math.sin(ph),
                       c[2] + r * scale[2] * math.cos(th)))
    for j in range(rings):
        for i in range(seg):
            a = j * seg + i; b = j * seg + (i + 1) % seg
            fs.append((a, b, b + seg, a + seg))
    add_geo(m, vs, fs, True)

def cone(m, base, r, h, seg=8, tilt=(0, 0)):
    vs = [(base[0] + tilt[0] * h, base[1] + tilt[1] * h, base[2] + h)]
    for i in range(seg):
        a = 2 * math.pi * i / seg
        vs.append((base[0] + r * math.cos(a), base[1] + r * math.sin(a), base[2]))
    fs = [(0, 1 + i, 1 + (i + 1) % seg) for i in range(seg)] + [tuple(range(seg, 0, -1))]
    add_geo(m, vs, fs, True)

def cyl(m, base, r0, r1, h, seg=10):
    vs = []
    for z, r in ((0, r0), (h, r1)):
        for i in range(seg):
            a = 2 * math.pi * i / seg
            vs.append((base[0] + r * math.cos(a), base[1] + r * math.sin(a), base[2] + z))
    fs = [(i, (i + 1) % seg, seg + (i + 1) % seg, seg + i) for i in range(seg)]
    fs += [tuple(range(seg - 1, -1, -1)), tuple(range(seg, 2 * seg))]
    add_geo(m, vs, fs, True)

def tube(m, pts, r, closed=False, seg=8):
    pts = [Vector(p) for p in pts]
    n = len(pts); vs, fs = [], []
    up = Vector((0, 0, 1))
    for i, p in enumerate(pts):
        if closed:
            t = (pts[(i + 1) % n] - pts[i - 1])
        else:
            t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        t.normalize()
        ref = up if abs(t.dot(up)) < 0.9 else Vector((1, 0, 0))
        nx = t.cross(ref).normalized(); ny = t.cross(nx).normalized()
        for k in range(seg):
            a = 2 * math.pi * k / seg
            vs.append(tuple(p + r * (math.cos(a) * nx + math.sin(a) * ny)))
    rng = n if closed else n - 1
    for i in range(rng):
        j = (i + 1) % n
        for k in range(seg):
            k2 = (k + 1) % seg
            fs.append((i * seg + k, i * seg + k2, j * seg + k2, j * seg + k))
    add_geo(m, vs, fs, True)

def quad(m, a, b, c, d, smooth=False):
    add_geo(m, [a, b, c, d], [(0, 1, 2, 3)], smooth)
def tri(m, a, b, c):
    add_geo(m, [a, b, c], [(0, 1, 2)])

# ---------- curved roof skirt ----------
def corners(w, d):
    return [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]  # CCW from top

def skirt_point(O, I, rise, s, u, t, pw, up):
    a, b, c, e = O[s], O[(s + 1) % 4], I[s], I[(s + 1) % 4]
    ox, oy = a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u
    ix, iy = c[0] + (e[0] - c[0]) * u, c[1] + (e[1] - c[1]) * u
    corner = abs(2 * u - 1) ** 5
    z = rise * t ** pw + up * (1 - t) ** 2 * corner
    fl = up * 0.35 * (1 - t) ** 2 * corner
    sx = (ox > 0) - (ox < 0); sy = (oy > 0) - (oy < 0)
    return (ox + (ix - ox) * t + sx * fl, oy + (iy - oy) * t + sy * fl, z)

def skirt(m, ow, od, iw, idp, rise, z0, up=0.0, pw=1.45, su=36, st=14, smooth=True):
    O, I = corners(ow, od), corners(iw, idp)
    P = lambda s, u, t: (lambda p: (p[0], p[1], p[2] + z0))(skirt_point(O, I, rise, s, u, t, pw, up))
    vs, fs = [], []
    for s in range(4):
        base = len(vs)
        for j in range(st + 1):
            for i in range(su + 1):
                vs.append(P(s, i / su, j / st))
        for j in range(st):
            for i in range(su):
                a = base + j * (su + 1) + i
                fs.append((a, a + 1, a + su + 2, a + su + 1))
    add_geo(m, vs, fs, smooth)
    return P

def roof(z0, ow, od, iw, idp, rise, up):
    P = skirt("tile", ow, od, iw, idp, rise, z0, up)
    skirt("soffit", ow - 0.25, od - 0.25, iw, idp, rise - 0.35, z0 - 0.35, up)
    eave = [P(s, i / 36, 0) for s in range(4) for i in range(36)]
    tube("gold", eave, 0.2, closed=True)
    for s in range(4):
        tube("ridge", [P(s, 0, j / 14) for j in range(15)], 0.22)
        sphere("gold", P(s, 0, 0), 0.34)
    return P

def chidori(cx, cy, cz, rot, W, H, L):
    # gable facing local -y (outward) ; rot rotates around z
    cs, sn = math.cos(rot), math.sin(rot)
    T = lambda x, y, z: (cx + x * cs - y * sn, cy + x * sn + y * cs, cz + z)
    f, ov = 0.5, 0.6
    tri("lacquer", T(-W / 2, 0, 0), T(W / 2, 0, 0), T(0, 0, H))
    # gold gegyo ornament
    sphere("gold", T(0, -0.08, H * 0.62), 0.45, (1, 0.25, 1.2))
    lowL, lowR = (-W / 2 - ov, -f, -0.35), (W / 2 + ov, -f, -0.35)
    apF, apB = (0, -f, H + 0.25), (0, L, H + 0.25)
    quad("tile", T(*lowL), T(-W / 2 - ov, L, -0.35), T(*apB), T(*apF))
    quad("tile", T(*apF), T(*apB), T(W / 2 + ov, L, -0.35), T(*lowR))
    tube("gold", [T(*lowL), T(-W / 4, -f - 0.05, H / 2), T(0, -f - 0.05, H + 0.15)], 0.16)
    tube("gold", [T(0, -f - 0.05, H + 0.15), T(W / 4, -f - 0.05, H / 2), T(*lowR)], 0.16)
    tube("ridge", [T(0, -f - 0.1, H + 0.3), T(0, L, H + 0.3)], 0.2)

def karahafu(cx, cy, cz, rot, W, H, L):
    cs, sn = math.cos(rot), math.sin(rot)
    T = lambda x, y, z: (cx + x * cs - y * sn, cy + x * sn + y * cs, cz + z)
    def prof(s):
        a = abs(s)
        return H * (1 - a * a) * (0.75 + 0.25 * math.cos(a * math.pi)) + (max(0, a - 0.85) * 2)
    N = 30
    vs = [T(s * (W / 2 + 0.5), y, prof(s)) for y in (-0.6, L) for s in [-1 + 2 * i / N for i in range(N + 1)]]
    fs = [(i, i + 1, i + N + 2, i + N + 1) for i in range(N)]
    add_geo("tile", vs, fs, True)
    tube("gold", [T(s * (W / 2 + 0.5), -0.62, prof(s) - 0.08) for s in [-1 + 2 * i / N for i in range(N + 1)]], 0.2)
    face = [T(-W / 2, -0.2, -0.4)] + [T(s * W / 2, -0.2, prof(s) - 0.15) for s in [-1 + 2 * i / N for i in range(N + 1)]] + [T(W / 2, -0.2, -0.4)]
    add_geo("lacquer", face, [tuple(range(len(face)))])
    sphere("gold", T(0, -0.3, H * 0.45), 0.35, (1.4, 0.3, 0.8))

def shachi(x, y, z, flip):
    sphere("gold", (x, y, z), 0.55, (0.9, 0.7, 1.5))
    sphere("gold", (x - flip * 0.35, y, z + 0.2), 0.42, (1.3, 0.8, 1.0))
    cone("gold", (x + flip * 0.3, y, z + 0.6), 0.4, 1.3, 4, (flip * 0.4, 0))
    cone("gold", (x + flip * 0.65, y, z + 1.6), 0.28, 0.7, 4, (flip * 0.9, 0))

def windows_on_face(cx, cy, z0, h, length, normal_rot, n, top=False):
    # face centred at (cx,cy), outward direction given by normal_rot (angle of outward normal)
    nx, ny = math.cos(normal_rot), math.sin(normal_rot)
    tx, ty = -ny, nx
    gap = length / n
    for i in range(n):
        off = -length / 2 + gap * (i + 0.5)
        px, py = cx + tx * off + nx * 0.05, cy + ty * off + ny * 0.05
        ww, wh = gap * (0.5 if top else 0.42), h * (0.5 if top else 0.42)
        zc = z0 + h * 0.55
        box("frame", (px, py, zc), (ww + 0.3, 0.12, wh + 0.3), normal_rot - math.pi / 2)
        box("window", (px + nx * 0.05, py + ny * 0.05, zc), (ww, 0.06, wh), normal_rot - math.pi / 2)
        nb = max(4, int(ww / 0.35))
        for k in range(1, nb):
            o2 = -ww / 2 + k * ww / nb
            box("frame", (px + tx * o2 + nx * 0.1, py + ty * o2 + ny * 0.1, zc), (0.08, 0.06, wh), normal_rot - math.pi / 2)
        for sx in (-1, 1):
            for sz in (-1, 1):
                box("gold", (px + tx * sx * (ww / 2 + 0.15) + nx * 0.1, py + ty * sx * (ww / 2 + 0.15) + ny * 0.1, zc + sz * (wh / 2 + 0.15)), (0.18, 0.05, 0.18), normal_rot - math.pi / 2)
    if top:  # gold painted panels (cranes & tigers) between windows
        for i in range(n + 1):
            off = -length / 2 + gap * i
            if abs(off) > length / 2 - 0.3: continue
            px, py = cx + tx * off + nx * 0.06, cy + ty * off + ny * 0.06
            box("gold", (px, py, z0 + h * 0.55), (gap * 0.38, 0.05, h * 0.55), normal_rot - math.pi / 2)

ISL = 0.0
if not TONLY:
    # ---------- terrain ----------
    ISL = 2.0
    quad("water", (-600, -600, -6), (600, -600, -6), (600, 600, -6), (-600, 600, -6))
    # outer land ring (as 4 quads around a 190 hole)
    H_ = 95; Rr = 600
    for a, b, c, d in [((-Rr, -Rr), (Rr, -Rr), (H_, -H_), (-H_, -H_)), ((Rr, -Rr), (Rr, Rr), (H_, H_), (H_, -H_)),
                       ((Rr, Rr), (-Rr, Rr), (-H_, H_), (H_, H_)), ((-Rr, Rr), (-Rr, -Rr), (-H_, -H_), (-H_, H_))]:
        quad("grass", (*a, 0), (*b, 0), (*c, 0), (*d, 0))
    skirt("stone", 190, 190, 190, 190, 6, -6, 0, 1, 8, 2, False)
    skirt("stone", 132, 132, 120, 120, 8, -6, 0, 1.6, 12, 6, False)
    quad("gravel", (-60, -60, ISL), (60, -60, ISL), (60, 60, ISL), (-60, 60, ISL))
    for k in range(4):
        r = k * math.pi / 2; cs, sn = math.cos(r), math.sin(r)
        def R(x, y): return (x * cs - y * sn, x * sn + y * cs)
        box("plaster", (*R(0, -59), ISL + 1.1), (118, 0.6, 2.2), r)
        box("lacquer", (*R(0, -59), ISL + 0.35), (118, 0.66, 0.7), r)
        box("ridge", (*R(0, -59), ISL + 2.4), (119, 1.6, 0.35), r)

BASE_H = 13
skirt("stone", 40, 36, 30, 26, BASE_H, ISL, 0, 1.7, 24, 16, False)
box("stone", (0, 0, ISL + BASE_H), (30.2, 26.2, 0.6))

# ---------- tiers ----------
tiers = [
    dict(w=28, d=24, v=8.0, ov=3.4, rise=4.2, up=1.3, win=7),
    dict(w=23, d=19.5, v=4.6, ov=3.0, rise=3.8, up=1.2, win=6),
    dict(w=19, d=16, v=4.3, ov=2.8, rise=3.4, up=1.1, win=5),
    dict(w=15.5, d=13, v=4.0, ov=2.6, rise=3.0, up=1.0, win=4),
    dict(w=12, d=10, v=5.2, ov=2.6, rise=2.8, up=1.0, win=3, top=True),
]
z = ISL + BASE_H + 0.3
prev_rise = 0
roofs = []
for i, t in enumerate(tiers):
    h = t["v"] + prev_rise + 0.4
    zb = z - prev_rise - 0.4
    box("lacquer", (0, 0, zb + h / 2), (t["w"], t["d"], h))
    top = t.get("top", False)
    # gold nageshi bands and corner posts on visible part
    for zz in (z + t["v"] * 0.07, z + t["v"] * 0.93):
        box("gold", (0, -t["d"] / 2 - 0.03, zz), (t["w"], 0.06, 0.18))
        box("gold", (0, t["d"] / 2 + 0.03, zz), (t["w"], 0.06, 0.18))
        box("gold", (t["w"] / 2 + 0.03, 0, zz), (0.06, t["d"], 0.18))
        box("gold", (-t["w"] / 2 - 0.03, 0, zz), (0.06, t["d"], 0.18))
    for sx in (-1, 1):
        for sy in (-1, 1):
            box("gold", (sx * t["w"] / 2, sy * t["d"] / 2, z + t["v"] / 2), (0.35, 0.35, t["v"]))
    nw, nd = t["win"], max(2, t["win"] - 1)
    windows_on_face(0, -t["d"] / 2, z, t["v"], t["w"] - 1, -math.pi / 2, nw, top)
    windows_on_face(0, t["d"] / 2, z, t["v"], t["w"] - 1, math.pi / 2, nw, top)
    windows_on_face(t["w"] / 2, 0, z, t["v"], t["d"] - 1, 0, nd, top)
    windows_on_face(-t["w"] / 2, 0, z, t["v"], t["d"] - 1, math.pi, nd, top)
    if top:
        box("lacquer", (0, 0, z + 0.1), (t["w"] + 2.6, t["d"] + 2.6, 0.35))
        W2, D2, rh = t["w"] + 2.4, t["d"] + 2.4, 1.1
        for (lx, ly, ln, rot) in [(0, -D2 / 2, W2, 0), (0, D2 / 2, W2, 0), (W2 / 2, 0, D2, math.pi / 2), (-W2 / 2, 0, D2, math.pi / 2)]:
            box("lacquer", (lx, ly, z + 0.3 + rh), (ln, 0.14, 0.14), rot)
            box("lacquer", (lx, ly, z + 0.3 + rh / 2), (ln, 0.1, 0.1), rot)
            n = round(ln / 1.3)
            for k in range(n + 1):
                off = -ln / 2 + k * ln / n
                px, py = (off, ly) if rot == 0 else (lx, off)
                box("lacquer", (px, py, z + 0.3 + rh / 2), (0.16, 0.16, rh))
                sphere("gold", (px, py, z + 0.42 + rh), 0.13, seg=8, rings=5)
    ztop = z + t["v"]; zeave = ztop - 0.45
    nxt = tiers[i + 1] if i + 1 < len(tiers) else None
    ow, od = t["w"] + 2 * t["ov"], t["d"] + 2 * t["ov"]
    if nxt:
        P = roof(zeave, ow, od, nxt["w"] - 0.2, nxt["d"] - 0.2, t["rise"] + 0.45, t["up"])
        roofs.append(P)
        prev_rise = t["rise"]
        z = zeave + t["rise"] + 0.45
    else:
        iw, idp, rise = t["w"] * 0.62, t["d"] * 0.42, t["rise"]
        P = roof(zeave, ow, od, iw, idp, rise, t["up"])
        gz, gh, ext = zeave + rise, 2.9, 0.9
        xa, xb, yf = -iw / 2 - ext, iw / 2 + ext, idp / 2 + 0.3
        quad("tile", (xa, -yf, gz - 0.2), (xb, -yf, gz - 0.2), (xb, 0, gz + gh), (xa, 0, gz + gh), True)
        quad("tile", (xb, yf, gz - 0.2), (xa, yf, gz - 0.2), (xa, 0, gz + gh), (xb, 0, gz + gh), True)
        for sx in (-1, 1):
            tri("lacquer", (sx * iw / 2, -idp / 2, gz), (sx * iw / 2, idp / 2, gz), (sx * iw / 2, 0, gz + gh - 0.1))
            sphere("gold", (sx * (iw / 2 + 0.08), 0, gz + gh * 0.55), 0.4, (0.25, 1, 1.2))
            X = sx * (iw / 2 + ext)
            tube("gold", [(X, -yf, gz - 0.25), (X, -yf / 2, gz + gh * 0.5), (X, 0, gz + gh + 0.05), (X, yf / 2, gz + gh * 0.5), (X, yf, gz - 0.25)], 0.17)
        tube("gold", [(xa, -yf, gz - 0.2), (xb, -yf, gz - 0.2)], 0.16)
        tube("gold", [(xa, yf, gz - 0.2), (xb, yf, gz - 0.2)], 0.16)
        box("ridge", (0, 0, gz + gh + 0.15), (xb - xa + 0.6, 0.6, 0.6))
        box("gold", (0, 0, gz + gh + 0.48), (xb - xa + 0.62, 0.64, 0.12))
        shachi(xa - 0.1, 0, gz + gh + 0.9, -1)
        shachi(xb + 0.1, 0, gz + gh + 0.9, 1)
        p = P(0, 0.5, 0.38)
        karahafu(p[0], p[1] - 0.3, p[2] - 0.2, 0, 4.2, 1.6, 2.2)

# gables on lower roofs: (roof idx, side, t, W, H, kind); side 0 = front (-y), 1 = +x, 2 = +y, 3 = -x
rot_for = [0, math.pi / 2, math.pi, -math.pi / 2]
gabs = [(0, 0, .42, 9, 3.2, 'c'), (0, 2, .42, 9, 3.2, 'c'), (0, 1, .45, 5, 2.6, 'c'), (0, 3, .45, 5, 2.6, 'c'),
        (1, 0, .40, 5.5, 1.9, 'k'), (1, 2, .40, 5.5, 1.9, 'k'), (1, 1, .42, 6.5, 2.8, 'c'), (1, 3, .42, 6.5, 2.8, 'c'),
        (2, 0, .42, 6, 2.6, 'c'), (2, 2, .42, 6, 2.6, 'c'), (3, 1, .45, 4.2, 2.1, 'c'), (3, 3, .45, 4.2, 2.1, 'c')]
for ri, side, tt, W, H, kind in gabs:
    p = roofs[ri](side, 0.5, tt)
    (karahafu if kind == 'k' else chidori)(p[0], p[1], p[2] - 0.15, rot_for[side], W, H, 4.5)

if not TONLY:
    # pines
    import random
    random.seed(7)
    for (x, y) in [(-40, 35), (-46, 18), (38, 40), (45, 22), (42, -38), (-38, -42), (-50, -10), (50, -5), (20, 48), (-22, 50), (10, -50), (-12, -48)]:
        s = random.uniform(0.9, 1.4)
        cyl("bark", (x, y, ISL), 0.45 * s, 0.25 * s, 6 * s)
        for k in range(5):
            sphere("pine", (x + random.uniform(-1.6, 1.6) * s, y + random.uniform(-1.6, 1.6) * s, ISL + (3.5 + k * 0.9) * s), random.uniform(1.4, 2.2) * s, (1, 1, 0.38), 9, 6)

# ---------- build objects ----------
def build_objects(cname="OsakaCastle"):
  coll = bpy.data.collections.get(cname) or bpy.data.collections.new(cname)
  if coll.name not in bpy.context.scene.collection.children:
      bpy.context.scene.collection.children.link(coll)
  for (m, smooth), (V, F) in ACC.items():
      me = bpy.data.meshes.new(f"{m}{'_s' if smooth else ''}")
      me.from_pydata(V, [], F); me.validate(); me.update()
      for p in me.polygons: p.use_smooth = smooth
      me.materials.append(MATS[m])
      ob = bpy.data.objects.new(me.name, me); coll.objects.link(ob)


  return coll

if not TONLY:
    coll = build_objects()
    # ---------- lighting / camera for preview ----------
    sun = bpy.data.lights.new("Sun", "SUN"); sun.energy = 4.0; sun.angle = 0.03
    so = bpy.data.objects.new("Sun", sun); so.rotation_euler = (math.radians(52), 0, math.radians(-35)); coll.objects.link(so)
    w = bpy.context.scene.world or bpy.data.worlds.new("World"); bpy.context.scene.world = w; w.use_nodes = True
    bg = next((n for n in w.node_tree.nodes if n.type == 'BACKGROUND'), None) or w.node_tree.nodes.new('ShaderNodeBackground'); bg.inputs[0].default_value = (0.55, 0.68, 0.85, 1); bg.inputs[1].default_value = 0.8
    cam = bpy.data.cameras.new("Cam"); cam.lens = 40
    co = bpy.data.objects.new("Cam", cam); coll.objects.link(co)
    co.location = (62, -78, 34)
    d = Vector((0, 0, 27)) - co.location
    co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc = bpy.context.scene; sc.camera = co
    sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 1280, 860
    sc.render.filepath = os.path.join(OUT, "preview.png")
    sc.view_settings.view_transform = 'Filmic' if 'Filmic' in [i.identifier for i in sc.view_settings.bl_rna.properties['view_transform'].enum_items] else 'AgX'

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "osaka_castle_tenshu.blend"))
    print("BUILD_OK", sum(len(v[0]) for v in ACC.values()), "verts")
