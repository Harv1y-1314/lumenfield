/* 影像算子核对：全部用合成图，不依赖浏览器与真实片子，跑法 node tests/imaging.test.mjs
 *
 * 关心的不是"有没有报错"，而是每条算子的物理含义对不对：
 *   · 未调参数必须严格等于原图（不然"重置"按钮是假的）
 *   · 磨皮必须只在平涂区抹掉噪点、在硬边上保住梯度（不然"质感保留"是假的）
 *   · 去雾必须在人造雾上量化地接近无雾原图（不然那颗滑杆是安慰剂）
 *   · 烘出来的 .cube 必须和预览链路同解（不然导出的 LUT 会变色）
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const F = require('../src/core/imaging.js');

let pass = 0, fail = 0;
function check(name, got, want, tol, unit) {
  const d = Math.abs(got - want), good = d <= tol;
  good ? pass++ : fail++;
  console.log(`${good ? 'ok  ' : 'FAIL'} ${name}: ${got.toFixed(4)}${unit || ''} / 期望 ${want.toFixed(4)}（差 ${d.toFixed(4)}，容差 ${tol}）`);
}
function ok(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '：' + detail : ''}`);
}
function mk(w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = fn(x, y), p = (y * w + x) * 4;
    d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
  }
  return { data: d, width: w, height: h };
}
function px(img, x, y) { const p = (y * img.width + x) * 4; return [img.data[p], img.data[p + 1], img.data[p + 2]]; }
function setPx(img, x, y, c) { const p = (y * img.width + x) * 4; img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; }
function clone(img) { return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height }; }
function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function maxDiff(a, b) {
  let m = 0;
  for (let i = 0; i < a.data.length; i += 4) m = Math.max(m, Math.abs(a.data[i] - b.data[i]),
    Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
  return m;
}
function rmse(a, b) {
  let s = 0, n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) { const d = a.data[i + c] - b.data[i + c]; s += d * d; }
    n += 3;
  }
  return Math.sqrt(s / n);
}
function std(img, x0, x1, y0, y1) {
  const v = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) v.push(F.luminance(...px(img, x, y)));
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
}

/* ---------- 1 空参数必须恒等 ---------- */
console.log('── 恒等与量化');
const grad = mk(64, 64, (x, y) => [x * 4, y * 4, (x + y) * 2]);
const lut = F.toneLUT({});
let worst = 0;
for (let i = 0; i < 256; i++) worst = Math.max(worst, Math.abs(lut[i] - i));
ok('toneLUT 空参数逐点等于恒等（暗部除外，那里有 8 位量化台阶）', worst <= 2, '最大偏差 ' + worst);
const out0 = F.renderPipeline(grad, {});
check('renderPipeline 空参数与原图最大差 (0-255)', maxDiff(out0, grad), 0, 2);
ok('stats 带耗时与分段', !!out0.stats && out0.stats.stages.length >= 8,
  out0.stats.ms + 'ms / ' + out0.stats.stages.map(s => s.stage + ' ' + s.ms).join(' '));

/* ---------- 2 曝光与影调 ---------- */
console.log('\n── 曝光 · 影调 · 曲线');
const flat = mk(32, 32, () => [118, 118, 118]);
const lit = F.renderPipeline(flat, { exposure: 1 });
const lin0 = F.toLinear(118), lin1 = F.toLinear(lit.data[0]);
check('曝光 +1EV 线性亮度倍增', lin1 / lin0, 2, 0.12, '×');
const dark = F.renderPipeline(flat, { exposure: -1 });
check('曝光 -1EV 线性亮度减半', F.toLinear(dark.data[0]) / lin0, 0.5, 0.08, '×');
const lifted = F.renderPipeline(flat, { shadows: 60 });
ok('阴影提升抬亮暗部', lifted.data[0] > flat.data[0], flat.data[0] + ' → ' + lifted.data[0]);
const crushed = F.renderPipeline(flat, { contrast: 60 });
ok('对比度把中灰推出（此处为抬）', Math.abs(crushed.data[0] - 118) > 1, '118 → ' + crushed.data[0]);
const curve = F.piecewiseLUT([{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }]);
let mono = true;
for (let i = 1; i < 256; i++) if (curve[i] < curve[i - 1]) mono = false;
ok('曲线 LUT 单调不减', mono);
check('曲线在锚点 0.5 处生效', curve[128], 0.7 * 255, 4);

