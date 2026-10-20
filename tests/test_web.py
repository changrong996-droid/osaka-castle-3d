"""Headless-browser acceptance test for castle/web (rule-driven three.js site).

Run:  python3 tests/test_web.py            (or: pytest tests/test_web.py)
Needs: pip install playwright && python3 -m playwright install chromium
       (in the Hark sandbox:  . ../work/setup_pw.sh  provides a persistent Chromium + missing libs)

Asserts: (B3/web-r11) H28 stairs + H29 windows == 0 in the page audit; C12 keyboard stair walk up+down for every stair == 0 and its fault (stairgap) is caught; every window aperture is see-through (three.js ray from inside through a lattice gap reaches beyond the wall: terrain/other buildings/sky); a shot from inside 千貫櫓 looking out through a lattice window (int_window_out.png) is neither black nor blown out. (B2/web-r10) C11 never-see-underground fuzz (exterior from 80+ start points incl. grid/outer/ring edges, ishigaki, moat banks, building bases; interior walking/looking in every building) == 0 and its fault injection (ring, intnear) is caught; hover-highlight + click-to-enter, label hiding, minimap + click-to-jump, keyboard walking without penetration + stairs. (r6) camera collision uses the conforming (split) terrain · H1–H21 all 0 · node fault injection (tests/test_faults.js: every H15–H21 rule catches its injected violation) · C8 (camera under each wooden bridge) incl. an injected obstacle · page loads without console errors · audit total == 0 (江戸盛期 and 现状) · camera audit C1–C7 == 0 (C6 walk through every gate at eye height,
C7 fast-drag tunneling fuzz), per-frame walk-through-Otemon animation clear + tunnel-free + actually under the gate lintel, extra fuzz,
per-frame animated transitions clear, independent triangle-exact check, real mouse wheel/drag input never leaves the camera inside solids · URL hash reproducible
(same hash -> same signature, other seed -> different) · writes one screenshot per view (incl. inside the Otemon gate opening) to web/shots/.
three.js is requested from unpkg; when the sandbox cannot reach the CDN those requests are served from web/vendor/.
"""
import functools, http.server, json, os, socketserver, sys, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'web')
SHOTS = os.path.join(WEB, 'shots')
VIEWS = ['aerial', 'top', 'otemon', 'tenshu', 'eastwall', 'otejoint', 'sakura', 'otegate', 'bridge', 'goten', 'ref2', 'ref3', 'ref4']
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
            dt = time.time() - t
            # r6：首次加载的 H 审计在第一帧之后跑 → 等它出结果
            pg.wait_for_function('window.__castle && (window.__castle.auditResult || window.__castle.errors.length)', timeout=240000)
            rep.setdefault('audit_ready_s', []).append(round(time.time() - t, 2))
            return dt

        rep['load_s'] = round(load('#seed=1&lost=1&view=aerial&labels=1'), 2)
        if not pg.evaluate('!!__castle.ready'):
            raise RuntimeError('page failed: ' + json.dumps(pg.evaluate('__castle.errors')) + ' ' + json.dumps(rep['errors']))
        st = pg.evaluate('({a: __castle.auditResult, sig: __castle.signature, stats: __castle.stats, loadMs: __castle.loadMs, errs: __castle.errors})')
        rep.update(audit=st['a']['total'], audit_cnt=st['a']['cnt'], audit_items=st['a']['items'][:20], sig1=st['sig'], stats=st['stats'], app_load_ms=st['loadMs'])
        rep['errors'] += st['errs']
        rep['pack'] = pg.evaluate('__castle.pack || null')  # r8a：默认视图应读预构建包
        pg.wait_for_function('__castle.camAudit', timeout=120000)
        ca = pg.evaluate('__castle.camAudit')
        rep.update(cam_audit=ca['total'], cam_cnt=ca['cnt'], cam_items=ca['items'][:10], cam_near=ca['near'])
        # 更强的模糊测试（3 个种子 × 1500 步）+ r2 旧相机逻辑在同一套检查下的违规数（对照）
        rep['cam_fuzz'] = [pg.evaluate(f'__castle.cameraAudit({{fuzz:1500, seed:{sd}}}).cnt.C4') for sd in (11, 23, 37)]
        rep['cam_legacy'] = pg.evaluate('__castle.cameraAudit({legacy:true}).cnt')
        rep['cam_old_r3'] = pg.evaluate('__castle.cameraAudit({old:true}).cnt')  # web-r3 逻辑（柱状场 + 抬升）下的 C6/C7
        rep['cam_gates'] = ca['gates']; rep['cam_bridges'] = ca['bridges']; rep['cam_interiors'] = ca.get('interiors'); rep['c11'] = ca.get('c11')
        rep['c12'] = ca.get('c12')
        # B3：窓通视（three.js 射线对场景所有可见网格）+ 从室内看窓外的截图（千貫櫓 1 階 城外侧的格子窓，看得见石垣/堀/远处）
        rep['win_rays'] = pg.evaluate("""() => { const C = __castle, out = { n: 0, ok: 0, sky: 0, ex: [], bldgs: 0 }; for (const b of C.bldg.list) { C.enterInterior(b.id); const r = C.windowRays(b.id); out.n += r.n; out.ok += r.ok; out.sky += r.sky; out.bldgs++; for (const e of r.ex) if (out.ex.length < 6) out.ex.push(b.name + ' ' + e); } C.exitInterior(); return out; }""")
        rep['win_view'] = pg.evaluate("""() => { const C = __castle, B = window.CASTLE_BLDG, b = C.bldg.list.find(q => q.name === '千貫櫓'), G = B.geoOf(b), w = G.ext.wa.find(q => q.o.kind === 'window' && q.o.f === 0 && b.outSides.includes(q.o.side)); if (!w) return null; const a = w.ap, o = B.outerOf(b, a.sd, a.line), P = (s2, d, z) => { const uv = a.sd === 0 ? [o - d, s2] : a.sd === 1 ? [o + d, s2] : a.sd === 2 ? [s2, o - d] : [s2, o + d], [x, y] = b.fr.w(uv[0], uv[1]); return [x, y, z]; }, zm = (a.z0 + a.z1) / 2, nb = w.parts.filter(q => q.tag === 'bar').length, sx = a.s0 + (a.s1 - a.s0) / nb * Math.floor(nb / 2);
            C.enterInterior(b.id); C.poseInt(P(sx, a.t + 0.8, zm), P(sx, -30, zm - 6)); const TH = C.THREE, rc = new TH.Raycaster(), cam = C.camera; rc.setFromCamera(new TH.Vector2(0, -0.2), cam); const ms = []; C.scene.traverse(m => { if (m.isMesh) { for (let q = m; q; q = q.parent) if (!q.visible) return; ms.push(m); } }); const h = rc.intersectObjects(ms, false).filter(x => x.distance > 0.05)[0];
            return { name: b.name, hit: h ? h.object.name : 'sky', dist: h ? +h.distance.toFixed(1) : null }; }""")
        if shots and rep['win_view']:
            pg.wait_for_timeout(300); pg.evaluate('__castle.renderNow()'); pg.screenshot(path=os.path.join(SHOTS, 'int_window_out.png'))
            from PIL import Image
            im = Image.open(os.path.join(SHOTS, 'int_window_out.png')).convert('L'); W0, H0 = im.size; px = list(im.crop((W0 // 4, H0 // 4, W0 * 3 // 4, H0 * 3 // 4)).resize((64, 40)).getdata())
            rep['win_view']['lum'] = [min(px), round(sum(px) / len(px)), max(px)]
        pg.evaluate('__castle.exitInterior()')
        # B1：建筑语法——读包、按需建内部（不阻塞：单栋建内部的耗时）、进入室内（御殿 + 一座橹），室内相机球清空、拖动不出墙
        rep['bldg'] = pg.evaluate("""() => { const C = __castle, W = C.bldg, out = { n: W.list.length, bpack: C.bpack, by: {}, enter: [] }; for (const b of W.list) { const k = b.type + '/' + b.tier; out.by[k] = (out.by[k] || 0) + 1; }
            for (const b of [W.list.find(b => b.type === 'goten'), W.list.find(b => b.type === 'yagura' && b.F.length === 3), W.list.find(b => b.tier === 'measured')]) { if (!b) continue; const t0 = performance.now(), r = C.enterInterior(b.id), ms = performance.now() - t0; let bad = 0; const q0 = C.cur().cam;
              for (let k = 0; k < 40; k++) { const d = [Math.cos(k) * 3, Math.sin(k * 1.7) * 3, Math.sin(k) * 1.5]; C.camera.position.set(q0[0] + d[0], q0[2] + d[2], -(q0[1] + d[1])); C.enforce(); const q = C.cur().cam; if (__castle.bldgClear(b.id, q) < 0.25 - 1e-3) bad++; }
              out.enter.push({ name: b.name, room: r && r.name, what: r && r.what, ms: +ms.toFixed(1), bad, built: C.interiorsBuilt().includes(b.id) }); C.exitInterior(); }
            return out; }""")
        # r6：相机碰撞用的是切分后的地形（与渲染同一张三角网）：在切开的格里、切分地面以上 0.3 m 的点，到地形的精确间隙 ≤0.3 m（若还用网格三角，顶线处会多出最多 ~1 m）
        rep['cam_terrain'] = pg.evaluate("""() => { const S = __castle.site, F = __castle.camField; let n = 0, over = 0, gridOff = 0, worst = 0;
            for (let k = 0; k < S.splitTris.length; k += 7) { const sp = S.splitTris[k]; if (sp.kind === 'dead') continue; const T = sp.tris; for (let t = 0; t < T.length; t += 9) { const x = (T[t] + T[t + 3] + T[t + 6]) / 3, y = (T[t + 1] + T[t + 4] + T[t + 7]) / 3, z = S.heightAt(x, y);
              if (z < S.wzAt(x, y) + 0.5) continue; n++; const d = F.clearance([x, y, z + 0.3], 3); worst = Math.max(worst, d); if (d > 0.3 + 1e-3) over++; // 负值 = 离别的几何（墙、树）更近，不算
              const q = sp.q, i = q % S.NX, j = (q - i) / S.NX, u = (x - S.X(i)) / S.cell, v = (y - S.Y(j)) / S.cell, H = S.H, a = q, b = q + 1, c = q + S.NX, d2 = c + 1, zg = u >= v ? H[a] + u * (H[b] - H[a]) + v * (H[d2] - H[b]) : H[a] + v * (H[c] - H[a]) + u * (H[d2] - H[c]); if (Math.abs(zg - z) > 0.1) gridOff++; } }
            return { n, over, gridOff, worst: +worst.toFixed(3), tris: __castle.terrainTris }; }""")
        # 步行穿过大手门：合成时钟逐帧驱动真实 step()，每帧检查合法、两帧之间不穿几何；统计在遮盖下（门洞里）的帧数和最低眼高
        rep['cam_walk'] = pg.evaluate("""() => { const C = __castle, F = C.camField, S = C.site; C.setView('otemon'); let t = 1000; if (!C.walkThrough('otemon', t)) return null; let prev = C.cur().cam, n = 0, bad = 0, tun = 0, under = 0, eyeMin = 1e9;
            while (C.anim() && n < 20000) { t += 16; C.step(t); n++; const q = C.cur().cam; if (!F.clear(q, 1e-3)) bad++; if (F.segHit(prev, q)) tun++; if (!F.above(q)) { under++; const e = q[2] - S.surfaceAt(q[0], q[1]); if (e < eyeMin) eyeMin = e; } prev = q; }
            return { frames: n, bad, tun, under, eyeMin: +eyeMin.toFixed(2) }; }""")
        # 动画过渡：用合成时钟逐帧（16 ms）驱动真实的 step()（插值 + OrbitControls.update + 约束），每帧检查清空、终点 = 视角预设
        # （headless swiftshader 每帧渲染 ~1 s，按墙钟采样只能拿到 1–3 帧，所以不用 rAF）
        rep['cam_anim'] = pg.evaluate("""() => { const C = __castle, V = Object.keys(C.VIEWS), out = []; for (const a of V) for (const b of V) { if (a === b) continue;
            C.setView(a); C.goView(b); const A = C.anim(); let bad = 0, n = 0; for (let t = A.s; t <= A.s + A.dur * 1000 + 200; t += 16) { C.step(t); n++; if (!C.camField.clear(C.cur().cam, 1e-3)) bad++; }
            const q = C.cur(), p = C.presets[b], end = Math.hypot(q.cam[0] - p.cam[0], q.cam[1] - p.cam[1], q.cam[2] - p.cam[2]); out.push({ a, b, frames: n, bad, end: +end.toFixed(3), lift: +A.maxLift.toFixed(1) }); } return out; }""")
        # B2：外景悬停/单击进入、标注隐藏、小地图、键盘步行（真实键盘/鼠标事件）
        rep['b2'] = b2_checks(pg, SHOTS if shots else None)
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
        # 故障注入（C8）：桥下横一根梁，C8 必须报出来
        # B2：C11 的故障注入——ring：相机碰撞场不用渲染外圈地面（r4–r9 的拟合面外推）；intnear：室内近平面不随球半径缩小（r9 回归）。C11 必须两处都报
        load('#seed=1&lost=1&view=top&labels=0&fault=c8,ring,intnear,stairgap')
        pg.wait_for_function('__castle.camAudit', timeout=240000)
        rep['c8_fault'] = pg.evaluate('__castle.camAudit.cnt.C8')
        rep['c11_fault'] = pg.evaluate('(() => { const c = __castle.camAudit.c11; return { ext: c.ext.bad, int: c.int.bad, byTag: c.ext.byTag, ex: c.ext.ex.slice(0, 2).concat(c.int.ex.slice(0, 1)) }; })()')
        rep['c12_fault'] = pg.evaluate('(() => { const c = __castle.camAudit.c12; return { bad: c.bad, stairs: c.stairs, ex: c.ex.slice(0, 2) }; })()')  # B3：stairgap = 每座階段中间一级踏板不算支撑 → C12 必须报
        # reproducibility
        load('#seed=1&lost=1&view=top&labels=0')
        rep['sig1_again'] = pg.evaluate('__castle.signature')
        load('#seed=1&lost=1&view=top&labels=0&pack=0')  # r8a：强制现场生成 → 签名必须与读包相同，审计 0
        rep['sig1_live'] = pg.evaluate('__castle.signature'); rep['pack_off'] = pg.evaluate('__castle.pack || null'); rep['audit_live'] = pg.evaluate('__castle.auditResult.total')
        rep['load_live_s'] = rep['audit_ready_s'][-1]
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
    import subprocess  # 故障注入（H15–H18）：node tests/test_faults.js
    pr = subprocess.run(['node', os.path.join(ROOT, 'tests', 'test_faults.js')], capture_output=True, text=True)
    rep['faults_node'] = pr.returncode; rep['faults_log'] = pr.stdout.strip().splitlines()
    pr = subprocess.run(['node', os.path.join(ROOT, 'tests', 'test_bldg.js')], capture_output=True, text=True)  # B1：建筑审计 H22–H27/C9–C10 基线 + 故障注入
    rep['bldg_node'] = pr.returncode; rep['bldg_log'] = pr.stdout.strip().splitlines()
    pr = subprocess.run(['node', os.path.join(ROOT, 'tests', 'test_pack.js')], capture_output=True, text=True)  # r8a：包 = 现场生成（逐位）
    rep['pack_node'] = pr.returncode; rep['pack_log'] = pr.stdout.strip().splitlines()
    json.dump(rep, open(os.path.join(SHOTS, 'report.json'), 'w'), ensure_ascii=False, indent=1)
    return rep


def b2_checks(pg, shotdir=None):
    """B2 (web-r10): hover highlight + click-to-enter (real mouse), label hiding, minimap presence + click-to-jump (real click),
    keyboard walking (real key events, synthetic 30 fps clock driving the real step()): every frame sphere valid, no penetration, C11 clean, stairs followed."""
    out = {}
    pg.evaluate('__castle.setView("goten")'); pg.evaluate('__castle.renderNow()')
    # 找一栋在画面里、没被挡住的建筑（屏幕坐标 = 包围盒中心投影）
    cand = pg.evaluate("""() => { const C = __castle, out = []; for (const b of C.bldg.list) { const s = C.bldgScreen(b.id); if (s.z < 1 && s.x > 360 && s.x < 1240 && s.y > 60 && s.y < 760 && C.pick(s.x, s.y) === b.id) out.push({ id: b.id, x: s.x, y: s.y, name: b.name, type: b.type, F: b.F.length }); } return out; }""")
    out['hover_cands'] = len(cand)
    if not cand:
        return out
    c = sorted(cand, key=lambda q: (q['type'] != 'yagura', -q['F']))[0]
    out['labels_before'] = pg.evaluate('__castle.labelsVisible()')
    pg.mouse.move(c['x'] - 30, c['y'] - 30); pg.mouse.move(c['x'], c['y'], steps=3); pg.wait_for_timeout(150)
    out['hover'] = pg.evaluate('__castle.hover()'); out['hover_want'] = c['id']; out['hl_visible'] = pg.evaluate('__castle.hlVisible()')
    out['tip'] = pg.evaluate("document.getElementById('btip').style.display === 'block' && document.getElementById('btip').textContent")
    if shotdir:
        pg.evaluate('__castle.renderNow()'); pg.wait_for_timeout(200); pg.screenshot(path=os.path.join(shotdir, 'ext_hover.png'))
    pg.mouse.click(c['x'], c['y']); pg.wait_for_timeout(200)
    out['entered'] = pg.evaluate('__castle.intMode()'); out['labels_inside'] = pg.evaluate('__castle.labelsVisible()')
    out['minimap'] = pg.evaluate('(() => { const m = __castle.minimap(); return { visible: m.visible, floor: m.floor, rooms: m.rooms.length, cam: !!m.cam }; })()')
    out['khint'] = pg.evaluate("getComputedStyle(document.getElementById('khint')).display")
    out['c11_enter'] = pg.evaluate('__castle.c11Int()')
    # 键盘步行：真实按键（keydown 进 KEYS），合成时钟驱动真实 step()；每帧：球合法 + 两帧之间不穿实体（球扫掠）+ C11
    def walk(keys, frames):
        for k in keys: pg.keyboard.down(k)
        r = pg.evaluate("""(n) => { const C = __castle; let t = 100000 + Math.random() * 1000, bad = 0, c11 = 0, moved = 0, zs = new Set(), prev = C.cur().cam, tun = 0; C.step(t);
            for (let k = 0; k < n && C.intMode(); k++) { t += 33; C.step(t); const q = C.cur().cam; if (!C.intValid(q)) bad++; if (C.c11Int()) c11++;
              const L = Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]), N = Math.max(1, Math.ceil(L / 0.02)); for (let s = 1; s < N; s++) { const p = [0, 1, 2].map(i => prev[i] + (q[i] - prev[i]) * s / N); if (!C.intValid(p)) { tun++; break; } }
              moved += Math.hypot(q[0] - prev[0], q[1] - prev[1]); zs.add(q[2].toFixed(2)); prev = q; }
            return { bad, c11, tun, moved: +moved.toFixed(2), zLevels: zs.size, inside: !!C.intMode(), cam: C.cur().cam.map(v => +v.toFixed(2)) }; }""", frames)
        for k in keys: pg.keyboard.up(k)
        return r
    out['walk'] = [walk(['ArrowUp'], 90), walk(['ArrowLeft'], 20), walk(['ArrowUp'], 120), walk(['KeyD'], 40), walk(['KeyS'], 60), walk(['ArrowRight', 'KeyW'], 120)]
    # 撞墙：长时间往前走（墙/隔断挡住，不能穿过去）
    out['walk_wall'] = walk(['ArrowUp'], 400)
    # 上楼：用小地图跳到有階段的房间附近不确定——直接在所有楼层>1 的橹里找下层階段底，朝階段方向走，眼高必须上升到上一层
    out['stairs'] = pg.evaluate("""() => { const C = __castle, B = C.bldg.list.find(b => b.type === 'yagura' && b.stairs.length && b.F.length >= 2); if (!B) return null; C.exitInterior(); C.enterInterior(B.id); const st = B.stairs[0], BL = window.CASTLE_BLDG;
        const [i0, j0, i1, j1] = st.rect, d = BL.NB[st.dir], cu = (i0 + i1) / 2, cv = (j0 + j1) / 2, L = st.dir < 2 ? i1 - i0 : j1 - j0, su = cu - d[0] * (L / 2 + 1.2), sv = cv - d[1] * (L / 2 + 1.2), [x, y] = B.fr.w(BL.U(B, su), BL.V(B, sv)), [x2, y2] = B.fr.w(BL.U(B, cu + d[0] * L), BL.V(B, cv + d[1] * L));
        const cam = [x, y, B.F[st.f].z + BL.SPEC.cam.eye]; if (!C.intValid(cam)) return { skip: 'start invalid' }; C.camera.position.set(cam[0], cam[2], -cam[1]); C.enforce(); C.lookYP.yaw = Math.atan2(y2 - y, x2 - x); C.lookYP.pitch = 0; C.applyLook();
        const z0 = C.cur().cam[2]; let t = 50000, bad = 0, c11 = 0; C.keys.add('ArrowUp'); C.step(t); for (let k = 0; k < 240 && C.intMode(); k++) { t += 33; C.step(t); if (!C.intValid(C.cur().cam)) bad++; if (C.c11Int()) c11++; } C.keys.clear();
        for (let k = 0; k < 40 && C.intMode(); k++) { t += 33; C.step(t); } const z1 = C.cur().cam[2]; return { name: B.name, z0: +z0.toFixed(2), z1: +z1.toFixed(2), rise: +(z1 - z0).toFixed(2), want: +st.rise.toFixed(2), bad, c11, floor: C.minimap().camFloor }; }""")
    # 小地图：真实点击一个房间 → 相机跳到那个房间的机位
    pg.evaluate('__castle.drawMinimap()')
    mm = pg.evaluate('__castle.minimap()')
    out['mm_click'] = None
    if mm['rooms']:
        cur = pg.evaluate('__castle.cur().cam'); best = None
        for r in mm['rooms']:
            dd = (r['px'] - (mm['cam']['x'] if mm['cam'] else 0)) ** 2 + (r['py'] - (mm['cam']['y'] if mm['cam'] else 0)) ** 2
            if best is None or dd > best[0]: best = (dd, r)
        r = best[1]; j0 = pg.evaluate('__castle.mmJumps || 0')
        pg.mouse.click(mm['rect']['left'] + r['px'], mm['rect']['top'] + r['py']); pg.wait_for_timeout(150)
        after = pg.evaluate('__castle.cur().cam')
        out['mm_click'] = {'room': r['name'], 'jumps': pg.evaluate('__castle.mmJumps || 0') - j0, 'moved': round(sum((a - b) ** 2 for a, b in zip(after, cur)) ** 0.5, 2), 'valid': pg.evaluate('__castle.intValid(__castle.cur().cam)'), 'c11': pg.evaluate('__castle.c11Int()')}
    if shotdir:
        pg.evaluate("(() => { const C = __castle; C.lookYP.pitch = -0.12; C.applyLook(); C.drawMinimap(); C.renderNow(); })()"); pg.wait_for_timeout(250)
        pg.screenshot(path=os.path.join(shotdir, 'int_minimap.png'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    out['exited'] = pg.evaluate('!__castle.intMode()'); out['labels_after'] = pg.evaluate('__castle.labelsVisible()')
    out['mm_after'] = pg.evaluate('__castle.minimap().visible'); out['c11_after'] = pg.evaluate('__castle.c11Ext()')
    return out


def b2_ok(o):
    assert o.get('hover_cands', 0) > 0 and o['hover'] == o['hover_want'] and o['hl_visible'] and o['tip'], o
    assert o['entered'] and o['entered']['b'] == o['hover_want'], o
    assert o['labels_before'] is True and o['labels_inside'] is False and o['labels_after'] is True, o
    assert o['minimap']['visible'] and o['minimap']['rooms'] > 0 and o['minimap']['cam'] and o['khint'] == 'block', o
    assert o['c11_enter'] is None and o['c11_after'] is None and o['exited'] and not o['mm_after'], o
    assert all(w['bad'] == 0 and w['c11'] == 0 and w['tun'] == 0 for w in o['walk'] + [o['walk_wall']]), o
    assert sum(w['moved'] for w in o['walk']) > 3, o
    st = o['stairs']
    assert st and st.get('bad') == 0 and st.get('c11') == 0 and abs(st['rise'] - st['want']) < 0.3, st
    mc = o['mm_click']
    assert mc and mc['jumps'] == 1 and mc['valid'] and mc['c11'] is None, mc


def check(rep):
    assert not rep['errors'], rep['errors']
    assert rep['audit'] == 0, rep['audit_items']
    assert rep['audit_now'] == 0, rep['audit_now_items']
    assert rep['audit_seed2'] == 0
    assert rep['cam_audit'] == 0, rep['cam_items']
    assert rep['cam_fuzz'] == [0, 0, 0], rep['cam_fuzz']
    assert len(rep['cam_anim']) == len(VIEWS) * (len(VIEWS) - 1) and all(a['bad'] == 0 and a['end'] < 0.05 for a in rep['cam_anim']), [a for a in rep['cam_anim'] if a['bad'] or a['end'] >= 0.05]
    assert rep['cam_geo'] == {'C1': 0, 'C3': 0, 'C4': 0, 'C6': 0, 'C8': 0}, rep['cam_geo']
    assert rep['faults_node'] == 0, rep['faults_log']
    ct = rep['cam_terrain']
    assert ct['n'] > 1000 and ct['over'] == 0 and ct['gridOff'] > 0, ct
    assert all(rep['audit_cnt'][f'H{i}'] == 0 for i in range(1, 30)), rep['audit_cnt']
    c12 = rep['c12']; assert rep['cam_cnt'].get('C12') == 0 and c12 and c12['stairs'] >= 20 and c12['bad'] == 0, c12
    assert rep['c12_fault']['bad'] > 0, rep['c12_fault']
    wr = rep['win_rays']; assert wr['n'] >= 200 and wr['ok'] == wr['n'], wr
    wv = rep['win_view']; assert wv and wv['hit'] not in ('bldg', 'bldg-int', 'bldg-hull'), wv
    if 'lum' in wv: assert wv['lum'][2] - wv['lum'][0] > 60 and 25 < wv['lum'][1] < 235, wv
    assert rep['cam_cnt'].get('C9') == 0 and rep['cam_cnt'].get('C10') == 0 and rep['cam_interiors'] and rep['cam_interiors']['rooms'] > 100, (rep['cam_cnt'], rep['cam_interiors'])
    bl = rep['bldg']
    assert bl['n'] >= 20 and bl['bpack'] and bl['bpack'].get('used') and len(bl['enter']) == 3 and all(e['room'] and e['bad'] == 0 and e['built'] for e in bl['enter']), bl
    assert rep['bldg_node'] == 0, rep['bldg_log']
    assert rep['c8_fault'] > 0, rep['c8_fault']
    assert rep['cam_cnt'].get('C11') == 0 and rep['c11'] and rep['c11']['ext']['n'] >= 2000 and rep['c11']['int']['n'] >= 5000 and rep['c11']['int']['bldgs'] >= 20, rep.get('c11')
    assert rep['c11_fault']['ext'] > 0 and rep['c11_fault']['byTag'].get('ring', 0) > 0 and rep['c11_fault']['int'] > 0, rep['c11_fault']
    b2_ok(rep['b2'])
    assert all(b['ok'] for b in rep['cam_bridges']), rep['cam_bridges']
    w = rep['cam_walk']
    assert w and w['bad'] == 0 and w['tun'] == 0 and w['under'] > 0 and w['eyeMin'] >= 1.55, w
    assert rep['cam_input'] == 0
    assert rep['sig1'] == rep['sig1_again'], (rep['sig1'], rep['sig1_again'])
    assert rep['sig1'] != rep['sig2']
    assert rep['pack'] and rep['pack'].get('used'), rep['pack']
    assert rep['sig1_live'] == rep['sig1'] and rep['audit_live'] == 0 and not (rep['pack_off'] or {}).get('used'), (rep['sig1_live'], rep['audit_live'], rep['pack_off'])
    assert rep['pack_node'] == 0, rep['pack_log']
    for v in VIEWS:
        assert os.path.getsize(os.path.join(SHOTS, v + '.png')) > 20000, v


def test_web():
    check(run())


if __name__ == '__main__':
    r = run(shots='--noshots' not in sys.argv)
    print(json.dumps({k: v for k, v in r.items() if k not in ('audit_items', 'audit_now_items')}, ensure_ascii=False, indent=1))
    check(r)
    print('WEB_OK')
