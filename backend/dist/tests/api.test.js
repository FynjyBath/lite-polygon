"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fastify_1 = __importDefault(require("fastify"));
const cookie_1 = __importDefault(require("@fastify/cookie"));
const multipart_1 = __importDefault(require("@fastify/multipart"));
const schema_1 = require("../db/schema");
const auth_1 = require("../routes/auth");
const problems_1 = require("../routes/problems");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const fs_1 = __importDefault(require("fs"));
const TEST_DIR = '/tmp/lite-polygon-api-test-' + Date.now();
let app;
let cookie;
let problemId;
(0, vitest_1.beforeAll)(async () => {
    (0, schema_1.initSchema)(TEST_DIR);
    app = (0, fastify_1.default)({ logger: false });
    await app.register(cookie_1.default);
    await app.register(multipart_1.default, { limits: { fileSize: 10 * 1024 * 1024 } });
    await app.register(auth_1.authRoutes);
    await app.register(problems_1.problemRoutes);
    await app.ready();
    // Create test user
    const hash = bcryptjs_1.default.hashSync('testpass', 10);
    schema_1.db.prepare("INSERT INTO users (username, password_hash) VALUES ('apiuser', ?)").run(hash);
});
(0, vitest_1.afterAll)(async () => {
    await app.close();
    schema_1.db.close();
    fs_1.default.rmSync(TEST_DIR, { recursive: true, force: true });
});
(0, vitest_1.describe)('Auth API', () => {
    (0, vitest_1.it)('POST /api/auth/login - success', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/auth/login',
            payload: { username: 'apiuser', password: 'testpass' },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        (0, vitest_1.expect)(body.status).toBe('OK');
        (0, vitest_1.expect)(body.result.username).toBe('apiuser');
        // Extract cookie
        const setCookie = res.headers['set-cookie'];
        cookie = setCookie?.split(';')[0] ?? '';
    });
    (0, vitest_1.it)('POST /api/auth/login - wrong password', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/auth/login',
            payload: { username: 'apiuser', password: 'wrong' },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(401);
        const body = JSON.parse(res.body);
        (0, vitest_1.expect)(body.status).toBe('FAILED');
    });
    (0, vitest_1.it)('GET /api/auth/me - authenticated', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/auth/me',
            headers: { cookie },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        (0, vitest_1.expect)(body.result.username).toBe('apiuser');
    });
    (0, vitest_1.it)('GET /api/auth/me - not authenticated', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/auth/me',
        });
        (0, vitest_1.expect)(res.statusCode).toBe(401);
    });
});
(0, vitest_1.describe)('Problems API', () => {
    (0, vitest_1.it)('GET /api/problems.list - empty', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/problems.list', headers: { cookie } });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        (0, vitest_1.expect)(body.status).toBe('OK');
        (0, vitest_1.expect)(Array.isArray(body.result)).toBe(true);
    });
    (0, vitest_1.it)('POST /api/problem.create - success', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/problem.create',
            headers: { cookie },
            payload: { name: 'test-apiproblem' },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        (0, vitest_1.expect)(body.status).toBe('OK');
        (0, vitest_1.expect)(body.result.name).toBe('test-apiproblem');
        problemId = body.result.id;
    });
    (0, vitest_1.it)('POST /api/problem.create - duplicate', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/problem.create',
            headers: { cookie },
            payload: { name: 'test-apiproblem' },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(409);
    });
    (0, vitest_1.it)('GET /api/problem.info - success', async () => {
        const res = await app.inject({
            method: 'GET',
            url: `/api/problem.info?problemId=${problemId}`,
            headers: { cookie },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        (0, vitest_1.expect)(body.result.shortName).toBe('test-apiproblem');
    });
    (0, vitest_1.it)('GET /api/problem.info - missing problem', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/problem.info?problemId=99999',
            headers: { cookie },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(404);
    });
    (0, vitest_1.it)('GET /api/problem.info - no auth', async () => {
        const res = await app.inject({
            method: 'GET',
            url: `/api/problem.info?problemId=${problemId}`,
        });
        (0, vitest_1.expect)(res.statusCode).toBe(401);
    });
    (0, vitest_1.it)('POST /api/problem.updateInfo', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/problem.updateInfo',
            headers: { cookie },
            payload: { problemId, timeLimit: '2000', memoryLimit: String(512 * 1024 * 1024) },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const info = await app.inject({
            method: 'GET', url: `/api/problem.info?problemId=${problemId}`, headers: { cookie },
        });
        (0, vitest_1.expect)(JSON.parse(info.body).result.timeLimit).toBe(2000);
    });
    (0, vitest_1.it)('POST /api/problem.saveStatement and GET /api/problem.statements', async () => {
        const saveRes = await app.inject({
            method: 'POST',
            url: '/api/problem.saveStatement',
            headers: { cookie },
            payload: { problemId, lang: 'russian', name: 'Test Problem', legend: 'A legend', input: 'Read n', output: 'Print n' },
        });
        (0, vitest_1.expect)(saveRes.statusCode).toBe(200);
        const listRes = await app.inject({
            method: 'GET', url: `/api/problem.statements?problemId=${problemId}`, headers: { cookie },
        });
        const stmts = JSON.parse(listRes.body).result;
        (0, vitest_1.expect)(stmts.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(stmts[0].name).toBe('Test Problem');
    });
    (0, vitest_1.it)('POST /api/problem.saveTest and GET /api/problem.tests', async () => {
        const saveRes = await app.inject({
            method: 'POST',
            url: '/api/problem.saveTest',
            headers: { cookie },
            payload: { problemId, method: 'manual', input: '3\n1 2 3\n', sample: 'true' },
        });
        (0, vitest_1.expect)(saveRes.statusCode).toBe(200);
        const listRes = await app.inject({
            method: 'GET', url: `/api/problem.tests?problemId=${problemId}`, headers: { cookie },
        });
        const tests = JSON.parse(listRes.body).result;
        (0, vitest_1.expect)(tests.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(tests[0].sample).toBe(1);
    });
    (0, vitest_1.it)('POST /api/problem.setChecker and GET /api/problem.checker', async () => {
        const setRes = await app.inject({
            method: 'POST',
            url: '/api/problem.setChecker',
            headers: { cookie },
            payload: { problemId, sourcePath: 'files/check.cpp', sourceType: 'cpp.g++17' },
        });
        (0, vitest_1.expect)(setRes.statusCode).toBe(200);
        const getRes = await app.inject({
            method: 'GET', url: `/api/problem.checker?problemId=${problemId}`, headers: { cookie },
        });
        const checker = JSON.parse(getRes.body).result;
        (0, vitest_1.expect)(checker.source_path).toBe('files/check.cpp');
    });
    (0, vitest_1.it)('POST /api/problem.saveSolution and GET /api/problem.solutions', async () => {
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
        (0, vitest_1.expect)(saveRes.statusCode).toBe(200);
        const listRes = await app.inject({
            method: 'GET', url: `/api/problem.solutions?problemId=${problemId}`, headers: { cookie },
        });
        const sols = JSON.parse(listRes.body).result;
        (0, vitest_1.expect)(sols.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(sols[0].tag).toBe('main');
    });
    (0, vitest_1.it)('GET /api/problem.cautions', async () => {
        const res = await app.inject({
            method: 'GET', url: `/api/problem.cautions?problemId=${problemId}`, headers: { cookie },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const data = JSON.parse(res.body).result;
        (0, vitest_1.expect)(data.cautions).toBeInstanceOf(Array);
        (0, vitest_1.expect)(data.aiTips).toBeInstanceOf(Array);
        (0, vitest_1.expect)(data.aiTips).toHaveLength(0);
    });
    (0, vitest_1.it)('POST /api/problem.saveTags and GET /api/problem.viewTags', async () => {
        const saveRes = await app.inject({
            method: 'POST',
            url: '/api/problem.saveTags',
            headers: { cookie },
            payload: { problemId, tags: 'dp,graph,trees' },
        });
        (0, vitest_1.expect)(saveRes.statusCode).toBe(200);
        const getRes = await app.inject({
            method: 'GET', url: `/api/problem.viewTags?problemId=${problemId}`, headers: { cookie },
        });
        const tags = JSON.parse(getRes.body).result;
        (0, vitest_1.expect)(tags).toContain('dp');
        (0, vitest_1.expect)(tags).toContain('graph');
    });
    (0, vitest_1.it)('wrong owner cannot access problem', async () => {
        // Create second user
        const hash = bcryptjs_1.default.hashSync('pass2', 10);
        schema_1.db.prepare("INSERT INTO users (username, password_hash) VALUES ('user2', ?)").run(hash);
        const loginRes = await app.inject({
            method: 'POST', url: '/api/auth/login', payload: { username: 'user2', password: 'pass2' },
        });
        const cookie2 = loginRes.headers['set-cookie']?.split(';')[0] ?? '';
        const res = await app.inject({
            method: 'GET', url: `/api/problem.info?problemId=${problemId}`, headers: { cookie: cookie2 },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(404);
    });
    (0, vitest_1.it)('POST /api/problem.buildPackage', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/problem.buildPackage',
            headers: { cookie },
            payload: { problemId, type: 'standard' },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        const data = JSON.parse(res.body).result;
        (0, vitest_1.expect)(data.packageId).toBeGreaterThan(0);
        (0, vitest_1.expect)(data.state).toBe('PENDING');
    });
});
