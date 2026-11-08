'use strict';
// 一键依次运行 HZ-01…HZ-05 的四个检查脚本，任一失败即停。
const { spawnSync } = require('child_process');
const path = require('path');

const scripts = ['check_make.js', 'check_sheets.js', 'check_atlas.js', 'check_real.js'];
for (const s of scripts) {
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.log('FAIL check_all at ' + s);
    process.exit(1);
  }
}
console.log('OK check_all ' + scripts.length + '/' + scripts.length);
