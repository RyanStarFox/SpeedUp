# SpeedUp Userscript Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Tampermonkey userscript that hijacks native Bilibili/YouTube speed menus, supports presets + custom 0.1–8.0, remembers per-site base rate, and hold-O/P temporary multipliers.

**Architecture:** One `speedup.user.js` with CONFIG, pure rate helpers, SpeedController, and site adapters (YouTube / Bilibili). Actual speed always via `video.playbackRate`; UI via hijacked native menu + synced button label.

**Tech Stack:** Tampermonkey userscript (Vanilla JS), `GM_getValue` / `GM_setValue`, MutationObserver; Node assert tests for pure helpers only.

## Global Constraints

- Rate range: **0.1–8.0** (clamp)
- Presets: **0.5, 1, 1.5, 2, 2.5, 3**
- Hold delay: **0.5s**; P → ×1.5, O → ×0.5; round to 1 decimal
- Memory default: **`per-site`**; CONFIG comment to switch to **`global`**
- Hold feedback: sync **native speed button text only**
- Pages: YT watch + embed; Bilibili video + bangumi; **no** Shorts/live
- No center toast; no reliance on official `setPlaybackRate` alone for >2×

## File Structure

| File | Responsibility |
|---|---|
| `speedup.user.js` | Full userscript: header, CONFIG, helpers, controller, adapters, boot |
| `tests/rate-math.test.js` | Node tests for clamp/round/effectiveRate |
| `README.md` | Install, shortcuts, CONFIG, limits |

---

### Task 1: Pure rate math + tests

**Files:**
- Create: `tests/rate-math.test.js`
- Create: `lib/rate-math.js` (copied/inlined into userscript in Task 2; keep module for tests)

**Interfaces:**
- Produces:
  - `clampRate(n: number): number` → clamp to [0.1, 8.0]
  - `roundRate(n: number): number` → one decimal via `Math.round(n * 10) / 10`
  - `effectiveRate(baseRate: number, holdMultiplier: number): number` → `clampRate(roundRate(baseRate * holdMultiplier))`
  - `parseCustomRate(raw: string): number | null` → parse float; null if NaN/empty; else clamped

- [ ] **Step 1: Write failing tests**

```js
// tests/rate-math.test.js
const assert = require('assert');
const { clampRate, roundRate, effectiveRate, parseCustomRate } = require('../lib/rate-math.js');

assert.strictEqual(clampRate(0), 0.1);
assert.strictEqual(clampRate(9), 8);
assert.strictEqual(roundRate(2.26), 2.3);
assert.strictEqual(effectiveRate(2, 1.5), 3);
assert.strictEqual(effectiveRate(1.7, 0.5), 0.9);
assert.strictEqual(parseCustomRate('2.5'), 2.5);
assert.strictEqual(parseCustomRate('abc'), null);
assert.strictEqual(parseCustomRate('10'), 8);
console.log('rate-math: ok');
```

- [ ] **Step 2: Run tests — expect FAIL (module missing)**

```bash
node tests/rate-math.test.js
```

Expected: `Cannot find module '../lib/rate-math.js'`

- [ ] **Step 3: Implement `lib/rate-math.js`**

```js
const MIN = 0.1;
const MAX = 8.0;

function clampRate(n) {
  return Math.min(MAX, Math.max(MIN, n));
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

module.exports = { clampRate, roundRate, effectiveRate, parseCustomRate, MIN, MAX };
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
node tests/rate-math.test.js
```

Expected: `rate-math: ok`

- [ ] **Step 5: Commit**

```bash
git add lib/rate-math.js tests/rate-math.test.js
git commit -m "feat: add playback rate math helpers and tests"
```

---

### Task 2: Userscript skeleton — CONFIG, storage, SpeedController, shortcuts

**Files:**
- Create: `speedup.user.js`

**Interfaces:**
- Consumes: rate-math functions (inline copy of Task 1 API inside IIFE)
- Produces:
  - `CONFIG` object with `memoryMode`, `presets`, `min`, `max`, `holdDelayMs`, `holdBoost`, `holdSlow`
  - `Storage.getRate(siteId)`, `Storage.setRate(siteId, rate)`, `Storage.getCustom(siteId)`, `Storage.setCustom(siteId, rate)`
  - `SpeedController` with `getBaseRate()`, `setBaseRate(rate)`, `getEffectiveRate()`, `beginHold(kind)`, `endHold()`, `bindKeys()`, `onChange(cb)`
  - `siteId`: `'youtube' | 'bilibili'` from hostname

