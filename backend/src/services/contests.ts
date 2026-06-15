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

export function listContests(ownerId: number): (Contest & { owner_username: string })[] {
  return db.prepare(
    `SELECT DISTINCT c.*, u.username AS owner_username
       FROM contests c JOIN users u ON u.id = c.owner_id
      WHERE c.owner_id = ?
         OR c.id IN (SELECT contest_id FROM contest_shares WHERE user_id = ?)
      ORDER BY c.id DESC`
  ).all(ownerId, ownerId) as (Contest & { owner_username: string })[];
}

/** True if the user owns the contest or has been shared it. */
export function canAccessContest(id: number, userId: number): boolean {
  const row = db.prepare(
    `SELECT 1 FROM contests c WHERE c.id = ? AND (
        c.owner_id = ? OR EXISTS (SELECT 1 FROM contest_shares s WHERE s.contest_id = c.id AND s.user_id = ?)
     ) LIMIT 1`
  ).get(id, userId, userId);
  return !!row;
}

export function shareContestWith(contestId: number, userId: number): void {
  db.prepare('INSERT OR IGNORE INTO contest_shares (contest_id, user_id) VALUES (?, ?)').run(contestId, userId);
}

export function unshareContest(contestId: number, userId: number): void {
  db.prepare('DELETE FROM contest_shares WHERE contest_id = ? AND user_id = ?').run(contestId, userId);
}

export function listContestShares(contestId: number): { id: number; username: string }[] {
  return db.prepare(
    `SELECT u.id, u.username FROM contest_shares s JOIN users u ON u.id = s.user_id
      WHERE s.contest_id = ? ORDER BY u.username`
  ).all(contestId) as { id: number; username: string }[];
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
