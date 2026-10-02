const DEFAULT_SETTINGS = {
  searchEngine: "DuckDuckGo",
  homepage: "home",
  themeIntensity: "balanced",
  animations: true,
  particles: true,
};

const state = {
  tabs: [],
  activeTabId: null,
  loading: false,
  serviceWorkerReady: false,
  navigationId: 0,
  navigationPoll: null,
  navigationTimeout: null,
};

const connection = new BareMux.BareMuxConnection("/baremux/worker.js");
const wispUrl =
  localStorage.getItem("cherri_wispUrl") ||
  `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/wisp/`;
let serviceWorkerPromise;
let transportPromise;

transportPromise = Promise.resolve(
  connection.setTransport("/libcurl/index.mjs", [{ websocket: wispUrl }])
).then(
  () => true,
  (error) => {
    console.error("Failed to initialize the Wisp transport", error);
    return false;
  }
);

const { ScramjetController } = $scramjetLoadController();
const scramjet = new ScramjetController({
  files: {
    wasm: "/homework/history.wasm.wasm",
    all: "/homework/math.all.js",
    sync: "/homework/science.sync.js",
  },
});

scramjet.init();

function loadUserSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("scramjetSettings") || "{}");
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveUserSettings(settings) {
  localStorage.setItem("scramjetSettings", JSON.stringify(settings));
}

function getSearchEngine() {
  const settings = loadUserSettings();
  const engine = settings.searchEngine || "DuckDuckGo";

  switch (engine) {
    case "Google":
      return "https://www.google.com/search?q=";
    case "Bing":
      return "https://www.bing.com/search?q=";
    case "Startpage":
      return "https://www.startpage.com/do/search?q=";
    case "Qwant":
      return "https://www.qwant.com/?q=";
    case "Brave":
      return "https://search.brave.com/search?q=";
    default:
      return "https://duckduckgo.com/?q=";
  }
}

function persistRecentSite(rawUrl) {
  try {
    const url = String(rawUrl || "").trim();
    if (!url) return;

    const existing = JSON.parse(localStorage.getItem("scramjetRecent") || "[]");
    const list = Array.isArray(existing) ? existing : [];
    const next = [url, ...list.filter((entry) => entry && entry !== url)].slice(0, 6);
    localStorage.setItem("scramjetRecent", JSON.stringify(next));
  } catch (error) {
    console.warn("Failed to save recent site", error);
  }
}

function renderRecentSites() {
  const container = document.getElementById("recentSites");
  if (!container) return;

  const items = JSON.parse(localStorage.getItem("scramjetRecent") || "[]");
  container.innerHTML = "";

  if (!Array.isArray(items) || !items.length) {
    container.innerHTML = '<div class="empty-state">No recent sites yet.</div>';
    return;
  }

  items.forEach((url, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "recent-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "recent-site";
    button.textContent = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
    button.addEventListener("click", () => nav(url));

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "recent-remove";
    removeButton.setAttribute("aria-label", "Remove recent site");
    removeButton.textContent = "×";
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const saved = JSON.parse(localStorage.getItem("scramjetRecent") || "[]");
      const next = (Array.isArray(saved) ? saved : []).filter((entry, i) => i !== index);
      localStorage.setItem("scramjetRecent", JSON.stringify(next));
      renderRecentSites();
    });

    wrapper.appendChild(button);
    wrapper.appendChild(removeButton);
    container.appendChild(wrapper);
  });
}

function setLoading(active) {
  state.loading = active;
  const line = document.getElementById("loadingIndicator");
  if (!line) return;

  if (active) {
    clearTimeout(state.navigationPoll);
    clearTimeout(state.navigationTimeout);
    state.navigationPoll = null;
    state.navigationTimeout = null;
    line.style.width = "35%";
    line.style.opacity = "1";
  } else {
    state.navigationId += 1;
    clearTimeout(state.navigationPoll);
    clearTimeout(state.navigationTimeout);
    state.navigationPoll = null;
    state.navigationTimeout = null;
    line.style.width = "100%";
    line.style.opacity = "0";
  }
}

