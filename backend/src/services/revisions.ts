import fs from 'fs';
import path from 'path';
import { db, getProblemDir, getRevisionsDir } from '../db/schema';
import { getProblem, updateProblem } from './problems';

// Tables keyed directly by problem_id (no nested children to remap).
const PROBLEM_TABLES = [
  'problem_names', 'statements', 'problem_files', 'executables', 'assets',
  'interactor_runs', 'solutions', 'checker_tests', 'validator_tests',
  'problem_properties', 'problem_tags', 'stresses',
];

const PROBLEM_FIELDS = [
  'time_limit', 'memory_limit', 'input_file', 'output_file', 'interactive',
  'run_count', 'cpu_name', 'cpu_speed', 'general_description', 'general_tutorial',
];

type Row = Record<string, unknown>;
interface Snapshot {
  problem: Row;
  tables: Record<string, Row[]>;
  testsets: (Row & { tests: Row[]; groups: (Row & { dependencies: string[] })[] })[];
}

export interface RevisionInfo { id: number; revision: number; comment: string; created_at: string; }

function insertRow(table: string, row: Row, exclude: string[], overrides: Row): number | bigint {
  const cols = Object.keys(row).filter(c => c !== 'id' && !exclude.includes(c));
  for (const k of Object.keys(overrides)) if (!cols.includes(k)) cols.push(k);
  const vals = cols.map(c => (c in overrides ? overrides[c] : row[c]));
  const r = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals);
  return r.lastInsertRowid;
}

/** Serialize all of a problem's editable DB state into a plain object. */
export function snapshotProblemData(problemId: number): Snapshot {
  const p = db.prepare('SELECT * FROM problems WHERE id = ?').get(problemId) as Row | undefined;
  if (!p) throw new Error('Problem not found');
  const problem: Row = {};
  for (const f of PROBLEM_FIELDS) problem[f] = p[f];

  const tables: Record<string, Row[]> = {};
  for (const t of PROBLEM_TABLES) tables[t] = db.prepare(`SELECT * FROM ${t} WHERE problem_id = ?`).all(problemId) as Row[];

  const testsets = (db.prepare('SELECT * FROM testsets WHERE problem_id = ?').all(problemId) as Row[]).map(ts => {
    const tests = db.prepare('SELECT * FROM tests WHERE testset_id = ?').all(ts.id) as Row[];
    const groups = (db.prepare('SELECT * FROM test_groups WHERE testset_id = ?').all(ts.id) as Row[]).map(g => ({
      ...g,
      dependencies: (db.prepare('SELECT depends_on FROM group_dependencies WHERE group_id = ?').all(g.id) as { depends_on: string }[]).map(r => r.depends_on),
    }));
    return { ...ts, tests, groups };
  });

  return { problem, tables, testsets };
}

function clearProblemData(problemId: number): void {
  const testsets = db.prepare('SELECT id FROM testsets WHERE problem_id = ?').all(problemId) as { id: number }[];
  for (const ts of testsets) {
    const groups = db.prepare('SELECT id FROM test_groups WHERE testset_id = ?').all(ts.id) as { id: number }[];
    for (const g of groups) db.prepare('DELETE FROM group_dependencies WHERE group_id = ?').run(g.id);
    db.prepare('DELETE FROM tests WHERE testset_id = ?').run(ts.id);
    db.prepare('DELETE FROM test_groups WHERE testset_id = ?').run(ts.id);
  }
  db.prepare('DELETE FROM testsets WHERE problem_id = ?').run(problemId);
  for (const t of PROBLEM_TABLES) db.prepare(`DELETE FROM ${t} WHERE problem_id = ?`).run(problemId);
}

