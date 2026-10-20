"""data/goten_fit.json (b5a digitization of NDL pid 1286170) -> compact `gotenFit` object inside web/data.js.
Used by tools/make_webdata.py (T['gotenFit'] = compact()) and runnable on its own to patch an existing web/data.js
without the DEM/shapely toolchain:  python3 tools/make_gotenfit.py
Each element: name, kind, use (hall|corridor|kura|mask|skip), conf (label/geometry confidence), cx, cy (TPS centroid, model m),
w, d (min-rotated rect, m, w along `ax`), ax (long axis deg, model frame), poly (similarity-shape polygon, model m)."""
import json, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'goten_fit.json')
def compact():
    G = json.load(open(SRC, encoding='utf-8'))
    els = []
    for e in G['elements']:
        if e['use'] == 'skip': continue
        m = e['mrr']
        els.append(dict(name=e['name'], kind=e['kind'], use=e['use'], conf=e.get('label_confidence', 'n/a'), geo=e['confidence'],
                        cx=round(m['cx'], 2), cy=round(m['cy'], 2), w=round(m['w'], 2), d=round(m['d'], 2), ax=round(m['long_axis_deg'], 1),
                        poly=[[round(x, 1), round(y, 1)] for x, y in e['polygon']]))
    P = G['provenance']
    return dict(src=P['source'], pid=P['ndl_pid'], license=P['license'], residual=P['transform_residual_m'], tol=P['tolerance'], elements=els)
if __name__ == '__main__':
    f = os.path.join(ROOT, 'web', 'data.js'); s = open(f, encoding='utf-8').read()
    head, js = s.split('CASTLE_DATA=', 1); js = js.rstrip().rstrip(';')
    T = json.loads(js); T['gotenFit'] = compact()
    out = json.dumps(T, ensure_ascii=False, separators=(',', ':'))
    open(f, 'w', encoding='utf-8').write(head + 'CASTLE_DATA=' + out + ';\n')
    print('web/data.js', len(out), 'bytes; gotenFit elements', len(T['gotenFit']['elements']))
