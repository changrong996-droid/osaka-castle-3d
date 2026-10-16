"""Headless-browser acceptance test for castle/web (rule-driven three.js site).

Run:  python3 tests/test_web.py            (or: pytest tests/test_web.py)
Needs: pip install playwright && python3 -m playwright install chromium
       (in the Hark sandbox:  . ../work/setup_pw.sh  provides a persistent Chromium + missing libs)

Asserts: page loads without console errors · audit total == 0 (江戸盛期 and 现状) · URL hash reproducible
(same hash -> same signature, other seed -> different) · writes 5 view screenshots to web/shots/.
three.js is requested from unpkg; when the sandbox cannot reach the CDN those requests are served from web/vendor/.
"""
import functools, http.server, json, os, socketserver, sys, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'web')
SHOTS = os.path.join(WEB, 'shots')
VIEWS = ['aerial', 'top', 'otemon', 'tenshu', 'eastwall', 'otejoint', 'sakura']
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
        if shots:
            for v in VIEWS:
                pg.evaluate(f'__castle.setView("{v}"); __castle.renderNow()')
                pg.wait_for_timeout(300)
                pg.screenshot(path=os.path.join(SHOTS, v + '.png'))
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
