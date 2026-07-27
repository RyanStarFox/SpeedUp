const assert = require('assert');
const fs = require('fs');
const path = require('path');

const script = fs.readFileSync(path.join(__dirname, '..', 'speedup.user.js'), 'utf8');

assert.match(script, /\/\/ @grant\s+none/, 'must execute in the page realm for Safari compatibility');
assert.doesNotMatch(script, /unsafeWindow/, 'must not rely on Safari-incompatible unsafeWindow');
assert.doesNotMatch(script, /attachShadow\s*=/, 'must not modify the page Shadow DOM implementation');
assert.match(script, /localStorage\.getItem/, 'must use page-native storage without GM APIs');
assert.match(script, /localStorage\.setItem/, 'must persist the selected rate with page-native storage');

console.log('userscript compatibility: ok');
