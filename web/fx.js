'use strict';
// web-r13（B5）：材质与光照。全部运行时程序生成（着色器里按世界坐标算图案，不加纹理文件、不改几何、不改包）。
//   · 石垣：按面法线（屏幕导数，不用插值顶点法线 → 棱线旁细长三角形不再出噪点）取水平切向，切向按 15° 分档（档间窄带过渡，世界坐标绝对值不会因法线微差跳格）；
//     横向层（层高 0.72 m，层缝抖动）+ 每层不同石长 + 竖缝抖动；每块石头：花岗岩灰米色色差、少量锈色/深色石、细粒、边缘倒角暗化、枕状法线 + 随机倾斜；远处按像素足迹淡出成平均色（不摩尔纹）。
//   · 地面：草（干湿斑块）/ 砂利（细点）/ 土 的世界坐标噪声；道路砂利。屋瓦：本瓦葺（丸瓦凸、平瓦微凹、每行搭接阴影、逐瓦色差/粗糙度），沿坡向排列。
//   · 白壁：极淡的竖向雨痕 + 细颗粒；黒漆下見板：横板搭接 + 押縁。水面：静态微波法线（不需要连续重画）+ 环境反射的菲涅尔。树冠：叶团明暗 + 下部自遮挡。
//   · 光照：环境贴图 = 程序渐变天空（天顶/地平/地面 + 太阳方向的柔光，无日轮——日轮由平行光负责）经 PMREM；室内用另一张“窗带亮、地板暖、顶棚暗”的环境图近似反弹光。
//   · 时段预设 朝/昼/夕；画质 低/中/高（阴影图 1024/2048/4096、像素比 1/1.5/2、细节开关），自动按设备判断。
(function (G) {
  const COMMON = `
varying vec3 vWP; varying vec3 vWN; varying vec3 vLP;
float fxH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float fxN(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f); return mix(mix(fxH(i), fxH(i + vec2(1.0, 0.0)), u.x), mix(fxH(i + vec2(0.0, 1.0)), fxH(i + vec2(1.0, 1.0)), u.x), u.y); }
// 分形噪声：倍频数随画质（低 1 / 中 2 / 高 3）——软件渲染下片元开销主要在这里
float fxF(vec2 p) {
#if FX_Q == 0
  return fxN(p);
#elif FX_Q == 1
  return (0.5 * fxN(p) + 0.25 * fxN(p * 2.03 + 7.1)) / 0.75;
#else
  return (0.5 * fxN(p) + 0.25 * fxN(p * 2.03 + 7.1) + 0.125 * fxN(p * 4.11 + 3.7)) / 0.875;
#endif
}
float fxRow(float k, float seed, float RH, float u) { return k * RH + (fxH(vec2(k, seed + 3.1)) - 0.5) * 0.34 * RH + 0.07 * sin(u * (0.35 + 0.3 * fxH(vec2(k, seed))) + k * 2.3); } // 层缝：每层抖动 + 沿墙缓慢起伏（不是砖墙的直线）
float fxJnt(float c, float r, float seed) { return c + (fxH(vec2(c, r + seed * 7.0)) - 0.5) * 0.5; }
// 一块石头：q = (沿墙水平 m, 高 m)；返回反照率，bump = 切向法线偏移（沿 u、沿上坡）
vec3 fxStone(vec2 q, float foot, float seed, out vec2 bump) {
  const float RH = 1.1; // r15：石块放大（0.82 → 1.1 m 层高、石长 1.4–3.2 m）：近景石垣更“巨石”
  float k = floor(q.y / RH), r = k, Yk = fxRow(k, seed, RH, q.x), Y1 = fxRow(k + 1.0, seed, RH, q.x), yb = Yk, yt = Y1;
  if (q.y < Yk) { r = k - 1.0; yt = Yk; yb = fxRow(r, seed, RH, q.x); } else if (q.y >= Y1) { r = k + 1.0; yb = Y1; yt = fxRow(k + 2.0, seed, RH, q.x); }
  float L = 1.4 + 1.8 * fxH(vec2(r, seed + 1.7)), x = q.x / L + fxH(vec2(r, seed + 9.2)) * 17.0, c = floor(x), s = c;
  float Jc = fxJnt(c, r, seed), J1 = fxJnt(c + 1.0, r, seed), xa = Jc, xb = J1;
  if (x < Jc) { s = c - 1.0; xb = Jc; xa = fxJnt(s, r, seed); } else if (x >= J1) { s = c + 1.0; xa = J1; xb = fxJnt(c + 2.0, r, seed); }
  float h1 = fxH(vec2(s, r + seed)), h2 = fxH(vec2(s + 31.7, r - 11.3)), h3 = fxH(vec2(r + 5.1, s * 1.3));
  float d = min(min(x - xa, xb - x) * L, min(q.y - yb, yt - q.y)), g = 0.018 + 0.022 * h3, aa = max(foot, 0.004);
  float gap = 1.0 - smoothstep(g, g + aa * 1.5, d);
  vec3 base = mix(vec3(0.39, 0.375, 0.35), vec3(0.50, 0.475, 0.435), h1);
  base *= h2 > 0.9 ? vec3(1.07, 0.97, 0.85) : (h2 < 0.07 ? vec3(0.8) : vec3(1.0));
#if FX_Q > 0
  float fineK = 1.0 - smoothstep(0.012, 0.05, foot);
  if (fineK > 0.0) base *= 0.9 + 0.2 * mix(0.5, fxN(q * 6.3 + vec2(s * 1.7, r)), fineK);
#endif
  base *= mix(0.7, 1.0, smoothstep(0.0, 0.1, d));
  float px = (x - xa) / (xb - xa) * 2.0 - 1.0, py = (q.y - yb) / (yt - yb) * 2.0 - 1.0;
  bump = vec2(px * smoothstep(0.45, 1.0, abs(px)), py * smoothstep(0.45, 1.0, abs(py))) * 0.6 + (vec2(h2, h3) - 0.5) * 0.3;
  return mix(base, vec3(0.09, 0.085, 0.08), gap);
}
// 低画质的砌石：同样按面法线 + 15° 档取切向（棱线旁不出噪点），但只用错缝 + 每块一个随机灰度（软件渲染下与 r12 的开销同级）
vec3 fxWall0(vec3 fN, float foot) {
  vec2 hz = fN.xz; if (dot(hz, hz) < 1e-6) hz = vec2(1.0, 0.0);
  float a = floor(atan(hz.y, hz.x) / 0.2617994 + 0.5) * 0.2617994, u = dot(vWP.xz, vec2(-sin(a), cos(a))), row = floor(vWP.y / 0.82);
  float uu = u / 1.6 + row * 0.47 + fxH(vec2(row, 3.0)) * 3.0, cu = fract(uu), cv = fract(vWP.y / 0.82), aa = clamp(foot * 1.5, 0.0, 0.3);
  float mortar = max(1.0 - smoothstep(0.03, 0.06 + aa, min(cu, 1.0 - cu) * 1.6), 1.0 - smoothstep(0.03, 0.06 + aa, min(cv, 1.0 - cv) * 0.82));
  vec3 sc = mix(vec3(0.39, 0.375, 0.35), vec3(0.50, 0.475, 0.435), fxH(vec2(floor(uu), row)));
  sc = mix(mix(sc, vec3(0.1, 0.095, 0.09), mortar * 0.85), vec3(0.40, 0.38, 0.355), smoothstep(0.06, 0.22, foot));
  return sc * (0.86 + 0.24 * fxN(vec2((vWP.x - vWP.z) * 0.21, vWP.y * 0.05)));
}
// 墙面（陡面）砌石：fN = 面法线（世界），nW = 带凹凸的法线
vec3 fxWall(vec3 fN, float foot, out vec3 nW) {
  float farK = smoothstep(0.05, 0.2, foot), macro = 0.84 + 0.26 * fxN(vec2((vWP.x - vWP.z) * 0.21, vWP.y * 0.05));
  nW = fN; vec3 col = vec3(0.40, 0.38, 0.355);
  if (farK < 0.999) {
    vec2 hz = fN.xz; if (dot(hz, hz) < 1e-6) hz = vec2(1.0, 0.0);
#if FX_Q == 0
    float th = atan(hz.y, hz.x) / 0.2617994, k0 = floor(th + 0.5), w = 0.0, a0 = k0 * 0.2617994, a1 = a0;   // 低画质：只取最近的一档，不做档间过渡（软件渲染下分支两侧都会执行）
#else
    float th = atan(hz.y, hz.x) / 0.2617994, k0 = floor(th), w = smoothstep(0.42, 0.58, th - k0), a0 = k0 * 0.2617994, a1 = a0 + 0.2617994;
#endif
    vec2 t0 = vec2(-sin(a0), cos(a0)), t1 = vec2(-sin(a1), cos(a1)), b = vec2(0.0), bump = vec2(0.0); vec3 c = vec3(0.0);
    if (w < 0.999) { c += (1.0 - w) * fxStone(vec2(dot(vWP.xz, t0), vWP.y), foot, k0, b); bump += (1.0 - w) * b; }
#if FX_Q > 0
    if (w > 0.001) { c += w * fxStone(vec2(dot(vWP.xz, t1), vWP.y), foot, k0 + 1.0, b); bump += w * b; }
#endif
    col = mix(c, col, farK);
#if FX_Q > 0
    vec2 tw = w < 0.5 ? t0 : t1; vec3 T = vec3(tw.x, 0.0, tw.y); T = normalize(T - fN * dot(T, fN) + 1e-5); vec3 B = normalize(cross(fN, T)); if (B.y < 0.0) B = -B;
    nW = normalize(fN + (T * bump.x + B * bump.y) * (1.0 - farK));
#endif
  }
  return col * macro;
}
`;
  const VERT = `#include <begin_vertex>
  { vec4 fxw = vec4(transformed, 1.0); vec3 fxn = objectNormal;
  #ifdef USE_INSTANCING
    fxw = instanceMatrix * fxw; fxn = mat3(instanceMatrix) * fxn;
  #endif
    fxw = modelMatrix * fxw; vWP = fxw.xyz; vWN = normalize(mat3(modelMatrix) * fxn); vLP = position; }`;
  const PRE = `float fxFoot = max(length(dFdx(vWP)), length(dFdy(vWP))); vec3 fxFN = normalize(cross(dFdx(vWP), dFdy(vWP))); vec3 fxNW = fxFN; float fxNk = 0.0; float fxR = 1.0;`;
  // 各类材质的片元代码（插在 color_fragment 之后；diffuseColor 已含顶点色/贴图）
  const KIND = {
    // 地形：缓坡 = 地面细节；陡坡 = 砌石（面法线判定）。光照法线：远离棱线用插值顶点法线（光滑），棱线旁（顶点法线与面法线差大）切到面法线（棱线锐利），陡面加凹凸
    terrain: `{
      vec3 dc = diffuseColor.rgb, vN = normalize(vWN);
      float steep = (1.0 - smoothstep(0.42, 0.62, fxFN.y)) * (1.0 - smoothstep(0.08, 0.12, max(dc.r, max(dc.g, dc.b)) - min(dc.r, min(dc.g, dc.b)))); // 陡 + 顶点色是石色（低饱和）才砌石：草/土坡（土桥两侧）保持地面
      float gr = clamp((dc.g - max(dc.r, dc.b)) * 9.0, 0.0, 1.0);
      float fineK = 1.0 - smoothstep(0.025, 0.1, fxFoot), midK = 1.0 - smoothstep(0.1, 0.5, fxFoot);
      vec3 g1 = dc * (0.82 + 0.36 * fxF(vWP.xz * 0.045));
#if FX_Q > 0
      if (midK > 0.0) g1 *= mix(1.0, 0.9 + 0.2 * fxN(vWP.xz * 0.37 + 11.0), midK);
      if (gr > 0.0) g1 = mix(g1, g1 * vec3(1.16, 1.05, 0.74), gr * smoothstep(0.42, 0.7, fxN(vWP.xz * 0.02 + 5.0)));
      if (fineK > 0.0) { float sp = fxH(floor(vWP.xz * 13.0)), bl = fxN(vWP.xz * vec2(9.0, 3.0)); g1 *= mix(1.0, mix(0.88 + 0.24 * sp, 0.9 + 0.2 * bl, gr), fineK); }
#endif
#if FX_Q == 0
      if (steep > 0.0) g1 = mix(g1, fxWall0(fxFN, fxFoot), steep);
      diffuseColor.rgb = g1;
#else
      float edge = smoothstep(0.985, 0.88, dot(vN, fxFN));
      vec3 nW = normalize(mix(vN, fxFN, edge));
      if (steep > 0.0) { vec3 nS; vec3 sc = fxWall(fxFN, fxFoot, nS); g1 = mix(g1, sc, steep); nW = normalize(mix(nW, nS, steep)); fxR = mix(1.0, 0.92, steep); }
      diffuseColor.rgb = g1; fxNW = nW; fxNk = 1.0;
#endif
    }`,
    // r15：大环地面 = 城下土色；町家实例以外（r > 2.55 km）画“瓦海”：街区（127×88 m，街路 9 m）+ 沿街屋根列（深灰瓦、浅色墙线），按像素足迹淡出成平均色
    ground: `{ diffuseColor.rgb *= 0.84 + 0.32 * fxN(vWP.xz * 0.03); float rr = length(vWP.xz); diffuseColor.rgb *= mix(vec3(1.0), vec3(0.5, 0.52, 0.42), smoothstep(700.0, 900.0, rr) * (0.7 + 0.3 * fxN(vWP.xz * 0.004)));
      #if FX_Q == 0
      float tk = smoothstep(1150.0, 1300.0, length(vWP.xz - cameraPosition.xz)) * smoothstep(760.0, 820.0, rr) * (1.0 - smoothstep(6500.0, 8800.0, rr)); // 低画质：町家只画相机 1.25 km 以内，以外地面瓦海
#else
      float tk = smoothstep(2450.0, 2700.0, rr) * (1.0 - smoothstep(6500.0, 8800.0, rr));
#endif
      if (tk > 0.0) { vec2 p = vWP.xz; vec2 b = mod(p, vec2(127.0, 88.0)); float st = max(1.0 - step(9.0, b.x), 1.0 - step(9.0, b.y));
        float row = fract((b.y - 9.0) / 19.75), lot = fxH(floor(vec2(p.x / 7.0, (p.y - 9.0) / 19.75))); vec3 roof = vec3(0.075, 0.075, 0.085) * (0.7 + 0.7 * lot), wall = vec3(0.42, 0.36, 0.30);
        vec3 c = mix(mix(roof, wall, step(0.86, row)), vec3(0.30, 0.26, 0.21), st); vec3 avg = vec3(0.13, 0.12, 0.12); c = mix(c, avg, smoothstep(0.6, 3.0, fxFoot));
        diffuseColor.rgb = mix(diffuseColor.rgb, c, tk); } }`,
    road: `{ float fineK = 1.0 - smoothstep(0.02, 0.08, fxFoot), midK = 1.0 - smoothstep(0.1, 0.4, fxFoot); diffuseColor.rgb *= 0.86 + 0.28 * fxF(vWP.xz * 0.08);
#if FX_Q > 0
      if (midK > 0.0) diffuseColor.rgb *= mix(1.0, 0.94 + 0.12 * fxN(vWP.xz * 1.3), midK); if (fineK > 0.0) diffuseColor.rgb *= mix(1.0, 0.86 + 0.28 * fxH(floor(vWP.xz * 17.0)), fineK);
#endif
    }`,
    // 切石（櫓台、枡形石垣、多門櫓台座）：竖面 = 砌石；顶面 = 同一套石块当敷石
    stone: `{ vec3 nS; vec3 sc;
#if FX_Q == 0
      if (abs(fxFN.y) < 0.6) { sc = fxWall0(fxFN, fxFoot); nS = fxFN; }
#else
      if (abs(fxFN.y) < 0.6) sc = fxWall(fxFN, fxFoot, nS);
#endif
      else { vec2 b; sc = fxStone(vWP.xz * vec2(1.0, 1.25), fxFoot, 17.0, b); sc = mix(sc, vec3(0.42, 0.40, 0.37), smoothstep(0.05, 0.2, fxFoot)); nS = normalize(fxFN + vec3(b.x, 0.0, b.y) * 0.5 * FX_BUMP * (1.0 - smoothstep(0.05, 0.2, fxFoot))); }
      diffuseColor.rgb = sc; fxNW = nS; fxNk = 1.0; }`,
    // 本瓦葺：沿坡向的瓦列（周期 0.30 m）：丸瓦凸、平瓦微凹；每行（0.30 m 斜长）下缘搭接阴影；逐瓦色差 + 粗糙度
    tile: `{ vec3 fN = fxFN; float hl = length(fN.xz), fT = 1.0 - smoothstep(0.03, 0.1, fxFoot);
      if (fN.y > 0.2 && hl > 0.12) {
        vec2 dd = fN.xz / hl, tt = vec2(-dd.y, dd.x); float u = dot(vWP.xz, tt) / 0.30, s = vWP.y / hl / 0.30;
        float cu = floor(u), pu = fract(u) - 0.5, ps = fract(s), mW = 0.2, isM = 1.0 - smoothstep(mW - 0.025, mW + 0.01, abs(pu));
        float h = fxH(vec2(cu, floor(s))), sh = 1.0 - 0.5 * smoothstep(0.86, 1.0, ps) * (1.0 - 0.5 * isM);
        vec3 c = diffuseColor.rgb * (0.86 + 0.24 * h) * sh * mix(0.9, 1.08, isM);
        float bx = mix(-pu * 0.5, pu / mW * 0.95, isM), by = -0.12 + 0.25 * smoothstep(0.86, 1.0, ps);
        diffuseColor.rgb = mix(diffuseColor.rgb * 0.94, c, fT); fxR = mix(1.0, 0.8 + 0.4 * h, fT);
        vec3 T = vec3(tt.x, 0.0, tt.y); T = normalize(T - fN * dot(T, fN)); vec3 B = normalize(cross(fN, T)); if (B.y < 0.0) B = -B;
        fxNW = normalize(fN + (T * bx + B * by) * fT * FX_BUMP); fxNk = 1.0;
      } else diffuseColor.rgb *= 0.95 + 0.1 * fxN(vWP.xz * 3.0 + vWP.y); }`,
    // 白壁：竖向雨痕（极淡）+ 细颗粒；墙脚略脏（离地 0–1.2 m 的世界高度取不到 → 用面内低频噪声代替，不做“按楼层”假设）
    plaster: `{ vec3 fN = fxFN; float hl = length(fN.xz); vec2 q = hl > 0.3 ? vec2(dot(vWP.xz, vec2(-fN.z, fN.x) / hl), vWP.y) : vWP.xz;
      float fk = 1.0 - smoothstep(0.008, 0.04, fxFoot); diffuseColor.rgb *= 0.935 + 0.08 * fxF(q * vec2(0.9, 0.12)); 
#if FX_Q > 0
      if (fk > 0.0) diffuseColor.rgb *= mix(1.0, 0.975 + 0.05 * fxN(q * 11.0), fk);
#endif
    }`,
    // 黒漆下見板張：横板 0.24 m（搭接：每板下缘阴影 + 板面微倾），押縁每 0.9 m
    lacquer: `{ vec3 fN = fxFN; float hl = length(fN.xz), fT = 1.0 - smoothstep(0.015, 0.05, fxFoot);
      if (hl > 0.6) { vec2 tt = vec2(-fN.z, fN.x) / hl; float u = dot(vWP.xz, tt), pb = fract(vWP.y / 0.24), bt = 1.0 - smoothstep(0.035, 0.05, abs(fract(u / 0.9) - 0.5) * 0.9);
        float sh = mix(0.62, 1.0, smoothstep(0.0, 0.18, pb)) * mix(1.0, 1.25, bt);
        diffuseColor.rgb *= mix(1.0, sh, fT); fxNW = normalize(fN + vec3(0.0, 1.0, 0.0) * (-0.18 + 0.4 * (1.0 - smoothstep(0.0, 0.12, pb))) * fT * FX_BUMP); fxNk = 1.0; fxR = mix(1.0, 1.0 - 0.25 * bt, fT); } }`,
    // 水：静态微波（两层噪声的梯度）→ 环境反射在grazing角度有菲涅尔；远处平滑
    water: `{ vec2 p = vWP.xz; float amp = 0.1 * (1.0 - smoothstep(0.1, 1.5, fxFoot)) * FX_BUMP;
#if FX_Q > 0
      if (amp > 0.0) { float m = 0.5 + fxN(p * 0.045), w1 = dot(p, vec2(0.8, 0.6)) * 0.9 + fxN(p * 0.11) * 6.0, w2 = dot(p, vec2(-0.45, 0.89)) * 1.7 + fxN(p * 0.07 + 9.0) * 8.0, w3 = dot(p, vec2(0.96, -0.28)) * 3.1 + fxN(p * 0.3) * 3.0;
        vec2 g = vec2(0.8, 0.6) * 0.45 * cos(w1) + vec2(-0.45, 0.89) * 0.42 * cos(w2) + vec2(0.96, -0.28) * 0.37 * cos(w3);
        fxNW = normalize(vec3(-g.x * amp * m, 1.0, -g.y * amp * m)); fxNk = 1.0; }
#endif
      diffuseColor.rgb *= 0.9 + 0.2 * fxN(p * 0.012); }`,
    // 树冠：叶团（世界坐标噪声）+ 下半部自遮挡 + 法线扰动（打散二十面体的光滑球感）
    crown: `{ float ao = 0.68 + 0.32 * smoothstep(-0.9, 0.7, vLP.y), fineK = 1.0 - smoothstep(0.03, 0.15, fxFoot), n = 0.5, n2 = 0.5;
#if FX_Q > 0
      if (fineK > 0.0) { n = mix(0.5, fxF(vWP.xz * 1.4 + vec2(vWP.y * 1.7, -vWP.y * 1.3)), fineK); n2 = mix(0.5, fxN(vWP.xz * 3.7 - vWP.y * 2.9), fineK); }
#endif
      diffuseColor.rgb *= ao * (0.72 + 0.56 * n);
      vec3 vN = normalize(vWN); fxNW = normalize(vN + (vec3(n, n2, 1.0 - n) - 0.5) * 0.9 * fineK * FX_BUMP); fxNk = 1.0; fxR = 1.0; }`,
    // 木：外部柱/门扉——竖向木纹（极淡）
    wood: `{ vec3 fN = fxFN; float hl = length(fN.xz); vec2 q = hl > 0.3 ? vec2(dot(vWP.xz, vec2(-fN.z, fN.x) / hl), vWP.y) : vWP.xz;
      float fk = 1.0 - smoothstep(0.01, 0.05, fxFoot); if (fk > 0.0) diffuseColor.rgb *= mix(1.0, 0.9 + 0.2 * fxN(vec2(q.x * 14.0, q.y * 0.6)), fk); }`,
  };
  function make(THREE) {
    const FX = { q: 2, kinds: KIND, mats: [] };
    // 画质：hash q=0/1/2 > localStorage > 自动（软件渲染 → 低；手机/平板 → 中；桌面 → 高）
    FX.detect = (renderer, hashQ) => {
      if (hashQ === 0 || hashQ === 1 || hashQ === 2) return { q: hashQ, why: 'hash' };
      try { const s = localStorage.getItem('castle.q'); if (s === '0' || s === '1' || s === '2') return { q: +s, why: 'saved' }; } catch (e) { /* 无痕模式 */ }
      let gpu = ''; try { const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); } catch (e) { /* 取不到 */ }
      const ua = navigator.userAgent || '', mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);
      if (/SwiftShader|llvmpipe|Software|Microsoft Basic/i.test(gpu)) return { q: 0, why: 'software GPU', gpu };
      if (mobile) return { q: /Adreno \(TM\) [3-6]\d\d|Mali-[GT][0-7]\d|PowerVR/i.test(gpu) ? 0 : 1, why: 'mobile', gpu };
      if (/Intel.*(HD|UHD) Graphics [1-6]\d\d\b/i.test(gpu)) return { q: 1, why: 'integrated GPU', gpu };
      return { q: 2, why: 'desktop', gpu };
    };
    // 环境图只给需要镜面反射的材质（水、瓦、漆、金…），而且只取镜面项：漫反射天光由半球光负责（软件渲染下 IBL 漫反射的立方体采样占整帧 ~15%）
    const LFM = THREE.ShaderChunk.lights_fragment_maps.replace('iblIrradiance += getIBLIrradiance( geometryNormal );', '');
    FX.envMats = [];
    FX.spec = mat => { if (!FX.envMats.includes(mat)) FX.envMats.push(mat); if (!mat.userData.fx) { mat.userData.fx = 'spec'; mat.customProgramCacheKey = () => 'fxspec'; mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_maps>', LFM); }; } if (FX.envTex) mat.envMap = FX.envTex; return mat; };
    FX.setEnv = tex => { FX.envTex = tex; for (const m of FX.envMats) { if (!m.envMap !== !tex) m.needsUpdate = true; m.envMap = tex; } };
    FX.patch = (mat, kind, spec) => {
      mat.userData.fx = kind; mat.defines = Object.assign(mat.defines || {}, { FX_Q: FX.q, FX_BUMP: FX.q > 0 ? '1.0' : '0.0' });
      mat.customProgramCacheKey = () => 'fx-' + kind + '-' + FX.q;
      if (spec) FX.spec(mat);
      mat.onBeforeCompile = sh => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_maps>', LFM);
        sh.vertexShader = 'varying vec3 vWP; varying vec3 vWN; varying vec3 vLP;\n' + sh.vertexShader.replace('#include <begin_vertex>', VERT);
        sh.fragmentShader = COMMON + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + PRE + '\n' + KIND[kind])
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * fxR, 0.04, 1.0);')
          .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nif (fxNk > 0.0) { vec3 fxV = normalize((viewMatrix * vec4(fxNW, 0.0)).xyz); normal = normalize(mix(normal, fxV, fxNk)); }');
      };
      if (!FX.mats.includes(mat)) FX.mats.push(mat); mat.needsUpdate = true; return mat;
    };
    FX.setQ = q => { FX.q = q; for (const m of FX.mats) { m.defines.FX_Q = q; m.defines.FX_BUMP = q > 0 ? '1.0' : '0.0'; m.needsUpdate = true; } };
    // 时段预设（太阳高度/方位 度；天空/环境/雾的颜色是线性值；fog 是屏幕 sRGB 值——three r160 的雾在色彩空间转换之后混合）
    FX.TOD = {
      m: { name: '朝', el: 18, az: 112, sun: [1.0, 0.86, 0.70], I: 3.0, sky: [3.5, 2.2, 0.006, 0.8], zen: [0.15, 0.24, 0.45], hor: [0.58, 0.55, 0.53], gnd: [0.14, 0.125, 0.10], glow: [0.5, 0.36, 0.24], fog: [0.84, 0.81, 0.78], exp: 0.92,
        skyZ: [0.16, 0.30, 0.62], skyH: [0.95, 0.88, 0.80], disc: 25, cloud: 0.45, cTint: [1.0, 0.92, 0.85], mtn: [[0.34, 0.36, 0.42], [0.72, 0.72, 0.74]],
        post: { tm: 1, exp: 1.0, thr: 1.6, bloom: 0.10, god: 0.35, sat: 1.05, warm: [1.03, 1.0, 0.96], cool: [0.97, 1.0, 1.04], vig: 0.25, fogA: 0.00028, fogH: 70, fogC: [0.62, 0.64, 0.68], mistA: 0.035, mistY: 3, mistH: 6 } },
      d: { name: '昼', el: 34.38, az: 215, sun: [1.0, 0.93, 0.84], I: 3.3, sky: [6, 1.5, 0.005, 0.8], zen: [0.13, 0.24, 0.50], hor: [0.48, 0.55, 0.64], gnd: [0.16, 0.15, 0.12], glow: [0.35, 0.3, 0.24], fog: [0.80, 0.85, 0.89], exp: 0.78,
        skyZ: [0.10, 0.24, 0.62], skyH: [0.72, 0.82, 0.95], disc: 20, cloud: 0.4, cTint: [1.0, 1.0, 1.0], mtn: [[0.30, 0.36, 0.44], [0.66, 0.74, 0.84]],
        post: { tm: 1, exp: 0.95, thr: 1.8, bloom: 0.08, god: 0.2, sat: 1.03, warm: [1.02, 1.0, 0.98], cool: [0.98, 1.0, 1.02], vig: 0.22, fogA: 0.00022, fogH: 90, fogC: [0.52, 0.60, 0.72], mistA: 0.0, mistY: 3, mistH: 4 } },
      e: { name: '夕', el: 10, az: 252, sun: [1.0, 0.72, 0.48], I: 2.7, sky: [7, 2.6, 0.007, 0.84], zen: [0.12, 0.16, 0.33], hor: [0.60, 0.48, 0.40], gnd: [0.12, 0.10, 0.08], glow: [0.7, 0.4, 0.2], fog: [0.86, 0.77, 0.68], exp: 0.98,
        skyZ: [0.10, 0.17, 0.40], skyH: [1.25, 0.78, 0.50], disc: 30, cloud: 0.5, cTint: [1.0, 0.75, 0.55], mtn: [[0.30, 0.25, 0.27], [0.95, 0.70, 0.52]],
        post: { tm: 1, exp: 1.0, thr: 1.4, bloom: 0.13, god: 0.5, sat: 1.08, warm: [1.06, 1.0, 0.92], cool: [0.94, 0.98, 1.06], vig: 0.3, fogA: 0.0003, fogH: 70, fogC: [0.60, 0.44, 0.33], mistA: 0.006, mistY: 3, mistH: 5 } },
      // web-r15（C1）：黄金时刻（默认）：太阳低（7.5°）、偏西南；天空上蓝下金，云底被照亮；暖逆光 + 冷阴影
      g: { name: '黄金时刻', el: 7.5, az: 238, sun: [1.0, 0.66, 0.38], I: 3.6, sky: [7, 2.6, 0.007, 0.84], zen: [0.10, 0.17, 0.36], hor: [0.68, 0.50, 0.38], gnd: [0.12, 0.10, 0.08], glow: [0.9, 0.5, 0.22], fog: [0.88, 0.74, 0.60], exp: 0.95,
        skyZ: [0.05, 0.15, 0.48], skyH: [1.15, 0.72, 0.42], disc: 40, cloud: 0.55, cTint: [1.0, 0.78, 0.55], mtn: [[0.24, 0.22, 0.27], [0.98, 0.74, 0.55]],
        post: { tm: 1, exp: 0.8, thr: 1.3, bloom: 0.16, god: 0.6, sat: 1.12, con: 0.35, warm: [1.07, 1.0, 0.9], cool: [0.93, 0.98, 1.08], vig: 0.32, fogA: 0.00016, fogH: 80, fogC: [0.50, 0.36, 0.26], mistA: 0.008, mistY: 3, mistH: 5 } },
    };
    // 程序环境图：一个球 + 渐变着色器 → PMREM（立方体 UV 贴图，同尺寸 → 换室内/外景不重编译着色器）
    const envMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false,
      uniforms: { zen: { value: new THREE.Vector3() }, hor: { value: new THREE.Vector3() }, gnd: { value: new THREE.Vector3() }, glow: { value: new THREE.Vector3() }, sd: { value: new THREE.Vector3(0, 1, 0) }, band: { value: 0 } },
      vertexShader: 'varying vec3 vD; void main() { vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vD; uniform vec3 zen, hor, gnd, glow, sd; uniform float band;
        void main() { vec3 d = normalize(vD); float y = d.y; vec3 c;
          if (band > 0.5) { c = y > 0.0 ? mix(hor, zen, smoothstep(0.08, 0.6, y)) : mix(hor, gnd, smoothstep(0.0, 0.35, -y)); }   // 室内：水平窗带最亮，顶棚暗、地板暖
          else { c = y > 0.0 ? mix(hor, zen, pow(y, 0.55)) : mix(hor * 0.85, gnd, smoothstep(0.0, 0.2, -y)); float k = max(dot(d, sd), 0.0); c += glow * (pow(k, 6.0) * 0.5 + pow(k, 48.0) * 1.6) * smoothstep(-0.1, 0.05, y); }
          gl_FragColor = vec4(c, 1.0); }` });
    const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envMat));
    let pmrem = null; const RT = {};
    FX.env = (renderer, key, p, sd) => { const t0 = performance.now(); if (!pmrem) pmrem = new THREE.PMREMGenerator(renderer);
      const U = envMat.uniforms; U.zen.value.fromArray(p.zen); U.hor.value.fromArray(p.hor); U.gnd.value.fromArray(p.gnd); U.glow.value.fromArray(p.glow || [0, 0, 0]); U.band.value = p.band ? 1 : 0; if (sd) U.sd.value.copy(sd);
      if (RT[key]) RT[key].dispose(); RT[key] = pmrem.fromScene(envScene, 0, 0.1, 100); FX.envMs = (FX.envMs || 0) + (performance.now() - t0); return RT[key].texture; };
    return FX;
  }
  G.CASTLE_FX = { make, KIND, COMMON };
})(typeof window !== 'undefined' ? window : globalThis);
