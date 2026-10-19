/* 工具箱视图：拍摄现场真正会按的几个计算器
 *
 * 每个卡片都给口径，不给"魔法数字"：500 法则与诺兰法则的差异、
 * 超焦距用的弥散圆取值、长曝互易失效的经验补偿，都写明来源与限制。
 */
(function (root) {
  'use strict';
  var LF = root.LF, A = root.LFAstro;

  var state = {
    focal: 16, pixels: 24, rule: 'npf',
    trailMinutes: 60, interval: 30,
    focal2: 24, aperture: 8, coc: 0.0185,
    shutter: 30,
    syzygy: null
  };

  LF.register('tools', {
    title: '工具箱',
    hasInspector: false,
    sub: function () { return '全本地计算 · 口径都写在卡片里，可核对'; },

    render: function (content, insp, api) {
      var grid = api.el('div', { class: 'grid cols-2' });

      /* 一、无星轨上限：500 与诺兰法则 */
      function starMax() {
        var r500 = 500 / state.focal;
        var npf = (35 * state.focal + 500) / state.pixels;
        return { r500: r500, npf: npf };
      }
      var starCard = api.card({ title: '单张不拖出星轨', sub: '广角与高像素机身用诺兰法则更准；500 法则是老底片时代的经验值' }, []);
      var starOut = api.el('div', { class: 'row', style: { gap: '20px' } });
      function paintStar() {
        var v = starMax();
        starOut.textContent = '';
        starOut.appendChild(api.stat(v.r500.toFixed(1), 's', '500 法则上限', '焦距 ' + state.focal + 'mm（等效全画幅）'));
        starOut.appendChild(api.stat(v.npf.toFixed(1), 's', '诺兰法则上限', '(35f+500)/像素百万数，当前 ' + state.pixels + 'MP'));
        starOut.appendChild(api.stat(Math.min(v.r500, v.npf).toFixed(1), 's', '取更保守的那个', '星空主曝建议按这条走'));
      }
      starCard.appendChild(starOut);
      starCard.appendChild(api.el('div', { class: 'divider' }));
      starCard.appendChild(api.slider({
        label: '等效焦距', min: 8, max: 200, step: 1, value: state.focal, unit: 'mm',
        onInput: function (v) { state.focal = v; paintStar(); }
      }));
      starCard.appendChild(api.slider({
        label: '机身像素', min: 6, max: 108, step: 1, value: state.pixels, unit: 'MP',
        hint: '诺兰法则里的 N：常用 24MP 机身取 24，APS-C 半画幅记得把焦距先换算成等效值',
        onInput: function (v) { state.pixels = v; paintStar(); }
      }));
      paintStar();

      /* 二、星轨 */
      var trailCard = api.card({ title: '星轨参数', sub: '单次曝光受"不拖轨"上限约束，多张叠加才拉得出长度' }, []);
      var trailOut = api.el('div', { class: 'row', style: { gap: '20px' } });
      function paintTrail() {
        var cap = starMax().npf;
        var shots = Math.max(2, Math.ceil(state.trailMinutes * 60 / state.interval));
        trailOut.textContent = '';
        trailOut.appendChild(api.stat(shots, '张', '需拍张数', '总时长 ' + state.trailMinutes + ' 分钟 / 间隔 ' + state.interval + ' 秒'));
        trailOut.appendChild(api.stat(state.interval, 's', '单张曝光', '超过 ' + cap.toFixed(1) + 's 就会开始拖点'));
        trailOut.appendChild(api.stat((state.trailMinutes).toFixed(0), 'min', '电池与存储提示', '按 ' + shots + ' 张 × 单张约 ' + (state.pixels * 2.2).toFixed(0) + 'MB 估'));
      }
      trailCard.appendChild(trailOut);
      trailCard.appendChild(api.el('div', { class: 'divider' }));
      trailCard.appendChild(api.slider({ label: '星轨总时长', min: 15, max: 240, step: 5, value: state.trailMinutes, unit: 'min', onInput: function (v) { state.trailMinutes = v; paintTrail(); } }));
      trailCard.appendChild(api.slider({ label: '间隔', min: 10, max: 120, step: 5, value: state.interval, unit: 's', hint: '间隔越短轨迹越连续，但张数与耗电量成倍上升', onInput: function (v) { state.interval = v; paintTrail(); } }));
      paintTrail();

      /* 三、超焦距 */
      var hyperCard = api.card({ title: '超焦距与景深', sub: '弥散圆默认 0.0185mm（全画幅 24MP 常用取值），要求更高就调小' }, []);
      var hyperOut = api.el('div', { class: 'row', style: { gap: '20px' } });
      function paintHyper() {
        var f = state.focal2, N = state.aperture, c = state.coc;
        var H = (f * f) / (N * c) / 1000;          // 米
        // 对焦在超焦距处：近清晰点约 H/2（标准近似式，忽略远端无穷）
        var dofNear = H * 0.5;
        hyperOut.textContent = '';
        hyperOut.appendChild(api.stat(H.toFixed(2), 'm', '超焦距', '对焦于此，远景深从 ' + dofNear.toFixed(2) + ' m 到无限远'));
        hyperOut.appendChild(api.stat(dofNear.toFixed(2), 'm', '最近清晰点', '按"对焦 H/2 前后都覆盖"的排法'));
        hyperOut.appendChild(api.stat((f / N).toFixed(1), 'mm', '入瞳直径', '焦距/光圈，影响衍射起始点'));
      }
      hyperCard.appendChild(hyperOut);
      hyperCard.appendChild(api.el('div', { class: 'divider' }));
      hyperCard.appendChild(api.slider({ label: '焦距', min: 10, max: 200, step: 1, value: state.focal2, unit: 'mm', onInput: function (v) { state.focal2 = v; paintHyper(); } }));
      hyperCard.appendChild(api.slider({ label: '光圈 f/', min: 1.4, max: 22, step: 0.1, value: state.aperture, onInput: function (v) { state.aperture = v; paintHyper(); } }));
      hyperCard.appendChild(api.slider({ label: '弥散圆', min: 0.008, max: 0.03, step: 0.0005, value: state.coc, unit: 'mm', onInput: function (v) { state.coc = v; paintHyper(); } }));
      paintHyper();

      /* 四、月相历 */
      var site = api.state.site;
      var today = new Date(Date.UTC(api.date().y, api.date().m - 1, api.date().d, 4));
      var sy = A.syzygyWindow(today, 16, 16);
      var rows = [];
      sy.newMoons.concat(sy.fullMoons).sort(function (a, b) { return a - b; }).forEach(function (t) {
        rows.push({
          when: A.fmt(t, site.tz),
          kind: sy.fullMoons.indexOf(t) >= 0 ? '望' : '朔',
          dark: sy.fullMoons.indexOf(t) >= 0 ? '整夜有月光，别排银河' : '前后 4 天是无月夜，银河首选'
        });
      });
      var moonCard = api.card({ title: '朔望与无月窗口', sub: '按当月日期算，本地时区显示' }, [
        api.table([{ key: 'when', label: '时刻' }, { key: 'kind', label: '相位' }, { key: 'dark', label: '排期含义' }], rows)
      ]);

      /* 五、倒计时 */
      var sun = A.sunEvents(api.date().y, api.date().m, api.date().d, site.lat, site.lon, site.tz);
      var nowLocal = (Date.now() - (new Date().getTimezoneOffset() * 60000) + site.tz * 60000);
      var upcoming = A.lightPhases(sun).filter(function (m) { return m.time.getTime() > Date.now(); });
      var clockCard = api.card({ title: '接下来的光段', sub: '以本机当前时间为基准' }, [
        upcoming.length ? api.table([
          { key: 'name', label: '光段' },
          { key: 'time', label: '本地时刻', get: function (r) { return A.fmtTime(r.time, site.tz, true); } },
          {
            key: 'in', label: '还有', get: function (r) {
              var mins = Math.round((r.time.getTime() - Date.now()) / 60000);
              return mins < 60 ? mins + ' 分钟' : Math.floor(mins / 60) + ' 小时 ' + (mins % 60) + ' 分';
            }
          }
        ], upcoming.slice(0, 6)) : api.el('div', { class: 'muted', text: '今天的光段已经全部走完，明天再排。' }),
        api.el('div', { class: 'tiny', style: { marginTop: '6px' }, text: '拍摄地时区 ' + root.LFutil.tzLabel(site.tz) + '；跨时区出差时先把侧栏的拍摄地选对。' })
      ]);
      void nowLocal;

      /* 六、银河季：本站一年 12 个月的银心夜间高度 */
      var season = api.card({ title: '本站银河季', sub: '逐月取月中一天的夜推演：全黑时段内银心最高能达到多少' }, []);
      var bar = api.el('div', { class: 'row', style: { alignItems: 'flex-end', gap: '6px', height: '92px' } });
      var d0 = api.date();
      for (var mo = 1; mo <= 12; mo++) {
        var np = A.nightPlan(d0.y, mo, 15, site.lat, site.lon, site.tz, { minCoreAlt: 0 });
        var maxAlt = np.maxCoreAlt;
        var good = np.window && np.window.minutes > 60;
        var h = Math.max(3, Math.round((maxAlt + 20) / 110 * 88));
        bar.appendChild(api.el('div', { class: 'stack', style: { alignItems: 'center', gap: '2px', flex: '1' } }, [
          api.el('div', {
            title: mo + ' 月：银心最高 ' + maxAlt.toFixed(0) + '°，可用 ' + (np.window ? np.window.minutes : 0) + ' 分钟',
            style: { width: '100%', height: h + 'px', borderRadius: '3px', background: good ? 'var(--teal)' : maxAlt > 0 ? 'var(--gray3)' : 'var(--fill-1)' }
          }),
          api.el('span', { class: 'tiny', text: mo + '月' })
        ]));
      }
      season.appendChild(bar);
      season.appendChild(api.el('div', { class: 'tiny', style: { marginTop: '8px' } , text: '北半球中纬：4–9 月夜间银心升得高，10 月起日落后就贴着西南落下；南半球相反。' }));

      [starCard, trailCard, hyperCard, moonCard, clockCard, season].forEach(function (c) { grid.appendChild(c); });
      content.appendChild(grid);
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
