/* 星野视图：时间轴推着星空转，银河与星体的位置随分钟变化
 *
 * 穹顶模式（dome）看整圈地平线，回答"银心今晚从哪个方位升起来"；
 * 取景模式（frame）按焦段给视场，回答"16mm 能不能把银河拱桥和人一起装进去"。
 * 时间在本地民用时里走（按拍摄地时区，不是浏览器时区），出差到别的时区也不会算错。
 */
(function (root) {
  'use strict';
  var LF = root.LF, A = root.LFAstro, Sky = root.LFSky;

  var raf = null, lastFrame = 0, hover = null, drag = null;
  var canvas, stage, tip;

  function localToDate(site, dayISO, hourLocal) {
    var d = new Date(dayISO + 'T00:00:00Z');
    return new Date(d.getTime() + hourLocal * 3600000 - site.tz * 60000);
  }

  LF.register('sky', {
    title: '星野',
    hasInspector: true,
    sub: function () {
      var s = LF.state.site, k = LF.state.sky;
      return s.name + ' · ' + fmtHour(k.hour) + ' 本地时 · ' + (k.mode === 'dome' ? '全穹顶' : k.lens + 'mm 视场');
    },

    render: function (content, insp, api) {
      var st = api.state, site = st.site, sky = st.sky;

      /* 舞台 */
      canvas = api.el('canvas', { id: 'sky-canvas' });
      stage = api.el('div', { class: 'stage', id: 'sky-stage' }, canvas);
      tip = api.el('div', {
        class: 'chip info', id: 'sky-tip',
        style: { position: 'absolute', display: 'none', pointerEvents: 'none', whiteSpace: 'nowrap' }
      });
      stage.appendChild(tip);

      var bar = api.el('div', { class: 'stage-bar' });
      var playBtn = api.el('button', { class: 'icon-btn', title: '播放/暂停（空格）', text: sky.playing ? '❙❙' : '▶' });
      var timeLabel = api.el('span', { class: 'slider-value', style: { minWidth: '64px' } });
      var speedSeg = api.segmented([
        { id: 1, label: '1×' }, { id: 5, label: '5×' }, { id: 15, label: '15×' }
      ], sky.speed || 5, function (v) { sky.speed = v; api.save(); });
      var scrub = api.el('input', { type: 'range', min: 12, max: 30, step: 0.05, value: sky.hour, 'aria-label': '时间' });
      bar.appendChild(playBtn); bar.appendChild(scrub); bar.appendChild(timeLabel); bar.appendChild(speedSeg);
      stage.appendChild(bar);
      content.appendChild(stage);

      var legend = api.el('div', { class: 'row spread', style: { marginTop: '8px' } }, [
        api.el('div', { class: 'stage-legend' }, [
          api.el('span', { html: '<i class="legend-dot" style="background:#f4f1e6"></i>月球' }),
          api.el('span', { html: '<i class="legend-dot" style="background:#ffe3a8"></i>行星' }),
          api.el('span', { html: '<i class="legend-dot" style="background:#7aa2ff"></i>银河' }),
          api.el('span', { html: '<i class="legend-dot" style="background:#ffd696"></i>银心' })
        ]),
        api.el('div', { class: 'tiny', id: 'sky-note' })
      ]);
      content.appendChild(legend);

      /* inspector */
      function reRender() { invalidate(); }
      insp.appendChild(api.group('视图', [
        api.segmented([{ id: 'dome', label: '全穹顶' }, { id: 'frame', label: '镜头视场' }], sky.mode, function (id) {
          sky.mode = id; api.save(); api.rerender();
        }),
        sky.mode === 'frame' ? api.slider({
          label: '等效焦距', min: 8, max: 200, step: 1, value: sky.lens, unit: 'mm', bipolar: false,
          hint: '按全画幅 36×24 换算水平视场；frame 投影在视场 >60° 时形状畸变到 3% 量级',
          onInput: function (v) { sky.lens = v; api.save(); reRender(); }
        }) : null,
        api.slider({
          label: '朝向', min: 0, max: 359, step: 1, value: sky.bearing, unit: '°',
          hint: '穹顶模式下也可以直接在图上拖取景框',
          onInput: function (v) { sky.bearing = v; api.save(); reRender(); }
        }),
        api.slider({
          label: '画面中心高度', min: -5, max: 88, step: 1, value: sky.centerAlt, unit: '°',
          onInput: function (v) { sky.centerAlt = v; api.save(); reRender(); }
        }),
        api.segmented([{ id: '3:2', label: '3:2' }, { id: '16:9', label: '16:9' }, { id: '1:1', label: '1:1' }, { id: '9:16', label: '竖 9:16' }],
          sky.aspect || '3:2', function (id) { sky.aspect = id; api.save(); reRender(); })
      ], { note: '拖拽可平移' }));

      insp.appendChild(api.group('图层', [
        api.toggle('恒星', sky.layers.stars, function (v) { sky.layers.stars = v; api.save(); reRender(); }),
        api.slider({
          label: '星等上限', min: 2, max: 6.5, step: 0.1, value: sky.magLimit || 5.6, sign: false,
          hint: '6.5 是肉眼极限，画到 5.6 已经 3000 多颗；手机上看清不亏电就调低',
          onInput: function (v) { sky.magLimit = v; api.save(); reRender(); }
        }),
        api.toggle('银河带', sky.layers.milky, function (v) { sky.layers.milky = v; api.save(); reRender(); }),
        api.toggle('星群连线', sky.layers.consts, function (v) { sky.layers.consts = v; api.save(); reRender(); }),
        api.toggle('专名标注', sky.layers.names, function (v) { sky.layers.names = v; api.save(); reRender(); }),
        api.toggle('行星与月', sky.layers.planets || sky.layers.moon, function (v) { sky.layers.planets = v; sky.layers.moon = v; api.save(); reRender(); }),
        api.toggle('地平与方位网格', sky.layers.grid, function (v) { sky.layers.grid = v; api.save(); reRender(); }),
        api.toggle('黄道', !!sky.layers.ecliptic, function (v) { sky.layers.ecliptic = v; api.save(); reRender(); })
      ]));

      /* 现场条件：算不出来的就让你填 */
      var cond = sky.cond || (sky.cond = { cloud: 20, bortle: 3, haze: 20 });
      insp.appendChild(api.group('现场条件（自填）', [
        api.slider({
          label: '低云量', min: 0, max: 100, step: 5, value: cond.cloud, unit: '%',
          hint: '云要联网取数值才准，这里给你手动填，用来算"今晚值不值得跑"',
          onInput: function (v) { cond.cloud = v; api.save(); reRender(); }
        }),
        api.slider({
          label: '空气通透度', min: 0, max: 100, step: 5, value: 100 - cond.haze, unit: '%',
          onInput: function (v) { cond.haze = 100 - v; api.save(); reRender(); }
        }),
        api.segmented([{ id: 1, label: 'B1' }, { id: 2, label: 'B2' }, { id: 3, label: 'B3' }, { id: 4, label: 'B4' },
          { id: 5, label: 'B5' }, { id: 6, label: 'B6' }, { id: 7, label: 'B7' }, { id: 8, label: 'B8' }],
          cond.bortle, function (v) { cond.bortle = v; api.save(); reRender(); })
      ], { note: 'Bortle 1 最黑' }));

      var scoreBox = api.el('div');
      insp.appendChild(api.group('此刻能不能拍', [scoreBox]));

      /* 绘制循环 */
      var last = { bodies: [], sunAlt: 0 };
      function sizeStage() {
        var w = stage.clientWidth || 720;
        var h = sky.mode === 'frame' ? Math.round(w * aspectRatio(sky.aspect)) : w;
        h = Math.max(300, Math.min(h, Math.round(window.innerHeight * 0.62)));
        canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
        return { cssW: w, cssH: h };
      }
      function paint() {
        var box = sizeStage();
        var fov = Sky.fovFor(sky.lens || 24, aspectRatio(sky.aspect));
        var date = localToDate(site, st.dateISO, sky.hour);
        var view = {
          mode: sky.mode, site: site, date: date,
          fov: sky.mode === 'frame' ? fov : { h: 180, v: 180 },
          center: { az: sky.bearing, alt: sky.mode === 'frame' ? sky.centerAlt : 0 },
          layers: Object.assign({ core: true }, sky.layers),
          magLimit: sky.magLimit || 5.6, lens: sky.lens || 24,
          showFrame: sky.mode === 'dome' && sky.showFrame !== false,
          keyIndex: root.LFStars.asterismIndex,
          cssW: box.cssW, cssH: box.cssH
        };
        last = Sky.draw(canvas, view) || last;
        timeLabel.textContent = fmtHour(sky.hour);
        var score = A.astroScore(date, site.lat, site.lon, site.tz);
        var cloudPenalty = (1 - cond.cloud / 100) * (1 - cond.haze / 220) * (1 - Math.max(0, cond.bortle - 3) * 0.07);
        var final = score.score * cloudPenalty;
        scoreBox.textContent = '';
        scoreBox.appendChild(api.el('div', { class: 'row spread' }, [
          api.el('strong', { text: final > 0.5 ? '值得跑' : final > 0.25 ? '看运气' : '别熬夜' }),
          api.chip('综合 ' + (final * 100).toFixed(0), final > 0.5 ? 'good' : final > 0.25 ? 'warn' : 'bad')
        ]));
        scoreBox.appendChild(api.el('div', { class: 'gauge', style: { marginTop: '6px' } },
          api.el('i', { style: { width: Math.round(final * 100) + '%' } })));
        scoreBox.appendChild(api.el('div', { class: 'tiny', style: { marginTop: '6px' },
          text: '太阳高度 ' + score.sunAltitude.toFixed(1) + '° · 银心 ' + score.coreAltitude.toFixed(1) + '° · 月光 ' + (score.moonInterference * 100).toFixed(0) + '% · 云 ' + cond.cloud + '%' }));
        var note = document.getElementById('sky-note');
        if (note) note.textContent = '帧内天体 ' + last.bodies.length + ' 个 · 悬停看方位与高度';
      }
      function invalidate() { if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(function () { raf = null; paint(); }); }

      playBtn.addEventListener('click', function () { sky.playing = !sky.playing; api.save(); playBtn.textContent = sky.playing ? '❙❙' : '▶'; loop(); });
      scrub.addEventListener('input', function () { sky.hour = Number(scrub.value); api.save(); paint(); });
      function loop() {
        if (!sky.playing) { raf = null; return; }
        var now = performance.now();
        var dt = now - lastFrame; lastFrame = now;
        sky.hour += dt / 1000 * (sky.speed || 5) / 60 * 6;   // 每真实秒推进 speed×6 分钟
        if (sky.hour > 30) sky.hour -= 18;
        scrub.value = sky.hour;
        paint();
        raf = requestAnimationFrame(loop);
      }
      lastFrame = performance.now();
      paint();
      if (sky.playing) loop();

      /* 交互：拖平移、滚轮改焦段、悬停查星 */
      stage.addEventListener('pointerdown', function (e) {
        drag = { x: e.clientX, y: e.clientY, az: sky.bearing, alt: sky.centerAlt };
        stage.setPointerCapture(e.pointerId);
      });
      stage.addEventListener('pointermove', function (e) {
        var rect = canvas.getBoundingClientRect();
        if (drag) {
          var k = sky.mode === 'frame' ? 0.35 : 0.3;
          sky.bearing = A.norm360(drag.az + (e.clientX - drag.x) * k);
          sky.centerAlt = clampN(drag.alt - (e.clientY - drag.y) * (sky.mode === 'frame' ? 0.3 : 0.25), -5, 88);
          paint();
          return;
        }
        var hit = Sky.hitTest(last.bodies, e.clientX - rect.left, e.clientY - rect.top);
        if (hit) {
          tip.style.display = 'block';
          tip.style.left = (hit.x + 12) + 'px';
          tip.style.top = (hit.y - 10) + 'px';
          tip.textContent = (hit.name || '恒星') + ' · 高度 ' + hit.alt.toFixed(1) + '° · 方位 ' + hit.az.toFixed(1) + '°（' + A.compass(hit.az) + '）';
        } else tip.style.display = 'none';
      });
      stage.addEventListener('pointerup', function (e) { drag = null; api.save(); });
      stage.addEventListener('pointerleave', function () { drag = null; tip.style.display = 'none'; });
      stage.addEventListener('wheel', function (e) {
        e.preventDefault();
        sky.lens = clampN((sky.lens || 24) * (e.deltaY > 0 ? 1.12 : 0.9), 8, 200);
        api.save(); paint();
      }, { passive: false });
      window.addEventListener('resize', invalidate);
      document.addEventListener('keydown', spaceHandler);
      function spaceHandler(e) {
        if (e.code === 'Space' && api.state.view === 'sky') {
          e.preventDefault();
          sky.playing = !sky.playing; playBtn.textContent = sky.playing ? '❙❙' : '▶'; loop();
        }
      }
      api._cleanup = function () {
        if (raf) cancelAnimationFrame(raf);
        raf = null; sky.playing = false;
        window.removeEventListener('resize', invalidate);
        document.removeEventListener('keydown', spaceHandler);
      };
    }
  });

  function aspectRatio(id) {
    if (id === '16:9') return 9 / 16;
    if (id === '1:1') return 1;
    if (id === '9:16') return 16 / 9;
    return 2 / 3;
  }
  function clampN(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function fmtHour(h) {
    var hh = Math.floor(h) % 24, mm = Math.round((h - Math.floor(h)) * 60);
    if (mm === 60) { mm = 0; hh = (hh + 1) % 24; }
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }
})(typeof window !== 'undefined' ? window : globalThis);
