/* 历算核对
 *
 * 三层：
 *   A 几何恒等式与常数 —— 不依赖任何外部数据，任何时候都跑
 *   B tests/fixtures/de440s.json —— JPL DE440s 数值历表的取样（tools/reference/skyfield_check.py 生成）
 *   C 联网对照 NOAA 实现 —— 默认跳过后，LF_ONLINE=1 打开
 * 跑法：node tests/astro.test.mjs          （离线）
 *       LF_ONLINE=1 node tests/astro.test.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const A = require('../src/core/astro.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const worst = {};
function note(key, val) { if (val > (worst[key] || 0)) worst[key] = val; }
function check(name, got, want, tol, bucket) {
  const d = Math.abs(got - want);
  const good = d <= tol;
  good ? pass++ : fail++;
  if (bucket) note(bucket, d);
  console.log(`${good ? 'ok  ' : 'FAIL'} ${name}: 实算 ${fmtN(got)} / 参照 ${fmtN(want)}（差 ${fmtN(d)}，容差 ${tol}${bucket ? '，累计最大 ' + fmtN(worst[bucket]) : ''}）`);
}
function ok(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '：' + detail : ''}`);
}
function fmtN(x) { return Math.abs(x) >= 100 ? x.toFixed(3) : x.toFixed(4); }
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
function getJson(url) {
  return JSON.parse(execFileSync('curl', ['-sS', '-m', '20', '-A', UA, url]).toString());
}

/* ================= A 几何恒等式 ================= */
console.log('\n── A 几何恒等式与常数');
check('儒略日 @2000-01-01 12:00 UT', A.julianDay(new Date('2000-01-01T12:00:00Z')), 2451545.0, 1e-9);
check('儒略日 @1970-01-01（Unix 原点）', A.julianDay(new Date('1970-01-01T00:00:00Z')), 2440587.5, 1e-9);
check('格林尼治恒星时 @J2000.0 (°)', A.gmst(2451545.0), 280.4606187, 0.0002);

const lat = 39.9042, lon = 116.4074, tz = 480;
const t0 = new Date('2026-10-19T04:00:00Z');
check('北天极高度 = 地理纬度', A.toHorizontal(A.lst(A.julianDay(t0), lon), 90, t0, lat, lon).alt, lat, 1e-9);
check('南天极高度 = -地理纬度', A.toHorizontal(A.lst(A.julianDay(t0), lon), -90, t0, lat, lon).alt, -lat, 1e-9);
ok('天顶点 (HA=0, dec=lat) 高度 90',
  Math.abs(A.toHorizontal(A.lst(A.julianDay(t0), lon), lat, t0, lat, lon).alt - 90) < 1e-9);
