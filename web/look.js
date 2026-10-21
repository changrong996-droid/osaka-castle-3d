'use strict';
// web-r15（C1，phase A “第一眼”）：观感层。不改生成/审计/包，只加渲染：
//   · 天空穹顶（大气渐变 + 日轮 + 程序云，云在中/高画质）——所有画质都用，替换 r13 的 Sky addon 外观
//   · 后处理（中 = 泛光 + 调色；高 = + 屏幕空间光束 + 深度雾/空气透视 + 堀上薄雾 + 堀面平面反射）：场景先画进 HalfFloat 缓冲（线性 HDR），
//     最后一趟做 雾 → 光束 → 泛光 → 曝光 → AgX/ACES → 调色（暖高光/冷阴影、饱和、暗角）→ sRGB → 抖动；低画质不走后处理（与 r14 同价）
//   · 城下町（规则生成、按种子）：町割街区 + 沿街町家（一/二层、切妻）+ 土蔵 + 寺院大屋根 + 五重塔 + 运河/大川 + 舟；
//     碰撞：町家按柱体进相机的“町屋顶面”（canopy，保守）→ 相机球不会钻进房子（物理规则不放松）
//   · 远山（11–17 km 剪影环）、花瓣（高画质，动画）
(function (G) {
  const H2 = (a, b) => { let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1); h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12; return ((h >>> 0) % 100000) / 100000; };
  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  const NOISE = `
float lkH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float lkN(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f); return mix(mix(lkH(i), lkH(i + vec2(1.0, 0.0)), u.x), mix(lkH(i + vec2(0.0, 1.0)), lkH(i + vec2(1.0, 1.0)), u.x), u.y); }
float lkF(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * lkN(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.7; a *= 0.5; } return s / 0.97; }
`;
  // AgX（Troy Sobotka；three r160 同式）+ “punchy” look；ACES（Hill）备用
  const TONE = `
vec3 agxC(vec3 x) { vec3 x2 = x * x, x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
vec3 lkAgX(vec3 c) {
  const mat3 I = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 O = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const mat3 S2R = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956)), R2S = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
  c = I * (S2R * c); c = clamp((log2(max(c, 1e-10)) + 12.47393) / 16.5, 0.0, 1.0); c = agxC(c);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = l + 1.25 * (c - l); c = pow(max(c, 0.0), vec3(1.12));   // punchy：饱和 + 对比
  c = O * c; c = pow(max(vec3(0.0), c), vec3(2.2)); return R2S * c; }
vec3 lkACES(vec3 c) { c *= 1.0 / 0.6; const mat3 A = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777)), B = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c = A * c; c = (c * (c + 0.0245786) - 0.000090537) / (c * (0.983729 * c + 0.4329510) + 0.238081); return clamp(B * c, 0.0, 1.0); }
vec3 lkSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
`;
  function make(THREE) {
    const L = { THREE };
    const FSQ = 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    const tri = new THREE.BufferGeometry(); tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const fsScene = new THREE.Scene(), fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), fsMesh = new THREE.Mesh(tri); fsMesh.frustumCulled = false; fsScene.add(fsMesh);
    const pass = (renderer, mat, rt) => { fsMesh.material = mat; renderer.setRenderTarget(rt); renderer.render(fsScene, fsCam); };

    // ---------------- 天空穹顶 ----------------
    const skyU = { sd: { value: new THREE.Vector3(0, 0.1, -1) }, zen: { value: new THREE.Vector3() }, hor: { value: new THREE.Vector3() }, sunC: { value: new THREE.Vector3(1, 0.7, 0.4) }, disc: { value: 40 }, cloud: { value: 0.5 }, cTint: { value: new THREE.Vector3(1, 0.8, 0.6) }, gnd: { value: new THREE.Vector3(0.1, 0.09, 0.08) } };
    L.skyMat = new THREE.ShaderMaterial({ uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false, defines: { LK_CLOUD: 1 },
      vertexShader: 'varying vec3 vD; void main() { vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
      fragmentShader: NOISE + `varying vec3 vD; uniform vec3 sd, zen, hor, sunC, cTint, gnd; uniform float disc, cloud;

        void main() { vec3 d = normalize(vD); float y = d.y, mu = max(dot(d, sd), 0.0);
          float hy = max(y, 0.0); vec3 c = mix(hor, zen, 1.0 - exp(-hy * 13.0));
          c += sunC * (pow(mu, 6.0) * 0.3 + pow(mu, 40.0) * 1.2) * (0.4 + 0.6 * smoothstep(-0.05, 0.25, sd.y + 0.1 - hy * 0.3));   // 日周光晕（Mie）
          c += hor * 0.25 * exp(-hy * 25.0);                                                                                      // 地平白化
#if LK_CLOUD > 0
          if (y > 0.0) { vec2 p = d.xz / (y + 0.06) * 0.9 + vec2(13.0, 7.0); float n = lkF(p * 0.55), n2 = lkF(p * 2.1 + 5.0);
            float cov = smoothstep(0.5 - cloud * 0.25, 0.85, n * 0.8 + n2 * 0.28) * smoothstep(0.0, 0.12, y) * (1.0 - 0.55 * smoothstep(0.25, 0.8, y));   // r16：天顶少云（蓝天露出来）
            float th = smoothstep(0.35, 0.95, n2);  // 厚度：薄边透光 → 金边
            // r16：云体 = 冷灰蓝（天光），云底/云边 = 低太阳照亮的暖金（离太阳越近、越靠地平越暖）；不再把暖色与天顶蓝相加（r15 整片云发紫）
            float low = 1.0 - smoothstep(0.04, 0.45, y), wk = (0.25 + 0.75 * pow(mu, 3.0)) * (0.35 + 0.65 * low);
            vec3 body = mix(zen * 2.0 + vec3(0.07, 0.07, 0.08), hor * 0.7, 0.3) * (0.7 + 0.45 * n);
            vec3 lit = sunC * cTint * (0.5 + 3.2 * pow(mu, 8.0)) * wk;
            float under = (1.0 - th) * 0.7 + 0.3 * smoothstep(0.55, 0.9, n);   // 薄处/边缘 + 云底
            vec3 cc = body + lit * under; c = mix(c, cc, cov * 0.92); }
#endif
          if (y < 0.0) c = mix(hor * 0.7, gnd, smoothstep(0.0, 0.08, -y));
          float sdisc = smoothstep(0.99991, 0.99995, dot(d, sd)); c += sunC * disc * sdisc;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    L.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), L.skyMat); L.sky.scale.setScalar(26000); L.sky.frustumCulled = false; L.sky.renderOrder = -10; L.sky.name = 'sky';
    L.setSky = (T, sd, q) => { skyU.sd.value.copy(sd); skyU.zen.value.fromArray(T.skyZ); skyU.hor.value.fromArray(T.skyH); skyU.sunC.value.fromArray(T.sun); skyU.disc.value = T.disc || 30; skyU.cloud.value = T.cloud || 0.5; skyU.cTint.value.fromArray(T.cTint || [1, 0.85, 0.7]); skyU.gnd.value.fromArray(T.gnd);
      const want = q > 0 ? 1 : 0; if (L.skyMat.defines.LK_CLOUD !== want) { L.skyMat.defines.LK_CLOUD = want; L.skyMat.needsUpdate = true; } };

    // ---------------- 远山：11–17 km 剪影环（不受场景雾，自带空气透视色；后处理再按深度加雾）----------------
    L.mountains = (seed) => { const r = rng(9001 + seed * 7), N = 720, rows = 3, pos = [], col = [], idx = [];
      for (let k = 0; k < rows; k++) { const R = 11000 + k * 2600, amp = [420, 650, 900][k], base = -30;
        for (let i = 0; i <= N; i++) { const a = i / N * Math.PI * 2, n = 0.5 * Math.sin(a * 3 + k * 1.7 + 0.3) + 0.3 * Math.sin(a * 7.3 + k) + 0.2 * Math.sin(a * 17.1 + 2 * k) + 0.06 * Math.sin(a * 29 + k * 5), h = Math.max(40, amp * (0.55 + 0.45 * n) * (0.75 + 0.5 * r()));
          const west = Math.max(0, Math.cos(a - Math.PI)); const hh = h * (1 - 0.75 * Math.pow(west, 3));   // 西边（大阪湾方向）低平
          pos.push(Math.cos(a) * R, base, -Math.sin(a) * R, Math.cos(a) * R, hh, -Math.sin(a) * R); const t = k / (rows - 1); col.push(0, 0, t, 1, 0, t); }
        const o = k * (N + 1) * 2; for (let i = 0; i < N; i++) { const a = o + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('lk', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
      const m = new THREE.ShaderMaterial({ uniforms: { near: { value: new THREE.Vector3(0.2, 0.18, 0.2) }, far: { value: new THREE.Vector3(0.6, 0.5, 0.45) } }, fog: false, side: THREE.DoubleSide,
        vertexShader: 'attribute vec3 lk; varying vec3 vK; void main() { vK = lk; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p; }',
        fragmentShader: `varying vec3 vK; uniform vec3 near, far;

          void main() { vec3 c = mix(near, far, 0.35 + 0.55 * vK.z); c = mix(c, far, 0.5 * (1.0 - vK.y)); gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          }` });
      const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.name = 'mountains'; mesh.renderOrder = -5; return mesh; };

    // ---------------- 后处理 ----------------
    const HF = THREE.HalfFloatType;
    const mkRT = (w, h, depth, samples) => { const rt = new THREE.WebGLRenderTarget(w, h, { type: HF, depthBuffer: !!depth, samples: samples || 0 }); if (depth) { rt.depthTexture = new THREE.DepthTexture(w, h); rt.depthTexture.type = THREE.UnsignedIntType; } rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter; rt.texture.generateMipmaps = false; return rt; };
    const brightMat = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, thr: { value: 1.0 }, expo: { value: 1 } }, depthTest: false, depthWrite: false, vertexShader: FSQ,
      fragmentShader: `varying vec2 vUv; uniform sampler2D t; uniform float thr, expo;
        void main() { vec3 c = vec3(0.0); vec2 o = vec2(0.5) / vec2(textureSize(t, 0)); c += texture2D(t, vUv + vec2(-o.x, -o.y)).rgb + texture2D(t, vUv + vec2(o.x, -o.y)).rgb + texture2D(t, vUv + vec2(-o.x, o.y)).rgb + texture2D(t, vUv + o).rgb;
          c *= 0.25 * expo; c = min(c, vec3(60.0)); if (!(c.r + c.g + c.b >= 0.0)) c = vec3(0.0); float l = max(c.r, max(c.g, c.b)); gl_FragColor = vec4(c * max(l - thr, 0.0) / max(l, 1e-4), 1.0); }` });
    const blurMat = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, dir: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false, vertexShader: FSQ,
      fragmentShader: `varying vec2 vUv; uniform sampler2D t; uniform vec2 dir;
        void main() { vec2 o = dir / vec2(textureSize(t, 0)); vec3 c = texture2D(t, vUv).rgb * 0.2270270;
          c += (texture2D(t, vUv + o * 1.3846154).rgb + texture2D(t, vUv - o * 1.3846154).rgb) * 0.3162162; c += (texture2D(t, vUv + o * 3.2307692).rgb + texture2D(t, vUv - o * 3.2307692).rgb) * 0.0702703;
          gl_FragColor = vec4(c, 1.0); }` });
    const copyMat = new THREE.ShaderMaterial({ uniforms: { t: { value: null } }, depthTest: false, depthWrite: false, vertexShader: FSQ, fragmentShader: 'varying vec2 vUv; uniform sampler2D t; void main() { gl_FragColor = vec4(texture2D(t, vUv).rgb, 1.0); }' });
    // 光束遮挡源：天空像素（深度 = 远）× 离太阳近 + （室内）高亮像素；四分之一分辨率
    const occMat = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, dpt: { value: null }, sun: { value: new THREE.Vector2() }, asp: { value: 1 }, intr: { value: 0 } }, depthTest: false, depthWrite: false, vertexShader: FSQ,
      fragmentShader: `varying vec2 vUv; uniform sampler2D t, dpt; uniform vec2 sun; uniform float asp, intr;
        void main() { float d = texture2D(dpt, vUv).x; vec3 c = texture2D(t, vUv).rgb; float l = dot(c, vec3(0.3, 0.6, 0.1));
          vec2 v = (vUv - sun) * vec2(asp, 1.0); float k = exp(-dot(v, v) * 3.5);
          if (!(l >= 0.0)) l = 0.0; float s = d > 0.99999 ? min(l, 6.0) * (0.25 + k) : 0.0; if (intr > 0.5) s = max(s, smoothstep(1.2, 3.0, l) * 1.5);
          gl_FragColor = vec4(vec3(s), 1.0); }` });
    const godMat = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, sun: { value: new THREE.Vector2() }, dens: { value: 0.9 }, decay: { value: 0.965 } }, depthTest: false, depthWrite: false, vertexShader: FSQ,
      fragmentShader: `varying vec2 vUv; uniform sampler2D t; uniform vec2 sun; uniform float dens, decay;
        void main() { vec2 dt = (vUv - sun) * dens / 48.0; vec2 uv = vUv; float il = 1.0, s = 0.0, j = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
          uv -= dt * j; for (int i = 0; i < 48; i++) { uv -= dt; if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) break; s += texture2D(t, uv).r * il; il *= decay; }
          gl_FragColor = vec4(vec3(s / 48.0), 1.0); }` });
    // r16：室内体积光：1/4 分辨率，每像素沿视线 20 步（≤ 14 m）查太阳阴影图（同一张阴影图，室内时已收紧到本栋），抖动起点；之后一次可分离模糊
    const volMat = new THREE.ShaderMaterial({ uniforms: { dpt: { value: null }, pInv: { value: new THREE.Matrix4() }, cW: { value: new THREE.Matrix4() }, cPos: { value: new THREE.Vector3() }, shT: { value: null }, shM: { value: new THREE.Matrix4() }, sd: { value: new THREE.Vector3() }, dens: { value: 0.05 } }, depthTest: false, depthWrite: false, vertexShader: FSQ,
      fragmentShader: THREE.ShaderChunk.packing + `varying vec2 vUv; uniform sampler2D dpt, shT; uniform mat4 pInv, cW, shM; uniform vec3 cPos, sd; uniform float dens;
        float lit(vec3 wp) { vec4 sc = shM * vec4(wp, 1.0); sc.xyz /= sc.w; if (sc.x < 0.0 || sc.y < 0.0 || sc.x > 1.0 || sc.y > 1.0 || sc.z > 1.0) return 0.0; return step(sc.z - 0.002, unpackRGBAToDepth(texture2D(shT, sc.xy))); }
        void main() { float d = texture2D(dpt, vUv).x; vec4 v = pInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); v /= v.w; vec3 wp = (cW * vec4(v.xyz, 1.0)).xyz, rd = wp - cPos; float L = min(length(rd), 14.0); rd = normalize(rd);
          float st = L / 20.0, j = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453), s = 0.0;
          for (int i = 0; i < 20; i++) { vec3 p = cPos + rd * (st * (float(i) + j)); s += lit(p); }
          float mu = dot(rd, sd), ph = 0.35 + 0.65 * pow(max(mu, 0.0), 6.0) * 3.0;   // 前向散射：迎着光柱看更亮
          gl_FragColor = vec4(vec3(s * st * dens * ph), 1.0); }` });
    const compU = { t: { value: null }, dpt: { value: null }, b1: { value: null }, b2: { value: null }, b3: { value: null }, god: { value: null }, useGod: { value: 0 }, useFog: { value: 0 },
      pInv: { value: new THREE.Matrix4() }, cW: { value: new THREE.Matrix4() }, cPos: { value: new THREE.Vector3() }, sd: { value: new THREE.Vector3() }, sunC: { value: new THREE.Vector3() }, fogC: { value: new THREE.Vector3() },
      fogA: { value: 0.0003 }, fogH: { value: 60 }, fog0: { value: 0 }, mistA: { value: 0 }, mistY: { value: 9 }, mistH: { value: 4 }, expo: { value: 1 }, bloomK: { value: 0.12 }, godK: { value: 0.5 }, sat: { value: 1.05 },
      warm: { value: new THREE.Vector3(1.04, 1.0, 0.94) }, cool: { value: new THREE.Vector3(0.95, 0.99, 1.06) }, vig: { value: 0.3 }, con: { value: 0.2 }, tm: { value: 0 }, near: { value: 1 }, far: { value: 30000 }, time: { value: 0 }, lift: { value: 0.0 }, mistC: { value: new THREE.Vector3(0.7, 0.62, 0.52) }, useAO: { value: 0 }, aoK: { value: 0.6 }, aoR: { value: 1.2 }, vol: { value: null }, useVol: { value: 0 }, volK: { value: 1 },
      shT: { value: null }, shM: { value: new THREE.Matrix4() }, dust: { value: 0 }, mistTop: { value: 1e4 } };
    const compMat = new THREE.ShaderMaterial({ uniforms: compU, depthTest: false, depthWrite: false, vertexShader: FSQ,
      fragmentShader: NOISE + TONE + THREE.ShaderChunk.packing + `varying vec2 vUv; uniform sampler2D t, dpt, b1, b2, b3, god, vol, shT; uniform float useGod, useFog, fogA, fogH, fog0, mistA, mistY, mistH, expo, bloomK, godK, sat, vig, con, tm, near, far, time, lift, useAO, aoK, aoR, useVol, volK, dust, mistTop;
        uniform mat4 pInv, cW, shM; uniform vec3 cPos, sd, sunC, fogC, warm, cool, mistC;
        vec3 vpos(vec2 uv) { float d = texture2D(dpt, uv).x; vec4 v = pInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w; }
        float shLit(vec3 wp) { vec4 sc = shM * vec4(wp, 1.0); sc.xyz /= sc.w; if (sc.x < 0.0 || sc.y < 0.0 || sc.x > 1.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0; return step(sc.z - 0.002, unpackRGBAToDepth(texture2D(shT, sc.xy))); }
        float odExp(float a, float H, float y0, float yc, float dy, float dist) { float k = dy * dist / H, e0 = clamp(-(yc - y0) / H, -80.0, 40.0), e1 = clamp(-(yc + dy * dist - y0) / H, -80.0, 40.0); return abs(k) < 1e-3 ? a * dist * exp(e0) * (1.0 - 0.5 * k) : a * dist * (exp(e0) - exp(e1)) / k; }
        void main() { vec3 c = texture2D(t, vUv).rgb; if (!(c.r + c.g + c.b >= 0.0)) c = vec3(0.0); c = min(c, vec3(1e3));
          // r16：廉价 SSAO（高画质）：只用深度，12 个旋转圆盘采样（半径按观察深度换成屏幕尺寸），遮挡 = 采样点比中心更近且在半径内
          if (useAO > 0.5) { float d0 = texture2D(dpt, vUv).x; if (d0 < 0.99999) { vec3 p0 = vpos(vUv); float rz = max(-p0.z, 0.5), rs = aoR / (rz * 2.0 * pInv[1][1]), oc = 0.0;
              float a0 = lkH(gl_FragCoord.xy) * 6.2832; for (int i = 0; i < 12; i++) { float fi = float(i), a = a0 + fi * 2.39996, rr = rs * (0.2 + 0.8 * fract(fi * 0.618 + lkH(gl_FragCoord.yx))); vec2 o = vec2(cos(a), sin(a)) * rr; o.x *= float(textureSize(dpt, 0).y) / float(textureSize(dpt, 0).x);
                vec3 q = vpos(vUv + o); float dz = q.z - p0.z; oc += smoothstep(0.02 + 0.0006 * rz, 0.25, dz) * (1.0 - smoothstep(aoR, aoR * 2.5, dz)); }
              c *= 1.0 - aoK * clamp(oc / 12.0 * 1.6 - 0.15, 0.0, 1.0); } }
          if (useFog > 0.5) { float d = texture2D(dpt, vUv).x; vec4 v = pInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); v /= v.w; vec3 wp = (cW * vec4(v.xyz, 1.0)).xyz, rd = wp - cPos; float dist = length(rd); rd /= max(dist, 1e-4);
            bool sky = d > 0.99999; if (sky) dist = 22000.0;
            float od = odExp(fogA, fogH, fog0, cPos.y, rd.y, dist), odm = 0.0;
            if (mistA > 0.0) { float dm = min(dist, 800.0); vec3 mp = cPos + rd * dm * 0.5; float n = 0.45 + 0.9 * lkN(mp.xz * 0.012 + vec2(time * 0.01, 0.0)) * lkN(mp.xz * 0.05 - 3.0); odm = odExp(mistA * n, mistH, mistY, cPos.y, rd.y, dm); }
            if (sky) { od *= 0.35; odm *= 0.5; }
            float mu = max(dot(rd, sd), 0.0); vec3 ins = fogC + sunC * (pow(mu, 6.0) * 0.6 + pow(mu, 32.0) * 1.2) * 0.4;
            float tr = exp(-od); c = c * tr + ins * (1.0 - tr);
            // r16：堀上薄雾单独着色（暖、贴水面）：远处空气透视之后再叠（薄雾离相机近）
            vec3 mi = mistC * (0.85 + 0.3 * pow(mu, 4.0)) + sunC * pow(mu, 12.0) * 0.25; float tm2 = exp(-odm); c = c * tm2 + mi * (1.0 - tm2); }
          // r16：室内体积光（高画质）：1/4 分辨率沿视线步进、按太阳阴影图判断受光（窓洞里进来的光柱），这里叠加；尘埃 = 光柱里的世界坐标亮点
          if (useVol > 0.5) { c += texture2D(vol, vUv).r * sunC * volK;
            if (dust > 0.0) { float d = texture2D(dpt, vUv).x; vec4 v = pInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); v /= v.w; vec3 wp = (cW * vec4(v.xyz, 1.0)).xyz, rd = normalize(wp - cPos); float dist = length(wp - cPos);
              for (int k = 0; k < 4; k++) { float dk = 1.2 + float(k) * 1.4; if (dk > dist - 0.2) break; vec3 pk = cPos + rd * dk + vec3(0.0, -time * 0.02, 0.0) * dust; vec3 cell = floor(pk / 0.03), f = fract(pk / 0.03) - 0.5;
                float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453); if (h > 0.99) { float r = length(f.xy - vec2(fract(h * 97.0), fract(h * 57.0)) * 0.3 + 0.15); float sp = (1.0 - smoothstep(0.05, 0.14, r)) * shLit(pk);
                  c += sp * sunC * 0.9 * (1.0 - float(k) * 0.18); } } } }
          vec3 bl = texture2D(b1, vUv).rgb * 0.5 + texture2D(b2, vUv).rgb * 0.3 + texture2D(b3, vUv).rgb * 0.35;
          c = c * expo + bl * bloomK;
          if (useGod > 0.5) c += texture2D(god, vUv).r * sunC * godK;
          c += lift;
          c = tm < 0.5 ? lkAgX(c) : lkACES(c);
          c = clamp(c, 0.0, 1.0); c = mix(c, c * c * (3.0 - 2.0 * c), con);   // S 曲线（对比）
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(l), c, sat); c *= mix(cool, warm, smoothstep(0.05, 0.6, l));
          vec2 q = vUv - 0.5; c *= 1.0 - vig * dot(q, q) * 1.6;
          c = lkSRGB(clamp(c, 0.0, 1.0)); c += (lkH(gl_FragCoord.xy + fract(time)) - 0.5) / 255.0;
          gl_FragColor = vec4(c, 1.0); }` });
    // 管线：level 1 = 泛光 + 调色；level 2 = + 光束 + 深度雾/薄雾（反射在 water 材质里，由 app 驱动）
    L.post = (renderer) => {
      const P = { level: 0, rt: null, w: 0, h: 0, b: [], god: null, occ: null, ms: 0 };
      P.resize = () => { const s = renderer.getDrawingBufferSize(new THREE.Vector2()), w = s.x | 0, h = s.y | 0; if (w === P.w && h === P.h && P.rt) return; P.w = w; P.h = h;
        for (const r of [P.rt, P.occ, P.god, P.vol, P.vol2, ...P.b.flat()]) if (r) r.dispose();
        P.rt = mkRT(w, h, true, 0); P.b = [2, 4, 8].map(k => [mkRT(Math.max(1, w / k | 0), Math.max(1, h / k | 0)), mkRT(Math.max(1, w / k | 0), Math.max(1, h / k | 0))]);
        P.occ = mkRT(Math.max(1, w / 4 | 0), Math.max(1, h / 4 | 0)); P.god = mkRT(Math.max(1, w / 4 | 0), Math.max(1, h / 4 | 0)); P.vol = mkRT(Math.max(1, w / 4 | 0), Math.max(1, h / 4 | 0)); P.vol2 = mkRT(Math.max(1, w / 4 | 0), Math.max(1, h / 4 | 0)); };
      P.render = (scene, camera, o) => { const t0 = performance.now(); P.resize();
        renderer.setRenderTarget(P.rt); renderer.render(scene, camera);
        // 泛光：三级（1/2、1/4、1/8），每级 亮部 → 横 → 竖
        brightMat.uniforms.t.value = P.rt.texture; brightMat.uniforms.thr.value = o.thr; brightMat.uniforms.expo.value = o.exp; pass(renderer, brightMat, P.b[0][0]);
        for (let k = 0; k < 3; k++) { if (k) { copyMat.uniforms.t.value = P.b[k - 1][0].texture; pass(renderer, copyMat, P.b[k][0]); }
          blurMat.uniforms.t.value = P.b[k][0].texture; blurMat.uniforms.dir.value.set(1, 0); pass(renderer, blurMat, P.b[k][1]); blurMat.uniforms.t.value = P.b[k][1].texture; blurMat.uniforms.dir.value.set(0, 1); pass(renderer, blurMat, P.b[k][0]); }
        // 光束
        const sv = o.sd.clone().multiplyScalar(20000).add(camera.position).project(camera), front = o.sd.dot(camera.getWorldDirection(new THREE.Vector3())) > 0.05;
        const god = P.level >= 2 && o.god > 0 && front && Math.abs(sv.x) < 2.2 && Math.abs(sv.y) < 2.2;
        if (god) { occMat.uniforms.t.value = P.rt.texture; occMat.uniforms.dpt.value = P.rt.depthTexture; occMat.uniforms.sun.value.set(sv.x * 0.5 + 0.5, sv.y * 0.5 + 0.5); occMat.uniforms.asp.value = P.w / P.h; occMat.uniforms.intr.value = o.interior ? 1 : 0; pass(renderer, occMat, P.occ);
          godMat.uniforms.t.value = P.occ.texture; godMat.uniforms.sun.value.copy(occMat.uniforms.sun.value); pass(renderer, godMat, P.god); }
        const vol = P.level >= 2 && o.interior && o.shT && o.vol > 0; if (vol) { const V = volMat.uniforms; V.dpt.value = P.rt.depthTexture; V.pInv.value.copy(camera.projectionMatrixInverse); V.cW.value.copy(camera.matrixWorld); V.cPos.value.copy(camera.position); V.shT.value = o.shT; V.shM.value.copy(o.shM); V.sd.value.copy(o.sd); V.dens.value = o.vol;
          pass(renderer, volMat, P.vol); blurMat.uniforms.t.value = P.vol.texture; blurMat.uniforms.dir.value.set(1, 0); pass(renderer, blurMat, P.vol2); blurMat.uniforms.t.value = P.vol2.texture; blurMat.uniforms.dir.value.set(0, 1); pass(renderer, blurMat, P.vol); }
        const U = compU; U.t.value = P.rt.texture; U.vol.value = P.vol.texture; U.useVol.value = vol ? 1 : 0; U.volK.value = 1; U.dust.value = vol ? (o.dust || 0) : 0; if (o.shT) { U.shT.value = o.shT; U.shM.value.copy(o.shM); }
        U.useAO.value = P.level >= 2 && o.ao ? 1 : 0; U.aoK.value = o.interior ? 0.55 : 0.5; U.aoR.value = o.interior ? 0.45 : 1.6; if (o.mistC) U.mistC.value.fromArray(o.mistC); else U.mistC.value.fromArray(o.fogC); U.dpt.value = P.rt.depthTexture; U.b1.value = P.b[0][0].texture; U.b2.value = P.b[1][0].texture; U.b3.value = P.b[2][0].texture; U.god.value = P.god.texture; U.useGod.value = god ? 1 : 0;
        U.useFog.value = P.level >= 2 && !o.interior ? 1 : 0; U.pInv.value.copy(camera.projectionMatrixInverse); U.cW.value.copy(camera.matrixWorld); U.cPos.value.copy(camera.position); U.sd.value.copy(o.sd); U.sunC.value.fromArray(o.sunC); U.fogC.value.fromArray(o.fogC);
        U.fogA.value = o.fogA; U.fogH.value = o.fogH; U.fog0.value = o.fog0 || 0; U.mistA.value = o.interior ? 0 : (o.mistA || 0); U.mistY.value = o.mistY || 9; U.mistH.value = o.mistH || 4; U.expo.value = o.exp; U.bloomK.value = o.bloom; U.godK.value = o.god; U.sat.value = o.sat; U.vig.value = o.vig; U.con.value = o.con === undefined ? 0.2 : o.con; U.tm.value = o.tm || 0; U.time.value = (performance.now() / 1000) % 1000; U.lift.value = o.lift || 0;
        U.warm.value.fromArray(o.warm); U.cool.value.fromArray(o.cool); pass(renderer, compMat, null); P.ms = performance.now() - t0; };
      return P; };

    // ---------------- 堀面平面反射（高画质）：镜像相机 + 斜近裁剪面（Lengyel；同 three Reflector），反射纹理按世界坐标投影采样 ----------------
    L.reflector = (renderer) => {
      const R = { rt: null, h: 9, on: false, mat: new THREE.Matrix4(), cam: new THREE.PerspectiveCamera(), w: 0 };
      const U = { reflT: { value: null }, reflM: { value: R.mat }, reflH: { value: -1e4 }, reflOn: { value: 0 } }; R.U = U;
      R.patch = (mat) => { const ob = mat.onBeforeCompile; mat.onBeforeCompile = sh => { ob(sh); Object.assign(sh.uniforms, U);
          sh.fragmentShader = 'uniform sampler2D reflT; uniform mat4 reflM; uniform float reflH, reflOn;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `
          if (reflOn > 0.5 && abs(vWP.y - reflH) < 0.08) { vec3 nW = fxNk > 0.0 ? fxNW : vec3(0.0, 1.0, 0.0); vec4 rc = reflM * vec4(vWP + vec3(nW.x, 0.0, nW.z) * 0.8, 1.0); vec2 ru = rc.xy / rc.w;
            vec3 V = normalize(cameraPosition - vWP); float fr = 0.03 + 0.97 * pow(1.0 - max(dot(V, nW), 0.0), 5.0); fr = clamp(fr * 1.0 + 0.3, 0.0, 0.9);
            vec3 rcol = texture2D(reflT, clamp(ru, 0.001, 0.999)).rgb; outgoingLight = mix(outgoingLight * 0.7, rcol * vec3(0.6, 0.66, 0.58), fr); }   // r16：倒影更深（暗绿水）
          #include <opaque_fragment>`); };
        mat.customProgramCacheKey = (k => () => k + '-refl')(mat.customProgramCacheKey ? mat.customProgramCacheKey() : 'w'); mat.needsUpdate = true; };
      const v = new THREE.Vector3(), tgt = new THREE.Vector3(), lookAt = new THREE.Vector3(), rot = new THREE.Matrix4(), N = new THREE.Vector3(0, 1, 0), plane = new THREE.Plane(), cp = new THREE.Vector4(), q = new THREE.Vector4(), up = new THREE.Vector3();
      R.render = (scene, camera, h, hide, scale) => { const s = renderer.getDrawingBufferSize(new THREE.Vector2()), w = Math.max(1, s.x * scale | 0), hh = Math.max(1, s.y * scale | 0);
        if (!R.rt || R.rt.width !== w || R.rt.height !== hh) { if (R.rt) R.rt.dispose(); R.rt = new THREE.WebGLRenderTarget(w, hh, { type: HF }); R.rt.texture.generateMipmaps = false; }
        const P0 = new THREE.Vector3(camera.position.x, h, camera.position.z); if (camera.position.y <= h + 0.05) { U.reflOn.value = 0; return false; }
        v.copy(P0).sub(camera.position).reflect(N).negate().add(P0); rot.extractRotation(camera.matrixWorld); lookAt.set(0, 0, -1).applyMatrix4(rot).add(camera.position);
        tgt.copy(P0).sub(lookAt).reflect(N).negate().add(P0); const C = R.cam; C.position.copy(v); up.set(0, 1, 0).applyMatrix4(rot).reflect(N); C.up.copy(up); C.lookAt(tgt); C.far = camera.far; C.updateMatrixWorld(); C.projectionMatrix.copy(camera.projectionMatrix);
        R.mat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1); R.mat.multiply(C.projectionMatrix).multiply(C.matrixWorldInverse);
        plane.setFromNormalAndCoplanarPoint(N, P0); plane.applyMatrix4(C.matrixWorldInverse); cp.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant); const e = C.projectionMatrix.elements;
        q.x = (Math.sign(cp.x) + e[8]) / e[0]; q.y = (Math.sign(cp.y) + e[9]) / e[5]; q.z = -1; q.w = (1 + e[10]) / e[14]; cp.multiplyScalar(2 / cp.dot(q)); e[2] = cp.x; e[6] = cp.y; e[10] = cp.z + 1 - 0.003; e[14] = cp.w; C.projectionMatrixInverse.copy(C.projectionMatrix).invert();
        const vis = hide.map(o => o.visible); hide.forEach(o => { o.visible = false; }); U.reflOn.value = 0;
        renderer.setRenderTarget(R.rt); (renderer.renderRaw || renderer.render)(scene, C); renderer.setRenderTarget(null); hide.forEach((o, i) => { o.visible = vis[i]; });
        U.reflT.value = R.rt.texture; U.reflH.value = h; U.reflOn.value = 1; return true; };
      R.off = () => { U.reflOn.value = 0; };
      return R; };

    // ---------------- 花瓣（高画质；动画）----------------
    L.petals = (n) => { const r = rng(4242), p = new Float32Array(n * 3), a = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { p[i * 3] = r() * 2 - 1; p[i * 3 + 1] = r(); p[i * 3 + 2] = r() * 2 - 1; a[i * 4] = r(); a[i * 4 + 1] = r(); a[i * 4 + 2] = r(); a[i * 4 + 3] = r(); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('rnd', new THREE.BufferAttribute(a, 4));
      const U = { time: { value: 0 }, ctr: { value: new THREE.Vector3() }, box: { value: new THREE.Vector3(110, 45, 110) }, sunC: { value: new THREE.Vector3(1, 0.8, 0.6) }, px: { value: 600 } };
      const m = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, fog: false,
        vertexShader: `attribute vec4 rnd; uniform float time, px; uniform vec3 ctr, box; varying float vA; varying vec2 vR;
          void main() { float t = time * (0.25 + 0.2 * rnd.x) + rnd.y * 10.0; vec3 p = position;
            p.y = fract(p.y - t * 0.08); p.x = fract(p.x * 0.5 + 0.5 + t * 0.05 * (0.5 + rnd.z)) * 2.0 - 1.0;
            vec3 w = ctr + (p - vec3(0.0, 0.5, 0.0)) * box; w.x += sin(t * 3.0 + rnd.w * 6.28) * 1.5; w.z += cos(t * 2.3 + rnd.x * 6.28) * 1.5;
            vec4 mv = modelViewMatrix * vec4(w, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(px * 0.16 / -mv.z, 0.0, 10.0);
            vA = smoothstep(0.0, 0.08, p.y) * smoothstep(1.0, 0.85, p.y) * smoothstep(1.2, 2.5, gl_PointSize); vR = vec2(sin(t * 4.0 + rnd.z * 9.0), cos(t * 4.0 + rnd.z * 9.0)); }`,
        fragmentShader: `varying float vA; varying vec2 vR; uniform vec3 sunC;

          void main() { vec2 q = gl_PointCoord - 0.5; q = mat2(vR.x, -vR.y, vR.y, vR.x) * q; q.y *= 2.2; float d = dot(q, q); if (d > 0.25) discard;
            vec3 c = vec3(1.0, 0.72, 0.8) * (0.55 + 0.6 * sunC); gl_FragColor = vec4(c, vA * (1.0 - smoothstep(0.15, 0.25, d)));
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }` });
      const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.name = 'petals'; pts.userData.U = U; return pts; };

    // ---------------- 城下町 ----------------
    // 规则（不写坐标）：町割 = 南北/东西正交街区（60×40 間 ≈ 118×79 m），每个街区沿四边排町家（間口 2.5–4.5 間、奥行 7–10 間），角地 + 裏に土蔵；
    //   一部分街区换成寺院（大屋根 + 塔）；大川（城北东西向、向西入湾）+ 每 3 个街区一条堀川（西侧东西向，船场风）；城郭（外堀外 90 m）以内不建；
    //   远处（> R1）只建屋顶棱柱（低细节）；R2 以外交给地面着色器的“瓦海”。全部按种子确定。
    L.town = (S, opt) => {
      const T0 = performance.now(), seed = opt.seed || 1, r = rng(77 + seed * 131), R1 = opt.R1 || 1900, R2 = opt.R2 || 2600, gs = S.spec.grid, zAt = opt.zAt;
      const keep = (x, y) => { if (x > gs.x0 - 60 && x < gs.x1 + 60 && y > gs.y0 - 60 && y < gs.y1 + 60) return false; if (Math.abs(x) <= 700 && Math.abs(y) <= 700) { const g = S.regionAt(x, y); if (!g || g.name !== 'city') return false; } return true; };
      // 大川：城北 y ≈ gs.y1 + 260 起、向西缓降入湾，宽 110 m；堀川：西侧 y = 常数，每 3 街区一条，宽 14 m
      const riverY = x => gs.y1 + 300 + 70 * Math.sin(x / 900) + (x < -900 ? (x + 900) * -0.05 : 0), RW = 110;
      const BW = 118, BH = 79, ST = 9;   // 街区 + 街路宽
      const houses = [], kura = [], temples = [], pagodas = [], boats = [], canals = [], trees = []; let nBlk = 0;
      const inRiver = (x, y, m) => Math.abs(y - riverY(x)) < RW / 2 + (m || 0);
      const canalRows = new Set(); for (let j = -40; j <= 40; j++) if (((j % 3) + 3) % 3 === 0) canalRows.add(j);
      const isCanal = (j, x) => canalRows.has(j) && x < gs.x0 - 100;
      // 町割の向き：四个方位区各自一个街区网格角度（西 = 船场 0°，南 0°+4°，东 -9°，北 6°）；区界上的空隙 = 大路
      const DIST = [{ a: 0, s: q => q > 2.36 || q < -2.36 }, { a: 0.07, s: q => q >= -2.36 && q < -0.79 }, { a: -0.16, s: q => q >= -0.79 && q < 0.79 }, { a: 0.1, s: q => q >= 0.79 && q <= 2.36 }];
      for (const D of DIST) { const ca = Math.cos(D.a), sa = Math.sin(D.a), toW = (u, v) => [u * ca - v * sa, u * sa + v * ca];
      for (let j = -36; j <= 36; j++) for (let i = -36; i <= 36; i++) {
        const u0 = i * (BW + ST), v0 = j * (BH + ST), C = toW(u0 + BW / 2, v0 + BH / 2), cx = C[0], cy = C[1], d = Math.hypot(cx, cy); if (d > R2 + 100) continue;
        if (!D.s(Math.atan2(cy, cx))) continue; const K4 = [toW(u0, v0), toW(u0 + BW, v0), toW(u0, v0 + BH), toW(u0 + BW, v0 + BH), toW(u0 + BW / 2, v0), toW(u0 + BW / 2, v0 + BH), toW(u0, v0 + BH / 2), toW(u0 + BW, v0 + BH / 2)]; // r16：加边中点（内环町割在内框里，外区斜网格不能伸进去）
        if (!K4.every(k => keep(k[0], k[1])) || !keep(cx, cy)) continue;
        if (inRiver(cx, cy, 70) || K4.some(k => inRiver(k[0], k[1], 10))) continue;
        nBlk++; const far = d > R1, hb = H2(i * 7 + 3, j * 13 + seed + D.a * 1000);
        if (hb < 0.03) { temples.push({ x: cx, y: cy, w: 34 + 10 * H2(i, j), d: 26 + 8 * H2(j, i), a: D.a, far }); if (hb < 0.011) { const P = toW(u0 + 18, v0 + 16); pagodas.push({ x: P[0], y: P[1] }); }
          for (let k = 0; k < 14; k++) { const e = k / 14 * Math.PI * 2, P = toW(u0 + BW / 2 + Math.cos(e) * (BW / 2 - 8), v0 + BH / 2 + Math.sin(e) * (BH / 2 - 8)); trees.push({ x: P[0], y: P[1], r: 3.5 + 2 * r(), h: 9 + 5 * r(), sak: r() < 0.4 }); } continue; } // 寺院街区
        // 沿四边排町家（面向街路，屋脊平行街路）；长边再加一排背向的裏長屋 → 街区不空心
        const sides = [[u0, v0, 1, 0, BW, 0, 0], [u0 + BW, v0 + BH, -1, 0, BW, Math.PI, 0], [u0, v0 + BH, 0, -1, BH, Math.PI / 2, 0], [u0 + BW, v0, 0, 1, BH, -Math.PI / 2, 0], [u0, v0 + 20, 1, 0, BW, 0, 1], [u0 + BW, v0 + BH - 20, -1, 0, BW, Math.PI, 1]];
        for (let si = 0; si < 6; si++) { const [sx, sy, ux, uy, len, ang, back] = sides[si], nx = -uy, ny = ux; let u = si === 2 || si === 3 ? 20 : back ? 22 : 0; const uEnd = si === 2 || si === 3 ? len - 20 : back ? len - 22 : len;
          while (u < uEnd - 4) { const w = (back ? 7 : 5) + 4 * r(); if (u + w > uEnd) break; const dep = back ? 11 + 3 * r() : 13 + 6 * r(), lu = sx + ux * (u + w / 2) + nx * dep / 2, lv = sy + uy * (u + w / 2) + ny * dep / 2, Pw = toW(lu, lv);
            const two = !back && r() < (far ? 0.25 : 0.42); houses.push({ x: Pw[0], y: Pw[1], w: w - 0.25, d: dep, a: ang + D.a + (back ? Math.PI : 0), h: two ? 6.4 : back ? 3.8 : 4.2, t: 0.8 + 0.35 * r(), far }); u += w; } }
        if (!far && r() < 0.45) { const nt = 1 + ((r() * 3) | 0); for (let k = 0; k < nt; k++) { const P = toW(u0 + 20 + r() * (BW - 40), v0 + 36 + r() * (BH - 72)); trees.push({ x: P[0], y: P[1], r: 2.5 + 2 * r(), h: 7 + 4 * r(), sak: r() < 0.35 }); } }
        const nk = 1 + ((r() * 3) | 0); for (let k = 0; k < nk; k++) { const Pk = toW(u0 + 25 + r() * (BW - 50), v0 + 34 + r() * (BH - 68)); kura.push({ x: Pk[0], y: Pk[1], w: 5.5, d: 8, a: D.a + (r() < 0.5 ? 0 : Math.PI / 2), h: 6.5, far }); }
      } }

      // r16：内环（外堀外岸 → 细网格 + 60 m 的空环）也建町家：正交町割（0°），街区 116×76 m、街路 16 m，原点对齐相机 canopy 的 4 m 格 → 街路上至少两列 4 m 格空着（相机可沿街通行）。
      //   每栋按足迹（含出檐 + 2 m）逐点检查：在“城下”区（细网格内 = 城下带格、外 = city 区）、地面平（四角高差 < 0.5 m）、不近水；城门土桥外端 55 m 内与门前大路（沿土桥方向 160 m、宽 24 m）不建。
      if (opt.inner) { const I = opt.inner, bx0 = gs.x0 - 50, bx1 = gs.x1 + 50, by0 = gs.y0 - 50, by1 = gs.y1 + 50, PX = 132, PY = 92, IBW = 116, IBH = 76;
        const okPt = (x, y) => { if (x < bx0 || x > bx1 || y < by0 || y > by1) return false; if (!I.city(x, y)) return false; for (const g of I.gates) { const dx = x - g.x, dy = y - g.y, a = dx * g.ux + dy * g.uy, b = Math.abs(dx * g.uy - dy * g.ux); if (Math.hypot(dx, dy) < 55 || (a > -10 && a < 160 && b < 12)) return false; } return true; };
        const okFoot = (x, y, w, d, a, m) => { const ca = Math.cos(a), sa = Math.sin(a), z0 = zAt(x, y); if (I.wet(x, y)) return false;
          for (const [p, q] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]]) { const lx = p * (w / 2 + m), ly = q * (d / 2 + m), X = x + lx * ca - ly * sa, Y = y + lx * sa + ly * ca; if (!okPt(X, Y) || Math.abs(zAt(X, Y) - z0) > 0.5 || I.wet(X, Y)) return false; } return true; };
        const i0 = Math.floor(bx0 / PX) - 1, i1 = Math.ceil(bx1 / PX), j0 = Math.floor(by0 / PY) - 1, j1 = Math.ceil(by1 / PY); let nIn = 0;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const u0 = i * PX, v0 = j * PY, C = [u0 + IBW / 2, v0 + IBH / 2]; let any = false;
          for (const [a, b] of [[u0, v0], [u0 + IBW, v0], [u0, v0 + IBH], [u0 + IBW, v0 + IBH], C]) if (okPt(a, b)) { any = true; break; } if (!any) continue; nBlk++;
          const sides = [[u0, v0, 1, 0, IBW, 0, 0], [u0 + IBW, v0 + IBH, -1, 0, IBW, Math.PI, 0], [u0, v0 + IBH, 0, -1, IBH, Math.PI / 2, 0], [u0 + IBW, v0, 0, 1, IBH, -Math.PI / 2, 0], [u0, v0 + 20, 1, 0, IBW, 0, 1], [u0 + IBW, v0 + IBH - 20, -1, 0, IBW, Math.PI, 1]];
          for (let si = 0; si < 6; si++) { const [sx, sy, ux, uy, len, ang, back] = sides[si], nx = -uy, ny = ux; let u = si === 2 || si === 3 ? 20 : back ? 22 : 0; const uEnd = si === 2 || si === 3 ? len - 20 : back ? len - 22 : len;
            while (u < uEnd - 4) { const w = (back ? 7 : 5) + 4 * r(); if (u + w > uEnd) break; const dep = back ? 11 + 3 * r() : 13 + 6 * r(), x = sx + ux * (u + w / 2) + nx * dep / 2, y = sy + uy * (u + w / 2) + ny * dep / 2, two = !back && r() < 0.45, a2 = ang + (back ? Math.PI : 0);
              if (okFoot(x, y, w, dep, a2, 2)) { houses.push({ x, y, w: w - 0.25, d: dep, a: a2, h: two ? 6.4 : back ? 3.8 : 4.2, t: 0.8 + 0.35 * r(), far: false, inner: true, fx: sx + ux * (u + w / 2), fy: sy + uy * (u + w / 2), nx, ny, back }); nIn++; } u += w; } }
          const nk = 1 + ((r() * 2) | 0); for (let k = 0; k < nk; k++) { const x = u0 + 25 + r() * (IBW - 50), y = v0 + 34 + r() * (IBH - 68); if (okFoot(x, y, 5.5, 8, 0, 2)) kura.push({ x, y, w: 5.5, d: 8, a: r() < 0.5 ? 0 : Math.PI / 2, h: 6.5, far: false }); }
          if (r() < 0.5) { const x = u0 + 30 + r() * (IBW - 60), y = v0 + 36 + r() * (IBH - 72), tr = 2.5 + 2 * r(); if (okFoot(x, y, tr * 2, tr * 2, 0, 1)) trees.push({ x, y, r: tr, h: 7 + 4 * r(), sak: r() < 0.45 }); } }
        I.n = nIn; }
      // 堀川：在选中的街路行上（街区之间的街路换成 14 m 水道），舟
      for (const j of canalRows) { const y = j * (BH + ST) - ST / 2; canals.push({ y, x0: -R2 - 200, x1: gs.x0 - 160 }); }
      for (let k = 0; k < 360; k++) { const x = -R2 + r() * (R2 * 2), y = riverY(x) + (r() - 0.5) * RW * 0.75; if (Math.hypot(x, y) < R2 && keep(x, y)) boats.push({ x, y, a: (r() - 0.5) * 0.3 + (r() < 0.5 ? Math.PI : 0), s: 1 + r(), roof: r() < 0.3 }); } // r16：舟 140 → 360（约三成屋形船）
      for (const c of canals) for (let k = 0; k < 22; k++) { const x = c.x0 + 300 + r() * (c.x1 - c.x0 - 300); if (Math.hypot(x, c.y) < R2 && keep(x, c.y)) boats.push({ x, y: c.y + (r() - 0.5) * 6, a: r() < 0.5 ? 0 : Math.PI, s: 0.8, roof: false }); }
      // 町家不建在水道上
      const wet = (x, y) => inRiver(x, y, 6) || canals.some(c => x > c.x0 && x < c.x1 && Math.abs(y - c.y) < 12);
      const H = houses.filter(h => !wet(h.x, h.y)), K = kura.filter(h => !wet(h.x, h.y));
      // ---- 几何：一栋 = 墙体盒（白/木色顶点色）+ 切妻屋根（出檐），合并成一个几何；实例化 ----
      function houseGeo(eave, wallC, low) { const pos = [], col = [], ix = [];
        const v = (x, y, z, c) => { pos.push(x, z, -y); col.push(...c); return pos.length / 3 - 1; };
        const quad = (a, b, c2, d, cc) => { const i0 = v(...a, cc), i1 = v(...b, cc), i2 = v(...c2, cc), i3 = v(...d, cc); ix.push(i0, i1, i2, i0, i2, i3); };
        const roof = [0.17, 0.17, 0.18];
        if (!low) { const W = 0.5, D = 0.5; // 单位盒：x ∈ ±W（間口），y ∈ ±D（奥行），z ∈ 0..1（墙高，实例缩放）
          quad([-W, -D, 0], [W, -D, 0], [W, -D, 1], [-W, -D, 1], wallC.f); quad([W, D, 0], [-W, D, 0], [-W, D, 1], [W, D, 1], wallC.f);
          quad([W, -D, 0], [W, D, 0], [W, D, 1], [W, -D, 1], wallC.s); quad([-W, D, 0], [-W, -D, 0], [-W, -D, 1], [-W, D, 1], wallC.s); }
        // 屋根：屋脊沿 x（平行街路），两坡朝 ±y；高度 1..1+rh（rh 由实例 z 缩放分摊：屋根部分用 z∈[1, 1.45]）
        const e = eave, Rz = 1.42; quad([-0.5 - e, -0.5 - e, 1.0], [0.5 + e, -0.5 - e, 1.0], [0.5 + e, 0, Rz], [-0.5 - e, 0, Rz], roof); quad([0.5 + e, 0.5 + e, 1.0], [-0.5 - e, 0.5 + e, 1.0], [-0.5 - e, 0, Rz], [0.5 + e, 0, Rz], roof);
        { const g1 = v(0.5, -0.5, 1, wallC.s), g2 = v(0.5, 0.5, 1, wallC.s), g3 = v(0.5, 0, Rz - 0.02, wallC.s); ix.push(g1, g2, g3); const h1 = v(-0.5, 0.5, 1, wallC.s), h2 = v(-0.5, -0.5, 1, wallC.s), h3 = v(-0.5, 0, Rz - 0.02, wallC.s); ix.push(h1, h2, h3); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(ix); g.computeVertexNormals(); return g; }
      const mat = opt.roofMat; const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), cl = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
      const grp = new THREE.Group(); grp.name = 'town';
      // 分块（600 m）：每块一个 InstancedMesh → 视锥剔除按块生效；userData.cb = 块内实例的包围盒（世界 x,y），低画质按相机距离隐藏
      const CH = 600, chunked = (list, geo, mtl, setFn) => { if (!list.length) return []; const by = new Map(); for (const h of list) { const k = Math.floor(h.x / CH) + ',' + Math.floor(h.y / CH); let L = by.get(k); if (!L) by.set(k, L = []); L.push(h); }
        const out = []; for (const L of by.values()) { const im = new THREE.InstancedMesh(geo, mtl, L.length); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
          L.forEach((h, k) => { setFn(h, k, im); if (h.x < x0) x0 = h.x; if (h.x > x1) x1 = h.x; if (h.y < y0) y0 = h.y; if (h.y > y1) y1 = h.y; });
          im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); im.userData.cb = [x0 - 25, y0 - 25, x1 + 25, y1 + 25]; grp.add(im); out.push(im); } return out; };
      const inst = (list, geo, colFn, zScale) => chunked(list, geo, mat, (h, k, im) => { const z = zAt(h.x, h.y) - 0.3; qt.setFromAxisAngle(up, h.a); sc.set(h.w, (h.h + 0.3) * zScale, h.d); ps.set(h.x, z, -h.y); m4.compose(ps, qt, sc); im.setMatrixAt(k, m4); colFn(h, cl); im.setColorAt(k, cl); });
      const wallM = { f: [0.42, 0.34, 0.26], s: [0.62, 0.58, 0.52] }, wallK = { f: [0.86, 0.84, 0.8], s: [0.86, 0.84, 0.8] };
      const Hn = H.filter(h => !h.far), Hf = H.filter(h => h.far), Kn = K.filter(h => !h.far);
      const tint = (h, c) => c.setRGB(h.t, h.t * 0.98, h.t * 0.95);
      // r16：真 LOD：近带町家每个 600 m 块有两套实例（全：墙 + 屋根；简：只有屋根棱柱），app 的 townQ 按相机到块的距离二选一；出檐 0.12 → 0.06（≈1 m，町家的庇）
      const EH = 0.06, gFull = houseGeo(EH, wallM, false), gLow = houseGeo(EH, wallM, true);
      for (const f of inst(Hn, gFull, tint, 1)) f.userData.lod = 'full'; for (const f of inst(Hn, gLow, tint, 1)) f.userData.lod = 'low'; for (const f of inst(Hf, gLow, tint, 1)) f.userData.far = true;
      for (const f of inst(Kn, houseGeo(0.08, wallK, false), (h, c) => c.setRGB(1, 1, 1), 1)) f.userData.lod = 'full';
      // 寺院：大屋根（入母屋近似 = 切妻 + 大出檐），高 14 m
      temples.forEach(t => { t.h = 9; }); inst(temples, houseGeo(0.16, { f: [0.38, 0.27, 0.18], s: [0.5, 0.4, 0.3] }, false), (h, c) => c.setRGB(1, 1, 1), 1);
      // 五重塔：5 层叠盒 + 屋根片（实例化一个合并几何）
      if (pagodas.length) { const pos = [], ix = [], col = []; const add = (g, y0) => { const p = g.attributes.position.array, o = pos.length / 3; for (let k = 0; k < p.length; k += 3) { pos.push(p[k], p[k + 1] + y0, p[k + 2]); col.push(0.2, 0.18, 0.17); } for (const q of g.index.array) ix.push(q + o); };
        for (let k = 0; k < 5; k++) { const s = 1 - k * 0.1; add(new THREE.BoxGeometry(6.5 * s, 4.2, 6.5 * s).translate(0, 2.1, 0), k * 5.4); add(new THREE.CylinderGeometry(4.2 * s, 7.6 * s, 1.3, 4, 1).rotateY(Math.PI / 4).translate(0, 4.6, 0), k * 5.4); }
        add(new THREE.CylinderGeometry(0.25, 0.25, 9, 6).translate(0, 4.5, 0), 27);
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(ix); g.computeVertexNormals();
        const im = new THREE.InstancedMesh(g, mat, pagodas.length); pagodas.forEach((p, k) => { m4.compose(ps.set(p.x, zAt(p.x, p.y) - 0.2, -p.y), qt.identity(), sc.set(1, 1, 1)); im.setMatrixAt(k, m4); p.h = 36; p.w = p.d = 12; p.a = 0; }); grp.add(im); }
      // 町中の木（寺院の境内 + 中庭）：冠のみ（遠景），桜 ≈ 35–40 %
      if (trees.length && opt.crownMat) { const g = new THREE.IcosahedronGeometry(1, 1); let kk = 0;
        chunked(trees, g, opt.crownMat, (t, k, im) => { m4.compose(ps.set(t.x, zAt(t.x, t.y) + t.h - t.r * 0.8, -t.y), qt.identity(), sc.set(t.r, t.r * 0.85, t.r)); im.setMatrixAt(k, m4); const v = 0.85 + 0.3 * H2(kk++, 5); if (t.sak) cl.setRGB(0.78 * v, 0.47 * v, 0.53 * v); else cl.setRGB(0.12 * v, 0.19 * v, 0.07 * v); im.setColorAt(k, cl); }); }
      // 舟
      // r16：舟 = 尖头船身（舷侧收窄）+ 约三成带屋形（屋形船）；顶点色
      if (boats.length) { const mk = roof => { const pos = [], col = [], ix = []; const V = (x, y, z, c) => { pos.push(x, y, z); col.push(...c); return pos.length / 3 - 1; }, Q = (a, b, c, d, cc) => { const i = [a, b, c, d].map(p => V(...p, cc)); ix.push(i[0], i[1], i[2], i[0], i[2], i[3]); };
          const hc = [0.24, 0.17, 0.11], dk = [0.16, 0.11, 0.07], L = 4.6, Wd = 1.1, Hh = 0.75;
          Q([-Wd, Hh, -L + 1.2], [Wd, Hh, -L + 1.2], [Wd, Hh, L - 1.6], [-Wd, Hh, L - 1.6], dk);                              // 甲板
          Q([-Wd, Hh, L - 1.6], [Wd, Hh, L - 1.6], [0, Hh + 0.25, L], [0, Hh + 0.25, L], dk);                                  // 舳先甲板
          for (const sg of [-1, 1]) { Q([sg * Wd, Hh, -L + 1.2], [sg * 0.7, 0, -L + 1.4], [sg * 0.7, 0, L - 1.8], [sg * Wd, Hh, L - 1.6], hc); Q([sg * Wd, Hh, L - 1.6], [sg * 0.7, 0, L - 1.8], [0, 0.1, L - 0.4], [0, Hh + 0.25, L], hc); }
          Q([-Wd, Hh, -L + 1.2], [Wd, Hh, -L + 1.2], [0.7, 0, -L + 1.4], [-0.7, 0, -L + 1.4], hc);                               // 艫
          if (roof) { const rc = [0.12, 0.11, 0.11], wc = [0.8, 0.74, 0.62]; for (const sg of [-1, 1]) Q([sg * 0.95, Hh, -1.8], [sg * 0.95, Hh, 1.6], [sg * 0.95, Hh + 1.5, 1.6], [sg * 0.95, Hh + 1.5, -1.8], wc);
            Q([-0.95, Hh, 1.6], [0.95, Hh, 1.6], [0.95, Hh + 1.5, 1.6], [-0.95, Hh + 1.5, 1.6], wc); Q([0.95, Hh, -1.8], [-0.95, Hh, -1.8], [-0.95, Hh + 1.5, -1.8], [0.95, Hh + 1.5, -1.8], wc);
            Q([-1.25, Hh + 1.45, -2.1], [0, Hh + 1.95, -2.1], [0, Hh + 1.95, 1.9], [-1.25, Hh + 1.45, 1.9], rc); Q([0, Hh + 1.95, -2.1], [1.25, Hh + 1.45, -2.1], [1.25, Hh + 1.45, 1.9], [0, Hh + 1.95, 1.9], rc); }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(ix); g.computeVertexNormals(); return g; };
        const bm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
        for (const roof of [false, true]) { const L = boats.filter(b => !!b.roof === roof); if (!L.length) continue; const im = new THREE.InstancedMesh(mk(roof), bm, L.length);
          L.forEach((b, k) => { m4.compose(ps.set(b.x, zAt(b.x, b.y) - 0.15, -b.y), qt.setFromAxisAngle(up, b.a + Math.PI / 2), sc.set(b.s * 0.8, 1, b.s)); im.setMatrixAt(k, m4); }); im.computeBoundingSphere(); grp.add(im); } }
      // 水面（大川 + 堀川）：地面以上 4 cm 的水带（地面在这里是平的城下面），用同一种水材质
      { const pos = [], ix = []; const strip = (pts, wFn) => { const o = pos.length / 3; for (let k = 0; k < pts.length; k++) { const [x, y] = pts[k], [x2, y2] = pts[Math.min(pts.length - 1, k + 1)], [x1, y1] = pts[Math.max(0, k - 1)], dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, w = wFn(x, y) / 2;
            pos.push(x + nx * w, zAt(x + nx * w, y + ny * w) + 0.04, -(y + ny * w), x - nx * w, zAt(x - nx * w, y - ny * w) + 0.04, -(y - ny * w)); if (k) { const a = o + (k - 1) * 2; ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } } };
        // 大川在城郭东北侧以外才画（keep() 为假的一段跳过 → 分段）
        let seg = []; const segs = []; for (let x = -9000; x <= 9000; x += 40) { const y = riverY(x), ok = keep(x, y - RW / 2) && keep(x, y + RW / 2); if (ok) seg.push([x, y]); else if (seg.length) { segs.push(seg); seg = []; } } if (seg.length) segs.push(seg);
        for (const sg of segs) if (sg.length > 1) strip(sg, () => RW);
        for (const c of canals) { const pts = []; for (let x = c.x0; x <= c.x1; x += 40) pts.push([x, c.y]); if (pts.length > 1) strip(pts, () => 14); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(ix); g.computeVertexNormals();
        const wm = new THREE.Mesh(g, opt.waterMat); wm.name = 'town-water'; grp.add(wm); }
      // r16：幟（のぼり）：内环与近带沿街的部分店家门前（墙外 0.4 m、高 3.6 m < 庇下沿 → 不穿庇），竿 + 竖长布（白/藍/朱/黄土，逐面色）；在房屋柱体内（canopy 已覆盖）
      const banners = []; { const near = H.filter(h => !h.far && !h.back && h.fx !== undefined); for (const h of near) if (H2(Math.round(h.x * 3), Math.round(h.y * 3)) < 0.16) banners.push(h);
        const outerNear = H.filter(h => !h.far && h.fx === undefined && Math.hypot(h.x, h.y) < 1300 && h.h > 4 && H2(Math.round(h.x * 7), Math.round(h.y * 5)) < 0.05); for (const h of outerNear) { const ca = Math.cos(h.a), sa = Math.sin(h.a); banners.push(Object.assign({}, h, { fx: h.x + sa * h.d / 2, fy: h.y - ca * h.d / 2, nx: -sa, ny: ca })); } }
      if (banners.length) { const pos = [], col = [], ix = []; const V = (x, y, z, c) => { pos.push(x, y, z); col.push(...c); return pos.length / 3 - 1; }, Q = (a, b, c, d, cc) => { const i = [a, b, c, d].map(p => V(...p, cc)); ix.push(i[0], i[1], i[2], i[0], i[2], i[3]); };
        const pc = [0.18, 0.13, 0.09], cw = [1, 1, 1]; Q([-0.03, 0, 0], [0.03, 0, 0], [0.03, 3.6, 0], [-0.03, 3.6, 0], pc); Q([0, 0, -0.03], [0, 0, 0.03], [0, 3.6, 0.03], [0, 3.6, -0.03], pc);
        Q([0.03, 1.2, 0], [0.5, 1.2, 0], [0.5, 3.45, 0], [0.03, 3.45, 0], cw); Q([0.03, 3.45, 0], [0.5, 3.45, 0], [0.5, 3.5, 0], [0.03, 3.5, 0], pc);
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(ix); g.computeVertexNormals();
        const COLS = [[0.92, 0.9, 0.84], [0.12, 0.2, 0.42], [0.72, 0.16, 0.1], [0.75, 0.58, 0.25], [0.9, 0.88, 0.8]], bmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
        chunked(banners, g, bmat, (h, k, im) => { const x = h.fx + h.nx * -0.4 + (h.ny || 0) * 0, y = h.fy + h.ny * -0.4; qt.setFromAxisAngle(up, Math.atan2(h.ny, h.nx) + Math.PI / 2); m4.compose(ps.set(x, zAt(x, y), -y), qt, sc.set(1, 1, 1)); im.setMatrixAt(k, m4); const c = COLS[(H2(k, 77) * COLS.length) | 0]; cl.setRGB(c[0], c[1], c[2]); im.setColorAt(k, cl); }).forEach(m => { m.userData.lod = 'full'; m.userData.ban = true; }); }
      // r16：炊烟：约 70 户（内环 + 近带）屋顶上升起的烟柱（点精灵，世界坐标上升 + 随高度向东北飘散、变大变淡；anim=0 冻结）；中/高画质
      { const src = H.filter(h => !h.far && Math.hypot(h.x, h.y) < 1700 && H2(Math.round(h.x * 11), Math.round(h.y * 13)) < 0.0016 + (h.inner ? 0.02 : 0)).slice(0, 90), N = 22, n = src.length * N;
        if (n) { const P = new Float32Array(n * 3), A = new Float32Array(n * 2); let k = 0; for (const h of src) { const z = zAt(h.x, h.y) + h.h * 1.45; for (let i = 0; i < N; i++, k++) { P[k * 3] = h.x; P[k * 3 + 1] = z; P[k * 3 + 2] = -h.y; A[k * 2] = i / N; A[k * 2 + 1] = H2(k, 31); } }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('ph', new THREE.BufferAttribute(A, 2)); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3000);
          const U = { time: { value: 12.3 }, px: { value: 720 }, sunC: { value: new THREE.Vector3(1, 0.7, 0.45) }, amb: { value: new THREE.Vector3(0.35, 0.35, 0.4) } };
          const sm = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, fog: false,
            vertexShader: `attribute vec2 ph; uniform float time, px; varying float vA; varying float vT;
              void main() { float t = fract(ph.x + time * 0.03 + ph.y * 0.37), hgt = t * 38.0; vec3 p = position + vec3(0.0, hgt, 0.0) + vec3(1.0, 0.0, -0.6) * pow(t, 1.6) * 26.0 + vec3(sin(t * 9.0 + ph.y * 6.0), 0.0, cos(t * 7.0 + ph.y * 5.0)) * t * 3.0;
                vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(px * (1.2 + t * 9.0) / -mv.z, 0.0, 90.0); vA = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.45, 1.0, t)) * 0.33; vT = t; }`,
            fragmentShader: `varying float vA; varying float vT; uniform vec3 sunC, amb;
              void main() { vec2 q = gl_PointCoord - 0.5; float d = dot(q, q); if (d > 0.25) discard; vec3 c = amb + sunC * 0.35 * (0.6 + 0.4 * (0.5 - q.y)); gl_FragColor = vec4(c * 0.9, vA * (1.0 - smoothstep(0.05, 0.25, d)));
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
              }` });
          const pts = new THREE.Points(g, sm); pts.name = 'smoke'; pts.frustumCulled = false; pts.userData.U = U; pts.userData.fx = 'smoke'; grp.add(pts); } }
      // r16：鸟群：6 群（每群 14–22 只）在城与城下上空盘旋（V 形散开，扑翼 = 点精灵里的“∧”形随时间开合）；anim=0 冻结
      { const flocks = [[20, 60, 95, 140], [-300, 250, 120, 220], [380, -200, 110, 180], [-1200, 300, 150, 260], [-700, -500, 130, 240], [150, -420, 85, 120]], pos = [], ph = [];
        flocks.forEach((F, fi) => { const nb = 14 + ((H2(fi, 3) * 9) | 0); for (let i = 0; i < nb; i++) { pos.push(F[0], F[2], -F[1]); ph.push(fi + 0.5, i, F[3], H2(fi * 31 + i, 9)); } });
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('ph', new THREE.Float32BufferAttribute(ph, 4)); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3000);
        const U = { time: { value: 12.3 }, px: { value: 720 } };
        const bm = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, fog: false,
          vertexShader: `attribute vec4 ph; uniform float time, px; varying float vF;
            void main() { float fi = ph.x, i = ph.y, R = ph.z, a = time * (0.05 + 0.01 * fi) + fi * 1.7; vec3 c = position + vec3(cos(a) * R, sin(time * 0.3 + fi) * 6.0, sin(a) * R);
              vec3 tg = normalize(vec3(-sin(a), 0.0, cos(a))), sd = vec3(-tg.z, 0.0, tg.x); float row = floor(sqrt(i)), col = i - row * row - row;
              vec3 p = c - tg * row * 4.5 + sd * col * 3.2 + vec3(ph.w - 0.5, (ph.w - 0.5) * 0.6, fract(ph.w * 7.0) - 0.5) * 6.0;
              vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(px * 1.3 / -mv.z, 2.0, 14.0); vF = sin(time * 9.0 + ph.w * 20.0); }`,
          fragmentShader: `varying float vF;
            void main() { vec2 q = gl_PointCoord - 0.5; q.y = -q.y; float wing = abs(q.x) * (0.55 + 0.45 * vF) - q.y * 0.9; float d = abs(wing - 0.04) - 0.055 * (1.0 - abs(q.x) * 1.6); if (d > 0.0 || abs(q.x) > 0.48) discard;
              gl_FragColor = vec4(0.05, 0.045, 0.04, 0.85);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            }` });
        const pts = new THREE.Points(g, bm); pts.name = 'birds'; pts.frustumCulled = false; pts.userData.U = U; pts.userData.fx = 'birds'; grp.add(pts); }
      // r16：苇（堀里贴石垣墙脚，app 给点）：每丛 7 片交叉的细叶（底绿 → 梢黄褐、微弯），高 1.1–2.0 m；进 canopy（水位 + 2.3 m）
      const reeds = opt.reeds || []; if (reeds.length) { const pos = [], col = [], ix = []; for (let b = 0; b < 16; b++) { const a = b / 16 * Math.PI * 2 + 0.4 * Math.sin(b * 3.1), lean = 0.15 + 0.2 * ((b * 0.618) % 1), hh = 1.3 + 0.9 * ((b * 0.37) % 1), w0 = 0.07; const ox = 0.35 * Math.cos(b * 2.4), oz = 0.35 * Math.sin(b * 2.4);
          const dx = Math.cos(a), dz = Math.sin(a), o = pos.length / 3; for (let k = 0; k <= 3; k++) { const t = k / 3, bx = ox + dx * lean * t * t * hh, bz = oz + dz * lean * t * t * hh, wy = w0 * (1 - t * 0.85); pos.push(bx - dz * wy, t * hh, bz + dx * wy, bx + dz * wy, t * hh, bz - dx * wy); const c = [0.12 + 0.3 * t, 0.2 + 0.18 * t, 0.06 + 0.05 * t]; col.push(...c, ...c); if (k) { const q = o + (k - 1) * 2; ix.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); } } }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(ix); g.computeVertexNormals();
        const rm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
        chunked(reeds, g, rm, (t, k, im) => { qt.setFromAxisAngle(up, H2(k, 3) * 6.28); m4.compose(ps.set(t.x, t.z - 0.1, -t.y), qt, sc.set(t.s, t.s, t.s)); im.setMatrixAt(k, m4); }).forEach(m => { m.userData.lod = 'full'; m.userData.reed = true; }); }
      // ---- 相机 canopy：4 m 格上每格最高屋顶（町家按柱体 = 保守），给相机碰撞用（物理规则不放松：相机球不会进入房屋）----
      const CC = 4, half = R2 + 200, n = Math.ceil(half * 2 / CC), top = new Float32Array(n * n).fill(-1e9);
      const stamp = (h, hh) => { const ca = Math.cos(h.a), sa = Math.sin(h.a), ex = Math.abs(ca) * h.w / 2 + Math.abs(sa) * h.d / 2 + 0.5, ey = Math.abs(sa) * h.w / 2 + Math.abs(ca) * h.d / 2 + 0.5, z = (h.zz !== undefined ? h.zz : zAt(h.x, h.y)) + hh;
        for (let j = Math.floor((h.y - ey + half) / CC); j <= Math.floor((h.y + ey + half) / CC); j++) for (let i = Math.floor((h.x - ex + half) / CC); i <= Math.floor((h.x + ex + half) / CC); i++) if (i >= 0 && j >= 0 && i < n && j < n) { const q = j * n + i; if (z > top[q]) top[q] = z; } };
      const eav = (h, e) => ({ x: h.x, y: h.y, a: h.a, w: h.w * (1 + 2 * e), d: h.d * (1 + 2 * e) }); // r16：足迹含出檐（r15 只按墙体足迹 + 0.5 m，出檐 ~2 m 不在柱体里）
      for (const h of H) stamp(eav(h, EH), h.h * 1.45 + 0.5); for (const h of K) stamp(eav(h, 0.08), h.h * 1.45 + 0.5); for (const t of temples) stamp(eav(t, 0.16), t.h * 1.45 + 0.5); for (const p of pagodas) stamp(p, 37); for (const t of trees) stamp({ x: t.x, y: t.y, w: t.r * 2, d: t.r * 2, a: 0 }, t.h + 0.3); for (const b of boats) stamp({ x: b.x, y: b.y, w: 9.5 * b.s, d: 2.5 * b.s, a: b.a }, 3.2); /* r16：舟也进 canopy（r15 漏了） */ for (const t of reeds) stamp({ x: t.x, y: t.y, w: 2.0 * t.s, d: 2.0 * t.s, a: 0, zz: t.z }, 2.4 * t.s);
      const canopy = (x, y, rad) => { rad = rad || 0; let m = -1e9; const i0 = Math.floor((x - rad + half) / CC), i1 = Math.floor((x + rad + half) / CC), j0 = Math.floor((y - rad + half) / CC), j1 = Math.floor((y + rad + half) / CC);
        if (i1 < 0 || j1 < 0 || i0 >= n || j0 >= n) return m; for (let j = Math.max(0, j0); j <= Math.min(n - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(n - 1, i1); i++) { const v = top[j * n + i]; if (v > m) m = v; } return m; };
      const stats = { reeds: reeds.length, inner: opt.inner ? opt.inner.n : 0, banners: banners.length, blocks: nBlk, houses: H.length, kura: K.length, temples: temples.length, pagodas: pagodas.length, boats: boats.length, canals: canals.length, trees: trees.length, ms: Math.round(performance.now() - T0) };
      return { group: grp, canopy, stats, riverY, R2, keep };
    };
    return L;
  }
  G.CASTLE_LOOK = { make };
})(typeof window !== 'undefined' ? window : globalThis);
