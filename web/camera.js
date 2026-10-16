'use strict';
// ===== 相机物理体（web-r3）=====
// 相机 = 半径 R 的球体。由场景**真实几何**（所有建筑/墙/门/桥/天守/树的三角形）+ 高度网格派生一张柱状碰撞场：
//   T(cell) = 该格内最高的实体面（地形四角最大值、水面、几何三角形采样的最大 z，保守）
//   C(cell) = 邻域 (R + 采样步长) 内 T 的最大值 + R  → 球心 z ≥ C 即与一切实体/地面/水面保持 ≥R
// 不依赖 three.js（纯数组），浏览器里由 app.js 喂三角形；审计/测试也用同一套函数。
(function (root) {
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // easeInOutCubic

  function create(S, opt) {
    opt = opt || {};
    const R = opt.R || 1.5, gs = { x0: S.X(0), y0: S.Y(0) }, c = S.cell, NXc = S.NX - 1, NYc = S.NY - 1, n = NXc * NYc;
    const K = Math.ceil(R / c); // 精确保守栅格化 → 只需按 R 膨胀
    const T = new Float32Array(n);
    const H = S.H, NX = S.NX;
    for (let j = 0; j < NYc; j++) for (let i = 0; i < NXc; i++) { const a = j * NX + i; T[j * NXc + i] = Math.max(H[a], H[a + 1], H[a + NX], H[a + NX + 1], S.WZ); }
    let C = null, tris = 0, samples = 0;
    const keep = opt.keepTris ? [] : null; // 独立几何校验用（只在测试/审计时打开）
    const ci = x => Math.floor((x - gs.x0) / c), cj = y => Math.floor((y - gs.y0) / c);
    // 三角形 → 格：Sutherland–Hodgman 先按行带、再按列带裁剪（z 线性插值），每个被覆盖的格取裁剪多边形顶点的最大 z（平面上的最大值必在顶点上 → 精确且保守）
    const clipBand = (P, k, lo, hi) => { // k=0: x, 1: y；保留 lo ≤ P[k] ≤ hi
      let Q = P; for (const [sgn, v] of [[1, lo], [-1, hi]]) { const out = []; const n0 = Q.length; for (let i = 0; i < n0; i++) { const A = Q[i], B = Q[(i + 1) % n0], fa = sgn * (A[k] - v), fb = sgn * (B[k] - v); if (fa >= 0) out.push(A); if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]); } } Q = out; if (!Q.length) break; } return Q; };
    function mark(i, j, z) { if (i < 0 || j < 0 || i >= NXc || j >= NYc) return; const q = j * NXc + i; if (z > T[q]) T[q] = z; samples++; }
    function rasterTri(A, B, Cv) {
      const xmin = Math.min(A[0], B[0], Cv[0]), xmax = Math.max(A[0], B[0], Cv[0]), ymin = Math.min(A[1], B[1], Cv[1]), ymax = Math.max(A[1], B[1], Cv[1]), zmax = Math.max(A[2], B[2], Cv[2]);
      const i0 = ci(xmin), i1 = ci(xmax), j0 = cj(ymin), j1 = cj(ymax);
      if (i1 < 0 || j1 < 0 || i0 >= NXc || j0 >= NYc) return;
      if (i0 === i1 && j0 === j1) return mark(i0, j0, zmax);
      if (i0 === i1 || j0 === j1) { // 单行/单列：只需沿一个方向裁剪
        const k = i0 === i1 ? 1 : 0, a0 = i0 === i1 ? j0 : i0, a1 = i0 === i1 ? j1 : i1, o = k ? gs.y0 : gs.x0;
        for (let a = a0; a <= a1; a++) { const Q = clipBand([A, B, Cv], k, o + a * c, o + (a + 1) * c); if (Q.length) { let z = -1e9; for (const p of Q) if (p[2] > z) z = p[2]; k ? mark(i0, a, z) : mark(a, j0, z); } } return;
      }
      for (let j = j0; j <= j1; j++) { const Rw = clipBand([A, B, Cv], 1, gs.y0 + j * c, gs.y0 + (j + 1) * c); if (!Rw.length) continue; let x0 = 1e9, x1 = -1e9; for (const p of Rw) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; }
        const a0 = ci(x0), a1 = ci(x1); if (a0 === a1) { let z = -1e9; for (const p of Rw) if (p[2] > z) z = p[2]; mark(a0, j, z); continue; }
        for (let i = a0; i <= a1; i++) { const Q = clipBand(Rw, 0, gs.x0 + i * c, gs.x0 + (i + 1) * c); if (Q.length) { let z = -1e9; for (const p of Q) if (p[2] > z) z = p[2]; mark(i, j, z); } } }
    }
    // pos: three 坐标 (x, z_up, -y) 的扁平数组；idx 可选；m: 4x4 列主序矩阵（three .elements）可选；box=true 时只取变换后包围盒（实例化小物体如树冠，保守）
    function addTris(pos, idx, m, box) {
      const nv = idx ? idx.length : pos.length / 3;
      const tv = k => { let x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2]; if (m) { const X = m[0] * x + m[4] * y + m[8] * z + m[12], Y = m[1] * x + m[5] * y + m[9] * z + m[13], Z = m[2] * x + m[6] * y + m[10] * z + m[14]; x = X; y = Y; z = Z; } return [x, -z, y]; };
      if (box && !keep) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9; const nvv = pos.length / 3; for (let k = 0; k < nvv; k++) { const p = tv(k); if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; if (p[2] > z1) z1 = p[2]; }
        for (let j = cj(y0); j <= cj(y1); j++) for (let i = ci(x0); i <= ci(x1); i++) mark(i, j, z1); tris += nv / 3; return; }
      for (let t = 0; t + 2 < nv; t += 3) {
        const A = tv(idx ? idx[t] : t), B = tv(idx ? idx[t + 1] : t + 1), Cv = tv(idx ? idx[t + 2] : t + 2);
        if (keep) keep.push(A[0], A[1], A[2], B[0], B[1], B[2], Cv[0], Cv[1], Cv[2]);
        rasterTri(A, B, Cv); tris++;
      }
    }
    function finish() { // 可分离的方形膨胀（半宽 K 格）+ R
      const tmp = new Float32Array(n); C = new Float32Array(n);
      for (let j = 0; j < NYc; j++) { const o = j * NXc; for (let i = 0; i < NXc; i++) { let m = -1e9; for (let d = -K; d <= K; d++) { const ii = i + d; if (ii >= 0 && ii < NXc) { const v = T[o + ii]; if (v > m) m = v; } } tmp[o + i] = m; } }
      for (let j = 0; j < NYc; j++) for (let i = 0; i < NXc; i++) { let m = -1e9; for (let d = -K; d <= K; d++) { const jj = j + d; if (jj >= 0 && jj < NYc) { const v = tmp[jj * NXc + i]; if (v > m) m = v; } } C[j * NXc + i] = m + R; }
    }
    const outTop = (x, y) => { const g = S.regionAt ? S.regionAt(x, y) : null, h = g ? (g.name === 'city' ? 0 : g.z) : S.BED; return Math.max(h, S.WZ, 0); };
    const top = (x, y) => { const i = ci(x), j = cj(y); return (i < 0 || j < 0 || i >= NXc || j >= NYc) ? outTop(x, y) : T[j * NXc + i]; };
    const need = (x, y) => { const i = ci(x), j = cj(y); return (i < K || j < K || i >= NXc - K || j >= NYc - K) ? Math.max(outTop(x, y) + R, i >= -K && j >= -K && i < NXc + K && j < NYc + K ? (() => { let m = -1e9; for (let b = j - K; b <= j + K; b++) for (let a = i - K; a <= i + K; a++) if (a >= 0 && b >= 0 && a < NXc && b < NYc) m = Math.max(m, T[b * NXc + a]); return m + R; })() : -1e9) : C[j * NXc + i]; };
    const clear = (p, tol) => p[2] >= need(p[0], p[1]) - (tol || 0);
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    // 视线：相机 → 目标，0.5 格步长；目标周围 rf（水平）以内算“目标本体”，不算遮挡
    function los(cam, tgt, rf) {
      const L = dist(cam, tgt), N = Math.max(2, Math.ceil(L / (c * 0.5)));
      for (let k = 1; k < N; k++) { const t = k / N, x = lerp(cam[0], tgt[0], t), y = lerp(cam[1], tgt[1], t), z = lerp(cam[2], tgt[2], t); if (Math.hypot(x - tgt[0], y - tgt[1]) <= (rf || 0)) continue; if (z < top(x, y)) return { ok: false, t, p: [x, y, z] }; }
      return { ok: true };
    }
    // 每帧约束：不清空时取两种修正里位移小的——(a) 竖直抬到 C；(b) 沿视线朝目标收回到第一个清空点（保持 ≥ minD）
    function resolve(cam, tgt, minD) {
      if (clear(cam)) return null;
      const a = [cam[0], cam[1], need(cam[0], cam[1]) + 1e-3], da = a[2] - cam[2];
      const L = dist(cam, tgt), st = c * 0.25; let b = null;
      for (let s = st; s <= L - (minD || 0); s += st) { const t = s / L, p = [lerp(cam[0], tgt[0], t), lerp(cam[1], tgt[1], t), lerp(cam[2], tgt[2], t)]; if (s > da) break; if (clear(p)) { b = p; break; } }
      return b || a;
    }
    const floorAt = (x, y) => Math.max(S.surfaceAt ? S.surfaceAt(x, y) : top(x, y), S.WZ);
    // 视角预设：由规则（目标 + 方位角 + 仰角 + 距离）推出相机，若不清空/被遮挡则搜索代价最小的清空且通视位置
    function fromRule(r, f, del, daz) { const el = clamp(r.el + del, 1, 89.95) * Math.PI / 180, az = (r.az + daz) * Math.PI / 180, d = r.dist * f; return [r.target[0] + Math.cos(az) * Math.cos(el) * d, r.target[1] + Math.sin(az) * Math.cos(el) * d, r.target[2] + Math.sin(el) * d]; }
    let CANDS = null;
    function fixPreset(r) {
      if (!CANDS) { CANDS = []; for (const f of [1, 0.92, 0.85, 0.78, 0.7, 0.62, 0.55, 0.48, 1.1, 1.2, 1.35, 1.5]) for (let del = 0; del <= 60; del += 4) for (const daz of [0, 8, -8, 16, -16, 24, -24, 32, -32, 45, -45]) CANDS.push({ f, del, daz, cost: Math.abs(Math.log(f)) * 2 + del / 30 + Math.abs(daz) / 30 }); CANDS.sort((a, b) => a.cost - b.cost); }
      for (const k of CANDS) { if (r.el + k.del > 89.95 && k.del > 0) continue; const cam = fromRule(r, k.f, k.del, k.daz); if (clear(cam) && los(cam, r.target, r.rf).ok) return { cam, tgt: r.target.slice(), cost: k.cost, k }; }
      return { cam: fromRule(r, 1, 0, 0), tgt: r.target.slice(), cost: Infinity, k: null };
    }
    // 过渡路径：直线插值 + 抬升包络（任一采样点的缺口 d(u) 以余弦核展开到邻域，抬升 ≥ 缺口），保证全程清空
    function path(A, B, margin) {
      margin = margin === undefined ? 0.3 : margin;
      const L = dist(A.cam, B.cam), N = clamp(Math.ceil(L / (c * 0.5)), 2, 6000), d = new Float32Array(N + 1), lift = new Float32Array(N + 1), w = Math.min(0.5, Math.max(0.12, 40 / Math.max(L, 1)));
      for (let k = 0; k <= N; k++) { const u = k / N, x = lerp(A.cam[0], B.cam[0], u), y = lerp(A.cam[1], B.cam[1], u), z = lerp(A.cam[2], B.cam[2], u); const h = c * 0.5, nm = Math.max(need(x - h, y - h), need(x + h, y - h), need(x - h, y + h), need(x + h, y + h)); d[k] = Math.max(0, nm + margin - z); } // 采样间距 c/2，取 ±c/2 四点最大值 → 段上任一点所在格都被覆盖
      const W = Math.ceil(w * N);
      for (let k = 0; k <= N; k++) { if (d[k] <= 0) continue; const Wk = Math.max(1, Math.min(W, k, N - k)); for (let q = Math.max(0, k - Wk); q <= Math.min(N, k + Wk); q++) { const v = d[k] * 0.5 * (1 + Math.cos(Math.PI * Math.abs(q - k) / Wk)); if (v > lift[q]) lift[q] = v; } } // 核宽在两端收窄 → 端点抬升恰为 0（终点 = 预设）
      const maxLift = lift.reduce((m, v) => Math.max(m, v), 0);
      const at = t => { const u = ease(clamp(t, 0, 1)), f = u * N, k = Math.min(N - 1, Math.floor(f)), r = f - k, lz = lerp(lift[k], lift[k + 1], r);
        return { cam: [lerp(A.cam[0], B.cam[0], u), lerp(A.cam[1], B.cam[1], u), lerp(A.cam[2], B.cam[2], u) + lz], tgt: [lerp(A.tgt[0], B.tgt[0], u), lerp(A.tgt[1], B.tgt[1], u), lerp(A.tgt[2], B.tgt[2], u)] }; };
      return { at, L, maxLift, dur: 0.8 + 0.4 * Math.min(1, L / 1500) };
    }
    const linear = (A, B) => ({ at: t => { const k = clamp(t, 0, 1), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; return { cam: A.cam.map((v, i) => lerp(v, B.cam[i], e)), tgt: A.tgt.map((v, i) => lerp(v, B.tgt[i], e)) }; }, L: dist(A.cam, B.cam) });
    // 采样检查一条路径：每 ≤0.25 m 一个点
    function pathBad(P) { const N = clamp(Math.ceil((P.L + 1) / 0.25), 50, 40000); let bad = 0; for (let k = 0; k <= N; k++) { const t = k / N; if (!clear(P.at(t).cam, 1e-3)) bad++; } return bad; }

    // ---------- 独立几何校验（不用碰撞场）：三角形空间哈希，球-三角形精确距离 + 竖直向上射线（在任何几何之下 = 在体内/桥下/地下）+ 地形 ----------
    let GH = null;
    function geoIndex() {
      if (GH || !keep) return GH; const B = 8, map = new Map(), nt = keep.length / 9;
      for (let t = 0; t < nt; t++) { const o = t * 9; const x0 = Math.min(keep[o], keep[o + 3], keep[o + 6]), x1 = Math.max(keep[o], keep[o + 3], keep[o + 6]), y0 = Math.min(keep[o + 1], keep[o + 4], keep[o + 7]), y1 = Math.max(keep[o + 1], keep[o + 4], keep[o + 7]);
        for (let j = Math.floor(y0 / B); j <= Math.floor(y1 / B); j++) for (let i = Math.floor(x0 / B); i <= Math.floor(x1 / B); i++) { const k = i * 100003 + j; let a = map.get(k); if (!a) map.set(k, a = []); a.push(t); } }
      GH = { B, map }; return GH;
    }
    function ptTri(p, o) { // 点到三角形最近距离（Ericson）
      const k = keep, a = [k[o], k[o + 1], k[o + 2]], b = [k[o + 3], k[o + 4], k[o + 5]], cc = [k[o + 6], k[o + 7], k[o + 8]];
      const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]], dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
      const ab = sub(b, a), ac = sub(cc, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap); let q;
      if (d1 <= 0 && d2 <= 0) q = a; else { const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
        if (d3 >= 0 && d4 <= d3) q = b; else { const vc = d1 * d4 - d3 * d2;
          if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); q = [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]; } else { const cp = sub(p, cc), d5 = dot(ab, cp), d6 = dot(ac, cp);
            if (d6 >= 0 && d5 <= d6) q = cc; else { const vb = d5 * d2 - d1 * d6;
              if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); q = [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]; } else { const va = d3 * d6 - d5 * d4;
                if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); q = [b[0] + (cc[0] - b[0]) * w, b[1] + (cc[1] - b[1]) * w, b[2] + (cc[2] - b[2]) * w]; } else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]; } } } } } }
      return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    }
    function aboveTri(p, o) { // 竖直向上射线是否穿过三角形
      const k = keep, x = p[0], y = p[1], ax = k[o], ay = k[o + 1], bx = k[o + 3], by = k[o + 4], cx = k[o + 6], cy = k[o + 7];
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-9) return false;
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den, l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) return false; return l1 * k[o + 2] + l2 * k[o + 5] + l3 * k[o + 8] > p[2];
    }
    function geoCheck(p) { // 返回 null（干净）或原因字符串
      const G = geoIndex(); if (!G) return null; const rr = R * 0.98;
      for (const rho of [0, 0.5, 1.0, 1.4]) for (let a = 0; a < (rho ? 12 : 1); a++) { const x = p[0] + rho * Math.cos(a * Math.PI / 6), y = p[1] + rho * Math.sin(a * Math.PI / 6); if (p[2] - floorAt(x, y) < Math.sqrt(Math.max(0, rr * rr - rho * rho))) return 'ground'; }
      const seen = new Set();
      for (let j = Math.floor((p[1] - R) / G.B); j <= Math.floor((p[1] + R) / G.B); j++) for (let i = Math.floor((p[0] - R) / G.B); i <= Math.floor((p[0] + R) / G.B); i++) { const A = G.map.get(i * 100003 + j); if (A) for (const t of A) { if (seen.has(t)) continue; seen.add(t); if (ptTri(p, t * 9) < rr) return 'solid'; } }
      const A = G.map.get(Math.floor(p[0] / G.B) * 100003 + Math.floor(p[1] / G.B)); if (A) for (const t of A) if (aboveTri(p, t * 9)) return 'under';
      return null;
    }
    return { R, K, cell: c, addTris, finish, top, need, clear, los, resolve, floorAt, fromRule, fixPreset, path, linear, pathBad, geoCheck, stats: () => ({ tris, samples }), hasGeo: () => !!keep };
  }
  root.CASTLE_CAMERA = { create, ease };
})(typeof window !== 'undefined' ? window : globalThis);