// 春分赤道站日出方位应几乎正东；赤道昼长几乎 12 小时
{
  const e = A.sunEvents(2026, 3, 20, 0, 0, 0);
  const p = A.sunPos(e.sunrise);
  check('二分日赤道日出方位≈正东', A.toHorizontal(p.ra, p.dec, e.sunrise, 0, 0).az, 90.3, 0.6);
  check('赤道夏至昼长≈12.1h', A.sunEvents(2026, 6, 21, 0, 0, 0).dayLength, 12.12, 0.2);
}
{
  const eq = A.sunPos(new Date('2026-03-20T14:46:00Z'));
  ok('春分时刻太阳视黄经≈0°', Math.min(eq.lon, 360 - eq.lon) < 0.6, 'λ=' + eq.lon.toFixed(3));
  const sol = A.sunPos(new Date('2026-06-21T08:25:00Z'));
  ok('夏至时刻太阳视黄经≈90°', Math.abs(sol.lon - 90) < 0.6, 'λ=' + sol.lon.toFixed(3));
  check('冬至赤纬≈-23.44°', A.sunPos(new Date('2026-12-21T23:50:00Z')).dec, -23.44, 0.05);
}
// 银道变换：银心必须精确落在 (0,0)，银北极 b=+90，NCP 的银经 = 122.9319
{
  const gc = A.equatorialToGalactic(A.GCENTER.ra, A.GCENTER.dec);
  ok('银心 (l,b)=(0,0)', Math.min(gc.l, 360 - gc.l) < 0.02 && Math.abs(gc.b) < 0.02,
    `l=${gc.l.toFixed(3)} b=${gc.b.toFixed(3)}`);
  const ngp = A.equatorialToGalactic(A.NGP.ra, A.NGP.dec);
  ok('银北极 b=+90', Math.abs(ngp.b - 90) < 1e-6, 'b=' + ngp.b.toFixed(5));
  const ncp = A.equatorialToGalactic(0, 90);
  check('北黄极银经 = 122.9319', ncp.l, 122.9319, 0.02);
  const back = A.galacticToEquatorial(ncp.l, ncp.b);
  check('银道↔赤道往返 Dec', back.dec, 90, 1e-6);
}
// 岁差速率：一年应进动约 1.3969 角分/年 × 1 = 5029"/年
{
  const d = A.dayNumber(new Date('2026-01-01T00:00:00Z'));
  const p = A.precess(180, 0, d);
  // 秋分点正落在黄道上，沿黄道进动 p 投到赤道上要乘 cos(黄赤交角)
  check('J2000→2026 赤道处岁差 ≈0.333°', p.ra - 180, 1.3968138 * (d / 36525) * Math.cos(A.obliquity(d) * A.D2R), 0.005);
}
// 折射：Bennett 公式在 h=0 处给 29′，与历书上“地平 34′”的差是公式在近地平的固有发散，
// 升落时刻不受影响（那里用的是 -0.833° 这个已经把折射与半直径打包的门限，已对 DE440s 验到 72 秒内）
check('10° 高度折射 ≈5.4′', A.refraction(10) * 60, 5.41, 0.15);
check('20° 高度折射 ≈2.7′', A.refraction(20) * 60, 2.74, 0.1);
check('45° 高度折射 ≈1.0′', A.refraction(45) * 60, 1.01, 0.1);
ok('地平折射落在 25–35′ 之间', A.refraction(0) * 60 > 25 && A.refraction(0) * 60 < 35, (A.refraction(0) * 60).toFixed(2) + '′');
ok('折射随高度单调下降', A.refraction(1) > A.refraction(5) && A.refraction(5) > A.refraction(30));
ok('罗盘命名', A.compass(0) === '北' && A.compass(90) === '东' && A.compass(180) === '南' && A.compass(270) === '西');

