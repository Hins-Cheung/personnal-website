/* ==========================================================
   天气模块 · 由 F1 官方赛历驱动
   - 过去的分站：Open-Meteo 历史归档（实际观测）
   - 未来 15 天内的分站：Open-Meteo 预报
   - 更远的分站：只显示赛道当前实况
   ========================================================== */

(function () {
  'use strict';

  /* ---------------- WMO 天气代码 ---------------- */

  var WMO = {
    0: ['晴', '☀️'], 1: ['大部晴朗', '🌤️'], 2: ['多云', '⛅'], 3: ['阴', '☁️'],
    45: ['雾', '🌫️'], 48: ['雾凇', '🌫️'],
    51: ['小毛毛雨', '🌦️'], 53: ['毛毛雨', '🌦️'], 55: ['浓毛毛雨', '🌧️'],
    56: ['冻毛毛雨', '🌧️'], 57: ['强冻毛毛雨', '🌧️'],
    61: ['小雨', '🌦️'], 63: ['中雨', '🌧️'], 65: ['大雨', '🌧️'],
    66: ['冻雨', '🌧️'], 67: ['强冻雨', '🌧️'],
    71: ['小雪', '🌨️'], 73: ['中雪', '🌨️'], 75: ['大雪', '❄️'], 77: ['雪粒', '🌨️'],
    80: ['阵雨', '🌦️'], 81: ['强阵雨', '🌧️'], 82: ['暴雨', '⛈️'],
    85: ['阵雪', '🌨️'], 86: ['强阵雪', '❄️'],
    95: ['雷阵雨', '⛈️'], 96: ['雷阵雨伴冰雹', '⛈️'], 99: ['强雷暴伴冰雹', '⛈️']
  };

  window.wmoLabel = function (code) {
    var w = WMO[code];
    return w ? w[0] : '未知';
  };
  window.wmoIcon = function (code) {
    var w = WMO[code];
    return w ? w[1] : '❓';
  };

  window.aqiLevel = function (v) {
    if (v == null || isNaN(v)) return { label: '—', cls: '' };
    if (v <= 50) return { label: '优', cls: 'good' };
    if (v <= 100) return { label: '良', cls: 'good' };
    if (v <= 150) return { label: '轻度污染', cls: 'mid' };
    if (v <= 200) return { label: '中度污染', cls: 'mid' };
    if (v <= 300) return { label: '重度污染', cls: 'bad' };
    return { label: '严重污染', cls: 'bad' };
  };

  window.uvLevel = function (v) {
    if (v == null || isNaN(v)) return { label: '—', cls: '' };
    if (v < 3) return { label: '低', cls: 'good' };
    if (v < 6) return { label: '中等', cls: 'mid' };
    if (v < 8) return { label: '高', cls: 'mid' };
    if (v < 11) return { label: '很高', cls: 'bad' };
    return { label: '极高', cls: 'bad' };
  };

  /* ---------------- 日期工具 ---------------- */

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function addDays(str, n) {
    var p = str.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  var WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  function weekdayOf(str) {
    var p = str.split('-');
    return WEEK[new Date(+p[0], +p[1] - 1, +p[2]).getDay()];
  }

  /* ---------------- Open-Meteo 请求 ---------------- */

  var FORECAST = 'https://api.open-meteo.com/v1/forecast';
  var ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
  var AIRQUALITY = 'https://air-quality-api.open-meteo.com/v1/air-quality';

  var DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,uv_index_max,sunrise,sunset';
  var CURRENT = 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,precipitation';

  function getJson(url) {
    return fetch(url, { mode: 'cors' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /** 某段日期的逐日数据：过去的走归档，未来的走预报 */
  window.fetchDaily = function (lat, lon, dates) {
    var today = todayStr();
    var past = dates.filter(function (d) { return d < today; });
    var future = dates.filter(function (d) { return d >= today; });

    var jobs = [];

    if (past.length) {
      var pMin = past.slice().sort()[0];
      var pMax = past.slice().sort().reverse()[0];
      jobs.push(getJson(ARCHIVE + '?latitude=' + lat + '&longitude=' + lon +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto' +
        '&start_date=' + pMin + '&end_date=' + pMax).then(function (j) {
          return { source: 'archive', json: j };
        }));
    }

    if (future.length) {
      var fMin = future.slice().sort()[0];
      var fMax = future.slice().sort().reverse()[0];
      jobs.push(getJson(FORECAST + '?latitude=' + lat + '&longitude=' + lon +
        '&daily=' + DAILY + '&current=' + CURRENT + '&timezone=auto' +
        '&start_date=' + fMin + '&end_date=' + fMax).then(function (j) {
          return { source: 'forecast', json: j };
        }, function (err) {
          // 超出预报窗口（太远）时静默降级
          return { source: 'forecast', error: err };
        }));
    }

    return Promise.all(jobs).then(function (parts) {
      var byDate = {};
      parts.forEach(function (p) {
        if (!p.json || !p.json.daily) return;
        var d = p.json.daily;
        d.time.forEach(function (t, i) {
          byDate[t] = {
            code: d.weather_code[i],
            tmax: d.temperature_2m_max[i],
            tmin: d.temperature_2m_min[i],
            pop: d.precipitation_probability_max ? d.precipitation_probability_max[i] : null,
            precip: d.precipitation_sum ? d.precipitation_sum[i] : null,
            uv: d.uv_index_max ? d.uv_index_max[i] : null
          };
        });
        if (p.source === 'forecast' && p.json.current) {
          byDate.__current = p.json.current;
        }
      });
      return byDate;
    });
  };

  /** 当前实况 */
  window.fetchCurrent = function (lat, lon) {
    return getJson(FORECAST + '?latitude=' + lat + '&longitude=' + lon +
      '&current=' + CURRENT + '&timezone=auto');
  };

  /** 空气质量 + 当前紫外线 */
  window.fetchAir = function (lat, lon) {
    return getJson(AIRQUALITY + '?latitude=' + lat + '&longitude=' + lon +
      '&current=pm2_5,pm10,us_aqi,european_aqi,uv_index&timezone=auto');
  };

  /* ---------------- 渲染：单个分站卡片 ---------------- */

  function roundMeta(r) {
    var labels = (window.SITE.raceLabels || {})[r.slug] || {};
    return {
      title: labels.title || r.city || r.circuit,
      place: labels.place || r.city || '',
      gp: labels.gp || ''
    };
  }

  window.renderRound = function (round) {
    var meta = roundMeta(round);
    var today = todayStr();
    var dates = round.sessions || [];

    var card = document.createElement('article');
    card.className = 'round-card card';
    card.style.setProperty('--src-accent', '#6ea8ff');

    var head =
      '<div class="round-head">' +
        '<div>' +
          '<span class="round-no">R' + round.round + '</span>' +
          '<h3 class="round-title">' + window.esc(meta.title) + '</h3>' +
          '<div class="round-sub">' + window.esc(round.circuit) +
            (meta.place ? ' · ' + window.esc(meta.place) : '') + '</div>' +
        '</div>' +
        '<div class="round-date">' + window.esc(round.raceDate) +
          '<span>' + window.esc(weekdayOf(round.raceDate)) + '</span></div>' +
      '</div>';

    card.innerHTML = head + '<div class="round-days"><div class="skeleton" style="height:52px"></div></div>';

    var daysBox = card.querySelector('.round-days');
    var chipsBox = document.createElement('div');
    chipsBox.className = 'chips';
    card.appendChild(chipsBox);

    var p = Promise.all([
      window.fetchCurrent(round.lat, round.lon),
      window.fetchAir(round.lat, round.lon),
      dates.length ? window.fetchDaily(round.lat, round.lon, dates) : Promise.resolve({})
    ]).then(function (res) {
      var cur = res[0] && res[0].current ? res[0].current : null;
      var air = res[1] && res[1].current ? res[1].current : null;
      var daily = res[2] || {};

      // 逐日
      var html = dates.map(function (d) {
        var w = daily[d];
        var isRace = d === round.raceDate;
        if (!w) {
          return '<div class="day' + (isRace ? ' race' : '') + '">' +
            '<div class="dw">' + window.esc(d.slice(5)) + ' ' + window.esc(weekdayOf(d)) + '</div>' +
            '<div class="ic">·</div><div class="na">暂无预报</div></div>';
        }
        var pc = (w.pop != null && w.pop !== 0) ? '<div class="pc">' + w.pop + '%</div>' : '';
        return '<div class="day' + (isRace ? ' race' : '') + '">' +
          '<div class="dw">' + window.esc(d.slice(5)) + ' ' + window.esc(weekdayOf(d)) + '</div>' +
          '<div class="ic">' + window.wmoIcon(w.code) + '</div>' +
          '<div class="hi">' + Math.round(w.tmax) + '°</div>' +
          '<div class="lo">' + Math.round(w.tmin) + '°</div>' + pc +
          '</div>';
      }).join('');

      if (!dates.length) {
        html = '<div class="na" style="grid-column:1/-1">该站暂无赛程</div>';
      } else if (dates.every(function (d) { return !daily[d]; })) {
        html = '<div class="na" style="grid-column:1/-1">距离比赛还有较长时间，逐日预报尚未发布（Open-Meteo 预报窗口约 15 天）</div>';
      }
      daysBox.innerHTML = html;

      // 实况 chips
      var chips = [];
      if (cur) {
        chips.push('<span class="chip">当前 <b>' + Math.round(cur.temperature_2m) + '°</b> ' +
          window.wmoIcon(cur.weather_code) + ' ' + window.esc(window.wmoLabel(cur.weather_code)) + '</span>');
        chips.push('<span class="chip">体感 <b>' + Math.round(cur.apparent_temperature) + '°</b></span>');
        chips.push('<span class="chip">风速 <b>' + Math.round(cur.wind_speed_10m) + ' km/h</b></span>');
        chips.push('<span class="chip">湿度 <b>' + Math.round(cur.relative_humidity_2m) + '%</b></span>');
      }
      if (air) {
        var aqi = air.us_aqi != null ? air.us_aqi : air.european_aqi;
        var al = window.aqiLevel(aqi);
        chips.push('<span class="chip ' + al.cls + '">AQI <b>' + (aqi == null ? '—' : Math.round(aqi)) + '</b> ' + al.label + '</span>');
        var uv = air.uv_index;
        var ul = window.uvLevel(uv);
        chips.push('<span class="chip ' + ul.cls + '">UV <b>' + (uv == null ? '—' : Math.round(uv)) + '</b> ' + ul.label + '</span>');
        if (air.pm2_5 != null) chips.push('<span class="chip">PM2.5 <b>' + Math.round(air.pm2_5) + '</b> μg/m³</span>');
      }
      chipsBox.innerHTML = chips.join('');
    }).catch(function (err) {
      daysBox.innerHTML = '<div class="na" style="grid-column:1/-1">天气数据获取失败：' +
        window.esc(err && err.message ? err.message : err) + '</div>';
    });

    card.__promise = p;
    return card;
  };

  /* ---------------- 渲染：赛历天气列表 ---------------- */

  window.renderCalendarWeather = function (host, opts) {
    opts = opts || {};
    var cal = window.F1_CALENDAR;
    if (!cal || !cal.rounds) {
      host.innerHTML = '<div class="state"><div class="big">🏁</div>赛历数据未加载。</div>';
      return Promise.resolve([]);
    }

    var today = todayStr();
    var all = cal.rounds;
    var rounds;

    if (opts.all) {
      rounds = all.slice();
    } else {
      // 默认：即将到来的 3 站 + 刚刚结束的 1 站
      var upcoming = all.filter(function (r) { return r.raceDate >= today; });
      var past = all.filter(function (r) { return r.raceDate < today; });
      rounds = past.slice(-1).concat(upcoming.slice(0, opts.count || 3));
    }

    host.innerHTML = '';
    if (!rounds.length) {
      host.innerHTML = '<div class="state"><div class="big">🏁</div>本季赛程已全部结束。</div>';
      return Promise.resolve([]);
    }

    var cards = rounds.map(function (r) {
      var c = window.renderRound(r);
      host.appendChild(c);
      return c;
    });
    return Promise.all(cards.map(function (c) { return c.__promise; })).then(function () { return cards; });
  };

  /* ---------------- 渲染：自定义城市 ---------------- */

  window.renderCityCard = function (city) {
    var card = document.createElement('article');
    card.className = 'city-card card';
    card.innerHTML = '<div class="city-head"><div><h3 class="city-name">' +
      window.esc(city.name) + '</h3><div class="city-sub">正在获取…</div></div></div>' +
      '<div class="skeleton" style="height:110px"></div>';

    var sub = card.querySelector('.city-sub');
    var body = card.querySelector('.skeleton');

    var p = Promise.all([
      window.fetchCurrent(city.lat, city.lon),
      window.fetchAir(city.lat, city.lon)
    ]).then(function (res) {
      var cur = res[0] && res[0].current ? res[0].current : null;
      var air = res[1] && res[1].current ? res[1].current : null;
      if (!cur) throw new Error('无数据');
      sub.textContent = (city.country || '') + ' · ' + city.lat.toFixed(2) + ', ' + city.lon.toFixed(2);
      var chips = [];
      var aqi = air && (air.us_aqi != null ? air.us_aqi : air.european_aqi);
      var al = window.aqiLevel(aqi);
      var uv = air && air.uv_index;
      var ul = window.uvLevel(uv);
      chips.push('<span class="chip">体感 <b>' + Math.round(cur.apparent_temperature) + '°</b></span>');
      chips.push('<span class="chip">风速 <b>' + Math.round(cur.wind_speed_10m) + ' km/h</b></span>');
      chips.push('<span class="chip">湿度 <b>' + Math.round(cur.relative_humidity_2m) + '%</b></span>');
      chips.push('<span class="chip ' + al.cls + '">AQI <b>' + (aqi == null ? '—' : Math.round(aqi)) + '</b> ' + al.label + '</span>');
      chips.push('<span class="chip ' + ul.cls + '">UV <b>' + (uv == null ? '—' : Math.round(uv)) + '</b> ' + ul.label + '</span>');
      body.outerHTML =
        '<div class="city-main">' +
          '<div class="city-temp">' + Math.round(cur.temperature_2m) + '<sup>°C</sup></div>' +
          '<div class="city-cond">' + window.wmoIcon(cur.weather_code) + ' ' +
            window.esc(window.wmoLabel(cur.weather_code)) + '</div>' +
        '</div>' +
        '<div class="chips">' + chips.join('') + '</div>';
    }).catch(function (err) {
      body.outerHTML = '<div class="state">获取失败：' +
        window.esc(err && err.message ? err.message : err) + '</div>';
    });

    card.__promise = p;
    return card;
  };

  window.renderCities = function (host) {
    var cities = (window.SITE.cities || []);
    host.innerHTML = '';
    if (!cities.length) {
      host.innerHTML = '<div class="state"><div class="big">🌍</div>没有配置城市。</div>';
      return Promise.resolve([]);
    }
    var cards = cities.map(function (c) {
      if (c.lat == null || c.lon == null) {
        return window.geocodeCity(c.name).then(function (g) {
          c.lat = g.lat; c.lon = g.lon; c.country = g.country;
          return window.renderCityCard(c);
        });
      }
      return window.renderCityCard(c);
    });
    return Promise.all(cards).then(function (list) {
      list.forEach(function (c) { host.appendChild(c); });
      return list;
    });
  };

  /* ---------------- 地理编码 ---------------- */

  window.geocodeCity = function (name) {
    var url = 'https://geocoding-api.open-meteo.com/v1/search?name=' +
      encodeURIComponent(name) + '&count=1&language=zh&format=json';
    return getJson(url).then(function (j) {
      if (!j.results || !j.results.length) throw new Error('找不到城市：' + name);
      var r = j.results[0];
      return {
        lat: r.latitude,
        lon: r.longitude,
        country: r.country || '',
        name: r.name
      };
    });
  };
})();
