/* shot.mjs —— 用 Electron 无头渲染做界面回归：五个视图 × 明暗两套 × 桌面与窄屏，
 * 外加穹顶/取景两套投影、拖放导入与调参生效两条链路，共 17 组。
 * 截图落盘，同时把控制台报错与"这一屏没算完"的兜底卡抓出来当失败信号。
 *
 * 跑法：electron tools/shot.mjs
 *       SHOT_URL=http://127.0.0.1:8795/index.html electron tools/shot.mjs
 *
 * 截图落 $TMPDIR/lf-shots（或 SHOT_OUT 指定的目录），文件名是 视图-主题-宽[-投影].png；
 * 仓里的 docs/screens/01-home.png 那套编号名是从这些图缩半得来的，别直接 SHOT_OUT 到 docs。
 * 默认走 file://，因为"双击 index.html 就能用"这条承诺必须在同一套检查里被验证。
 * 全程只开一个窗口反复改尺寸与换主题：一次开一堆窗口会让 macOS 上的
 * Electron 崩在 Mach rendezvous（实测过）。
 */
import { app, BrowserWindow, nativeTheme } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(fileURLToPath(import.meta.url), '../..');
const BASE = process.env.SHOT_URL || ('file://' + join(HERE, 'index.html'));
const OUT = process.env.SHOT_OUT || join(process.env.TMPDIR || '/tmp', 'lf-shots');
const VIEWS = ['home', 'route', 'sky', 'retouch', 'tools'];

