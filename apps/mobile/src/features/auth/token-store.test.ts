import assert from 'node:assert/strict';
import test from 'node:test';
import { AccessTokenStore } from './token-store';

test('AccessTokenStore starts empty and only ever reflects the last value set in memory', () => {
  const store = new AccessTokenStore();
  assert.equal(store.get(), null);

  store.set('access-token-1');
  assert.equal(store.get(), 'access-token-1');

  store.set('access-token-2');
  assert.equal(store.get(), 'access-token-2');

  store.set(null);
  assert.equal(store.get(), null);
});

test('AccessTokenStore exposes no persistence method — get/set are its entire surface', () => {
  const store = new AccessTokenStore();
  const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(store)).filter((name) => name !== 'constructor');

  assert.deepEqual(methodNames.sort(), ['get', 'set']);
});
