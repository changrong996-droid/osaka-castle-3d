"""Visual look-dev report (web-r15, C1 phase A). Report only — never fails on image content.

For each approved reference image (c2 tenshu / c3 moat / c4 town / c6 interior) render the matching camera preset
(#view=ref2/ref3/ref4/ref6, quality high, 1280x720, petals frozen) in headless Chromium, write a side-by-side jpg
(reference | render) and simple image statistics:
  lum   = mean luminance (Rec.709 on sRGB 0..1)
  hue   = hue histogram (18 bins, weighted by saturation) — L1 distance to the reference (0 = same, 2 = disjoint)
  edge  = edge density (fraction of pixels whose FIND_EDGES response > 24)
  sat   = mean saturation, warm = mean (R - B)
Optionally (--before WEBDIR) renders the same camera poses with an older build (state.look) for before/after numbers.

Run:  python3 tests/test_visual.py [--refs DIR] [--out DIR] [--json FILE] [--before WEBDIR] [--only ref2,ref3]
Needs playwright + Pillow (no numpy).
"""
import argparse, functools, http.server, json, os, socketserver, sys, threading, time
from PIL import Image, ImageFilter, ImageStat

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_web as T

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REFS = {'ref2': 'c2_tenshu.png', 'ref3': 'c3_moat.png', 'ref4': 'c4_town.png', 'ref6': 'c6_interior.png'}
W, H = 1280, 720


def stats(im):
    im = im.convert('RGB').resize((320, 180), Image.BILINEAR)
    px = list(zip(*[b.histogram() and list(b.tobytes()) for b in im.split()])); n = len(px)
    lum = sum(0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in px) / n / 255
    warm = sum(r - b for r, g, b in px) / n / 255
    hsv = list(zip(*[list(b.tobytes()) for b in im.convert('HSV').split()])); hist = [0.0] * 18; sat = 0
    for h, s, v in hsv:
        sat += s; hist[min(17, h * 18 // 256)] += s * (v / 255)
    tot = sum(hist) or 1; hist = [x / tot for x in hist]
    e = im.convert('L').filter(ImageFilter.FIND_EDGES); edge = sum(e.histogram()[25:]) / n
    return {'lum': round(lum, 4), 'sat': round(sat / n / 255, 4), 'warm': round(warm, 4), 'edge': round(edge, 4), 'hist': [round(x, 4) for x in hist]}


def dist(a, b):
    return {'lum': round(abs(a['lum'] - b['lum']), 4), 'hue': round(sum(abs(x - y) for x, y in zip(a['hist'], b['hist'])), 4), 'edge': round(abs(a['edge'] - b['edge']), 4), 'sat': round(abs(a['sat'] - b['sat']), 4), 'warm': round(abs(a['warm'] - b['warm']), 4)}


def side(ref, ren, path):
    a = ref.convert('RGB').resize((W // 2, H // 2)); b = ren.convert('RGB').resize((W // 2, H // 2))
    c = Image.new('RGB', (W, H // 2)); c.paste(a, (0, 0)); c.paste(b, (W // 2, 0)); c.save(path, quality=88)


def serve(d):
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=d))
    threading.Thread(target=srv.serve_forever, daemon=True).start(); return srv


def shoot(pg, port, h, path, pose=None, interior=None):
    pg.goto('about:blank'); pg.goto(f'http://127.0.0.1:{port}/index.html#{h}')
    pg.wait_for_function('window.__castle && (window.__castle.ready && window.__castle.bldgDetail || window.__castle.errors.length)', timeout=300000)
    pg.add_style_tag(content='#ui,#hint,#minimap,#khint,#btip{display:none!important}')
    pg.wait_for_timeout(1200)
    if interior is not None:
        pg.evaluate('([b, r]) => __castle.enterInterior(b, r)', interior); pg.wait_for_timeout(800)
        if pose: pg.evaluate('([c, t]) => __castle.poseInt(c, t)', pose)
    elif pose:
        pg.evaluate('([a, t]) => __castle.look(a, t)', pose)
    pg.evaluate('__castle.renderNow()'); pg.wait_for_timeout(300)
    t = time.time(); pg.evaluate('__castle.renderNow()'); ft = time.time() - t
    pg.screenshot(path=path, timeout=240000)
    return ft, pg.evaluate('__castle.errors.slice(0, 3)')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--refs', default=os.environ.get('VIS_REFS', os.path.join(ROOT, '..', 'work', 'c1', 'refs')))
    ap.add_argument('--out', default=os.environ.get('VIS_OUT', os.path.join(ROOT, 'web', 'shots', 'visual')))
    ap.add_argument('--json', default=None)
    ap.add_argument('--before', default=None, help='older web dir rendered with the same camera poses')
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    only = [x for x in a.only.split(',') if x] or list(REFS)
    from playwright.sync_api import sync_playwright
    rep = {'size': [W, H], 'refs': {}}
    srv = serve(T.WEB); port = srv.server_address[1]
    srvB = serve(a.before) if a.before else None
    with sync_playwright() as p:
        b = p.chromium.launch(args=T.ARGS); pg = b.new_page(viewport={'width': W, 'height': H}); pg.route('https://unpkg.com/**', T.route_vendor)
        for k in only:
            refp = os.path.join(a.refs, REFS[k]); R = {}
            hsh = f'seed=1&lost=1&view={k}&labels=0&q=2&anim=0'
            ren = os.path.join(a.out, f'{k}_after.png'); ft, err = shoot(pg, port, hsh, ren)
            pose = pg.evaluate('(() => { const C = __castle; if (C.intMode && C.intMode()) { const m = C.intMode(); return { int: true, b: m.b ? m.b.id : null, cam: C.cur().cam, tgt: C.cur().tgt }; } return { int: false, cam: C.cur().cam, tgt: C.cur().tgt }; })()')
            R['after'] = stats(Image.open(ren)); R['frame_s'] = round(ft, 3); R['errors'] = err; R['pose'] = pose; R['quality'] = pg.evaluate('__castle.quality')
            if os.path.exists(refp):
                ri = Image.open(refp); R['ref'] = stats(ri); R['dist_after'] = dist(R['after'], R['ref'])
                side(ri, Image.open(ren), os.path.join(a.out, f'{k}_side.jpg'))
            if srvB:
                bp = os.path.join(a.out, f'{k}_before.png')
                if pose['int']:
                    shoot(pg, srvB.server_address[1], 'seed=1&lost=1&view=aerial&labels=0&q=2&tod=e', bp, [pose['cam'], pose['tgt']], [pose['b'], None])
                else:
                    shoot(pg, srvB.server_address[1], 'seed=1&lost=1&view=aerial&labels=0&q=2&tod=e', bp, [pose['cam'], pose['tgt']])
                R['before'] = stats(Image.open(bp))
                if 'ref' in R:
                    R['dist_before'] = dist(R['before'], R['ref']); side(Image.open(bp), Image.open(ren), os.path.join(a.out, f'{k}_before_after.jpg'))
            rep['refs'][k] = R; print(k, json.dumps({x: R[x] for x in R if x.startswith('dist') or x == 'frame_s'}), flush=True)
        b.close()
    srv.shutdown()
    if srvB: srvB.shutdown()
    out = a.json or os.path.join(a.out, 'vstats.json')
    json.dump(rep, open(out, 'w'), indent=1); print('VISUAL_REPORT', out)


if __name__ == '__main__':
    main()
