/* 路书视图：把"哪天、几点、朝哪、能拍多久"排成一张可导出的表
 *
 * 只列本地能算的量（太阳/月亮/银心的时刻与方位高度）。
 * 云量、极光、光污染这些要外部数据，界面上留了"自己填"的格子，不假装算得出。
 */
(function (root) {
  'use strict';
  var LF = root.LF, A = root.LFAstro;

  LF.register('route', {
    title: '路书',
    hasInspector: true,
    sub: function () {
      var s = LF.state.site;
      return s.name + ' 起 ' + LF.state.route.days + ' 天 · 时区 ' + root.LFutil.tzLabel(s.tz);
    },

    render: function (content, insp, api) {
      var site = api.state.site, days = api.state.route.days, kind = api.state.route.kind;
      var start = api.date();
      var rows = [];
      for (var i = 0; i < days; i++) {
        var t = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
        var y = t.getUTCFullYear(), m = t.getUTCMonth() + 1, d = t.getUTCDate();
        var sun = A.sunEvents(y, m, d, site.lat, site.lon, site.tz);
        var night = A.nightPlan(y, m, d, site.lat, site.lon, site.tz, { minCoreAlt: 5 });
        var core = A.galacticCoreEvents(y, m, d, site.lat, site.lon, site.tz);
        var ill = A.moonIllumination(new Date(Date.UTC(y, m - 1, d, 12) - site.tz * 60000));
        rows.push({
          date: m + '/' + d, weekday: ['日', '一', '二', '三', '四', '五', '六'][t.getUTCDay()],
          sunrise: api.time(sun.sunrise), sunset: api.time(sun.sunset),
          day: sun.dayLength ? sun.dayLength.toFixed(1) + 'h' : (sun.polarNight ? '极夜' : '极昼'),
          golden: minutes(sun.sunrise, sun.golden.morning[0]) + ' + ' + minutes(sun.golden.evening[0], sun.sunset),
          blue: minutes(sun.civil.end[0], sun.astronomical.end[sun.astronomical.end.length - 1]),
          dark: night.window ? night.window.minutes : 0,
          coreMax: core.transit ? core.transit.alt.toFixed(0) + '°' : '—',
          moon: (ill.fraction * 100).toFixed(0) + '% ' + ill.phaseName,
          best: night.best && night.best.score > 0.02 ? api.time(night.best.time) : '—',
          score: night.best ? night.best.score : 0
        });
      }

      var actions = document.getElementById('toolbar-actions');
      actions.textContent = '';
      actions.appendChild(api.el('button', {
        class: 'control', text: '导出 Markdown',
        onclick: function () { api.saveText('Mizar路书-' + site.id + '-' + api.state.dateISO + '.md', markdown(rows, site, kind, days), 'text/markdown;charset=utf-8'); api.toast('路书已导出为 .md'); }
      }));
      actions.appendChild(api.el('button', {
        class: 'control primary', text: '导出 JSON',
        onclick: function () { api.saveText('Mizar路书-' + site.id + '.json', JSON.stringify({ site: site, from: api.state.dateISO, days: days, kind: kind, rows: rows }, null, 1), 'application/json'); api.toast('含全部计算量的 JSON 已导出'); }
      }));

      /* 表格 */
      content.appendChild(api.card({
        title: kind + '档期', sub: '时刻均为拍摄地本地时；银心高度取人马方向（银经 4°）'
      }, [
        api.el('div', { class: 'scroll-x' }, api.table([
          { key: 'date', label: '日期' },
          { key: 'weekday', label: '周' },
          { key: 'sunrise', label: '日出' },
          { key: 'sunset', label: '日落' },
          { key: 'day', label: '昼长' },
          { key: 'golden', label: '黄金(早+晚)' },
          { key: 'blue', label: '蓝调' },
          { key: 'dark', label: '全黑且银心>5°' },
          { key: 'coreMax', label: '银心最高', num: true },
          { key: 'moon', label: '月相' },
          { key: 'best', label: '最佳银河时刻' },
          {
            key: 'score', label: '评分', num: true,
            get: function (r) { return (r.score * 100).toFixed(0); },
            cls: function (r) { return r.score > 0.55 ? 'good' : r.score > 0.3 ? '' : 'bad'; }
          }
        ], rows))
      ]));

      /* 光路罗盘 */
      var compass = api.el('canvas', { id: 'compass' });
      content.appendChild(api.el('div', { style: { height: '16px' } }));
      content.appendChild(api.card({
        title: '一天里的光路', sub: '外圈是方位，半径是高度：越靠中心太阳越高。粗段是黄金与蓝调时刻'
      }, [compass, api.el('div', { class: 'stage-legend', style: { marginTop: '8px' } }, [
        api.el('span', { html: '<i class="legend-dot" style="background:#f0b46a"></i>太阳' }),
        api.el('span', { html: '<i class="legend-dot" style="background:#9fb8ff"></i>月亮' }),
        api.el('span', { html: '<i class="legend-dot" style="background:#ffd696"></i>银心' })
      ])]));
      drawCompass(compass, site, start, api);

      /* 建议 */
      content.appendChild(api.el('div', { style: { height: '16px' } }));
      content.appendChild(api.card({ title: '排程建议', sub: '由上面的数直接推出来的，不是模板话术' }, [
        api.el('ul', { style: { margin: 0, paddingLeft: '18px', fontSize: '13px', lineHeight: '1.7' } },
          advice(rows, site, kind).map(function (t) { return api.el('li', { text: t }); }))
      ]));

      /* inspector */
      insp.appendChild(api.group('排程范围', [
        api.slider({
          label: '天数', min: 3, max: 14, step: 1, value: days, unit: ' 天',
          onInput: function (v) { api.state.route.days = v; api.save(); api.rerender(); }
        }),
        api.segmented([{ id: '风光', label: '风光' }, { id: '旅拍', label: '旅拍跟拍' }, { id: '星空', label: '星空' }],
          kind, function (id) { api.state.route.kind = id; api.save(); api.rerender(); })
      ]));

      var custom = api.el('div', { class: 'stack' });
      function numField(label, value, min, max, step, unit, onDone) {
        var input = api.el('input', {
          class: 'control', type: 'number', value: value, min: min, max: max, step: step,
          style: { width: '100%' }, 'aria-label': label
        });
        input.addEventListener('change', function () {
          var v = Number(input.value);
          if (!isFinite(v)) return;
          onDone(clampV(v, min, max));
        });
        return api.el('div', { class: 'stack' }, [
          api.el('div', { class: 'slider-label' }, [label + '（' + unit + '）']),
          input
        ]);
      }
      custom.appendChild(numField('纬度', site.lat, -89.9, 89.9, 0.001, '°N', function (v) { setCustom({ lat: v }); }));
      custom.appendChild(numField('经度', site.lon, -179.9, 179.9, 0.001, '°E', function (v) { setCustom({ lon: v }); }));
      custom.appendChild(numField('海拔', site.height || 0, -100, 6000, 10, 'm', function (v) { setCustom({ height: v }); }));
      custom.appendChild(numField('时区偏移', site.tz / 60, -12, 14, 0.25, '小时', function (v) { setCustom({ tz: Math.round(v * 60) }); }));
      custom.appendChild(api.el('div', { class: 'tiny', text: '手改后站点标记为"自定义"，侧栏下拉可切回预设。尼泊尔是 +5:45、部分是 +5:30，别按经度推。' }));
      insp.appendChild(api.group('自定义坐标', [custom]));

      insp.appendChild(api.group('需要联网的量', [
        api.el('div', { class: 'tiny', text: '云量与降水：ECMWF/GFS 或晴天钟一类接口；光污染：VIIRS/世界图集栅格；极光 Kp：Space Weather Live。' }),
        api.el('div', { class: 'tiny', text: 'Mizar 刻意不把这些塞进界面里当成"已算出"。要接的话，接进上面那张表的空列即可，评分函数留了权重位。' })
      ], { collapsed: true, note: '未接入' }));
    }
  });

  function setCustom(patch) {
    var s = LF.state.site;
    var next = {};
    for (var k in s) next[k] = s[k];
    for (var p in patch) next[p] = patch[p];
    next.id = 'custom'; next.name = '自定义机位'; next.region = ''; next.note = '手填坐标';
    LF.state.site = next; LF.state.siteKey = 'custom';
    LF.save(); LF.rerender();
  }

  function clampV(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function parseDate(md, site) {
    var parts = md.split('/');
    var y = api_year();
    return { y: y, m: Number(parts[0]), d: Number(parts[1]) };
  }
  function api_year() { return LF.date().y; }

  function minutes(a, b) {
    if (!a || !b) return '—';
    return Math.round(Math.abs(b - a) / 60000) + '′';
  }

  function drawCompass(canvas, site, start, api) {
    var d = new Date(Date.UTC(start.y, start.m - 1, start.d, 12) - site.tz * 60000);
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    var sun = A.sunPath(y, m, day, site.lat, site.lon, site.tz, 10);
    var moon = A.moonPath(y, m, day, site.lat, site.lon, site.tz, 15);
    var coreFn = A.galacticCoreAltFn(site.lon, site.lat);
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    var size = Math.max(240, Math.min(canvas.parentElement ? canvas.parentElement.clientWidth - 32 : 340, 380));
    canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
    canvas.width = size * dpr; canvas.height = size * dpr;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var cx = size / 2, cy = size / 2, R = size / 2 - 26;
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg');
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(126,150,200,0.28)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    [0, 30, 60].forEach(function (alt) {
      ctx.beginPath(); ctx.arc(cx, cy, (90 - alt) / 90 * R, 0, Math.PI * 2); ctx.stroke();
    });
    for (var az = 0; az < 360; az += 30) {
      var a = az * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(a) * R * 0.94, cy - Math.cos(a) * R * 0.94);
      ctx.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R);
      ctx.stroke();
      ctx.fillStyle = 'rgba(190,205,235,0.75)';
      ctx.fillText(A.compass(az) + ' ' + az, cx + Math.sin(a) * (R + 13), cy - Math.cos(a) * (R + 13) + 3);
    }
    function arc(points, color, dashed, withTime) {
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      if (dashed) ctx.setLineDash([4, 4]);
      ctx.beginPath();
      var started = false;
      points.forEach(function (p) {
        if (p.alt < -1) { started = false; return; }
        var r = (90 - p.alt) / 90 * R, a = p.az * Math.PI / 180;
        var x = cx + Math.sin(a) * r, y2 = cy - Math.cos(a) * r;
        if (!started) { ctx.moveTo(x, y2); started = true; } else ctx.lineTo(x, y2);
      });
      ctx.stroke();
      if (withTime) {
        ctx.fillStyle = color;
        points.forEach(function (p, i) {
          if (p.alt < -1 || i % 6) return;
          var r = (90 - p.alt) / 90 * R, a = p.az * Math.PI / 180;
          ctx.beginPath(); ctx.arc(cx + Math.sin(a) * r, cy - Math.cos(a) * r, 2, 0, Math.PI * 2); ctx.fill();
          ctx.font = '9px sans-serif';
          ctx.fillText(String(p.time.getUTCHours()).padStart(2, '0') + ':' + String(p.time.getUTCMinutes()).padStart(2, '0'),
            cx + Math.sin(a) * r + 8, cy - Math.cos(a) * r - 4);
        });
      }
      ctx.restore();
    }
    arc(moon, 'rgba(159,184,255,0.85)', true, false);
    arc(sun, '#f0b46a', false, true);
    // 银心轨迹：一天内高度变化，取每 20 分钟一点
    var corePts = [];
    for (var hh = 0; hh < 24; hh++) {
      var t = new Date(Date.UTC(y, m - 1, day, hh) - site.tz * 60000);
      corePts.push({ alt: coreFn(t), az: azimuthAt(t, site), time: t });
    }
    arc(corePts, 'rgba(255,214,150,0.7)', true, false);
  }

  function azimuthAt(t, site) {
    var gc = root.LFAstro.galacticToEquatorial(4, 0);
    var pr = A.precess(gc.ra, gc.dec, A.dayNumber(t));
    return A.toHorizontal(pr.ra, pr.dec, t, site.lat, site.lon).az;
  }

  function advice(rows, site, kind) {
    var out = [];
    var bestDay = rows.reduce(function (a, r) { return r.score > (a ? a.score : 0) ? r : a; }, null);
    var first = rows[0];
    if (kind === '旅拍') {
      out.push('旅拍跟拍按"两场黄金 + 一场蓝调"排：上午 ' + first.sunrise + ' 前后 35 分钟，傍晚 ' + first.sunset + ' 前 45 分钟进场，蓝调收尾约 ' + first.blue + '。');
      out.push('正午顶光时段改拍树荫/建筑阴影里的人像，别硬扛；逆光加一张反光板或机内闪。');
    }
    if (kind === '风光') {
      out.push('风光主战场在 ' + first.sunrise + ' 与 ' + first.sunset + '：日出前 20 分钟到位，日落后再留 ' + first.blue + ' 收蓝调与灯景。');
      out.push('昼长 ' + first.day + '，中段光线平，用来转场、选机位与备份素材更划算。');
    }
    if (kind === '星空') {
      if (bestDay && bestDay.score > 0.25) {
        out.push('本周最好的星空档是 ' + bestDay.date + '（周' + bestDay.weekday + '），' + bestDay.best + ' 前后：全黑且银心高于 5° 共 ' + bestDay.dark + ' 分钟，银心最高 ' + bestDay.coreMax + '，月照 ' + bestDay.moon + '。');
        var t = parseDate(bestDay.date, site);
        var core = A.galacticCoreEvents(t.y, t.m, t.d, site.lat, site.lon, site.tz);
        out.push('银心在 ' + A.fmtTime(core.transit.time, site.tz) + ' 过中天（高度 ' + core.transit.alt.toFixed(0) + '°），' +
          (core.rise ? '升起 ' + A.fmtTime(core.rise, site.tz) + '、' : '') +
          (core.set ? '落下 ' + A.fmtTime(core.set, site.tz) + '。' : '全天不落下。') +
          ' 朝向按中天方位取，机位要朝这一侧开阔、无山脊或楼群遮挡。');
      } else {
        out.push('本周没有可用银河窗口（银心高度或月光不达标）。可改拍月面细节、星轨或城市夜景。');
      }
      out.push('评分只含"黑度 × 银心高度 × 月光"，云与光污染不在里面——出发前务必另查云量。');
    }
    out.push('纬度 ' + Math.abs(site.lat).toFixed(2) + '°' + (site.lat >= 0 ? 'N' : 'S') + '：北极星高度约等于纬度，水平仪校准可用它。');
    return out;
  }

  function markdown(rows, site, kind, days) {
    var head = '# Mizar 路书 · ' + site.name + '\n\n';
    head += '- 坐标：' + Math.abs(site.lat).toFixed(4) + '°' + (site.lat >= 0 ? 'N' : 'S') + ' ' +
      Math.abs(site.lon).toFixed(4) + '°' + (site.lon >= 0 ? 'E' : 'W') +
      '，海拔 ' + (site.height || '—') + ' m\n';
    head += '- 时区：' + root.LFutil.tzLabel(site.tz) + '　档期：' + days + ' 天　类型：' + kind + '\n';
    head += '- 计算口径：太阳高度 -0.833° 为升落，蓝调 -6~0°，全黑 < -18°；银心取银经 4°；评分 = 黑度 × 银心高度 × 月光抑制，不含云量与光污染。\n\n';
    var cols = ['日期', '周', '日出', '日落', '昼长', '黄金(早+晚)', '蓝调', '全黑且银心>5°', '银心最高', '月相', '最佳银河', '评分'];
    var keys = ['date', 'weekday', 'sunrise', 'sunset', 'day', 'golden', 'blue', 'dark', 'coreMax', 'moon', 'best', 'score'];
    head += '| ' + cols.join(' | ') + ' |\n|' + cols.map(function () { return '---'; }).join('|') + '|\n';
    rows.forEach(function (r) {
      head += '| ' + keys.map(function (k) {
        var v = r[k];
        return k === 'score' ? (v * 100).toFixed(0) : (v === 0 || v === undefined || v === null ? '—' : v);
      }).join(' | ') + ' |\n';
    });
    head += '\n> 由 Mizar（光野）本地推算，公式与核对记录见仓库 docs/。\n';
    return head;
  }
})(typeof window !== 'undefined' ? window : globalThis);
