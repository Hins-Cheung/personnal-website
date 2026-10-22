/* ==========================================================
   核心：抓取 / 解析 / 缓存 / 公共 UI
   依赖 config.js（须先加载）
   ========================================================== */

(function () {
  'use strict';

  var CFG = window.SITE;

  /* ---------------- 小工具 ---------------- */

  window.$ = function (sel, root) { return (root || document).querySelector(sel); };
  window.$$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  window.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  window.stripHtml = function (s) {
    return String(s == null ? '' : s)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  };

  window.relTime = function (input) {
    if (!input) return '';
    var d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return '';
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 0) diff = 0;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' 天前';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };

  window.fmtDate = function (input) {
    var d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  /* ---------------- 抓取：直连 + 代理链 ---------------- */

  var CACHE_PREFIX = 'pw:cache:';
  var memCache = {};

  function cacheGet(key) {
    if (memCache[key]) return memCache[key];
    try {
      var raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      var ttl = (CFG.fetch.cacheMinutes || 30) * 60000;
      if (Date.now() - obj.t > ttl) {
        localStorage.removeItem(CACHE_PREFIX + key);
        return null;
      }
      memCache[key] = obj;
      return obj;
    } catch (e) { return null; }
  }

  function cacheSet(key, value) {
    memCache[key] = value;
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
    } catch (e) { /* 配额满了就算了 */ }
  }

  function buildProxyUrl(prefix, target) {
    if (!prefix) return target;
    if (/[?&](url|quest)=$/i.test(prefix)) return prefix + encodeURIComponent(target);
    return prefix + target;
  }

  function fetchWithTimeout(url, ms, headers) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms);
    return fetch(url, {
      signal: ctrl.signal,
      credentials: 'omit',
      redirect: 'follow',
      headers: headers || { 'Accept': '*/*' }
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  /**
   * 依次尝试：直连 → 代理1 → 代理2 …
   * 返回 { text, via }，全部失败则抛错。
   */
  window.fetchText = function (url, opts) {
    opts = opts || {};
    var useCache = opts.cache !== false;
    var key = url;

    if (useCache) {
      var hit = cacheGet(key);
      if (hit) return Promise.resolve({ text: hit.text, via: hit.via, cached: true });
    }

    var chain = (CFG.fetch.proxies || []).map(function (p) {
      if (typeof p === 'string') return { prefix: p, headers: null };
      return { prefix: p.prefix || '', headers: p.headers || null };
    });
    // 自建 Worker 代理优先
    if (CFG.fetch.workerProxy) {
      chain.unshift({ prefix: CFG.fetch.workerProxy, headers: null });
    }
    var timeout = opts.timeout || CFG.fetch.timeoutMs || 25000;
    var errors = [];

    function attempt(i) {
      if (i >= chain.length) {
        var err = new Error('所有抓取通道都失败了');
        err.errors = errors;
        throw err;
      }
      var p = chain[i];
      var full = buildProxyUrl(p.prefix, url);
      return fetchWithTimeout(full, p.timeout || timeout, p.headers).then(function (text) {
        if (!text || text.length < 2) throw new Error('响应为空');
        // 代理有时会把错误页当正文返回，简单挡一下
        if (/error code:\s*\d/i.test(text.slice(0, 200))) throw new Error('代理返回错误页');
        var via = p.prefix || '直连';
        if (useCache) cacheSet(key, { t: Date.now(), text: text, via: via });
        return { text: text, via: via };
      }, function (err) {
        errors.push((p.prefix || '直连') + ': ' + (err && err.message ? err.message : err));
        return attempt(i + 1);
      });
    }

    return attempt(0);
  };

  /* ---------------- 解析：RSS / Atom ---------------- */

  function textOf(node, tag) {
    if (!node) return '';
    var el = node.getElementsByTagName(tag)[0];
    return el ? (el.textContent || '').trim() : '';
  }

  // 代理（如 jina）有时会在正文前加一段 "Title: ... URL Source: ..." 的说明，
  // 先把文档真正开始的位置找出来，否则 XML/HTML 解析器会直接报错。
  function sliceToDocument(text, tags) {
    var best = -1;
    for (var i = 0; i < tags.length; i++) {
      var at = text.indexOf(tags[i]);
      if (at >= 0 && (best < 0 || at < best)) best = at;
    }
    if (best < 0) throw new Error('响应里没有可解析的文档');
    return text.slice(best);
  }

  /* ---------------- 缩略图提取 ---------------- */

  function firstImgIn(html) {
    var m = String(html || '').match(/<img[^>]+src=["']([^"']+)["']/i);
    return m ? m[1] : '';
  }

  function rssImage(item) {
    // media:content / media:thumbnail / enclosure / 正文里的第一张图
    var tags = ['media:content', 'media:thumbnail', 'media:group'];
    for (var i = 0; i < tags.length; i++) {
      var els = item.getElementsByTagName(tags[i]);
      for (var j = 0; j < els.length; j++) {
        var el = els[j];
        var medium = el.getAttribute('medium') || '';
        var url = el.getAttribute('url') || '';
        if (tags[i] === 'media:group') {
          var inner = el.getElementsByTagName('media:content')[0];
          if (inner) { url = inner.getAttribute('url') || ''; medium = inner.getAttribute('medium') || ''; }
        }
        if (url && (!medium || medium === 'image')) return url;
      }
    }
    var enc = item.getElementsByTagName('enclosure')[0];
    if (enc) {
      var type = enc.getAttribute('type') || '';
      var href = enc.getAttribute('url') || '';
      if (href && (type.indexOf('image') === 0 || /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(href))) return href;
    }
    var body = item.getElementsByTagName('encoded')[0] || item.getElementsByTagName('description')[0];
    var img = firstImgIn(body ? body.textContent : '');
    return img;
  }

  function htmlImageNear(el, selectors) {
    var node = el;
    for (var d = 0; d < 6 && node; d++) {
      for (var i = 0; i < selectors.length; i++) {
        var img = node.querySelector(selectors[i]);
        if (img) {
          var src = img.getAttribute('src') || img.getAttribute('data-src') || '';
          if (src) return src;
        }
      }
      node = node.parentElement;
    }
    return '';
  }

  function bgImage(el, selectors) {
    if (!el) return '';
    var bg = el.querySelector(selectors);
    if (!bg) return '';
    var m = (bg.getAttribute('style') || '').match(/url\((['"]?)([^)'"]+)\1\)/);
    return m ? m[2] : '';
  }

  window.parseFeed = function (xmlText) {
    var doc = new DOMParser().parseFromString(
      sliceToDocument(xmlText, ['<?xml', '<rss', '<feed', '<rdf:RDF']), 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('XML 解析失败');
    }
    var nodes = doc.getElementsByTagName('item');
    var atom = false;
    if (!nodes.length) {
      nodes = doc.getElementsByTagName('entry');
      atom = true;
    }

    return Array.prototype.map.call(nodes, function (it) {
      var link = '';
      if (atom) {
        var alt = it.querySelector('link[rel="alternate"]') || it.querySelector('link');
        link = alt ? alt.getAttribute('href') : '';
      } else {
        link = textOf(it, 'link');
        if (!link) {
          var g = it.querySelector('guid');
          if (g && /^https?:/i.test(g.textContent || '')) link = (g.textContent || '').trim();
        }
      }
      var summary = textOf(it, 'encoded') || textOf(it, 'description') ||
        textOf(it, 'summary') || textOf(it, 'content');
      var date = textOf(it, 'pubDate') || textOf(it, 'published') ||
        textOf(it, 'updated') || textOf(it, 'date');
      return {
        title: stripHtml(textOf(it, 'title')),
        link: (link || '').trim(),
        summary: stripHtml(summary).slice(0, 400),
        image: rssImage(it),
        date: date ? new Date(date) : null
      };
    }).filter(function (x) { return x.title; });
  };

  /* ---------------- 解析：网页 ---------------- */

  function absUrl(href, base) {
    if (!href) return '';
    try { return new URL(href, base).href; } catch (e) { return href; }
  }

  function nearestDate(container) {
    if (!container) return null;
    var t = container.querySelector('time[datetime]');
    if (t) {
      var d = new Date(t.getAttribute('datetime'));
      if (!isNaN(d.getTime())) return d;
    }
    var txt = container.textContent || '';
    var m = txt.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
    if (m) {
      var dt = new Date(m[3] + '-' + monthNum(m[2]) + '-' + m[1] + 'T12:00:00');
      if (!isNaN(dt.getTime())) return dt;
    }
    return null;
  }

  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function monthNum(name) { return MONTHS[name.slice(0, 3).toLowerCase()]; }

  var PARSERS = {
    // F1 官网最新页：文章卡片标题即链接文本
    f1: function (doc, base) {
      var seen = {};
      var out = [];
      var as = doc.querySelectorAll('a[href*="/en/latest/article/"]');
      Array.prototype.forEach.call(as, function (a) {
        var title = stripHtml(a.textContent || '');
        var href = a.getAttribute('href');
        if (!title || title.length < 8 || !href) return;
        var url = absUrl(href, base);
        if (seen[url]) return;
        seen[url] = 1;
        out.push({
          title: title,
          link: url,
          summary: '',
          image: absUrl(htmlImageNear(a, ['img[src*="media.formula1.com"]', 'img[src]']), base),
          date: nearestDate(a.closest('div, article, li') || a)
        });
      });
      return out;
    },

    // 倍耐力新闻室：标题 + 日期 + 摘要 + 头图
    pirelli: function (doc, base) {
      var out = [];
      var seen = {};
      var as = doc.querySelectorAll('a.text_latestnews_more');
      Array.prototype.forEach.call(as, function (a) {
        var title = stripHtml(a.textContent || '');
        var href = a.getAttribute('href');
        if (!title || title.length < 6 || !href) return;
        var url = absUrl(href, base);
        if (seen[url]) return;
        seen[url] = 1;
        var box = a.closest('.pp_big_headlines_item_container') ||
                  a.closest('.pp_bigheadlines_item_container') ||
                  a.closest('.mm_listitem') ||
                  a.closest('div');
        var day = box && box.querySelector('.pp_date_day');
        var month = box && box.querySelector('.pp_date_month');
        var year = box && box.querySelector('.pp_date_year');
        var date = null;
        if (day && month && year) {
          date = new Date(year.textContent.trim() + '-' +
            pad(monthNum(month.textContent.trim())) + '-' +
            parseInt(day.textContent.trim(), 10) + 'T12:00:00');
          if (isNaN(date.getTime())) date = null;
        }
        var sum = box && box.querySelector('.pp_bigheadlines_text');
        var img = bgImage(box, ['.js-pp-archive-image', '.pp_bigheadlines_image']);
        if (!img) img = htmlImageNear(a, ['img[src*="presspage.com"]', 'img[src]']);
        out.push({
          title: title,
          link: url,
          summary: sum ? stripHtml(sum.textContent).slice(0, 400) : '',
          image: absUrl(img, base),
          date: date
        });
      });
      return out;
    },

    // 通用：匹配 linkPattern 的链接取标题
    generic: function (doc, base, src) {
      var out = [];
      var pattern = src.linkPattern || 'a[href]';
      var as = doc.querySelectorAll(pattern);
      Array.prototype.forEach.call(as, function (a) {
        var title = stripHtml(a.textContent || '');
        if (!title || title.length < 8) return;
        out.push({
          title: title,
          link: absUrl(a.getAttribute('href'), base),
          summary: '',
          image: absUrl(htmlImageNear(a, ['img[src]']), base),
          date: nearestDate(a.closest('div, article, li') || a)
        });
      });
      return out;
    }
  };

  window.parseHtml = function (htmlText, src) {
    var doc = new DOMParser().parseFromString(
      sliceToDocument(htmlText, ['<!DOCTYPE', '<html', '<body', '<div', '<article']),
      'text/html');
    var parser = PARSERS[src.parser] || PARSERS.generic;
    var items = parser(doc, src.home || src.url, src) || [];
    // 去重 + 过滤掉导航类短链接
    var seen = {};
    return items.filter(function (it) {
      if (!it.title || !it.link) return false;
      if (seen[it.link]) return false;
      seen[it.link] = 1;
      return true;
    });
  };

  /* ---------------- 统一抓取某个源 ---------------- */

  window.fetchSource = function (src, attempt) {
    attempt = attempt || 0;
    return window.fetchText(src.url).then(function (res) {
      var items = src.type === 'rss'
        ? window.parseFeed(res.text)
        : window.parseHtml(res.text, src);
      return { source: src, items: items, via: res.via, cached: !!res.cached };
    }, function (err) {
      // 整条链都失败时，隔一会儿再来一次
      if (attempt >= 1) throw err;
      return new Promise(function (resolve) {
        setTimeout(resolve, 2500);
      }).then(function () {
        return window.fetchSource(src, attempt + 1);
      });
    });
  };

  window.clearCache = function () {
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf(CACHE_PREFIX) === 0) localStorage.removeItem(k);
      });
    } catch (e) { /* ignore */ }
    memCache = {};
  };

  /* ---------------- 公共 UI：导航 / 页脚 ---------------- */

  window.mountChrome = function (active) {
    var nav = [
      { id: 'home', label: '首页', href: 'index.html' },
      { id: 'news', label: '订阅', href: 'news.html' },
      { id: 'weather', label: '天气', href: 'weather.html' },
      { id: 'about', label: '关于', href: 'about.html' }
    ];
    var bar = document.createElement('header');
    bar.className = 'topbar';
    bar.innerHTML =
      '<div class="topbar-inner">' +
        '<a class="brand" href="index.html"><span class="dot"></span>' +
          window.esc(CFG.profile.title || 'Personal') + '</a>' +
        '<nav class="nav">' +
          nav.map(function (n) {
            return '<a href="' + n.href + '"' + (n.id === active ? ' class="active"' : '') +
              '>' + n.label + '</a>';
          }).join('') +
        '</nav>' +
      '</div>';
    document.body.insertBefore(bar, document.body.firstChild);

    var foot = document.createElement('footer');
    foot.className = 'foot';
    foot.innerHTML =
      '<span>' + window.esc(CFG.profile.name || 'Personal') + ' · ' +
        new Date().getFullYear() + '</span>' +
      '<span>天气数据来自 Open-Meteo · 资讯来自各站官方 RSS / 页面</span>';
    var wrap = document.querySelector('.wrap');
    if (wrap) wrap.appendChild(foot);
  };

  window.renderHero = function (host) {
    var p = CFG.profile;
    var links = (p.links || []).map(function (l) {
      return '<a href="' + window.esc(l.url) + '" target="_blank" rel="noopener">' +
        window.esc(l.label) + '</a>';
    }).join('');
    var av = p.avatar
      ? '<img src="' + window.esc(p.avatar) + '" alt="' + window.esc(p.name) + '">'
      : window.esc((p.name || 'P').trim().charAt(0).toUpperCase());
    host.className = 'hero card';
    host.innerHTML =
      '<div>' +
        '<h1>' + window.esc(p.name || '你的名字') + '</h1>' +
        '<p>' + window.esc(p.tagline || p.bio || '') + '</p>' +
        '<div class="hero-links">' + links + '</div>' +
      '</div>' +
      '<div class="avatar-box"><div class="avatar">' + av + '</div></div>';
  };
})();
