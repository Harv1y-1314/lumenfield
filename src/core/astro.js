/* 光野 · 天文计算核心
 *
 * 这一层不含任何界面代码，纯数学，浏览器与 Node 都能跑（Node 侧用于 tests/ 里的核对）。
 * 太阳与行星、月球的轨道要素与摄动项取自 Paul Schlyter 的公开教程
 * "How to compute the orbital positions of Sun, Moon and planets"（第 3–13 节），
 * 标称精度：太阳与内行星优于 1 角分，外行星约 1 角分，月球 1–2 角分——
 * 对选机位、算时刻来说足够，不适合做历表出版。
 * 恒星自行（proper motion）不计，岁差用黄经整体进动近似。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LFAstro = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var D2R = Math.PI / 180;
  var R2D = 180 / Math.PI;
  var J2000 = 2451545.0;
  // Schlyter 的 "day number" 起点：2000-01-00.0 UT
  var D0 = 2451543.5;
  // 黄赤交角（含长期变化，J2000 起算）
  function obliquity(d) { return 23.4393 - 3.563e-7 * d; }
  // 黄道整体岁差速率：约 5029"/年
  var PRECESS_PER_CENTURY = 1.3968138;

  function sin(deg) { return Math.sin(deg * D2R); }
  function cos(deg) { return Math.cos(deg * D2R); }
  function tan(deg) { return Math.tan(deg * D2R); }
  function asin(x) { return Math.asin(clamp(x, -1, 1)) * R2D; }
  function atan2(y, x) { return Math.atan2(y, x) * R2D; }
  function acos(x) { return Math.acos(clamp(x, -1, 1)) * R2D; }
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function norm360(x) { x %= 360; return x < 0 ? x + 360 : x; }
  function norm180(x) { while (x > 180) x -= 360; while (x < -180) x += 360; return x; }

  /* ---------- 时间 ---------- */

  function julianDay(date) { return date.getTime() / 86400000 + 2440587.5; }
  function dateFromJulian(jd) { return new Date((jd - 2440587.5) * 86400000); }
  function dayNumber(date) { return julianDay(date) - D0; }

  // 恒星时：格林尼治视恒星时的近似式（省略交点差，误差 < 0.1"/时间，即 < 0.001° 方位）
  function gmst(jd) {
    var T = (jd - J2000) / 36525;
    return norm360(
      280.46061837 +
      360.98564736629 * (jd - J2000) +
      0.000387933 * T * T -
      T * T * T / 38710000
    );
  }
  // 地方恒星时：东经为正
  function lst(jd, lonEast) { return norm360(gmst(jd) + lonEast); }

  /* ---------- 天体位置（赤道，of-date） ---------- */

  function sunElements(d) {
    return {
      w: 282.9404 + 4.70935e-5 * d,
      e: 0.016709 - 1.151e-9 * d,
      M: norm360(356.0470 + 0.9856002585 * d),
      a: 1.0
    };
  }

  // 开普勒方程一阶解，e 大时迭代（Schlyter 第 6 节）
  function eccentricAnomaly(M, e) {
    var E = M + e * R2D * sin(M) * (1 + e * cos(M));
    if (e > 0.05) {
      for (var i = 0; i < 8; i++) {
        var dE = (E - e * R2D * sin(E) - M) / (1 - e * cos(E));
        E -= dE;
        if (Math.abs(dE) < 1e-6) break;
      }
    }
    return E;
  }

  function trueAnomaly(E, e, a) {
    var xv = a * (cos(E) - e);
    var yv = a * Math.sqrt(1 - e * e) * sin(E);
    return { v: atan2(yv, xv), r: Math.hypot(xv, yv) };
  }

  // 太阳：黄道面内运动，可直接走简化路径
  function sunPos(date) {
    var d = dayNumber(date);
    var el = sunElements(d);
    var E = eccentricAnomaly(el.M, el.e);
    var ta = trueAnomaly(E, el.e, 1);
    var lon = ta.v + el.w;
    var ecl = obliquity(d);
    var xs = ta.r * cos(lon), ys = ta.r * sin(lon);
    return {
      jd: julianDay(date), d: d,
      ra: norm360(atan2(ys * cos(ecl), xs)),
      dec: asin(ys * sin(ecl) / ta.r),
      lon: norm360(lon), r: ta.r,
      M: el.M, w: el.w
    };
  }

  var MOON_ELEMENTS = function (d) {
    return {
      N: 125.1228 - 0.0529538083 * d,
      i: 5.1454,
      w: 318.0634 + 0.1643573223 * d,
      a: 60.2666,           // 地球半径
      e: 0.054900,
      M: norm360(115.3654 + 13.0649929509 * d)
    };
  };

  var PLANETS = {
    mercury: { N: [48.3313, 3.24587e-5], i: [7.0047, 5.0e-8], w: [29.1241, 1.01444e-5], a: [0.387098, 0], e: [0.205635, 5.59e-10], M: [168.6562, 4.0923344368] },
    venus:   { N: [76.6799, 2.46590e-5], i: [3.3946, 2.75e-8], w: [54.8910, 1.38374e-5], a: [0.723330, 0], e: [0.006773, -1.302e-9], M: [48.0052, 1.6021302244] },
    mars:    { N: [49.5574, 2.11081e-5], i: [1.8497, -1.78e-8], w: [286.5016, 2.92961e-5], a: [1.523688, 0], e: [0.093405, 2.516e-9], M: [18.6021, 0.5240207766] },
    jupiter: { N: [100.4542, 2.76854e-5], i: [1.3030, -1.557e-7], w: [273.8777, 1.64505e-5], a: [5.20256, 0], e: [0.048498, 4.469e-9], M: [19.8950, 0.0830853001] },
    saturn:  { N: [113.6634, 2.38980e-5], i: [2.4886, -1.081e-7], w: [339.3939, 2.97661e-5], a: [9.55475, 0], e: [0.055546, -9.499e-9], M: [316.9670, 0.0334442282] },
    uranus:  { N: [74.0005, 1.3978e-5], i: [0.7733, 1.9e-8], w: [96.6612, 3.0565e-5], a: [19.18171, -1.55e-8], e: [0.047318, 7.45e-9], M: [142.5905, 0.011725806] },
    neptune: { N: [131.7806, 3.0173e-5], i: [1.7700, -2.55e-7], w: [272.8461, -6.027e-6], a: [30.05826, 3.313e-8], e: [0.008606, 2.15e-9], M: [260.2471, 0.005995147] }
  };

  function planetElements(key, d) {
    var p = PLANETS[key], out = {};
    for (var k in p) out[k] = p[k][0] + p[k][1] * d;
    out.M = norm360(out.M);
    out.N = norm360(out.N);
    out.w = norm360(out.w);
    return out;
  }

  // 黄道坐标 → 赤道坐标
  function eclipticToEquatorial(xg, yg, zg, ecl) {
    var xe = xg;
    var ye = yg * cos(ecl) - zg * sin(ecl);
    var ze = yg * sin(ecl) + zg * cos(ecl);
    return {
      ra: norm360(atan2(ye, xe)),
      dec: asin(ze / Math.hypot(xe, ye, ze)),
      rg: Math.hypot(xg, yg, zg)
    };
  }

  /* 月球：含 13 项经度摄动、5 项纬度摄动、2 项距离摄动（Schlyter 第 9 节） */
  function moonPos(date, opts) {
    opts = opts || {};
    var d = dayNumber(date);
    var jd = julianDay(date);
    var el = MOON_ELEMENTS(d);
    var sun = sunElements(d);
    var E = eccentricAnomaly(el.M, el.e);
    var ta = trueAnomaly(E, el.e, el.a);
    var v = ta.v, r = ta.r;
    var xh = r * (cos(el.N) * cos(v + el.w) - sin(el.N) * sin(v + el.w) * cos(el.i));
    var yh = r * (sin(el.N) * cos(v + el.w) + cos(el.N) * sin(v + el.w) * cos(el.i));
    var zh = r * (sin(v + el.w) * sin(el.i));
    var lonecl = atan2(yh, xh), latecl = atan2(zh, Math.hypot(xh, yh));

    var Ms = sun.M, Mm = el.M, Nm = el.N, ws = sun.w, wm = el.w;
    var Ls = norm360(Ms + ws);
    var Lm = norm360(Mm + wm + Nm);
    var Dn = norm360(Lm - Ls);
    var Fn = norm360(Lm - Nm);

    lonecl += -1.274 * sin(Mm - 2 * Dn)      // 偶均
      + 0.658 * sin(2 * Dn)                  // 月行不均
      - 0.186 * sin(Ms)                      // 周年差
      - 0.059 * sin(2 * Mm - 2 * Dn)
      - 0.057 * sin(Mm - 2 * Dn + Ms)
      + 0.053 * sin(Mm + 2 * Dn)
      + 0.046 * sin(2 * Dn - Ms)
      + 0.041 * sin(Mm - Ms)
      - 0.035 * sin(Dn)                      // 视差方程
      - 0.031 * sin(Mm + Ms)
      - 0.015 * sin(2 * Fn - 2 * Dn)
      + 0.011 * sin(Mm - 4 * Dn);
    latecl += -0.173 * sin(Fn - 2 * Dn)
      - 0.055 * sin(Mm - Fn - 2 * Dn)
      - 0.046 * sin(Mm + Fn - 2 * Dn)
      + 0.033 * sin(Fn + 2 * Dn)
      + 0.017 * sin(2 * Mm + Fn);
    r += -5.8e-1 * cos(Mm - 2 * Dn) - 4.6e-1 * cos(2 * Dn);

    lonecl = norm360(lonecl);
    var xg = r * cos(lonecl) * cos(latecl);
    var yg = r * sin(lonecl) * cos(latecl);
    var zg = r * sin(latecl);
    var ecl = obliquity(d);
    var eq = eclipticToEquatorial(xg, yg, zg, ecl);
    eq.lon = lonecl; eq.lat = latecl; eq.dist = r;   // r：地球半径
    eq.jd = jd; eq.d = d;

    if (opts.topocentric) {
      var topo = toTopocentric(eq, date, opts.latitude || 0, opts.longitude || 0);
      eq.ra = topo.ra; eq.dec = topo.dec;
      eq.parallax = asin(1 / r);
    }
    return eq;
  }

  /* 站心改正（Schlyter 第 13 节）：对月球可达 1° 以上，必须算 */
  function toTopocentric(body, date, lat, lonEast) {
    var mpar = body.dist && body.dist < 1e3 ? asin(1 / body.dist) : asin((8.794 / 3600) / body.rg);
    var gclat = lat - 0.1924 * sin(2 * lat);
    var rho = 0.99833 + 0.00167 * cos(2 * lat);
    var HA = norm180(lst(julianDay(date), lonEast) - body.ra);
    var g = atan2(tan(gclat), cos(HA));
    var denom = sin(g);
    var dra, ddec;
    if (Math.abs(lat) < 1e-6) {
      ddec = -mpar * rho * sin(-body.dec) * cos(HA);
      dra = -mpar * rho * cos(gclat) * sin(HA) / cos(body.dec);
    } else {
      ddec = -mpar * rho * sin(gclat) * sin(g - body.dec) / denom;
      dra = -mpar * rho * cos(gclat) * sin(HA) / cos(body.dec);
    }
    return { ra: norm360(body.ra + dra), dec: body.dec + ddec };
  }

  /* 行星：日心 → 地心，含木/土/天王星主要摄动（Schlyter 第 10 节） */
  function planetPos(key, date, opts) {
    opts = opts || {};
    var d = dayNumber(date);
    var el = planetElements(key, d);
    var E = eccentricAnomaly(el.M, el.e);
    var ta = trueAnomaly(E, el.e, el.a);
    var v = ta.v, r = ta.r;
    var xh = r * (cos(el.N) * cos(v + el.w) - sin(el.N) * sin(v + el.w) * cos(el.i));
    var yh = r * (sin(el.N) * cos(v + el.w) + cos(el.N) * sin(v + el.w) * cos(el.i));
    var zh = r * (sin(v + el.w) * sin(el.i));
    var lonecl = atan2(yh, xh), latecl = atan2(zh, Math.hypot(xh, yh));

    var Mj = planetElements('jupiter', d).M;
    var Msa = planetElements('saturn', d).M;
    var Mu = planetElements('uranus', d).M;
    if (key === 'jupiter') {
      lonecl += -0.332 * sin(2 * Mj - 5 * Msa - 67.6)
        - 0.056 * sin(2 * Mj - 2 * Msa + 21)
        + 0.042 * sin(3 * Mj - 5 * Msa + 21)
        - 0.036 * sin(Mj - 2 * Msa)
        + 0.022 * cos(Mj - Msa)
        + 0.023 * sin(2 * Mj - 3 * Msa + 52)
        - 0.016 * sin(Mj - 5 * Msa - 69);
    } else if (key === 'saturn') {
      lonecl += 0.812 * sin(2 * Mj - 5 * Msa - 67.6)
        - 0.229 * cos(2 * Mj - 4 * Msa - 2)
        + 0.119 * sin(Mj - 2 * Msa - 3)
        + 0.046 * sin(2 * Mj - 6 * Msa - 69)
        + 0.014 * sin(Mj - 3 * Msa + 32);
      latecl += -0.020 * cos(2 * Mj - 4 * Msa - 2)
        + 0.018 * sin(2 * Mj - 6 * Msa - 49);
    } else if (key === 'uranus') {
      lonecl += 0.040 * sin(Msa - 2 * Mu + 6)
        + 0.035 * sin(Msa - 3 * Mu + 33)
        - 0.015 * sin(Mj - Mu + 20);
    }
    lonecl = norm360(lonecl);

    xh = r * cos(lonecl) * cos(latecl);
    yh = r * sin(lonecl) * cos(latecl);
    zh = r * sin(latecl);

    var sun = sunPos(date);
    var rs = sun.r, lonsun = sun.lon;
    var xg = xh + rs * cos(lonsun);
    var yg = yh + rs * sin(lonsun);
    var zg = zh;
    // 注意：eq.lon 必须是"地心"黄经。lonecl 在这里还是日心的，
    // 直接拿它跟太阳地心黄经作差算距角会错到 180°，tests 里靠金水距角上限卡住这个 bug。
    var eq = eclipticToEquatorial(xg, yg, zg, obliquity(d));
    eq.lon = norm360(atan2(yg, xg));
    eq.lat = asin(zg / Math.hypot(xg, yg, zg));
    eq.distSun = r;
    eq.elongation = norm180(eq.lon - sun.lon);
    if (opts.topocentric) {
      var topo = toTopocentric(eq, date, opts.latitude || 0, opts.longitude || 0);
      eq.ra = topo.ra; eq.dec = topo.dec;
    }
    // 亮度假设：目视级按日心距与相角粗略估计，只用于排序与图标大小
    eq.mag = approxPlanetMagnitude(key, r, eq.rg, eq.elongation);
    return eq;
  }

  function approxPlanetMagnitude(key, rHelio, rGeo, elong) {
    // 通式：H = H0 + 5log10(r·Δ) + 相角项；系数取常见平均值，仅供显示排序
    var base = { mercury: -0.6, venus: -4.2, mars: -1.5, jupiter: -9.4, saturn: -0.5, uranus: -7.0, neptune: -6.9 }[key];
    if (base === undefined) return 5;
    var phase = clamp(Math.abs(norm180(elong)) / 180, 0, 1);
    var phaseTerm = key === 'venus' ? 0.0004 * Math.pow(180 * phase, 3)
      : key === 'mercury' ? 0.0003 * Math.pow(180 * phase, 3)
      : 0.02 * 180 * phase;
    return base + 5 * Math.log10(Math.max(rHelio * rGeo, 1e-6)) + phaseTerm;
  }

  /* ---------- 地平坐标 ---------- */

  /* 大气折射（Bennett 1982，含气压气温订正）。
   * 注意：算升落时刻时不要用这里的结果叠加 —— 太阳升落的 -0.833° 门限里
   * 已经含了折射与半直径，叠加会重复订正。 */
  function refraction(altDeg, pressureHpa, tempC) {
    if (altDeg < -1.2) return 0;
    var h = altDeg;
    var R = 1.02 / tan(h + 10.3 / (h + 5.11)) / 60;
    R *= (pressureHpa || 1010) / 1010 * 283 / (273 + (tempC === undefined ? 10 : tempC));
    return R;
  }

  // ra/dec → 地平（az 从真北起顺时针，alt 为几何高度）
  function toHorizontal(ra, dec, date, lat, lonEast) {
    var HA = norm180(lst(julianDay(date), lonEast) - ra);
    var x = cos(HA) * cos(dec);
    var y = sin(HA) * cos(dec);
    var z = sin(dec);
    var xhor = x * sin(lat) - z * cos(lat);
    var yhor = y;
    var zhor = x * cos(lat) + z * sin(lat);
    return {
      az: norm360(atan2(yhor, xhor) + 180),
      alt: asin(zhor),
      ha: HA
    };
  }

  // 视位置（含折射）
  function apparentHorizontal(body, date, lat, lonEast, opt) {
    opt = opt || {};
    var h = toHorizontal(body.ra, body.dec, date, lat, lonEast);
    h.apparentAlt = h.alt + (opt.refraction === false ? 0 : refraction(h.alt, opt.pressure, opt.temp));
    return h;
  }

  /* ---------- 升起 / 落下 / 过中天 ---------- */

  /* 在 [start,end] 内找 alt 穿越 threshold 的时刻。
   * 先按 stepMin 粗扫找变号区间，再二分收敛到 <0.1 秒。 */
  function crossings(start, end, stepMin, altFn, threshold) {
    var out = [];
    var step = stepMin * 60000;
    var prevT = start, prevV = altFn(prevT) - threshold;
    for (var t = start.getTime() + step; t <= end.getTime(); t += step) {
      var d = new Date(t);
      var v = altFn(d) - threshold;
      if (isFinite(prevV) && isFinite(v) && (prevV < 0 && v >= 0 || prevV > 0 && v <= 0)) {
        var lo = prevT.getTime(), hi = t;
        for (var i = 0; i < 40; i++) {
          var mid = (lo + hi) / 2;
          var vm = altFn(new Date(mid)) - threshold;
          if ((vm < 0) === (prevV < 0)) lo = mid; else hi = mid;
          if (hi - lo < 100) break;
        }
        out.push({ time: new Date((lo + hi) / 2), rising: prevV < 0 });
      }
      prevT = new Date(t); prevV = v;
    }
    return out;
  }

  // 太阳赤纬随时间变化，altFn 里重新求位置即可，无需外部插值
  function solarAltFn(lonEast, lat) {
    return function (date) {
      var s = sunPos(date);
      return toHorizontal(s.ra, s.dec, date, lat, lonEast).alt;
    };
  }
  function lunarAltFn(lonEast, lat, opts) {
    return function (date) {
      var m = moonPos(date, { topocentric: true, latitude: lat, longitude: lonEast, opts: opts });
      return toHorizontal(m.ra, m.dec, date, lat, lonEast).alt;
    };
  }

  /* 某地的“民用日”（以时区偏移为准，东为正，单位分钟）→ UTC 起止 */
  function civilDayRange(y, m1, d1, tzOffsetMin) {
    var start = new Date(Date.UTC(y, m1 - 1, d1, 0, 0, 0));
    start = new Date(start.getTime() - tzOffsetMin * 60000);
    return { start: start, end: new Date(start.getTime() + 86400000) };
  }

  // 太阳过中天（上中天）：在正午附近找 HA 极值 → 用高度极大值时刻
  function solarTransit(range, lonEast, lat) {
    var fn = solarAltFn(lonEast, lat);
    var best = null;
    var steps = 96;
    for (var i = 0; i <= steps; i++) {
      var t = new Date(range.start.getTime() + (86400000 * i) / steps);
      var a = fn(t);
      if (!best || a > best.alt) best = { time: t, alt: a };
    }
    // 局部细化
    var lo = best.time.getTime() - 86400000 / steps;
    var hi = best.time.getTime() + 86400000 / steps;
    for (var j = 0; j < 40; j++) {
      var m1t = lo + (hi - lo) / 3, m2t = hi - (hi - lo) / 3;
      if (fn(new Date(m1t)) < fn(new Date(m2t))) lo = m1t; else hi = m2t;
    }
    var tt = new Date((lo + hi) / 2);
    return { time: tt, alt: fn(tt) };
  }

  /* 一整天里的太阳事件：升、落、三段晨昏蒙影、黄金/蓝调时刻边界 */
  function sunEvents(y, m1, d1, lat, lonEast, tzOffsetMin) {
    var range = civilDayRange(y, m1, d1, tzOffsetMin);
    var fn = solarAltFn(lonEast, lat);
    var res = { date: { y: y, m: m1, d: d1 }, latitude: lat, longitude: lonEast, timeZone: tzOffsetMin };
    var rise = crossings(range.start, range.end, 2, fn, -0.833);
    res.sunrise = rise.length ? rise[0].time : null;
    res.sunset = rise.length > 1 ? rise[rise.length - 1].time : null;
    res.polarDay = rise.length === 0 && fn(range.start) > -0.833;
    res.polarNight = rise.length === 0 && fn(range.start) < -0.833;
    res.transit = solarTransit(range, lonEast, lat);

    function windowFor(alt, dir) {
      var c = crossings(range.start, range.end, 2, fn, alt);
      return c.filter(function (e) { return e.rising === dir; }).map(function (e) { return e.time; });
    }
    res.civil = { end: windowFor(-6, false), start: windowFor(-6, true) };
    res.nautical = { end: windowFor(-12, false), start: windowFor(-12, true) };
    res.astronomical = { end: windowFor(-18, false), start: windowFor(-18, true) };
    res.golden = { evening: windowFor(6, false), morning: windowFor(6, true) };
    res.dayLength = res.transit.alt > -0.833 && res.sunrise && res.sunset
      ? (res.sunset - res.sunrise) / 3600000 : null;
    return res;
  }

  /* 月亮：升落、过中天、月照面积、位相 */
  function moonEvents(y, m1, d1, lat, lonEast, tzOffsetMin) {
    var range = civilDayRange(y, m1, d1, tzOffsetMin);
    var fn = lunarAltFn(lonEast, lat);
    var res = {};
    var mr = crossings(range.start, range.end, 3, fn, 0.125);
    res.moonrise = mr.length ? mr[0].time : null;
    res.moonset = mr.length > 1 ? mr[mr.length - 1].time : null;
    var noon = new Date(range.start.getTime() + 43200000);
    var p = moonPos(noon, { topocentric: true, latitude: lat, longitude: lonEast });
    var best = null;
    for (var i = 0; i <= 96; i++) {
      var t = new Date(range.start.getTime() + (86400000 * i) / 96);
      var q = moonPos(t, { topocentric: true, latitude: lat, longitude: lonEast });
      var hh = toHorizontal(q.ra, q.dec, t, lat, lonEast);
      if (!best || hh.alt > best.alt) best = { alt: hh.alt, time: t };
    }
    res.transit = best;
    res.illumination = moonIllumination(noon);
    res.distanceEarthRadii = p.dist;
    return res;
  }

  // 月龄与照面：以“日月黄经差”为相位角。月龄要回溯找朔，代价高，默认关，
  // 只有单点显示（界面顶部那一行）才传 opts.age。
  function moonIllumination(date, opts) {
    opts = opts || {};
    var m = moonPos(date);
    var s = sunPos(date);
    var elong = norm360(m.lon - s.lon);
    var frac = (1 - cos(elong)) / 2;
    var waxing = elong < 180;
    return {
      elongation: elong,
      fraction: clamp(frac, 0, 1),
      waxing: waxing,
      ageDays: opts.age ? moonAge(date) : null,
      phaseName: phaseName(frac, waxing, elong),
      sunMoonSeparation: acos(cos(m.dec) * cos(s.dec) * cos(m.ra - s.ra) + sin(m.dec) * sin(s.dec))
    };
  }

  function elongOf(date) {
    return norm360(moonPos(date).lon - sunPos(date).lon);
  }

  /* 月龄：从给定时刻往回走，日黄经差逐日减小；跨过 0（=朔）时会跳回接近 360。
   * 判据是“往回走却突然变大”，即 e - prev > 180。老写法用 e>180 定位，
   * 亏凸月当天就会命中，返回负数，已推翻。 */
  function moonAge(date) {
    var stepMs = 6 * 3600000;
    var prev = elongOf(date);
    for (var k = 1; k <= 140; k++) {
      var tMs = date.getTime() - k * stepMs;
      var e = elongOf(new Date(tMs));
      if (e - prev > 180) {
        var lo = tMs, hi = tMs + stepMs;
        for (var i = 0; i < 30; i++) {
          var mid = (lo + hi) / 2;
          if (elongOf(new Date(mid)) > 180) lo = mid; else hi = mid;
        }
        return (date.getTime() - (lo + hi) / 2) / 86400000;
      }
      prev = e;
    }
    return null;
  }

  /* 朔与望：在 [start,end] 内找相位角的穿越点，用于路书的月相历。
   * 往前推时黄经差是 359→1 的“向下跳变”，所以朔的判据是 prev - e > 180；
   * 回溯月龄时方向相反（向上跳），别把两处判据写成同一个。 */
  function phaseCrossings(start, end, target) {
    var stepMs = 2 * 3600000;
    var out = [];
    var prev = elongOf(start);
    for (var t = start.getTime() + stepMs; t <= end.getTime(); t += stepMs) {
      var e = elongOf(new Date(t));
      var wrapped = prev - e > 180;          // 跨过朔
      var hit;
      if (target === 0) hit = wrapped;
      else hit = !wrapped && prev < target && e >= target;
      if (hit) {
        var lo = t - stepMs, hi = t;
        for (var i = 0; i < 30; i++) {
          var mid = (lo + hi) / 2;
          var em = elongOf(new Date(mid));
          var before = target === 0 ? em > 180 : em < target;
          if (before) lo = mid; else hi = mid;
        }
        out.push(new Date((lo + hi) / 2));
      }
      prev = e;
    }
    return out;
  }

  function syzygyWindow(date, daysBefore, daysAfter) {
    var start = new Date(date.getTime() - (daysBefore || 16) * 86400000);
    var end = new Date(date.getTime() + (daysAfter || 16) * 86400000);
    return {
      newMoons: phaseCrossings(start, end, 0),
      fullMoons: phaseCrossings(start, end, 180)
    };
  }

  function phaseName(frac, waxing, elong) {
    if (elong < 8 || elong > 352) return '朔';
    if (elong > 172) return '望';
    if (Math.abs(elong - 90) < 8) return waxing ? '上弦' : '下弦';
    if (elong < 90) return waxing ? '蛾眉月' : '残月';
    if (elong < 172) return '盈凸月';
    return '亏凸月';
  }

  /* ---------- 银道坐标与银河 ---------- */

  // IAU 1958 银道系：银极与银心（J2000）
  var NGP = { ra: 192.85948, dec: 27.12825 };
  var GCENTER = { ra: 266.4051, dec: -28.9362 };   // Sgr A* 方向，银经 0

  function unit(ra, dec) {
    return [cos(dec) * cos(ra), cos(dec) * sin(ra), sin(dec)];
  }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  var _p = unit(NGP.ra, NGP.dec);
  var _c = unit(GCENTER.ra, GCENTER.dec);
  // 银经递增方向：银极 × 银心（右手系；tests 用 Vega/Polaris 校验，若反了这里就是错的）
  var _e2 = cross(_p, _c);

  function equatorialToGalactic(ra, dec) {
    var v = unit(ra, dec);
    var b = asin(v[0] * _p[0] + v[1] * _p[1] + v[2] * _p[2]);
    var l = norm360(atan2(v[0] * _e2[0] + v[1] * _e2[1] + v[2] * _e2[2],
                         v[0] * _c[0] + v[1] * _c[1] + v[2] * _c[2]));
    return { l: l, b: b };
  }

  function galacticToEquatorial(l, b) {
    var x = cos(b) * cos(l), y = cos(b) * sin(l), z = sin(b);
    // v = x*c + y*e2 + z*p
    var v = [
      x * _c[0] + y * _e2[0] + z * _p[0],
      x * _c[1] + y * _e2[1] + z * _p[1],
      x * _c[2] + y * _e2[2] + z * _p[2]
    ];
    return { ra: norm360(atan2(v[1], v[0])), dec: asin(v[2]) };
  }

  /* 岁差：J2000 平位置 → of-date（只改正黄经，忽略章动与自行） */
  function precess(raJ2000, decJ2000, d) {
    var ecl = obliquity(d);
    var sb = sin(decJ2000) * cos(ecl) - cos(decJ2000) * sin(ecl) * sin(raJ2000);
    var beta = asin(sb);
    var lam = norm360(atan2(sin(raJ2000) * cos(ecl) + tan(decJ2000) * sin(ecl), cos(raJ2000)));
    var p = PRECESS_PER_CENTURY * (d / 365.25 / 100);
    var lam2 = norm360(lam + p);
    var dec2 = asin(sin(beta) * cos(ecl) + cos(beta) * sin(ecl) * sin(lam2));
    var ra2 = norm360(atan2(sin(lam2) * cos(ecl) - tan(beta) * sin(ecl), cos(lam2)));
    return { ra: ra2, dec: dec2 };
  }

  /* ---------- 拍摄时机（风光/星空的可算部分） ---------- */

  /* 银心（人马方向）：取银经 4° 附近为银河最亮段中心 */
  var CORE_L = 4, CORE_B = 0;
  function coreJ2000() { return galacticToEquatorial(CORE_L, CORE_B); }

  function galacticCoreAltFn(lonEast, lat) {
    var gc = coreJ2000();
    return function (t) {
      var pr = precess(gc.ra, gc.dec, dayNumber(t));
      return toHorizontal(pr.ra, pr.dec, t, lat, lonEast).alt;
    };
  }

  function galacticCoreEvents(y, m1, d1, lat, lonEast, tzOffsetMin) {
    var range = civilDayRange(y, m1, d1, tzOffsetMin);
    var fn = galacticCoreAltFn(lonEast, lat);
    var ev = crossings(range.start, range.end, 4, fn, 0);
    var rise = ev.filter(function (e) { return e.rising; });
    var set = ev.filter(function (e) { return !e.rising; });
    var max = null;
    for (var i = 0; i <= 96; i++) {
      var t = new Date(range.start.getTime() + (86400000 * i) / 96);
      var a = fn(t);
      if (!max || a > max.alt) max = { alt: a, time: t };
    }
    return {
      rise: rise.length ? rise[0].time : null,
      set: set.length ? set[0].time : null,
      transit: max, ra: coreJ2000().ra, dec: coreJ2000().dec
    };
  }

  /* 一夜的推演：从当日日落起到次日日出，5 分钟一格。
   * 银河摄影的判断都在这里出，界面只做展示，不再重复算第二套。 */
  function nightPlan(y, m1, d1, lat, lonEast, tzOffsetMin, opts) {
    opts = opts || {};
    var minCoreAlt = opts.minCoreAlt === undefined ? 5 : opts.minCoreAlt;
    var sun = sunEvents(y, m1, d1, lat, lonEast, tzOffsetMin);
    // "次日"必须按本地日历推。早先用 transit+12h 当次日、又分别从 UTC 取年月、
    // 从加了时区的瞬间取日，两套坐标系拼一个日期：月末最后一天、以及站点位于
    // 时区中央经线以东（本地正午早于 12:00）时，那个瞬间还没跨过本地午夜，
    // 算出来仍是今天 → end 早于 start → 整晚零采样（实测 40 个预设站在月末全中）。
    // Date.UTC 自己会跨月跨年，直接用它推下一天。
    var nd1 = new Date(Date.UTC(y, m1 - 1, d1 + 1));
    var sun2 = sunEvents(nd1.getUTCFullYear(), nd1.getUTCMonth() + 1, nd1.getUTCDate(), lat, lonEast, tzOffsetMin);
    var start = sun.sunset || new Date(sun.transit.time.getTime() + 21600000);
    var end = sun2.sunrise || new Date(sun2.transit.time.getTime() - 21600000);
    var coreFn = galacticCoreAltFn(lonEast, lat);
    var step = 5 * 60000;
    var samples = [], best = null, sum = 0, count = 0;
    for (var t = start.getTime(); t <= end.getTime(); t += step) {
      var d = new Date(t);
      var sp = sunPos(d);
      var sunAlt = toHorizontal(sp.ra, sp.dec, d, lat, lonEast).alt;
      var coreAlt = coreFn(d);
      var moon = moonPos(d, { topocentric: true, latitude: lat, longitude: lonEast });
      var moonAlt = toHorizontal(moon.ra, moon.dec, d, lat, lonEast).alt;
      var ill = moonIllumination(d).fraction;
      var dark = sunAlt < -18 ? 1 : sunAlt > -6 ? 0 : clamp((-sunAlt - 6) / 12, 0, 1);
      var coreScore = clamp((coreAlt - minCoreAlt) / 30, 0, 1);
      var moonWeight = moonAlt < 0 ? 0 : clamp(ill * (0.4 + 0.6 * clamp(moonAlt / 30, 0, 1)), 0, 1);
      var score = dark * coreScore * (1 - 0.85 * moonWeight);
      var s = { time: d, sunAlt: sunAlt, coreAlt: coreAlt, moonAlt: moonAlt, moonFraction: ill, dark: dark, score: score };
      samples.push(s);
      if (score > 0) { sum += score; count++; }
      if (!best || score > best.score) best = s;
    }
    var usable = samples.filter(function (s) { return s.dark > 0.9 && s.coreAlt > minCoreAlt; });
    return {
      date: { y: y, m: m1, d: d1 }, sun: sun,
      start: start, end: end,
      samples: samples,
      best: best,
      scoreAverage: count / Math.max(samples.length, 1),
      window: usable.length ? { start: usable[0].time, end: usable[usable.length - 1].time, minutes: usable.length * 5 } : null,
      maxCoreAlt: samples.reduce(function (a, s) { return Math.max(a, s.coreAlt); }, -90),
      minCoreAlt: minCoreAlt
    };
  }

  /* 月光污染：照面 × 月心距 × 高度，返回 0–1 的干扰系数 */
  function moonInterference(date, lat, lonEast) {
    var m = moonPos(date, { topocentric: true, latitude: lat, longitude: lonEast });
    var h = toHorizontal(m.ra, m.dec, date, lat, lonEast);
    var ill = moonIllumination(date).fraction;
    if (h.alt < -2) return 0;
    var altWeight = clamp((h.alt + 2) / 30, 0, 1);
    return clamp(ill * (0.35 + 0.65 * altWeight), 0, 1);
  }

  /* 给一个时刻打“星空可拍分”：黑夜 + 无月 + 银心高度 */
  function astroScore(date, lat, lonEast, tzOffsetMin) {
    var s = sunPos(date);
    var sa = toHorizontal(s.ra, s.dec, date, lat, lonEast).alt;
    var darkness = sa < -18 ? 1 : sa > -6 ? 0 : clamp((-sa - 6) / 12, 0, 1);
    var gc = galacticToEquatorial(4, 0);
    var pr = precess(gc.ra, gc.dec, dayNumber(date));
    var coreAlt = toHorizontal(pr.ra, pr.dec, date, lat, lonEast).alt;
    var coreScore = clamp((coreAlt + 5) / 35, 0, 1);
    var moon = moonInterference(date, lat, lonEast);
    var score = darkness * coreScore * (1 - 0.85 * moon);
    return {
      darkness: darkness, coreAltitude: coreAlt, moonInterference: moon,
      score: score,
      sunAltitude: sa,
      label: score > 0.75 ? '极佳' : score > 0.5 ? '可拍' : score > 0.25 ? '勉强' : '不宜'
    };
  }

  /* 日落后的“黄金时刻—蓝调时刻—全黑”时间条（风光/旅拍用） */
  function lightPhases(sun) {
    var items = [];
    function push(name, time, kind) { if (time) items.push({ name: name, time: time, kind: kind }); }
    push('天文晨始', sun.astronomical.start[0], 'dark');
    push('航海晨始', sun.nautical.start[0], 'dark');
    push('民用晨始·蓝调', sun.civil.start[0], 'blue');
    push('日出', sun.sunrise, 'sun');
    push('黄金时刻结束', sun.golden.morning[0], 'gold');
    push('正午', sun.transit.time, 'day');
    push('黄金时刻开始', sun.golden.evening[0], 'gold');
    push('日落', sun.sunset, 'sun');
    push('民用昏终·蓝调结束', sun.civil.end[sun.civil.end.length - 1], 'blue');
    push('航海昏终', sun.nautical.end[sun.nautical.end.length - 1], 'dark');
    push('天文昏终·全黑', sun.astronomical.end[sun.astronomical.end.length - 1], 'dark');
    items.sort(function (a, b) { return a.time - b.time; });
    return items;
  }

  /* 太阳方位角曲线：给定时间序列，返回每刻的高度/方位，用于把光路画到地图上 */
  function sunPath(y, m1, d1, lat, lonEast, tzOffsetMin, stepMin) {
    var range = civilDayRange(y, m1, d1, tzOffsetMin);
    var out = [];
    var step = (stepMin || 10) * 60000;
    for (var t = range.start.getTime(); t <= range.end.getTime(); t += step) {
      var d = new Date(t);
      var s = sunPos(d);
      var h = toHorizontal(s.ra, s.dec, d, lat, lonEast);
      if (h.alt > -6) out.push({ time: d, az: h.az, alt: h.alt });
    }
    return out;
  }

  /* 月—地—日几何：月出方位与“月照路径”（旅拍夜景补光判断） */
  function moonPath(y, m1, d1, lat, lonEast, tzOffsetMin, stepMin) {
    var range = civilDayRange(y, m1, d1, tzOffsetMin);
    var out = [];
    var step = (stepMin || 15) * 60000;
    for (var t = range.start.getTime(); t <= range.end.getTime(); t += step) {
      var d = new Date(t);
      var m = moonPos(d, { topocentric: true, latitude: lat, longitude: lonEast });
      var h = toHorizontal(m.ra, m.dec, d, lat, lonEast);
      if (h.alt > -3) out.push({ time: d, az: h.az, alt: h.alt });
    }
    return out;
  }

  /* ---------- 时刻格式化（按拍摄地时区，不用浏览器本地时区） ---------- */

  function fmt(date, tzOffsetMin, withSeconds) {
    if (!date) return '—';
    var t = new Date(date.getTime() + tzOffsetMin * 60000);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    // 月在前、中间用短横：原来输出「26 10 12:18」这种"日 月"，读者要猜顺序，
    // 跨月时（10 10）更是完全读不出是哪天
    var s = p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()) + ' ' +
      p(t.getUTCHours()) + ':' + p(t.getUTCMinutes());
    if (withSeconds) s += ':' + p(t.getUTCSeconds());
    return s;
  }
  function fmtTime(date, tzOffsetMin, withSeconds) {
    if (!date) return '—';
    var t = new Date(date.getTime() + tzOffsetMin * 60000);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var s = p(t.getUTCHours()) + ':' + p(t.getUTCMinutes());
    return withSeconds ? s + ':' + p(t.getUTCSeconds()) : s;
  }
  // 方位角 → 罗盘（24 山中文）
  var COMPASS = ['北', '北偏东', '东北', '东偏北', '东', '东偏南', '东南', '南偏东',
    '南', '南偏西', '西南', '西偏南', '西', '西偏北', '西北', '北偏西'];
  function compass(az) {
    return COMPASS[Math.round(norm360(az) / 22.5) % 16];
  }

  return {
    D2R: D2R, R2D: R2D, clamp: clamp, norm360: norm360, norm180: norm180,
    julianDay: julianDay, dateFromJulian: dateFromJulian, dayNumber: dayNumber,
    gmst: gmst, lst: lst, obliquity: obliquity,
    sunPos: sunPos, moonPos: moonPos, planetPos: planetPos, planetKeys: Object.keys(PLANETS),
    toHorizontal: toHorizontal, apparentHorizontal: apparentHorizontal, refraction: refraction,
    crossings: crossings, civilDayRange: civilDayRange,
    sunEvents: sunEvents, moonEvents: moonEvents, moonIllumination: moonIllumination,
    elongOf: elongOf, syzygyWindow: syzygyWindow, phaseCrossings: phaseCrossings,
    equatorialToGalactic: equatorialToGalactic, galacticToEquatorial: galacticToEquatorial,
    precess: precess,
    galacticCoreEvents: galacticCoreEvents, galacticCoreAltFn: galacticCoreAltFn,
    nightPlan: nightPlan,
    moonInterference: moonInterference, astroScore: astroScore,
    lightPhases: lightPhases, sunPath: sunPath, moonPath: moonPath,
    fmt: fmt, fmtTime: fmtTime, compass: compass,
    NGP: NGP, GCENTER: GCENTER
  };
});
