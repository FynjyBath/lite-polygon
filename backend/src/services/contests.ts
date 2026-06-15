import { db } from '../db/schema';

export interface Contest {
  id: number;
  owner_id: number;
  name: string;
  location: string;
  date: string;
  language: string;
  created_at: string;
}

export interface ContestProblemRow {
  problem_id: number;
  idx: number;
  short_name: string;
  revision: number;
}

export function listContests(ownerId: number): Contest[] {
  return db.prepare('SELECT * FROM contests WHERE owner_id = ? ORDER BY id DESC').all(ownerId) as Contest[];
}

export function getContest(id: number, ownerId?: number): Contest | undefined {
  if (ownerId !== undefined) {
    return db.prepare('SELECT * FROM contests WHERE id = ? AND owner_id = ?').get(id, ownerId) as Contest | undefined;
  }
  return db.prepare('SELECT * FROM contests WHERE id = ?').get(id) as Contest | undefined;
}

export function createContest(ownerId: number, name: string): Contest {
  const r = db.prepare('INSERT INTO contests (owner_id, name) VALUES (?, ?)').run(ownerId, name);
  return getContest(r.lastInsertRowid as number)!;
}

export function updateContest(id: number, fields: Partial<Pick<Contest, 'name' | 'location' | 'date' | 'language'>>): void {
  const allowed = ['name', 'location', 'date', 'language'] as const;
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of allowed) {
    if (fields[k] !== undefined) { sets.push(`${k} = ?`); vals.push(fields[k]); }
  }
  if (!sets.length) return;
  vals.push(id);
  db.prepare(`UPDATE contests SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function deleteContest(id: number): void {
  db.prepare('DELETE FROM contests WHERE id = ?').run(id);
}

/** Problems in the contest, ordered by idx (the A, B, C order). */
export function listContestProblems(contestId: number): ContestProblemRow[] {
  return db.prepare(
    `SELECT cp.problem_id, cp.idx, p.short_name, p.revision
     FROM contest_problems cp
     JOIN problems p ON p.id = cp.problem_id
     WHERE cp.contest_id = ?
     ORDER BY cp.idx, cp.id`
  ).all(contestId) as ContestProblemRow[];
}

/** Append a problem to the end of the contest (no-op if already present). */
export function addContestProblem(contestId: number, problemId: number): void {
  const exists = db.prepare('SELECT 1 FROM contest_problems WHERE contest_id = ? AND problem_id = ?').get(contestId, problemId);
  if (exists) return;
  const maxIdx = (db.prepare('SELECT MAX(idx) m FROM contest_problems WHERE contest_id = ?').get(contestId) as { m: number | null }).m;
  db.prepare('INSERT INTO contest_problems (contest_id, problem_id, idx) VALUES (?, ?, ?)')
    .run(contestId, problemId, (maxIdx ?? -1) + 1);
}

export function removeContestProblem(contestId: number, problemId: number): void {
  db.prepare('DELETE FROM contest_problems WHERE contest_id = ? AND problem_id = ?').run(contestId, problemId);
  // Re-pack indices so they stay contiguous 0..n-1.
  const rows = db.prepare('SELECT id FROM contest_problems WHERE contest_id = ? ORDER BY idx, id').all(contestId) as { id: number }[];
  rows.forEach((r, i) => db.prepare('UPDATE contest_problems SET idx = ? WHERE id = ?').run(i, r.id));
}

/** Set the full A/B/C order from an ordered list of problem ids. */
export function reorderContestProblems(contestId: number, orderedProblemIds: number[]): void {
  db.transaction(() => {
    orderedProblemIds.forEach((pid, i) => {
      db.prepare('UPDATE contest_problems SET idx = ? WHERE contest_id = ? AND problem_id = ?').run(i, contestId, pid);
    });
  })();
}

/** 0 → "A", 1 → "B", … 25 → "Z", 26 → "AA". */
export function indexToLetter(i: number): string {
  let s = '';
  i++;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}
