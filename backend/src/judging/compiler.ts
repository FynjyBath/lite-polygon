import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface CompileResult {
  success: boolean;
  binaryPath: string;
  stderr: string;
  stdout: string;
}

export interface RunResult {
  verdict: 'OK' | 'TLE' | 'MLE' | 'RE' | 'CRASHED';
  exitCode: number;
  timeMs: number;
  memoryBytes: number;
  stdout: string;
  stderr: string;
}

// Map Polygon source types to local compiler commands
const CPP_FLAGS_BASE = [
  '-O2', '-std=c++17', '-DLOCAL',
  '-Wall', '-Wextra', '-Wno-unused-result',
];

function getCompileCommand(sourceType: string): { compiler: string; flags: string[] } | null {
  const lower = sourceType.toLowerCase();
  if (lower.includes('cpp') || lower.includes('g++')) {
    let std = '-std=c++17';
    if (lower.includes('g++20') || lower.includes('c++20')) std = '-std=c++20';
    else if (lower.includes('g++23') || lower.includes('c++23')) std = '-std=c++23';
    return {
      compiler: 'g++',
      flags: ['-O2', std, '-DLOCAL', '-Wall', '-Wextra', '-Wno-unused-result', '-lm'],
    };
  }
  return null;
}

export function compileSource(sourcePath: string, sourceType: string, outputPath: string): CompileResult {
  const cmd = getCompileCommand(sourceType);
  if (!cmd) {
    // Check if it's a known non-compilable type (header, script, etc.)
    if (sourceType.startsWith('h.') || sourceType === '') {
      return { success: true, binaryPath: '', stderr: '', stdout: '' };
    }
    return {
      success: false,
      binaryPath: '',
      stderr: `Unsupported source type: ${sourceType}`,
      stdout: '',
    };
  }

  const args = [...cmd.flags, sourcePath, '-o', outputPath];
  const result = spawnSync(cmd.compiler, args, {
    timeout: 60000,
    encoding: 'utf-8',
    cwd: path.dirname(sourcePath),
  });

  if (result.error) {
    return { success: false, binaryPath: '', stderr: result.error.message, stdout: '' };
  }

  const success = result.status === 0 && fs.existsSync(outputPath);
  return {
    success,
    binaryPath: success ? outputPath : '',
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  };
}

export interface RunOptions {
  timeLimitMs: number;
  memoryLimitBytes?: number;
  stdin?: string;
  stdinFile?: string;
  stdoutFile?: string;
  cwd?: string;
  args?: string[];
  env?: Record<string, string>;
}

export function runBinary(binaryPath: string, options: RunOptions): RunResult {
  const { timeLimitMs, stdin, stdinFile, stdoutFile, cwd, args = [], env } = options;

  const startTime = Date.now();

  const spawnArgs = args;
  const inputData = stdinFile && fs.existsSync(stdinFile)
    ? fs.readFileSync(stdinFile)
    : stdin
    ? Buffer.from(stdin)
    : undefined;

  const result = spawnSync(binaryPath, spawnArgs, {
    input: inputData,
    timeout: timeLimitMs + 1000, // grace period
    maxBuffer: 64 * 1024 * 1024, // 64MB output buffer
    cwd: cwd || path.dirname(binaryPath),
    encoding: 'buffer',
    env: { ...process.env, ...env },
  });

  const timeMs = Date.now() - startTime;

  let stdout = '';
  let stderr = '';
  try {
    stdout = result.stdout ? result.stdout.toString('utf-8') : '';
    stderr = result.stderr ? result.stderr.toString('utf-8') : '';
  } catch {
    stdout = '';
    stderr = '';
  }

  if (stdoutFile && result.stdout) {
    fs.mkdirSync(path.dirname(stdoutFile), { recursive: true });
    fs.writeFileSync(stdoutFile, result.stdout);
  }

  if (result.signal === 'SIGKILL' || timeMs >= timeLimitMs) {
    return { verdict: 'TLE', exitCode: -1, timeMs, memoryBytes: 0, stdout, stderr };
  }

  if (result.error) {
    if (result.error.message.includes('ETIMEDOUT') || result.error.message.includes('timeout')) {
      return { verdict: 'TLE', exitCode: -1, timeMs, memoryBytes: 0, stdout, stderr };
    }
    return { verdict: 'CRASHED', exitCode: -1, timeMs, memoryBytes: 0, stdout, stderr };
  }

  const exitCode = result.status ?? -1;
  if (exitCode !== 0) {
    return { verdict: 'RE', exitCode, timeMs, memoryBytes: 0, stdout, stderr };
  }

  return { verdict: 'OK', exitCode: 0, timeMs, memoryBytes: 0, stdout, stderr };
}

export function runChecker(
  checkerBinary: string,
  inputFile: string,
  outputFile: string,
  answerFile: string,
  cwd?: string
): { verdict: string; comment: string } {
  const result = spawnSync(checkerBinary, [inputFile, outputFile, answerFile], {
    timeout: 30000,
    encoding: 'utf-8',
    cwd: cwd || path.dirname(checkerBinary),
  });

  const exitCode = result.status ?? -1;
  const comment = (result.stderr || result.stdout || '').trim().slice(0, 500);

  if (result.error) return { verdict: 'CRASHED', comment: result.error.message };
  if (exitCode === 0) return { verdict: 'OK', comment };
  if (exitCode === 1) return { verdict: 'WRONG_ANSWER', comment };
  if (exitCode === 2) return { verdict: 'PRESENTATION_ERROR', comment };
  if (exitCode === 3) {
    // checker error / points
    return { verdict: 'PARTIAL', comment };
  }
  return { verdict: 'CRASHED', comment };
}

export function runValidator(
  validatorBinary: string,
  inputFile: string,
  testset?: string,
  group?: string
): { valid: boolean; comment: string } {
  const args: string[] = [];
  if (testset) { args.push('--testset', testset); }
  if (group) { args.push('--group', group); }

  const result = spawnSync(validatorBinary, args, {
    input: fs.readFileSync(inputFile),
    timeout: 30000,
    encoding: 'utf-8',
    cwd: path.dirname(validatorBinary),
  });

  const exitCode = result.status ?? -1;
  const comment = (result.stderr || result.stdout || '').trim().slice(0, 500);

  if (result.error) return { valid: false, comment: result.error.message };
  return { valid: exitCode === 0, comment };
}

export function isCompilable(sourceType: string): boolean {
  return getCompileCommand(sourceType) !== null;
}
