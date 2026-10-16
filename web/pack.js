'use strict';
// ===== 预构建结果包（web-r8a）：生成结果 ⇄ 二进制包 =====
// 生成（site.js 的 build）对同一 (代码, 数据, 选项) 是确定的，所以可以离线跑一次、把结果存成包，页面直接读包、跳过生成。
// 包 = gzip( 魔数 "CSPK" + u32 头长 + JSON 头 + 8 字节对齐的二进制块 )。
//   头：{ fmt, key, opt, version, sig, graph, blobs }。graph = 生成结果对象图（S，生成后、审计前）的 JSON 编码：
//     普通值原样；对象/数组内联；被引用 ≥2 次的对象记一个编号（{$:'d'} 定义、{$:'r'} 引用，环也能表示）；
//     -0 / NaN / ±Infinity / undefined 单独标记（JSON 会丢）；Map/Set 按条目；类型数组 → 二进制块（大数组单独一块，小数组进同类型的池）；
//     “锚点”（页面上由同一份代码现场创建、被闭包引用的对象：曲轮、台地面、水体、高度网格数组…）只记名字，解码时**原地合并**进现场对象，
//     所以闭包（heightAt、crestDist…）读到的就是包里的数据；SPEC / CASTLE_DATA 里的对象是常量锚点（只记路径）；
//     函数：台地面/水体的函数按名字接回，其余由 build 在读包后重建（木桥的 topAt/P）。
//   二进制块的编码只为压缩率（逐位还原）：Float64/Int32/Int16 按字节分面（byte shuffle）；高度场先与一个“预测”逐位异或（预测命中 = 0）。
// 键 key = hash(site.js 源码) + hash(数据) + 选项；任一项不同 → 不用包、现场生成（行为与没有包时相同）。
(function (G) {
  const FMT = 1;
  const fnv = (s, h) => { h = h === undefined ? 2166136261 : h; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
  const hex = h => ('00000000' + (h >>> 0).toString(16)).slice(-8);
  const TA = { Float64Array, Float32Array, Int32Array, Uint32Array, Int16Array, Uint16Array, Uint8Array, Int8Array };
  const POOL_MAX = 4096; // 元素数 ≤ 此值的类型数组进池

  // ---------- 字节分面（只为 gzip 压缩率）----------
  function shuffle(u8, w) { if (w === 1) return u8.slice(); const n = u8.length / w, o = new Uint8Array(u8.length); for (let b = 0; b < w; b++) { const off = b * n; for (let i = 0; i < n; i++) o[off + i] = u8[i * w + b]; } return o; }
  function unshuffle(u8, w) { if (w === 1) return u8.slice(); const n = u8.length / w, o = new Uint8Array(u8.length); for (let b = 0; b < w; b++) { const off = b * n; for (let i = 0; i < n; i++) o[i * w + b] = u8[off + i]; } return o; }
  const bytesOf = a => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  // 稀疏：异或后大多是 0 → 1 位/元素的掩码 + 非零元素（只为解压快、包小）
  function maskPack(u8, w) { const n = u8.length / w, mb = Math.ceil(n / 8), mask = new Uint8Array(mb); let nz = 0; for (let i = 0; i < n; i++) { let z = true; for (let b = 0; b < w; b++) if (u8[i * w + b]) { z = false; break; } if (!z) { mask[i >> 3] |= 1 << (i & 7); nz++; } }
    if (nz > n / 2) return null; const pad = (8 - (mb % 8)) % 8, o = new Uint8Array(mb + pad + nz * w); o.set(mask, 0); let p = mb + pad; for (let i = 0; i < n; i++) if (mask[i >> 3] & (1 << (i & 7))) { o.set(u8.subarray(i * w, i * w + w), p); p += w; } return o; }
  function maskUnpack(src, w, n) { const mb = Math.ceil(n / 8), pad = (8 - (mb % 8)) % 8, o = new Uint8Array(n * w); let p = mb + pad; for (let i = 0; i < n; i++) if (src[i >> 3] & (1 << (i & 7))) { for (let b = 0; b < w; b++) o[i * w + b] = src[p + b]; p += w; } return o; }
  function xorInto(u8, refU8) { const o = new Uint8Array(u8.length); for (let i = 0; i < u8.length; i++) o[i] = u8[i] ^ refU8[i]; return o; }

  // ---------- 变长整数（只为压缩率）----------
  function vw() { let b = new Uint8Array(1 << 16), n = 0; const put = x => { if (n + 5 > b.length) { const b2 = new Uint8Array(b.length * 2); b2.set(b); b = b2; } while (x >= 128) { b[n++] = (x & 127) | 128; x = Math.floor(x / 128); } b[n++] = x; };
    return { u: put, z: x => put(x < 0 ? -2 * x - 1 : 2 * x), out: () => b.slice(0, n) }; }
  function vr(b) { let p = 0; const u = () => { let x = 0, m = 1, c; do { c = b[p++]; x += (c & 127) * m; m *= 128; } while (c & 128); return x; }; return { u, z: () => { const v = u(); return v & 1 ? -(v + 1) / 2 : v / 2; } }; }

  // ---------- 专用编码：格网上的切分三角网（SPT：[{q, tris, kind, H}]）----------
  // 顶点按位去重；新顶点记“类型”：x/y 是否正好是格线坐标（X(i)/Y(j)，用 build 的同一个函数求）、z 是否 = 格点最终高度 H、或 = 某个台地面在 (x,y) 的值；
  // 只有猜不中的分量才存 Float64。每个切分格的 4 个角点高度与最终 H 逐位异或。全部逐位还原。
  const GT = {
    enc(arr, P, put) {
      const n = arr.length, Q = new Int32Array(n), K = new Uint8Array(n), L = new Int32Array(n), HC = new Float64Array(4 * n), kinds = [];
      const ref = vw(), nv = vw(), fl = []; const map = new Map(); let nU = 0, pi = 0, pj = 0; const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer), H = P.H;
      const bits = x => { f64[0] = x; return u32[0] + ':' + u32[1]; };
      for (let e = 0; e < n; e++) { const t = arr[e]; if (Object.keys(t).join() !== 'q,tris,kind,H' || !(t.tris instanceof Float64Array) || !t.H || t.H.length !== 4 || t.tris.length % 3) throw new Error('pack: SPT shape');
        const q = t.q; Q[e] = q; let ki = kinds.indexOf(t.kind); if (ki < 0) { ki = kinds.length; kinds.push(t.kind); } K[e] = ki; L[e] = t.tris.length / 3;
        const cq = [q, q + 1, q + P.NX, q + P.NX + 1]; for (let k = 0; k < 4; k++) HC[4 * e + k] = t.H[k];
        const T = t.tris;
        for (let v = 0; v < T.length; v += 3) { const x = T[v], y = T[v + 1], z = T[v + 2], key = bits(x) + ',' + bits(y) + ',' + bits(z); const u = map.get(key);
          if (u !== undefined) { ref.u(nU - u); continue; } map.set(key, nU++); ref.u(0);
          const i = Math.round((x - P.x0) / P.c), j = Math.round((y - P.y0) / P.c), xg = P.X(i) === x, yg = P.Y(j) === y; let ty = (xg ? 1 : 0) | (yg ? 2 : 0), zk = 0;
          if (xg && yg && i >= 0 && j >= 0 && i < P.NX && j < P.NY && H[j * P.NX + i] === z) ty |= 4; else for (let k = 0; k < P.zf.length; k++) if (P.zf[k](x, y) === z) { zk = k + 1; break; }
          nv.u(ty | (zk << 3)); nv.z(i - pi); nv.z(j - pj); pi = i; pj = j; if (!xg) fl.push(x); if (!yg) fl.push(y); if (!(ty & 4) && !zk) fl.push(z); } }
      for (let e = 0; e < n; e++) { const q = Q[e], cq = [q, q + 1, q + P.NX, q + P.NX + 1]; f64[0] = 0; for (let k = 0; k < 4; k++) { const a = new Float64Array([HC[4 * e + k], H[cq[k]]]), w = new Uint32Array(a.buffer); w[0] ^= w[2]; w[1] ^= w[3]; HC[4 * e + k] = a[0]; } }
      for (let e = n - 1; e > 0; e--) Q[e] -= Q[e - 1];
      return { n, kinds, b: { Q: put(Q), K: put(K), L: put(L), HC: put(HC), R: put(ref.out()), V: put(nv.out()), F: put(new Float64Array(fl)) } };
    },
    dec(j, P, get, target) {
      const n = j.n, Q = get(j.b.Q).slice(), K = get(j.b.K), L = get(j.b.L), HC = get(j.b.HC), R = vr(get(j.b.R)), V = vr(get(j.b.V)), F = get(j.b.F), H = P.H;
      for (let e = 1; e < n; e++) Q[e] += Q[e - 1];
      let tot = 0; for (let e = 0; e < n; e++) tot += L[e]; const ALL = new Float64Array(tot * 3); const U = []; let fp = 0, pi = 0, pj = 0, o = 0;
      const xr = new Float64Array(2), xw = new Uint32Array(xr.buffer);
      target.length = n;
      for (let e = 0; e < n; e++) { const q = Q[e], cq = [q, q + 1, q + P.NX, q + P.NX + 1], Hc = new Array(4);
        for (let k = 0; k < 4; k++) { xr[0] = HC[4 * e + k]; xr[1] = H[cq[k]]; xw[0] ^= xw[2]; xw[1] ^= xw[3]; Hc[k] = xr[0]; }
        const o0 = o;
        for (let v = 0; v < L[e]; v++) { const r = R.u(); let x, y, z;
          if (r) { const u = U.length / 3 - r; x = U[3 * u]; y = U[3 * u + 1]; z = U[3 * u + 2]; }
          else { const tz = V.u(), ty = tz & 7, zk = tz >> 3, i = pi + V.z(), jj = pj + V.z(); pi = i; pj = jj;
            x = ty & 1 ? P.X(i) : F[fp++]; y = ty & 2 ? P.Y(jj) : F[fp++]; z = ty & 4 ? H[jj * P.NX + i] : zk ? P.zf[zk - 1](x, y) : F[fp++]; U.push(x, y, z); }
          ALL[o++] = x; ALL[o++] = y; ALL[o++] = z; }
        target[e] = { q, tris: ALL.subarray(o0, o), kind: j.kinds[K[e]], H: Hc }; }
      return target;
    } };

  // ---------- 编码 ----------
  // anchors = S._anchors()：{ merge: {名: 对象/数组/类型数组}, fns: {名: 函数}, consts: {根名: 对象}, extra: {名: 值}, pred: {块名: () => 预测数组} }
  function encode(S, anchors, meta, opts) {
    const A = new Map(), C = new Map(), F = new Map();
    for (const [n, o] of Object.entries(anchors.merge)) A.set(o, n);
    for (const [n, f] of Object.entries(anchors.fns)) if (!F.has(f)) F.set(f, n);
    // 常量锚点：SPEC / 数据里的每个对象按路径命名
    for (const [root, o] of Object.entries(anchors.consts)) { const st = [[o, root]]; while (st.length) { const [v, p] = st.pop(); if (!v || typeof v !== 'object' || C.has(v) || A.has(v)) continue; C.set(v, p); if (ArrayBuffer.isView(v)) continue; for (const k of Object.keys(v)) st.push([v[k], p + '\u0001' + k]); } }
    const root = { S, extra: anchors.extra || {} };
    // 第一遍：引用计数（锚点/常量不计）
    const cnt = new Map(); const st = [root];
    const visit = v => { if (!v || typeof v !== 'object') return; if (C.has(v)) return; const n = cnt.get(v) || 0; cnt.set(v, n + 1); if (n) return; if (ArrayBuffer.isView(v)) return; st.push(v); };
    while (st.length) { const v = st.pop(); if (v instanceof Map) { for (const [k, x] of v) { visit(k); visit(x); } } else if (v instanceof Set) { for (const x of v) visit(x); } else for (const k of Object.keys(v)) visit(v[k]); }
    const ids = new Map(); let nid = 0; const blobs = [], pools = {};
    const done = new Set();
    const addBlob = (a, name) => { const t = a.constructor.name, d = { t, n: a.length, name: name || null }; const pr = name && anchors.pred && anchors.pred[name]; d.data = a; if (pr) d.pred = pr; blobs.push(d); return blobs.length - 1; };
    const unknownFns = [];
    const enc = (v, path) => {
      if (v === undefined) return { $: 'u' };
      if (typeof v === 'number') { if (Object.is(v, -0)) return { $: 'n', v: '-0' }; if (!Number.isFinite(v)) return { $: 'n', v: String(v) }; return v; }
      if (typeof v === 'string' || typeof v === 'boolean' || v === null) return v;
      if (typeof v === 'function') { const n = F.get(v); if (n) return { $: 'f', n }; unknownFns.push(path); return { $: 'F' }; }
      if (typeof v === 'bigint' || typeof v === 'symbol') throw new Error('pack: unsupported ' + typeof v + ' at ' + path);
      if (C.has(v)) return { $: 'c', p: C.get(v) };
      if (A.has(v)) { const n = A.get(v); if (done.has(v)) return { $: 'a', n }; done.add(v); const cu = anchors.custom && anchors.custom[n]; if (cu) return { $: 'a', n, x: cu.codec, v: GT.enc(v, cu, a => addBlob(a, null)) }; return { $: 'a', n, v: body(v, path, n) }; }
      if (ids.has(v)) return { $: 'r', i: ids.get(v) };
      if ((cnt.get(v) || 0) > 1) { const i = nid++; ids.set(v, i); return { $: 'd', i, v: body(v, path, null) }; }
      return body(v, path, null);
    };
    const body = (v, path, anchorName) => {
      if (ArrayBuffer.isView(v)) {
        const t = v.constructor.name; if (!TA[t]) throw new Error('pack: typed ' + t);
        if (!anchorName && v.length <= POOL_MAX) { const P = pools[t] || (pools[t] = { parts: [], n: 0 }); const o = P.n; P.parts.push(v); P.n += v.length; return { $: 'p', t, o, n: v.length }; }
        return { $: 't', b: addBlob(v, anchorName) };
      }
      if (v instanceof Map) { const e = []; for (const [k, x] of v) e.push([enc(k, path + '.<k>'), enc(x, path + '.<v>')]); return { $: 'M', e }; }
      if (v instanceof Set) { const e = []; for (const x of v) e.push(enc(x, path + '.<s>')); return { $: 'S', e }; }
      if (Array.isArray(v)) { const o = new Array(v.length); for (let i = 0; i < v.length; i++) o[i] = i in v ? enc(v[i], path + '[' + i + ']') : { $: 'h' }; return anchorName ? { $: 'A', e: o } : o; }
      const pr = Object.getPrototypeOf(v); if (pr !== Object.prototype && pr !== null) throw new Error('pack: class instance at ' + path);
      const o = {}; for (const k of Object.keys(v)) { if (k === '$') throw new Error('pack: key $ at ' + path); o[k] = enc(v[k], path + '.' + k); } return o;
    };
    const graph = enc(root, 'root');
    for (const [t, P] of Object.entries(pools)) { const a = new TA[t](P.n); let o = 0; for (const p of P.parts) { a.set(p, o); o += p.length; } blobs.push({ t, n: a.length, name: '@pool:' + t, data: a }); }
    // 二进制块：可选的预测异或 → 字节分面
    const hdrBlobs = [], chunks = []; let off = 0;
    const byName = {}; blobs.forEach(b => { if (b.name) byName[b.name] = b; });
    for (const b of blobs) {
      const w = TA[b.t].BYTES_PER_ELEMENT; let u8 = bytesOf(b.data), mode = '';
      if (b.pred) { const p = b.pred(name => byName[name].data); if (p && p.length === b.n && p.constructor === b.data.constructor) { u8 = xorInto(u8, bytesOf(p)); mode = 'x'; const m = maskPack(u8, w); if (m) { u8 = m; mode = 'xm'; } } }
      if (w > 1 && opts && opts.gz) { const sh = shuffle(u8, w); if (opts.gz(sh) < opts.gz(u8)) { u8 = sh; mode += 's'; } } else if (w > 1 && !(opts && opts.gz)) { u8 = shuffle(u8, w); mode += 's'; }
      const pad = (8 - (off % 8)) % 8; if (pad) { chunks.push(new Uint8Array(pad)); off += pad; }
      hdrBlobs.push({ t: b.t, n: b.n, name: b.name, mode, off, len: u8.length }); chunks.push(u8); off += u8.length;
    }
    const hdr = Object.assign({ fmt: FMT, graph, blobs: hdrBlobs, unknownFns: unknownFns.slice(0, 50), nUnknownFns: unknownFns.length }, meta || {});
    const hj = new TextEncoder().encode(JSON.stringify(hdr)), hl = hj.length, pre = 8 + hl, pad0 = (8 - (pre % 8)) % 8;
    const out = new Uint8Array(pre + pad0 + off); out.set([67, 83, 80, 75], 0); new DataView(out.buffer).setUint32(4, hl, true); out.set(hj, 8);
    let p = pre + pad0; for (const c of chunks) { out.set(c, p); p += c.length; }
    return { bytes: out, unknownFns, hdr };
  }

  // ---------- 解码 ----------
  function parse(u8) {
    if (!(u8[0] === 67 && u8[1] === 83 && u8[2] === 80 && u8[3] === 75)) throw new Error('pack: bad magic');
    const hl = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(4, true), hdr = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hl))), pre = 8 + hl, base = pre + (8 - (pre % 8)) % 8;
    return { hdr, u8, base };
  }
  // 解出第 k 块（预测由 build 在读包时给出：pred[name](已解出的块) → 数组）
  function blobOf(P, k, pred, cache) {
    if (cache[k]) return cache[k];
    const b = P.hdr.blobs[k], T = TA[b.t], w = T.BYTES_PER_ELEMENT, raw = P.u8.subarray(P.base + b.off, P.base + b.off + b.len); let u8 = b.mode.includes('s') ? unshuffle(raw, w) : b.mode.includes('m') ? raw : raw.slice(); if (b.mode.includes('m')) u8 = maskUnpack(u8, w, b.n);
    if (b.mode.includes('x')) { const p = pred[b.name](name => { const j = P.hdr.blobs.findIndex(x => x.name === name); return blobOf(P, j, pred, cache); }); const pu = bytesOf(p); if (u8.length % 4 === 0 && pu.byteOffset % 4 === 0) { const a = new Uint32Array(u8.buffer, u8.byteOffset, u8.length / 4), c = new Uint32Array(pu.buffer, pu.byteOffset, pu.length / 4); for (let i = 0; i < a.length; i++) a[i] ^= c[i]; } else for (let i = 0; i < u8.length; i++) u8[i] ^= pu[i]; }
    return (cache[k] = new T(u8.buffer, u8.byteOffset, b.n));
  }
  // 把包解进现场：anchors 同 encode；返回 { S, extra }（S 的数据属性已合并进现场 S 对象）
  function restore(P, anchors) {
    const hdr = P.hdr, cache = {}, pred = anchors.pred || {}, ids = [];
    const poolOf = {}; hdr.blobs.forEach((b, k) => { if (b.name && b.name.startsWith('@pool:')) poolOf[b.t] = k; });
    const consts = new Map(); const constAt = p => { if (consts.has(p)) return consts.get(p); const ks = p.split('\u0001'); let v = anchors.consts[ks[0]]; for (let i = 1; i < ks.length; i++) v = v[ks[i]]; consts.set(p, v); return v; };
    const T = (blob) => blobOf(P, blob, pred, cache);
    const fill = (target, enc) => { // 锚点：原地合并
      if (ArrayBuffer.isView(target)) { const a = T(enc.b); if (a.length !== target.length) throw new Error('pack: anchor length'); target.set(a); return target; }
      if (Array.isArray(target)) { const e = enc.e; target.length = e.length; for (let i = 0; i < e.length; i++) target[i] = dec(e[i]); return target; }
      for (const k of Object.keys(enc)) { const v = enc[k]; if (v && v.$ === 'F') continue; if (v && v.$ === 'f' && typeof target[k] === 'function') continue; target[k] = dec(v); }
      return target;
    };
    const dec = v => {
      if (v === null || typeof v !== 'object') return v;
      if (Array.isArray(v)) { const o = new Array(v.length); for (let i = 0; i < v.length; i++) { const x = v[i]; if (x && x.$ === 'h') continue; o[i] = dec(x); } return o; }
      switch (v.$) {
        case undefined: { const o = {}; for (const k of Object.keys(v)) o[k] = dec(v[k]); return o; }
        case 'u': return undefined;
        case 'n': return v.v === '-0' ? -0 : Number(v.v);
        case 'f': { const f = anchors.fns[v.n]; if (!f) throw new Error('pack: fn ' + v.n); return f; }
        case 'F': return undefined;
        case 'c': return constAt(v.p);
        case 'a': { const t = anchors.merge[v.n]; if (!t) throw new Error('pack: anchor ' + v.n); if (v.x) { if (v.x !== 'gridTris') throw new Error('pack: codec ' + v.x); const cu = anchors.custom[v.n]; GT.dec(v.v, Object.assign({}, cu, { H: T(hdr.blobs.findIndex(x => x.name === cu.Hname)) }), T, t); return t; } if (v.v !== undefined) fill(t, v.v); return t; }
        case 'r': return ids[v.i];
        case 'd': { const b = v.v; let o;
          if (Array.isArray(b)) { o = new Array(b.length); ids[v.i] = o; for (let i = 0; i < b.length; i++) { const x = b[i]; if (x && x.$ === 'h') continue; o[i] = dec(x); } return o; }
          if (b && b.$ === 'M') { o = new Map(); ids[v.i] = o; for (const [k, x] of b.e) o.set(dec(k), dec(x)); return o; }
          if (b && b.$ === 'S') { o = new Set(); ids[v.i] = o; for (const x of b.e) o.add(dec(x)); return o; }
          if (b && (b.$ === 't' || b.$ === 'p')) { o = dec(b); ids[v.i] = o; return o; }
          o = {}; ids[v.i] = o; for (const k of Object.keys(b)) o[k] = dec(b[k]); return o; }
        case 'M': { const o = new Map(); for (const [k, x] of v.e) o.set(dec(k), dec(x)); return o; }
        case 'S': { const o = new Set(); for (const x of v.e) o.add(dec(x)); return o; }
        case 't': return T(v.b).slice();
        case 'p': { const pool = T(poolOf[v.t]); return pool.slice(v.o, v.o + v.n); }
        default: throw new Error('pack: tag ' + v.$);
      }
    };
    return dec(hdr.graph);
  }

  // gzip（浏览器：DecompressionStream；node：zlib）
  async function gunzip(u8) {
    if (!(u8[0] === 0x1f && u8[1] === 0x8b)) return u8; // 服务器已解压（Content-Encoding）或本来就没压缩
    if (typeof DecompressionStream === 'undefined') throw new Error('pack: no DecompressionStream');
    const ds = new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip')));
    return new Uint8Array(await ds.arrayBuffer());
  }
  const key = (srcHash, dataHash, opt) => 'k' + FMT + '-' + srcHash + '-' + dataHash + '-s' + opt.seed + '-l' + (opt.lost ? 1 : 0) + '-c' + opt.cell;
  G.CASTLE_PACK = { FMT, fnv, hex, key, encode, parse, restore, gunzip, file: opt => 'bake/s' + opt.seed + '-l' + (opt.lost ? 1 : 0) + '.bin.gz' };
})(typeof window !== 'undefined' ? window : globalThis);
