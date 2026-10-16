"""web-r7 offline fit (measured data -> parameters; nothing here is shipped as mesh).
Inputs : web/data.js regions (via a node dump of the r6/r7a generator: CLS/H/TAG grids), data/castle_layout.json,
         GSI DEM5A z15 tiles (web/downloads/dem5a), PLATEAU 2025 cons 52350422 (web/downloads/plateau).
Outputs: data/fit_r7.json (fitted parameters + residuals), printed report.
Rules (physical form; data fits the parameters; literature only gives ranges):
  * terrace height model: constant, or plane z = a + gx*x + gy*y where the DEM shows grade; fitted by least squares on
    DEM samples >= 6 m (4 cells) from any class change / ishigaki face, excluding modern building footprints (OSM
    building=*, not heritage, buffered 3 m: DEM5A keeps some roofs) and NaN (water).
  * sub-terraces only along MEASURED lines (honmaru ishigaki chain from tools/make_terrain.py).
  * water level per connected water body = robust lower cluster (25th pct) of the bottom edges of inclined PLATEAU
    ishigaki faces within 4 m of its shoreline (LOD3.1 models the exposed face, so its lower edge is the waterline);
    vertical faces (|n_z| ~ 0) and faces ending at the common 2.8 m base are artefacts and are not used.
    Check: level < 5th pct of DEM 6 m outside the shoreline (connected-vessel + containment).
  * ishigaki batter (horizontal/vertical) from inclined faces taller than 3 m.
"""
import json, math, os, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geodata as G
from shapely.geometry import Polygon, Point, LineString, MultiLineString
from shapely.ops import unary_union
ROOT = G.ROOT
L = json.load(open(os.path.join(ROOT, 'data', 'castle_layout.json')))
DUMP = r'''
const W=process.argv[1];require(W+'/data.js');require(W+'/site.js');const S=CASTLE_SITE.build({seed:1,lost:true});const fs=require('fs');
fs.writeFileSync('/tmp/fit_cls.bin',Buffer.from(new Int16Array(S.CLS).buffer));fs.writeFileSync('/tmp/fit_H.bin',Buffer.from(new Float32Array(S.H).buffer));fs.writeFileSync('/tmp/fit_TAG.bin',Buffer.from(new Uint8Array(S.TAG).buffer));
const E=[];for(const g of S.regions)for(const e of g.edges)if(e.B&&!e.band&&e.ring>=0)E.push([g.i,e.ax,e.ay,e.bx,e.by,e.B,e.zl,g.z]);
fs.writeFileSync('/tmp/fit_meta.json',JSON.stringify({NX:S.NX,NY:S.NY,x0:S.X(0),y0:S.Y(0),c:S.cell,WZ:S.WZ,regions:S.regions.map(g=>({i:g.i,name:g.name,z:g.z})),band:S.BAND.i,bandz:S.BAND.z,edges:E}));
'''

def load_grid():
    subprocess.run(['node', '-e', DUMP, os.path.join(ROOT, 'web')], check=True)
    M = json.load(open('/tmp/fit_meta.json')); NX, NY = M['NX'], M['NY']
    CLS = np.fromfile('/tmp/fit_cls.bin', np.int16).reshape(NY, NX); H = np.fromfile('/tmp/fit_H.bin', np.float32).reshape(NY, NX)
    TAG = np.fromfile('/tmp/fit_TAG.bin', np.uint8).reshape(NY, NX)
    j, i = np.mgrid[0:NY, 0:NX]; X = M['x0'] + i * M['c']; Y = M['y0'] + j * M['c']
    return M, CLS, H, TAG, X, Y

def erode_interior(CLS, TAG, r=4):
    from numpy.lib.stride_tricks import sliding_window_view as sw
    p = np.pad(CLS, r, mode='edge'); w = sw(p, (2 * r + 1, 2 * r + 1))
    t = np.pad(TAG, r, mode='edge'); wt = sw(t, (2 * r + 1, 2 * r + 1))
    return (w.min(axis=(2, 3)) == w.max(axis=(2, 3))) & (wt.max(axis=(2, 3)) == 0)

