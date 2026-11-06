'use strict';
// ===== 杭州西站 建造顺序（hzwest-preview1）：构件几何 + 规则参数 → web/core/seq.js 推依赖 / 排程 → 独立审计 =====
// 坐标：x = 东西（顺轨，+x 东），y = 高（m），z = 南北（垂轨，+z 南）。原点 = 站房中心、地面 ±0。
// 公开事实（见 FACTS）之外的尺寸、工期、柱网、分区边界都是按规则推出来的「推算」值，列在 ASSUME 里。
(function (G) {
const SEQ = G.SEQ;
const HZ = {};

// ---------------- 公开事实（来源见 SOURCES） ----------------
HZ.FACTS = [
  ['站场规模', '11 台 20 线，全高架站场'],
  ['两场拉开', '湖杭场（南）与杭临绩场（北）拉开 28 m，形成东西向「云谷」（宽 28 m、长 ~500 m），自然光直达地铁层（-9.2 m）'],
  ['层数', '9 层：地下 4 + 地上 5（1F ±0 出站/交通，2F 6 m 快速进出站，3F 14.5 m 站台，4F 24 m 高架候车「云厅」，5F 31 m 旅服 / 空中连廊）'],
  ['云厅', '南北 300 m × 东西 190 m，无柱跨度 78 m'],
  ['屋盖', '326 m × 245 m，钢结构 ~1.3 万 t，网架 + 采光顶十字桁架；屋盖结构标高 37.07–55.24 m，金属屋面最高 60.75 m'],
  ['采光顶 / 光伏', '十字形拱形天窗 1.25 万 m²；屋面光伏 ~1.5 万 m²'],
  ['屋盖施工', '候车层楼面拼装 → 分南 / 中 / 北三区液压旋转提升（3 次；网架绕轴转 4°，最高点运动 ~8 m）→ 嵌补合龙 → 整体提升到位；206 台液压提升器'],
  ['柱', '梭形钢管柱（D1700~1800~1300，两头细中间粗）'],
  ['柱网（屋盖）', '顺轨：中跨 78 m、典型 19 / 38 m；垂轨：中跨 72 m、典型 22 / 23.5 m'],
  ['上盖开发', '雨棚上盖综合开发（四角），~5 万 m²'],
  ['云门', '站房南侧 15 m，长 180 m、宽 60 m、高 80 m'],
  ['节点', '2019-09-17 开工；2020-09-16 转入地上结构；2021-02 承轨层完成；2021-04 混凝土主体封顶；2021-06-28 屋盖整体提升完成；2021-08-31 金属屋面闭水；2021-12 云门主楼封顶；2022-09-22 开通'],
];
HZ.SOURCES = [
  ['人民网 2022-09-23（屋盖 326×245、1.3 万 t、分区旋转 + 整体提升、云谷）', 'http://finance.people.com.cn/n1/2022/0923/c1004-32532749.html'],
  ['杭州网 2022-09-16（云谷 28×500、云厅 300×190、天窗 1.25 万 m²、最高 60.8 m）', 'https://hznews.hangzhou.com.cn/chengshi/content/2022-09/16/content_8354625.htm'],
  ['杭州网 2022-03-10', 'https://hznews.hangzhou.com.cn/chengshi/content/2022-03/10/content_8194395_2.htm'],
  ['参考网《杭州西站站房钢结构屋盖施工技术》（标高 37.07–55.24、楼面拼装 + 分区旋转 + 合龙整体提升）', 'https://www.fx361.com/page/2022/0428/14548749.shtml'],
  ['《钢结构（中英文）》2024-4 单轴旋转法（提升 600 mm 脱胎、绕轴转 4°、竖向调整 0.7–8 m）', 'https://www.sciengine.com/gjg/doi/10.13206/j.gjgS22121901'],
  ['土木在线（柱网、梭形柱规格、下弦高差 13.3 m）', 'https://bbs.co188.com/thread-10196478-1-1.html'],
  ['央广网 2021-06-30（206 台提升器、承轨层胎架、6-28 提升完成）', 'http://news.cnr.cn/native/city/20210630/t20210630_525524643.shtml'],
  ['杭州政协网 2022-08-17（站房抬高 14.5 m、6 m 夹层）', 'https://www.hzzx.gov.cn/cshz/content/2022-08/17/content_8331438.htm'],
  ['杭州市政府网 2022-09-20（云门 180×60×80）', 'https://www.hangzhou.gov.cn/art/2022/9/20/art_812269_59065630.html'],
];
HZ.ASSUME = [
  ['站台 / 股道排布', '南场 5 岛 + 1 侧台、11 线；北场 4 岛 + 1 侧台、9 线；岛台宽 11 m、线间 5 m（推算，只保证 11 台 20 线）'],
  ['屋盖平面', '超椭圆（n = 4）+ 轻微波形边；结构顶面 37 + 18.2·(1−u²)(1−v²) m（推算，过两端实测标高）'],
  ['网架', '正放四角锥，网格 7 m，厚 3.5 m（采光顶十字带 4.5 m、宽 22 m）（推算）'],
  ['屋盖柱网', '顺轨 ±39 / ±77 / ±115 m（中跨 78、典型 38）；垂轨取站台中心 ±46.5 / ±112.5 m（推算：柱必须落在站台上）'],
  ['分区', '中区 |z| ≤ 38.5 m；南 / 北区之外各留 1 排嵌补；柱 / 提升塔处留 ±3.3 m 孔，后补（推算）'],
  ['整体提升高度', '由规则算出：拼装姿态最低下弦点离候车层楼面 ≥ 1.2 m（胎架）→ 整体提升 D'],
  ['工期', '工程量 ÷ 工种效率，按公开节点校准（推算）；地下结构用 365 日（2020-09-16 转入地上结构）'],
  ['钢结构吨位', '屋盖 + 梭形柱按杆件长度分摊 1.3 万 t（推算）'],
  ['省略', '地下 4 层只画顶板与地铁层、6 m 夹层只画板、落客高架 / 匝道、站台雨棚细部、幕墙细部、机电'],
];

// ---------------- 尺寸参数 ----------------
const P = HZ.P = {
  gap: 14,                   // 云谷半宽（28 m）
  deckBot: 10.5, deckTop: 12.5, platTop: 14.5, floorBot: 22.8, floorTop: 24, ringY: 30.4,
  stX: 225, apX: 650,        // 站内承轨层 ±225；引桥到 ±650
  roofA: 122.5, roofB: 163, roofLo: 37.0, roofHi: 55.2, cell: 7, depth: 3.5, depthSky: 4.5, skyW: 11,
  mastX: [-115, -77, -39, 39, 77, 115], mastZ: [-112.5, -46.5, 46.5, 112.5],
  towerX: [-77, -39, 39, 77], towerZ: [-24.5, 24.5],
  midZ: 38.5, hole: 3.3, alpha: 4 * Math.PI / 180, jigMin: 1.2,
  floorX: 95, floorZ: 150, voidX: 95,
  T0: Date.UTC(2019, 8, 17), OPEN: 1101,
};
HZ.dayDate = d => { const t = new Date(P.T0 + Math.round(d) * 864e5); return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0'); };

// 站台 / 股道（南为正）
const SOUTH = { islands: [24.5, 46.5, 68.5, 90.5, 112.5], side: 133.5, sideW: 9, sideTrack: 126.5, z0: 14, z1: 138 };
const NORTH = { islands: [-24.5, -46.5, -68.5, -90.5], side: -112.5, sideW: 9, sideTrack: -105.5, z0: -117, z1: -14 };
HZ.YARDS = { S: SOUTH, N: NORTH };
function platforms(Y) { return Y.islands.map(z => ({ z, w: 11 })).concat([{ z: Y.side, w: Y.sideW }]); }
function tracks(Y) { const t = []; for (const z of Y.islands) t.push(z - 8, z + 8); t.push(Y.sideTrack); return t.sort((a, b) => a - b); }
HZ.platforms = platforms; HZ.tracks = tracks;

// ---------------- 屋盖曲面 ----------------
const R = th => { const c = Math.abs(Math.cos(th)) / P.roofA, s = Math.abs(Math.sin(th)) / P.roofB, n = 4; return Math.pow(Math.pow(c, n) + Math.pow(s, n), -1 / n) * (1 + 0.022 * Math.sin(8 * th + 0.6) + 0.012 * Math.sin(13 * th)); };
HZ.R = R;
const rho = (x, z) => Math.hypot(x, z) / R(Math.atan2(z, x));
const Ht = (x, z) => { const u = Math.min(1, Math.abs(x) / P.roofA), v = Math.min(1, Math.abs(z) / P.roofB); return P.roofLo + (P.roofHi - P.roofLo) * (1 - u * u) * (1 - v * v); };
const inSky = (x, z) => Math.abs(x) < P.skyW || Math.abs(z) < P.skyW;
const depthAt = (x, z) => inSky(x, z) ? P.depthSky : P.depth;
HZ.Ht = Ht; HZ.rho = rho; HZ.inSky = inSky;
// 覆面（金属屋面）面：结构顶 + 0.5，边缘 15% 向下收 1.8 m（云的软边）
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const Hc = (x, z) => Ht(x, z) + 0.5 - 0.8 * sm(0.85, 1.0, rho(x, z)) + (inSky(x, z) ? 1.6 * (1 - sm(P.skyW - 3, P.skyW, Math.min(Math.abs(x), Math.abs(z)))) : 0);
const Hs = (x, z) => Ht(x, z) - depthAt(x, z) - 0.4 - 0.8 * sm(0.8, 1.0, rho(x, z));   // 边缘加厚：云的厚边   // 吊顶（下表面），边缘向上收
HZ.Hc = Hc; HZ.Hs = Hs;
// 光伏：屋面四个角瓣（与着色器同一公式；面积按覆面网格积分 ≈ 1.5 万 m²）
HZ.PVK = [0.50, 0.87, 0.325];
HZ.pvMask = (x, z) => { const r = rho(x, z), u = Math.abs(x) / P.roofA, v = Math.abs(z) / P.roofB, [r0, r1, c] = HZ.PVK; return sm(r0, r0 + 0.04, r) * (1 - sm(r1 - 0.04, r1, r)) * sm(c, c + 0.04, u) * sm(c, c + 0.04, v); };

// ---------------- 材质（sRGB 颜色、粗糙度、金属度、夜灯发光）----------------
const MAT = HZ.MAT = {
  conc: { c: [0.76, 0.74, 0.70], r: 0.86, m: 0 }, found: { c: [0.50, 0.48, 0.45], r: 0.95, m: 0 }, dark: { c: [0.40, 0.40, 0.41], r: 0.9, m: 0 },
  steel: { c: [0.84, 0.85, 0.86], r: 0.45, m: 0.3 }, clad: { c: [0.94, 0.95, 0.96], r: 0.34, m: 0.5, k: 1 }, soffit: { c: [0.93, 0.92, 0.89], r: 0.7, m: 0.05, e: 0.9 },
  glass: { c: [0.70, 0.80, 0.88], r: 0.06, m: 0.85, e: 1.6, k: 2 }, pv: { c: [0.10, 0.15, 0.28], r: 0.3, m: 0.3 },
  rail: { c: [0.30, 0.29, 0.28], r: 0.45, m: 0.7 }, slab: { c: [0.58, 0.57, 0.55], r: 0.9, m: 0 }, plat: { c: [0.82, 0.80, 0.76], r: 0.8, m: 0, e: 0.25 },
  red: { c: [0.78, 0.14, 0.08], r: 0.5, m: 0.2 }, yellow: { c: [0.96, 0.70, 0.12], r: 0.5, m: 0.2 }, jig: { c: [0.85, 0.55, 0.15], r: 0.6, m: 0.1 },
  todG: { c: [0.33, 0.43, 0.50], r: 0.08, m: 0.85, e: 0.8 }, todB: { c: [0.88, 0.87, 0.84], r: 0.7, m: 0 }, ym: { c: [0.86, 0.84, 0.79], r: 0.55, m: 0.05 }, ymG: { c: [0.30, 0.38, 0.45], r: 0.08, m: 0.85, e: 1.0 },
  metro: { c: [0.62, 0.62, 0.64], r: 0.6, m: 0, e: 0.6 }, train: { c: [0.95, 0.96, 0.97], r: 0.25, m: 0.4 },
};
HZ.MATK = Object.keys(MAT);

// ---------------- 几何包装：SEQ.Geo + 记录原始包围盒（审计用）----------------
class GB extends SEQ.Geo {
  constructor(mat) { super(MAT[mat].c); this.mat = mat; this.boxes = []; }
  _mark(f) { const n0 = this.P.length; f(); const b = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }; for (let i = n0; i < this.P.length; i += 3) for (let k = 0; k < 3; k++) { const v = this.P[i + k]; if (v < b.min[k]) b.min[k] = v; if (v > b.max[k]) b.max[k] = v; } if (this.P.length > n0) this.boxes.push(b); return b; }
  B(x0, y0, z0, x1, y1, z1, col) { return this._mark(() => this.box(x0, y0, z0, x1, y1, z1, col, false)); }
  cyl(x, z, y0, y1, r, n, col) { return this._mark(() => this.prism([x, y0, z], [x, y1, z], r, n || 10, col, false)); }
  // 梭形柱：r(h) 两头细中间粗（D1700~1800~1300）
  spindle(x, z, y0, y1, rb, rm, rt, n) { return this._mark(() => { n = n || 12; const S = 8, ring = (y, r) => { const a = []; for (let i = 0; i < n; i++) { const t = (i + 0.5) / n * Math.PI * 2; a.push([x + Math.cos(t) * r, y, z + Math.sin(t) * r]); } return a; };
    let prev = ring(y0, rb); for (let s = 1; s <= S; s++) { const f = s / S, r = f < 0.42 ? rb + (rm - rb) * Math.sin(f / 0.42 * Math.PI / 2) : rm + (rt - rm) * (1 - Math.cos((f - 0.42) / 0.58 * Math.PI / 2)), cur = ring(y0 + (y1 - y0) * f, r);
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.quad(prev[i], prev[j], cur[j], cur[i]); } prev = cur; } }); }
  // 细杆（三棱柱，无端盖：网架杆件 / 吊具）
  rod(a, b, r) { const ax = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...ax) || 1, u = ax.map(v => v / L), h = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let e1 = [u[1] * h[2] - u[2] * h[1], u[2] * h[0] - u[0] * h[2], u[0] * h[1] - u[1] * h[0]]; const l1 = Math.hypot(...e1); e1 = e1.map(v => v / l1); const e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
    const R3 = [0, 1, 2].map(i => { const t = i / 3 * Math.PI * 2, c = Math.cos(t) * r, s = Math.sin(t) * r; return [e1[0] * c + e2[0] * s, e1[1] * c + e2[1] * s, e1[2] * c + e2[2] * s]; });
    for (let i = 0; i < 3; i++) { const j = (i + 1) % 3, p0 = [a[0] + R3[i][0], a[1] + R3[i][1], a[2] + R3[i][2]], p1 = [a[0] + R3[j][0], a[1] + R3[j][1], a[2] + R3[j][2]], q0 = [b[0] + R3[i][0], b[1] + R3[i][1], b[2] + R3[i][2]], q1 = [b[0] + R3[j][0], b[1] + R3[j][1], b[2] + R3[j][2]];
      // 外向：法线背离轴线
      const cr = SEQ.v.cross(SEQ.v.sub(p1, p0), SEQ.v.sub(q0, p0)), mid = [(p0[0] + p1[0]) / 2 - a[0], (p0[1] + p1[1]) / 2 - a[1], (p0[2] + p1[2]) / 2 - a[2]];
      if (SEQ.v.dot(cr, mid) > 0) this.quad(p0, p1, q1, q0); else this.quad(p0, q0, q1, p1); } }
}
HZ.GB = GB;

