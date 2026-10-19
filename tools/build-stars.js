#!/usr/bin/env node
/* build-stars.js —— 把 Yale BSC5 压成前端可直接内联的星表
 *
 * 输入
 *   tools/vendor/bsc5.json         耶鲁亮星表第 5 版 JSON（MIT，见同目录许可）
 *   tools/vendor/starNames-IAU.txt IAU 命名工作组的专名对照（同仓 MIT）
 *   src/data/asterisms.js          手写星群连线
 * 输出
 *   src/data/stars.js              无模块语法，file:// 打开也能读
 *
 * 字段打包成 6 元一组的定长数组，省掉每星一个对象的体积：
 *   [raDeg, decDeg, mag, bv×100, labelIdx, HR]
 * labelIdx 指向 labels[]（IAU 专名），-1 表示没有专名，界面上退回拜耳记法。
 *
 * 两处硬校验，防止“界面骗人”：
 *   1. IAU 专名按拜耳键回查星表，匹配数与匹配率会打印出来，键式改动会当场掉数；
 *   2. asterisms.js 的每个端点都必须落到具体恒星，并把解析出的星名逐条打印，肉眼过一遍。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAG_LIMIT = Number(process.env.MAG_LIMIT || 5.6);

/* 88 星座：拉丁属格 → 三字母缩写。取自 IAU 官方星座表
 * （https://en.wikipedia.org/wiki/IAU_designated_constellations，2026-10-19 核对全文）。
 * 双词属格（Canum Venaticorum 一类）单独成行，不做首字母推断。 */
const GENITIVE = `And|Andromedae
Ant|Antliae
Aps|Apodis
Aqr|Aquarii
Aql|Aquilae
Ara|Arae
Ari|Arietis
Aur|Aurigae
Boo|Bootis
Cae|Caeli
Cam|Camelopardalis
Cnc|Cancri
CVn|Canum Venaticorum
CMa|Canis Majoris
CMi|Canis Minoris
Cap|Capricorni
Car|Carinae
Cas|Cassiopeiae
Cen|Centauri
Cep|Cephei
Cet|Ceti
Cha|Chamaeleontis
Cir|Circini
Col|Columbae
Com|Comae Berenices
CrA|Coronae Australis
CrB|Coronae Borealis
Crv|Corvi
Crt|Crateris
Cru|Crucis
Cyg|Cygni
Del|Delphini
Dor|Dorado
Dra|Draconis
Equ|Equulei
Eri|Eridani
For|Fornacis
Gem|Geminorum
Gru|Gruis
Her|Herculis
Hor|Horologii
Hya|Hydrae
Hyi|Hydri
Ind|Indi
Lac|Lacertae
Leo|Leonis
LMi|Leonis Minoris
Lep|Leporis
Lib|Librae
Lup|Lupi
Lyn|Lyncis
Lyr|Lyrae
Men|Mensae
Mic|Microscopii
Mon|Monocerotis
Mus|Muscae
Nor|Normae
Oct|Octantis
Oph|Ophiuchi
Ori|Orionis
Pav|Pavonis
Peg|Pegasi
Per|Persei
Phe|Phoenicis
Pic|Pictoris
Psc|Piscium
PsA|Piscis Austrini
Pup|Puppis
Pyx|Pyxidis
Ret|Reticuli
Sge|Sagittae
Sgr|Sagittarii
Sco|Scorpii
Scl|Sculptoris
Sct|Scuti
Ser|Serpentis
Sex|Sextantis
Tau|Tauri
Tel|Telescopii
Tri|Trianguli
TrA|Trianguli Australis
Tuc|Tucanae
UMa|Ursae Majoris
UMi|Ursae Minoris
Vel|Velorum
Vir|Virginis
Vol|Volantis
Vul|Vulpeculae`
  .split('\n').reduce((m, line) => {
    const i = line.indexOf('|');
    m[line.slice(i + 1).toLowerCase()] = line.slice(0, i);
    return m;
  }, {});

/* 希腊字母 → BSC 用的三字母拜耳缩写 */
const GREEK = {
  'α': 'Alp', 'β': 'Bet', 'γ': 'Gam', 'δ': 'Del', 'ε': 'Eps', 'ζ': 'Zet', 'η': 'Eta',
  'θ': 'The', 'ι': 'Iot', 'κ': 'Kap', 'λ': 'Lam', 'μ': 'Mu', 'ν': 'Nu', 'ξ': 'Xi',
  'ο': 'Omi', 'π': 'Pi', 'ρ': 'Rho', 'σ': 'Sig', 'τ': 'Tau', 'υ': 'Ups', 'φ': 'Phi',
  'χ': 'Chi', 'ψ': 'Psi', 'ω': 'Ome',
  'Alpha': 'Alp', 'Beta': 'Bet', 'Gamma': 'Gam', 'Delta': 'Del', 'Epsilon': 'Eps', 'Zeta': 'Zet',
  'Eta': 'Eta', 'Theta': 'The', 'Iota': 'Iot', 'Kappa': 'Kap', 'Lambda': 'Lam', 'Mu': 'Mu',
  'Nu': 'Nu', 'Xi': 'Xi', 'Omicron': 'Omi', 'Pi': 'Pi', 'Rho': 'Rho', 'Sigma': 'Sig', 'Tau': 'Tau',
  'Upsilon': 'Ups', 'Phi': 'Phi', 'Chi': 'Chi', 'Psi': 'Psi', 'Omega': 'Ome'
};