def raster_mask(polys, X, Y):
    from matplotlib.path import Path
    m = np.zeros(X.shape, bool); P = np.c_[X.ravel(), Y.ravel()]
    for g in polys:
        for pg in (g.geoms if hasattr(g, 'geoms') else [g]):
            b = pg.bounds; sel = (P[:, 0] >= b[0]) & (P[:, 0] <= b[2]) & (P[:, 1] >= b[1]) & (P[:, 1] <= b[3])
            if not sel.any(): continue
            inside = Path(np.asarray(pg.exterior.coords)).contains_points(P[sel])
            for h in pg.interiors: inside &= ~Path(np.asarray(h.coords)).contains_points(P[sel])
            idx = np.flatnonzero(sel)[inside]; m.ravel()[idx] = True
    return m

def fit(x, y, z, plane):
    if plane: A = np.c_[np.ones_like(x), x, y]
    else: A = np.ones((len(x), 1))
    c, *_ = np.linalg.lstsq(A, z, rcond=None); r = z - A @ c
    out = dict(a=round(float(c[0]), 3), gx=round(float(c[1]), 5) if plane else 0.0, gy=round(float(c[2]), 5) if plane else 0.0,
               rms=round(float(np.sqrt(np.mean(r ** 2))), 3), max=round(float(np.abs(r).max()), 3), p95=round(float(np.percentile(np.abs(r), 95)), 3), n=int(len(z)))
    out['grade'] = round(math.hypot(out['gx'], out['gy']), 4); return out, r

