'use strict';
// ===== 筑城图 小样：界面 + 渲染（proto-build3：破風 / 足場 / 吊具；proto-build2 版式）。读 SEQ（通用核心）+ SEQ_OSAKA（构件规格）。
// 经典脚本 + 运行时 importmap（同 app.js），htmlpreview.github.io 下可用。
// build2：版式按窗口实测排布（3D 区保底高度，叠层逐级收起、互不重叠）；控制条移出 3D 区；
//        叠层按钮不再被 OrbitControls 的指针捕获吞掉；图纸渲染到缓存纹理（时间变化时才重画，播放中限 30 Hz）。
(function () {
  const THREE_BASE = 'https://unpkg.com/three@0.160.0/';
  const $ = id => document.getElementById(id);
  const S = { errors: [], ready: false };
  window.__bv = S;
  window.addEventListener('error', e => S.errors.push(String(e.message)));
  const hp = new URLSearchParams(location.hash.replace(/^#/, ''));
  const fmt = (n, d) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 }).replace(/,/g, ' ');
  const sgn = y => (Math.abs(y) < 0.005 ? '±' : y > 0 ? '+' : '−') + Math.abs(y).toFixed(2);
  const pad3 = i => String(i).padStart(3, '0');
  const MC = document.createElement('canvas').getContext('2d');
  const textW = (t, font) => { MC.font = font; return MC.measureText(t).width; };

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
    const gl = renderer.getContext(); let gpu = '—';
    try { const e = gl.getExtension('WEBGL_debug_renderer_info'); const r = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); S.renderer = r; const m = /Apple M\d\w*( (Pro|Max|Ultra))?|SwiftShader|Intel[^,)]*|NVIDIA[^,)]*|AMD[^,)]*|Radeon[^,)]*|Mali[^,)]*|Adreno[^,)]*/.exec(r); gpu = m ? m[0].replace(/\s+/g, ' ').slice(0, 16) : String(r).slice(0, 16); } catch (e) { }
    const scene = new THREE.Scene();
    const C = window.SEQ.compile(THREE, plan, { rise: 1.4, rig: B.rig });
    scene.add(C.group);
    const cam = new THREE.PerspectiveCamera(30, 1, 1, 3000);
    const view = $('view3d'), vp = $('vp');
    const ctl = new OrbitControls(cam, view); ctl.enableDamping = true; ctl.dampingFactor = 0.09; ctl.maxPolarAngle = Math.PI * 0.53; ctl.minDistance = 25; ctl.maxDistance = 600; ctl.autoRotateSpeed = 0.9;
    // 叠层上的按钮：挡住指针事件，免得 OrbitControls 的 setPointerCapture 把 click 吞掉
    for (const el of [$('lcol'), $('dbox'), $('hudp')]) el.addEventListener('pointerdown', e => e.stopPropagation());
    const HOME = { t: [-8, 13, 16], az: +(hp.get('az') || 33), el: +(hp.get('el') || 22), d: +(hp.get('d') || 215) };
    function home(az, el, d, tg) { const a = az * Math.PI / 180, e = el * Math.PI / 180, T = tg || HOME.t; ctl.target.set(T[0], T[1], T[2]); cam.position.set(T[0] + d * Math.cos(e) * Math.sin(a), T[1] + d * Math.sin(e), T[2] + d * Math.cos(e) * Math.cos(a)); ctl.update(); }
    home(HOME.az, HOME.el, HOME.d);
    // 图纸用正交相机（看北：从 +z 看向 −z）；渲染进缓存纹理，每帧只贴图
    const sheets = [
      { el: $('sh1'), cam: new THREE.OrthographicCamera(), cut: [0, 0, 1, 39], win: [-27, 43, -21, 64], marks: true },
      { el: $('sh2'), cam: new THREE.OrthographicCamera(), cut: [0, 0, 1, 0], win: [-25, 41, -2, 64] },
    ];
    const CACHE = hp.get('sheetcache') !== '0';
    const blitMat = new THREE.ShaderMaterial({ uniforms: { map: { value: null } }, vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = vec4(position.xy * 2., 0., 1.); }', fragmentShader: 'uniform sampler2D map; varying vec2 vU; void main(){ gl_FragColor = texture2D(map, vU); }', transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor });
    const blitScene = new THREE.Scene(), blitCam = new THREE.Camera(); const blitQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), blitMat); blitQuad.frustumCulled = false; blitScene.add(blitQuad);
    for (const s of sheets) { s.cam.near = 1; s.cam.far = 1200; s.key = ''; }

    // ---------- 状态 ----------
    const st = { t: hp.get('t') !== null ? Math.min(plan.total, +hp.get('t')) : 0, play: hp.get('play') !== '0', speed: 1, mode: hp.get('mode') === 'real' ? 0 : 1, ghost: hp.get('ghost') !== '0', cut: hp.get('cut') === '1', sheets: hp.get('sheets') !== '0', orbit: hp.get('orbit') === '1', tab: 'order', daysPerSec: plan.total / 48 };
    if (hp.get('t') !== null) st.play = hp.get('play') === '1';
    const U = C.U;
    // ---------- 静态 UI：阶段带 / 时间轴 / 规则 / 自检 ----------
    const total = plan.total, bands = plan.bands, stageKeys = Object.keys(plan.stages);
    $('db-np').textContent = fmt(plan.parts.length) + ' 件 · ' + plan.steps.length + ' 步';
    $('db-ms').textContent = fmt(plan.steps.reduce((a, s) => a + (s.kind === 'build' ? s.mass : 0), 0) / 1000, 1) + ' kt';
    $('crumb').innerHTML = `OSK-T ▸ <b>筑城</b> ▸ ${plan.steps.length} 步 · ${fmt(plan.parts.length)} 构件 · 工期 ${fmt(total)} 日（${plan.date(0)} → ${plan.date(total)}，推算）`;
    $('g-t').textContent = fmt(total) + ' 日';
    const gantt = $('gantt'); gantt.innerHTML = bands.map((b, i) => `<div class="row" data-i="${i}"><span>${String(i + 1).padStart(2, '0')} ${b.name}</span><span class="tr"><i style="left:${b.a / total * 100}%;width:${Math.max(0.6, (b.b - b.a) / total * 100)}%"></i><b style="left:${b.a / total * 100}%;width:0"></b></span><span class="pc">0%</span></div>`).join('') + '<div class="cl"></div>';
    const gRows = [...gantt.querySelectorAll('.row')], gCl = gantt.querySelector('.cl');
    const tr = $('track'), tb = tr.querySelector('.bands');
    tb.innerHTML = bands.map((b, i) => `<i class="${i % 2 ? 'o' : ''}" style="left:${b.a / total * 100}%;width:${(b.b - b.a) / total * 100}%"></i>`).join('');
    for (const b of bands) tr.insertAdjacentHTML('beforeend', `<span class="tick" style="left:${b.a / total * 100}%"></span><span class="lab" style="left:${b.a / total * 100}%;display:none">${b.name}</span>`);
    const tLabs = [...tr.querySelectorAll('.lab')];
    const A = plan.audit, RR = plan.rules;
    const R4 = A.r4 || { temps: 0, pairs: 0, violations: 0, leftover: 0 }, CL = A.clear || { members: 0, hits: 0, rigPoses: 0, rigHits: 0, ms: 0 };
    S.r4 = R4; S.clear = CL;
    $('chk').innerHTML = `R1 支承 ${A.nSup} · R2 先挖后建 ${A.nDig} · R3 after ${A.nAfter} · R4 临时支承 ${A.nTemp || 0} 条<br>无支承步骤 <b class="${A.unsupported.length ? 'ng' : ''}">${A.unsupported.length}</b> · 依赖成环 <b class="${A.cyclic ? 'ng' : ''}">${A.cyclic}</b> · R4 违例 <b class="${R4.violations || R4.leftover ? 'ng' : ''}">${R4.violations}</b> · 竣工残留足場 <b class="${R4.leftover ? 'ng' : ''}">${R4.leftover}</b><br>净空：足場杆件 ${fmt(CL.members)} 根碰撞 <b class="${CL.hits ? 'ng' : ''}">${CL.hits}</b> · 吊具 ${CL.rigPoses} 位姿碰撞 <b class="${CL.rigHits ? 'ng' : ''}">${CL.rigHits}</b> · 排序+检查 ${S.planMs} ms<br>数量全部由几何推出：石 = 生成的石块数 · 瓦 = 瓦面面积 × ${B.ruleParams.tilePerM2.toFixed(1)} 枚/m² · 破風 = 生成的破風数 · 丸太 = 生成的建地数 · 吨 = 体积 × 密度`;
    {
      const no = k => String(stageKeys.indexOf(k) + 1).padStart(2, '0');
      const rate = sk => sk === 'dig' ? fmt(RR.digRate) + ' m³' : sk === 'water' ? fmt(RR.fillRate) + ' m³' : fmt((RR.rates || {})[plan.stages[sk].trade], (RR.rates || {})[plan.stages[sk].trade] < 1 ? 1 : 0) + ' t';
      const rows = bands.map(b => { const sg = plan.stages[b.key]; return `<tr><td>${no(b.key)}</td><td>${sg.name}</td><td>${sg.trade}</td><td class="n">${rate(b.key)}</td><td>${(sg.on || []).map(no).join('·') || '—'}${sg.after ? ' ⊳' + sg.after.map(no).join('·') : ''}</td><td class="n">${b.steps.length}</td><td class="n">${fmt(b.steps.reduce((a, x) => a + x.dur, 0))}</td></tr>`; }).join('');
      $('rules').innerHTML = `<h4>依赖（从几何推出）</h4><p><b>R1 支承</b> B 的底面落在 A 的高度范围内、平面投影重叠 → A 先；阶段可声明“落在”哪些阶段上。· <b>${A.nSup}</b> 条</p><p><b>R2 先挖后建</b> 掘削先于与其包围盒相交的一切建造。· <b>${A.nDig}</b> 条</p><p><b>R3 阶段 after</b> 注水在 ${RR.stages.find(x => x.key === 'water').near} m 内的石垣完成之后。· <b>${A.nAfter}</b> 条</p><p><b>R4 临时支承</b> 足場（临时构件）在它服务的工序（同一重的 柱/梁/屋根/壁/葺瓦，首重另含金具）开工前搭好、全部完成后才解体；解体一旦允许立即进行（下层葺瓦因此在上层足場拆完后）。足場立柱落在已有构件上、柱顶距檐下皮 ≥ ${B.scaf.clear} m；杆件与同时在场的构件求交检查。· <b>${A.nTemp || 0}</b> 条 · ${R4.temps} 座足場 · 违例 <b>${R4.violations}</b></p>
<h4>排序与工期</h4><p>可开工步骤取（阶段序，阶段内由下而上 / 葺瓦由上而下，原序）最小者；串行单工作面。工期 = 质量 ÷ 工种效率，掘削 ÷ ${fmt(RR.digRate)} m³/日，注水 ÷ ${fmt(RR.fillRate)} m³/日，下限 ${RR.minDays} 日 —— 推算值。</p>
<table><tr><th>#</th><th>阶段</th><th>工种</th><th>效率/日</th><th>落在⊳之后</th><th>步</th><th>工日</th></tr>${rows}</table>`;
    }
    $('eg-ridge').textContent = sgn(B.levels.find(l => l.n === '大棟').y) + ' 大棟';
    $('h-tr').textContent = fmt(C.tris); $('h-sg').textContent = fmt(C.segs); $('h-pr').textContent = PR.toFixed(2); $('h-gpu').textContent = gpu; $('h-gpu').title = S.renderer || '';

    // ---------- 交互 ----------
    const setBtn = () => {
      $('b-orbit').classList.toggle('on', st.orbit); ctl.autoRotate = st.orbit;
      $('b-mode').classList.toggle('on', st.mode === 1); $('b-mode').firstChild.textContent = st.mode ? '墨线·淡彩 ' : '写实着色 ';
      $('b-ghost').classList.toggle('on', st.ghost); $('b-cut').classList.toggle('on', st.cut);
      $('p-p').querySelector('.ip').setAttribute('d', st.play ? 'M2.5 1.5h2.4v9H2.5zM7.1 1.5h2.4v9H7.1z' : 'M2.5 1.2v9.6L10.5 6z'); $('p-p').title = st.play ? '暂停（空格）' : '播放（空格）';
      $('p-s').querySelector('.sv').textContent = '×' + st.speed; $('p-s').classList.toggle('on', st.speed > 1);
      $('p-sh').classList.toggle('on', st.sheets); $('db-cut').textContent = st.cut ? 'B–B x=0' : '关';
      if ($('bt').classList.contains('nosheets') === st.sheets) { $('bt').classList.toggle('nosheets', !st.sheets); requestAnimationFrame(() => { layoutSheets(); layoutLog(); }); }
      $('rp').className = 'card t-' + st.tab; $('tab-order').classList.toggle('on', st.tab === 'order'); $('tab-rules').classList.toggle('on', st.tab === 'rules');
      dirty = true;
    };
    $('b-orbit').onclick = () => { st.orbit = !st.orbit; setBtn(); };
    $('b-mode').onclick = () => { st.mode ^= 1; setBtn(); };
    $('b-ghost').onclick = () => { st.ghost = !st.ghost; setBtn(); };
    $('b-cut').onclick = () => { st.cut = !st.cut; setBtn(); };
    $('b-view').onclick = () => { st.orbit = false; home(HOME.az, HOME.el, HOME.d); setBtn(); };
    $('p-p').onclick = () => { if (!st.play && st.t >= total) st.t = 0; st.play = !st.play; setBtn(); };
    $('p-b').onclick = () => { st.t = 0; st.play = false; setBtn(); };
    const stepJump = dir => { const ss = plan.steps, r = plan.at(st.t); let i = r.cur ? r.cur.i : (st.t >= total ? ss.length : ss.findIndex(s => s.start > st.t)) - (dir > 0 ? 1 : 0); i = Math.max(0, Math.min(ss.length - 1, i + dir)); st.t = ss[i].start + ss[i].dur * 0.55; st.play = false; setBtn(); };
    $('p-f').onclick = () => stepJump(1);
    $('p-s').onclick = () => { st.speed = st.speed === 1 ? 2 : st.speed === 2 ? 4 : 1; setBtn(); };
    $('p-sh').onclick = () => { st.sheets = !st.sheets; setBtn(); };
    $('tab-order').onclick = () => { st.tab = 'order'; setBtn(); };
    $('tab-rules').onclick = () => { st.tab = 'rules'; setBtn(); };
    let drag = false; const seek = e => { const r = tr.getBoundingClientRect(); st.t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total; dirty = true; };
    tr.addEventListener('pointerdown', e => { drag = true; tr.setPointerCapture(e.pointerId); seek(e); e.stopPropagation(); });
    tr.addEventListener('pointermove', e => { if (drag) seek(e); }); tr.addEventListener('pointerup', () => { drag = false; }); tr.addEventListener('pointercancel', () => { drag = false; });
    window.addEventListener('keydown', e => {
      if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA/.test(e.target.tagName)) return; const k = e.key.toLowerCase();
      if (k === ' ') { $('p-p').onclick(); e.preventDefault(); } else if (k === 'c') $('b-mode').onclick(); else if (k === 'g') $('b-ghost').onclick(); else if (k === 'x') $('b-cut').onclick(); else if (k === 'v') $('b-view').onclick(); else if (k === 's') $('p-sh').onclick(); else if (k === 'o') $('b-orbit').onclick();
      else if (k === 'arrowright') { stepJump(1); e.preventDefault(); } else if (k === 'arrowleft') { stepJump(-1); e.preventDefault(); } else if (k === 'home') $('p-b').onclick();
    });

    // ---------- 版式：按窗口实测 ----------
    const rectOf = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    let W = 0, H = 0, dirty = true;
    const root = document.documentElement.style, body = document.body;
    function layout() {
      W = window.innerWidth; H = window.innerHeight;
      const short = H < 780, hdH = short ? 46 : 62, rpW = Math.round(Math.max(300, Math.min(380, W * 0.26)));
      const avail = H - 42 - hdH, VPMIN = 300;   // 3D 区保底 ≈ 300 − 控制条 46
      let btH = Math.max(132, Math.min(238, avail * 0.3)); if (avail - btH < VPMIN) btH = Math.max(132, avail - VPMIN);
      const scroll = avail - btH < VPMIN;
      root.setProperty('--hdH', hdH + 'px'); root.setProperty('--rpW', rpW + 'px'); root.setProperty('--btH', Math.round(btH) + 'px'); root.setProperty('--vpMin', VPMIN + 'px'); root.setProperty('--appMin', scroll ? (hdH + VPMIN + btH + 42) + 'px' : '0px');
      const L = W - 34 - rpW;
      body.classList.toggle('short', short); body.classList.toggle('scroll', scroll); body.classList.toggle('rpn', rpW < 340);
      body.classList.toggle('nw1', L < 1000); body.classList.toggle('nw2', L < 820); body.classList.toggle('nw3', L < 560); body.classList.toggle('nwv', L < 760);
      renderer.setSize(W, H, false);
      layoutTrack(); layoutSheets(); layoutLog(); fitOverlays(); dirty = true; lastLogKey = '';
    }
    function layoutTrack() {
      const w = tr.clientWidth; let right = -1e9;
      bands.forEach((b, i) => { const x = b.a / total * w, lw = textW(b.name, '9px ' + getComputedStyle(body).getPropertyValue('--mono')) + 2, el = tLabs[i];
        const ok = x >= right + 8 && x + lw <= w; el.style.display = ok ? '' : 'none'; if (ok) right = x + lw; });
    }
    // 叠层逐级收起：c1 收说明 → c2 图框/HUD 精简 → c3 标题只留当前步 → c4 收图框/HUD 表 → c5 收标题
    const OV = () => [$('tools'), $('ttl'), $('dbox'), $('hudp')].filter(e => e.offsetParent !== null && getComputedStyle(e).display !== 'none');
    function overlapsNow() {
      const v = view.getBoundingClientRect(), bx = OV().map(e => e.getBoundingClientRect()), m = 6;
      for (let i = 0; i < bx.length; i++) { const a = bx[i]; if (a.left < v.left - 1 || a.right > v.right + 1 || a.top < v.top - 1 || a.bottom > v.bottom + 1) return true;
        for (let j = i + 1; j < bx.length; j++) { const b = bx[j]; if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > -m && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > -m) return true; } }
      const va = v.width * v.height, cov = bx.reduce((a, q) => a + q.width * q.height, 0) / va;   // 叠层合计不超过 3D 区的 30%
      return cov > 0.3;
    }
    let fitLevel = 0;
    function fitOverlays() {
      const vw = view.clientWidth, LV = ['c1', 'c2', 'c3', 'c4', 'c5'];
      for (let k = 0; k <= LV.length; k++) {
        view.className = LV.slice(0, k).join(' ');
        const dbW = getComputedStyle($('dbox')).display === 'none' ? 0 : $('dbox').offsetWidth + 16;
        $('ttl').style.maxWidth = Math.max(180, Math.min(430, vw - 20 - dbW - 10)) + 'px';
        $('tools').style.maxWidth = Math.max(160, vw - 20 - (k < 4 ? dbW + 10 : 0)) + 'px';
        fitLevel = k; if (!overlapsNow()) break;
      }
      S.fitLevel = fitLevel;
    }
    // 图纸：建筑放在左侧，右侧留标高标注栏；标注按优先级挑、最小间距 11 px，带纸色描边
    const GUT = 74, TOP = 22;
    function layoutSheets() {
      for (const s of sheets) {
        const d = s.el.querySelector('.draw'), r = rectOf(d); s.r = r;
        if (r.w < 10 || r.h < 10) continue;
        const [x0, x1, y0, y1] = s.win, dw = r.w - GUT, dh = r.h - TOP - 4, mpp = Math.max((x1 - x0) / dw, (y1 - y0) / dh), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const ox = dw / 2, oy = TOP + dh / 2;   // 窗口中心在像素 (ox, oy)
        s.mpp = mpp;
        Object.assign(s.cam, { left: cx - ox * mpp, right: cx + (r.w - ox) * mpp, top: cy + oy * mpp, bottom: cy - (r.h - oy) * mpp }); s.cam.position.set(0, 0, 400); s.cam.lookAt(0, 0, 0); s.cam.updateProjectionMatrix();
        s.el.querySelector('.sc').textContent = '1:' + fmt(Math.round(mpp * 1000 * 96 / 25.4 / 50) * 50);
        const py = y => oy - (y - cy) / mpp, px = x => ox + (x - cx) / mpp, svg = s.el.querySelector('svg');
        svg.setAttribute('width', r.w); svg.setAttribute('height', r.h);
        const halo = 'paint-order="stroke" stroke="#f6f2ea" stroke-width="2.6" stroke-linejoin="round"';
        let h = `<line x1="${r.w - GUT}" x2="${r.w - GUT}" y1="${TOP - 6}" y2="${r.h}" stroke="#d4cbbb" stroke-width=".6"/>`;
        const pri = n => /大棟|天守台|本丸|堀底/.test(n) ? 0 : /水位/.test(n) ? 1 : 2;
        const cand = B.levels.filter(l => py(l.y) >= TOP - 2 && py(l.y) <= r.h - 3).sort((a, b) => pri(a.n) - pri(b.n) || b.y - a.y), keep = [];
        for (const l of cand) { const y = py(l.y); if (keep.every(k => Math.abs(py(k.y) - y) >= 11)) keep.push(l); }
        for (const l of keep) { const y = py(l.y), xl = r.w - GUT + 2;
          h += `<line x1="${xl}" x2="${r.w - 2}" y1="${y}" y2="${y}" stroke="#b3202a" stroke-width=".6" stroke-dasharray="3 2"/><path d="M${xl + 4} ${y}l-3 -3.5h6z" fill="#b3202a"/><text x="${xl + 9}" y="${y - 2}" font-size="8" font-family="monospace" fill="#b3202a" ${halo}>${sgn(l.y)} ${l.n}</text>`; }
        for (const gx of [-14, 0, 14]) { const x = px(gx); if (x < 8 || x > r.w - GUT - 6) continue; h += `<line x1="${x}" x2="${x}" y1="${13}" y2="${r.h - 2}" stroke="#5d564c" stroke-width=".4" stroke-dasharray="8 2 1 2"/><circle cx="${x}" cy="8" r="5" fill="#f6f2ea" stroke="#5d564c" stroke-width=".6"/><text x="${x}" y="10.5" font-size="6.5" text-anchor="middle" font-family="monospace" fill="#1d1a17">${gx < 0 ? 'A' : gx ? 'C' : 'B'}</text>`; }
        // 破風标注（A-201 南立面）：标在破风顶上方、建筑区内；按高度排、最小间距 11 px，放不下就不标；构件开工后才显示
        const marks = [];
        if (s.marks && B.hafuMarks) { const used = [];
          // 标签放在建筑左侧（x = −26 m 处起），引线指到破风顶；放不下（太窄 / 太挤）就不标
          const lx = 4;
          for (const m of B.hafuMarks) { const x = px(m.x), y = py(m.y), tw = textW(m.n, '8px monospace') + 2, ty = Math.max(TOP + 8, y - 6);
            if (lx + tw + 3 > Math.min(x - 4, px(-m.xl)) || ty < TOP + 8 || ty > r.h - 6 || used.some(u => Math.abs(u - ty) < 11)) continue; used.push(ty);
            const st0 = plan.steps.find(q => q.parts.some(p => p.id === m.part)); marks.push({ t: st0 ? st0.start : 0, ty });
            h += `<g class="hm" style="display:none"><polyline style="display:none" points="${lx},${ty + 2} ${lx + tw},${ty + 2} ${x - 1.5},${y - 1.5}" fill="none" stroke="#1d1a17" stroke-width=".55"/><circle style="display:none" cx="${x}" cy="${y}" r="1.4" fill="#1d1a17"/><text style="display:none" x="${lx}" y="${ty}" font-size="8" font-family="monospace" fill="#1d1a17" ${halo}>${m.n}</text></g>`; } }
        h += `<g><line x1="0" x2="${r.w - GUT}" y1="0" y2="0" stroke="#b3202a" stroke-width="1"/><text x="4" y="-3" font-size="8.5" font-family="monospace" fill="#b3202a" ${halo}>施工面</text></g>`;
        svg.innerHTML = h; const gs = [...svg.querySelectorAll('g')]; s.cur = gs[gs.length - 1]; s.curT = s.cur.querySelector('text'); s.py = py; s.key = ''; s.lastCurY = null; s.finShown = null;
        s.hm = [...svg.querySelectorAll('g.hm')].map((el, k) => ({ el, t: marks[k].t, ty: marks[k].ty, on: false }));
        // 缓存纹理
        const tw = Math.max(1, Math.round(r.w * PR)), th = Math.max(1, Math.round(r.h * PR));
        if (!s.rt) s.rt = new THREE.WebGLRenderTarget(tw, th, { samples: 4, depthBuffer: true }); else s.rt.setSize(tw, th);
      }
    }
    // 施工日志：行数按面板实测高度；表头贴顶
    let logRows = 9;
    function layoutLog() { const l = $('logl'); const avail = l.clientHeight - 8; logRows = Math.max(2, Math.floor(avail / 15.4) - 1); }
    window.addEventListener('resize', layout);
    window.addEventListener('scroll', () => { for (const s of sheets) s.r = rectOf(s.el.querySelector('.draw')); dirty = true; }, { passive: true });

    const logEl = $('logl'); let lastLogKey = '', lastUi = 0, lastStepI = -1, lastStage = '';
    const verb = s => plan.stages[s.stage].verb, qty = s => { const t = s.tally, k = Object.keys(t)[0]; const u = { stone: '块', tile: '枚', col: '根', beam: '根', win: '窓', gold: '件', pole: '根', hafu: '面破風' }; if (s.kind === 'remove') return fmt(s.vol) + ' m³'; if (s.kind === 'fill') return fmt(s.vol) + ' m³ 水'; return (k ? fmt(t[k]) + ' ' + u[k] + ' · ' : '') + fmt(s.mass, s.mass < 10 ? 1 : 0) + ' t'; };
    const elev = s => sgn(s.bb.min[1]) + '→' + sgn(s.bb.max[1]);
    function ui(r) {
      const s = r.cur || plan.steps.filter(x => x.end <= r.t).pop() || plan.steps[0], sn = plan.stages[s.stage];
      // 页眉状态
      $('st-stage').textContent = sn.name + (r.cur ? '' : r.t >= total ? ' · 已完成' : '');
      $('st-step').textContent = `步骤 ${pad3(s.i + 1)}/${plan.steps.length} · ${fmt(r.tally.stone || 0)} 块石`;
      $('st-bar').firstChild.style.width = (r.pct * 100).toFixed(1) + '%';
      $('st-date').textContent = plan.date(r.t); $('st-day').innerHTML = `第 ${fmt(r.t)} 日 / ${fmt(total)} · <b>推算</b>`;
      // 视口标题 + 图框
      $('ttl-k').textContent = `步骤 ${pad3(s.i + 1)} / ${plan.steps.length} · ${sn.name} · 标高 ${sgn(r.elev == null ? 0 : r.elev)} m`;
      $('ttl-e').textContent = s.name + ' · ' + elev(s); $('ttl-e2').textContent = s.spec || '';
      $('db-st').textContent = sn.name; $('db-sp').textContent = pad3(s.i + 1) + ' / ' + plan.steps.length;
      // 时间轴
      const pc = r.t / total * 100; tr.querySelector('.fill').style.width = pc + '%'; tr.querySelector('.knob').style.left = pc + '%';
      $('tlab').innerHTML = `${plan.date(r.t)} <small>· 第 ${fmt(r.t)}/${fmt(total)} 日</small>`;
      gCl.style.left = `calc(76px + (100% - 110px) * ${r.t / total})`;
      bands.forEach((b, i) => { const done = b.steps.reduce((a, x) => a + Math.max(0, Math.min(1, (r.t - x.start) / x.dur)) * x.dur, 0) / b.steps.reduce((a, x) => a + x.dur, 0);
        const row = gRows[i]; row.className = 'row' + (b.key === s.stage && r.cur ? ' cur' : done >= 1 ? ' done' : ''); row.querySelector('.pc').textContent = Math.round(done * 100) + '%';
        row.querySelector('b').style.width = ((Math.min(r.t, b.b) - b.a) > 0 ? (Math.min(r.t, b.b) - b.a) / total * 100 : 0) + '%'; });
      // 当前步骤卡
      const p = r.cur ? r.p : (r.t >= s.end ? 1 : 0), narrow = body.classList.contains('rpn');
      $('el-s').textContent = r.cur ? '施工中' : p >= 1 ? '已完成' : '待开工'; $('el-n').textContent = s.name; $('el-i').textContent = '#' + pad3(s.i + 1) + ' / ' + plan.steps.length;
      $('el-g').textContent = narrow ? sn.name : String(stageKeys.indexOf(s.stage) + 1).padStart(2, '0') + ' · ' + sn.name; $('el-c').textContent = qty(s).split(' · ')[0];
      $('el-t').textContent = s.trade; $('el-m').textContent = fmt(s.mass, s.mass < 10 ? 1 : 0) + ' t'; $('el-d').textContent = fmt(s.dur, 1) + ' 日';
      $('el-sp').textContent = s.spec || '—';
      const why = { sup: '支承', dig: '先挖', after: '之后', temp: '足場', erect: '搭设', served: '待完' }; const ds = [...s.deps]; $('el-dp').textContent = ds.length ? ds.slice().sort((a, b) => (s.why[a.key] === 'temp' ? -1 : 0) - (s.why[b.key] === 'temp' ? -1 : 0)).slice(0, 4).map(d => `${why[s.why[d.key]]} ${d.name}`).join(' · ') + (ds.length > 4 ? ` 等 ${ds.length} 项` : '') : '无（地基 / 原状）';
      $('el-y').textContent = elev(s) + ' m'; $('el-a').textContent = s.anchor.map(v => (Math.abs(v) < 0.05 ? 0 : v).toFixed(1)).join(' · '); $('el-p').textContent = Math.round(p * 100) + ' %';
      // 统计
      $('s-pc').textContent = (r.pct * 100).toFixed(1) + ' % · ' + r.done + '/' + plan.steps.length + ' 步';
      $('s-st').textContent = fmt(r.tally.stone || 0) + ' 块'; $('s-tl').textContent = fmt(r.tally.tile || 0) + ' 枚'; $('s-ms').textContent = fmt(r.mass) + ' t';
      $('s-dg').textContent = fmt(r.removed) + ' m³'; $('s-el').textContent = r.elev == null ? '—' : sgn(r.elev) + ' m'; $('s-cw').textContent = fmt(r.tally.col || 0) + ' / ' + fmt(r.tally.win || 0);
      $('s-pl').textContent = fmt(r.tally.pole || 0) + ' 根'; $('s-pl').title = '累计搭设 ' + fmt(r.tempUp.pole || 0) + ' 根'; $('s-hf').textContent = fmt(r.tally.hafu || 0) + ' 面';
      const rp = C.rig.pose; $('s-rg').textContent = rp ? (rp.legs ? '人字架 ' : '滑车 ') + sgn(rp.y + rp.h).replace('+', '') : '—';
      for (const sh of sheets) { sh.el.querySelector('.stg').textContent = sn.name; sh.el.querySelector('.dt').textContent = plan.date(r.t); }
      // 日志
      const evs = plan.events.filter(e => e.t <= r.t + 1e-6), key = evs.length + ':' + logRows;
      if (key !== lastLogKey) { lastLogKey = key;
        const last = evs.slice(-logRows);
        logEl.innerHTML = '<div class="hd"><span>日期</span><span>动作</span><span>构件</span><span>数量</span><span>标高</span></div>' + last.map((e, k) => { const x = e.s;
          return `<div class="${k === last.length - 1 ? 'new' : ''} ${e.ev === 'end' ? 'end' : ''}"><span>${plan.date(e.t)}</span><b>${e.ev === 'end' ? '完成' : verb(x)}</b><span title="${x.name}">${x.name}</span><span>${qty(x).split(' · ')[0]}</span><span>${elev(x)}</span></div>`; }).join('');
        $('lg-b').textContent = r.cur ? sn.name + ' 进行中' : r.t >= total ? '竣工' : '待开工'; $('lg-n').textContent = evs.length + ' 条事件';
      }
      if (s.i !== lastStepI || sn.name !== lastStage) { lastStepI = s.i; lastStage = sn.name; fitOverlays(); }
    }
    // 引线标注：在叠层之外找一块空地；找不到就只画锚点
    const SERIF = getComputedStyle(body).getPropertyValue('--serif');
    function leader(r) {
      const svg = $('lead'), s = r.cur; if (!s) { svg.innerHTML = ''; return; }
      const v = view.getBoundingClientRect(), a = new THREE.Vector3(...s.anchor).project(cam);
      svg.setAttribute('width', v.width); svg.setAttribute('height', v.height);
      const x = (a.x + 1) / 2 * v.width, y = (1 - a.y) / 2 * v.height;
      if (a.z > 1 || x < 4 || y < 4 || x > v.width - 4 || y > v.height - 4) { svg.innerHTML = ''; return; }
      const t1 = s.name, t2 = qty(s) + ' · ' + s.trade;
      const w = Math.ceil(Math.max(textW(t1, `700 13.5px ${SERIF}`), textW(t2, `11.5px ${SERIF}`))) + 4, h = 36, m = 6;
      const obs = OV().map(e => { const q = e.getBoundingClientRect(); return { l: q.left - v.left - m, r: q.right - v.left + m, t: q.top - v.top - m, b: q.bottom - v.top + m }; });
      const free = (lx, ly) => lx >= 8 && ly >= 8 && lx + w <= v.width - 8 && ly + h <= v.height - 8 && obs.every(o => lx + w < o.l || lx > o.r || ly + h < o.t || ly > o.b) && !(x >= lx - 4 && x <= lx + w + 4 && y >= ly - 4 && y <= ly + h + 4);
      const C = [[x + 60, y - 70], [x - 60 - w, y - 70], [x + 60, y + 30], [x - 60 - w, y + 30], [x + 40, y - 120], [x - 40 - w, y - 120], [x + 90, y - 20], [x - 90 - w, y - 20]];
      let pos = null; for (const [lx, ly] of C) if (free(lx, ly)) { pos = [lx, ly]; break; }
      let out = `<circle cx="${x}" cy="${y}" r="4" fill="none" stroke="#b3202a" stroke-width="1.2"/><circle cx="${x}" cy="${y}" r="1.5" fill="#b3202a"/>`;
      if (pos) { const [lx, ly] = pos, ux = lx + w / 2 < x ? lx + w : lx, yb = ly + 20;
        out += `<polyline points="${x},${y} ${ux},${yb} ${ux === lx ? lx + w : lx},${yb}" fill="none" stroke="#b3202a" stroke-width=".8"/>
        <text x="${lx}" y="${ly + 14}" font-family="${SERIF}" font-size="13.5" font-weight="700" fill="#1d1a17" paint-order="stroke" stroke="#efe9dd" stroke-width="3">${t1}</text><text x="${lx}" y="${ly + 33}" font-family="${SERIF}" font-size="11.5" fill="#b3202a" paint-order="stroke" stroke="#efe9dd" stroke-width="3">${t2}</text>`; }
      svg.innerHTML = out; S.leaderPlaced = !!pos;
    }

    let last = performance.now(), fpsN = 0, fps = 0, fpsT = last, lastCamKey = ''; const frameMs = [];
    const camKey = () => cam.position.toArray().map(v => v.toFixed(2)).join() + view.clientWidth + 'x' + view.clientHeight;
    function drawSheet(s, r) {
      U.uMode.value = 1; U.uGhost.value = 1; U.uCutOn.value = 1; U.uCut.value.set(...s.cut); U.uLA.value = 0.55;
      renderer.render(scene, s.cam);
    }
    function frame(now) {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (st.play && !drag) { st.t += dt * st.daysPerSec * st.speed; if (st.t >= total) { st.t = total; st.play = false; setBtn(); } }
      ctl.update();
      const r = C.set(st.t);
      renderer.info.reset();
      // 图纸缓存：时间变了才重画（播放中最多 30 Hz）
      let sheetDrawn = 0;   // 每帧最多重画一张，两张错开，避免同一帧尖峰
      if (st.sheets && CACHE) for (const s of sheets.slice().sort((a, b) => (a.drawn || 0) - (b.drawn || 0))) {
        if (!s.rt || !s.r || s.r.w < 10 || sheetDrawn) continue;
        const k = st.t.toFixed(3);
        if (k !== s.key && (!st.play || now - (s.drawn || 0) > 33)) { s.key = k; s.drawn = now; sheetDrawn++; renderer.setRenderTarget(s.rt); renderer.setScissorTest(false); renderer.setViewport(0, 0, s.r.w, s.r.h); renderer.clear(); drawSheet(s, r); renderer.setRenderTarget(null); s.renders = (s.renders || 0) + 1; }
      }
      renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); renderer.clear();
      renderer.setScissorTest(true);
      const v = rectOf(view); cam.aspect = v.w / v.h; cam.updateProjectionMatrix();
      renderer.setViewport(v.x, H - v.y - v.h, v.w, v.h); renderer.setScissor(v.x, H - v.y - v.h, v.w, v.h);
      U.uMode.value = st.mode; U.uGhost.value = st.ghost ? 1 : 0; U.uCutOn.value = st.cut ? 1 : 0; U.uCut.value.set(1, 0, 0, 0); U.uLA.value = 1;
      renderer.render(scene, cam);
      const mainCalls = renderer.info.render.calls;
      if (st.sheets) for (const s of sheets) {
        const q = s.r; if (!q || q.w < 10) continue;
        renderer.setViewport(q.x, H - q.y - q.h, q.w, q.h); renderer.setScissor(q.x, H - q.y - q.h, q.w, q.h);
        if (CACHE) { blitMat.uniforms.map.value = s.rt.texture; renderer.render(blitScene, blitCam); } else drawSheet(s, r);
        let cy = s.lastCurY;
        if (s.cur) { const ce = r.elev == null ? -18 : r.elev; let y = s.py(ce); y = Math.max(14, Math.min(q.h - 2, y)); cy = y; if (y !== s.lastCurY) { s.lastCurY = y; s.cur.setAttribute('transform', `translate(0 ${y.toFixed(1)})`); s.curT.setAttribute('y', y < 34 ? 10 : -3); } }
        // 竣工后不再有施工面；破风标注：构件开工后显示，与“施工面”字样同高时让开
        const fin = st.t >= total - 1e-6; if (s.cur && s.finShown !== fin) { s.finShown = fin; s.cur.style.display = fin ? 'none' : ''; s.curT.style.display = fin ? 'none' : ''; }
        if (s.hm) { const ly = cy == null || fin ? -99 : (cy < 34 ? cy + 10 : cy - 3); for (const m of s.hm) { const on = st.t >= m.t && Math.abs(m.ty - ly) > 12; if (on !== m.on) { m.on = on; for (const e of [m.el, ...m.el.children]) e.style.display = on ? '' : 'none'; } } }
      }
      // fps（rAF 实测）
      fpsN++; if (now - fpsT > 500) { fps = fpsN * 1000 / (now - fpsT); fpsN = 0; fpsT = now; $('h-fps').textContent = fps.toFixed(0); const sorted = frameMs.slice().sort((a, b) => a - b); $('h-ms').textContent = (sorted[Math.floor(sorted.length / 2)] || 0).toFixed(1) + ' ms'; }
      frameMs.push((now - (S._pn || now))); S._pn = now; if (frameMs.length > 240) frameMs.shift();
      const ck = camKey(); if (ck !== lastCamKey) { lastCamKey = ck; dirtyLead = true; }
      if (now - lastUi > 90 || dirty) { lastUi = now; dirty = false; ui(r); leader(r); dirtyLead = false;
        $('h-dc').textContent = mainCalls; $('h-dt').textContent = renderer.info.render.calls;
        const az = Math.atan2(cam.position.x - ctl.target.x, cam.position.z - ctl.target.z) * 180 / Math.PI, el = Math.asin((cam.position.y - ctl.target.y) / cam.position.distanceTo(ctl.target)) * 180 / Math.PI;
        $('db-cam').textContent = `AZ ${((az + 360) % 360).toFixed(0)}° EL ${el.toFixed(0)}°`; }
      else if (dirtyLead) { leader(r); dirtyLead = false; }
      S.calls = { main: mainCalls, frame: renderer.info.render.calls }; S.fps = fps; S.frameMs = frameMs;
      requestAnimationFrame(frame);
    }
    let dirtyLead = false;
    $('load').style.display = 'none';
    setBtn(); layout();
    Object.assign(S, { ready: true, plan, C, st, ctl, tris: C.tris, segs: C.segs, sheets, set(t) { st.t = t; st.play = false; setBtn(); }, mode(m) { st.mode = m; setBtn(); }, opt(o) { Object.assign(st, o); setBtn(); }, home, layout });
    requestAnimationFrame(frame);
  }
  main().catch(e => { S.errors.push(String(e && e.stack || e)); const l = $('load'); if (l) l.textContent = '加载失败：' + e; });
})();
