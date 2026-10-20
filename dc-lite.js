/* dc-lite: a tiny renderer for Damini's portfolio pages.
   Reads the page template (<template id="dc-tpl">), fills {{holes}},
   handles <sc-if> / <sc-for>, wires onClick handlers, and patches the
   DOM in place so CSS transitions keep working between renders. */
(function () {
  'use strict';

  function DCLogic(props) { this.props = props || {}; this.state = null; }
  DCLogic.prototype.setState = function (patch) {
    var next = typeof patch === 'function' ? patch(this.state || {}, this.props) : patch;
    this.state = Object.assign({}, this.state || {}, next || {});
    schedule();
  };
  DCLogic.prototype.forceUpdate = function () { schedule(); };
  window.DCLogic = DCLogic;

  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  var comp = null, mount = null, tpl = null, pending = false;

  function lookup(scope, path) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    if (/^'.*'$/.test(path) || /^".*"$/.test(path)) return path.slice(1, -1);
    var v = scope, parts = path.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (v == null) return undefined;
      v = v[parts[i]];
    }
    return v;
  }
  function interp(str, scope) {
    return str.replace(HOLE, function (_, p) { var v = lookup(scope, p); return v == null ? '' : String(v); });
  }

  function processNodes(nodes, scope, out) {
    for (var i = 0; i < nodes.length; i++) processNode(nodes[i], scope, out);
    return out;
  }

  function processNode(node, scope, out) {
    if (node.nodeType === 3) { out.push(document.createTextNode(interp(node.nodeValue, scope))); return; }
    if (node.nodeType !== 1) return;
    var tag = node.localName;
    if (tag === 'helmet') return;
    if (tag === 'sc-if') {
      var m = WHOLE.exec(node.getAttribute('value') || '');
      var v = m ? lookup(scope, m[1]) : false;
      if (v) processNodes(node.childNodes, scope, out);
      return;
    }
    if (tag === 'sc-for') {
      var lm = WHOLE.exec(node.getAttribute('list') || '');
      var list = lm ? lookup(scope, lm[1]) : [];
      var as = node.getAttribute('as') || 'item';
      (list || []).forEach(function (item, idx) {
        var s2 = Object.create(scope);
        s2[as] = item; s2.$index = idx;
        processNodes(node.childNodes, s2, out);
      });
      return;
    }
    var el = document.createElementNS(node.namespaceURI, tag);
    for (var a = 0; a < node.attributes.length; a++) {
      var at = node.attributes[a], name = at.name, val = at.value;
      if (name.indexOf('hint-') === 0) continue;
      var whole = WHOLE.exec(val);
      if (/^on[a-z]+$/i.test(name)) {
        var fn = whole ? lookup(scope, whole[1]) : null;
        if (typeof fn === 'function') { el._dc = el._dc || {}; el._dc[name.slice(2).toLowerCase()] = fn; }
        continue;
      }
      if (whole) {
        var raw = lookup(scope, whole[1]);
        if (raw === false || raw == null) continue;
        el.setAttribute(name, raw === true ? '' : String(raw));
      } else if (val.indexOf('{{') >= 0) {
        el.setAttribute(name, interp(val, scope));
      } else {
        el.setAttribute(name, val);
      }
    }
    var kids = tag === 'template' ? [] : processNodes(node.childNodes, scope, []);
    for (var k = 0; k < kids.length; k++) el.appendChild(kids[k]);
    out.push(el);
  }

  function bind(el) {
    if (!el._dc) return;
    el._dcBound = el._dcBound || {};
    Object.keys(el._dc).forEach(function (evt) {
      if (el._dcBound[evt]) return;
      el._dcBound[evt] = true;
      el.addEventListener(evt, function (e) { var f = el._dc && el._dc[evt]; if (f) f(e); });
    });
  }
  function bindDeep(node) {
    if (node.nodeType !== 1) return;
    bind(node);
    for (var i = 0; i < node.children.length; i++) bindDeep(node.children[i]);
  }

  function morph(parent, newNodes) {
    var oldNodes = Array.prototype.slice.call(parent.childNodes);
    var n = Math.max(oldNodes.length, newNodes.length);
    for (var i = 0; i < n; i++) {
      var o = oldNodes[i], nn = newNodes[i];
      if (!nn) { if (o && o.parentNode === parent) parent.removeChild(o); continue; }
      if (!o) { parent.appendChild(nn); bindDeep(nn); continue; }
      var same = o.nodeType === nn.nodeType &&
        (o.nodeType !== 1 || (o.namespaceURI === nn.namespaceURI && o.localName === nn.localName));
      if (!same) { parent.replaceChild(nn, o); bindDeep(nn); continue; }
      if (o.nodeType === 3) { if (o.nodeValue !== nn.nodeValue) o.nodeValue = nn.nodeValue; continue; }
      if (o.nodeType !== 1) continue;
      var oa = Array.prototype.slice.call(o.attributes);
      for (var x = 0; x < oa.length; x++) if (!nn.hasAttribute(oa[x].name)) o.removeAttribute(oa[x].name);
      for (var y = 0; y < nn.attributes.length; y++) {
        var at = nn.attributes[y];
        if (o.getAttribute(at.name) !== at.value) o.setAttribute(at.name, at.value);
      }
      o._dc = nn._dc; bind(o);
      morph(o, Array.prototype.slice.call(nn.childNodes));
    }
  }

  function render() {
    pending = false;
    var vals = comp.renderVals ? comp.renderVals() : {};
    var nodes = processNodes(tpl.content.childNodes, vals, []);
    morph(mount, nodes);
  }
  function schedule() {
    if (!comp || pending) return;
    pending = true;
    Promise.resolve().then(render);
  }

  function fit() {
    var z = Math.max(0.25, Math.min(1.35, window.innerWidth / 1440));
    mount.style.zoom = z;
  }

  window.DCBoot = function (Component) {
    tpl = document.getElementById('dc-tpl');
    mount = document.getElementById('dc-root');
    var props = {};
    try {
      var decl = JSON.parse(document.getElementById('dc-props').textContent || '{}');
      Object.keys(decl).forEach(function (k) { if (k.charAt(0) !== '$' && decl[k] && 'default' in decl[k]) props[k] = decl[k]['default']; });
    } catch (e) {}
    comp = new Component(props);
    fit();
    window.addEventListener('resize', fit);
    render();
    if (typeof comp.componentDidMount === 'function') comp.componentDidMount();
  };
})();
