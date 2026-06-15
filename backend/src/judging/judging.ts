import fs from 'fs';
import path from 'path';
import os from 'os';
import { db, getProblemDir } from '../db/schema';
import { getAsset, listSolutions, listTests, getTestset, getSolution, getDerivedTestGroups } from '../services/problems';
import { compileSource, runBinary, runChecker, isCompilable } from './compiler';
import { STD_CHECKERS } from './stdCheckers';

// Number of test runs executed in parallel. Tune with the INVOCATION_WORKERS
// environment variable (see README). Default is 4, which suits a 6-core machine.
const PARALLEL_WORKERS = parseInt(process.env.INVOCATION_WORKERS ?? '4');

interface JudgeTestResult {
  testIdx: number;
  verdict: string;
  timeMs: number;
  memoryBytes: number;
  exitCode: number;
  stderr: string;
  stdout: string;
  checkerComment: string;
  points: number;
}

interface SolutionJudgeResult {
  solutionId: number;
  solutionPath: string;
  compiledOk: boolean;
  compileError: string;
  testResults: JudgeTestResult[];
}

// Simple worker pool: runs fn over items with at most `concurrency` in flight at once.
// Safe in Node.js because `idx++` is atomic between async suspension points.
async function runPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const item = items[idx++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function compileSolution(problemId: number, solutionId: number): Promise<{ success: boolean; error: string }> {
  const solution = getSolution(solutionId);
  if (!solution || solution.problem_id !== problemId) {
    return { success: false, error: 'Solution not found' };
  }

  const problemDir = getProblemDir(problemId);
  const sourcePath = path.join(problemDir, solution.source_path);
  if (!fs.existsSync(sourcePath)) {
    return { success: false, error: `Source file not found: ${solution.source_path}` };
  }

  const workdir = path.join(problemDir, 'workdir');
  fs.mkdirSync(workdir, { recursive: true });
  const binaryName = path.basename(solution.source_path, path.extname(solution.source_path));
  const outputPath = path.join(workdir, `sol_${solutionId}_${binaryName}`);

  const result = await compileSource(sourcePath, solution.source_type, outputPath);
  if (result.success) {
    db.prepare('UPDATE solutions SET compiled_binary = ? WHERE id = ?').run(outputPath, solutionId);
    return { success: true, error: '' };
  }
  return { success: false, error: result.stderr };
}

export async function compileAsset(problemId: number, assetType: string): Promise<{ success: boolean; error: string }> {
  const asset = getAsset(problemId, assetType);
  if (!asset || !asset.source_path) {
    return { success: false, error: `Asset ${assetType} not found or no source` };
  }

  const problemDir = getProblemDir(problemId);
  const workdir = path.join(problemDir, 'workdir');
  fs.mkdirSync(workdir, { recursive: true });
  const outputPath = path.join(workdir, `${assetType}_${problemId}`);

  // Handle standard (testlib) checkers — use embedded minimal implementations
  if (assetType === 'checker' && asset.source_path.startsWith('std::')) {
    const src = STD_CHECKERS[asset.source_path];
    if (!src) return { success: false, error: `Unknown standard checker: ${asset.source_path}` };
    const tmpSrc = path.join(os.tmpdir(), `stdchecker_${asset.source_path.replace(/[^a-z0-9.]/g, '_')}.cpp`);
    fs.writeFileSync(tmpSrc, src, 'utf-8');
    const result = await compileSource(tmpSrc, 'cpp.g++17', outputPath);
    if (result.success) {
      db.prepare('UPDATE assets SET compiled_binary = ? WHERE problem_id = ? AND asset_type = ?')
        .run(outputPath, problemId, assetType);
      return { success: true, error: '' };
    }
    return { success: false, error: result.stderr };
  }

  const sourcePath = path.join(problemDir, asset.source_path);
  if (!fs.existsSync(sourcePath)) {
    return { success: false, error: `Source not found: ${asset.source_path}` };
  }

  if (!isCompilable(asset.source_type)) {
    return { success: false, error: `Unsupported source type: ${asset.source_type}` };
  }

  const result = await compileSource(sourcePath, asset.source_type, outputPath);
  if (result.success) {
    db.prepare('UPDATE assets SET compiled_binary = ? WHERE problem_id = ? AND asset_type = ?')
      .run(outputPath, problemId, assetType);
    return { success: true, error: '' };
  }
  return { success: false, error: result.stderr };
}

export async function generateTestInput(
  problemId: number,
  testsetId: number,
  testIdx: number
): Promise<{ success: boolean; inputPath: string; error: string }> {
  const test = db.prepare('SELECT * FROM tests WHERE testset_id = ? AND idx = ?').get(testsetId, testIdx) as {
    method: string; cmd: string;
  } | undefined;

  if (!test) return { success: false, inputPath: '', error: 'Test not found' };
  if (test.method !== 'generated' || !test.cmd) {
    return { success: false, inputPath: '', error: 'Not a generated test' };
  }

  const problemDir = getProblemDir(problemId);
  const workdir = path.join(problemDir, 'workdir', 'gen');
  fs.mkdirSync(workdir, { recursive: true });

  // Parse command: first word is generator name, rest are args
  const parts = test.cmd.split(/\s+/);
  const genName = parts[0];
  const genArgs = parts.slice(1);

  // Find generator binary
  const execs = db.prepare('SELECT * FROM executables WHERE problem_id = ?').all(problemId) as Array<{
    source_path: string; source_type: string; binary_path: string; binary_type: string;
  }>;

  // Try to find compiled generator
  let genBinary = '';
  for (const e of execs) {
    if (e.source_path && path.basename(e.source_path, path.extname(e.source_path)) === genName) {
      const compiledKey = `gen_${problemId}_${genName}`;
      const workBinary = path.join(problemDir, 'workdir', compiledKey);
      if (!fs.existsSync(workBinary)) {
        const srcPath = path.join(problemDir, e.source_path);
        if (fs.existsSync(srcPath)) {
          const cr = await compileSource(srcPath, e.source_type, workBinary);
          if (cr.success) genBinary = workBinary;
        }
      } else {
        genBinary = workBinary;
      }
      break;
    }
  }

  if (!genBinary || !fs.existsSync(genBinary)) {
    return { success: false, inputPath: '', error: `Generator '${genName}' not found or failed to compile` };
  }

  const inputPath = path.join(workdir, `test_${testIdx}.in`);
  const result = await runBinary(genBinary, {
    timeLimitMs: 30000,
    args: genArgs,
    cwd: path.join(problemDir, 'files'),
    stdoutFile: inputPath,
  });

  if (result.verdict !== 'OK') {
    return { success: false, inputPath: '', error: `Generator failed: ${result.verdict} - ${result.stderr}` };
  }

  return { success: true, inputPath, error: '' };
}

export async function generateTestAnswer(
  problemId: number,
  inputPath: string,
  timeLimitMs: number,
  memoryLimitBytes: number,
  outputPath?: string
): Promise<{ success: boolean; answerPath: string; error: string }> {
  const mainSolution = db.prepare(
    "SELECT * FROM solutions WHERE problem_id = ? AND tag = 'main' LIMIT 1"
  ).get(problemId) as { id: number; source_path: string; source_type: string; compiled_binary: string } | undefined;

  if (!mainSolution) return { success: false, answerPath: '', error: 'No main solution found' };

  let binary = mainSolution.compiled_binary;
  if (!binary || !fs.existsSync(binary)) {
    const r = await compileSolution(problemId, mainSolution.id);
    if (!r.success) return { success: false, answerPath: '', error: `Compile failed: ${r.error}` };
    const updated = db.prepare('SELECT compiled_binary FROM solutions WHERE id = ?').get(mainSolution.id) as { compiled_binary: string };
    binary = updated.compiled_binary;
  }

  const answerPath = outputPath ?? (inputPath + '.out');
  const problemDir = getProblemDir(problemId);
  fs.mkdirSync(path.dirname(answerPath), { recursive: true });

  const result = await runBinary(binary, {
    timeLimitMs: timeLimitMs * 3, // generous for answer generation
    memoryLimitBytes,
    stdinFile: inputPath,
    stdoutFile: answerPath,
    cwd: problemDir,
  });

  if (result.verdict !== 'OK') {
    return { success: false, answerPath: '', error: `Main solution failed: ${result.verdict}` };
  }

  return { success: true, answerPath, error: '' };
}

const INSERT_RUN =
  'INSERT INTO invocation_runs (invocation_id, solution_id, test_idx, verdict, time_ms, memory_bytes, exit_code, stderr_preview, stdout_preview, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

export async function runInvocation(
  problemId: number,
  invocationId: number,
  solutionIds: number[],
  testsetName: string
): Promise<void> {
  db.prepare("UPDATE invocations SET state = 'RUNNING' WHERE id = ?").run(invocationId);

  try {
    const problemDir = getProblemDir(problemId);
    const testset = getTestset(problemId, testsetName);
    if (!testset) {
      db.prepare("UPDATE invocations SET state = 'FAILED' WHERE id = ?").run(invocationId);
      return;
    }

    const timeLimitMs = testset.time_limit ?? 1000;
    const memLimitBytes = testset.memory_limit ?? 268435456;
    const tests = listTests(testset.id);

    // Phase 1: Pre-generate all missing test inputs sequentially to avoid
    // concurrent generator-compilation races.
    for (const t of tests) {
      const testNum = String(t.idx).padStart(2, '0');
      const inputFile = path.join(problemDir, testset.input_path_pattern.replace('%02d', testNum));
      if (!fs.existsSync(inputFile) && t.method === 'generated' && t.cmd) {
        const genResult = await generateTestInput(problemId, testset.id, t.idx);
        if (genResult.success) {
          fs.mkdirSync(path.dirname(inputFile), { recursive: true });
          fs.copyFileSync(genResult.inputPath, inputFile);
        }
      }
    }

    // Phase 2: Compile checker.
    const checker = getAsset(problemId, 'checker');
    let checkerBinary = checker?.compiled_binary || '';
    if (checker && checker.source_path && (!checkerBinary || !fs.existsSync(checkerBinary))) {
      const cr = await compileAsset(problemId, 'checker');
      if (cr.success) checkerBinary = getAsset(problemId, 'checker')?.compiled_binary || '';
    }

    // Phase 3: Compile all solutions in parallel (up to PARALLEL_WORKERS at once).
    const compiledSolutions = new Map<number, string>(); // solId -> binary path
    const ceErrors = new Map<number, string>();          // solId -> error message

    await runPool(solutionIds, PARALLEL_WORKERS, async (solId) => {
      const solution = getSolution(solId);
      if (!solution || solution.problem_id !== problemId) return;

      let binary = solution.compiled_binary;
      if (!binary || !fs.existsSync(binary)) {
        const cr = await compileSolution(problemId, solId);
        if (!cr.success) {
          ceErrors.set(solId, cr.error);
          return;
        }
        binary = getSolution(solId)!.compiled_binary;
      }

      if (binary && fs.existsSync(binary)) {
        compiledSolutions.set(solId, binary);
      } else {
        ceErrors.set(solId, 'Binary not found after compilation');
      }
    });

    // Insert CE records for solutions that failed to compile.
    for (const [solId, err] of ceErrors) {
      for (const t of tests) {
        db.prepare(INSERT_RUN).run(invocationId, solId, t.idx, 'CE', 0, 0, 1, err.slice(0, 500), '', 0);
      }
    }

    // Phase 4: Build flat list of all (solution, test) pairs and run in parallel.
    type RunPair = { solId: number; binary: string; test: (typeof tests)[0] };
    const runPairs: RunPair[] = [];
    for (const [solId, binary] of compiledSolutions) {
      for (const t of tests) {
        runPairs.push({ solId, binary, test: t });
      }
    }

    await runPool(runPairs, PARALLEL_WORKERS, async ({ solId, binary, test: t }) => {
      const testNum = String(t.idx).padStart(2, '0');
      const inputFile  = path.join(problemDir, testset.input_path_pattern.replace('%02d', testNum));
      const answerFile = path.join(problemDir, testset.answer_path_pattern.replace('%02d', testNum));

      if (!fs.existsSync(inputFile)) {
        db.prepare(INSERT_RUN).run(invocationId, solId, t.idx, 'SKIPPED', 0, 0, 0, 'Input file missing', '', 0);
        return;
      }

      const outputFile = path.join(problemDir, 'workdir', `inv_${invocationId}_sol_${solId}_test_${t.idx}.out`);
      fs.mkdirSync(path.dirname(outputFile), { recursive: true });

      const runResult = await runBinary(binary, {
        timeLimitMs,
        memoryLimitBytes: memLimitBytes,
        stdinFile: inputFile,
        stdoutFile: outputFile,
        cwd: problemDir,
      });

      let verdict: string = runResult.verdict;
      let checkerComment = '';

      if (verdict === 'OK' && checkerBinary && fs.existsSync(checkerBinary)) {
        // Generate answer file if missing (each test has a unique answerFile path).
        if (!fs.existsSync(answerFile)) {
          const genAns = await generateTestAnswer(problemId, inputFile, timeLimitMs, memLimitBytes);
          if (genAns.success) fs.copyFileSync(genAns.answerPath, answerFile);
        }

        if (fs.existsSync(answerFile)) {
          const checkerResult = await runChecker(checkerBinary, inputFile, outputFile, answerFile, problemDir);
          verdict = checkerResult.verdict;
          checkerComment = checkerResult.comment;
        } else {
          checkerComment = 'Answer file missing';
        }
      }

      if (verdict === 'TLE') {
        verdict = runResult.timeMs < timeLimitMs ? 'RE' : 'TL';
      }

      db.prepare(INSERT_RUN).run(
        invocationId, solId, t.idx,
        verdict,
        runResult.timeMs,
        0,
        runResult.exitCode,
        (runResult.stderr + '\n' + checkerComment).trim().slice(0, 500),
        runResult.stdout.slice(0, 200),
        0
      );
    });

    // Phase 5: award points per (solution, test) based on the group policies.
    //  - EACH_TEST group / ungrouped test: a passing (OK) test scores its points.
    //  - COMPLETE_GROUP group: tests score their points only if the WHOLE group
    //    passed; otherwise the whole group scores 0.
    assignInvocationPoints(invocationId, testset.id, tests);

    db.prepare("UPDATE invocations SET state = 'DONE' WHERE id = ?").run(invocationId);
  } catch (e) {
    db.prepare("UPDATE invocations SET state = 'FAILED' WHERE id = ?").run(invocationId);
    throw e;
  }
}

/**
 * Compute and store per-test points for every solution in an invocation,
 * honouring each group's points policy:
 *   - each-test (and ungrouped tests): a test scores its own points when its
 *     verdict is OK.
 *   - complete-group: the tests in the group score their points only when the
 *     whole group passed; otherwise the entire group scores 0.
 */
function assignInvocationPoints(invocationId: number, testsetId: number, tests: ReturnType<typeof listTests>): void {
  const policyByGroup = new Map<string, string>();
  for (const g of getDerivedTestGroups(testsetId)) policyByGroup.set(g.name, g.points_policy);

  const testsByGroup = new Map<string, typeof tests>();
  for (const t of tests) {
    const g = (t.group_name ?? '').trim();
    if (!g) continue;
    if (!testsByGroup.has(g)) testsByGroup.set(g, []);
    testsByGroup.get(g)!.push(t);
  }

  const rows = db.prepare('SELECT solution_id, test_idx, verdict FROM invocation_runs WHERE invocation_id = ?')
    .all(invocationId) as { solution_id: number; test_idx: number; verdict: string }[];
  const verdictBySol = new Map<number, Map<number, string>>();
  for (const r of rows) {
    if (!verdictBySol.has(r.solution_id)) verdictBySol.set(r.solution_id, new Map());
    verdictBySol.get(r.solution_id)!.set(r.test_idx, r.verdict);
  }

  const update = db.prepare('UPDATE invocation_runs SET points = ? WHERE invocation_id = ? AND solution_id = ? AND test_idx = ?');
  db.transaction(() => {
    for (const [solId, verdicts] of verdictBySol) {
      // Pre-compute, per complete-group, whether the whole group passed.
      const groupAllOk = new Map<string, boolean>();
      for (const [gname, gtests] of testsByGroup) {
        groupAllOk.set(gname, gtests.every(t => verdicts.get(t.idx) === 'OK'));
      }
      for (const t of tests) {
        const ok = verdicts.get(t.idx) === 'OK';
        const g = (t.group_name ?? '').trim();
        let pts = 0;
        if (g && (policyByGroup.get(g) ?? 'complete-group') === 'complete-group') {
          pts = groupAllOk.get(g) ? (t.points || 0) : 0;
        } else {
          pts = ok ? (t.points || 0) : 0;
        }
        if (pts) update.run(pts, invocationId, solId, t.idx);
      }
    }
  })();
}
