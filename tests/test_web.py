"""Headless-browser acceptance test for castle/web (rule-driven three.js site).

Run:  python3 tests/test_web.py            (or: pytest tests/test_web.py)
Needs: pip install playwright && python3 -m playwright install chromium
       (in the Hark sandbox:  . ../work/setup_pw.sh  provides a persistent Chromium + missing libs)

Asserts: page loads without console errors · audit total == 0 (江戸盛期 and 现状) · camera audit C1–C7 == 0 (C6 walk through every gate at eye height,
C7 fast-drag tunneling fuzz), per-frame walk-through-Otemon animation clear + tunnel-free + actually under the gate lintel, extra fuzz,
per-frame animated transitions clear, independent triangle-exact check, real mouse wheel/drag input never leaves the camera inside solids · URL hash reproducible
(same hash -> same signature, other seed -> different) · writes one screenshot per view (incl. inside the Otemon gate opening) to web/shots/.
three.js is requested from unpkg; when the sandbox cannot reach the CDN those requests are served from web/vendor/.
"""
import functools, http.server, json, os, socketserver, sys, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'web')
SHOTS = os.path.join(WEB, 'shots')
VIEWS = ['aerial', 'top', 'otemon', 'tenshu', 'eastwall', 'otejoint', 'sakura', 'otegate']
VENDOR = {'build/three.module.js': 'three.module.js', 'examples/jsm/controls/OrbitControls.js': 'OrbitControls.js', 'examples/jsm/objects/Sky.js': 'Sky.js'}
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']


def serve():
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    h = functools.partial(Q, directory=WEB)
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


def route_vendor(route):
    url = route.request.url
    for k, f in VENDOR.items():
        if url.endswith(k):
            return route.fulfill(path=os.path.join(WEB, 'vendor', f), content_type='application/javascript', headers={'Access-Control-Allow-Origin': '*'})
    return route.abort()


