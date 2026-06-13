"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPackage = buildPackage;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const schema_1 = require("../db/schema");
const problems_1 = require("../services/problems");
const generator_1 = require("../polygon-xml/generator");
const judging_1 = require("../judging/judging");
async function buildPackage(problemId, packageId, options) {
    schema_1.db.prepare("UPDATE packages SET state = 'RUNNING' WHERE id = ?").run(packageId);
    try {
        const problemDir = (0, schema_1.getProblemDir)(problemId);
        const packagesDir = (0, schema_1.getPackagesDir)();
        fs_1.default.mkdirSync(packagesDir, { recursive: true });
        const problem = (0, problems_1.getProblem)(problemId);
        if (!problem)
            throw new Error('Problem not found');
        const outputPath = path_1.default.join(packagesDir, `${packageId}_${problem.short_name}$${options.type}.zip`);
        const tmpDir = path_1.default.join(packagesDir, `build_${packageId}`);
        fs_1.default.mkdirSync(tmpDir, { recursive: true });
        try {
            await assemblePackage(problemId, tmpDir, options.type, problem);
            createZipFromDir(tmpDir, outputPath);
            schema_1.db.prepare("UPDATE packages SET state = 'READY', file_path = ? WHERE id = ?").run(outputPath, packageId);
        }
        finally {
            fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
        }
    }
    catch (e) {
        schema_1.db.prepare("UPDATE packages SET state = 'FAILED' WHERE id = ?").run(packageId);
        throw e;
    }
}
async function assemblePackage(problemId, destDir, type, problem) {
    if (!problem)
        throw new Error('Problem is null');
    const problemDir = (0, schema_1.getProblemDir)(problemId);
    // Copy all problem files to destDir
    copyAllFiles(problemDir, destDir, type);
    // For linux/windows packages, generate all tests
    const testset = (0, problems_1.getTestset)(problemId, 'tests');
    if (testset && (type === 'linux' || type === 'windows')) {
        const tests = (0, problems_1.listTests)(testset.id);
        const inputPattern = testset.input_path_pattern;
        const answerPattern = testset.answer_path_pattern;
        const timeLimitMs = testset.time_limit ?? problem.time_limit;
        const memLimitBytes = testset.memory_limit ?? problem.memory_limit;
        for (const t of tests) {
            const testNum = String(t.idx).padStart(2, '0');
            const inputDest = path_1.default.join(destDir, inputPattern.replace('%02d', testNum));
            const answerDest = path_1.default.join(destDir, answerPattern.replace('%02d', testNum));
            // Input
            if (!fs_1.default.existsSync(inputDest)) {
                if (t.method === 'generated' && t.cmd) {
                    const genResult = await (0, judging_1.generateTestInput)(problemId, testset.id, t.idx);
                    if (genResult.success) {
                        fs_1.default.mkdirSync(path_1.default.dirname(inputDest), { recursive: true });
                        fs_1.default.copyFileSync(genResult.inputPath, inputDest);
                    }
                }
            }
            // Answer
            if (!fs_1.default.existsSync(answerDest) && fs_1.default.existsSync(inputDest)) {
                const genAns = await (0, judging_1.generateTestAnswer)(problemId, inputDest, timeLimitMs, memLimitBytes);
                if (genAns.success) {
                    fs_1.default.mkdirSync(path_1.default.dirname(answerDest), { recursive: true });
                    fs_1.default.copyFileSync(genAns.answerPath, answerDest);
                }
            }
        }
    }
    // Generate problem.xml
    const model = buildProblemXmlModel(problemId, problem, type);
    const xmlContent = (0, generator_1.generateProblemXml)(model);
    fs_1.default.writeFileSync(path_1.default.join(destDir, 'problem.xml'), xmlContent, 'utf-8');
    // Generate tags file
    const tags = (0, problems_1.listTags)(problemId);
    if (tags.length > 0) {
        fs_1.default.writeFileSync(path_1.default.join(destDir, 'tags'), tags.join('\n') + '\n', 'utf-8');
    }
    // For standard/linux: compile checker to local binary
    const checker = (0, problems_1.getAsset)(problemId, 'checker');
    if (checker && checker.source_path) {
        const compileResult = await (0, judging_1.compileAsset)(problemId, 'checker');
        if (compileResult.success) {
            const updatedChecker = (0, problems_1.getAsset)(problemId, 'checker');
            if (updatedChecker.compiled_binary && fs_1.default.existsSync(updatedChecker.compiled_binary)) {
                const copyDest = checker.copy_path ? path_1.default.join(destDir, checker.copy_path) : path_1.default.join(destDir, 'check');
                fs_1.default.mkdirSync(path_1.default.dirname(copyDest), { recursive: true });
                if (type === 'linux') {
                    fs_1.default.copyFileSync(updatedChecker.compiled_binary, copyDest);
                }
            }
        }
    }
    // Generate scripts if they don't exist
    generateScripts(destDir, problemId);
}
function copyAllFiles(sourceDir, destDir, type) {
    if (!fs_1.default.existsSync(sourceDir))
        return;
    const skipForLinux = new Set(['.exe', '.bat']);
    const skipForStandard = new Set();
    function copyRec(src, dst, relPath) {
        const stat = fs_1.default.statSync(src);
        if (stat.isDirectory()) {
            // Skip workdir
            if (path_1.default.basename(src) === 'workdir')
                return;
            fs_1.default.mkdirSync(dst, { recursive: true });
            for (const e of fs_1.default.readdirSync(src)) {
                copyRec(path_1.default.join(src, e), path_1.default.join(dst, e), relPath ? `${relPath}/${e}` : e);
            }
        }
        else {
            const ext = path_1.default.extname(src).toLowerCase();
            if (type === 'linux' && skipForLinux.has(ext))
                return;
            fs_1.default.mkdirSync(path_1.default.dirname(dst), { recursive: true });
            fs_1.default.copyFileSync(src, dst);
        }
    }
    copyRec(sourceDir, destDir, '');
}
function generateScripts(destDir, problemId) {
    const scriptsDir = path_1.default.join(destDir, 'scripts');
    fs_1.default.mkdirSync(scriptsDir, { recursive: true });
    const scriptNames = [
        'gen-input-via-stdout', 'gen-input-via-file', 'gen-input-via-files',
        'gen-answer', 'run-checker-tests', 'run-validator-tests',
    ];
    for (const name of scriptNames) {
        const sh = path_1.default.join(scriptsDir, `${name}.sh`);
        const bat = path_1.default.join(scriptsDir, `${name}.bat`);
        if (!fs_1.default.existsSync(sh)) {
            fs_1.default.writeFileSync(sh, `#!/bin/bash\n# ${name}\n`, 'utf-8');
        }
        if (!fs_1.default.existsSync(bat)) {
            fs_1.default.writeFileSync(bat, `@echo off\nREM ${name}\n`, 'utf-8');
        }
    }
}
function buildProblemXmlModel(problemId, problem, type) {
    const names = (0, problems_1.getProblemNames)(problemId).map(n => ({ language: n.language, value: n.value }));
    const tags = (0, problems_1.listTags)(problemId);
    const properties = (0, problems_1.listProperties)(problemId);
    const stmts = (0, problems_1.listStatements)(problemId);
    const solutions = (0, problems_1.listSolutions)(problemId);
    const testset = (0, problems_1.getTestset)(problemId, 'tests');
    const tests = testset ? (0, problems_1.listTests)(testset.id) : [];
    const groups = testset ? (0, problems_1.getTestGroups)(testset.id) : [];
    const testsetModel = testset ? {
        name: 'tests',
        timeLimit: testset.time_limit ?? problem.time_limit,
        memoryLimit: testset.memory_limit ?? problem.memory_limit,
        testCount: tests.length,
        inputPathPattern: testset.input_path_pattern,
        answerPathPattern: testset.answer_path_pattern,
        tests: tests.map(t => ({
            method: t.method,
            cmd: t.cmd || undefined,
            description: t.description || undefined,
            sample: t.sample === 1 ? true : undefined,
            group: t.group_name || undefined,
            points: t.points > 0 ? t.points : undefined,
            _extraAttrs: JSON.parse(t.extra_attrs || '{}'),
        })),
        groups: groups.map(g => ({
            name: g.name,
            points: g.points,
            pointsPolicy: g.points_policy,
            feedbackPolicy: g.feedback_policy,
            dependencies: (0, problems_1.getGroupDependencies)(g.id),
            _extraAttrs: JSON.parse(g.extra_attrs || '{}'),
        })),
    } : {
        name: 'tests',
        timeLimit: problem.time_limit,
        memoryLimit: problem.memory_limit,
        testCount: 0,
        inputPathPattern: 'tests/%02d',
        answerPathPattern: 'tests/%02d.a',
        tests: [],
        groups: [],
    };
    const checker = (0, problems_1.getAsset)(problemId, 'checker');
    const validator = (0, problems_1.getAsset)(problemId, 'validator');
    const interactor = (0, problems_1.getAsset)(problemId, 'interactor');
    const binaryExt = type === 'windows' ? '.exe' : '';
    const binaryType = type === 'windows' ? 'exe.win32' : '';
    const execsList = (0, problems_1.listExecutables)(problemId);
    const filesList = (0, problems_1.listFiles)(problemId);
    const resources = filesList.filter(f => f.file_role === 'resource').map(f => ({
        path: f.path,
        type: f.source_type || undefined,
        forTypes: f.for_types || undefined,
        stages: f.stages || undefined,
        assets: f.assets_attr || undefined,
        main: f.is_main ? 'true' : undefined,
        _extraAttrs: JSON.parse(f.extra_attrs || '{}'),
    }));
    const executables = execsList.map(e => ({
        source: e.source_path ? { path: e.source_path, type: e.source_type } : undefined,
        binary: e.binary_path ? { path: e.binary_path, type: e.binary_type } : undefined,
    }));
    // Build statements list
    const statements = stmts.flatMap(s => {
        const texPath = `statements/${s.language}/problem.tex`;
        const htmlPath = `statements/.html/${s.language}/problem.html`;
        const pdfPath = `statements/.pdf/${s.language}/problem.pdf`;
        const entries = [];
        entries.push({ language: s.language, path: texPath, type: 'application/x-tex', charset: 'UTF-8', mathjax: 'true' });
        entries.push({ language: s.language, path: pdfPath, type: 'application/pdf' });
        return entries;
    });
    const tutorials = stmts.flatMap(s => {
        const texPath = `statements/${s.language}/tutorial.tex`;
        const pdfPath = `statements/.pdf/${s.language}/tutorial.pdf`;
        return [
            { language: s.language, path: texPath, type: 'application/x-tex', charset: 'UTF-8', mathjax: 'true' },
            { language: s.language, path: pdfPath, type: 'application/pdf' },
        ];
    });
    return {
        revision: String(problem.revision),
        shortName: problem.short_name,
        url: problem.polygon_url || undefined,
        names,
        statements,
        tutorials,
        judging: {
            inputFile: problem.input_file,
            outputFile: problem.output_file,
            runCount: problem.run_count,
            cpuName: problem.cpu_name || undefined,
            cpuSpeed: problem.cpu_speed || undefined,
            testsets: [testsetModel],
        },
        files: { resources, executables },
        assets: {
            checker: checker ? {
                name: checker.name || undefined,
                type: checker.checker_type || 'testlib',
                source: checker.source_path ? { path: checker.source_path, type: checker.source_type } : undefined,
                binary: checker.binary_path ? { path: checker.binary_path, type: checker.binary_type } : undefined,
                copy: checker.copy_path ? { path: checker.copy_path, type: checker.copy_type || undefined } : undefined,
                testset: {
                    testCount: 0,
                    inputPathPattern: 'files/tests/checker-tests/%02d',
                    outputPathPattern: 'files/tests/checker-tests/%02d.o',
                    answerPathPattern: 'files/tests/checker-tests/%02d.a',
                    tests: [],
                },
            } : undefined,
            validators: validator ? [{
                    source: validator.source_path ? { path: validator.source_path, type: validator.source_type } : undefined,
                    binary: validator.binary_path ? { path: validator.binary_path, type: validator.binary_type } : undefined,
                    testset: {
                        testCount: 0,
                        inputPathPattern: 'files/tests/validator-tests/%02d',
                        tests: [],
                    },
                }] : [],
            interactor: interactor ? {
                source: interactor.source_path ? { path: interactor.source_path, type: interactor.source_type } : undefined,
                binary: interactor.binary_path ? { path: interactor.binary_path, type: interactor.binary_type } : undefined,
            } : undefined,
            solutions: solutions.map(s => ({
                tag: s.tag,
                source: s.source_path ? { path: s.source_path, type: s.source_type } : undefined,
                binary: s.binary_path ? { path: s.binary_path, type: s.binary_type } : undefined,
            })),
        },
        properties: properties,
        stresses: {
            stressCount: 0,
            stressPathPattern: 'stresses/%03d',
            list: [],
        },
        tags,
    };
}
function createZipFromDir(sourceDir, outputPath) {
    const zip = new adm_zip_1.default();
    function addDir(dirPath, zipPath) {
        const entries = fs_1.default.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path_1.default.join(dirPath, entry.name);
            const zipEntry = zipPath ? `${zipPath}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                addDir(fullPath, zipEntry);
            }
            else {
                zip.addFile(zipEntry, fs_1.default.readFileSync(fullPath));
            }
        }
    }
    addDir(sourceDir, '');
    zip.writeZip(outputPath);
}
