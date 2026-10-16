'use strict';
// 丰臣式天守（黑漆壁 + 金箔瓦），由 osaka/osaka_castle_tenshu.html 的程序化建模移植成模块。
// CASTLE_TENSHU.build(THREE, {maxAniso, seed, baseH}) -> THREE.Group：原点=天守台底面中心（本丸地面），y 向上，正面朝 +z。
(function (G) {
function build(THREE, opts) {
opts = opts || {};
const maxAniso = opts.maxAniso || 4;
let _s = (opts.seed || 7) >>> 0; const rand = () => { _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ _s >>> 15, 1 | _s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const islandTop = 0;
// ---------- canvas textures ----------
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}
function rnd(a, b) { return a + rand() * (b - a); }

const tileTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#2c3138'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 16) {           // 丸瓦 rows
    const grd = g.createLinearGradient(x, 0, x + 16, 0);
    grd.addColorStop(0, '#1d2127'); grd.addColorStop(0.45, '#4a515a'); grd.addColorStop(1, '#1d2127');
    g.fillStyle = grd; g.fillRect(x + 2, 0, 9, h);
  }
  for (let y = 0; y < h; y += 32) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, y, w, 2); }
}, true);

const stoneTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#6d6a62'; g.fillRect(0, 0, w, h);
  let y = 0;
  while (y < h) {
    const rh = rnd(26, 52); let x = -rnd(0, 40);
    while (x < w) {
      const rw = rnd(40, 110); const s = rnd(95, 165) | 0;
      g.fillStyle = `rgb(${s},${s - 4},${s - 12})`;
      g.beginPath();
      g.moveTo(x + rnd(1, 5), y + rnd(1, 5)); g.lineTo(x + rw - rnd(1, 5), y + rnd(1, 5));
      g.lineTo(x + rw - rnd(1, 5), y + rh - rnd(1, 5)); g.lineTo(x + rnd(1, 5), y + rh - rnd(1, 5));
      g.closePath(); g.fill();
      for (let k = 0; k < 25; k++) { g.fillStyle = `rgba(0,0,0,${rnd(0, .12)})`; g.fillRect(x + rnd(0, rw), y + rnd(0, rh), rnd(2, 8), rnd(2, 8)); }
      x += rw;
    }
    y += rh;
  }
}, true);

