'use strict';
// ===== 码头小样（proto-port1）领域插件：假想集装箱码头的构件族 + 规则参数 + 单价/效率（全部为行业经验区间，标「推算」）=====
// 只产出 活动（几何 + 名称/阶段/资源/工程量/单价）与规则参数；依赖、排程、关键路径、蒙特卡洛、审计全部由 core/seq.js 的通用网络层推出。
// 坐标（米）：x 沿岸线（泊位 b 占 [(nb−1−b)·350, (nb−b)·350]，从海上看 1# 在左），y 上（±0 = 设计低水位），z 向陆（z<0 海侧港池，0–40 高桩码头，40–540 吹填堆场，>560 后方陆域）。
(function (G) {
const SEQ = G.SEQ, BB = SEQ.BB;
const DAY = 864e5, MON = 30.44;

// ---------- 假设表（推算）：效率、单价、区间。UI 的「假设」页逐条列出 ----------
const A = {
  berthL: 350, depth: -16, seabed: -7, deckY: 5.0, basinZ: 520, deckW: 40, yardZ: [40, 540],
  segL: 50, bentDx: 50 / 7, pileZ: [3, 10, 17, 24, 31, 37], pileD: 1.2, pileT: 0.022, pileToe: -40,
  blocksPerBerth: 8, armgPerBlock: 1,
  // 效率（每台船机 / 每个班组 每日）
  dredgeRate: 30000, fillRate: 25000, rockRate: 1500, pileRate: 8, beamRate: 120, deckRate: 200, pvdRate: 6000, surRate: 15000, cfgRate: 1200, paveRate: 3000, railRate: 150, stsRailRate: 100,
  stsInst: 12, armgInst: 6, cure: [120, 150, 210], stsMfg: [330, 365, 450], stsShip: [30, 40, 55], armgMfg: [240, 270, 330], armgShip: [20, 30, 45], commission: [20, 30, 60],
  bldg: { gate: 210, ctrl: 300, shop: 240, sub: 270, shore: 45 },
  permit: 30,
  // 单价（元）
  cDredge: 32, cFill: 28, cRock: 180, cSteel: 9000, cConc: 1800, cVac: 160, cCfg: 620, cPave: 420, cRail: 2000, cStsRail: 3000,
  cSts: 1.05e8, cArmg: 0.32e8, cBldg: { gate: 0.6e8, ctrl: 1.0e8, shop: 0.5e8, sub: 1.6e8, shore: 0.35e8 }, cMob: 0.08e8,
  mgmtDay: 8e4, other: 0.08, contingency: 0.05, esc: 0.03, debt: 0.6, rate: 0.045,
  // 运营（收入线）
  movesH: 30, teuMove: 1.5, hoursY: 6500, util: 0.65, teuRev: 420, ebitda: 0.55, ramp: [0.4, 0.9, 3],
  // 蒙特卡洛：按类相关的三角分布系数（乐观 / 典型 / 悲观）+ 活动级小扰动
  mc: { marine: [0.9, 1, 1.35], pile: [0.85, 1, 1.4], soil: [0.9, 1, 1.25], land: [0.9, 1, 1.2], equip: [0.95, 1, 1.15], jit: [0.95, 1, 1.08] },
  fleetTypes: ['挖泥船', '打桩船', '起重船'],
  caps: { land: 4, inst: 2, stsLine: 12 },
};
const ASSUME = [
  ['港池/航道疏浚', '绞吸挖泥船 30 000 m³/日·艘', '32 元/m³', '20–45 元/m³'],
  ['吹填造陆', '25 000 m³/日·艘（同一挖泥船队）', '28 元/m³', '20–40 元/m³'],
  ['斜坡护岸', '抛石 1 500 m³/日（起重船）', '180 元/m³', '120–260 元/m³'],
  ['钢管桩 Φ1.2 m×22 mm', '8 根/日·打桩船', '9 000 元/t（含沉桩）', '7 000–11 000 元/t'],
  ['横梁 / 面板（预制+现浇）', '120 / 200 m³/日·起重船', '1 800 元/m³', '1 400–2 400 元/m³'],
  ['软基：真空+堆载预压', '插板 6 000 m²/日·班组，堆载 4 m，满期 120/150/210 日', '160 元/m²', '120–220 元/m²'],
  ['软基：复合桩基+换填', '1 200 m²/日·班组，无养护期', '620 元/m²', '450–800 元/m²'],
  ['堆场道路排水+面层', '3 000 m²/日·班组', '420 元/m²', '300–550 元/m²'],
  ['岸桥（STS）', '制造 330/365/450 日 + 整机海运 30/40/55 日，安装 12 日/台；厂家为本项目同时排产 ≤ 12 台', '1.05 亿元/台', '0.8–1.3 亿元'],
  ['场桥（ARMG）', '制造 240/270/330 日 + 运输，安装 6 日/台；每箱区 1 台、每泊位 8 箱区', '0.32 亿元/台', '0.25–0.4 亿元'],
  ['闸口 / 控制楼 / 维修车间 / 变电站', '210 / 300 / 240 / 270 日', '0.6 / 1.0 / 0.5 / 1.6 亿元', '±30%'],
  ['岸电（每泊位）', '45 日', '0.35 亿元', '0.2–0.5 亿元'],
  ['船机进退场', '每期每艘', '0.08 亿元', '0.05–0.15 亿元'],
  ['现场管理费', '施工期每日', '8 万元/日', '5–12 万元/日'],
  ['其他费用 / 预备费', '设计、监理、建设管理 / 基本预备', '8% / 5%', '6–10% / 3–8%'],
  ['价格上涨', '按开工日起逐年', '3%/年', '2–5%/年'],
  ['建设期利息', '贷款比例 60%，年利率 4.5%', '按累计支出逐日计', '3.5–5.5%'],
  ['设计吞吐', '岸桥 30 自然箱/时 × 1.5 TEU/箱 × 6 500 时/年 × 利用率 65%', '≈ 19.0 万 TEU/台·年', '15–25 万'],
  ['收入', '420 元/TEU，EBITDA 率 55%；投产当年负荷 40% → 3 年后 90%', '—', '350–500 元/TEU'],
  ['班组规模（换算工人·日）', '挖泥船 25 人 · 打桩船 30 · 起重船 25 · 陆上班组 60 · 安装队 20；罐车 8 m³/车、自卸车 20 m³/车', '—', '±30%'],
  ['分期规则', '下期开工（含下期设备订货）= 上期首泊位投产；与已投产泊位作业区 / 航道相交的下期接口工程前置到该泊位投产前', '—', '可改：提前订货'],
  ['工期不确定性', '海上 0.9/1/1.35 · 沉桩 0.85/1/1.4 · 软基 0.9/1/1.25 · 陆上 0.9/1/1.2 · 设备 0.95/1/1.15（按类相关）× 活动 0.95/1/1.08', '蒙特卡洛 500 次', '三角分布'],
];

const COL = { seabed: [0.66, 0.6, 0.48], fill: [0.8, 0.72, 0.54], rock: [0.55, 0.55, 0.53], steel: [0.33, 0.36, 0.4], conc: [0.74, 0.73, 0.7], pave: [0.6, 0.6, 0.6], pvd: [0.72, 0.66, 0.5], sur: [0.67, 0.55, 0.4], cfg: [0.62, 0.6, 0.55], rail: [0.22, 0.22, 0.22], sts: [0.27, 0.38, 0.52], armg: [0.42, 0.5, 0.4], bldg: [0.82, 0.8, 0.74], power: [0.7, 0.6, 0.35], trestle: [0.56, 0.42, 0.26] };
const fmtB = b => (b + 1) + '#';

// ---------- 生成一个方案：参数 → 活动（几何 + 工程量 + 资源 + 单价）----------
// p: {berths, sts, found:'vac'|'pile', phases, fleet, start:'YYYY-MM-DD', x0(场景偏移)}
function build(p) {
  const nb = p.berths, L = A.berthL, ox = p.x0 || 0, acts = [], add = o => { const a = SEQ.act(o); acts.push(a); return a; };
  const phaseOf = b => Math.min(p.phases, Math.floor(b * p.phases / nb) + 1);
  const g = col => new SEQ.Geo(col);
  const X = b => ox + (nb - 1 - b) * L;                 // 从海上看（视线朝 +z）1# 在左
  const fleet = p.fleet;
  // 0. 开工准备 / 海域与施工许可（风险图钉）
  const permit = add({ key: 'permit', name: '施工许可 · 进场准备', stage: 'prep', kind: 'wait', dur: A.permit, mc: 'land', phase: 1, cost: 0 });
  // 1. 航道（一期全部完成，各期共用）
  const W = nb * L, cx = ox + W / 2;
  { const q = g(COL.seabed); q.box(cx - 160, -16, -1400, cx + 160, -10, -A.basinZ, COL.seabed, false); const v = Math.abs(q.vol);
    add({ key: 'chan', name: '进港航道疏浚', stage: 'dredge', kind: 'remove', parts: [{ geo: q, name: '航道' }], dur: v / A.dredgeRate, res: { 挖泥船: 1 }, mc: 'marine', phase: 1, cost: v * A.cDredge, qty: { 疏浚: v }, tally: { dredge: Math.round(v) }, excl: 'dredge', envGrow: 40 }); }
  for (let b = 0; b < nb; b++) {
    const ph = phaseOf(b), x0 = X(b), x1 = x0 + L, u = { unit: b, phase: ph };
    // 2. 港池疏浚：近岸段 / 远段
    [[-260, 0, '近岸段'], [-A.basinZ, -260, '外段']].forEach(([z0, z1, nm], k) => { const q = g(COL.seabed); q.box(x0, A.depth, z0, x1, A.seabed, z1, COL.seabed, false); const v = Math.abs(q.vol);
      add(Object.assign({ key: 'dr' + b + k, name: fmtB(b) + ' 港池疏浚 ' + nm, stage: 'dredge', kind: 'remove', parts: [{ geo: q }], dur: v / A.dredgeRate, res: { 挖泥船: 1 }, mc: 'marine', cost: v * A.cDredge, qty: { 疏浚: v }, tally: { dredge: Math.round(v) }, excl: 'dredge', envGrow: 40, scope: 'b' + b }, u)); });
    // 2b. 施工栈桥（临时，R4：服务本泊位 钢管桩 / 横梁 / 面板，完成后拆除）
    { const q = g(COL.trestle), probes = [];
      q.box(x0 + 10, 3.0, -16, x1 - 10, 4.2, -8, COL.trestle);
      for (let xx = x0 + 15; xx <= x1 - 15; xx += 25) for (const z of [-14, -10]) { q.prism([xx, A.depth - 0.5, z], [xx, 3.0, z], 0.4, 6, COL.trestle, 'axis'); probes.push([[xx, A.depth + 1, z], [xx, 2.6, z], 0.45]); }
      probes.push([[x0 + 10, 3.6, -12], [x1 - 10, 3.6, -12], 0.5]);
      add(Object.assign({ key: 'ts' + b, name: fmtB(b) + ' 施工栈桥', stage: 'trestle', kind: 'temp', parts: [{ geo: q, probes, name: fmtB(b) + ' 施工栈桥' }], dur: 20, res: { 起重船: 1 }, mc: 'marine', cost: (x1 - x0 - 20) * 8 * 2500, qty: {}, scope: 'b' + b,
        temp: { serves: ['pile', 'beam', 'deck'], removeStage: 'untrestle', removeName: fmtB(b) + ' 施工栈桥 拆除', removeDur: 10, removeRes: { 起重船: 1 } } }, u)); }
    // 3. 护岸（码头后沿斜坡堤）
    { const q = g(COL.rock); q.hexa([[x0, A.seabed, 22], [x1, A.seabed, 22], [x1, A.seabed, 42], [x0, A.seabed, 42], [x0, 4.0, 30], [x1, 4.0, 30], [x1, 4.0, 40], [x0, 4.0, 40]], COL.rock); const v = Math.abs(q.vol);
      add(Object.assign({ key: 'rv' + b, name: fmtB(b) + ' 斜坡护岸', stage: 'revet', parts: [{ geo: q }], dur: v / A.rockRate, res: { 起重船: 1 }, mc: 'marine', cost: v * A.cRock, qty: { 抛石: v }, excl: 'barge', envGrow: 20, scope: 'b' + b }, u)); }
    // 4. 吹填造陆：两个区块（前方 / 后方堆场）
    const zones = [[A.yardZ[0], 290], [290, A.yardZ[1]]];
    zones.forEach(([z0, z1], k) => { const q = g(COL.fill); q.box(x0, A.seabed, z0, x1, 4.0, z1, COL.fill); const v = Math.abs(q.vol);
      add(Object.assign({ key: 'fl' + b + k, name: fmtB(b) + ' 吹填 ' + (k ? '后方' : '前方') + '区块', stage: 'fill', kind: 'fill', parts: [{ geo: q }], dur: v / A.fillRate, res: { 挖泥船: 1 }, mc: 'marine', cost: v * A.cFill, qty: { 吹填: v }, tally: { fill: Math.round(v) }, scope: 'b' + b + 'z' + k }, u)); });
    // 5. 地基处理
    zones.forEach(([z0, z1], k) => { const sc = 'b' + b + 'z' + k, area = (x1 - x0) * (z1 - z0), zn = fmtB(b) + (k ? ' 后方' : ' 前方');
      if (p.found === 'vac') {
        const q = g(COL.pvd); q.box(x0, 4.0, z0, x1, 4.5, z1, COL.pvd, false);
        add(Object.assign({ key: 'pv' + b + k, name: zn + ' 砂垫层+插板', stage: 'pvd', parts: [{ geo: q }], dur: area / A.pvdRate, res: { land: 1 }, mc: 'land', cost: area * A.cVac * 0.45, qty: { 插板面积: area }, scope: sc }, u));
        const s = g(COL.sur); s.hexa([[x0 + 8, 4.5, z0 + 8], [x1 - 8, 4.5, z0 + 8], [x1 - 8, 4.5, z1 - 8], [x0 + 8, 4.5, z1 - 8], [x0 + 20, 8.5, z0 + 20], [x1 - 20, 8.5, z0 + 20], [x1 - 20, 8.5, z1 - 20], [x0 + 20, 8.5, z1 - 20]], COL.sur); const v = Math.abs(s.vol);
        add(Object.assign({ key: 'sr' + b + k, name: zn + ' 堆载预压', stage: 'preload', kind: 'temp', parts: [{ geo: s }], dur: v / A.surRate, res: { land: 1 }, mc: 'land', cost: area * A.cVac * 0.55, qty: { 堆载: v }, scope: sc, cure: A.cure[1], cureR: A.cure,
          temp: { serves: [], removeStage: 'unload', removeName: zn + ' 卸载（预压满期）', removeDur: 12, removeRes: { land: 1 } } }, u));
      } else {
        const q = g(COL.cfg); q.box(x0, 4.0, z0, x1, 4.5, z1, COL.cfg, false);
        add(Object.assign({ key: 'cf' + b + k, name: zn + ' 复合桩基+换填', stage: 'pvd', parts: [{ geo: q }], dur: area / A.cfgRate, res: { land: 1 }, mc: 'soil', cost: area * A.cCfg, qty: { 桩基面积: area }, tally: { cfg: Math.round(area / 6.25) }, scope: sc }, u));
      }
      // 6. 堆场道路排水 + 面层
      const q = g(COL.pave); q.box(x0, 4.5, z0, x1, 5.0, z1, COL.pave);
      add(Object.assign({ key: 'pa' + b + k, name: zn + ' 道路排水+面层', stage: 'pave', parts: [{ geo: q }], dur: area / A.paveRate, res: { land: 1 }, mc: 'land', cost: area * A.cPave, qty: { 面层: area }, scope: sc }, u));
      // 7. 箱区轨道 + 场桥（每区块 4 箱区）
      const nbk = A.blocksPerBerth / 2, r = g(COL.rail), am = g(COL.armg); let railM = 0;
      for (let i = 0; i < nbk; i++) { const bx0 = x0 + 12 + i * (L - 24) / nbk, bx1 = bx0 + (L - 24) / nbk - 14;
        for (const xr of [bx0, bx1]) { r.box(xr, 5.0, z0 + 15, xr + 0.6, 5.2, z1 - 15, COL.rail, false); railM += z1 - z0 - 30; }
        const zc = z0 + 20 + ((i * 53) % Math.max(1, (z1 - z0 - 60)));
        for (const xr of [bx0, bx1 - 0.6]) { am.box(xr, 5.2, zc, xr + 1.2, 27, zc + 1.2, COL.armg); am.box(xr, 5.2, zc + 14, xr + 1.2, 27, zc + 15.2, COL.armg); }
        am.box(bx0, 27, zc, bx1 + 0.6, 29, zc + 15.2, COL.armg); }
      add(Object.assign({ key: 'yr' + b + k, name: zn + ' 箱区轨道', stage: 'yrail', parts: [{ geo: r }], dur: railM / A.railRate, res: { land: 1 }, mc: 'land', cost: railM * A.cRail, qty: { 轨道: railM }, scope: sc }, u));
      add(Object.assign({ key: 'am' + b + k, name: zn + ' 场桥 ARMG ×' + nbk, stage: 'armg', parts: [{ geo: am }], dur: nbk * A.armgInst, res: { inst: 1 }, mc: 'equip', cost: 0, eqCost: nbk * A.cArmg, n: nbk, tally: { armg: nbk }, scope: sc }, u));
    });
    // 8. 高桩码头：7 段 × 7 排架 × 6 根钢管桩 → 横梁 → 面板
    const nseg = Math.round(L / A.segL);
    for (let s = 0; s < nseg; s++) {
      const sx0 = x0 + s * A.segL, sx1 = sx0 + A.segL, pg = g(COL.steel), bg = g(COL.conc), dg = g(COL.conc); let np = 0, steel = 0;
      for (let k = 0; k < 7; k++) { const xb = sx0 + (k + 0.5) * A.bentDx;
        for (const z of A.pileZ) { pg.prism([xb, A.pileToe, z], [xb, 3.0, z], A.pileD / 2, 6, COL.steel, false); np++; steel += Math.PI * A.pileD * A.pileT * (3.0 - A.pileToe) * 7.85; }
        bg.box(xb - 0.7, 3.0, 0, xb + 0.7, 4.4, A.deckW, COL.conc); }
      dg.box(sx0, 4.4, 0, sx1, 5.0, A.deckW, COL.conc);
      const vb = Math.abs(bg.vol), vd = Math.abs(dg.vol), nm = fmtB(b) + ' 码头第 ' + (s + 1) + ' 段';
      add(Object.assign({ key: 'pl' + b + s, name: nm + ' 钢管桩', stage: 'pile', parts: [{ geo: pg }], dur: np / A.pileRate, res: { 打桩船: 1 }, mc: 'pile', cost: steel * A.cSteel, qty: { 钢材: steel }, tally: { pile: np }, excl: 'pile', envGrow: 30, scope: 'b' + b }, u));
      add(Object.assign({ key: 'bm' + b + s, name: nm + ' 横梁', stage: 'beam', parts: [{ geo: bg }], dur: vb / A.beamRate, res: { 起重船: 1 }, mc: 'marine', cost: vb * A.cConc, qty: { 混凝土: vb }, excl: 'barge', envGrow: 30, scope: 'b' + b }, u));
      add(Object.assign({ key: 'dk' + b + s, name: nm + ' 面板', stage: 'deck', parts: [{ geo: dg }], dur: vd / A.deckRate, res: { 起重船: 1 }, mc: 'marine', cost: vd * A.cConc, qty: { 混凝土: vd }, excl: 'barge', envGrow: 30, scope: 'b' + b }, u));
    }
    // 9. 岸桥轨道 → 岸桥（采购 R6 → 整机上岸安装）；岸电
    { const r = g(COL.rail); r.box(x0, 5.0, 2.6, x1, 5.2, 3.4, COL.rail, false); r.box(x0, 5.0, 32.6, x1, 5.2, 33.4, COL.rail, false);
      add(Object.assign({ key: 'sr_' + b, name: fmtB(b) + ' 岸桥轨道', stage: 'srail', parts: [{ geo: r }], dur: 2 * L / A.stsRailRate, res: { land: 1 }, mc: 'land', cost: 2 * L * A.cStsRail, qty: { 轨道: 2 * L }, scope: 'b' + b }, u)); }
    { const c = g(COL.sts); for (let k = 0; k < p.sts; k++) { const xc = x0 + L * (k + 0.5) / p.sts;
        for (const dx of [-9, 8]) for (const z of [2.4, 32.4]) c.box(xc + dx, 5.2, z, xc + dx + 1.2, 46, z + 1.2, COL.sts);
        c.box(xc - 9, 44, 2.4, xc + 9.2, 47, 33.6, COL.sts); c.box(xc - 2, 47, -58, xc + 2, 50, 50, COL.sts); c.box(xc - 5, 50, 20, xc + 5, 55, 30, COL.sts); }
      add(Object.assign({ key: 'st' + b, name: fmtB(b) + ' 岸桥 STS ×' + p.sts, stage: 'sts', parts: [{ geo: c }], dur: p.sts * A.stsInst, res: { inst: 1 }, mc: 'equip', cost: 0, eqCost: p.sts * A.cSts, n: p.sts, tally: { sts: p.sts }, excl: 'lift', envGrow: 25, scope: 'b' + b }, u)); }
    { const q = g(COL.power); q.box(x0 + L / 2 - 6, 5.0, 36, x0 + L / 2 + 6, 8.0, 39.5, COL.power);
      add(Object.assign({ key: 'sh' + b, name: fmtB(b) + ' 岸电', stage: 'power', parts: [{ geo: q }], dur: A.bldg.shore, res: { land: 1 }, mc: 'land', cost: A.cBldg.shore, scope: 'b' + b }, u)); }
    // 10. 联调试运行 → 投产（里程碑）
    add(Object.assign({ key: 'cm' + b, name: fmtB(b) + ' 联调试运行', stage: 'comm', kind: 'wait', dur: A.commission[1], mc: 'equip', cost: 0, scope: 'b' + b }, u));
    add(Object.assign({ key: 'live' + b, name: fmtB(b) + ' 泊位投产', stage: 'live', kind: 'milestone', dur: 0, cost: 0, scope: 'b' + b, berth: b }, u));
  }
  // 11. 后方陆域建筑 + 变电站（一期）
  const bz = 575, bl = [['gate', '闸口', 0.18, 60, 10], ['ctrl', '生产控制楼', 0.42, 40, 32], ['shop', '维修车间', 0.62, 70, 14], ['sub', '110 kV 变电站', 0.82, 45, 12]];
  for (const [k, nm, fx, w, h] of bl) { const q = g(k === 'sub' ? COL.power : COL.bldg), xc = ox + W - Math.min(W, 2 * L) * fx; q.box(xc - w / 2, 5.0, bz, xc + w / 2, 5.0 + h, bz + 40, k === 'sub' ? COL.power : COL.bldg);
    add({ key: k, name: nm, stage: k === 'sub' ? 'grid' : 'bldg', parts: [{ geo: q }], dur: A.bldg[k], res: { land: 1 }, mc: 'land', cost: A.cBldg[k], phase: 1, scope: 'land' }); }
  // 船机进退场费：每期每艘（记在该期第一个海上活动上）
  for (let ph = 1; ph <= p.phases; ph++) { const f = acts.find(a => a.phase === ph && (a.stage === 'dredge' || a.stage === 'revet')); if (f) f.cost += A.cMob * fleet * 3; }
  for (const a of acts) { if (a.envGrow && a.bb) a.env = BB.grow(a.bb, a.envGrow); a.dur0 = a.dur; }

  // ---------- 规则（通用规则类型 + 本领域参数）----------
  const units = Array.from({ length: nb }, (_, b) => ({ b, name: fmtB(b) + ' 泊位', phase: phaseOf(b), zone: { min: [X(b), -50, -A.basinZ], max: [X(b) + L, 60, 560] } }));
  const liveOf = (u, as) => as.find(a => a.key === 'live' + u.b);
  const R7 = { type: 'phase', id: 'R7', units: () => units, zone: u => u.zone, live: liveOf, margin: -1 };
  const rules = [
    { type: 'temp', id: 'R4' },
    { type: 'support', id: 'R1', on: { beam: ['pile'], deck: ['beam'], srail: ['deck'], sts: ['srail'], power: ['deck'], pvd: ['fill'], preload: ['pvd'], pave: ['pvd'], yrail: ['pave'], armg: ['yrail'] }, tol: 0.05, minOverlap: 1 },
    { type: 'dig', id: 'R2', to: ['pile', 'revet', 'fill', 'trestle'], e: 5 },
    { type: 'after', id: 'R3', to: 'sts', from: 'untrestle', scope: 'unit' },
    { type: 'after', id: 'R3', to: 'fill', from: 'revet', scope: 'unit' },
    { type: 'after', id: 'R3', to: 'pave', from: 'unload', scope: 'same' },
    { type: 'after', id: 'R3', to: 'comm', from: ['sts', 'armg', 'power', 'dredge'], scope: 'unit' },
    { type: 'after', id: 'R3', to: 'comm', from: a => ['gate', 'ctrl', 'sub', 'chan'].includes(a.key), scope: 'any' },
    { type: 'after', id: 'R3', to: 'live', from: 'comm', scope: 'unit' },
    { type: 'after', id: 'R3', to: 'power', from: a => a.key === 'sub', scope: 'any' },
    { type: 'cure', id: 'cure', from: 'preload', to: 'unload', scope: 'same', lag: a => a.cure },
    { type: 'procure', id: 'R6', stage: 'sts', name: '订货·制造·海运', procStage: 'buy',
      lead: B => ({ days: A.stsMfg[1] + A.stsShip[1], res: { stsLine: B.n }, cost: B.eqCost, mc: 'equipL', mfg: A.stsMfg, ship: A.stsShip }) },
    { type: 'procure', id: 'R6', stage: 'armg', name: '订货·制造·运输', procStage: 'buy',
      lead: B => ({ days: A.armgMfg[1] + A.armgShip[1], cost: B.eqCost, mc: 'equipL', mfg: A.armgMfg, ship: A.armgShip }) },
    R7,
    { type: 'custom', id: 'gate', fn: (as, link) => {           // 许可闸门 + 分期闸门（下期开工 = 上期首泊位投产；R7 接口工程及其前驱豁免，提前做）
      let n = 0; const ifc = new Set(R7.pairs.map(x => x[0])), st = [...ifc];
      while (st.length) { const a = st.pop(); for (const e of a.pred) if (e.a.phase > 1 && !ifc.has(e.a) && e.a.kind !== 'milestone') { ifc.add(e.a); st.push(e.a); } }
      for (const a of as) { if (a === permit) continue; a.iface = ifc.has(a);
        if (!a.pred.length || a.kind === 'procure') n += link(a, permit, 'gate');
        if (a.phase > 1 && !a.iface) { const prevFirst = units.find(u => u.phase === a.phase - 1); const lv = prevFirst && liveOf(prevFirst, as); if (lv) n += link(a, lv, 'gate'); } }
      return n; } },
  ];
  // 堆载：temp.serves 为空 —— 它只为“满期”服务（由 cure 规则约束），R4 只自检搭/拆与残留；施工栈桥服务 桩/梁/板
  const counts = SEQ.derive(acts, rules);
  for (const a of acts) { if (a.kind === 'procure') { a.dur0 = a.dur; a.mc = 'equipL'; } if (a.kind === 'untemp') a.dur0 = a.dur; }
  const caps = { 挖泥船: fleet, 打桩船: fleet, 起重船: fleet, land: A.caps.land, inst: A.caps.inst, stsLine: A.caps.stsLine };
  const excl = [['lift', 'pile', 0], ['lift', 'barge', 0], ['dredge', 'pile', 0], ['dredge', 'barge', 0]];
  const pri = (a, LS) => LS + (a.unit != null ? a.unit * 20 : 0);
  return { p, acts, rules, counts, caps, excl, pri, units, R7, cureRule: rules.find(r => r.type === 'cure'), t0: new Date(p.start + 'T00:00:00'), nb, x0: ox, W };
}

// ---------- 工程量（全部从几何量出）→ 船机·日 / 车次 / 工人·日 ----------
const CREW = { 挖泥船: 25, 打桩船: 30, 起重船: 25, land: 60, inst: 20 };
function quantities(M) {
  const q = { dredge: 0, fill: 0, rock: 0, piles: 0, steel: 0, conc: 0, pave: 0, ground: 0, sur: 0, sts: 0, armg: 0, rd: {}, workerDays: 0 };
  for (const a of M.acts) {
    q.dredge += a.qty.疏浚 || 0; q.fill += a.qty.吹填 || 0; q.rock += a.qty.抛石 || 0; q.piles += a.tally.pile || 0; q.steel += a.qty.钢材 || 0; q.conc += a.qty.混凝土 || 0;
    q.pave += a.qty.面层 || 0; q.ground += (a.qty.插板面积 || 0) + (a.qty.桩基面积 || 0); q.sur += a.qty.堆载 || 0; q.sts += a.tally.sts || 0; q.armg += a.tally.armg || 0;
    if (a.kind === 'procure') continue;
    for (const r in a.res) { q.rd[r] = (q.rd[r] || 0) + a.res[r] * a.dur; q.workerDays += a.res[r] * a.dur * (CREW[r] || 0); }
  }
  q.mixer = Math.ceil(q.conc / 8); q.dump = Math.ceil(q.sur * 2 / 20);       // 罐车次；堆载土方 进 + 出 自卸车次
  return q;
}

// ---------- 排程 + 指标 ----------
function schedule(M, durFn, lagFn, write) { return SEQ.schedule(M.acts, { caps: M.caps, excl: M.excl, pri: M.pri, dur: durFn || (a => a.dur0), lag: lagFn, write }); }
// 指标：工期、投产、投资（含上涨、管理费、其他、预备、建设期利息）、吞吐、收入、回收
function metrics(M, S, E) {
  const acts = M.acts, n = acts.length; let total = 0; for (let i = 0; i < n; i++) total = Math.max(total, E[i]);
  const lives = []; for (let i = 0; i < n; i++) if (acts[i].kind === 'milestone') lives.push({ b: acts[i].berth, t: E[i] });
  lives.sort((a, b) => a.t - b.t);
  const esc = t => Math.pow(1 + A.esc, t / 365);
  const spend = []; let direct = 0;
  for (let i = 0; i < n; i++) { const a = acts[i]; if (!a.cost) continue; const c = a.cost * esc(S[i]); direct += c; spend.push([S[i], Math.max(1, E[i] - S[i]), c]); }
  const mgmt = A.mgmtDay * total, other = direct * A.other, cont = (direct + other) * A.contingency;
  // 逐日累计支出 → 建设期利息（到全部投产为止）
  const day = new Float64Array(total + 2);
  for (const [s, d, c] of spend) { const r = c / d; for (let t = s; t < s + d && t <= total; t++) day[t] += r; }
  let cum = 0, idc = 0; const fixedDay = (mgmt + other + cont) / (total + 1);
  const cumAt = new Float64Array(total + 2);                                  // 累计投资（含建设期利息），cumAt[total] = 总投资
  for (let t = 0; t <= total; t++) { cum += day[t] + fixedDay; idc += cum * A.debt * A.rate / 365; cumAt[t] = cum + idc; }
  cumAt[total + 1] = cumAt[total];
  const invest = direct + mgmt + other + cont + idc;
  const teuCrane = A.movesH * A.teuMove * A.hoursY * A.util, design = M.p.sts * M.nb * teuCrane;
  const first = lives.length ? lives[0].t : NaN;
  const preFirst = cumAt[Math.min(first, total)];
  return { total, first, lives, direct, mgmt, other, cont, idc, invest, design, teuCrane, preFirst, cumAt };
}
// 收入（累计，元）：每个泊位投产后按负荷爬坡（投产 40% → 3 年后 90%）
function revenueCum(M, lives, t) {
  const cap = M.p.sts * A.movesH * A.teuMove * A.hoursY * A.util; let r = 0; const [l0, l1, yrs] = A.ramp, D = yrs * 365;
  for (const lv of lives) { const x = t - lv.t; if (x <= 0) continue; const xa = Math.min(x, D); r += cap * A.teuRev / 365 * (l0 * xa + (l1 - l0) * xa * xa / (2 * D)) + (x > D ? cap * A.teuRev / 365 * l1 * (x - D) : 0); }
  return r;
}
function payback(M, mt) { let lo = mt.first, hi = mt.first + 365 * 40; if (!(lo >= 0)) return NaN; const f = t => revenueCum(M, mt.lives, t) * A.ebitda >= mt.invest; if (!f(hi)) return NaN; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (f(m)) hi = m; else lo = m; } return hi; }

// ---------- 蒙特卡洛：按类相关系数 × 活动扰动；采购 = 制造 + 运输分别抽样；预压满期按区间抽样 ----------
function mcRun(M, rng) {
  const cls = {}; for (const k of ['marine', 'pile', 'soil', 'land', 'equip']) { const m = A.mc[k]; cls[k] = SEQ.tri(rng(), m[0], m[1], m[2]); }
  const n = M.acts.length, dur = new Float64Array(n), cure = new Map(), J = A.mc.jit;
  for (let i = 0; i < n; i++) { const a = M.acts[i];
    if (a.kind === 'procure') { const L = a.lead; dur[i] = SEQ.tri(rng(), L.mfg[0], L.mfg[1], L.mfg[2]) + SEQ.tri(rng(), L.ship[0], L.ship[1], L.ship[2]); }
    else if (a.kind === 'milestone') dur[i] = 0;
    else if (a.stage === 'comm') dur[i] = SEQ.tri(rng(), A.commission[0], A.commission[1], A.commission[2]);
    else dur[i] = a.dur0 * (cls[a.mc] || 1) * SEQ.tri(rng(), J[0], J[1], J[2]);
    if (a.cureR) cure.set(a, Math.round(SEQ.tri(rng(), a.cureR[0], a.cureR[1], a.cureR[2]))); }
  const R = schedule(M, a => dur[a.ix], (e, b) => e.why === 'cure' ? cure.get(e.a) : e.lag);
  let first = Infinity; for (let i = 0; i < n; i++) if (M.acts[i].kind === 'milestone') first = Math.min(first, R.E[i]);
  return { total: R.total, first };
}

// ---------- 风险图钉：此项延误 90 日 → 重排 → Δ ----------
const RISKS = [
  { id: 'permit', short: '许可批复', name: '海域使用 / 施工许可批复', pick: M => M.acts.filter(a => a.key === 'permit') },
  { id: 'dredge', short: '1# 港池疏浚', name: '1# 港池疏浚（台风季停工）', pick: M => M.acts.filter(a => a.key === 'dr00') },
  { id: 'pile', short: '1# 首段沉桩', name: '1# 首段沉桩（孤石 / 贯入困难）', pick: M => M.acts.filter(a => a.key === 'pl00') },
  { id: 'cure', short: '1# 区块地基', name: '1# 前方区块软基（满期 / 桩基）', pick: M => M.acts.filter(a => a.key === (M.p.found === 'vac' ? 'sr00' : 'cf00')), cure: true },
  { id: 'sts', short: '1# 岸桥到货', name: '1# 岸桥到货（制造 / 海运）', pick: M => M.acts.filter(a => a.key === 'st0~buy') },
  { id: 'sub', short: '变电站送电', name: '110 kV 变电站送电', pick: M => M.acts.filter(a => a.key === 'sub') },
];
function riskDelta(M, base, risk, days) {
  const xs = risk.pick(M); if (!xs.length) return null; const set = new Set(xs), vac = risk.cure && M.p.found === 'vac';
  // 延误分析：冻结基准（每个活动不得早于基准开工日、先后按基准）→ 只许后移，避免串行进度生成法“延误反而提前”的异常
  const R = SEQ.schedule(M.acts, { caps: M.caps, excl: M.excl, rel: a => a.start, pri: a => a.start * 1000 + a.ix * 1e-3, dur: a => a.dur0 + (!vac && set.has(a) ? days : 0), lag: vac ? ((e, b) => e.why === 'cure' && set.has(e.a) ? e.lag + days : e.lag) : null });
  const m = metrics(M, R.S, R.E);
  return { act: xs[0], dTotal: m.total - base.total, dFirst: m.first - base.first, dInvest: m.invest - base.invest, crit: !!xs[0].crit };
}

G.SEQ_PORT = { A, ASSUME, CREW, quantities, build, schedule, metrics, revenueCum, payback, mcRun, RISKS, riskDelta, MON, DAY,
  STAGES: [['prep', '许可准备'], ['dredge', '疏浚'], ['revet', '护岸'], ['fill', '吹填'], ['pvd', '地基处理'], ['preload', '堆载预压'], ['unload', '卸载'], ['pile', '钢管桩'], ['beam', '横梁'], ['deck', '面板'], ['pave', '堆场面层'], ['srail', '岸桥轨道'], ['yrail', '箱区轨道'], ['buy', '设备采购'], ['sts', '岸桥安装'], ['armg', '场桥安装'], ['trestle', '施工栈桥'], ['untrestle', '栈桥拆除'], ['bldg', '建筑'], ['grid', '变电站'], ['power', '岸电'], ['comm', '联调'], ['live', '投产']] };
})(typeof window !== 'undefined' ? window : globalThis);