// ---------------- 构件 → 活动 ----------------
// part = {geo:GB, grp:0 静止 | 1 南区 | 2 中区 | 3 北区 | 4 嵌补（只随整体提升）, sweep:数（施工推进顺序）, host:[part 名], strands:[[a,b,ga,gb]]}
function part(geo, o) { return Object.assign({ geo, mat: geo.mat, grp: 0, sweep: 0 }, o || {}); }
function build() {
  const acts = [], A = o => { const a = SEQ.act(Object.assign({ res: {}, tally: {} }, o)); acts.push(a); return a; };
  const steelLen = { v: 0 };   // 钢杆件总长（分摊吨位）

  // ===== 1. 地下结构 + 地铁层（云谷下方） =====
  { const parts = [];
    const tiles = [[-230, -122, 230, -P.gap], [-230, P.gap, 230, 143]];
    for (const [x0, z0, x1, z1] of tiles) for (let x = x0; x < x1; x += 46) { const g = new GB('found'); g.B(x, -0.8, z0, Math.min(x1, x + 46), 0, z1); parts.push(part(g, { sweep: x })); }
    const m = new GB('metro'); m.B(-200, -10, -P.gap, 200, -9.2, P.gap); m.B(-200, -9.2, -P.gap, 200, 0, -P.gap + 0.8); m.B(-200, -9.2, P.gap - 0.8, 200, 0, P.gap); parts.push(part(m, { sweep: 0 }));
    A({ key: 'found', name: '桩基与地下结构（4 层，含地铁层）', stage: 'found', dur: 365, parts, res: { civil: 1 }, cap: '桩基与地下结构' }); }

  // ===== 2. 线下框架柱（承轨层下 2.2 m 方柱）+ 引桥墩 =====
  const colX = []; for (let x = -212.5; x <= 212.5 + 1e-6; x += 25) colX.push(x);
  for (const yk of ['S', 'N']) { const Y = HZ.YARDS[yk], parts = [];
    for (const x of colX) for (const pl of platforms(Y)) { const g = new GB('conc'); g.B(x - 1.1, 0, pl.z - 1.1, x + 1.1, P.deckBot, pl.z + 1.1); parts.push(part(g, { sweep: x })); }
    A({ key: 'frame' + yk, name: '线下框架柱 · ' + (yk === 'S' ? '湖杭场' : '杭临绩场'), stage: 'frame', yard: yk, dur: 40, parts, res: { frame: 1 }, cap: '线下框架（承轨层下）' });
    // 6 m 夹层（柱间板，留 1.2 m 柱缝）
    const mz = []; for (let i = 0; i < colX.length - 1; i++) { const g = new GB('conc'); g.B(colX[i] + 1.2, 5.4, Y.z0 + 1, colX[i + 1] - 1.2, 6.0, Y.z1 - 1); mz.push(part(g, { sweep: colX[i], side: true })); }
    A({ key: 'mezz' + yk, name: '6 m 快速进出站夹层 · ' + (yk === 'S' ? '南' : '北'), stage: 'mezz', yard: yk, dur: 30, parts: mz, res: { mezz: 1 }, cap: '6 m 夹层' });
    // 引桥墩（地面起）
    const pp = []; for (const s of [-1, 1]) for (let x = 240; x <= P.apX; x += 35) { const g = new GB('conc'); const xx = s * x; g.B(xx - 2, -1, Y.z0 + 4, xx + 2, 0, Y.z1 - 4); g.B(xx - 1.4, 0, Y.z0 + 6, xx + 1.4, P.deckBot, Y.z1 - 6); pp.push(part(g, { sweep: x })); }
    A({ key: 'pier' + yk, name: '引桥墩 · ' + (yk === 'S' ? '南' : '北'), stage: 'pier', yard: yk, dur: 70, release: 380, parts: pp, res: { bridge: 1 }, cap: '线下框架与引桥' });
  }
  // ===== 3. 承轨层（两场，中间拉开 28 m 云谷） =====
  for (const yk of ['S', 'N']) { const Y = HZ.YARDS[yk], parts = [], ap = [];
    for (let i = 0; i < colX.length - 1; i++) { const x0 = i === 0 ? -P.stX : colX[i], x1 = i === colX.length - 2 ? P.stX : colX[i + 1]; const g = new GB('conc'); g.B(x0, P.deckBot, Y.z0, x1, P.deckTop, Y.z1); parts.push(part(g, { sweep: x0 })); }
    for (const s of [-1, 1]) { let x = P.stX; const piers = []; for (let q = 240; q <= P.apX; q += 35) piers.push(q); piers.push(P.apX + 20);
      for (const q of piers) { const g = new GB('conc'); const a = Math.min(s * x, s * q), b = Math.max(s * x, s * q); g.B(a, P.deckBot, Y.z0 + 2, b, P.deckTop, Y.z1 - 2); ap.push(part(g, { sweep: x })); x = q; } }
    A({ key: 'deck' + yk, name: '承轨层 · ' + (yk === 'S' ? '湖杭场' : '杭临绩场'), stage: 'deck', yard: yk, dur: 45, parts, res: { frame: 1 }, cap: '承轨层：两场拉开 28 m，留出云谷' });
    A({ key: 'deckap' + yk, name: '引桥梁 · ' + (yk === 'S' ? '南' : '北'), stage: 'deck', yard: yk, dur: 60, parts: ap, res: { bridge: 1 }, cap: '承轨层：两场拉开 28 m，留出云谷' });
  }
  // ===== 4. 站台 + 轨道 =====
  for (const yk of ['S', 'N']) { const Y = HZ.YARDS[yk], parts = [];
    for (const pl of platforms(Y)) { const g = new GB('plat'); g.B(-P.stX, P.deckTop, pl.z - pl.w / 2, P.stX, P.platTop, pl.z + pl.w / 2); parts.push(part(g, { sweep: pl.z * (yk === 'S' ? 1 : -1) })); }
    A({ key: 'plat' + yk, name: '站台 · ' + (yk === 'S' ? '南场 6 台' : '北场 5 台'), stage: 'plat', yard: yk, dur: 20, parts, res: { frame: 1 }, cap: '站台层（14.5 m）' });
    const tp = []; for (const tz of tracks(Y)) for (let x = -P.apX; x < P.apX; x += 130) { const x1 = Math.min(P.apX, x + 130), g = new GB('slab'); const sl = g.B(x, P.deckTop, tz - 1.5, x1, P.deckTop + 0.3, tz + 1.5); const r1 = new GB('rail'); g.B(x, P.deckTop + 0.3, tz - 0.79, x1, P.deckTop + 0.48, tz - 0.71, MAT.rail.c); g.B(x, P.deckTop + 0.3, tz + 0.71, x1, P.deckTop + 0.48, tz + 0.79, MAT.rail.c); tp.push(part(g, { sweep: Math.abs(x) })); }
    A({ key: 'track' + yk, name: '铺轨 · ' + (yk === 'S' ? '湖杭场 11 线' : '杭临绩场 9 线'), stage: 'track', yard: yk, dur: 160, parts: tp, res: { track: 1 }, cap: '铺轨（无砟轨道）' });
  }
  // ===== 5. 候车层：站台上 1.6 m 圆柱 → 24 m 楼面（中间留云谷光井）；雨棚上盖板 =====
  const fxs = []; for (let x = -90; x <= 90; x += 20) fxs.push(x);
  const cxs = []; for (let x = 133; x <= 220; x += 17.4) cxs.push(x);
  for (const yk of ['S', 'N']) { const Y = HZ.YARDS[yk], parts = [], cp = [];
    for (const pl of platforms(Y)) { for (const x of fxs) { const g = new GB('conc'); g.cyl(x, pl.z, P.platTop, P.floorBot, 0.8, 10); parts.push(part(g, { sweep: Math.abs(pl.z) })); }
      for (const s of [-1, 1]) for (const x of cxs) { const g = new GB('conc'); g.cyl(s * x, pl.z, P.platTop, P.floorBot, 0.8, 10); cp.push(part(g, { sweep: x })); } }
    if (yk === 'N') for (const x of fxs) { const g = new GB('conc'); g.B(x - 1.5, -1, -134.5, x + 1.5, 0, -131.5); g.cyl(x, -133, 0, P.floorBot, 0.8, 10); parts.push(part(g, { sweep: 140 })); }
    if (yk === 'S') for (const x of fxs) { const g = new GB('conc'); g.B(x - 1.5, -1, 143.5, x + 1.5, 0, 146.5); g.cyl(x, 145, 0, P.floorBot, 0.8, 10); parts.push(part(g, { sweep: 146 })); }
    A({ key: 'col24' + yk, name: '候车层柱 · ' + (yk === 'S' ? '南' : '北'), stage: 'col24', yard: yk, dur: 25, parts, res: { frame: 1 }, cap: '高架候车层「云厅」框架' });
    A({ key: 'ccol' + yk, name: '雨棚上盖柱 · ' + (yk === 'S' ? '南' : '北'), stage: 'col24', yard: yk, dur: 30, parts: cp, res: { frame: 1 }, cap: '站台雨棚 / 上盖平台' });
    // 楼面板块
    const fl = [], zb = yk === 'S' ? [P.gap, 40, 80, 117, P.floorZ] : [-P.floorZ, -117, -80, -40, -P.gap], xb = [-95, -60, -20, 20, 60, 95];
    for (let i = 0; i < xb.length - 1; i++) for (let j = 0; j < zb.length - 1; j++) { const g = new GB('conc'); g.B(xb[i], P.floorBot, zb[j], xb[i + 1], P.floorTop, zb[j + 1]); fl.push(part(g, { sweep: Math.abs(zb[j]) + Math.abs(xb[i]) * 0.3 })); }
    A({ key: 'floor' + yk, name: '候车层楼面 · ' + (yk === 'S' ? '南半' : '北半'), stage: 'floor', yard: yk, dur: 25, parts: fl, res: { frame: 1 }, cap: '高架候车层「云厅」楼面（24 m）' });
    const cd = []; for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { const g = new GB('conc'), x0 = 125 + i * 25, x1 = x0 + 25; g.B(s > 0 ? x0 : -x1, P.floorBot, Y.z0, s > 0 ? x1 : -x0, P.floorTop, Y.z1); cd.push(part(g, { sweep: x0 })); }
    A({ key: 'canopy' + yk, name: '雨棚上盖平台 · ' + (yk === 'S' ? '南' : '北'), stage: 'canopy', yard: yk, dur: 40, parts: cd, res: { frame: 1 }, cap: '站台雨棚 / 上盖平台' });
  }
  // ===== 6. 梭形钢管柱 =====
  const masts = [];
  { const parts = [];
    for (const x of P.mastX) for (const z of P.mastZ) { const onFloor = Math.abs(x) <= P.floorX, y0 = onFloor ? P.floorTop : P.platTop, top = Ht(x, z) - depthAt(x, z) - 1.5;
      const g = new GB('steel'); g.spindle(x, z, y0, top, 0.85, 0.9, 0.65, 12); const pt = part(g, { sweep: Math.abs(z) * 10 + Math.abs(x), name: 'mast' + x + ',' + z, tons: (top - y0) * 2.2 }); parts.push(pt); masts.push({ x, z, y0, top, part: pt }); }
    A({ key: 'mast', name: '梭形钢管柱 24 根', stage: 'mast', dur: 20, parts, res: { steel: 1 }, cap: '梭形钢管柱（两头细、中间粗）' }); }
  HZ.masts = masts;

  // ===== 7. 屋盖网架：南 / 中 / 北三区 + 嵌补 + 孔（柱、提升塔） =====
  const C = P.cell, nx = Math.round(2 * P.roofA / C), nz = 47, x0g = -nx * C / 2, z0g = -nz * C / 2;
  const holeAt = []; for (const m of masts) holeAt.push([m.x, m.z]); for (const x of P.towerX) for (const z of P.towerZ) holeAt.push([x, z]);
  const cells = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { const xa = x0g + i * C, xb = xa + C, za = z0g + j * C, zb = za + C, xc = (xa + xb) / 2, zc = (za + zb) / 2;
    if (Math.max(rho(xa, za), rho(xb, za), rho(xa, zb), rho(xb, zb)) > 1.0) continue;
    let hole = -1; holeAt.forEach(([hx, hz], k) => { if (xa < hx + P.hole && xb > hx - P.hole && za < hz + P.hole && zb > hz - P.hole) hole = k; });
    const grp = hole >= 0 ? 0 : Math.abs(zc) <= P.midZ ? 2 : (Math.abs(zc) < P.midZ + C ? 4 : (zc > 0 ? 1 : 3));
    cells.push({ i, j, xa, xb, za, zb, xc, zc, grp, hole }); }
  HZ.cells = cells;
  const cellAt = new Map(); for (const c of cells) cellAt.set(c.i + ',' + c.j, c);
  const node = (x, z) => [x, Ht(x, z), z], bnode = c => [c.xc, Ht(c.xc, c.zc) - depthAt(c.xc, c.zc), c.zc];
  // 杆件半径按观看距离放大（真实 Φ377 ≈ 0.19 m）：千米外仍能读出网格
  function cellGeo(c, g) {   // 一格：上弦（左、上边 + 缺邻居时右、下边）、4 根腹杆、下弦（到右、下邻格）
    const rT = 0.30, rD = 0.2, a = node(c.xa, c.za), b = node(c.xb, c.za), d = node(c.xa, c.zb), e = node(c.xb, c.zb), bn = bnode(c);
    c.rods = c.rods || []; const L = (p, q, r) => { g.rod(p, q, r); c.rods.push([p, q, r]); steelLen.v += Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) * (r / 0.13); };
    const n = g._mark(() => { L(a, b, rT); L(a, d, rT); if (!cellAt.get((c.i + 1) + ',' + c.j)) L(b, e, rT); if (!cellAt.get(c.i + ',' + (c.j + 1))) L(d, e, rT);
      for (const p of [a, b, d, e]) L(bn, p, rD); });
    c.box = n; c.boxes = [n];
    const same = q => q && q.grp === c.grp && q.hole === c.hole, R1 = cellAt.get((c.i + 1) + ',' + c.j), D1 = cellAt.get(c.i + ',' + (c.j + 1)), L1 = cellAt.get((c.i - 1) + ',' + c.j), U1 = cellAt.get(c.i + ',' + (c.j - 1));
    const chord = q => c.boxes.push(g._mark(() => L(bn, bnode(q), rT)));
    if (same(R1)) chord(R1); if (same(D1)) chord(D1);
    // 嵌补 / 补孔格：把下弦接到四周已就位的邻格（合龙杆件）
    if (c.grp === 0 || c.grp === 4) for (const q of [R1, D1, L1, U1]) if (q && !same(q) && (c.grp === 0 || q.grp !== 0)) chord(q); }
  const zoneName = { 1: '南区', 2: '中区', 3: '北区' }, zoneParts = { 1: [], 2: [], 3: [], 4: [], 0: [] };
  // 每区按行（东西向一行一构件）合并：行数 ≈ 40，便于“按行推进”的施工动画
  const rows = new Map(); for (const c of cells) { const k = c.grp + ':' + c.j + (c.grp === 0 ? ':' + c.hole : ''); if (!rows.has(k)) rows.set(k, []); rows.get(k).push(c); }
  for (const [k, L] of rows) { const g0 = L[0].grp, g = new GB('steel'); for (const c of L) cellGeo(c, g); const pt = part(g, { grp: g0, cells: L, hole: L[0].hole, sweep: g0 === 1 ? -L[0].zc : g0 === 3 ? L[0].zc : Math.abs(L[0].zc) }); zoneParts[g0].push(pt); }
  // 柱头（锥形扩大头）放进孔
  for (const m of masts) { const g = new GB('steel'); const hb = m.top, ht = Ht(m.x, m.z); g._mark(() => g.extrudeCone(m.x, m.z, hb, ht - 0.2, 0.65, 2.5)); zoneParts[0].push(part(g, { sweep: Math.abs(m.z), headOf: m.part, hole: HZ.masts.indexOf(m) })); }

  // ----- 拼装姿态 / 整体提升高度 D（规则推出）-----
  const ax = { 1: { z: P.roofB, y: P.roofLo, s: 1 }, 3: { z: -P.roofB, y: P.roofLo, s: -1 } };
  // 姿态函数：grp, 旋转进度 r(0 = 拼装姿态 / 1 = 设计姿态), 竖向偏移 dy → 点变换
  const rotY = (g, p, r) => { if (g !== 1 && g !== 3) return p; const A0 = ax[g], ang = A0.s * P.alpha * (1 - r), dz = p[2] - A0.z, dy = p[1] - A0.y, c = Math.cos(ang), s = Math.sin(ang); return [p[0], A0.y + dy * c + dz * s, A0.z - dy * s + dz * c]; };
  HZ.rotY = rotY;
  // 检查：南区在拼装姿态时内侧比设计低（旋转 4° 后内边抬升 ~8 m）
  { const p = [0, Ht(0, 45.5), 45.5], q = rotY(1, p, 0); HZ.innerDrop = +(p[1] - q[1]).toFixed(2); }
  // D：拼装姿态下（未平移）所有移动格的下弦最低点，若在候车层楼面范围内须 ≥ 楼面 + 胎架最小高度
  let Dmax = 1e9; const onFloor = (x, z) => Math.abs(x) <= P.floorX && Math.abs(z) <= P.floorZ && Math.abs(z) >= P.gap;
  // 保守：用整格包围盒（含杆件半径）的 8 个角点；格的平面投影与楼面相交就计入
  const fl = [[-P.floorX, P.gap, P.floorX, P.floorZ], [-P.floorX, -P.floorZ, P.floorX, -P.gap]];
  for (const c of cells) for (const b of c.boxes) { if (c.grp === 0 || c.grp === 4) continue; let lo = 1e9, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) { const q = rotY(c.grp, [x, y, z], 0); lo = Math.min(lo, q[1]); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]); }
    if (fl.some(f => x0 < f[2] && x1 > f[0] && z0 < f[3] && z1 > f[1])) Dmax = Math.min(Dmax, lo - (P.floorTop + P.jigMin)); }
  const D = HZ.D = Math.floor(Dmax * 10) / 10;   // 整体提升高度（m）

  // 胎架（临时）：拼装姿态下，每隔一格在楼面上立一根（顶 = 该格下弦节点）
  const jig = { 1: [], 2: [], 3: [] };
  for (const c of cells) { if (!(c.grp >= 1 && c.grp <= 3) || (c.i + c.j) % 2) continue; const bn = rotY(c.grp, bnode(c), 0), y1 = bn[1] - D - 0.31; /* 胎架顶 = 下弦节点 − 杆件半径 */ if (!onFloor(bn[0], bn[2])) continue;
    const g = new GB('jig'); g.B(bn[0] - 0.6, P.floorTop, bn[2] - 0.6, bn[0] + 0.6, y1, bn[2] + 0.6); jig[c.grp].push(part(g, { sweep: Math.abs(bn[2]), jigOf: c })); }

  // 提升架（柱顶钢架 + 提升器）/ 提升塔（中区，楼面起）+ 钢绞线
  const rigFor = { 1: [], 2: [], 3: [] }, lifters = [];
  const zoneOfPt = (x, z) => { const i = Math.floor((x - x0g) / C), j = Math.floor((z - z0g) / C), c = cellAt.get(i + ',' + j); return c ? c.grp : -1; };
  for (const m of masts) { const zone = m.z > 0 ? 1 : 3, g = new GB('red'), top = Ht(m.x, m.z) + 4; for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.B(m.x + sx * 3.0 - 0.12, m.top - 1.2, m.z + sz * 3.0 - 0.12, m.x + sx * 3.0 + 0.12, top, m.z + sz * 3.0 + 0.12);
    g.B(m.x - 3.1, m.top - 1.6, m.z - 3.1, m.x + 3.1, m.top - 1.2, m.z + 3.1); g.B(m.x - 3.1, top, m.z - 3.1, m.x + 3.1, top + 1.2, m.z + 3.1); g.B(m.x - 0.8, top + 1.2, m.z - 0.8, m.x + 0.8, top + 2.6, m.z + 0.8);
    const pt = part(g, { sweep: Math.abs(m.z), host: m.part, lift: { x: m.x, z: m.z, top: top + 2.6, zone } }); rigFor[zone].push(pt); lifters.push(pt.lift); }
  for (const x of P.towerX) for (const z of P.towerZ) { const g = new GB('red'), top = Ht(x, z) + 4; for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.B(x + sx * 1.2 - 0.14, P.floorTop, z + sz * 1.2 - 0.14, x + sx * 1.2 + 0.14, top, z + sz * 1.2 + 0.14);
    for (let y = P.floorTop + 4; y < top; y += 5) g.B(x - 1.34, y, z - 1.34, x + 1.34, y + 0.3, z + 1.34);
    g.B(x - 2.2, top, z - 2.2, x + 2.2, top + 1.2, z + 2.2); g.B(x - 0.8, top + 1.2, z - 0.8, x + 0.8, top + 2.6, z + 0.8);
    const pt = part(g, { sweep: Math.abs(x), lift: { x, z, top: top + 2.6, zone: 2 } }); rigFor[2].push(pt); lifters.push(pt.lift); }
  // 钢绞线：提升器顶 → 孔边 4 个吊点（吊点随所在分区移动）
  const strands = []; for (const L of lifters) for (const [dx, dz] of [[-3.6, 0], [3.6, 0], [0, -3.6], [0, 3.6]]) { const x = L.x + dx, z = L.z + dz, g = zoneOfPt(x, z); if (g < 1) continue; strands.push({ a: [L.x + dx * 0.15, L.top, L.z + dz * 0.15], b: [x, Ht(x, z), z], gb: g, zone: L.zone }); L.pts = (L.pts || 0) + 1; }
  HZ.lifters = lifters; HZ.strands = strands;

  // ===== 活动：屋盖 =====
  const crew = { asm: 1 };
  for (const z of [1, 2, 3]) A({ key: 'jig' + z, name: zoneName[z] + '拼装胎架', stage: 'jig', kind: 'temp', zone: z, dur: 10, parts: jig[z], res: { jig: 1 }, temp: { serves: ['asm', 'lift'], removeStage: 'unjig', removeName: zoneName[z] + '胎架拆除', removeDur: 6 }, scope: 'z' + z, cap: '屋盖楼面拼装（南 / 中 / 北三区）' });
  for (const z of [1, 2, 3]) A({ key: 'asm' + z, name: '屋盖网架楼面拼装 · ' + zoneName[z], stage: 'asm', zone: z, dur: z === 2 ? 24 : 32, parts: zoneParts[z], res: crew, scope: 'z' + z, need: 'jig', cap: '屋盖楼面拼装（南 / 中 / 北三区）' });
  A({ key: 'rig', name: '提升架 / 提升塔 + 液压提升器', stage: 'rig', kind: 'temp', dur: 15, parts: [...rigFor[1], ...rigFor[2], ...rigFor[3]], res: { steel: 1 }, temp: { serves: ['lift', 'merge', 'wlift', 'head'], removeStage: 'unrig', removeName: '提升架 / 提升塔拆除', removeDur: 12 }, scope: 'rig', strands, cap: '提升架就位' });
  const lift = (z, d, nm) => A({ key: 'lift' + z, name: nm, stage: 'lift', zone: z, dur: d, parts: [], res: { lifters: 1 }, scope: 'z' + z, cap: nm, liftZone: z });
  lift(1, 5, '南区旋转提升：脱胎 0.6 m，绕轴转 4°'); lift(2, 3, '中区提升：脱胎 0.6 m'); lift(3, 5, '北区旋转提升：脱胎 0.6 m，绕轴转 4°');
  A({ key: 'merge', name: '嵌补合龙（两条分区缝）', stage: 'merge', dur: 10, parts: zoneParts[4], res: crew, scope: 'rig', cap: '嵌补合龙' });
  A({ key: 'wlift', name: '整体提升 ' + D.toFixed(1) + ' m 到位', stage: 'wlift', dur: 4, parts: [], res: { lifters: 1 }, scope: 'rig', cap: '整体提升到位（' + D.toFixed(1) + ' m）' });
  A({ key: 'head', name: '柱头连接 + 补孔，卸载', stage: 'head', dur: 8, parts: zoneParts[0].filter(p => p.headOf), res: crew, scope: 'rig', cap: '柱头连接、卸载' });
  A({ key: 'holes', name: '提升孔嵌补', stage: 'holes', dur: 10, parts: zoneParts[0].filter(p => !p.headOf), res: crew, cap: '拆除提升架，补孔' });

  // ===== 8. 屋面：采光顶 / 金属屋面 + 吊顶 / 光伏 =====
  { const s = 3.5, skyP = [], clP = [], soP = [], pvP = [], nxs = Math.ceil(P.roofA * 2 / s), nzs = Math.ceil(P.roofB * 2 / s);
    const clip = (x, z) => { const r = rho(x, z); if (r <= 1) return [x, z]; return [x / r, z / r]; };
    let skyA = 0, pvA = 0;
    const isPV = (x, z) => HZ.pvMask(x, z) > 0.5;
    for (let j = 0; j < nzs; j++) { const g1 = new GB('glass'), g2 = new GB('clad'), g3 = new GB('soffit'), g4 = new GB('pv');
      for (let i = 0; i < nxs; i++) { const xa = -P.roofA + i * s, za = -P.roofB + j * s, xb = xa + s, zb = za + s, xc = xa + s / 2, zc = za + s / 2; if (rho(xc, zc) > 1.0) continue;
        const q = [[xa, za], [xb, za], [xb, zb], [xa, zb]].map(([x, z]) => clip(x, z)), sky = inSky(xc, zc), pv = false; if (!sky) pvA += SEQ.quadArea(...q.map(([x, z]) => [x, Hc(x, z), z])) * HZ.pvMask(xc, zc);
        const top = q.map(([x, z]) => [x, Hc(x, z) + (pv ? 0.15 : 0), z]), bot = q.map(([x, z]) => [x, Hs(x, z), z]);
        const area = SEQ.quadArea(...top);
        const tg = sky ? g1 : pv ? g4 : g2; tg.quad(top[0], top[3], top[2], top[1]); if (sky) skyA += area; if (pv) { pvA += area; g2.quad([top[0][0], top[0][1] - 0.15, top[0][2]], [top[3][0], top[3][1] - 0.15, top[3][2]], [top[2][0], top[2][1] - 0.15, top[2][2]], [top[1][0], top[1][1] - 0.15, top[1][2]]); }
        if (!sky) g3.quad(bot[0], bot[1], bot[2], bot[3]);
        // 外缘封边（云的厚边）：格子有顶点被裁到轮廓上时，沿轮廓画竖向封边
        for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; if (rho(q[k][0], q[k][1]) > 0.995 && rho(q[k2][0], q[k2][1]) > 0.995) g2.quad(top[k], top[k2], bot[k2], bot[k]); }
      }
      if (g1.P.length) skyP.push(part(g1, { sweep: Math.abs(-P.roofB + j * s) })); if (g2.P.length) clP.push(part(g2, { sweep: -P.roofB + j * s })); if (g3.P.length) soP.push(part(g3, { sweep: -P.roofB + j * s })); if (g4.P.length) pvP.push(part(g4, { sweep: -P.roofB + j * s }));
    }
    HZ.skyArea = Math.round(skyA); HZ.pvArea = Math.round(pvA); HZ.isPV = isPV;
    A({ key: 'sky', name: '十字采光顶（拱形天窗）', stage: 'sky', dur: 40, parts: skyP, res: { skin: 1 }, cap: '十字采光顶' });
    A({ key: 'clad', name: '金属屋面（白色穿孔铝板）+ 吊顶', stage: 'clad', dur: 62, parts: clP.concat(soP), res: { skin: 1 }, cap: '金属屋面 + 吊顶' });
    A({ key: 'pv', name: '屋面光伏', stage: 'pv', dur: 30, parts: [], res: { skin: 1 }, cap: '屋面光伏' });   // 光伏 = 金属屋面上的着色器遮罩（四个角瓣，边缘抗锯齿），按进度从北往南铺
  }
  // ===== 9. 5F 空中连廊（31 m）=====
  { const parts = [];
    for (const s of [-1, 1]) for (const yk of ['S', 'N']) { const Y = HZ.YARDS[yk], g = new GB('conc'), xx = s * 129; g.B(xx - 3, P.ringY, Y.z0 + 2, xx + 3, P.ringY + 1.0, Y.z1 - 2); for (let z = Y.z0 + 8; z < Y.z1 - 4; z += 20) g.cyl(xx, z, P.floorTop, P.ringY, 0.5, 8); const gl = new GB('glass'); gl.B(xx - 3, P.ringY + 1.0, Y.z0 + 2, xx - 2.9, P.ringY + 2.1, Y.z1 - 2); gl.B(xx + 2.9, P.ringY + 1.0, Y.z0 + 2, xx + 3, P.ringY + 2.1, Y.z1 - 2); parts.push(part(g, { sweep: 0 }), part(gl, { sweep: 1 })); }
    for (const s of [-1, 1]) { const g = new GB('conc'), zz = s * 143; g.B(-92, P.ringY, zz - 3, 92, P.ringY + 1.0, zz + 3); for (let x = -86; x <= 86; x += 21.5) g.cyl(x, zz, P.floorTop, P.ringY, 0.5, 8); parts.push(part(g, { sweep: 2 })); }
    A({ key: 'ring', name: '5F 空中花园连廊（31 m）', stage: 'ring', dur: 40, parts, res: { frame: 1 }, cap: '5F 空中连廊' }); }
  // ===== 10. 上盖开发（四角）=====
  { const parts = [];
    for (const sx of [-1, 1]) for (const yk of ['S', 'N']) { const z0 = yk === 'S' ? 66 : -112, z1 = yk === 'S' ? 132 : -54, x0 = 152, x1 = 214, fl = 4.6, n = 5;
      for (let k = 0; k < n; k++) { const y0 = P.floorTop + k * fl, g = new GB('todG'), b = new GB('todB'); const a = sx > 0 ? [x0, x1] : [-x1, -x0], ins = k === n - 1 ? 0 : 0.6;
        b.B(a[0], y0, z0, a[1], y0 + 0.8, z1); g.B(a[0] + ins, y0 + 0.8, z0 + ins, a[1] - ins, y0 + fl, z1 - ins); parts.push(part(b, { sweep: k * 2 }), part(g, { sweep: k * 2 + 1 })); }
      const r = new GB('todB'), a = sx > 0 ? [x0, x1] : [-x1, -x0]; r.B(a[0] - 0.5, P.floorTop + n * fl, z0 - 0.5, a[1] + 0.5, P.floorTop + n * fl + 1.2, z1 + 0.5); parts.push(part(r, { sweep: 20 })); }
    A({ key: 'tod', name: '雨棚上盖开发（四角，~5 万 m²）', stage: 'tod', dur: 260, release: 790, parts, res: { tod: 1 }, cap: '上盖开发（四角）' }); }
  // ===== 11. 云门（站房南侧 15 m；180 × 60 × 80 m，中间“门洞”）=====
  { const zA = 178, zB = 238, fp = [], fr = [], fc = [];
    { const g = new GB('found'); g.B(-92, -1.5, zA - 2, 92, 0, zB + 2); fp.push(part(g)); }
    for (const [x0, x1] of [[-90, -38], [38, 90]]) for (let y = 0; y < 50; y += 10) { const g = new GB('ym'); g.B(x0, y, zA, x1, y + 10, zB); fr.push(part(g, { sweep: y })); }
    for (let y = 50; y < 80; y += 10) { const g = new GB('ym'); g.B(-90, y, zA, 90, y + 10, zB); fr.push(part(g, { sweep: y })); }
    // 立面：竖向玻璃缝（良渚玉琮式的密纹）
    for (const zz of [zA - 0.3, zB + 0.3]) { const g = new GB('ymG'); for (let x = -88; x <= 88; x += 4) { if (Math.abs(x) < 38) g.B(x - 0.7, 52, zz - 0.2, x + 0.7, 78, zz + 0.2); else g.B(x - 0.7, 2, zz - 0.2, x + 0.7, 78, zz + 0.2); } fc.push(part(g, { sweep: zz, side: true })); }
    A({ key: 'ymf', name: '云门基础', stage: 'ymf', dur: 40, release: 700, parts: fp, res: { ym: 1 }, cap: '云门' });
    A({ key: 'ym', name: '云门主体（80 m）', stage: 'ym', scope: 'ym', dur: 125, parts: fr, res: { ym: 1 }, cap: '云门主体结构' });
    A({ key: 'ymc', name: '云门幕墙', stage: 'ymc', scope: 'ym', dur: 150, parts: fc, res: { ym: 1 }, cap: '云门幕墙' }); }
  // ===== 12. 塔吊（临时）=====
  { const mk = (x, z, jy, yaw) => { const g = new GB('yellow'); g.B(x - 1, -1, z - 1, x + 1, jy, z + 1); const c = Math.cos(yaw), s = Math.sin(yaw), L = 56, Lc = 16; const xa = x - c * Lc, za = z - s * Lc, xb = x + c * L, zb = z + s * L;
      g._mark(() => { g.rod([xa, jy + 0.6, za], [xb, jy + 0.6, zb], 0.55); g.rod([x, jy + 7, z], [xb * 0.6 + x * 0.4, jy + 1, zb * 0.6 + z * 0.4], 0.12); g.rod([x, jy + 7, z], [xa, jy + 1, za], 0.12); });
      g.B(x - 1, jy, z - 1, x + 1, jy + 7, z + 1); g.B(xa - 2, jy - 1.5, za - 2, xa + 2, jy + 1.5, za + 2, MAT.conc.c); return g; };
    const cr1 = [mk(-170, -150, 68, Math.PI / 2 * 0.85), mk(170, -150, 68, Math.PI / 2 * 1.15), mk(-170, 160, 68, -Math.PI / 2 * 0.9), mk(170, 160, 68, -Math.PI / 2 * 1.1), mk(-260, 0, 40, 0.1), mk(260, 0, 40, Math.PI - 0.1)];
    A({ key: 'crane', name: '塔吊', stage: 'crane', kind: 'temp', dur: 10, release: 300, parts: cr1.map(g => part(g)), res: {}, temp: { serves: ['frame', 'mezz', 'deck', 'plat', 'col24', 'floor', 'canopy', 'mast', 'tod'], removeStage: 'uncrane', removeName: '塔吊拆除', removeDur: 10 }, cap: '塔吊进场' });
    const cr2 = [mk(-60, 262, 96, -Math.PI / 2), mk(60, 262, 96, -Math.PI / 2 * 1.2)];
    A({ key: 'ycrane', name: '云门塔吊', stage: 'crane', kind: 'temp', dur: 10, release: 705, parts: cr2.map(g => part(g)), res: {}, temp: { serves: ['ym', 'ymc'], removeStage: 'uncrane', removeName: '云门塔吊拆除', removeDur: 10 }, scope: 'ym', cap: '云门塔吊' }); }
  // ===== 13. 开通 =====
  A({ key: 'open', name: '开通运营 · 首趟列车', stage: 'open', kind: 'milestone', dur: 0, release: P.OPEN, parts: [], cap: '2022-09-22 开通，首趟列车进站' });

  // 吨位：屋盖杆件按长度、柱按高度分摊 1.3 万 t
  const mastT = masts.reduce((s, m) => s + m.part.tons, 0), roofT = 13000 - mastT * 2.5;
  for (const a of acts) { a.tally = {}; let t = 0; for (const p of a.parts) { if (p.tons) p.t = p.tons * 2.5; else if (p.mat === 'steel' && p.cells) { let l = 0; p.geo.boxes.forEach(() => 0); l = p.len || 0; p.t = 0; } } }
  // 网架行吨位：按行内格数 × 每格杆长（均匀）
  const nCellsMove = cells.length; for (const a of acts) for (const p of a.parts) if (p.cells) p.t = roofT * p.cells.length / nCellsMove; else if (p.headOf) p.t = 0;
  for (const a of acts) { const t = a.parts.reduce((s, p) => s + (p.t || 0), 0); if (t) a.tally.steel = t; }
  HZ.steelTotal = 13000;
  return acts;
}

