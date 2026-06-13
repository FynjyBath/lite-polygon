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
// Map Polygon source types to local compiler commands
const CPP_FLAGS_BASE = [
    '-O2', '-std=c++17', '-DLOCAL',
    '-Wall', '-Wextra', '-Wno-unused-result',
];
function getCompileCommand(sourceType) {
    const lower = sourceType.toLowerCase();
    if (lower.includes('cpp') || lower.includes('g++')) {
        let std = '-std=c++17';
        if (lower.includes('g++20') || lower.includes('c++20'))
            std = '-std=c++20';
        else if (lower.includes('g++23') || lower.includes('c++23'))
            std = '-std=c++23';
        return {
            compiler: 'g++',
            flags: ['-O2', std, '-DLOCAL', '-Wall', '-Wextra', '-Wno-unused-result', '-lm'],
        };
    }
    return null;
}
function compileSource(sourcePath, sourceType, outputPath) {
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
    const result = (0, child_process_1.spawnSync)(cmd.compiler, args, {
        timeout: 60000,
        encoding: 'utf-8',
        cwd: path_1.default.dirname(sourcePath),
    });
    if (result.error) {
        return { success: false, binaryPath: '', stderr: result.error.message, stdout: '' };
    }
    const success = result.status === 0 && fs_1.default.existsSync(outputPath);
    return {
        success,
        binaryPath: success ? outputPath : '',
        stderr: result.stderr ?? '',
        stdout: result.stdout ?? '',
    };
}
function runBinary(binaryPath, options) {
    const { timeLimitMs, stdin, stdinFile, stdoutFile, cwd, args = [], env } = options;
    const startTime = Date.now();
    const spawnArgs = args;
    const inputData = stdinFile && fs_1.default.existsSync(stdinFile)
        ? fs_1.default.readFileSync(stdinFile)
        : stdin
            ? Buffer.from(stdin)
            : undefined;
    const result = (0, child_process_1.spawnSync)(binaryPath, spawnArgs, {
        input: inputData,
        timeout: timeLimitMs + 1000, // grace period
        maxBuffer: 64 * 1024 * 1024, // 64MB output buffer
        cwd: cwd || path_1.default.dirname(binaryPath),
        encoding: 'buffer',
        env: { ...process.env, ...env },
    });
    const timeMs = Date.now() - startTime;
    let stdout = '';
    let stderr = '';
    try {
        stdout = result.stdout ? result.stdout.toString('utf-8') : '';
        stderr = result.stderr ? result.stderr.toString('utf-8') : '';
    }
    catch {
        stdout = '';
        stderr = '';
    }
    if (stdoutFile && result.stdout) {
        fs_1.default.mkdirSync(path_1.default.dirname(stdoutFile), { recursive: true });
        fs_1.default.writeFileSync(stdoutFile, result.stdout);
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
function runChecker(checkerBinary, inputFile, outputFile, answerFile, cwd) {
    const result = (0, child_process_1.spawnSync)(checkerBinary, [inputFile, outputFile, answerFile], {
        timeout: 30000,
        encoding: 'utf-8',
        cwd: cwd || path_1.default.dirname(checkerBinary),
    });
    const exitCode = result.status ?? -1;
    const comment = (result.stderr || result.stdout || '').trim().slice(0, 500);
    if (result.error)
        return { verdict: 'CRASHED', comment: result.error.message };
    if (exitCode === 0)
        return { verdict: 'OK', comment };
    if (exitCode === 1)
        return { verdict: 'WRONG_ANSWER', comment };
    if (exitCode === 2)
        return { verdict: 'PRESENTATION_ERROR', comment };
    if (exitCode === 3) {
        // checker error / points
        return { verdict: 'PARTIAL', comment };
    }
    return { verdict: 'CRASHED', comment };
}
function runValidator(validatorBinary, inputFile, testset, group) {
    const args = [];
    if (testset) {
        args.push('--testset', testset);
    }
    if (group) {
        args.push('--group', group);
    }
    const result = (0, child_process_1.spawnSync)(validatorBinary, args, {
        input: fs_1.default.readFileSync(inputFile),
        timeout: 30000,
        encoding: 'utf-8',
        cwd: path_1.default.dirname(validatorBinary),
    });
    const exitCode = result.status ?? -1;
    const comment = (result.stderr || result.stdout || '').trim().slice(0, 500);
    if (result.error)
        return { valid: false, comment: result.error.message };
    return { valid: exitCode === 0, comment };
}
function isCompilable(sourceType) {
    return getCompileCommand(sourceType) !== null;
}
