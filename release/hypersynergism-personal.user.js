// ==UserScript==
// @name         Hypersynergism (personal build)
// @namespace    hypersynergism-personal
// @version      2026.10.15
// @description  Loads Hypersynergism from the philipsteingruber/hypersynergism-personal fork (locale-aware number parsing fixes). Click "Load HS" after closing the "Since you were away" box.
// @match        https://synergism.cc/*
// @match        https://www.synergism.cc/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/philipsteingruber/hypersynergism-personal/master/release/hypersynergism-personal.user.js
// @downloadURL  https://raw.githubusercontent.com/philipsteingruber/hypersynergism-personal/master/release/hypersynergism-personal.user.js
// ==/UserScript==

(function () {
    'use strict';

    const REPO = 'philipsteingruber/hypersynergism-personal';
    const BUILD_PATH = 'release/mod/hypersynergism_release.js';

    // jsDelivr caches branch refs (@master) for up to 12h, but commit refs are immutable,
    // so resolve the latest commit first to always get the freshest build
    async function resolveRef() {
        try {
            const res = await fetch(`https://api.github.com/repos/${REPO}/commits/master`, {
                headers: { Accept: 'application/vnd.github.sha' }
            });
            if (res.ok) return (await res.text()).trim();
        } catch (e) {
            console.warn('[HSMain] Could not resolve latest commit, falling back to @master', e);
        }
        return 'master';
    }

    async function loadHypersynergism() {
        if ('hypersynergism' in window) {
            alert('Hypersynergism is already loaded on the page, please refresh if you want to reload the mod');
            return;
        }

        const ref = await resolveRef();
        const script = document.createElement('script');
        script.src = `https://cdn.jsdelivr.net/gh/${REPO}@${ref}/${BUILD_PATH}`;

        script.onload = function () {
            // The build assigns window.hypersynergism asynchronously, so wait for it before init
            const started = Date.now();
            const timer = setInterval(() => {
                if (window.hypersynergism) {
                    clearInterval(timer);
                    console.log(`[HSMain] Personal build loaded (${ref})`);
                    window.hypersynergism.init();
                } else if (Date.now() - started > 15000) {
                    clearInterval(timer);
                    console.error('[HSMain] Failed to load the mod (timeout)');
                }
            }, 50);
        };

        script.onerror = function () {
            console.error('[HSMain] Failed to load the mod!');
        };

        document.head.appendChild(script);
    }

    // Same workflow as the bookmark: load on demand, after the offline-progress dialog is closed
    const btn = document.createElement('button');
    btn.textContent = 'Load HS';
    btn.title = 'Load Hypersynergism (personal build)';
    btn.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:99999;padding:4px 10px;' +
        'background:#1e1e2e;color:#cba6f7;border:1px solid #cba6f7;border-radius:4px;cursor:pointer;font:12px sans-serif;opacity:.8';
    btn.addEventListener('click', () => {
        btn.remove();
        loadHypersynergism();
    });
    document.body.appendChild(btn);
})();
