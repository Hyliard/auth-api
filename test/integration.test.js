const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { mkdtempSync, readdirSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');

// Explicit opt-in; never use the developer DATABASE_URL or load their .env.
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || new URL(testUrl).pathname !== '/auth_api_phase1_test') {
  throw new Error('TEST_DATABASE_URL debe apuntar a la base aislada auth_api_phase1_test');
}
process.env.DATABASE_URL = testUrl;
process.env.JWT_SECRET = 'integration-test-only-credential-0123456789abcdef';
process.env.JWT_EXPIRES_IN = '1h';
const avatarStorageDir = mkdtempSync(path.join(os.tmpdir(), 'auth-api-avatar-test-'));
process.env.AVATAR_STORAGE_DIR = avatarStorageDir;
const prisma = require('../src/store/prisma');
const store = require('../src/store/db.store');
const app = require('../src/app');
const { signToken } = require('../src/utils/jwt');
const { registerLimiter, loginLimiter, sensitiveLimiter, avatarUploadLimiter } = require('../src/middleware/rate-limit.middleware');
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
    rmSync(avatarStorageDir, { recursive: true, force: true });
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
  async function avatarRequest(token, files = [], fields = []) {
    const form = new FormData();
    for (const [key, value] of fields) form.append(key, value);
    for (const file of files) {
      form.append(file.field || 'avatar', new Blob([file.buffer], { type: file.type }), file.name);
    }
    const response = await fetch(`${base}/api/users/me/avatar`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    return { status: response.status, body: await response.json() };
  }

  await t.test('register and normal duplicate', async () => {
    registerLimiter.resetKey('127.0.0.1');
    const body = { name: 'Test', email: email('register'), password: oldPassword };
    const created = await request('POST', '/api/auth/register', body);
    assert.equal(created.status, 201);
    assert.deepEqual(Object.keys(created.body), ['user']);
    assert.equal(created.body.user.passwordHash, undefined);
    assert.equal(created.body.user.avatarUrl, null);
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

  await t.test('contract CRUD, validation, ownership, filters and archive', async () => {
    const owner = await fixture('contract-owner');
    const other = await fixture('contract-other');
    const session = await login(owner);
    const otherSession = await login(other);
    const client = await store.createClient({ userId: owner.id, name: 'Primary Client', email: null, company: 'Primary Co' });
    const secondClient = await store.createClient({ userId: owner.id, name: 'Second Client', email: null, company: null });
    const inactiveClient = await store.createClient({ userId: owner.id, name: 'Inactive Client', email: null, company: null });
    await store.updateClient(owner.id, inactiveClient.id, { active: false });
    const otherClient = await store.createClient({ userId: other.id, name: 'Other Client', email: null, company: null });
    const payload = {
      clientId: client.id,
      name: 'Backend Contract',
      hourlyRate: '45.50',
      currency: 'usd',
      overtimeRate: '67.75',
      startDate: '2026-09-01',
      endDate: '2026-12-31',
    };

    let response = await request('POST', '/api/contracts', payload, session.token);
    assert.equal(response.status, 201);
    assert.equal(response.body.contract.userId, undefined);
    assert.equal(response.body.contract.hourlyRate, '45.5');
    assert.equal(response.body.contract.overtimeRate, '67.75');
    assert.equal(response.body.contract.currency, 'USD');
    assert.equal(response.body.contract.startDate, '2026-09-01');
    assert.deepEqual(response.body.contract.client, { id: client.id, name: client.name, company: client.company });
    const contractId = response.body.contract.id;

    response = await request('GET', '/api/contracts', undefined, session.token);
    assert.equal(response.status, 200);
    assert.equal(response.body.contracts.some((contract) => contract.id === contractId), true);
    assert.equal((await request('GET', `/api/contracts/${contractId}`, undefined, session.token)).status, 200);
    response = await request('GET', `/api/contracts?clientId=${client.id}`, undefined, session.token);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.contracts.map((contract) => contract.id), [contractId]);
    assert.equal((await request('GET', `/api/contracts?clientId=${otherClient.id}`, undefined, session.token)).status, 404);

    response = await request('PATCH', `/api/contracts/${contractId}`, {
      clientId: secondClient.id,
      hourlyRate: '50.25',
      overtimeRate: null,
      endDate: null,
    }, session.token);
    assert.equal(response.status, 200);
    assert.equal(response.body.contract.clientId, secondClient.id);
    assert.equal(response.body.contract.hourlyRate, '50.25');
    assert.equal(response.body.contract.overtimeRate, null);
    assert.equal(response.body.contract.endDate, null);

    const otherContract = await request('POST', '/api/contracts', {
      clientId: otherClient.id, name: 'Other Contract', hourlyRate: '20', currency: 'EUR',
    }, otherSession.token);
    assert.equal(otherContract.status, 201);
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const body = method === 'PATCH' ? { name: 'Forbidden' } : undefined;
      assert.equal((await request(method, `/api/contracts/${otherContract.body.contract.id}`, body, session.token)).status, 404);
    }

    assert.equal((await request('POST', '/api/contracts', { ...payload, clientId: otherClient.id }, session.token)).status, 404);
    assert.equal((await request('POST', '/api/contracts', { ...payload, clientId: inactiveClient.id }, session.token)).status, 409);
    assert.equal((await request('PATCH', `/api/contracts/${contractId}`, { clientId: inactiveClient.id }, session.token)).status, 409);
    assert.equal((await request('POST', '/api/contracts', { ...payload, clientId: 'not-a-uuid' }, session.token)).status, 400);
    assert.equal((await request('GET', '/api/contracts?clientId=not-a-uuid', undefined, session.token)).status, 400);
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const body = method === 'PATCH' ? { name: 'Invalid' } : undefined;
      assert.equal((await request(method, '/api/contracts/not-a-uuid', body, session.token)).status, 400);
    }
    for (const hourlyRate of ['0', '-1']) {
      assert.equal((await request('POST', '/api/contracts', { ...payload, hourlyRate }, session.token)).status, 400);
    }
    assert.equal((await request('POST', '/api/contracts', { ...payload, overtimeRate: '-0.01' }, session.token)).status, 400);
    assert.equal((await request('POST', '/api/contracts', { ...payload, currency: 'US' }, session.token)).status, 400);
    assert.equal((await request('POST', '/api/contracts', { ...payload, startDate: '2026-02-30' }, session.token)).status, 400);
    assert.equal((await request('POST', '/api/contracts', { ...payload, endDate: '2026-08-31' }, session.token)).status, 400);
    assert.equal((await request('POST', '/api/contracts', { ...payload, userId: owner.id }, session.token)).status, 400);
    assert.equal((await request('PATCH', `/api/contracts/${contractId}`, {}, session.token)).status, 400);
    assert.equal((await request('PATCH', `/api/contracts/${contractId}`, { startDate: '2027-01-01', endDate: '2026-12-31' }, session.token)).status, 400);

    response = await request('DELETE', `/api/contracts/${contractId}`, undefined, session.token);
    assert.equal(response.status, 200);
    assert.equal(response.body.contract.active, false);
    response = await request('GET', '/api/contracts', undefined, session.token);
    assert.equal(response.body.contracts.some((contract) => contract.id === contractId), false);
    response = await request('GET', '/api/contracts?includeInactive=true', undefined, session.token);
    assert.equal(response.body.contracts.some((contract) => contract.id === contractId && !contract.active), true);
    response = await request('PATCH', `/api/contracts/${contractId}`, { active: true }, session.token);
    assert.equal(response.status, 200);
    assert.equal(response.body.contract.active, true);
  });

  await t.test('worklog CRUD, soft delete, validation, ownership and combined filters', async () => {
    const owner = await fixture('worklog-owner');
    const other = await fixture('worklog-other');
    const session = await login(owner);
    const otherSession = await login(other);
    const client = await store.createClient({ userId: owner.id, name: 'WorkLog Client', email: null, company: 'WorkLog Co' });
    const otherClient = await store.createClient({ userId: other.id, name: 'Other WorkLog Client', email: null, company: null });
    const contract = await store.createContract({
      userId: owner.id, clientId: client.id, name: 'WorkLog Contract', hourlyRate: '40', currency: 'USD',
    });
    const inactiveContract = await store.createContract({
      userId: owner.id, clientId: client.id, name: 'Inactive WorkLog Contract', hourlyRate: '50', currency: 'USD',
    });
    await store.updateContract(owner.id, inactiveContract.id, { active: false });
    const otherContract = await store.createContract({
      userId: other.id, clientId: otherClient.id, name: 'Other WorkLog Contract', hourlyRate: '30', currency: 'EUR',
    });
    const payload = {
      contractId: contract.id,
      workDate: '2026-09-17',
      hours: '8.00',
      isOvertime: false,
      note: '  Backend implementation  ',
    };

    let response = await request('POST', '/api/worklogs', payload, session.token);
    assert.equal(response.status, 201);
    assert.equal(response.body.workLog.userId, undefined);
    assert.equal(response.body.workLog.hours, '8');
    assert.equal(response.body.workLog.workDate, '2026-09-17');
    assert.equal(response.body.workLog.note, 'Backend implementation');
    assert.equal(response.body.workLog.active, true);
    assert.equal(response.body.workLog.deletedAt, null);
    assert.equal(response.body.workLog.contract.hourlyRate, '40');
    assert.deepEqual(response.body.workLog.contract.client, { id: client.id, name: client.name, company: client.company });
    const workLogId = response.body.workLog.id;

    response = await request('POST', '/api/worklogs', { ...payload, note: '' }, session.token);
    assert.equal(response.status, 201);
    assert.equal(response.body.workLog.note, null);
    const sameDayId = response.body.workLog.id;
    response = await request('POST', '/api/worklogs', {
      ...payload, workDate: '2026-09-20', hours: '2.5', isOvertime: true, note: null,
    }, session.token);
    assert.equal(response.status, 201);
    const overtimeId = response.body.workLog.id;
    response = await request('POST', '/api/worklogs', {
      ...payload, workDate: '2026-10-01', hours: '4', note: 'October',
    }, session.token);
    assert.equal(response.status, 201);
    const octoberId = response.body.workLog.id;

    response = await request('GET', '/api/worklogs', undefined, session.token);
    assert.equal(response.status, 200);
    assert.equal(response.body.workLogs.some((workLog) => workLog.id === workLogId), true);
    assert.equal((await request('GET', `/api/worklogs/${workLogId}`, undefined, session.token)).status, 200);
    response = await request('PATCH', `/api/worklogs/${workLogId}`, { hours: '7.5', note: 'Corrected' }, session.token);
    assert.equal(response.status, 200);
    assert.equal(response.body.workLog.hours, '7.5');

    for (const [query, expectedIds] of [
      [`contractId=${contract.id}`, [workLogId, sameDayId, overtimeId, octoberId]],
      ['from=2026-09-20', [overtimeId, octoberId]],
      ['to=2026-09-17', [workLogId, sameDayId]],
      ['from=2026-09-18&to=2026-09-30', [overtimeId]],
      ['isOvertime=true', [overtimeId]],
      [`contractId=${contract.id}&from=2026-09-18&to=2026-09-30&isOvertime=true`, [overtimeId]],
    ]) {
      response = await request('GET', `/api/worklogs?${query}`, undefined, session.token);
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.workLogs.map((workLog) => workLog.id).sort(), expectedIds.sort());
    }

    const otherWorkLog = await request('POST', '/api/worklogs', {
      contractId: otherContract.id, workDate: '2026-09-17', hours: '1', note: null,
    }, otherSession.token);
    assert.equal(otherWorkLog.status, 201);
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const body = method === 'PATCH' ? { hours: '2' } : undefined;
      assert.equal((await request(method, `/api/worklogs/${otherWorkLog.body.workLog.id}`, body, session.token)).status, 404);
    }
    assert.equal((await request('POST', '/api/worklogs', { ...payload, contractId: otherContract.id }, session.token)).status, 404);
    assert.equal((await request('GET', `/api/worklogs?contractId=${otherContract.id}`, undefined, session.token)).status, 404);
    assert.equal((await request('POST', '/api/worklogs', { ...payload, contractId: inactiveContract.id }, session.token)).status, 409);
    assert.equal((await request('PATCH', `/api/worklogs/${workLogId}`, { contractId: inactiveContract.id }, session.token)).status, 409);

    await store.updateContract(owner.id, contract.id, { active: false });
    response = await request('PATCH', `/api/worklogs/${workLogId}`, { note: 'Contract archived but correction allowed' }, session.token);
    assert.equal(response.status, 200);
    assert.equal(response.body.workLog.note, 'Contract archived but correction allowed');

    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const body = method === 'PATCH' ? { hours: '1' } : undefined;
      assert.equal((await request(method, '/api/worklogs/not-a-uuid', body, session.token)).status, 400);
    }
    for (const hours of ['0', '-1']) {
      assert.equal((await request('POST', '/api/worklogs', { ...payload, hours, contractId: inactiveContract.id }, session.token)).status, 400);
    }
    assert.equal((await request('POST', '/api/worklogs', { ...payload, workDate: '2026-02-30' }, session.token)).status, 400);
    assert.equal((await request('GET', '/api/worklogs?from=2026-10-01&to=2026-09-01', undefined, session.token)).status, 400);
    assert.equal((await request('GET', '/api/worklogs?isOvertime=yes', undefined, session.token)).status, 400);
    assert.equal((await request('GET', '/api/worklogs?unknown=true', undefined, session.token)).status, 400);
    assert.equal((await request('POST', '/api/worklogs', { ...payload, userId: owner.id }, session.token)).status, 400);
    assert.equal((await request('PATCH', `/api/worklogs/${workLogId}`, {}, session.token)).status, 400);
    assert.equal((await request('PATCH', `/api/worklogs/${workLogId}`, { note: 'x'.repeat(2001) }, session.token)).status, 400);

    response = await request('DELETE', `/api/worklogs/${workLogId}`, undefined, session.token);
    assert.equal(response.status, 200);
    assert.equal(response.body.workLog.active, false);
    assert.notEqual(response.body.workLog.deletedAt, null);
    const deletedAt = response.body.workLog.deletedAt;
    response = await request('DELETE', `/api/worklogs/${workLogId}`, undefined, session.token);
    assert.equal(response.status, 200);
    assert.equal(response.body.workLog.deletedAt, deletedAt);
    assert.equal((await request('GET', `/api/worklogs/${workLogId}`, undefined, session.token)).status, 200);
    response = await request('GET', '/api/worklogs', undefined, session.token);
    assert.equal(response.body.workLogs.some((workLog) => workLog.id === workLogId), false);
    response = await request('GET', '/api/worklogs?includeInactive=true', undefined, session.token);
    assert.equal(response.body.workLogs.some((workLog) => workLog.id === workLogId && !workLog.active), true);
    response = await request('PATCH', `/api/worklogs/${workLogId}`, { active: true }, session.token);
    assert.equal(response.status, 200);
    assert.equal(response.body.workLog.active, true);
    assert.equal(response.body.workLog.deletedAt, null);
  });

  await t.test('avatar upload, validation, replacement, isolation, download and account cleanup', async (st) => {
    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q==', 'base64');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
    const owner = await fixture('avatar-owner');
    const other = await fixture('avatar-other');
    const session = await login(owner);
    const otherSession = await login(other);
    avatarUploadLimiter.resetKey(owner.id);
    avatarUploadLimiter.resetKey(other.id);

    let response = await request('GET', '/api/auth/me', undefined, session.token);
    assert.equal(response.status, 200);
    assert.equal(response.body.user.avatarUrl, null);
    assert.equal((await request('GET', '/api/users/me/avatar', undefined, session.token)).status, 404);
    assert.equal((await avatarRequest(undefined, [{ buffer: png, type: 'image/png', name: 'valid.png' }])).status, 401);
    assert.equal((await avatarRequest('invalid-token', [{ buffer: png, type: 'image/png', name: 'valid.png' }])).status, 401);
    assert.equal((await avatarRequest(session.token)).status, 400);
    assert.equal((await avatarRequest(session.token, [{ field: 'photo', buffer: png, type: 'image/png', name: 'valid.png' }])).status, 400);
    assert.equal((await avatarRequest(session.token, [
      { buffer: png, type: 'image/png', name: 'one.png' },
      { buffer: png, type: 'image/png', name: 'two.png' },
    ])).status, 400);
    assert.equal((await avatarRequest(session.token, [{ buffer: Buffer.alloc(5 * 1024 * 1024 + 1), type: 'image/png', name: 'large.png' }])).status, 413);
    assert.equal((await avatarRequest(session.token, [{ buffer: png, type: 'image/jpeg', name: 'fake.jpg' }])).status, 415);
    assert.equal((await avatarRequest(session.token, [{ buffer: Buffer.from('not an image'), type: 'image/png', name: 'fake.png' }])).status, 400);
    assert.equal((await avatarRequest(session.token, [{ buffer: Buffer.from('GIF89a'), type: 'image/gif', name: 'image.gif' }])).status, 415);
    assert.equal((await avatarRequest(session.token, [{ buffer: Buffer.alloc(0), type: 'image/png', name: 'empty.png' }])).status, 400);

    response = await avatarRequest(session.token, [{ buffer: jpeg, type: 'image/jpeg', name: '../../original-name.jpg' }]);
    assert.equal(response.status, 200);
    assert.match(response.body.user.avatarUrl, /^\/api\/users\/me\/avatar\?v=[0-9a-f]{16}$/);
    assert.equal(response.body.user.avatarFilename, undefined);
    assert.equal(JSON.stringify(response.body).includes(avatarStorageDir), false);
    let storedUser = await store.findUserById(owner.id);
    assert.match(storedUser.avatarFilename, /^[0-9a-f-]+\.jpg$/);
    assert.equal(storedUser.avatarFilename.includes('original-name'), false);
    const jpegFilename = storedUser.avatarFilename;
    assert.deepEqual(readdirSync(avatarStorageDir), [jpegFilename]);

    let download = await fetch(`${base}/api/users/me/avatar`, { headers: { Authorization: `Bearer ${session.token}` } });
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-type'), /^image\/jpeg/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), jpeg);
    assert.equal((await request('GET', '/api/users/me/avatar', undefined, otherSession.token)).status, 404);

    response = await avatarRequest(session.token, [{ buffer: png, type: 'image/png', name: 'replacement.png' }]);
    assert.equal(response.status, 200);
    storedUser = await store.findUserById(owner.id);
    assert.match(storedUser.avatarFilename, /^[0-9a-f-]+\.png$/);
    assert.notEqual(storedUser.avatarFilename, jpegFilename);
    assert.deepEqual(readdirSync(avatarStorageDir), [storedUser.avatarFilename]);

    response = await avatarRequest(session.token, [{ buffer: webp, type: 'image/webp', name: 'avatar.webp' }]);
    assert.equal(response.status, 200);
    storedUser = await store.findUserById(owner.id);
    assert.match(storedUser.avatarFilename, /^[0-9a-f-]+\.webp$/);
    assert.deepEqual(readdirSync(avatarStorageDir), [storedUser.avatarFilename]);
    response = await request('GET', '/api/auth/me', undefined, session.token);
    assert.equal(response.status, 200);
    assert.equal(response.body.user.avatarUrl.includes(storedUser.avatarFilename), false);

    response = await avatarRequest(otherSession.token, [{ buffer: png, type: 'image/png', name: 'other.png' }]);
    assert.equal(response.status, 200);
    assert.equal((await store.findUserById(owner.id)).avatarFilename, storedUser.avatarFilename);
    assert.notEqual((await store.findUserById(other.id)).avatarFilename, storedUser.avatarFilename);

    const filesBeforeFailure = readdirSync(avatarStorageDir).sort();
    const replacementMock = st.mock.method(store, 'replaceUserAvatar', async () => {
      throw new Error('Synthetic avatar database failure');
    });
    response = await avatarRequest(session.token, [{ buffer: png, type: 'image/png', name: 'rollback.png' }]);
    assert.equal(response.status, 500);
    assert.deepEqual(readdirSync(avatarStorageDir).sort(), filesBeforeFailure);
    replacementMock.mock.restore();

    sensitiveLimiter.resetKey(owner.id);
    response = await request('DELETE', '/api/users/me', { password: oldPassword }, session.token);
    assert.equal(response.status, 200);
    assert.equal(readdirSync(avatarStorageDir).includes(storedUser.avatarFilename), false);
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
