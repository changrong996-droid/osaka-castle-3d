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
L = {"origin": {"lat": LAT0, "lon": LON0, "note": "x east, y north, metres"}, "moats": [], "rivers": [], "walls": [], "retaining_walls": [], "heritage": [], "buildings": [], "points": [], "castle_outline": None,
     # web-r7a: extended OSM layers (data/q.txt). Not used by the r6 generator yet; kept for the network/vegetation/evidence rules.
     "roads": [], "bridges": [], "landcover": [], "trees": [], "gates": []}
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
    # extended layers (independent of the chain above, so the r6 lists stay byte-identical)
    if 'highway' in t:
        L['roads'].append({"id": w['id'], "highway": t['highway'], "name": t.get('name'), "surface": t.get('surface'), "width": t.get('width'),
                           "bridge": t.get('bridge'), "layer": t.get('layer'), "pts": pts})
    if t.get('man_made') == 'bridge' or (t.get('bridge') and 'highway' not in t):
        L['bridges'].append({"id": w['id'], "name": t.get('name'), "kind": t.get('man_made') or t.get('bridge'), "pts": pts})
    lc = t.get('landuse') if t.get('landuse') in ('grass', 'forest') else t.get('natural') if t.get('natural') in ('wood', 'scrub', 'grassland', 'tree_row') else 'garden' if t.get('leisure') == 'garden' else None
    if lc: L['landcover'].append({"id": w['id'], "kind": lc, "leaf_type": t.get('leaf_type'), "pts": pts})
    if t.get('barrier') == 'gate': L['gates'].append({"id": w['id'], "name": t.get('name'), "pts": pts})
for n in N.values():
    t = n.get('tags', {})
    if t.get('natural') == 'tree' or t.get('barrier') == 'gate':
        x, y = P(n['id'])
        if abs(x) < R and abs(y) < R:
            if t.get('natural') == 'tree': L['trees'].append({"id": n['id'], "xy": [x, y], "leaf_type": t.get('leaf_type'), "genus": t.get('genus'), "species": t.get('species')})
            else: L['gates'].append({"id": n['id'], "name": t.get('name'), "pts": [[x, y]]})
    if 'historic' in t and t.get('name'):
        x, y = P(n['id'])
        if abs(x) < R and abs(y) < R: L['points'].append({"name": t['name'], "name_en": t.get('name:en'), "historic": t['historic'], "xy": [x, y]})
json.dump(L, open(out, 'w'), ensure_ascii=False, indent=1)
print({k: len(v) if isinstance(v, list) else bool(v) for k, v in L.items()})
