'use strict';
// ===== 杭州西站 建造过程 · r2「机器在实时推演并出图」（hzwest-r2）=====
// 一屏：左 = 3D（默认墨线图：黑墨已建、红色当前、淡红幽灵未建；可切实景）+ 计算读数；右 = 三张实时图纸（同一份构件 / 姿态 / 时刻，只在时间变化时重画）；底 = 时间轴。
// 结尾开通：墨线淡出，过渡到黄金时刻实景（look.js），图纸盖“竣工”。顺序来自 hzseq.js（规则 → core/seq.js 排程），审计在 Worker 里跑，读数按时间累计显示审计真实做过的检查次数。
(function () {
  const THREE_BASE = 'https://unpkg.com/three@0.160.0/';
  const $ = id => document.getElementById(id), hp = new URLSearchParams(location.hash.slice(1));
  const HZ = window.HZ, SEQ = window.SEQ, S = window.__pv = { ready: false, frames: 0, calls: 0, auditDone: false, sheetDraws: 0, st: { t: 0, u: 0, play: false, auto: true, info: false, pref: hp.get('mode') === 'lit' ? 'lit' : 'ink' } };
  const SHEETS_ALL = [['S-000', '总图', 1], ['S-101', '地下', 0], ['S-201', '承轨层', 0], ['S-301', '整体提升', 1], ['S-401', '屋面', 0], ['S-501', '开通', 0]];
  const sheetOf = () => { const v = (new URLSearchParams(location.hash.slice(1)).get('sheet') || 'S-000').toUpperCase(); return v === 'S-301' ? 'S-301' : 'S-000'; };
  const ICON = { play: 'M3 1.5v11l9.5-5.5z', pause: 'M2.5 1.5h3.2v11H2.5zM8.3 1.5h3.2v11H8.3z' };
  const icon = k => `<svg class="i" viewBox="0 0 14 14" aria-hidden="true"><path d="${ICON[k]}"/></svg>`;
  const fmt = n => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  let TL = null, TLF = null;
  // set1 图册：S-000 总图 = 全工期（提升段只放慢 4×）；S-301 整体提升详图 = 南区旋转提升开始 → 柱头连接卸载完成，按小时加权（作业时段慢放、夜间 / 合龙快进）
  function timeline(sheet) {
    const K = HZ.K, OPEN = HZ.P.OPEN, FIN = 30, Tmax = OPEN + FIN;
    let t0 = 0, t1 = Tmax, R = 4, w, playSec = 72;
    const l0 = K.lift1.start - 2, l1 = K.head.end + 2, a0 = K.jig1.start, a1 = K.lift1.start;
    if (sheet === 'S-301') { t0 = K.lift1.start; t1 = K.head.end; R = 96; playSec = 150;
      w = t => { const hd = (t - Math.floor(t)) * 24, day = hd >= 8 && hd < 18; for (const k of ['lift1', 'lift2', 'lift3']) { const A = K[k]; if (t >= A.start && t < A.end) return day ? (k === 'lift2' ? 0.6 : 1) : 0.1; }
        if (t >= K.wlift.start && t < K.wlift.end) return day ? 1.7 : 0.12; return 0.07; }; }
    else w = t => { let v = 1; if (t >= l0 && t <= l1) v = 4; else if (t > a0 && t < a1) v = 2.2; else if (t > OPEN - 14) v = 2.6; else if (t < 300) v = 0.55; return v; };
    const N = Math.round((t1 - t0) * R), cum = new Float64Array(N + 1); for (let i = 1; i <= N; i++) cum[i] = cum[i - 1] + w(t0 + (i - 0.5) / R) / R;
    const L = cum[N]; for (let i = 0; i <= N; i++) cum[i] /= L;
    const t2u = t => { const x = Math.max(0, Math.min(N, (t - t0) * R)), i = Math.min(N - 1, Math.floor(x)); return cum[i] + (cum[i + 1] - cum[i]) * (x - i); };
    const u2t = u => { u = Math.max(0, Math.min(1, u)); let lo = 0, hi = N; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= u) lo = m; else hi = m; } const f = (u - cum[lo]) / Math.max(1e-12, cum[hi] - cum[lo]); return t0 + (lo + f) / R; };
    return { sheet, t0, t1, Tmax, OPEN, t2u, u2t, l0, l1, playSec };
  }

  async function main() {
    const im = document.createElement('script'); im.type = 'importmap';
    const loc = hp.get('three') === 'local';
    im.textContent = JSON.stringify({ imports: loc ? { three: new URL('vendor/three.module.js', document.baseURI).href } : { three: THREE_BASE + 'build/three.module.js', 'three/addons/': THREE_BASE + 'examples/jsm/' } });
    document.head.appendChild(im);
    const [THREE, { OrbitControls }] = await Promise.all([import('three'), import(loc ? new URL('vendor/OrbitControls.js', document.baseURI).href : 'three/addons/controls/OrbitControls.js')]);
    run(THREE, OrbitControls);
  }

  function run(THREE, OrbitControls) {
    const T0 = performance.now();
    // r3 结尾变体参数（#fv=键:值,…；rw 屋盖材质 0–4、re 挑檐加厚 m、pv 光伏 0 角瓣/1 顺轨条带/2 垂轨条带/3 等高环带、cam 结尾机位、tz 列车股道 z、te 车头停位 x、tw 从西进站、dk 黄昏 0–1、lt 亮灯强度、se 结尾太阳高度°、ik 墨线淡出比例、tl 车窗亮度）；默认值 = r3 闭环终选（work/hzwest3/PROGRESS.md）
    const FV = Object.assign({ rw: 4, re: 3.5, pv: 1, cam: 14, tz: -98.5, te: -240, tw: 1, dk: 0.6, lt: 4.5, se: 9, ik: 0.95, tl: 30 }, Object.fromEntries((hp.get('fv') || '').split(',').filter(Boolean).map(kv => { const [k, v] = kv.split(':'); return [k, +v]; }))); S.FV = FV;
    HZ.P.edgeDrop = FV.re;
    if (FV.rw >= 1) { Object.assign(HZ.MAT.clad, { c: [0.975, 0.975, 0.97], r: 0.52, m: 0.06 }); Object.assign(HZ.MAT.soffit, { c: [0.96, 0.95, 0.92] }); }   // r3：白色哑光铝板（原 m 0.5 反射暗环境 → 发灰）
    HZ.make(); const TLS = { 'S-000': timeline('S-000'), 'S-301': timeline('S-301') }; let SHEET = sheetOf(); TL = TLS[SHEET]; TLF = TLS['S-000']; S.TLS = TLS; S.Tmax = TLF.Tmax; S.OPEN = TLF.OPEN; S.HZ = HZ; const K = HZ.K, P = HZ.P;
    const SH = window.HZS.make(HZ); S.SH = SH;
    const canvas = $('gl'), v3 = $('v3');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: hp.get('shot') === '1' });
    renderer.info.autoReset = false;
    const FX = window.CASTLE_FX.make(THREE), qArg = hp.has('q') ? +hp.get('q') : -1, QD = FX.detect(renderer, qArg); FX.q = QD.q; S.q = QD.q; S.gpu = QD.gpu || '';
    try { const g = renderer.getContext(), e = g.getExtension('WEBGL_debug_renderer_info'); S.gpu = e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); } catch (e) { }
    const QS = [{ pr: 1, sm: 2048 }, { pr: 1.5, sm: 2048 }, { pr: 2, sm: 4096 }];
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.8;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(28, 1, 4, 40000);
    const view = $('view');
    const ctl = new OrbitControls(cam, view); ctl.enableDamping = true; ctl.dampingFactor = 0.08; ctl.maxPolarAngle = Math.PI * 0.49; ctl.minDistance = 90; ctl.maxDistance = 4200; ctl.screenSpacePanning = false; ctl.zoomSpeed = 0.8;

    // ---------------- 实景层（preview1 的观感：黄金时刻 + HDR 后处理）----------------
    const T = Object.assign({}, FX.TOD.g), LOOK = window.CASTLE_LOOK.make(THREE);
    const look = { sunAz: +(hp.get('saz') || 232), sunEl: +(hp.get('sel') || 6), exp: +(hp.get('exp') || 1.1), sat: 1, warm: 1 }; S.look = look;
    const sunDir = new THREE.Vector3(), sun = new THREE.DirectionalLight(0xfff0dc, T.I), hemi = new THREE.HemisphereLight(0xc9d8f0, 0x6a5c4a, 1.05);
    sun.castShadow = true; sun.shadow.mapSize.set(QS[FX.q].sm, QS[FX.q].sm); Object.assign(sun.shadow.camera, { left: -520, right: 520, top: 420, bottom: -420, near: 50, far: 4000 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.9;
    scene.add(sun, sun.target, hemi); scene.add(LOOK.sky); const MTN = LOOK.mountains(3); MTN.scale.set(0.5, 0.32, 0.5); scene.add(MTN);
    const POST = LOOK.post(renderer); POST.level = FX.q;
    const envMats = [];
    function applyLook() {
      const az = THREE.MathUtils.degToRad(look.sunAz), el = THREE.MathUtils.degToRad(look.sunEl);
      sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
      sun.color.setRGB(T.sun[0], T.sun[1], T.sun[2]); sun.intensity = T.I * 1.05; sun.position.copy(sunDir).multiplyScalar(2000); sun.target.position.set(0, 0, 20);
      LOOK.setSky(T, sunDir, FX.q); MTN.material.uniforms.near.value.fromArray(T.mtn[0]); MTN.material.uniforms.far.value.fromArray(T.mtn[1]);
      FX.setEnv(FX.env(renderer, 'ext', T, sunDir)); for (const m of envMats) { m.envMap = FX.envTex; m.needsUpdate = true; }
      renderer.shadowMap.needsUpdate = true; dirty = true; }

    // ---------------- 构件：1 个网格（实景 / 墨线两套材质）+ 1 组墨线 ----------------
    const U = { uT: { value: 0 }, uG: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Matrix4()) }, uGlowDays: { value: 6 }, uGlowCol: { value: new THREE.Vector3(1.0, 0.58, 0.26).multiplyScalar(0.6) }, uLights: { value: 0 }, uPV: { value: 0 }, uPVs: { value: 0 }, uRoofLift: { value: 0 }, uWave: { value: 0 }, uLightCol: { value: new THREE.Vector3(1.0, 0.78, 0.5) },
      uPaper: { value: new THREE.Color('#efe9dd') }, uRed: { value: new THREE.Color('#b3202a') }, uInk: { value: new THREE.Color('#1d1a17') }, uTemp: { value: new THREE.Color('#c46a12') }, uSun2: { value: new THREE.Vector3(-0.45, 0.8, 0.4).normalize() }, uLA: { value: 1 }, uGhost: { value: 1 }, uMv: { value: [0, 0, 0, 0, 0, 0] }, uCam: { value: new THREE.Vector3() }, uCut: { value: -1e9 } };
    // set2c：统一剖切平面 x = 39 m（切掉 x < 39）。自定义着色器用 uCut（-1e9 = 不切）；内置材质常驻 clippingPlanes=[CUTP]，关闭时把平面推到 1e7 外 → 切换不重新编译
    const CUTP = new THREE.Plane(new THREE.Vector3(1, 0, 0), 1e7); renderer.localClippingEnabled = true; S.CUTP = CUTP;
    const VDEF = `attribute vec4 aK; attribute vec2 aR; attribute vec2 aY; attribute float aG; attribute vec4 aM;
      uniform float uT, uGlowDays; uniform mat4 uG[6]; varying vec4 vM; varying float vGlow; varying vec3 vWq; mat4 hzM; vec3 hzP;
      void hzCalc() { float s = aK.x, d = max(aK.y, 1e-3), p = clamp((uT - s) / d, 0.0, 1.0), r = 1.0;
        if (aR.x >= 0.0) r = 1.0 - clamp((uT - aR.x) / max(aR.y, 1e-3), 0.0, 1.0);
        float k = p * r; k = k * k * (3.0 - 2.0 * k); vec3 q = position; q.y = aY.x + (q.y - aY.x) * k;
        hzM = uG[int(aG + 0.5)]; hzP = (hzM * vec4(q, 1.0)).xyz; if (uT < s || k < 1e-4) hzP = vec3(0.0, -1e5, 0.0);
        vGlow = uT >= s ? (1.0 - smoothstep(s + d, s + d + uGlowDays, uT)) * (aR.x >= 0.0 && uT > aR.x ? 0.0 : 1.0) : 0.0; vM = aM; vWq = q; }
`;
    const PK = HZ.PVK, PP = HZ.P;
    const PVGLSL = `varying vec4 vM; varying float vGlow; varying vec3 vWq; uniform vec3 uGlowCol, uLightCol; uniform float uLights, uPV, uPVs, uRoofLift, uWave;
      float hzSm(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
      float hzPVMask(vec2 p) { float th = atan(p.y, p.x), c = abs(cos(th)) / ${PP.roofA.toFixed(2)}, s = abs(sin(th)) / ${PP.roofB.toFixed(2)};
        float R = pow(pow(c, 4.0) + pow(s, 4.0), -0.25) * (1.0 + 0.022 * sin(8.0 * th + 0.6) + 0.012 * sin(13.0 * th)), r = length(p) / R, u = abs(p.x) / ${PP.roofA.toFixed(2)}, v = abs(p.y) / ${PP.roofB.toFixed(2)};
        return hzSm(${PK[0].toFixed(3)}, ${(PK[0] + 0.04).toFixed(3)}, r) * (1.0 - hzSm(${(PK[1] - 0.04).toFixed(3)}, ${PK[1].toFixed(3)}, r)) * hzSm(${PK[2].toFixed(3)}, ${(PK[2] + 0.04).toFixed(3)}, u) * hzSm(${PK[2].toFixed(3)}, ${(PK[2] + 0.04).toFixed(3)}, v); }
`;
    function patchStd(mat) {
      mat.onBeforeCompile = sh => { Object.assign(sh.uniforms, U);
        sh.vertexShader = VDEF + sh.vertexShader.replace('#include <beginnormal_vertex>', 'hzCalc();\nvec3 objectNormal = mat3(hzM) * normal;').replace('#include <begin_vertex>', 'vec3 transformed = hzP;');
        sh.fragmentShader = PVGLSL + sh.fragmentShader
          .replace('#include <color_fragment>', '#include <color_fragment>\nfloat hzPV = 0.0; if (vM.w > 0.5 && vM.w < 1.5) { hzPV = hzPVMask(vWq.xz) * step(vWq.z, mix(-170.0, 175.0, uPV)); if (uPVs > 0.5) { float sc = uPVs < 1.5 ? vWq.z / 6.0 : uPVs < 2.5 ? vWq.x / 6.0 : length(vWq.xz / vec2(' + PP.roofA.toFixed(1) + ', ' + PP.roofB.toFixed(1) + ')) * 24.0; float fs = abs(fract(sc) - 0.5), aw = fwidth(sc) * 1.2; hzPV *= 1.0 - smoothstep(0.31 - aw, 0.31 + aw, fs); } vec2 sd = abs(fract(vWq.xz / vec2(3.5, 1.75)) - 0.5); float ln = 1.0 - smoothstep(0.0, fwidth(vWq.x / 3.5) * 1.5, 0.5 - sd.x); diffuseColor.rgb *= 1.0 - 0.06 * ln; vec2 pc = abs(fract(vWq.xz / vec2(2.0, 1.0)) - 0.5); float pl = max(1.0 - smoothstep(0.0, fwidth(vWq.x / 2.0) * 1.2, 0.5 - pc.x), 1.0 - smoothstep(0.0, fwidth(vWq.z) * 1.2, 0.5 - pc.y)); diffuseColor.rgb = mix(diffuseColor.rgb, uPVs > 0.5 ? vec3(0.07, 0.12, 0.26) * (1.0 - 0.3 * pl) + vec3(0.30) * pl : vec3(0.16, 0.26, 0.48) * (1.0 - 0.35 * pl) + vec3(0.12) * pl, hzPV); }\nif (vM.w > 1.5) { vec2 gc = abs(fract(vWq.xz / vec2(2.4, 2.4)) - 0.5); float gl = max(1.0 - smoothstep(0.0, fwidth(vWq.x / 2.4) * 1.3, 0.5 - gc.x), 1.0 - smoothstep(0.0, fwidth(vWq.z / 2.4) * 1.3, 0.5 - gc.y)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75), gl * 0.6); }')
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(vM.x, 0.18, hzPV);').replace('#include <metalnessmap_fragment>', 'float metalnessFactor = mix(vM.y, 0.6, hzPV);')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nfloat hzWv = uWave > 0.0 ? hzSm(0.0, 30.0, uWave - length(vWq.xz)) : 1.0; totalEmissiveRadiance += uGlowCol * vGlow * (0.35 + 0.65 * vGlow) + diffuseColor.rgb * uLightCol * vM.z * uLights * hzWv; if (vM.w > 0.5 && vM.w < 1.5) totalEmissiveRadiance += diffuseColor.rgb * uRoofLift * (1.0 - hzPV);'); };
      mat.customProgramCacheKey = () => 'hz-std'; return mat; }
    function patchDepth(mat) { mat.onBeforeCompile = sh => { Object.assign(sh.uniforms, U); sh.vertexShader = VDEF + sh.vertexShader.replace('#include <begin_vertex>', 'hzCalc();\nvec3 transformed = hzP;'); }; mat.customProgramCacheKey = () => 'hz-depth'; return mat; }
    // 墨线·淡彩填充：纸色 + 三档明暗；当前构件红
    const inkMat = new THREE.ShaderMaterial({ uniforms: U, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      vertexShader: VDEF + `attribute vec3 color; attribute float aF; uniform float uMv[6]; varying vec3 vN; varying vec3 vC; varying float vCur; varying float vTmp; varying float vMv; varying float vWx; void main() { hzCalc(); vWx = hzP.x; vMv = uMv[int(aG + 0.5)]; vN = mat3(hzM) * normal; vC = color; vTmp = aF; vCur = vGlow > 0.0 && uT < aK.x + aK.y + 2.0 ? 1.0 : 0.0; gl_Position = projectionMatrix * viewMatrix * vec4(hzP, 1.0); }`,
      fragmentShader: `uniform vec3 uPaper, uRed, uSun2, uTemp; uniform float uCut; varying vec3 vN; varying vec3 vC; varying float vCur; varying vec4 vM; varying float vTmp; varying float vMv; varying float vWx;
        void main() { if (vWx < uCut) discard; vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; float l = dot(n, uSun2); vec3 c = pow(vC, vec3(1.0 / 2.2)); vec3 base = vTmp > 0.5 ? mix(uPaper, uTemp, 0.55) : mix(uPaper, c, 0.34);
          float f = l > 0.5 ? 1.0 : (l > 0.08 ? 0.9 : 0.8); if (n.y > 0.8) f = 1.03; vec3 col = base * f;
          if (l < 0.08 && n.y < 0.5) col *= 1.0 - 0.07 * step(0.75, fract((gl_FragCoord.x - gl_FragCoord.y) / 4.0));
          if (vCur > 0.5 && vTmp < 0.5) col = mix(col, uRed, 0.5); if (vMv > 1.5 && vTmp < 0.5) col = mix(col, uRed, 0.5); else if (vMv > 0.5 && vTmp < 0.5) col = mix(col, uRed, 0.28); gl_FragColor = vec4(col, 1.0); }` });
    // 墨线：未建 = 设计位幽灵（淡红）/ 在建 = 红 / 已建 = 墨 / 临时 = 橙；随姿态矩阵移动
    const LVS = `attribute vec4 aK; attribute vec2 aR; attribute vec2 aY; attribute float aG; attribute float aF; uniform float uT, uGlowDays; uniform mat4 uG[6]; uniform float uMv[6]; uniform vec3 uCam; varying float vS; varying float vF; varying float vD; varying float vMv; varying float vWx;
      void main() { vMv = uMv[int(aG + 0.5)]; float s = aK.x, d = max(aK.y, 1e-3), p = clamp((uT - s) / d, 0.0, 1.0), r = 1.0; if (aR.x >= 0.0) r = 1.0 - clamp((uT - aR.x) / max(aR.y, 1e-3), 0.0, 1.0);
        float k = p * r; k = k * k * (3.0 - 2.0 * k); vec3 q = position; mat4 M = uG[int(aG + 0.5)];
        if (uT < s) { vS = -1.0; M = mat4(1.0); } else { q.y = aY.x + (q.y - aY.x) * k; vS = uT < s + d + 2.0 ? 0.5 : 2.0; if (k < 1e-4) vS = -3.0; }
        vec4 w = M * vec4(q, 1.0); vWx = w.x; vF = aF; vD = distance(w.xyz, uCam); gl_Position = projectionMatrix * viewMatrix * w; }`;
    const LFS = `uniform vec3 uInk, uRed, uTemp; uniform float uLA, uGhost, uCut; varying float vS; varying float vF; varying float vD; varying float vMv; varying float vWx;
      void main() { if (vS < -2.0 || vWx < uCut) discard; float fade = 1.0 - 0.55 * smoothstep(900.0, 3000.0, vD);
        if (vS < 0.0) { if (uGhost < 0.5 || vF > 0.5) discard; gl_FragColor = vec4(uRed, 0.085 * uLA * fade); return; }
        if (vS < 1.0) { gl_FragColor = vec4(uRed, uLA); return; }
        if (vMv > 1.5 && vF < 0.5) { gl_FragColor = vec4(uRed, uLA); return; } if (vMv > 0.5 && vF < 0.5) { gl_FragColor = vec4(mix(uInk, uRed, 0.8), 0.85 * uLA); return; } gl_FragColor = vec4(vF > 0.5 ? uTemp : uInk, (vF > 1.5 ? 0.55 : 0.72) * uLA * fade); }`;
    const lineMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: LVS, fragmentShader: LFS, transparent: true, depthWrite: false });

    const trainGeo = (() => { const g = new HZ.GB('train'), cars = 8, L = 25.5; for (let k = 0; k < cars; k++) { const x0 = k * (L + 0.8); g.box(x0, 0.6, -1.6, x0 + L, 4.1, 1.6, HZ.MAT.train.c, false); g.box(x0, 1.9, -1.62, x0 + L, 2.25, 1.62, [0.85, 0.15, 0.12], false); g.box(x0 + 0.5, 2.6, -1.63, x0 + L - 0.5, 3.3, 1.63, [0.12, 0.14, 0.18], false); }
      g.hexa([[-12, 0.6, -1.6], [0, 0.6, -1.6], [0, 0.6, 1.6], [-12, 0.6, 1.6], [-12, 1.2, -0.6], [0, 4.1, -1.6], [0, 4.1, 1.6], [-12, 1.2, 0.6]], HZ.MAT.train.c, false);
      for (let k = 0; k < cars; k++) { const x0 = k * (L + 0.8); for (const [a, b] of [[[x0, 4.1, -1.6], [x0 + L, 4.1, -1.6]], [[x0, 4.1, 1.6], [x0 + L, 4.1, 1.6]], [[x0, 0.6, 1.6], [x0 + L, 0.6, 1.6]], [[x0, 0.6, -1.6], [x0 + L, 0.6, -1.6]]]) g.line(a, b); } return g; })();
    // r3：车窗带 + 头灯单独一个材质（开通点亮时发光，列车在黄昏里可读）
    HZ.MAT.trainW = { c: [0.16, 0.17, 0.2], r: 0.2, m: 0.3, e: FV.tl };
    const trainWGeo = (() => { const g = new HZ.GB('trainW'), cars = 8, L = 25.5; for (let k = 0; k < cars; k++) { const x0 = k * (L + 0.8); g.box(x0 + 0.6, 2.45, -1.645, x0 + L - 0.6, 3.45, 1.645, null, false); } g.box(-11.6, 1.25, -1.0, -11.2, 1.65, 1.0, [0.9, 0.9, 0.85], false); return g; })();
    function compile() {
      const items = []; for (const a of HZ.acts) { if (a.kind === 'untemp' || !a.parts.length) continue; for (const p of a.parts) items.push({ p, st: p.st, du: p.du, rm: p.rm, temp: a.kind === 'temp' ? 1 : 0 }); }
      items.push({ p: { geo: trainGeo, mat: 'train', grp: 5 }, st: -20, du: 0.01, rm: [-1, 0], temp: 0 });
      items.push({ p: { geo: trainWGeo, mat: 'trainW', grp: 5 }, st: -20, du: 0.01, rm: [-1, 0], temp: 0 });
      let nv = 0, nl = 0; for (const it of items) { nv += it.p.geo.P.length / 3; nl += it.p.geo.L.length / 3; }
      const MF = new Float32Array(nv), Pp = new Float32Array(nv * 3), N = new Float32Array(nv * 3), C = new Float32Array(nv * 3), Kk = new Float32Array(nv * 4), R = new Float32Array(nv * 2), Y = new Float32Array(nv * 2), Gp = new Float32Array(nv), M = new Float32Array(nv * 4);
      const LP = new Float32Array(nl * 3), LK = new Float32Array(nl * 4), LR = new Float32Array(nl * 2), LY = new Float32Array(nl * 2), LG = new Float32Array(nl), LF = new Float32Array(nl);
      const col = new THREE.Color(); let iv = 0, il = 0;
      for (const it of items) { const g = it.p.geo, mt = HZ.MAT[it.p.mat], y0 = g.min[1], gg = it.p.grp || 0;
        for (let i = 0; i < g.P.length / 3; i++, iv++) { for (let k = 0; k < 3; k++) { Pp[iv * 3 + k] = g.P[i * 3 + k]; N[iv * 3 + k] = g.N[i * 3 + k]; }
          col.setRGB(g.C[i * 3], g.C[i * 3 + 1], g.C[i * 3 + 2], THREE.SRGBColorSpace); C[iv * 3] = col.r; C[iv * 3 + 1] = col.g; C[iv * 3 + 2] = col.b;
          Kk[iv * 4] = it.st; Kk[iv * 4 + 1] = it.du; R[iv * 2] = it.rm[0]; R[iv * 2 + 1] = it.rm[1]; Y[iv * 2] = y0; Y[iv * 2 + 1] = g.max[1]; Gp[iv] = gg; M[iv * 4] = mt.r; M[iv * 4 + 1] = mt.m; M[iv * 4 + 2] = mt.e || 0; M[iv * 4 + 3] = mt.k || 0; MF[iv] = it.temp; }
        const fl = it.temp ? 1 : (it.p.mat === 'soffit' || it.p.mat === 'clad' ? 2 : 0);
        for (let i = 0; i < g.L.length / 3; i++, il++) { for (let k = 0; k < 3; k++) LP[il * 3 + k] = g.L[i * 3 + k]; LK[il * 4] = it.st; LK[il * 4 + 1] = it.du; LR[il * 2] = it.rm[0]; LR[il * 2 + 1] = it.rm[1]; LY[il * 2] = y0; LY[il * 2 + 1] = g.max[1]; LG[il] = gg; LF[il] = fl; } }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(Pp, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3)); geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
      geo.setAttribute('aK', new THREE.BufferAttribute(Kk, 4)); geo.setAttribute('aR', new THREE.BufferAttribute(R, 2)); geo.setAttribute('aY', new THREE.BufferAttribute(Y, 2)); geo.setAttribute('aG', new THREE.BufferAttribute(Gp, 1)); geo.setAttribute('aM', new THREE.BufferAttribute(M, 4)); geo.setAttribute('aF', new THREE.BufferAttribute(MF, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 30, 0), 1500);
      const litMat = patchStd(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.9, clippingPlanes: [CUTP], clipShadows: true })); envMats.push(litMat);
      const mesh = new THREE.Mesh(geo, litMat); mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.userData.lit = litMat;
      mesh.customDepthMaterial = patchDepth(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide, clippingPlanes: [CUTP], clipShadows: true }));
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(LP, 3)); lg.setAttribute('aK', new THREE.BufferAttribute(LK, 4)); lg.setAttribute('aR', new THREE.BufferAttribute(LR, 2)); lg.setAttribute('aY', new THREE.BufferAttribute(LY, 2)); lg.setAttribute('aG', new THREE.BufferAttribute(LG, 1)); lg.setAttribute('aF', new THREE.BufferAttribute(LF, 1));
      const lines = new THREE.LineSegments(lg, lineMat); lines.frustumCulled = false; lines.renderOrder = 2;
      S.tris = nv / 3; S.segs = nl / 2; return { mesh, lines }; }
    const { mesh: MESH, lines: LINES } = compile(); scene.add(MESH, LINES);

    // ---- 钢绞线 ----
    const STR = (() => { const L = HZ.K.rig.strands, Pq = new Float32Array(L.length * 6), G = new Float32Array(L.length * 2); L.forEach((s, i) => { Pq.set(s.a, i * 6); Pq.set(s.b, i * 6 + 3); G[i * 2] = 0; G[i * 2 + 1] = s.gb; });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(Pq, 3)); g.setAttribute('aG', new THREE.BufferAttribute(G, 1));
      const m = new THREE.ShaderMaterial({ uniforms: { uG: U.uG, uA: { value: 0 }, uC: { value: new THREE.Color(0x0f0d0d) }, uCut: U.uCut }, transparent: true, depthWrite: false,
        vertexShader: 'attribute float aG; uniform mat4 uG[6]; varying float vWx; void main() { vec4 p = uG[int(aG + 0.5)] * vec4(position, 1.0); vWx = p.x; gl_Position = projectionMatrix * viewMatrix * p; }',
        fragmentShader: 'uniform float uA, uCut; uniform vec3 uC; varying float vWx; void main() { if (vWx < uCut) discard; gl_FragColor = vec4(uC, 0.9 * uA); }' });
      const o = new THREE.LineSegments(g, m); o.frustumCulled = false; o.visible = false; return o; })(); scene.add(STR);

    // ---- 地面（实景）+ 城市街区（实景网格 / 墨线轮廓同源）----
    const GU = { uT: U.uT };
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000, 1, 1).rotateX(-Math.PI / 2), (() => { const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
      m.onBeforeCompile = sh => { Object.assign(sh.uniforms, GU); sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = 'varying vec3 vWp; uniform float uT;\nfloat gh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }\nfloat gn(vec2 p){ vec2 i = floor(p), f = fract(p), u = f*f*(3.0-2.0*f); return mix(mix(gh(i), gh(i+vec2(1,0)), u.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), u.x), u.y); }\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          vec2 w = vWp.xz; if (abs(w.x) < 200.0 && abs(w.y) < 13.2 && uT > 30.0) discard;
          float n = gn(w * 0.012) * 0.6 + gn(w * 0.05) * 0.4, nf = gn(w * 0.004);
          vec3 field = mix(vec3(0.20, 0.27, 0.13), vec3(0.34, 0.33, 0.20), nf) * (0.8 + 0.3 * n);
          vec3 city = mix(vec3(0.33, 0.33, 0.32), vec3(0.42, 0.41, 0.38), n);
          float r = length(w * vec2(1.0, 1.6)); vec3 base = mix(field, city, 0.55 * smoothstep(1300.0, 2200.0, r));
          float site = (1.0 - smoothstep(0.0, 40.0, max(abs(w.x) - 720.0, abs(w.y) - 300.0)));
          vec3 dirt = mix(vec3(0.42, 0.33, 0.24), vec3(0.52, 0.43, 0.32), n);
          vec2 bk = floor(w / vec2(48.0, 36.0)), bf = abs(fract(w / vec2(48.0, 36.0)) - 0.5) * vec2(48.0, 36.0); float road = 1.0 - step(bf.x, 21.0) * step(bf.y, 15.0);
          vec3 fin = road > 0.5 ? vec3(0.27, 0.27, 0.28) : (gh(bk) > 0.4 ? vec3(0.18, 0.27, 0.13) * (0.8 + 0.4 * gn(w * 0.3)) : vec3(0.50, 0.49, 0.47) * (0.92 + 0.12 * n));
          float done = smoothstep(980.0, 1080.0, uT), dig = smoothstep(0.0, 25.0, uT);
          vec3 sc = mix(mix(field, dirt, dig), fin, done);
          diffuseColor.rgb = mix(base, sc, site);`); };
      return m; })()); ground.position.y = -0.04; ground.receiveShadow = true; scene.add(ground);
    // 城市 + 背景墨线（街区轮廓、铁路走廊、绘图网格、施工围挡、材料堆场边线）：aW = [透明度, 出现日, 消失日]
    const CTX = (() => { const r = SEQ.rng(20220922), pos = [], nor = [], colA = [], lp = [], lw = [];
      const L = (a, b, al, t0, t1) => { lp.push(...a, ...b); lw.push(al, t0 == null ? -1e9 : t0, t1 == null ? 1e9 : t1, al, t0 == null ? -1e9 : t0, t1 == null ? 1e9 : t1); };
      const bxl = (x0, y0, z0, x1, y1, z1, al, t0, t1) => { const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]; for (let i = 0; i < 4; i++) { L(c[i], c[(i + 1) % 4], al, t0, t1); L(c[4 + i], c[4 + (i + 1) % 4], al, t0, t1); L(c[i], c[4 + i], al, t0, t1); } };
      const box = (x0, y0, z0, x1, y1, z1, c) => { const g = new HZ.GB('conc'); g.ink = false; g.box(x0, y0, z0, x1, y1, z1, null, false); for (let i = 0; i < g.P.length; i++) { pos.push(g.P[i]); nor.push(g.N[i]); } for (let i = 0; i < g.P.length / 3; i++) colA.push(c[0], c[1], c[2]); };
      for (let i = 0; i < 2600; i++) { const a = r() * Math.PI * 2, d = 1500 + Math.pow(r(), 0.8) * 3800, x = Math.cos(a) * d * 1.15, z = Math.sin(a) * d; if (Math.abs(z) < 120 && Math.abs(x) < 4000) continue; if (Math.abs(x) < 750 && Math.abs(z) < 420) continue;
        const w = 16 + r() * 34, l = 16 + r() * 40, tall = r() < 0.07, h = tall ? 50 + r() * 90 : 8 + r() * 18, v = 0.62 + r() * 0.22, c = tall ? [v * 0.85, v * 0.9, v * 0.95] : [v, v * 0.97, v * 0.9]; box(x - w / 2, 0, z - l / 2, x + w / 2, h, z + l / 2, c); if (d < 4200) bxl(x - w / 2, 0, z - l / 2, x + w / 2, h, z + l / 2, 0.22); }
      // 铁路走廊（站外延伸）：20 线 × 两端
      for (const yk of ['S', 'N']) for (const tz of HZ.tracks(HZ.YARDS[yk])) for (const s of [-1, 1]) { L([s * P.apX, 0.3, tz], [s * 4200, 0.3, tz], 0.3); }
      for (const s of [-1, 1]) for (const z of [-150, 150]) L([s * 700, 0, z], [s * 4200, 0, z * 0.6], 0.14);
      // 绘图网格（地面，50 m）
      for (let x = -1500; x <= 1500; x += 50) L([x, 0, -900], [x, 0, 900], x % 250 ? 0.05 : 0.1);
      for (let z = -900; z <= 900; z += 50) L([-1500, 0, z], [1500, 0, z], z % 250 ? 0.05 : 0.1);
      // 施工围挡（开工 → 开通前）：虚线
      const fence = [[-720, -300], [720, -300], [720, 300], [-720, 300]]; for (let k = 0; k < 4; k++) { const a = fence[k], b = fence[(k + 1) % 4], n = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 16); for (let i = 0; i < n; i += 2) { const f0 = i / n, f1 = (i + 1) / n; L([a[0] + (b[0] - a[0]) * f0, 2.2, a[1] + (b[1] - a[1]) * f0], [a[0] + (b[0] - a[0]) * f1, 2.2, a[1] + (b[1] - a[1]) * f1], 0.55, 0, TL.OPEN - 30); } }
      // 施工便道（环形）
      for (const [a, b] of [[[-700, -280], [700, -280]], [[700, -280], [700, 280]], [[700, 280], [-700, 280]], [[-700, 280], [-700, -280]]]) { L([a[0], 0.1, a[1]], [b[0], 0.1, b[1]], 0.3, 0, TL.OPEN - 30); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); const cc = new THREE.Color(); for (let i = 0; i < colA.length; i += 3) { cc.setRGB(colA[i], colA[i + 1], colA[i + 2], THREE.SRGBColorSpace); colA[i] = cc.r; colA[i + 1] = cc.g; colA[i + 2] = cc.b; } g.setAttribute('color', new THREE.Float32BufferAttribute(colA, 3));
      const city = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })); city.receiveShadow = true;
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); lg.setAttribute('aW', new THREE.Float32BufferAttribute(lw, 3));
      const lines = new THREE.LineSegments(lg, new THREE.ShaderMaterial({ uniforms: { uT: U.uT, uInk: U.uInk, uCam: U.uCam, uLA: U.uLA }, transparent: true, depthWrite: false,
        vertexShader: 'attribute vec3 aW; uniform float uT; uniform vec3 uCam; varying float vA; void main() { vA = (uT >= aW.y && uT < aW.z) ? aW.x * (1.0 - 0.7 * smoothstep(1200.0, 4200.0, distance(position, uCam))) : 0.0; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 uInk; uniform float uLA; varying float vA; void main() { if (vA <= 0.001) discard; gl_FragColor = vec4(uInk, vA * uLA); }' }));
      lines.frustumCulled = false; lines.renderOrder = 1; S.ctxSegs = lp.length / 6; return { city, lines }; })();
    scene.add(CTX.city, CTX.lines);

    // ---------------- 现场：塔吊回转 / 履带吊 / 运输车 / 堆场 / 转轴（每次时间变化重建，同一几何喂实景与墨线）----------------
    const DYN = (() => { const mk = (n) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setDrawRange(0, 0); return g; };
      const mg = mk(60000), lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(30000 * 3), 3)); lg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(30000 * 3), 3)); lg.setDrawRange(0, 0);
      const litM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1, clippingPlanes: [CUTP], clipShadows: true }); envMats.push(litM);
      const inkM = new THREE.ShaderMaterial({ uniforms: { uPaper: U.uPaper, uSun2: U.uSun2, uCut: U.uCut }, vertexShader: 'attribute vec3 color; varying vec3 vN; varying vec3 vC; varying float vWx; void main() { vN = normal; vC = color; vWx = position.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 uPaper, uSun2; uniform float uCut; varying vec3 vN; varying vec3 vC; varying float vWx; void main() { if (vWx < uCut) discard; float l = dot(normalize(vN), uSun2); vec3 b = mix(uPaper, pow(vC, vec3(1.0 / 2.2)), 0.42); gl_FragColor = vec4(b * (l > 0.5 ? 1.0 : l > 0.08 ? 0.9 : 0.8), 1.0); }', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      const mesh = new THREE.Mesh(mg, litM); mesh.frustumCulled = false; mesh.castShadow = true; mesh.userData = { lit: litM, ink: inkM };
      const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, clippingPlanes: [CUTP] })); lines.frustumCulled = false; lines.renderOrder = 3;
      return { mesh, lines, mg, lg }; })();
    scene.add(DYN.mesh, DYN.lines);
    // 工人（set1：实例化小人形，不再是 2 px 点；随距离放大到可读，近景 = 真实 1.75 m）
    const WK = (() => { const N = 2400, G0 = new HZ.GB('conc'); G0.ink = false;
      G0.box(-0.17, 0, -0.1, -0.03, 0.82, 0.1, [0.20, 0.22, 0.30], false); G0.box(0.03, 0, -0.1, 0.17, 0.82, 0.1, [0.20, 0.22, 0.30], false);   // 腿
      G0.box(-0.24, 0.82, -0.13, 0.24, 1.45, 0.13, [0.95, 0.55, 0.12], false); G0.box(-0.3, 0.9, -0.08, -0.24, 1.38, 0.08, [0.95, 0.55, 0.12], false); G0.box(0.24, 0.9, -0.08, 0.3, 1.38, 0.08, [0.95, 0.55, 0.12], false);   // 躯干（反光背心）+ 臂
      G0.box(-0.11, 1.47, -0.11, 0.11, 1.66, 0.11, [0.86, 0.70, 0.58], false); G0.box(-0.15, 1.64, -0.15, 0.15, 1.76, 0.15, [0.98, 0.98, 0.95], false);   // 头 + 安全帽
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(G0.P, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(G0.N, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(G0.C, 3));
      const WU = { uCam: U.uCam, uCut: U.uCut, uInk: { value: 0 }, uPaper: U.uPaper, uSun2: U.uSun2, uK: { value: +(hp.get('wk') || 0.008) } };
      const mat = new THREE.ShaderMaterial({ uniforms: WU, side: THREE.DoubleSide,
        vertexShader: 'attribute vec3 color; uniform vec3 uCam; uniform float uK; varying vec3 vC; varying vec3 vN; varying float vWx; void main() { vec4 c0 = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0); float k = max(1.0, distance(c0.xyz, uCam) * uK); vec4 w = modelMatrix * instanceMatrix * vec4(position * k, 1.0); vWx = c0.x; vC = color; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: 'uniform float uInk, uCut; uniform vec3 uPaper, uSun2; varying vec3 vC; varying vec3 vN; varying float vWx; void main() { if (vWx < uCut) discard; float l = 0.62 + 0.38 * max(0.0, dot(normalize(vN), uSun2)); vec3 c = pow(vC, vec3(1.0 / 2.2)); vec3 ink = vC.r > 0.9 && vC.b < 0.3 ? vec3(0.70, 0.13, 0.16) : mix(vec3(0.11, 0.10, 0.09), uPaper, vC.r > 0.9 ? 0.75 : 0.08); gl_FragColor = vec4(mix(c * l, ink * (0.85 + 0.15 * l), uInk), 1.0); }' });
      const o = new THREE.InstancedMesh(geo, mat, N); o.count = 0; o.frustumCulled = false; o.renderOrder = 4; return { o, N, WU, key: '', m4: new THREE.Matrix4() }; })();
    S.WK = WK;
    scene.add(WK.o);
    // 塔吊：按工序时刻插值的回转角（每台的吊装序列 = R10 分派给它的构件）
    const CR = HZ.cranes.map((c, k) => { const seq = []; for (const a of HZ.acts) for (const p of a.parts) if (p.crane === k) seq.push({ t: p.st + p.du * 0.5, t0: p.st, t1: p.st + p.du, yaw: Math.atan2(p.c[2] - c.z, p.c[0] - c.x), r: Math.hypot(p.c[2] - c.z, p.c[0] - c.x), top: p.top });
      seq.sort((a, b) => a.t - b.t); return Object.assign({}, c, { seq, act: K[c.key] }); });
    const crawlParts = []; for (const a of HZ.acts) for (const p of a.parts) if (p.crane === -1 && p.crawl) crawlParts.push(p);
    const CREW = { civil: 320, frame: 220, mezz: 70, bridge: 90, track: 110, steel: 140, asm: 260, jig: 60, lifters: 50, skin: 170, tod: 150, ym: 170 }; S.CREW = CREW;
    const angLerp = (a, b, f) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * f; };
    function craneState(c, t) { const live = t >= c.act.start + c.act.dur * 0.5 && t < c.act.rm.start + c.act.rm.dur * 0.5; if (!live) return null; const q = c.seq; let yaw = c.yaw0, r = c.L * 0.6, hookY = c.jy - 8, busy = false;
      if (q.length) { let i = q.findIndex(e => e.t > t); if (i < 0) { yaw = q[q.length - 1].yaw; r = q[q.length - 1].r; } else if (i === 0) { yaw = angLerp(c.yaw0, q[0].yaw, sm(q[0].t - 20, q[0].t, t)); r = q[0].r; } else { const a = q[i - 1], b = q[i], f = sm(a.t1, Math.max(a.t1 + 0.01, b.t0), t); yaw = angLerp(a.yaw, b.yaw, f); r = a.r + (b.r - a.r) * f; }
        const cur = q.find(e => t >= e.t0 && t < e.t1); if (cur) { busy = true; const ph = ((t - cur.t0) / Math.max(0.2, cur.t1 - cur.t0) * 3) % 1; hookY = cur.top + 3 + (c.jy - cur.top - 8) * (0.5 + 0.5 * Math.cos(ph * Math.PI * 2)); } }
      return { yaw, r: Math.max(6, Math.min(c.L - 2, r)), hookY, busy }; }
    // S-301 净空尺寸线位置：镜头目标附近、压在楼面上方的那一格（随姿态实时求下弦高度）
    const cellNear = (x, z, g) => { let b = null, bd = 1e9; for (const c of HZ.cells) { if (!c.grp || (g && c.grp !== g) || !(Math.abs(c.xc) <= P.floorX - 3 && Math.abs(c.zc) >= P.gap + 3 && Math.abs(c.zc) <= P.floorZ - 3)) continue; const d = Math.hypot(c.xc - x, c.zc - z); if (d < bd) { bd = d; b = c; } } return b; };
    // set2c：剖切时 3D 净空 = 剖面图同一个最低净空（HZ.secGap），尺寸线贴在剖切面（x = 39.4，避开切面本身）
    function secGap3(ps, t) { const b = HZ.secGap(ps, t); return b ? { at: [HZ.SEC_X + 0.4, b.y, b.z], v: b.v, sec: 1 } : null; }
    function measureAt(ps, t) { const e = HZ.gapTab[1][0], q = HZ.xf(ps, 1, e.p0), y = q[1] - e.rr; return { at: [q[0], y, q[2]], v: y - P.floorTop }; }   // 南区内边最紧处那根下弦（拼装姿态净空 = 全屋盖最小 1.40 m），随姿态实时
    let dynKey = ''; const DS = { cranesBusy: 0, crawlers: 0, trucks: 0, workers: 0 };
    function rebuildDyn(t) {
      const key = (S.st.t).toFixed(3) + ':' + SV.sel + ':' + SV.cut; if (key === dynKey) return; dynKey = key;
      const g = new HZ.GB('yellow'), Lq = []; const Lc = (a, b, c) => Lq.push([a, b, c]);
      const INK = [0.11, 0.1, 0.09], RED = [0.70, 0.13, 0.16], YEL = HZ.MAT.yellow.c;
      DS.cranesBusy = 0;
      for (const c of CR) { const s = craneState(c, t); if (!s) continue; const ca = Math.cos(s.yaw), sa = Math.sin(s.yaw), y = c.jy + 0.6;
        const tip = [c.x + ca * c.L, y, c.z + sa * c.L], tail = [c.x - ca * c.Lc, y, c.z - sa * c.Lc], top = [c.x, c.top, c.z];
        g.rod(tail, tip, 0.55); g.rod(top, [c.x + ca * c.L * 0.6, y + 0.5, c.z + sa * c.L * 0.6], 0.12); g.rod(top, [tail[0], y + 0.5, tail[2]], 0.12);
        g.B(tail[0] - 2, y - 2, tail[2] - 2, tail[0] + 2, y + 1, tail[2] + 2, HZ.MAT.conc.c);
        const tr = [c.x + ca * s.r, y - 0.6, c.z + sa * s.r]; g.B(tr[0] - 0.9, tr[1] - 0.8, tr[2] - 0.9, tr[0] + 0.9, tr[1], tr[2] + 0.9, YEL);
        Lc(tr, [tr[0], s.hookY, tr[2]], s.busy ? RED : INK); if (s.busy) { DS.cranesBusy++; g.B(tr[0] - 1.6, s.hookY - 1.4, tr[2] - 1.6, tr[0] + 1.6, s.hookY, tr[2] + 1.6, [0.75, 0.2, 0.15]); } }
      // 履带吊（R10：不在任何塔吊回转半径内的构件；站位由 hzseq 搜出、不与在场构件相交）
      DS.crawlers = 0; for (const p of crawlParts) { if (!(t >= p.st - 0.5 && t < p.st + p.du + 0.5)) continue; if (DS.crawlers >= 14) break; DS.crawlers++; const [x, z] = p.crawl, by = p.crawlY || 0, ang = Math.atan2(p.c[2] - z, p.c[0] - x), ca = Math.cos(ang), sa = Math.sin(ang);
        g.B(x - 3.6, by, z - 2.8, x + 3.6, by + 1.4, z + 2.8, [0.35, 0.33, 0.30]); g.B(x - 2.2, by + 1.4, z - 2.0, x + 2.2, by + 3.6, z + 2.0, [0.86, 0.32, 0.12]);
        const hd = Math.hypot(p.c[0] - x, p.c[2] - z), tipY = Math.max(p.top + 10, by + 22), tip = [x + ca * hd * 0.92, tipY, z + sa * hd * 0.92]; g.rod([x, by + 3, z], tip, 0.35); Lc(tip, [tip[0], p.top + 1.5, tip[2]], RED); }
      // 运输车（便道环线；车数 ∝ 在建工序数；钢构车 = 红，混凝土 = 灰）
      const act = HZ.acts.filter(a => a.parts.length && a.kind !== 'temp' && t >= a.start && t < a.end); let nSteel = 0, nConc = 0; for (const a of act) { if (a.res.steel || a.res.asm || a.res.skin) nSteel++; else nConc++; }
      const nT = t < TL.OPEN - 30 ? Math.min(36, 4 + (nSteel + nConc) * 4) : 0; DS.trucks = nT; const per = 2 * (1400 + 560);
      for (let i = 0; i < nT; i++) { const d = ((t * 140 + i * per / Math.max(1, nT)) % per + per) % per; let x, z, dir; if (d < 1400) { x = -700 + d; z = -280; dir = 0; } else if (d < 1960) { x = 700; z = -280 + (d - 1400); dir = 1; } else if (d < 3360) { x = 700 - (d - 1960); z = 280; dir = 0; } else { x = -700; z = 280 - (d - 3360); dir = 1; }
        const steel = i < nT * nSteel / Math.max(1, nSteel + nConc), c = steel ? [0.72, 0.18, 0.12] : [0.62, 0.62, 0.6], hx = dir ? 1.4 : 6, hz = dir ? 6 : 1.4; g.B(x - hx, 0.4, z - hz, x + hx, 3.0, z + hz, c); }
      // 堆场：钢构堆场库存 = 已到场 − 已安装（到场比安装提前 40 日）；钢筋 / 预制堆场随土建活动
      const steelA = HZ.acts.filter(a => a.tally && a.tally.steel), inst = tt => steelA.reduce((s, a) => s + a.tally.steel * Math.max(0, Math.min(1, (tt - a.start) / a.dur)), 0), stock = Math.max(0, inst(t + 40) - inst(t)) / 13000;
      const civ = act.filter(a => !(a.res.steel || a.res.asm || a.res.skin)).length;
      for (const [sx, sz, kind] of [[-420, -205, 's'], [420, -205, 's'], [-420, 205, 'c'], [420, 205, 'c']]) { if (t >= TL.OPEN - 30) continue; const amt = kind === 's' ? stock : Math.min(1, civ / 5);
        for (const [a, b] of [[[sx - 60, 0.2, sz - 30], [sx + 60, 0.2, sz - 30]], [[sx + 60, 0.2, sz - 30], [sx + 60, 0.2, sz + 30]], [[sx + 60, 0.2, sz + 30], [sx - 60, 0.2, sz + 30]], [[sx - 60, 0.2, sz + 30], [sx - 60, 0.2, sz - 30]]]) Lc(a, b, INK);
        const n = Math.round(amt * 24); for (let i = 0; i < n; i++) { const ix = i % 8, iz = Math.floor(i / 8), x0 = sx - 52 + ix * 13.5, z0 = sz - 22 + iz * 16, hh = 1.2 + ((i * 37) % 5) * 0.5; g.B(x0, 0, z0, x0 + 10, hh, z0 + 9, kind === 's' ? [0.55, 0.57, 0.6] : [0.6, 0.5, 0.42]); } }
      // 南 / 北区转轴（旋转提升期间）
      const ps = S.pose; for (const [zone, zA, key] of [[1, P.roofB, 'lift1'], [3, -P.roofB, 'lift3']]) { const A = K[key]; if (!(t >= A.start - 1.5 && t < A.end + 1.5)) continue; const y = P.roofLo + ps[zone].dy; for (let x = -128; x < 128; x += 8) Lc([x, y, zA], [x + 5, y, zA], RED); Lc([-128, y, zA], [-128, y + 14, zA], RED); Lc([128, y, zA], [128, y + 14, zA], RED); }
      // S-301：提升器油缸（伸缸 = 红、缩缸换锚 = 橙、锁定 = 墨）+ 楼面净空尺寸线（最小净空处，3D 实时）
      if (SHEET === 'S-301' && !S.noJack) { const J = HZ.jackRead(t), st = J.m ? J.m.state : 'lock';
        for (const r of J.rows) { const on = r.on && (st === 'ext' || st === 'ret'), c = !on ? [0.3, 0.28, 0.26] : st === 'ext' ? [0.78, 0.12, 0.14] : [0.86, 0.48, 0.12], ex = on ? J.m.ext * 0.25 * 4 : 0, y0 = r.top; // 活塞外伸按 ×4 显示（实际行程 250 mm）
          g.B(r.x - 1.0, y0, r.z - 1.0, r.x + 1.0, y0 + 1.6, r.z + 1.0, c); g.B(r.x - 0.45, y0 + 1.6, r.z - 0.45, r.x + 0.45, y0 + 1.7 + ex, r.z + 0.45, [0.82, 0.82, 0.8]); g.B(r.x - 1.2, y0 + 1.7 + ex, r.z - 1.2, r.x + 1.2, y0 + 2.1 + ex, r.z + 1.2, c);
          if (r.on) Lc([r.x, y0, r.z], r.hp.slice(0, 1).concat([r.y, r.hp[2]]), on ? RED : INK);
          if (r.i === SV.sel) { const SEL = [0.98, 0.74, 0.12], hs = 2.2, ya = y0 - 0.5, yb = y0 + 2.6 + ex, q = 0.09;   // set2a：选中的提升器 = 黄色笼框 + 吊点黄块 + 竖向引线（墨线 / 实景都看得见）
            for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.B(r.x + sx * hs - q, ya, r.z + sz * hs - q, r.x + sx * hs + q, yb, r.z + sz * hs + q, SEL);
            for (const yy of [ya, yb]) { g.B(r.x - hs - q, yy - q, r.z - hs - q, r.x + hs + q, yy + q, r.z - hs + q, SEL); g.B(r.x - hs - q, yy - q, r.z + hs - q, r.x + hs + q, yy + q, r.z + hs + q, SEL); g.B(r.x - hs - q, yy - q, r.z - hs - q, r.x - hs + q, yy + q, r.z + hs + q, SEL); g.B(r.x + hs - q, yy - q, r.z - hs - q, r.x + hs + q, yy + q, r.z + hs + q, SEL); }
            g.B(r.hp[0] - 0.7, r.y - 0.7, r.hp[2] - 0.7, r.hp[0] + 0.7, r.y + 0.7, r.hp[2] + 0.7, SEL); g.B(r.x - 0.06, r.y, r.z - 0.06, r.x + 0.06, y0, r.z + 0.06, SEL); Lc([r.hp[0], r.y, r.hp[2]], [r.hp[0], floorYAt(r.hp[0], r.hp[2]), r.hp[2]], RED); } }
        const gp = SV.cut ? secGap3(S.pose, t) : measureAt(S.pose, t); if (gp) { const [x, y, z] = gp.at, f = P.floorTop; Lc([x, f, z], [x, y, z], RED); for (const yy of [f, y]) { Lc([x - 2.5, yy, z], [x + 2.5, yy, z], RED); Lc([x, yy, z - 2.5], [x, yy, z + 2.5], RED); }
          if (gp.sec) { const q = 0.09; g.B(x - q, f, z - q, x + q, y, z + q, RED); for (const yy of [f, y]) g.B(x - q, yy - q, z - 1.6, x + q, yy + q, z + 1.6, RED); }   // set2c：剖切面上的净空尺寸线加粗（实心细杆，近景可读）
          S.gapAt = gp; } }
      // 上传
      const n = g.P.length / 3, mp = DYN.mg.attributes.position.array, mn = DYN.mg.attributes.normal.array, mc = DYN.mg.attributes.color.array, cc = new THREE.Color();
      for (let i = 0; i < Math.min(n, 60000); i++) { for (let k = 0; k < 3; k++) { mp[i * 3 + k] = g.P[i * 3 + k]; mn[i * 3 + k] = g.N[i * 3 + k]; } cc.setRGB(g.C[i * 3], g.C[i * 3 + 1], g.C[i * 3 + 2], THREE.SRGBColorSpace); mc[i * 3] = cc.r; mc[i * 3 + 1] = cc.g; mc[i * 3 + 2] = cc.b; }
      DYN.mg.setDrawRange(0, Math.min(n, 60000)); DYN.mg.attributes.position.needsUpdate = DYN.mg.attributes.normal.needsUpdate = DYN.mg.attributes.color.needsUpdate = true;
      const lp = DYN.lg.attributes.position.array, lc = DYN.lg.attributes.color.array; let m = 0; const inkMode = S.blend < 0.5;
      for (let i = 0; i < g.L.length / 6 && m < 29990; i++, m += 2) { for (let k = 0; k < 6; k++) lp[m * 3 + k] = g.L[i * 6 + k]; for (let k = 0; k < 6; k++) lc[m * 3 + k] = inkMode ? INK[k % 3] : 0.2; }
      for (const [a, b, c] of Lq) { if (m >= 29990) break; lp.set(a, m * 3); lp.set(b, m * 3 + 3); lc.set(c, m * 3); lc.set(c, m * 3 + 3); m += 2; }
      DYN.lg.setDrawRange(0, m); DYN.lg.attributes.position.needsUpdate = DYN.lg.attributes.color.needsUpdate = true;
      // 工人：S-000 远景不画（远看是脏点）；S-301 每小时按工序重排（提升器操作手、楼面测量 / 监护、嵌补焊工、柱头连接）
      const hr = Math.floor(t * 24), wkey = SHEET + ':' + hr + ':' + act.length; if (wkey !== WK.key) { WK.key = wkey; let w = 0; DS.workers = 0;
        if (SHEET === 'S-301') { const rr = SEQ.rng(hr * 7919 + 13), hd = (t - Math.floor(t)) * 24, day = hd >= 7 && hd < 19, J = HZ.jackRead(t), put1 = (x, y, z, yaw) => { if (w >= WK.N) return; WK.m4.makeRotationY(yaw).setPosition(x, y, z); WK.o.setMatrixAt(w++, WK.m4); };
          // 提升器平台：在本段动作的提升器每台 2 人（白天）/ 1 人（夜间值守）
          for (const r of J.rows) { if (!r.on && !(t >= K.merge.start && t < K.head.end)) continue; const n = day ? 2 : 1; for (let i = 0; i < n; i++) put1(r.x + (i ? 1.6 : -1.6), r.top + 0.05, r.z + 1.2 * (rr() - 0.5), rr() * 6.28); }
          // 楼面：测量 / 监护（白天沿正在动的分区下方分布；夜间少量巡查）
          const nF = day ? 90 : 16; for (let i = 0; i < nF; i++) { const zs = rr() < 0.5 ? 1 : -1, z = zs * (P.gap + 2 + rr() * (P.floorZ - P.gap - 6)), x = (rr() * 2 - 1) * (P.floorX - 4); put1(x, P.floorTop + 0.02, z, rr() * 6.28); }
          // 嵌补合龙 / 柱头连接：屋面上的焊工
          const ps = S.pose; if (day && t >= K.merge.start && t < K.merge.end) for (let i = 0; i < 70; i++) { const zs = rr() < 0.5 ? 1 : -1, z = zs * (P.midZ + 3.5), x = (rr() * 2 - 1) * 100, q = HZ.xf(ps, 4, [x, HZ.Ht(x, z) + 0.6, z + (rr() - 0.5) * 5]); put1(q[0], q[1], q[2], rr() * 6.28); }
          if (day && t >= K.head.start && t < K.head.end) for (const m of HZ.masts) for (let i = 0; i < 3; i++) put1(m.x + (rr() - 0.5) * 6, HZ.Ht(m.x, m.z) + 0.6, m.z + (rr() - 0.5) * 6, rr() * 6.28);
          DS.workers = w; }
        WK.o.count = w; WK.o.instanceMatrix.needsUpdate = true; }
    }
    S.DS = DS;

    // ---------------- 相机 ----------------
    const CAM = {
      hero: { az: +(hp.get('caz') || -32), el: +(hp.get('cel') || 24), d: +(hp.get('cd') || 820), tx: 0, ty: 22, tz: 10 },
      early: { az: 62, el: 26, d: 860, tx: -20, ty: 6, tz: 0 },
      lift: { az: 64, el: 18, d: 580, tx: 0, ty: 34, tz: 20 },   // r2：几何扫描 105 个机位（work/hzwest2/camsweep.js）+ VM 渲染 8 个，选旋转位移大且不压叠层的
      fin: [{ az: -22, el: 11, d: 760, tx: -10, ty: 26, tz: 18 },          // 0 = r2 原机位（西北）：列车被屋盖挡住
        { az: 120, el: 6, d: 440, tx: 60, ty: 26, tz: 40 },                // 1 = 东南低机位：南场外侧股道列车进站、屋盖在后（几何初筛 work/hzwest3/finsweep.js 第 1）
        { az: 136, el: 12, d: 600, tx: 60, ty: 26, tz: 40 },               // 2 = 东南中机位：屋盖顶面 + 光伏 + 列车
        { az: 110, el: 9, d: 520, tx: 0, ty: 26, tz: 20 },                 // 3 = 东偏南：云门不遮屋盖，列车走南场内侧
        { az: 108, el: 10, d: 520, tx: 0, ty: 30, tz: 10 },                // 4 = 东偏南：屋盖夹在两座上盖楼之间（屋顶可见 0.91），列车走中间股道
        { az: 120, el: 18, d: 620, tx: 0, ty: 30, tz: 10 },                // 5 = 东南高机位：屋顶几乎全可见（0.98），看光伏
        { az: 120, el: 7, d: 520, tx: 0, ty: 30, tz: 10 },                 // 6 = 东南低机位：南场外侧列车全长可见
        { az: 108, el: 7, d: 440, tx: 60, ty: 28, tz: 20 },                // 7 = 东偏南近机位
        { az: -40, el: 11, d: 660, tx: -60, ty: 26, tz: 0 },               // 8 = 西北：北场列车从西进站（几何初筛 finsweep_w.js：列车可见 1.0、屋顶可见 0.92）
        { az: -22, el: 14, d: 760, tx: -60, ty: 26, tz: 0 },               // 9 = 西北偏北（接近 r2 原机位，屋顶可见 0.98）
        { az: -12, el: 14, d: 660, tx: -100, ty: 24, tz: -20 },            // 10 = 北偏西
        { az: -30, el: 11, d: 660, tx: -100, ty: 24, tz: -20 },            // 11 = 西北低
        { az: -40, el: 11, d: 560, tx: -90, ty: 24, tz: -20 },             // 12 = 西北近：列车更大
        { az: -48, el: 9, d: 520, tx: -120, ty: 22, tz: -40 },             // 13 = 西北更近更低
        { az: -40, el: 11, d: 760, tx: -60, ty: 24, tz: -10 }][FV.cam | 0] };   // 14 = r3 终选：P1 的方位 / 仰角，距离退到 760（9 视口审计屋盖不出画；camfit.py）  // 3 = 东偏南：云门不遮屋盖，列车走南场内侧  // 3 = 正东贴轨：列车迎面、屋盖压顶
    let aspK = 1;
    CAM.s301 = { az: +(hp.get('s3az') || 110), el: +(hp.get('s3el') || 8), d: +(hp.get('s3d') || 165), tx: +(hp.get('s3x') || 98), ty: +(hp.get('s3y') || 36), tz: +(hp.get('s3z') || 45) };   // set1：Mac 机位扫描 12 个（work/hzwest-set1/sweep*.json）选 H：东南低机位，对准南区内边与楼面最紧处（x 98 / z 49，拼装姿态净空 1.40 m）
    function camKey(t) { if (SHEET === 'S-301') { const k = Object.assign({}, CAM.s301); k.az += 3 * Math.sin((t - TL.t0) / 6); if (S.camOv) Object.assign(k, S.camOv); k.d *= aspK; return k; }
      const a = sm(380, 560, t), b = sm(TL.l0 - 25, TL.l0 + 2, t) * (1 - sm(TL.l1, TL.l1 + 40, t)), c = sm(TL.OPEN - 40, TL.OPEN + 10, t);
      const mix = (p, q, k) => { const o = {}; for (const key in p) o[key] = p[key] + (q[key] - p[key]) * k; return o; };
      let k = mix(CAM.early, CAM.hero, a);   // set1：总图不再切近景提升机位（细节在 S-301） k = mix(k, CAM.fin, c);
      k.az += 5 * Math.sin(t / 140); if (S.camOv) Object.assign(k, S.camOv); k.d *= aspK; return k; }
    if (hp.has('cam')) { const v = hp.get('cam').split(',').map(Number); S.camOv = { az: v[0], el: v[1], d: v[2] }; if (v.length > 3) Object.assign(S.camOv, { tx: v[3], ty: v[4], tz: v[5] }); }
    function placeCam(k) { const az = THREE.MathUtils.degToRad(k.az), el = THREE.MathUtils.degToRad(k.el); ctl.target.set(k.tx, k.ty, k.tz); cam.position.set(k.tx + Math.sin(az) * Math.cos(el) * k.d, k.ty + Math.sin(el) * k.d, k.tz - Math.cos(az) * Math.cos(el) * k.d); }
    S.camKey = camKey;
    // ---------------- set2a：图纸点吊点 → 镜头飞到该提升器近景 ----------------
    // 构图：提升器顶、钢绞线、吊点、下方楼面同时在画面内，避开左上大数字与右上读数；方位 15° × 仰角 4 档扫描，每档二分最近距离，遮挡只用静止构件盒（HZ.segBox）
    const FBOX = []; for (const a of HZ.acts) for (const p of a.parts) { if (p.grp || p.cells || !p.geo || !p.geo.boxes) continue; for (const b of p.geo.boxes) FBOX.push({ p, b }); }
    const fcam = cam.clone(), fv = new THREE.Vector3();
    const floorYAt = (x, z) => Math.abs(x) <= P.floorX && Math.abs(z) <= P.floorZ && Math.abs(z) >= P.gap ? P.floorTop : P.platTop;
    function focusPts(i, t) { const J = HZ.jackRead(t), r = J.rows[i], L = HZ.lifters[i], fy = floorYAt(r.hp[0], r.hp[2]);
      const pts = [[L.x, L.top + 2.4, L.z], [L.x - 2.6, L.top - 0.6, L.z - 2.6], [L.x + 2.6, L.top - 0.6, L.z + 2.6], [L.x - 2.6, L.top + 3, L.z + 2.6], [L.x + 2.6, L.top + 3, L.z - 2.6], [r.hp[0], r.y, r.hp[2]], [(L.x + r.hp[0]) / 2, (L.top + r.y) / 2, (L.z + r.hp[2]) / 2], [r.hp[0], fy, r.hp[2]], [L.x, floorYAt(L.x, L.z), L.z]];
      return { J, r, L, pts }; }
    function safeObs() { const r = v3.getBoundingClientRect(); return { W: r.width, H: r.height, obs: [...document.querySelectorAll('#big,#rd .r')].filter(e => getComputedStyle(e).display !== 'none' && e.offsetParent !== null).map(e => { const q = e.getBoundingClientRect(); return { l: q.left - r.left - 12, r: q.right - r.left + 12, t: q.top - r.top - 12, b: q.bottom - r.top + 12 }; }) }; }
    function projFit(pts, so) { fcam.updateMatrixWorld(); let l = 1e9, rr = -1e9, tt = 1e9, bb = -1e9; for (const p of pts) { fv.set(p[0], p[1], p[2]).project(fcam); if (fv.z > 1) return null; const x = (fv.x + 1) / 2 * so.W, y = (1 - fv.y) / 2 * so.H; l = Math.min(l, x); rr = Math.max(rr, x); tt = Math.min(tt, y); bb = Math.max(bb, y); }
      const m = 18, ok = l >= m && tt >= m && rr <= so.W - m && bb <= so.H - m && so.obs.every(o => rr < o.l || l > o.r || bb < o.t || tt > o.b); return { ok, l, r: rr, t: tt, b: bb }; }
    function shotFor(i, t) { const F = focusPts(i, t), so = safeObs(), pts = F.pts, L = F.L; fcam.copy(cam); fcam.updateProjectionMatrix();
      let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (const p of pts) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
      const tgt = new THREE.Vector3((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2);
      const occ = FBOX.filter(e => { const b = e.b, st = SH.stOf(e.p, t); if (st < 0 || st === 3) return false; const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2; if (Math.hypot(cx - L.x, cz - L.z) < 5.5 && b.max[0] - b.min[0] < 12 && b.max[2] - b.min[2] < 12) return false; return Math.hypot(cx - tgt.x, cz - tgt.z) < 320; });
      const o0 = cam.position.clone().sub(ctl.target), az0 = Math.atan2(o0.x, -o0.z) * 180 / Math.PI, ps = S.pose || HZ.pose(t), zdy = ps[L.zone] ? ps[L.zone].dy : 0;
      const place = (az, el, d) => { const a = az * Math.PI / 180, e = el * Math.PI / 180; fcam.position.set(tgt.x + Math.sin(a) * Math.cos(e) * d, tgt.y + Math.sin(e) * d, tgt.z - Math.cos(a) * Math.cos(e) * d); fcam.lookAt(tgt); return fcam.position; };
      let best = null, tried = 0;
      for (let az = 0; az < 360; az += 15) for (const el of [8, 14, 22, 32, 46, 60]) { tried++;
        place(az, el, 300); const far = projFit(pts, so); if (!far || !far.ok) continue;
        let lo = 20, hi = 300; place(az, el, lo); const n0 = projFit(pts, so); if (n0 && n0.ok) hi = lo; else for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2; place(az, el, mid); const f = projFit(pts, so); if (f && f.ok) hi = mid; else lo = mid; }
        let d = Math.min(300, Math.max(20, hi * 1.3)); place(az, el, d); if (!(projFit(pts, so) || {}).ok) d = hi; const cp = place(az, el, d).clone();
        if (cp.y < P.floorTop + 2) continue; if (HZ.rho(cp.x, cp.z) <= 1.02 && cp.y > HZ.Ht(cp.x, cp.z) - P.depth - 2 + zdy && cp.y < HZ.Ht(cp.x, cp.z) + 2 + zdy) continue;   // 镜头别钻进网架
        let oc = 0, ro = 0; const ca = [cp.x, cp.y, cp.z]; for (const p of pts) { const pq = [p[0], p[1] + 0.4, p[2]]; for (const e of occ) if (HZ.segBox(ca, pq, e.b, -0.05)) { oc++; break; } }
        // 网架（不在盒子里）：沿视线采样，落在当前姿态的屋盖厚度内（孔口 4.5 m 内除外）记软遮挡
        for (const [p, wt] of [[pts[3], 2], [pts[5], 1]]) { for (let k = 1; k < 40; k++) { const f = k / 40, x = ca[0] + (p[0] - ca[0]) * f, y = ca[1] + (p[1] - ca[1]) * f, z = ca[2] + (p[2] - ca[2]) * f; if (Math.hypot(x - L.x, z - L.z) < 4.5 || HZ.rho(x, z) > 1) continue; const zn = Math.abs(z) <= P.midZ ? 2 : z > 0 ? 1 : 3, hb = HZ.Ht(x, z) - P.depth, off = HZ.xf(ps, zn, [x, hb, z])[1] - hb; if (y > hb + off - 0.3 && y < HZ.Ht(x, z) + off + 0.3) ro += wt; } }   // 视线在网架层里走得越长（掠射）越糊
        let da = Math.abs(az - az0) % 360; if (da > 180) da = 360 - da;
        const sc = oc * 1000 + ro * 10 + d * 0.6 + da * 0.35 + Math.abs(el - 18) * 1.6; if (!best || sc < best.sc) best = { sc, az, el, d, oc, ro, pos: cp }; }
      if (!best) { const d = 120; best = { sc: -1, az: az0, el: 18, d, oc: -1, pos: place(az0, 18, d).clone() }; }
      return { i, tgt, pos: best.pos, az: best.az, el: best.el, d: +best.d.toFixed(1), occluded: best.oc, roofOcc: best.ro, tried, pts }; }
    S.shotFor = shotFor; S.focusPts = focusPts; S.projFit = (pts) => { fcam.copy(cam); fcam.updateProjectionMatrix(); fcam.position.copy(cam.position); fcam.quaternion.copy(cam.quaternion); return projFit(pts, safeObs()); };
    let FLY = null;
    function flyTo(t1, p1, ms) { const t0 = ctl.target.clone(), sp0 = new THREE.Spherical().setFromVector3(cam.position.clone().sub(t0)), sp1 = new THREE.Spherical().setFromVector3(p1.clone().sub(t1)); let dth = sp1.theta - sp0.theta; while (dth > Math.PI) dth -= 2 * Math.PI; while (dth < -Math.PI) dth += 2 * Math.PI;
      FLY = { t0, t1: t1.clone(), sp0, sp1, dth, s: performance.now(), ms: ms || 1000 }; S.flying = true; S.st.auto = false; $('b-home').classList.add('on'); dirty = true; }
    const flyV = new THREE.Vector3(), flyS = new THREE.Spherical();
    function flyStep(now) { if (!FLY) return; const u = Math.min(1, (now - FLY.s) / FLY.ms), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      ctl.target.copy(FLY.t0).lerp(FLY.t1, e); flyS.set(FLY.sp0.radius * Math.pow(FLY.sp1.radius / FLY.sp0.radius, e), FLY.sp0.phi + (FLY.sp1.phi - FLY.sp0.phi) * e, FLY.sp0.theta + FLY.dth * e); cam.position.copy(ctl.target).add(flyV.setFromSpherical(flyS)); cam.lookAt(ctl.target); dirty = true;
      if (u >= 1) { FLY = null; S.flying = false; S.flyDone = (S.flyDone || 0) + 1; } }
    function focusLifter(i) { if (SHEET !== 'S-301' || !(i >= 0 && i < HZ.lifters.length)) return; cutOff(); SV.sel = i; S.selZone = 0; zoneTint(); sheetInv(); dynKey = ''; leadKey = ''; const k = shotFor(i, S.st.t); S.focusShot = k; flyTo(k.tgt, k.pos, 1000); hashSync(); }
    function clearFocus() { FLY = null; S.flying = false; clearSel(); }
    // ---------------- set2b：3D → 图纸（点提升器 / 点屋盖分区）、选中后镜头跟随吊点高度、URL #focus= ----------------
    const ZCODE = { 1: 'ZS', 2: 'ZM', 3: 'ZN' }, ZOF = { ZS: 1, ZM: 2, ZN: 3 }; S.selZone = 0;
    function zoneTint(t, ps) { t = t == null ? S.st.t : t; ps = ps || S.pose || HZ.pose(t); const wl = t > K.wlift.start && t < K.wlift.end; for (const g of [1, 2, 3, 4]) U.uMv.value[g] = SHEET !== 'S-301' ? 0 : S.selZone === g ? 2 : (wl ? 1 : g < 4 && ps[g].moving) ? 1 : 0; dirty = true; }
    function hashSync() { const q = new URLSearchParams(location.hash.slice(1)), f = SV.sel >= 0 ? 'J' + String(SV.sel + 1).padStart(2, '0') : S.selZone ? ZCODE[S.selZone] : SV.cut === 1 ? 'cut' : SV.cut === 2 ? 'gap' : '';
      if (f) q.set('focus', f); else q.delete('focus'); const h = q.toString().replace(/%2C/g, ','), cur = location.hash.slice(1); if (h !== cur) history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); S.focusHash = f; }
    function clearSel() { const had = SV.sel >= 0 || S.selZone || SV.cut; cutOff(); SV.sel = -1; S.selZone = 0; FOL = null; if (had) { zoneTint(); sheetInv(); dynKey = ''; leadKey = ''; } hashSync(); }
    // 图纸动画：0.5 s，k 按指数、中心点按线性插值（中心点 = 屏幕中心对应的 k=1 底图坐标），目标点最终落在平面图中央
    let SVA = null, SVP = null;
    function svAnimTo(k1, wz, wx, ms) { const s0 = SHEETS[0], pm = s0.pm; if (!pm) { SVP = [k1, wz, wx, ms]; return; } SVP = null; k1 = Math.max(1, Math.min(8, k1));
      const bx = pm.ox0 + (wz - pm.z0) * pm.s0, by = pm.oy0 + (pm.x1 - wx) * pm.s0; SVA = { k0: SV.k, k1, c0: [pm.pcx - SV.px / SV.k, pm.pcy - SV.py / SV.k], c1: [bx, by], s: performance.now(), ms: ms || 500 }; dirty = true; }
    function svaStep(now) { if (SVP && SHEETS[0].pm) svAnimTo(...SVP); if (!SVA) return; const pm = SHEETS[0].pm, a = SVA, u = Math.min(1, (now - a.s) / a.ms), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      const k = a.k0 * Math.pow(a.k1 / a.k0, e), cx = a.c0[0] + (a.c1[0] - a.c0[0]) * e, cy = a.c0[1] + (a.c1[1] - a.c0[1]) * e; SV.k = k; SV.px = -(cx - pm.pcx) * k; SV.py = -(cy - pm.pcy) * k; svClamp(); sheetInv(); if (u >= 1) { SVA = null; S.svaDone = (S.svaDone || 0) + 1; } }
    S.svAnimTo = svAnimTo; S.svaState = () => ({ SVA, SVP, zp: S._zonePend });
    function sheetToLifter(i) { const L = HZ.lifters[i]; svAnimTo(3, L.z, L.x); }
    function sheetToZone(z) { const s0 = SHEETS[0], pa = s0.pa, pm = s0.pm, B = (s0.zbb || {})[z]; if (!pa || !pm || !B) { SVP = null; S._zonePend = z; return; } S._zonePend = 0;
      const k = Math.min((pa.x1 - pa.x0 - 24) / ((B.z1 - B.z0) * pm.s0), (pa.y1 - pa.y0 - 60) / ((B.x1 - B.x0) * pm.s0));   /* 上下留出图名 / 同步差 / 分区名一行 */ svAnimTo(Math.max(1, Math.min(8, k)), (B.z0 + B.z1) / 2, (B.x0 + B.x1) / 2); }
    function selectLifter3D(i) { cutOff(); SV.sel = i; S.selZone = 0; zoneTint(); sheetInv(); dynKey = ''; leadKey = ''; FOL = null;
      const r = HZ.jackRead(S.st.t).rows[i], L = HZ.lifters[i], tg = new THREE.Vector3(L.x, (L.top + r.y) / 2, L.z), p1 = cam.position.clone().sub(ctl.target).multiplyScalar(0.92).add(tg);   // 轻微对准：目标挪到该提升器，机位方向不变、略拉近 8 %
      flyTo(tg, p1, 600); sheetToLifter(i); hashSync(); }
    function selectZone(z) { cutOff(); SV.sel = -1; S.selZone = z; FOL = null; zoneTint(); sheetInv(); dynKey = ''; leadKey = ''; sheetToZone(z); hashSync(); }
    const zoneOfZ3 = z => Math.abs(z) <= P.midZ + 3.5 ? 2 : z > 0 ? 1 : 3;
    const rc = new THREE.Raycaster(), ndc = new THREE.Vector2(), pv = new THREE.Vector3();
    function pick3D(cx, cy) { if (SHEET !== 'S-301') return null; const R = v3.getBoundingClientRect(), x = cx - R.left, y = cy - R.top; if (x < 0 || y < 0 || x > R.width || y > R.height) return null;
      cam.updateMatrixWorld(); const J = HZ.jackRead(S.st.t), TH = Math.max(18, Math.min(30, R.height * 0.03)); let best = -1, bd = TH;
      for (const q of J.rows) { if (SV.cut && q.x < HZ.SEC_X - 0.5) continue; const a = [q.x, q.top + 2.4, q.z], b = [q.hp[0], q.y, q.hp[2]]; for (let k = 0; k <= 6; k++) { const f = k / 6; pv.set(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f).project(cam); if (pv.z > 1) continue; const d = Math.hypot((pv.x + 1) / 2 * R.width - x, (1 - pv.y) / 2 * R.height - y); if (d < bd) { bd = d; best = q.i; } } }
      if (best >= 0) return { lifter: best, d: +bd.toFixed(1) };
      ndc.set(x / R.width * 2 - 1, -(y / R.height) * 2 + 1); rc.setFromCamera(ndc, cam); const o = rc.ray.origin, dv = rc.ray.direction, ps = S.pose || HZ.pose(S.st.t); let prev = null;
      for (let s = 2, n = 0; s < 4500 && n < 4000; n++) { const px = o.x + dv.x * s, py = o.y + dv.y * s, pz = o.z + dv.z * s; let f = null;
        if (HZ.rho(px, pz) <= 1 && !(SV.cut && px < HZ.SEC_X)) { const zn = zoneOfZ3(pz), top = HZ.xf(ps, zn, [px, HZ.Ht(px, pz), pz])[1]; f = py - top; if (f <= 0 && f > -P.depth - 3 && (prev == null || prev > 0 || n === 0 || true)) return { zone: zn, at: [px, py, pz] }; }
        prev = f; s += Math.max(0.6, s * 0.004); }
      return { none: true }; }
    S.pick3D = pick3D; S.selectZone = selectZone; S.selectLifter3D = selectLifter3D;
    function onPick(cx, cy) { const h = pick3D(cx, cy); if (!h) return; S.lastPick = h; if (h.lifter >= 0) selectLifter3D(h.lifter); else if (h.zone) selectZone(h.zone); else clearSel(); }
    { let pd = null, np = 0; view.addEventListener('pointerdown', e => { np++; if (np > 1 || e.button !== 0) { pd = null; return; } pd = { x: e.clientX, y: e.clientY, moved: false }; }, true);
      view.addEventListener('pointermove', e => { if (pd && Math.hypot(e.clientX - pd.x, e.clientY - pd.y) >= 5) pd.moved = true; }, true);
      const up = e => { np = Math.max(0, np - 1); const d = pd; pd = null; if (!d || e.type !== 'pointerup' || d.moved || Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 5) return; S.clicks3D = (S.clicks3D || 0) + 1; onPick(e.clientX, e.clientY); };
      view.addEventListener('pointerup', up, true); view.addEventListener('pointercancel', up, true); }
    // ---------------- set2c：剖切视角（图纸点剖切线 B–B / 剖面净空线 → 3D 切掉 x < 39，镜头 1 s 飞到向东侧视；净空再靠近最低点）----------------
    function setCut(m) { m = m | 0; if (SV.cut === m) return; SV.cut = m; U.uCut.value = m ? HZ.SEC_X : -1e9; CUTP.constant = m ? -HZ.SEC_X : 1e7; shadowWant = true; dynKey = ''; leadKey = ''; sheetInv(); dirty = true; S.cutT = performance.now(); }
    function cutOff() { if (SV.cut) setCut(0); }
    function fitD(tgt, az, el, pts, lo, hi, useObs) { const so = useObs ? safeObs() : Object.assign(safeObs(), { obs: [] }); fcam.copy(cam); fcam.updateProjectionMatrix();
      const place = d => { const a = az * Math.PI / 180, e = el * Math.PI / 180; fcam.position.set(tgt.x + Math.sin(a) * Math.cos(e) * d, tgt.y + Math.sin(e) * d, tgt.z - Math.cos(a) * Math.cos(e) * d); fcam.lookAt(tgt); };
      place(hi); const f = projFit(pts, so); if (!f || !f.ok) return null; for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; place(mid); const q = projFit(pts, so); if (q && q.ok) hi = mid; else lo = mid; } return hi; }
    function cutShot(m, t) { const ps = S.pose || HZ.pose(t), XS = HZ.SEC_X, az = -90; let tgt, pts, d, el;
      if (m === 2) { const G = HZ.secGap(ps, t); if (!G) return cutShot(1, t); el = 8; const xs = XS + 0.4;
        const zc = G.z + Math.sign(-G.z || 1) * 4;   // 最低点多在楼面北 / 南边缘：目标往楼面里挪 4 m，少拍楼外空洞
        pts = [[xs, P.floorTop - 1, zc - 9], [xs, P.floorTop - 1, zc + 9], [xs, G.y + 3, zc - 9], [xs, G.y + 3, zc + 9]]; tgt = new THREE.Vector3(xs, (P.floorTop + G.y) / 2, zc);
        d = fitD(tgt, az, el, pts, 20, 400, true) || fitD(tgt, az, el, pts, 20, 400, false) || 60; d = Math.max(24, d * 1.25); }
      else { const top = Math.max(P.floorTop + 12, HZ.Ht(XS, 0) + ps[2].dy + 2); el = 5; pts = [[XS, -2, -172], [XS, -2, 172], [XS, top, -172], [XS, top, 172]]; tgt = new THREE.Vector3(XS, top * 0.5, 0);
        d = fitD(tgt, az, el, pts, 60, 3000, false) || 700; d *= 1.06; }   // 剖面横向占满画面（剖面扁，竖向落在读数框下方）
      const a = az * Math.PI / 180, e = el * Math.PI / 180, pos = new THREE.Vector3(tgt.x + Math.sin(a) * Math.cos(e) * d, tgt.y + Math.sin(e) * d, tgt.z - Math.cos(a) * Math.cos(e) * d);
      return { m, tgt, pos, d: +d.toFixed(1), az, el }; }
    function focusCut(m) { if (SHEET !== 'S-301') return; SV.sel = -1; S.selZone = 0; FOL = null; zoneTint(); setCut(m); const k = cutShot(m, S.st.t); S.cutShot = k; flyTo(k.tgt, k.pos, 1000); hashSync(); }
    S.focusCut = focusCut; S.setCut = setCut; S.cutShotFor = cutShot;
    // B：选中提升器后拖时间轴 → 镜头目标（与机位一起）平滑跟随吊点位移（时间常数 0.25 s）
    let FOL = null;
    function follow(dt) { if (SV.sel < 0 || SHEET !== 'S-301' || S.st.auto) { FOL = null; return; } const t = S.st.t;
      if (!FOL || FOL.i !== SV.sel) { const q = HZ.jackRead(t).rows[SV.sel]; FOL = { i: SV.sel, t, last: [q.hp[0], q.y, q.hp[2]], pend: [0, 0, 0] }; return; }
      if (FOL.t !== t) { const q = HZ.jackRead(t).rows[SV.sel], c = [q.hp[0], q.y, q.hp[2]]; for (let k = 0; k < 3; k++) { FOL.pend[k] += c[k] - FOL.last[k]; } FOL.last = c; FOL.t = t; }
      if (FLY) return; const p = FOL.pend; if (Math.abs(p[0]) + Math.abs(p[1]) + Math.abs(p[2]) < 1e-4) return; const a = 1 - Math.exp(-dt / 0.25), d = new THREE.Vector3(p[0] * a, p[1] * a, p[2] * a);
      ctl.target.add(d); cam.position.add(d); for (let k = 0; k < 3; k++) p[k] -= d.getComponent(k); dirty = true; }
    function applyFocusHash() { if (SHEET !== 'S-301') return; const f = (new URLSearchParams(location.hash.slice(1)).get('focus') || '').toUpperCase(); if (!f) return; const m = /^J(\d{1,2})$/.exec(f);
      if (m) { const i = +m[1] - 1; if (i >= 0 && i < HZ.lifters.length && SV.sel !== i) { focusLifter(i); sheetToLifter(i); } } else if (ZOF[f] && S.selZone !== ZOF[f]) selectZone(ZOF[f]); else if ((f === 'CUT' || f === 'GAP') && SV.cut !== (f === 'CUT' ? 1 : 2)) focusCut(f === 'CUT' ? 1 : 2); }
    S.applyFocusHash = applyFocusHash;
    S.focusLifter = focusLifter;

    // ---------------- 计算读数（审计真实做过的检查，按时间累计）----------------
    let AU = null; const cumOf = (arr, t) => { let s = 0; for (const [d, n] of arr) { if (d > t) break; s += n; } return s; };
    const supTot = () => AU.ev.sup.reduce((s, x) => s + x[1], 0), clipTot = () => AU.ev.clip.reduce((s, x) => s + x[1], 0);
    let rodsTot = SH.rodsTot; const rodParts = []; for (const a of HZ.acts) for (const p of a.parts) if (p.cells) rodParts.push([p, p.cells.reduce((s, c) => s + c.rods.length, 0)]);
    const rodsAt = t => { let s = 0; for (const [p, n] of rodParts) s += n * Math.max(0, Math.min(1, (t - p.st) / p.du)); return s; };
    S.rodsAt = rodsAt; S.rodsTot = rodsTot;
    // 施工日志：每道工序开工 / 完成一行
    const QTY = a => { const n = a.parts.reduce((s, p) => s + (p.cells ? p.cells.reduce((q, c) => q + c.rods.length, 0) : 0), 0); if (n) return fmt(n) + ' 杆'; if (a.stage === 'lift' || a.stage === 'wlift') return a.stage === 'wlift' ? 'D ' + HZ.D.toFixed(1) + ' m' : '0.6 m · 4°'; const b = a.parts.reduce((s, p) => s + p.geo.boxes.length, 0); return b ? fmt(b) + ' 件' : ''; };
    const EV = []; for (const a of HZ.acts) { if (a.kind === 'milestone') { EV.push({ t: a.start, s: '节点 ' + a.name, a }); continue; } EV.push({ t: a.start, s: '开工 ' + a.name + (QTY(a) ? ' · ' + QTY(a) : ''), a }); EV.push({ t: a.end, s: '完成 ' + a.name, a }); }
    EV.sort((x, y) => x.t - y.t); S.EV = EV;
    const evAt = t => { let i = 0; while (i < EV.length && EV[i].t <= t) i++; return i; };

    // ---------------- HUD ----------------
    const elDay = $('n-day'), elDate = $('n-date'), elH = $('n-h'), elR = $('n-r'), elCap = $('cap'), knob = $('knob'), fill = $('fill');
    const put = (el, v) => { if (el && el._v !== v) { el._v = v; el.textContent = v; } };
    const roofApex = () => { if (S.st.t < K.asm2.start + 1) return null; return HZ.Ht(0, 0) + S.pose[2].dy; };
    S.roofApex = roofApex;
    const calcRows = [...document.querySelectorAll('#calc .r')];
    function calcText(t) { const L = [];
      const ne = evAt(t), nAct = HZ.acts.filter(a => a.kind !== 'milestone').length;
      L.push(['推演', `${HZ.acts.length} 道工序 · ${fmt(Object.values(HZ.counts).reduce((a, b) => a + b, 0))} 条依赖（规则推出）· 事件 ${ne}/${EV.length}`]);
      if (!AU) { L.push(['自检', 'Worker 计算中…']); return L; }
      const supN = cumOf(AU.ev.sup, t), clN = cumOf(AU.ev.clip, t);
      const r8i = L.length;
      L.push(['支承', `已验 ${fmt(supN)} / ${fmt(supTot())} 盒 · 无支承 ${AU.unsupported}`]);
      L.push(['穿模', `已比 ${fmt(clN)} / ${fmt(clipTot())} 对 · 相交 ${AU.clip}`]);
      const LS = AU.ev.lift; let k = 0, tests = 0, gap = null; for (const r of LS) { if (r.t > t) break; k++; tests += r.tests; gap = r.gap; }
      L.splice(r8i, 0, ['提升净空', k ? `姿态 ${k}/${LS.length} · 线段×盒 ${fmt(tests)} 次 · 碰撞 ${AU.liftClash} · 最小 ${(gap == null ? AU.minFloorGap : gap).toFixed(2)} m` : `${LS.length} 个提升姿态待验 · ${fmt(LS.reduce((s, r) => s + r.tests, 0))} 次线段×盒`]);
      const crOn = t >= K.crane.start; L.push(['吊装', crOn ? `回转 ${HZ.cranes.length} 台×72 向 ${fmt(AU.r9.tests)} 次 · 碰 ${AU.r9.hits} · 塔吊 ${fmt(HZ.lift.tower)} 吊 · 履带 ${fmt(HZ.lift.crawler)} 吊` : `塔吊 ${HZ.cranes.length} 台待进场`]);
      return L; }
    let calcN = 5;
    const hhmm = t => { const m = Math.round((t - Math.floor(t)) * 1440), mm = m % 1440; return String(Math.floor(mm / 60)).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0'); };
    const STATE = { wait: '待命', night: '夜间锁定', load: '分级加载', ext: '伸缸带载上升', ret: '缩缸换锚（不动）', hold: '试提升后静置观测', lock: '到位锁定' };
    const ZN = { 1: '南区', 2: '中区', 3: '北区' };
    function big301(t) { const ps = S.pose || HZ.pose(t), J = HZ.jackRead(t), m = J.m, a = J.act; let cap = '', st = '';
      if (a) { const z = a.liftZone; st = m.state === 'load' ? '分级加载 ' + (20 * Math.min(5, 1 + Math.floor(m.f * 5))) + '%' : m.state === 'ext' || m.state === 'ret' ? '第 ' + m.k + '/' + m.n + ' 行程 · ' + STATE[m.state] : STATE[m.state];
        if (a.key === 'wlift') cap = '整体同步提升：' + J.rows.filter(r => r.on).length + ' 台提升器一起走';
        else if (z === 2) cap = '中区脱胎：顶起 0.6 m 离开胎架';
        else cap = ZN[z] + '绕外缘转 4°，内边已抬 ' + (HZ.innerDrop * ps[z].r).toFixed(2) + ' m'; }
      else if (t >= K.merge.start && t < K.merge.end) { cap = '嵌补合龙：补上两条分区缝，连成一块'; st = '焊接'; }
      else if (t >= K.head.start) { cap = '柱头连接、补孔，分级卸载'; st = '卸载'; }
      return { h: ps[2].dy + HZ.D, cap, st, J }; }
    function hudBig() { if (S.noHud) return; const t = S.st.t, d = Math.min(TL.OPEN, Math.floor(t));
      if (SHEET === 'S-301') { const b = big301(t); put($('b-n'), b.h.toFixed(2)); put($('b-u'), '/ ' + HZ.D.toFixed(2) + ' m 提升'); put($('b-c'), b.cap); S.cap = b.cap; S.big = b;
        const kh = `<b>S-301</b>整体提升详图 · ${HZ.dayDate(d)} ${hhmm(t)}` + (b.st ? ' · ' + b.st : ''); if ($('b-k')._v !== kh) { $('b-k')._v = kh; $('b-k').innerHTML = kh; }
        put($('rd1'), b.J.sync.toFixed(1) + ' / ' + b.J.limit + ' mm'); $('rd1').className = 'v ' + (b.J.sync <= b.J.limit ? 'ok' : 'ng');
        const gp = HZ.gap(S.pose || HZ.pose(t), t); put($('rd2l'), '楼面最小净空 · 碰撞 ' + (AU ? AU.liftClash : '…')); put($('rd2'), gp.v.toFixed(2) + ' m'); $('rd2').className = 'v ' + (gp.v >= P.jigMin && (!AU || !AU.liftClash) ? 'ok' : 'ng'); S.gapNow = gp; return; }
      const fin = t >= TL.OPEN; put($('b-n'), String(d)); put($('b-u'), fin ? '天 · 开通' : '/ ' + TL.OPEN + ' 天'); const c = HZ.caption(Math.min(t, TL.OPEN)).text; put($('b-c'), c);
      const kh = `<b>S-000</b>总图 · 杭州西站 · ${HZ.dayDate(d)}`; if ($('b-k')._v !== kh) { $('b-k')._v = kh; $('b-k').innerHTML = kh; } }
    function hud() { const t = S.st.t, d = Math.min(TL.OPEN, Math.floor(t)); put(elDay, String(d)); put(elDate, HZ.dayDate(d)); hudBig();
      if (S.st.info) { const L = calcText(t), h = L.map(x => `<div class="r"><b>${x[0]}</b><span>${x[1].replace(/[&<]/g, '')}</span></div>`).join(''); const ic = $('i-calc'); if (ic._v !== h) { ic._v = h; ic.innerHTML = h; } }
      const h = roofApex(); put(elH, h == null ? '—' : h.toFixed(1)); put(elR, fmt(rodsAt(Math.min(t, TL.OPEN))));
      const c = HZ.caption(Math.min(t, TL.OPEN)); put(elCap, c.text); if (SHEET === 'S-000') S.cap = c.text;
      const L = calcText(t); calcRows.forEach((r, i) => { const x = L[i]; r.style.display = x && i < calcN ? '' : 'none'; if (x) { put(r.firstChild, x[0]); put(r.lastChild, x[1]); } });
      const ne = evAt(t), lg = $('log'); const key = ne + ':' + logN; if (lg._k !== key) { lg._k = key; lg.innerHTML = EV.slice(Math.max(0, ne - logN), ne).reverse().map((e, i) => `<div class="${i ? '' : 'new'}"><span>${HZ.dayDate(e.t)}</span><b>${e.s.replace(/[&<]/g, '')}</b></div>`).join(''); }
      const fin = t >= TL.OPEN + 1 && SHEET === 'S-000'; if (finEl._on !== fin) { finEl._on = fin; finEl.style.display = fin ? '' : 'none'; }
      if (fin && AU && !finEl._done) { finEl._done = 1; $('f-n').innerHTML = `<b>${fmt(TL.OPEN)}</b> 天 · <b>${HZ.acts.length}</b> 道工序 · <b>${fmt(Object.values(HZ.counts).reduce((a, b) => a + b, 0))}</b> 条依赖<br><b>${fmt(AU.ev.lift.reduce((s, r) => s + r.tests, 0) + supTot() + clipTot() + AU.r9.tests)}</b> 次几何检查 · 冲突 <b>${AU.zero ? 0 : '✕'}</b>`; }
      segHi(); knob.style.transform = 'translateX(' + (S.st.u * trackW).toFixed(1) + 'px)'; fill.style.transform = 'scaleX(' + S.st.u.toFixed(5) + ')';
      if (playIcon !== S.st.play) { playIcon = S.st.play; $('b-play').innerHTML = icon(S.st.play ? 'pause' : 'play'); $('b-play').setAttribute('aria-label', S.st.play ? '暂停' : '播放'); }
      const mt = S.st.pref === 'ink' ? '墨线' : '实景'; put($('b-mode').querySelector('span'), mt); }
    let playIcon = null, trackW = 1, logN = 2; const finEl = $('fin');
    const SEGS = { 'S-000': [['地下', 0, K.deckS.start], ['承轨层', K.deckS.start, K.jig1.start], ['拼装', K.jig1.start, K.lift1.start], ['提升', K.lift1.start, K.head.end, 'S-301'], ['屋面', K.head.end, K.pv.end], ['开通', K.pv.end, TLF.Tmax]],
      'S-301': [['南区旋转', K.lift1.start, K.lift1.end], ['中区脱胎', K.lift2.start, K.lift2.end], ['北区旋转', K.lift3.start, K.lift3.end], ['合龙', K.merge.start, K.merge.end], ['整体提升', K.wlift.start, K.wlift.end], ['卸载', K.head.start, K.head.end]] };
    const ARROW = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5h7.5V9H9V4.1L2.6 10.5 1.5 9.4 7.9 3H3z"/></svg>';
    function marks() { const tr = $('track'), W = tr.clientWidth; tr.querySelectorAll('.seg,.tick,.mk,.lab').forEach(e => e.remove());
      for (const [n, a, b, go] of SEGS[SHEET]) { const u0 = TL.t2u(a), u1 = TL.t2u(b), el = document.createElement('div'); el.className = 'seg' + (go ? ' go' : ''); el.style.left = (u0 * 100) + '%'; el.style.width = ((u1 - u0) * 100) + '%'; el.dataset.a = a; el.dataset.b = b;
        if (go) { el.dataset.go = go; el.title = '进入 ' + go + ' 整体提升详图'; el.innerHTML = '<span>' + n + ARROW + '</span>'; } else { el.textContent = n; if (SHEET === 'S-301') { const i = document.createElement('i'); i.textContent = Math.round(b - a) + ' 天'; el.appendChild(i); } }
        tr.appendChild(el); if (el.scrollWidth > el.clientWidth + 0.5 && el.querySelector('i')) el.querySelector('i').remove(); if (el.scrollWidth > el.clientWidth + 0.5) el.textContent = ''; }
      if (SHEET === 'S-301') for (let d = Math.ceil(TL.t0); d <= TL.t1; d++) { const k = document.createElement('i'); k.className = 'tick'; k.style.left = (TL.t2u(d) * 100) + '%'; tr.appendChild(k); }
      segCur = null; }
    let segCur = null; function segHi() { const t = S.st.t; let cur = null; for (const el of $('track').querySelectorAll('.seg')) if (t >= +el.dataset.a && t < +el.dataset.b) cur = el; if (cur !== segCur) { if (segCur) segCur.classList.remove('cur'); if (cur) cur.classList.add('cur'); segCur = cur; } }
    function tabs() { const tb = $('tabs'); tb.innerHTML = ''; for (const [id, nm, ok] of SHEETS_ALL) { const e = document.createElement('div'); e.className = 'tb' + (id === SHEET ? ' on' : '') + (ok ? '' : ' off'); e.dataset.id = id; e.title = ok ? id + ' ' + nm : id + ' ' + nm + ' · 待出图'; e.innerHTML = '<b>' + id + '</b><small>' + (ok ? nm : '待出图') + '</small>'; if (ok) e.onclick = () => { location.hash = 'sheet=' + id; }; tb.appendChild(e); } }

    // ---------------- 状态 ----------------
    let dirty = true, lastShadowT = -1, shadowWant = true, shadowAge = 0; const SP = +(hp.get('sp') || 4), SPL = +(hp.get('spl') || 3);
    const trainZ = FV.tz === 0 ? 46.5 + 8 : FV.tz === 1 ? 112.5 + 8 : FV.tz; S.blend = 0;
    // 黄昏：在黄金时刻（FX.TOD.g）与蓝调时刻之间插值；量化 12 档，换档时才重建环境图
    const TG = JSON.parse(JSON.stringify(FX.TOD.g)), BH = { el: 0.8, sun: [1.0, 0.46, 0.26], I: 1.3, zen: [0.025, 0.045, 0.13], hor: [0.50, 0.30, 0.22], gnd: [0.035, 0.035, 0.045], glow: [0.75, 0.32, 0.14], fog: [0.40, 0.33, 0.38],
      skyZ: [0.012, 0.04, 0.16], skyH: [1.05, 0.46, 0.22], cTint: [1.0, 0.55, 0.42], mtn: [[0.08, 0.08, 0.12], [0.50, 0.34, 0.30]], post: { exp: 0.92, bloom: 0.28, god: 0.35, sat: 1.15 } };
    const lerpT = (a, b, k) => { if (Array.isArray(a)) return b == null ? a : a.map((v, i) => lerpT(v, b[i], k)); if (typeof a === 'number') return b == null ? a : a + (b - a) * k; if (a && typeof a === 'object') { const o = {}; for (const key in a) o[key] = lerpT(a[key], b ? b[key] : null, k); return o; } return a; };
    let duskK = 0, duskQ = -1; const sunEl0 = look.sunEl;
    function setDusk(k, fk) { const q = Math.round(k * 12) * 100 + Math.round((FV.se !== sunEl0 ? fk : 0) * 12); if (q === duskQ) return; duskQ = q; duskK = Math.round(k * 12) / 12; const e0 = sunEl0 + (FV.se - sunEl0) * (q % 100) / 12; Object.assign(T, lerpT(TG, BH, duskK)); look.sunEl = e0 + (BH.el - e0) * duskK; hemi.intensity = 1.05 * (1 - 0.55 * duskK); applyLook(); }
    function setT(t, fromU) { t = Math.max(TL.t0, Math.min(TL.t1, t)); S.st.t = t; S.st.u = fromU != null ? fromU : TL.t2u(t); U.uT.value = Math.min(t, TL.OPEN + 0.001);
      const ps = HZ.pose(t); for (const g of [1, 2, 3, 4]) U.uG.value[g].fromArray(HZ.mat(ps, g)); S.pose = ps;
      zoneTint(t, ps);   // set1：S-301 正在动的分区染淡红；set2b：选中分区 = 2（加深）
      const rig = K.rig, sv = t >= rig.start + rig.dur * 0.6 && t < rig.rm.start + rig.rm.dur * 0.3; STR.visible = sv; STR.material.uniforms.uA.value = sv ? 1 : 0;
      // r3「点亮」：开通当天由中心向外一波亮灯（uWave = 波前半径 m），之后保持；黄昏程度 dk
      const lw = sm(TL.OPEN - 1, TL.OPEN + 5, t); U.uLights.value = FV.lt * (FV.lt > 1.7 ? lw : sm(TL.OPEN - 6, TL.OPEN + 4, t)); U.uWave.value = FV.lt > 1.7 ? (lw >= 1 ? 0 : 20 + 420 * lw) : 0;
      U.uPV.value = Math.max(0, Math.min(1, (t - K.pv.start) / K.pv.dur)); U.uPVs.value = FV.pv; U.uRoofLift.value = FV.rw >= 2 ? (FV.rw >= 4 ? 0.38 : FV.rw >= 3 ? 0.22 : 0.10) * (1 - 0.6 * duskK) * sm(TL.OPEN - 30, TL.OPEN, t) : 0;
      setDusk(FV.dk * sm(TL.OPEN - 3, TL.OPEN + 14, t), sm(TL.OPEN - 30, TL.OPEN, t));
      const f = sm(TL.OPEN + 1, TL.OPEN + 24, t), tv = t > TL.OPEN + 0.5, tx = !tv ? 9000 : FV.tw ? -1500 + (1500 + FV.te) * (1 - Math.pow(1 - f, 2.2)) : 1500 - (1500 - FV.te) * (1 - Math.pow(1 - f, 2.2)); if (FV.tw) U.uG.value[5].makeRotationY(Math.PI).setPosition(tx, tv ? HZ.P.deckTop + 0.48 : -500, trainZ); else U.uG.value[5].makeTranslation(tx, tv ? HZ.P.deckTop + 0.48 : -500, trainZ); S.train = [tx, 0, trainZ];
      S.blend = S.st.pref === 'lit' ? 1 : sm(TL.OPEN - 12, TL.OPEN + 3, t) * FV.ik;   // 墨线默认：结尾留 15% 墨线（“图纸变成现实”的余韵）
      if (S.st.auto) placeCam(camKey(t));
      shadowWant = shadowWant || Math.abs(t - lastShadowT) > 0.5 || (ps.lifting && Math.abs(t - lastShadowT) > 0.02);
      hud(); dirty = true; sheetsDirty = true; }
    S.set = t => setT(t);

    // ---------------- 交互 ----------------
    for (const el of document.querySelectorAll('.ui')) for (const ev of ['pointerdown', 'wheel', 'touchstart']) el.addEventListener(ev, e => e.stopPropagation(), { passive: true });
    const setPlay = p => { S.st.play = p; if (p && S.st.t >= TL.t1 - 0.01) setT(TL.t0); lastNow = performance.now(); hud(); dirty = true; };
    $('b-play').onclick = () => setPlay(!S.st.play);
    $('b-home').onclick = () => { clearFocus(); if (SV.k > 1.001 && SHEETS[0].pm) svAnimTo(1, 0, 0); S.st.auto = true; placeCam(camKey(S.st.t)); ctl.update(); $('b-home').classList.remove('on'); dirty = true; };
    const setMode = m => { S.st.pref = m; setT(S.st.t, S.st.u); shadowWant = true; $('b-mode').classList.toggle('on', m === 'lit'); };
    $('b-mode').onclick = () => setMode(S.st.pref === 'ink' ? 'lit' : 'ink');
    const info = $('info'); const fitInfo = () => { const r = $('bar').getBoundingClientRect(); info.style.bottom = (innerHeight - r.top + 8) + 'px'; }; S.fitInfo = fitInfo;
    const openInfo = o => { S.st.info = o; if (o) fitInfo(); info.style.display = o ? 'flex' : 'none'; $('b-info').classList.toggle('on', o); };
    $('b-info').onclick = () => openInfo(!S.st.info); $('i-x').onclick = () => openInfo(false);
    S.opt = o => { if (o.play != null) setPlay(o.play); if (o.auto != null) { S.st.auto = o.auto; if (o.auto) placeCam(camKey(S.st.t)); } if (o.info != null) openInfo(o.info); if (o.mode) setMode(o.mode); dirty = true; };
    ctl.addEventListener('start', () => { FLY = null; S.flying = false; S.st.auto = false; $('b-home').classList.add('on'); });
    ctl.addEventListener('change', () => { dirty = true; });
    { const tr = $('track'); let drag = false; const at = e => { const r = tr.getBoundingClientRect(), u = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); setT(TL.u2t(u), u); };
      tr.addEventListener('pointerdown', e => { const sg = e.target.closest && e.target.closest('.seg.go'); if (sg) { location.hash = 'sheet=' + sg.dataset.go; return; } drag = true; tr.setPointerCapture(e.pointerId); S.st.play = false; at(e); }); tr.addEventListener('pointermove', e => { if (drag) at(e); }); tr.addEventListener('pointerup', e => { drag = false; try { tr.releasePointerCapture(e.pointerId); } catch (x) { } }); }
    addEventListener('keydown', e => { if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); setPlay(!S.st.play); } else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') { e.preventDefault(); S.st.play = false; const du = (e.shiftKey ? 0.05 : 0.01) * (e.code === 'ArrowRight' ? 1 : -1), u = Math.max(0, Math.min(1, S.st.u + du)); setT(TL.u2t(u), u); }
      else if (e.code === 'Escape') openInfo(false); else if (e.key === 'i') openInfo(!S.st.info); else if (e.key === 'c') $('b-mode').onclick(); });

    // ---------------- 次要信息 ----------------
    function fillInfo(au) { const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const row = (a, b) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`;
      const net = au && au.net, ok = au && au.zero;
      const audit = !au ? '<p class="wait">自检运行中…</p>' : `<table>${[
        ['无支承（含分区胎架 / 提升点包住重心）', au.unsupported], ['穿模（同时在场的构件两两相交，' + fmt(clipTot()) + ' 对）', au.clip], ['提升净空（' + au.liftSamples + ' 个姿态 × 杆件 × 在场构件，' + fmt(au.ev.lift.reduce((s, r) => s + r.tests, 0)) + ' 次线段-盒）', au.liftClash],
        ['依赖违例 / 成环', net.prec + ' / ' + net.cyclic], ['临时构件：违例 / 竣工残留', au.temp.violations + ' / ' + au.temp.leftover], ['资源超限（R5）', net.r5.over], ['提升扫掠与前置构件冲突（R8）', au.r8bad.length],
        ['塔吊回转净空（R9，' + HZ.cranes.length + ' 台 × 72 方位，' + fmt(au.r9.tests) + ' 次）', au.r9.hits], ['履带吊站位与在场构件相交（R10）', HZ.crawlHits], ['提升同步差超限（A6，' + fmt(au.sync.samples) + ' 次 × 5 min 采样，最大 ' + au.sync.max + ' / ' + au.sync.limit + ' mm）', au.sync.over]].map(r => row(r[0], r[1])).join('')}</table>
        <p class="${ok ? 'ok' : 'ng'}">${ok ? '全部为 0' : '有问题：' + esc((au.ex || []).concat(au.clipEx || [], au.liftEx || [], au.r9.ex || []).slice(0, 4).join('；'))}（${au.ms} ms，${au.boxes} 个包围盒）</p>
        <p class="sm">R8 推出：${esc(HZ.r8.join('、') || '无')} 必须排在整体提升之后。整体提升高度 D = ${HZ.D.toFixed(1)} m 由“拼装姿态最低下弦 ≥ 楼面 + ${HZ.P.jigMin} m 胎架”算出；旋转 4° 使内边抬升 ${HZ.innerDrop.toFixed(1)} m。R10 吊装分派：构件中心在某台在场塔吊回转半径（56 m）内 → 塔吊（${HZ.lift.tower} 吊），否则派履带吊（${HZ.lift.crawler} 吊，站位按“不与在场构件相交”搜出）。工人数、运输车数、堆场库存为推算示意。</p><p class="sm">S-301 整体提升详图：提升器按行程走（每行程 0.25 m：伸缸 45 min 带载上升、缩缸换锚 15 min 不动；作业 08:00–18:00；首日分级加载 + 试提升 0.1 m 后静置观测，夜间锁定，推算）。吊点读数 = 吊点随所在分区姿态的位移（与 3D、审计同一姿态函数）；同步偏差为模拟的控制偏差（每行程 ±${HZ.SYNC.amp} mm 内随机，推算），上限 ${HZ.SYNC.limit} mm。3D 中油缸外伸放大 4× 显示，工人小人形随距离放大以便看清。</p>`;
      $('i-audit').innerHTML = audit; $('i-chip').className = 'chip ' + (!au ? 'wait' : ok ? 'ok' : 'ng'); $('i-chip').textContent = !au ? '自检中' : ok ? '自检 0' : '自检 ✕';
      $('i-facts').innerHTML = '<table>' + HZ.FACTS.map(r => row(r[0], r[1])).join('') + '</table>';
      $('i-assume').innerHTML = '<table>' + HZ.ASSUME.map(r => row(r[0], r[1] + (/推算/.test(r[1]) ? '' : '（推算）'))).join('') + `<tr><td>工期（推算）</td><td>本模型：屋盖整体提升完成 ${HZ.dayDate(K.wlift.end)}（实录 2021-06-28）；金属屋面完成 ${HZ.dayDate(K.clad.end)}（实录 2021-08-31）；云门主体 ${HZ.dayDate(K.ym.end)}（实录 2021-12 封顶）</td></tr></table>`;
      $('i-src').innerHTML = HZ.SOURCES.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${esc(n)}</a>`).join(''); }
    fillInfo(null);
    function auditWorker() { const pick = n => { const el = [...document.querySelectorAll('script[src]')].find(e => e.getAttribute('src').split('?')[0].endsWith(n)); return el ? el.src : new URL(n, document.baseURI).href; };
      return Promise.all(['core/seq.js', 'hzseq.js'].map(n => fetch(pick(n)).then(r => { if (!r.ok) throw new Error(n); return r.text(); }))).then(src => new Promise((res, rej) => {
        const body = 'self.window = self;\n' + src.join('\n;\n') + '\n;\nself.onmessage = () => { try { self.HZ.make(); const a = self.HZ.audit(); self.postMessage(JSON.parse(JSON.stringify(a))); } catch (e) { self.postMessage({ err: String(e && e.message || e) }); } };';
        const url = URL.createObjectURL(new Blob([body], { type: 'text/javascript' })), w = new Worker(url);
        w.onmessage = e => { w.terminate(); URL.revokeObjectURL(url); e.data.err ? rej(new Error(e.data.err)) : res(e.data); }; w.onerror = e => { w.terminate(); rej(new Error(e.message || 'worker')); }; w.postMessage(1); })); }
    const doneAudit = au => { AU = au; S.auditRes = au; S.auditDone = true; fillInfo(au); hud(); sheetsDirty = true; };
    if (!hp.has('noaudit')) setTimeout(() => auditWorker().then(doneAudit).catch(() => setTimeout(() => doneAudit(HZ.audit()), 50)), 400);

    // ---------------- 图纸（右栏）----------------
    const SHEETS = [{ id: 'sh-jack', fn: SH.jack, no: 'HZW-S-301-1' }].map(s => Object.assign(s, { el: $(s.id), key: '', drawn: 0, n: 0, scale: '' }));
    let sheetsDirty = true;
    // set2a：S-301 图纸 ↔ 3D —— 平面缩放平移（1–8×，滚轮 / 双指 / 拖拽，双击复位）；悬停吊点只高亮，点击吊点 → 镜头 1 s 飞到该提升器近景
    const SV = S.sheetView = { k: 1, px: 0, py: 0, hover: -1, sel: -1, cut: 0, hoverK: null };
    const sheetInv = () => { for (const s of SHEETS) s.key = ''; sheetsDirty = true; };
    function svClamp() { const pa = SHEETS[0].pa; if (!pa) return; SV.k = Math.max(1, Math.min(8, SV.k)); const ex = SV.k - 1 + Math.min(1, SV.k - 1), mx = ex * (pa.x1 - pa.x0) / 2, my = ex * (pa.y1 - pa.y0) / 2;   /* set2b：放大后允许把平面边缘的吊点平移到中央 */ SV.px = Math.max(-mx, Math.min(mx, SV.px)); SV.py = Math.max(-my, Math.min(my, SV.py)); }
    function svZoom(k1, mx, my) { const pa = SHEETS[0].pa; if (!pa) return; const cx = (pa.x0 + pa.x1) / 2, cy = (pa.y0 + pa.y1) / 2; k1 = Math.max(1, Math.min(8, k1));
      if (!(mx >= pa.x0 && mx <= pa.x1 && my >= pa.y0 && my <= pa.y1)) { mx = cx; my = cy; } SV.px = mx - cx - (mx - cx - SV.px) * k1 / SV.k; SV.py = my - cy - (my - cy - SV.py) * k1 / SV.k; SV.k = k1; svClamp(); sheetInv(); }
    S.svZoom = svZoom; S.svReset = () => { SV.k = 1; SV.px = SV.py = 0; sheetInv(); };
    const hitAt = (x, y) => { let best = -1, bd = 1e9; for (const h of SHEETS[0].hits || []) { const d = Math.hypot(h.x - x, h.y - y); if (d <= h.r + 5 && d < bd) { bd = d; best = h.i; } } return best; };
    S.sheetHit = hitAt;
    const hitK = (x, y) => { const s = SHEETS[0], c = s.cutHit, q = s.gapHit; if (q && ((Math.abs(x - q.x) <= 7 && y >= q.y0 - 5 && y <= q.y1 + 5) || (q.lb && x >= q.lb[0] - 3 && x <= q.lb[2] + 3 && y >= q.lb[1] - 3 && y <= q.lb[3] + 3))) return 'gap';
      const pa = s.pa; if (c && c.vis && pa && x >= c.xa - 2 && x <= c.xb + 2 && x >= pa.x0 && x <= pa.x1 && Math.abs(y - c.y) <= 7) return 'cut';
      if (c && c.vis && pa) for (const xe of c.ends) if (Math.abs(x - xe) <= 7 && y <= c.y + 3 && y >= c.y - 24 && xe >= pa.x0 && xe <= pa.x1) return 'cut'; return null; };
    S.sheetHitK = hitK;
    { const el = $('sh-jack'), P0 = new Map(); let drag = null, pinch = null; el.style.touchAction = 'none';
      const loc = e => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      el.addEventListener('wheel', e => { if (SHEET !== 'S-301') return; e.preventDefault(); SVA = null; SVP = null; const [x, y] = loc(e), dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1); svZoom(SV.k * Math.exp(-dy * 0.0016), x, y); }, { passive: false });
      el.addEventListener('pointerdown', e => { SVA = null; SVP = null; const p = loc(e); P0.set(e.pointerId, p); try { el.setPointerCapture(e.pointerId); } catch (x) { }
        if (P0.size === 1) drag = { x: p[0], y: p[1], px: SV.px, py: SV.py, moved: false }; else if (P0.size === 2) { const [a, b] = [...P0.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, k: SV.k, m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; if (drag) drag.moved = true; } });
      el.addEventListener('pointermove', e => { const p = loc(e);
        if (!P0.size) { const h = hitAt(p[0], p[1]), hk = h >= 0 ? null : hitK(p[0], p[1]); el.style.cursor = h >= 0 || hk ? 'pointer' : SV.k > 1 ? 'grab' : 'default'; if (h !== SV.hover || hk !== SV.hoverK) { SV.hover = h; SV.hoverK = hk; sheetInv(); } return; }
        P0.set(e.pointerId, p);
        if (pinch && P0.size >= 2) { const [a, b] = [...P0.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; svZoom(pinch.k * d / pinch.d, pinch.m[0], pinch.m[1]); return; }
        if (drag) { const dx = p[0] - drag.x, dy = p[1] - drag.y; if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true; if (drag.moved && SV.k > 1) { SV.px = drag.px + dx; SV.py = drag.py + dy; svClamp(); sheetInv(); el.style.cursor = 'grabbing'; } } });
      const up = e => { const p = P0.get(e.pointerId); P0.delete(e.pointerId); try { el.releasePointerCapture(e.pointerId); } catch (x) { }
        if (P0.size < 2) pinch = null; if (!P0.size) { const d = drag; drag = null; if (d && !d.moved && p && e.type === 'pointerup') { const h = hitAt(p[0], p[1]); if (h >= 0) focusLifter(h); else { const k = hitK(p[0], p[1]); if (k) focusCut(k === 'cut' ? 1 : 2); } } } };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', () => { if (!P0.size && (SV.hover >= 0 || SV.hoverK)) { SV.hover = -1; SV.hoverK = null; sheetInv(); } });
      el.addEventListener('dblclick', e => { e.preventDefault(); S.svReset(); }); }
    // set2c：选中吊点的行程–时间（整个 S-301 时间窗；横轴 = 时间轴同一映射 TL.t2u；吊点竖向累计位移 = 与 3D / jackRead 同一姿态函数）
    let STK = null;
    function strokeData() { if (SV.sel < 0 || SHEET !== 'S-301') return null; const i = SV.sel;
      if (!STK || STK.i !== i || STK.TL !== TL) { const r0 = HZ.jackRead(TL.t0).rows[i], g = r0.zone, hp = r0.hp, yOf = t => HZ.xf(HZ.pose(t), g, hp)[1], y0 = yOf(TL.t0), N = 240, us = [], vs = [];
        for (let k = 0; k <= N; k++) { const u = k / N; us.push(u); vs.push((yOf(TL.u2t(u)) - y0) * 1000); } STK = { i, TL, g, hp, y0, us, vs, max: Math.max(...vs), min: Math.min(0, ...vs), name: 'J' + String(i + 1).padStart(2, '0'), d0: HZ.dayDate(TL.t0), d1: HZ.dayDate(TL.t1) }; }
      const t = Math.min(S.st.t, TL.t1); return Object.assign({}, STK, { uNow: S.st.u, vNow: (HZ.xf(S.pose || HZ.pose(t), STK.g, STK.hp)[1] - STK.y0) * 1000 }); }
    function sheetCtx(s) { return { tb: (w, h, no, name, t) => ({ tb: h < 170 ? 17 : 20, no, name, scale: s.id === 'sh-jack' ? '示意' : (s.scale || '1:—'), rev: evAt(t), date: HZ.dayDate(Math.floor(Math.min(t, TL.OPEN))), chk: AU ? (AU.zero ? '自检 0 ✓' : '自检 ✕') : '自检中', chkOk: AU && AU.zero }), lastVe: s.ve || 1, view: SV, hover: SV.hover, sel: SV.sel, zone: S.selZone, cut: SV.cut, hoverK: SV.hoverK, stroke: strokeData(),
      setScale: px => { const mmPerPx = 25.4 / 96, k = 1000 / (px * mmPerPx); s.scale = '1:' + (Math.round(k / 100) * 100).toLocaleString('en-US'); } }; }
    function drawSheet(s, now) { const c = s.el, w = c.clientWidth, h = c.clientHeight, DPR = Math.min(2, devicePixelRatio || 1); if (w < 20 || h < 20) return; if (c.width !== Math.round(w * DPR) || c.height !== Math.round(h * DPR)) { c.width = Math.round(w * DPR); c.height = Math.round(h * DPR); }
      const g = c.getContext('2d'); g.setTransform(DPR, 0, 0, DPR, 0, 0); g.textAlign = 'left'; const t0 = performance.now(), cx = sheetCtx(s); s.fn(g, w, h, Math.min(S.st.t, TL.OPEN + 0.001), cx); s.hits = cx.hits || []; s.pa = cx.pa; s.cutHit = cx.cutHit; s.gapHit = cx.gapHit; s.gapVal = cx.gapVal; s.chartBox = cx.chartBox; s.pm = cx.pm; s.zbb = cx.zoneBB; if (cx.ve && cx.ve !== (s.ve || 1)) { s.ve = cx.ve; s.key = ''; sheetsDirty = true; }
      if (S.st.t >= TL.OPEN) { g.save(); g.translate(w - 70, 34); g.rotate(-0.18); g.strokeStyle = '#b3202a'; g.fillStyle = 'rgba(179,32,42,.9)'; g.lineWidth = 2; g.strokeRect(-46, -15, 92, 30); g.font = '700 15px "PingFang SC","Noto Sans CJK SC",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('竣工 · 开通', 0, 1); g.restore(); }
      if (s.scale !== s._sc0) { s._sc0 = s.scale; s.key = ''; sheetsDirty = true; } s.ms = performance.now() - t0; s.n++; S.sheetDraws++; s.drawn = now; }

    // ---------------- 版式 ----------------
    const root = document.documentElement.style;
    function layout() { const W = innerWidth, H = innerHeight, short = H < 640, narrow = W < 1100;
      document.body.classList.toggle('short', short); document.body.classList.toggle('narrow', narrow); document.body.classList.toggle('tiny', H < 600); document.body.classList.toggle('tight', W < 1300 && SHEET === 'S-301');
      document.body.classList.toggle('s000', SHEET === 'S-000'); document.body.classList.toggle('s301', SHEET === 'S-301');
      const colW = Math.round(Math.max(300, Math.min(600, W * (narrow ? 0.36 : 0.32)))); root.setProperty('--colW', colW + 'px'); S.colLayout = { colW };
      calcN = H < 600 ? 3 : H < 720 ? 4 : 5; logN = H < 600 ? 1 : 2;
      ctl.minDistance = SHEET === 'S-301' ? 20 : 90;   // set2a：S-301 允许提升器近景
      const r = v3.getBoundingClientRect(); const w = Math.max(10, r.width), h = Math.max(10, r.height);
      renderer.setPixelRatio(Math.max(1, Math.min(devicePixelRatio || 1, QS[FX.q].pr, Math.sqrt(PIX / (w * h))))); renderer.setSize(w, h, false); cam.aspect = w / h;
      aspK = Math.max(1, Math.pow((SHEET === 'S-301' ? 1.5 : 1.6) / cam.aspect, 0.75));
      const top = $('big').getBoundingClientRect().bottom - r.top, bot = 0;
      cam.setViewOffset(w, h, 0, -(top - bot) * (SHEET === 'S-301' ? 0.05 : 0.3), w, h); cam.updateProjectionMatrix();
      trackW = $('track').clientWidth || 1; marks(); if (S.fitInfo) S.fitInfo(); if (S.st.auto) placeCam(camKey(S.st.t)); hud(); dirty = true; sheetsDirty = true; for (const s of SHEETS) s.key = ''; }
    function setSheet(id) { if (id === SHEET) return; clearFocus(); SHEET = id; S.sheet = id; TL = TLS[id]; S.TL = TL; S.st.play = false; WK.key = ''; dynKey = ''; leadKey = ''; tabs();
      S.st.auto = true; $('b-home').classList.remove('on'); layout(); let t = S.st.t; if (id === 'S-301' && (t < TL.t0 || t >= TL.t1)) t = TL.t0; setT(t); }
    S.setSheet = setSheet; addEventListener('hashchange', () => { setSheet(sheetOf()); applyFocusHash(); });
    addEventListener('resize', layout);
    const PIX = +(hp.get('pix') || 5.0e6);

    // ---------------- 渲染 ----------------
    const paperQuad = (() => { const m = new THREE.ShaderMaterial({ uniforms: { uA: { value: 0 }, uPaper: U.uPaper }, transparent: true, depthTest: false, depthWrite: false, vertexShader: 'void main(){ gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }', fragmentShader: 'uniform float uA; uniform vec3 uPaper; void main(){ gl_FragColor = vec4(uPaper, uA); }' });
      const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m); q.frustumCulled = false; const sc = new THREE.Scene(); sc.add(q); return { sc, m }; })();
    const LITONLY = [LOOK.sky, MTN, ground, CTX.city, sun, hemi], INKONLY = [CTX.lines];
    const postOpts = () => { const Pp = Object.assign({}, T.post); return Object.assign(Pp, { sd: sunDir, sunC: T.sun, interior: false, exp: Pp.exp * look.exp, sat: Pp.sat * look.sat, warm: Pp.warm.map(v => 1 + (v - 1) * look.warm), ao: true, vol: 0, dust: 0, fogA: 0.00012, fogH: 140, mistA: 0, god: Pp.god * 0.7, bloom: Pp.bloom * 1.1 }); };
    let lastNow = performance.now();
    const GL2 = (() => { const g = renderer.getContext(); return typeof WebGL2RenderingContext !== 'undefined' && g instanceof WebGL2RenderingContext && !hp.has('nofence') ? g : null; })(), FEN = [];
    function renderInk(la) { for (const o of LITONLY) o.visible = false; for (const o of INKONLY) o.visible = true; MESH.material = inkMat; DYN.mesh.material = DYN.mesh.userData.ink; LINES.visible = true; DYN.lines.visible = true; WK.WU.uInk.value = 1; STR.material.uniforms.uC.value.set(0xb3202a);
      U.uLA.value = la; renderer.setRenderTarget(null); renderer.setClearColor(0xefe9dd, 1); renderer.toneMapping = THREE.NoToneMapping; renderer.render(scene, cam); }
    function renderLit() { for (const o of LITONLY) o.visible = true; for (const o of INKONLY) o.visible = false; MESH.material = MESH.userData.lit; DYN.mesh.material = DYN.mesh.userData.lit; LINES.visible = false; DYN.lines.visible = false; WK.WU.uInk.value = 0; STR.material.uniforms.uC.value.set(0x0f0d0d);
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.setClearColor(0x000000, 1);
      shadowAge++; if (shadowWant && (!S.st.play || shadowAge >= (S.pose && S.pose.lifting ? SPL : SP))) { renderer.shadowMap.needsUpdate = true; shadowWant = false; shadowAge = 0; lastShadowT = S.st.t; }
      if (POST.level > 0) POST.render(scene, cam, postOpts()); else { renderer.setRenderTarget(null); renderer.render(scene, cam); } }
    function frame(now) { requestAnimationFrame(frame); const dt = Math.min(0.1, (now - lastNow) / 1000); lastNow = now;
      if (S.st.play) { const u = Math.min(1, S.st.u + dt / TL.playSec); setT(TL.u2t(u), u); if (u >= 1) { S.st.play = false; hud(); } }
      flyStep(now); follow(dt); svaStep(now); if (S._zonePend && SHEETS[0].pm) sheetToZone(S._zonePend); if (ctl.update()) dirty = true;
      // 图纸：时间变了才重画；每帧最多一张（错开），播放中每张 ≤ 20 Hz
      if (sheetsDirty && SHEET === 'S-301' && !S.noSheet) { const k = S.st.t.toFixed(3) + (AU ? 'a' : ''); let any = false; const ord = SHEETS.slice().sort((a, b) => a.drawn - b.drawn); let drew = false;
        for (const s of ord) { if (s.key === k) continue; any = true; if ((!drew || !S.st.play) && (!S.st.play || now - s.drawn > 50)) { s.key = k; drawSheet(s, now); drew = true; } } if (!any) sheetsDirty = false; }
      if (!dirty && !hp.has('always')) return;
      // set1：GPU 帧节拍 —— 最多 2 帧在 GPU 队列里（WebGL2 fence）；否则本次 rAF 跳过渲染、保留 dirty。无 vsync 时 CPU 帧极便宜会把队列塞满，Chrome 回压一次卡 0.3–1.2 s（Mac 实测，PLAYBOOK #43）
      if (GL2 && FEN.length >= 2) { const st = GL2.clientWaitSync(FEN[0], 0, 0); if (st === GL2.TIMEOUT_EXPIRED) return; GL2.deleteSync(FEN.shift()); }
      dirty = false;
      const pf0 = performance.now(); rebuildDyn(S.st.t); U.uCam.value.copy(cam.position); const pf1 = performance.now();
      renderer.info.reset(); const b = S.blend; document.body.classList.toggle('lit', b > 0.5);
      if (b <= 0.001) renderInk(1);
      else { renderLit(); if (b < 0.999) { renderer.autoClear = false; paperQuad.m.uniforms.uA.value = Math.max(0, (0.85 - b) / 0.85) * 0.9; renderer.render(paperQuad.sc, cam);
          const vis = scene.children.map(o => o.visible); for (const o of scene.children) o.visible = (o === LINES || o === CTX.lines || o === DYN.lines || o === MESH); MESH.material = inkMat; inkMat.colorWrite = false; renderer.clearDepth(); U.uLA.value = Math.max(1 - FV.ik, 1 - b); renderer.toneMapping = THREE.NoToneMapping; renderer.render(scene, cam); scene.children.forEach((o, i) => o.visible = vis[i]); inkMat.colorWrite = true; MESH.material = MESH.userData.lit; renderer.autoClear = true; } }
      if (GL2) { FEN.push(GL2.fenceSync(GL2.SYNC_GPU_COMMANDS_COMPLETE, 0)); GL2.flush(); } const pf2 = performance.now(); S.frames++; S.calls = renderer.info.render.calls; lead(); const pf3 = performance.now(); if (S.pf) { const q = S.pf; q.n++; q.dyn = Math.max(q.dyn, pf1 - pf0); q.rnd = Math.max(q.rnd, pf2 - pf1); q.lead = Math.max(q.lead, pf3 - pf2); q.pre = Math.max(q.pre, pf0 - now); } }
    // ---------------- 3D 引线标注：旋转提升时标转轴，其余时刻标当前工作面 ----------------
    const LEAD = $('lead'), MC = document.createElement('canvas').getContext('2d'), v3v = new THREE.Vector3(); let leadKey = '';
    const OBSEL = '#big,#rd .r,#fin';
    function lead301() { const t = S.st.t, r = v3.getBoundingClientRect(), W = r.width, H = r.height, b = S.big || big301(t), J = b.J, ps = S.pose, A = [];
      const gp = S.gapAt; if (gp) A.push({ p: [gp.at[0], (gp.at[1] + P.floorTop) / 2, gp.at[2]], t1: '净空 ' + SH.f2(gp.v) + ' m', t2: gp.sec ? '剖面 B–B 最低处 · 下弦 → 楼面' : '此处下弦 → 候车层楼面', gap: 1 });
      if (SV.sel >= 0) { const q = J.rows[SV.sel]; A.push({ p: [q.x, q.top + 2.2, q.z], t1: 'J' + String(q.i + 1).padStart(2, '0') + ' 提升器 · 行程 ' + fmt(q.disp * 1000) + ' mm', t2: '同步偏差 ' + (q.dev >= 0 ? '+' : '−') + Math.abs(q.dev).toFixed(1) + ' mm · ' + (q.on && J.m ? (STATE[J.m.state] || '') : '本段不动'), sel: 1 }); }
      if (J.act && SV.sel < 0 && !SV.cut) { cam.updateMatrixWorld(); let best = null; for (const q of J.rows) { if (!q.on) continue; v3v.set(q.x, q.top + 2, q.z).project(cam); const x = (v3v.x + 1) / 2 * W, y = (1 - v3v.y) / 2 * H; if (v3v.z > 1 || x < 40 || x > W - 40 || y < 40 || y > H - 40) continue; const d = cam.position.distanceTo(v3v.set(q.x, q.top, q.z)); if (!best || d < best.d) best = { q, d }; }
        if (best) { const q = best.q; A.push({ p: [q.x, q.top + 2.2, q.z], t1: '提升器 J' + String(q.i + 1).padStart(2, '0') + ' ' + fmt(q.disp * 1000) + ' mm', t2: '同步偏差 ' + (q.dev >= 0 ? '+' : '') + q.dev.toFixed(1) + ' mm · ' + (STATE[J.m.state] || '') }); }
      } if (J.act && SV.cut !== 2) { const z = J.act.liftZone; if (z === 1 || z === 3) { const zz = z === 1 ? 45.5 : -45.5, xx = 60, hb = HZ.Ht(xx, zz) - P.depth; A.push({ p: HZ.xf(ps, z, [xx, hb, zz]), t1: ZN[z] + '内边 +' + (HZ.innerDrop * ps[z].r).toFixed(2) + ' m', t2: '绕外缘已转 ' + (4 * ps[z].r).toFixed(2) + '° / 4°' }); } }
      cam.updateMatrixWorld(); const pts = A.map(a => { v3v.set(a.p[0], a.p[1], a.p[2]).project(cam); return Object.assign(a, { x: (v3v.x + 1) / 2 * W, y: (1 - v3v.y) / 2 * H, ok: v3v.z < 1 }); }).filter(a => a.ok && a.x > 6 && a.y > 6 && a.x < W - 6 && a.y < H - 6);
      const key = pts.map(a => [a.x | 0, a.y | 0, a.t1, a.t2].join('|')).join('/') + W + 'x' + H; if (key === leadKey) return; leadKey = key; LEAD.setAttribute('width', W); LEAD.setAttribute('height', H);
      const m = 6, obs = [...document.querySelectorAll(OBSEL)].filter(e => window.getComputedStyle(e).display !== 'none').map(e => { const q = e.getBoundingClientRect(); return { l: q.left - r.left - m, r: q.right - r.left + m, t: q.top - r.top - m, b: q.bottom - r.top + m }; });
      const ff = getComputedStyle(document.body), F1 = innerHeight < 640 ? 16 : 18, F2 = innerHeight < 640 ? 13 : 15; let o = ''; const esc = q => q.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); let placed = 0;
      for (const a of pts) obs.push({ l: a.x - 8, r: a.x + 8, t: a.y - 8, b: a.y + 8 });
      for (const a of pts) { MC.font = '700 ' + F1 + 'px ' + ff.getPropertyValue('--serif'); const w1 = MC.measureText(a.t1).width; MC.font = F2 + 'px ' + ff.getPropertyValue('--mono'); const w = Math.ceil(Math.max(w1, MC.measureText(a.t2).width)) + 8, h = F1 + F2 + 10, x = a.x, y = a.y;
        const free = (lx, ly) => lx >= 8 && ly >= 8 && lx + w <= W - 8 && ly + h <= H - 8 && obs.every(q => lx + w < q.l || lx > q.r || ly + h < q.t || ly > q.b);
        let pos = null; for (const [lx, ly] of [[x + 40, y - 70], [x - 40 - w, y - 70], [x + 50, y + 30], [x - 50 - w, y + 30], [x + 60, y - 120], [x - 60 - w, y - 120], [x + 80, y - 20], [x - 80 - w, y - 20], [x + 30, y + 80], [x - 30 - w, y + 80], [x + 120, y - 160], [x - 120 - w, y - 160]]) if (free(lx, ly)) { pos = [lx, ly]; break; }
        o += `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="#b3202a" stroke-width="1.4"/><circle cx="${x}" cy="${y}" r="1.8" fill="#b3202a"/>`;
        if (!pos) continue; const [lx, ly] = pos, ux = lx + w / 2 < x ? lx + w : lx, yb = ly + F1 + 4; obs.push({ l: lx - 4, r: lx + w + 4, t: ly - 4, b: ly + h + 4 }); placed++; a.placed = 1;
        o += `<polyline points="${x},${y} ${ux},${yb} ${ux === lx ? lx + w : lx},${yb}" fill="none" stroke="#b3202a" stroke-width="1"/><text class="lt" x="${lx + 4}" y="${ly + F1}" font-size="${F1}" font-weight="700">${esc(a.t1)}</text><text class="ls" x="${lx + 4}" y="${ly + F1 + F2 + 6}" font-size="${F2}">${esc(a.t2)}</text>`; }
      LEAD.innerHTML = o; S.leadPlaced = placed; S.leadText = pts.map(a => a.t1).join(' / '); const lg = pts.find(a => a.gap); S.leadGap = lg ? lg.t1 : ''; S.leadGapPlaced = !!(lg && lg.placed); }
    function lead() { if (S.noLead) return; if (SHEET === 'S-301') return lead301(); const t = S.st.t, r = v3.getBoundingClientRect(), W = r.width, H = r.height; let anchor = null, t1 = '', t2 = '';
      for (const [zone, zA, key, nm] of [[1, P.roofB, 'lift1', '南区'], [3, -P.roofB, 'lift3', '北区']]) { const A = K[key]; if (t >= A.start - 1 && t < A.end + 1) { anchor = [0, P.roofLo + S.pose[zone].dy, zA]; t1 = '转轴 · ' + nm + '外缘（东西向）'; t2 = '已转 ' + (4 * S.pose[zone].r).toFixed(1) + '° / 4° · 内边抬升 ' + (HZ.innerDrop * S.pose[zone].r).toFixed(1) + ' / ' + HZ.innerDrop.toFixed(1) + ' m'; } }
      if (!anchor && t < TL.OPEN) { const c = HZ.caption(t).act; if (c && c.parts.length) { const ps = c.parts.filter(p => p.st <= t).sort((a, b) => b.st - a.st)[0]; if (ps) { anchor = HZ.xf(S.pose, ps.grp || 0, [ps.c[0], ps.top, ps.c[2]]); t1 = c.name; t2 = (QTY(c) || '') + (QTY(c) ? ' · ' : '') + HZ.dayDate(c.start) + ' → ' + HZ.dayDate(c.end); } } }
      if (!anchor && t >= TL.OPEN + 2 && S.train && S.train[0] < 5000) { const ws = FV.tw ? -1 : 1; anchor = [S.train[0] + ws * 70, P.deckTop + 4.6, S.train[2]]; t1 = '首趟列车进站'; t2 = HZ.dayDate(TL.OPEN) + ' · 开通运营'; }
      if (!anchor) { if (LEAD.innerHTML) LEAD.innerHTML = ''; S.leadPlaced = false; return; }
      v3v.set(anchor[0], anchor[1], anchor[2]).project(cam); const x = (v3v.x + 1) / 2 * W, y = (1 - v3v.y) / 2 * H; const key = [x | 0, y | 0, t1, t2, W | 0, H | 0].join('|'); if (key === leadKey) return; leadKey = key;
      LEAD.setAttribute('width', W); LEAD.setAttribute('height', H);
      if (v3v.z > 1 || x < 6 || y < 6 || x > W - 6 || y > H - 6) { LEAD.innerHTML = ''; S.leadPlaced = false; return; }
      const F1 = innerHeight < 640 ? 16 : 18, F2 = innerHeight < 640 ? 13 : 15; MC.font = '700 ' + F1 + 'px ' + getComputedStyle(document.body).getPropertyValue('--serif'); const w1 = MC.measureText(t1).width; MC.font = F2 + 'px ' + getComputedStyle(document.body).getPropertyValue('--mono'); const w = Math.ceil(Math.max(w1, MC.measureText(t2).width)) + 8, h = F1 + F2 + 10, m = 6;
      const obs = [...document.querySelectorAll(OBSEL)].filter(e => getComputedStyle(e).display !== 'none').map(e => { const q = e.getBoundingClientRect(); return { l: q.left - r.left - m, r: q.right - r.left + m, t: q.top - r.top - m, b: q.bottom - r.top + m }; });
      const free = (lx, ly) => lx >= 8 && ly >= 8 && lx + w <= W - 8 && ly + h <= H - 8 && obs.every(o => lx + w < o.l || lx > o.r || ly + h < o.t || ly > o.b) && !(x >= lx - 6 && x <= lx + w + 6 && y >= ly - 6 && y <= ly + h + 6);
      const Cc = [[x + 50, y - 80], [x - 50 - w, y - 80], [x + 60, y - 130], [x - 60 - w, y - 130], [x + 70, y + 30], [x - 70 - w, y + 30], [x + 90, y - 30], [x - 90 - w, y - 30]]; let pos = null; for (const [lx, ly] of Cc) if (free(lx, ly)) { pos = [lx, ly]; break; }
      let o = `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="#b3202a" stroke-width="1.3"/><circle cx="${x}" cy="${y}" r="1.6" fill="#b3202a"/>`;
      if (pos) { const [lx, ly] = pos, ux = lx + w / 2 < x ? lx + w : lx, yb = ly + F1 + 4; const esc = q => q.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
        o += `<polyline points="${x},${y} ${ux},${yb} ${ux === lx ? lx + w : lx},${yb}" fill="none" stroke="#b3202a" stroke-width=".9"/><text class="lt" x="${lx + 4}" y="${ly + F1}" font-size="${F1}" font-weight="700">${esc(t1)}</text><text class="ls" x="${lx + 4}" y="${ly + F1 + F2 + 6}" font-size="${F2}">${esc(t2)}</text>`; }
      LEAD.innerHTML = o; S.leadPlaced = !!pos; S.leadText = t1; }
    tabs(); applyLook(); layout();
    { STR.visible = true; renderer.compile(scene, cam); MESH.material = inkMat; renderer.compile(scene, cam); MESH.material = MESH.userData.lit; STR.visible = false; }
    // 预热：实景 / 墨线两条管线在“施工中（塔吊、履带吊、运输车、钢绞线在场）”与“竣工”各画一帧，着色器与阴影深度材质在加载时编译（Mac 实测：首次在施工中切实景卡 2.6 s）
    tabs(); S.sheet = SHEET;
    if (!hp.has('nowarm')) { const pref = S.st.pref, TLk = TL; TL = TLF; for (const [tw, m] of [[K.lift1.start + 1, 'lit'], [K.asm1.start + 10, 'lit'], [TL.Tmax, 'lit'], [K.lift1.start + 1, 'ink']]) { S.st.pref = m; setT(tw); dynKey = ''; rebuildDyn(tw); STR.visible = true; shadowWant = true; if (m === 'lit') renderLit(); else renderInk(1); } S.st.pref = 'lit'; S.st.auto = false; setT(TL.Tmax); for (const az of [0, 45, 90, 135, 180, 225, 270, 315, look.sunAz - 180]) { placeCam({ az, el: az === look.sunAz - 180 ? 3 : 9, d: 900, tx: 0, ty: 30, tz: 0 }); cam.lookAt(0, 30, 0); cam.updateMatrixWorld(); shadowWant = true; renderLit(); } S.st.auto = true;   // 正对太阳：光束（god rays）后处理第一次启用时也会现场编译（Mac 实测转向太阳卡 2.2 s）
      S.st.pref = pref; TL = TLk; WK.key = ''; dynKey = ''; renderer.getContext().finish(); }
    const t0 = hp.has('t') ? +hp.get('t') : SHEET === 'S-301' ? TL.t0 : K.lift1.start + K.lift1.dur * 0.7; setT(t0); S.st.play = hp.get('play') !== '0'; if (S.st.pref === 'lit') $('b-mode').classList.add('on'); hud(); ctl.update();
    requestAnimationFrame(frame);
    Object.assign(S, { calcText, cumOf, evAt, v3, applyLook, cam, ctl, render: () => { dirty = true; }, TL, TLF, loadMs: Math.round(performance.now() - T0), SHEETS, layout });
    applyFocusHash();
    S.ready = true; document.body.classList.add('ready');
  }
  main().catch(e => { console.error(e); const el = $('cap'); if (el) el.textContent = '加载失败：' + e.message; });
})();
