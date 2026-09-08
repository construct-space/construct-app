export const BROWSER_PAGE_STATE_EVENT = 'browser:page-state'
export const BROWSER_POPUP_EVENT = 'browser:open-popup'
export const BROWSER_LINK_CONTEXT_EVENT = 'browser:link-context'
export const BROWSER_PAGE_CONTEXT_EVENT = 'browser:page-context'
export const BROWSER_LOADING_EVENT = 'browser:loading'

export interface BrowserPageStatePayload {
  tabId: string
  webviewLabel: string
  url: string
  title: string
  favicon: string | null
}

export interface BrowserPopupPayload {
  tabId: string
  webviewLabel: string
  url: string
  popupId: string | null
  target: string | null
  via: 'window.open' | 'target-blank'
  foreground?: boolean
}

export interface BrowserLinkContextPayload {
  tabId: string
  webviewLabel: string
  url: string
  target: string | null
  clientX: number
  clientY: number
}

export interface BrowserPageContextPayload {
  tabId: string
  webviewLabel: string
  clientX: number
  clientY: number
  canGoBack: boolean
  canGoForward: boolean
}

export interface BrowserLoadingPayload {
  tabId: string
  webviewLabel: string
  loading: boolean
}

export function buildBrowserPageBridgeScript(input: {
  tabId: string
  webviewLabel: string
}): string {
  const tabId = JSON.stringify(input.tabId)
  const webviewLabel = JSON.stringify(input.webviewLabel)
  const stateEvent = JSON.stringify(BROWSER_PAGE_STATE_EVENT)
  const popupEvent = JSON.stringify(BROWSER_POPUP_EVENT)
  const linkContextEvent = JSON.stringify(BROWSER_LINK_CONTEXT_EVENT)
  const pageContextEvent = JSON.stringify(BROWSER_PAGE_CONTEXT_EVENT)
  const loadingEvent = JSON.stringify(BROWSER_LOADING_EVENT)

  return `(() => {
    const TAB_ID = ${tabId};
    const WEBVIEW_LABEL = ${webviewLabel};
    const STATE_EVENT = ${stateEvent};
    const POPUP_EVENT = ${popupEvent};
    const LINK_CONTEXT_EVENT = ${linkContextEvent};
    const PAGE_CONTEXT_EVENT = ${pageContextEvent};
    const LOADING_EVENT = ${loadingEvent};
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
      } catch {}
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
        const submitterMethod = \`\${submitter.getAttribute("formmethod") || submitter.formMethod || ""}\`
          .trim()
          .toLowerCase();
        if (submitterMethod) return submitterMethod;
      }
      return \`\${form.getAttribute("method") || form.method || "get"}\`.trim().toLowerCase() || "get";
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
        const name = \`\${submitter.getAttribute("name") || submitter.name || ""}\`.trim();
        if (name) {
          formData.append(name, \`\${submitter.getAttribute("value") || submitter.value || ""}\`);
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
      await invokeEvent(POPUP_EVENT, {
        tabId: TAB_ID,
        webviewLabel: WEBVIEW_LABEL,
        url,
        popupId,
        target: target || null,
        via,
        foreground,
      });
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
      if ("button" in event && event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element
        ? event.target.closest('a[href]')
        : null;
      if (!(target instanceof HTMLAnchorElement)) return;
      const targetAttr = resolvedLinkTarget(target);
      if (targetAttr !== "_blank") return;
      const href = target.getAttribute("href") || "";
      const url = resolveUrl(href);
      if (!url || !/^(https?:|about:)/i.test(url)) return;
      event.preventDefault();
      event.stopPropagation();
      void emitPopup(url, "_blank", "target-blank", null);
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
    const mutationRoot = document.head || document.documentElement || document;
    const observer = new MutationObserver(() => {
      void emitState();
    });
    observer.observe(mutationRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

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
    };

    document.addEventListener("click", clickHandler, true);
    document.addEventListener("submit", submitHandler, true);
    document.addEventListener("contextmenu", contextMenuHandler, true);
    window.addEventListener("popstate", popstateHandler);
    window.addEventListener("hashchange", hashHandler);
    window.addEventListener("beforeunload", beforeUnloadHandler);
    window.addEventListener("load", loadHandler);
    document.addEventListener("DOMContentLoaded", loadHandler);
    window.open = function (rawUrl, target) {
      const popupId = "popup-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
      const targetHint = typeof target === "string" ? target : null;
      void emitPopup(rawUrl || "", targetHint, "window.open", popupId, true);
      return createPopupProxy(popupId, targetHint);
    };

    window.__CONSTRUCT_BROWSER_BRIDGE__ = {
      key: BRIDGE_KEY,
      flush: () => {
        void emitState();
      },
      dispose: () => {
        document.removeEventListener("click", clickHandler, true);
        document.removeEventListener("submit", submitHandler, true);
        document.removeEventListener("contextmenu", contextMenuHandler, true);
        window.removeEventListener("popstate", popstateHandler);
        window.removeEventListener("hashchange", hashHandler);
        window.removeEventListener("beforeunload", beforeUnloadHandler);
        window.removeEventListener("load", loadHandler);
        document.removeEventListener("DOMContentLoaded", loadHandler);
        window.clearInterval(intervalId);
        observer.disconnect();
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
  })();`
}
