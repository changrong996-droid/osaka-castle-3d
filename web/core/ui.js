'use strict';
// ===== UI 核心（proto-port1）：与领域无关的版式 / 叠层 / 图表工具。筑城、码头以及以后的工厂、桥梁、机构图都用这一套 =====
// 解决 proto1–3 踩过的坑：轨道相机吞点击（stopOrbit）、矮宽窗口 3D 区被压扁（fitRows 保底）、叠层互压（Overlays 逐级收起）、
// 浮动标注出界（placeBox 8 候选位）、图标字形变豆腐（只用内联 SVG 图标）、每帧重画图表（memo 按键缓存）。
(function (G) {
const UI = {};
UI.$ = id => document.getElementById(id);
UI.fmt = (n, d) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 }).replace(/,/g, ' ');
UI.sgn = (n, d) => { if (n == null || isNaN(n)) return '—'; const z = +Math.abs(n).toFixed(d || 0) === 0; return (z ? '±' : n > 0 ? '+' : '−') + UI.fmt(Math.abs(n), d); };   // 四舍五入为 0 的显示 ±0（不出现 −0.00）
UI.esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MC = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
UI.textW = (t, font) => { MC.font = font; return MC.measureText(t).width; };
// 内联 SVG 图标（不依赖字体：⏮⏭▶❚❚ 在部分环境是豆腐块）
const P = { play: 'M3 2l8 5-8 5z', pause: 'M3 2h3v10H3zM8 2h3v10H8z', prev: 'M2 2h2v10H2zM12 2v10L5 7z', next: 'M10 2h2v10h-2zM2 2v10l7-5z', first: 'M2 2h2v10H2zM12 2v10L5 7z', close: 'M3 2l4 4 4-4 1 1-4 4 4 4-1 1-4-4-4 4-1-1 4-4-4-4z', info: 'M6 2h2v2H6zM6 5h2v7H6z', check: 'M2 7l3 3 7-7 1 1-8 8-4-4z' };
UI.icon = k => `<svg class="i" viewBox="0 0 14 14" aria-hidden="true"><path d="${P[k]}"/></svg>`;
// 叠层 / 面板上的指针事件不得传到轨道相机（OrbitControls 在 pointerdown 时 setPointerCapture，会把 click 改投给画布）
UI.stopOrbit = el => { for (const ev of ['pointerdown', 'wheel', 'touchstart']) el.addEventListener(ev, e => e.stopPropagation(), { passive: true }); };
// 按键缓存：key 不变就不重画（图表、图纸、甘特 —— 不要每帧重建 DOM）
UI.memo = () => { let k0 = null; return (key, fn) => { if (key === k0) return false; k0 = key; fn(); return true; }; };
// 竖向分配：rows = [{min, pref, max?, flex?}] 在 total 内分配高度；先保底 min，再按 pref 补，剩余给 flex 行。返回 {h:[], scroll}
UI.fitRows = function (total, rows) {
  const h = rows.map(r => r.min); let left = total - h.reduce((a, b) => a + b, 0);
  if (left < 0) return { h, scroll: true, short: -left };
  for (let i = 0; i < rows.length && left > 0; i++) { const add = Math.min(left, Math.max(0, (rows[i].pref || rows[i].min) - h[i])); h[i] += add; left -= add; }
  const fl = rows.map((r, i) => r.flex ? i : -1).filter(i => i >= 0), fs = fl.reduce((a, i) => a + rows[i].flex, 0);
  for (const i of fl) { const add = left * rows[i].flex / fs; h[i] += rows[i].max ? Math.min(add, rows[i].max - h[i]) : add; }
  return { h: h.map(Math.floor), scroll: false };
};
const R = el => el.getBoundingClientRect();
UI.visible = el => { if (!el || !el.isConnected) return false; for (let e = el; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; } const r = R(el); return r.width > 0 && r.height > 0; };
UI.inter = (a, b, pad) => { pad = pad || 0; const w = Math.min(a.right, b.right) - Math.max(a.left, b.left) + pad, h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) + pad; return w > 0.5 && h > 0.5 ? w * h : 0; };
// 叠层管理：在容器里逐级收起（levels[k] = 容器上加的 class），直到可见叠层互不重叠、全在容器内、总面积 ≤ maxFrac
UI.Overlays = function (box, els, levels, maxFrac) {
  maxFrac = maxFrac || 0.32;
  const bad = () => { const br = R(box), vs = els().filter(UI.visible), rs = vs.map(R); let area = 0;
    for (let i = 0; i < rs.length; i++) { const a = rs[i]; area += a.width * a.height;
      if (a.left < br.left - 0.5 || a.right > br.right + 0.5 || a.top < br.top - 0.5 || a.bottom > br.bottom + 0.5) return true;
      for (let j = i + 1; j < rs.length; j++) if (UI.inter(a, rs[j], 2) > 0) return true; }
    return area > br.width * br.height * maxFrac; };
  return { level: 0, fit() { for (const c of levels) box.classList.remove(c); let k = 0; while (k < levels.length && bad()) box.classList.add(levels[k++]); this.level = k; return k; } };
};
// 浮动框位置：锚点 (x,y) 周围 8 个候选位里第一个不碰障碍、不出界的；都不行返回 null
UI.placeBox = function (x, y, w, h, W, H, obs, gap) {
  gap = gap == null ? 12 : gap;
  const C = [[gap, -h - gap], [gap, gap], [-w - gap, -h - gap], [-w - gap, gap], [-w / 2, -h - gap * 1.6], [-w / 2, gap * 1.6], [gap * 1.6, -h / 2], [-w - gap * 1.6, -h / 2]];
  for (const [dx, dy] of C) { const l = x + dx, t = y + dy; if (l < 6 || t < 6 || l + w > W - 6 || t + h > H - 6) continue;
    if (obs.every(o => l + w < o.left || l > o.right || t + h < o.top || t > o.bottom)) return { x: l, y: t }; }
  return null;
};
// 图钉：按优先级放，和已放的图钉 / 障碍相碰就沿 8 方向挪 ≤ maxShift，挪不开则隐藏（返回 [{...p, x, y, show}]）
UI.placePins = function (pins, r, W, H, obs, maxShift) {          // r = 图钉包围盒半宽（按方框判相交，与审计同一判据）
  const out = [], placed = []; maxShift = maxShift || 3 * r;
  const ok = (x, y) => x - r >= 2 && y - r >= 2 && x + r <= W - 2 && y + r <= H - 2 && placed.every(q => Math.abs(q.x - x) >= 2 * r + 2 || Math.abs(q.y - y) >= 2 * r + 2) && obs.every(o => x + r < o.left || x - r > o.right || y + r < o.top || y - r > o.bottom);
  for (const p of pins) { let s = null; if (p.on) for (let k = 0; k <= 3 && !s; k++) { const d = k * maxShift / 3; for (let a = 0; a < (k ? 8 : 1) && !s; a++) { const x = p.x + d * Math.cos(a * Math.PI / 4), y = p.y + d * Math.sin(a * Math.PI / 4); if (ok(x, y)) s = { x, y }; } }
    const q = Object.assign({}, p, s ? { x: s.x, y: s.y, show: true } : { show: false }); if (s) placed.push(q); out.push(q); }
  return out;
};
// 一维标注挑选：按优先级挑出间距 ≥ gap 的标注（时间轴标签、坐标轴、图纸标高都用它）
UI.pickLabels = function (items, gap, lo, hi) {
  const out = []; for (const it of items.slice().sort((a, b) => a.pri - b.pri)) { const a = it.x - (it.anchor === 'end' ? it.w : it.anchor === 'middle' ? it.w / 2 : 0), b = a + it.w;
    if (a < lo || b > hi) continue; if (out.every(o => b + gap <= o.a || a >= o.b + gap)) out.push(Object.assign({ a, b }, it)); }
  return out;
};
// ---------- SVG 图表 ----------
const NS = 'http://www.w3.org/2000/svg';
UI.svg = (tag, at, txt) => { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); if (txt != null) e.textContent = txt; return e; };
// 甘特：rows=[{name, bars:[{a,b,crit,cls,title}]}]，x ∈ [0,total]。返回每行 y（审计用）
UI.gantt = function (svg, o) {
  const W = o.w, H = o.h, LW = o.labelW || 70, top = o.top || 14, rh = Math.max(7, Math.min(18, (H - top - 4) / o.rows.length)), x = v => LW + (W - LW - 6) * v / o.total;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H); svg.innerHTML = '';
  const g = UI.svg('g', {}); svg.appendChild(g);
  // 年刻度
  const ticks = []; for (const tk of o.ticks || []) ticks.push({ x: x(tk.t), w: UI.textW(tk.label, '9px ' + o.mono), pri: tk.pri || 1, label: tk.label, anchor: 'middle' });
  for (const tk of UI.pickLabels(ticks, 6, LW - 2, W)) { g.appendChild(UI.svg('line', { x1: tk.x, x2: tk.x, y1: top - 2, y2: H, class: 'gt-grid' })); g.appendChild(UI.svg('text', { x: tk.x, y: 9, 'text-anchor': 'middle', class: 'gt-tick' }, tk.label)); }
  o.rows.forEach((r, i) => { const y = top + i * rh;
    g.appendChild(UI.svg('text', { x: LW - 6, y: y + rh * 0.74, 'text-anchor': 'end', class: 'gt-lab' + (r.crit ? ' crit' : ''), style: 'font-size:' + Math.min(9, rh * 0.74).toFixed(1) + 'px' }, r.name));
    const bh = Math.max(3, rh - 4);
    for (const b of r.bars) g.appendChild(UI.svg('rect', { x: x(b.a), y: y + (rh - bh) / 2, width: Math.max(1.2, x(b.b) - x(b.a)), height: bh, class: 'gt-bar ' + (b.cls || '') + (b.crit ? ' crit' : '') })); });
  const cur = UI.svg('line', { x1: x(o.t), x2: x(o.t), y1: top - 3, y2: H, class: 'gt-cur' }); g.appendChild(cur);
  return { x, rh, top, cur, setT(t) { const v = x(Math.min(o.total, Math.max(0, t))); cur.setAttribute('x1', v); cur.setAttribute('x2', v); } };
};
// 折线图：series=[{pts:[[x,y]], cls}]，x ∈ [0,xMax]，y ∈ [0,yMax]
UI.lines = function (svg, o) {
  const W = o.w, H = o.h, L = o.left || 34, B = o.bottom || 14, T = o.top || 6, X = v => L + (W - L - 6) * v / o.xMax, Y = v => H - B - (H - B - T) * v / o.yMax;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H); svg.innerHTML = '';
  const g = UI.svg('g', {}); svg.appendChild(g);
  const yl = []; for (const v of o.yTicks || []) yl.push({ x: Y(v), w: 9, pri: 1, v });
  for (const t of UI.pickLabels(yl.map(q => Object.assign(q, { anchor: 'middle' })), 3, T - 1, H - B + 5)) { g.appendChild(UI.svg('line', { x1: L, x2: W - 6, y1: Y(t.v), y2: Y(t.v), class: 'ch-grid' })); g.appendChild(UI.svg('text', { x: L - 4, y: Y(t.v) + 3, 'text-anchor': 'end', class: 'ch-tick' }, o.yFmt ? o.yFmt(t.v) : t.v)); }
  const xl = (o.xTicks || []).map(tk => ({ x: X(tk.t), w: UI.textW(tk.label, '9px ' + o.mono), pri: tk.pri || 1, label: tk.label, anchor: 'middle' }));
  for (const t of UI.pickLabels(xl, 6, L, W)) g.appendChild(UI.svg('text', { x: t.x, y: H - 3, 'text-anchor': 'middle', class: 'ch-tick' }, t.label));
  for (const s of o.series) { const d = s.pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(''); g.appendChild(UI.svg('path', { d, class: 'ch-line ' + (s.cls || '') })); }
  for (const m of o.marks || []) g.appendChild(UI.svg('circle', { cx: X(m.x), cy: Y(m.y), r: 2.6, class: 'ch-mark ' + (m.cls || '') }));
  const cur = UI.svg('line', { x1: X(0), x2: X(0), y1: T, y2: H - B, class: 'ch-cur' }); g.appendChild(cur);
  return { X, Y, setT(t) { const v = X(Math.min(o.xMax, Math.max(0, t))); cur.setAttribute('x1', v); cur.setAttribute('x2', v); } };
};
G.UI = UI;
})(typeof window !== 'undefined' ? window : globalThis);
