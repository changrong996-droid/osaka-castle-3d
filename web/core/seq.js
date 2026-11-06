'use strict';
// ===== SEQ：通用“构件图 + 时间游标”核心（proto-build1；proto-port1 起移到 web/core/，加网络层：R5–R7、资源排程、蒙特卡洛、方案对比、审计） =====
// 不含任何大阪城专用内容：同一套可以驱动 F-35B / A380 之类的“解剖/装配”图。
//   1. 几何工具 Geo：三角形/四边形/六面体（自动外向定向）+ 墨线边；体积按散度定理（闭合网格的有向四面体和）、面积逐三角形累加。
//   2. SEQ.plan(parts, rules)：按规则推出依赖（支承 / 先挖后建 / 阶段 after）→ 带优先级的拓扑排序 → 步骤与工期（质量 ÷ 工种效率）→ 时间轴、事件流、统计。
//   3. SEQ.compile(THREE, plan)：全部构件并进 1 个网格 + 1 组线段，每顶点带 aK=(起始日, 时长, 类型) 与 aB=(ymin, ymax)；
//      着色器只看 uniform uT（时间游标）就分出 已建 / 正在建（红 + 上升）/ 未建（幽灵）——一帧 3 次绘制调用。
(function (G) {
const SEQ = {};

// ---------- 几何工具 ----------
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
const avg = pts => { const r = [0, 0, 0]; for (const p of pts) { r[0] += p[0]; r[1] += p[1]; r[2] += p[2]; } return r.map(v => v / pts.length); };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
SEQ.v = { sub: sub3, cross, dot, len, avg, lerp: lerp3 };
SEQ.quadArea = (a, b, c, d) => (len(cross(sub3(b, a), sub3(c, a))) + len(cross(sub3(c, a), sub3(d, a)))) / 2;

class Geo {
  constructor(col) { this.P = []; this.N = []; this.C = []; this.S = []; this.L = []; this.LS = []; this.vol = 0; this.area = 0; this.sub = 0; this.subMax = 0; this.col = col || [0.7, 0.7, 0.7]; this.min = [1e9, 1e9, 1e9]; this.max = [-1e9, -1e9, -1e9]; this.tris = 0; }
  setSub(s) { this.sub = s; if (s > this.subMax) this.subMax = s; return this; }
  _bb(p) { for (let k = 0; k < 3; k++) { if (p[k] < this.min[k]) this.min[k] = p[k]; if (p[k] > this.max[k]) this.max[k] = p[k]; } }
  tri(a, b, c, col) {
    const cr = cross(sub3(b, a), sub3(c, a)), l = len(cr) || 1, n = [cr[0] / l, cr[1] / l, cr[2] / l], cc = col || this.col;
    for (const p of [a, b, c]) { this.P.push(p[0], p[1], p[2]); this.N.push(n[0], n[1], n[2]); this.C.push(cc[0], cc[1], cc[2]); this.S.push(this.sub); this._bb(p); }
    this.vol += dot(a, cross(b, c)) / 6; this.area += l / 2; this.tris++;
  }
  quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); }
  line(a, b) { this.L.push(a[0], a[1], a[2], b[0], b[1], b[2]); this.LS.push(this.sub, this.sub); }
  // 六面体：c = [b0,b1,b2,b3, t0,t1,t2,t3]（底环与顶环同序）。每个面按“法线朝外”自动定向 → 体积为正、背面 = 剖切面。
  hexa(c, col, edges) {
    const ctr = avg(c), F = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
    for (const f of F) {
      const [a, b, cc, d] = f.map(i => c[i]); const n = cross(sub3(b, a), sub3(cc, a));
      if (dot(n, sub3(avg([a, b, cc, d]), ctr)) < 0) this.quad(a, d, cc, b, col); else this.quad(a, b, cc, d, col);
    }
    if (edges !== false) for (let i = 0; i < 4; i++) { this.line(c[i], c[(i + 1) % 4]); this.line(c[4 + i], c[4 + (i + 1) % 4]); this.line(c[i], c[4 + i]); }
  }
  // 柱体：底环 ring（凸多边形，任意朝向）沿向量 d 拉伸；每面按“法线朝外”自动定向。lines: 'all' 全部棱 | 'axis' 两条母线（圆木的墨线） | false
  extrude(ring, d, col, lines) {
    const n = ring.length, top = ring.map(p => [p[0] + d[0], p[1] + d[1], p[2] + d[2]]), ctr = avg([...ring, ...top]);
    const face = pts => { const c = avg(pts); for (let i = 1; i < pts.length - 1; i++) { const a = pts[0], b = pts[i], e = pts[i + 1], nn = cross(sub3(b, a), sub3(e, a)); if (dot(nn, sub3(c, ctr)) < 0) this.tri(a, e, b, col); else this.tri(a, b, e, col); } };
    face(ring); face(top);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, q = [ring[i], ring[j], top[j], top[i]], c = avg(q), nn = cross(sub3(q[1], q[0]), sub3(q[2], q[0]));
      if (dot(nn, sub3(c, ctr)) < 0) this.quad(q[0], q[3], q[2], q[1], col); else this.quad(q[0], q[1], q[2], q[3], col); }
    if (lines === 'all') for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.line(ring[i], ring[j]); this.line(top[i], top[j]); this.line(ring[i], top[i]); }
    else if (lines === 'axis') { const k = Math.floor(n / 2); this.line(ring[0], top[0]); this.line(ring[k], top[k]); }
  }
  // 圆木：a→b，半径 r，n 边
  prism(a, b, r, n, col, lines) {
    const ax = sub3(b, a), L = len(ax) || 1, u = [ax[0] / L, ax[1] / L, ax[2] / L], h = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let e1 = cross(u, h); const l1 = len(e1); e1 = e1.map(v => v / l1); const e2 = cross(u, e1), ring = [];
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n * Math.PI * 2, c = Math.cos(t) * r, s = Math.sin(t) * r; ring.push([a[0] + e1[0] * c + e2[0] * s, a[1] + e1[1] * c + e2[1] * s, a[2] + e1[2] * c + e2[2] * s]); }
    this.extrude(ring, ax, col, lines == null ? 'axis' : lines);
  }
  box(x0, y0, z0, x1, y1, z1, col, edges) { this.hexa([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], col, edges); }
  // 绕竖轴旋转的盒子（中心 cx,cz，底 y0，尺寸 sx×sy×sz，角 a）
  rbox(cx, y0, cz, sx, sy, sz, a, col, edges) {
    const c = Math.cos(a), s = Math.sin(a), P = (u, y, v) => [cx + u * c - v * s, y, cz + u * s + v * c], hx = sx / 2, hz = sz / 2;
    this.hexa([P(-hx, y0, -hz), P(hx, y0, -hz), P(hx, y0, hz), P(-hx, y0, hz), P(-hx, y0 + sy, -hz), P(hx, y0 + sy, -hz), P(hx, y0 + sy, hz), P(-hx, y0 + sy, hz)], col, edges);
  }
}
SEQ.Geo = Geo;

