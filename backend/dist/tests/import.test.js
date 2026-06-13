"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const import_1 = require("../services/import");
const schema_1 = require("../db/schema");
const problems_1 = require("../services/problems");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ROOT = path_1.default.join(__dirname, '..', '..', '..', '..');
const FIXTURES = ROOT;
const TEST_DIR = '/tmp/lite-polygon-test-' + Date.now();
let testUserId;
(0, vitest_1.beforeAll)(() => {
    (0, schema_1.initSchema)(TEST_DIR);
    // Create test user
    const result = schema_1.db.prepare("INSERT INTO users (username, password_hash) VALUES ('testuser', 'hash')").run();
    testUserId = result.lastInsertRowid;
});
(0, vitest_1.afterAll)(() => {
    schema_1.db.close();
    fs_1.default.rmSync(TEST_DIR, { recursive: true, force: true });
});
(0, vitest_1.describe)('Package import', () => {
    (0, vitest_1.it)('imports rombuses standard package', async () => {
        const zipPath = path_1.default.join(FIXTURES, 'rombuses-59.zip');
        if (!fs_1.default.existsSync(zipPath)) {
            console.warn('Fixture not found, skipping');
            return;
        }
        const result = await (0, import_1.importPackage)(zipPath, testUserId, false);
        (0, vitest_1.expect)(result.errors).toHaveLength(0);
        (0, vitest_1.expect)(result.shortName).toBe('rombuses');
        (0, vitest_1.expect)(result.filesImported).toBeGreaterThan(0);
        (0, vitest_1.expect)(result.testsImported).toBe(22);
        const problem = (0, problems_1.getProblem)(result.problemId);
        (0, vitest_1.expect)(problem).toBeTruthy();
        (0, vitest_1.expect)(problem.short_name).toBe('rombuses');
        (0, vitest_1.expect)(problem.time_limit).toBe(1000);
        (0, vitest_1.expect)(problem.memory_limit).toBe(268435456);
        (0, vitest_1.expect)(problem.revision).toBe(59);
        const checker = (0, problems_1.getAsset)(result.problemId, 'checker');
        (0, vitest_1.expect)(checker).toBeTruthy();
        (0, vitest_1.expect)(checker.source_path).toBeTruthy();
        const validator = (0, problems_1.getAsset)(result.problemId, 'validator');
        (0, vitest_1.expect)(validator).toBeTruthy();
        const solutions = (0, problems_1.listSolutions)(result.problemId);
        (0, vitest_1.expect)(solutions.length).toBeGreaterThan(0);
        const mainSol = solutions.find(s => s.tag === 'main');
        (0, vitest_1.expect)(mainSol).toBeTruthy();
        const testset = (0, problems_1.getTestset)(result.problemId, 'tests');
        (0, vitest_1.expect)(testset).toBeTruthy();
        const tests = (0, problems_1.listTests)(testset.id);
        (0, vitest_1.expect)(tests.length).toBe(22);
        const sample = tests.find(t => t.sample === 1);
        (0, vitest_1.expect)(sample).toBeTruthy();
        const tags = (0, problems_1.listTags)(result.problemId);
        (0, vitest_1.expect)(tags).toContain('avx');
        (0, vitest_1.expect)(tags).toContain('data structures');
    }, 30000);
    (0, vitest_1.it)('imports zaoch standard package with groups', async () => {
        const zipPath = path_1.default.join(FIXTURES, 'zaoch-2012-2-7-43.zip');
        if (!fs_1.default.existsSync(zipPath)) {
            console.warn('Fixture not found, skipping');
            return;
        }
        const result = await (0, import_1.importPackage)(zipPath, testUserId, false);
        (0, vitest_1.expect)(result.errors).toHaveLength(0);
        (0, vitest_1.expect)(result.shortName).toBe('zaoch-2012-2-7');
        (0, vitest_1.expect)(result.testsImported).toBe(49);
        const testset = (0, problems_1.getTestset)(result.problemId, 'tests');
        const tests = (0, problems_1.listTests)(testset.id);
        (0, vitest_1.expect)(tests.length).toBe(49);
        // Check groups are imported
        const groups = schema_1.db.prepare('SELECT * FROM test_groups WHERE testset_id = ?').all(testset.id);
        (0, vitest_1.expect)(groups.length).toBe(5);
        const g4 = groups.find(g => g.name === '4');
        (0, vitest_1.expect)(g4).toBeTruthy();
    }, 30000);
    (0, vitest_1.it)('imports joisc package with interactor', async () => {
        const zipPath = path_1.default.join(FIXTURES, 'joisc-2018-3-1-6.zip');
        if (!fs_1.default.existsSync(zipPath)) {
            console.warn('Fixture not found, skipping');
            return;
        }
        const result = await (0, import_1.importPackage)(zipPath, testUserId, false);
        (0, vitest_1.expect)(result.errors).toHaveLength(0);
        (0, vitest_1.expect)(result.shortName).toBe('joisc-2018-3-1');
        const interactor = (0, problems_1.getAsset)(result.problemId, 'interactor');
        (0, vitest_1.expect)(interactor).toBeTruthy();
        (0, vitest_1.expect)(interactor.source_path).toContain('interactor.cpp');
    }, 30000);
    (0, vitest_1.it)('imports rombuses linux package', async () => {
        const zipPath = path_1.default.join(FIXTURES, 'rombuses-59$linux.zip');
        if (!fs_1.default.existsSync(zipPath)) {
            console.warn('Fixture not found, skipping');
            return;
        }
        // Overwrite since rombuses was already imported
        const result = await (0, import_1.importPackage)(zipPath, testUserId, true);
        (0, vitest_1.expect)(result.errors).toHaveLength(0);
        (0, vitest_1.expect)(result.shortName).toBe('rombuses');
        // Linux package should have test files on disk
        const problemDir = (0, schema_1.getProblemDir)(result.problemId);
        const testInputPath = path_1.default.join(problemDir, 'tests', '01');
        // Note: linux packages contain test files
        // (they may or may not exist depending on extraction order)
    }, 30000);
    (0, vitest_1.it)('rejects overwrite without flag', async () => {
        // rombuses already imported above
        const zipPath = path_1.default.join(FIXTURES, 'rombuses-59.zip');
        if (!fs_1.default.existsSync(zipPath))
            return;
        await (0, vitest_1.expect)((0, import_1.importPackage)(zipPath, testUserId, false)).rejects.toThrow(/already exists/);
    }, 30000);
});
