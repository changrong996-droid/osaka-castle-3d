#!/usr/bin/env node
'use strict';
// r8a：结果包 = 现场生成（逐位）。node tests/test_pack.js
// 对 web/bake/manifest.js 里的每个包：① 键 = 当前 site.js/data.js/选项的键；② 读包 build 与现场 build 的整个结果对象图逐位相等
// （数值用 Object.is，类型数组逐元素，共享引用/环的结构一一对应，函数只比“都在”）；③ 签名相同；④ 两边各跑一遍 H 审计，结果相同，
// 审计之后对象图仍然逐位相等（审计读到的数据一样）。另外：篡改包里的一个高度 → 必须被 ② 抓到（测试本身的故障注入）。
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const WEB = path.join(__dirname, '..', 'web');
require(path.join(WEB, 'data.js')); require(path.join(WEB, 'pack.js')); require(path.join(WEB, 'site.js')); require(path.join(WEB, 'bake', 'manifest.js'));
const SITE = globalThis.CASTLE_SITE, PACK = globalThis.CASTLE_PACK, MAN = globalThis.CASTLE_BAKE;
const IGNORE = new Set(['tm', 'ms', 'fromPack', '_dbg']);
function deepEq(a, b) {
  const m = new Map(), diffs = []; const st = [[a, b, 'S']];
  const push = (x, y, p) => st.push([x, y, p]);
  while (st.length && diffs.length < 20) {
    const [x, y, p] = st.pop();
    if (typeof x !== typeof y) { diffs.push(p + ': type ' + typeof x + ' vs ' + typeof y); continue; }
    if (typeof x === 'function') continue;
    if (x === null || typeof x !== 'object') { if (!Object.is(x, y)) diffs.push(p + ': ' + x + ' vs ' + y); continue; }
    if (y === null) { diffs.push(p + ': null'); continue; }
    if (m.has(x)) { if (m.get(x) !== y) diffs.push(p + ': shared-ref structure differs'); continue; } m.set(x, y);
    if (ArrayBuffer.isView(x)) { if (x.constructor !== y.constructor || x.length !== y.length) { diffs.push(p + ': typed ' + x.constructor.name + x.length + ' vs ' + y.constructor.name + y.length); continue; } for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) { diffs.push(p + '[' + i + ']: ' + x[i] + ' vs ' + y[i]); break; } continue; }
    if (x instanceof Map) { if (!(y instanceof Map) || x.size !== y.size) { diffs.push(p + ': map'); continue; } const ea = [...x], eb = [...y]; ea.forEach((e, i) => { push(e[0], eb[i][0], p + '.<k' + i + '>'); push(e[1], eb[i][1], p + '.<v' + i + '>'); }); continue; }
    if (Array.isArray(x) !== Array.isArray(y)) { diffs.push(p + ': array vs object'); continue; }
    const ka = Object.keys(x).filter(k => !(p === 'S' && IGNORE.has(k))), kb = Object.keys(y).filter(k => !(p === 'S' && IGNORE.has(k)));
    if (ka.length !== kb.length) { diffs.push(p + ': keys ' + ka.filter(k => !(k in y)).concat(kb.filter(k => !(k in x))).join(',')); continue; }
    for (const k of ka) { if (!(k in y)) { diffs.push(p + ': missing ' + k); continue; } push(x[k], y[k], Array.isArray(x) ? p + '[' + k + ']' : p + '.' + k); }
  }
  return diffs;
}
let fail = 0;
const keys = Object.keys(MAN || {}); if (!keys.length) { console.log('no packs in manifest'); process.exit(1); }
for (const key of keys) {
  const ent = MAN[key], u8 = new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(WEB, ent.file)))), P = PACK.parse(u8), opt = P.hdr.opt;
  const want = SITE.genKey(opt); if (want !== P.hdr.key || want !== key) { console.log('KEY MISMATCH', ent.file, P.hdr.key, 'want', want, '(re-run node tools/bake.js)'); fail++; continue; }
  let t = Date.now(); const A = SITE.build(opt), tl = Date.now() - t;
  // 读包的一边用全新的模块实例（新的 CASTLE_DATA/SPEC）：页面上读包时，生成器从没跑过——生成过程若改了数据/规格对象，这里会比出来
  const fresh = () => { for (const f of ['data.js', 'pack.js', 'site.js']) delete require.cache[require.resolve(path.join(WEB, f))]; delete globalThis.CASTLE_DATA; delete globalThis.CASTLE_SITE; delete globalThis.CASTLE_PACK; require(path.join(WEB, 'data.js')); require(path.join(WEB, 'pack.js')); require(path.join(WEB, 'site.js')); return globalThis.CASTLE_SITE; };
  const SITE2 = fresh();
  t = Date.now(); const B = SITE2.build(Object.assign({}, opt, { pack: P })), tp = Date.now() - t;
  let d = deepEq(A, B); const sa = A.signature(), sb = B.signature();
  console.log(ent.file, 'gz', ent.bytes, 'live', tl, 'ms', 'pack', tp, 'ms', 'sig', sa, sb, 'diffs', d.length); if (d.length) console.log(' ', d.join('\n  '));
  if (d.length || sa !== sb || sb !== P.hdr.sig || !B.fromPack) fail++;
  const AA = A.audit(), AB = B.audit(); const ja = JSON.stringify({ t: AA.total, c: AA.cnt, i: AA.items }), jb = JSON.stringify({ t: AB.total, c: AB.cnt, i: AB.items });
  d = deepEq(A, B); console.log('  audit total', AA.total, AB.total, ja === jb ? 'same' : 'DIFFERENT', 'post-audit diffs', d.length); if (ja !== jb || d.length) { fail++; if (d.length) console.log(' ', d.join('\n  ')); }
  // 测试的故障注入：包里的一个高度被改 → 必须被逐位比较抓到
  const C = fresh().build(Object.assign({}, opt, { pack: P })); C.H[12345] += 1e-9; const dc = deepEq(A, C); console.log('  tamper check', dc.length ? 'caught' : 'MISSED'); if (!dc.length) fail++;
}
// B1：建筑语法结果包（web/bake/b-*.json.gz）= 在同一 site 上现场生成的结果（JSON 逐字相同）；键 = bldg.js 源码哈希 + site 键
{ require(path.join(WEB, 'bldg.js')); const BL = globalThis.CASTLE_BLDG, MB = globalThis.CASTLE_BAKE_B || {}; const bk = Object.keys(MB); if (!bk.length) { console.log('no bldg packs'); fail++; }
  for (const key of bk) { const ent = MB[key], js = zlib.gunzipSync(fs.readFileSync(path.join(WEB, ent.file))).toString(), P = JSON.parse(js), skey = Object.keys(MAN).find(k => MAN[k].file === 'bake/s' + P.seed + '-l' + (P.lost ? 1 : 0) + '.bin.gz');
    const want = BL.genKey(skey, ''); // 包都在无 roll 时烘焙 if (want !== key) { console.log('BLDG KEY MISMATCH', ent.file, key, 'want', want, '(re-run node tools/bake.js)'); fail++; continue; }
    const opt = { seed: P.seed, lost: P.lost, cell: SITE.SPEC.grid.cell }, S = SITE.build(opt), t = Date.now(), W = BL.generate(S, {}), tg = Date.now() - t, live = JSON.stringify(BL.packW(W)), W2 = BL.unpackW(P);
    const same = live === js, sig = BL.signature(W2) === ent.sig && BL.signature(W) === ent.sig; console.log(ent.file, 'gz', ent.bytes, 'gen', tg, 'ms', 'bldgs', W.list.length, same ? 'same as live' : 'DIFFERENT', 'sig', sig ? 'ok' : 'MISMATCH'); if (!same || !sig) fail++;
    const tam = JSON.parse(js); tam.list[0].F[0].z += 1e-9; const caught = JSON.stringify(BL.packW(BL.unpackW(tam))) !== live; console.log('  bldg tamper check', caught ? 'caught' : 'MISSED'); if (!caught) fail++; } }
console.log(fail ? 'PACK_FAIL ' + fail : 'PACK_OK');
process.exit(fail ? 1 : 0);