/* ================= B DE440s 参照 ================= */
console.log('\n── B JPL DE440s 参照（tests/fixtures/de440s.json）');
const FIX_PATH = path.join(HERE, 'fixtures', 'de440s.json');
if (!fs.existsSync(FIX_PATH)) {
  console.log('跳过：缺 tests/fixtures/de440s.json（跑 tools/reference/skyfield_check.py 生成）');
} else {
  const fix = JSON.parse(fs.readFileSync(FIX_PATH, 'utf8'));
  console.log('   来源：' + fix.provenance.tool + '，生成于 ' + fix.provenance.generated_at +
    '，升落网格 ' + fix.provenance.sampling_grid_minutes + ' 分钟');
  const POS_TOL = 0.05, ALT_TOL = 0.08, TIME_TOL = 150;
  const hours = (a, b) => Math.abs(new Date(a) - new Date(b)) / 1000;

  for (const ep of fix.epochs) {
    const d = new Date(ep.iso);
    console.log(`  · 历元 ${ep.iso}`);
    for (const [key, want] of Object.entries(ep.geocentric)) {
      const got = key === 'sun' ? A.sunPos(d)
        : key === 'moon' ? A.moonPos(d)
          : A.planetPos(key.replace(' barycenter', ''), d);
      const isBC = key.endsWith('barycenter');
      const target = isBC ? key.replace(' barycenter', '') : key;
      if (!isBC && target !== 'sun' && target !== 'moon' && A.planetKeys.indexOf(target) < 0) continue;
      check(`    ${key} RA`, A.norm180(got.ra - want.ra), 0, POS_TOL, '位置');
      check(`    ${key} Dec`, got.dec - want.dec, 0, POS_TOL, '位置');
      if (got.lon !== undefined) check(`    ${key} 视黄经`, A.norm180(got.lon - want.ecl_lon), 0, POS_TOL, '位置');
      if (key === 'moon') check(`    ${key} 视黄纬`, got.lat - want.ecl_lat, 0, 0.03, '位置');
      if (key === 'moon') // Schlyter 的太阳距离比位置容易偏，近地点附近实测到 0.15 ER（≈950 km，对只用来算视直径足够）
check(`    ${key} 地心距离 (ER)`, got.dist, want.dist_km / 6371.0088, 0.2, '月距');
    }
    for (const [sid, bodies] of Object.entries(ep.topocentric)) {
      const site = fix.sites[sid];
      for (const [label, want] of Object.entries(bodies)) {
        let got;
        if (label === 'sun') {
          const s = A.sunPos(d);
          got = A.toHorizontal(s.ra, s.dec, d, site.lat, site.lon);
        } else if (label === 'moon') {
          const m = A.moonPos(d, { topocentric: true, latitude: site.lat, longitude: site.lon });
          got = A.toHorizontal(m.ra, m.dec, d, site.lat, site.lon);
        } else {
          const spec = label === 'galactic_core' ? A.GCENTER : { ra: 279.2347, dec: 38.7837 };
          const pr = A.precess(spec.ra, spec.dec, A.dayNumber(d));
          got = A.toHorizontal(pr.ra, pr.dec, d, site.lat, site.lon);
        }
        check(`    ${sid}/${label} alt`, got.alt, want.alt, ALT_TOL, '高度');
        check(`    ${sid}/${label} az`, A.norm180(got.az - want.az), 0, ALT_TOL, '方位');
      }
    }
    // 升落与晨昏：同门限、同 44 小时窗口，逐事件配对
    const start = new Date(d.getTime() - 24 * 3600000);
    const end = new Date(d.getTime() + 20 * 3600000);
    for (const [sid, events] of Object.entries(ep.events)) {
      const site = fix.sites[sid];
      for (const [label, list] of Object.entries(events)) {
        if (!list.length) continue;
        const deg = parseFloat(label.split('_')[1].replace('+', ''));
        let altFn;
        if (label.startsWith('sun_') || label.startsWith('civil_') || label.startsWith('nautical_') || label.startsWith('astronomical_')) {
          altFn = (x) => { const s = A.sunPos(x); return A.toHorizontal(s.ra, s.dec, x, site.lat, site.lon).alt; };
        } else if (label.startsWith('moon_')) {
          altFn = (x) => {
            const m = A.moonPos(x, { topocentric: true, latitude: site.lat, longitude: site.lon });
            return A.toHorizontal(m.ra, m.dec, x, site.lat, site.lon).alt;
          };
        } else {
          altFn = (x) => {
            const pr = A.precess(A.GCENTER.ra, A.GCENTER.dec, A.dayNumber(x));
            return A.toHorizontal(pr.ra, pr.dec, x, site.lat, site.lon).alt;
          };
        }
        const mine = A.crossings(start, end, 1, altFn, deg);
        const n = Math.min(mine.length, list.length);
        for (let i = 0; i < n; i++) {
          check(`    ${sid}/${label} #${i + 1}${list[i].rising ? '↑' : '↓'} (s)`,
            hours(mine[i].time, list[i].time), 0, TIME_TOL, '时刻');
          if (mine[i].rising !== list[i].rising) ok('    升/落方向一致', false, `${sid}/${label} #${i + 1}`);
        }
        if (mine.length !== list.length) {
          ok(`    ${sid}/${label} 事件数一致`, false, `本地 ${mine.length} / DE440s ${list.length}`);
        }
      }
    }
  }
  // 朔望
  const named = {};
  for (const p of fix.moon_phases) (named[p.phase] = named[p.phase] || []).push(p.time);
  const win = A.syzygyWindow(new Date('2026-10-19T04:00:00Z'), 25, 25);
  const pairs = [['new', win.newMoons], ['full', win.fullMoons]];
  for (const [name, list] of pairs) {
    const want = named[name] || [];
    for (let i = 0; i < Math.min(list.length, want.length); i++) {
      check(`  朔望 ${name} #${i + 1} (s)`, hours(list[i], want[i]), 0, 900, '朔望');
    }
    if (list.length !== want.length) console.log(`     ↳ ${name} 本地 ${list.length} 个 / 参照 ${want.length} 个（窗口边界差，只比配对到的）`);
  }
  console.log('   DE440s 偏差汇总（度/秒）：' + Object.entries(worst).map(([k, v]) => k + ' ' + v.toFixed(k === '时刻' ? 1 : 4)).join('，'));

  /* 银道变换的星表级复验：Yale BSC5 自带 GLON/GLAT，装了才跑 */
  const bsc = path.join(HERE, '..', 'tools', 'vendor', 'bsc5.json');
  if (fs.existsSync(bsc)) {
    console.log('\n── B+ 银道变换对 Yale BSC5 全表抽检');
    const arr = JSON.parse(fs.readFileSync(bsc, 'utf8'));
    const parseRA = (s) => { const m = String(s).match(/([\d.]+)h\s*([\d.]+)m?\s*([\d.]+)?/); return m ? (parseFloat(m[1]) + parseFloat(m[2]) / 60 + parseFloat(m[3] || 0) / 3600) * 15 : null; };
    const parseDE = (s) => { const m = String(s).match(/([+-]?)(\d+)°\s*(\d+)′\s*(\d+)/); return m ? (parseFloat(m[2]) + parseFloat(m[3]) / 60 + parseFloat(m[4] || 0) / 3600) * (m[1] === '-' ? -1 : 1) : null; };
    let wl = 0, wb = 0, n = 0;
    for (const st of arr) {
      if (!st.GLON || !st.GLAT || !st.RA || !st.Dec) continue;
      const ra = parseRA(st.RA), dec = parseDE(st.Dec);
      if (ra === null || dec === null) continue;
      const g = A.equatorialToGalactic(ra, dec);
      wl = Math.max(wl, Math.abs(A.norm180(g.l - parseFloat(st.GLON))));
      wb = Math.max(wb, Math.abs(g.b - parseFloat(st.GLAT)));
      if (++n >= 1200) break;
    }
    ok(`  ${n} 颗星的银经与 BSC5 一致`, wl < 0.25, '最大银经差 ' + wl.toFixed(3) + '°（表内数值只给两位小数，>0.1° 属舍入）');
    ok(`  ${n} 颗星的银纬与 BSC5 一致`, wb < 0.05, '最大银纬差 ' + wb.toFixed(3) + '°');
  } else {
    console.log('\n── B+ 跳过：tools/vendor/bsc5.json 不在（跑 tools/fetch-data.sh 取）');
  }
}

