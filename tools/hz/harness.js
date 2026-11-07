'use strict';
// 在 Node vm 中加载 HZ 源文件并提供桩 2D 上下文的无头基座。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeCtx() {
  const calls = {};
  const texts = [];
  const g = new Proxy({}, {
    get(_t, name) {
      if (typeof name === 'symbol') return undefined;
      switch (name) {
        case 'measureText': return (s) => ({ width: String(s).length * 6 });
        case 'getTransform': return () => ({ a: 1 });
        case 'getImageData': return () => ({ data: new Uint8ClampedArray(48) });
        case 'createPattern': return () => 'pat';
        case 'canvas': return { width: 800, height: 600 };
        case 'fillText':
        case 'strokeText':
          return (s) => { texts.push(s); calls[name] = (calls[name] || 0) + 1; };
        default:
          return () => { calls[name] = (calls[name] || 0) + 1; };
      }
    },
    set() { return true; },
  });
  return { g, calls, texts };
}

function load(opts) {
  opts = opts || {};
  const G = vm.createContext({});
  G.window = G;
  G.self = G;
  G.document = { createElement: () => ({ width: 0, height: 0, getContext: () => makeCtx().g }) };
  const web = path.join(__dirname, '../../web');
  const files = ['core/seq.js', 'hzseq.js', 'hzsheet.js']
    .map((f) => path.join(web, f))
    .concat((opts.extra || []).map((f) => (path.isAbsolute(f) ? f : path.join(__dirname, '../..', f))));
  for (const f of files) vm.runInContext(fs.readFileSync(f, 'utf8'), G, { filename: f });
  return { G, HZ: G.HZ, SEQ: G.SEQ, HZS: G.HZS, makeCtx };
}

function sheetCtx(no, overrides) {
  const ctx = {
    tb: (w, h, no0, name, t) => {
      ctx.seenNo = no0;
      return { tb: 20, no: no0, name, scale: '1:—', rev: 1, date: '—', chk: '—', chkOk: true };
    },
    lastVe: 1,
    view: { k: 1, px: 0, py: 0 },
    hover: -1,
    sel: -1,
    zone: 0,
    cut: 0,
    hoverK: null,
    stroke: null,
    setScale: () => {},
  };
  return Object.assign(ctx, overrides);
}

module.exports = { load, makeCtx, sheetCtx };