// 锥台（柱头扩大头）
SEQ.Geo.prototype.extrudeCone = function (x, z, y0, y1, r0, r1) { const n = 12; for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, p = (a, y, r) => [x + Math.cos(a) * r, y, z + Math.sin(a) * r];
  this.quad(p(a0, y0, r0), p(a1, y0, r0), p(a1, y1, r1), p(a0, y1, r1)); this.tri([x, y1, z], p(a1, y1, r1), p(a0, y1, r1)); } };

// ---------------- 规则（参数化，交给 SEQ.derive）----------------
// R1 支承（逐个原始包围盒：上下贴合 + 平面重叠；或“侧挂”：夹层板挂在相邻框架柱上）
function supRule(acts) { let n = 0; const ALL = [];
  for (const a of acts) for (const p of a.parts) if (!p.grp) for (const b of p.geo.boxes) ALL.push({ a, p, b });
  const grid = new Map(), cs = 30, key = (i, j) => i * 100000 + j;
  for (const e of ALL) for (let i = Math.floor(e.b.min[0] / cs); i <= Math.floor(e.b.max[0] / cs); i++) for (let j = Math.floor(e.b.min[2] / cs); j <= Math.floor(e.b.max[2] / cs); j++) { const k = key(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(e); }
  HZ._supGrid = { grid, cs, key };
  const K0 = {}; for (const a of acts) K0[a.key] = a;
  for (const a of acts) { if (a.kind === 'milestone' || a.stage === 'asm' || a.stage === 'merge' || !a.parts.length) continue;
    if (['sky', 'clad', 'pv', 'holes'].includes(a.stage)) { for (const p of a.parts) p.sup = new Set(['asm1', 'asm2', 'asm3', 'merge', 'head']); for (const k of ['merge', 'head']) n += SEQ.link(a, K0[k], 'R1'); a.need = 'sup'; continue; }
    for (const p of a.parts) { if (p.grp) continue; p.sup = new Set();
      for (const b of p.geo.boxes) { if (b.min[1] <= -0.5) { p.sup.add('ground'); continue; } const seen = new Set();
        for (let i = Math.floor(b.min[0] / cs); i <= Math.floor(b.max[0] / cs); i++) for (let j = Math.floor(b.min[2] / cs); j <= Math.floor(b.max[2] / cs); j++) for (const e of grid.get(key(i, j)) || []) { if (seen.has(e)) continue; seen.add(e);
          const ox = Math.min(b.max[0], e.b.max[0]) - Math.max(b.min[0], e.b.min[0]), oz = Math.min(b.max[2], e.b.max[2]) - Math.max(b.min[2], e.b.min[2]);
          const touch = Math.abs(e.b.max[1] - b.min[1]) < 0.05 && ox > 0.05 && oz > 0.05;
          const oy = Math.min(b.max[1], e.b.max[1]) - Math.max(b.min[1], e.b.min[1]), side = p.side && oy > 0.5 && ((oz > 0.05 && ox > -1.3 && ox < 0.05) || (ox > 0.05 && oz > -1.3 && oz < 0.05));
          const host = p.host && e.p === p.host;
          if (e.a === a && e.p === p) continue;
          if (e.a === a && touch) { p.sup.add('self'); continue; }
          if ((touch || side || host) && e.a.kind !== 'untemp') { p.sup.add(e.a.key); if (e.a.kind !== 'temp' || a.kind === 'temp') n += SEQ.link(a, e.a, 'R1'); } }
        // 同一活动内：上层盒子落在本构件下层盒子上（例如墩身落在承台上）
        for (const b2 of p.geo.boxes) if (b2 !== b && Math.abs(b2.max[1] - b.min[1]) < 0.05) p.sup.add('self'); }
    }
    if (a.pred.some(e => e.why === 'R1')) a.need = 'sup'; }
  return n; }
// 屋盖：拼装 = 胎架 + 楼面；提升 = 提升架；柱头 = 整体提升后；R8 提升净空：静止构件若与任一提升阶段的扫掠体相交 → 必须排在该提升之后
function roofRule(acts) { const K = {}; for (const a of acts) K[a.key] = a; let n = 0; const L = (b, a, w, lag) => { n += SEQ.link(K[b] || b, K[a] || a, w, lag); };
  for (const z of [1, 2, 3]) { L('asm' + z, 'floorS', 'R1'); L('asm' + z, 'floorN', 'R1'); L('lift' + z, 'asm' + z, 'R3'); L('lift' + z, 'rig', 'R4'); }
  L('jig1', 'floorS', 'R1'); L('jig2', 'floorS', 'R1'); L('jig2', 'floorN', 'R1'); L('jig3', 'floorN', 'R1');
  L('lift2', 'lift1', 'R5'); L('lift3', 'lift2', 'R5');         // 一套提升系统：南 → 中 → 北（实录顺序）
  for (const z of [1, 2, 3]) L('merge', 'lift' + z, 'R3'); L('wlift', 'merge', 'R3'); L('head', 'wlift', 'R3');
  L('holes', 'rig~rm', 'R8');                                   // 提升塔 / 提升架占着孔：拆了才能补
  for (const k of ['sky', 'clad']) { L(k, 'head', 'R3'); L(k, 'holes', 'R3'); } L('pv', 'clad', 'R3');
  L('rig', 'mast', 'R1'); L('rig', 'floorS', 'R1'); L('rig', 'floorN', 'R1');
  return n; }
function sweepRule(acts) {   // R8：任何静止构件的包围盒与提升扫掠包络（每区：拼装姿态 ∪ 设计姿态）相交 → 排在整体提升之后
  let n = 0; const env = HZ.liftEnv, K = {}; for (const a of acts) K[a.key] = a; HZ.r8 = []; HZ.r8bad = [];
  const anc = new Set(), st = [K.wlift]; while (st.length) { const x = st.pop(); for (const e of x.pred) if (!anc.has(e.a)) { anc.add(e.a); st.push(e.a); } }   // 整体提升的前驱：若与扫掠相交 = 几何冲突（审计报出），不加依赖（否则成环）
  for (const a of acts) { if (a.kind === 'milestone' || ['asm', 'merge', 'lift', 'wlift', 'head', 'holes', 'jig', 'rig', 'unjig', 'unrig', 'sky', 'clad', 'pv'].includes(a.stage) || a.kind === 'untemp') continue;
    let hit = false; for (const p of a.parts) { if (p.grp) continue; for (const b of p.geo.boxes) for (const e of env) if (SEQ.BB.hit(b, e, -0.05)) { hit = true; break; } if (hit) break; }
    if (hit) { if (anc.has(a)) HZ.r8bad.push(a.name); else { n += SEQ.link(a, K.wlift, 'R8'); HZ.r8.push(a.name); } } }
  return n; }

// ---------------- 姿态：任一时刻各组的变换 ----------------
// 返回 {1..4: {dy, r}}；r = 旋转进度（0 拼装 / 1 设计），dy = 竖向偏移（设计姿态为 0）
HZ.pose = function (t) {
  const K = HZ.K, D = HZ.D, prog = a => !a ? 0 : a.dur > 0 ? Math.max(0, Math.min(1, (t - a.start) / a.dur)) : (t >= a.start ? 1 : 0), ease = x => x * x * (3 - 2 * x);
  const w = ease(prog(K.wlift)), out = {};
  for (const z of [1, 2, 3]) { const p = prog(K['lift' + z]); const l = z === 2 ? ease(p) : ease(Math.min(1, p / 0.25)), r = z === 2 ? 1 : ease(Math.max(0, (p - 0.25) / 0.75)); out[z] = { dy: -D + 0.6 * l + (D - 0.6) * w, r: z === 2 ? 1 : r, moving: p > 0 && p < 1 }; }
  out[4] = { dy: -(D - 0.6) * (1 - w), r: 1 }; out.w = w; out.lifting = out[1].moving || out[2].moving || out[3].moving || (w > 0 && w < 1);
  return out; };
HZ.xf = function (pose, g, p) { if (!g) return p; const s = pose[g]; const q = HZ.rotY(g, p, s.r); return [q[0], q[1] + s.dy, q[2]]; };
// 4×4（列主序，three.js Matrix4.elements）：先绕轴旋转，再竖向平移
HZ.mat = function (pose, g) { const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; if (!g) return I; const s = pose[g];
  if (g === 1 || g === 3) { const A0 = g === 1 ? { z: P.roofB, y: P.roofLo, s: 1 } : { z: -P.roofB, y: P.roofLo, s: -1 }, ang = A0.s * P.alpha * (1 - s.r), c = Math.cos(ang), sn = Math.sin(ang);
    // y' = A.y + (y−A.y)c + (z−A.z)s ; z' = A.z − (y−A.y)s + (z−A.z)c
    const ty = A0.y - A0.y * c - A0.z * sn + s.dy, tz = A0.z + A0.y * sn - A0.z * c; return [1, 0, 0, 0, 0, c, -sn, 0, 0, sn, c, 0, 0, ty, tz, 1]; }
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, s.dy, 0, 1]; };

