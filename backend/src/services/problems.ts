import { db, getProblemDir } from '../db/schema';
import fs from 'fs';
import path from 'path';

export interface Problem {
  id: number;
  owner_id: number;
  short_name: string;
  revision: number;
  time_limit: number;
  memory_limit: number;
  input_file: string;
  output_file: string;
  interactive: number;
  run_count: number;
  cpu_name: string;
  cpu_speed: string;
  polygon_url: string;
  modified: number;
  general_description: string;
  general_tutorial: string;
  created_at: string;
  updated_at: string;
}

export interface Testset {
  id: number;
  problem_id: number;
  name: string;
  time_limit: number | null;
  memory_limit: number | null;
  input_path_pattern: string;
  answer_path_pattern: string;
  groups_enabled: number;
  points_enabled: number;
  treat_points_from_checker_as_percent: number;
}

export interface Test {
  id: number;
  testset_id: number;
  idx: number;
  method: string;
  cmd: string;
  description: string;
  sample: number;
  group_name: string;
  points: number;
  extra_attrs: string;
}

export interface Solution {
  id: number;
  problem_id: number;
  source_path: string;
  source_type: string;
  binary_path: string;
  binary_type: string;
  tag: string;
  compiled_binary: string;
}

export interface Asset {
  id: number;
  problem_id: number;
  asset_type: string;
  name: string;
  checker_type: string;
  source_path: string;
  source_type: string;
  binary_path: string;
  binary_type: string;
  copy_path: string;
  copy_type: string;
  compiled_binary: string;
}

export function listProblems(ownerId: number): Problem[] {
  return db.prepare('SELECT * FROM problems WHERE owner_id = ? ORDER BY updated_at DESC').all(ownerId) as Problem[];
}

export function listAllProblems(): (Problem & { owner_username: string })[] {
  return db.prepare(
    'SELECT p.*, u.username AS owner_username FROM problems p JOIN users u ON u.id = p.owner_id ORDER BY p.updated_at DESC'
  ).all() as (Problem & { owner_username: string })[];
}

export function getProblem(id: number, ownerId?: number): Problem | undefined {
  if (ownerId !== undefined) {
    return db.prepare('SELECT * FROM problems WHERE id = ? AND owner_id = ?').get(id, ownerId) as Problem | undefined;
  }
  return db.prepare('SELECT * FROM problems WHERE id = ?').get(id) as Problem | undefined;
}

export function getProblemByName(shortName: string, ownerId: number): Problem | undefined {
  return db.prepare('SELECT * FROM problems WHERE short_name = ? AND owner_id = ?').get(shortName, ownerId) as Problem | undefined;
}

export function createProblem(ownerId: number, shortName: string): Problem {
  const result = db.prepare(
    'INSERT INTO problems (owner_id, short_name, modified) VALUES (?, ?, 1)'
  ).run(ownerId, shortName);
  const problem = getProblem(result.lastInsertRowid as number)!;

  // Create default testset
  db.prepare(
    'INSERT INTO testsets (problem_id, name) VALUES (?, ?)'
  ).run(problem.id, 'tests');

  // Create problem directory
  const dir = getProblemDir(problem.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'solutions'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'statements'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'statement-sections'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'workdir'), { recursive: true });

  return problem;
}

