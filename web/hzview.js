'use strict';
// ===== 杭州西站 建造过程 · r2「机器在实时推演并出图」（hzwest-r2）=====
// 一屏：左 = 3D（默认墨线图：黑墨已建、红色当前、淡红幽灵未建；可切实景）+ 计算读数；右 = 三张实时图纸（同一份构件 / 姿态 / 时刻，只在时间变化时重画）；底 = 时间轴。
// 结尾开通：墨线淡出，过渡到黄金时刻实景（look.js），图纸盖“竣工”。顺序来自 hzseq.js（规则 → core/seq.js 排程），审计在 Worker 里跑，读数按时间累计显示审计真实做过的检查次数。
(function () {
  const THREE_BASE = 'https://unpkg.com/three@0.160.0/';
  const $ = id => document.getElementById(id), hp = new URLSearchParams(location.hash.slice(1));
  const HZ = window.HZ, SEQ = window.SEQ, S = window.__pv = { ready: false, frames: 0, calls: 0, auditDone: false, sheetDraws: 0, st: { t: 0, u: 0, play: false, auto: true, info: false, pref: hp.get('mode') === 'lit' ? 'lit' : 'ink' } };
  const ICON = { play: 'M3 1.5v11l9.5-5.5z', pause: 'M2.5 1.5h3.2v11H2.5zM8.3 1.5h3.2v11H8.3z' };
  const icon = k => `<svg class="i" viewBox="0 0 14 14" aria-hidden="true"><path d="${ICON[k]}"/></svg>`;
  const fmt = n => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  let TL = null;
  function timeline() {
    const K = HZ.K, OPEN = HZ.P.OPEN, FIN = 30, Tmax = OPEN + FIN, N = Tmax * 4;
    const l0 = K.lift1.start - 2, l1 = K.head.end + 2, a0 = K.jig1.start, a1 = K.lift1.start;
    const w = t => { let v = 1; if (t >= l0 && t <= l1) v = 14; else if (t > a0 && t < a1) v = 2.2; else if (t > OPEN - 14) v = 2.6; else if (t < 300) v = 0.55; return v; };
    const cum = new Float64Array(N + 1); for (let i = 1; i <= N; i++) cum[i] = cum[i - 1] + w((i - 0.5) / 4) / 4;
    const L = cum[N]; for (let i = 0; i <= N; i++) cum[i] /= L;
    const t2u = t => { const x = Math.max(0, Math.min(N, t * 4)), i = Math.min(N - 1, Math.floor(x)); return cum[i] + (cum[i + 1] - cum[i]) * (x - i); };
    const u2t = u => { u = Math.max(0, Math.min(1, u)); let lo = 0, hi = N; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= u) lo = m; else hi = m; } const f = (u - cum[lo]) / Math.max(1e-12, cum[hi] - cum[lo]); return (lo + f) / 4; };
    return { Tmax, OPEN, t2u, u2t, l0, l1, playSec: 72 };
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
    HZ.make(); TL = timeline(); S.Tmax = TL.Tmax; S.OPEN = TL.OPEN; S.HZ = HZ; const K = HZ.K, P = HZ.P;
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
    const U = { uT: { value: 0 }, uG: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Matrix4()) }, uGlowDays: { value: 6 }, uGlowCol: { value: new THREE.Vector3(1.0, 0.58, 0.26).multiplyScalar(0.6) }, uLights: { value: 0 }, uPV: { value: 0 }, uLightCol: { value: new THREE.Vector3(1.0, 0.78, 0.5) },
      uPaper: { value: new THREE.Color('#efe9dd') }, uRed: { value: new THREE.Color('#b3202a') }, uInk: { value: new THREE.Color('#1d1a17') }, uTemp: { value: new THREE.Color('#c46a12') }, uSun2: { value: new THREE.Vector3(-0.45, 0.8, 0.4).normalize() }, uLA: { value: 1 }, uGhost: { value: 1 }, uCam: { value: new THREE.Vector3() } };
    const VDEF = `attribute vec4 aK; attribute vec2 aR; attribute vec2 aY; attribute float aG; attribute vec4 aM;
      uniform float uT, uGlowDays; uniform mat4 uG[6]; varying vec4 vM; varying float vGlow; varying vec3 vWq; mat4 hzM; vec3 hzP;
      void hzCalc() { float s = aK.x, d = max(aK.y, 1e-3), p = clamp((uT - s) / d, 0.0, 1.0), r = 1.0;
        if (aR.x >= 0.0) r = 1.0 - clamp((uT - aR.x) / max(aR.y, 1e-3), 0.0, 1.0);
        float k = p * r; k = k * k * (3.0 - 2.0 * k); vec3 q = position; q.y = aY.x + (q.y - aY.x) * k;
        hzM = uG[int(aG + 0.5)]; hzP = (hzM * vec4(q, 1.0)).xyz; if (uT < s || k < 1e-4) hzP = vec3(0.0, -1e5, 0.0);
        vGlow = uT >= s ? (1.0 - smoothstep(s + d, s + d + uGlowDays, uT)) * (aR.x >= 0.0 && uT > aR.x ? 0.0 : 1.0) : 0.0; vM = aM; vWq = q; }
`;
    const PK = HZ.PVK, PP = HZ.P;
    const PVGLSL = `varying vec4 vM; varying float vGlow; varying vec3 vWq; uniform vec3 uGlowCol, uLightCol; uniform float uLights, uPV;
      float hzSm(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
      float hzPVMask(vec2 p) { float th = atan(p.y, p.x), c = abs(cos(th)) / ${PP.roofA.toFixed(2)}, s = abs(sin(th)) / ${PP.roofB.toFixed(2)};
        float R = pow(pow(c, 4.0) + pow(s, 4.0), -0.25) * (1.0 + 0.022 * sin(8.0 * th + 0.6) + 0.012 * sin(13.0 * th)), r = length(p) / R, u = abs(p.x) / ${PP.roofA.toFixed(2)}, v = abs(p.y) / ${PP.roofB.toFixed(2)};
        return hzSm(${PK[0].toFixed(3)}, ${(PK[0] + 0.04).toFixed(3)}, r) * (1.0 - hzSm(${(PK[1] - 0.04).toFixed(3)}, ${PK[1].toFixed(3)}, r)) * hzSm(${PK[2].toFixed(3)}, ${(PK[2] + 0.04).toFixed(3)}, u) * hzSm(${PK[2].toFixed(3)}, ${(PK[2] + 0.04).toFixed(3)}, v); }
`;
    function patchStd(mat) {
      mat.onBeforeCompile = sh => { Object.assign(sh.uniforms, U);
        sh.vertexShader = VDEF + sh.vertexShader.replace('#include <beginnormal_vertex>', 'hzCalc();\nvec3 objectNormal = mat3(hzM) * normal;').replace('#include <begin_vertex>', 'vec3 transformed = hzP;');
        sh.fragmentShader = PVGLSL + sh.fragmentShader
          .replace('#include <color_fragment>', '#include <color_fragment>\nfloat hzPV = 0.0; if (vM.w > 0.5 && vM.w < 1.5) { hzPV = hzPVMask(vWq.xz) * step(vWq.z, mix(-170.0, 175.0, uPV)); vec2 sd = abs(fract(vWq.xz / vec2(3.5, 1.75)) - 0.5); float ln = 1.0 - smoothstep(0.0, fwidth(vWq.x / 3.5) * 1.5, 0.5 - sd.x); diffuseColor.rgb *= 1.0 - 0.06 * ln; vec2 pc = abs(fract(vWq.xz / vec2(2.0, 1.0)) - 0.5); float pl = max(1.0 - smoothstep(0.0, fwidth(vWq.x / 2.0) * 1.2, 0.5 - pc.x), 1.0 - smoothstep(0.0, fwidth(vWq.z) * 1.2, 0.5 - pc.y)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.26, 0.48) * (1.0 - 0.35 * pl) + vec3(0.12) * pl, hzPV); }\nif (vM.w > 1.5) { vec2 gc = abs(fract(vWq.xz / vec2(2.4, 2.4)) - 0.5); float gl = max(1.0 - smoothstep(0.0, fwidth(vWq.x / 2.4) * 1.3, 0.5 - gc.x), 1.0 - smoothstep(0.0, fwidth(vWq.z / 2.4) * 1.3, 0.5 - gc.y)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75), gl * 0.6); }')
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(vM.x, 0.18, hzPV);').replace('#include <metalnessmap_fragment>', 'float metalnessFactor = mix(vM.y, 0.6, hzPV);')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlowCol * vGlow * (0.35 + 0.65 * vGlow) + diffuseColor.rgb * uLightCol * vM.z * uLights * 1.6;'); };
      mat.customProgramCacheKey = () => 'hz-std'; return mat; }
    function patchDepth(mat) { mat.onBeforeCompile = sh => { Object.assign(sh.uniforms, U); sh.vertexShader = VDEF + sh.vertexShader.replace('#include <begin_vertex>', 'hzCalc();\nvec3 transformed = hzP;'); }; mat.customProgramCacheKey = () => 'hz-depth'; return mat; }
    // 墨线·淡彩填充：纸色 + 三档明暗；当前构件红
    const inkMat = new THREE.ShaderMaterial({ uniforms: U, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      vertexShader: VDEF + `attribute vec3 color; attribute float aF; varying vec3 vN; varying vec3 vC; varying float vCur; varying float vTmp; void main() { hzCalc(); vN = mat3(hzM) * normal; vC = color; vTmp = aF; vCur = vGlow > 0.0 && uT < aK.x + aK.y + 2.0 ? 1.0 : 0.0; gl_Position = projectionMatrix * viewMatrix * vec4(hzP, 1.0); }`,
      fragmentShader: `uniform vec3 uPaper, uRed, uSun2, uTemp; varying vec3 vN; varying vec3 vC; varying float vCur; varying vec4 vM; varying float vTmp;
        void main() { vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; float l = dot(n, uSun2); vec3 c = pow(vC, vec3(1.0 / 2.2)); vec3 base = vTmp > 0.5 ? mix(uPaper, uTemp, 0.55) : mix(uPaper, c, 0.34);
          float f = l > 0.5 ? 1.0 : (l > 0.08 ? 0.9 : 0.8); if (n.y > 0.8) f = 1.03; vec3 col = base * f;
          if (l < 0.08 && n.y < 0.5) col *= 1.0 - 0.07 * step(0.75, fract((gl_FragCoord.x - gl_FragCoord.y) / 4.0));
          if (vCur > 0.5 && vTmp < 0.5) col = mix(col, uRed, 0.5); gl_FragColor = vec4(col, 1.0); }` });
    // 墨线：未建 = 设计位幽灵（淡红）/ 在建 = 红 / 已建 = 墨 / 临时 = 橙；随姿态矩阵移动
    const LVS = `attribute vec4 aK; attribute vec2 aR; attribute vec2 aY; attribute float aG; attribute float aF; uniform float uT, uGlowDays; uniform mat4 uG[6]; uniform vec3 uCam; varying float vS; varying float vF; varying float vD;
      void main() { float s = aK.x, d = max(aK.y, 1e-3), p = clamp((uT - s) / d, 0.0, 1.0), r = 1.0; if (aR.x >= 0.0) r = 1.0 - clamp((uT - aR.x) / max(aR.y, 1e-3), 0.0, 1.0);
        float k = p * r; k = k * k * (3.0 - 2.0 * k); vec3 q = position; mat4 M = uG[int(aG + 0.5)];
        if (uT < s) { vS = -1.0; M = mat4(1.0); } else { q.y = aY.x + (q.y - aY.x) * k; vS = uT < s + d + 2.0 ? 0.5 : 2.0; if (k < 1e-4) vS = -3.0; }
        vec4 w = M * vec4(q, 1.0); vF = aF; vD = distance(w.xyz, uCam); gl_Position = projectionMatrix * viewMatrix * w; }`;
    const LFS = `uniform vec3 uInk, uRed, uTemp; uniform float uLA, uGhost; varying float vS; varying float vF; varying float vD;
      void main() { if (vS < -2.0) discard; float fade = 1.0 - 0.55 * smoothstep(900.0, 3000.0, vD);
        if (vS < 0.0) { if (uGhost < 0.5 || vF > 0.5) discard; gl_FragColor = vec4(uRed, 0.085 * uLA * fade); return; }
        if (vS < 1.0) { gl_FragColor = vec4(uRed, uLA); return; }
        gl_FragColor = vec4(vF > 0.5 ? uTemp : uInk, (vF > 1.5 ? 0.55 : 0.72) * uLA * fade); }`;
    const lineMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: LVS, fragmentShader: LFS, transparent: true, depthWrite: false });

    const trainGeo = (() => { const g = new HZ.GB('train'), cars = 8, L = 25.5; for (let k = 0; k < cars; k++) { const x0 = k * (L + 0.8); g.box(x0, 0.6, -1.6, x0 + L, 4.1, 1.6, HZ.MAT.train.c, false); g.box(x0, 1.9, -1.62, x0 + L, 2.25, 1.62, [0.85, 0.15, 0.12], false); g.box(x0 + 0.5, 2.6, -1.63, x0 + L - 0.5, 3.3, 1.63, [0.12, 0.14, 0.18], false); }
      g.hexa([[-12, 0.6, -1.6], [0, 0.6, -1.6], [0, 0.6, 1.6], [-12, 0.6, 1.6], [-12, 1.2, -0.6], [0, 4.1, -1.6], [0, 4.1, 1.6], [-12, 1.2, 0.6]], HZ.MAT.train.c, false);
      for (let k = 0; k < cars; k++) { const x0 = k * (L + 0.8); for (const [a, b] of [[[x0, 4.1, -1.6], [x0 + L, 4.1, -1.6]], [[x0, 4.1, 1.6], [x0 + L, 4.1, 1.6]], [[x0, 0.6, 1.6], [x0 + L, 0.6, 1.6]], [[x0, 0.6, -1.6], [x0 + L, 0.6, -1.6]]]) g.line(a, b); } return g; })();
    function compile() {
      const items = []; for (const a of HZ.acts) { if (a.kind === 'untemp' || !a.parts.length) continue; for (const p of a.parts) items.push({ p, st: p.st, du: p.du, rm: p.rm, temp: a.kind === 'temp' ? 1 : 0 }); }
      items.push({ p: { geo: trainGeo, mat: 'train', grp: 5 }, st: -20, du: 0.01, rm: [-1, 0], temp: 0 });
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
      const litMat = patchStd(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.9 })); envMats.push(litMat);
      const mesh = new THREE.Mesh(geo, litMat); mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.userData.lit = litMat;
      mesh.customDepthMaterial = patchDepth(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide }));
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(LP, 3)); lg.setAttribute('aK', new THREE.BufferAttribute(LK, 4)); lg.setAttribute('aR', new THREE.BufferAttribute(LR, 2)); lg.setAttribute('aY', new THREE.BufferAttribute(LY, 2)); lg.setAttribute('aG', new THREE.BufferAttribute(LG, 1)); lg.setAttribute('aF', new THREE.BufferAttribute(LF, 1));
      const lines = new THREE.LineSegments(lg, lineMat); lines.frustumCulled = false; lines.renderOrder = 2;
      S.tris = nv / 3; S.segs = nl / 2; return { mesh, lines }; }
    const { mesh: MESH, lines: LINES } = compile(); scene.add(MESH, LINES);

    // ---- 钢绞线 ----
    const STR = (() => { const L = HZ.K.rig.strands, Pq = new Float32Array(L.length * 6), G = new Float32Array(L.length * 2); L.forEach((s, i) => { Pq.set(s.a, i * 6); Pq.set(s.b, i * 6 + 3); G[i * 2] = 0; G[i * 2 + 1] = s.gb; });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(Pq, 3)); g.setAttribute('aG', new THREE.BufferAttribute(G, 1));
      const m = new THREE.ShaderMaterial({ uniforms: { uG: U.uG, uA: { value: 0 }, uC: { value: new THREE.Color(0x0f0d0d) } }, transparent: true, depthWrite: false,
        vertexShader: 'attribute float aG; uniform mat4 uG[6]; void main() { vec4 p = uG[int(aG + 0.5)] * vec4(position, 1.0); gl_Position = projectionMatrix * viewMatrix * p; }',
        fragmentShader: 'uniform float uA; uniform vec3 uC; void main() { gl_FragColor = vec4(uC, 0.9 * uA); }' });
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
      const litM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 }); envMats.push(litM);
      const inkM = new THREE.ShaderMaterial({ uniforms: { uPaper: U.uPaper, uSun2: U.uSun2 }, vertexShader: 'attribute vec3 color; varying vec3 vN; varying vec3 vC; void main() { vN = normal; vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 uPaper, uSun2; varying vec3 vN; varying vec3 vC; void main() { float l = dot(normalize(vN), uSun2); vec3 b = mix(uPaper, pow(vC, vec3(1.0 / 2.2)), 0.42); gl_FragColor = vec4(b * (l > 0.5 ? 1.0 : l > 0.08 ? 0.9 : 0.8), 1.0); }', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      const mesh = new THREE.Mesh(mg, litM); mesh.frustumCulled = false; mesh.castShadow = true; mesh.userData = { lit: litM, ink: inkM };
      const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false })); lines.frustumCulled = false; lines.renderOrder = 3;
      return { mesh, lines, mg, lg }; })();
    scene.add(DYN.mesh, DYN.lines);
    // 工人（每班重新撒点）
    const WK = (() => { const N = 2400, g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); g.setDrawRange(0, 0);
      const m = new THREE.PointsMaterial({ color: 0x1d1a17, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.8, depthWrite: false }); const o = new THREE.Points(g, m); o.frustumCulled = false; o.renderOrder = 4; return { o, g, N, key: '' }; })();
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
    let dynKey = ''; const DS = { cranesBusy: 0, crawlers: 0, trucks: 0, workers: 0 };
    function rebuildDyn(t) {
      const key = (S.st.t).toFixed(3); if (key === dynKey) return; dynKey = key;
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
      // 上传
      const n = g.P.length / 3, mp = DYN.mg.attributes.position.array, mn = DYN.mg.attributes.normal.array, mc = DYN.mg.attributes.color.array, cc = new THREE.Color();
      for (let i = 0; i < Math.min(n, 60000); i++) { for (let k = 0; k < 3; k++) { mp[i * 3 + k] = g.P[i * 3 + k]; mn[i * 3 + k] = g.N[i * 3 + k]; } cc.setRGB(g.C[i * 3], g.C[i * 3 + 1], g.C[i * 3 + 2], THREE.SRGBColorSpace); mc[i * 3] = cc.r; mc[i * 3 + 1] = cc.g; mc[i * 3 + 2] = cc.b; }
      DYN.mg.setDrawRange(0, Math.min(n, 60000)); DYN.mg.attributes.position.needsUpdate = DYN.mg.attributes.normal.needsUpdate = DYN.mg.attributes.color.needsUpdate = true;
      const lp = DYN.lg.attributes.position.array, lc = DYN.lg.attributes.color.array; let m = 0; const inkMode = S.blend < 0.5;
      for (let i = 0; i < g.L.length / 6 && m < 29990; i++, m += 2) { for (let k = 0; k < 6; k++) lp[m * 3 + k] = g.L[i * 6 + k]; for (let k = 0; k < 6; k++) lc[m * 3 + k] = inkMode ? INK[k % 3] : 0.2; }
      for (const [a, b, c] of Lq) { if (m >= 29990) break; lp.set(a, m * 3); lp.set(b, m * 3 + 3); lc.set(c, m * 3); lc.set(c, m * 3 + 3); m += 2; }
      DYN.lg.setDrawRange(0, m); DYN.lg.attributes.position.needsUpdate = DYN.lg.attributes.color.needsUpdate = true;
      // 工人：每班（12 h）撒一次；落在在建构件的顶面
      const shift = Math.floor(t * 2), wkey = shift + ':' + act.length; if (wkey !== WK.key) { WK.key = wkey; const rr = SEQ.rng(shift * 7919 + 13), wp = WK.g.attributes.position.array; let w = 0, crew = 0;
        for (const a of act) { const c = Object.keys(a.res).reduce((s, k) => s + (CREW[k] || 0), 0); crew += c; const pts = a.parts.filter(p => p.st <= t && p.geo.boxes.length); if (!pts.length) continue; const nd = Math.min(WK.N - w, Math.round(c * 0.5));
          for (let i = 0; i < nd; i++) { const p = pts[Math.floor(rr() * pts.length)], b = p.geo.boxes[Math.floor(rr() * p.geo.boxes.length)], q = HZ.xf(S.pose, p.grp || 0, [b.min[0] + (b.max[0] - b.min[0]) * rr(), b.max[1] + 0.9, b.min[2] + (b.max[2] - b.min[2]) * rr()]); if (p.grp && p.grp <= 4 && t < p.st) continue; wp[w * 3] = q[0]; wp[w * 3 + 1] = q[1]; wp[w * 3 + 2] = q[2]; w++; } }
        DS.workers = t < TL.OPEN ? crew : 0; WK.g.setDrawRange(0, t < TL.OPEN ? w : 0); WK.g.attributes.position.needsUpdate = true; }
    }
    S.DS = DS;

    // ---------------- 相机 ----------------
    const CAM = {
      hero: { az: +(hp.get('caz') || -32), el: +(hp.get('cel') || 24), d: +(hp.get('cd') || 820), tx: 0, ty: 22, tz: 10 },
      early: { az: 62, el: 26, d: 860, tx: -20, ty: 6, tz: 0 },
      lift: { az: 64, el: 18, d: 580, tx: 0, ty: 34, tz: 20 },   // r2：几何扫描 105 个机位（work/hzwest2/camsweep.js）+ VM 渲染 8 个，选旋转位移大且不压叠层的
      fin: { az: -22, el: 11, d: 760, tx: -10, ty: 26, tz: 18 } };
    let aspK = 1;
    function camKey(t) { const a = sm(380, 560, t), b = sm(TL.l0 - 25, TL.l0 + 2, t) * (1 - sm(TL.l1, TL.l1 + 40, t)), c = sm(TL.OPEN - 40, TL.OPEN + 10, t);
      const mix = (p, q, k) => { const o = {}; for (const key in p) o[key] = p[key] + (q[key] - p[key]) * k; return o; };
      let k = mix(CAM.early, CAM.hero, a); k = mix(k, CAM.lift, b); k = mix(k, CAM.fin, c);
      k.az += 5 * Math.sin(t / 140); if (S.camOv) Object.assign(k, S.camOv); k.d *= aspK; return k; }
    if (hp.has('cam')) { const v = hp.get('cam').split(',').map(Number); S.camOv = { az: v[0], el: v[1], d: v[2] }; if (v.length > 3) Object.assign(S.camOv, { tx: v[3], ty: v[4], tz: v[5] }); }
    function placeCam(k) { const az = THREE.MathUtils.degToRad(k.az), el = THREE.MathUtils.degToRad(k.el); ctl.target.set(k.tx, k.ty, k.tz); cam.position.set(k.tx + Math.sin(az) * Math.cos(el) * k.d, k.ty + Math.sin(el) * k.d, k.tz - Math.cos(az) * Math.cos(el) * k.d); }
    S.camKey = camKey;

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
    function hud() { const t = S.st.t, d = Math.min(TL.OPEN, Math.floor(t)); put(elDay, String(d)); put(elDate, HZ.dayDate(d));
      const h = roofApex(); put(elH, h == null ? '—' : h.toFixed(1)); put(elR, fmt(rodsAt(Math.min(t, TL.OPEN))));
      const c = HZ.caption(Math.min(t, TL.OPEN)); put(elCap, c.text); S.cap = c.text;
      const L = calcText(t); calcRows.forEach((r, i) => { const x = L[i]; r.style.display = x && i < calcN ? '' : 'none'; if (x) { put(r.firstChild, x[0]); put(r.lastChild, x[1]); } });
      const ne = evAt(t), lg = $('log'); const key = ne + ':' + logN; if (lg._k !== key) { lg._k = key; lg.innerHTML = EV.slice(Math.max(0, ne - logN), ne).reverse().map((e, i) => `<div class="${i ? '' : 'new'}"><span>${HZ.dayDate(e.t)}</span><b>${e.s.replace(/[&<]/g, '')}</b></div>`).join(''); }
      const fin = t >= TL.OPEN + 1; if (finEl._on !== fin) { finEl._on = fin; finEl.style.display = fin ? '' : 'none'; }
      if (fin && AU && !finEl._done) { finEl._done = 1; $('f-n').innerHTML = `<b>${fmt(TL.OPEN)}</b> 天 · <b>${HZ.acts.length}</b> 道工序 · <b>${fmt(Object.values(HZ.counts).reduce((a, b) => a + b, 0))}</b> 条依赖<br><b>${fmt(AU.ev.lift.reduce((s, r) => s + r.tests, 0) + supTot() + clipTot() + AU.r9.tests)}</b> 次几何检查 · 冲突 <b>${AU.zero ? 0 : '✕'}</b>`; }
      knob.style.transform = 'translateX(' + (S.st.u * trackW).toFixed(1) + 'px)'; fill.style.transform = 'scaleX(' + S.st.u.toFixed(5) + ')';
      if (playIcon !== S.st.play) { playIcon = S.st.play; $('b-play').innerHTML = icon(S.st.play ? 'pause' : 'play'); $('b-play').setAttribute('aria-label', S.st.play ? '暂停' : '播放'); }
      const mt = S.st.pref === 'ink' ? '墨线' : '实景'; put($('b-mode').querySelector('span'), mt); }
    let playIcon = null, trackW = 1, logN = 2; const finEl = $('fin');
    const MARKS = [['地下', 0], ['承轨层', K.deckS.start], ['云厅', K.col24S.start], ['拼装', K.asm1.start], ['提升', K.lift1.start], ['屋面', K.clad.start], ['上盖 / 云门', K.tod.start], ['开通', TL.OPEN]];
    function marks() { const tr = $('track'), W = tr.clientWidth; tr.querySelectorAll('.mk,.lab').forEach(e => e.remove());
      const sl = $('slow'); const u0 = TL.t2u(TL.l0), u1 = TL.t2u(TL.l1); sl.style.left = (u0 * 100) + '%'; sl.style.width = ((u1 - u0) * 100) + '%';
      let lastR = -1e9; for (const [n, t] of MARKS) { const u = TL.t2u(t), x = u * W; const mk = document.createElement('i'); mk.className = 'mk'; mk.style.left = (u * 100) + '%'; tr.appendChild(mk);
        const lb = document.createElement('span'); lb.className = 'lab'; lb.textContent = n; tr.appendChild(lb); const w = lb.offsetWidth; let l = Math.max(0, Math.min(W - w, x - w / 2));
        if (l < lastR + 8 || W < 300) { lb.remove(); continue; } lb.style.left = l + 'px'; lastR = l + w; } }

    // ---------------- 状态 ----------------
    let dirty = true, lastShadowT = -1, shadowWant = true, shadowAge = 0; const SP = +(hp.get('sp') || 4), SPL = +(hp.get('spl') || 3);
    const trainZ = 46.5 + 8; S.blend = 0;
    function setT(t, fromU) { t = Math.max(0, Math.min(TL.Tmax, t)); S.st.t = t; S.st.u = fromU != null ? fromU : TL.t2u(t); U.uT.value = Math.min(t, TL.OPEN + 0.001);
      const ps = HZ.pose(t); for (const g of [1, 2, 3, 4]) U.uG.value[g].fromArray(HZ.mat(ps, g)); S.pose = ps;
      const rig = K.rig, sv = t >= rig.start + rig.dur * 0.6 && t < rig.rm.start + rig.rm.dur * 0.3; STR.visible = sv; STR.material.uniforms.uA.value = sv ? 1 : 0;
      U.uLights.value = sm(TL.OPEN - 6, TL.OPEN + 4, t); U.uPV.value = Math.max(0, Math.min(1, (t - K.pv.start) / K.pv.dur));
      const f = sm(TL.OPEN + 1, TL.OPEN + 24, t), tv = t > TL.OPEN + 0.5, tx = tv ? 1500 - (1500 + 60) * (1 - Math.pow(1 - f, 2.2)) : 9000; U.uG.value[5].makeTranslation(tx, tv ? HZ.P.deckTop + 0.48 : -500, trainZ); S.train = [tx, 0, trainZ];
      S.blend = S.st.pref === 'lit' ? 1 : sm(TL.OPEN - 12, TL.OPEN + 3, t) * 0.85;   // 墨线默认：结尾留 15% 墨线（“图纸变成现实”的余韵）
      if (S.st.auto) placeCam(camKey(t));
      shadowWant = shadowWant || Math.abs(t - lastShadowT) > 0.5 || (ps.lifting && Math.abs(t - lastShadowT) > 0.02);
      hud(); dirty = true; sheetsDirty = true; }
    S.set = t => setT(t);

    // ---------------- 交互 ----------------
    for (const el of document.querySelectorAll('.ui')) for (const ev of ['pointerdown', 'wheel', 'touchstart']) el.addEventListener(ev, e => e.stopPropagation(), { passive: true });
    const setPlay = p => { S.st.play = p; if (p && S.st.t >= TL.Tmax - 0.01) setT(0); lastNow = performance.now(); hud(); dirty = true; };
    $('b-play').onclick = () => setPlay(!S.st.play);
    $('b-home').onclick = () => { S.st.auto = true; placeCam(camKey(S.st.t)); ctl.update(); $('b-home').classList.remove('on'); dirty = true; };
    const setMode = m => { S.st.pref = m; setT(S.st.t, S.st.u); shadowWant = true; $('b-mode').classList.toggle('on', m === 'lit'); };
    $('b-mode').onclick = () => setMode(S.st.pref === 'ink' ? 'lit' : 'ink');
    const info = $('info'); const fitInfo = () => { const r = $('bar').getBoundingClientRect(); info.style.bottom = (innerHeight - r.top + 8) + 'px'; }; S.fitInfo = fitInfo;
    const openInfo = o => { S.st.info = o; if (o) fitInfo(); info.style.display = o ? 'flex' : 'none'; $('b-info').classList.toggle('on', o); };
    $('b-info').onclick = () => openInfo(!S.st.info); $('i-x').onclick = () => openInfo(false);
    S.opt = o => { if (o.play != null) setPlay(o.play); if (o.auto != null) { S.st.auto = o.auto; if (o.auto) placeCam(camKey(S.st.t)); } if (o.info != null) openInfo(o.info); if (o.mode) setMode(o.mode); dirty = true; };
    ctl.addEventListener('start', () => { S.st.auto = false; $('b-home').classList.add('on'); });
    ctl.addEventListener('change', () => { dirty = true; });
    { const tr = $('track'); let drag = false; const at = e => { const r = tr.getBoundingClientRect(), u = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); setT(TL.u2t(u), u); };
      tr.addEventListener('pointerdown', e => { drag = true; tr.setPointerCapture(e.pointerId); S.st.play = false; at(e); }); tr.addEventListener('pointermove', e => { if (drag) at(e); }); tr.addEventListener('pointerup', e => { drag = false; try { tr.releasePointerCapture(e.pointerId); } catch (x) { } }); }
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
        ['塔吊回转净空（R9，' + HZ.cranes.length + ' 台 × 72 方位，' + fmt(au.r9.tests) + ' 次）', au.r9.hits], ['履带吊站位与在场构件相交（R10）', HZ.crawlHits]].map(r => row(r[0], r[1])).join('')}</table>
        <p class="${ok ? 'ok' : 'ng'}">${ok ? '全部为 0' : '有问题：' + esc((au.ex || []).concat(au.clipEx || [], au.liftEx || [], au.r9.ex || []).slice(0, 4).join('；'))}（${au.ms} ms，${au.boxes} 个包围盒）</p>
        <p class="sm">R8 推出：${esc(HZ.r8.join('、') || '无')} 必须排在整体提升之后。整体提升高度 D = ${HZ.D.toFixed(1)} m 由“拼装姿态最低下弦 ≥ 楼面 + ${HZ.P.jigMin} m 胎架”算出；旋转 4° 使内边抬升 ${HZ.innerDrop.toFixed(1)} m。R10 吊装分派：构件中心在某台在场塔吊回转半径（56 m）内 → 塔吊（${HZ.lift.tower} 吊），否则派履带吊（${HZ.lift.crawler} 吊，站位按“不与在场构件相交”搜出）。工人数、运输车数、堆场库存为推算示意。</p>`;
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
    const SHEETS = [{ id: 'sh-sec', fn: SH.section, no: 'HZW-A-301' }, { id: 'sh-plan', fn: SH.plan, no: 'HZW-A-101' }, { id: 'sh-lift', fn: SH.lift, no: 'HZW-A-501' }].map(s => Object.assign(s, { el: $(s.id), key: '', drawn: 0, n: 0, scale: '' }));
    let sheetsDirty = true; const DPR = Math.min(2, devicePixelRatio || 1);
    function sheetCtx(s) { return { tb: (w, h, no, name, t) => ({ tb: h < 170 ? 17 : 20, no, name, scale: s.id === 'sh-lift' ? '示意' : (s.scale || '1:—'), rev: evAt(t), date: HZ.dayDate(Math.min(t, TL.OPEN)), chk: AU ? (AU.zero ? '自检 0 ✓' : '自检 ✕') : '自检中', chkOk: AU && AU.zero }), lastVe: s.ve || 1,
      setScale: px => { const mmPerPx = 25.4 / 96, k = 1000 / (px * mmPerPx); s.scale = '1:' + (Math.round(k / 100) * 100).toLocaleString('en-US'); } }; }
    function drawSheet(s, now) { const c = s.el, w = c.clientWidth, h = c.clientHeight; if (w < 20 || h < 20) return; if (c.width !== Math.round(w * DPR) || c.height !== Math.round(h * DPR)) { c.width = Math.round(w * DPR); c.height = Math.round(h * DPR); }
      const g = c.getContext('2d'); g.setTransform(DPR, 0, 0, DPR, 0, 0); g.textAlign = 'left'; const t0 = performance.now(), cx = sheetCtx(s); s.fn(g, w, h, Math.min(S.st.t, TL.OPEN + 0.001), cx); if (cx.ve && cx.ve !== (s.ve || 1)) { s.ve = cx.ve; s.key = ''; sheetsDirty = true; }
      if (S.st.t >= TL.OPEN) { g.save(); g.translate(w - 70, 34); g.rotate(-0.18); g.strokeStyle = '#b3202a'; g.fillStyle = 'rgba(179,32,42,.9)'; g.lineWidth = 2; g.strokeRect(-46, -15, 92, 30); g.font = '700 15px "PingFang SC","Noto Sans CJK SC",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('竣工 · 开通', 0, 1); g.restore(); }
      if (s.scale !== s._sc0) { s._sc0 = s.scale; s.key = ''; sheetsDirty = true; } s.ms = performance.now() - t0; s.n++; S.sheetDraws++; s.drawn = now; }

    // ---------------- 版式 ----------------
    const root = document.documentElement.style;
    function layout() { const W = innerWidth, H = innerHeight, short = H < 640, narrow = W < 1100;
      document.body.classList.toggle('short', short); document.body.classList.toggle('narrow', narrow); document.body.classList.toggle('tiny', H < 600);
      const colW = Math.round(Math.max(300, Math.min(660, W * (narrow ? 0.38 : 0.35)))); root.setProperty('--colW', colW + 'px');
      const col = $('col'); { const colH = Math.max(200, H - (short ? 16 : 20) - ($('bar').getBoundingClientRect().height || 50) - (short ? 8 : 10)), gap = 8;
        let sh = Math.round(Math.max(110, Math.min(colH * 0.34, colW / 2.5))), lh = Math.round(Math.max(96, Math.min(colH * 0.26, colW / 3.3))), ph = colH - sh - lh - 2 * gap;
        const wide2 = ph < Math.min(colW / 1.9, 240); col.classList.toggle('g2', wide2);
        if (wide2) { sh = Math.round(Math.max(110, Math.min(colH * 0.42, colW / 2.6))); col.style.gridTemplateRows = sh + 'px minmax(0,1fr)'; } else col.style.gridTemplateRows = sh + 'px minmax(0,1fr) ' + lh + 'px'; S.colLayout = { colW, colH, sh, lh, wide2 }; }
      calcN = H < 600 ? 3 : H < 720 ? 4 : 5; logN = H < 600 ? 1 : 2;
      const r = v3.getBoundingClientRect(); const w = Math.max(10, r.width), h = Math.max(10, r.height);
      renderer.setPixelRatio(Math.max(1, Math.min(devicePixelRatio || 1, QS[FX.q].pr, Math.sqrt(PIX / (w * h))))); renderer.setSize(w, h, false); cam.aspect = w / h;
      aspK = Math.max(1, Math.pow(1.6 / cam.aspect, 0.75));
      const top = Math.max($('ttl').getBoundingClientRect().bottom, $('nums').getBoundingClientRect().bottom) - r.top, bot = r.bottom - Math.min($('calc').getBoundingClientRect().top, $('cap').getBoundingClientRect().top);
      cam.setViewOffset(w, h, 0, (bot - top) * 0.35, w, h); cam.updateProjectionMatrix();
      trackW = $('track').clientWidth || 1; marks(); if (S.fitInfo) S.fitInfo(); if (S.st.auto) placeCam(camKey(S.st.t)); hud(); dirty = true; sheetsDirty = true; for (const s of SHEETS) s.key = ''; }
    addEventListener('resize', layout);
    const PIX = +(hp.get('pix') || 5.0e6);

    // ---------------- 渲染 ----------------
    const paperQuad = (() => { const m = new THREE.ShaderMaterial({ uniforms: { uA: { value: 0 }, uPaper: U.uPaper }, transparent: true, depthTest: false, depthWrite: false, vertexShader: 'void main(){ gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }', fragmentShader: 'uniform float uA; uniform vec3 uPaper; void main(){ gl_FragColor = vec4(uPaper, uA); }' });
      const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m); q.frustumCulled = false; const sc = new THREE.Scene(); sc.add(q); return { sc, m }; })();
    const LITONLY = [LOOK.sky, MTN, ground, CTX.city, sun, hemi], INKONLY = [CTX.lines];
    const postOpts = () => { const Pp = Object.assign({}, T.post); return Object.assign(Pp, { sd: sunDir, sunC: T.sun, interior: false, exp: Pp.exp * look.exp, sat: Pp.sat * look.sat, warm: Pp.warm.map(v => 1 + (v - 1) * look.warm), ao: true, vol: 0, dust: 0, fogA: 0.00012, fogH: 140, mistA: 0, god: Pp.god * 0.7, bloom: Pp.bloom * 1.1 }); };
    let lastNow = performance.now();
    function renderInk(la) { for (const o of LITONLY) o.visible = false; for (const o of INKONLY) o.visible = true; MESH.material = inkMat; DYN.mesh.material = DYN.mesh.userData.ink; LINES.visible = true; DYN.lines.visible = true; WK.o.material.color.set(0x1d1a17); STR.material.uniforms.uC.value.set(0xb3202a);
      U.uLA.value = la; renderer.setRenderTarget(null); renderer.setClearColor(0xefe9dd, 1); renderer.toneMapping = THREE.NoToneMapping; renderer.render(scene, cam); }
    function renderLit() { for (const o of LITONLY) o.visible = true; for (const o of INKONLY) o.visible = false; MESH.material = MESH.userData.lit; DYN.mesh.material = DYN.mesh.userData.lit; LINES.visible = false; DYN.lines.visible = false; WK.o.material.color.set(0xffe2b8); STR.material.uniforms.uC.value.set(0x0f0d0d);
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.setClearColor(0x000000, 1);
      shadowAge++; if (shadowWant && (!S.st.play || shadowAge >= (S.pose && S.pose.lifting ? SPL : SP))) { renderer.shadowMap.needsUpdate = true; shadowWant = false; shadowAge = 0; lastShadowT = S.st.t; }
      if (POST.level > 0) POST.render(scene, cam, postOpts()); else { renderer.setRenderTarget(null); renderer.render(scene, cam); } }
    function frame(now) { requestAnimationFrame(frame); const dt = Math.min(0.1, (now - lastNow) / 1000); lastNow = now;
      if (S.st.play) { const u = Math.min(1, S.st.u + dt / TL.playSec); setT(TL.u2t(u), u); if (u >= 1) { S.st.play = false; hud(); } }
      if (ctl.update()) dirty = true;
      // 图纸：时间变了才重画；每帧最多一张（错开），播放中每张 ≤ 20 Hz
      if (sheetsDirty) { const k = S.st.t.toFixed(3) + (AU ? 'a' : ''); let any = false; const ord = SHEETS.slice().sort((a, b) => a.drawn - b.drawn); let drew = false;
        for (const s of ord) { if (s.key === k) continue; any = true; if ((!drew || !S.st.play) && (!S.st.play || now - s.drawn > 50)) { s.key = k; drawSheet(s, now); drew = true; } } if (!any) sheetsDirty = false; }
      if (!dirty && !hp.has('always')) return; dirty = false;
      rebuildDyn(S.st.t); U.uCam.value.copy(cam.position);
      renderer.info.reset(); const b = S.blend; document.body.classList.toggle('lit', b > 0.5);
      if (b <= 0.001) renderInk(1);
      else { renderLit(); if (b < 0.999) { renderer.autoClear = false; paperQuad.m.uniforms.uA.value = Math.max(0, (0.85 - b) / 0.85) * 0.9; renderer.render(paperQuad.sc, cam);
          const vis = scene.children.map(o => o.visible); for (const o of scene.children) o.visible = (o === LINES || o === CTX.lines || o === DYN.lines || o === MESH); MESH.material = inkMat; inkMat.colorWrite = false; renderer.clearDepth(); U.uLA.value = Math.max(0.15, 1 - b); renderer.toneMapping = THREE.NoToneMapping; renderer.render(scene, cam); scene.children.forEach((o, i) => o.visible = vis[i]); inkMat.colorWrite = true; MESH.material = MESH.userData.lit; renderer.autoClear = true; } }
      S.frames++; S.calls = renderer.info.render.calls; lead(); }
    // ---------------- 3D 引线标注：旋转提升时标转轴，其余时刻标当前工作面 ----------------
    const LEAD = $('lead'), MC = document.createElement('canvas').getContext('2d'), v3v = new THREE.Vector3(); let leadKey = '';
    function lead() { const t = S.st.t, r = v3.getBoundingClientRect(), W = r.width, H = r.height; let anchor = null, t1 = '', t2 = '';
      for (const [zone, zA, key, nm] of [[1, P.roofB, 'lift1', '南区'], [3, -P.roofB, 'lift3', '北区']]) { const A = K[key]; if (t >= A.start - 1 && t < A.end + 1) { anchor = [0, P.roofLo + S.pose[zone].dy, zA]; t1 = '转轴 · ' + nm + '外缘（东西向）'; t2 = '已转 ' + (4 * S.pose[zone].r).toFixed(1) + '° / 4° · 内边抬升 ' + (HZ.innerDrop * S.pose[zone].r).toFixed(1) + ' / ' + HZ.innerDrop.toFixed(1) + ' m'; } }
      if (!anchor && t < TL.OPEN) { const c = HZ.caption(t).act; if (c && c.parts.length) { const ps = c.parts.filter(p => p.st <= t).sort((a, b) => b.st - a.st)[0]; if (ps) { anchor = HZ.xf(S.pose, ps.grp || 0, [ps.c[0], ps.top, ps.c[2]]); t1 = c.name; t2 = (QTY(c) || '') + (QTY(c) ? ' · ' : '') + HZ.dayDate(c.start) + ' → ' + HZ.dayDate(c.end); } } }
      if (!anchor) { if (LEAD.innerHTML) LEAD.innerHTML = ''; S.leadPlaced = false; return; }
      v3v.set(anchor[0], anchor[1], anchor[2]).project(cam); const x = (v3v.x + 1) / 2 * W, y = (1 - v3v.y) / 2 * H; const key = [x | 0, y | 0, t1, t2, W | 0, H | 0].join('|'); if (key === leadKey) return; leadKey = key;
      LEAD.setAttribute('width', W); LEAD.setAttribute('height', H);
      if (v3v.z > 1 || x < 6 || y < 6 || x > W - 6 || y > H - 6) { LEAD.innerHTML = ''; S.leadPlaced = false; return; }
      MC.font = '700 13px ' + getComputedStyle(document.body).getPropertyValue('--serif'); const w1 = MC.measureText(t1).width; MC.font = '11px ' + getComputedStyle(document.body).getPropertyValue('--mono'); const w = Math.ceil(Math.max(w1, MC.measureText(t2).width)) + 6, h = 34, m = 6;
      const obs = [...document.querySelectorAll('#ttl,#nums .num,#calc,#cap')].map(e => { const q = e.getBoundingClientRect(); return { l: q.left - r.left - m, r: q.right - r.left + m, t: q.top - r.top - m, b: q.bottom - r.top + m }; });
      const free = (lx, ly) => lx >= 8 && ly >= 8 && lx + w <= W - 8 && ly + h <= H - 8 && obs.every(o => lx + w < o.l || lx > o.r || ly + h < o.t || ly > o.b) && !(x >= lx - 6 && x <= lx + w + 6 && y >= ly - 6 && y <= ly + h + 6);
      const Cc = [[x + 50, y - 80], [x - 50 - w, y - 80], [x + 60, y - 130], [x - 60 - w, y - 130], [x + 70, y + 30], [x - 70 - w, y + 30], [x + 90, y - 30], [x - 90 - w, y - 30]]; let pos = null; for (const [lx, ly] of Cc) if (free(lx, ly)) { pos = [lx, ly]; break; }
      let o = `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="#b3202a" stroke-width="1.3"/><circle cx="${x}" cy="${y}" r="1.6" fill="#b3202a"/>`;
      if (pos) { const [lx, ly] = pos, ux = lx + w / 2 < x ? lx + w : lx, yb = ly + 20; const esc = q => q.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
        o += `<polyline points="${x},${y} ${ux},${yb} ${ux === lx ? lx + w : lx},${yb}" fill="none" stroke="#b3202a" stroke-width=".9"/><text class="lt" x="${lx + 3}" y="${ly + 14}" font-size="13" font-weight="700">${esc(t1)}</text><text class="ls" x="${lx + 3}" y="${ly + 32}" font-size="11">${esc(t2)}</text>`; }
      LEAD.innerHTML = o; S.leadPlaced = !!pos; S.leadText = t1; }
    applyLook(); layout();
    { STR.visible = true; renderer.compile(scene, cam); MESH.material = inkMat; renderer.compile(scene, cam); MESH.material = MESH.userData.lit; STR.visible = false; }
    // 预热：实景 / 墨线两条管线在“施工中（塔吊、履带吊、运输车、钢绞线在场）”与“竣工”各画一帧，着色器与阴影深度材质在加载时编译（Mac 实测：首次在施工中切实景卡 2.6 s）
    if (!hp.has('nowarm')) { const pref = S.st.pref; for (const [tw, m] of [[K.lift1.start + 1, 'lit'], [K.asm1.start + 10, 'lit'], [TL.Tmax, 'lit'], [K.lift1.start + 1, 'ink']]) { S.st.pref = m; setT(tw); dynKey = ''; rebuildDyn(tw); STR.visible = true; shadowWant = true; if (m === 'lit') renderLit(); else renderInk(1); } S.st.pref = 'lit'; S.st.auto = false; setT(TL.Tmax); for (const az of [0, 45, 90, 135, 180, 225, 270, 315, look.sunAz - 180]) { placeCam({ az, el: az === look.sunAz - 180 ? 3 : 9, d: 900, tx: 0, ty: 30, tz: 0 }); cam.lookAt(0, 30, 0); cam.updateMatrixWorld(); shadowWant = true; renderLit(); } S.st.auto = true;   // 正对太阳：光束（god rays）后处理第一次启用时也会现场编译（Mac 实测转向太阳卡 2.2 s）
      S.st.pref = pref; renderer.getContext().finish(); }
    const t0 = hp.has('t') ? +hp.get('t') : K.lift1.start + K.lift1.dur * 0.7; setT(t0); S.st.play = hp.get('play') !== '0'; if (S.st.pref === 'lit') $('b-mode').classList.add('on'); hud(); ctl.update();
    requestAnimationFrame(frame);
    Object.assign(S, { calcText, cumOf, evAt, v3, applyLook, cam, ctl, render: () => { dirty = true; }, TL, loadMs: Math.round(performance.now() - T0), SHEETS, layout });
    S.ready = true; document.body.classList.add('ready');
  }
  main().catch(e => { console.error(e); const el = $('cap'); if (el) el.textContent = '加载失败：' + e.message; });
})();
