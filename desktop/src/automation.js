// Construct Browser Automation Runtime
// Injected into browser tabs by Tauri for DOM automation.
// All functions are namespaced under window.__CONSTRUCT_AUTO__ to avoid conflicts.
//
// Contract: Phase 0 contracts in docs/plans/phase0-contracts.md

(function() {
  if (window.__CONSTRUCT_AUTO__) return; // already injected

  var AUTO = {};
  var MAX_NODES = 2000;
  var MAX_DEPTH = 15;
  var TEXT_LIMIT = 200;
  var ATTR_WHITELIST = ['href', 'src', 'type', 'placeholder', 'aria-label', 'data-testid'];

  // node_id -> element mapping (rebuilt on each snapshot)
  var _nodeMap = new Map();

  // -------------------------------------------------------------------------
  // Snapshot — structured node tree (Phase 0 contract format)
  // -------------------------------------------------------------------------

  AUTO.snapshot = function() {
    _nodeMap.clear();
    var counter = { n: 0 };
    var nodes = [];
    _walkNodes(document.body, nodes, counter, 0);
    return {
      url: location.href || '',
      title: document.title || '',
      nodes: nodes
    };
  };

  function _walkNodes(el, nodes, counter, depth) {
    if (!el || counter.n >= MAX_NODES || depth > MAX_DEPTH) return null;

    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (!tag || tag === 'script' || tag === 'style' || tag === 'noscript') return null;

    try {
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return null;
    } catch(e) { /* ignore */ }

    var text = _ownText(el).trim();
    var hasContent = text || _isInteractive(el, tag) || tag === 'img';
    var childIds = [];

    // Walk children first to collect child IDs
    for (var i = 0; i < el.children.length; i++) {
      var childId = _walkNodes(el.children[i], nodes, counter, depth + 1);
      if (childId) childIds.push(childId);
    }

    // Skip nodes that carry no information and have no meaningful children
    if (!hasContent && childIds.length === 0) return null;

    counter.n++;
    var nodeId = 'n' + counter.n;
    _nodeMap.set(nodeId, el);

    var node = { id: nodeId, tag: tag };

    // Role
    var role = el.getAttribute('role');
    if (role) node.role = role;
    else if (tag === 'input') node.role = 'textbox';
    else if (tag === 'button') node.role = 'button';
    else if (tag === 'a') node.role = 'link';
    else if (tag === 'select') node.role = 'combobox';
    else if (tag === 'textarea') node.role = 'textbox';
    else if (tag === 'form') node.role = 'form';

    // Name (form field name or accessible name)
    if (el.name) node.name = el.name;

    // Text
    if (text) node.text = text.substring(0, TEXT_LIMIT);

    // Value
    if ('value' in el && el.value) node.value = String(el.value).substring(0, TEXT_LIMIT);

    // Attributes (whitelisted)
    var attrs = {};
    var hasAttrs = false;
    for (var j = 0; j < ATTR_WHITELIST.length; j++) {
      var attrName = ATTR_WHITELIST[j];
      var attrVal = el.getAttribute(attrName);
      if (attrVal != null) {
        attrs[attrName] = String(attrVal).substring(0, 200);
        hasAttrs = true;
      }
    }
    if (hasAttrs) node.attributes = attrs;

    // Children
    if (childIds.length > 0) node.children = childIds;

    nodes.push(node);
    return nodeId;
  }

  function _isInteractive(el, tag) {
    if (['a', 'button', 'input', 'select', 'textarea'].includes(tag)) return true;
    if (el.getAttribute('role') === 'button') return true;
    if (el.getAttribute('tabindex') != null) return true;
    if (el.onclick || el.getAttribute('onclick')) return true;
    return false;
  }

  function _ownText(el) {
    var t = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3) t += el.childNodes[i].textContent;
    }
    return t;
  }

  // -------------------------------------------------------------------------
  // Click — accepts node_id (string like "n4") or CSS selector
  // -------------------------------------------------------------------------

  AUTO.click = function(nodeId, selector) {
    var el = _resolveNode(nodeId, selector);
    if (!el) return { error: 'Element not found' };
    el.scrollIntoView({ block: 'center' });
    el.click();
    return { clicked: true };
  };

  // -------------------------------------------------------------------------
  // Type text — accepts node_id or selector, with optional clear
  // -------------------------------------------------------------------------

  AUTO.type = function(nodeId, selector, text, clear) {
    var el = _resolveNode(nodeId, selector);
    if (!el) return { error: 'Element not found' };
    el.focus();
    // Clear existing value if requested (default: true for contract compat)
    if (clear !== false && 'value' in el) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Type character by character for frameworks that listen to input events
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      if ('value' in el) {
        el.value += ch;
      } else {
        document.execCommand('insertText', false, ch);
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { typed: true };
  };

  // -------------------------------------------------------------------------
  // Press key
  // -------------------------------------------------------------------------

  AUTO.pressKey = function(nodeId, selector, key, modifiers) {
    var el = _resolveNode(nodeId, selector) || document.activeElement || document.body;
    var mods = modifiers || [];
    var opts = {
      key: key,
      bubbles: true,
      cancelable: true,
      ctrlKey: mods.indexOf('Ctrl') >= 0,
      shiftKey: mods.indexOf('Shift') >= 0,
      altKey: mods.indexOf('Alt') >= 0,
      metaKey: mods.indexOf('Meta') >= 0,
    };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    if (key === 'Enter' && el.form) {
      el.form.dispatchEvent(new Event('submit', { bubbles: true }));
    }
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
    return { pressed: true };
  };

  // -------------------------------------------------------------------------
  // Wait for selector with state: "visible" | "hidden" | "attached"
  // -------------------------------------------------------------------------

  AUTO.waitFor = function(selector, state, timeoutMs) {
    state = state || 'visible';
    timeoutMs = timeoutMs || 5000;

    function check() {
      var el = document.querySelector(selector);
      if (state === 'attached') return !!el;
      if (state === 'hidden') {
        if (!el) return true;
        var s = window.getComputedStyle(el);
        return s.display === 'none' || s.visibility === 'hidden';
      }
      // "visible" (default)
      if (!el) return false;
      var st = window.getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden';
    }

    return new Promise(function(resolve) {
      if (check()) {
        resolve({ found: true });
        return;
      }
      var resolved = false;
      var observer = new MutationObserver(function() {
        if (check()) {
          resolved = true;
          observer.disconnect();
          resolve({ found: true });
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
      setTimeout(function() {
        if (!resolved) {
          observer.disconnect();
          resolve({ error: 'Timeout waiting for ' + selector + ' to be ' + state + ' within ' + timeoutMs + 'ms' });
        }
      }, timeoutMs);
    });
  };

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function _resolveNode(nodeId, selector) {
    if (nodeId && _nodeMap.has(nodeId)) return _nodeMap.get(nodeId);
    if (selector) return document.querySelector(selector);
    return null;
  }

  window.__CONSTRUCT_AUTO__ = AUTO;
})();
