/* ==========================================================
   标题翻译（MyMemory 公共接口）
   - 译文缓存在 localStorage，长期不过期
   - 失败就只显示英文原文，不影响阅读
   ========================================================== */

(function () {
  'use strict';

  var CFG = window.SITE;
  var TR = CFG.translate || {};

  var CACHE_PREFIX = 'pw:tr:';
  var mem = {};

  /**
   * 翻译接口优先级：
   * 1. config 里显式写的 translate.endpoint
   * 2. 自建 Worker 的 /translate（有缓存，译文长期有效，不吃公共接口额度）
   * 3. MyMemory 公共接口
   */
  function resolveEndpoint() {
    if (TR.endpoint) return TR.endpoint;
    var wp = CFG.fetch && CFG.fetch.workerProxy;
    if (wp) {
      try {
        var u = new URL(wp);
        u.pathname = '/translate';
        u.search = '';
        return u.toString();
      } catch (e) { /* 用公共接口兜底 */ }
    }
    return 'https://api.mymemory.translated.net/get';
  }

  function cacheKey(text) {
    return CACHE_PREFIX + (CFG.translate.langpair || 'en|zh-CN') + ':' + text;
  }

  function cacheGet(text) {
    if (mem[text] !== undefined) return mem[text];
    var v = null;
    try {
      v = localStorage.getItem(cacheKey(text));
    } catch (e) { v = null; }
    mem[text] = v;
    return v;
  }

  function cacheSet(text, value) {
    mem[text] = value;
    try {
      localStorage.setItem(cacheKey(text), value);
    } catch (e) { /* 配额满了就算了 */ }
  }

  /** 翻译一句话，失败返回 null */
  window.translateText = function (text, attempt) {
    if (!text) return Promise.resolve(null);
    if (TR.enabled === false) return Promise.resolve(null);

    var hit = cacheGet(text);
    if (hit) return Promise.resolve(hit);

    attempt = attempt || 0;

    var endpoint = resolveEndpoint();
    var langpair = TR.langpair || 'en|zh-CN';
    var sep = endpoint.indexOf('?') >= 0 ? '&' : '?';
    var url = endpoint + sep + 'q=' + encodeURIComponent(text) + '&langpair=' + encodeURIComponent(langpair);
    if (TR.email) url += '&de=' + encodeURIComponent(TR.email);

    return fetch(url, { mode: 'cors' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (json) {
      if (!json || !json.responseData) throw new Error('翻译服务无响应');
      var zh = json.responseData.translatedText;
      if (!zh) throw new Error('译文为空');
      // 服务端有时会返回状态说明而不是译文
      if (/MYMEMORY WARNING|INVALID LANGUAGE|QUERY LENGTH LIMIT/i.test(zh)) {
        throw new Error('翻译额度或参数受限');
      }
      cacheSet(text, zh);
      return zh;
    }).catch(function () {
      // 公共接口会限流，退避后重试两次
      var maxRetry = TR.retry || 2;
      if (attempt >= maxRetry) return null;
      var wait = 700 * Math.pow(2, attempt);
      return new Promise(function (resolve) {
        setTimeout(function () {
          window.translateText(text, attempt + 1).then(resolve);
        }, wait);
      });
    });
  };

  /**
   * 批量翻译，带并发限制。
   * @param {string[]} texts
   * @param {function} onEach (text, translated|null) 每完成一条回调
   */
  window.translateBatch = function (texts, onEach) {
    var limit = TR.concurrency || 3;
    var queue = [];
    var seen = {};

    texts.forEach(function (t) {
      if (!t || seen[t]) return;
      seen[t] = 1;
      if (cacheGet(t)) {
        if (onEach) onEach(t, cacheGet(t));
        return;
      }
      queue.push(t);
    });

    var index = 0;
    function worker() {
      if (index >= queue.length) return Promise.resolve();
      var text = queue[index++];
      return window.translateText(text).then(function (zh) {
        if (onEach) onEach(text, zh);
        return worker();
      });
    }

    var runners = [];
    for (var i = 0; i < Math.min(limit, queue.length); i++) runners.push(worker());
    return Promise.all(runners);
  };
})();
