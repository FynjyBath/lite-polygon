import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';
import { getAuthUser } from './auth';
import { findUserByUsername } from '../services/auth';
import {
  listAllProblems, getProblem, getProblemByName, createProblem, updateProblem, deleteProblem, cloneProblem,
  canAccessProblem, listProblemsForUser, shareProblemWith, unshareProblem, listProblemShares,
  listSolutions, getSolution, getSolutionByPath, upsertSolution, deleteSolution,
  getAsset, upsertAsset, listFiles, upsertFile,
  getTestset, getOrCreateTestset, listTests, getTest, upsertTest, deleteTest as deleteTestDb,
  upsertTestGroup, getTestGroups, getGroupDependencies, getDerivedTestGroups,
  listCheckerTests, upsertCheckerTest,
  listValidatorTests, upsertValidatorTest,
  listStatements, getStatement, upsertStatement,
  getProblemNames, upsertProblemName,
  listTags, setTags,
  listProperties, getProperty, setProperty,
  listExecutables, getOrCreateTestset as _getOrCreateTestset,
  getCautions,
} from '../services/problems';
import { getProblemDir, getRevisionsDir, db } from '../db/schema';
import { safeJoin, isPlainName } from '../utils/safePath';
import { importPackage } from '../services/import';
import { buildPackage } from '../packages/builder';
import { compileAsset, compileSolution, runInvocation, generateTestAnswer, generateTestInput } from '../judging/judging';
import { expandScriptToLines } from '../services/freemarker';
import { verifyProblem } from '../services/verify';
import { commitRevision, listRevisions, restoreRevision, deleteRevision, cloneRevisions } from '../services/revisions';
import { compileStatementPdf, statementPdfPath } from '../services/tex';
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

function getProblemForUser(problemId: number, user: { id: number; username: string }, reply: FastifyReply) {
  const problem = getProblem(problemId);
  if (!problem || (user.username !== 'admin' && !canAccessProblem(problemId, user.id))) {
    reply.code(404).send({ status: 'FAILED', comment: 'Problem not found or access denied' });
    return null;
  }
  return problem;
}

// Only the owner (or admin) may manage a problem's shares.
function canManageProblem(problemId: number, user: { id: number; username: string }): boolean {
  if (user.username === 'admin') return true;
  const p = getProblem(problemId);
  return !!p && p.owner_id === user.id;
}

// In-memory progress for the answer-generation background job, keyed by problem.
interface AnswerGenJob { total: number; done: number; generated: number; errors: string[]; running: boolean; startedAt: number; finishedAt?: number; }
const answerGenJobs = new Map<number, AnswerGenJob>();
// Only expose a capped slice of errors to keep responses small.
function publicJob(j: AnswerGenJob) {
  return { running: j.running, total: j.total, done: j.done, generated: j.generated, errors: j.errors.slice(0, 50), errorCount: j.errors.length };
}