/* ---------- 3 肤色掩膜 ---------- */
console.log('\n── 掩膜');
const face = mk(120, 120, (x, y) => {
  const inE = ((x - 60) / 34) ** 2 + ((y - 60) / 44) ** 2 < 1;
  return inE ? [208, 166, 138] : [40, 96, 60];
});
const sm = F.skinMask(face, {});
let inM = 0, inN = 0, outM = 0, outN = 0;
for (let y = 0; y < 120; y++) for (let x = 0; x < 120; x++) {
  const v = sm[y * 120 + x];
  const inE = ((x - 60) / 34) ** 2 + ((y - 60) / 44) ** 2 < 0.6;
  if (inE) { inM += v; inN++; } else if (((x - 60) / 34) ** 2 + ((y - 60) / 44) ** 2 > 1.6) { outM += v; outN++; }
}
check('肤色掩膜·椭圆内均值', inM / inN, 1, 0.22);
check('肤色掩膜·椭圆外均值', outM / outN, 0, 0.06);
const sky = mk(100, 100, (x, y) => y < 45 ? [126, 172, 226] : [72, 66, 52]);
const skyM = F.skyMask(sky);
let top = 0, bot = 0;
for (let x = 0; x < 100; x++) { top += skyM[6 * 100 + x]; bot += skyM[90 * 100 + x]; }
check('天空掩膜·上部均值（启发式初值，靠画笔补齐）', top / 100, 0.72, 0.2);
check('天空掩膜·地面均值', bot / 100, 0, 0.16);
const hiM = F.luminanceMask(mk(40, 40, (x) => x < 20 ? [250, 250, 250] : [30, 30, 30]), 'high', 0.7, 0.2);
check('高光掩膜·亮区', hiM[5 * 40 + 5], 1, 0.1);
check('高光掩膜·暗区', hiM[5 * 40 + 35], 0, 0.1);

/* ---------- 4 磨皮：抹平噪点但保住硬边 ---------- */
console.log('\n── 高低频磨皮');
const rnd = lcg(7);
const noisy = mk(120, 120, (x, y) => {
  const base = x < 60 ? 208 : 150;      // 一道竖直通撞边
  const n = (rnd() - 0.5) * 26;
  return [base + n, base * 0.8 + n, base * 0.66 + n];
});
const maskAll = new Float32Array(120 * 120).fill(1);
const smoothed = clone(noisy);
F.freqSeparationSmooth(smoothed, maskAll, 0.85, 0.4);
const sBefore = std(noisy, 8, 50, 30, 90), sAfter = std(smoothed, 8, 50, 30, 90);
check('平涂区噪声标准差下降率', sAfter / sBefore, 0.34, 0.18, '×');
function edgeGradient(img) {
  let m = 0;
  for (let y = 30; y < 90; y++) m = Math.max(m, Math.abs(F.luminance(...px(img, 59, y)) - F.luminance(...px(img, 61, y))));
  return m;
}
const gBefore = edgeGradient(noisy), gAfter = edgeGradient(smoothed);
check('硬边梯度保留率', gAfter / gBefore, 0.92, 0.12, '×');
ok('硬边两侧亮度关系没反转', F.luminance(...px(smoothed, 40, 60)) > F.luminance(...px(smoothed, 80, 60)));

/* ---------- 5 去雾：人造雾上的量化恢复 ---------- */
console.log('\n── 去雾（暗通道先验）');
const clear = mk(96, 96, (x, y) => [
  30 + 120 * (x / 96), 40 + 90 * (y / 96), 60 + 150 * ((x * y) % 7) / 7]);