function monitorNavigation(url) {
  const frame = document.getElementById("browserFrame");
  const navigationId = ++state.navigationId;
  const expectedFrameUrl = frame?.src;
  const startedAt = Date.now();
  const deadline = Date.now() + 15000;

  function checkDocument() {
    if (navigationId !== state.navigationId || !frame) return;

    try {
      const doc = frame.contentDocument;
      const isExpectedDocument =
        doc &&
        Date.now() - startedAt >= 500 &&
        frame.contentWindow?.location.href === expectedFrameUrl;
      const hasStartedRendering =
        isExpectedDocument &&
        Boolean(
          doc.body?.childElementCount ||
            doc.body?.textContent?.trim() ||
            doc.title
        );

      if (hasStartedRendering) {
        const tab = currentTab();
        if (tab?.url === url && doc.title) {
          tab.title = doc.title;
          renderTabs();
        }
        setLoading(false);
        return;
      }
    } catch (error) {
      console.warn("Unable to inspect proxied page readiness", error);
    }

    if (Date.now() >= deadline) {
      setLoading(false);
      showErrorPage("This page did not begin rendering within 15 seconds. The site may be unavailable or responding slowly.");
      return;
    }

    state.navigationPoll = setTimeout(checkDocument, 150);
  }

  state.navigationTimeout = setTimeout(() => {
    if (navigationId !== state.navigationId) return;
    setLoading(false);
    showErrorPage("This page did not begin rendering within 15 seconds. The site may be unavailable or responding slowly.");
  }, 15000);
  state.navigationPoll = setTimeout(checkDocument, 100);
}

function startFrameNavigation(url) {
  const frame = document.getElementById("browserFrame");
  if (!frame) return;
  setLoading(true);
  frame.src = scramjet.encodeUrl(url);
  monitorNavigation(url);
}

function showHomeScreen() {
  const home = document.getElementById("homeView");
  const frame = document.getElementById("browserFrame");
  const error = document.getElementById("errorView");

  if (home) home.classList.remove("hidden");
  if (frame) frame.classList.add("hidden");
  if (error) error.classList.add("hidden");

  const input = document.getElementById("homeSearchInput");
  if (input) input.focus();
}

function hideHomeScreen() {
  const home = document.getElementById("homeView");
  const frame = document.getElementById("browserFrame");
  if (home) home.classList.add("hidden");
  if (frame) frame.classList.remove("hidden");
}

function showErrorPage(message = "Unable to load this page.") {
  const errorView = document.getElementById("errorView");
  const frame = document.getElementById("browserFrame");
  const home = document.getElementById("homeView");
  if (errorView) {
    const detail = document.getElementById("errorDetails");
    if (detail) detail.textContent = message;
    errorView.classList.remove("hidden");
  }
  if (home) home.classList.add("hidden");
  if (frame) frame.classList.add("hidden");
}

function hideErrorPage() {
  const error = document.getElementById("errorView");
  if (error) error.classList.add("hidden");
}

function currentTab() {
  return state.tabs.find((tab) => tab.id === state.activeTabId) || state.tabs[0] || null;
}

function normalizeAddress(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "home";
  if (value.toLowerCase() === "home") return "home";
  if (/^https?:\/\//i.test(value) || /^about:/i.test(value) || /^file:/i.test(value)) return value;
  if (/^(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)(?::\d+)?$/i.test(value)) return `http://${value}`;
  if (/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:\/.*)?$/i.test(value)) return `https://${value}`;
  return `${getSearchEngine()}${encodeURIComponent(value)}`;
}

function createTab(title = "New Tab", initialUrl = "home") {
  const tabId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tab = {
    id: tabId,
    title,
    url: initialUrl === "home" ? "" : initialUrl,
    isHome: initialUrl === "home",
    history: initialUrl === "home" ? [] : [initialUrl],
    historyIndex: initialUrl === "home" ? -1 : 0,
  };

  state.tabs.push(tab);
  state.activeTabId = tabId;
  renderTabs();
  updateAddressBar();

  if (initialUrl === "home") {
    showHomeScreen();
  } else {
    nav(initialUrl);
  }

  return tab;
}

