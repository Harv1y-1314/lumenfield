/* 拍摄地预设：旅拍与风光常用的机位区域
 *
 * 坐标取该区域城市/景区的中心点，海拔取观星常用停车点的量级（不是精确机位——
 * 精确机位要按当次路线定，界面允许手改经纬度与海拔）。
 * tz 是拍摄地使用的**民用时区偏移（分钟，东为正）**，不是经度推算值：
 * 中国统一 UTC+8、尼泊尔 UTC+5:45、印度 UTC+5:30 这类例外一律按实际填。
 * 文件尾部有自检：纬度必须在 ±90、经度必须在 ±180 内，且中国境内的点必须落在
 * 73–135°E / 18–54°N 的框里——写反经纬度会被这条规则当场抓住。
 */
(function (root) {
  var list = [
    { id: 'beijing', name: '北京·香山', region: '华北', lat: 39.996, lon: 116.191, tz: 480, height: 350, kind: '风光', note: '秋叶与城市天际线；银河季在 6–8 月，秋季银心要等后半夜' },
    { id: 'lhasa', name: '西藏·纳木错', region: '青藏高原', lat: 30.752, lon: 90.931, tz: 480, height: 4718, kind: '星空', note: '海拔高、晴夜多，夏季银心整夜不落；注意夜间气温与缺氧' },
    { id: 'qms', name: '西藏·珠峰大本营', region: '青藏高原', lat: 28.137, lon: 86.855, tz: 480, height: 5150, kind: '风光', note: '日出照亮峰顶的 07:00–08:30 是主窗口；夜间极寒' },
    { id: 'kailash', name: '西藏·冈仁波齐', region: '青藏高原', lat: 31.075, lon: 81.312, tz: 480, height: 4630, kind: '星空', note: '光污染极低（Bortle 1–2）；补给线长，需备油料与住宿' },
    { id: 'qinghai', name: '青海湖·二郎剑', region: '青藏高原', lat: 36.676, lon: 100.486, tz: 480, height: 3196, kind: '风光', note: '油菜花 7 月初；湖面倒影配日出' },
    { id: 'chaka', name: '茶卡盐湖', region: '青藏高原', lat: 36.783, lon: 99.087, tz: 480, height: 3050, kind: '旅拍', note: '天空之镜：无风的正午倒影最完整，日出日落做人像剪影' },
    { id: 'ejina', name: '额济纳·胡杨林', region: '内蒙古', lat: 41.968, lon: 101.064, tz: 480, height: 920, kind: '风光', note: '黄叶窗口极窄，10 月 5–20 日；晨雾偶发，别只留一个下午' },
    { id: 'kanas', name: '喀纳斯·观鱼台', region: '新疆', lat: 48.700, lon: 87.010, tz: 480, height: 1374, kind: '风光', note: '晨雾在日出后 20–40 分钟最厚，先广角再换长焦' },
    { id: 'bgt', name: '博格达·天池', region: '新疆', lat: 43.890, lon: 88.100, tz: 480, height: 1910, kind: '星空', note: '夏季银心跨过湖面；夜里风大，三脚架要配重' },
    { id: 'feilai', name: '梅里雪山·飞来寺', region: '云南', lat: 28.442, lon: 98.873, tz: 480, height: 3400, kind: '风光', note: '日照金山约在日出后 5–15 分钟，10–5 月晴率最高' },
    { id: 'yadin', name: '稻城亚丁·洛绒牛场', region: '川西', lat: 28.440, lon: 100.320, tz: 480, height: 4180, kind: '风光', note: '三神山同框靠清晨侧光；秋色在 10 月中旬' },
    { id: 'zimei', name: '贡嘎·子梅垭口', region: '川西', lat: 29.620, lon: 101.900, tz: 480, height: 4500, kind: '星空', note: '日照金山与银心同框是招牌；路况差，越野车才进得去' },
    { id: 'siguniang', name: '四姑娘山·猫鼻梁', region: '川西', lat: 31.080, lon: 102.880, tz: 480, height: 3200, kind: '风光', note: '公路机位，日落打亮四沟连峰；冬春晴率高于夏季' },
    { id: 'zhangye', name: '张掖·七彩丹霞', region: '甘肃', lat: 38.930, lon: 100.480, tz: 480, height: 2100, kind: '风光', note: '色彩在雨后斜阳最艳，日落前 40 分钟进场' },
    { id: 'dunhuang', name: '敦煌·月牙泉', region: '甘肃', lat: 40.142, lon: 94.662, tz: 480, height: 1140, kind: '旅拍', note: '沙漠日出配鸣沙山剪影；起风时先护传感器' },
    { id: 'huangshan', name: '黄山·清凉台', region: '安徽', lat: 30.140, lon: 118.140, tz: 480, height: 1660, kind: '风光', note: '云海需要雨后骤冷，日出前 20 分钟到位' },
    { id: 'wuyuan', name: '婺源·石城', region: '江西', lat: 29.250, lon: 117.860, tz: 480, height: 60, kind: '风光', note: '11 月中—12 月初枫叶晨雾，需 06:30 前占位' },
    { id: 'xiampu', name: '霞浦·北岐', region: '福建', lat: 26.890, lon: 119.990, tz: 480, height: 5, kind: '风光', note: '滩涂紫菜架：潮汐比日出更关键，退潮前 1 小时到' },
    { id: 'dongshan', name: '东山岛·鱼骨沙洲', region: '福建', lat: 23.700, lon: 117.420, tz: 480, height: 10, kind: '旅拍', note: '沙洲只在低潮露出，行程必须按潮汐表排' },
    { id: 'xiamen', name: '厦门·环岛路', region: '福建', lat: 24.480, lon: 118.090, tz: 480, height: 5, kind: '旅拍', note: '海边跟拍的黄金时刻是日落前后各 30 分钟' },
    { id: 'shenzhen', name: '深圳·东西冲', region: '华南', lat: 22.520, lon: 114.500, tz: 480, height: 20, kind: '旅拍', note: '礁石日出；夏季午后多雷雨，早场更稳' },
    { id: 'sanya', name: '三亚·后海', region: '海南', lat: 18.300, lon: 109.660, tz: 480, height: 8, kind: '旅拍', note: '椰林逆光海浪；正午顶光太硬，改拍树荫' },
    { id: 'changbaishan', name: '长白山·西坡', region: '东北', lat: 42.000, lon: 127.500, tz: 480, height: 2000, kind: '风光', note: '天池能见度靠运气，秋季晴率最高' },
    { id: 'hulunbuir', name: '呼伦贝尔·莫日格勒河', region: '内蒙古', lat: 49.200, lon: 119.700, tz: 480, height: 650, kind: '风光', note: '九曲弯靠日落侧光；6–9 月绿，10 月转金' },
    { id: 'tokyo', name: '东京·筑地本愿寺', region: '日本', lat: 35.670, lon: 139.700, tz: 540, height: 25, kind: '旅拍', note: '塔与寺同框，蓝调时刻只有两三分钟' },
    { id: 'kyoto', name: '京都·三年坂', region: '日本', lat: 35.001, lon: 135.774, tz: 540, height: 60, kind: '旅拍', note: '06:00 前人少；红叶在 11 月中旬' },
    { id: 'santorini', name: '圣托里尼·伊亚', region: '希腊', lat: 36.461, lon: 25.375, tz: 120, height: 150, kind: '旅拍', note: '日落前 1 小时占位，蓝顶白墙吃的是斜射暖光' },
    { id: 'paris', name: '巴黎·夏悠宫', region: '法国', lat: 48.862, lon: 2.352, tz: 60, height: 35, kind: '旅拍', note: '铁塔在东北方向约 5 km，日落在西南时逆光最好' },
    { id: 'reykjavik', name: '冰岛·辛格维利尔', region: '冰岛', lat: 64.255, lon: -21.130, tz: 0, height: 180, kind: '星空', note: '9–3 月极光活跃（Kp 要联网查）；冬季路面结冰' },
    { id: 'lofoten', name: '挪威·洛弗敦', region: '挪威', lat: 68.200, lon: 13.600, tz: 120, height: 5, kind: '风光', note: '峡湾日出配渔屋；极夜前后有整段暮光蓝调' },
    { id: 'tromso', name: '挪威·特罗姆瑟', region: '挪威', lat: 69.649, lon: 18.955, tz: 120, height: 50, kind: '星空', note: '11 月中—1 月中极夜，白天也能拍极光' },
    { id: 'banff', name: '班夫·佩托湖', region: '加拿大', lat: 51.682, lon: -116.234, tz: -420, height: 1860, kind: '风光', note: '秋色在 9 月下旬；观景点北向，正午最亮' },
    { id: 'yosemite', name: '优胜美地·隧道观景点', region: '美国', lat: 37.716, lon: -119.662, tz: -420, height: 2000, kind: '风光', note: '2 月中"火瀑布"需融雪加晴天，窗口约 15 分钟' },
    { id: 'grandcanyon', name: '大峡谷·Mather Point', region: '美国', lat: 36.063, lon: -112.109, tz: -420, height: 2100, kind: '风光', note: '日出侧光打亮岩层；南缘光污染低些，可拍星' },
    { id: 'maunakea', name: '夏威夷·冒纳凯亚', region: '美国', lat: 19.820, lon: -155.468, tz: -600, height: 4200, kind: '星空', note: '北半球最好的观星点之一；海拔急升需要适应' },
    { id: 'tekapo', name: '新西兰·蒂卡波湖', region: '新西兰', lat: -44.005, lon: 170.479, tz: 720, height: 700, kind: '星空', note: '国际暗天区，麦哲伦云与南天银心全年轮替' },
    { id: 'ushuaia', name: '阿根廷·乌斯怀亚', region: '南美', lat: -54.802, lon: -68.303, tz: -180, height: 50, kind: '风光', note: '高纬夏季接近白夜，拍星空要排在 12 月前后' },
    { id: 'ladakh', name: '印度·拉达克', region: '南亚', lat: 34.100, lon: 77.580, tz: 330, height: 3500, kind: '星空', note: '高原晴夜多；时区是 +5:30 而不是整小时' },
    { id: 'sahara', name: '摩洛哥·梅尔祖卡', region: '北非', lat: 31.100, lon: -4.010, tz: 60, height: 700, kind: '星空', note: '沙丘日出线条最软；夜里有风沙，注意镜头密封' },
    { id: 'namib', name: '纳米比亚·苏索斯维利', region: '南非', lat: -24.730, lon: 15.290, tz: 60, height: 870, kind: '风光', note: '45 号沙丘阴影在日出后 30 分钟最长；南天银河 5–9 月' }
  ];

  var problems = [];
  list.forEach(function (s) {
    if (!(s.lat >= -90 && s.lat <= 90)) problems.push(s.id + ' 纬度越界 ' + s.lat);
    if (!(s.lon >= -180 && s.lon <= 180)) problems.push(s.id + ' 经度越界 ' + s.lon);
    if (Math.abs(s.lat) > 60 && Math.abs(s.lon) < 60 && s.region === '华北') problems.push(s.id + ' 经纬疑似写反');
    if (/^(beijing|lhasa|qms|kailash|qinghai|chaka|ejina|kanas|bgt|feilai|yadin|zimei|siguniang|zhangye|dunhuang|huangshan|wuyuan|xiampu|dongshan|xiamen|shenzhen|sanya|changbaishan|hulunbuir)$/.test(s.id)) {
      if (!(s.lon >= 73 && s.lon <= 135 && s.lat >= 18 && s.lat <= 54)) problems.push(s.id + ' 不在中国境内框内');
    }
    if (typeof s.tz !== 'number' || Math.abs(s.tz) > 840) problems.push(s.id + ' 时区偏移可疑 ' + s.tz);
  });

  root.LFSites = {
    list: list,
    problems: problems,
    byId: function (id) {
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return list[0];
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
