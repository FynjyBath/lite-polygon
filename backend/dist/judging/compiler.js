"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.compileSource = compileSource;
exports.runBinary = runBinary;
exports.runChecker = runChecker;
exports.runValidator = runValidator;
exports.isCompilable = isCompilable;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const CPP_FLAGS_BASE = ['-O2', '-DLOCAL', '-Wall', '-Wextra', '-Wno-unused-result', '-lm'];
function getCompileCommand(sourceType) {
    const lower = sourceType.toLowerCase();
    if (lower.includes('cpp') || lower.includes('g++')) {
        let std = '-std=c++17';
        if (lower.includes('g++20') || lower.includes('c++20'))
            std = '-std=c++20';
        else if (lower.includes('g++23') || lower.includes('c++23'))
            std = '-std=c++23';
        return { compiler: 'g++', flags: ['-O2', std, ...CPP_FLAGS_BASE.slice(1)] };
    }
    return null;
}
function spawnAsync(cmd, args, opts) {
    return new Promise((resolve) => {
        let proc;
        try {
            proc = (0, child_process_1.spawn)(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env });
        }
        catch (err) {
            resolve({ status: null, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), timedOut: false, error: err });
            return;
        }
        const stdoutChunks = [];
        const stderrChunks = [];
        let totalOut = 0;
        const maxOut = opts.maxOutputBytes ?? 64 * 1024 * 1024;
        let timedOut = false;
        let settled = false;
        const timer = opts.timeout
            ? setTimeout(() => {
                timedOut = true;
                try {
                    proc.kill('SIGKILL');
                }
                catch { /* already dead */ }
            }, opts.timeout)
            : null;
        const finish = (code, signal, err) => {
            if (settled)
                return;
            settled = true;
            if (timer)
                clearTimeout(timer);
            resolve({
                status: code,
                signal,
                stdout: Buffer.concat(stdoutChunks),
                stderr: Buffer.concat(stderrChunks),
                timedOut,
                error: err,
            });
        };
        proc.stdout?.on('data', (chunk) => {
            if (totalOut < maxOut) {
                stdoutChunks.push(chunk);
                totalOut += chunk.length;
            }
        });
        proc.stderr?.on('data', (chunk) => { stderrChunks.push(chunk); });
        proc.on('error', (err) => finish(null, null, err));
        proc.on('close', (code, signal) => finish(code, signal));
        // Suppress EPIPE — the process may exit before reading all stdin
        proc.stdin?.on('error', () => { });
        if (opts.input !== undefined) {
            proc.stdin?.end(opts.input);
        }
        else {
            proc.stdin?.end();
        }
    });
}
async function compileSource(sourcePath, sourceType, outputPath) {
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
        cwd: path_1.default.dirname(sourcePath),
    });
    if (result.error) {
        return { success: false, binaryPath: '', stderr: result.error.message, stdout: '' };
    }
    const success = result.status === 0 && fs_1.default.existsSync(outputPath);
    return {
        success,
        binaryPath: success ? outputPath : '',
        stderr: result.stderr.toString('utf-8'),
        stdout: result.stdout.toString('utf-8'),
    };
}
async function runBinary(binaryPath, options) {
    const { timeLimitMs, stdin, stdinFile, stdoutFile, cwd, args = [], env } = options;
    const startTime = Date.now();
    const inputData = stdinFile && fs_1.default.existsSync(stdinFile)
        ? fs_1.default.readFileSync(stdinFile)
        : stdin
            ? Buffer.from(stdin)
            : undefined;
    const result = await spawnAsync(binaryPath, args, {
        input: inputData,
        timeout: timeLimitMs + 1000,
        cwd: cwd || path_1.default.dirname(binaryPath),
        env: env ? { ...process.env, ...env } : process.env,
        maxOutputBytes: 64 * 1024 * 1024,
    });
    const timeMs = Date.now() - startTime;
    let stdout = '';
    let stderr = '';
    try {
        stdout = result.stdout.toString('utf-8');
        stderr = result.stderr.toString('utf-8');
    }
    catch { /* ignore decode errors */ }
    if (stdoutFile && result.stdout.length > 0) {
        fs_1.default.mkdirSync(path_1.default.dirname(stdoutFile), { recursive: true });
        fs_1.default.writeFileSync(stdoutFile, result.stdout);
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
async function runChecker(checkerBinary, inputFile, outputFile, answerFile, cwd) {
    const result = await spawnAsync(checkerBinary, [inputFile, outputFile, answerFile], {
        timeout: 30000,
        cwd: cwd || path_1.default.dirname(checkerBinary),
    });
    const exitCode = result.status ?? -1;
    const comment = (result.stderr.toString('utf-8') || result.stdout.toString('utf-8')).trim().slice(0, 500);
    if (result.error)
        return { verdict: 'CRASHED', comment: result.error.message };
    if (exitCode === 0)
        return { verdict: 'OK', comment };
    if (exitCode === 1)
        return { verdict: 'WRONG_ANSWER', comment };
    if (exitCode === 2)
        return { verdict: 'PRESENTATION_ERROR', comment };
    if (exitCode === 3)
        return { verdict: 'PARTIAL', comment };
    return { verdict: 'CRASHED', comment };
}
async function runValidator(validatorBinary, inputFile, testset, group) {
    const args = [];
    if (testset)
        args.push('--testset', testset);
    if (group)
        args.push('--group', group);
    const result = await spawnAsync(validatorBinary, args, {
        input: fs_1.default.readFileSync(inputFile),
        timeout: 30000,
        cwd: path_1.default.dirname(validatorBinary),
    });
    const exitCode = result.status ?? -1;
    const comment = (result.stderr.toString('utf-8') || result.stdout.toString('utf-8')).trim().slice(0, 500);
    if (result.error)
        return { valid: false, comment: result.error.message };
    return { valid: exitCode === 0, comment };
}
function isCompilable(sourceType) {
    return getCompileCommand(sourceType) !== null;
}
