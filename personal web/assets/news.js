/* ==========================================================
   资讯流渲染（首页 + 订阅页共用）
   ========================================================== */

(function () {
  'use strict';

  var CFG = window.SITE;

  function itemHtml(it, src) {
    var when = it.date
      ? '<time datetime="' + window.esc(window.fmtDate(it.date)) + '">' +
        window.esc(window.relTime(it.date)) + '</time>'
      : '<time>—</time>';

    var thumb = it.image
      ? '<a class="thumb" href="' + window.esc(it.link) + '" target="_blank" rel="noopener">' +
          '<img src="' + window.esc(it.image) + '" alt="" loading="lazy" decoding="async" ' +
            'referrerpolicy="no-referrer" ' +
            'onerror="this.closest(\'.thumb\').classList.add(\'broken\');this.remove();">' +
        '</a>'
      : '<a class="thumb no-img" href="' + window.esc(it.link) + '" target="_blank" rel="noopener" ' +
          'aria-hidden="true"><span>' + window.esc((src.name || '?').trim().charAt(0).toUpperCase()) + '</span></a>';

    return '<article class="feed-item" style="--src-accent:' + window.esc(src.accent || '#6ea8ff') + '">' +
      thumb +
      '<div class="body">' +
        '<a class="title" href="' + window.esc(it.link) + '" target="_blank" rel="noopener">' +
          window.esc(it.title) + '</a>' +
        '<div class="title-zh" data-zh-for="' + window.esc(it.title) + '"></div>' +
        (it.summary ? '<p class="summary">' + window.esc(it.summary) + '</p>' : '') +
        '<div class="src"><b>' + window.esc(src.name) + '</b><span>·</span>' + when +
          '<span>·</span><span>' + window.esc(src.desc || '') + '</span></div>' +
      '</div>' +
    '</article>';
  }

  function skeletons(n) {
    var out = '';
    for (var i = 0; i < (n || 4); i++) out += '<div class="skeleton"></div>';
    return out;
  }

  /** 给已渲染的条目补上中文译文（逐条回填，不阻塞首屏） */
  function applyTranslations(host) {
    if (!window.translateBatch) return Promise.resolve();
    var slots = window.$$('.title-zh', host);
    if (!slots.length) return Promise.resolve();

    var titles = [];
    slots.forEach(function (el) {
      var t = el.getAttribute('data-zh-for');
      if (t && titles.indexOf(t) < 0) titles.push(t);
    });

    return window.translateBatch(titles, function (text, zh) {
      if (!zh) return;
      slots.forEach(function (el) {
        if (el.getAttribute('data-zh-for') === text && !el.textContent.trim()) {
          el.textContent = zh;
        }
      });
    });
  }

  /**
   * 并发抓取所有源，按时间倒序合并。
   * @param {HTMLElement} host 列表容器
   * @param {object} opts { limit, groupBy }
   */
  window.renderNews = function (host, opts) {
    opts = opts || {};
    var limit = opts.limit || 0;
    var sources = CFG.sources || [];

    host.innerHTML = skeletons(4);

    var failed = [];
    var viaNote = [];

    return Promise.all(sources.map(function (src) {
      return window.fetchSource(src).then(function (res) {
        viaNote.push(src.name + ' ← ' + res.via);
        return { src: src, items: res.items };
      }, function (err) {
        failed.push({ src: src, err: err });
        return { src: src, items: [] };
      });
    })).then(function (results) {
      var all = [];
      results.forEach(function (r) {
        r.items.forEach(function (it) { all.push({ item: it, src: r.src }); });
      });
      all.sort(function (a, b) {
        var ta = a.item.date ? a.item.date.getTime() : 0;
        var tb = b.item.date ? b.item.date.getTime() : 0;
        return tb - ta;
      });
      if (limit) all = all.slice(0, limit);

      host.innerHTML = '';

      if (failed.length) {
        var names = failed.map(function (f) { return f.src.name; }).join('、');
        var note = document.createElement('div');
        note.className = 'notice';
        note.innerHTML = '以下源暂时抓不到：<b>' + window.esc(names) +
          '</b>。公共代理经常抽风，稍后点刷新重试；' +
          '若长期失败，可在 <code>assets/config.js</code> 的 <code>fetch.proxies</code> 里换成你自己的代理地址。';
        host.appendChild(note);
      }

      if (!all.length) {
        var st = document.createElement('div');
        st.className = 'state';
        st.innerHTML = '<div class="big">📡</div>暂时没抓到内容。<br>公共 CORS 代理不稳定，稍后再试或换代理地址。';
        host.appendChild(st);
        return;
      }

      if (opts.groupBy) {
        sources.forEach(function (src) {
          var mine = all.filter(function (x) { return x.src.id === src.id; });
          if (!mine.length) return;
          var h = document.createElement('div');
          h.className = 'section-head';
          h.style.marginTop = '26px';
          h.innerHTML = '<h2>' + window.esc(src.name) + '</h2>' +
            '<span class="hint">' + mine.length + ' 条 · ' +
            window.esc(src.desc || '') + '</span>';
          host.appendChild(h);

          var list = document.createElement('div');
          list.className = 'feed';
          list.innerHTML = mine.map(function (x) { return itemHtml(x.item, x.src); }).join('');
          host.appendChild(list);
        });
      } else {
        var list2 = document.createElement('div');
        list2.className = 'feed';
        list2.innerHTML = all.map(function (x) { return itemHtml(x.item, x.src); }).join('');
        host.appendChild(list2);
      }

      return { total: all.length, failed: failed.length, via: viaNote };
    }).then(function (info) {
      applyTranslations(host);
      return info;
    });
  };

  /* ---------------- 源卡片 ---------------- */

  window.renderSourceCards = function (host) {
    host.innerHTML = (CFG.sources || []).map(function (s) {
      return '<div class="source-card card" style="--src-accent:' + window.esc(s.accent || '#6ea8ff') + '">' +
        '<h3>' + window.esc(s.name) + '</h3>' +
        '<p>' + window.esc(s.desc || '') + '</p>' +
        '<div class="meta">' +
          '<span>' + (s.type === 'rss' ? 'RSS' : '网页解析') + '</span>' +
          '<a href="' + window.esc(s.home || s.url) + '" target="_blank" rel="noopener">访问官网 ↗</a>' +
        '</div>' +
      '</div>';
    }).join('');
  };
})();