// ---------- 三角形网格索引：射线 / 线段 求交（净空检查、落脚点、吊绳长度）----------
class TriGrid {
  constructor(cell) { this.c = cell || 2; this.T = []; this.tag = []; this.cells = new Map(); this.stamp = null; this.sid = 0; }
  add(geo, tag) {
    const P = geo.P, ic = 1 / this.c, T = this.T, cells = this.cells;
    for (let i = 0; i < P.length; i += 9) {
      const id = this.tag.length; this.tag.push(tag); for (let k = 0; k < 9; k++) T.push(P[i + k]);
      const x0 = Math.floor(Math.min(P[i], P[i + 3], P[i + 6]) * ic), x1 = Math.floor(Math.max(P[i], P[i + 3], P[i + 6]) * ic);
      const y0 = Math.floor(Math.min(P[i + 1], P[i + 4], P[i + 7]) * ic), y1 = Math.floor(Math.max(P[i + 1], P[i + 4], P[i + 7]) * ic);
      const z0 = Math.floor(Math.min(P[i + 2], P[i + 5], P[i + 8]) * ic), z1 = Math.floor(Math.max(P[i + 2], P[i + 5], P[i + 8]) * ic);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) { const kk = ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512); let L = cells.get(kk); if (!L) { L = []; cells.set(kk, L); } L.push(id); }
    }
    return this;
  }
  // 线段 a→b 与三角形求交（Möller–Trumbore），返回 [t, tag]（nearest 时取最近）或 null；filter(tag) 为 false 的三角形跳过
  seg(a, b, filter, nearest) {
    const ic = 1 / this.c, T = this.T, ax = a[0], ay = a[1], az = a[2], dx = b[0] - ax, dy = b[1] - ay, dz = b[2] - az;
    if (!this.stamp || this.stamp.length < this.tag.length) this.stamp = new Uint32Array(this.tag.length + 1024);
    const sid = ++this.sid, stamp = this.stamp; let bt = 2, btag = -1;
    const x0 = Math.floor((Math.min(ax, b[0]) - 1e-6) * ic), x1 = Math.floor((Math.max(ax, b[0]) + 1e-6) * ic), y0 = Math.floor((Math.min(ay, b[1]) - 1e-6) * ic), y1 = Math.floor((Math.max(ay, b[1]) + 1e-6) * ic), z0 = Math.floor((Math.min(az, b[2]) - 1e-6) * ic), z1 = Math.floor((Math.max(az, b[2]) + 1e-6) * ic);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const L = this.cells.get(((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512)); if (!L) continue;
      for (let li = 0; li < L.length; li++) {
        const id = L[li]; if (stamp[id] === sid) continue; stamp[id] = sid;
        if (filter && !filter(this.tag[id])) continue;
        const o = id * 9, px0 = T[o], py0 = T[o + 1], pz0 = T[o + 2];
        const e1x = T[o + 3] - px0, e1y = T[o + 4] - py0, e1z = T[o + 5] - pz0, e2x = T[o + 6] - px0, e2y = T[o + 7] - py0, e2z = T[o + 8] - pz0;
        const qx = dy * e2z - dz * e2y, qy = dz * e2x - dx * e2z, qz = dx * e2y - dy * e2x, det = e1x * qx + e1y * qy + e1z * qz;
        if (det > -1e-12 && det < 1e-12) continue;
        const inv = 1 / det, sx = ax - px0, sy = ay - py0, sz = az - pz0, u = (sx * qx + sy * qy + sz * qz) * inv; if (u < 0 || u > 1) continue;
        const rx = sy * e1z - sz * e1y, ry = sz * e1x - sx * e1z, rz = sx * e1y - sy * e1x, v = (dx * rx + dy * ry + dz * rz) * inv; if (v < 0 || u + v > 1) continue;
        const t = (e2x * rx + e2y * ry + e2z * rz) * inv; if (t < 0 || t > 1) continue;
        if (!nearest) return [t, this.tag[id]];
        if (t < bt) { bt = t; btag = this.tag[id]; }
      }
    }
    return btag >= 0 || bt < 2 ? [bt, btag] : null;
  }
  // 竖直射线：从 o 向上(+1)/向下(-1) 最多 maxD 米，返回命中距离或 null
  rayY(o, dir, maxD, filter) { const h = this.seg(o, [o[0], o[1] + dir * maxD, o[2]], filter, true); return h ? h[0] * maxD : null; }
  // 粗圆柱探针：轴线 + 4 条偏移 r 的母线；返回命中的 tag 或 -1
  probe(a, b, r, filter) {
    const ax = sub3(b, a), L = len(ax) || 1, u = ax.map(v => v / L), h = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let e1 = cross(u, h); const l1 = len(e1); e1 = e1.map(v => v / l1); const e2 = cross(u, e1);
    for (const [p, q] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) { const o = [e1[0] * p + e2[0] * q, e1[1] * p + e2[1] * q, e1[2] * p + e2[2] * q];
      const hit = this.seg([a[0] + o[0], a[1] + o[1], a[2] + o[2]], [b[0] + o[0], b[1] + o[1], b[2] + o[2]], filter, false); if (hit) return hit[1]; }
    return -1;
  }
}
SEQ.TriGrid = TriGrid;

// ---------- 规则 → 依赖 → 顺序 → 工期 ----------
function bbOverlapXZ(a, b) { const dx = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]), dz = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]); return dx > 0 && dz > 0 ? dx * dz : 0; }
function bbIntersect(a, b, e) { for (let k = 0; k < 3; k++) if (a.max[k] < b.min[k] - e || b.max[k] < a.min[k] - e) return false; return true; }

