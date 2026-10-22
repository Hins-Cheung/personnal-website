# Racing &amp; Weather · 个人网站

把 **赛车资讯** 和 **赛道天气** 放在一屏里的纯静态个人站点。零依赖、零构建、零 API Key。

- 资讯：The Race 的 RSS、F1 官网最新页、倍耐力新闻室（Formula 1 分类），每条带缩略图、英文原标题 + 中文译文
- 天气：按 F1 官方赛历逐站展示比赛周末的天气，含当前实况、空气质量、紫外线
- 样式：深色玻璃拟态，四个页面（首页 / 订阅 / 天气 / 关于）

```
index.html      首页：Hero + 下一站天气 + 最新资讯
news.html       订阅：按源分组的完整资讯流
weather.html    天气：赛历逐站天气 + 常驻城市
about.html      关于：简介、链接、数据来源
assets/         config.js（配置）+ style.css + core.js + news.js + weather.js + f1calendar.js
worker/proxy.js Cloudflare Worker 代理（推荐）
tools/          本地服务器、赛历生成脚本、调试脚本
```

---

## 一、本地预览

需要用 http 打开（`file://` 下浏览器会拦跨域请求）：

```powershell
powershell -File tools/serve.ps1        # 默认 8000 端口
```

然后打开 <http://localhost:8000/>。

---

## 二、改成你自己的

只需要动 `assets/config.js`，不用碰别的文件：

| 配置项 | 说明 |
| --- | --- |
| `profile` | 姓名、简介、头像、外链 |
| `sources` | 订阅源。`type: 'rss'` 走 XML 解析；`type: 'html'` 走页面解析，`parser` 选 `f1` / `pirelli` / `generic` |
| `cities` | 常驻城市。只给 `name` 会自动地理编码，也可以直接给 `lat` / `lon` |
| `raceLabels` | 分站中文名（天气页显示用） |
| `fetch.workerProxy` | 自建 Worker 代理地址，见下一节 |
| `fetch.proxies` | 公共代理兜底链，按顺序尝试 |
| `translate` | 标题翻译开关与接口，见下 |

---

## 三、部署到 Cloudflare

### 3.1 静态站点 → Cloudflare Pages

**方式 A：直接上传（最快）**

1. 登录 <https://dash.cloudflare.com> → Workers & Pages → Create → Pages → Upload assets
2. 把项目目录里的 `index.html` / `news.html` / `weather.html` / `about.html` / `assets/` 一起上传
   （`tools/` 和 `worker/` 不用上传，但传了也无妨）

**方式 B：接 Git 仓库**

| 配置项 | 填 |
| --- | --- |
| Framework preset | None |
| Build command | 留空 |
| Build output directory | `/` |

部署完会得到 `https://<项目名>.pages.dev`。

### 3.2 资讯代理 → Cloudflare Worker（强烈建议）

浏览器抓 RSS 会被 CORS 挡住，必须走代理。公共代理（allorigins、r.jina.ai 等）时好时坏，
自己跑一个 Worker 就稳定得多，而且 Worker 和站点在同一个账号下。

```bash
cd worker
npx wrangler deploy
```

部署完会输出一个地址，把它填进 `assets/config.js`：

```js
fetch: {
  workerProxy: 'https://feed-proxy.你的子域名.workers.dev/?url=',
  ...
}
```

Worker 做了四件事：

- 加 `Access-Control-Allow-Origin: *`
- 缓存 30 分钟（`caches.default`），不反复打扰源站
- 提供 `/translate?q=...` 翻译端点，译文缓存 30 天
- 只允许白名单域名（见 `worker/proxy.js` 里的 `ALLOWED_HOSTS`），避免被当成开放代理滥用

> 用 wrangler 部署需要本机有 Node.js。这台机器目前没装，`npx` 会自动拉一个临时的。
> 也可以在 Cloudflare 网页后台直接粘贴 `worker/proxy.js` 的内容新建 Worker，效果一样。

### 3.3 自定义域名

Pages 项目 → Custom domains → 添加域名。会自动签发证书。

---

## 四、缩略图与中文译文

**缩略图**直接从各源自己的数据里取，不经过任何图片代理：

| 源 | 取图方式 |
| --- | --- |
| The Race | RSS 里的 `media:content` |
| F1 官网 | 文章卡片里的 `<img>`（`media.formula1.com`） |
| 倍耐力 | 条目块 `.js-pp-archive-image` 的 `background-image` |

图片是普通 `<img>` 直连源站，不消耗任何额度。源站拒绝外链或加载失败时，自动降级成源站首字母的渐变占位块。

**中文译文**的接口按这个顺序自动选：

1. **自建 Worker 的 `/translate`**（推荐）——只要 `fetch.workerProxy` 填了就会自动用它。
   Worker 服务端调用 MyMemory，译文在 Cloudflare 边缘缓存 30 天，反复访问不再消耗任何额度。
2. **MyMemory 公共接口**——没配 Worker 时的兜底，自带 CORS，不用 Key。

两种方式下译文都会缓存在浏览器 localStorage，同一条标题只翻一次。

```js
translate: {
  enabled: true,
  endpoint: '',            // 留空 = 自动选；也可强制指定某个地址
  langpair: 'en|zh-CN',
  email: '',               // 用公共接口时填邮箱，额度从 5000 词/天提到 50000 词/天
  concurrency: 3,
  retry: 2                 // 限流时的退避重试次数
}
```

- 逐条回填，英文原文先出现，译文拿到再补上，不拖慢首屏
- 翻译失败只显示英文原文，不影响阅读
- 订阅页有 60 多条，首次访问会发 60 多次翻译请求（公共接口会限流，靠 `retry` 兜住）

---

## 五、更新 F1 赛历

赛历数据存在 `assets/f1calendar.js`，是从 F1 官网抓下来生成的。换赛季或赛程调整时重新生成：

```powershell
powershell -File tools/build-calendar.ps1 2027
```

脚本会读官方页面的 JSON-LD，拿到每一站的分站名、城市、比赛日期和场次日期，
配合 `build-calendar.ps1` 里的赛道经纬度表，写出 `assets/f1calendar.js`。

> 注意：2026 赛季的沙特站已被取消、巴林站移到了马来西亚雪邦赛道——这些脚本都是照官网实际数据来的，
> 不要凭记忆手改。

---

## 六、已知限制

- **公共代理不稳定**：没部署自建 Worker 时，抓取失败页面会提示「以下源暂时抓不到」。
- **预报窗口**：Open-Meteo 的逐日预报只覆盖未来约 15 天，更远的分站只显示赛道当前实况；
  已结束的分站走历史归档接口，显示的是实测值。
- **天气是赛道坐标点的天气**，不是观赛区的体感；山区赛道（斯帕、蒙扎红牛环）温差会比较大。
- **机器翻译**：术语偶尔翻得生硬（比如把 "Grand Prix" 译成"大奖赛"是对的，但 "pit lane" 之类的行话不一定准），
  介意的话把 `translate.enabled` 设成 `false`，只留英文标题。