const A = [0.82, 0.86, 0.92], t = 0.42;
const hazy = mk(96, 96, (x, y) => {
  const c = px(clear, x, y);
  return [0, 1, 2].map(k => Math.round((c[k] / 255 * t + A[k] * (1 - t)) * 255));
});
const unhazy = clone(hazy);
F.dehaze(unhazy, 1);
const before = rmse(hazy, clear), after = rmse(unhazy, clear);
check('去雾后与无雾原图的 RMSE 比值', after / before, 0.6, 0.25, '×');
ok('去雾把亮度拉开了', std(unhazy, 6, 90, 6, 90) > std(hazy, 6, 90, 6, 90),
  std(hazy, 6, 90, 6, 90).toFixed(1) + ' → ' + std(unhazy, 6, 90, 6, 90).toFixed(1));
const neutral = clone(clear);
F.dehaze(neutral, 0);
check('去雾 0 必须完全不动图', maxDiff(neutral, clear), 0, 0);

/* ---------- 6 几何 ---------- */
console.log('\n── 几何 · 水平检测 · 局部控制点');
const id = clone(grad);
F.transform(grad, id, { rotate: 0, zoom: 1 });
check('旋转 0 度等于原图', maxDiff(id, grad), 0, 2);
const rot = { data: new Uint8ClampedArray(64 * 64 * 4), width: 64, height: 64 };
F.transform(grad, rot, { rotate: 90, zoom: 1 });
const back = { data: new Uint8ClampedArray(64 * 64 * 4), width: 64, height: 64 };
const mid = mk(64, 64, (x, y) => [x * 3, y * 3, (x + y) * 2]);
const r1b = { data: new Uint8ClampedArray(64 * 64 * 4), width: 64, height: 64 };
F.transform(mid, r1b, { rotate: 90, zoom: 1 });
F.transform(r1b, back, { rotate: -90, zoom: 1 });
let centerDiff = 0;
for (let y = 16; y < 48; y++) for (let x = 16; x < 48; x++) centerDiff = Math.max(centerDiff, Math.abs(F.luminance(...px(mid, x, y)) - F.luminance(...px(back, x, y))));
ok('正反转 90° 回到原图（中心区，重采样误差内）', centerDiff < 8, '最大差 ' + centerDiff + ' 亮度');
// 一条倾斜 7° 的强边界
const TILT = 7;
const tilted = mk(96, 96, (x, y) => {
  const line = y - 48 - Math.tan(TILT * Math.PI / 180) * (x - 48);
  return line > 0 ? [232, 228, 220] : [42, 40, 44];
});
const est = F.estimateHorizon(tilted);
ok('自动水平检出的绝对角接近 7°', Math.abs(Math.abs(est.angle) - TILT) < 1.5,
  `检出 ${est.angle.toFixed(2)}° 强度 ${est.strength.toFixed(3)}`);
const straight = mk(96, 96, (x, y) => y > 50 ? [230, 230, 230] : [40, 40, 40]);
const est2 = F.estimateHorizon(straight);
ok('水平线场景检出≈0', Math.abs(est2.angle) < 1.2, est2.angle.toFixed(2) + '°');
const lp = clone(grad);
F.applyLocal(lp, [{ x: 0.25, y: 0.5, r: 0.2, exposure: 100, feather: 0.4 }]);
const nearPx = F.luminance(...px(lp, 16, 32)), origNear = F.luminance(...px(grad, 16, 32));
const farPx = F.luminance(...px(lp, 52, 32)), origFar = F.luminance(...px(grad, 52, 32));
ok('控制点只亮自己的圈子', nearPx > origNear + 8 && Math.abs(farPx - origFar) <= 3,
  `圈内 ${origNear.toFixed(0)}→${nearPx.toFixed(0)}，圈外 ${origFar.toFixed(0)}→${farPx.toFixed(0)}`);
const wp = { data: new Uint8ClampedArray(64 * 64 * 4), width: 64, height: 64 };
F.warpPoint(grad, wp, 32, 32, 14, 0.6);
ok('轮廓微调中心像素不动', wp.data[(32 * 64 + 32) * 4] === grad.data[(32 * 64 + 32) * 4],
  wp.data[(32 * 64 + 32) * 4] + ' vs ' + grad.data[(32 * 64 + 32) * 4]);