// parts: [{id, name, stage, group?, trade?, mat, geo, kind?('build'|'remove'|'fill'), count?, tally?, unit?, spec?, vol?, noMass?, scope?,
//          temp?: {serves:[stage], scope, removeStage, removeName}, probes?: [[a,b,r]...], rig?: pose}]
// 临时构件（temp，如足場/支保工）：搭设 = 一个步骤（kind 'temp'），系统自动配一个拆除步骤（kind 'untemp'，阶段 temp.removeStage）。
//   R4：temp 服务的步骤 D（阶段 ∈ serves 且 scope 相同）—— 搭设先于 D 开工，拆除晚于 D 完成；拆除阶段可标 asap（一旦允许就拆）。
// rules: {stages:[{key,name,verb,trade,order:'z'|'-z',after:[keys],near}], mats:{key:{name,rho}}, rates:{trade:t/day}, digRate, fillRate(m3/day), minDays, tol, minOverlap, t0(Date)}
SEQ.plan = function (parts, rules) {
  const T0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const SR = {}; rules.stages.forEach((s, i) => { SR[s.key] = Object.assign({ rank: i, order: 'z' }, s); });
  const tol = rules.tol == null ? 0.06 : rules.tol, minOv = rules.minOverlap == null ? 0.02 : rules.minOverlap;
  for (const p of parts) {
    const m = rules.mats[p.mat]; if (!m) throw new Error('no material ' + p.mat);
    if (!SR[p.stage]) throw new Error('no stage ' + p.stage);
    p.kind = p.temp ? 'temp' : (p.kind || 'build');
    p.vol = p.vol != null ? p.vol : Math.abs(p.geo.vol);       // 体积默认取闭合网格散度积分
    p.mass = p.noMass ? 0 : p.vol * m.rho;                     // 质量 = 体积 × 密度（t/m³）
    p.bb = { min: p.geo.min.slice(), max: p.geo.max.slice() };
    p.anchor = p.anchor || [(p.bb.min[0] + p.bb.max[0]) / 2, p.bb.max[1], (p.bb.min[2] + p.bb.max[2]) / 2];
  }
  // 步骤 = 同 group 的构件
  const steps = [], byG = new Map();
  for (const p of parts) {
    const g = p.group || p.id; let s = byG.get(g);
    if (!s) { s = { key: g, parts: [], stage: p.stage, kind: p.kind, name: p.stepName || p.name, trade: p.trade || SR[p.stage].trade, spec: p.spec || '', bb: { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }, mass: 0, vol: 0, deps: new Set(), why: {} }; byG.set(g, s); steps.push(s); }
    s.parts.push(p); s.mass += p.mass; s.vol += p.vol; if (p.spec && !s.spec) s.spec = p.spec;
    for (let k = 0; k < 3; k++) { s.bb.min[k] = Math.min(s.bb.min[k], p.bb.min[k]); s.bb.max[k] = Math.max(s.bb.max[k], p.bb.max[k]); }
  }
  steps.forEach(s => { const t = {}; for (const p of s.parts) if (p.tally) { t[p.tally] = (t[p.tally] || 0) + (p.count || 0); } s.tally = t; s.anchor = s.parts[0].anchor; const rp = s.parts.find(p => p.rig); s.rig = rp ? rp.rig : null; });
  // 临时构件：每个搭设步骤配一个拆除步骤
  for (const E of steps.filter(x => x.kind === 'temp')) {
    const T = E.parts[0].temp; if (!SR[T.removeStage]) throw new Error('no stage ' + T.removeStage);
    const R = { key: E.key + '~rm', parts: E.parts, stage: T.removeStage, kind: 'untemp', name: T.removeName || E.name + ' 拆除', trade: SR[T.removeStage].trade || E.trade, spec: E.spec, bb: E.bb, mass: E.mass, vol: E.vol, deps: new Set(), why: {}, tally: E.tally, anchor: E.anchor, of: E, rig: null };
    E.rm = R; E.serves = []; E.temp = T; steps.push(R);
  }
  steps.forEach((s, i) => { s.idx0 = i; s.rank = SR[s.stage].rank; });
  // 规则 R1 支承：B 的底面落在 A 的高度范围内且平面投影重叠 → A 先于 B（A 的阶段不晚于 B）
  // 规则 R2 先挖后建：移除类（掘削）先于与其包围盒相交的一切建造
  // 规则 R3 阶段 after：stage.after 里列出的阶段、在 near 米内的步骤都要先完成（如注水在石垣之后）
  let nSup = 0, nDig = 0, nAfter = 0, nTemp = 0;
  for (const B of steps) for (const A of steps) {
    if (A === B || A.kind === 'untemp' || B.kind === 'untemp') continue;
    if (A.kind === 'remove') { if (B.kind !== 'remove' && bbIntersect(A.bb, B.bb, 0.01) && A.rank <= B.rank) { B.deps.add(A); B.why[A.key] = 'dig'; nDig++; } continue; }
    if (B.kind === 'remove') continue;
    const af = SR[B.stage].after;
    if (af && af.includes(A.stage) && bbIntersect(A.bb, B.bb, SR[B.stage].near || 10)) { B.deps.add(A); B.why[A.key] = 'after'; nAfter++; continue; }
    if (A.kind === 'fill' || A.kind === 'temp' || B.rank === 0) continue;   // 临时构件不支承永久构件
    const on = SR[B.stage].on;                      // 阶段可声明“落在哪些阶段上”（如 上层柱 落在 下层梁 上，梁的阶段序更晚也成立）
    if (on) { if (!on.includes(A.stage) && A.stage !== B.stage) continue; }
    else if (A.rank > B.rank) continue;
    if (A.stage === B.stage || !on) { if (A.rank === B.rank && !(A.bb.min[1] < B.bb.min[1] - 1e-4)) continue; }
    if (bbOverlapXZ(A.bb, B.bb) > minOv && A.bb.min[1] <= B.bb.min[1] + tol && A.bb.max[1] >= B.bb.min[1] - tol) { B.deps.add(A); B.why[A.key] = 'sup'; nSup++; }
  }
  // 规则 R4 临时支承：temp 服务的步骤开工前已搭好、全部完成后才拆
  for (const E of steps) if (E.kind === 'temp') {
    const T = E.temp; E.rm.deps.add(E); E.rm.why[E.key] = 'erect';
    for (const D of steps) {
      if (D.kind === 'temp' || D.kind === 'untemp' || D.kind === 'remove' || !T.serves.includes(D.stage) || !D.parts.some(p => p.scope === T.scope)) continue;
      D.deps.add(E); D.why[E.key] = 'temp'; E.rm.deps.add(D); E.rm.why[D.key] = 'served'; E.serves.push(D); nTemp++;
    }
  }
  // 审计：每个非地基步骤至少有一个支承（或挖方/after）前驱；依赖不成环
  const unsupported = steps.filter(s => s.rank > 0 && s.kind !== 'remove' && s.kind !== 'untemp' && ![...s.deps].some(d => s.why[d.key] === 'sup' || s.why[d.key] === 'after'));
  // 带优先级的 Kahn 拓扑排序：可开工的步骤里取（阶段序, 阶段内顺序, 原序）最小者
  const ordV = s => { const o = SR[s.stage].order; return o === '-z' ? -s.bb.max[1] : s.bb.min[1]; };
  const indeg = new Map(steps.map(s => [s, s.deps.size])), out = new Map(steps.map(s => [s, []]));
  for (const s of steps) for (const d of s.deps) out.get(d).push(s);
  const ready = steps.filter(s => indeg.get(s) === 0), seq = [];
  const asap = s => SR[s.stage].asap ? 0 : 1;
  const better = (a, b) => asap(a) !== asap(b) ? asap(a) < asap(b) : a.rank !== b.rank ? a.rank < b.rank : Math.abs(ordV(a) - ordV(b)) > 1e-6 ? ordV(a) < ordV(b) : a.idx0 < b.idx0;
  while (ready.length) {
    let bi = 0; for (let i = 1; i < ready.length; i++) if (better(ready[i], ready[bi])) bi = i;
    const s = ready.splice(bi, 1)[0]; seq.push(s);
    for (const n of out.get(s)) { indeg.set(n, indeg.get(n) - 1); if (indeg.get(n) === 0) ready.push(n); }
  }
  const cyclic = steps.length - seq.length;
  // 工期：建造 = 质量 ÷ 工种效率（t/日）；挖方 = 体积 ÷ digRate；注水 = 体积 ÷ fillRate；下限 minDays。串行（一个工作面）
  let t = 0;
  seq.forEach((s, i) => {
    s.i = i; let d; const fixed = s.parts.find(p => p.days);
    if (fixed) d = fixed.days;
    else if (s.kind === 'remove') d = s.vol / (rules.digRate || 1000);
    else if (s.kind === 'fill') d = s.vol / (rules.fillRate || 5000);
    else d = s.mass / (SR[s.stage].rate || (rules.rates && rules.rates[s.trade]) || 10);
    s.dur = Math.max(rules.minDays || 1, d); s.start = t; s.end = t + s.dur; t = s.end + (rules.gap || 0);
  });
  const total = seq.length ? seq[seq.length - 1].end : 0;
  // 阶段带
  const bands = rules.stages.map(st => { const ss = seq.filter(s => s.stage === st.key); return ss.length ? { key: st.key, name: st.name, a: Math.min(...ss.map(s => s.start)), b: Math.max(...ss.map(s => s.end)), steps: ss } : null; }).filter(Boolean);
  // 事件流（开工 / 完成）
  const events = [];
  for (const s of seq) { events.push({ t: s.start, ev: 'start', s }); events.push({ t: s.end, ev: 'end', s }); }
  events.sort((a, b) => a.t - b.t || (a.ev === 'end' ? -1 : 1));
  // R4 自检（按排出的时间表核对）：搭设.end ≤ D.start、拆除.start ≥ D.end；竣工时不得有残留临时构件
  const temps = seq.filter(s => s.kind === 'temp'); let r4v = 0; const r4ex = [];
  for (const E of temps) for (const D of E.serves) {
    if (E.end > D.start + 1e-6) { r4v++; r4ex.push(E.name + ' 晚于 ' + D.name); }
    if (E.rm.start < D.end - 1e-6) { r4v++; r4ex.push(E.rm.name + ' 早于 ' + D.name + ' 完成'); }
  }
  const leftover = temps.filter(E => !(E.rm.end <= total + 1e-6)).length;
  const plan = { parts, steps: seq, stages: SR, bands, events, total, rules, audit: { unsupported, cyclic, deps: nSup + nDig + nAfter + nTemp, nSup, nDig, nAfter, nTemp, r4: { temps: temps.length, pairs: temps.reduce((a, E) => a + E.serves.length, 0), violations: r4v, ex: r4ex.slice(0, 5), leftover } }, ms: 0 };
  // 时间游标 → 状态与统计（与着色器同一公式：p = clamp((t-start)/dur)）
  plan.at = function (tt) {
    const r = { t: tt, cur: null, p: 0, mass: 0, removed: 0, tally: {}, tempUp: {}, tempMass: 0, elev: null, done: 0, stage: null };
    for (const s of seq) {
      const p = Math.max(0, Math.min(1, (tt - s.start) / s.dur));
      if (tt >= s.start && tt < s.end) { r.cur = s; r.p = p; }
      if (p >= 1) r.done++;
      if (p <= 0) continue;
      if (s.kind === 'remove') { r.removed += s.vol * p; continue; }
      if (s.kind === 'temp' || s.kind === 'untemp') {           // 临时构件：在位 = 已搭 − 已拆；tally 记“现存”，tempUp 记累计搭设
        const sg = s.kind === 'temp' ? 1 : -1; r.tempMass += sg * s.mass * p;
        for (const k in s.tally) { const n = Math.floor(s.tally[k] * p + 1e-9); r.tally[k] = (r.tally[k] || 0) + sg * n; if (sg > 0) r.tempUp[k] = (r.tempUp[k] || 0) + n; }
        continue;
      }
      r.mass += s.mass * p;
      for (const k in s.tally) r.tally[k] = (r.tally[k] || 0) + Math.floor(s.tally[k] * p + 1e-9);   // 计数取整：未完成的一块不算
      if (s.kind === 'build') { const e = s.bb.min[1] + (s.bb.max[1] - s.bb.min[1]) * p; if (r.elev === null || e > r.elev) r.elev = e; }
    }
    if (!r.cur) { const last = seq.filter(s => s.end <= tt).pop(); r.stage = last ? last.stage : seq[0] && seq[0].stage; } else r.stage = r.cur.stage;
    r.pct = total ? Math.min(1, tt / total) : 0;
    return r;
  };
  plan.date = d => { const D = new Date((rules.t0 || new Date(2000, 0, 1)).getTime() + Math.round(d) * 864e5); return D.getFullYear() + '-' + String(D.getMonth() + 1).padStart(2, '0') + '-' + String(D.getDate()).padStart(2, '0'); };
  if (rules.clearance !== false && (temps.length || seq.some(s => s.rig))) plan.audit.clear = SEQ.clearance(plan);
  plan.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - T0;
  return plan;
};