// 黑漆板壁 + 窗 + 金饰
function wallTex(wU, hU, visU, nWin, top) {
  const W = 1024, H = Math.max(256, Math.min(1024, Math.round(W * hU / wU)));
  return canvasTex(W, H, (g) => {
    g.fillStyle = '#111013'; g.fillRect(0, 0, W, H);
    const board = W / (wU / 0.55);
    for (let x = 0; x < W; x += board) { g.fillStyle = '#1c1b20'; g.fillRect(x, 0, 2, H); }
    for (let y = 0; y < H; y += H / (hU / 0.35)) { g.fillStyle = 'rgba(255,255,255,.025)'; g.fillRect(0, y, W, 1); }
    const v0 = 0, v1 = H * visU / hU;          // visible band (top of canvas = top of wall)
    // gold nageshi bands
    const gold = (y, t) => { const gr = g.createLinearGradient(0, y, 0, y + t); gr.addColorStop(0, '#f6dc7a'); gr.addColorStop(.5, '#b8861e'); gr.addColorStop(1, '#f1d06a'); g.fillStyle = gr; g.fillRect(0, y, W, t); };
    gold(v1 * 0.06, H * 0.012 + 3);
    gold(v1 * 0.93, H * 0.012 + 3);
    // gold fittings on bands
    for (let x = board / 2; x < W; x += board * 2) { g.fillStyle = '#f2cf63'; g.beginPath(); g.arc(x, v1 * 0.06 + H * .006 + 1, 4, 0, 7); g.fill(); }
    if (top) {
      // 金地绘：鹤与虎的抽象纹样（顶层）
      const pw = W / (nWin * 2 + 1);
      for (let i = 0; i <= nWin * 2; i += 2) {
        const x = i * pw + pw * 0.12, y = v1 * 0.18, w = pw * 0.76, h = v1 * 0.66;
        const gr = g.createLinearGradient(x, y, x + w, y + h); gr.addColorStop(0, '#f7df86'); gr.addColorStop(1, '#a87818');
        g.fillStyle = gr; g.fillRect(x, y, w, h);
        g.strokeStyle = '#3b2a08'; g.lineWidth = 3;
        if ((i / 2) % 2 === 0) { // crane
          g.beginPath(); g.ellipse(x + w * .5, y + h * .55, w * .22, h * .12, -.3, 0, 7); g.stroke();
          g.beginPath(); g.moveTo(x + w * .66, y + h * .48); g.quadraticCurveTo(x + w * .8, y + h * .2, x + w * .7, y + h * .15); g.stroke();
          g.beginPath(); g.moveTo(x + w * .4, y + h * .5); g.quadraticCurveTo(x + w * .15, y + h * .2, x + w * .1, y + h * .35); g.stroke();
          g.beginPath(); g.moveTo(x + w * .5, y + h * .66); g.lineTo(x + w * .46, y + h * .9); g.moveTo(x + w * .55, y + h * .66); g.lineTo(x + w * .56, y + h * .9); g.stroke();
        } else { // tiger stripes
          g.beginPath(); g.ellipse(x + w * .5, y + h * .55, w * .3, h * .14, 0, 0, 7); g.stroke();
          g.beginPath(); g.arc(x + w * .22, y + h * .42, w * .09, 0, 7); g.stroke();
          for (let s = 0; s < 4; s++) { g.beginPath(); g.moveTo(x + w * (.38 + s * .08), y + h * .43); g.lineTo(x + w * (.42 + s * .08), y + h * .62); g.stroke(); }
          g.beginPath(); g.moveTo(x + w * .8, y + h * .55); g.quadraticCurveTo(x + w * .95, y + h * .3, x + w * .85, y + h * .25); g.stroke();
        }
      }
      for (let i = 1; i < nWin * 2; i += 2) drawWin(i * pw + pw * 0.15, v1 * 0.25, pw * 0.7, v1 * 0.5);
    } else {
      const gap = W / nWin;
      for (let i = 0; i < nWin; i++) drawWin(i * gap + gap * 0.28, v1 * 0.3, gap * 0.44, v1 * 0.42);
    }
    function drawWin(x, y, w, h) {
      g.fillStyle = '#2d2a26'; g.fillRect(x - 6, y - 6, w + 12, h + 12);
      g.fillStyle = '#050506'; g.fillRect(x, y, w, h);
      g.fillStyle = '#3e3a34';
      const n = Math.max(4, Math.round(w / 16));
      for (let k = 1; k < n; k++) g.fillRect(x + k * w / n - 2, y, 4, h);
      g.fillStyle = '#e8c35a';
      [[x - 6, y - 6], [x + w, y - 6], [x - 6, y + h], [x + w, y + h]].forEach(([a, b]) => g.fillRect(a, b, 6, 6));
    }
  });
}

const gableTex = canvasTex(512, 256, (g, w, h) => {
  g.fillStyle = '#121114'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#2a2830'; g.lineWidth = 2;
  for (let y = 0; y < h; y += 14) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  // 懸魚 gold ornament near apex
  const cx = w / 2, cy = h * 0.32;
  const gr = g.createRadialGradient(cx, cy, 2, cx, cy, 60); gr.addColorStop(0, '#fff0a8'); gr.addColorStop(1, '#a8781a');
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(cx, cy - 26); g.bezierCurveTo(cx + 55, cy - 10, cx + 30, cy + 50, cx, cy + 62); g.bezierCurveTo(cx - 30, cy + 50, cx - 55, cy - 10, cx, cy - 26); g.fill();
  g.fillStyle = '#5b3f09'; g.beginPath(); g.arc(cx, cy + 14, 9, 0, 7); g.fill();
  g.fillStyle = '#e8c35a';
  for (let i = -3; i <= 3; i++) { g.beginPath(); g.arc(cx + i * 46, h * 0.9, 5, 0, 7); g.fill(); }
});

// ---------- materials ----------
const M = {
  tile: new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide, envMapIntensity: 0.6 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xe0ad3a, metalness: 1, roughness: 0.28, envMapIntensity: 1.4 }),
  ridge: new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.6, metalness: 0.2 }),
  stone: new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.95, side: THREE.DoubleSide }),
  lacquer: new THREE.MeshStandardMaterial({ color: 0x141215, roughness: 0.35, metalness: 0.1 }),
  rail: new THREE.MeshStandardMaterial({ color: 0x1b1516, roughness: 0.4 }),
  gable: new THREE.MeshStandardMaterial({ map: gableTex, roughness: 0.4, side: THREE.DoubleSide }),
  plaster: new THREE.MeshStandardMaterial({ color: 0xece6d8, roughness: 0.9 }),
};

