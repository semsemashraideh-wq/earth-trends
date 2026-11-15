/* support.js — "dc-lite": renders the canvas's .dc.html design files in any
 * browser, with no build step and no dependencies. The .dc.html files stay
 * exactly as exported from the canvas; this file replaces the canvas runtime.
 *
 * Supports: <x-dc> templates, {{holes}}, <sc-for>, <sc-if>, <dc-import>,
 * <helmet>, events (onClick, onChange, onInput, onMouse*), class Component
 * extends DCLogic with state / setState / forceUpdate and lifecycle methods.
 */
(function () {
  "use strict";
  var SVG_NS = "http://www.w3.org/2000/svg", HTML_NS = "http://www.w3.org/1999/xhtml";
  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1 };
  var RAW = { script: 1, style: 1 };
  var ASSET_BASE = window.DC_ASSET_BASE || "./assets/";
  var ASSET_EXT = { ca6cfd01d73e50f195328c8400b23de4: ".jpg" };

  // Live-data layer (NASA bridge) — must load before any page logic runs.
  if (!window.DC_NO_BRIDGE) document.write('<script src="./nasa-bridge.js"><\/script>');
  // Stop the browser from parsing the raw template itself (it would request
  // "{{...}}" URLs and mangle <sc-for> inside <select>). We fetch the file's
  // source and render it ourselves in boot().
  document.write('<plaintext id="dc-lite-raw" style="display:none">');

  function fixUrl(s) {
    if (typeof s !== "string" || s.indexOf("/_blob/") < 0) return s;
    // Every canvas picture is saved in assets/ as <id>.jpg (all canvas uploads here are JPEG).
    return s.replace(/\/_blob\/([0-9a-f]{32})/g, function (_, id) { return ASSET_BASE + id + (ASSET_EXT[id] || ".jpg"); });
  }
  var _ta = null;
  function decode(s) {
    if (s.indexOf("&") < 0) return s;
    _ta = _ta || document.createElement("textarea");
    _ta.innerHTML = s; return _ta.value;
  }

  /* ---------- 1. a small HTML parser (the browser's parser drops <sc-for> inside <select>/<table>) ---------- */
  var nodeId = 0;
  function parse(src) {
    var root = { tag: "#root", ns: HTML_NS, attrs: [], children: [] }, stack = [root], i = 0, n = src.length;
    function top() { return stack[stack.length - 1]; }
    function text(t) { if (t) top().children.push({ text: decode(t), id: ++nodeId }); }
    while (i < n) {
      var lt = src.indexOf("<", i);
      if (lt < 0) { text(src.slice(i)); break; }
      if (lt > i) text(src.slice(i, lt));
      if (src.substr(lt, 4) === "<!--") { var ce = src.indexOf("-->", lt + 4); i = ce < 0 ? n : ce + 3; continue; }
      if (src[lt + 1] === "!") { var de = src.indexOf(">", lt); i = de < 0 ? n : de + 1; continue; }
      if (src[lt + 1] === "/") {
        var gt = src.indexOf(">", lt), cname = src.slice(lt + 2, gt).trim().toLowerCase();
        for (var k = stack.length - 1; k > 0; k--) if (stack[k].tag === cname) { stack.length = k; break; }
        i = gt + 1; continue;
      }
      var m = /^<([A-Za-z][A-Za-z0-9:_-]*)/.exec(src.slice(lt, lt + 80));
      if (!m) { text("<"); i = lt + 1; continue; }
      var raw = m[1], tag = raw.toLowerCase(), j = lt + m[0].length, attrs = [], selfClose = false;
      while (j < n) {
        while (j < n && /\s/.test(src[j])) j++;
        if (src[j] === ">") { j++; break; }
        if (src[j] === "/" && src[j + 1] === ">") { selfClose = true; j += 2; break; }
        var am = /^[^\s=>\/]+/.exec(src.slice(j, j + 200));
        if (!am) { j++; continue; }
        var an = am[0]; j += an.length;
        while (j < n && /\s/.test(src[j])) j++;
        var av = null;
        if (src[j] === "=") {
          j++; while (j < n && /\s/.test(src[j])) j++;
          var q = src[j];
          if (q === '"' || q === "'") { var qe = src.indexOf(q, j + 1); av = src.slice(j + 1, qe); j = qe + 1; }
          else { var um = /^[^\s>]+/.exec(src.slice(j, j + 4000)); av = um ? um[0] : ""; j += av.length; }
        }
        attrs.push([an, av == null ? "" : decode(av)]);
      }
      var parent = top();
      var ns = tag === "svg" ? SVG_NS : (parent.ns === SVG_NS && parent.tag !== "foreignobject" ? SVG_NS : HTML_NS);
      var node = { tag: tag, raw: raw, ns: ns, attrs: attrs, children: [], id: ++nodeId };
      parent.children.push(node);
      if (RAW[tag]) {
        var re = src.toLowerCase().indexOf("</" + tag, j);
        if (re < 0) re = n;
        node.children.push({ text: src.slice(j, re), id: ++nodeId, raw: true });
        var reg = src.indexOf(">", re); i = reg < 0 ? n : reg + 1; continue;
      }
      if (!selfClose && !VOID[tag]) stack.push(node);
      i = j;
    }
    return root;
  }
  function attr(node, name) { for (var k = 0; k < node.attrs.length; k++) if (node.attrs[k][0].toLowerCase() === name) return node.attrs[k][1]; return null; }
  function find(node, tag) {
    if (node.tag === tag) return node;
    for (var k = 0; k < (node.children || []).length; k++) { var f = find(node.children[k], tag); if (f) return f; }
    return null;
  }

  /* ---------- 2. compile a .dc.html source into { template, helmet, Component, defaults } ---------- */
  function compile(src, file) {
    var a = src.indexOf("<x-dc"), b = src.lastIndexOf("</x-dc>");
    var xdc = find(parse(src.slice(a, b + 7)), "x-dc");
    var helmet = null, body = [];
    xdc.children.forEach(function (c) { if (c.tag === "helmet") helmet = c; else body.push(c); });
    var sm = /<script\b([^>]*\bdata-dc-script\b[^>]*)>([\s\S]*?)<\/script>/i.exec(src);
    var defaults = {}, propsMeta = {};
    if (sm) {
      var tagNode = parse("<script " + sm[1] + "></script>").children[0];
      var dp = tagNode && attr(tagNode, "data-props");
      if (dp) { try { propsMeta = JSON.parse(dp); } catch (e) { console.warn("data-props", file, e); } }
      Object.keys(propsMeta).forEach(function (k) { if (k[0] !== "$" && propsMeta[k] && "default" in propsMeta[k]) defaults[k] = propsMeta[k].default; });
    }
    var code = sm ? sm[2] : "class Component extends DCLogic { renderVals() { return {}; } }";
    var factory = new Function("DCLogic", "__dcFile",
      code + "\n;try { if (window.DC_PATCH) window.DC_PATCH(function (n) { try { return eval(n); } catch (e) { return undefined; } }, function (n, __v) { eval(n + ' = __v'); }, __dcFile); } catch (e) { console.error('DC_PATCH', e); }\nreturn Component;\n//# sourceURL=" + file + ".logic.js");
    return { file: file, src: src.slice(0, 2000), template: body, helmet: helmet, Component: factory(DCLogic, file), defaults: defaults };
  }

  var DEFS = {};
  function load(file) {
    if (!DEFS[file]) DEFS[file] = fetch(file, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(file + " → HTTP " + r.status); return r.text();
    }).then(function (t) { return compile(t, file); });
    return DEFS[file];
  }

  /* ---------- 3. template → virtual nodes ---------- */
  function lookup(path, scope) {
    path = path.trim();
    if (path === "true") return true; if (path === "false") return false;
    if (path === "null") return null; if (path === "undefined" || path === "") return undefined;
    if (/^-?\d+(\.\d+)?$/.test(path)) return +path;
    if (/^(['"]).*\1$/.test(path)) return path.slice(1, -1);
    var parts = path.split("."), v = scope[parts[0]];
    for (var k = 1; k < parts.length; k++) { if (v == null) return undefined; v = v[parts[k]]; }
    return v;
  }
  var WHOLE = /^\s*\{\{([^}]*)\}\}\s*$/;
  function interp(s, scope) {
    if (s.indexOf("{{") < 0) return s;
    return s.replace(/\{\{([^}]*)\}\}/g, function (_, p) { var v = lookup(p, scope); return v == null || v === false ? "" : String(v); });
  }
  function value(s, scope) { var m = WHOLE.exec(s); return m ? lookup(m[1], scope) : interp(s, scope); }
  function camel(s) { return s.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); }

  function build(nodes, scope, keyPath, out) {
    for (var k = 0; k < nodes.length; k++) {
      var t = nodes[k];
      if (t.text != null) {
        var s = t.raw ? t.text : interp(t.text, scope);
        if (s !== "") out.push({ text: s, key: t.id + keyPath });
        continue;
      }
      if (t.tag === "sc-if") {
        if (lookup((attr(t, "value") || "").replace(/^\s*\{\{|\}\}\s*$/g, ""), scope)) build(t.children, scope, keyPath, out);
        continue;
      }
      if (t.tag === "sc-for") {
        var list = value(attr(t, "list") || "", scope), as = attr(t, "as") || "item";
        if (list && typeof list.length === "number") for (var x = 0; x < list.length; x++) {
          var sc = Object.create(scope); sc[as] = list[x]; sc.$index = x;
          build(t.children, sc, keyPath + "." + t.id + ":" + x, out);
        }
        continue;
      }
      if (t.tag === "dc-import") {
        var props = {};
        t.attrs.forEach(function (p) { var nm = p[0]; if (nm === "name" || nm.indexOf("hint-") === 0) return; props[camel(nm)] = value(p[1], scope); });
        out.push({ comp: attr(t, "name"), props: props, key: t.id + keyPath });
        continue;
      }
      var v = { tag: t.raw, ns: t.ns, attrs: {}, events: {}, children: [], key: t.id + keyPath };
      t.attrs.forEach(function (p) {
        var nm = p[0], val = value(p[1], scope);
        if (nm.indexOf("hint-") === 0 || nm === "key") return;
        if (/^on[A-Z]/.test(nm)) { if (typeof val === "function") v.events[nm] = val; return; }
        if (nm === "className") nm = "class"; if (nm === "htmlFor") nm = "for";
        v.attrs[nm] = val;
      });
      build(t.children, scope, keyPath, v.children);
      out.push(v);
    }
    return out;
  }

  /* ---------- 4. virtual nodes → real DOM (keyed patch, so inputs keep focus) ---------- */
  function evType(nm, el) {
    var e = nm.slice(2).toLowerCase();
    if (e === "change") {
      var tg = el.tagName.toLowerCase(), ty = (el.getAttribute("type") || "").toLowerCase();
      if ((tg === "input" && ty !== "checkbox" && ty !== "radio" && ty !== "file") || tg === "textarea") return "input";
    }
    if (e === "doubleclick") return "dblclick";
    return e;
  }
  function dispatcher(ev) { var h = this.__ev && this.__ev[ev.type]; if (h) h.call(this, ev); }
  var PROP = { value: 1, checked: 1, selected: 1 };

  function setAttrs(el, v) {
    var prev = el.__a || {}, next = v.attrs, nm;
    for (nm in prev) if (!(nm in next)) { if (PROP[nm]) el[nm] = nm === "value" ? "" : false; else el.removeAttribute(nm); }
    for (nm in next) {
      var val = next[nm];
      if (PROP[nm] && el.namespaceURI === HTML_NS) {
        if (nm === "value") { if (el.tagName !== "SELECT") { var sv = val == null ? "" : String(val); if (el.value !== sv) el.value = sv; } }
        else el[nm] = !!val;
        continue;
      }
      if (prev[nm] === val && el.__a) continue;
      if (val == null || val === false) { el.removeAttribute(nm); continue; }
      var s = val === true ? "" : (nm === "src" || nm === "href" || nm === "style" || nm === "srcset") ? fixUrl(String(val)) : String(val);
      try { el.setAttribute(nm, s); } catch (e) { /* invalid attribute name */ }
    }
    el.__a = next;
    var map = {}, ev;
    for (ev in v.events) map[evType(ev, el)] = v.events[ev];
    var old = el.__ev || {};
    for (ev in map) if (!old[ev]) el.addEventListener(ev, dispatcher);
    el.__ev = map;
  }
  function create(v, owner) {
    if (v.text != null) { var tn = document.createTextNode(v.text); tn.__k = v.key; return tn; }
    if (v.comp) {
      var host = document.createElement("div"); host.style.display = "contents"; host.__k = v.key;
      mountChild(host, v, owner); return host;
    }
    var el = v.ns === SVG_NS ? document.createElementNS(SVG_NS, v.tag) : document.createElement(v.tag);
    el.__k = v.key; setAttrs(el, v); patchChildren(el, v.children, owner);
    if (el.tagName === "SELECT" && "value" in v.attrs) el.value = v.attrs.value == null ? "" : String(v.attrs.value);
    return el;
  }
  function update(el, v, owner) {
    if (v.text != null) { if (el.data !== v.text) el.data = v.text; return; }
    if (v.comp) { mountChild(el, v, owner); return; }
    setAttrs(el, v); patchChildren(el, v.children, owner);
    if (el.tagName === "SELECT" && "value" in v.attrs) { var sv = v.attrs.value == null ? "" : String(v.attrs.value); if (el.value !== sv) el.value = sv; }
  }
  function same(el, v) {
    if (v.text != null) return el.nodeType === 3;
    if (v.comp) return el.__host === v.comp;
    return el.nodeType === 1 && !el.__host && el.localName === (v.ns === SVG_NS ? v.tag : v.tag.toLowerCase());
  }
  function unmountTree(el) {
    if (el.__inst) el.__inst._unmount();
    if (el.querySelectorAll) { var hs = el.querySelectorAll("*"); for (var k = 0; k < hs.length; k++) if (hs[k].__inst) hs[k].__inst._unmount(); }
  }
  function patchChildren(parent, vkids, owner) {
    var existing = {}, c = parent.firstChild;
    while (c) { if (c.__k != null) existing[c.__k] = c; c = c.nextSibling; }
    var used = {}, cursor = parent.firstChild;
    for (var k = 0; k < vkids.length; k++) {
      var v = vkids[k], el = existing[v.key];
      if (el && same(el, v)) { update(el, v, owner); }
      else { if (el) { unmountTree(el); parent.removeChild(el); if (cursor === el) cursor = cursor.nextSibling; } el = create(v, owner); }
      used[v.key] = 1;
      if (el !== cursor) parent.insertBefore(el, cursor); else cursor = cursor.nextSibling;
    }
    while (cursor) { var nx = cursor.nextSibling; if (!used[cursor.__k] || cursor.__k == null) { unmountTree(cursor); parent.removeChild(cursor); } cursor = nx; }
  }

  /* ---------- 5. component instances ---------- */
  var INSTANCES = [];
  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (u, cb) { (this.__q = this.__q || []).push(u); this._schedule(cb); };
  DCLogic.prototype.forceUpdate = function (cb) { this._schedule(cb); };
  DCLogic.prototype.renderVals = function () { return {}; };
  DCLogic.prototype._schedule = function (cb) {
    var self = this; if (cb) (self.__cbs = self.__cbs || []).push(cb);
    if (self.__pending) return; self.__pending = true;
    Promise.resolve().then(function () { self.__pending = false; if (!self.__dead) self._render(); });
  };
  DCLogic.prototype._render = function () {
    var prevState = this.state, prevProps = this.__prevProps || this.props;
    if (this.__q) { var s = this.state; this.__q.forEach(function (u) { var p = typeof u === "function" ? u(s, this.props) : u; if (p) s = Object.assign({}, s, p); }, this); this.state = s; this.__q = null; }
    var vals;
    try { vals = this.renderVals() || {}; } catch (e) { console.error("[" + this.__def.file + "] renderVals failed:", e); return; }
    var vnodes = build(this.__def.template, vals, "", []);
    patchChildren(this.__host, vnodes, this);
    if (!this.__mounted) { this.__mounted = true; if (this.componentDidMount) try { this.componentDidMount(); } catch (e) { console.error(e); } }
    else if (this.componentDidUpdate) try { this.componentDidUpdate(prevProps, prevState); } catch (e) { console.error(e); }
    this.__prevProps = this.props;
    var cbs = this.__cbs; this.__cbs = null; if (cbs) cbs.forEach(function (f) { try { f(); } catch (e) { console.error(e); } });
  };
  DCLogic.prototype._unmount = function () {
    if (this.__dead) return; this.__dead = true;
    if (this.componentWillUnmount) try { this.componentWillUnmount(); } catch (e) { console.error(e); }
    INSTANCES.splice(INSTANCES.indexOf(this), 1);
  };
  function instantiate(def, host, props) {
    var p = Object.assign({}, def.defaults, props);
    var inst = new def.Component(p);
    if (!inst.state) inst.state = {};
    inst.__def = def; inst.__host = host; host.__inst = inst;
    INSTANCES.push(inst);
    inst._render();
    return inst;
  }
  function addHelmet(def) {
    if (!def.helmet || def.__helmetDone) return; def.__helmetDone = true;
    def.helmet.children.forEach(function (c) {
      if (c.text != null) return;
      var el = document.createElement(c.tag);
      c.attrs.forEach(function (p) { el.setAttribute(p[0], fixUrl(p[1])); });
      if (c.children[0] && c.children[0].text != null) el.textContent = fixUrl(c.children[0].text);
      document.head.appendChild(el);
    });
  }
  function mountChild(host, v, owner) {
    host.__host = v.comp; host.__props = v.props;
    if (host.__inst) { host.__inst.props = Object.assign({}, host.__inst.__def.defaults, v.props); host.__inst._schedule(); return; }
    var dir = owner && owner.__def.file.indexOf("/") >= 0 ? owner.__def.file.replace(/[^/]*$/, "") : "";
    load(dir + v.comp + ".dc.html").then(function (def) {
      if (host.__inst) return; addHelmet(def); instantiate(def, host, host.__props);
    }).catch(function (e) { console.error("dc-import " + v.comp, e); });
  }

  /* ---------- 6. fit to screen ----------
   * The pages were designed on 1440 px wide canvas artboards. On wider
   * screens we scale the whole page up so it fills the window like the canvas
   * preview does; on narrower screens the design's own responsive layout applies.
   * Change DC_DESIGN_WIDTH before support.js loads to adjust, or set it to 0 to switch off. */
  var DESIGN_W = window.DC_DESIGN_WIDTH != null ? window.DC_DESIGN_WIDTH : 1440;
  function fit() {
    if (!DESIGN_W) return;
    var z = Math.max(1, Math.min(2, (window.innerWidth || DESIGN_W) / DESIGN_W));
    document.documentElement.style.zoom = z > 1.01 ? String(Math.round(z * 1000) / 1000) : "";
  }
  window.addEventListener("resize", fit);

  /* ---------- 7. boot ---------- */
  window.DCLogic = DCLogic;
  window.DCLite = {
    instances: INSTANCES,
    refreshAll: function () { INSTANCES.slice().forEach(function (i) { i.forceUpdate(); }); }
  };
  function boot() {
    fit();
    var file = decodeURIComponent(location.pathname.split("/").pop() || "Main.dc.html");
    load(file).then(function (def) {
      addHelmet(def);
      var raw = document.getElementById("dc-lite-raw"); if (raw) raw.parentNode.removeChild(raw);
      var tm = /<title>([^<]*)<\/title>/i.exec(def.src || ""); if (tm && !document.title) document.title = decode(tm[1]);
      var root = document.createElement("div"); root.id = "dc-root";
      document.body.appendChild(root);
      instantiate(def, root, {});
      document.dispatchEvent(new CustomEvent("dc:ready", { detail: { file: file } }));
    }).catch(function (e) {
      console.error(e);
      document.body.insertAdjacentHTML("afterbegin", '<pre style="padding:24px;color:#b5452f;font:14px monospace">Could not render ' + file + ": " + String(e.message || e) + "\n(Open it through a web server, e.g. streamlit run app.py — not by double-clicking.)</pre>");
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
