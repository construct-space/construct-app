;(() => {
  if (window.__CONSTRUCT_TAURI_IPC__) {
    return;
  }

  const SERIALIZE_TO_IPC_FN = "__TAURI_TO_IPC_KEY__";
  const INVOKE_KEY = __CONSTRUCT_INVOKE_KEY__;

  function serialize(value) {
    return JSON.stringify(value, (_key, current) => {
      if (current instanceof Map) {
        return Object.fromEntries(current.entries());
      }
      if (current instanceof Uint8Array) {
        return Array.from(current);
      }
      if (current instanceof ArrayBuffer) {
        return Array.from(new Uint8Array(current));
      }
      if (
        typeof current === "object" &&
        current !== null &&
        SERIALIZE_TO_IPC_FN in current
      ) {
        return current[SERIALIZE_TO_IPC_FN]();
      }
      return current;
    });
  }

  function assertRuntime() {
    if (!window.__TAURI_INTERNALS__ || typeof window.__TAURI_INTERNALS__.transformCallback !== "function") {
      throw new Error("Tauri callback bridge unavailable");
    }
    if (!window.ipc || typeof window.ipc.postMessage !== "function") {
      throw new Error("Tauri postMessage bridge unavailable");
    }
  }

  function invoke(cmd, payload = {}, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        assertRuntime();
      } catch (error) {
        reject(error);
        return;
      }

      const callback = window.__TAURI_INTERNALS__.transformCallback((result) => {
        resolve(result);
        window.__TAURI_INTERNALS__.unregisterCallback?.(errorCallback);
      }, true);

      const errorCallback = window.__TAURI_INTERNALS__.transformCallback((error) => {
        reject(error);
        window.__TAURI_INTERNALS__.unregisterCallback?.(callback);
      }, true);

      window.ipc.postMessage(
        serialize({
          cmd,
          callback,
          error: errorCallback,
          payload,
          options: {
            ...options,
            customProtocolIpcBlocked: true,
          },
          __TAURI_INVOKE_KEY__: INVOKE_KEY,
        }),
      );
    });
  }

  async function emit(event, payload) {
    return invoke("plugin:event|emit", { event, payload });
  }

  window.__CONSTRUCT_TAURI_IPC__ = Object.freeze({
    invoke,
    emit,
  });
})();
