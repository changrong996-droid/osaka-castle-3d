#!/usr/bin/env node
'use strict';
// r8a：离线预构建结果包。node tools/bake.js [seed:lost ...]（默认 1:1 1:0）→ web/bake/s<seed>-l<lost>.bin.gz + web/bake/manifest.js
// 包 = 生成结果（build，审计前）的逐位快照；页面键匹配时读包、跳过生成（键 = site.js 源码哈希 + 数据哈希 + 选项）。
// 每次改了 site.js / data.js 都要重新运行（否则键不匹配，页面退回现场生成——结果仍正确，只是慢）。tests/test_pack.js 校验包 = 现场生成。
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const WEB = path.join(__dirname, '..', 'web');
require(path.join(WEB, 'data.js')); require(path.join(WEB, 'pack.js')); require(path.join(WEB, 'site.js')); require(path.join(WEB, 'bldg.js'));
const SITE = globalThis.CASTLE_SITE, PACK = globalThis.CASTLE_PACK, BLDG = globalThis.CASTLE_BLDG;
const list = (process.argv.slice(2).length ? process.argv.slice(2) : ['1:1', '1:0']).map(a => { const [s, l] = a.split(':'); return { seed: +s, lost: l !== '0', cell: SITE.SPEC.grid.cell }; });
fs.mkdirSync(path.join(WEB, 'bake'), { recursive: true });
const man = {}, manB = {};
for (const opt of list) {
  const t0 = Date.now(), S = SITE.build(opt), tb = Date.now() - t0;
  const key = SITE.genKey(opt), sig = S.signature();
  const { bytes, unknownFns } = PACK.encode(S, S._anchors(), { key, opt, version: SITE.SPEC.version, sig, buildMs: Math.round(tb) }, { gz: u8 => zlib.gzipSync(u8, { level: 6 }).length });
  const gz = zlib.gzipSync(bytes, { level: 9 }), file = PACK.file(opt);
  fs.writeFileSync(path.join(WEB, file), gz);
  man[key] = { file, bytes: gz.length, raw: bytes.length, sig };
  console.log(file, 'raw', bytes.length, 'gz', gz.length, 'build', tb, 'ms', 'sig', sig, 'unknownFns', [...new Set(unknownFns.map(p => p.replace(/\[\d+\]/g, '[]')))].join(' '));
  // B1：建筑语法的结果包（W 的确定性快照；键 = bldg.js 源码哈希 + site 键 + roll）
  const t1 = Date.now(), W = BLDG.generate(S, {}), tg = Date.now() - t1, bkey = BLDG.genKey(key, ''), js = JSON.stringify(BLDG.packW(W)), bgz = zlib.gzipSync(Buffer.from(js), { level: 9 }), bfile = 'bake/b-s' + opt.seed + '-l' + (opt.lost ? 1 : 0) + '.json.gz';
  fs.writeFileSync(path.join(WEB, bfile), bgz); manB[bkey] = { file: bfile, bytes: bgz.length, raw: js.length, sig: BLDG.signature(W), n: W.list.length };
  console.log(bfile, 'raw', js.length, 'gz', bgz.length, 'gen', tg, 'ms', 'bldgs', W.list.length, 'sig', BLDG.signature(W));
}
// manifest：页面只请求清单里有的包（不发 404）
fs.writeFileSync(path.join(WEB, 'bake', 'manifest.js'), '// 由 tools/bake.js 生成，勿手改\n(typeof window !== "undefined" ? window : globalThis).CASTLE_BAKE = ' + JSON.stringify(man, null, 1) + ';\n(typeof window !== "undefined" ? window : globalThis).CASTLE_BAKE_B = ' + JSON.stringify(manB, null, 1) + ';\n');
