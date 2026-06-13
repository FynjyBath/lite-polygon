"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listProblems = listProblems;
exports.getProblem = getProblem;
exports.getProblemByName = getProblemByName;
exports.createProblem = createProblem;
exports.updateProblem = updateProblem;
exports.deleteProblem = deleteProblem;
exports.getTestset = getTestset;
exports.getOrCreateTestset = getOrCreateTestset;
exports.listTests = listTests;
exports.getTest = getTest;
exports.upsertTest = upsertTest;
exports.deleteTest = deleteTest;
exports.listSolutions = listSolutions;
exports.getSolution = getSolution;
exports.getSolutionByPath = getSolutionByPath;
exports.upsertSolution = upsertSolution;
exports.getAsset = getAsset;
exports.upsertAsset = upsertAsset;
exports.listTags = listTags;
exports.setTags = setTags;
exports.getProblemNames = getProblemNames;
exports.upsertProblemName = upsertProblemName;
exports.getStatement = getStatement;
exports.listStatements = listStatements;
exports.upsertStatement = upsertStatement;
exports.getTestGroups = getTestGroups;
exports.getGroupDependencies = getGroupDependencies;
exports.upsertTestGroup = upsertTestGroup;
exports.listCheckerTests = listCheckerTests;
exports.upsertCheckerTest = upsertCheckerTest;
exports.listValidatorTests = listValidatorTests;
exports.upsertValidatorTest = upsertValidatorTest;
exports.getProperty = getProperty;
exports.setProperty = setProperty;
exports.listProperties = listProperties;
exports.listFiles = listFiles;
exports.upsertFile = upsertFile;
exports.listExecutables = listExecutables;
exports.getCautions = getCautions;
const schema_1 = require("../db/schema");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function listProblems(ownerId) {
    return schema_1.db.prepare('SELECT * FROM problems WHERE owner_id = ? ORDER BY updated_at DESC').all(ownerId);
}
function getProblem(id, ownerId) {
    if (ownerId !== undefined) {
        return schema_1.db.prepare('SELECT * FROM problems WHERE id = ? AND owner_id = ?').get(id, ownerId);
    }
    return schema_1.db.prepare('SELECT * FROM problems WHERE id = ?').get(id);
}
function getProblemByName(shortName, ownerId) {
    return schema_1.db.prepare('SELECT * FROM problems WHERE short_name = ? AND owner_id = ?').get(shortName, ownerId);
}
function createProblem(ownerId, shortName) {
    const result = schema_1.db.prepare('INSERT INTO problems (owner_id, short_name, modified) VALUES (?, ?, 1)').run(ownerId, shortName);
    const problem = getProblem(result.lastInsertRowid);
    // Create default testset
    schema_1.db.prepare('INSERT INTO testsets (problem_id, name) VALUES (?, ?)').run(problem.id, 'tests');
    // Create problem directory
    const dir = (0, schema_1.getProblemDir)(problem.id);
    fs_1.default.mkdirSync(dir, { recursive: true });
    fs_1.default.mkdirSync(path_1.default.join(dir, 'tests'), { recursive: true });
    fs_1.default.mkdirSync(path_1.default.join(dir, 'solutions'), { recursive: true });
    fs_1.default.mkdirSync(path_1.default.join(dir, 'files'), { recursive: true });
    fs_1.default.mkdirSync(path_1.default.join(dir, 'statements'), { recursive: true });
    fs_1.default.mkdirSync(path_1.default.join(dir, 'statement-sections'), { recursive: true });
    fs_1.default.mkdirSync(path_1.default.join(dir, 'workdir'), { recursive: true });
    return problem;
}
function updateProblem(id, updates) {
    const allowed = [
        'short_name', 'revision', 'time_limit', 'memory_limit', 'input_file',
        'output_file', 'interactive', 'run_count', 'cpu_name', 'cpu_speed',
        'polygon_url', 'modified', 'general_description', 'general_tutorial',
    ];
    const sets = ["updated_at = datetime('now')"];
    const vals = [];
    for (const [k, v] of Object.entries(updates)) {
        if (allowed.includes(k)) {
            sets.push(`${k} = ?`);
            vals.push(v);
        }
    }
    if (sets.length > 1) {
        vals.push(id);
        schema_1.db.prepare(`UPDATE problems SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }
}
function deleteProblem(id) {
    schema_1.db.prepare('DELETE FROM problems WHERE id = ?').run(id);
}
function getTestset(problemId, name = 'tests') {
    return schema_1.db.prepare('SELECT * FROM testsets WHERE problem_id = ? AND name = ?').get(problemId, name);
}
function getOrCreateTestset(problemId, name) {
    let ts = getTestset(problemId, name);
    if (!ts) {
        schema_1.db.prepare('INSERT INTO testsets (problem_id, name) VALUES (?, ?)').run(problemId, name);
        ts = getTestset(problemId, name);
    }
    return ts;
}
function listTests(testsetId) {
    return schema_1.db.prepare('SELECT * FROM tests WHERE testset_id = ? ORDER BY idx').all(testsetId);
}
function getTest(testsetId, idx) {
    return schema_1.db.prepare('SELECT * FROM tests WHERE testset_id = ? AND idx = ?').get(testsetId, idx);
}
function upsertTest(testsetId, idx, data) {
    const existing = getTest(testsetId, idx);
    if (existing) {
        const sets = [];
        const vals = [];
        for (const [k, v] of Object.entries(data)) {
            if (['method', 'cmd', 'description', 'sample', 'group_name', 'points', 'extra_attrs'].includes(k)) {
                sets.push(`${k} = ?`);
                vals.push(v);
            }
        }
        if (sets.length) {
            vals.push(testsetId, idx);
            schema_1.db.prepare(`UPDATE tests SET ${sets.join(', ')} WHERE testset_id = ? AND idx = ?`).run(...vals);
        }
    }
    else {
        schema_1.db.prepare('INSERT INTO tests (testset_id, idx, method, cmd, description, sample, group_name, points, extra_attrs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(testsetId, idx, data.method ?? 'manual', data.cmd ?? '', data.description ?? '', data.sample ?? 0, data.group_name ?? '', data.points ?? 0, data.extra_attrs ?? '{}');
    }
}
function deleteTest(testsetId, idx) {
    schema_1.db.prepare('DELETE FROM tests WHERE testset_id = ? AND idx = ?').run(testsetId, idx);
    // Shift subsequent tests down
    schema_1.db.prepare('UPDATE tests SET idx = idx - 1 WHERE testset_id = ? AND idx > ?').run(testsetId, idx);
}
function listSolutions(problemId) {
    return schema_1.db.prepare('SELECT * FROM solutions WHERE problem_id = ? ORDER BY id').all(problemId);
}
function getSolution(id) {
    return schema_1.db.prepare('SELECT * FROM solutions WHERE id = ?').get(id);
}
function getSolutionByPath(problemId, sourcePath) {
    return schema_1.db.prepare('SELECT * FROM solutions WHERE problem_id = ? AND source_path = ?').get(problemId, sourcePath);
}
function upsertSolution(problemId, sourcePath, data) {
    const existing = getSolutionByPath(problemId, sourcePath);
    if (existing) {
        const sets = [];
        const vals = [];
        for (const [k, v] of Object.entries(data)) {
            if (['source_type', 'binary_path', 'binary_type', 'tag', 'compiled_binary'].includes(k)) {
                sets.push(`${k} = ?`);
                vals.push(v);
            }
        }
        if (sets.length) {
            vals.push(existing.id);
            schema_1.db.prepare(`UPDATE solutions SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        }
        return existing.id;
    }
    else {
        const result = schema_1.db.prepare('INSERT INTO solutions (problem_id, source_path, source_type, binary_path, binary_type, tag, compiled_binary) VALUES (?, ?, ?, ?, ?, ?, ?)').run(problemId, sourcePath, data.source_type ?? '', data.binary_path ?? '', data.binary_type ?? '', data.tag ?? 'accepted', data.compiled_binary ?? '');
        return result.lastInsertRowid;
    }
}
function getAsset(problemId, assetType) {
    return schema_1.db.prepare('SELECT * FROM assets WHERE problem_id = ? AND asset_type = ?').get(problemId, assetType);
}
function upsertAsset(problemId, assetType, data) {
    const existing = getAsset(problemId, assetType);
    if (existing) {
        const sets = [];
        const vals = [];
        for (const [k, v] of Object.entries(data)) {
            if (['name', 'checker_type', 'source_path', 'source_type', 'binary_path', 'binary_type', 'copy_path', 'copy_type', 'compiled_binary'].includes(k)) {
                sets.push(`${k} = ?`);
                vals.push(v);
            }
        }
        if (sets.length) {
            vals.push(problemId, assetType);
            schema_1.db.prepare(`UPDATE assets SET ${sets.join(', ')} WHERE problem_id = ? AND asset_type = ?`).run(...vals);
        }
    }
    else {
        schema_1.db.prepare('INSERT INTO assets (problem_id, asset_type, name, checker_type, source_path, source_type, binary_path, binary_type, copy_path, copy_type, compiled_binary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(problemId, assetType, data.name ?? '', data.checker_type ?? 'testlib', data.source_path ?? '', data.source_type ?? '', data.binary_path ?? '', data.binary_type ?? '', data.copy_path ?? '', data.copy_type ?? '', data.compiled_binary ?? '');
    }
}
function listTags(problemId) {
    const rows = schema_1.db.prepare('SELECT value FROM problem_tags WHERE problem_id = ? ORDER BY value').all(problemId);
    return rows.map(r => r.value);
}
function setTags(problemId, tags) {
    schema_1.db.prepare('DELETE FROM problem_tags WHERE problem_id = ?').run(problemId);
    const stmt = schema_1.db.prepare('INSERT OR IGNORE INTO problem_tags (problem_id, value) VALUES (?, ?)');
    for (const t of tags)
        stmt.run(problemId, t);
}
function getProblemNames(problemId) {
    return schema_1.db.prepare('SELECT language, value FROM problem_names WHERE problem_id = ? ORDER BY language').all(problemId);
}
function upsertProblemName(problemId, language, value) {
    schema_1.db.prepare('INSERT OR REPLACE INTO problem_names (problem_id, language, value) VALUES (?, ?, ?)').run(problemId, language, value);
}
function getStatement(problemId, language) {
    return schema_1.db.prepare('SELECT * FROM statements WHERE problem_id = ? AND language = ?').get(problemId, language);
}
function listStatements(problemId) {
    return schema_1.db.prepare('SELECT * FROM statements WHERE problem_id = ? ORDER BY language').all(problemId);
}
function upsertStatement(problemId, language, data) {
    const existing = getStatement(problemId, language);
    if (existing) {
        const allowed = ['name', 'legend', 'input_section', 'output_section', 'scoring', 'interaction', 'notes', 'tutorial', 'charset', 'mathjax'];
        const sets = [];
        const vals = [];
        for (const [k, v] of Object.entries(data)) {
            if (allowed.includes(k)) {
                sets.push(`${k} = ?`);
                vals.push(v);
            }
        }
        if (sets.length) {
            vals.push(problemId, language);
            schema_1.db.prepare(`UPDATE statements SET ${sets.join(', ')} WHERE problem_id = ? AND language = ?`).run(...vals);
        }
    }
    else {
        schema_1.db.prepare('INSERT INTO statements (problem_id, language, name, legend, input_section, output_section, scoring, interaction, notes, tutorial, charset, mathjax) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(problemId, language, data.name ?? '', data.legend ?? '', data.input_section ?? '', data.output_section ?? '', data.scoring ?? '', data.interaction ?? '', data.notes ?? '', data.tutorial ?? '', data.charset ?? 'UTF-8', data.mathjax ?? 1);
    }
}
function getTestGroups(testsetId) {
    return schema_1.db.prepare('SELECT * FROM test_groups WHERE testset_id = ? ORDER BY name').all(testsetId);
}
function getGroupDependencies(groupId) {
    const rows = schema_1.db.prepare('SELECT depends_on FROM group_dependencies WHERE group_id = ?').all(groupId);
    return rows.map(r => r.depends_on);
}
function upsertTestGroup(testsetId, name, data) {
    const existing = schema_1.db.prepare('SELECT * FROM test_groups WHERE testset_id = ? AND name = ?').get(testsetId, name);
    let groupId;
    if (existing) {
        const sets = [];
        const vals = [];
        if (data.points !== undefined) {
            sets.push('points = ?');
            vals.push(data.points);
        }
        if (data.pointsPolicy) {
            sets.push('points_policy = ?');
            vals.push(data.pointsPolicy);
        }
        if (data.feedbackPolicy) {
            sets.push('feedback_policy = ?');
            vals.push(data.feedbackPolicy);
        }
        if (sets.length) {
            vals.push(existing.id);
            schema_1.db.prepare(`UPDATE test_groups SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        }
        groupId = existing.id;
    }
    else {
        const result = schema_1.db.prepare('INSERT INTO test_groups (testset_id, name, points, points_policy, feedback_policy) VALUES (?, ?, ?, ?, ?)').run(testsetId, name, data.points ?? 0, data.pointsPolicy ?? 'each-test', data.feedbackPolicy ?? 'complete');
        groupId = result.lastInsertRowid;
    }
    if (data.dependencies !== undefined) {
        schema_1.db.prepare('DELETE FROM group_dependencies WHERE group_id = ?').run(groupId);
        for (const dep of data.dependencies) {
            schema_1.db.prepare('INSERT INTO group_dependencies (group_id, depends_on) VALUES (?, ?)').run(groupId, dep);
        }
    }
}
function listCheckerTests(problemId) {
    return schema_1.db.prepare('SELECT * FROM checker_tests WHERE problem_id = ? ORDER BY idx').all(problemId);
}
function upsertCheckerTest(problemId, idx, data) {
    const existing = schema_1.db.prepare('SELECT id FROM checker_tests WHERE problem_id = ? AND idx = ?').get(problemId, idx);
    if (existing) {
        const allowed = ['input', 'output_data', 'answer', 'expected_verdict', 'run_verdict', 'run_comment'];
        const sets = [];
        const vals = [];
        for (const [k, v] of Object.entries(data)) {
            if (allowed.includes(k)) {
                sets.push(`${k} = ?`);
                vals.push(v);
            }
        }
        if (sets.length) {
            vals.push(problemId, idx);
            schema_1.db.prepare(`UPDATE checker_tests SET ${sets.join(', ')} WHERE problem_id = ? AND idx = ?`).run(...vals);
        }
    }
    else {
        schema_1.db.prepare('INSERT INTO checker_tests (problem_id, idx, input, output_data, answer, expected_verdict, run_verdict, run_comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(problemId, idx, data.input ?? '', data.output_data ?? '', data.answer ?? '', data.expected_verdict ?? 'OK', data.run_verdict ?? '', data.run_comment ?? '');
    }
}
function listValidatorTests(problemId, validatorIdx = 0) {
    return schema_1.db.prepare('SELECT * FROM validator_tests WHERE problem_id = ? AND validator_idx = ? ORDER BY idx').all(problemId, validatorIdx);
}
function upsertValidatorTest(problemId, validatorIdx, idx, data) {
    const existing = schema_1.db.prepare('SELECT id FROM validator_tests WHERE problem_id = ? AND validator_idx = ? AND idx = ?').get(problemId, validatorIdx, idx);
    if (existing) {
        const allowed = ['input', 'expected_verdict', 'testset_name', 'group_name', 'run_verdict', 'run_comment'];
        const sets = [];
        const vals = [];
        for (const [k, v] of Object.entries(data)) {
            if (allowed.includes(k)) {
                sets.push(`${k} = ?`);
                vals.push(v);
            }
        }
        if (sets.length) {
            vals.push(problemId, validatorIdx, idx);
            schema_1.db.prepare(`UPDATE validator_tests SET ${sets.join(', ')} WHERE problem_id = ? AND validator_idx = ? AND idx = ?`).run(...vals);
        }
    }
    else {
        schema_1.db.prepare('INSERT INTO validator_tests (problem_id, validator_idx, idx, input, expected_verdict, testset_name, group_name, run_verdict, run_comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(problemId, validatorIdx, idx, data.input ?? '', data.expected_verdict ?? 'VALID', data.testset_name ?? '', data.group_name ?? '', data.run_verdict ?? '', data.run_comment ?? '');
    }
}
function getProperty(problemId, name) {
    const row = schema_1.db.prepare('SELECT value FROM problem_properties WHERE problem_id = ? AND name = ?').get(problemId, name);
    return row?.value;
}
function setProperty(problemId, name, value) {
    schema_1.db.prepare('INSERT OR REPLACE INTO problem_properties (problem_id, name, value) VALUES (?, ?, ?)').run(problemId, name, value);
}
function listProperties(problemId) {
    return schema_1.db.prepare('SELECT name, value FROM problem_properties WHERE problem_id = ?').all(problemId);
}
function listFiles(problemId) {
    return schema_1.db.prepare('SELECT * FROM problem_files WHERE problem_id = ? ORDER BY path').all(problemId);
}
function upsertFile(problemId, filePath, data) {
    const existing = schema_1.db.prepare('SELECT id FROM problem_files WHERE problem_id = ? AND path = ?').get(problemId, filePath);
    if (existing) {
        const allowed = ['file_role', 'source_type', 'for_types', 'stages', 'assets_attr', 'is_main', 'extra_attrs'];
        const sets = [];
        const vals = [];
        for (const [k, v] of Object.entries(data)) {
            if (allowed.includes(k)) {
                sets.push(`${k} = ?`);
                vals.push(v);
            }
        }
        if (sets.length) {
            vals.push(problemId, filePath);
            schema_1.db.prepare(`UPDATE problem_files SET ${sets.join(', ')} WHERE problem_id = ? AND path = ?`).run(...vals);
        }
    }
    else {
        schema_1.db.prepare('INSERT INTO problem_files (problem_id, file_role, path, source_type, for_types, stages, assets_attr, is_main, extra_attrs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(problemId, data.file_role ?? 'resource', filePath, data.source_type ?? '', data.for_types ?? '', data.stages ?? '', data.assets_attr ?? '', data.is_main ?? 0, data.extra_attrs ?? '{}');
    }
}
function listExecutables(problemId) {
    return schema_1.db.prepare('SELECT * FROM executables WHERE problem_id = ? ORDER BY id').all(problemId);
}
function getCautions(problemId) {
    const warnings = [];
    const problem = getProblem(problemId);
    if (!problem)
        return warnings;
    const checker = getAsset(problemId, 'checker');
    if (!checker || !checker.source_path)
        warnings.push('No checker set');
    const validators = schema_1.db.prepare('SELECT * FROM assets WHERE problem_id = ? AND asset_type = ?').all(problemId, 'validator');
    if (validators.length === 0)
        warnings.push('No validator set');
    const solutions = listSolutions(problemId);
    const hasMain = solutions.some(s => s.tag === 'main');
    if (!hasMain)
        warnings.push('No main solution set');
    const testset = getTestset(problemId, 'tests');
    if (testset) {
        const tests = listTests(testset.id);
        if (tests.length === 0)
            warnings.push('No tests');
        const hasSample = tests.some(t => t.sample === 1);
        if (tests.length > 0 && !hasSample)
            warnings.push('No sample tests');
    }
    const stmts = listStatements(problemId);
    if (stmts.length === 0)
        warnings.push('No statements');
    for (const s of stmts) {
        if (!s.name)
            warnings.push(`Statement (${s.language}): missing name`);
        if (!s.legend)
            warnings.push(`Statement (${s.language}): missing legend`);
    }
    const packages = schema_1.db.prepare('SELECT * FROM packages WHERE problem_id = ? ORDER BY created_at DESC LIMIT 1').get(problemId);
    if (!packages || packages.revision < problem.revision || packages.state !== 'READY') {
        warnings.push('No ready package for current revision');
    }
    if (problem.modified)
        warnings.push('Working copy has uncommitted changes');
    return warnings;
}