const castle = new THREE.Group();
function add(mesh, parent = castle, cast = true, recv = true) { mesh.castShadow = cast; mesh.receiveShadow = recv; parent.add(mesh); return mesh; }

// ---------- roof skirt (curved, upturned corners) ----------
// outer rect (ow,od) at y=0 -> inner rect (iw,id) at y=rise
function rectCorners(w, d) { return [[-w / 2, d / 2], [w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]]; }
function skirt(ow, od, iw, id, rise, { pow = 1.45, up = 0, segU = 40, segT = 18, uvScale = 1.2 } = {}) {
  const O = rectCorners(ow, od), I = rectCorners(iw, id);
  const pos = [], uv = [], idx = [];
  const P = (s, u, t) => {
    const a = O[s], b = O[(s + 1) % 4], c = I[s], e = I[(s + 1) % 4];
    const ox = a[0] + (b[0] - a[0]) * u, oz = a[1] + (b[1] - a[1]) * u;
    const ix = c[0] + (e[0] - c[0]) * u, iz = c[1] + (e[1] - c[1]) * u;
    const corner = Math.pow(Math.abs(2 * u - 1), 5);
    const y = rise * Math.pow(t, pow) + up * Math.pow(1 - t, 2) * corner;
    // corners also flare outward a bit
    const flare = up * 0.35 * Math.pow(1 - t, 2) * corner;
    const dx = Math.sign(ox) * flare, dz = Math.sign(oz) * flare;
    return [ox + (ix - ox) * t + dx, y, oz + (iz - oz) * t + dz];
  };
  for (let s = 0; s < 4; s++) {
    const len = (s % 2 === 0) ? ow : od;
    const base = pos.length / 3;
    for (let j = 0; j <= segT; j++) for (let i = 0; i <= segU; i++) {
      const u = i / segU, t = j / segT;
      pos.push(...P(s, u, t));
      uv.push(u * len / uvScale, t * rise * 1.4 / uvScale);
    }
    for (let j = 0; j < segT; j++) for (let i = 0; i < segU; i++) {
      const a = base + j * (segU + 1) + i, b = a + 1, c = a + segU + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  // eave edge + hip curves
  const eave = [];
  for (let s = 0; s < 4; s++) for (let i = 0; i < segU; i++) eave.push(new THREE.Vector3(...P(s, i / segU, 0)));
  const hips = [];
  for (let s = 0; s < 4; s++) { const pts = []; for (let j = 0; j <= segT; j++) pts.push(new THREE.Vector3(...P(s, 0, j / segT))); hips.push(pts); }
  return { geo, eave, hips, P };
}

function tube(points, r, mat, closed = false, parent = castle) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.2);
  return add(new THREE.Mesh(new THREE.TubeGeometry(curve, points.length * 3, r, 8, closed), mat), parent);
}

function roof(y, ow, od, iw, id, rise, up) {
  const g = new THREE.Group(); g.position.y = y; castle.add(g);
  const s = skirt(ow, od, iw, id, rise, { up });
  add(new THREE.Mesh(s.geo, M.tile), g);
  // underside (soffit) slightly below, dark wood
  const s2 = skirt(ow - 0.2, od - 0.2, iw, id, rise - 0.35, { up });
  const soffit = add(new THREE.Mesh(s2.geo, new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: .8, side: THREE.DoubleSide })), g, false, true);
  soffit.position.y = -0.35;
  tube(s.eave, 0.2, M.gold, true, g);                 // 金箔瓦 eave
  s.hips.forEach(h => tube(h, 0.22, M.ridge, false, g)); // 隅棟
  s.hips.forEach(h => { const e = add(new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), M.gold), g); e.position.copy(h[0]); }); // gold onigawara
  return { group: g, P: s.P };
}

