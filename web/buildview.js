'use strict';
// ===== 筑城图 小样：界面 + 渲染（proto-build1）。读 SEQ（通用核心）+ SEQ_OSAKA（构件规格）。
// 经典脚本 + 运行时 importmap（同 app.js），htmlpreview.github.io 下可用。
(function () {
  const THREE_BASE = 'https://unpkg.com/three@0.160.0/';
  const $ = id => document.getElementById(id);
  const S = { errors: [], ready: false };
  window.__bv = S;
  window.addEventListener('error', e => S.errors.push(String(e.message)));
  const hp = new URLSearchParams(location.hash.replace(/^#/, ''));
  const fmt = (n, d) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 }).replace(/,/g, ' ');
  const sgn = y => (y >= 0 ? '+' : '−') + Math.abs(y).toFixed(2);

  async function main() {
    const im = document.createElement('script'); im.type = 'importmap';
    im.textContent = JSON.stringify({ imports: { three: THREE_BASE + 'build/three.module.js', 'three/addons/': THREE_BASE + 'examples/jsm/' } });
    document.head.appendChild(im);
    const t0 = performance.now();
    const B = window.SEQ_OSAKA.build(), plan = window.SEQ.plan(B.parts, B.rules); S.planMs = Math.round(performance.now() - t0);
    const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
    run(THREE, OrbitControls, B, plan);
  }

  function run(THREE, OrbitControls, B, plan) {
    const canvas = $('gl');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: hp.get('shot') === '1' });
    const PR = Math.min(window.devicePixelRatio || 1, 2); renderer.setPixelRatio(PR); renderer.setClearColor(0x000000, 0); renderer.info.autoReset = false;
    const scene = new THREE.Scene();
    const C = window.SEQ.compile(THREE, plan, { rise: 1.4 });
    scene.add(C.group);
    const cam = new THREE.PerspectiveCamera(30, 1, 1, 3000);
    const vp = $('vp'), ctl = new OrbitControls(cam, vp); ctl.enableDamping = true; ctl.dampingFactor = 0.09; ctl.maxPolarAngle = Math.PI * 0.53; ctl.minDistance = 25; ctl.maxDistance = 600;
    const HOME = { t: [-8, 13, 16], az: +(hp.get('az') || 33), el: +(hp.get('el') || 22), d: +(hp.get('d') || 215) };
    function home(az, el, d, tg) { const a = az * Math.PI / 180, e = el * Math.PI / 180, T = tg || HOME.t; ctl.target.set(T[0], T[1], T[2]); cam.position.set(T[0] + d * Math.cos(e) * Math.sin(a), T[1] + d * Math.sin(e), T[2] + d * Math.cos(e) * Math.cos(a)); ctl.update(); }
    home(HOME.az, HOME.el, HOME.d);
    // 图纸用正交相机（看北：从 +z 看向 −z）
    const sheets = [
      { el: $('sh1'), cam: new THREE.OrthographicCamera(), cut: [0, 0, 1, 39], win: [-27, 43, -21, 63] },
      { el: $('sh2'), cam: new THREE.OrthographicCamera(), cut: [0, 0, 1, 0], win: [-25, 41, -2, 62] },
    ];
    for (const s of sheets) { s.cam.position.set(0, 20, 400); s.cam.lookAt(0, 20, 0); s.cam.near = 1; s.cam.far = 1200; }

    // ---------- 状态 ----------
    const st = { t: hp.get('t') !== null ? Math.min(plan.total, +hp.get('t')) : 0, play: hp.get('play') !== '0', speed: 1, mode: hp.get('mode') === 'real' ? 0 : 1, ghost: hp.get('ghost') !== '0', cut: hp.get('cut') === '1', sheets: hp.get('sheets') !== '0', daysPerSec: plan.total / 48 };
    if (hp.get('t') !== null) st.play = hp.get('play') === '1';
    const U = C.U;
    // ---------- 静态 UI：阶段带 / 时间轴 / 自检 ----------
    const total = plan.total, bands = plan.bands;
    $('db-np').textContent = fmt(plan.parts.length) + ' 件 · ' + plan.steps.length + ' 步';
    $('db-ms').textContent = fmt(plan.steps.reduce((a, s) => a + (s.kind === 'build' ? s.mass : 0), 0) / 1000, 1) + ' kt';
    $('crumb').innerHTML = `OSK-T ▸ <b>筑城</b> ▸ ${plan.steps.length} 步 · ${fmt(plan.parts.length)} 构件 · 工期 ${fmt(total)} 日（${plan.date(0)} → ${plan.date(total)}，推算）`;
    $('g-t').textContent = fmt(total) + ' 日';
    const gantt = $('gantt'); gantt.innerHTML = bands.map((b, i) => `<div class="row" data-i="${i}"><span>${String(i + 1).padStart(2, '0')} ${b.name}</span><span class="tr"><i style="left:${b.a / total * 100}%;width:${Math.max(0.6, (b.b - b.a) / total * 100)}%"></i><b style="left:${b.a / total * 100}%;width:0"></b></span><span class="pc">0%</span></div>`).join('') + '<div class="cl"></div>';
    const gRows = [...gantt.querySelectorAll('.row')], gCl = gantt.querySelector('.cl');
    const tr = $('track'), tb = tr.querySelector('.bands');
    tb.innerHTML = bands.map((b, i) => `<i class="${i % 2 ? 'o' : ''}" style="left:${b.a / total * 100}%;width:${(b.b - b.a) / total * 100}%"></i>`).join('');
    let lastLab = -1e9; for (const b of bands) { const x = b.a / total * 100; tr.insertAdjacentHTML('beforeend', `<span class="tick" style="left:${x}%"></span>`); if (x - lastLab > 6.5) { tr.insertAdjacentHTML('beforeend', `<span class="lab" style="left:${x}%">${b.name}</span>`); lastLab = x; } }
    const A = plan.audit;
    $('chk').innerHTML = `R1 支承 ${A.nSup} 条 · R2 先挖后建 ${A.nDig} 条 · R3 阶段 after ${A.nAfter} 条<br>无支承步骤 <b class="${A.unsupported.length ? 'ng' : ''}">${A.unsupported.length}</b> · 依赖成环 <b class="${A.cyclic ? 'ng' : ''}">${A.cyclic}</b> · 排序 ${S.planMs} ms<br>数量全部由几何推出：石 = 生成的石块数 · 瓦 = 瓦面面积 × ${B.ruleParams.tilePerM2.toFixed(1)} 枚/m² · 吨 = 体积 × 密度`;
    $('h-tr').textContent = fmt(C.tris); $('h-sg').textContent = fmt(C.segs); $('h-pr').textContent = PR.toFixed(2);

    // ---------- 交互 ----------
    const setBtn = () => { $('b-mode').classList.toggle('on', st.mode === 1); $('b-mode').firstChild.textContent = st.mode ? '墨线·淡彩 ' : '写实着色 '; $('b-ghost').classList.toggle('on', st.ghost); $('b-cut').classList.toggle('on', st.cut); $('p-p').firstChild.textContent = st.play ? '❚❚' : '▶'; $('p-s').firstChild.textContent = '×' + st.speed; $('p-sh').classList.toggle('on', st.sheets); $('db-cut').textContent = st.cut ? 'B–B x=0' : '关'; for (const s of sheets) s.el.style.visibility = st.sheets ? 'visible' : 'hidden'; };
    $('b-mode').onclick = () => { st.mode ^= 1; setBtn(); };
    $('b-ghost').onclick = () => { st.ghost = !st.ghost; setBtn(); };
    $('b-cut').onclick = () => { st.cut = !st.cut; setBtn(); };
    $('b-view').onclick = () => home(HOME.az, HOME.el, HOME.d);
    $('p-p').onclick = () => { if (!st.play && st.t >= total) st.t = 0; st.play = !st.play; setBtn(); };
    $('p-b').onclick = () => { st.t = 0; dirty = true; };
    const stepJump = dir => { const r = plan.at(st.t); const ss = plan.steps; let i = r.cur ? r.cur.i : ss.findIndex(s => s.start > st.t) - 1; i = Math.max(0, Math.min(ss.length - 1, i + dir)); st.t = ss[i].start + ss[i].dur * 0.55; st.play = false; setBtn(); dirty = true; };
    $('p-f').onclick = () => stepJump(1);
    $('p-s').onclick = () => { st.speed = st.speed === 1 ? 2 : st.speed === 2 ? 4 : 1; setBtn(); };
    $('p-sh').onclick = () => { st.sheets = !st.sheets; setBtn(); };
    let drag = false; const seek = e => { const r = tr.getBoundingClientRect(); st.t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total; dirty = true; };
    tr.addEventListener('pointerdown', e => { drag = true; tr.setPointerCapture(e.pointerId); seek(e); e.stopPropagation(); });
    tr.addEventListener('pointermove', e => { if (drag) seek(e); }); tr.addEventListener('pointerup', () => { drag = false; });
    window.addEventListener('keydown', e => { const k = e.key.toLowerCase();
      if (k === ' ') { $('p-p').onclick(); e.preventDefault(); } else if (k === 'c') $('b-mode').onclick(); else if (k === 'g') $('b-ghost').onclick(); else if (k === 'x') $('b-cut').onclick(); else if (k === 'v') $('b-view').onclick(); else if (k === 's') $('p-sh').onclick(); else if (k === 'arrowright') stepJump(1); else if (k === 'arrowleft') stepJump(-1); });
    setBtn();

    // ---------- 每帧 ----------
    const rectOf = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    let W = 0, H = 0, dirty = true;
    function resize() { W = window.innerWidth; H = window.innerHeight; renderer.setSize(W, H, false); layoutSheets(); }
    function layoutSheets() {
      for (const s of sheets) {
        const d = s.el.querySelector('.draw'), r = rectOf(d); s.r = r;
        const [x0, x1, y0, y1] = s.win, mpp = Math.max((x1 - x0) / r.w, (y1 - y0) / r.h), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        s.mpp = mpp; s.cx = cx; s.cy = cy;
        Object.assign(s.cam, { left: cx - r.w / 2 * mpp, right: cx + r.w / 2 * mpp, top: cy + r.h / 2 * mpp, bottom: cy - r.h / 2 * mpp }); s.cam.position.set(0, 0, 400); s.cam.lookAt(0, 0, 0); s.cam.updateProjectionMatrix();
        s.el.querySelector('.sc').textContent = '1:' + fmt(Math.round(mpp * 1000 * 96 / 25.4 / 50) * 50);
        // 标高线 + 轴线（SVG，与正交相机同一映射）
        const py = y => r.h / 2 - (y - cy) / mpp, px = x => r.w / 2 + (x - cx) / mpp, svg = s.el.querySelector('svg');
        svg.setAttribute('width', r.w); svg.setAttribute('height', r.h);
        let h = '';
        const lv = B.levels.filter(l => py(l.y) > 6 && py(l.y) < r.h - 4); let lastY = 1e9;
        for (const l of lv.sort((a, b) => a.y - b.y)) { const y = py(l.y); if (lastY - y < 9) continue; lastY = y; h += `<line x1="${r.w - 70}" x2="${r.w - 4}" y1="${y}" y2="${y}" stroke="#b3202a" stroke-width=".6" stroke-dasharray="3 2"/><path d="M${r.w - 70} ${y}l-4 -4h8z" fill="none" stroke="#b3202a" stroke-width=".7"/><text x="${r.w - 64}" y="${y - 2}" font-size="8" font-family="monospace" fill="#b3202a">${sgn(l.y)} ${l.n}</text>`; }
        for (const gx of [-14, 0, 14]) { const x = px(gx); h += `<line x1="${x}" x2="${x}" y1="10" y2="${r.h - 2}" stroke="#5d564c" stroke-width=".4" stroke-dasharray="8 2 1 2"/><circle cx="${x}" cy="8" r="5" fill="#f6f2ea" stroke="#5d564c" stroke-width=".6"/><text x="${x}" y="10.5" font-size="6.5" text-anchor="middle" font-family="monospace" fill="#1d1a17">${gx < 0 ? 'A' : gx ? 'C' : 'B'}</text>`; }
        h += `<g id="cur-${s.el.id}"><line x1="0" x2="${r.w}" y1="0" y2="0" stroke="#b3202a" stroke-width="1"/><text x="6" y="-3" font-size="8.5" font-family="monospace" fill="#b3202a">施工面</text></g>`;
        svg.innerHTML = h; s.cur = svg.querySelector('g'); s.py = py;
        const bar = 10 / mpp; s.el.querySelector('.sc').title = '10 m = ' + bar.toFixed(0) + ' px';
      }
    }
    window.addEventListener('resize', resize); resize();

    const logEl = $('logl'); let lastLogKey = '', lastUi = 0, lastStep = null;
    const verb = s => plan.stages[s.stage].verb, qty = s => { const t = s.tally, k = Object.keys(t)[0]; const u = { stone: '块', tile: '枚', col: '根', beam: '根', win: '窓', gold: '件' }; if (s.kind === 'remove') return fmt(s.vol) + ' m³'; if (s.kind === 'fill') return fmt(s.vol) + ' m³ 水'; return (k ? fmt(t[k]) + ' ' + u[k] + ' · ' : '') + fmt(s.mass, s.mass < 10 ? 1 : 0) + ' t'; };
    const elev = s => sgn(s.bb.min[1]) + '→' + sgn(s.bb.max[1]);
    function ui(r, now) {
      const s = r.cur || plan.steps.filter(x => x.end <= r.t).pop() || plan.steps[0], sn = plan.stages[s.stage];
      // 页眉状态
      $('st-stage').textContent = sn.name + (r.cur ? '' : ' · 已完成');
      $('st-step').textContent = `步骤 ${String(s.i + 1).padStart(3, '0')}/${plan.steps.length} · ${fmt(r.tally.stone || 0)} 块石`;
      $('st-bar').firstChild.style.width = (r.pct * 100).toFixed(1) + '%';
      $('st-date').textContent = plan.date(r.t); $('st-day').innerHTML = `第 ${fmt(r.t)} 日 / ${fmt(total)} · <b>推算</b>`;
      // 视口标题 + 图框
      $('ttl-k').textContent = `步骤 ${String(s.i + 1).padStart(3, '0')} / ${plan.steps.length} · ${sn.name} · 标高 ${sgn(r.elev == null ? 0 : r.elev)} m`;
      $('ttl-e').textContent = s.name + ' · ' + elev(s); $('ttl-e2').textContent = s.spec || '';
      $('db-st').textContent = sn.name; $('db-sp').textContent = String(s.i + 1).padStart(3, '0') + ' / ' + plan.steps.length;
      // 时间轴
      const pc = r.t / total * 100; tr.querySelector('.fill').style.width = pc + '%'; tr.querySelector('.knob').style.left = pc + '%';
      $('tlab').textContent = `${plan.date(r.t)} · 第 ${fmt(r.t)}/${fmt(total)} 日`;
      gCl.style.left = `calc(76px + (100% - 110px) * ${r.t / total})`;
      bands.forEach((b, i) => { const done = b.steps.reduce((a, x) => a + Math.max(0, Math.min(1, (r.t - x.start) / x.dur)) * x.dur, 0) / b.steps.reduce((a, x) => a + x.dur, 0);
        const row = gRows[i]; row.className = 'row' + (b.key === s.stage && r.cur ? ' cur' : done >= 1 ? ' done' : ''); row.querySelector('.pc').textContent = Math.round(done * 100) + '%';
        row.querySelector('b').style.width = ((Math.min(r.t, b.b) - b.a) > 0 ? (Math.min(r.t, b.b) - b.a) / total * 100 : 0) + '%'; });
      // 当前步骤卡
      const p = r.cur ? r.p : 1;
      $('el-s').textContent = r.cur ? '施工中' : '已完成'; $('el-n').textContent = s.name; $('el-i').textContent = '#' + String(s.i + 1).padStart(3, '0') + ' / ' + plan.steps.length;
      $('el-g').textContent = String(Object.keys(plan.stages).indexOf(s.stage) + 1).padStart(2, '0') + ' · ' + sn.name; $('el-c').textContent = qty(s).split(' · ')[0];
      $('el-t').textContent = s.trade; $('el-m').textContent = fmt(s.mass, s.mass < 10 ? 1 : 0) + ' t'; $('el-d').textContent = s.dur.toFixed(1) + ' 日';
      $('el-sp').textContent = s.spec || '—';
      const why = { sup: '支承', dig: '先挖', after: '之后' }; const ds = [...s.deps]; $('el-dp').textContent = ds.length ? ds.slice(0, 4).map(d => `${why[s.why[d.key]]} ${d.name}`).join(' · ') + (ds.length > 4 ? ` 等 ${ds.length} 项` : '') : '无（地基 / 原状）';
      $('el-y').textContent = elev(s); $('el-a').textContent = s.anchor.map(v => (Math.abs(v) < 0.05 ? 0 : v).toFixed(1)).join(' · '); $('el-p').textContent = Math.round(p * 100) + ' %';
      // 统计
      $('s-pc').textContent = (r.pct * 100).toFixed(1) + ' % · ' + r.done + '/' + plan.steps.length + ' 步';
      $('s-st').textContent = fmt(r.tally.stone || 0) + ' 块'; $('s-tl').textContent = fmt(r.tally.tile || 0) + ' 枚'; $('s-ms').textContent = fmt(r.mass) + ' t';
      $('s-dg').textContent = fmt(r.removed) + ' m³'; $('s-el').textContent = r.elev == null ? '—' : sgn(r.elev) + ' m'; $('s-cw').textContent = fmt(r.tally.col || 0) + ' / ' + fmt(r.tally.win || 0);
      for (const sh of sheets) { sh.el.querySelector('.stg').textContent = sn.name; sh.el.querySelector('.dt').textContent = plan.date(r.t); }
      // 日志
      const evs = plan.events.filter(e => e.t <= r.t + 1e-6), key = evs.length + ':' + Math.floor(r.t);
      if (key !== lastLogKey) { lastLogKey = key;
        const last = evs.slice(-9);
        logEl.innerHTML = '<div class="hd"><span>日期</span><span>动作</span><span>构件</span><span>数量</span><span>标高</span></div>' + last.map((e, k) => { const x = e.s;
          return `<div class="${k === last.length - 1 ? 'new' : ''} ${e.ev === 'end' ? 'end' : ''}"><span>${plan.date(e.t)}</span><b>${e.ev === 'end' ? '完成' : verb(x)}</b><span>${x.name}</span><span>${qty(x).split(' · ')[0]}</span><span>${elev(x)}</span></div>`; }).join('');
        $('lg-b').textContent = r.cur ? sn.name + ' 进行中' : '竣工'; $('lg-n').textContent = evs.length + ' 条事件';
      }
      lastStep = s;
    }
    function leader(r) {
      const svg = $('lead'), s = r.cur; if (!s) { svg.innerHTML = ''; return; }
      const vr = rectOf(vp), a = new THREE.Vector3(...s.anchor).project(cam);
      if (a.z > 1) { svg.innerHTML = ''; return; }
      const x = (a.x + 1) / 2 * vr.w, y = (1 - a.y) / 2 * vr.h, right = x < vr.w * 0.36, lx = right ? Math.min(vr.w - 260, x + 70) : 26, ly = Math.max(300, Math.min(vr.h - 150, y - 50));
      const t1 = s.name, t2 = qty(s) + ' · ' + s.trade;
      svg.setAttribute('width', vr.w); svg.setAttribute('height', vr.h);
      svg.innerHTML = `<circle cx="${x}" cy="${y}" r="4" fill="none" stroke="#b3202a" stroke-width="1.2"/><circle cx="${x}" cy="${y}" r="1.5" fill="#b3202a"/><polyline points="${x},${y} ${right ? lx : lx + 200},${ly + 6} ${right ? lx + 200 : lx},${ly + 6}" fill="none" stroke="#b3202a" stroke-width=".8"/>
        <text x="${lx}" y="${ly}" font-family="${getComputedStyle(document.body).getPropertyValue('--serif')}" font-size="13.5" font-weight="700" fill="#1d1a17">${t1}</text><text x="${lx}" y="${ly + 21}" font-family="${getComputedStyle(document.body).getPropertyValue('--serif')}" font-size="11.5" fill="#b3202a">${t2}</text>`;
    }

    let last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 0, fpsT = last; const frameMs = [];
    function frame(now) {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (st.play && !drag) { st.t += dt * st.daysPerSec * st.speed; if (st.t >= total) { st.t = total; st.play = false; setBtn(); } }
      ctl.update();
      const r = C.set(st.t);
      renderer.info.reset();
      renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); renderer.clear();
      renderer.setScissorTest(true);
      const v = rectOf(vp); cam.aspect = v.w / v.h; cam.updateProjectionMatrix();
      renderer.setViewport(v.x, H - v.y - v.h, v.w, v.h); renderer.setScissor(v.x, H - v.y - v.h, v.w, v.h);
      U.uMode.value = st.mode; U.uGhost.value = st.ghost ? 1 : 0; U.uCutOn.value = st.cut ? 1 : 0; U.uCut.value.set(1, 0, 0, 0); U.uLA.value = 1;
      renderer.render(scene, cam);
      const mainCalls = renderer.info.render.calls;
      if (st.sheets) for (const s of sheets) {
        const q = s.r; renderer.setViewport(q.x, H - q.y - q.h, q.w, q.h); renderer.setScissor(q.x, H - q.y - q.h, q.w, q.h);
        U.uMode.value = 1; U.uGhost.value = 1; U.uCutOn.value = 1; U.uCut.value.set(...s.cut); U.uLA.value = 0.55;
        renderer.render(scene, s.cam);
        if (s.cur) { const y = s.py(r.elev == null ? -18 : r.elev); s.cur.setAttribute('transform', `translate(0 ${y.toFixed(1)})`); }
      }
      // fps
      fpsN++; if (now - fpsT > 500) { fps = fpsN * 1000 / (now - fpsT); fpsN = 0; fpsT = now; $('h-fps').textContent = fps.toFixed(0); }
      frameMs.push(dt * 1000); if (frameMs.length > 240) frameMs.shift();
      if (now - lastUi > 90 || dirty) { lastUi = now; dirty = false; ui(r, now); leader(r);
        $('h-dc').textContent = mainCalls; $('h-dt').textContent = renderer.info.render.calls;
        const az = Math.atan2(cam.position.x - ctl.target.x, cam.position.z - ctl.target.z) * 180 / Math.PI, el = Math.asin((cam.position.y - ctl.target.y) / cam.position.distanceTo(ctl.target)) * 180 / Math.PI;
        $('db-cam').textContent = `AZ ${((az + 360) % 360).toFixed(0)}° EL ${el.toFixed(0)}°`; }
      S.calls = { main: mainCalls, frame: renderer.info.render.calls }; S.fps = fps; S.frameMs = frameMs;
      requestAnimationFrame(frame);
    }
    $('load').style.display = 'none';
    Object.assign(S, { ready: true, plan, C, st, tris: C.tris, segs: C.segs, set(t) { st.t = t; st.play = false; setBtn(); dirty = true; }, mode(m) { st.mode = m; setBtn(); }, opt(o) { Object.assign(st, o); setBtn(); dirty = true; }, home });
    requestAnimationFrame(frame);
  }
  main().catch(e => { S.errors.push(String(e && e.stack || e)); const l = $('load'); if (l) l.textContent = '加载失败：' + e; });
})();
