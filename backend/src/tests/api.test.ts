import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { db, initSchema } from '../db/schema';
import { authRoutes } from '../routes/auth';
import { problemRoutes } from '../routes/problems';
import bcrypt from 'bcryptjs';
import fs from 'fs';

const TEST_DIR = '/tmp/lite-polygon-api-test-' + Date.now();

let app: ReturnType<typeof Fastify>;
let cookie: string;
let problemId: number;

beforeAll(async () => {
  initSchema(TEST_DIR);

  app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  await app.register(authRoutes);
  await app.register(problemRoutes);
  await app.ready();

  // Create test user
  const hash = bcrypt.hashSync('testpass', 10);
  db.prepare("INSERT INTO users (username, password_hash) VALUES ('apiuser', ?)").run(hash);
});

afterAll(async () => {
  await app.close();
  db.close();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('Auth API', () => {
  it('POST /api/auth/login - success', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'apiuser', password: 'testpass' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('OK');
    expect(body.result.username).toBe('apiuser');
    // Extract cookie
    const setCookie = res.headers['set-cookie'] as string;
    cookie = setCookie?.split(';')[0] ?? '';
  });

  it('POST /api/auth/login - wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'apiuser', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('FAILED');
  });

  it('GET /api/auth/me - authenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.result.username).toBe('apiuser');
  });

  it('GET /api/auth/me - not authenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Problems API', () => {
  it('GET /api/problems.list - empty', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/problems.list', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('OK');
    expect(Array.isArray(body.result)).toBe(true);
  });

  it('POST /api/problem.create - success', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/problem.create',
      headers: { cookie },
      payload: { name: 'test-apiproblem' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('OK');
    expect(body.result.name).toBe('test-apiproblem');
    problemId = body.result.id;
  });

  it('POST /api/problem.create - duplicate', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/problem.create',
      headers: { cookie },
      payload: { name: 'test-apiproblem' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('GET /api/problem.info - success', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/problem.info?problemId=${problemId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.result.shortName).toBe('test-apiproblem');
  });

  it('GET /api/problem.info - missing problem', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/problem.info?problemId=99999',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/problem.info - no auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/problem.info?problemId=${problemId}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/problem.updateInfo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/problem.updateInfo',
      headers: { cookie },
      payload: { problemId, timeLimit: '2000', memoryLimit: String(512 * 1024 * 1024) },
    });
    expect(res.statusCode).toBe(200);
    const info = await app.inject({
      method: 'GET', url: `/api/problem.info?problemId=${problemId}`, headers: { cookie },
    });
    expect(JSON.parse(info.body).result.timeLimit).toBe(2000);
  });

  it('POST /api/problem.saveStatement and GET /api/problem.statements', async () => {
    const saveRes = await app.inject({
      method: 'POST',
      url: '/api/problem.saveStatement',
      headers: { cookie },
      payload: { problemId, lang: 'russian', name: 'Test Problem', legend: 'A legend', input: 'Read n', output: 'Print n' },
    });
    expect(saveRes.statusCode).toBe(200);

    const listRes = await app.inject({
      method: 'GET', url: `/api/problem.statements?problemId=${problemId}`, headers: { cookie },
    });
    const stmts = JSON.parse(listRes.body).result;
    expect(stmts.length).toBeGreaterThan(0);
    expect(stmts[0].name).toBe('Test Problem');
  });

  it('POST /api/problem.saveTest and GET /api/problem.tests', async () => {
    const saveRes = await app.inject({
      method: 'POST',
      url: '/api/problem.saveTest',
      headers: { cookie },
      payload: { problemId, method: 'manual', input: '3\n1 2 3\n', sample: 'true' },
    });
    expect(saveRes.statusCode).toBe(200);

    const listRes = await app.inject({
      method: 'GET', url: `/api/problem.tests?problemId=${problemId}`, headers: { cookie },
    });
    const tests = JSON.parse(listRes.body).result;
    expect(tests.length).toBeGreaterThan(0);
    expect(tests[0].sample).toBe(1);
  });

  it('POST /api/problem.setChecker and GET /api/problem.checker', async () => {
    const setRes = await app.inject({
      method: 'POST',
      url: '/api/problem.setChecker',
      headers: { cookie },
      payload: { problemId, sourcePath: 'files/check.cpp', sourceType: 'cpp.g++17' },
    });
    expect(setRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: 'GET', url: `/api/problem.checker?problemId=${problemId}`, headers: { cookie },
    });
    const checker = JSON.parse(getRes.body).result;
    expect(checker.source_path).toBe('files/check.cpp');
  });

  it('POST /api/problem.saveSolution and GET /api/problem.solutions', async () => {
    const saveRes = await app.inject({
      method: 'POST',
      url: '/api/problem.saveSolution',
      headers: { cookie },
      payload: {
        problemId,
        sourcePath: 'solutions/main.cpp',
        sourceType: 'cpp.g++17',
        tag: 'main',
        content: '#include<bits/stdc++.h>\nusing namespace std;\nint main(){int n;cin>>n;cout<<n;return 0;}',
      },
    });
    expect(saveRes.statusCode).toBe(200);

    const listRes = await app.inject({
      method: 'GET', url: `/api/problem.solutions?problemId=${problemId}`, headers: { cookie },
    });
    const sols = JSON.parse(listRes.body).result;
    expect(sols.length).toBeGreaterThan(0);
    expect(sols[0].tag).toBe('main');
  });

  it('GET /api/problem.cautions', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/problem.cautions?problemId=${problemId}`, headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).result;
    expect(data.cautions).toBeInstanceOf(Array);
    expect(data.aiTips).toBeInstanceOf(Array);
    expect(data.aiTips).toHaveLength(0);
  });

  it('POST /api/problem.saveTags and GET /api/problem.viewTags', async () => {
    const saveRes = await app.inject({
      method: 'POST',
      url: '/api/problem.saveTags',
      headers: { cookie },
      payload: { problemId, tags: 'dp,graph,trees' },
    });
    expect(saveRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: 'GET', url: `/api/problem.viewTags?problemId=${problemId}`, headers: { cookie },
    });
    const tags = JSON.parse(getRes.body).result;
    expect(tags).toContain('dp');
    expect(tags).toContain('graph');
  });

  it('wrong owner cannot access problem', async () => {
    // Create second user
    const hash = bcrypt.hashSync('pass2', 10);
    db.prepare("INSERT INTO users (username, password_hash) VALUES ('user2', ?)").run(hash);
    const loginRes = await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { username: 'user2', password: 'pass2' },
    });
    const cookie2 = (loginRes.headers['set-cookie'] as string)?.split(';')[0] ?? '';

    const res = await app.inject({
      method: 'GET', url: `/api/problem.info?problemId=${problemId}`, headers: { cookie: cookie2 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/problem.buildPackage', async () => {
    // Packages can only be built from a committed (unmodified) working copy.
    await app.inject({ method: 'POST', url: '/api/problem.commitChanges', headers: { cookie }, payload: { problemId } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/problem.buildPackage',
      headers: { cookie },
      payload: { problemId, type: 'standard' },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).result;
    expect(data.packageId).toBeGreaterThan(0);
    expect(data.state).toBe('PENDING');
  });
});
