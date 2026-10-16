"""castle_layout.json -> terrain.json : land regions (polygon + holes) with elevations, building placement info."""
import json, sys, os
from shapely.geometry import Polygon, box, mapping
from shapely.ops import unary_union
L = json.load(open(sys.argv[1])); out = sys.argv[2]
def poly(p):
    g = Polygon(p).buffer(0); return g
water = unary_union([poly(m['pts']) for m in L['moats'] + L['rivers'] if len(m['pts']) > 3])
inner = poly(next(m for m in L['moats'] if m['id'] == 375025972)['pts'])
castle = poly(L['castle_outline']['pts']).union(unary_union([poly(m['pts']) for m in L['moats'] if m['id'] != 375025972]).convex_hull.intersection(poly(L['castle_outline']['pts']).buffer(30)))
def parts(g):
    return [g] if g.geom_type == 'Polygon' else list(g.geoms)
# Honmaru south part: the inner moat is open to the south (dry moats / Sakuramon), so the convex hull alone
# cuts a diagonal. web-r7a: close it with the MEASURED honmaru ishigaki line instead of hand-copied points:
#   1) a retaining wall belongs to the honmaru step if the GSI DEM5A 8 m on its high side is at the honmaru
#      level (DEM median inside the inner-moat hull, +-3 m) and the drop to its low side is >= 1.5 m (= SPEC.ishigaki.minDrop);
#   2) those walls are chained end-to-end where the gap is <= 12 m (the widest gate opening in SPEC.gates: a gap that
#      small is an opening, not the end of the wall); the longest chain is the honmaru ishigaki line.
# (web-r6 used 15 points copied by hand from OSM ways 363432471 + 405236726; the rule picks those two ways plus
#  their continuations 512691526 / 363432470 by itself.)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geodata
HON_STEP_TOL, MIN_DROP, GATE_GAP, SIDE = 3.0, 1.5, 12.0, 8.0
def honmaru_chain():
    import numpy as np, math
    from shapely.geometry import Point, LineString
    dem = geodata.DEM(); core = inner.convex_hull.difference(inner.buffer(8)); b = core.bounds
    P = [(x, y) for x in np.arange(b[0], b[2], 4) for y in np.arange(b[1], b[3], 4) if core.contains(Point(x, y))]
    zh = float(np.nanmedian(dem(np.array([p[0] for p in P]), np.array([p[1] for p in P]))))
    sel = []
    for w in L['retaining_walls']:
        if len(w['pts']) < 2: continue
        ls = LineString(w['pts']); n = max(2, int(ls.length / 3)); hi, lo = [], []
        for k in range(n + 1):
            f = min(k / n, 1 - 1e-3); a = ls.interpolate(f, normalized=True); c2 = ls.interpolate(f + 1e-3, normalized=True)
            tx, ty = c2.x - a.x, c2.y - a.y; l = math.hypot(tx, ty) or 1; nx, ny = -ty / l, tx / l
            z1, z2 = float(dem(a.x + nx * SIDE, a.y + ny * SIDE)), float(dem(a.x - nx * SIDE, a.y - ny * SIDE))
            hi.append(max(z1, z2)); lo.append(min(z1, z2))
        if np.all(np.isnan(hi)): continue
        up, dn = np.nanmedian(hi), np.nanmedian(lo)
        if abs(up - zh) < HON_STEP_TOL and up - dn >= MIN_DROP: sel.append((w['id'], [tuple(p) for p in w['pts']]))
    C = {i: (p, [wid]) for i, (wid, p) in enumerate(sel)}
    while True:
        best = None
        for a in C:
            for b2 in C:
                if b2 <= a: continue
                for fa, ea in ((0, C[a][0][0]), (1, C[a][0][-1])):
                    for fb, eb in ((0, C[b2][0][0]), (1, C[b2][0][-1])):
                        d = math.dist(ea, eb)
                        if d <= GATE_GAP and (best is None or d < best[0]): best = (d, a, b2, fa, fb)
        if not best: break
        d, a, b2, fa, fb = best; pa, ia = C.pop(a); pb, ib = C.pop(b2)
        C[a] = ((pa[::-1] if fa == 0 else pa) + (pb[::-1] if fb == 1 else pb), ia + ib)
    pts, ids = max(C.values(), key=lambda v: LineString(v[0]).length)
    print('honmaru level (DEM5A median) %.2f m T.P.; honmaru ishigaki chain = OSM retaining walls' % zh, ids, '%.0f m' % LineString(pts).length)
    return pts
