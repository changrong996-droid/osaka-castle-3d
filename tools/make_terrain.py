"""castle_layout.json -> terrain.json : land regions (polygon + holes) with elevations, building placement info."""
import json, sys
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
hon = max(parts(inner.convex_hull.difference(inner).buffer(-0.5).buffer(0.5)), key=lambda g: g.area)
nino = [g for g in parts(castle.difference(water).difference(hon.buffer(0.01))) if g.area > 3000]
city = [g for g in parts(box(-700, -700, 700, 700).difference(castle).difference(water)) if g.area > 500]
# elevations (m) relative to outer city ground; estimates, see docs/REFERENCES.md
ELEV = dict(water=-7.0, city=0.0, ninomaru=4.0, honmaru=14.0)
def enc(g, name, z):
    g = g.simplify(0.3)
    return dict(name=name, z=z, outer=[list(map(lambda v: round(v, 2), c)) for c in list(g.exterior.coords)[:-1]],
                holes=[[list(map(lambda v: round(v, 2), c)) for c in list(h.coords)[:-1]] for h in g.interiors], area=round(g.area))
regions = [enc(hon, 'honmaru', ELEV['honmaru'])] + [enc(g, 'ninomaru', ELEV['ninomaru']) for g in nino] + [enc(g, 'city', ELEV['city']) for g in city]
def region_z(x, y):
    from shapely.geometry import Point
    p = Point(x, y)
    if hon.buffer(3).contains(p): return ELEV['honmaru']
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
