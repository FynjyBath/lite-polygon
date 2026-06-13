import fs from 'fs';
import path from 'path';
import { db, getProblemDir } from '../db/schema';
import { getAsset, listSolutions, listTests, getTestset, getSolution } from '../services/problems';
import { compileSource, runBinary, runChecker, isCompilable } from './compiler';

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
  const sourcePath = path.join(problemDir, asset.source_path);
  if (!fs.existsSync(sourcePath)) {
    return { success: false, error: `Source not found: ${asset.source_path}` };
  }

  if (!isCompilable(asset.source_type)) {
    return { success: false, error: `Unsupported source type: ${asset.source_type}` };
  }

  const workdir = path.join(problemDir, 'workdir');
  fs.mkdirSync(workdir, { recursive: true });
  const outputPath = path.join(workdir, `${assetType}_${problemId}`);

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
  const problemFiles = db.prepare('SELECT * FROM problem_files WHERE problem_id = ?').all(problemId) as Array<{
    path: string; file_role: string; source_type: string;
  }>;

  // Try to find compiled generator
  let genBinary = '';
  for (const e of execs) {
    if (e.source_path && path.basename(e.source_path, path.extname(e.source_path)) === genName) {
      // Check if compiled
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
    stdinFile: inputPath,
    stdoutFile: answerPath,
    cwd: problemDir,
  });

  if (result.verdict !== 'OK') {
    return { success: false, answerPath: '', error: `Main solution failed: ${result.verdict}` };
  }

  return { success: true, answerPath, error: '' };
}

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

    // Compile checker
    const checker = getAsset(problemId, 'checker');
    let checkerBinary = checker?.compiled_binary || '';
    if (checker && checker.source_path && (!checkerBinary || !fs.existsSync(checkerBinary))) {
      const cr = await compileAsset(problemId, 'checker');
      if (cr.success) {
        const updated = getAsset(problemId, 'checker');
        checkerBinary = updated?.compiled_binary || '';
      }
    }

    for (const solId of solutionIds) {
      const solution = getSolution(solId);
      if (!solution || solution.problem_id !== problemId) continue;

      // Compile solution if needed
      let binary = solution.compiled_binary;
      if (!binary || !fs.existsSync(binary)) {
        const cr = await compileSolution(problemId, solId);
        if (!cr.success) {
          // Record compile error for all tests
          for (const t of tests) {
            db.prepare(
              'INSERT INTO invocation_runs (invocation_id, solution_id, test_idx, verdict, time_ms, memory_bytes, exit_code, stderr_preview, stdout_preview, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            ).run(invocationId, solId, t.idx, 'CE', 0, 0, 1, cr.error.slice(0, 500), '', 0);
          }
          continue;
        }
        const updated = getSolution(solId)!;
        binary = updated.compiled_binary;
      }

      if (!binary || !fs.existsSync(binary)) {
        for (const t of tests) {
          db.prepare(
            'INSERT INTO invocation_runs (invocation_id, solution_id, test_idx, verdict, time_ms, memory_bytes, exit_code, stderr_preview, stdout_preview, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(invocationId, solId, t.idx, 'CE', 0, 0, 1, 'Binary not found', '', 0);
        }
        continue;
      }

      for (const t of tests) {
        const inputPathPattern = testset.input_path_pattern;
        const answerPathPattern = testset.answer_path_pattern;
        const testNum = String(t.idx).padStart(2, '0');
        const inputFile = path.join(problemDir, inputPathPattern.replace('%02d', testNum));
        const answerFile = path.join(problemDir, answerPathPattern.replace('%02d', testNum));

        if (!fs.existsSync(inputFile)) {
          // Try generating
          if (t.method === 'generated' && t.cmd) {
            const genResult = await generateTestInput(problemId, testset.id, t.idx);
            if (genResult.success) {
              fs.copyFileSync(genResult.inputPath, inputFile);
            } else {
              db.prepare(
                'INSERT INTO invocation_runs (invocation_id, solution_id, test_idx, verdict, time_ms, memory_bytes, exit_code, stderr_preview, stdout_preview, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
              ).run(invocationId, solId, t.idx, 'SKIPPED', 0, 0, 0, 'Input not available', '', 0);
              continue;
            }
          } else {
            db.prepare(
              'INSERT INTO invocation_runs (invocation_id, solution_id, test_idx, verdict, time_ms, memory_bytes, exit_code, stderr_preview, stdout_preview, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            ).run(invocationId, solId, t.idx, 'SKIPPED', 0, 0, 0, 'Input file missing', '', 0);
            continue;
          }
        }

        const outputFile = path.join(problemDir, 'workdir', `inv_${invocationId}_sol_${solId}_test_${t.idx}.out`);
        fs.mkdirSync(path.dirname(outputFile), { recursive: true });

        const runResult = await runBinary(binary, {
          timeLimitMs,
          stdinFile: inputFile,
          stdoutFile: outputFile,
          cwd: problemDir,
        });

        let verdict: string = runResult.verdict;
        let checkerComment = '';

        if (verdict === 'OK' && checkerBinary && fs.existsSync(checkerBinary)) {
          // Generate answer if missing
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
          if (runResult.timeMs < timeLimitMs) verdict = 'RE';
          else verdict = 'TL';
        }

        db.prepare(
          'INSERT INTO invocation_runs (invocation_id, solution_id, test_idx, verdict, time_ms, memory_bytes, exit_code, stderr_preview, stdout_preview, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          invocationId, solId, t.idx,
          verdict,
          runResult.timeMs,
          0,
          runResult.exitCode,
          (runResult.stderr + '\n' + checkerComment).trim().slice(0, 500),
          runResult.stdout.slice(0, 200),
          0
        );
      }
    }

    db.prepare("UPDATE invocations SET state = 'DONE' WHERE id = ?").run(invocationId);
  } catch (e) {
    db.prepare("UPDATE invocations SET state = 'FAILED' WHERE id = ?").run(invocationId);
    throw e;
  }
}
