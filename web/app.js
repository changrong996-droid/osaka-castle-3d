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
    return { seed: +(p.get('seed') || 1), lost: p.get('lost') !== '0', view: p.get('view') || 'aerial', labels: p.get('labels') !== '0', cell: +(p.get('cell') || SITE.SPEC.grid.cell), audit: p.get('audit') !== '0' };
  }
  function writeHash(o) { const h = '#seed=' + o.seed + '&lost=' + (o.lost ? 1 : 0) + '&view=' + o.view + '&labels=' + (o.labels ? 1 : 0) + (o.cell !== SITE.SPEC.grid.cell ? '&cell=' + o.cell : ''); if (location.hash !== h) history.replaceState(null, '', h); }

  async function main() {
    const im = document.createElement('script'); im.type = 'importmap';
    im.textContent = JSON.stringify({ imports: { three: THREE_BASE + 'build/three.module.js', 'three/addons/': THREE_BASE + 'examples/jsm/' } });
    document.head.appendChild(im);
    const THREE = await import('three');
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    const { Sky } = await import('three/addons/objects/Sky.js');
    run(THREE, OrbitControls, Sky);
  }

  function run(THREE, OrbitControls, Sky) {
    const T0 = performance.now();
    const P = readHash();
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.72;
    document.body.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xbfc8cc, 1400, 4200);
    const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.5, 9000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 5; controls.maxDistance = 3000;
    const sky = new Sky(); sky.scale.setScalar(8000); scene.add(sky);
    const su = sky.material.uniforms; su.turbidity.value = 6; su.rayleigh.value = 1.5; su.mieCoefficient.value = 0.005; su.mieDirectionalG.value = 0.8;
    const sun = new THREE.DirectionalLight(0xfff0dc, 3.0); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -620, right: 620, top: 620, bottom: -620, near: 10, far: 3000 }); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.6;
    scene.add(sun, sun.target); const hemi = new THREE.HemisphereLight(0xd6e4ff, 0x5d5545, 1.35); scene.add(hemi);
    { const el = 0.6, az = THREE.MathUtils.degToRad(215), v = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - el, az); su.sunPosition.value.copy(v); sun.position.copy(v).multiplyScalar(1500); sun.target.position.set(0, 0, 0); }
    // world (x 东, y 北, z 上) -> three (x, z, -y)
    const W = (x, y, z) => new THREE.Vector3(x, z, -y);

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
      function meshes() { const out = []; for (const [m, a] of Object.entries(acc)) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3)); g.computeVertexNormals(); const mesh = new THREE.Mesh(g, M[m]); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = m; out.push(mesh); } return out; }
      return { box, seg, prism, hip, gable, windows, quad, tri, meshes };
    }

    // ---------- 部件族 ----------
    const FAM = {
      yagura2(k, p) { const w = p.w * (p.real ? 0.92 : 1), d = p.d * (p.real ? 0.92 : 1); k.box('stone', p.x, p.y, p.z, w + 0.4, d + 0.4, 0.6, p.ang); k.box('plaster', p.x, p.y, p.z + 0.6, w, d, 6.2, p.ang); k.windows(p.x, p.y, p.z + 3.4, w, d, p.ang, Math.max(2, Math.round(w / 3.5)));
        k.hip('tile', p.x, p.y, p.z + 6.6, w, d, p.ang, 1.7, 2.0, 0.6); const w2 = w * 0.72, d2 = d * 0.72; k.box('plaster', p.x, p.y, p.z + 7.6, w2, d2, 4.4, p.ang); k.windows(p.x, p.y, p.z + 9.4, w2, d2, p.ang, Math.max(2, Math.round(w2 / 3.5))); k.hip('tile', p.x, p.y, p.z + 11.8, w2, d2, p.ang, 1.6, 3.0, 0.2); },
      yagura3(k, p) { const w = p.w, d = p.d; k.box('stone', p.x, p.y, p.z, w + 0.4, d + 0.4, 0.6, p.ang); k.box('plaster', p.x, p.y, p.z + 0.6, w, d, 6.0, p.ang); k.windows(p.x, p.y, p.z + 3.4, w, d, p.ang, 4);
        k.hip('tile', p.x, p.y, p.z + 6.4, w, d, p.ang, 1.7, 1.8, 0.6); const w2 = w * 0.78, d2 = d * 0.78; k.box('plaster', p.x, p.y, p.z + 7.2, w2, d2, 4.0, p.ang); k.windows(p.x, p.y, p.z + 8.8, w2, d2, p.ang, 3);
        k.hip('tile', p.x, p.y, p.z + 10.8, w2, d2, p.ang, 1.5, 1.6, 0.6); const w3 = w * 0.58, d3 = d * 0.58; k.box('plaster', p.x, p.y, p.z + 11.5, w3, d3, 3.6, p.ang); k.windows(p.x, p.y, p.z + 13.0, w3, d3, p.ang, 2); k.hip('tile', p.x, p.y, p.z + 14.9, w3, d3, p.ang, 1.4, 2.6, 0.2); },
      gate(k, p) { const w = p.w, d = p.d, c = Math.cos(p.ang), s = Math.sin(p.ang), at = (u, v) => [p.x + u * c - v * s, p.y + u * s + v * c];
        for (const sd of [-1, 1]) { const [x, y] = at(sd * w * 0.32, 0); k.box('iron', x, y, p.z, 0.9, 0.9, 6.2, p.ang); const [x2, y2] = at(sd * w * 0.32, d * 0.38); k.box('iron', x2, y2, p.z, 0.5, 0.5, 4.2, p.ang); const [x3, y3] = at(sd * w * 0.18, 0); k.box('iron', x3, y3, p.z, w * 0.27, 0.25, 5.2, p.ang); }
        k.box('iron', p.x, p.y, p.z + 5.4, w * 0.82, 0.7, 0.7, p.ang); k.gable('tile', p.x, p.y, p.z + 6.1, w * 0.86, 1.6, p.ang, 0.5, 1.3);
        for (const sd of [-1, 1]) { const [x, y] = at(sd * w * 0.32, d * 0.38); k.gable('tile', x, y, p.z + 4.4, 1.6, d * 0.8, p.ang + Math.PI / 2, 0.3, 0.7); } },
      yaguramon(k, p) { const w = p.w, d = p.d, c = Math.cos(p.ang), s = Math.sin(p.ang), at = (u, v) => [p.x + u * c - v * s, p.y + u * s + v * c];
        for (const sd of [-1, 1]) { const [x, y] = at(sd * (w / 4 + 1.75), 0); k.box('stone', x, y, p.z, w / 2 - 3.5, d, 4.6, p.ang); }
        k.box('iron', p.x, p.y, p.z, 5.0, d * 0.3, 4.4, p.ang);
        k.box('plaster', p.x, p.y, p.z + 4.6, w, d, 4.2, p.ang); k.windows(p.x, p.y, p.z + 6.4, w, d, p.ang, Math.max(3, Math.round(w / 3))); k.hip('tile', p.x, p.y, p.z + 8.6, w, d, p.ang, 1.6, 2.6, 0.3); },
      kura(k, p) { const w = p.w * 0.95, d = p.d * 0.9; k.box(p.name === '焔硝蔵' ? 'stone' : 'lacquer', p.x, p.y, p.z, w + 0.2, d + 0.2, 1.3, p.ang); k.box('plaster', p.x, p.y, p.z + 1.3, w, d, 3.9, p.ang); k.gable('tile', p.x, p.y, p.z + 5.2, w, d, p.ang, 0.9, d * 0.38); },
      hall(k, p) { const w = p.w * 0.85, d = p.d * 0.8; k.box('stone', p.x, p.y, p.z, w + 1.6, d + 1.6, 0.8, p.ang); k.box('wood', p.x, p.y, p.z + 0.8, w, d, 4.4, p.ang); k.hip('tile', p.x, p.y, p.z + 5.0, w, d, p.ang, 2.2, d * 0.36, 0.25); },
      pavilion(k, p) { const w = p.w * 0.7, d = p.d * 0.7, c = Math.cos(p.ang), s = Math.sin(p.ang); for (const a of [-1, 1]) for (const b of [-1, 1]) k.box('wood', p.x + a * w / 2 * c - b * d / 2 * s, p.y + a * w / 2 * s + b * d / 2 * c, p.z, 0.3, 0.3, 3, p.ang); k.box('stone', p.x, p.y, p.z, 2.4, 2.4, 0.9, p.ang); k.hip('tile', p.x, p.y, p.z + 3, w, d, p.ang, 0.9, 1.6, 0.1); },
      tamon(k, p) { const b = p.data, z = p.z; k.prism('lacquer', b.fp, z, z + 1.2); k.prism('plaster', b.fp, z + 1.2, z + 5.5); k.prism('ridge', b.roof, z + 5.2, z + 5.8, 'tile'); if (b.roof2 && b.roof2.length >= 3) k.prism('tile', b.roof2, z + 5.8, z + 7.4, 'ridge'); },
      dobei(k, p) { k.seg('lacquer', p.x0, p.y0, p.x1, p.y1, p.z, p.t + 0.04, 0.5); k.seg('plaster', p.x0, p.y0, p.x1, p.y1, p.z + 0.5, p.t, p.h - 0.5); k.seg('tile', p.x0, p.y0, p.x1, p.y1, p.z + p.h, p.t + 0.7, 0.28); k.seg('ridge', p.x0, p.y0, p.x1, p.y1, p.z + p.h + 0.28, 0.3, 0.22); },
      mwall(k, p) { k.seg('stone', p.x0, p.y0, p.x1, p.y1, p.z, p.t, p.h); FAM.dobei(k, { x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, z: p.z + p.h, t: 0.6, h: 2.0 }); },
      bridge(k, p, S) { const L = Math.hypot(p.x1 - p.x0, p.y1 - p.y0), n = Math.ceil(L / 4), ang = Math.atan2(p.y1 - p.y0, p.x1 - p.x0), nx = -Math.sin(ang), ny = Math.cos(ang), r = S.ramps.find(q => q.part === p);
        for (let i = 0; i < n; i++) { const f0 = i / n, f1 = (i + 1) / n, z0 = S.rampProf(r, f0), z1 = S.rampProf(r, f1), a = [p.x0 + (p.x1 - p.x0) * f0, p.y0 + (p.y1 - p.y0) * f0], b = [p.x0 + (p.x1 - p.x0) * f1, p.y0 + (p.y1 - p.y0) * f1], hw = p.w / 2;
          const A = (pt, sd, z) => [pt[0] + nx * hw * sd, pt[1] + ny * hw * sd, z];
          k.quad('deck', A(a, -1, z0), A(b, -1, z1), A(b, 1, z1), A(a, 1, z0)); k.quad('deck', A(a, 1, z0 - 0.5), A(b, 1, z1 - 0.5), A(b, -1, z1 - 0.5), A(a, -1, z0 - 0.5));
          for (const sd of [-1, 1]) { k.quad('deck', A(a, sd, z0 - 0.5), A(b, sd, z1 - 0.5), A(b, sd, z1), A(a, sd, z0)); const ra = A(a, sd * 0.95, z0 + 1.0), rb = A(b, sd * 0.95, z1 + 1.0); k.seg('vermil', ra[0], ra[1], rb[0], rb[1], (z0 + z1) / 2 + 0.9, 0.2, 0.2); const pz = S.heightAt(...A(a, sd * 0.95, 0).slice(0, 2)); k.box('vermil', ...A(a, sd * 0.95, 0).slice(0, 2), Math.min(pz, z0), 0.22, 0.22, z0 + 1.1 - Math.min(pz, z0), ang); }
          if (i % 2 === 1) for (const sd of [-0.6, 0.6]) { const q = A(a, sd, 0), g = S.heightAt(q[0], q[1]); if (g < z0 - 1) k.box('wood', q[0], q[1], S.BED, 0.7, 0.7, z0 - 0.5 - S.BED, ang); } } },
      dobashi(k, p, S) { // 土桥路面：沿剖面铺一条略高于地形的碎石路面
        const r = S.ramps.find(q => q.part === p), L = Math.hypot(p.x1 - p.x0, p.y1 - p.y0), n = Math.max(2, Math.ceil(L / 1.5)), ang = Math.atan2(p.y1 - p.y0, p.x1 - p.x0), nx = -Math.sin(ang), ny = Math.cos(ang), hw = p.w / 2 - 0.4;
        for (let i = 0; i < n; i++) { const f0 = i / n, f1 = (i + 1) / n, z0 = S.rampProf(r, f0) + 0.08, z1 = S.rampProf(r, f1) + 0.08, a = [p.x0 + (p.x1 - p.x0) * f0, p.y0 + (p.y1 - p.y0) * f0], b = [p.x0 + (p.x1 - p.x0) * f1, p.y0 + (p.y1 - p.y0) * f1];
          k.quad('road', [a[0] - nx * hw, a[1] - ny * hw, z0], [b[0] - nx * hw, b[1] - ny * hw, z1], [b[0] + nx * hw, b[1] + ny * hw, z1], [a[0] + nx * hw, a[1] + ny * hw, z0]); } },
    };

    // ---------- 地形网格 ----------
    function terrainMesh(S) {
      const { NX, NY, H, CLS, TAG, LOCK, cell } = S, n = NX * NY, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      const nino = S.regions.filter(g => g.name === 'ninomaru').sort((a, b) => b.area - a.area)[0];
      const hash = (i, j) => { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
      const C = { bed: [0.20, 0.24, 0.20], stone: [0.50, 0.48, 0.44], gravel: [0.55, 0.51, 0.44], grass: [0.33, 0.43, 0.22], city: [0.55, 0.53, 0.49], earth: [0.48, 0.36, 0.22], road: [0.66, 0.58, 0.45] };
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const q = j * NX + i, h = H[q]; pos[q * 3] = S.X(i); pos[q * 3 + 1] = h; pos[q * 3 + 2] = -S.Y(j);
        const hx = (H[j * NX + Math.min(NX - 1, i + 1)] - H[j * NX + Math.max(0, i - 1)]) / (2 * cell), hy = (H[Math.min(NY - 1, j + 1) * NX + i] - H[Math.max(0, j - 1) * NX + i]) / (2 * cell), sl = Math.hypot(hx, hy);
        let c; const k = CLS[q], g = k >= 0 && k < S.regions.length ? S.regions[k] : null;
        if (TAG[q] === 2) c = C.road; else if (sl > 1.2 || TAG[q] === 1 || TAG[q] === 3) c = C.stone;
        else if (k < 0) c = C.bed; else if (k === S.BAND.i) c = C.city; else if (g.name === 'honmaru') c = C.gravel; else if (g.name === 'dry') c = C.earth; else if (g.name === 'ninomaru') c = C.grass; else c = C.city;
        const r = hash(i, j), big = 0.5 + 0.5 * Math.sin(S.X(i) * 0.05 + Math.cos(S.Y(j) * 0.04) * 2.0), v = c === C.stone ? 0.75 + 0.5 * r : 0.88 + 0.16 * r + (c === C.grass ? 0.12 * big : 0);
        col[q * 3] = c[0] * v; col[q * 3 + 1] = c[1] * v; col[q * 3 + 2] = c[2] * v;
      }
      const idx = new Uint32Array((NX - 1) * (NY - 1) * 6); let t = 0;
      for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) { const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1; idx[t++] = a; idx[t++] = b; idx[t++] = d; idx[t++] = a; idx[t++] = d; idx[t++] = c; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
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
    function outerGround(S) { // 网格以外（±700 m 内）：4 m 粗网格，按 data 的曲轮多边形取高（城下 0 / 河 -7），与细网格边界对齐、只建细网格外的格子
      const grp = new THREE.Group(), gs = SITE.SPEC.grid, c = 4, R0 = 700, n = R0 * 2 / c + 1, pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3);
      const lv = (x, y) => { const g = S.regionAt(x, y); return g ? (g.name === 'city' ? 0 : g.z) : S.BED; };
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = -R0 + i * c, y = -R0 + j * c, q = j * n + i, inside = x > gs.x0 && x < gs.x1 && y > gs.y0 && y < gs.y1, h = inside ? 0 : lv(x, y);
        pos[q * 3] = x; pos[q * 3 + 1] = h - (h >= 0 ? 0.02 : 0); pos[q * 3 + 2] = -y; const k = h < -1 ? [0.2, 0.24, 0.2] : [0.55, 0.53, 0.49], r = 0.9 + 0.12 * Math.abs(Math.sin(i * 12.9898 + j * 78.233) * 43758.5453 % 1);
        col[q * 3] = k[0] * r; col[q * 3 + 1] = k[1] * r; col[q * 3 + 2] = k[2] * r;
      }
      const idx = []; for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const x = -R0 + i * c, y = -R0 + j * c; if (x >= gs.x0 && x + c <= gs.x1 && y >= gs.y0 && y + c <= gs.y1) continue; const a = j * n + i, b = a + 1, cc = a + n, d = cc + 1; idx.push(a, b, d, a, d, cc); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
      const om = new THREE.Mesh(g, stoneShader(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }))); om.receiveShadow = true; om.name = 'outer'; grp.add(om);
      const mat = new THREE.MeshStandardMaterial({ color: 0x8a867c, roughness: 1 });
      const o = new THREE.Shape([[-9000, -9000], [9000, -9000], [9000, 9000], [-9000, 9000]].map(p => new THREE.Vector2(...p))); o.holes.push(new THREE.Path([[-R0, -R0], [-R0, R0], [R0, R0], [R0, -R0]].map(p => new THREE.Vector2(...p))));
      const m = new THREE.Mesh(new THREE.ShapeGeometry(o), mat); m.rotation.x = -Math.PI / 2; m.position.y = -0.02; grp.add(m);
      const water = new THREE.Mesh(new THREE.PlaneGeometry(18000, 18000), new THREE.MeshStandardMaterial({ color: 0x3b6872, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.9 }));
      water.rotation.x = -Math.PI / 2; water.position.y = S.WZ; water.receiveShadow = true; water.name = 'water'; grp.add(water);
      return grp;
    }
    function treesMesh(S) {
      const grp = new THREE.Group(), N = S.trees.length; if (!N) return grp;
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.38, 1, 6), new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 }), N);
      const crownG = new THREE.IcosahedronGeometry(1, 1), crown = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ roughness: 0.9 }), N * 2);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
      let ci = 0;
      S.trees.forEach((t, i) => {
        const h = (t.kind === 'pine' ? 6 : 5) * t.s;
        m4.compose(W(t.x, t.y, t.z + h * 0.4), q, new THREE.Vector3(t.s, h * 0.8, t.s)); trunk.setMatrixAt(i, m4);
        const pine = t.kind === 'pine';
        for (let k = 0; k < 2; k++) { const r = (pine ? 2.6 - k * 0.8 : 3.2 - k * 0.9) * t.s; m4.compose(W(t.x + (k ? 0.6 : -0.4) * t.s, t.y + (k ? -0.5 : 0.3) * t.s, t.z + h * (0.75 + k * 0.22)), q, new THREE.Vector3(r, r * (pine ? 0.45 : 0.85), r)); crown.setMatrixAt(ci, m4); col.setRGB(pine ? 0.13 : 0.22, pine ? 0.25 + 0.04 * k : 0.33 + 0.05 * k, pine ? 0.14 : 0.13); if (t.bad) col.setRGB(1, 0.1, 0.1); crown.setColorAt(ci, col); ci++; }
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
    function buildWorld(opt) {
      const t0 = performance.now();
      if (world) { scene.remove(world); world.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
      site = SITE.build(opt); const A = site.audit();
      world = new THREE.Group(); world.name = 'world';
      world.add(terrainMesh(site)); world.add(outerGround(site));
      const k = Kit();
      for (const p of site.parts) { if (p.fam === 'tenshu') continue; const f = FAM[p.fam]; if (f) f(k, p, site); }
      for (const m of k.meshes()) world.add(m);
      const tb = site.parts.find(p => p.fam === 'tenshu');
      if (tb) { if (!tenshuProto) tenshuProto = window.CASTLE_TENSHU.build(THREE, { maxAniso: renderer.capabilities.getMaxAnisotropy() }); const t = tenshuProto; t.position.copy(W(tb.x, tb.y, tb.z)); t.rotation.y = tb.ang; world.add(t); }
      world.add(treesMesh(site));
      const bad = new THREE.Group(); bad.name = 'bad';
      for (const p of site.parts) if (p.bad) { const bb = p.poly ? p.poly : [[p.x0, p.y0], [p.x1, p.y1]]; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const q of bb) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); } const z = (p.z !== undefined ? p.z : Math.min(p.z0, p.z1)); const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 2, 26, y1 - y0 + 2), badMat); m.position.copy(W((x0 + x1) / 2, (y0 + y1) / 2, z + 12)); bad.add(m); }
      world.add(bad);
      const labels = new THREE.Group(); labels.name = 'labels';
      for (const L of site.labels) { const sp = labelSprite(L.text, L.lost); sp.position.copy(W(L.x, L.y, L.z)); labels.add(sp); }
      labels.visible = P.labels; world.add(labels);
      scene.add(world);
      let verts = 0, tris = 0; world.traverse(o => { if (o.isMesh && o.geometry) { const g = o.geometry, c = g.attributes.position.count, inst = o.isInstancedMesh ? o.count : 1; verts += c * inst; tris += (g.index ? g.index.count / 3 : c / 3) * inst; } });
      state.site = site; state.auditResult = A; state.signature = site.signature(); state.stats = { verts, tris: Math.round(tris), buildMs: Math.round(site.ms), sceneMs: Math.round(performance.now() - t0), parts: site.parts.length, trees: site.trees.length, dobei: site.dobei.length, lostPlaced: site.lostPlaced.length, lostSkipped: site.lostSkipped };
      showAudit(A); showStats();
      requestRender();
    }

    // ---------- 界面 ----------
    function showAudit(A) {
      const el = $('audit'); const ok = A.total === 0;
      let h = `<div class="ah ${ok ? 'ok' : 'ng'}">硬规则审计：${ok ? '全部通过 ✓' : A.total + ' 项违规'}</div><table>`;
      for (const r of A.rules) h += `<tr class="${A.cnt[r.id] ? 'ng' : ''}"><td>${r.id}</td><td>${r.name}</td><td>${A.cnt[r.id]}</td></tr>`;
      h += '</table>'; if (!ok) h += '<div class="items">' + A.items.slice(0, 12).map(it => `<div>${it.rule} · ${it.name}：${it.msg}</div>`).join('') + '</div>';
      el.innerHTML = h;
    }
    function showStats() { const s = state.stats; $('stats').textContent = `${(s.verts / 1e3).toFixed(0)}k 顶点 · ${(s.tris / 1e3).toFixed(0)}k 三角形 · ${s.parts} 部件 · ${s.trees} 树 · 生成 ${s.buildMs} ms · 场景 ${s.sceneMs} ms`; }
    const VIEWS = { // 世界坐标：相机位置 → 目标
      aerial: [[-560, -700, 430], [-20, -60, 0]],
      top: [[0, -60, 1650], [0, -59.9, 0]],
      otemon: [[-345, -268, 9], [-262, -255, 9]],
      tenshu: [[40, -150, 22], [0, 0, 40]],
      eastwall: [[172, -70, -4], [120, 40, 12]],
    };
    let anim = null;
    function setView(name, instant) {
      const v = VIEWS[name] || VIEWS.aerial; P.view = name; writeHash(P);
      const to = W(...v[0]), tt = W(...v[1]);
      if (instant) { camera.position.copy(to); controls.target.copy(tt); controls.update(); requestRender(); return; }
      anim = { f: camera.position.clone(), ft: controls.target.clone(), t: to, tt, s: performance.now() }; requestRender();
      document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.v === name));
    }
    let need = true; function requestRender() { need = true; }
    controls.addEventListener('change', requestRender);
    addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); requestRender(); });
    renderer.setAnimationLoop(now => {
      if (anim) { const k = Math.min(1, (now - anim.s) / 1300), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; camera.position.lerpVectors(anim.f, anim.t, e); controls.target.lerpVectors(anim.ft, anim.tt, e); if (k >= 1) anim = null; need = true; }
      if (controls.update()) need = true;
      if (need) { renderer.render(scene, camera); need = false; state.frames = (state.frames || 0) + 1; }
    });
    document.querySelectorAll('#views button').forEach(b => b.onclick = () => setView(b.dataset.v));
    $('labels').checked = P.labels; $('labels').onchange = e => { P.labels = e.target.checked; writeHash(P); const l = world.getObjectByName('labels'); if (l) l.visible = P.labels; requestRender(); };
    $('lost').checked = P.lost; $('lost').onchange = e => { P.lost = e.target.checked; writeHash(P); $('era').textContent = P.lost ? '江戸盛期（含失传橹）' : '现状'; buildWorld(P); };
    $('era').textContent = P.lost ? '江戸盛期（含失传橹）' : '现状';
    $('seed').value = P.seed; $('seed').onchange = e => { P.seed = Math.max(1, +e.target.value | 0); writeHash(P); buildWorld(P); };
    $('hide').onclick = () => $('ui').classList.toggle('min');

    buildWorld(P); setView(P.view, true);
    state.THREE = THREE; state.scene = scene; state.camera = camera; state.renderer = renderer;
    state.setView = (v) => setView(v, true);
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