/** Replace a problem's DB state with the given snapshot (same problem id). */
export function restoreProblemData(problemId: number, data: Snapshot): void {
  db.transaction(() => {
    updateProblem(problemId, data.problem);
    clearProblemData(problemId);
    for (const [t, rows] of Object.entries(data.tables)) {
      for (const row of rows) insertRow(t, row, [], { problem_id: problemId });
    }
    for (const ts of data.testsets) {
      const newTsId = insertRow('testsets', ts, ['tests', 'groups'], { problem_id: problemId });
      for (const test of ts.tests) insertRow('tests', test, [], { testset_id: newTsId });
      for (const g of ts.groups) {
        const newGid = insertRow('test_groups', g, ['dependencies'], { testset_id: newTsId });
        for (const dep of g.dependencies ?? []) {
          db.prepare('INSERT INTO group_dependencies (group_id, depends_on) VALUES (?, ?)').run(newGid, dep);
        }
      }
    }
    // Compiled binaries are absolute paths into the old workdir — drop them.
    db.prepare("UPDATE solutions SET compiled_binary = '' WHERE problem_id = ?").run(problemId);
    db.prepare("UPDATE assets SET compiled_binary = '' WHERE problem_id = ?").run(problemId);
  })();
}

// Copy a directory tree, excluding the volatile workdir.
function copyTree(src: string, dest: string): void {
  fs.cpSync(src, dest, { recursive: true, filter: (s) => path.basename(s) !== 'workdir' });
}

/**
 * Commit the current working copy as a new revision: snapshot the DB state and
 * the files to the revisions store, bump the problem's revision and clear the
 * modified flag. Returns the new revision number.
 */
export function commitRevision(problemId: number, comment: string): number {
  const p = getProblem(problemId);
  if (!p) throw new Error('Problem not found');
  // Next revision = max existing + 1 (robust even if the field drifted).
  const maxRev = (db.prepare('SELECT MAX(revision) m FROM problem_revisions WHERE problem_id = ?').get(problemId) as { m: number | null }).m;
  const newRev = Math.max(maxRev ?? 0, p.revision ?? 0) + 1;

  const revDir = path.join(getRevisionsDir(problemId), String(newRev));
  fs.rmSync(revDir, { recursive: true, force: true });
  fs.mkdirSync(revDir, { recursive: true });
  fs.writeFileSync(path.join(revDir, 'data.json'), JSON.stringify(snapshotProblemData(problemId)));
  const problemDir = getProblemDir(problemId);
  if (fs.existsSync(problemDir)) copyTree(problemDir, path.join(revDir, 'files'));

  db.prepare('INSERT INTO problem_revisions (problem_id, revision, comment) VALUES (?, ?, ?)').run(problemId, newRev, comment || '');
  updateProblem(problemId, { revision: newRev, modified: 0 });
  return newRev;
}

export function listRevisions(problemId: number): RevisionInfo[] {
  return db.prepare('SELECT id, revision, comment, created_at FROM problem_revisions WHERE problem_id = ? ORDER BY revision DESC')
    .all(problemId) as RevisionInfo[];
}

/**
 * Restore the working copy to a committed revision's content (DB + files). The
 * working copy is marked modified so the user explicitly commits it as a new
 * revision afterwards.
 */
export function restoreRevision(problemId: number, revision: number): void {
  const revDir = path.join(getRevisionsDir(problemId), String(revision));
  const dataPath = path.join(revDir, 'data.json');
  if (!fs.existsSync(dataPath)) throw new Error(`Revision ${revision} has no stored snapshot`);
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8')) as Snapshot;

  restoreProblemData(problemId, data);

  const problemDir = getProblemDir(problemId);
  fs.mkdirSync(problemDir, { recursive: true });
  // Clear the working files (keep workdir so we don't fight running jobs), then
  // lay down the revision's files.
  for (const e of fs.readdirSync(problemDir)) {
    if (e === 'workdir') continue;
    fs.rmSync(path.join(problemDir, e), { recursive: true, force: true });
  }
  const filesDir = path.join(revDir, 'files');
  if (fs.existsSync(filesDir)) {
    for (const e of fs.readdirSync(filesDir)) {
      fs.cpSync(path.join(filesDir, e), path.join(problemDir, e), { recursive: true });
    }
  }
  // Stale compiled binaries must not be reused after a rollback.
  fs.rmSync(path.join(problemDir, 'workdir'), { recursive: true, force: true });
  fs.mkdirSync(path.join(problemDir, 'workdir'), { recursive: true });

  updateProblem(problemId, { modified: 1 });
}
