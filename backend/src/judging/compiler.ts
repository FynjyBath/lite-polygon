import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Build a minimal, secret-free environment for running untrusted programs
 * (solutions, generators, checkers, validators) and build tools. The server's
 * own environment may hold secrets (e.g. Polygon API keys, DATA_DIR); never
 * hand those to spawned code. Only PATH and locale/home essentials are kept.
 */
function safeEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME ?? os.tmpdir(),
    TMPDIR: os.tmpdir(),
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    ...extra,
  };
}

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

const CPP_FLAGS_BASE = ['-O2', '-DLOCAL', '-Wall', '-Wextra', '-Wno-unused-result', '-lm'];

function getCompileCommand(sourceType: string): { compiler: string; flags: string[] } | null {
  const lower = sourceType.toLowerCase();
  if (lower.includes('cpp') || lower.includes('g++')) {
    let std = '-std=c++17';
    if (lower.includes('g++20') || lower.includes('c++20')) std = '-std=c++20';
    else if (lower.includes('g++23') || lower.includes('c++23')) std = '-std=c++23';
    return { compiler: 'g++', flags: ['-O2', std, ...CPP_FLAGS_BASE.slice(1)] };
  }
  return null;
}

function isJavaLanguage(sourceType: string): boolean {
  return sourceType.toLowerCase().includes('java');
}

/** Single-quote a string for safe embedding in a /bin/sh script. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Write an executable wrapper script at outputPath that runs `command`. */
function writeWrapper(outputPath: string, command: string): void {
  fs.writeFileSync(outputPath, `#!/bin/sh\n${command} "$@"\n`, { mode: 0o755 });
}

export function isInterpretedLanguage(sourceType: string): boolean {
  const lower = sourceType.toLowerCase();
  return lower.includes('python') || lower.includes('pypy');
}

export function getInterpreterCommand(sourceType: string): string | null {
  const lower = sourceType.toLowerCase();
  if (lower.includes('pypy')) return 'pypy3';
  if (lower.includes('python')) return 'python3';
  return null;
}

interface SpawnResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
  error?: Error;
}

function spawnAsync(
  cmd: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: Buffer;
    inputFile?: string;
    timeout?: number;
    maxOutputBytes?: number;
    memoryLimitKb?: number;
  }
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    // Enforce an address-space cap so a runaway program cannot OOM the host,
    // and lift the stack limit to the address-space limit. Competitive solutions
    // routinely rely on deep recursion / large local arrays and expect the stack
    // to be as large as the memory limit (as on Codeforces/Polygon); the default
    // 8 MB soft stack limit would otherwise SIGSEGV them (a false RE). The stack
    // can still never exceed the `ulimit -v` cap. Implemented via
    // `sh -c 'ulimit -s unlimited; ulimit -v "$1"; shift; exec "$@"'` — the
    // program and its args are passed as separate argv entries and run through
    // `exec "$@"`, so there is no shell word-splitting or injection.
    let realCmd = cmd;
    let realArgs = args;
    if (opts.memoryLimitKb && process.platform !== 'win32') {
      realCmd = '/bin/sh';
      realArgs = ['-c', 'ulimit -s unlimited 2>/dev/null || true; ulimit -v "$1"; shift; exec "$@"', 'memwrap', String(opts.memoryLimitKb), cmd, ...args];
    }

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(realCmd, realArgs, { cwd: opts.cwd, env: opts.env ?? process.env });
    } catch (err) {
      resolve({ status: null, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), timedOut: false, error: err as Error });
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let totalOut = 0;
    const maxOut = opts.maxOutputBytes ?? 64 * 1024 * 1024;
    let timedOut = false;
    let settled = false;

    const timer = opts.timeout
      ? setTimeout(() => {
          timedOut = true;
          try { proc.kill('SIGKILL'); } catch { /* already dead */ }
        }, opts.timeout)
      : null;

    const finish = (code: number | null, signal: NodeJS.Signals | null, err?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({
        status: code,
        signal,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        timedOut,
        error: err,
      });
    };

    proc.stdout?.on('data', (chunk: Buffer) => {
      if (totalOut < maxOut) { stdoutChunks.push(chunk); totalOut += chunk.length; }
    });
    proc.stderr?.on('data', (chunk: Buffer) => { stderrChunks.push(chunk); });
    proc.on('error', (err) => finish(null, null, err));
    proc.on('close', (code, signal) => finish(code, signal as NodeJS.Signals | null));

    // Suppress EPIPE — the process may exit before reading all stdin
    proc.stdin?.on('error', () => { /* ignore */ });

    if (opts.inputFile) {
      // Stream large inputs from disk instead of buffering them in memory.
      const rs = fs.createReadStream(opts.inputFile);
      rs.on('error', () => { try { proc.stdin?.end(); } catch { /* ignore */ } });
      rs.pipe(proc.stdin!);
    } else if (opts.input !== undefined) {
      proc.stdin?.end(opts.input);
    } else {
      proc.stdin?.end();
    }
  });
}

