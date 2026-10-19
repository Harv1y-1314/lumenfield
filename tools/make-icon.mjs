/* make-icon.mjs —— 从 assets/icons/chastar.svg 生成 PNG 图标。
 *
 * 跑法：electron tools/make-icon.mjs
 *
 * 为什么用 Electron 而不是 imagemagick / rsvg：SVG 只留一个真源，栅格化交给 Chromium，
 * 本机不必再装转换器。SVG 走 base64 data URI 进 canvas——直接给 file:// 路径会把画布标脏，
 * toDataURL 会抛 SecurityError。
 *
 * 两套产物各有理由：
 *   chastar-512.png        带圆角、透明背景，用于仓内展示与社交卡片
 *   apple-touch-icon.png 满幅不圆角，交给 iOS 自己裁连续曲率；
 *                        若预先圆角，iOS 会在四角补一层底色，反而露出白边
 */
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(fileURLToPath(import.meta.url), '../..');
const SVG = readFileSync(join(HERE, 'assets/icons/chastar.svg'), 'utf8');
const FULL = SVG.replace('<rect width="512" height="512" rx="116"/>', '<rect width="512" height="512" rx="0"/>');

const jobs = [
  { out: 'assets/icons/chastar-512.png', src: SVG, size: 512 },
  { out: 'assets/icons/chastar-180.png', src: SVG, size: 180 },
  { out: 'assets/icons/apple-touch-icon.png', src: FULL, size: 180 },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
app.disableHardwareAcceleration();

const RENDER = (dataUri, size) => `new Promise(function (resolve, reject) {
  var img = new Image();
  img.onerror = function () { reject(new Error('SVG 没解码')); };
  img.onload = function () {
    var cv = document.createElement('canvas');
    cv.width = ${size}; cv.height = ${size};
    var g = cv.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, ${size}, ${size});
    resolve(cv.toDataURL('image/png'));
  };
  img.src = ${JSON.stringify(dataUri)};
})`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 600, height: 400, show: false });
  await win.loadURL('about:blank');
  await sleep(200);
  for (const j of jobs) {
    const uri = 'data:image/svg+xml;base64,' + Buffer.from(j.src, 'utf8').toString('base64');
    const dataUrl = await win.webContents.executeJavaScript(RENDER(uri, j.size));
    writeFileSync(join(HERE, j.out), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('生成', j.out, j.size + '×' + j.size);
  }
  win.destroy();
  app.exit(0);
});
