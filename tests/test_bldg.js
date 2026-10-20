#!/usr/bin/env node
'use strict';
// B1：建筑语法的审计 H22–H27、室内相机 C9–C10。node tests/test_bldg.js（退出码 0 = 基线全 0 且每条故障注入都被抓到）
// 基线：seed 1/2 × 江戸盛期/现状（seed 1 读预构建包，seed 2 现场生成）；生成确定性（同一输入两次生成签名相同、roll 只改被重摇的建筑）。
// 故障注入：每条新规则至少一项，注入位置从生成结果里按类型/名字取，不写坐标。
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const WEB = path.join(__dirname, '..', 'web');
for (const f of ['data.js', 'pack.js', 'site.js', 'bldg.js']) require(path.join(WEB, f));
const SITE = globalThis.CASTLE_SITE, PACK = globalThis.CASTLE_PACK, B = globalThis.CASTLE_BLDG;
const siteOf = (seed, lost) => { const f = path.join(WEB, 'bake', 's' + seed + '-l' + (lost ? 1 : 0) + '.bin.gz'); if (fs.existsSync(f)) { const P = PACK.parse(new Uint8Array(zlib.gunzipSync(fs.readFileSync(f)))); if (P.hdr.key === SITE.genKey({ seed, lost })) return SITE.build({ seed, lost, pack: P }); } return SITE.build({ seed, lost }); };
let fail = 0; const log = (...a) => console.log(...a);
const run = (S, W) => { const A = B.audit(S, W), C = B.camAudit(S, W); return { A, C, total: A.total + C.total, cnt: Object.assign({}, A.cnt, C.cnt), items: A.items.concat(C.items) }; };
const S1 = siteOf(1, true);
// ---- 基线 ----
const base = {};
for (const [seed, lost] of [[1, true], [1, false], [2, true], [2, false]]) {
  const S = seed === 1 && lost ? S1 : siteOf(seed, lost), t = Date.now(), W = B.generate(S, {}), gms = Date.now() - t, R = run(S, W);
  base[seed + '-' + lost] = { n: W.list.length, by: W.stats.by, sig: B.signature(W) };
  log('baseline seed', seed, lost ? '江戸盛期' : '现状', 'bldgs', W.list.length, JSON.stringify(W.stats.by), 'gen', gms, 'ms', 'H/C', JSON.stringify(R.cnt), 'rooms', R.C.rooms, R.items.slice(0, 3).map(i => i.rule + ' ' + i.msg).join(' | '));
  if (R.total) fail++;
  { let nan = 0; for (const b of W.list) { const ge = B.exterior(b), gi = B.interior(b); for (const acc of [ge.lod0, ge.hull, gi.acc]) for (const m in acc) for (const v of acc[m]) if (!Number.isFinite(v)) nan++; } if (nan) { log('GEOMETRY_NAN', seed, lost, nan); fail++; } } // B3：几何全是有限数（长押索引错过一次 → 页面 computeBoundingSphere NaN）
  const W2 = B.generate(S, {}); if (B.signature(W2) !== B.signature(W)) { log('NONDETERMINISTIC', seed, lost); fail++; }
}
// 重摇一个节点：只改那一栋
{ const W0 = B.generate(S1, {}), g = W0.list.find(b => b.type === 'goten'), y = W0.list.find(b => b.type === 'yagura' && b.tier === 'est'), W1 = B.generate(S1, { roll: y.key + '.rooms:1' });
  const changed = W1.list.filter((b, i) => B.signature({ list: [b] }) !== B.signature({ list: [W0.list[i]] })).map(b => b.name);
  log('roll', y.key + '.rooms:1', '→ changed', changed.join(','), '(goten unchanged:', !changed.includes(g.name) + ')'); if (changed.length !== 1 || changed[0] !== y.name) { log('ROLL_LEAK'); fail++; }
  const R1 = run(S1, W1); if (R1.total) { log('roll result has violations', JSON.stringify(R1.cnt)); fail++; } }
