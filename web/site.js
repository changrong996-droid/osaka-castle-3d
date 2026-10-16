'use strict';
// ===== 大阪城 全城：规则驱动的场地生成 + 自检（纯数据，不依赖 three.js；node 里也能跑） =====
// 坐标：本地米制，原点=天守，x 向东，y 向北，z 向上（渲染时换成 three 的 x,z,-y）。
// 思路（借鉴 castle-town-sim/scene.js）：
//   1) 一张高度网格，按顺序执行“操作”：台地填充 → 石垣扇勾配 → 建筑/墙体地基整平(settle) → 土桥坡道；水面格只允许被土桥改动。
//   2) 所有部件都用“引用”定位：门挂在曲轮边上（建筑名/遗址点/方向最远点 → 最近边），坡道=“从门 X 到曲轮 Y”（沿边外法线射线求终点），
//      土塀=“沿本丸/二之丸每条石垣顶边内缩 1.5 m，在门/坡道/橹/建筑处留口”，失传橹=遗址点吸附到最近边角。
//   3) audit()：硬规则 H1..H10，逐项计数 + 每个违规给出信息，并把违规部件标红。
(function (G) {
  const D = G.CASTLE_DATA;

  // ---------------- 声明式场地规格 ----------------
  const SPEC = {
    version: 'web-r1',
    levels: { water: -7, dry: -5, city: 0, ninomaru: 4, honmaru: 14 },   // 与 data/terrain.json 的 elev 一致（估值）
    WZ: -6,                                                              // 水面
    grid: { x0: -540, x1: 540, y0: -600, y1: 420, cell: 1.5 },
    regionPriority: ['honmaru', 'dry', 'ninomaru', 'city'],
    ishigaki: { ratio: 0.22, maxRun: 6, minDrop: 1.5 },                 // 扇勾配：水平退 0.22×高，最多 6 m；多边形边=墙脚，墙顶内缩
    dobei: { regions: ['honmaru', 'ninomaru'], inset: 1.5, h: 2.2, t: 0.6, gapPad: 1.5, minLen: 2.5, maxPiece: 18 },
    // 门：at = {building: 名} | {point: 遗址点名} | {extreme: [dx,dy]}（该曲轮在此方向最远的边界点）
    gates: [
      { id: 'sakuramon', name: '桜門', at: { building: '桜門' }, region: 'honmaru', to: 'ninomaru', via: 'dobashi', width: 10, masugata: { size: 24, inner: 'yaguramon', innerName: '鉄門' } },
      { id: 'gokuraku', name: '極楽橋', at: { extreme: [0, 1] }, region: 'honmaru', to: 'ninomaru', via: 'bridge', width: 6, size: [8, 5] },
      { id: 'honW', name: '西土橋(推定)', at: { near: [-121, -90] }, region: 'honmaru', to: 'ninomaru', via: 'dobashi', width: 10, size: [8, 5] },
      { id: 'honE', name: '東橋(推定)', at: { extreme: [1, 0] }, region: 'honmaru', to: 'ninomaru', via: 'bridge', width: 6, size: [8, 5] },
      { id: 'otemon', name: '大手門', at: { building: '大手門' }, region: 'ninomaru', to: 'city', via: 'dobashi', width: 12, neck: true, masugata: { size: 24, inner: 'building', innerName: '多門櫓' } },
      { id: 'aoyamon', name: '青屋門', at: { building: '青屋門' }, region: 'ninomaru', to: 'city', via: 'dobashi', width: 10, neck: true },
      { id: 'kyobashi', name: '京橋口', at: { point: '京橋口' }, region: 'ninomaru', to: 'city', via: 'dobashi', width: 12, size: [10, 6], neck: true, masugata: { size: 24, inner: 'yaguramon', innerName: '京橋口二の門' } },
      { id: 'tamatsukuri', name: '玉造口', at: { point: '玉造口' }, region: 'ninomaru', to: 'city', via: 'dobashi', width: 12, size: [10, 6], neck: true },
      { id: 'kitashikiri', name: '北仕切門', at: { building: '北仕切門' }, region: 'ninomaru', to: null, internal: true },
    ],
    ramp: { maxLen: 170, sideSlope: 0.3, landing: 2.5, maxGrade: 0.3, endIn: 1.5, neckGrade: 0.08 },
    // 外堀外侧的一圈土地在 OSM 里与二之丸连成一片（土桥=陆地窄颈）。规则：在每个 neck 门处找最窄的横截线（颈），
    // 从二之丸内部种子洪泛，过不了颈的二之丸格点都归为“城下”(city, 0 m)。
    band: { seed: { building: '豊国神社' }, neckSearch: 30, chordMax: 70 },
    yagura: { cornerTurnDeg: 35, cornerRadius: 22, snapRadius: 20, setback: 1.2, honmaru: { fam: 'yagura3', w: 13, d: 11 }, ninomaru: { fam: 'yagura2', w: 12, d: 10 } },
    trees: { counts: { ninomaru: 1100, honmaru: 140 }, minSpacing: 5, clearBuild: 5, clearEdge: 7, lawn: { hull: ['乾櫓', '坤櫓跡', '千貫櫓', '北仕切門'] } },
  };

  // ---------------- 小工具 ----------------
  const rng32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ringArea = r => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  const inRing = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = clamp(t, 0, 1); return Math.hypot(px - ax - t * dx, py - ay - t * dy); }
  const segT = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; return l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; };
  function rectPoly(cx, cy, w, d, ang, m) { m = m || 0; const c = Math.cos(ang), s = Math.sin(ang), hw = w / 2 + m, hd = d / 2 + m; return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [cx + u * c - v * s, cy + u * s + v * c]); }
  function segPoly(x0, y0, x1, y1, t, m) { const L = Math.hypot(x1 - x0, y1 - y0) || 1e-6; return rectPoly((x0 + x1) / 2, (y0 + y1) / 2, L + 2 * (m || 0), t + 2 * (m || 0), Math.atan2(y1 - y0, x1 - x0)); }
  const inPoly = (x, y, P) => inRing(x, y, P);
  function polyDist(x, y, P) { let d = 1e9; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; d = Math.min(d, segDist(x, y, a[0], a[1], b[0], b[1])); } return inPoly(x, y, P) ? -d : d; }
  function segsCross(a, b, c, d) { const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d); return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 * d2 < 0 && d3 * d4 < 0; }
  function polysOverlap(A, B) { // 一般多边形（可凹）是否有面积重叠：边相交或一方顶点在另一方内
    for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) if (segsCross(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return true;
    if (inPoly(A[0][0], A[0][1], B)) return true; if (inPoly(B[0][0], B[0][1], A)) return true;
    let cx = 0, cy = 0; for (const p of A) { cx += p[0]; cy += p[1]; } cx /= A.length; cy /= A.length; if (inPoly(cx, cy, A) && inPoly(cx, cy, B)) return true;
    return false;
  }
  const bboxOf = P => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const p of P) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); } return [a, b, c, d]; };
  const bbHit = (A, B, m) => !(A[2] + m < B[0] || B[2] + m < A[0] || A[3] + m < B[1] || B[3] + m < A[1]);
  function shrink(P, m) { let cx = 0, cy = 0; for (const p of P) { cx += p[0]; cy += p[1]; } cx /= P.length; cy /= P.length; return P.map(p => { const dx = p[0] - cx, dy = p[1] - cy, L = Math.hypot(dx, dy) || 1; return [p[0] - dx / L * m, p[1] - dy / L * m]; }); }
  function hull(pts) { const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up = []; for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); } for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); } up.pop(); lo.pop(); return lo.concat(up); }
  function triOverlapPoly(T, P, Pbb) { const tb = bboxOf(T); if (!bbHit(tb, Pbb, 0)) return false; return polysOverlap(T, P); }

  // ---------------- 主生成 ----------------
  function build(opt) {
    opt = Object.assign({ seed: 1, lost: true, cell: SPEC.grid.cell }, opt || {});
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const L = SPEC.levels, BED = L.water, WZ = SPEC.WZ, IG = SPEC.ishigaki;
    const S = { spec: SPEC, opt, parts: [], gates: [], ramps: [], notes: [], labels: [] };
    const addPart = p => { p.id = S.parts.length; S.parts.push(p); return p; };

    // ---- 曲轮（区域）----
    const R = D.regions.map((r, i) => {
      const rings = [r.outer].concat(r.holes || []);
      return { i, name: r.name, z: L[r.name], rings, bb: bboxOf(r.outer), area: r.area, edges: [] };
    });
    const prio = n => SPEC.regionPriority.indexOf(n);
    const order = R.slice().sort((a, b) => prio(a.name) - prio(b.name));
    let zoneRef = null;
    const inPolyReg = (g, x, y) => x >= g.bb[0] && x <= g.bb[2] && y >= g.bb[1] && y <= g.bb[3] && inRing(x, y, g.rings[0]) && !g.rings.slice(1).some(h => inRing(x, y, h));
    const inReg = (g, x, y) => g.band ? (zoneRef && zoneRef(x, y) === g) : (inPolyReg(g, x, y) && !(zoneRef && g.name === 'ninomaru' && zoneRef(x, y) !== g));
    const regionAt = (x, y) => { for (const g of order) if (inPolyReg(g, x, y)) return g; return null; };
    const levelAt = (x, y) => { const g = regionAt(x, y); return g ? g.z : BED; };
    for (const g of R) g.rings.forEach((ring, ri) => {
      const n = ring.length, sg = (ringArea(ring) > 0 ? 1 : -1) * (ri === 0 ? 1 : -1);
      for (let i = 0; i < n; i++) {
        const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % n], len = Math.hypot(bx - ax, by - ay); if (len < 1e-6) continue;
        const tx = (bx - ax) / len, ty = (by - ay) / len, nx = sg * ty, ny = -sg * tx; // n = 外法线（指向曲轮外）
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        let zl = levelAt(mx + nx * 1.2, my + ny * 1.2); const drop = g.z - zl;
        const B = drop >= IG.minDrop ? Math.min(IG.ratio * drop, IG.maxRun) : 0;
        g.edges.push({ g, ring: ri, i, ax, ay, bx, by, len, tx, ty, nx, ny, zl, drop, B });
      }
    });
    const RN = n => R.filter(g => g.name === n);
    const crestDist = (g, x, y) => { let m = 1e9; for (const e of g.edges) { const d = segDist(x, y, e.ax, e.ay, e.bx, e.by); if (d - e.B < m) m = d - e.B; } return inReg(g, x, y) ? m : -m; };
    S.regions = R;
    // ---- 引用解析 ----
    const BLD = D.buildings, P = D.points || {};
    const byName = n => BLD.find(b => b.name === n);
    function nearestEdge(g, x, y, needB, alongAng) { let best = null, bd = 1e9, bt = 0; for (const e of g.edges) { if (needB && !e.B) continue; if (alongAng !== undefined && Math.abs(Math.cos(Math.atan2(e.ty, e.tx) - alongAng)) < 0.85) continue; const d = segDist(x, y, e.ax, e.ay, e.bx, e.by); if (d < bd) { bd = d; best = e; bt = clamp(segT(x, y, e.ax, e.ay, e.bx, e.by), 0, 1); } } return best ? { e: best, d: bd, t: bt, fx: best.ax + (best.bx - best.ax) * bt, fy: best.ay + (best.by - best.ay) * bt } : null; }
    function anchorOf(at, g) {
      if (at.building) { const b = byName(at.building); return b ? [b.cx, b.cy, b] : null; }
      if (at.point) { const p = P[at.point]; return p ? [p[0], p[1], null] : null; }
      if (at.near) return [at.near[0], at.near[1], null];
      if (at.extreme) { let best = null, bv = -1e9; for (const e of g.edges) { if (!e.B || e.len < 12 || e.nx * at.extreme[0] + e.ny * at.extreme[1] < 0.8) continue; const v = (e.ax + e.bx) / 2 * at.extreme[0] + (e.ay + e.by) / 2 * at.extreme[1]; if (v > bv) { bv = v; best = e; } } return best ? [(best.ax + best.bx) / 2, (best.ay + best.by) / 2, null] : null; }
      return null;
    }
    const mainRegion = name => RN(name).sort((a, b) => b.area - a.area)[0];


    // ---- 高度网格 ----
    const gs = SPEC.grid, c = opt.cell, NX = Math.round((gs.x1 - gs.x0) / c) + 1, NY = Math.round((gs.y1 - gs.y0) / c) + 1;
    const H = new Float32Array(NX * NY).fill(BED), CLS = new Int16Array(NX * NY).fill(-1), LOCK = new Uint8Array(NX * NY), TAG = new Uint8Array(NX * NY);
    const X = i => gs.x0 + i * c, Y = j => gs.y0 + j * c;
    // 操作 1：台地（扫描线填充各曲轮，按优先级从低到高写入）
    for (const g of order.slice().reverse()) {
      const j0 = Math.max(0, Math.ceil((g.bb[1] - gs.y0) / c)), j1 = Math.min(NY - 1, Math.floor((g.bb[3] - gs.y0) / c));
      for (let j = j0; j <= j1; j++) {
        const y = Y(j), xs = [];
        for (const ring of g.rings) for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) { const [xa, ya] = ring[a], [xb, yb] = ring[b]; if ((ya > y) !== (yb > y)) xs.push(xa + (y - ya) * (xb - xa) / (yb - ya)); }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const i0 = Math.max(0, Math.ceil((xs[k] - gs.x0) / c)), i1 = Math.min(NX - 1, Math.floor((xs[k + 1] - gs.x0) / c));
          for (let i = i0; i <= i1; i++) { const q = j * NX + i; H[q] = g.z; CLS[q] = g.i; }
        }
      }
    }
    // 操作 1b：外堀外圈分离（颈切线 + 洪泛）
    const NINO = mainRegion('ninomaru'), BAND = { i: R.length, name: 'city', band: true, z: L.city, edges: [], rings: [], bb: [0, 0, 0, 0], area: 0 };
    const vid = (x, y) => { const i = Math.round((x - gs.x0) / c), j = Math.round((y - gs.y0) / c); return (i < 0 || j < 0 || i >= NX || j >= NY) ? -1 : j * NX + i; };
    const landN = (x, y) => { const q = vid(x, y); return q >= 0 && CLS[q] === NINO.i; };
    S.necks = {};
    for (const gsp of SPEC.gates) {
      if (!gsp.neck) continue; const an = anchorOf(gsp.at, NINO); if (!an) continue; const [ax, ay, bd] = an;
      const angs = []; if (bd && bd.w > bd.d) for (let k = -15; k <= 15; k += 3) angs.push(bd.ang + k * Math.PI / 180); else for (let k = 0; k < 180; k += 5) angs.push(k * Math.PI / 180);
      let best = null;
      for (const th of angs) {
        const ux = Math.cos(th), uy = Math.sin(th), nx = -uy, ny = ux;
        for (let o = -SPEC.band.neckSearch; o <= SPEC.band.neckSearch; o += 1) {
          const px = ax + nx * o, py = ay + ny * o; if (!landN(px, py)) continue;
          let a = 0, b = 0, okA = false, okB = false;
          for (a = 0.5; a <= SPEC.band.chordMax; a += 0.5) if (!landN(px + ux * a, py + uy * a)) { okA = true; break; }
          for (b = 0.5; b <= SPEC.band.chordMax; b += 0.5) if (!landN(px - ux * b, py - uy * b)) { okB = true; break; }
          if (!okA || !okB) continue; const len = a + b; if (len < Math.max(10, (gsp.width || 8) + 4)) continue; // 颈至少要比门宽
          if (!best || len < best.len - 0.6 || (Math.abs(len - best.len) <= 0.6 && Math.abs(o) < Math.abs(best.o))) best = { len, o, th, c0: [px + ux * (a + 0.5), py + uy * (a + 0.5)], c1: [px - ux * (b + 0.5), py - uy * (b + 0.5)], p: [px, py] };
        }
      }
      if (best) S.necks[gsp.id] = best; else S.notes.push('门 ' + gsp.name + ' 找不到土桥颈');
    }
    // 洪泛：颈切线两侧 0.9 格内的格点作为屏障
    {
      const bar = new Uint8Array(NX * NY), chords = Object.values(S.necks);
      for (const ch of chords) { const bb = bboxOf([ch.c0, ch.c1]); for (let j = Math.max(0, Math.floor((bb[1] - 2 - gs.y0) / c)); j <= Math.min(NY - 1, Math.ceil((bb[3] + 2 - gs.y0) / c)); j++) for (let i = Math.max(0, Math.floor((bb[0] - 2 - gs.x0) / c)); i <= Math.min(NX - 1, Math.ceil((bb[2] + 2 - gs.x0) / c)); i++) if (segDist(X(i), Y(j), ch.c0[0], ch.c0[1], ch.c1[0], ch.c1[1]) < c * 0.9) bar[j * NX + i] = 1; }
      const sd = anchorOf(SPEC.band.seed, NINO), seen = new Uint8Array(NX * NY), st = []; let q0 = vid(sd[0], sd[1]);
      if (q0 >= 0 && CLS[q0] === NINO.i) { st.push(q0); seen[q0] = 1; }
      while (st.length) { const q = st.pop(), i = q % NX, j = (q - i) / NX; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= NX || jj >= NY) continue; const k = jj * NX + ii; if (seen[k] || CLS[k] !== NINO.i) continue; seen[k] = 1; if (!bar[k]) st.push(k); } }
      let inner = 0, band = 0; for (let q = 0; q < CLS.length; q++) { if (CLS[q] < 0 || R[CLS[q]].name !== 'ninomaru') continue; if (CLS[q] === NINO.i && seen[q]) { inner++; continue; } CLS[q] = BAND.i; H[q] = BAND.z; band++; }
      S.bandCells = band; S.innerCells = inner;
      if (band > inner) S.notes.push('外圈分离失败：外圈格点多于内部（颈切线没封住）');
      // 颈切线作为二之丸的“边”（内侧有 0.88 m 扇勾配）
      for (const [gid, ch] of Object.entries(S.necks)) {
        let [a, b] = [ch.c0, ch.c1]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]), tx = (b[0] - a[0]) / len, ty = (b[1] - a[1]) / len;
        let nx = ty, ny = -tx; const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; const q = vid(mx + nx * 3, my + ny * 3); if (q >= 0 && CLS[q] === NINO.i) { nx = -nx; ny = -ny; }
        const drop = NINO.z - BAND.z, B = Math.min(IG.ratio * drop, IG.maxRun);
        const e = { g: NINO, ring: -1, i: -1, ax: a[0], ay: a[1], bx: b[0], by: b[1], len, tx, ty, nx, ny, zl: BAND.z, drop, B, chord: gid }; NINO.edges.push(e); ch.edge = e;
      }
    }
    const zoneAt = (x, y) => { const g = regionAt(x, y); if (g && g.name === 'ninomaru') { const q = vid(x, y); if (q >= 0 && CLS[q] === BAND.i) return BAND; } return g; };
    S.zoneAt = zoneAt; S.regionAt = regionAt; S.BAND = BAND; zoneRef = zoneAt;
    // 操作 2：石垣（多边形边=墙脚，向曲轮内侧按扇勾配升到台地顶；按格点所在台地的高度算）
    for (const g of R) for (const e of g.edges) {
      if (!e.B) continue;
      const i0 = Math.max(0, Math.floor((Math.min(e.ax, e.bx) - e.B - gs.x0) / c)), i1 = Math.min(NX - 1, Math.ceil((Math.max(e.ax, e.bx) + e.B - gs.x0) / c));
      const j0 = Math.max(0, Math.floor((Math.min(e.ay, e.by) - e.B - gs.y0) / c)), j1 = Math.min(NY - 1, Math.ceil((Math.max(e.ay, e.by) + e.B - gs.y0) / c));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const q = j * NX + i; if (!(CLS[q] === g.i || (CLS[q] === BAND.i && g.name === 'ninomaru' && !e.chord))) continue;
        const top = CLS[q] === BAND.i ? BAND.z : g.z; if (top - e.zl < IG.minDrop) continue;
        const d = segDist(X(i), Y(j), e.ax, e.ay, e.bx, e.by), s = Math.max(1 / IG.ratio, (top - e.zl) / IG.maxRun); if (d >= (top - e.zl) / s) continue;
        const hz = e.zl + d * s; if (hz < H[q]) { H[q] = hz; TAG[q] = 1; } // TAG 1 = 石垣面
      }
    }
    const BASE = H.slice();
    // 高度插值：与渲染网格的三角剖分完全一致（每格对角线 a-d）
    function heightAt(x, y) {
      let fx = (x - gs.x0) / c, fy = (y - gs.y0) / c; fx = clamp(fx, 0, NX - 1.0001); fy = clamp(fy, 0, NY - 1.0001);
      const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, a = j * NX + i, b = a + 1, cc = a + NX, d = cc + 1;
      return u >= v ? H[a] + u * (H[b] - H[a]) + v * (H[d] - H[b]) : H[a] + v * (H[cc] - H[a]) + u * (H[d] - H[cc]);
    }
    // 操作：整平（settle）——与多边形有重叠的每个三角形，三个顶点都设为 z；已被坡道锁定或原本是水面的格点不动（审计会报出来）
    const settleLog = [];
    function settle(P, z, tag) {
      const bb = bboxOf(P), i0 = Math.max(0, Math.floor((bb[0] - gs.x0) / c) - 1), i1 = Math.min(NX - 2, Math.ceil((bb[2] - gs.x0) / c)), j0 = Math.max(0, Math.floor((bb[1] - gs.y0) / c) - 1), j1 = Math.min(NY - 2, Math.ceil((bb[3] - gs.y0) / c));
      let refused = 0;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const xa = X(i), ya = Y(j), xb = xa + c, yb = ya + c, a = j * NX + i, b = a + 1, cc = a + NX, d = cc + 1;
        for (const [T, ids] of [[[[xa, ya], [xb, ya], [xb, yb]], [a, b, d]], [[[xa, ya], [xb, yb], [xa, yb]], [a, d, cc]]]) {
          if (!triOverlapPoly(T, P, bb)) continue;
          for (const q of ids) { if (CLS[q] < 0 || (LOCK[q] && LOCK[q] !== tag && Math.abs(H[q] - z) > 1e-4)) { refused++; continue; } H[q] = z; LOCK[q] = tag; }
        }
      }
      settleLog.push(refused); return refused;
    }

    // ---- 门 + 坡道/桥 ----
    const obstacles = []; // 土塀留口用：{poly, pad}
    for (const gsp of SPEC.gates) {
      const g = mainRegion(gsp.region), an = anchorOf(gsp.at, g);
      if (!an) { S.notes.push('门 ' + gsp.name + ' 找不到引用'); continue; }
      const [axp, ayp, bdat] = an;
      let gw = gsp.size ? gsp.size[0] : (bdat ? bdat.w : 8), gd = gsp.size ? gsp.size[1] : (bdat ? bdat.d : 5);
      const gate = { spec: gsp, name: gsp.name, region: g, z: g.z, w: gw, d: gd };
      if (gsp.internal) { // 内部仕切门：保持实测位置/朝向
        Object.assign(gate, { x: axp, y: ayp, ang: bdat ? bdat.ang : 0, nin: null });
      } else if (gsp.neck && S.necks[gsp.id]) { // 土桥颈上的门：门长轴沿颈切线，门洞朝外圈
        const ch = S.necks[gsp.id], e = ch.edge, ang = Math.atan2(e.ty, e.tx), nin = [-e.nx, -e.ny];
        const t = clamp(segT(axp, ayp, e.ax, e.ay, e.bx, e.by), 0, 1), fx = e.ax + (e.bx - e.ax) * t, fy = e.ay + (e.by - e.ay) * t, off = e.B + gd / 2;
        Object.assign(gate, { x: fx + nin[0] * off, y: fy + nin[1] * off, ang, nin, edge: e, foot: [fx, fy], moved: Math.hypot(fx + nin[0] * off - axp, fy + nin[1] * off - ayp) });
      } else {
        // 有实测朝向的门：只找与门长轴平行的边（门洞垂直于石垣）
        const ne = (bdat && bdat.w > bdat.d && nearestEdge(g, axp, ayp, true, bdat.ang)) || nearestEdge(g, axp, ayp, true), e = ne.e;
        const ang = Math.atan2(e.ty, e.tx), nin = [-e.nx, -e.ny];
        const off = e.B + gd / 2;
        Object.assign(gate, { x: ne.fx + nin[0] * off, y: ne.fy + nin[1] * off, ang, nin, edge: e, foot: [ne.fx, ne.fy], moved: Math.hypot(ne.fx + nin[0] * off - axp, ne.fy + nin[1] * off - ayp) });
      }
      gate.poly = rectPoly(gate.x, gate.y, gate.w, gate.d, gate.ang);
      const part = addPart({ fam: gate.w > 15 ? 'yaguramon' : 'gate', name: gsp.name, x: gate.x, y: gate.y, ang: gate.ang, w: gate.w, d: gate.d, z: gate.z, poly: gate.poly, region: g.i, gate: gsp.id });
      gate.part = part; S.gates.push(gate);
      obstacles.push({ poly: gate.poly, pad: SPEC.dobei.gapPad });
      if (gate.nin) { // 门洞前后各 6 m 的通道不许有墙
        const pass = rectPoly(gate.x, gate.y, Math.min(gate.w, gsp.width || 8) * 0.8, gate.d + 12, gate.ang); gate.passage = pass; obstacles.push({ poly: pass, pad: 0.6 });
      } else { const pass = rectPoly(gate.x, gate.y, gate.w * 0.8, gate.d + 12, gate.ang); gate.passage = pass; }
      // 坡道：从门外侧面中点沿外法线射线，直到进入目标曲轮的石垣顶面
      if (gsp.to && gate.nin) {
        const out = [-gate.nin[0], -gate.nin[1]], p0 = [gate.x + out[0] * gate.d / 2, gate.y + out[1] * gate.d / 2];
        let p1 = null, tgt = null; const zT = L[gsp.to], hw = (gsp.width || 8) / 2;
        const zoneOK = z => z && (gsp.to === 'city' ? (z === BAND || z.name === 'city') : (z.name === gsp.to && !z.band && (gsp.to !== 'ninomaru' || z === NINO)));
        const minLen = gsp.neck ? Math.abs(g.z - zT) / SPEC.ramp.neckGrade : 0;
        for (let s = 2; s <= SPEC.ramp.maxLen; s += 0.5) {
          const x = p0[0] + out[0] * s, y = p0[1] + out[1] * s, rg = zoneAt(x, y);
          if (s >= minLen && zoneOK(rg)) { // 终点：中线和两侧都落在目标台地的平顶上（离石垣顶边 ≥ endIn）
            const ok = [-1, 0, 1].every(sd => { const xx = x - out[1] * (hw + SPEC.ramp.endIn) * sd, yy = y + out[0] * (hw + SPEC.ramp.endIn) * sd; return zoneOK(zoneAt(xx, yy)) && Math.abs(heightAt(xx, yy) - zT) < 1e-3 && Math.abs(heightAt(xx + out[0] * SPEC.ramp.endIn, yy + out[1] * SPEC.ramp.endIn) - zT) < 1e-3; });
            if (ok) { p1 = [x, y]; tgt = rg; break; }
          }
          if (rg && rg !== g && !zoneOK(rg) && rg.z > g.z) break; // 撞上更高的台地：失败
        }
        const ramp = { gate, via: gsp.via, width: gsp.width || 8, p0, p1, from: g, to: tgt, z0: g.z, z1: zT, toName: gsp.to };
        if (p1) {
          ramp.len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); ramp.grade = Math.abs(ramp.z0 - ramp.z1) / (ramp.len - SPEC.ramp.landing); ramp.ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
          ramp.poly = segPoly(p0[0], p0[1], p1[0], p1[1], ramp.width, 0);
          obstacles.push({ poly: segPoly(p0[0], p0[1], p1[0], p1[1], ramp.width + 2, 0), pad: 0.5 });
          ramp.part = addPart({ fam: ramp.via, name: gsp.name + (ramp.via === 'bridge' ? '（桥）' : '（土桥）'), x0: p0[0], y0: p0[1], x1: p1[0], y1: p1[1], z0: ramp.z0, z1: ramp.z1, w: ramp.width, ramp: true, gate: gsp.id });
        }
        gate.ramp = ramp; S.ramps.push(ramp);
      }
      // 枡形：门内侧的方形院子，三面石垣矮墙（建筑处留口），里侧开二之门
      if (gsp.masugata && gate.nin) {
        const m = gsp.masugata, Sz = m.size, n = gate.nin, t = [Math.cos(gate.ang), Math.sin(gate.ang)];
        const cx = gate.x + n[0] * (gate.d / 2 + Sz / 2), cy = gate.y + n[1] * (gate.d / 2 + Sz / 2);
        const pt = (u, v) => [cx + t[0] * u + n[0] * v, cy + t[1] * u + n[1] * v];
        const court = [pt(-Sz / 2, -Sz / 2), pt(Sz / 2, -Sz / 2), pt(Sz / 2, Sz / 2), pt(-Sz / 2, Sz / 2)];
        gate.masugata = { court, cx, cy, walls: [] };
        const mw = 3; // 墙厚
        const sides = [[pt(-Sz / 2 - mw / 2, -Sz / 2 + 1.0), pt(-Sz / 2 - mw / 2, Sz / 2 + mw / 2)], [pt(Sz / 2 + mw / 2, -Sz / 2 + 1.0), pt(Sz / 2 + mw / 2, Sz / 2 + mw / 2)], [pt(-Sz / 2 - mw, Sz / 2 + mw / 2), pt(Sz / 2 + mw, Sz / 2 + mw / 2)]];
        let innerGate = null;
        if (m.inner === 'yaguramon') { // 二之门（渡橹门）放在里墙右段，形成直角转折
          const [ix, iy] = pt(Sz * 0.18, Sz / 2 + mw / 2);
          innerGate = addPart({ fam: 'yaguramon', name: m.innerName, x: ix, y: iy, ang: gate.ang, w: 12, d: 7, z: g.z, poly: rectPoly(ix, iy, 12, 7, gate.ang), region: g.i, masugataOf: gsp.id });
          obstacles.push({ poly: innerGate.poly, pad: 0.3 });
          const ip = rectPoly(ix, iy, 6, 7 + 12, gate.ang); obstacles.push({ poly: ip, pad: 0.3 }); gate.masugata.innerPassage = ip;
        }
        gate.masugata.sides = sides; gate.masugata.innerGate = innerGate;
        obstacles.push({ poly: court, pad: -0.5, masugata: gsp.id, keepOut: true });
      }
    }

    // ---- 建筑（实测）----
    const blds = [];
    for (const b of BLD) {
      if (b.type === 'gate') continue; // 门由门规则放
      const g = zoneAt(b.cx, b.cy) || mainRegion('ninomaru');
      let poly = (b.type === 'tamon' || b.type === 'hall' || b.type === 'kura' || b.type === 'pavilion' || b.type === 'yagura2') && b.fp && b.fp.length >= 3 ? b.fp.map(p => p.slice()) : rectPoly(b.cx, b.cy, b.w, b.d, b.ang);
      if (b.type === 'tenshu') poly = rectPoly(b.cx, b.cy, 40, 36, b.ang);
      if (b.type === 'yagura2') poly = rectPoly(b.cx, b.cy, b.w * 0.92, b.d * 0.92, b.ang);
      const fam = b.type;
      const p = addPart({ fam, name: b.name, x: b.cx, y: b.cy, ang: b.ang, w: b.w, d: b.d, z: g.z, poly, region: g.i, data: b, real: true });
      blds.push(p); obstacles.push({ poly, pad: fam === 'yagura2' ? 0 : SPEC.dobei.gapPad });
      if (fam === 'yagura2') { // 现存橹比石垣顶退后几米：橹前到石垣顶这一段也不建土塀（墙接到橹两侧）
        const ne = nearestEdge(g, b.cx, b.cy, true); if (ne && ne.d < 30) { const e = ne.e, k = Math.max(0, ne.d - e.B); const ap = rectPoly(b.cx + e.nx * k / 2, b.cy + e.ny * k / 2, Math.max(b.w, b.d) * 0.9, k + 2, Math.atan2(e.ty, e.tx)); obstacles.push({ poly: ap, pad: 0 }); }
      }
    }
    // 现存橹到石垣顶的退距（实测），作为失传橹吸附的退距
    const setbacks = [];
    for (const p of blds) if (p.fam === 'yagura2') { const g = R[p.region]; let m = 1e9; for (const q of p.poly) m = Math.min(m, crestDist(g, q[0], q[1])); setbacks.push(m); }
    setbacks.sort((a, b) => a - b);
    const SETBACK = SPEC.yagura.setback; S.yaguraSetback = SETBACK; S.yaguraSetbackRaw = setbacks; // 失传橹外墙面与土塀线齐平（橹站在石垣顶边上）

    // ---- 失传橹：遗址点吸附到最近的石垣（主方向=附近最长的边，靠近转角就滑到角上），再“推”进石垣顶内直到四角都满足退距 ----
    S.lostPlaced = []; S.lostSkipped = [];
    const nearestCrest = (g, x, y) => { let best = null, m = 1e9; for (const e of g.edges) { if (!e.B) continue; const d = segDist(x, y, e.ax, e.ay, e.bx, e.by) - e.B; if (d < m) { m = d; best = e; } } return { e: best, m }; };
    if (opt.lost) for (const ly of D.lost_yagura) {
      const g = zoneAt(ly.x, ly.y); if (!g || g.band || (g.name !== 'honmaru' && g.name !== 'ninomaru')) { S.lostSkipped.push(ly.name + '（不在本丸/二之丸）'); continue; }
      const Y = SPEC.yagura[g.name], hw = Y.w / 2, hd = Y.d / 2;
      const ne = nearestEdge(g, ly.x, ly.y, true);
      if (!ne || ne.d > SPEC.yagura.snapRadius) { S.lostSkipped.push(ly.name + '（离石垣 ' + (ne ? ne.d.toFixed(0) : '?') + ' m，不吸附）'); continue; }
      // 主方向：离最近边 10 m 以内的边里最长的一条
      let dom = ne.e; for (const e of g.edges) { if (!e.B || e.len <= dom.len) continue; if (segDist(ly.x, ly.y, e.ax, e.ay, e.bx, e.by) <= ne.d + 10) dom = e; }
      const ang = Math.atan2(dom.ty, dom.tx); let t = clamp(segT(ly.x, ly.y, dom.ax, dom.ay, dom.bx, dom.by), 0, 1);
      let kind = 'edge';
      const toA = t * dom.len, toB = (1 - t) * dom.len; // 靠近边端点（转角）就滑到角上
      const turnAt = (px, py) => { const o = g.edges.find(e => e !== dom && e.B && ((Math.hypot(e.bx - px, e.by - py) < 0.01) || (Math.hypot(e.ax - px, e.ay - py) < 0.01))); return o ? Math.abs(Math.asin(clamp(dom.tx * o.ty - dom.ty * o.tx, -1, 1))) * 180 / Math.PI + (dom.tx * o.tx + dom.ty * o.ty < 0 ? 90 : 0) : 0; };
      if (toA < SPEC.yagura.cornerRadius && toA <= toB && turnAt(dom.ax, dom.ay) >= SPEC.yagura.cornerTurnDeg) { t = 0; kind = 'corner'; } else if (toB < SPEC.yagura.cornerRadius && turnAt(dom.bx, dom.by) >= SPEC.yagura.cornerTurnDeg) { t = 1; kind = 'corner'; }
      let cx = dom.ax + (dom.bx - dom.ax) * t - dom.nx * (dom.B + SETBACK + hd), cy = dom.ay + (dom.by - dom.ay) * t - dom.ny * (dom.B + SETBACK + hd);
      const probe = () => { const P2 = rectPoly(cx, cy, Y.w, Y.d, ang), pts = P2.slice(); for (let k = 0; k < 4; k++) { const a = P2[k], b = P2[(k + 1) % 4]; for (const f of [0.25, 0.5, 0.75]) pts.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); } return pts; };
      for (let it = 0; it < 40; it++) { // 推：缺退距最多的点沿它最近石垣边的内法线推回
        let mx = 0, my = 0, worst = 0;
        for (const q of probe()) { const nc = nearestCrest(g, q[0], q[1]); const inside = inReg(g, q[0], q[1]); const def = inside ? SETBACK - nc.m : SETBACK + Math.abs(nc.m); if (def > worst + 1e-9 && def > 0.01) { worst = def; mx = -nc.e.nx * def; my = -nc.e.ny * def; } }
        if (worst <= 0.01) break; cx += mx * 1.02; cy += my * 1.02;
      }
      const poly = rectPoly(cx, cy, Y.w, Y.d, ang);
      const fits = poly.every(q => inReg(g, q[0], q[1]) && crestDist(g, q[0], q[1]) >= SETBACK - 0.05) && Math.hypot(cx - ly.x, cy - ly.y) < SPEC.yagura.snapRadius + 15;
      if (!fits) { S.lostSkipped.push(ly.name + '（石垣顶放不下）'); continue; }
      const clash = S.parts.find(o => o.poly && polysOverlap(shrink(o.poly, 0.05), poly));
      if (clash) { S.lostSkipped.push(ly.name + '（与 ' + clash.name + ' 冲突）'); continue; }
      const p = addPart({ fam: Y.fam, name: ly.name.replace(/跡$/, ''), x: cx, y: cy, ang, w: Y.w, d: Y.d, z: g.z, poly, region: g.i, lost: true, snap: kind, src: [ly.x, ly.y] });
      S.lostPlaced.push(p); obstacles.push({ poly, pad: 0 });
    }

    // ---- 地基整平：门、橹、建筑（先于坡道；坡道不改已锁定格点）----
    for (const p of S.parts) if (p.poly) p.refused = settle(p.poly, p.z, 2);

    // ---- 土塀：沿本丸/二之丸每条石垣顶边内缩 inset，留口 ----
    const DB = SPEC.dobei; S.dobei = [];
    const obsBB = obstacles.map(o => bboxOf(o.poly));
    const blocked = (x, y, extra) => { for (let k = 0; k < obstacles.length; k++) { const o = obstacles[k], b = obsBB[k], m = Math.max(0, o.pad) + extra + 0.5; if (x < b[0] - m || x > b[2] + m || y < b[1] - m || y > b[3] + m) continue; if (o.keepOut) { if (inPoly(x, y, o.poly)) return true; continue; } if (polyDist(x, y, o.poly) < o.pad + extra) return true; } return false; };
    const wallRegions = R.filter(g => DB.regions.includes(g.name) && (g.name !== 'ninomaru' || g === NINO));
    for (const g of wallRegions) for (const e of g.edges) {
      if (!e.B) continue; const o = e.B + DB.inset;
      const mx = (e.ax + e.bx) / 2 - e.nx * o, my = (e.ay + e.by) / 2 - e.ny * o; if (zoneAt(mx, my) !== g && e.len > 2 * o) continue; // 这条边内侧不是本曲轮（外圈一侧）
      // 偏移线两端各外延 o，再按“到所有石垣顶边的距离 ≥ inset”修剪：凸角自动接上、凹角自动裁掉
      const a = [e.ax - e.nx * o - e.tx * o, e.ay - e.ny * o - e.ty * o], b = [e.bx - e.nx * o + e.tx * o, e.by - e.ny * o + e.ty * o];
      const Lr = Math.hypot(b[0] - a[0], b[1] - a[1]), N = Math.max(1, Math.ceil(Lr / 0.25)), free = new Uint8Array(N + 1);
      for (let k = 0; k <= N; k++) { const x = a[0] + (b[0] - a[0]) * k / N, y = a[1] + (b[1] - a[1]) * k / N; free[k] = (inReg(g, x, y) && crestDist(g, x, y) >= DB.inset - 0.05 && !blocked(x, y, DB.t / 2)) ? 1 : 0; }
      let k = 0;
      while (k <= N) {
        if (!free[k]) { k++; continue; }
        let k2 = k; while (k2 + 1 <= N && free[k2 + 1]) k2++;
        const len = (k2 - k) / N * Lr;
        if (len >= DB.minLen) {
          const np = Math.max(1, Math.ceil(len / DB.maxPiece));
          for (let q = 0; q < np; q++) {
            const f0 = (k + (k2 - k) * q / np) / N, f1 = (k + (k2 - k) * (q + 1) / np) / N;
            const w = { fam: 'dobei', name: '土塀', x0: a[0] + (b[0] - a[0]) * f0, y0: a[1] + (b[1] - a[1]) * f0, x1: a[0] + (b[0] - a[0]) * f1, y1: a[1] + (b[1] - a[1]) * f1, z: g.z, t: DB.t, h: DB.h, region: g.i, wall: true };
            w.poly = segPoly(w.x0, w.y0, w.x1, w.y1, w.t); S.dobei.push(addPart(w));
          }
        }
        k = k2 + 1;
      }
    }
    // ---- 枡形墙（石垣矮墙+土塀），遇建筑/二之门留口 ----
    for (const gate of S.gates) {
      const M = gate.masugata; if (!M) continue;
      for (const [a, b] of M.sides) {
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]), N = Math.ceil(L / 0.25), free = new Uint8Array(N + 1);
        for (let s = 0; s <= N; s++) { const x = a[0] + (b[0] - a[0]) * s / N, y = a[1] + (b[1] - a[1]) * s / N; free[s] = (!inReg(gate.region, x, y) || crestDist(gate.region, x, y) < SPEC.dobei.inset + 0.5 || obstacles.some(o => !o.keepOut && o.poly !== gate.poly && polyDist(x, y, o.poly) < 1.5 + 0.3)) ? 0 : 1; }
        let s = 0; while (s <= N) { if (!free[s]) { s++; continue; } let e2 = s; while (e2 + 1 <= N && free[e2 + 1]) e2++; const len = (e2 - s) / N * L;
          if (len >= 2) { const f0 = s / N, f1 = e2 / N; const w = { fam: 'mwall', name: gate.name + '枡形', x0: a[0] + (b[0] - a[0]) * f0, y0: a[1] + (b[1] - a[1]) * f0, x1: a[0] + (b[0] - a[0]) * f1, y1: a[1] + (b[1] - a[1]) * f1, z: gate.z, t: 3, h: 3.2, region: gate.region.i, wall: true, masugataOf: gate.spec.id }; w.poly = segPoly(w.x0, w.y0, w.x1, w.y1, w.t); M.walls.push(addPart(w)); }
          s = e2 + 1; }
      }
    }
    for (const p of S.parts) if (p.wall) p.refused = settle(p.poly, p.z, 3);

    const rampProf = (r, f) => { const s = f * r.len, l = SPEC.ramp.landing; return s <= l ? r.z0 : r.z0 + (r.z1 - r.z0) * (s - l) / (r.len - l); };
    S.rampProf = rampProf;
    // ---- 操作：坡道（土桥）——路面整平并锁定，两侧放坡；已锁定（地基）格点不动 ----
    for (const r of S.ramps) {
      if (!r.p1 || r.via !== 'dobashi') continue;
      const [x0, y0] = r.p0, [x1, y1] = r.p1, hw = r.width / 2, ss = SPEC.ramp.sideSlope, run = Math.max(r.z0, r.z1) - BED;
      const R2 = hw + run * ss + c, bb = [Math.min(x0, x1) - R2, Math.min(y0, y1) - R2, Math.max(x0, x1) + R2, Math.max(y0, y1) + R2];
      const i0 = Math.max(0, Math.floor((bb[0] - gs.x0) / c)), i1 = Math.min(NX - 1, Math.ceil((bb[2] - gs.x0) / c)), j0 = Math.max(0, Math.floor((bb[1] - gs.y0) / c)), j1 = Math.min(NY - 1, Math.ceil((bb[3] - gs.y0) / c));
      const L2 = r.len; let n = 0;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const q = j * NX + i, x = X(i), y = Y(j); if (LOCK[q] === 2 || LOCK[q] === 3) continue;
        const t = segT(x, y, x0, y0, x1, y1); if (t < -0.02 || t > 1 + 0.5 / L2 * 0 + 0.0) { if (t < -0.02 || t > 1) continue; }
        const tc = clamp(t, 0, 1), d = Math.hypot(x - (x0 + (x1 - x0) * tc), y - (y0 + (y1 - y0) * tc)), prof = rampProf(r, tc);
        if (d <= hw + c * 0.75) { H[q] = prof; LOCK[q] = 1; TAG[q] = 2; n++; }
        else if (d <= R2) { const hs = prof - (d - hw - c * 0.75) / ss; if (hs > H[q]) { H[q] = hs; TAG[q] = 3; } }
      }
      r.cells = n;
    }

    // ---- 表面（磁吸）：地面与桥面里最高的一个 ----
    const bridges = S.ramps.filter(r => r.p1 && r.via === 'bridge');
    function deckAt(x, y) { let h = null; for (const r of bridges) { const t = segT(x, y, r.p0[0], r.p0[1], r.p1[0], r.p1[1]); if (t < 0 || t > 1) continue; const d = segDist(x, y, r.p0[0], r.p0[1], r.p1[0], r.p1[1]); if (d <= r.width / 2) { const z = rampProf(r, t); h = h === null ? z : Math.max(h, z); } } return h; }
    function surfaceAt(x, y) { const g = heightAt(x, y), b = deckAt(x, y); return b === null ? g : Math.max(g, b); }

    // ---- 树：噪声成簇，西之丸庭园留开阔草坪 ----
    const TS = SPEC.trees, rnd = rng32((opt.seed * 2654435761) >>> 0);
    const lawnPts = TS.lawn.hull.map(n => { const b = byName(n); if (b) return [b.cx, b.cy]; const l = D.lost_yagura.find(q => q.name === n); return l ? [l.x, l.y] : null; }).filter(Boolean);
    const lawn = lawnPts.length >= 3 ? hull(lawnPts) : null; S.lawn = lawn;
    const solid = S.parts.filter(p => p.poly).map(p => ({ poly: p.poly, bb: bboxOf(p.poly) }));
    const rampPolys = S.ramps.filter(r => r.poly).map(r => segPoly(r.p0[0], r.p0[1], r.p1[0], r.p1[1], r.width + 6, 3));
    const passPolys = S.gates.map(g => g.passage).concat(S.gates.filter(g => g.masugata).map(g => g.masugata.court));
    const TG = new Map(), tk = (x, y) => Math.floor(x / 8) + ',' + Math.floor(y / 8);
    const nearTree = (x, y, r) => { const gx = Math.floor(x / 8), gy = Math.floor(y / 8); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const A = TG.get((gx + a) + ',' + (gy + b)); if (A) for (const t of A) if (Math.hypot(t.x - x, t.y - y) < r) return true; } return false; };
    S.trees = [];
    const seedOff = rnd() * 1000;
    for (const g of R) {
      const want = TS.counts[g.name]; if (!want) continue; const n = Math.round(want * Math.min(1, g.area / (g.name === 'ninomaru' ? 271858 : 81438)));
      let placed = 0, tries = 0;
      while (placed < n && tries < n * 80) {
        tries++;
        const x = g.bb[0] + rnd() * (g.bb[2] - g.bb[0]), y = g.bb[1] + rnd() * (g.bb[3] - g.bb[1]);
        if (!inReg(g, x, y)) continue;
        const nz = Math.sin(x * 0.011 + 1.3 + seedOff) * Math.cos(y * 0.013 + 0.7) + 0.5 * Math.sin((x + y) * 0.02 + seedOff * 0.3);
        if (nz < 0.15) continue;
        if (lawn && inPoly(x, y, lawn)) continue;
        if (crestDist(g, x, y) < TS.clearEdge) continue;
        if (solid.some(o => x > o.bb[0] - 8 && x < o.bb[2] + 8 && y > o.bb[1] - 8 && y < o.bb[3] + 8 && polyDist(x, y, o.poly) < TS.clearBuild)) continue;
        if (rampPolys.some(p => inPoly(x, y, p)) || passPolys.some(p => polyDist(x, y, p) < 4)) continue;
        if (nearTree(x, y, TS.minSpacing)) continue;
        const s = 0.8 + rnd() * 0.5, tr = { fam: 'tree', x, y, s, r: 2.2 * s, z: surfaceAt(x, y), region: g.i, kind: rnd() < 0.7 ? 'pine' : 'broad' };
        S.trees.push(tr); const k = tk(x, y); let A = TG.get(k); if (!A) TG.set(k, A = []); A.push(tr); placed++;
      }
    }

    // ---- 标注 ----
    for (const p of S.parts) if (p.name && p.fam !== 'dobei' && p.fam !== 'mwall' && !p.ramp) S.labels.push({ text: p.name, x: p.x, y: p.y, z: p.z + ({ tenshu: 62, yagura3: 22, yagura2: 17, yaguramon: 15, gate: 10 }[p.fam] || 10), lost: !!p.lost, fam: p.fam });

    Object.assign(S, { NX, NY, cell: c, H, BASE, CLS, LOCK, TAG, heightAt, surfaceAt, deckAt, crestDist, inReg, levelAt, X, Y, WZ, BED });
    S.ms = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
    S.audit = () => audit(S); S.signature = () => signature(S);
    return S;
  }

  // ---------------- 硬规则 ----------------
  const RULES = [
    { id: 'H1', name: '建筑底面贴地（|Δz|<0.1 m）' },
    { id: 'H2', name: '建筑之间、建筑与墙、树与建筑不重叠' },
    { id: 'H3', name: '土塀/枡形墙底在台地顶面上' },
    { id: 'H4', name: '坡道两端与两侧台地同高、坡度≤30%' },
    { id: 'H5', name: '每座门都有坡道/桥通到下一层，门洞通畅' },
    { id: 'H6', name: '不落水（建筑/墙/树/坡道面高于水面）' },
    { id: 'H7', name: '本丸/二之丸/城下高程符合规格' },
    { id: 'H8', name: '部件在所属曲轮内（不压石垣斜面）' },
    { id: 'H9', name: '水面格只被土桥改动' },
    { id: 'H10', name: '规格引用全部解析（门/点/建筑名）' },
  ];
  function audit(S) {
    const cnt = {}, items = []; RULES.forEach(r => cnt[r.id] = 0);
    const bad = (id, o, msg) => { cnt[id]++; if (o) o.bad = true; if (items.length < 200) items.push({ rule: id, name: o ? (o.name || o.fam) : '', msg, x: o ? (o.x !== undefined ? o.x : o.x0) : null, y: o ? (o.y !== undefined ? o.y : o.y0) : null }); };
    const { heightAt, surfaceAt } = S, P = S.parts;
    for (const p of P) p.bad = false; for (const t of S.trees) t.bad = false;
    const samples = (poly, step) => { const bb = bboxOf(poly), out = poly.map(q => q.slice()); for (let x = bb[0]; x <= bb[2]; x += step) for (let y = bb[1]; y <= bb[3]; y += step) if (inPoly(x, y, poly)) out.push([x, y]); for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step); for (let k = 1; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); } return out; };
    const blds = P.filter(p => p.poly && !p.wall);
    // H1 + H6 + H8
    for (const p of blds) {
      const sm = samples(p.poly, 1.0); let worst = 0, wet = false, out = false; const g = S.regions[p.region];
      for (const [x, y] of sm) { const h = heightAt(x, y); worst = Math.max(worst, Math.abs(h - p.z)); if (h < S.WZ + 0.3) wet = true; if (!S.inReg(g, x, y)) out = true; }
      if (worst >= 0.1) bad('H1', p, '底面离地/入地 ' + worst.toFixed(2) + ' m');
      if (wet) bad('H6', p, '落在水里');
      if (out) bad('H8', p, '超出' + g.name + '范围');
      if (p.refused) bad('H1', p, '地基整平被拒 ' + p.refused + ' 个格点（与坡道/水面冲突）');
    }
    // H2 建筑互不重叠；建筑与墙不重叠
    const bb = blds.map(p => bboxOf(p.poly));
    for (let i = 0; i < blds.length; i++) for (let j = i + 1; j < blds.length; j++) if (bbHit(bb[i], bb[j], 0) && polysOverlap(shrink(blds[i].poly, 0.05), shrink(blds[j].poly, 0.05))) { bad('H2', blds[i], '与 ' + blds[j].name + ' 重叠'); blds[j].bad = true; }
    const walls = P.filter(p => p.wall), wbb = walls.map(w => bboxOf(w.poly));
    for (let i = 0; i < blds.length; i++) for (let j = 0; j < walls.length; j++) if (bbHit(bb[i], wbb[j], 0) && polysOverlap(shrink(blds[i].poly, 0.05), shrink(walls[j].poly, 0.02))) { bad('H2', walls[j], '墙穿过 ' + blds[i].name); blds[i].bad = true; }
    for (const t of S.trees) for (let i = 0; i < blds.length; i++) { const b = bb[i]; if (t.x < b[0] - 5 || t.x > b[2] + 5 || t.y < b[1] - 5 || t.y > b[3] + 5) continue; if (polyDist(t.x, t.y, blds[i].poly) < t.r * 0.5) { bad('H2', t, '树压到 ' + blds[i].name); break; } }
    // H3 墙底在台地顶
    for (const w of walls) {
      const L = Math.hypot(w.x1 - w.x0, w.y1 - w.y0), n = Math.max(2, Math.ceil(L / 1.0)); let worst = 0, out = false, wet = false; const g = S.regions[w.region];
      for (let k = 0; k <= n; k++) for (const sd of [-1, 0, 1]) { const f = k / n, nx = -(w.y1 - w.y0) / L, ny = (w.x1 - w.x0) / L, x = w.x0 + (w.x1 - w.x0) * f + nx * sd * w.t / 2, y = w.y0 + (w.y1 - w.y0) * f + ny * sd * w.t / 2, h = heightAt(x, y); worst = Math.max(worst, Math.abs(h - w.z)); if (!S.inReg(g, x, y)) out = true; if (h < S.WZ + 0.3) wet = true; }
      if (worst >= 0.1) bad('H3', w, '墙底离台地 ' + worst.toFixed(2) + ' m');
      if (out) bad('H8', w, '墙超出曲轮'); if (wet) bad('H6', w, '墙落水');
    }
    // H4/H5 门与坡道
    for (const g of S.gates) {
      const sp = g.spec;
      if (sp.internal) { // 通道两头要能走到同层地面
        for (const sd of [-1, 1]) { const x = g.x + Math.cos(g.ang + Math.PI / 2) * sd * (g.d / 2 + 4), y = g.y + Math.sin(g.ang + Math.PI / 2) * sd * (g.d / 2 + 4); if (Math.abs(heightAt(x, y) - g.z) > 0.1) bad('H5', g.part, '内门通道一侧不在同层地面'); }
        continue;
      }
      const r = g.ramp;
      if (!r || !r.p1) { bad('H5', g.part, '门没有通到 ' + sp.to + ' 的坡道/桥'); continue; }
      const z0 = r.via === 'bridge' ? r.z0 : heightAt(r.p0[0], r.p0[1]), z1 = r.via === 'bridge' ? r.z1 : heightAt(r.p1[0], r.p1[1]);
      const g0 = heightAt(r.p0[0] + (r.p0[0] - r.p1[0]) / r.len * 0.6, r.p0[1] + (r.p0[1] - r.p1[1]) / r.len * 0.6), g1 = heightAt(r.p1[0] + (r.p1[0] - r.p0[0]) / r.len * 1.0, r.p1[1] + (r.p1[1] - r.p0[1]) / r.len * 1.0);
      if (Math.abs(z0 - r.from.z) >= 0.1 || Math.abs(g0 - r.from.z) >= 0.1) bad('H4', r.part, '起点 ' + z0.toFixed(2) + '/' + g0.toFixed(2) + ' ≠ ' + r.from.name + ' ' + r.from.z);
      if (Math.abs(z1 - r.to.z) >= 0.1 || Math.abs(g1 - r.to.z) >= 0.1) bad('H4', r.part, '终点 ' + z1.toFixed(2) + '/' + g1.toFixed(2) + ' ≠ ' + r.to.name + ' ' + r.to.z);
      if (r.grade > SPEC.ramp.maxGrade + 1e-9) bad('H4', r.part, '坡度 ' + (r.grade * 100).toFixed(0) + '%');
      // 坡道中线连续：沿线采样 surfaceAt 与剖面一致；坡道面高于水面
      const n = Math.ceil(r.len / 1.0); let worst = 0, wet = false;
      for (let k = 0; k <= n; k++) { const f = k / n, x = r.p0[0] + (r.p1[0] - r.p0[0]) * f, y = r.p0[1] + (r.p1[1] - r.p0[1]) * f, prof = S.rampProf(r, f), s = surfaceAt(x, y); worst = Math.max(worst, Math.abs(s - prof)); if (s < S.WZ + 0.3) wet = true; }
      if (worst >= 0.15) bad('H5', r.part, '坡道路面断开 ' + worst.toFixed(2) + ' m');
      if (wet) bad('H6', r.part, '坡道面在水下');
      // 门洞前后通道无墙
      for (const w of walls) if (bbHit(bboxOf(g.passage), bboxOf(w.poly), 0) && polysOverlap(shrink(g.passage, 0.1), w.poly)) bad('H5', w, '墙挡住 ' + g.name + ' 门洞');
    }
    // H6 树
    for (const t of S.trees) if (t.z < S.WZ + 0.3) bad('H6', t, '树在水里');
    // H7 高程：每个曲轮在顶面内部采样
    const rr = rng32(99);
    for (const g of S.regions) {
      let n = 0, tries = 0, badN = 0;
      while (n < 60 && tries < 4000) { tries++; const x = g.bb[0] + rr() * (g.bb[2] - g.bb[0]), y = g.bb[1] + rr() * (g.bb[3] - g.bb[1]); if (x < S.X(0) || x > S.X(S.NX - 1) || y < S.Y(0) || y > S.Y(S.NY - 1)) continue; if (!S.inReg(g, x, y) || S.crestDist(g, x, y) < 3 * S.cell) continue; if (S.ramps.some(r => r.poly && polyDist(x, y, r.poly) < (Math.max(r.z0, r.z1) - S.BED) * SPEC.ramp.sideSlope + 2 * S.cell)) continue; if (P.some(p => p.poly && polyDist(x, y, p.poly) < 3)) continue; n++; if (Math.abs(heightAt(x, y) - SPEC.levels[g.name]) > 0.01) badN++; }
      if (badN) bad('H7', { name: g.name, x: (g.bb[0] + g.bb[2]) / 2, y: (g.bb[1] + g.bb[3]) / 2 }, g.name + ' 有 ' + badN + '/' + n + ' 个采样高程≠' + SPEC.levels[g.name]);
    }
    // H9 水面格
    let wchg = 0; for (let q = 0; q < S.H.length; q++) if (S.CLS[q] < 0 && Math.abs(S.H[q] - S.BED) > 1e-4 && S.TAG[q] !== 2 && S.TAG[q] !== 3) wchg++;
    if (wchg) bad('H9', null, wchg + ' 个水面格被非土桥操作改动');
    // H10 引用
    for (const n of S.notes) bad('H10', null, n);
    for (const gsp of SPEC.gates) if (!S.gates.find(g => g.spec === gsp)) bad('H10', null, '门 ' + gsp.name + ' 未放置');
    const total = Object.values(cnt).reduce((a, b) => a + b, 0);
    return { total, cnt, items, rules: RULES };
  }

  function signature(S) {
    let h = 2166136261; const mix = v => { h ^= Math.round(v * 100) | 0; h = Math.imul(h, 16777619) >>> 0; };
    for (const p of S.parts) { mix(p.x !== undefined ? p.x : p.x0); mix(p.y !== undefined ? p.y : p.y0); mix(p.z !== undefined ? p.z : p.z0); }
    for (const t of S.trees) { mix(t.x); mix(t.y); mix(t.s); }
    for (let q = 0; q < S.H.length; q += 97) mix(S.H[q]);
    return h.toString(16) + '-' + S.parts.length + '-' + S.trees.length;
  }

  G.CASTLE_SITE = { SPEC, RULES, build, audit, rectPoly, segPoly, inPoly, polyDist };
})(typeof window !== 'undefined' ? window : globalThis);
