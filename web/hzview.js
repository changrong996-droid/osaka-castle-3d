'use strict';
// ===== 杭州西站 建造过程 · 一屏小样（hzwest-preview1）：3D 主视图 + 一条时间轴 + 一行字幕 + 3 个数 =====
// 观感层复用 fx.js（时段 / 环境图 / 画质判断）与 look.js（天空、远山、HDR 后处理：泛光 + 调色 + ACES/AgX），
// 顺序来自 hzseq.js（规则 → web/core/seq.js 推依赖 / 排程）；所有构件并进 1 个网格，着色器按时间游标 uT 显示 未建 / 在建（升起 + 发光）/ 已建 / 拆除，
// 屋盖三区 + 嵌补随 uG[] 矩阵（旋转提升 / 整体提升）移动。
(function () {
  const THREE_BASE = 'https://unpkg.com/three@0.160.0/';
  const $ = id => document.getElementById(id), hp = new URLSearchParams(location.hash.slice(1));
  const HZ = window.HZ, SEQ = window.SEQ, S = window.__pv = { ready: false, frames: 0, calls: 0, auditDone: false, st: { t: 0, u: 0, play: false, auto: true, info: false } };
  const ICON = { play: 'M3 1.5v11l9.5-5.5z', pause: 'M2.5 1.5h3.2v11H2.5zM8.3 1.5h3.2v11H8.3z', home: 'M7 1.2 1 6.3h1.8V12.8h3.4V9h1.6v3.8h3.4V6.3H13z', info: 'M7 .8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 7 .8zm.9 9.9H6.1V5.9h1.8zM7 4.9a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2z', x: 'M2.6 1.2 7 5.6l4.4-4.4 1.4 1.4L8.4 7l4.4 4.4-1.4 1.4L7 8.4l-4.4 4.4-1.4-1.4L5.6 7 1.2 2.6z' };
  const icon = k => `<svg class="i" viewBox="0 0 14 14" aria-hidden="true"><path d="${ICON[k]}"/></svg>`;

  // ---------------- 时间：工程日 t ∈ [0, OPEN] + 尾声（首趟列车）；时间轴 u 按“节奏权重”映射，提升阶段放慢 ----------------
  let TL = null;
  function timeline() {
    const K = HZ.K, OPEN = HZ.P.OPEN, FIN = 30, Tmax = OPEN + FIN, N = Tmax * 4;
    const l0 = K.lift1.start - 2, l1 = K.head.end + 2, a0 = K.jig1.start, a1 = K.lift1.start;
    const w = t => { let v = 1; if (t >= l0 && t <= l1) v = 14; else if (t > a0 && t < a1) v = 2.2; else if (t > OPEN) v = 2.2; else if (t < 300) v = 0.55; return v; };
    const cum = new Float64Array(N + 1); for (let i = 1; i <= N; i++) cum[i] = cum[i - 1] + w((i - 0.5) / 4) / 4;
    const L = cum[N]; for (let i = 0; i <= N; i++) cum[i] /= L;
    const t2u = t => { const x = Math.max(0, Math.min(N, t * 4)), i = Math.min(N - 1, Math.floor(x)); return cum[i] + (cum[i + 1] - cum[i]) * (x - i); };
    const u2t = u => { u = Math.max(0, Math.min(1, u)); let lo = 0, hi = N; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= u) lo = m; else hi = m; } const f = (u - cum[lo]) / Math.max(1e-12, cum[hi] - cum[lo]); return (lo + f) / 4; };
    return { Tmax, OPEN, t2u, u2t, l0, l1, playSec: 64 };
  }

  // ---------------- 主程序 ----------------
  async function main() {
    const im = document.createElement('script'); im.type = 'importmap';
    const loc = hp.get('three') === 'local';   // 本地测试：用仓库里的 vendor/（同一版本 r160）
    im.textContent = JSON.stringify({ imports: loc ? { three: new URL('vendor/three.module.js', document.baseURI).href } : { three: THREE_BASE + 'build/three.module.js', 'three/addons/': THREE_BASE + 'examples/jsm/' } });
    document.head.appendChild(im);
    const [THREE, { OrbitControls }] = await Promise.all([import('three'), import(loc ? new URL('vendor/OrbitControls.js', document.baseURI).href : 'three/addons/controls/OrbitControls.js')]);
    run(THREE, OrbitControls);
  }

  function run(THREE, OrbitControls) {
    const T0 = performance.now();
    HZ.make(); TL = timeline(); S.Tmax = TL.Tmax; S.OPEN = TL.OPEN; S.HZ = HZ;
    const canvas = $('gl');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: hp.get('shot') === '1' });
    renderer.info.autoReset = false;
    const FX = window.CASTLE_FX.make(THREE), qArg = hp.has('q') ? +hp.get('q') : -1, QD = FX.detect(renderer, qArg); FX.q = QD.q; S.q = QD.q; S.gpu = QD.gpu || '';
    try { const g = renderer.getContext(), e = g.getExtension('WEBGL_debug_renderer_info'); S.gpu = e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); } catch (e) { }
    const QS = [{ pr: 1, sm: 2048 }, { pr: 1.5, sm: 2048 }, { pr: 2, sm: 4096 }];
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, QS[FX.q].pr));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.8;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(28, 1, 4, 40000);
    const view = $('view');
    const ctl = new OrbitControls(cam, view); ctl.enableDamping = true; ctl.dampingFactor = 0.08; ctl.maxPolarAngle = Math.PI * 0.49; ctl.minDistance = 90; ctl.maxDistance = 4200; ctl.screenSpacePanning = false; ctl.zoomSpeed = 0.8;

    // ---- 光 / 天空（黄金时刻，太阳在西南偏西）----
    const T = Object.assign({}, FX.TOD.g), LOOK = window.CASTLE_LOOK.make(THREE);
    const look = { sunAz: +(hp.get('saz') || 232), sunEl: +(hp.get('sel') || 6), exp: +(hp.get('exp') || 1.1), sat: +(hp.get('sat') || 1), warm: +(hp.get('warm') || 1) };
    S.look = look;
    const sunDir = new THREE.Vector3(), sun = new THREE.DirectionalLight(0xfff0dc, T.I), hemi = new THREE.HemisphereLight(0xc9d8f0, 0x6a5c4a, 1.05);
    sun.castShadow = true; sun.shadow.mapSize.set(QS[FX.q].sm, QS[FX.q].sm); Object.assign(sun.shadow.camera, { left: -520, right: 520, top: 420, bottom: -420, near: 50, far: 4000 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.9;
    scene.add(sun, sun.target, hemi); scene.add(LOOK.sky); const MTN = LOOK.mountains(3); MTN.scale.set(0.5, 0.32, 0.5);   // 杭州西北的低山：压低、拉远 scene.add(MTN);
    const POST = LOOK.post(renderer); POST.level = FX.q;
    function applyLook() {
      const az = THREE.MathUtils.degToRad(look.sunAz), el = THREE.MathUtils.degToRad(look.sunEl);
      sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
      sun.color.setRGB(T.sun[0], T.sun[1], T.sun[2]); sun.intensity = T.I * 1.05; sun.position.copy(sunDir).multiplyScalar(2000); sun.target.position.set(0, 0, 20);
      LOOK.setSky(T, sunDir, FX.q); MTN.material.uniforms.near.value.fromArray(T.mtn[0]); MTN.material.uniforms.far.value.fromArray(T.mtn[1]);
      FX.setEnv(FX.env(renderer, 'ext', T, sunDir)); for (const m of envMats) { m.envMap = FX.envTex; m.needsUpdate = true; }
      renderer.shadowMap.needsUpdate = true; dirty = true; }
    const envMats = [];

    // ---- 构件网格（1 次绘制）----
    const U = { uT: { value: 0 }, uG: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Matrix4()) }, uGlowDays: { value: 8 }, uGlowCol: { value: new THREE.Vector3(1.0, 0.58, 0.26).multiplyScalar(0.6) }, uLights: { value: 0 }, uPV: { value: 0 }, uLightCol: { value: new THREE.Vector3(1.0, 0.78, 0.5) } };
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
          .replace('#include <color_fragment>', '#include <color_fragment>\nfloat hzPV = 0.0; if (vM.w > 0.5 && vM.w < 1.5) { hzPV = hzPVMask(vWq.xz) * step(vWq.z, mix(-170.0, 175.0, uPV)); vec2 sd = abs(fract(vWq.xz / vec2(3.5, 1.75)) - 0.5); float ln = 1.0 - smoothstep(0.0, fwidth(vWq.x / 3.5) * 1.5, 0.5 - sd.x); diffuseColor.rgb *= 1.0 - 0.06 * ln; vec2 pc = abs(fract(vWq.xz / vec2(2.0, 1.0)) - 0.5); float pl = max(1.0 - smoothstep(0.0, fwidth(vWq.x / 2.0) * 1.2, 0.5 - pc.x), 1.0 - smoothstep(0.0, fwidth(vWq.z) * 1.2, 0.5 - pc.y)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.20, 0.38) * (1.0 - 0.35 * pl) + vec3(0.10) * pl, hzPV); }\nif (vM.w > 1.5) { vec2 gc = abs(fract(vWq.xz / vec2(2.4, 2.4)) - 0.5); float gl = max(1.0 - smoothstep(0.0, fwidth(vWq.x / 2.4) * 1.3, 0.5 - gc.x), 1.0 - smoothstep(0.0, fwidth(vWq.z / 2.4) * 1.3, 0.5 - gc.y)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75), gl * 0.6); }')
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(vM.x, 0.22, hzPV);').replace('#include <metalnessmap_fragment>', 'float metalnessFactor = mix(vM.y, 0.55, hzPV);')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlowCol * vGlow * (0.35 + 0.65 * vGlow) + diffuseColor.rgb * uLightCol * vM.z * uLights;'); };
      mat.customProgramCacheKey = () => 'hz-std'; return mat; }
    function patchDepth(mat) { mat.onBeforeCompile = sh => { Object.assign(sh.uniforms, U); sh.vertexShader = VDEF + sh.vertexShader.replace('#include <begin_vertex>', 'hzCalc();\nvec3 transformed = hzP;'); }; mat.customProgramCacheKey = () => 'hz-depth'; return mat; }

    function compile() {
      const items = []; for (const a of HZ.acts) { if (a.kind === 'untemp' || !a.parts.length) continue;
        const ord = a.parts.map((p, i) => [p.sweep || 0, i]).sort((x, y) => x[0] - y[0] || x[1] - y[1]), n = a.parts.length, wf = Math.min(1, Math.max(0.12, 2.5 / n));
        ord.forEach(([, i], rk) => { const p = a.parts[i], f = n > 1 ? rk / (n - 1) : 0; const st = a.start + a.dur * f * (1 - wf), du = Math.max(0.6, a.dur * wf);
          let rm = [-1, 0]; if (a.rm) { const rs = a.rm.start + a.rm.dur * f * (1 - wf), rd = Math.max(0.5, a.rm.dur * wf); rm = [rs, rd]; }
          items.push({ p, st, du, rm }); }); }
      items.push({ p: { geo: trainGeo, mat: 'train', grp: 5 }, st: -20, du: 0.01, rm: [-1, 0] });
      let nv = 0; for (const it of items) nv += it.p.geo.P.length / 3;
      const Pp = new Float32Array(nv * 3), N = new Float32Array(nv * 3), C = new Float32Array(nv * 3), K = new Float32Array(nv * 4), R = new Float32Array(nv * 2), Y = new Float32Array(nv * 2), Gp = new Float32Array(nv), M = new Float32Array(nv * 4);
      const col = new THREE.Color(); let iv = 0;
      for (const it of items) { const g = it.p.geo, mt = HZ.MAT[it.p.mat], y0 = g.min[1], y1 = g.max[1];
        for (let i = 0; i < g.P.length / 3; i++, iv++) { for (let k = 0; k < 3; k++) { Pp[iv * 3 + k] = g.P[i * 3 + k]; N[iv * 3 + k] = g.N[i * 3 + k]; }
          col.setRGB(g.C[i * 3], g.C[i * 3 + 1], g.C[i * 3 + 2], THREE.SRGBColorSpace); C[iv * 3] = col.r; C[iv * 3 + 1] = col.g; C[iv * 3 + 2] = col.b;
          K[iv * 4] = it.st; K[iv * 4 + 1] = it.du; R[iv * 2] = it.rm[0]; R[iv * 2 + 1] = it.rm[1]; Y[iv * 2] = y0; Y[iv * 2 + 1] = y1; Gp[iv] = it.p.grp || 0; M[iv * 4] = mt.r; M[iv * 4 + 1] = mt.m; M[iv * 4 + 2] = mt.e || 0; M[iv * 4 + 3] = mt.k || 0; } }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(Pp, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3)); geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
      geo.setAttribute('aK', new THREE.BufferAttribute(K, 4)); geo.setAttribute('aR', new THREE.BufferAttribute(R, 2)); geo.setAttribute('aY', new THREE.BufferAttribute(Y, 2)); geo.setAttribute('aG', new THREE.BufferAttribute(Gp, 1)); geo.setAttribute('aM', new THREE.BufferAttribute(M, 4));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 30, 0), 1500);
      const mat = patchStd(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.9 })); envMats.push(mat);
      const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
      mesh.customDepthMaterial = patchDepth(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide }));
      S.tris = nv / 3; return mesh; }
    // 首趟列车并进主网格（第 5 组，靠 uG[5] 平移）：不再单独一个材质 → 第一次进画面时不会现场编译着色器（Mac 实测曾卡 7 s）
    const trainGeo = (() => { const g = new HZ.GB('train'), cars = 8, L = 25.5; for (let k = 0; k < cars; k++) { const x0 = k * (L + 0.8); g.box(x0, 0.6, -1.6, x0 + L, 4.1, 1.6, HZ.MAT.train.c, false); g.box(x0, 1.9, -1.62, x0 + L, 2.25, 1.62, [0.85, 0.15, 0.12], false); g.box(x0 + 0.5, 2.6, -1.63, x0 + L - 0.5, 3.3, 1.63, [0.12, 0.14, 0.18], false); }
      g.hexa([[-12, 0.6, -1.6], [0, 0.6, -1.6], [0, 0.6, 1.6], [-12, 0.6, 1.6], [-12, 1.2, -0.6], [0, 4.1, -1.6], [0, 4.1, 1.6], [-12, 1.2, 0.6]], HZ.MAT.train.c, false); return g; })();
    const MESH = compile(); scene.add(MESH);

    // ---- 钢绞线（提升期间）----
    const STR = (() => { const L = HZ.K.rig.strands, P = new Float32Array(L.length * 6), G = new Float32Array(L.length * 2); L.forEach((s, i) => { P.set(s.a, i * 6); P.set(s.b, i * 6 + 3); G[i * 2] = 0; G[i * 2 + 1] = s.gb; });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('aG', new THREE.BufferAttribute(G, 1));
      const m = new THREE.ShaderMaterial({ uniforms: { uG: U.uG, uA: { value: 0 } }, transparent: true, depthWrite: false,
        vertexShader: 'attribute float aG; uniform mat4 uG[6]; void main() { vec4 p = uG[int(aG + 0.5)] * vec4(position, 1.0); gl_Position = projectionMatrix * viewMatrix * p; }',
        fragmentShader: 'uniform float uA; void main() { gl_FragColor = vec4(0.06, 0.05, 0.05, 0.85 * uA); }' });
      const o = new THREE.LineSegments(g, m); o.frustumCulled = false; o.visible = false; return o; })(); scene.add(STR);

    // ---- 地面（工地 → 广场 / 绿化；云谷地铁层开口）+ 城市街区（规则生成）----
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
    { // 城市街区：1.1–3.6 km，避开铁路走廊与站区；合并为 1 个网格
      const r = SEQ.rng(20220922), pos = [], nor = [], colA = [], box = (x0, y0, z0, x1, y1, z1, c) => { const g = new HZ.GB('conc'); g.box(x0, y0, z0, x1, y1, z1, null, false); for (let i = 0; i < g.P.length; i++) { pos.push(g.P[i]); nor.push(g.N[i]); } for (let i = 0; i < g.P.length / 3; i++) colA.push(c[0], c[1], c[2]); };
      for (let i = 0; i < 2600; i++) { const a = r() * Math.PI * 2, d = 1500 + Math.pow(r(), 0.8) * 3800, x = Math.cos(a) * d * 1.15, z = Math.sin(a) * d; if (Math.abs(z) < 120 && Math.abs(x) < 4000) continue; if (Math.abs(x) < 750 && Math.abs(z) < 420) continue;
        const w = 16 + r() * 34, l = 16 + r() * 40, tall = r() < 0.07, h = tall ? 50 + r() * 90 : 8 + r() * 18, v = 0.62 + r() * 0.22, c = tall ? [v * 0.85, v * 0.9, v * 0.95] : [v, v * 0.97, v * 0.9]; box(x - w / 2, 0, z - l / 2, x + w / 2, h, z + l / 2, c); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); const cc = new THREE.Color(); for (let i = 0; i < colA.length; i += 3) { cc.setRGB(colA[i], colA[i + 1], colA[i + 2], THREE.SRGBColorSpace); colA[i] = cc.r; colA[i + 1] = cc.g; colA[i + 2] = cc.b; } g.setAttribute('color', new THREE.Float32BufferAttribute(colA, 3));
      const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }); const city = new THREE.Mesh(g, m); city.receiveShadow = true; scene.add(city); }
    // ---- 首趟列车 ----
    const TRAIN = { visible: false, position: new THREE.Vector3(5000, 0, 0) };
    const trainZ = 46.5 + 8;

    // ---- 相机：自动取景（随阶段缓动）/ 用户拖动后手动 ----
    const K = HZ.K, sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const CAM = {
      hero: { az: +(hp.get('caz') || -25), el: +(hp.get('cel') || 11), d: +(hp.get('cd') || 690), tx: 0, ty: 26, tz: 14 },   // 自北北西：云门在站房背后当“门”，黄金时刻侧光（变体扫描选出，见 work/hzwest/COMPUTE_NOTE.md）
      early: { az: 84, el: 21, d: 760, tx: -30, ty: 6, tz: 0 },                 // 自东北：顺着云谷（两场之间 28 m）看进去
      lift: { az: 76, el: 6.5, d: 600, tx: 0, ty: 36, tz: 0 },                   // 自东：屋盖三区绕东西向轴转动，侧面看得出“折页”
      fin: { az: -20, el: 10, d: 700, tx: -10, ty: 26, tz: 18 } };
    function camKey(t) { const a = sm(380, 560, t), b = sm(TL.l0 - 25, TL.l0 + 2, t) * (1 - sm(TL.l1, TL.l1 + 40, t)), c = sm(TL.OPEN - 60, TL.OPEN + 10, t);
      const mix = (p, q, k) => { const o = {}; for (const key in p) o[key] = p[key] + (q[key] - p[key]) * k; return o; };
      let k = mix(CAM.early, CAM.hero, a); k = mix(k, CAM.lift, b); k = mix(k, CAM.fin, c);
      k.az += 6 * Math.sin(t / 140); if (S.camOv) Object.assign(k, S.camOv); return k; }
    if (hp.has('cam')) { const v = hp.get('cam').split(',').map(Number); S.camOv = { az: v[0], el: v[1], d: v[2] }; if (v.length > 3) Object.assign(S.camOv, { tx: v[3], ty: v[4], tz: v[5] }); }
    function placeCam(k) { const az = THREE.MathUtils.degToRad(k.az), el = THREE.MathUtils.degToRad(k.el); ctl.target.set(k.tx, k.ty, k.tz); cam.position.set(k.tx + Math.sin(az) * Math.cos(el) * k.d, k.ty + Math.sin(el) * k.d, k.tz - Math.cos(az) * Math.cos(el) * k.d); }
    // 方位角 az 自北顺时针；北 = −z，东 = +x → 相机在 (sin az, ·, −cos az)·d 方向
    S.camKey = camKey;

    // ---- 状态更新 ----
    const roofApex = () => { if (S.st.t < K.asm2.start + 1) return null; const ps = HZ.pose(S.st.t); return HZ.Ht(0, 0) + ps[2].dy; };
    let steelTot = 0; for (const a of HZ.acts) if (a.tally && a.tally.steel) steelTot += a.tally.steel; S.steelTot = steelTot;
    const steelAt = t => { let s = 0; for (const a of HZ.acts) if (a.tally && a.tally.steel) s += a.tally.steel * Math.max(0, Math.min(1, (t - a.start) / a.dur)); return s; };
    S.roofApex = roofApex; S.steelAt = steelAt;
    let dirty = true, lastShadowT = -1, shadowWant = true, shadowAge = 0; const SP = +(hp.get('sp') || 4), SPL = +(hp.get('spl') || 3);
    function setT(t, fromU) { t = Math.max(0, Math.min(TL.Tmax, t)); S.st.t = t; S.st.u = fromU != null ? fromU : TL.t2u(t); U.uT.value = Math.min(t, TL.OPEN + 0.001);
      const ps = HZ.pose(t); for (const g of [1, 2, 3, 4]) U.uG.value[g].fromArray(HZ.mat(ps, g)); S.pose = ps;
      const rig = K.rig, sv = t >= rig.start + rig.dur * 0.6 && t < rig.rm.start + rig.rm.dur * 0.3; STR.visible = sv; STR.material.uniforms.uA.value = sv ? 1 : 0;
      U.uLights.value = sm(TL.OPEN - 8, TL.OPEN + 6, t); U.uPV.value = Math.max(0, Math.min(1, (t - K.pv.start) / K.pv.dur));
      const f = sm(TL.OPEN + 1, TL.OPEN + 26, t); TRAIN.visible = t > TL.OPEN + 0.5; TRAIN.position.set(TRAIN.visible ? 1500 - (1500 + 60) * (1 - Math.pow(1 - f, 2.2)) : 9000, TRAIN.visible ? HZ.P.deckTop + 0.48 : -500, trainZ); U.uG.value[5].makeTranslation(TRAIN.position.x, TRAIN.position.y, TRAIN.position.z); S.train = TRAIN.position.toArray();
      if (S.st.auto) placeCam(camKey(t));
      shadowWant = shadowWant || Math.abs(t - lastShadowT) > 0.5 || (ps.lifting && Math.abs(t - lastShadowT) > 0.02);
      hud(); dirty = true; }
    S.set = t => setT(t);

    // ---- HUD ----
    const elDay = $('n-day'), elDate = $('n-date'), elH = $('n-h'), elS = $('n-s'), elCap = $('cap'), knob = $('knob'), fill = $('fill');
    // 只在文字真的变了时写 DOM（播放时每帧都写会触发毛玻璃面板重绘）；游标用 transform（不触发布局）
    const put = (el, v) => { if (el._v !== v) { el._v = v; el.textContent = v; } };
    function hud() { const t = S.st.t, d = Math.min(TL.OPEN, Math.floor(t)); put(elDay, String(d)); put(elDate, HZ.dayDate(d));
      const h = roofApex(); put(elH, h == null ? '—' : h.toFixed(1)); put(elS, Math.round(steelAt(Math.min(t, TL.OPEN))).toLocaleString('en-US'));
      const c = HZ.caption(Math.min(t, TL.OPEN)); put(elCap, c.text); S.cap = c.text;
      const tw = trackW; knob.style.transform = 'translateX(' + (S.st.u * tw).toFixed(1) + 'px)'; fill.style.transform = 'scaleX(' + S.st.u.toFixed(5) + ')'; if (playIcon !== S.st.play) { playIcon = S.st.play; $('b-play').innerHTML = icon(S.st.play ? 'pause' : 'play'); $('b-play').setAttribute('aria-label', S.st.play ? '暂停' : '播放'); } }
    let playIcon = null, trackW = 1;
    // 时间轴刻度：阶段起点（放得下才写字）+ 慢放段
    const MARKS = [['地下', 0], ['承轨层', K.deckS.start], ['云厅', K.col24S.start], ['屋盖拼装', K.asm1.start], ['提升', K.lift1.start], ['屋面', K.clad.start], ['上盖 / 云门', K.tod.start], ['开通', TL.OPEN]];
    function marks() { const tr = $('track'), W = tr.clientWidth; tr.querySelectorAll('.mk,.lab').forEach(e => e.remove());
      const sl = $('slow'); const u0 = TL.t2u(TL.l0), u1 = TL.t2u(TL.l1); sl.style.left = (u0 * 100) + '%'; sl.style.width = ((u1 - u0) * 100) + '%';
      let lastR = -1e9; for (const [n, t] of MARKS) { const u = TL.t2u(t), x = u * W; const mk = document.createElement('i'); mk.className = 'mk'; mk.style.left = (u * 100) + '%'; tr.appendChild(mk);
        const lb = document.createElement('span'); lb.className = 'lab'; lb.textContent = n; tr.appendChild(lb); const w = lb.offsetWidth; let l = Math.max(0, Math.min(W - w, x - w / 2));
        if (l < lastR + 8 || W < 380) { lb.remove(); continue; } lb.style.left = l + 'px'; lastR = l + w; } }

    // ---- 交互 ----
    for (const el of document.querySelectorAll('.ui')) for (const ev of ['pointerdown', 'wheel', 'touchstart']) el.addEventListener(ev, e => e.stopPropagation(), { passive: true });
    const setPlay = p => { S.st.play = p; if (p && S.st.t >= TL.Tmax - 0.01) setT(0); lastNow = performance.now(); hud(); dirty = true; };
    $('b-play').onclick = () => setPlay(!S.st.play);
    $('b-home').onclick = () => { S.st.auto = true; placeCam(camKey(S.st.t)); ctl.update(); $('b-home').classList.remove('on'); dirty = true; };
    S.home = () => $('b-home').onclick();
    const info = $('info'); const fitInfo = () => { info.style.bottom = (innerHeight - $('bar').getBoundingClientRect().top + 10) + 'px'; }; S.fitInfo = fitInfo;
    const openInfo = o => { S.st.info = o; if (o) fitInfo(); info.style.display = o ? 'flex' : 'none'; $('b-info').classList.toggle('on', o); };
    $('b-info').onclick = () => openInfo(!S.st.info); $('i-x').onclick = () => openInfo(false);
    S.opt = o => { if (o.play != null) setPlay(o.play); if (o.auto != null) { S.st.auto = o.auto; if (o.auto) placeCam(camKey(S.st.t)); } if (o.info != null) openInfo(o.info); dirty = true; };
    ctl.addEventListener('start', () => { S.st.auto = false; $('b-home').classList.add('on'); });
    ctl.addEventListener('change', () => { dirty = true; });
    { const tr = $('track'); let drag = false; const at = e => { const r = tr.getBoundingClientRect(), u = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); setT(TL.u2t(u), u); };
      tr.addEventListener('pointerdown', e => { drag = true; tr.setPointerCapture(e.pointerId); S.st.play = false; at(e); }); tr.addEventListener('pointermove', e => { if (drag) at(e); }); tr.addEventListener('pointerup', e => { drag = false; try { tr.releasePointerCapture(e.pointerId); } catch (x) { } }); }
    addEventListener('keydown', e => { if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); setPlay(!S.st.play); } else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') { e.preventDefault(); S.st.play = false; const du = (e.shiftKey ? 0.05 : 0.01) * (e.code === 'ArrowRight' ? 1 : -1), u = Math.max(0, Math.min(1, S.st.u + du)); setT(TL.u2t(u), u); }
      else if (e.code === 'Escape') openInfo(false); else if (e.key === 'i') openInfo(!S.st.info); });

    // ---- 次要信息（一个小按钮后面）----
    function fillInfo(au) { const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const row = (a, b) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`;
      const net = au && au.net, ok = au && au.zero;
      const audit = !au ? '<p class="wait">自检运行中…</p>' : `<table>${[
        ['无支承（含分区胎架 / 提升点包住重心）', au.unsupported], ['穿模（同时在场的构件两两相交）', au.clip], ['提升净空（' + au.liftSamples + ' 个时刻，杆件 × 在场构件）', au.liftClash],
        ['依赖违例 / 成环', net.prec + ' / ' + net.cyclic], ['临时构件：违例 / 竣工残留', au.temp.violations + ' / ' + au.temp.leftover], ['资源超限（R5）', net.r5.over], ['提升扫掠与前置构件冲突（R8）', au.r8bad.length]].map(r => row(r[0], r[1])).join('')}</table>
        <p class="${ok ? 'ok' : 'ng'}">${ok ? '全部为 0' : '有问题：' + esc((au.ex || []).concat(au.clipEx || [], au.liftEx || []).slice(0, 4).join('；'))}（${au.ms} ms，${au.boxes} 个包围盒）</p>
        <p class="sm">R8 推出：${esc(HZ.r8.join('、') || '无')} 必须排在整体提升之后（拼装姿态的屋盖会挡住它）。整体提升高度 D = ${HZ.D.toFixed(1)} m 由“拼装姿态最低下弦 ≥ 楼面 + ${HZ.P.jigMin} m 胎架”算出；旋转 4° 使内边抬升 ${HZ.innerDrop.toFixed(1)} m。</p>`;
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
    const doneAudit = au => { S.auditRes = au; S.auditDone = true; fillInfo(au); };
    if (!hp.has('noaudit')) setTimeout(() => auditWorker().then(doneAudit).catch(() => setTimeout(() => doneAudit(HZ.audit()), 50)), 400);

    // ---- 布局 / 渲染 ----
    // 像素预算：高画质最多 ~5.0 MP 的内部分辨率（1920×1080@2 → 像素比 1.55），后处理（SSAO / 雾 / 泛光）按像素计价
    const PIX = +(hp.get('pix') || 5.0e6);
    function resize() { const w = innerWidth, h = innerHeight; renderer.setPixelRatio(Math.max(1, Math.min(devicePixelRatio || 1, QS[FX.q].pr, Math.sqrt(PIX / (w * h))))); renderer.setSize(w, h, false); cam.aspect = w / h;
      // 取景：画面中心略上移，给底栏留空
      const bar = $('bar').getBoundingClientRect().height, top = $('hud').getBoundingClientRect().height; cam.setViewOffset(w, h, 0, (bar - top * 0.4) * 0.45, w, h); cam.updateProjectionMatrix();
      document.body.classList.toggle('short', h < 640); document.body.classList.toggle('narrow', w < 1100); trackW = $('track').clientWidth || 1; marks(); if (S.fitInfo) S.fitInfo(); hud(); dirty = true; }
    addEventListener('resize', resize);
    const postOpts = () => { const Pp = Object.assign({}, T.post); return Object.assign(Pp, { sd: sunDir, sunC: T.sun, interior: false, exp: Pp.exp * look.exp, sat: Pp.sat * look.sat, warm: Pp.warm.map((v, i) => 1 + (v - 1) * look.warm), ao: true, vol: 0, dust: 0, fogA: 0.00012, fogH: 140, mistA: 0, god: Pp.god * 0.7, bloom: Pp.bloom * 1.1 }); };
    let lastNow = performance.now();
    function frame(now) { requestAnimationFrame(frame); const dt = Math.min(0.1, (now - lastNow) / 1000); lastNow = now;
      const pa = performance.now(); if (S.st.play) { const u = Math.min(1, S.st.u + dt / TL.playSec); setT(TL.u2t(u), u); if (u >= 1) { S.st.play = false; hud(); } } const pb = performance.now();
      if (ctl.update()) dirty = true;
      if (!dirty && !hp.has('always')) return; dirty = false;
      // 阴影图：播放中最多每 3 帧重画一次（提升时每 2 帧），静止时立刻重画
      shadowAge++; if (shadowWant && (!S.st.play || shadowAge >= (S.pose && S.pose.lifting ? SPL : SP))) { renderer.shadowMap.needsUpdate = true; shadowWant = false; shadowAge = 0; lastShadowT = S.st.t; }
      renderer.info.reset();
      if (POST.level > 0) POST.render(scene, cam, postOpts()); else { renderer.setRenderTarget(null); renderer.render(scene, cam); }
      if (PROF) { renderer.getContext().finish(); const pc = performance.now(); PROF.set += pb - pa; PROF.render += pc - pb; PROF.n++; PROF.shadow += renderer.shadowMap.needsUpdate ? 0 : 0; }
      S.frames++; S.calls = renderer.info.render.calls; }
    const PROF = hp.has('prof') ? (S.prof = { set: 0, render: 0, n: 0, shadow: 0 }) : null;
    applyLook(); resize();
    // 预编译：钢绞线、列车第一次出现时编译着色器会卡 1–3 s（Mac 实测：首趟列车段 7 fps）→ 加载时先全部可见编译一遍（含阴影深度材质）
    { STR.visible = true; renderer.compile(scene, cam); STR.visible = false; }
    const t0 = hp.has('t') ? +hp.get('t') : TL.OPEN + 30; setT(t0); S.st.play = hp.get('play') === '1' ; hud(); ctl.update();
    requestAnimationFrame(frame);
    S.applyLook = applyLook; S.cam = cam; S.ctl = ctl; S.render = () => { dirty = true; }; S.TL = TL; S.loadMs = Math.round(performance.now() - T0);
    if (hp.has('nohud')) document.body.classList.add('nohud');
    S.ready = true; document.body.classList.add('ready');
  }
  main().catch(e => { console.error(e); const el = $('cap'); if (el) el.textContent = '加载失败：' + e.message; });
})();