// 千鳥破風: gable facing +z in local coords
function chidori(parent, x, y, z, rotY, W, H, L) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; parent.add(g);
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-W / 2, 0, 0, W / 2, 0, 0, 0, H, 0], 3));
  tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, .5, 1], 2));
  tri.computeVertexNormals();
  add(new THREE.Mesh(tri, M.gable), g);
  const ov = 0.6, f = 0.5;
  const quad = (a, b, c, d) => {
    const q = new THREE.BufferGeometry();
    q.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
    q.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
    q.computeVertexNormals(); add(new THREE.Mesh(q, M.tile), g);
  };
  const lowL = [-W / 2 - ov, -0.35, f], lowR = [W / 2 + ov, -0.35, f], apF = [0, H + 0.25, f], apB = [0, H + 0.25, -L];
  quad(lowL, apF, apB, [-W / 2 - ov, -0.35, -L]);
  quad(apF, lowR, [W / 2 + ov, -0.35, -L], apB);
  // gold bargeboards
  tube([new THREE.Vector3(...lowL).add(new THREE.Vector3(0, -.1, .05)), new THREE.Vector3(-W / 4, H / 2 + .05, f + .05), new THREE.Vector3(...apF).add(new THREE.Vector3(0, -.1, .05))], 0.16, M.gold, false, g);
  tube([new THREE.Vector3(...apF).add(new THREE.Vector3(0, -.1, .05)), new THREE.Vector3(W / 4, H / 2 + .05, f + .05), new THREE.Vector3(...lowR).add(new THREE.Vector3(0, -.1, .05))], 0.16, M.gold, false, g);
  const r = tube([new THREE.Vector3(0, H + .3, f + .1), new THREE.Vector3(0, H + .3, -L / 2), new THREE.Vector3(0, H + .3, -L)], 0.2, M.ridge, false, g);
  return g;
}

// 唐破風: curved cusped gable facing +z
function karahafu(parent, x, y, z, rotY, W, H, L) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; parent.add(g);
  const prof = (s) => { const a = Math.abs(s); return H * (1 - a * a) * (0.75 + 0.25 * Math.cos(a * Math.PI)) + (a > 0.85 ? (a - 0.85) * 2 : 0); }; // s in [-1,1]
  const N = 30, pos = [], uv = [], idx = [];
  for (let j = 0; j <= 1; j++) for (let i = 0; i <= N; i++) {
    const s = -1 + 2 * i / N; pos.push(s * (W / 2 + .5), prof(s), j ? -L : 0.6); uv.push(i / N * 4, j * 2);
  }
  for (let i = 0; i < N; i++) idx.push(i, i + 1, i + N + 1, i + 1, i + N + 2, i + N + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
  add(new THREE.Mesh(geo, M.tile), g);
  const front = []; for (let i = 0; i <= N; i++) { const s = -1 + 2 * i / N; front.push(new THREE.Vector3(s * (W / 2 + .5), prof(s) - .08, .62)); }
  tube(front, 0.2, M.gold, false, g);
  // gable face under the curve
  const shape = new THREE.Shape(); shape.moveTo(-W / 2, -0.4);
  for (let i = 0; i <= N; i++) { const s = -1 + 2 * i / N; shape.lineTo(s * W / 2, prof(s) - 0.15); }
  shape.lineTo(W / 2, -0.4); shape.closePath();
  const sg = new THREE.ShapeGeometry(shape); const uvs = sg.attributes.uv;
  for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) / W + .5, (uvs.getY(i) + .4) / (H + .4));
  const face = add(new THREE.Mesh(sg, M.gable), g); face.position.z = 0.2;
  return g;
}

function shachi(x, y, z, flip, parent) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
  const body = add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), M.gold), g); body.scale.set(0.9, 1.5, 0.7);
  const head = add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), M.gold), g); head.position.set(0, 0.2, 0); head.scale.set(1.3, 1, 0.8); head.position.x = flip * -0.35;
  const tail = add(new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.3, 4), M.gold), g); tail.position.set(flip * 0.35, 1.2, 0); tail.rotation.z = flip * 0.5;
  const fin = add(new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 4), M.gold), g); fin.position.set(flip * 0.6, 1.75, 0); fin.rotation.z = flip * -1.2;
  return g;
}

