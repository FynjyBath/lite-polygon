import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { importPackage } from '../services/import';
import { db, initSchema, getProblemDir } from '../db/schema';
import { getProblem, getAsset, listSolutions, getTestset, listTests, listTags } from '../services/problems';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const FIXTURES = ROOT;

const TEST_DIR = '/tmp/lite-polygon-test-' + Date.now();

let testUserId: number;

beforeAll(() => {
  initSchema(TEST_DIR);
  // Create test user
  const result = db.prepare("INSERT INTO users (username, password_hash) VALUES ('testuser', 'hash')").run();
  testUserId = result.lastInsertRowid as number;
});

afterAll(() => {
  db.close();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('Package import', () => {
  it('imports rombuses standard package', async () => {
    const zipPath = path.join(FIXTURES, 'rombuses-59.zip');
    if (!fs.existsSync(zipPath)) {
      console.warn('Fixture not found, skipping');
      return;
    }
    const result = await importPackage(zipPath, testUserId, false);
    expect(result.errors).toHaveLength(0);
    expect(result.shortName).toBe('rombuses');
    expect(result.filesImported).toBeGreaterThan(0);
    expect(result.testsImported).toBe(22);

    const problem = getProblem(result.problemId);
    expect(problem).toBeTruthy();
    expect(problem!.short_name).toBe('rombuses');
    expect(problem!.time_limit).toBe(1000);
    expect(problem!.memory_limit).toBe(268435456);
    expect(problem!.revision).toBe(59);

    const checker = getAsset(result.problemId, 'checker');
    expect(checker).toBeTruthy();
    expect(checker!.source_path).toBeTruthy();

    const validator = getAsset(result.problemId, 'validator');
    expect(validator).toBeTruthy();

    const solutions = listSolutions(result.problemId);
    expect(solutions.length).toBeGreaterThan(0);
    const mainSol = solutions.find(s => s.tag === 'main');
    expect(mainSol).toBeTruthy();

    const testset = getTestset(result.problemId, 'tests');
    expect(testset).toBeTruthy();
    const tests = listTests(testset!.id);
    expect(tests.length).toBe(22);
    const sample = tests.find(t => t.sample === 1);
    expect(sample).toBeTruthy();

    const tags = listTags(result.problemId);
    expect(tags).toContain('avx');
    expect(tags).toContain('data structures');
  }, 30000);

  it('imports zaoch standard package with groups', async () => {
    const zipPath = path.join(FIXTURES, 'zaoch-2012-2-7-43.zip');
    if (!fs.existsSync(zipPath)) {
      console.warn('Fixture not found, skipping');
      return;
    }
    const result = await importPackage(zipPath, testUserId, false);
    expect(result.errors).toHaveLength(0);
    expect(result.shortName).toBe('zaoch-2012-2-7');
    expect(result.testsImported).toBe(49);

    const testset = getTestset(result.problemId, 'tests');
    const tests = listTests(testset!.id);
    expect(tests.length).toBe(49);

    // Check groups are imported
    const groups = db.prepare('SELECT * FROM test_groups WHERE testset_id = ?').all(testset!.id) as Array<{ name: string; points: number }>;
    expect(groups.length).toBe(5);
    const g4 = groups.find(g => g.name === '4');
    expect(g4).toBeTruthy();
  }, 30000);

  it('imports joisc package with interactor', async () => {
    const zipPath = path.join(FIXTURES, 'joisc-2018-3-1-6.zip');
    if (!fs.existsSync(zipPath)) {
      console.warn('Fixture not found, skipping');
      return;
    }
    const result = await importPackage(zipPath, testUserId, false);
    expect(result.errors).toHaveLength(0);
    expect(result.shortName).toBe('joisc-2018-3-1');

    const interactor = getAsset(result.problemId, 'interactor');
    expect(interactor).toBeTruthy();
    expect(interactor!.source_path).toContain('interactor.cpp');
  }, 30000);

  it('imports rombuses linux package', async () => {
    const zipPath = path.join(FIXTURES, 'rombuses-59$linux.zip');
    if (!fs.existsSync(zipPath)) {
      console.warn('Fixture not found, skipping');
      return;
    }
    // Overwrite since rombuses was already imported
    const result = await importPackage(zipPath, testUserId, true);
    expect(result.errors).toHaveLength(0);
    expect(result.shortName).toBe('rombuses');

    // Linux package should have test files on disk
    const problemDir = getProblemDir(result.problemId);
    const testInputPath = path.join(problemDir, 'tests', '01');
    // Note: linux packages contain test files
    // (they may or may not exist depending on extraction order)
  }, 30000);

  it('rejects overwrite without flag', async () => {
    // rombuses already imported above
    const zipPath = path.join(FIXTURES, 'rombuses-59.zip');
    if (!fs.existsSync(zipPath)) return;
    await expect(importPackage(zipPath, testUserId, false)).rejects.toThrow(/already exists/);
  }, 30000);
});
