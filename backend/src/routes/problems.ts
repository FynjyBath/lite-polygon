import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';
import { getAuthUser } from './auth';
import {
  listProblems, getProblem, getProblemByName, createProblem, updateProblem, deleteProblem,
  listSolutions, getSolution, getSolutionByPath, upsertSolution,
  getAsset, upsertAsset, listFiles, upsertFile,
  getTestset, getOrCreateTestset, listTests, getTest, upsertTest, deleteTest as deleteTestDb,
  upsertTestGroup, getTestGroups, getGroupDependencies,
  listCheckerTests, upsertCheckerTest,
  listValidatorTests, upsertValidatorTest,
  listStatements, getStatement, upsertStatement,
  getProblemNames, upsertProblemName,
  listTags, setTags,
  listProperties, getProperty, setProperty,
  listExecutables, getOrCreateTestset as _getOrCreateTestset,
  getCautions,
} from '../services/problems';
import { getProblemDir, db } from '../db/schema';
import { importPackage } from '../services/import';
import { buildPackage } from '../packages/builder';
import { compileAsset, compileSolution, runInvocation, generateTestAnswer } from '../judging/judging';
import { generateProblemXml } from '../polygon-xml/generator';
import { buildPackage as _buildPackage } from '../packages/builder';

type AuthRequest = FastifyRequest & { user?: { id: number; username: string } };

async function auth(req: FastifyRequest, reply: FastifyReply) {
  const user = await getAuthUser(req);
  if (!user) {
    reply.code(401).send({ status: 'FAILED', comment: 'Not authenticated' });
    throw new Error('Not authenticated');
  }
  return user;
}

function ok(result: unknown) {
  return { status: 'OK', result };
}

function fail(comment: string, code = 400) {
  return { _code: code, status: 'FAILED', comment };
}

function getProblemForUser(problemId: number, userId: number, reply: FastifyReply) {
  const problem = getProblem(problemId, userId);
  if (!problem) {
    reply.code(404).send({ status: 'FAILED', comment: 'Problem not found or access denied' });
    return null;
  }
  return problem;
}