- [ ] **Step 1: Create `speedup.user.js` header + CONFIG + inlined rate-math + storage + controller + keybinds**

Userscript header `@match`:

- `https://www.youtube.com/*`
- `https://www.youtube-nocookie.com/*`
- `https://www.bilibili.com/video/*`
- `https://www.bilibili.com/bangumi/play/*`

`@grant GM_getValue`, `GM_setValue`, `@run-at document-idle`

CONFIG (top of script, commented):

```js
const CONFIG = {
  // 'per-site' = separate rates for YouTube / Bilibili (default)
  // 'global'   = one shared rate across both sites — change to 'global' if you prefer A
  memoryMode: 'per-site',
  presets: [0.5, 1, 1.5, 2, 2.5, 3],
  min: 0.1,
  max: 8.0,
  holdDelayMs: 500,
  holdBoost: 1.5, // key P
  holdSlow: 0.5,  // key O
};
```

Storage keys: `rate:${siteId}` or `rate:global`; `custom:${siteId}` or `custom:global`.

SpeedController behavior:

- Load base rate on construct (default `1` if missing)
- `setBaseRate` persists + notifies
- Hold: on keydown O/P (not repeat, not editable focus), start timer; after `holdDelayMs` set multiplier and notify; keyup/blur/visibilitychange clears timer and resets multiplier to 1
- Ignore second hold key while first is active

Also export a stub `adapter` hook: `controller.onChange(() => adapter && adapter.applyRate(controller.getEffectiveRate()))` wired in Task 3/4.

- [ ] **Step 2: Commit**

```bash
git add speedup.user.js
git commit -m "feat: add userscript skeleton with storage and hold shortcuts"
```

---

### Task 3: YouTube adapter (menu hijack + label sync)

**Files:**
- Modify: `speedup.user.js`

**Interfaces:**
- Consumes: `SpeedController`, `CONFIG.presets`, rate helpers
- Produces: `YouTubeAdapter` with `start()`, `applyRate(rate)`, `destroy()` (optional)

- [ ] **Step 1: Implement YouTubeAdapter**

Behavior:

1. Skip if path starts with `/shorts`
2. Find video: `document.querySelector('video.html5-main-video')` or largest playing `video`
3. Prefer hijacking Settings → Playback speed panel list with presets + custom input; update visible "Playback speed" secondary label when possible
4. `applyRate(rate)`: `video.playbackRate = rate`; update visible speed label to one-decimal form (e.g. `2.0x`)
5. Menu clicks call `controller.setBaseRate`; custom Enter/blur via `parseCustomRate`
6. Re-bind on `yt-navigate-finish` and MutationObserver
7. Fallback: if menu hijack fails, still apply `playbackRate` + keys

- [ ] **Step 2: Commit**

```bash
git add speedup.user.js
git commit -m "feat: add YouTube speed menu adapter"
```

---

### Task 4: Bilibili adapter (menu hijack + anti-reset)

**Files:**
- Modify: `speedup.user.js`

**Interfaces:**
- Consumes: same as Task 3
- Produces: `BilibiliAdapter` with `start()`, `applyRate(rate)`

- [ ] **Step 1: Implement BilibiliAdapter**

1. Find video inside bpx player wrap
2. Find `.bpx-player-ctrl-playbackrate` and replace menu with presets + custom row
3. Sync result/button text to effective rate
4. Patch `playbackRate` setter to resist forced `1×` when desired ≠ 1 (flag writes from us)
5. Bangumi shares bpx player; skip `/live/`
6. Wire boot: detect site → controller → adapter → onChange → bindKeys → start

- [ ] **Step 2: Commit**

```bash
git add speedup.user.js
git commit -m "feat: add Bilibili speed menu adapter and boot wiring"
```

---

### Task 5: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README** — install, shortcuts, `memoryMode`, limits, out of scope

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add SpeedUp install and usage README"
```

---

## Spec Coverage Check

| Spec item | Task |
|---|---|
| Presets + custom 0.1–8 | 3, 4 |
| Remember rate / per-site + global CONFIG | 2 |
| Hold P/O 0.5s, ×1.5/×0.5, round 1 decimal | 1, 2 |
| Use video.playbackRate | 3, 4 |
| Native menu hijack + button text on hold | 3, 4 |
| YT watch + embed, Bilibili video + bangumi | 2 matches, 3–4 |
| Anti-reset Bilibili | 4 |
| README | 5 |

## Execution

User requested immediate start (`开工`). Execute **inline** in this session: implement tasks sequentially with commits after each task.