// ---------- 净空检查（R4c）：临时构件 / 吊具 不得穿过与其同时在场的永久构件 ----------
// 临时构件 T：与“开工早于 T 拆除完成”的永久构件比；吊具（步骤 s 的 rig 位姿）：与“开工早于 s 完成”的永久构件比。
// 每根杆件按粗圆柱探针（轴线 + 4 条偏移 r 的母线）做线段–三角形求交。
SEQ.clearance = function (plan, cell) {
  const T0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const grid = new TriGrid(cell || 2), own = [];
  for (const s of plan.steps) if (s.kind === 'build') for (const p of s.parts) { own.push(s); grid.add(p.geo, own.length - 1); }
  const out = { members: 0, hits: 0, rigPoses: 0, rigHits: 0, ex: [], ms: 0 };
  for (const E of plan.steps) if (E.kind === 'temp') {
    const until = E.rm.end, f = tag => own[tag].start < until - 1e-6;
    for (const p of E.parts) for (const [a, b, r] of (p.probes || [])) { out.members++; const h = grid.probe(a, b, r, f); if (h >= 0) { out.hits++; if (out.ex.length < 6) out.ex.push(p.name + ' × ' + own[h].name); } }
  }
  for (const s of plan.steps) if (s.rig && s.rig.probes) {
    out.rigPoses++; const f = tag => own[tag].start < s.end - 1e-6; let bad = 0;
    for (const [a, b, r] of s.rig.probes) { const h = grid.probe(a, b, r, f); if (h >= 0) { bad = 1; if (out.ex.length < 6) out.ex.push('吊具@' + s.name + ' × ' + own[h].name); break; } }
    out.rigHits += bad;
  }
  out.ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - T0);
  return out;
};

// ---------- 渲染：合并几何 + 时间游标着色器 ----------
// 顶点状态 vS：-1 未建（幽灵）· [0,1) 施工中 · 2 已建 · -3 不画。aK.z 类型：0 建 1 挖 2 充填 3 临时（aR = 拆除起点/时长）4 吊具（uRig 位姿）
const STATE = `
float rigOn(float ty){ return (uRig2.w > .5 && ((ty < .5 || ty > 2.5 && ty < 3.5) ? uRig2.w > 1.5 : (ty > 3.5 ? uRig2.w < 1.5 : true))) ? 1. : 0.; }
vec3 rigPos(vec3 q, float ty){
  if (ty < .5) q = vec3(q.x, q.y * uRig2.x, q.z + q.y * uRig2.y);
  else if (ty < 1.5 || ty > 3.5) q = vec3(q.x, q.y + uRig2.x, q.z + uRig2.y);
  else if (ty < 2.5) q = vec3(q.x, q.y + uRig2.x - uRig2.z, q.z + uRig2.y);
  float c = cos(uRig.w), s = sin(uRig.w);
  return uRig.xyz + vec3(q.x * c + q.z * s, q.y, -q.x * s + q.z * c);
}
void stateOf(inout vec3 pos, out float st, out float p, out float rm, out float cur){
  p = clamp((uT - aK.x) / max(aK.y, 1e-4), 0., 1.); rm = -1.;
  cur = (aK.x >= uCur.x - 1e-3 && aK.x < uCur.y) ? 1. : 0.;
  if (aK.z < .5) { st = uT < aK.x ? -1. : (p < 1. ? p : 2.); if (st >= 0. && st < 1.) pos.y -= (1. - st) * (1. - st) * uRise; }
  else if (aK.z < 1.5) { st = uT < aK.x ? 2. : (p < 1. ? p : -3.); }   // 移除：开工前是“原状”，完成后消失
  else if (aK.z < 2.5) { st = uT < aK.x ? -1. : (p < 1. ? p : 2.); }   // 充填：自下而上
  else if (aK.z < 3.5) {                                                // 临时：搭设（上升）→ 在场 → 拆除（自上而下消失）→ 不画
    if (uT < aK.x) st = -1.;
    else if (p < 1.) { st = p; pos.y -= (1. - st) * (1. - st) * uRise; }
    else if (uT < aR.x) st = 2.;
    else { float q = clamp((uT - aR.x) / max(aR.y, 1e-4), 0., 1.); if (q < 1.) { st = .5; rm = q; } else st = -3.; }
    if (aR.x >= uCur.x - 1e-3 && aR.x < uCur.y) cur = 1.;
  } else { st = rigOn(aB.x) > .5 ? 2.5 : -3.; pos = rigPos(pos, aB.x); cur = 0.; }
}`;
const VS = `
attribute vec3 aCol; attribute vec3 aK; attribute vec2 aB; attribute vec2 aR; attribute float aF;
uniform float uT; uniform vec2 uCur; uniform float uRise; uniform vec4 uRig; uniform vec4 uRig2;
varying vec3 vN; varying vec3 vC; varying vec3 vW; varying float vS; varying float vCur; varying float vKind; varying float vP; varying vec2 vB; varying float vRm; varying float vF;
${STATE}
void main(){
  vec3 pos = position; float st, p, rm, cur; stateOf(pos, st, p, rm, cur);
  vS = st; vP = p; vKind = aK.z; vB = aB; vRm = rm; vCur = cur; vF = aF;
  vec3 nn = normal; if (aK.z > 3.5) { float c = cos(uRig.w), s = sin(uRig.w); nn = vec3(nn.x * c + nn.z * s, nn.y, -nn.x * s + nn.z * c); }
  vec4 w = modelMatrix * vec4(pos, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * nn); vC = aCol;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FS = `
