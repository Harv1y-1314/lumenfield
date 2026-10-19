/* 光野 · 外壳与控件库
 *
 * 这一层管四件事：状态存取（localStorage，写不进去就退回内存，file:// 下 Safari 会拒）、
 * 视图注册与切换、共用控件的生成、以及下载类动作的统一出口。
 * 视图模块只依赖这里暴露的 LF / LFUI，不互相引用，方便单独截图核对。
 */
(function (root) {
  'use strict';

  var A = root.LFAstro;

  var ICONS = {
    home: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 8.5 8 3l6 5.5"/><path d="M4 8v5h8V8"/></svg>',
    route: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 13c1.6-4 4.2-6 9-6.6"/><circle cx="3.2" cy="12.8" r="1.6"/><circle cx="12.8" cy="3.4" r="1.6"/><path d="M6 12.5h4"/></svg>',
    sky: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8 2.2l1.5 3.3 3.6.4-2.7 2.5.8 3.6L8 10.1l-3.5 1.9.8-3.6L2.9 5.9l3.6-.4z"/><circle cx="12.6" cy="2.6" r=".9" fill="currentColor" stroke="none"/></svg>',
    retouch: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2.2" y="3" width="11.6" height="10" rx="2"/><path d="M6.6 6.2l2.8 3.6-2.8 0z"/><circle cx="10.4" cy="6" r="1"/></svg>',
    tools: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="7" cy="7" r="3.4"/><path d="M9.6 9.6 13.4 13.4"/><path d="M3.2 12.8h3"/></svg>',
    sun: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="8" cy="8" r="3"/><path d="M8 1.4v1.8M8 12.8v1.8M1.4 8h1.8M12.8 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3"/></svg>',
    moon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M10.6 2.2a5.4 5.4 0 1 0 3.2 9.1A6 6 0 0 1 10.6 2.2z"/></svg>',
    auto: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="8" cy="8" r="5.6"/><path d="M8 2.4v11.2" /><path d="M8 2.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor" stroke="none"/></svg>'
  };

  var VIEWS = {};
  var store = {
    view: 'home',
    siteKey: 'beijing',
    site: null,
    customSite: null,     // siteKey==='custom' 时用户手填的那一份，跟着持久化
    dateISO: new Date().toISOString().slice(0, 10),
    theme: 'auto',
    images: [],           // 精修的批量队列，不入库
    selectedImage: 0,
    recipe: null,
    sky: {
      hour: 21.5, playing: false, speed: 5, mode: 'dome', lens: 24, aspect: '3:2',
      bearing: 180, centerAlt: 20, magLimit: 5.6, showFrame: true,
      cond: { cloud: 20, bortle: 3, haze: 20 },
      layers: { stars: true, milky: true, planets: true, moon: true, grid: true, names: true, consts: true, ecliptic: false }
    },
    route: { days: 7, kind: '风光' }
  };

  var KEY = 'lumenfield.v1';
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var VIEW_IDS = ['home', 'route', 'sky', 'retouch', 'tools'];
  var THEMES = ['auto', 'light', 'dark'];
  function numIn(v, lo, hi, dflt) {
    var n = Number(v);
    return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  }
  // 存档里每一个数都要过一遍：手改或旧版残留的 NaN 会顺着历算传到
  // createRadialGradient(NaN…) 与 style.width='NaN%'，前者抛异常只剩兜底卡、
  // 后者静默失效。isFinite 之后夹回各滑杆自己的量程，不合法就留默认值。
  var SKY_RANGE = {
    hour: [0, 24], lens: [8, 400], bearing: [0, 360], centerAlt: [-5, 88], speed: [1, 15]
  };
  function sanitizeSky(o) {
    var out = {};
    for (var k in SKY_RANGE) {
      if (o[k] === undefined) continue;
      out[k] = numIn(o[k], SKY_RANGE[k][0], SKY_RANGE[k][1], store.sky[k]);
    }
    return out;
  }
  function sanitizeSite(o) {
    if (!o || typeof o !== 'object') return null;
    var lat = Number(o.lat), lon = Number(o.lon), tz = Number(o.tz), h = Number(o.height);
    if (!isFinite(lat) || !isFinite(lon) || !isFinite(tz)) return null;
    return {
      id: 'custom', name: '自定义机位', region: '', note: '手填坐标',
      lat: Math.min(89.9, Math.max(-89.9, lat)), lon: Math.min(179.9, Math.max(-179.9, lon)),
      tz: Math.round(Math.min(840, Math.max(-720, tz))),
      height: isFinite(h) ? Math.min(6000, Math.max(-100, h)) : 0
    };
  }
  function load() {
    try {
      var s = root.localStorage.getItem(KEY);
      if (!s) return;
      var o = JSON.parse(s);
      if (VIEW_IDS.indexOf(o.view) >= 0) store.view = o.view;
      if (THEMES.indexOf(o.theme) >= 0) store.theme = o.theme;
      if (DATE_RE.test(o.dateISO || '')) store.dateISO = o.dateISO;
      if (typeof o.siteKey === 'string') store.siteKey = o.siteKey;
      if (store.siteKey === 'custom') store.customSite = sanitizeSite(o.custom);
      // 逐字段合并而不是整块覆盖：老版本存档里没有的字段（lens、mode…）要留默认值
      ['sky', 'route'].forEach(function (k) {
        if (!o[k]) return;
        for (var f in o[k]) if (f !== 'layers' && f !== 'cond') store[k][f] = o[k][f];
        ['layers', 'cond'].forEach(function (sub) {
          if (!o[k][sub]) return;
          for (var g in o[k][sub]) store[k][sub][g] = o[k][sub][g];
        });
      });
      if (o.sky) { var sk = sanitizeSky(o.sky); for (var q in sk) store.sky[q] = sk[q]; }
      store.sky.playing = false;                       // 播放态永不从存档恢复
      store.route.days = numIn(store.route.days, 3, 14, 7);
    } catch (e) { /* file:// 或隐私模式下读不到，静默用默认值 */ }
  }
  function save() {
    try {
      root.localStorage.setItem(KEY, JSON.stringify({
        view: store.view, siteKey: store.siteKey, dateISO: store.dateISO,
        theme: store.theme, sky: store.sky, route: store.route,
        // 自定义坐标只存在内存里过，刷新就回到"北京·香山"、下拉还空着：
        // 手改机位是这条路径的主要用法，必须跟着存
        custom: store.siteKey === 'custom' ? store.site : store.customSite
      }));
    } catch (e) { /* 存不下就算了，功能不依赖它 */ }
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;   // 只用于本仓内写死的内联 SVG 图标，不接任何外部数据
      else if (k === 'text') n.textContent = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') { for (var s in v) n.style[s] = v[s]; }
      else n.setAttribute(k, v === true ? '' : v);
    }
    appendKids(n, kids);
    return n;
  }

  function siteFromKey(key) {
    var list = (root.LFSites && root.LFSites.list) || [];
    if (key === 'custom') {
      return store.customSite || { id: 'custom', name: '自定义机位', region: '', note: '手填坐标',
        lat: 39.9042, lon: 116.4074, tz: 480, height: 44 };
    }
    for (var i = 0; i < list.length; i++) if (list[i].id === key) return list[i];
    return list[0];
  }

  function currentDate() {
    var d = new Date(store.dateISO + 'T12:00:00Z');
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }

  /* ── 共用控件 ───────────────────────────────────────── */

  function slider(opts) {
    var row = el('div', { class: 'slider-row' });
    var val = el('span', { class: 'slider-value', text: fmtVal(opts) });
    row.appendChild(el('label', { class: 'slider-label' }, [
      opts.label,
      opts.hint ? el('span', { class: 'tiny', title: opts.hint, text: 'ⓘ' }) : null
    ]));
    row.appendChild(val);
    var input = el('input', {
      type: 'range', min: opts.min, max: opts.max, step: opts.step || 1, value: opts.value,
      'aria-label': opts.label, class: opts.bipolar ? 'bipolar' : null
    });
    row.appendChild(input);
    if (opts.hint) row.appendChild(el('div', { class: 'slider-hint', text: opts.hint }));
    function paint() {
      var pct = (input.value - opts.min) / (opts.max - opts.min) * 100;
      if (opts.bipolar) {
        var zero = (0 - opts.min) / (opts.max - opts.min) * 100;
        var lo = Math.min(zero, pct), hi = Math.max(zero, pct);
        input.style.setProperty('--pct', pct + '%');
        input.style.background = '';
        input.style.setProperty('-webkit-trick', '0');
        input.style.setProperty('--bip-lo', lo + '%');
        input.style.setProperty('--bip-hi', hi + '%');
      } else {
        input.style.setProperty('--pct', pct + '%');
      }
      val.textContent = fmtVal(Object.assign({}, opts, { value: Number(input.value) }));
    }
    input.addEventListener('input', function () {
      paint();
      if (opts.onInput) opts.onInput(Number(input.value));
    });
    input.addEventListener('change', function () { if (opts.onChange) opts.onChange(Number(input.value)); });
    paint();
    row.input = input;
    row.setValue = function (v) { input.value = v; paint(); };
    return row;
  }
  function fmtVal(o) {
    var v = Number(o.value);
    var s = o.step && o.step < 1 ? v.toFixed(2) : String(Math.round(v * 100) / 100);
    if (o.sign && v > 0) s = '+' + s;
    return s + (o.unit || '');
  }

  /** 子节点接受单值、数组、任意层嵌套的数组，以及 null/false（当条件渲染用）。
   *  不递归展平的话，card(opts, kids) 这种把数组当一个孩子传下去的写法会当场炸。 */
  function appendKids(node, kids) {
    if (kids === null || kids === undefined || kids === false || kids === true) return;
    if (Array.isArray(kids)) { kids.forEach(function (k) { appendKids(node, k); }); return; }
    if (kids instanceof Node) { node.appendChild(kids); return; }
    node.appendChild(document.createTextNode(String(kids)));
  }

  function group(title, kids, opts) {
    opts = opts || {};
    var wrap = el('div', { class: 'insp-group', 'data-collapsed': opts.collapsed ? 'true' : 'false' });
    var head = el('button', { class: 'insp-head', 'aria-expanded': opts.collapsed ? 'false' : 'true' }, [
      el('span', { class: 'chev', html: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.5 4l2.5 2.5L7.5 4"/></svg>' }),
      el('span', { class: 'insp-title', text: title }),
      opts.note ? el('span', { class: 'tiny', style: { marginLeft: 'auto' }, text: opts.note }) : null
    ]);
    var body = el('div', { class: 'insp-body' }, kids);
    head.addEventListener('click', function () {
      var open = head.getAttribute('aria-expanded') === 'true';
      head.setAttribute('aria-expanded', open ? 'false' : 'true');
      wrap.setAttribute('data-collapsed', open ? 'true' : 'false');
    });
    wrap.appendChild(head); wrap.appendChild(body);
    return wrap;
  }

  function seg(items, active, onPick) {
    var box = el('div', { class: 'segmented', role: 'tablist' });
    items.forEach(function (it) {
      var b = el('button', { role: 'tab', 'aria-selected': it.id === active, text: it.label, onclick: function () { onPick(it.id); } });
      box.appendChild(b);
    });
    box.setActive = function (id) {
      Array.prototype.forEach.call(box.children, function (c, i) {
        c.setAttribute('aria-selected', items[i].id === id ? 'true' : 'false');
      });
    };
    return box;
  }

  function toggle(label, checked, onChange, hint) {
    var input = el('input', { type: 'checkbox', checked: checked ? true : null, 'aria-label': label });
    input.addEventListener('change', function () { onChange(input.checked); });
    return el('label', { class: 'switch' }, [input, el('span', { text: label }), hint ? el('span', { class: 'tiny', text: hint }) : null]);
  }

  function chip(text, kind) { return el('span', { class: 'chip ' + (kind || 'muted'), text: text }); }

  function table(cols, rows) {
    var t = el('table', { class: 'data' });
    t.appendChild(el('thead', {}, el('tr', {}, cols.map(function (c) {
      return el('th', { class: c.num ? 'num' : null, text: c.label });
    }))));
    var tb = el('tbody');
    rows.forEach(function (r) {
      tb.appendChild(el('tr', {}, cols.map(function (c) {
        var v = typeof c.get === 'function' ? c.get(r) : r[c.key];
        return el('td', { class: (c.num ? 'num ' : '') + (c.cls ? (typeof c.cls === 'function' ? c.cls(r) : c.cls) : ''), text: v });
      })));
    });
    t.appendChild(tb);
    return t;
  }

  function card(opts, kids) {
    return el('div', { class: 'card ' + (opts.class || '') }, [
      opts.title ? el('div', { class: 'card-title', text: opts.title }) : null,
      opts.sub ? el('div', { class: 'card-sub', text: opts.sub }) : null,
      kids
    ]);
  }
  function stat(num, unit, label, note) {
    return el('div', { class: 'stat' }, [
      el('div', { class: 'stat-num' }, [String(num), unit ? el('span', { class: 'unit', text: unit }) : null]),
      el('div', { class: 'stat-label', text: label }),
      note ? el('div', { class: 'stat-note', text: note }) : null
    ]);
  }

  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('lf-toast');
    if (!t) { t = el('div', { class: 'toast', id: 'lf-toast' }); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function saveText(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    downloadBlob(name, blob);
  }
  function downloadBlob(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  // store.theme 是用户的选择（auto / light / dark），data-theme 是生效结果，两者不能混成一个值：
  // 早期版本在启动时就把 auto 覆盖成 light|dark，结果系统换外观后界面再也不跟随。
  function effectiveTheme() {
    if (store.theme === 'light' || store.theme === 'dark') return store.theme;
    return root.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyTheme(choice) {
    if (choice) store.theme = choice;
    if (store.theme !== 'light' && store.theme !== 'dark') store.theme = 'auto';
    document.documentElement.setAttribute('data-theme', effectiveTheme());
    save();
    var btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.innerHTML = store.theme === 'light' ? ICONS.sun : store.theme === 'dark' ? ICONS.moon : ICONS.auto;
      btn.title = '外观：' + ({ auto: '自动（跟随系统）', light: '浅色', dark: '深色' })[store.theme] + '（点击切换）';
      btn.setAttribute('aria-label', btn.title);
    }
  }

  function rerender() {
    if (api._cleanup) { try { api._cleanup(); } catch (e) { /* 上一屏的监听器清不掉也不能挡住下一屏 */ } api._cleanup = null; }
    var view = VIEWS[store.view] || VIEWS.home;
    var content = document.getElementById('content');
    var insp = document.getElementById('inspector');
    document.getElementById('view-title').textContent = view.title;
    document.getElementById('view-sub').textContent = typeof view.sub === 'function' ? view.sub() : (view.sub || '');
    document.body.classList.toggle('no-inspector', !view.hasInspector);
    content.textContent = '';
    insp.textContent = '';
    document.getElementById('toolbar-actions').textContent = '';   // 上一屏的按钮不能留到这一屏
    try {
      view.render(content, insp, api);
    } catch (err) {
      // 一屏算崩不该让整站变白页：把错误本身显示出来，同时留 console 现场
      content.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'card-title', text: '这一屏没算完' }),
        el('div', { class: 'card-sub', text: String(err && err.message || err) }),
        el('div', { class: 'tiny', text: '浏览器控制台里有完整堆栈；刷新页面通常能恢复，其他工作区不受影响。' })
      ]));
      throw err;
    }
    Array.prototype.forEach.call(document.querySelectorAll('#nav .nav-item'), function (n) {
      n.setAttribute('aria-current', n.dataset.view === store.view ? 'true' : 'false');
    });
    document.getElementById('date-hint').textContent = weekLabel(currentDate());
  }

  function weekLabel(d) {
    var names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    var t = new Date(Date.UTC(d.y, d.m - 1, d.d));
    return names[t.getUTCDay()] + ' · 第 ' + dayOfYear(t) + ' 天';
  }
  function dayOfYear(t) {
    return Math.floor((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000) + 1;
  }

  var api = {
    el: el, ICONS: ICONS, A: A,
    state: store,
    get site() { return store.site; },
    siteKey: function () { return store.siteKey; },
    date: currentDate,
    dayOfYear: dayOfYear,
    slider: slider, group: group, segmented: seg, toggle: toggle, chip: chip,
    table: table, card: card, stat: stat, toast: toast,
    saveText: saveText, downloadBlob: downloadBlob,
    rerender: rerender, save: save, setTheme: applyTheme,
    go: function (id) { if (VIEWS[id]) { store.view = id; save(); rerender(); } },
    register: function (id, view) { VIEWS[id] = view; },
    views: function () { return Object.keys(VIEWS); },
    time: function (d) { return A ? A.fmtTime(d, store.site.tz) : '—'; },
    stamp: function (d) { return A ? A.fmt(d, store.site.tz) : '—'; }
  };

  function boot() {
    load();
    store.site = siteFromKey(store.siteKey);
    applyTheme(store.theme);
    var mq = matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', function () { applyTheme(); });

    var nav = document.getElementById('nav');
    var order = [
      { id: 'home', label: '工作台', icon: 'home', key: '1' },
      { id: 'route', label: '路书', icon: 'route', key: '2' },
      { id: 'sky', label: '星野', icon: 'sky', key: '3' },
      { id: 'retouch', label: '精修', icon: 'retouch', key: '4' },
      { id: 'tools', label: '工具箱', icon: 'tools', key: '5' }
    ];
    order.forEach(function (it) {
      nav.appendChild(el('button', {
        class: 'nav-item', 'data-view': it.id, 'aria-current': it.id === store.view ? 'true' : 'false',
        onclick: function () { api.go(it.id); }
      }, [
        el('span', { class: 'nav-ic', html: ICONS[it.icon] }),
        el('span', { text: it.label }),
        el('span', { class: 'nav-key', text: it.key })
      ]));
    });

    var sel = document.getElementById('site-select');
    (root.LFSites.list || []).forEach(function (s) {
      sel.appendChild(el('option', { value: s.id, text: s.name + (s.region ? ' · ' + s.region : '') }));
    });
    // 手改过坐标时 siteKey 是 'custom'，列表里没这一项，下拉会停在空白上——补一项
    if (store.siteKey === 'custom') {
      sel.appendChild(el('option', { value: 'custom', text: '自定义机位' }));
    }
    sel.value = store.siteKey;
    sel.addEventListener('change', function () {
      store.siteKey = sel.value;
      store.site = siteFromKey(sel.value);
      save(); paintSiteMeta(); rerender();
    });

    var dateIn = document.getElementById('date-input');
    dateIn.value = store.dateISO;
    dateIn.addEventListener('change', function () {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIn.value)) return;
      store.dateISO = dateIn.value; save(); rerender();
    });

    document.getElementById('theme-toggle').addEventListener('click', function () {
      applyTheme(store.theme === 'auto' ? 'light' : store.theme === 'light' ? 'dark' : 'auto');
      rerender();
    });
    document.getElementById('help-btn').addEventListener('click', function () {
      document.getElementById('help-dialog').showModal();
    });
    // 窄屏时检查器是抽屉：打开靠点侧栏，关闭给右上角一个明确的 ×
    var closeBtn = el('button', {
      class: 'insp-close icon-btn', 'aria-label': '收起参数面板', text: '×',
      onclick: function () { document.body.classList.remove('inspector-open'); }
    });
    document.getElementById('inspector').prepend(closeBtn);
    document.addEventListener('keydown', function (e) {
      if (e.target.matches('input,select,textarea')) return;
      if (e.key >= '1' && e.key <= '5') {
        var it = order[Number(e.key) - 1];
        if (it) api.go(it.id);
      }
      if (e.key === 'Escape') document.body.classList.remove('inspector-open');
    });

    paintSiteMeta();
    rerender();
  }

  function paintSiteMeta() {
    var s = store.site, box = document.getElementById('site-meta');
    box.textContent = '';
    box.appendChild(document.createTextNode(fmtLatLon(s.lat, s.lon) + ' · ' + tzLabel(s.tz) +
      (s.height ? ' · ' + s.height + ' m' : '')));
    if (s.note) { box.appendChild(document.createElement('br')); box.appendChild(document.createTextNode(s.note)); }
  }
  function fmtLatLon(lat, lon) {
    return Math.abs(lat).toFixed(2) + '°' + (lat >= 0 ? 'N' : 'S') + ', ' + Math.abs(lon).toFixed(2) + '°' + (lon >= 0 ? 'E' : 'W');
  }
  function tzLabel(min) {
    var h = min / 60;
    return 'UTC' + (h >= 0 ? '+' : '−') + Math.abs(h);
  }
  // LFutil 只留真有人调的：tzLabel 被 home/route/tools 三个视图按 root.LFutil 取用。
  // 原先还挂着 esc 与 tzForLon——前者零调用，后者"按经度估时区"恰恰是路书里明确劝退的做法。
  root.LF = api;
  root.LFUI = api;
  root.LFutil = { fmtLatLon: fmtLatLon, tzLabel: tzLabel };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