export async function problemRoutes(app: FastifyInstance): Promise<void> {

  // problems.list
  app.get('/api/problems.list', async (req, reply) => {
    const user = await auth(req, reply);
    const problems = listProblems(user.id);
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
    const { name } = req.body as { name?: string };
    if (!name) return reply.code(400).send({ status: 'FAILED', comment: 'name required' });
    if (!/^[a-zA-Z0-9_\-\.]+$/.test(name)) {
      return reply.code(400).send({ status: 'FAILED', comment: 'Invalid short name (alphanumeric, dash, underscore, dot only)' });
    }
    const existing = getProblemByName(name, user.id);
    if (existing) return reply.code(409).send({ status: 'FAILED', comment: 'Problem with this name already exists' });
    const problem = createProblem(user.id, name);
    return ok({ id: problem.id, name: problem.short_name });
  });

  // problem.info
  app.get('/api/problem.info', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    const problem = getProblemForUser(id, user.id, reply);
    if (!problem) return;
    const names = getProblemNames(id);
    const tags = listTags(id);
    const checker = getAsset(id, 'checker');
    const validator = getAsset(id, 'validator');
    const interactor = getAsset(id, 'interactor');
    const solutions = listSolutions(id);
    const testset = getTestset(id, 'tests');
    const tests = testset ? listTests(testset.id) : [];
    const stmts = listStatements(id);
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
      statementsCount: (stmts as unknown[]).length,
    });
  });

  // problem.updateInfo
  app.post('/api/problem.updateInfo', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    const problem = getProblemForUser(id, user.id, reply);
    if (!problem) return;
    const updates: Record<string, unknown> = {};
    if (body.timeLimit) updates.time_limit = parseInt(body.timeLimit);
    if (body.memoryLimit) updates.memory_limit = parseInt(body.memoryLimit);
    if (body.inputFile !== undefined) updates.input_file = body.inputFile;
    if (body.outputFile !== undefined) updates.output_file = body.outputFile;
    if (body.interactive !== undefined) updates.interactive = body.interactive === 'true' ? 1 : 0;
    if (body.runCount) updates.run_count = parseInt(body.runCount);
    updates.modified = 1;
    updateProblem(id, updates);
    if (body.name && body.language) {
      upsertProblemName(id, body.language, body.name);
    }
    return ok(null);
  });

  // problem.statements
  app.get('/api/problem.statements', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    const problem = getProblemForUser(id, user.id, reply);
    if (!problem) return;
    return ok(listStatements(id));
  });

  // problem.saveStatement
  app.post('/api/problem.saveStatement', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id || !body.lang) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and lang required' });
    const problem = getProblemForUser(id, user.id, reply);
    if (!problem) return;
    upsertStatement(id, body.lang, {
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
    updateProblem(id, { modified: 1 });
    // Also write statement sections to disk
    const problemDir = getProblemDir(id);
    const sectionsDir = path.join(problemDir, 'statement-sections', body.lang);
    fs.mkdirSync(sectionsDir, { recursive: true });
    if (body.name !== undefined) fs.writeFileSync(path.join(sectionsDir, 'name.tex'), body.name, 'utf-8');
    if (body.legend !== undefined) fs.writeFileSync(path.join(sectionsDir, 'legend.tex'), body.legend, 'utf-8');
    if (body.input !== undefined) fs.writeFileSync(path.join(sectionsDir, 'input.tex'), body.input, 'utf-8');
    if (body.output !== undefined) fs.writeFileSync(path.join(sectionsDir, 'output.tex'), body.output, 'utf-8');
    if (body.scoring !== undefined) fs.writeFileSync(path.join(sectionsDir, 'scoring.tex'), body.scoring, 'utf-8');
    if (body.interaction !== undefined) fs.writeFileSync(path.join(sectionsDir, 'interaction.tex'), body.interaction, 'utf-8');
    if (body.notes !== undefined) fs.writeFileSync(path.join(sectionsDir, 'notes.tex'), body.notes, 'utf-8');
    if (body.tutorial !== undefined) fs.writeFileSync(path.join(sectionsDir, 'tutorial.tex'), body.tutorial, 'utf-8');
    return ok(null);
  });

  // problem.renderStatements - returns HTML preview
  app.get('/api/problem.renderStatements', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, lang } = req.query as { problemId?: string; lang?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    const problem = getProblemForUser(id, user.id, reply);
    if (!problem) return;
    const stmt = getStatement(id, lang ?? 'russian') as Record<string, string> | null;
    if (!stmt) return ok({ html: '', tutorialHtml: '' });

    // Simple HTML render
    const html = renderStatementHtml(stmt, id, lang ?? 'russian');
    return ok({ html, tutorialHtml: stmt.tutorial ? `<div>${escHtml(stmt.tutorial)}</div>` : '' });
  });

  // problem.files
  app.get('/api/problem.files', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const files = listFiles(id);
    const execs = listExecutables(id);
    return ok({ resources: files.filter(f => f.file_role === 'resource'), executables: execs });
  });

  // problem.saveFile
  app.post('/api/problem.saveFile', { config: { rawBody: true } }, async (req, reply) => {
    const user = await auth(req, reply);
    // Handles multipart or JSON
    const body = req.body as Record<string, unknown>;
    const id = parseInt(String(body.problemId ?? ''));
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    const problem = getProblemForUser(id, user.id, reply);
    if (!problem) return;
    const filePath = String(body.path ?? '');
    const sourceType = String(body.sourceType ?? '');
    const content = body.content as string | undefined;
    if (!filePath) return reply.code(400).send({ status: 'FAILED', comment: 'path required' });

    const problemDir = getProblemDir(id);
    const dest = path.join(problemDir, filePath);
    if (!dest.startsWith(problemDir)) return reply.code(400).send({ status: 'FAILED', comment: 'Invalid path' });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (content !== undefined) fs.writeFileSync(dest, content, 'utf-8');

    upsertFile(id, filePath, { source_type: sourceType });
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.viewFile
  app.get('/api/problem.viewFile', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, path: filePath } = req.query as { problemId?: string; path?: string };
    const id = parseInt(problemId ?? '');
    if (!id || !filePath) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and path required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const problemDir = getProblemDir(id);
    const dest = path.join(problemDir, filePath);
    if (!dest.startsWith(problemDir) || !fs.existsSync(dest)) {
      return reply.code(404).send({ status: 'FAILED', comment: 'File not found' });
    }
    const content = fs.readFileSync(dest);
    reply.header('Content-Type', 'application/octet-stream');
    return reply.send(content);
  });

  // problem.solutions
  app.get('/api/problem.solutions', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    return ok(listSolutions(id));
  });

  // problem.saveSolution
  app.post('/api/problem.saveSolution', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id || !body.sourcePath) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and sourcePath required' });
    if (!getProblemForUser(id, user.id, reply)) return;

    const problemDir = getProblemDir(id);
    const dest = path.join(problemDir, body.sourcePath);
    if (body.content !== undefined) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, body.content, 'utf-8');
    }

    const solId = upsertSolution(id, body.sourcePath, {
      source_type: body.sourceType ?? '',
      tag: body.tag ?? 'accepted',
    });
    updateProblem(id, { modified: 1 });
    return ok({ id: solId });
  });

  // problem.viewSolution
  app.get('/api/problem.viewSolution', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, solutionId } = req.query as { problemId?: string; solutionId?: string };
    const id = parseInt(problemId ?? '');
    const solId = parseInt(solutionId ?? '');
    if (!id || !solId) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and solutionId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const solution = getSolution(solId);
    if (!solution || solution.problem_id !== id) return reply.code(404).send({ status: 'FAILED', comment: 'Solution not found' });
    const problemDir = getProblemDir(id);
    const dest = path.join(problemDir, solution.source_path);
    if (!fs.existsSync(dest)) return reply.code(404).send({ status: 'FAILED', comment: 'File not found' });
    const content = fs.readFileSync(dest, 'utf-8');
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    return reply.send(content);
  });

  // problem.checker
  app.get('/api/problem.checker', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    return ok(getAsset(id, 'checker'));
  });

  // problem.setChecker
  app.post('/api/problem.setChecker', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    upsertAsset(id, 'checker', {
      name: body.name ?? '',
      checker_type: body.type ?? 'testlib',
      source_path: body.sourcePath ?? '',
      source_type: body.sourceType ?? '',
      binary_path: body.binaryPath ?? '',
      binary_type: body.binaryType ?? '',
      copy_path: body.copyPath ?? '',
    });
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.validator
  app.get('/api/problem.validator', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    return ok(getAsset(id, 'validator'));
  });

  // problem.setValidator
  app.post('/api/problem.setValidator', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    upsertAsset(id, 'validator', {
      source_path: body.sourcePath ?? '',
      source_type: body.sourceType ?? '',
    });
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.interactor
  app.get('/api/problem.interactor', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    return ok(getAsset(id, 'interactor'));
  });

  // problem.setInteractor
  app.post('/api/problem.setInteractor', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    upsertAsset(id, 'interactor', {
      source_path: body.sourcePath ?? '',
      source_type: body.sourceType ?? '',
    });
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.tests
  app.get('/api/problem.tests', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, testset: tsName } = req.query as { problemId?: string; testset?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const testset = getTestset(id, tsName ?? 'tests');
    if (!testset) return ok([]);
    const tests = listTests(testset.id);
    const problemDir = getProblemDir(id);
    const inputPattern = testset.input_path_pattern;
    return ok(tests.map(t => {
      const testNum = String(t.idx).padStart(2, '0');
      const inputPath = path.join(problemDir, inputPattern.replace('%02d', testNum));
      return {
        ...t,
        inputAvailable: fs.existsSync(inputPath),
      };
    }));
  });

  // problem.saveTest
  app.post('/api/problem.saveTest', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    const problem = getProblemForUser(id, user.id, reply);
    if (!problem) return;

    const testset = getOrCreateTestset(id, body.testset ?? 'tests');
    const idx = parseInt(body.testIndex ?? '0') || (listTests(testset.id).length + 1);

    upsertTest(testset.id, idx, {
      method: (body.method ?? 'manual') as 'manual' | 'generated',
      cmd: body.scriptLine ?? body.cmd ?? '',
      description: body.description ?? '',
      sample: body.sample === 'true' ? 1 : 0,
      group_name: body.group ?? '',
      points: parseFloat(body.points ?? '0') || 0,
    });

    // Write input to disk if provided
    if (body.input !== undefined) {
      const problemDir = getProblemDir(id);
      const testNum = String(idx).padStart(2, '0');
      const inputPath = path.join(problemDir, testset.input_path_pattern.replace('%02d', testNum));
      fs.mkdirSync(path.dirname(inputPath), { recursive: true });
      fs.writeFileSync(inputPath, body.input, 'utf-8');
    }

    updateProblem(id, { modified: 1 });
    return ok({ testIndex: idx });
  });

  // problem.deleteTest
  app.post('/api/problem.deleteTest', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    const idx = parseInt(body.testIndex ?? '');
    if (!id || !idx) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and testIndex required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const testset = getTestset(id, body.testset ?? 'tests');
    if (!testset) return reply.code(404).send({ status: 'FAILED', comment: 'Testset not found' });
    deleteTestDb(testset.id, idx);
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.testInput
  app.get('/api/problem.testInput', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, testset: tsName, testIndex } = req.query as { problemId?: string; testset?: string; testIndex?: string };
    const id = parseInt(problemId ?? '');
    const idx = parseInt(testIndex ?? '');
    if (!id || !idx) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and testIndex required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const testset = getTestset(id, tsName ?? 'tests');
    if (!testset) return reply.code(404).send({ status: 'FAILED', comment: 'Testset not found' });
    const testNum = String(idx).padStart(2, '0');
    const inputPath = path.join(getProblemDir(id), testset.input_path_pattern.replace('%02d', testNum));
    if (!fs.existsSync(inputPath)) return reply.code(404).send({ status: 'FAILED', comment: 'Input not found' });
    const content = fs.readFileSync(inputPath);
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    return reply.send(content);
  });

  // problem.testAnswer
  app.get('/api/problem.testAnswer', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, testset: tsName, testIndex } = req.query as { problemId?: string; testset?: string; testIndex?: string };
    const id = parseInt(problemId ?? '');
    const idx = parseInt(testIndex ?? '');
    if (!id || !idx) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and testIndex required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const testset = getTestset(id, tsName ?? 'tests');
    if (!testset) return reply.code(404).send({ status: 'FAILED', comment: 'Testset not found' });
    const testNum = String(idx).padStart(2, '0');
    const answerPath = path.join(getProblemDir(id), testset.answer_path_pattern.replace('%02d', testNum));
    if (!fs.existsSync(answerPath)) return reply.code(404).send({ status: 'FAILED', comment: 'Answer not found' });
    const content = fs.readFileSync(answerPath);
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    return reply.send(content);
  });

  // problem.generateAnswers — compile main solution, run on every test, write .a files
  app.post('/api/problem.generateAnswers', async (req, reply) => {
    const user = await auth(req, reply);
    if (!user) return;
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const tsName = body.testset ?? 'tests';
    const testset = getTestset(id, tsName);
    if (!testset) return reply.code(404).send({ status: 'FAILED', comment: 'Testset not found' });
    const problemDir = getProblemDir(id);
    const tests = listTests(testset.id);
    let generated = 0;
    const errors: string[] = [];
    for (const t of tests) {
      const num = String(t.idx).padStart(2, '0');
      const inputPath = path.join(problemDir, testset.input_path_pattern.replace('%02d', num));
      const answerPath = path.join(problemDir, testset.answer_path_pattern.replace('%02d', num));
      if (!fs.existsSync(inputPath)) { errors.push(`Test ${t.idx}: input missing`); continue; }
      const r = await generateTestAnswer(id, inputPath, testset.time_limit ?? 1000, testset.memory_limit ?? 268435456, answerPath);
      if (r.success) {
        generated++;
      } else {
        errors.push(`Test ${t.idx}: ${r.error}`);
      }
    }
    return ok({ generated, errors });
  });

  // problem.setTestGroup
  app.post('/api/problem.setTestGroup', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    const idx = parseInt(body.testIndex ?? '');
    if (!id || !idx) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and testIndex required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const testset = getTestset(id, body.testset ?? 'tests');
    if (!testset) return reply.code(404).send({ status: 'FAILED', comment: 'Testset not found' });
    upsertTest(testset.id, idx, { group_name: body.group ?? '' });
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.enableGroups
  app.post('/api/problem.enableGroups', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const testset = getOrCreateTestset(id, body.testset ?? 'tests');
    const enabled = body.enable !== 'false' ? 1 : 0;
    db.prepare('UPDATE testsets SET groups_enabled = ? WHERE id = ?').run(enabled, testset.id);
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.enablePoints
  app.post('/api/problem.enablePoints', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const testset = getOrCreateTestset(id, body.testset ?? 'tests');
    const enabled = body.enable !== 'false' ? 1 : 0;
    db.prepare('UPDATE testsets SET points_enabled = ? WHERE id = ?').run(enabled, testset.id);
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.enableTreatPointsFromCheckerAsPercent
  app.post('/api/problem.enableTreatPointsFromCheckerAsPercent', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const testset = getOrCreateTestset(id, body.testset ?? 'tests');
    const enabled = body.enable !== 'false' ? 1 : 0;
    db.prepare('UPDATE testsets SET treat_points_from_checker_as_percent = ? WHERE id = ?').run(enabled, testset.id);
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.viewTestGroup
  app.get('/api/problem.viewTestGroup', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, testset: tsName } = req.query as { problemId?: string; testset?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const testset = getTestset(id, tsName ?? 'tests');
    if (!testset) return ok([]);
    const groups = getTestGroups(testset.id);
    return ok(groups.map(g => ({
      ...g,
      dependencies: getGroupDependencies(g.id),
    })));
  });

  // problem.saveTestGroup
  app.post('/api/problem.saveTestGroup', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id || !body.groupName) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and groupName required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const testset = getOrCreateTestset(id, body.testset ?? 'tests');
    upsertTestGroup(testset.id, body.groupName, {
      points: parseFloat(body.points ?? '0') || 0,
      pointsPolicy: body.pointsPolicy ?? 'each-test',
      feedbackPolicy: body.feedbackPolicy ?? 'complete',
      dependencies: body.dependencies ? body.dependencies.split(',').filter(Boolean) : [],
    });
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.checkerTests
  app.get('/api/problem.checkerTests', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    return ok(listCheckerTests(id));
  });

  // problem.saveCheckerTest
  app.post('/api/problem.saveCheckerTest', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const tests = listCheckerTests(id);
    const idx = parseInt(body.testIndex ?? '0') || (tests.length + 1);
    upsertCheckerTest(id, idx, {
      input: body.input ?? '',
      output_data: body.output ?? '',
      answer: body.answer ?? '',
      expected_verdict: body.expectedVerdict ?? 'OK',
    });
    updateProblem(id, { modified: 1 });
    return ok({ testIndex: idx });
  });

  // problem.validatorTests
  app.get('/api/problem.validatorTests', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    return ok(listValidatorTests(id));
  });

  // problem.saveValidatorTest
  app.post('/api/problem.saveValidatorTest', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const tests = listValidatorTests(id);
    const idx = parseInt(body.testIndex ?? '0') || (tests.length + 1);
    upsertValidatorTest(id, 0, idx, {
      input: body.input ?? '',
      expected_verdict: body.expectedVerdict ?? 'VALID',
      testset_name: body.testset ?? '',
      group_name: body.group ?? '',
    });
    updateProblem(id, { modified: 1 });
    return ok({ testIndex: idx });
  });

  // problem.viewTags
  app.get('/api/problem.viewTags', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    return ok(listTags(id));
  });

  // problem.saveTags
  app.post('/api/problem.saveTags', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { problemId?: string; tags?: string | string[] };
    const id = parseInt(String(body.problemId ?? ''));
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const tags = Array.isArray(body.tags) ? body.tags : (body.tags ?? '').split(',').map(t => t.trim()).filter(Boolean);
    setTags(id, tags);
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.viewGeneralDescription
  app.get('/api/problem.viewGeneralDescription', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    const problem = getProblemForUser(id, user.id, reply);
    if (!problem) return;
    return ok(problem.general_description);
  });

  // problem.saveGeneralDescription
  app.post('/api/problem.saveGeneralDescription', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { problemId?: string; description?: string };
    const id = parseInt(String(body.problemId ?? ''));
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    updateProblem(id, { general_description: body.description ?? '', modified: 1 });
    return ok(null);
  });

  // problem.viewGeneralTutorial
  app.get('/api/problem.viewGeneralTutorial', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    const problem = getProblemForUser(id, user.id, reply);
    if (!problem) return;
    return ok(problem.general_tutorial);
  });

  // problem.saveGeneralTutorial
  app.post('/api/problem.saveGeneralTutorial', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { problemId?: string; tutorial?: string };
    const id = parseInt(String(body.problemId ?? ''));
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    updateProblem(id, { general_tutorial: body.tutorial ?? '', modified: 1 });
    return ok(null);
  });

  // problem.cautions
  app.get('/api/problem.cautions', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    return ok({ cautions: getCautions(id), aiTips: [] });
  });

  // problem.packages
  app.get('/api/problem.packages', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const packages = db.prepare('SELECT * FROM packages WHERE problem_id = ? ORDER BY created_at DESC').all(id);
    return ok(packages);
  });

  // problem.buildPackage
  app.post('/api/problem.buildPackage', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    const problem = getProblemForUser(id, user.id, reply);
    if (!problem) return;
    const type = (body.type ?? 'standard') as 'standard' | 'linux' | 'windows';
    const comment = body.comment ?? '';

    const result = db.prepare(
      "INSERT INTO packages (problem_id, revision, type, state, comment) VALUES (?, ?, ?, 'PENDING', ?)"
    ).run(id, problem.revision, type, comment);
    const packageId = result.lastInsertRowid as number;

    // Build asynchronously
    buildPackage(id, packageId, { type, comment }).catch(e => {
      console.error('Package build failed:', e);
    });

    return ok({ packageId, state: 'PENDING' });
  });

  // problem.package - download
  app.get('/api/problem.package', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, packageId } = req.query as { problemId?: string; packageId?: string };
    const id = parseInt(problemId ?? '');
    const pkgId = parseInt(packageId ?? '');
    if (!id || !pkgId) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and packageId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const pkg = db.prepare('SELECT * FROM packages WHERE id = ? AND problem_id = ?').get(pkgId, id) as { state: string; file_path: string; type: string } | undefined;
    if (!pkg) return reply.code(404).send({ status: 'FAILED', comment: 'Package not found' });
    if (pkg.state !== 'READY') return reply.code(400).send({ status: 'FAILED', comment: `Package state: ${pkg.state}` });
    if (!fs.existsSync(pkg.file_path)) return reply.code(404).send({ status: 'FAILED', comment: 'Package file missing' });
    const filename = path.basename(pkg.file_path);
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Content-Type', 'application/zip');
    return reply.send(fs.createReadStream(pkg.file_path));
  });

  // problem.editSolutionExtraTags
  app.post('/api/problem.editSolutionExtraTags', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    const solId = parseInt(body.solutionId ?? '');
    if (!id || !solId) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and solutionId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const solution = getSolution(solId);
    if (!solution || solution.problem_id !== id) return reply.code(404).send({ status: 'FAILED', comment: 'Solution not found' });
    // Tags are stored in the tag field; extra tags not separately modeled
    db.prepare('UPDATE solutions SET tag = ? WHERE id = ?').run(body.tag ?? solution.tag, solId);
    return ok(null);
  });

  // problem.script - get doall script
  app.get('/api/problem.script', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, type } = req.query as { problemId?: string; type?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const scriptName = type === 'windows' ? 'doall.bat' : 'doall.sh';
    const scriptPath = path.join(getProblemDir(id), scriptName);
    if (!fs.existsSync(scriptPath)) {
      return reply.code(404).send({ status: 'FAILED', comment: 'Script not found' });
    }
    const content = fs.readFileSync(scriptPath, 'utf-8');
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    return reply.send(content);
  });

  // problem.saveScript
  app.post('/api/problem.saveScript', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const scriptName = body.type === 'windows' ? 'doall.bat' : 'doall.sh';
    const scriptPath = path.join(getProblemDir(id), scriptName);
    fs.writeFileSync(scriptPath, body.content ?? '', 'utf-8');
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.clearScript
  app.post('/api/problem.clearScript', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const scriptName = body.type === 'windows' ? 'doall.bat' : 'doall.sh';
    const scriptPath = path.join(getProblemDir(id), scriptName);
    if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.previewTests - list tests with available info
  app.get('/api/problem.previewTests', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, testset: tsName } = req.query as { problemId?: string; testset?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const testset = getTestset(id, tsName ?? 'tests');
    if (!testset) return ok([]);
    const tests = listTests(testset.id);
    const problemDir = getProblemDir(id);
    return ok(tests.map(t => {
      const testNum = String(t.idx).padStart(2, '0');
      const inputPath = path.join(problemDir, testset.input_path_pattern.replace('%02d', testNum));
      const answerPath = path.join(problemDir, testset.answer_path_pattern.replace('%02d', testNum));
      let inputPreview = '';
      if (fs.existsSync(inputPath)) {
        try { inputPreview = fs.readFileSync(inputPath, 'utf-8').slice(0, 200); } catch { /**/ }
      }
      return {
        ...t,
        inputAvailable: fs.existsSync(inputPath),
        answerAvailable: fs.existsSync(answerPath),
        inputPreview,
      };
    }));
  });

  // problem.updateWorkingCopy - increment revision
  app.post('/api/problem.updateWorkingCopy', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    const problem = getProblemForUser(id, user.id, reply);
    if (!problem) return;
    updateProblem(id, { revision: problem.revision + 1, modified: 1 });
    return ok(null);
  });

  // problem.commitChanges
  app.post('/api/problem.commitChanges', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    updateProblem(id, { modified: 0 });
    return ok(null);
  });

  // problem.discardWorkingCopy
  app.post('/api/problem.discardWorkingCopy', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    updateProblem(id, { modified: 0 });
    return ok(null);
  });

  // Invocations
  app.get('/api/problem.invocations', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const invocations = db.prepare('SELECT * FROM invocations WHERE problem_id = ? ORDER BY created_at DESC').all(id);
    return ok(invocations);
  });

  app.post('/api/problem.runInvocation', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;

    const solutionIds = (body.solutionIds ?? '').split(',').map(Number).filter(Boolean);
    const testsetName = body.testset ?? 'tests';

    const result = db.prepare(
      "INSERT INTO invocations (problem_id, testset_name, state) VALUES (?, ?, 'PENDING')"
    ).run(id, testsetName);
    const invocationId = result.lastInsertRowid as number;

    if (solutionIds.length === 0) {
      // Default: all solutions
      const solutions = listSolutions(id);
      solutionIds.push(...solutions.map(s => s.id));
    }

    runInvocation(id, invocationId, solutionIds, testsetName).catch(e => {
      console.error('Invocation failed:', e);
    });

    return ok({ invocationId, state: 'PENDING' });
  });

  app.get('/api/problem.invocationResults', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, invocationId } = req.query as { problemId?: string; invocationId?: string };
    const id = parseInt(problemId ?? '');
    const invId = parseInt(invocationId ?? '');
    if (!id || !invId) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and invocationId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const invocation = db.prepare('SELECT * FROM invocations WHERE id = ? AND problem_id = ?').get(invId, id) as { state: string } | undefined;
    if (!invocation) return reply.code(404).send({ status: 'FAILED', comment: 'Invocation not found' });
    const runs = db.prepare('SELECT * FROM invocation_runs WHERE invocation_id = ? ORDER BY solution_id, test_idx').all(invId);
    return ok({ state: invocation.state, runs });
  });

  // Upload package
  app.post('/api/problem.importPackage', async (req, reply) => {
    const user = await auth(req, reply);
    if (!user) return;

    const data = await req.file();
    if (!data) return reply.code(400).send({ status: 'FAILED', comment: 'No file uploaded' });

    const tmpPath = `/tmp/upload_${Date.now()}_${Math.random().toString(36).slice(2)}.zip`;
    try {
      await new Promise<void>((resolve, reject) => {
        const stream = fs.createWriteStream(tmpPath);
        data.file.pipe(stream);
        stream.on('finish', resolve);
        stream.on('error', reject);
      });

      const overwrite = (req.query as Record<string, string>).overwrite === 'true';
      const result = await importPackage(tmpPath, user.id, overwrite);
      return ok(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ status: 'FAILED', comment: msg });
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  });

  // problem.stresses
  app.get('/api/problem.stresses', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const stresses = db.prepare('SELECT * FROM stresses WHERE problem_id = ?').all(id);
    return ok(stresses);
  });

  // problem.saveStress
  app.post('/api/problem.saveStress', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const result = db.prepare(
      'INSERT INTO stresses (problem_id, generator_cmd, solution_path, name) VALUES (?, ?, ?, ?)'
    ).run(id, body.generatorCmd ?? '', body.solutionPath ?? '', body.name ?? '');
    updateProblem(id, { modified: 1 });
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
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    // Return empty for now - TODO: support multiple validators
    return ok([]);
  });

  // problem.statementResources
  app.get('/api/problem.statementResources', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, lang } = req.query as { problemId?: string; lang?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const problemDir = getProblemDir(id);
    const stmtDir = path.join(problemDir, 'statements', lang ?? 'russian');
    const resources: string[] = [];
    if (fs.existsSync(stmtDir)) {
      for (const f of fs.readdirSync(stmtDir)) {
        resources.push(f);
      }
    }
    return ok(resources);
  });

  // problem.viewStatementResource
  app.get('/api/problem.viewStatementResource', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, lang, name } = req.query as { problemId?: string; lang?: string; name?: string };
    const id = parseInt(problemId ?? '');
    if (!id || !name) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and name required' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const problemDir = getProblemDir(id);
    const filePath = path.join(problemDir, 'statements', lang ?? 'russian', name);
    if (!filePath.startsWith(problemDir) || !fs.existsSync(filePath)) {
      return reply.code(404).send({ status: 'FAILED', comment: 'Resource not found' });
    }
    const content = fs.readFileSync(filePath);
    const ext = path.extname(name).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.jpg' ? 'image/jpeg' : ext === '.pdf' ? 'application/pdf' : 'application/octet-stream';
    reply.header('Content-Type', mime);
    return reply.send(content);
  });

  // problem.saveStatementResource
  app.post('/api/problem.saveStatementResource', async (req, reply) => {
    const user = await auth(req, reply);
    const data = await req.file();
    const fields = data?.fields as Record<string, { value: string }> | undefined;
    const id = parseInt(fields?.problemId?.value ?? '');
    const lang = fields?.lang?.value ?? 'russian';
    if (!id || !data) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required and file needed' });
    if (!getProblemForUser(id, user.id, reply)) return;
    const problemDir = getProblemDir(id);
    const stmtDir = path.join(problemDir, 'statements', lang);
    fs.mkdirSync(stmtDir, { recursive: true });
    const dest = path.join(stmtDir, data.filename);
    const buffer = await data.toBuffer();
    fs.writeFileSync(dest, buffer);
    updateProblem(id, { modified: 1 });
    return ok({ name: data.filename });
  });
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderStatementHtml(stmt: Record<string, string>, problemId: number, lang: string): string {
  const problemDir = getProblemDir(problemId);
  const htmlFile = path.join(problemDir, 'statements', '.html', lang, 'problem.html');
  if (fs.existsSync(htmlFile)) {
    return fs.readFileSync(htmlFile, 'utf-8');
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
