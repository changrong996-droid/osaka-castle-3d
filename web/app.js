'use strict';
// ===== 大阪城 全城 3D：渲染 + 界面（three.js r160） =====
// 经典脚本（不是 module）：这样在 htmlpreview.github.io 下也能被注入执行；three.js 用动态 import + 运行时注入的 importmap 从 unpkg 加载。
(function () {
  const THREE_BASE = 'https://unpkg.com/three@0.160.0/';
  const $ = id => document.getElementById(id);
  const SITE = window.CASTLE_SITE;
  const state = { errors: [] };
  window.__castle = state;

  // ---------- URL 参数（#seed=1&lost=1&view=aerial&labels=1&cell=1.5）----------
  function readHash() {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    return { seed: +(p.get('seed') || 1), lost: p.get('lost') !== '0', view: p.get('view') || 'aerial', labels: p.get('labels') !== '0', cell: +(p.get('cell') || SITE.SPEC.grid.cell), audit: p.get('audit') !== '0', camgeo: p.get('camgeo') === '1', fault: p.get('fault') || '', usePack: p.get('pack') !== '0' };
  }
  function writeHash(o) { const h = '#seed=' + o.seed + '&lost=' + (o.lost ? 1 : 0) + '&view=' + o.view + '&labels=' + (o.labels ? 1 : 0) + (o.cell !== SITE.SPEC.grid.cell ? '&cell=' + o.cell : ''); if (location.hash !== h) { try { history.replaceState(null, '', location.href.split('#')[0] + h); } catch (e) { try { location.hash = h; } catch (e2) {} } } }

  // r8a：预构建结果包（web/bake/，tools/bake.js 生成）。键 = site.js 源码哈希 + 数据哈希 + 选项，与清单（bake/manifest.js）里的一致才下载；
  // 下载与 three.js 的加载并行；任何一步失败（file://、没有 DecompressionStream、键不符、解码出错）都退回现场生成，结果相同。
  async function loadPack(o) {
    const PK = window.CASTLE_PACK, MAN = window.CASTLE_BAKE;
    if (!PK || !MAN || location.protocol === 'file:' || o.cell !== SITE.SPEC.grid.cell || !o.usePack) return null;
    const key = SITE.genKey({ seed: o.seed, lost: o.lost, cell: o.cell }), ent = MAN[key]; if (!ent) { state.pack = { used: false, why: 'no pack for key' }; return null; }
    const t0 = performance.now(), r = await fetch(ent.file + '?k=' + key.split('-')[1]); if (!r.ok) throw new Error('pack ' + r.status);
    const raw = new Uint8Array(await r.arrayBuffer()), t1 = performance.now(), u8 = await PK.gunzip(raw), P = PK.parse(u8);
    if (P.hdr.key !== key) { state.pack = { used: false, why: 'key mismatch' }; return null; }
    state.pack = { used: false, file: ent.file, bytes: raw.length, fetchMs: Math.round(t1 - t0), unzipMs: Math.round(performance.now() - t1) }; return P;
  }
  async function main() {
    const T00 = performance.now(), P0 = readHash(), packP = loadPack(P0).catch(e => { state.pack = { used: false, why: String(e && e.message || e) }; return null; });
    const im = document.createElement('script'); im.type = 'importmap';
    im.textContent = JSON.stringify({ imports: { three: THREE_BASE + 'build/three.module.js', 'three/addons/': THREE_BASE + 'examples/jsm/' } });
    document.head.appendChild(im);
    const modsP = Promise.all([import('three'), import('three/addons/controls/OrbitControls.js'), import('three/addons/objects/Sky.js')]); // 三个模块并行取
    // r8a：读包与 three.js 的加载重叠——包先到就先把生成结果恢复出来（build 读包，~0.1–0.2 s），再等模块
    const pk = await packP; let pre = null; state.tl = { main: Math.round(T00), pack: Math.round(performance.now()) };
    if (pk) { try { pre = SITE.build({ seed: P0.seed, lost: P0.lost, cell: P0.cell, pack: pk }); state.pack.used = true; state.pack.restoreMs = Math.round(pre.ms); } catch (e) { state.pack.used = false; state.pack.why = 'restore: ' + (e && e.message || e); pre = null; } }
    state.tl.restored = Math.round(performance.now()); const [THREE, { OrbitControls }, { Sky }] = await modsP; state.tl.mods = Math.round(performance.now());
    run(THREE, OrbitControls, Sky, pre, T00);
  }

  function run(THREE, OrbitControls, Sky, PREBUILT, T00) {
    const T0 = T00 === undefined ? performance.now() : T00; // r8a：从 main() 开始计（含读包），不再从 run() 开始
    const P = readHash();
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.72;
    document.body.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xbfc8cc, 1400, 4200);
    const CAM_R = 1.5; // 相机球体半径（m）
    // 近裁剪面按规则：近平面四角到相机的距离 ≤ 0.9R（球体保证几何离相机 ≥R，所以近处墙面不会被近平面切掉），在此前提下取最大以保深度精度
    const nearFor = (fov, asp) => { const t = Math.tan(fov * Math.PI / 360); return 0.9 * CAM_R / Math.sqrt(1 + t * t * (1 + asp * asp)); };
    const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, nearFor(40, innerWidth / innerHeight), 9000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 3; controls.maxDistance = 3000;
    const sky = new Sky(); sky.scale.setScalar(8000); scene.add(sky);
    const su = sky.material.uniforms; su.turbidity.value = 6; su.rayleigh.value = 1.5; su.mieCoefficient.value = 0.005; su.mieDirectionalG.value = 0.8;
    const sun = new THREE.DirectionalLight(0xfff0dc, 3.0); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -620, right: 620, top: 620, bottom: -620, near: 10, far: 3000 }); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.6;
    scene.add(sun, sun.target); const hemi = new THREE.HemisphereLight(0xd6e4ff, 0x5d5545, 1.35); scene.add(hemi);
    { const el = 0.6, az = THREE.MathUtils.degToRad(215), v = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - el, az); su.sunPosition.value.copy(v); sun.position.copy(v).multiplyScalar(1500); sun.target.position.set(0, 0, 0); }
    // world (x 东, y 北, z 上) -> three (x, z, -y)
    const W = (x, y, z) => new THREE.Vector3(x, z, -y);
    function clipHalf(P, m, c0) { const out = [], f = q => m[0] * q[0] + m[1] * q[1] - c0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], fa = f(a), fb = f(b); if (fa <= 0) out.push(a); if ((fa < 0) !== (fb < 0) && fa !== 0 && fb !== 0) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); } } return out; }

    // ---------- 材质 ----------
    const M = {
      plaster: new THREE.MeshStandardMaterial({ color: 0xf1ede2, roughness: 0.9 }),
      stone: new THREE.MeshStandardMaterial({ color: 0x8b857a, roughness: 0.95 }),
      tile: new THREE.MeshStandardMaterial({ color: 0x3d434b, roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide }),
      ridge: new THREE.MeshStandardMaterial({ color: 0x23272c, roughness: 0.6 }),
      lacquer: new THREE.MeshStandardMaterial({ color: 0x1a1817, roughness: 0.5 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x5a3b26, roughness: 0.8 }),
      iron: new THREE.MeshStandardMaterial({ color: 0x1e1f22, roughness: 0.45, metalness: 0.5 }),
      window: new THREE.MeshStandardMaterial({ color: 0x2b2622, roughness: 0.8 }),
      deck: new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.85 }),
      vermil: new THREE.MeshStandardMaterial({ color: 0x9a3b26, roughness: 0.7 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xd9a63a, metalness: 1, roughness: 0.3 }),
      road: new THREE.MeshStandardMaterial({ color: 0xa39478, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    };
    const badMat = new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.45, depthWrite: false });

    // ---------- 几何累加器（每种材质合并成一个网格）----------
    function Kit() {
      const acc = {};
      const push = (m, ...vs) => { const a = acc[m] || (acc[m] = []); for (const v of vs) a.push(v[0], v[2], -v[1]); };
      const tri = (m, a, b, c) => push(m, a, b, c);
      const quad = (m, a, b, c, d) => { push(m, a, b, c); push(m, a, c, d); };
      function box(m, cx, cy, z0, w, d, h, ang) { // 底面中心 (cx,cy,z0)，w 沿 ang 方向
        const c = Math.cos(ang || 0), s = Math.sin(ang || 0), P = (u, v, z) => [cx + u * c - v * s, cy + u * s + v * c, z];
        const hw = w / 2, hd = d / 2, z1 = z0 + h;
        const p = [P(-hw, -hd, z0), P(hw, -hd, z0), P(hw, hd, z0), P(-hw, hd, z0), P(-hw, -hd, z1), P(hw, -hd, z1), P(hw, hd, z1), P(-hw, hd, z1)];
        quad(m, p[4], p[5], p[6], p[7]); quad(m, p[0], p[3], p[2], p[1]);
        quad(m, p[0], p[1], p[5], p[4]); quad(m, p[1], p[2], p[6], p[5]); quad(m, p[2], p[3], p[7], p[6]); quad(m, p[3], p[0], p[4], p[7]);
      }
      function seg(m, x0, y0, x1, y1, z0, t, h) { const L = Math.hypot(x1 - x0, y1 - y0); box(m, (x0 + x1) / 2, (y0 + y1) / 2, z0, L, t, h, Math.atan2(y1 - y0, x1 - x0)); }
      // r7b：斜墙段——底面沿墙从 za 线性变到 zb（斜面台地上的土塀/枡形墙跟着地面走），高 h、厚 t
      function sseg(m, x0, y0, x1, y1, za, zb, t, h) { const L = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / L * t / 2, ny = (x1 - x0) / L * t / 2;
        const p = [[x0 - nx, y0 - ny, za], [x1 - nx, y1 - ny, zb], [x1 + nx, y1 + ny, zb], [x0 + nx, y0 + ny, za]]; const q = p.map(v => [v[0], v[1], v[2] + h]);
        quad(m, q[0], q[1], q[2], q[3]); quad(m, p[0], p[3], p[2], p[1]); quad(m, p[0], p[1], q[1], q[0]); quad(m, p[1], p[2], q[2], q[1]); quad(m, p[2], p[3], q[3], q[2]); quad(m, p[3], p[0], q[0], q[3]); }
      function prism(m, poly, z0, z1, mtop) { // 多边形柱（可凹）
        const area = poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1], 0);
        const pl = area < 0 ? poly.slice().reverse() : poly;
        const tris = THREE.ShapeUtils.triangulateShape(pl.map(p => new THREE.Vector2(p[0], p[1])), []);
        for (const [a, b, c] of tris) tri(mtop || m, [pl[a][0], pl[a][1], z1], [pl[b][0], pl[b][1], z1], [pl[c][0], pl[c][1], z1]);
        for (let i = 0; i < pl.length; i++) { const a = pl[i], b = pl[(i + 1) % pl.length]; quad(m, [a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]); }
      }
      // 庑殿/入母屋式屋顶（简化）：檐口矩形 → 屋脊
      function hip(m, cx, cy, z0, w, d, ang, ov, rise, ridgeK) {
        const c = Math.cos(ang), s = Math.sin(ang), P = (u, v, z) => [cx + u * c - v * s, cy + u * s + v * c, z];
        const W2 = w / 2 + ov, D2 = d / 2 + ov, r = Math.max(0.3, (w - d) / 2 + d * (ridgeK || 0.15)), z1 = z0 + rise;
        const e = [P(-W2, -D2, z0), P(W2, -D2, z0), P(W2, D2, z0), P(-W2, D2, z0)], ra = P(-r, 0, z1), rb = P(r, 0, z1);
        quad(m, e[0], e[1], rb, ra); quad(m, e[2], e[3], ra, rb); tri(m, e[1], e[2], rb); tri(m, e[3], e[0], ra); quad(m, e[3], e[2], e[1], e[0]);
        seg('ridge', ra[0], ra[1], rb[0], rb[1], z1 - 0.15, 0.5, 0.5);
      }
      function gable(m, cx, cy, z0, w, d, ang, ov, rise) { // 切妻
        const c = Math.cos(ang), s = Math.sin(ang), P = (u, v, z) => [cx + u * c - v * s, cy + u * s + v * c, z];
        const W2 = w / 2 + ov, D2 = d / 2 + ov;
        quad(m, P(-W2, -D2, z0), P(W2, -D2, z0), P(W2, 0, z0 + rise), P(-W2, 0, z0 + rise)); quad(m, P(W2, D2, z0), P(-W2, D2, z0), P(-W2, 0, z0 + rise), P(W2, 0, z0 + rise));
        quad(m, P(-W2, D2, z0), P(W2, D2, z0), P(W2, -D2, z0), P(-W2, -D2, z0));
        tri('plaster', P(-w / 2, -d / 2, z0), P(-w / 2, 0, z0 + rise * 0.95), P(-w / 2, d / 2, z0)); tri('plaster', P(w / 2, d / 2, z0), P(w / 2, 0, z0 + rise * 0.95), P(w / 2, -d / 2, z0));
        const a = P(-W2, 0, z0 + rise), b = P(W2, 0, z0 + rise); seg('ridge', a[0], a[1], b[0], b[1], z0 + rise - 0.1, 0.45, 0.4);
      }
      function windows(cx, cy, z, w, d, ang, n, m2) { const c = Math.cos(ang), s = Math.sin(ang); for (const sd of [-1, 1]) { for (let i = 0; i < n; i++) { const u = -w / 2 + w * (i + 0.5) / n, v = sd * (d / 2 + 0.03); box(m2 || 'window', cx + u * c - v * s, cy + u * s + v * c, z, 1.0, 0.12, 0.9, ang); } const m = Math.max(1, Math.round(n * d / w)); for (let i = 0; i < m; i++) { const u = sd * (w / 2 + 0.03), v = -d / 2 + d * (i + 0.5) / m; box(m2 || 'window', cx + u * c - v * s, cy + u * s + v * c, z, 0.12, 1.0, 0.9, ang); } } }
      function meshes() { const out = []; for (const [m, a] of Object.entries(acc)) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3)); fastNormals(g); const mesh = new THREE.Mesh(g, M[m]); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = m; out.push(mesh); } return out; }
      return { box, seg, sseg, prism, hip, gable, windows, quad, tri, meshes };
    }

    // ---------- 部件族 ----------
    const FAM = {
      yagura2(k, p) { const w = p.w * (p.real ? 0.92 : 1), d = p.d * (p.real ? 0.92 : 1); k.box('stone', p.x, p.y, p.z, w + 0.4, d + 0.4, 0.6, p.ang); k.box('plaster', p.x, p.y, p.z + 0.6, w, d, 6.2, p.ang); k.windows(p.x, p.y, p.z + 3.4, w, d, p.ang, Math.max(2, Math.round(w / 3.5)));
        k.hip('tile', p.x, p.y, p.z + 6.6, w, d, p.ang, 1.7, 2.0, 0.6); const w2 = w * 0.72, d2 = d * 0.72; k.box('plaster', p.x, p.y, p.z + 7.6, w2, d2, 4.4, p.ang); k.windows(p.x, p.y, p.z + 9.4, w2, d2, p.ang, Math.max(2, Math.round(w2 / 3.5))); k.hip('tile', p.x, p.y, p.z + 11.8, w2, d2, p.ang, 1.6, 3.0, 0.2); },
      yagura3(k, p) { const w = p.w, d = p.d; k.box('stone', p.x, p.y, p.z, w + 0.4, d + 0.4, 0.6, p.ang); k.box('plaster', p.x, p.y, p.z + 0.6, w, d, 6.0, p.ang); k.windows(p.x, p.y, p.z + 3.4, w, d, p.ang, 4);
        k.hip('tile', p.x, p.y, p.z + 6.4, w, d, p.ang, 1.7, 1.8, 0.6); const w2 = w * 0.78, d2 = d * 0.78; k.box('plaster', p.x, p.y, p.z + 7.2, w2, d2, 4.0, p.ang); k.windows(p.x, p.y, p.z + 8.8, w2, d2, p.ang, 3);
        k.hip('tile', p.x, p.y, p.z + 10.8, w2, d2, p.ang, 1.5, 1.6, 0.6); const w3 = w * 0.58, d3 = d * 0.58; k.box('plaster', p.x, p.y, p.z + 11.5, w3, d3, 3.6, p.ang); k.windows(p.x, p.y, p.z + 13.0, w3, d3, p.ang, 2); k.hip('tile', p.x, p.y, p.z + 14.9, w3, d3, p.ang, 1.4, 2.6, 0.2); },
      gate(k, p) { // 高丽门：主柱立在土塀轴线上（两侧土塀正好顶到柱外侧面），控柱在门内侧，门扇向内开
        const c = Math.cos(p.ang), s = Math.sin(p.ang), at = (u, v) => [p.x + u * c - v * s, p.y + u * s + v * c];
        const o = p.open || p.w * 0.7, av = p.axisV !== undefined ? p.axisV : 0, si = p.inSign || 1, pu = o / 2 + 0.45, rv = av + si * Math.min(3.2, p.d * 0.5);
        for (const sd of [-1, 1]) {
          const [x, y] = at(sd * pu, av); k.box('iron', x, y, p.z, 0.9, 0.9, 6.2, p.ang); k.box('stone', x, y, p.z, 1.2, 1.2, 0.35, p.ang);
          const [x2, y2] = at(sd * pu, rv); k.box('iron', x2, y2, p.z, 0.5, 0.5, 4.2, p.ang); const [xb, yb] = at(sd * pu, (av + rv) / 2); k.box('iron', xb, yb, p.z + 3.6, 0.3, Math.abs(rv - av), 0.3, p.ang);
          const [x3, y3] = at(sd * (o / 2 - 0.2), av + si * o / 4 + si * 0.3); k.box('wood', x3, y3, p.z + 0.1, 0.18, o / 2 - 0.2, 5.0, p.ang);
          const [x4, y4] = at(sd * pu, (av + rv) / 2); k.gable('tile', x4, y4, p.z + 4.4, 1.6, Math.abs(rv - av) + 0.8, p.ang + Math.PI / 2, 0.3, 0.7);
        }
        const PH = SITE.SPEC.passH.gate, [cx, cy] = at(0, av); k.box('iron', cx, cy, p.z + PH, o + 1.8, 0.7, 0.7, p.ang); k.gable('tile', cx, cy, p.z + PH + 0.7, o + 2.4, 1.8, p.ang, 0.6, 1.4); }, // 门楣下沿 = passH.gate（H18 用同一个数）
      yaguramon(k, p) { const w = p.w, d = p.d, c = Math.cos(p.ang), s = Math.sin(p.ang), at = (u, v) => [p.x + u * c - v * s, p.y + u * s + v * c];
        const o = p.open || 5.0, PH = SITE.SPEC.passH.yaguramon; for (const sd of [-1, 1]) { const [x, y] = at(sd * (w / 4 + o / 4), 0); k.box('stone', x, y, p.z, w / 2 - o / 2, d, PH + 0.6, p.ang); }
        k.box('iron', p.x, p.y, p.z + PH, p.open || 5.0, d, 0.6, p.ang);
        k.box('plaster', p.x, p.y, p.z + 4.6, w, d, 4.2, p.ang); k.windows(p.x, p.y, p.z + 6.4, w, d, p.ang, Math.max(3, Math.round(w / 3))); k.hip('tile', p.x, p.y, p.z + 8.6, w, d, p.ang, 1.6, 2.6, 0.3); },
      kura(k, p) { const w = p.w * 0.95, d = p.d * 0.9; k.box(p.name === '焔硝蔵' ? 'stone' : 'lacquer', p.x, p.y, p.z, w + 0.2, d + 0.2, 1.3, p.ang); k.box('plaster', p.x, p.y, p.z + 1.3, w, d, 3.9, p.ang); k.gable('tile', p.x, p.y, p.z + 5.2, w, d, p.ang, 0.9, d * 0.38); },
      hall(k, p) { const w = p.w * 0.85, d = p.d * 0.8; k.box('stone', p.x, p.y, p.z, w + 1.6, d + 1.6, 0.8, p.ang); k.box('wood', p.x, p.y, p.z + 0.8, w, d, 4.4, p.ang); k.hip('tile', p.x, p.y, p.z + 5.0, w, d, p.ang, 2.2, d * 0.36, 0.25); },
      pavilion(k, p) { const w = p.w * 0.7, d = p.d * 0.7, c = Math.cos(p.ang), s = Math.sin(p.ang); for (const a of [-1, 1]) for (const b of [-1, 1]) k.box('wood', p.x + a * w / 2 * c - b * d / 2 * s, p.y + a * w / 2 * s + b * d / 2 * c, p.z, 0.3, 0.3, 3, p.ang); k.box('stone', p.x, p.y, p.z, 2.4, 2.4, 0.9, p.ang); k.hip('tile', p.x, p.y, p.z + 3, w, d, p.ang, 0.9, 1.6, 0.1); },
      tamon(k, p) { // 多门橹：石垣台座（门洞处切开）+ 一层白墙 + 屋顶；门洞里两扇门
        const b = p.data, z = p.z, H0 = 4.6; let pieces = [b.fp];
        for (const q of p.passages || []) { const m = [Math.cos(q.ang), Math.sin(q.ang)], c0 = m[0] * q.x + m[1] * q.y, next = [];
          for (const P of pieces) { const A = clipHalf(P, m, c0 - q.w / 2), B = clipHalf(P, [-m[0], -m[1]], -(c0 + q.w / 2)); if (A.length >= 3) next.push(A); if (B.length >= 3) next.push(B); }
          pieces = next; const dv = [-m[1], m[0]], lw = q.w / 2 - 0.1; // 门扇开着（H14：门洞可通行）：每扇绕门洞侧的枢轴转 90°，贴在通道侧壁上
          for (const sd of [-1, 1]) k.box('wood', q.x + m[0] * sd * (q.w / 2 - 0.2) + dv[0] * lw / 2, q.y + m[1] * sd * (q.w / 2 - 0.2) + dv[1] * lw / 2, z, 0.25, lw, H0 - 0.2, q.ang); k.box('iron', q.x, q.y, z + SITE.SPEC.passH.tamon, q.w, q.len, H0 - SITE.SPEC.passH.tamon, q.ang); }
        for (const P of pieces) k.prism('stone', P, z, z + H0);
        k.prism('lacquer', b.fp, z + H0, z + H0 + 0.6); k.prism('plaster', b.fp, z + H0 + 0.6, z + H0 + 4.2); k.prism('ridge', b.roof, z + H0 + 3.9, z + H0 + 4.5, 'tile'); if (b.roof2 && b.roof2.length >= 3) k.prism('tile', b.roof2, z + H0 + 4.5, z + H0 + 6.1, 'ridge'); },
      // r7b：墙底面 = 设计地面沿墙的线性值 z0→z1（斜面台地），接头处的延长段按同一斜率外推；底面再埋 0.3 m（三角网插值不留缝）
      dobei(k, p) { const e = (j, w) => j === 'joint' ? w / 2 : 0, L = Math.hypot(p.x1 - p.x0, p.y1 - p.y0) || 1, tx = (p.x1 - p.x0) / L, ty = (p.y1 - p.y0) / L, z0 = p.z0 !== undefined ? p.z0 : p.z, z1 = p.z1 !== undefined ? p.z1 : p.z, gz = (z1 - z0) / L;
        const sg = (m, dz, w, h, ext) => { const a = ext ? e(p.j0, w) : 0, b = ext ? e(p.j1, w) : 0; k.sseg(m, p.x0 - tx * a, p.y0 - ty * a, p.x1 + tx * b, p.y1 + ty * b, z0 - gz * a + dz, z1 + gz * b + dz, w, h); };
        sg('lacquer', -0.3, p.t + 0.04, 0.8, true); sg('plaster', 0.5, p.t, p.h - 0.5, true); sg('tile', p.h, p.t + 0.7, 0.28, true); sg('ridge', p.h + 0.28, 0.3, 0.22, true); },
      mwall(k, p) { const L = Math.hypot(p.x1 - p.x0, p.y1 - p.y0) || 1, tx = (p.x1 - p.x0) / L, ty = (p.y1 - p.y0) / L, a = p.j0 === 'joint' ? p.t / 2 : 0, b = p.j1 === 'joint' ? p.t / 2 : 0, z0 = p.z0 !== undefined ? p.z0 : p.z, z1 = p.z1 !== undefined ? p.z1 : p.z, gz = (z1 - z0) / L;
        k.sseg('stone', p.x0 - tx * a, p.y0 - ty * a, p.x1 + tx * b, p.y1 + ty * b, z0 - gz * a - 0.3, z1 + gz * b - 0.3, p.t, p.h + 0.3); FAM.dobei(k, { x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, z0: z0 + p.h, z1: z1 + p.h, t: 0.6, h: 2.0, j0: p.j0, j1: p.j1 }); },
      bridge(k, p, S) { // r5：桥面（含两端桥台段）+ 栏杆（只在桥面以上）+ 桥墩（按 H17 规则生成：落在平整堀底、每跨 ≤3 間）+ 墩顶横梁
        const B = (S.bridges || []).find(b => b.ramp.part === p); if (!B) return; const hw = B.hw, ang = Math.atan2(B.u[1], B.u[0]), A = (s, o, z) => { const q = B.P(s, o); return [q[0], q[1], z]; };
        const n = Math.max(2, Math.ceil((B.s1 - B.s0) / 2));
        for (let i = 0; i < n; i++) { const s0 = B.s0 + (B.s1 - B.s0) * i / n, s1 = B.s0 + (B.s1 - B.s0) * (i + 1) / n, z0 = B.topAt(s0), z1 = B.topAt(s1), t = B.t;
          k.quad('deck', A(s0, -hw, z0), A(s1, -hw, z1), A(s1, hw, z1), A(s0, hw, z0)); k.quad('deck', A(s0, hw, z0 - t), A(s1, hw, z1 - t), A(s1, -hw, z1 - t), A(s0, -hw, z0 - t));
          for (const sd of [-1, 1]) k.quad('deck', A(s0, sd * hw, z0 - t), A(s1, sd * hw, z1 - t), A(s1, sd * hw, z1), A(s0, sd * hw, z0));
          const r0 = Math.max(s0, 0), r1 = Math.min(s1, B.len); if (r1 > r0) for (const sd of [-1, 1]) { const ra = A(r0, sd * hw * 0.95, 0), rb = A(r1, sd * hw * 0.95, 0); k.seg('vermil', ra[0], ra[1], rb[0], rb[1], (B.topAt(r0) + B.topAt(r1)) / 2 + 0.9, 0.2, 0.2); } }
        const np = Math.max(2, Math.round(B.len / 2)); for (let i = 0; i <= np; i++) { const s = B.len * i / np; for (const sd of [-1, 1]) { const q = A(s, sd * hw * 0.95, 0); k.box('vermil', q[0], q[1], B.topAt(s), 0.22, 0.22, 1.1, ang); } }
        if (P.fault === 'c8') { const sup = [B.sA].concat(B.piers.map(q2 => q2.s), [B.sB]).sort((a2, b2) => a2 - b2); let sm = B.len / 2; for (let i = 1; i < sup.length; i++) if (sup[i - 1] <= B.len / 2 && sup[i] >= B.len / 2) { sm = (sup[i - 1] + sup[i]) / 2; break; } const q = A(sm, 0, 0); /* 横在 C8 走的那一跨的中线上 */ k.box('wood', q[0], q[1], S.wzAt(q[0], q[1]) + 0.5, 0.6, 2 * hw + 4, 1.0, ang); } // 故障注入（测试用）：桥下横一根梁，C8 必须报出来
        for (const pr of B.piers) { for (const q of pr.rows) k.box('wood', q[0], q[1], pr.zb, SITE.SPEC.bridge.pierW, SITE.SPEC.bridge.pierW, pr.zt - pr.zb, ang); k.seg('wood', pr.rows[0][0], pr.rows[0][1], pr.rows[1][0], pr.rows[1][1], pr.zt - 0.45, 0.5, 0.45); } },
      dobashi(k, p, S) { // 土桥路面：沿剖面铺一条略高于地形的碎石路面
        const r = S.ramps.find(q => q.part === p), L = Math.hypot(p.x1 - p.x0, p.y1 - p.y0), n = Math.max(2, Math.ceil(L / 1.5)), ang = Math.atan2(p.y1 - p.y0, p.x1 - p.x0), nx = -Math.sin(ang), ny = Math.cos(ang), hw = p.w / 2 - 0.4;
        for (let i = 0; i < n; i++) { const f0 = i / n, f1 = (i + 1) / n, z0 = S.rampProf(r, f0) + 0.08, z1 = S.rampProf(r, f1) + 0.08, a = [p.x0 + (p.x1 - p.x0) * f0, p.y0 + (p.y1 - p.y0) * f0], b = [p.x0 + (p.x1 - p.x0) * f1, p.y0 + (p.y1 - p.y0) * f1];
          k.quad('road', [a[0] - nx * hw, a[1] - ny * hw, z0], [b[0] - nx * hw, b[1] - ny * hw, z1], [b[0] + nx * hw, b[1] + ny * hw, z1], [a[0] + nx * hw, a[1] + ny * hw, z0]); } },
    };

    // r5：曲轮内道路 + 穿门段（H15/H16 的步行网络），贴地铺碎石路面；折点处补圆盘避免缝
    function roadsMesh(k, S) {
      const zr = (x, y) => S.surfaceAt(x, y) + 0.05;
      for (const r of S.roads || []) { const hw = r.need / 2;
        for (let i = 1; i < r.pts.length; i++) { const a = r.pts[i - 1], b = r.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-3) continue; const tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L, nx = -ty * hw, ny = tx * hw, m = Math.max(1, Math.ceil(L / 1.5));
          for (let j = 0; j < m; j++) { const p0 = [a[0] + tx * L * j / m, a[1] + ty * L * j / m], p1 = [a[0] + tx * L * (j + 1) / m, a[1] + ty * L * (j + 1) / m], c = (x, y) => [x, y, zr(x, y)];
            k.quad('road', c(p0[0] - nx, p0[1] - ny), c(p1[0] - nx, p1[1] - ny), c(p1[0] + nx, p1[1] + ny), c(p0[0] + nx, p0[1] + ny)); } }
        for (let i = 1; i < r.pts.length - 1; i++) { const q = r.pts[i], N = 10; for (let j = 0; j < N; j++) { const a0 = j / N * Math.PI * 2, a1 = (j + 1) / N * Math.PI * 2, P1 = [q[0] + Math.cos(a0) * hw, q[1] + Math.sin(a0) * hw], P2 = [q[0] + Math.cos(a1) * hw, q[1] + Math.sin(a1) * hw]; k.tri('road', [q[0], q[1], zr(q[0], q[1])], [P1[0], P1[1], zr(...P1)], [P2[0], P2[1], zr(...P2)]); } } }
    }
    // ---------- 地形网格 ----------
    // r7b：= THREE.BufferGeometry.computeVertexNormals()（r160，带/不带索引）在类型数组上直接做，浮点运算次序相同，只为提速（不走逐顶点 getX/setXYZ）
    function fastNormals(g) {
      const P = g.attributes.position.array, N = new Float32Array(P.length), I = g.index ? g.index.array : null;
      // r8a：不分配临时数组（同一组浮点运算、同一次序，结果逐位相同）
      let n0 = 0, n1 = 0, n2 = 0; const face = (a, b, c) => { const bx = P[b], by = P[b + 1], bz = P[b + 2], cx = P[c] - bx, cy = P[c + 1] - by, cz = P[c + 2] - bz, ax = P[a] - bx, ay = P[a + 1] - by, az = P[a + 2] - bz; n0 = cy * az - cz * ay; n1 = cz * ax - cx * az; n2 = cx * ay - cy * ax; };
      if (I) { for (let i = 0; i < I.length; i += 3) { const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3; face(a, b, c); N[a] += n0; N[a + 1] += n1; N[a + 2] += n2; N[b] += n0; N[b + 1] += n1; N[b + 2] += n2; N[c] += n0; N[c + 1] += n1; N[c + 2] += n2; } }
      else for (let a = 0; a + 8 < P.length; a += 9) { face(a, a + 3, a + 6); for (let v = a; v <= a + 6; v += 3) { N[v] = n0; N[v + 1] = n1; N[v + 2] = n2; } }
      for (let v = 0; v < N.length; v += 3) { const x = N[v], y = N[v + 1], z = N[v + 2], inv = 1 / (Math.sqrt(x * x + y * y + z * z) || 1); N[v] = x * inv; N[v + 1] = y * inv; N[v + 2] = z * inv; }
      g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); }
    function terrainMesh(S) {
      const { NX, NY, H, CLS, TAG, LOCK, cell } = S, n = NX * NY, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      const nino = S.regions.filter(g => g.name === 'ninomaru').sort((a, b) => b.area - a.area)[0];
      const hash = (i, j) => { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
      const C = { bed: [0.20, 0.24, 0.20], stone: [0.50, 0.48, 0.44], gravel: [0.55, 0.51, 0.44], grass: [0.33, 0.43, 0.22], city: [0.55, 0.53, 0.49], earth: [0.48, 0.36, 0.22], road: [0.66, 0.58, 0.45], bank: [0.38, 0.40, 0.23] };
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const q = j * NX + i, h = H[q]; pos[q * 3] = S.X(i); pos[q * 3 + 1] = h; pos[q * 3 + 2] = -S.Y(j);
        const hx = (H[j * NX + Math.min(NX - 1, i + 1)] - H[j * NX + Math.max(0, i - 1)]) / (2 * cell), hy = (H[Math.min(NY - 1, j + 1) * NX + i] - H[Math.max(0, j - 1) * NX + i]) / (2 * cell), sl = Math.hypot(hx, hy);
        let c; const k = CLS[q], g = k >= 0 && k < S.regions.length ? S.regions[k] : null;
        if (TAG[q] === 2) c = C.road; else if (sl > 1.2 || TAG[q] === 1 || TAG[q] === 3 || TAG[q] === 4) c = C.stone; else if (TAG[q] === 5) c = C.bank;
        else if (k < 0) c = C.bed; else if (k === S.BAND.i) c = C.city; else if (g.name === 'honmaru') c = C.gravel; else if (g.name === 'dry') c = C.earth; else if (g.name === 'ninomaru') c = C.grass; else c = C.city;
        const r = hash(i, j), big = 0.5 + 0.5 * Math.sin(S.X(i) * 0.05 + Math.cos(S.Y(j) * 0.04) * 2.0), v = c === C.stone ? 0.75 + 0.5 * r : 0.88 + 0.16 * r + (c === C.grass ? 0.12 * big : 0);
        col[q * 3] = c[0] * v; col[q * 3 + 1] = c[1] * v; col[q * 3 + 2] = c[2] * v;
      }
      // r6：被石垣顶线/墙脚线切开的格（S.splitIdx → S.splitTris）用切分三角形代替网格的两个三角形；新顶点按 x/y/z 精确焊接（相邻格逐位相同 → 水密、法线连续）
      const SPL = S.splitIdx, SPT = S.splitTris || [], x0 = S.X(0), y0 = S.Y(0); let nsv = 0; for (const sp of SPT) if (sp.kind !== 'dead') nsv += sp.tris.length / 3;
      const idx = new Uint32Array((NX - 1) * (NY - 1) * 6 + nsv), xp = [], cp = [], vmap = new Map(); let t = 0;
      const vid = (x, y, z, a) => { const fi = (x - x0) / cell, fj = (y - y0) / cell, ri = Math.round(fi), rj = Math.round(fj); if (Math.abs(fi - ri) < 1e-9 && Math.abs(fj - rj) < 1e-9 && ri >= 0 && rj >= 0 && ri < NX && rj < NY) return rj * NX + ri;
        let mx = vmap.get(x); if (mx === undefined) vmap.set(x, mx = new Map()); let my = mx.get(y); if (my === undefined) mx.set(y, my = new Map()); let v = my.get(z); if (v !== undefined) return v; // 精确焊接：相邻格共用的切点 x/y/z 逐位相同；同一平面位置不同高度（陡坎两侧）的点不合并（r8a：三层 Map 代替字符串键，同一判等）
        v = n + xp.length / 3; my.set(z, v); xp.push(x, z, -y);
        let bq = a, bd = 1e9; for (const q of [a, a + 1, a + NX, a + NX + 1]) { const d = Math.abs(H[q] - z); if (d < bd) { bd = d; bq = q; } } cp.push(col[bq * 3], col[bq * 3 + 1], col[bq * 3 + 2]); return v; }; // 新顶点的颜色 = 高度最接近的角点的颜色（台地顶 / 石垣面 / 下层地面）
      for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) { const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
        if (SPL && SPL[a] >= 0) { const T = SPT[SPL[a]].tris; for (let k = 0; k < T.length; k += 9) { const ar = (T[k + 3] - T[k]) * (T[k + 7] - T[k + 1]) - (T[k + 6] - T[k]) * (T[k + 4] - T[k + 1]); if (Math.abs(ar) < 1e-12) continue; const v0 = vid(T[k], T[k + 1], T[k + 2], a), v1 = vid(T[k + 3], T[k + 4], T[k + 5], a), v2 = vid(T[k + 6], T[k + 7], T[k + 8], a); idx[t++] = v0; if (ar > 0) { idx[t++] = v1; idx[t++] = v2; } else { idx[t++] = v2; idx[t++] = v1; } } continue; }
        idx[t++] = a; idx[t++] = b; idx[t++] = d; idx[t++] = a; idx[t++] = d; idx[t++] = c; }
      const P2 = new Float32Array(pos.length + xp.length), C2 = new Float32Array(col.length + cp.length); P2.set(pos); P2.set(xp, pos.length); C2.set(col); C2.set(cp, col.length);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P2, 3)); g.setAttribute('color', new THREE.BufferAttribute(C2, 3)); g.setIndex(new THREE.BufferAttribute(idx.subarray(0, t), 1)); fastNormals(g);
      state.terrainTris = t / 3;
      const m = new THREE.Mesh(g, stoneShader(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }))); m.receiveShadow = true; m.castShadow = true; m.name = 'terrain';
      void nino; void LOCK; return m;
    }
    // 陡坡（石垣面）在片元着色器里画成错缝砌石：按世界坐标分层（层高 0.9 m、石长 1.7 m）
    function stoneShader(mat) {
      mat.onBeforeCompile = sh => {
        sh.vertexShader = 'varying vec3 vWP; varying vec3 vWN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWP = (modelMatrix * vec4(position, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * normal);');
        sh.fragmentShader = 'varying vec3 vWP; varying vec3 vWN;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          float steep = 1.0 - smoothstep(0.42, 0.62, abs(vWN.y));
          if (steep > 0.0) {
            vec2 hz = normalize(vWN.xz + 1e-5); float u = dot(vWP.xz, vec2(-hz.y, hz.x)), v = vWP.y;
            float row = floor(v / 0.9), uu = u / 1.7 + row * 0.5, cu = fract(uu), cv = fract(v / 0.9);
            float mortar = clamp(step(cu, 0.06) + step(cv, 0.09), 0.0, 1.0);
            float rn = fract(sin(dot(vec2(floor(uu), row), vec2(12.9898, 78.233))) * 43758.5453);
            vec3 sc = vec3(0.56, 0.53, 0.48) * (0.72 + 0.5 * rn);
            sc = mix(sc, vec3(0.2, 0.19, 0.18), mortar);
            diffuseColor.rgb = mix(diffuseColor.rgb, sc, steep);
          }`);
      };
      return mat;
    }
    function outerGround(S) { // 网格以外（±700 m 内）：4 m 粗网格，按 data 的曲轮多边形取高（r7b：各曲轮的拟合地面 T.P.；水体取该水体的堀底），与细网格边界对齐、只建细网格外的格子
      const grp = new THREE.Group(), gs = SITE.SPEC.grid, c = 4, R0 = 700, n = R0 * 2 / c + 1, pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3);
      const lv = (x, y) => { const g = S.regionAt(x, y); return g ? g.surf.at(x, y) : S.bodyAtPt(x, y).bed; }, wet = (x, y) => !S.regionAt(x, y);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = -R0 + i * c, y = -R0 + j * c, q = j * n + i, inside = x > gs.x0 && x < gs.x1 && y > gs.y0 && y < gs.y1, gr = inside ? null : S.regionAt(x, y), h = inside ? 0 : gr ? gr.surf.at(x, y) : S.bodyAtPt(x, y).bed; // = lv(x, y)，曲轮只查一次
        pos[q * 3] = x; pos[q * 3 + 1] = h - 0.02; pos[q * 3 + 2] = -y; const k = !inside && !gr ? [0.2, 0.24, 0.2] : [0.55, 0.53, 0.49], r = 0.9 + 0.12 * Math.abs(Math.sin(i * 12.9898 + j * 78.233) * 43758.5453 % 1);
        col[q * 3] = k[0] * r; col[q * 3 + 1] = k[1] * r; col[q * 3 + 2] = k[2] * r;
      }
      const idx = new Uint32Array((n - 1) * (n - 1) * 6); let ni = 0; for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const x = -R0 + i * c, y = -R0 + j * c; if (x >= gs.x0 && x + c <= gs.x1 && y >= gs.y0 && y + c <= gs.y1) continue; const a = j * n + i, b = a + 1, cc = a + n, d = cc + 1; idx[ni++] = a; idx[ni++] = b; idx[ni++] = d; idx[ni++] = a; idx[ni++] = d; idx[ni++] = cc; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(idx.slice(0, ni), 1)); fastNormals(g);
      const om = new THREE.Mesh(g, stoneShader(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }))); om.receiveShadow = true; om.name = 'outer'; grp.add(om);
      // ±700 m 以外：一圈大环（8 个顶点），外圈取内圈角点的城下拟合面高度（不把拟合平面外推到 9 km），与粗网格外缘接上
      const mat = new THREE.MeshStandardMaterial({ color: 0x8a867c, roughness: 1 }), city = S.regions.find(g => g.name === 'city'), cz = (x, y) => city.surf.at(x, y) - 0.02;
      const RO = 9000, ring = [[-RO, -RO], [RO, -RO], [RO, RO], [-RO, RO]], inn = [[-R0, -R0], [R0, -R0], [R0, R0], [-R0, R0]], fp = new Float32Array(8 * 3), fi = [];
      [...ring, ...inn].forEach((p, i) => { fp[i * 3] = p[0]; fp[i * 3 + 1] = i < 4 ? cz(inn[i][0], inn[i][1]) : lv(p[0], p[1]) - 0.02; fp[i * 3 + 2] = -p[1]; });
      for (let i = 0; i < 4; i++) { const a = i, b = (i + 1) % 4, c2 = 4 + i, d2 = 4 + (i + 1) % 4; fi.push(a, b, d2, a, d2, c2); }
      const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(fp, 3)); fg.setIndex(fi); fastNormals(fg); const m = new THREE.Mesh(fg, mat); m.material.side = THREE.DoubleSide; grp.add(m);
      // r7b：水面 = 每个连通水体在自己的实测水位（T.P.）上一块多边形；再加一张最低水位的大水面兜底（只会在地面以下露出）
      const wmat = new THREE.MeshStandardMaterial({ color: 0x3b6872, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.9 });
      // 兜底水面不是水体：放在全部渲染地面（网格 + 外圈拟合面的四角）以下，城下拟合平面外推到网格角时（东北角低于最低水位）不会被它淹掉
      let baseZ = S.WZ; for (let q = 0; q < S.H.length; q++) if (S.H[q] < baseZ) baseZ = S.H[q]; for (const p of [[-R0, -R0], [R0, -R0], [R0, R0], [-R0, R0]]) baseZ = Math.min(baseZ, lv(p[0], p[1]), cz(p[0], p[1])); baseZ -= 0.5;
      const base = new THREE.Mesh(new THREE.PlaneGeometry(18000, 18000), wmat); base.rotation.x = -Math.PI / 2; base.position.y = baseZ; base.name = 'water'; grp.add(base);
      for (const b of S.waterBodies) { if (!b.ring || b.ring.length < 3) continue; const sh = new THREE.Shape(b.ring.map(p => new THREE.Vector2(p[0], p[1])));
        const wm = new THREE.Mesh(new THREE.ShapeGeometry(sh), wmat); wm.rotation.x = -Math.PI / 2; wm.position.y = b.level; wm.receiveShadow = true; wm.name = 'water'; grp.add(wm); }
      return grp;
    }
    function treesMesh(S) {
      const grp = new THREE.Group(), N = S.trees.length; grp.userData.trees = true; if (!N) return grp;
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.38, 1, 6), new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 }), N);
      const crownG = new THREE.IcosahedronGeometry(1, 1), crown = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ roughness: 0.9 }), N * 2);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
      let ci = 0;
      S.trees.forEach((t, i) => {
        const G = SITE.treeGeom(t), h = G.h; // 树的几何与 H18 净空审计共用
        m4.compose(W(t.x, t.y, t.z + h * 0.4), q, new THREE.Vector3(t.s, h * 0.8, t.s)); trunk.setMatrixAt(i, m4);
        const pine = t.kind === 'pine';
        for (let k = 0; k < 2; k++) { const cr = G.crowns[k]; m4.compose(W(cr.x, cr.y, cr.z), q, new THREE.Vector3(cr.r, cr.rz, cr.r)); crown.setMatrixAt(ci, m4); col.setRGB(pine ? 0.13 : 0.22, pine ? 0.25 + 0.04 * k : 0.33 + 0.05 * k, pine ? 0.14 : 0.13); if (t.bad) col.setRGB(1, 0.1, 0.1); crown.setColorAt(ci, col); ci++; }
      });
      trunk.castShadow = crown.castShadow = true; trunk.receiveShadow = crown.receiveShadow = true; grp.add(trunk, crown); return grp;
    }
    function labelSprite(text, lost) {
      const cv = document.createElement('canvas'), g = cv.getContext('2d'), fs = 44; g.font = `600 ${fs}px "PingFang SC","Hiragino Sans","Noto Sans CJK SC",sans-serif`;
      const w = Math.ceil(g.measureText(text).width) + 28; cv.width = w; cv.height = fs + 22; g.font = `600 ${fs}px "PingFang SC","Hiragino Sans","Noto Sans CJK SC",sans-serif`;
      g.fillStyle = lost ? 'rgba(40,30,70,.78)' : 'rgba(20,14,8,.78)'; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = lost ? '#cfc3ff' : '#f2d27a'; g.textBaseline = 'middle'; g.fillText(text, 14, cv.height / 2 + 2);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })); sp.renderOrder = 10; sp.userData.aspect = cv.width / cv.height; sp.scale.set(0.026 * sp.userData.aspect, 0.026, 1); sp.material.sizeAttenuation = false; return sp;
    }

    // ---------- 构建 ----------
    let site = null, world = null, tenshuProto = null;
    // r6：首次加载时 H 系列审计在第一帧画出来之后再跑（审计只读几何、只标记违规；结果出来后补画违规标记、面板更新）。
    // 之后的重建（换 seed / 现状）照旧同步审计。测试等 __castle.auditResult。
    function buildWorld(opt, deferAudit, pre) {
      const t0 = performance.now();
      if (world) { scene.remove(world); world.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
      site = pre && pre.opt.seed === opt.seed && pre.opt.lost === opt.lost && pre.opt.cell === opt.cell ? pre : SITE.build(opt); state.auditResult = null; const A = deferAudit ? null : site.audit();
      world = new THREE.Group(); world.name = 'world';
      world.add(terrainMesh(site)); world.add(outerGround(site));
      const k = Kit();
      for (const p of site.parts) { if (p.fam === 'tenshu') continue; const f = FAM[p.fam]; if (f) f(k, p, site);
        if (!p.wall && p.poly && p.zb !== undefined && p.z - p.zb > 0.02 && !SITE.SPEC.found.ishigakiBase.includes(p.fam)) k.prism('stone', p.poly, p.zb - 0.3, p.z); } // r7b：斜面台地上的基础（基壇）：地板 z 到最低地面 zb（再埋 0.3 m）
      roadsMesh(k, site);
      for (const m of k.meshes()) world.add(m);
      const tb = site.parts.find(p => p.fam === 'tenshu');
      if (tb) { if (!tenshuProto) tenshuProto = window.CASTLE_TENSHU.build(THREE, { maxAniso: renderer.capabilities.getMaxAnisotropy() }); const t = tenshuProto; t.position.copy(W(tb.x, tb.y, tb.z)); t.rotation.y = tb.ang; world.add(t); }
      world.add(treesMesh(site));
      if (A) world.add(badMarks()); state.signature = site.signature();
      const labels = new THREE.Group(); labels.name = 'labels';
      for (const L of site.labels) { const sp = labelSprite(L.text, L.lost); sp.position.copy(W(L.x, L.y, L.z)); labels.add(sp); }
      labels.visible = P.labels; world.add(labels);
      scene.add(world);
      let verts = 0, tris = 0; world.traverse(o => { if (o.isMesh && o.geometry) { const g = o.geometry, c = g.attributes.position.count, inst = o.isInstancedMesh ? o.count : 1; verts += c * inst; tris += (g.index ? g.index.count / 3 : c / 3) * inst; } });
      state.site = site; state.stats = { verts, tris: Math.round(tris), buildMs: Math.round(site.ms), sceneMs: Math.round(performance.now() - t0), parts: site.parts.length, trees: site.trees.length, dobei: site.dobei.length, lostPlaced: site.lostPlaced.length, lostSkipped: site.lostSkipped, conform: site.conform && { cells: site.conform.cells, split: site.conform.split, passive: site.conform.passive, dropped: site.conform.dropped, fans: site.conform.fans.length } };
      buildField(); showStats();
      const s0 = site, doAudit = () => { if (site !== s0) return; const t1 = performance.now(), A2 = A || site.audit(); state.stats.auditMs = A ? null : Math.round(performance.now() - t1); state.auditResult = A2; showAudit(A2); showStats();
        if (!A && A2.total) { world.add(badMarks()); const tr = world.children.find(o => o.isGroup && o.userData.trees); if (tr && site.trees.some(t => t.bad)) { world.remove(tr); world.add(treesMesh(site)); } requestRender(); } };
      state.camAudit = null; const doCam = () => setTimeout(() => { if (site === s0) { state.camAudit = cameraAudit(); showCamAudit(state.camAudit); } }, 50);
      if (A) { doAudit(); doCam(); } else { $('audit').innerHTML = '<div class="ah">硬规则审计：运行中…</div>'; requestAnimationFrame(() => setTimeout(() => { doAudit(); doCam(); }, 0)); }
      requestRender();
    }
    function badMarks() {
      const bad = new THREE.Group(); bad.name = 'bad';
      for (const p of site.parts) if (p.bad) { const bb = p.poly ? p.poly : [[p.x0, p.y0], [p.x1, p.y1]]; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const q of bb) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); } const z = (p.z !== undefined ? p.z : Math.min(p.z0, p.z1)); const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 2, 26, y1 - y0 + 2), badMat); m.position.copy(W((x0 + x1) / 2, (y0 + y1) / 2, z + 12)); bad.add(m); }
      return bad;
    }

    // ---------- 界面 ----------
    function showAudit(A) {
      const el = $('audit'); const ok = A.total === 0;
      let h = `<div class="ah ${ok ? 'ok' : 'ng'}">硬规则审计：${ok ? '全部通过 ✓' : A.total + ' 项违规'}</div><table>`;
      for (const r of A.rules) h += `<tr class="${A.cnt[r.id] ? 'ng' : ''}"><td>${r.id}</td><td>${r.name}</td><td>${A.cnt[r.id]}</td></tr>`;
      h += '</table>'; if (!ok) h += '<div class="items">' + A.items.slice(0, 12).map(it => `<div>${it.rule} · ${it.name}：${it.msg}</div>`).join('') + '</div>';
      el.innerHTML = h;
    }
    function showStats() { const s = state.stats; $('stats').textContent = `${(s.verts / 1e3).toFixed(0)}k 顶点 · ${(s.tris / 1e3).toFixed(0)}k 三角形 · ${s.parts} 部件 · ${s.trees} 树 · ${site && site.fromPack ? '读包' : '生成'} ${s.buildMs} ms · 场景 ${s.sceneMs} ms · 碰撞场 ${s.camMs} ms${s.auditMs ? ' · 审计 ' + s.auditMs + ' ms' : ''}${s.conform ? ' · 地形切分 ' + s.conform.split + '+' + s.conform.passive + ' 格' : ''}`; }
    // ---------- 相机物理体：碰撞场、视角规则、过渡路径、每帧约束（web-r3）----------
    const CAMX = window.CASTLE_CAMERA, w3 = v => [v.x, -v.z, v.y], setV = (v, a) => v.set(a[0], a[2], -a[1]);
    // 视角 = 规则：目标点（看什么）+ 方位角（相机在目标的哪一侧，度，东=0 逆时针）+ 仰角 + 距离 + 目标本体半径 rf（视线检查时不算遮挡）
    // r7b：目标点按引用取（曲轮 / 门 / 部件 / 石垣边 / 桥），高度从生成结果里读——不再手写 z（r2–r7a 写死的 14、9、44 在 T.P. 高程下全错）
    //   region：该曲轮（主块）多边形面积重心，z = 台地设计面；gate：门中心，z = 门地板 + dz；part：按 fam 取部件，z = 地板 + dz；
    //   edge：曲轮在 dir 方向最外的石垣边的中点、向外移到墙面中部，z = (墙顶 + 水位)/2；bridge：跨中桥面下 3 m（r5）
    const VIEWS = {
      aerial: { ref: { region: 'honmaru' }, az: -130, el: 27, dist: 940, rf: 40 },          // 本丸地面（全城视野，目标=一片区域）
      top: { ref: { region: 'honmaru' }, az: -90, el: 89.9, dist: 1650, rf: 40 },
      otemon: { ref: { gate: 'otemon', dz: 4 }, az: -171, el: 6, dist: 84, rf: 6 },          // 大手门（门中高）
      tenshu: { ref: { part: 'tenshu', dz: 30 }, az: -75, el: 3, dist: 160, rf: 24 },         // 天守（塔身中部：天守台面以上 30 m）
      eastwall: { ref: { edge: 'honmaru', dir: [1, 0] }, az: -74, el: 3, dist: 104, rf: 10 },  // 本丸东侧石垣面中部，相机在内堀水面上
      otejoint: { ref: { gate: 'otemon', dz: 0, back: 7 }, az: -14, el: 18, dist: 35, rf: 5 }, // 大手门枡形里：高丽门往里 7 m（高丽门 + 两侧土塀 + 连接墙）
      sakura: { ref: { gate: 'sakura', dz: 4 }, az: 47, el: 19, dist: 46, rf: 6 },             // 本丸桜门 + 枡形 + 铁门
      otegate: { walk: 'otemon', at: 'gate', ahead: 10, rf: 0.5 },                     // 站在大手门（高丽门）门洞里、眼高 1.6 m，沿步行路线向枡形里看（规则：H14 步行路线上离门洞中心最近的点）
      bridge: { bridge: 'gokuraku', daz: 35, el: 14, dist: 75, rf: 12 },             // r5：極楽橋侧面（目标 = 跨中桥面下 3 m；方位 = 桥的横向 + 35°），看桥墩/跨度/桥台
    };
    function refTarget(ref) {
      const main = name => site.regions.filter(g => g.name === name).sort((a, b) => b.area - a.area)[0];
      if (ref.region) { const g = main(ref.region), P = g.rings[0]; let A = 0, cx = 0, cy = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], k = a[0] * b[1] - b[0] * a[1]; A += k; cx += (a[0] + b[0]) * k; cy += (a[1] + b[1]) * k; } cx /= 3 * A; cy /= 3 * A; return [cx, cy, g.surf.at(cx, cy)]; }
      if (ref.gate) { const g = gateById(ref.gate); if (!g) return null; const v = g.nin || [-Math.sin(g.ang), Math.cos(g.ang)], b = ref.back || 0; return [g.x + v[0] * b, g.y + v[1] * b, (b ? site.surfaceAt(g.x + v[0] * b, g.y + v[1] * b) : g.z) + (ref.dz || 0)]; }
      if (ref.part) { const p = site.parts.find(q => q.fam === ref.part); return p ? [p.x, p.y, p.z + (ref.dz || 0)] : null; }
      if (ref.edge) { const g = main(ref.edge); let best = null, bv = -1e18; for (const e of g.edges) { if (!e.B || e.low.g) continue; const v = ((e.ax + e.bx) / 2) * ref.dir[0] + ((e.ay + e.by) / 2) * ref.dir[1]; if (e.len > 10 && v > bv) { bv = v; best = e; } } if (!best) return null;
        const mx = (best.ax + best.bx) / 2, my = (best.ay + best.by) / 2, x = mx - best.nx * best.B / 2, y = my - best.ny * best.B / 2, top = g.surf.at(mx - best.nx * best.B, my - best.ny * best.B); return [x, y, (top + site.wzAt(mx + best.nx * 2, my + best.ny * 2)) / 2]; }
      return null;
    }
    const resolveView = r => { if (!r.ref) return r; const t = refTarget(r.ref); return Object.assign({}, r, { target: t || refTarget({ region: 'honmaru' }) }); };
    const LEGACY = { // r2 的硬编码相机（只用于审计对比）
      aerial: [[-560, -700, 430], [-20, -60, 0]], top: [[0, -60, 1650], [0, -59.9, 0]], otemon: [[-345, -268, 9], [-262, -255, 9]], tenshu: [[40, -150, 22], [0, 0, 40]],
      eastwall: [[172, -70, -4], [120, 40, 12]], otejoint: [[-236, -270, 14], [-268, -262, 3]], sakura: [[18, -196, 30], [-12, -228, 15]],
    };
    let F = null, PRE = {}, ROUTES = {};
    // ---------- 步行（web-r4）：门的 H14 路线（坡道/桥外端 → 门洞 → 曲轮地面 ≥goal），眼高 1.6 m 的相机球沿路线全程合法 ----------
    function gateRoute(gate, ok) {
      const WK = site.spec.walk, g = gate.region, r = gate.ramp, vdir = gate.nin || [-Math.sin(gate.ang), Math.cos(gate.ang)];
      const side = (x, y) => (x - gate.x) * vdir[0] + (y - gate.y) * vdir[1], dd = (x, y) => Math.hypot(x - gate.x, y - gate.y);
      const level = (x, y) => Math.abs(site.surfaceAt(x, y) - g.surf.at(x, y)) < 0.1 && site.zoneAt(x, y) === g;   // r7b：台地面是函数
      let starts, goal;
      if (gate.nin && r && r.p1) { starts = [r.p1]; goal = (x, y) => side(x, y) > 0 && dd(x, y) >= WK.goal && level(x, y); }
      else { starts = [20, 16, 24, 12].map(s => [gate.x - vdir[0] * s, gate.y - vdir[1] * s]); goal = (x, y) => side(x, y) > 0 && dd(x, y) >= 20 && level(x, y); }
      let res = null; const atGate = (x, y) => Math.hypot(x - gate.x, y - gate.y) <= 0.75; // 两段：起点 → 门洞中心 → 曲轮地面（保证真的穿过这座门的门洞）
      for (const st of starts) { const M = WK.margin, box = [Math.min(st[0], gate.x) - M, Math.min(st[1], gate.y) - M, Math.max(st[0], gate.x) + M, Math.max(st[1], gate.y) + M];
        const r1 = F.walkRoute(st, atGate, box, { ok, slope: WK.slope }); if (!r1.ok) { res = { ok: false, why: r1.why === 'start' ? 'start' : 'to-gate' }; if (r1.why === 'start') continue; break; }
        const g0 = r1.raw[r1.raw.length - 1], r2 = F.walkRoute(g0, goal, box, { ok, slope: WK.slope }); res = r2.ok ? { ok: true, raw: r1.raw.concat(r2.raw.slice(1)), exp: r1.exp + r2.exp } : { ok: false, why: 'from-gate' }; break; }
      if (!res.ok) return { ok: false, why: res.why, gate: gate.name };
      const pts = ok ? res.raw : F.walkSmooth(res.raw); let bad = 0, thr = 1e9; const chk = ok || (q => F.valid(q, 1e-3));
      for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], N = Math.max(1, Math.ceil(dist3(a, b) / 0.25)); for (let k = 1; k <= N; k++) { const u = k / N; if (!chk([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u])) bad++; } }
      for (const p of pts) thr = Math.min(thr, Math.hypot(p[0] - gate.x, p[1] - gate.y)); // 必须穿过门洞（离门洞中心 ≤ 门洞半宽）
      const eye = pts.map(p => p[2] - site.surfaceAt(p[0], p[1]));
      return { ok: !bad && thr <= gate.open / 2, bad, thr, pts, gate: gate.name, exp: res.exp, eyeMin: Math.min(...eye), eyeMax: Math.max(...eye) };
    }
    const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const gateById = id => site.gates.find(g => g.spec.id === id);
    function route(id) { if (!ROUTES[id]) { const g = gateById(id); ROUTES[id] = g ? gateRoute(g) : { ok: false, why: 'nogate' }; } return ROUTES[id]; }
    const aheadOf = (P, s, a) => { const L = P.L; if (s + a <= L) return P.posAt(s + a); const e = P.posAt(L), b = P.posAt(Math.max(0, L - 1)), d = [e[0] - b[0], e[1] - b[1], e[2] - b[2]], l = Math.hypot(...d) || 1, x = s + a - L; return [e[0] + d[0] / l * x, e[1] + d[1] / l * x, e[2] + d[2] / l * x]; };
    function walkPreset(r) {
      const W = route(r.walk); if (!W.ok) { const t = refTarget({ region: 'honmaru' }); return { cam: [t[0], t[1], t[2] + 900], tgt: t, cost: Infinity, k: null }; }
      const g = gateById(r.walk), P = F.polyPath(W.pts, { tgt: [0, 0, 0] }, { tgt: [0, 0, 0] }); let best = 0, bd = 1e9, s = 0;
      for (let i = 0; i < W.pts.length; i++) { if (i) s += dist3(W.pts[i - 1], W.pts[i]); const d = Math.hypot(W.pts[i][0] - g.x, W.pts[i][1] - g.y); if (d < bd) { bd = d; best = s; } }
      const t = aheadOf(P, best, r.ahead); t[2] -= 0.5; return { cam: P.posAt(best), tgt: t, cost: 0, k: 'walk' };
    }
    // 步行动画：沿路线，相机在眼高，目标 = 前方 8 m、低 0.5 m（略俯视，避开 OrbitControls 的极角上限）
    function walkAnim(id, speed) {
      const W = route(id); if (!W.ok) return null; const P = F.polyPath(W.pts, { tgt: [0, 0, 0] }, { tgt: [0, 0, 0] }), L = P.L;
      const at = t => { const k = clamp01(t), s = L * (k < 0.08 ? k * k / 0.16 : k > 0.92 ? 1 - (1 - k) * (1 - k) / 0.16 : (k - 0.04) / 0.92); const cam = P.posAt(s), tg = aheadOf(P, s, 8); tg[2] -= 0.5; return { cam, tgt: tg }; };
      return { at, L, dur: L / (speed || 6), maxLift: 0, kind: 'walk' };
    }
    const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;
    function buildField() {
      const t0 = performance.now(); F = CAMX.create(site, { R: CAM_R, keepTris: P.camgeo }); world.updateMatrixWorld(true);
      const skip = new Set(['terrain', 'outer', 'water', 'labels', 'bad']), m4 = new THREE.Matrix4(), mm = new THREE.Matrix4();
      const walk = o => { if (skip.has(o.name) || o.isSprite) return; if (o.isMesh && o.geometry) { const g = o.geometry, pos = g.attributes.position.array, idx = g.index ? g.index.array : null;
          if (o.isInstancedMesh) { for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m4); mm.multiplyMatrices(o.matrixWorld, m4); F.addTris(pos, idx, mm.elements, true); } }
          else F.addTris(pos, idx, o.matrixWorld.equals(new THREE.Matrix4()) ? null : o.matrixWorld.elements); }
        for (const ch of o.children) walk(ch); };
      walk(world); const t1 = performance.now(); F.finish(); ROUTES = {}; lastCam = null; const t2 = performance.now();
      const bridgeRule = r => { const B = (site.bridges || []).find(b => b.gate.spec.id === r.bridge); if (!B) return Object.assign({}, r, { target: refTarget({ region: 'honmaru' }), az: -90 }); const m = B.P(B.len / 2, 0); return Object.assign({}, r, { target: [m[0], m[1], B.topAt(B.len / 2) - 3], az: Math.atan2(B.v[1], B.v[0]) * 180 / Math.PI + r.daz }); };
      PRE = {}; for (const [k, r] of Object.entries(VIEWS)) {
        // r7b：步行视角（门洞里）要先在 1 m 栅格上寻路（~0.15 s），改为第一次用到时才求（结果与预先求相同；首帧不需要它）
        if (r.walk) { let v = null; Object.defineProperty(PRE, k, { enumerable: true, configurable: true, get: () => v || (v = walkPreset(r)) }); }
        else PRE[k] = F.fixPreset(r.bridge ? bridgeRule(r) : resolveView(r)); }
      state.camT = { collect: Math.round(t1 - t0), finish: Math.round(t2 - t1), presets: Math.round(performance.now() - t2) };
      state.camField = F; state.presets = PRE; state.stats.camMs = Math.round(performance.now() - t0);
    }
    let anim = null;
    const cur = () => ({ cam: w3(camera.position), tgt: w3(controls.target) });
    function setView(name, instant) {
      if (!VIEWS[name]) name = 'aerial'; const v = PRE[name]; P.view = name; writeHash(P);
      document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.v === name));
      if (instant) { anim = null; setV(camera.position, v.cam); setV(controls.target, v.tgt); controls.update(); lastCam = v.cam.slice(); enforce(); requestRender(); return; }
      const pth = F.path(cur(), v); anim = { list: [pth], i: 0, pth, s: performance.now() }; requestRender();
    }
    // 步行穿门：先过渡到路线起点（看向前方），再沿 H14 路线以眼高走过门洞
    function walkThrough(id, now) {
      const W = walkAnim(id || 'otemon'); if (!W) return false; const s0 = W.at(0), pth = F.path(cur(), s0);
      anim = { list: [pth, W], i: 0, pth, s: now === undefined ? performance.now() : now }; requestRender(); return true;
    }
    // 每帧约束：目标不低于地面；相机球心若进入实体/地下，取位移最小的修正（抬升或沿视线收回）
    // web-r4：相机从上一帧合法位置连续运动到期望位置（扫掠 + 接触滑移，防穿薄墙）；瞬移/重建后按“合法且向上开放”落点
    let fixes = 0, lastCam = null;
    function enforce(teleport) {
      const t = w3(controls.target), fl = F.floorAt(t[0], t[1]); if (t[2] < fl) { t[2] = fl; setV(controls.target, t); }
      const c = w3(camera.position), r = (!lastCam || teleport) ? F.place(c) : F.move(lastCam, c); lastCam = r;
      if (dist3(r, c) > 1e-6) { setV(camera.position, r); camera.lookAt(controls.target); fixes++; return true; } return false;
    }
    function enforceR3() { // web-r3 旧逻辑（只用于对照审计）
      const t = w3(controls.target), fl = F.floorAt(t[0], t[1]); if (t[2] < fl) { t[2] = fl; setV(controls.target, t); }
      const c = w3(camera.position), r = F.resolveLegacy(c, t, controls.minDistance); if (r) { setV(camera.position, r); camera.lookAt(controls.target); return true; } return false;
    }
    state.camFixes = () => fixes;
    controls.addEventListener('start', () => { anim = null; });
    let need = true; function requestRender() { need = true; }
    controls.addEventListener('change', requestRender);
    addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.near = nearFor(camera.fov, camera.aspect); camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); requestRender(); });
    function step(now) {
      let moved = false; if (!F) return false;
      if (anim) { const k = (now - anim.s) / (anim.pth.dur * 1000), q = anim.pth.at(k); setV(camera.position, q.cam); setV(controls.target, q.tgt); moved = true;
        if (k >= 1) { if (anim.i + 1 < anim.list.length) { anim.i++; anim.s = now; anim.pth = anim.list[anim.i]; } else anim = null; } }
      if (controls.update()) moved = true;
      if (enforce()) moved = true; // 约束之后不再 controls.update()（它会按阻尼余量再挪一次相机，绕过约束）；下一帧从新位置继续
      return moved;
    }
    renderer.setAnimationLoop(now => {
      if (step(now)) need = true;
      if (need) { renderer.render(scene, camera); need = false; state.frames = (state.frames || 0) + 1; }
    });

    // ---------- 相机审计 C1–C7 ----------
    const CRULES = [
      { id: 'C1', name: '视角相机球体不在实体内/地下/水下' },
      { id: 'C2', name: '视角相机到目标视线无遮挡' },
      { id: 'C3', name: '任意两视角之间的过渡路径全程清空（0.25 m 采样）' },
      { id: 'C4', name: '随机旋转/平移/缩放 模糊测试：相机始终清空' },
      { id: 'C5', name: '近裁剪面四角在相机球内（近处墙面不被切）' },
      { id: 'C6', name: '每座门：眼高 1.6 m 沿 H14 路线穿过门洞，全程清空（失败门数）' },
      { id: 'C7', name: '快速拖动/穿越模糊测试：相邻两帧之间球心不穿过任何几何' },
      { id: 'C8', name: '每座木桥：相机球贴水面从桥下两墩之间横穿，全程清空（失败桥数）' },
    ];
    // C8（r5）：木桥下的船行通道——在跨中所在的那一跨（两支点之间）中线上，球心离水面 R+0.4，垂直于桥轴横穿桥下；
    // 要求：跨净宽 ≥ 2R+0.6、桥底净空够、两端合法且向上开放、直线扫掠全程合法、逐帧 move() 走完全程不被挡（不滑移）
    function bridgeUnder() {
      const out = [];
      for (const B of site.bridges || []) {
        const sup = [B.sA].concat(B.piers.map(p => p.s), [B.sB]).sort((a, b) => a - b), mid = B.len / 2; let a = sup[0], b = sup[sup.length - 1];
        for (let i = 1; i < sup.length; i++) if (sup[i - 1] <= mid && sup[i] >= mid) { a = sup[i - 1]; b = sup[i]; break; }
        const sm = (a + b) / 2, gap = b - a - SITE.SPEC.bridge.pierW, c0 = B.P(sm, 0), wz = site.wzAt(c0[0], c0[1]) /* r7b：桥下那片水的实测水位 */, zc = wz + CAM_R + 0.4, roof = B.topAt(sm) - B.t, L = B.hw + 3 * CAM_R + 6;
        const A = [c0[0] - B.v[0] * L, c0[1] - B.v[1] * L, zc], Bp = [c0[0] + B.v[0] * L, c0[1] + B.v[1] * L, zc];
        let ok = gap >= 2 * CAM_R + 0.6 && roof - zc >= CAM_R + 0.2, why = ok ? '' : '跨/净空不够';
        if (ok && !(F.valid(A) && F.valid(Bp) && F.openUp(A) && F.openUp(Bp))) { ok = false; why = '两端不合法'; }
        if (ok && !F.segFree(A, Bp, 0.25)) { ok = false; why = '扫掠被挡'; }
        if (ok) { let p = A; for (let k = 1; k <= 40; k++) p = F.move(p, [A[0] + (Bp[0] - A[0]) * k / 40, A[1] + (Bp[1] - A[1]) * k / 40, zc]); if (dist3(p, Bp) > 1e-3) { ok = false; why = '逐帧运动被挡'; } }
        let geo = 0; if (ok && F.hasGeo()) for (let k = 0; k <= 40; k++) if (F.geoCheck([A[0] + (Bp[0] - A[0]) * k / 40, A[1] + (Bp[1] - A[1]) * k / 40, zc])) geo++;
        out.push({ bridge: B.name, ok, why, span: +(b - a).toFixed(2), clear: +(roof - wz).toFixed(2), wz, geo });
      }
      return out;
    }
    function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
    // 模糊测试：随机施加 OrbitControls 的操作（旋转/缩放/平移/穿过目标的推拉，含大幅度；以及把目标瞬移到全城任意处），然后跑真实的一帧约束
    // mode: 'new'（web-r4 扫掠）| 'r3'（web-r3 柱状场抬升）| 'none'（r2 无约束）
    function fuzz(n, seed, mode, geo, start) {
      const save = cur(), rnd = rng(seed || 7), sp = new THREE.Spherical(), off = new THREE.Vector3(); let bad = 0, badGeo = 0, checked = 0, tun = 0; const ex = [], exT = [];
      if (start) { const v = PRE[start]; setV(camera.position, v.cam); setV(controls.target, v.tgt); controls.update(); lastCam = v.cam.slice(); }
      if (mode === 'new') enforce(!lastCam || !F.valid(lastCam));
      for (let i = 0; i < n; i++) {
        const a = rnd(), prev = w3(camera.position); let jump = false;
        if (a < 0.3) { off.copy(camera.position).sub(controls.target); sp.setFromVector3(off); sp.theta += (rnd() - 0.5) * 1.6; sp.phi += (rnd() - 0.5) * 0.9; off.setFromSpherical(sp); camera.position.copy(controls.target).add(off); }
        else if (a < 0.55) { off.copy(camera.position).sub(controls.target); const s = rnd() < 0.5 ? 0.2 + rnd() * 0.6 : 1 + rnd() * 1.5; off.multiplyScalar(s); camera.position.copy(controls.target).add(off); }
        else if (a < 0.7) { off.copy(camera.position).sub(controls.target); off.multiplyScalar(-(0.3 + rnd())); camera.position.copy(controls.target).add(off); } // 推拉穿过目标（快速拖动最容易穿墙的情形）
        else if (a < 0.92) { const d = camera.position.distanceTo(controls.target), v = new THREE.Vector3((rnd() - 0.5), (rnd() - 0.5) * 0.4, (rnd() - 0.5)).multiplyScalar(d * 0.8); camera.position.add(v); controls.target.add(v); }
        else { jump = true; const x = -420 + rnd() * 840, y = -520 + rnd() * 860, z = site.surfaceAt(x, y), d = 3 + rnd() * 60, v = new THREE.Vector3(); setV(v, [x, y, z]); const o = camera.position.clone().sub(controls.target).setLength(d); controls.target.copy(v); camera.position.copy(v).add(o); }
        controls.update(); if (mode === 'new') enforce(jump); else if (mode === 'r3') enforceR3();
        const c = w3(camera.position); if (!F.clear(c, 1e-3)) { bad++; if (ex.length < 5) ex.push(c.map(v => +v.toFixed(1))); }
        const mv = mode === 'new' && !jump ? (F.lastMove() || [prev, c]) : [prev, c]; let hit = false; if (!jump) for (let k = 1; k < mv.length && !hit; k++) hit = !!F.segHit(mv[k - 1], mv[k]);
        if (hit) { tun++; if (exT.length < 3) exT.push([prev.map(v => +v.toFixed(1)), c.map(v => +v.toFixed(1))]); }
        if (geo && F.hasGeo() && i % geo === 0) { checked++; if (F.geoCheck(c)) badGeo++; }
      }
      setV(camera.position, save.cam); setV(controls.target, save.tgt); controls.update(); lastCam = null; if (mode === 'new') enforce(true); requestRender();
      return { n, bad, badGeo, checked, ex, tun, exT };
    }
    const C7_STARTS = ['otegate', 'otejoint', 'sakura', 'eastwall', 'tenshu'];
    function tunnelFuzz(mode, n, seed) { let tun = 0, bad = 0; const ex = []; C7_STARTS.forEach((v, i) => { const f = fuzz(n || 120, (seed || 101) + i, mode, 0, v); tun += f.tun; bad += f.bad; ex.push(...f.exT); }); return { tun, bad, ex: ex.slice(0, 3) }; }
    function gateAudit(old) { const out = []; for (const g of site.gates) { const r = old ? gateRoute(g, q => F.clearOld(q, 1e-3)) : route(g.spec.id); out.push({ gate: g.name, ok: !!r.ok, why: r.why, bad: r.bad, thr: r.thr && +r.thr.toFixed(2), n: r.pts && r.pts.length, eye: r.eyeMin !== undefined ? [+r.eyeMin.toFixed(2), +r.eyeMax.toFixed(2)] : null }); } return out; }
    function cameraAudit(o) {
      o = o || {}; const legacy = !!o.legacy, names = Object.keys(VIEWS).filter(k => !legacy || LEGACY[k]), cnt = { C1: 0, C2: 0, C3: 0, C4: 0, C5: 0, C6: 0, C7: 0, C8: 0 }, items = [], geo = { C1: 0, C3: 0, C4: 0, C6: 0, C8: 0 };
      const pre = {}; for (const k of names) pre[k] = legacy ? { cam: LEGACY[k][0], tgt: LEGACY[k][1] } : PRE[k];
      for (const k of names) { const p = pre[k];
        if (!F.clear(p.cam, 1e-3)) { cnt.C1++; items.push('C1 ' + k + ' 相机球不合法 ' + p.cam.map(v => v.toFixed(1))); }
        if (o.geo && F.hasGeo() && F.geoCheck(p.cam)) geo.C1++;
        if (!F.los(p.cam, p.tgt, VIEWS[k].rf).ok) { cnt.C2++; items.push('C2 ' + k + ' 视线被挡'); } }
      const lifts = [];
      for (const a of names) for (const b of names) { if (a === b) continue; const pth = legacy ? F.linear(pre[a], pre[b]) : F.path(pre[a], pre[b]), nb = F.pathBad(pth); if (!legacy) lifts.push(pth.maxLift); if (nb) { cnt.C3++; if (items.length < 30) items.push('C3 ' + a + '→' + b + ' ' + nb + ' 个采样点不清空'); }
        if (o.geo && F.hasGeo()) for (let k = 0; k <= 40; k++) if (F.geoCheck(pth.at(k / 40).cam)) { geo.C3++; break; } }
      const fz = fuzz(o.fuzz || 400, o.seed || 7, legacy ? 'none' : 'new', o.geo ? 5 : 0); cnt.C4 = fz.bad; geo.C4 = fz.badGeo; if (fz.bad) items.push('C4 模糊测试 ' + fz.bad + '/' + fz.n + ' 步相机不清空，例 ' + JSON.stringify(fz.ex[0]));
      const t = Math.tan(camera.fov * Math.PI / 360), corner = camera.near * Math.sqrt(1 + t * t * (1 + camera.aspect * camera.aspect)); if (!(corner < CAM_R)) { cnt.C5++; items.push('C5 近平面角距 ' + corner.toFixed(2)); }
      let gates = null, tf = null, bu = null;
      if (!legacy) { gates = gateAudit(!!o.old); cnt.C6 = gates.filter(g => !g.ok).length; for (const g of gates) if (!g.ok) items.push('C6 ' + g.gate + ' 步行穿门失败（' + (g.why || ('不清空 ' + g.bad + ' / 离门洞中心 ' + g.thr + ' m')) + '）');
        if (o.geo && F.hasGeo()) for (const g of site.gates) { const r = route(g.spec.id); if (r.pts) for (let k = 0; k < r.pts.length; k += 4) if (F.geoCheck(r.pts[k])) { geo.C6++; break; } }
        tf = tunnelFuzz(o.old ? 'r3' : 'new', o.c7n, o.seed); cnt.C7 = tf.tun; if (tf.tun) items.push('C7 ' + tf.tun + ' 次两帧之间穿过几何，例 ' + JSON.stringify(tf.ex[0]));
        bu = bridgeUnder(); cnt.C8 = bu.filter(q => !q.ok).length; for (const q of bu) { if (!q.ok) items.push('C8 ' + q.bridge + ' 桥下横穿失败（' + q.why + '）'); geo.C8 += q.geo; } }
      const total = Object.values(cnt).reduce((s, v) => s + v, 0);
      return { total, cnt, items, geo, gates, c7: tf, bridges: bu, fuzzChecked: fz.checked, near: +camera.near.toFixed(3), presetCost: Object.fromEntries(names.map(k => [k, PRE[k].cost])), maxLift: lifts.length ? +Math.max(...lifts).toFixed(1) : null, meanLift: lifts.length ? +(lifts.reduce((a, b) => a + b, 0) / lifts.length).toFixed(2) : null };
    }
    function showCamAudit(A) {
      const el = $('camaudit'); if (!el) return; const ok = A.total === 0;
      let h = `<div class="ah ${ok ? 'ok' : 'ng'}">相机审计：${ok ? '全部通过 ✓' : A.total + ' 项违规'}</div><table>`;
      for (const r of CRULES) h += `<tr class="${A.cnt[r.id] ? 'ng' : ''}"><td>${r.id}</td><td>${r.name}</td><td>${A.cnt[r.id]}</td></tr>`;
      h += '</table>'; if (!ok) h += '<div class="items">' + A.items.slice(0, 8).map(s => `<div>${s}</div>`).join('') + '</div>'; el.innerHTML = h;
    }
    document.querySelectorAll('#views button').forEach(b => b.onclick = () => setView(b.dataset.v));
    if ($('walk')) $('walk').onclick = () => walkThrough('otemon');
    $('labels').checked = P.labels; $('labels').onchange = e => { P.labels = e.target.checked; writeHash(P); const l = world.getObjectByName('labels'); if (l) l.visible = P.labels; requestRender(); };
    $('lost').checked = P.lost; $('lost').onchange = e => { P.lost = e.target.checked; writeHash(P); $('era').textContent = P.lost ? '江戸盛期（含失传橹）' : '现状'; buildWorld(P); };
    $('era').textContent = P.lost ? '江戸盛期（含失传橹）' : '现状';
    $('seed').value = P.seed; $('seed').onchange = e => { P.seed = Math.max(1, +e.target.value | 0); writeHash(P); buildWorld(P); };
    $('hide').onclick = () => $('ui').classList.toggle('min');

    buildWorld(P, true, PREBUILT); setView(P.view, true);
    state.THREE = THREE; state.scene = scene; state.camera = camera; state.renderer = renderer;
    state.setView = (v) => setView(v, true);
    state.goView = v => setView(v, false); state.walkThrough = (id, now) => walkThrough(id, now); state.route = route; state.walkAnim = walkAnim; state.enforce = enforce; state.step = now => step(now); state.anim = () => anim && { s: anim.s, dur: anim.pth.dur, maxLift: anim.pth.maxLift }; state.cameraAudit = cameraAudit; state.cur = cur; state.VIEWS = VIEWS;
    state.look = (a, b) => { camera.position.copy(W(...a)); controls.target.copy(W(...b)); controls.update(); renderer.render(scene, camera); };
    state.renderNow = () => { controls.update(); renderer.render(scene, camera); };
    state.rebuild = o => { Object.assign(P, o); writeHash(P); buildWorld(P); };
    state.loadMs = Math.round(performance.now() - T0);
    state.ready = true; $('load').remove();
    addEventListener('hashchange', () => { const n = readHash(); if (n.seed !== P.seed || n.lost !== P.lost || n.cell !== P.cell) { Object.assign(P, n); $('lost').checked = P.lost; $('seed').value = P.seed; buildWorld(P); } if (n.view !== P.view) setView(n.view); });
  }

  addEventListener('error', e => state.errors.push(String(e.message || e)));
  let started = false;
  const start = () => { if (started) return; started = true; return main().catch(e => { state.errors.push(String(e && e.stack || e)); const l = $('load'); if (l) l.textContent = '加载失败：' + e; console.error(e); }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
