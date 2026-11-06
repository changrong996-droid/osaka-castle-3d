'use strict';
// ===== SEQ：通用“构件图 + 时间游标”核心（proto-build1） =====
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
  box(x0, y0, z0, x1, y1, z1, col, edges) { this.hexa([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], col, edges); }
  // 绕竖轴旋转的盒子（中心 cx,cz，底 y0，尺寸 sx×sy×sz，角 a）
  rbox(cx, y0, cz, sx, sy, sz, a, col, edges) {
    const c = Math.cos(a), s = Math.sin(a), P = (u, y, v) => [cx + u * c - v * s, y, cz + u * s + v * c], hx = sx / 2, hz = sz / 2;
    this.hexa([P(-hx, y0, -hz), P(hx, y0, -hz), P(hx, y0, hz), P(-hx, y0, hz), P(-hx, y0 + sy, -hz), P(hx, y0 + sy, -hz), P(hx, y0 + sy, hz), P(-hx, y0 + sy, hz)], col, edges);
  }
}
SEQ.Geo = Geo;

// ---------- 规则 → 依赖 → 顺序 → 工期 ----------
function bbOverlapXZ(a, b) { const dx = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]), dz = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]); return dx > 0 && dz > 0 ? dx * dz : 0; }
function bbIntersect(a, b, e) { for (let k = 0; k < 3; k++) if (a.max[k] < b.min[k] - e || b.max[k] < a.min[k] - e) return false; return true; }

