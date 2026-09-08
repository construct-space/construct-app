(() => {
  const TAB_ID = __TAB_ID__;
  const WEBVIEW_LABEL = __WEBVIEW_LABEL__;
  const STATE_EVENT = __STATE_EVENT__;
  const POPUP_EVENT = __POPUP_EVENT__;
  const LINK_CONTEXT_EVENT = __LINK_CONTEXT_EVENT__;
  const PAGE_CONTEXT_EVENT = __PAGE_CONTEXT_EVENT__;
  const LOADING_EVENT = __LOADING_EVENT__;
  const BRIDGE_KEY = "construct-browser-bridge:" + WEBVIEW_LABEL;
  if (window.__CONSTRUCT_BROWSER_BRIDGE__?.key === BRIDGE_KEY) {
    window.__CONSTRUCT_BROWSER_BRIDGE__.flush?.();
    return;
  }

  const invokeEvent = async (eventName, payload) => {
    try {
      if (window.__CONSTRUCT_TAURI_IPC__ && typeof window.__CONSTRUCT_TAURI_IPC__.emit === "function") {
        await window.__CONSTRUCT_TAURI_IPC__.emit(eventName, payload);
        return;
      }
      if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === "function") {
        await window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {
          event: eventName,
          payload,
        });
      }
    } catch (error) {
      throw error;
    }
  };

  const invokePopupCommand = async (payload) => {
    if (window.__CONSTRUCT_TAURI_IPC__ && typeof window.__CONSTRUCT_TAURI_IPC__.invoke === "function") {
      await window.__CONSTRUCT_TAURI_IPC__.invoke("browser_handle_popup", { payload });
      return true;
    }
    return false;
  };

  const resolveUrl = (raw) => {
    const candidate = typeof raw === "string" ? raw.trim() : "";
    if (!candidate) return "";
    try {
      return new URL(candidate, location.href).toString();
    } catch {
      return candidate;
    }
  };

  const normalizeTarget = (raw) => {
    return typeof raw === "string" ? raw.trim().toLowerCase() : "";
  };

  const inheritedBaseTarget = () => {
    const base = document.querySelector("base[target]");
    if (!(base instanceof HTMLBaseElement)) return "";
    return normalizeTarget(base.getAttribute("target") || base.target || "");
  };

  const resolvedLinkTarget = (anchor) => {
    return normalizeTarget(
      anchor.getAttribute("target") || anchor.target || inheritedBaseTarget()
    );
  };

  const resolvedFormTarget = (form, submitter) => {
    if (submitter instanceof HTMLElement) {
      const submitterTarget = normalizeTarget(
        submitter.getAttribute("formtarget") || submitter.formTarget || ""
      );
      if (submitterTarget) return submitterTarget;
    }
    return normalizeTarget(
      form.getAttribute("target") || form.target || inheritedBaseTarget()
    );
  };

  const resolvedFormMethod = (form, submitter) => {
    if (submitter instanceof HTMLElement) {
      const submitterMethod = `${submitter.getAttribute("formmethod") || submitter.formMethod || ""}`
        .trim()
        .toLowerCase();
      if (submitterMethod) return submitterMethod;
    }
    return `${form.getAttribute("method") || form.method || "get"}`.trim().toLowerCase() || "get";
  };

  const resolvedFormAction = (form, submitter) => {
    const rawAction =
      (submitter instanceof HTMLElement
        ? submitter.getAttribute("formaction") || submitter.formAction || ""
        : "") ||
      form.getAttribute("action") ||
      form.action ||
      location.href;
    return resolveUrl(rawAction);
  };

  const buildGetFormUrl = (form, submitter) => {
    const action = resolvedFormAction(form, submitter);
    if (!action) return "";
    let url;
    try {
      url = new URL(action, location.href);
    } catch {
      return action;
    }

    const formData = new FormData(form);
    if (
      submitter instanceof HTMLElement &&
      "name" in submitter &&
      "value" in submitter &&
      !submitter.hasAttribute("disabled")
    ) {
      const name = `${submitter.getAttribute("name") || submitter.name || ""}`.trim();
      if (name) {
        formData.append(name, `${submitter.getAttribute("value") || submitter.value || ""}`);
      }
    }

    for (const [key, value] of formData.entries()) {
      url.searchParams.append(key, value instanceof File ? value.name : String(value));
    }

    return url.toString();
  };

  const readFavicon = () => {
    const icon = document.querySelector(
      'link[rel~="icon"][href], link[rel="shortcut icon"][href], link[apple-touch-icon][href]'
    );
    if (!(icon instanceof HTMLLinkElement)) return null;
    const href = icon.getAttribute("href") || "";
    const value = resolveUrl(href);
    return value || null;
  };

  let lastSignature = "";
  const emitState = async () => {
    const payload = {
      tabId: TAB_ID,
      webviewLabel: WEBVIEW_LABEL,
      url: location.href || "",
      title: document.title || "",
      favicon: readFavicon(),
    };
    const signature = JSON.stringify(payload);
    if (signature === lastSignature) return;
    lastSignature = signature;
    await invokeEvent(STATE_EVENT, payload);
  };

  const emitPopup = async (rawUrl, target, via, popupId = null, foreground = true) => {
    const resolved = resolveUrl(rawUrl || "");
    const url = resolved || (popupId ? "about:blank" : "");
    if (!url || !/^(https?:|about:)/i.test(url)) return null;
    const payload = {
      tabId: TAB_ID,
      webviewLabel: WEBVIEW_LABEL,
      url,
      popupId,
      target: target || null,
      via,
      foreground,
    };
    let commandError = null;
    try {
      if (await invokePopupCommand(payload)) return null;
    } catch (error) {
      commandError = error;
    }
    try {
      await invokeEvent(POPUP_EVENT, payload);
    } catch {
      if (!commandError) {
        try {
          await invokePopupCommand(payload);
        } catch {}
      }
    }
    return null;
  };

  const emitLinkContext = async (rawUrl, target, clientX, clientY) => {
    const url = resolveUrl(rawUrl || "");
    if (!url || !/^(https?:|about:)/i.test(url)) return;
    await invokeEvent(LINK_CONTEXT_EVENT, {
      tabId: TAB_ID,
      webviewLabel: WEBVIEW_LABEL,
      url,
      target: target || null,
      clientX: Number.isFinite(clientX) ? clientX : 0,
      clientY: Number.isFinite(clientY) ? clientY : 0,
    });
  };

  const emitLoading = async (loading) => {
    await invokeEvent(LOADING_EVENT, {
      tabId: TAB_ID,
      webviewLabel: WEBVIEW_LABEL,
      loading: Boolean(loading),
    });
  };

  const createPopupProxy = (popupId, targetHint) => {
    const locationState = {
      href: "about:blank",
      assign: (value) => {
        void emitPopup(value, targetHint, "window.open", popupId);
      },
      replace: (value) => {
        void emitPopup(value, targetHint, "window.open", popupId);
      },
      toString: () => locationState.href,
    };
    const locationApi = new Proxy(locationState, {
      set(target, prop, value) {
        if (prop === "href") {
          target.href = String(value || "");
          void emitPopup(value, targetHint, "window.open", popupId);
          return true;
        }
        target[prop] = value;
        return true;
      },
    });

    const popupWindow = {
      closed: false,
      opener: null,
      close: () => {
        popupWindow.closed = true;
      },
      focus: () => {},
      blur: () => {},
      postMessage: () => {},
    };

    return new Proxy(popupWindow, {
      get(target, prop) {
        if (prop === "location") return locationApi;
        return target[prop];
      },
      set(target, prop, value) {
        if (prop === "location") {
          void emitPopup(value, targetHint, "window.open", popupId);
          return true;
        }
        if (prop === "closed") {
          target.closed = Boolean(value);
          return true;
        }
        target[prop] = value;
        return true;
      },
    });
  };

  const clickHandler = (event) => {
    if (event.defaultPrevented) return;
    const button = "button" in event ? event.button : 0;
    if (button !== 0 && button !== 1) return;
    const target = event.target instanceof Element
      ? event.target.closest('a[href]')
      : null;
    if (!(target instanceof HTMLAnchorElement)) return;
    const href = target.getAttribute("href") || "";
    const url = resolveUrl(href);
    if (!url || !/^(https?:|about:)/i.test(url)) return;

    const targetAttr = resolvedLinkTarget(target);
    const middle = button === 1;
    const cmdOrCtrl = event.metaKey || event.ctrlKey;
    const shift = event.shiftKey;

    const explicitBlank = targetAttr === "_blank";
    const modifierNewTab = middle || cmdOrCtrl;
    const foreground = explicitBlank || shift;

    if (!explicitBlank && !modifierNewTab && !shift) return;

    event.preventDefault();
    event.stopPropagation();

    void emitPopup(url, "_blank", "target-blank", null, foreground);
  };

  const submitHandler = (event) => {
    if (event.defaultPrevented) return;
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!(form instanceof HTMLFormElement)) return;
    const submitter = event.submitter instanceof HTMLElement ? event.submitter : null;
    if (resolvedFormTarget(form, submitter) !== "_blank") return;
    if (resolvedFormMethod(form, submitter) !== "get") return;
    const url = buildGetFormUrl(form, submitter);
    if (!url || !/^(https?:|about:)/i.test(url)) return;
    event.preventDefault();
    event.stopPropagation();
    void emitPopup(url, "_blank", "target-blank", null);
  };

  const contextMenuHandler = (event) => {
    if (event.defaultPrevented) return;
    const target = event.target instanceof Element
      ? event.target.closest('a[href]')
      : null;
    if (!(target instanceof HTMLAnchorElement)) return;
    const href = target.getAttribute("href") || "";
    const url = resolveUrl(href);
    if (!url || !/^(https?:|about:)/i.test(url)) return;
    event.preventDefault();
    event.stopPropagation();
    void emitLinkContext(
      url,
      (target.getAttribute("target") || target.target || "").trim() || null,
      event.clientX,
      event.clientY,
    );
  };

  const pageContextMenuHandler = (event) => {
    if (event.defaultPrevented) return;
    // Don't show on links (those have their own menu)
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('a[href]')) return;

    event.preventDefault();
    event.stopPropagation();
    void invokeEvent(PAGE_CONTEXT_EVENT, {
      tabId: TAB_ID,
      webviewLabel: WEBVIEW_LABEL,
      clientX: Number.isFinite(event.clientX) ? event.clientX : 0,
      clientY: Number.isFinite(event.clientY) ? event.clientY : 0,
      canGoBack: window.history.length > 1,
      canGoForward: false,
    });
  };

  const wrapHistory = (name) => {
    const original = history[name];
    if (typeof original !== "function") return;
    history[name] = function (...args) {
      const result = original.apply(this, args);
      window.setTimeout(() => {
        void emitState();
      }, 0);
      return result;
    };
    return original;
  };

  if (window.__CONSTRUCT_BROWSER_BRIDGE__?.dispose) {
    window.__CONSTRUCT_BROWSER_BRIDGE__.dispose();
  }

  const originalWindowOpen = window.open.bind(window);
  const originalPushState = wrapHistory("pushState");
  const originalReplaceState = wrapHistory("replaceState");
  let observer = null;
  try {
    observer = new MutationObserver(() => {
      void emitState();
    });
    const mutationRoot = document.head || document.documentElement || document;
    observer.observe(mutationRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  } catch {
    observer = null;
  }

  const intervalId = window.setInterval(() => {
    void emitState();
  }, 1000);

  const popstateHandler = () => {
    void emitState();
  };
  const hashHandler = () => {
    void emitState();
  };
  const beforeUnloadHandler = () => {
    void emitLoading(true);
  };
  const loadHandler = () => {
    void emitLoading(false);
    void emitState();
  };

  document.addEventListener("click", clickHandler, true);
  document.addEventListener("auxclick", clickHandler, true);
  document.addEventListener("submit", submitHandler, true);
  document.addEventListener("contextmenu", contextMenuHandler, true);
  document.addEventListener("contextmenu", pageContextMenuHandler, true);
  window.addEventListener("popstate", popstateHandler);
  window.addEventListener("hashchange", hashHandler);
  window.addEventListener("beforeunload", beforeUnloadHandler);
  window.addEventListener("load", loadHandler);
  document.addEventListener("DOMContentLoaded", loadHandler);
  window.open = function (rawUrl, target) {
    const popupId = "popup-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    const targetHint = typeof target === "string" ? target : null;
    void emitPopup(rawUrl || "", targetHint, "window.open", popupId);
    return createPopupProxy(popupId, targetHint);
  };

  window.__CONSTRUCT_BROWSER_BRIDGE__ = {
    key: BRIDGE_KEY,
    flush: () => {
      void emitState();
    },
    dispose: () => {
      document.removeEventListener("click", clickHandler, true);
      document.removeEventListener("auxclick", clickHandler, true);
      document.removeEventListener("submit", submitHandler, true);
      document.removeEventListener("contextmenu", contextMenuHandler, true);
      document.removeEventListener("contextmenu", pageContextMenuHandler, true);
      window.removeEventListener("popstate", popstateHandler);
      window.removeEventListener("hashchange", hashHandler);
      window.removeEventListener("beforeunload", beforeUnloadHandler);
      window.removeEventListener("load", loadHandler);
      document.removeEventListener("DOMContentLoaded", loadHandler);
      window.clearInterval(intervalId);
      observer?.disconnect();
      window.open = originalWindowOpen;
      if (typeof originalPushState === "function") {
        history.pushState = originalPushState;
      }
      if (typeof originalReplaceState === "function") {
        history.replaceState = originalReplaceState;
      }
    },
  };

  void emitState();
})();
