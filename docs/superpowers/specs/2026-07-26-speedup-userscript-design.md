# SpeedUp Userscript Design

**Date:** 2026-07-26  
**Status:** Approved for planning  
**Deliverable:** Tampermonkey userscript enhancing playback speed on Bilibili and YouTube

## Goal

Add richer playback-speed controls on Bilibili and YouTube by hijacking each site’s native speed menu, while driving actual speed via the underlying HTML5 `video.playbackRate`. Persist the user’s chosen base rate, support presets plus custom input, and provide hold-to-boost/slow shortcuts that update the native speed button label.

## Feasibility & Platform Limits

| Constraint | Reality |
|---|---|
| Official UI menus | YouTube typically caps ~2× (sometimes 4×); Bilibili commonly ~2× |
| Browser `playbackRate` | Roughly 0.0625–16; script range is **0.1–8.0** (within hard limit) |
| Official APIs (`setPlaybackRate` / menu click only) | Reject rates above official presets → **cannot** be the only execution path |
| Bilibili reset | May force `playbackRate` back to `1` (esp. logged-out) → may need setter interception |
| Audio | Browsers often mute below ~0.5× or above ~4×; video may continue silently — document only, do not “fix” |

**Conclusion:** Approach is feasible if execution uses `video.playbackRate` and UI is a hijacked native menu plus synced button text.

## Decisions (from brainstorming)

| Topic | Choice |
|---|---|
| UI strategy | **B** — Hijack / replace native speed menu |
| Memory scope | Default **per-site**; `CONFIG` comment to switch to global |
| Hold feedback | **A** — Sync native speed button text only (no center toast) |
| Page coverage | Regular VOD + Bilibili bangumi + YouTube embed (best-effort); **no** Shorts / live |
| Architecture | Hybrid: hijacked native menu + `playbackRate` execution |

## Architecture

Single userscript file with site adapters:

```
[CONFIG + GM storage]
         ↓
[SpeedController]  — baseRate, holdMultiplier, effectiveRate, persistence
         ↓
[SiteAdapter]      — YouTubeAdapter | BilibiliAdapter
         ↓
video.playbackRate + hijacked native menu / button label
```

### SpeedController (site-agnostic)

Responsibilities:

- Own the single source of truth for rates
- Read/write remembered base rate according to `memoryMode`
- Compute effective rate and apply via adapter
- Manage O/P hold timers and multipliers

Formulas:

- `effectiveRate = clamp(round(baseRate * holdMultiplier, 1), 0.1, 8.0)`
- Idle: `holdMultiplier = 1`
- Hold **P**: `holdMultiplier = 1.5`
- Hold **O**: `holdMultiplier = 0.5`
- Rounding: one decimal place (e.g. `2 * 1.5 → 3.0`, `1.7 * 0.5 → 0.9`)

### SiteAdapter

Responsibilities:

- Locate main `video` element
- Find native speed control button and menu
- Replace/enhance menu contents with presets + custom input
- Set `video.playbackRate` and keep button label in sync with `effectiveRate`
- Re-bind on SPA navigation / player remount (`MutationObserver` / history hooks)
- Bilibili: optionally patch `HTMLMediaElement.prototype.playbackRate` to resist forced `1×` resets when user wants non-1×

## Native Menu UX

Presets (in order): `0.5`, `1`, `1.5`, `2`, `2.5`, `3`

Custom row:

- Numeric input, valid range `0.1–8.0`
- Apply on Enter or blur
- Invalid input: ignore and restore previous display value
- Out-of-range: clamp to bounds
- Last custom value persisted for input prefill

Visual:

- Selected preset highlighted when it matches current `baseRate` (not hold-modified rate, unless we only highlight when idle — **idle only**: highlight reflects `baseRate`)
- Control-bar speed button text always shows **effective** rate while playing (e.g. `2.5x`), including during hold

## Shortcuts

| Key | Behavior |
|---|---|
| Hold **P** ≥ 0.5s | Temporary `×1.5` on `baseRate`; update button label |
| Hold **O** ≥ 0.5s | Temporary `×0.5` on `baseRate`; update button label |
| Release / blur / tab hide | Cancel pending timer or exit hold; restore `baseRate` |

Guards:

- Ignore when focus is in `input`, `textarea`, `select`, or `contenteditable`
- Ignore when modifier keys alone would cause issues if needed; primary rule is editable-focus ignore
- Repeat `keydown` (OS key-repeat) must not restart the 0.5s timer once armed
- Only one hold active at a time; conflicting second key cancels or is ignored until first released (prefer: ignore second while first held)

## Persistence (`GM_setValue` / `GM_getValue`)

```js
// CONFIG example (exact shape may vary in implementation)
memoryMode: 'per-site', // 'per-site' | 'global' — change to 'global' to share one rate across sites
```

Keys:

- `memoryMode` (or read only from CONFIG; CONFIG is source of truth for mode)
- Per-site: `rate:youtube`, `rate:bilibili`
- Global: `rate:global`
- Optional: `custom:youtube` / `custom:bilibili` / `custom:global` for input prefill

On player ready / video change: apply remembered base rate to `video` and refresh button label + menu selection.

## Page Match Targets

- YouTube: `https://www.youtube.com/watch*`, embed URLs (`youtube.com/embed`, `youtube-nocookie.com/embed`) — best-effort
- Bilibili: `https://www.bilibili.com/video/*`, bangumi/play pages (`/bangumi/play/*`)
- Explicitly out of scope: Shorts, live streams

## Error Handling & Edge Cases

- Video or speed button not yet in DOM → observe until available; retry bind
- Multiple `<video>` nodes → prefer the main player video (largest / known class selectors)
- Site DOM renames → adapters isolate selectors; failure degrades to rate-only via video if menu hijack fails (still apply rate + try label if button found)
- Concurrent speed extensions → unsupported; last writer wins
- Audio mute at extremes → documented limitation

## Deliverables

1. `speedup.user.js` — installable Tampermonkey script (`@grant GM_getValue`, `GM_setValue`, appropriate `@match`)
2. `README.md` — install steps, shortcuts, CONFIG (`memoryMode`), known limits

## Non-Goals

- Shorts / live support
- Center-screen toast overlays for hold
- Syncing YouTube’s internal official speed setting above 2× via IFrame API
- Guaranteeing coexistence with other speed extensions

## Testing Checklist (manual)

- [ ] YouTube watch: presets, custom 0.1–8, persistence across refresh
- [ ] YouTube: hold P/O after 0.5s changes button text; release restores; typing in search not affected
- [ ] Bilibili video + bangumi: same as above
- [ ] Bilibili: rate sticks when site tries to reset (if reproducible)
- [ ] `memoryMode: 'global'` shares rate across sites after CONFIG change
- [ ] Embed page best-effort: rate applies when video is accessible
`)
