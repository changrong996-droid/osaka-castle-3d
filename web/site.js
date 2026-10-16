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
    version: 'web-r7a',
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
    conform: { tol: 0.1, drop: 0.05, floorMax: 0.02, pit: 0.05, batTol: 0.03, batRange: [0.15, 0.3] },   // r6：边线偏差 ≤0.1 m；台地坡度 ≤2%；积水深 ≤5 cm；勾配实测与设计差 ≤0.03、设计值在 0.15–0.3（扇勾配惯例）
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
    ramp: { maxLen: 170, sideSlope: 0.3, earthSlope: 1.5, landing: 2.5, maxGrade: 0.3, endIn: 1.5, neckGrade: 0.08 },
    // 外堀外侧的一圈土地在 OSM 里与二之丸连成一片（土桥=陆地窄颈）。规则：在每个 neck 门处找最窄的横截线（颈），
    // 从二之丸内部种子洪泛，过不了颈的二之丸格点都归为“城下”(city, 0 m)。
    band: { seed: { building: '豊国神社' }, neckSearch: 30, chordMax: 70 },
    yagura: { cornerTurnDeg: 35, cornerRadius: 22, snapRadius: 20, setback: 0.1, snapReal: 10, honmaru: { fam: 'yagura3', w: 13, d: 11 }, ninomaru: { fam: 'yagura2', w: 12, d: 10 } },
    // ---- r5：可步行表面网络 / 桥 / 净空（参数来源见 docs/RULES.md）----
    net: { slope: 0.3, cross: 0.05, tol: 0.6, pocket: 30, noAccess: ['dry'], roadRegions: ['honmaru', 'ninomaru'], dest: ['tenshu', 'hall'], endSnap: 1.5, termReach: 25 },
    bridge: { bear: 1.0, maxSpan: 5.9, deckT: 0.5, pierW: 0.7, pierRow: 0.6, level: 0.1, minPierH: 0.5, cont: 0.1 },   // 木梁跨度 ≤3 間；桥面两端搭在桥台上 ≥1 m
    dobashi: { batMin: 0.2, batMax: 0.4, earth: 1.5, toe: 0.3 },        // 土桥侧面：石垣面（水平/竖直 0.2–0.4）或土坡（≥1.5）；坡脚落到原地面/堀底
    clear: { person: 1.7, margin: 0.4, boat: 2.0 },                      // 步行面以上净高 ≥2.1 m；木桥下水面净空 ≥2 m
    passH: { gate: 5.4, yaguramon: 4.0, tamon: 4.1 },                    // 门洞净高（门楣下沿离地），渲染与审计共用
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
  function polyDist(x, y, P) { // 有符号距离（内负外正）；单遍：边距离平方 + 奇偶穿越（大多边形仍用分桶索引判内外）
    const n = P.length; let d2 = 1e18, inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) { const ax = P[j][0], ay = P[j][1], bx = P[i][0], by = P[i][1], dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; let t = l ? ((x - ax) * dx + (y - ay) * dy) / l : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const ex = x - ax - t * dx, ey = y - ay - t * dy, e = ex * ex + ey * ey; if (e < d2) d2 = e;
      if (n < 24 && (by > y) !== (ay > y) && x < dx * (y - by) / (ay - by) * -1 + bx + 0 * dy) inside = !inside; }
    if (n >= 24) inside = inRing(x, y, P); const d = Math.sqrt(d2); return inside ? -d : d; }
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
    // 石垣顶线距离场（只为提速：边数组 + 包围盒下界剪枝 + 从上一次的最近边开始；结果与逐边计算完全相同）
    const edgeIdx = g => { if (g._ei && g._ei.n === g.edges.length) return g._ei; const E = g.edges, n = E.length, A = new Float64Array(n * 9); E.forEach((e, k) => { A.set([e.ax, e.ay, e.bx, e.by, e.B, Math.min(e.ax, e.bx), Math.min(e.ay, e.by), Math.max(e.ax, e.bx), Math.max(e.ay, e.by)], k * 9); }); return (g._ei = { n, A, last: 0 }); };
    const NC = [0, -1, 0, 0];
    const nearCrest = (g, x, y) => { // → NC = [m = min(d − B), 最近边下标, 最近点 x, y]（复用同一个数组，不分配）
      const I = edgeIdx(g), A = I.A, E = g.edges, n = I.n; let m = 1e9, bi = -1, qx = 0, qy = 0;
      for (let kk = -1; kk < n; kk++) { const k = kk < 0 ? I.last : kk; if (k >= n || (kk >= 0 && k === I.last)) continue; const e = E[k]; if (e.band || (e.mixed && bandAt(e, x, y))) continue;
        const o = k * 9, B = A[o + 4], ddx = Math.max(A[o + 5] - x, 0, x - A[o + 7]), ddy = Math.max(A[o + 6] - y, 0, y - A[o + 8]); if (Math.sqrt(ddx * ddx + ddy * ddy) - B >= m) continue;
        const ax = A[o], ay = A[o + 1], dx = A[o + 2] - ax, dy = A[o + 3] - ay, l = dx * dx + dy * dy; let t = l ? ((x - ax) * dx + (y - ay) * dy) / l : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const px = ax + t * dx, py = ay + t * dy, d = Math.sqrt((x - px) * (x - px) + (y - py) * (y - py)) - B; if (d < m) { m = d; bi = k; qx = px; qy = py; } }
      if (bi >= 0) I.last = bi; NC[0] = m; NC[1] = bi; NC[2] = qx; NC[3] = qy; return NC; };
    const crestDist = (g, x, y) => { const m = nearCrest(g, x, y)[0]; return inReg(g, x, y) ? m : -m; };
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
    const baseAt = (x, y) => { let fx = (x - gs.x0) / c, fy = (y - gs.y0) / c; fx = clamp(fx, 0, NX - 1.0001); fy = clamp(fy, 0, NY - 1.0001); const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, a = j * NX + i, b = a + 1, cc = a + NX, d = cc + 1; return u >= v ? BASE[a] + u * (BASE[b] - BASE[a]) + v * (BASE[d] - BASE[b]) : BASE[a] + v * (BASE[cc] - BASE[a]) + u * (BASE[d] - BASE[cc]); };
    // 高度插值：与渲染网格的三角剖分完全一致（每格对角线 a-d）
    function heightAt(x, y) {
      let fx = (x - gs.x0) / c, fy = (y - gs.y0) / c; fx = clamp(fx, 0, NX - 1.0001); fy = clamp(fy, 0, NY - 1.0001);
      const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, a = j * NX + i, b = a + 1, cc = a + NX, d = cc + 1;
      if (SPL && SPL[a] >= 0) return splitZ(SPT[SPL[a]].tris, gs.x0 + fx * c, gs.y0 + fy * c); // r6：被边线切开的格
      return u >= v ? H[a] + u * (H[b] - H[a]) + v * (H[d] - H[b]) : H[a] + v * (H[cc] - H[a]) + u * (H[d] - H[cc]);
    }
    // ================= r6：地形顺从矢量边线（石垣顶线 / 墙脚线）=================
    // 1.5 m 网格把石垣顶线、墙脚线都变成了台阶。规则：顶线 = 解析扇勾配面到达台地顶的等值线，墙脚线 = 曲轮多边形边（OSM 实测）；
    // 与这两种线相交的格子按线切开（凸块扇形三角化；线在格内拐弯时插入拐点、从拐点扇形），新顶点的高度取解析值（顶线 = 台地顶，墙脚线 = 下层高程）；
    // 被线切开的格子的邻格若没切（例如被坡道改过），把邻格边上的切点也加进去（中心扇形）——网格处处水密。
    // 之后的操作（整平/坡道/桥台）改到某格的角点 → 这一格退回网格三角（审计里算“由别的规则定义的边”，不计入 H19/H21）。
    const CF = SPEC.conform, SPL = new Int32Array(NX * NY).fill(-1), SPT = []; S.splitIdx = SPL; S.splitTris = SPT; S.conform = { cells: 0, split: 0, passive: 0, fallback: 0, dropped: 0, fans: [] };
    const clsTop = k => k === BAND.i ? BAND.z : R[k].z;
    const OZB = new Map(); // 每类的边按 6 m 分桶（只为提速）
    const ozEdges = k => { if (OZB.has(k)) return OZB.get(k); const band = k === BAND.i, regs = band ? RN('ninomaru') : [R[k]], M = new Map();
      for (const g of regs) for (const e of g.edges) { if (!e.B || (band && e.chord)) continue; const m = 7.5, a0 = Math.floor((Math.min(e.ax, e.bx) - m) / 6), a1 = Math.floor((Math.max(e.ax, e.bx) + m) / 6), b0 = Math.floor((Math.min(e.ay, e.by) - m) / 6), b1 = Math.floor((Math.max(e.ay, e.by) + m) / 6); for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) { const kk = a * 100003 + b; let L = M.get(kk); if (!L) M.set(kk, L = []); L.push(e); } }
      OZB.set(k, M); return M; };
    const opZ = (k, x, y) => { // 操作 2 在任意点的解析值（与格点上的写法逐项相同；扇勾配最多退 6 m，所以只看附近的边）
      const band = k === BAND.i, top = clsTop(k); let z = top;
      for (const e of ozEdges(k).get(Math.floor(x / 6) * 100003 + Math.floor(y / 6)) || []) { if (!band && (e.band || (e.mixed && bandAt(e, x, y)))) continue; if (top - e.zl < IG.minDrop) continue;
        const s2 = Math.max(1 / IG.ratio, (top - e.zl) / IG.maxRun), d = segDist(x, y, e.ax, e.ay, e.bx, e.by); if (d >= (top - e.zl) / s2) continue; const hz = e.zl + d * s2; if (hz < z) z = hz; }
      return z; };
    // 台地余量：min(到边的距离 − 该边退距)；≥0 ⇔ 在台地上（opZ = top）。距离是 1-Lipschitz 的，所以余量 > 半段长时整段都在台地上（< −半段长时整段都不在）——只为提速，不改结果
    const opM = (k, x, y) => { const band = k === BAND.i, top = clsTop(k); let m = Infinity; for (const e of ozEdges(k).get(Math.floor(x / 6) * 100003 + Math.floor(y / 6)) || []) { if (!band && e.band) continue; if (!band && e.mixed) return NaN; if (top - e.zl < IG.minDrop) continue; const s2 = Math.max(1 / IG.ratio, (top - e.zl) / IG.maxRun), v = segDist(x, y, e.ax, e.ay, e.bx, e.by) - (top - e.zl) / s2; if (v < m) m = v; } return m; };
    const opZe = (k, x, y) => { const band = k === BAND.i, top = clsTop(k); let z = top, be = null; for (const e of ozEdges(k).get(Math.floor(x / 6) * 100003 + Math.floor(y / 6)) || []) { if (!band && (e.band || (e.mixed && bandAt(e, x, y)))) continue; if (top - e.zl < IG.minDrop) continue; const s2 = Math.max(1 / IG.ratio, (top - e.zl) / IG.maxRun), d = segDist(x, y, e.ax, e.ay, e.bx, e.by); if (d >= (top - e.zl) / s2) continue; const hz = e.zl + d * s2; if (hz < z) { z = hz; be = e; } } return be; };
    const toeSegs = []; for (const g of R) for (const e of g.edges) if (e.B && e.zl < g.z - IG.minDrop + 1e-9) { e.gi = g.i; toeSegs.push(e); } // 墙脚线（OSM 曲轮边 + 颈切线）
    const TADJ = new Map(); toeSegs.forEach((e, n) => { for (const [w, x, y] of [['a', e.ax, e.ay], ['b', e.bx, e.by]]) { const k = w + x.toFixed(6) + ',' + y.toFixed(6); let L = TADJ.get(k); if (!L) TADJ.set(k, L = []); L.push(n); } }); // 端点 → 以它为起点(a)/终点(b)的墙脚段
    const VADJ = new Map(); toeSegs.forEach((e, n) => { for (const [x, y] of [[e.ax, e.ay], [e.bx, e.by]]) { const k = x.toFixed(6) + ',' + y.toFixed(6); let L = VADJ.get(k); if (!L) VADJ.set(k, L = []); L.push(n); } }); // 端点 → 所有在此相接的墙脚段（不分方向、不分曲轮）
    const TB = new Map(); toeSegs.forEach((e, n) => { const b0 = Math.floor((Math.min(e.ax, e.bx) - 1) / 6), b1 = Math.floor((Math.max(e.ax, e.bx) + 1) / 6), c0 = Math.floor((Math.min(e.ay, e.by) - 1) / 6), c1 = Math.floor((Math.max(e.ay, e.by) + 1) / 6); for (let a = b0; a <= b1; a++) for (let b = c0; b <= c1; b++) { const k = a * 100003 + b; let L = TB.get(k); if (!L) TB.set(k, L = []); L.push(n); } });
    const toeNear = (x, y) => TB.get(Math.floor(x / 6) * 100003 + Math.floor(y / 6)) || [];
    const clsAt = (x, y) => { const z = zoneAt(x, y); return z ? (z === BAND ? BAND.i : z.i) : -1; };
    // 格边上的切点（按“从小下标角点到大下标角点”参数化，相邻两格算出来的点逐位相同）
    const EP = new Map(); // key = q*2 + (0 横边 q→q+1 | 1 竖边 q→q+NX) → [{t, x, y, z, kind:'toe'|'crest', id}]
    function edgePts(q, dir) {
      const key = q * 2 + dir; if (EP.has(key)) return EP.get(key);
      const q2 = dir ? q + NX : q + 1, x0 = X(q % NX), y0 = Y((q - q % NX) / NX), x1 = X(q2 % NX), y1 = Y((q2 - q2 % NX) / NX), out = [];
      const tl = []; // 墙脚线交点
      const NA = toeNear(x0, y0), NB = toeNear(x1, y1), rx = x1 - x0, ry = y1 - y0;
      for (const L4 of NA === NB ? [NA] : [NA, NB]) for (const n of L4) { if (L4 === NB && NA !== NB && NA.includes(n)) continue; const e = toeSegs[n], sx = e.bx - e.ax, sy = e.by - e.ay, den = rx * sy - ry * sx; if (Math.abs(den) < 1e-12) continue; const qx = e.ax - x0, qy = e.ay - y0, r0 = (qx * sy - qy * sx) / den, r1 = (qx * ry - qy * rx) / den; // 格边 × 墙脚段（与 segX 同式）
        if (r0 <= 1e-9 || r0 >= 1 - 1e-9 || r1 < -1e-9 || r1 > 1 + 1e-9) continue; tl.push({ t: r0, x: x0 + rx * r0, y: y0 + ry * r0, z: e.zl, kind: 'toe', id: 'T' + e.gi + ':' + e.ring, seg: n }); }
      tl.sort((a, b) => a.t - b.t || a.z - b.z || (a.id < b.id ? -1 : 1)); for (const p of tl) { const L3 = out[out.length - 1]; if (L3 && Math.abs(L3.t - p.t) < 1e-7) continue; out.push(p); } // 两个曲轮的墙脚线重合：只留一条（低的那条）
      if (CLS[q] === CLS[q2] && CLS[q] < 0) { EP.set(key, out); return out; } // 两端都是水：没有顶线（墙脚线照样算：堀底的墙脚线可以穿过两端都是水的格边）
      // 顶线交点：在相邻两个墙脚交点之间的每一小段上，段内属同一类（曲轮/外圈），端点“在台地上”与否不同 → 二分
      const ts = [0].concat(tl.map(p => p.t), [1]);
      for (let k0 = 0; k0 + 1 < ts.length; k0++) { const TA = ts[k0] + (k0 ? 1e-6 : 0), TBn = ts[k0 + 1] - (k0 + 1 < ts.length - 1 ? 1e-6 : 0), tm = (TA + TBn) / 2, cl = tl.length ? clsAt(x0 + (x1 - x0) * tm, y0 + (y1 - y0) * tm) : CLS[q]; if (cl < 0) continue;
        const top = clsTop(cl), plat = t => opZ(cl, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t) >= top - 1e-6;
        { const mg = opM(cl, x0 + (x1 - x0) * tm, y0 + (y1 - y0) * tm), hl = (TBn - TA) * c / 2 + 1e-4; if (mg > hl || mg < -hl) continue; } // 整段在台地上 / 整段不在：没有顶线
        // 段内取 7 个点：一条格边上顶线可能进出两次（凹角的圆弧）
        const NS = 6, tt = []; for (let k = 0; k <= NS; k++) tt.push(TA + (TBn - TA) * k / NS); const st2 = tt.map(plat);
        for (let k = 0; k < NS; k++) { if (st2[k] === st2[k + 1]) continue; const ta = tt[k], tb = tt[k + 1], pa = st2[k];
        // 解析解：面上那一端的最近边 e，到 e 所在直线的距离沿格边线性变化 → 解“距离 = 退距”；复核两侧，不成立再二分
        let t = null; { const tf = pa ? tb : ta, e = opZe(cl, x0 + (x1 - x0) * tf, y0 + (y1 - y0) * tf); if (e) { const s2 = Math.max(1 / IG.ratio, (top - e.zl) / IG.maxRun), Bq = (top - e.zl) / s2, dl = tt => ((x0 + (x1 - x0) * tt - e.ax) * e.nx + (y0 + (y1 - y0) * tt - e.ay) * e.ny), d0 = dl(0), d1 = dl(1);
          if (Math.abs(d1 - d0) > 1e-12) { for (const sg of [1, -1]) { const ts = (sg * Bq - d0) / (d1 - d0); if (ts > ta && ts < tb) { const px = x0 + (x1 - x0) * ts, py = y0 + (y1 - y0) * ts, pr = segT(px, py, e.ax, e.ay, e.bx, e.by); if (pr < 0 || pr > 1) continue; const ep = 1e-5; if (plat(pa ? ts - ep : ts + ep) === pa && plat(pa ? ts + ep : ts - ep) !== pa) { t = ts; break; } } } } } }
        if (t === null) { let lo = ta, hi = tb; for (let it = 0; it < 22; it++) { const m = (lo + hi) / 2; if (plat(m) === pa) lo = m; else hi = m; } t = pa ? lo : hi; }
        out.push({ t, x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, z: top, kind: 'crest', id: 'C' + top, cl }); } } // 顶线按台地高程归类：同高的两个类（例如城下曲轮与城下外圈）的顶线在类边界上连成一条
      out.sort((a, b) => a.t - b.t); EP.set(key, out); return out;
    }
    const cellPoly = q => { // 逆时针：a → 下边 → b → 右边 → d → 上边（反向）→ cc → 左边（反向）
      const a = q, b = q + 1, cc = q + NX, d = cc + 1, V = p => ({ x: X(p % NX), y: Y((p - p % NX) / NX), z: H[p], corner: p });
      return [V(a)].concat(edgePts(a, 0), [V(b)], edgePts(b, 1), [V(d)], edgePts(cc, 0).slice().reverse(), [V(cc)], edgePts(a, 1).slice().reverse()); };
    const triArea = (A, B, C) => ((B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y)) / 2;
    function fanTris(poly, apex) { const out = []; if (apex) { for (let i = 0; i < poly.length; i++) { const A = poly[i], B = poly[(i + 1) % poly.length]; if (A === apex || B === apex) continue; if (Math.abs(triArea(apex, A, B)) > 1e-9) out.push(apex, A, B); } } else for (let i = 1; i + 1 < poly.length; i++) if (Math.abs(triArea(poly[0], poly[i], poly[i + 1])) > 1e-9) out.push(poly[0], poly[i], poly[i + 1]); return out; }
    const pack = L => { const T2 = new Float64Array(L.length * 3); L.forEach((p, i) => { T2[i * 3] = p.x; T2[i * 3 + 1] = p.y; T2[i * 3 + 2] = p.z; }); return T2; };
    let FRq = -1; const FR = (w, ...ex) => { S.conform.why = S.conform.why || {}; S.conform.why[w] = (S.conform.why[w] || 0) + 1; S.conform.fans.push([FRq, w].concat(ex)); }; // fans：没能按线切开的格（[格号, 原因]）
    function splitCell(q) { FRq = q; // 主动切分：返回三角形列表（点对象），或 null（复杂情形 → 由被动切分保证水密）
      const poly = cellPoly(q); if (poly.length === 4) return null;
      const byId = new Map(); for (const p of poly) if (p.id) { const k = p.kind === 'toe' ? 'T' : p.id; let L = byId.get(k); if (!L) byId.set(k, L = []); L.push(p); } // 墙脚线不分曲轮：沿线的连通性决定配对
      const chords = [], dangles = [], cx0 = X(q % NX), cy0 = Y((q - q % NX) / NX), inCell = V => V.x > cx0 - 1e-9 && V.x < cx0 + c + 1e-9 && V.y > cy0 - 1e-9 && V.y < cy0 + c + 1e-9;
      const onSeg = (P, n) => { const e = toeSegs[n]; return segDist(P.x, P.y, e.ax, e.ay, e.bx, e.by) < 1e-7; };
      // 墙脚线：从边上的交点沿折线往格内走（顶点处不分方向、不分曲轮地找下一段；重合的两段算一段），直到走到另一个交点（弦）或折线在格内终止（悬挂端，终点 V 是格内的新顶点）
      // 分叉（三条墙脚线交于一点）：深度优先，先找能走到另一个未配对交点的分支；走到已有弦的内顶点 → 在那里接上（T 形接头）
      const IV = new Map(), corners = poly.filter(p => p.corner !== undefined);
      const toeWalk = (P0, L) => { let fail = 'long';
        const go = (n, path, used, depth) => {
          if (depth > 8) return null;
          const Q = L.find(p => p !== P0 && !p.paired && onSeg(p, n)) || corners.find(p => onSeg(p, n) && Math.hypot(p.x - P0.x, p.y - P0.y) > 1e-7); if (Q) return { path: path.concat([Q]), end: Q };
          const e = toeSegs[n], last = path[path.length - 1], ends = [[e.ax, e.ay], [e.bx, e.by]].filter(([x, y]) => inCell({ x, y }) && Math.hypot(x - last.x, y - last.y) > 1e-7 && !path.some(W => Math.hypot(W.x - x, W.y - y) < 1e-7)); if (ends.length !== 1) { fail = 'ends' + ends.length; return null; }
          const [vx, vy] = ends[0], key = vx.toFixed(6) + ',' + vy.toFixed(6), oth = m => { const f = toeSegs[m]; return f.ax.toFixed(6) + ',' + f.ay.toFixed(6) === key ? [f.bx, f.by] : [f.ax, f.ay]; }, [ox, oy] = oth(n);
          if (IV.has(key)) return { path: path.concat([IV.get(key)]), end: IV.get(key), joint: true };
          const nx2 = new Map(), u2 = new Set(used); for (const m of VADJ.get(key) || []) { if (u2.has(m)) continue; const o = oth(m); if (Math.abs(o[0] - ox) < 1e-6 && Math.abs(o[1] - oy) < 1e-6) { u2.add(m); continue; } /* 与当前段重合 */ const ko = o[0].toFixed(5) + ',' + o[1].toFixed(5), pr = nx2.get(ko); if (pr === undefined || toeSegs[m].zl < toeSegs[pr].zl) nx2.set(ko, m); }
          const zl = Math.min(e.zl, ...[...nx2.values()].map(m => toeSegs[m].zl)), W = { x: vx, y: vy, z: zl, inner: true }, p2 = path.concat([W]);
          if (nx2.size === 0) return { path: p2, end: null }; // 折线在格内终止 → 悬挂端
          for (const m of nx2.values()) { const u3 = new Set(u2); u3.add(m); const r = go(m, p2, u3, depth + 1); if (r && (r.end || nx2.size === 1)) return r; }
          if (nx2.size > 1) fail = 'fork'; return null; };
        return go(P0.seg, [P0], new Set([P0.seg]), 0) || { fail }; };
      // 顶线弦：中点两侧 ±4 cm 若不跨等值线（线在格内拐弯）→ 先试两条控制边退距线的交点（凸角，精确），再沿中垂线找等值线上的点；递归细分（≤4 层）
      // mixed：两端属于同高的不同类 → 台地判定按所在点的类
      const crestPathT = (P0, P1, cl, depth, mixed) => {
        const top = clsTop(cl), f = mixed ? (x, y) => { const k = clsAt(x, y); return k >= 0 && clsTop(k) === top && opZ(k, x, y) >= top - 1e-6; } : (x, y) => opZ(cl, x, y) >= top - 1e-6;
        const okC = (A, B, tl2 = 0.04) => { const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, nx = -(B.y - A.y), ny = B.x - A.x, L2 = Math.hypot(nx, ny) || 1, pl = f(mx, my); return [tl2, -tl2].some(dd => f(mx + nx / L2 * dd, my + ny / L2 * dd) !== pl); };
        if (okC(P0, P1)) return [P0, P1]; if (depth >= 4) return okC(P0, P1, CF.tol * 0.8) ? [P0, P1] : null; // 最后一层：弦与等值线相差 < 8 cm 也接受
        const mx = (P0.x + P1.x) / 2, my = (P0.y + P1.y) / 2, nx = -(P1.y - P0.y), ny = P1.x - P0.x, L2 = Math.hypot(nx, ny) || 1, s0 = f(mx, my); let V = null;
        { const ux = (P1.x - P0.x) / L2, uy = (P1.y - P0.y) / L2, ea = [1, -1, 0].reduce((r2, sg) => r2 || opZe(P0.cl !== undefined ? P0.cl : cl, P0.x + ux * 0.03 + nx / L2 * 0.06 * sg, P0.y + uy * 0.03 + ny / L2 * 0.06 * sg), null), eb = [1, -1, 0].reduce((r2, sg) => r2 || opZe(P1.cl !== undefined ? P1.cl : cl, P1.x - ux * 0.03 + nx / L2 * 0.06 * sg, P1.y - uy * 0.03 + ny / L2 * 0.06 * sg), null); // 两端附近面一侧的控制边
          if (ea && eb && ea !== eb) { const off = e => { const s2 = Math.max(1 / IG.ratio, (top - e.zl) / IG.maxRun), Bq = (top - e.zl) / s2; return [[e.ax - e.nx * Bq - e.tx * 50, e.ay - e.ny * Bq - e.ty * 50], [e.bx - e.nx * Bq + e.tx * 50, e.by - e.ny * Bq + e.ty * 50]]; }, [a0, a1] = off(ea), [b0, b1] = off(eb), r = segX(a0, a1, b0, b1);
            if (r) { const W = { x: a0[0] + (a1[0] - a0[0]) * r[0], y: a0[1] + (a1[1] - a0[1]) * r[0], z: top, inner: true }; if (inCell(W) && okC(P0, W) && okC(W, P1)) return [P0, W, P1]; } } }
        for (const sd of [1, -1]) { let prev = 0; for (let s = 0.03; s <= 1.5; s += 0.03) { const x = mx + nx / L2 * s * sd, y = my + ny / L2 * s * sd; if (!inCell({ x, y })) break; if (f(x, y) !== s0) { let lo = prev, hi = s; for (let it = 0; it < 24; it++) { const m = (lo + hi) / 2; if (f(mx + nx / L2 * m * sd, my + ny / L2 * m * sd) === s0) lo = m; else hi = m; } V = { x: mx + nx / L2 * hi * sd, y: my + ny / L2 * hi * sd, z: top, inner: true }; break; } prev = s; } if (V) break; }
        if (!V) return okC(P0, P1, CF.tol * 0.8) ? [P0, P1] : null; const A2 = crestPathT(P0, V, cl, depth + 1, mixed), B2 = A2 && crestPathT(V, P1, cl, depth + 1, mixed); return A2 && B2 ? A2.concat(B2.slice(1)) : null; };
      const crestPath = (P0, P1, cl, depth) => crestPathT(P0, P1, cl, depth, P0.cl !== undefined && P1.cl !== undefined && P0.cl !== P1.cl);
      // ① 墙脚线
      const TL = byId.get('T') || []; byId.delete('T');
      for (const P of TL) { if (P.paired) continue; const w = toeWalk(P, TL); if (w.fail) { for (const Q of TL) delete Q.paired; FR('toeGap', w.fail, TL.map(p => p.id + '@' + p.x.toFixed(2) + ',' + p.y.toFixed(2)).join(' ')); return null; } P.paired = true; if (w.end) { w.end.paired = true; chords.push(w.path); } else dangles.push(w.path); for (const W of w.path.slice(1, w.end ? -1 : undefined)) IV.set(W.x.toFixed(6) + ',' + W.y.toFixed(6), W); }
      for (const P of TL) delete P.paired;
      // ② 顶线：成对 → 弦；单个（顶线在格内终止）→ 终点是墙脚线在格内的某个顶点（顶线与墙脚线相交处），按顶线规则检验
      const inner = [].concat(...chords.map(ch => ch.slice(1, -1)), ...dangles.map(d => d.slice(1)));
      // 悬挂顶线的终点：① 墙脚线在格内的顶点；② 墙脚线（下层高程 = 本台地高程的那段，例如二之丸石垣脚下的城下地面）与顶线等值线的交点——插进那条墙脚弦里
      const crestEnd = (P, cl) => { const top = clsTop(cl), cand = inner.slice().sort((A, B) => Math.hypot(A.x - P.x, A.y - P.y) - Math.hypot(B.x - P.x, B.y - P.y));
        for (const V of cand) { const t2 = crestPath(P, { x: V.x, y: V.y, z: V.z, inner: true, cl }, cl, 2); if (t2) { t2[t2.length - 1] = V; return t2; } }
        const plat = (x, y) => opZ(cl, x, y) >= top - 1e-6;
        for (const ch of chords.concat(dangles)) { if (ch[0].kind !== 'toe') continue; for (let k = 0; k + 1 < ch.length; k++) { const A = ch[k], B = ch[k + 1]; if (Math.abs(A.z - top) > 1e-6 || Math.abs(B.z - top) > 1e-6) continue;
          const NS = 8; let pv = plat(A.x, A.y); for (let m = 1; m <= NS; m++) { const t = m / NS, pm = plat(A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t); if (pm !== pv) { let lo = (m - 1) / NS, hi = t; for (let it = 0; it < 30; it++) { const md = (lo + hi) / 2; if (plat(A.x + (B.x - A.x) * md, A.y + (B.y - A.y) * md) === pv) lo = md; else hi = md; }
            const tt = (lo + hi) / 2, W = { x: A.x + (B.x - A.x) * tt, y: A.y + (B.y - A.y) * tt, z: top, inner: true }; if (Math.hypot(W.x - A.x, W.y - A.y) < 1e-6 || Math.hypot(W.x - B.x, W.y - B.y) < 1e-6) break;
            const t2 = crestPath(P, Object.assign({ cl }, W), cl, 2); if (t2) { t2[t2.length - 1] = W; ch.splice(k + 1, 0, W); inner.push(W); return t2; } break; } pv = pm; } } }
        return null; };
      for (const [id, L] of byId) {
        const cl = L[0].cl;
        if (L.length === 2) { const ch = crestPath(L[0], L[1], cl, 0); if (!ch) { FR('noV'); return null; } chords.push(ch); continue; }
        if (L.length === 4) { // 同一条线两进两出：两种配对里取“两条弦都成立”的那一种（直的优先）
          let got = null; for (const pr of [[[0, 1], [2, 3]], [[1, 2], [3, 0]]]) { const c1 = crestPath(L[pr[0][0]], L[pr[0][1]], cl, 0), c2 = c1 && crestPath(L[pr[1][0]], L[pr[1][1]], cl, 0); if (c1 && c2) { if (!got || c1.length + c2.length < got[0].length + got[1].length) got = [c1, c2]; } }
          if (!got) { FR('cnt4'); return null; } chords.push(...got); continue; }
        if (L.length === 1 || L.length === 3) { // 顶线在格内终止（奇数个交点）：轮流把一个交点当作悬挂端，其余成对
          let done = false;
          for (let d = 0; d < L.length && !done; d++) { const rest = L.filter((_, k) => k !== d), pair = rest.length ? crestPath(rest[0], rest[1], cl, 0) : []; if (!pair) continue; const end = crestEnd(L[d], cl); if (!end) continue; if (rest.length) chords.push(pair); chords.push(end); done = true; }
          if (!done) { FR('cnt' + L.length, id, poly.filter(p => p.id).map(p => p.id + '@' + p.x.toFixed(2) + ',' + p.y.toFixed(2)).join(' ')); return null; } continue; }
        FR('cnt' + L.length, id, poly.filter(p => p.id).map(p => p.id + '@' + p.x.toFixed(2) + ',' + p.y.toFixed(2)).join(' ')); return null;
      }
      let pieces = [poly];
      for (const ch of chords) { const A = ch[0], Bq = ch[ch.length - 1], pi = pieces.findIndex(P => P.includes(A) && P.includes(Bq)); if (pi < 0) { FR('piece'); return null; } const P = pieces[pi], i = P.indexOf(A), j = P.indexOf(Bq), inner = ch.slice(1, -1);
        const arc = (u, v) => { const o = []; for (let k = u; ; k = (k + 1) % P.length) { o.push(P[k]); if (k === v) break; } return o; };
        pieces.splice(pi, 1, arc(i, j).concat(inner.slice().reverse()), arc(j, i).concat(inner)); }
      // 悬挂的墙脚线（只支持格内一段直线 P→V）：V 所在的块从 V 扇形三角化（块对 V 星形 ⇔ 每个扇形三角形面积为正）
      const fanned = new Map();
      for (const d of dangles) { if (d.length !== 2) { FR('dangle'); return null; } const V = d[1], pi = pieces.findIndex(P => P.includes(d[0]) && !fanned.has(P) && inPoly(V.x, V.y, P.map(p => [p.x, p.y]))); if (pi < 0) { FR('dangle'); return null; } const P = pieces[pi];
        const T3 = []; for (let i = 0; i < P.length; i++) { const A = P[i], B = P[(i + 1) % P.length], a2 = triArea(V, A, B); if (a2 <= 1e-9) { FR('dangle'); return null; } T3.push(V, A, B); } fanned.set(P, T3); }
      const tris = []; let area = 0;
      for (const P of pieces) { const T3 = fanned.get(P) || earClip(P); if (!T3) { FR('ear'); return null; } for (let k = 0; k < T3.length; k += 3) { const a2 = triArea(T3[k], T3[k + 1], T3[k + 2]); if (a2 < -1e-9) { FR('neg'); return null; } area += a2; } tris.push(...T3); }
      if (Math.abs(area - c * c) > 1e-6) { FR('area'); return null; } return tris;
    }
    function earClip(P0) { // 简单多边形耳切（逆时针）；共线的边点保留为顶点（与邻格共享，水密）
      const P = P0.slice(), out = []; let guard = 0;
      while (P.length > 3 && guard++ < 400) { let cut = false;
        for (let i = 0; i < P.length; i++) { const A = P[(i + P.length - 1) % P.length], B = P[i], C = P[(i + 1) % P.length]; if (triArea(A, B, C) <= 1e-10) continue;
          let inside = false; for (const Q of P) { if (Q === A || Q === B || Q === C) continue; const d1 = triArea(A, B, Q), d2 = triArea(B, C, Q), d3 = triArea(C, A, Q); if (d1 > 1e-12 && d2 > 1e-12 && d3 > -1e-12) { inside = true; break; } } // 严格在内、或正好在对角线 AC 上 → 不是耳
          if (inside) continue; out.push(A, B, C); P.splice(i, 1); cut = true; break; }
        if (!cut) return null; }
      if (P.length === 3) { if (triArea(P[0], P[1], P[2]) > 1e-10) out.push(P[0], P[1], P[2]); else if (triArea(P[0], P[1], P[2]) < -1e-10) return null; }
      return out; }
    function passiveCell(q) { const poly = cellPoly(q); if (poly.length === 4) return null; const a = q, d = q + NX + 1, ctr = { x: X(q % NX) + c / 2, y: Y((q - q % NX) / NX) + c / 2, z: (H[a] + H[d]) / 2, inner: true }; return fanTris(poly, ctr); }
    const setSplit = (q, tris, kind) => { const T2 = pack(tris); if (SPL[q] >= 0) SPT[SPL[q]] = { q, tris: T2, kind, H: [H[q], H[q + 1], H[q + NX], H[q + NX + 1]] }; else { SPL[q] = SPT.length; SPT.push({ q, tris: T2, kind, H: [H[q], H[q + 1], H[q + NX], H[q + NX + 1]] }); } };
    if (opt.conform !== false) {
      const cand = new Uint8Array(NX * NY);
      candScan(H, TAG, cand, NX, NY, WZ);
      for (let q = 0; q < NX * NY; q++) { if (!cand[q]) continue; S.conform.cells++; const T3 = splitCell(q); if (T3) { setSplit(q, T3, 'split'); S.conform.split++; } }
    }
    // 角点被后来的操作改过的格：退回网格；然后给“边上有切点但自己没切”的格做被动切分（水密）
    function revalidate() { for (const sp of SPT.slice()) { if (sp.kind === 'dead') continue; const q = sp.q, cs = [q, q + 1, q + NX, q + NX + 1]; if (sp.kind === 'split' && cs.every(p => TAG[p] === 0 || TAG[p] === 1) && cs.some((p, k) => Math.abs(H[p] - sp.H[k]) > 1e-6)) { const T3 = splitCell(q); if (T3) { setSplit(q, T3, 'split'); continue; } } if (cs.some((p, k) => Math.abs(H[p] - sp.H[k]) > 1e-6 || (TAG[p] !== 0 && TAG[p] !== 1))) { sp.kind = 'dead'; SPL[q] = -1; S.conform.dropped++; if (typeof KILLED !== 'undefined') KILLED.push(q); } } }
    function passivePass() {
      if (opt.conform === false) return; revalidate();
      const live = SPT.filter(sp => sp.kind === 'split'), keep = new Set(live.map(sp => sp.q));
      // 一条格边上的切点“生效” ⇔ 它旁边至少有一个活的主动切分格；没切的格（含退回网格的格）把生效边上的点加进来做中心扇形
      const need = new Set(); for (const sp of live) { const q = sp.q; for (const n of [q - 1, q + 1, q - NX, q + NX]) if (n >= 0 && n < NX * NY && !keep.has(n)) need.add(n); }
      for (const n of need) { if ((n % NX) >= NX - 1 || n >= (NY - 1) * NX) continue;
        // 被动格只取与活格共享的边上的点
        const a = n, b = n + 1, cc = n + NX, d = cc + 1, V = p => ({ x: X(p % NX), y: Y((p - p % NX) / NX), z: H[p], corner: p }), sh = (q2, dir, nb) => keep.has(nb) ? edgePts(q2, dir) : [];
        const poly = [V(a)].concat(sh(a, 0, n - NX), [V(b)], sh(b, 1, n + 1), [V(d)], sh(cc, 0, n + NX).slice().reverse(), [V(cc)], sh(a, 1, n - 1).slice().reverse());
        if (poly.length === 4) continue; const ctr = { x: X(n % NX) + c / 2, y: Y((n - n % NX) / NX) + c / 2, z: (H[a] + H[d]) / 2, inner: true }; setSplit(n, fanTris(poly, ctr), 'passive'); S.conform.passive++; }
    }

    // 操作：整平（settle）——与多边形有重叠的每个三角形，三个顶点都设为 z；已被坡道锁定或原本是水面的格点不动（审计会报出来）
    const settleLog = [], SETTLED = [], KILLED = [];
    function settle(P, z, tag) {
      const bb = bboxOf(P), i0 = Math.max(0, Math.floor((bb[0] - gs.x0) / c) - 1), i1 = Math.min(NX - 2, Math.ceil((bb[2] - gs.x0) / c)), j0 = Math.max(0, Math.floor((bb[1] - gs.y0) / c) - 1), j1 = Math.min(NY - 2, Math.ceil((bb[3] - gs.y0) / c));
      let refused = 0;
      // r6：切开的格按切块判——与多边形重叠的切块若已经在 z 上（台地那一块），什么都不用动；否则这一格退回网格整平。
      // 网格整平改到的角点若属于别的切开格，那一格也退回网格（它若也压在多边形下，再整平一遍），直到不再有新的退回。
      // “真正重叠”= 三角形里有点在多边形内 > 5 cm（只是贴着边线不算——齐顶线的橹正好贴在顶线上）
      const pcx = P.reduce((s3, v) => s3 + v[0], 0) / P.length, pcy = P.reduce((s3, v) => s3 + v[1], 0) / P.length, PIN = P.map(v => { const dx = pcx - v[0], dy = pcy - v[1], L3 = Math.hypot(dx, dy) || 1; return [v[0] + dx / L3 * 0.1, v[1] + dy / L3 * 0.1]; });
      const deepHit = Tk => { if (!triOverlapPoly(Tk, P, bb)) return false; const [A, B2, C2] = Tk; for (const [u, v] of [[0, 0], [1, 0], [0, 1], [0.5, 0], [0, 0.5], [0.5, 0.5], [1 / 3, 1 / 3], [0.15, 0.15], [0.7, 0.15], [0.15, 0.7]]) { const x = A[0] + (B2[0] - A[0]) * u + (C2[0] - A[0]) * v, y = A[1] + (B2[1] - A[1]) * u + (C2[1] - A[1]) * v; if (polyDist(x, y, P) < -0.05) return true; } return PIN.some(v => inPoly(v[0], v[1], Tk)); };
      const splitNeeds = a => { const T2 = SPT[SPL[a]].tris; for (let k = 0; k < T2.length; k += 9) { if (![T2[k + 2], T2[k + 5], T2[k + 8]].some(zz => Math.abs(zz - z) > 1e-4)) continue; const Tk = [[T2[k], T2[k + 1]], [T2[k + 3], T2[k + 4]], [T2[k + 6], T2[k + 7]]]; if (deepHit(Tk)) return true; } return false; };
      const kill = (a, why) => { SPT[SPL[a]].kind = 'dead'; SPL[a] = -1; S.conform.dropped++; KILLED.push(a); };
      if (!settle.replay) SETTLED.push([P, z, tag]);
      const far = (i, j) => polyDist(X(i) + c / 2, Y(j) + c / 2, P) > c * 0.7072; // 格心离多边形超过半对角线 → 这一格与多边形不相交（快速排除）
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const a = j * NX + i; if (SPL[a] < 0 || far(i, j)) continue; if (splitNeeds(a)) kill(a, 'needs'); else if (SPT[SPL[a]].tris.length && (() => { const T2 = SPT[SPL[a]].tris; for (let k = 0; k < T2.length; k += 9) if (triOverlapPoly([[T2[k], T2[k + 1]], [T2[k + 3], T2[k + 4]], [T2[k + 6], T2[k + 7]]], P, bb)) return true; return false; })()) for (const q of [a, a + 1, a + NX, a + NX + 1]) if (!LOCK[q]) LOCK[q] = 4; } // 压在地基下的切开格：角点上“保护锁”（坡道不许改；整平可改）
      for (let guard = 0; guard < 20; guard++) {
        const touched = [];
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const xa = X(i), ya = Y(j), xb = xa + c, yb = ya + c, a = j * NX + i, b = a + 1, cc = a + NX, d = cc + 1; if (SPL[a] >= 0 || far(i, j)) continue;
          for (const [T, ids] of [[[[xa, ya], [xb, ya], [xb, yb]], [a, b, d]], [[[xa, ya], [xb, yb], [xa, yb]], [a, d, cc]]]) {
            if (!triOverlapPoly(T, P, bb)) continue;
            for (const q of ids) { if (CLS[q] < 0 || (LOCK[q] && LOCK[q] !== 4 && LOCK[q] !== tag && Math.abs(H[q] - z) > 1e-4)) { refused++; continue; } if (Math.abs(H[q] - z) > 1e-6) { touched.push(q); } H[q] = z; LOCK[q] = tag; }
          }
        }
        // 被改到角点的切开格：按新的角点高度重新切（顶线/墙脚线不变，只是那一个角点所在的面块跟着变）；切不了、或新的切块压在多边形下 → 退回网格
        let k2 = 0; for (const q of touched) for (const a of [q, q - 1, q - NX, q - NX - 1]) if (a >= 0 && SPL[a] >= 0) { const T3 = splitCell(a); if (T3) { setSplit(a, T3, 'split'); if (!splitNeeds(a)) continue; } kill(a, 'corner'); k2++; }
        if (!k2) break; refused = 0;
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
      const near = p => { const r = nearCrest(g, p[0], p[1]); return { m: r[0], cp: r[1] >= 0 ? [r[2], r[3]] : null, B: r[1] >= 0 ? g.edges[r[1]].B : 0 }; };
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
      const part = addPart({ fam, name: gsp.name, x: gate.x, y: gate.y, ang: gate.ang, w: gate.w, d: gate.d, z: gate.z, poly: gate.poly, region: g.i, gate: gsp.id, open, inSign, axisV: inSign * (-gate.d / 2 + WL.inset), passages: [{ poly: rectPoly(gate.x, gate.y, open, gate.d + 0.6, gate.ang), clearH: SPEC.passH[fam] }] });
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
          inner.passages = (inner.passages || []).concat([{ poly: rectPoly(pc[0], pc[1], gate.open, len, pang), x: pc[0], y: pc[1], ang: pang, w: gate.open, len, clearH: SPEC.passH.tamon }]);
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
          const u = sd > 0 ? umax + MT / 2 : umin - MT / 2, vb = vt + MT / 2, cands = [[Math.min(vt + MT - 6, vt - gate.open / 2), vt]]; // r5：顶到后角时门洞（不是门体）与后墙内面齐平，后墙不挡门洞
          let lo = null; for (let vc = v0 + 5.5; vc <= MS.maxReach; vc += 0.5) if (fitsAt(u, vc)) { lo = vc; break; }
          if (lo !== null) { let a = lo - 0.5, b = lo; for (let it = 0; it < 12; it++) { const m2 = (a + b) / 2; if (fitsAt(u, m2)) b = m2; else a = m2; } cands.push([b, Math.max(vt, b + 6 + KEN)]); }
          for (let vc = vb - 6 - KEN - MT / 2; vc >= v0 + 6 + KEN; vc -= 0.5) cands.push([vc, vt]);
          for (const [vc, vt2] of cands) if (vt2 <= MS.maxReach && fitsAt(u, vc) && frontOK(u, vc)) { pick = { sd, u, vc, vt: vt2 }; break; }
          if (pick) break;
        }
        if (!pick) { S.notes.push(gate.name + ' 枡形侧边放不下渡橹门'); continue; }
        vmax = pick.vt; M.vmax = vmax; M.court = [at(umin, v0), at(umax, v0), at(umax, vmax), at(umin, vmax)];
        const [ix, iy] = at(pick.u, pick.vc);
        const part = addPart({ fam: 'yaguramon', name: m.innerName, x: ix, y: iy, ang: iang, w: 12, d: 7, z: g.z, poly: rectPoly(ix, iy, 12, 7, iang), region: g.i, masugataOf: gate.spec.id, open: gate.open, passages: [{ poly: rectPoly(ix, iy, gate.open, 7.6, iang), clearH: SPEC.passH.yaguramon }] });
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
    revalidate();

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
    // r6：后面的整平把某个切开格退回了网格，而这一格压在前面整平过的地基下 → 重放一遍所有整平，直到不再有新的退回
    const replay = () => { for (let pass = 0; pass < 8 && KILLED.length; pass++) { const K = KILLED.splice(0), kb = K.map(q => [X(q % NX) - c, Y((q - q % NX) / NX) - c, X(q % NX) + 2 * c, Y((q - q % NX) / NX) + 2 * c]); settle.replay = true;
        for (const [P2, z2, tg] of SETTLED) { const b2 = bboxOf(P2); if (kb.some(k => bbHit(k, b2, 0))) settle(P2, z2, tg); } settle.replay = false; revalidate(); } }; // 只重放压在新退回格上的地基
    replay();
    revalidate();

    const rampProf = (r, f) => { const s = f * r.len, l = SPEC.ramp.landing; return s <= l ? r.z0 : r.z0 + (r.z1 - r.z0) * (s - l) / (r.len - l); };
    S.rampProf = rampProf;
    // ---- 操作：坡道（土桥）——路面整平并锁定，两侧放坡；已锁定（地基）格点不动 ----
    for (const r of S.ramps) {
      if (!r.p1 || r.via !== 'dobashi') continue;
      // r5：侧坡按“站在什么上”选勾配——站在护城河底（水/干堀）或原有石垣面上的是石垣面土桥（0.3），站在平地（陆地颈）上的是土坡（1.5，休止角）
      const [x0, y0] = r.p0, [x1, y1] = r.p1, hw = r.width / 2, ss = SPEC.ramp.sideSlope, se = SPEC.ramp.earthSlope, run = Math.max(r.z0, r.z1) - BED;
      const R2 = hw + Math.max(run * ss, (Math.max(r.z0, r.z1) - L.city) * se) + c, bb = [Math.min(x0, x1) - R2, Math.min(y0, y1) - R2, Math.max(x0, x1) + R2, Math.max(y0, y1) + R2];
      const i0 = Math.max(0, Math.floor((bb[0] - gs.x0) / c)), i1 = Math.min(NX - 1, Math.ceil((bb[2] - gs.x0) / c)), j0 = Math.max(0, Math.floor((bb[1] - gs.y0) / c)), j1 = Math.min(NY - 1, Math.ceil((bb[3] - gs.y0) / c));
      const L2 = r.len; let n = 0;
      const moatQ = q => q < 0 || CLS[q] < 0 || TAG[q] === 1 || (R[CLS[q]] && R[CLS[q]].name === 'dry') || BASE[q] < (CLS[q] === BAND.i ? BAND.z : R[CLS[q]] ? R[CLS[q]].z : BED) - 0.5;
      // 每 1 m 一个断面、每侧：土坡在碰到地面之前就会撞上石垣面/护城河 → 这一侧整段做成石垣面（否则土坡会在岸边留下一道土崖）
      const ux = (x1 - x0) / L2, uy = (y1 - y0) / L2, NS = Math.ceil(L2), stoneSide = [new Uint8Array(NS + 1), new Uint8Array(NS + 1)];
      for (let k = 0; k <= NS; k++) { const tk = Math.min(1, k / L2), pz = rampProf(r, tk), cx0 = x0 + (x1 - x0) * tk, cy0 = y0 + (y1 - y0) * tk; for (const [si, sd] of [[0, -1], [1, 1]]) { const oMax = hw + c * 0.75 + Math.max(0, pz - L.city) * se; for (let o = hw + c * 0.75; o <= oMax; o += 0.5) { if (moatQ(vid(cx0 - uy * sd * o, cy0 + ux * sd * o))) { stoneSide[si][k] = 1; break; } } } }
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const q = j * NX + i, x = X(i), y = Y(j); if (LOCK[q] === 2 || LOCK[q] === 3) continue;
        const t = segT(x, y, x0, y0, x1, y1); if (t < -0.02 || t > 1 + 0.5 / L2 * 0 + 0.0) { if (t < -0.02 || t > 1) continue; }
        const tc = clamp(t, 0, 1), d = Math.hypot(x - (x0 + (x1 - x0) * tc), y - (y0 + (y1 - y0) * tc)), prof = rampProf(r, tc);
        if (d <= hw + c * 0.75) { H[q] = prof; LOCK[q] = 1; TAG[q] = 2; n++; }
        else if (d <= R2 && LOCK[q] !== 4) { const side = ((x - x0) * -uy + (y - y0) * ux) > 0 ? 1 : 0, moat = moatQ(q) || stoneSide[side][clamp(Math.round(tc * L2), 0, NS)], hs = prof - (d - hw - c * 0.75) / (moat ? ss : se); if (hs > H[q]) { H[q] = hs; TAG[q] = moat ? 3 : 5; } }
      }
      r.cells = n;
    }
    // r6：坡道路面可能改到压在地基下的切开格（受保护角点）→ 这些格退回网格；再重放一遍整平，让地基下的网格三角整平（与 r5 的“先整平后坡道”结果一致）
    revalidate(); replay();

    // ================= r5：木桥结构（桥面 + 两端桥台 + 桥墩，按“支撑/跨度”规则生成）=================
    // 桥面沿坡道轴线，从门内 bear 处一直铺到对岸平地 bear 处（两端平搭在地面上 = 桥台）；中间每跨 ≤ maxSpan，
    // 桥墩只能落在平整的堀底/地面上（脚下高差 ≤ level），墩顶顶住桥面底。
    const TM = () => (typeof performance !== 'undefined' ? performance : Date).now(); S.tm = { pre: TM() - t0 }; let tq = TM();
    const BRG = SPEC.bridge; S.bridges = [];
    for (const r of S.ramps) {
      if (!r.p1 || r.via !== 'bridge') continue;
      const u = [(r.p1[0] - r.p0[0]) / r.len, (r.p1[1] - r.p0[1]) / r.len], v = [-u[1], u[0]], hw = r.width / 2;
      const topAt = s => s <= 0 ? r.z0 : s >= r.len ? r.z1 : rampProf(r, s / r.len);
      const P = (s, o) => [r.p0[0] + u[0] * s + v[0] * o, r.p0[1] + u[1] * s + v[1] * o];
      const B = { id: S.bridges.length, ramp: r, gate: r.gate, name: r.gate.name, p0: r.p0, p1: r.p1, u, v, hw, w: r.width, len: r.len, s0: -BRG.bear, s1: r.len + BRG.bear, t: BRG.deckT, topAt, P, piers: [] };
      const gmax = s => Math.max(heightAt(...P(s, -hw)), heightAt(...P(s, 0)), heightAt(...P(s, hw)));
      const sup = s => gmax(s) >= topAt(s) - B.t - BRG.level;
      // 桥台（支座）：桥面两端与地面接触的区段 → 地面整平到桥面顶（桥面平搭在桥台上；不在中段切进石垣，也不埋进地面）
      { let a = B.s0; while (a + 0.25 <= B.s1 && sup(a + 0.25)) a += 0.25; let b = B.s1; while (b - 0.25 >= a && sup(b - 0.25)) b -= 0.25;
        for (const [lo, hi] of [[B.s0 - c, a + 0.25 + c], [b - 0.25 - c, B.s1 + c]]) { /* 桥台比接触段再多一格，保证整幅桥面都搭稳 */ const bb = bboxOf([P(lo, -hw - c), P(lo, hw + c), P(hi, -hw - c), P(hi, hw + c)]);
          for (let j = Math.max(0, Math.floor((bb[1] - gs.y0) / c)); j <= Math.min(NY - 1, Math.ceil((bb[3] - gs.y0) / c)); j++) for (let i = Math.max(0, Math.floor((bb[0] - gs.x0) / c)); i <= Math.min(NX - 1, Math.ceil((bb[2] - gs.x0) / c)); i++) {
            const q = j * NX + i, dx = X(i) - r.p0[0], dy = Y(j) - r.p0[1], s = dx * u[0] + dy * u[1], o = dx * v[0] + dy * v[1]; if (s < lo || s > hi || Math.abs(o) > hw + c || CLS[q] < 0) continue;
            const z = topAt(clamp(s, B.s0, B.s1)); if ((LOCK[q] === 2 || LOCK[q] === 3) && Math.abs(H[q] - z) > 1e-3) continue; H[q] = z; TAG[q] = 4; } } }
      S.bridges.push(B);
    }
    // r7a 操作：排水整平——有防御线的曲轮里，改地形的操作（坡道/土桥侧坡/桥台与石垣面相交）留下的闭合洼地按“优先队列洪泛的溢出水位”填平
    // （物理：填方面必须能排水；与 H20 同一个定义域：曲轮格点、从与别的类相邻的格点溢出）。被地基/坡道锁定的格点不动（交给 H1/H4/H20 报）。
    for (const lp of S.loops) { const g = lp.g, N = NX * NY, inG = q => CLS[q] === g.i, spill = new Float32Array(N).fill(Infinity), Hq = fheap(), b = lp.bbb, i0 = Math.max(0, Math.floor((b[0] - gs.x0) / c) - 2), i1 = Math.min(NX - 1, Math.ceil((b[2] - gs.x0) / c) + 2), j0 = Math.max(0, Math.floor((b[1] - gs.y0) / c) - 2), j1 = Math.min(NY - 1, Math.ceil((b[3] - gs.y0) / c) + 2), IDX = [];
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) IDX.push(j * NX + i);
      for (const q of IDX) { if (!inG(q)) continue; const i = q % NX; if (i === 0 || i === NX - 1 || q < NX || q >= N - NX || !inG(q - 1) || !inG(q + 1) || !inG(q - NX) || !inG(q + NX)) { spill[q] = H[q]; Hq.push(H[q], q); } }
      while (Hq.size()) { const lv = Hq.topKey(), q = Hq.pop(); if (lv > spill[q]) continue; for (const k of [q - 1, q + 1, q - NX, q + NX]) { if (k < 0 || k >= N || !inG(k)) continue; const nl = Math.max(H[k], lv); if (nl < spill[k]) { spill[k] = nl; Hq.push(nl, k); } } }
      for (const q of IDX) if (inG(q) && !LOCK[q] && spill[q] - H[q] > 1e-6) { H[q] = spill[q]; S.graded = (S.graded || 0) + 1; } }
    revalidate(); replay(); passivePass(); // r6：地形改完了（桥台是最后一个改地形的操作）→ 切分格定稿（水密），之后再按定稿的地面落桥墩
    for (const B of S.bridges) {
      const topAt = B.topAt, P = B.P, hw = B.hw;
      // 支座段（整幅桥面都搭在桥台上）的内端：跨度从这里量
      const full = s => [-hw, 0, hw].every(o => heightAt(...P(s, o)) >= topAt(s) - B.t - BRG.level);
      let sA = B.s0; while (sA + 0.25 <= B.s1 && full(sA + 0.25)) sA += 0.25;
      let sB = B.s1; while (sB - 0.25 >= sA && full(sB - 0.25)) sB -= 0.25;
      B.sA = sA; B.sB = sB;
      const rows = [-1, 1].map(sd => sd * hw * BRG.pierRow), pw = BRG.pierW / 2, M = BRG.maxSpan, st = 0.25;
      const foot = s => { let lo = 1e9, hi = -1e9; for (const o of rows) for (const [a, b] of [[0, 0], [-pw, -pw], [pw, -pw], [pw, pw], [-pw, pw]]) { const z = heightAt(...P(s + a, o + b)); if (z < lo) lo = z; if (z > hi) hi = z; } return [lo, hi]; };
      const okS = s => { const [lo, hi] = foot(s); return hi - lo <= BRG.level && hi < topAt(s) - B.t - BRG.minPierH; };
      const greedy = (from, to, dir) => { const out = []; let prev = from; for (let guard = 0; guard < 400 && (to - prev) * dir > M + 1e-9; guard++) { let pick = null; for (let s = prev + dir * M; (s - prev) * dir > st / 2; s -= dir * st) if (okS(s)) { pick = s; break; } if (pick === null) return null; out.push(pick); prev = pick; } return out; };
      const spansOK = ps => { const a = [sA].concat(ps, [sB]); for (let i = 1; i < a.length; i++) if (a[i] - a[i - 1] > M + 1e-9 || a[i] < a[i - 1]) return false; return true; };
      // 可落墩的位置若是一段连续区间 [L0,L1]（平整的堀底）：首墩在 L0、末墩在 L1，中间等分（每跨 ≤ M）；否则贪心
      let ivs = [], cur = null; for (let s = Math.ceil(sA / st) * st; s <= sB; s += st) { if (okS(s)) { if (cur) cur[1] = s; else ivs.push(cur = [s, s]); } else cur = null; }
      let even = null; if (ivs.length === 1) { const [L0, L1] = ivs[0]; if (L0 - sA <= M && sB - L1 <= M) { const k = Math.max(0, Math.ceil((L1 - L0) / M - 1e-9)); even = k === 0 ? [L0] : Array.from({ length: k + 1 }, (_, i) => Math.round((L0 + (L1 - L0) * i / k) / st * 4) / 4 * st); if (!(even.every(okS) && spansOK(even))) even = null; } }
      const fw = greedy(sA, sB, 1), bw = greedy(sB, sA, -1); let ps = even || fw;
      if (!even && fw && bw && fw.length === bw.length) { const bwr = bw.slice().reverse(), avg = fw.map((s, i) => Math.round((s + bwr[i]) / 2 / st) * st); if (avg.every(okS) && spansOK(avg)) ps = avg; } // 前向/后向两个可行解的平均：跨度更均匀
      if (!ps) { S.notes.push(B.name + ' 桥墩无处可落（某一跨 > ' + M + ' m）'); ps = []; }
      for (const s of ps) { const [lo, hi] = foot(s); B.piers.push({ s, zb: (lo + hi) / 2, zt: topAt(s) - B.t, rows: rows.map(o => P(s, o)) }); }
    }
    // ---- 表面（磁吸）：地面与桥面里最高的一个（桥面含两端桥台段）----
    function deckAt(x, y) { let h = null; for (const B of S.bridges) { const dx = x - B.p0[0], dy = y - B.p0[1], s = dx * B.u[0] + dy * B.u[1], o = dx * B.v[0] + dy * B.v[1]; if (s < B.s0 || s > B.s1 || Math.abs(o) > B.hw) continue; const z = B.topAt(s); h = h === null ? z : Math.max(h, z); } return h; }
    function surfaceAt(x, y) { const g = heightAt(x, y), b = deckAt(x, y); return b === null ? g : Math.max(g, b); }
    Object.assign(S, { NX, NY, cell: c, H, BASE, CLS, TAG, X, Y, WZ, BED, heightAt, surfaceAt, deckAt, baseAt });

    // ================= r5：可步行表面网络 =================
    // 节点 = 门洞两侧的“端点”（门内/门外各沿门洞轴线走到净宽够的地方）+ 目的地建筑（天守、殿舍）；
    // 边 = 穿门段（直线穿过门洞）+ 坡道/土桥/木桥 + 曲轮内道路（同一连通地面上所有端点的 Steiner 树：多源 Dijkstra + Voronoi 边 + MST）。
    S.tm.bridges = TM() - tq; tq = TM();
    const NET = SPEC.net; S.terms = []; S.roads = [];
    const WG = walkGrid(S, { closeGates: true }), N2 = NX * NY, edgeSeed  // 门关上：每块曲轮地面/枡形方院各自是一个连通块，门/坡道/桥是块之间的边
    = new Uint8Array(N2);
    { const hs = WG.hs, bk = WG.blk, lim = NET.slope * c + 0.02, crs = NET.cross * c + 0.01, gate = (q, k) => !bk[k] && Math.abs(hs[q] - hs[k]) > crs; // 种子 = 障碍格本身 + 坡折两侧的格（DT ≈ 到障碍/坡折的净距） // 道路要在平地上：坡度 > 横坡上限的格也算“边”（路面两侧不能落在斜坡上）
      void lim; for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const q = j * NX + i; if (bk[q] || (i + 1 < NX && gate(q, q + 1)) || (i > 0 && gate(q, q - 1)) || (j + 1 < NY && gate(q, q + NX)) || (j > 0 && gate(q, q - NX))) edgeSeed[q] = 1; } }
    S.tm.seed = TM() - tq; const DT = chamfer(edgeSeed, NX, NY); for (let q = 0; q < N2; q++) DT[q] *= c; S.tm.dt = TM() - tq;
    S.netDT = DT;
    const maxOpen = Math.max(...S.gates.map(g => g.open)), seekNeed = maxOpen / 2 + c / 2;
    const roadZone = (x, y) => { const z = zoneAt(x, y); return !!z && !z.band && NET.roadRegions.includes(z.name); };
    const seek = (x, y, dir, need) => { for (let a = 0; a <= NET.termReach; a += 0.5) { const px = x + dir[0] * a, py = y + dir[1] * a, q = vid(px, py); if (q >= 0 && !WG.blk[q] && DT[q] >= need) return [px, py]; } return null; };
    // 端点：从门洞面沿门洞轴线往外走，直到净宽够（先按本门的门洞宽，之后按所在地面上最宽的门洞重新找一次）
    const addTerm = (kind, base, dir, open, name) => {
      const p = seek(base[0], base[1], dir, open / 2 + c / 2) || seek(base[0], base[1], dir, open / 2) || seek(base[0], base[1], dir, open / 2 - c); if (!p) { S.notes.push('网络端点：' + name + ' 沿门洞轴线 ' + NET.termReach + ' m 内找不到净宽 ≥' + open.toFixed(1) + ' m 的地面'); return null; }
      const q = vid(p[0], p[1]), t = { id: S.terms.length, kind, x: p[0], y: p[1], open, name, comp: q >= 0 ? WG.comp[q] : -1, road: roadZone(p[0], p[1]), base, dir }; S.terms.push(t); return t;
    };
    const approach = (a, b, need, name) => { if (b) S.roads.push({ kind: 'approach', name, pts: [a.slice(), [b.x, b.y]], need, ends: [null, b.id] }); };
    for (const gate of S.gates) {
      const vdir = gate.nin || [-Math.sin(gate.ang), Math.cos(gate.ang)], gc = [gate.x, gate.y], o = gate.open;
      if (gate.nin) {
        const face = [gate.x - vdir[0] * gate.d / 2, gate.y - vdir[1] * gate.d / 2], tin = addTerm('gate', [gate.x + vdir[0] * gate.d / 2, gate.y + vdir[1] * gate.d / 2], vdir, o, gate.name + '·内');
        approach(face, tin, o, gate.name + ' 穿门段');
        if (gate.ramp && gate.ramp.p1) { const out = [-vdir[0], -vdir[1]], tout = addTerm('gate', gate.ramp.p1, out, o, gate.name + '·外'); approach(gate.ramp.p1, tout, o, gate.name + ' 坡道端'); }
        const ig = gate.masugata && gate.masugata.innerGate;
        if (ig) { const part = ig.part, pq = (part.passages || []).find(q => q.len) || null, depth = pq ? pq.len : part.d, a = [ig.c[0] - ig.dir[0] * depth / 2, ig.c[1] - ig.dir[1] * depth / 2], b = [ig.c[0] + ig.dir[0] * depth / 2, ig.c[1] + ig.dir[1] * depth / 2];
          const tc = addTerm('gate', a, [-ig.dir[0], -ig.dir[1]], o, part.name + '·枡形侧'), tf = addTerm('gate', b, ig.dir, o, part.name + '·内');
          if (tc && tf) S.roads.push({ kind: 'approach', name: part.name + ' 穿门段', pts: [[tc.x, tc.y], [tf.x, tf.y]], need: o, ends: [tc.id, tf.id] }); }
      } else {
        const ta = addTerm('gate', [gate.x - vdir[0] * gate.d / 2, gate.y - vdir[1] * gate.d / 2], [-vdir[0], -vdir[1]], o, gate.name + '·甲'), tb = addTerm('gate', [gate.x + vdir[0] * gate.d / 2, gate.y + vdir[1] * gate.d / 2], vdir, o, gate.name + '·乙');
        if (ta && tb) S.roads.push({ kind: 'approach', name: gate.name + ' 穿门段', pts: [[ta.x, ta.y], [tb.x, tb.y]], need: o, ends: [ta.id, tb.id] });
      }
    }
    S.tm.grid = TM() - tq; tq = TM();
    { const needC = new Map(); for (const t of S.terms) needC.set(t.comp, Math.max(needC.get(t.comp) || 0, t.open));
      for (const t of S.terms) { const nd = needC.get(t.comp), q = vid(t.x, t.y); if (DT[q] >= nd / 2 + c / 2) continue; const p = seek(t.base[0], t.base[1], t.dir, nd / 2 + c / 2) || seek(t.base[0], t.base[1], t.dir, nd / 2); if (p && WG.comp[vid(p[0], p[1])] === t.comp) { t.x = p[0]; t.y = p[1]; } }
      for (const r of S.roads) if (r.kind === 'approach') for (const k of [0, 1]) if (r.ends[k] !== null) { const t = S.terms[r.ends[k]]; r.pts[k === 0 ? 0 : r.pts.length - 1] = [t.x, t.y]; } }
    // 目的地：天守、殿舍（hall）——外圈一圈净宽够的格点都算这个端点
    for (const p of S.parts) {
      if (!NET.dest.includes(p.fam) || !p.poly) continue; const b = bboxOf(p.poly), m = seekNeed + 3, cells = [], byC = new Map(); // seekNeed：全城最宽门洞的一半 + 半格
      for (let j = Math.max(0, Math.floor((b[1] - m - gs.y0) / c)); j <= Math.min(NY - 1, Math.ceil((b[3] + m - gs.y0) / c)); j++) for (let i = Math.max(0, Math.floor((b[0] - m - gs.x0) / c)); i <= Math.min(NX - 1, Math.ceil((b[2] + m - gs.x0) / c)); i++) {
        const q = j * NX + i; if (WG.blk[q] || DT[q] < c) continue; const d = polyDist(X(i), Y(j), p.poly); if (d <= 0 || d > m) continue; cells.push(q); byC.set(WG.comp[q], (byC.get(WG.comp[q]) || 0) + 1);
      }
      let comp = -1, bn = 0; for (const [k, n] of byC) if (S.terms.some(t => t.comp === k) && n > bn) { bn = n; comp = k; }
      if (comp < 0) { S.notes.push('网络端点：' + p.name + ' 周围没有与门相连的净宽地面'); continue; }
      const cc = cells.filter(q => WG.comp[q] === comp), q0 = cc[0];
      S.terms.push({ id: S.terms.length, kind: 'dest', x: X(q0 % NX), y: Y((q0 - q0 % NX) / NX), open: 0, name: p.name, comp, road: roadZone(X(q0 % NX), Y((q0 - q0 % NX) / NX)), cells: cc, part: p });
    }
    // 每块连通地面（只在本丸/二之丸）：端点之间的 Steiner 树
    {
      const dist = new Float64Array(N2).fill(Infinity), src = new Int32Array(N2).fill(-1), par = new Int32Array(N2).fill(-1), touched = [];
      const nb8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
      const groups = new Map(); for (const t of S.terms) if (t.road && t.comp >= 0) { let L = groups.get(t.comp); if (!L) groups.set(t.comp, L = []); L.push(t); }
      for (const [comp, T] of groups) {
        if (T.length < 2) continue;
        const needC = Math.max(...T.map(t => t.open)) || maxOpen;
        let done = false;
        for (const req of [needC / 2 + c / 2, needC / 2]) {
          for (const q of touched) { dist[q] = Infinity; src[q] = -1; par[q] = -1; } touched.length = 0;
          // 3 m 格（隔一个格点）上的 Dijkstra：道路之后按 1.5 m 净宽场拉直，所以粗格足够
          // 端点附近（12 m 内）放宽到“本门洞宽”：里门开在枡形后角时，路要贴着后墙转弯（净宽之后由 H16 按真实几何复核）
          const relax = new Map(); for (const t of T) { if (t.kind !== 'gate') continue; const i0 = Math.round((t.x - gs.x0) / c), j0 = Math.round((t.y - gs.y0) / c), K = Math.ceil(12 / c);
            for (let j = j0 - K; j <= j0 + K; j++) for (let i = i0 - K; i <= i0 + K; i++) { if (i < 0 || j < 0 || i >= NX || j >= NY) continue; const q = j * NX + i; if (Math.hypot(X(i) - t.x, Y(j) - t.y) <= 12 && DT[q] >= t.open / 2 - c) relax.set(q, 1); } }
          const Hq = fheap(), okq = q => q >= 0 && q < N2 && WG.comp[q] === comp && (DT[q] >= req || relax.has(q)), DI = [2, -2, 2 * NX, -2 * NX, 2 * NX + 2, 2 * NX - 2, -2 * NX + 2, -2 * NX - 2], DL = [2 * c, 2 * c, 2 * c, 2 * c, 2 * c * Math.SQRT2, 2 * c * Math.SQRT2, 2 * c * Math.SQRT2, 2 * c * Math.SQRT2], DX = [2, -2, 0, 0, 2, -2, 2, -2];
          const even = q => (q % NX) % 2 === 0 && Math.floor(q / NX) % 2 === 0, snapE = (x, y) => { let best = -1, bd = 1e9; const i0 = Math.round((x - gs.x0) / c), j0 = Math.round((y - gs.y0) / c); for (let j = j0 - 3; j <= j0 + 3; j++) for (let i = i0 - 3; i <= i0 + 3; i++) { if (i % 2 || j % 2 || i < 0 || j < 0 || i >= NX || j >= NY) continue; const q = j * NX + i, d = Math.hypot(X(i) - x, Y(j) - y); if (okq(q) && d < bd) { bd = d; best = q; } } return best; };
          T.forEach((t, ti) => { const qs = t.cells ? t.cells.filter(q => even(q) && DT[q] >= req) : [snapE(t.x, t.y)]; for (const q of qs) { if (q < 0 || dist[q] === 0) continue; dist[q] = 0; src[q] = ti; touched.push(q); Hq.push(0, q); } });
          while (Hq.size()) { const dq = Hq.topKey(), q = Hq.pop(); if (dq > dist[q]) continue; const i = q % NX;
            for (let m = 0; m < 8; m++) { const ii = i + DX[m]; if (ii < 0 || ii >= NX) continue; const k = q + DI[m]; if (!okq(k)) continue; const w = 1 + 1.5 * Math.min(1, Math.max(0, (req + 4 - DT[k]) / 4)) + (DT[k] < req ? 2 : 0), nd = dq + DL[m] * w; if (nd < dist[k]) { if (dist[k] === Infinity) touched.push(k); dist[k] = nd; src[k] = src[q]; par[k] = q; Hq.push(nd, k); } } }
          (S.tm.dij || (S.tm.dij = [])).push([comp, T.length, touched.length, +req.toFixed(2), Math.round(TM() - tq)]);
          const best = new Map();
          for (const q of touched) { const i = q % NX; for (let m = 0; m < 8; m++) { const ii = i + DX[m], k = q + DI[m], L2 = DL[m] / c / 2; if (ii < 0 || ii >= NX || k < 0 || k >= N2) continue; if (src[k] < 0 || src[k] === src[q] || dist[k] === Infinity) continue; const a = Math.min(src[q], src[k]), b2 = Math.max(src[q], src[k]), key = a * 1000 + b2, d = dist[q] + dist[k] + L2 * 2 * c; const e = best.get(key); if (!e || d < e.d) best.set(key, { d, q, k, a, b: b2 }); } }
          const uf = T.map((_, i) => i), find = i => uf[i] === i ? i : (uf[i] = find(uf[i])); const mst = [];
          for (const e of [...best.values()].sort((x, y) => x.d - y.d)) { const ra = find(e.a), rb = find(e.b); if (ra === rb) continue; uf[ra] = rb; mst.push(e); }
          if (mst.length < T.length - 1 && req > needC / 2) continue; // 有端点连不上：去掉余量再试一次
          const trace = q => { const out = []; for (let k = q; k >= 0; k = par[k]) out.push([X(k % NX), Y((k - k % NX) / NX)]); return out; };
          const los = (a, b) => { const L2 = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L2 / 0.5)); for (let s = 0; s <= n; s++) { const q = vid(a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n); if (q < 0 || WG.comp[q] !== comp || (DT[q] < req - 0.75 && !relax.has(q))) return false; } return true; };
          for (const e of mst) {
            const A = T[src[e.q]], Bt = T[src[e.k]], pa = trace(e.q).reverse(), pb = trace(e.k);
            const raw = (A.kind === 'gate' ? [[A.x, A.y]] : []).concat(pa, pb, Bt.kind === 'gate' ? [[Bt.x, Bt.y]] : []);
            const pts = [raw[0]]; let i = 0; while (i < raw.length - 1) { let j = i + 1; while (j + 1 < raw.length && los(raw[i], raw[j + 1])) j++; pts.push(raw[j]); i = j; } // 贪心拉直（逐点延伸到视线不通为止）
            S.roads.push({ kind: 'road', name: A.name + '—' + Bt.name, pts, need: Math.max(A.open, Bt.open) || needC, comp, ends: [A.id, Bt.id], req });
          }
          done = true; break;
        }
        if (!done) S.notes.push('道路网：连通地面 ' + comp + ' 的端点连不成树');
      }
    }

    S.tm.roads = TM() - tq; tq = TM();
    // ---- 树：噪声成簇，西之丸庭园留开阔草坪 ----
    const TS = SPEC.trees, rnd = rng32((opt.seed * 2654435761) >>> 0);
    const lawnPts = TS.lawn.hull.map(n => { const b = byName(n); if (b) return [b.cx, b.cy]; const l = D.lost_yagura.find(q => q.name === n); return l ? [l.x, l.y] : null; }).filter(Boolean);
    const lawn = lawnPts.length >= 3 ? hull(lawnPts) : null; S.lawn = lawn;
    const solid = S.parts.filter(p => p.poly).map(p => ({ poly: p.poly, bb: bboxOf(p.poly) }));
    const rampPolys = S.ramps.filter(r => r.poly).map(r => segPoly(r.p0[0], r.p0[1], r.p1[0], r.p1[1], r.width + 6, 3));
    const passPolys = S.gates.map(g => g.passage).concat(S.gates.filter(g => g.masugata).map(g => g.masugata.court), ...S.parts.filter(p => p.passages).map(p => p.passages.map(q => q.poly)));
    // r5：步行网络走廊（道路/穿门段/坡道/桥）：树干离走廊边 ≥1 m；树冠伸进走廊上空时，冠底要高于净空（人高+余量）
    const CORR = [], CB = new Map(), HEAD = SPEC.clear.person + SPEC.clear.margin;
    for (const r of S.roads) for (let k = 1; k < r.pts.length; k++) CORR.push({ a: r.pts[k - 1], b: r.pts[k], hw: r.need / 2 });
    for (const r of S.ramps) if (r.p1) CORR.push({ a: r.p0, b: r.p1, hw: r.width / 2 });
    CORR.forEach((e, n) => { const bb = bboxOf([e.a, e.b]), m = e.hw + 8; for (let a = Math.floor((bb[0] - m) / 10); a <= Math.floor((bb[2] + m) / 10); a++) for (let b = Math.floor((bb[1] - m) / 10); b <= Math.floor((bb[3] + m) / 10); b++) { const k = a * 100003 + b; let L = CB.get(k); if (!L) CB.set(k, L = []); L.push(n); } });
    const corrNear = (x, y) => CB.get(Math.floor(x / 10) * 100003 + Math.floor(y / 10)) || [];
    const treeClear = tr => { const G = treeGeom(tr); for (const n of corrNear(tr.x, tr.y)) { const e = CORR[n]; if (segDist(tr.x, tr.y, e.a[0], e.a[1], e.b[0], e.b[1]) < e.hw + 1 + G.trunk.r) return false;
        for (const cr of G.crowns) { const d = segDist(cr.x, cr.y, e.a[0], e.a[1], e.b[0], e.b[1]) - e.hw; if (d < cr.r && cr.z - cr.rz * Math.sqrt(Math.max(0, 1 - (Math.max(0, d) / cr.r) ** 2)) < tr.z + HEAD) return false; } } return true; };
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
        if (!treeClear(tr)) continue;
        if (tr.z < WZ + 0.3 || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => Math.abs(surfaceAt(x + dx * tr.r * 0.5, y + dy * tr.r * 0.5) - tr.z) > SPEC.walk.slope * tr.r * 0.5)) continue; // 树根要在平地上
        S.trees.push(tr); const k = tk(x, y); let A = TG.get(k); if (!A) TG.set(k, A = []); A.push(tr); placed++;
      }
    }

    S.tm.trees = TM() - tq;
    // ---- 标注 ----
    for (const p of S.parts) if (p.name && p.fam !== 'dobei' && p.fam !== 'mwall' && !p.ramp) S.labels.push({ text: p.name, x: p.x, y: p.y, z: p.z + ({ tenshu: 62, yagura3: 22, yagura2: 17, yaguramon: 15, gate: 10, tamon: 14 }[p.fam] || 10), lost: !!p.lost, fam: p.fam });

    Object.assign(S, { NX, NY, cell: c, H, BASE, CLS, LOCK, TAG, heightAt, surfaceAt, deckAt, crestDist, inReg, levelAt, X, Y, WZ, BED, treeGeom, baseAt });
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
    { id: 'H15', name: '网络连通：门/曲轮地面/城下互通，无断头路，端点都接上道路' },
    { id: 'H16', name: '道路/坡道/桥：纵坡≤30%、横坡≤5%、净宽≥门洞' },
    { id: 'H17', name: '桥：两端搭桥台≥1 m、墩落地、跨度≤3 間、端头接平；土桥侧坡稳定且落到堀底' },
    { id: 'H18', name: '净空：步行面以上≥2.1 m（门楣/桥底/树冠），木桥下水面净空≥2 m' },
    { id: 'H19', name: '石垣顶线：渲染面的顶线与矢量顶线偏差≤0.1 m，无台阶' },
    { id: 'H20', name: '曲轮地面：坡度≤2%、无积水坑（排水到曲轮外）' },
    { id: 'H21', name: '石垣面：实测勾配=设计勾配(±0.03)、设计值在惯例范围、墙脚高=下层' },
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
      while (n < 60 && tries < 4000) { tries++; const x = g.bb[0] + rr() * (g.bb[2] - g.bb[0]), y = g.bb[1] + rr() * (g.bb[3] - g.bb[1]); if (x < S.X(0) || x > S.X(S.NX - 1) || y < S.Y(0) || y > S.Y(S.NY - 1)) continue; if (!S.inReg(g, x, y) || S.crestDist(g, x, y) < 3 * S.cell) continue; if (S.ramps.some(r => r.poly && polyDist(x, y, r.poly) < Math.max((Math.max(r.z0, r.z1) - S.BED) * SPEC.ramp.sideSlope, (Math.max(r.z0, r.z1) - SPEC.levels.city) * SPEC.ramp.earthSlope) + 2 * S.cell)) continue; if (P.some(p => p.poly && polyDist(x, y, p.poly) < 3)) continue; n++; if (Math.abs(heightAt(x, y) - SPEC.levels[g.name]) > 0.01) badN++; }
      if (badN) bad('H7', { name: g.name, x: (g.bb[0] + g.bb[2]) / 2, y: (g.bb[1] + g.bb[3]) / 2 }, g.name + ' 有 ' + badN + '/' + n + ' 个采样高程≠' + SPEC.levels[g.name]);
    }
    // H9 水面格
    let wchg = 0; for (let q = 0; q < S.H.length; q++) if (S.CLS[q] < 0 && Math.abs(S.H[q] - S.BED) > 1e-4 && S.TAG[q] !== 2 && S.TAG[q] !== 3 && S.TAG[q] !== 5) wchg++;
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
    S.net = netAudit(S, bad);
    S.conf = conformAudit(S, bad);
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

  function candScan(H, TAG, cand, NX, NY, WZ) { for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) { const q = j * NX + i, h0 = H[q], h1 = H[q + 1], h2 = H[q + NX], h3 = H[q + NX + 1]; if (Math.max(h0, h1, h2, h3) < WZ - 0.01) continue; /* 整格在水下：看不见、相机也到不了 */ if (TAG[q] === 1 || TAG[q + 1] === 1 || TAG[q + NX] === 1 || TAG[q + NX + 1] === 1 || Math.max(h0, h1, h2, h3) - Math.min(h0, h1, h2, h3) > 0.5) cand[q] = 1; } }
  // r6：在切开的格里按三角形求高（重心坐标；数值边界上取最近的三角形）
  function splitZ(T, x, y) { let best = null, bm = -1e9; for (let k = 0; k < T.length; k += 9) { const ax = T[k], ay = T[k + 1], bx = T[k + 3], by = T[k + 4], cx = T[k + 6], cy = T[k + 7], den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-14) continue;
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den, l3 = 1 - l1 - l2, m = Math.min(l1, l2, l3); if (m > bm) { bm = m; best = l1 * T[k + 2] + l2 * T[k + 5] + l3 * T[k + 8]; if (m >= -1e-9) return best; } } return best; }
  // ---------------- r5：网络/桥/净空的公共函数 ----------------
  function fheap() { let K = new Float64Array(1024), V = new Int32Array(1024), n = 0; return { push(key, val) { if (n === K.length) { const K2 = new Float64Array(n * 2), V2 = new Int32Array(n * 2); K2.set(K); V2.set(V); K = K2; V = V2; } let i = n++; while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= key) break; K[i] = K[p]; V[i] = V[p]; i = p; } K[i] = key; V[i] = val; },
    topKey() { return K[0]; }, pop() { const r = V[0]; n--; if (n > 0) { const key = K[n], val = V[n]; let i = 0; for (;;) { const l = 2 * i + 1; if (l >= n) break; const rr = l + 1, m = rr < n && K[rr] < K[l] ? rr : l; if (K[m] >= key) break; K[i] = K[m]; V[i] = V[m]; i = m; } K[i] = key; V[i] = val; } return r; }, size() { return n; } }; }
  function heapQ() { const k = [], v = []; return { push(key, val) { k.push(key); v.push(val); let i = k.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= k[i]) break; [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; } },
    pop() { const rk = k[0], rv = v[0], lk = k.pop(), lv = v.pop(); if (k.length) { k[0] = lk; v[0] = lv; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < k.length && k[l] < k[m]) m = l; if (r < k.length && k[r] < k[m]) m = r; if (m === i) break; [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m; } } return [rk, rv]; }, get size() { return k.length; } }; }
  function chamfer(seed, nx, ny) { // 到最近种子格的距离（格数，8 邻域倒角）
    const N = nx * ny, D = new Float32Array(N), s2 = Math.SQRT2; for (let q = 0; q < N; q++) D[q] = seed[q] ? 0 : 1e9;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const q = j * nx + i; let v = D[q]; if (i > 0) v = Math.min(v, D[q - 1] + 1); if (j > 0) { v = Math.min(v, D[q - nx] + 1); if (i > 0) v = Math.min(v, D[q - nx - 1] + s2); if (i < nx - 1) v = Math.min(v, D[q - nx + 1] + s2); } D[q] = v; }
    for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) { const q = j * nx + i; let v = D[q]; if (i < nx - 1) v = Math.min(v, D[q + 1] + 1); if (j < ny - 1) { v = Math.min(v, D[q + nx] + 1); if (i < nx - 1) v = Math.min(v, D[q + nx + 1] + s2); if (i > 0) v = Math.min(v, D[q + nx - 1] + s2); } D[q] = v; }
    return D;
  }
  // 全城步行栅格（与高度网格同格点）：表面 = 地面/桥面取高者；水、实体（门洞除外）是障碍；相邻格坡度 >slope 不连通
  function walkGrid(S, o) {
    o = o || {}; const NX = S.NX, NY = S.NY, c = S.cell, N = NX * NY, x0 = S.X(0), y0 = S.Y(0), hs = new Float32Array(N), blk = new Uint8Array(N), h = c / 2;
    hs.set(S.H);
    for (const B of S.bridges || []) { const bb = bboxOf([B.P(B.s0, -B.hw), B.P(B.s0, B.hw), B.P(B.s1, -B.hw), B.P(B.s1, B.hw)]);
      for (let j = Math.max(0, Math.floor((bb[1] - y0) / c)); j <= Math.min(NY - 1, Math.ceil((bb[3] - y0) / c)); j++) for (let i = Math.max(0, Math.floor((bb[0] - x0) / c)); i <= Math.min(NX - 1, Math.ceil((bb[2] - x0) / c)); i++) { const q = j * NX + i, z = S.deckAt(S.X(i), S.Y(j)); if (z !== null && z > hs[q]) hs[q] = z; } }
    for (let q = 0; q < N; q++) if (hs[q] < S.WZ + 0.3) blk[q] = 1;
    for (const p of S.parts) { if (!p.poly || p.ramp) continue; const b = bboxOf(p.poly);
      for (let j = Math.max(0, Math.floor((b[1] - h - y0) / c)); j <= Math.min(NY - 1, Math.ceil((b[3] + h - y0) / c)); j++) for (let i = Math.max(0, Math.floor((b[0] - h - x0) / c)); i <= Math.min(NX - 1, Math.ceil((b[2] + h - x0) / c)); i++) {
        const x = S.X(i), y = S.Y(j); if (polyDist(x, y, p.poly) >= h) continue; if (!o.closeGates && p.passages && p.passages.some(pp => polyDist(x, y, pp.poly) < h)) continue; blk[j * NX + i] = 1; } }
    if (o.trees) for (const t of S.trees) { const i = Math.round((t.x - x0) / c), j = Math.round((t.y - y0) / c); if (i >= 0 && j >= 0 && i < NX && j < NY) blk[j * NX + i] = 1; }
    const lim = SPEC.net.slope * c + 0.02, pass = (q, k) => !blk[q] && !blk[k] && Math.abs(hs[q] - hs[k]) <= lim;
    const comp = new Int32Array(N).fill(-1), sizes = [], st = new Int32Array(N); let nc = 0;
    for (let q0 = 0; q0 < N; q0++) { if (blk[q0] || comp[q0] >= 0) continue; let sp = 0, n = 0; st[sp++] = q0; comp[q0] = nc;
      while (sp) { const q = st[--sp], i = q % NX; n++; if (i + 1 < NX && comp[q + 1] < 0 && pass(q, q + 1)) { comp[q + 1] = nc; st[sp++] = q + 1; } if (i > 0 && comp[q - 1] < 0 && pass(q, q - 1)) { comp[q - 1] = nc; st[sp++] = q - 1; } if (q + NX < N && comp[q + NX] < 0 && pass(q, q + NX)) { comp[q + NX] = nc; st[sp++] = q + NX; } if (q - NX >= 0 && comp[q - NX] < 0 && pass(q, q - NX)) { comp[q - NX] = nc; st[sp++] = q - NX; } }
      sizes.push(n); nc++; }
    return { hs, blk, pass, comp, sizes, nc };
  }
  // 树的几何（渲染与净空审计共用）：树干圆柱 + 两个椭球树冠
  function treeGeom(t) { const pine = t.kind === 'pine', h = (pine ? 6 : 5) * t.s, crowns = []; for (let k = 0; k < 2; k++) { const r = (pine ? 2.6 - k * 0.8 : 3.2 - k * 0.9) * t.s; crowns.push({ x: t.x + (k ? 0.6 : -0.4) * t.s, y: t.y + (k ? -0.5 : 0.3) * t.s, z: t.z + h * (0.75 + k * 0.22), r, rz: r * (pine ? 0.45 : 0.85) }); } return { h, trunk: { r: 0.38 * t.s, z0: t.z, z1: t.z + h * 0.8 }, crowns }; }
  // 网络的边（道路/穿门段/坡道/桥）：统一成 {kind,name,pts,need,w}
  function netEdges(S) {
    const E = []; for (const r of S.roads || []) E.push({ kind: r.kind, name: r.name, pts: r.pts, need: r.need, w: r.need, road: r });
    for (const r of S.ramps) if (r.p1) E.push({ kind: r.via, name: r.gate.name + (r.via === 'bridge' ? '（桥）' : '（土桥）'), pts: [r.p0, r.p1], need: r.gate.open, w: r.width, ramp: r, part: r.part });
    return E;
  }
  function polySamples(pts, step, skipEnds) { const out = []; let acc = 0; for (let k = 1; k < pts.length; k++) { const a = pts[k - 1], b = pts[k], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue; const tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L, n = Math.max(1, Math.ceil(L / step)); for (let i = (k === 1 ? 0 : 1); i <= n; i++) out.push({ x: a[0] + tx * L * i / n, y: a[1] + ty * L * i / n, tx, ty, s: acc + L * i / n }); acc += L; }
    return skipEnds ? out.filter(p => p.s >= skipEnds && p.s <= acc - skipEnds) : out; }

  // ---------------- r5：H15–H18 ----------------
  function netAudit(S, bad) {
    const NET = SPEC.net, BRG = SPEC.bridge, DB = SPEC.dobashi, CL = SPEC.clear, HEAD = CL.person + CL.margin, c = S.cell, NX = S.NX, NY = S.NY, N = NX * NY, x0 = S.X(0), y0 = S.Y(0);
    const WG = walkGrid(S, { trees: true });
    // ---- H15 连通 ----
    const cityCnt = new Map(); for (let q = 0; q < N; q++) { const k = WG.comp[q]; if (k < 0) continue; const cl = S.CLS[q]; if (cl === S.BAND.i || (cl >= 0 && cl < S.regions.length && S.regions[cl].name === 'city')) cityCnt.set(k, (cityCnt.get(k) || 0) + 1); }
    let main = -1, mb = 0; for (const [k, n] of cityCnt) if (n > mb) { mb = n; main = k; }
    const nearMain = (x, y, r) => { const i0 = Math.round((x - x0) / c), j0 = Math.round((y - y0) / c), K = Math.ceil(r / c); for (let j = j0 - K; j <= j0 + K; j++) for (let i = i0 - K; i <= i0 + K; i++) { if (i < 0 || j < 0 || i >= NX || j >= NY) continue; if (Math.hypot(S.X(i) - x, S.Y(j) - y) <= r + 1e-6 && WG.comp[j * NX + i] === main) return true; } return false; };
    for (const g of S.gates) {
      const vd = g.nin || [-Math.sin(g.ang), Math.cos(g.ang)], pts = [[g.x, g.y], [g.x + vd[0] * (g.d / 2 + 2), g.y + vd[1] * (g.d / 2 + 2)], [g.x - vd[0] * (g.d / 2 + 2), g.y - vd[1] * (g.d / 2 + 2)]];
      const ig = g.masugata && g.masugata.innerGate; if (ig) { const pq = (ig.part.passages || []).find(q => q.len), dp = pq ? pq.len : ig.part.d; pts.push(ig.c, [ig.c[0] + ig.dir[0] * (dp / 2 + 2), ig.c[1] + ig.dir[1] * (dp / 2 + 2)], [ig.c[0] - ig.dir[0] * (dp / 2 + 2), ig.c[1] - ig.dir[1] * (dp / 2 + 2)]); }
      if (pts.some(p => !nearMain(p[0], p[1], 1.5))) bad('H15', g.part, '门洞/门两侧不在全城连通的步行网上（与城下不连通）');
    }
    for (const r of S.ramps) if (r.p1 && (!nearMain(r.p0[0], r.p0[1], 1.5) || !nearMain(r.p1[0], r.p1[1], 1.5))) bad('H15', r.part, '坡道/桥的一端不在连通步行网上');
    // 曲轮地面：不在主连通块里的地面块（≥ pocket m²）= 走不到的地面（护城河底等按规格 noAccess 例外：防御空间，本来就不让人走）
    // 有防御线的曲轮：地面 = 土塀轴线以内（轴线外侧那条窄窄的犬走り在墙外，本来就不进人）
    const pk = new Map(), axisOf = g => { const lp = (S.loops || []).find(l => l.g === g); return lp ? lp.axis.v : null; };
    for (let q = 0; q < N; q++) { if (WG.blk[q] || WG.comp[q] === main) continue; const cl = S.CLS[q]; if (cl < 0 || cl >= S.regions.length) continue; const g = S.regions[cl]; if (!NET.roadRegions.includes(g.name) || NET.noAccess.includes(g.name) || Math.abs(S.H[q] - g.z) > 0.01) continue;
      const ax = axisOf(g), x = S.X(q % NX), y = S.Y((q - q % NX) / NX); if (ax && !inRing(x, y, ax)) continue; const k = WG.comp[q]; let e = pk.get(k); if (!e) pk.set(k, e = { n: 0, q, g }); e.n++; }
    for (const [, e] of pk) if (e.n * c * c >= NET.pocket) bad('H15', { name: e.g.name + '地面', x: S.X(e.q % NX), y: S.Y((e.q - e.q % NX) / NX) }, '一块 ' + (e.n * c * c).toFixed(0) + ' m² 的' + e.g.name + '地面与全城步行网不连通');
    for (const p of S.parts) if (NET.dest.includes(p.fam) && p.poly) { const b = bboxOf(p.poly); let ok = false;
      for (let j = Math.max(0, Math.floor((b[1] - 4 - y0) / c)); j <= Math.min(NY - 1, Math.ceil((b[3] + 4 - y0) / c)) && !ok; j++) for (let i = Math.max(0, Math.floor((b[0] - 4 - x0) / c)); i <= Math.min(NX - 1, Math.ceil((b[2] + 4 - x0) / c)) && !ok; i++) { const d = polyDist(S.X(i), S.Y(j), p.poly); if (d > 0 && d <= 4 && WG.comp[j * NX + i] === main) ok = true; }
      if (!ok) bad('H15', p, '目的地建筑周围没有连通的步行面'); }
    // 道路：端点必须落在端点/另一条路/坡道上（无断头路）；同一块地面上有 ≥2 个端点时，每个端点都要被一条道路接上；道路沿线在主连通块上
    const T = S.terms || [], roads = S.roads || [], E = netEdges(S);
    const onOther = (r, p) => E.some(e => e.road !== r && e.pts.some((a, k) => k && segDist(p[0], p[1], e.pts[k - 1][0], e.pts[k - 1][1], a[0], a[1]) <= NET.endSnap));
    const atTerm = p => T.some(t => Math.hypot(t.x - p[0], t.y - p[1]) <= NET.endSnap || (t.part && polyDist(p[0], p[1], t.part.poly) <= NET.endSnap + 10 && t.cells && t.cells.some(q => Math.hypot(S.X(q % NX) - p[0], S.Y((q - q % NX) / NX) - p[1]) <= NET.endSnap)));
    for (const r of roads) { for (const p of [r.pts[0], r.pts[r.pts.length - 1]]) if (!atTerm(p) && !onOther(r, p)) { bad('H15', { name: r.name, x: p[0], y: p[1] }, '断头路（端点不在门/目的地/其他道路上）'); break; }
      if (polySamples(r.pts, 2).some(p => !nearMain(p.x, p.y, 1.5))) bad('H15', { name: r.name, x: r.pts[0][0], y: r.pts[0][1] }, '道路经过不连通/不可走的地面'); }
    const cnt = new Map(); for (const t of T) if (t.road) cnt.set(t.comp, (cnt.get(t.comp) || 0) + 1);
    for (const t of T) { if (!t.road || cnt.get(t.comp) < 2) continue; const served = roads.some(r => r.kind === 'road' && [r.pts[0], r.pts[r.pts.length - 1]].some(p => Math.hypot(p[0] - t.x, p[1] - t.y) <= NET.endSnap || (t.cells && t.cells.some(q => Math.hypot(S.X(q % NX) - p[0], S.Y((q - q % NX) / NX) - p[1]) <= NET.endSnap)))); if (!served) bad('H15', { name: t.name, x: t.x, y: t.y }, '端点没有接到曲轮道路网'); }
    // ---- H16 坡度 / 横坡 / 净宽 ----
    const PB = new Map(); S.parts.forEach((p, n) => { if (!p.poly || p.ramp) return; const b = bboxOf(p.poly); for (let a = Math.floor(b[0] / 8); a <= Math.floor(b[2] / 8); a++) for (let bq = Math.floor(b[1] / 8); bq <= Math.floor(b[3] / 8); bq++) { const k = a * 100003 + bq; let L = PB.get(k); if (!L) PB.set(k, L = []); L.push(p); } });
    const TB = new Map(); for (const t of S.trees) { const k = Math.floor(t.x / 8) * 100003 + Math.floor(t.y / 8); let L = TB.get(k); if (!L) TB.set(k, L = []); L.push(t); }
    const solidAt = (x, y) => { for (const p of PB.get(Math.floor(x / 8) * 100003 + Math.floor(y / 8)) || []) if (polyDist(x, y, p.poly) < -0.02 && !(p.passages && p.passages.some(pp => polyDist(x, y, pp.poly) < 0.02))) return true;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const t of TB.get((Math.floor(x / 8) + a) * 100003 + Math.floor(y / 8) + b) || []) if (Math.hypot(t.x - x, t.y - y) < treeGeom(t).trunk.r) return true; return false; };
    const freeW = (x, y, nx, ny, half) => { let tot = 0; for (const sd of [-1, 1]) { let pz = S.surfaceAt(x, y), a = 0; while (a < half + 0.5) { const a2 = a + 0.25, px = x + nx * sd * a2, py = y + ny * sd * a2, z = S.surfaceAt(px, py); if (z < S.WZ + 0.3 || Math.abs(z - pz) > NET.slope * 0.25 + 0.02 || solidAt(px, py)) break; a = a2; pz = z; } tot += a; } return tot; };
    for (const e of E) {
      const o = e.part || { name: e.name, x: e.pts[0][0], y: e.pts[0][1] };
      if (e.w < e.need - 1e-6) bad('H16', o, '宽 ' + e.w.toFixed(1) + ' m < 门洞 ' + e.need.toFixed(1) + ' m');
      const sm = polySamples(e.pts, 1.0, 0.5); let g = 0, cr = 0, wmin = 1e9, prev = null; const off = Math.max(0.5, Math.min(e.need, e.w) / 2 - 0.5);
      for (const p of sm) { const z = S.surfaceAt(p.x, p.y); if (prev && p.s - prev.s > 0.2) g = Math.max(g, Math.abs(z - prev.z) / (p.s - prev.s)); prev = { z, s: p.s };
        cr = Math.max(cr, Math.abs(S.surfaceAt(p.x - p.ty * off, p.y + p.tx * off) - S.surfaceAt(p.x + p.ty * off, p.y - p.tx * off)) / (2 * off));
        wmin = Math.min(wmin, freeW(p.x, p.y, -p.ty, p.tx, e.need / 2)); }
      if (g > NET.slope + 0.02) bad('H16', o, '纵坡 ' + (g * 100).toFixed(0) + '% > ' + NET.slope * 100 + '%');
      if (cr > NET.cross + 0.005) bad('H16', o, '横坡 ' + (cr * 100).toFixed(1) + '% > ' + NET.cross * 100 + '%');
      if (wmin < e.need - NET.tol) bad('H16', o, '净宽 ' + wmin.toFixed(2) + ' m < 门洞 ' + e.need.toFixed(1) + ' m');
    }
    // ---- H17 木桥支撑/跨度/接续 + 土桥侧坡 ----
    for (const B of S.bridges || []) {
      const o = B.ramp.part || { name: B.name, x: B.p0[0], y: B.p0[1] }, gz = s => [-B.hw, 0, B.hw].map(of => S.heightAt(...B.P(s, of)));
      const bearOK = s => gz(s).every(z => z >= B.topAt(s) - B.t - BRG.level && z <= B.topAt(s) + BRG.level);
      let a = B.s0; while (a + 0.25 <= B.s1 && bearOK(a + 0.25)) a += 0.25; let b = B.s1; while (b - 0.25 >= a && bearOK(b - 0.25)) b -= 0.25;
      if (!bearOK(B.s0) || a - B.s0 < BRG.bear - 1e-6) bad('H17', o, '桥面起端搭在桥台上的长度 ' + (bearOK(B.s0) ? a - B.s0 : 0).toFixed(2) + ' m < ' + BRG.bear + ' m');
      if (!bearOK(B.s1) || B.s1 - b < BRG.bear - 1e-6) bad('H17', o, '桥面末端搭在桥台上的长度 ' + (bearOK(B.s1) ? B.s1 - b : 0).toFixed(2) + ' m < ' + BRG.bear + ' m');
      // 支座段之外：整幅都不碰地（桥面底在地面之上）；允许一个格宽（√2·格）的支座边缘过渡
      let buried = 0, cut = 0; for (let s = B.s0; s <= B.s1 + 1e-9; s += 0.25) { const zz = gz(s), m = Math.max(...zz); if (m > B.topAt(s) + BRG.level) buried++; else if (s > a + c * Math.SQRT2 && s < b - c * Math.SQRT2 && m > B.topAt(s) - B.t - BRG.level) cut++; }
      if (buried) bad('H17', o, '桥面埋进地面（' + buried + ' 处）'); if (cut) bad('H17', o, '桥面中段碰到石垣/地面（' + cut + ' 处，支座外）');
      for (const [s, sd] of [[B.s0, -1], [B.s1, 1]]) { const p = B.P(s + sd * 0.5, 0), d = Math.abs(S.heightAt(p[0], p[1]) - B.topAt(s)); if (d > BRG.cont) bad('H17', o, '桥面端头与路面高差 ' + d.toFixed(2) + ' m > ' + BRG.cont + ' m'); }
      const pw = BRG.pierW / 2, sup = [a];
      for (const pr of B.piers) { let lo = 1e9, hi = -1e9; for (const rw of pr.rows) for (const [a2, b2] of [[0, 0], [-pw, -pw], [pw, -pw], [pw, pw], [-pw, pw]]) { const z = S.heightAt(rw[0] + B.u[0] * a2 + B.v[0] * b2, rw[1] + B.u[1] * a2 + B.v[1] * b2); /* 墩的方向与桥轴一致 */ lo = Math.min(lo, z); hi = Math.max(hi, z); }
        if (hi - lo > BRG.level + 1e-6 || pr.zb > hi + BRG.level || pr.zb < lo - BRG.level) bad('H17', o, '桥墩（s=' + pr.s.toFixed(1) + '）脚下不平或没落在地面上（地面 ' + lo.toFixed(2) + '…' + hi.toFixed(2) + '，墩底 ' + pr.zb.toFixed(2) + '）');
        if (Math.abs(pr.zt - (B.topAt(pr.s) - B.t)) > 0.1) bad('H17', o, '桥墩顶没顶到桥面底'); sup.push(pr.s); }
      sup.push(b); sup.sort((p, q) => p - q); let ms = 0; for (let i = 1; i < sup.length; i++) ms = Math.max(ms, sup[i] - sup[i - 1]); if (ms > BRG.maxSpan + 1e-6) bad('H17', o, '最大跨度 ' + ms.toFixed(1) + ' m > ' + BRG.maxSpan + ' m（木梁）');
      for (let s = a; s <= b; s += 1) { if (S.heightAt(...B.P(s, 0)) < S.WZ && B.topAt(s) - B.t - S.WZ < CL.boat) { bad('H18', o, '桥下水面净空 ' + (B.topAt(s) - B.t - S.WZ).toFixed(2) + ' m < ' + CL.boat + ' m'); break; } }
    }
    for (const r of S.ramps) {
      if (!r.p1 || r.via !== 'dobashi') continue; const u = [(r.p1[0] - r.p0[0]) / r.len, (r.p1[1] - r.p0[1]) / r.len], v = [-u[1], u[0]], hw = r.width / 2; let worst = null;
      for (let s = 3; s <= r.len - 3; s += 3) for (const sd of [-1, 1]) {
        // 只量“填方”部分：表面高于原地面（BASE）的那一段侧坡；坡脚 = 填方与原地面相交处
        const P = o2 => [r.p0[0] + u[0] * s + v[0] * sd * o2, r.p0[1] + u[1] * s + v[1] * sd * o2], prof = [];
        for (let o2 = hw; o2 <= hw + 45; o2 += 0.25) { const pp = P(o2), z = S.heightAt(pp[0], pp[1]), bz = S.baseAt(pp[0], pp[1]); prof.push([o2, z, bz]); if (z <= bz + 0.02) break; }
        const z0 = prof[0][1], toe = prof[prof.length - 1], drop = z0 - toe[1], k = prof.length; if (drop < 2.5 || toe[1] > toe[2] + 0.02) continue;
        // 侧坡“够不够缓”：按材料累加所需水平距离（石垣面 TAG 1/3：batMin·dz；土坡：earth·dz），实际水平距离 + 一格容差 ≥ 所需
        const stoneAt = (xx, yy) => { const fi = Math.floor((xx - x0) / c), fj = Math.floor((yy - y0) / c); for (const [a, b2] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const q = (fj + b2) * NX + fi + a; if (q >= 0 && q < N && (S.TAG[q] === 1 || S.TAG[q] === 3)) return true; } return false; }; // 所在三角形任一顶点是石垣面 → 按石垣面
        let need2 = 0, run2 = 0, zs = 0; const base = toe[2];
        for (let i = 1; i < k; i++) { const dz = prof[i - 1][1] - prof[i][1]; if (dz <= 0) continue; const stn = stoneAt(...P(prof[i - 1][0])) || stoneAt(...P(prof[i][0])); need2 += dz * (stn ? DB.batMin : DB.earth); zs += stn ? dz : 0; }
        run2 = toe[0] - prof[0][0]; const bat = run2 / drop, faced = zs > drop / 2, stable = run2 + c >= need2 * 0.95, toeOK = true; // 坡脚按定义落在原地面上（高度场上不会悬空）
        if (!stable || !toeOK) { worst = worst || { s, sd, bat, toe: toe[1], base, faced }; }
      }
      if (worst) bad('H17', r.part, '土桥侧坡不稳定（s=' + worst.s + (worst.sd > 0 ? ' 左' : ' 右') + '，勾配 ' + worst.bat.toFixed(2) + (worst.faced ? ' 石垣面' : ' 土坡') + '，坡脚 ' + worst.toe.toFixed(1) + ' m / 原地面 ' + worst.base.toFixed(1) + ' m）');
    }
    // ---- H18 净空：步行面以上 ≥ 人高+余量（门洞门楣、桥面底、树冠）----
    for (const e of E) {
      const o = e.part || { name: e.name, x: e.pts[0][0], y: e.pts[0][1] }, off = Math.max(0, e.need / 2 - 0.3); let hmin = 1e9, where = '';
      for (const p of polySamples(e.pts, 1.0)) for (const of of [-off, 0, off]) {
        const x = p.x - p.ty * of, y = p.y + p.tx * of, z = S.surfaceAt(x, y);
        for (const q of PB.get(Math.floor(x / 8) * 100003 + Math.floor(y / 8)) || []) if (q.passages && polyDist(x, y, q.poly) < 0) for (const pp of q.passages) if (pp.clearH && polyDist(x, y, pp.poly) < 0) { const hh = q.z + pp.clearH - z; if (hh < hmin) { hmin = hh; where = q.name + ' 门洞'; } }
        for (const B of S.bridges || []) { const dx = x - B.p0[0], dy = y - B.p0[1], s = dx * B.u[0] + dy * B.u[1], oo = dx * B.v[0] + dy * B.v[1]; if (s < B.s0 || s > B.s1 || Math.abs(oo) > B.hw) continue; const bt = B.topAt(s) - B.t; if (bt > z + 0.05 && bt - z < hmin) { hmin = bt - z; where = B.name + ' 桥面下'; } }
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const t of TB.get((Math.floor(x / 8) + a) * 100003 + Math.floor(y / 8) + b) || []) for (const cr of treeGeom(t).crowns) { const d = Math.hypot(cr.x - x, cr.y - y); if (d >= cr.r) continue; const hh = cr.z - cr.rz * Math.sqrt(1 - (d / cr.r) ** 2) - z; if (hh < hmin) { hmin = hh; where = '树冠'; } }
      }
      if (hmin < HEAD) bad('H18', o, '净空 ' + hmin.toFixed(2) + ' m < ' + HEAD.toFixed(1) + ' m（' + where + '）');
    }
    return { main, comps: WG.nc };
  }

  // ---------------- r6：H19–H21（只看渲染用的地形面 S.heightAt；与生成器的切分无关，旧网格同样可以求值）----------------
  function conformAudit(S, bad) {
    const CF = SPEC.conform, IG = SPEC.ishigaki, c = S.cell, NX = S.NX, NY = S.NY, x0 = S.X(0), y0 = S.Y(0), hA = S.heightAt;
    const exempt = (x, y) => { const i0 = Math.round((x - x0) / c), j0 = Math.round((y - y0) / c); for (let j = j0 - 2; j <= j0 + 2; j++) for (let i = i0 - 2; i <= i0 + 2; i++) { if (i < 0 || j < 0 || i >= NX || j >= NY) continue; const t = S.TAG[j * NX + i]; if (t !== 0 && t !== 1) return true; } return false; }; // 坡道/土桥/桥台改过的地方：边线由那些规则定义
    // 沿法线找“第一次低于 zt”的位置（0.05 m 步进 + 二分）
    const firstBelow = (px, py, nx, ny, d0, d1, zt) => { let prev = d0; for (let d = d0; d <= d1 + 1e-9; d += 0.1) { if (hA(px + nx * d, py + ny * d) < zt) { if (d === d0) return d0; let lo = prev, hi = d; for (let it = 0; it < 10; it++) { const m = (lo + hi) / 2; if (hA(px + nx * m, py + ny * m) < zt) hi = m; else lo = m; } return hi; } prev = d; } return null; };
    const E19 = new Map(), E21 = new Map(), SEC = []; let n19 = 0;
    // 所有曲轮边（任何曲轮）按 8 m 分桶：量断面时，若别的边（另一条墙脚/另一面石垣）穿过这条断面，就不是“单独一面石垣”的断面，不量
    const EB = new Map(); for (const g of S.regions) for (const e of g.edges) { const a0 = Math.floor((Math.min(e.ax, e.bx) - 8) / 8), a1 = Math.floor((Math.max(e.ax, e.bx) + 8) / 8), b0 = Math.floor((Math.min(e.ay, e.by) - 8) / 8), b1 = Math.floor((Math.max(e.ay, e.by) + 8) / 8); for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) { const k = a * 100003 + b; let L = EB.get(k); if (!L) EB.set(k, L = []); L.push(e); } }
    const crossOther = (e, ax, ay, bx, by) => { for (const f of EB.get(Math.floor(ax / 8) * 100003 + Math.floor(ay / 8)) || []) { if (f === e) continue; if (Math.abs(f.nx * e.ny - f.ny * e.nx) < 1e-6 && Math.abs((f.ax - e.ax) * e.nx + (f.ay - e.ay) * e.ny) < 1e-6) continue; /* 与本边共线重合（同一条线的另一侧） */ const r = segX([ax, ay], [bx, by], [f.ax, f.ay], [f.bx, f.by]); if (r && r[0] >= 0 && r[0] <= 1 && r[1] >= 0 && r[1] <= 1) return true; for (const [px, py] of [[f.ax, f.ay], [f.bx, f.by]]) if (segDist(px, py, ax, ay, bx, by) < 0.5) return true; if (segDist(ax, ay, f.ax, f.ay, f.bx, f.by) < 0.3 || segDist(bx, by, f.ax, f.ay, f.bx, f.by) < 0.3) return true; } return false; };
    for (const g of S.regions) for (const e of g.edges) {
      if (!e.B || e.chord || e.band || e.mixed || e.ring < 0) continue; const top = g.z, zl = e.zl, s2 = Math.max(1 / IG.ratio, (top - zl) / IG.maxRun), Bq = (top - zl) / s2, zlow = Math.max(zl, S.WZ), m0 = Bq + 2 * c; if (e.len < 2 * m0 + 1 || top - zlow < 1) continue;
      for (let s = m0; s <= e.len - m0; s += 2) {
        const tx = e.ax + e.tx * s, ty = e.ay + e.ty * s, cx = tx - e.nx * Bq, cy = ty - e.ny * Bq;
        if (Math.abs(S.crestDist(g, cx, cy)) > 0.02 || S.zoneAt(cx - e.nx * 0.5, cy - e.ny * 0.5) !== g || exempt(cx, cy) || exempt(tx, ty)) continue;
        // 只量“这条边单独控制”的断面：网格范围内、台地一侧确实是本曲轮的格点、沿法线的顶线距离场就是这条边的（不在两面石垣相交的角上）
        const vi = Math.round((cx - e.nx * 0.5 - x0) / c), vj = Math.round((cy - e.ny * 0.5 - y0) / c); if (vi < 1 || vj < 1 || vi >= NX - 1 || vj >= NY - 1 || S.CLS[vj * NX + vi] !== g.i) continue;
        if ([-0.5, 0.5, Bq * 0.9].some(d => Math.abs(S.crestDist(g, cx + e.nx * d, cy + e.ny * d) + d) > 0.05)) continue;
        if (vi < 4 || vj < 4 || vi >= NX - 5 || vj >= NY - 5 || crossOther(e, cx - e.nx * 0.5, cy - e.ny * 0.5, tx + e.nx * 1.5, ty + e.ny * 1.5)) continue;
        n19++; SEC.push(cx - e.nx * 1.0, cy - e.ny * 1.0, tx + e.nx * 2.0, ty + e.ny * 2.0); // 量过的断面（−1 m … 坡脚外 2 m）
        // H19：顶线处的高度 = 台地顶；渲染面开始下降的位置与顶线的水平偏差
        const zc = hA(cx, cy), dExp = CF.drop / s2, dF = firstBelow(cx, cy, e.nx, e.ny, -1.0, 2.0, top - CF.drop);
        const dev = dF === null ? 9 : Math.abs(dF - dExp), dz = Math.abs(zc - top);
        if (dev > CF.tol || dz > CF.tol) { const w = E19.get(e) || { e, g, n: 0, dev: 0, dz: 0, x: cx, y: cy }; w.n++; w.dev = Math.max(w.dev, dev); w.dz = Math.max(w.dz, dz); E19.set(e, w); }
        // H21：面坡实测勾配（顶线下 0.05 m 到坡脚/水面上 0.05 m）= 设计勾配；墙脚线处高度 = 下层高程（水面以上时）
        if (dF === null) continue; const dL = firstBelow(cx, cy, e.nx, e.ny, dF, Bq + 2.0, zlow + CF.drop);
        const bat = dL === null ? 9 : (dL - dF) / (top - zlow - 2 * CF.drop), des = 1 / s2, toeDz = zl > S.WZ ? Math.abs(hA(tx, ty) - zl) : 0;
        if (Math.abs(bat - des) > CF.batTol || des < CF.batRange[0] - 1e-9 || des > CF.batRange[1] + 1e-9 || toeDz > CF.tol) { const w = E21.get(e) || { e, g, n: 0, bat, des, toe: 0, x: tx, y: ty }; w.n++; if (Math.abs(bat - des) > Math.abs(w.bat - des)) w.bat = bat; w.toe = Math.max(w.toe, toeDz); E21.set(e, w); }
      }
    }
    for (const w of E19.values()) bad('H19', { name: w.g.name + '石垣顶线', x: w.x, y: w.y }, w.n + ' 处顶线不齐：水平偏差最大 ' + w.dev.toFixed(2) + ' m、高差 ' + w.dz.toFixed(2) + ' m（> ' + CF.tol + ' m，台阶状）');
    for (const w of E21.values()) bad('H21', { name: w.g.name + '石垣面', x: w.x, y: w.y }, w.n + ' 处勾配不符：实测 ' + w.bat.toFixed(2) + ' / 设计 ' + w.des.toFixed(2) + (w.toe > CF.tol ? '，墙脚高差 ' + w.toe.toFixed(2) + ' m' : ''));
    // H20：有防御线的曲轮地面——①地面三角形坡度 ≤ floorMax（坡道/土桥/桥台改过的格除外）；②没有积水坑（优先队列洪泛：从曲轮边界往里，水位 = 路径上的最高点，深 > pit 计坑）
    let slopeBad = 0;
    const triSlope = (ax, ay, az, bx, by, bz, cx2, cy2, cz) => { const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx2 - ax, vy = cy2 - ay, vz = cz - az, nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; return Math.abs(nz) < 1e-12 ? 1e9 : Math.hypot(nx, ny) / Math.abs(nz); };
    for (const lp of S.loops || []) {
      const g = lp.g, b = lp.bbb, i0 = Math.max(0, Math.floor((b[0] - x0) / c)), i1 = Math.min(NX - 2, Math.ceil((b[2] - x0) / c)), j0 = Math.max(0, Math.floor((b[1] - y0) / c)), j1 = Math.min(NY - 2, Math.ceil((b[3] - y0) / c));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const q = j * NX + i, Hh0 = S.H, CL = S.CLS, TG = S.TAG; if (!(S.splitIdx && S.splitIdx[q] >= 0) && Hh0[q] === g.z && Hh0[q + 1] === g.z && Hh0[q + NX] === g.z && Hh0[q + NX + 1] === g.z) continue; // 四角都在台地高、没切开 → 平的
        if (CL[q] !== g.i || CL[q + 1] !== g.i || CL[q + NX] !== g.i || CL[q + NX + 1] !== g.i || TG[q] > 1 || TG[q + 1] > 1 || TG[q + NX] > 1 || TG[q + NX + 1] > 1) continue;
        const sp = S.splitIdx && S.splitIdx[q] >= 0 ? S.splitTris[S.splitIdx[q]].tris : null, T2 = sp || (() => { const X0 = S.X(i), Y0 = S.Y(j), X1 = X0 + c, Y1 = Y0 + c, Hh = S.H; return [X0, Y0, Hh[q], X1, Y0, Hh[q + 1], X1, Y1, Hh[q + NX + 1], X0, Y0, Hh[q], X1, Y1, Hh[q + NX + 1], X0, Y1, Hh[q + NX]]; })();
        let cellBad = 0, cd = null; // cd：格心的顶线距离；距离场 1-Lipschitz → |cd| > 半对角线时整格同侧，不必逐个三角形求（只为提速）
        for (let k = 0; k < T2.length; k += 9) { const sl = triSlope(T2[k], T2[k + 1], T2[k + 2], T2[k + 3], T2[k + 4], T2[k + 5], T2[k + 6], T2[k + 7], T2[k + 8]); if (sl <= CF.floorMax) continue;
          if (cd === null) cd = S.crestDist(g, S.X(i) + c / 2, S.Y(j) + c / 2); if (cd < CF.drop - c * 0.7072) break;
          const mx = (T2[k] + T2[k + 3] + T2[k + 6]) / 3, my = (T2[k + 1] + T2[k + 4] + T2[k + 7]) / 3; if ((cd < CF.drop + c * 0.7072 && S.crestDist(g, mx, my) < CF.drop) || !S.inEncl(g, mx, my)) continue; cellBad = Math.max(cellBad, sl); }
        if (cellBad) { slopeBad++; bad('H20', { name: g.name + '地面', x: S.X(i) + c / 2, y: S.Y(j) + c / 2 }, '地面格坡度 ' + (cellBad * 100).toFixed(0) + '% > ' + (CF.floorMax * 100) + '%（台地边缘塌成斜面）'); }
      }
    }
    for (const lp of S.loops || []) { // 积水坑
      const g = lp.g, N = NX * NY, inG = q => S.CLS[q] === g.i, spill = new Float32Array(N).fill(Infinity), Hq = fheap(), b = lp.bbb, bi0 = Math.max(0, Math.floor((b[0] - x0) / c) - 2), bi1 = Math.min(NX - 1, Math.ceil((b[2] - x0) / c) + 2), bj0 = Math.max(0, Math.floor((b[1] - y0) / c) - 2), bj1 = Math.min(NY - 1, Math.ceil((b[3] - y0) / c) + 2);
      const IDX = []; for (let j = bj0; j <= bj1; j++) for (let i = bi0; i <= bi1; i++) IDX.push(j * NX + i); // 曲轮的格点都在它的包围盒内（只为提速）
      for (const q of IDX) { if (!inG(q)) continue; const i = q % NX; if (i === 0 || i === NX - 1 || q < NX || q >= N - NX || !inG(q - 1) || !inG(q + 1) || !inG(q - NX) || !inG(q + NX)) { spill[q] = S.H[q]; Hq.push(S.H[q], q); } }
      while (Hq.size()) { const lv = Hq.topKey(), q = Hq.pop(); if (lv > spill[q]) continue; for (const k of [q - 1, q + 1, q - NX, q + NX]) { if (k < 0 || k >= N || !inG(k)) continue; const nl = Math.max(S.H[k], lv); if (nl < spill[k]) { spill[k] = nl; Hq.push(nl, k); } } }
      let pits = 0, px = 0, py = 0, dmax = 0; for (const q of IDX) if (inG(q) && spill[q] - S.H[q] > CF.pit) { pits++; if (spill[q] - S.H[q] > dmax) { dmax = spill[q] - S.H[q]; px = S.X(q % NX); py = S.Y((q - q % NX) / NX); } }
      if (pits) bad('H20', { name: g.name + '地面', x: px, y: py }, pits + ' 个格点积水（最深 ' + dmax.toFixed(2) + ' m，排不出去）');
    }
    return { samples: n19, sections: SEC };
  }

  function signature(S) {
    let h = 2166136261; const mix = v => { h ^= Math.round(v * 100) | 0; h = Math.imul(h, 16777619) >>> 0; };
    for (const p of S.parts) { mix(p.x !== undefined ? p.x : p.x0); mix(p.y !== undefined ? p.y : p.y0); mix(p.z !== undefined ? p.z : p.z0); }
    for (const t of S.trees) { mix(t.x); mix(t.y); mix(t.s); }
    for (let q = 0; q < S.H.length; q += 97) mix(S.H[q]);
    return h.toString(16) + '-' + S.parts.length + '-' + S.trees.length;
  }

  G.CASTLE_SITE = { SPEC, RULES, build, audit, rectPoly, segPoly, inPoly, polyDist, treeGeom, walkGrid, netAudit, conformAudit, _physics: physics };
})(typeof window !== 'undefined' ? window : globalThis);
