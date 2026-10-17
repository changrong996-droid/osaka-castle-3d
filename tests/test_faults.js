// 故障注入：每条 r5–r7 规则（H15–H21…）都要能抓到对应的违规。用法：node tests/test_faults.js（退出码 0 = 全部抓到）
// r7b：注入位置与数值全部从数据/生成结果取（不写坐标、高程、曲轮序号）：
//   石垣断面 = 基线审计 H19/H21 实际量过的断面里，本丸（honmaru）落差最大的那一个（S.conf.secs：顶线点、墙脚点、台地顶 top、下层 zl、水面/下层 zlow）；
//   曲轮按名字找；桥按桥墩最多的那座；水位用 S.wzAt；地面用 S.surfaceAt / 曲轮拟合面 g.zAt。
const W = require('path').join(__dirname, '..', 'web'); require(W + '/data.js'); require(W + '/site.js');
const CS = globalThis.CASTLE_SITE, build = () => CS.build({ seed: 1, lost: true });
const S0 = build(), base = S0.audit(); if (base.total) { console.log('基线审计不为 0', base.cnt); process.exit(1); }
const SEC = (S0.conf.secs || []).filter(s => s.region === 'honmaru').sort((a, b) => (b.top - b.zlow) - (a.top - a.zlow))[0];
if (!SEC) { console.log('基线没有本丸石垣断面'); process.exit(1); }
const R = Math.max(8, SEC.top - SEC.zlow); // 注入半径：与墙高同量级（够覆盖一整段勾配面）
const regIdx = name => { const L = S0.regions.filter(g => g.name === name).sort((a, b) => b.area - a.area); if (!L.length) throw new Error('no region ' + name); return L[0].i; };
const road = S => S.roads.filter(r => r.kind === 'road').sort((a, b) => b.pts.length - a.pts.length)[0];
const mid = r => { const a = r.pts[0], b = r.pts[1]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.atan2(b[1] - a[1], b[0] - a[0])]; };
const bigBridge = S => S.bridges.slice().sort((a, b) => b.piers.length - a.piers.length)[0];
const F = [
  ['H15', '门洞被墙堵死', S => { const g = S.gates.find(g => g.spec.id === 'aoyamon'); S.parts.push({ fam: 'kura', name: '故障墙', poly: CS.rectPoly(g.x, g.y, g.open + 6, 2.5, g.ang), z: g.z, region: g.region.i, x: g.x, y: g.y }); }],
  ['H15', '道路截断（断头路）', S => { const r = road(S); const a = r.pts[0], b = r.pts[1]; r.pts = [a, [a[0] + (b[0] - a[0]) * 0.4, a[1] + (b[1] - a[1]) * 0.4]]; }],
  ['H16', '路中间放一个 3×3 m 的障碍', S => { const [x, y, an] = mid(road(S)); const g = S.zoneAt(x, y); S.parts.push({ fam: 'kura', name: '故障物', poly: CS.rectPoly(x, y, 3, 3, an), z: S.surfaceAt(x, y), region: g ? g.i : -1, x, y }); }],
  ['H16', '路面一侧抬高 0.6 m（横坡）', S => { const r = road(S), [x, y, an] = mid(r), nx = -Math.sin(an), ny = Math.cos(an); for (let j = 0; j < S.NY; j++) for (let i = 0; i < S.NX; i++) { const dx = S.X(i) - x, dy = S.Y(j) - y; if (Math.hypot(dx, dy) < 6 && dx * nx + dy * ny > 0.5) S.H[j * S.NX + i] += 0.6; } }],
  ['H16', '土桥宽度小于门洞', S => { S.ramps.find(r => r.gate.spec.id === 'otemon').width = 4; }],
  ['H17', '拆掉跨中的一个桥墩', S => { const B = bigBridge(S); B.piers.splice(Math.floor(B.piers.length / 2), 1); }],
  ['H17', '桥墩悬空 1 m', S => { const B = bigBridge(S); B.piers[Math.floor(B.piers.length / 2)].zb += 1; }],
  ['H17', '桥面末端比路面高 0.3 m', S => { const B = bigBridge(S), f = B.topAt; B.topAt = s => f(s) + (s > B.len - 3 ? 0.3 : 0); }],
  ['H17', '土桥侧坡改成不砌石的陡坡', S => { const r = S.ramps.find(r => r.gate.spec.id === 'sakuramon'); for (let q = 0; q < S.TAG.length; q++) if (S.TAG[q] === 3 || S.TAG[q] === 1) { const x = S.X(q % S.NX), y = S.Y(Math.floor(q / S.NX)); if (Math.hypot(x - (r.p0[0] + r.p1[0]) / 2, y - (r.p0[1] + r.p1[1]) / 2) < 30) S.TAG[q] = 5; } }],
  ['H18', '门楣降到 1.8 m', S => { for (const p of S.parts) if (p.fam === 'yaguramon' && p.passages) p.passages.forEach(q => q.clearH = 1.8); }],
  ['H18', '路上种一棵阔叶树', S => { const [x, y] = mid(road(S)); S.trees.push({ fam: 'tree', x: x + 3, y, s: 1.2, r: 2.6, z: S.surfaceAt(x + 3, y), region: 0, kind: 'broad' }); }],
  ['H18', '木桥压低到水面上 1 m', S => { const B = bigBridge(S), f = B.topAt, c = B.P(B.len / 2, 0), wz = S.wzAt(c[0], c[1]); B.topAt = s => s > B.sA + 2 && s < B.sB - 2 ? wz + 1 + B.t : f(s); }],
  // r6：地形顺从边线。注入时先把那一片的切分格退回网格（切分三角形存的是切分时的高度，只改 H 不会影响它们）
  ['H19', '本丸一段石垣顶线退回 1.5 m 网格（台阶）', S => unsplit(S, SEC.cx, SEC.cy, R)],
  ['H19', '切分格里的顶线顶点下沉 0.3 m（顶线塌边）', S => near(S, SEC.cx, SEC.cy, R, q => { const k = S.splitIdx[q]; if (k < 0) return; const T = S.splitTris[k].tris; for (let t = 0; t < T.length; t += 3) { const onGrid = Math.abs((T[t] - S.X(0)) / S.cell % 1) < 1e-9 && Math.abs((T[t + 1] - S.Y(0)) / S.cell % 1) < 1e-9; const g = S.regions[SEC.g]; if (!onGrid && Math.abs(T[t + 2] - g.zAt(T[t], T[t + 1])) < 1e-6) T[t + 2] -= 0.3; } })],
  ['H20', '本丸地面上挖一个 0.3 m 深的坑', S => { const q = flat(S, regIdx('honmaru')); unsplit(S, S.X(q % S.NX), S.Y(Math.floor(q / S.NX)), 4); S.H[q] -= 0.3; }],
  ['H20', '二之丸地面一角翘起 0.15 m（坡度 10%）', S => { const q = flat(S, regIdx('ninomaru')); S.H[q] += 0.15; }],
  // 墙脚抬高：勾配面下部 1/3 被填成平台（面没有落到下层）
  ['H21', '石垣脚线处地面被抬高（勾配面没落到下层）', S => { const zf = SEC.zlow + (SEC.top - SEC.zlow) / 3; unsplit(S, SEC.cx, SEC.cy, R); near(S, SEC.cx, SEC.cy, R, q => { if (S.TAG[q] === 1 && S.H[q] < zf) S.H[q] = zf; }); }],
  ['H21', '石垣面陡成近乎垂直（勾配被拉直）', S => { const zm = (SEC.top + SEC.zl) / 2; unsplit(S, SEC.cx, SEC.cy, R); near(S, SEC.cx, SEC.cy, R, q => { if (S.TAG[q] === 1) { const x = S.X(q % S.NX), y = S.Y(Math.floor(q / S.NX)); S.H[q] = S.H[q] > zm ? S.regions[SEC.g].zAt(x, y) : SEC.zl; } }); }],
  // r8（S1）：锐角隅线——把一个入隅改回 r7b 的圆角（到墙脚顶点的距离 → 锥面）。转角从基线审计实际量过的隅线里取（S.conf.cornerSecs：入隅、落差最大）
  ['H21', '入隅改成圆角（锥面）', S => { const C = (S0.conf.cornerSecs || []).filter(c => !c.cvx).sort((a, b) => (b.top - b.zV) - (a.top - a.zV))[0]; if (!C) throw new Error('基线没有量过的入隅');
    const L = Math.hypot(C.cx - C.vx, C.cy - C.vy) * 1.2, cone = (x, y) => Math.min(C.top, C.zV + C.s * Math.hypot(x - C.vx, y - C.vy));
    for (const sp of S.splitTris) { const T = sp.tris; for (let t = 0; t < T.length; t += 3) if (Math.hypot(T[t] - C.vx, T[t + 1] - C.vy) < L && S.zoneAt(T[t], T[t + 1]) === S.regions[C.g]) T[t + 2] = Math.max(T[t + 2], cone(T[t], T[t + 1])); }
    near(S, C.vx, C.vy, L, q => { const x = S.X(q % S.NX), y = S.Y(Math.floor(q / S.NX)); if (S.CLS[q] === C.g) S.H[q] = Math.max(S.H[q], cone(x, y)); }); }],
];
// 辅助：在 (x, y) 周围 r m 内
function near(S, x, y, r, f) { for (let j = 0; j < S.NY; j++) { const dy = S.Y(j) - y; if (Math.abs(dy) > r) continue; for (let i = 0; i < S.NX; i++) { const dx = S.X(i) - x; if (dx * dx + dy * dy <= r * r) f(j * S.NX + i); } } }
function unsplit(S, x, y, r) { near(S, x, y, r + 2, q => { S.splitIdx[q] = -1; }); }
function flat(S, gi) { // 曲轮 gi 内一个离顶线 >10 m、四周都是台地拟合面高程、没切分、没被整平/坡道改过的格点
  const g = S.regions[gi], onSurf = q => Math.abs(S.H[q] - g.zAt(S.X(q % S.NX), S.Y(Math.floor(q / S.NX)))) < 1e-6;
  for (let j = 2; j < S.NY - 2; j++) for (let i = 2; i < S.NX - 2; i++) { const q = j * S.NX + i; if (S.CLS[q] !== gi || S.TAG[q] !== 0 || S.LOCK[q] || !onSurf(q)) continue; const x = S.X(i), y = S.Y(j); if (S.crestDist(g, x, y) < 10 || !S.inEncl(g, x, y)) continue; let ok = true; for (const d of [-S.NX - 1, -S.NX, -S.NX + 1, -1, 1, S.NX - 1, S.NX, S.NX + 1, 0]) if (!onSurf(q + d) || S.splitIdx[q + d] >= 0 || S.splitIdx[q + d - 1] >= 0 || S.splitIdx[q + d - S.NX] >= 0 || S.splitIdx[q + d - S.NX - 1] >= 0 || S.TAG[q + d] !== 0) ok = false; if (ok && (j * 7 + i * 13) % 5 === 0) return q; }
  throw new Error('flat: no point in ' + g.name); }
console.log('断面（数据取）：' + SEC.region + ' 顶线 (' + SEC.cx.toFixed(1) + ', ' + SEC.cy.toFixed(1) + ') top ' + SEC.top.toFixed(2) + ' 下层 ' + SEC.zl.toFixed(2) + ' 水/下层 ' + SEC.zlow.toFixed(2) + '，半径 ' + R.toFixed(1) + ' m');
let fail = 0;
for (const [rule, name, inj] of F) { const S = build(); inj(S); const A = S.audit(); const n = A.cnt[rule]; console.log((n > 0 ? 'OK  ' : 'MISS') + ' ' + rule + ' ' + name + ' → ' + rule + '=' + n + '  ' + (A.items.find(i => i.rule === rule) || {}).msg); if (!(n > 0)) fail++; }
console.log(fail ? 'FAULTS_MISSED ' + fail : 'FAULTS_OK'); process.exit(fail ? 1 : 0);