def main():
    dem = G.DEM(); M, CLS, H, TAG, X, Y = load_grid(); Z = dem(X, Y)
    interior = erode_interior(CLS, TAG)
    modern = [Polygon(b['pts']).buffer(3) for b in L['buildings'] if len(b['pts']) > 3]
    MOD = raster_mask(modern, X, Y)
    names = {r['i']: r['name'] for r in M['regions']}; names[M['band']] = 'band(城下外圈)'
    # measured sub-terrace split of the honmaru: the ishigaki chain polygon (make_terrain.honmaru_chain)
    import importlib.util
    spec = importlib.util.spec_from_file_location('mt', os.path.join(ROOT, 'tools', 'make_terrain.py'))
    sys.argv = ['mt', os.path.join(ROOT, 'data', 'castle_layout.json'), '/tmp/_terrain_fit.json']
    mt = importlib.util.module_from_spec(spec); import io, contextlib
    with contextlib.redirect_stdout(io.StringIO()): spec.loader.exec_module(mt)
    main_ter = Polygon(mt.HON_LINE).buffer(0); MAIN = raster_mask([main_ter], X, Y)
    # tenshu base (天守台) = measured: PLATEAU tenshu LOD2 ground ring is not used here; use OSM 大阪城 footprint +8 m (stone base skirt)
    tb = [Polygon(b['pts']).buffer(8) for b in L['heritage'] if b['name'] == '大阪城']; TB = raster_mask(tb, X, Y)
    res = {'datum': 'T.P. (Tokyo Peil), metres; model r6 levels are relative (honmaru 14)', 'terraces': {}, 'excluded': {}}
    tot = []
    groups = []
    for k in sorted(set(np.unique(CLS)) - {-1}):
        nm = names.get(int(k), str(k))
        base = (CLS == k) & interior & ~np.isnan(Z)
        if nm == 'honmaru':
            groups += [('honmaru/本丸主台地（实测石垣链内）', base & MAIN & ~TB, False), ('honmaru/山里丸（链外，北侧）', base & ~MAIN, False), ('honmaru/天守台', (CLS == k) & TB & ~np.isnan(Z), False)]
        else:
            groups.append((nm + '#%d' % k, base, nm not in ('dry',)))
    for label, m, plane in groups:
        mm = m & ~MOD; nmod = int((m & MOD).sum())
        if mm.sum() < 30: continue
        f0, _ = fit(X[mm], Y[mm], Z[mm], False); f1, r1 = fit(X[mm], Y[mm], Z[mm], True)
        use = f1 if (plane and f0['rms'] - f1['rms'] > 0.25) else f0
        res['terraces'][label] = dict(const=f0, plane=f1, chosen='plane' if use is f1 else 'const', excluded_modern_cells=nmod)
        print('%-34s n=%6d  const a=%6.2f rms %5.2f max %5.2f | plane a=%6.2f g=(%.4f,%.4f) grade %.3f rms %5.2f max %5.2f p95 %5.2f | modern excl %d' % (
            label, f0['n'], f0['a'], f0['rms'], f0['max'], f1['a'], f1['gx'], f1['gy'], f1['grade'], f1['rms'], f1['max'], f1['p95'], nmod))
    # current model vs DEM (H22 as it would read today): best single datum offset on all interior terrace samples
    m = interior & ~np.isnan(Z) & ~MOD & (CLS >= 0)
    off = float(np.median(Z[m] - H[m])); r = Z[m] - H[m] - off
    res['model_r7a_vs_dem'] = dict(offset=round(off, 3), rms=round(float(np.sqrt(np.mean(r ** 2))), 3), max=round(float(np.abs(r).max()), 3), n=int(m.sum()))
    print('current model (relative levels) + best offset %.2f m vs DEM: rms %.2f max %.2f (n=%d)' % (off, res['model_r7a_vs_dem']['rms'], res['model_r7a_vs_dem']['max'], m.sum()))
    for k in sorted(set(np.unique(CLS[m]))):
        mk = m & (CLS == k); rk = Z[mk] - H[mk] - off
        print('   %-16s model z %.1f -> %.1f T.P.; DEM median %.2f; residual rms %.2f max %.2f' % (names.get(int(k)), float(np.median(H[mk])), float(np.median(H[mk])) + off, float(np.median(Z[mk])), np.sqrt(np.mean(rk ** 2)), np.abs(rk).max()))
    # ---- PLATEAU ishigaki faces ----
    S = G.gml_surfaces(os.path.join(G.DL, 'plateau', '52350422_cons.gml'))
    F = []
    for kk, gid, rs in S:
        if kk != 'WallSurface': continue
        rr = rs[0]; c = rr.mean(0); _, _, vt = np.linalg.svd(rr - c); n = vt[2]; bat = abs(n[2]) / max(math.hypot(n[0], n[1]), 1e-9)
        zb, zt = rr[:, 2].min(), rr[:, 2].max(); bot = rr[rr[:, 2] < zb + 0.3]; top = rr[rr[:, 2] > zt - 0.3]
        F.append(dict(zb=zb, zt=zt, bat=bat, bot=bot[:, :2], top=top[:, :2], art=bool(bat < 0.02 or abs(zb - 2.8) < 0.05)))
    inc = [f for f in F if not f['art'] and f['zt'] - f['zb'] > 3]
    bats = np.array([f['bat'] for f in inc])
    res['ishigaki'] = dict(faces=len(F), artefact_vertical_or_2p8=int(sum(f['art'] for f in F)), inclined_h_gt_3=len(inc),
                           batter_pct={str(p): round(float(np.percentile(bats, p)), 3) for p in (10, 25, 50, 75, 90)},
                           face_height_max=round(float(max(f['zt'] - f['zb'] for f in F)), 2))
    print('PLATEAU cons walls %d; artefacts (vertical or base 2.8 m) %d; inclined h>3 m %d; batter H/V p10/25/50/75/90 =' % (len(F), res['ishigaki']['artefact_vertical_or_2p8'], len(inc)), res['ishigaki']['batter_pct'])
    # ---- water levels per connected water body ----
    polys = [(w['id'], w['name'], Polygon(w['pts']).buffer(0)) for w in L['moats'] + L['rivers'] if len(w['pts']) > 3]
    U = unary_union([p.buffer(0.5) for _, _, p in polys]); comps = list(U.geoms) if hasattr(U, 'geoms') else [U]
    res['water'] = []
    for cp in comps:
        if cp.area < 20000: continue
        mem = [(i, n) for i, n, p in polys if p.buffer(0.5).intersects(cp)]
        sh = cp.buffer(-0.5).exterior
        zb = np.array([f['zb'] for f in inc + [f for f in F if not f['art'] and f['zt'] - f['zb'] > 1.5 and f not in inc] if sh.distance(Point(*f['bot'].mean(0))) < 4])
        ring = cp.buffer(6).exterior; pts = [ring.interpolate(t, normalized=True) for t in np.linspace(0, 1, 1000)]
        zs = dem(np.array([p.x for p in pts]), np.array([p.y for p in pts])); zs = zs[~np.isnan(zs)]
        lvl = float(np.percentile(zb, 25)) if len(zb) >= 5 else None
        name = '/'.join(sorted({n for _, n in mem if n})) or str(mem[0][0])
        rec = dict(name=name, members=[i for i, _ in mem], level=round(lvl, 2) if lvl is not None else None, n_faces=int(len(zb)),
                   spread_p10_p50=[round(float(np.percentile(zb, 10)), 2), round(float(np.percentile(zb, 50)), 2)] if len(zb) else None,
                   shore_dem_p5=round(float(np.percentile(zs, 5)), 2), ok_below_shore=bool(lvl is not None and lvl < np.percentile(zs, 5)),
                   centroid=[round(v) for v in cp.centroid.coords[0]])
        if lvl is None: rec['note'] = 'no inclined PLATEAU face on its shore (river outside the castle mesh); DEM water-surface median used' ; rec['level'] = round(float(np.nanmedian(dem(*np.array(cp.buffer(-5).representative_point().coords[0])))), 2) if False else None
        res['water'].append(rec)
        print('water %-12s level %s T.P. (n=%d faces, p10/p50 %s)  shore DEM p5 %.2f  below-shore %s' % (name, rec['level'], rec['n_faces'], rec['spread_p10_p50'], rec['shore_dem_p5'], rec['ok_below_shore']))
    # ---- H25 as it would read today: model toe lines vs measured lines ----
    E = M['edges']; toe = MultiLineString([[(e[1], e[2]), (e[3], e[4])] for e in E])
    meas_lines = [LineString(w['pts']) for w in L['retaining_walls'] if len(w['pts']) >= 2]
    plat_toe = [LineString(f['bot']) if len(f['bot']) >= 2 else Point(*f['bot'][0]) for f in inc]
    D = []
    for e in E:
        seg = LineString([(e[1], e[2]), (e[3], e[4])]); n = max(1, int(seg.length / 2))
        for t in np.linspace(0, 1, n + 1):
            p = seg.interpolate(t, normalized=True)
            dp = min((g.distance(p) for g in plat_toe if abs(g.centroid.x - p.x) < 40 and abs(g.centroid.y - p.y) < 40), default=99)
            do = min((g.distance(p) for g in meas_lines if g.distance(p) < 40), default=99)
            D.append((dp, do))
    D = np.array(D); best = D.min(1); within = best <= 1.5
    res['h25_today'] = dict(samples=int(len(D)), within_1p5m=round(float(within.mean()), 3), median=round(float(np.median(best)), 2), p90=round(float(np.percentile(best, 90)), 2), unmatched_gt5m=round(float((best > 5).mean()), 3))
    print('H25 today: model toe samples %d, within 1.5 m of PLATEAU toe / OSM retaining wall: %.1f%%, median %.2f m, p90 %.2f m, >5 m %.1f%%' % (len(D), within.mean() * 100, np.median(best), np.percentile(best, 90), (best > 5).mean() * 100))
    json.dump(res, open(os.path.join(ROOT, 'data', 'fit_r7.json'), 'w'), ensure_ascii=False, indent=1)
    print('wrote data/fit_r7.json')

if __name__ == '__main__': main()
