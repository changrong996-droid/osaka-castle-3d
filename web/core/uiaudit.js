'use strict';
// ===== 通用界面审计（proto-port1）：由审计驱动注入页面，window.__uiaudit(cfg) → 问题列表 =====
// 只数“真的看得见”的元素：自身与所有祖先都不是 display:none / visibility:hidden / opacity:0，且有面积（proto3 教训：隐藏的标注被计入）。
// cfg = { root, overlays:{box, sel:[...]}, panels:[...], svgText:[{sel, box?}], minSize:[{sel,w?,h?}], noScroll, checks:()=>[] }
(function (G) {
  const R = el => el.getBoundingClientRect();
  const vis = el => { if (!el || !el.isConnected) return false; for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; } const r = R(el); return r.width > 0 && r.height > 0; };
  const inter = (a, b) => { const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); return w > 0.5 && h > 0.5 ? w * h : 0; };
  const nm = el => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '')) + (el.textContent ? '「' + el.textContent.trim().slice(0, 16) + '」' : '');
  const scrollable = e => { for (let q = e.parentElement; q && q !== document.body; q = q.parentElement) if (/auto|scroll/.test(getComputedStyle(q).overflowY)) return true; return false; };
  G.__uiaudit = function (cfg) {
    const I = [], W = innerWidth, H = innerHeight, root = document.querySelector(cfg.root || 'body');
    // 1. 文本截断 / 被祖先裁掉 / 出屏（叶子文本元素）
    for (const e of root.querySelectorAll('*')) {
      if (e.children.length || !e.textContent.trim() || e.closest('svg') || !vis(e)) continue;
      const cs = getComputedStyle(e), r = R(e);
      if (cs.display !== 'inline' && e.scrollWidth > e.clientWidth + 1 && (cs.overflow !== 'visible' || cs.textOverflow === 'ellipsis')) I.push({ k: 'truncate', el: nm(e), sw: e.scrollWidth, cw: e.clientWidth });
      for (let p = e.parentElement; p && p !== root.parentElement; p = p.parentElement) { const pc = getComputedStyle(p); if (pc.overflowX === 'visible' && pc.overflowY === 'visible') continue; if (/auto|scroll/.test(pc.overflowY)) break; const pr = R(p);
        if (r.bottom > pr.bottom + 1.5 || r.right > pr.right + 1.5 || r.top < pr.top - 1.5 || r.left < pr.left - 1.5) { I.push({ k: 'clipped', el: nm(e), by: nm(p), dx: Math.round(r.right - pr.right), dy: Math.round(r.bottom - pr.bottom) }); break; } }
      if (!scrollable(e) && (r.right > W + 1 || r.left < -1 || r.bottom > H + 1 || r.top < -1)) I.push({ k: 'offscreen', el: nm(e) });
      // 图标字形：媒体控制 / 几何符号走字体回退会变豆腐，统一要求内联 SVG
      if (/[\u23e9-\u23ff\u25b6\u25c0\u275a\u2716\u2714\u2715]/.test(e.textContent)) I.push({ k: 'glyph-font', el: nm(e) });
    }
    // 2. 叠层：互不重叠、全在容器内
    if (cfg.overlays) { const box = document.querySelector(cfg.overlays.box), br = R(box), L = cfg.overlays.sel.flatMap(s => [...document.querySelectorAll(s)]).filter(vis);
      for (let i = 0; i < L.length; i++) { const a = R(L[i]); if (a.left < br.left - 1 || a.right > br.right + 1 || a.top < br.top - 1 || a.bottom > br.bottom + 1) I.push({ k: 'overlay-out', el: nm(L[i]) });
        for (let j = i + 1; j < L.length; j++) if (L[i].contains(L[j]) || L[j].contains(L[i])) continue; else if (inter(a, R(L[j])) > 0) I.push({ k: 'overlay-overlap', a: nm(L[i]), b: nm(L[j]) }); } }
    // 3. 面板：互不重叠、在窗口内
    const P = (cfg.panels || []).map(s => document.querySelector(s)).filter(vis);
    for (let i = 0; i < P.length; i++) { const a = R(P[i]); if (!cfg.allowScroll && (a.right > W + 1 || a.bottom > H + 1)) I.push({ k: 'panel-out', el: nm(P[i]) }); for (let j = i + 1; j < P.length; j++) if (inter(a, R(P[j])) > 0) I.push({ k: 'panel-overlap', a: P[i].id, b: P[j].id }); }
    // 4. SVG 文字：互不重叠、在图框内
    for (const sv of cfg.svgText || []) for (const svg of document.querySelectorAll(sv.sel)) { if (!vis(svg)) continue; const fr = R(sv.box ? svg.closest(sv.box) : svg), T = [...svg.querySelectorAll('text')].filter(t => t.textContent.trim() && vis(t)), TR = T.map(R);
      for (let i = 0; i < T.length; i++) { const a = TR[i]; if (a.left < fr.left - 1 || a.right > fr.right + 1 || a.top < fr.top - 1 || a.bottom > fr.bottom + 1) I.push({ k: 'svg-label-out', svg: sv.sel, t: T[i].textContent.trim() });
        for (let j = i + 1; j < T.length; j++) if (inter(a, TR[j]) > 1) I.push({ k: 'svg-label-overlap', svg: sv.sel, a: T[i].textContent.trim(), b: T[j].textContent.trim() }); } }
    // 5. 保底尺寸（矮宽窗口 3D 区不得被压扁）
    for (const m of cfg.minSize || []) { const e = document.querySelector(m.sel); if (!vis(e)) { I.push({ k: 'missing', el: m.sel }); continue; } const r = R(e); if ((m.h && r.height < m.h) || (m.w && r.width < m.w)) I.push({ k: 'too-small', el: m.sel, w: Math.round(r.width), h: Math.round(r.height) }); }
    // 6. 整页不滚动（核心信息一屏看全）
    if (cfg.noScroll && document.scrollingElement.scrollHeight > H + 1) I.push({ k: 'page-scroll', over: document.scrollingElement.scrollHeight - H });
    // 7. 页面自己的数字一致性检查
    if (cfg.checks) for (const x of cfg.checks()) I.push(x);
    return I;
  };
  G.__vis = vis;
})(window);