uniform float uMode; uniform float uGhost; uniform float uPass; uniform vec4 uCut; uniform float uCutOn; uniform float uCrit;
uniform vec3 uSun; uniform vec3 uPaper; uniform vec3 uRed; uniform vec3 uInk;
varying vec3 vN; varying vec3 vC; varying vec3 vW; varying float vS; varying float vCur; varying float vKind; varying float vP; varying vec2 vB; varying float vRm; varying float vF;
void main(){
  if (uCutOn > .5 && dot(vW, uCut.xyz) > uCut.w) discard;
  bool future = vS < -0.5 && vS > -1.5;
  if (uPass > .5) {                                   // 幽灵趟：只画未建（临时构件更淡）
    if (!future || uGhost < .5) discard;
    gl_FragColor = vec4(uRed, (vCur > .5 ? 0.15 : 0.03) * (vKind > 2.5 ? 0.5 : 1.) * (uCrit > .5 && vF > .5 ? 3. : 1.)); return;
  }
  if (vS < 0.) discard;
  bool cur = vS < 1.;
  if (cur && vKind > .5 && vKind < 1.5 && vW.y > mix(vB.y, vB.x, vP)) discard;  // 掘削：从上往下挖
  if (cur && vKind > 1.5 && vKind < 2.5 && vW.y > mix(vB.x, vB.y, vP)) discard; // 充填：从下往上
  if (vRm >= 0. && vW.y > mix(vB.y, vB.x, vRm)) discard;                        // 临时构件拆除：从上往下
  vec3 col;
  if (!gl_FrontFacing) {                               // 背面 = 剖切面 / 挖方断面：红色剖面线
    float h = step(0.72, fract((gl_FragCoord.x + gl_FragCoord.y) / 6.));
    col = mix(mix(uPaper, uRed, 0.16), mix(uPaper, uRed, 0.7), h);
    gl_FragColor = vec4(col, 1.); return;
  }
  vec3 n = normalize(vN); float l = max(dot(n, uSun), 0.); float hemi = 0.5 + 0.5 * n.y;
  if (uMode > .5) {                                    // 墨线 + 淡彩
    vec3 base = mix(uPaper, vC, vKind > 2.5 ? 0.62 : 0.42);
    float f = l > 0.55 ? 1.0 : (l > 0.18 ? 0.9 : 0.8);
    if (n.y > 0.75) f = 1.04;
    col = base * f;
    if (l < 0.18 && n.y < 0.5) col *= 1. - 0.08 * step(0.8, fract((gl_FragCoord.x - gl_FragCoord.y) / 4.));
  } else {
    col = vC * (0.28 + 0.32 * hemi + 0.78 * l);
    col = mix(col, uPaper, 0.06);
  }
  if (uCrit > .5 && vF > .5 && !cur) col = mix(col, uRed, 0.42);   // 关键路径描红（proto-port1；默认关）
  if (cur) col = mix(col, uRed, 0.62 + 0.2 * (1. - vS));
  gl_FragColor = vec4(col, 1.);
}`;
const LVS = `
attribute vec3 aK; attribute vec2 aB; attribute vec2 aR; attribute float aF;
uniform float uT; uniform vec2 uCur; uniform float uRise; uniform vec4 uRig; uniform vec4 uRig2;
varying float vS; varying float vCur; varying vec3 vW; varying float vKind; varying float vP; varying vec2 vB; varying float vRm; varying float vF;
${STATE}
void main(){
  vec3 pos = position; float st, p, rm, cur; stateOf(pos, st, p, rm, cur);
  vS = st; vP = p; vKind = aK.z; vB = aB; vRm = rm; vCur = cur; vF = aF;
  vec4 w = modelMatrix * vec4(pos, 1.); vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const LFS = `
uniform float uMode; uniform float uGhost; uniform vec4 uCut; uniform float uCutOn; uniform vec3 uRed; uniform vec3 uInk; uniform float uLA; uniform float uCrit;
varying float vS; varying float vCur; varying vec3 vW; varying float vKind; varying float vP; varying vec2 vB; varying float vRm; varying float vF;
void main(){
  if (uCutOn > .5 && dot(vW, uCut.xyz) > uCut.w) discard;
  if (vS < -1.5) discard;
  bool cr = uCrit > .5 && vF > .5;
  if (vS < 0.) { if (uGhost < .5) discard; gl_FragColor = vec4(uRed, (vCur > .5 ? 0.7 : (cr ? 0.5 : (vKind > 2.5 ? 0.04 : 0.085))) * uLA); return; }
  if (vRm >= 0. && vW.y > mix(vB.y, vB.x, vRm)) discard;
  if (vS < 1.) {
    if (vKind > .5 && vKind < 1.5 && vW.y > mix(vB.y, vB.x, vP)) discard;
    if (vKind > 1.5 && vKind < 2.5 && vW.y > mix(vB.x, vB.y, vP)) discard;
    gl_FragColor = vec4(uRed, 1.); return;
  }
  if (cr) { gl_FragColor = vec4(uRed, 0.95 * uLA); return; }
  gl_FragColor = uMode > .5 ? vec4(uInk, (vKind > 2.5 ? 0.65 : 0.8) * uLA) : vec4(uInk, (vKind > 2.5 ? 0.35 : 0.2) * uLA);
}`;

// 把 plan 的全部构件（+ 可选吊具 opt.rig: Geo，局部坐标，sub = 顶点类型）并成：solid（1 次）+ ghost（同一几何，透明，1 次）+ lines（1 次）
SEQ.compile = function (THREE, plan, opt) {
  opt = opt || {};
  const items = [];
  for (const s of plan.steps) if (s.kind !== 'untemp') for (const p of s.parts) items.push([s, p]);
  if (opt.rig) items.push([null, { geo: opt.rig, kind: 'rig', bb: { min: [0, 0, 0], max: [0, 0, 0] } }]);
  let nv = 0, nl = 0;
  for (const [, p] of items) { nv += p.geo.P.length / 3; nl += p.geo.L.length / 3; }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), C = new Float32Array(nv * 3), K = new Float32Array(nv * 3), B = new Float32Array(nv * 2), RM = new Float32Array(nv * 2), F = new Float32Array(nv);
  const LP = new Float32Array(nl * 3), LK = new Float32Array(nl * 3), LB = new Float32Array(nl * 2), LR = new Float32Array(nl * 2), LF = new Float32Array(nl);
  let iv = 0, il = 0;
  const KIND = { build: 0, remove: 1, fill: 2, temp: 3, rig: 4 };
  for (const [s, p] of items) {
    const g = p.geo, sm = g.subMax, kd = KIND[p.kind], rig = kd === 4, wf = sm > 0 && !rig ? (opt.subWindow || 0.22) : 1;
    const key = sub => rig ? [0, 0] : [s.start + (sm > 0 ? sub / sm : 0) * s.dur * (1 - wf), s.dur * wf];
    const rm = s && s.rm ? [s.rm.start, s.rm.dur] : [-1, 0], fl = s && opt.flag && opt.flag(s, p) ? 1 : 0;
    for (let i = 0; i < g.P.length / 3; i++, iv++) {
      for (let k = 0; k < 3; k++) { P[iv * 3 + k] = g.P[i * 3 + k]; N[iv * 3 + k] = g.N[i * 3 + k]; C[iv * 3 + k] = g.C[i * 3 + k]; }
      const k = key(g.S[i]); K[iv * 3] = k[0]; K[iv * 3 + 1] = k[1]; K[iv * 3 + 2] = kd;
      B[iv * 2] = rig ? g.S[i] : p.bb.min[1]; B[iv * 2 + 1] = p.bb.max[1]; RM[iv * 2] = rm[0]; RM[iv * 2 + 1] = rm[1]; F[iv] = fl;
    }
    for (let i = 0; i < g.L.length / 3; i++, il++) {
      LP[il * 3] = g.L[i * 3]; LP[il * 3 + 1] = g.L[i * 3 + 1]; LP[il * 3 + 2] = g.L[i * 3 + 2];
      const k = key(g.LS[i]); LK[il * 3] = k[0]; LK[il * 3 + 1] = k[1]; LK[il * 3 + 2] = kd;
      LB[il * 2] = rig ? g.LS[i] : p.bb.min[1]; LB[il * 2 + 1] = p.bb.max[1]; LR[il * 2] = rm[0]; LR[il * 2 + 1] = rm[1]; LF[il] = fl;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  geo.setAttribute('aCol', new THREE.BufferAttribute(C, 3)); geo.setAttribute('aK', new THREE.BufferAttribute(K, 3)); geo.setAttribute('aB', new THREE.BufferAttribute(B, 2)); geo.setAttribute('aR', new THREE.BufferAttribute(RM, 2)); geo.setAttribute('aF', new THREE.BufferAttribute(F, 1));
  geo.computeBoundingSphere();
  const lgeo = new THREE.BufferGeometry();
  lgeo.setAttribute('position', new THREE.BufferAttribute(LP, 3)); lgeo.setAttribute('aK', new THREE.BufferAttribute(LK, 3)); lgeo.setAttribute('aB', new THREE.BufferAttribute(LB, 2)); lgeo.setAttribute('aR', new THREE.BufferAttribute(LR, 2)); lgeo.setAttribute('aF', new THREE.BufferAttribute(LF, 1));
  lgeo.computeBoundingSphere();
  const U = {
    uT: { value: 0 }, uCur: { value: new THREE.Vector2(-1, -1) }, uRise: { value: opt.rise == null ? 1.6 : opt.rise },
    uRig: { value: new THREE.Vector4(0, -999, 0, 0) }, uRig2: { value: new THREE.Vector4(0, 0, 0, 0) },
    uMode: { value: 1 }, uLA: { value: 1 }, uGhost: { value: 1 }, uCut: { value: new THREE.Vector4(0, 0, 1, 1e9) }, uCutOn: { value: 0 }, uCrit: { value: 0 },
    uSun: { value: new THREE.Vector3(-0.45, 0.78, 0.43).normalize() }, uPaper: { value: new THREE.Color(opt.paper || 0xefe9dd) }, uRed: { value: new THREE.Color(opt.red || 0xb3202a) }, uInk: { value: new THREE.Color(opt.ink || 0x1d1a17) },
  };
  const mk = (pass, extra) => new THREE.ShaderMaterial(Object.assign({ uniforms: Object.assign({}, U, { uPass: { value: pass } }), vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide }, extra));
  const solid = new THREE.Mesh(geo, mk(0, { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  const ghost = new THREE.Mesh(geo, mk(1, { transparent: true, depthWrite: false }));
  const lines = new THREE.LineSegments(lgeo, new THREE.ShaderMaterial({ uniforms: U, vertexShader: LVS, fragmentShader: LFS, transparent: true, depthWrite: false }));
  solid.renderOrder = 0; lines.renderOrder = 1; ghost.renderOrder = 2;
  solid.frustumCulled = ghost.frustumCulled = lines.frustumCulled = false;
  const group = new THREE.Group(); group.add(solid, lines, ghost);
  const rigState = { on: 0 };
  return { group, solid, ghost, lines, U, tris: nv / 3, segs: nl / 2, rig: rigState,
    set(t) {
      U.uT.value = t; const r = plan.at(t); if (r.cur && r.cur.dur) U.uCur.value.set(r.cur.start, r.cur.end); else U.uCur.value.set(-1, -1);
      // 吊具：跟着当前步骤；吊物按进度往复提升（lifts 次）
      const q = r.cur && r.cur.rig;
      if (q) { const ph = (r.p * (q.lifts || 3)) % 1, drop = q.dropMax - (q.dropMax - q.dropMin) * ph;
        U.uRig.value.set(q.x, q.y, q.z, q.yaw); U.uRig2.value.set(q.h, q.lean, drop, q.legs ? 2 : 1); rigState.on = q.legs ? 2 : 1; rigState.pose = q; rigState.drop = drop; }
      else { U.uRig2.value.set(0, 0, 0, 0); rigState.on = 0; rigState.pose = null; }
      return r; } };
};

// =====================================================================================================
// ===== 网络层（proto-port1 加）：资源受限、多工作面的“规则 → 依赖 → 排程 → 不确定性 → 方案对比”核心 =====
// 与 SEQ.plan（单工作面串行，筑城用）并存；同样不含任何领域内容。领域插件（seqport.js 之类）只产出活动 + 规则参数。
// 活动 act：{key, name, stage, kind:'build'|'remove'|'fill'|'temp'|'untemp'|'procure'|'wait'|'milestone',
//            parts:[{geo,...}], bb, dur(整数日), res:{类型:台数}, release(最早开工日), phase, unit, scope, env(作业包络 bb), excl(净空类),
//            cost(元), qty:{量名:值}, tally:{计数名:值}, need:'sup'(须有支承前驱)}
// 依赖 a.pred = [{a: 前驱, lag: 日, why: 规则名}]；全部整数日 → 跨架构（x86 / arm）逐位一致。
// =====================================================================================================
const BB = {
  of(parts) { const b = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }; for (const p of parts) for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], p.geo.min[k]); b.max[k] = Math.max(b.max[k], p.geo.max[k]); } return b; },
  hit(a, b, e) { e = e || 0; for (let k = 0; k < 3; k++) if (a.max[k] < b.min[k] - e || b.max[k] < a.min[k] - e) return false; return true; },
  hitXZ(a, b, e) { e = e || 0; return !(a.max[0] < b.min[0] - e || b.max[0] < a.min[0] - e || a.max[2] < b.min[2] - e || b.max[2] < a.min[2] - e); },
  ovXZ: bbOverlapXZ,
  grow(a, e) { return { min: [a.min[0] - e, a.min[1] - e, a.min[2] - e], max: [a.max[0] + e, a.max[1] + e, a.max[2] + e] }; },
};
SEQ.BB = BB;
SEQ.link = function (B, A, why, lag) { if (A === B) return 0; for (const e of B.pred) if (e.a === A) { if ((lag || 0) > e.lag) { e.lag = lag; e.why = why; return 1; } return 0; } B.pred.push({ a: A, lag: lag || 0, why }); return 1; };
SEQ.act = function (o) {
  const a = Object.assign({ kind: 'build', parts: [], res: {}, release: 0, phase: 1, cost: 0, qty: {}, tally: {}, pred: [], dur: 1 }, o);
  for (const p of a.parts) { p.kind = p.kind || a.kind; p.vol = p.vol != null ? p.vol : Math.abs(p.geo.vol); p.bb = { min: p.geo.min.slice(), max: p.geo.max.slice() }; }
  if (!a.bb && a.parts.length) a.bb = BB.of(a.parts);
  if (!a.env && a.bb) a.env = a.bb;
  a.dur = Math.max(a.kind === 'milestone' ? 0 : 1, Math.ceil(a.dur - 1e-9));
  return a;
};

// ---------- 规则类型（参数化）：每个返回新增依赖条数；SEQ.derive 依次套用 ----------
// 每条规则 = {type, id, ...参数}；sel(a) 为活动筛选。所有几何判断只用包围盒（bb）与作业包络（env）。
const sel = f => typeof f === 'function' ? f : (Array.isArray(f) ? (a => f.includes(a.stage)) : (f ? (a => a.stage === f) : (() => true)));
const sameScope = (a, b, sc) => !sc || sc === 'any' || (sc === 'unit' ? a.unit === b.unit : a.scope === b.scope);
SEQ.RULE = {
  // R1 支承：B 的底面落在 A 的顶面附近（±tol）且平面投影重叠 > minOv → A 先于 B。on[B 阶段] = 允许作支承的阶段
  support(acts, r) { let n = 0; const tol = r.tol == null ? 0.1 : r.tol, mo = r.minOverlap == null ? 1 : r.minOverlap;
    for (const B of acts) { const ok = r.on[B.stage]; if (!ok || !B.bb) continue; B.need = 'sup';
      for (const A of acts) if (A !== B && A.bb && ok.includes(A.stage) && A.kind !== 'temp' && A.kind !== 'remove' && bbOverlapXZ(A.bb, B.bb) > mo && Math.abs(A.bb.max[1] - B.bb.min[1]) <= tol) n += SEQ.link(B, A, r.id || 'R1'); }
    return n; },
  // R2a 先挖后建：移除类 A 先于与其包围盒（外扩 e）相交的一切非移除活动
  dig(acts, r) { let n = 0; const f = sel(r.to); for (const A of acts) if (A.kind === 'remove' && A.bb) for (const B of acts) if (B !== A && B.kind !== 'remove' && B.bb && f(B) && BB.hit(A.bb, B.bb, r.e || 0)) n += SEQ.link(B, A, r.id || 'R2'); return n; },
  // R3 阶段 after：to 阶段的活动须在 from 阶段、近距 near 内（同 scope）的活动完成后开工（可带 lag）
  after(acts, r) { let n = 0; const ft = sel(r.to), ff = sel(r.from);
    for (const B of acts) if (ft(B)) for (const A of acts) if (A !== B && ff(A) && sameScope(A, B, r.scope) && (r.near == null || !A.bb || !B.bb || BB.hit(A.bb, B.bb, r.near))) n += SEQ.link(B, A, r.id || 'R3', typeof r.lag === 'function' ? r.lag(A, B) : (r.lag || 0));
    return n; },
  // R2b 养护 / 满期（硬约束）：to.start ≥ from.end + lag(from)
  cure(acts, r) { r.pairs = []; let n = 0; const ft = sel(r.to), ff = sel(r.from);
    for (const B of acts) if (ft(B)) for (const A of acts) if (A !== B && ff(A) && sameScope(A, B, r.scope)) { const L = r.lag(A); n += SEQ.link(B, A, r.id || 'cure', L); r.pairs.push([A, B, L]); }
    return n; },
  // R4 临时设施：temp 活动自动配拆除活动（kind untemp）；服务对象 D（阶段 ∈ serves、同 scope）：搭设先于 D，拆除晚于 D
  temp(acts, r) { let n = 0; const add = [];
    for (const E of acts) if (E.kind === 'temp' && !E.rm) {
      const R = SEQ.act({ key: E.key + '~rm', name: E.temp.removeName || E.name + ' 拆除', stage: E.temp.removeStage || E.stage, kind: 'untemp', res: E.temp.removeRes || E.res, dur: E.temp.removeDur || Math.max(1, Math.round(E.dur / 2)), unit: E.unit, scope: E.scope, phase: E.phase, cost: 0, bb: E.bb, env: E.env, of: E });
      R.parts = E.parts; E.rm = R; E.serves = []; add.push(R); n += SEQ.link(R, E, 'erect');
      for (const D of acts) if (D !== E && D.kind !== 'temp' && D.kind !== 'untemp' && E.temp.serves.includes(D.stage) && D.scope === E.scope) { n += SEQ.link(D, E, r.id || 'R4'); n += SEQ.link(R, D, 'served'); E.serves.push(D); }
    }
    acts.push(...add); return n; },
  // R6 外部采购提前期：为 stage 的每个活动生成“订货 → 制造 → 运输”活动（不占现场资源，可占厂家产能 res），install.start ≥ 到货
  procure(acts, r) { let n = 0; const f = sel(r.stage), add = [];
    for (const B of acts) if (f(B) && !B.proc) { const L = r.lead(B);
      const P = SEQ.act({ key: B.key + '~buy', name: (r.name || '采购') + '·' + B.name, stage: r.procStage || 'procure', kind: 'procure', dur: L.days, release: r.order ? r.order(B) : 0, res: L.res || {}, unit: B.unit, phase: B.phase, cost: L.cost || 0, of: B, lead: L, tally: L.tally || {} });
      B.proc = P; add.push(P); n += SEQ.link(B, P, r.id || 'R6'); }
    acts.push(...add); return n; },
  // 闸门：to 的活动在 from 活动完成 + lag 后才可开工（分期开工、审批之类）
  gate(acts, r) { let n = 0; const ft = sel(r.to); for (const B of acts) if (ft(B)) { const A = r.from(B, acts); if (A && A !== B) n += SEQ.link(B, A, r.id || 'gate', r.lag || 0); } return n; },
  // R7 分期不干扰：后期活动的作业包络与前期单元 u 的运营区 zone(u)（含航道）相交 → 该活动须在 u 投产 live(u) 前完成（接口前置）
  phase(acts, r) { let n = 0; r.pairs = []; const units = r.units(acts);
    for (const u of units) { const z = r.zone(u), op = r.live(u, acts); if (!op) continue;
      for (const A of acts) if (A.env && A.phase > u.phase && A !== op && A.kind !== 'procure' && A.kind !== 'milestone' && BB.hitXZ(A.env, z, r.margin || 0)) { n += SEQ.link(op, A, r.id || 'R7'); r.pairs.push([A, u, op]); } }
    return n; },
  // 自定义：r.fn(acts, link) 返回条数
  custom(acts, r) { return r.fn(acts, SEQ.link) || 0; },
};
SEQ.derive = function (acts, rules) {
  const counts = {};
  for (const r of rules) { const n = SEQ.RULE[r.type](acts, r); counts[r.id || r.type] = (counts[r.id || r.type] || 0) + n; }
  acts.forEach((a, i) => { a.ix = i; });
  return counts;
};

// ---------- 排程：拓扑 → CPM（无资源）求优先级 → 串行进度生成（SSGS，资源上限 R5 + 净空互斥）----------
// o: {rel:a=>最早开工（延误分析冻结基准用：只许后移）, caps:{类型:上限}, excl:[[类A, 类B, 净距]], dur:a=>日（蒙特卡洛用）, lag:(边, 后继)=>日（养护期抽样 / 风险重排）, pri:(a, LS)=>数（小者先排）, write:true 写回 a.start/a.end}
SEQ.schedule = function (acts, o) {
  o = o || {}; const n = acts.length, caps = o.caps || {}, D = o.dur || (a => a.dur), LG = o.lag ? ((e, a) => o.lag(e, a)) : (e => e.lag), REL = o.rel ? (a => Math.max(a.release | 0, o.rel(a) | 0)) : (a => a.release | 0);
  for (let i = 0; i < n; i++) acts[i].ix = i;
  const d = new Int32Array(n), indeg = new Int32Array(n), succ = acts.map(() => []);
  for (let i = 0; i < n; i++) { const a = acts[i]; d[i] = a.kind === 'milestone' ? 0 : Math.max(1, Math.ceil(D(a) - 1e-9)); for (const e of a.pred) { indeg[i]++; succ[e.a.ix].push(i); } }
  const topo = [], st = []; for (let i = 0; i < n; i++) if (!indeg[i]) st.push(i);
  const ind2 = indeg.slice(); while (st.length) { const i = st.pop(); topo.push(i); for (const j of succ[i]) if (--ind2[j] === 0) st.push(j); }
  const cyclic = n - topo.length; if (cyclic) return { cyclic, total: NaN };
  const ES = new Int32Array(n); let T = 0;
  for (const i of topo) { const a = acts[i]; let s = REL(a); for (const e of a.pred) s = Math.max(s, ES[e.a.ix] + d[e.a.ix] + LG(e, a)); ES[i] = s; T = Math.max(T, s + d[i]); }
  const LF = new Int32Array(n).fill(T);
  for (let k = topo.length - 1; k >= 0; k--) { const i = topo[k]; for (const e of acts[i].pred) { const j = e.a.ix; LF[j] = Math.min(LF[j], LF[i] - d[i] - LG(e, acts[i])); } }
  const key = new Float64Array(n); for (let i = 0; i < n; i++) key[i] = o.pri ? o.pri(acts[i], LF[i] - d[i]) : LF[i] - d[i];
  // SSGS
  const S = new Int32Array(n).fill(-1), E = new Int32Array(n), by = new Int32Array(n).fill(-1), byWhy = new Array(n);
  // 资源占用 = 逐日剖面（整数日 → 每类资源一条 Int32 数组，按需加长）；查窗口 [t, t+d) 遇满即跳到满日的下一天
  let H = Math.max(64, T * 2 + 64); const use = {}; for (const r in caps) use[r] = new Int32Array(H);
  const grow = need => { if (need <= H) return; let h = H; while (h < need) h *= 2; for (const r in use) { const x = new Int32Array(h); x.set(use[r]); use[r] = x; } H = h; };
  const excl = o.excl || [], exPlaced = [];                           // 有净空类的已排活动
  const exPair = (c1, c2) => { for (const x of excl) if ((x[0] === c1 && x[1] === c2) || (x[0] === c2 && x[1] === c1)) return x[2] || 0; return -1; };
  const left = new Int32Array(n); for (let i = 0; i < n; i++) left[i] = acts[i].pred.length;
  const elig = []; for (let i = 0; i < n; i++) if (!left[i]) elig.push(i);
  const usesOf = acts.map(a => { const u = []; for (const r in a.res) if (caps[r] != null && a.res[r]) u.push([r, a.res[r], caps[r]]); return u; });
  let placed = 0;
  while (elig.length) {
    let bi = 0; for (let k = 1; k < elig.length; k++) { const a = elig[k], b = elig[bi]; if (key[a] < key[b] - 1e-9 || (Math.abs(key[a] - key[b]) <= 1e-9 && a < b)) bi = k; }
    const i = elig.splice(bi, 1)[0], a = acts[i], di = d[i], U = usesOf[i];
    let es = REL(a), bp = -1, bw = 'release';
    for (const e of a.pred) { const v = E[e.a.ix] + LG(e, a); if (v > es || (v === es && bp < 0)) { es = v; bp = e.a.ix; bw = e.why; } }
    let t = es;
    if (di > 0) for (let guard = 0; guard < 100000; guard++) {
      grow(t + di + 1); let moved = false;
      for (const [r, q, cap] of U) { const P = use[r]; for (let x = t; x < t + di; x++) if (P[x] + q > cap) { t = x + 1; moved = true; break; } if (moved) break; }
      if (moved) continue;
      if (a.excl) { let next = -1; for (const j of exPlaced) { const m = exPair(a.excl, acts[j].excl); if (m < 0) continue; if (S[j] < t + di && E[j] > t && BB.hitXZ(a.env, acts[j].env, m)) { if (next < 0 || E[j] < next) next = E[j]; } } if (next >= 0) { t = next; continue; } }
      break;
    }
    S[i] = t; E[i] = t + di;
    if (t > es) {                                                     // 被资源 / 净空推迟：记“恰在 t 完成、与本活动争同一资源或净空”的那个活动
      let blk = -1; for (let j = 0; j < n && blk < 0; j++) if (S[j] >= 0 && j !== i && E[j] === t && (usesOf[j].some(x => a.res[x[0]]) || (a.excl && acts[j].excl && exPair(a.excl, acts[j].excl) >= 0))) blk = j;
      by[i] = blk >= 0 ? blk : bp; byWhy[i] = blk >= 0 ? 'res' : bw;
    } else { by[i] = bp; byWhy[i] = bw; }
    if (di > 0) for (const [r, q] of U) { const P = use[r]; for (let x = t; x < t + di; x++) P[x] += q; }
    if (a.excl) exPlaced.push(i);
    placed++;
    for (const j of succ[i]) if (--left[j] === 0) elig.push(j);
  }
  let total = 0, last = -1; for (let i = 0; i < n; i++) if (E[i] > total || (E[i] === total && o.endKey && acts[i].key === o.endKey)) { total = E[i]; last = i; }
  // 关键路径（资源约束下的关键链）：从最晚完成的活动沿“决定其开工的那个约束”（前驱或占资源者）回溯
  const crit = new Uint8Array(n); for (let i = last, g = 0; i >= 0 && g < n; g++) { crit[i] = 1; i = by[i]; }
  const res = { S, E, d, total, crit, by, byWhy, cyclic: 0, ES, LF, n };
  if (o.write) for (let i = 0; i < n; i++) { const a = acts[i]; a.start = S[i]; a.end = E[i]; a.dur = d[i]; a.crit = !!crit[i]; a.by = by[i] >= 0 ? acts[by[i]] : null; a.byWhy = byWhy[i]; }
  return res;
};

// ---------- 时间游标：任一时刻的状态（与着色器同一进度公式 p = clamp((t-start)/dur)）----------
SEQ.at = function (acts, t) {
  const r = { t, cost: 0, tally: {}, use: {}, active: [], done: 0, live: [] };
  for (const a of acts) {
    const p = a.dur > 0 ? Math.max(0, Math.min(1, (t - a.start) / a.dur)) : (t >= a.start ? 1 : 0);
    if (p >= 1) r.done++;
    if (t >= a.start && t < a.end) { r.active.push(a); for (const k in a.res) r.use[k] = (r.use[k] || 0) + a.res[k]; }
    if (p <= 0) continue;
    r.cost += a.cost * p;
    const sg = a.kind === 'untemp' ? -1 : 1;
    for (const k in a.tally) r.tally[k] = (r.tally[k] || 0) + sg * Math.floor(a.tally[k] * p + 1e-9);   // 计数取整：没做完的那一件不算
    if (a.kind === 'milestone' && p >= 1) r.live.push(a);
  }
  return r;
};
// 一个“像 SEQ.plan 的”对象，供 SEQ.compile / SEQ.clearance 复用（steps = 活动；at 交给领域层包一层）
SEQ.asPlan = function (acts, at) { return { steps: acts, at: at || (t => SEQ.at(acts, t)), total: Math.max(0, ...acts.map(a => a.end)) }; };

// ---------- 审计（按排出的时间表核对，与规则推导互相独立）----------
SEQ.auditNet = function (acts, o) {
  o = o || {}; const caps = o.caps || {}, A = { unsupported: 0, cyclic: o.cyclic || 0, prec: 0, precWhy: {}, r4: { temps: 0, pairs: 0, violations: 0, leftover: 0 }, r5: { over: 0, peak: {} }, r6: { late: 0, n: 0 }, cure: { n: 0, short: 0 }, r7: { n: 0, conflicts: 0 }, excl: { n: 0, conflicts: 0 }, ex: [] };
  const total = Math.max(0, ...acts.map(a => a.end));
  for (const a of acts) {
    if (a.need === 'sup' && !a.pred.some(e => e.why === 'R1')) { A.unsupported++; if (A.ex.length < 8) A.ex.push('无支承 ' + a.name); }
    for (const e of a.pred) if (a.start < e.a.end + e.lag) { A.prec++; A.precWhy[e.why] = (A.precWhy[e.why] || 0) + 1; if (A.ex.length < 8) A.ex.push(e.why + ' ' + a.name + ' 早于 ' + e.a.name); }
    if (a.kind === 'temp') { A.r4.temps++; for (const D of a.serves || []) { A.r4.pairs++; if (a.end > D.start || a.rm.start < D.end) A.r4.violations++; } if (!(a.rm && a.rm.end <= total)) A.r4.leftover++; }
    if (a.proc) { A.r6.n++; if (a.start < a.proc.end) A.r6.late++; }
  }
  // R5：逐资源扫描事件，峰值 ≤ 上限
  for (const r in caps) { const ev = []; for (const a of acts) if (a.res[r] && a.dur > 0) { ev.push([a.start, a.res[r]]); ev.push([a.end, -a.res[r]]); }
    ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]); let u = 0, pk = 0; for (const [, q] of ev) { u += q; if (u > pk) pk = u; } A.r5.peak[r] = pk; if (pk > caps[r]) { A.r5.over += pk - caps[r]; A.ex.push('R5 ' + r + ' 峰值 ' + pk + ' > ' + caps[r]); } }
  // 养护满期
  for (const [F, B, L] of o.cure || []) { A.cure.n++; if (B.start < F.end + L) A.cure.short++; }
  // R7：后期活动包络 × 前期单元运营区（投产后）不得时间重叠 —— 独立重算相交，不读规则生成的依赖
  if (o.phase) { const r = o.phase; for (const u of r.units(acts)) { const z = r.zone(u), op = r.live(u, acts); if (!op) continue;
    for (const a of acts) if (a.env && a.phase > u.phase && a !== op && a.kind !== 'procure' && a.kind !== 'milestone' && BB.hitXZ(a.env, z, r.margin || 0)) { A.r7.n++; if (a.end > op.end) { A.r7.conflicts++; if (A.ex.length < 8) A.ex.push('R7 ' + a.name + ' 占用 ' + u.name + ' 运营区'); } } } }
  // 净空互斥：同时在场且包络（外扩净距）相交的互斥类
  for (const x of o.excl || []) { const L1 = acts.filter(a => a.excl === x[0]), L2 = x[0] === x[1] ? L1 : acts.filter(a => a.excl === x[1]);
    for (const a of L1) for (const b of L2) { if (a === b || (x[0] === x[1] && a.ix > b.ix)) continue; if (!BB.hitXZ(a.env, b.env, x[2] || 0)) continue; A.excl.n++; if (a.start < b.end && b.start < a.end) { A.excl.conflicts++; if (A.ex.length < 8) A.ex.push('净空 ' + a.name + ' × ' + b.name); } } }
  A.zero = !A.unsupported && !A.cyclic && !A.prec && !A.r4.violations && !A.r4.leftover && !A.r5.over && !A.r6.late && !A.cure.short && !A.r7.conflicts && !A.excl.conflicts;
  return A;
};