// ---------------- 排程 ----------------
HZ.make = function () {
  const T0 = Date.now(), acts = build();
  // 提升扫掠包络（R8 用）：每区 拼装姿态 ∪ 设计姿态 的包围盒，按格计算（保守）
  const pose0 = { 1: { dy: -HZ.D, r: 0 }, 2: { dy: -HZ.D, r: 1 }, 3: { dy: -HZ.D, r: 0 }, 4: { dy: -(HZ.D - 0.6), r: 1 } }, pose1 = { 1: { dy: 0, r: 1 }, 2: { dy: 0, r: 1 }, 3: { dy: 0, r: 1 }, 4: { dy: 0, r: 1 } };
  HZ.liftEnv = []; for (const c of HZ.cells) if (c.grp) for (const cb of c.boxes) { const b = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }; for (const ps of [pose0, pose1]) for (const x of [cb.min[0], cb.max[0]]) for (const y of [cb.min[1], cb.max[1]]) for (const z of [cb.min[2], cb.max[2]]) { const q = HZ.xf(ps, c.grp, [x, y, z]); for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], q[k]); b.max[k] = Math.max(b.max[k], q[k]); } } HZ.liftEnv.push(b); }
  const rules = [
    { type: 'temp', id: 'R4' },
    { type: 'custom', id: 'R1', fn: supRule },
    { type: 'custom', id: 'R3', fn: roofRule },
    { type: 'after', id: 'R3', to: 'track', from: 'plat', scope: 'any', near: 0 },
    { type: 'after', id: 'R3', to: 'ym', from: 'ymf', scope: 'any' }, { type: 'after', id: 'R3', to: 'ymc', from: 'ym', scope: 'any' },
    { type: 'custom', id: 'R8', fn: sweepRule },
    { type: 'custom', id: 'R3', fn: (A2) => { let n = 0; const K = {}; for (const a of A2) K[a.key] = a; for (const a of A2) if (a.key !== 'open' && a.kind !== 'milestone') n += SEQ.link(K.open, a, 'R3'); return n; } },
  ];
  const counts = SEQ.derive(acts, rules);
  const caps = { jig: 2, mezz: 2, frame: 2, bridge: 1, steel: 1, lifters: 1, skin: 2, track: 1, tod: 1, ym: 1, civil: 1, asm: 3 };
  // 拼装班组：两个工作面（南北两半可同时拼）
  for (const a of acts) if (a.res && a.res.asm) a.res = { asm: 1 };
  const sch = SEQ.schedule(acts, { caps, write: true });
  const K = {}; for (const a of acts) K[a.key] = a; HZ.K = K; HZ.acts = acts; HZ.counts = counts; HZ.caps = caps;
  HZ.total = Math.max(...acts.map(a => a.end));
  HZ.genMs = Date.now() - T0;
  return { acts, sch, counts };
};

