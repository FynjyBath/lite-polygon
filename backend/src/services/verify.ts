import fs from 'fs';
import path from 'path';
import { db, getProblemDir } from '../db/schema';
import { getProblem, getAsset, getTestset, listTests, listSolutions } from './problems';
import { compileAsset, compileSolution, runInvocation } from '../judging/judging';
import { runValidator } from '../judging/compiler';

export type StepStatus = 'ok' | 'warn' | 'fail';
export interface VerifyStep { name: string; status: StepStatus; details?: string[]; }
export interface VerifyReport { ok: boolean; steps: VerifyStep[]; }

/** What aggregate outcome we require for a solution given its tag. */
function expectationFor(tag: string): 'all-ok' | 'some-wa' | 'some-pe' | 'some-tl' | 'some-re' | 'tl-or-ok' | 'any-fail' | 'skip' {
  switch (tag) {
    case 'main': case 'accepted': return 'all-ok';
    case 'wrong-answer': return 'some-wa';
    case 'presentation-error': return 'some-pe';
    case 'time-limit-exceeded': return 'some-tl';
    case 'runtime-error': return 'some-re';
    case 'time-limit-exceeded-or-accepted': return 'tl-or-ok';
    case 'memory-limit-exceeded':
    case 'time-limit-exceeded-or-memory-limit-exceeded':
    case 'rejected': return 'any-fail';
    default: return 'skip'; // do-not-run and unknown
  }
}

function checkExpectation(exp: ReturnType<typeof expectationFor>, verdicts: string[]): { ok: boolean; got: string } {
  const set = new Set(verdicts);
  const allOk = verdicts.every(v => v === 'OK');
  const summary = [...set].join(',') || '(no tests)';
  switch (exp) {
    case 'all-ok': return { ok: allOk, got: summary };
    case 'some-wa': return { ok: set.has('WRONG_ANSWER'), got: summary };
    case 'some-pe': return { ok: set.has('PRESENTATION_ERROR'), got: summary };
    case 'some-tl': return { ok: set.has('TL'), got: summary };
    case 'some-re': return { ok: set.has('RE') || set.has('CRASHED'), got: summary };
    case 'tl-or-ok': return { ok: verdicts.every(v => v === 'OK' || v === 'TL'), got: summary };
    case 'any-fail': return { ok: !allOk, got: summary };
    default: return { ok: true, got: summary };
  }
}

/**
 * Run a full verification of a problem: static checks, compilation, validator
 * over all tests, answer generation, and an expected-verdict check of every
 * solution. Returns a structured report; `ok` is false if any step failed.
 */
export async function verifyProblem(problemId: number): Promise<VerifyReport> {
  const steps: VerifyStep[] = [];
  const push = (name: string, status: StepStatus, details?: string[]) => steps.push({ name, status, details });

  const problem = getProblem(problemId);
  if (!problem) return { ok: false, steps: [{ name: 'Load problem', status: 'fail', details: ['Problem not found'] }] };

  // 1. Static checks
  const staticErr: string[] = [];
  if (!problem.time_limit || problem.time_limit <= 0) staticErr.push('Time limit is not set');
  if (!problem.memory_limit || problem.memory_limit <= 0) staticErr.push('Memory limit is not set');
  const testset = getTestset(problemId, 'tests');
  const tests = testset ? listTests(testset.id) : [];
  if (tests.length === 0) staticErr.push('No tests');
  const checker = getAsset(problemId, 'checker');
  if (!checker) staticErr.push('No checker set');
  const solutions = listSolutions(problemId);
  const mains = solutions.filter(s => s.tag === 'main');
  if (mains.length === 0) staticErr.push('No main correct solution');
  if (mains.length > 1) staticErr.push(`Multiple main solutions (${mains.length})`);
  push('Static checks', staticErr.length ? 'fail' : 'ok', staticErr.length ? staticErr : undefined);
  if (staticErr.length) return { ok: false, steps };

  // 2. Compile checker + all solutions
  const compileErr: string[] = [];
  const cc = await compileAsset(problemId, 'checker');
  if (!cc.success) compileErr.push(`Checker: ${cc.error.slice(0, 200)}`);
  const validator = getAsset(problemId, 'validator');
  if (validator) {
    const vc = await compileAsset(problemId, 'validator');
    if (!vc.success) compileErr.push(`Validator: ${vc.error.slice(0, 200)}`);
  }
  for (const sol of solutions) {
    if (sol.tag === 'do-not-run') continue;
    const r = await compileSolution(problemId, sol.id);
    if (!r.success) compileErr.push(`${sol.source_path}: ${r.error.slice(0, 150)}`);
  }
  push('Compilation', compileErr.length ? 'fail' : 'ok', compileErr.length ? compileErr : undefined);
  if (compileErr.length) return { ok: false, steps };

  // 3. Validator over all tests
  if (validator) {
    const vbin = getAsset(problemId, 'validator')?.compiled_binary;
    const problemDir = getProblemDir(problemId);
    const invalid: string[] = [];
    if (vbin && fs.existsSync(vbin)) {
      for (const t of tests) {
        const n = String(t.idx).padStart(2, '0');
        const inputFile = path.join(problemDir, testset!.input_path_pattern.replace('%02d', n));
        if (!fs.existsSync(inputFile)) continue; // generated tests may not exist yet
        const res = await runValidator(vbin, inputFile, 'tests', t.group_name || undefined);
        if (!res.valid) invalid.push(`Test ${t.idx}: ${res.comment.slice(0, 120)}`);
      }
    }
    push('Validator on tests', invalid.length ? 'fail' : 'ok', invalid.length ? invalid : undefined);
  } else {
    push('Validator on tests', 'warn', ['No validator set']);
  }

  // 4 + 5. Run every solution over the testset and check expected verdicts.
  const runnable = solutions.filter(s => s.tag !== 'do-not-run');
  const inv = db.prepare("INSERT INTO invocations (problem_id, testset_name, state) VALUES (?, 'tests', 'PENDING')").run(problemId);
  const invId = inv.lastInsertRowid as number;
  await runInvocation(problemId, invId, runnable.map(s => s.id), 'tests');

  const verdictRows = db.prepare('SELECT solution_id, verdict FROM invocation_runs WHERE invocation_id = ?').all(invId) as { solution_id: number; verdict: string }[];
  const bySol = new Map<number, string[]>();
  for (const r of verdictRows) {
    if (!bySol.has(r.solution_id)) bySol.set(r.solution_id, []);
    bySol.get(r.solution_id)!.push(r.verdict);
  }

  const mismatches: string[] = [];
  for (const sol of runnable) {
    const exp = expectationFor(sol.tag);
    if (exp === 'skip') continue;
    const verdicts = bySol.get(sol.id) ?? [];
    const { ok, got } = checkExpectation(exp, verdicts);
    if (!ok) mismatches.push(`${sol.source_path} [${sol.tag}]: expected ${exp}, got {${got}}`);
  }
  push('Expected verdicts', mismatches.length ? 'fail' : 'ok', mismatches.length ? mismatches : [`${runnable.length} solution(s) behaved as tagged`]);

  return { ok: steps.every(s => s.status !== 'fail'), steps };
}