function closeTab(tabId) {
  if (state.tabs.length === 1) {
    return;
  }

  const currentIndex = state.tabs.findIndex((tab) => tab.id === tabId);
  if (currentIndex === -1) return;

  state.tabs.splice(currentIndex, 1);

  if (state.activeTabId === tabId) {
    state.activeTabId = state.tabs[Math.max(0, currentIndex - 1)].id;
  }

  renderTabs();
  updateAddressBar();
  if (currentTab()?.isHome) {
    showHomeScreen();
  }
}

function switchTab(tabId) {
  state.activeTabId = tabId;
  renderTabs();
  updateAddressBar();

  const tab = currentTab();
  if (!tab) return;

  if (tab.isHome) {
    showHomeScreen();
    return;
  }

  const frame = document.getElementById("browserFrame");
  if (frame) {
    hideHomeScreen();
    hideErrorPage();
    frame.classList.remove("hidden");
    if (tab.url) {
      navigateFrame(tab.url);
    }
  }
}

function renderTabs() {
  const strip = document.getElementById("tabStrip");
  if (!strip) return;

  const tabs = state.tabs;
  strip.querySelectorAll(".tab-button").forEach((node) => node.remove());

  tabs.forEach((tab) => {
    const node = document.createElement("button");
    node.type = "button";
    node.className = `tab-button${state.activeTabId === tab.id ? " active" : ""}`;
    node.dataset.tabId = tab.id;
    node.innerHTML = `<span>${tab.title || "New Tab"}</span><span class="tab-close">×</span>`;
    node.addEventListener("click", (event) => {
      if (event.target.closest(".tab-close")) {
        closeTab(tab.id);
        return;
      }
      switchTab(tab.id);
    });
    strip.insertBefore(node, strip.lastElementChild);
  });
}

function updateAddressBar() {
  const input = document.getElementById("addressInput");
  const tab = currentTab();
  if (input && tab) {
    input.value = tab.isHome ? "" : tab.url;
  }

  const navTitle = document.getElementById("currentSiteTitle");
  if (navTitle && tab) {
    navTitle.textContent = tab.isHome ? "Home" : tab.title || new URL(tab.url).hostname;
  }
}

async function navigateToUrl(rawInput) {
  const normalized = normalizeAddress(rawInput);
  const tab = currentTab();
  if (!tab) return;

  if (normalized === "home") {
    tab.isHome = true;
    tab.url = "";
    tab.title = "Home";
    updateAddressBar();
    showHomeScreen();
    return;
  }

  if (!(await ensureProxyReady())) return;

  tab.isHome = false;
  tab.url = normalized;
  tab.title = tab.url.startsWith("https://") ? new URL(tab.url).hostname : "Search";

  if (tab.historyIndex === -1 || tab.history[tab.historyIndex] !== normalized) {
    tab.history = tab.history.slice(0, tab.historyIndex + 1);
    tab.history.push(normalized);
    tab.historyIndex = tab.history.length - 1;
  }

  persistRecentSite(normalized);
  renderRecentSites();
  updateAddressBar();

  const frame = document.getElementById("browserFrame");
  if (frame) {
    hideHomeScreen();
    hideErrorPage();
    frame.classList.remove("hidden");
    startFrameNavigation(normalized);
  }
}

async function navigateFrame(url) {
  try {
    if (!(await ensureProxyReady())) return;
    startFrameNavigation(url);
  } catch (error) {
    console.error("Scramjet navigation could not be started", error);
    showErrorPage(error.message || "Scramjet navigation could not be started.");
  }
}

async function goBack() {
  const tab = currentTab();
  if (!tab || tab.historyIndex <= 0) return;
  tab.historyIndex -= 1;
  tab.url = tab.history[tab.historyIndex];
  tab.isHome = false;
  updateAddressBar();
  await navigateFrame(tab.url);
}