// ---------------- 审计（与规则推导独立：按排出的时间表 + 几何重算）----------------
HZ.audit = function () {
  const T0 = Date.now(), acts = HZ.acts, K = HZ.K, out = {};
  out.net = SEQ.auditNet(acts, { caps: HZ.caps });
  // A1 无支承：每个静止构件开工时，至少一个支承者已完成且未拆除（或落地 / 本身成套）
  let unsup = 0; const ex = [];
  for (const a of acts) for (const p of a.parts) { if (p.grp || !p.sup) continue; if (!p.sup.size) { unsup++; if (ex.length < 6) ex.push('无支承 ' + a.name); continue; }
    let ok = p.sup.has('ground') || p.sup.has('self'); for (const k of p.sup) { const s = K[k]; if (s && s.end <= a.start && (!s.rm || s.rm.start >= a.end)) ok = true; } if (!ok) { unsup++; if (ex.length < 6) ex.push('支承未就位 ' + a.name); } }
  // 屋盖分区：拼装期间须有胎架；提升期间提升点多边形须包住重心（静力稳定）
  const hull = pts => { pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up = []; for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); } for (const p of pts.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); } return lo.slice(0, -1).concat(up.slice(0, -1)); };
  const inside = (H, p) => { for (let i = 0; i < H.length; i++) { const a = H[i], b = H[(i + 1) % H.length]; if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) return false; } return true; };
  out.zones = {};
  for (const z of [1, 2, 3]) { const cs = HZ.cells.filter(c => c.grp === z), cg = [cs.reduce((s, c) => s + c.xc, 0) / cs.length, cs.reduce((s, c) => s + c.zc, 0) / cs.length];
    const lp = HZ.lifters.filter(l => l.zone === z).map(l => [l.x, l.z]), jg = K['jig' + z].parts.map(p => [p.jigOf.xc, p.jigOf.zc]);
    const okL = inside(hull(lp), cg), okJ = inside(hull(jg), cg), jigOk = K['jig' + z].end <= K['asm' + z].start && K['jig' + z].rm.start >= K['lift' + z].end, rigOk = K.rig.end <= K['lift' + z].start && K.rig.rm.start >= K.head.end;
    out.zones[z] = { cells: cs.length, lifters: lp.length, jigs: jg.length, liftHull: okL, jigHull: okJ, jigTime: jigOk, rigTime: rigOk }; if (!(okL && okJ && jigOk && rigOk)) { unsup++; ex.push('分区 ' + z + ' 支承'); } }
  // 嵌补合龙：两侧分区都已到设计姿态（同一高度）后才嵌补
  { const pm = HZ.pose(K.merge.start); out.mergeAligned = Math.abs(pm[1].dy - pm[2].dy) < 1e-6 && Math.abs(pm[3].dy - pm[2].dy) < 1e-6 && Math.abs(pm[4].dy - pm[2].dy) < 1e-6 && pm[1].r === 1 && pm[3].r === 1; if (!out.mergeAligned) { unsup++; ex.push('合龙时分区未对齐'); } }
  out.unsupported = unsup; out.ex = ex;
  // A2 穿模：同时存在的静止原始盒子两两相交（收缩 0.06 m；排除同构件、宿主）
  const live = (a, t) => a.start <= t && (a.kind !== 'temp' || !a.rm || a.rm.end > t);
  const B = []; for (const a of acts) if (a.kind !== 'untemp') for (const p of a.parts) if (!p.grp) for (const b of p.geo.boxes) B.push({ a, p, b });
  const cs = 20, grid = new Map(); B.forEach((e, idx) => { for (let i = Math.floor(e.b.min[0] / cs); i <= Math.floor(e.b.max[0] / cs); i++) for (let j = Math.floor(e.b.min[2] / cs); j <= Math.floor(e.b.max[2] / cs); j++) { const k = i * 100000 + j; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(idx); } });
  let clip = 0; const cex = [], seen = new Set();
  for (const L of grid.values()) for (let x = 0; x < L.length; x++) for (let y = x + 1; y < L.length; y++) { const e = B[L[x]], f = B[L[y]]; if (e.p === f.p || e.p.host === f.p || f.p.host === e.p || (e.p.headOf && e.p.headOf === f.p) || (f.p.headOf && f.p.headOf === e.p) || (e.p.hole >= 0 && e.p.hole === f.p.hole && (e.p.headOf || f.p.headOf)) || (e.p.cells && f.p.cells)) continue;
    const k = L[x] < L[y] ? L[x] * 1e6 + L[y] : L[y] * 1e6 + L[x]; if (seen.has(k)) continue; seen.add(k);
    if (!SEQ.BB.hit(e.b, f.b, -0.06)) continue;
    // 时间上是否共存
    const s = Math.max(e.a.start, f.a.start), t1 = Math.min(e.a.kind === 'temp' ? e.a.rm.end : 1e9, f.a.kind === 'temp' ? f.a.rm.end : 1e9); if (s >= t1) continue;
    clip++; if (cex.length < 8) cex.push(e.a.name + ' × ' + f.a.name); }
  out.clip = clip; out.clipEx = cex; out.boxes = B.length;
  // A3 提升净空：提升各阶段按 32 个时刻采样，移动格（按格包围盒、随姿态变换）× 当时在场的静止盒子
  let lc = 0, samples = 0, minFloor = 1e9; const lex = [];
  const stagesL = ['lift1', 'lift2', 'lift3', 'merge', 'wlift'].map(k => K[k]);
  for (const S of stagesL) for (let q = 0; q <= 24; q++) { const t = S.start + S.dur * q / 24, ps = HZ.pose(t); samples++;
    for (const c of HZ.cells) { if (!c.grp || (c.grp === 4 && t < K.merge.start)) continue;
      for (const [a0, b0, r] of c.rods) { const a = HZ.xf(ps, c.grp, a0), b = HZ.xf(ps, c.grp, b0), lo = [0, 1, 2].map(k => Math.min(a[k], b[k]) - r), hi = [0, 1, 2].map(k => Math.max(a[k], b[k]) + r);
        if (Math.abs(c.xc) <= P.floorX && Math.abs(c.zc) <= P.floorZ && Math.abs(c.zc) >= P.gap) minFloor = Math.min(minFloor, lo[1] - P.floorTop);
        const seen = new Set();
        for (let i = Math.floor(lo[0] / cs); i <= Math.floor(hi[0] / cs); i++) for (let j = Math.floor(lo[2] / cs); j <= Math.floor(hi[2] / cs); j++) for (const idx of grid.get(i * 100000 + j) || []) { if (seen.has(idx)) continue; seen.add(idx); const e = B[idx]; if (!live(e.a, t)) continue;
          if (e.a.stage === 'jig' && e.a.zone === c.grp && ps[c.grp].dy + HZ.D < 0.4) continue;   // 脱胎（提离 0.4 m）前允许与本区胎架贴合；之后（含 0.6 m 脱胎完成）严格不碰
          if (segBox(a, b, e.b, r - 0.05)) { lc++; if (lex.length < 6) lex.push(S.name + ' × ' + e.a.name + ' @' + t.toFixed(1)); } } } } }
  // 分区之间（旋转时内边不得碰中区）
  out.liftClash = lc; out.liftEx = lex; out.liftSamples = samples; out.minFloorGap = +minFloor.toFixed(2);
  // A4 临时构件：全部拆除、拆除不早于服务对象完成
  out.temp = out.net.r4;
  out.r8bad = HZ.r8bad.slice(); out.zero = out.net.zero && !HZ.r8bad.length && !unsup && !clip && !lc && out.temp.violations === 0 && out.temp.leftover === 0;
  out.ms = Date.now() - T0;
  return out;
};