// tenshu stone base (天守台 ishigaki)
const baseH = opts.baseH || 13;
{
  const s = skirt(40, 36, 30, 26, baseH, { pow: 1.7, segU: 30, segT: 24, uvScale: 5 });
  const m = add(new THREE.Mesh(s.geo, M.stone)); m.position.y = islandTop;
  const cap = add(new THREE.Mesh(new THREE.BoxGeometry(30.2, 0.6, 26.2), M.stone)); cap.position.y = islandTop + baseH;
}
// ---------- tenshu tiers ----------
// v: visible wall height; rise: roof rise; ov: eave overhang; up: corner upturn
const tiers = [
  { w: 28, d: 24, v: 8.0, ov: 3.4, rise: 4.2, up: 1.3, win: 7 },
  { w: 23, d: 19.5, v: 4.6, ov: 3.0, rise: 3.8, up: 1.2, win: 6 },
  { w: 19, d: 16, v: 4.3, ov: 2.8, rise: 3.4, up: 1.1, win: 5 },
  { w: 15.5, d: 13, v: 4.0, ov: 2.6, rise: 3.0, up: 1.0, win: 4 },
  { w: 12, d: 10, v: 5.2, ov: 2.6, rise: 2.8, up: 1.0, win: 3, top: true },
];
let y = islandTop + baseH + 0.3;
let prevRise = 0;
const roofs = [];
tiers.forEach((t, i) => {
  const h = t.v + prevRise + 0.4;
  const wallY0 = y - prevRise - 0.4;
  const texW = wallTex(t.w, h, t.v, t.win, t.top), texD = wallTex(t.d, h, t.v, Math.max(2, t.win - 1), t.top);
  const mw = new THREE.MeshStandardMaterial({ map: texW, roughness: 0.45, metalness: 0.05 });
  const md = new THREE.MeshStandardMaterial({ map: texD, roughness: 0.45, metalness: 0.05 });
  const wall = add(new THREE.Mesh(new THREE.BoxGeometry(t.w, h, t.d), [md, md, M.lacquer, M.lacquer, mw, mw]));
  wall.position.y = wallY0 + h / 2;
  // gold corner posts
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const p = add(new THREE.Mesh(new THREE.BoxGeometry(0.35, t.v, 0.35), M.gold)); p.position.set(sx * t.w / 2, y + t.v / 2, sz * t.d / 2);
  }
  if (t.top) {
    // 回縁 balcony with railing
    const slab = add(new THREE.Mesh(new THREE.BoxGeometry(t.w + 2.6, 0.35, t.d + 2.6), M.lacquer)); slab.position.y = y + 0.1;
    const W2 = t.w + 2.4, D2 = t.d + 2.4, rh = 1.1;
    const railMat = M.rail;
    for (const [lx, lz, len, rot] of [[0, D2 / 2, W2, 0], [0, -D2 / 2, W2, 0], [W2 / 2, 0, D2, Math.PI / 2], [-W2 / 2, 0, D2, Math.PI / 2]]) {
      const top = add(new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, 0.14), railMat)); top.position.set(lx, y + 0.3 + rh, lz); top.rotation.y = rot;
      const mid = add(new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.1), railMat)); mid.position.set(lx, y + 0.3 + rh * 0.5, lz); mid.rotation.y = rot;
      const n = Math.round(len / 1.3);
      for (let k = 0; k <= n; k++) {
        const off = -len / 2 + k * len / n;
        const post = add(new THREE.Mesh(new THREE.BoxGeometry(0.16, rh, 0.16), railMat));
        const cap = add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), M.gold));
        if (rot === 0) { post.position.set(off, y + 0.3 + rh / 2, lz); cap.position.set(off, y + 0.4 + rh, lz); }
        else { post.position.set(lx, y + 0.3 + rh / 2, off); cap.position.set(lx, y + 0.4 + rh, off); }
      }
    }
  }
  const yTop = y + t.v;
  const next = tiers[i + 1];
  const eaveY = yTop - 0.45;
  if (next) {
    const r = roof(eaveY, t.w + 2 * t.ov, t.d + 2 * t.ov, next.w - 0.2, next.d - 0.2, t.rise + 0.45, t.up);
    roofs.push({ ...r, t, eaveY, ow: t.w + 2 * t.ov, od: t.d + 2 * t.ov, iw: next.w - 0.2, id: next.d - 0.2, rise: t.rise + 0.45 });
    prevRise = t.rise;
    y = yTop + t.rise + 0.45 - 0.0;
    y = eaveY + t.rise + 0.45;
  } else {
    // top: irimoya roof (hip below, gable above)
    const ow = t.w + 2 * t.ov, od = t.d + 2 * t.ov, iw = t.w * 0.62, id = t.d * 0.42, rise = t.rise;
    const r = roof(eaveY, ow, od, iw, id, rise, t.up);
    const gy = eaveY + rise, gh = 2.9, ext = 0.9;
    const g = new THREE.Group(); g.position.y = gy; castle.add(g);
    const quad = (pts, mat) => { const q = new THREE.BufferGeometry(); q.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3)); q.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 6, 0, 6, 3, 0, 0, 6, 3, 0, 3], 2)); q.computeVertexNormals(); return add(new THREE.Mesh(q, mat), g); };
    const xa = -iw / 2 - ext, xb = iw / 2 + ext, zf = id / 2 + 0.3;
    quad([[xa, -0.2, zf], [xb, -0.2, zf], [xb, gh, 0], [xa, -0.2, zf], [xb, gh, 0], [xa, gh, 0]], M.tile);
    quad([[xb, -0.2, -zf], [xa, -0.2, -zf], [xa, gh, 0], [xb, -0.2, -zf], [xa, gh, 0], [xb, gh, 0]], M.tile);
    for (const sx of [-1, 1]) {
      const tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.Float32BufferAttribute([sx * iw / 2, 0, id / 2, sx * iw / 2, 0, -id / 2, sx * iw / 2, gh - 0.1, 0], 3));
      tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, .5, 1], 2)); tri.computeVertexNormals();
      add(new THREE.Mesh(tri, M.gable), g);
      tube([new THREE.Vector3(sx * (iw / 2 + ext), -0.25, zf), new THREE.Vector3(sx * (iw / 2 + ext), gh * .5, zf / 2), new THREE.Vector3(sx * (iw / 2 + ext), gh + .05, 0), new THREE.Vector3(sx * (iw / 2 + ext), gh * .5, -zf / 2), new THREE.Vector3(sx * (iw / 2 + ext), -0.25, -zf)], 0.17, M.gold, false, g);
    }
    tube([new THREE.Vector3(xa, -0.2, zf), new THREE.Vector3(xb, -0.2, zf)], 0.16, M.gold, false, g);
    tube([new THREE.Vector3(xa, -0.2, -zf), new THREE.Vector3(xb, -0.2, -zf)], 0.16, M.gold, false, g);
    const ridge = add(new THREE.Mesh(new THREE.BoxGeometry(xb - xa + 0.6, 0.6, 0.6), M.ridge), g); ridge.position.y = gh + 0.15;
    const rg = add(new THREE.Mesh(new THREE.BoxGeometry(xb - xa + 0.62, 0.12, 0.64), M.gold), g); rg.position.y = gh + 0.48;
    shachi(xa - 0.1, gh + 0.5, 0, -1, g);
    shachi(xb + 0.1, gh + 0.5, 0, 1, g);
    // 唐破風 on front of top roof
    const P = r.P; const tt = 0.38; const p = P(0, 0.5, tt);
    karahafu(r.group, 0, p[1] - 0.2, p[2] + 0.3, 0, 4.2, 1.6, 2.2);
  }
});

