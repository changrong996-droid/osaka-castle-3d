'use strict';
// ===== 码头小样 界面 + 渲染（proto-port1）。读 SEQ（core/seq.js 通用核心）+ UI（core/ui.js）+ SEQ_PORT（领域插件）。
// 一屏答案（页眉 4 个数）→ A/B 并排 3D（共用时间轴、关键路径描红、风险图钉）→ 右栏参数 + 差值 + 风险 → 底栏甘特 + S 曲线。
// 所有显示的数字都来自 plan.at(t) / metrics / 蒙特卡洛结果，审计脚本逐个重算对比。
(function () {
  const THREE_BASE = 'https://unpkg.com/three@0.160.0/';
  const { $, fmt, sgn } = UI, SP = window.SEQ_PORT, MON = SP.MON;
  const S = { errors: [], ready: false, mcDone: false, regenN: 0 };
  window.__pv = S;
  window.addEventListener('error', e => S.errors.push(String(e.message)));
  const hp = new URLSearchParams(location.hash.replace(/^#/, ''));
  const OFFB = 20000, MC_N = +(hp.get('mc') || 500), SEED = 7;
  const monthStr = k => `${2027 + Math.floor(k / 12)}-${String(k % 12 + 1).padStart(2, '0')}-01`;
  const dstr = (sc, d) => { const D = new Date(sc.M.t0.getTime() + Math.round(d) * 864e5); return D.getFullYear() + '-' + String(D.getMonth() + 1).padStart(2, '0') + '-' + String(D.getDate()).padStart(2, '0'); };
  const mo = d => (d / MON).toFixed(1), yi = v => (v / 1e8).toFixed(1);
  const RES = [['挖泥船', '挖泥'], ['打桩船', '打桩'], ['起重船', '起重'], ['land', '陆上班组'], ['inst', '安装队']];
  const P = { berths: +(hp.get('berths') || 4), sts: +(hp.get('sts') || 3), fleet: +(hp.get('fleet') || 2), startK: +(hp.get('startK') || 6), found: hp.get('found') || 'vac', phA: +(hp.get('phA') || 1), phB: +(hp.get('phB') || 2) };
  const phName = (n, nb) => n === 1 ? `一次建成 ${nb} 泊位` : `分 ${n} 期 · 先建 ${Math.ceil(nb / n)} 泊位`;

  // ---------- 方案计算（纯数据，不碰 DOM）----------
  function compute(k) {
    const p = { berths: P.berths, sts: P.sts, found: P.found, phases: Math.min(k === 'A' ? P.phA : P.phB, P.berths), fleet: P.fleet, start: monthStr(P.startK), x0: k === 'A' ? 0 : OFFB };
    const t0 = performance.now(), M = SP.build(p), R = SP.schedule(M, null, null, true), mt = SP.metrics(M, R.S, R.E);
    const au = SEQ.auditNet(M.acts, { caps: M.caps, cure: M.cureRule.pairs, phase: M.R7, excl: M.excl, cyclic: R.cyclic });
    const cl = SEQ.clearance(SEQ.asPlan(M.acts), 25);
    const risks = SP.RISKS.map(rk => ({ rk, d: SP.riskDelta(M, mt, rk, 90) })).filter(x => x.d);
    const sc = { k, p, M, R, mt, au, cl, risks, pay: SP.payback(M, mt), mcAcc: {}, mc: null, ms: Math.round(performance.now() - t0) };
    sc.at = t => { const r = SEQ.at(M.acts, t), ti = Math.max(0, Math.min(mt.total, Math.floor(t)));
      r.capex = t <= 0 ? 0 : mt.cumAt[ti]; r.rev = SP.revenueCum(M, mt.lives, t); r.liveN = mt.lives.filter(l => l.t <= t).length; r.date = dstr(sc, t); return r; };
    sc.plan = { at: sc.at, total: mt.total };
    return sc;
  }
  const deltaRows = () => [
    { name: '总工期 P50', u: '月', a: A => A.mc && A.mc.total.p50 / MON, f: 1 },
    { name: '总工期 P90', u: '月', a: A => A.mc && A.mc.total.p90 / MON, f: 1 },
    { name: '首泊位投产 P50', u: '月', a: A => A.mc && A.mc.first.p50 / MON, f: 1, date: A => A.mc && dstr(A, A.mc.first.p50) },
    { name: '全部投产（基准）', u: '月', a: A => A.mt.total / MON, f: 1, date: A => dstr(A, A.mt.total) },
    { name: '总投资', u: '亿元', a: A => A.mt.invest / 1e8, f: 1 },
    { name: '首泊位前投入', u: '亿元', a: A => A.mt.preFirst / 1e8, f: 1 },
    { name: '静态回收（自开工）', u: '年', a: A => A.pay / 365, f: 1 },
  ];
  S.deltaRows = deltaRows;

  async function main() {
    const im = document.createElement('script'); im.type = 'importmap';
    im.textContent = JSON.stringify({ imports: { three: THREE_BASE + 'build/three.module.js', 'three/addons/': THREE_BASE + 'examples/jsm/' } });
    document.head.appendChild(im);
    const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
    run(THREE, OrbitControls);
  }

  function run(THREE, OrbitControls) {
    const canvas = $('gl');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: hp.get('shot') === '1' });
    const PR = Math.min(window.devicePixelRatio || 1, 2); renderer.setPixelRatio(PR); renderer.setClearColor(0x000000, 0); renderer.info.autoReset = false;
    try { const g = renderer.getContext(), e = g.getExtension('WEBGL_debug_renderer_info'); S.gpu = e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); } catch (e) { }
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(30, 1, 5, 30000);
    const view = $('view3d');
    const ctl = new OrbitControls(cam, view); ctl.enableDamping = true; ctl.dampingFactor = 0.09; ctl.maxPolarAngle = Math.PI * 0.47; ctl.minDistance = 120; ctl.maxDistance = 9000; ctl.screenSpacePanning = false;
    for (const el of [$('tools'), $('pins'), $('ctrl')]) UI.stopOrbit(el);
    const st = { t: hp.get('t') != null ? +hp.get('t') : 0, play: hp.get('t') == null ? hp.get('play') !== '0' : hp.get('play') === '1', speed: 1, view: hp.get('view') || 'AB', crit: hp.get('crit') !== '0', pins: hp.get('pins') !== '0', ghost: hp.get('ghost') !== '0', focus: hp.get('focus') || 'A', hot: null };
    S.st = st; S.sc = {};
    let Tmax = 1, dirty = true;

    // ---------- 场景：海床（挖方区开洞）、深水底、海面、后方陆域 ----------
    function scenery(M) {
      const g = new THREE.Group(), ox = M.x0, W = M.W, cx = ox + W / 2;
      const Q = new Map(), quad = (x0, z0, x1, z1, y, mat) => { if (!Q.has(mat)) Q.set(mat, []); Q.get(mat).push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1); };   // 同材质合并成一个网格
      const bed = new THREE.MeshBasicMaterial({ color: 0xd9cfb8 }), deep = new THREE.MeshBasicMaterial({ color: 0xb9b19c }), land = new THREE.MeshBasicMaterial({ color: 0xe6dfcf });
      const water = new THREE.MeshBasicMaterial({ color: 0x5f8fa8, transparent: true, opacity: 0.30, depthWrite: false });
      const X0 = ox - 700, X1 = ox + W + 700;
      quad(X0, -1500, ox, 545, -7, bed); quad(ox + W, -1500, X1, 545, -7, bed); quad(ox, 0, ox + W, 545, -7, bed);
      quad(ox, -1500, cx - 160, -520, -7, bed); quad(cx + 160, -1500, ox + W, -520, -7, bed); quad(cx - 160, -1500, cx + 160, -1400, -7, bed);
      quad(ox, -520, ox + W, 0, -16.2, deep); quad(cx - 160, -1400, cx + 160, -520, -16.2, deep);
      quad(X0, 545, X1, 820, 5, land);
      quad(X0, -1500, X1, 545, 0, water);
      for (const [mat, P] of Q) { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); const m = new THREE.Mesh(geo, mat); m.material.side = THREE.DoubleSide; m.frustumCulled = false; if (mat === water) m.renderOrder = 3; g.add(m); }
      return g;
    }
    function buildGfx(sc) {
      const C = SEQ.compile(THREE, { steps: sc.M.acts, at: () => ({}) }, { rise: 6, flag: s => !!s.crit });
      const grp = new THREE.Group(); grp.add(C.group, scenery(sc.M)); return { C, grp };
    }
    function dispose(g) { if (!g) return; g.grp.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); scene.remove(g.grp); }

    // ---------- 重算（参数改动）----------
    let mcTimer = 0;
    function regen() {
      S.mcDone = false; S.regenN++; const t0 = performance.now();
      const W0 = S.sc.A && S.sc.A.M.W;
      for (const k of ['A', 'B']) { const old = S.sc[k]; const sc = compute(k); if (old) dispose(old.gfx); sc.gfx = buildGfx(sc); scene.add(sc.gfx.grp); S.sc[k] = sc; }
      Tmax = Math.max(S.sc.A.mt.total, S.sc.B.mt.total) + 30; st.daysPerSec = Tmax / 40;
      if (st.t > Tmax) st.t = Tmax;
      S.regenMs = Math.round(performance.now() - t0);
      if (W0 && W0 !== S.sc.A.M.W) home();               // 泊位数变了：重新取景
      staticUI(); startMC(); dirty = true;
    }
    function startMC() {
      clearTimeout(mcTimer); const sA = S.sc.A, sB = S.sc.B, n0 = S.regenN; let i = 0; const CH = 25, t0 = performance.now();
      const step = () => { if (n0 !== S.regenN) return;
        for (const sc of [sA, sB]) { const r = SEQ.mc(MC_N, SEED, rng => SP.mcRun(sc.M, rng), i, Math.min(MC_N, i + CH)); for (const x in r) (sc.mcAcc[x] = sc.mcAcc[x] || []).push(...r[x]); }
        i = Math.min(MC_N, i + CH); $('chip-t').textContent = `蒙特卡洛 ${i}/${MC_N}`;
        if (i < MC_N) { mcTimer = setTimeout(step, 0); return; }
        for (const sc of [sA, sB]) sc.mc = SEQ.mcSummary(sc.mcAcc, [0.1, 0.5, 0.9]);
        S.mcMs = Math.round(performance.now() - t0); S.mcDone = true; staticUI(); dirty = true; };
      $('chip').className = 'wait'; mcTimer = setTimeout(step, 30);
    }

    // ---------- 静态 UI（每次重算 / 蒙特卡洛完成 / 改尺寸时画一次）----------
    function staticUI() {
      const A = S.sc.A, B = S.sc.B, done = S.mcDone;
      $('scA-n').textContent = phName(A.p.phases, A.p.berths); $('scB-n').textContent = phName(B.p.phases, B.p.berths);
      // 页眉：一屏答案
      const dur = sc => done ? `${mo(sc.mc.total.p50)} / ${mo(sc.mc.total.p90)}` : '…';
      $('k-dur-a').textContent = dur(A); $('k-dur-b').textContent = dur(B); $('k-dur-d').textContent = done ? 'Δ ' + sgn((B.mc.total.p50 - A.mc.total.p50) / MON, 1) + ' 月' : '';
      $('k-inv-a').textContent = yi(A.mt.invest); $('k-inv-b').textContent = yi(B.mt.invest); $('k-inv-d').textContent = 'Δ ' + sgn((B.mt.invest - A.mt.invest) / 1e8, 1) + ' 亿';
      $('k-teu-a').textContent = fmt(A.mt.design / 1e4); $('k-teu-b').textContent = fmt(B.mt.design / 1e4); $('k-teu-d').textContent = 'Δ ' + sgn((B.mt.design - A.mt.design) / 1e4, 0);
      const fd = sc => done ? `${dstr(sc, sc.mc.first.p50).slice(0, 7)}` : '…';
      $('k-first-a').innerHTML = done ? `${fd(A)}<u>（${dstr(A, A.mc.first.p90).slice(0, 7)}）</u>` : '…'; $('k-first-b').innerHTML = done ? `${fd(B)}<u>（${dstr(B, B.mc.first.p90).slice(0, 7)}）</u>` : '…';
      $('k-first-d').textContent = done ? 'Δ ' + sgn((B.mc.first.p50 - A.mc.first.p50) / MON, 1) + ' 月' : '';
      // 自检
      const zero = sc => sc.au.zero && !sc.cl.hits;
      const ok = zero(A) && zero(B);
      $('chip').className = done ? (ok ? '' : 'ng') : 'wait';
      if (done) $('chip-t').innerHTML = ok ? `${UI.icon('check')}自检 0 · R1–R7 · ${MC_N}×2` : `自检 ${A.au.ex.length + B.au.ex.length} 项未过`;
      // 参数输出
      $('o-berths').textContent = P.berths + ' 个'; $('o-sts').textContent = P.sts + ' 台'; $('o-fleet').textContent = P.fleet + ' 艘/类'; $('o-start').textContent = monthStr(P.startK).slice(0, 7);
      // 差值表
      const rows = deltaRows(); let h = '<tr><th>指标</th><th>A</th><th>B</th><th>B − A</th></tr>';
      for (const r of rows) { const a = r.a(A), b = r.a(B), ok = a != null && b != null && !isNaN(a) && !isNaN(b);
        const cell = (sc, v) => v == null || isNaN(v) ? '…' : (r.date ? r.date(sc).slice(0, 7) : fmt(v, r.f));
        h += `<tr><td>${r.name}${r.date ? '' : ` <small style="color:var(--ink3)">${r.u}</small>`}</td><td>${cell(A, a)}</td><td>${cell(B, b)}</td><td class="d">${ok ? sgn(b - a, r.f) + (r.date ? ' 月' : '') : '…'}</td></tr>`; }
      $('delta').innerHTML = h;
      // 风险表
      let rh = '<tr><th>延误 3 个月</th><th>Δ工期 A·B</th><th>Δ首泊 A·B</th><th>Δ投资 A·B</th></tr>';
      for (let i = 0; i < A.risks.length; i++) { const a = A.risks[i], b = B.risks.find(x => x.rk.id === a.rk.id); if (!b) continue;
        rh += `<tr data-r="${a.rk.id}"><td>${i + 1} ${a.rk.short}</td><td>${sgn(a.d.dTotal / MON, 1)}·${sgn(b.d.dTotal / MON, 1)}</td><td>${sgn(a.d.dFirst / MON, 1)}·${sgn(b.d.dFirst / MON, 1)}</td><td class="d">${sgn(a.d.dInvest / 1e8, 2)}·${sgn(b.d.dInvest / 1e8, 2)}</td></tr>`; }
      $('risk').innerHTML = rh;
      for (const tr of $('risk').querySelectorAll('tr[data-r]')) { tr.onmouseenter = () => { st.hot = tr.dataset.r; dirty = true; }; tr.onmouseleave = () => { st.hot = null; dirty = true; }; }
      // 工程量（几何量出 → 船机·日 / 车次 / 工人·日）；右栏放不下就收起（第二层“工程量”页里有全表）
      const q = SP.quantities(A.M), w = n => fmt(n / 1e4, 0) + ' 万';
      $('qty').innerHTML = `<tr><th>项目</th><th>工程量</th><th>换算</th></tr>
        <tr><td>疏浚 + 吹填</td><td>${w(q.dredge + q.fill)} m³</td><td>挖泥船 ${fmt(q.rd['挖泥船'])} 艘·日</td></tr>
        <tr><td>钢管桩</td><td>${fmt(q.piles)} 根 · ${w(q.steel)} t</td><td>打桩船 ${fmt(q.rd['打桩船'])} 艘·日</td></tr>
        <tr><td>横梁 + 面板</td><td>${w(q.conc)} m³</td><td>罐车 ${fmt(q.mixer)} 车次</td></tr>
        <tr><td>软基 + 面层</td><td>${w(q.ground)} · ${w(q.pave)} m²</td><td>自卸车 ${fmt(q.dump)} 车次</td></tr>
        <tr><td>岸桥 / 场桥</td><td>${fmt(q.sts)} / ${fmt(q.armg)} 台</td><td>工人 ${w(q.workerDays)} 人·日</td></tr>`;
      S.qty = q;
      drawTrack(); drawGantt(true); drawCurve(true); fitAll(); fitRp();
    }
    function fitRp() { const rp = $('rp'), qs = $('qsec'); qs.style.display = ''; if (rp.scrollHeight > rp.clientHeight + 1) qs.style.display = 'none'; }
    // 时间轴：首泊位 / 全部投产标记
    function drawTrack() {
      const tr = $('track'), w = tr.clientWidth, A = S.sc.A, B = S.sc.B, box = $('tmarks'); box.innerHTML = '';
      const mk = [[A, A.mt.first, 'A 首泊', 1], [B, B.mt.first, 'B 首泊', 1], [A, A.mt.total, 'A 全部', 2], [B, B.mt.total, 'B 全部', 2]];
      const items = mk.map(([sc, t, n, pri]) => ({ x: t / Tmax * w, t, sc, label: n + ' ' + dstr(sc, t).slice(0, 7), pri, w: UI.textW(n + ' ' + dstr(sc, t).slice(0, 7), '9px ' + getComputedStyle(document.body).getPropertyValue('--mono')), anchor: 'middle' }));
      for (const it of items) { const m = document.createElement('div'); m.className = 'mk' + (it.sc.k === 'B' ? ' b' : ''); m.style.left = it.x + 'px'; box.appendChild(m); }
      for (const it of UI.pickLabels(items, 8, 0, w)) { const l = document.createElement('div'); l.className = 'lab' + (it.sc.k === 'B' ? ' b' : ''); l.style.left = it.a + 'px'; l.textContent = it.label; box.appendChild(l); }
    }
    // 甘特：焦点方案的活动按工序组成行；关键路径描红；预压满期 = 斜线
    const GROWS8 = [['准备 · 疏浚吹填', ['prep', 'dredge', 'fill']], ['护岸 · 地基', ['revet', 'pvd', 'preload', 'unload']], ['码头结构', ['trestle', 'untrestle', 'pile', 'beam', 'deck']], ['堆场 · 轨道', ['pave', 'yrail', 'srail']], ['设备采购', ['buy']], ['设备安装', ['sts', 'armg']], ['建筑 · 电力', ['bldg', 'grid', 'power']], ['联调 · 投产', ['comm', 'live']]];
    const GROWS6 = [['准备 · 海上土方', ['prep', 'dredge', 'fill', 'revet']], ['地基 · 码头结构', ['pvd', 'preload', 'unload', 'trestle', 'untrestle', 'pile', 'beam', 'deck']], ['堆场 · 轨道', ['pave', 'yrail', 'srail']], ['设备采购', ['buy']], ['安装 · 建筑电力', ['sts', 'armg', 'bldg', 'grid', 'power']], ['联调 · 投产', ['comm', 'live']]];
    const GROWS = [['许可准备', ['prep']], ['疏浚 · 吹填', ['dredge', 'fill']], ['护岸 · 栈桥', ['revet', 'trestle', 'untrestle']], ['地基处理', ['pvd', 'preload', 'unload']], ['码头桩基', ['pile']], ['横梁 · 面板', ['beam', 'deck']], ['堆场 · 轨道', ['pave', 'yrail', 'srail']], ['设备采购', ['buy']], ['岸桥 · 场桥', ['sts', 'armg']], ['建筑 · 电力', ['bldg', 'grid', 'power']], ['联调 · 投产', ['comm', 'live']]];
    let G = null; const gMemo = UI.memo(), cMemo = UI.memo();
    function drawGantt(force) {
      const sc = S.sc[st.focus], body = $('gbody'), w = Math.floor(body.clientWidth - 12), h = Math.floor(body.clientHeight - 4);
      gMemo((force ? S.regenN + ':' + S.mcDone : '') + st.focus + w + 'x' + h, () => {
        const acts = sc.M.acts, GR = [GROWS, GROWS8, GROWS6].find(g => (h - 17) / g.length >= 13) || GROWS6, rows = GR.map(([name, stg]) => { const bars = [];
          for (const a of acts) if (stg.includes(a.stage)) bars.push({ a: a.start, b: a.kind === 'milestone' ? a.start + Tmax * 0.004 : a.end, crit: a.crit, cls: a.kind === 'procure' ? 'buy' : a.kind === 'milestone' ? 'live' : '', key: a.key });
          if (stg.includes('preload')) for (const [F, B, L] of sc.M.cureRule.pairs) bars.push({ a: F.end, b: F.end + L, cls: 'cure', crit: false, key: F.key + '~cure' });
          return { name, bars, crit: bars.some(b => b.crit) }; });
        const ticks = []; const y0 = sc.M.t0.getFullYear(); for (let y = y0 + 1; y < y0 + 12; y++) { const t = (new Date(y, 0, 1) - sc.M.t0) / 864e5; if (t > 0 && t < Tmax) ticks.push({ t, label: String(y), pri: 1 }); }
        const lw = Math.ceil(Math.max(...rows.map(r => UI.textW(r.name, (r.crit ? '700 ' : '') + '9px ' + getComputedStyle(document.body).getPropertyValue('--sans'))))) + 10;
        G = UI.gantt($('gantt'), { w, h, rows, total: Tmax, t: st.t, labelW: lw, top: 13, ticks, mono: getComputedStyle(document.body).getPropertyValue('--mono') });
        G.rows = rows; G.focus = st.focus; S.G = G;
        const nc = acts.filter(a => a.crit).length; $('g-info').textContent = `${sc.k} 关键链 ${nc} 项 · 工期 ${mo(sc.mt.total)} 月（基准）`;
      });
    }
    let CV = null;
    function drawCurve(force) {
      const body = $('cbody'), w = Math.floor(body.clientWidth - 12), h = Math.floor(body.clientHeight - 4), A = S.sc.A, B = S.sc.B;
      cMemo((force ? S.regenN + ':' : '') + w + 'x' + h, () => {
        const xMax = Tmax + 730, ser = [], pts = (sc, f) => { const a = []; for (let t = 0; t <= xMax; t += 10) a.push([t, f(sc, t) / 1e8]); return a; };
        const cap = (sc, t) => t <= 0 ? 0 : sc.mt.cumAt[Math.min(sc.mt.total, Math.floor(t))], rev = (sc, t) => SP.revenueCum(sc.M, sc.mt.lives, t);
        ser.push({ pts: pts(A, cap), cls: 'a' }, { pts: pts(B, cap), cls: 'b' }, { pts: pts(A, rev), cls: 'rev' }, { pts: pts(B, rev), cls: 'rev b' });
        const yMax = Math.max(10, ...ser.map(s => s.pts[s.pts.length - 1][1])) * 1.06, step = yMax > 120 ? 40 : yMax > 60 ? 20 : 10, yT = []; for (let v = 0; v <= yMax; v += step) yT.push(v);
        const ticks = []; const y0 = A.M.t0.getFullYear(); for (let y = y0 + 1; y < y0 + 14; y++) { const t = (new Date(y, 0, 1) - A.M.t0) / 864e5; if (t > 0 && t < xMax) ticks.push({ t, label: String(y), pri: 1 }); }
        CV = UI.lines($('curve'), { w, h, xMax, yMax, series: ser, yTicks: yT, yFmt: v => v + '亿', xTicks: ticks, left: 40, mono: getComputedStyle(document.body).getPropertyValue('--mono'),
          marks: [{ x: A.mt.first, y: cap(A, A.mt.first) / 1e8, cls: 'a' }, { x: B.mt.first, y: cap(B, B.mt.first) / 1e8 }] });
        S.CV = CV;
      });
    }

    // ---------- 版式：按窗口实测（3D 区保底 300 px 含控制条）----------
    function layout() {
      const W = innerWidth, H = innerHeight, b = document.body.classList;
      b.toggle('short', H < 700); b.toggle('nw1', W < 1500); b.toggle('nw2', W < 1330); b.toggle('nw3', W < 1150);
      const rpW = Math.round(Math.max(300, Math.min(370, W * 0.25))), hdH = H < 640 ? 58 : H < 820 ? 64 : 74;
      const avail = H - 22 - hdH - 20, fr = UI.fitRows(avail, [{ min: 300, flex: 1 }, { min: 140, pref: Math.min(270, Math.round(H * 0.27)) }]);
      const rs = document.documentElement.style; rs.setProperty('--rpW', rpW + 'px'); rs.setProperty('--hdH', hdH + 'px'); rs.setProperty('--btH', fr.h[1] + 'px');
      document.body.style.overflowY = fr.scroll ? 'auto' : 'hidden'; $('app').style.minHeight = fr.scroll ? (hdH + 300 + 140 + 42) + 'px' : '';
      renderer.setSize(W, H, false);
      if (S.sc.A) { drawTrack(); drawGantt(); drawCurve(); fitAll(); fitRp(); }
      dirty = true;
    }
    const OVL = UI.Overlays(view, () => [$('scA'), $('scB'), $('tools'), $('legend')], ['c1', 'c2', 'c3', 'c4', 'c5'], 0.34);
    function fitAll() { placeCards(); OVL.fit(); placeCards(); const b = band(); if (Math.abs(b.d - BAND.d) > 2) { BAND = b; dirty = true; } }
    function halves() { const w = view.clientWidth, h = view.clientHeight;
      if (st.view === 'AB') return [{ k: 'A', x: 0, w: Math.floor(w / 2), h }, { k: 'B', x: Math.floor(w / 2), w: w - Math.floor(w / 2), h }];
      return [{ k: st.view, x: 0, w, h }]; }
    function placeCards() {
      const hv = halves(); $('split').style.display = hv.length > 1 ? '' : 'none'; if (hv.length > 1) $('split').style.left = hv[1].x + 'px';
      for (const k of ['A', 'B']) { const el = $('sc' + k), q = hv.find(x => x.k === k); el.style.display = q ? '' : 'none'; if (q) { el.style.left = (q.x + 10) + 'px'; el.style.maxWidth = (q.w - 20) + 'px'; } }
    }
    // 相机：master 相机在“方案本地坐标”里环绕；渲染方案 k 时整体平移 ox
    // 取景：把投影中心移到“叠层之间的空带”中央（上 = 方案卡片底，下 = 工具条顶），模型不躲在卡片后面
    function band() { const vr = view.getBoundingClientRect(), h = view.clientHeight; let top = 0, bot = h;
      for (const e of [$('scA'), $('scB')]) if (UI.visible(e)) top = Math.max(top, e.getBoundingClientRect().bottom - vr.top);
      for (const e of [$('tools'), $('legend')]) if (UI.visible(e)) bot = Math.min(bot, e.getBoundingClientRect().top - vr.top);
      if (bot - top < h * 0.45) { top = 0; bot = h; } return { top, bot, d: Math.round((top + bot) / 2 - h / 2), frac: (bot - top) / h }; }
    let BAND = { d: 0, frac: 1 };
    function camFor(q, ox) { cam.aspect = q.w / q.h; const d = BAND.d; if (d > 0) cam.setViewOffset(q.w, q.h + 2 * d, 0, 0, q.w, q.h); else if (d < 0) cam.setViewOffset(q.w, q.h - 2 * d, 0, -2 * d, q.w, q.h); else cam.clearViewOffset(); cam.updateProjectionMatrix(); cam.position.x += ox; cam.updateMatrixWorld(); }
    function home() { BAND = band(); const sc = S.sc.A, W = sc.M.W, hv = halves()[0], asp = hv.w / Math.max(1, hv.h), vf = cam.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * asp);
      const need = Math.max((W + 260) / 2 / Math.tan(hf / 2), 520 / Math.tan(vf / 2) / Math.max(0.55, BAND.frac)) * 0.98, az = 196 * Math.PI / 180, el = 34 * Math.PI / 180, T = [W / 2, 0, 190];
      ctl.target.set(T[0], T[1], T[2]); cam.position.set(T[0] + need * Math.cos(el) * Math.sin(az), T[1] + need * Math.sin(el), T[2] + need * Math.cos(el) * Math.cos(az)); ctl.update(); dirty = true; }
    S.home = home;

    // ---------- 交互 ----------
    const setBtns = () => {
      $('b-play').innerHTML = UI.icon(st.play ? 'pause' : 'play') + (st.play ? '暂停' : '播放'); $('b-speed').textContent = '×' + st.speed;
      $('b-crit').classList.toggle('on', st.crit); $('b-pins').classList.toggle('on', st.pins); $('b-ghost').classList.toggle('on', st.ghost);
      for (const s of $('b-view').children) s.classList.toggle('on', s.dataset.v === st.view);
      for (const s of $('b-gfocus').children) s.classList.toggle('on', s.dataset.v === st.focus);
      dirty = true; };
    $('b-play').onclick = () => { if (!st.play && st.t >= Tmax - 1e-6) st.t = 0; st.play = !st.play; setBtns(); };
    $('b-speed').onclick = () => { st.speed = st.speed >= 4 ? 1 : st.speed * 2; setBtns(); };
    $('b-crit').onclick = () => { st.crit = !st.crit; setBtns(); };
    $('b-pins').onclick = () => { st.pins = !st.pins; setBtns(); };
    $('b-ghost').onclick = () => { st.ghost = !st.ghost; setBtns(); };
    for (const s of $('b-view').children) s.onclick = () => { st.view = s.dataset.v; if (st.view !== 'AB') st.focus = st.view; setBtns(); fitAll(); drawGantt(); };
    for (const s of $('b-gfocus').children) s.onclick = () => { st.focus = s.dataset.v; setBtns(); drawGantt(); };
    // 时间轴拖动
    const track = $('track'); let drag = false;
    const seek = e => { const r = track.getBoundingClientRect(); st.t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * Tmax; dirty = true; };
    track.addEventListener('pointerdown', e => { drag = true; track.setPointerCapture(e.pointerId); seek(e); });
    track.addEventListener('pointermove', e => { if (drag) seek(e); }); track.addEventListener('pointerup', () => { drag = false; });
    addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); $('b-play').click(); } else if (e.code === 'ArrowRight') { st.t = Math.min(Tmax, st.t + 30); dirty = true; } else if (e.code === 'ArrowLeft') { st.t = Math.max(0, st.t - 30); dirty = true; } else if (e.code === 'Escape') $('sheet').style.display = 'none'; });
    // 参数
    let regenT = 0; const later = () => { clearTimeout(regenT); regenT = setTimeout(() => { regen(); }, 140); };
    for (const k of ['berths', 'sts', 'fleet', 'startK']) { const el = $('p-' + (k === 'startK' ? 'start' : k)); el.value = P[k]; el.oninput = () => { P[k] = +el.value; $('o-' + (k === 'startK' ? 'start' : k)).textContent = k === 'startK' ? monthStr(P.startK).slice(0, 7) : el.value; later(); }; }
    const segP = (id, key, num) => { for (const s of $(id).children) { s.classList.toggle('on', String(P[key]) === s.dataset.v); s.onclick = () => { P[key] = num ? +s.dataset.v : s.dataset.v; for (const x of $(id).children) x.classList.toggle('on', x === s); later(); }; } };
    segP('p-found', 'found'); segP('p-phA', 'phA', 1); segP('p-phB', 'phB', 1);
    for (const el of [$('params')]) UI.stopOrbit(el);
    // 第二层：假设 / 自检 / 方法
    $('sh-x').innerHTML = UI.icon('close') + '关闭';
    const openSheet = tab => { $('sheet').style.display = 'block'; sheetTab(tab); };
    $('b-assume').onclick = () => openSheet('assume'); $('chip').onclick = () => openSheet('audit'); $('sh-x').onclick = () => { $('sheet').style.display = 'none'; };
    $('sheet').onclick = e => { if (e.target.id === 'sheet') $('sheet').style.display = 'none'; };
    for (const s of $('sh-tab').children) s.onclick = () => sheetTab(s.dataset.v);
    function sheetTab(tab) {
      for (const s of $('sh-tab').children) s.classList.toggle('on', s.dataset.v === tab);
      const A = S.sc.A, B = S.sc.B; let h = '';
      if (tab === 'assume') {
        h = '<p>以下单价、效率、区间均为行业经验区间里的取值，<b>不是任何真实项目数据</b>；每一项都可以替换后重排。</p><table><tr><th>项目</th><th>效率 / 规则</th><th>取值</th><th>常见区间</th></tr>';
        for (const r of SP.ASSUME) h += `<tr><td>${r[0]}<span class="tag">推算</span></td><td>${r[1]}</td><td class="n">${r[2]}</td><td class="n">${r[3]}</td></tr>`;
        h += '</table>';
      } else if (tab === 'qty') {
        const qa = SP.quantities(A.M), qb = SP.quantities(B.M), f0 = v => fmt(v), r = (n, a, b, u) => `<tr><td>${n}</td><td class="n">${a}</td><td class="n">${b}</td><td>${u}</td></tr>`;
        h = '<p>工程量由构件几何直接量出（闭合网格体积、面积、根数），再按假设页的效率换算成船机·日 / 车次 / 工人·日。分期只改变时间，不改变工程量。</p><table><tr><th>项目</th><th>A</th><th>B</th><th>单位 / 换算</th></tr>';
        h += r('港池 + 航道疏浚', f0(qa.dredge), f0(qb.dredge), 'm³') + r('吹填造陆', f0(qa.fill), f0(qb.fill), 'm³') + r('护岸抛石', f0(qa.rock), f0(qb.rock), 'm³');
        h += r('钢管桩', f0(qa.piles), f0(qb.piles), '根（Φ1.2 m × 22 mm，桩长 43 m）') + r('钢材', f0(qa.steel), f0(qb.steel), 't') + r('横梁 + 面板混凝土', f0(qa.conc), f0(qb.conc), 'm³ → 罐车 ' + f0(qa.mixer) + ' 车次');
        h += r('软基处理面积', f0(qa.ground), f0(qb.ground), 'm²') + r('堆载土方', f0(qa.sur), f0(qb.sur), 'm³ → 自卸车 ' + f0(qa.dump) + ' 车次（进 + 出）') + r('堆场面层', f0(qa.pave), f0(qb.pave), 'm²');
        h += r('岸桥 / 场桥', qa.sts + ' / ' + qa.armg, qb.sts + ' / ' + qb.armg, '台');
        for (const [k, n] of RES) h += r(n + '·日', f0(qa.rd[k] || 0), f0(qb.rd[k] || 0), '资源·日');
        h += r('工人·日', f0(qa.workerDays), f0(qb.workerDays), '按班组规模换算') + '</table>';
      } else if (tab === 'audit') {
        const row = (n, f) => `<tr><td>${n}</td><td class="n">${f(A)}</td><td class="n">${f(B)}</td></tr>`, z = v => v ? `<b class="ng">${v}</b>` : '<b class="ok">0</b>';
        h = `<p>按排出的时间表独立核对（不读规则生成的依赖），两个方案都要全 0。蒙特卡洛 ${MC_N} 次 / 方案，种子固定，可复现。</p><table><tr><th>检查</th><th>A</th><th>B</th></tr>`;
        h += row('活动 / 依赖', s => s.M.acts.length + ' / ' + s.M.acts.reduce((a, x) => a + x.pred.length, 0));
        h += row('依赖条数 R1 支承 · R2 先挖 · R3 先后 · R4 临时 · R6 采购 · R7 分期', s => ['R1', 'R2', 'R3', 'R4', 'R6', 'R7'].map(k => s.M.counts[k] || 0).join(' · '));
        h += row('无支承', s => z(s.au.unsupported)); h += row('成环', s => z(s.au.cyclic)); h += row('依赖违例（开工早于前驱完成 + 间隔）', s => z(s.au.prec));
        h += row('R4 临时设施：座数 / 服务对 / 违例 / 竣工残留', s => `${s.au.r4.temps} / ${s.au.r4.pairs} / ${z(s.au.r4.violations)} / ${z(s.au.r4.leftover)}`);
        h += row('R5 资源超额（峰值 / 上限）', s => z(s.au.r5.over) + ' · ' + RES.map(([r, n]) => n + ' ' + s.au.r5.peak[r] + '/' + s.M.caps[r]).join(' '));
        h += row('R6 设备早于到货安装', s => z(s.au.r6.late) + ' / ' + s.au.r6.n);
        h += row('预压满期不足', s => z(s.au.cure.short) + ' / ' + s.au.cure.n);
        h += row('R7 分期冲突（占用已投产泊位作业区）', s => z(s.au.r7.conflicts) + ' / 接口 ' + s.au.r7.n);
        h += row('船机 / 吊装净空冲突（包络同时在场）', s => z(s.au.excl.conflicts) + ' / ' + s.au.excl.n + ' 对');
        h += row('施工栈桥杆件净空碰撞', s => z(s.cl.hits) + ' / ' + s.cl.members + ' 根');
        h += row('排程 + 审计耗时', s => s.ms + ' ms');
        h += '</table>';
      } else {
        h = `<p><b>构件 → 规则 → 排程。</b>码头被拆成构件族（港池、护岸、吹填、地基、钢管桩、横梁、面板、堆场、轨道、岸桥、场桥、建筑、电力），每个构件的工程量都从几何量出（体积、面积、根数），再按效率换算成船机·日、班组·日。</p>
<p><b>规则（与筑城同一套核心）：</b>R1 支承（构件底面落在下层顶面且平面重叠）· R2 先挖后建 / 养护满期（硬约束）· R3 阶段先后 · R4 临时设施随服务工序搭拆（施工栈桥、堆载预压）· R5 资源上限（同类船机同时作业 ≤ 数量）· R6 外部采购提前期（岸桥 订货→制造→海运，与码头面完成取较晚者）· R7 分期不干扰（下期作业包络不得进入已投产泊位作业区；相交的接口工程前置到该泊位投产前）。另有船机 / 吊装作业包络互斥。</p>
<p><b>排程：</b>先做无资源 CPM 得到最迟开工作为优先级（前面泊位略优先），再按串行进度生成法逐个放入：最早满足全部前驱 + 间隔、资源剖面不超、作业包络不冲突的那一天。全部整数日。</p>
<p><b>关键路径：</b>从最后完成的活动回溯“决定它开工的那个约束”——前驱，或者它在等的那个资源 / 净空。所以关键路径会穿过资源排队（例如岸桥产线），比纯 CPM 更真实。</p>
<p><b>不确定性：</b>每类工序一个相关系数（海上、沉桩、软基、陆上、设备）× 每个活动的小扰动，三角分布；采购按制造 + 运输分别抽样，预压满期按 120/150/210 日抽样；每个方案 ${MC_N} 次重排，取最近秩 P50 / P90。</p>
<p><b>投资：</b>单价 × 工程量（按开工日起每年上涨 3%）+ 现场管理费 × 工期 + 其他费用 8% + 预备费 5% + 建设期利息（逐日累计支出 × 60% × 4.5%）。<b>风险图钉</b>：把该项工期（或满期）加 90 日后整体重排，差值即“此项延误 3 个月”的影响；被浮时吸收的显示 ±0。</p>`;
      }
      $('sh-c').innerHTML = h; $('sh-t').textContent = { assume: '假设 · 推算单价与效率', qty: '工程量（几何量出）', audit: '规则自检', method: '方法' }[tab];
    }

    // ---------- 图钉 ----------
    const pinsEl = $('pins'), tip = $('tip'); let pinState = [], pinHover = null;
    const v3 = new THREE.Vector3();
    function anchorOf(sc, a) { const x = a.bb ? a : (a.of && a.of.bb ? a.of : sc.M.acts.find(q => q.key === 'gate')); const b = x.bb; return [(b.min[0] + b.max[0]) / 2, b.max[1], (b.min[2] + b.max[2]) / 2]; }
    function updatePins() {
      const hv = halves(), vr = view.getBoundingClientRect(), obs = [$('scA'), $('scB'), $('tools'), $('legend')].filter(UI.visible).map(e => { const r = e.getBoundingClientRect(); return { left: r.left - vr.left - 4, right: r.right - vr.left + 4, top: r.top - vr.top - 4, bottom: r.bottom - vr.top + 4 }; });
      const pins = [];
      for (const q of hv) { const sc = S.sc[q.k]; camFor(q, sc.M.x0);
        sc.risks.forEach((r, i) => { const p = anchorOf(sc, r.d.act); v3.set(p[0], p[1], p[2]).project(cam); const on = st.pins && v3.z < 1 && Math.abs(v3.x) < 1 && Math.abs(v3.y) < 1;
          pins.push({ k: q.k, i, id: r.rk.id, x: q.x + (v3.x + 1) / 2 * q.w, y: (1 - v3.y) / 2 * q.h, on: on && (q.x + (v3.x + 1) / 2 * q.w) > q.x + 12 && (q.x + (v3.x + 1) / 2 * q.w) < q.x + q.w - 12, r }); });
        cam.position.x -= sc.M.x0; cam.updateMatrixWorld(); }
      pinState = UI.placePins(pins, 13, view.clientWidth, view.clientHeight, obs, 30);
      // 同一方案半区外的不显示
      for (const p of pinState) { const q = hv.find(x => x.k === p.k); if (p.show && (p.x < q.x + 12 || p.x > q.x + q.w - 12)) p.show = false; }
      let html = ''; for (const p of pinState) if (p.show) html += `<div class="pin${st.hot === p.id || pinHover === p ? ' hot' : ''}${p.r.d.crit ? '' : ' off'}" data-k="${p.k}" data-i="${p.i}" style="left:${p.x.toFixed(1)}px;top:${p.y.toFixed(1)}px"><span>${p.i + 1}</span></div>`;
      if (pinsEl._h !== html) { pinsEl.innerHTML = html; pinsEl._h = html;
        for (const el of pinsEl.children) { el.onmouseenter = () => { pinHover = pinState.find(p => p.k === el.dataset.k && p.i === +el.dataset.i && p.show); showTip(); }; el.onmouseleave = () => { pinHover = null; showTip(); }; } }
      if (pinHover) showTip();
    }
    function showTip() {
      if (!pinHover) { tip.style.display = 'none'; S.tip = null; for (const el of pinsEl.children) el.style.visibility = ''; for (const e of [$('scA'), $('scB'), $('tools'), $('legend')]) e.style.visibility = ''; return; }
      const p = pinHover, sc = S.sc[p.k], d = p.r.d;
      tip.innerHTML = `<h4>${p.i + 1} · ${p.r.rk.name}</h4><div class="w">方案 ${p.k} · ${UI.esc(d.act.name)} · ${d.crit ? '在关键路径上' : '不在关键路径上'}</div>
        <table><tr><th>此项延误 3 个月 →</th><th>变化</th></tr><tr><td>总工期</td><td class="r">${sgn(d.dTotal / MON, 1)} 月</td></tr><tr><td>首泊位投产</td><td class="r">${sgn(d.dFirst / MON, 1)} 月</td></tr><tr><td>总投资</td><td class="r">${sgn(d.dInvest / 1e8, 2)} 亿元</td></tr></table>`;
      tip.style.display = 'block';
      const vr = view.getBoundingClientRect(), obs = [$('scA'), $('scB'), $('tools'), $('legend')].filter(UI.visible).map(e => { const r = e.getBoundingClientRect(); return { left: r.left - vr.left, right: r.right - vr.left, top: r.top - vr.top, bottom: r.bottom - vr.top }; });
      const w = tip.offsetWidth, h = tip.offsetHeight, others = pinState.filter(q => q.show && q !== p).map(q => ({ left: q.x - 14, right: q.x + 14, top: q.y - 14, bottom: q.y + 14 }));
      const pos = UI.placeBox(p.x, p.y, w, h, view.clientWidth, view.clientHeight, obs.concat(others), 14) || UI.placeBox(p.x, p.y, w, h, view.clientWidth, view.clientHeight, obs, 14) || UI.placeBox(p.x, p.y, w, h, view.clientWidth, view.clientHeight, [], 14) || { x: 6, y: 6 };
      tip.style.left = pos.x + 'px'; tip.style.top = pos.y + 'px'; S.tip = { k: p.k, id: p.r.rk.id, d };
      // 小窗口放不下时：提示框在最上层，被它盖住的叠层（工具条 / 图例 / 卡片）暂时隐藏，移开即恢复
      const tr = { left: pos.x, right: pos.x + w, top: pos.y, bottom: pos.y + h };
      for (const e of [$('scA'), $('scB'), $('tools'), $('legend')]) { e.style.visibility = ''; if (!UI.visible(e)) continue; const r = e.getBoundingClientRect(), o = { left: r.left - vr.left, right: r.right - vr.left, top: r.top - vr.top, bottom: r.bottom - vr.top }; if (UI.inter(o, tr) > 0) e.style.visibility = 'hidden'; }
      // 提示框盖住的其他图钉暂时隐藏（提示框在最上层，不与图钉互压）
      for (const el of pinsEl.children) { const x = parseFloat(el.style.left), y = parseFloat(el.style.top), mine = el.dataset.k === p.k && +el.dataset.i === p.i; el.style.visibility = !mine && x + 14 > pos.x && x - 14 < pos.x + w && y + 14 > pos.y && y - 14 < pos.y + h ? 'hidden' : ''; }
    }
    S.hoverPin = (k, id) => { pinHover = pinState.find(p => p.k === k && p.id === id && p.show) || null; showTip(); return !!pinHover; };

    // 时间游标（时间轴 / 甘特 / S 曲线）：set() 时同步写，不等下一帧（慢 GPU / SwiftShader 下也一致）
    function syncCursor() { const kx = st.t / Tmax * 100; $('track').querySelector('.fill').style.width = kx + '%'; $('track').querySelector('.knob').style.left = kx + '%'; if (G) G.setT(st.t); if (CV) CV.setT(st.t); }
    // ---------- 每帧 ----------
    const rectOf = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    let last = performance.now(), lastUi = 0, fpsN = 0, fpsT = performance.now(), fps = 0, lastCam = '';
    function uiTick() {
      const A = S.sc.A, B = S.sc.B, t = st.t;
      for (const sc of [A, B]) { const r = sc.at(t), k = sc.k;
        $('sc' + k + '-s1').innerHTML = `<b>${r.date}</b> · 已投 <b>${yi(r.capex)}</b> 亿 · 投产 <b class="${r.liveN ? 'r' : ''}">${r.liveN}/${sc.p.berths}</b> 泊位`;
        $('sc' + k + '-s2').innerHTML = `在用 ${RES.slice(0, 3).map(([q, n]) => `${n} <b>${r.use[q] || 0}/${sc.M.caps[q]}</b>`).join(' · ')} · 施工中 <b>${r.active.filter(a => a.kind !== 'procure').length}</b> 项`;
      }
      const ra = A.at(t), rb = B.at(t);
      $('cval').innerHTML = `A 已投 <b>${yi(ra.capex)}</b> 收入 <b class="r">${yi(ra.rev)}</b>${$('cbody').clientWidth < 440 ? '<br>' : ' · '}B 已投 <b>${yi(rb.capex)}</b> 收入 <b class="r">${yi(rb.rev)}</b> 亿`;
      $('tlab').innerHTML = `${ra.date}<small>第 ${Math.floor(t)} 日</small>`;
    }
    function frame(now) {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (st.play && !drag) { st.t += dt * st.daysPerSec * st.speed; if (st.t >= Tmax) { st.t = Tmax; st.play = false; setBtns(); } dirty = true; }
      const moved = ctl.update(); const ck = cam.position.toArray().map(v => v.toFixed(1)).join() + view.clientWidth + 'x' + view.clientHeight + st.view;
      if (moved || ck !== lastCam) { lastCam = ck; dirty = true; }
      if (dirty || hp.get('always') === '1') {
        dirty = false; renderer.info.reset();
        const W = innerWidth, H = innerHeight; renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); renderer.clear(); renderer.setScissorTest(true);
        const v = rectOf(view);
        for (const q of halves()) { const sc = S.sc[q.k], C = sc.gfx.C; C.set(st.t); C.U.uCrit.value = st.crit ? 1 : 0; C.U.uGhost.value = st.ghost ? 1 : 0; C.U.uMode.value = 1; C.ghost.visible = st.ghost && st.t < sc.mt.total;   // 竣工后没有“未建”，幽灵趟整趟跳过（省一次全屏填充）
          camFor(q, sc.M.x0);
          const x = v.x + q.x, y = H - v.y - q.h; renderer.setViewport(x, y, q.w, q.h); renderer.setScissor(x, y, q.w, q.h);
          for (const k of ['A', 'B']) S.sc[k].gfx.grp.visible = k === q.k;
          renderer.render(scene, cam); cam.position.x -= sc.M.x0; cam.updateMatrixWorld(); }
        S.calls = renderer.info.render.calls;
        syncCursor();
        // 文字只在时间变了时重写（播放中 ≤ 11 Hz）；图钉在时间 / 相机 / 视图变了时重投影 —— 静止画面不做 DOM 工作
        const tk = st.t.toFixed(2) + st.view + S.regenN + S.mcDone, pk = tk + lastCam + st.pins + st.hot + BAND.d;
        if (tk !== S._tk && (!st.play || now - lastUi > 90)) { S._tk = tk; lastUi = now; uiTick(); }
        if (pk !== S._pk && (!st.play || now - S._pt > 90 || !S._pt)) { S._pk = pk; S._pt = now; updatePins(); }
        S.frames = (S.frames || 0) + 1;
      }
      fpsN++; if (now - fpsT > 500) { fps = fpsN * 1000 / (now - fpsT); fpsN = 0; fpsT = now; S.fps = fps; }
      requestAnimationFrame(frame);
    }
    addEventListener('resize', () => { layout(); });
    layout(); regen(); home(); setBtns(); fitAll();
    $('loading').style.display = 'none';
    Object.assign(S, { ready: true, ctl, cam, R3: renderer, THREE,
      set(t) { st.t = t; st.play = false; setBtns(); dirty = true; syncCursor(); uiTick(); updatePins(); },
      opt(o) { Object.assign(st, o); setBtns(); fitAll(); drawGantt(); dirty = true; },
      setParams(o) { Object.assign(P, o); for (const k of ['berths', 'sts', 'fleet']) $('p-' + k).value = P[k]; $('p-start').value = P.startK; segP('p-found', 'found'); segP('p-phA', 'phA', 1); segP('p-phB', 'phB', 1); clearTimeout(regenT); regen(); },
      P, layout, fitAll, dstr, monthStr });
    Object.defineProperty(S, 'Tmax', { get: () => Tmax });          // 注意：Object.assign 会把 getter 拍平成当时的值
    requestAnimationFrame(frame);
  }
  main().catch(e => { S.errors.push(String(e && e.stack || e)); const l = $('loading'); if (l) l.textContent = '加载失败：' + e; });
})();
