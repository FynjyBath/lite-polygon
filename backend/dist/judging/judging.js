"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.compileSolution = compileSolution;
exports.compileAsset = compileAsset;
exports.generateTestInput = generateTestInput;
exports.generateTestAnswer = generateTestAnswer;
exports.runInvocation = runInvocation;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const schema_1 = require("../db/schema");
const problems_1 = require("../services/problems");
const compiler_1 = require("./compiler");
async function compileSolution(problemId, solutionId) {
    const solution = (0, problems_1.getSolution)(solutionId);
    if (!solution || solution.problem_id !== problemId) {
        return { success: false, error: 'Solution not found' };
    }
    const problemDir = (0, schema_1.getProblemDir)(problemId);
    const sourcePath = path_1.default.join(problemDir, solution.source_path);
    if (!fs_1.default.existsSync(sourcePath)) {
        return { success: false, error: `Source file not found: ${solution.source_path}` };
    }
    const workdir = path_1.default.join(problemDir, 'workdir');
    fs_1.default.mkdirSync(workdir, { recursive: true });
    const binaryName = path_1.default.basename(solution.source_path, path_1.default.extname(solution.source_path));
    const outputPath = path_1.default.join(workdir, `sol_${solutionId}_${binaryName}`);
    const result = await (0, compiler_1.compileSource)(sourcePath, solution.source_type, outputPath);
    if (result.success) {
        schema_1.db.prepare('UPDATE solutions SET compiled_binary = ? WHERE id = ?').run(outputPath, solutionId);
        return { success: true, error: '' };
    }
    return { success: false, error: result.stderr };
}
async function compileAsset(problemId, assetType) {
    const asset = (0, problems_1.getAsset)(problemId, assetType);
    if (!asset || !asset.source_path) {
        return { success: false, error: `Asset ${assetType} not found or no source` };
    }
    const problemDir = (0, schema_1.getProblemDir)(problemId);
    const sourcePath = path_1.default.join(problemDir, asset.source_path);
    if (!fs_1.default.existsSync(sourcePath)) {
        return { success: false, error: `Source not found: ${asset.source_path}` };
    }
    if (!(0, compiler_1.isCompilable)(asset.source_type)) {
        return { success: false, error: `Unsupported source type: ${asset.source_type}` };
    }
    const workdir = path_1.default.join(problemDir, 'workdir');
    fs_1.default.mkdirSync(workdir, { recursive: true });
    const outputPath = path_1.default.join(workdir, `${assetType}_${problemId}`);
    const result = await (0, compiler_1.compileSource)(sourcePath, asset.source_type, outputPath);
    if (result.success) {
        schema_1.db.prepare('UPDATE assets SET compiled_binary = ? WHERE problem_id = ? AND asset_type = ?')
            .run(outputPath, problemId, assetType);
        return { success: true, error: '' };
    }
    return { success: false, error: result.stderr };
}
async function generateTestInput(problemId, testsetId, testIdx) {
    const test = schema_1.db.prepare('SELECT * FROM tests WHERE testset_id = ? AND idx = ?').get(testsetId, testIdx);
    if (!test)
        return { success: false, inputPath: '', error: 'Test not found' };
    if (test.method !== 'generated' || !test.cmd) {
        return { success: false, inputPath: '', error: 'Not a generated test' };
    }
    const problemDir = (0, schema_1.getProblemDir)(problemId);
    const workdir = path_1.default.join(problemDir, 'workdir', 'gen');
    fs_1.default.mkdirSync(workdir, { recursive: true });
    // Parse command: first word is generator name, rest are args
    const parts = test.cmd.split(/\s+/);
    const genName = parts[0];
    const genArgs = parts.slice(1);
    // Find generator binary
    const execs = schema_1.db.prepare('SELECT * FROM executables WHERE problem_id = ?').all(problemId);
    const problemFiles = schema_1.db.prepare('SELECT * FROM problem_files WHERE problem_id = ?').all(problemId);
    // Try to find compiled generator
    let genBinary = '';
    for (const e of execs) {
        if (e.source_path && path_1.default.basename(e.source_path, path_1.default.extname(e.source_path)) === genName) {
            // Check if compiled
            const compiledKey = `gen_${problemId}_${genName}`;
            const workBinary = path_1.default.join(problemDir, 'workdir', compiledKey);
            if (!fs_1.default.existsSync(workBinary)) {
                const srcPath = path_1.default.join(problemDir, e.source_path);
                if (fs_1.default.existsSync(srcPath)) {
                    const cr = await (0, compiler_1.compileSource)(srcPath, e.source_type, workBinary);
                    if (cr.success)
                        genBinary = workBinary;
                }
            }
            else {
                genBinary = workBinary;
            }
            break;
        }
    }
    if (!genBinary || !fs_1.default.existsSync(genBinary)) {
        return { success: false, inputPath: '', error: `Generator '${genName}' not found or failed to compile` };
    }
    const inputPath = path_1.default.join(workdir, `test_${testIdx}.in`);
    const result = await (0, compiler_1.runBinary)(genBinary, {
        timeLimitMs: 30000,
        args: genArgs,
        cwd: path_1.default.join(problemDir, 'files'),
        stdoutFile: inputPath,
    });
    if (result.verdict !== 'OK') {
        return { success: false, inputPath: '', error: `Generator failed: ${result.verdict} - ${result.stderr}` };
    }
    return { success: true, inputPath, error: '' };
}
async function generateTestAnswer(problemId, inputPath, timeLimitMs, memoryLimitBytes, outputPath) {
    const mainSolution = schema_1.db.prepare("SELECT * FROM solutions WHERE problem_id = ? AND tag = 'main' LIMIT 1").get(problemId);
    if (!mainSolution)
        return { success: false, answerPath: '', error: 'No main solution found' };
    let binary = mainSolution.compiled_binary;
    if (!binary || !fs_1.default.existsSync(binary)) {
        const r = await compileSolution(problemId, mainSolution.id);
        if (!r.success)
            return { success: false, answerPath: '', error: `Compile failed: ${r.error}` };
        const updated = schema_1.db.prepare('SELECT compiled_binary FROM solutions WHERE id = ?').get(mainSolution.id);
        binary = updated.compiled_binary;
    }
    const answerPath = outputPath ?? (inputPath + '.out');
    const problemDir = (0, schema_1.getProblemDir)(problemId);
    fs_1.default.mkdirSync(path_1.default.dirname(answerPath), { recursive: true });
    const result = await (0, compiler_1.runBinary)(binary, {
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
async function runInvocation(problemId, invocationId, solutionIds, testsetName) {
    schema_1.db.prepare("UPDATE invocations SET state = 'RUNNING' WHERE id = ?").run(invocationId);
    try {
        const problemDir = (0, schema_1.getProblemDir)(problemId);
        const testset = (0, problems_1.getTestset)(problemId, testsetName);
        if (!testset) {
            schema_1.db.prepare("UPDATE invocations SET state = 'FAILED' WHERE id = ?").run(invocationId);
            return;
        }
        const timeLimitMs = testset.time_limit ?? 1000;
        const memLimitBytes = testset.memory_limit ?? 268435456;
        const tests = (0, problems_1.listTests)(testset.id);
        // Compile checker
        const checker = (0, problems_1.getAsset)(problemId, 'checker');
        let checkerBinary = checker?.compiled_binary || '';
        if (checker && checker.source_path && (!checkerBinary || !fs_1.default.existsSync(checkerBinary))) {
            const cr = await compileAsset(problemId, 'checker');
            if (cr.success) {
                const updated = (0, problems_1.getAsset)(problemId, 'checker');
                checkerBinary = updated?.compiled_binary || '';
            }
        }
        for (const solId of solutionIds) {
            const solution = (0, problems_1.getSolution)(solId);
            if (!solution || solution.problem_id !== problemId)
                continue;
            // Compile solution if needed
            let binary = solution.compiled_binary;
            if (!binary || !fs_1.default.existsSync(binary)) {
                const cr = await compileSolution(problemId, solId);
                if (!cr.success) {
                    // Record compile error for all tests
                    for (const t of tests) {
                        schema_1.db.prepare('INSERT INTO invocation_runs (invocation_id, solution_id, test_idx, verdict, time_ms, memory_bytes, exit_code, stderr_preview, stdout_preview, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(invocationId, solId, t.idx, 'CE', 0, 0, 1, cr.error.slice(0, 500), '', 0);
                    }
                    continue;
                }
                const updated = (0, problems_1.getSolution)(solId);
                binary = updated.compiled_binary;
            }
            if (!binary || !fs_1.default.existsSync(binary)) {
                for (const t of tests) {
                    schema_1.db.prepare('INSERT INTO invocation_runs (invocation_id, solution_id, test_idx, verdict, time_ms, memory_bytes, exit_code, stderr_preview, stdout_preview, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(invocationId, solId, t.idx, 'CE', 0, 0, 1, 'Binary not found', '', 0);
                }
                continue;
            }
            for (const t of tests) {
                const inputPathPattern = testset.input_path_pattern;
                const answerPathPattern = testset.answer_path_pattern;
                const testNum = String(t.idx).padStart(2, '0');
                const inputFile = path_1.default.join(problemDir, inputPathPattern.replace('%02d', testNum));
                const answerFile = path_1.default.join(problemDir, answerPathPattern.replace('%02d', testNum));
                if (!fs_1.default.existsSync(inputFile)) {
                    // Try generating
                    if (t.method === 'generated' && t.cmd) {
                        const genResult = await generateTestInput(problemId, testset.id, t.idx);
                        if (genResult.success) {
                            fs_1.default.copyFileSync(genResult.inputPath, inputFile);
                        }
                        else {
                            schema_1.db.prepare('INSERT INTO invocation_runs (invocation_id, solution_id, test_idx, verdict, time_ms, memory_bytes, exit_code, stderr_preview, stdout_preview, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(invocationId, solId, t.idx, 'SKIPPED', 0, 0, 0, 'Input not available', '', 0);
                            continue;
                        }
                    }
                    else {
                        schema_1.db.prepare('INSERT INTO invocation_runs (invocation_id, solution_id, test_idx, verdict, time_ms, memory_bytes, exit_code, stderr_preview, stdout_preview, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(invocationId, solId, t.idx, 'SKIPPED', 0, 0, 0, 'Input file missing', '', 0);
                        continue;
                    }
                }
                const outputFile = path_1.default.join(problemDir, 'workdir', `inv_${invocationId}_sol_${solId}_test_${t.idx}.out`);
                fs_1.default.mkdirSync(path_1.default.dirname(outputFile), { recursive: true });
                const runResult = await (0, compiler_1.runBinary)(binary, {
                    timeLimitMs,
                    stdinFile: inputFile,
                    stdoutFile: outputFile,
                    cwd: problemDir,
                });
                let verdict = runResult.verdict;
                let checkerComment = '';
                if (verdict === 'OK' && checkerBinary && fs_1.default.existsSync(checkerBinary)) {
                    // Generate answer if missing
                    if (!fs_1.default.existsSync(answerFile)) {
                        const genAns = await generateTestAnswer(problemId, inputFile, timeLimitMs, memLimitBytes);
                        if (genAns.success)
                            fs_1.default.copyFileSync(genAns.answerPath, answerFile);
                    }
                    if (fs_1.default.existsSync(answerFile)) {
                        const checkerResult = await (0, compiler_1.runChecker)(checkerBinary, inputFile, outputFile, answerFile, problemDir);
                        verdict = checkerResult.verdict;
                        checkerComment = checkerResult.comment;
                    }
                    else {
                        checkerComment = 'Answer file missing';
                    }
                }
                if (verdict === 'TLE') {
                    if (runResult.timeMs < timeLimitMs)
                        verdict = 'RE';
                    else
                        verdict = 'TL';
                }
                schema_1.db.prepare('INSERT INTO invocation_runs (invocation_id, solution_id, test_idx, verdict, time_ms, memory_bytes, exit_code, stderr_preview, stdout_preview, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(invocationId, solId, t.idx, verdict, runResult.timeMs, 0, runResult.exitCode, (runResult.stderr + '\n' + checkerComment).trim().slice(0, 500), runResult.stdout.slice(0, 200), 0);
            }
        }
        schema_1.db.prepare("UPDATE invocations SET state = 'DONE' WHERE id = ?").run(invocationId);
    }
    catch (e) {
        schema_1.db.prepare("UPDATE invocations SET state = 'FAILED' WHERE id = ?").run(invocationId);
        throw e;
    }
}
