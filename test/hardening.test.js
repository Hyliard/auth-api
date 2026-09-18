const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { validateConfig } = require('../src/utils/config');
const { validateBody, validatePassword, validateUuid } = require('../src/utils/validators');
const { errorHandler } = require('../src/middleware/error.middleware');
const prisma = require('../src/store/prisma');
const store = require('../src/store/db.store');
const app = require('../src/app');
const { registerLimiter, loginLimiter } = require('../src/middleware/rate-limit.middleware');

const validConfig = {
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/auth_api_phase1_test',
  JWT_SECRET: 'test-only-random-looking-credential-0123456789abcdef',
  JWT_EXPIRES_IN: '7d', PORT: '3000',
};

test('configuration validates fields without exposing their values', () => {
  assert.deepEqual(validateConfig(validConfig), { port: 3000 });
  assert.equal(validateConfig({ ...validConfig, PORT: undefined, JWT_EXPIRES_IN: undefined }).port, 3000);
  for (const [key, values] of Object.entries({
    JWT_SECRET: [undefined, '', 'short', 'cambia_este_secreto_por_una_cadena_larga_y_aleatoria'],
    DATABASE_URL: [undefined, '', 'not-a-url', 'https://host/database', 'postgresql://host/'],
    PORT: ['', '0', '-1', '65536', '3.14', 'abc', '3000junk'],
    JWT_EXPIRES_IN: ['', '0s', '-1h', '120', 'bad', '1ms', '999999999999999999999y'],
    AVATAR_STORAGE_DIR: ['relative/path'],
  })) {
    for (const value of values) assert.throws(() => validateConfig({ ...validConfig, [key]: value }), new RegExp(key));
  }
});

test('password byte boundary, UUIDs and object bodies', () => {
  assert.equal(validatePassword('é'.repeat(36)), 'é'.repeat(36));
  for (const value of ['é'.repeat(37), 'a'.repeat(73), '        ', 123, {}, null, 'short']) {
    assert.throws(() => validatePassword(value), { statusCode: 400 });
  }
  for (const value of [[], null, 'text', 123, undefined]) assert.throws(() => validateBody(value), { statusCode: 400 });
  assert.equal(validateUuid('ABCDEF12-1234-1234-1234-123456789ABC', 'id'), 'abcdef12-1234-1234-1234-123456789abc');
  assert.throws(() => validateUuid('bad-id', 'id'), { statusCode: 400 });
});

test('unexpected error logs discard messages, stack, body, headers and secrets', (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  const secret = 'DO_NOT_LOG_PASSWORD_OR_JWT';
  const error = Object.assign(new Error(secret), {
    name: secret, code: secret, body: { password: secret, currentPassword: secret, newPassword: secret },
    headers: { Authorization: secret }, JWT_SECRET: secret,
  });
  let response;
  errorHandler(error, {}, { status(code) { assert.equal(code, 500); return this; }, json(body) { response = body; } }, () => {});
  assert.equal(logs.length, 1);
  assert.equal(JSON.stringify({ logs, response }).includes(secret), false);
  assert.equal(response.error.message, 'Error interno del servidor');
});

test('only email P2002 is translated to 409', async () => {
  for (const [code, target, expected] of [['P2002', ['email'], 409], ['P2002', ['id'], undefined], ['P2003', ['email'], undefined]]) {
    const error = Object.assign(new Error('synthetic'), { code, meta: { target } });
    const original = prisma.user.create;
    prisma.user.create = async () => { throw error; };
    try {
      await assert.rejects(store.createUser({ name: 'test', email: 'test@example.com', passwordHash: 'synthetic' }), (err) => expected ? err.statusCode === expected : err === error);
    } finally {
      prisma.user.create = original;
    }
  }
});

test('HTTP invalid inputs, parser errors and limits without database access', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  t.mock.method(store, 'findUserByEmail', () => { throw new Error('Invalid input reached database'); });
  const send = (route, body, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const registration = { name: 'Test', email: 'test@example.com', password: 'Password123!' };
  for (const body of [{ ...registration, name: 123 }, { ...registration, name: '   ' }, { ...registration, password: 'a'.repeat(73) }, { ...registration, email: 123 }, {}, [], null, 'text', 123]) {
    registerLimiter.resetKey('127.0.0.1');
    assert.equal((await send('/api/auth/register', body)).status, 400);
  }
  assert.equal((await send('/api/auth/login', { email: 123, password: 'Password123!' })).status, 400);
  assert.equal((await send('/api/auth/login', { email: 'test@example.com', password: 'Password123!', deviceName: 123 })).status, 400);
  const response = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"DO_NOT_LOG_PASSWORD",}' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.message, 'El cuerpo JSON no es valido');
  assert.deepEqual(logs, []);

  assert.equal(app.get('trust proxy'), false);
  loginLimiter.resetKey('127.0.0.1');
  for (let index = 0; index < 30; index++) {
    // Different forged forwarded IPs must not bypass the limit.
    assert.equal((await send('/api/auth/login', { email: 123 }, { 'X-Forwarded-For': `192.0.2.${index + 1}` })).status, 400);
  }
  const limited = await send('/api/auth/login', { email: 123 });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.statusCode, 429);
  assert.ok(limited.headers.get('retry-after'));
  assert.equal((await fetch(base + '/api/health')).status, 200);
  registerLimiter.resetKey('127.0.0.1');
  for (let index = 0; index < 10; index++) assert.equal((await send('/api/auth/register', {})).status, 400);
  assert.equal((await send('/api/auth/register', {})).status, 429);
  assert.deepEqual(logs, []);
});

test('server refuses missing/placeholder secret and starts with valid config', { timeout: 15000 }, async (t) => {
  const serverPath = path.resolve(__dirname, '../src/server.js');
  for (const secret of [undefined, 'cambia_este_secreto_por_una_cadena_larga_y_aleatoria']) {
    const env = { ...process.env, ...validConfig };
    if (secret === undefined) delete env.JWT_SECRET; else env.JWT_SECRET = secret;
    // Different cwd ensures the developer .env cannot fill in a missing secret.
    const child = spawn(process.execPath, [serverPath], { cwd: os.tmpdir(), env });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const [code] = await once(child, 'close');
    assert.equal(code, 1);
    assert.match(output, /JWT_SECRET/);
    assert.doesNotMatch(output, /escuchando/);
    if (secret) assert.equal(output.includes(secret), false);
  }
  const portProbe = net.createServer().listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  const child = spawn(process.execPath, [serverPath], { cwd: os.tmpdir(), env: { ...process.env, ...validConfig, PORT: String(port) } });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; if (output.includes('escuchando')) resolve(); });
    child.on('exit', (code) => reject(new Error(`Server exited: ${code}`)));
    child.on('error', reject);
  });
  const response = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(response.status, 200);
  child.kill();
  await once(child, 'close');
});
