import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let _real: Database.Database | null = null;
let _dir: string = '';

// Proxy so destructured `import { db }` always delegates to the current real DB
export const db = new Proxy({} as Database.Database, {
  get(_, prop: string | symbol) {
    if (!_real) throw new Error('Call initSchema() before using db');
    const val = ((_real as unknown) as Record<string | symbol, unknown>)[prop];
    return typeof val === 'function' ? (val as Function).bind(_real) : val;
  },
});

export function initSchema(dataDir?: string): void {
  _dir = dataDir || process.env.DATA_DIR || path.join(process.cwd(), '..', 'data');

  fs.mkdirSync(_dir, { recursive: true });
  fs.mkdirSync(path.join(_dir, 'problems'), { recursive: true });
  fs.mkdirSync(path.join(_dir, 'packages'), { recursive: true });

  if (_real) { try { _real.close(); } catch { /* ignore */ } }
  _real = new Database(path.join(_dir, 'db.sqlite3'));
  _real.pragma('journal_mode = WAL');
  _real.pragma('foreign_keys = ON');

  _real.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      api_key TEXT UNIQUE,
      api_secret_hash TEXT,
      must_change_password INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS problems (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      short_name TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      time_limit INTEGER NOT NULL DEFAULT 1000,
      memory_limit INTEGER NOT NULL DEFAULT 268435456,
      input_file TEXT NOT NULL DEFAULT '',
      output_file TEXT NOT NULL DEFAULT '',
      interactive INTEGER NOT NULL DEFAULT 0,
      run_count INTEGER NOT NULL DEFAULT 1,
      cpu_name TEXT NOT NULL DEFAULT '',
      cpu_speed TEXT NOT NULL DEFAULT '',
      polygon_url TEXT NOT NULL DEFAULT '',
      modified INTEGER NOT NULL DEFAULT 0,
      general_description TEXT NOT NULL DEFAULT '',
      general_tutorial TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(owner_id, short_name)
    );

    CREATE TABLE IF NOT EXISTS problem_names (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
      language TEXT NOT NULL,
      value TEXT NOT NULL,
      UNIQUE(problem_id, language)
    );

    CREATE TABLE IF NOT EXISTS statements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
      language TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      legend TEXT NOT NULL DEFAULT '',
      input_section TEXT NOT NULL DEFAULT '',
      output_section TEXT NOT NULL DEFAULT '',
      scoring TEXT NOT NULL DEFAULT '',
      interaction TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      tutorial TEXT NOT NULL DEFAULT '',
      charset TEXT NOT NULL DEFAULT 'UTF-8',
      mathjax INTEGER NOT NULL DEFAULT 1,
      UNIQUE(problem_id, language)
    );

    CREATE TABLE IF NOT EXISTS testsets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'tests',
      time_limit INTEGER,
      memory_limit INTEGER,
      input_path_pattern TEXT NOT NULL DEFAULT 'tests/%02d',
      answer_path_pattern TEXT NOT NULL DEFAULT 'tests/%02d.a',
      groups_enabled INTEGER NOT NULL DEFAULT 0,
      points_enabled INTEGER NOT NULL DEFAULT 0,
      treat_points_from_checker_as_percent INTEGER NOT NULL DEFAULT 0,
      UNIQUE(problem_id, name)
    );

    CREATE TABLE IF NOT EXISTS tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      testset_id INTEGER NOT NULL REFERENCES testsets(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      method TEXT NOT NULL DEFAULT 'manual',
      cmd TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      sample INTEGER NOT NULL DEFAULT 0,
      group_name TEXT NOT NULL DEFAULT '',
      points REAL NOT NULL DEFAULT 0,
      extra_attrs TEXT NOT NULL DEFAULT '{}',
      UNIQUE(testset_id, idx)
    );

    CREATE TABLE IF NOT EXISTS test_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      testset_id INTEGER NOT NULL REFERENCES testsets(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      points REAL NOT NULL DEFAULT 0,
      points_policy TEXT NOT NULL DEFAULT 'each-test',
      feedback_policy TEXT NOT NULL DEFAULT 'complete',
      extra_attrs TEXT NOT NULL DEFAULT '{}',
      UNIQUE(testset_id, name)
    );

    CREATE TABLE IF NOT EXISTS group_dependencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES test_groups(id) ON DELETE CASCADE,
      depends_on TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS problem_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
      file_role TEXT NOT NULL DEFAULT 'resource',
      path TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT '',
      for_types TEXT NOT NULL DEFAULT '',
      stages TEXT NOT NULL DEFAULT '',
      assets_attr TEXT NOT NULL DEFAULT '',
      is_main INTEGER NOT NULL DEFAULT 0,
      extra_attrs TEXT NOT NULL DEFAULT '{}',
      UNIQUE(problem_id, path)
    );

    CREATE TABLE IF NOT EXISTS executables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
      source_path TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL DEFAULT '',
      binary_path TEXT NOT NULL DEFAULT '',
      binary_type TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
      asset_type TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      checker_type TEXT NOT NULL DEFAULT 'testlib',
      source_path TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL DEFAULT '',
      binary_path TEXT NOT NULL DEFAULT '',
      binary_type TEXT NOT NULL DEFAULT '',
      copy_path TEXT NOT NULL DEFAULT '',
      copy_type TEXT NOT NULL DEFAULT '',
      compiled_binary TEXT NOT NULL DEFAULT '',
      UNIQUE(problem_id, asset_type)
    );

    CREATE TABLE IF NOT EXISTS interactor_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
      run_index INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS solutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
      source_path TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT '',
      binary_path TEXT NOT NULL DEFAULT '',
      binary_type TEXT NOT NULL DEFAULT '',
      tag TEXT NOT NULL DEFAULT 'accepted',
      compiled_binary TEXT NOT NULL DEFAULT '',
      UNIQUE(problem_id, source_path)
    );

    CREATE TABLE IF NOT EXISTS checker_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      input TEXT NOT NULL DEFAULT '',
      output_data TEXT NOT NULL DEFAULT '',
      answer TEXT NOT NULL DEFAULT '',
      expected_verdict TEXT NOT NULL DEFAULT 'OK',
      run_verdict TEXT NOT NULL DEFAULT '',
      run_comment TEXT NOT NULL DEFAULT '',
      UNIQUE(problem_id, idx)
    );

    CREATE TABLE IF NOT EXISTS validator_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
      validator_idx INTEGER NOT NULL DEFAULT 0,
      idx INTEGER NOT NULL,
      input TEXT NOT NULL DEFAULT '',
      expected_verdict TEXT NOT NULL DEFAULT 'VALID',
      testset_name TEXT NOT NULL DEFAULT '',
      group_name TEXT NOT NULL DEFAULT '',
      run_verdict TEXT NOT NULL DEFAULT '',
      run_comment TEXT NOT NULL DEFAULT '',
      UNIQUE(problem_id, validator_idx, idx)
    );

    CREATE TABLE IF NOT EXISTS problem_properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      UNIQUE(problem_id, name)
    );

    CREATE TABLE IF NOT EXISTS problem_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
      value TEXT NOT NULL,
      UNIQUE(problem_id, value)
    );

    CREATE TABLE IF NOT EXISTS packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'standard',
      state TEXT NOT NULL DEFAULT 'PENDING',
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      file_path TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS invocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
      testset_name TEXT NOT NULL DEFAULT 'tests',
      state TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invocation_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invocation_id INTEGER NOT NULL REFERENCES invocations(id) ON DELETE CASCADE,
      solution_id INTEGER NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
      test_idx INTEGER NOT NULL,
      verdict TEXT NOT NULL DEFAULT '',
      time_ms INTEGER NOT NULL DEFAULT 0,
      memory_bytes INTEGER NOT NULL DEFAULT 0,
      exit_code INTEGER NOT NULL DEFAULT 0,
      stderr_preview TEXT NOT NULL DEFAULT '',
      stdout_preview TEXT NOT NULL DEFAULT '',
      points REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS stresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
      generator_cmd TEXT NOT NULL DEFAULT '',
      solution_path TEXT NOT NULL DEFAULT '',
      checker_path TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT ''
    );
  `);

  // Migrations for new columns (safe to run multiple times)
  for (const sql of [
    'ALTER TABLE problems ADD COLUMN polygon_problem_id INTEGER DEFAULT NULL',
    'ALTER TABLE users ADD COLUMN polygon_api_key TEXT DEFAULT NULL',
    'ALTER TABLE users ADD COLUMN polygon_api_secret TEXT DEFAULT NULL',
  ]) {
    try { _real.exec(sql); } catch { /* column already exists */ }
  }

  // Create admin user if no users exist
  const count = (_real.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  if (count === 0) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('admin', 10);
    _real.prepare(
      "INSERT INTO users (username, password_hash, must_change_password) VALUES (?, ?, 1)"
    ).run('admin', hash);
  }
}

export function getDataDir(): string {
  return _dir;
}

export function getProblemDir(problemId: number): string {
  return path.join(_dir, 'problems', String(problemId));
}

export function getPackagesDir(): string {
  return path.join(_dir, 'packages');
}