ok('轮廓微调确实改了半径内的像素', (() => {
  let diff = 0;
  for (let y = 24; y < 41; y++) for (let x = 24; x < 41; x++) diff += Math.abs(wp.data[(y * 64 + x) * 4] - grad.data[(y * 64 + x) * 4]);
  return diff > 100;
})(), '');
// 梯度方向：往中心收（amount<0）时，半径 0.5r 处的像素应当被从更靠外的位置取样
const wpIn = { data: new Uint8ClampedArray(64 * 64 * 4), width: 64, height: 64 };
F.warpPoint(grad, wpIn, 32, 32, 14, -0.6);
const beforeVal = px(grad, 39, 32)[0], afterVal = px(wpIn, 39, 32)[0];
ok('负向微调把外圈像素往里搬（该点亮起来）', afterVal < beforeVal, `39,32：${beforeVal} → ${afterVal}`);
ok('轮廓微调不碰半径外', (() => {
  const a = px(wp, 2, 2), b = px(grad, 2, 2);
  return Math.abs(a[0] - b[0]) <= 1;
})(), '');

/* ---------- 7 颗粒与暗角 ---------- */
console.log('\n── 颗粒 · 暗角');
const g1 = F.applyGrain(clone(flat), 40, 1, 20261019);
const g2 = F.applyGrain(clone(flat), 40, 1, 20261019);
const g3 = F.applyGrain(clone(flat), 40, 1, 99);
ok('同种子两次出图逐字节一致', (() => { for (let i = 0; i < g1.data.length; i++) if (g1.data[i] !== g2.data[i]) return false; return true; })());
ok('换种子图不同', (() => { for (let i = 0; i < g1.data.length; i += 4) if (g1.data[i] !== g3.data[i]) return true; return false; })());
check('颗粒量随强度增长', std(g1, 0, 32, 0, 32), 9.2, 6);
const vig = F.applyVignette(mk(101, 101, () => [200, 200, 200]), -60, 1);
check('暗角中心不暗', F.luminance(...px(vig, 50, 50)), 200, 2);
ok('暗角四角变暗', F.luminance(...px(vig, 4, 4)) < 165, F.luminance(...px(vig, 4, 4)).toFixed(1));

/* ---------- 8 白平衡 ---------- */
console.log('\n── 白平衡');
const warm = mk(64, 64, () => [206, 168, 122]);
const cooled = F.renderPipeline(warm, { temp: -40 });
ok('色温往冷走：蓝升红降', cooled.data[2] > warm.data[2] && cooled.data[0] < warm.data[0],
  `${px(warm, 0, 0).join(',')} → ${px(cooled, 0, 0).join(',')}`);
const grey = mk(64, 64, () => [210, 150, 90]);        // 被整片暖色染过的中性灰场景
const gain = F.grayWorldGain(grey, 1);
const fixed = F.renderPipeline(grey, { wbGain: gain });
const c = px(fixed, 32, 32);
const spread0 = Math.max(...px(grey, 32, 32)) - Math.min(...px(grey, 32, 32));
const spread1 = Math.max(...c) - Math.min(...c);
ok('灰色世界显著压小偏色幅度（强偏色受增益上下限约束，压不满是正常的）', spread1 < spread0 * 0.3,
  `通道极差 ${spread0} → ${spread1}，结果 ${c.join(',')}`);

/* ---------- 9 分色与曲线 ---------- */
console.log('\n── 分色 · 分离色调');
const greens = mk(64, 64, () => [90, 180, 90]);
const desatG = F.applyHSL(clone(greens), { 3: { s: -60 } });      // 绿色饱和度 -60
ok('HSL 只动目标色带（绿降、红不变）',
  px(desatG, 0, 0)[1] < 180 && (() => {
    const red = F.applyHSL(mk(16, 16, () => [200, 40, 40]), { 3: { s: -60 } });
    return Math.abs(red.data[0] - 200) <= 3;
  })(), px(desatG, 0, 0).join(','));
const split = F.applyHSL(clone(mk(64, 64, (x, y) => { const v = Math.round(x * 4); return [v, v, v]; })), null);
F.applySplitTone(split, { hiH: 40, hiS: 60, hiA: 50, loH: 220, loS: 60, loA: 50 });
const hiSide = px(split, 60, 32), loSide = px(split, 3, 32);
ok('分离色调：高光偏暖、阴影偏冷', hiSide[0] > hiSide[2] && loSide[2] > loSide[0],
  `高光 ${hiSide.join(',')} 阴影 ${loSide.join(',')}`);

