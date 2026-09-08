/**
 * Builds an injected script for find-in-page functionality.
 * Uses CSS Highlight API if available, falls back to mark elements.
 *
 * The script provides a __CONSTRUCT_FIND__ global object with methods:
 * - find(text): Find all instances, highlight them, return match count
 * - clear(): Clear all highlights
 * - next(): Move to next match
 * - prev(): Move to previous match
 * - getMatchCount(): Return total matches found
 * - getActiveIndex(): Return current match index (0-based)
 *
 * Also creates a Find bar UI at bottom-right of the viewport for user interaction.
 */

function buildFindBarHtml(): string {
  return `
    <div id="construct-find-bar" style="
      position: fixed;
      bottom: 16px;
      right: 16px;
      background: #2a2d34;
      border: 1px solid #3a3d44;
      border-radius: 6px;
      padding: 8px 12px;
      display: flex;
      gap: 8px;
      align-items: center;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      z-index: 2147483647;
      font-family: system-ui, -apple-system, sans-serif;
    ">
      <input
        id="construct-find-input"
        type="text"
        placeholder="Find in page..."
        style="
          background: #1b1d24;
          border: 1px solid #3a3d44;
          color: #f2f3f7;
          padding: 6px 8px;
          border-radius: 4px;
          min-width: 200px;
          font-size: 13px;
          outline: none;
        "
      />
      <span id="construct-find-results" style="
        color: #9ca3af;
        font-size: 13px;
        min-width: 80px;
        text-align: center;
        white-space: nowrap;
      ">No results</span>
      <button id="construct-find-prev" style="
        background: #3a3d44;
        color: #f2f3f7;
        border: none;
        padding: 6px 10px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        line-height: 1;
      " title="Previous match">↑</button>
      <button id="construct-find-next" style="
        background: #3a3d44;
        color: #f2f3f7;
        border: none;
        padding: 6px 10px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        line-height: 1;
      " title="Next match">↓</button>
      <button id="construct-find-close" style="
        background: #3a3d44;
        color: #f2f3f7;
        border: none;
        width: 24px;
        padding: 6px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        line-height: 1;
      " title="Close">✕</button>
    </div>
  `;
}

