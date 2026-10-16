// 故障注入：每条 r5 新规则（H15–H18）都要能抓到对应的违规。用法：node tests/test_faults.js（退出码 0 = 全部抓到）
const W = require('path').join(__dirname, '..', 'web'); require(W + '/data.js'); require(W + '/site.js');
const CS = globalThis.CASTLE_SITE, build = () => CS.build({ seed: 1, lost: true });
const base = build().audit(); if (base.total) { console.log('基线审计不为 0', base.cnt); process.exit(1); }
const road = S => S.roads.filter(r => r.kind === 'road').sort((a, b) => b.pts.length - a.pts.length)[0];
const mid = r => { const a = r.pts[0], b = r.pts[1]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.atan2(b[1] - a[1], b[0] - a[0])]; };
const F = [
  ['H15', '门洞被墙堵死', S => { const g = S.gates.find(g => g.spec.id === 'aoyamon'); S.parts.push({ fam: 'kura', name: '故障墙', poly: CS.rectPoly(g.x, g.y, g.open + 6, 2.5, g.ang), z: g.z, region: g.region.i, x: g.x, y: g.y }); }],
  ['H15', '道路截断（断头路）', S => { const r = road(S); const a = r.pts[0], b = r.pts[1]; r.pts = [a, [a[0] + (b[0] - a[0]) * 0.4, a[1] + (b[1] - a[1]) * 0.4]]; }],
  ['H16', '路中间放一个 3×3 m 的障碍', S => { const [x, y, an] = mid(road(S)); S.parts.push({ fam: 'kura', name: '故障物', poly: CS.rectPoly(x, y, 3, 3, an), z: 14, region: 0, x, y }); }],
  ['H16', '路面一侧抬高 0.6 m（横坡）', S => { const r = road(S), [x, y, an] = mid(r), nx = -Math.sin(an), ny = Math.cos(an); for (let j = 0; j < S.NY; j++) for (let i = 0; i < S.NX; i++) { const dx = S.X(i) - x, dy = S.Y(j) - y; if (Math.hypot(dx, dy) < 6 && dx * nx + dy * ny > 0.5) S.H[j * S.NX + i] += 0.6; } }],
  ['H16', '土桥宽度小于门洞', S => { S.ramps.find(r => r.gate.spec.id === 'otemon').width = 4; }],
  ['H17', '拆掉跨中的一个桥墩', S => { const B = S.bridges[0]; B.piers.splice(Math.floor(B.piers.length / 2), 1); }],
  ['H17', '桥墩悬空 1 m', S => { S.bridges[1].piers[2].zb += 1; }],
  ['H17', '桥面末端比路面高 0.3 m', S => { const B = S.bridges[0], f = B.topAt; B.topAt = s => f(s) + (s > B.len - 3 ? 0.3 : 0); }],
  ['H17', '土桥侧坡改成不砌石的陡坡', S => { const r = S.ramps.find(r => r.gate.spec.id === 'sakuramon'); for (let q = 0; q < S.TAG.length; q++) if (S.TAG[q] === 3 || S.TAG[q] === 1) { const x = S.X(q % S.NX), y = S.Y(Math.floor(q / S.NX)); if (Math.hypot(x - (r.p0[0] + r.p1[0]) / 2, y - (r.p0[1] + r.p1[1]) / 2) < 30) S.TAG[q] = 5; } }],
  ['H18', '门楣降到 1.8 m', S => { for (const p of S.parts) if (p.fam === 'yaguramon' && p.passages) p.passages.forEach(q => q.clearH = 1.8); }],
  ['H18', '路上种一棵阔叶树', S => { const [x, y] = mid(road(S)); S.trees.push({ fam: 'tree', x: x + 3, y, s: 1.2, r: 2.6, z: S.surfaceAt(x + 3, y), region: 0, kind: 'broad' }); }],
  ['H18', '木桥压低到水面上 1 m', S => { const B = S.bridges[0], f = B.topAt; B.topAt = s => s > B.sA + 2 && s < B.sB - 2 ? S.WZ + 1 + B.t : f(s); }],
];
let fail = 0;
for (const [rule, name, inj] of F) { const S = build(); inj(S); const A = S.audit(); const n = A.cnt[rule]; console.log((n > 0 ? 'OK  ' : 'MISS') + ' ' + rule + ' ' + name + ' → ' + rule + '=' + n + '  ' + (A.items.find(i => i.rule === rule) || {}).msg); if (!(n > 0)) fail++; }
console.log(fail ? 'FAULTS_MISSED ' + fail : 'FAULTS_OK'); process.exit(fail ? 1 : 0);