HON_LINE = honmaru_chain()
hon = max(parts(inner.convex_hull.union(Polygon(HON_LINE).buffer(0)).difference(inner).buffer(-0.5).buffer(0.5)), key=lambda g: g.area)
dry = castle.intersection(hon.buffer(40)).difference(water).difference(hon.buffer(0.01)).buffer(-1).buffer(1)
dry = [g for g in parts(dry) if g.area > 800]
dryu = unary_union(dry) if dry else Polygon()
nino = [g for g in parts(castle.difference(water).difference(hon.buffer(0.01)).difference(dryu)) if g.area > 3000]
city = [g for g in parts(box(-700, -700, 700, 700).difference(castle).difference(water)) if g.area > 500]
# elevations (m) relative to outer city ground; estimates, see docs/REFERENCES.md
# r7b: the honmaru is not one terrace (GSI DEM5A: main terrace 32.9 m, yamazato-maru 21.3 m T.P.). Split along MEASURED lines:
#   the main terrace = inside the measured honmaru ishigaki chain (OSM retaining walls, honmaru_chain above);
#   what lies between the chain and the moat is either an ishigaki FACE (a band no wider than the widest possible face
#   footprint) or a lower TERRACE.  Widest face footprint = PLATEAU max face height x batter p90 (data/fit_r7.json);
#   a morphological opening with half that width keeps only the parts wider than any face -> the lower terrace (yamazato-maru);
#   the thin bands stay with the main terrace (they are its outer wall faces down to the moat).
FIT = json.load(open(os.path.join(os.path.dirname(os.path.abspath(out)), 'fit_r7.json'))) if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(out)), 'fit_r7.json')) else None
yam = None
if FIT:
    FACE_HALF = 0.5 * FIT['ishigaki']['face_height_max'] * FIT['ishigaki']['batter_pct']['90']
    rem = hon.difference(Polygon(HON_LINE).buffer(0))
    op = rem.buffer(-FACE_HALF).buffer(FACE_HALF).intersection(rem)
    cand = [g for g in parts(op) if g.area > 3000]
    if cand:
        yam = max(cand, key=lambda g: g.area)
        hon_parts = sorted(parts(hon.difference(yam)), key=lambda g: -g.area)
        hon = hon_parts[0]
        for g in hon_parts[1:]: yam = yam.union(g) if g.distance(yam) < 0.5 else yam   # slivers cut off by the opening go to the terrace they touch
        yam = max(parts(yam.buffer(0)), key=lambda g: g.area)
        print('yamazato split: face half-width %.2f m; yamazato %.0f m2, honmaru main %.0f m2' % (FACE_HALF, yam.area, hon.area))
ELEV = dict(dry=-5.0, water=-7.0, city=0.0, ninomaru=4.0, honmaru=14.0, yamazato=3.0)   # legacy relative values (only terrain.json 'z'); the browser model uses data/fit_r7.json surfaces (T.P.)
def enc(g, name, z):
    return dict(name=name, z=z, outer=[list(map(lambda v: round(v, 2), c)) for c in list(g.exterior.coords)[:-1]],
                holes=[[list(map(lambda v: round(v, 2), c)) for c in list(h.coords)[:-1]] for h in g.interiors], area=round(g.area))
# r7b: simplify all land polygons as ONE coverage (shared boundaries simplify identically -> no slivers between neighbouring
# land polygons; r7a simplified each polygon on its own, leaving <=0.3 m gaps that grid points could fall into as 'water')
import shapely
LAND = [(hon, 'honmaru')] + ([(yam, 'yamazato')] if yam is not None else []) + [(g, 'dry') for g in dry] + [(g, 'ninomaru') for g in nino] + [(g, 'city') for g in city]
SIMP = shapely.coverage_simplify([g for g, _ in LAND], 0.3, simplify_boundary=True)
LAND = [(max(parts(sg.buffer(0)), key=lambda q: q.area), nm) for sg, (_, nm) in zip(SIMP, LAND)]
regions = [enc(g, nm, ELEV[nm]) for g, nm in LAND]
def region_z(x, y):
    from shapely.geometry import Point
    p = Point(x, y)
    if hon.buffer(3).contains(p): return ELEV['honmaru']
    if dry and dryu.buffer(1).contains(p): return ELEV['dry']
    if any(g.buffer(3).contains(p) for g in nino): return ELEV['ninomaru']
    return ELEV['city']
TYPES = {'千貫櫓': 'yagura2', '乾櫓': 'yagura2', '一番櫓': 'yagura2', '六番櫓': 'yagura2', '多門櫓': 'tamon', '大手門': 'gate', '桜門': 'gate',
         '青屋門': 'gate', '北仕切門': 'gate', '五間門': 'gate', '焔硝蔵': 'kura', '金蔵': 'kura', '金明水井戸屋形': 'pavilion', '茶室（豊松庵）': 'hall', '豊国神社': 'hall', '大阪城': 'tenshu', '大阪城 豊臣石垣館': 'hall'}
bld = []
for h in L['heritage']:
    t = TYPES.get(h['name'])
    if not t: continue
    g = poly(h['pts']); r = g.minimum_rotated_rectangle; c = list(r.exterior.coords)[:4]
    import math
    e1 = (c[1][0] - c[0][0], c[1][1] - c[0][1]); e2 = (c[2][0] - c[1][0], c[2][1] - c[1][1])
    l1, l2 = math.hypot(*e1), math.hypot(*e2)
    ang = math.atan2(e1[1], e1[0]) if l1 >= l2 else math.atan2(e2[1], e2[0])
    cx, cy = g.centroid.x, g.centroid.y
    fp=[[round(x,2),round(y,2)] for x,y in list(g.simplify(0.2).exterior.coords)[:-1]]
    rf=[[round(x,2),round(y,2)] for x,y in list(g.buffer(1.6, join_style=2).simplify(0.2).exterior.coords)[:-1]]
    rf2=g.buffer(-2.2, join_style=2)
    rf2=[[round(x,2),round(y,2)] for x,y in list(rf2.exterior.coords)[:-1]] if (not rf2.is_empty and rf2.geom_type=='Polygon') else []
    bld.append(dict(fp=fp, roof=rf, roof2=rf2, name=h['name'], type=t, cx=round(cx, 2), cy=round(cy, 2), w=round(max(l1, l2), 2), d=round(min(l1, l2), 2), ang=round(ang, 4), z=region_z(cx, cy)))
lost = [dict(name=p['name'], x=p['xy'][0], y=p['xy'][1], z=region_z(*p['xy'])) for p in L['points'] if p['name'].endswith('櫓跡')]
json.dump(dict(elev=ELEV, regions=regions, buildings=bld, lost_yagura=lost), open(out, 'w'), ensure_ascii=False, indent=1)
print([(r['name'], r['area'], len(r['holes'])) for r in regions][:12]); print(len(bld), 'buildings', len(lost), 'lost yagura')
for b in bld: print(b)
