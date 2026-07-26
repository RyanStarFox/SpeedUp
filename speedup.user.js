// ==UserScript==
// @name         SpeedUp — Bilibili & YouTube
// @namespace    https://github.com/speedup
// @version      1.0.0
// @description  Richer playback speeds with native-menu UX, memory, and hold O/P
// @author       SpeedUp
// @match        https://www.youtube.com/*
// @match        https://www.youtube-nocookie.com/*
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/bangumi/play/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // CONFIG — edit here
  // ─────────────────────────────────────────────────────────────
  const CONFIG = {
    // 'per-site' = separate remembered rates for YouTube / Bilibili (default, choice B)
    // 'global'   = one shared rate across both sites (choice A) — change this line to 'global'
    memoryMode: 'per-site',

    presets: [0.5, 1, 1.5, 2, 2.5, 3],
    min: 0.1,
    max: 8.0,
    holdDelayMs: 500,
    holdBoost: 1.5, // long-press P
    holdSlow: 0.5, // long-press O
  };

  // ─────────────────────────────────────────────────────────────
  // Rate math (mirrors lib/rate-math.js)
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
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
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
      const v = GM_getValue(this._rateKey(siteId), 1);
      return clampRate(Number(v) || 1);
    },
    setRate(siteId, rate) {
      GM_setValue(this._rateKey(siteId), clampRate(rate));
    },
    getCustom(siteId) {
      const v = GM_getValue(this._customKey(siteId), '');
      return v === '' || v == null ? '' : String(v);
    },
    setCustom(siteId, rate) {
      GM_setValue(this._customKey(siteId), String(clampRate(rate)));
    },
  };

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
      for (const cb of this._listeners) {
        try {
          cb(this.getEffectiveRate(), this);
        } catch (e) {
          console.warn('[SpeedUp] onChange error', e);
        }
      }
    }

    _isEditableTarget(el) {
      if (!el || el === document.body) return false;
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (el.isContentEditable) return true;
      return false;
    }

    bindKeys() {
      const onKeyDown = (e) => {
        if (e.repeat) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (this._isEditableTarget(e.target)) return;

        const key = e.key.toLowerCase();
        if (key !== 'o' && key !== 'p') return;
        if (this._holdKey) return; // ignore second key while holding

        this._holdKey = key;
        const multiplier = key === 'p' ? CONFIG.holdBoost : CONFIG.holdSlow;
        this._holdTimer = setTimeout(() => {
          this._holdTimer = null;
          this.holdMultiplier = multiplier;
          this._emit();
        }, CONFIG.holdDelayMs);
      };

      const clearHold = () => {
        if (this._holdTimer) {
          clearTimeout(this._holdTimer);
          this._holdTimer = null;
        }
        const wasHolding = this.holdMultiplier !== 1 || this._holdKey;
        this._holdKey = null;
        if (this.holdMultiplier !== 1) {
          this.holdMultiplier = 1;
          this._emit();
        } else if (wasHolding) {
          // timer cancelled before fire — nothing to emit
        }
      };

      const onKeyUp = (e) => {
        const key = e.key.toLowerCase();
        if (key === this._holdKey || ((key === 'o' || key === 'p') && this._holdKey)) {
          clearHold();
        }
      };

      window.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('keyup', onKeyUp, true);
      window.addEventListener('blur', clearHold);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) clearHold();
      });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // playbackRate lock (mainly for Bilibili resets)
  // ─────────────────────────────────────────────────────────────
  const RateLock = (() => {
    let desired = 1;
    let fromUs = false;
    let patched = false;

    function patch() {
      if (patched) return;
      const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
      if (!desc || !desc.set || !desc.get) return;
      patched = true;
      Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
        configurable: true,
        enumerable: desc.enumerable,
        get() {
          return desc.get.call(this);
        },
        set(v) {
          if (fromUs) {
            desc.set.call(this, v);
            return;
          }
          // Site trying to force 1× while we want another rate → stick
          if (Number(v) === 1 && desired !== 1) {
            desc.set.call(this, desired);
            return;
          }
          desc.set.call(this, v);
        },
      });
    }

    function apply(video, rate) {
      if (!video) return;
      patch();
      desired = rate;
      fromUs = true;
      try {
        video.playbackRate = rate;
      } finally {
        fromUs = false;
      }
    }

    function setDesired(rate) {
      desired = rate;
    }

    return { patch, apply, setDesired };
  })();

  // ─────────────────────────────────────────────────────────────
  // Shared menu builders
  // ─────────────────────────────────────────────────────────────
  function buildPresetItems({ presets, getBaseRate, onSelect, itemClass, activeClass }) {
    const frag = document.createDocumentFragment();
    for (const p of presets) {
      const item = document.createElement('li');
      item.className = itemClass;
      item.dataset.rate = String(p);
      item.textContent = `${formatRate(p)}x`;
      if (Math.abs(getBaseRate() - p) < 0.05) item.classList.add(activeClass);
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect(p);
      });
      frag.appendChild(item);
    }
    return frag;
  }

  function buildCustomRow({ siteId, onSubmit, rowClass, inputClass }) {
    const row = document.createElement('li');
    row.className = rowClass;
    const input = document.createElement('input');
    input.className = inputClass;
    input.type = 'number';
    input.min = String(CONFIG.min);
    input.max = String(CONFIG.max);
    input.step = '0.1';
    input.placeholder = `${CONFIG.min}-${CONFIG.max}`;
    input.value = Storage.getCustom(siteId) || '';
    input.title = `自定义倍速 ${CONFIG.min}–${CONFIG.max}`;

    const apply = () => {
      const parsed = parseCustomRate(input.value);
      if (parsed == null) {
        input.value = Storage.getCustom(siteId) || '';
        return;
      }
      input.value = String(parsed);
      onSubmit(parsed);
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
    input.addEventListener('blur', apply);
    input.addEventListener('click', (e) => e.stopPropagation());

    row.appendChild(input);
    return { row, input };
  }

  function pickMainVideo(candidates) {
    const list = [...candidates].filter(Boolean);
    if (!list.length) return null;
    list.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
    return list[0];
  }

  // ─────────────────────────────────────────────────────────────
  // YouTube adapter
  // ─────────────────────────────────────────────────────────────
  class YouTubeAdapter {
    constructor(controller) {
      this.controller = controller;
      this.btn = null;
      this.menu = null;
      this._mo = null;
      this._labelEl = null;
    }

    start() {
      const tryMount = () => {
        if (shouldSkipPage('youtube')) return false;
        const controls = document.querySelector('.ytp-right-controls');
        if (!controls) return false;
        if (controls.querySelector('.speedup-yt-btn')) {
          this.btn = controls.querySelector('.speedup-yt-btn');
          this._labelEl = this.btn.querySelector('.speedup-yt-label');
          this.applyRate(this.controller.getEffectiveRate());
          return true;
        }
        this._inject(controls);
        this.applyRate(this.controller.getEffectiveRate());
        return true;
      };

      if (!tryMount()) {
        this._mo = new MutationObserver(() => {
          if (tryMount() && this._mo) {
            // keep observing for SPA remounts; do not disconnect
          }
        });
        this._mo.observe(document.documentElement, { childList: true, subtree: true });
      }

      document.addEventListener('yt-navigate-finish', () => {
        setTimeout(() => tryMount(), 300);
      });

      // Re-apply when a new video element appears / starts
      setInterval(() => {
        if (shouldSkipPage('youtube')) return;
        const v = this._video();
        if (v && Math.abs(v.playbackRate - this.controller.getEffectiveRate()) > 0.05) {
          this.applyRate(this.controller.getEffectiveRate());
        }
      }, 1500);
    }

    _video() {
      return (
        document.querySelector('video.html5-main-video') ||
        pickMainVideo(document.querySelectorAll('video'))
      );
    }

    _inject(controls) {
      const settingsBtn = controls.querySelector('.ytp-settings-button');

      const btn = document.createElement('button');
      btn.className = 'ytp-button speedup-yt-btn';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Playback speed');
      btn.title = 'Playback speed';
      const label = document.createElement('div');
      label.className = 'speedup-yt-label';
      Object.assign(label.style, {
        fontSize: '13px',
        fontWeight: '500',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minWidth: '40px',
      });
      label.textContent = '1x';
      btn.appendChild(label);

      const menu = document.createElement('div');
      menu.className = 'speedup-yt-menu';
      menu.hidden = true;
      Object.assign(menu.style, {
        position: 'absolute',
        bottom: '52px',
        right: '0',
        background: 'rgba(28,28,28,0.9)',
        borderRadius: '8px',
        padding: '8px 0',
        minWidth: '120px',
        zIndex: '10000',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      });

      const list = document.createElement('ul');
      Object.assign(list.style, {
        listStyle: 'none',
        margin: '0',
        padding: '0',
      });

      const rebuild = () => {
        list.innerHTML = '';
        const frag = buildPresetItems({
          presets: CONFIG.presets,
          getBaseRate: () => this.controller.getBaseRate(),
          onSelect: (p) => {
            this.controller.setBaseRate(p);
            menu.hidden = true;
            rebuild();
          },
          itemClass: 'speedup-yt-item',
          activeClass: 'speedup-active',
        });
        // style items
        frag.querySelectorAll('.speedup-yt-item').forEach((el) => {
          Object.assign(el.style, {
            padding: '8px 16px',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '13px',
          });
          if (el.classList.contains('speedup-active')) {
            el.style.background = 'rgba(255,255,255,0.15)';
          }
          el.addEventListener('mouseenter', () => {
            el.style.background = 'rgba(255,255,255,0.1)';
          });
          el.addEventListener('mouseleave', () => {
            el.style.background = el.classList.contains('speedup-active')
              ? 'rgba(255,255,255,0.15)'
              : 'transparent';
          });
        });
        list.appendChild(frag);

        const { row, input } = buildCustomRow({
          siteId: 'youtube',
          onSubmit: (rate) => {
            this.controller.setCustomAndBase(rate);
            menu.hidden = true;
            rebuild();
          },
          rowClass: 'speedup-yt-custom',
          inputClass: 'speedup-yt-input',
        });
        Object.assign(row.style, { padding: '6px 12px', listStyle: 'none' });
        Object.assign(input.style, {
          width: '100%',
          boxSizing: 'border-box',
          background: '#111',
          border: '1px solid #555',
          color: '#fff',
          borderRadius: '4px',
          padding: '4px 6px',
          fontSize: '12px',
        });
        list.appendChild(row);
      };

      rebuild();
      menu.appendChild(list);

      const wrap = document.createElement('div');
      wrap.className = 'speedup-yt-wrap';
      Object.assign(wrap.style, { position: 'relative', display: 'inline-block' });
      wrap.appendChild(btn);
      wrap.appendChild(menu);

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

      if (settingsBtn) controls.insertBefore(wrap, settingsBtn);
      else controls.appendChild(wrap);

      this.btn = btn;
      this.menu = menu;
      this._labelEl = btn.querySelector('.speedup-yt-label');
      this._rebuildMenu = rebuild;
    }

    applyRate(rate) {
      const video = this._video();
      RateLock.apply(video, rate);
      if (this._labelEl) {
        // Show effective rate on the control (including during hold)
        this._labelEl.textContent = `${formatRate(rate)}x`;
      }
      if (typeof this._rebuildMenu === 'function' && this.menu && !this.menu.hidden) {
        this._rebuildMenu();
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Bilibili adapter
  // ─────────────────────────────────────────────────────────────
  class BilibiliAdapter {
    constructor(controller) {
      this.controller = controller;
      this._mo = null;
      this._hijacked = false;
    }

    start() {
      RateLock.patch();

      const tryMount = () => {
        if (shouldSkipPage('bilibili')) return false;
        const rateBtn = document.querySelector('.bpx-player-ctrl-playbackrate');
        if (!rateBtn) return false;
        this._hijack(rateBtn);
        this.applyRate(this.controller.getEffectiveRate());
        return true;
      };

      if (!tryMount()) {
        this._mo = new MutationObserver(() => {
          tryMount();
        });
        this._mo.observe(document.documentElement, { childList: true, subtree: true });
      }

      // SPA / part switches
      let lastHref = location.href;
      setInterval(() => {
        if (location.href !== lastHref) {
          lastHref = location.href;
          this._hijacked = false;
          setTimeout(() => tryMount(), 400);
        }
        const v = this._video();
        if (v && Math.abs(v.playbackRate - this.controller.getEffectiveRate()) > 0.05) {
          this.applyRate(this.controller.getEffectiveRate());
        }
      }, 1500);
    }

    _video() {
      return (
        document.querySelector('.bpx-player-video-wrap video') ||
        document.querySelector('.bilibili-player-video video') ||
        pickMainVideo(document.querySelectorAll('video'))
      );
    }

    _hijack(rateBtn) {
      const menu =
        rateBtn.querySelector('.bpx-player-ctrl-playbackrate-menu') ||
        document.querySelector('.bpx-player-ctrl-playbackrate-menu');
      if (!menu) return;

      // Avoid infinite re-hijack loops: replace contents when not ours
      if (menu.dataset.speedup === '1' && this._hijacked) {
        this._syncLabel(rateBtn);
        return;
      }

      menu.dataset.speedup = '1';
      menu.innerHTML = '';

      const styleId = 'speedup-bili-style';
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          .bpx-player-ctrl-playbackrate-menu .speedup-bili-item {
            cursor: pointer;
          }
          .bpx-player-ctrl-playbackrate-menu .speedup-bili-item.speedup-active {
            color: #00a1d6;
          }
          .bpx-player-ctrl-playbackrate-menu .speedup-bili-input {
            width: 72px;
            margin: 4px 8px;
            padding: 2px 4px;
            font-size: 12px;
            border: 1px solid rgba(255,255,255,0.2);
            background: rgba(0,0,0,0.35);
            color: inherit;
            border-radius: 2px;
          }
        `;
        document.head.appendChild(style);
      }

      const rebuild = () => {
        menu.innerHTML = '';
        menu.dataset.speedup = '1';

        const frag = buildPresetItems({
          presets: CONFIG.presets,
          getBaseRate: () => this.controller.getBaseRate(),
          onSelect: (p) => {
            this.controller.setBaseRate(p);
            rebuild();
          },
          itemClass: 'bpx-player-ctrl-playbackrate-menu-item speedup-bili-item',
          activeClass: 'speedup-active',
        });
        // bpx items often use data-value
        frag.querySelectorAll('.speedup-bili-item').forEach((el) => {
          el.setAttribute('data-value', el.dataset.rate);
        });
        menu.appendChild(frag);

        const { row, input } = buildCustomRow({
          siteId: 'bilibili',
          onSubmit: (rate) => {
            this.controller.setCustomAndBase(rate);
            rebuild();
          },
          rowClass: 'bpx-player-ctrl-playbackrate-menu-item speedup-bili-custom',
          inputClass: 'speedup-bili-input',
        });
        // row is <li>; bilibili menu may expect div — convert if needed
        if (menu.firstElementChild && menu.firstElementChild.tagName !== 'LI') {
          const div = document.createElement('div');
          div.className = row.className;
          div.appendChild(input);
          menu.appendChild(div);
        } else {
          menu.appendChild(row);
        }
      };

      rebuild();
      this._rebuildMenu = rebuild;
      this._rateBtn = rateBtn;
      this._hijacked = true;
      this._syncLabel(rateBtn);

      // If site re-renders menu, re-hijack
      const menuObserver = new MutationObserver(() => {
        if (menu.dataset.speedup !== '1' || !menu.querySelector('.speedup-bili-item')) {
          this._hijacked = false;
          this._hijack(rateBtn);
        }
      });
      menuObserver.observe(menu, { childList: true });
    }

    _syncLabel(rateBtn) {
      const rate = this.controller.getEffectiveRate();
      const result =
        (rateBtn && rateBtn.querySelector('.bpx-player-ctrl-playbackrate-result')) ||
        document.querySelector('.bpx-player-ctrl-playbackrate-result');
      const text = `${formatRate(rate)}x`;
      if (result) {
        result.textContent = text;
      } else if (rateBtn) {
        // fallback: update visible text node / button content carefully
        const label = rateBtn.childNodes[0];
        if (label && label.nodeType === Node.TEXT_NODE) {
          label.textContent = text;
        }
      }
    }

    applyRate(rate) {
      const video = this._video();
      RateLock.apply(video, rate);
      if (this._rateBtn) this._syncLabel(this._rateBtn);
      else {
        const rateBtn = document.querySelector('.bpx-player-ctrl-playbackrate');
        if (rateBtn) this._syncLabel(rateBtn);
      }
      if (typeof this._rebuildMenu === 'function') {
        // only refresh active highlight when idle (base rate); still safe to call
        const menu = document.querySelector('.bpx-player-ctrl-playbackrate-menu');
        if (menu && menu.offsetParent !== null) this._rebuildMenu();
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Boot
  // ─────────────────────────────────────────────────────────────
  function boot() {
    const siteId = detectSite();
    if (!siteId) return;
    if (shouldSkipPage(siteId)) return;

    RateLock.patch();

    const controller = new SpeedController(siteId);
    const adapter =
      siteId === 'youtube' ? new YouTubeAdapter(controller) : new BilibiliAdapter(controller);

    controller.onChange((rate) => adapter.applyRate(rate));
    controller.bindKeys();

    const start = () => adapter.start();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }

    // Apply remembered rate as soon as a video exists
    const early = setInterval(() => {
      const v =
        siteId === 'youtube'
          ? document.querySelector('video.html5-main-video') || document.querySelector('video')
          : document.querySelector('.bpx-player-video-wrap video') || document.querySelector('video');
      if (v) {
        adapter.applyRate(controller.getEffectiveRate());
        clearInterval(early);
      }
    }, 400);
    setTimeout(() => clearInterval(early), 30000);
  }

  boot();
})();
