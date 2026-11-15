/* nasa-bridge.js — connects the design's charts to real NASA/NOAA data.
 *
 * Every Trend Lab / Map page computes its charts through one function,
 * seriesFor(layer, place, lat, lon). We wrap it: the first time a series is
 * needed we ask Python (app.py, through the Streamlit component protocol) for
 * the real record, show the design's built-in values meanwhile, and redraw
 * when the real numbers arrive. Charts are tagged "NASA record" when real.
 *
 * Without Streamlit (e.g. `python -m http.server`) the pages still work,
 * using the design's built-in values.
 */
(function () {
  "use strict";
  var RESULTS = {};   // key -> { years: {1981: v, ...}, unit, src } | { none: true } | { error: "..." }
  var QUEUE = {};     // key -> request waiting to be sent
  var ASKED = {};     // key -> true once sent to Python
  var LIVE = {};      // key|Y0|Y1 -> built series object (stable identity for the page)
  var inStreamlit = false, flushTimer = null;
  var parentWin = window.parent !== window ? window.parent : null;

  /* ---------- Streamlit component protocol (no extra libraries needed) ---------- */
  function post(type, extra) {
    if (!parentWin) return;
    var msg = { isStreamlitMessage: true, type: type };
    for (var k in extra) msg[k] = extra[k];
    parentWin.postMessage(msg, "*");
  }
  window.addEventListener("message", function (ev) {
    var d = ev.data;
    if (!d || d.type !== "streamlit:render") return;
    inStreamlit = true;
    allowScroll();
    var res = (d.args && d.args.results) || {}, changed = false;
    for (var k in res) if (RESULTS[k] === undefined || JSON.stringify(RESULTS[k]) !== JSON.stringify(res[k])) { RESULTS[k] = res[k]; changed = true; }
    if (changed) { LIVE = {}; if (window.DCLite) window.DCLite.refreshAll(); }
    // Anything asked for but not answered (e.g. a page loaded before Streamlit replied) is re-sent.
    for (var q in ASKED) if (RESULTS[q] === undefined && !QUEUE[q]) QUEUE[q] = ASKED[q];
    scheduleFlush();
    status();
  });
  // Streamlit puts components in an <iframe scrolling="no">, which blocks the
  // mouse wheel. The frame is same-origin, so we switch scrolling back on.
  function allowScroll() {
    try {
      var fe = window.frameElement;
      if (fe && fe.getAttribute("scrolling") !== "auto") fe.setAttribute("scrolling", "auto");
    } catch (e) { /* not same-origin: nothing to do */ }
  }
  allowScroll();
  window.addEventListener("load", allowScroll);
  post("streamlit:componentReady", { apiVersion: 1 });
  function sendHeight() { post("streamlit:setFrameHeight", { height: Math.max(600, window.innerHeight || 800) }); }
  window.addEventListener("load", sendHeight); window.addEventListener("resize", sendHeight);

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(function () {
      flushTimer = null;
      if (!inStreamlit) return;
      var reqs = [];
      for (var k in QUEUE) { reqs.push(QUEUE[k]); ASKED[k] = QUEUE[k]; }
      QUEUE = {};
      if (reqs.length) post("streamlit:setComponentValue", { value: { id: Date.now() + "-" + Math.random().toString(36).slice(2, 8), requests: reqs }, dataType: "json" });
      status();
    }, 150);
  }

  /* ---------- where is the series for? ---------- */
  function r2(x) { return Math.round(x * 2) / 2; } // 0.5° grid ≈ NASA POWER resolution
  function locate(placeId, lat, lon, get) {
    var id = String(placeId || "");
    if (id === "global") return { place: "global", lat: 0, lon: 0 };
    if (id.indexOf("R:") === 0) {
      var regById = get("regById"), regCenter = get("regCenter"), r = regById && regById(id);
      if (!r) return null; var c = regCenter(r); return { place: id, name: r.en, lat: c[0], lon: c[1] };
    }
    var places = get("PLACES") || [], p = places.filter(function (x) { return x.id === id; })[0];
    if (p) return { place: p.id, name: p.en && p.en.name, lat: p.lat, lon: p.lon };
    if (typeof lat === "number" && typeof lon === "number" && isFinite(lat) && isFinite(lon)) return { place: "pin", lat: lat, lon: lon };
    return null;
  }
  function keyOf(layer, loc) {
    if (loc.place === "global" || loc.place === "arctic") return layer + "|" + loc.place;
    if (layer === "co2") return "co2|global";           // CO₂ is well mixed: one record for every place
    return layer + "|" + r2(loc.lat) + "," + r2(loc.lon);
  }

  /* ---------- turn {year: value} into the design's ys[] (Y0..Y1) ---------- */
  function align(years, Y0, Y1) {
    var ys = [], have = [];
    for (var y = Y0; y <= Y1; y++) { var v = years[y]; ys.push(v == null ? null : +v); if (v != null) have.push(y); }
    if (!have.length) return null;
    var first = have[0], last = have[have.length - 1];
    for (var i = 0; i < ys.length; i++) {
      var yr = Y0 + i;
      if (ys[i] != null) continue;
      if (yr < first) ys[i] = ys[first - Y0];
      else if (yr > last) ys[i] = ys[last - Y0];
      else { // interior gap: straight line between neighbours
        var a = i - 1; while (ys[a] == null) a--; var b = i + 1; while (ys[b] == null) b++;
        ys[i] = ys[a] + (ys[b] - ys[a]) * (i - a) / (b - a);
      }
    }
    return { ys: ys, first: first, last: last };
  }

  function wrap(orig, get) {
    return function (layer, placeId, lat, lon) {
      var extra = !!EXTRA_IDS[layer];
      var base = extra ? null : orig.apply(this, arguments);
      if (!base && !extra) return base;       // the design shows no data for this layer here
      var loc = locate(placeId, lat, lon, get);
      if (!loc) return base;
      if (extra && loc.place === "global") return null;   // POWER is point data, no planet average
      var key = keyOf(layer, loc), r = RESULTS[key];
      if (r === undefined) {
        if (!ASKED[key] && !QUEUE[key]) { QUEUE[key] = { key: key, layer: layer, place: loc.place, lat: loc.lat, lon: loc.lon, name: loc.name || "" }; scheduleFlush(); }
        return base;
      }
      if (!r || r.none || r.error || !r.years) return base;
      var Y0 = get("Y0"), Y1 = get("Y1"), ck = key + "|" + Y0 + "|" + Y1;
      if (LIVE[ck]) return LIVE[ck];
      var al = align(r.years, Y0, Y1);
      if (!al) return base;
      if (extra) { var LYR = get("LY_RANGE"); if (LYR) LYR[layer] = [Math.max(Y0, al.first), Math.min(Y1, al.last)]; }
      var span = al.first + "–" + al.last;
      var note = (al.first > Y0 || al.last < Y1) ? " · record " + span + ", outside years held at nearest value" : "";
      return (LIVE[ck] = { ys: al.ys, real: true, unit: r.unit != null ? r.unit : (base ? base.unit : ""), src: (r.src || "NASA") + note, live: true });
    };
  }

  /* ---------- extra NASA POWER parameters for Trend Lab ----------
   * id "p_<POWER name>". Real data only: a parameter appears in the menu once
   * NASA has returned values for the chosen place (POWER covers any point on
   * Earth, but not "Whole planet").
   * [POWER name, category, English, Arabic, kid English, kid Arabic] */
  var EXTRA = [
    ["T2M_MAX", "atmosphere", "Max air temperature", "أعلى درجة حرارة للهواء", "🔥 Hottest days", "🔥 أحرّ الأيام"],
    ["T2M_MIN", "atmosphere", "Min air temperature", "أدنى درجة حرارة للهواء", "❄️ Coldest nights", "❄️ أبرد الليالي"],
    ["T2M_RANGE", "atmosphere", "Daily temperature range", "المدى الحراري اليومي", "↕️ Day vs night", "↕️ الفرق بين النهار والليل"],
    ["T2MDEW", "atmosphere", "Dew point", "نقطة الندى", "💧 Dew point", "💧 نقطة الندى"],
    ["T2MWET", "atmosphere", "Wet-bulb temperature", "درجة الحرارة الرطبة", "🥵 Sticky heat", "🥵 الحر الرطب"],
    ["T10M", "atmosphere", "Air temperature at 10 m", "حرارة الهواء على ارتفاع 10 م", "🌡️ Air up high", "🌡️ هواء أعلى"],
    ["PS", "atmosphere", "Surface pressure", "الضغط الجوي السطحي", "🎈 Air pressure", "🎈 ضغط الهواء"],
    ["CLOUD_AMT", "atmosphere", "Cloud cover", "الغطاء السحابي", "☁️ Clouds", "☁️ الغيوم"],
    ["RH2M", "water", "Relative humidity", "الرطوبة النسبية", "💦 Wet air", "💦 رطوبة الهواء"],
    ["QV2M", "water", "Specific humidity", "الرطوبة النوعية", "💦 Water in air", "💦 الماء في الهواء"],
    ["PRECSNOLAND", "water", "Snowfall (land)", "تساقط الثلوج (اليابسة)", "🌨️ Snowfall", "🌨️ تساقط الثلج"],
    ["EVLAND", "water", "Evaporation (land)", "التبخر (اليابسة)", "♨️ Evaporation", "♨️ التبخر"],
    ["EVPTRNS", "water", "Evapotranspiration", "التبخر والنتح", "🌿 Plants breathing water", "🌿 تنفس النباتات للماء"],
    ["TS", "land", "Earth skin temperature", "حرارة سطح الأرض", "🪨 Ground warmth", "🪨 دفء الأرض"],
    ["GWETTOP", "land", "Surface soil wetness", "رطوبة التربة السطحية", "🟫 Wet topsoil", "🟫 رطوبة التربة"],
    ["GWETROOT", "land", "Root-zone soil wetness", "رطوبة تربة الجذور", "🌱 Water for roots", "🌱 ماء الجذور"],
    ["GWETPROF", "land", "Soil wetness (full profile)", "رطوبة التربة الكاملة", "🟫 Deep soil water", "🟫 ماء التربة العميق"],
    ["SNODP", "ice", "Snow depth", "عمق الثلج", "⛄ Snow depth", "⛄ عمق الثلج"],
    ["FRSNO", "ice", "Snow cover fraction", "نسبة الغطاء الثلجي", "⛄ Snow cover", "⛄ غطاء الثلج"],
    ["WS2M", "wind", "Wind speed at 2 m", "سرعة الرياح على 2 م", "🍃 Breeze", "🍃 النسيم"],
    ["WS2M_MAX", "wind", "Max wind speed at 2 m", "أقصى سرعة رياح على 2 م", "🌬️ Strong gusts", "🌬️ هبات قوية"],
    ["WS10M", "wind", "Wind speed at 10 m", "سرعة الرياح على 10 م", "🍃 Wind", "🍃 الرياح"],
    ["WS10M_MAX", "wind", "Max wind speed at 10 m", "أقصى سرعة رياح على 10 م", "🌬️ Strongest wind", "🌬️ أقوى رياح"],
    ["WS50M", "wind", "Wind speed at 50 m", "سرعة الرياح على 50 م", "🌀 High wind", "🌀 رياح عالية"],
    ["ALLSKY_SFC_SW_DWN", "sun", "Solar radiation (all sky)", "الإشعاع الشمسي (كل الأحوال)", "☀️ Sunshine", "☀️ أشعة الشمس"],
    ["CLRSKY_SFC_SW_DWN", "sun", "Solar radiation (clear sky)", "الإشعاع الشمسي (سماء صافية)", "☀️ Clear-sky sun", "☀️ شمس السماء الصافية"],
    ["ALLSKY_KT", "sun", "Clearness index", "مؤشر صفاء السماء", "🔆 Clear skies", "🔆 صفاء السماء"],
    ["ALLSKY_SFC_LW_DWN", "sun", "Longwave (heat) radiation", "الإشعاع طويل الموجة (الحراري)", "🔥 Heat from the sky", "🔥 حرارة من السماء"],
    ["ALLSKY_SFC_UV_INDEX", "sun", "UV index", "مؤشر الأشعة فوق البنفسجية", "🕶️ UV rays", "🕶️ الأشعة فوق البنفسجية"],
    ["ALLSKY_SFC_PAR_TOT", "sun", "Light for plants (PAR)", "الضوء المفيد للنباتات", "🌻 Light for plants", "🌻 ضوء للنباتات"],
    ["TOA_SW_DWN", "sun", "Sunlight at top of atmosphere", "الإشعاع الشمسي أعلى الغلاف الجوي", "🛰️ Sun reaching Earth", "🛰️ الشمس الواصلة للأرض"]
  ];
  var NEW_SPHERES = [
    { id: "wind", color: "#7a8fa6", en: "Wind", ar: "الرياح", kidEn: "🌬️ Wind", kidAr: "🌬️ الرياح" },
    { id: "sun", color: "#E0A33A", en: "Sun & radiation", ar: "الشمس والإشعاع", kidEn: "☀️ Sun", kidAr: "☀️ الشمس" }
  ];
  var EXTRA_IDS = {};
  EXTRA.forEach(function (e) { EXTRA_IDS["p_" + e[0]] = e[0]; });

  function addExtraLayers(get) {
    var LAYERS = get("LAYERS"), SPHERES = get("SPHERES"), IDS = get("LAYER_IDS2"), TXT = get("TXT"),
        LYR = get("LY_RANGE"), KID_LEG = get("KID_LEG"), SPHERE_KID = get("SPHERE_KID");
    if (!LAYERS || !SPHERES || !IDS || !TXT || LAYERS.p_T2M_MAX) return;
    NEW_SPHERES.forEach(function (n) {
      if (!SPHERES.some(function (s) { return s.id === n.id; })) SPHERES.push({ id: n.id, color: n.color, layers: [], en: n.en, ar: n.ar });
      if (SPHERE_KID && !SPHERE_KID[n.id]) SPHERE_KID[n.id] = { en: n.kidEn, ar: n.kidAr };
    });
    EXTRA.forEach(function (e) {
      var id = "p_" + e[0], sp = SPHERES.filter(function (s) { return s.id === e[1]; })[0];
      var col = sp ? sp.color : "#70B8A3";
      LAYERS[id] = { sphere: e[1], color: col, product: "NASA POWER · " + e[0], unit: "", u: "", range: [0, 1], dec: 2,
                     ramp: ["#f7f8f2", "#DDF1E7", "#70B8A3", "#1B7865", "#174F44"], blend: "normal", extra: true };
      if (sp && sp.layers.indexOf(id) < 0) sp.layers.push(id);
      if (IDS.indexOf(id) < 0) IDS.push(id);
      if (TXT.en && TXT.en.layers) TXT.en.layers[id] = e[2];
      if (TXT.ar && TXT.ar.layers) TXT.ar.layers[id] = e[3];
      if (TXT.en && TXT.en.layersKid) TXT.en.layersKid[id] = e[4];
      if (TXT.ar && TXT.ar.layersKid) TXT.ar.layersKid[id] = e[5];
      if (KID_LEG) KID_LEG[id] = { en: ["⬇️ lower", "⬆️ higher"], ar: ["⬇️ أقل", "⬆️ أعلى"] };
      if (LYR) LYR[id] = [1981, get("Y1") || 2025];
    });
  }

  /* ---------- real map grid (frontend/map_data.json, made by build_map_data.py) ---------- */
  var GRID = null, gridPromise = null;
  function loadGrid() {
    if (!gridPromise) gridPromise = fetch("map_data.json", { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { GRID = j && j.layers ? j : null; return GRID; })
      .catch(function () { return null; });
    return gridPromise;
  }
  function gridLayer(layer) { return GRID && GRID.layers[layer]; }
  var MAP_NOTE = {
    en: { real: "Real data: {src}. Each square is a 6° cell.", co2: "Real data: {src}. CO₂ mixes through the whole atmosphere, so every cell shows the same yearly value.",
          kid: "Real NASA data! Each square is a piece of the Earth." },
    ar: { real: "بيانات حقيقية: {src}. كل مربع خلية بحجم 6 درجات.", co2: "بيانات حقيقية: {src}. يختلط ثاني أكسيد الكربون في الغلاف الجوي كله، لذلك تُظهر كل الخلايا القيمة السنوية نفسها.",
          kid: "بيانات حقيقية من ناسا! كل مربع قطعة من الأرض." }
  };

  function patchMap(get, set, isMapPage) {
    var fld = get("field");
    if (typeof fld !== "function") return;
    var LAND = get("LAND") || "";
    set("field", function (layer, i, lat, lon, year) {
      if (EXTRA_IDS[layer]) return null;                    // extra Trend Lab parameters: no map
      var g = gridLayer(layer);
      if (g) {
        var y = Math.max(g.first, Math.min(g.last, year)), v = g.values[y];
        if (g.uniform) return v == null ? null : v;
        if (v) { if (layer === "sst" && +LAND[i]) return null; return v[i] == null ? null : v[i]; }
      }
      return fld.apply(this, arguments);
    });
    var yv = get("yearVals");
    if (typeof yv === "function") set("yearVals", function (self, v, lang) {
      yv.apply(this, arguments);
      var g = gridLayer(self && self.state && self.state.layer);
      if (g && v && v.ly) {
        var T = MAP_NOTE[lang === "ar" ? "ar" : "en"], tier = get("ES_TIER");
        v.ly.demo = tier === "kids" ? T.kid : (g.uniform ? T.co2 : T.real).replace("{src}", g.src);
      }
    });
    loadGrid().then(function (g) {
      if (!g) return;
      var LYR = get("LY_RANGE");
      if (LYR && isMapPage) Object.keys(g.layers).forEach(function (k) { if (LYR[k]) LYR[k] = [Math.max(LYR[k][0], g.layers[k].first), Math.min(LYR[k][1], g.layers[k].last)]; });
      ["CELL_CACHE", "SERIES_CACHE", "REG_CELLS"].forEach(function (n) { var c = get(n); if (c) for (var k in c) delete c[k]; });
      LIVE = {};
      if (window.DCLite) window.DCLite.refreshAll();
    });
  }

  /* ---------- hook into each page's logic as it loads (called by support.js) ---------- */
  window.DC_PATCH = function (get, set, file) {
    var sf = get("seriesFor");
    if (typeof sf !== "function") return;
    if (/TrendLab/i.test(file || "")) addExtraLayers(get);
    patchMap(get, set, /Map/i.test(file || ""));
    set("seriesFor", wrap(sf, get));
  };

  /* ---------- small status chip ---------- */
  var chip = null, offlineTimer = setTimeout(status, 2500);
  function status() {
    if (!document.body) return;
    var waiting = 0, k;
    for (k in ASKED) if (RESULTS[k] === undefined) waiting++;
    for (k in QUEUE) waiting++;
    var any = Object.keys(ASKED).length + Object.keys(QUEUE).length > 0;
    if (!any && inStreamlit) { if (chip) chip.style.display = "none"; return; }
    if (!chip) {
      chip = document.createElement("div");
      chip.setAttribute("role", "status"); chip.setAttribute("aria-live", "polite");
      chip.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;font:600 13px Inter,system-ui,sans-serif;box-shadow:0 6px 18px rgba(23,79,68,.18)";
      document.body.appendChild(chip);
    }
    chip.style.display = "flex";
    var dot = '<span aria-hidden="true" style="width:8px;height:8px;border-radius:50%;background:';
    if (!inStreamlit) { chip.style.background = "#FFF3D6"; chip.style.color = "#6b4a10"; chip.innerHTML = dot + '#F2C66D"></span>Preview · built-in values (run app.py for live NASA data)'; }
    else if (waiting) { chip.style.background = "#174F44"; chip.style.color = "#fff"; chip.innerHTML = dot + '#F2C66D"></span>Loading NASA data… (' + waiting + ")"; }
    else { chip.style.background = "#DDF1E7"; chip.style.color = "#174F44"; chip.innerHTML = dot + '#1B7865"></span>Live NASA data'; }
  }
  document.addEventListener("dc:ready", status);
})();
