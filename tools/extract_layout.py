"""OSM (ODbL) -> local metric layout for Osaka Castle. Origin = tenshu centroid, x east, y north, metres."""
import json, math, sys
src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))
N = {e['id']: e for e in d['elements'] if e['type'] == 'node'}
W = {e['id']: e for e in d['elements'] if e['type'] == 'way'}
LAT0, LON0 = 34.68737, 135.52585
kx = 111320 * math.cos(math.radians(LAT0)); ky = 110574
P = lambda n: (round((N[n]['lon'] - LON0) * kx, 2), round((N[n]['lat'] - LAT0) * ky, 2))
R = 700  # keep things within 700 m of the tenshu
def near(pts): return any(abs(x) < R and abs(y) < R for x, y in pts)
L = {"origin": {"lat": LAT0, "lon": LON0, "note": "x east, y north, metres"}, "moats": [], "rivers": [], "walls": [], "retaining_walls": [], "heritage": [], "buildings": [], "points": [], "castle_outline": None}
HER = {48123162, 48123163, 48123164, 48123165, 48229768, 303446384 * 0, 303446367, 303446373, 303446402, 360013203, 176301502, 34619038, 303446394, 501001943, 501001944, 405236741, 512474174, 48229767, 176301498}
for w in W.values():
    t = w.get('tags', {}); nodes = [n for n in w['nodes'] if n in N]
    if len(nodes) < 2: continue
    pts = [P(n) for n in nodes]
    if not near(pts): continue
    item = {"id": w['id'], "name": t.get('name'), "name_en": t.get('name:en'), "pts": pts}
    if t.get('natural') == 'water':
        (L['rivers'] if t.get('water') == 'river' or 'river' in (t.get('name:en') or '').lower() or '川' in (t.get('name') or '') else L['moats']).append(item)
    elif t.get('barrier') == 'retaining_wall': L['retaining_walls'].append(item)
    elif t.get('barrier') in ('wall', 'city_wall'): L['walls'].append(item)
    elif t.get('historic') == 'castle' and 'building' not in t: L['castle_outline'] = item
    elif 'building' in t or t.get('historic') == 'city_gate':
        item.update(levels=t.get('building:levels'), height=t.get('height'), kind=t.get('building'), historic=t.get('historic'), heritage=t.get('heritage:type'))
        (L['heritage'] if w['id'] in HER or t.get('historic') in ('city_gate',) else L['buildings']).append(item)
for n in N.values():
    t = n.get('tags', {})
    if 'historic' in t and t.get('name'):
        x, y = P(n['id'])
        if abs(x) < R and abs(y) < R: L['points'].append({"name": t['name'], "name_en": t.get('name:en'), "historic": t['historic'], "xy": [x, y]})
json.dump(L, open(out, 'w'), ensure_ascii=False, indent=1)
print({k: len(v) if isinstance(v, list) else bool(v) for k, v in L.items()})