export function updateProblem(id: number, updates: Partial<Problem>): void {
  const allowed = [
    'short_name', 'revision', 'time_limit', 'memory_limit', 'input_file',
    'output_file', 'interactive', 'run_count', 'cpu_name', 'cpu_speed',
    'polygon_url', 'modified', 'general_description', 'general_tutorial',
  ];
  const sets: string[] = ["updated_at = datetime('now')"];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(updates)) {
    if (allowed.includes(k)) {
      sets.push(`${k} = ?`);
      vals.push(v);
    }
  }
  if (sets.length > 1) {
    vals.push(id);
    db.prepare(`UPDATE problems SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
}

export function deleteProblem(id: number): void {
  db.prepare('DELETE FROM problems WHERE id = ?').run(id);
}

export function getTestset(problemId: number, name = 'tests'): Testset | undefined {
  return db.prepare('SELECT * FROM testsets WHERE problem_id = ? AND name = ?').get(problemId, name) as Testset | undefined;
}

export function getOrCreateTestset(problemId: number, name: string): Testset {
  let ts = getTestset(problemId, name);
  if (!ts) {
    db.prepare('INSERT INTO testsets (problem_id, name) VALUES (?, ?)').run(problemId, name);
    ts = getTestset(problemId, name)!;
  }
  return ts;
}

export function listTests(testsetId: number): Test[] {
  return db.prepare('SELECT * FROM tests WHERE testset_id = ? ORDER BY idx').all(testsetId) as Test[];
}

export function getTest(testsetId: number, idx: number): Test | undefined {
  return db.prepare('SELECT * FROM tests WHERE testset_id = ? AND idx = ?').get(testsetId, idx) as Test | undefined;
}

export function upsertTest(testsetId: number, idx: number, data: Partial<Test>): void {
  const existing = getTest(testsetId, idx);
  if (existing) {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (['method', 'cmd', 'description', 'sample', 'group_name', 'points', 'extra_attrs'].includes(k)) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }
    if (sets.length) {
      vals.push(testsetId, idx);
      db.prepare(`UPDATE tests SET ${sets.join(', ')} WHERE testset_id = ? AND idx = ?`).run(...vals);
    }
  } else {
    db.prepare(
      'INSERT INTO tests (testset_id, idx, method, cmd, description, sample, group_name, points, extra_attrs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      testsetId, idx,
      data.method ?? 'manual',
      data.cmd ?? '',
      data.description ?? '',
      data.sample ?? 0,
      data.group_name ?? '',
      data.points ?? 0,
      data.extra_attrs ?? '{}'
    );
  }
}

export function deleteTest(testsetId: number, idx: number): void {
  db.prepare('DELETE FROM tests WHERE testset_id = ? AND idx = ?').run(testsetId, idx);
  // Shift subsequent tests down
  db.prepare('UPDATE tests SET idx = idx - 1 WHERE testset_id = ? AND idx > ?').run(testsetId, idx);
}

export function listSolutions(problemId: number): Solution[] {
  return db.prepare('SELECT * FROM solutions WHERE problem_id = ? ORDER BY id').all(problemId) as Solution[];
}

export function getSolution(id: number): Solution | undefined {
  return db.prepare('SELECT * FROM solutions WHERE id = ?').get(id) as Solution | undefined;
}

export function getSolutionByPath(problemId: number, sourcePath: string): Solution | undefined {
  return db.prepare('SELECT * FROM solutions WHERE problem_id = ? AND source_path = ?').get(problemId, sourcePath) as Solution | undefined;
}

export function upsertSolution(problemId: number, sourcePath: string, data: Partial<Solution>): number {
  const existing = getSolutionByPath(problemId, sourcePath);
  if (existing) {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (['source_type', 'binary_path', 'binary_type', 'tag', 'compiled_binary'].includes(k)) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }
    if (sets.length) {
      vals.push(existing.id);
      db.prepare(`UPDATE solutions SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }
    return existing.id;
  } else {
    const result = db.prepare(
      'INSERT INTO solutions (problem_id, source_path, source_type, binary_path, binary_type, tag, compiled_binary) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      problemId, sourcePath,
      data.source_type ?? '',
      data.binary_path ?? '',
      data.binary_type ?? '',
      data.tag ?? 'accepted',
      data.compiled_binary ?? ''
    );
    return result.lastInsertRowid as number;
  }
}

export function deleteSolution(id: number): void {
  db.prepare('DELETE FROM solutions WHERE id = ?').run(id);
}

export function getAsset(problemId: number, assetType: string): Asset | undefined {
  return db.prepare('SELECT * FROM assets WHERE problem_id = ? AND asset_type = ?').get(problemId, assetType) as Asset | undefined;
}