// gables on lower roofs: [roofIndex, side(0 front,1 right,2 back,3 left), t, W, H, kind]
const gabs = [
  [0, 0, 0.42, 9.0, 3.2, 'c'], [0, 2, 0.42, 9.0, 3.2, 'c'],
  [0, 1, 0.45, 5.0, 2.6, 'c'], [0, 3, 0.45, 5.0, 2.6, 'c'],
  [1, 0, 0.4, 5.5, 1.9, 'k'], [1, 2, 0.4, 5.5, 1.9, 'k'],
  [1, 1, 0.42, 6.5, 2.8, 'c'], [1, 3, 0.42, 6.5, 2.8, 'c'],
  [2, 0, 0.42, 6.0, 2.6, 'c'], [2, 2, 0.42, 6.0, 2.6, 'c'],
  [3, 1, 0.45, 4.2, 2.1, 'c'], [3, 3, 0.45, 4.2, 2.1, 'c'],
];
const rotForSide = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
gabs.forEach(([ri, side, t, W, H, kind]) => {
  const r = roofs[ri]; const p = r.P(side, 0.5, t);
  const fn = kind === 'k' ? karahafu : chidori;
  fn(r.group, p[0], p[1] - 0.15, p[2], rotForSide[side], W, H, 4.5);
});


castle.userData.materials = M;
return castle;
}
G.CASTLE_TENSHU = { build };
})(typeof window !== 'undefined' ? window : globalThis);