async function goForward() {
  const tab = currentTab();
  if (!tab || tab.historyIndex >= tab.history.length - 1) return;
  tab.historyIndex += 1;
  tab.url = tab.history[tab.historyIndex];
  tab.isHome = false;
  updateAddressBar();
  await navigateFrame(tab.url);
}

function reloadPage() {
  const tab = currentTab();
  if (!tab || tab.isHome) return;
  startFrameNavigation(tab.url);
}

function attachNavigationHandlers() {
  document.getElementById("backButton")?.addEventListener("click", goBack);
  document.getElementById("forwardButton")?.addEventListener("click", goForward);
  document.getElementById("reloadButton")?.addEventListener("click", reloadPage);
  document.getElementById("homeButton")?.addEventListener("click", () => navigateToUrl("home"));
  document.getElementById("goButton")?.addEventListener("click", () => navigateToUrl(document.getElementById("addressInput")?.value || ""));
  document.getElementById("addressInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      navigateToUrl(event.currentTarget.value);
    }
  });

  document.getElementById("homeSearchInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      navigateToUrl(event.currentTarget.value);
    }
  });

  document.getElementById("homeSearchButton")?.addEventListener("click", () => {
    navigateToUrl(document.getElementById("homeSearchInput")?.value || "");
  });

  document.getElementById("settingsButton")?.addEventListener("click", () => {
    document.getElementById("settingsPanel")?.classList.toggle("hidden");
  });

  document.getElementById("fullscreenButton")?.addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.warn("Fullscreen was not available", error);
    }
  });

  document.getElementById("newTabButton")?.addEventListener("click", () => createTab("New Tab", "home"));

  document.getElementById("aboutButton")?.addEventListener("click", () => {
    const panel = document.getElementById("aboutPanel");
    if (panel) {
      panel.style.display = panel.style.display === "none" ? "block" : "none";
    }
  });

  document.getElementById("closeSettings")?.addEventListener("click", () => {
    document.getElementById("settingsPanel")?.classList.add("hidden");
  });

  document.getElementById("errorRetry")?.addEventListener("click", () => {
    const tab = currentTab();
    if (tab && tab.url) navigateToUrl(tab.url);
  });

  document.getElementById("errorHome")?.addEventListener("click", () => navigateToUrl("home"));

  document.getElementById("quickSites")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-site]");
    if (button) {
      navigateToUrl(button.dataset.site);
    }
  });

  document.getElementById("clearDataButton")?.addEventListener("click", () => {
    localStorage.removeItem("scramjetRecent");
    localStorage.removeItem("scramjetSettings");
    renderRecentSites();
    window.location.reload();
  });

  document.getElementById("searchEngineSelect")?.addEventListener("change", (event) => {
    const settings = loadUserSettings();
    settings.searchEngine = event.target.value;
    saveUserSettings(settings);
  });

  document.getElementById("homepageSelect")?.addEventListener("change", (event) => {
    const settings = loadUserSettings();
    settings.homepage = event.target.value;
    saveUserSettings(settings);
  });

  document.getElementById("themeIntensitySelect")?.addEventListener("change", (event) => {
    const settings = loadUserSettings();
    settings.themeIntensity = event.target.value;
    saveUserSettings(settings);
    document.documentElement.dataset.themeIntensity = settings.themeIntensity;
  });

  document.getElementById("animationsToggle")?.addEventListener("change", (event) => {
    const settings = loadUserSettings();
    settings.animations = event.target.checked;
    saveUserSettings(settings);
    document.body.classList.toggle("reduced-motion", !settings.animations);
  });

  document.getElementById("particlesToggle")?.addEventListener("change", (event) => {
    const settings = loadUserSettings();
    settings.particles = event.target.checked;
    saveUserSettings(settings);
    document.body.classList.toggle("particles-off", !settings.particles);
  });
}

