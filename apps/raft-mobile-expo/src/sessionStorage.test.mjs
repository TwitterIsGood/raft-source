import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionStorage } from './sessionStorage.ts';

function fakeSecure() {
  const values = new Map();
  const calls = [];
  const secure = {
    async getItemAsync(key) { calls.push(['get', key]); return values.get(key) ?? null; },
    async setItemAsync(key, value) { calls.push(['set', key]); values.set(key, value); },
    async deleteItemAsync(key) { calls.push(['delete', key]); values.delete(key); },
  };
  return { secure, values, calls };
}

test('isolated simulator session never starts a late keychain write and is gone after logout or restart', async () => {
  const { secure, calls } = fakeSecure();
  const first = createSessionStorage(secure, true);
  await first.save('access', 'refresh', 'access-1', 'refresh-1');
  assert.deepEqual(await first.read('access', 'refresh'), { accessToken: 'access-1', refreshToken: 'refresh-1' });
  await first.clear('access', 'refresh');
  assert.deepEqual(await first.read('access', 'refresh'), { accessToken: null, refreshToken: null });
  assert.deepEqual(calls, []);
  const restarted = createSessionStorage(secure, true);
  assert.deepEqual(await restarted.read('access', 'refresh'), { accessToken: null, refreshToken: null });
});

test('physical device waits for SecureStore and does not silently downgrade', async () => {
  const { secure, values, calls } = fakeSecure();
  const session = createSessionStorage(secure, false);
  await session.save('access', 'refresh', 'access-1', 'refresh-1');
  assert.deepEqual(await session.read('access', 'refresh'), { accessToken: 'access-1', refreshToken: 'refresh-1' });
  const restarted = createSessionStorage(secure, false);
  assert.deepEqual(await restarted.read('access', 'refresh'), { accessToken: 'access-1', refreshToken: 'refresh-1' });
  await session.clear('access', 'refresh');
  assert.equal(values.size, 0);
  assert.equal(calls.filter(([kind]) => kind === 'delete').length, 2);
  const broken = createSessionStorage({
    ...secure,
    async setItemAsync() { throw new Error('keychain unavailable'); },
  }, false);
  await assert.rejects(broken.save('access', 'refresh', 'a', 'r'), /keychain unavailable/);
});

test('logout waits for an in-flight SecureStore save so a late write cannot resurrect the session', async () => {
  const values = new Map();
  const calls = [];
  let releaseWrite;
  const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
  const secure = {
    async getItemAsync(key) { calls.push(['get', key]); return values.get(key) ?? null; },
    async setItemAsync(key, value) { calls.push(['set-start', key]); await writeGate; values.set(key, value); calls.push(['set-done', key]); },
    async deleteItemAsync(key) { calls.push(['delete', key]); values.delete(key); },
  };
  const session = createSessionStorage(secure, false);
  const saving = session.save('access', 'refresh', 'access-late', 'refresh-late');
  await new Promise((resolve) => setImmediate(resolve));
  const clearing = session.clear('access', 'refresh');
  assert.deepEqual(calls, [['set-start', 'access'], ['set-start', 'refresh']]);
  releaseWrite();
  await saving;
  await clearing;
  assert.deepEqual(values, new Map());
  assert.deepEqual(calls.slice(-2), [['delete', 'access'], ['delete', 'refresh']]);
  assert.deepEqual(await session.read('access', 'refresh'), { accessToken: null, refreshToken: null });
});

test('access write failure still waits for a late refresh write before logout clears both keys', async () => {
  const values = new Map();
  const calls = [];
  let releaseRefresh;
  const refreshGate = new Promise((resolve) => { releaseRefresh = resolve; });
  const secure = {
    async getItemAsync(key) { calls.push(['get', key]); return values.get(key) ?? null; },
    async setItemAsync(key, value) {
      calls.push(['set-start', key]);
      if (key === 'access') throw new Error('access write failed');
      await refreshGate;
      values.set(key, value);
      calls.push(['set-done', key]);
    },
    async deleteItemAsync(key) { calls.push(['delete', key]); values.delete(key); },
  };
  const session = createSessionStorage(secure, false);
  const saving = session.save('access', 'refresh', 'access-late', 'refresh-late');
  await new Promise((resolve) => setImmediate(resolve));
  const clearing = session.clear('access', 'refresh');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [['set-start', 'access'], ['set-start', 'refresh']]);
  releaseRefresh();
  await assert.rejects(saving, /access write failed/);
  await clearing;
  assert.deepEqual(values, new Map());
  assert.deepEqual(calls.slice(-2), [['delete', 'access'], ['delete', 'refresh']]);
  assert.deepEqual(await session.read('access', 'refresh'), { accessToken: null, refreshToken: null });
});
