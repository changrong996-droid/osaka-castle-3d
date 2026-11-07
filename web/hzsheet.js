'use strict';
// ===== 杭州西站 r2 · 实时图纸（Canvas 2D，与 3D 同一份构件 / 姿态 / 时刻数据；只在时间变化时重画）=====
// A-301 横剖面 B–B（x = 39 m，向东看：穿过云谷、梭形柱、提升塔）· A-101 屋盖网架平面（1 432 格 / 11 456 杆按状态）· A-501 提升图（姿态曲线 + 吊点凸包校核）
(function (G) {
  const HZS = {};
  const C = { paper: '#f6f2ea', ink: '#1d1a17', ink2: '#5d564c', ink3: '#948b7d', line: '#d4cbbb', red: '#b3202a', red2: '#e6bab4', red3: '#f3dcd8', ghost: 'rgba(179,32,42,.28)', temp: '#c46a12' };
  const MONO = '"SF Mono","JetBrains Mono",Menlo,Consolas,"DejaVu Sans Mono","Noto Sans Mono CJK SC",monospace';
  const SANS = '"PingFang SC","Noto Sans CJK SC","Microsoft YaHei","WenQuanYi Micro Hei",sans-serif';
  const f1 = v => (Math.abs(v) < 0.005 ? 0 : v).toFixed(1), f2 = v => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);
  const fmt = n => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');

  HZS.make = function (HZ) {
    const P = HZ.P, K = HZ.K, X0 = 39;
    // 状态：-1 未建 / 0..1 在建（进度）/ 2 已建 / 3 已拆
    const stOf = (p, t) => { if (p.st == null || t < p.st) return -1; if (p.rm && p.rm[0] >= 0 && t >= p.rm[0]) return t >= p.rm[0] + p.rm[1] ? 3 : 2; return t < p.st + p.du ? (t - p.st) / p.du : 2; };
    // ---- 剖面数据：与 x = X0 相交的静止盒子；切片内的网架格；屋面行 ----
    const secBoxes = [], secCells = [], skinRows = [];
    for (const a of HZ.acts) for (const p of a.parts) { if (p.grp || p.cells) continue; for (const b of p.geo.boxes) if (b.min[0] <= X0 && b.max[0] >= X0 && b.max[1] - b.min[1] > 0.05) secBoxes.push({ p, a, b, temp: a.kind === 'temp' }); }
    for (const a of HZ.acts) for (const p of a.parts) if (p.cells) for (const c of p.cells) if (c.xa <= X0 && c.xb > X0) secCells.push({ p, c });
    const clad = K.clad.parts.filter(p => p.mat === 'clad'); for (const p of clad) skinRows.push({ p, z0: p.geo.min[2], z1: p.geo.max[2] });
    const skinZ = []; for (let z = -P.roofB; z <= P.roofB; z += 1.5) if (HZ.rho(X0, z) <= 1) skinZ.push(z);
    const lifters = HZ.lifters, strands = HZ.strands;
    const rowOfZ = z => skinRows.find(r => z >= r.z0 - 0.01 && z <= r.z1 + 0.01);
    // 平面：所有格 → 所在行构件（时刻）
    const cellPart = new Map(); for (const a of HZ.acts) for (const p of a.parts) if (p.cells) for (const c of p.cells) cellPart.set(c, p);
    let rodsTot = 0; for (const c of HZ.cells) rodsTot += c.rods.length; HZS.rodsTot = rodsTot;

    // ---- 公共：图框 + 标题栏 ----
    function frame(g, w, h, o) {
      g.fillStyle = C.paper; g.fillRect(0, 0, w, h);
      const tb = o.tb; g.strokeStyle = C.ink; g.lineWidth = 1; g.strokeRect(3.5, 3.5, w - 7, h - 7); g.lineWidth = 0.6; g.strokeRect(6.5, 6.5, w - 13, h - 13);
      // 标题栏（底部一条）：图号 | 图名 | 比例 | 修订 | 日期 | 校核
      const y = h - 6.5 - tb; g.beginPath(); g.moveTo(6.5, y); g.lineTo(w - 6.5, y); g.stroke();
      const nm = Array.isArray(o.name) ? o.name : [o.name, o.name]; g.font = `600 ${tb >= 20 ? 10 : 9}px ${SANS}`; const cells = [[o.no, 1, C.red, true], [nm[0], 0, C.ink, true], [o.scale, 1, C.ink2], ['修订 r' + String(o.rev).padStart(3, '0'), 1, C.red], [o.date, 1, C.ink2], [o.chk, 1, o.chkOk ? '#2f7a3a' : C.red]];
      const fs = tb >= 20 ? 10 : 9, pad = 6; g.font = `${fs}px ${MONO}`; g.textBaseline = 'middle';
      const ws = cells.map(c => g.measureText(c[0]).width + pad * 2); let avail = w - 13, keep = cells.map(() => true);
      // 放不下就从右往左去掉日期、比例、校核
      for (const k of [4, 2, 5, 3, 1]) { if (ws.reduce((s, v, i) => s + (keep[i] ? v : 0), 0) <= avail) break; if (k === 1) { cells[1][0] = nm[1]; g.font = `600 ${fs}px ${SANS}`; ws[1] = g.measureText(nm[1]).width + pad * 2; continue; } keep[k] = false; }
      let x = 6.5; const tot = ws.reduce((s, v, i) => s + (keep[i] ? v : 0), 0), extra = Math.max(0, (avail - tot)) ; 
      cells.forEach((c, i) => { if (!keep[i]) return; const cw = ws[i] + (i === 1 ? extra : 0); g.fillStyle = c[2]; g.font = `${c[3] ? '600 ' : ''}${fs}px ${i === 1 ? SANS : MONO}`; let tx = c[0];
        while (g.measureText(tx).width > cw - pad * 2 && tx.length > 2) tx = tx.slice(0, -1); g.fillText(tx, x + pad, y + tb / 2 + 0.5); x += cw; if (x < w - 8) { g.strokeStyle = C.ink; g.lineWidth = 0.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x, h - 6.5); g.stroke(); } });
      return { x0: 8, y0: 8, x1: w - 8, y1: y - 2 };
    }
    const labels = []; const freeAt = (x, y, w, h, box) => x >= box.x0 && y >= box.y0 && x + w <= box.x1 && y + h <= box.y1 && labels.every(r => x + w < r[0] || x > r[2] || y + h < r[1] || y > r[3]);
    function label(g, txt, x, y, col, box, o) { o = o || {}; const fs = o.fs || 9; g.font = `${o.b ? '600 ' : ''}${fs}px ${o.sans ? SANS : MONO}`; const w = g.measureText(txt).width, h = fs + 2;
      const al = o.al || 'l', lx = al === 'c' ? x - w / 2 : al === 'r' ? x - w : x, ly = y - h / 2;
      if (!freeAt(lx - 1, ly, w + 2, h, box)) return false; labels.push([lx - 1, ly, lx + w + 1, ly + h]);
      g.textBaseline = 'middle'; g.lineWidth = 3; g.strokeStyle = C.paper; g.lineJoin = 'round'; g.strokeText(txt, lx, y); g.fillStyle = col || C.ink; g.fillText(txt, lx, y); return true; }
    function dimV(g, x, ya, yb, txt, col, box, side) { g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x, ya); g.lineTo(x, yb); g.stroke();
      for (const [yy, d] of [[ya, 1], [yb, -1]]) { g.beginPath(); g.moveTo(x - 4, yy); g.lineTo(x + 4, yy); g.stroke(); g.beginPath(); g.moveTo(x, yy); g.lineTo(x - 2.2, yy + d * 5 * Math.sign(yb - ya || 1)); g.lineTo(x + 2.2, yy + d * 5 * Math.sign(yb - ya || 1)); g.fill(); }
      label(g, txt, x + (side < 0 ? -6 : 6), (ya + yb) / 2, col, box, { al: side < 0 ? 'r' : 'l', b: true }); }
    function dimH(g, xa, xb, y, txt, col, box) { g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 0.8; g.beginPath(); g.moveTo(xa, y); g.lineTo(xb, y); g.stroke();
      for (const xx of [xa, xb]) { g.beginPath(); g.moveTo(xx, y - 4); g.lineTo(xx, y + 4); g.stroke(); } label(g, txt, (xa + xb) / 2, y + 9, col, box, { al: 'c', b: true }); }
    let hatch = null; const hatchOf = g => { if (hatch) return hatch; const c = document.createElement('canvas'); c.width = c.height = 6; const q = c.getContext('2d'); q.strokeStyle = 'rgba(29,26,23,.55)'; q.lineWidth = 0.7; q.beginPath(); q.moveTo(0, 6); q.lineTo(6, 0); q.stroke(); hatch = g.createPattern(c, 'repeat'); return hatch; };

    // ================= A-301 横剖面 =================
    function section(g, w, h, t, ctx) {
      labels.length = 0; const box = frame(g, w, h, ctx.tb(w, h, 'HZW-A-301', ['横剖面 B–B · x = 39 m · 向东看' + (ctx.lastVe > 1 ? ' · 竖向 ×' + ctx.lastVe : ''), '横剖面 B–B' + (ctx.lastVe > 1 ? ' · 竖向 ×' + ctx.lastVe : '')], t));
      const gut = Math.min(64, Math.max(40, (box.x1 - box.x0) * 0.12)), z0 = -172, z1 = 246, y0 = -12, y1 = 84, dw = box.x1 - box.x0 - gut - 6, dh = box.y1 - box.y0 - 14;
      const s = Math.min(dw / (z1 - z0), dh / (y1 - y0)), ve = Math.max(1, Math.min(2, Math.floor(dh / (y1 - y0) / s * 2) / 2)), sy = s * ve, ox = box.x0 + 4 + (dw - (z1 - z0) * s) / 2, oy = box.y0 + 12 + (dh - (y1 - y0) * sy) / 2 + (y1 - y0) * sy;
      const X = z => ox + (z - z0) * s, Y = y => oy - (y - y0) * sy; ctx.setScale(s); ctx.ve = ve;
      const dbox = { x0: box.x0, y0: box.y0, x1: box.x1 - gut, y1: box.y1 };
      // 地面
      g.strokeStyle = C.ink; g.lineWidth = 1.2; g.beginPath(); g.moveTo(X(z0), Y(0)); g.lineTo(X(z1), Y(0)); g.stroke();
      g.strokeStyle = 'rgba(93,86,76,.35)'; g.lineWidth = 0.6; for (let z = z0; z < z1; z += 9) { g.beginPath(); g.moveTo(X(z), Y(0)); g.lineTo(X(z) - 4, Y(0) + 4); g.stroke(); }
      // 静止构件剖切
      for (const e of secBoxes) { const st = stOf(e.p, t); if (st === 3) continue; const b = e.b, x = X(b.min[2]), y = Y(b.max[1]), ww = Math.max(0.8, (b.max[2] - b.min[2]) * s), hh = Math.max(0.8, (b.max[1] - b.min[1]) * s);
        if (st < 0) { g.setLineDash([2, 2]); g.strokeStyle = C.ghost; g.lineWidth = 0.5; g.strokeRect(x, y, ww, hh); g.setLineDash([]); continue; }
        if (st < 2) { g.fillStyle = C.red3; const hp = hh * Math.min(1, st * 1.05); g.fillRect(x, y + hh - hp, ww, hp); g.strokeStyle = C.red; g.lineWidth = 1.1; g.strokeRect(x, y + hh - hp, ww, hp); continue; }
        if (e.temp) { g.strokeStyle = C.temp; g.lineWidth = 0.8; g.strokeRect(x, y, ww, hh); continue; }
        g.fillStyle = hatchOf(g); g.fillRect(x, y, ww, hh); g.strokeStyle = C.ink; g.lineWidth = 0.7; g.strokeRect(x, y, ww, hh); }
      // 屋面（金属屋面 + 吊顶）
      g.lineWidth = 1.1; for (let i = 0; i + 1 < skinZ.length; i++) { const za = skinZ[i], zb = skinZ[i + 1], r = rowOfZ((za + zb) / 2); if (!r) continue; const st = stOf(r.p, t); if (st === 3) continue;
        g.strokeStyle = st < 0 ? C.ghost : st < 2 ? C.red : C.ink; if (st < 0) g.setLineDash([3, 2]); g.beginPath(); g.moveTo(X(za), Y(HZ.Hc(X0, za))); g.lineTo(X(zb), Y(HZ.Hc(X0, zb))); g.moveTo(X(za), Y(HZ.Hs(X0, za))); g.lineTo(X(zb), Y(HZ.Hs(X0, zb))); g.stroke(); g.setLineDash([]); }
      // 网架切片（随姿态）
      const ps = HZ.pose(t); let lowGap = 1e9, lowZ = 0, lowY = 0;
      g.lineWidth = 0.7;
      for (const { p, c } of secCells) { const st = stOf(p, t); const ghost = st < 0, cur = st >= 0 && st < 2; g.strokeStyle = ghost ? C.ghost : cur ? C.red : C.ink; if (ghost) g.setLineDash([2, 2]);
        g.beginPath(); for (const [a0, b0] of c.rods) { const a = ghost ? a0 : HZ.xf(ps, c.grp, a0), b = ghost ? b0 : HZ.xf(ps, c.grp, b0); g.moveTo(X(a[2]), Y(a[1])); g.lineTo(X(b[2]), Y(b[1]));
          if (!ghost && c.grp && Math.abs(a[2]) <= P.floorZ && Math.abs(a[2]) >= P.gap && t < K.wlift.end + 1) { const lo = Math.min(a[1], b[1]) - 0.3 - P.floorTop; if (lo < lowGap) { lowGap = lo; lowZ = a[2]; lowY = Math.min(a[1], b[1]) - 0.3; } } }
        g.stroke(); g.setLineDash([]); }
      // 设计姿态幽灵（屋盖已拼、未到位时）：下弦设计线
      const roofOn = t >= K.asm1.start && t < K.head.end;
      // 钢绞线 + 提升器
      if (t >= K.rig.start + K.rig.dur * 0.6 && t < K.rig.rm.start + K.rig.rm.dur * 0.3) { g.strokeStyle = C.red; g.lineWidth = 0.6; g.beginPath();
        for (const sd of strands) { if (Math.abs(sd.a[0] - X0) > 4) continue; const b = HZ.xf(ps, sd.gb, sd.b); g.moveTo(X(sd.a[2]), Y(sd.a[1])); g.lineTo(X(b[2]), Y(b[1])); } g.stroke(); }
      // ---- 标注 ----
      // 云谷
      dimH(g, X(-P.gap), X(P.gap), Y(P.deckBot) + 10, '云谷 28 m', C.red, dbox);
      // 标高栏
      const gx = box.x1 - gut + 2; g.strokeStyle = C.line; g.lineWidth = 0.6; g.beginPath(); g.moveTo(gx - 2, box.y0 + 2); g.lineTo(gx - 2, box.y1); g.stroke();
      const gb = { x0: gx, y0: box.y0, x1: box.x1, y1: box.y1 }, lv = [['±0.00', 0], ['+12.50 承轨', P.deckTop], ['+24.00 候车', P.floorTop], ['−9.20 地铁', -9.2]];
      const apex = t >= K.asm2.start ? HZ.Ht(X0, 0) + ps[2].dy : null; if (apex != null) lv.unshift(['+' + f2(apex) + ' 屋盖', apex]);
      for (const [n, y] of lv) { const yy = Y(y); g.strokeStyle = C.red; g.lineWidth = 0.6; g.setLineDash([3, 2]); g.beginPath(); g.moveTo(gx, yy); g.lineTo(box.x1, yy); g.stroke(); g.setLineDash([]); label(g, n, gx + 2, yy - 6, C.red, gb, { fs: 8.5 }); }
      // 净空 / 距设计位 / 转角
      if (roofOn && lowGap < 1e8) { dimV(g, X(lowZ), Y(P.floorTop), Y(lowY), '净空 ' + f2(lowGap) + ' m', C.red, dbox, lowZ > 0 ? -1 : 1); }
      if (roofOn) { const zz = 78, dsg = HZ.Ht(X0, zz) - (HZ.inSky(X0, zz) ? P.depthSky : P.depth), cur = HZ.xf(ps, 1, [X0, dsg, zz]), d = dsg - cur[1];
        if (d > 0.05) { g.strokeStyle = C.ghost; g.setLineDash([4, 3]); g.lineWidth = 0.8; g.beginPath(); g.moveTo(X(50), Y(dsg)); g.lineTo(X(150), Y(HZ.Ht(X0, 150) - P.depth)); g.stroke(); g.setLineDash([]); dimV(g, X(zz), Y(cur[1]), Y(dsg), '距设计位 ' + f2(d) + ' m', C.red, dbox, 1); } }
      for (const [zone, zA, sgn, key] of [[1, P.roofB, 1, 'lift1'], [3, -P.roofB, -1, 'lift3']]) { const A = K[key]; if (!(t >= A.start - 2 && t < K.wlift.end + 2)) continue; const r = ps[zone].r, ang = 4 * (1 - r), px = X(zA), py = Y(P.roofLo + ps[zone].dy);
        g.strokeStyle = C.red; g.fillStyle = C.paper; g.lineWidth = 1.2; g.beginPath(); g.arc(px, py, 3.6, 0, Math.PI * 2); g.fill(); g.stroke(); g.beginPath(); g.arc(px, py, 1.2, 0, Math.PI * 2); g.fillStyle = C.red; g.fill();
        const R = 70 * s, s0 = s; g.lineWidth = 0.8; g.beginPath(); g.moveTo(px, py); g.lineTo(px - sgn * R, py); g.stroke(); const a1 = sgn > 0 ? Math.PI : 0, a2 = a1 + sgn * (-ang * Math.PI / 180) * 1; g.beginPath(); g.arc(px, py, R * 0.8, Math.min(a1, a2), Math.max(a1, a2)); g.stroke();
        label(g, '铰 · 已转 ' + f1(4 - ang) + '°/4°', px - sgn * 6, py - 12, C.red, dbox, { al: sgn > 0 ? 'r' : 'l', b: true }); }
      if (t >= K.wlift.start - 1 && t < K.head.end) label(g, '整体提升 D = ' + f1(HZ.D) + ' m · 已升 ' + f2((HZ.D - 0.6) * ps.w) + ' m', X(-150), Y(70), C.red, dbox, { b: true, fs: 9.5 });
      label(g, 'B–B', box.x0 + 4, box.y0 + 7, C.ink2, box, { fs: 9, b: true }); label(g, '北', X(z0) + 2, Y(-6), C.ink2, dbox, { fs: 8.5, sans: true }); label(g, '南', X(z1) - 2, Y(-6), C.ink2, dbox, { fs: 8.5, sans: true, al: 'r' });
      return { secCells: secCells.length, secBoxes: secBoxes.length };
    }

    // ================= A-101 屋盖网架平面 =================
    function plan(g, w, h, t, ctx) {
      labels.length = 0; const box = frame(g, w, h, ctx.tb(w, h, 'HZW-A-101', ['屋盖网架平面 · 1 432 格 / ' + fmt(rodsTot) + ' 杆', '屋盖网架平面'], t));
      const z0 = -172, z1 = 172, x0 = -130, x1 = 130, dw = box.x1 - box.x0 - 8, dh = box.y1 - box.y0 - 16, s = Math.min(dw / (z1 - z0), dh / (x1 - x0));
      const ox = box.x0 + 4 + (dw - (z1 - z0) * s) / 2, oy = box.y0 + 14 + (dh - (x1 - x0) * s) / 2; ctx.setScale(s);
      const X = z => ox + (z - z0) * s, Y = x => oy + (x1 - x) * s;   // 北在左、东在上
      // 底图：站台（已建）淡线
      g.strokeStyle = 'rgba(93,86,76,.22)'; g.lineWidth = 0.5; for (const yk of ['S', 'N']) for (const pl of HZ.platforms(HZ.YARDS[yk])) { const pp = (yk === 'S' ? K.platS : K.platN); if (t < pp.start) continue; g.strokeRect(X(pl.z - pl.w / 2), Y(130), pl.w * s, 260 * s); }
      // 格
      const ps = HZ.pose(t); let inst = 0, cur = 0;
      for (const c of HZ.cells) { const p = cellPart.get(c), st = stOf(p, t), x = X(c.za), y = Y(c.xb), sz = Math.max(0.6, 7 * s - 0.6);
        if (st < 0) { g.strokeStyle = 'rgba(179,32,42,.22)'; g.lineWidth = 0.4; g.strokeRect(x + 0.3, y + 0.3, sz, sz); continue; }
        const moving = c.grp && ps[c.grp] && ps[c.grp].moving || (c.grp && ps.w > 0 && ps.w < 1);
        const atFloor = c.grp >= 1 && c.grp <= 4 && t < K.wlift.end - 0.01;
        let fc; if (st < 2) { fc = C.red; cur++; inst += c.rods.length * st; } else { inst += c.rods.length; fc = moving ? C.red2 : atFloor ? '#b9b0a2' : ''; }
        if (fc) { g.fillStyle = fc; g.fillRect(x + 0.3, y + 0.3, sz, sz); continue; }
        // r3：已到位 = 细墨线 + 浅底（竣工不再是一整块黑）；十字采光带浅蓝灰、加斜线
        const sky = HZ.inSky(c.xc, c.zc); g.fillStyle = sky ? '#cfd6d8' : '#e6dfd2'; g.fillRect(x + 0.3, y + 0.3, sz, sz);
        g.strokeStyle = sky ? 'rgba(29,26,23,.55)' : 'rgba(29,26,23,.42)'; g.lineWidth = 0.5; g.strokeRect(x + 0.55, y + 0.55, sz - 0.5, sz - 0.5);
        if (sky && sz > 3) { g.beginPath(); g.moveTo(x + 0.6, y + sz); g.lineTo(x + sz, y + 0.6); g.stroke(); } }
      // 分区线 + 名称
      g.strokeStyle = C.red; g.lineWidth = 0.7; g.setLineDash([5, 2, 1, 2]); for (const zz of [-P.midZ - 7, -P.midZ, P.midZ, P.midZ + 7]) { g.beginPath(); g.moveTo(X(zz), Y(126)); g.lineTo(X(zz), Y(-126)); g.stroke(); } g.setLineDash([]);
      // 柱、提升点
      for (const m of HZ.masts) { const on = t >= m.part.st; g.fillStyle = C.ink; g.strokeStyle = C.ghost; g.lineWidth = 0.8; g.beginPath(); g.arc(X(m.z), Y(m.x), Math.max(1.6, 2.4 * s), 0, Math.PI * 2); on ? g.fill() : g.stroke(); }
      const rigOn = t >= K.rig.start + K.rig.dur * 0.6 && t < K.rig.rm.end; if (rigOn) for (const L of lifters) { const x = X(L.z), y = Y(L.x), r = Math.max(2.2, 3.2 * s); g.strokeStyle = C.red; g.lineWidth = 1; g.strokeRect(x - r, y - r, 2 * r, 2 * r); g.beginPath(); g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); g.stroke(); }
      // 剖切线 B–B（x = 39）
      g.strokeStyle = C.ink; g.lineWidth = 0.8; g.setLineDash([8, 3, 2, 3]); g.beginPath(); g.moveTo(X(-168), Y(X0)); g.lineTo(X(168), Y(X0)); g.stroke(); g.setLineDash([]);
      for (const zz of [-168, 168]) { g.fillStyle = C.paper; g.beginPath(); g.arc(X(zz), Y(X0), 5, 0, Math.PI * 2); g.fill(); g.stroke(); g.fillStyle = C.ink; g.font = `600 7px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('B', X(zz), Y(X0) + 0.5); g.textAlign = 'left'; }
      for (const [n, zz] of [['北区', -110], ['中区', 0], ['南区', 110]]) label(g, n, X(zz), Y(-118), C.ink2, box, { al: 'c', fs: 8.5, sans: true });
      label(g, '杆件 ' + fmt(inst) + ' / ' + fmt(rodsTot), box.x0 + 4, box.y0 + 7, C.ink, box, { b: true, fs: 9.5 });
      label(g, '↑东  ←北', box.x1 - 4, box.y0 + 7, C.ink2, box, { al: 'r', fs: 8.5, sans: true });
      return { inst, cur };
    }

    // ================= A-501 提升图 =================
    const LT0 = K.lift1.start - 3, LT1 = K.head.end + 2;
    const curveOf = (zone, t) => { const ps = HZ.pose(t); if (zone === 2) return ps[2].dy; const zi = zone === 1 ? 45.5 : -45.5, p = [0, HZ.Ht(0, zi) - P.depth, zi], q = HZ.xf(ps, zone, p); return q[1] - p[1]; };
    const hull = pts => { pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up = []; for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); } for (const p of pts.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); } return lo.slice(0, -1).concat(up.slice(0, -1)); };
    const zoneGeo = {}; for (const z of [1, 2, 3]) { const cs = HZ.cells.filter(c => c.grp === z); zoneGeo[z] = { cg: [cs.reduce((s, c) => s + c.xc, 0) / cs.length, cs.reduce((s, c) => s + c.zc, 0) / cs.length], H: hull(HZ.lifters.filter(l => l.zone === z).map(l => [l.x, l.z])), n: HZ.lifters.filter(l => l.zone === z).length, cells: cs };
      const H = zoneGeo[z].H, p = zoneGeo[z].cg; zoneGeo[z].ok = H.every((a, i) => { const b = H[(i + 1) % H.length]; return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0; }); }
    // 时间轴放大：提升段（各 3–5 日）与合龙（10 日）等宽显示
    const segs = [[LT0, K.lift1.start], [K.lift1.start, K.lift1.end], [K.lift2.start, K.lift2.end], [K.lift3.start, K.lift3.end], [K.merge.start, K.merge.end], [K.wlift.start, K.wlift.end], [K.wlift.end, LT1]];
    const segW = [0.4, 1.3, 1, 1.3, 0.7, 1.3, 0.5], segT = segW.reduce((a, b) => a + b, 0);
    const tx = t => { let acc = 0; for (let i = 0; i < segs.length; i++) { const [a, b] = segs[i]; if (t <= b || i === segs.length - 1) { const f = b > a ? Math.max(0, Math.min(1, (t - a) / (b - a))) : 1; return (acc + f * segW[i]) / segT; } acc += segW[i]; } return 1; };
    function lift(g, w, h, t, ctx) {
      labels.length = 0; const box = frame(g, w, h, ctx.tb(w, h, 'HZW-A-501', ['屋盖提升图 · 姿态 + 吊点校核', '屋盖提升图'], t));
      const bw = box.x1 - box.x0, side = bw > 300 && (box.y1 - box.y0) > 90 ? Math.min(bw * 0.3, (box.y1 - box.y0) * 1.1) : 0;
      const cx0 = box.x0 + 30, cx1 = box.x1 - side - 10, cy0 = box.y0 + 16, cy1 = box.y1 - 14, ymin = -HZ.D - HZ.innerDrop - 0.5, ymax = 0.8;
      const PX = t => cx0 + tx(t) * (cx1 - cx0), PY = v => cy0 + (ymax - v) / (ymax - ymin) * (cy1 - cy0);
      // 坐标
      g.strokeStyle = C.line; g.lineWidth = 0.6; g.beginPath(); for (const v of [0, -HZ.D, -HZ.D - HZ.innerDrop]) { g.moveTo(cx0, PY(v)); g.lineTo(cx1, PY(v)); } g.stroke();
      label(g, '设计位 0', cx0 - 2, PY(0), C.ink2, box, { al: 'r', fs: 8 }); label(g, '−' + f1(HZ.D), cx0 - 2, PY(-HZ.D), C.ink2, box, { al: 'r', fs: 8 }); label(g, '−' + f1(HZ.D + HZ.innerDrop), cx0 - 2, PY(-HZ.D - HZ.innerDrop), C.ink2, box, { al: 'r', fs: 8 });
      for (const s of segs.slice(1, 6)) { g.strokeStyle = 'rgba(93,86,76,.25)'; g.beginPath(); g.moveTo(PX(s[0]), cy0); g.lineTo(PX(s[0]), cy1); g.stroke(); }
      // 曲线：已过 = 墨 / 未来 = 幽灵
      const N = 140, cols = { 1: C.ink, 2: C.ink2, 3: '#7a5a3a' };
      for (const z of [1, 2, 3]) { for (const fut of [false, true]) { g.strokeStyle = fut ? C.ghost : cols[z]; g.lineWidth = fut ? 0.8 : 1.4; g.setLineDash(fut ? [3, 2] : []); g.beginPath(); let started = false;
          for (let i = 0; i <= N; i++) { const tt = LT0 + (LT1 - LT0) * i / N; if (fut ? tt < t : tt > t) { if (!fut && started) break; continue; } const x = PX(tt), y = PY(curveOf(z, tt)); if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y); }
          if (!fut && started && t < LT1) g.lineTo(PX(Math.min(t, LT1)), PY(curveOf(z, Math.min(t, LT1)))); g.stroke(); } }
      g.setLineDash([]);
      // 游标
      if (t >= LT0 && t <= LT1) { const x = PX(t); g.strokeStyle = C.red; g.lineWidth = 1; g.beginPath(); g.moveTo(x, cy0 - 4); g.lineTo(x, cy1 + 2); g.stroke(); for (const z of [1, 2, 3]) { g.fillStyle = C.red; g.beginPath(); g.arc(x, PY(curveOf(z, t)), 2.6, 0, Math.PI * 2); g.fill(); } }
      // 事件注记
      const ev = [[K.lift1.start + K.lift1.dur * 0.12, '脱胎 0.6 m', -HZ.D - HZ.innerDrop + 0.6], [K.lift1.start + K.lift1.dur * 0.6, '南区转 4°', -HZ.D - HZ.innerDrop * 0.4], [K.lift2.start + K.lift2.dur * 0.5, '中区', -HZ.D + 0.6], [K.lift3.start + K.lift3.dur * 0.6, '北区转 4°', -HZ.D - HZ.innerDrop * 0.4], [K.merge.start + K.merge.dur * 0.5, '合龙', -HZ.D + 0.6], [K.wlift.start + K.wlift.dur * 0.5, '整体 ' + f1(HZ.D) + ' m', -HZ.D * 0.5]];
      for (const [tt, n, v] of ev) label(g, n, PX(tt), PY(v) - 9, tt <= t ? C.ink : C.ink3, box, { al: 'c', fs: 8.5, sans: true });
      // 图例
      label(g, '— 南区内边  — 中区  — 北区内边（相对设计位，m）', cx0, box.y0 + 7, C.ink2, box, { fs: 8, sans: true });
      // 右：当前分区吊点凸包 + 重心
      if (side > 0) { const zone = t < K.lift2.start ? 1 : t < K.lift3.start ? 2 : 3, Z = zoneGeo[zone], sx0 = box.x1 - side, sy0 = box.y0 + 14, sw = side - 6, sh = box.y1 - sy0 - 14, sc = Math.min(sw / 330, sh / 250);
        const QX = z => sx0 + 3 + (z + 165) * sc, QY = x => sy0 + (125 - x) * sc;
        g.strokeStyle = C.line; g.lineWidth = 0.6; g.strokeRect(sx0, sy0 - 2, sw, sh + 4);
        g.fillStyle = 'rgba(29,26,23,.12)'; for (const c of Z.cells) g.fillRect(QX(c.za), QY(c.xb), 7 * sc, 7 * sc);
        g.strokeStyle = C.red; g.lineWidth = 1; g.beginPath(); Z.H.forEach((p, i) => i ? g.lineTo(QX(p[1]), QY(p[0])) : g.moveTo(QX(p[1]), QY(p[0]))); g.closePath(); g.stroke();
        for (const L of HZ.lifters) if (L.zone === zone) { g.fillStyle = C.red; g.fillRect(QX(L.z) - 1.8, QY(L.x) - 1.8, 3.6, 3.6); }
        const cgx = QX(Z.cg[1]), cgy = QY(Z.cg[0]); g.strokeStyle = C.ink; g.lineWidth = 1; g.beginPath(); g.arc(cgx, cgy, 3.5, 0, Math.PI * 2); g.moveTo(cgx - 6, cgy); g.lineTo(cgx + 6, cgy); g.moveTo(cgx, cgy - 6); g.lineTo(cgx, cgy + 6); g.stroke();
        label(g, ['', '南区', '中区', '北区'][zone] + ' ' + Z.n + ' 吊点', sx0 + 3, sy0 + 5, C.ink, { x0: sx0, y0: sy0 - 4, x1: box.x1, y1: box.y1 }, { fs: 8.5, sans: true });
        label(g, '重心∈凸包 ' + (Z.ok ? '✓' : '✕'), sx0 + 3, box.y1 - 6, Z.ok ? '#2f7a3a' : C.red, { x0: sx0, y0: sy0, x1: box.x1, y1: box.y1 }, { fs: 8.5, sans: true, b: true }); }
      return {};
    }
    // ================= S-301-1 千斤顶平面布置 + 剖面净空（set1：随时刻同步；字号放大）=================
    const devCol = (d, lim) => { const k = Math.min(1, Math.abs(d) / lim); return k < 0.35 ? '#2f7a3a' : k < 0.7 ? '#c48a12' : C.red; };
    const Hb = (x, z) => HZ.Ht(x, z) - (HZ.inSky(x, z) ? P.depthSky : P.depth);
    const zoneOfZ = z => Math.abs(z) <= P.midZ ? 2 : Math.abs(z) < P.midZ + 7 ? 4 : z > 0 ? 1 : 3;
    let zoneBB = null;
    function jack(g, w, h, t, ctx) {
      labels.length = 0; const J = HZ.jackRead(t), ps = J.pose, box = frame(g, w, h, ctx.tb(w, h, 'HZW-S-301-1', ['千斤顶平面布置 · 剖面净空 · ' + HZ.lifters.length + ' 吊点', '千斤顶平面 · 剖面净空'], t));
      const bw = box.x1 - box.x0, bh = box.y1 - box.y0, wide = bw / bh > 1.25, FS = Math.max(12, Math.min(14, Math.round(Math.min(bw, bh) / 26)));
      const pa = wide ? { x0: box.x0 + 2, y0: box.y0 + 2, x1: box.x0 + bw * 0.52, y1: box.y1 } : { x0: box.x0 + 2, y0: box.y0 + 2, x1: box.x1, y1: box.y0 + bh * 0.56 };
      const sa = wide ? { x0: pa.x1 + 8, y0: box.y0 + 2, x1: box.x1, y1: box.y1 } : { x0: box.x0 + 2, y0: pa.y1 + 6, x1: box.x1, y1: box.y1 };
      // ---- 平面：北左、东上 ----
      { const top = pa.y0 + FS + 8, bot = pa.y1 - FS - 8, z0 = -170, z1 = 170, x0 = -128, x1 = 128, s0 = Math.min((pa.x1 - pa.x0 - 8) / (z1 - z0), (bot - top) / (x1 - x0));
        // set2a：缩放平移（V.k 1–8 倍、V.px/py 屏幕像素）只作用在坐标映射上 → 线宽、字号保持屏幕像素不变；命中区按变换后的坐标输出
        const V = ctx.view || { k: 1, px: 0, py: 0 }, kz = V.k, pcx = (pa.x0 + pa.x1) / 2, pcy = (pa.y0 + pa.y1) / 2, s = s0 * kz;
        const ox0 = pa.x0 + 4 + (pa.x1 - pa.x0 - 8 - (z1 - z0) * s0) / 2, oy0 = top + (bot - top - (x1 - x0) * s0) / 2;
        const X = z => pcx + (ox0 + (z - z0) * s0 - pcx) * kz + V.px, Y = x => pcy + (oy0 + (x1 - x) * s0 - pcy) * kz + V.py;
        ctx.pa = pa; g.save(); g.beginPath(); g.rect(pa.x0, pa.y0, pa.x1 - pa.x0, pa.y1 - pa.y0); g.clip();
        g.beginPath(); for (let a = 0; a <= 96; a++) { const th = a / 96 * Math.PI * 2, r = HZ.R(th), xx = Math.cos(th) * r, zz = Math.sin(th) * r; a ? g.lineTo(X(zz), Y(xx)) : g.moveTo(X(zz), Y(xx)); } g.closePath(); g.fillStyle = '#ebe4d6'; g.fill(); g.strokeStyle = C.ink; g.lineWidth = 1; g.stroke();
        // 正在动的分区淡红
        const mv = J.act ? (J.act.key === 'wlift' ? [1, 2, 3, 4] : [J.act.liftZone]) : [];
        for (const c of HZ.cells) if (mv.includes(c.grp)) { g.fillStyle = 'rgba(179,32,42,.16)'; g.fillRect(X(c.za), Y(c.xb), 7 * s + 0.4, 7 * s + 0.4); }
        // set2b：选中分区（3D 点屋盖 / #focus=ZN|ZM|ZS）= 加深染色 + 红框；pm = k=1 时的映射，供图纸动画把目标放到中央
        if (!zoneBB) { zoneBB = {}; for (const z of [1, 2, 3]) { let a = 1e9, b = -1e9, c0 = 1e9, d = -1e9; for (const c of HZ.cells) if (c.grp === z) { a = Math.min(a, c.za); b = Math.max(b, c.za + 7); c0 = Math.min(c0, c.xb - 7); d = Math.max(d, c.xb); } zoneBB[z] = { z0: a, z1: b, x0: c0, x1: d }; } }
        if (ctx.zone >= 1 && ctx.zone <= 3) { const B = zoneBB[ctx.zone]; g.fillStyle = 'rgba(179,32,42,.30)'; for (const c of HZ.cells) if (c.grp === ctx.zone) g.fillRect(X(c.za), Y(c.xb), 7 * s + 0.4, 7 * s + 0.4); g.strokeStyle = C.red; g.lineWidth = 2.4; g.strokeRect(X(B.z0) - 2, Y(B.x1) - 2, (B.z1 - B.z0) * s + 4, (B.x1 - B.x0) * s + 4); }
        ctx.pm = { pcx, pcy, ox0, oy0, s0, z0, x1 }; ctx.zoneBB = zoneBB;
        g.strokeStyle = C.red; g.lineWidth = 0.8; g.setLineDash([6, 3]); for (const zz of [-P.midZ - 7, -P.midZ, P.midZ, P.midZ + 7]) { g.beginPath(); g.moveTo(X(zz), Y(118)); g.lineTo(X(zz), Y(-118)); g.stroke(); } g.setLineDash([]);
        // 旋转轴（南 / 北外缘）
        for (const zz of [P.roofB, -P.roofB]) { g.strokeStyle = C.ink2; g.lineWidth = 1; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(X(zz), Y(60)); g.lineTo(X(zz), Y(-60)); g.stroke(); g.setLineDash([]); }
        // 吊点：圈 = 提升器；填色 = 同步偏差（绿 ≤ 35 % 上限 / 黄 / 红）；不在本段 = 空心
        const r0 = Math.max(4, Math.min(7, 4.2 * s0 * 1.6)) * Math.min(1.8, Math.sqrt(kz)), hits = [];
        for (const r of J.rows) { const x = X(r.z), y = Y(r.x); g.beginPath(); g.arc(x, y, r0, 0, Math.PI * 2); if (r.on) { g.fillStyle = J.m && J.m.state === 'ext' ? devCol(r.dev, J.limit) : C.ink; g.fill(); } else { g.fillStyle = C.paper; g.fill(); g.strokeStyle = C.ink3; g.lineWidth = 1; g.stroke(); }
          if (x > pa.x0 && x < pa.x1 && y > pa.y0 && y < pa.y1) hits.push({ i: r.i, x, y, r: r0 }); }
        ctx.hits = hits;
        // 悬停 = 墨圈；选中 = 红色双圈（与 3D 高亮同一台）
        const jn = i => 'J' + String(i + 1).padStart(2, '0');
        for (const [i, col, lw, rr] of [[ctx.hover, C.ink, 1.6, r0 + 3.5], [ctx.sel, C.red, 2.4, r0 + 4]]) { if (!(i >= 0)) continue; const r = J.rows[i], x = X(r.z), y = Y(r.x); g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.stroke(); if (col === C.red) { g.lineWidth = 1; g.beginPath(); g.arc(x, y, rr + 4, 0, Math.PI * 2); g.stroke(); } }
        g.restore();
        for (const i of [ctx.sel, ctx.hover]) { if (!(i >= 0)) continue; const r = J.rows[i]; label(g, jn(i), X(r.z) + r0 + 9, Y(r.x) - r0 - 6, i === ctx.sel ? C.red : C.ink, pa, { fs: FS, b: true }); }
        // 读数：行程最大 / 最小的吊点
        const on = J.rows.filter(r => r.on); if (on.length) { const hi = on.reduce((a, b) => b.disp > a.disp ? b : a), lo = on.reduce((a, b) => b.disp < a.disp ? b : a);
          for (const r of hi === lo || Math.abs(hi.disp - lo.disp) < 0.05 ? [hi] : [hi, lo]) label(g, fmt(r.disp * 1000) + ' mm', X(r.z) + (r.z > 0 ? -r0 - 3 : r0 + 3), Y(r.x) - r0 - FS * 0.6, C.ink, pa, { fs: FS - 1, b: true, al: r.z > 0 ? 'r' : 'l' }); }
        if (kz >= 2.2) for (const r of J.rows) if (r.i !== ctx.sel && r.i !== ctx.hover) label(g, jn(r.i), X(r.z) + r0 + 4, Y(r.x) - r0 - 4, C.ink2, pa, { fs: FS - 2 });
        label(g, '千斤顶平面' + (kz > 1.01 ? ' ×' + kz.toFixed(1) : ''), pa.x0 + 4, pa.y0 + FS * 0.6 + 2, C.ink, pa, { fs: FS, b: true, sans: true });
        label(g, '同步差 ' + J.sync.toFixed(1) + ' / ' + J.limit + ' mm', pa.x1 - 4, pa.y0 + FS * 0.6 + 2, J.sync <= J.limit ? '#2f7a3a' : C.red, pa, { fs: FS, b: true, al: 'r', sans: true });
        for (const [n, zz] of [['北区', -105], ['中区', 0], ['南区', 105]]) label(g, n, X(zz), pa.y1 - FS * 0.6 - 2, C.ink2, pa, { al: 'c', fs: FS - 1, sans: true }); }
      // ---- 剖面：沿 z（南北）切 x = 39 m，向东看；竖向 ×4 ----
      { const XS = 39, VE = 4, top = sa.y0 + FS + 10, bot = sa.y1 - FS - 6, z0 = -168, z1 = 168, sx = (sa.x1 - sa.x0 - 12) / (z1 - z0), y0w = P.floorTop - 3, y1w = 62, sy = Math.min(sx * VE, (bot - top) / (y1w - y0w));
        const yOff = Math.max(0, (bot - top - (y1w - y0w) * sy) / 2), X = z => sa.x0 + 6 + (z - z0) * sx, Y = y => bot - yOff - (y - y0w) * sy;
        // 楼面（候车层，±14 m 云谷开口）
        g.fillStyle = 'rgba(29,26,23,.18)'; for (const [a, b] of [[-P.floorZ, -P.gap], [P.gap, P.floorZ]]) g.fillRect(X(a), Y(P.floorTop), X(b) - X(a), Math.max(2, (P.floorTop - P.floorBot) * sy));
        g.strokeStyle = C.ink; g.lineWidth = 1; g.beginPath(); for (const [a, b] of [[-P.floorZ, -P.gap], [P.gap, P.floorZ]]) { g.moveTo(X(a), Y(P.floorTop)); g.lineTo(X(b), Y(P.floorTop)); } g.stroke();
        // 设计位下弦（幽灵）与当前下弦
        const curve = (fn, col, lw, dash) => { g.strokeStyle = col; g.lineWidth = lw; g.setLineDash(dash || []); g.beginPath(); let st = false; for (let z = -160; z <= 160; z += 2) { const y = fn(z); if (y == null) { st = false; continue; } st ? g.lineTo(X(z), Y(y)) : g.moveTo(X(z), Y(y)); st = true; } g.stroke(); g.setLineDash([]); };
        curve(z => Hb(XS, z), C.ghost, 1, [4, 3]);
        const cur = z => { const gz = zoneOfZ(z); if (gz === 4 && t < K.merge.start) return null; return HZ.xf(ps, gz, [XS, Hb(XS, z), z])[1]; };
        curve(cur, C.ink, 1.8);
        // 提升塔 / 柱（竖线）
        g.strokeStyle = C.red; g.lineWidth = 1.4; for (const zz of P.towerZ) { g.beginPath(); g.moveTo(X(zz), Y(P.floorTop)); g.lineTo(X(zz), Y(HZ.Ht(XS, zz) + 4)); g.stroke(); }
        g.strokeStyle = C.ink2; for (const zz of P.mastZ) { g.beginPath(); g.moveTo(X(zz), Y(P.floorTop)); g.lineTo(X(zz), Y(Hb(XS, zz) - 1.5)); g.stroke(); }
        // 净空尺寸线：本剖面上楼面上方最低处
        let best = null; for (let z = -P.floorZ + 2; z <= P.floorZ - 2; z += 1) { if (Math.abs(z) < P.gap + 1) continue; const y = cur(z); if (y == null) continue; if (!best || y < best.y) best = { z, y }; }
        if (best) { const xx = X(best.z), ya = Y(P.floorTop), yb = Y(best.y), sd = best.z > 0 ? -1 : 1; g.strokeStyle = C.red; g.fillStyle = C.red; g.lineWidth = 1.2; g.beginPath(); g.moveTo(xx, ya); g.lineTo(xx, yb); for (const yy of [ya, yb]) { g.moveTo(xx - 5, yy); g.lineTo(xx + 5, yy); } g.stroke();
          label(g, '净空 ' + f2(best.y - P.floorTop) + ' m', xx + sd * 8, (ya + yb) / 2, C.red, sa, { fs: FS, b: true, al: sd < 0 ? 'r' : 'l' }); }
        label(g, '剖面 x = 39 m · 竖向 ×' + VE, sa.x0 + 4, sa.y0 + FS * 0.6 + 2, C.ink, sa, { fs: FS, b: true, sans: true });
        const gp = HZ.gap(ps, t); label(g, '全屋盖最小净空 ' + f2(gp.v) + ' m', sa.x1 - 4, sa.y1 - FS * 0.6 - 2, gp.v >= P.jigMin ? '#2f7a3a' : C.red, sa, { fs: FS - 1, b: true, al: 'r', sans: true });
        label(g, '北', X(-160), Y(P.floorTop) + FS, C.ink2, sa, { fs: FS - 1, sans: true }); label(g, '南', X(160), Y(P.floorTop) + FS, C.ink2, sa, { fs: FS - 1, sans: true, al: 'r' }); }
      g.strokeStyle = C.line; g.lineWidth = 0.8; g.beginPath(); if (wide) { g.moveTo(pa.x1 + 4, box.y0 + 6); g.lineTo(pa.x1 + 4, box.y1 - 4); } else { g.moveTo(box.x0 + 6, pa.y1 + 3); g.lineTo(box.x1 - 6, pa.y1 + 3); } g.stroke();
      return { sync: J.sync };
    }
    return { section, plan, lift, jack, stOf, rodsTot, X0 };
  };
  G.HZS = HZS;
})(window);
