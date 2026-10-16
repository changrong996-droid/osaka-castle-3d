'use strict';
// ===== 相机物理体（web-r4：可穿过门洞/桥下的自由空间）=====
// 相机 = 半径 R 的球体。场景**真实几何**（建筑/墙/门/桥/天守三角形）+ 地形三角网 + 水面 + 树（实例包围盒，按柱体）。
// web-r3 只有柱状场：C(cell) = 邻域最高实体面 + R → 球心永远在一切几何之上，钻不进门洞。
// web-r4：
//   · 精确间隙 clearance(p)：3D 空间哈希（4×4×6 m 桶）里的三角形 + 地形三角网 + 水面 + 树柱的精确最近距离；球心合法 ⇔ 间隙 ≥ R。
//     柱状场保留为**充分条件快速通道**（球心高于 C 必合法，因为 C 是保守上包络），以及抬升兜底与旧逻辑对照。
//   · 可达性：自由空间 = 从天空（柱状场之上）出发，球体连续运动能到达的点。连续运动用扫掠保证（采样步长 0.5 m < 2R，
//     零厚度面也穿不过去）；瞬移（预设/重建/模糊测试跳转）要求落点“向上开放”（竖直扫掠到柱状场之上全程合法），
//     否则推到最近的开放合法点 —— 所以球不会出现在封闭建筑内部，但能从门洞两头走进去、从桥下穿过。
//   · 每帧：move(上一帧, 期望位置) = 扫掠 + 二分求接触点 + 沿接触面法向切平面滑移（≤3 次）。
//   · 过渡：直线可行就走直线；否则端点若在遮盖下（门洞里）先用 3D 栅格 Dijkstra 找到最近的开放点（逃逸段，拉直），
//     中段直线不行再用 r3 抬升包络（柱状场，必合法）。
//   · 步行：在 1 m 栅格上按“眼高 1.6 m 的球体合法 + 坡度 ≤30%”寻路（C6 / 穿门演示）。
// 不依赖 three.js（纯数组），浏览器里由 app.js 喂三角形；审计/测试也用同一套函数。
(function (root) {
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // easeInOutCubic
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  // 最近点（Ericson），无分配：结果写入 CP，返回距离平方
  const CP = [0, 0, 0];
  function ptTri2(px, py, pz, k, o) {
    const ax = k[o], ay = k[o + 1], az = k[o + 2], bx = k[o + 3], by = k[o + 4], bz = k[o + 5], cx = k[o + 6], cy = k[o + 7], cz = k[o + 8];
    const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az, apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz; let qx, qy, qz;
    if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; } else {
      const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
      if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; } else {
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + abx * v; qy = ay + aby * v; qz = az + abz * v; } else {
          const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
          if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; } else {
            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = ax + acx * w; qy = ay + acy * w; qz = az + acz * w; } else {
              const va = d3 * d6 - d5 * d4;
              if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); qx = bx + (cx - bx) * w; qy = by + (cy - by) * w; qz = bz + (cz - bz) * w; }
              else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w; } } } } } }
    CP[0] = qx; CP[1] = qy; CP[2] = qz; const dx = px - qx, dy = py - qy, dz = pz - qz; return dx * dx + dy * dy + dz * dz;
  }
  // 线段-三角形相交（Möller–Trumbore），返回参数 t∈[0,1] 或 -1
  function segTri(ox, oy, oz, dx, dy, dz, k, o) {
    const ax = k[o], ay = k[o + 1], az = k[o + 2], e1x = k[o + 3] - ax, e1y = k[o + 4] - ay, e1z = k[o + 5] - az, e2x = k[o + 6] - ax, e2y = k[o + 7] - ay, e2z = k[o + 8] - az;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-12) return -1;
    const inv = 1 / det, tx = ox - ax, ty = oy - ay, tz = oz - az, u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) return -1;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) return -1;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv; return t >= 0 && t <= 1 ? t : -1;
  }
  function heap() { const k = [], v = []; return { push(key, val) { k.push(key); v.push(val); let i = k.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= k[i]) break; [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; } },
    pop() { const r = v[0], lk = k.pop(), lv = v.pop(); if (k.length) { k[0] = lk; v[0] = lv; let i = 0; for (;;) { const l = 2 * i + 1, rr = l + 1; let m = i; if (l < k.length && k[l] < k[m]) m = l; if (rr < k.length && k[rr] < k[m]) m = rr; if (m === i) break; [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m; } } return r; }, get size() { return k.length; } }; }

  function create(S, opt) {
    opt = opt || {};
    const R = opt.R || 1.5, EYE = opt.eye || 1.6, gs = { x0: S.X(0), y0: S.Y(0) }, c = S.cell, NXc = S.NX - 1, NYc = S.NY - 1, n = NXc * NYc;
    const K = Math.ceil(R / c);
    const T = new Float32Array(n);
    const H = S.H, NX = S.NX;
    // r6：地形 = 渲染用的同一张三角网：被石垣顶线/墙脚线切开的格用切分三角形（S.splitIdx → S.splitTris），格的最高点也按切分三角形算
    const SPL = S.splitIdx || null, SPT = S.splitTris || [], HC = new Float32Array(n);
    for (let j = 0; j < NYc; j++) for (let i = 0; i < NXc; i++) { const a = j * NX + i; let m = Math.max(H[a], H[a + 1], H[a + NX], H[a + NX + 1]); if (SPL && SPL[a] >= 0) { const Tt = SPT[SPL[a]].tris; for (let k = 2; k < Tt.length; k += 3) if (Tt[k] > m) m = Tt[k]; } HC[j * NXc + i] = m; const WC = S.WZC, CL = S.CLS; let w = WC ? -1e9 : S.WZ; if (WC) for (let k4 = 0; k4 < 4; k4++) { const v = k4 === 0 ? a : k4 === 1 ? a + 1 : k4 === 2 ? a + NX : a + NX + 1; if (CL[v] < 0 && WC[v] > w) w = WC[v]; } /* r8a：不分配临时数组，结果相同 */ T[j * NXc + i] = Math.max(m, w); } // r7b：水格按自己那片水的实测水位（不再用全城最低水位）
    let C = null, tris = 0, samples = 0;
    const keep = opt.keepTris ? [] : null; // 独立几何校验用（只在测试/审计时打开；树按真实三角形）
    let TV = new Float32Array(9 * 65536), nT = 0; // 碰撞用三角形汤
    const TB = []; // 树：每个实例（树干/树冠）的包围盒 x0,y0,z0,x1,y1,z1（精确间隙用真包围盒 → 可从高树冠下走过；柱状场仍按柱体，保守）
    const ci = x => Math.floor((x - gs.x0) / c), cj = y => Math.floor((y - gs.y0) / c);
    const clipBand = (P, k, lo, hi) => {
      let Q = P; for (const [sgn, v] of [[1, lo], [-1, hi]]) { const out = []; const n0 = Q.length; for (let i = 0; i < n0; i++) { const A = Q[i], B = Q[(i + 1) % n0], fa = sgn * (A[k] - v), fb = sgn * (B[k] - v); if (fa >= 0) out.push(A); if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]); } } Q = out; if (!Q.length) break; } return Q; };
    function mark(i, j, z) { if (i < 0 || j < 0 || i >= NXc || j >= NYc) return; const q = j * NXc + i; if (z > T[q]) T[q] = z; samples++; }
    function rasterTri(A, B, Cv) {
      const xmin = Math.min(A[0], B[0], Cv[0]), xmax = Math.max(A[0], B[0], Cv[0]), ymin = Math.min(A[1], B[1], Cv[1]), ymax = Math.max(A[1], B[1], Cv[1]), zmax = Math.max(A[2], B[2], Cv[2]);
      const i0 = ci(xmin), i1 = ci(xmax), j0 = cj(ymin), j1 = cj(ymax);
      if (i1 < 0 || j1 < 0 || i0 >= NXc || j0 >= NYc) return;
      if (i0 === i1 && j0 === j1) return mark(i0, j0, zmax);
      if (i0 === i1 || j0 === j1) {
        const k = i0 === i1 ? 1 : 0, a0 = i0 === i1 ? j0 : i0, a1 = i0 === i1 ? j1 : i1, o = k ? gs.y0 : gs.x0;
        for (let a = a0; a <= a1; a++) { const Q = clipBand([A, B, Cv], k, o + a * c, o + (a + 1) * c); if (Q.length) { let z = -1e9; for (const p of Q) if (p[2] > z) z = p[2]; k ? mark(i0, a, z) : mark(a, j0, z); } } return;
      }
      for (let j = j0; j <= j1; j++) { const Rw = clipBand([A, B, Cv], 1, gs.y0 + j * c, gs.y0 + (j + 1) * c); if (!Rw.length) continue; let x0 = 1e9, x1 = -1e9; for (const p of Rw) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; }
        const a0 = ci(x0), a1 = ci(x1); if (a0 === a1) { let z = -1e9; for (const p of Rw) if (p[2] > z) z = p[2]; mark(a0, j, z); continue; }
        for (let i = a0; i <= a1; i++) { const Q = clipBand(Rw, 0, gs.x0 + i * c, gs.x0 + (i + 1) * c); if (Q.length) { let z = -1e9; for (const p of Q) if (p[2] > z) z = p[2]; mark(i, j, z); } } }
    }
    function pushTV(A, B, Cv) { if ((nT + 1) * 9 > TV.length) { const t = new Float32Array(TV.length * 2); t.set(TV); TV = t; } const o = nT * 9; TV[o] = A[0]; TV[o + 1] = A[1]; TV[o + 2] = A[2]; TV[o + 3] = B[0]; TV[o + 4] = B[1]; TV[o + 5] = B[2]; TV[o + 6] = Cv[0]; TV[o + 7] = Cv[1]; TV[o + 8] = Cv[2]; nT++; }
    // pos: three 坐标 (x, z_up, -y)；idx 可选；m: 4x4 列主序矩阵可选；box=true：实例化小物体（树），碰撞按变换后包围盒柱体
    function addTris(pos, idx, m, box) {
      const nv = idx ? idx.length : pos.length / 3;
      const tv = k => { let x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2]; if (m) { const X = m[0] * x + m[4] * y + m[8] * z + m[12], Y = m[1] * x + m[5] * y + m[9] * z + m[13], Z = m[2] * x + m[6] * y + m[10] * z + m[14]; x = X; y = Y; z = Z; } return [x, -z, y]; };
      if (box) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9, z0 = 1e9; const nvv = pos.length / 3; for (let k = 0; k < nvv; k++) { const p = tv(k); if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; if (p[2] > z1) z1 = p[2]; if (p[2] < z0) z0 = p[2]; }
        for (let j = cj(y0); j <= cj(y1); j++) for (let i = ci(x0); i <= ci(x1); i++) mark(i, j, z1); TB.push(x0, y0, z0, x1, y1, z1); tris += nv / 3;
        if (keep) for (let t = 0; t + 2 < nv; t += 3) { const A = tv(idx ? idx[t] : t), B = tv(idx ? idx[t + 1] : t + 1), Cv = tv(idx ? idx[t + 2] : t + 2); keep.push(A[0], A[1], A[2], B[0], B[1], B[2], Cv[0], Cv[1], Cv[2]); }
        return; }
      const tvi = (k, o) => { let x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2]; if (m) { const X = m[0] * x + m[4] * y + m[8] * z + m[12], Y = m[1] * x + m[5] * y + m[9] * z + m[13], Z = m[2] * x + m[6] * y + m[10] * z + m[14]; x = X; y = Y; z = Z; } o[0] = x; o[1] = -z; o[2] = y; return o; }; // = tv，写进复用的数组（r8a：不分配，同一运算）
      const A = [0, 0, 0], B = [0, 0, 0], Cv = [0, 0, 0];
      for (let t = 0; t + 2 < nv; t += 3) {
        tvi(idx ? idx[t] : t, A); tvi(idx ? idx[t + 1] : t + 1, B); tvi(idx ? idx[t + 2] : t + 2, Cv);
        if (keep) keep.push(A[0], A[1], A[2], B[0], B[1], B[2], Cv[0], Cv[1], Cv[2]);
        rasterTri(A, B, Cv); tris++;
        const gx1 = gs.x0 + NXc * c, gy1 = gs.y0 + NYc * c; // 细网格外由 outTop（曲轮平面）代表，不进三角形汤
        if (Math.max(A[0], B[0], Cv[0]) < gs.x0 || Math.min(A[0], B[0], Cv[0]) > gx1 || Math.max(A[1], B[1], Cv[1]) < gs.y0 || Math.min(A[1], B[1], Cv[1]) > gy1) continue;
        pushTV(A, B, Cv);
      }
    }
    // ---- 3D 空间哈希（CSR）----
    const HB = 4, HZ = 6; let HX0 = 0, HY0 = 0, HZ0 = 0, hnx = 1, hny = 1, hnz = 1, HOFF = null, HIT = null, STAMP = null, stampN = 1;
    const TBH = new Map(); // 树盒 2D 哈希
    function buildHash() {
      let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
      for (let k = 0; k < nT * 9; k += 3) { const x = TV[k], y = TV[k + 1], z = TV[k + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      if (!nT) { x0 = y0 = z0 = 0; x1 = y1 = z1 = 1; }
      x0 = Math.max(x0, gs.x0 - 8); y0 = Math.max(y0, gs.y0 - 8); x1 = Math.min(x1, gs.x0 + NXc * c + 8); y1 = Math.min(y1, gs.y0 + NYc * c + 8);
      HX0 = x0 - 1; HY0 = y0 - 1; HZ0 = z0 - 1; hnx = Math.ceil((x1 - HX0 + 1) / HB) + 1; hny = Math.ceil((y1 - HY0 + 1) / HB) + 1; hnz = Math.ceil((z1 - HZ0 + 1) / HZ) + 1;
      const nb = hnx * hny * hnz, cnt = new Int32Array(nb + 1), rng = new Int32Array(nT * 6);
      for (let t = 0; t < nT; t++) { const o = t * 9; const fx = v => clamp(Math.floor((v - HX0) / HB), 0, hnx - 1), fy = v => clamp(Math.floor((v - HY0) / HB), 0, hny - 1), a0 = fx(Math.min(TV[o], TV[o + 3], TV[o + 6])), a1 = fx(Math.max(TV[o], TV[o + 3], TV[o + 6])), b0 = fy(Math.min(TV[o + 1], TV[o + 4], TV[o + 7])), b1 = fy(Math.max(TV[o + 1], TV[o + 4], TV[o + 7])), c0 = Math.floor((Math.min(TV[o + 2], TV[o + 5], TV[o + 8]) - HZ0) / HZ), c1 = Math.floor((Math.max(TV[o + 2], TV[o + 5], TV[o + 8]) - HZ0) / HZ);
        rng[t * 6] = a0; rng[t * 6 + 1] = a1; rng[t * 6 + 2] = b0; rng[t * 6 + 3] = b1; rng[t * 6 + 4] = c0; rng[t * 6 + 5] = c1;
        for (let cc = c0; cc <= c1; cc++) for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) cnt[(cc * hny + b) * hnx + a + 1]++; }
      for (let i = 0; i < nb; i++) cnt[i + 1] += cnt[i];
      HOFF = cnt; HIT = new Int32Array(cnt[nb]); const fill = cnt.slice(0, nb);
      for (let t = 0; t < nT; t++) { const r = t * 6; for (let cc = rng[r + 4]; cc <= rng[r + 5]; cc++) for (let b = rng[r + 2]; b <= rng[r + 3]; b++) for (let a = rng[r]; a <= rng[r + 1]; a++) HIT[fill[(cc * hny + b) * hnx + a]++] = t; }
      STAMP = new Uint32Array(nT);
      for (let k = 0; k < TB.length; k += 6) for (let b = Math.floor(TB[k + 1] / HB); b <= Math.floor(TB[k + 4] / HB); b++) for (let a = Math.floor(TB[k] / HB); a <= Math.floor(TB[k + 3] / HB); a++) { const key = a * 100003 + b; let L = TBH.get(key); if (!L) TBH.set(key, L = []); L.push(k); }
    }
    function forTris(x0, y0, z0, x1, y1, z1, fn) { // 对 AABB 覆盖的桶内三角形各调用一次（去重）；fn 返回 true 则提前结束
      if (!HOFF) return; stampN++; if (stampN > 4e9) { STAMP.fill(0); stampN = 1; }
      const a0 = Math.max(0, Math.floor((x0 - HX0) / HB)), a1 = Math.min(hnx - 1, Math.floor((x1 - HX0) / HB)), b0 = Math.max(0, Math.floor((y0 - HY0) / HB)), b1 = Math.min(hny - 1, Math.floor((y1 - HY0) / HB)), c0 = Math.max(0, Math.floor((z0 - HZ0) / HZ)), c1 = Math.min(hnz - 1, Math.floor((z1 - HZ0) / HZ));
      for (let cc = c0; cc <= c1; cc++) for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) { const q = (cc * hny + b) * hnx + a; for (let s = HOFF[q], e = HOFF[q + 1]; s < e; s++) { const t = HIT[s]; if (STAMP[t] === stampN) continue; STAMP[t] = stampN; if (fn(t)) return; } }
    }
    function finish() {
      const tmp = new Float32Array(n); C = new Float32Array(n);
      for (let j = 0; j < NYc; j++) { const o = j * NXc; for (let i = 0; i < NXc; i++) { let m = -1e9; for (let d = -K; d <= K; d++) { const ii = i + d; if (ii >= 0 && ii < NXc) { const v = T[o + ii]; if (v > m) m = v; } } tmp[o + i] = m; } }
      for (let j = 0; j < NYc; j++) for (let i = 0; i < NXc; i++) { let m = -1e9; for (let d = -K; d <= K; d++) { const jj = j + d; if (jj >= 0 && jj < NYc) { const v = tmp[jj * NXc + i]; if (v > m) m = v; } } C[j * NXc + i] = m + R; }
      buildHash();
    }
    // r7b：水位按连通水体（S.wzAt：每格所属水体的实测水位，T.P.）；网格外的曲轮取其拟合地面
    const WL = (x, y) => S.wzAt ? S.wzAt(x, y) : S.WZ;
    const outTop = (x, y) => { const g = S.regionAt ? S.regionAt(x, y) : null, h = g ? (g.surf ? g.surf.at(x, y) : g.z) : S.BED; return Math.max(h, WL(x, y)); };
    const top = (x, y) => { const i = ci(x), j = cj(y); return (i < 0 || j < 0 || i >= NXc || j >= NYc) ? outTop(x, y) : T[j * NXc + i]; };
    const need = (x, y) => { const i = ci(x), j = cj(y); return (i < K || j < K || i >= NXc - K || j >= NYc - K) ? Math.max(outTop(x, y) + R, i >= -K && j >= -K && i < NXc + K && j < NYc + K ? (() => { let m = -1e9; for (let b = j - K; b <= j + K; b++) for (let a = i - K; a <= i + K; a++) if (a >= 0 && b >= 0 && a < NXc && b < NYc) m = Math.max(m, T[b * NXc + a]); return m + R; })() : -1e9) : C[j * NXc + i]; };
    const above = (p, m) => p[2] >= need(p[0], p[1]) + (m || 0); // 柱状场：充分条件（在一切几何之上 ≥R）
    const inGrid = (x, y) => x >= gs.x0 && y >= gs.y0 && x <= gs.x0 + NXc * c && y <= gs.y0 + NYc * c;
    const terrZ = (x, y) => inGrid(x, y) ? S.heightAt(x, y) : outTop(x, y);
    // ---- 精确间隙 ----
    const NRM = [0, 0, 1], TK = new Float32Array(9);
    function clearance(p, cap) {
      const px = p[0], py = p[1], pz = p[2]; cap = cap || R + 0.01;
      let d = pz - WL(px, py), nx = 0, ny = 0, nz = 1; // 水面
      const tz = terrZ(px, py); if (pz < tz) { NRM[0] = 0; NRM[1] = 0; NRM[2] = 1; return pz - tz; }
      if (inGrid(px - cap, py - cap) && inGrid(px + cap, py + cap)) { // 地形三角网（与渲染网格同一剖分）
        const i0 = Math.max(0, ci(px - cap)), i1 = Math.min(NXc - 1, ci(px + cap)), j0 = Math.max(0, cj(py - cap)), j1 = Math.min(NYc - 1, cj(py + cap)), tk = TK;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const a = j * NX + i, X0 = gs.x0 + i * c, Y0 = gs.y0 + j * c, X1 = X0 + c, Y1 = Y0 + c;
          if (pz - HC[j * NXc + i] >= d) continue;
          if (SPL && SPL[a] >= 0) { const Tt = SPT[SPL[a]].tris; for (let k = 0; k < Tt.length; k += 9) { const d2 = ptTri2(px, py, pz, Tt, k); if (d2 < d * d) { d = Math.sqrt(d2); nx = px - CP[0]; ny = py - CP[1]; nz = pz - CP[2]; } } continue; }
          tk[0] = X0; tk[1] = Y0; tk[2] = H[a]; tk[3] = X1; tk[4] = Y0; tk[5] = H[a + 1]; tk[6] = X1; tk[7] = Y1; tk[8] = H[a + NX + 1];
          let d2 = ptTri2(px, py, pz, tk, 0); if (d2 < d * d) { d = Math.sqrt(d2); nx = px - CP[0]; ny = py - CP[1]; nz = pz - CP[2]; }
          tk[3] = X1; tk[4] = Y1; tk[5] = H[a + NX + 1]; tk[6] = X0; tk[7] = Y1; tk[8] = H[a + NX];
          d2 = ptTri2(px, py, pz, tk, 0); if (d2 < d * d) { d = Math.sqrt(d2); nx = px - CP[0]; ny = py - CP[1]; nz = pz - CP[2]; } }
      } else { const o = Math.max(outTop(px, py), outTop(px + cap, py), outTop(px - cap, py), outTop(px, py + cap), outTop(px, py - cap), tz); if (pz - o < d) { d = pz - o; nx = 0; ny = 0; nz = 1; } }
      // 树柱
      for (let b = Math.floor((py - cap) / HB); b <= Math.floor((py + cap) / HB); b++) for (let a = Math.floor((px - cap) / HB); a <= Math.floor((px + cap) / HB); a++) { const L = TBH.get(a * 100003 + b); if (L) for (const k of L) {
        const dx = Math.max(TB[k] - px, 0, px - TB[k + 3]), dy = Math.max(TB[k + 1] - py, 0, py - TB[k + 4]), dz = Math.max(TB[k + 2] - pz, 0, pz - TB[k + 5]);
        let dd; if (!dx && !dy && !dz) { dd = -Math.min(px - TB[k], TB[k + 3] - px, py - TB[k + 1], TB[k + 4] - py, pz - TB[k + 2], TB[k + 5] - pz); if (dd < d) { d = dd; nx = 0; ny = 0; nz = 1; } continue; } dd = Math.hypot(dx, dy, dz);
        if (dd < d) { d = dd; nx = px < TB[k] ? -dx : dx; ny = py < TB[k + 1] ? -dy : dy; nz = pz < TB[k + 2] ? -dz : dz; } } }
      // 三角形
      const lim = Math.min(cap, Math.max(d, 0)); let best = lim * lim;
      if (lim > 0) forTris(px - lim, py - lim, pz - lim, px + lim, py + lim, pz + lim, t => { const o = t * 9, r = Math.sqrt(best);
        if (Math.min(TV[o], TV[o + 3], TV[o + 6]) > px + r || Math.max(TV[o], TV[o + 3], TV[o + 6]) < px - r || Math.min(TV[o + 1], TV[o + 4], TV[o + 7]) > py + r || Math.max(TV[o + 1], TV[o + 4], TV[o + 7]) < py - r || Math.min(TV[o + 2], TV[o + 5], TV[o + 8]) > pz + r || Math.max(TV[o + 2], TV[o + 5], TV[o + 8]) < pz - r) return false;
        const d2 = ptTri2(px, py, pz, TV, o); if (d2 < best) { best = d2; d = Math.sqrt(d2); nx = px - CP[0]; ny = py - CP[1]; nz = pz - CP[2]; } return false; });
      const L = Math.hypot(nx, ny, nz) || 1; NRM[0] = nx / L; NRM[1] = ny / L; NRM[2] = nz / L; if (!(Math.hypot(nx, ny, nz) > 1e-9)) { NRM[0] = 0; NRM[1] = 0; NRM[2] = 1; }
      return d;
    }
    let nQ = 0, nFast = 0;
    const valid = (p, tol) => { nQ++; if (above(p)) { nFast++; return true; } return clearance(p, R + 0.01) >= R - (tol || 0); };
    const clear = (p, tol) => valid(p, tol);
    function segFree(a, b, step, tol) { const L = dist(a, b), N = Math.max(1, Math.ceil(L / (step || 0.25))); for (let k = 1; k <= N; k++) if (!valid(lerp3(a, b, k / N), tol)) return false; return true; }
    // 向上开放：竖直扫掠到柱状场之上全程合法 → 该点与天空连通（不在封闭体内）
    function openUp(p) { if (above(p)) return true; const top2 = [p[0], p[1], need(p[0], p[1]) + 0.01]; return segFree(p, top2, 0.5); }
    // 每帧连续运动：扫掠 + 接触 + 切平面滑移
    let LM = null; // 上一次 move 的实际运动折线（审计 C7 用）
    function move(p0, p1) {
      let a = p0, b = p1; LM = [p0];
      for (let it = 0; it < 3; it++) {
        const L = dist(a, b); if (L < 1e-9) return a;
        const N = Math.max(1, Math.ceil(L / 0.5)); let hit = -1;
        for (let s = 1; s <= N; s++) if (!valid(lerp3(a, b, s / N))) { hit = s; break; }
        if (hit < 0) { LM.push(b); return b; }
        let lo = (hit - 1) / N, hi = hit / N; for (let k = 0; k < 7; k++) { const m = (lo + hi) / 2; if (valid(lerp3(a, b, m))) lo = m; else hi = m; }
        const q = lerp3(a, b, lo); clearance(lerp3(a, b, hi), R + 0.5); const nn = NRM.slice();
        const rem = [b[0] - q[0], b[1] - q[1], b[2] - q[2]], dn = rem[0] * nn[0] + rem[1] * nn[1] + rem[2] * nn[2];
        if (dn < 0) { rem[0] -= nn[0] * dn; rem[1] -= nn[1] * dn; rem[2] -= nn[2] * dn; }
        a = q; LM.push(q); b = [q[0] + rem[0], q[1] + rem[1], q[2] + rem[2]];
      }
      return a;
    }
    // 瞬移落点：合法且向上开放；否则沿间隙梯度推出，再按壳层搜最近的开放合法点；最后兜底竖直抬到柱状场
    const DIRS = []; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let cc = -1; cc <= 1; cc++) if (a || b || cc) { const L = Math.hypot(a, b, cc); DIRS.push([a / L, b / L, cc / L]); }
    function place(p) {
      if (valid(p) && openUp(p)) return p.slice();
      let q = p.slice(); for (let it = 0; it < 8; it++) { const d = clearance(q, R + 3); if (d >= R) break; const s = R - d + 0.02; q = [q[0] + NRM[0] * s, q[1] + NRM[1] * s, q[2] + NRM[2] * s]; }
      if (dist(q, p) < 6 && valid(q) && openUp(q)) return q;
      for (const r of [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12]) for (const dd of DIRS) { const cand = [p[0] + dd[0] * r, p[1] + dd[1] * r, p[2] + dd[2] * r]; if (valid(cand) && openUp(cand)) return cand; }
      return [p[0], p[1], need(p[0], p[1]) + 1e-3];
    }
    // 线段与几何是否相交（视线 / 隧穿检查）：地形按 0.5 m 采样，三角形精确，树柱按盒；skip(x,y) 为真的命中点忽略
    function segHit(a, b, skip) {
      const L = dist(a, b), dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], NS = Math.max(2, Math.ceil(L / 0.5));
      for (let k = 1; k < NS; k++) { const t = k / NS, x = a[0] + dx * t, y = a[1] + dy * t, z = a[2] + dz * t; if (skip && skip(x, y)) continue; if (z < terrZ(x, y) || z < WL(x, y)) return { t, p: [x, y, z], what: 'ground' }; }
      const NB = Math.max(1, Math.ceil(L / 2)); let res = null;
      for (let k = 0; k < NB && !res; k++) { const t0 = k / NB, t1 = (k + 1) / NB, p0 = lerp3(a, b, t0), p1 = lerp3(a, b, t1), mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
        if (Math.min(p0[2], p1[2]) >= need(mx, my) - R + 1e-3) continue; // 子段在邻域最高面之上
        const bb = [Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.min(p0[2], p1[2]), Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1]), Math.max(p0[2], p1[2])];
        for (let bj = Math.floor(bb[1] / HB); bj <= Math.floor(bb[4] / HB) && !res; bj++) for (let bi = Math.floor(bb[0] / HB); bi <= Math.floor(bb[3] / HB) && !res; bi++) { const Lt = TBH.get(bi * 100003 + bj); if (Lt) for (const q of Lt) {
          let tmin = t0, tmax = t1; const o = [a[0], a[1], a[2]], dv = [dx, dy, dz], lo = [TB[q], TB[q + 1], TB[q + 2]], hi = [TB[q + 3], TB[q + 4], TB[q + 5]];
          for (let ax = 0; ax < 3; ax++) { if (Math.abs(dv[ax]) < 1e-12) { if (o[ax] < lo[ax] || o[ax] > hi[ax]) { tmin = 2; break; } continue; } let u0 = (lo[ax] - o[ax]) / dv[ax], u1 = (hi[ax] - o[ax]) / dv[ax]; if (u0 > u1) { const tt = u0; u0 = u1; u1 = tt; } tmin = Math.max(tmin, u0); tmax = Math.min(tmax, u1); if (tmin > tmax) break; }
          if (tmin <= tmax) { const hp = lerp3(a, b, tmin); if (!(skip && skip(hp[0], hp[1]))) { res = { t: tmin, p: hp, what: 'tree' }; break; } } } }
        if (res) break;
        forTris(bb[0], bb[1], bb[2], bb[3], bb[4], bb[5], t => { const u = segTri(a[0], a[1], a[2], dx, dy, dz, TV, t * 9); if (u < 0) return false; const hp = lerp3(a, b, u); if (skip && skip(hp[0], hp[1])) return false; res = { t: u, p: hp, what: 'solid' }; return true; });
      }
      return res;
    }
    // 视线：相机 → 目标；目标周围 rf（水平）以内算“目标本体”，不算遮挡
    function los(cam, tgt, rf) { const h = segHit(cam, tgt, rf ? (x, y) => Math.hypot(x - tgt[0], y - tgt[1]) <= rf : null); return h ? { ok: false, t: h.t, p: h.p } : { ok: true }; }
    // r3 旧逻辑（只用于对照）：柱状场 + 竖直抬升/沿视线收回
    const clearOld = (p, tol) => p[2] >= need(p[0], p[1]) - (tol || 0);
    function resolveLegacy(cam, tgt, minD) {
      if (clearOld(cam)) return null;
      const a = [cam[0], cam[1], need(cam[0], cam[1]) + 1e-3], da = a[2] - cam[2];
      const L = dist(cam, tgt), st = c * 0.25; let b = null;
      for (let s = st; s <= L - (minD || 0); s += st) { const t = s / L, p = lerp3(cam, tgt, t); if (s > da) break; if (clearOld(p)) { b = p; break; } }
      return b || a;
    }
    const floorAt = (x, y) => Math.max(S.surfaceAt ? S.surfaceAt(x, y) : top(x, y), WL(x, y));
    // ---- 视角预设（规则 → 相机；不合法/被挡则按代价搜索）----
    function fromRule(r, f, del, daz) { const el = clamp(r.el + del, 1, 89.95) * Math.PI / 180, az = (r.az + daz) * Math.PI / 180, d = r.dist * f; return [r.target[0] + Math.cos(az) * Math.cos(el) * d, r.target[1] + Math.sin(az) * Math.cos(el) * d, r.target[2] + Math.sin(el) * d]; }
    let CANDS = null;
    function fixPreset(r) {
      if (!CANDS) { CANDS = []; for (const f of [1, 0.92, 0.85, 0.78, 0.7, 0.62, 0.55, 0.48, 1.1, 1.2, 1.35, 1.5]) for (let del = 0; del <= 60; del += 4) for (const daz of [0, 8, -8, 16, -16, 24, -24, 32, -32, 45, -45]) CANDS.push({ f, del, daz, cost: Math.abs(Math.log(f)) * 2 + del / 30 + Math.abs(daz) / 30 }); CANDS.sort((a, b) => a.cost - b.cost); }
      for (const k of CANDS) { if (r.el + k.del > 89.95 && k.del > 0) continue; const cam = fromRule(r, k.f, k.del, k.daz); if (valid(cam) && openUp(cam) && los(cam, r.target, r.rf).ok) return { cam, tgt: r.target.slice(), cost: k.cost, k }; }
      return { cam: fromRule(r, 1, 0, 0), tgt: r.target.slice(), cost: Infinity, k: null };
    }
    // ---- 逃逸：从遮盖下的点（门洞里）到最近的“开放点”（柱状场之上 0.5 m）——3D 栅格 Dijkstra（1 m，26 邻域），拉直 ----
    const ESC = new Map();
    function escape(p) {
      const key = p.map(v => v.toFixed(2)).join(','); if (ESC.has(key)) return ESC.get(key);
      let res = null;
      if (above(p, 0.5)) res = [p.slice()];
      else {
        const h = 1, idx = (a, b, cc) => ((cc + 64) * 129 + (b + 64)) * 129 + (a + 64), seen = new Map(), Q = heap(); seen.set(idx(0, 0, 0), { a: 0, b: 0, c: 0, g: 0, prev: null }); Q.push(0, idx(0, 0, 0)); let goal = null, exp = 0;
        const P = (nd) => [p[0] + nd.a * h, p[1] + nd.b * h, p[2] + nd.c * h];
        while (Q.size && exp < 40000) { const id = Q.pop(), nd = seen.get(id); if (nd.done) continue; nd.done = true; exp++; const pp = P(nd); if (above(pp, 0.5)) { goal = nd; break; }
          for (let dc = -1; dc <= 1; dc++) for (let db = -1; db <= 1; db++) for (let da = -1; da <= 1; da++) { if (!da && !db && !dc) continue; const a = nd.a + da, b = nd.b + db, cc = nd.c + dc; if (Math.abs(a) > 60 || Math.abs(b) > 60 || Math.abs(cc) > 60) continue;
            const k = idx(a, b, cc), g = nd.g + Math.hypot(da, db, dc) * h * (dc < 0 ? 1.5 : 1); let m = seen.get(k); if (m && (m.done || m.g <= g)) continue; const q = [p[0] + a * h, p[1] + b * h, p[2] + cc * h]; if (!m && !valid(q, -0.05)) { seen.set(k, { done: true, g: 0 }); continue; }
            if (!m) seen.set(k, m = { a, b, c: cc }); m.g = g; m.prev = nd; Q.push(g, k); } }
        if (goal) { const pts = []; for (let nd = goal; nd; nd = nd.prev) pts.push(P(nd)); pts.reverse(); pts[0] = p.slice(); res = pull(pts, (u, v) => segFree(u, v, 0.25, -0.03)); }
      }
      ESC.set(key, res); return res;
    }
    function pull(pts, ok) { const out = [pts[0]]; let i = 0; while (i < pts.length - 1) { let j = pts.length - 1; while (j > i + 1 && !ok(pts[i], pts[j])) j--; out.push(pts[j]); i = j; } return out; }
    // r3 抬升包络（柱状场），返回稠密折线 + 最大抬升
    function envelope(A, B, margin, exact) {
      margin = margin === undefined ? 0.3 : margin;
      const L = dist(A, B), N = clamp(Math.ceil(L / (c * 0.5)), 2, 6000), d = new Float32Array(N + 1), lift = new Float32Array(N + 1), w = Math.min(0.5, Math.max(0.12, 40 / Math.max(L, 1)));
      for (let k = 0; k <= N; k++) { const u = k / N, x = lerp(A[0], B[0], u), y = lerp(A[1], B[1], u), z = lerp(A[2], B[2], u); const hh = c * 0.5, nm = Math.max(need(x - hh, y - hh), need(x + hh, y - hh), need(x - hh, y + hh), need(x + hh, y + hh)); d[k] = Math.max(0, nm + margin - z);
        if (exact && d[k] > 0) { let dz = 0; while (dz < d[k] && !valid([x, y, z + dz], -margin)) dz += 0.5; d[k] = Math.min(d[k], dz); } } // exact：按精确间隙求最小抬升（≤ 柱状场的抬升）
      const W = Math.ceil(w * N);
      for (let k = 0; k <= N; k++) { if (d[k] <= 0) continue; const Wk = Math.max(1, Math.min(W, k, N - k)); for (let q = Math.max(0, k - Wk); q <= Math.min(N, k + Wk); q++) { const v = d[k] * 0.5 * (1 + Math.cos(Math.PI * Math.abs(q - k) / Wk)); if (v > lift[q]) lift[q] = v; } }
      const pts = []; for (let k = 0; k <= N; k++) { const p = lerp3(A, B, k / N); p[2] += lift[k]; pts.push(p); }
      return { pts, maxLift: lift.reduce((m, v) => Math.max(m, v), 0) };
    }
    // 折线 → 按弧长参数化（easeInOutCubic）；目标点按同一进度插值
    function polyPath(pts, A, B, extra) {
      const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i])); const L = cum[cum.length - 1];
      const posAt = s => { if (s <= 0) return pts[0].slice(); if (s >= L) return pts[pts.length - 1].slice(); let lo = 0, hi = cum.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; } return lerp3(pts[lo], pts[hi], (s - cum[lo]) / ((cum[hi] - cum[lo]) || 1)); };
      const at = t => { const u = ease(clamp(t, 0, 1)); return { cam: posAt(u * L), tgt: lerp3(A.tgt, B.tgt, u) }; };
      return Object.assign({ at, L, pts, posAt, dur: 0.8 + 0.4 * Math.min(1, L / 1500) }, extra || {});
    }
    // 过渡：直线 → （逃逸段 + 中段直线/抬升包络 + 逃逸段）
    function path(A, B, margin) {
      if (segFree(A.cam, B.cam, 0.25)) return polyPath([A.cam.slice(), B.cam.slice()], A, B, { maxLift: 0, kind: 'straight' });
      const ea = escape(A.cam) || [A.cam.slice()], ebr = escape(B.cam), eb = ebr ? ebr.slice().reverse() : [B.cam.slice()];
      const a1 = ea[ea.length - 1], b1 = eb[0]; let mid, maxLift = 0, kind;
      if (segFree(a1, b1, 0.25)) { mid = [a1, b1]; kind = 'escape+straight'; }
      else { let E = null; kind = 'escape+lift'; // 先试精确抬升（更低；余量 0.3/1/2 m），整段复核不通过再用柱状场包络（必合法）
        for (const mg of [0.3, 1, 2]) { const e = envelope(a1, b1, mg, true); if (e.pts.every((p, i) => !i || segFree(e.pts[i - 1], p, 0.25))) { E = e; break; } }
        if (!E) { E = envelope(a1, b1, margin); kind = 'escape+liftcol'; }
        mid = E.pts; maxLift = E.maxLift; }
      const pts = ea.slice(0, -1).concat(mid, eb.slice(1)); let esc = 0; for (let i = 1; i < ea.length; i++) esc += dist(ea[i - 1], ea[i]); for (let i = 1; i < eb.length; i++) esc += dist(eb[i - 1], eb[i]);
      const P = polyPath(pts, A, B, { maxLift, kind: ea.length > 1 || eb.length > 1 ? kind : kind.replace('escape+', ''), esc }); P.dur += Math.min(1.2, esc / 12); return P;
    }
    const linear = (A, B) => ({ at: t => { const k = clamp(t, 0, 1), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; return { cam: A.cam.map((v, i) => lerp(v, B.cam[i], e)), tgt: A.tgt.map((v, i) => lerp(v, B.tgt[i], e)) }; }, L: dist(A.cam, B.cam) });
    const pathLegacy = (A, B) => { const E = envelope(A.cam, B.cam); return polyPath(E.pts, A, B, { maxLift: E.maxLift }); };
    function pathBad(P, chk) { chk = chk || (q => valid(q, 1e-3)); const N = clamp(Math.ceil((P.L + 1) / 0.25), 50, 40000); let bad = 0; for (let k = 0; k <= N; k++) if (!chk(P.at(k / N).cam)) bad++; return bad; }

    // ---- 步行（眼高 EYE）：1 m 栅格 Dijkstra，节点 = 地面（含桥面）上 EYE 处的球体合法；坡度 ≤ slope ----
    function walkPoint(x, y, ok) { ok = ok || valid; const s = S.surfaceAt(x, y); for (const dz of [0, 0.1, 0.2, 0.3]) { const p = [x, y, s + EYE + dz]; if (ok(p)) return p; } return null; } // 斜坡上眼高最多抬 0.3 m 让球离坡面 ≥R
    // r7b：寻路的边也必须是连续运动——两节点之间的直线（审计就是按这条直线 0.25 m 复核的）全程合法，不只是两个端点合法
    function edgeOk(a, b, ok) { const N = Math.max(1, Math.ceil(dist(a, b) / 0.25)); for (let k = 1; k < N; k++) if (!ok(lerp3(a, b, k / N))) return false; return true; }
    function walkRoute(start, goalFn, box, o) {
      o = o || {}; const h = o.h || 1, ok = o.ok || valid, slope = o.slope || 0.3, x0 = box[0], y0 = box[1], nx = Math.ceil((box[2] - x0) / h) + 1, ny = Math.ceil((box[3] - y0) / h) + 1, N = nx * ny;
      const P = new Array(N), st = new Uint8Array(N), g = new Float32Array(N).fill(1e30), prev = new Int32Array(N).fill(-1), Q = heap();
      const pt = q => { if (st[q] === 0) { const i = q % nx, j = (q - i) / nx; P[q] = walkPoint(x0 + i * h, y0 + j * h, ok); st[q] = P[q] ? 1 : 2; } return P[q]; };
      const s0 = Math.round((start[1] - y0) / h) * nx + Math.round((start[0] - x0) / h); if (!pt(s0)) return { ok: false, why: 'start' };
      g[s0] = 0; Q.push(0, s0); let goal = -1, exp = 0;
      while (Q.size) { const q = Q.pop(); if (st[q] === 3) continue; st[q] = 3; exp++; const p = P[q]; if (goalFn(p[0], p[1], p)) { goal = q; break; } if (exp > (o.max || 120000)) break;
        const i = q % nx, j = (q - i) / nx;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue; const k = b * nx + a; if (st[k] === 3 || st[k] === 2) continue; const pk = pt(k); if (!pk) continue;
          const len = Math.hypot(di, dj) * h; if (Math.abs(S.surfaceAt(pk[0], pk[1]) - S.surfaceAt(p[0], p[1])) > slope * len + 0.05) continue; const gg = g[q] + len; if (gg < g[k] && edgeOk(p, pk, ok)) { g[k] = gg; prev[k] = q; Q.push(gg, k); } } }
      if (goal < 0) return { ok: false, why: 'unreached', exp };
      const raw = []; for (let q = goal; q >= 0; q = prev[q]) raw.push(P[q]); raw.reverse();
      return { ok: true, raw, exp };
    }
    // 步行折线：拉直（弦上按 0.5 m 取地面眼高点全部合法且坡度连续）→ 稠密化 → 合法性 0.25 m 复核
    function walkDense(a, b, ok) { const L = Math.hypot(b[0] - a[0], b[1] - a[1]), N = Math.max(1, Math.ceil(L / 0.5)), out = []; for (let k = 1; k <= N; k++) { const x = lerp(a[0], b[0], k / N), y = lerp(a[1], b[1], k / N), p = walkPoint(x, y, ok); if (!p) return null; out.push(p); } return out; }
    function walkSmooth(raw, ok) {
      ok = ok || valid; const dense = (u, v) => { const d = walkDense(u, v, ok); if (!d) return null; let pr = u; for (const p of d) { if (!segFree(pr, p, 0.25)) return null; pr = p; } return d; };
      const key = pull(raw.map(p => p), (u, v) => !!dense(u, v));
      // 相邻两个原始节点之间拉不直时（pull 的兜底不复核），用寻路时已复核过的那条直线边（r7b）
      let pts = [raw[0]]; for (let i = 1; i < key.length; i++) pts = pts.concat(dense(key[i - 1], key[i]) || [key[i]]);
      return pts;
    }

    // ---------- 独立几何校验（不用碰撞场/哈希）：三角形 2D 哈希，球-三角形精确距离 + 地形/水面 + 封闭性（17 条射线全被挡 = 封闭体内）----------
    let GH = null;
    function geoIndex() {
      if (GH || !keep) return GH; const B = 8, map = new Map(), nt = keep.length / 9;
      for (let t = 0; t < nt; t++) { const o = t * 9; const x0 = Math.min(keep[o], keep[o + 3], keep[o + 6]), x1 = Math.max(keep[o], keep[o + 3], keep[o + 6]), y0 = Math.min(keep[o + 1], keep[o + 4], keep[o + 7]), y1 = Math.max(keep[o + 1], keep[o + 4], keep[o + 7]);
        for (let j = Math.floor(y0 / B); j <= Math.floor(y1 / B); j++) for (let i = Math.floor(x0 / B); i <= Math.floor(x1 / B); i++) { const k = i * 100003 + j; let a = map.get(k); if (!a) map.set(k, a = []); a.push(t); } }
      GH = { B, map }; return GH;
    }
    function rayBlocked(p, d, Lmax) { // 独立：沿 2D 桶逐段收集三角形
      const G = GH, seen = new Set(), q = [p[0] + d[0] * Lmax, p[1] + d[1] * Lmax, p[2] + d[2] * Lmax], NS = Math.ceil(Lmax / 0.5);
      for (let k = 1; k <= NS; k++) { const t = k / NS, x = lerp(p[0], q[0], t), y = lerp(p[1], q[1], t), z = lerp(p[2], q[2], t); if (z < Math.max(terrZ(x, y), WL(x, y))) return true; }
      const NB = Math.ceil(Lmax / (G.B / 2));
      for (let k = 0; k <= NB; k++) { const x = lerp(p[0], q[0], k / NB), y = lerp(p[1], q[1], k / NB);
        for (let j = Math.floor(y / G.B) - 1; j <= Math.floor(y / G.B) + 1; j++) for (let i = Math.floor(x / G.B) - 1; i <= Math.floor(x / G.B) + 1; i++) { const A = G.map.get(i * 100003 + j); if (A) for (const t of A) { if (seen.has(t)) continue; seen.add(t); if (segTri(p[0], p[1], p[2], q[0] - p[0], q[1] - p[1], q[2] - p[2], keep, t * 9) >= 0) return true; } } }
      return false;
    }
    function geoCheck(p) { // 返回 null（干净）或原因字符串
      const G = geoIndex(); if (!G) return null; const rr = R * 0.98;
      for (const rho of [0, 0.5, 1.0, 1.4]) for (let a = 0; a < (rho ? 12 : 1); a++) { const x = p[0] + rho * Math.cos(a * Math.PI / 6), y = p[1] + rho * Math.sin(a * Math.PI / 6); if (p[2] - Math.max(terrZ(x, y), WL(x, y)) < Math.sqrt(Math.max(0, rr * rr - rho * rho))) return 'ground'; }
      const seen = new Set();
      for (let j = Math.floor((p[1] - R) / G.B); j <= Math.floor((p[1] + R) / G.B); j++) for (let i = Math.floor((p[0] - R) / G.B); i <= Math.floor((p[0] + R) / G.B); i++) { const A = G.map.get(i * 100003 + j); if (A) for (const t of A) { if (seen.has(t)) continue; seen.add(t); if (Math.sqrt(ptTri2(p[0], p[1], p[2], keep, t * 9)) < rr) return 'solid'; } }
      if (!rayBlocked(p, [0, 0, 1], 80)) return null; // 头顶开放
      for (let a = 0; a < 8; a++) for (const el of [0, 30]) { const e = el * Math.PI / 180, d = [Math.cos(a * Math.PI / 4) * Math.cos(e), Math.sin(a * Math.PI / 4) * Math.cos(e), Math.sin(e)]; if (!rayBlocked(p, d, 60)) return null; }
      return 'enclosed';
    }
    return { R, K, EYE, cell: c, addTris, finish, top, need, above, clear, valid, clearance, normal: () => NRM.slice(), segFree, openUp, move, lastMove: () => LM, place, segHit, los, resolveLegacy, clearOld, floorAt, fromRule, fixPreset, escape, envelope, polyPath, path, pathLegacy, linear, pathBad,
      walkPoint, walkRoute, walkSmooth, geoCheck, stats: () => ({ tris, samples, fieldTris: nT, treeBoxes: TB.length / 6, hashItems: HIT ? HIT.length : 0, queries: nQ, fast: nFast }), hasGeo: () => !!keep };
  }
  root.CASTLE_CAMERA = { create, ease };
})(typeof window !== 'undefined' ? window : globalThis);
