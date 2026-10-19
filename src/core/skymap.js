/* 光野 · 星图渲染
 *
 * 两种投影：
 *   dome  —— 天顶向全穹顶（地平圈为外圈，北在上、东在右），看"银心今晚从哪面升起来"
 *   frame —— 以（朝向, 中心高度）为中心的经纬矩形投影，按焦段给视场，看"这个镜头能装下多少银河"
 * 投影公式在 dome 下是等角的（r ∝ 90°-alt），frame 下用切平面近似：
 *   x = Δaz·cos(alt) / tan(fovH/2)，y = (alt-alt0) / tan(fovV/2)
 * 视场 >60° 时 frame 的形状畸变到 3% 量级，界面上写清楚，不假装是精确镜头预览。
 *
 * 恒星岁差按"天"缓存：1.4°/世纪 换算是每小时 2.5e-7 度，一晚上内根本不动，
 * 每帧再算 3249 次是白扔性能。
 */
(function (root) {
  'use strict';
  var A = root.LFAstro;

  var dayCache = { key: null, ra: null, dec: null };
  var galacticBands = null;   // J2000 的银道平行线，一次算好

  function ensureStars(dayKey, jdForPrecess) {
    if (dayCache.key === dayKey) return dayCache;
    var S = root.LFStars, n = S.meta.count, stride = S.meta.stride;
    var ra = new Float32Array(n), dec = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var p = i * stride;
      var pr = A.precess(S.data[p], S.data[p + 1], jdForPrecess);
      ra[i] = pr.ra; dec[i] = pr.dec;
    }
    dayCache = { key: dayKey, ra: ra, dec: dec };
    return dayCache;
  }

  /* 银道平行线：b = -13..13，每条 240 个点（J2000 赤道坐标） */
  function ensureBands() {
    if (galacticBands) return galacticBands;
    var offs = [-13, -8, -4, 0, 4, 8, 13], out = [];
    for (var k = 0; k < offs.length; k++) {
      var pts = [];
      for (var l = 0; l <= 360; l += 1.5) {
        var e = A.galacticToEquatorial(l, offs[k]);
        pts.push(e.ra, e.dec);
      }
      out.push({ b: offs[k], pts: pts });
    }
    galacticBands = out;
    return out;
  }

  function bvColor(bv100) {
    var bv = bv100 / 100;
    if (bv < -0.2) return '#a8c4ff';
    if (bv < 0.15) return '#dce6ff';
    if (bv < 0.45) return '#f6f2e8';
    if (bv < 0.8) return '#ffe2b4';
    if (bv < 1.4) return '#ffc794';
    return '#ffab80';
  }

  function makeProjector(view, w, h, pad) {
    var site = view.site;
    var jd = A.julianDay(view.date);
    var lst = A.lst(jd, site.lon);
    if (view.mode === 'frame') {
      var halfW = Math.tan(view.fov.h * Math.PI / 360);
      var halfH = Math.tan(view.fov.v * Math.PI / 360);
      var cx = w / 2, cy = h / 2;
      var scale = Math.min((w / 2 - pad) / halfW, (h / 2 - pad) / halfH);
      return {
        lst: lst, scale: scale, mode: 'frame',
        project: function (ra, dec) {
          var hz = A.toHorizontal(ra, dec, view.date, site.lat, site.lon);
          if (hz.alt < -8) return null;
          var dAz = A.norm180(hz.az - view.center.az) * Math.cos(hz.alt * Math.PI / 180) / (180 / Math.PI);
          var x = cx + dAz / halfW * scale;
          var y = cy - (hz.alt - view.center.alt) / (180 / Math.PI) / halfH * scale;
          if (x < -40 || x > w + 40 || y < -40 || y > h + 40) return null;
          return { x: x, y: y, alt: hz.alt, az: hz.az };
        },
        degToPx: scale * (Math.PI / 180) / Math.max(halfW, 1e-6) * Math.max(halfW, halfH)
      };
    }
    var R = Math.min(w, h) / 2 - pad;
    var ccx = w / 2, ccy = h / 2;
    return {
      lst: lst, R: R, mode: 'dome', cx: ccx, cy: ccy,
      degToPx: R / 90,
      project: function (ra, dec) {
        var hz = A.toHorizontal(ra, dec, view.date, site.lat, site.lon);
        if (hz.alt < -6) return null;
        var r = (90 - hz.alt) / 90 * R;
        var a = hz.az * Math.PI / 180;
        return { x: ccx + r * Math.sin(a), y: ccy - r * Math.cos(a), alt: hz.alt, az: hz.az };
      }
    };
  }

  /* 背景：按太阳高度把天穹压暗或压亮，全黑以下的星空才有意义 */
  function paintSky(ctx, w, h, pr, view) {
    var s = A.sunPos(view.date);
    var sunAlt = A.toHorizontal(s.ra, s.dec, view.date, view.site.lat, view.site.lon).alt;
    var dark = clamp((sunAlt + 6) / 12, 0, 1);       // 0 = 全黑，1 = 民用晨昏以内
    var g;
    if (pr.mode === 'frame') {
      g = ctx.createLinearGradient(0, 0, 0, h);
    } else {
      g = ctx.createRadialGradient(pr.cx, pr.cy, 0, pr.cx, pr.cy, pr.R * 1.25);
    }
    function mix(c1, c2, t) {
      function parse(c) { var n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
      var a = parse(c1), b = parse(c2);
      return 'rgb(' + a.map(function (v, i) { return Math.round(v + (b[i] - v) * t); }).join(',') + ')';
    }
    var top = mix('#05070f', '#9fc3e8', dark * 0.9);
    var bottom = mix('#0a1024', '#e0b489', clamp(dark * (view.center && view.center.alt < 20 ? 1 : 0.4), 0, 1) * (sunAlt > -8 ? 1 : 0.25));
    g.addColorStop(0, top);
    g.addColorStop(pr.mode === 'frame' ? 0 : 0.35, mix('#070b18', '#7fa8d8', dark * 0.7));
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return { sunAlt: sunAlt, dark: dark };
  }
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

  var scratch = null;
  /** 银河带：先画进离屏画布，再一次性糊化叠回来。
   *  直接在主画布上叠四条粗描边会看出笔触和台阶，糊一层就是自然的云气。 */
  function drawMilky(ctx, pr, view, alpha) {
    var bands = ensureBands();
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    var cw = view.cssW, chh = view.cssH;
    if (!scratch) scratch = document.createElement('canvas');
    if (scratch.width !== Math.round(cw * dpr) || scratch.height !== Math.round(chh * dpr)) {
      scratch.width = Math.round(cw * dpr); scratch.height = Math.round(chh * dpr);
    }
    var sc = scratch.getContext('2d');
    sc.setTransform(dpr, 0, 0, dpr, 0, 0);
    sc.clearRect(0, 0, cw, chh);
    sc.save();
    sc.lineCap = 'round';
    sc.lineJoin = 'round';

    var dayNum = A.dayNumber(view.date);
    var paths = bands.map(function (band) {
      var segs = [], cur = [];
      for (var i = 0; i < band.pts.length; i += 2) {
        var p2 = A.precess(band.pts[i], band.pts[i + 1], dayNum);
        var p = pr.project(p2.ra, p2.dec);
        if (!p) { if (cur.length > 1) segs.push(cur); cur = []; continue; }
        cur.push(p);
      }
      if (cur.length > 1) segs.push(cur);
      return { b: band.b, segs: segs };
    });
    function stroke(width, color, within) {
      sc.strokeStyle = color;
      sc.lineWidth = width;
      paths.forEach(function (band) {
        if (Math.abs(band.b) > within) return;
        band.segs.forEach(function (seg) {
          sc.beginPath();
          sc.moveTo(seg[0].x, seg[0].y);
          for (var i = 1; i < seg.length; i++) sc.lineTo(seg[i].x, seg[i].y);
          sc.stroke();
        });
      });
    }
    var k = pr.degToPx;
    stroke(k * 27 * alpha, 'rgba(146,166,214,0.062)', 13);
    stroke(k * 17 * alpha, 'rgba(158,178,226,0.085)', 8);
    stroke(k * 9 * alpha, 'rgba(188,203,244,0.11)', 4);
    stroke(k * 3 * alpha, 'rgba(214,224,255,0.15)', 1.4);

    var core = A.galacticToEquatorial(20, 0);
    var cpre = A.precess(core.ra, core.dec, dayNum);
    var cp = pr.project(cpre.ra, cpre.dec);
    if (cp) {
      var rad = k * 17;
      var rg = sc.createRadialGradient(cp.x, cp.y, 0, cp.x, cp.y, rad);
      rg.addColorStop(0, 'rgba(255,236,205,' + (0.22 * alpha).toFixed(3) + ')');
      rg.addColorStop(0.45, 'rgba(206,216,255,' + (0.10 * alpha).toFixed(3) + ')');
      rg.addColorStop(1, 'rgba(206,216,255,0)');
      sc.fillStyle = rg;
      sc.beginPath();
      sc.ellipse(cp.x, cp.y, pr.mode === 'frame' ? rad * 1.5 : rad, rad, 0, 0, Math.PI * 2);
      sc.fill();
    }
    sc.restore();

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if ('filter' in ctx) ctx.filter = 'blur(' + Math.round(5 * dpr) + 'px)';
    ctx.drawImage(scratch, 0, 0);
    if ('filter' in ctx) ctx.filter = 'none';
    ctx.restore();
    return cp || null;
  }

  function drawStars(ctx, pr, view, opts) {
    var S = root.LFStars;
    var cache = ensureStars(opts.dayKey, opts.dayNum);
    var limit = opts.magLimit;
    var n = S.meta.count;
    var stride = S.meta.stride;   // 步长只在 meta 里给过一次，别当成顶层字段取成 undefined
    ctx.save();
    for (var i = 0; i < n; i++) {
      var mag = S.data[i * stride + 2];
      if (mag > limit) continue;
      var p = pr.project(cache.ra[i], cache.dec[i]);
      if (!p) continue;
      var r = Math.max(0.7, (5.9 - mag * 0.92)) * opts.sizeK;
      ctx.fillStyle = bvColor(S.data[i * stride + 3]);
      ctx.globalAlpha = clamp(0.34 + (6.5 - mag) / 6.5 * 0.66, 0.3, 1) * (1 - opts.sunWash);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (mag < 1.1 && opts.twinkle) {
        ctx.globalAlpha = 0.13 * (1 - opts.sunWash);
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 3.1, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (opts.names) {
      // 专名只标亮星，并按文字实际占位做区间避让：
      // 298 个名字全画、或只比锚点距离，都会糊成一片（"Deneb Kaitos Schemali" 能盖住三个短名）
      var cands = [];
      for (var j = 0; j < n; j++) {
        var li = S.data[j * stride + 4];
        var mg = S.data[j * stride + 2];
        if (li < 0 || mg > 1.9) continue;
        var q = pr.project(cache.ra[j], cache.dec[j]);
        if (q) cands.push({ x: q.x, y: q.y, t: S.labels[li], m: mg });
      }
      cands.sort(function (a, b) { return a.m - b.m; });
      ctx.font = '10px ' + (getComputedStyle(document.body).getPropertyValue('--font-ui') || 'sans-serif');
      ctx.textAlign = 'left';
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 3;
      var placed = [];
      for (var ci = 0; ci < cands.length; ci++) {
        var cd = cands[ci];
        cd.x0 = cd.x + 6; cd.x1 = cd.x0 + ctx.measureText(cd.t).width; cd.y0 = cd.y - 3;
        var clash = placed.some(function (p2) {
          return cd.x0 < p2.x1 + 5 && p2.x0 < cd.x1 + 5 && Math.abs(cd.y0 - p2.y0) < 11;
        });
        if (clash) continue;
        placed.push(cd);
        ctx.fillStyle = 'rgba(226,234,255,0.72)';
        ctx.fillText(cd.t, cd.x0, cd.y0);
      }
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  function drawConstellations(ctx, pr, view, opts) {
    var list = root.LFAsterisms;
    var cache = ensureStars(opts.dayKey, opts.dayNum);
    ctx.save();
    ctx.strokeStyle = 'rgba(126,160,225,' + (0.30 * (1 - opts.sunWash)).toFixed(3) + ')';
    ctx.lineWidth = 1;
    list.forEach(function (a) {
      a.seg.forEach(function (pair) {
        var p1 = starOf(pair[0]), p2 = starOf(pair[1]);
        if (!p1 || !p2) return;
        var q1 = pr.project(cache.ra[p1], cache.dec[p1]), q2 = pr.project(cache.ra[p2], cache.dec[p2]);
        if (!q1 || !q2) return;
        ctx.beginPath(); ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y); ctx.stroke();
      });
    });
    ctx.restore();

    // keyIndex 由 build-stars.js 生成（星群连线里用到的拜耳键 → 星表下标），
    // 界面上出现的每条线都能追回星表具体某颗星，不靠画师手描坐标
    function starOf(key) {
      var hit = opts.keyIndex && opts.keyIndex[key];
      return hit === undefined ? null : hit;
    }
  }

  function drawEcliptic(ctx, pr, view, alpha) {
    var e = A.obliquity(A.dayNumber(view.date));
    var segs = [], cur = [];
    for (var l = 0; l <= 360; l += 2) {
      var x = Math.cos(l * Math.PI / 180) * Math.cos(e * Math.PI / 180);
      var y = Math.sin(l * Math.PI / 180) * Math.cos(e * Math.PI / 180);
      var z = Math.sin(l * Math.PI / 180) * Math.sin(e * Math.PI / 180);
      var ra = A.norm360(Math.atan2(y, x) * 180 / Math.PI);
      var dec = Math.asin(clamp(z, -1, 1)) * 180 / Math.PI;
      var p = pr.project(ra, dec);
      if (!p) { if (cur.length > 1) segs.push(cur); cur = []; continue; }
      cur.push(p);
    }
    if (cur.length > 1) segs.push(cur);
    ctx.save();
    ctx.strokeStyle = 'rgba(240,180,106,' + (0.26 * alpha).toFixed(3) + ')';
    ctx.setLineDash([5, 6]); ctx.lineWidth = 1;
    segs.forEach(function (s) {
      ctx.beginPath(); ctx.moveTo(s[0].x, s[0].y);
      for (var i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y);
      ctx.stroke();
    });
    ctx.restore();
  }

  var PLANETS = [
    { key: 'mercury', cn: '水星', color: '#cfc6b8' },
    { key: 'venus', cn: '金星', color: '#ffe9b0' },
    { key: 'mars', cn: '火星', color: '#ff9d7a' },
    { key: 'jupiter', cn: '木星', color: '#ffe3a8' },
    { key: 'saturn', cn: '土星', color: '#f0dfa8' },
    { key: 'uranus', cn: '天王星', color: '#b6e4e8' },
    { key: 'neptune', cn: '海王星', color: '#9fb8ff' }
  ];
  function drawBodies(ctx, pr, view, opts) {
    var out = [];
    if (opts.layers.planets) {
      PLANETS.forEach(function (pl) {
        var b = A.planetPos(pl.key, view.date);
        var p = pr.project(b.ra, b.dec);
        if (!p) return;
        ctx.save();
        ctx.fillStyle = pl.color;
        ctx.shadowColor = pl.color; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(p.x, p.y, 3.1, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '10px sans-serif';
        ctx.fillText(pl.cn, p.x + 6, p.y + 3);
        out.push({ kind: 'planet', name: pl.cn, x: p.x, y: p.y, alt: p.alt, az: p.az, mag: b.mag });
      });
    }
    if (opts.layers.moon) {
      var m = A.moonPos(view.date, { topocentric: true, latitude: view.site.lat, longitude: view.site.lon });
      var p2 = pr.project(m.ra, m.dec);
      if (p2) {
        var ill = A.moonIllumination(view.date);
        drawMoon(ctx, p2.x, p2.y, 11, ill.fraction, ill.waxing);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath(); ctx.arc(p2.x, p2.y, 13, 0, Math.PI * 2); ctx.stroke();
        out.push({ kind: 'moon', name: '月球 · ' + ill.phaseName + ' ' + (ill.fraction * 100).toFixed(0) + '%', x: p2.x, y: p2.y, alt: p2.alt, az: p2.az });
      }
    }
    if (opts.layers.core) {
      var gc = A.galacticToEquatorial(4, 0);
      var pp = A.precess(gc.ra, gc.dec, A.dayNumber(view.date));
      var cp = pr.project(pp.ra, pp.dec);
      if (cp) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,214,150,0.9)'; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.arc(cp.x, cp.y, 9, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = 'rgba(255,214,150,0.9)';
        ctx.font = '10px sans-serif';
        ctx.fillText('银心', cp.x + 11, cp.y + 3);
        out.push({ kind: 'core', name: '银心（人马方向）', x: cp.x, y: cp.y, alt: cp.alt, az: cp.az });
      }
    }
    return out;
  }

  function drawMoon(ctx, x, y, r, frac, waxing) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#2a2f3a'; ctx.fill();
    var k = 1 - 2 * frac;                    // -1 满 → 1 新
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, !waxing);
    ctx.ellipse(0, 0, Math.abs(k) * r, r, 0, Math.PI / 2, -Math.PI / 2, waxing ? k > 0 : k < 0);
    ctx.closePath();
    ctx.fillStyle = '#f4f1e6'; ctx.fill();
    ctx.restore();
  }

  function drawGrid(ctx, pr, view) {
    ctx.save();
    ctx.strokeStyle = 'rgba(126,150,200,0.20)';
    ctx.fillStyle = 'rgba(190,205,235,0.55)';
    ctx.font = '10px sans-serif';
    if (pr.mode === 'dome') {
      [0, 30, 60].forEach(function (alt) {
        var r = (90 - alt) / 90 * pr.R;
        ctx.beginPath(); ctx.arc(pr.cx, pr.cy, r, 0, Math.PI * 2);
        ctx.lineWidth = alt === 0 ? 1.4 : 0.8;
        ctx.strokeStyle = alt === 0 ? 'rgba(150,180,230,0.5)' : 'rgba(126,150,200,0.20)';
        ctx.stroke();
        if (alt) ctx.fillText(alt + '°', pr.cx + r + 3, pr.cy + 3);
      });
      for (var az = 0; az < 360; az += 10) {
        var a = az * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(pr.cx + Math.sin(a) * pr.R * (az % 30 ? 0.965 : 0.93), pr.cy - Math.cos(a) * pr.R * (az % 30 ? 0.965 : 0.93));
        ctx.lineTo(pr.cx + Math.sin(a) * pr.R, pr.cy - Math.cos(a) * pr.R);
        ctx.strokeStyle = 'rgba(126,150,200,' + (az % 30 ? 0.22 : 0.4) + ')';
        ctx.stroke();
        if (az % 30 === 0) {
          ctx.fillText(A.compass(az) + ' ' + az + '°',
            pr.cx + Math.sin(a) * (pr.R + 14) - 12, pr.cy - Math.cos(a) * (pr.R + 14) + 4);
        }
      }
    } else {
      var step = view.fov.h > 60 ? 30 : view.fov.h > 25 ? 10 : 5;
      ctx.textAlign = 'center';
      var azTops = [];
      for (var az2 = 0; az2 < 360; az2 += step) {
        var pts = [];
        for (var alt2 = -5; alt2 <= 89; alt2 += 1) {
          var eq = azToRaDec(az2, alt2, view);
          var p = eq && pr.project(eq.ra, eq.dec);
          if (p) pts.push(p); else if (pts.length > 1) break;
        }
        if (pts.length < 2) continue;
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = 'rgba(126,150,200,0.22)';
        ctx.stroke();
        // 标签挂在这条线最接近画面中线的那一点：天顶处所有方位线挤在一起，
        // 挂顶端既会被裁掉又互相重叠
        var mid = ctx.canvas.height / 2, best = pts[0];
        for (var k = 1; k < pts.length; k++) {
          if (Math.abs(pts[k].y - mid) < Math.abs(best.y - mid)) best = pts[k];
        }
        azTops.push({ x: best.x, y: best.y, t: az2 + '°' });
      }
      // 同一条水平线上仍可能撞名，按 x 排序后留一个隔 34px 的
      azTops.sort(function (a, b) { return a.x - b.x; });
      var lastLabelX = -1e9;
      azTops.forEach(function (tk) {
        var x = clamp(tk.x, 16, ctx.canvas.width - 16);
        if (x - lastLabelX < 34) return;
        ctx.fillText(tk.t, x, tk.y);
        lastLabelX = x;
      });
      for (var al3 = 0; al3 <= 80; al3 += view.fov.v > 40 ? 20 : 10) {
        var pp = [];
        for (var az3 = view.center.az - view.fov.h; az3 <= view.center.az + view.fov.h; az3 += 1) {
          var e2 = azToRaDec(az3, al3, view);
          var p2 = e2 && pr.project(e2.ra, e2.dec);
          if (p2) pp.push(p2);
        }
        if (pp.length < 2) continue;
        ctx.beginPath(); ctx.moveTo(pp[0].x, pp[0].y);
        for (var j = 1; j < pp.length; j++) ctx.lineTo(pp[j].x, pp[j].y);
        ctx.strokeStyle = 'rgba(126,150,200,0.22)';
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* 地平坐标 → 赤道坐标（画方位/高度网格用，是 alt/az 转换的逆） */
  function azToRaDec(az, alt, view) {
    var site = view.site;
    var lst = A.lst(A.julianDay(view.date), site.lon);
    var a = az * Math.PI / 180, h = alt * Math.PI / 180, lat = site.lat * Math.PI / 180;
    var sinDec = Math.sin(h) * Math.sin(lat) + Math.cos(h) * Math.cos(lat) * Math.cos(a);
    if (sinDec > 1 || sinDec < -1) return null;
    var dec = Math.asin(sinDec);
    var y = Math.cos(h) * Math.sin(a);
    var x = Math.sin(h) * Math.cos(lat) - Math.cos(h) * Math.sin(lat) * Math.cos(a);
    var ha = Math.atan2(y, x);
    return { ra: A.norm360((lst - ha * 180 / Math.PI)), dec: dec * 180 / Math.PI };
  }

  /* 取景框：dome 模式下叠一个镜头视场矩形，直接拖它就能改朝向 */
  function drawFrameOverlay(ctx, pr, view) {
    if (pr.mode !== 'dome' || !view.showFrame) return;
    var corners = [
      [view.center.az - view.fov.h / 2, view.center.alt + view.fov.v / 2],
      [view.center.az + view.fov.h / 2, view.center.alt + view.fov.v / 2],
      [view.center.az + view.fov.h / 2, view.center.alt - view.fov.v / 2],
      [view.center.az - view.fov.h / 2, view.center.alt - view.fov.v / 2]
    ].map(function (cc) {
      var e = azToRaDec(cc[0], cc[1], view);
      return e && pr.project(e.ra, e.dec);
    });
    if (corners.some(function (c) { return !c; })) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (var i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath(); ctx.stroke();
    ctx.setLineDash([]);
    // 三分线，旅拍构图直接用
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 0.8;
    for (var k = 1; k <= 2; k++) {
      var a1 = lerpP(corners[0], corners[3], k / 3), a2 = lerpP(corners[1], corners[2], k / 3);
      ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y); ctx.stroke();
      var b1 = lerpP(corners[0], corners[1], k / 3), b2 = lerpP(corners[3], corners[2], k / 3);
      ctx.beginPath(); ctx.moveTo(b1.x, b1.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('镜头视场 ' + view.lens + 'mm · ' + view.fov.h.toFixed(0) + '°×' + view.fov.v.toFixed(0) + '°',
      (corners[0].x + corners[2].x) / 2, corners[0].y - 6);
    ctx.restore();
  }
  function lerpP(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }

  var LENS = { full: 36, sensorW: 36, sensorH: 24 };
  function fovFor(lens, aspect) {
    var h = 2 * Math.atan(LENS.sensorW / 2 / lens) * 180 / Math.PI;
    var v = 2 * Math.atan(LENS.sensorH / (aspect || 3 / 2) / 2 / lens) * 180 / Math.PI;
    return { h: Math.min(h, 170), v: Math.min(v, 170) };
  }

  /** 主入口。返回可交互天体的屏幕坐标表，界面用它做 tooltip 与点击 */
  function draw(canvas, view) {
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    var cssW = view.cssW, cssH = view.cssH;
    if (canvas.width !== Math.round(cssW * dpr)) { canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var pad = view.mode === 'dome' ? 34 : 0;
    var pr = makeProjector(view, cssW, cssH, pad);
    var sky = paintSky(ctx, cssW, cssH, pr, view);
    var dayNum = A.dayNumber(view.date);
    var dayKey = Math.floor(dayNum);
    var opts = {
      dayKey: dayKey, dayNum: dayNum,
      magLimit: view.magLimit || 6.5,
      sizeK: view.mode === 'frame' ? 1.35 : 1,
      sunWash: clamp(sky.dark, 0, 1) * 0.92,
      names: view.layers.names, twinkle: true,
      layers: view.layers,
      keyIndex: view.keyIndex
    };
    var corePoint = null;
    if (view.layers.milky && opts.sunWash < 0.9) corePoint = drawMilky(ctx, pr, view, 1 - opts.sunWash * 0.85);
    if (view.layers.consts && view.keyIndex) drawConstellations(ctx, pr, view, opts);
    if (view.layers.grid) drawGrid(ctx, pr, view);
    if (view.layers.ecliptic) drawEcliptic(ctx, pr, view, 1 - opts.sunWash * 0.7);
    drawStars(ctx, pr, view, opts);
    var bodies = drawBodies(ctx, pr, view, opts);
    drawFrameOverlay(ctx, pr, view);
    if (corePoint) bodies.push({ kind: 'coreline', x: corePoint.x, y: corePoint.y });
    return { bodies: bodies, sunAlt: sky.sunAlt, dark: sky.dark, projector: pr };
  }

  function hitTest(bodies, x, y, radius) {
    var r = radius || 14, best = null, bd = 1e9;
    bodies.forEach(function (b) {
      if (b.x === undefined) return;
      var d = Math.hypot(b.x - x, b.y - y);
      if (d < r && d < bd) { bd = d; best = b; }
    });
    return best;
  }

  root.LFSky = {
    draw: draw, hitTest: hitTest, fovFor: fovFor, PLANETS: PLANETS,
    LENS: LENS, bvColor: bvColor, azToRaDec: azToRaDec
  };
})(typeof window !== 'undefined' ? window : globalThis);
