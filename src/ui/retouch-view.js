/* 精修视图：人像与风光的本地后期台
 *
 * 参数结构照搬"模块 → 功能滑杆 → 子滑杆"三层，但改了三处像素蛋糕被专业用户吐槽的地方：
 *   1) 配方是纯 JSON，能导出也能读回，同一份参数在别的机器上算出同一张图；
 *   2) 色彩链可以烘成 .cube 交给 Lightroom / Capture One，不必在我们导出的 JPEG 上继续改；
 *   3) 每个算子都在本地跑，不按张计费、不上传、不登录。
 * 磨皮与打点是"判据 + 手动补画"两条腿：自动肤色判据漏了可以点上去，不假装 AI 认得所有脸。
 */
(function (root) {
  'use strict';
  var LF = root.LF, F = root.LFImage;

  var PRESETS = [
    { id: 'clear', name: '旅拍通透', p: { exposure: 0.15, contrast: 12, highlights: -25, shadows: 30, vibrance: 18, clarity: 12, temp: 4, dehaze: 12, split: { hiH: 40, hiS: 18, hiA: 12, loH: 210, loS: 16, loA: 14 } } },
    { id: 'film', name: '胶片暖', p: { temp: 14, tint: 4, contrast: 22, saturation: -8, vibrance: 10, grain: 18, curve: [{ x: 0, y: 0.03 }, { x: 0.25, y: 0.22 }, { x: 0.75, y: 0.8 }, { x: 1, y: 0.98 }], split: { hiH: 38, hiS: 26, hiA: 20, loH: 20, loS: 22, loA: 22 } } },
    { id: 'skin', name: '奶油人像', p: { highlights: -18, shadows: 22, temp: 6, saturation: -4, clarity: 6, portrait: { smooth: 55, quality: 45, evenTone: 26, dewaxy: 40, spots: [], paint: [] } } },
    { id: 'astro', name: '星空冷调', p: { temp: -18, contrast: 18, shadows: 35, blacks: -12, clarity: 20, dehaze: 20, split: { hiH: 200, hiS: 14, hiA: 10, loH: 220, loS: 20, loA: 20 } } },
    { id: 'land', name: '风光硬朗', p: { clarity: 30, texture: 22, dehaze: 30, contrast: 22, vibrance: 20, vignette: -18, hsl: { 2: { s: -15 }, 3: { s: 8, l: 4 } } } }
  ];

  var view = { split: 0.5, tool: 'none', brushR: 0.05, band: 3, dragging: false, low: false, busy: 0 };
  var host = { stage: null, canvas: null, before: null, after: null, hist: null };
  var keyHandler = null, upHandler = null;

  LF.register('retouch', {
    title: '精修',
    hasInspector: true,
    sub: function () {
      var st = LF.state;
      if (!st.images.length) return '人像与风光本地后期 · 照片不出这台机器';
      var e = st.images[st.selectedImage];
      return e.name + ' · ' + e.w + '×' + e.h + ' · 共 ' + st.images.length + ' 张';
    },

    render: function (content, insp, api) {
      var st = api.state;
      st.images = st.images || [];

      /* ── 顶部动作 ── */
      var actions = document.getElementById('toolbar-actions');
      actions.textContent = '';
      var fileIn = api.el('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } });
      fileIn.addEventListener('change', function () { importFiles(fileIn.files, api); fileIn.value = ''; });
      actions.appendChild(api.el('button', { class: 'control primary', text: '导入照片', onclick: function () { fileIn.click(); } }));
      actions.appendChild(fileIn);
      actions.appendChild(api.el('button', {
        class: 'control', text: '套用到全部',
        onclick: function () {
          var cur = current(); if (!cur) return;
          st.images.forEach(function (e) { e.recipe = JSON.parse(JSON.stringify(cur.recipe)); });
          api.toast('已把当前配方同步到 ' + st.images.length + ' 张；每张仍可再单独微调');
          redraw(true);
        }
      }));
      actions.appendChild(api.el('button', { class: 'control', text: '导出', onclick: function () { exportCurrent(api); } }));

      /* ── 舞台 ── */
      var stage = api.el('div', { class: 'stage', style: { background: 'var(--bg-2)', minHeight: '320px' } });
      var canvas = api.el('canvas', { id: 'retouch-canvas', style: { display: 'block', width: '100%', height: 'auto' } });
      stage.appendChild(canvas);
      var badge = api.el('span', { class: 'chip muted badge-before', text: '原图' });
      stage.appendChild(badge);
      if (!st.images.length) {
        var drop = api.el('div', { class: 'dropzone', style: { margin: '0' } }, [
          api.el('div', { text: '把 JPG / PNG / HEIF 拖进来，或点击选择文件' }),
          api.el('div', { class: 'tiny', style: { marginTop: '6px' }, text: '照片只在浏览器内存里处理：不上传、不登录、不按张计费。' })
        ]);
        drop.addEventListener('click', function () { fileIn.click(); });
        bindDrop(drop, api);
        content.appendChild(api.el('div', { class: 'card' }, drop));
      } else {
        content.appendChild(stage);
        bindStage(canvas, api);
        stage.addEventListener('dragover', function (ev) { ev.preventDefault(); stage.classList.add('over'); });
        stage.addEventListener('dragleave', function () { stage.classList.remove('over'); });
        stage.addEventListener('drop', function (ev) {
          ev.preventDefault(); stage.classList.remove('over');
          importFiles(ev.dataTransfer.files, api);
        });
      }

      /* ── 读数条 ── */
      var readout = api.el('div', { class: 'row spread', style: { marginTop: '10px' } });
      host.hist = api.el('canvas', { width: 260, height: 62, style: { width: '260px', height: '62px' } });
      host.stage = stage; host.canvas = canvas;
      content.appendChild(api.el('div', { class: 'card tight' }, [
        api.el('div', { class: 'row', style: { gap: '16px', alignItems: 'center' } }, [
          host.hist,
          readout
        ]),
        api.el('div', { class: 'tiny', style: { marginTop: '6px' }, text: '直方图为预览像素上的实时统计；拖动分屏把手或按住 ~ 看原图。' })
      ]));

      /* ── 胶片条 ── */
      if (st.images.length) {
        var strip = api.el('div', { class: 'filmstrip' });
        st.images.forEach(function (e, i) {
          var f = api.el('div', {
            class: 'frame', 'aria-selected': i === st.selectedImage ? 'true' : 'false',
            onclick: function () { st.selectedImage = i; api.rerender(); }
          }, [
            e.thumb ? api.el('img', { src: e.thumb, alt: e.name }) : api.el('div', { style: { height: '56px' } }),
            api.el('div', { class: 'frame-meta', text: e.name }),
            e.flag ? api.el('i', { class: 'flag', style: { background: 'var(--orange)' } }) : null
          ]);
          strip.appendChild(f);
        });
        strip.appendChild(api.el('button', {
          class: 'frame', style: { display: 'grid', placeItems: 'center', height: '72px', color: 'var(--label-2)' },
          text: '＋', onclick: function () { fileIn.click(); }
        }));
        content.appendChild(api.el('div', { class: 'card tight', style: { marginTop: '12px' } }, strip));
      }

      /* ── inspector ── */
      if (!st.images.length) {
        insp.appendChild(api.group('配方预设', PRESETS.map(function (p) {
          return api.el('button', {
            class: 'control', style: { width: '100%', textAlign: 'left', marginBottom: '4px' },
            text: p.name, onclick: function () { api.toast('先导入一张照片，预设就能直接落上去'); }
          });
        })));
        return;
      }
      var e = current();
      e.recipe = Object.assign(newRecipe(), e.recipe);
      e.recipe.geometry = Object.assign(blankGeo(), e.recipe.geometry || {});
      e.recipe.portrait = Object.assign({ smooth: 0, quality: 0, evenTone: 0, dewaxy: 0, spots: [], paint: [] }, e.recipe.portrait || {});
      e.recipe.local = e.recipe.local || [];
      e.recipe.split = Object.assign({ hiH: 0, hiS: 0, hiA: 0, loH: 0, loS: 0, loA: 0 }, e.recipe.split || {});
      var R = e.recipe;
      function bind(path, opts) {
        var get = function () { return dig(R, path); };
        var s = api.slider(Object.assign({}, opts, {
          value: get(),
          onInput: function (v) { put(R, path, v); redraw(false); },
          onChange: function (v) { put(R, path, v); redraw(true); }
        }));
        return s;
      }

      insp.appendChild(api.group('配方预设', [
        api.el('div', { class: 'color-row' }, PRESETS.map(function (p) {
          return api.el('button', {
            class: 'control', style: { flex: '1', fontSize: '11px', padding: '3px 6px' }, text: p.name,
            onclick: function () {
              // 以 newRecipe() 为底：它把 geometry / portrait / local / split 的空壳都补齐了，
              // 直接用 normalizeRecipe 会留着 geometry:null，读 aspect 时当场炸
              var base = newRecipe();
              for (var k in p.p) base[k] = JSON.parse(JSON.stringify(p.p[k]));
              base.portrait = Object.assign({ smooth: 0, quality: 0, evenTone: 0, dewaxy: 0, spots: [], paint: [] }, base.portrait || {});
              base.geometry = Object.assign(blankGeo(), base.geometry || {});
              e.recipe = base;
              api.toast('已套用「' + p.name + '」，参数仍可逐项改');
              api.rerender();
            }
          });
        })),
        api.el('div', { class: 'tiny', text: '预设只写参数，不覆盖你已打的脸部点。' })
      ], { collapsed: true }));

      /* 人像 */
      var pBody = [
        bind('portrait.smooth', { label: '磨皮强度', min: 0, max: 100, unit: '%', hint: '高低频分离：低频抹平、高频保留，滑到 100 也不糊成塑料' }),
        bind('portrait.quality', { label: '质感保留', min: 0, max: 100, unit: '%' }),
        bind('portrait.evenTone', { label: '匀肤色', min: 0, max: 100, unit: '%', hint: '只拉色度不拉亮度，红白不均会走，斑还在' }),
        bind('portrait.dewaxy', { label: '祛油光', min: 0, max: 100, unit: '%' }),
        api.el('div', { class: 'row', style: { gap: '6px' } }, [
          api.el('span', { class: 'slider-label', text: '打点：' }),
          api.segmented([
            { id: 'none', label: '不打点' }, { id: 'eye', label: '亮眼' }, { id: 'teeth', label: '白牙' },
            { id: 'bag', label: '黑眼圈' }, { id: 'warp-', label: '轮廓收' }, { id: 'warp+', label: '轮廓扩' },
            { id: 'paint', label: '补画肤色' }
          ], view.tool, function (id) { view.tool = id; paintToolHint(); })
        ]),
        api.slider({
          label: '笔刷半径', min: 1, max: 20, unit: '%', value: Math.round(view.brushR * 100),
          hint: '打点与补画共用这个半径；笔刷状态不进配方，所以它是界面态而不是参数',
          onInput: function (v) { view.brushR = v / 100; }
        }),
        api.el('div', { class: 'tiny', id: 'tool-hint' }),
        api.el('div', { class: 'row', style: { gap: '6px' } }, [
          api.el('button', { class: 'control', text: '清掉打点', onclick: function () { R.portrait.spots = []; R.portrait.paint = []; redraw(true); } }),
          api.el('button', { class: 'control', text: '肤色判据自检', onclick: function () { selfCheckMask(api, e); } })
        ])
      ];
      insp.appendChild(api.group('人像 · 皮肤', pBody, { note: e.recipe.portrait.spots.length + ' 点' }));

      /* 影调 */
      insp.appendChild(api.group('影调', [
        bind('exposure', { label: '曝光', min: -2, max: 2, step: 0.05, unit: 'EV', bipolar: true, sign: true }),
        bind('contrast', { label: '对比', min: -60, max: 80, bipolar: true, sign: true }),
        bind('highlights', { label: '高光', min: -100, max: 100, bipolar: true, sign: true }),
        bind('shadows', { label: '阴影', min: -100, max: 100, bipolar: true, sign: true }),
        bind('whites', { label: '白场', min: -60, max: 60, bipolar: true, sign: true }),
        bind('blacks', { label: '黑场', min: -60, max: 60, bipolar: true, sign: true })
      ]));

      /* 色彩 */
      var bandRow = api.el('div', { class: 'color-row' });
      F.BAND_NAMES.forEach(function (n, i) {
        bandRow.appendChild(api.el('button', {
          class: 'swatch', 'aria-pressed': view.band === i ? 'true' : 'false',
          style: { background: 'hsl(' + [0, 30, 60, 120, 180, 210, 270, 330][i] + ',62%,52%)' },
          title: n, onclick: function () { view.band = i; renderBand(); }
        }));
      });
      var bandBox = api.el('div', { class: 'stack' });
      function renderBand() {
        bandBox.textContent = '';
        Array.prototype.forEach.call(bandRow.children, function (c, i) {
          c.setAttribute('aria-pressed', i === view.band ? 'true' : 'false');
        });
        bandBox.appendChild(bind('hsl.' + view.band + '.h', { label: F.BAND_NAMES[view.band] + ' 色相', min: -60, max: 60, bipolar: true, sign: true }));
        bandBox.appendChild(bind('hsl.' + view.band + '.s', { label: F.BAND_NAMES[view.band] + ' 饱和', min: -100, max: 100, bipolar: true, sign: true }));
        bandBox.appendChild(bind('hsl.' + view.band + '.l', { label: F.BAND_NAMES[view.band] + ' 明度', min: -60, max: 60, bipolar: true, sign: true }));
      }
      renderBand();
      insp.appendChild(api.group('色彩', [
        bind('temp', { label: '色温', min: -100, max: 100, bipolar: true, sign: true, hint: '正值偏暖；比例式白平衡，暗部有 8 位量化残差' }),
        bind('tint', { label: '色调', min: -100, max: 100, bipolar: true, sign: true }),
        api.el('div', { class: 'row', style: { gap: '6px' } }, [
          api.el('button', {
            class: 'control', text: '一键白平衡', onclick: function () {
              var src = sourceData(e, 420);
              R.wbGain = F.grayWorldGain(src, 0.85);
              api.toast('灰色世界已取一次白点（增益 r' + R.wbGain.r.toFixed(2) + ' g' + R.wbGain.g.toFixed(2) + ' b' + R.wbGain.b.toFixed(2) + '）');
              redraw(true);
            }
          }),
          api.el('button', { class: 'control', text: '清白点', onclick: function () { R.wbGain = null; redraw(true); } })
        ]),
        bind('vibrance', { label: '鲜艳度', min: -100, max: 100, bipolar: true, sign: true }),
        bind('saturation', { label: '饱和度', min: -100, max: 100, bipolar: true, sign: true }),
        bandRow, bandBox,
        bind('split.hiH', { label: '高光色相', min: 0, max: 359, unit: '°' }),
        bind('split.hiS', { label: '高光染色', min: 0, max: 100, unit: '%' }),
        bind('split.hiA', { label: '高光用量', min: 0, max: 100, unit: '%' }),
        bind('split.loH', { label: '阴影色相', min: 0, max: 359, unit: '°' }),
        bind('split.loS', { label: '阴影染色', min: 0, max: 100, unit: '%' }),
        bind('split.loA', { label: '阴影用量', min: 0, max: 100, unit: '%' })
      ]));

      /* 细节 */
      insp.appendChild(api.group('细节与氛围', [
        bind('clarity', { label: '清晰度', min: -50, max: 80, bipolar: true, sign: true }),
        bind('texture', { label: '纹理', min: -50, max: 80, bipolar: true, sign: true }),
        bind('sharpen', { label: '锐化', min: 0, max: 100 }),
        bind('dehaze', { label: '去雾', min: 0, max: 100, hint: '暗通道先验。无雾片子会放大噪点，默认给 0' }),
        bind('grain', { label: '颗粒', min: 0, max: 100 }),
        bind('grainSize', { label: '颗粒粗细', min: 1, max: 6 }),
        bind('vignette', { label: '暗角', min: -80, max: 40, bipolar: true, sign: true })
      ]));

      /* 局部控制点 */
      var points = api.el('div', { class: 'stack' });
      function renderPoints() {
        points.textContent = '';
        if (!R.local.length) points.appendChild(api.el('div', { class: 'tiny', text: '还没有控制点。选"加光点"后在图上点一下。' }));
        R.local.forEach(function (pt, i) {
          points.appendChild(api.el('div', { class: 'card tight', style: { marginBottom: '6px' } }, [
            api.el('div', { class: 'row spread' }, [
              api.el('span', { class: 'slider-label', text: '点 ' + (i + 1) + ' · 方位 ' + (pt.x * 100).toFixed(0) + ',' + (pt.y * 100).toFixed(0) }),
              api.el('button', { class: 'control plain', style: { color: 'var(--red)' }, text: '删除', onclick: function () { R.local.splice(i, 1); renderPoints(); redraw(true); } })
            ]),
            bindSliderInto(points, pt, 'exposure', i, { label: '曝光', min: -100, max: 100, bipolar: true, sign: true }),
            bindSliderInto(points, pt, 'temp', i, { label: '色温', min: -100, max: 100, bipolar: true, sign: true }),
            bindSliderInto(points, pt, 'sat', i, { label: '饱和', min: -100, max: 100, bipolar: true, sign: true }),
            bindSliderInto(points, pt, 'dehaze', i, { label: '去雾', min: 0, max: 100 })
          ]));
        });
      }
      function bindSliderInto(box, pt, field, idx, opts) {
        var s = api.slider(Object.assign({}, opts, {
          value: pt[field] || 0,
          onInput: function (v) { pt[field] = v; redraw(false); }
        }));
        box.appendChild(s);
        return s;
      }
      insp.appendChild(api.group('局部光（控制点）', [
        api.segmented([{ id: 'none', label: '不加' }, { id: 'point', label: '加光点' }], view.toolPoint || 'none', function (id) { view.toolPoint = id; }),
        points
      ], { collapsed: true, note: R.local.length + ' 点' }));
      renderPoints();

      /* 构图 */
      insp.appendChild(api.group('构图与几何', [
        bind('geometry.rotate', { label: '旋转', min: -15, max: 15, step: 0.1, unit: '°', bipolar: true, sign: true }),
        api.el('div', { class: 'row', style: { gap: '6px' } }, [
          api.el('button', {
            class: 'control', text: '一键水平', onclick: function () {
              var src = sourceData(e, 420);
              var est = F.estimateHorizon(src);
              R.geometry.rotate = Math.round(est.angle * 10) / 10;
              api.toast('检出地平倾角 ' + est.angle.toFixed(2) + '°（置信 ' + (est.strength * 100).toFixed(0) + '）已按上修正旋转');
              redraw(true);
            }
          }),
          api.el('button', { class: 'control', text: '几何归零', onclick: function () { R.geometry = blankGeo(); redraw(true); } })
        ]),
        bind('geometry.zoom', { label: '缩放', min: 1, max: 1.6, step: 0.01 }),
        bind('geometry.perspV', { label: '透视·上下收', min: -0.4, max: 0.4, step: 0.01, bipolar: true, sign: true, hint: '把建筑上沿往里收/往外放，等价于移轴' }),
        bind('geometry.perspH', { label: '透视·左右收', min: -0.4, max: 0.4, step: 0.01, bipolar: true, sign: true }),
        api.el('div', { class: 'row', style: { gap: '6px' } }, [
          api.el('span', { class: 'slider-label', text: '裁剪比例' }),
          api.segmented([{ id: 'free', label: '自由' }, { id: '3:2', label: '3:2' }, { id: '4:3', label: '4:3' }, { id: '1:1', label: '1:1' }, { id: '16:9', label: '16:9' }, { id: '9:16', label: '竖' }],
            R.geometry.aspect || 'free', function (id) { R.geometry.aspect = id; applyAspect(e, id); redraw(true); })
        ]),
        api.el('div', { class: 'tiny', text: '裁剪框按当前比例居中收进去；构图微调建议在 1:1 与 3:2 之间多试两张。' })
      ]));

      /* 输出 */
      var out = R.output || (R.output = { format: 'jpeg', quality: 92, maxSide: 0 });
      insp.appendChild(api.group('导出', [
        api.segmented([{ id: 'jpeg', label: 'JPEG' }, { id: 'png', label: 'PNG' }], out.format, function (id) { out.format = id; redraw(true); }),
        api.slider({
          label: 'JPEG 品质', min: 60, max: 100, value: out.quality, unit: '',
          onInput: function (v) { out.quality = v; }
        }),
        api.segmented([{ id: 0, label: '原始尺寸' }, { id: 2560, label: '2560' }, { id: 1600, label: '1600' }], out.maxSide, function (id) { out.maxSide = id; }),
        api.el('button', { class: 'control primary', style: { width: '100%' }, text: '导出当前张', onclick: function () { exportCurrent(api); } }),
        api.el('button', { class: 'control', style: { width: '100%' }, text: '逐张导出全部（' + st.images.length + '）', onclick: function () { exportAll(api); } }),
        api.el('div', { class: 'divider' }),
        api.el('button', { class: 'control', style: { width: '100%' }, text: '导出配方 .json', onclick: function () { api.saveText(safeName(e.name) + '.lumenfield.json', JSON.stringify(R, null, 1), 'application/json'); } }),
        api.el('button', { class: 'control', style: { width: '100%' }, text: '载入配方', onclick: function () { pickRecipe(api); } }),
        api.el('button', { class: 'control', style: { width: '100%' }, text: '烘 .cube（33³，色彩链）', onclick: function () { exportCube(api, 33); } }),
        api.el('button', { class: 'control', style: { width: '100%' }, text: '烘 .cube（17³，轻一点）', onclick: function () { exportCube(api, 17); } }),
        api.el('div', { class: 'tiny', text: '.cube 只含曝光/影调/曲线/白平衡/分色/分离色调这类与位置无关的算子；磨皮、去雾、控制点依赖像素邻域，不进 LUT。' })
      ]));

      /* 渲染调度 */
      function redraw(full) {
        view.low = !full;
        if (host.pending) cancelAnimationFrame(host.pending);
        host.pending = requestAnimationFrame(function () { host.pending = null; paintPreview(api, full !== false); });
      }
      paintPreview(api, true);
      paintToolHint();
      host.redraw = redraw;

      /* 键盘：~ 看原图 */
      keyHandler = function (ev) {
        if (ev.key === '~' || (ev.key === '`' && !ev.repeat)) { view.peek = true; paintPreview(api, true); }
        if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's') {
          ev.preventDefault();
          api.saveText(safeName(current().name) + '.lumenfield.json', JSON.stringify(current().recipe, null, 1), 'application/json');
          api.toast('配方已存成 .json');
        }
      };
      upHandler = function (ev) {
        if (ev.key === '~' || ev.key === '`') { view.peek = false; paintPreview(api, true); }
      };
      document.addEventListener('keydown', keyHandler);
      document.addEventListener('keyup', upHandler);
      api._cleanup = function () {
        document.removeEventListener('keydown', keyHandler);
        document.removeEventListener('keyup', upHandler);
        if (host.pending) cancelAnimationFrame(host.pending);
      };
    }
  });

  /* ── 实现细节 ─────────────────────────────────────── */

  function current() {
    var st = LF.state;
    return st.images[st.selectedImage] || st.images[0] || null;
  }
  function blankGeo() { return { rotate: 0, zoom: 1, aspect: 'free', perspV: 0, perspH: 0, crop: null }; }
  function newRecipe() {
    var r = F.normalizeRecipe({});
    r.portrait = { smooth: 0, quality: 0, evenTone: 0, dewaxy: 0, spots: [], paint: [] };
    r.geometry = blankGeo();
    r.local = [];
    r.split = { hiH: 0, hiS: 0, hiA: 0, loH: 0, loS: 0, loA: 0 };
    return r;
  }
  function dig(o, path) {
    return path.split('.').reduce(function (v, k) { return (v === undefined || v === null) ? undefined : v[k]; }, o) || 0;
  }
  function put(o, path, v) {
    var ks = path.split('.'), cur = o;
    for (var i = 0; i < ks.length - 1; i++) {
      if (typeof cur[ks[i]] !== 'object' || cur[ks[i]] === null) cur[ks[i]] = {};
      cur = cur[ks[i]];
    }
    cur[ks[ks.length - 1]] = v;
  }
  function safeName(n) { return String(n).replace(/\.[a-z0-9]+$/i, '').replace(/[^\w一-龥-]/g, '_').slice(0, 48) || 'photo'; }

  function importFiles(files, api) {
    var arr = Array.prototype.slice.call(files || []).filter(function (f) { return /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|tiff?)$/i.test(f.name); });
    if (!arr.length) { api.toast('没看到图片文件'); return; }
    var st = api.state;
    st.images = st.images || [];
    var pending = arr.length;
    arr.forEach(function (f) {
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          st.images.push({
            id: 'i' + Date.now() + Math.random().toString(36).slice(2, 6),
            name: f.name, img: img, w: img.naturalWidth, h: img.naturalHeight,
            recipe: newRecipe(), cache: {}, thumb: makeThumb(img), flag: false
          });
          st.selectedImage = st.images.length - 1;
          if (!--pending) api.rerender();
        };
        img.onerror = function () { api.toast(f.name + ' 读不出来（HEIF 可能浏览器不支持，先转成 JPEG）'); if (!--pending) api.rerender(); };
        img.src = fr.result;
      };
      fr.onerror = function () { if (!--pending) api.toast('有文件读失败'); };
      fr.readAsDataURL(f);
    });
  }
  function makeThumb(img) {
    var c = document.createElement('canvas');
    c.width = 156; c.height = Math.max(1, Math.round(156 * img.naturalHeight / img.naturalWidth));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    try { return c.toDataURL('image/jpeg', 0.7); } catch (e) { return ''; }
  }
  function bindDrop(node, api) {
    ['dragenter', 'dragover'].forEach(function (t) {
      node.addEventListener(t, function (e) { e.preventDefault(); node.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      node.addEventListener(t, function (e) { e.preventDefault(); node.classList.remove('over'); });
    });
    node.addEventListener('drop', function (e) { importFiles(e.dataTransfer.files, api); });
  }
  function bindStage(canvas, api) {
    canvas.addEventListener('pointerdown', function (ev) {
      var e = current(); if (!e) return;
      var rect = canvas.getBoundingClientRect();
      var nx = (ev.clientX - rect.left) / rect.width, ny = (ev.clientY - rect.top) / rect.height;
      if (view.toolPoint === 'point') {
        e.recipe.local.push({ x: nx, y: ny, r: 0.22, exposure: 40, temp: 0, sat: 0, dehaze: 0, feather: 0.4 });
        api.rerender();
        return;
      }
      var pp = e.recipe.portrait;
      if (view.tool === 'paint') { pp.paint.push({ x: nx, y: ny, r: view.brushR }); host.redraw(true); return; }
      if (view.tool.indexOf('warp') === 0) {
        pp.spots.push({ type: 'warp', x: nx, y: ny, r: view.brushR * 1.6, amount: (view.tool === 'warp+' ? 32 : -32) });
        host.redraw(true); return;
      }
      if (view.tool !== 'none') {
        pp.spots.push({ type: view.tool, x: nx, y: ny, r: view.brushR, amount: view.tool === 'eye' ? 60 : 45 });
        host.redraw(true);
      }
    });
    canvas.addEventListener('dblclick', function () {
      var e = current();
      if (e && e.recipe.geometry) { e.recipe.geometry = blankGeo(); host.redraw(true); }
    });
  }

  /** 取源图像像素（带缓存）：maxW 决定重采样宽度 */
  function sourceData(entry, maxW) {
    var key = 'w' + maxW;
    if (entry.cache[key]) return entry.cache[key];
    var scale = Math.min(1, maxW / entry.w);
    var w = Math.max(1, Math.round(entry.w * scale)), h = Math.max(1, Math.round(entry.h * scale));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(entry.img, 0, 0, w, h);
    var d = ctx.getImageData(0, 0, w, h);
    var obj = { data: d.data, width: w, height: h };
    entry.cache = {};
    entry.cache[key] = obj;
    return obj;
  }

  function geoFor(entry, R) {
    var g = R.geometry || blankGeo();
    var out = { rotate: g.rotate || 0, zoom: g.zoom || 1, crop: g.crop || null, persp: null };
    var v = g.perspV || 0, hh = g.perspH || 0;
    if (v || hh) {
      var w = (g.crop ? g.crop.w : entry.w) / (g.zoom || 1);
      var h = (g.crop ? g.crop.h : entry.h) / (g.zoom || 1);
      var ix = w * 0.16 * hh, iy = h * 0.16 * v;
      out.persp = {
        tl: [ix, -iy], tr: [w - ix, -iy],
        br: [w + ix, h + iy], bl: [-ix, h + iy]
      };
    }
    return out;
  }

  function applyAspect(entry, id) {
    if (id === 'free') { entry.recipe.geometry.crop = null; return; }
    var ratio = { '3:2': 3 / 2, '4:3': 4 / 3, '1:1': 1, '16:9': 16 / 9, '竖': 9 / 16 }[id];
    var w = entry.w, h = entry.h;
    var cw = w, ch = w / ratio;
    if (ch > h) { ch = h; cw = h * ratio; }
    entry.recipe.geometry.crop = { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch };
    entry.recipe.geometry.aspect = id;
  }

  function paintPreview(api, full) {
    var e = current();
    if (!e || !host.canvas) return;
    var longSide = Math.max(host.canvas.clientWidth || 800, 400);
    var maxW = full ? Math.min(1500, Math.max(e.w, 1)) : 720;
    if (!full && e.cache['w' + maxW]) maxW = maxW;
    var src = sourceData(e, maxW);
    var R = JSON.parse(JSON.stringify(e.recipe));
    R.geometry = geoFor(e, e.recipe);
    var out = F.renderPipeline(src, R);
    var scale = Math.min(1, longSide / out.width);
    var cw = Math.round(out.width * scale), chh = Math.round(out.height * scale);
    host.canvas.style.width = cw + 'px';
    host.canvas.style.height = chh + 'px';
    host.canvas.width = Math.round(cw * Math.min(root.devicePixelRatio || 1, 2));
    host.canvas.height = Math.round(chh * Math.min(root.devicePixelRatio || 1, 2));
    var ctx = host.canvas.getContext('2d');
    ctx.setTransform(host.canvas.width / cw, 0, 0, host.canvas.width / cw, 0, 0);
    if (view.peek) {
      blit(ctx, src, cw, chh);
    } else {
      blit(ctx, out, cw, chh);
      var sx = view.split * cw;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, sx, chh); ctx.clip();
      blit(ctx, src, cw, chh);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, chh); ctx.stroke();
    }
    paintHistogram(out);
    var ro = F.toneReadout(out);
    var readoutBox = host.canvas.closest('.content').querySelector('.card.tight .row.spread');
    if (readoutBox) {
      readoutBox.textContent = '';
      var el = api.el;
      readoutBox.appendChild(el('div', { class: 'row', style: { gap: '14px' } }, [
        el('span', { class: 'chip', text: '均亮 ' + ro.mean.toFixed(1) }),
        el('span', { class: 'chip ' + (ro.clipHigh > 0.02 ? 'bad' : 'muted'), text: '爆掉 ' + (ro.clipHigh * 100).toFixed(1) + '%' }),
        el('span', { class: 'chip ' + (ro.clipLow > 0.05 ? 'warn' : 'muted'), text: '死黑 ' + (ro.clipLow * 100).toFixed(1) + '%' }),
        el('span', { class: 'chip muted', text: '预览 ' + out.width + '×' + out.height }),
        el('span', { class: 'chip info', text: '耗时 ' + out.stats.ms + 'ms' })
      ]));
      readoutBox.appendChild(el('div', { class: 'tiny', text: out.stats.stages.map(function (s) { return s.stage + ' ' + s.ms + 'ms'; }).join(' · ') }));
    }
    e.lastOut = out;
  }
  function blit(ctx, img, w, h) {
    var tmp = document.createElement('canvas');
    tmp.width = img.width; tmp.height = img.height;
    tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    ctx.drawImage(tmp, 0, 0, w, h);
  }
  function paintHistogram(out) {
    if (!host.hist) return;
    var ctx = host.hist.getContext('2d');
    var w = host.hist.width, h = host.hist.height;
    ctx.clearRect(0, 0, w, h);
    var hs = F.histogram(out, 256);
    var max = 1;
    for (var i = 0; i < 256; i++) max = Math.max(max, hs.r[i], hs.g[i], hs.b[i]);
    function series(arr, color) {
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (var k = 0; k < 256; k++) ctx.lineTo(k / 255 * w, h - (arr[k] / max) * (h - 4));
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'lighter';
    series(hs.r, 'rgba(225,80,90,0.5)');
    series(hs.g, 'rgba(70,200,110,0.5)');
    series(hs.b, 'rgba(80,130,245,0.5)');
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(128,128,128,0.35)';
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }

  function paintToolHint() {
    var box = document.getElementById('tool-hint');
    if (!box) return;
    var map = {
      none: '不打点：在图上点击无作用。',
      eye: '点一下眼睛：提亮 + 去黄 + 局部锐化，半径用下面的笔刷调。',
      teeth: '点一下牙齿：只压黄色并抬亮度，不动唇色。',
      bag: '点一下黑眼圈：局部抬亮度，不抹结构。',
      'warp-': '按住轮廓线点：该处向内收（下颌线、颧骨）。',
      'warp+': '点一下：该处向外扩（填太阳穴、丰苹果肌）。',
      paint: '自动肤色判据漏掉的地方涂进来（深肤色/逆光常见）。'
    };
    box.textContent = map[view.tool] || '';
  }

  function selfCheckMask(api, e) {
    var src = sourceData(e, 420);
    var m = F.skinMask(src, {});
    var sum = 0, hi = 0;
    for (var i = 0; i < m.length; i++) { sum += m[i]; if (m[i] > 0.5) hi++; }
    var share = hi / m.length;
    api.toast('肤色判据覆盖 ' + (share * 100).toFixed(1) + '% 的像素。' +
      (share < 0.03 ? '几乎没认出皮肤——多半是风光片，或用"补画肤色"手动涂。' :
        share > 0.55 ? '覆盖偏高，可能把天空/墙面也算进去了，先降匀肤与磨皮强度。' : '量级正常。'));
  }

  function exportCurrent(api) {
    var e = current(); if (!e) return;
    var R = JSON.parse(JSON.stringify(e.recipe));
    R.geometry = geoFor(e, e.recipe);
    var maxSide = (R.output && R.output.maxSide) || 0;
    var targetW = maxSide ? Math.min(e.w, maxSide) : e.w;
    api.toast('按原始尺寸重算中…');
    setTimeout(function () {
      var src = sourceData(e, targetW);
      var out = F.renderPipeline(src, R);
      var c = document.createElement('canvas');
      c.width = out.width; c.height = out.height;
      c.getContext('2d').putImageData(new ImageData(out.data, out.width, out.height), 0, 0);
      var fmt = (R.output && R.output.format) === 'png' ? 'image/png' : 'image/jpeg';
      c.toBlob(function (blob) {
        api.downloadBlob(safeName(e.name) + '-光野.' + (fmt === 'image/png' ? 'png' : 'jpg'), blob);
        api.toast('已导出 ' + out.width + '×' + out.height + '（' + (blob.size / 1048576).toFixed(2) + ' MB）');
      }, fmt, ((R.output && R.output.quality) || 92) / 100);
    }, 30);
  }

  function exportAll(api) {
    var st = api.state, i = 0;
    (function next() {
      if (i >= st.images.length) { api.toast('全部导出完成（' + st.images.length + ' 张）'); return; }
      st.selectedImage = i;
      api.toast('正在导出 ' + (i + 1) + '/' + st.images.length + '：' + st.images[i].name);
      exportCurrent(api);
      i++;
      setTimeout(next, 900);
    })();
  }

  function exportCube(api, size) {
    var e = current(); if (!e) return;
    api.toast('烘 ' + size + '³ LUT 中…');
    setTimeout(function () {
      var cube = F.bakeCube(e.recipe, size);
      api.saveText(safeName(e.name) + '.cube', cube, 'text/plain;charset=utf-8');
      api.toast('.cube 已导出，可直接进 Lightroom / Capture One 的调色查找表');
    }, 20);
  }

  function pickRecipe(api) {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = function () {
      var f = inp.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var obj = JSON.parse(fr.result);
          var merged = Object.assign(newRecipe(), obj);
          merged.geometry = obj.geometry || blankGeo();
          merged.portrait = Object.assign({ smooth: 0, quality: 0, evenTone: 0, dewaxy: 0, spots: [], paint: [] }, obj.portrait || {});
          current().recipe = merged;
          api.toast('配方已载入，哈希 ' + F.recipeHash(merged));
          api.rerender();
        } catch (err) { api.toast('这个 JSON 读不懂：' + err.message); }
      };
      fr.readAsText(f);
    };
    inp.click();
  }
})(typeof window !== 'undefined' ? window : globalThis);