export function upsertAsset(problemId: number, assetType: string, data: Partial<Asset>): void {
  const existing = getAsset(problemId, assetType);
  if (existing) {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (['name', 'checker_type', 'source_path', 'source_type', 'binary_path', 'binary_type', 'copy_path', 'copy_type', 'compiled_binary'].includes(k)) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }
    if (sets.length) {
      vals.push(problemId, assetType);
      db.prepare(`UPDATE assets SET ${sets.join(', ')} WHERE problem_id = ? AND asset_type = ?`).run(...vals);
    }
  } else {
    db.prepare(
      'INSERT INTO assets (problem_id, asset_type, name, checker_type, source_path, source_type, binary_path, binary_type, copy_path, copy_type, compiled_binary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      problemId, assetType,
      data.name ?? '',
      data.checker_type ?? 'testlib',
      data.source_path ?? '',
      data.source_type ?? '',
      data.binary_path ?? '',
      data.binary_type ?? '',
      data.copy_path ?? '',
      data.copy_type ?? '',
      data.compiled_binary ?? ''
    );
  }
}

export function listTags(problemId: number): string[] {
  const rows = db.prepare('SELECT value FROM problem_tags WHERE problem_id = ? ORDER BY value').all(problemId) as { value: string }[];
  return rows.map(r => r.value);
}

export function setTags(problemId: number, tags: string[]): void {
  db.prepare('DELETE FROM problem_tags WHERE problem_id = ?').run(problemId);
  const stmt = db.prepare('INSERT OR IGNORE INTO problem_tags (problem_id, value) VALUES (?, ?)');
  for (const t of tags) stmt.run(problemId, t);
}

export function getProblemNames(problemId: number): { language: string; value: string }[] {
  return db.prepare('SELECT language, value FROM problem_names WHERE problem_id = ? ORDER BY language').all(problemId) as { language: string; value: string }[];
}

export function upsertProblemName(problemId: number, language: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO problem_names (problem_id, language, value) VALUES (?, ?, ?)').run(problemId, language, value);
}

export function getStatement(problemId: number, language: string) {
  return db.prepare('SELECT * FROM statements WHERE problem_id = ? AND language = ?').get(problemId, language);
}

export function listStatements(problemId: number) {
  return db.prepare('SELECT * FROM statements WHERE problem_id = ? ORDER BY language').all(problemId);
}

export function upsertStatement(problemId: number, language: string, data: Record<string, unknown>): void {
  const existing = getStatement(problemId, language);
  if (existing) {
    const allowed = ['name', 'legend', 'input_section', 'output_section', 'scoring', 'interaction', 'notes', 'tutorial', 'charset', 'mathjax'];
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (allowed.includes(k)) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }
    if (sets.length) {
      vals.push(problemId, language);
      db.prepare(`UPDATE statements SET ${sets.join(', ')} WHERE problem_id = ? AND language = ?`).run(...vals);
    }
  } else {
    db.prepare(
      'INSERT INTO statements (problem_id, language, name, legend, input_section, output_section, scoring, interaction, notes, tutorial, charset, mathjax) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      problemId, language,
      data.name ?? '',
      data.legend ?? '',
      data.input_section ?? '',
      data.output_section ?? '',
      data.scoring ?? '',
      data.interaction ?? '',
      data.notes ?? '',
      data.tutorial ?? '',
      data.charset ?? 'UTF-8',
      data.mathjax ?? 1
    );
  }
}

export function getTestGroups(testsetId: number) {
  return db.prepare('SELECT * FROM test_groups WHERE testset_id = ? ORDER BY name').all(testsetId) as Array<{
    id: number; testset_id: number; name: string; points: number; points_policy: string; feedback_policy: string; extra_attrs: string;
  }>;
}

export function getGroupDependencies(groupId: number): string[] {
  const rows = db.prepare('SELECT depends_on FROM group_dependencies WHERE group_id = ?').all(groupId) as { depends_on: string }[];
  return rows.map(r => r.depends_on);
}

