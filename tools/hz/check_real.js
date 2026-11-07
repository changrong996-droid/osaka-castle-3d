'use strict';
// 校验 web/hzreal.js 实物层记录的字段格式、唯一性与引用可解析性。
// 西站专属断言（如 sheet 必须落在西站登记表内）为项目级检查，不属于内核。
const { load } = require('./harness');
const { G, HZ } = load({ extra: ['web/hzatlas.js', 'web/hzreal.js'] });
const HZA = G.HZA, HZR = G.HZR;
HZ.make();

function fail(msg) { console.log('FAIL check_real: ' + msg); process.exit(1); }

const KNOWN = ['id', 'sheet', 'kind', 'date', 't', 'src', 'cam', 'anchor', 'note', 'example'];
const KINDS = ['photo', 'measure', 'doc'];
const CAM = ['az', 'el', 'd', 'tx', 'ty', 'tz'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const calDays = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
const validDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

if (!Array.isArray(HZR.RECORDS)) fail('RECORDS 不是数组');
const tMax = HZ.P.OPEN + 30;
const ids = new Set();
const devs = [];
let examples = 0;

HZR.RECORDS.forEach((r, i) => {
  if (!isObj(r)) fail('#' + i + ' 不是对象');
  const id = r.id;
  if (typeof id !== 'string' || !/^R-\d{4}$/.test(id)) fail('#' + i + ' id 格式非法: ' + id);
  if (ids.has(id)) fail(id + ' id 重复');
  ids.add(id);

  for (const k of Object.keys(r)) if (!KNOWN.includes(k)) console.log('WARN check_real: ' + id + ' 未知字段 ' + k);

  if (typeof r.sheet !== 'string' || !(has(HZA.PAGES, r.sheet) || HZA.resolve(r.sheet) !== null)) fail(id + ' sheet 无法解析: ' + r.sheet);
  if (!KINDS.includes(r.kind)) fail(id + ' kind 非法: ' + r.kind);
  if (!validDate(r.date)) fail(id + ' date 非法: ' + r.date);
  if (r.t !== null && (!isNum(r.t) || r.t < 0 || r.t > tMax)) fail(id + ' t 非法（须为 null 或 0…' + tMax + '）: ' + r.t);

  const s = r.src;
  if (!isObj(s)) fail(id + ' src 不是对象');
  if (typeof s.title !== 'string' || !s.title) fail(id + ' src.title 须为非空字符串');
  if (typeof s.license !== 'string' || !s.license) fail(id + ' src.license 须为非空字符串');
  if (typeof s.url !== 'string') fail(id + ' src.url 须为字符串');
  if (s.url === '') {
    if (s.license !== 'own') fail(id + ' src.url 为空时 license 必须为 own');
  } else if (!/^https?:\/\//.test(s.url) && !(/^[^:\s]+$/.test(s.url) && !/^\//.test(s.url))) {
    fail(id + ' src.url 形式非法: ' + s.url);
  }

  if (r.cam !== null) {
    if (!isObj(r.cam)) fail(id + ' cam 须为对象或 null');
    for (const k of CAM) if (!has(r.cam, k) || !isNum(r.cam[k])) fail(id + ' cam.' + k + ' 须为数字');
    for (const k of Object.keys(r.cam)) if (!CAM.includes(k)) fail(id + ' cam 含多余键 ' + k);
  }

  const a = has(r, 'anchor') ? r.anchor : null;
  if (a !== null) {
    if (typeof a !== 'string' || !(/^J\d+$/.test(a) || ['ZN', 'ZM', 'ZS', 'CUT', 'GAP'].includes(a) || has(HZ.K, a))) fail(id + ' anchor 无法解析: ' + a);
  }

  if (typeof r.note !== 'string') fail(id + ' note 须为字符串');
  if (has(r, 'example') && typeof r.example !== 'boolean') fail(id + ' example 须为布尔');
  if (r.example === true) examples++;

  if (r.t !== null && r.date !== null) {
    const dev = r.t - (calDays(r.date) - calDays(HZ.dayDate(0)));
    devs.push('deviation: ' + id + '=' + (dev >= 0 ? '+' : '-') + Math.abs(dev).toFixed(1) + 'd');
  }
});

console.log('OK check_real records=' + HZR.RECORDS.length + ' examples=' + examples + (devs.length ? ' ' + devs.join(' ') : ''));
