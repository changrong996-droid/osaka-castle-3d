'use strict';
// ===== B1：建筑语法（building grammar）——城内建筑的外观与内部出自同一份规格 =====
// 不依赖 three.js，node 里也能跑。输入 = site.js 的生成结果 S（现场生成或读包恢复，二者逐位相同），输出 W = { list: [建筑], … }。
// 思路（参考 背景ガチャ 的节点链 形→开口→ゾーン→置き場→仕上げ→小物）：
//   类型 → 占地（自由台地面积 − 退距 − 保留通道，规则推导，不写坐标）→ 半間格（0.985 m）属性（身舎/入側/廊下/土間/階段/石落し + 保留通行）
//   → 开口（门/窗/石落し 记在格边上：外观与内部读同一张表，所以内外永远一致）→ 房间/装置（畳、襖、階段、少量设备）→ 屋顶（入母屋/切妻，逐层叠放）。
// 每个节点一个种子 = fnv(全局种子 | 建筑键（类型 + 量化位置）| 节点名 | 重摇次数)；生成确定，网址 #seed=…&roll=<建筑键>.<节点>:<n> 可复现、可单独重摇一个节点。
// 两档：实测/文献元素（地形、石垣、现存橹的平面与层数/面积/高度、天守外观）严格；没有文献的建筑按规则 + 种子生成，标“推定”，每栋带 provenance。
(function castleBldg(G) {
  const fnv = (s, h) => { h = h === undefined ? 2166136261 : h; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
  const rng = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const KEN = 1.97, CS = KEN / 2; // 1 間（柱间惯例）；格 = 半間（畳的短边量级）
  // 格属性
  const A = { OUT: 0, ROOM: 1, IRI: 2, ROUKA: 3, DOMA: 4, STAIR: 5, ISHI: 6, TOKO: 7, VOID: 8 };
  const WALKABLE = a => a === A.ROOM || a === A.IRI || a === A.ROUKA || a === A.DOMA || a === A.STAIR;
  const INSIDE = a => a !== A.OUT;
  // ---------------- 参数表（每项带来源；“推定”= 无文献，规则 + 种子在范围内取值）----------------
  const SPEC = {
    version: 'web-r14-fit', ken: KEN, cell: CS,
    // 退距与保留通道（规则参数，不是坐标）
    setback: { crest: 5.0, part: 3.0, tenshu: 12.0, roadMargin: 2.0, gateReach: 50, gateMargin: 3.0, tree: 1.0, between: 3.2 },
    contact: 0.25,                // 抵接容差：墙端顶到建筑面时允许顶入 ≤0.25 m（= site 墙接触容差 0.2 + 数值带 0.05），不算压到
    found: { max: 1.5 },          // = site SPEC.found.max：斜面上地板水平、基础 ≤1.5 m
    clearH: 2.1,                  // 檐下净空 ≥ 人高 1.7 + 0.4（= site SPEC.clear）
    // 階段（B3）：急勾配の木階段——踏板 + 両側の側桁 + 開いた側の手摺；上層の床に階段口（VOID）+ 周囲の手摺。千貫櫓 1961 復元の木階段 = 二間弱で一層、傾斜約 56°（shirofan o04，引《修理工事報告書》）
    //   → 规则：坡度 45°–55°（slopeMin 1.0 … slopeMax 1.43；明治陆军的 35° 缓阶段是后加的，不采用），踢面 0.15–0.25 m，净高 ≥1.9 m；尺寸细节（板厚/側桁/手摺高）推定（惯例）
    stair: { riserMax: 0.25, riserMin: 0.15, slopeMax: 1.43, slopeMin: 1.0, head: 1.9, tread: 0.045, nosing: 0.03, stringer: [0.06, 0.26], rail: 0.85, post: 0.07, railSafe: 1.6 },
    // 梁（B3）：橹的武者走り上方露出木组（千贯橹 1 階：头上的木组 = 上层墙线；内室 = 天井板張り，城市 yagura.pdf / shirofan o04）→ 武者走り：繋梁（每間一根，跨入側）+ 根太（沿墙方向，间距 0.45 m）；内室：板天井 + 竿縁。尺寸推定
    beam: { tie: [0.2, 0.3], joist: [0.1, 0.1], pitch: 0.45 },
    nageshi: { h: 0.12, d: 0.03 }, // 御殿 長押（書院造の惯例；推定）
    beamMax: 3 * KEN,             // 上层柱落在下层柱或 ≤3 間 的梁上（木梁跨度惯例，与 site 的桥跨 3 間同源）
    door: { h: 1.8, w: 2 },       // 门洞净高 1.8 m（内法 ≈ 5.8–6 尺），宽 2 格 = 1 間；推定（惯例）
    // 窓（B3）：墙上真开洞（墙厚 wallT 的侧面 = 窓の見込み），内外同一组件。类型按建筑类型/层由规则定：
    //   橹 = 塗籠格子窓 + 土戸（引戸）：大坂城现存橹「格子窓」「土戸」（shirofan o04/o06；城外侧另有 隠狭間、石落し）——格子用灰泥（塗籠），土戸滑到相邻一間的墙前（引き代 = 窓宽 → 窓不相邻）；
    //   千貫櫓 城内侧原本无窓（东/北面的窓是明治陆军加的，1961 修理时拆除：shirofan o04）→ measured.winIn = false；
    //   隠狭間：城外侧墙每间一处（外面灰泥封皮、里面开 丸/三角/四角 口；千贯 1 階 11、2 階 8；乾 共 16：shirofan o04/o06）；
    //   華頭窓：仅失传三重橹的顶层城内侧中央（推定：大坂城现存橹无華頭窓，三重橹顶层的装饰惯例）；番所 = 突上戸 + 木格子（推定）；御殿 = 明障子 引違い（半开，推定）
    win: { sill: 0.85, h: 0.95, w: 1.2, koshi: { bar: 0.11, depth: 0.12, pitch: 0.24 }, doto: 0.08, kato: { sill: 0.75, h: 1.25, w: 1.1 }, tsuki: 0.6, hazama: { s: 0.24, z: 0.75, skin: 0.03 }, openMin: 0.25, gapMax: 0.2, gapMin: 0.06 }, // 格子缝：≤0.2 m（头/肩过不去，防御用；推定），≥0.06 m（看得见外面）
    cam: { R: 0.25, eye: 1.3 },   // 室内相机球半径/眼高（门洞 1.8 m 里头顶余量 ≥0.25 m）
    wallT: 0.24,
    // 御殿（本丸御殿：徳川期 1626 竣工、存续到 1868）。r14：江戸盛期 = 拟合模式（fit）——殿舍占地取 NDL 绘图数字化（data/goten_fit.json，见 docs/BUILDINGS.md §2.4）；
    // halls 的尺寸（間）= 绘图实测值取整（fit 数据缺失时的规则后备：雁行链），深 ≥3 間（坊主部屋/御使者間 等长条附属）
    goten: {
      floor: [0.6, 0.9], wallH: [3.5, 4.2], ov: 1.6, pitch: 0.62, gap: 2, corridor: 3,
      halls: [ // 名称、宽×深（間）范围；顺序 = 表 → 奥（后备模式的雁行链）。值 = b5a 绘图实测（图2；图1 交叉检验差 ≤3 m）
        { name: '遠侍', w: [14, 15], d: [11, 11] },
        { name: '式台', w: [16, 17], d: [4, 5] },
        { name: '大広間', w: [17, 19], d: [12, 13] },
        { name: '小広間', w: [12, 13], d: [10, 11] }, // = 白書院（岩間 2024）
        { name: '御対面所', w: [10, 10], d: [6, 6] },
        { name: '御黒書院', w: [7, 8], d: [7, 8] },
        { name: '御座間', w: [12, 13], d: [8, 9] }, // = 銅御殿（御座御殿，岩間 2024）：不单独再放
      ],
      side: { name: '御下台所', w: [12, 13], d: [11, 12] },
      dMin: 3, // 間：长条附属（坊主部屋 19×3、御使者間 16.5×4）
      fit: {
        on: true, tol: { center: 1.0, size: 0.5 * KEN }, // H30：模型殿舍（吸附后）相对绘图 mrr 的中心偏差 ≤1 m、尺寸偏差 ≤0.5 間
        minPiece: 4, ringMin: 12, stripMin: 6, // 碎块短边 ≥2 間；短边 ≥6 間 四周入側，3–6 間 一侧入側
        corridor: { w: [2, 5], def: 3 }, // 廊下宽 2–5 格 = 1–2.5 間（御成廊下 2.5 間）
        court: [2, 8], // 殿舍间中庭/坪庭 2–8 m（绘图实测范围；拟合模式下由数据决定，不再是固定 gap）
        entry: '玄関', kitchen: ['御下台所', '台所衆部屋'], jodan: ['大広間', '小広間', '御対面所', '御黒書院', '御座間'],
        alias: { '銅御殿': '御座間', '白書院': '小広間', '台所': '御下台所' },
        prio: ['遠侍', '大広間', '小広間', '御座間', '御黒書院', '御対面所', '式台', '御伺公間・御使者間', '御下台所', '御老中部屋', '坊主部屋', '御納戸', '御書院(東)', '御料理間', '御納戸(北)', '御右筆部屋', '御成廊下', '玄関', '台所衆部屋'],
        // 拓扑（b5a 提案 §4.3）：玄関 → 遠侍 → 式台(西) → 大広間 → 御成廊下 → 小広間；遠侍 北 → 坊主部屋/老中部屋 → 御使者間 → 対面所 → 黒書院 → 御座間；遠侍 东 → 台所
        links: [['玄関', '遠侍'], ['遠侍', '式台'], ['式台', '大広間'], ['大広間', '御成廊下'], ['御成廊下', '小広間'],
          ['遠侍', '坊主部屋'], ['坊主部屋', '御伺公間・御使者間'], ['御伺公間・御使者間', '御老中部屋'], ['御伺公間・御使者間', '御対面所'], ['御対面所', '御黒書院'], ['御黒書院', '御座間'],
          ['遠侍', '台所衆部屋'], ['台所衆部屋', '御下台所'], ['御老中部屋', '御納戸'], ['御老中部屋', '御書院(東)'], ['御書院(東)', '御下台所'], ['御対面所', '御右筆部屋'], ['御黒書院', '御料理間'], ['御座間', '御納戸(北)'], ['小広間', '御対面所']],
      },
    },
    // 橹：层高与屋顶（推定范围）；现存橹的层数/每层面积/总高为实测（重要文化财数据，见 docs/BUILDINGS.md）
    yagura: { storyH: [3.4, 4.8], plinth: 0.45, ov: [1.5, 1.2, 1.0], pitch: 0.55, iri: 2, lost3H: [18, 20], lost2H: [12, 14] },
    measured: { // 重要文化财：层数、各层面积 m²、高 m（千貫/乾 = 大阪市「特別公開する櫓について」；六番 = 现地说明牌；一番 高度无公开数据 → 范围）
      '千貫櫓': { stories: 2, area: [217.26, 162.95], H: 13.5, winIn: false, hazama: [11, 8] },
      '乾櫓': { stories: 2, area: [186.23, 186.23], H: 10.3, L: true, hazama: [8, 8] },
      '六番櫓': { stories: 2, area: [224.16, 133.43], H: 15.4 },
      '一番櫓': { stories: 2, area: null, H: null },
    },
    // 伏見櫓（二之丸唯一的三重櫓，1945 焼失）：城戸久「大阪城伏見櫓建築考」建築學會論文集 27 (1942) p.22：初重 東西 9 × 南北 8 間、2 重 7×6、3 重 5×4（各重逓減 1 間 = 每侧半間×2）、室 6/4/4；『大坂城誌』高 7 間 5 尺（1 間 = 6 尺 → 14.24 m）
    byName: { '伏見櫓': { tiers: [[9, 8], [7, 6], [5, 4]], rooms: [6, 4, 4], H: 14.24, src: '城戸久 1942（建築學會論文集 27）' } },
    storiesByName: { '伏見櫓': 3 }, // 二之丸唯一的三重櫓（武将の道 4968；AIJ 1942「大阪城伏見櫓建築考」）；site 的槽位尺寸仍是 yagura2 默认 12×10 m
    small: { bansho: { w: [3, 4], d: [2, 3], wallH: 2.7 }, kura: { w: [3, 5], d: [2, 3], wallH: 3.6 } },
  };

  // ---------------- 小工具 ----------------
  const frameOf = (x, y, ang) => { const c = Math.cos(ang), s = Math.sin(ang); return { x, y, ang, c, s, w: (u, v) => [x + u * c - v * s, y + u * s + v * c], l: (px, py) => { const dx = px - x, dy = py - y; return [dx * c + dy * s, -dx * s + dy * c]; } }; };
  function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = clamp(t, 0, 1); return Math.hypot(px - ax - t * dx, py - ay - t * dy); }
  function inPoly(x, y, P) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
  function polyDist(x, y, P) { let d = 1e18; for (let i = 0, j = P.length - 1; i < P.length; j = i++) d = Math.min(d, segDist(x, y, P[j][0], P[j][1], P[i][0], P[i][1])); return inPoly(x, y, P) ? -d : d; }
  const bbox = P => { let a = 1e18, b = 1e18, c = -1e18, d = -1e18; for (const p of P) { if (p[0] < a) a = p[0]; if (p[1] < b) b = p[1]; if (p[0] > c) c = p[0]; if (p[1] > d) d = p[1]; } return [a, b, c, d]; };
  // 主轴：曲轮顶线各段方向按长度加权（模 90°）
  function axisOf(S, g) { const lp = (S.loops || []).find(l => l.g === g); const segs = lp ? lp.crest.segs : g.edges.map(e => ({ tx: e.tx, ty: e.ty, len: e.len })); let sx = 0, sy = 0; for (const s of segs) { const a = Math.atan2(s.ty, s.tx) * 4; sx += Math.cos(a) * s.len; sy += Math.sin(a) * s.len; } return Math.atan2(sy, sx) / 4; }
  // 最大矩形分解（格集合 → 矩形，贪心；屋顶/外壳按矩形做）
  function rects(cells, nu, nv, pred) { const used = new Uint8Array(nu * nv), out = []; for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const q = j * nu + i; if (used[q] || !pred(cells[q])) continue; let i1 = i; while (i1 + 1 < nu && !used[j * nu + i1 + 1] && pred(cells[j * nu + i1 + 1])) i1++; let j1 = j; for (;;) { if (j1 + 1 >= nv) break; let ok = true; for (let ii = i; ii <= i1; ii++) { const qq = (j1 + 1) * nu + ii; if (used[qq] || !pred(cells[qq])) { ok = false; break; } } if (!ok) break; j1++; } for (let jj = j; jj <= j1; jj++) for (let ii = i; ii <= i1; ii++) used[jj * nu + ii] = 1; out.push([i, j, i1 + 1, j1 + 1]); } return out; }

  // ---------------- 建筑对象 ----------------
  // b.F[f] = { z（地板绝对标高）, h（墙高）, a: Uint8Array 属性, r: Int16Array 房间号（-1 无）, kc: Uint8Array 保留通行 }
  // 格 (i, j) 占 u ∈ [u0 + i·cs, u0 + (i+1)·cs]，v 同理；局部 → 世界：b.fr.w(u, v)
  function mkB(o) { const b = Object.assign({ cs: CS, F: [], rooms: [], open: [], stairs: [], fix: [], blocks: [], roofs: [], notes: [] }, o); b.fr = frameOf(b.x, b.y, b.ang); return b; }
  const U = (b, i) => b.u0 + i * b.cs, V = (b, j) => b.v0 + j * b.cs;
  function floorNew(b, z, h) { const n = b.nu * b.nv, F = { z, h, a: new Uint8Array(n), r: new Int16Array(n).fill(-1), kc: new Uint8Array(n) }; b.F.push(F); return F; }
  const at = (b, F, i, j) => (i < 0 || j < 0 || i >= b.nu || j >= b.nv) ? A.OUT : F.a[j * b.nu + i];
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // side 0:+u 1:-u 2:+v 3:-v
  const nodeSeed = (W, key, node) => fnv(W.seed + '|' + key + '|' + node + '|' + (W.roll[key + '.' + node] || 0));

  // ---------------- 自由占地栅格（置き場）----------------
  // 半間格（与建筑同一网格、同一主轴），格心合格 ⇔ 在曲轮围合线内 ∧ 离石垣顶线 ≥ setback ∧ 离道路（中线）≥ 净宽/2 + margin ∧ 不在门内保留通道
  // ∧ 离已有部件 ≥ part margin（天守 ≥ tenshu）——全部规则参数，不写坐标。
  function freeGrid(S, g, ang, opts) {
    const SB = Object.assign({}, SPEC.setback, opts || {}), bb = g.bb, fr0 = frameOf(0, 0, ang);
    let u0 = 1e9, v0 = 1e9, u1 = -1e9, v1 = -1e9; for (const [x, y] of [[bb[0], bb[1]], [bb[2], bb[1]], [bb[0], bb[3]], [bb[2], bb[3]]]) { const [u, v] = fr0.l(x, y); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    u0 = Math.floor(u0 / KEN) * KEN; v0 = Math.floor(v0 / KEN) * KEN; // 全城一张以原点为基准的間格：同一主轴的建筑柱筋相通
    const nu = Math.ceil((u1 - u0) / CS) + 1, nv = Math.ceil((v1 - v0) / CS) + 1, M = new Uint8Array(nu * nv);
    const roads = S.roads.filter(r => r.pts.length > 1), parts = S.parts.filter(p => p.poly && p.region !== undefined).map(p => ({ p, bb: bbox(p.poly), m: p.fam === 'tenshu' ? SB.tenshu : SB.part }));
    const gates = S.gates.filter(G => G.region === g && G.poly).map(G => { const c = Math.cos(G.ang), s = Math.sin(G.ang); let n = [-s, c]; const tst = k => { const x = G.x + n[0] * k, y = G.y + n[1] * k; return S.inEncl(g, x, y) ? S.crestDist(g, x, y) : -1e9; }; if (tst(12) < tst(-12)) n = [s, -c]; return { G, n, w: (G.open || G.w) / 2 + SB.gateMargin }; });
    // 判定在“間块”（2×2 格）的中心做，半径按块的半对角线放大（保守），块内 4 格同值——计算量 1/4
    const half = KEN * 0.7072, nU = Math.ceil(nu / 2), nV = Math.ceil(nv / 2);
    const segs = []; for (const r of roads) { const m = (r.need || 6) / 2 + SB.roadMargin + half; for (let k = 0; k + 1 < r.pts.length; k++) { const a = r.pts[k], c = r.pts[k + 1]; segs.push([a[0], a[1], c[0], c[1], m, Math.min(a[0], c[0]) - m, Math.min(a[1], c[1]) - m, Math.max(a[0], c[0]) + m, Math.max(a[1], c[1]) + m]); } }
    for (let J = 0; J < nV; J++) for (let I = 0; I < nU; I++) {
      const u = u0 + (I + 0.5) * KEN, v = v0 + (J + 0.5) * KEN, [x, y] = fr0.w(u, v);
      if (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3] || !S.inEncl(g, x, y) || S.zoneAt(x, y) !== g) continue;
      let ok = true;
      for (const q of segs) { if (x < q[5] || x > q[7] || y < q[6] || y > q[8]) continue; if (segDist(x, y, q[0], q[1], q[2], q[3]) < q[4]) { ok = false; break; } }
      if (!ok) continue;
      for (const q of gates) { const dx = x - q.G.x, dy = y - q.G.y, a = dx * q.n[0] + dy * q.n[1], l = Math.abs(-dx * q.n[1] + dy * q.n[0]); if (a > -8 && a < SB.gateReach && l < q.w + half + 6) { ok = false; break; } }
      if (!ok) continue;
      for (const P of parts) { const m = P.m + half; if (x < P.bb[0] - m || x > P.bb[2] + m || y < P.bb[1] - m || y > P.bb[3] + m) continue; if (polyDist(x, y, P.p.poly) < m) { ok = false; break; } }
      if (!ok || S.crestDist(g, x, y) < SB.crest + half) continue;
      for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) { const i = 2 * I + di, j = 2 * J + dj; if (i < nu && j < nv) M[j * nu + i] = 1; }
    }
    // 二维前缀和：O(1) 判矩形全空
    const P = new Int32Array((nu + 1) * (nv + 1)); for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) P[(j + 1) * (nu + 1) + i + 1] = M[j * nu + i] + P[j * (nu + 1) + i + 1] + P[(j + 1) * (nu + 1) + i] - P[j * (nu + 1) + i];
    const sum = (i0, j0, i1, j1) => P[j1 * (nu + 1) + i1] - P[j0 * (nu + 1) + i1] - P[j1 * (nu + 1) + i0] + P[j0 * (nu + 1) + i0];
    return { g, ang, u0, v0, nu, nv, M, fr0, free: (i0, j0, i1, j1) => i0 >= 0 && j0 >= 0 && i1 <= nu && j1 <= nv && sum(i0, j0, i1, j1) === (i1 - i0) * (j1 - j0), x: (i, j) => fr0.w(u0 + i * CS, v0 + j * CS) };
  }

  // ---------------- r14：本丸御殿“拟合模式”（江戸盛期）——殿舍占地 = 绘图拟合（data/goten_fit.json → CASTLE_DATA.gotenFit），房间分割 = 规则 ----------------
  // 来源：NDL「大坂御城御本丸并御殿絵図」pid 1286170（PDM），21 控制点配准（TPS 留一 RMS 4.82 m），殿舍 = 最小外接矩形（mrr）。
  // 规则：① 每个 use=hall/corridor 的殿舍按 mrr 中心/尺寸放到本曲轮主轴的半間格上（四舍五入吸附：中心偏 ≤0.7 m、尺寸偏 ≤0.25 間）；
  //       ② 按 fit.prio 顺序占格，后放的与先放的重叠部分扣掉（L 形 = 外包矩形 − 已占，按最大矩形拆块，短边 < minPiece 的碎块丢弃）；
  //       ③ 拓扑 fit.links：两殿相接（公共边 ≥1 間）= 直接开襖；不相接 = 廊下（宽 2–5 格 = 1–2.5 間，直线优先，不行就 L 形），廊下不压别的殿舍；
  //       ④ 房间分割/畳/襖/床 仍是规则 + 种子（绘图上畳数读不出）→ 房间标“推定”，殿舍占地标“史料拟合”。
  const gotenFitData = () => { const D = G.CASTLE_DATA; return D && D.gotenFit && D.gotenFit.elements && D.gotenFit.elements.length ? D.gotenFit : null; };
  function fitRectOf(e, FG) { // mrr → 半間格矩形（FG 格坐标）+ 世界轴向尺寸
    const vert = Math.abs(Math.cos(e.ax * Math.PI / 180)) < 0.5, wx = vert ? e.d : e.w, wy = vert ? e.w : e.d, [u, v] = FG.fr0.l(e.cx, e.cy);
    const nu = Math.max(2, Math.round(wx / CS)), nv = Math.max(2, Math.round(wy / CS)), i0 = Math.round((u - FG.u0) / CS - nu / 2), j0 = Math.round((v - FG.v0) / CS - nv / 2);
    return { r: [i0, j0, i0 + nu, j0 + nv], wx, wy };
  }
  function gotenFitted(S, W, g, FD) {
    const GS = SPEC.goten, GF = GS.fit, ang = axisOf(S, g), FG = freeGrid(S, g, ang), key = 'goten@' + g.name, R = node => rng(nodeSeed(W, key, node));
    const nuG = FG.nu, nvG = FG.nv, occ = new Int16Array(nuG * nvG), inG = (i, j) => i >= 0 && j >= 0 && i < nuG && j < nvG;
    const els = FD.elements.filter(e => e.use === 'hall' || e.use === 'corridor'), pr = n => { const k = GF.prio.indexOf(n); return k < 0 ? 999 : k; };
    els.sort((a, c) => pr(a.name) - pr(c.name));
    const blocks = [], fitEl = [];
    const mark = (r, id) => { for (let j = r[1]; j < r[3]; j++) for (let i = r[0]; i < r[2]; i++) if (inG(i, j)) occ[j * nuG + i] = id; };
    const isFree = r => { for (let j = r[1]; j < r[3]; j++) for (let i = r[0]; i < r[2]; i++) if (!inG(i, j) || occ[j * nuG + i]) return false; return true; };
    for (const e of els) {
      const f = fitRectOf(e, FG), r = f.r, w = r[2] - r[0], h = r[3] - r[1], m = new Uint8Array(w * h);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const I = r[0] + i, J = r[1] + j; m[j * w + i] = inG(I, J) && !occ[J * nuG + I] ? 1 : 0; }
      const minP = e.use === 'corridor' ? 2 : GF.minPiece, pcs = rects(m, w, h, x => x === 1).filter(p => Math.min(p[2] - p[0], p[3] - p[1]) >= minP).map(p => [p[0] + r[0], p[1] + r[1], p[2] + r[0], p[3] + r[1]]);
      if (!pcs.length) { W.notes.push(key + ': ' + e.name + ' 拟合占地被先放的殿舍占满'); continue; }
      const ids = []; for (const p of pcs) { blocks.push({ name: e.name, r: p, kind: e.use === 'corridor' ? 'rouka' : 'hall', fit: e.name }); ids.push(blocks.length - 1); mark(p, blocks.length); }
      fitEl.push({ name: e.name, use: e.use, conf: e.conf, cx: e.cx, cy: e.cy, wx: f.wx, wy: f.wy, snap: r, blocks: ids, trimmed: pcs.length !== 1 || pcs[0].some((v, k) => v !== r[k]) });
    }
    // 廊下
    const nBefore = blocks.length, touchLen = (a, c) => { if (a[2] === c[0] || c[2] === a[0]) return Math.max(0, Math.min(a[3], c[3]) - Math.max(a[1], c[1])); if (a[3] === c[1] || c[3] === a[1]) return Math.max(0, Math.min(a[2], c[2]) - Math.max(a[0], c[0])); return 0; };
    const touchesOther = (r, skip) => { let n = 0; for (let k = 0; k < blocks.length; k++) if (!skip.has(k) && touchLen(r, blocks[k].r) > 0) n++; return n; };
    const CW = GF.corridor, links = [];
    const tryLink = (A, B) => {
      const ia = blocks.map((k, x) => k.name === A ? x : -1).filter(x => x >= 0 && x < nBefore), ib = blocks.map((k, x) => k.name === B ? x : -1).filter(x => x >= 0 && x < nBefore);
      if (!ia.length || !ib.length) { links.push([A, B, 'missing']); return 'missing'; }
      for (const x of ia) for (const y of ib) if (touchLen(blocks[x].r, blocks[y].r) >= 2) { links.push([A, B, 'touch']); return 'touch'; }
      let best = null; const skip = new Set(ia.concat(ib));
      const consider = (rs, len, off) => { if (!rs.every(isFree)) return; const t = rs.reduce((s, q) => s + touchesOther(q, skip), 0), sc = len * 10 + off + t * 60 + (rs.length - 1) * 25; if (!best || sc < best.sc) best = { sc, rs }; };
      for (const x of ia) for (const y of ib) { const a = blocks[x].r, c = blocks[y].r;
        for (let w = CW.def; w >= CW.w[0]; w--) {
          // 直线：沿 u（两殿 v 向重叠 ≥ w）/ 沿 v
          for (const ax of [0, 1]) { const lo = ax ? 1 : 0, hi = ax ? 3 : 2, plo = ax ? 0 : 1, phi = ax ? 2 : 3, o0 = Math.max(a[plo], c[plo]), o1 = Math.min(a[phi], c[phi]);
            if (o1 - o0 < w) continue; const g0 = a[hi] <= c[lo] ? a[hi] : c[hi] <= a[lo] ? c[hi] : null, g1 = a[hi] <= c[lo] ? c[lo] : a[lo]; if (g0 === null || g1 - g0 < 1) continue;
            for (let s = o0; s + w <= o1; s++) { const r = ax ? [s, g0, s + w, g1] : [g0, s, g1, s + w]; consider([r], g1 - g0, Math.abs(s + w / 2 - (o0 + o1) / 2)); } }
          // L 形：先离开 a（ax 方向），再横向进 c
          for (const ax of [0, 1]) { const sgn = ax ? Math.sign((c[1] + c[3]) - (a[1] + a[3])) : Math.sign((c[0] + c[2]) - (a[0] + a[2])), sgl = ax ? Math.sign((c[0] + c[2]) - (a[0] + a[2])) : Math.sign((c[1] + c[3]) - (a[1] + a[3])); if (!sgn || !sgl) continue;
            const pl = ax ? [a[0], a[2]] : [a[1], a[3]], ql = ax ? [c[1], c[3]] : [c[0], c[2]];
            for (let x0 = pl[0]; x0 + w <= pl[1]; x0++) { if (ax ? !(sgl > 0 ? x0 + w <= c[0] : x0 >= c[2]) : !(sgl > 0 ? x0 + w <= c[1] : x0 >= c[3])) continue;
              for (let y0 = ql[0]; y0 + w <= ql[1]; y0++) { const face = ax ? (sgn > 0 ? a[3] : a[1]) : (sgn > 0 ? a[2] : a[0]); if (sgn > 0 ? y0 < face + 1 : y0 + w > face - 1) continue;
                let s1, s2; if (ax) { s1 = sgn > 0 ? [x0, a[3], x0 + w, y0 + w] : [x0, y0, x0 + w, a[1]]; s2 = sgl > 0 ? [x0 + w, y0, c[0], y0 + w] : [c[2], y0, x0, y0 + w]; } else { s1 = sgn > 0 ? [a[2], x0, y0 + w, x0 + w] : [y0, x0, a[0], x0 + w]; s2 = sgl > 0 ? [y0, x0 + w, y0 + w, c[1]] : [y0, c[3], y0 + w, x0]; }
                if (s1[2] <= s1[0] || s1[3] <= s1[1] || s2[2] <= s2[0] || s2[3] <= s2[1]) continue; consider([s1, s2], (s1[2] - s1[0]) + (s1[3] - s1[1]) + (s2[2] - s2[0]) + (s2[3] - s2[1]) - 2 * w, 0); } } }
          if (best) break; } }
      if (!best) { W.notes.push(key + ': ' + A + '—' + B + ' 廊下放不下'); links.push([A, B, 'none']); return 'none'; }
      const cw0 = Math.max(...best.rs.map(r => Math.min(r[2] - r[0], r[3] - r[1]))); // L 形两段同宽同高（屋顶同高同坡 = 谷）
      best.rs.forEach((r, si) => { blocks.push({ name: '廊下', r, kind: 'rouka', link: [A, B], cw: best.rs.length > 1 ? cw0 : undefined, seg: si }); mark(r, blocks.length); });
      links.push([A, B, best.rs.length === 1 ? 'corridor' : 'corridorL']); return 'corridor';
    };
    for (const [A, B] of GF.links) tryLink(A, B);
    let nr = 0; for (const k of blocks) if (k.kind === 'rouka' && !k.fit) k.name = '廊下' + (++nr);
    // 组装成一个建筑（同一网格）
    let i0 = 1e9, j0 = 1e9, i1 = -1e9, j1 = -1e9; for (const k of blocks) { i0 = Math.min(i0, k.r[0]); j0 = Math.min(j0, k.r[1]); i1 = Math.max(i1, k.r[2]); j1 = Math.max(j1, k.r[3]); }
    const [ox, oy] = FG.x(i0, j0), b = mkB({ fgOff: [i0, j0], key, type: 'goten', name: '本丸御殿', tier: 'est', region: g.i, x: ox, y: oy, ang, u0: 0, v0: 0, nu: i1 - i0, nv: j1 - j0, dir: [0, 1], fit: true });
    for (const k of blocks) k.r = [k.r[0] - i0, k.r[1] - j0, k.r[2] - i0, k.r[3] - j0];
    b.blocks = blocks; b.fitEl = fitEl; b.links = links;
    b.prov = { tier: '史料拟合', src: 'goten-fit', note: '殿舍占地（位置/尺寸/轴向）= ' + FD.src + '（NDL ' + FD.pid + '，' + FD.license + '）数字化拟合，吸附半間格；配准残差 TPS 留一 RMS ' + FD.residual.tps_loo_rms + ' m（绝对位置约 ±5 m）；殿舍间廊下 = 拓扑规则；房间分割/畳/襖/床 = 规则 + 种子（推定，畳数读不出）', fitTol: FD.tol };
    const fl = GS.floor[0] + (GS.floor[1] - GS.floor[0]) * R('floor')();
    const zg = groundMax(S, b, blocks.map(k => k.r)); b.zg = zg;
    const hw = GS.wallH[0] + (GS.wallH[1] - GS.wallH[0]) * R('height')();
    const F = floorNew(b, zg.max + fl, hw); F.bk = new Int16Array(b.nu * b.nv).fill(-1);
    blocks.forEach((k, bi) => { if (k.kind === 'hall') { k.h = hw; k.pitch = GS.pitch; } else { const half = (k.cw || Math.min(k.r[2] - k.r[0], k.r[3] - k.r[1])) * CS / 2 + 0.8, room = 0.35 + 0.1 + 0.25; k.h = Math.max(SPEC.door.h + 0.5, hw - (half * 0.45 + room)); k.pitch = Math.min(0.45, (hw - room - k.h) / half); } for (let j = k.r[1]; j < k.r[3]; j++) for (let i = k.r[0]; i < k.r[2]; i++) { F.a[j * b.nu + i] = k.kind === 'rouka' ? A.ROUKA : A.ROOM; F.bk[j * b.nu + i] = bi; } });
    // ゾーン：短边 ≥ ringMin 格 = 四周入側（1 間）；较窄的殿 = 一侧入側（朝建筑中心的长边）；再窄 = 不设入側
    const rr = R('rooms'), cx0 = b.nu / 2, cy0 = b.nv / 2, used = {};
    blocks.forEach((k, bi) => { if (k.kind !== 'hall') return; let [a0, b0, a1, b1] = k.r; const W0 = a1 - a0, H0 = b1 - b0, mn = Math.min(W0, H0);
      let m0 = a0, m1 = a1, n0 = b0, n1 = b1;
      if (mn >= GF.ringMin) { m0 += 2; m1 -= 2; n0 += 2; n1 -= 2; for (let j = b0; j < b1; j++) for (let i = a0; i < a1; i++) if (i < m0 || i >= m1 || j < n0 || j >= n1) F.a[j * b.nu + i] = A.IRI; }
      else if (mn >= GF.stripMin) { const longU = W0 >= H0; if (longU) { if ((b0 + b1) / 2 > cy0) n0 += 2; else n1 -= 2; } else { if ((a0 + a1) / 2 > cx0) m0 += 2; else m1 -= 2; }
        for (let j = b0; j < b1; j++) for (let i = a0; i < a1; i++) if (i < m0 || i >= m1 || j < n0 || j >= n1) F.a[j * b.nu + i] = A.IRI; }
      const longU = (m1 - m0) >= (n1 - n0), L = longU ? m1 - m0 : n1 - n0, Dp = longU ? n1 - n0 : m1 - m0;
      const rows = Dp >= 10 ? 2 : 1, cuts = [0]; while (cuts[cuts.length - 1] < L) { const rem = L - cuts[cuts.length - 1]; let w = 2 * (2 + Math.floor(rr() * 3)); if (rem - w < 4) w = rem; cuts.push(cuts[cuts.length - 1] + w); }
      const kit = GF.kitchen.includes(k.name), jo = GF.jodan.includes(k.name), names = kit ? ['土間', '板間', '囲炉裏の間', '御膳所', '御膳立所', '詰所'] : jo ? ['上段之間', '下段之間', '二之間', '三之間', '四之間', '納戸'] : ['一之間', '二之間', '三之間', '四之間', '五之間', '六之間'];
      let ri = used[k.name] || 0; const first = !used[k.name];
      for (let row = 0; row < rows; row++) for (let c = 0; c + 1 < cuts.length; c++) {
        const cc = cuts.length - 2 - c, s0 = cuts[cc], s1 = cuts[cc + 1], d0 = Math.round(Dp * row / rows), d1 = Math.round(Dp * (row + 1) / rows);
        const rect = longU ? [m0 + s0, n0 + d0, m0 + s1, n0 + d1] : [m0 + d0, n0 + s0, m0 + d1, n0 + s1];
        const id = b.rooms.length, nm = (row ? '次' : '') + (names[ri] || ('之間' + ri)); ri++;
        const doma = kit && k.name === GF.kitchen[0] && first && row === 0 && c === 0;
        b.rooms.push({ id, name: k.name + '·' + nm, block: bi, rect, kind: doma ? 'doma' : 'tatami', f: 0, jodan: jo && first && row === 0 && c === 0, est: true });
        for (let j = rect[1]; j < rect[3]; j++) for (let i = rect[0]; i < rect[2]; i++) { F.r[j * b.nu + i] = id; if (doma) F.a[j * b.nu + i] = A.DOMA; } }
      used[k.name] = ri;
      if (m0 !== a0 || m1 !== a1 || n0 !== b0 || n1 !== b1) { const irid = b.rooms.length; b.rooms.push({ id: irid, name: k.name + '·入側', block: bi, rect: k.r, kind: 'iri', f: 0 }); for (let j = b0; j < b1; j++) for (let i = a0; i < a1; i++) if (F.a[j * b.nu + i] === A.IRI) F.r[j * b.nu + i] = irid; }
    });
    // 廊下房间：L 形第二段并入第一段（同一房间，无隔断）；只有 1 格长的渡り（两殿相距半間）并入 A 殿相邻的房间
    blocks.forEach((k, bi) => { if (k.kind !== 'rouka') return; let id = -1;
      if (k.seg === 1) id = F.r[blocks[bi - 1].r[1] * b.nu + blocks[bi - 1].r[0]];
      else if (!k.fit && k.seg === 0 && Math.min(k.r[2] - k.r[0], k.r[3] - k.r[1]) < 2 && !(blocks[bi + 1] && blocks[bi + 1].seg === 1)) { const [a0, b0, a1, b1] = k.r; for (let j = b0 - 1; j <= b1 && id < 0; j++) for (let i = a0 - 1; i <= a1 && id < 0; i++) { if ((i >= a0 && i < a1 && j >= b0 && j < b1) || ((i < a0 || i >= a1) && (j < b0 || j >= b1))) continue; if (i < 0 || j < 0 || i >= b.nu || j >= b.nv) continue; const q = j * b.nu + i; if (F.bk[q] >= 0 && blocks[F.bk[q]].kind === 'hall' && F.r[q] >= 0 && WALKABLE(F.a[q])) id = F.r[q]; } }
      if (id < 0) { id = b.rooms.length; b.rooms.push({ id, name: k.name, block: bi, rect: k.r, kind: 'rouka', f: 0 }); }
      for (let j = k.r[1]; j < k.r[3]; j++) for (let i = k.r[0]; i < k.r[2]; i++) F.r[j * b.nu + i] = id; });
    partitionOpenings(b, 0, rr);
    // 外门：玄関 朝南（−v，朝桜門）；台所（御下台所）朝外（东/南/北 依次试）
    const gate = S.gates.filter(G2 => G2.region === g).sort((a, c) => (c.spec.masugata ? 1 : 0) - (a.spec.masugata ? 1 : 0))[0];
    const ent = blocks.find(k => k.name === GF.entry) || blocks[0];
    let dEnt = addDoor(b, 0, ent.r, 3, 'door', rr); if (!dEnt && gate) { const [ga, gb] = FG.fr0.l(gate.x, gate.y); dEnt = addDoor(b, 0, ent.r, sideToward(b, ent.r, (ga - FG.u0) / CS - i0, (gb - FG.v0) / CS - j0), 'door', rr); }
    const kit = blocks.find(k => k.name === GF.kitchen[0]); if (kit) for (const sd of [0, 3, 2, 1]) if (addDoor(b, 0, kit.r, sd, 'door', rr)) break;
    exteriorWindows(b, 0, rr, 'akari', 0.85, { wt: 'akari', near: 2 }); // 窓外 1 間内是别的殿舍墙：不开（看不出去）
    keepClear(b, 0); for (const r of b.rooms) if (r.jodan) addToko(b, 0, r);
    // 屋顶：殿 = 入母屋，出檐按侧：离不相接的邻殿近时收短（两殿檐口不相撞：ov ≤ 间距/2 − 0.15 m；相接的殿 = 谷，保持全出檐）
    const hallR = blocks.filter(k => k.kind === 'hall').map(k => k.r);
    for (const k of blocks) { if (k.kind !== 'hall') { b.roofs.push({ f: 0, r: k.r, h: k.h, kind: 'kirizuma', ov: 0.8, oe: 0, pitch: k.pitch, top: true }); continue; }
      const ovs = [GS.ov, GS.ov, GS.ov, GS.ov], r = k.r;
      for (const o of hallR) { if (o === r) continue; const ovU = Math.min(r[3], o[3]) - Math.max(r[1], o[1]), ovV = Math.min(r[2], o[2]) - Math.max(r[0], o[0]), reach = Math.ceil(2 * GS.ov / CS) + 1;
        const lim = gp => Math.max(0.3, gp * CS / 2 - 0.15);
        if (ovU > -reach) { if (o[0] >= r[2] && o[0] - r[2] > 0 && o[0] - r[2] <= reach) ovs[1] = Math.min(ovs[1], lim(o[0] - r[2])); if (o[2] <= r[0] && r[0] - o[2] > 0 && r[0] - o[2] <= reach) ovs[0] = Math.min(ovs[0], lim(r[0] - o[2])); }
        if (ovV > -reach) { if (o[1] >= r[3] && o[1] - r[3] > 0 && o[1] - r[3] <= reach) ovs[3] = Math.min(ovs[3], lim(o[1] - r[3])); if (o[3] <= r[1] && r[1] - o[3] > 0 && r[1] - o[3] <= reach) ovs[2] = Math.min(ovs[2], lim(r[1] - o[3])); } }
      b.roofs.push(Object.assign({ f: 0, r: k.r, h: k.h, kind: 'irimoya', ov: GS.ov, pitch: k.pitch, top: true }, ovs.some(x => x !== GS.ov) ? { ovs } : {})); }
    W.free[g.name] = FG; return b;
  }
  // ---------------- 类型：本丸御殿（書院造：大広間/書院 + 入側 + 廊下 + 中庭）----------------
  function goten(S, W, g) {
    { const FD = gotenFitData(); if (FD && SPEC.goten.fit.on) return gotenFitted(S, W, g, FD); }
    const GS = SPEC.goten, ang = axisOf(S, g), FG = freeGrid(S, g, ang), key = 'goten@' + g.name;
    const R = node => rng(nodeSeed(W, key, node));
    // 置き場：入口锚点 = 本曲轮主门（桜門系：有枡形里门的门）里侧道路终点附近的自由格；方向 = 指向天守（“奥”）
    const gate = S.gates.filter(G => G.region === g).sort((a, b) => (b.spec.masugata ? 1 : 0) - (a.spec.masugata ? 1 : 0))[0], ten = S.parts.find(p => p.fam === 'tenshu');
    if (!gate) { W.notes.push(key + ': 无门'); return null; }
    const inner = S.parts.find(p => p.masugataOf === gate) || gate, [ga, gb] = FG.fr0.l(inner.x, inner.y), [ta, tb] = ten ? FG.fr0.l(ten.x, ten.y) : [ga, gb + 100];
    const dirU = Math.abs(ta - ga) > Math.abs(tb - gb) ? Math.sign(ta - ga) : 0, dirV = dirU ? 0 : Math.sign(tb - gb); // 主方向（沿主轴的 ±u 或 ±v）
    const sideSign = rng(nodeSeed(W, key, 'bend'))() < 0.5 ? 1 : -1, DIRS = [[dirU, dirV], dirU ? [0, sideSign] : [sideSign, 0], dirU ? [0, -sideSign] : [-sideSign, 0]];
    const occ = new Uint8Array(FG.nu * FG.nv), mark = (r, m) => { for (let j = Math.max(0, r[1] - m); j < Math.min(FG.nv, r[3] + m); j++) for (let i = Math.max(0, r[0] - m); i < Math.min(FG.nu, r[2] + m); i++) occ[j * FG.nu + i] = 1; };
    let OP = null; const opRebuild = () => { const nu = FG.nu, nv = FG.nv; OP = new Int32Array((nu + 1) * (nv + 1)); for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) OP[(j + 1) * (nu + 1) + i + 1] = occ[j * nu + i] + OP[j * (nu + 1) + i + 1] + OP[(j + 1) * (nu + 1) + i] - OP[j * (nu + 1) + i]; };
    const occAny = (i0, j0, i1, j1) => { const nu = FG.nu; i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(FG.nu, i1); j1 = Math.min(FG.nv, j1); if (i1 <= i0 || j1 <= j0) return false; return OP[j1 * (nu + 1) + i1] - OP[j0 * (nu + 1) + i1] - OP[j1 * (nu + 1) + i0] + OP[j0 * (nu + 1) + i0] > 0; };
    const clearR = r => FG.free(r[0], r[1], r[2], r[3]) && !occAny(r[0], r[1], r[2], r[3]); opRebuild();
    const r0 = R('shape'), placed = [], corr = [], gap = GS.gap * 2, cw = GS.corridor;
    const hallSize = (h, k) => { const w = Math.round(h.w[0] + (h.w[1] - h.w[0]) * r0()) * 2, d = Math.round(h.d[0] + (h.d[1] - h.d[0]) * r0()) * 2; return dirU ? [d, w] : [w, d]; }; // 宽沿横向
    const gi = Math.round((ga - FG.u0) / CS), gj = Math.round((gb - FG.v0) / CS);
    const rp = R('place');
    for (let k = 0; k < GS.halls.length; k++) {
      const h = GS.halls[k]; let [w, d] = hallSize(h, k), best = null;
      for (let shrink = 0; shrink < 4 && !best; shrink++) {
        const ww = Math.max(8, w - shrink * 2 * (dirU ? 0 : 1)), dd = Math.max(8, d - shrink * 2 * (dirU ? 1 : 0)), prev = placed[placed.length - 1];
        const win = prev ? [prev.r[0] - ww - gap - 8, prev.r[1] - dd - gap - 8, prev.r[2] + gap + 8, prev.r[3] + gap + 8] : [0, 0, FG.nu, FG.nv];
        for (let j = Math.max(0, win[1]); j + dd <= Math.min(FG.nv, win[3] + dd); j++) for (let i = Math.max(0, win[0]); i + ww <= Math.min(FG.nu, win[2] + ww); i++) {
          const r = [i, j, i + ww, j + dd]; if (!clearR(r)) continue;
          let sc;
          if (!prev) { const cx = i + ww / 2, cy = j + dd / 2; sc = Math.hypot(cx - gi, cy - gj); } // 遠侍：离入口最近
          else { // 雁行：沿主方向接在前一栋后面（中间隔 gap 的中庭带），横向错开但重叠 ≥ 廊下宽 + 2
            // 方向：先沿主方向（往“奥”），走不通再转 90°（链拐弯）——每个方向一个代价档
            const p = prev.r; sc = 1e9;
            for (let t = 0; t < DIRS.length; t++) { const [du, dv] = DIRS[t], ov = du ? Math.min(p[3], r[3]) - Math.max(p[1], r[1]) : Math.min(p[2], r[2]) - Math.max(p[0], r[0]);
              if (ov < cw + 2) continue;
              const g0 = du > 0 ? r[0] - p[2] : du < 0 ? p[0] - r[2] : dv > 0 ? r[1] - p[3] : p[1] - r[3];
              if (g0 < gap || g0 > gap + 6) continue;
              const lat = du ? (r[1] + r[3] - p[1] - p[3]) / 2 : (r[0] + r[2] - p[0] - p[2]) / 2, want = sideSign * (t ? 0 : 1) * (0.35 + 0.3 * rp()) * (du ? (p[3] - p[1]) : (p[2] - p[0])); // 雁行：沿一侧逐栋错开（台阶状）
              const c = t * 1000 + (g0 - gap) * 2 + Math.abs(lat - want); if (c < sc) { sc = c; r.dir = [du, dv]; } }
            if (sc >= 1e9) continue;
          }
          sc += rp() * 0.5;
          if (!best || sc < best.sc) best = { r: r.slice(), sc }, best.r.dir = r.dir;
        }
      }
      if (!best) { W.notes.push(key + ': ' + h.name + ' 放不下（自由面积不够）'); continue; }
      const prev = placed[placed.length - 1]; placed.push({ name: h.name, r: best.r }); mark(best.r, gap);
      if (prev) { // 廊下：两栋相对的墙之间，横向在重叠区中央，宽 cw 格
        const p = prev.r, r = best.r, [du, dv] = r.dir; let c;
        if (du) { const a = Math.max(p[1], r[1]), bnd = Math.min(p[3], r[3]), m = Math.floor((a + bnd - cw) / 2); c = du > 0 ? [p[2], m, r[0], m + cw] : [r[2], m, p[0], m + cw]; }
        else { const a = Math.max(p[0], r[0]), bnd = Math.min(p[2], r[2]), m = Math.floor((a + bnd - cw) / 2); c = dv > 0 ? [m, p[3], m + cw, r[1]] : [m, r[3], m + cw, p[1]]; }
        corr.push(c); mark(c, 2);
      }
      opRebuild();
    }
    if (!placed.length) return null;
    // 台所：接在遠侍的侧面（与主方向垂直的一侧），廊下相连
    { const h = GS.side, e = placed[0].r; let [w, d] = hallSize(h, 9); const opts = [];
      for (const sd of [-1, 1]) { const r = dirU ? (sd > 0 ? [e[0], e[3] + gap, e[0] + w, e[3] + gap + d] : [e[0], e[1] - gap - d, e[0] + w, e[1] - gap]) : (sd > 0 ? [e[2] + gap, e[1], e[2] + gap + w, e[1] + d] : [e[0] - gap - w, e[1], e[0] - gap, e[1] + d]); opts.push(r); }
      opRebuild(); const pick = opts.find(clearR); if (pick) { const r = pick, m = dirU ? Math.floor((Math.max(e[0], r[0]) + Math.min(e[2], r[2]) - cw) / 2) : Math.floor((Math.max(e[1], r[1]) + Math.min(e[3], r[3]) - cw) / 2);
        const c = dirU ? (r[1] > e[1] ? [m, e[3], m + cw, r[1]] : [m, r[3], m + cw, e[1]]) : (r[0] > e[0] ? [e[2], m, r[0], m + cw] : [r[2], m, e[0], m + cw]); placed.push({ name: h.name, r, side: true }); corr.push(c); mark(r, gap); mark(c, 2); } else W.notes.push(key + ': ' + h.name + ' 放不下'); }
    // 组装成一个建筑（同一网格）
    let i0 = 1e9, j0 = 1e9, i1 = -1e9, j1 = -1e9; for (const r of placed.map(p => p.r).concat(corr)) { i0 = Math.min(i0, r[0]); j0 = Math.min(j0, r[1]); i1 = Math.max(i1, r[2]); j1 = Math.max(j1, r[3]); }
    const [ox, oy] = FG.x(i0, j0), b = mkB({ fgOff: [i0, j0], key, type: 'goten', name: '本丸御殿', tier: 'est', region: g.i, x: ox, y: oy, ang, u0: 0, v0: 0, nu: i1 - i0, nv: j1 - j0, dir: [dirU, dirV] });
    const sh = r => [r[0] - i0, r[1] - j0, r[2] - i0, r[3] - j0];
    // 地板：台地面最高点 + 床高（推定 0.6–0.9 m）
    const fl = GS.floor[0] + (GS.floor[1] - GS.floor[0]) * R('floor')(); const blocks = placed.map(p => ({ name: p.name, r: sh(p.r), kind: 'hall' })).concat(corr.map((c, k) => ({ name: '廊下' + (k + 1), r: sh(c), kind: 'rouka' })));
    b.blocks = blocks; b.prov = { tier: '推定', src: 'goten', note: '殿舍名 = 徳川期本丸御殿史料；位置/尺寸 = 规则 + 种子（范围见 SPEC.goten）' };
    const zg = groundMax(S, b, blocks.map(k => k.r)); b.zg = zg;
    const hw = GS.wallH[0] + (GS.wallH[1] - GS.wallH[0]) * R('height')();
    const F = floorNew(b, zg.max + fl, hw);
    F.bk = new Int16Array(b.nu * b.nv).fill(-1);
    blocks.forEach((k, bi) => { if (k.kind === 'hall') { k.h = hw; k.pitch = GS.pitch; } else { const half = (k.cw || Math.min(k.r[2] - k.r[0], k.r[3] - k.r[1])) * CS / 2 + 0.8, room = 0.35 + 0.1 + 0.25; k.h = Math.max(SPEC.door.h + 0.5, hw - (half * 0.45 + room)); k.pitch = Math.min(0.45, (hw - room - k.h) / half); } /* 廊下屋脊（含脊瓦 0.35）收在殿舍檐口下 ≥0.25 m：墙高不够时减小坡度 */ for (let j = k.r[1]; j < k.r[3]; j++) for (let i = k.r[0]; i < k.r[2]; i++) { F.a[j * b.nu + i] = k.kind === 'rouka' ? A.ROUKA : A.ROOM; F.bk[j * b.nu + i] = bi; } });
    // ゾーン：每栋殿舍 = 入側（外圈 2 格 = 1 間）+ 身舎（房间）
    const rr = R('rooms');
    blocks.forEach((k, bi) => { if (k.kind !== 'hall') return; const [a0, b0, a1, b1] = k.r;
      for (let j = b0; j < b1; j++) for (let i = a0; i < a1; i++) if (i < a0 + 2 || i >= a1 - 2 || j < b0 + 2 || j >= b1 - 2) F.a[j * b.nu + i] = A.IRI;
      // 身舎分间：沿长边切成 2–4 格宽一间（每间 2–4 間），深 ≥8 格时分前后两列；离入口最远的一间 = 上段
      const m0 = a0 + 2, m1 = a1 - 2, n0 = b0 + 2, n1 = b1 - 2, longU = (m1 - m0) >= (n1 - n0), L = longU ? m1 - m0 : n1 - n0, Dp = longU ? n1 - n0 : m1 - m0;
      const rows = Dp >= 10 ? 2 : 1, cuts = [0]; while (cuts[cuts.length - 1] < L) { const rem = L - cuts[cuts.length - 1]; let w = 2 * (2 + Math.floor(rr() * 3)); if (rem - w < 4) w = rem; cuts.push(cuts[cuts.length - 1] + w); }
      const names = k.name === GS.side.name ? ['土間', '板間', '囲炉裏の間', '御膳所'] : ['上段之間', '下段之間', '二之間', '三之間', '四之間', '納戸'];
      let ri = 0; const far = (dirU || dirV) ? (longU ? (dirU >= 0 ? 1 : -1) : (dirV >= 0 ? 1 : -1)) : 1;
      for (let row = 0; row < rows; row++) for (let c = 0; c + 1 < cuts.length; c++) {
        const cc = far > 0 ? cuts.length - 2 - c : c, s0 = cuts[cc], s1 = cuts[cc + 1], d0 = Math.round(Dp * row / rows), d1 = Math.round(Dp * (row + 1) / rows);
        const rect = longU ? [m0 + s0, n0 + d0, m0 + s1, n0 + d1] : [m0 + d0, n0 + s0, m0 + d1, n0 + s1];
        const id = b.rooms.length, nm = (row ? '次' : '') + (names[ri] || ('之間' + ri)); ri++;
        const doma = k.name === GS.side.name && row === 0 && c === 0;
        b.rooms.push({ id, name: k.name + '·' + nm, block: bi, rect, kind: doma ? 'doma' : 'tatami', f: 0, jodan: k.name !== GS.side.name && row === 0 && c === 0 });
        for (let j = rect[1]; j < rect[3]; j++) for (let i = rect[0]; i < rect[2]; i++) { F.r[j * b.nu + i] = id; if (doma) F.a[j * b.nu + i] = A.DOMA; }
      }
      const irid = b.rooms.length; b.rooms.push({ id: irid, name: k.name + '·入側', block: bi, rect: k.r, kind: 'iri', f: 0 }); for (let j = b0; j < b1; j++) for (let i = a0; i < a1; i++) if (F.a[j * b.nu + i] === A.IRI) F.r[j * b.nu + i] = irid;
    });
    blocks.forEach((k, bi) => { if (k.kind !== 'rouka') return; const id = b.rooms.length; b.rooms.push({ id, name: k.name, block: bi, rect: k.r, kind: 'rouka', f: 0 }); for (let j = k.r[1]; j < k.r[3]; j++) for (let i = k.r[0]; i < k.r[2]; i++) F.r[j * b.nu + i] = id; });
    // 开口：房间 ↔ 入側：每间朝入側一侧开 2 格襖（离角 ≥1 格）；相邻房间之间开 2 格襖；廊下两端接殿舍入側（开口 = 廊下全宽减两侧各 0.5 格 → 取廊下宽 −1 格）
    partitionOpenings(b, 0, rr);
    // 外门：遠侍（玄関）朝入口一侧开 1 樘门（2 格），台所朝外开 1 樘；外墙其余 = 障子/窓（每間一扇，种子取舍）
    const ent = blocks[0].r, side = sideToward(b, ent, gi - i0, gj - j0); addDoor(b, 0, ent, side, 'door', rr); const kit = blocks.find(k => k.name === GS.side.name); if (kit) addDoor(b, 0, kit.r, oppositeSide(b, kit.r, ent), 'door', rr);
    exteriorWindows(b, 0, rr, 'akari', 0.85, { wt: 'akari' }); // 明かり障子（引違い，半开）
    // 装置：上段之間的床（床の間，1 間 × 半間，靠最远的墙），不压保留通行格
    keepClear(b, 0); for (const r of b.rooms) if (r.jodan) addToko(b, 0, r);
    // 屋顶：每栋殿舍 入母屋（ov 1.6 m），廊下 切妻（屋脊低于殿舍檐口）
    for (const k of blocks) b.roofs.push({ f: 0, r: k.r, h: k.h, kind: k.kind === 'hall' ? 'irimoya' : 'kirizuma', ov: k.kind === 'hall' ? GS.ov : 0.8, oe: k.kind === 'hall' ? undefined : 0, pitch: k.pitch, top: true });
    W.free[g.name] = FG; return b;
  }
  function groundMax(S, b, rs) { let mx = -1e9, mn = 1e9; for (const r of rs) for (let j = r[1]; j <= r[3]; j++) for (let i = r[0]; i <= r[2]; i++) { const [x, y] = b.fr.w(U(b, i), V(b, j)), z = S.heightAt(x, y); if (z > mx) mx = z; if (z < mn) mn = z; } return { max: mx, min: mn }; }
  function sideToward(b, r, ti, tj) { const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, dx = ti - cx, dy = tj - cy; return Math.abs(dx) / (r[2] - r[0]) > Math.abs(dy) / (r[3] - r[1]) ? (dx > 0 ? 0 : 1) : (dy > 0 ? 2 : 3); }
  function oppositeSide(b, r, e) { const s = sideToward(b, r, (e[0] + e[2]) / 2, (e[1] + e[3]) / 2); return s ^ 1; }
  // 在矩形 r 的 side 边上找一段 n 格、两侧都是 inside/outside 正确的边，开门
  function addDoor(b, f, r, side, kind, rr, n) {
    n = n || SPEC.door.w; const F = b.F[f], cand = [];
    const along = side < 2 ? [r[1], r[3]] : [r[0], r[2]];
    for (let s = along[0] + 1; s + n <= along[1] - 1; s++) { let ok = true; for (let k = 0; k < n; k++) { const i = side === 0 ? r[2] - 1 : side === 1 ? r[0] : s + k, j = side === 2 ? r[3] - 1 : side === 3 ? r[1] : s + k; const [di, dj] = NB[side]; if (!WALKABLE(at(b, F, i, j)) || at(b, F, i + di, j + dj) !== A.OUT) { ok = false; break; } } if (ok) cand.push(s); }
    if (!cand.length) { b.notes.push('门放不下 side ' + side); return null; }
    const mid = (along[0] + along[1] - n) / 2; cand.sort((a, c) => Math.abs(a - mid) - Math.abs(c - mid)); const s = cand[Math.min(cand.length - 1, Math.floor(rr() * Math.min(3, cand.length)))];
    const i = side === 0 ? r[2] - 1 : side === 1 ? r[0] : s, j = side === 2 ? r[3] - 1 : side === 3 ? r[1] : s, o = { f, i, j, side, kind, n }; b.open.push(o); return o;
  }
  // 房间之间 / 房间与入側之间的隔断开口（襖）；yagura 用板戸
  function partitionOpenings(b, f, rr, kind) {
    const F = b.F[f], nu = b.nu, seen = new Set();
    // 收集每对相邻房间的公共边段
    const pairs = new Map();
    for (let j = 0; j < b.nv; j++) for (let i = 0; i < nu; i++) { const q = j * nu + i, ra = F.r[q]; if (ra < 0 || !WALKABLE(F.a[q]) || F.a[q] === A.STAIR) continue; for (const side of [0, 2]) { const [di, dj] = NB[side], i2 = i + di, j2 = j + dj; if (i2 >= nu || j2 >= b.nv) continue; const q2 = j2 * nu + i2, rb = F.r[q2]; if (rb < 0 || rb === ra || !WALKABLE(F.a[q2]) || F.a[q2] === A.STAIR) continue; const k = Math.min(ra, rb) + ':' + Math.max(ra, rb) + ':' + side; if (!pairs.has(k)) pairs.set(k, []); pairs.get(k).push([i, j]); } }
    for (const [k, L] of pairs) { const side = +k.split(':')[2]; L.sort((p, q) => side === 0 ? p[0] - q[0] || p[1] - q[1] : p[1] - q[1] || p[0] - q[0]);
      // 按直线连续分段
      const runs = []; let cur = [L[0]]; for (let t = 1; t < L.length; t++) { const p = L[t - 1], q = L[t], cont = side === 0 ? (q[0] === p[0] && q[1] === p[1] + 1) : (q[1] === p[1] && q[0] === p[0] + 1); if (cont) cur.push(q); else { runs.push(cur); cur = [q]; } } runs.push(cur);
      const ra = +k.split(':')[0], rbn = +k.split(':')[1], rA = b.rooms[ra], rB = b.rooms[rbn], rouka = (rA && rA.kind === 'rouka') || (rB && rB.kind === 'rouka');
      runs.sort((p, q) => q.length - p.length); const run = runs[0]; // 只剩 1 格长的公共边（例如被楼板洞切开）：开半間戸
      const n = run.length < 2 ? 1 : rouka ? Math.max(2, run.length - 1) : Math.min(run.length - (run.length >= 4 ? 2 : 0), 2 + (run.length >= 8 ? 2 : 0)), st = Math.floor((run.length - n) / 2), p0 = run[st];
      b.open.push({ f, i: p0[0], j: p0[1], side, kind: kind || 'fusuma', n });
    }
  }
  // opt.wt = 窓类型；opt.slide = 土戸要引き代（相邻一間墙空着，记 o.slide = ±1）；opt.sides = 允许的墙面（缺省全部）
  function exteriorWindows(b, f, rr, kind, prob, opt) { // 外墙每 2 格（1 間）一个窗位，种子取舍；门、石落し 占的位置跳过
    opt = opt || {}; const F = b.F[f], taken = new Set(), key = (sd, i, j) => sd + ':' + i + ':' + j; for (const o of b.open) if (o.f === f) for (let k = -1; k <= o.n; k++) taken.add(o.side + ':' + (o.side < 2 ? o.i + ':' + (o.j + k) : (o.i + k) + ':' + o.j)); if (opt.blocked) for (const c of opt.blocked) for (let sd = 0; sd < 4; sd++) taken.add(sd + ':' + c);
    const wallCell = (side, i, j) => { const [di, dj] = NB[side]; return INSIDE(at(b, F, i, j)) && at(b, F, i + di, j + dj) === A.OUT; };
    for (let side = 0; side < 4; side++) { const [di, dj] = NB[side]; if (opt.sides && !opt.sides.includes(side)) continue;
      for (let j = 0; j < b.nv; j++) for (let i = 0; i < b.nu; i++) { const a = F.a[j * b.nu + i]; if (!INSIDE(a) || at(b, F, i + di, j + dj) !== A.OUT) continue; const s = side < 2 ? j : i; if (s % 2) continue;
        const i2 = side < 2 ? i : i + 1, j2 = side < 2 ? j + 1 : j; if (!INSIDE(at(b, F, i2, j2)) || at(b, F, i2 + di, j2 + dj) !== A.OUT) continue;
        if (taken.has(side + ':' + i + ':' + j) || taken.has(side + ':' + i2 + ':' + j2)) continue; if (opt.near) { let nb = false; for (let k = 1; k <= opt.near && !nb; k++) nb = INSIDE(at(b, F, i + di * k, j + dj * k)) || INSIDE(at(b, F, i2 + di * k, j2 + dj * k)); if (nb) continue; } if (rr() > prob) continue;
        let slide = 0, bay = null;
        if (opt.slide) { for (const sg of [1, -1]) { const c = [0, 1].map(k => side < 2 ? [i, j + sg * 2 + k] : [i + sg * 2 + k, j]); if (c.every(([ii, jj]) => wallCell(side, ii, jj) && !taken.has(key(side, ii, jj)))) { slide = sg; bay = c; break; } } if (!slide) continue; }
        b.open.push(Object.assign({ f, i, j, side, kind, n: 2 }, opt.wt ? { wt: opt.wt } : {}, slide ? { slide } : {})); taken.add(side + ':' + i + ':' + j); taken.add(side + ':' + i2 + ':' + j2);
        if (bay) for (const [ii, jj] of bay) taken.add(key(side, ii, jj)); } }
  }
  // 隠狭間：城外侧墙（outSides）上没被门/窓/石落し/土戸引き代 占的每个間位一处；形状 丸/三角/四角 按种子轮换；cap = 本层总数上限（实测）
  function addHazama(b, f, sides, rr, cap, blocked) { const F = b.F[f], taken = new Set(); if (blocked) for (const c of blocked) for (let sd = 0; sd < 4; sd++) taken.add(sd + ':' + c); let n = 0; const shapes = ['maru', 'sankaku', 'shikaku'], s0 = Math.floor(rr() * 3);
    for (const o of b.open) if (o.f === f) { const ext = o.slide ? [o.slide > 0 ? 0 : -2, o.slide > 0 ? o.n + 2 : o.n] : [0, o.n]; for (let k = ext[0] - 1; k <= ext[1]; k++) taken.add(o.side + ':' + (o.side < 2 ? o.i + ':' + (o.j + k) : (o.i + k) + ':' + o.j)); }
    for (const side of sides) { const [di, dj] = NB[side];
      for (let j = 0; j < b.nv; j++) for (let i = 0; i < b.nu; i++) { if (cap !== undefined && n >= cap) return; const a = F.a[j * b.nu + i]; if (!INSIDE(a) || at(b, F, i + di, j + dj) !== A.OUT) continue; const s = side < 2 ? j : i; if (s % 2) continue;
        const i2 = side < 2 ? i : i + 1, j2 = side < 2 ? j + 1 : j; if (!INSIDE(at(b, F, i2, j2)) || at(b, F, i2 + di, j2 + dj) !== A.OUT) continue;
        if (taken.has(side + ':' + i + ':' + j) || taken.has(side + ':' + i2 + ':' + j2)) continue; if (rr() > 0.7) continue;
        b.open.push({ f, i, j, side, kind: 'hazama', n: 2, shape: shapes[(s0 + n) % 3] }); n++; taken.add(side + ':' + i + ':' + j); taken.add(side + ':' + i2 + ':' + j2); } }
  }
  // 保留通行：门内 1 格、开口两侧各 1 格、階段上下端 1 格
  function keepClear(b, f) { const F = b.F[f]; for (const o of b.open) { if (o.f !== f || o.kind === 'window' || o.kind === 'akari' || o.kind === 'ishi' || o.kind === 'hazama') continue; const [di, dj] = NB[o.side]; for (let k = 0; k < o.n; k++) { const i = o.side < 2 ? o.i : o.i + k, j = o.side < 2 ? o.j + k : o.j; for (const s of [0, 1]) { const ii = i - di * s, jj = j - dj * s; if (ii >= 0 && jj >= 0 && ii < b.nu && jj < b.nv) F.kc[jj * b.nu + ii] = 1; const i3 = i + di * (s + 1), j3 = j + dj * (s + 1); if (i3 >= 0 && j3 >= 0 && i3 < b.nu && j3 < b.nv && INSIDE(F.a[j3 * b.nu + i3])) F.kc[j3 * b.nu + i3] = 1; } } }
    for (const st of b.stairs) { if (st.f === f) for (const [i, j] of [st.bot]) F.kc[j * b.nu + i] = 1; if (st.f + 1 === f) for (const [i, j] of [st.top]) F.kc[j * b.nu + i] = 1; } }
  function addToko(b, f, room) { // 床の間：靠房间里离门最远的那面墙，宽 2 格、深 1 格，不压保留通行
    const F = b.F[f], [a0, b0, a1, b1] = room.rect, cands = [];
    for (const side of [0, 1, 2, 3]) { const L = side < 2 ? b1 - b0 : a1 - a0; for (let s = 0; s + 2 <= L; s++) { const cells = [0, 1].map(k => side === 0 ? [a1 - 1, b0 + s + k] : side === 1 ? [a0, b0 + s + k] : side === 2 ? [a0 + s + k, b1 - 1] : [a0 + s + k, b0]); if (cells.every(([i, j]) => !F.kc[j * b.nu + i] && F.r[j * b.nu + i] === room.id)) cands.push({ side, cells, sc: Math.abs(s + 1 - L / 2) }); } }
    if (!cands.length) return; cands.sort((p, q) => p.sc - q.sc); const c = cands[0]; for (const [i, j] of c.cells) F.a[j * b.nu + i] = A.TOKO; b.fix.push({ f, kind: 'toko', cells: c.cells, room: room.id, side: c.side });
  }

  // ---------------- 类型：橹（2–3 层）。现存橹 = 实测平面/层数/面积/高（严格），失传橹 = 槽位平面 + 规则（推定）----------------
  function yagura(S, W, p) {
    const real = !!p.real, M = real ? SPEC.measured[p.name] : null, stories = M ? M.stories : (SPEC.storiesByName[p.name] || (p.fam === 'yagura3' ? 3 : 2));
    const key = 'yagura@' + p.name, R = node => rng(nodeSeed(W, key, node)), YS = SPEC.yagura, YN0 = !real && SPEC.byName[p.name], YN = YN0 ? Object.assign({ taper: Math.round((YN0.tiers[0][0] - YN0.tiers[1][0]) / 2 * 2) }, YN0) : null;
    // 位置与朝向 = site 的部件（现存橹已按“面贴边”平移到外墙面与石垣顶线齐平；失传橹 = 槽位）；平面形状（L 形）取 OSM 外形，移到部件中心
    const ang = p.ang || 0, fr00 = frameOf(p.x, p.y, ang), pl = bbox(p.poly.map(q => fr00.l(q[0], q[1]))), [pcx, pcy] = fr00.w((pl[0] + pl[2]) / 2, (pl[1] + pl[3]) / 2), fr0 = frameOf(pcx, pcy, ang), PW = pl[2] - pl[0], PD = pl[3] - pl[1]; // 部件多边形的实际外形（现存橹 = 0.92 × OSM 尺寸）
    const fp = real && p.data && p.data.fp ? p.data.fp : p.poly, loc0 = fp.map(q => fr0.l(q[0], q[1])), lb0 = bbox(loc0), loc = loc0.map(q => [q[0] - (lb0[0] + lb0[2]) / 2, q[1] - (lb0[1] + lb0[3]) / 2]);
    // 一层：失传橹 = 槽位矩形按格取整；现存橹 = 按实测一层面积等比缩（OSM 外形按屋顶轮廓含出檐理解），L 形按格栅格化
    let mask = null, scale = 1;
    if (M && M.area) scale = Math.sqrt(M.area[0] / (M.L ? Math.abs(area(loc)) : PW * PD));
    const fit = (L, k) => { let n = Math.round(L * k / CS); if (n * CS > L + 1e-6) n--; return Math.max(4, n); }, nu = fit(PW, scale), nv = fit(PD, scale); // 不超出部件外形
    if (M && M.L) { mask = new Uint8Array(nu * nv); for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const u = (i + 0.5 - nu / 2) * CS / scale, v = (j + 0.5 - nv / 2) * CS / scale; if (inPoly(u, v, loc)) mask[j * nu + i] = 1; } }
    // 内外：部件各边中点外 3 m 处离石垣顶线的距离——最大的一侧 = 城内侧（开门），< 2.5 m 的 = 朝外（贴边、放石落し）
    const g = S.regions[p.region], sideIn = [0, 1, 2, 3].map(sd => { const [di, dj] = NB[sd], [x, y] = fr0.w(di * (PW / 2 + 3), dj * (PD / 2 + 3)); return S.inEncl(g, x, y) ? S.crestDist(g, x, y) : -1e9; });
    const inSide = sideIn.indexOf(Math.max(...sideIn)), outSides = [0, 1, 2, 3].filter(sd => sideIn[sd] < 2.5).sort((a, c) => sideIn[a] - sideIn[c]).slice(0, 2);
    // 外墙面与部件的朝外面齐平（墙站在石垣边上，出檐伸出石垣外）；不朝外的轴居中
    const u0 = outSides.includes(1) ? -PW / 2 : outSides.includes(0) ? PW / 2 - nu * CS : -nu * CS / 2, v0 = outSides.includes(3) ? -PD / 2 : outSides.includes(2) ? PD / 2 - nv * CS : -nv * CS / 2;
    const b = mkB({ key, type: 'yagura', name: p.name, tier: real ? 'measured' : 'est', region: p.region, x: pcx, y: pcy, ang, u0, v0, nu, nv, part: p.id, stories, outSides, inSide });
    if (M && M.area) { let n = 0; for (let q = 0; q < nu * nv; q++) if (!mask || mask[q]) n++; b.areaRes = [n * CS * CS, M.area[0]]; }
    // 贴边：朝外的墙面落在石垣顶线上（离顶线 0…+0.05 m，不外挑——部件外形含出檐时会外挑 0.4–0.6 m）
    for (const sd of outSides) { const [di, dj] = NB[sd]; let worst = 1e9; for (const t of [0.15, 0.5, 0.85]) { const u = di > 0 ? b.u0 + nu * CS : di < 0 ? b.u0 : b.u0 + nu * CS * t, v = dj > 0 ? b.v0 + nv * CS : dj < 0 ? b.v0 : b.v0 + nv * CS * t, [x, y] = b.fr.w(u, v); worst = Math.min(worst, S.crestDist(g, x, y)); }
      if (worst < 0.02) { const d = 0.05 - worst; if (sd === 0) b.u0 -= d; else if (sd === 1) b.u0 += d; else if (sd === 2) b.v0 -= d; else b.v0 += d; } }
    const zg = groundMax(S, b, [[0, 0, nu, nv]]); b.zg = zg;
    // 每层格：上层 = 下层按入側宽内收（逓減，柱筋相通）；现存橹按实测上层面积选每轴内收格数
    const masks = [mask || new Uint8Array(nu * nv).fill(1)], insets = [];
    for (let f = 1; f < stories; f++) { let ia = 1, ib = 1;
      if (M && M.area && M.area[f]) { const prev = masks[f - 1]; let bestE = 1e9; for (let a = 0; a <= 3; a++) for (let c = 0; c <= 3; c++) { let n = 0; for (let j = c * (f > 0 ? 1 : 0); j < nv - c; j++) for (let i = a; i < nu - a; i++) if (inset(prev, nu, nv, i, j, a, c)) n++; const e = Math.abs(n * CS * CS - M.area[f]); if (e < bestE - 1e-9) { bestE = e; ia = a; ib = c; } } }
      else if (YN) { ia = YN.taper; ib = YN.taper; } // 文献：各重逓減（9→7→5 間 = 每侧 1 間 = 2 格），见 SPEC.byName
      else { const r = R('taper')(); ia = stories >= 3 ? 1 : (r < 0.5 ? 2 : 1); ib = ia; } // 三重橹槽位只有 13×11 m：每层每侧内收半間，顶层仍放得下階段
      const prev = masks[f - 1], mk = new Uint8Array(nu * nv); for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) if (inset(prev, nu, nv, i, j, ia, ib)) mk[j * nu + i] = 1; masks.push(mk); insets.push([ia, ib]); }
    // 层高：现存橹 = 按实测总高反推（夹在范围内），失传橹 = 范围内取（三重 ≥18 m）
    const rh = R('height'), Hwant = M && M.H ? M.H : YN && YN.H ? YN.H : (stories === 3 ? YS.lost3H : YS.lost2H)[0] + rh() * 2;
    const roofRise = f => { const r = rectOf(masks[f], nu, nv); return Math.min(r[2] - r[0], r[3] - r[1]) * CS / 2 * YS.pitch + 0.6; };
    let sh = (Hwant - YS.plinth - roofRise(stories - 1) - 0.3 * (stories - 1)) / stories; sh = clamp(sh, YS.storyH[0], YS.storyH[1]);
    b.prov = real ? { tier: '实测', src: 'measured', note: '平面 = OSM 外形按实测一层面积缩放；层数/各层面积/总高 = 重要文化财数据；内部 = 规则 + 种子（推定）', area: M && M.area, H: M && M.H } : (YN ? { tier: '文献', src: 'lost-slot+lit', note: '位置 = site 失传橹槽位（遗址点吸附石垣）；各重平面 ' + YN.tiers.map(t => t[0] + '×' + t[1]).join(' / ') + ' 間、逓減、高 ' + YN.H + ' m、顶层 4 室 = ' + YN.src + '；房间分割其余 = 规则（推定）' } : { tier: '推定', src: 'lost-slot', note: '位置 = site 失传橹槽位（遗址点吸附石垣）；层数 = 类型/文献；尺寸 = 规则 + 种子' });
    let z = zg.max + YS.plinth;
    const rr = R('rooms'), ro = R('open');
    for (let f = 0; f < stories; f++) { const F = floorNew(b, z, sh), mk = masks[f]; for (let q = 0; q < mk.length; q++) if (mk[q]) F.a[q] = A.ROOM; z += sh + 0.3; }
    // ゾーン：入側（武者走り）= 上层墙线外侧的一圈（宽 = 内收格数）；内收为 0（総二階）或顶层：外圈 2 格（1 間）——身舎太小就不设
    for (let f = 0; f < stories; f++) { const F = b.F[f], up = masks[f + 1], mk = masks[f];
      const ring = (!up && !(YN && YN.rooms[f] === 4)) || (up && insets[f].every(x => x === 0));
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const q = j * nu + i; if (!F.a[q]) continue; const iri = ring ? !insetOk(mk, nu, nv, i, j, 2) : up ? !up[q] : false; if (iri) F.a[q] = A.IRI; }
      let nRoom = 0; for (let q = 0; q < F.a.length; q++) if (F.a[q] === A.ROOM) nRoom++;
      if (ring && nRoom < 24) for (let q = 0; q < F.a.length; q++) if (F.a[q] === A.IRI) F.a[q] = A.ROOM; } // 身舎太小：整层一间（不设武者走り）
    // 房间：自上而下。上层的结构线（墙、入側线、隔断）投到下层身舎里必须是隔断线（柱筋相通：上层柱落在下层柱/隔断上，H26）；
    // 顶层身舎按种子切 1–2 间。身舎 = 被这些线切开的连通块。
    let req = null; // 上一层（更高一层）的结构边集合
    for (let f = stories - 1; f >= 0; f--) { const F = b.F[f];
      const cut = new Set(req || []);
      if (!req && YN && YN.rooms[f] === 4) { const core = rectOfAttr(F, nu, nv, A.ROOM); if (core) { const mu = core[0] + 2 * Math.round((core[2] - core[0]) / 4), mv = core[1] + 2 * Math.round((core[3] - core[1]) / 4); for (let j = core[1]; j < core[3]; j++) cut.add('u:' + mu + ':' + j); for (let i = core[0]; i < core[2]; i++) cut.add('v:' + i + ':' + mv); } } // 文献：顶层 4 室（田字）
      else if (!req) { const core = rectOfAttr(F, nu, nv, A.ROOM); if (core && core[2] - core[0] >= 8 && rr() < 0.6) { const m = core[0] + 2 * Math.round((core[2] - core[0]) / 4); for (let j = core[1]; j < core[3]; j++) cut.add('u:' + m + ':' + j); } }
      // 连通块
      let t = 0; for (let q = 0; q < F.a.length; q++) { if (F.a[q] !== A.ROOM || F.r[q] >= 0) continue; const id = b.rooms.length, st = [q]; F.r[q] = id; let n = 0, i0 = 1e9, j0 = 1e9, i1 = -1, j1 = -1;
        while (st.length) { const c0 = st.pop(), i = c0 % nu, j = (c0 - i) / nu; n++; i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i + 1); j1 = Math.max(j1, j + 1);
          for (let sd = 0; sd < 4; sd++) { const [di, dj] = NB[sd], i2 = i + di, j2 = j + dj; if (i2 < 0 || j2 < 0 || i2 >= nu || j2 >= nv) continue; const q2 = j2 * nu + i2; if (F.a[q2] !== A.ROOM || F.r[q2] >= 0) continue; const ek = sd < 2 ? 'u:' + Math.max(i, i2) + ':' + j : 'v:' + i + ':' + Math.max(j, j2); if (cut.has(ek)) continue; F.r[q2] = id; st.push(q2); } }
        b.rooms.push({ id, name: p.name + '·' + (f + 1) + '階·内室' + (++t), rect: [i0, j0, i1, j1], kind: 'board', f, n }); }
      const iid = b.rooms.length; b.rooms.push({ id: iid, name: p.name + '·' + (f + 1) + '階·武者走り', rect: [0, 0, nu, nv], kind: 'iri', f }); for (let q = 0; q < F.a.length; q++) if (F.a[q] === A.IRI) F.r[q] = iid;
      // 本层结构边（给下一层用）：格边两侧 属性/房间 不同（含外墙）
      req = []; for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const q = j * nu + i, here = i < nu && j < nv ? F.r[q] : -2, inH = i < nu && j < nv && INSIDE(F.a[q]);
        if (i > 0 && j < nv) { const l = F.r[q - 1], inL = INSIDE(F.a[q - 1]); if ((inH || inL) && (l !== (i < nu ? here : -2) || inH !== inL)) req.push('u:' + i + ':' + j); }
        if (j > 0 && i < nu) { const d = F.r[q - nu], inD = INSIDE(F.a[q - nu]); if ((inH || inD) && (d !== (j < nv ? here : -2) || inH !== inD)) req.push('v:' + i + ':' + j); } }
    }
    // 階段：每层在身舎（或入側）一角，沿长向，2 格宽；格数 = 让坡度 ≤ slopeMax
    addDoor(b, 0, [0, 0, nu, nv], inSide, 'door', ro); keepClear(b, 0); // 先定门（城内侧），门内保留通行格不放階段
    if (!placeStairs(b, R)) b.notes.push(p.name + ' 階段放不下');
    // 开口：一层门（城内侧，2 格）；内室之间/内室↔武者走り 板戸；窓：外墙每間一个位（种子取舍）；石落し：一层朝外两侧中部各 1 处（2 格）
    for (let f = 0; f < stories; f++) partitionOpenings(b, f, rr, 'itado');
    for (const sd of outSides) addIshi(b, 0, sd, ro);
    // 土塀续接：顶到部件外形（含出檐）的土塀端头，沿墙轴续到本橹墙面（同高同厚）——部件外形比墙大时，防御线不留缝
    b.wext = []; const dEnds = []; for (const d of S.parts) { if (d.fam !== 'dobei' || d.x0 === undefined) continue; for (const e of [0, 1]) { const ex = e ? d.x1 : d.x0, ey = e ? d.y1 : d.y0, ox = e ? d.x0 : d.x1, oy = e ? d.y0 : d.y1; if (Math.abs(polyDist(ex, ey, p.poly)) > 0.6) continue; dEnds.push({ x: ex, y: ey, ox, oy, t: d.t || 0.6 });
      const L = Math.hypot(ex - ox, ey - oy) || 1, dx = (ex - ox) / L, dy = (ey - oy) / L; let k = 0; while (k < 8 && !inBodyXY(b, ex + dx * k, ey + dy * k)) k += 0.05; if (k <= 0.05 || k >= 8) continue;
      const z = e ? (d.z1 !== undefined ? d.z1 : d.z) : (d.z0 !== undefined ? d.z0 : d.z); b.wext.push({ x0: ex - dx * 0.1, y0: ey - dy * 0.1, x1: ex + dx * (k + 0.1), y1: ey + dy * (k + 0.1), z, h: d.h || 2.2, t: d.t || 0.6, part: d.id }); } }
    // B3：土塀顶到墙面处（一层）不开窓/狭間、不作土戸引き代：端点 0.8 m 内的外墙格
    const blocked = new Set(); for (const w of b.wext) { const [u, v] = b.fr.l(w.x1, w.y1); for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) if (Math.hypot(U(b, i + 0.5) - u, V(b, j + 0.5) - v) < 0.8 + CS * 0.71) blocked.add(i + ':' + j); }
    { const F0 = b.F[0]; for (const w of b.wext.concat((real ? [] : dEnds).map(e => { const L = Math.hypot(e.x - e.ox, e.y - e.oy) || 1, k = Math.min(L, 3); return { x0: e.x - (e.x - e.ox) / L * k, y0: e.y - (e.y - e.oy) / L * k, x1: e.x, y1: e.y, t: e.t }; }))) { const [ua, va] = b.fr.l(w.x0, w.y0), [uc, vc] = b.fr.l(w.x1, w.y1); // 失传橹：也含已经顶到墙面（没有续接段）的土塀端头（现存橹不变） // r14：斜着贴到墙面的土塀（伏見櫓 17.7 m 平面）——墙外 0.3 m 处离土塀中线 < 厚/2 + 半格 的外墙格也不开窓
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { if (!INSIDE(F0.a[j * nu + i])) continue; for (let sd = 0; sd < 4; sd++) { const [di, dj] = NB[sd]; if (INSIDE(at(b, F0, i + di, j + dj))) continue; const pu = U(b, i + 0.5) + di * (CS / 2 + 0.3), pv = V(b, j + 0.5) + dj * (CS / 2 + 0.3); if (segDist(pu, pv, ua, va, uc, vc) < w.t / 2 + CS) blocked.add(i + ':' + j); } } } }
    const winSides = M && M.winIn === false ? outSides : undefined; // 千貫櫓：城内侧原本无窓（实测）
    for (let f = 0; f < stories; f++) exteriorWindows(b, f, ro, 'window', 0.6, { wt: 'koshi', slide: true, sides: winSides, blocked: f === 0 ? blocked : null });
    if (stories === 3 && !real) { const f = stories - 1, ws = b.open.filter(o => o.f === f && o.kind === 'window' && o.side === inSide); if (ws.length) { const mid = ws.map(o => [Math.abs((inSide < 2 ? o.j + 1 - nv / 2 : o.i + 1 - nu / 2)), o]).sort((x, y) => x[0] - y[0])[0][1]; mid.wt = 'kato'; } } // 華頭窓（推定）
    for (let f = 0; f < stories; f++) addHazama(b, f, outSides, ro, M && M.hazama ? M.hazama[f] : undefined, f === 0 ? blocked : null);
    for (let f = 0; f < stories; f++) keepClear(b, f);
    // 屋顶：每层：非顶层 = 腰屋根（下层墙顶 → 上层墙），顶层 = 入母屋
    for (let f = 0; f < stories; f++) for (const r of rects(b.F[f].a, nu, nv, INSIDE)) b.roofs.push({ f, r, kind: f === stories - 1 ? 'irimoya' : 'koshi', ov: YS.ov[Math.min(f, 2)], pitch: YS.pitch, top: f === stories - 1 });
    b.insets = insets; b.Hwant = Hwant; return b;
  }
  const inBodyXY = (b, x, y) => { const [u, v] = b.fr.l(x, y), i = Math.floor((u - b.u0) / b.cs), j = Math.floor((v - b.v0) / b.cs); return i >= 0 && j >= 0 && i < b.nu && j < b.nv && INSIDE(b.F[0].a[j * b.nu + i]); };
  const area = P => { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], c = P[(i + 1) % P.length]; s += a[0] * c[1] - c[0] * a[1]; } return s / 2; };
  function inset(m, nu, nv, i, j, a, c) { if (i - a < 0 || j - c < 0 || i + a >= nu || j + c >= nv) return false; for (let jj = j - c; jj <= j + c; jj++) for (let ii = i - a; ii <= i + a; ii++) if (!m[jj * nu + ii]) return false; return !!m[j * nu + i]; }
  function insetOk(m, nu, nv, i, j, w) { return inset(m, nu, nv, i, j, w, w); }
  function rectOf(m, nu, nv) { let a = 1e9, b = 1e9, c = -1, d = -1; for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) if (m[j * nu + i]) { a = Math.min(a, i); b = Math.min(b, j); c = Math.max(c, i + 1); d = Math.max(d, j + 1); } return [a, b, c, d]; }
  function rectOfAttr(F, nu, nv, at0) { let a = 1e9, b = 1e9, c = -1, d = -1; for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) if (F.a[j * nu + i] === at0) { a = Math.min(a, i); b = Math.min(b, j); c = Math.max(c, i + 1); d = Math.max(d, j + 1); } return c < 0 ? null : [a, b, c, d]; }
  // 階段：2 格宽 × run 格长，下端和上端外各 1 格可走（上层同位置可走、不是 VOID），上层压在梯段上方的格标 VOID（楼板开洞 → 净高）
  function placeStair(b, f, run, r) {
    const F = b.F[f], F2 = b.F[f + 1], nu = b.nu, nv = b.nv, cands = [];
    for (const dir of [0, 1, 2, 3]) { const [di, dj] = NB[dir], L = dir < 2 ? run : 2, Wd = dir < 2 ? 2 : run;
      for (let j = 0; j + Wd <= nv; j++) for (let i = 0; i + L <= nu; i++) {
        let ok = true; for (let jj = j; jj < j + Wd && ok; jj++) for (let ii = i; ii < i + L; ii++) { const a = F.a[jj * nu + ii]; if (!(a === A.ROOM || a === A.IRI) || !INSIDE(F2.a[jj * nu + ii]) || F.kc[jj * nu + ii]) { ok = false; break; } } if (!ok) continue;
        // 下端（dir 反向一格）与上端（dir 正向一格）
        const bot = dir === 0 ? [i - 1, j] : dir === 1 ? [i + L, j] : dir === 2 ? [i, j - 1] : [i, j + Wd], top = dir === 0 ? [i + L, j] : dir === 1 ? [i - 1, j] : dir === 2 ? [i, j + Wd] : [i, j - 1];
        const bq = at(b, F, bot[0], bot[1]), tq = at(b, F2, top[0], top[1]); if (!(bq === A.ROOM || bq === A.IRI) || !(tq === A.ROOM || tq === A.IRI)) continue;
        const rid0 = F.r[bot[1] * nu + bot[0]]; let same = true; for (let jj = j; jj < j + Wd && same; jj++) for (let ii = i; ii < i + L; ii++) if (F.r[jj * nu + ii] !== rid0) { same = false; break; } if (!same) continue;
        // 上层：梯段上方（VOID）不能切断上层房间的连通——上端格与本层门洞侧仍要相连（交给 H25 复查）；这里只要求上端格不是 VOID 区
        let upOk = true; const rTop = F2.r[top[1] * nu + top[0]]; for (let jj = j; jj < j + Wd && upOk; jj++) for (let ii = i; ii < i + L; ii++) { const a2 = F2.a[jj * nu + ii]; if (!(a2 === A.ROOM || a2 === A.IRI) || F2.r[jj * nu + ii] !== rTop) { upOk = false; break; } } if (!upOk) continue; // 楼板洞与上端格同一房间（上楼的出口没有隔断）
        // 偏好：贴墙角（两侧有外墙/入側边）
        let edge = 0; for (let jj = j - 1; jj <= j + Wd; jj++) for (let ii = i - 1; ii <= i + L; ii++) if (!INSIDE(at(b, F, ii, jj))) edge++;
        cands.push({ dir, i, j, L, Wd, bot, top, sc: -edge + r() * 0.5 });
      } }
    if (!cands.length) return null; cands.sort((p, q) => p.sc - q.sc);
    // 连通：放下梯段后，本层可走格（不含梯段、楼板洞）仍是一个连通块，且包含下一层梯段的上端格（否则上来的人被梯段/楼板洞围住）
    const land = b.stairs.filter(s3 => s3.f + 1 === f).map(s3 => s3.top);
    const conn = c => { // 每个房间（按房间号）去掉梯段格后仍连通（梯段/楼板洞不把一个房间切成两块），且包含下层梯段的上端格
      const blk = (ii, jj) => ii >= c.i && ii < c.i + c.L && jj >= c.j && jj < c.j + c.Wd, ok = q => { const a = F.a[q]; return a === A.ROOM || a === A.IRI; }, seen = new Uint8Array(F.a.length);
      for (let q0 = 0; q0 < F.a.length; q0++) { const i0 = q0 % nu, j0 = (q0 - i0) / nu; if (!ok(q0) || blk(i0, j0) || seen[q0]) continue; const rid = F.r[q0], st = [q0]; seen[q0] = 1; let first = true;
        while (st.length) { const q = st.pop(), ii = q % nu, jj = (q - ii) / nu; for (const [di, dj] of NB) { const i2 = ii + di, j2 = jj + dj; if (i2 < 0 || j2 < 0 || i2 >= nu || j2 >= nv) continue; const q2 = j2 * nu + i2; if (seen[q2] || !ok(q2) || blk(i2, j2) || F.r[q2] !== rid) continue; seen[q2] = 1; st.push(q2); } }
        // 同房间里还有没被这次洪泛到的格 = 被切成两块
        for (let q = 0; q < F.a.length; q++) { const ii = q % nu, jj = (q - ii) / nu; if (ok(q) && !blk(ii, jj) && F.r[q] === rid && !seen[q]) return false; } }
      return land.every(([ii, jj]) => !blk(ii, jj)) && !blk(c.bot[0], c.bot[1]); };
    return cands.filter(conn);
  }
  function applyStair(b, f, c) { const F = b.F[f], F2 = b.F[f + 1], nu = b.nu, rid = F.r[c.bot[1] * nu + c.bot[0]], undo = [];
    for (let jj = c.j; jj < c.j + c.Wd; jj++) for (let ii = c.i; ii < c.i + c.L; ii++) { const q = jj * nu + ii; undo.push([q, F.a[q], F.r[q], F2.a[q]]); F.a[q] = A.STAIR; F.r[q] = rid; F2.a[q] = A.VOID; }
    const st = { f, dir: c.dir, rect: [c.i, c.j, c.i + c.L, c.j + c.Wd], bot: c.bot, top: c.top, rise: F2.z - F.z, run: (c.dir < 2 ? c.L : c.Wd) * CS }; b.stairs.push(st);
    return () => { for (const [q, a, r, a2] of undo) { F.a[q] = a; F.r[q] = r; F2.a[q] = a2; } b.stairs.pop(); }; }
  // 逐层放階段，带回溯：下层的梯段（及其在上层的楼板洞）要让上层还放得下自己的梯段
  function placeStairs(b, R) { const n = b.F.length, rr = R('stair');
    const go = f => { if (f + 1 >= n) return true; const F = b.F[f], F2 = b.F[f + 1], run = Math.ceil((F2.z - F.z) / SPEC.stair.slopeMax / CS), cs = placeStair(b, f, run, rr) || [];
      for (const c of cs.slice(0, 24)) { const undo = applyStair(b, f, c); if (go(f + 1)) return true; undo(); } return false; };
    return go(0); }
  function addIshi(b, f, side, r) { // 石落し：外墙中部 2 格，地板对应格开洞（ISHI），外观是向外挑出的箱
    const F = b.F[f], [di, dj] = NB[side], cells = []; for (let j = 0; j < b.nv; j++) for (let i = 0; i < b.nu; i++) if (F.a[j * b.nu + i] === A.IRI && at(b, F, i + di, j + dj) === A.OUT) cells.push([i, j]);
    if (cells.length < 4) return; cells.sort((p, q) => side < 2 ? p[1] - q[1] : p[0] - q[0]); const mid = Math.floor(cells.length / 2) - 1, c0 = cells[mid], c1 = cells[mid + 1];
    if (!c1 || (side < 2 ? c1[1] !== c0[1] + 1 : c1[0] !== c0[0] + 1)) return;
    for (const [i, j] of [c0, c1]) { if (F.kc[j * b.nu + i]) return; }
    for (const [i, j] of [c0, c1]) F.a[j * b.nu + i] = A.ISHI; b.open.push({ f, i: c0[0], j: c0[1], side, kind: 'ishi', n: 2 });
  }

  // ---------------- 类型：番所（门内）/ 蔵（剩余自由地）----------------
  function small(S, W, g, FG, kind, anchor, k, fixed) { // fixed = { r（FG 格）, name, key, fit, prov }：史料拟合位置（r14 御金蔵），不搜索
    const sp = SPEC.small[kind], key = fixed ? fixed.key : kind + '@' + g.name + '@' + Math.round(anchor[0] / 5) + ',' + Math.round(anchor[1] / 5), R = node => rng(nodeSeed(W, key, node)), r0 = R('shape');
    const w = Math.round(sp.w[0] + (sp.w[1] - sp.w[0]) * r0()) * 2, d = Math.round(sp.d[0] + (sp.d[1] - sp.d[0]) * r0()) * 2, [au, av] = FG.fr0.l(anchor[0], anchor[1]), ai = Math.round((au - FG.u0) / CS), aj = Math.round((av - FG.v0) / CS);
    let best = null; const occ = W.occ[g.name], nu = FG.nu, nv = FG.nv, OP = new Int32Array((nu + 1) * (nv + 1)), m = Math.ceil(SPEC.setback.between / CS);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) OP[(j + 1) * (nu + 1) + i + 1] = occ[j * nu + i] + OP[j * (nu + 1) + i + 1] + OP[(j + 1) * (nu + 1) + i] - OP[j * (nu + 1) + i];
    const occAny = (i0, j0, i1, j1) => { i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(nu, i1); j1 = Math.min(nv, j1); return i1 > i0 && j1 > j0 && OP[j1 * (nu + 1) + i1] - OP[j0 * (nu + 1) + i1] - OP[j1 * (nu + 1) + i0] + OP[j0 * (nu + 1) + i0] > 0; };
    const rp = R('place');
    if (fixed) best = { r: fixed.r };
    else for (const [ww, dd] of [[w, d], [d, w]]) for (let j = Math.max(0, aj - 40); j + dd <= Math.min(nv, aj + 40); j++) for (let i = Math.max(0, ai - 40); i + ww <= Math.min(nu, ai + 40); i++) {
      if (!FG.free(i, j, i + ww, j + dd) || occAny(i - m, j - m, i + ww + m, j + dd + m)) continue;
      const sc = Math.hypot(i + ww / 2 - ai, j + dd / 2 - aj) + rp() * 0.3; if (!best || sc < best.sc) best = { sc, r: [i, j, i + ww, j + dd] }; }
    if (!best) { W.notes.push(key + ' 放不下'); return null; }
    const r = best.r; for (let j = r[1]; j < r[3]; j++) for (let i = r[0]; i < r[2]; i++) occ[j * FG.nu + i] = 1;
    const [ox, oy] = FG.x(r[0], r[1]), b = mkB({ key, type: kind, name: fixed ? fixed.name : (kind === 'bansho' ? '番所' : '蔵') + (k + 1), tier: 'est', region: g.i, x: ox, y: oy, ang: FG.ang, u0: 0, v0: 0, nu: r[2] - r[0], nv: r[3] - r[1] });
    if (fixed) { b.fit = fixed.fit; b.prov = fixed.prov; } else b.prov = { tier: '推定', src: kind, note: (kind === 'bansho' ? '门内番所（加番・番衆的诘所惯例）' : '蔵（城内仓库惯例）') + '；位置 = 规则（门内保留通道外最近的自由地 / 剩余自由地），尺寸 = 范围 + 种子' };
    const zg = groundMax(S, b, [[0, 0, b.nu, b.nv]]); b.zg = zg; const F = floorNew(b, zg.max + (kind === 'kura' ? 0.45 : 0.4), sp.wallH);
    for (let q = 0; q < F.a.length; q++) F.a[q] = A.ROOM;
    const rr = R('rooms');
    if (kind === 'bansho') { // 土間（一半，靠门）+ 畳间
      const half = b.nu >= b.nv ? [0, 0, b.nu / 2, b.nv] : [0, 0, b.nu, b.nv / 2], r1 = b.nu >= b.nv ? [b.nu / 2, 0, b.nu, b.nv] : [0, b.nv / 2, b.nu, b.nv];
      b.rooms.push({ id: 0, name: b.name + '·土間', rect: half, kind: 'doma', f: 0 }, { id: 1, name: b.name + '·詰所', rect: r1, kind: 'tatami', f: 0 });
      for (let j = 0; j < b.nv; j++) for (let i = 0; i < b.nu; i++) { const inH = i < half[2] && j < half[3]; F.r[j * b.nu + i] = inH ? 0 : 1; if (inH) F.a[j * b.nu + i] = A.DOMA; }
      partitionOpenings(b, 0, rr, 'shoji'); const gt = anchor; const [gi2, gj2] = (() => { const [u, v] = b.fr.l(gt[0], gt[1]); return [u / CS, v / CS]; })(); addDoor(b, 0, half, sideToward(b, half, gi2, gj2), 'door', rr); if (!b.open.some(o => o.kind === 'door')) { for (const sd of [1, 3, 0, 2]) if (addDoor(b, 0, half, sd, 'door', rr)) break; }
      exteriorWindows(b, 0, rr, 'window', 0.5, { wt: 'tsuki' }); // 突上戸 + 木格子（推定）
    } else { b.rooms.push({ id: 0, name: b.name + '·内', rect: [0, 0, b.nu, b.nv], kind: 'board', f: 0 }); F.r.fill(0); for (const sd of [3, 2, 1, 0]) if (addDoor(b, 0, [0, 0, b.nu, b.nv], sd, 'door', rr)) break; }
    keepClear(b, 0);
    if (kind === 'kura') { const rc = R('fix'); for (let j = 0; j < b.nv; j++) for (let i = 0; i < b.nu; i++) { const q = j * b.nu + i, edge = i === 0 || j === 0 || i === b.nu - 1 || j === b.nv - 1; if (edge && !F.kc[q] && F.a[q] === A.ROOM && rc() < 0.35) { const nb = [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]].filter(([a, c]) => a >= 0 && c >= 0 && a < b.nu && c < b.nv && F.a[c * b.nu + a] === A.ROOM).length; if (nb >= 2) { F.a[q] = A.TOKO; b.fix.push({ f: 0, kind: 'chest', cells: [[i, j]], room: 0 }); } } } }
    b.roofs.push({ f: 0, r: [0, 0, b.nu, b.nv], kind: 'kirizuma', ov: 0.9, pitch: 0.55, top: true });
    return b;
  }


  // ================= 几何：外观（LOD0 细节 / LOD1 外壳 = 相机碰撞体）与内部（按需）——全部出自同一份格/开口/屋顶规格 =================
  // 输出：按材质分组的三角形顶点数组（site 坐标 x 东 y 北 z 上），app 只做坐标轴换算。
  // B3：withUV → 每个材质另有 m + '@uv'（每顶点 2 个数）：盒按木纹方向（盒的最长边）出米制 UV，NORM_UV 材质（畳/障子）出 0–1 归一 UV；其它三角形按主法向平面投影（米）
  const NORM_UV = new Set(['tatami', 'shoji', 'fusuma']);
  function Acc(withUV) { const acc = {}; const put = (m, a, uv) => { const L = acc[m] || (acc[m] = []); for (const v of a) L.push(v); if (withUV) { const T = acc[m + '@uv'] || (acc[m + '@uv'] = []); if (uv) for (const v of uv) T.push(v); else for (let k = 0; k < a.length; k += 9) { const ax = a[3] - a[0], ay = a[4] - a[1], az = a[5] - a[2], bx = a[6] - a[0], by = a[7] - a[1], bz = a[8] - a[2], nx = Math.abs(ay * bz - az * by), ny = Math.abs(az * bx - ax * bz), nz = Math.abs(ax * by - ay * bx); for (let q = k; q < k + 9; q += 3) { if (nz >= nx && nz >= ny) T.push(a[q], a[q + 1]); else if (nx >= ny) T.push(a[q + 1], a[q + 2]); else T.push(a[q], a[q + 2]); } } } }; return { acc, put }; }
  function mkPrims(b, out) {
    const fr = b.fr, Pw = (u, v, z) => { const [x, y] = fr.w(u, v); return [x, y, z]; };
    const tri = (m, a, c, d, uv) => out.put(m, [a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]], uv);
    const quad = (m, a, c, d, e, ua) => { if (ua) { tri(m, a, c, d, [ua[0], ua[1], ua[2], ua[3], ua[4], ua[5]]); tri(m, a, d, e, [ua[0], ua[1], ua[4], ua[5], ua[6], ua[7]]); } else { tri(m, a, c, d); tri(m, a, d, e); } };
    // 盒的面：角点局部坐标 L[k]，面内两轴 (a1, a2)；木纹轴 g = 盒最长边（在面内时），否则面内较长轴
    function box(m, u0, v0, z0, u1, v1, z1) { if (u1 - u0 < 1e-6 || v1 - v0 < 1e-6 || z1 - z0 < 1e-6) return; const L = [[u0, v0, z0], [u1, v0, z0], [u1, v1, z0], [u0, v1, z0], [u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1]], p = L.map(q => Pw(q[0], q[1], q[2])), D = [u1 - u0, v1 - v0, z1 - z0], g = D.indexOf(Math.max(...D)), nrm = NORM_UV.has(m), lo = [u0, v0, z0];
      const F6 = [[4, 5, 6, 7, 0, 1], [0, 3, 2, 1, 0, 1], [0, 1, 5, 4, 0, 2], [1, 2, 6, 5, 1, 2], [2, 3, 7, 6, 0, 2], [3, 0, 4, 7, 1, 2]];
      for (const [a, c, d, e, a1, a2] of F6) { let ga = g === a1 || g === a2 ? g : (D[a1] >= D[a2] ? a1 : a2); const oa = ga === a1 ? a2 : a1; if (nrm) ga = m === 'fusuma' && (a1 === 2 || a2 === 2) ? (a1 === 2 ? a2 : a1) : (D[a1] >= D[a2] ? a1 : a2); /* r16：襖的 u 恒为水平、v 恒为竖直（0 = 敷居，1 = 鴨居）→ 着色器按世界坐标接续画面 */
        const uvOf = k => nrm ? [(L[k][ga] - lo[ga]) / D[ga], (L[k][ga === a1 ? a2 : a1] - lo[ga === a1 ? a2 : a1]) / D[ga === a1 ? a2 : a1]] : [L[k][ga], L[k][oa]];
        const ua = [].concat(uvOf(a), uvOf(c), uvOf(d), uvOf(e)); quad(m, p[a], p[c], p[d], p[e], ua); } }
    // 斜放的盒：原点 o（局部 u,v,z）+ 三条边向量 A, B, C（A = 木纹方向）
    function obox(m, o, A, B, C) { const P = (x, y, z) => Pw(o[0] + A[0] * x + B[0] * y + C[0] * z, o[1] + A[1] * x + B[1] * y + C[1] * z, o[2] + A[2] * x + B[2] * y + C[2] * z), la = Math.hypot(...A), lb = Math.hypot(...B), lc = Math.hypot(...C);
      const c = [P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0), P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1)], uv = (x0, y0, x1, y1, x2, y2, x3, y3) => [x0, y0, x1, y1, x2, y2, x3, y3];
      // 体积为正的绕向：按 (A×B)·C 符号决定
      const cr = [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]], sg = cr[0] * C[0] + cr[1] * C[1] + cr[2] * C[2] >= 0, q = (a, b2, c2, d, u) => sg ? quad(m, c[a], c[b2], c[c2], c[d], u) : quad(m, c[d], c[c2], c[b2], c[a], u && [u[6], u[7], u[4], u[5], u[2], u[3], u[0], u[1]]);
      q(4, 5, 6, 7, uv(0, 0, la, 0, la, lb, 0, lb)); q(0, 3, 2, 1, uv(0, 0, 0, lb, la, lb, la, 0)); q(0, 1, 5, 4, uv(0, 0, la, 0, la, lc, 0, lc)); q(1, 2, 6, 5, uv(0, 0, lb, 0, lb, lc, 0, lc)); q(2, 3, 7, 6, uv(la, 0, 0, 0, 0, lc, la, lc)); q(3, 0, 4, 7, uv(lb, 0, 0, 0, 0, lc, lb, lc)); }
    // 带异形开口的薄板（双面）：墙面坐标 (s, z)，外框矩形 R = [s0, z0, s1, z1]，开口多边形 H（逆时针、对中心 c 星形）；pt(s, z) → 局部 [u, v, z]
    function plate(m, R, H, c, pt) { const n = H.length, Q = [], E = []; for (let k = 0; k < n; k++) { const dx = H[k][0] - c[0], dz = H[k][1] - c[1]; let t = 1e9, e = -1; if (dx > 1e-9) { const tt = (R[2] - c[0]) / dx; if (tt < t) { t = tt; e = 0; } } if (dx < -1e-9) { const tt = (R[0] - c[0]) / dx; if (tt < t) { t = tt; e = 2; } } if (dz > 1e-9) { const tt = (R[3] - c[1]) / dz; if (tt < t) { t = tt; e = 1; } } if (dz < -1e-9) { const tt = (R[1] - c[1]) / dz; if (tt < t) { t = tt; e = 3; } } Q.push([c[0] + dx * t, c[1] + dz * t]); E.push(e); }
      const corner = [[R[2], R[3]], [R[0], R[3]], [R[0], R[1]], [R[2], R[1]]], W = q => { const l = pt(q[0], q[1]); return Pw(l[0], l[1], l[2]); }, T2 = (a, c2, d) => { tri(m, W(a), W(c2), W(d)); tri(m, W(a), W(d), W(c2)); };
      for (let k = 0; k < n; k++) { const k2 = (k + 1) % n; T2(H[k], Q[k], Q[k2]); T2(H[k], Q[k2], H[k2]); if (E[k] !== E[k2]) { let e = E[k]; let guard = 0; let prev = Q[k]; while (e !== E[k2] && guard++ < 4) { const cc = corner[e]; T2(prev, cc, Q[k2]); prev = cc; e = (e + 1) % 4; } } } }
    // 入母屋（近似）：檐口矩形 → 长屋脊（寄棟下半）+ 两端竖直山花三角（妻）；ridge 长 = (长 − 短) + 0.45·短
    function irimoya(mt, r, zE, ov, pitch, ovs) { const o4 = ovs || [ov, ov, ov, ov], u0 = U(b, r[0]) - o4[0], u1 = U(b, r[2]) + o4[1], v0 = V(b, r[1]) - o4[2], v1 = V(b, r[3]) + o4[3], W2 = (u1 - u0) / 2, D2 = (v1 - v0) / 2, cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, longU = W2 >= D2, S2 = Math.min(W2, D2), Lh = Math.max(W2, D2), rise = S2 * pitch, zR = zE + rise, rr = (Lh - S2) + S2 * 0.45;
      const P = (a, c, z) => longU ? Pw(cu + a, cv + c, z) : Pw(cu + c, cv + a, z), e0 = P(-Lh, -S2, zE), e1 = P(Lh, -S2, zE), e2 = P(Lh, S2, zE), e3 = P(-Lh, S2, zE), ra = P(-rr, 0, zR), rb = P(rr, 0, zR);
      if (longU) { quad(mt, e0, e1, rb, ra); quad(mt, e2, e3, ra, rb); tri(mt, e1, e2, rb); tri(mt, e3, e0, ra); } else { quad(mt, e1, e0, ra, rb); quad(mt, e3, e2, rb, ra); tri(mt, e2, e1, rb); tri(mt, e0, e3, ra); }
      quad(mt, e3, e2, e1, e0); // 檐底
      const g = S2 * (1 - (Lh - rr) / Lh) * 0.5, zg = zR - g * pitch * S2 / S2; // 山花：在 ±rr 处的竖直三角
      for (const sd of [-1, 1]) { const a = P(sd * rr, -g, zR - g * (rise / S2)), c = P(sd * rr, g, zR - g * (rise / S2)), d = P(sd * rr, 0, zR); tri('plaster', a, c, d); tri('plaster', c, a, d); }
      ridge(P(-rr, 0, zR), P(rr, 0, zR)); }
    function ridge(a, c) { const dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L * 0.22, ny = dx / L * 0.22, z0 = a[2] - 0.1, z1 = a[2] + 0.35, q = [[a[0] - nx, a[1] - ny, z0], [c[0] - nx, c[1] - ny, z0], [c[0] + nx, c[1] + ny, z0], [a[0] + nx, a[1] + ny, z0]], t = q.map(p => [p[0], p[1], z1]);
      quad('ridge', t[0], t[1], t[2], t[3]); quad('ridge', q[0], q[1], t[1], t[0]); quad('ridge', q[1], q[2], t[2], t[1]); quad('ridge', q[2], q[3], t[3], t[2]); quad('ridge', q[3], q[0], t[0], t[3]); }
    // 切妻：屋脊沿长边；端头出檐 oe（贴着别的殿舍时为 0）
    function kirizuma(mt, r, zE, ov, pitch, oe) { const longU = (r[2] - r[0]) >= (r[3] - r[1]), u0 = U(b, r[0]), u1 = U(b, r[2]), v0 = V(b, r[1]), v1 = V(b, r[3]);
      const [a0, a1, c0, c1] = longU ? [u0 - oe, u1 + oe, v0 - ov, v1 + ov] : [v0 - oe, v1 + oe, u0 - ov, u1 + ov], cm = (c0 + c1) / 2, half = (c1 - c0) / 2, zR = zE + half * pitch, P = (a, c, z) => longU ? Pw(a, c, z) : Pw(c, a, z);
      quad(mt, P(a0, c0, zE), P(a1, c0, zE), P(a1, cm, zR), P(a0, cm, zR)); quad(mt, P(a1, c1, zE), P(a0, c1, zE), P(a0, cm, zR), P(a1, cm, zR)); quad(mt, P(a0, c1, zE), P(a1, c1, zE), P(a1, c0, zE), P(a0, c0, zE));
      const w0 = longU ? [u0, u1] : [v0, v1], cw0 = longU ? [v0, v1] : [u0, u1]; for (const a of w0) { tri('plaster', P(a, cw0[0], zE), P(a, cw0[1], zE), P(a, cm, zR - 0.05)); tri('plaster', P(a, cw0[1], zE), P(a, cw0[0], zE), P(a, cm, zR - 0.05)); }
      ridge(P(a0, cm, zR), P(a1, cm, zR)); }
    // 腰屋根：下层墙顶（檐口外扩 ov）→ 上层墙面（内收后的矩形），四个梯形
    function koshi(mt, r, r2, zE, ov, pitch) { const o = [U(b, r[0]) - ov, V(b, r[1]) - ov, U(b, r[2]) + ov, V(b, r[3]) + ov], dist = Math.max(0.3, Math.min(U(b, r2[0]) - o[0], o[2] - U(b, r2[2]), V(b, r2[1]) - o[1], o[3] - V(b, r2[3]))), zI = zE + dist * pitch, i = [U(b, r2[0]), V(b, r2[1]), U(b, r2[2]), V(b, r2[3])];
      const E = [Pw(o[0], o[1], zE), Pw(o[2], o[1], zE), Pw(o[2], o[3], zE), Pw(o[0], o[3], zE)], I = [Pw(i[0], i[1], zI), Pw(i[2], i[1], zI), Pw(i[2], i[3], zI), Pw(i[0], i[3], zI)];
      for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; quad(mt, E[k], E[k2], I[k2], I[k]); }
      // 檐底：只铺墙外的一圈（B3：以前整块铺满，楼板洞/階段口往下看会看到一层瓦面）
      const w0 = [U(b, r[0]), V(b, r[1]), U(b, r[2]), V(b, r[3])], Wl = [Pw(w0[0], w0[1], zE), Pw(w0[2], w0[1], zE), Pw(w0[2], w0[3], zE), Pw(w0[0], w0[3], zE)]; for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; quad(mt, E[k2], E[k], Wl[k], Wl[k2]); } return zI; }
    return { box, obox, plate, tri, quad, irimoya, kirizuma, koshi, Pw };
  }
  const blkH = (b, F, q) => { if (!b.blocks.length || !F.bk) return F.h; const k = F.bk[q]; return k >= 0 && b.blocks[k].h ? b.blocks[k].h : F.h; };
  // 外墙边列表：[{f, side, i, j, q}]，按（side, 线坐标）分组成连续段
  function wallRuns(b, f) { const F = b.F[f], runs = new Map(); for (let j = 0; j < b.nv; j++) for (let i = 0; i < b.nu; i++) { const q = j * b.nu + i; if (!INSIDE(F.a[q])) continue; for (let sd = 0; sd < 4; sd++) { const [di, dj] = NB[sd]; if (INSIDE(at(b, F, i + di, j + dj))) continue; const line = sd < 2 ? i : j, s = sd < 2 ? j : i, k = sd + ':' + line; if (!runs.has(k)) runs.set(k, []); runs.get(k).push(s); } }
    const out = []; for (const [k, L] of runs) { const [sd, line] = k.split(':').map(Number); L.sort((a, c) => a - c); let s0 = L[0], pv = L[0]; for (let t = 1; t <= L.length; t++) { if (t < L.length && L[t] === pv + 1) { pv = L[t]; continue; } out.push({ f, sd, line, s0, s1: pv + 1 }); if (t < L.length) { s0 = pv = L[t]; } } } return out; }
  // 开口在格边上的区间：[s0, s1)（沿边方向的格号）
  const openSpan = o => o.side < 2 ? [o.j, o.j + o.n] : [o.i, o.i + o.n];
  const openLine = o => o.side < 2 ? o.i : o.j;
  // 局部坐标里一条外墙边的矩形（外表面在格边上，向内厚 t）：返回 [u0,v0,u1,v1]（s 区间 [a, c) 格）
  function wallRect(b, sd, line, a, c, t, out0) { const o = out0 || 0; if (sd === 0) return [U(b, line + 1) - t, V(b, a), U(b, line + 1) + o, V(b, c)]; if (sd === 1) return [U(b, line) - o, V(b, a), U(b, line) + t, V(b, c)]; if (sd === 2) return [U(b, a), V(b, line + 1) - t, U(b, c), V(b, line + 1) + o]; return [U(b, a), V(b, line) - o, U(b, c), V(b, line) + t]; }
  // B3：墙面坐标 → 局部盒。s = 沿墙方向的局部坐标（m），d = 从外表面向内的深度（m，负 = 墙外），z 绝对
  function outerOf(b, sd, line) { return sd === 0 ? U(b, line + 1) : sd === 1 ? U(b, line) : sd === 2 ? V(b, line + 1) : V(b, line); }
  function fb(b, sd, line, s0, s1, d0, d1, z0, z1) { const o = outerOf(b, sd, line); if (sd === 0) return [o - d1, s0, z0, o - d0, s1, z1]; if (sd === 1) return [o + d0, s0, z0, o + d1, s1, z1]; if (sd === 2) return [s0, o - d1, z0, s1, o - d0, z1]; return [s0, o + d0, z0, s1, o + d1, z1]; }
  const fb6 = x => [x[0], x[1], x[2], x[3], x[4], x[5]];
  const wpt = (b, sd, line) => { const o = outerOf(b, sd, line); return (s2, d, z) => sd === 0 ? [o - d, s2, z] : sd === 1 ? [o + d, s2, z] : sd === 2 ? [s2, o - d, z] : [s2, o + d, z]; };
  const wvec = sd => (ds, dd, dz) => sd === 0 ? [-dd, ds, dz] : sd === 1 ? [dd, ds, dz] : sd === 2 ? [ds, -dd, dz] : [ds, dd, dz];
  // 开口的洞口（墙面坐标）：窓/障子/狭間 按类型定宽高；居中在开口所占的 1 間里
  function apertureOf(b, o) { const F = b.F[o.f], sd = o.side, line = openLine(o), [a, c] = openSpan(o), S = k => sd < 2 ? V(b, k) : U(b, k), sc = (S(a) + S(c)) / 2, W0 = SPEC.win, t = SPEC.wallT;
    if (o.kind === 'akari') return { sd, line, t, s0: S(a) + 0.06, s1: S(c) - 0.06, z0: F.z, z1: F.z + SPEC.door.h, sc };
    if (o.kind === 'hazama') { const h = W0.hazama.s / 2, zc = F.z + W0.hazama.z; return { sd, line, t, s0: sc - h, s1: sc + h, z0: zc - h, z1: zc + h, sc }; }
    const d = o.wt === 'kato' ? W0.kato : W0, z0 = F.z + d.sill; return { sd, line, t, s0: sc - d.w / 2, s1: sc + d.w / 2, z0, z1: z0 + d.h, sc }; }
  // 窓组件：返回 { ap, parts: [{ m, b（局部盒）, tag, solid } | { m, ob: [o, A, B, C], tag } | { m, plate, tag }] }
  function winAsm(b, o, F) { const ap = apertureOf(b, o), { sd, line, t, s0, s1, z0, z1, sc } = ap, P = [], W0 = SPEC.win, Kb = W0.koshi, pt = wpt(b, sd, line), vec = wvec(sd), yag = b.type === 'yagura';
    const box = (m, a, c, d0, d1, za, zc, tag, solid) => P.push({ m, b: fb(b, sd, line, a, c, d0, d1, za, zc), tag, solid });
    if (o.kind === 'hazama') { const cs = W0.hazama.skin, m2 = 0.06; box('plaster', s0 - 0.01, s1 + 0.01, 0, 0.01, z0 - 0.01, z1 + 0.01, 'skin', true); box('hazama', s0 - 0.01, s1 + 0.01, 0.01, cs, z0 - 0.01, z1 + 0.01, 'skin', true); // 隠狭間：外面灰泥封皮（与墙面同色，从外看不见）、里侧是封皮背面（暗色，从室内看得出口形）（实测：大坂城现存橹的狭間为隠狭間）
      const zc = (z0 + z1) / 2, H = []; if (o.shape === 'maru') for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; H.push([sc + 0.09 * Math.cos(a), zc + 0.09 * Math.sin(a)]); } else if (o.shape === 'sankaku') H.push([sc + 0.1, zc - 0.07], [sc, zc + 0.1], [sc - 0.1, zc - 0.07]); else H.push([sc + 0.075, zc - 0.075], [sc + 0.075, zc + 0.075], [sc - 0.075, zc + 0.075], [sc - 0.075, zc - 0.075]);
      P.push({ m: 'plaster', plate: { R: [s0 - m2, z0 - m2, s1 + m2, z1 + m2], H, c: [sc, zc], pt: (q, z) => pt(q, t + 0.006, z), d: t + 0.006 }, tag: 'hazama-plate' }); return { ap, parts: P }; }
    if (o.kind === 'akari') { const hw = (s1 - s0) / 2, left = (o.i + o.j) % 2 === 0; box('wood', s0 - 0.06, s1 + 0.06, -0.01, t + 0.01, z0 - 0.04, z0 + 0.03, 'sill', true); box('wood', s0 - 0.06, s1 + 0.06, -0.01, t + 0.01, z1 - 0.06, z1, 'kamoi', true);
      const pa = left ? [s0, s0 + hw + 0.03] : [s1 - hw - 0.03, s1]; box('shoji', pa[0], pa[1], 0.05, 0.08, z0 + 0.03, z1 - 0.06, 'shoji', true); box('shoji', pa[0], pa[1], t - 0.08, t - 0.05, z0 + 0.03, z1 - 0.06, 'shoji', true); return { ap, parts: P }; } // 引違い 两扇都推到一侧 = 半开
    // 格子窓（橹：塗籠格子；番所：木格子）
    box('wood', s0 - 0.04, s1 + 0.04, -0.02, t + 0.02, z0, z0 + 0.045, 'sill', true); box('wood', s0 - 0.04, s1 + 0.04, -0.02, t + 0.02, z1 - 0.05, z1, 'kamoi', true);
    const n = Math.max(3, Math.floor((s1 - s0) / Kb.pitch + 1e-9)), p = (s1 - s0) / n, bm = yag ? 'plaster' : 'wood';
    for (let k = 0; k < n; k++) { const c = s0 + p * (k + 0.5); box(bm, c - Kb.bar / 2, c + Kb.bar / 2, t / 2 - Kb.depth / 2, t / 2 + Kb.depth / 2, z0 + 0.045, z1 - 0.05, 'bar', true); }
    if (o.wt === 'kato') { const w = s1 - s0, H0 = z1 - z0, hw = w / 2, y1 = 0.55 * H0, Hs = []; Hs.push([sc + hw, z0]); for (let k = 0; k <= 16; k++) { const x = hw * (1 - k / 16), y = y1 + (H0 - y1) * (1 - Math.pow(x / hw, 1.8)) + 0.05 * H0 * Math.sin(Math.PI * x / hw); Hs.push([sc + x, z0 + Math.min(H0, y)]); } for (let k = 15; k >= 0; k--) { const q = Hs[k + 1]; Hs.push([2 * sc - q[0], q[1]]); } Hs.push([sc - hw, z0]);
      const H = Hs.filter((q, k) => k === 0 || Math.hypot(q[0] - Hs[k - 1][0], q[1] - Hs[k - 1][1]) > 1e-6); for (const d of [-0.012, t + 0.012]) P.push({ m: 'wood', plate: { R: [s0 - 0.1, z0 - 0.08, s1 + 0.1, z1 + 0.1], H, c: [sc, z0 + 0.4 * H0], pt: (q, z) => pt(q, d, z), d }, tag: 'kato' }); }
    if (o.slide) { const w = s1 - s0, pa = o.slide > 0 ? [s1 - 0.05, s1 - 0.05 + w + 0.1] : [s0 + 0.05 - w - 0.1, s0 + 0.05], T = W0.doto; // 土戸（引戸）：滑开到相邻一間的墙前
      box('plaster', pa[0], pa[1], -0.04 - T, -0.04, z0 - 0.08, z1 + 0.08, 'shutter', true); const ra = Math.min(s0, pa[0]) - 0.03, rb = Math.max(s1, pa[1]) + 0.03; box('plaster', ra, rb, -0.15, 0, z1 + 0.08, z1 + 0.14, 'rail', true); box('plaster', ra, rb, -0.15, 0, z0 - 0.14, z0 - 0.08, 'rail', true); }
    if (o.wt === 'tsuki') { const a = W0.tsuki, L = (z1 - z0) + 0.15, hz = z1 + 0.06, w0 = s0 - 0.05, w1 = s1 + 0.05, Bv = vec(0, -Math.sin(a) * L, -Math.cos(a) * L), Cv = vec(0, -0.03 * Math.cos(a), 0.03 * Math.sin(a)); // 突上戸：上端铰接、向外撑开 a rad
      const ex = -0.02 - Math.sin(a) * L, ez = hz - Math.cos(a) * L; P.push({ m: 'wood', ob: [pt(w0, -0.02, hz), vec(w1 - w0, 0, 0), Bv, Cv], tag: 'tsukiage', hull: fb(b, sd, line, w0, w1, ex - 0.03, 0, ez, hz + 0.03) });
      const sm = (s0 + s1) / 2, st0 = pt(sm - 0.015, -0.04, z0 - 0.02), sv = vec(0, ex + 0.04 + 0.02, ez - z0 + 0.02); const dd = ex + 0.06, dz = ez - z0 + 0.02, ln = Math.hypot(dd, dz) || 1; P.push({ m: 'wood', ob: [st0, sv, vec(0.03, 0, 0), vec(0, -dz / ln * 0.03, dd / ln * 0.03)], tag: 'prop' }); }
    return { ap, parts: P }; }
  function exterior(b, opt) { // → { lod0: acc, hull: acc, boxes: [局部盒（外壳，室内相机也用）] }；opt.hullOnly：只出外壳（首帧用，细节在首帧后补）
    const HO = !!(opt && opt.hullOnly), L0 = HO ? { acc: {}, put() {} } : Acc(true), H = Acc(), P0 = mkPrims(b, L0), PH = mkPrims(b, H), boxes = [], wins = [], wa = [], t = SPEC.wallT, DH = SPEC.door.h, gt = b.type === 'goten';
    const addBox = (m, bx, solid, hull, tag, o) => { P0.box(m, bx[0], bx[1], bx[2], bx[3], bx[4], bx[5]); if (solid) boxes.push({ m, b: bx, tag, o }); if (hull) PH.box('plaster', bx[0] - 0.06, bx[1] - 0.06, bx[2], bx[3] + 0.06, bx[4] + 0.06, bx[5]); };
    const F0 = b.F[0], zb = b.zg.min - 0.3;
    // 基础（石垣台/礎石）：一层格的矩形分解
    const comps0 = b.blocks.length ? b.blocks.map(k => k.r) : rects(F0.a, b.nu, b.nv, INSIDE);
    for (const r of comps0) addBox('stone', [U(b, r[0]), V(b, r[1]), zb, U(b, r[2]), V(b, r[3]), F0.z - (gt ? 0.25 : 0.05)], true, true, 'plinth'); // 台面低于室内地板面层（不共面，免 z-fighting）
    if (gt) for (const r of comps0) addBox('wood', [U(b, r[0]) + 0.05, V(b, r[1]) + 0.05, F0.z - 0.25, U(b, r[2]) - 0.05, V(b, r[3]) - 0.05, F0.z - 0.05], true, false, 'plinth');
    b.F.forEach((F, f) => {
      const runs = wallRuns(b, f), ops = b.open.filter(o => o.f === f && (o.kind === 'door' || o.kind === 'window' || o.kind === 'akari' || o.kind === 'ishi' || o.kind === 'hazama'));
      for (const R of runs) {
        const mine = ops.filter(o => o.side === R.sd && openLine(o) === R.line); const hOf = s => { const i = R.sd < 2 ? R.line : s, j = R.sd < 2 ? s : R.line; return blkH(b, F, j * b.nu + i); };
        // B3：墙 = 整段墙减去开口洞（门 / 窓 / 障子 / 狭間 都是真洞，墙厚 = 洞的见込み），同高、同洞集合的相邻段合并
        const S = k => R.sd < 2 ? V(b, k) : U(b, k), zb = F.z - (f === 0 ? 0.05 : 0), holes = []; if (!HO) {
        for (const o of mine) { if (o.kind === 'ishi') continue; if (o.kind === 'door') { const [a, c] = openSpan(o); holes.push({ s0: S(a), s1: S(c), z0: zb - 1, z1: F.z + DH, o }); continue; } const ap = apertureOf(b, o); holes.push({ s0: ap.s0, s1: ap.s1, z0: ap.z0, z1: ap.z1, o }); }
        const cuts = new Set([S(R.s0), S(R.s1)]); for (let k = R.s0 + 1; k < R.s1; k++) if (hOf(k) !== hOf(k - 1)) cuts.add(S(k)); for (const h of holes) { cuts.add(h.s0); cuts.add(h.s1); }
        const lo = S(R.s0), hi = S(R.s1), cs = [...cuts].filter(x => x >= lo - 1e-9 && x <= hi + 1e-9).sort((x, y) => x - y), segs = [];
        for (let k = 0; k + 1 < cs.length; k++) { const a = cs[k], c = cs[k + 1]; if (c - a < 1e-6) continue; const m = (a + c) / 2, cell = Math.floor((m - S(0)) / b.cs + 1e-9), hs = holes.filter(h => h.s0 < m && h.s1 > m), key = hOf(Math.min(R.s1 - 1, Math.max(R.s0, cell))) + '|' + hs.map(h => holes.indexOf(h)).join(','); const L = segs[segs.length - 1]; if (L && L.key === key && Math.abs(L.c - a) < 1e-9) L.c = c; else segs.push({ a, c, key, hs, h: hOf(Math.min(R.s1 - 1, Math.max(R.s0, cell))) }); }
        for (const sg of segs) { const zt = F.z + sg.h, iv = []; let z = zb; for (const h of sg.hs.slice().sort((x, y) => x.z0 - y.z0)) { if (h.z0 > z + 1e-6) iv.push([z, Math.min(h.z0, zt)]); z = Math.max(z, h.z1); } if (zt > z + 1e-6) iv.push([z, zt]); sg.iv = iv; }
        // 接缝：相邻两段墙在同一 s 处对接会漏出发丝缝（栅格化裂缝，透出室内暗色）→ 较矮的一块（邻段整块盖住它的高度范围时）伸进邻段 SEAM，面内缩 1.5 mm 不共面；碰撞盒仍用原尺寸
        const SEAM = 0.015, cov = (sg, z0, z1) => sg && sg.iv.some(([a, c]) => a <= z0 + 1e-6 && c >= z1 - 1e-6), ext = (sg, z0, z1) => sg ? Math.max(...sg.iv.filter(([a, c]) => a <= z0 + 1e-6 && c >= z1 - 1e-6).map(([a, c]) => c - a)) : 0;
        segs.forEach((sg, k) => { const pv = segs[k - 1], nx = segs[k + 1];
          for (const [z0, z1] of sg.iv) { const door = sg.hs.some(h => h.o.kind === 'door') && z0 >= F.z + DH - 1e-6, tag = door ? 'lintel' : 'wall', hz = z1 - z0;
            const eL = pv && Math.abs(pv.c - sg.a) < 1e-9 && cov(pv, z0, z1) && (ext(pv, z0, z1) > hz + 1e-6 || Math.abs(ext(pv, z0, z1) - hz) < 1e-6) ? SEAM : 0;
            const eR = nx && Math.abs(nx.a - sg.c) < 1e-9 && cov(nx, z0, z1) && ext(nx, z0, z1) > hz + 1e-6 ? SEAM : 0, ins = eL || eR ? 0.0015 : 0;
            const put = (m, za, zc) => { const bx = fb(b, R.sd, R.line, sg.a, sg.c, 0, t, za, zc); boxes.push({ m, b: bx, tag }); P0.box(m, ...fb6(fb(b, R.sd, R.line, sg.a - eL, sg.c + eR, ins, t - ins, za, zc))); };
            if (gt && z0 < F.z + DH - 1e-6) { put('wood', z0, Math.min(z1, F.z + DH)); if (z1 > F.z + DH + 1e-6) put('plaster', F.z + DH, z1); }
            else put('plaster', z0, z1); } });
        if (gt) P0.box('wood', ...fb6(fb(b, R.sd, R.line, S(R.s0), S(R.s1), t, t + SPEC.nageshi.d, F.z + DH, F.z + DH + SPEC.nageshi.h))); } // 長押（内面）；HO（首帧只要外壳）跳过墙洞切分与窓组件
        // 窓组件（格子 / 土戸 / 突上戸 / 華頭 / 障子 / 狭間）：同一组件内外两面都看得见
        for (const o of mine) { if (o.kind === 'ishi') { if (openSpan(o)[0] < R.s0 || openSpan(o)[1] > R.s1) continue; const w = wallRect(b, R.sd, R.line, ...openSpan(o), -0.0, 0.55), bx = [w[0], w[1], F.z - 0.7, w[2], w[3], F.z + 1.3]; addBox('plaster', bx, true, true, 'ishi', o); const sp = openSpan(o), cap = wallRect(b, R.sd, R.line, sp[0] - 0.15, sp[1] + 0.15, -0.0, 0.75); P0.box('tile', cap[0], cap[1], F.z + 1.3, cap[2], cap[3], F.z + 1.45); PH.box('plaster', cap[0], cap[1], F.z + 1.3, cap[2], cap[3], F.z + 1.45); continue; }
          if (o.kind === 'door' || HO) continue; { const sp = openSpan(o); if (sp[0] < R.s0 || sp[1] > R.s1) continue; } const A0 = winAsm(b, o, F), rec = { o, ap: A0.ap, parts: [] };
          for (const q of A0.parts) { if (q.ob) { P0.obox(q.m, q.ob[0], q.ob[1], q.ob[2], q.ob[3]); rec.parts.push({ tag: q.tag, b: q.hull || null }); continue; } if (q.plate) { P0.plate(q.m, q.plate.R, q.plate.H, q.plate.c, q.plate.pt); rec.parts.push({ tag: q.tag, plate: q.plate.d }); continue; } if (q.solid) addBox(q.m, q.b, true, false, q.tag, o); else P0.box(q.m, ...fb6(q.b)); rec.parts.push({ tag: q.tag, b: q.b }); }
          wa.push(rec); wins.push({ o }); }
        // 门外踏石（地面 → 地板下 0.2 m），门格外一格
        for (const o of mine) if (o.kind === 'door' && f === 0) { const [a, c] = openSpan(o), w = wallRect(b, R.sd, R.line, a, c, -0.0, CS); const zl = b.zg.min - 0.3, top = F.z - Math.min(0.45, Math.max(0.15, (F.z - b.zg.max) / 2)); if (top > zl + 0.05) addBox('stone', [w[0], w[1], zl, w[2], w[3], top], true, true, 'step-out'); }
      }
      // 柱（御殿外墙每間一根，外露 4 cm）
      if (gt) for (const R of runs) for (let s = R.s0; s <= R.s1; s += 2) { const w = wallRect(b, R.sd, R.line, s, s, t, 0.04); const c = R.sd < 2 ? [w[0], V(b, s) - 0.12, w[2], V(b, s) + 0.12] : [U(b, s) - 0.12, w[1], U(b, s) + 0.12, w[3]]; const i = R.sd < 2 ? R.line : Math.min(s, R.s1 - 1), j = R.sd < 2 ? Math.min(s, R.s1 - 1) : R.line; P0.box('wood', c[0], c[1], F.z, c[2], c[3], F.z + blkH(b, F, j * b.nu + i)); }
      // 外壳：每层按矩形分解（御殿按殿舍块，各自墙高）
      const comps = b.blocks.length ? b.blocks.map((k, bi) => ({ r: k.r, h: k.h || F.h })) : rects(F.a, b.nu, b.nv, INSIDE).map(r => ({ r, h: F.h }));
      for (const c of comps) PH.box('plaster', U(b, c.r[0]) - 0.06, V(b, c.r[1]) - 0.06, F.z - (f ? 0.3 : 0), U(b, c.r[2]) + 0.06, V(b, c.r[3]) + 0.06, F.z + c.h);
      // 不同高的殿舍块相接处：低块墙顶以上补墙（外观连续）
      if (b.blocks.length) for (let j = 0; j < b.nv; j++) for (let i = 0; i < b.nu; i++) { const q = j * b.nu + i; if (!INSIDE(F.a[q])) continue; for (const sd of [0, 2]) { const [di, dj] = NB[sd], i2 = i + di, j2 = j + dj; if (i2 >= b.nu || j2 >= b.nv) continue; const q2 = j2 * b.nu + i2; if (!INSIDE(F.a[q2]) || F.bk[q] === F.bk[q2]) continue; const h1 = blkH(b, F, q), h2 = blkH(b, F, q2); if (Math.abs(h1 - h2) < 1e-6) continue; const lo = Math.min(h1, h2), hi = Math.max(h1, h2), w = wallRect(b, sd, sd < 2 ? i : j, sd < 2 ? j : i, (sd < 2 ? j : i) + 1, t / 2, t / 2); addBox('plaster', [w[0], w[1], F.z + lo, w[2], w[3], F.z + hi], true, false, 'joint'); } }
    });
    // 土塀续接（局部坐标里是斜放的墙：按 site 的土塀同样的盒画）
    for (const w of (b.wext || [])) { const [ua, va] = b.fr.l(w.x0, w.y0), [uc, vc] = b.fr.l(w.x1, w.y1), L = Math.hypot(uc - ua, vc - va), nx = -(vc - va) / L * w.t / 2, ny = (uc - ua) / L * w.t / 2;
      const q = [[ua - nx, va - ny], [uc - nx, vc - ny], [uc + nx, vc + ny], [ua + nx, va + ny]], z0 = w.z - 0.3, z1 = w.z + w.h; for (const [P, m] of [[P0, 'plaster'], [PH, 'plaster']]) { const lo = q.map(p => P.Pw(p[0], p[1], z0)), hi = q.map(p => P.Pw(p[0], p[1], z1)); P.quad(m, hi[0], hi[1], hi[2], hi[3]); for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; P.quad(m, lo[k], lo[k2], hi[k2], hi[k]); } }
      const cap = q.map(p => P0.Pw(p[0] * 1, p[1], z1)); P0.quad('tile', ...cap.map(c => [c[0], c[1], c[2] + 0.12])); }
    // 屋顶（外观与外壳同一组三角形）
    for (const R of b.roofs) { const F = b.F[R.f], h = R.h || (b.blocks.length ? (b.blocks.find(k => k.r === R.r) || {}).h || F.h : F.h), zE = F.z + h + 0.1;
      for (const P of [P0, PH]) { if (R.kind === 'irimoya') P.irimoya('tile', R.r, zE, R.ov, R.pitch, R.ovs); else if (R.kind === 'kirizuma') P.kirizuma('tile', R.r, zE, R.ov, R.pitch, R.oe !== undefined ? R.oe : R.ov); else if (R.kind === 'koshi') { const r2 = rectOf(b.F[R.f + 1].a.map(INSIDE), b.nu, b.nv); P.koshi('tile', R.r, r2, zE, R.ov, R.pitch); } } }
    return { lod0: L0.acc, hull: H.acc, boxes, wins, wa };
  }


  // ---------------- 内部（按需生成）：地板/畳/天井/隔断/柱/階段/室内窗/装置；碰撞盒 = 外壳盒 + 内部实心盒 ----------------
  const PASS_KINDS = new Set(['fusuma', 'itado', 'shoji', 'door']);
  function openEdgeSet(b) { const S = new Set(); for (const o of b.open) { if (!PASS_KINDS.has(o.kind)) continue; for (let k = 0; k < o.n; k++) { const i = o.side < 2 ? o.i : o.i + k, j = o.side < 2 ? o.j + k : o.j; S.add(edgeKey(o.f, i, j, o.side)); } } return S; }
  // 格边键：统一成“较小格 + 方向 u/v”
  function edgeKey(f, i, j, side) { if (side === 1) return f + ':u:' + i + ':' + j; if (side === 0) return f + ':u:' + (i + 1) + ':' + j; if (side === 3) return f + ':v:' + i + ':' + j; return f + ':v:' + i + ':' + (j + 1); }
  const label = (b, F, i, j) => { const a = at(b, F, i, j); return INSIDE(a) ? F.r[j * b.nu + i] : -1; }; // 楼板洞（VOID）保留原房间号：洞只是房间地板上的开口
  // 柱：格点四周格的标签（房间号/外部）不全相同 = 在墙/隔断线上；間格点（偶数）或转角/丁字点立柱；门/开口跨度内的点、階段/楼板洞旁的点不立
  function columnsOf(b, f) {
    const F = b.F[f], out = [], oe = openEdgeSet(b);
    for (let j = 0; j <= b.nv; j++) for (let i = 0; i <= b.nu; i++) {
      const tl = label(b, F, i - 1, j), tr = label(b, F, i, j), bl = label(b, F, i - 1, j - 1), br = label(b, F, i, j - 1); // 上 = j，下 = j−1（v 方向）
      if (tl < 0 && tr < 0 && bl < 0 && br < 0) continue; if (tl === tr && tr === bl && bl === br) continue;
      let ns = 0, nv0 = 0, hole = false; for (const [ii, jj] of [[i - 1, j], [i, j], [i - 1, j - 1], [i, j - 1]]) { const a = at(b, F, ii, jj); if (a === A.STAIR) ns++; if (a === A.VOID) nv0++; if (a === A.ISHI) hole = true; } if (hole || ns === 4 || nv0 === 4) continue; // 楼板洞（梯段上方，由梁框住）与石落し 旁、梯段内部不立柱
      const straightV = tl === bl && tr === br && tl !== tr, straightU = tl === tr && bl === br && tl !== bl, ken = i % 2 === 0 && j % 2 === 0;
      if ((straightV || straightU) && !ken) continue;
      // 开口跨度内（点两侧的边都开着）不立
      if (straightV && oe.has(f + ':u:' + i + ':' + j) && oe.has(f + ':u:' + i + ':' + (j - 1))) continue;
      if (straightU && oe.has(f + ':v:' + i + ':' + j) && oe.has(f + ':v:' + (i - 1) + ':' + j)) continue;
      // 门（外墙）跨度内
      out.push([i, j]);
    }
    return out;
  }
  // 两格之间没有墙/隔断：两格都可走，且同一房间，或橹的入側↔身舎（只有梁，没有隔断）
  // 階段口边：口内格（VOID，房间号 = 原房间）与邻格之间没有墙/隔断，且邻格可走
  function wellNb(b, F2, i, j, i2, j2) { const a2 = at(b, F2, i2, j2); if (!(a2 === A.ROOM || a2 === A.IRI)) return false; const r = F2.r[j * b.nu + i], r2 = F2.r[j2 * b.nu + i2]; return r === r2 || b.type === 'yagura'; }
  function noWall(b, F, i, j, i2, j2) { const a = at(b, F, i, j), a2 = at(b, F, i2, j2), wk = x => x === A.ROOM || x === A.IRI || x === A.STAIR; if (!wk(a) || !wk(a2)) return false; const r = F.r[j * b.nu + i], r2 = F.r[j2 * b.nu + i2]; return r === r2 || (b.type === 'yagura' && (a === A.IRI) !== (a2 === A.IRI)); }
  function interior(b) {
    const ACC = Acc(true), PR = mkPrims(b, ACC), boxes = [], wins = [], parts = [], t = SPEC.wallT, DH = SPEC.door.h, gt = b.type === 'goten', oe = openEdgeSet(b);
    const add = (m, bx, solid, tag) => { PR.box(m, bx[0], bx[1], bx[2], bx[3], bx[4], bx[5]); if (solid) boxes.push({ m, b: bx, tag }); return bx; };
    b.F.forEach((F, f) => {
      const up = b.F[f + 1], nu = b.nu;
      // 地板：楼板（结构）+ 面层（畳 / 板）；土間低 0.35 m；VOID/ISHI 不铺（开洞）
      const slabCell = a => a === A.ROOM || a === A.IRI || a === A.ROUKA || a === A.STAIR || a === A.TOKO;
      for (const r of rects(F.a, nu, b.nv, slabCell)) add('floorwood', [U(b, r[0]), V(b, r[1]), F.z - 0.25, U(b, r[2]), V(b, r[3]), F.z - 0.04], true, 'slab');
      for (const r of rects(F.a, nu, b.nv, a => a === A.DOMA)) add('doma', [U(b, r[0]), V(b, r[1]), b.zg.min - 0.3, U(b, r[2]), V(b, r[3]), F.z - 0.35], true, 'doma');
      for (const rm of b.rooms) { if (rm.f !== f) continue; const tat = rm.kind === 'tatami';
        // 面层：按房间的格（畳：2×1 格一张，沿长向排；其余：整块板）
        const cells = []; for (let j = rm.rect[1]; j < rm.rect[3]; j++) for (let i = rm.rect[0]; i < rm.rect[2]; i++) { const q = j * nu + i; if (F.r[q] === rm.id && (F.a[q] === A.ROOM || F.a[q] === A.IRI || F.a[q] === A.ROUKA)) cells.push([i, j]); }
        if (!tat) { const m = new Uint8Array(nu * b.nv); for (const [i, j] of cells) m[j * nu + i] = 1; for (const r of rects(m, nu, b.nv, x => x === 1)) add('floorwood', [U(b, r[0]), V(b, r[1]), F.z - 0.04, U(b, r[2]), V(b, r[3]), F.z], false); continue; }
        const used = new Set(), longU = (rm.rect[2] - rm.rect[0]) >= (rm.rect[3] - rm.rect[1]), g = 0.012;
        for (const [i, j] of cells) { const k = i + ',' + j; if (used.has(k)) continue; const i2 = longU ? i + 1 : i, j2 = longU ? j : j + 1, ok = cells.some(c => c[0] === i2 && c[1] === j2) && !used.has(i2 + ',' + j2) && ((longU ? (i - rm.rect[0] + (j - rm.rect[1]) % 2) : (j - rm.rect[1] + (i - rm.rect[0]) % 2)) % 2 === 0);
          used.add(k); if (ok) used.add(i2 + ',' + j2); const iE = ok ? i2 + 1 : i + 1, jE = ok ? j2 + 1 : j + 1; add('tatami', [U(b, i) + g, V(b, j) + g, F.z - 0.04, U(b, iE) - g, V(b, jE) - g, F.z], false); }
        const m = new Uint8Array(nu * b.nv); for (const [i, j] of cells) m[j * nu + i] = 1; for (const r of rects(m, nu, b.nv, x => x === 1)) PR.box('heri', U(b, r[0]), V(b, r[1]), F.z - 0.045, U(b, r[2]), V(b, r[3]), F.z - 0.035);
      }
      // 天井：本层格（上层同格是楼板洞 VOID 的不铺）。材质按房间：上段 = 格天井（ceilK），畳间/内室 = 竿縁天井（ceilS），入側/廊下/武者走り = 板（ceil）——推定（書院造/橹的惯例；千贯橹内室 = 天井板張り）
      const hC = q => blkH(b, F, q), cmat = q => { const r = b.rooms[F.r[q]]; if (!r) return 'ceil'; if (r.jodan) return 'ceilK'; return r.kind === 'tatami' || r.kind === 'board' ? 'ceilS' : 'ceil'; };
      for (const cm of ['ceil', 'ceilS', 'ceilK']) { const m = new Uint8Array(nu * b.nv); for (let q = 0; q < m.length; q++) if (INSIDE(F.a[q]) && F.a[q] !== A.VOID && !(up && up.a[q] === A.VOID) && cmat(q) === cm) m[q] = 1;
        if (b.blocks.length) { for (const k of b.blocks) { const mm = new Uint8Array(nu * b.nv); for (let j = k.r[1]; j < k.r[3]; j++) for (let i = k.r[0]; i < k.r[2]; i++) mm[j * nu + i] = m[j * nu + i]; for (const r of rects(mm, nu, b.nv, x => x === 1)) add(cm, [U(b, r[0]), V(b, r[1]), F.z + k.h, U(b, r[2]), V(b, r[3]), F.z + k.h + 0.06], true, 'ceil'); } }
        else for (const r of rects(m, nu, b.nv, x => x === 1)) add(cm, [U(b, r[0]), V(b, r[1]), F.z + F.h, U(b, r[2]), V(b, r[3]), F.z + F.h + 0.06], true, 'ceil'); }
      // 橹 武者走り 露出木组：繋梁（外墙每間柱 → 跨过入側到身舎线）+ 根太（沿墙，间距 SPEC.beam.pitch）；梯段上方（上层 VOID）不设
      if (b.type === 'yagura') { const BM = SPEC.beam, zc = F.z + F.h, iri = (i, j) => at(b, F, i, j) === A.IRI && !(up && up.a[j * nu + i] === A.VOID);
        for (const R of wallRuns(b, f)) { const [di, dj] = NB[R.sd], inw = [-di, -dj];
          const depthAt = s2 => { let k = 0; for (;;) { const i = R.sd < 2 ? R.line + inw[0] * k : s2, j = R.sd < 2 ? s2 : R.line + inw[1] * k; if (!iri(i, j)) break; k++; } return k; };
          for (let s2 = R.s0 + (R.s0 % 2 ? 1 : 0); s2 <= R.s1; s2 += 2) { if (s2 === R.s0 || s2 === R.s1) continue; const k = Math.min(depthAt(s2 - 1), depthAt(s2)); if (k < 1) continue; const L = k * b.cs, sc = R.sd < 2 ? V(b, s2) : U(b, s2);
            add('beam', fb(b, R.sd, R.line, sc - BM.tie[0] / 2, sc + BM.tie[0] / 2, t, L, zc - BM.tie[1], zc), true, 'beam'); }
          for (let dd = BM.pitch; ; dd += BM.pitch) { const kc = Math.floor(dd / b.cs); let any = false, a0 = null; const flush = s3 => { if (a0 !== null) { const S0 = R.sd < 2 ? V(b, a0) : U(b, a0), S1 = R.sd < 2 ? V(b, s3) : U(b, s3); PR.box('beam', ...fb6(fb(b, R.sd, R.line, S0, S1, dd - BM.joist[0] / 2, dd + BM.joist[0] / 2, zc - BM.joist[1], zc))); } a0 = null; };
            for (let s3 = R.s0; s3 < R.s1; s3++) { const i = R.sd < 2 ? R.line + inw[0] * kc : s3, j = R.sd < 2 ? s3 : R.line + inw[1] * kc, ok = depthAt(s3) * b.cs > dd + 0.1; if (ok) { any = true; if (a0 === null) a0 = s3; } else flush(s3); } flush(R.s1); if (!any) break; } } }
      // 隔断：两侧都在内、标签不同的格边；开口边 = 门洞（只画门楣以上）
      const th = gt ? 0.1 : 0.14;
      for (let j = 0; j < b.nv; j++) for (let i = 0; i < nu; i++) { const q = j * nu + i; const la = label(b, F, i, j); if (la < 0) continue;
        for (const sd of [0, 2]) { const [di, dj] = NB[sd], i2 = i + di, j2 = j + dj; if (i2 >= nu || j2 >= b.nv) continue; const lb = label(b, F, i2, j2); if (lb < 0 || lb === la) continue;
          const q2 = j2 * nu + i2, h = Math.min(hC(q), hC(q2)), open = oe.has(edgeKey(f, i, j, sd)), bx = sd === 0 ? [U(b, i + 1) - th / 2, V(b, j), U(b, i + 1) + th / 2, V(b, j + 1)] : [U(b, i), V(b, j + 1) - th / 2, U(b, i + 1), V(b, j + 1) + th / 2];
          const lowM = gt || b.type === 'bansho' ? 'fusuma' : 'wood', hiM = gt ? 'kabe' : 'wood';
          if (b.type === 'yagura' && ((F.a[q] === A.IRI) !== (F.a[q2] === A.IRI))) { add('wood', [bx[0], bx[1], F.z + h - 0.35, bx[2], bx[3], F.z + h], true, 'beam'); continue; } // 橹：入側与身舎之间不设隔断，只有柱 + 梁（武者走り对身舎敞开）
          if (!open) add(lowM, [bx[0], bx[1], F.z, bx[2], bx[3], F.z + DH], true, 'part');
          add(hiM, [bx[0], bx[1], F.z + DH, bx[2], bx[3], F.z + h], true, 'lintel');
          if (gt) { const nd = SPEC.nageshi.d, nh = SPEC.nageshi.h; PR.box('wood', sd === 0 ? bx[0] - nd : bx[0], sd === 0 ? bx[1] : bx[1] - nd, F.z + DH, sd === 0 ? bx[2] + nd : bx[2], sd === 0 ? bx[3] : bx[3] + nd, F.z + DH + nh); } } } // 長押（两面）
      // 柱
      for (const [i, j] of columnsOf(b, f)) { let h = 1e9; for (const [ii, jj] of [[i - 1, j], [i, j], [i - 1, j - 1], [i, j - 1]]) if (INSIDE(at(b, F, ii, jj))) h = Math.min(h, hC(jj * nu + ii)); add('wood', [U(b, i) - 0.11, V(b, j) - 0.11, F.z, U(b, i) + 0.11, V(b, j) + 0.11, F.z + h], true, 'col'); }
      // 室内侧的窓：组件在外观几何里（墙洞 + 格子/障子，内外同一组），这里只登记
      for (const o of b.open) if (o.f === f && (o.kind === 'window' || o.kind === 'akari')) wins.push({ o });
    });
    // 階段（B3）：踏板（实心，tag step，o = {st, k}）+ 两侧側桁（斜板）+ 开放侧手摺；上层階段口四周手摺（上楼的那一边除外），手摺带相机用的不可见挡板（tag rail）
    b.stairs.forEach((st, si) => { const F = b.F[st.f], F2 = b.F[st.f + 1], SS = SPEC.stair, n = Math.ceil(st.rise / SS.riserMax), rz = st.rise / n, [i0, j0, i1, j1] = st.rect, u0 = U(b, i0), u1 = U(b, i1), v0 = V(b, j0), v1 = V(b, j1), run = st.run, g = run / n, Wd = st.dir < 2 ? v1 - v0 : u1 - u0, sT = SS.stringer[0], sD = SS.stringer[1];
      const L = (x, y, z) => st.dir === 0 ? [u0 + x, v0 + y, z] : st.dir === 1 ? [u1 - x, v0 + y, z] : st.dir === 2 ? [u0 + y, v0 + x, z] : [u0 + y, v1 - x, z], Lv = (x, y, z) => st.dir === 0 ? [x, y, z] : st.dir === 1 ? [-x, y, z] : st.dir === 2 ? [y, x, z] : [y, -x, z];
      const bxL = (x0, x1, y0, y1, z0, z1) => { const a = L(x0, y0, z0), c = L(x1, y1, z1); return [Math.min(a[0], c[0]), Math.min(a[1], c[1]), z0, Math.max(a[0], c[0]), Math.max(a[1], c[1]), z1]; };
      for (let k = 0; k < n; k++) { const top = F.z + rz * (k + 1), bx = bxL(Math.max(0, k * g - (k ? SS.nosing : 0)), (k + 1) * g, sT, Wd - sT, top - SS.tread, top); PR.box('step', bx[0], bx[1], bx[2], bx[3], bx[4], bx[5]); boxes.push({ m: 'step', b: bx, tag: 'step', o: { st: si, k } }); }
      const sl = rz / g, zA = F.z + rz + 0.05 - sD, A = Lv(run - g, 0, (run - g) * sl);
      for (const y of [0, Wd - sT]) { const o = L(0, y, zA); PR.obox('wood', o, A, Lv(0, sT, 0), [0, 0, sD]); parts.push({ tag: 'stringer', o: { st: si }, b: bxL(0, run - g, y, y + sT, zA, zA + sD + (run - g) * sl) }); }
      // 开放侧：梯段侧边外一格是同房间可走格（不是外墙/隔断）→ 手摺（扶手 + 3 根立柱）
      const rid = F.r[st.bot[1] * b.nu + st.bot[0]], sideCells = sg => { const out = []; for (let k = 0; k < (st.dir < 2 ? i1 - i0 : j1 - j0); k++) { const c = st.dir < 2 ? [i0 + k, sg > 0 ? j1 : j0 - 1] : [sg > 0 ? i1 : i0 - 1, j0 + k]; out.push(c); } return out; };
      for (const [sg, y] of [[-1, 0], [1, Wd - sT]]) { const yy = st.dir === 1 || st.dir === 3 ? y : y; const cells = st.dir < 2 ? sideCells(sg) : sideCells(sg); const open = cells.every(([ii, jj]) => noWall(b, F, ii, jj, st.dir < 2 ? ii : (sg > 0 ? i1 - 1 : i0), st.dir < 2 ? (sg > 0 ? j1 - 1 : j0) : jj)); if (!open) continue;
        const yc = (st.dir < 2 ? (sg > 0) : (sg > 0)) ? Wd - sT / 2 - SS.post / 2 : sT / 2 - SS.post / 2; for (const x of [g * 0.5, run * 0.5, run - g * 1.5]) { const zt = F.z + rz * Math.ceil(x / g) ; PR.box('wood', ...bxL(x - SS.post / 2, x + SS.post / 2, yc, yc + SS.post, zt, zt + SS.rail)); }
        PR.obox('wood', L(0, yc, F.z + rz + SS.rail - 0.03), Lv(run - g, 0, (run - g) * sl), Lv(0, SS.post, 0), [0, 0, 0.06]); parts.push({ tag: 'handrail', o: { st: si, side: sg } }); }
      // 上层階段口：四边中除“上楼口”那一边外，邻格是上层同一房间的可走格 → 手摺 + 相机挡板
      const land = st.dir; // rect 的四边：0 = +u，1 = −u，2 = +v，3 = −v；上楼口 = 上行方向的那一边（= dir）
      for (let e = 0; e < 4; e++) { if (e === land) continue; const cells = []; if (e < 2) for (let jj = j0; jj < j1; jj++) cells.push([e === 0 ? i1 - 1 : i0, jj]); else for (let ii = i0; ii < i1; ii++) cells.push([ii, e === 2 ? j1 - 1 : j0]);
        const [di, dj] = NB[e]; let a0 = null; const seg = []; cells.forEach(([ii, jj], k) => { const a2 = at(b, F2, ii + di, jj + dj), ok = a2 !== A.VOID && wellNb(b, F2, ii, jj, ii + di, jj + dj); if (ok && a0 === null) a0 = k; if ((!ok || k === cells.length - 1) && a0 !== null) { seg.push([a0, ok ? k + 1 : k]); a0 = null; } });
        for (const [k0, k1] of seg) { const c0 = cells[k0], c1 = cells[k1 - 1]; let bx; const zf = F2.z, w2 = 0.03;
          const ow = (ii, jj) => !INSIDE(at(b, F2, ii, jj)) || !INSIDE(at(b, F2, ii + di, jj + dj)); // 手摺端头顶到外墙：缩进墙厚（不插进墙里）
          if (e < 2) { const uu = e === 0 ? U(b, i1) : U(b, i0); bx = [uu - w2, V(b, c0[1]) + (ow(c0[0], c0[1] - 1) ? t : 0), zf, uu + w2, V(b, c1[1] + 1) - (ow(c1[0], c1[1] + 1) ? t : 0), zf + SS.railSafe]; } else { const vv = e === 2 ? V(b, j1) : V(b, j0); bx = [U(b, c0[0]) + (ow(c0[0] - 1, c0[1]) ? t : 0), vv - w2, zf, U(b, c1[0] + 1) - (ow(c1[0] + 1, c1[1]) ? t : 0), vv + w2, zf + SS.railSafe]; }
          boxes.push({ m: 'rail', b: bx, tag: 'rail', o: { st: si, e } }); parts.push({ tag: 'well-rail', o: { st: si, e }, b: bx });
          PR.box('wood', bx[0] - 0.01, bx[1] - 0.01, zf + SS.rail - 0.05, bx[3] + 0.01, bx[4] + 0.01, zf + SS.rail); PR.box('wood', bx[0] + 0.005, bx[1] + 0.005, zf + 0.42, bx[3] - 0.005, bx[4] - 0.005, zf + 0.47);
          const len = e < 2 ? bx[4] - bx[1] : bx[3] - bx[0], np = Math.max(2, Math.ceil(len / 0.9) + 1); for (let k = 0; k < np; k++) { const tq = k / (np - 1), cu = e < 2 ? (bx[0] + bx[3]) / 2 : bx[0] + 0.04 + (bx[3] - bx[0] - 0.08) * tq, cv = e < 2 ? bx[1] + 0.04 + (bx[4] - bx[1] - 0.08) * tq : (bx[1] + bx[4]) / 2; PR.box('wood', cu - SS.post / 2, cv - SS.post / 2, zf, cu + SS.post / 2, cv + SS.post / 2, zf + SS.rail); } } } });
    // 装置：床の間（台 + 背后金地壁贴）、蔵里的长持（箱）
    for (const fx of b.fix) { const F = b.F[fx.f]; let u0 = 1e9, v0 = 1e9, u1 = -1e9, v1 = -1e9; for (const [i, j] of fx.cells) { u0 = Math.min(u0, U(b, i)); v0 = Math.min(v0, V(b, j)); u1 = Math.max(u1, U(b, i + 1)); v1 = Math.max(v1, V(b, j + 1)); }
      if (fx.kind === 'toko') { add('floorwood', [u0, v0, F.z, u1, v1, F.z + 0.15], true, 'fix'); const sd = fx.side; const w = sd === 0 ? [u1 - 0.03, v0, u1, v1] : sd === 1 ? [u0, v0, u0 + 0.03, v1] : sd === 2 ? [u0, v1 - 0.03, u1, v1] : [u0, v0, u1, v0 + 0.03]; PR.box('gold', w[0], w[1], F.z + 0.15, w[2], w[3], F.z + DH); }
      else add('wood', [u0 + 0.1, v0 + 0.15, F.z, u1 - 0.1, v1 - 0.15, F.z + 0.65], true, 'fix'); }
    return { acc: ACC.acc, boxes, wins, parts };
  }


  // ================= 审计 H22–H27（只读生成结果与几何；不复用生成器的中间判断）=================
  const FAM_TOP = { dobei: 2.4, mwall: 3.4, gate: 7.6, yaguramon: 9.5, tamon: 9.0, hall: 12, kura: 7, pavilion: 5, tenshu: 60 }; // 已有部件顶高（m，高于底）：渲染同量级，判檐口是否压到
  function geoOf(b) { if (!b._geo) { const e = exterior(b), i = interior(b); delete e.lod0; delete e.hull; delete i.acc; b._geo = { ext: e, int: i, solid: e.boxes.concat(i.boxes) }; } return b._geo; } // B3：缓存只留审计/碰撞要的盒与组件，网格数组（含 UV）不常驻——画网格时另算（interior(b).acc），JS 堆不涨
  // 盒的 2 m 桶索引（只为提速；结果与逐盒求相同）
  function boxIdx(G) { if (G._ix && G._ixN === G.solid.length) return G._ix; const M = new Map(), K = 2; for (const B of G.solid) { const x = B.b; for (let i = Math.floor(x[0] / K); i <= Math.floor(x[3] / K); i++) for (let j = Math.floor(x[1] / K); j <= Math.floor(x[4] / K); j++) { const k = i * 100003 + j; let L = M.get(k); if (!L) M.set(k, L = []); L.push(B); } } G._ix = M; G._ixN = G.solid.length; return M; }
  function clearG(G, p, R) { const M = boxIdx(G), K = 2; let m = R + 1; for (let i = Math.floor((p[0] - R) / K); i <= Math.floor((p[0] + R) / K); i++) for (let j = Math.floor((p[1] - R) / K); j <= Math.floor((p[1] + R) / K); j++) { const L = M.get(i * 100003 + j); if (L) for (const B of L) { const d = boxDist(p, B.b); if (d < m) m = d; } } return m; }
  // 球（局部坐标点 p，半径 R）到盒集合的最近距离（精确，AABB）
  function boxDist(p, bx) { const dx = Math.max(bx[0] - p[0], 0, p[0] - bx[3]), dy = Math.max(bx[1] - p[1], 0, p[1] - bx[4]), dz = Math.max(bx[2] - p[2], 0, p[2] - bx[5]); return Math.hypot(dx, dy, dz); }
  function clearLocal(boxes, p) { let m = 1e9; for (const B of boxes) { const b = B.b; if (p[0] < b[0] - m || p[0] > b[3] + m || p[1] < b[1] - m || p[1] > b[4] + m || p[2] < b[2] - m || p[2] > b[5] + m) continue; const d = boxDist(p, b); if (d < m) m = d; } return m; }
  // 一层占地采样：每个内格 3×3 点（内缩 0.05 m）
  function fpSamples(b, f) { const F = b.F[f || 0], P = [], nu = b.nu, seen = new Uint8Array((nu + 1) * (b.nv + 1)); for (let j = 0; j < b.nv; j++) for (let i = 0; i < nu; i++) if (INSIDE(F.a[j * nu + i])) { P.push(b.fr.w(U(b, i + 0.5), V(b, j + 0.5))); for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const k = (j + dj) * (nu + 1) + i + di; if (seen[k]) continue; seen[k] = 1; const ii = i + di, jj = j + dj, iu = ii === 0 || !INSIDE(at(b, F, ii, jj - 0)) && !INSIDE(at(b, F, ii, jj - 1)) ? 0.05 : ii === nu ? -0.05 : 0, ou = 0; P.push(b.fr.w(U(b, ii) + (di ? -0.05 : 0.05), V(b, jj) + (dj ? -0.05 : 0.05))); } } return P; }
  // 一层外轮廓（格边段，世界坐标，向内缩 0.05 m）
  function outline(b, m) { m = m || 0.05; const out = []; for (const R of wallRuns(b, 0)) { const w = wallRect(b, R.sd, R.line, R.s0, R.s1, m, -m), e = R.sd === 0 ? [w[2], w[2]] : R.sd === 1 ? [w[0], w[0]] : null, a = R.sd < 2 ? [R.sd === 0 ? w[0] : w[2], w[1] + m] : [w[0] + m, R.sd === 2 ? w[1] : w[3]], c = R.sd < 2 ? [R.sd === 0 ? w[0] : w[2], w[3] - m] : [w[2] - m, R.sd === 2 ? w[1] : w[3]]; out.push([b.fr.w(a[0], a[1]), b.fr.w(c[0], c[1])]); } return out; }
  function segX(a, b2, c, d) { const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); const d1 = o(c, d, a), d2 = o(c, d, b2), d3 = o(a, b2, c), d4 = o(a, b2, d); return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)); }
  function segSegDist(a, b2, c, d) { if (segX(a, b2, c, d)) return 0; return Math.min(segDist(a[0], a[1], c[0], c[1], d[0], d[1]), segDist(b2[0], b2[1], c[0], c[1], d[0], d[1]), segDist(c[0], c[1], a[0], a[1], b2[0], b2[1]), segDist(d[0], d[1], a[0], a[1], b2[0], b2[1])); }
  const insideB = (b, x, y, m) => { const [u0, v0] = b.fr.l(x, y); for (const [du, dv] of m ? [[-m, -m], [m, -m], [-m, m], [m, m]] : [[0, 0]]) { const i = Math.floor((u0 + du - b.u0) / b.cs), j = Math.floor((v0 + dv - b.v0) / b.cs); if (i < 0 || j < 0 || i >= b.nu || j >= b.nv || !INSIDE(b.F[0].a[j * b.nu + i])) return false; } return true; };
  function roofTris(b, R) { const acc = Acc(), P = mkPrims(b, acc), F = b.F[R.f], h = R.h || F.h, zE = F.z + h + 0.1; if (R.kind === 'irimoya') P.irimoya('tile', R.r, zE, R.ov, R.pitch, R.ovs); else if (R.kind === 'kirizuma') P.kirizuma('tile', R.r, zE, R.ov, R.pitch, R.oe !== undefined ? R.oe : R.ov); else { const r2 = rectOf(b.F[R.f + 1].a.map(INSIDE), b.nu, b.nv); P.koshi('tile', R.r, r2, zE, R.ov, R.pitch); } let zmax = -1e9, zmin = 1e9, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const m in acc.acc) { const a = acc.acc[m]; for (let k = 0; k < a.length; k += 3) { zmax = Math.max(zmax, a[k + 2]); zmin = Math.min(zmin, a[k + 2]); } } const tl = acc.acc.tile; const pts = []; for (let k = 0; k < tl.length; k += 3) { pts.push([tl[k], tl[k + 1]]); } return { zmax, zmin, pts, zE }; }
  function eavePoly(b, R) { if (R.ovs && R.kind === 'irimoya') { const q = R.ovs; return [[U(b, R.r[0]) - q[0], V(b, R.r[1]) - q[2]], [U(b, R.r[2]) + q[1], V(b, R.r[1]) - q[2]], [U(b, R.r[2]) + q[1], V(b, R.r[3]) + q[3]], [U(b, R.r[0]) - q[0], V(b, R.r[3]) + q[3]]].map(p => b.fr.w(p[0], p[1])); } const o = R.ov, oe = R.kind === 'kirizuma' && R.oe !== undefined ? R.oe : o, longU = (R.r[2] - R.r[0]) >= (R.r[3] - R.r[1]), ou = R.kind === 'kirizuma' ? (longU ? oe : o) : o, ov = R.kind === 'kirizuma' ? (longU ? o : oe) : o; return [[U(b, R.r[0]) - ou, V(b, R.r[1]) - ov], [U(b, R.r[2]) + ou, V(b, R.r[1]) - ov], [U(b, R.r[2]) + ou, V(b, R.r[3]) + ov], [U(b, R.r[0]) - ou, V(b, R.r[3]) + ov]].map(q => b.fr.w(q[0], q[1])); }
  function polysOverlap(A, B, m) { // 凸四边形/多边形面积重叠（分离轴，内缩 m）
    const ax = P => { const out = []; for (let i = 0; i < P.length; i++) { const a = P[i], c = P[(i + 1) % P.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1; out.push([-(c[1] - a[1]) / L, (c[0] - a[0]) / L]); } return out; };
    for (const n of ax(A).concat(ax(B))) { let a0 = 1e18, a1 = -1e18, b0 = 1e18, b1 = -1e18; for (const p of A) { const d = p[0] * n[0] + p[1] * n[1]; a0 = Math.min(a0, d); a1 = Math.max(a1, d); } for (const p of B) { const d = p[0] * n[0] + p[1] * n[1]; b0 = Math.min(b0, d); b1 = Math.max(b1, d); } if (a1 - m <= b0 + m || b1 - m <= a0 + m) return false; } return true; }
  function audit(S, W, opt) {
    opt = opt || {}; const items = [], cnt = { H22: 0, H23: 0, H24: 0, H25: 0, H26: 0, H27: 0, H28: 0, H29: 0, H30: 0 }, bad = (rule, b, msg) => { cnt[rule]++; if (items.length < 200) items.push({ rule, msg: b.name + '：' + msg, b: b.id }); b.bad = true; };
    const regionsBy = S.regions, trees = S.trees.map((t, i) => ({ t, i })).filter(o => !W.hideTrees || !W.hideTrees.includes(o.i));
    const roadSegs = []; for (const r of S.roads) for (let k = 0; k + 1 < r.pts.length; k++) roadSegs.push([r.pts[k], r.pts[k + 1], (r.need || 6) / 2]);
    for (const b of W.list) { if (opt.only !== undefined && b.id !== opt.only) continue;
      const g = regionsBy[b.region], P = fpSamples(b, 0), F0 = b.F[0];
      // ---- H22 占地：一块台地、有支撑、不压墙/部件/道路/别的建筑/树 ----
      let off = 0, zmin = 1e9, zmax = -1e9; for (const [x, y] of P) { if (S.zoneAt(x, y) !== g || ((S.loops || []).some(l => l.g === g) && !S.inEncl(g, x, y))) off++; const z = S.heightAt(x, y); zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
      if (off) bad('H22', b, off + ' 个占地采样点不在所属台地（' + g.name + '）上');
      if (zmax - zmin > SPEC.found.max + 1e-6) bad('H22', b, '占地内地面高差 ' + (zmax - zmin).toFixed(2) + ' m > 基础上限 ' + SPEC.found.max + ' m');
      if (F0.z < zmax - 1e-6) bad('H22', b, '地板 ' + F0.z.toFixed(2) + ' 低于地面最高点 ' + zmax.toFixed(2));
      if (b.zg.min - 0.3 > zmin + 1e-6) bad('H22', b, '基础底高于地面（悬空）');
      const OL = outline(b, 0.05), OLc = outline(b, SPEC.contact), bbm = [b.bb[0] - 8, b.bb[1] - 8, b.bb[2] + 8, b.bb[3] + 8], near = q => !(q[2] < bbm[0] || q[0] > bbm[2] || q[3] < bbm[1] || q[1] > bbm[3]);
      for (const p of S.parts) { if (!p.poly || p.id === b.part) continue; const bb = bbox(p.poly); if (!near(bb)) continue; // 精确：轮廓边相交 或 一方顶点在另一方内（部件多边形内缩 0.05 m）
        let hit = p.poly.some(q => insideB(b, q[0], q[1], SPEC.contact)) || P.some(([x, y]) => x >= bb[0] && x <= bb[2] && y >= bb[1] && y <= bb[3] && polyDist(x, y, p.poly) < -0.05);
        if (!hit) for (const [a, c] of OLc) { for (let k = 0; k < p.poly.length && !hit; k++) if (segX(a, c, p.poly[k], p.poly[(k + 1) % p.poly.length])) hit = true; if (hit) break; }
        if (hit) bad('H22', b, '压到部件 ' + (p.name || p.fam)); }
      if (b.type !== 'yagura') { let rh = false; for (const [a, c, w] of roadSegs) { if (!near([Math.min(a[0], c[0]) - w, Math.min(a[1], c[1]) - w, Math.max(a[0], c[0]) + w, Math.max(a[1], c[1]) + w])) continue; if (insideB(b, a[0], a[1]) || insideB(b, c[0], c[1]) || OL.some(([p0, p1]) => segSegDist(p0, p1, a, c) < w)) { rh = true; break; } } if (rh) bad('H22', b, '压到道路（净宽带）'); }
      for (const o of W.list) { if (o === b || o.id < b.id) continue; if (o.bb[2] < b.bb[0] || o.bb[0] > b.bb[2] || o.bb[3] < b.bb[1] || o.bb[1] > b.bb[3]) continue; let h = 0; for (const [x, y] of P) if (insideB(o, x, y)) { h++; break; } if (h) bad('H22', b, '与 ' + o.name + ' 重叠'); }
      for (const { t } of trees) { if (t.x < b.bb[0] - 2 || t.x > b.bb[2] + 2 || t.y < b.bb[1] - 2 || t.y > b.bb[3] + 2) continue; const [u, v] = b.fr.l(t.x, t.y), i = Math.floor((u - b.u0) / b.cs), j = Math.floor((v - b.v0) / b.cs); let n = false; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (INSIDE(at(b, F0, i + di, j + dj))) n = true; if (n) { bad('H22', b, '树干在占地内/贴墙'); break; } }
      // ---- H23 石垣顶线退距：一般建筑 ≥ setback.crest；橹（立在石垣边上）外挑 ≤0.3 m ----
      { let mn = 1e9; for (const [x, y] of P) mn = Math.min(mn, S.crestDist(g, x, y)); const need = b.type === 'yagura' ? -0.3 : SPEC.setback.crest; if (mn < need - 1e-6) bad('H23', b, '离石垣顶线 ' + mn.toFixed(2) + ' m < ' + need + ' m'); }
      // ---- H24 屋顶/檐口：檐下净空、与别的建筑/部件的檐口不相撞、同栋低屋顶收在高屋顶檐下 ----
      const RF = b.roofs.map(R => ({ R, poly: eavePoly(b, R), t: roofTris(b, R) }));
      for (const r of RF) { let gz = -1e9; for (const [x, y] of r.poly) gz = Math.max(gz, S.heightAt(x, y)); const cx = r.poly.reduce((s, q) => s + q[0], 0) / 4, cy = r.poly.reduce((s, q) => s + q[1], 0) / 4; gz = Math.max(gz, S.heightAt(cx, cy)); if (r.t.zE - gz < SPEC.clearH && b.type !== 'yagura') bad('H24', b, '檐下净空 ' + (r.t.zE - gz).toFixed(2) + ' m < ' + SPEC.clearH);
        if (b.type !== 'yagura') for (const p of S.parts) { if (!p.poly || p.id === b.part || p.fam === 'tenshu') continue; if (!polysOverlap(r.poly, p.poly, 0.05)) continue; const top = (p.z !== undefined ? p.z : Math.max(p.z0 || 0, p.z1 || 0)) + (p.h || FAM_TOP[p.fam] || 8); if (top > r.t.zE - 0.1) bad('H24', b, '檐口压到 ' + (p.name || p.fam)); } }
      for (let a = 0; a < RF.length; a++) for (let c = a + 1; c < RF.length; c++) { const A1 = RF[a], B1 = RF[c]; if (!polysOverlap(A1.poly, B1.poly, 0.05)) continue; if (A1.R.f !== B1.R.f) continue; if (Math.abs(A1.t.zE - B1.t.zE) < 1e-6 && Math.abs(A1.R.pitch - B1.R.pitch) < 1e-9 && rTouch(A1.R.r, B1.R.r)) continue; // 同高同坡、相邻的两块 = 谷（L 形屋顶的正常交线）
        const lo = A1.t.zmax <= B1.t.zmax ? A1 : B1, hi = lo === A1 ? B1 : A1; if (lo.t.zmax > hi.t.zE - 0.1 + 1e-6) bad('H24', b, '屋顶相交：低屋顶脊 ' + lo.t.zmax.toFixed(2) + ' > 高屋顶檐 ' + hi.t.zE.toFixed(2) + (b.blocks.length ? '（' + ((b.blocks.find(k => k.r === lo.R.r) || {}).name || '') + ' / ' + ((b.blocks.find(k => k.r === hi.R.r) || {}).name || '') + '）' : '')); }
      for (const o of W.list) { if (o.id <= b.id || o.bb[2] < b.bb[0] - 6 || o.bb[0] > b.bb[2] + 6 || o.bb[3] < b.bb[1] - 6 || o.bb[1] > b.bb[3] + 6) continue; let hit = false; for (const r of RF) { for (const R2 of o.roofs) if (polysOverlap(r.poly, eavePoly(o, R2), -SPEC.setback.between / 2 + 1.0)) { hit = true; break; } if (hit) break; } if (hit) bad('H24', b, '与 ' + o.name + ' 的檐口相距不足 ' + (SPEC.setback.between - 2).toFixed(1) + ' m'); }
      // ---- H25/H26/H27 用几何 ----
      const G = geoOf(b);
      auditFit(b, bad);
      auditPass(S, b, G, bad); auditCols(b, bad); auditOpen(b, G, bad); auditStairs(b, G, bad); auditWindows(b, G, bad);
    }
    const total = Object.values(cnt).reduce((a, c) => a + c, 0);
    return { total, cnt, items };
  }
  // H30：史料拟合——殿舍（多块 = L 形，取外包）中心/尺寸与绘图 mrr 比；数据里 use=hall/corridor 的殿舍都在；拓扑边都接上
  function auditFit(b, bad) {
    const T = SPEC.goten.fit.tol, chk = (nm, i0, j0, i1, j1, e) => { const [x, y] = b.fr.w(U(b, (i0 + i1) / 2), V(b, (j0 + j1) / 2)), dc = Math.hypot(x - e.cx, y - e.cy), dw = Math.abs((i1 - i0) * b.cs - e.wx), dd = Math.abs((j1 - j0) * b.cs - e.wy);
      if (dc > T.center + 1e-6) bad('H30', b, nm + ' 中心离绘图拟合 ' + dc.toFixed(2) + ' m > ' + T.center + ' m');
      if (dw > T.size + 1e-6 || dd > T.size + 1e-6) bad('H30', b, nm + ' 尺寸差 ' + dw.toFixed(2) + '/' + dd.toFixed(2) + ' m > 0.5 間'); };
    if (b.type !== 'goten' && b.fit) { chk(b.name, 0, 0, b.nu, b.nv, b.fit); return; }
    if (b.type !== 'goten' || !b.fitEl) return;
    const FD = gotenFitData(); if (FD) for (const e of FD.elements) if ((e.use === 'hall' || e.use === 'corridor') && !b.fitEl.some(f => f.name === e.name)) bad('H30', b, '拟合殿舍 ' + e.name + ' 缺失');
    for (const nm of SPEC.goten.fit.kitchen.slice(0, 1).concat([SPEC.goten.fit.entry])) if (!b.blocks.some(k => k.name === nm)) bad('H30', b, nm + ' 缺失');
    for (const f of b.fitEl) { const ks = b.blocks.filter(k => k.fit === f.name); if (!ks.length) { bad('H30', b, f.name + ' 没有殿舍块'); continue; } let i0 = 1e9, j0 = 1e9, i1 = -1e9, j1 = -1e9; for (const k of ks) { i0 = Math.min(i0, k.r[0]); j0 = Math.min(j0, k.r[1]); i1 = Math.max(i1, k.r[2]); j1 = Math.max(j1, k.r[3]); } chk(f.name, i0, j0, i1, j1, f); }
    for (const l of b.links || []) if (l[2] === 'none' || l[2] === 'missing') bad('H30', b, '拓扑 ' + l[0] + '—' + l[1] + ' 没接上');
  }
  // H25：从外门出发的格图寻路（4 邻；同房间直通，不同房间只能经过开口边；高差 ≤0.5 m；階段连上下层），每个房间可达；門外是可走的地面；階段坡度/踢面/净高
  function auditPass(S, b, G, bad) {
    const oe = openEdgeSet(b), nf = b.F.length, nu = b.nu, nv = b.nv, N = nu * nv, seen = new Uint8Array(N * nf), st = [];
    const lvl = (F, a) => a === A.DOMA ? F.z - 0.35 : F.z;
    for (const o of b.open) if (o.kind === 'door' && o.f === 0) { // 门外：离墙 0.7 m 处的地面可走、高差 ≤ 地板 + 1.0
      const [di, dj] = NB[o.side]; for (let k = 0; k < o.n; k++) { const i = o.side < 2 ? o.i : o.i + k, j = o.side < 2 ? o.j + k : o.j; const q = j * nu + i; if (WALKABLE(b.F[0].a[q])) { seen[q] = 1; st.push(q); } }
      const i = o.side < 2 ? o.i : o.i + o.n / 2, j = o.side < 2 ? o.j + o.n / 2 : o.j, [x, y] = b.fr.w(U(b, i + 0.5 + di * (0.5 + 0.7 / b.cs)), V(b, j + 0.5 + dj * (0.5 + 0.7 / b.cs))), zg = S.heightAt(x, y);
      if (S.zoneAt(x, y) !== S.regions[b.region] || b.F[0].z - zg > 1.0 + 1e-6 || zg > b.F[0].z + 0.05) bad('H25', b, '门外不是可走的同台地地面（高差 ' + (b.F[0].z - zg).toFixed(2) + ' m）');
      if (S.parts.some(p => p.poly && p.id !== b.part && polyDist(x, y, p.poly) < 0.3)) bad('H25', b, '门外被部件挡住'); }
    if (!st.length) { bad('H25', b, '没有外门'); return; }
    const stairAt = new Map(); for (const s2 of b.stairs) { const [i0, j0, i1, j1] = s2.rect; let last; if (s2.dir === 0) last = [i1 - 1, j0]; else if (s2.dir === 1) last = [i0, j0]; else if (s2.dir === 2) last = [i0, j1 - 1]; else last = [i0, j0]; for (let w = 0; w < 2; w++) { const lq = s2.dir < 2 ? [last[0], last[1] + w] : [last[0] + w, last[1]], tq = s2.dir < 2 ? [s2.top[0], s2.top[1] + w] : [s2.top[0] + w, s2.top[1]]; stairAt.set(s2.f * N + lq[1] * nu + lq[0], (s2.f + 1) * N + tq[1] * nu + tq[0]); stairAt.set((s2.f + 1) * N + tq[1] * nu + tq[0], s2.f * N + lq[1] * nu + lq[0]); } }
    while (st.length) { const c = st.pop(), f = Math.floor(c / N), q = c - f * N, i = q % nu, j = (q - i) / nu, F = b.F[f], a = F.a[q];
      const nx = stairAt.get(c); if (nx !== undefined && !seen[nx]) { const f2 = Math.floor(nx / N), a2 = b.F[f2].a[nx - f2 * N]; if (WALKABLE(a2)) { seen[nx] = 1; st.push(nx); } }
      for (let sd = 0; sd < 4; sd++) { const [di, dj] = NB[sd], i2 = i + di, j2 = j + dj; if (i2 < 0 || j2 < 0 || i2 >= nu || j2 >= nv) continue; const q2 = j2 * nu + i2, a2 = F.a[q2]; if (!WALKABLE(a2) || seen[f * N + q2]) continue;
        if (a === A.STAIR || a2 === A.STAIR) { // 梯段：只能从下端沿上行方向进出，梯段内可横移；上端经 stairAt 接到上层
          const s2 = b.stairs.find(s3 => s3.f === f && ((a === A.STAIR && inR(s3.rect, i, j)) || (a2 === A.STAIR && inR(s3.rect, i2, j2))));
          if (!s2) continue; if (!(a === A.STAIR && a2 === A.STAIR)) { const sIn = a2 === A.STAIR ? [i2, j2] : [i, j], first = s2.dir === 0 ? sIn[0] === s2.rect[0] : s2.dir === 1 ? sIn[0] === s2.rect[2] - 1 : s2.dir === 2 ? sIn[1] === s2.rect[1] : sIn[1] === s2.rect[3] - 1; if (!first || (a2 === A.STAIR ? sd !== s2.dir : sd !== (s2.dir ^ 1))) continue; } }
        if (F.r[q2] !== F.r[q] && !oe.has(edgeKey(f, i, j, sd))) continue; if (Math.abs(lvl(F, a) - lvl(F, a2)) > 0.5) continue; seen[f * N + q2] = 1; st.push(f * N + q2); } }
    for (const s2 of b.stairs) { const F2 = b.F[s2.f + 1], [i0, j0, i1, j1] = s2.rect, nu2 = b.nu; for (let w = 0; w < 2; w++) { const tq = s2.dir < 2 ? [s2.top[0], s2.top[1] + w] : [s2.top[0] + w, s2.top[1]], vq = s2.dir === 0 ? [i1 - 1, tq[1]] : s2.dir === 1 ? [i0, tq[1]] : s2.dir === 2 ? [tq[0], j1 - 1] : [tq[0], j0]; if (label(b, F2, vq[0], vq[1]) !== label(b, F2, tq[0], tq[1])) { bad('H25', b, (s2.f + 1) + '階 階段上端有隔断（楼板洞与上端格不同房间）'); break; } } }
    for (const r of b.rooms) { let any = false, ok = false; const F = b.F[r.f]; for (let j = r.rect[1]; j < r.rect[3]; j++) for (let i = r.rect[0]; i < r.rect[2]; i++) { const q = j * nu + i; if (F.r[q] !== r.id || !WALKABLE(F.a[q])) continue; any = true; if (seen[r.f * N + q]) ok = true; } if (any && !ok) bad('H25', b, r.name + ' 从入口走不到'); }
    for (const s2 of b.stairs) { const slope = s2.rise / s2.run, n = Math.ceil(s2.rise / SPEC.stair.riserMax), riser = s2.rise / n; if (slope > SPEC.stair.slopeMax + 1e-6) bad('H25', b, (s2.f + 1) + '階 階段坡度 ' + slope.toFixed(2) + ' > ' + SPEC.stair.slopeMax);
      const steps = G.int.boxes.filter(B => B.tag === 'step' && B.b[0] >= U(b, s2.rect[0]) - 1e-6 && B.b[3] <= U(b, s2.rect[2]) + 1e-6 && B.b[1] >= V(b, s2.rect[1]) - 1e-6 && B.b[4] <= V(b, s2.rect[3]) + 1e-6);
      let mxR = 0, prev = b.F[s2.f].z; steps.map(B => B.b[5]).sort((x, y) => x - y).forEach(z => { mxR = Math.max(mxR, z - prev); prev = z; }); mxR = Math.max(mxR, b.F[s2.f + 1].z - prev); if (mxR > SPEC.stair.riserMax + 1e-6) bad('H25', b, '踢面 ' + mxR.toFixed(2) + ' m > ' + SPEC.stair.riserMax);
      // 净高：沿梯段中线每 0.25 m，踏面（台阶盒顶）到上方最低实心盒底 ≥ head
      const [i0, j0, i1, j1] = s2.rect; for (let tt = 0.1; tt < 0.95; tt += 0.25 / s2.run) { const u = s2.dir === 0 ? U(b, i0) + (U(b, i1) - U(b, i0)) * tt : s2.dir === 1 ? U(b, i1) - (U(b, i1) - U(b, i0)) * tt : (U(b, i0) + U(b, i1)) / 2, v = s2.dir === 2 ? V(b, j0) + (V(b, j1) - V(b, j0)) * tt : s2.dir === 3 ? V(b, j1) - (V(b, j1) - V(b, j0)) * tt : (V(b, j0) + V(b, j1)) / 2;
        let tread = -1e9, over = 1e9; for (const B of G.solid) { const x = B.b; if (u < x[0] || u > x[3] || v < x[1] || v > x[4]) continue; if (B.tag === 'step') tread = Math.max(tread, x[5]); } for (const B of G.solid) { const x = B.b; if (u < x[0] || u > x[3] || v < x[1] || v > x[4] || B.tag === 'step') continue; if (x[2] > tread + 0.05) over = Math.min(over, x[2]); }
        if (over - tread < SPEC.stair.head - 1e-6) { bad('H25', b, (s2.f + 1) + '階 階段净高 ' + (over - tread).toFixed(2) + ' m < ' + SPEC.stair.head); break; } } }
  }
  const rTouch = (a, c) => (a[2] === c[0] || c[2] === a[0]) && Math.min(a[3], c[3]) > Math.max(a[1], c[1]) || (a[3] === c[1] || c[3] === a[1]) && Math.min(a[2], c[2]) > Math.max(a[0], c[0]);
  const inR = (r, i, j) => i >= r[0] && i < r[2] && j >= r[1] && j < r[3];
  // H26：上层柱落在下层柱上，或落在下层的结构线（墙/入側线/隔断：两侧标签不同的格边）上且两侧最近下层柱 ≤ beamMax
  function auditCols(b, bad) {
    for (let f = 1; f < b.F.length; f++) { const lower = b.F[f - 1], L = new Set(columnsOf(b, f - 1).map(p => p[0] + ',' + p[1])), struct = (i, j, dir) => dir === 'u' ? label(b, lower, i - 1, j) !== label(b, lower, i, j) : label(b, lower, i, j - 1) !== label(b, lower, i, j);
      let n = 0; for (const [i, j] of columnsOf(b, f)) { if (L.has(i + ',' + j)) continue;
        let ok = false; // 沿 v 方向的线（u = i）：边 (i, j−1) 与 (i, j) 都是结构边
        if (struct(i, j - 1, 'u') && struct(i, j, 'u')) { let a = 1, c = 1; while (a < 12 && !L.has(i + ',' + (j - a))) a++; while (c < 12 && !L.has(i + ',' + (j + c))) c++; if ((a + c) * b.cs <= SPEC.beamMax + 1e-6) ok = true; }
        if (!ok && struct(i - 1, j, 'v') && struct(i, j, 'v')) { let a = 1, c = 1; while (a < 12 && !L.has((i - a) + ',' + j)) a++; while (c < 12 && !L.has((i + c) + ',' + j)) c++; if ((a + c) * b.cs <= SPEC.beamMax + 1e-6) ok = true; }
        if (!ok) n++; }
      if (n) bad('H26', b, (f + 1) + '階 ' + n + ' 根柱下面没有柱/梁'); }
  }
  // H27：开口内外一致——门洞两层壳都通、外墙没有无门的缺口、每扇窗内外两面都有、石落し 外挑箱 + 楼板开洞
  function auditOpen(b, G, bad) {
    const t = SPEC.wallT, DH = SPEC.door.h, solid = G.solid;
    for (const o of b.open) { const F = b.F[o.f], [a, c] = openSpan(o);
      if (o.kind === 'door') { const w = wallRect(b, o.side, openLine(o), a + 0.12 / b.cs, c - 0.12 / b.cs, t + 0.12, 0.12), vol = [w[0], w[1], F.z + 0.05, w[2], w[3], F.z + DH - 0.05]; if (o.n < SPEC.door.w) bad('H27', b, '门宽 ' + o.n + ' 格 < ' + SPEC.door.w);
        for (const B of solid) { const x = B.b; if (x[0] < vol[3] && x[3] > vol[0] && x[1] < vol[4] && x[4] > vol[1] && x[2] < vol[5] && x[5] > vol[2]) { bad('H27', b, '门洞被 ' + (B.tag || B.m) + ' 挡住'); break; } } }
      if (o.kind === 'window' || o.kind === 'akari' || o.kind === 'hazama') { if (!G.ext.wa.some(W2 => W2.o === o)) bad('H27', b, '开口表里有 ' + o.kind + ' 但几何里没有窓组件'); }
      if (o.kind === 'ishi') { const box = G.ext.boxes.some(B => B.tag === 'ishi' && B.o === o); let slab = false; for (let k = 0; k < o.n; k++) { const i = o.side < 2 ? o.i : o.i + k, j = o.side < 2 ? o.j + k : o.j, cu = U(b, i + 0.5), cv = V(b, j + 0.5); if (G.int.boxes.some(B => B.tag === 'slab' && cu > B.b[0] && cu < B.b[3] && cv > B.b[1] && cv < B.b[4] && B.b[5] > F.z - 0.5 && B.b[2] < F.z + 0.1)) slab = true; } if (!box || slab) bad('H27', b, '石落し ' + (box ? '' : '外挑箱缺失 ') + (slab ? '楼板没开洞' : '')); } }
    // 外墙缺口（B3：多高度采样）：每条外墙格边中点、墙厚中线上，地板 +0.1 … 墙顶 −0.1 每 0.15 m 的点必须在外观实心盒里，或在本边登记的开口洞口里（门 / 窓 / 障子；窓的格子与通视由 H29 管）
    const doorE = new Set(); for (const o of b.open) if (o.kind === 'door') for (let k = 0; k < o.n; k++) { const i = o.side < 2 ? o.i : o.i + k, j = o.side < 2 ? o.j + k : o.j; doorE.add(edgeKey(o.f, i, j, o.side)); }
    const apOn = new Map(); for (const W2 of G.ext.wa) { const o = W2.o; for (let k = 0; k < o.n; k++) { const i = o.side < 2 ? o.i : o.i + k, j = o.side < 2 ? o.j + k : o.j, kk = edgeKey(o.f, i, j, o.side); if (!apOn.has(kk)) apOn.set(kk, []); apOn.get(kk).push(W2.ap); } }
    const inBox = (p, x) => p[0] >= x[0] - 1e-6 && p[0] <= x[3] + 1e-6 && p[1] >= x[1] - 1e-6 && p[1] <= x[4] + 1e-6 && p[2] >= x[2] - 1e-6 && p[2] <= x[5] + 1e-6;
    b.F.forEach((F, f) => { for (const R of wallRuns(b, f)) { const rb = fb(b, R.sd, R.line, R.sd < 2 ? V(b, R.s0) : U(b, R.s0), R.sd < 2 ? V(b, R.s1) : U(b, R.s1), 0, t, F.z, F.z + 99), cb = G.ext.boxes.filter(B => B.b[0] <= rb[3] + 1e-6 && B.b[3] >= rb[0] - 1e-6 && B.b[1] <= rb[4] + 1e-6 && B.b[4] >= rb[1] - 1e-6 && B.b[5] >= F.z); for (let s2 = R.s0; s2 < R.s1; s2++) { const i = R.sd < 2 ? R.line : s2, j = R.sd < 2 ? s2 : R.line, ek = edgeKey(f, i, j, R.sd), door = doorE.has(ek), aps = apOn.get(ek) || [], h = blkH(b, F, j * b.nu + i);
      for (const sf of [0.25, 0.5, 0.75]) { const sc = (R.sd < 2 ? V(b, s2 + sf) : U(b, s2 + sf)), w = fb(b, R.sd, R.line, sc, sc, t / 2, t / 2, 0, 0);
        for (let z = F.z + 0.1; z < F.z + h - 0.1; z += 0.15) { if (door && z < F.z + DH) continue; if (aps.some(a => sc > a.s0 && sc < a.s1 && z > a.z0 && z < a.z1)) continue; const p = [w[0], w[1], z]; if (!cb.some(B => inBox(p, B.b))) { bad('H27', b, (f + 1) + '階 外墙有缺口（无门/窓）z=' + (z - F.z).toFixed(2)); return; } } } } } });
    // 反向：外侧窗贴片都对应一个开口
    for (const W2 of G.ext.wins) if (!b.open.includes(W2.o)) bad('H27', b, '外侧有窗但开口表里没有');
  }


  // H28（B3）：階段——踢面/坡度在范围内、踏板齐全且等高差、两侧側桁、开放侧有手摺、上层階段口（VOID 正好盖住梯段、上层楼板不压梯段）、口四周（上楼口除外）有手摺、上下端连着两层可走格
  function auditStairs(b, G, bad) { const SS = SPEC.stair;
    b.stairs.forEach((st, si) => { const F = b.F[st.f], F2 = b.F[st.f + 1], nm = (st.f + 1) + '→' + (st.f + 2) + '階 階段', n = Math.ceil(st.rise / SS.riserMax - 1e-9), rz = st.rise / n, sl = st.rise / st.run, [i0, j0, i1, j1] = st.rect;
      if (rz > SS.riserMax + 1e-6 || rz < SS.riserMin - 1e-6) bad('H28', b, nm + ' 踢面 ' + rz.toFixed(3) + ' m 不在 ' + SS.riserMin + '–' + SS.riserMax);
      if (sl > SS.slopeMax + 1e-6 || sl < SS.slopeMin - 1e-6) bad('H28', b, nm + ' 坡度 ' + (Math.atan(sl) * 180 / Math.PI).toFixed(1) + '° 不在 45°–55°');
      const T = G.int.boxes.filter(B => B.tag === 'step' && B.o && B.o.st === si).sort((x, y) => x.b[5] - y.b[5]), ax = st.dir < 2 ? 0 : 1, wa = st.dir < 2 ? 1 : 0, Wd = st.dir < 2 ? V(b, j1) - V(b, j0) : U(b, i1) - U(b, i0);
      if (T.length !== n) bad('H28', b, nm + ' 踏板 ' + T.length + ' 块 ≠ 级数 ' + n);
      else { let ok = true; T.forEach((B, k) => { if (Math.abs(B.b[5] - (F.z + rz * (k + 1))) > 1e-6 || B.b[wa + 3] - B.b[wa] < Wd - 2 * SS.stringer[0] - 1e-6) ok = false; }); if (!ok) bad('H28', b, nm + ' 踏板高差不均或宽度不足');
        const iv = T.map(B => [B.b[ax], B.b[ax + 3]]).sort((x, y) => x[0] - y[0]); let reach = (ax ? V(b, j0) : U(b, i0)); for (const [a, c] of iv) { if (a > reach + 1e-6) { ok = false; break; } reach = Math.max(reach, c); } if (!ok || reach < (ax ? V(b, j1) : U(b, i1)) - 1e-6) bad('H28', b, nm + ' 踏板沿上行方向有缺口');
        if (Math.abs(T[T.length - 1].b[5] - F2.z) > 1e-6) bad('H28', b, nm + ' 最上一级不与上层地板齐平'); }
      const P = G.int.parts.filter(q => q.o && q.o.st === si); if (P.filter(q => q.tag === 'stringer').length !== 2) bad('H28', b, nm + ' 側桁不是两根');
      const rid = F.r[st.bot[1] * b.nu + st.bot[0]]; for (const sg of [-1, 1]) { let open = true; const L = st.dir < 2 ? i1 - i0 : j1 - j0; for (let k = 0; k < L; k++) { const c = st.dir < 2 ? [i0 + k, sg > 0 ? j1 : j0 - 1] : [sg > 0 ? i1 : i0 - 1, j0 + k], c0 = st.dir < 2 ? [i0 + k, sg > 0 ? j1 - 1 : j0] : [sg > 0 ? i1 - 1 : i0, j0 + k]; if (!noWall(b, F, c[0], c[1], c0[0], c0[1])) open = false; } if (open && !P.some(q => q.tag === 'handrail' && q.o.side === sg)) bad('H28', b, nm + ' 开放侧没有手摺'); }
      const bq = at(b, F, st.bot[0], st.bot[1]), tq = at(b, F2, st.top[0], st.top[1]); if (!(bq === A.ROOM || bq === A.IRI) || !(tq === A.ROOM || tq === A.IRI)) bad('H28', b, nm + ' 上下端没有连着两层的可走格');
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) if (F2.a[j * b.nu + i] !== A.VOID) { bad('H28', b, nm + ' 上层階段口没有盖住梯段'); j = j1; break; }
      const fu = [U(b, i0) + 0.05, V(b, j0) + 0.05, U(b, i1) - 0.05, V(b, j1) - 0.05]; if (G.int.boxes.some(B => (B.tag === 'slab' || B.tag === 'fault') && B.b[5] > F2.z - 0.6 && B.b[2] < F2.z + 0.05 && B.b[0] < fu[2] && B.b[3] > fu[0] && B.b[1] < fu[3] && B.b[4] > fu[1])) bad('H28', b, nm + ' 上层楼板压在梯段上（階段口不通）');
      const land = st.dir;
      for (let e = 0; e < 4; e++) { if (e === land) continue; const [di, dj] = NB[e], cells = []; if (e < 2) for (let jj = j0; jj < j1; jj++) cells.push([e === 0 ? i1 - 1 : i0, jj]); else for (let ii = i0; ii < i1; ii++) cells.push([ii, e === 2 ? j1 - 1 : j0]);
        for (const [ii, jj] of cells) { if (!wellNb(b, F2, ii, jj, ii + di, jj + dj)) continue; const mu = e < 2 ? (e === 0 ? U(b, i1) : U(b, i0)) : U(b, ii + 0.5), mv = e < 2 ? V(b, jj + 0.5) : (e === 2 ? V(b, j1) : V(b, j0)), p = [mu, mv, F2.z + 1.0];
          if (!G.int.boxes.some(B => B.tag === 'rail' && p[0] >= B.b[0] - 1e-6 && p[0] <= B.b[3] + 1e-6 && p[1] >= B.b[1] - 1e-6 && p[1] <= B.b[4] + 1e-6 && p[2] >= B.b[2] && p[2] <= B.b[5])) { bad('H28', b, nm + ' 階段口边缘没有手摺（' + (st.f + 2) + '階）'); return; } } } });
  }
  // H29（B3）：窓——墙厚见込み 0.2–0.3 m 且洞口两侧有墙（不是贴片）、敷居/鴨居、格子（≥3 根，深 ≥0.08 m，缝 0.06–0.2 m）、土戸/突上戸/華頭板 按类型齐全、
  //   通视：从室内 0.6 m 处垂直穿过洞口到墙外 1.5 m 的射线网格，不碰本栋任何实心盒的比例 ≥ openMin（纸片窗 = 0）；隠狭間：外皮封住、内侧有凹口
  function auditWindows(b, G, bad) { const t = SPEC.wallT, R2 = 2 * SPEC.cam.R, solid = G.solid;
    if (t < 0.2 || t > 0.3) bad('H29', b, '墙厚 ' + t + ' m 不在 0.2–0.3');
    const inAny = p => G.solid.some(B => p[0] >= B.b[0] - 1e-9 && p[0] <= B.b[3] + 1e-9 && p[1] >= B.b[1] - 1e-9 && p[1] <= B.b[4] + 1e-9 && p[2] >= B.b[2] - 1e-9 && p[2] <= B.b[5] + 1e-9);
    for (const W2 of G.ext.wa) { const o = W2.o, ap = W2.ap, pt = wpt(b, ap.sd, ap.line), tags = W2.parts.map(q => q.tag), nm = (o.f + 1) + '階 ' + (o.wt || o.kind), zm = (ap.z0 + ap.z1) / 2;
      if (o.kind === 'hazama') { if (!inAny(pt(ap.sc, 0.015, zm))) bad('H29', b, nm + ' 隠狭間外皮缺失'); if (inAny(pt(ap.sc, t - 0.05, zm))) bad('H29', b, nm + ' 狭間内侧没有凹口'); if (!tags.includes('hazama-plate')) bad('H29', b, nm + ' 狭間口板缺失'); continue; }
      for (const side of [ap.s0 - 0.02, ap.s1 + 0.02]) for (const d of [0.02, t / 2, t - 0.02]) if (!inAny(pt(side, d, zm))) { bad('H29', b, nm + ' 洞口侧边没有墙（见込み缺失）'); break; }
      if (!tags.includes('sill') || !tags.includes('kamoi')) bad('H29', b, nm + ' 缺敷居/鴨居');
      if (o.kind === 'window') { const bars = W2.parts.filter(q => q.tag === 'bar').map(q => q.b), ax = ap.sd < 2 ? 1 : 0, dax = ap.sd < 2 ? 0 : 1;
        if (bars.length < 3) bad('H29', b, nm + ' 格子少于 3 根'); else { const xs = bars.map(x => [x[ax], x[ax + 3]]).sort((p, q) => p[0] - q[0]); let mx = xs[0][0] - ap.s0, mn = mx; for (let k = 1; k < xs.length; k++) { const gp = xs[k][0] - xs[k - 1][1]; mx = Math.max(mx, gp); mn = Math.min(mn, gp); } const e = ap.s1 - xs[xs.length - 1][1]; mx = Math.max(mx, e); mn = Math.min(mn, e);
          if (mx > Math.min(SPEC.win.gapMax, R2 - 0.05)) bad('H29', b, nm + ' 格子缝 ' + mx.toFixed(2) + ' m 过宽（人/相机可穿过）'); if (mn < SPEC.win.gapMin) bad('H29', b, nm + ' 格子缝 ' + mn.toFixed(2) + ' m 过窄（看不见外面）'); if (bars.some(x => x[dax + 3] - x[dax] < 0.08)) bad('H29', b, nm + ' 格子见込み < 0.08 m'); }
        if (o.slide && !tags.includes('shutter')) bad('H29', b, nm + ' 缺土戸'); if (b.type === 'yagura' && !o.slide) bad('H29', b, nm + ' 橹窓没有土戸的引き代'); if (o.wt === 'tsuki' && !tags.includes('tsukiage')) bad('H29', b, nm + ' 缺突上戸'); if (o.wt === 'kato' && tags.filter(x => x === 'kato').length !== 2) bad('H29', b, nm + ' 華頭板不是内外两面'); }
      if (o.kind === 'akari' && !tags.includes('shoji')) bad('H29', b, nm + ' 缺障子');
      const va = fb(b, ap.sd, ap.line, ap.s0, ap.s1, -1.5, t + 0.6, ap.z0, ap.z1), cand = solid.filter(B => B.b[0] <= va[3] && B.b[3] >= va[0] && B.b[1] <= va[4] && B.b[4] >= va[1] && B.b[2] <= va[5] && B.b[5] >= va[2]);
      let ok = 0, N = 0; for (let a = 0; a < 24; a++) for (let c = 0; c < 5; c++) { const sx = ap.s0 + (ap.s1 - ap.s0) * (a + 0.5) / 24, z = ap.z0 + 0.06 + (ap.z1 - ap.z0 - 0.13) * (c + 0.5) / 5, p = pt(sx, t + 0.6, z), q = pt(sx, -1.5, z); N++; if (!cand.some(B => segBox(p, q, B.b))) ok++; }
      if (ok / N < SPEC.win.openMin) bad('H29', b, nm + ' 通视 ' + Math.round(ok / N * 100) + '% < ' + Math.round(SPEC.win.openMin * 100) + '%（窗是实心/纸片）'); }
  }
  // ================= 相机 C9/C10（室内相机 = 半径 R 的球，眼高 eye；碰撞 = 外壳盒 + 内部实心盒，局部坐标里精确球-盒距离）=================
  function segBox(p, q, bx) { let t0 = 0, t1 = 1; for (let k = 0; k < 3; k++) { const d = q[k] - p[k]; if (Math.abs(d) < 1e-12) { if (p[k] < bx[k] || p[k] > bx[k + 3]) return false; continue; } let a = (bx[k] - p[k]) / d, c = (bx[k + 3] - p[k]) / d; if (a > c) { const t = a; a = c; c = t; } t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) return false; } return true; }
  // 格图（与 H25 同一张：同房间直通、异房间经开口边、階段只从下端进），带父指针，给相机路径用
  function cellGraph(b) {
    const oe = openEdgeSet(b), nu = b.nu, nv = b.nv, N = nu * nv, nf = b.F.length;
    const lvl = (F, a) => a === A.DOMA ? F.z - 0.35 : F.z;
    const stairAt = new Map(); for (const s2 of b.stairs) { const [i0, j0, i1, j1] = s2.rect; const last = s2.dir === 0 ? [i1 - 1, j0] : s2.dir === 1 ? [i0, j0] : s2.dir === 2 ? [i0, j1 - 1] : [i0, j0]; for (let w = 0; w < 2; w++) { const lq = s2.dir < 2 ? [last[0], last[1] + w] : [last[0] + w, last[1]], tq = s2.dir < 2 ? [s2.top[0], s2.top[1] + w] : [s2.top[0] + w, s2.top[1]]; stairAt.set(s2.f * N + lq[1] * nu + lq[0], (s2.f + 1) * N + tq[1] * nu + tq[0]); stairAt.set((s2.f + 1) * N + tq[1] * nu + tq[0], s2.f * N + lq[1] * nu + lq[0]); } }
    const nbr = c => { const out = [], f = Math.floor(c / N), q = c - f * N, i = q % nu, j = (q - i) / nu, F = b.F[f], a = F.a[q]; const x = stairAt.get(c); if (x !== undefined) { const f2 = Math.floor(x / N); if (WALKABLE(b.F[f2].a[x - f2 * N])) out.push(x); }
      for (let sd = 0; sd < 4; sd++) { const [di, dj] = NB[sd], i2 = i + di, j2 = j + dj; if (i2 < 0 || j2 < 0 || i2 >= nu || j2 >= nv) continue; const q2 = j2 * nu + i2, a2 = F.a[q2]; if (!WALKABLE(a2)) continue;
        if (a === A.STAIR || a2 === A.STAIR) { const s2 = b.stairs.find(s3 => s3.f === f && ((a === A.STAIR && inR(s3.rect, i, j)) || (a2 === A.STAIR && inR(s3.rect, i2, j2)))); if (!s2) continue; if (!(a === A.STAIR && a2 === A.STAIR)) { const sIn = a2 === A.STAIR ? [i2, j2] : [i, j], first = s2.dir === 0 ? sIn[0] === s2.rect[0] : s2.dir === 1 ? sIn[0] === s2.rect[2] - 1 : s2.dir === 2 ? sIn[1] === s2.rect[1] : sIn[1] === s2.rect[3] - 1; if (!first || (a2 === A.STAIR ? sd !== s2.dir : sd !== (s2.dir ^ 1))) continue; } }
        if (F.r[q2] !== F.r[q] && !oe.has(edgeKey(f, i, j, sd))) continue; if (Math.abs(lvl(F, a) - lvl(F, a2)) > 0.5) continue; out.push(f * N + q2); } return out; };
    // 格心眼点（局部坐标）：土間低 0.35；梯段按格心在梯段上的位置插值踏面高
    const eyeAt = c => { const f = Math.floor(c / N), q = c - f * N, i = q % nu, j = (q - i) / nu, F = b.F[f], a = F.a[q]; let z = lvl(F, a);
      if (a === A.STAIR) { const s2 = b.stairs.find(s3 => s3.f === f && inR(s3.rect, i, j)), L = s2.dir < 2 ? s2.rect[2] - s2.rect[0] : s2.rect[3] - s2.rect[1], k = s2.dir === 0 ? i - s2.rect[0] : s2.dir === 1 ? s2.rect[2] - 1 - i : s2.dir === 2 ? j - s2.rect[1] : s2.rect[3] - 1 - j, n = Math.ceil(s2.rise / SPEC.stair.riserMax), fr = (k + 0.5) / L; z = F.z + s2.rise * Math.ceil(fr * n - 1e-9) / n; }
      return [U(b, i + 0.5), V(b, j + 0.5), z + SPEC.cam.eye]; };
    return { N, nbr, eyeAt };
  }
  function camAudit(S, W, opt) {
    opt = opt || {}; const items = [], cnt = { C9: 0, C10: 0 }, R = SPEC.cam.R, bad = (rule, b, msg) => { cnt[rule]++; if (items.length < 100) items.push({ rule, msg: b.name + '：' + msg, b: b.id }); }; let nRooms = 0, nPath = 0;
    for (const b of W.list) { if (opt.only !== undefined && b.id !== opt.only) continue;
      const G = geoOf(b), boxes = G.solid, CG = cellGraph(b), nu = b.nu, N = CG.N, clear = p => clearG(G, p, R) >= R - 1e-3;
      const door = b.open.find(o => o.kind === 'door' && o.f === 0); if (!door) { bad('C9', b, '没有门可进'); continue; }
      // 门外起点：门洞中心外 1.2 m，眼高 = 地面 + eye
      const [di, dj] = NB[door.side], mi = door.side < 2 ? door.i + 0.5 : door.i + door.n / 2, mj = door.side < 2 ? door.j + door.n / 2 : door.j + 0.5, edgeU = door.side === 0 ? U(b, door.i + 1) : door.side === 1 ? U(b, door.i) : U(b, mi), edgeV = door.side === 2 ? V(b, door.j + 1) : door.side === 3 ? V(b, door.j) : V(b, mj);
      const outU = edgeU + di * 1.2, outV = edgeV + dj * 1.2, [ox, oy] = b.fr.w(outU, outV), pOut = [outU, outV, S.heightAt(ox, oy) + SPEC.cam.eye], pDoor = [edgeU, edgeV, b.F[0].z + SPEC.cam.eye];
      const startCells = []; for (let k = 0; k < door.n; k++) { const i = door.side < 2 ? door.i : door.i + k, j = door.side < 2 ? door.j + k : door.j; startCells.push(j * nu + i); }
      // BFS（父指针）
      const par = new Int32Array(N * b.F.length).fill(-2), st = []; for (const c of startCells) { par[c] = -1; st.push(c); } for (let h = 0; h < st.length; h++) for (const c2 of CG.nbr(st[h])) if (par[c2] === -2) { par[c2] = st[h]; st.push(c2); }
      const seg = (p, q) => { const L = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]), n = Math.max(1, Math.ceil(L / 0.1)); for (let k = 0; k <= n; k++) { const t = k / n, x = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]; if (!clear(x)) return x; } return null; };
      { const h = seg(pOut, pDoor); if (h) { bad('C9', b, '从门外进门时相机球碰到几何（' + h.map(v => v.toFixed(2)).join(',') + '）'); continue; } }
      b.cams = [];
      for (const r of b.rooms) { // 房间代表格：离房间中心最近的可走格
        const F = b.F[r.f]; let best = -1, bd = 1e9; const cu = (r.rect[0] + r.rect[2]) / 2, cv = (r.rect[1] + r.rect[3]) / 2; for (let j = r.rect[1]; j < r.rect[3]; j++) for (let i = r.rect[0]; i < r.rect[2]; i++) { const q = j * nu + i; if (F.r[q] !== r.id || !(F.a[q] === A.ROOM || F.a[q] === A.IRI || F.a[q] === A.ROUKA || F.a[q] === A.DOMA)) continue; const d = Math.hypot(i + 0.5 - cu, j + 0.5 - cv); if (d < bd) { bd = d; best = r.f * N + q; } }
        if (best < 0) continue; nRooms++; if (par[best] === -2) { bad('C9', b, r.name + ' 相机走不到'); continue; }
        const path = []; for (let c = best; c !== -1; c = par[c]) path.push(c); path.reverse(); nPath++;
        let prev = pDoor, hit = null; for (const c of path) { const e = CG.eyeAt(c); hit = seg(prev, e); if (hit) break; prev = e; }
        if (hit) bad('C9', b, '去 ' + r.name + ' 的路上相机球碰到几何（' + hit.map(v => v.toFixed(2)).join(',') + '）'); // C10 照样评（机位只用格图可达的格）
        // C10：房间语义的机位——候选机位 = 路径上本房间的格（从进房那一格起）；候选主体 = 上段的床の間 / 橹的本房间外墙窓（近→远）/ 房间中心；取第一对“机位清空 + 视线不被挡 + 距离 ≥1 m”
        const tgts = [], tk = b.fix.find(fx => fx.kind === 'toko' && fx.room === r.id); if (tk) { const [i, j] = tk.cells[0]; tgts.push({ p: [U(b, i + 1), V(b, j + 0.5), F.z + 0.9], what: 'toko' }); }
        if (b.type === 'yagura') for (const w of b.open) { if (w.f !== r.f || w.kind !== 'window' || F.r[w.j * nu + w.i] !== r.id) continue; const [a, c2] = openSpan(w), m2 = (a + c2) / 2, uu = w.side === 0 ? U(b, w.i + 1) - 0.3 : w.side === 1 ? U(b, w.i) + 0.3 : U(b, m2), vv = w.side === 2 ? V(b, w.j + 1) - 0.3 : w.side === 3 ? V(b, w.j) + 0.3 : V(b, m2); tgts.push({ p: [uu, vv, F.z + SPEC.win.sill + SPEC.win.h / 2], what: 'window' }); }
        { const q0 = best - r.f * N, i0 = q0 % nu, j0 = (q0 - i0) / nu; tgts.push({ p: [U(b, i0 + 0.5), V(b, j0 + 0.5), F.z + 1.0], what: 'center' }); } // 房间中心 = 离格心均值最近的本房间格（L 形房间的包围盒中心可能不在房间里）
        const camCells = path.filter(c => { const f = Math.floor(c / N); return f === r.f && b.F[f].r[c - f * N] === r.id; }); { const e0 = camCells[0], ei = (e0 - r.f * N) % nu, ej = Math.floor((e0 - r.f * N) / nu), more = []; for (let j = r.rect[1]; j < r.rect[3]; j++) for (let i = r.rect[0]; i < r.rect[2]; i++) { const q = j * nu + i, c = r.f * N + q; if (F.r[q] === r.id && WALKABLE(F.a[q]) && F.a[q] !== A.STAIR && par[c] !== -2 && !camCells.includes(c)) more.push([Math.hypot(i - ei, j - ej), c]); } more.sort((x, y) => x[0] - y[0]); for (const m of more) camCells.push(m[1]); } // 再加本房间其它可达格（离进房格由近到远）
        const vis = (pc, t) => { for (const B of boxes) { const x = B.b; if (t[0] > x[0] - 0.35 && t[0] < x[3] + 0.35 && t[1] > x[1] - 0.35 && t[1] < x[4] + 0.35 && t[2] > x[2] - 0.35 && t[2] < x[5] + 0.35) continue; if (segBox(pc, t, x)) return B; } return null; };
        let pick = null; for (const t of tgts) { let bd = -1; for (const c of camCells) { const pc = CG.eyeAt(c), d = Math.hypot(t.p[0] - pc[0], t.p[1] - pc[1]); if (d < 1.0 || d <= bd || d > 14 || !clear(pc) || vis(pc, t.p)) continue; pick = { pc, t }; bd = d; } if (pick) break; } // 取看得见主体的最远一格（≤14 m）：看到整间房
        if (!pick) { bad('C10', b, r.name + ' 找不到清空且通视的机位'); continue; }
        const camP = pick.pc, tgt = pick.t.p, what = pick.t.what;
        const W0 = (q2) => { const [x, y] = b.fr.w(q2[0], q2[1]); return [x, y, q2[2]]; }; b.cams.push({ room: r.id, name: r.name, what, cam: W0(camP), tgt: W0(tgt), path: path.map(c => W0(CG.eyeAt(c))), out: W0(pOut), door: W0(pDoor) });
      }
    }
    const total = cnt.C9 + cnt.C10; return { total, cnt, items, rooms: nRooms, paths: nPath };
  }
  // 运行时：相机球（世界坐标）到建筑 b 的几何的间隙
  function clearance(b, p, R) { const g = geoOf(b), [u, v] = b.fr.l(p[0], p[1]); return clearG(g, [u, v, p[2]], R || 2); }


  // ================= 结果包（B1）：生成结果 W 的确定性快照（页面读包跳过生成；tests/test_pack.js 校验 读包 = 现场生成）=================
  const TA = { Uint8Array, Int16Array };
  const b64e = u8 => { if (typeof Buffer !== 'undefined') return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64'); let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
  const b64d = s => { if (typeof Buffer !== 'undefined') { const B0 = Buffer.from(s, 'base64'); return new Uint8Array(B0.buffer, B0.byteOffset, B0.length).slice(); } const t = atob(s), u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };
  const SKIP = new Set(['fr', '_geo', '_ext', 'bad', 'cams']);
  function packW(W) { const enc = v => { if (ArrayBuffer.isView(v)) return { $t: v.constructor.name, d: b64e(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) }; if (Array.isArray(v)) return v.map(enc); if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) if (!SKIP.has(k) && typeof v[k] !== 'function') o[k] = enc(v[k]); return o; } return v; };
    return { v: 1, seed: W.seed, lost: W.lost, roll: W.roll, notes: W.notes, hideTrees: W.hideTrees, stats: W.stats, list: W.list.map(enc) }; }
  function unpackW(P) { const dec = v => { if (v && v.$t) { const u = b64d(v.d); return new TA[v.$t](u.buffer, u.byteOffset, u.byteLength / TA[v.$t].BYTES_PER_ELEMENT); } if (Array.isArray(v)) return v.map(dec); if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = dec(v[k]); return o; } return v; };
    const W = { seed: P.seed, lost: P.lost, roll: P.roll, notes: P.notes, hideTrees: P.hideTrees, stats: P.stats, spec: SPEC, ms: 0, fromPack: true, list: P.list.map(o => { const b = dec(o); b.fr = frameOf(b.x, b.y, b.ang); return b; }) }; return W; }
  let SRC_HASH = null; const genKey = (siteKey, roll) => { if (!SRC_HASH) SRC_HASH = ('00000000' + fnv(castleBldg.toString()).toString(16)).slice(-8); return 'b1-' + SRC_HASH + '-' + siteKey + '-r' + (roll || ''); };
  const RULES = [
    { id: 'H22', name: '建筑占地：一块台地、有支撑，不压墙/部件/道路/别的建筑/树' },
    { id: 'H23', name: '石垣顶线退距：一般建筑 ≥5 m；橹墙面不外挑' },
    { id: 'H24', name: '屋顶/檐口：檐下净空 ≥2.1 m，与别的建筑/部件不相撞，低屋顶收在高屋顶檐下' },
    { id: 'H25', name: '室内通行：每个房间从外门走得到，门外是地面，階段坡度/踢面/净高' },
    { id: 'H26', name: '上层柱落在下层柱或梁（结构线）上' },
    { id: 'H27', name: '开口内外一致：门洞两层都通，外墙除登记的门/窓洞口外无缺口（多高度采样），每个窓/狭間都有组件，石落し开洞' },
    { id: 'H28', name: '階段：踢面 0.15–0.25 m、坡度 45°–55°、踏板齐全等高差无缺口、两侧側桁、开放侧手摺、上层階段口盖住梯段且四周（上楼口除外）有手摺、上下端连两层' },
    { id: 'H29', name: '窓：墙洞见込み 0.2–0.3 m（不是贴片）、敷居/鴨居、格子缝 0.06–0.2 m、土戸/突上戸/華頭/障子 按类型齐全、穿过洞口的射线通视 ≥25%、隠狭間外皮+内凹' },
    { id: 'H30', name: '史料拟合：江戸盛期本丸御殿各殿舍/御金蔵 吸附后中心离绘图拟合 ≤1 m、尺寸差 ≤0.5 間；拟合殿舍齐全（含台所）；拓扑每条边接上（相接或廊下）' },
  ];
  const CRULES = [{ id: 'C9', name: '进得去：室内相机球从门外经门洞走到每个房间，全程不碰几何' }, { id: 'C10', name: '室内机位：每个房间有清空且通视主体的机位（床の間/窓/房间中心）' }];

  // ---------------- 生成入口 ----------------
  function parseRoll(s) { const o = {}; if (!s) return o; for (const t of String(s).split(',')) { const m = t.split(':'); if (m.length === 2) o[m[0]] = +m[1] || 0; } return o; }
  function generate(S, opt) {
    opt = opt || {}; const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const W = { seed: String(opt.seed !== undefined ? opt.seed : S.opt.seed), lost: opt.lost !== undefined ? !!opt.lost : !!S.opt.lost, roll: parseRoll(opt.roll), list: [], notes: [], free: {}, occ: {}, spec: SPEC };
    const hm = S.regions.find(g => g.name === 'honmaru');
    // 现存/失传橹：现存的每个时代都有（外观按实测重做 + 生成内部）；失传的只在江戸盛期（site 已按 lost 开关放了槽位）
    for (const p of S.parts) if (p.fam === 'yagura2' || p.fam === 'yagura3') { const b = yagura(S, W, p); if (b) W.list.push(b); }
    if (W.lost && hm) { // 江戸盛期：本丸御殿 + 门内番所 + 剩余地上的蔵
      const b = goten(S, W, hm); if (b) W.list.push(b);
      const FG = W.free.honmaru || freeGrid(S, hm, axisOf(S, hm)); W.occ.honmaru = new Uint8Array(FG.nu * FG.nv);
      if (b) { const o = b.fgOff, m = 4; for (const k of b.blocks) for (let j = Math.max(0, k.r[1] + o[1] - m); j < Math.min(FG.nv, k.r[3] + o[1] + m); j++) for (let i = Math.max(0, k.r[0] + o[0] - m); i < Math.min(FG.nu, k.r[2] + o[0] + m); i++) W.occ.honmaru[j * FG.nu + i] = 1; }
      const FD = gotenFitData(); if (b && b.fit && FD) { // r14：绘图上的附属小屋/奥向附属 = 占用掩膜（番所/蔵不放上去）；御金蔵 = 拟合位置的蔵
        for (const e of FD.elements) { if (e.use !== 'mask') continue; const r = fitRectOf(e, FG).r, m = 2; for (let j = Math.max(0, r[1] - m); j < Math.min(FG.nv, r[3] + m); j++) for (let i = Math.max(0, r[0] - m); i < Math.min(FG.nu, r[2] + m); i++) W.occ.honmaru[j * FG.nu + i] = 1; }
        let nk0 = 0; for (const e of FD.elements) { if (e.use !== 'kura') continue; const f = fitRectOf(e, FG), s = small(S, W, hm, FG, 'kura', [e.cx, e.cy], nk0, { r: f.r, name: e.name, key: 'kura@' + hm.name + '@' + e.name, fit: { name: e.name, cx: e.cx, cy: e.cy, wx: f.wx, wy: f.wy }, prov: { tier: '史料拟合', src: 'goten-fit', note: e.name + '：位置/尺寸 = ' + FD.src + '（NDL ' + FD.pid + '）拟合，吸附半間格；名称可信度 ' + e.conf + '；内部 = 规则（推定）' } }); if (s) { W.list.push(s); nk0++; } } }
      let k = 0; for (const G of S.gates.filter(G => G.region === hm)) { const inner = S.parts.find(p => p.masugataOf === G) || G; const s = small(S, W, hm, FG, 'bansho', [inner.x, inner.y], k); if (s) { W.list.push(s); k++; } }
      const rk = rng(nodeSeed(W, 'kura@honmaru', 'count')), nk = 2 + Math.floor(rk() * 2); for (let q = 0; q < nk; q++) { const ten = S.parts.find(p => p.fam === 'tenshu'), a = rk() * Math.PI * 2, rad = 40 + rk() * 40; const s = small(S, W, hm, FG, 'kura', [ten.x + Math.cos(a) * rad, ten.y + Math.sin(a) * rad], q); if (s) W.list.push(s); }
    }
    W.list.forEach((b, i) => { b.id = i; b.bb = worldBB(b); });
    // 江戸盛期：被建筑（含出檐 + 1 m）压住的现代树不画（树来自 OSM/现状，不是江戸期的）
    W.hideTrees = []; if (W.lost) S.trees.forEach((t, i) => { for (const b of W.list) { if (b.type === 'yagura' && b.tier === 'measured') continue; const [u, v] = b.fr.l(t.x, t.y), m = (t.r || 3) + 2.6; if (u > b.u0 - m && u < b.u0 + b.nu * CS + m && v > b.v0 - m && v < b.v0 + b.nv * CS + m) { W.hideTrees.push(i); break; } } });
    W.ms = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
    W.stats = statsOf(W); delete W.free; delete W.occ; return W;
  }
  function worldBB(b) { const P = []; for (const [i, j] of [[0, 0], [b.nu, 0], [0, b.nv], [b.nu, b.nv]]) P.push(b.fr.w(U(b, i), V(b, j))); return bbox(P); }
  function statsOf(W) { const by = {}; let rooms = 0, tatami = 0; for (const b of W.list) { const k = b.type + (b.tier === 'measured' ? '(实测)' : '(推定)'); by[k] = (by[k] || 0) + 1; rooms += b.rooms.length; for (const r of b.rooms) if (r.kind === 'tatami') tatami += Math.round((r.rect[2] - r.rect[0]) * (r.rect[3] - r.rect[1]) / 2); } return { n: W.list.length, by, rooms, tatami }; }
  function signature(W) { let h = 2166136261; for (const b of W.list) { h = fnv(b.key + ':' + b.nu + 'x' + b.nv + ':' + b.F.length + ':' + b.rooms.length + ':' + b.open.length + ':' + b.x.toFixed(3) + ',' + b.y.toFixed(3), h); for (const F of b.F) for (let q = 0; q < F.a.length; q += 7) h = fnv(String(F.a[q]), h); } return ('00000000' + h.toString(16)).slice(-8) + '-' + W.list.length; }

  const API = { SPEC, A, generate, outerOf, apertureOf, signature, packW, unpackW, genKey, RULES, CRULES, exterior, interior, audit, camAudit, clearance, cellGraph, geoOf, clearLocal, boxDist, columnsOf, openEdgeSet, edgeKey, wallRuns, wallRect, openSpan, openLine, rectOf, frameOf, rects, KEN, CS, U, V, NB, at, WALKABLE, INSIDE, fnv, rng, bbox, polyDist, inPoly, segDist };
  G.CASTLE_BLDG = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