export function buildFindScript(): string {
  const cssHighlightStyles =
    '::highlight(find) { background-color: #ffeb3b; color: #000; } ' +
    '::highlight(find-active) { background-color: #ff9800; color: #fff; }'

  return (
    '(() => {' +
    '  let activeIndex = 0;' +
    '  let ranges = [];' +
    "  let lastQuery = '';" +
    '  ' +
    '  const escapeRegex = (text) => {' +
    '    return text.replace(/[.+*?^${}()|[\\\\]\\\\\\\\]/g, "\\\\\\\\$&");' +
    '  };' +
    '  ' +
    '  const findInDocument = (searchText) => {' +
    '    ranges = [];' +
    '    activeIndex = 0;' +
    '    lastQuery = searchText;' +
    '    ' +
    '    if (!searchText) {' +
    '      clearHighlights();' +
    '      return 0;' +
    '    }' +
    '    ' +
    '    const regex = new RegExp(escapeRegex(searchText), "gi");' +
    '    const walker = document.createTreeWalker(' +
    '      document.body,' +
    '      NodeFilter.SHOW_TEXT,' +
    '      null,' +
    '      false' +
    '    );' +
    '    ' +
    '    let node;' +
    '    while (node = walker.nextNode()) {' +
    '      const text = node.textContent;' +
    '      let match;' +
    '      ' +
    '      regex.lastIndex = 0;' +
    '      while ((match = regex.exec(text)) !== null) {' +
    '        const range = document.createRange();' +
    '        range.setStart(node, match.index);' +
    '        range.setEnd(node, match.index + match[0].length);' +
    '        ranges.push(range);' +
    '      }' +
    '    }' +
    '    ' +
    '    applyHighlights();' +
    '    return ranges.length;' +
    '  };' +
    '  ' +
    '  const applyHighlights = () => {' +
    '    if (ranges.length === 0) return;' +
    '    ' +
    '    if (typeof CSS !== "undefined" && CSS.highlights) {' +
    '      try {' +
    '        const highlight = new Highlight(...ranges);' +
    '        CSS.highlights.set("find", highlight);' +
    '        ' +
    '        if (!document.getElementById("construct-find-styles")) {' +
    '          const style = document.createElement("style");' +
    '          style.id = "construct-find-styles";' +
    '          style.textContent = "' +
    cssHighlightStyles +
    '";' +
    '          document.head.appendChild(style);' +
    '        }' +
    '        ' +
    '        highlightActiveMatch();' +
    '        return;' +
    '      } catch {}' +
    '    }' +
    '    ' +
    '    fallbackHighlight();' +
    '  };' +
    '  ' +
    '  const highlightActiveMatch = () => {' +
    '    if (!ranges.length) return;' +
    '    ' +
    '    if (typeof CSS !== "undefined" && CSS.highlights) {' +
    '      try {' +
    '        const activeRange = ranges[activeIndex];' +
    '        const highlight = new Highlight(activeRange);' +
    '        CSS.highlights.set("find-active", highlight);' +
    '        ' +
    '        const span = document.createElement("span");' +
    '        span.appendChild(activeRange.cloneContents());' +
    '        activeRange.insertNode(span);' +
    '        span.scrollIntoView({ behavior: "smooth", block: "center" });' +
    '        const parent = span.parentNode;' +
    '        while (span.firstChild) {' +
    '          parent.insertBefore(span.firstChild, span);' +
    '        }' +
    '        parent.removeChild(span);' +
    '      } catch {}' +
    '    }' +
    '  };' +
    '  ' +
    '  const fallbackHighlight = () => {' +
    '    clearFallbackMarks();' +
    '    ' +
    '    ranges.forEach((range, index) => {' +
    '      const span = document.createElement("span");' +
    '      span.className = "construct-find-mark";' +
    '      span.style.backgroundColor = index === activeIndex ? "#ff9800" : "#ffeb3b";' +
    '      span.style.color = index === activeIndex ? "#fff" : "#000";' +
    '      span.style.padding = "2px 1px";' +
    '      span.dataset.findIndex = index.toString();' +
    '      range.insertNode(span);' +
    '    });' +
    '    ' +
    '    const activeSpan = document.querySelector("[data-find-index=\\"" + activeIndex + "\\"]");' +
    '    if (activeSpan) {' +
    '      activeSpan.scrollIntoView({ behavior: "smooth", block: "center" });' +
    '    }' +
    '  };' +
    '  ' +
    '  const clearFallbackMarks = () => {' +
    '    const marks = document.querySelectorAll(".construct-find-mark");' +
    '    marks.forEach(mark => {' +
    '      const parent = mark.parentNode;' +
    '      while (mark.firstChild) {' +
    '        parent.insertBefore(mark.firstChild, mark);' +
    '      }' +
    '      parent.removeChild(mark);' +
    '    });' +
    '  };' +
    '  ' +
    '  const clearHighlights = () => {' +
    '    if (typeof CSS !== "undefined" && CSS.highlights) {' +
    '      try {' +
    '        CSS.highlights.delete("find");' +
    '        CSS.highlights.delete("find-active");' +
    '      } catch {}' +
    '    }' +
    '    clearFallbackMarks();' +
    '    ranges = [];' +
    '    activeIndex = 0;' +
    '  };' +
    '  ' +
    '  window.__CONSTRUCT_FIND__ = {' +
    '    find(text) {' +
    '      return findInDocument(text);' +
    '    },' +
    '    ' +
    '    clear() {' +
    '      clearHighlights();' +
    '    },' +
    '    ' +
    '    next() {' +
    '      if (ranges.length === 0) return;' +
    '      activeIndex = (activeIndex + 1) % ranges.length;' +
    '      highlightActiveMatch();' +
    '      updateFindBar();' +
    '    },' +
    '    ' +
    '    prev() {' +
    '      if (ranges.length === 0) return;' +
    '      activeIndex = (activeIndex - 1 + ranges.length) % ranges.length;' +
    '      highlightActiveMatch();' +
    '      updateFindBar();' +
    '    },' +
    '    ' +
    '    getMatchCount() {' +
    '      return ranges.length;' +
    '    },' +
    '    ' +
    '    getActiveIndex() {' +
    '      return ranges.length > 0 ? activeIndex : -1;' +
    '    },' +
    '    ' +
    '    showBar() {' +
    '      createFindBar();' +
    '    },' +
    '    ' +
    '    hideBar() {' +
    '      closeFindBar();' +
    '    },' +
    '  };' +
    '  ' +
    '  const createFindBar = () => {' +
    '    if (document.getElementById("construct-find-bar")) return;' +
    '    const htmlStr = ' + JSON.stringify(buildFindBarHtml()) + ';' +
    '    const tempDiv = document.createElement("div");' +
    '    tempDiv.innerHTML = htmlStr;' +
    '    const bar = tempDiv.querySelector("#construct-find-bar");' +
    '    if (bar) {' +
    '      document.body.appendChild(bar);' +
    '      setupFindBarListeners();' +
    '    }' +
    '  };' +
    '  ' +
    '  const updateFindBar = () => {' +
    '    const resultsEl = document.getElementById("construct-find-results");' +
    '    if (resultsEl) {' +
    '      if (ranges.length === 0) {' +
    '        resultsEl.textContent = "No results";' +
    '      } else {' +
    '        resultsEl.textContent = (activeIndex + 1) + " of " + ranges.length;' +
    '      }' +
    '    }' +
    '  };' +
    '  ' +
    '  const setupFindBarListeners = () => {' +
    '    const input = document.getElementById("construct-find-input");' +
    '    const prevBtn = document.getElementById("construct-find-prev");' +
    '    const nextBtn = document.getElementById("construct-find-next");' +
    '    const closeBtn = document.getElementById("construct-find-close");' +
    '    ' +
    '    if (input) {' +
    '      input.addEventListener("input", (e) => {' +
    '        const text = e.target.value;' +
    '        findInDocument(text);' +
    '        updateFindBar();' +
    '      });' +
    '      input.addEventListener("keydown", (e) => {' +
    '        if (e.key === "Enter") {' +
    '          e.preventDefault();' +
    '          if (e.shiftKey) {' +
    '            window.__CONSTRUCT_FIND__.prev();' +
    '          } else {' +
    '            window.__CONSTRUCT_FIND__.next();' +
    '          }' +
    '        } else if (e.key === "Escape") {' +
    '          closeFindBar();' +
    '        }' +
    '      });' +
    '      input.focus();' +
    '    }' +
    '    ' +
    '    if (prevBtn) {' +
    '      prevBtn.addEventListener("click", () => {' +
    '        window.__CONSTRUCT_FIND__.prev();' +
    '      });' +
    '    }' +
    '    ' +
    '    if (nextBtn) {' +
    '      nextBtn.addEventListener("click", () => {' +
    '        window.__CONSTRUCT_FIND__.next();' +
    '      });' +
    '    }' +
    '    ' +
    '    if (closeBtn) {' +
    '      closeBtn.addEventListener("click", closeFindBar);' +
    '    }' +
    '  };' +
    '  ' +
    '  const closeFindBar = () => {' +
    '    const bar = document.getElementById("construct-find-bar");' +
    '    if (bar) {' +
    '      bar.remove();' +
    '    }' +
    '    clearHighlights();' +
    '  };' +
    '  ' +
    '})();'
  )
}
