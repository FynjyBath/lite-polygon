"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.importPackage = importPackage;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const zip_1 = require("../utils/zip");
const parser_1 = require("../polygon-xml/parser");
const schema_1 = require("../db/schema");
const problems_1 = require("./problems");
async function importPackage(zipPath, ownerId, overwriteExisting = false) {
    const warnings = [];
    const errors = [];
    let filesImported = 0;
    // Extract to temp dir first
    const tmpDir = zipPath + '_extracted';
    try {
        fs_1.default.mkdirSync(tmpDir, { recursive: true });
        (0, zip_1.safeExtractZip)(zipPath, tmpDir);
        // Find problem.xml - it might be at root or inside a subdirectory
        let problemXmlPath = path_1.default.join(tmpDir, 'problem.xml');
        if (!fs_1.default.existsSync(problemXmlPath)) {
            // Try one level deep
            const entries = fs_1.default.readdirSync(tmpDir);
            for (const e of entries) {
                const candidate = path_1.default.join(tmpDir, e, 'problem.xml');
                if (fs_1.default.existsSync(candidate)) {
                    problemXmlPath = candidate;
                    break;
                }
            }
        }
        if (!fs_1.default.existsSync(problemXmlPath)) {
            throw new Error('problem.xml not found in zip');
        }
        const xmlContent = fs_1.default.readFileSync(problemXmlPath, 'utf-8');
        const model = (0, parser_1.parseProblemXml)(xmlContent);
        const packageRoot = path_1.default.dirname(problemXmlPath);
        const shortName = model.shortName || `problem_${Date.now()}`;
        // Check if problem exists for this user
        let problemId;
        const existing = schema_1.db.prepare('SELECT id FROM problems WHERE owner_id = ? AND short_name = ?').get(ownerId, shortName);
        if (existing && !overwriteExisting) {
            throw new Error(`Problem '${shortName}' already exists. Use overwrite=true to replace.`);
        }
        if (existing) {
            problemId = existing.id;
            // Clean old data (keep problem row)
            const problemDir = (0, schema_1.getProblemDir)(problemId);
            if (fs_1.default.existsSync(problemDir)) {
                fs_1.default.rmSync(problemDir, { recursive: true, force: true });
            }
            // Clear related tables
            const testsets = schema_1.db.prepare('SELECT id FROM testsets WHERE problem_id = ?').all(problemId);
            for (const ts of testsets) {
                schema_1.db.prepare('DELETE FROM tests WHERE testset_id = ?').run(ts.id);
                schema_1.db.prepare('DELETE FROM test_groups WHERE testset_id = ?').run(ts.id);
            }
            schema_1.db.prepare('DELETE FROM testsets WHERE problem_id = ?').run(problemId);
            schema_1.db.prepare('DELETE FROM problem_names WHERE problem_id = ?').run(problemId);
            schema_1.db.prepare('DELETE FROM statements WHERE problem_id = ?').run(problemId);
            schema_1.db.prepare('DELETE FROM solutions WHERE problem_id = ?').run(problemId);
            schema_1.db.prepare('DELETE FROM assets WHERE problem_id = ?').run(problemId);
            schema_1.db.prepare('DELETE FROM problem_files WHERE problem_id = ?').run(problemId);
            schema_1.db.prepare('DELETE FROM executables WHERE problem_id = ?').run(problemId);
            schema_1.db.prepare('DELETE FROM checker_tests WHERE problem_id = ?').run(problemId);
            schema_1.db.prepare('DELETE FROM validator_tests WHERE problem_id = ?').run(problemId);
            schema_1.db.prepare('DELETE FROM problem_properties WHERE problem_id = ?').run(problemId);
            schema_1.db.prepare('DELETE FROM problem_tags WHERE problem_id = ?').run(problemId);
        }
        else {
            const problem = (0, problems_1.createProblem)(ownerId, shortName);
            problemId = problem.id;
        }
        const problemDir = (0, schema_1.getProblemDir)(problemId);
        fs_1.default.mkdirSync(problemDir, { recursive: true });
        // Update problem general info
        const judging = model.judging;
        (0, problems_1.updateProblem)(problemId, {
            revision: parseInt(model.revision) || 1,
            time_limit: judging.testsets[0]?.timeLimit ?? 1000,
            memory_limit: judging.testsets[0]?.memoryLimit ?? 268435456,
            input_file: judging.inputFile,
            output_file: judging.outputFile,
            run_count: judging.runCount,
            cpu_name: judging.cpuName ?? '',
            cpu_speed: judging.cpuSpeed ?? '',
            polygon_url: model.url ?? '',
            modified: 0,
        });
        // Names
        for (const n of model.names) {
            (0, problems_1.upsertProblemName)(problemId, n.language, n.value);
        }
        // Copy all files from package to problem dir
        filesImported = copyPackageFiles(packageRoot, problemDir, warnings);
        // Testsets + tests
        let testsImported = 0;
        for (const ts of model.judging.testsets) {
            const testset = (0, problems_1.getOrCreateTestset)(problemId, ts.name);
            // Update testset TL/ML if different from problem defaults
            schema_1.db.prepare('UPDATE testsets SET time_limit = ?, memory_limit = ?, input_path_pattern = ?, answer_path_pattern = ? WHERE id = ?')
                .run(ts.timeLimit, ts.memoryLimit, ts.inputPathPattern, ts.answerPathPattern, testset.id);
            for (let i = 0; i < ts.tests.length; i++) {
                const t = ts.tests[i];
                (0, problems_1.upsertTest)(testset.id, i + 1, {
                    method: t.method,
                    cmd: t.cmd ?? '',
                    description: t.description ?? '',
                    sample: t.sample ? 1 : 0,
                    group_name: t.group ?? '',
                    points: t.points ?? 0,
                    extra_attrs: JSON.stringify(t._extraAttrs ?? {}),
                });
                testsImported++;
            }
            // Groups
            for (const g of ts.groups) {
                (0, problems_1.upsertTestGroup)(testset.id, g.name, {
                    points: g.points ?? 0,
                    pointsPolicy: g.pointsPolicy,
                    feedbackPolicy: g.feedbackPolicy,
                    dependencies: g.dependencies,
                });
            }
            // Enable groups/points if present
            if (ts.groups.length > 0) {
                schema_1.db.prepare('UPDATE testsets SET groups_enabled = 1 WHERE id = ?').run(testset.id);
            }
            const hasPoints = ts.tests.some(t => (t.points ?? 0) > 0);
            if (hasPoints) {
                schema_1.db.prepare('UPDATE testsets SET points_enabled = 1 WHERE id = ?').run(testset.id);
            }
        }
        // Files (resources)
        for (const r of model.files.resources) {
            (0, problems_1.upsertFile)(problemId, r.path, {
                file_role: 'resource',
                source_type: r.type ?? '',
                for_types: r.forTypes ?? '',
                stages: r.stages ?? '',
                assets_attr: r.assets ?? '',
                is_main: r.main === 'true' ? 1 : 0,
                extra_attrs: JSON.stringify(r._extraAttrs ?? {}),
            });
        }
        for (const e of model.files.executables) {
            if (e.source) {
                (0, problems_1.upsertFile)(problemId, e.source.path, { file_role: 'executable_source', source_type: e.source.type });
            }
            if (e.binary) {
                (0, problems_1.upsertFile)(problemId, e.binary.path, { file_role: 'executable_binary', source_type: e.binary.type });
            }
            if (e.source || e.binary) {
                schema_1.db.prepare('INSERT INTO executables (problem_id, source_path, source_type, binary_path, binary_type) VALUES (?, ?, ?, ?, ?)')
                    .run(problemId, e.source?.path ?? '', e.source?.type ?? '', e.binary?.path ?? '', e.binary?.type ?? '');
            }
        }
        // Assets: checker
        if (model.assets.checker) {
            const c = model.assets.checker;
            (0, problems_1.upsertAsset)(problemId, 'checker', {
                name: c.name ?? '',
                checker_type: c.type ?? 'testlib',
                source_path: c.source?.path ?? '',
                source_type: c.source?.type ?? '',
                binary_path: c.binary?.path ?? '',
                binary_type: c.binary?.type ?? '',
                copy_path: c.copy?.path ?? '',
                copy_type: c.copy?.type ?? '',
            });
            // Checker tests
            if (c.testset?.tests) {
                for (let i = 0; i < c.testset.tests.length; i++) {
                    (0, problems_1.upsertCheckerTest)(problemId, i + 1, {
                        expected_verdict: c.testset.tests[i].verdict ?? 'OK',
                    });
                }
            }
        }
        // Assets: validators
        for (let vi = 0; vi < model.assets.validators.length; vi++) {
            const v = model.assets.validators[vi];
            // First validator is the main one
            if (vi === 0) {
                (0, problems_1.upsertAsset)(problemId, 'validator', {
                    source_path: v.source?.path ?? '',
                    source_type: v.source?.type ?? '',
                    binary_path: v.binary?.path ?? '',
                    binary_type: v.binary?.type ?? '',
                });
            }
            // Validator tests
            if (v.testset?.tests) {
                for (let ti = 0; ti < v.testset.tests.length; ti++) {
                    const vt = v.testset.tests[ti];
                    // Load actual test file if exists
                    const testFilePath = path_1.default.join(problemDir, v.testset.inputPathPattern.replace('%02d', String(ti + 1).padStart(2, '0')));
                    let inputContent = '';
                    if (fs_1.default.existsSync(testFilePath)) {
                        inputContent = fs_1.default.readFileSync(testFilePath, 'utf-8');
                    }
                    (0, problems_1.upsertValidatorTest)(problemId, vi, ti + 1, {
                        input: inputContent,
                        expected_verdict: vt.verdict ?? 'VALID',
                        testset_name: vt.testset ?? '',
                        group_name: vt.group ?? '',
                    });
                }
            }
        }
        // Assets: interactor
        if (model.assets.interactor) {
            const i = model.assets.interactor;
            (0, problems_1.upsertAsset)(problemId, 'interactor', {
                source_path: i.source?.path ?? '',
                source_type: i.source?.type ?? '',
                binary_path: i.binary?.path ?? '',
                binary_type: i.binary?.type ?? '',
            });
            if (i.runs) {
                schema_1.db.prepare('DELETE FROM interactor_runs WHERE problem_id = ?').run(problemId);
                for (const r of i.runs) {
                    schema_1.db.prepare('INSERT INTO interactor_runs (problem_id, run_index) VALUES (?, ?)').run(problemId, r);
                }
            }
            // Mark interactive
            (0, problems_1.updateProblem)(problemId, { interactive: 1 });
        }
        // Solutions
        for (const s of model.assets.solutions) {
            (0, problems_1.upsertSolution)(problemId, s.source?.path ?? s.binary?.path ?? '', {
                source_type: s.source?.type ?? '',
                binary_path: s.binary?.path ?? '',
                binary_type: s.binary?.type ?? '',
                tag: s.tag,
            });
            // Load .desc file if exists
            if (s.source?.path) {
                const descPath = path_1.default.join(problemDir, s.source.path + '.desc');
                if (fs_1.default.existsSync(descPath)) {
                    // desc file content - already in dir, no action needed
                }
            }
        }
        // Statements: parse problem-properties.json for rich content
        const langs = new Set();
        for (const st of model.statements)
            langs.add(st.language);
        for (const tt of model.tutorials)
            langs.add(tt.language);
        for (const lang of langs) {
            // Try problem-properties.json first (richest source)
            const propsJsonPath = path_1.default.join(problemDir, 'statements', lang, 'problem-properties.json');
            if (fs_1.default.existsSync(propsJsonPath)) {
                try {
                    const props = JSON.parse(fs_1.default.readFileSync(propsJsonPath, 'utf-8'));
                    (0, problems_1.upsertStatement)(problemId, lang, {
                        name: props.name ?? '',
                        legend: props.legend ?? '',
                        input_section: props.input ?? '',
                        output_section: props.output ?? '',
                        scoring: props.scoring ?? '',
                        interaction: props.interaction ?? '',
                        notes: props.notes ?? '',
                        tutorial: props.tutorial ?? '',
                    });
                }
                catch {
                    warnings.push(`Failed to parse problem-properties.json for ${lang}`);
                }
            }
            else {
                // Try reading statement-sections files
                const sectionsDir = path_1.default.join(problemDir, 'statement-sections', lang);
                const getData = (name) => {
                    const p = path_1.default.join(sectionsDir, `${name}.tex`);
                    return fs_1.default.existsSync(p) ? fs_1.default.readFileSync(p, 'utf-8') : '';
                };
                (0, problems_1.upsertStatement)(problemId, lang, {
                    name: getData('name'),
                    legend: getData('legend'),
                    input_section: getData('input'),
                    output_section: getData('output'),
                    scoring: getData('scoring'),
                    interaction: getData('interaction'),
                    notes: getData('notes'),
                    tutorial: getData('tutorial'),
                });
            }
            // Also import problem name from statement
            const nameTex = path_1.default.join(problemDir, 'statement-sections', lang, 'name.tex');
            if (fs_1.default.existsSync(nameTex)) {
                const nameContent = fs_1.default.readFileSync(nameTex, 'utf-8').trim();
                if (nameContent)
                    (0, problems_1.upsertProblemName)(problemId, lang, nameContent);
            }
        }
        // Check problem_names - also from model.names
        for (const n of model.names) {
            (0, problems_1.upsertProblemName)(problemId, n.language, n.value);
        }
        // Properties
        for (const p of model.properties) {
            (0, problems_1.setProperty)(problemId, p.name, p.value);
        }
        // Tags
        (0, problems_1.setTags)(problemId, model.tags);
        // Store raw problem.xml for reference
        fs_1.default.writeFileSync(path_1.default.join(problemDir, 'problem.xml'), xmlContent);
        return {
            problemId,
            shortName,
            warnings,
            errors,
            filesImported,
            testsImported,
        };
    }
    finally {
        // Cleanup temp dir
        if (fs_1.default.existsSync(tmpDir)) {
            fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
        }
    }
}
function copyPackageFiles(sourceDir, destDir, warnings) {
    let count = 0;
    if (!fs_1.default.existsSync(sourceDir))
        return 0;
    function copyRecursive(src, dst) {
        const stat = fs_1.default.statSync(src);
        if (stat.isDirectory()) {
            fs_1.default.mkdirSync(dst, { recursive: true });
            const entries = fs_1.default.readdirSync(src);
            for (const e of entries) {
                copyRecursive(path_1.default.join(src, e), path_1.default.join(dst, e));
            }
        }
        else {
            fs_1.default.mkdirSync(path_1.default.dirname(dst), { recursive: true });
            fs_1.default.copyFileSync(src, dst);
            count++;
        }
    }
    try {
        copyRecursive(sourceDir, destDir);
    }
    catch (e) {
        warnings.push(`File copy warning: ${e.message}`);
    }
    return count;
}
