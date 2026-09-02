import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPercentageValue, formatScoreFraction } from './quiz-result-format';

test('formatScoreFraction renders whole-number points without decimals', () => {
  assert.equal(formatScoreFraction('7', '10'), '7 / 10');
});

test('formatScoreFraction trims trailing zeros on fractional points', () => {
  assert.equal(formatScoreFraction('7.50', '10.00'), '7.5 / 10');
});

test('formatScoreFraction keeps genuine precision', () => {
  assert.equal(formatScoreFraction('6.25', '10'), '6.25 / 10');
});

test('formatPercentageValue renders a whole-number percentage cleanly', () => {
  assert.equal(formatPercentageValue('70.00'), '70%');
});

test('formatPercentageValue keeps meaningful decimal precision', () => {
  assert.equal(formatPercentageValue('66.67'), '66.67%');
});

test('formatPercentageValue passes through null unchanged (no maxPoints case)', () => {
  assert.equal(formatPercentageValue(null), null);
});
