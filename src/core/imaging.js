/* 光野 · 影像管线
 *
 * 只吃 {data, width, height} 这种朴素对象，不碰 DOM，Node 里也能跑（tests/imaging.test.mjs 就是这么验的）。
 * 约定：
 *   · data 是 Uint8ClampedArray，RGBA 逐行排列，sRGB 8 位；
 *   · 每个算子返回新的 buffer，原图永不被改，所以"重置"和"前后对比"是免费的；
 *   · 中间量一律 Float32（转线性空间算，避免在 8 位上叠加取整误差），落回 8 位只在最后一步。
 * 顺序固定写死在 renderPipeline() 里，配方 JSON 只存参数不存顺序，
 * 免得同一份配方在两台机器上算出两张片。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LFImage = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var D = Math;
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ---------- 色彩空间 ---------- */

  var SRGB2LIN = new Float32Array(256);
  var LIN2SRGB = new Uint8Array(4096);
  (function buildTables() {
    for (var i = 0; i < 256; i++) {
      var v = i / 255;
      SRGB2LIN[i] = v <= 0.04045 ? v / 12.92 : D.pow((v + 0.055) / 1.055, 2.4);
    }
    for (var j = 0; j < 4096; j++) {
      var l = j / 4095;
      var s = l <= 0.0031308 ? l * 12.92 : 1.055 * D.pow(l, 1 / 2.4) - 0.055;
      LIN2SRGB[j] = Math.round(clamp01(s) * 255);
    }
  })();
  function toLinear(u8) { return SRGB2LIN[u8]; }
  function fromLinear(f) {
    var i = (f * 4095) | 0;
    return LIN2SRGB[i < 0 ? 0 : i > 4095 ? 4095 : i];
  }

  function rgbToHsl(r, g, b, out) {
    var mx = D.max(r, g, b), mn = D.min(r, g, b), sum = mx + mn, d = mx - mn;
    out[2] = sum / 2;
    if (d < 1e-6) { out[0] = 0; out[1] = 0; return out; }
    out[1] = sum > 1 ? d / (2 - sum) : d / sum;
    var h;
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    out[0] = h * 60;
    return out;
  }
  function hueToRgb(p, q, t) {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  function hslToRgb(h, s, l, out) {
    h = (((h % 360) + 360) % 360) / 360;
    if (s < 1e-6) { out[0] = out[1] = out[2] = l; return out; }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    out[0] = hueToRgb(p, q, h + 1 / 3);
    out[1] = hueToRgb(p, q, h);
    out[2] = hueToRgb(p, q, h - 1 / 3);
    return out;
  }

  /* ---------- 核：可分离盒式模糊，三次近似高斯 ---------- */

  function boxBlurPass(src, dst, w, h, radius) {
    var win = radius * 2 + 1;
    for (var y = 0; y < h; y++) {
      var row = y * w;
      var acc = 0;
      for (var i = -radius; i <= radius; i++) acc += src[row + clamp(i, 0, w - 1)];
      for (var x = 0; x < w; x++) {
        dst[row + x] = acc / win;
        var out = src[row + clamp(x - radius, 0, w - 1)];
        var inn = src[row + clamp(x + radius + 1, 0, w - 1)];
        acc += inn - out;
      }
    }
  }
  function boxBlurVPass(src, dst, w, h, radius) {
    var win = radius * 2 + 1;
    for (var x = 0; x < w; x++) {
      var acc = 0;
      for (var i = -radius; i <= radius; i++) acc += src[clamp(i, 0, h - 1) * w + x];
      for (var y = 0; y < h; y++) {
        dst[y * w + x] = acc / win;
        acc += src[clamp(y + radius + 1, 0, h - 1) * w + x] - src[clamp(y - radius, 0, h - 1) * w + x];
      }
    }
  }
  /** 对单通道 Float32 做多次盒式模糊（≈高斯），返回新数组 */
  function blur(src, w, h, radius) {
    if (radius < 1) return src.slice();
    var r = D.max(1, Math.round(radius));
    var seq = [r, r, r];
    // 半径太大时用两次小半径代替，视觉上更贴近高斯且省一半时间
    if (r > 12) seq = [Math.round(r / 2), Math.round(r / 2), Math.round(r / 2), Math.round(r / 2)];
    // 乒乓缓冲必须是"横向写 scratch、纵向写回 cur"这一种配对。
    // 早先的 tmp = sw === src ? next : tmp 只在第一趟成立，从第二趟起 next 与 tmp
    // 是同一块缓冲——纵向那一遍就地读写自己，冲激响应上下不对称、总能量还 +1.5%。
    // cur 先拷一份：不能就地写调用方传进来的数组（lum 会被后面的清晰度再用一次）。
    var cur = new Float32Array(src);
    var scratch = new Float32Array(w * h);
    for (var p = 0; p < seq.length; p++) {
      boxBlurPass(cur, scratch, w, h, seq[p]);
      boxBlurVPass(scratch, cur, w, h, seq[p]);
    }
    return cur;
  }
  /** 灰度极小值滤波（去雾用的暗通道），盒式最小值三次近似结构元素 */
  function boxMin(src, w, h, radius) {
    var a = new Float32Array(w * h), b = new Float32Array(w * h);
    function passH(s, d) {
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var m = Infinity;
          for (var k = -radius; k <= radius; k++) {
            var v = s[y * w + clamp(x + k, 0, w - 1)];
            if (v < m) m = v;
          }
          d[y * w + x] = m;
        }
      }
    }
    function passV(s, d) {
      for (var x = 0; x < w; x++) {
        for (var y = 0; y < h; y++) {
          var m = Infinity;
          for (var k = -radius; k <= radius; k++) {
            var v = s[clamp(y + k, 0, h - 1) * w + x];
            if (v < m) m = v;
          }
          d[y * w + x] = m;
        }
      }
    }
    passH(src, a); passV(a, b); passH(b, a); passV(a, b);
    return b;
  }

  /* ---------- 缓冲工具 ---------- */

  function blank(img) {
    return { data: new Uint8ClampedArray(img.data.length), width: img.width, height: img.height };
  }
  function luminance(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
  /** 取线性亮度通道（0..1），供模糊/掩膜这类只做单通道的事情 */
  function lumChannel(img, out) {
    var n = img.width * img.height, d = img.data, a = out || new Float32Array(n);
    for (var i = 0, p = 0; i < n; i++, p += 4) {
      a[i] = luminance(toLinear(d[p]), toLinear(d[p + 1]), toLinear(d[p + 2]));
    }
    return a;
  }

  /* ---------- LUT：把逐像素的单调映射压成表 ---------- */

  function identityLUT() { var t = new Uint8Array(256); for (var i = 0; i < 256; i++) t[i] = i; return t; }
  /** 分段线性插值：points 为 [{x,y}]，x/y 均 0..1，必须单调 */
  function piecewiseLUT(points, gammaFn) {
    var pts = points.slice().sort(function (a, b) { return a.x - b.x; });
    var lut = new Uint8Array(256);
    for (var i = 0; i < 256; i++) {
      var x = i / 255;
      if (gammaFn) x = gammaFn(x);
      var y = pts.length ? pts[0].y : x;
      for (var k = 1; k < pts.length; k++) {
        if (x <= pts[k].x) {
          var p0 = pts[k - 1], p1 = pts[k];
          var t = (x - p0.x) / D.max(1e-6, p1.x - p0.x);
          y = lerp(p0.y, p1.y, t);
          break;
        }
        y = pts[k].y;
      }
      lut[i] = Math.round(clamp01(y) * 255);
    }
    return lut;
  }

  /** 由曝光/亮度/对比度/黑白场组装一条 tone 曲线（都在线性域做，避免中间调断层） */
  function toneLUT(p) {
    var gamma = 1 / 2.4, igamma = 2.4;
    var pts = [];
    var n = 33;
    for (var i = 0; i <= n; i++) {
      var v = i / n;
      var lin = D.pow(v, igamma);
      // 曝光：EV，线性倍增
      lin *= D.pow(2, p.exposure || 0);
      // 亮度：整体抬/压中间调（非线性）
      lin = clamp01(lin * D.pow(2, (p.brightness || 0) / 2));
      // 阴影/高光：分段，只对对应区间起作用
      var sh = (p.shadows || 0) / 100, hi = (p.highlights || 0) / 100;
      if (sh) {
        var wgt = D.pow(clamp01(1 - v / 0.55), 1.6);
        lin = clamp01(lin + sh * 0.42 * wgt * (1 - lin));
      }
      if (hi) {
        var wgt2 = D.pow(clamp01((v - 0.42) / 0.58), 1.4);
        lin = clamp01(lin + hi * 0.5 * wgt2 * (lin < 1 ? (1 - lin) * lin * 2 : 0));
      }
      // 黑场/白场：0 时必须严格等于原图（否则"未调"的片子也会变），只做单边抬压
      var bl = (p.blacks || 0) / 100, wh = (p.whites || 0) / 100;
      if (bl) lin = clamp01(lin + bl * 0.085 * (1 - lin));      // 正数抬黑，负数压黑
      if (wh) lin = clamp01(lin * (1 + wh * 0.42));
      // 对比度：绕 0.5 的 S 形（线性域做斜率）
      var c = (p.contrast || 0) / 100;
      if (c) lin = clamp01(0.5 + (lin - 0.5) * (1 + c * 0.85));
      pts.push({ x: i / n, y: D.pow(clamp01(lin), gamma) });
    }
    return piecewiseLUT(pts);
  }

  function applyLUT3(img, lutR, lutG, lutB) {
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      d[i] = lutR[d[i]]; d[i + 1] = lutG[d[i + 1]]; d[i + 2] = lutB[d[i + 2]];
    }
    return img;
  }

  /* ---------- 白平衡 ---------- */

  /** 比例式白平衡：给定增益（1 为不变），对三通道分别乘。放在线性域做，但 LUT 化后是近似，
   *  偏差在暗部约 1/255 级，肉眼不可见；真要精确就得整条管线走浮点，代价是内存翻四倍。 */
  function wbLUTs(temp, tint, gain) {
    var g = gain || { r: 1, g: 1, b: 1 };
    var t = (temp || 0) / 100, k = (tint || 0) / 100;
    var rr = g.r * (1 + t * 0.30 - k * 0.06);
    var gg = g.g * (1 - k * 0.16);
    var bb = g.b * (1 - t * 0.30 - k * 0.06);
    function mk(s) {
      var lut = new Uint8Array(256);
      for (var i = 0; i < 256; i++) {
        var lin = SRGB2LIN[i] * s;
        lut[i] = fromLinear(lin);
      }
      return lut;
    }
    return [mk(clamp(rr, 0.3, 3)), mk(clamp(gg, 0.3, 3)), mk(clamp(bb, 0.3, 3))];
  }

  /** 灰色世界自动白平衡：整图平均色拉向中性。返回增益，交给 wbLUTs 用。
   *  对纯色占屏的片子（比如一屏红枫叶）会矫枉过正，所以界面里它是"一键"而不是"默认开"。 */
  function grayWorldGain(img, strength) {
    var d = img.data, sr = 0, sg = 0, sb = 0, n = 0;
    var step = D.max(1, Math.floor(img.width / 160));
    for (var y = 0; y < img.height; y += step) {
      for (var x = 0; x < img.width; x += step) {
        var p = (y * img.width + x) * 4;
        var l = luminance(d[p], d[p + 1], d[p + 2]);
        if (l < 12 || l > 243) continue;       // 剪掉死黑与爆掉的高光，它们会把平均色拽偏
        sr += toLinear(d[p]) * l; sg += toLinear(d[p + 1]) * l; sb += toLinear(d[p + 2]) * l; n++;
      }
    }
    if (!n) return { r: 1, g: 1, b: 1 };
    sr /= n; sg /= n; sb /= n;
    var target = (sr + sg + sb) / 3;
    var k = clamp01(strength === undefined ? 0.8 : strength);
    return {
      r: clamp(lerp(1, target / D.max(sr, 1e-4), k), 0.5, 2.2),
      g: clamp(lerp(1, target / D.max(sg, 1e-4), k), 0.5, 2.2),
      b: clamp(lerp(1, target / D.max(sb, 1e-4), k), 0.5, 2.2)
    };
  }

  /* ---------- 分色与色调分离 ---------- */

  var BANDS = [0, 30, 60, 120, 180, 210, 270, 330];   // 红 橙 黄 绿 青 蓝 紫 品
  var BAND_NAMES = ['红', '橙', '黄', '绿', '青', '蓝', '紫', '品'];
  function bandWeight(hue, index) {
    // 与带心的角差，折到 0..180；±45° 内线性淡出，带心权重 1
    var d = D.abs(((hue - BANDS[index] + 540) % 360) - 180);
    return clamp01(1 - d / 45);
  }
  /** 分色参数只有一个解释口径：p.hsl 是分色面板的 8 段，全局饱和度/鲜艳度是挂在同一个对象上的
   *  两个字段。界面、渲染、烘 LUT 三处都必须先过这个函数，否则会出现"预览一个色、导出另一个色"。 */
  function hslParams(p) {
    var o = {}, k;
    if (p && p.hsl) for (k in p.hsl) o[k] = p.hsl[k];
    if (p && p.saturation) o.saturation = p.saturation;
    if (p && p.vibrance) o.vibrance = p.vibrance;
    return o;
  }

  function applyHSL(img, hsl) {
    var d = img.data, h = [0, 0, 0], o = [0, 0, 0];
    var anyChange = false;
    if (hsl) {
      if (hsl.saturation || hsl.vibrance) anyChange = true;
      for (var bi = 0; bi < 8 && !anyChange; bi++) {
        var bb = hsl[bi];
        if (bb && (bb.h || bb.s || bb.l)) anyChange = true;
      }
    }
    if (!anyChange) return img;
    for (var i = 0; i < d.length; i += 4) {
      rgbToHsl(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, h);
      var hh = h[0], ss = h[1], ll = h[2];
      for (var b = 0; b < 8; b++) {
        var band = hsl && hsl[b];
        if (!band) continue;
        var wt = bandWeight(hh, b);
        if (!wt) continue;
        if (band.h) hh += band.h * wt;
        if (band.s) ss = clamp01(ss * (1 + band.s / 100 * wt));
        if (band.l) ll = clamp01(ll + band.l / 100 * wt * (ll < 0.5 ? ll * 2 : (1 - ll) * 2));
      }
      if (hsl && hsl.saturation) ss = clamp01(ss * (1 + hsl.saturation / 100));
      if (hsl && hsl.vibrance) {
        // 鲜艳度：只抬低饱和的，皮肤和高饱和区不动，这是它和"饱和度"的区别
        var low = clamp01(1 - ss * 1.4);
        ss = clamp01(ss + hsl.vibrance / 100 * low * 0.55);
      }
      hslToRgb(hh, ss, ll, o);
      d[i] = o[0] * 255; d[i + 1] = o[1] * 255; d[i + 2] = o[2] * 255;
    }
    return img;
  }

  function applySplitTone(img, st) {
    if (!st || (!st.hiH && !st.loH)) return img;
    var d = img.data, o = [0, 0, 0], hi = [0, 0, 0], lo = [0, 0, 0];
    hslToRgb(st.hiH || 0, clamp01((st.hiS || 0) / 100), 0.5, hi);
    hslToRgb(st.loH || 0, clamp01((st.loS || 0) / 100), 0.5, lo);
    var hiAmt = (st.hiA || 0) / 100, loAmt = (st.loA || 0) / 100;
    for (var i = 0; i < d.length; i += 4) {
      var l = luminance(d[i], d[i + 1], d[i + 2]) / 255;
      var wh = D.pow(clamp01((l - 0.45) / 0.55), 1.3);
      var wl = D.pow(clamp01(1 - l / 0.6), 1.3);
      d[i] = clamp(d[i] + (hi[0] - 0.5) * 510 * wh * hiAmt + (lo[0] - 0.5) * 510 * wl * loAmt, 0, 255);
      d[i + 1] = clamp(d[i + 1] + (hi[1] - 0.5) * 510 * wh * hiAmt + (lo[1] - 0.5) * 510 * wl * loAmt, 0, 255);
      d[i + 2] = clamp(d[i + 2] + (hi[2] - 0.5) * 510 * wh * hiAmt + (lo[2] - 0.5) * 510 * wl * loAmt, 0, 255);
    }
    return img;
  }

  /* ---------- 细节：清晰度 / 纹理 / 去雾 ---------- */

  /** 清晰度=大尺度低频对比（Lightroom 的 presence），纹理=小尺度高频 */
  function applyDetail(img, p) {
    var w = img.width, h = img.height, d = img.data, n = w * h;
    var clarity = (p.clarity || 0) / 100, texture = (p.texture || 0) / 100, sharp = (p.sharpen || 0) / 100;
    if (!clarity && !texture && !sharp) return img;
    var lum = lumChannel(img);
    if (clarity) {
      var big = blur(lum, w, h, D.max(6, Math.round(Math.min(w, h) * 0.045)));
      for (var i = 0, q = 0; i < n; i++, q += 4) {
        var diff = (lum[i] - big[i]) * clarity * 0.62;
        d[q] = fromLinear(clamp01(toLinear(d[q]) + diff));
        d[q + 1] = fromLinear(clamp01(toLinear(d[q + 1]) + diff));
        d[q + 2] = fromLinear(clamp01(toLinear(d[q + 2]) + diff));
      }
    }
    if (texture || sharp) {
      var small = blur(lum, w, h, 1);
      var amt = texture * 1.1 + sharp * 1.6;
      if (amt) {
        var copy = new Uint8ClampedArray(d);
        for (var j = 0, r = 0; j < n; j++, r += 4) {
          // small 是线性 0..1，必须先回到 sRGB 8 位再与 copy 相减。
          // 直接 small*255 会在两个坐标系之间留一个约 +73 的常数偏置，
          // 结果"纹理"变成亮度滑杆：平场 128 拉满会亮到 208。
          var hf = (copy[r] - fromLinear(small[j])) * amt;
          d[r] = clamp(copy[r] + hf, 0, 255);
          d[r + 1] = clamp(copy[r + 1] + hf, 0, 255);
          d[r + 2] = clamp(copy[r + 2] + hf, 0, 255);
        }
      }
    }
    return img;
  }

  /** 去雾：暗通道先验的简化版。
   *  · 暗通道 = 三通道逐点取最小后做两次盒式最小值（结构元素近似）
   *  · 大气光 A = 暗通道最亮 0.1% 像素的平均色（这些点雾最厚）
   *  · 透射率 t = 1 - w·min/A，再对 t 做盒式模糊抹平块状边缘
   *  窗外（无雾）时会把噪点放大，所以 w 的上限给到 0.85，且界面默认关。 */
  function dehaze(img, amount) {
    var a = clamp01(amount === undefined ? 0.5 : amount);
    if (!a) return img;
    var w = img.width, h = img.height, d = img.data, n = w * h;
    var dark = new Float32Array(n);
    var rr = new Float32Array(n), gg = new Float32Array(n), bb = new Float32Array(n);
    for (var i = 0, p = 0; i < n; i++, p += 4) {
      rr[i] = d[p] / 255; gg[i] = d[p + 1] / 255; bb[i] = d[p + 2] / 255;
      dark[i] = D.min(D.min(rr[i], gg[i]), bb[i]);
    }
    var radius = D.max(2, Math.round(Math.min(w, h) / 48));
    // 大气光 A：暗通道最亮的那一小撮点（雾最厚处）的平均色
    var stepN = D.max(1, Math.floor(n / 4000));
    var sample = [];
    for (var k2 = 0; k2 < n; k2 += stepN) sample.push(k2);
    sample.sort(function (x, y) { return dark[y] - dark[x]; });
    var top = D.max(8, Math.round(sample.length * 0.008));
    var ar = 0, ag = 0, ab = 0;
    for (var t2 = 0; t2 < top; t2++) {
      var idx = sample[t2];
      ar += rr[idx]; ag += gg[idx]; ab += bb[idx];
    }
    ar = D.max(0.2, ar / top); ag = D.max(0.2, ag / top); ab = D.max(0.2, ab / top);
    // 归一化暗通道：min_c(I_c / A_c)，再取窗口最小 —— 这是 He 等人的原式，
    // 用标量大气亮度去除会被蓝色通道主导的场景（天空占比大）系统性低估透射率
    var nd = new Float32Array(n);
    for (var m2 = 0; m2 < n; m2++) nd[m2] = D.min(D.min(rr[m2] / ar, gg[m2] / ag), bb[m2] / ab);
    var dc = boxMin(nd, w, h, radius);
    var wHaze = 0.9 * a;
    var tmap = new Float32Array(n);
    for (var m3 = 0; m3 < n; m3++) tmap[m3] = clamp01(1 - wHaze * dc[m3]);
    var tb = blur(tmap, w, h, D.max(6, radius * 3));
    var floorT = 0.16;
    for (var o2 = 0, q2 = 0; o2 < n; o2++, q2 += 4) {
      var tt = D.max(floorT, tb[o2]);
      d[q2] = clamp((rr[o2] - ar * (1 - tt)) / tt * 255, 0, 255);
      d[q2 + 1] = clamp((gg[o2] - ag * (1 - tt)) / tt * 255, 0, 255);
      d[q2 + 2] = clamp((bb[o2] - ab * (1 - tt)) / tt * 255, 0, 255);
    }
    return img;
  }

  /* ---------- 掩膜 ---------- */

  /** 肤色掩膜：YCbCr 椭圆判据 + 亮度带，再做两次模糊羽化。
   *  返回 0..1 的 Float32。判据是教科书范围（Cb 77–132, Cr 133–177 的 0..1 折半版），
   *  深肤色与强侧光下会漏，所以界面允许手动补画。 */
  function skinMask(img, opts) {
    opts = opts || {};
    var w = img.width, h = img.height, d = img.data, n = w * h;
    var out = new Float32Array(n);
    var cbLo = opts.cbLo === undefined ? 0.36 : opts.cbLo;
    var cbHi = opts.cbHi === undefined ? 0.52 : opts.cbHi;
    var crLo = opts.crLo === undefined ? 0.50 : opts.crLo;
    var crHi = opts.crHi === undefined ? 0.70 : opts.crHi;
    for (var i = 0, p = 0; i < n; i++, p += 4) {
      var r = d[p] / 255, g = d[p + 1] / 255, b = d[p + 2] / 255;
      var yy = 0.299 * r + 0.587 * g + 0.114 * b;
      var cb = 0.5 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      var cr = 0.5 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      var okCb = cb >= cbLo && cb <= cbHi;
      var okCr = cr >= crLo && cr <= crHi;
      var okY = yy > 0.16 && yy < 0.97;
      var sat = D.max(r, g, b) - D.min(r, g, b);
      if (okCb && okCr && okY && sat > 0.02) out[i] = clamp01(1 - D.abs(cb - (cbLo + cbHi) / 2) / ((cbHi - cbLo) / 2) * 0.35) *
        clamp01(1 - D.abs(cr - (crLo + crHi) / 2) / ((crHi - crLo) / 2) * 0.35);
    }
    var r1 = D.max(2, Math.round(Math.min(w, h) / 90));
    var m = blur(out, w, h, r1);
    m = blur(m, w, h, r1);
    if (opts.boost) for (var z = 0; z < m.length; z++) m[z] = clamp01(m[z] * opts.boost);
    return m;
  }

  /** 亮度掩膜：mode='high' 取高光、'shadow' 取阴影。用于祛油光、压高光、提阴影的局部作用域 */
  function luminanceMask(img, mode, mid, soft) {
    var w = img.width, h = img.height, d = img.data, n = w * h;
    var out = new Float32Array(n);
    var m2 = mid === undefined ? 0.62 : mid, s = soft === undefined ? 0.22 : soft;
    for (var i = 0, p = 0; i < n; i++, p += 4) {
      var l = luminance(d[p], d[p + 1], d[p + 2]) / 255;
      out[i] = mode === 'high'
        ? clamp01((l - m2) / s)
        : clamp01((m2 - l) / s);
    }
    return blur(out, w, h, D.max(1, Math.round(Math.min(w, h) / 140)));
  }

  /** 天空掩膜：上半区权重 × 蓝黄判据 × 亮度。不接语义分割，纯启发式，
   *  所以界面里给"天空选区"加了手动加减画笔，判据只当初值。 */
  function skyMask(img) {
    var w = img.width, h = img.height, d = img.data, n = w * h;
    var out = new Float32Array(n);
    for (var y = 0; y < h; y++) {
      var rowBias = clamp01(1 - y / (h * 0.72));
      for (var x = 0; x < w; x++) {
        var i = y * w + x, p = i * 4;
        var r = d[p] / 255, g = d[p + 1] / 255, b = d[p + 2] / 255;
        var blueish = clamp01((b - r) * 2.4 + 0.42) * clamp01((b - g) * 2.2 + 0.5);
        var bright = clamp01((luminance(r, g, b) - 0.35) * 2.2);
        out[i] = clamp01(rowBias * blueish * (0.35 + 0.65 * bright));
      }
    }
    return blur(out, w, h, D.max(3, Math.round(w / 120)));
  }

  /** 点掩膜：中心 + 半径 + 羽化，返回新数组（可叠加） */
  function pointMask(w, h, cx, cy, radius, feather) {
    var out = new Float32Array(w * h);
    var r = D.max(1, radius), f = feather === undefined ? 0.55 : feather;
    for (var y = D.max(0, Math.floor(cy - r * 1.6)); y < D.min(h, Math.ceil(cy + r * 1.6)); y++) {
      for (var x = D.max(0, Math.floor(cx - r * 1.6)); x < D.min(w, Math.ceil(cx + r * 1.6)); x++) {
        var dist = D.hypot(x - cx, y - cy) / r;
        out[y * w + x] = clamp01(1 - (dist - f) / (1 - f));
      }
    }
    return out;
  }
  function paintMask(dst, add, w, h, sign) {
    for (var i = 0; i < dst.length; i++) dst[i] = clamp01(dst[i] + sign * add[i] * 0.65);
    return dst;
  }

  /* ---------- 人像 ---------- */

  /** 高低频分离磨皮：低频取大半径模糊，高频=原-低频，按强度衰减高频再合回。
   *  边缘保护靠"高频乘以亮度梯度衰减"，不做各向异性扩散——那玩意儿在 8 位上跑一遍要 2 秒。 */
  function freqSeparationSmooth(img, mask, strength, quality) {
    var w = img.width, h = img.height, d = img.data, n = w * h;
    var s = clamp01(strength);
    if (!s) return img;
    var lowR = D.max(4, Math.round(Math.min(w, h) * (0.02 + 0.02 * (quality || 0))));
    var ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    var low = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (var i = 0, p = 0; i < n; i++, p += 4) {
      ch[0][i] = d[p]; ch[1][i] = d[p + 1]; ch[2][i] = d[p + 2];
    }
    for (var c = 0; c < 3; c++) low[c] = blur(ch[c], w, h, lowR);
    // 边缘权重：低频梯度越大说明越靠近轮廓，高频越不能丢
    // 边缘权重自标定：先算低频梯度的幅值图，再用它自己的 95 分位当"满保护"的刻度。
    // 固定除数（原来写的 /96）在低对比片子上一整片都不保护，在高对比片子上又把眉毛当边界保住。
    var edge = new Float32Array(n);
    var hist = new Float64Array(128);
    var gmax = 0;
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var k = y * w + x;
        var gx = low[0][k + 1] - low[0][k - 1] + low[1][k + 1] - low[1][k - 1] + low[2][k + 1] - low[2][k - 1];
        var gy = low[0][k + w] - low[0][k - w] + low[1][k + w] - low[1][k - w] + low[2][k + w] - low[2][k - w];
        var mag = D.hypot(gx, gy);
        edge[k] = mag;
        if (mag > gmax) gmax = mag;
      }
    }
    var scale = D.max(6, gmax);
    for (var hi2 = 0; hi2 < n; hi2++) hist[D.min(127, (edge[hi2] / scale * 127) | 0)]++;
    var want = n * 0.95, acc = 0, p95 = 0.35;
    for (var hb = 0; hb < 128; hb++) { acc += hist[hb]; if (acc >= want) { p95 = hb / 127; break; } }
    p95 = D.max(0.05, p95);
    for (var e2 = 0; e2 < n; e2++) edge[e2] = clamp01(edge[e2] / (scale * p95));
    var keep = 1 - s * 0.92;
    for (var j = 0, q = 0; j < n; j++, q += 4) {
      var m = (mask ? mask[j] : 1) * (1 - edge[j] * 0.85);
      if (!m) continue;
      for (var cc = 0; cc < 3; cc++) {
        var hf = ch[cc][j] - low[cc][j];
        var v = low[cc][j] + hf * lerp(1, keep, m);
        d[q + cc] = clamp(v, 0, 255);
      }
    }
    return img;
  }

  /** 匀肤：把肤色区像素的色度朝"局部均值色度"拉，只动 Cb/Cr 不动亮度，
   *  这样斑还在（亮度差没抹平）但红一块白一块的色偏会走。 */
  function evenTone(img, mask, amount) {
    var w = img.width, h = img.height, d = img.data, n = w * h;
    var a = clamp01(amount);
    if (!a || !mask) return img;
    var cb = new Float32Array(n), cr = new Float32Array(n), wsum = new Float32Array(n), xcb = new Float32Array(n), xcr = new Float32Array(n);
    for (var i = 0, p = 0; i < n; i++, p += 4) {
      var r = d[p] / 255, g = d[p + 1] / 255, b = d[p + 2] / 255;
      cb[i] = 0.5 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      cr[i] = 0.5 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      wsum[i] = mask[i];
      xcb[i] = cb[i] * mask[i]; xcr[i] = cr[i] * mask[i];
    }
    var rad = D.max(6, Math.round(Math.min(w, h) / 26));
    var mcb = blur(xcb, w, h, rad), mcr = blur(xcr, w, h, rad), mw = blur(wsum, w, h, rad);
    for (var j = 0, q = 0; j < n; j++, q += 4) {
      if (mw[j] < 0.02 || mask[j] < 0.05) continue;
      var tcb = mcb[j] / mw[j], tcr = mcr[j] / mw[j];
      var yy = 0.299 * d[q] / 255 + 0.587 * d[q + 1] / 255 + 0.114 * d[q + 2] / 255;
      var ncb = lerp(cb[j], tcb, a * mask[j]), ncr = lerp(cr[j], tcr, a * mask[j]);
      // YCbCr → RGB 逆矩阵（BT.601）
      var nr = yy + 1.402 * (ncr - 0.5);
      var ng = yy - 0.344136 * (ncb - 0.5) - 0.714136 * (ncr - 0.5);
      var nb = yy + 1.772 * (ncb - 0.5);
      d[q] = clamp(nr * 255, 0, 255); d[q + 1] = clamp(ng * 255, 0, 255); d[q + 2] = clamp(nb * 255, 0, 255);
    }
    return img;
  }

  /** 祛油光：高光段（肤色掩膜 ∩ 亮度掩膜）把亮度往局部均值收，并同步降饱和 */
  function dewaxy(img, mask, hiMask, amount) {
    var w = img.width, h = img.height, d = img.data, n = w * h;
    var a = clamp01(amount);
    if (!a) return img;
    var lum = lumChannel(img);
    var soft = blur(lum, w, h, D.max(5, Math.round(Math.min(w, h) / 30)));
    for (var i = 0, p = 0; i < n; i++, p += 4) {
      var m = mask[i] * hiMask[i] * a;
      if (!m) continue;
      var target = soft[i] * 0.82 + lum[i] * 0.18;
      var scale = target / D.max(lum[i], 1e-4);
      var k = lerp(1, D.min(scale, 1), m);
      var hsl = [0, 0, 0], o = [0, 0, 0];
      rgbToHsl(d[p] / 255, d[p + 1] / 255, d[p + 2] / 255, hsl);
      hsl[1] = clamp01(hsl[1] * lerp(1, 1.14, m));     // 泛油的地方通常也掉饱和，补一点
      hsl[2] = clamp01(hsl[2] * k);
      hslToRgb(hsl[0], hsl[1], hsl[2], o);
      d[p] = o[0] * 255; d[p + 1] = o[1] * 255; d[p + 2] = o[2] * 255;
    }
    return img;
  }

  /** 提亮眼白/牙齿：点掩膜内抬亮度、压黄饱和，并加一次小半径高频强化（"亮眼三层"里的锐利层） */
  function lightenWithin(img, mask, amount, desat) {
    var d = img.data, w = img.width, h = img.height, n = w * h;
    var a = clamp01(amount);
    if (!a) return img;
    var lum = lumChannel(img);
    var big = blur(lum, w, h, D.max(4, Math.round(Math.min(w, h) / 40)));
    for (var i = 0, p = 0; i < n; i++, p += 4) {
      var m = mask[i] * a;
      if (!m) continue;
      var hsl = [0, 0, 0], o = [0, 0, 0];
      rgbToHsl(d[p] / 255, d[p + 1] / 255, d[p + 2] / 255, hsl);
      var lift = clamp01((big[i] + 0.02 - lum[i]) * 3) * 0.5 + 0.28;
      hsl[2] = clamp01(hsl[2] + lift * m * 0.55);
      if (desat) hsl[1] = clamp01(hsl[1] * lerp(1, 0.55, m * (hsl[0] > 20 && hsl[0] < 90 ? 1 : 0.35)));
      hslToRgb(hsl[0], hsl[1], hsl[2], o);
      d[p] = o[0] * 255; d[p + 1] = o[1] * 255; d[p + 2] = o[2] * 255;
    }
    return img;
  }

  /** 轮廓微调（pucker/warp）：以点为中心沿半径方向内收或外扩，权重三次平滑。
   *  不做网格变形，也不做"瘦脸预设"——没有人脸关键点时那是在赌。 */
  function warpPoint(img, out, cx, cy, radius, amount) {
    var w = img.width, h = img.height, src = img.data;
    var d = out.data;
    var r = D.max(2, radius), a = amount;
    if (!a) { d.set(src); return out; }
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var dx = x - cx, dy = y - cy;
        var dist = D.hypot(dx, dy);
        var t = dist / r;
        var px = x, py = y;
        if (t < 1.6) {
          var wt = t < 1 ? D.pow(1 - t, 2) : 0;
          var shift = 1 + a * wt * 0.42;
          px = cx + dx * shift;
          py = cy + dy * shift;
        }
        var fx = clamp(px, 0, w - 1.001), fy = clamp(py, 0, h - 1.001);
        var x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0;
        var i0 = (y0 * w + x0) * 4, i1 = i0 + 4, i2 = i0 + w * 4, i3 = i2 + 4;
        var q = (y * w + x) * 4;
        for (var c = 0; c < 3; c++) {
          d[q + c] = lerp(lerp(src[i0 + c], src[i1 + c], tx), lerp(src[i2 + c], src[i3 + c], tx), ty);
        }
        d[q + 3] = 255;
      }
    }
    return out;
  }

  /* ---------- 几何 ---------- */

  function sampleBilinear(src, w, h, fx, fy, out) {
    var x = clamp(fx, 0, w - 1.001), y = clamp(fy, 0, h - 1.001);
    var x0 = x | 0, y0 = y | 0, tx = x - x0, ty = y - y0;
    var i0 = (y0 * w + x0) * 4, i1 = i0 + 4, i2 = i0 + w * 4, i3 = i2 + 4;
    for (var c = 0; c < 3; c++) {
      out[c] = lerp(lerp(src[i0 + c], src[i1 + c], tx), lerp(src[i2 + c], src[i3 + c], tx), ty);
    }
  }

  /** 旋转 + 统一缩放 + 梯形/侧向斜切（四角映射的简化：只做竖直与水平斜切各一档）。
   *  透视用单应矩阵，参数直接给四角，界面用拖角点的方式改。 */
  function transform(img, out, geo) {
    var w = img.width, h = img.height, ow = out.width, oh = out.height, src = img.data, d = out.data;
    var rad = -(geo.rotate || 0) * D.PI / 180;
    var cs = D.cos(rad), sn = D.sin(rad);
    // 进来的 img 已经是裁剪后的缓冲，中心就是这块缓冲的中心。
    // 早先这里又加了一次 crop.x/crop.y，等于把裁剪局部坐标当原图坐标用，
    // 选任何裁剪比例都会让画面整体平移、框外的内容被拉进来。
    var cx0 = w / 2, cy0 = h / 2;
    var zoom = geo.zoom || 1;
    var px = [geo.persp];
    // 单应矩阵：把输出四角映射回输入四角（源=当前裁剪框），用 8 参线性方程解
    var H = null;
    if (px[0] && px[0].tl) H = homographyFromQuads(
      [[0, 0], [ow, 0], [ow, oh], [0, oh]],
      [px[0].tl, px[0].tr, px[0].br, px[0].bl]);
    var tmp = [0, 0, 0];
    for (var y = 0; y < oh; y++) {
      for (var x = 0; x < ow; x++) {
        var u = (x - ow / 2), v = (y - oh / 2);
        var sx, sy;
        if (H) {
          var den = H[6] * u + H[7] * v + 1;
          sx = (H[0] * u + H[1] * v + H[2]) / den;
          sy = (H[3] * u + H[4] * v + H[5]) / den;
          sx = sx + cx0; sy = sy + cy0;
        } else {
          sx = (u / zoom) * cs - (v / zoom) * sn + cx0;
          sy = (u / zoom) * sn + (v / zoom) * cs + cy0;
        }
        sampleBilinear(src, w, h, sx, sy, tmp);
        var q = (y * ow + x) * 4;
        d[q] = tmp[0]; d[q + 1] = tmp[1]; d[q + 2] = tmp[2]; d[q + 3] = 255;
      }
    }
    return out;
  }

  /** 输出四角 → 源四角的单应矩阵（DLT，8 方程高斯消元） */
  function homographyFromQuads(dst, srcQuads) {
    var A = [], B = [];
    for (var i = 0; i < 4; i++) {
      var X = srcQuads[i][0], Y = srcQuads[i][1], x = dst[i][0], y = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); B.push(X);
      A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); B.push(Y);
    }
    var h = solveLinear(A, B);
    if (!h) return null;
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]];
  }
  function solveLinear(A, B) {
    var n = B.length, m = A[0].length;
    var M = A.map(function (row, i) { return row.concat([B[i]]); });
    for (var col = 0; col < m; col++) {
      var piv = col;
      for (var r = col + 1; r < n; r++) if (D.abs(M[r][col]) > D.abs(M[piv][col])) piv = r;
      if (D.abs(M[piv][col]) < 1e-9) return null;
      var sw = M[col]; M[col] = M[piv]; M[piv] = sw;
      for (var k = 0; k < n; k++) {
        if (k === col) continue;
        var f = M[k][col] / M[col][col];
        for (var c = col; c <= m; c++) M[k][c] -= f * M[col][c];
      }
    }
    return M.map(function (row) { return row[m] / row[col]; });
  }

  /** 自动水平：投影方差法。
   *  把中间横带按候选角错切，取"行均值的一阶差分能量"最大的那个角——
   *  水平线一旦被摆平，同一条边会整齐落进同一行，行与行的落差最大。
   *  比梯度直方图可靠：浅角度下 1 像素差分把倾斜量化成 0，直方图法就是在这里失手的。
   *  只在地平线/海平线这类强直边场景有意义，人像与树林里会飘，所以它是"建议"不是"默认"。 */
  function estimateHorizon(img) {
    var w = img.width, h = img.height, d = img.data;
    var y0 = Math.floor(h * 0.3), y1 = Math.ceil(h * 0.7);
    var bandH = y1 - y0;
    function gray(x, y) { var p = (y * w + x) * 4; return 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]; }
    var best = { angle: 0, strength: 0 };
    var cx = w / 2;
    for (var a = -12; a <= 12.001; a += 0.25) {
      var k = Math.tan(a * D.PI / 180);
      var rows = new Float64Array(bandH), cnt = new Float64Array(bandH);
      for (var y = 0; y < bandH; y++) {
        for (var x = 2; x < w - 2; x += 2) {
          var sy = y + y0 + (x - cx) * k;
          if (sy < 0 || sy > h - 2) continue;
          var v = gray(x, Math.round(sy));
          rows[y] += v; cnt[y]++;
        }
      }
      var score = 0;
      for (var r = 1; r < bandH - 1; r++) {
        if (cnt[r] < 4 || cnt[r - 1] < 4) continue;
        var dr = (rows[r + 1] / cnt[r + 1]) - 2 * (rows[r] / cnt[r]) + (rows[r - 1] / cnt[r - 1]);
        score += dr * dr;
      }
      if (score > best.strength) best = { angle: a, strength: score };
    }
    // 归一化到 0..1：拿"完全水平时的能量"当参照，界面用它决定要不要给建议
    var ref = 0;
    for (var q = 1; q < bandH - 1; q++) ref += 4;
    return { angle: best.angle, strength: clamp01(best.strength / (bandH * w * 0.5 + 1)) };
  }

  /* ---------- 暗角与颗粒 ---------- */

  function applyVignette(img, amount, roundness) {
    var a = (amount || 0) / 100;
    if (!a) return img;
    var w = img.width, h = img.height, d = img.data;
    var cx = w / 2, cy = h / 2, rr = roundness === undefined ? 1 : roundness;
    var maxd = D.hypot(cx, cy);
    for (var y = 0, p = 0; y < h; y++) {
      for (var x = 0; x < w; x++, p += 4) {
        var dist = D.hypot((x - cx), (y - cy) * rr) / maxd;
        var f = clamp01(1 - D.pow(D.max(0, dist - 0.42) / 0.62, 1.6) * D.abs(a) * 1.5);
        d[p] *= f; d[p + 1] *= f; d[p + 2] *= f;
      }
    }
    return img;
  }

  /** 颗粒：固定种子的 LCG，保证同一配方在同一尺寸上每次出同一张图。
   *  换种子等于换片子，所以种子存进配方里而不是每次现取。 */
  function applyGrain(img, amount, size, seed) {
    var a = (amount || 0) / 100;
    if (!a) return img;
    var w = img.width, h = img.height, d = img.data;
    var cell = D.max(1, Math.round(size || 1));
    var state = (seed || 20261019) >>> 0;
    function rnd() { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; }
    var gw = D.ceil(w / cell), gh = D.ceil(h / cell);
    var noise = new Float32Array(gw * gh);
    for (var i = 0; i < noise.length; i++) noise[i] = rnd() - 0.5;
    for (var y = 0, p = 0; y < h; y++) {
      for (var x = 0; x < w; x++, p += 4) {
        var n = noise[(y / cell | 0) * gw + (x / cell | 0)] * a * 46;
        d[p] = clamp(d[p] + n, 0, 255);
        d[p + 1] = clamp(d[p + 1] + n * 0.94, 0, 255);
        d[p + 2] = clamp(d[p + 2] + n * 1.08, 0, 255);
      }
    }
    return img;
  }

  /* ---------- 局部控制点（风光的 U-Point 式打光） ---------- */

  function applyLocal(img, points, mode) {
    var w = img.width, h = img.height, d = img.data;
    var pts = (points || []).filter(function (p) { return p && p.enabled !== false; });
    if (!pts.length) return img;
    for (var pi = 0; pi < pts.length; pi++) {
      var pt = pts[pi];
      var cx = pt.x * w, cy = pt.y * h;
      var r = D.max(8, (pt.r || 0.25) * Math.min(w, h) * 1.6);
      var mask = pointMask(w, h, cx, cy, r, pt.feather === undefined ? 0.4 : pt.feather);
      var ev = (pt.exposure || 0) / 100 * 0.9;
      var temp = (pt.temp || 0) / 100;
      var sat = (pt.sat || 0) / 100;
      var deh = (pt.dehaze || 0) / 100;
      var hsl = [0, 0, 0], o = [0, 0, 0];
      for (var i = 0, p = 0; i < w * h; i++, p += 4) {
        var m = mask[i];
        if (m < 0.004) continue;
        var lin = [toLinear(d[p]), toLinear(d[p + 1]), toLinear(d[p + 2])];
        var k = D.pow(2, ev * m);
        lin[0] = clamp01(lin[0] * k * (1 + temp * 0.28 * m));
        lin[1] = clamp01(lin[1] * k);
        lin[2] = clamp01(lin[2] * k * (1 - temp * 0.28 * m));
        if (deh) for (var c = 0; c < 3; c++) lin[c] = clamp01(lin[c] + (lin[c] - 0.18) * deh * m * 0.9);
        d[p] = fromLinear(lin[0]); d[p + 1] = fromLinear(lin[1]); d[p + 2] = fromLinear(lin[2]);
        if (sat) {
          rgbToHsl(d[p] / 255, d[p + 1] / 255, d[p + 2] / 255, hsl);
          hsl[1] = clamp01(hsl[1] * (1 + sat * m));
          hslToRgb(hsl[0], hsl[1], hsl[2], o);
          d[p] = o[0] * 255; d[p + 1] = o[1] * 255; d[p + 2] = o[2] * 255;
        }
      }
      void mode;
    }
    return img;
  }

  /* ---------- 主链路 ---------- */

  var DEFAULTS = {
    exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    temp: 0, tint: 0, wbGain: null, autoWB: 0,
    curve: null,                 // [{x,y}] 单通道共用，需要分通道时给 curveR/G/B
    curveR: null, curveG: null, curveB: null,
    hsl: null, saturation: 0, vibrance: 0,
    split: null,
    clarity: 0, texture: 0, sharpen: 0, dehaze: 0,
    portrait: null,              // {smooth,quality,evenTone,dewaxy,eyes,teeth,bags,warps:[]}
    local: [],
    geometry: null,              // {rotate,crop,zoom,persp}
    vignette: 0, roundness: 1, grain: 0, grainSize: 1, grainSeed: 20261019
  };

  /** 执行顺序写死在这里：几何 → 局部 → 去雾 → 影调 → 曲线 → 白平衡 → 分色/分离色调 → 细节 → 人像 → 暗角颗粒 */
  function renderPipeline(source, params) {
    var p = {};
    for (var k in DEFAULTS) p[k] = DEFAULTS[k];
    for (var k2 in (params || {})) p[k2] = params[k2];
    var t0 = Date.now();
    var stages = [];
    function mark(name, from) { stages.push({ stage: name, ms: Date.now() - from }); }

    var out;
    var t = t0;
    if (p.geometry && (p.geometry.rotate || p.geometry.crop || (p.geometry.zoom || 1) !== 1 || p.geometry.persp)) {
      var g = p.geometry;
      var base = g.crop ? cropRegion(source, g.crop)
        : { data: source.data, width: source.width, height: source.height };
      var ow = D.max(16, Math.round(base.width / (g.zoom || 1)));
      var oh = D.max(16, Math.round(base.height / (g.zoom || 1)));
      out = { data: new Uint8ClampedArray(ow * oh * 4), width: ow, height: oh };
      transform(base, out, g);
      stages.push({ stage: '几何', ms: Date.now() - t });
    } else {
      out = { data: new Uint8ClampedArray(source.data), width: source.width, height: source.height };
    }

    t = Date.now(); applyLocal(out, p.local); mark('局部', t);
    t = Date.now(); if (p.dehaze) dehaze(out, p.dehaze / 100); mark('去雾', t);
    t = Date.now();
    var tone = toneLUT(p);                     // 三条通道同一张表，别一张表烘三遍
    applyLUT3(out, tone, tone, tone); mark('影调', t);
    t = Date.now();
    var cr = p.curve || p.curveR, cg = p.curve || p.curveG, cb2 = p.curve || p.curveB;
    if (cr || cg || cb2) {
      applyLUT3(out,
        cr ? piecewiseLUT(cr) : identityLUT(),
        cg ? piecewiseLUT(cg) : identityLUT(),
        cb2 ? piecewiseLUT(cb2) : identityLUT());
    }
    mark('曲线', t);
    t = Date.now();
    var gain = p.wbGain || (p.autoWB ? grayWorldGain(out, p.autoWB) : null);
    var luts = wbLUTs(p.temp, p.tint, gain);
    applyLUT3(out, luts[0], luts[1], luts[2]);
    mark('白平衡', t);
    t = Date.now();
    applyHSL(out, hslParams(p));
    if (p.split) applySplitTone(out, p.split);
    mark('分色', t);
    t = Date.now(); applyDetail(out, p); mark('细节', t);
    t = Date.now(); applyPortrait(out, p.portrait); mark('人像', t);
    t = Date.now(); applyVignette(out, p.vignette, p.roundness); applyGrain(out, p.grain, p.grainSize, p.grainSeed);
    mark('暗角颗粒', t);
    out.stats = { ms: Date.now() - t0, stages: stages, pixels: out.width * out.height };
    return out;
  }

  function cropRegion(img, crop) {
    var w = img.width, h = img.height;
    var x0 = clamp(Math.round(crop.x), 0, w), y0 = clamp(Math.round(crop.y), 0, h);
    var x1 = clamp(Math.round(crop.x + crop.w), x0, w), y1 = clamp(Math.round(crop.y + crop.h), y0, h);
    var cw = Math.max(1, x1 - x0), ch = Math.max(1, y1 - y0);
    var o = new Uint8ClampedArray(cw * ch * 4);
    for (var y = 0; y < ch; y++) {
      for (var x = 0; x < cw; x++) {
        var s = ((y0 + y) * w + (x0 + x)) * 4, d2 = (y * cw + x) * 4;
        o[d2] = img.data[s]; o[d2 + 1] = img.data[s + 1]; o[d2 + 2] = img.data[s + 2]; o[d2 + 3] = 255;
      }
    }
    // 必须把真实宽高一起交出去：缓冲区是 x1-x0 的整数差，调用方若自己 round(crop.w)
    // 就会偶发差出 1 行，双线性读到数组外拿到 undefined → NaN → 写回 0，导出图底部
    // 出现一条纯黑带（4000×3000 取 3:2 实测差 168 行）。
    return { data: o, width: cw, height: ch };
  }

  function applyPortrait(img, pp) {
    if (!pp) return img;
    // 全零的人像参数不该付一次肤色掩膜的代价（预览上这一步实测 50ms 量级）
    if (!pp.smooth && !pp.evenTone && !pp.dewaxy && !(pp.spots && pp.spots.length) && !(pp.paint && pp.paint.length)) return img;
    var w = img.width, h = img.height;
    var mask = pp.maskOverride || skinMask(img, { boost: pp.maskBoost || 1 });
    // 判据漏掉的皮肤（深肤色、强侧光、逆光剪影）由界面补画：pp.paint 是归一化点列，
    // 与自动掩膜取并集，所以补画不会把自动判对的部分削掉
    if (pp.paint && pp.paint.length) {
      for (var pi = 0; pi < pp.paint.length; pi++) {
        var pt = pp.paint[pi];
        mask = paintMask(mask, pointMask(w, h, pt.x * w, pt.y * h,
          Math.max(3, (pt.r || 0.05) * Math.min(w, h)), 0.35), w, h, 1);
      }
    }
    if (pp.smooth) freqSeparationSmooth(img, mask, pp.smooth / 100, (pp.quality || 0) / 100);
    // 身体磨皮要区分"脸在哪"，没有关键点模型时它只能靠猜，v1 不做，界面上也就不给这个滑杆
    if (pp.evenTone) evenTone(img, mask, pp.evenTone / 100);
    if (pp.dewaxy) dewaxy(img, mask, luminanceMask(img, 'high', 0.68, 0.2), pp.dewaxy / 100);
    var spots = pp.spots || [];
    for (var i = 0; i < spots.length; i++) {
      var s = spots[i];
      var pm = pointMask(w, h, s.x * w, s.y * h, D.max(4, (s.r || 0.04) * Math.min(w, h)), 0.5);
      if (s.type === 'eye') lightenWithin(img, pm, (s.amount || 60) / 100, true);
      else if (s.type === 'teeth') lightenWithin(img, pm, (s.amount || 45) / 100, true);
      else if (s.type === 'bag') lightenWithin(img, pm, (s.amount || 35) / 100, false);
      else if (s.type === 'warp') {
        // 必须先快照再写：warpPoint 按行主序扫描，就地读写会让中心左上侧读到
        // 已改写的像素，同一侧的变形被二次叠加（64×64 实测 110 个像素不一致、最大差 134）
        var snap = { data: new Uint8ClampedArray(img.data), width: w, height: h };
        warpPoint(snap, img, s.x * w, s.y * h, D.max(6, (s.r || 0.08) * Math.min(w, h)), (s.amount || 0) / 100);
      }
    }
    return img;
  }

  /* ---------- 直方图与读数 ---------- */

  function histogram(img, bins) {
    var n = bins || 256, h = { r: new Uint32Array(n), g: new Uint32Array(n), b: new Uint32Array(n), l: new Uint32Array(n) };
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var k = n - 1;
      h.r[D.min(k, d[i] * n / 256 | 0)]++;
      h.g[D.min(k, d[i + 1] * n / 256 | 0)]++;
      h.b[D.min(k, d[i + 2] * n / 256 | 0)]++;
      h.l[D.min(k, (luminance(d[i], d[i + 1], d[i + 2]) * n / 256) | 0)]++;
    }
    h.clipped = { low: h.l[0], high: h.l[n - 1], total: d.length / 4 };
    return h;
  }
  /** 平均/高光/阴影读数，界面右下角那行数字 */
  function toneReadout(img) {
    var d = img.data, n = d.length / 4, sum = 0, hi = 0, lo = 0, clipH = 0, clipL = 0;
    for (var i = 0, p = 0; i < n; i++, p += 4) {
      var l = luminance(d[p], d[p + 1], d[p + 2]);
      sum += l;
      if (l > 200) hi++;
      if (l < 40) lo++;
      if (l >= 254.5) clipH++;
      if (l <= 0.6) clipL++;
    }
    return { mean: sum / n, highShare: hi / n, lowShare: lo / n, clipHigh: clipH / n, clipLow: clipL / n };
  }

  /* ---------- 3D LUT 导出（色彩链可烘，空间类算子不烘） ---------- */

  var LUT_STAGES = '影调 / 曲线 / 白平衡 / 分色 / 分离色调';
  function bakeCube(p, size) {
    var n = size || 33;
    var cubeHsl = hslParams(p);
    var tone = toneLUT(p);
    var cr = (p.curve || p.curveR) ? piecewiseLUT(p.curve || p.curveR) : identityLUT();
    var cg = (p.curve || p.curveG) ? piecewiseLUT(p.curve || p.curveG) : identityLUT();
    var cb2 = (p.curve || p.curveB) ? piecewiseLUT(p.curve || p.curveB) : identityLUT();
    var wb = wbLUTs(p.temp, p.tint, p.wbGain);
    var lines = [];
    lines.push('LUT_3D_SIZE ' + n);
    lines.push('# Mizar 配方烘出的 3D LUT；只包含 ' + LUT_STAGES + ' 这些与位置无关的算子');
    lines.push('# 清晰度/去雾/磨皮/局部控制点是逐像素依赖的，不在这张表里');
    var hsl = [0, 0, 0], o = [0, 0, 0];
    var lut = new Uint8Array(256);
    for (var b = 0; b < 256; b++) lut[b] = b;
    for (var r0 = 0; r0 < n; r0++) {
      for (var g0 = 0; g0 < n; g0++) {
        for (var b0 = 0; b0 < n; b0++) {
          var rgb = [r0 / (n - 1), g0 / (n - 1), b0 / (n - 1)];
          // 用 8 位量化走一遍真实链路，保证和界面预览完全一致
          var px = new Uint8ClampedArray([Math.round(rgb[0] * 255), Math.round(rgb[1] * 255), Math.round(rgb[2] * 255), 255]);
          px[0] = tone[px[0]]; px[1] = tone[px[1]]; px[2] = tone[px[2]];
          px[0] = cr[px[0]]; px[1] = cg[px[1]]; px[2] = cb2[px[2]];
          px[0] = wb[0][px[0]]; px[1] = wb[1][px[1]]; px[2] = wb[2][px[2]];
          rgbToHsl(px[0] / 255, px[1] / 255, px[2] / 255, hsl);
          var hh = hsl[0], ss = hsl[1], ll = hsl[2];
          var hp = cubeHsl;
          for (var bi = 0; bi < 8; bi++) {
            var band = hp && hp[bi];
            if (!band) continue;
            var wt = bandWeight(hh, bi);
            if (!wt) continue;
            if (band.h) hh += band.h * wt;
            if (band.s) ss = clamp01(ss * (1 + band.s / 100 * wt));
            if (band.l) ll = clamp01(ll + band.l / 100 * wt * (ll < 0.5 ? ll * 2 : (1 - ll) * 2));
          }
          if (hp && hp.saturation) ss = clamp01(ss * (1 + hp.saturation / 100));
          if (hp && hp.vibrance) ss = clamp01(ss + hp.vibrance / 100 * clamp01(1 - ss * 1.4) * 0.55);
          hslToRgb(hh, ss, ll, o);
          px[0] = o[0] * 255; px[1] = o[1] * 255; px[2] = o[2] * 255;
          if (p.split) {
            var l2 = luminance(px[0], px[1], px[2]) / 255;
            var wht = D.pow(clamp01((l2 - 0.45) / 0.55), 1.3) * (p.split.hiA || 0) / 100;
            var wlt = D.pow(clamp01(1 - l2 / 0.6), 1.3) * (p.split.loA || 0) / 100;
            var hc = [0, 0, 0], lc = [0, 0, 0];
            hslToRgb(p.split.hiH || 0, clamp01((p.split.hiS || 0) / 100), 0.5, hc);
            hslToRgb(p.split.loH || 0, clamp01((p.split.loS || 0) / 100), 0.5, lc);
            for (var c3 = 0; c3 < 3; c3++) {
              px[c3] = clamp(px[c3] + (hc[c3] - 0.5) * 510 * wht + (lc[c3] - 0.5) * 510 * wlt, 0, 255);
            }
          }
          lines.push((px[0] / 255).toFixed(6) + ' ' + (px[1] / 255).toFixed(6) + ' ' + (px[2] / 255).toFixed(6));
        }
      }
    }
    void lut;
    return lines.join('\n') + '\n';
  }

  /* ---------- 配方 ---------- */

  function normalizeRecipe(p) {
    var o = {};
    for (var k in DEFAULTS) {
      var v = p && p[k] !== undefined ? p[k] : DEFAULTS[k];
      o[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? JSON.parse(JSON.stringify(v)) :
        (Array.isArray(v) ? v.slice(0, 64) : v);
    }
    o.version = 1;
    return o;
  }
  function recipeHash(p) {
    var s = JSON.stringify(p);
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h.toString(16);
  }

  return {
    clamp: clamp, clamp01: clamp01, lerp: lerp,
    toLinear: toLinear, fromLinear: fromLinear, luminance: luminance,
    rgbToHsl: rgbToHsl, hslToRgb: hslToRgb,
    blur: blur, boxMin: boxMin, blank: blank, lumChannel: lumChannel,
    identityLUT: identityLUT, piecewiseLUT: piecewiseLUT, toneLUT: toneLUT, wbLUTs: wbLUTs,
    grayWorldGain: grayWorldGain, BAND_NAMES: BAND_NAMES,
    applyHSL: applyHSL, applySplitTone: applySplitTone, applyDetail: applyDetail, dehaze: dehaze,
    skinMask: skinMask, luminanceMask: luminanceMask, skyMask: skyMask, pointMask: pointMask, paintMask: paintMask,
    freqSeparationSmooth: freqSeparationSmooth, evenTone: evenTone, dewaxy: dewaxy,
    lightenWithin: lightenWithin, warpPoint: warpPoint,
    transform: transform, cropRegion: cropRegion, estimateHorizon: estimateHorizon,
    applyVignette: applyVignette, applyGrain: applyGrain, applyLocal: applyLocal,
    renderPipeline: renderPipeline, applyPortrait: applyPortrait, DEFAULTS: DEFAULTS,
    histogram: histogram, toneReadout: toneReadout, bakeCube: bakeCube,
    normalizeRecipe: normalizeRecipe, recipeHash: recipeHash
  };
});
