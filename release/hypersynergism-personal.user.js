// ==UserScript==
// @name         Hypersynergism (personal build)
// @namespace    hypersynergism-personal
// @version      2026.10.15.3
// @description  Loads Hypersynergism from the philipsteingruber/hypersynergism-personal fork (locale-aware number parsing fixes). Click "Load HS" after closing the "Since you were away" box.
// @match        https://synergism.cc/*
// @match        https://www.synergism.cc/*
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/philipsteingruber/hypersynergism-personal/master/release/hypersynergism-personal.user.js
// @downloadURL  https://raw.githubusercontent.com/philipsteingruber/hypersynergism-personal/master/release/hypersynergism-personal.user.js
// ==/UserScript==

(function () {
    'use strict';

    // With a @grant the script runs sandboxed, so page globals live on unsafeWindow
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    console.log('[HSMain] Personal userscript active');

    const REPO = 'philipsteingruber/hypersynergism-personal';
    const BUILD_PATH = 'release/mod/hypersynergism_release.js';

    // Branch refs are cached by GitHub raw (~5 min) and jsDelivr (up to 12h), but commit refs are immutable,
    // so resolve the latest commit first to always get the freshest build
    async function resolveRef() {
        try {
            const res = await fetch(`https://api.github.com/repos/${REPO}/commits/master`, {
                headers: { Accept: 'application/vnd.github.sha' }
            });
            if (res.ok) return (await res.text()).trim();
        } catch (e) {
            console.warn('[HSMain] Could not resolve latest commit, falling back to master', e);
        }
        return 'master';
    }

    // GitHub raw serves text/plain, so it can't be a <script src>; fetch it and inject the code inline instead.
    // jsDelivr is only a fallback, its GitHub backend is sometimes down for uncached files (503).
    async function fetchBuild(ref) {
        const sources = [
            `https://raw.githubusercontent.com/${REPO}/${ref}/${BUILD_PATH}`,
            `https://cdn.jsdelivr.net/gh/${REPO}@${ref}/${BUILD_PATH}`
        ];

        for (const url of sources) {
            try {
                const res = await fetch(url, { cache: 'no-cache' });
                if (res.ok) return await res.text();
                console.warn(`[HSMain] ${url} returned ${res.status}`);
            } catch (e) {
                console.warn(`[HSMain] Fetching ${url} failed`, e);
            }
        }
        return null;
    }

    async function loadHypersynergism() {
        if ('hypersynergism' in pageWindow) {
            alert('Hypersynergism is already loaded on the page, please refresh if you want to reload the mod');
            return true;
        }

        const ref = await resolveRef();
        const code = await fetchBuild(ref);

        if (!code) {
            console.error('[HSMain] Failed to load the mod!');
            return false;
        }

        const script = document.createElement('script');
        script.textContent = `${code}\n//# sourceURL=hypersynergism_release.js`;
        document.head.appendChild(script);

        // The build assigns window.hypersynergism asynchronously, so wait for it before init
        return await new Promise(resolve => {
            const started = Date.now();
            const timer = setInterval(() => {
                if (pageWindow.hypersynergism) {
                    clearInterval(timer);
                    console.log(`[HSMain] Personal build loaded (${ref})`);
                    pageWindow.hypersynergism.init();
                    resolve(true);
                } else if (Date.now() - started > 15000) {
                    clearInterval(timer);
                    console.error('[HSMain] Failed to load the mod (timeout)');
                    resolve(false);
                }
            }, 50);
        });
    }

    // Same workflow as the bookmark: load on demand, after the offline-progress dialog is closed
    let loading = false;
    let loaded = false;
    async function startLoad() {
        if (loading || loaded) return;
        loading = true;
        document.getElementById('hs-personal-load')?.remove();
        loaded = await loadHypersynergism();
        // On failure the button comes back so loading can be retried without a refresh
        loading = false;
    }

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Load Hypersynergism', startLoad);
    }

    function ensureButton() {
        if (loading || loaded || document.getElementById('hs-personal-load') || !document.body) return;
        const btn = document.createElement('button');
        btn.id = 'hs-personal-load';
        btn.textContent = 'Load HS';
        btn.title = 'Load Hypersynergism (personal build)';
        btn.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:2147483647;padding:4px 10px;' +
            'background:#1e1e2e;color:#cba6f7;border:1px solid #cba6f7;border-radius:4px;cursor:pointer;font:12px sans-serif;opacity:.8';
        btn.addEventListener('click', startLoad);
        document.body.appendChild(btn);
    }

    // The game rebuilds parts of the page while loading, so re-add the button if it gets removed
    ensureButton();
    const keeper = setInterval(() => {
        if (loaded) clearInterval(keeper);
        else ensureButton();
    }, 1000);
})();
