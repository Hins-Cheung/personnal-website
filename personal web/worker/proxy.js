/**
 * Cloudflare Worker —— 资讯源 CORS 代理
 *
 * 为什么需要：浏览器抓 RSS / 网页会被 CORS 挡住，公共代理经常抽风。
 * 自己跑一个 Worker 就稳定得多，而且和站点在同一个 Cloudflare 账号下。
 *
 * 用法：
 *   https://<你的worker>.workers.dev/?url=<被代理的地址(URL编码)>
 *
 * 部署：
 *   npx wrangler deploy worker/proxy.js --name feed-proxy
 * 部署完把地址填到 assets/config.js 的 fetch.proxies 第一项。
 */

const ALLOWED_HOSTS = [
  'www.the-race.com',
  'the-race.com',
  'www.formula1.com',
  'formula1.com',
  'press.pirelli.com',
  'corporate.pirelli.com'
];

const CACHE_TTL = 1800; // 30 分钟

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method !== 'GET') {
      return json({ error: 'method not allowed' }, 405);
    }

    // /translate?q=... —— 标题翻译，译文长期缓存，不吃公共接口的额度
    if (url.pathname === '/translate') {
      return handleTranslate(url, ctx);
    }

    const target = url.searchParams.get('url');
    if (!target) return json({ error: 'missing url param' }, 400);

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return json({ error: 'invalid url' }, 400);
    }
    if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') {
      return json({ error: 'only http(s) allowed' }, 400);
    }
    if (!ALLOWED_HOSTS.includes(targetUrl.hostname)) {
      return json({ error: 'host not allowed: ' + targetUrl.hostname }, 403);
    }

    const cache = caches.default;
    const cacheKey = new Request(targetUrl.toString(), { method: 'GET' });

    let upstream = await cache.match(cacheKey);
    if (!upstream) {
      try {
        const res = await fetch(targetUrl.toString(), {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          },
          redirect: 'follow'
        });
        if (!res.ok) {
          return json({ error: 'upstream ' + res.status }, 502);
        }
        upstream = new Response(res.body, res);
        upstream.headers.set('Cache-Control', 'public, max-age=' + CACHE_TTL);
        ctx.waitUntil(cache.put(cacheKey, upstream.clone()));
      } catch (err) {
        return json({ error: 'fetch failed: ' + err.message }, 502);
      }
    }

    const body = await upstream.arrayBuffer();
    const out = new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=' + CACHE_TTL,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*'
      }
    });
    return out;
  }
};

const TRANSLATE_CACHE_TTL = 60 * 60 * 24 * 30; // 30 天

function getCache() {
  try { return caches.default; } catch { return null; }
}

async function handleTranslate(url, ctx) {
  const q = url.searchParams.get('q');
  if (!q) return json({ error: 'missing q param' }, 400);
  const langpair = url.searchParams.get('langpair') || 'en|zh-CN';

  const cache = getCache();
  const key = new Request(`https://translate.local/${langpair}/${encodeURIComponent(q)}`, { method: 'GET' });

  if (cache) {
    const hit = await cache.match(key);
    if (hit) {
      const body = await hit.text();
      return new Response(body, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'X-Translate-Cache': 'HIT'
        }
      });
    }
  }

  const api = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(q) +
    '&langpair=' + encodeURIComponent(langpair);

  let payload;
  try {
    const res = await fetch(api);
    const data = await res.json();
    const zh = data && data.responseData && data.responseData.translatedText;
    if (!zh || /MYMEMORY WARNING|INVALID LANGUAGE|QUERY LENGTH LIMIT/i.test(zh)) {
      return json({ error: 'translation failed' }, 502);
    }
    payload = { responseData: { translatedText: zh } };
  } catch (err) {
    return json({ error: 'upstream failed: ' + err.message }, 502);
  }

  const body = JSON.stringify(payload);
  if (cache) {
    const stored = new Response(body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=' + TRANSLATE_CACHE_TTL
      }
    });
    ctx.waitUntil(cache.put(key, stored.clone()));
  }

  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'X-Translate-Cache': 'MISS'
    }
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400'
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
