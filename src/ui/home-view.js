/* 工作台视图：今天的光线怎么排，一眼看完
 *
 * 这里刻意不放"云量/光污染/视宁度"，因为那些要么要联网，要么要栅格数据，
 * 前端本地算不出来。算不出来的东西不装成算得出来。
 */
(function (root) {
  'use strict';
  var LF = root.LF, A = root.LFAstro;

  function bands(sun, site) {
    // 把一天的太阳高度量化成渐变色带，比摆 300 个 div 便宜得多
    var stops = [];
    var range = A.civilDayRange(sun.date.y, sun.date.m, sun.date.d, site.tz);
    var n = 72;
    for (var i = 0; i <= n; i++) {
      var t = new Date(range.start.getTime() + (86400000 * i) / n);
      var s = A.sunPos(t);
      var alt = A.toHorizontal(s.ra, s.dec, t, site.lat, site.lon).alt;
      stops.push(colorFor(alt) + ' ' + (i / n * 100).toFixed(2) + '%');
    }
    return 'linear-gradient(to right,' + stops.join(',') + ')';
  }
  function colorFor(alt) {
    if (alt > 6) return '#cfd6e4';        // 白昼
    if (alt > 0) return '#e8b877';        // 黄金
    if (alt > -6) return '#4a6fae';       // 蓝调（民用晨昏）
    if (alt > -12) return '#24365f';
    if (alt > -18) return '#141d38';
    return '#070b18';
  }

  LF.register('home', {
    title: '工作台',
    hasInspector: true,
    sub: function () {
      var s = LF.state.site, d = LF.date();
      return s.name + ' · ' + d.y + '-' + pad(d.m) + '-' + pad(d.d) + ' · 本地时区 ' + root.LFutil.tzLabel(s.tz);
    },

    render: function (content, insp, api) {
      var site = api.state.site, d = api.date();
      var sun = A.sunEvents(d.y, d.m, d.d, site.lat, site.lon, site.tz);
      var night = A.nightPlan(d.y, d.m, d.d, site.lat, site.lon, site.tz, { minCoreAlt: 5 });
      var moon = A.moonIllumination(new Date(Date.UTC(d.y, d.m - 1, d.d, 12) - site.tz * 60000), { age: true });
      var core = A.galacticCoreEvents(d.y, d.m, d.d, site.lat, site.lon, site.tz);

      /* 顶部工具条动作 */
      var actions = document.getElementById('toolbar-actions');
      actions.textContent = '';
      var dayShift = function (delta) {
        var t = new Date(Date.UTC(d.y, d.m - 1, d.d + delta));
        api.state.dateISO = t.toISOString().slice(0, 10);
        document.getElementById('date-input').value = api.state.dateISO;
        api.save(); api.rerender();
      };
      actions.appendChild(api.segmented([
        { id: 'y', label: '昨天' }, { id: 't', label: '今天' }, { id: 'n', label: '明天' }
      ], 't', function (id) { dayShift(id === 'y' ? -1 : id === 'n' ? 1 : 0); }));
      actions.appendChild(api.el('button', { class: 'control', text: '排一周', onclick: function () { api.go('route'); } }));
      actions.appendChild(api.el('button', { class: 'control primary', text: '打开星野', onclick: function () { api.go('sky'); } }));

      /* 光段条 */
      var tl = api.el('div', { class: 'timeline', title: '一天里的光线分段（按太阳高度着色）' });
      tl.appendChild(api.el('div', {
        style: { position: 'absolute', inset: '0', background: bands(sun, site) }
      }));
      var keep = ['天文晨始', '民用晨始', '日出', '正午', '日落', '民用昏终', '天文昏终'];
      var marks = A.lightPhases(sun).filter(function (m) {
        return keep.some(function (k) { return m.name.indexOf(k) === 0; });
      });
      // 刻度必须按当天真实时刻的比例摆，等距排会把"日出"指到别的色带上
      var dayStart = A.civilDayRange(sun.date.y, sun.date.m, sun.date.d, site.tz).start.getTime();
      var bar = api.el('div', { style: { position: 'relative', height: '40px', marginTop: '4px' } });
      var ticks = marks.map(function (m) {
        var pct = clamp((m.time.getTime() - dayStart) / 86400000 * 100, 0, 100);
        var label = m.name + ' ' + api.time(m.time);
        var span = api.el('span', {
          title: m.name,
          style: { position: 'absolute', transform: 'translateX(-50%)', fontSize: '10px',
            color: 'var(--label-2)', whiteSpace: 'nowrap', textAlign: 'center', lineHeight: '12px' },
          text: label
        });
        bar.appendChild(span);
        bar.appendChild(api.el('i', {
          style: { position: 'absolute', left: pct.toFixed(2) + '%', top: 0, width: '1px', height: '4px', background: 'var(--label-3)' }
        }));
        return { span: span, pct: pct };
      });
      // 刻度得等这条 bar 真的进了文档、量得到宽度以后再摆：
      // 未插入时 clientWidth 是 0，按估算是会叠字的（实测就是这样翻过一次）
      function placeTicks() {
        var W = bar.clientWidth || 900;
        var rows = [[], [], []];
        ticks.forEach(function (tk) {
          var px = tk.pct / 100 * W;
          var half = (tk.span.offsetWidth || 70) / 2 + 4;
          var pick = 0, bestFree = -1;
          for (var ri = 0; ri < rows.length; ri++) {
            var free = rows[ri].every(function (r) { return Math.abs(r.px - px) >= r.half + half; });
            if (free) { pick = ri; bestFree = 1; break; }
            pick = ri;
          }
          rows[pick].push({ px: px, half: half });
          tk.span.style.left = tk.pct.toFixed(2) + '%';
          tk.span.style.top = (pick * 13) + 'px';
          void bestFree;
        });
        bar.style.height = (13 * rows.filter(function (r) { return r.length; }).length + 8) + 'px';
      }
      requestAnimationFrame(placeTicks);
      window.addEventListener('resize', placeTicks);

      content.appendChild(api.el('div', { class: 'card' }, [
        api.el('div', { class: 'row spread' }, [
          api.el('div', { class: 'card-title', text: '今日光段' }),
          api.el('div', { class: 'tiny', text: '按太阳几何高度分档：>6° 白昼 · 0~6° 黄金 · -6~0° 蓝调 · -18° 以下全黑' })
        ]),
        api.el('div', { style: { position: 'relative', margin: '10px 0 2px' } }, tl),
        bar
      ]));

      /* 六个关键数字 */
      var grid = api.el('div', { class: 'grid cols-3' });
      function num(t) { return api.time(t); }
      [
        api.stat(num(sun.sunrise), '', '日出', sun.polarNight ? '极夜：当天不出' : '方位 ' + A.compass(96) + ' 附近'),
        api.stat(num(sun.sunset), '', '日落', '黄金时刻止于 ' + api.time(sun.golden.evening[0])),
        api.stat(num(sun.civil.end[0]), '', '蓝调结束', '民用晨昏 -6°'),
        api.stat(num(sun.astronomical.end[sun.astronomical.end.length - 1]), '', '全黑', '天文晨昏 -18°'),
        api.stat((moon.fraction * 100).toFixed(0), '%', '月照 · ' + moon.phaseName, moon.ageDays != null ? '月龄 ' + moon.ageDays.toFixed(1) + ' 天' : ''),
        api.stat(core.transit ? core.transit.alt.toFixed(0) + '°' : '—', '', '银心当天最高',
          core.rise ? '升起 ' + api.time(core.rise) : (core.set ? '落下 ' + api.time(core.set) : '全天在地平线下'))
      ].forEach(function (c) { grid.appendChild(c); });
      content.appendChild(api.el('div', { style: { height: '16px' } }));
      content.appendChild(grid);

      /* 银河判断 */
      var best = night.best || { score: 0, time: null };
      var kind = best.score > 0.55 ? 'good' : best.score > 0.3 ? 'warn' : 'bad';
      var verdict = best.score > 0.55 ? '可以拍' : best.score > 0.3 ? '勉强能拍' : '不建议拍银河';
      var explain = [];
      explain.push('黑夜窗口 ' + api.time(sun.astronomical.end[sun.astronomical.end.length - 1]) + ' — ' + api.time(sun.astronomical.start[0]));
      explain.push('银心高于 5° 的时长约 ' + (night.window ? night.window.minutes + ' 分钟' : '0 分钟'));
      explain.push('月光干扰峰值 ' + ((night.samples.reduce(function (m, s) { return Math.max(m, s.moonFraction * (s.moonAlt > 0 ? 1 : 0)); }, 0) * 100) || 0).toFixed(0) + '%');
      content.appendChild(api.el('div', { style: { height: '16px' } }));
      content.appendChild(api.card({
        title: '今晚的银河',
        sub: '本地推演：黑度 × 银心高度 × 月光干扰。云和光污染不在这里，得你自己看天。'
      }, [
        api.el('div', { class: 'row spread', style: { alignItems: 'baseline' } }, [
          api.el('div', { class: 'row', style: { gap: '10px', alignItems: 'baseline' } }, [
            api.el('span', { style: { fontSize: '22px', fontWeight: '600' }, text: verdict }),
            api.el('span', { class: 'muted', style: { fontSize: '13px' }, text: best.time ? ('最佳 ' + api.time(best.time) + ' · 得分 ' + (best.score * 100).toFixed(0) + '/100') : '当天没有可用窗口' })
          ]),
          api.chip(kind === 'good' ? '好窗口' : kind === 'warn' ? '有干扰' : '条件差', kind)
        ]),
        api.el('div', { class: 'gauge', style: { marginTop: '10px' } },
          api.el('i', { style: { width: Math.round(best.score * 100) + '%' } })),
        api.el('div', { class: 'divider' }),
        api.el('ul', { style: { margin: 0, paddingLeft: '18px', fontSize: '12px', color: 'var(--label-2)' } },
          explain.map(function (t) { return api.el('li', { text: t }); }))
      ]));

      /* 今天做什么 */
      var plan = buildPlan(sun, night, core, site);
      content.appendChild(api.el('div', { style: { height: '16px' } }));
      content.appendChild(api.card({ title: '今天做什么', sub: '按上面的时刻自动排的到场建议，可直接抄进路书' }, [
        api.table([
          { key: 'time', label: '时刻' },
          { key: 'do', label: '动作' },
          { key: 'why', label: '为什么是它' }
        ], plan)
      ]));

      /* inspector：当天光段明细 */
      insp.appendChild(api.group('光段明细', marks.map(function (m) {
        return api.el('div', { class: 'row spread', style: { fontSize: '12px' } }, [
          api.el('span', { text: m.name }),
          api.el('span', { class: 'slider-value', text: api.time(m.time) })
        ]);
      }), { note: '本地算' }));

      var nightCurve = night.samples.filter(function (s, i) { return i % 3 === 0; });
      insp.appendChild(api.group('夜里银心高度', [
        sparkline(nightCurve.map(function (s) { return s.coreAlt; }), nightCurve.map(function (s) { return s.sunAlt; })),
        api.el('div', { class: 'stage-legend' }, [
          api.el('span', { html: '<i class="legend-dot" style="background:#f0b46a"></i>太阳高度' }),
          api.el('span', { html: '<i class="legend-dot" style="background:#7aa2ff"></i>银心高度' })
        ]),
        api.el('div', { class: 'tiny', text: '横轴为日落→次日日出，每分钟一格的样本抽稀到约 80 点' })
      ]));
    }
  });

  function sparkline(core, solar) {
    var w = 236, h = 58, n = core.length;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('width', '100%'); svg.setAttribute('height', h);
    function path(vals, color, zero) {
      var d = '';
      for (var i = 0; i < vals.length; i++) {
        var x = i / (vals.length - 1) * w;
        var y = h - (vals[i] - (zero || -40)) / 130 * h;
        d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
      }
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d); p.setAttribute('fill', 'none');
      p.setAttribute('stroke', color); p.setAttribute('stroke-width', '1.6');
      return p;
    }
    var zero = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    zero.setAttribute('x1', 0); zero.setAttribute('x2', w);
    zero.setAttribute('y1', (h - (0 + 40) / 130 * h).toFixed(1)); zero.setAttribute('y2', (h - (0 + 40) / 130 * h).toFixed(1));
    zero.setAttribute('stroke', 'var(--sep)'); zero.setAttribute('stroke-dasharray', '3 3');
    svg.appendChild(zero);
    svg.appendChild(path(solar, '#f0b46a', -40));
    svg.appendChild(path(core, '#7aa2ff', -40));
    return svg;
  }

  function buildPlan(sun, night, core, site) {
    var rows = [];
    function push(t, doo, why) { if (t) rows.push({ time: A.fmtTime(t, site.tz, true), do: doo, why: why }); }
    push(sun.sunrise ? new Date(sun.sunrise.getTime() - 20 * 60000) : null, '机位就位、测光锁定', '按日出前 20 分钟算的到场时间，蓝调还能补一张');
    push(sun.sunrise, '按曝光包围拍 3 张', '太阳几何高度 0°，地景与天空光比最大');
    push(sun.golden.morning[0], '换长焦收局部光', '黄金时刻结束，光线转硬');
    push(sun.golden.evening[0], '转场到日落机位', '黄金时刻开始，斜射侧光最好看');
    push(sun.sunset, '拍剪影与轮廓光', '太阳下缘入地平');
    push(sun.civil.end[0], '蓝调收尾：亮灯与天空同曝', '地面与人造灯亮度接近，一张能同时保住');
    push(sun.astronomical.end[sun.astronomical.end.length - 1], '换三脚架拍星 / 长曝', '太阳低于 -18°，天真正黑');
    if (night.best && night.best.score > 0.2) {
      push(night.best.time, '银河主曝（' + (night.best.score * 100).toFixed(0) + ' 分）',
        '银心高度 ' + night.best.coreAlt.toFixed(0) + '°，月照 ' + (night.best.moonFraction * 100).toFixed(0) + '%');
    }
    push(night.window ? night.window.start : null, '银河窗口打开', '黑度与银心高度同时达标' + (night.window ? '，约 ' + night.window.minutes + ' 分钟' : ''));
    return rows;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
})(typeof window !== 'undefined' ? window : globalThis);