function parseRA(s) {
  const m = String(s).match(/([\d.]+)h\s*([\d.]+)m?\s*([\d.]+)?/);
  if (!m) return null;
  return (parseFloat(m[1]) + parseFloat(m[2]) / 60 + parseFloat(m[3] || 0) / 3600) * 15;
}
function parseDE(s) {
  const m = String(s).match(/([+-]?)(\d+)°\s*(\d+)′\s*([\d.]+)/);
  if (!m) return null;
  return (parseFloat(m[2]) + parseFloat(m[3]) / 60 + parseFloat(m[4] || 0) / 3600) * (m[1] === '-' ? -1 : 1);
}
const CON_ABBR = new Set(Object.values(GENITIVE));
/* BSC 的 Name 形状不统一："21Alp And"、"88Gam Peg"、"The1Cru"、"57Gam1And"、"33 Psc"。
 * 统一成“拜耳缩写 空格 三字母属格”，剥掉弗氏编号与多星分量数字；
 * 属格必须命中 88 缩写表，否则不当拜耳名处理。 */
function bayerKey(name) {
  if (!name) return '';
  let s = String(name).replace(/\s+/g, ' ').trim().replace(/^[¹²³⁴]+/, '');
  s = s.replace(/^(\d+)([A-Z])/, '$2').replace(/[¹²³⁴]/g, '');   // 只剥紧贴缩写的编号；"33 Psc" 这类纯弗氏名要留着
  const m = s.match(/^([A-Z][a-z]{2})(\d*)\s*([A-Za-z]{2,3})$/);
  if (m && CON_ABBR.has(m[3])) return m[1] + ' ' + m[3];
  const sp = s.match(/^([A-Z][a-z]{2})\s+([A-Za-z]{2,3})$/);
  if (sp && CON_ABBR.has(sp[2])) return sp[1] + ' ' + sp[2];
  return s;
}
/* IAU 行 "Vega,α Lyrae" → BSC 键 "Alp Lyr" */
function iauKey(designation) {
  let d = String(designation).replace(/\s+(A|B)\b/, '').replace(/[¹²³⁴]/g, '').trim();
  const fl = d.match(/^(\d+)\s+(.+)$/);
  if (fl) {
    const con = GENITIVE[fl[2].toLowerCase()];
    return con ? fl[1] + ' ' + con : null;
  }
  const m = d.match(/^([αβγδεζηθικλμνξοπρστυφχψω]|[A-Za-z]+)\s+(.+)$/);
  if (!m) return null;
  const gk = GREEK[m[1]];
  const con = GENITIVE[m[2].toLowerCase()];
  if (!gk || !con) return null;
  return gk + ' ' + con;
}

const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'vendor', 'bsc5.json'), 'utf8'));
const iauRows = fs.readFileSync(path.join(ROOT, 'tools', 'vendor', 'starNames-IAU.txt'), 'utf8')
  .split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const i = l.indexOf(',');
    return i < 0 ? null : { name: l.slice(0, i).trim(), key: iauKey(l.slice(i + 1)) };
  }).filter(r => r && r.key && r.name);

const byKey = new Map();
const labels = [];
const labelIndex = new Map();
const packed = [];
let dropped = 0;

for (const st of raw) {
  const v = parseFloat(st.Vmag);
  if (!(v <= MAG_LIMIT)) continue;
  const ra = parseRA(st.RA), dec = parseDE(st.Dec);
  if (ra === null || dec === null || !isFinite(ra) || !isFinite(dec)) { dropped++; continue; }
  const bv = st['B-V'] !== undefined ? Math.round(parseFloat(st['B-V']) * 100) : 0;
  const key = bayerKey(st.Name);
  let li = -1;
  packed.push(Math.round(ra * 1000) / 1000, Math.round(dec * 1000) / 1000,
    Math.round(v * 100) / 100, bv, li, parseInt(st.HR, 10) || 0);
  if (key && !byKey.has(key)) byKey.set(key, { ra, dec, v, hr: st.HR, idx: packed.length / 6 - 1 });
}