def run(shots=True):
    from playwright.sync_api import sync_playwright
    os.makedirs(SHOTS, exist_ok=True)
    srv, port = serve()
    base = f'http://127.0.0.1:{port}/index.html'
    rep = {'errors': []}
    with sync_playwright() as p:
        b = p.chromium.launch(args=ARGS)
        pg = b.new_page(viewport={'width': 1280, 'height': 800})
        pg.route('https://unpkg.com/**', route_vendor)
        pg.on('console', lambda m: rep['errors'].append('console: ' + m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: rep['errors'].append('pageerror: ' + str(e)))

        def load(h):
            pg.goto('about:blank')  # force a full reload (a hash-only change would not reload)
            t = time.time()
            pg.goto(base + h)
            pg.wait_for_function('window.__castle && (window.__castle.ready || window.__castle.errors.length)', timeout=240000)
            return time.time() - t

        rep['load_s'] = round(load('#seed=1&lost=1&view=aerial&labels=1'), 2)
        if not pg.evaluate('!!__castle.ready'):
            raise RuntimeError('page failed: ' + json.dumps(pg.evaluate('__castle.errors')) + ' ' + json.dumps(rep['errors']))
        st = pg.evaluate('({a: __castle.auditResult, sig: __castle.signature, stats: __castle.stats, loadMs: __castle.loadMs, errs: __castle.errors})')
        rep.update(audit=st['a']['total'], audit_cnt=st['a']['cnt'], audit_items=st['a']['items'][:20], sig1=st['sig'], stats=st['stats'], app_load_ms=st['loadMs'])
        rep['errors'] += st['errs']
        pg.wait_for_function('__castle.camAudit', timeout=120000)
        ca = pg.evaluate('__castle.camAudit')
        rep.update(cam_audit=ca['total'], cam_cnt=ca['cnt'], cam_items=ca['items'][:10], cam_near=ca['near'])
        # 更强的模糊测试（3 个种子 × 1500 步）+ r2 旧相机逻辑在同一套检查下的违规数（对照）
        rep['cam_fuzz'] = [pg.evaluate(f'__castle.cameraAudit({{fuzz:1500, seed:{sd}}}).cnt.C4') for sd in (11, 23, 37)]
        rep['cam_legacy'] = pg.evaluate('__castle.cameraAudit({legacy:true}).cnt')
        rep['cam_old_r3'] = pg.evaluate('__castle.cameraAudit({old:true}).cnt')  # web-r3 逻辑（柱状场 + 抬升）下的 C6/C7
        rep['cam_gates'] = ca['gates']
        # 步行穿过大手门：合成时钟逐帧驱动真实 step()，每帧检查合法、两帧之间不穿几何；统计在遮盖下（门洞里）的帧数和最低眼高
        rep['cam_walk'] = pg.evaluate("""() => { const C = __castle, F = C.camField, S = C.site; C.setView('otemon'); let t = 1000; if (!C.walkThrough('otemon', t)) return null; let prev = C.cur().cam, n = 0, bad = 0, tun = 0, under = 0, eyeMin = 1e9;
            while (C.anim() && n < 20000) { t += 16; C.step(t); n++; const q = C.cur().cam; if (!F.clear(q, 1e-3)) bad++; if (F.segHit(prev, q)) tun++; if (!F.above(q)) { under++; const e = q[2] - S.surfaceAt(q[0], q[1]); if (e < eyeMin) eyeMin = e; } prev = q; }
            return { frames: n, bad, tun, under, eyeMin: +eyeMin.toFixed(2) }; }""")
        # 动画过渡：用合成时钟逐帧（16 ms）驱动真实的 step()（插值 + OrbitControls.update + 约束），每帧检查清空、终点 = 视角预设
        # （headless swiftshader 每帧渲染 ~1 s，按墙钟采样只能拿到 1–3 帧，所以不用 rAF）
        rep['cam_anim'] = pg.evaluate("""() => { const C = __castle, V = Object.keys(C.VIEWS), out = []; for (const a of V) for (const b of V) { if (a === b) continue;
            C.setView(a); C.goView(b); const A = C.anim(); let bad = 0, n = 0; for (let t = A.s; t <= A.s + A.dur * 1000 + 200; t += 16) { C.step(t); n++; if (!C.camField.clear(C.cur().cam, 1e-3)) bad++; }
            const q = C.cur(), p = C.presets[b], end = Math.hypot(q.cam[0] - p.cam[0], q.cam[1] - p.cam[1], q.cam[2] - p.cam[2]); out.push({ a, b, frames: n, bad, end: +end.toFixed(3), lift: +A.maxLift.toFixed(1) }); } return out; }""")
        # 独立几何校验（三角形精确距离，不经碰撞场）+ 真实鼠标输入（滚轮猛推进 + 拖到仰视）
        load('#seed=1&lost=1&view=otemon&labels=0&camgeo=1')
        pg.wait_for_function('__castle.camAudit', timeout=120000)
        rep['cam_geo'] = pg.evaluate('__castle.cameraAudit({geo:true, fuzz:800, seed:5}).geo')
        if shots:
            for v in VIEWS:
                pg.evaluate(f'__castle.setView("{v}")'); pg.evaluate('__castle.renderNow()'); pg.wait_for_timeout(200)
                pg.screenshot(path=os.path.join(SHOTS, v + '.png'))
        bad_in = 0
        for v in ('otejoint', 'sakura'):  # 每个输入事件在 swiftshader 下要渲染一帧（~1 s），所以只做少量大幅度输入
            pg.evaluate(f'__castle.setView("{v}")'); pg.mouse.move(640, 400)
            for i in range(6):
                pg.mouse.wheel(0, -2000)
            pg.mouse.down(); pg.mouse.move(940, 150, steps=3); pg.mouse.up(); pg.mouse.down(button='right'); pg.mouse.move(400, 650, steps=3); pg.mouse.up(button='right')
            for i in range(6):
                pg.mouse.wheel(0, -2000)
            pg.wait_for_timeout(300)
            bad_in += pg.evaluate('(() => { const q = __castle.cur(); return (__castle.camField.clear(q.cam, 1e-3) ? 0 : 1) + (__castle.camField.geoCheck(q.cam) ? 1 : 0); })()')
        rep['cam_input'] = bad_in
        # reproducibility
        load('#seed=1&lost=1&view=top&labels=0')
        rep['sig1_again'] = pg.evaluate('__castle.signature')
        load('#seed=2&lost=1&view=top&labels=0')
        rep['sig2'] = pg.evaluate('__castle.signature')
        rep['audit_seed2'] = pg.evaluate('__castle.auditResult.total')
        load('#seed=1&lost=0&view=aerial&labels=0')
        rep['audit_now'] = pg.evaluate('__castle.auditResult.total')
        rep['audit_now_items'] = pg.evaluate('__castle.auditResult.items.slice(0,10)')
        if shots:
            pg.evaluate('__castle.renderNow()'); pg.wait_for_timeout(300)
            pg.screenshot(path=os.path.join(SHOTS, 'aerial_now.png'))
        b.close()
    srv.shutdown()
    json.dump(rep, open(os.path.join(SHOTS, 'report.json'), 'w'), ensure_ascii=False, indent=1)
    return rep


def check(rep):
    assert not rep['errors'], rep['errors']
    assert rep['audit'] == 0, rep['audit_items']
    assert rep['audit_now'] == 0, rep['audit_now_items']
    assert rep['audit_seed2'] == 0
    assert rep['cam_audit'] == 0, rep['cam_items']
    assert rep['cam_fuzz'] == [0, 0, 0], rep['cam_fuzz']
    assert len(rep['cam_anim']) == len(VIEWS) * (len(VIEWS) - 1) and all(a['bad'] == 0 and a['end'] < 0.05 for a in rep['cam_anim']), [a for a in rep['cam_anim'] if a['bad'] or a['end'] >= 0.05]
    assert rep['cam_geo'] == {'C1': 0, 'C3': 0, 'C4': 0, 'C6': 0}, rep['cam_geo']
    w = rep['cam_walk']
    assert w and w['bad'] == 0 and w['tun'] == 0 and w['under'] > 0 and w['eyeMin'] >= 1.55, w
    assert rep['cam_input'] == 0
    assert rep['sig1'] == rep['sig1_again'], (rep['sig1'], rep['sig1_again'])
    assert rep['sig1'] != rep['sig2']
    for v in VIEWS:
        assert os.path.getsize(os.path.join(SHOTS, v + '.png')) > 20000, v


def test_web():
    check(run())


if __name__ == '__main__':
    r = run(shots='--noshots' not in sys.argv)
    print(json.dumps({k: v for k, v in r.items() if k not in ('audit_items', 'audit_now_items')}, ensure_ascii=False, indent=1))
    check(r)
    print('WEB_OK')