const cases = [];
for (const v of VIEWS) cases.push({ view: v, theme: 'light', w: 1440, h: 900 });
for (const v of VIEWS) cases.push({ view: v, theme: 'dark', w: 1440, h: 900 });
cases.push({ view: 'home', theme: 'dark', w: 412, h: 880 });
cases.push({ view: 'sky', theme: 'dark', w: 412, h: 880 });
cases.push({ view: 'retouch', theme: 'light', w: 412, h: 880 });
cases.push({ view: 'route', theme: 'light', w: 900, h: 720 });
cases.push({ view: 'retouch', theme: 'light', w: 1440, h: 900, import: true });
// 取景投影是另一套几何（视场、畸变、中心高度），只跑穹顶等于没验它
cases.push({ view: 'sky', theme: 'light', w: 1440, h: 900, frame: true });
cases.push({ view: 'sky', theme: 'dark', w: 1440, h: 900, frame: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

app.disableHardwareAcceleration();

const PROBE = `(function () {
  var c = document.getElementById('content');
  var crashed = [].slice.call(document.querySelectorAll('.card-title'))
    .some(function (t) { return t.textContent.indexOf('没算完') >= 0; });
  var canvas = c.querySelector('canvas');
  var painted = null;
  if (canvas) {
    try {
      var ctx = canvas.getContext('2d');
      var d = ctx.getImageData(0, 0, Math.min(canvas.width, 600), Math.min(canvas.height, 600)).data;
      var lit = 0;
      for (var i = 0; i < d.length; i += 4) if (d[i] + d[i+1] + d[i+2] > 240) lit++;
      painted = lit;
    } catch (err) { painted = -1; }
  }
  return {
    crashed: crashed,
    text: (c.innerText || '').replace(/\\s+/g, ' ').slice(0, 46),
    controls: document.getElementById('inspector').querySelectorAll('input').length,
    canvas: canvas ? canvas.width + 'x' + canvas.height : 0,
    painted: painted,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
    empty: !!document.querySelector('.dropzone'),
    theme: document.documentElement.getAttribute('data-theme')
  };
})()`;

app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true });
  const errors = [];
  const win = new BrowserWindow({ width: 1440, height: 900, show: false });
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 3) errors.push(String(e.message).slice(0, 150));
  });
  win.webContents.on('render-process-gone', (e, d) => errors.push('渲染进程没了：' + d.reason));
  await win.loadURL(BASE);
  await sleep(700);

  let bad = 0;
  for (const c of cases) {
    let problems0 = null; const t = {};
    // 外观一律走"自动跟随系统"这条路：改 nativeTheme 就是改系统的明暗偏好，
    // 这样一次跑完顺带把"界面是否真的跟随系统"也验了
    nativeTheme.themeSource = c.theme;
    errors.length = 0;
    win.setContentSize(c.w, c.h);
    await sleep(200);
    try {
      await win.webContents.executeJavaScript(`LF && LF.setTheme('auto'); LF.go(${JSON.stringify(c.view)}); 1`);
      await sleep(c.view === 'sky' ? 1400 : 800);
      if (c.view === 'sky') {
        // 投影模式必须每例显式设定：无头窗口的 localStorage 会跨次运行留存，
        // 上一轮把 sky.mode 存成 frame，这一轮的"穹顶"截图就悄悄变成取景图
        await win.webContents.executeJavaScript(`(function () {
          LF.state.sky.mode = ${JSON.stringify(c.frame ? 'frame' : 'dome')};
          if (LF.state.sky.mode === 'frame') LF.state.sky.lens = 16;
          LF.save(); LF.rerender(); return 1;
        })()`);
        await sleep(1400);
      }
      if (c.import) {
        // 走真实的拖放导入：在页面里画一张样片，塞进 DataTransfer 再派发 drop，
        // 这样 importFiles → FileReader → Image → 渲染链路整条都被跑到
        await win.webContents.executeJavaScript(`new Promise(function (resolve) {
          var cv = document.createElement('canvas'); cv.width = 640; cv.height = 480;
          var g = cv.getContext('2d');
          var sky = g.createLinearGradient(0, 0, 0, 480);
          sky.addColorStop(0, '#7ea8d8'); sky.addColorStop(1, '#d8c9a8');
          g.fillStyle = sky; g.fillRect(0, 0, 640, 480);
          g.fillStyle = 'rgb(206,164,138)';
          g.beginPath(); g.ellipse(320, 250, 120, 160, 0, 0, Math.PI * 2); g.fill();
          var rnd = 12345;
          for (var i = 0; i < 26000; i++) {
            rnd = (rnd * 1664525 + 1013904223) >>> 0;
            var x = rnd % 640, y = (rnd >> 10) % 480;
            g.fillStyle = 'rgba(255,255,255,' + ((rnd % 40) / 1000).toFixed(3) + ')';
            g.fillRect(x, y, 1, 1);
          }
          cv.toBlob(function (b) {
            var f = new File([b], '回归样片.png', { type: 'image/png' });
            var dt = new DataTransfer(); dt.items.add(f);
            var target = document.querySelector('.dropzone') || document.querySelector('.stage');
            target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
            resolve(1);
          }, 'image/png');
        })`);
        await sleep(2600);
        // 同一张图，磨皮 0 与磨皮 80 必须算出不同像素，否则这条链路是摆设
        t.dirtyHash = await win.webContents.executeJavaScript(`(function () {
          var c = document.getElementById('retouch-canvas');
          var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          var h = 0; for (var i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) >>> 0;
          return h;
        })()`);
        await win.webContents.executeJavaScript(`(function () {
          var r = LF.state.images[0].recipe;
          r.portrait.smooth = 80; r.portrait.quality = 30; r.portrait.dewaxy = 50;
          r.exposure = 0.3; r.clarity = 25;
          LF.state.images[0].cache = {};
          LF.rerender();          // 直接改配方不会自己重画，必须走一遍视图刷新
          return 1;
        })()`);
        await sleep(1800);
        const afterHash = await win.webContents.executeJavaScript(`(function () {
          var c = document.getElementById('retouch-canvas');
          var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          var h = 0; for (var i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) >>> 0;
          return h;
        })()`);
        if (afterHash === t.dirtyHash) problems0 = ['调参与不调参算出同一张图'];
        else problems0 = [];
        t.imported = await win.webContents.executeJavaScript(`LF.state.images.length`);
      }
      if (c.view === 'sky') {
        // 悬停扫一遍画布：hitTest 与 tooltip 是纯鼠标路径，截图永远盖不到。
        // 银心标记曾经只带屏幕坐标不带 alt/az，扫到它就每帧抛一次 TypeError。
        // 点数刻意压在 30：每次悬停都会重画 tooltip，扫太密会把回归本身拖成分钟级
        await win.webContents.executeJavaScript(`(function () {
          var cv = document.querySelector('#content canvas');
          if (!cv) return 0;
          var r = cv.getBoundingClientRect();
          for (var i = 0; i < 30; i++) {
            var x = r.left + r.width * ((i % 6) / 5), y = r.top + r.height * (Math.floor(i / 6) / 4);
            cv.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, cancelable: true }));
          }
          return 1;
        })()`);
        await sleep(200);
      }
      const probe = await win.webContents.executeJavaScript(PROBE);
      // 窄屏参数抽屉必须真的能打开：<=1180px 时检查器是 fixed + translateX(100%)，
      // 没有 inspector-open 就永远是屏幕外。以前全绿恰恰是因为探测不看可见性
      let drawerBad = null;
      if (c.w <= 1180) {
        await win.webContents.executeJavaScript(`document.getElementById('drawer-toggle').click(); 1`);
        await sleep(450);
        const d = await win.webContents.executeJavaScript(`(function () {
          var i = document.getElementById('inspector').getBoundingClientRect();
          return { open: document.body.classList.contains('inspector-open'),
                   onScreen: i.left < window.innerWidth - 40 && i.width > 100,
                   left: Math.round(i.left), vw: window.innerWidth };
        })()`);
        if (!d.open || !d.onScreen) drawerBad = '窄屏抽屉打不开（open=' + d.open + ' left=' + d.left + '/' + d.vw + '）';
        await win.webContents.executeJavaScript(`document.getElementById('drawer-toggle').click(); 1`);
        await sleep(350);
      }
      const img = await win.webContents.capturePage();
      const buf = img.toPNG();
      writeFileSync(join(OUT, `${c.view}-${c.theme}-${c.w}${c.frame ? '-frame' : ''}.png`), buf);
      const problems = problems0 || [];
      if (drawerBad) problems.push(drawerBad);
      if (probe.crashed) problems.push('界面兜底卡出现');
      if (errors.length) problems.push('控制台报错 ' + errors.length + ' 条');
      if (buf.length < 9000) problems.push('截图疑似空白（' + buf.length + ' B）');
      if (probe.painted === 0 && !probe.empty) problems.push('画布没有任何亮点');
      if (c.import && !t.imported) problems.push('拖放导入后队列仍是空的');
      if (probe.overflowX) problems.push('横向溢出');
      if (probe.theme !== c.theme) problems.push('主题没切过去（实际 ' + probe.theme + '）');
      if (problems.length) bad++;
      console.log(`${problems.length ? 'FAIL' : 'ok  '} ${c.view}/${c.theme}/${c.w}${c.import ? '（导入回归）' : ''}${c.frame ? '（取景投影）' : ''}  控件 ${probe.controls} 画布 ${probe.canvas} 亮像素 ${probe.painted}${probe.empty ? '（空状态）' : ''}  ${problems.join('；')}`);
      errors.slice(0, 2).forEach(m => console.log('       ! ' + m));
    } catch (err) {
      bad++;
      console.log(`FAIL ${c.view}/${c.theme}/${c.w}  探测异常：${String(err.message).slice(0, 140)}`);
    }
  }
  win.destroy();
  console.log(`\n界面回归：${cases.length} 组，失败 ${bad} 组，截图在 ${OUT}`);
  app.exit(bad ? 1 : 0);
});
