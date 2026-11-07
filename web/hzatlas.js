'use strict';
// 杭州西站图册登记表（页 / 图纸 / 四态表）与图号解析纯函数，无 DOM。
(function (G) {
  const HZA = {};
  HZA.VERSION = 1;
  HZA.PROJECT = 'HZW';
  const PFX = HZA.PROJECT + '-';

  HZA.PAGES = {
    'S-000': { title: '总图', on: 1, sheets: [] },
    'S-101': { title: '地下', on: 0, sheets: ['S-301-3'] },
    'S-201': { title: '承轨层', on: 0, sheets: ['S-301-3'] },
    'S-301': { title: '整体提升', on: 1, sheets: ['S-301-1', 'S-301-2', 'S-301-3', 'S-301-4'] },
    'S-401': { title: '屋面', on: 0, sheets: ['S-301-4', 'S-301-3'] },
    'S-501': { title: '开通', on: 0, sheets: [] },
  };

  HZA.SHEETS = {
    'S-301-1': { no: PFX + 'S-301-1', title: '千斤顶平面布置 · 剖面净空', fn: 'jack', canvas: 'sh-jack', owner: 'S-301', aliases: [] },
    'S-301-2': { no: PFX + 'S-301-2', title: '屋盖提升图', fn: 'lift', canvas: 'sh-s301-2', owner: 'S-301', aliases: ['HZW-A-501'] },
    'S-301-3': { no: PFX + 'S-301-3', title: '横剖面 B–B · x = 39 m', fn: 'section', canvas: 'sh-s301-3', owner: 'S-301', aliases: ['HZW-A-301'] },
    'S-301-4': { no: PFX + 'S-301-4', title: '屋盖网架平面', fn: 'plan', canvas: 'sh-s301-4', owner: 'S-301', aliases: ['HZW-A-101'] },
  };

  const slot = (status, note) => ({ status, note });
  const sub = (sheetSlot) => ({
    sheet: sheetSlot,
    grow: slot('有', '包含在 S-000 时间轴内，无独立时间窗'),
    built: slot('部分', '同 S-000'),
    real: slot('无', '见 hzreal.js'),
  });
  HZA.FORMS = {
    'S-000': {
      sheet: slot('无', '3D 总图无 2D 图纸'),
      grow: slot('有', '全工期 0 → OPEN+30'),
      built: slot('部分', 't ≥ OPEN 终态 + 竣工章，无验收字段'),
      real: slot('无', '见 hzreal.js'),
    },
    'S-301': {
      sheet: slot('有', 'S-301-1…4'),
      grow: slot('有', 'K.lift1.start → K.head.end，按小时加权'),
      built: slot('部分', '同上'),
      real: slot('无', '同上'),
    },
    'S-101': sub(slot('部分', '交叉引用 S-301-3')),
    'S-201': sub(slot('部分', '交叉引用 S-301-3')),
    'S-401': sub(slot('部分', '交叉引用 S-301-4、S-301-3')),
    'S-501': sub(slot('无', '无独立图纸')),
  };

  const strip = (s) => (s.startsWith(PFX) ? s.slice(PFX.length) : s);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  HZA.resolve = function (id) {
    if (typeof id !== 'string') return null;
    if (has(HZA.SHEETS, id)) return id;
    const s = strip(id);
    if (has(HZA.SHEETS, s)) return s;
    for (const k of Object.keys(HZA.SHEETS)) {
      for (const a of HZA.SHEETS[k].aliases) if (strip(a) === s) return k;
    }
    return null;
  };

  HZA.sheetsOf = function (page) {
    if (!has(HZA.PAGES, page)) return [];
    return HZA.PAGES[page].sheets.map((id) => Object.assign({ id }, HZA.SHEETS[id]));
  };

  HZA.wrapFn = function (fn, no) {
    return (g, w, h, t, ctx) => fn(g, w, h, t, Object.assign({}, ctx, { tb: (w2, h2, _no, name, t2) => ctx.tb(w2, h2, no, name, t2) }));
  };

  G.HZA = HZA;
})(typeof window !== 'undefined' ? window : globalThis);
