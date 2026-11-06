'use strict';
// ===== 大阪城“筑城”小样的构件规格（proto-build1，proto3 加 破風·入母屋 / 足場 / 吊具）：天守台石垣 + 丰臣式天守 + 一座二重櫓 + 一段本丸石垣/内堀 =====
// 只产生构件（几何 + 名称/阶段/材料/计数），顺序与工期全部由 seq.js 的规则推出。
// 天守的层高/出檐/屋根表与 tenshu.js 的 tiers 相同（同一组数），天守台 40×36 → 30×26、高 13 m、扇勾配指数 1.7 也同 tenshu.js。
// 坐标：x 东、y 上、z 南（+z = 内堀一侧），原点 = 天守台底面中心（本丸地面 ±0）。
(function (G) {
const SEQ = G.SEQ;
function build(opt) {
  opt = opt || {};
  let _s = (opt.seed || 11) >>> 0;
  const rand = () => { _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ _s >>> 15, 1 | _s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const R = (a, b) => a + rand() * (b - a);
  const COL = { granite: [0.63, 0.61, 0.57], fill: [0.56, 0.5, 0.42], soil: [0.64, 0.57, 0.44], timber: [0.56, 0.39, 0.23], board: [0.46, 0.33, 0.21], wall: [0.13, 0.12, 0.13], tile: [0.25, 0.28, 0.31], gold: [0.93, 0.71, 0.27], water: [0.32, 0.44, 0.47] };
  const jit = (c, a) => { const k = 1 + R(-a, a); return [c[0] * k, c[1] * k, c[2] * k]; };
  const parts = [];
  const add = p => { parts.push(p); return p; };
  const RULE = { stoneLen: [1.4, 3.2], stoneDepth: 1.3, joint: 0.035, tilePerM2: 1 / (0.27 * 0.21) + 1 / (0.27 * 0.30), boardT: 0.06, colGrid: 3.94 };

  // ---------- 地盘（本丸台地 / 内堀底 / 外岸）----------
  const ZW = 40, H2 = 18, ZB = 37.3, ZM = 92;                                          // 本丸石垣顶线 z=40、高 18 m；石垣背面填土界 z=37.3；外岸脚 z=92
  const zFace = y => ZW + 0.40 * H2 * Math.pow(Math.max(0, -y) / H2, 1.5);           // 扇勾配：顶部近直、底部 0.40×H
  {
    const g = new SEQ.Geo(COL.soil);
    g.box(-80, -20, -60, 80, 0, ZB); g.box(-80, -20, ZB, 80, -18, ZM);
    g.hexa([[-80, -20, ZM], [80, -20, ZM], [80, -20, 112], [-80, -20, 112], [-80, 0, ZM + 4], [80, 0, ZM + 4], [80, 0, 112], [-80, 0, 112]]);
    add({ id: 'site', name: '本丸地盘·縄張り', stage: 'site', mat: 'soil', geo: g, noMass: true, days: 20, spec: '本丸台地 ±0.00 · 内堀底 −18.00 · 外岸 ±0.00（示意地块 160 m 宽）' });
  }
  // ---------- 内堀 掘削（移除类构件：开工前是原状土，挖完消失）----------
  {
    const g = new SEQ.Geo(jit(COL.soil, 0.02));
    g.hexa([[-80, -18, ZB], [80, -18, ZB], [80, -18, ZM], [-80, -18, ZM], [-80, 0, ZB], [80, 0, ZB], [80, 0, ZM + 4], [-80, 0, ZM + 4]]);
    add({ id: 'dig', name: '内堀 掘削', stage: 'dig', kind: 'remove', mat: 'soil', geo: g, tally: 'dig', spec: '堀幅 ≈55 m · 深 18 m · 掘出土方用于本丸盛土' });
  }
  // 一圈“按比例截断”的石头：side 上 [u0,u1]（0..1）× 层 [y0,y1]，face(y,u) 给外皮点，inward 给向内方向
  function lenRun(L) { const out = []; let x = 0; while (x < L) { const l = R(RULE.stoneLen[0], RULE.stoneLen[1]); out.push(l); x += l; } const k = L / x; return out.map(l => l * k); }
  // ---------- 本丸石垣（一段，x −70…70）----------
  const NC2 = 16, h2 = H2 / NC2;
  for (let c = 0; c < NC2; c++) {
    const y0 = -H2 + c * h2, y1 = y0 + h2 - RULE.joint, stones = new SEQ.Geo(COL.granite), fill = new SEQ.Geo(COL.fill);
    const run = lenRun(140); let x = -70, n = 0;
    for (const l of run) {
      stones.setSub(n); const a = x + RULE.joint / 2, b = x + l - RULE.joint / 2, f0 = zFace(y0) + R(-0.05, 0.08), f1 = zFace(y1) + R(-0.05, 0.08), d = RULE.stoneDepth;
      stones.hexa([[a, y0, f0], [b, y0, f0], [b, y0, f0 - d], [a, y0, f0 - d], [a, y1, f1], [b, y1, f1], [b, y1, f1 - d], [a, y1, f1 - d]], jit(COL.granite, 0.1));
      x += l; n++;
    }
    fill.hexa([[-70, y0, ZB], [70, y0, ZB], [70, y0, zFace(y0) - RULE.stoneDepth], [-70, y0, zFace(y0) - RULE.stoneDepth], [-70, y1 + RULE.joint, ZB], [70, y1 + RULE.joint, ZB], [70, y1 + RULE.joint, zFace(y1) - RULE.stoneDepth], [-70, y1 + RULE.joint, zFace(y1) - RULE.stoneDepth]]);
    const g = 'honmaru-c' + c;
    add({ id: g + '-s', group: g, stepName: `本丸石垣 第 ${c + 1} 段`, name: '本丸石垣 筑石', stage: 'ishi', mat: 'granite', geo: stones, tally: 'stone', count: n, rigAt: [24, y1, zFace(y1) - 1.0], spec: `打込接 · 段高 ${h2.toFixed(2)} m · 控 ${RULE.stoneDepth} m · 扇勾配 0.40` });
    add({ id: g + '-f', group: g, name: '本丸石垣 栗石·裏込', stage: 'ishi', mat: 'fill', geo: fill });
  }
  // ---------- 天守台石垣（12 段，40×36 → 30×26，高 13 m）----------
  const BH = 13, NC = 12, hc = BH / NC;
  const Wd = y => 30 + 10 * Math.pow(1 - y / BH, 1.7), Dd = y => 26 + 10 * Math.pow(1 - y / BH, 1.7);
  for (let c = 0; c < NC; c++) {
    const y0 = c * hc, y1 = y0 + hc - RULE.joint, d = RULE.stoneDepth, stones = new SEQ.Geo(COL.granite), fill = new SEQ.Geo(COL.fill);
    let n = 0;
    // 四边：偶数段南北边通长（隅石属南北），奇数段东西边通长 → 算木积み般交错的隅角
    for (let side = 0; side < 4; side++) {
      const along = side % 2 === 0, full = (c % 2 === 0) === along;   // along=南/北边（沿 x）
      const L = along ? (Wd(y0) + Wd(y1)) / 2 : (Dd(y0) + Dd(y1)) / 2;
      const run = lenRun(full ? L : L - 2 * d); let u = 0; const tot = run.reduce((a, b) => a + b, 0);
      for (const l of run) {
        stones.setSub(n);
        const ua = (u + RULE.joint / 2) / tot, ub = (u + l - RULE.joint / 2) / tot, pf = R(-0.05, 0.08);
        const P = (y, uu, inn) => {
          const W = Wd(y) / 2 + pf - inn, D = Dd(y) / 2 + pf - inn;
          const WW = Wd(y) / 2, DD = Dd(y) / 2;
          if (along) { const half = full ? WW : WW - d; const xx = -half + uu * 2 * half; return side === 0 ? [xx, y, D] : [-xx, y, -D]; }
          const half = full ? DD : DD - d; const zz = -half + uu * 2 * half; return side === 1 ? [W, y, -zz] : [-W, y, zz];
        };
        stones.hexa([P(y0, ua, 0), P(y0, ub, 0), P(y0, ub, d), P(y0, ua, d), P(y1, ua, 0), P(y1, ub, 0), P(y1, ub, d), P(y1, ua, d)], jit(COL.granite, 0.1));
        u += l; n++;
      }
    }
    const fy1 = y1 + RULE.joint, w0 = Wd(y0) / 2 - d, d0 = Dd(y0) / 2 - d, w1 = Wd(fy1) / 2 - d, d1 = Dd(fy1) / 2 - d;
    fill.hexa([[-w0, y0, -d0], [w0, y0, -d0], [w0, y0, d0], [-w0, y0, d0], [-w1, fy1, -d1], [w1, fy1, -d1], [w1, fy1, d1], [-w1, fy1, d1]]);
    const g = 'tenshudai-c' + c;
    add({ id: g + '-s', group: g, stepName: `天守台石垣 第 ${c + 1} 段`, name: '天守台 筑石', stage: 'ishi', mat: 'granite', geo: stones, tally: 'stone', count: n, rigAt: [0, y1, Dd(y1) / 2 - 1.0], spec: `野面积 · 段高 ${hc.toFixed(2)} m · 隅角交错 · 外周 ${(2 * (Wd(y0) + Dd(y0))).toFixed(1)} m` });
    add({ id: g + '-f', group: g, name: '天守台 栗石·盛土', stage: 'ishi', mat: 'fill', geo: fill });
  }
  // ---------- 注水（充填类：自下而上）----------
  {
    const g = new SEQ.Geo(COL.water);
    g.box(-80, -18, zFace(-11) - 0.4, 80, -11, ZM + 0.6);
    add({ id: 'water', name: '内堀 注水', stage: 'water', kind: 'fill', mat: 'water', geo: g, noMass: true, spec: '水位 −11.00 · 水深 7 m' });
  }

  // ---------- 破風（几何工具）：局部坐标 lx 沿檐、ly 上、lz 朝外；rot 同 tenshu.js 的 rotForSide ----------
  const SIDE_ROT = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  const LF = (o, rot) => { const c = Math.cos(rot), s = Math.sin(rot); return (lx, ly, lz) => [o[0] + lx * c + lz * s, o[1] + ly, o[2] - lx * s + lz * c]; };
  const vsub = SEQ.v.sub;
  // 屋面板：表面四边形 q（顺序成环），在 y 方向 dy0..dy1 加厚成六面体
  const plate = (g, q, dy0, dy1, col, lines) => { g.hexa([...q.map(p => [p[0], p[1] + dy0, p[2]]), ...q.map(p => [p[0], p[1] + dy1, p[2]])], col, lines); return SEQ.quadArea(...q); };
  const diamond = (g, F, x, y, z, a, b, t) => g.extrude([F(x, y + a, z), F(x + b, y, z), F(x, y - a, z), F(x - b, y, z)], vsub(F(0, 0, t), F(0, 0, 0)), null, 'all');
  // 千鳥破風（tenshu.js chidori 同参数）：H 高、W 宽、L 向屋内延伸；ov 檐出 0.6、前缘 f 0.5
  function chidori(H_, o, rot, W, H, L) {
    const F = LF([o[0], o[1] - 0.15, o[2]], rot), ov = 0.6, f = 0.5;
    const qL = [F(-W / 2 - ov, -0.35, f), F(0, H + 0.25, f), F(0, H + 0.25, -L), F(-W / 2 - ov, -0.35, -L)];
    const qR = [F(0, H + 0.25, f), F(W / 2 + ov, -0.35, f), F(W / 2 + ov, -0.35, -L), F(0, H + 0.25, -L)];
    for (const q of [qL, qR]) { plate(H_.b, q, -0.25, 0, null, true); H_.aT += plate(H_.t, q, 0, 0.12, null, false); }
    H_.t.hexa([F(-0.22, H + 0.3, f + 0.1), F(0.22, H + 0.3, f + 0.1), F(0.22, H + 0.3, -L), F(-0.22, H + 0.3, -L), F(-0.22, H + 0.62, f + 0.1), F(0.22, H + 0.62, f + 0.1), F(0.22, H + 0.62, -L), F(-0.22, H + 0.62, -L)]);   // 破風の棟
    H_.f.extrude([F(-W / 2, 0, 0), F(W / 2, 0, 0), F(0, H, 0)], vsub(F(0, 0, -0.15), F(0, 0, 0)), null, 'all');   // 妻（破風板内の壁）
    const d = vsub(F(0, 0, 0.1), F(0, 0, 0));
    for (const sx of [-1, 1]) { const lo = [sx * (W / 2 + ov), -0.37], hi = [0, H + 0.23], z = f + 0.03;   // 金破風板（前缘两条斜边）
      H_.g.extrude([F(lo[0], lo[1], z), F(hi[0], hi[1], z), F(hi[0], hi[1] - 0.26, z), F(lo[0], lo[1] - 0.26, z)], d, null, 'all'); }
    diamond(H_.g, F, 0, H * 0.58, 0.02, 0.42, 0.3, 0.08);   // 懸魚
    H_.n++; H_.gold += 3; H_.kinds.c++;
  }
  // 唐破風（tenshu.js karahafu 同曲线）：prof(s)，s∈[-1,1]
  function karahafu(H_, o, rot, W, H, L) {
    const F = LF(o, rot), prof = s => { const a = Math.abs(s); return H * (1 - a * a) * (0.75 + 0.25 * Math.cos(a * Math.PI)) + (a > 0.85 ? (a - 0.85) * 2 : 0); }, N = 16;
    for (let i = 0; i < N; i++) { const s0 = -1 + 2 * i / N, s1 = -1 + 2 * (i + 1) / N, x0 = s0 * (W / 2 + 0.5), x1 = s1 * (W / 2 + 0.5), y0 = prof(s0), y1 = prof(s1);
      const q = [F(x0, y0, 0.6), F(x1, y1, 0.6), F(x1, y1, -L), F(x0, y0, -L)];
      plate(H_.b, q, -0.25, 0, null, false); H_.aT += plate(H_.t, q, 0, 0.12, null, false); H_.b.line(q[0], q[1]); H_.b.line(F(x0, y0 - 0.25, 0.6), F(x1, y1 - 0.25, 0.6));
      if (i === 0 || i === N - 1) { const e = i === 0 ? 0 : 1; H_.b.line(q[e], q[3 - e]); }
      const a0 = s0 * W / 2, a1 = s1 * W / 2, t0 = prof(s0) - 0.15, t1 = prof(s1) - 0.15;   // 妻（曲线下的板壁）
      if (Math.max(t0, t1) > -0.3) H_.f.extrude([F(a0, -0.4, 0.2), F(a1, -0.4, 0.2), F(a1, Math.max(-0.35, t1), 0.2), F(a0, Math.max(-0.35, t0), 0.2)], vsub(F(0, 0, -0.12), F(0, 0, 0)), null, false);
      H_.g.extrude([F(x0, y0 - 0.04, 0.63), F(x1, y1 - 0.04, 0.63), F(x1, y1 - 0.3, 0.63), F(x0, y0 - 0.3, 0.63)], vsub(F(0, 0, 0.12), F(0, 0, 0)), null, i === 0 || i === N - 1 ? 'all' : false);   // 金唐破風板
    }
    H_.f.line(F(-W / 2, -0.4, 0.2), F(W / 2, -0.4, 0.2));
    diamond(H_.g, F, 0, H * 0.42, 0.22, 0.32, 0.24, 0.06);
    H_.n++; H_.gold += 2; H_.kinds.k++;
  }
  const newHafu = () => ({ b: new SEQ.Geo(COL.board), f: new SEQ.Geo(COL.wall), t: new SEQ.Geo(COL.tile), g: new SEQ.Geo(COL.gold), aT: 0, n: 0, gold: 0, kinds: { c: 0, k: 0, i: 0 } });

  // ---------- 楼阁语法：天守 / 櫓 共用 ----------
  // tiers 同 tenshu.js：{w,d,v(可见墙高),ov(出檐),rise(屋根升高),up(隅反り),win}；T.gables 同 tenshu.js gabs；T.irimoya 顶层入母屋
  const towerParts = [];
  function tower(T) {
    const { pre, label, cx, cz, base, tiers } = T, X = (x, y, z) => [cx + x, y, cz + z], p0 = parts.length;
    const levels = []; let y = base + 0.3, prevTop = null;
    tiers.forEach((t, i) => { const yTop = y + t.v, floor = i === 0 ? base + 0.3 : prevTop - 0.28; levels.push({ t, i, floor, yTop, eave: yTop - 0.45 }); prevTop = yTop; y = yTop + t.rise; });
    const grid = (w, d) => { const nx = Math.max(2, Math.round(w / RULE.colGrid)), nz = Math.max(2, Math.round(d / RULE.colGrid)), out = []; for (let a = 0; a <= nx; a++) for (let b = 0; b <= nz; b++) out.push([-w / 2 + 0.2 + a * (w - 0.4) / nx, -d / 2 + 0.2 + b * (d - 0.4) / nz]); return { pts: out, nx, nz }; };
    const sc = n => `${pre}-${n}`;
    // 礎石
    {
      const L0 = levels[0], G0 = grid(L0.t.w, L0.t.d), g = new SEQ.Geo(COL.granite);
      G0.pts.forEach((p, k) => { g.setSub(k); g.box(cx + p[0] - 0.35, base, cz + p[1] - 0.35, cx + p[0] + 0.35, base + 0.3, cz + p[1] + 0.35, jit(COL.granite, 0.08)); });
      add({ id: pre + '-soseki', name: label + ' 礎石', stage: 'soseki', mat: 'granite', geo: g, tally: 'stone', count: G0.pts.length, rigAt: [cx, base, cz + L0.t.d / 2 + (base > 0 ? 0.6 : 1.3)], spec: `${G0.pts.length} 个 · 0.70×0.70×0.30 m · 柱网 ${G0.nx}×${G0.nz}` });
    }
    const roofs = [], hGold = new SEQ.Geo(COL.gold); let hGoldN = 0, hafuAll = { c: 0, k: 0, i: 0 };
    levels.forEach(L => {
      const { t, i, floor, yTop } = L, Gd = grid(t.w, t.d), n = i + 1;
      // 柱
      const gc = new SEQ.Geo(COL.timber);
      Gd.pts.slice().sort((a, b) => (a[0] + a[1] * 0.3) - (b[0] + b[1] * 0.3)).forEach((p, k) => { gc.setSub(k); gc.box(cx + p[0] - 0.15, floor, cz + p[1] - 0.15, cx + p[0] + 0.15, yTop - 0.85, cz + p[1] + 0.15, jit(COL.timber, 0.06)); });
      add({ id: `${pre}-col-${n}`, name: `${label} ${n} 重 柱`, stage: 'col', scope: sc(n), mat: 'timber', geo: gc, tally: 'col', count: Gd.pts.length, spec: `通柱 0.30 m 角 · 长 ${(yTop - 0.85 - floor).toFixed(2)} m · 柱间 ${((t.w - 0.4) / Gd.nx).toFixed(2)} m` });
      // 梁 + 上层床
      const gb = new SEQ.Geo(COL.timber); let k = 0;
      const xs = [...new Set(Gd.pts.map(p => p[0].toFixed(3)))].map(Number), zs = [...new Set(Gd.pts.map(p => p[1].toFixed(3)))].map(Number);
      for (const z of zs) { gb.setSub(k++); gb.box(cx - t.w / 2 + 0.05, yTop - 0.85, cz + z - 0.15, cx + t.w / 2 - 0.05, yTop - 0.4, cz + z + 0.15, jit(COL.timber, 0.05)); }
      for (const x of xs) { gb.setSub(k++); gb.box(cx + x - 0.14, yTop - 0.84, cz - t.d / 2 + 0.05, cx + x + 0.14, yTop - 0.41, cz + t.d / 2 - 0.05, jit(COL.timber, 0.05)); }
      if (i < tiers.length - 1) { gb.setSub(k++); gb.box(cx - t.w / 2 + 0.2, yTop - 0.4, cz - t.d / 2 + 0.2, cx + t.w / 2 - 0.2, yTop - 0.28, cz + t.d / 2 - 0.2, COL.board); }
      add({ id: `${pre}-beam-${n}`, name: `${label} ${n} 重 梁·床`, stage: 'beam', scope: sc(n), mat: 'timber', geo: gb, tally: 'beam', count: xs.length + zs.length, spec: `梁 0.30×0.45 m · ${xs.length + zs.length} 根` + (i < tiers.length - 1 ? ` · 床板 ${(t.w - 0.4).toFixed(1)}×${(t.d - 0.4).toFixed(1)} m` : '') });
      // 壁 + 窓（墙 = 分段六面体：窗下、窗上、窗间；窗里 3 根格子）
      const gw = new SEQ.Geo(COL.wall), th = 0.24, vis0 = yTop - t.v, sill = vis0 + Math.max(0.6, 0.32 * t.v), wh = Math.min(1.5, 0.36 * t.v);
      let nwin = 0;
      for (let side = 0; side < 4; side++) {
        gw.setSub(side);
        const along = side % 2 === 0, Lh = (along ? t.w : t.d) / 2, off = (along ? t.d : t.w) / 2, nw = along ? t.win : Math.max(2, t.win - 1);
        const P = (u, yy, o) => along ? (side === 0 ? X(u, yy, off - o) : X(-u, yy, -off + o)) : (side === 1 ? X(off - o, yy, -u) : X(-off + o, yy, u));
        const seg = (u0, u1, y0, y1) => gw.hexa([P(u0, y0, 0), P(u1, y0, 0), P(u1, y0, th), P(u0, y0, th), P(u0, y1, 0), P(u1, y1, 0), P(u1, y1, th), P(u0, y1, th)]);
        seg(-Lh, Lh, floor, sill); seg(-Lh, Lh, sill + wh, yTop);
        const ww = Math.min(1.3, 2 * Lh / nw * 0.45); let u = -Lh;
        for (let w = 0; w < nw; w++) {
          const c = -Lh + (w + 0.5) * 2 * Lh / nw; seg(u, c - ww / 2, sill, sill + wh); u = c + ww / 2; nwin++;
          for (let b = 1; b <= 3; b++) { const bu = c - ww / 2 + b * ww / 4; seg(bu - 0.04, bu + 0.04, sill, sill + wh); }
        }
        seg(u, Lh, sill, sill + wh);
      }
      // 回縁：在可见墙脚（= 下层屋根顶）—— proto3 修正（proto1/2 误放在楼板标高，被下层屋根埋住）
      if (t.top && T.balcony) { gw.setSub(4); const W2 = t.w / 2 + 1.3, D2 = t.d / 2 + 1.3, yb = vis0; gw.box(cx - W2, yb - 0.05, cz - D2, cx + W2, yb + 0.25, cz + D2, COL.wall); for (const [x0, z0, x1, z1] of [[-W2, D2 - 0.1, W2, D2], [-W2, -D2, W2, -D2 + 0.1], [W2 - 0.1, -D2, W2, D2], [-W2, -D2, -W2 + 0.1, D2]]) gw.box(cx + x0, yb + 1.1, cz + z0, cx + x1, yb + 1.25, cz + z1, COL.gold); }
      add({ id: `${pre}-wall-${n}`, name: `${label} ${n} 重 壁·窓`, stage: 'wall', scope: sc(n), mat: 'wall', geo: gw, tally: 'win', count: nwin, spec: `土壁 0.24 m + 黒漆下見板 · 窓 ${nwin} 个（格子 3 本）` + (t.top && T.balcony ? ' · 回縁 + 金高欄' : '') });
      // 屋根：寄棟曲面 S(face,u,s)，s=0 檐口 → 1 上端；反り：y = rise·s^1.35，隅反り up·(2u−1)^6·(1−s)²
      const ow = t.w + 2 * t.ov, od = t.d + 2 * t.ov, nx = tiers[i + 1];
      const iw = nx ? nx.w - 0.2 : t.w * 0.62, id_ = nx ? nx.d - 0.2 : t.d * 0.42, rise = nx ? t.rise + 0.45 : t.rise, eave = L.eave, up = t.up || 0.8;
      const corner = (W, D, k) => [[-W / 2, D / 2], [W / 2, D / 2], [W / 2, -D / 2], [-W / 2, -D / 2]][k];
      const S = (f, u, s, dy) => { const a = corner(ow, od, f), b = corner(ow, od, (f + 1) % 4), c = corner(iw, id_, f), d = corner(iw, id_, (f + 1) % 4);
        const o = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], q = [c[0] + (d[0] - c[0]) * u, c[1] + (d[1] - c[1]) * u];
        return X(o[0] + (q[0] - o[0]) * s, eave + rise * Math.pow(s, 1.35) + up * Math.pow(2 * u - 1, 6) * (1 - s) * (1 - s) + dy, o[1] + (q[1] - o[1]) * s); };
      const NR = 4, NU = 6;
      const shell = (g, dy0, dy1, subBy, lines) => { let area = 0;
        for (let f = 0; f < 4; f++) for (let r = 0; r < NR; r++) for (let c = 0; c < NU; c++) {
          g.setSub(subBy === 'row' ? r : f * NU + c);
          const s0 = r / NR, s1 = (r + 1) / NR, u0 = c / NU, u1 = (c + 1) / NU;
          const tp = [S(f, u0, s0, dy1), S(f, u1, s0, dy1), S(f, u1, s1, dy1), S(f, u0, s1, dy1)], bt = [S(f, u0, s0, dy0), S(f, u1, s0, dy0), S(f, u1, s1, dy0), S(f, u0, s1, dy0)];
          g.hexa([...bt, ...tp], null, false); area += SEQ.quadArea(...tp);
          if (lines) { if (r === 0) g.line(tp[0], tp[1]); if (c === 0) g.line(tp[0], tp[3]); if (r === NR - 1) g.line(tp[3], tp[2]); if (lines === 2) g.line(tp[0], tp[3]); }
        }
        return area; };
      // 破風：千鳥 / 唐（T.gables，同 tenshu.js）+ 顶层入母屋
      const H_ = newHafu();
      for (const [ri, side, tt, W, Hh, kind] of (T.gables || [])) if (ri === i) { const p = S(side, 0.5, tt, 0); (kind === 'k' ? karahafu : chidori)(H_, kind === 'k' ? [p[0], p[1] - 0.15, p[2]] : p, SIDE_ROT[side], W, Hh, 4.5); }
      let iri = null;
      if (!nx && T.irimoya) {   // 入母屋：寄棟下段 + 破風上段（tenshu.js 同：gh 2.9 / ext 0.9，按面宽 12 m 缩放）
        const k2 = t.w / 12, gy = eave + rise, gh = 2.9 * k2, ext = 0.9 * k2, xa = -iw / 2 - ext, xb = iw / 2 + ext, zf = id_ / 2 + 0.3;
        const qS = [X(xa, gy - 0.2, zf), X(xb, gy - 0.2, zf), X(xb, gy + gh, 0), X(xa, gy + gh, 0)], qN = [X(xb, gy - 0.2, -zf), X(xa, gy - 0.2, -zf), X(xa, gy + gh, 0), X(xb, gy + gh, 0)];
        for (const q of [qS, qN]) { H_.b.setSub(0); plate(H_.b, q, -0.25, 0, null, true); H_.aT += plate(H_.t, q, 0, 0.12, null, false); }
        H_.t.box(cx + xa - 0.3, gy + gh - 0.15, cz - 0.3, cx + xb + 0.3, gy + gh + 0.45, cz + 0.3, [0.18, 0.18, 0.2]);   // 大棟
        for (const sx of [-1, 1]) {
          const xf = sx * iw / 2; H_.f.extrude([X(xf, gy, -id_ / 2), X(xf, gy, id_ / 2), X(xf, gy + gh - 0.1, 0)], [-sx * 0.15, 0, 0], null, 'all');   // 妻
          const xg = sx * (xb + 0.03);
          for (const sz of [-1, 1]) H_.g.extrude([X(xg, gy - 0.22, sz * zf), X(xg, gy + gh - 0.02, 0), X(xg, gy + gh - 0.28, 0), X(xg, gy - 0.48, sz * zf)], [sx * 0.1, 0, 0], null, 'all');   // 金破風板
          const F = (lx, ly, lz) => X(xf + sx * lz, ly, lx); diamond(H_.g, F, 0, gy + gh * 0.55, 0.02, 0.42, 0.3, 0.08);   // 懸魚
        }
        H_.n += 2; H_.gold += 6; H_.kinds.i += 2;
        if (T.topKara) { const [tt, W, Hh, Lk] = T.topKara, p = S(0, 0.5, tt, 0); karahafu(H_, [p[0], p[1] - 0.2, p[2] + 0.3], 0, W, Hh, Lk); }
        iri = { gy, gh, xa, xb };
      }
      const hSpec = H_.n ? ' · 破風 ' + [H_.kinds.c && `千鳥 ×${H_.kinds.c}`, H_.kinds.k && `唐 ×${H_.kinds.k}`, H_.kinds.i && `入母屋 妻 ×${H_.kinds.i}`].filter(Boolean).join(' · ') : '';
      const gr = new SEQ.Geo(COL.board), aR = shell(gr, -0.25, 0, 'face', 2);
      add({ id: `${pre}-roof-${n}`, group: `${pre}-roof-${n}`, stepName: `${label} ${n} 重 屋根下地`, name: `${label} ${n} 重 屋根下地`, stage: 'roof', scope: sc(n), mat: 'board', geo: gr, vol: aR * RULE.boardT, spec: `垂木·野地板 · 出檐 ${t.ov} m · 屋根面 ${aR.toFixed(0)} m² · 等效实木厚 ${RULE.boardT * 100} cm` + hSpec });
      if (H_.n) {
        const aH = H_.aT;   // 破风屋面面积 = 瓦面面积（同一表面）
        add({ id: `${pre}-hafu-${n}`, group: `${pre}-roof-${n}`, name: `${label} ${n} 重 破風（野地·妻）`, stage: 'roof', scope: sc(n), mat: 'board', geo: H_.b, vol: aH * RULE.boardT, tally: 'hafu', count: H_.n });
        add({ id: `${pre}-hafu-${n}-f`, group: `${pre}-roof-${n}`, name: `${label} ${n} 重 破風 妻壁`, stage: 'roof', scope: sc(n), mat: 'board', geo: H_.f });
      }
      // 瓦：瓦层（0.12 m 厚，含葺土）按行自檐口往上 + 丸瓦筋（每 0.55 m 一条三角棱）+ 金箔軒瓦
      const gt = new SEQ.Geo(COL.tile), aT = shell(gt, 0.0, 0.12, 'row', 1);
      const gribs = new SEQ.Geo(jit(COL.tile, 0.05));
      for (let f = 0; f < 4; f++) {
        const eL = (f % 2 === 0 ? ow : od), nr = Math.round(eL / 0.55);
        for (let k = 1; k < nr; k++) { const u = k / nr; let prev = null;
          for (let r = 0; r <= NR; r++) { gribs.setSub(Math.min(NR - 1, r)); const s = r / NR, c = S(f, u, s, 0.12), du = 0.07 / eL, l = S(f, Math.max(0, u - du), s, 0.12), rr = S(f, Math.min(1, u + du), s, 0.12), top = [c[0], c[1] + 0.09, c[2]];
            if (prev) { gribs.quad(prev[0], l, top, prev[1]); gribs.quad(prev[1], top, rr, prev[2]); if (k % 2 === 0) gribs.line(prev[1], top); }
            prev = [l, top, rr]; } }
      }
      const ggold = new SEQ.Geo(COL.gold);
      for (let f = 0; f < 4; f++) for (let c = 0; c < NU; c++) { const u0 = c / NU, u1 = (c + 1) / NU; ggold.setSub(0);
        const a = S(f, u0, 0, -0.05), b = S(f, u1, 0, -0.05), a2 = S(f, u0, 0.035, 0.16), b2 = S(f, u1, 0.035, 0.16);
        ggold.hexa([a, b, [b[0], b[1] - 0.18, b[2]], [a[0], a[1] - 0.18, a[2]], a2, b2, [b2[0], b2[1] - 0.12, b2[2]], [a2[0], a2[1] - 0.12, a2[2]]], null, c === 0 || c === NU - 1); }
      const tiles = Math.round(aT * RULE.tilePerM2), hTiles = Math.round(H_.aT * RULE.tilePerM2);
      add({ id: `${pre}-tile-${n}`, group: `${pre}-tile-${n}`, stepName: `${label} ${n} 重 葺瓦`, name: `${label} ${n} 重 本瓦`, stage: 'tile', scope: sc(n), mat: 'tile', geo: gt, tally: 'tile', count: tiles, spec: `本瓦葺 · ${aT.toFixed(0)} m² × ${RULE.tilePerM2.toFixed(1)} 枚/m²（平瓦 0.27×0.21 + 丸瓦 0.27×0.30 働き）· 金箔軒瓦` + (H_.n ? ` · 破風瓦 ${H_.aT.toFixed(0)} m²` : '') });
      add({ id: `${pre}-tile-${n}-r`, group: `${pre}-tile-${n}`, name: `${label} ${n} 重 丸瓦筋`, stage: 'tile', scope: sc(n), mat: 'tile', geo: gribs, noMass: true });
      add({ id: `${pre}-tile-${n}-g`, group: `${pre}-tile-${n}`, name: `${label} ${n} 重 金箔軒瓦`, stage: 'tile', scope: sc(n), mat: 'gold', geo: ggold });
      if (H_.n) add({ id: `${pre}-tile-${n}-h`, group: `${pre}-tile-${n}`, name: `${label} ${n} 重 破風瓦`, stage: 'tile', scope: sc(n), mat: 'tile', geo: H_.t, tally: 'tile', count: hTiles });
      // 破风金具（金破風板 + 懸魚）留到 金具 阶段统一装
      if (H_.n) { const P = H_.g.P, N = H_.g.N, C = H_.g.C; for (let q = 0; q < P.length; q += 9) hGold.tri([P[q], P[q + 1], P[q + 2]], [P[q + 3], P[q + 4], P[q + 5]], [P[q + 6], P[q + 7], P[q + 8]], [C[q], C[q + 1], C[q + 2]]); for (let q = 0; q < H_.g.L.length; q += 6) hGold.L.push(...H_.g.L.slice(q, q + 6)), hGold.LS.push(0, 0); hGoldN += H_.gold; }
      for (const k in hafuAll) hafuAll[k] += H_.kinds[k];
      roofs.push({ S, i, eave, rise, iw, id_, ow, od, iri, hafuN: H_.n });
      L.roof = { S, ow, od };
    });
    // 金具：鯱一对 + 大棟金覆 + 各重隅鬼（入母屋时 大棟 在破风顶）
    {
      const g = new SEQ.Geo(COL.gold), top = roofs[roofs.length - 1], ir = top.iri, rTop = ir ? ir.gy + ir.gh + 0.45 : top.eave + top.rise, rl = ir ? ir.xb : top.iw / 2;
      g.setSub(0);
      if (ir) g.box(cx + ir.xa - 0.31, rTop - 0.03, cz - 0.32, cx + ir.xb + 0.31, rTop + 0.09, cz + 0.32);
      else { g.box(cx - rl - 0.4, rTop, cz - 0.35, cx + rl + 0.4, rTop + 0.75, cz + 0.35, [0.18, 0.18, 0.2]); g.box(cx - rl - 0.45, rTop + 0.75, cz - 0.38, cx + rl + 0.45, rTop + 0.88, cz + 0.38); }
      const b0 = ir ? rTop + 0.09 : rTop + 0.88;
      const sh = (sx) => { const x = cx + sx * (rl + 0.1), b = b0; g.box(x - 0.35, b, cz - 0.3, x + 0.35, b + 1.2, cz + 0.3); g.rbox(x + sx * 0.25, b + 1.1, cz, 0.45, 0.9, 0.42, 0, null); g.rbox(x - sx * 0.3, b + 0.2, cz, 0.5, 0.5, 0.5, 0, null); };
      g.setSub(1); sh(-1); g.setSub(2); sh(1);
      let k = 3; for (const r of roofs) for (let f = 0; f < 4; f++) { g.setSub(k); const p = r.S(f, 0, 0, 0.12); g.box(p[0] - 0.3, p[1], p[2] - 0.3, p[0] + 0.3, p[1] + 0.7, p[2] + 0.3); }
      add({ id: pre + '-gold', group: pre + '-gold', stepName: label + ' 金鯱·金具', name: label + ' 金鯱·金具', stage: 'gold', scope: sc(1), mat: 'gold', geo: g, tally: 'gold', count: 2 + roofs.length * 4, spec: `鯱 1 对（棟上 +${b0.toFixed(2)} m）· 大棟金覆 · 隅鬼 ${roofs.length * 4} 个` + (hGoldN ? ` · 破風金具 ${hGoldN} 件` : '') + ' · 木胎金箔' });
      if (hGoldN) add({ id: pre + '-gold-hafu', group: pre + '-gold', name: label + ' 破風金具', stage: 'gold', scope: sc(1), mat: 'gold', geo: hGold, tally: 'gold', count: hGoldN });
      T.ridgeTop = b0 - 0.09 + (ir ? 0.09 : 0);
    }
    towerParts.push({ T, levels, roofs, p0, p1: parts.length, hafu: hafuAll });
    return levels;
  }

  // ---------- 足場（临时构件，按规则逐重生成）：一側丸太足場 —— 立柱（建地丸太）+ 布丸太 + 足場板 + 筋交 + 縄结 ----------
  // 第 N 重足场：围在第 N 重墙外 g 米（回縁层 = 回縁外 0.3 m；首重受台顶边限制）；立柱脚 = 向下射线落在已有构件（N−1 重屋根下地 / 破风 / 台顶）上，
  // 柱顶 = 向上射线碰到第 N 重屋根下皮（含破风）再退 0.30 m —— 足场物理上不穿檐。布/板/筋交 与同时在场的构件相碰则不设（计入 omitted）。
  // R4（seq.js）：搭设先于本重 柱/梁/屋根/壁/葺瓦（首重还服务 金具），拆除在其后；最终由 seq.js 净空检查按时间表复核。
  // 与“本塔第 n 重足场 / 第 n 重某工序的吊具”同时在场的构件（按工序规则预判，最终由 seq.js 按时间表复核）
  const tierOf = p => { if (p._tier == null) { const m = /^(.+)-(\d+)$/.exec(p.scope || ''); p._tw = m ? m[1] : ''; p._tier = m ? +m[2] : 0; } return p._tier; };
  function coexist(pre, n, what) {
    const ok = new Uint8Array(parts.length + 1);
    parts.forEach((p, k) => { const tr = tierOf(p); let v = 1;
      if (p._tw === pre) {
        if (p.stage === 'tile' && tr < n) v = 0;                       // 下层葺瓦在本层足场拆除后
        if (p.stage === 'gold' && n > 1) v = 0;                        // 金具最后装
        if (what === 'frame' && tr >= n && !(tr === n && (p.stage === 'col' || p.stage === 'beam'))) v = 0;   // 立柱/架梁时，本层及以上的屋根/壁/瓦还没有
      }
      ok[k] = v; });
    return tag => ok[tag] === 1;
  }
  const SCAF = { gap: 1.0, pole: 0.07, ledger: 0.055, lift: 1.8, bay: 1.8, clear: 0.3, minH: 2.0 };
  const SCOL = { pole: [0.6, 0.5, 0.36], board: [0.72, 0.6, 0.42], rope: [0.82, 0.72, 0.46] };
  const gridAll = new SEQ.TriGrid(2);
  function scaffolds(TP, baseHalf) {
    const { T, levels, p0, p1 } = TP, { pre, label, cx, cz } = T;
    for (let k = 0; k < p1; k++) { const p = parts[k]; if (p.kind === 'remove' || p.kind === 'fill' || p.temp || p._inGrid) continue; gridAll.add(p.geo, k); p._inGrid = 1; }

    levels.forEach(L => {
      const t = L.t, n = L.i + 1;
      let g = t.top && T.balcony ? 1.6 : SCAF.gap; if (n === 1 && baseHalf) g = Math.min(g, baseHalf[0] - t.w / 2 - 0.2, baseHalf[1] - t.d / 2 - 0.2);
      const RX = t.w / 2 + g, RZ = t.d / 2 + g;
      // 与本足场同时在场的构件：其他塔全部；本塔中 低于 N 重的葺瓦（拆架后才葺）除外；金具只与首重同时在场
      const filt = coexist(pre, n, 'scaf');
      const geo = new SEQ.Geo(SCOL.pole), probes = []; let nPole = 0, nLed = 0, nBoard = 0, nBrace = 0, nTie = 0, omit = 0;
      const sides = [[[-RX, RZ], [RX, RZ], [0, 1]], [[RX, RZ], [RX, -RZ], [1, 0]], [[RX, -RZ], [-RX, -RZ], [0, -1]], [[-RX, -RZ], [-RX, RZ], [-1, 0]]];
      const r = SCAF.pole, offs = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]];
      const poleAt = (x, z) => {
        let base = -1e9, top = 1e9; const y0 = L.eave - 0.5;
        for (const [ox, oz] of offs) { const d = gridAll.rayY([cx + x + ox, y0, cz + z + oz], -1, 45, filt); if (d == null) return null; base = Math.max(base, y0 - d); }
        base += 0.04;   // 柱脚离支承面 4 cm（六角柱角点在坡面上也不贴面）
        for (const [ox, oz] of offs) { const d = gridAll.rayY([cx + x + ox, base + 0.05, cz + z + oz], 1, 30, filt); if (d != null) top = Math.min(top, base + 0.05 + d); }
        top = Math.min(top - SCAF.clear, L.yTop + 1.2);
        return top - base >= SCAF.minH ? { x, z, base, top } : null;
      };
      const south = [];   // 南面（+z）布丸太，给吊具定位
      let minB = 1e9, maxT = -1e9;
      const sideP = sides.map(([a, b, nrm], si) => {
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]), nb = Math.max(1, Math.ceil(len / SCAF.bay)), out = [];
        for (let k = 0; k <= nb; k++) { const u = k / nb; out.push(poleAt(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u)); }
        return { pts: out, nrm, tx: (b[0] - a[0]) / len, tz: (b[1] - a[1]) / len, si };
      });
      // 立柱（角柱只立一次）
      sideP.forEach(S => S.pts.forEach((p, k) => { if (!p || k === S.pts.length - 1) return; geo.setSub(0); geo.prism([cx + p.x, p.base, cz + p.z], [cx + p.x, p.top, cz + p.z], r, 6, jit(SCOL.pole, 0.08), 'axis'); probes.push([[cx + p.x, p.base, cz + p.z], [cx + p.x, p.top, cz + p.z], r]); nPole++; minB = Math.min(minB, p.base); maxT = Math.max(maxT, p.top); }));
      if (!nPole) return;
      const tie = (x, y, z) => { geo.box(x - 0.13, y - 0.1, z - 0.13, x + 0.13, y + 0.1, z + 0.13, SCOL.rope, false); nTie++; };
      sideP.forEach(S => {
        const valid = S.pts.filter(Boolean); if (valid.length < 2) return;
        const sb = Math.min(...valid.map(p => p.base)), o = r + SCAF.ledger, ox = S.nrm[0] * o, oz = S.nrm[1] * o;
        for (let k = 0; k + 1 < S.pts.length; k++) {
          const A = S.pts[k], Bp = S.pts[k + 1]; if (!A || !Bp) continue;
          for (let lv = 0, yl = sb + 1.0; yl < maxT; lv++, yl += SCAF.lift) {
            if (yl < Math.max(A.base, Bp.base) + 0.35 || yl > Math.min(A.top, Bp.top) - 0.12) continue;
            const a = [cx + A.x + ox - S.tx * 0.12, yl, cz + A.z + oz - S.tz * 0.12], b = [cx + Bp.x + ox + S.tx * 0.12, yl, cz + Bp.z + oz + S.tz * 0.12];
            if (gridAll.probe(a, b, SCAF.ledger, filt) >= 0) { omit++; continue; }
            geo.setSub(lv + 1); geo.prism(a, b, SCAF.ledger, 6, jit(SCOL.pole, 0.06), 'axis'); probes.push([a, b, SCAF.ledger]); nLed++;
            tie(cx + A.x + S.nrm[0] * 0.06, yl, cz + A.z + S.nrm[1] * 0.06); tie(cx + Bp.x + S.nrm[0] * 0.06, yl, cz + Bp.z + S.nrm[1] * 0.06);
            if (S.si === 0) south.push({ x: (A.x + Bp.x) / 2, y: yl, lv });
            // 足場板：布上一块，从布外缘伸到离墙 0.15 m
            const mx = (A.x + Bp.x) / 2, mz = (A.z + Bp.z) / 2, inn = g - 0.15, by = yl + SCAF.ledger;
            const ba = [cx + mx + S.nrm[0] * (o + SCAF.ledger), by + 0.02, cz + mz + S.nrm[1] * (o + SCAF.ledger)], bb = [cx + mx - S.nrm[0] * inn, by + 0.02, cz + mz - S.nrm[1] * inn];
            if (gridAll.probe(ba, bb, 0.08, filt) < 0) { const w = 0.15, px = S.tx * w, pz = S.tz * w;
              geo.extrude([[ba[0] - px, by, ba[2] - pz], [ba[0] + px, by, ba[2] + pz], [bb[0] + px, by, bb[2] + pz], [bb[0] - px, by, bb[2] - pz]], [0, 0.04, 0], SCOL.board, false); probes.push([ba, bb, 0.03]); nBoard++; }
            else omit++;
          }
        }
        // 筋交：每 3 跨一根，跨 2 跨、升 1 步
        for (let k = 1; k + 2 < S.pts.length; k += 3) {
          const A = S.pts[k], Bp = S.pts[k + 2]; if (!A || !Bp) continue;
          const y0 = Math.max(A.base, Bp.base) + 0.6, y1 = Math.min(y0 + SCAF.lift * 1.6, Math.min(A.top, Bp.top) - 0.3); if (y1 - y0 < 1.2) continue;
          const oo = o + 0.12, a = [cx + A.x + S.nrm[0] * oo, y0, cz + A.z + S.nrm[1] * oo], b = [cx + Bp.x + S.nrm[0] * oo, y1, cz + Bp.z + S.nrm[1] * oo];
          if (gridAll.probe(a, b, 0.045, filt) >= 0) { omit++; continue; }
          geo.setSub(1); geo.prism(a, b, 0.045, 5, jit(SCOL.pole, 0.06), 'axis'); probes.push([a, b, 0.045]); nBrace++;
        }
      });
      const id = `${pre}-scaf-${n}`;
      const part = add({ id, name: `${label} ${n} 重 足場`, stepName: `${label} ${n} 重 足場搭设`, stage: 'scaf', mat: 'pole', geo, tally: 'pole', count: nPole, probes,
        temp: { serves: ['col', 'beam', 'roof', 'wall', 'tile'].concat(n === 1 ? ['gold'] : []), scope: `${pre}-${n}`, removeStage: 'unscaf', removeName: `${label} ${n} 重 足場解体` },
        spec: `一側丸太足場 · 离墙 ${g.toFixed(1)} m · 建地 ${nPole} 根 · 布 ${nLed} · 足場板 ${nBoard} · 筋交 ${nBrace} · 縄结 ${nTie} · 柱顶距檐下皮 ≥${SCAF.clear} m` + (omit ? ` · 避让不设 ${omit}` : '') + (n === 1 ? ' · 留至金具完' : '') });
      // 吊具锚点：南面最高一步的布，取最靠中线的一跨
      south.sort((a, b) => b.lv - a.lv || Math.abs(a.x) - Math.abs(b.x));
      L.scaf = south.length ? { x: south[0].x, y: south[0].y, z: RZ + r + SCAF.ledger, south, part } : null;
    });
  }

  // ---------- 吊具（人字架 + 滑车 + 绳 + 吊物），局部坐标：+z 朝外，y 上；顶点类型存在 sub：
  //   0 人字架腿（单位高度，按 h 拉伸、按 lean 前倾）· 1 架顶（滑车）· 2 吊物（随吊绳长度）· 3 底座（轆轤，不拉伸）· 4 悬挂式专用（挑木）
  const RIG = new SEQ.Geo([0.5, 0.38, 0.24]);
  {
    const g = RIG, wood = [0.5, 0.38, 0.24], rope = [0.78, 0.68, 0.45], iron = [0.25, 0.24, 0.24];
    g.setSub(0); for (const sx of [-1, 1]) g.prism([sx * 0.65, 0, 0], [sx * 0.08, 1, 0], 0.09, 6, wood, 'axis');
    g.prism([-0.48, 0.3, 0], [0.48, 0.3, 0], 0.05, 5, wood, 'axis'); g.prism([0, 0, -0.7], [0, 1, 0], 0.025, 4, rope, false);
    g.setSub(3); g.prism([-0.45, 0.32, -0.5], [0.45, 0.32, -0.5], 0.16, 8, wood, 'axis'); for (const sx of [-1, 1]) g.box(sx * 0.5 - 0.05, 0, -0.56, sx * 0.5 + 0.05, 0.42, -0.44, wood, false);
    g.setSub(1); g.box(-0.16, -0.12, -0.16, 0.16, 0.12, 0.16, rope, false); g.box(-0.1, -0.55, -0.07, 0.1, -0.15, 0.07, iron); g.prism([0, -0.33, -0.09], [0, -0.33, 0.09], 0.15, 8, iron, false);
    g.setSub(4); g.prism([0, 0.08, -0.75], [0, 0.08, 0.05], 0.06, 6, wood, 'axis'); g.box(-0.13, -0.05, -0.85, 0.13, 0.2, -0.65, rope, false);
    // 吊绳：顶端类型 1（y −0.55），底端类型 2（吊物顶 y 0）
    const v0 = g.P.length / 3; g.setSub(1); g.prism([0, -0.55, 0], [0, -1.55, 0], 0.02, 4, rope, false);
    for (let v = v0; v < g.P.length / 3; v++) if (g.P[v * 3 + 1] < -1) { g.S[v] = 2; g.P[v * 3 + 1] = 0; }
    for (let q = 0; q < g.L.length / 3; q++) if (g.L[q * 3 + 1] < -1) { g.LS[q] = 2; g.L[q * 3 + 1] = 0; }
    g.setSub(2); g.box(-0.4, -0.85, -0.3, 0.4, -0.25, 0.3, [0.66, 0.6, 0.5]); for (const sx of [-1, 1]) g.prism([0, 0, 0], [sx * 0.33, -0.26, 0], 0.02, 4, rope, false);
  }
  const RIGL = { foot: 0.65, apexDrop: 0.55, load: 0.85 };
  function rigPose(base, opt, filt) {   // base: 世界坐标 [x, y, z]（人字架 = 脚底；悬挂 = 挑木端），opt: {h, lean, legs, yaw}
    const q = Object.assign({ x: base[0], y: base[1], z: base[2], yaw: 0, h: 0, lean: 0, legs: false, lifts: 3 }, opt), c = Math.cos(q.yaw), s = Math.sin(q.yaw);
    const W = (lx, ly, lz) => [q.x + lx * c + lz * s, q.y + ly, q.z - lx * s + lz * c];
    const apex = W(0, q.h, q.lean);
    let dmin = 1e9; for (const [ox, oz] of [[0, 0], [-0.4, -0.3], [0.4, -0.3], [-0.4, 0.3], [0.4, 0.3]]) { const o = W(ox, q.h - RIGL.apexDrop, q.lean + oz), d = gridAll.rayY(o, -1, 12, filt); dmin = Math.min(dmin, d == null ? 12 : d); }
    q.dropMin = 1.1; q.dropMax = Math.max(q.dropMin + 0.3, Math.min(9, dmin + RIGL.apexDrop - RIGL.load - 0.35));
    const P = []; const lo = W(0, q.h - q.dropMax, q.lean);
    if (q.legs) { for (const sx of [-1, 1]) P.push([W(sx * RIGL.foot, 0.06, 0.06 * q.lean / Math.max(q.h, 1)), W(sx * 0.08, q.h, q.lean), 0.09]); P.push([W(0, 0.06, -0.7), apex, 0.025]); }
    else P.push([W(0, 0.08, -0.6), W(0, 0.08, 0.05), 0.06]);
    P.push([W(0, q.h - RIGL.apexDrop, q.lean), lo, 0.03]);
    for (const [ox, oz] of [[-0.4, -0.3], [0.4, -0.3], [-0.4, 0.3], [0.4, 0.3]]) P.push([W(ox, q.h - q.dropMax - 0.25, q.lean + oz), W(ox, q.h - q.dropMax - RIGL.load, q.lean + oz), 0.01]);
    q.probes = P; q.clear = P.every(([a, b, r]) => gridAll.probe(a, b, r, filt) < 0); return q;
  }
  const footY = (x, z, y0, maxD) => { let b = -1e9; for (const dx of [-RIGL.foot, RIGL.foot]) { const d = gridAll.rayY([x + dx, y0, z], -1, maxD || 6); if (d != null) b = Math.max(b, y0 - d); } return b > -1e8 ? b + 0.03 : y0; };
  function assignRigs() {
    for (const p of parts) {
      if (p.rig || p.kind === 'temp' || p.kind === 'remove' || p.kind === 'fill' || p.group && p.group !== p.id && parts.find(q => (q.group || q.id) === p.group) !== p) continue;
      if (p.rigAt) { const [x, y, z] = p.rigAt; p.rig = rigPose([x, footY(x, z, y + 1.5), z], { h: 4.2, lean: 1.6, legs: true }); continue; }
      const m = /^(.+)-(col|beam|roof|hafu|wall|tile|gold)-?(\d+)?/.exec(p.id); if (!m) continue;
      const TP = towerParts.find(x => x.T.pre === m[1]); if (!TP) continue;
      const n = m[2] === 'gold' ? 1 : +m[3], L = TP.levels[n - 1], sc = L && L.scaf; if (!sc) continue;
      const { cx, cz } = TP.T, bx = cx + sc.x, bz = cz + sc.z;
      if (m[2] === 'col' || m[2] === 'beam') { const y = sc.y + SCAF.ledger; p.rig = rigPose([bx, y, bz], { h: Math.max(3, L.yTop + 1.4 - y), lean: 1.2, legs: true }, coexist(TP.T.pre, n, 'frame')); }
      else {   // 悬挂式：从最高一步的布往下找，取第一处挑木/吊绳/吊物都不碰构件的跨
        const f = coexist(TP.T.pre, n, 'scaf');
        for (const c of sc.south) { const q = rigPose([cx + c.x, c.y, bz + 0.75], { h: 0, lean: 0, legs: false }, f); if (q.clear && q.dropMax > 1.6) { p.rig = q; break; } }
        if (!p.rig) p.rig = rigPose([bx, sc.y, bz + 0.75], { h: 0, lean: 0, legs: false }, f);
      }
    }
  }
  const tenshuTiers = [
    { w: 28, d: 24, v: 8.0, ov: 3.4, rise: 4.2, up: 1.3, win: 7 },
    { w: 23, d: 19.5, v: 4.6, ov: 3.0, rise: 3.8, up: 1.2, win: 6 },
    { w: 19, d: 16, v: 4.3, ov: 2.8, rise: 3.4, up: 1.1, win: 5 },
    { w: 15.5, d: 13, v: 4.0, ov: 2.6, rise: 3.0, up: 1.0, win: 4 },
    { w: 12, d: 10, v: 5.2, ov: 2.6, rise: 2.8, up: 1.0, win: 3, top: true },
  ];
  // 破風表同 tenshu.js gabs：[屋根序, 面(0 南 1 东 2 北 3 西), 坡上位置 s, 宽 W, 高 H, 'c' 千鳥 / 'k' 唐]；顶层 入母屋 + 正面唐破風
  const GABLES = [
    [0, 0, 0.42, 9.0, 3.2, 'c'], [0, 2, 0.42, 9.0, 3.2, 'c'], [0, 1, 0.45, 5.0, 2.6, 'c'], [0, 3, 0.45, 5.0, 2.6, 'c'],
    [1, 0, 0.4, 5.5, 1.9, 'k'], [1, 2, 0.4, 5.5, 1.9, 'k'], [1, 1, 0.42, 6.5, 2.8, 'c'], [1, 3, 0.42, 6.5, 2.8, 'c'],
    [2, 0, 0.42, 6.0, 2.6, 'c'], [2, 2, 0.42, 6.0, 2.6, 'c'], [3, 1, 0.45, 4.2, 2.1, 'c'], [3, 3, 0.45, 4.2, 2.1, 'c'],
  ];
  const TT = { pre: 'tenshu', label: '天守', cx: 0, cz: 0, base: BH, tiers: tenshuTiers, balcony: true, gables: GABLES, irimoya: true, topKara: [0.38, 4.2, 1.6, 2.2] };
  const TY = { pre: 'yagura', label: '二重櫓', cx: -50, cz: 31, base: 0, tiers: [{ w: 12, d: 10, v: 4.6, ov: 2.2, rise: 3.0, up: 0.8, win: 4 }, { w: 9, d: 7.5, v: 3.8, ov: 2.0, rise: 2.4, up: 0.7, win: 3, top: true }], irimoya: true };
  const tLv = tower(TT), yLv = tower(TY);
  // 足場：两座楼阁全部构件生成之后再按规则生成（要用到上下两层屋根的实际几何）；吊具位姿最后定
  scaffolds(towerParts[0], [Wd(BH) / 2, Dd(BH) / 2]); scaffolds(towerParts[1], null);
  for (let k = 0; k < parts.length; k++) { const p = parts[k]; if (!(p.kind === 'remove' || p.kind === 'fill' || p.temp || p._inGrid)) { gridAll.add(p.geo, k); p._inGrid = 1; } }
  assignRigs();

  const rules = {
    stages: [
      { key: 'site', name: '縄張·整地', verb: '整地', trade: '人足' },
      { key: 'dig', name: '堀 掘削', verb: '掘削', trade: '土工' },
      { key: 'ishi', name: '石垣', verb: '积石', trade: '石工', order: 'z' },
      { key: 'water', name: '注水', verb: '注水', trade: '人足', after: ['ishi'], near: 6, on: ['site'] },
      { key: 'soseki', name: '礎石', verb: '据石', trade: '石工', on: ['ishi', 'site'] },
      { key: 'scaf', name: '足場搭设', verb: '搭设', trade: '鳶', on: ['roof', 'ishi', 'site'] },
      { key: 'col', name: '立柱', verb: '立柱', trade: '大工', on: ['soseki', 'beam'] },
      { key: 'beam', name: '架梁·床', verb: '架梁', trade: '大工', on: ['col'] },
      { key: 'roof', name: '屋根下地', verb: '铺野地', trade: '大工', on: ['beam', 'col'] },
      { key: 'wall', name: '壁·窓', verb: '塗壁', trade: '左官', on: ['col', 'soseki', 'beam', 'roof'] },
      { key: 'tile', name: '葺瓦', verb: '葺瓦', trade: '瓦工', order: '-z', on: ['roof'] },
      { key: 'gold', name: '金鯱·金具', verb: '装金', trade: '錺師', on: ['tile'] },
      { key: 'unscaf', name: '足場解体', verb: '解体', trade: '鳶', asap: true, rate: 3 },
    ],
    mats: { soil: { name: '土', rho: 1.7 }, granite: { name: '花岗岩', rho: 2.65 }, fill: { name: '栗石·盛土', rho: 1.9 }, water: { name: '水', rho: 1.0 }, timber: { name: '桧·欅', rho: 0.5 }, board: { name: '杉 野地', rho: 0.45 }, wall: { name: '土壁·黒漆板', rho: 1.5 }, tile: { name: '本瓦（含葺土）', rho: 1.45 }, gold: { name: '木胎金箔', rho: 0.9 }, pole: { name: '杉丸太·足場板', rho: 0.45 } },
    rates: { '石工': 150, '大工': 4, '左官': 12, '瓦工': 10, '錺師': 0.8, '人足': 50, '鳶': 1.5 },
    digRate: 2500, fillRate: 8000, minDays: 2, t0: new Date(1583, 8, 1),
  };
  const levels = [{ y: -18, n: '堀底' }, { y: -11, n: '水位' }, { y: 0, n: '本丸' }, { y: BH, n: '天守台' }, ...tLv.map(L => ({ y: L.floor, n: (L.i + 1) + ' 重' })), { y: TT.ridgeTop, n: '大棟' }];
  // 图纸 A-201 破风标注：南面（f=0）可见的破风 + 入母屋
  const hafuMarks = [];
  { const L = tLv, S0 = i => L[i].roof.S, xl = i => L[i].roof.ow / 2;   // xl：该重檐口半宽（标签须在其左侧）
    GABLES.forEach(([ri, side, tt, W, Hh, kind]) => { if (side !== 0) return; const p = S0(ri)(0, 0.5, tt, 0); hafuMarks.push({ x: p[0], y: p[1] + Hh + 0.3, xl: xl(ri), n: kind === 'k' ? '唐破風' : '千鳥破風', part: `tenshu-hafu-${ri + 1}` }); });
    hafuMarks.push({ x: -4.2, y: TT.ridgeTop - 1.6, xl: xl(4), n: '入母屋', part: 'tenshu-hafu-5' });
    const p5 = S0(4)(0, 0.5, TT.topKara[0], 0); hafuMarks.push({ x: 1.6, y: p5[1] + TT.topKara[2] - 0.1, xl: xl(4), n: '唐破風', part: 'tenshu-hafu-5' });
    hafuMarks.sort((a, b) => b.y - a.y); hafuMarks.labelX = -26;
  }
  return { parts, rules, levels, ruleParams: RULE, title: '大阪城 天守 · 筑城图', dwg: 'OSK-T', rig: RIG, hafuMarks, scaf: SCAF };
}
G.SEQ_OSAKA = { build };
})(typeof window !== 'undefined' ? window : globalThis);
