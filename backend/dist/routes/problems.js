"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.problemRoutes = problemRoutes;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const auth_1 = require("./auth");
const problems_1 = require("../services/problems");
const schema_1 = require("../db/schema");
const import_1 = require("../services/import");
const builder_1 = require("../packages/builder");
const judging_1 = require("../judging/judging");
async function auth(req, reply) {
    const user = await (0, auth_1.getAuthUser)(req);
    if (!user) {
        reply.code(401).send({ status: 'FAILED', comment: 'Not authenticated' });
        throw new Error('Not authenticated');
    }
    return user;
}
function ok(result) {
    return { status: 'OK', result };
}
function fail(comment, code = 400) {
    return { _code: code, status: 'FAILED', comment };
}
function getProblemForUser(problemId, userId, reply) {
    const problem = (0, problems_1.getProblem)(problemId, userId);
    if (!problem) {
        reply.code(404).send({ status: 'FAILED', comment: 'Problem not found or access denied' });
        return null;
    }
    return problem;
}
async function problemRoutes(app) {
    // problems.list
    app.get('/api/problems.list', async (req, reply) => {
        const user = await auth(req, reply);
        const problems = (0, problems_1.listProblems)(user.id);
        return ok(problems.map(p => ({
            id: p.id,
            shortName: p.short_name,
            revision: p.revision,
            timeLimit: p.time_limit,
            memoryLimit: p.memory_limit,
            inputFile: p.input_file,
            outputFile: p.output_file,
            interactive: p.interactive === 1,
            modified: p.modified === 1,
            updatedAt: p.updated_at,
        })));
    });
    // problem.create
    app.post('/api/problem.create', async (req, reply) => {
        const user = await auth(req, reply);
        const { name } = req.body;
        if (!name)
            return reply.code(400).send({ status: 'FAILED', comment: 'name required' });
        if (!/^[a-zA-Z0-9_\-\.]+$/.test(name)) {
            return reply.code(400).send({ status: 'FAILED', comment: 'Invalid short name (alphanumeric, dash, underscore, dot only)' });
        }
        const existing = (0, problems_1.getProblemByName)(name, user.id);
        if (existing)
            return reply.code(409).send({ status: 'FAILED', comment: 'Problem with this name already exists' });
        const problem = (0, problems_1.createProblem)(user.id, name);
        return ok({ id: problem.id, name: problem.short_name });
    });
    // problem.delete
    app.post('/api/problem.delete', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId } = req.body;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const problemDir = (0, schema_1.getProblemDir)(id);
        (0, problems_1.deleteProblem)(id);
        if (fs_1.default.existsSync(problemDir))
            fs_1.default.rmSync(problemDir, { recursive: true, force: true });
        return ok(null);
    });
    // problem.info
    app.get('/api/problem.info', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        const problem = getProblemForUser(id, user.id, reply);
        if (!problem)
            return;
        const names = (0, problems_1.getProblemNames)(id);
        const tags = (0, problems_1.listTags)(id);
        const checker = (0, problems_1.getAsset)(id, 'checker');
        const validator = (0, problems_1.getAsset)(id, 'validator');
        const interactor = (0, problems_1.getAsset)(id, 'interactor');
        const solutions = (0, problems_1.listSolutions)(id);
        const testset = (0, problems_1.getTestset)(id, 'tests');
        const tests = testset ? (0, problems_1.listTests)(testset.id) : [];
        const stmts = (0, problems_1.listStatements)(id);
        return ok({
            id: problem.id,
            shortName: problem.short_name,
            revision: problem.revision,
            timeLimit: problem.time_limit,
            memoryLimit: problem.memory_limit,
            inputFile: problem.input_file,
            outputFile: problem.output_file,
            interactive: problem.interactive === 1,
            runCount: problem.run_count,
            cpuName: problem.cpu_name,
            cpuSpeed: problem.cpu_speed,
            modified: problem.modified === 1,
            generalDescription: problem.general_description,
            generalTutorial: problem.general_tutorial,
            names,
            tags,
            checker: checker ? { sourcePath: checker.source_path, sourceType: checker.source_type, name: checker.name } : null,
            validator: validator ? { sourcePath: validator.source_path, sourceType: validator.source_type } : null,
            interactor: interactor ? { sourcePath: interactor.source_path, sourceType: interactor.source_type } : null,
            solutionsCount: solutions.length,
            testsCount: tests.length,
            statementsCount: stmts.length,
        });
    });
    // problem.updateInfo
    app.post('/api/problem.updateInfo', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        const problem = getProblemForUser(id, user.id, reply);
        if (!problem)
            return;
        const updates = {};
        if (body.timeLimit)
            updates.time_limit = parseInt(body.timeLimit);
        if (body.memoryLimit)
            updates.memory_limit = parseInt(body.memoryLimit);
        if (body.inputFile !== undefined)
            updates.input_file = body.inputFile;
        if (body.outputFile !== undefined)
            updates.output_file = body.outputFile;
        if (body.interactive !== undefined)
            updates.interactive = body.interactive === 'true' ? 1 : 0;
        if (body.runCount)
            updates.run_count = parseInt(body.runCount);
        updates.modified = 1;
        (0, problems_1.updateProblem)(id, updates);
        if (body.name && body.language) {
            (0, problems_1.upsertProblemName)(id, body.language, body.name);
        }
        return ok(null);
    });
    // problem.statements
    app.get('/api/problem.statements', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        const problem = getProblemForUser(id, user.id, reply);
        if (!problem)
            return;
        return ok((0, problems_1.listStatements)(id));
    });
    // problem.saveStatement
    app.post('/api/problem.saveStatement', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        if (!id || !body.lang)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId and lang required' });
        const problem = getProblemForUser(id, user.id, reply);
        if (!problem)
            return;
        (0, problems_1.upsertStatement)(id, body.lang, {
            name: body.name ?? '',
            legend: body.legend ?? '',
            input_section: body.input ?? '',
            output_section: body.output ?? '',
            scoring: body.scoring ?? '',
            interaction: body.interaction ?? '',
            notes: body.notes ?? '',
            tutorial: body.tutorial ?? '',
            charset: body.charset ?? 'UTF-8',
            mathjax: body.mathjax === 'false' ? 0 : 1,
        });
        (0, problems_1.updateProblem)(id, { modified: 1 });
        // Also write statement sections to disk
        const problemDir = (0, schema_1.getProblemDir)(id);
        const sectionsDir = path_1.default.join(problemDir, 'statement-sections', body.lang);
        fs_1.default.mkdirSync(sectionsDir, { recursive: true });
        if (body.name !== undefined)
            fs_1.default.writeFileSync(path_1.default.join(sectionsDir, 'name.tex'), body.name, 'utf-8');
        if (body.legend !== undefined)
            fs_1.default.writeFileSync(path_1.default.join(sectionsDir, 'legend.tex'), body.legend, 'utf-8');
        if (body.input !== undefined)
            fs_1.default.writeFileSync(path_1.default.join(sectionsDir, 'input.tex'), body.input, 'utf-8');
        if (body.output !== undefined)
            fs_1.default.writeFileSync(path_1.default.join(sectionsDir, 'output.tex'), body.output, 'utf-8');
        if (body.scoring !== undefined)
            fs_1.default.writeFileSync(path_1.default.join(sectionsDir, 'scoring.tex'), body.scoring, 'utf-8');
        if (body.interaction !== undefined)
            fs_1.default.writeFileSync(path_1.default.join(sectionsDir, 'interaction.tex'), body.interaction, 'utf-8');
        if (body.notes !== undefined)
            fs_1.default.writeFileSync(path_1.default.join(sectionsDir, 'notes.tex'), body.notes, 'utf-8');
        if (body.tutorial !== undefined)
            fs_1.default.writeFileSync(path_1.default.join(sectionsDir, 'tutorial.tex'), body.tutorial, 'utf-8');
        return ok(null);
    });
    // problem.renderStatements - returns HTML preview
    app.get('/api/problem.renderStatements', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId, lang } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        const problem = getProblemForUser(id, user.id, reply);
        if (!problem)
            return;
        const stmt = (0, problems_1.getStatement)(id, lang ?? 'russian');
        if (!stmt)
            return ok({ html: '', tutorialHtml: '' });
        // Simple HTML render
        const html = renderStatementHtml(stmt, id, lang ?? 'russian');
        return ok({ html, tutorialHtml: stmt.tutorial ? `<div>${escHtml(stmt.tutorial)}</div>` : '' });
    });
    // problem.files
    app.get('/api/problem.files', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const files = (0, problems_1.listFiles)(id);
        const execs = (0, problems_1.listExecutables)(id);
        return ok({ resources: files.filter(f => f.file_role === 'resource'), executables: execs });
    });
    // problem.saveFile
    app.post('/api/problem.saveFile', { config: { rawBody: true } }, async (req, reply) => {
        const user = await auth(req, reply);
        // Handles multipart or JSON
        const body = req.body;
        const id = parseInt(String(body.problemId ?? ''));
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        const problem = getProblemForUser(id, user.id, reply);
        if (!problem)
            return;
        const filePath = String(body.path ?? '');
        const sourceType = String(body.sourceType ?? '');
        const content = body.content;
        if (!filePath)
            return reply.code(400).send({ status: 'FAILED', comment: 'path required' });
        const problemDir = (0, schema_1.getProblemDir)(id);
        const dest = path_1.default.join(problemDir, filePath);
        if (!dest.startsWith(problemDir))
            return reply.code(400).send({ status: 'FAILED', comment: 'Invalid path' });
        fs_1.default.mkdirSync(path_1.default.dirname(dest), { recursive: true });
        if (content !== undefined)
            fs_1.default.writeFileSync(dest, content, 'utf-8');
        (0, problems_1.upsertFile)(id, filePath, { source_type: sourceType });
        (0, problems_1.updateProblem)(id, { modified: 1 });
        return ok(null);
    });
    // problem.viewFile
    app.get('/api/problem.viewFile', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId, path: filePath } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id || !filePath)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId and path required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const problemDir = (0, schema_1.getProblemDir)(id);
        const dest = path_1.default.join(problemDir, filePath);
        if (!dest.startsWith(problemDir) || !fs_1.default.existsSync(dest)) {
            return reply.code(404).send({ status: 'FAILED', comment: 'File not found' });
        }
        const content = fs_1.default.readFileSync(dest);
        reply.header('Content-Type', 'application/octet-stream');
        return reply.send(content);
    });
    // problem.solutions
    app.get('/api/problem.solutions', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        return ok((0, problems_1.listSolutions)(id));
    });
    // problem.saveSolution
    app.post('/api/problem.saveSolution', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        if (!id || !body.sourcePath)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId and sourcePath required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const problemDir = (0, schema_1.getProblemDir)(id);
        const dest = path_1.default.join(problemDir, body.sourcePath);
        if (body.content !== undefined) {
            fs_1.default.mkdirSync(path_1.default.dirname(dest), { recursive: true });
            fs_1.default.writeFileSync(dest, body.content, 'utf-8');
        }
        const solId = (0, problems_1.upsertSolution)(id, body.sourcePath, {
            source_type: body.sourceType ?? '',
            tag: body.tag ?? 'accepted',
        });
        (0, problems_1.updateProblem)(id, { modified: 1 });
        return ok({ id: solId });
    });
    // problem.viewSolution
    app.get('/api/problem.viewSolution', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId, solutionId } = req.query;
        const id = parseInt(problemId ?? '');
        const solId = parseInt(solutionId ?? '');
        if (!id || !solId)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId and solutionId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const solution = (0, problems_1.getSolution)(solId);
        if (!solution || solution.problem_id !== id)
            return reply.code(404).send({ status: 'FAILED', comment: 'Solution not found' });
        const problemDir = (0, schema_1.getProblemDir)(id);
        const dest = path_1.default.join(problemDir, solution.source_path);
        if (!fs_1.default.existsSync(dest))
            return reply.code(404).send({ status: 'FAILED', comment: 'File not found' });
        const content = fs_1.default.readFileSync(dest, 'utf-8');
        reply.header('Content-Type', 'text/plain; charset=utf-8');
        return reply.send(content);
    });
    // problem.checker
    app.get('/api/problem.checker', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        return ok((0, problems_1.getAsset)(id, 'checker'));
    });
    // problem.setChecker
    app.post('/api/problem.setChecker', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        (0, problems_1.upsertAsset)(id, 'checker', {
            name: body.name ?? '',
            checker_type: body.type ?? 'testlib',
            source_path: body.sourcePath ?? '',
            source_type: body.sourceType ?? '',
            binary_path: body.binaryPath ?? '',
            binary_type: body.binaryType ?? '',
            copy_path: body.copyPath ?? '',
        });
        (0, problems_1.updateProblem)(id, { modified: 1 });
        return ok(null);
    });
    // problem.validator
    app.get('/api/problem.validator', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        return ok((0, problems_1.getAsset)(id, 'validator'));
    });
    // problem.setValidator
    app.post('/api/problem.setValidator', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        (0, problems_1.upsertAsset)(id, 'validator', {
            source_path: body.sourcePath ?? '',
            source_type: body.sourceType ?? '',
        });
        (0, problems_1.updateProblem)(id, { modified: 1 });
        return ok(null);
    });
    // problem.interactor
    app.get('/api/problem.interactor', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        return ok((0, problems_1.getAsset)(id, 'interactor'));
    });
    // problem.setInteractor
    app.post('/api/problem.setInteractor', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        (0, problems_1.upsertAsset)(id, 'interactor', {
            source_path: body.sourcePath ?? '',
            source_type: body.sourceType ?? '',
        });
        (0, problems_1.updateProblem)(id, { modified: 1 });
        return ok(null);
    });
    // problem.tests
    app.get('/api/problem.tests', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId, testset: tsName } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const testset = (0, problems_1.getTestset)(id, tsName ?? 'tests');
        if (!testset)
            return ok([]);
        const tests = (0, problems_1.listTests)(testset.id);
        const problemDir = (0, schema_1.getProblemDir)(id);
        const inputPattern = testset.input_path_pattern;
        return ok(tests.map(t => {
            const testNum = String(t.idx).padStart(2, '0');
            const inputPath = path_1.default.join(problemDir, inputPattern.replace('%02d', testNum));
            return {
                ...t,
                inputAvailable: fs_1.default.existsSync(inputPath),
            };
        }));
    });
    // problem.saveTest
    app.post('/api/problem.saveTest', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        const problem = getProblemForUser(id, user.id, reply);
        if (!problem)
            return;
        const testset = (0, problems_1.getOrCreateTestset)(id, body.testset ?? 'tests');
        const idx = parseInt(body.testIndex ?? '0') || ((0, problems_1.listTests)(testset.id).length + 1);
        (0, problems_1.upsertTest)(testset.id, idx, {
            method: (body.method ?? 'manual'),
            cmd: body.scriptLine ?? body.cmd ?? '',
            description: body.description ?? '',
            sample: body.sample === 'true' ? 1 : 0,
            group_name: body.group ?? '',
            points: parseFloat(body.points ?? '0') || 0,
        });
        // Write input to disk if provided
        if (body.input !== undefined) {
            const problemDir = (0, schema_1.getProblemDir)(id);
            const testNum = String(idx).padStart(2, '0');
            const inputPath = path_1.default.join(problemDir, testset.input_path_pattern.replace('%02d', testNum));
            fs_1.default.mkdirSync(path_1.default.dirname(inputPath), { recursive: true });
            fs_1.default.writeFileSync(inputPath, body.input, 'utf-8');
        }
        (0, problems_1.updateProblem)(id, { modified: 1 });
        return ok({ testIndex: idx });
    });
    // problem.deleteTest
    app.post('/api/problem.deleteTest', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        const idx = parseInt(body.testIndex ?? '');
        if (!id || !idx)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId and testIndex required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const testset = (0, problems_1.getTestset)(id, body.testset ?? 'tests');
        if (!testset)
            return reply.code(404).send({ status: 'FAILED', comment: 'Testset not found' });
        // Delete files and rename subsequent ones to close the gap
        const problemDir = (0, schema_1.getProblemDir)(id);
        const tests = (0, problems_1.listTests)(testset.id);
        const maxIdx = tests.length > 0 ? tests[tests.length - 1].idx : 0;
        const delNum = String(idx).padStart(2, '0');
        const delIn = path_1.default.join(problemDir, testset.input_path_pattern.replace('%02d', delNum));
        const delAns = path_1.default.join(problemDir, testset.answer_path_pattern.replace('%02d', delNum));
        if (fs_1.default.existsSync(delIn))
            fs_1.default.unlinkSync(delIn);
        if (fs_1.default.existsSync(delAns))
            fs_1.default.unlinkSync(delAns);
        for (let i = idx + 1; i <= maxIdx; i++) {
            const oldN = String(i).padStart(2, '0');
            const newN = String(i - 1).padStart(2, '0');
            const oIn = path_1.default.join(problemDir, testset.input_path_pattern.replace('%02d', oldN));
            const nIn = path_1.default.join(problemDir, testset.input_path_pattern.replace('%02d', newN));
            const oAns = path_1.default.join(problemDir, testset.answer_path_pattern.replace('%02d', oldN));
            const nAns = path_1.default.join(problemDir, testset.answer_path_pattern.replace('%02d', newN));
            if (fs_1.default.existsSync(oIn))
                fs_1.default.renameSync(oIn, nIn);
            if (fs_1.default.existsSync(oAns))
                fs_1.default.renameSync(oAns, nAns);
        }
        (0, problems_1.deleteTest)(testset.id, idx);
        (0, problems_1.updateProblem)(id, { modified: 1 });
        return ok(null);
    });
    // problem.updateTest — update metadata (sample/group/points/description) without touching input file
    app.post('/api/problem.updateTest', async (req, reply) => {
        const user = await auth(req, reply);
        if (!user)
            return;
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        const testIndex = parseInt(body.testIndex ?? '');
        if (!id || !testIndex)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId and testIndex required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const testset = (0, problems_1.getOrCreateTestset)(id, body.testset ?? 'tests');
        const updates = {};
        if (body.sample !== undefined)
            updates.sample = body.sample === 'true' ? 1 : 0;
        if (body.group !== undefined)
            updates.group_name = body.group;
        if (body.points !== undefined)
            updates.points = parseFloat(body.points) || 0;
        if (body.description !== undefined)
            updates.description = body.description;
        (0, problems_1.upsertTest)(testset.id, testIndex, updates);
        (0, problems_1.updateProblem)(id, { modified: 1 });
        return ok(null);
    });
    // problem.moveTest — swap a test with its neighbour (direction: up|down)
    app.post('/api/problem.moveTest', async (req, reply) => {
        const user = await auth(req, reply);
        if (!user)
            return;
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        const testIndex = parseInt(body.testIndex ?? '');
        const direction = body.direction ?? 'up';
        if (!id || !testIndex)
            return reply.code(400).send({ status: 'FAILED', comment: 'required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const testset = (0, problems_1.getOrCreateTestset)(id, body.testset ?? 'tests');
        const otherIndex = direction === 'up' ? testIndex - 1 : testIndex + 1;
        const tests = (0, problems_1.listTests)(testset.id);
        const maxIdx = tests.length > 0 ? tests[tests.length - 1].idx : 0;
        if (otherIndex < 1 || otherIndex > maxIdx)
            return reply.code(400).send({ status: 'FAILED', comment: 'Cannot move' });
        // Swap DB indices via temp (-1)
        schema_1.db.prepare('UPDATE tests SET idx = -1 WHERE testset_id = ? AND idx = ?').run(testset.id, testIndex);
        schema_1.db.prepare('UPDATE tests SET idx = ? WHERE testset_id = ? AND idx = ?').run(testIndex, testset.id, otherIndex);
        schema_1.db.prepare('UPDATE tests SET idx = ? WHERE testset_id = ? AND idx = -1').run(otherIndex, testset.id);
        // Swap files on disk
        const problemDir = (0, schema_1.getProblemDir)(id);
        const n1 = String(testIndex).padStart(2, '0');
        const n2 = String(otherIndex).padStart(2, '0');
        for (const pat of [testset.input_path_pattern, testset.answer_path_pattern]) {
            const f1 = path_1.default.join(problemDir, pat.replace('%02d', n1));
            const f2 = path_1.default.join(problemDir, pat.replace('%02d', n2));
            const tmp = f1 + '._swap';
            if (fs_1.default.existsSync(f1))
                fs_1.default.renameSync(f1, tmp);
            if (fs_1.default.existsSync(f2))
                fs_1.default.renameSync(f2, f1);
            if (fs_1.default.existsSync(tmp))
                fs_1.default.renameSync(tmp, f2);
        }
        (0, problems_1.updateProblem)(id, { modified: 1 });
        return ok(null);
    });
    // problem.testInput
    app.get('/api/problem.testInput', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId, testset: tsName, testIndex } = req.query;
        const id = parseInt(problemId ?? '');
        const idx = parseInt(testIndex ?? '');
        if (!id || !idx)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId and testIndex required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const testset = (0, problems_1.getTestset)(id, tsName ?? 'tests');
        if (!testset)
            return reply.code(404).send({ status: 'FAILED', comment: 'Testset not found' });
        const testNum = String(idx).padStart(2, '0');
        const inputPath = path_1.default.join((0, schema_1.getProblemDir)(id), testset.input_path_pattern.replace('%02d', testNum));
        if (!fs_1.default.existsSync(inputPath))
            return reply.code(404).send({ status: 'FAILED', comment: 'Input not found' });
        const content = fs_1.default.readFileSync(inputPath);
        reply.header('Content-Type', 'text/plain; charset=utf-8');
        return reply.send(content);
    });
    // problem.testAnswer
    app.get('/api/problem.testAnswer', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId, testset: tsName, testIndex } = req.query;
        const id = parseInt(problemId ?? '');
        const idx = parseInt(testIndex ?? '');
        if (!id || !idx)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId and testIndex required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const testset = (0, problems_1.getTestset)(id, tsName ?? 'tests');
        if (!testset)
            return reply.code(404).send({ status: 'FAILED', comment: 'Testset not found' });
        const testNum = String(idx).padStart(2, '0');
        const answerPath = path_1.default.join((0, schema_1.getProblemDir)(id), testset.answer_path_pattern.replace('%02d', testNum));
        if (!fs_1.default.existsSync(answerPath))
            return reply.code(404).send({ status: 'FAILED', comment: 'Answer not found' });
        const content = fs_1.default.readFileSync(answerPath);
        reply.header('Content-Type', 'text/plain; charset=utf-8');
        return reply.send(content);
    });
    // problem.generateAnswers — compile main solution, run on every test, write .a files
    app.post('/api/problem.generateAnswers', async (req, reply) => {
        const user = await auth(req, reply);
        if (!user)
            return;
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const tsName = body.testset ?? 'tests';
        const testset = (0, problems_1.getTestset)(id, tsName);
        if (!testset)
            return reply.code(404).send({ status: 'FAILED', comment: 'Testset not found' });
        const problemDir = (0, schema_1.getProblemDir)(id);
        const tests = (0, problems_1.listTests)(testset.id);
        let generated = 0;
        const errors = [];
        for (const t of tests) {
            const num = String(t.idx).padStart(2, '0');
            const inputPath = path_1.default.join(problemDir, testset.input_path_pattern.replace('%02d', num));
            const answerPath = path_1.default.join(problemDir, testset.answer_path_pattern.replace('%02d', num));
            if (!fs_1.default.existsSync(inputPath)) {
                errors.push(`Test ${t.idx}: input missing`);
                continue;
            }
            const r = await (0, judging_1.generateTestAnswer)(id, inputPath, testset.time_limit ?? 1000, testset.memory_limit ?? 268435456, answerPath);
            if (r.success) {
                generated++;
            }
            else {
                errors.push(`Test ${t.idx}: ${r.error}`);
            }
        }
        return ok({ generated, errors });
    });
    // problem.setTestGroup
    app.post('/api/problem.setTestGroup', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        const idx = parseInt(body.testIndex ?? '');
        if (!id || !idx)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId and testIndex required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const testset = (0, problems_1.getTestset)(id, body.testset ?? 'tests');
        if (!testset)
            return reply.code(404).send({ status: 'FAILED', comment: 'Testset not found' });
        (0, problems_1.upsertTest)(testset.id, idx, { group_name: body.group ?? '' });
        (0, problems_1.updateProblem)(id, { modified: 1 });
        return ok(null);
    });
    // problem.enableGroups
    app.post('/api/problem.enableGroups', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const testset = (0, problems_1.getOrCreateTestset)(id, body.testset ?? 'tests');
        const enabled = body.enable !== 'false' ? 1 : 0;
        schema_1.db.prepare('UPDATE testsets SET groups_enabled = ? WHERE id = ?').run(enabled, testset.id);
        (0, problems_1.updateProblem)(id, { modified: 1 });
        return ok(null);
    });
    // problem.enablePoints
    app.post('/api/problem.enablePoints', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const testset = (0, problems_1.getOrCreateTestset)(id, body.testset ?? 'tests');
        const enabled = body.enable !== 'false' ? 1 : 0;
        schema_1.db.prepare('UPDATE testsets SET points_enabled = ? WHERE id = ?').run(enabled, testset.id);
        (0, problems_1.updateProblem)(id, { modified: 1 });
        return ok(null);
    });
    // problem.enableTreatPointsFromCheckerAsPercent
    app.post('/api/problem.enableTreatPointsFromCheckerAsPercent', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const testset = (0, problems_1.getOrCreateTestset)(id, body.testset ?? 'tests');
        const enabled = body.enable !== 'false' ? 1 : 0;
        schema_1.db.prepare('UPDATE testsets SET treat_points_from_checker_as_percent = ? WHERE id = ?').run(enabled, testset.id);
        (0, problems_1.updateProblem)(id, { modified: 1 });
        return ok(null);
    });
    // problem.viewTestGroup
    app.get('/api/problem.viewTestGroup', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId, testset: tsName } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const testset = (0, problems_1.getTestset)(id, tsName ?? 'tests');
        if (!testset)
            return ok([]);
        const groups = (0, problems_1.getTestGroups)(testset.id);
        return ok(groups.map(g => ({
            ...g,
            dependencies: (0, problems_1.getGroupDependencies)(g.id),
        })));
    });
    // problem.saveTestGroup
    app.post('/api/problem.saveTestGroup', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        if (!id || !body.groupName)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId and groupName required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const testset = (0, problems_1.getOrCreateTestset)(id, body.testset ?? 'tests');
        (0, problems_1.upsertTestGroup)(testset.id, body.groupName, {
            points: parseFloat(body.points ?? '0') || 0,
            pointsPolicy: body.pointsPolicy ?? 'each-test',
            feedbackPolicy: body.feedbackPolicy ?? 'complete',
            dependencies: body.dependencies ? body.dependencies.split(',').filter(Boolean) : [],
        });
        (0, problems_1.updateProblem)(id, { modified: 1 });
        return ok(null);
    });
    // problem.checkerTests
    app.get('/api/problem.checkerTests', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        return ok((0, problems_1.listCheckerTests)(id));
    });
    // problem.saveCheckerTest
    app.post('/api/problem.saveCheckerTest', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const tests = (0, problems_1.listCheckerTests)(id);
        const idx = parseInt(body.testIndex ?? '0') || (tests.length + 1);
        (0, problems_1.upsertCheckerTest)(id, idx, {
            input: body.input ?? '',
            output_data: body.output ?? '',
            answer: body.answer ?? '',
            expected_verdict: body.expectedVerdict ?? 'OK',
        });
        (0, problems_1.updateProblem)(id, { modified: 1 });
        return ok({ testIndex: idx });
    });
    // problem.validatorTests
    app.get('/api/problem.validatorTests', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        return ok((0, problems_1.listValidatorTests)(id));
    });
    // problem.saveValidatorTest
    app.post('/api/problem.saveValidatorTest', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const tests = (0, problems_1.listValidatorTests)(id);
        const idx = parseInt(body.testIndex ?? '0') || (tests.length + 1);
        (0, problems_1.upsertValidatorTest)(id, 0, idx, {
            input: body.input ?? '',
            expected_verdict: body.expectedVerdict ?? 'VALID',
            testset_name: body.testset ?? '',
            group_name: body.group ?? '',
        });
        (0, problems_1.updateProblem)(id, { modified: 1 });
        return ok({ testIndex: idx });
    });
    // problem.viewTags
    app.get('/api/problem.viewTags', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        return ok((0, problems_1.listTags)(id));
    });
    // problem.saveTags
    app.post('/api/problem.saveTags', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(String(body.problemId ?? ''));
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const tags = Array.isArray(body.tags) ? body.tags : (body.tags ?? '').split(',').map(t => t.trim()).filter(Boolean);
        (0, problems_1.setTags)(id, tags);
        (0, problems_1.updateProblem)(id, { modified: 1 });
        return ok(null);
    });
    // problem.viewGeneralDescription
    app.get('/api/problem.viewGeneralDescription', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        const problem = getProblemForUser(id, user.id, reply);
        if (!problem)
            return;
        return ok(problem.general_description);
    });
    // problem.saveGeneralDescription
    app.post('/api/problem.saveGeneralDescription', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(String(body.problemId ?? ''));
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        (0, problems_1.updateProblem)(id, { general_description: body.description ?? '', modified: 1 });
        return ok(null);
    });
    // problem.viewGeneralTutorial
    app.get('/api/problem.viewGeneralTutorial', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        const problem = getProblemForUser(id, user.id, reply);
        if (!problem)
            return;
        return ok(problem.general_tutorial);
    });
    // problem.saveGeneralTutorial
    app.post('/api/problem.saveGeneralTutorial', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(String(body.problemId ?? ''));
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        (0, problems_1.updateProblem)(id, { general_tutorial: body.tutorial ?? '', modified: 1 });
        return ok(null);
    });
    // problem.cautions
    app.get('/api/problem.cautions', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        return ok({ cautions: (0, problems_1.getCautions)(id), aiTips: [] });
    });
    // problem.packages
    app.get('/api/problem.packages', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const packages = schema_1.db.prepare('SELECT * FROM packages WHERE problem_id = ? ORDER BY created_at DESC').all(id);
        return ok(packages);
    });
    // problem.buildPackage
    app.post('/api/problem.buildPackage', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        const problem = getProblemForUser(id, user.id, reply);
        if (!problem)
            return;
        const type = (body.type ?? 'standard');
        const comment = body.comment ?? '';
        const result = schema_1.db.prepare("INSERT INTO packages (problem_id, revision, type, state, comment) VALUES (?, ?, ?, 'PENDING', ?)").run(id, problem.revision, type, comment);
        const packageId = result.lastInsertRowid;
        // Build asynchronously
        (0, builder_1.buildPackage)(id, packageId, { type, comment }).catch(e => {
            console.error('Package build failed:', e);
        });
        return ok({ packageId, state: 'PENDING' });
    });
    // problem.package - download
    app.get('/api/problem.package', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId, packageId } = req.query;
        const id = parseInt(problemId ?? '');
        const pkgId = parseInt(packageId ?? '');
        if (!id || !pkgId)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId and packageId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const pkg = schema_1.db.prepare('SELECT * FROM packages WHERE id = ? AND problem_id = ?').get(pkgId, id);
        if (!pkg)
            return reply.code(404).send({ status: 'FAILED', comment: 'Package not found' });
        if (pkg.state !== 'READY')
            return reply.code(400).send({ status: 'FAILED', comment: `Package state: ${pkg.state}` });
        if (!fs_1.default.existsSync(pkg.file_path))
            return reply.code(404).send({ status: 'FAILED', comment: 'Package file missing' });
        const filename = path_1.default.basename(pkg.file_path);
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        reply.header('Content-Type', 'application/zip');
        return reply.send(fs_1.default.createReadStream(pkg.file_path));
    });
    // problem.editSolutionExtraTags
    app.post('/api/problem.editSolutionExtraTags', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        const solId = parseInt(body.solutionId ?? '');
        if (!id || !solId)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId and solutionId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const solution = (0, problems_1.getSolution)(solId);
        if (!solution || solution.problem_id !== id)
            return reply.code(404).send({ status: 'FAILED', comment: 'Solution not found' });
        // Tags are stored in the tag field; extra tags not separately modeled
        schema_1.db.prepare('UPDATE solutions SET tag = ? WHERE id = ?').run(body.tag ?? solution.tag, solId);
        return ok(null);
    });
    // problem.script - get doall script
    app.get('/api/problem.script', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId, type } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const scriptName = type === 'windows' ? 'doall.bat' : 'doall.sh';
        const scriptPath = path_1.default.join((0, schema_1.getProblemDir)(id), scriptName);
        if (!fs_1.default.existsSync(scriptPath)) {
            return reply.code(404).send({ status: 'FAILED', comment: 'Script not found' });
        }
        const content = fs_1.default.readFileSync(scriptPath, 'utf-8');
        reply.header('Content-Type', 'text/plain; charset=utf-8');
        return reply.send(content);
    });
    // problem.saveScript
    app.post('/api/problem.saveScript', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const scriptName = body.type === 'windows' ? 'doall.bat' : 'doall.sh';
        const scriptPath = path_1.default.join((0, schema_1.getProblemDir)(id), scriptName);
        fs_1.default.writeFileSync(scriptPath, body.content ?? '', 'utf-8');
        (0, problems_1.updateProblem)(id, { modified: 1 });
        return ok(null);
    });
    // problem.clearScript
    app.post('/api/problem.clearScript', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const scriptName = body.type === 'windows' ? 'doall.bat' : 'doall.sh';
        const scriptPath = path_1.default.join((0, schema_1.getProblemDir)(id), scriptName);
        if (fs_1.default.existsSync(scriptPath))
            fs_1.default.unlinkSync(scriptPath);
        (0, problems_1.updateProblem)(id, { modified: 1 });
        return ok(null);
    });
    // problem.previewTests - list tests with available info
    app.get('/api/problem.previewTests', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId, testset: tsName } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const testset = (0, problems_1.getTestset)(id, tsName ?? 'tests');
        if (!testset)
            return ok([]);
        const tests = (0, problems_1.listTests)(testset.id);
        const problemDir = (0, schema_1.getProblemDir)(id);
        return ok(tests.map(t => {
            const testNum = String(t.idx).padStart(2, '0');
            const inputPath = path_1.default.join(problemDir, testset.input_path_pattern.replace('%02d', testNum));
            const answerPath = path_1.default.join(problemDir, testset.answer_path_pattern.replace('%02d', testNum));
            let inputPreview = '';
            let inputSize = 0;
            let answerSize = 0;
            if (fs_1.default.existsSync(inputPath)) {
                try {
                    const data = fs_1.default.readFileSync(inputPath);
                    inputSize = data.length;
                    inputPreview = data.toString('utf-8').slice(0, 200);
                }
                catch { /**/ }
            }
            if (fs_1.default.existsSync(answerPath)) {
                try {
                    answerSize = fs_1.default.statSync(answerPath).size;
                }
                catch { /**/ }
            }
            return {
                ...t,
                inputAvailable: fs_1.default.existsSync(inputPath),
                answerAvailable: fs_1.default.existsSync(answerPath),
                inputPreview,
                inputSize,
                answerSize,
            };
        }));
    });
    // problem.updateWorkingCopy - increment revision
    app.post('/api/problem.updateWorkingCopy', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        const problem = getProblemForUser(id, user.id, reply);
        if (!problem)
            return;
        (0, problems_1.updateProblem)(id, { revision: problem.revision + 1, modified: 1 });
        return ok(null);
    });
    // problem.commitChanges
    app.post('/api/problem.commitChanges', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        (0, problems_1.updateProblem)(id, { modified: 0 });
        return ok(null);
    });
    // problem.discardWorkingCopy
    app.post('/api/problem.discardWorkingCopy', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        (0, problems_1.updateProblem)(id, { modified: 0 });
        return ok(null);
    });
    // Invocations
    app.get('/api/problem.invocations', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const invocations = schema_1.db.prepare('SELECT * FROM invocations WHERE problem_id = ? ORDER BY created_at DESC').all(id);
        return ok(invocations);
    });
    app.post('/api/problem.runInvocation', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const solutionIds = (body.solutionIds ?? '').split(',').map(Number).filter(Boolean);
        const testsetName = body.testset ?? 'tests';
        const result = schema_1.db.prepare("INSERT INTO invocations (problem_id, testset_name, state) VALUES (?, ?, 'PENDING')").run(id, testsetName);
        const invocationId = result.lastInsertRowid;
        if (solutionIds.length === 0) {
            // Default: all solutions
            const solutions = (0, problems_1.listSolutions)(id);
            solutionIds.push(...solutions.map(s => s.id));
        }
        (0, judging_1.runInvocation)(id, invocationId, solutionIds, testsetName).catch(e => {
            console.error('Invocation failed:', e);
        });
        return ok({ invocationId, state: 'PENDING' });
    });
    app.get('/api/problem.invocationResults', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId, invocationId } = req.query;
        const id = parseInt(problemId ?? '');
        const invId = parseInt(invocationId ?? '');
        if (!id || !invId)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId and invocationId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const invocation = schema_1.db.prepare('SELECT * FROM invocations WHERE id = ? AND problem_id = ?').get(invId, id);
        if (!invocation)
            return reply.code(404).send({ status: 'FAILED', comment: 'Invocation not found' });
        const runs = schema_1.db.prepare('SELECT * FROM invocation_runs WHERE invocation_id = ? ORDER BY solution_id, test_idx').all(invId);
        return ok({ state: invocation.state, runs });
    });
    // Upload package
    app.post('/api/problem.importPackage', async (req, reply) => {
        const user = await auth(req, reply);
        if (!user)
            return;
        const data = await req.file();
        if (!data)
            return reply.code(400).send({ status: 'FAILED', comment: 'No file uploaded' });
        const tmpPath = `/tmp/upload_${Date.now()}_${Math.random().toString(36).slice(2)}.zip`;
        try {
            await new Promise((resolve, reject) => {
                const stream = fs_1.default.createWriteStream(tmpPath);
                data.file.pipe(stream);
                stream.on('finish', resolve);
                stream.on('error', reject);
            });
            const overwrite = req.query.overwrite === 'true';
            const result = await (0, import_1.importPackage)(tmpPath, user.id, overwrite);
            return ok(result);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return reply.code(400).send({ status: 'FAILED', comment: msg });
        }
        finally {
            if (fs_1.default.existsSync(tmpPath))
                fs_1.default.unlinkSync(tmpPath);
        }
    });
    // problem.stresses
    app.get('/api/problem.stresses', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const stresses = schema_1.db.prepare('SELECT * FROM stresses WHERE problem_id = ?').all(id);
        return ok(stresses);
    });
    // problem.saveStress
    app.post('/api/problem.saveStress', async (req, reply) => {
        const user = await auth(req, reply);
        const body = req.body;
        const id = parseInt(body.problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const result = schema_1.db.prepare('INSERT INTO stresses (problem_id, generator_cmd, solution_path, name) VALUES (?, ?, ?, ?)').run(id, body.generatorCmd ?? '', body.solutionPath ?? '', body.name ?? '');
        (0, problems_1.updateProblem)(id, { modified: 1 });
        return ok({ id: result.lastInsertRowid });
    });
    // contest.problems - stub
    app.get('/api/contest.problems', async (req, reply) => {
        const user = await auth(req, reply);
        return ok([]);
    });
    // problem.extraValidators
    app.get('/api/problem.extraValidators', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        // Return empty for now - TODO: support multiple validators
        return ok([]);
    });
    // problem.statementResources
    app.get('/api/problem.statementResources', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId, lang } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const problemDir = (0, schema_1.getProblemDir)(id);
        const stmtDir = path_1.default.join(problemDir, 'statements', lang ?? 'russian');
        const resources = [];
        if (fs_1.default.existsSync(stmtDir)) {
            for (const f of fs_1.default.readdirSync(stmtDir)) {
                resources.push(f);
            }
        }
        return ok(resources);
    });
    // problem.viewStatementResource
    app.get('/api/problem.viewStatementResource', async (req, reply) => {
        const user = await auth(req, reply);
        const { problemId, lang, name } = req.query;
        const id = parseInt(problemId ?? '');
        if (!id || !name)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId and name required' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const problemDir = (0, schema_1.getProblemDir)(id);
        const filePath = path_1.default.join(problemDir, 'statements', lang ?? 'russian', name);
        if (!filePath.startsWith(problemDir) || !fs_1.default.existsSync(filePath)) {
            return reply.code(404).send({ status: 'FAILED', comment: 'Resource not found' });
        }
        const content = fs_1.default.readFileSync(filePath);
        const ext = path_1.default.extname(name).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : ext === '.jpg' ? 'image/jpeg' : ext === '.pdf' ? 'application/pdf' : 'application/octet-stream';
        reply.header('Content-Type', mime);
        return reply.send(content);
    });
    // problem.saveStatementResource
    app.post('/api/problem.saveStatementResource', async (req, reply) => {
        const user = await auth(req, reply);
        const data = await req.file();
        const fields = data?.fields;
        const id = parseInt(fields?.problemId?.value ?? '');
        const lang = fields?.lang?.value ?? 'russian';
        if (!id || !data)
            return reply.code(400).send({ status: 'FAILED', comment: 'problemId required and file needed' });
        if (!getProblemForUser(id, user.id, reply))
            return;
        const problemDir = (0, schema_1.getProblemDir)(id);
        const stmtDir = path_1.default.join(problemDir, 'statements', lang);
        fs_1.default.mkdirSync(stmtDir, { recursive: true });
        const dest = path_1.default.join(stmtDir, data.filename);
        const buffer = await data.toBuffer();
        fs_1.default.writeFileSync(dest, buffer);
        (0, problems_1.updateProblem)(id, { modified: 1 });
        return ok({ name: data.filename });
    });
}
function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function renderStatementHtml(stmt, problemId, lang) {
    const problemDir = (0, schema_1.getProblemDir)(problemId);
    const htmlFile = path_1.default.join(problemDir, 'statements', '.html', lang, 'problem.html');
    if (fs_1.default.existsSync(htmlFile)) {
        return fs_1.default.readFileSync(htmlFile, 'utf-8');
    }
    // Fallback: simple render
    return `<div class="statement">
    <h2>${escHtml(stmt.name || '')}</h2>
    <h3>Условие</h3>
    <div>${escHtml(stmt.legend || '')}</div>
    <h3>Входные данные</h3>
    <div>${escHtml(stmt.input_section || '')}</div>
    <h3>Выходные данные</h3>
    <div>${escHtml(stmt.output_section || '')}</div>
    ${stmt.notes ? `<h3>Примечания</h3><div>${escHtml(stmt.notes)}</div>` : ''}
  </div>`;
}