function populateSettings() {
  const settings = loadUserSettings();
  const searchEngine = document.getElementById("searchEngineSelect");
  const homepage = document.getElementById("homepageSelect");
  const themeIntensity = document.getElementById("themeIntensitySelect");
  const animations = document.getElementById("animationsToggle");
  const particles = document.getElementById("particlesToggle");

  if (searchEngine) searchEngine.value = settings.searchEngine || "DuckDuckGo";
  if (homepage) homepage.value = settings.homepage || "home";
  if (themeIntensity) themeIntensity.value = settings.themeIntensity || "balanced";
  if (animations) animations.checked = settings.animations !== false;
  if (particles) particles.checked = settings.particles !== false;

  document.documentElement.dataset.themeIntensity = settings.themeIntensity || "balanced";
  document.body.classList.toggle("reduced-motion", settings.animations === false);
  document.body.classList.toggle("particles-off", settings.particles === false);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("This browser does not support service workers. Scramjet requires a secure origin such as localhost or HTTPS.");
  }

  try {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    await navigator.serviceWorker.ready;

    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
          reject(new Error("The Scramjet service worker installed but did not take control of this page. Reload the browser and try again."));
        }, 8000);

        function onControllerChange() {
          clearTimeout(timeout);
          navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
          resolve();
        }

        navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
        if (navigator.serviceWorker.controller) onControllerChange();
      });
    }

    state.serviceWorkerReady = Boolean(navigator.serviceWorker.controller);
    if (!state.serviceWorkerReady) {
      throw new Error("The Scramjet service worker is not controlling this page.");
    }
    return true;
  } catch (error) {
    console.warn("Service worker failed to register", error);
    state.serviceWorkerReady = false;
    throw error;
  }
}

async function ensureProxyReady() {
  try {
    if (!serviceWorkerPromise) serviceWorkerPromise = registerServiceWorker();
    await serviceWorkerPromise;
    if (!state.serviceWorkerReady) {
      throw new Error("Scramjet service worker is not ready.");
    }
    if (!(await transportPromise)) {
      throw new Error(`The Wisp transport could not connect to ${wispUrl}`);
    }
    return true;
  } catch (error) {
    console.error("Scramjet is not ready", error);
    showErrorPage(error.message || "Scramjet could not start. Check the service-worker and Wisp setup.");
    return false;
  }
}

function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "t") {
      event.preventDefault();
      createTab("New Tab", "home");
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w") {
      event.preventDefault();
      if (state.tabs.length > 1) {
        closeTab(currentTab()?.id);
      }
    }

    if ((event.ctrlKey || event.metaKey) && event.key === "Tab") {
      event.preventDefault();
      const currentIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
      const nextIndex = (currentIndex + 1) % state.tabs.length;
      switchTab(state.tabs[nextIndex].id);
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
      event.preventDefault();
      const addressInput = document.getElementById("addressInput");
      if (addressInput) {
        addressInput.focus();
        addressInput.select();
      }
    }
  });
}

window.addEventListener("load", () => {
  populateSettings();
  renderRecentSites();
  attachNavigationHandlers();
  setupKeyboardShortcuts();
  serviceWorkerPromise = registerServiceWorker().catch((error) => {
    console.error("Scramjet service worker registration failed", error);
    showErrorPage(error.message || "Scramjet service worker registration failed.");
    return false;
  });
  createTab("New Tab", "home");

  const frame = document.getElementById("browserFrame");
  if (frame) {
    frame.addEventListener("load", () => {
      try {
        const frameDocument = frame.contentDocument;
        const frameText = frameDocument?.body?.innerText || "";
        if (frameText.startsWith("Cannot GET /scramjet/")) {
          showErrorPage("The Scramjet service worker did not intercept this URL. Reload the app so the service worker can take control, then try again.");
          setLoading(false);
          return;
        }
        const documentTitle = frameDocument?.title || "Untitled";
        const tab = currentTab();
        if (tab) {
          tab.title = documentTitle || "Untitled";
          renderTabs();
        }
      } catch (error) {
        console.warn("Unable to read frame title", error);
      }
      setLoading(false);
      hideErrorPage();
    });

    frame.addEventListener("error", () => {
      setLoading(false);
      showErrorPage("Unable to load this page.");
    });
  }
});
