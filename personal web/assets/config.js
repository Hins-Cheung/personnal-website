// ============================================================
// 站点配置 —— 改这里就够了，不用动其他文件
// ============================================================

window.SITE = {
  // ---------- 个人信息 ----------
  profile: {
    name: '你的名字',
    title: 'Racing & Weather',
    tagline: '一个把赛车资讯与天气放在一起的个人主页',
    bio: '在这里写一段自我介绍：我关注什么、这个站点用来做什么。',
    avatar: '', // 头像图片 URL，留空则用首字母色块
    email: '',
    links: [
      { label: 'GitHub', url: 'https://github.com/' },
      { label: '微博', url: 'https://weibo.com/' },
      { label: '邮箱', url: 'mailto:you@example.com' }
    ]
  },

  // ---------- 资讯源 ----------
  // type: 'rss'  -> 抓 XML，兼容 RSS 2.0 与 Atom
  // type: 'html' -> 抓网页，用 parser 指定的规则提取条目
  //        parser: 'f1'      F1 官网最新页
  //        parser: 'pirelli' 倍耐力新闻室
  //        parser: 'generic' 通用规则：匹配 linkPattern 的 <a> 取标题
  sources: [
    {
      id: 'the-race',
      name: 'The Race',
      type: 'rss',
      url: 'https://www.the-race.com/feed/',
      home: 'https://www.the-race.com/',
      desc: '独立赛车媒体，深度报道与独家视角',
      accent: '#ff2e4d'
    },
    {
      id: 'f1',
      name: 'Formula 1',
      type: 'html',
      parser: 'f1',
      url: 'https://www.formula1.com/en/latest/all.html',
      home: 'https://www.formula1.com/',
      desc: 'F1 官方最新消息',
      accent: '#ff3b3b'
    },
    {
      id: 'pirelli',
      name: 'Pirelli 新闻室',
      type: 'html',
      parser: 'pirelli',
      url: 'https://press.pirelli.com/?h=1&t=Formula%201',
      home: 'https://press.pirelli.com/',
      desc: '倍耐力官方 · Formula 1 分类',
      accent: '#ffd166'
    }
  ],

  // ---------- 天气城市 ----------
  // 填 name 即可（会自动地理编码）；也可以直接给 lat / lon 跳过编码请求
  cities: [
    { name: '上海', lat: 31.23, lon: 121.47 },
    { name: '摩纳哥', lat: 43.73, lon: 7.42 },
    { name: '蒙扎', lat: 45.58, lon: 9.28 },
    { name: '银石', lat: 52.07, lon: -1.02 }
  ],

  // ---------- 分站中文名（天气页与赛历显示用）----------
  // slug 与官方赛历一致；新增赛季后可在 tools/build-calendar.ps1 里重新生成
  raceLabels: {
    'australia':           { title: '澳大利亚大奖赛', place: '墨尔本 · 阿尔伯特公园' },
    'china':               { title: '中国大奖赛',     place: '上海 · 上海国际赛车场' },
    'japan':               { title: '日本大奖赛',     place: '铃鹿 · 铃鹿赛道' },
    'miami':               { title: '迈阿密大奖赛',   place: '迈阿密花园' },
    'canada':              { title: '加拿大大奖赛',   place: '蒙特利尔 · 吉尔·维伦纽夫赛道' },
    'monaco':              { title: '摩纳哥大奖赛',   place: '蒙特卡洛' },
    'barcelona-catalunya': { title: '巴塞罗那大奖赛', place: '蒙特梅洛' },
    'austria':             { title: '奥地利大奖赛',   place: '施皮尔贝格 · 红牛环' },
    'great-britain':       { title: '英国大奖赛',     place: '银石' },
    'belgium':             { title: '比利时大奖赛',   place: '斯帕 · 弗朗科尔尚' },
    'hungary':             { title: '匈牙利大奖赛',   place: '布达佩斯 · 匈牙利环' },
    'netherlands':         { title: '荷兰大奖赛',     place: '赞德沃特' },
    'italy':               { title: '意大利大奖赛',   place: '蒙扎' },
    'spain':               { title: '马德里大奖赛',   place: '马德里 · 哈拉马赛道' },
    'azerbaijan':          { title: '阿塞拜疆大奖赛', place: '巴库' },
    'bahrain':             { title: '巴林大奖赛',     place: '马来西亚 · 雪邦' },
    'singapore':           { title: '新加坡大奖赛',   place: '滨海湾' },
    'united-states':       { title: '美国大奖赛',     place: '奥斯汀 · 美洲赛道' },
    'mexico':              { title: '墨西哥大奖赛',   place: '墨西哥城' },
    'brazil':              { title: '巴西大奖赛',     place: '圣保罗 · 若斯塔·帕克赛道' },
    'las-vegas':           { title: '拉斯维加斯大奖赛', place: '拉斯维加斯街道赛道' },
    'qatar':               { title: '卡塔尔大奖赛',   place: '多哈 · 卢赛尔赛道' },
    'united-arab-emirates':{ title: '阿布扎比大奖赛', place: '亚斯码头赛道' }
  },

  // ---------- 抓取设置 ----------
  fetch: {
    timeoutMs: 20000,       // 单个请求默认超时
    cacheMinutes: 30,       // 本地缓存时长

    // 【推荐】自建 Cloudflare Worker 代理地址。
    // 部署 worker/proxy.js 后，把地址填到这里（必须以 ?url= 结尾），它会排在最前面。
    // 例：'https://feed-proxy.你的子域名.workers.dev/?url='
    workerProxy: '',

    // 公共代理按顺序尝试，前面的失败自动换下一个。
    // prefix 末尾若是 ?url= / &url= / ?quest= 则自动 URL 编码拼接，否则原样拼接。
    // headers 为可选的附加请求头，timeout 为该通道单独的超时时间（毫秒）。
    proxies: [
      // jina 冷缓存经常要 20~60 秒，超时给足
      { prefix: 'https://r.jina.ai/', headers: { 'x-return-format': 'html' }, timeout: 60000 },
      { prefix: 'https://api.allorigins.win/raw?url=', timeout: 20000 },
      { prefix: 'https://api.cors.lol/?url=', timeout: 20000 },
      { prefix: 'https://api.codetabs.com/v1/proxy?quest=', timeout: 20000 },
      { prefix: 'https://api.allorigins.win/get?url=', timeout: 20000 },
      { prefix: '', timeout: 12000 }
    ]
  },

  // ---------- 标题翻译 ----------
  // endpoint 留空即可：填了 fetch.workerProxy 就自动走自建 Worker 的 /translate
  //（服务端翻译 + 长期缓存，不受公共接口额度限制），否则用 MyMemory 公共接口。
  // 译文也会缓存在浏览器本地，重复访问不再请求。
  translate: {
    enabled: true,
    endpoint: '',            // 想指定别的接口就填完整地址
    langpair: 'en|zh-CN',
    email: '',               // 用公共接口时填邮箱可把额度提到 50000 词/天
    concurrency: 3,
    retry: 2
  },

  // ---------- 天气选项 ----------
  weather: {
    forecastDays: 7,
    units: {
      temp: '°C',
      wind: 'km/h'
    }
  }
};