/* ---------- 10 LUT 导出 ---------- */
console.log('\n── .cube 导出与预览一致性');
const params = { exposure: 0.4, contrast: 18, temp: 12, tint: -4, saturation: 8, vibrance: 12, hsl: { 1: { s: -20 }, 3: { h: 6, s: 10 } }, split: { hiH: 38, hiS: 30, hiA: 24, loH: 210, loS: 24, loA: 18 } };
const cube = F.bakeCube(params, 17);
const lines = cube.split('\n').filter(l => l && l[0] !== '#');
check('LUT 行数 = size³', lines.length - 1, 17 * 17 * 17, 0);
ok('首行是尺寸声明', lines[0].indexOf('LUT_3D_SIZE 17') === 0, lines[0]);
// 抽查：把若干纯色走一遍管线，和表里的值对齐
const tone = F.toneLUT(params), crv = F.identityLUT(), wb = F.wbLUTs(params.temp, params.tint, params.wbGain);
let worstCube = 0;
const body = lines.slice(1);
for (let ri = 0; ri < 17; ri += 4) for (let gi = 0; gi < 17; gi += 4) for (let bi = 0; bi < 17; bi += 4) {
  const [r, g, b] = body[ri * 289 + gi * 17 + bi].split(' ').map(Number);
  const one = { data: new Uint8ClampedArray([Math.round(ri / 16 * 255), Math.round(gi / 16 * 255), Math.round(bi / 16 * 255), 255]), width: 1, height: 1 };
  const out = F.renderPipeline(one, params);
  const got = [out.data[0] / 255, out.data[1] / 255, out.data[2] / 255];
  worstCube = Math.max(worstCube, Math.abs(got[0] - r), Math.abs(got[1] - g), Math.abs(got[2] - b));
  void tone; void crv; void wb;
}
check('LUT 与整条预览链路的最大偏差 (0-1)', worstCube, 0, 0.03);
const idCube = F.bakeCube({}, 9);
const first = idCube.split('\n').filter(l => l && l[0] !== '#').slice(1);
const diag = first[0].split(' ').map(Number);
ok('空配方的 LUT 首元素是 0,0,0', diag.every(v => v === 0), first[0]);
const last = first[first.length - 1].split(' ').map(Number);
ok('空配方的 LUT 末元素是 1,1,1', last.every(v => v === 1), first[first.length - 1]);

/* ---------- 11 读数与配方 ---------- */
console.log('\n── 直方图 · 读数 · 配方');
const hist = F.histogram(mk(20, 20, () => [128, 128, 128]), 256);
check('纯色直方图集中在对应 bin', hist.l[128], 400, 1);
check('其他 bin 为零', hist.l[10] + hist.l[200], 0, 0);
const ro = F.toneReadout(mk(20, 20, (x) => x < 10 ? [255, 255, 255] : [0, 0, 0]));
check('爆掉比例', ro.clipHigh, 0.5, 0.01);
check('死黑比例', ro.clipLow, 0.5, 0.01);
const rec = F.normalizeRecipe({ exposure: 0.5, local: [{ x: .3, y: .4, exposure: 40 }], portrait: { smooth: 55 } });
check('配方补齐默认字段', Object.keys(rec).length, Object.keys(F.DEFAULTS).length + 1, 0);
const rec2 = F.normalizeRecipe(JSON.parse(JSON.stringify(rec)));
ok('配方序列化后再读回哈希不变', F.recipeHash(rec) === F.recipeHash(rec2), F.recipeHash(rec));

