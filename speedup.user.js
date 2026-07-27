// ==UserScript==
// @name         SpeedUp — Bilibili & YouTube
// @namespace    https://github.com/RyanStarFox/SpeedUp
// @version      1.4.1
// @description  Richer playback speeds with native-bar UX, memory, and hold O/P
// @author       SpeedUp
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @match        https://www.youtube-nocookie.com/*
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/bangumi/play/*
// @match        https://www.bilibili.com/festival/*
// @match        https://bilibili.com/video/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  // ─────────────────────────────────────────────────────────────
  // CONFIG — edit here
  // ─────────────────────────────────────────────────────────────
  const CONFIG = {
    // 'per-site' = separate remembered rates for YouTube / Bilibili (default)
    // 'global'   = one key per site origin. Browsers do not allow localStorage
    //              to be shared between youtube.com and bilibili.com.
    memoryMode: 'per-site',

    presets: [0.5, 1, 1.5, 2, 2.5, 3],
    min: 0.1,
    max: 8.0,
    holdDelayMs: 500,
    holdBoost: 1.5, // long-press P
    holdSlow: 0.5, // long-press O
    debug: false,
  };

  const log = (...args) => {
    if (CONFIG.debug) console.log('[SpeedUp]', ...args);
  };

  // @grant none keeps the code in the page realm, which works in Safari,
  // Tampermonkey, and the Userscripts Safari extension.
  const win = window;

  try {
    if (document.documentElement?.hasAttribute('data-speedup')) return;
    document.documentElement?.setAttribute('data-speedup', '1');
  } catch (_) {
    /* ignore */
  }

  // ─────────────────────────────────────────────────────────────
  // Rate math
  // ─────────────────────────────────────────────────────────────
  function clampRate(n) {
    return Math.min(CONFIG.max, Math.max(CONFIG.min, n));
  }

  function roundRate(n) {
    return Math.round(n * 10) / 10;
  }

  function effectiveRate(baseRate, holdMultiplier) {
    return clampRate(roundRate(baseRate * holdMultiplier));
  }

  function parseCustomRate(raw) {
    if (raw == null || String(raw).trim() === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return clampRate(n);
  }

  function formatRate(rate) {
    const r = roundRate(rate);
    return (Number.isInteger(r) ? r.toFixed(1) : String(r)) + 'x';
  }

  // ─────────────────────────────────────────────────────────────
  // Site detect
  // ─────────────────────────────────────────────────────────────
  function detectSite() {
    const host = location.hostname;
    if (host.includes('youtube')) return 'youtube';
    if (host.includes('bilibili')) return 'bilibili';
    return null;
  }

  function shouldSkipPage(siteId) {
    const path = location.pathname;
    if (siteId === 'youtube' && path.startsWith('/shorts')) return true;
    if (siteId === 'bilibili' && path.startsWith('/live')) return true;
    return false;
  }

  // ─────────────────────────────────────────────────────────────
  // Storage
  // ─────────────────────────────────────────────────────────────
  const Storage = {
    _rateKey(siteId) {
      return CONFIG.memoryMode === 'global' ? 'rate:global' : `rate:${siteId}`;
    },
    _customKey(siteId) {
      return CONFIG.memoryMode === 'global' ? 'custom:global' : `custom:${siteId}`;
    },
    getRate(siteId) {
      try {
        const v = localStorage.getItem(`speedup:${this._rateKey(siteId)}`);
        return clampRate(Number(v) || 1);
      } catch (_) {
        return 1;
      }
    },
    setRate(siteId, rate) {
      try {
        localStorage.setItem(`speedup:${this._rateKey(siteId)}`, String(clampRate(rate)));
      } catch (_) {
        /* ignore */
      }
    },
    getCustom(siteId) {
      try {
        const v = localStorage.getItem(`speedup:${this._customKey(siteId)}`);
        return v === '' || v == null ? '' : String(v);
      } catch (_) {
        return '';
      }
    },
    setCustom(siteId, rate) {
      try {
        localStorage.setItem(`speedup:${this._customKey(siteId)}`, String(clampRate(rate)));
      } catch (_) {
        /* ignore */
      }
    },
  };

  // ─────────────────────────────────────────────────────────────
  // Write only to media elements we can see. Do not alter browser-wide
  // prototypes: Bilibili's application code relies on those descriptors.
  // ─────────────────────────────────────────────────────────────
  const RateWriter = (() => {
    let desired = 1;

    function setDesired(rate) {
      desired = rate;
    }

    function applyAll(rate) {
      desired = rate;
      const list = document.querySelectorAll('video');
      for (const el of list) {
        try {
          el.playbackRate = rate;
        } catch (_) {
          /* ignore */
        }
      }
    }

    function enforce() {
      const list = document.querySelectorAll('video');
      for (const el of list) {
        try {
          if (Math.abs(el.playbackRate - desired) > 0.05) {
            el.playbackRate = desired;
          }
        } catch (_) {
          /* ignore */
        }
      }
    }

    return { applyAll, enforce, setDesired, getDesired: () => desired };
  })();

  // ─────────────────────────────────────────────────────────────
  // SpeedController
  // ─────────────────────────────────────────────────────────────
  class SpeedController {
    constructor(siteId) {
      this.siteId = siteId;
      this.baseRate = Storage.getRate(siteId);
      this.holdMultiplier = 1;
      this._holdKey = null;
      this._holdTimer = null;
      this._listeners = new Set();
    }

    getBaseRate() {
      return this.baseRate;
    }

    getEffectiveRate() {
      return effectiveRate(this.baseRate, this.holdMultiplier);
    }

    setBaseRate(rate) {
      this.baseRate = clampRate(rate);
      Storage.setRate(this.siteId, this.baseRate);
      this._emit();
    }

    setCustomAndBase(rate) {
      this.setBaseRate(rate);
      Storage.setCustom(this.siteId, this.baseRate);
    }

    onChange(cb) {
      this._listeners.add(cb);
      return () => this._listeners.delete(cb);
    }

    _emit() {
      const rate = this.getEffectiveRate();
      for (const cb of this._listeners) {
        try {
          cb(rate, this);
        } catch (e) {
          console.warn('[SpeedUp] onChange error', e);
        }
      }
    }

    _isEditableTarget(el) {
      if (!el) return false;
      // Walk composed path for shadow DOM focus
      const path = typeof el.getRootNode === 'function' ? null : null;
      let node = el;
      try {
        if (el.shadowRoot == null && el.getRootNode) {
          /* keep node */
        }
      } catch (_) {
        /* ignore */
      }
      while (node && node !== document && node !== win) {
        if (node.nodeType === 1) {
          const tag = (node.tagName || '').toLowerCase();
          if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
          if (node.isContentEditable) return true;
        }
        node = node.parentElement || node.parentNode;
        if (node && node.nodeType === 11 /* DocumentFragment / shadow root */) {
          node = node.host || null;
        }
      }
      return false;
    }

    bindKeys() {
      const onKeyDown = (e) => {
        if (e.repeat) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (this._isEditableTarget(e.target) || this._isEditableTarget(document.activeElement)) {
          return;
        }

        // Prefer physical key codes so layout / IME noise matters less
        const code = e.code;
        let kind = null;
        if (code === 'KeyP' || e.key === 'p' || e.key === 'P') kind = 'p';
        if (code === 'KeyO' || e.key === 'o' || e.key === 'O') kind = 'o';
        if (!kind) return;
        if (this._holdKey) return;

        this._holdKey = kind;
        const multiplier = kind === 'p' ? CONFIG.holdBoost : CONFIG.holdSlow;
        log('hold armed', kind);
        this._holdTimer = setTimeout(() => {
          this._holdTimer = null;
          this.holdMultiplier = multiplier;
          log('hold active', kind, this.getEffectiveRate());
          this._emit();
        }, CONFIG.holdDelayMs);
      };

      const clearHold = (reason) => {
        if (this._holdTimer) {
          clearTimeout(this._holdTimer);
          this._holdTimer = null;
        }
        const had = this._holdKey != null || this.holdMultiplier !== 1;
        this._holdKey = null;
        if (this.holdMultiplier !== 1) {
          this.holdMultiplier = 1;
          log('hold cleared', reason);
          this._emit();
        } else if (had) {
          log('hold cancelled before fire', reason);
        }
      };

      const onKeyUp = (e) => {
        const code = e.code;
        const isHoldKey =
          code === 'KeyP' ||
          code === 'KeyO' ||
          e.key === 'p' ||
          e.key === 'P' ||
          e.key === 'o' ||
          e.key === 'O';
        if (isHoldKey && this._holdKey) clearHold('keyup');
      };

      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('keyup', onKeyUp, true);
      win.addEventListener('blur', () => clearHold('blur'));
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) clearHold('hidden');
      });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Shared menu UI
  // ─────────────────────────────────────────────────────────────
  function fillMenu(menuEl, controller, opts) {
    const { itemClass, activeClass, customClass, inputClass, itemTag = 'div', siteId } = opts;
    menuEl.textContent = '';

    for (const p of CONFIG.presets) {
      const item = document.createElement(itemTag);
      item.className = itemClass;
      item.dataset.rate = String(p);
      item.textContent = formatRate(p);
      if (Math.abs(controller.getBaseRate() - p) < 0.05) {
        item.classList.add(activeClass);
      }
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        controller.setBaseRate(p);
        fillMenu(menuEl, controller, opts);
      });
      menuEl.appendChild(item);
    }

    const row = document.createElement('div');
    row.className = customClass;
    const input = document.createElement('input');
    input.className = inputClass;
    input.type = 'number';
    input.min = String(CONFIG.min);
    input.max = String(CONFIG.max);
    input.step = '0.1';
    input.placeholder = `${CONFIG.min}-${CONFIG.max}`;
    input.value = Storage.getCustom(siteId) || '';

    const apply = () => {
      const parsed = parseCustomRate(input.value);
      if (parsed == null) {
        input.value = Storage.getCustom(siteId) || '';
        return;
      }
      input.value = String(parsed);
      controller.setCustomAndBase(parsed);
      fillMenu(menuEl, controller, opts);
    };

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        apply();
        input.blur();
      }
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    input.addEventListener('keypress', (e) => e.stopPropagation());
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('blur', apply);

    row.appendChild(input);
    menuEl.appendChild(row);
  }

  // ─────────────────────────────────────────────────────────────
  // YouTube adapter — inject ytp-style speed button
  // ─────────────────────────────────────────────────────────────
  class YouTubeAdapter {
    constructor(controller) {
      this.controller = controller;
      this._labelEl = null;
      this._menu = null;
      this._wrap = null;
    }

    start() {
      const tryMount = () => {
        if (shouldSkipPage('youtube')) return false;
        const controls =
          document.querySelector('#movie_player .ytp-right-controls') ||
          document.querySelector('.ytp-right-controls');
        if (!controls) return false;

        if (!controls.querySelector('.speedup-yt-wrap')) {
          this._inject(controls);
        } else {
          this._wrap = controls.querySelector('.speedup-yt-wrap');
          this._labelEl = this._wrap.querySelector('.speedup-yt-label');
          this._menu = this._wrap.querySelector('.speedup-yt-menu');
        }
        this.applyRate(this.controller.getEffectiveRate());
        return true;
      };

      const waitForControls = () => {
        if (!tryMount()) setTimeout(waitForControls, 300);
      };
      document.addEventListener('yt-navigate-finish', () => setTimeout(tryMount, 200));
      waitForControls();
    }

    _inject(controls) {
      if (document.getElementById('speedup-yt-style')) {
        /* already */
      } else {
        const style = document.createElement('style');
        style.id = 'speedup-yt-style';
        style.textContent = `
          .speedup-yt-wrap { position: relative; display: inline-block; vertical-align: top; }
          .speedup-yt-btn { min-width: 48px !important; }
          .speedup-yt-label {
            font-size: 13px; font-weight: 500; display: flex; align-items: center;
            justify-content: center; height: 100%; min-width: 40px; color: #fff;
          }
          .speedup-yt-menu {
            position: absolute; bottom: 52px; right: 0; background: rgba(28,28,28,.95);
            border-radius: 8px; padding: 6px 0; min-width: 128px; z-index: 10000;
            box-shadow: 0 4px 16px rgba(0,0,0,.45);
          }
          .speedup-yt-menu[hidden] { display: none !important; }
          .speedup-yt-item {
            padding: 8px 16px; color: #fff; cursor: pointer; font-size: 13px;
          }
          .speedup-yt-item:hover { background: rgba(255,255,255,.1); }
          .speedup-yt-item.speedup-active { background: rgba(255,255,255,.16); }
          .speedup-yt-custom { padding: 6px 12px; }
          .speedup-yt-input {
            width: 100%; box-sizing: border-box; background: #111; border: 1px solid #555;
            color: #fff; border-radius: 4px; padding: 4px 6px; font-size: 12px;
          }
        `;
        (document.head || document.documentElement).appendChild(style);
      }

      const wrap = document.createElement('div');
      wrap.className = 'speedup-yt-wrap';

      const btn = document.createElement('button');
      btn.className = 'ytp-button speedup-yt-btn';
      btn.type = 'button';
      btn.title = 'SpeedUp playback speed';
      btn.setAttribute('aria-label', 'Playback speed');

      const label = document.createElement('div');
      label.className = 'speedup-yt-label';
      label.textContent = formatRate(this.controller.getEffectiveRate());
      btn.appendChild(label);

      const menu = document.createElement('div');
      menu.className = 'speedup-yt-menu';
      menu.hidden = true;

      const rebuild = () => {
        fillMenu(menu, this.controller, {
          siteId: 'youtube',
          itemClass: 'speedup-yt-item',
          activeClass: 'speedup-active',
          customClass: 'speedup-yt-custom',
          inputClass: 'speedup-yt-input',
        });
      };
      rebuild();

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        menu.hidden = !menu.hidden;
        if (!menu.hidden) rebuild();
      });

      document.addEventListener(
        'click',
        (e) => {
          if (!wrap.contains(e.target)) menu.hidden = true;
        },
        true
      );

      wrap.appendChild(btn);
      wrap.appendChild(menu);

      controls.appendChild(wrap);

      this._wrap = wrap;
      this._labelEl = label;
      this._menu = menu;
      this._rebuild = rebuild;
      log('YouTube control mounted');
    }

    applyRate(rate) {
      const video =
        document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (video) video.playbackRate = rate;
      if (this._labelEl) this._labelEl.textContent = formatRate(rate);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Bilibili adapter — replace only the existing native speed menu
  // ─────────────────────────────────────────────────────────────
  class BilibiliAdapter {
    constructor(controller) {
      this.controller = controller;
      this._labelEl = null;
      this._ctrl = null;
    }

    start() {
      const mount = () => {
        const menu =
          document.querySelector('ul.bpx-player-ctrl-playbackrate-menu') ||
          document.querySelector('.bpx-player-ctrl-playbackrate-menu');
        const video = document.querySelector('video') || document.querySelector('bwp-video');
        if (!menu || !video) return false;

        const rebuild = () => {
          fillMenu(menu, this.controller, {
            siteId: 'bilibili',
            itemClass: 'bpx-player-ctrl-playbackrate-menu-item',
            activeClass: 'bpx-player-ctrl-playbackrate-menu-item-active',
            customClass: 'bpx-player-ctrl-playbackrate-menu-item',
            inputClass: 'speedup-bili-input',
            itemTag: 'li',
          });
        };
        rebuild();
        this._rebuild = rebuild;

        if (!video.dataset.speedupPlayingListener) {
          video.dataset.speedupPlayingListener = '1';
          video.addEventListener('playing', () => this.applyRate(this.controller.getEffectiveRate()));
        }
        this.applyRate(this.controller.getEffectiveRate());
        return true;
      };

      const waitForMenu = () => {
        if (!mount()) setTimeout(waitForMenu, 300);
      };
      waitForMenu();
      window.addEventListener('hashchange', () => setTimeout(waitForMenu, 300));
    }

    _injectCss() {
      if (document.getElementById('speedup-bili-style')) return;
      const style = document.createElement('style');
      style.id = 'speedup-bili-style';
      style.textContent = `
        /* Hide native speed control — we replace it */
        .bpx-player-ctrl-playbackrate { display: none !important; }

        .speedup-bili-ctrl {
          position: relative;
          cursor: pointer;
          display: flex;
          align-items: center;
          height: 100%;
          padding: 0 8px;
          white-space: nowrap;
          user-select: none;
        }
        .speedup-bili-label { font-size: 14px; line-height: 1; }
        .speedup-bili-menu {
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          margin-bottom: 8px;
          min-width: 96px;
          background: rgba(21,21,21,.9);
          border-radius: 4px;
          padding: 6px 0;
          z-index: 9999;
          box-shadow: 0 2px 8px rgba(0,0,0,.35);
        }
        .speedup-bili-menu[hidden] { display: none !important; }
        .speedup-bili-item {
          padding: 6px 14px;
          text-align: center;
          cursor: pointer;
          font-size: 13px;
          color: #fff;
        }
        .speedup-bili-item:hover { background: rgba(255,255,255,.08); }
        .speedup-bili-item.speedup-active { color: #00a1d6; }
        .speedup-bili-custom { padding: 4px 8px; }
        .speedup-bili-input {
          width: 72px; box-sizing: border-box; padding: 2px 4px; font-size: 12px;
          border: 1px solid rgba(255,255,255,.25); background: rgba(0,0,0,.35);
          color: #fff; border-radius: 2px;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }

    _buildControl() {
      const ctrl = document.createElement('div');
      ctrl.className = 'bpx-player-ctrl-btn speedup-bili-ctrl';
      ctrl.title = 'SpeedUp 倍速';

      const label = document.createElement('span');
      label.className = 'speedup-bili-label';
      label.textContent = formatRate(this.controller.getEffectiveRate());
      ctrl.appendChild(label);

      const menu = document.createElement('div');
      menu.className = 'speedup-bili-menu';
      menu.hidden = true;
      ctrl.appendChild(menu);

      const rebuild = () => {
        fillMenu(menu, this.controller, {
          siteId: 'bilibili',
          itemClass: 'speedup-bili-item',
          activeClass: 'speedup-active',
          customClass: 'speedup-bili-custom',
          inputClass: 'speedup-bili-input',
        });
      };
      rebuild();

      ctrl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        menu.hidden = !menu.hidden;
        if (!menu.hidden) rebuild();
      });

      document.addEventListener(
        'click',
        (e) => {
          if (!ctrl.contains(e.target)) menu.hidden = true;
        },
        true
      );

      this._ctrl = ctrl;
      this._labelEl = label;
      this._menu = menu;
      this._rebuild = rebuild;
      return ctrl;
    }

    _ensureControl() {
      if (document.querySelector('.speedup-bili-ctrl')) {
        this._ctrl = document.querySelector('.speedup-bili-ctrl');
        this._labelEl = this._ctrl.querySelector('.speedup-bili-label');
        this.applyRate(this.controller.getEffectiveRate());
        return true;
      }

      const native = document.querySelector('.bpx-player-ctrl-playbackrate');
      const ctrl = this._buildControl();

      if (native && native.parentElement) {
        native.parentElement.insertBefore(ctrl, native);
        this.applyRate(this.controller.getEffectiveRate());
        log('Bilibili control mounted beside native');
        return true;
      }

      // Fallback: right control cluster
      const right =
        document.querySelector('.bpx-player-control-bottom-right') ||
        document.querySelector('.bpx-player-ctrl-btn')?.parentElement;
      if (right) {
        const before =
          right.querySelector(
            '.bpx-player-ctrl-subtitle, .bpx-player-ctrl-volume, .bpx-player-ctrl-setting'
          ) || null;
        right.insertBefore(ctrl, before);
        this.applyRate(this.controller.getEffectiveRate());
        log('Bilibili control mounted in right cluster');
        return true;
      }

      return false;
    }

    applyRate(rate) {
      const video = document.querySelector('video') || document.querySelector('bwp-video');
      if (video && 'playbackRate' in video) video.playbackRate = rate;
      const result = document.querySelector('.bpx-player-ctrl-playbackrate-result');
      if (result) result.textContent = formatRate(rate);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Boot
  // ─────────────────────────────────────────────────────────────
  function boot() {
    const siteId = detectSite();
    if (!siteId) return;
    if (shouldSkipPage(siteId)) {
      log('skip page', location.pathname);
      return;
    }

    const controller = new SpeedController(siteId);
    RateWriter.setDesired(controller.getEffectiveRate());

    const adapter =
      siteId === 'youtube' ? new YouTubeAdapter(controller) : new BilibiliAdapter(controller);

    controller.onChange((rate) => {
      adapter.applyRate(rate);
    });
    controller.bindKeys();

    const start = () => {
      adapter.start();
      adapter.applyRate(controller.getEffectiveRate());
      console.info(
        `[SpeedUp] v1.4.1 active on ${siteId} — base ${formatRate(controller.getBaseRate())}. Hold O/P 0.5s to temp slow/boost.`
      );
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }

    // Keep rate stuck even if the site fights back
    // Do not continuously rewrite video rates. Sites can safely keep their
    // own lifecycle; the remembered rate is applied at startup and on change.
  }

  boot();
})();
