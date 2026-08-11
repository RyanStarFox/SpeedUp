const assert = require('assert');
const fs = require('fs');
const path = require('path');

const script = fs.readFileSync(path.join(__dirname, '..', 'speedup.user.js'), 'utf8');

assert.match(script, /\/\/ @grant\s+none/, 'must execute in the page realm for Safari compatibility');
assert.doesNotMatch(script, /unsafeWindow/, 'must not rely on Safari-incompatible unsafeWindow');
assert.doesNotMatch(script, /attachShadow\s*=/, 'must not modify the page Shadow DOM implementation');
assert.doesNotMatch(
  script,
  /Object\.defineProperty\(proto,\s*'playbackRate'/,
  'must not patch the browser-wide playbackRate property'
);
assert.match(script, /localStorage\.getItem/, 'must use page-native storage without GM APIs');
assert.match(script, /localStorage\.setItem/, 'must persist the selected rate with page-native storage');
assert.match(
  script,
  /speedup-yt-wrap/,
  'must provide a standalone YouTube speed control'
);
assert.match(
  script,
  /customFirst: true/,
  'must render Bilibili’s custom item at the top of an upward-opening menu'
);
assert.doesNotMatch(
  script,
  /observe\(document\.documentElement/,
  'must not observe the entire page and repeatedly remount controls'
);
assert.match(
  script,
  /new MutationObserver\(\(\) => this\._normalizeRateLabel\(\)\)\.observe\(control/,
  'may observe only the Bilibili rate control for precision normalization'
);

assert.match(
  script,
  /youtubeAdRate:\s*2\.0/,
  'must expose a separate YouTube ad playback rate in CONFIG'
);
assert.match(
  script,
  /ad-showing/,
  'must detect YouTube ad playback and restore rate after ads'
);

console.log('userscript compatibility: ok');