export function upsertTestGroup(testsetId: number, name: string, data: { points?: number; pointsPolicy?: string; feedbackPolicy?: string; dependencies?: string[] }): void {
  const existing = db.prepare('SELECT * FROM test_groups WHERE testset_id = ? AND name = ?').get(testsetId, name) as { id: number } | undefined;
  let groupId: number;
  if (existing) {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (data.points !== undefined) { sets.push('points = ?'); vals.push(data.points); }
    if (data.pointsPolicy) { sets.push('points_policy = ?'); vals.push(data.pointsPolicy); }
    if (data.feedbackPolicy) { sets.push('feedback_policy = ?'); vals.push(data.feedbackPolicy); }
    if (sets.length) {
      vals.push(existing.id);
      db.prepare(`UPDATE test_groups SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }
    groupId = existing.id;
  } else {
    const result = db.prepare(
      'INSERT INTO test_groups (testset_id, name, points, points_policy, feedback_policy) VALUES (?, ?, ?, ?, ?)'
    ).run(testsetId, name, data.points ?? 0, data.pointsPolicy ?? 'each-test', data.feedbackPolicy ?? 'complete');
    groupId = result.lastInsertRowid as number;
  }
  if (data.dependencies !== undefined) {
    db.prepare('DELETE FROM group_dependencies WHERE group_id = ?').run(groupId);
    for (const dep of data.dependencies) {
      db.prepare('INSERT INTO group_dependencies (group_id, depends_on) VALUES (?, ?)').run(groupId, dep);
    }
  }
}

export function listCheckerTests(problemId: number) {
  return db.prepare('SELECT * FROM checker_tests WHERE problem_id = ? ORDER BY idx').all(problemId) as Array<{
    id: number; problem_id: number; idx: number; input: string; output_data: string; answer: string;
    expected_verdict: string; run_verdict: string; run_comment: string;
  }>;
}

export function upsertCheckerTest(problemId: number, idx: number, data: Record<string, unknown>): void {
  const existing = db.prepare('SELECT id FROM checker_tests WHERE problem_id = ? AND idx = ?').get(problemId, idx);
  if (existing) {
    const allowed = ['input', 'output_data', 'answer', 'expected_verdict', 'run_verdict', 'run_comment'];
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (allowed.includes(k)) { sets.push(`${k} = ?`); vals.push(v); }
    }
    if (sets.length) {
      vals.push(problemId, idx);
      db.prepare(`UPDATE checker_tests SET ${sets.join(', ')} WHERE problem_id = ? AND idx = ?`).run(...vals);
    }
  } else {
    db.prepare(
      'INSERT INTO checker_tests (problem_id, idx, input, output_data, answer, expected_verdict, run_verdict, run_comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(problemId, idx, data.input ?? '', data.output_data ?? '', data.answer ?? '', data.expected_verdict ?? 'OK', data.run_verdict ?? '', data.run_comment ?? '');
  }
}

export function listValidatorTests(problemId: number, validatorIdx = 0) {
  return db.prepare('SELECT * FROM validator_tests WHERE problem_id = ? AND validator_idx = ? ORDER BY idx').all(problemId, validatorIdx) as Array<{
    id: number; problem_id: number; validator_idx: number; idx: number; input: string;
    expected_verdict: string; testset_name: string; group_name: string; run_verdict: string; run_comment: string;
  }>;
}

export function upsertValidatorTest(problemId: number, validatorIdx: number, idx: number, data: Record<string, unknown>): void {
  const existing = db.prepare('SELECT id FROM validator_tests WHERE problem_id = ? AND validator_idx = ? AND idx = ?').get(problemId, validatorIdx, idx);
  if (existing) {
    const allowed = ['input', 'expected_verdict', 'testset_name', 'group_name', 'run_verdict', 'run_comment'];
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (allowed.includes(k)) { sets.push(`${k} = ?`); vals.push(v); }
    }
    if (sets.length) {
      vals.push(problemId, validatorIdx, idx);
      db.prepare(`UPDATE validator_tests SET ${sets.join(', ')} WHERE problem_id = ? AND validator_idx = ? AND idx = ?`).run(...vals);
    }
  } else {
    db.prepare(
      'INSERT INTO validator_tests (problem_id, validator_idx, idx, input, expected_verdict, testset_name, group_name, run_verdict, run_comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(problemId, validatorIdx, idx, data.input ?? '', data.expected_verdict ?? 'VALID', data.testset_name ?? '', data.group_name ?? '', data.run_verdict ?? '', data.run_comment ?? '');
  }
}

export function getProperty(problemId: number, name: string): string | undefined {
  const row = db.prepare('SELECT value FROM problem_properties WHERE problem_id = ? AND name = ?').get(problemId, name) as { value: string } | undefined;
  return row?.value;
}

export function setProperty(problemId: number, name: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO problem_properties (problem_id, name, value) VALUES (?, ?, ?)').run(problemId, name, value);
}

export function listProperties(problemId: number): { name: string; value: string }[] {
  return db.prepare('SELECT name, value FROM problem_properties WHERE problem_id = ?').all(problemId) as { name: string; value: string }[];
}

export function listFiles(problemId: number): Array<{
  id: number; problem_id: number; file_role: string; path: string; source_type: string;
  for_types: string; stages: string; assets_attr: string; is_main: number; extra_attrs: string;
}> {
  return db.prepare('SELECT * FROM problem_files WHERE problem_id = ? ORDER BY path').all(problemId) as never[];
}

export function upsertFile(problemId: number, filePath: string, data: Record<string, unknown>): void {
  const existing = db.prepare('SELECT id FROM problem_files WHERE problem_id = ? AND path = ?').get(problemId, filePath);
  if (existing) {
    const allowed = ['file_role', 'source_type', 'for_types', 'stages', 'assets_attr', 'is_main', 'extra_attrs'];
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (allowed.includes(k)) { sets.push(`${k} = ?`); vals.push(v); }
    }
    if (sets.length) {
      vals.push(problemId, filePath);
      db.prepare(`UPDATE problem_files SET ${sets.join(', ')} WHERE problem_id = ? AND path = ?`).run(...vals);
    }
  } else {
    db.prepare(
      'INSERT INTO problem_files (problem_id, file_role, path, source_type, for_types, stages, assets_attr, is_main, extra_attrs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      problemId,
      data.file_role ?? 'resource',
      filePath,
      data.source_type ?? '',
      data.for_types ?? '',
      data.stages ?? '',
      data.assets_attr ?? '',
      data.is_main ?? 0,
      data.extra_attrs ?? '{}'
    );
  }
}

export function listExecutables(problemId: number) {
  return db.prepare('SELECT * FROM executables WHERE problem_id = ? ORDER BY id').all(problemId) as Array<{
    id: number; problem_id: number; source_path: string; source_type: string; binary_path: string; binary_type: string;
  }>;
}

export function getCautions(problemId: number): string[] {
  const warnings: string[] = [];
  const problem = getProblem(problemId);
  if (!problem) return warnings;

  const checker = getAsset(problemId, 'checker');
  if (!checker || !checker.source_path) warnings.push('No checker set');

  const validators = db.prepare('SELECT * FROM assets WHERE problem_id = ? AND asset_type = ?').all(problemId, 'validator') as Asset[];
  if (validators.length === 0) warnings.push('No validator set');

  const solutions = listSolutions(problemId);
  const hasMain = solutions.some(s => s.tag === 'main');
  if (!hasMain) warnings.push('No main solution set');

  const testset = getTestset(problemId, 'tests');
  if (testset) {
    const tests = listTests(testset.id);
    if (tests.length === 0) warnings.push('No tests');
    const hasSample = tests.some(t => t.sample === 1);
    if (tests.length > 0 && !hasSample) warnings.push('No sample tests');
  }

  const stmts = listStatements(problemId);
  if (stmts.length === 0) warnings.push('No statements');
  for (const s of stmts as Array<{ language: string; name: string; legend: string }>) {
    if (!s.name) warnings.push(`Statement (${s.language}): missing name`);
    if (!s.legend) warnings.push(`Statement (${s.language}): missing legend`);
  }

  const packages = db.prepare('SELECT * FROM packages WHERE problem_id = ? ORDER BY created_at DESC LIMIT 1').get(problemId) as { revision: number; state: string } | undefined;
  if (!packages || packages.revision < problem.revision || packages.state !== 'READY') {
    warnings.push('No ready package for current revision');
  }

  if (problem.modified) warnings.push('Working copy has uncommitted changes');

  return warnings;
}