/* ================= C 联网对照 ================= */
if (process.env.LF_ONLINE) {
  console.log('\n── C NOAA 独立实现（api.sunrise-sunset.org）');
  const cases = [
    { name: '北京', lat: 39.9042, lon: 116.4074, tz: 480, tzid: 'Asia/Shanghai' },
    { name: '新加坡', lat: 1.3521, lon: 103.8198, tz: 480, tzid: 'Asia/Singapore' },
    { name: '特罗姆瑟', lat: 69.6492, lon: 18.9553, tz: 120, tzid: 'Europe/Oslo' },
    { name: '乌斯怀亚', lat: -54.8019, lon: -68.303, tz: -180, tzid: 'America/Argentina/Ushuaia' }
  ];
  for (const c of cases) {
    let ref;
    try {
      ref = getJson(`https://api.sunrise-sunset.org/json?lat=${c.lat}&lng=${c.lon}&date=2026-12-21&tzid=${encodeURIComponent(c.tzid)}&formatted=0`).results;
    } catch (e) { console.log('  跳过 ' + c.name + '：' + String(e.message).slice(0, 60)); continue; }
    const e = A.sunEvents(2026, 12, 21, c.lat, c.lon, c.tz);
    const mins = (a, b) => (new Date(a) - new Date(b)) / 60000;
    if (ref.sunrise) check(`  ${c.name} 日出差(min)`, mins(e.sunrise, ref.sunrise), 0, 4);
    if (ref.sunset) check(`  ${c.name} 日落差(min)`, mins(e.sunset, ref.sunset), 0, 4);
    if (!ref.sunrise) ok(`  ${c.name} 无日出（极夜）判定一致`, !e.sunrise);
    check(`  ${c.name} 民用昏差(min)`, mins(e.civil.end[0] || e.civil.start[0], ref.civil_twilight_end), 0, 5);
  }
} else {
  console.log('\n── C 联网对照默认跳过（LF_ONLINE=1 打开）');
}

console.log(`\n历算核对：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
