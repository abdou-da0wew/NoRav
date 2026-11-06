(() => {
  if (window.__NORAV_BRIDGE__) return;
  window.__NORAV_BRIDGE__ = true;

  let currentSource = window.__NORAV_ORIGINAL_URL__ || location.href;
  const nativeFetch = window.fetch.bind(window);
  const nativeOpen = window.open.bind(window);
  const nativeWebSocket = window.WebSocket;
  const nativeEventSource = window.EventSource;
  const nativePushState = history.pushState.bind(history);
  const nativeReplaceState = history.replaceState.bind(history);
  const nativeStorage = {
    getItem: Storage.prototype.getItem,
    setItem: Storage.prototype.setItem,
    removeItem: Storage.prototype.removeItem,
    clear: Storage.prototype.clear,
    key: Storage.prototype.key,
    length: Object.getOwnPropertyDescriptor(Storage.prototype, "length").get
  };
  const localStore = window.localStorage;
  const sessionStore = window.sessionStorage;

  const isWeb = url => url && (url.protocol === "http:" || url.protocol === "https:");
  const isProxyRoute = url => url && url.origin === location.origin
    && (url.pathname === "/proxy" || url.pathname === "/socket");
  const resolve = value => {
    try {
      const raw = value instanceof Request ? value.url : String(value);
      const proxyCandidate = new URL(raw, location.origin);
      if (isProxyRoute(proxyCandidate) && proxyCandidate.searchParams.has("url")) {
        return new URL(proxyCandidate.searchParams.get("url"), currentSource);
      }

      const target = new URL(raw, currentSource);
      if (target.origin === location.origin) {
        const original = new URL(currentSource);
        original.pathname = target.pathname;
        original.search = target.search;
        original.hash = target.hash;
        return original;
      }
      return target;
    } catch {
      return null;
    }
  };
  const proxied = value => {
    const target = resolve(value);
    if (!isWeb(target)) return String(value);
    const route = new URL("/proxy", location.origin);
    route.searchParams.set("url", target.href);
    return route.href;
  };
  const virtualizeURLProperty = (constructor, property) => {
    if (!constructor?.prototype) return;
    const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, property);
    if (!descriptor?.get || !descriptor?.set || !descriptor.configurable) return;
    Object.defineProperty(constructor.prototype, property, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        const value = descriptor.get.call(this);
        if (!value) return value;
        const target = resolve(value);
        return isWeb(target) ? target.href : value;
      },
      set(value) {
        const target = resolve(value);
        descriptor.set.call(this, isWeb(target) ? proxied(target.href) : value);
      }
    });
  };
  for (const [constructor, property] of [
    [window.HTMLScriptElement, "src"],
    [window.HTMLLinkElement, "href"],
    [window.HTMLAnchorElement, "href"],
    [window.HTMLAreaElement, "href"],
    [window.HTMLImageElement, "src"],
    [window.HTMLIFrameElement, "src"],
    [window.HTMLFrameElement, "src"],
    [window.HTMLSourceElement, "src"],
    [window.HTMLVideoElement, "src"],
    [window.HTMLVideoElement, "poster"],
    [window.HTMLAudioElement, "src"],
    [window.HTMLTrackElement, "src"],
    [window.HTMLFormElement, "action"],
    [window.HTMLInputElement, "src"],
    [window.HTMLInputElement, "formAction"],
    [window.HTMLButtonElement, "formAction"],
    [window.HTMLObjectElement, "data"]
  ]) {
    virtualizeURLProperty(constructor, property);
  }
  const notifyNavigation = value => {
    const target = resolve(value);
    if (!isWeb(target) || target.href === currentSource) return;
    currentSource = target.href;
    window.__NORAV_ORIGINAL_URL__ = currentSource;
    window.parent.postMessage({ type: "norav:navigation", url: currentSource }, "*");
  };

  // Keep web storage scoped to the original site instead of the shared proxy origin.
  const isManagedStorage = store => store === localStore || store === sessionStore;
  const storagePrefix = store => {
    const target = resolve(currentSource);
    const kind = store === localStore ? "local" : "session";
    return "norav:" + kind + ":" + (target?.origin || "unknown") + ":";
  };
  const visibleStorageKeys = store => {
    const prefix = storagePrefix(store);
    const keys = [];
    const length = nativeStorage.length.call(store);
    for (let i = 0; i < length; i++) {
      const key = nativeStorage.key.call(store, i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    return keys;
  };
  Storage.prototype.getItem = function(key) {
    return nativeStorage.getItem.call(this, isManagedStorage(this) ? storagePrefix(this) + key : key);
  };
  Storage.prototype.setItem = function(key, value) {
    return nativeStorage.setItem.call(this, isManagedStorage(this) ? storagePrefix(this) + key : key, value);
  };
  Storage.prototype.removeItem = function(key) {
    return nativeStorage.removeItem.call(this, isManagedStorage(this) ? storagePrefix(this) + key : key);
  };
  Storage.prototype.clear = function() {
    if (!isManagedStorage(this)) return nativeStorage.clear.call(this);
    for (const key of visibleStorageKeys(this)) nativeStorage.removeItem.call(this, key);
  };
  Storage.prototype.key = function(index) {
    if (!isManagedStorage(this)) return nativeStorage.key.call(this, index);
    const prefix = storagePrefix(this);
    const key = visibleStorageKeys(this)[index];
    return key ? key.slice(prefix.length) : null;
  };
  Object.defineProperty(Storage.prototype, "length", {
    configurable: true,
    get() {
      return isManagedStorage(this) ? visibleStorageKeys(this).length : nativeStorage.length.call(this);
    }
  });

  const decorate = (headers, target) => {
    const output = new Headers(headers || {});
    output.set("X-NoRav-Target", target);
    output.set("X-NoRav-Referer", currentSource);
    return output;
  };
  window.fetch = async (input, init) => {
    const target = resolve(input);
    if (!isWeb(target)) return nativeFetch(input, init);
    const request = input instanceof Request
      ? new Request(proxied(target.href), input)
      : new Request(proxied(target.href), init);
    return nativeFetch(new Request(request, {
      headers: decorate(request.headers, target.href),
      credentials: "include"
    }));
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    const target = resolve(url);
    this.__noravTarget = isWeb(target) ? target.href : "";
    return originalOpen.call(this, method, this.__noravTarget ? proxied(target.href) : url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this.__noravTarget) {
      try {
        this.setRequestHeader("X-NoRav-Target", this.__noravTarget);
        this.setRequestHeader("X-NoRav-Referer", currentSource);
      } catch {}
    }
    return originalSend.call(this, body);
  };

  window.open = (url, ...args) => {
    const target = resolve(url);
    return nativeOpen(isWeb(target) ? proxied(target.href) : url, ...args);
  };
  if (nativeEventSource) {
    window.EventSource = function(url, options) {
      const target = resolve(url);
      return new nativeEventSource(isWeb(target) ? proxied(target.href) : url, options);
    };
    window.EventSource.prototype = nativeEventSource.prototype;
  }
  if (nativeWebSocket) {
    window.WebSocket = function(url, protocols) {
      const target = (() => {
        try { return new URL(String(url), currentSource); } catch { return null; }
      })();
      if (!target || !["ws:", "wss:"].includes(target.protocol)) return new nativeWebSocket(url, protocols);
      const route = new URL("/socket", location.origin);
      route.searchParams.set("url", target.href);
      route.searchParams.set("origin", currentSource);
      const socketURL = route.href.replace(/^http/, "ws");
      return protocols ? new nativeWebSocket(socketURL, protocols) : new nativeWebSocket(socketURL);
    };
    window.WebSocket.prototype = nativeWebSocket.prototype;
    Object.setPrototypeOf(window.WebSocket, nativeWebSocket);
  }
  const originalBeacon = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
  if (originalBeacon) {
    navigator.sendBeacon = (url, data) => {
      const target = resolve(url);
      return originalBeacon(isWeb(target) ? proxied(target.href) : url, data);
    };
  }
  if (navigator.serviceWorker) {
    try {
      navigator.serviceWorker.register = () => Promise.reject(new Error("Service workers are disabled in proxied pages."));
    } catch {}
  }

  const rewriteStyle = value => value.replace(/url\((['"]?)(.*?)\1\)/gi, (all, quote, raw) => {
    const clean = String(raw).trim();
    if (!clean || clean.startsWith("/proxy?") || clean.startsWith("data:") || clean.startsWith("blob:")) return all;
    const target = resolve(clean);
    if (!isWeb(target) || isProxyRoute(target)) return all;
    return 'url("' + proxied(target.href) + '")';
  });
  const rewriteSrcset = value => {
    if (/\bdata:/i.test(value)) return value;
    return value.split(",").map(part => {
      const fields = part.trim().split(/\s+/);
      if (!fields[0] || fields[0].startsWith("/proxy?")) return part;
      const target = resolve(fields[0]);
      if (isWeb(target) && !isProxyRoute(target)) fields[0] = proxied(target.href);
      return fields.join(" ");
    }).join(", ");
  };
  const processElement = element => {
    const attributes = ["href", "src", "action", "formaction", "poster", "data"];
    if (element.matches("a,area,link,script,img,source,video,audio,track,iframe,frame,embed,form,input,button,object")) {
      for (const name of attributes) {
        const current = element.getAttribute(name);
        if (!current || current.startsWith("/proxy?") || current.startsWith("#")) continue;
        const target = resolve(current);
        if (isWeb(target) && !isProxyRoute(target)) {
          const next = proxied(target.href);
          if (next !== current) element.setAttribute(name, next);
        }
      }
    }
    if (element.hasAttribute("srcset")) {
      const current = element.getAttribute("srcset");
      const next = rewriteSrcset(current);
      if (next !== current) element.setAttribute("srcset", next);
    }
    if (element.hasAttribute("style")) {
      const current = element.getAttribute("style");
      const next = rewriteStyle(current);
      if (next !== current) element.setAttribute("style", next);
    }
  };
  const selector = "a[href],area[href],link[href],script[src],img[src],source[src],video[src],audio[src],track[src],iframe[src],frame[src],embed[src],form[action],input[src],button[formaction],input[formaction],object[data],[poster],[srcset],[style]";
  const scan = root => {
    if (!(root instanceof Element)) return;
    processElement(root);
    root.querySelectorAll(selector).forEach(processElement);
  };
  const observer = new MutationObserver(records => {
    const roots = new Set();
    for (const record of records) {
      if (record.type === "attributes" && record.target instanceof Element) roots.add(record.target);
      for (const node of record.addedNodes) if (node instanceof Element) roots.add(node);
    }
    for (const root of roots) {
      if ([...roots].some(parent => parent !== root && parent.contains(root))) continue;
      scan(root);
    }
  });
  observer.observe(document.documentElement, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ["href", "src", "action", "formaction", "poster", "data", "srcset", "style"]
  });

  history.pushState = (state, title, url) => {
    const result = nativePushState(state, title, url);
    if (url !== undefined && url !== null) notifyNavigation(url);
    return result;
  };
  history.replaceState = (state, title, url) => {
    const result = nativeReplaceState(state, title, url);
    if (url !== undefined && url !== null) notifyNavigation(url);
    return result;
  };
  window.addEventListener("popstate", () => notifyNavigation(location.href));
  window.addEventListener("hashchange", () => notifyNavigation(location.href));
  document.addEventListener("click", event => {
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (anchor && !event.defaultPrevented) notifyNavigation(anchor.href);
  });
  document.addEventListener("submit", event => {
    const form = event.target;
    if (form instanceof HTMLFormElement && !event.defaultPrevented) notifyNavigation(form.action || currentSource);
  });
  scan(document.documentElement);
  notifyNavigation(currentSource);
})();