// parts: [{id, name, stage, group?, trade?, mat, geo, kind?('build'|'remove'|'fill'), count?, tally?, unit?, spec?, vol?, noMass?}]
// rules: {stages:[{key,name,verb,trade,order:'z'|'-z',after:[keys],near}], mats:{key:{name,rho}}, rates:{trade:t/day}, digRate, fillRate(m3/day), minDays, tol, minOverlap, t0(Date)}
SEQ.plan = function (parts, rules) {
  const T0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const SR = {}; rules.stages.forEach((s, i) => { SR[s.key] = Object.assign({ rank: i, order: 'z' }, s); });
  const tol = rules.tol == null ? 0.06 : rules.tol, minOv = rules.minOverlap == null ? 0.02 : rules.minOverlap;
  for (const p of parts) {
    const m = rules.mats[p.mat]; if (!m) throw new Error('no material ' + p.mat);
    if (!SR[p.stage]) throw new Error('no stage ' + p.stage);
    p.kind = p.kind || 'build';
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
  steps.forEach((s, i) => { s.idx0 = i; s.rank = SR[s.stage].rank; s.anchor = s.parts[0].anchor; const t = {}; for (const p of s.parts) if (p.tally) { t[p.tally] = (t[p.tally] || 0) + (p.count || 0); } s.tally = t; });
  // 规则 R1 支承：B 的底面落在 A 的高度范围内且平面投影重叠 → A 先于 B（A 的阶段不晚于 B）
  // 规则 R2 先挖后建：移除类（掘削）先于与其包围盒相交的一切建造
  // 规则 R3 阶段 after：stage.after 里列出的阶段、在 near 米内的步骤都要先完成（如注水在石垣之后）
  let nSup = 0, nDig = 0, nAfter = 0;
  for (const B of steps) for (const A of steps) {
    if (A === B) continue;
    if (A.kind === 'remove') { if (B.kind !== 'remove' && bbIntersect(A.bb, B.bb, 0.01) && A.rank <= B.rank) { B.deps.add(A); B.why[A.key] = 'dig'; nDig++; } continue; }
    if (B.kind === 'remove') continue;
    const af = SR[B.stage].after;
    if (af && af.includes(A.stage) && bbIntersect(A.bb, B.bb, SR[B.stage].near || 10)) { B.deps.add(A); B.why[A.key] = 'after'; nAfter++; continue; }
    if (A.kind === 'fill' || B.rank === 0) continue;
    const on = SR[B.stage].on;                      // 阶段可声明“落在哪些阶段上”（如 上层柱 落在 下层梁 上，梁的阶段序更晚也成立）
    if (on) { if (!on.includes(A.stage) && A.stage !== B.stage) continue; }
    else if (A.rank > B.rank) continue;
    if (A.stage === B.stage || !on) { if (A.rank === B.rank && !(A.bb.min[1] < B.bb.min[1] - 1e-4)) continue; }
    if (bbOverlapXZ(A.bb, B.bb) > minOv && A.bb.min[1] <= B.bb.min[1] + tol && A.bb.max[1] >= B.bb.min[1] - tol) { B.deps.add(A); B.why[A.key] = 'sup'; nSup++; }
  }
  // 审计：每个非地基步骤至少有一个支承（或挖方/after）前驱；依赖不成环
  const unsupported = steps.filter(s => s.rank > 0 && s.kind !== 'remove' && ![...s.deps].some(d => s.why[d.key] === 'sup' || s.why[d.key] === 'after'));
  // 带优先级的 Kahn 拓扑排序：可开工的步骤里取（阶段序, 阶段内顺序, 原序）最小者
  const ordV = s => { const o = SR[s.stage].order; return o === '-z' ? -s.bb.max[1] : s.bb.min[1]; };
  const indeg = new Map(steps.map(s => [s, s.deps.size])), out = new Map(steps.map(s => [s, []]));
  for (const s of steps) for (const d of s.deps) out.get(d).push(s);
  const ready = steps.filter(s => indeg.get(s) === 0), seq = [];
  const better = (a, b) => a.rank !== b.rank ? a.rank < b.rank : Math.abs(ordV(a) - ordV(b)) > 1e-6 ? ordV(a) < ordV(b) : a.idx0 < b.idx0;
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
    else d = s.mass / ((rules.rates && rules.rates[s.trade]) || 10);
    s.dur = Math.max(rules.minDays || 1, d); s.start = t; s.end = t + s.dur; t = s.end + (rules.gap || 0);
  });
  const total = seq.length ? seq[seq.length - 1].end : 0;
  // 阶段带
  const bands = rules.stages.map(st => { const ss = seq.filter(s => s.stage === st.key); return ss.length ? { key: st.key, name: st.name, a: Math.min(...ss.map(s => s.start)), b: Math.max(...ss.map(s => s.end)), steps: ss } : null; }).filter(Boolean);
  // 事件流（开工 / 完成）
  const events = [];
  for (const s of seq) { events.push({ t: s.start, ev: 'start', s }); events.push({ t: s.end, ev: 'end', s }); }
  events.sort((a, b) => a.t - b.t || (a.ev === 'end' ? -1 : 1));
  const plan = { parts, steps: seq, stages: SR, bands, events, total, rules, audit: { unsupported, cyclic, deps: nSup + nDig + nAfter, nSup, nDig, nAfter }, ms: 0 };
  // 时间游标 → 状态与统计（与着色器同一公式：p = clamp((t-start)/dur)）
  plan.at = function (tt) {
    const r = { t: tt, cur: null, p: 0, mass: 0, removed: 0, tally: {}, elev: null, done: 0, stage: null };
    for (const s of seq) {
      const p = Math.max(0, Math.min(1, (tt - s.start) / s.dur));
      if (tt >= s.start && tt < s.end) { r.cur = s; r.p = p; }
      if (p >= 1) r.done++;
      if (p <= 0) continue;
      if (s.kind === 'remove') { r.removed += s.vol * p; continue; }
      r.mass += s.mass * p;
      for (const k in s.tally) r.tally[k] = (r.tally[k] || 0) + Math.floor(s.tally[k] * p + 1e-9);   // 计数取整：未完成的一块不算
      if (s.kind === 'build') { const e = s.bb.min[1] + (s.bb.max[1] - s.bb.min[1]) * p; if (r.elev === null || e > r.elev) r.elev = e; }
    }
    if (!r.cur) { const last = seq.filter(s => s.end <= tt).pop(); r.stage = last ? last.stage : seq[0] && seq[0].stage; } else r.stage = r.cur.stage;
    r.pct = total ? Math.min(1, tt / total) : 0;
    return r;
  };
  plan.date = d => { const D = new Date((rules.t0 || new Date(2000, 0, 1)).getTime() + Math.round(d) * 864e5); return D.getFullYear() + '-' + String(D.getMonth() + 1).padStart(2, '0') + '-' + String(D.getDate()).padStart(2, '0'); };
  plan.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - T0;
  return plan;
};

// ---------- 渲染：合并几何 + 时间游标着色器 ----------
const VS = `
attribute vec3 aCol; attribute vec3 aK; attribute vec2 aB;
uniform float uT; uniform vec2 uCur; uniform float uRise;
varying vec3 vN; varying vec3 vC; varying vec3 vW; varying float vS; varying float vCur; varying float vKind; varying float vP; varying vec2 vB;
void main(){
  float p = clamp((uT - aK.x) / max(aK.y, 1e-4), 0., 1.);
  vec3 pos = position; float st;
  if (aK.z < .5) { st = uT < aK.x ? -1. : (p < 1. ? p : 2.); if (st >= 0. && st < 1.) pos.y -= (1. - st) * (1. - st) * uRise; }
  else if (aK.z < 1.5) { st = uT < aK.x ? 2. : (p < 1. ? p : -3.); }   // 移除：开工前是“原状”，完成后消失
  else { st = uT < aK.x ? -1. : (p < 1. ? p : 2.); }                   // 充填：自下而上
  vS = st; vP = p; vKind = aK.z; vB = aB;
  vCur = (aK.x >= uCur.x - 1e-3 && aK.x < uCur.y) ? 1. : 0.;
  vec4 w = modelMatrix * vec4(pos, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vC = aCol;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FS = `
