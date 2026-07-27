// ==UserScript==
// @name         SpeedUp — Bilibili & YouTube
// @namespace    https://github.com/RyanStarFox/SpeedUp
// @version      1.7.0
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
// @license      MIT
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
    max: 10.0,
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

  function formatRate(rate, suffix = 'x') {
    const r = roundRate(rate);
    return (Number.isInteger(r) ? r.toFixed(1) : String(r)) + suffix;
  }

  function formatControlRate(rate, suffix = 'x') {
    return clampRate(roundRate(rate)).toFixed(1) + suffix;
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
      this._speedKey = null;
      this._speedHoldTimer = null;
      this._speedRepeatTimer = null;
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
      const isVideoPlaying = () => {
        const video =
          document.querySelector('#movie_player video, .bpx-player video, .bilibili-player video') ||
          document.querySelector('video');
        return Boolean(video && !video.paused && !video.ended);
      };
      const isTextEditing = (event) => {
        let deepActive = document.activeElement;
        while (deepActive?.shadowRoot?.activeElement) {
          deepActive = deepActive.shadowRoot.activeElement;
        }
        if (this._isEditableTarget(deepActive)) return true;

        const composedPath = event.composedPath?.() || [];
        if (
          composedPath.some((node) => {
            if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
            const tag = node.tagName?.toLowerCase();
            return (
              tag === 'input' ||
              tag === 'textarea' ||
              tag === 'select' ||
              node.isContentEditable ||
              tag === 'bili-comment-textarea' ||
              tag === 'bili-comment-box'
            );
          })
        ) {
          return true;
        }
        if (
          this._isEditableTarget(event.target) ||
          this._isEditableTarget(document.activeElement)
        ) {
          return true;
        }
        return Boolean(
          document.querySelector(
            [
              'input:focus',
              'textarea:focus',
              '[contenteditable]:focus',
              '[contenteditable]:focus-within',
              '.reply-box-textarea:focus-within',
              '.reply-box:focus-within',
              '.ql-editor:focus-within',
              '.bpx-player-dm-input:focus-within',
              'bili-comment-textarea:focus-within',
              'bili-comment-box:focus-within',
              'iframe:focus',
            ].join(', ')
          )
        );
      };
      const clearSpeedRepeat = () => {
        if (this._speedHoldTimer) clearTimeout(this._speedHoldTimer);
        if (this._speedRepeatTimer) clearTimeout(this._speedRepeatTimer);
        this._speedHoldTimer = null;
        this._speedRepeatTimer = null;
        this._speedKey = null;
      };

      const onKeyDown = (e) => {
        if (e.repeat) {
          if (['Comma', 'Period', 'Semicolon', 'Quote'].includes(e.code)) {
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (isTextEditing(e)) {
          return;
        }

        // Prefer physical key codes so layout / IME noise matters less
        const code = e.code;
        const step = { Comma: -0.1, Period: 0.1, Semicolon: -0.5, Quote: 0.5 }[code];
        if (step && isVideoPlaying()) {
          e.preventDefault();
          e.stopPropagation();
          this.setBaseRate(roundRate(this.baseRate + step));
          if (this._speedKey) return;
          this._speedKey = code;
          const repeatStep = step;
          const repeatEvery = code === 'Semicolon' || code === 'Quote' ? 200 : 100;
          this._speedHoldTimer = setTimeout(() => {
            const tick = () => {
              if (!this._speedKey) return;
              this.setBaseRate(roundRate(this.baseRate + repeatStep));
              this._speedRepeatTimer = setTimeout(tick, repeatEvery);
            };
            tick();
          }, 500);
          return;
        }
        let kind = null;
        if (code === 'KeyP') kind = 'p';
        if (code === 'KeyO') kind = 'o';
        if (!kind) return;
        if (!isVideoPlaying()) return;
        if (this._holdKey) return;
        e.preventDefault();
        e.stopPropagation();

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
        if (['Comma', 'Period', 'Semicolon', 'Quote'].includes(code)) {
          clearSpeedRepeat();
          return;
        }
        const isHoldKey =
          code === 'KeyO' ||
          code === 'KeyP';
        if (isHoldKey && this._holdKey) {
          const pendingShortPress = this._holdTimer != null;
          const holdKey = this._holdKey;
          clearHold('keyup');
          if (pendingShortPress) {
            const video =
              document.querySelector('#movie_player video, .bpx-player video, .bilibili-player video') ||
              document.querySelector('video');
            if (video) {
              const delta = holdKey === 'o' ? -5 : 5;
              video.currentTime = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + delta));
            }
          }
        }
      };

      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('keyup', onKeyUp, true);
      win.addEventListener('blur', () => {
        clearHold('blur');
        clearSpeedRepeat();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          clearHold('hidden');
          clearSpeedRepeat();
        }
      });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Shared menu UI
  // ─────────────────────────────────────────────────────────────
  function fillMenu(menuEl, controller, opts) {
    const { itemClass, activeClass, customClass, inputClass, itemTag = 'div', siteId } = opts;
    menuEl.textContent = '';

    const rates = opts.reverse ? [...CONFIG.presets].reverse() : CONFIG.presets;
    for (const p of rates) {
      const item = document.createElement(itemTag);
      item.className = itemClass;
      item.dataset.rate = String(p);
      item.textContent = formatRate(p, opts.suffix);
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
    const currentRate = controller.getBaseRate();
    const isPreset = CONFIG.presets.some((preset) => Math.abs(preset - currentRate) < 0.05);
    input.value = isPreset ? '' : currentRate.toFixed(1);
    Object.assign(input.style, {
      background: 'transparent',
      color: 'inherit',
      border: '0',
      outline: '0',
      width: '100%',
      textAlign: 'center',
      font: 'inherit',
      textIndent: '4px',
    });

    const apply = () => {
      const parsed = parseCustomRate(input.value);
      if (parsed == null) {
        input.value = isPreset ? '' : currentRate.toFixed(1);
        return;
      }
      input.value = parsed.toFixed(1);
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
    if (opts.customFirst) menuEl.insertBefore(row, menuEl.firstChild);
    else menuEl.appendChild(row);
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
        this._normalizeRateLabel();
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
          .speedup-yt-btn { min-width: 48px !important; position: relative !important; }
          .speedup-yt-label {
            font-size: 14px; font-weight: 500; display: flex; align-items: center;
            justify-content: center; position: absolute; inset: -12px 0 0 0 !important;
            color: #fff; line-height: 1; transform: none !important;
          }
          .speedup-yt-menu {
            position: absolute; bottom: 52px; right: 0; background: rgba(28,28,28,.95);
            border-radius: 8px; padding: 6px 0; min-width: 128px; z-index: 10000;
            box-shadow: 0 4px 16px rgba(0,0,0,.45);
            max-height: min(420px, 70vh); overflow-y: auto;
          }
          .speedup-yt-menu[hidden] { display: none !important; }
          .speedup-yt-item {
            padding: 4px 16px; color: #fff; cursor: pointer; font-size: 16px; text-align: center; line-height: 20px;
          }
          .speedup-yt-item:hover { background: rgba(255,255,255,.1); }
          .speedup-yt-item.speedup-active { background: rgba(255,255,255,.16); }
          .speedup-yt-custom { padding: 4px 12px; text-align: center; line-height: 20px; font-size: 16px; }
          .speedup-yt-input {
            width: 100%; height: 28px; box-sizing: border-box; background: transparent; border: 0;
            color: #fff; border-radius: 0; padding: 4px 6px; font-size: 16px !important; text-align: center;
            line-height: 20px; -webkit-appearance: none;
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
      label.textContent = formatControlRate(this.controller.getEffectiveRate(), '');
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
          reverse: true,
          customFirst: true,
          suffix: '',
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
      if (this._labelEl) this._labelEl.textContent = formatControlRate(rate, '');
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
      if (!this._rateEventBound) {
        this._rateEventBound = true;
        const normalizeAfterMediaEvent = (event) => {
          if (event.target?.tagName !== 'VIDEO') return;
          [0, 50, 200, 500, 1000, 2000].forEach((delay) => {
            setTimeout(() => this._normalizeRateLabel(), delay);
          });
        };
        document.addEventListener('playing', normalizeAfterMediaEvent, true);
        document.addEventListener('pause', normalizeAfterMediaEvent, true);
      }

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
            reverse: true,
            customFirst: true,
          });
        };
        rebuild();
        this._rebuild = rebuild;

        if (!video.dataset.speedupPlayingListener) {
          video.dataset.speedupPlayingListener = '1';
          video.addEventListener('playing', () => {
            this.applyRate(this.controller.getEffectiveRate());
          });
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

    _normalizeRateLabel() {
      const label = document.querySelector('.bpx-player-ctrl-playbackrate-result');
      if (!label) {
        setTimeout(() => this._normalizeRateLabel(), 300);
        return;
      }

      const normalize = () => {
        const rate = Number.parseFloat(label.textContent);
        if (!Number.isFinite(rate)) return;
        const formatted = formatControlRate(rate);
        if (label.textContent !== formatted) label.textContent = formatted;
      };
      normalize();

      const control =
        label.closest('.bpx-player-ctrl-playbackrate') || label.parentElement;
      if (control && !control.dataset.speedupRateControlObserver) {
        control.dataset.speedupRateControlObserver = '1';
        new MutationObserver(() => this._normalizeRateLabel()).observe(control, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      }
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
      if (result) result.textContent = formatControlRate(rate);
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