/* ---------- 12 性能 ---------- */
console.log('\n── 性能');
const big = mk(640, 480, (x, y) => {
  const inE = ((x - 320) / 170) ** 2 + ((y - 240) / 210) ** 2 < 1;
  const n = (lcg(x * 31 + y * 17)() - 0.5) * 22;
  return inE ? [206 + n, 164 + n, 136 + n] : [86 + n, 122 + n, 168 + n];
});
const t0 = Date.now();
const rendered = F.renderPipeline(big, {
  exposure: 0.3, contrast: 20, shadows: 30, highlights: -20, temp: 10, vibrance: 14,
  clarity: 22, texture: 18, sharpen: 30, dehaze: 24,
  portrait: { smooth: 62, quality: 40, evenTone: 30, dewaxy: 45, spots: [{ type: 'eye', x: 0.44, y: 0.42, r: 0.03, amount: 60 }, { type: 'teeth', x: 0.5, y: 0.58, r: 0.05, amount: 40 }] },
  local: [{ x: 0.7, y: 0.2, r: 0.22, exposure: 55, temp: 20 }],
  split: { hiH: 40, hiS: 26, hiA: 22, loH: 215, loS: 20, loA: 16 },
  vignette: -25, grain: 12, curve: [{ x: 0, y: 0 }, { x: 0.25, y: 0.2 }, { x: 0.75, y: 0.82 }, { x: 1, y: 1 }]
});
const ms = Date.now() - t0;
ok('640×480 全链路一次渲染 < 1.2s（含全部算子）', ms < 1200, ms + 'ms，内部计时 ' + JSON.stringify(rendered.stats.stages));
ok('全开参数没有把图算废', (() => { const r = F.toneReadout(rendered); return r.mean > 20 && r.mean < 235 && r.clipHigh < 0.25; })(),
  JSON.stringify(F.toneReadout(rendered)));
console.log('   分段耗时：', rendered.stats.stages.map(s => `${s.stage} ${s.ms}ms`).join(' · '));

/* ---------- 回归：全面复检抓出的四处算子缺陷（2026-10-19） ---------- */
// 这四条都是"看着出图、其实算错"的那类，界面回归抓不到，必须钉在算子层。

// 1) 盒式模糊的乒乓缓冲：早先第二趟起读写同一块缓冲，冲激响应上下不对称、能量 +1.5%
{
  const n = 65, flat = new Float32Array(n * n).fill(0.5);
  const bf = F.blur(flat, n, n, 4);
  let dev = 0;
  for (let i = 0; i < bf.length; i++) dev = Math.max(dev, Math.abs(bf[i] - 0.5));
  ok('模糊不改变平场（乒乓缓冲没就地读写）', dev < 1e-5, '最大偏离 ' + dev.toExponential(2));

  const imp = new Float32Array(n * n); imp[32 * n + 32] = 1;   // 奇数边长，中心严格对称
  const bi = F.blur(imp, n, n, 4);
  let sum = 0, up = 0, down = 0, left = 0, right = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = bi[y * n + x]; sum += v;
    if (x === 32) { if (y < 32) up += v; else if (y > 32) down += v; }
    if (y === 32) { if (x < 32) left += v; else if (x > 32) right += v; }
  }
  check('冲激响应上下对称差', Math.abs(up - down), 0, 1e-6);
  check('冲激响应左右对称差', Math.abs(left - right), 0, 1e-6);
  check('冲激响应能量守恒（旧实现 +1.5%）', sum, 1, 0.005);
}

// 2) 纹理/锐化必须是"细节滑杆"：平场拉满不许变亮（旧实现把线性 0..1 与 sRGB 8 位
//    直接相减，留下 +73 的常数偏置，128 的平场被拉到 208）
{
  const flat = mk(64, 64, () => [128, 128, 128]);
  const t = F.renderPipeline(flat, { texture: 100 });
  const s = F.renderPipeline(flat, { sharpen: 100 });
  check('纹理拉满不改变平场亮度', F.toneReadout(t).mean, 128, 1.5, '');
  check('锐化拉满不改变平场亮度', F.toneReadout(s).mean, 128, 1.5, '');
  // 但真该有高频的地方必须有反应，否则这条判据退化成"纹理是空滑杆"
  const noisy = mk(64, 64, (x, y) => { const v = (x % 4 < 2) ? 150 : 110; return [v, v, v]; });
  const before = maxDiff(noisy, F.renderPipeline(noisy, { texture: 0 }));
  const after = (() => { const r = F.renderPipeline(noisy, { texture: 100 }); let m = 0;
    for (let i = 0; i < r.data.length; i += 4) m = Math.max(m, Math.abs(r.data[i] - noisy.data[i])); return m; })();
  ok('纹理在真实条纹上有反应（不是被钉死的空滑杆）', after > before, '最大改动 ' + after + ' vs ' + before);
}