export async function compileSource(sourcePath: string, sourceType: string, outputPath: string): Promise<CompileResult> {
  // Interpreted languages (Python / PyPy): no compilation — emit a small
  // wrapper script that execs the interpreter on the source. Downstream code
  // can then run `outputPath` like any other binary.
  if (isInterpretedLanguage(sourceType)) {
    const interp = getInterpreterCommand(sourceType)!;
    writeWrapper(outputPath, `exec ${interp} ${shQuote(sourcePath)}`);
    return { success: true, binaryPath: outputPath, stderr: '', stdout: '' };
  }

  // Java: compile classes into a sibling dir, then wrap `java -cp <dir> <Main>`.
  if (isJavaLanguage(sourceType)) {
    const classDir = outputPath + '_classes';
    fs.mkdirSync(classDir, { recursive: true });
    const jr = await spawnAsync('javac', ['-encoding', 'UTF-8', '-d', classDir, sourcePath], {
      timeout: 60000, cwd: path.dirname(sourcePath), env: safeEnv(),
    });
    if (jr.error || jr.status !== 0) {
      return { success: false, binaryPath: '', stderr: jr.error?.message ?? jr.stderr.toString('utf-8'), stdout: '' };
    }
    const mainClass = path.basename(sourcePath, path.extname(sourcePath));
    writeWrapper(outputPath, `exec java -XX:+UseSerialGC -cp ${shQuote(classDir)} ${mainClass}`);
    return { success: true, binaryPath: outputPath, stderr: '', stdout: '' };
  }

  const cmd = getCompileCommand(sourceType);
  if (!cmd) {
    if (sourceType.startsWith('h.') || sourceType === '') {
      return { success: true, binaryPath: '', stderr: '', stdout: '' };
    }
    return { success: false, binaryPath: '', stderr: `Unsupported source type: ${sourceType}`, stdout: '' };
  }

  const args = [...cmd.flags, sourcePath, '-o', outputPath];
  const result = await spawnAsync(cmd.compiler, args, {
    timeout: 60000,
    cwd: path.dirname(sourcePath),
    env: safeEnv(),
  });

  if (result.error) {
    return { success: false, binaryPath: '', stderr: result.error.message, stdout: '' };
  }

  const success = result.status === 0 && fs.existsSync(outputPath);
  return {
    success,
    binaryPath: success ? outputPath : '',
    stderr: result.stderr.toString('utf-8'),
    stdout: result.stdout.toString('utf-8'),
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

export async function runBinary(binaryPath: string, options: RunOptions): Promise<RunResult> {
  const { timeLimitMs, memoryLimitBytes, stdin, stdinFile, stdoutFile, cwd, args = [], env } = options;

  const startTime = Date.now();
  // Prefer streaming the input file straight into the child's stdin; only fall
  // back to an in-memory buffer for the rare inline-string case. This avoids
  // loading multi-megabyte test inputs into memory for every parallel run.
  const useInputFile = stdinFile && fs.existsSync(stdinFile);
  const inputData = !useInputFile && stdin ? Buffer.from(stdin) : undefined;

  // Cap address space generously above the configured limit to stop a runaway
  // program from OOM-ing the host, without false-flagging normal solutions.
  const memoryLimitKb = memoryLimitBytes
    ? Math.floor(Math.max(memoryLimitBytes * 4, 512 * 1024 * 1024) / 1024)
    : undefined;

  const result = await spawnAsync(binaryPath, args, {
    input: inputData,
    inputFile: useInputFile ? stdinFile : undefined,
    timeout: timeLimitMs + 1000,
    cwd: cwd || path.dirname(binaryPath),
    env: safeEnv(env),
    maxOutputBytes: 64 * 1024 * 1024,
    memoryLimitKb,
  });

  const timeMs = Date.now() - startTime;

  let stdout = '';
  let stderr = '';
  try {
    stdout = result.stdout.toString('utf-8');
    stderr = result.stderr.toString('utf-8');
  } catch { /* ignore decode errors */ }

  if (stdoutFile && result.stdout.length > 0) {
    fs.mkdirSync(path.dirname(stdoutFile), { recursive: true });
    fs.writeFileSync(stdoutFile, result.stdout);
  }

  if (result.timedOut || timeMs >= timeLimitMs) {
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

export async function runChecker(
  checkerBinary: string,
  inputFile: string,
  outputFile: string,
  answerFile: string,
  cwd?: string
): Promise<{ verdict: string; comment: string }> {
  const result = await spawnAsync(checkerBinary, [inputFile, outputFile, answerFile], {
    timeout: 30000,
    cwd: cwd || path.dirname(checkerBinary),
    env: safeEnv(),
  });

  const exitCode = result.status ?? -1;
  const comment = (result.stderr.toString('utf-8') || result.stdout.toString('utf-8')).trim().slice(0, 500);

  if (result.error) return { verdict: 'CRASHED', comment: result.error.message };
  if (exitCode === 0) return { verdict: 'OK', comment };
  if (exitCode === 1) return { verdict: 'WRONG_ANSWER', comment };
  if (exitCode === 2) return { verdict: 'PRESENTATION_ERROR', comment };
  if (exitCode === 3) return { verdict: 'PARTIAL', comment };
  return { verdict: 'CRASHED', comment };
}

export async function runValidator(
  validatorBinary: string,
  inputFile: string,
  testset?: string,
  group?: string
): Promise<{ valid: boolean; comment: string }> {
  const args: string[] = [];
  if (testset) args.push('--testset', testset);
  if (group) args.push('--group', group);

  const result = await spawnAsync(validatorBinary, args, {
    inputFile,
    timeout: 30000,
    cwd: path.dirname(validatorBinary),
    env: safeEnv(),
  });

  const exitCode = result.status ?? -1;
  const comment = (result.stderr.toString('utf-8') || result.stdout.toString('utf-8')).trim().slice(0, 500);

  if (result.error) return { valid: false, comment: result.error.message };
  return { valid: exitCode === 0, comment };
}

export function isCompilable(sourceType: string): boolean {
  return getCompileCommand(sourceType) !== null
    || isJavaLanguage(sourceType)
    || isInterpretedLanguage(sourceType);
}
