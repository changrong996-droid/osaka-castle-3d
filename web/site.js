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
    version: 'web-r2',
    ken: 1.97,                                                           // 1 間（只用作“碎墙”下限与参数量纲）
    levels: { water: -7, dry: -5, city: 0, ninomaru: 4, honmaru: 14 },   // 与 data/terrain.json 的 elev 一致（估值）
    WZ: -6,                                                              // 水面
    grid: { x0: -540, x1: 540, y0: -600, y1: 420, cell: 1.5 },
    regionPriority: ['honmaru', 'dry', 'ninomaru', 'city'],
    ishigaki: { ratio: 0.22, maxRun: 6, minDrop: 1.5 },                 // 扇勾配：水平退 0.22×高，最多 6 m；多边形边=墙脚，墙顶内缩
    // 防御线：土塀轴线在石垣顶线内 inset 处；接触容差 contact；墙线顶点简化容差 simplify
    wall: { regions: ['honmaru', 'ninomaru'], inset: 0.9, t: 0.6, h: 2.2, contact: 0.2, simplify: 0.15 },
    gate: { post: 0.9, margin: 1.0 },                                   // 门柱宽；门两侧至少留 margin 的直墙（门不跨转角）
    masugata: { wallT: 3, wallH: 3.2, maxReach: 42 },
    edge: { flush: 0.3, overhang: 0.3, near: 3.0 },                      // 石垣边上的建筑：外墙面离顶线 ≤flush，外挑 ≤overhang；near=“在边上”的判定距离
    walk: { cell: 0.5, slope: 0.3, goal: 45, margin: 55, tol: 0.6 },      // 通行：0.5 m 栅格寻路，坡度≤30%，宽度≥门洞
    support: { inset: 0.3 },
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
    yagura: { cornerTurnDeg: 35, cornerRadius: 22, snapRadius: 20, setback: 0.1, snapReal: 10, honmaru: { fam: 'yagura3', w: 13, d: 11 }, ninomaru: { fam: 'yagura2', w: 12, d: 10 } },
    trees: { counts: { ninomaru: 1100, honmaru: 140 }, minSpacing: 5, clearBuild: 5, clearEdge: 7, lawn: { hull: ['乾櫓', '坤櫓跡', '千貫櫓', '北仕切門'] } },
  };

  // ---------------- 小工具 ----------------
  const rng32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ringArea = r => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  const inRingRaw = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  function ringIdx(r) { // 大多边形：按 y 分桶的边索引（只为提速，结果与逐边判定相同）
    if (r._ix) return r._ix; let y0 = 1e9, y1 = -1e9; for (const p of r) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const nb = Math.max(1, Math.min(4096, Math.ceil((y1 - y0) / 2))), bs = (y1 - y0) / nb || 1, B = Array.from({ length: nb }, () => []);
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = Math.min(r[i][1], r[j][1]), b = Math.max(r[i][1], r[j][1]); for (let k = clamp(Math.floor((a - y0) / bs), 0, nb - 1), k1 = clamp(Math.floor((b - y0) / bs), 0, nb - 1); k <= k1; k++) B[k].push(i); }
    Object.defineProperty(r, '_ix', { value: { y0, y1, bs, nb, B }, enumerable: false }); return r._ix;
  }
  const inRing = (x, y, r) => {
    if (r.length < 24) return inRingRaw(x, y, r);
    const I = ringIdx(r); if (y < I.y0 || y > I.y1) return false; let c = false;
    for (const i of I.B[Math.min(I.nb - 1, Math.floor((y - I.y0) / I.bs))]) { const j = i ? i - 1 : r.length - 1, xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; }
    return c;
  };
  function segX(a, b, c, d) { const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1], den = rx * sy - ry * sx; if (Math.abs(den) < 1e-12) return null; const qx = c[0] - a[0], qy = c[1] - a[1]; return [(qx * sy - qy * sx) / den, (qx * ry - qy * rx) / den]; }
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
    let bandAt = () => false;
    const crestDist = (g, x, y) => { let m = 1e9; for (const e of g.edges) { if (e.band || (e.mixed && bandAt(e, x, y))) continue; const d = segDist(x, y, e.ax, e.ay, e.bx, e.by); if (d - e.B < m) m = d - e.B; } return inReg(g, x, y) ? m : -m; };
    S.regions = R;
    // ---- 引用解析 ----
    const BLD = D.buildings, P = D.points || {};
    const byName = n => BLD.find(b => b.name === n);
    function nearestEdge(g, x, y, needB, alongAng) { let best = null, bd = 1e9, bt = 0; for (const e of g.edges) { if (needB && !e.B) continue; if (e.band || (e.mixed && bandAt(e, x, y))) continue; if (alongAng !== undefined && Math.abs(Math.cos(Math.atan2(e.ty, e.tx) - alongAng)) < 0.85) continue; const d = segDist(x, y, e.ax, e.ay, e.bx, e.by); if (d < bd) { bd = d; best = e; bt = clamp(segT(x, y, e.ax, e.ay, e.bx, e.by), 0, 1); } } return best ? { e: best, d: bd, t: bt, fx: best.ax + (best.bx - best.ax) * bt, fy: best.ay + (best.by - best.ay) * bt } : null; }
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
    // 二之丸外环上“只围着外圈”的边（内侧是外圈）标为 band：它的石垣只作用于外圈格点，不削内侧二之丸的转角
    // （一条长边可能一段围着内侧、一段围着外圈：标为 mixed，逐点按最近点所在一侧判断）
    bandAt = (e, x, y) => { const t = clamp(segT(x, y, e.ax, e.ay, e.bx, e.by), 0, 1), q = vid(e.ax + (e.bx - e.ax) * t - e.nx * (e.B + 1), e.ay + (e.by - e.ay) * t - e.ny * (e.B + 1)); return q >= 0 && CLS[q] === BAND.i; };
    for (const e of NINO.edges) if (e.ring === 0 && e.B) { const n = Math.max(2, Math.ceil(e.len / 2)); let k = 0; for (let i = 0; i <= n; i++) { const f = i / n; if (bandAt(e, e.ax + (e.bx - e.ax) * f, e.ay + (e.by - e.ay) * f)) k++; } e.band = k === n + 1; e.mixed = k > 0 && k <= n; }
    // 操作 2：石垣（多边形边=墙脚，向曲轮内侧按扇勾配升到台地顶；按格点所在台地的高度算）
    for (const g of R) for (const e of g.edges) {
      if (!e.B) continue;
      const i0 = Math.max(0, Math.floor((Math.min(e.ax, e.bx) - e.B - gs.x0) / c)), i1 = Math.min(NX - 1, Math.ceil((Math.max(e.ax, e.bx) + e.B - gs.x0) / c));
      const j0 = Math.max(0, Math.floor((Math.min(e.ay, e.by) - e.B - gs.y0) / c)), j1 = Math.min(NY - 1, Math.ceil((Math.max(e.ay, e.by) + e.B - gs.y0) / c));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const q = j * NX + i; if (!((CLS[q] === g.i && !e.band && !(e.mixed && bandAt(e, X(i), Y(j)))) || (CLS[q] === BAND.i && g.name === 'ninomaru' && !e.chord))) continue;
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

    // ================= r2：围合线（每个筑墙曲轮的防御线 = 一条闭合链）=================
    // 外边界（二之丸在土桥颈处用颈切线截断）→ 石垣顶线 crest（各边内缩 B）→ 墙轴线 axis（再内缩 wall.inset）。
    const WL = SPEC.wall, KEN = SPEC.ken, GS = SPEC.gate;
    const mkE = (a, b, src) => { const len = Math.hypot(b[0] - a[0], b[1] - a[1]); return { ax: a[0], ay: a[1], bx: b[0], by: b[1], len, tx: (b[0] - a[0]) / (len || 1), ty: (b[1] - a[1]) / (len || 1), nx: src.nx, ny: src.ny, B: src.B, chord: src.chord }; };
    function loopEdgesOf(g) {
      const ringE = g.edges.filter(e => e.ring === 0), ne = ringE.length;
      const necks = g === NINO ? Object.entries(S.necks).filter(([, ch]) => ch.edge) : [];
      if (!necks.length) return ringE.map(e => mkE([e.ax, e.ay], [e.bx, e.by], e));
      const cuts = [];
      for (const [gid, ch] of necks) {
        // 颈切线两端 → 外环上最近的点（端点常常恰好擦过转角，不一定有真正的交点）
        const ends = [ch.c0, ch.c1].map(cp => { let best = null; ringE.forEach((e, i) => { const d = segDist(cp[0], cp[1], e.ax, e.ay, e.bx, e.by); if (!best || d < best.d) best = { i, d, t: clamp(segT(cp[0], cp[1], e.ax, e.ay, e.bx, e.by), 0, 0.999999) }; }); return best; });
        if (ends.some(e => !e || e.d > 4)) { S.notes.push('颈切线 ' + gid + ' 端点离二之丸外环太远'); continue; }
        const [hA, hB] = ends;
        const pair = [hA, hB].map(h => { const e = ringE[h.i]; return { i: h.i, t: h.t, pos: h.i + h.t, gid, p: [e.ax + (e.bx - e.ax) * h.t, e.ay + (e.by - e.ay) * h.t] }; });
        pair[0].mate = pair[1]; pair[1].mate = pair[0]; cuts.push(...pair);
      }
      cuts.sort((a, b) => a.pos - b.pos); const nC = cuts.length;
      const arcs = cuts.map((c0, k) => {
        const c1 = cuts[(k + 1) % nC], E = []; let i = c0.i, pa = c0.p;
        for (let guard = 0; guard <= ne + 1; guard++) {
          const e = ringE[i];
          if (i === c1.i && (guard > 0 || c1.t > c0.t)) { E.push(mkE(pa, c1.p, e)); break; }
          E.push(mkE(pa, [e.bx, e.by], e)); i = (i + 1) % ne; pa = [ringE[i].ax, ringE[i].ay];
        }
        // 这段弧是否围着内侧二之丸（而不是外圈）：弧长中点向内退 B+2.5 m 取样
        const tot = E.reduce((s, e) => s + e.len, 0); let acc = 0, keep = false;
        for (const e of E) { if (acc + e.len >= tot / 2) { const f = (tot / 2 - acc) / (e.len || 1), x = e.ax + (e.bx - e.ax) * f - e.nx * (e.B + 2.5), y = e.ay + (e.by - e.ay) * f - e.ny * (e.B + 2.5); keep = zoneAt(x, y) === NINO; break; } acc += e.len; }
        return { c0, c1, E, keep };
      });
      const start = arcs.findIndex(a => a.keep); if (start < 0) { S.notes.push('二之丸围合线：找不到内侧弧'); return []; }
      const out = []; let k = start;
      for (let guard = 0; guard < arcs.length + 1; guard++) {
        const a = arcs[k]; out.push(...a.E);
        const m = a.c1.mate, ch = S.necks[a.c1.gid]; out.push(mkE(a.c1.p, m.p, ch.edge));
        k = cuts.indexOf(m); if (!arcs[k].keep) { S.notes.push('二之丸围合线在颈 ' + a.c1.gid + ' 处断开'); break; }
        if (k === start) break;
      }
      return out.filter(e => e.len > 1e-3);
    }
    // 多边形内缩（每条边各自的距离，斜接；反向的短边删掉再算）
    function offsetLoop(E, off) {
      const idx = E.map((_, i) => i);
      const meet = (i, j) => {
        const A = E[i], Bq = E[j], ax = A.ax - A.nx * off[i], ay = A.ay - A.ny * off[i], bx = Bq.ax - Bq.nx * off[j], by = Bq.ay - Bq.ny * off[j];
        const den = A.tx * Bq.ty - A.ty * Bq.tx;
        if (Math.abs(den) < 0.02) return [(A.bx - A.nx * off[i] + bx) / 2, (A.by - A.ny * off[i] + by) / 2];
        const t = ((bx - ax) * Bq.ty - (by - ay) * Bq.tx) / den; return [ax + A.tx * t, ay + A.ty * t];
      };
      for (let it = 0; it < 4000 && idx.length > 3; it++) {
        const n = idx.length, V = idx.map((ei, k) => meet(ei, idx[(k + 1) % n]));
        let worst = -1, wv = 1e-6;
        for (let k = 0; k < n; k++) { const a = V[(k - 1 + n) % n], b = V[k], e = E[idx[k]], L = (b[0] - a[0]) * e.tx + (b[1] - a[1]) * e.ty; if (L < wv) { wv = L; worst = k; } }
        if (worst < 0) return V.map((_, k) => V[(k - 1 + n) % n]); // 第 k 段的起点
        idx.splice(worst, 1);
      }
      return [];
    }
    function untangle(V) { // 内缩后若有自交（凹口处的“燕尾”），切掉面积小的那一圈
      for (let guard = 0; guard < 60; guard++) {
        const n = V.length; let hit = null;
        for (let i = 0; i < n && !hit; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; const a = V[i], b = V[(i + 1) % n], r = segX(a, b, V[j], V[(j + 1) % n]); if (r && r[0] > 1e-9 && r[0] < 1 - 1e-9 && r[1] > 1e-9 && r[1] < 1 - 1e-9) { hit = [i, j, [a[0] + (b[0] - a[0]) * r[0], a[1] + (b[1] - a[1]) * r[0]]]; break; } }
        if (!hit) return V; const [i, j, p] = hit, A = [p].concat(V.slice(i + 1, j + 1)), Bv = V.slice(0, i + 1).concat([p], V.slice(j + 1));
        V = Math.abs(ringArea(A)) >= Math.abs(ringArea(Bv)) ? A : Bv;
      }
      return V;
    }
    function simplifyLoop(V, tol) {
      V = V.filter((p, k) => Math.hypot(p[0] - V[(k + 1) % V.length][0], p[1] - V[(k + 1) % V.length][1]) > 0.05);
      for (;;) {
        const n = V.length; if (n <= 4) break; let bi = -1, bd = tol;
        for (let k = 0; k < n; k++) { const a = V[(k - 1 + n) % n], b = V[(k + 1) % n], p = V[k], d = segDist(p[0], p[1], a[0], a[1], b[0], b[1]); if (d < bd) { bd = d; bi = k; } }
        if (bi < 0) break; V.splice(bi, 1);
      }
      return V;
    }
    // 斜接内缩不考虑深边端头的圆角（深石垣边在浅边旁会“咬”进来）：按距离场把折线上低于目标值的点沿最近边推回，再简化
    function repairLoop(V, g, target, tol) {
      const near = p => { let m = 1e9, cp = null, B = 0; for (const e of g.edges) { if (e.band || (e.mixed && bandAt(e, p[0], p[1]))) continue; const t = clamp(segT(p[0], p[1], e.ax, e.ay, e.bx, e.by), 0, 1), qx = e.ax + (e.bx - e.ax) * t, qy = e.ay + (e.by - e.ay) * t, d = Math.hypot(p[0] - qx, p[1] - qy) - e.B; if (d < m) { m = d; cp = [qx, qy]; B = e.B; } } return { m, cp, B }; };
      const P = []; let moved = 0;
      for (let k = 0; k < V.length; k++) {
        const a = V[k], b = V[(k + 1) % V.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5)), S2 = [];
        for (let i = 0; i < n; i++) S2.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
        let bad = false; for (const p of S2) if (near(p).m < target - 0.02) { bad = true; break; }
        if (!bad) { P.push(a); continue; }
        for (const p of S2) { for (let it = 0; it < 4; it++) { const r = near(p); if (r.m >= target - 0.02) break; const dx = p[0] - r.cp[0], dy = p[1] - r.cp[1], L = Math.hypot(dx, dy) || 1; p[0] = r.cp[0] + dx / L * (r.B + target); p[1] = r.cp[1] + dy / L * (r.B + target); moved++; } P.push(p); }
      }
      return moved ? simplifyLoop(untangle(P), tol) : V;
    }
    function mkLine(V) { // 闭合折线：段 k = V[k]→V[k+1]，外法线 n
      const n = V.length, sg = ringArea(V) > 0 ? 1 : -1, segs = []; let s = 0;
      for (let k = 0; k < n; k++) { const a = V[k], b = V[(k + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]), tx = (b[0] - a[0]) / len, ty = (b[1] - a[1]) / len; segs.push({ k, a, b, len, tx, ty, nx: sg * ty, ny: -sg * tx, s0: s }); s += len; }
      return { v: V, segs, L: s };
    }
    function nearestOn(pl, x, y) { let best = null; for (const sg of pl.segs) { const f = clamp((x - sg.a[0]) * sg.tx + (y - sg.a[1]) * sg.ty, 0, sg.len), px = sg.a[0] + sg.tx * f, py = sg.a[1] + sg.ty * f, d = Math.hypot(x - px, y - py); if (!best || d < best.d) best = { sg, f, p: [px, py], d, s: sg.s0 + f }; } return best; }
    const wallRegions = R.filter(g => WL.regions.includes(g.name) && (g.name !== 'ninomaru' || g === NINO));
    S.loops = [];
    for (const g of wallRegions) {
      const E = loopEdgesOf(g); if (E.length < 3) continue;
      const cr = repairLoop(simplifyLoop(untangle(offsetLoop(E, E.map(e => e.B))), WL.simplify), g, 0, WL.simplify), ax = repairLoop(simplifyLoop(untangle(offsetLoop(E, E.map(e => e.B + WL.inset))), WL.simplify), g, WL.inset, WL.simplify);
      if (cr.length < 3 || ax.length < 3) { S.notes.push(g.name + ' 围合线内缩失败'); continue; }
      const bnd = E.map(e => [e.ax, e.ay]); S.loops.push({ g, E, bnd, bbb: bboxOf(bnd), crest: mkLine(cr), axis: mkLine(ax) });
    }
    const loopOf = g => S.loops.find(l => l.g === g);
    // 围合范围（矢量判定）：有围合线的曲轮以围合线外边界为准（颈切线外侧哪怕网格还标着二之丸也不算）
    const inEncl = (g, x, y) => { const lp = loopOf(g); if (!lp) return inReg(g, x, y); return x >= lp.bbb[0] && x <= lp.bbb[2] && y >= lp.bbb[1] && y <= lp.bbb[3] && inRing(x, y, lp.bnd) && inReg(g, x, y); };
    S.inEncl = inEncl; S.offSide = (e, x, y) => e.band || (e.mixed && bandAt(e, x, y));
    // 每个曲轮可供“贴边”的石垣顶线段：围合线用简化后的 crest，其余（内环/小曲轮）用原始边内缩 B
    const crestSegsOf = g => { if (g._cs) return g._cs; const lp = loopOf(g), out = lp ? lp.crest.segs.slice() : []; for (const e of g.edges) { if (!e.B || (lp && e.ring === 0) || e.chord) continue; const a = [e.ax - e.nx * e.B, e.ay - e.ny * e.B], b = [e.bx - e.nx * e.B, e.by - e.ny * e.B]; out.push({ a, b, len: e.len, tx: e.tx, ty: e.ty, nx: e.nx, ny: e.ny }); } return (g._cs = out); };
    // 贴边：建筑每个面若在 snapR 内有平行的石垣顶线，就平移到“最外角离顶线 target”；两个互相垂直的面可同时贴（转角）
    function fitBox(cx, cy, w, d, ang, g, snapR, target) {
      const segs = crestSegsOf(g), c = Math.cos(ang), s = Math.sin(ang); let moved = 0;
      const faces = [[c, s, w / 2, d], [-c, -s, w / 2, d], [-s, c, d / 2, w], [s, -c, d / 2, w]];
      for (let it = 0; it < 4; it++) {
        const mv = [0, 0], used = [];
        for (const [mx, my, h, fl] of faces) {
          const qx = cx + mx * h, qy = cy + my * h; let best = null;
          for (const sg of segs) {
            if (sg.nx * mx + sg.ny * my < 0.985) continue;
            const tq = (qx - sg.a[0]) * sg.tx + (qy - sg.a[1]) * sg.ty; if (tq + fl / 2 < 0.5 || tq - fl / 2 > sg.len - 0.5) continue;
            let dl = 1e9; for (const sd of [-1, 1]) { const px = qx - my * sd * fl / 2, py = qy + mx * sd * fl / 2; dl = Math.min(dl, (sg.a[0] - px) * sg.nx + (sg.a[1] - py) * sg.ny); }
            if (dl < -snapR || dl > snapR) continue;
            if (!best || Math.abs(dl - target) < Math.abs(best - target)) best = dl;
          }
          if (best !== null && Math.abs(best - target) > 0.01 && !used.some(u => Math.abs(u[0] * mx + u[1] * my) > 0.5)) { const k = best - target; mv[0] += mx * k; mv[1] += my * k; used.push([mx, my]); }
        }
        if (!used.length) break; cx += mv[0]; cy += mv[1]; moved += Math.hypot(mv[0], mv[1]);
      }
      return { x: cx, y: cy, moved };
    }
    function frameOnLoop(pl, x, y, need) {
      const pr = nearestOn(pl, x, y); let sg = pr.sg;
      if (sg.len < need) { let bd = 1e9; for (const q of pl.segs) { if (q.len < need) continue; const d = segDist(x, y, q.a[0], q.a[1], q.b[0], q.b[1]); if (d < bd) { bd = d; sg = q; } } }
      const f = clamp((x - sg.a[0]) * sg.tx + (y - sg.a[1]) * sg.ty, need / 2, sg.len - need / 2);
      return { sg, c: [sg.a[0] + sg.tx * f, sg.a[1] + sg.ty * f], t: [sg.tx, sg.ty], nin: [-sg.nx, -sg.ny], ang: Math.atan2(sg.ty, sg.tx) };
    }

    // ---- 门：锚在实测位置 → 吸附到所在围合线的石垣顶线（门外侧面与顶线齐平），门洞垂直于墙 ----
    for (const gsp of SPEC.gates) {
      const g = mainRegion(gsp.region), an = anchorOf(gsp.at, g);
      if (!an) { S.notes.push('门 ' + gsp.name + ' 找不到引用'); continue; }
      const [axp, ayp, bdat] = an;
      const gw = gsp.size ? gsp.size[0] : (bdat ? bdat.w : 8), gd = gsp.size ? gsp.size[1] : (bdat ? bdat.d : 5);
      const fam = gw > 15 ? 'yaguramon' : 'gate', open = Math.min(gsp.width || 8, fam === 'yaguramon' ? Math.max(5, gw * 0.3) : gw - 2 * GS.post);
      const gate = { spec: gsp, name: gsp.name, region: g, z: g.z, w: gw, d: gd, open };
      const lp = loopOf(g);
      if (gsp.internal || !lp) Object.assign(gate, { x: axp, y: ayp, ang: bdat ? bdat.ang : 0, nin: null });
      else {
        let fr;
        if (gsp.neck && S.necks[gsp.id] && S.necks[gsp.id].edge) { // 土桥颈上的门：就在颈切线的石垣顶线上
          const e = S.necks[gsp.id].edge, a = [e.ax - e.nx * e.B, e.ay - e.ny * e.B], need = gw + 2 * GS.margin, f = clamp((axp - a[0]) * e.tx + (ayp - a[1]) * e.ty, need / 2, e.len - need / 2);
          fr = { c: [a[0] + e.tx * f, a[1] + e.ty * f], t: [e.tx, e.ty], nin: [-e.nx, -e.ny], ang: Math.atan2(e.ty, e.tx) };
        } else fr = frameOnLoop(lp.crest, axp, ayp, gw + 2 * GS.margin);
        Object.assign(gate, { x: fr.c[0] + fr.nin[0] * gd / 2, y: fr.c[1] + fr.nin[1] * gd / 2, ang: fr.ang, nin: fr.nin, t: fr.t, c: fr.c, loop: lp });
        gate.moved = Math.hypot(gate.x - axp, gate.y - ayp);
      }
      gate.poly = rectPoly(gate.x, gate.y, gate.w, gate.d, gate.ang);
      const inSign = gate.nin ? Math.sign(-Math.sin(gate.ang) * gate.nin[0] + Math.cos(gate.ang) * gate.nin[1]) : 1;
      const part = addPart({ fam, name: gsp.name, x: gate.x, y: gate.y, ang: gate.ang, w: gate.w, d: gate.d, z: gate.z, poly: gate.poly, region: g.i, gate: gsp.id, open, inSign, axisV: inSign * (-gate.d / 2 + WL.inset), passages: [{ poly: rectPoly(gate.x, gate.y, open, gate.d + 0.6, gate.ang) }] });
      gate.part = part; S.gates.push(gate);
      gate.passage = rectPoly(gate.x, gate.y, open * 0.9, gate.d + 12, gate.ang);
      // 坡道：从门外侧面中点（=门洞中线与石垣顶线的交点）沿外法线射线，直到进入目标曲轮的平顶
      if (gsp.to && gate.nin) {
        const out = [-gate.nin[0], -gate.nin[1]], p0 = [gate.x + out[0] * gate.d / 2, gate.y + out[1] * gate.d / 2];
        let p1 = null, tgt = null; const zT = L[gsp.to], hw = (gsp.width || 8) / 2;
        const zoneOK = z => z && (gsp.to === 'city' ? (z === BAND || z.name === 'city') : (z.name === gsp.to && !z.band && (gsp.to !== 'ninomaru' || z === NINO)));
        const minLen = gsp.neck ? Math.abs(g.z - zT) / SPEC.ramp.neckGrade : 0;
        for (let s = 2; s <= SPEC.ramp.maxLen; s += 0.5) {
          const x = p0[0] + out[0] * s, y = p0[1] + out[1] * s, rg = zoneAt(x, y);
          if (s >= minLen && zoneOK(rg)) {
            const ok = [-1, 0, 1].every(sd => { const xx = x - out[1] * (hw + SPEC.ramp.endIn) * sd, yy = y + out[0] * (hw + SPEC.ramp.endIn) * sd; return zoneOK(zoneAt(xx, yy)) && Math.abs(heightAt(xx, yy) - zT) < 1e-3 && Math.abs(heightAt(xx + out[0] * SPEC.ramp.endIn, yy + out[1] * SPEC.ramp.endIn) - zT) < 1e-3; });
            if (ok) { p1 = [x, y]; tgt = rg; break; }
          }
          if (rg && rg !== g && !zoneOK(rg) && rg.z > g.z) break;
        }
        const ramp = { gate, via: gsp.via, width: gsp.width || 8, p0, p1, from: g, to: tgt, z0: g.z, z1: zT, toName: gsp.to };
        if (p1) {
          ramp.len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); ramp.grade = Math.abs(ramp.z0 - ramp.z1) / (ramp.len - SPEC.ramp.landing); ramp.ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
          ramp.poly = segPoly(p0[0], p0[1], p1[0], p1[1], ramp.width, 0);
          ramp.part = addPart({ fam: ramp.via, name: gsp.name + (ramp.via === 'bridge' ? '（桥）' : '（土桥）'), x0: p0[0], y0: p0[1], x1: p1[0], y1: p1[1], z0: ramp.z0, z1: ramp.z1, w: ramp.width, ramp: true, gate: gsp.id });
        }
        gate.ramp = ramp; S.ramps.push(ramp);
      }
    }

    // ---- 建筑（实测）：橹类若有面靠近石垣顶线，就平移贴边（外墙面与顶线齐平）----
    const blds = [];
    for (const b of BLD) {
      if (b.type === 'gate') continue;
      const g = zoneAt(b.cx, b.cy) || mainRegion('ninomaru');
      let poly = (b.type === 'tamon' || b.type === 'hall' || b.type === 'kura' || b.type === 'pavilion') && b.fp && b.fp.length >= 3 ? b.fp.map(p => p.slice()) : rectPoly(b.cx, b.cy, b.w, b.d, b.ang);
      if (b.type === 'tenshu') poly = rectPoly(b.cx, b.cy, 40, 36, b.ang);
      let x = b.cx, y = b.cy, snapped = 0;
      if (b.type === 'yagura2') { const f = fitBox(b.cx, b.cy, b.w * 0.92, b.d * 0.92, b.ang, g, SPEC.yagura.snapReal, SPEC.yagura.setback); x = f.x; y = f.y; snapped = f.moved; poly = rectPoly(x, y, b.w * 0.92, b.d * 0.92, b.ang); }
      const p = addPart({ fam: b.type, name: b.name, x, y, ang: b.ang, w: b.w, d: b.d, z: g.z, poly, region: g.i, data: b, real: true, snapped });
      blds.push(p);
    }
    S.yaguraSetback = SPEC.yagura.setback;

    // ---- 失传橹：遗址点吸附到最近的石垣（主方向=附近最长的边，靠近转角就滑到角上），外墙面与石垣顶线齐平 ----
    S.lostPlaced = []; S.lostSkipped = [];
    const SETBACK = SPEC.yagura.setback;
    const nearestCrest = (g, x, y) => { let best = null, m = 1e9; for (const e of g.edges) { if (!e.B || e.band || (e.mixed && bandAt(e, x, y))) continue; const d = segDist(x, y, e.ax, e.ay, e.bx, e.by) - e.B; if (d < m) { m = d; best = e; } } return { e: best, m }; };
    if (opt.lost) for (const ly of D.lost_yagura) {
      const g = zoneAt(ly.x, ly.y); if (!g || g.band || (g.name !== 'honmaru' && g.name !== 'ninomaru')) { S.lostSkipped.push(ly.name + '（不在本丸/二之丸）'); continue; }
      const Yg = SPEC.yagura[g.name], hd = Yg.d / 2;
      const ne = nearestEdge(g, ly.x, ly.y, true);
      if (!ne || ne.d > SPEC.yagura.snapRadius) { S.lostSkipped.push(ly.name + '（离石垣 ' + (ne ? ne.d.toFixed(0) : '?') + ' m，不吸附）'); continue; }
      let dom = ne.e; for (const e of g.edges) { if (!e.B || e.len <= dom.len) continue; if (segDist(ly.x, ly.y, e.ax, e.ay, e.bx, e.by) <= ne.d + 10) dom = e; }
      const ang = Math.atan2(dom.ty, dom.tx); let t = clamp(segT(ly.x, ly.y, dom.ax, dom.ay, dom.bx, dom.by), 0, 1);
      let kind = 'edge';
      const toA = t * dom.len, toB = (1 - t) * dom.len;
      const turnAt = (px, py) => { const o = g.edges.find(e => e !== dom && e.B && ((Math.hypot(e.bx - px, e.by - py) < 0.01) || (Math.hypot(e.ax - px, e.ay - py) < 0.01))); return o ? Math.abs(Math.asin(clamp(dom.tx * o.ty - dom.ty * o.tx, -1, 1))) * 180 / Math.PI + (dom.tx * o.tx + dom.ty * o.ty < 0 ? 90 : 0) : 0; };
      if (toA < SPEC.yagura.cornerRadius && toA <= toB && turnAt(dom.ax, dom.ay) >= SPEC.yagura.cornerTurnDeg) { t = 0; kind = 'corner'; } else if (toB < SPEC.yagura.cornerRadius && turnAt(dom.bx, dom.by) >= SPEC.yagura.cornerTurnDeg) { t = 1; kind = 'corner'; }
      let cx = dom.ax + (dom.bx - dom.ax) * t - dom.nx * (dom.B + SETBACK + hd), cy = dom.ay + (dom.by - dom.ay) * t - dom.ny * (dom.B + SETBACK + hd);
      const probe = () => { const P2 = rectPoly(cx, cy, Yg.w, Yg.d, ang), pts = P2.slice(); for (let k = 0; k < 4; k++) { const a = P2[k], b = P2[(k + 1) % 4]; for (const f of [0.25, 0.5, 0.75]) pts.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); } return pts; };
      // 推：缺退距的点沿“它最近石垣边”的内法线推回；若那条边与橹的主面不平行（非直角转角），改为沿主边滑开，主面保持贴边
      const push = () => { for (let it = 0; it < 60; it++) { let mx = 0, my = 0, worst = 0; for (const q of probe()) { const nc = nearestCrest(g, q[0], q[1]); const inside = inReg(g, q[0], q[1]); const def = inside ? SETBACK - nc.m : SETBACK + Math.abs(nc.m); if (def > worst + 1e-9 && def > 0.01) { worst = def; const e = nc.e, par = Math.abs(e.nx * dom.nx + e.ny * dom.ny) > 0.9 || Math.abs(e.nx * dom.nx + e.ny * dom.ny) < 0.1; if (par) { mx = -e.nx * def; my = -e.ny * def; } else { const k = -(e.nx * dom.tx + e.ny * dom.ty), sg = Math.sign(k) || 1; mx = dom.tx * sg * def / Math.max(0.2, Math.abs(k)); my = dom.ty * sg * def / Math.max(0.2, Math.abs(k)); } } } if (worst <= 0.01) break; cx += mx * 1.02; cy += my * 1.02; } };
      const pull = () => { let dmin = 1e9, e = null; for (const q of probe()) { const nc = nearestCrest(g, q[0], q[1]); if (Math.abs(nc.e.nx * dom.nx + nc.e.ny * dom.ny) < 0.97) continue; if (nc.m < dmin) { dmin = nc.m; e = nc.e; } } if (e && dmin > SETBACK + 0.02 && dmin < 6) { cx += e.nx * (dmin - SETBACK); cy += e.ny * (dmin - SETBACK); } };
      push(); const f = fitBox(cx, cy, Yg.w, Yg.d, ang, g, 6, SETBACK); cx = f.x; cy = f.y; for (let k = 0; k < 4; k++) { push(); pull(); } push();
      const poly = rectPoly(cx, cy, Yg.w, Yg.d, ang);
      const fits = poly.every(q => inReg(g, q[0], q[1]) && crestDist(g, q[0], q[1]) >= SETBACK - 0.05) && Math.hypot(cx - ly.x, cy - ly.y) < SPEC.yagura.snapRadius + 15;
      if (!fits) { S.lostSkipped.push(ly.name + '（石垣顶放不下）'); continue; }
      const clash = S.parts.find(o => o.poly && polysOverlap(shrink(o.poly, 0.05), poly)) || S.gates.find(gt => polysOverlap(gt.passage, poly));
      if (clash) { S.lostSkipped.push(ly.name + '（与 ' + clash.name + ' 冲突）'); continue; }
      const p = addPart({ fam: Yg.fam, name: ly.name.replace(/跡$/, ''), x: cx, y: cy, ang, w: Yg.w, d: Yg.d, z: g.z, poly, region: g.i, lost: true, snap: kind, src: [ly.x, ly.y] });
      S.lostPlaced.push(p);
    }

    // ---- 枡形：外门（高丽门）在防御线上；门内方院由“射线碰到的建筑/防御线”或默认边长围出；
    //      方院三边生成石垣矮墙，遇建筑/防御线截断（端头正好顶在面上）；里门（渡橹门）开在侧边 → 直角转折 ----
    const MS = SPEC.masugata, solidsNow = () => S.parts.filter(p => p.poly && !p.wall && !p.ramp);
    function freeRuns(a, b, ok, step) {
      const Lg = Math.hypot(b[0] - a[0], b[1] - a[1]), N = Math.max(1, Math.ceil(Lg / step)), P = f => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], fl = [];
      for (let k = 0; k <= N; k++) fl.push(ok(...P(k / N)));
      const edge = (f0, f1) => { let lo = f0, hi = f1; const v0 = ok(...P(lo)); for (let it = 0; it < 14; it++) { const m = (lo + hi) / 2; if (ok(...P(m)) === v0) lo = m; else hi = m; } return v0 ? lo : hi; };
      const runs = []; let k = 0;
      while (k <= N) { if (!fl[k]) { k++; continue; } let k2 = k; while (k2 + 1 <= N && fl[k2 + 1]) k2++; const f0 = k === 0 ? 0 : edge((k - 1) / N, k / N), f1 = k2 === N ? 1 : edge(k2 / N, (k2 + 1) / N); runs.push([f0, f1, P(f0), P(f1)]); k = k2 + 1; }
      return runs;
    }
    for (const gate of S.gates) {
      const m = gate.spec.masugata; if (!m || !gate.nin) continue;
      const g = gate.region, c = gate.c, v0 = WL.inset + WL.t / 2, MT = MS.wallT, inner = m.inner === 'building' ? S.parts.find(p => p.name === m.innerName) : null;
      let t = gate.t, n = gate.nin;
      if (inner) { // 方院轴向跟随内侧建筑（渡橹/多门橹）的主轴：墙与建筑面平行，端头正好顶齐
        const ca = Math.cos(inner.ang), sa = Math.sin(inner.ang), ax2 = [[ca, sa], [-sa, ca]].sort((p, q) => Math.abs(q[0] * t[0] + q[1] * t[1]) - Math.abs(p[0] * t[0] + p[1] * t[1]))[0], sg = Math.sign(ax2[0] * t[0] + ax2[1] * t[1]) || 1;
        const t2 = [ax2[0] * sg, ax2[1] * sg]; if (Math.abs(t2[0] * t[0] + t2[1] * t[1]) > Math.cos(25 * Math.PI / 180)) { t = t2; n = [-t[1], t[0]]; if (n[0] * gate.nin[0] + n[1] * gate.nin[1] < 0) n = [-n[0], -n[1]]; }
      }
      const at = (u, v) => [c[0] + t[0] * u + n[0] * v, c[1] + t[1] * u + n[1] * v];
      const sol = solidsNow().filter(p => p !== gate.part);
      const hitAt = (x, y) => { if (!inEncl(g, x, y) || crestDist(g, x, y) < v0 - 0.01) return 'wall'; for (const p of sol) if (inPoly(x, y, p.poly)) return p; return null; };
      const ray = (u, v, du, dv, maxL) => { for (let s = 0; s <= maxL; s += 0.25) { const h = hitAt(...at(u + du * s, v + dv * s)); if (h) return { s, h }; } return null; };
      const reach = inner ? MS.maxReach : m.size;
      const rd = ray(0, gate.d, 0, 1, reach); let vmax = rd ? gate.d + rd.s : m.size;
      const vmid = (gate.d + vmax) / 2, rp = ray(0, vmid, 1, 0, inner ? reach : m.size / 2 + MT + 0.5), rm = ray(0, vmid, -1, 0, inner ? reach : m.size / 2 + MT + 0.5); // 防御线就在一墙厚之内 → 那一侧由防御线围住
      const umax = rp ? rp.s : m.size / 2, umin = rm ? -rm.s : -m.size / 2;
      const M = { court: [at(umin, v0), at(umax, v0), at(umax, vmax), at(umin, vmax)], walls: [], umin, umax, vmax, gate };
      gate.masugata = M;
      if (vmax - gate.d < 6 || umax - umin < gate.w) { S.notes.push(gate.name + ' 枡形方院太小'); continue; }
      // 里门：优先穿过指定的内侧建筑（渡橹/多门橹），否则在更靠内的一侧新建渡橹门
      const sides = [{ sd: 1, hit: rp }, { sd: -1, hit: rm }].filter(q => !(q.hit && q.hit.h === 'wall'));
      let ig = null;
      if (inner) {
        let best = null;
        for (const q of sides) { const u = q.sd > 0 ? umax + MT / 2 : umin - MT / 2, runs = freeRuns(at(u, gate.d), at(u, vmax), (x, y) => inPoly(x, y, inner.poly), 0.25); const cov = runs.reduce((s, r) => s + (r[1] - r[0]), 0); if (cov > 0.3 && (!best || cov > best.cov)) best = { q, u, runs, cov }; }
        if (best) {
          const r = best.runs.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0], vc = gate.d + (vmax - gate.d) * (r[0] + r[1]) / 2, dir = [t[0] * best.q.sd, t[1] * best.q.sd];
          let len = 0; const [sx, sy] = at(best.q.sd > 0 ? umax : umin, vc); while (len < 60 && (len < 1 || inPoly(sx + dir[0] * len, sy + dir[1] * len, inner.poly))) len += 0.25;
          len += 0.6; const pc = [sx + dir[0] * (len / 2 - 0.3), sy + dir[1] * (len / 2 - 0.3)], pang = Math.atan2(dir[1], dir[0]) + Math.PI / 2;
          inner.passages = (inner.passages || []).concat([{ poly: rectPoly(pc[0], pc[1], gate.open, len, pang), x: pc[0], y: pc[1], ang: pang, w: gate.open, len }]);
          inner.masugataOf = gate.spec.id; ig = { part: inner, side: best.q.sd, c: pc, dir };
        }
      } else {
        // 渡橹门放在侧边上（与外门成直角），尽量靠后角；方院太浅（例如在窄土桥颈里）就逐步加深，直到侧边有地方放
        const score = sd => { const [x, y] = at(sd > 0 ? umax + 14 : umin - 14, vmid); return inReg(g, x, y) ? crestDist(g, x, y) - (sol.some(p => polyDist(x, y, p.poly) < 4) ? 50 : 0) : -1e9; };
        const iang = Math.atan2(n[1], n[0]), lpA = loopOf(g).axis, clearAxis = (x, y) => nearestOn(lpA, x, y).d >= WL.t / 2 + 0.05;
        const free0 = (x, y) => inEncl(g, x, y) && crestDist(g, x, y) >= v0 + 0.05 && clearAxis(x, y) && !sol.some(p => inPoly(x, y, p.poly));
        const fitsAt = (u, vc) => { const R4 = rectPoly(...at(u, vc), 12, 7, iang), pts = [at(u, vc)]; for (let k = 0; k < 4; k++) { const a = R4[k], b = R4[(k + 1) % 4]; for (let f = 0; f < 1; f += 0.1) pts.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); } return pts.every(([x, y]) => free0(x, y)); };
        // 渡橹门前方（朝外门一侧）剩下的侧墙段：要么没有（门顶着防御线），要么 ≥1 間且不是贴着防御线的重复墙
        const frontOK = (u, vc) => { let Lf = 0; for (let v = vc - 6 - 0.05; v > -2; v -= 0.1) { if (!free0(...at(u, v))) break; Lf += 0.1; } if (Lf < 0.3) return true; if (Lf < KEN) return false; let far = 0; for (let v = vc - 6; v > vc - 6 - Lf; v -= 0.5) far = Math.max(far, nearestOn(lpA, ...at(u, v)).d); return far > MS.wallT / 2 + WL.t / 2 + 0.5; };
        let pick = null;
        for (let vt = vmax; vt <= MS.maxReach && !pick; vt += 2) for (const sd of [1, -1].sort((a, b) => score(b) - score(a))) {
          // 候选：① 顶到后角 ② 紧贴防御线（门前段为 0，必要时加深方院让后段 ≥1 間）③ 中间（两侧剩余墙段都 ≥1 間）
          const u = sd > 0 ? umax + MT / 2 : umin - MT / 2, vb = vt + MT / 2, cands = [[vt + MT - 6, vt]];
          let lo = null; for (let vc = v0 + 5.5; vc <= MS.maxReach; vc += 0.5) if (fitsAt(u, vc)) { lo = vc; break; }
          if (lo !== null) { let a = lo - 0.5, b = lo; for (let it = 0; it < 12; it++) { const m2 = (a + b) / 2; if (fitsAt(u, m2)) b = m2; else a = m2; } cands.push([b, Math.max(vt, b + 6 + KEN)]); }
          for (let vc = vb - 6 - KEN - MT / 2; vc >= v0 + 6 + KEN; vc -= 0.5) cands.push([vc, vt]);
          for (const [vc, vt2] of cands) if (vt2 <= MS.maxReach && fitsAt(u, vc) && frontOK(u, vc)) { pick = { sd, u, vc, vt: vt2 }; break; }
          if (pick) break;
        }
        if (!pick) { S.notes.push(gate.name + ' 枡形侧边放不下渡橹门'); continue; }
        vmax = pick.vt; M.vmax = vmax; M.court = [at(umin, v0), at(umax, v0), at(umax, vmax), at(umin, vmax)];
        const [ix, iy] = at(pick.u, pick.vc);
        const part = addPart({ fam: 'yaguramon', name: m.innerName, x: ix, y: iy, ang: iang, w: 12, d: 7, z: g.z, poly: rectPoly(ix, iy, 12, 7, iang), region: g.i, masugataOf: gate.spec.id, open: gate.open, passages: [{ poly: rectPoly(ix, iy, gate.open, 7.6, iang) }] });
        ig = { part, side: pick.sd, c: [ix, iy], dir: [t[0] * pick.sd, t[1] * pick.sd] };
      }
      M.innerGate = ig;
      // 三边墙线（侧墙从防御线内侧面一直到后墙外侧；后墙夹在两侧墙之间；没有侧墙的一侧后墙向外延伸到被截断为止）
      const sol2 = solidsNow().filter(p => p !== gate.part);
      const okAt = (x, y) => inEncl(g, x, y) && crestDist(g, x, y) >= v0 - 0.01 && !sol2.some(p => inPoly(x, y, p.poly));
      // 转角斜接：侧墙到后墙中线为止，后墙到侧墙中线为止 → 两段墙端在同一点相接
      const lines = [], vb = vmax + MT / 2;
      if (inner) {
        const hasP = !(rp && rp.h === 'wall'), hasM = !(rm && rm.h === 'wall');
        if (hasP) lines.push({ a: at(umax + MT / 2, -2), b: at(umax + MT / 2, vb), jb: true });
        if (hasM) lines.push({ a: at(umin - MT / 2, -2), b: at(umin - MT / 2, vb), jb: true });
        if (rd && rd.h === inner) {
          // 后边由内侧建筑围住；开着的那一角：从建筑在方院一侧最近的角，连到防御线内侧面上最近的点（连接墙）
          for (const sd of [hasP ? null : 1, hasM ? null : -1]) { if (!sd) continue;
            const Q = at(sd > 0 ? umax : umin, vmax); let A = null, dA = 1e9; for (const v of inner.poly) { const d = Math.hypot(v[0] - Q[0], v[1] - Q[1]); if (d < dA) { dA = d; A = v; } }
            const pr = nearestOn(loopOf(g).axis, Q[0], Q[1]), Bp = [pr.p[0] - pr.sg.nx * WL.t / 2, pr.p[1] - pr.sg.ny * WL.t / 2];
            if (Math.hypot(Bp[0] - A[0], Bp[1] - A[1]) < MS.maxReach / 2) lines.push({ a: A, b: Bp, conn: true });
          }
        } else lines.push({ a: at(umin - MT / 2, vb), b: at(umax + MT / 2, vb), ja: hasM, jb: hasP });
      } else {
        // 两侧墙 + 后墙（斜接）；侧墙上只保留“从方院中线横看过去看得见”的段（防御线另一侧的不要）
        for (const sd of [1, -1]) { const u = sd > 0 ? umax + MT / 2 : umin - MT / 2; lines.push({ a: at(u, -2), b: at(u, vb), jb: true, vis: sd }); }
        lines.push({ a: at(umin - MT / 2, vb), b: at(umax + MT / 2, vb), ja: true, jb: true });
      }
      const visible = (sd, x, y) => { const v = (x - c[0]) * n[0] + (y - c[1]) * n[1], uu = Math.abs((x - c[0]) * t[0] + (y - c[1]) * t[1]) - MT / 2 - 0.3; for (let s2 = 0; s2 <= uu; s2 += 0.5) { const h = hitAt(...at(sd * s2, v)); if (h === 'wall') return false; } return true; };
      for (const ln of lines) for (const r of (ln.conn ? [[0, 1, ln.a, ln.b]] : freeRuns(ln.a, ln.b, okAt, 0.2))) {
        const len = (r[1] - r[0]) * Math.hypot(ln.b[0] - ln.a[0], ln.b[1] - ln.a[1]); if (len < 0.3) continue;
        if (ln.vis && !visible(ln.vis, (r[2][0] + r[3][0]) / 2, (r[2][1] + r[3][1]) / 2)) continue;
        const w = { fam: 'mwall', name: gate.name + '枡形', x0: r[2][0], y0: r[2][1], x1: r[3][0], y1: r[3][1], z: gate.z, t: MT, h: MS.wallH, region: g.i, wall: true, masugataOf: gate.spec.id, j0: ln.ja && r[0] < 1e-6 ? 'joint' : 'face', j1: ln.jb && r[1] > 1 - 1e-6 ? 'joint' : 'face' };
        w.poly = segPoly(w.x0, w.y0, w.x1, w.y1, w.t); M.walls.push(w);
      }
    }

    // ---- 地基整平：门、橹、建筑（先于坡道；坡道不改已锁定格点）----
    for (const p of S.parts) if (p.poly) p.refused = settle(p.poly, p.z, 2);

    // ---- 防御线上的“槽位序列”：沿墙轴线，被门/橹/建筑占住的区间之外全部是土塀，端头正好顶到相邻部件的面上 ----
    S.dobei = []; S.runs = [];
    const clipIn = (a, b, P) => { // 线段 a→b 落在多边形 P 内的参数区间
      const ts = [0, 1];
      for (let i = 0; i < P.length; i++) { const r = segX(a, b, P[i], P[(i + 1) % P.length]); if (r && r[0] > 0 && r[0] < 1 && r[1] >= 0 && r[1] <= 1) ts.push(r[0]); }
      ts.sort((p, q) => p - q); const out = [];
      for (let k = 0; k + 1 < ts.length; k++) { if (ts[k + 1] - ts[k] < 1e-9) continue; const m = (ts[k] + ts[k + 1]) / 2; if (inPoly(a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, P)) { if (out.length && Math.abs(out[out.length - 1][1] - ts[k]) < 1e-9) out[out.length - 1][1] = ts[k + 1]; else out.push([ts[k], ts[k + 1]]); } }
      return out;
    };
    for (const lp of S.loops) {
      const ax = lp.axis, occ = solidsNow().map(p => ({ p, bb: bboxOf(p.poly) })), cov = [];
      for (const sg of ax.segs) { const sb = bboxOf([sg.a, sg.b]); for (const o of occ) { if (!bbHit(sb, o.bb, 0.1)) continue; for (const [f0, f1] of clipIn(sg.a, sg.b, o.p.poly)) cov.push([sg.s0 + f0 * sg.len, sg.s0 + f1 * sg.len, o.p]); } }
      cov.sort((a, b) => a[0] - b[0]);
      const merged = []; for (const c2 of cov) { const last = merged[merged.length - 1]; if (last && c2[0] <= last[1] + 0.02) { if (c2[1] > last[1]) { last[1] = c2[1]; last.p1 = c2[2]; } } else { const q = [c2[0], c2[1]]; q.p0 = c2[2]; q.p1 = c2[2]; merged.push(q); } }
      const Lx = ax.L, free = [];
      if (!merged.length) free.push([0, Lx, null, null, true]);
      else for (let k = 0; k < merged.length; k++) { const a = merged[k], b = merged[(k + 1) % merged.length], s0 = a[1], s1 = k + 1 < merged.length ? b[0] : b[0] + Lx; if (s1 - s0 > 0.02) free.push([s0, s1, a.p1, b.p0]); }
      const ptAt = s => { s = ((s % Lx) + Lx) % Lx; let lo = 0, hi = ax.segs.length - 1; while (lo < hi) { const md = (lo + hi + 1) >> 1; if (ax.segs[md].s0 <= s) lo = md; else hi = md - 1; } const sg = ax.segs[lo], f = s - sg.s0; return [sg.a[0] + sg.tx * f, sg.a[1] + sg.ty * f]; };
      for (const [s0, s1, pa, pb, closed] of free) {
        const pts = [ptAt(s0)], ss = [s0];
        for (const lap of [0, Lx]) for (const sg of ax.segs) { const sv = sg.s0 + lap; if (sv > s0 + 0.02 && sv < s1 - 0.02) { pts.push(sg.a.slice()); ss.push(sv); } }
        const order = ss.map((s, i) => i).sort((i, j) => ss[i] - ss[j]); const P2 = order.map(i => pts[i]); P2.push(ptAt(s1));
        const run = { id: S.runs.length, loop: lp, s0, s1, len: s1 - s0, from: pa, to: pb, closed: !!closed, segs: [] }; S.runs.push(run);
        for (let k = 0; k + 1 < P2.length; k++) {
          const a = P2[k], b = P2[k + 1]; if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.01) continue;
          const w = { fam: 'dobei', name: '土塀', x0: a[0], y0: a[1], x1: b[0], y1: b[1], z: lp.g.z, t: WL.t, h: WL.h, region: lp.g.i, wall: true, run: run.id, j0: k === 0 && !closed ? 'face' : 'joint', j1: k + 2 === P2.length && !closed ? 'face' : 'joint', a0: k === 0 ? pa : null, a1: k + 2 === P2.length ? pb : null };
          w.poly = segPoly(w.x0, w.y0, w.x1, w.y1, w.t); run.segs.push(addPart(w)); S.dobei.push(w);
        }
      }
    }
    // 枡形墙：碎墙(<1間)不建；剩下的墙端若没顶到东西，沿轴线最多伸 1 間去够最近的墙/建筑
    {
      const touch = (w, x, y) => S.parts.some(o => o !== w && o.poly && !o.ramp && polyDist(x, y, o.poly) <= 0.05) || S.gates.some(gt => gt.masugata && gt.masugata.walls.some(o => o !== w && polyDist(x, y, o.poly) <= 0.05));
      // 整段都贴着防御线（离墙轴线不到一墙厚）的枡形墙是重复的，不建
      const hugs = w => { const lp = loopOf(S.regions[w.region]); if (!lp) return false; for (let f = 0; f <= 1; f += 0.1) { const pr = nearestOn(lp.axis, w.x0 + (w.x1 - w.x0) * f, w.y0 + (w.y1 - w.y0) * f); if (pr.d > MS.wallT / 2 + WL.t / 2 + 0.5) return false; } return true; };
      for (const gate of S.gates) if (gate.masugata) gate.masugata.walls = gate.masugata.walls.filter(w => Math.hypot(w.x1 - w.x0, w.y1 - w.y0) >= KEN && !hugs(w));
      for (const gate of S.gates) if (gate.masugata) for (const w of gate.masugata.walls) for (const end of [0, 1]) {
        const L = Math.hypot(w.x1 - w.x0, w.y1 - w.y0), dx = (w.x1 - w.x0) / L * (end ? 1 : -1), dy = (w.y1 - w.y0) / L * (end ? 1 : -1), kx = end ? 'x1' : 'x0', ky = end ? 'y1' : 'y0';
        if (touch(w, w[kx], w[ky])) continue;
        for (let e = 0.05; e <= KEN; e += 0.05) if (touch(w, w[kx] + dx * e, w[ky] + dy * e)) { w[kx] += dx * e; w[ky] += dy * e; w.poly = segPoly(w.x0, w.y0, w.x1, w.y1, w.t); break; }
      }
      for (const gate of S.gates) if (gate.masugata) gate.masugata.walls = gate.masugata.walls.map(w => addPart(w));
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
    const passPolys = S.gates.map(g => g.passage).concat(S.gates.filter(g => g.masugata).map(g => g.masugata.court), ...S.parts.filter(p => p.passages).map(p => p.passages.map(q => q.poly)));
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
        if (tr.z < WZ + 0.3 || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => Math.abs(surfaceAt(x + dx * tr.r * 0.5, y + dy * tr.r * 0.5) - tr.z) > SPEC.walk.slope * tr.r * 0.5)) continue; // 树根要在平地上
        S.trees.push(tr); const k = tk(x, y); let A = TG.get(k); if (!A) TG.set(k, A = []); A.push(tr); placed++;
      }
    }

    // ---- 标注 ----
    for (const p of S.parts) if (p.name && p.fam !== 'dobei' && p.fam !== 'mwall' && !p.ramp) S.labels.push({ text: p.name, x: p.x, y: p.y, z: p.z + ({ tenshu: 62, yagura3: 22, yagura2: 17, yaguramon: 15, gate: 10, tamon: 14 }[p.fam] || 10), lost: !!p.lost, fam: p.fam });

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
    { id: 'H11', name: '支撑：整个底面落在台地顶（不悬空、不压石垣斜面）' },
    { id: 'H12', name: '闭合：防御线连续，墙端都顶到墙/门/建筑（≤0.2 m），无碎墙(<1間)' },
    { id: 'H13', name: '石垣边：边上建筑外墙面与顶线齐平(≤0.3 m)或退后有土塀，不外挑' },
    { id: 'H14', name: '通行：门内外都有≥门洞宽、坡度≤30% 的路，坡道轴线穿门洞中心' },
  ];
  function audit(S) {
    const cnt = {}, items = []; RULES.forEach(r => cnt[r.id] = 0);
    const bad = (id, o, msg) => { cnt[id]++; if (o) o.bad = true; if (items.length < 400) items.push({ rule: id, name: o ? (o.name || o.fam) : '', msg, x: o ? (o.x !== undefined ? o.x : o.x0) : null, y: o ? (o.y !== undefined ? o.y : o.y0) : null }); };
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
    const walls = P.filter(p => p.wall), body = w => { const L = Math.hypot(w.x1 - w.x0, w.y1 - w.y0), tx = (w.x1 - w.x0) / L, ty = (w.y1 - w.y0) / L, cut = j => j === 'joint' ? w.t / 2 + 0.05 : j === 'face' ? Math.min(w.t / 2, 0.5) + 0.05 : 0, a0 = Math.min(cut(w.j0), L / 2 - 0.01), a1 = Math.min(cut(w.j1), L / 2 - 0.01); return segPoly(w.x0 + tx * a0, w.y0 + ty * a0, w.x1 - tx * a1, w.y1 - ty * a1, w.t - 0.04); };
    const wb = walls.map(body), wbb = wb.map(bboxOf);
    // 墙端斜着抵在某个面上，会有 t/2·cotφ 的一角顶进去（φ=墙轴与被抵面的夹角）：这是抵接，不算穿插
    const solidsAll = P.filter(p => p.poly && !p.ramp);
    const abut = (w, x, y) => { let best = null, bd = SPEC.wall.contact; for (const o of solidsAll) { if (o === w) continue; const d = polyDist(x, y, o.poly); if (d <= bd) { bd = d; best = o; } } return best; };
    const faceDir = (o, x, y) => { let bd = 1e9, dir = null; for (let i = 0; i < o.poly.length; i++) { const a = o.poly[i], b = o.poly[(i + 1) % o.poly.length], d = segDist(x, y, a[0], a[1], b[0], b[1]); if (d < bd) { bd = d; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; } } return dir; };
    for (const w of walls) { w.ab0 = abut(w, w.x0, w.y0); w.ab1 = abut(w, w.x1, w.y1); }
    const bodyVs = (w, p) => { if (w.ab0 !== p && w.ab1 !== p) return null; const L = Math.hypot(w.x1 - w.x0, w.y1 - w.y0), tx = (w.x1 - w.x0) / L, ty = (w.y1 - w.y0) / L;
      const allow = (x, y) => { const f = faceDir(p, x, y), sn = Math.abs(tx * f[1] - ty * f[0]), cs = Math.abs(tx * f[0] + ty * f[1]); return Math.min(2 * w.t, w.t / 2 * cs / Math.max(0.2, sn) + 0.1); };
      const c0 = w.ab0 === p ? Math.min(allow(w.x0, w.y0), L / 2) : 0, c1 = w.ab1 === p ? Math.min(allow(w.x1, w.y1), L / 2) : 0; return segPoly(w.x0 + tx * c0, w.y0 + ty * c0, w.x1 - tx * c1, w.y1 - ty * c1, w.t - 0.04); };
    for (let i = 0; i < blds.length; i++) for (let j = 0; j < walls.length; j++) if (bbHit(bb[i], wbb[j], 0) && polysOverlap(shrink(blds[i].poly, 0.05), bodyVs(walls[j], blds[i]) || wb[j])) { bad('H2', walls[j], '墙穿过 ' + blds[i].name); blds[i].bad = true; }
    const joined = (a, b) => { for (const [xa, ya, ja] of [[a.x0, a.y0, a.j0], [a.x1, a.y1, a.j1]]) for (const [xb, yb, jb] of [[b.x0, b.y0, b.j0], [b.x1, b.y1, b.j1]]) if (ja === 'joint' && jb === 'joint' && Math.hypot(xa - xb, ya - yb) <= SPEC.wall.contact) return true; return false; };
    for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) if (bbHit(wbb[i], wbb[j], 0) && !joined(walls[i], walls[j]) && polysOverlap(bodyVs(walls[i], walls[j]) || wb[i], bodyVs(walls[j], walls[i]) || wb[j])) { bad('H2', walls[i], '墙与墙相交'); walls[j].bad = true; }
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
    physics(S, bad, walls, blds);
    const total = Object.values(cnt).reduce((a, b) => a + b, 0);
    return { total, cnt, items, rules: RULES };
  }

  // ---------------- r2：通用物理规则 H11–H14（只看几何：支撑采样、接触图、石垣顶线、栅格寻路；不针对具体部件）----------------
  function physics(S, bad, walls, blds) {
    const ken = SPEC.ken, ct = SPEC.wall.contact, ED = SPEC.edge, si = SPEC.support.inset;
    const onTop = (g, x, y) => S.zoneAt(x, y) === g && S.inEncl(g, x, y) && S.crestDist(g, x, y) >= -1e-3;
    // H11 支撑：底面（内缩 si）每个采样点都在本曲轮台地顶上
    for (const p of blds) {
      const g = S.regions[p.region], b = bboxOf(p.poly); let n = 0, badN = 0;
      for (let x = b[0] + 0.25; x <= b[2]; x += 0.75) for (let y = b[1] + 0.25; y <= b[3]; y += 0.75) { if (polyDist(x, y, p.poly) > -si) continue; n++; if (!onTop(g, x, y)) badN++; }
      if (badN) bad('H11', p, badN + '/' + n + ' 个底面采样不在台地顶上（悬空/压石垣斜面）');
    }
    for (const w of walls) {
      const g = S.regions[w.region], L = Math.hypot(w.x1 - w.x0, w.y1 - w.y0), nx = -(w.y1 - w.y0) / L, ny = (w.x1 - w.x0) / L, k = Math.max(1, Math.ceil(L / 0.5)), offs = w.t / 2 > si ? [-(w.t / 2 - si), 0, w.t / 2 - si] : [0]; let badN = 0;
      for (let i = 0; i <= k; i++) for (const o of offs) { const f = i / k, x = w.x0 + (w.x1 - w.x0) * f + nx * o, y = w.y0 + (w.y1 - w.y0) * f + ny * o; if (!onTop(g, x, y)) badN++; }
      if (badN) bad('H11', w, '墙底 ' + badN + ' 个采样不在台地顶上');
    }
    for (const t of S.trees) { let sl = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) sl = Math.max(sl, Math.abs(S.surfaceAt(t.x + dx * t.r * 0.5, t.y + dy * t.r * 0.5) - t.z) / (t.r * 0.5)); if (Math.abs(S.surfaceAt(t.x, t.y) - t.z) > 0.05 || sl > SPEC.walk.slope) bad('H11', t, '树根不在平地上（坡度 ' + (sl * 100).toFixed(0) + '%）'); }
    // H12 闭合：墙端接触、防御线覆盖、碎墙
    const sol = blds.map(p => ({ p, bb: bboxOf(p.poly) })), wl = walls.map(w => ({ w, bb: bboxOf(w.poly) }));
    const near = (bb, x, y, m) => x >= bb[0] - m && x <= bb[2] + m && y >= bb[1] - m && y <= bb[3] + m;
    for (const w of walls) for (const [x, y] of [[w.x0, w.y0], [w.x1, w.y1]]) {
      let ok = false, dmin = 1e9;
      for (const o of wl) { if (o.w === w || !near(o.bb, x, y, ct + 0.5)) continue; const d = Math.min(Math.hypot(o.w.x0 - x, o.w.y0 - y), Math.hypot(o.w.x1 - x, o.w.y1 - y), Math.max(0, polyDist(x, y, o.w.poly))); dmin = Math.min(dmin, d); if (d <= ct) { ok = true; break; } }
      if (!ok) for (const o of sol) { if (!near(o.bb, x, y, ct + 0.5)) continue; const d = Math.max(0, polyDist(x, y, o.p.poly)); dmin = Math.min(dmin, d); if (d <= ct) { ok = true; break; } }
      if (!ok) bad('H12', w, '墙端悬空（离最近的墙/门/建筑 ' + (dmin > 1e8 ? '>1' : dmin.toFixed(2)) + ' m）');
    }
    for (const r of S.runs || []) if (!r.closed && r.len < ken - 1e-6) bad('H12', r.segs[0], '碎墙 ' + r.len.toFixed(2) + ' m < 1 間');
    for (const w of walls) if (w.fam === 'mwall' && Math.hypot(w.x1 - w.x0, w.y1 - w.y0) < ken - 1e-6) bad('H12', w, '枡形碎墙 < 1 間');
    for (const lp of S.loops || []) {
      const ax = lp.axis; let gap = null;
      const flush = (s1) => { if (gap && s1 - gap[0] > 0.6) bad('H12', { name: lp.g.name + '防御线', x: gap[1][0], y: gap[1][1] }, '防御线缺口 ' + (s1 - gap[0]).toFixed(1) + ' m（无门、无墙）'); gap = null; };
      for (const sg of ax.segs) for (let f = 0; f < sg.len; f += 0.5) {
        const x = sg.a[0] + sg.tx * f, y = sg.a[1] + sg.ty * f, s = sg.s0 + f;
        let cov = false; for (const o of wl) if (near(o.bb, x, y, 0.1) && polyDist(x, y, o.w.poly) <= 0.05) { cov = true; break; }
        if (!cov) for (const o of sol) if (near(o.bb, x, y, ct) && polyDist(x, y, o.p.poly) <= ct) { cov = true; break; }
        if (!cov && !gap) gap = [s, [x, y]]; else if (cov && gap) flush(s);
      }
      if (gap) flush(ax.L);
    }
    // H12b 枡形方院是封闭的：门关上时，从方院中心洪泛出不去（0.5 m 栅格；建筑/墙/陡坎/水都挡）
    for (const gate of S.gates) { const M = gate.masugata; if (!M || !M.court) continue; const leak = floodLeak(S, M.court); if (leak) bad('H12', { name: gate.name + '枡形', x: leak[0], y: leak[1] }, '枡形方院没有封闭（门关上仍能走出去）'); }
    // H13 石垣边：离石垣顶线 < near 的建筑，外墙面要齐平（≤flush）或退后但前面有土塀；外挑 ≤ overhang
    for (const p of blds) {
      const g = S.regions[p.region], pts = []; for (let i = 0; i < p.poly.length; i++) { const a = p.poly[i], b = p.poly[(i + 1) % p.poly.length]; pts.push(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); }
      let dmin = 1e9, q = null; for (const v of pts) { const d = S.crestDist(g, v[0], v[1]); if (d < dmin) { dmin = d; q = v; } }
      if (dmin >= ED.near) continue;
      if (dmin < -ED.overhang) { bad('H13', p, '外挑出石垣顶线 ' + (-dmin).toFixed(2) + ' m'); continue; }
      if (dmin <= ED.flush) continue;
      let e = null, m = 1e9; for (const ee of g.edges) { if (!ee.B || S.offSide(ee, q[0], q[1])) continue; const d = segDist(q[0], q[1], ee.ax, ee.ay, ee.bx, ee.by) - ee.B; if (d < m) { m = d; e = ee; } }
      let front = false; for (let k = 1; k < 8 && !front; k++) { const f = dmin * k / 8, x = q[0] + e.nx * f, y = q[1] + e.ny * f; for (const o of wl) if (near(o.bb, x, y, 0.1) && polyDist(x, y, o.w.poly) <= 0.05) { front = true; break; } }
      if (!front) bad('H13', p, '离石垣顶线 ' + dmin.toFixed(2) + ' m，前面没有土塀（留缝）');
    }
    // H14 通行
    for (const gate of S.gates) walkCheck(S, gate, bad);
  }
  function floodLeak(S, court) {
    const cs = 0.5, b0 = bboxOf(court), M = 14, x0 = b0[0] - M, y0 = b0[1] - M, nx = Math.ceil((b0[2] - b0[0] + 2 * M) / cs) + 1, ny = Math.ceil((b0[3] - b0[1] + 2 * M) / cs) + 1, N = nx * ny;
    const hs = new Float32Array(N), blk = new Uint8Array(N), lim = SPEC.walk.slope * cs + 0.02;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const q = j * nx + i; hs[q] = S.surfaceAt(x0 + i * cs, y0 + j * cs); if (hs[q] < S.WZ + 0.3) blk[q] = 1; }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const q = j * nx + i; if (i + 1 < nx && Math.abs(hs[q] - hs[q + 1]) > lim) blk[q] = blk[q + 1] = 1; if (j + 1 < ny && Math.abs(hs[q] - hs[q + nx]) > lim) blk[q] = blk[q + nx] = 1; }
    for (const p of S.parts) { if (!p.poly || p.ramp) continue; const b = bboxOf(p.poly); if (b[2] < x0 || b[3] < y0 || b[0] > x0 + nx * cs || b[1] > y0 + ny * cs) continue;
      for (let j = Math.max(0, Math.floor((b[1] - y0) / cs)); j <= Math.min(ny - 1, Math.ceil((b[3] - y0) / cs)); j++) for (let i = Math.max(0, Math.floor((b[0] - x0) / cs)); i <= Math.min(nx - 1, Math.ceil((b[2] - x0) / cs)); i++) if (polyDist(x0 + i * cs, y0 + j * cs, p.poly) < cs * 0.5) blk[j * nx + i] = 1; }
    let cx = 0, cy = 0; for (const p of court) { cx += p[0] / court.length; cy += p[1] / court.length; }
    const s0 = Math.round((cy - y0) / cs) * nx + Math.round((cx - x0) / cs); if (blk[s0]) return null;
    const seen = new Uint8Array(N), st = [s0]; seen[s0] = 1;
    while (st.length) { const q = st.pop(), i = q % nx, j = (q - i) / nx; const x = x0 + i * cs, y = y0 + j * cs; if (x < b0[0] - 8 || x > b0[2] + 8 || y < b0[1] - 8 || y > b0[3] + 8) return [x, y];
      for (const k of [i > 0 ? q - 1 : -1, i < nx - 1 ? q + 1 : -1, j > 0 ? q - nx : -1, j < ny - 1 ? q + nx : -1]) if (k >= 0 && !seen[k] && !blk[k]) { seen[k] = 1; st.push(k); } }
    return null;
  }
  function walkCheck(S, gate, bad) {
    const WK = SPEC.walk, cs = WK.cell, r = gate.ramp, part = gate.part, g = gate.region;
    if (gate.nin && r) {
      if (!r.p1) return; // H5 已报
      const dx = r.p1[0] - r.p0[0], dy = r.p1[1] - r.p0[1], L = Math.hypot(dx, dy), c = gate.c;
      const off = Math.abs((c[0] - r.p0[0]) * dy - (c[1] - r.p0[1]) * dx) / L; if (off > 0.3) bad('H14', part, '坡道轴线偏离门洞中心 ' + off.toFixed(2) + ' m');
      if (Math.abs((dx * gate.t[0] + dy * gate.t[1]) / L) > 0.05) bad('H14', part, '坡道不垂直于门');
      if (r.width < gate.open - 1e-6) bad('H14', part, '坡道宽 ' + r.width + ' m < 门洞 ' + gate.open.toFixed(1) + ' m');
    }
    const pts = [[gate.x, gate.y]]; if (r && r.p1) pts.push(r.p1);
    const b0 = bboxOf(pts), M = WK.margin, x0 = b0[0] - M, y0 = b0[1] - M, nx = Math.ceil((b0[2] - b0[0] + 2 * M) / cs) + 1, ny = Math.ceil((b0[3] - b0[1] + 2 * M) / cs) + 1, N = nx * ny;
    const hs = new Float32Array(N), blk = new Uint8Array(N), lim = WK.slope * cs + 0.02;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const q = j * nx + i; hs[q] = S.surfaceAt(x0 + i * cs, y0 + j * cs); if (hs[q] < S.WZ + 0.3) blk[q] = 1; }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const q = j * nx + i; if (i + 1 < nx && Math.abs(hs[q] - hs[q + 1]) > lim) blk[q] = blk[q + 1] = 1; if (j + 1 < ny && Math.abs(hs[q] - hs[q + nx]) > lim) blk[q] = blk[q + nx] = 1; }
    for (const p of S.parts) {
      if (!p.poly || p.ramp) continue; const b = bboxOf(p.poly); if (b[2] < x0 || b[3] < y0 || b[0] > x0 + nx * cs || b[1] > y0 + ny * cs) continue;
      for (let j = Math.max(0, Math.floor((b[1] - y0) / cs)); j <= Math.min(ny - 1, Math.ceil((b[3] - y0) / cs)); j++) for (let i = Math.max(0, Math.floor((b[0] - x0) / cs)); i <= Math.min(nx - 1, Math.ceil((b[2] - x0) / cs)); i++) {
        const x = x0 + i * cs, y = y0 + j * cs; if (!inPoly(x, y, p.poly)) continue; if (p.passages && p.passages.some(q => inPoly(x, y, q.poly))) continue; blk[j * nx + i] = 1;
      }
    }
    const Dd = new Float32Array(N), s2 = Math.SQRT2; for (let q = 0; q < N; q++) Dd[q] = blk[q] ? 0 : 1e9;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const q = j * nx + i; let v = Dd[q]; if (i > 0) v = Math.min(v, Dd[q - 1] + 1); if (j > 0) { v = Math.min(v, Dd[q - nx] + 1); if (i > 0) v = Math.min(v, Dd[q - nx - 1] + s2); if (i < nx - 1) v = Math.min(v, Dd[q - nx + 1] + s2); } Dd[q] = v; }
    for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) { const q = j * nx + i; let v = Dd[q]; if (i < nx - 1) v = Math.min(v, Dd[q + 1] + 1); if (j < ny - 1) { v = Math.min(v, Dd[q + nx] + 1); if (i < nx - 1) v = Math.min(v, Dd[q + nx + 1] + s2); if (i > 0) v = Math.min(v, Dd[q + nx - 1] + s2); } Dd[q] = v; }
    const need = gate.open / 2 - WK.tol, okc = q => !blk[q] && Dd[q] * cs >= need;
    const si = Math.round((gate.x - x0) / cs), sj = Math.round((gate.y - y0) / cs), s0 = sj * nx + si;
    if (!okc(s0)) { bad('H14', part, '门洞被挡（门洞中心净宽 ' + (2 * Dd[s0] * cs).toFixed(1) + ' m < ' + gate.open.toFixed(1) + ' m）'); return; }
    const seen = new Uint8Array(N), st = [s0]; seen[s0] = 1;
    while (st.length) { const q = st.pop(), i = q % nx, j = (q - i) / nx; for (const k of [i > 0 ? q - 1 : -1, i < nx - 1 ? q + 1 : -1, j > 0 ? q - nx : -1, j < ny - 1 ? q + nx : -1]) if (k >= 0 && !seen[k] && okc(k)) { seen[k] = 1; st.push(k); } }
    const vdir = gate.nin || [-Math.sin(gate.ang), Math.cos(gate.ang)];
    let inOK = false, backOK = false, outOK = !(r && r.p1);
    for (let q = 0; q < N; q++) {
      if (!seen[q]) continue; const i = q % nx, j = (q - i) / nx, x = x0 + i * cs, y = y0 + j * cs, dx = x - gate.x, dy = y - gate.y, dd = Math.hypot(dx, dy), side = dx * vdir[0] + dy * vdir[1];
      if (r && r.p1 && Math.hypot(x - r.p1[0], y - r.p1[1]) < 3) outOK = true;
      if (Math.abs(hs[q] - g.z) < 0.1 && S.zoneAt(x, y) === g) { if (side > 0 && dd >= (gate.nin ? WK.goal : 20)) inOK = true; if (!gate.nin && side < 0 && dd >= 20) backOK = true; }
    }
    if (!inOK) bad('H14', part, '门内走不到' + g.name + '地面（宽≥' + gate.open.toFixed(1) + ' m、坡≤' + WK.slope * 100 + '%）');
    if (!outOK) bad('H14', part, '门外走不到坡道/桥的另一端');
    if (!gate.nin && !backOK) bad('H14', part, '内门另一侧走不通');
  }

  function signature(S) {
    let h = 2166136261; const mix = v => { h ^= Math.round(v * 100) | 0; h = Math.imul(h, 16777619) >>> 0; };
    for (const p of S.parts) { mix(p.x !== undefined ? p.x : p.x0); mix(p.y !== undefined ? p.y : p.y0); mix(p.z !== undefined ? p.z : p.z0); }
    for (const t of S.trees) { mix(t.x); mix(t.y); mix(t.s); }
    for (let q = 0; q < S.H.length; q += 97) mix(S.H[q]);
    return h.toString(16) + '-' + S.parts.length + '-' + S.trees.length;
  }

  G.CASTLE_SITE = { SPEC, RULES, build, audit, rectPoly, segPoly, inPoly, polyDist, _physics: physics };
})(typeof window !== 'undefined' ? window : globalThis);
