const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');

// Explicit opt-in; never use the developer DATABASE_URL or load their .env.
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || new URL(testUrl).pathname !== '/auth_api_phase1_test') {
  throw new Error('TEST_DATABASE_URL debe apuntar a la base aislada auth_api_phase1_test');
}
process.env.DATABASE_URL = testUrl;
process.env.JWT_SECRET = 'integration-test-only-credential-0123456789abcdef';
process.env.JWT_EXPIRES_IN = '1h';
const prisma = require('../src/store/prisma');
const store = require('../src/store/db.store');
const app = require('../src/app');
const { signToken } = require('../src/utils/jwt');
const { registerLimiter, loginLimiter, sensitiveLimiter } = require('../src/middleware/rate-limit.middleware');
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('Phase 1 against isolated PostgreSQL', { timeout: 60000 }, async (t) => {
  const suffix = `${randomUUID()}@phase1.invalid`;
  const email = (label) => `${label}-${suffix}`;
  const oldPassword = 'OldPassword123!';
  const newPassword = 'NewPassword456!';
  const passwordHash = await bcrypt.hash(oldPassword, 4);
  const fixture = (label) => store.createUser({ name: label, email: email(label), passwordHash });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    await prisma.user.deleteMany({ where: { email: { endsWith: suffix } } });
    await prisma.$disconnect();
  });
  async function request(method, route, body, token) {
    const response = await fetch(base + route, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  }
  async function login(user, password = oldPassword) {
    loginLimiter.resetKey('127.0.0.1');
    const response = await request('POST', '/api/auth/login', { email: user.email, password, deviceName: 'iOS test' });
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(response.body).sort(), ['deviceId', 'token', 'user']);
    assert.equal(response.body.user.passwordHash, undefined);
    return response.body;
  }

  await t.test('register and normal duplicate', async () => {
    registerLimiter.resetKey('127.0.0.1');
    const body = { name: 'Test', email: email('register'), password: oldPassword };
    const created = await request('POST', '/api/auth/register', body);
    assert.equal(created.status, 201);
    assert.deepEqual(Object.keys(created.body), ['user']);
    assert.equal(created.body.user.passwordHash, undefined);
    assert.equal((await request('POST', '/api/auth/register', body)).status, 409);
  });

  await t.test('concurrent duplicate is rejected by DB and translated to 409', async (st) => {
    registerLimiter.resetKey('127.0.0.1');
    const body = { name: 'Concurrent', email: email('duplicate'), password: oldPassword };
    const original = store.findUserByEmail;
    const bothRead = deferred();
    let reads = 0;
    st.mock.method(store, 'findUserByEmail', async (value) => {
      const found = await original(value);
      if (value === body.email) {
        assert.equal(found, null);
        if (++reads === 2) bothRead.resolve();
        await bothRead.promise;
      }
      return found;
    });
    const responses = await Promise.all([request('POST', '/api/auth/register', body), request('POST', '/api/auth/register', body)]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
    assert.equal(await prisma.user.count({ where: { email: body.email } }), 1);
  });

  await t.test('me, JWT claims, client validation, UUIDs, ownership and archive', async (st) => {
    const owner = await fixture('owner');
    const other = await fixture('other');
    const session = await login(owner);
    const otherSession = await login(other);
    assert.equal((await request('GET', '/api/auth/me', undefined, session.token)).body.user.id, owner.id);
    assert.equal((await request('GET', '/api/auth/me', undefined, `${session.token} trailing`)).status, 401);
    const badToken = signToken({ userId: 'invalid', sessionId: 'invalid', deviceId: 'invalid' });
    const lookup = st.mock.method(store, 'findSessionById', store.findSessionById);
    assert.equal((await request('GET', '/api/auth/me', undefined, badToken)).status, 401);
    assert.equal(lookup.mock.callCount(), 0);
    lookup.mock.restore();
    for (const body of [[], null, { name: 123 }, { name: '   ' }, { name: 'Client', email: 123 }, { name: 'Client', company: true }, { name: 'Client', userId: other.id }]) {
      assert.equal((await request('POST', '/api/clients', body, session.token)).status, 400);
    }
    const created = await request('POST', '/api/clients', { name: 'Client', email: '', company: null }, session.token);
    assert.equal(created.status, 201);
    assert.equal(created.body.client.email, null);
    const id = created.body.client.id;
    assert.equal((await request('GET', `/api/clients/${id}`, undefined, session.token)).status, 200);
    assert.equal((await request('PATCH', `/api/clients/${id}`, { name: 'Updated' }, session.token)).body.client.name, 'Updated');
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const body = method === 'PATCH' ? { name: 'Attempt' } : undefined;
      assert.equal((await request(method, '/api/clients/not-a-uuid', body, session.token)).status, 400);
      assert.equal((await request(method, `/api/clients/${randomUUID()}`, body, session.token)).status, 404);
      assert.equal((await request(method, `/api/clients/${id}`, body, otherSession.token)).status, 404);
    }
    assert.equal((await request('PATCH', `/api/clients/${id}`, { active: 'false' }, session.token)).status, 400);
    assert.equal((await request('PATCH', `/api/clients/${id}`, {}, session.token)).status, 400);
    assert.equal((await request('PATCH', `/api/clients/${id}`, { userId: other.id }, session.token)).status, 400);
    assert.equal((await request('DELETE', `/api/clients/${id}`, undefined, session.token)).body.client.active, false);
    assert.equal((await request('GET', '/api/clients', undefined, session.token)).body.clients.length, 0);
    assert.equal((await request('GET', '/api/clients?includeInactive=true', undefined, session.token)).body.clients.length, 1);
    assert.equal((await request('PATCH', `/api/clients/${id}`, { active: true }, session.token)).body.client.active, true);
    const devices = await request('GET', '/api/devices', undefined, session.token);
    assert.equal(devices.status, 200);
    assert.equal(devices.body.devices[0].isCurrentDevice, true);
    const deviceLookup = st.mock.method(store, 'findDeviceById', store.findDeviceById);
    assert.equal((await request('DELETE', '/api/devices/not-a-uuid', undefined, session.token)).status, 400);
    // Only the authenticated token's device was queried; the invalid parameter wasn't.
    assert.deepEqual(deviceLookup.mock.calls.map((call) => call.arguments[0]), [session.deviceId]);
    deviceLookup.mock.restore();
    assert.equal((await request('DELETE', `/api/devices/${randomUUID()}`, undefined, session.token)).status, 404);
    assert.equal((await request('DELETE', `/api/devices/${session.deviceId}`, undefined, otherSession.token)).status, 404);
    assert.equal((await request('DELETE', `/api/devices/${session.deviceId}`, undefined, session.token)).body.currentSessionClosed, true);
    assert.equal((await request('GET', '/api/auth/me', undefined, session.token)).status, 401);
  });

  await t.test('pending login using old password fails after password change', async (st) => {
    const user = await fixture('race');
    const existing = await login(user);
    const reached = deferred();
    const release = deferred();
    const original = store.createLoginSession;
    const mock = st.mock.method(store, 'createLoginSession', async (args) => {
      reached.resolve(); // bcrypt comparison has already succeeded in the controller.
      await release.promise;
      return original(args);
    });
    st.after(() => release.resolve());
    const pending = request('POST', '/api/auth/login', { email: user.email, password: oldPassword });
    await reached.promise;
    const changed = await request('POST', '/api/auth/change-password', { currentPassword: oldPassword, newPassword }, existing.token);
    assert.equal(changed.status, 200);
    assert.equal(await prisma.session.count({ where: { userId: user.id, revoked: false } }), 0);
    release.resolve();
    assert.equal((await pending).status, 401);
    mock.mock.restore();
    assert.equal(await prisma.session.count({ where: { userId: user.id, revoked: false } }), 0);
    assert.equal(await prisma.device.count({ where: { userId: user.id } }), 1);
    assert.equal((await request('GET', '/api/auth/me', undefined, existing.token)).status, 401);
    const fresh = await login(user, newPassword);
    assert.equal((await request('GET', '/api/auth/me', undefined, fresh.token)).status, 200);
  });

  await t.test('login holding actual row lock commits first; password change then revokes it', async (st) => {
    const user = await fixture('lock');
    const reached = deferred();
    const release = deferred();
    const originalTransaction = prisma.$transaction.bind(prisma);
    let intercept = true;
    st.after(() => { prisma.$transaction = originalTransaction; });
    prisma.$transaction = (callback, options) => originalTransaction(async (tx) => {
      if (!intercept) return callback(tx);
      intercept = false;
      const wrapped = new Proxy(tx, { get(target, key) {
        if (key !== 'device') return target[key];
        return { create: async (args) => {
          const device = await tx.device.create(args);
          reached.resolve(); // actual User lock acquired by production createLoginSession
          await release.promise;
          return device;
        } };
      } });
      return callback(wrapped);
    }, { ...options, timeout: 10000 });
    st.after(() => release.resolve());
    const pendingLogin = store.createLoginSession({ userId: user.id, expectedPasswordHash: passwordHash, deviceName: 'Lock', lastLoginAt: new Date() });
    await reached.promise;
    const newHash = await bcrypt.hash(newPassword, 4);
    const pendingChange = store.changePasswordAndRevokeSessions(user.id, passwordHash, newHash);
    // Observe real PostgreSQL contention, not just a mocked order of calls.
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await prisma.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%'`;
      if (rows.length) { blocked = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    release.resolve();
    const result = await pendingLogin;
    await pendingChange;
    assert.equal(blocked, true);
    assert.equal((await prisma.session.findUnique({ where: { sessionId: result.session.sessionId } })).revoked, true);
    const token = signToken({ userId: user.id, deviceId: result.device.deviceId, sessionId: result.session.sessionId });
    assert.equal((await request('GET', '/api/auth/me', undefined, token)).status, 401);
  });

  await t.test('failed revocation rolls back password update', async (st) => {
    const user = await fixture('rollback');
    const session = await login(user);
    const originalTransaction = prisma.$transaction.bind(prisma);
    st.after(() => { prisma.$transaction = originalTransaction; });
    prisma.$transaction = (callback, options) => originalTransaction((tx) => callback(new Proxy(tx, {
      get(target, key) {
        if (key === 'session') return { updateMany: async () => { throw new Error('Synthetic revocation failure'); } };
        return target[key];
      },
    })), options);
    await assert.rejects(store.changePasswordAndRevokeSessions(user.id, passwordHash, await bcrypt.hash(newPassword, 4)), /Synthetic revocation failure/);
    assert.equal((await store.findUserById(user.id)).passwordHash, passwordHash);
    assert.equal(await prisma.session.count({ where: { userId: user.id, revoked: false } }), 1);
    assert.equal((await request('GET', '/api/auth/me', undefined, session.token)).status, 200);
  });

  await t.test('sensitive validation, shared account limit, logout and account deletion', async () => {
    const user = await fixture('sensitive');
    const session = await login(user);
    for (const body of [{ currentPassword: 123, newPassword }, { currentPassword: oldPassword, newPassword: 'a'.repeat(73) }, []]) {
      assert.equal((await request('POST', '/api/auth/change-password', body, session.token)).status, 400);
    }
    for (const body of [{ password: 123 }, { password: '   ' }, {}]) {
      assert.equal((await request('DELETE', '/api/users/me', body, session.token)).status, 400);
    }
    sensitiveLimiter.resetKey(user.id);
    for (let index = 0; index < 10; index++) {
      assert.equal((await request('POST', '/api/auth/change-password', { currentPassword: 'WrongPassword!', newPassword }, session.token)).status, 401);
    }
    assert.equal((await request('DELETE', '/api/users/me', { password: oldPassword }, session.token)).status, 429);
    assert.equal((await request('GET', '/api/auth/me', undefined, session.token)).status, 200);
    sensitiveLimiter.resetKey(user.id);
    assert.equal((await request('DELETE', '/api/auth/session', undefined, session.token)).status, 200);
    assert.equal((await request('GET', '/api/auth/me', undefined, session.token)).status, 401);
    const fresh = await login(user);
    assert.equal((await request('DELETE', '/api/users/me', { password: oldPassword }, fresh.token)).status, 200);
    assert.equal((await request('GET', '/api/auth/me', undefined, fresh.token)).status, 401);
    assert.equal(await store.findUserById(user.id), null);
  });
});