// ---- 故障注入 ----
const fresh = () => B.generate(S1, {});
const byType = (W, t, est) => W.list.find(b => b.type === t && (est === undefined || (b.tier === 'est') === est));
const refr = b => { b.fr = B.frameOf(b.x, b.y, b.ang); const P = []; for (const [i, j] of [[0, 0], [b.nu, 0], [0, b.nv], [b.nu, b.nv]]) P.push(b.fr.w(B.U(b, i), B.V(b, j))); b.bb = B.bbox(P); delete b._geo; };
const roadMid = S => { const r = S.roads.filter(r => r.kind === 'road' && r.pts.length >= 2).sort((a, c) => c.pts.length - a.pts.length)[0]; const a = r.pts[0], c = r.pts[1]; return [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]; };
const moveTo = (b, x, y) => { const [cu, cv] = [B.U(b, b.nu / 2), B.V(b, b.nv / 2)], c = Math.cos(b.ang), s = Math.sin(b.ang); b.x = x - (cu * c - cv * s); b.y = y - (cu * s + cv * c); refr(b); };
const F = [
  ['H22', '番所移到道路上', (S, W) => { const b = byType(W, 'bansho'); const [x, y] = roadMid(S); moveTo(b, x, y); }],
  ['H22', '蔵压到土塀（移到一段本丸土塀中点）', (S, W) => { const b = byType(W, 'kura'), d = S.parts.find(p => p.fam === 'dobei' && p.region === b.region); moveTo(b, (d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2); }],
  ['H22', '两栋建筑重叠（蔵移到御殿上）', (S, W) => { const b = byType(W, 'kura'), g = byType(W, 'goten'), k = g.blocks[1].r; const [x, y] = g.fr.w(B.U(g, (k[0] + k[2]) / 2), B.V(g, (k[1] + k[3]) / 2)); moveTo(b, x, y); }],
  ['H23', '番所贴到石垣顶线 1 m 内', (S, W) => { const b = byType(W, 'bansho'), g = S.regions[b.region], lp = S.loops.find(l => l.g === g), sg = lp.crest.segs[Math.floor(lp.crest.segs.length / 3)], mx = (sg.a[0] + sg.b[0]) / 2, my = (sg.a[1] + sg.b[1]) / 2, r = Math.max(b.nu, b.nv) * b.cs / 2 + 1; moveTo(b, mx - sg.nx * r, my - sg.ny * r); }],
  ['H24', '廊下墙加高 1.5 m（屋顶穿进殿舍檐口）', (S, W) => { const g = byType(W, 'goten'), k = g.blocks.find(k => k.kind === 'rouka'); k.h += 1.5; const R = g.roofs.find(r => r.r === k.r); R.h = k.h; delete g._geo; }],
  ['H24', '御殿檐口压到别的建筑（番所贴到殿舍墙外 1 m）', (S, W) => { const g = byType(W, 'goten'), b = byType(W, 'bansho'), k = g.blocks[0].r; const [x, y] = g.fr.w(B.U(g, k[0]) - b.nu * b.cs / 2 - 1.0, B.V(g, (k[1] + k[3]) / 2)); moveTo(b, x, y); }],
  ['H25', '房间的隔断开口全部封死（走不到）', (S, W) => { const g = byType(W, 'goten'), r = g.rooms.find(r => r.jodan); g.open = g.open.filter(o => { if (o.kind === 'door' || o.kind === 'akari' || o.kind === 'window') return true; const F0 = g.F[o.f]; const [di, dj] = B.NB[o.side]; for (let k = 0; k < o.n; k++) { const i = o.side < 2 ? o.i : o.i + k, j = o.side < 2 ? o.j + k : o.j; if (F0.r[j * g.nu + i] === r.id || F0.r[(j + dj) * g.nu + i + di] === r.id) return false; } return true; }); delete g._geo; }],
  ['H25', '階段跑长减半（坡度过陡）', (S, W) => { const y = W.list.find(b => b.stairs.length); y.stairs[0].run /= 2; }],
  ['H25', '階段上方加一块楼板（净高不足）', (S, W) => { const y = W.list.find(b => b.stairs.length), st = y.stairs[0], G = B.geoOf(y), F0 = y.F[st.f]; G.solid.push({ m: 'wood', tag: 'fault', b: [B.U(y, st.rect[0]), B.V(y, st.rect[1]), F0.z + 1.6, B.U(y, st.rect[2]), B.V(y, st.rect[3]), F0.z + 1.7] }); G.int.boxes.push(G.solid[G.solid.length - 1]); }],
  ['H26', '下层隔断去掉（上层柱悬空）', (S, W) => { const y = W.list.find(b => b.type === 'yagura' && b.F.length === 3); const F0 = y.F[1], keep = F0.r.find((r, q) => F0.a[q] === B.A.ROOM); for (let q = 0; q < F0.r.length; q++) if (F0.a[q] === B.A.ROOM || F0.a[q] === B.A.STAIR) F0.r[q] = keep; delete y._geo; }],
  ['H27', '外墙去掉一块墙（无门的缺口）', (S, W) => { const y = byType(W, 'yagura', true), G = B.geoOf(y), k = G.ext.boxes.findIndex(x => x.tag === 'wall'); G.ext.boxes.splice(k, 1); G.solid = G.ext.boxes.concat(G.int.boxes); }],
  ['H27', '开口表里有窓但几何里没有窓组件', (S, W) => { const y = byType(W, 'yagura', true), G = B.geoOf(y); G.ext.wa.splice(G.ext.wa.findIndex(w => w.o.kind === 'window'), 1); }],
  ['H27', '门洞里立一根柱', (S, W) => { const y = byType(W, 'yagura', true), G = B.geoOf(y), o = y.open.find(o => o.kind === 'door'), F0 = y.F[0], w = B.wallRect(y, o.side, B.openLine(o), o.side < 2 ? o.j + 1 : o.i + 1, o.side < 2 ? o.j + 1 : o.i + 1, 0.3, 0.1); G.solid.push({ m: 'wood', tag: 'fault', b: [w[0] - 0.1, w[1] - 0.1, F0.z, w[2] + 0.1, w[3] + 0.1, F0.z + 1.8] }); }],
  // ---- B3：階段 H28 ----
  ['H28', '抽掉中间一块踏板', (S, W) => { const y = W.list.find(b => b.stairs.length), G = B.geoOf(y), k = G.int.boxes.findIndex(x => x.tag === 'step' && x.o && x.o.st === 0 && x.o.k === 5); G.int.boxes.splice(k, 1); G.solid = G.ext.boxes.concat(G.int.boxes); }],
  ['H28', '梯段跑长缩到 0.6 倍（坡度 > 55°）', (S, W) => { const y = W.list.find(b => b.stairs.length); y.stairs[0].run *= 0.6; }],
  ['H28', '去掉階段口的手摺（上层楼板边无栏）', (S, W) => { const y = W.list.find(b => b.stairs.length && B.geoOf(b).int.boxes.some(x => x.tag === 'rail')), G = B.geoOf(y); G.int.boxes = G.int.boxes.filter(x => x.tag !== 'rail'); G.solid = G.ext.boxes.concat(G.int.boxes); }],
  ['H28', '开放侧的手摺缺失', (S, W) => { const y = W.list.find(b => B.geoOf(b).int.parts.some(q => q.tag === 'handrail')), G = B.geoOf(y); G.int.parts = G.int.parts.filter(q => q.tag !== 'handrail'); }],
  ['H28', '上层楼板盖住階段口', (S, W) => { const y = W.list.find(b => b.stairs.length), st = y.stairs[0], G = B.geoOf(y), F2 = y.F[st.f + 1]; G.int.boxes.push({ m: 'floorwood', tag: 'slab', b: [B.U(y, st.rect[0]), B.V(y, st.rect[1]), F2.z - 0.25, B.U(y, st.rect[2]), B.V(y, st.rect[3]), F2.z - 0.04] }); G.solid = G.ext.boxes.concat(G.int.boxes); }],
  // ---- B3：窓 H29 ----
  ['H29', '格子窓洞口贴一张实心板（纸片窗）', (S, W) => { const y = byType(W, 'yagura', true), G = B.geoOf(y), w = G.ext.wa.find(w => w.o.kind === 'window'), a = w.ap; const o = B.outerOf(y, a.sd, a.line), bx = a.sd === 0 ? [o - 0.02, a.s0, a.z0, o, a.s1, a.z1] : a.sd === 1 ? [o, a.s0, a.z0, o + 0.02, a.s1, a.z1] : a.sd === 2 ? [a.s0, o - 0.02, a.z0, a.s1, o, a.z1] : [a.s0, o, a.z0, a.s1, o + 0.02, a.z1]; G.solid.push({ m: 'window', tag: 'fault', b: bx }); }],
  ['H29', '格子隔一根抽一根（缝过宽，人可穿过）', (S, W) => { const y = byType(W, 'yagura', true), G = B.geoOf(y), w = G.ext.wa.find(w => w.o.kind === 'window'); let k = 0; w.parts = w.parts.filter(q => q.tag !== 'bar' || (k++ % 2 === 0)); }],
  ['H29', '洞口一侧的墙去掉（没有见込み）', (S, W) => { const y = byType(W, 'yagura', true), G = B.geoOf(y), w = G.ext.wa.find(w => w.o.kind === 'window'), a = w.ap, pt = B.outerOf(y, a.sd, a.line), s = a.s0 - 0.02, d = 0.12, z = (a.z0 + a.z1) / 2, p = a.sd === 0 ? [pt - d, s, z] : a.sd === 1 ? [pt + d, s, z] : a.sd === 2 ? [s, pt - d, z] : [s, pt + d, z]; const inB = x => p[0] >= x[0] && p[0] <= x[3] && p[1] >= x[1] && p[1] <= x[4] && p[2] >= x[2] && p[2] <= x[5]; G.ext.boxes = G.ext.boxes.filter(x => !inB(x.b)); G.solid = G.ext.boxes.concat(G.int.boxes); }],
  ['H29', '橹窓的土戸缺失', (S, W) => { const y = byType(W, 'yagura', true), G = B.geoOf(y), w = G.ext.wa.find(w => w.o.kind === 'window' && w.o.slide); w.parts = w.parts.filter(q => q.tag !== 'shutter'); }],
  ['H29', '隠狭間的外皮缺失', (S, W) => { const y = W.list.find(b => B.geoOf(b).ext.wa.some(w => w.o.kind === 'hazama')), G = B.geoOf(y); G.ext.boxes = G.ext.boxes.filter(x => x.tag !== 'skin'); G.solid = G.ext.boxes.concat(G.int.boxes); }],
  ['C9', '廊下中间横一道板（相机走不过去）', (S, W) => { const g = byType(W, 'goten'), k = g.blocks.find(k => k.kind === 'rouka'), G = B.geoOf(g), F0 = g.F[0], c = [(k.r[0] + k.r[2]) / 2, (k.r[1] + k.r[3]) / 2], longU = (k.r[2] - k.r[0]) >= (k.r[3] - k.r[1]); const bx = longU ? [B.U(g, c[0]) - 0.05, B.V(g, k.r[1]), F0.z, B.U(g, c[0]) + 0.05, B.V(g, k.r[3]), F0.z + 3] : [B.U(g, k.r[0]), B.V(g, c[1]) - 0.05, F0.z, B.U(g, k.r[2]), B.V(g, c[1]) + 0.05, F0.z + 3]; G.solid.push({ m: 'wood', tag: 'fault', b: bx }); }],
  ['C10', '上段之間的床の間与房间中心各围一圈屏风（任何机位都看不到主体）', (S, W) => { const g = byType(W, 'goten'), r = g.rooms.find(r => r.jodan), G = B.geoOf(g), F0 = g.F[0], tk = g.fix.find(f => f.room === r.id), pts = [];
    { const [i, j] = tk.cells[0]; pts.push([B.U(g, i + 1), B.V(g, j + 0.5)]); } { let best = null, bd = 1e9; const cu = (r.rect[0] + r.rect[2]) / 2, cv = (r.rect[1] + r.rect[3]) / 2; for (let j = r.rect[1]; j < r.rect[3]; j++) for (let i = r.rect[0]; i < r.rect[2]; i++) { const q = j * g.nu + i; if (F0.r[q] !== r.id || F0.a[q] !== B.A.ROOM) continue; const d = Math.hypot(i + 0.5 - cu, j + 0.5 - cv); if (d < bd) { bd = d; best = [B.U(g, i + 0.5), B.V(g, j + 0.5)]; } } pts.push(best); }
    for (const [u, v] of pts) { const a = 0.6, t = 0.04; for (const bx of [[u - a, v - a, u + a, v - a + t], [u - a, v + a - t, u + a, v + a], [u - a, v - a, u - a + t, v + a], [u + a - t, v - a, u + a, v + a]]) G.solid.push({ m: 'wood', tag: 'fault', b: [bx[0], bx[1], F0.z + 0.2, bx[2], bx[3], F0.z + 2.4] }); } }],
];
for (const [rule, name, inj] of F) { const W = fresh(); let n = 0, msg = ''; try { inj(S1, W); for (const b of W.list) delete b.bad; const R = run(S1, W); n = R.cnt[rule]; msg = (R.items.find(i => i.rule === rule) || {}).msg || ''; } catch (e) { msg = 'ERR ' + e.message; }
  log((n > 0 ? 'OK  ' : 'MISS') + ' ' + rule + ' ' + name + ' → ' + rule + '=' + n + '  ' + msg); if (!(n > 0)) fail++; }
log(fail ? 'BLDG_FAIL ' + fail : 'BLDG_OK');
process.exit(fail ? 1 : 0);