uniform float uMode; uniform float uGhost; uniform float uPass; uniform vec4 uCut; uniform float uCutOn;
uniform vec3 uSun; uniform vec3 uPaper; uniform vec3 uRed; uniform vec3 uInk;
varying vec3 vN; varying vec3 vC; varying vec3 vW; varying float vS; varying float vCur; varying float vKind; varying float vP; varying vec2 vB;
void main(){
  if (uCutOn > .5 && dot(vW, uCut.xyz) > uCut.w) discard;
  bool future = vS < -0.5 && vS > -1.5;
  if (uPass > .5) {                                   // 幽灵趟：只画未建
    if (!future || uGhost < .5) discard;
    gl_FragColor = vec4(uRed, vCur > .5 ? 0.15 : 0.03); return;
  }
  if (vS < 0.) discard;
  bool cur = vS < 1.;
  if (cur && vKind > .5 && vKind < 1.5 && vW.y > mix(vB.y, vB.x, vP)) discard;  // 掘削：从上往下挖
  if (cur && vKind > 1.5 && vW.y > mix(vB.x, vB.y, vP)) discard;                // 充填：从下往上
  vec3 col;
  if (!gl_FrontFacing) {                               // 背面 = 剖切面 / 挖方断面：红色剖面线
    float h = step(0.72, fract((gl_FragCoord.x + gl_FragCoord.y) / 6.));
    col = mix(mix(uPaper, uRed, 0.16), mix(uPaper, uRed, 0.7), h);
    gl_FragColor = vec4(col, 1.); return;
  }
  vec3 n = normalize(vN); float l = max(dot(n, uSun), 0.); float hemi = 0.5 + 0.5 * n.y;
  if (uMode > .5) {                                    // 墨线 + 淡彩
    vec3 base = mix(uPaper, vC, 0.42);
    float f = l > 0.55 ? 1.0 : (l > 0.18 ? 0.9 : 0.8);
    if (n.y > 0.75) f = 1.04;
    col = base * f;
    if (l < 0.18 && n.y < 0.5) col *= 1. - 0.08 * step(0.8, fract((gl_FragCoord.x - gl_FragCoord.y) / 4.));
  } else {
    col = vC * (0.28 + 0.32 * hemi + 0.78 * l);
    col = mix(col, uPaper, 0.06);
  }
  if (cur) col = mix(col, uRed, 0.62 + 0.2 * (1. - vS));
  gl_FragColor = vec4(col, 1.);
}`;
const LVS = `
attribute vec3 aK; attribute vec2 aB;
uniform float uT; uniform vec2 uCur; uniform float uRise;
varying float vS; varying float vCur; varying vec3 vW; varying float vKind; varying float vP; varying vec2 vB;
void main(){
  float p = clamp((uT - aK.x) / max(aK.y, 1e-4), 0., 1.);
  vec3 pos = position; float st;
  if (aK.z < .5) { st = uT < aK.x ? -1. : (p < 1. ? p : 2.); if (st >= 0. && st < 1.) pos.y -= (1. - st) * (1. - st) * uRise; }
  else if (aK.z < 1.5) { st = uT < aK.x ? 2. : (p < 1. ? p : -3.); }
  else { st = uT < aK.x ? -1. : (p < 1. ? p : 2.); }
  vS = st; vP = p; vKind = aK.z; vB = aB; vCur = (aK.x >= uCur.x - 1e-3 && aK.x < uCur.y) ? 1. : 0.;
  vec4 w = modelMatrix * vec4(pos, 1.); vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const LFS = `
uniform float uMode; uniform float uGhost; uniform vec4 uCut; uniform float uCutOn; uniform vec3 uRed; uniform vec3 uInk; uniform float uLA;
varying float vS; varying float vCur; varying vec3 vW; varying float vKind; varying float vP; varying vec2 vB;
void main(){
  if (uCutOn > .5 && dot(vW, uCut.xyz) > uCut.w) discard;
  if (vS < -1.5) discard;
  if (vS < 0.) { if (uGhost < .5) discard; gl_FragColor = vec4(uRed, (vCur > .5 ? 0.7 : 0.085) * uLA); return; }
  if (vS < 1.) {
    if (vKind > .5 && vKind < 1.5 && vW.y > mix(vB.y, vB.x, vP)) discard;
    if (vKind > 1.5 && vW.y > mix(vB.x, vB.y, vP)) discard;
    gl_FragColor = vec4(uRed, 1.); return;
  }
  gl_FragColor = uMode > .5 ? vec4(uInk, 0.8 * uLA) : vec4(uInk, 0.2 * uLA);
}`;

// 把 plan 的全部构件并成：solid（不透明，1 次）+ ghost（同一几何，透明，1 次）+ lines（1 次）
SEQ.compile = function (THREE, plan, opt) {
  opt = opt || {};
  let nv = 0, nl = 0;
  for (const s of plan.steps) for (const p of s.parts) { nv += p.geo.P.length / 3; nl += p.geo.L.length / 3; }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), C = new Float32Array(nv * 3), K = new Float32Array(nv * 3), B = new Float32Array(nv * 2);
  const LP = new Float32Array(nl * 3), LK = new Float32Array(nl * 3), LB = new Float32Array(nl * 2);
  let iv = 0, il = 0;
  const KIND = { build: 0, remove: 1, fill: 2 };
  for (const s of plan.steps) for (const p of s.parts) {
    const g = p.geo, sm = g.subMax, wf = sm > 0 ? (opt.subWindow || 0.22) : 1, kd = KIND[p.kind];
    const key = sub => { const a = s.start + (sm > 0 ? sub / sm : 0) * s.dur * (1 - wf); return [a, s.dur * wf]; };
    for (let i = 0; i < g.P.length / 3; i++, iv++) {
      P.set(g.P.slice(i * 3, i * 3 + 3), iv * 3); N.set(g.N.slice(i * 3, i * 3 + 3), iv * 3); C.set(g.C.slice(i * 3, i * 3 + 3), iv * 3);
      const k = key(g.S[i]); K[iv * 3] = k[0]; K[iv * 3 + 1] = k[1]; K[iv * 3 + 2] = kd; B[iv * 2] = p.bb.min[1]; B[iv * 2 + 1] = p.bb.max[1];
    }
    for (let i = 0; i < g.L.length / 3; i++, il++) {
      LP[il * 3] = g.L[i * 3]; LP[il * 3 + 1] = g.L[i * 3 + 1]; LP[il * 3 + 2] = g.L[i * 3 + 2];
      const k = key(g.LS[i]); LK[il * 3] = k[0]; LK[il * 3 + 1] = k[1]; LK[il * 3 + 2] = kd; LB[il * 2] = p.bb.min[1]; LB[il * 2 + 1] = p.bb.max[1];
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  geo.setAttribute('aCol', new THREE.BufferAttribute(C, 3)); geo.setAttribute('aK', new THREE.BufferAttribute(K, 3)); geo.setAttribute('aB', new THREE.BufferAttribute(B, 2));
  geo.computeBoundingSphere();
  const lgeo = new THREE.BufferGeometry();
  lgeo.setAttribute('position', new THREE.BufferAttribute(LP, 3)); lgeo.setAttribute('aK', new THREE.BufferAttribute(LK, 3)); lgeo.setAttribute('aB', new THREE.BufferAttribute(LB, 2));
  lgeo.computeBoundingSphere();
  const U = {
    uT: { value: 0 }, uCur: { value: new THREE.Vector2(-1, -1) }, uRise: { value: opt.rise == null ? 1.6 : opt.rise },
    uMode: { value: 1 }, uLA: { value: 1 }, uGhost: { value: 1 }, uCut: { value: new THREE.Vector4(0, 0, 1, 1e9) }, uCutOn: { value: 0 },
    uSun: { value: new THREE.Vector3(-0.45, 0.78, 0.43).normalize() }, uPaper: { value: new THREE.Color(opt.paper || 0xefe9dd) }, uRed: { value: new THREE.Color(opt.red || 0xb3202a) }, uInk: { value: new THREE.Color(opt.ink || 0x1d1a17) },
  };
  const mk = (pass, extra) => new THREE.ShaderMaterial(Object.assign({ uniforms: Object.assign({}, U, { uPass: { value: pass } }), vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide }, extra));
  const solid = new THREE.Mesh(geo, mk(0, { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  const ghost = new THREE.Mesh(geo, mk(1, { transparent: true, depthWrite: false }));
  const lines = new THREE.LineSegments(lgeo, new THREE.ShaderMaterial({ uniforms: U, vertexShader: LVS, fragmentShader: LFS, transparent: true, depthWrite: false }));
  solid.renderOrder = 0; lines.renderOrder = 1; ghost.renderOrder = 2;
  solid.frustumCulled = ghost.frustumCulled = lines.frustumCulled = false;
  const group = new THREE.Group(); group.add(solid, lines, ghost);
  return { group, solid, ghost, lines, U, tris: nv / 3, segs: nl / 2,
    set(t) { U.uT.value = t; const r = plan.at(t); if (r.cur) U.uCur.value.set(r.cur.start, r.cur.end); else U.uCur.value.set(-1, -1); return r; } };
};

G.SEQ = SEQ;
})(typeof window !== 'undefined' ? window : globalThis);