// ---------- 不确定性：可复现随机数 + 三角分布 + 分位数 + 蒙特卡洛 ----------
SEQ.rng = function (seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
SEQ.tri = function (u, a, m, b) { if (b <= a) return m; const f = (m - a) / (b - a); return u < f ? a + Math.sqrt(u * (b - a) * (m - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - m)); };
SEQ.q = function (arr, p) { const s = Array.from(arr).sort((x, y) => x - y); if (!s.length) return NaN; return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]; };   // 最近秩分位数：结果一定是某一次实际排程的值
// 蒙特卡洛：run(rng, k) → {指标: 数}；分片 (from, to) 便于多机并行，同一 seed 的第 k 次在任何机器上相同
SEQ.mc = function (N, seed, run, from, to) {
  const out = {}; from = from || 0; to = to == null ? N : to;
  for (let k = from; k < to; k++) { const m = run(SEQ.rng((seed * 9973 + k * 7919) >>> 0), k); for (const x in m) (out[x] = out[x] || []).push(m[x]); }
  return out;
};
SEQ.mcSummary = function (s, ps) { const r = {}; for (const k in s) { r[k] = { n: s[k].length }; for (const p of ps || [0.1, 0.5, 0.9]) r[k]['p' + Math.round(p * 100)] = SEQ.q(s[k], p); } return r; };
// 方案对比：defs = [{k, name, unit, fmt?, better:'low'|'high'}] → 行 {a, b, d = b − a}
SEQ.diff = function (A, B, defs) { return defs.map(x => ({ k: x.k, name: x.name, unit: x.unit, better: x.better, a: A[x.k], b: B[x.k], d: (B[x.k] != null && A[x.k] != null) ? B[x.k] - A[x.k] : null })); };
// 情景重排：把 key 的工期加 dDays（或改写 mod(a)）后重排，返回新排程（不写回）
SEQ.whatIf = function (acts, o, keys, dDays) { const set = new Set(keys); const base = o.dur || (a => a.dur); return SEQ.schedule(acts, Object.assign({}, o, { write: false, dur: a => base(a) + (set.has(a.key) ? dDays : 0) })); };

G.SEQ = SEQ;
})(typeof window !== 'undefined' ? window : globalThis);
