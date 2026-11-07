'use strict';
// 杭州西站实物层记录库（照片 / 实测 / 文献）的记录格式与示例记录，无 DOM。
(function (G) {
  const HZR = {};
  HZR.VERSION = 1;

  HZR.RECORDS = [
    { id: 'R-0001', sheet: 'S-301', kind: 'doc', date: '2021-06-30', t: null, src: { title: '央广网 2021-06-30（206 台提升器、6-28 提升完成）', url: 'http://news.cnr.cn/native/city/20210630/t20210630_525524643.shtml', license: '公开报道，仅引用' }, cam: null, anchor: null, note: '示例：来源取自 hzseq.js 的 HZ.SOURCES', example: true },
  ];

  G.HZR = HZR;
})(typeof window !== 'undefined' ? window : globalThis);
