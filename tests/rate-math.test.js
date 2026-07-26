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