/* 用 IAU 表给已入库的星贴专名 */
let matched = 0, unmatched = [];
for (const row of iauRows) {
  const hit = byKey.get(row.key);
  if (!hit) { unmatched.push(row.key + '(' + row.name + ')'); continue; }
  const base = hit.idx * 6;
  const li = labelIndex.has(row.name) ? labelIndex.get(row.name) : labels.push(row.name) - 1;
  if (!labelIndex.has(row.name)) labelIndex.set(row.name, li);
  packed[base + 4] = li;
  matched++;
}

/* 校验星群连线端点。不执行源文件，只按字面量把 id / cn / 端点键抓出来：
 * build 脚本要能被安全扫描放行，用 new Function 跑自家文件也是不该留的形状。 */
const astPath = path.join(ROOT, 'src', 'data', 'asterisms.js');
const astText = fs.readFileSync(astPath, 'utf8');
const ast = [];
const groups = [];
for (const block of astText.split(/\n    \{/) .slice(1)) {
  const id = (block.match(/id: '([^']+)'/) || [])[1];
  const cn = (block.match(/cn: '([^']+)'/) || [])[1];
  const keys = [...block.matchAll(/\[\s*'([^']+)',\s*'([^']+)'\s*\]/g)].flatMap(m => [m[1], m[2]]);
  if (!id || !cn || !keys.length) continue;
  groups.push({ id, cn, keys });
}
console.log('── 星群连线端点解析（肉眼过一遍，画错线比不画更糟）');
for (const g of groups) {
  const seen = new Set();
  for (const k of g.keys) {
    const hit = byKey.get(k);
    if (!hit) {
      const pre = k.split(' ')[0], con = (k.split(' ')[1] || '');
      const cands = [...byKey.keys()].filter(x => x.startsWith(pre) && x.endsWith(con)).slice(0, 4);
      ast.push('缺失 ' + g.id + ' 端点 ' + k + (cands.length ? '，星表里相近的键：' + cands.join(' / ') : '，该星座缩写下一个拜耳键都没有'));
      continue;
    }
    if (seen.has(k)) continue;
    seen.add(k);
    const name = packed[hit.idx * 6 + 4] >= 0 ? labels[packed[hit.idx * 6 + 4]] : '—';
    console.log(`   ${g.cn.padEnd(12)} ${k.padEnd(9)} → ${String(name).padEnd(12)} V=${hit.v.toFixed(2)} HR=${hit.hr}`);
  }
}

const astIndex = {};
for (const g of groups) for (const k of g.keys) if (byKey.has(k)) astIndex[k] = byKey.get(k).idx;
const count = packed.length / 6;
const header = `/* 亮星表（自动生成，勿手改）
 * 生成命令：node tools/build-stars.js          可选：MAG_LIMIT=6.2 node tools/build-stars.js
 * 数据源：Yale Bright Star Catalogue 第 5 版（brettonw 整理 JSON，MIT，
 *         许可正文随仓分发：THIRD_PARTY_NOTICES/brettonw-YaleBrightStarCatalog-MIT.txt）
 *         IAU 专名对照取自同一仓库的 starNames-IAU.txt（同许可，生成输入不入库），
 *         匹配 ${matched}/${iauRows.length} 条
 * 字段：每 6 个一组 —— 赤经(度, J2000) | 赤纬(度) | 视星等 | B-V×100 | 专名索引(-1 无) | HR 号
 * 口径：V ≤ ${MAG_LIMIT}，${count} 颗；自行未计（对星图视觉无感）；
 *       投影前由 src/core/astro.js 的 precess() 只作总岁差，不含章动（<0.01°，见 docs）。
 */`;

const out = `${header}
(function (root) {
  root.LFStars = {
    meta: { count: ${count}, magLimit: ${MAG_LIMIT}, source: 'Yale BSC5 (MIT)', epoch: 'J2000', stride: 6 },
    data: [${packed.join(',')}],
    labels: ${JSON.stringify(labels)},
    asterismIndex: ${JSON.stringify(astIndex)}
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;
fs.writeFileSync(path.join(ROOT, 'src', 'data', 'stars.js'), out);
console.log(`星座属格表 ${Object.keys(GENITIVE).length} 条，缩写 ${CON_ABBR.size} 个`);
console.log(`\n写入 src/data/stars.js：${count} 颗（坐标异常丢弃 ${dropped}），专名 ${labels.length} 个，体积 ${(out.length / 1024).toFixed(0)} KB`);
if (unmatched.length) {
  console.log(`IAU 未匹配 ${unmatched.length} 条（多为变星/多星后缀或 BSC 缺拜耳名）：${unmatched.slice(0, 12).join(', ')}${unmatched.length > 12 ? ' …' : ''}`);
}
if (ast.length) { console.log(ast.join('\n')); process.exit(1); }