// 3) 裁剪与几何：cropRegion 必须交出真实宽高；transform 不许再把裁剪偏移当原图坐标用
{
  const src = mk(400, 300, (x, y) => {
    if (x < 60 && y < 60) return [255, 0, 0];          // 左上地标块
    const g = Math.round(40 + 160 * y / 300); return [g, g, g];
  });
  const crop = { x: 40, y: 30, w: 320, h: 180 };       // 正好 16:9
  const cr = F.cropRegion(src, crop);
  ok('cropRegion 交出的宽高就是缓冲区尺寸', cr.width * cr.height * 4 === cr.data.length,
    cr.width + '×' + cr.height);
  const out = { data: new Uint8ClampedArray(cr.width * cr.height * 4), width: cr.width, height: cr.height };
  F.transform(cr, out, { rotate: 0, zoom: 1, crop: crop });
  const moved = maxDiff(out, (() => {
    const o = { data: new Uint8ClampedArray(cr.width * cr.height * 4), width: cr.width, height: cr.height };
    F.transform(cr, o, { rotate: 0, zoom: 1 });        // 不传 crop：同一块缓冲的正确答案
    return o;
  })());
  ok('带 crop 的 transform 不再把画面整体平移', moved === 0, '最大差 ' + moved);
  ok('裁剪后左上地标仍在原位', px(out, 8, 8)[0] > 200, JSON.stringify(px(out, 8, 8)));

  // 整条管线跑一遍：4:3 取 3:2 时旧实现会算出底部 168 行纯黑
  const big = mk(400, 300, (x, y) => { const v = 60 + Math.round(150 * (x + y) / 700); return [v, v, v]; });
  const r = F.renderPipeline(big, { geometry: { rotate: 0, zoom: 1, crop: { x: 0, y: 0, w: 400, h: 267 } } });
  let blackRows = 0;
  for (let y = 0; y < r.height; y++) {
    let allBlack = true;
    for (let x = 0; x < r.width; x++) {
      const p = (y * r.width + x) * 4;
      if (r.data[p] + r.data[p + 1] + r.data[p + 2] > 12) { allBlack = false; break; }
    }
    if (allBlack) blackRows++;
  }
  ok('裁剪后输出没有整行纯黑（旧实现 4000×3000 取 3:2 差出 168 行）', blackRows === 0,
    r.width + '×' + r.height + '，纯黑行 ' + blackRows);
}

// 4) 轮廓收/扩：必须先快照再写。就地读写会让点击处一侧读到已改写的像素、变形被二次叠加
{
  const mk2 = () => mk(64, 64, (x, y) => { const v = 90 + Math.round(9 * Math.abs(x - 32)); return [v, v, v]; });
  const img = mk2();
  // 打点列在配方里叫 spots（不是 warps）：写错键名会静默不算，diff 看着像"只差一点"
  const viaPipeline = F.applyPortrait(mk2(), { spots: [{ x: 0.5, y: 0.5, r: 0.5, type: 'warp', amount: -60 }] });
  const ref = { data: new Uint8ClampedArray(64 * 64 * 4), width: 64, height: 64 };
  F.warpPoint(img, ref, 32, 32, 0.5 * 64, -0.6);      // 与 applyPortrait 同一套半径口径
  ok('打点轮廓与"先快照再写"的参考结果一致', maxDiff(viaPipeline, ref) === 0,
    '最大差 ' + maxDiff(viaPipeline, ref));

  // 源图关于 x=32 严格对称，中心打点后仍必须对称；就地读写会让一侧先被改过
  let asym = 0;
  for (let y = 0; y < 64; y++) for (let k = 1; k <= 31; k++) {
    const l = (y * 64 + (32 - k)) * 4, r = (y * 64 + (32 + k)) * 4;
    asym = Math.max(asym, Math.abs(viaPipeline.data[l] - viaPipeline.data[r]));
  }
  ok('对称源图中心打点后仍左右对称（旧实现一侧被叠加）', asym === 0, '最大不对称 ' + asym);
}

console.log(`\n影像算子核对：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
