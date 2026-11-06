'use strict';
// ===== 大阪城“筑城”小样的构件规格（proto-build1）：天守台石垣 + 丰臣式天守 + 一座二重櫓 + 一段本丸石垣/内堀 =====
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
    add({ id: g + '-s', group: g, stepName: `本丸石垣 第 ${c + 1} 段`, name: '本丸石垣 筑石', stage: 'ishi', mat: 'granite', geo: stones, tally: 'stone', count: n, spec: `打込接 · 段高 ${h2.toFixed(2)} m · 控 ${RULE.stoneDepth} m · 扇勾配 0.40` });
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
    add({ id: g + '-s', group: g, stepName: `天守台石垣 第 ${c + 1} 段`, name: '天守台 筑石', stage: 'ishi', mat: 'granite', geo: stones, tally: 'stone', count: n, spec: `野面积 · 段高 ${hc.toFixed(2)} m · 隅角交错 · 外周 ${(2 * (Wd(y0) + Dd(y0))).toFixed(1)} m` });
    add({ id: g + '-f', group: g, name: '天守台 栗石·盛土', stage: 'ishi', mat: 'fill', geo: fill });
  }
  // ---------- 注水（充填类：自下而上）----------
  {
    const g = new SEQ.Geo(COL.water);
    g.box(-80, -18, zFace(-11) - 0.4, 80, -11, ZM + 0.6);
    add({ id: 'water', name: '内堀 注水', stage: 'water', kind: 'fill', mat: 'water', geo: g, noMass: true, spec: '水位 −11.00 · 水深 7 m' });
  }

  // ---------- 楼阁语法：天守 / 櫓 共用 ----------
  // tiers 同 tenshu.js：{w,d,v(可见墙高),ov(出檐),rise(屋根升高),up(隅反り),win}
  function tower(T) {
    const { pre, label, cx, cz, base, tiers } = T, X = (x, y, z) => [cx + x, y, cz + z];
    const levels = []; let y = base + 0.3, prevTop = null;
    tiers.forEach((t, i) => { const yTop = y + t.v, floor = i === 0 ? base + 0.3 : prevTop - 0.28; levels.push({ t, i, floor, yTop, eave: yTop - 0.45 }); prevTop = yTop; y = yTop + t.rise; });
    const grid = (w, d) => { const nx = Math.max(2, Math.round(w / RULE.colGrid)), nz = Math.max(2, Math.round(d / RULE.colGrid)), out = []; for (let a = 0; a <= nx; a++) for (let b = 0; b <= nz; b++) out.push([-w / 2 + 0.2 + a * (w - 0.4) / nx, -d / 2 + 0.2 + b * (d - 0.4) / nz]); return { pts: out, nx, nz }; };
    // 礎石
    {
      const L0 = levels[0], G0 = grid(L0.t.w, L0.t.d), g = new SEQ.Geo(COL.granite);
      G0.pts.forEach((p, k) => { g.setSub(k); g.box(cx + p[0] - 0.35, base, cz + p[1] - 0.35, cx + p[0] + 0.35, base + 0.3, cz + p[1] + 0.35, jit(COL.granite, 0.08)); });
      add({ id: pre + '-soseki', name: label + ' 礎石', stage: 'soseki', mat: 'granite', geo: g, tally: 'stone', count: G0.pts.length, spec: `${G0.pts.length} 个 · 0.70×0.70×0.30 m · 柱网 ${G0.nx}×${G0.nz}` });
    }
    const roofs = [];
    levels.forEach(L => {
      const { t, i, floor, yTop } = L, Gd = grid(t.w, t.d), n = i + 1;
      // 柱
      const gc = new SEQ.Geo(COL.timber);
      Gd.pts.slice().sort((a, b) => (a[0] + a[1] * 0.3) - (b[0] + b[1] * 0.3)).forEach((p, k) => { gc.setSub(k); gc.box(cx + p[0] - 0.15, floor, cz + p[1] - 0.15, cx + p[0] + 0.15, yTop - 0.85, cz + p[1] + 0.15, jit(COL.timber, 0.06)); });
      add({ id: `${pre}-col-${n}`, name: `${label} ${n} 重 柱`, stage: 'col', mat: 'timber', geo: gc, tally: 'col', count: Gd.pts.length, spec: `通柱 0.30 m 角 · 长 ${(yTop - 0.85 - floor).toFixed(2)} m · 柱间 ${((t.w - 0.4) / Gd.nx).toFixed(2)} m` });
      // 梁 + 上层床
      const gb = new SEQ.Geo(COL.timber); let k = 0;
      const xs = [...new Set(Gd.pts.map(p => p[0].toFixed(3)))].map(Number), zs = [...new Set(Gd.pts.map(p => p[1].toFixed(3)))].map(Number);
      for (const z of zs) { gb.setSub(k++); gb.box(cx - t.w / 2 + 0.05, yTop - 0.85, cz + z - 0.15, cx + t.w / 2 - 0.05, yTop - 0.4, cz + z + 0.15, jit(COL.timber, 0.05)); }
      for (const x of xs) { gb.setSub(k++); gb.box(cx + x - 0.14, yTop - 0.84, cz - t.d / 2 + 0.05, cx + x + 0.14, yTop - 0.41, cz + t.d / 2 - 0.05, jit(COL.timber, 0.05)); }
      if (i < tiers.length - 1) { gb.setSub(k++); gb.box(cx - t.w / 2 + 0.2, yTop - 0.4, cz - t.d / 2 + 0.2, cx + t.w / 2 - 0.2, yTop - 0.28, cz + t.d / 2 - 0.2, COL.board); }
      add({ id: `${pre}-beam-${n}`, name: `${label} ${n} 重 梁·床`, stage: 'beam', mat: 'timber', geo: gb, tally: 'beam', count: xs.length + zs.length, spec: `梁 0.30×0.45 m · ${xs.length + zs.length} 根` + (i < tiers.length - 1 ? ` · 床板 ${(t.w - 0.4).toFixed(1)}×${(t.d - 0.4).toFixed(1)} m` : '') });
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
      if (t.top && T.balcony) { gw.setSub(4); const W2 = t.w / 2 + 1.3, D2 = t.d / 2 + 1.3; gw.box(cx - W2, floor - 0.05, cz - D2, cx + W2, floor + 0.25, cz + D2, COL.wall); for (const [x0, z0, x1, z1] of [[-W2, D2 - 0.1, W2, D2], [-W2, -D2, W2, -D2 + 0.1], [W2 - 0.1, -D2, W2, D2], [-W2, -D2, -W2 + 0.1, D2]]) gw.box(cx + x0, floor + 1.1, cz + z0, cx + x1, floor + 1.25, cz + z1, COL.gold); }
      const wallVol = Math.abs(gw.vol);
      add({ id: `${pre}-wall-${n}`, name: `${label} ${n} 重 壁·窓`, stage: 'wall', mat: 'wall', geo: gw, tally: 'win', count: nwin, spec: `土壁 0.24 m + 黒漆下見板 · 窓 ${nwin} 个（格子 3 本）` + (t.top && T.balcony ? ' · 回縁 + 金高欄' : '') });
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
      const gr = new SEQ.Geo(COL.board), aR = shell(gr, -0.25, 0, 'face', 2);
      add({ id: `${pre}-roof-${n}`, name: `${label} ${n} 重 屋根下地`, stage: 'roof', mat: 'board', geo: gr, vol: aR * RULE.boardT, spec: `垂木·野地板 · 出檐 ${t.ov} m · 屋根面 ${aR.toFixed(0)} m² · 等效实木厚 ${RULE.boardT * 100} cm` });
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
      const tiles = Math.round(aT * RULE.tilePerM2);
      add({ id: `${pre}-tile-${n}`, group: `${pre}-tile-${n}`, stepName: `${label} ${n} 重 葺瓦`, name: `${label} ${n} 重 本瓦`, stage: 'tile', mat: 'tile', geo: gt, tally: 'tile', count: tiles, spec: `本瓦葺 · ${aT.toFixed(0)} m² × ${RULE.tilePerM2.toFixed(1)} 枚/m²（平瓦 0.27×0.21 + 丸瓦 0.27×0.30 働き）· 金箔軒瓦` });
      add({ id: `${pre}-tile-${n}-r`, group: `${pre}-tile-${n}`, name: `${label} ${n} 重 丸瓦筋`, stage: 'tile', mat: 'tile', geo: gribs, noMass: true });
      add({ id: `${pre}-tile-${n}-g`, group: `${pre}-tile-${n}`, name: `${label} ${n} 重 金箔軒瓦`, stage: 'tile', mat: 'gold', geo: ggold });
      roofs.push({ S, i, eave, rise, iw, id_ });
      L.roof = { S };
    });
    // 金具：鯱一对 + 大棟金覆 + 各重隅鬼
    {
      const g = new SEQ.Geo(COL.gold), top = roofs[roofs.length - 1], rTop = top.eave + top.rise, rl = top.iw / 2;
      g.setSub(0); g.box(cx - rl - 0.4, rTop, cz - 0.35, cx + rl + 0.4, rTop + 0.75, cz + 0.35, [0.18, 0.18, 0.2]);
      g.box(cx - rl - 0.45, rTop + 0.75, cz - 0.38, cx + rl + 0.45, rTop + 0.88, cz + 0.38);
      const sh = (sx) => { const x = cx + sx * (rl + 0.1), b = rTop + 0.88; g.box(x - 0.35, b, cz - 0.3, x + 0.35, b + 1.2, cz + 0.3); g.rbox(x + sx * 0.25, b + 1.1, cz, 0.45, 0.9, 0.42, 0, null); g.rbox(x - sx * 0.3, b + 0.2, cz, 0.5, 0.5, 0.5, 0, null); };
      g.setSub(1); sh(-1); g.setSub(2); sh(1);
      let k = 3; for (const r of roofs) for (let f = 0; f < 4; f++) { g.setSub(k); const p = r.S(f, 0, 0, 0.12); g.box(p[0] - 0.3, p[1], p[2] - 0.3, p[0] + 0.3, p[1] + 0.7, p[2] + 0.3); }
      add({ id: pre + '-gold', name: label + ' 金鯱·金具', stage: 'gold', mat: 'gold', geo: g, tally: 'gold', count: 2 + roofs.length * 4, spec: `鯱 1 对（棟上 +${(rTop + 0.88).toFixed(2)} m）· 大棟金覆 · 隅鬼 ${roofs.length * 4} 个 · 木胎金箔` });
    }
    return levels;
  }
  const tenshuTiers = [
    { w: 28, d: 24, v: 8.0, ov: 3.4, rise: 4.2, up: 1.3, win: 7 },
    { w: 23, d: 19.5, v: 4.6, ov: 3.0, rise: 3.8, up: 1.2, win: 6 },
    { w: 19, d: 16, v: 4.3, ov: 2.8, rise: 3.4, up: 1.1, win: 5 },
    { w: 15.5, d: 13, v: 4.0, ov: 2.6, rise: 3.0, up: 1.0, win: 4 },
    { w: 12, d: 10, v: 5.2, ov: 2.6, rise: 2.8, up: 1.0, win: 3, top: true },
  ];
  const tLv = tower({ pre: 'tenshu', label: '天守', cx: 0, cz: 0, base: BH, tiers: tenshuTiers, balcony: true });
  const yLv = tower({ pre: 'yagura', label: '二重櫓', cx: -50, cz: 31, base: 0, tiers: [{ w: 12, d: 10, v: 4.6, ov: 2.2, rise: 3.0, up: 0.8, win: 4 }, { w: 9, d: 7.5, v: 3.8, ov: 2.0, rise: 2.4, up: 0.7, win: 3, top: true }] });

  const rules = {
    stages: [
      { key: 'site', name: '縄張·整地', verb: '整地', trade: '人足' },
      { key: 'dig', name: '堀 掘削', verb: '掘削', trade: '土工' },
      { key: 'ishi', name: '石垣', verb: '积石', trade: '石工', order: 'z' },
      { key: 'water', name: '注水', verb: '注水', trade: '人足', after: ['ishi'], near: 6, on: ['site'] },
      { key: 'soseki', name: '礎石', verb: '据石', trade: '石工', on: ['ishi', 'site'] },
      { key: 'col', name: '立柱', verb: '立柱', trade: '大工', on: ['soseki', 'beam'] },
      { key: 'beam', name: '架梁·床', verb: '架梁', trade: '大工', on: ['col'] },
      { key: 'roof', name: '屋根下地', verb: '铺野地', trade: '大工', on: ['beam', 'col'] },
      { key: 'wall', name: '壁·窓', verb: '塗壁', trade: '左官', on: ['col', 'soseki', 'beam', 'roof'] },
      { key: 'tile', name: '葺瓦', verb: '葺瓦', trade: '瓦工', order: '-z', on: ['roof'] },
      { key: 'gold', name: '金鯱·金具', verb: '装金', trade: '錺師', on: ['tile'] },
    ],
    mats: { soil: { name: '土', rho: 1.7 }, granite: { name: '花岗岩', rho: 2.65 }, fill: { name: '栗石·盛土', rho: 1.9 }, water: { name: '水', rho: 1.0 }, timber: { name: '桧·欅', rho: 0.5 }, board: { name: '杉 野地', rho: 0.45 }, wall: { name: '土壁·黒漆板', rho: 1.5 }, tile: { name: '本瓦（含葺土）', rho: 1.45 }, gold: { name: '木胎金箔', rho: 0.9 } },
    rates: { '石工': 150, '大工': 4, '左官': 12, '瓦工': 10, '錺師': 0.8, '人足': 50 },
    digRate: 2500, fillRate: 8000, minDays: 2, t0: new Date(1583, 8, 1),
  };
  const levels = [{ y: -18, n: '堀底' }, { y: -11, n: '水位' }, { y: 0, n: '本丸' }, { y: BH, n: '天守台' }, ...tLv.map(L => ({ y: L.floor, n: (L.i + 1) + ' 重' })), { y: tLv[tLv.length - 1].yTop + tenshuTiers[4].rise + 0.88, n: '大棟' }];
  return { parts, rules, levels, ruleParams: RULE, title: '大阪城 天守 · 筑城图', dwg: 'OSK-T' };
}
G.SEQ_OSAKA = { build };
})(typeof window !== 'undefined' ? window : globalThis);
