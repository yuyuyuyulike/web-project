/* =============================================================================
   奇点 · 网页黑洞  (Singularity — a black hole in your browser)
   -----------------------------------------------------------------------------
   实时史瓦西黑洞渲染器 / Real-time Schwarzschild black hole renderer.

   单位制：史瓦西半径 rs = 2M = 1  ⇒  M = 0.5
     · 事件视界        r = 1
     · 光子球          r = 1.5
     · 最内稳定圆轨道  r = 3
     · 临界撞击参数    b = 3√3/2 ≈ 2.598

   光线（零测地线）在类笛卡尔坐标下的精确轨道方程：
       d²x/dλ² = -3 M h² x / r⁵ ,   h = |x × v|  （运动常数）
   由 u'' + u = 3 M u²（u = 1/r）反推中心力得到，故弯曲量是精确的，
   而非“伪引力”近似。用中点法（RK2）积分，步长随 r 自适应。

   吸积盘：几何薄、光学薄的发射层，按穿越平面时的斜程长度积分，
   含开普勒较差转动、多普勒集束（δ^3）、引力红移与黑体色温映射。
   ========================================================================== */
(function () {
  'use strict';

  // ---------------------------------------------------------------- 工具
  var $ = function (s) { return document.querySelector(s); };
  var canvas = $('#gl');
  var fatalBox = $('#fatal'), fatalMsg = $('#fatalMsg');

  function fatal(msg) {
    if (fatalMsg) fatalMsg.textContent = String(msg);
    if (fatalBox) fatalBox.hidden = false;
    var intro = $('#intro'); if (intro) intro.classList.add('gone');
    console.error(msg);
  }
  window.addEventListener('error', function (e) {
    if (!fatalBox.hidden) return;
    fatal((e.message || 'unknown error') + '\n' + (e.filename || '') + ':' + (e.lineno || ''));
  });

  var gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: false, stencil: false,
    premultipliedAlpha: false, preserveDrawingBuffer: false,
    powerPreference: 'high-performance'
  });
  if (!gl) { fatal('浏览器未提供 WebGL2 上下文。'); return; }

  var hdr = !!(gl.getExtension('EXT_color_buffer_float') ||
               gl.getExtension('EXT_color_buffer_half_float'));
  var TEX_IF = hdr ? gl.RGBA16F : gl.RGBA8;
  var TEX_TY = hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

  canvas.addEventListener('webglcontextlost', function (e) {
    e.preventDefault(); fatal('WebGL 上下文丢失，请刷新页面。');
  });

  /* ==========================================================================
     GLSL
     ====================================================================== */
  var VS = [
    '#version 300 es',
    'void main(){',
    '  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));',
    '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  // ---------------------------------------------------------- 公共着色器片段
  var LIB = [
    'const float PI = 3.14159265359;',

    // ---- 哈希 / 噪声 (Dave Hoskins 风格) ----
    'float hash13(vec3 p){',
    '  p = fract(p * 0.1031);',
    '  p += dot(p, p.zyx + 31.32);',
    '  return fract((p.x + p.y) * p.z);',
    '}',
    'vec3 hash33(vec3 p){',
    '  p = fract(p * vec3(0.1031, 0.1030, 0.0973));',
    '  p += dot(p, p.yxz + 33.33);',
    '  return fract((p.xxy + p.yxx) * p.zyx);',
    '}',
    'float vnoise(vec3 p){',
    '  vec3 i = floor(p), f = p - i;',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  float a = mix(mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),',
    '                    mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),',
    '                mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),',
    '                    mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);',
    '  return a;',
    '}',
    'float fbm(vec3 p, int oct){',
    '  float s = 0.0, a = 0.5, n = 0.0;',
    '  for (int i = 0; i < 6; i++){',
    '    if (i >= oct) break;',
    '    s += a * vnoise(p); n += a;',
    '    p = p * 2.03 + 9.7; a *= 0.5;',
    '  }',
    '  return s / max(n, 1e-4);',
    '}',

    // ---- 黑体色 (CIE 1960 UCS 近似, Krystek) ----
    'vec3 blackbody(float T){',
    '  T = clamp(T, 900.0, 40000.0);',
    '  float t2 = T * T;',
    '  float u = (0.860117757 + 1.54118254e-4 * T + 1.28641212e-7 * t2)',
    '          / (1.0 + 8.42420235e-4 * T + 7.08145163e-7 * t2);',
    '  float v = (0.317398726 + 4.22806245e-5 * T + 4.20481691e-8 * t2)',
    '          / (1.0 - 2.89741816e-5 * T + 1.61456053e-7 * t2);',
    '  float d = 2.0 * u - 8.0 * v + 4.0;',
    '  vec2 xy = vec2(3.0 * u / d, 2.0 * v / d);',
    '  xy = max(xy, vec2(1e-4));',
    '  vec3 XYZ = vec3(xy.x / xy.y, 1.0, (1.0 - xy.x - xy.y) / xy.y);',
    '  mat3 M = mat3( 3.2404542, -0.9692660,  0.0556434,',
    '                -1.5371385,  1.8760108, -0.2040259,',
    '                -0.4985314,  0.0415560,  1.0572252);',
    '  vec3 rgb = max(M * XYZ, vec3(0.0));',
    '  return rgb / max(max(rgb.r, max(rgb.g, rgb.b)), 1e-4);',
    '}'
  ].join('\n');

  // ------------------------------------------------------------- 场景着色器
  var FS_SCENE = [
    '#version 300 es',
    'precision highp float;',
    'out vec4 fragColor;',

    'uniform vec2  uRes;',
    'uniform vec2  uJitter;',
    'uniform vec3  uCamPos;',
    'uniform mat3  uBasis;',
    'uniform float uTanHalf;',
    'uniform float uTime;',
    'uniform float uEscape;',
    'uniform int   uSteps;',
    'uniform float uLens;',
    'uniform float uDiskIn;',
    'uniform float uDiskOut;',
    'uniform float uDiskOn;',
    'uniform float uDiskDens;',
    'uniform float uDiskBright;',
    'uniform float uDiskThick;',
    'uniform float uDiskTemp;',
    'uniform float uSpin;',
    'uniform float uDoppler;',
    'uniform float uGrav;',
    'uniform float uStarB;',
    'uniform float uNebB;',
    'uniform int   uProbeN;',
    'uniform vec4  uProbes[8];',

    LIB,

    /* ------------------------------------------------ 恒星层 ------------- */
    'vec3 starLayer(vec3 d, float scale, float off, float thr, float sharp, float boost){',
    '  vec3 ofs = vec3(off, off * 1.73, off * 0.41);',
    '  vec3 pp  = d * scale + ofs;',
    '  vec3 id  = floor(pp);',
    '  vec3 rnd = hash33(id);',
    '  if (rnd.z > thr) return vec3(0.0);',
    '  vec3 sp = id + 0.5 + (hash33(id + 19.7) - 0.5) * 0.9;',
    '  vec3 sd = normalize(sp - ofs);',
    '  float a = length(d - sd) * scale;',
    '  float core = exp(-a * a * sharp);',
    '  float glow = exp(-a * a * 14.0) * 0.085;',
    '  float mag  = pow(rnd.x, 4.0) * 3.2 + 0.05;',
    '  float T    = mix(2300.0, 15500.0, pow(rnd.y, 1.7));',
    '  return blackbody(T) * ((core + glow) * mag * boost);',
    '}',

    /* ------------------------------------------------ 背景天空 ----------- */
    'vec3 background(vec3 d){',
    '  vec3 col = vec3(0.0);',
    '  if (uNebB > 0.001){',
    '    float n1 = fbm(d * 2.6 + 11.0, 5);',
    '    float n2 = fbm(d * 6.9 -  3.0, 4);',
    '    vec3  pole = normalize(vec3(0.34, 0.86, 0.38));',
    '    float bx   = dot(d, pole) / 0.30;',
    '    float band = exp(-bx * bx);',
    '    vec3  neb  = mix(vec3(0.045, 0.085, 0.26), vec3(0.34, 0.11, 0.30), n1);',
    '    neb += vec3(0.20, 0.10, 0.03) * pow(n2, 2.2);',
    '    col += neb * (band * 0.95 + 0.09) * pow(n1, 1.7) * uNebB;',
    '    col += vec3(0.55, 0.63, 0.85) * band * pow(n2, 3.0) * 0.085 * uNebB;',
    '  }',
    '  if (uStarB > 0.001){',
    '    col += starLayer(d,  52.0,  0.0, 0.32,  240.0, 1.00) * uStarB;',
    '    col += starLayer(d, 118.0, 13.3, 0.24,  900.0, 0.70) * uStarB;',
    '    col += starLayer(d, 245.0, 57.1, 0.17, 3200.0, 0.45) * uStarB;',
    '  }',
    '  return col;',
    '}',

    /* ------------------------------------------------ 吸积盘 ------------- */
    'vec3 diskEmit(vec3 pos, vec3 dirN, out float alpha){',
    '  alpha = 0.0;',
    '  float r = length(pos);',
    '  if (r < uDiskIn || r > uDiskOut) return vec3(0.0);',
    '  float t = (r - uDiskIn) / max(uDiskOut - uDiskIn, 1e-3);',
    '  float shape = smoothstep(0.0, 0.085, t) * (1.0 - smoothstep(0.30, 1.0, t));',

    // 开普勒较差转动：把采样坐标反向旋转 Ω(r)·t，使内圈转得更快
    '  float om = uSpin * 1.35 * pow(max(r, 1.05), -1.5);',
    '  float ang = uTime * om;',
    '  float c = cos(ang), s = sin(ang);',
    '  vec2 q = mat2(c, s, -s, c) * pos.xz;',
    '  vec3 sp = vec3(q.x, pos.y * 3.0, q.y);',

    '  float n1  = fbm(sp * 0.62, 5);',
    '  float n2  = fbm(sp * vec3(0.22, 1.0, 0.22) + 17.0, 3);',
    '  float fil = 1.0 - abs(2.0 * fbm(sp * 1.85 + 5.0, 3) - 1.0);',
    '  float dens = shape * (0.30 + 1.55 * pow(n1, 1.6)) * (0.55 + 0.90 * n2) * (0.60 + 0.72 * fil);',
    '  dens *= mix(1.0, 3.2, exp(-3.4 * t));',
    '  dens *= uDiskDens;',

    // 光学薄薄盘：斜程长度 = H / |cosθ|
    '  float H    = uDiskThick * (0.09 + 0.05 * r);',
    '  float path = min(H / max(abs(dirN.y), 0.012), 20.0 * H);',
    '  alpha = 1.0 - exp(-dens * path * 2.0);',

    // ---- 多普勒集束 + 引力红移 ----
    '  vec3  tang = normalize(vec3(pos.z, 0.0, -pos.x));',
    '  float beta = min(sqrt(0.5 / r), 0.72) * clamp(uSpin, 0.0, 1.4);',
    '  vec3  nObs = -dirN;',
    '  float gam  = inversesqrt(max(1.0 - beta * beta, 1e-3));',
    '  float delta = 1.0 / (gam * (1.0 - dot(tang * beta, nObs)));',
    '  delta = mix(1.0, delta, uDoppler);',
    '  float grav = sqrt(max(1.0 - 1.0 / max(r, 1.001), 1e-3));',
    '  grav = mix(1.0, grav, uGrav);',
    '  float shift = clamp(delta * grav, 0.18, 3.2);',

    '  float Te = uDiskTemp * pow(uDiskIn / r, 0.72);',
    '  vec3  cc = blackbody(Te * shift);',
    // 面亮度 ∝ T⁴ ∝ r⁻³（Shakura–Sunyaev），故内环极亮、外缘迅速黯淡
    '  float emis = pow(uDiskIn / r, 2.7) * (0.45 + 0.95 * n1);',
    '  return cc * (emis * pow(shift, 3.0) * uDiskBright * 4.5);',
    '}',

    /* ------------------------------------------------ 主函数 ------------- */
    'void main(){',
    '  vec2 sc = (gl_FragCoord.xy + uJitter - 0.5 * uRes) / uRes.y;',
    '  vec3 rd = normalize(uBasis * vec3(sc * 2.0 * uTanHalf, 1.0));',

    '  vec3 p = uCamPos;',
    '  vec3 v = rd;',
    '  vec3 hv = cross(p, v);',
    '  float h2 = dot(hv, hv) * uLens;',

    '  vec3  col = vec3(0.0);',
    '  float trans = 1.0;',
    '  bool  captured = false;',

    '  for (int i = 0; i < 900; i++){',
    '    if (i >= uSteps) break;',
    '    float r = length(p);',
    '    if (r < 1.0){ captured = true; break; }',
    '    if (r > uEscape && dot(p, v) > 0.0) break;',

    '    float sp = length(v);',
    '    float dl = clamp(0.055 * (r - 0.96), 0.0055, 0.55) / max(sp, 1e-3);',

    // 中点法积分（RK2）
    '    float ir5 = 1.0 / (r * r * r * r * r);',
    '    vec3 a1 = -1.5 * h2 * p * ir5;',
    '    vec3 pm = p + v * (dl * 0.5);',
    '    vec3 vm = v + a1 * (dl * 0.5);',
    '    float rm = max(length(pm), 0.25);',
    '    float im5 = 1.0 / (rm * rm * rm * rm * rm);',
    '    vec3 a2 = -1.5 * h2 * pm * im5;',
    '    vec3 pn = p + vm * dl;',
    '    vec3 vn = v + a2 * dl;',

    // ---- 探针（被正确透镜化的发光测试粒子）----
    '    if (uProbeN > 0){',
    '      vec3 seg = pn - p;',
    '      float sl2 = max(dot(seg, seg), 1e-8);',
    '      float sl  = sqrt(sl2);',
    '      for (int k = 0; k < 8; k++){',
    '        if (k >= uProbeN) break;',
    '        vec3 w = uProbes[k].xyz - p;',
    '        float tt = clamp(dot(w, seg) / sl2, 0.0, 1.0);',
    '        vec3 dv = w - seg * tt;',
    '        float kk = 0.0022 / (0.0022 + dot(dv, dv));',
    '        col += trans * uProbes[k].w * vec3(0.72, 0.88, 1.0) * (kk * kk * kk) * sl * 11.0;',
    '      }',
    '    }',

    // ---- 吸积盘平面穿越 ----
    '    if (uDiskOn > 0.5 && p.y * pn.y < 0.0){',
    '      float f = p.y / (p.y - pn.y);',
    '      vec3 hit = p + (pn - p) * f;',
    '      vec3 hd  = normalize(v + (vn - v) * f);',
    '      float a;',
    '      vec3 e = diskEmit(hit, hd, a);',
    '      col += trans * e * a;',
    '      trans *= (1.0 - a);',
    '      if (trans < 0.0035) break;',
    '    }',

    '    p = pn; v = vn;',
    '  }',

    '  vec3 bg = captured ? vec3(0.0) : background(normalize(v));',
    '  col += trans * bg;',
    '  fragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  // ---------------------------------------------------------- 时间累积
  var FS_ACCUM = [
    '#version 300 es', 'precision highp float;',
    'uniform sampler2D uPrev; uniform sampler2D uCur; uniform float uW; uniform vec2 uRes;',
    'out vec4 fragColor;',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / uRes;',
    '  vec3 a = texture(uPrev, uv).rgb;',
    '  vec3 b = texture(uCur , uv).rgb;',
    '  fragColor = vec4(mix(a, b, uW), 1.0);',
    '}'
  ].join('\n');

  // ---------------------------------------------------------- 亮部提取 + 降采样
  var FS_BRIGHT = [
    '#version 300 es', 'precision highp float;',
    'uniform sampler2D uTex; uniform vec2 uTexel; uniform float uThr; uniform vec2 uRes;',
    'out vec4 fragColor;',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / uRes;',
    '  vec3 s = texture(uTex, uv + uTexel * vec2(-1,-1)).rgb',
    '         + texture(uTex, uv + uTexel * vec2( 1,-1)).rgb',
    '         + texture(uTex, uv + uTexel * vec2(-1, 1)).rgb',
    '         + texture(uTex, uv + uTexel * vec2( 1, 1)).rgb;',
    '  s *= 0.25;',
    '  float l = max(s.r, max(s.g, s.b));',
    '  float k = max(l - uThr, 0.0) / max(l, 1e-4);',
    '  fragColor = vec4(s * k, 1.0);',
    '}'
  ].join('\n');

  // ---------------------------------------------------------- 高斯模糊 / 降采样
  var FS_BLUR = [
    '#version 300 es', 'precision highp float;',
    'uniform sampler2D uTex; uniform vec2 uTexel; uniform vec2 uDir; uniform vec2 uRes;',
    'out vec4 fragColor;',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / uRes;',
    '  vec2 o1 = uDir * uTexel * 1.3846153846;',
    '  vec2 o2 = uDir * uTexel * 3.2307692308;',
    '  vec3 c = texture(uTex, uv).rgb * 0.2270270270;',
    '  c += (texture(uTex, uv + o1).rgb + texture(uTex, uv - o1).rgb) * 0.3162162162;',
    '  c += (texture(uTex, uv + o2).rgb + texture(uTex, uv - o2).rgb) * 0.0702702703;',
    '  fragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  var FS_DOWN = [
    '#version 300 es', 'precision highp float;',
    'uniform sampler2D uTex; uniform vec2 uTexel; uniform vec2 uRes;',
    'out vec4 fragColor;',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / uRes;',
    '  vec3 s = texture(uTex, uv + uTexel * vec2(-1,-1)).rgb',
    '         + texture(uTex, uv + uTexel * vec2( 1,-1)).rgb',
    '         + texture(uTex, uv + uTexel * vec2(-1, 1)).rgb',
    '         + texture(uTex, uv + uTexel * vec2( 1, 1)).rgb;',
    '  fragColor = vec4(s * 0.25, 1.0);',
    '}'
  ].join('\n');

  // ---------------------------------------------------------- 合成 / 色调映射
  var FS_POST = [
    '#version 300 es', 'precision highp float;',
    'uniform sampler2D uScene, uB0, uB1, uB2;',
    'uniform vec2  uRes;',
    'uniform float uExposure, uBloom, uCA, uVig, uGrain, uSeed;',
    'out vec4 fragColor;',
    'vec3 aces(vec3 x){',
    '  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);',
    '}',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / uRes;',
    '  vec2 d  = uv - 0.5;',
    '  float rr = dot(d, d);',
    // 径向色散
    '  vec2 off = d * rr * uCA * 0.035;',
    '  vec3 c;',
    '  c.r = texture(uScene, uv + off).r;',
    '  c.g = texture(uScene, uv).g;',
    '  c.b = texture(uScene, uv - off).b;',
    '  vec3 bl = texture(uB0, uv).rgb * 0.55',
    '          + texture(uB1, uv).rgb * 0.34',
    '          + texture(uB2, uv).rgb * 0.22;',
    '  c += bl * uBloom;',
    '  c *= uExposure;',
    '  c = aces(c);',
    '  c = pow(c, vec3(1.0 / 2.2));',
    '  c *= 1.0 - uVig * smoothstep(0.06, 0.78, rr);',
    '  float g = fract(sin(dot(gl_FragCoord.xy + uSeed, vec2(12.9898, 78.233))) * 43758.5453);',
    '  c += (g - 0.5) * uGrain * 0.055;',
    '  fragColor = vec4(max(c, 0.0), 1.0);',
    '}'
  ].join('\n');

  /* ==========================================================================
     GL 辅助
     ====================================================================== */
  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(s) || '';
      var lines = src.split('\n');
      var num = lines.map(function (l, i) { return (i + 1) + ': ' + l; });
      var m = /:(\d+):/.exec(log);
      var ctx = '';
      if (m) {
        var n = parseInt(m[1], 10);
        ctx = '\n\n' + num.slice(Math.max(0, n - 6), n + 5).join('\n');
      }
      throw new Error('着色器编译失败:\n' + log + ctx);
    }
    return s;
  }
  function program(fsSrc) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('着色器链接失败:\n' + gl.getProgramInfoLog(p));
    }
    p._u = {};
    return p;
  }
  function U(p, name) {
    if (!(name in p._u)) p._u[name] = gl.getUniformLocation(p, name);
    return p._u[name];
  }

  function makeTarget(w, h) {
    var t = { w: w, h: h };
    t.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, TEX_IF, w, h, 0, gl.RGBA, TEX_TY, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    t.fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('帧缓冲不完整 (' + w + '×' + h + ')');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return t;
  }
  function freeTarget(t) {
    if (!t) return;
    gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb);
  }
  function bindTo(t) {
    if (t) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.viewport(0, 0, t.w, t.h); }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height); }
  }
  function unit(i, tex) {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }
  function draw() { gl.drawArrays(gl.TRIANGLES, 0, 3); }

  // ---------------------------------------------------------------- 程序
  var pScene, pAccum, pBright, pBlur, pDown, pPost;
  try {
    pScene  = program(FS_SCENE);
    pAccum  = program(FS_ACCUM);
    pBright = program(FS_BRIGHT);
    pBlur   = program(FS_BLUR);
    pDown   = program(FS_DOWN);
    pPost   = program(FS_POST);
  } catch (e) { fatal(e.message || e); return; }

  gl.bindVertexArray(gl.createVertexArray());
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);

  /* ==========================================================================
     参数绑定
     ====================================================================== */
  var P = {}, DEF = {}, els = {};
  function fmtOut(el) {
    var out = document.querySelector('[data-out="' + el.dataset.param + '"]');
    if (!out) return;
    if (el.type === 'checkbox') { out.textContent = el.checked ? '开' : '关'; return; }
    var dg = el.dataset.digits !== undefined ? +el.dataset.digits : 2;
    out.textContent = (+el.value).toFixed(dg) + (el.dataset.suffix || '');
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-param]'), function (el) {
    var k = el.dataset.param;
    els[k] = el;
    var read = function () {
      return el.type === 'checkbox' ? (el.checked ? 1 : 0) : parseFloat(el.value);
    };
    P[k] = read(); DEF[k] = P[k];
    el.addEventListener('input', function () {
      P[k] = read(); fmtOut(el); onChange(k);
    });
    fmtOut(el);
  });
  function setParam(k, val) {
    var el = els[k]; if (!el) return;
    if (el.type === 'checkbox') { el.checked = !!val; P[k] = val ? 1 : 0; }
    else { el.value = val; P[k] = parseFloat(el.value); }
    fmtOut(el); onChange(k);
  }
  function onChange(k) {
    if (k === 'scale') resize(true);
    dirty = true;
  }

  /* ==========================================================================
     状态
     ====================================================================== */
  var cam = { yaw: 0.75, pitch: P.pitch * Math.PI / 180, dist: P.dist };
  var simTime = 12.0, paused = false, dirty = true, accum = 1;
  var frame = 0, shot = false;
  var scene = null, accA = null, accB = null, bloomA = [], bloomB = [];
  var rw = 0, rh = 0;
  var probes = [], probeBuf = new Float32Array(32);

  // Halton 抖动序列（保证累积采样均匀）
  function halton(i, b) { var f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }
  var JIT = [];
  for (var ji = 1; ji <= 64; ji++) JIT.push([halton(ji, 2) - 0.5, halton(ji, 3) - 0.5]);

  /* ==========================================================================
     尺寸
     ====================================================================== */
  function resize(force) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cw = Math.max(2, Math.round(canvas.clientWidth * dpr));
    var ch = Math.max(2, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; force = true; }
    var nw = Math.max(2, Math.round(cw * P.scale));
    var nh = Math.max(2, Math.round(ch * P.scale));
    if (!force && nw === rw && nh === rh) return;
    rw = nw; rh = nh;

    freeTarget(scene); freeTarget(accA); freeTarget(accB);
    bloomA.forEach(freeTarget); bloomB.forEach(freeTarget);
    bloomA = []; bloomB = [];
    try {
      scene = makeTarget(rw, rh);
      accA = makeTarget(rw, rh);
      accB = makeTarget(rw, rh);
      for (var i = 0; i < 3; i++) {
        var w = Math.max(2, rw >> (i + 1)), h = Math.max(2, rh >> (i + 1));
        bloomA.push(makeTarget(w, h));
        bloomB.push(makeTarget(w, h));
      }
    } catch (e) { fatal(e.message || e); return; }
    dirty = true;
    var hr = $('#hRes'); if (hr) hr.textContent = rw + '×' + rh;
  }
  window.addEventListener('resize', function () { resize(false); });

  /* ==========================================================================
     探针（时间类测地线：a = -(M/r³ + 3M h²/r⁵) x ）
     3M h²/r⁵ 项即近日点进动的来源；角动量过小者会直接落入视界。
     ====================================================================== */
  var PROBE_SPEED = 6.0;   // 轨道演化加速倍率（纯观赏）

  function addProbe() {
    if (probes.length >= 8) probes.shift();
    var r = 4.6 + Math.random() * 5.6;
    var a = Math.random() * Math.PI * 2;
    var inc = (Math.random() - 0.5) * 0.7;
    var pos = [r * Math.cos(a), r * Math.sin(inc) * 0.85, r * Math.sin(a)];
    var rr = Math.hypot(pos[0], pos[1], pos[2]);
    // 切向 + 少量径向/垂向扰动 → 进动椭圆轨道，部分最终落入视界
    var t = [pos[2], 0, -pos[0]];
    var tl = Math.hypot(t[0], t[1], t[2]) || 1;
    var vc = Math.sqrt(0.5 / rr) * (0.68 + Math.random() * 0.36);
    var sgn = Math.random() < 0.5 ? -1 : 1;
    var vel = [sgn * t[0] / tl * vc, (Math.random() - 0.5) * vc * 0.4, sgn * t[2] / tl * vc];
    probes.push({ p: pos, v: vel, life: 0, fade: 0, dead: false });
    dirty = true;
  }

  function stepProbes(dtRaw) {
    if (!probes.length) return;
    var dt = dtRaw * PROBE_SPEED;
    var M = 0.5;
    var n = Math.min(400, Math.max(4, Math.ceil(dt / 0.004)));
    var h = dt / n;
    for (var i = probes.length - 1; i >= 0; i--) {
      var q = probes[i];
      q.life += dt;
      q.fade = q.dead ? Math.max(0, q.fade - dtRaw * 4.0)
                      : Math.min(1, q.fade + dtRaw * 3.0);
      if (q.dead && q.fade <= 0.001) { probes.splice(i, 1); continue; }
      if (q.dead) continue;
      for (var s = 0; s < n; s++) {
        var x = q.p, v = q.v;
        var r = Math.hypot(x[0], x[1], x[2]);
        if (r < 1.02 || r > 240) { q.dead = true; break; }
        // h² = |x × v|²（运动常数，每步重算以抑制漂移）
        var cx = x[1] * v[2] - x[2] * v[1],
            cy = x[2] * v[0] - x[0] * v[2],
            cz = x[0] * v[1] - x[1] * v[0];
        var h2 = cx * cx + cy * cy + cz * cz;
        var r3 = r * r * r, r5 = r3 * r * r;
        var k = -(M / r3 + 3 * M * h2 / r5);
        // 速度 Verlet
        var hv = [v[0] + k * x[0] * h * 0.5, v[1] + k * x[1] * h * 0.5, v[2] + k * x[2] * h * 0.5];
        q.p = [x[0] + hv[0] * h, x[1] + hv[1] * h, x[2] + hv[2] * h];
        var nr = Math.hypot(q.p[0], q.p[1], q.p[2]) || 1;
        var nr3 = nr * nr * nr, nr5 = nr3 * nr * nr;
        var k2 = -(M / nr3 + 3 * M * h2 / nr5);
        q.v = [hv[0] + k2 * q.p[0] * h * 0.5, hv[1] + k2 * q.p[1] * h * 0.5, hv[2] + k2 * q.p[2] * h * 0.5];
      }
    }
    dirty = true;
  }

  /* ==========================================================================
     渲染
     ====================================================================== */
  var lastT = performance.now(), fpsAcc = 0, fpsN = 0, frameMs = 16;

  function render(now) {
    requestAnimationFrame(render);
    var dt = Math.min((now - lastT) / 1000, 0.1);
    lastT = now;
    if (!scene) { resize(true); if (!scene) return; }

    /* ------------------------------- 相机 / 时间 ------------------------ */
    if (P.autorot > 0.5 && !paused) { cam.yaw += dt * P.rotspeed * 0.35; dirty = true; }
    if (!paused && P.timescale > 0) {
      simTime += dt * P.timescale;
      stepProbes(dt * P.timescale);
      dirty = true;
    }
    // 面板 ↔ 相机 同步
    if (Math.abs(cam.dist - P.dist) > 1e-4) { cam.dist = P.dist; dirty = true; }
    var wantPitch = P.pitch * Math.PI / 180;
    if (Math.abs(cam.pitch - wantPitch) > 1e-5) { cam.pitch = wantPitch; dirty = true; }

    var cp = Math.cos(cam.pitch), sp2 = Math.sin(cam.pitch);
    var camPos = [cam.dist * cp * Math.sin(cam.yaw), cam.dist * sp2, cam.dist * cp * Math.cos(cam.yaw)];
    var fwd = norm([-camPos[0], -camPos[1], -camPos[2]]);
    var right = norm(cross(fwd, [0, 1, 0]));
    if (!isFinite(right[0])) right = [1, 0, 0];
    var up = cross(right, fwd);

    /* ------------------------------- 累积计数 -------------------------- */
    if (dirty) { accum = 1; dirty = false; } else { accum = Math.min(accum + 1, 512); }
    frame++;

    /* ------------------------------- 场景 ------------------------------ */
    var jt = JIT[frame % JIT.length];
    bindTo(scene);
    gl.useProgram(pScene);
    gl.uniform2f(U(pScene, 'uRes'), rw, rh);
    gl.uniform2f(U(pScene, 'uJitter'), jt[0], jt[1]);
    gl.uniform3f(U(pScene, 'uCamPos'), camPos[0], camPos[1], camPos[2]);
    gl.uniformMatrix3fv(U(pScene, 'uBasis'), false, [
      right[0], right[1], right[2],
      up[0], up[1], up[2],
      fwd[0], fwd[1], fwd[2]
    ]);
    gl.uniform1f(U(pScene, 'uTanHalf'), Math.tan(P.fov * Math.PI / 360));
    gl.uniform1f(U(pScene, 'uTime'), simTime);
    gl.uniform1f(U(pScene, 'uEscape'), Math.max(P.diskOut * 1.35, cam.dist * 1.2) + 4.0);
    gl.uniform1i(U(pScene, 'uSteps'), Math.round(P.steps));
    gl.uniform1f(U(pScene, 'uLens'), P.lens);
    gl.uniform1f(U(pScene, 'uDiskIn'), Math.min(P.diskIn, P.diskOut - 0.5));
    gl.uniform1f(U(pScene, 'uDiskOut'), P.diskOut);
    gl.uniform1f(U(pScene, 'uDiskOn'), P.diskBright > 0.001 && P.diskDens > 0.001 ? 1 : 0);
    gl.uniform1f(U(pScene, 'uDiskDens'), P.diskDens);
    gl.uniform1f(U(pScene, 'uDiskBright'), P.diskBright);
    gl.uniform1f(U(pScene, 'uDiskThick'), P.diskThick);
    gl.uniform1f(U(pScene, 'uDiskTemp'), P.diskTemp);
    gl.uniform1f(U(pScene, 'uSpin'), P.spin);
    gl.uniform1f(U(pScene, 'uDoppler'), P.doppler);
    gl.uniform1f(U(pScene, 'uGrav'), P.grav);
    gl.uniform1f(U(pScene, 'uStarB'), P.starB);
    gl.uniform1f(U(pScene, 'uNebB'), P.nebB);
    var pn = 0;
    for (var i = 0; i < probes.length && pn < 8; i++) {
      var q = probes[i];
      if (q.fade <= 0.002) continue;
      probeBuf[pn * 4] = q.p[0]; probeBuf[pn * 4 + 1] = q.p[1];
      probeBuf[pn * 4 + 2] = q.p[2]; probeBuf[pn * 4 + 3] = q.fade;
      pn++;
    }
    gl.uniform1i(U(pScene, 'uProbeN'), pn);
    if (pn > 0) gl.uniform4fv(U(pScene, 'uProbes'), probeBuf);
    draw();

    /* ------------------------------- 累积 ------------------------------ */
    // accA = 上一帧累积结果（历史），accB = 本帧写入目标，之后互换
    bindTo(accB);
    gl.useProgram(pAccum);
    unit(0, accum > 1 ? accA.tex : scene.tex);
    unit(1, scene.tex);
    gl.uniform1i(U(pAccum, 'uPrev'), 0);
    gl.uniform1i(U(pAccum, 'uCur'), 1);
    gl.uniform1f(U(pAccum, 'uW'), 1.0 / accum);
    gl.uniform2f(U(pAccum, 'uRes'), rw, rh);
    draw();
    var swp = accA; accA = accB; accB = swp;
    var hdrTex = accA.tex;

    /* ------------------------------- 泛光 ------------------------------ */
    if (P.bloom > 0.001) {
      bindTo(bloomA[0]);
      gl.useProgram(pBright);
      unit(0, hdrTex);
      gl.uniform1i(U(pBright, 'uTex'), 0);
      gl.uniform2f(U(pBright, 'uTexel'), 1 / rw, 1 / rh);
      gl.uniform2f(U(pBright, 'uRes'), bloomA[0].w, bloomA[0].h);
      gl.uniform1f(U(pBright, 'uThr'), P.bloomThr);
      draw();
      for (var L = 0; L < 3; L++) {
        if (L > 0) {
          bindTo(bloomA[L]);
          gl.useProgram(pDown);
          unit(0, bloomA[L - 1].tex);
          gl.uniform1i(U(pDown, 'uTex'), 0);
          gl.uniform2f(U(pDown, 'uTexel'), 1 / bloomA[L - 1].w, 1 / bloomA[L - 1].h);
          gl.uniform2f(U(pDown, 'uRes'), bloomA[L].w, bloomA[L].h);
          draw();
        }
        gl.useProgram(pBlur);
        gl.uniform1i(U(pBlur, 'uTex'), 0);
        bindTo(bloomB[L]);
        unit(0, bloomA[L].tex);
        gl.uniform2f(U(pBlur, 'uTexel'), 1 / bloomA[L].w, 1 / bloomA[L].h);
        gl.uniform2f(U(pBlur, 'uRes'), bloomB[L].w, bloomB[L].h);
        gl.uniform2f(U(pBlur, 'uDir'), 1, 0);
        draw();
        bindTo(bloomA[L]);
        unit(0, bloomB[L].tex);
        gl.uniform2f(U(pBlur, 'uTexel'), 1 / bloomB[L].w, 1 / bloomB[L].h);
        gl.uniform2f(U(pBlur, 'uRes'), bloomA[L].w, bloomA[L].h);
        gl.uniform2f(U(pBlur, 'uDir'), 0, 1);
        draw();
      }
    }

    /* ------------------------------- 合成 ------------------------------ */
    bindTo(null);
    gl.useProgram(pPost);
    unit(0, hdrTex);
    unit(1, bloomA[0].tex); unit(2, bloomA[1].tex); unit(3, bloomA[2].tex);
    gl.uniform1i(U(pPost, 'uScene'), 0);
    gl.uniform1i(U(pPost, 'uB0'), 1);
    gl.uniform1i(U(pPost, 'uB1'), 2);
    gl.uniform1i(U(pPost, 'uB2'), 3);
    gl.uniform2f(U(pPost, 'uRes'), canvas.width, canvas.height);
    gl.uniform1f(U(pPost, 'uExposure'), P.exposure);
    gl.uniform1f(U(pPost, 'uBloom'), P.bloom > 0.001 ? P.bloom : 0);
    gl.uniform1f(U(pPost, 'uCA'), P.ca);
    gl.uniform1f(U(pPost, 'uVig'), P.vig);
    gl.uniform1f(U(pPost, 'uGrain'), P.grain);
    gl.uniform1f(U(pPost, 'uSeed'), accum > 2 ? 0 : (frame % 512));
    draw();

    if (shot) { shot = false; saveShot(); }

    /* ------------------------------- 统计 / 自适应 --------------------- */
    frameMs += ((now - (render._prev || now)) - frameMs) * 0.1;
    render._prev = now;
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) {
      var fps = fpsN / fpsAcc;
      $('#hFps').textContent = fps.toFixed(0);
      $('#hAcc').textContent = accum + '×';
      $('#hProbe').textContent = String(probes.length);
      fpsAcc = 0; fpsN = 0;
      if (P.adaptive > 0.5 && accum < 3) {
        if (fps < 26 && P.scale > 0.42) setParam('scale', Math.max(0.4, +(P.scale - 0.08).toFixed(2)));
        else if (fps > 57 && P.scale < 0.995) setParam('scale', Math.min(1, +(P.scale + 0.04).toFixed(2)));
      }
    }
  }

  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  function saveShot() {
    try {
      canvas.toBlob(function (b) {
        if (!b) return;
        var a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = 'blackhole-' + Date.now() + '.png';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      }, 'image/png');
    } catch (e) { console.warn(e); }
  }

  /* ==========================================================================
     交互
     ====================================================================== */
  var ptrs = new Map(), pinch = 0;
  canvas.addEventListener('pointerdown', function (e) {
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    document.body.classList.add('dragging');
    hideHint();
  });
  canvas.addEventListener('pointermove', function (e) {
    var p0 = ptrs.get(e.pointerId); if (!p0) return;
    var dx = e.clientX - p0.x, dy = e.clientY - p0.y;
    p0.x = e.clientX; p0.y = e.clientY;
    if (ptrs.size >= 2) {
      var it = ptrs.values(), a = it.next().value, b = it.next().value;
      var d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && d > 1) setParam('dist', clamp(P.dist * (pinch / d), 3.5, 70).toFixed(2));
      pinch = d;
      return;
    }
    cam.yaw -= dx * 0.0055;
    setParam('pitch', clamp(P.pitch + dy * 0.28, -88, 88).toFixed(1));
    if (P.autorot > 0.5) setParam('autorot', 0);
    dirty = true;
  });
  function endPtr(e) {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = 0;
    if (!ptrs.size) document.body.classList.remove('dragging');
  }
  canvas.addEventListener('pointerup', endPtr);
  canvas.addEventListener('pointercancel', endPtr);
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var f = Math.exp(e.deltaY * 0.0012);
    setParam('dist', clamp(P.dist * f, 3.5, 70).toFixed(2));
    hideHint();
  }, { passive: false });
  canvas.addEventListener('dblclick', addProbe);

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  window.addEventListener('keydown', function (e) {
    if (/input|select|textarea/i.test((e.target && e.target.tagName) || '')) return;
    var k = e.key.toLowerCase();
    if (k === 'h') document.body.classList.toggle('hideui');
    else if (k === ' ') { e.preventDefault(); togglePause(); }
    else if (k === 's') shot = true;
    else if (k === 'r') doReset();
    else if (k === 'p') addProbe();
    else if (k === 'f') toggleFull();
  });

  function togglePause() {
    paused = !paused;
    $('#btnPause').textContent = paused ? '继续' : '暂停';
    $('#btnPause').classList.toggle('on', paused);
    dirty = true;
  }
  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(function () {});
  }
  function doReset() {
    Object.keys(DEF).forEach(function (k) { setParam(k, DEF[k]); });
    cam.yaw = 0.75; simTime = 12; probes.length = 0;
    if (paused) togglePause();
    addProbe();
    dirty = true;
  }

  $('#btnPause').addEventListener('click', togglePause);
  $('#btnShot').addEventListener('click', function () { shot = true; });
  $('#btnReset').addEventListener('click', doReset);
  $('#btnFull').addEventListener('click', toggleFull);
  $('#btnProbe').addEventListener('click', addProbe);
  $('#btnCollapse').addEventListener('click', function () {
    var p = $('#panel'); p.classList.toggle('collapsed');
    this.textContent = p.classList.contains('collapsed') ? '+' : '—';
  });

  /* ------------------------------------------------------------ 预设 */
  var PRESETS = {
    interstellar: { dist: 27, pitch: 6, fov: 39, diskIn: 3, diskOut: 15, diskBright: 1.05, diskDens: 1.1,
                    diskThick: 0.5, diskTemp: 10500, spin: 1, doppler: 0.55, grav: 1, lens: 1,
                    starB: 1, nebB: 0.5, exposure: 1.05, bloom: 0.9, bloomThr: 0.8, ca: 0.4, vig: 0.5 },
    edge:         { dist: 20, pitch: 1.5, fov: 50, diskIn: 3, diskOut: 16, diskBright: 1.25, diskDens: 1.4,
                    diskThick: 0.35, diskTemp: 12500, spin: 1.1, doppler: 1, grav: 1, lens: 1,
                    exposure: 0.95, bloom: 1.1, bloomThr: 0.9, ca: 0.6, vig: 0.6 },
    top:          { dist: 34, pitch: 62, fov: 46, diskIn: 3, diskOut: 21, diskBright: 1.1, diskDens: 1.0,
                    diskThick: 0.8, diskTemp: 9500, spin: 1, doppler: 1, grav: 1, lens: 1,
                    exposure: 1.2, bloom: 0.8, bloomThr: 0.85, ca: 0.3, vig: 0.45 },
    pure:         { dist: 12, pitch: 14, fov: 55, diskBright: 0, starB: 1.7, nebB: 1.0,
                    lens: 1, exposure: 1.5, bloom: 0.55, bloomThr: 0.7, ca: 0.35, vig: 0.55 },
    inferno:      { dist: 11, pitch: 4, fov: 62, diskIn: 2.2, diskOut: 11, diskBright: 1.9, diskDens: 1.9,
                    diskThick: 0.9, diskTemp: 17000, spin: 1.35, doppler: 1, grav: 1, lens: 1,
                    exposure: 0.8, bloom: 1.5, bloomThr: 1.1, ca: 0.9, vig: 0.7, grain: 0.35 },
    flat:         { lens: 0, dist: 26, pitch: 7, doppler: 0, grav: 0, diskBright: 1.0, exposure: 1.05 }
  };
  Array.prototype.forEach.call(document.querySelectorAll('[data-preset]'), function (b) {
    b.addEventListener('click', function () {
      var s = PRESETS[b.dataset.preset]; if (!s) return;
      Object.keys(s).forEach(function (k) { setParam(k, s[k]); });
      dirty = true;
    });
  });

  /* ------------------------------------------------- 彩蛋：吞噬界面 */
  var devoured = [];
  $('#btnDevour').addEventListener('click', function () {
    if (devoured.length) return;
    var items = [$('#panel'), $('#brand'), $('#hud'), $('#hint')].filter(Boolean);
    var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    items.forEach(function (el) {
      var r = el.getBoundingClientRect();
      var ox = r.left + r.width / 2 - cx, oy = r.top + r.height / 2 - cy;
      devoured.push({ el: el, r0: Math.hypot(ox, oy), a0: Math.atan2(oy, ox) });
      el.style.transition = 'none';
      el.style.pointerEvents = 'none';
    });
    var t0 = performance.now(), DUR = 1750;
    (function spin(t) {
      var k = Math.min((t - t0) / DUR, 1);
      var e = k * k * (3 - 2 * k);
      devoured.forEach(function (d) {
        var r = d.r0 * Math.pow(1 - e, 1.7);
        var a = d.a0 + e * 6.4;
        var x = Math.cos(a) * r - Math.cos(d.a0) * d.r0;
        var y = Math.sin(a) * r - Math.sin(d.a0) * d.r0;
        d.el.style.transform = 'translate(' + x + 'px,' + y + 'px) rotate(' + (e * 640) +
          'deg) scale(' + Math.max(0.001, Math.pow(1 - e, 0.85)) + ')';
        d.el.style.opacity = String(Math.max(0, 1 - e * e * 1.15));
        d.el.style.filter = 'blur(' + (e * 7).toFixed(2) + 'px)';
      });
      if (k < 1) requestAnimationFrame(spin);
      else {
        devoured.forEach(function (d) { d.el.style.visibility = 'hidden'; });
        $('#restore').hidden = false;
      }
    })(t0);
  });
  $('#restore').addEventListener('click', function () {
    devoured.forEach(function (d) {
      d.el.style.transition = 'transform .9s cubic-bezier(.16,1,.3,1),opacity .7s ease,filter .7s ease';
      d.el.style.visibility = '';
      d.el.style.transform = ''; d.el.style.opacity = ''; d.el.style.filter = '';
      d.el.style.pointerEvents = '';
    });
    devoured.length = 0;
    this.hidden = true;
  });

  /* ------------------------------------------------------------ 开场 */
  var hintEl = $('#hint'), hintHidden = false;
  function hideHint() {
    if (hintHidden) return; hintHidden = true;
    if (hintEl) hintEl.style.opacity = '0';
  }
  setTimeout(hideHint, 11000);
  setTimeout(function () { $('#intro').classList.add('gone'); }, 1100);
  setTimeout(function () { var i = $('#intro'); if (i && i.parentNode) i.parentNode.removeChild(i); }, 2600);

  /* ------------------------------------------------------------ 启动 */
  resize(true);
  if (scene) {
    addProbe();
    requestAnimationFrame(render);
  }
})();
