#!/usr/bin/env python3
"""B4 (web-r12) UI readability: python3 tests/test_ui.py  (prints UI_OK)

Minimap (interior):
  - overview mode, every floor of every building (incl. 本丸御殿 and the 3-storey yagura): placed room/hall labels never overlap
    (axis-aligned bounding boxes incl. text height) and lie inside the canvas; label texts are short (no digits, no 入側/廊下/武者走り),
    no text twice on one floor; the 御殿 overview shows its hall names.
  - local (follow) mode: scale >= 10 px/m and the player's room is >= 40 px on its shorter side (goten entrance + every yagura entrance);
    no room labels in local mode; header shows building · floor and the current room; click-to-jump still works (real click).
Exterior labels:
  - for several preset views (aerial, top, gate close-ups, tenshu, bridge) x modes (1 = important, 2 = all): visible label boxes never overlap,
    count <= cap, all inside the viewport; mode 0 shows none; a hovered building always gets its label; labels hidden indoors.
  - no flicker: a slow orbit + zoom (80 small steps, 0.64 rad, -24 % distance) toggles each label at most twice (hysteresis).
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_web as T

EXT_VIEWS = ['aerial', 'top', 'otemon', 'sakura', 'otegate', 'tenshu', 'bridge', 'goten']
BAD = ('入側', '廊下', '武者走り')


def overlap(a, b, pad=0):
    return a[0] < b[2] + pad and a[2] > b[0] - pad and a[1] < b[3] + pad and a[3] > b[1] - pad


def run():
    from playwright.sync_api import sync_playwright
    srv, port = T.serve()
    rep = {'errors': [], 'mm': [], 'ext': [], 'local': []}
    with sync_playwright() as p:
        b = p.chromium.launch(args=T.ARGS)
        pg = b.new_page(viewport={'width': 1280, 'height': 800})
        pg.route('https://unpkg.com/**', T.route_vendor)
        pg.on('console', lambda m: rep['errors'].append('console: ' + m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: rep['errors'].append('pageerror: ' + str(e)))
        pg.goto(f'http://127.0.0.1:{port}/index.html#seed=1&lost=1&view=aerial')
        pg.wait_for_function('window.__castle && (window.__castle.ready && window.__castle.bldgDetail || window.__castle.errors.length)', timeout=240000)
        pg.wait_for_function('window.__castle && (window.__castle.camAudit || window.__castle.errors.length)', timeout=900000)  # B5: the async camera audit (C11 interior fuzz) enters interiors and calls mmJump - wait for it, or it races the click-to-jump check
        pg.evaluate("document.getElementById('ui').classList.add('min')")
        bl = pg.evaluate('__castle.bldg.list.map(b => ({ id: b.id, name: b.name, type: b.type, F: b.F.length }))')
        rep['n_bldg'] = len(bl)
        # ---- minimap overview: every building, every floor ----
        for B in bl:
            pg.evaluate(f'__castle.exitInterior(); __castle.enterInterior({B["id"]}); __castle.mmMode("overview")')
            for f in range(B['F']):
                mm = pg.evaluate(f'(() => {{ __castle.mmFloor({f}); return __castle.minimap(); }})()')
                L = mm['labels']; W, H = mm['rect']['width'], mm['rect']['height']
                ov = sum(1 for i in range(len(L)) for j in range(i + 1, len(L)) if overlap([L[i]['x0'], L[i]['y0'], L[i]['x1'], L[i]['y1']], [L[j]['x0'], L[j]['y0'], L[j]['x1'], L[j]['y1']]))
                out = sum(1 for l in L if l['x0'] < 0 or l['y0'] < 0 or l['x1'] > W or l['y1'] > H)
                bad = [l['text'] for l in L if any(ch.isdigit() for ch in l['text']) or any(x in l['text'] for x in BAD)]
                dup = len(L) - len(set(l['text'] for l in L))
                rep['mm'].append({'b': B['name'], 'f': f, 'n': len(L), 'ov': ov, 'out': out, 'bad': bad, 'dup': dup, 'texts': [l['text'] for l in L], 'hdr': mm['title']})
        # ---- minimap local: goten + every yagura, at the entrance ----
        for B in bl:
            if B['type'] not in ('goten', 'yagura'): continue
            mm = pg.evaluate(f'(() => {{ __castle.exitInterior(); __castle.enterInterior({B["id"]}); __castle.mmMode("local"); __castle.drawMinimap(); return __castle.minimap(); }})()')
            rep['local'].append({'b': B['name'], 's': mm['s'], 'curPx': mm['curPx'], 'labels': len(mm['labels']), 'title': mm['title'], 'cur': mm['cur']})
        # click-to-jump in local mode (real click on a room point inside the canvas, farthest from the player)
        gid = next(B['id'] for B in bl if B['type'] == 'goten')
        pg.evaluate(f'__castle.exitInterior(); __castle.enterInterior({gid}); __castle.mmMode("local"); __castle.drawMinimap()')
        mm = pg.evaluate('__castle.minimap()'); c = mm['cam']
        far = max(mm['rooms'], key=lambda r: (r['px'] - c['x']) ** 2 + (r['py'] - c['y']) ** 2) if mm['rooms'] else None
        j0 = pg.evaluate('__castle.mmJumps || 0')
        if far:
            pg.mouse.click(mm['rect']['left'] + far['px'], mm['rect']['top'] + far['py']); pg.wait_for_timeout(150)
        rep['jump'] = {'jumps': pg.evaluate('__castle.mmJumps || 0') - j0, 'valid': pg.evaluate('__castle.intValid(__castle.cur().cam)'), 'cur': pg.evaluate('__castle.minimap().cur')}
        rep['labels_inside'] = pg.evaluate('__castle.labelInfo().groupVisible')
        pg.evaluate('__castle.exitInterior()')
        # ---- exterior labels ----
        for mode in (1, 2):
            pg.evaluate(f'__castle.setLabelMode({mode})')
            for v in EXT_VIEWS:
                pg.evaluate(f'__castle.setView("{v}")'); li = pg.evaluate('__castle.labelInfo()')
                R = [s['rect'] for s in li['shown']]
                ov = sum(1 for i in range(len(R)) for j in range(i + 1, len(R)) if overlap(R[i], R[j]))
                out = sum(1 for r in R if r[0] < 0 or r[1] < 0 or r[2] > 1280 or r[3] > 800)
                rep['ext'].append({'mode': mode, 'view': v, 'n': len(R), 'vis': li['visible'], 'ov': ov, 'out': out, 'cap': li['cap'], 'texts': [s['text'] for s in li['shown']], 'tiers': sorted(set(s['tier'] for s in li['shown']))})
        pg.evaluate('__castle.setLabelMode(0)'); pg.evaluate('__castle.setView("aerial")'); rep['off'] = pg.evaluate('__castle.labelInfo().visible')
        pg.evaluate('__castle.setLabelMode(1)')
        # hovered building always labelled (goten is tier 1 → hidden in mode 1 unless hovered)
        pg.evaluate('__castle.setView("goten")')
        rep['hover'] = pg.evaluate(f'(() => {{ const C = __castle; const a = C.labelInfo().shown.some(s => s.bid === {gid}); C.setHoverId({gid}); const i = C.labelInfo(); const b = i.shown.some(s => s.bid === {gid}); C.setHoverId(null); return {{ before: a, during: b, n: i.shown.length }}; }})()')
        # flicker: slow orbit around the aerial target, count show/hide toggles per label
        pg.evaluate('__castle.setView("aerial")')
        rep['flicker'] = pg.evaluate("""(() => { const C = __castle, cam = C.cur().cam, tgt = C.cur().tgt, dx = cam[0] - tgt[0], dy = cam[1] - tgt[1], r = Math.hypot(dx, dy), a0 = Math.atan2(dy, dx); let prev = null; const tog = {};
            for (let k = 0; k <= 80; k++) { const a = a0 + k * 0.008, rr = r * (1 - k * 0.003); C.look([tgt[0] + rr * Math.cos(a), tgt[1] + rr * Math.sin(a), cam[2] - k * 0.3], tgt); const s = new Set(C.labelInfo().shown.map(q => q.text));
              if (prev) { for (const t of s) if (!prev.has(t)) tog[t] = (tog[t] || 0) + 1; for (const t of prev) if (!s.has(t)) tog[t] = (tog[t] || 0) + 1; } prev = s; }
            return { maxToggles: Math.max(0, ...Object.values(tog)), toggles: tog }; })()""")
        b.close()
    srv.shutdown()
    return rep


def check(rep):
    assert not rep['errors'], rep['errors']
    mm = rep['mm']; assert mm and all(m['ov'] == 0 and m['out'] == 0 and not m['bad'] and m['dup'] == 0 for m in mm), [m for m in mm if m['ov'] or m['out'] or m['bad'] or m['dup']]
    g = [m for m in mm if m['b'] == '本丸御殿']; assert g and g[0]['n'] >= 4, g
    for L in rep['local']:
        assert L['s'] >= 10 and L['labels'] == 0 and L['curPx'] and min(L['curPx']['w'], L['curPx']['h']) >= 40 and '·' in L['title'] and L['cur'] and L['cur'] != '—', L
    j = rep['jump']; assert j['jumps'] == 1 and j['valid'], j
    assert rep['labels_inside'] is False
    for e in rep['ext']:
        assert e['ov'] == 0 and e['out'] == 0 and e['n'] <= e['cap'] and e['vis'] == e['n'], e
        if e['mode'] == 1: assert e['tiers'] in ([], [0]), e
    assert any(e['n'] >= 5 for e in rep['ext'] if e['view'] == 'aerial'), rep['ext']
    assert rep['off'] == 0, rep['off']
    h = rep['hover']; assert h['during'] and not h['before'], h
    assert rep['flicker']['maxToggles'] <= 2, rep['flicker']


if __name__ == '__main__':
    t = time.time(); r = run()
    print(json.dumps({'n_bldg': r['n_bldg'], 'mm_floors': len(r['mm']), 'mm_goten': [m for m in r['mm'] if m['b'] == '本丸御殿'], 'mm_max_labels': max(m['n'] for m in r['mm']),
                      'local': r['local'][:3] + r['local'][-2:], 'local_min_room_px': min(min(L['curPx']['w'], L['curPx']['h']) for L in r['local'] if L['curPx']), 'jump': r['jump'],
                      'ext': r['ext'], 'off': r['off'], 'hover': r['hover'], 'flicker': r['flicker'], 'errors': r['errors'], 's': round(time.time() - t, 1)}, ensure_ascii=False, indent=1))
    check(r)
    print('UI_OK')