// 线段（半径 r）与包围盒相交：盒子外扩 r，按 slab 法裁剪线段
function segBox(a, b, bx, r) { let t0 = 0, t1 = 1; for (let k = 0; k < 3; k++) { const d = b[k] - a[k], lo = bx.min[k] - r, hi = bx.max[k] + r;
    if (Math.abs(d) < 1e-9) { if (a[k] < lo || a[k] > hi) return false; continue; } let u0 = (lo - a[k]) / d, u1 = (hi - a[k]) / d; if (u0 > u1) { const x = u0; u0 = u1; u1 = x; } t0 = Math.max(t0, u0); t1 = Math.min(t1, u1); if (t0 > t1) return false; } return true; }
HZ.segBox = segBox;
// 阶段字幕：当前正在进行的最“醒目”的活动
HZ.PRI = { open: 100, wlift: 95, lift: 90, merge: 85, head: 80, asm: 70, rig: 68, clad: 66, sky: 65, pv: 64, ym: 60, tod: 58, mast: 55, floor: 50, col24: 48, canopy: 46, deck: 44, plat: 42, track: 40, frame: 38, mezz: 36, pier: 34, found: 30, ymf: 29, ymc: 28, ring: 27, holes: 26, unrig: 25, jig: 24, unjig: 22, crane: 10, uncrane: 9 };
HZ.caption = function (t) { let best = null, bp = -1; for (const a of HZ.acts) { if (a.kind === 'milestone') continue; if (t >= a.start && t < a.end) { const p = HZ.PRI[a.stage] || 1; if (p > bp) { bp = p; best = a; } } }
  if (t >= HZ.K.open.start) return { text: HZ.K.open.cap, act: HZ.K.open };
  if (!best) { let last = null; for (const a of HZ.acts) if (a.end <= t && (!last || a.end > last.end) && a.kind !== 'milestone') last = a; best = last; }
  return { text: best ? (best.cap || best.name) : '', act: best }; };

G.HZ = HZ;
if (typeof module !== 'undefined') module.exports = HZ;
})(typeof window !== 'undefined' ? window : globalThis);
