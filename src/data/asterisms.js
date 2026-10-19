/* 星群连线与命名表（手写件，非生成）
 *
 * 只画“端点能确定”的八条：每条线段两端的星用 BSC 的拜耳键（希腊字母缩写 + 三字母属格）
 * 指认，tools/build-stars.js 会把每个键回查星表，查不到就当场报错，
 * 并把解析出的 IAU 专名逐条打印出来供肉眼复核。画错一条线的代价是界面骗人，
 * 所以宁可少画，也不凭印象补线。
 */
(function (root) {
  var asterisms = [
    {
      id: 'bigdipper', cn: '北斗七星', en: 'Ursa Major',
      seg: [['Alp UMa', 'Bet UMa'], ['Bet UMa', 'Gam UMa'], ['Gam UMa', 'Del UMa'],
        ['Del UMa', 'Alp UMa'], ['Del UMa', 'Eps UMa'], ['Eps UMa', 'Zet UMa'], ['Zet UMa', 'Eta UMa']]
    },
    {
      id: 'littledipper', cn: '小北斗', en: 'Ursa Minor',
      seg: [['Alp UMi', 'Bet UMi'], ['Bet UMi', 'Gam UMi'], ['Gam UMi', 'Del UMi'],
        ['Del UMi', 'Eps UMi'], ['Eps UMi', 'Zet UMi'], ['Zet UMi', 'Eta UMi'], ['Eta UMi', 'Del UMi']]
    },
    {
      id: 'casw', cn: '仙后 W', en: 'Cassiopeia',
      seg: [['Bet Cas', 'Alp Cas'], ['Alp Cas', 'Gam Cas'], ['Gam Cas', 'Del Cas'], ['Del Cas', 'Eps Cas']]
    },
    {
      id: 'orion', cn: '猎户', en: 'Orion',
      seg: [['Alp Ori', 'Gam Ori'], ['Gam Ori', 'Del Ori'], ['Alp Ori', 'Zet Ori'],
        ['Del Ori', 'Eps Ori'], ['Eps Ori', 'Zet Ori'], ['Zet Ori', 'Kap Ori'],
        ['Del Ori', 'Bet Ori'], ['Eps Ori', 'Lam Ori']]
    },
    {
      id: 'northerncross', cn: '北十字', en: 'Cygnus',
      seg: [['Alp Cyg', 'Gam Cyg'], ['Gam Cyg', 'Bet Cyg'], ['Gam Cyg', 'Del Cyg'], ['Gam Cyg', 'Eps Cyg']]
    },
    {
      id: 'squareandchain', cn: '飞马方与仙女链', en: 'Pegasus / Andromeda',
      seg: [['Alp Peg', 'Bet Peg'], ['Bet Peg', 'Alp And'], ['Alp And', 'Gam Peg'], ['Gam Peg', 'Alp Peg'],
        ['Alp And', 'Bet And'], ['Bet And', 'Gam And']]
    },
    {
      id: 'crux', cn: '南十字', en: 'Crux',
      seg: [['Alp Cru', 'Gam Cru'], ['Bet Cru', 'Del Cru']]
    },
    {
      id: 'lyra', cn: '织女平行四边形', en: 'Lyra',
      seg: [['Alp Lyr', 'Zet Lyr'], ['Zet Lyr', 'Bet Lyr'], ['Bet Lyr', 'Gam Lyr'],
        ['Gam Lyr', 'Del Lyr'], ['Del Lyr', 'Zet Lyr']]
    },
    {
      id: 'aquila', cn: '天鹰', en: 'Aquila',
      seg: [['Alp Aql', 'Bet Aql'], ['Alp Aql', 'Gam Aql']]
    },
    {
      id: 'scorpius', cn: '天蝎螯与头', en: 'Scorpius',
      seg: [['Bet Sco', 'Del Sco'], ['Del Sco', 'Pi Sco'], ['Del Sco', 'Alp Sco']]
    }
  ];
  root.LFAsterisms = asterisms;
})(typeof globalThis !== 'undefined' ? globalThis : this);
