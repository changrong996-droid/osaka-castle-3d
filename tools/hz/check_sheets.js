'use strict';
// 无头检查 section/plan/lift/jack 四张图纸在代表性时刻与尺寸下能完整绘制并自报正确图号。
const { load, sheetCtx } = require('./harness');
const { HZ, HZS, makeCtx } = load();
HZ.make();
const SH = HZS.make(HZ);
const K = HZ.K;

const times = [0, K.deckS.start + 1, K.jig1.start + 5, K.lift1.start + 1.5, K.wlift.start + 2, K.head.end + 10, HZ.P.OPEN + 1];
const sizes = [[560, 420], [300, 160]];
const expect = { section: 'HZW-A-301', plan: 'HZW-A-101', lift: 'HZW-A-501', jack: 'HZW-S-301-1' };

let runs = 0;
for (const name of Object.keys(expect)) {
  for (const t of times) {
    for (const [w, h] of sizes) {
      const c = makeCtx();
      const ctx = sheetCtx();
      try {
        SH[name](c.g, w, h, t, ctx);
      } catch (e) {
        console.log(`FAIL check_sheets: ${name} t=${t} ${w}x${h} ${e && e.message}`);
        process.exit(1);
      }
      if (ctx.seenNo !== expect[name]) {
        console.log(`FAIL check_sheets: ${name} 图号 期望 ${expect[name]} 实得 ${ctx.seenNo}`);
        process.exit(1);
      }
      if (!((c.calls.fillRect || 0) >= 1) || !(c.texts.length >= 1)) {
        console.log(`FAIL check_sheets: ${name} t=${t} ${w}x${h} 未画图框或未写标题栏`);
        process.exit(1);
      }
      runs++;
    }
  }
}
console.log(`OK check_sheets fns=4 times=7 sizes=2 runs=${runs}`);
