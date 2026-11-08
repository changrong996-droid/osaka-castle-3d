'use strict';
// 加载无头基座，执行 HZ.make()/HZ.audit() 并断言构件计数基线。
const { load } = require('./harness');

const { HZ } = load();
HZ.make();
const audit = HZ.audit();

const checks = [
  ['acts.length', 55, HZ.acts.length],
  ['cells.length', 1432, HZ.cells.length],
  ['lifters.length', 32, HZ.lifters.length],
  ['D≈5.8', true, Math.abs(HZ.D - 5.8) < 1e-9, HZ.D],
  ['audit.zero', true, audit && audit.zero],
  ['keys(K).length', 55, Object.keys(HZ.K).length],
];
for (const [name, exp, got, raw] of checks) {
  if (got !== exp) {
    console.log(`FAIL check_make: ${name} 期望 ${exp} 实得 ${raw !== undefined ? raw : got}`);
    process.exit(1);
  }
}
console.log('OK check_make acts=55 cells=1432 lifters=32 D=5.8 zero=true');