export async function problemRoutes(app: FastifyInstance): Promise<void> {

  // problems.list — owned + shared problems; the real owner is always shown
  app.get('/api/problems.list', async (req, reply) => {
    const user = await auth(req, reply);
    const isAdmin = user.username === 'admin';
    const problems = isAdmin ? listAllProblems() : listProblemsForUser(user.id);
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
      ownerUsername: (p as unknown as { owner_username: string }).owner_username,
      isOwner: p.owner_id === user.id,
    })));
  });

  // problem.shares — list users a problem is shared with (owner/admin only)
  app.get('/api/problem.shares', async (req, reply) => {
    const user = await auth(req, reply);
    const id = parseInt((req.query as { problemId?: string }).problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!canManageProblem(id, user)) return reply.code(403).send({ status: 'FAILED', comment: 'Only the owner can manage sharing' });
    return ok(listProblemShares(id));
  });

  // problem.share — grant another user access by username (owner/admin only)
  app.post('/api/problem.share', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { problemId?: number | string; username?: string };
    const id = parseInt(String(body.problemId ?? ''));
    const username = (body.username ?? '').trim();
    if (!id || !username) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and username required' });
    if (!canManageProblem(id, user)) return reply.code(403).send({ status: 'FAILED', comment: 'Only the owner can manage sharing' });
    const target = findUserByUsername(username);
    if (!target) return reply.code(404).send({ status: 'FAILED', comment: `User "${username}" not found` });
    const owner = getProblem(id)!.owner_id;
    if (target.id === owner) return reply.code(400).send({ status: 'FAILED', comment: 'That user already owns this problem' });
    shareProblemWith(id, target.id);
    return ok(listProblemShares(id));
  });

  // problem.unshare — revoke a user's access (owner/admin only)
  app.post('/api/problem.unshare', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { problemId?: number | string; username?: string };
    const id = parseInt(String(body.problemId ?? ''));
    const username = (body.username ?? '').trim();
    if (!id || !username) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and username required' });
    if (!canManageProblem(id, user)) return reply.code(403).send({ status: 'FAILED', comment: 'Only the owner can manage sharing' });
    const target = findUserByUsername(username);
    if (target) unshareProblem(id, target.id);
    return ok(listProblemShares(id));
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

  // problem.delete — owner (or admin) only; shared collaborators cannot delete
  app.post('/api/problem.delete', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.body as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblem(id)) return reply.code(404).send({ status: 'FAILED', comment: 'Problem not found' });
    if (!canManageProblem(id, user)) return reply.code(403).send({ status: 'FAILED', comment: 'Only the owner can delete this problem' });
    const problemDir = getProblemDir(id);
    deleteProblem(id);
    if (fs.existsSync(problemDir)) fs.rmSync(problemDir, { recursive: true, force: true });
    const revDir = getRevisionsDir(id);
    if (fs.existsSync(revDir)) fs.rmSync(revDir, { recursive: true, force: true });
    return ok(null);
  });

  // problem.clone — duplicate a problem (DB rows + files) into a new problem
  app.post('/api/problem.clone', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.body as { problemId?: string | number };
    const id = parseInt(String(problemId ?? ''));
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    const source = getProblemForUser(id, user, reply);
    if (!source) return;

    // Pick a unique short name: "<name>-copy", then "-copy-2", "-copy-3", …
    const base = `${source.short_name}-copy`;
    let newName = base;
    for (let n = 2; getProblemByName(newName, user.id); n++) newName = `${base}-${n}`;

    let newId: number;
    try { newId = cloneProblem(id, user.id, newName); }
    catch (e: unknown) { return reply.code(400).send({ status: 'FAILED', comment: (e as Error).message }); }

    // Copy files on disk (skip workdir — it holds stale compiled binaries).
    const srcDir = getProblemDir(id);
    const dstDir = getProblemDir(newId);
    if (fs.existsSync(srcDir)) {
      fs.cpSync(srcDir, dstDir, { recursive: true, filter: (s) => path.basename(s) !== 'workdir' });
    }
    fs.mkdirSync(path.join(dstDir, 'workdir'), { recursive: true });

    // Carry over the full revision history (DB rows + snapshot files).
    cloneRevisions(id, newId);

    return ok({ id: newId, shortName: newName });
  });

  // problem.info
  app.get('/api/problem.info', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    const problem = getProblemForUser(id, user, reply);
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
      polygonProblemId: (problem as unknown as Record<string, unknown>).polygon_problem_id as number | null ?? null,
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
    const problem = getProblemForUser(id, user, reply);
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
    // Keep per-testset limits (which take priority in the builder/runner) in
    // sync with the problem-level limits the user just edited, otherwise an
    // imported testset's stale limit would override the new value.
    if (updates.time_limit !== undefined || updates.memory_limit !== undefined) {
      const sets: string[] = [];
      const vals: unknown[] = [];
      if (updates.time_limit !== undefined) { sets.push('time_limit = ?'); vals.push(updates.time_limit); }
      if (updates.memory_limit !== undefined) { sets.push('memory_limit = ?'); vals.push(updates.memory_limit); }
      vals.push(id);
      db.prepare(`UPDATE testsets SET ${sets.join(', ')} WHERE problem_id = ?`).run(...vals);
    }
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
    const problem = getProblemForUser(id, user, reply);
    if (!problem) return;
    return ok(listStatements(id));
  });

  // problem.saveStatement
  app.post('/api/problem.saveStatement', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id || !body.lang) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and lang required' });
    if (!isPlainName(body.lang)) return reply.code(400).send({ status: 'FAILED', comment: 'Invalid lang' });
    const problem = getProblemForUser(id, user, reply);
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
    if (!isPlainName(lang ?? 'russian')) return reply.code(400).send({ status: 'FAILED', comment: 'Invalid lang' });
    const problem = getProblemForUser(id, user, reply);
    if (!problem) return;
    const stmt = getStatement(id, lang ?? 'russian') as Record<string, string> | null;
    if (!stmt) return ok({ html: '', tutorialHtml: '' });

    // Simple HTML render
    const html = renderStatementHtml(stmt, id, lang ?? 'russian');
    return ok({ html, tutorialHtml: stmt.tutorial ? `<div>${escHtml(stmt.tutorial)}</div>` : '' });
  });

  // problem.compileStatement — render the Polygon LaTeX templates and run
  // pdflatex; returns the compile log. The PDF is fetched via statementPdf.
  app.post('/api/problem.compileStatement', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { problemId?: string | number; lang?: string };
    const id = parseInt(String(body.problemId ?? ''));
    const lang = body.lang ?? 'russian';
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!isPlainName(lang)) return reply.code(400).send({ status: 'FAILED', comment: 'Invalid lang' });
    if (!getProblemForUser(id, user, reply)) return;
    try {
      const result = await compileStatementPdf(id, lang);
      return ok(result);
    } catch (e: unknown) {
      return reply.code(400).send({ status: 'FAILED', comment: (e as Error).message });
    }
  });

  // problem.statementPdf — stream the last compiled PDF for inline view/download
  app.get('/api/problem.statementPdf', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, lang, download } = req.query as { problemId?: string; lang?: string; download?: string };
    const id = parseInt(problemId ?? '');
    const language = lang ?? 'russian';
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!isPlainName(language)) return reply.code(400).send({ status: 'FAILED', comment: 'Invalid lang' });
    if (!getProblemForUser(id, user, reply)) return;
    const pdf = statementPdfPath(id, language);
    if (!fs.existsSync(pdf)) return reply.code(404).send({ status: 'FAILED', comment: 'No compiled PDF — compile first' });
    reply.header('Content-Type', 'application/pdf');
    const problem = getProblem(id);
    const fname = `${problem?.short_name ?? 'statement'}-${language}.pdf`;
    reply.header('Content-Disposition', `${download === 'true' ? 'attachment' : 'inline'}; filename="${fname}"`);
    return reply.send(fs.createReadStream(pdf));
  });

  // problem.files
  app.get('/api/problem.files', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
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
    const problem = getProblemForUser(id, user, reply);
    if (!problem) return;
    const filePath = String(body.path ?? '');
    const sourceType = String(body.sourceType ?? '');
    const content = body.content as string | undefined;
    if (!filePath) return reply.code(400).send({ status: 'FAILED', comment: 'path required' });

    const problemDir = getProblemDir(id);
    const dest = safeJoin(problemDir, filePath);
    if (!dest) return reply.code(400).send({ status: 'FAILED', comment: 'Invalid path' });
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
    if (!getProblemForUser(id, user, reply)) return;
    const problemDir = getProblemDir(id);
    const dest = safeJoin(problemDir, filePath);
    if (!dest || !fs.existsSync(dest)) {
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
    if (!getProblemForUser(id, user, reply)) return;
    const problemDir = getProblemDir(id);
    const solutions = listSolutions(id).map(s => {
      const filePath = path.join(problemDir, s.source_path);
      let size = 0, modified = '';
      try { const st = fs.statSync(filePath); size = st.size; modified = st.mtime.toISOString(); } catch { /* file missing */ }
      return { ...s, size, modified, author: user.username };
    });
    return ok(solutions);
  });

  // problem.saveSolution
  app.post('/api/problem.saveSolution', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id || !body.sourcePath) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and sourcePath required' });
    if (!getProblemForUser(id, user, reply)) return;

    const problemDir = getProblemDir(id);
    const dest = safeJoin(problemDir, body.sourcePath);
    if (!dest) return reply.code(400).send({ status: 'FAILED', comment: 'Invalid sourcePath' });
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
    if (!getProblemForUser(id, user, reply)) return;
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
    if (!getProblemForUser(id, user, reply)) return;
    return ok(getAsset(id, 'checker'));
  });

  // problem.setChecker
  app.post('/api/problem.setChecker', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
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
    if (!getProblemForUser(id, user, reply)) return;
    return ok(getAsset(id, 'validator'));
  });

  // problem.setValidator
  app.post('/api/problem.setValidator', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
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
    if (!getProblemForUser(id, user, reply)) return;
    return ok(getAsset(id, 'interactor'));
  });

  // problem.setInteractor
  app.post('/api/problem.setInteractor', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
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
    if (!getProblemForUser(id, user, reply)) return;
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
    const problem = getProblemForUser(id, user, reply);
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
    if (!getProblemForUser(id, user, reply)) return;
    const testset = getTestset(id, body.testset ?? 'tests');
    if (!testset) return reply.code(404).send({ status: 'FAILED', comment: 'Testset not found' });

    // Delete files and rename subsequent ones to close the gap
    const problemDir = getProblemDir(id);
    const tests = listTests(testset.id);
    const maxIdx = tests.length > 0 ? tests[tests.length - 1].idx : 0;
    const delNum = String(idx).padStart(2, '0');
    const delIn = path.join(problemDir, testset.input_path_pattern.replace('%02d', delNum));
    const delAns = path.join(problemDir, testset.answer_path_pattern.replace('%02d', delNum));
    if (fs.existsSync(delIn)) fs.unlinkSync(delIn);
    if (fs.existsSync(delAns)) fs.unlinkSync(delAns);
    for (let i = idx + 1; i <= maxIdx; i++) {
      const oldN = String(i).padStart(2, '0');
      const newN = String(i - 1).padStart(2, '0');
      const oIn = path.join(problemDir, testset.input_path_pattern.replace('%02d', oldN));
      const nIn = path.join(problemDir, testset.input_path_pattern.replace('%02d', newN));
      const oAns = path.join(problemDir, testset.answer_path_pattern.replace('%02d', oldN));
      const nAns = path.join(problemDir, testset.answer_path_pattern.replace('%02d', newN));
      if (fs.existsSync(oIn)) fs.renameSync(oIn, nIn);
      if (fs.existsSync(oAns)) fs.renameSync(oAns, nAns);
    }

    deleteTestDb(testset.id, idx);
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.updateTest — update metadata (sample/group/points/description) without touching input file
  app.post('/api/problem.updateTest', async (req, reply) => {
    const user = await auth(req, reply);
    if (!user) return;
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    const testIndex = parseInt(body.testIndex ?? '');
    if (!id || !testIndex) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and testIndex required' });
    if (!getProblemForUser(id, user, reply)) return;
    const testset = getOrCreateTestset(id, body.testset ?? 'tests');
    const updates: Record<string, unknown> = {};
    if (body.sample !== undefined) updates.sample = body.sample === 'true' ? 1 : 0;
    if (body.group !== undefined) updates.group_name = body.group;
    if (body.points !== undefined) updates.points = parseFloat(body.points) || 0;
    if (body.description !== undefined) updates.description = body.description;
    upsertTest(testset.id, testIndex, updates);
    // Assigning a group/points implicitly turns on grouping/points for the
    // testset, so groups derived from test names take effect everywhere.
    if (body.group && body.group.trim()) db.prepare('UPDATE testsets SET groups_enabled = 1 WHERE id = ?').run(testset.id);
    if (body.points !== undefined && (parseFloat(body.points) || 0) > 0) db.prepare('UPDATE testsets SET points_enabled = 1 WHERE id = ?').run(testset.id);
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.moveTest — swap a test with its neighbour (direction: up|down)
  app.post('/api/problem.moveTest', async (req, reply) => {
    const user = await auth(req, reply);
    if (!user) return;
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    const testIndex = parseInt(body.testIndex ?? '');
    const direction = body.direction ?? 'up';
    if (!id || !testIndex) return reply.code(400).send({ status: 'FAILED', comment: 'required' });
    if (!getProblemForUser(id, user, reply)) return;
    const testset = getOrCreateTestset(id, body.testset ?? 'tests');
    const otherIndex = direction === 'up' ? testIndex - 1 : testIndex + 1;
    const tests = listTests(testset.id);
    const maxIdx = tests.length > 0 ? tests[tests.length - 1].idx : 0;
    if (otherIndex < 1 || otherIndex > maxIdx) return reply.code(400).send({ status: 'FAILED', comment: 'Cannot move' });

    // Swap DB indices via temp (-1)
    db.prepare('UPDATE tests SET idx = -1 WHERE testset_id = ? AND idx = ?').run(testset.id, testIndex);
    db.prepare('UPDATE tests SET idx = ? WHERE testset_id = ? AND idx = ?').run(testIndex, testset.id, otherIndex);
    db.prepare('UPDATE tests SET idx = ? WHERE testset_id = ? AND idx = -1').run(otherIndex, testset.id);

    // Swap files on disk
    const problemDir = getProblemDir(id);
    const n1 = String(testIndex).padStart(2, '0');
    const n2 = String(otherIndex).padStart(2, '0');
    for (const pat of [testset.input_path_pattern, testset.answer_path_pattern]) {
      const f1 = path.join(problemDir, pat.replace('%02d', n1));
      const f2 = path.join(problemDir, pat.replace('%02d', n2));
      const tmp = f1 + '._swap';
      if (fs.existsSync(f1)) fs.renameSync(f1, tmp);
      if (fs.existsSync(f2)) fs.renameSync(f2, f1);
      if (fs.existsSync(tmp)) fs.renameSync(tmp, f2);
    }

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
    if (!getProblemForUser(id, user, reply)) return;
    const testset = getTestset(id, tsName ?? 'tests');
    if (!testset) return reply.code(404).send({ status: 'FAILED', comment: 'Testset not found' });
    const testNum = String(idx).padStart(2, '0');
    const inputPath = path.join(getProblemDir(id), testset.input_path_pattern.replace('%02d', testNum));
    if (!fs.existsSync(inputPath)) return reply.code(404).send({ status: 'FAILED', comment: 'Input not found' });
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    return reply.send(fs.createReadStream(inputPath));
  });

  // problem.testAnswer
  app.get('/api/problem.testAnswer', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, testset: tsName, testIndex } = req.query as { problemId?: string; testset?: string; testIndex?: string };
    const id = parseInt(problemId ?? '');
    const idx = parseInt(testIndex ?? '');
    if (!id || !idx) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and testIndex required' });
    if (!getProblemForUser(id, user, reply)) return;
    const testset = getTestset(id, tsName ?? 'tests');
    if (!testset) return reply.code(404).send({ status: 'FAILED', comment: 'Testset not found' });
    const testNum = String(idx).padStart(2, '0');
    const answerPath = path.join(getProblemDir(id), testset.answer_path_pattern.replace('%02d', testNum));
    if (!fs.existsSync(answerPath)) return reply.code(404).send({ status: 'FAILED', comment: 'Answer not found' });
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    return reply.send(fs.createReadStream(answerPath));
  });

  // problem.generateAnswers — compile main solution, run on every test, write .a
  // files. Runs as a background job so the client can poll live progress.
  app.post('/api/problem.generateAnswers', async (req, reply) => {
    const user = await auth(req, reply);
    if (!user) return;
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    const problem = getProblemForUser(id, user, reply);
    if (!problem) return;
    const tsName = body.testset ?? 'tests';
    const testset = getTestset(id, tsName);
    if (!testset) return reply.code(404).send({ status: 'FAILED', comment: 'Testset not found' });
    // The testset limits are only set on import; otherwise use the problem-level
    // limits the user edits (mirrors the invocation runner and package builder).
    const answerTimeLimit = testset.time_limit ?? problem.time_limit ?? 1000;
    const answerMemLimit = testset.memory_limit ?? problem.memory_limit ?? 268435456;

    const existing = answerGenJobs.get(id);
    if (existing?.running) return ok({ started: false, alreadyRunning: true, ...publicJob(existing) });

    const problemDir = getProblemDir(id);
    const tests = listTests(testset.id);
    const job: AnswerGenJob = { total: tests.length, done: 0, generated: 0, errors: [], running: true, startedAt: Date.now() };
    answerGenJobs.set(id, job);

    // Fire-and-forget; progress is read via problem.generateAnswersProgress.
    (async () => {
      for (const t of tests) {
        const num = String(t.idx).padStart(2, '0');
        const inputPath = path.join(problemDir, testset.input_path_pattern.replace('%02d', num));
        const answerPath = path.join(problemDir, testset.answer_path_pattern.replace('%02d', num));

        // Materialize the input first for generated tests that have no file yet.
        if (!fs.existsSync(inputPath) && t.method === 'generated' && t.cmd) {
          try {
            const g = await generateTestInput(id, testset.id, t.idx);
            if (g.success) {
              fs.mkdirSync(path.dirname(inputPath), { recursive: true });
              fs.copyFileSync(g.inputPath, inputPath);
            }
          } catch { /* fall through to the missing-input error below */ }
        }
        if (!fs.existsSync(inputPath)) { job.errors.push(`Test ${t.idx}: input missing`); job.done++; continue; }

        try {
          const r = await generateTestAnswer(id, inputPath, answerTimeLimit, answerMemLimit, answerPath);
          if (r.success) job.generated++;
          else job.errors.push(`Test ${t.idx}: ${r.error}`);
        } catch (e: unknown) {
          job.errors.push(`Test ${t.idx}: ${(e as Error).message}`);
        }
        job.done++;
      }
      job.running = false;
      job.finishedAt = Date.now();
    })().catch(e => { job.running = false; job.finishedAt = Date.now(); job.errors.push(String(e)); });

    return ok({ started: true, ...publicJob(job) });
  });

  // problem.generateAnswersProgress — poll the current/last answer-gen job
  app.get('/api/problem.generateAnswersProgress', async (req, reply) => {
    const user = await auth(req, reply);
    if (!user) return;
    const id = parseInt((req.query as { problemId?: string }).problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
    const job = answerGenJobs.get(id);
    if (!job) return ok({ running: false, total: 0, done: 0, generated: 0, errors: [] });
    return ok(publicJob(job));
  });

  // problem.setTestGroup
  app.post('/api/problem.setTestGroup', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    const idx = parseInt(body.testIndex ?? '');
    if (!id || !idx) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and testIndex required' });
    if (!getProblemForUser(id, user, reply)) return;
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
    if (!getProblemForUser(id, user, reply)) return;
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
    if (!getProblemForUser(id, user, reply)) return;
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
    if (!getProblemForUser(id, user, reply)) return;
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
    if (!getProblemForUser(id, user, reply)) return;
    const testset = getTestset(id, tsName ?? 'tests');
    if (!testset) return ok([]);
    // Groups are derived from the tests' group names; points = sum of test points.
    return ok(getDerivedTestGroups(testset.id));
  });

  // problem.saveTestGroup — set a group's policy/feedback/dependencies. Groups
  // themselves come from the tests' group names and their points are the sum of
  // the tests' points, so `points` is NOT stored here. Only the fields present
  // in the request are updated (so changing one field never wipes the others).
  app.post('/api/problem.saveTestGroup', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id || !body.groupName) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and groupName required' });
    if (!getProblemForUser(id, user, reply)) return;
    const testset = getOrCreateTestset(id, body.testset ?? 'tests');
    const data: { pointsPolicy?: string; feedbackPolicy?: string; dependencies?: string[] } = {};
    if (body.pointsPolicy) data.pointsPolicy = body.pointsPolicy;
    if (body.feedbackPolicy) data.feedbackPolicy = body.feedbackPolicy;
    if (body.dependencies !== undefined) data.dependencies = body.dependencies.split(',').map(s => s.trim()).filter(Boolean);
    upsertTestGroup(testset.id, body.groupName, data);
    db.prepare('UPDATE testsets SET groups_enabled = 1 WHERE id = ?').run(testset.id);
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.checkerTests
  app.get('/api/problem.checkerTests', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
    return ok(listCheckerTests(id));
  });

  // problem.saveCheckerTest
  app.post('/api/problem.saveCheckerTest', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
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
    if (!getProblemForUser(id, user, reply)) return;
    return ok(listValidatorTests(id));
  });

  // problem.saveValidatorTest
  app.post('/api/problem.saveValidatorTest', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
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
    if (!getProblemForUser(id, user, reply)) return;
    return ok(listTags(id));
  });

  // problem.saveTags
  app.post('/api/problem.saveTags', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { problemId?: string; tags?: string | string[] };
    const id = parseInt(String(body.problemId ?? ''));
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
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
    const problem = getProblemForUser(id, user, reply);
    if (!problem) return;
    return ok(problem.general_description);
  });

  // problem.saveGeneralDescription
  app.post('/api/problem.saveGeneralDescription', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { problemId?: string; description?: string };
    const id = parseInt(String(body.problemId ?? ''));
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
    updateProblem(id, { general_description: body.description ?? '', modified: 1 });
    return ok(null);
  });

  // problem.viewGeneralTutorial
  app.get('/api/problem.viewGeneralTutorial', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    const problem = getProblemForUser(id, user, reply);
    if (!problem) return;
    return ok(problem.general_tutorial);
  });

  // problem.saveGeneralTutorial
  app.post('/api/problem.saveGeneralTutorial', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { problemId?: string; tutorial?: string };
    const id = parseInt(String(body.problemId ?? ''));
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
    updateProblem(id, { general_tutorial: body.tutorial ?? '', modified: 1 });
    return ok(null);
  });

  // problem.cautions
  app.get('/api/problem.cautions', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
    return ok({ cautions: getCautions(id), aiTips: [] });
  });

  // problem.packages
  app.get('/api/problem.packages', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
    const packages = db.prepare('SELECT * FROM packages WHERE problem_id = ? ORDER BY created_at DESC').all(id);
    return ok(packages);
  });

  // problem.buildPackage
  app.post('/api/problem.buildPackage', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    const problem = getProblemForUser(id, user, reply);
    if (!problem) return;
    if (problem.modified === 1) {
      return reply.code(400).send({ status: 'FAILED', comment: 'Commit your changes before building a package.' });
    }
    const type = (body.type ?? 'standard') as 'standard' | 'linux' | 'windows';
    const comment = body.comment ?? '';

    // Optionally verify the problem before packaging. If verification fails,
    // refuse to build and return the report so the user can fix issues first.
    const shouldVerify = String(body.verify ?? '') === 'true';
    if (shouldVerify) {
      const report = await verifyProblem(id);
      if (!report.ok) {
        return reply.code(400).send({ status: 'FAILED', comment: 'Verification failed', result: { verify: report } });
      }
    }

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

  // problem.verify - run the full verification pipeline and return a report
  app.post('/api/problem.verify', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { problemId?: string | number };
    const id = parseInt(String(body.problemId ?? ''));
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
    const report = await verifyProblem(id);
    return ok(report);
  });

  // problem.package - download
  app.get('/api/problem.package', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, packageId } = req.query as { problemId?: string; packageId?: string };
    const id = parseInt(problemId ?? '');
    const pkgId = parseInt(packageId ?? '');
    if (!id || !pkgId) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and packageId required' });
    if (!getProblemForUser(id, user, reply)) return;
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
    if (!getProblemForUser(id, user, reply)) return;
    const solution = getSolution(solId);
    if (!solution || solution.problem_id !== id) return reply.code(404).send({ status: 'FAILED', comment: 'Solution not found' });
    // Tags are stored in the tag field; extra tags not separately modeled
    db.prepare('UPDATE solutions SET tag = ? WHERE id = ?').run(body.tag ?? solution.tag, solId);
    return ok(null);
  });

  // problem.deleteSolution
  app.post('/api/problem.deleteSolution', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    const solId = parseInt(body.solutionId ?? '');
    if (!id || !solId) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and solutionId required' });
    if (!getProblemForUser(id, user, reply)) return;
    const solution = getSolution(solId);
    if (!solution || solution.problem_id !== id) return reply.code(404).send({ status: 'FAILED', comment: 'Solution not found' });
    const filePath = path.join(getProblemDir(id), solution.source_path);
    try { fs.unlinkSync(filePath); } catch { /* already gone */ }
    deleteSolution(solId);
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.downloadSolution
  app.get('/api/problem.downloadSolution', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, solutionId } = req.query as { problemId?: string; solutionId?: string };
    const id = parseInt(problemId ?? '');
    const solId = parseInt(solutionId ?? '');
    if (!id || !solId) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and solutionId required' });
    if (!getProblemForUser(id, user, reply)) return;
    const solution = getSolution(solId);
    if (!solution || solution.problem_id !== id) return reply.code(404).send({ status: 'FAILED', comment: 'Solution not found' });
    const filePath = path.join(getProblemDir(id), solution.source_path);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ status: 'FAILED', comment: 'File not found' });
    const fileName = path.basename(solution.source_path);
    reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
    reply.header('Content-Type', 'application/octet-stream');
    return reply.send(fs.readFileSync(filePath));
  });

  // problem.renameSolution
  app.post('/api/problem.renameSolution', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    const solId = parseInt(body.solutionId ?? '');
    const newName = (body.newName ?? '').trim();
    if (!id || !solId || !newName) return reply.code(400).send({ status: 'FAILED', comment: 'problemId, solutionId and newName required' });
    if (!isPlainName(newName)) return reply.code(400).send({ status: 'FAILED', comment: 'Invalid file name' });
    if (!getProblemForUser(id, user, reply)) return;
    const solution = getSolution(solId);
    if (!solution || solution.problem_id !== id) return reply.code(404).send({ status: 'FAILED', comment: 'Solution not found' });
    const problemDir = getProblemDir(id);
    const dir = path.dirname(solution.source_path);
    const newPath = path.join(dir, newName);
    const oldFile = safeJoin(problemDir, solution.source_path);
    const newFile = safeJoin(problemDir, newPath);
    if (!oldFile || !newFile) return reply.code(400).send({ status: 'FAILED', comment: 'Invalid path' });
    if (fs.existsSync(oldFile)) {
      fs.mkdirSync(path.dirname(newFile), { recursive: true });
      fs.renameSync(oldFile, newFile);
    }
    db.prepare('UPDATE solutions SET source_path = ? WHERE id = ?').run(newPath, solId);
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.updateSolutionLang
  app.post('/api/problem.updateSolutionLang', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    const solId = parseInt(body.solutionId ?? '');
    if (!id || !solId || !body.sourceType) return reply.code(400).send({ status: 'FAILED', comment: 'problemId, solutionId and sourceType required' });
    if (!getProblemForUser(id, user, reply)) return;
    const solution = getSolution(solId);
    if (!solution || solution.problem_id !== id) return reply.code(404).send({ status: 'FAILED', comment: 'Solution not found' });
    db.prepare('UPDATE solutions SET source_type = ? WHERE id = ?').run(body.sourceType, solId);
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.updateSolutionTag
  app.post('/api/problem.updateSolutionTag', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    const solId = parseInt(body.solutionId ?? '');
    if (!id || !solId || !body.tag) return reply.code(400).send({ status: 'FAILED', comment: 'problemId, solutionId and tag required' });
    if (!getProblemForUser(id, user, reply)) return;
    const solution = getSolution(solId);
    if (!solution || solution.problem_id !== id) return reply.code(404).send({ status: 'FAILED', comment: 'Solution not found' });
    db.prepare('UPDATE solutions SET tag = ? WHERE id = ?').run(body.tag, solId);
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.editSolution — save edited content
  app.post('/api/problem.editSolution', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    const solId = parseInt(body.solutionId ?? '');
    if (!id || !solId || body.content === undefined) return reply.code(400).send({ status: 'FAILED', comment: 'problemId, solutionId and content required' });
    if (!getProblemForUser(id, user, reply)) return;
    const solution = getSolution(solId);
    if (!solution || solution.problem_id !== id) return reply.code(404).send({ status: 'FAILED', comment: 'Solution not found' });
    const filePath = path.join(getProblemDir(id), solution.source_path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, body.content, 'utf-8');
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.script - get doall script
  app.get('/api/problem.script', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, type } = req.query as { problemId?: string; type?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
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
    if (!getProblemForUser(id, user, reply)) return;
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
    if (!getProblemForUser(id, user, reply)) return;
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
    if (!getProblemForUser(id, user, reply)) return;
    const testset = getTestset(id, tsName ?? 'tests');
    if (!testset) return ok([]);
    const tests = listTests(testset.id);
    const problemDir = getProblemDir(id);
    return ok(tests.map(t => {
      const testNum = String(t.idx).padStart(2, '0');
      const inputPath = path.join(problemDir, testset.input_path_pattern.replace('%02d', testNum));
      const answerPath = path.join(problemDir, testset.answer_path_pattern.replace('%02d', testNum));
      let inputPreview = '';
      let inputSize = 0;
      let answerSize = 0;
      if (fs.existsSync(inputPath)) {
        try {
          inputSize = fs.statSync(inputPath).size;
          // Read only first 200 bytes for preview — never load entire file
          const PREVIEW_BYTES = 200;
          const buf = Buffer.allocUnsafe(PREVIEW_BYTES);
          const fd = fs.openSync(inputPath, 'r');
          const bytesRead = fs.readSync(fd, buf, 0, PREVIEW_BYTES, 0);
          fs.closeSync(fd);
          inputPreview = buf.slice(0, bytesRead).toString('utf-8');
        } catch { /**/ }
      }
      if (fs.existsSync(answerPath)) {
        try { answerSize = fs.statSync(answerPath).size; } catch { /**/ }
      }
      return {
        ...t,
        inputAvailable: fs.existsSync(inputPath),
        answerAvailable: fs.existsSync(answerPath),
        inputPreview,
        inputSize,
        answerSize,
      };
    }));
  });

  // problem.updateWorkingCopy - increment revision
  app.post('/api/problem.updateWorkingCopy', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    const problem = getProblemForUser(id, user, reply);
    if (!problem) return;
    updateProblem(id, { revision: problem.revision + 1, modified: 1 });
    return ok(null);
  });

  // problem.commitChanges — snapshot the working copy as a new revision
  app.post('/api/problem.commitChanges', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    const problem = getProblemForUser(id, user, reply);
    if (!problem) return;
    try {
      const revision = commitRevision(id, body.comment ?? '');
      return ok({ revision });
    } catch (e: unknown) {
      return reply.code(400).send({ status: 'FAILED', comment: (e as Error).message });
    }
  });

  // problem.revisions — list committed revisions (newest first)
  app.get('/api/problem.revisions', async (req, reply) => {
    const user = await auth(req, reply);
    const id = parseInt((req.query as { problemId?: string }).problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
    return ok(listRevisions(id));
  });

  // problem.restoreRevision — restore the working copy to a committed revision
  app.post('/api/problem.restoreRevision', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { problemId?: string | number; revision?: string | number };
    const id = parseInt(String(body.problemId ?? ''));
    const rev = parseInt(String(body.revision ?? ''));
    if (!id || !rev) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and revision required' });
    if (!getProblemForUser(id, user, reply)) return;
    try {
      restoreRevision(id, rev);
      return ok({ revision: rev });
    } catch (e: unknown) {
      return reply.code(400).send({ status: 'FAILED', comment: (e as Error).message });
    }
  });

  // problem.deleteRevision — permanently delete a stored revision
  app.post('/api/problem.deleteRevision', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { problemId?: string | number; revision?: string | number };
    const id = parseInt(String(body.problemId ?? ''));
    const rev = parseInt(String(body.revision ?? ''));
    if (!id || !rev) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and revision required' });
    if (!getProblemForUser(id, user, reply)) return;
    try {
      deleteRevision(id, rev);
      return ok({ revision: rev });
    } catch (e: unknown) {
      return reply.code(400).send({ status: 'FAILED', comment: (e as Error).message });
    }
  });

  // problem.discardWorkingCopy
  app.post('/api/problem.discardWorkingCopy', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
    updateProblem(id, { modified: 0 });
    return ok(null);
  });

  // Invocations
  app.get('/api/problem.invocations', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
    const invocations = db.prepare('SELECT * FROM invocations WHERE problem_id = ? ORDER BY created_at DESC').all(id);
    return ok(invocations);
  });

  app.post('/api/problem.runInvocation', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;

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
    if (!getProblemForUser(id, user, reply)) return;
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
    if (!getProblemForUser(id, user, reply)) return;
    const stresses = db.prepare('SELECT * FROM stresses WHERE problem_id = ?').all(id);
    return ok(stresses);
  });

  // problem.saveStress
  app.post('/api/problem.saveStress', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as Record<string, string>;
    const id = parseInt(body.problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
    const result = db.prepare(
      'INSERT INTO stresses (problem_id, generator_cmd, solution_path, name) VALUES (?, ?, ?, ?)'
    ).run(id, body.generatorCmd ?? '', body.solutionPath ?? '', body.name ?? '');
    updateProblem(id, { modified: 1 });
    return ok({ id: result.lastInsertRowid });
  });


  // problem.extraValidators
  app.get('/api/problem.extraValidators', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
    // Return empty for now - TODO: support multiple validators
    return ok([]);
  });

  // problem.statementResources
  app.get('/api/problem.statementResources', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, lang } = req.query as { problemId?: string; lang?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
    const problemDir = getProblemDir(id);
    if (!isPlainName(lang ?? 'russian')) return reply.code(400).send({ status: 'FAILED', comment: 'Invalid lang' });
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
    if (!getProblemForUser(id, user, reply)) return;
    const problemDir = getProblemDir(id);
    if (!isPlainName(lang ?? 'russian') || !isPlainName(name)) {
      return reply.code(400).send({ status: 'FAILED', comment: 'Invalid lang or name' });
    }
    const filePath = safeJoin(problemDir, 'statements', lang ?? 'russian', name);
    if (!filePath || !fs.existsSync(filePath)) {
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
    if (!getProblemForUser(id, user, reply)) return;
    if (!isPlainName(lang) || !isPlainName(data.filename)) {
      return reply.code(400).send({ status: 'FAILED', comment: 'Invalid lang or file name' });
    }
    const problemDir = getProblemDir(id);
    const stmtDir = path.join(problemDir, 'statements', lang);
    fs.mkdirSync(stmtDir, { recursive: true });
    const dest = safeJoin(stmtDir, data.filename);
    if (!dest) return reply.code(400).send({ status: 'FAILED', comment: 'Invalid file name' });
    const buffer = await data.toBuffer();
    fs.writeFileSync(dest, buffer);
    updateProblem(id, { modified: 1 });
    return ok({ name: data.filename });
  });

  // problem.rename
  app.post('/api/problem.rename', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, newName } = req.body as { problemId?: string | number; newName?: string };
    const id = parseInt(String(problemId ?? ''));
    if (!id || !newName) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and newName required' });
    if (!/^[a-zA-Z0-9_\-\.]+$/.test(newName)) {
      return reply.code(400).send({ status: 'FAILED', comment: 'Invalid name; only letters, digits, _, -, . allowed' });
    }
    if (!getProblemForUser(id, user, reply)) return;
    const existing = getProblemByName(newName, user.id);
    if (existing && existing.id !== id) {
      return reply.code(409).send({ status: 'FAILED', comment: 'A problem with that name already exists' });
    }
    updateProblem(id, { short_name: newName, modified: 1 });
    return ok(null);
  });

  // problem.deleteStatement
  app.post('/api/problem.deleteStatement', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, lang } = req.body as { problemId?: string | number; lang?: string };
    const id = parseInt(String(problemId ?? ''));
    if (!id || !lang) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and lang required' });
    if (!isPlainName(lang)) return reply.code(400).send({ status: 'FAILED', comment: 'Invalid lang' });
    if (!getProblemForUser(id, user, reply)) return;
    db.prepare('DELETE FROM statements WHERE problem_id = ? AND language = ?').run(id, lang);
    const problemDir = getProblemDir(id);
    const sectionsDir = safeJoin(problemDir, 'statement-sections', lang);
    if (sectionsDir && fs.existsSync(sectionsDir)) fs.rmSync(sectionsDir, { recursive: true, force: true });
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.moveTestsTo
  app.post('/api/problem.moveTestsTo', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, testIndices, targetIdx, testset } = req.body as {
      problemId?: string | number;
      testIndices?: number[];
      targetIdx?: number;
      testset?: string;
    };
    const id = parseInt(String(problemId ?? ''));
    if (!id || targetIdx === undefined || !Array.isArray(testIndices) || !testIndices.length) {
      return reply.code(400).send({ status: 'FAILED', comment: 'problemId, testIndices and targetIdx required' });
    }
    if (!getProblemForUser(id, user, reply)) return;
    const ts = getTestset(id, testset ?? 'tests');
    if (!ts) return reply.code(400).send({ status: 'FAILED', comment: 'Testset not found' });

    const allTests = listTests(ts.id);
    const selectedSet = new Set(testIndices.map(Number));
    const remaining = allTests.filter(t => !selectedSet.has(t.idx));
    const selected = allTests.filter(t => selectedSet.has(t.idx));
    if (!selected.length) return reply.code(400).send({ status: 'FAILED', comment: 'No matching tests found' });

    const insertPos = Math.max(0, Math.min(targetIdx - 1, remaining.length));
    const newOrder = [...remaining.slice(0, insertPos), ...selected, ...remaining.slice(insertPos)];

    // Capture old->new index mapping before modifying the DB
    const renames = newOrder.map((t, i) => ({ oldIdx: t.idx, newIdx: i + 1 }));

    db.transaction(() => {
      const bigOffset = allTests.length + 10000;
      db.prepare('UPDATE tests SET idx = idx + ? WHERE testset_id = ?').run(bigOffset, ts.id);
      for (let i = 0; i < newOrder.length; i++) {
        db.prepare('UPDATE tests SET idx = ? WHERE id = ?').run(i + 1, newOrder[i].id);
      }
    })();

    // Rename files on disk: first to temp names, then to final positions
    const problemDir = getProblemDir(id);
    const patterns = [ts.input_path_pattern, ts.answer_path_pattern];
    for (const { oldIdx } of renames) {
      const n = String(oldIdx).padStart(2, '0');
      for (const pat of patterns) {
        const src = path.join(problemDir, pat.replace('%02d', n));
        if (fs.existsSync(src)) fs.renameSync(src, src + '._move');
      }
    }
    for (const { oldIdx, newIdx } of renames) {
      const oldN = String(oldIdx).padStart(2, '0');
      const newN = String(newIdx).padStart(2, '0');
      for (const pat of patterns) {
        const tmp = path.join(problemDir, pat.replace('%02d', oldN) + '._move');
        const dst = path.join(problemDir, pat.replace('%02d', newN));
        if (fs.existsSync(tmp)) fs.renameSync(tmp, dst);
      }
    }

    updateProblem(id, { modified: 1 });
    return ok({ count: newOrder.length });
  });

  // problem.testScript - get the saved generator/test script
  app.get('/api/problem.testScript', async (req, reply) => {
    const user = await auth(req, reply);
    const id = parseInt((req.query as { problemId?: string }).problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
    return ok({ script: getProperty(id, 'test_script') ?? '' });
  });

  // problem.saveTestScript - persist the script text
  app.post('/api/problem.saveTestScript', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { problemId?: string | number; script?: string };
    const id = parseInt(String(body.problemId ?? ''));
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
    setProperty(id, 'test_script', body.script ?? '');
    updateProblem(id, { modified: 1 });
    return ok(null);
  });

  // problem.expandTestScript - expand FreeMarker into concrete command lines (preview)
  app.post('/api/problem.expandTestScript', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { problemId?: string | number; script?: string };
    const id = parseInt(String(body.problemId ?? ''));
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;
    try {
      const lines = expandScriptToLines(body.script ?? '');
      return ok({ lines, count: lines.length });
    } catch (e: unknown) {
      return reply.code(400).send({ status: 'FAILED', comment: (e as Error).message });
    }
  });

  // problem.applyTestScript - create generated tests from the expanded script
  app.post('/api/problem.applyTestScript', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { problemId?: string | number; script?: string; mode?: 'append' | 'replace' };
    const id = parseInt(String(body.problemId ?? ''));
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    if (!getProblemForUser(id, user, reply)) return;

    let lines: string[];
    try { lines = expandScriptToLines(body.script ?? ''); }
    catch (e: unknown) { return reply.code(400).send({ status: 'FAILED', comment: (e as Error).message }); }
    if (!lines.length) return reply.code(400).send({ status: 'FAILED', comment: 'Script produced no test lines' });

    const testset = getOrCreateTestset(id, 'tests');
    setProperty(id, 'test_script', body.script ?? '');

    if (body.mode === 'replace') {
      // Drop existing *generated* tests (manual tests are kept) and their files.
      const problemDir = getProblemDir(id);
      const existing = listTests(testset.id);
      for (const t of existing) {
        if (t.method !== 'generated') continue;
        const n = String(t.idx).padStart(2, '0');
        for (const pat of [testset.input_path_pattern, testset.answer_path_pattern]) {
          const f = path.join(problemDir, pat.replace('%02d', n));
          if (fs.existsSync(f)) fs.unlinkSync(f);
        }
      }
      db.prepare("DELETE FROM tests WHERE testset_id = ? AND method = 'generated'").run(testset.id);
      // Re-pack indices so they are contiguous starting at 1.
      const remaining = listTests(testset.id);
      db.transaction(() => {
        const off = remaining.length + 100000;
        db.prepare('UPDATE tests SET idx = idx + ? WHERE testset_id = ?').run(off, testset.id);
        remaining.forEach((t, k) => db.prepare('UPDATE tests SET idx = ? WHERE id = ?').run(k + 1, t.id));
      })();
    }

    let nextIdx = (listTests(testset.id).at(-1)?.idx ?? 0) + 1;
    for (const line of lines) {
      upsertTest(testset.id, nextIdx, { method: 'generated', cmd: line, description: line });
      nextIdx++;
    }
    updateProblem(id, { modified: 1 });
    return ok({ count: lines.length });
  });

  // problem.previewScriptLine - run a single generator command and return its output
  app.post('/api/problem.previewScriptLine', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { problemId?: string | number; line?: string };
    const id = parseInt(String(body.problemId ?? ''));
    if (!id || !body.line) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and line required' });
    if (!getProblemForUser(id, user, reply)) return;
    const testset = getOrCreateTestset(id, 'tests');
    // Use a scratch test slot far past the real range so we never disturb data.
    const scratchIdx = 900000 + Math.floor(Math.random() * 90000);
    upsertTest(testset.id, scratchIdx, { method: 'generated', cmd: body.line, description: 'preview' });
    try {
      const gen = await generateTestInput(id, testset.id, scratchIdx);
      if (!gen.success) return reply.code(400).send({ status: 'FAILED', comment: gen.error });
      const data = fs.readFileSync(gen.inputPath);
      const text = data.slice(0, 4000).toString('utf-8');
      return ok({ preview: text, truncated: data.length > 4000, size: data.length });
    } finally {
      db.prepare('DELETE FROM tests WHERE testset_id = ? AND idx = ?').run(testset.id, scratchIdx);
    }
  });

  // problem.validate
  app.get('/api/problem.validate', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId } = req.query as { problemId?: string };
    const id = parseInt(problemId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    const problem = getProblemForUser(id, user, reply);
    if (!problem) return;

    const errors: string[] = [];
    const warnings: string[] = [];
    const problemDir = getProblemDir(id);

    if (!problem.time_limit || problem.time_limit <= 0) errors.push('Time limit is not set');
    if (!problem.memory_limit || problem.memory_limit <= 0) errors.push('Memory limit is not set');

    const testset = getTestset(id, 'tests');
    const tests = testset ? listTests(testset.id) : [];
    if (tests.length === 0) {
      errors.push('No tests: add at least one test');
    }

    const checker = getAsset(id, 'checker');
    if (!checker || !checker.source_path) {
      errors.push('No checker: set a checker on the Checker tab');
    } else if (!checker.source_path.startsWith('std::')) {
      const checkerSrc = path.join(problemDir, checker.source_path);
      if (!fs.existsSync(checkerSrc) && !checker.binary_path) {
        warnings.push(`Checker source not found on disk: ${checker.source_path}`);
      }
    }

    const validator = getAsset(id, 'validator');
    if (!validator || !validator.source_path) {
      warnings.push('No validator: consider adding a validator');
    }

    const solutions = listSolutions(id);
    if (solutions.length === 0) {
      errors.push('No solutions: add at least one solution');
    } else {
      const mainSols = solutions.filter(s => s.tag === 'main');
      if (mainSols.length === 0) {
        errors.push('No main solution: set one solution\'s tag to "main"');
      } else {
        const lastInv = db.prepare('SELECT * FROM invocations WHERE problem_id = ? ORDER BY id DESC LIMIT 1').get(id) as { id: number; state: string } | undefined;
        if (!lastInv) {
          warnings.push('No invocation run yet: run an invocation to verify solutions');
        } else if (lastInv.state !== 'DONE') {
          warnings.push(`Last invocation did not complete (state: ${lastInv.state})`);
        } else {
          const phs = mainSols.map(() => '?').join(',');
          const args: unknown[] = [lastInv.id, ...mainSols.map(s => s.id)];
          const row = db.prepare(`SELECT COUNT(*) as cnt FROM invocation_runs WHERE invocation_id = ? AND solution_id IN (${phs}) AND verdict != 'OK'`).get(...args as [unknown, ...unknown[]]) as { cnt: number };
          if (row.cnt > 0) {
            errors.push(`Main solution failed ${row.cnt} test(s) in the last invocation`);
          }
        }
      }
    }

    const stmts = listStatements(id);
    if (stmts.length === 0) {
      warnings.push('No statement: consider adding a problem statement');
    }

    if (problem.interactive === 1) {
      const interactor = getAsset(id, 'interactor');
      if (!interactor || !interactor.source_path) {
        errors.push('Problem is marked interactive but no interactor is set');
      }
    }

    return ok({ errors, warnings });
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
