import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getAuthUser } from './auth';
import { db, getProblemDir } from '../db/schema';
import {
  getProblem, listSolutions, getAsset, listStatements,
  getTestset, listTests,
} from '../services/problems';
import { importPackage } from '../services/import';

const POLYGON_BASE = 'https://polygon.codeforces.com/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function auth(req: FastifyRequest, reply: FastifyReply) {
  const user = await getAuthUser(req);
  if (!user) {
    reply.code(401).send({ status: 'FAILED', comment: 'Not authenticated' });
    throw new Error('Not authenticated');
  }
  return user;
}

function ok(result: unknown) { return { status: 'OK', result }; }

// Compute Polygon-style apiSig: RAND + SHA512(RAND/method?sorted_params#secret)
function computeApiSig(method: string, params: Record<string, string>, secret: string): string {
  const rand = crypto.randomBytes(3).toString('hex'); // 6 lowercase hex chars
  const sorted = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  const qs = sorted.map(([k, v]) => `${k}=${v}`).join('&');
  const raw = `${rand}/${method}?${qs}#${secret}`;
  const hash = crypto.createHash('sha512').update(raw).digest('hex');
  return rand + hash;
}

// Make a signed POST request to the Polygon API
async function polygonPost(method: string, params: Record<string, string>, key: string, secret: string): Promise<unknown> {
  const time = String(Math.floor(Date.now() / 1000));
  const all: Record<string, string> = { ...params, apiKey: key, time };
  const sig = computeApiSig(method, all, secret);
  const body = new URLSearchParams({ ...all, apiSig: sig }).toString();
  const res = await fetch(`${POLYGON_BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json() as { status: string; result?: unknown; comment?: string };
  if (json.status !== 'OK') throw new Error(json.comment ?? `Polygon API error from ${method}`);
  return json.result;
}

// Download a package as binary buffer; pkgType should match what Polygon built ('linux' or 'windows')
async function downloadPolygonPackage(pgProblemId: number, packageId: number, pkgType: string, key: string, secret: string): Promise<Buffer> {
  // Try the given type first, then fall back to the other type
  const types = pkgType === 'linux' ? ['linux', 'windows'] : [pkgType, 'linux'];
  let lastError = '';
  for (const type of types) {
    const time = String(Math.floor(Date.now() / 1000));
    const params: Record<string, string> = {
      problemId: String(pgProblemId),
      packageId: String(packageId),
      type,
      apiKey: key,
      time,
    };
    const sig = computeApiSig('problem.package', params, secret);
    const qs = new URLSearchParams({ ...params, apiSig: sig }).toString();
    const res = await fetch(`${POLYGON_BASE}/problem.package?${qs}`);
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json') || ct.includes('text/plain')) {
      const text = await res.text();
      try { const j = JSON.parse(text); lastError = j.comment ?? `HTTP ${res.status}`; }
      catch { lastError = text.slice(0, 200) || `HTTP ${res.status}`; }
      continue; // try next type
    }
    if (!res.ok) { lastError = `HTTP ${res.status}`; continue; }
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error(`Package download failed: ${lastError}`);
}

// Get the user's saved Polygon API key/secret from DB
function getSavedKey(userId: number): { apiKey: string; apiSecret: string } | null {
  const row = db.prepare('SELECT polygon_api_key, polygon_api_secret FROM users WHERE id = ?').get(userId) as
    { polygon_api_key: string | null; polygon_api_secret: string | null } | undefined;
  if (!row?.polygon_api_key || !row.polygon_api_secret) return null;
  return { apiKey: row.polygon_api_key, apiSecret: row.polygon_api_secret };
}

// Resolve key+secret: use provided if given, else fall back to saved
function resolveKeys(
  userId: number,
  providedKey?: string,
  providedSecret?: string,
): { apiKey: string; apiSecret: string } {
  const k = providedKey?.trim() || '';
  const s = providedSecret?.trim() || '';
  if (k && s) return { apiKey: k, apiSecret: s };
  const saved = getSavedKey(userId);
  if (saved && (!k || !s)) {
    return { apiKey: k || saved.apiKey, apiSecret: s || saved.apiSecret };
  }
  if (!k || !s) throw new Error('API key and secret are required (no saved key found)');
  return { apiKey: k, apiSecret: s };
}

const POLICY_MAP: Record<string, string> = {
  'each-test': 'EACH_TEST', 'complete-group': 'COMPLETE_GROUP',
};
const FEEDBACK_MAP: Record<string, string> = {
  'points': 'POINTS', 'complete': 'COMPLETE', 'icpc': 'ICPC', 'none': 'NONE',
};
const TAG_MAP: Record<string, string> = {
  'main': 'MA', 'accepted': 'OK', 'rejected': 'RJ',
  'wrong-answer': 'WA', 'time-limit-exceeded': 'TL',
  'memory-limit-exceeded': 'ML', 'presentation-error': 'PE',
  'time-limit-exceeded-or-accepted': 'TO', 'runtime-error': 'RE',
  'time-limit-exceeded-or-memory-limit-exceeded': 'TL',
};

// Push all local problem data to an existing Polygon problem
async function pushToPolygon(
  localProblemId: number,
  pgProblemId: number,
  key: string,
  secret: string,
): Promise<{ done: string[]; errors: string[] }> {
  const done: string[] = [];
  const errors: string[] = [];
  const pid = String(pgProblemId);
  const problem = db.prepare('SELECT * FROM problems WHERE id = ?').get(localProblemId) as (Record<string, unknown>) | undefined;
  if (!problem) throw new Error('Local problem not found');
  const problemDir = getProblemDir(localProblemId);

  const tryStep = async (label: string, fn: () => Promise<void>) => {
    try { await fn(); done.push(label); }
    catch (e: unknown) { errors.push(`${label}: ${(e as Error).message}`); }
  };

  // 1. Problem info
  await tryStep('Problem info', async () => {
    const infoParams: Record<string, string> = {
      problemId: pid,
      inputFile: String(problem.input_file ?? ''),
      outputFile: String(problem.output_file ?? ''),
      interactive: problem.interactive === 1 ? 'true' : 'false',
      timeLimit: String(problem.time_limit ?? 1000),
      memoryLimit: String(Math.round(Number(problem.memory_limit ?? 268435456) / 1024 / 1024)),
    };
    if (problem.general_description) infoParams.generalDescription = String(problem.general_description);
    if (problem.general_tutorial) infoParams.generalTutorial = String(problem.general_tutorial);
    await polygonPost('problem.updateInfo', infoParams, key, secret);
  });

  // 2. Statements + statement resources
  const stmts = listStatements(localProblemId) as Record<string, string>[];
  for (const stmt of stmts) {
    await tryStep(`Statement (${stmt.language})`, async () => {
      await polygonPost('problem.saveStatement', {
        problemId: pid,
        lang: stmt.language,
        encoding: 'UTF-8',
        name: stmt.name ?? '',
        legend: stmt.legend ?? '',
        input: stmt.input_section ?? '',
        output: stmt.output_section ?? '',
        scoring: stmt.scoring ?? '',
        interaction: stmt.interaction ?? '',
        notes: stmt.notes ?? '',
        tutorial: stmt.tutorial ?? '',
      }, key, secret);
    });

    // Statement source files (problem.tex, tutorial.tex, example files, images, etc.)
    const stmtResDir = path.join(problemDir, 'statements', stmt.language);
    if (fs.existsSync(stmtResDir)) {
      for (const fname of fs.readdirSync(stmtResDir)) {
        // Skip generated HTML/PDF and metadata json; upload example files
        if (fname.endsWith('.json')) continue;
        const fpath = path.join(stmtResDir, fname);
        if (!fs.statSync(fpath).isFile()) continue;
        await tryStep(`Statement resource (${stmt.language}/${fname})`, async () => {
          const content = fs.readFileSync(fpath, 'utf-8');
          await polygonPost('problem.saveStatementResource', {
            problemId: pid, lang: stmt.language, name: fname, file: content,
          }, key, secret);
        });
      }
    }
  }

  // 3. Checker
  const checker = getAsset(localProblemId, 'checker');
  if (checker?.source_path) {
    if (checker.source_path.startsWith('std::')) {
      await tryStep(`Checker (${checker.source_path})`, async () => {
        await polygonPost('problem.setChecker', { problemId: pid, checker: checker.source_path }, key, secret);
      });
    } else {
      const checkerFile = path.join(problemDir, checker.source_path);
      if (fs.existsSync(checkerFile)) {
        const content = fs.readFileSync(checkerFile, 'utf-8');
        await tryStep(`Checker file (${path.basename(checker.source_path)})`, async () => {
          await polygonPost('problem.saveFile', {
            problemId: pid, type: 'source', name: path.basename(checker.source_path),
            file: content, sourceType: checker.source_type || 'cpp.g++17',
          }, key, secret);
          await polygonPost('problem.setChecker', {
            problemId: pid, checker: path.basename(checker.source_path),
          }, key, secret);
        });
      }
    }
  }

  // 4. Validator
  const validator = getAsset(localProblemId, 'validator');
  if (validator?.source_path) {
    const valFile = path.join(problemDir, validator.source_path);
    if (fs.existsSync(valFile)) {
      const content = fs.readFileSync(valFile, 'utf-8');
      await tryStep(`Validator (${path.basename(validator.source_path)})`, async () => {
        await polygonPost('problem.saveFile', {
          problemId: pid, type: 'source', name: path.basename(validator.source_path),
          file: content, sourceType: validator.source_type || 'cpp.g++17',
        }, key, secret);
        await polygonPost('problem.setValidator', {
          problemId: pid, validator: path.basename(validator.source_path),
        }, key, secret);
      });
    }
  }

  // 5. Interactor (interactive problems only)
  if (problem.interactive === 1) {
    const interactor = getAsset(localProblemId, 'interactor');
    if (interactor?.source_path) {
      const interFile = path.join(problemDir, interactor.source_path);
      if (fs.existsSync(interFile)) {
        const content = fs.readFileSync(interFile, 'utf-8');
        await tryStep(`Interactor (${path.basename(interactor.source_path)})`, async () => {
          await polygonPost('problem.saveFile', {
            problemId: pid, type: 'source', name: path.basename(interactor.source_path),
            file: content, sourceType: interactor.source_type || 'cpp.g++17',
          }, key, secret);
          await polygonPost('problem.setInteractor', {
            problemId: pid, interactor: path.basename(interactor.source_path),
          }, key, secret);
        });
      }
    }
  }

  // 6. Tags
  const tags = db.prepare('SELECT value FROM problem_tags WHERE problem_id = ?').all(localProblemId) as { value: string }[];
  if (tags.length > 0) {
    await tryStep('Tags', async () => {
      await polygonPost('problem.saveTags', {
        problemId: pid, tags: tags.map(t => t.value).join(','),
      }, key, secret);
    });
  }

  // 7. Solutions
  const solutions = listSolutions(localProblemId);
  for (const sol of solutions) {
    const solFile = path.join(problemDir, sol.source_path);
    if (!fs.existsSync(solFile)) { errors.push(`Solution ${sol.source_path}: file not found on disk`); continue; }
    const content = fs.readFileSync(solFile, 'utf-8');
    await tryStep(`Solution (${path.basename(sol.source_path)})`, async () => {
      const tag = TAG_MAP[sol.tag] ?? TAG_MAP[sol.tag?.toLowerCase()] ?? 'OK';
      await polygonPost('problem.saveSolution', {
        problemId: pid, name: path.basename(sol.source_path),
        file: content, sourceType: sol.source_type || 'cpp.g++17', tag,
      }, key, secret);
    });
  }

  // 8. Resource files (files/ directory)
  const resourceDir = path.join(problemDir, 'files');
  if (fs.existsSync(resourceDir)) {
    for (const fname of fs.readdirSync(resourceDir)) {
      const fpath = path.join(resourceDir, fname);
      if (!fs.statSync(fpath).isFile()) continue;
      if (/\.h$/.test(fname)) continue; // Polygon doesn't accept .h uploads
      const isSource = /\.(cpp|c|py|java|pas|go)$/.test(fname);
      const content = fs.readFileSync(fpath, 'utf-8');
      await tryStep(`Resource file (${fname})`, async () => {
        await polygonPost('problem.saveFile', {
          problemId: pid, type: isSource ? 'source' : 'resource',
          name: fname, file: content,
        }, key, secret);
      });
    }
  }

  // 9. Tests (with groups and per-test points)
  const testset = getTestset(localProblemId, 'tests');
  if (testset) {
    const groupsEnabled = testset.groups_enabled === 1;
    const pointsEnabled = testset.points_enabled === 1;

    if (groupsEnabled) {
      await tryStep('Enable test groups', async () => {
        await polygonPost('problem.enableGroups', { problemId: pid, testset: 'tests', enable: 'true' }, key, secret);
      });
    }
    if (pointsEnabled) {
      await tryStep('Enable points', async () => {
        await polygonPost('problem.enablePoints', { problemId: pid, testset: 'tests', enable: 'true' }, key, secret);
      });
    }

    // Load groups to know per-group policy (for deciding whether to send testPoints)
    type GroupRow = { id: number; name: string; points: number; points_policy: string; feedback_policy: string; dep_str: string | null };
    const groups = db.prepare(
      `SELECT tg.id, tg.name, tg.points, tg.points_policy, tg.feedback_policy,
              GROUP_CONCAT(gd.depends_on, ',') as dep_str
       FROM test_groups tg
       LEFT JOIN group_dependencies gd ON gd.group_id = tg.id
       WHERE tg.testset_id = ?
       GROUP BY tg.id`
    ).all(testset.id) as GroupRow[];
    const groupPolicyMap: Record<string, string> = {};
    for (const g of groups) groupPolicyMap[g.name] = g.points_policy;

    const tests = listTests(testset.id);

    // Two-pass test upload to avoid "Test coincides with test #X" errors.
    // Polygon checks for duplicate content across all tests. If the existing
    // Polygon tests have rotated/wrong content (from a previous partial push),
    // direct overwrite triggers coincidence errors. Solution:
    //   Pass 1 — replace every test slot with a unique placeholder string.
    //            Placeholders are unique so no coincidence fires. This breaks
    //            any coincidence cycles.
    //   Pass 2 — overwrite with real content. After pass 1 all other slots
    //            hold unique placeholders, so real content never coincides.
    await tryStep('Prepare test slots', async () => {
      for (const test of tests) {
        if (test.method === 'generated') continue;
        await polygonPost('problem.saveTest', {
          problemId: pid, testset: 'tests', testIndex: String(test.idx),
          testInput: `__placeholder_${test.idx}__`,
        }, key, secret);
      }
    });

    for (const test of tests) {
      if (test.method === 'generated') {
        errors.push(`Test ${test.idx}: generated tests must be set up via scripts on Polygon`);
        continue;
      }
      const numStr = String(test.idx).padStart(2, '0');
      const inputPath = path.join(problemDir, testset.input_path_pattern.replace('%02d', numStr));
      if (!fs.existsSync(inputPath)) { errors.push(`Test ${test.idx}: input file not found`); continue; }
      const input = fs.readFileSync(inputPath, 'utf-8');

      await tryStep(`Test ${test.idx}`, async () => {
        const testParams: Record<string, string> = {
          problemId: pid, testset: 'tests', testIndex: String(test.idx),
          testInput: input,
        };
        if (groupsEnabled && test.group_name) testParams.testGroup = String(test.group_name);
        if (test.description) testParams.description = String(test.description);
        // Push points for any test that has them (for EACH_TEST per test; for
        // COMPLETE_GROUP Polygon stores the total on the last test of the group)
        if (pointsEnabled && (test.points as number) > 0) {
          testParams.testPoints = String(test.points);
        }
        await polygonPost('problem.saveTest', testParams, key, secret);
      });
    }

    // Save test groups AFTER all tests are pushed (groups are created by the saveTest calls above)
    for (const g of groups) {
      await tryStep(`Test group "${g.name}"`, async () => {
        const groupParams: Record<string, string> = {
          problemId: pid, testset: 'tests', group: String(g.name),
          pointsPolicy: POLICY_MAP[g.points_policy] ?? g.points_policy.toUpperCase().replace(/-/g, '_'),
          feedbackPolicy: FEEDBACK_MAP[g.feedback_policy] ?? g.feedback_policy.toUpperCase(),
        };
        if ((g.points as number) > 0) groupParams.points = String(g.points);
        if (g.dep_str) groupParams.dependencies = g.dep_str;
        await polygonPost('problem.saveTestGroup', groupParams, key, secret);
      });
    }
  }

  return { done, errors };
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function polygonRoutes(app: FastifyInstance): Promise<void> {

  // polygon.savedKey - check if user has a saved key
  app.get('/api/polygon.savedKey', async (req, reply) => {
    const user = await auth(req, reply);
    const saved = getSavedKey(user.id);
    return ok({ hasKey: saved !== null, apiKey: saved?.apiKey ?? null, apiSecret: saved?.apiSecret ?? null });
  });

  // polygon.saveKey - save API key+secret for the current user
  app.post('/api/polygon.saveKey', async (req, reply) => {
    const user = await auth(req, reply);
    const { apiKey, apiSecret } = req.body as { apiKey?: string; apiSecret?: string };
    if (!apiKey?.trim() || !apiSecret?.trim()) {
      return reply.code(400).send({ status: 'FAILED', comment: 'apiKey and apiSecret required' });
    }
    db.prepare('UPDATE users SET polygon_api_key = ?, polygon_api_secret = ? WHERE id = ?')
      .run(apiKey.trim(), apiSecret.trim(), user.id);
    return ok(null);
  });

  // polygon.clearKey - remove saved API key
  app.post('/api/polygon.clearKey', async (req, reply) => {
    const user = await auth(req, reply);
    db.prepare('UPDATE users SET polygon_api_key = NULL, polygon_api_secret = NULL WHERE id = ?').run(user.id);
    return ok(null);
  });

  // polygon.importProblem - download a problem package from Polygon and import it
  app.post('/api/polygon.importProblem', async (req, reply) => {
    const user = await auth(req, reply);
    const { apiKey, apiSecret, polygonProblemId, remember } = req.body as {
      apiKey?: string;
      apiSecret?: string;
      polygonProblemId?: string | number;
      remember?: boolean;
    };

    const pgId = parseInt(String(polygonProblemId ?? ''));
    if (!pgId) return reply.code(400).send({ status: 'FAILED', comment: 'polygonProblemId required (numeric)' });

    let key: string, secret: string;
    try { ({ apiKey: key, apiSecret: secret } = resolveKeys(user.id, apiKey, apiSecret)); }
    catch (e: unknown) { return reply.code(400).send({ status: 'FAILED', comment: (e as Error).message }); }

    if (remember) {
      db.prepare('UPDATE users SET polygon_api_key = ?, polygon_api_secret = ? WHERE id = ?')
        .run(key, secret, user.id);
    }

    // Get list of packages
    let packages: Array<{ id: number; state: string; type: string; revision: number }>;
    try {
      packages = await polygonPost('problem.packages', { problemId: String(pgId) }, key, secret) as typeof packages;
    } catch (e: unknown) {
      return reply.code(400).send({ status: 'FAILED', comment: `Failed to fetch packages: ${(e as Error).message}` });
    }

    // Prefer linux packages; fall back to any READY package
    const readyPkgs = packages.filter(p => p.state === 'READY').sort((a, b) => b.id - a.id);
    if (!readyPkgs.length) {
      return reply.code(400).send({
        status: 'FAILED',
        comment: 'No READY packages found. Please build a package on Polygon first.',
      });
    }
    const pkg = readyPkgs.find(p => p.type === 'linux') ?? readyPkgs[0];

    const tmpPath = `/tmp/polygon_pkg_${Date.now()}_${pgId}.zip`;
    try {
      const buf = await downloadPolygonPackage(pgId, pkg.id, pkg.type ?? 'linux', key, secret);
      fs.writeFileSync(tmpPath, buf);
      const result = await importPackage(tmpPath, user.id, true);
      db.prepare('UPDATE problems SET polygon_problem_id = ? WHERE id = ?').run(pgId, result.problemId);
      return ok({ ...result, polygonProblemId: pgId, packageId: pkg.id, packageRevision: pkg.revision });
    } catch (e: unknown) {
      return reply.code(400).send({ status: 'FAILED', comment: (e as Error).message });
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  });

  // polygon.pushProblem - push local problem changes to Polygon
  app.post('/api/polygon.pushProblem', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, apiKey, apiSecret, remember } = req.body as {
      problemId?: string | number;
      apiKey?: string;
      apiSecret?: string;
      remember?: boolean;
    };

    const localId = parseInt(String(problemId ?? ''));
    if (!localId) return reply.code(400).send({ status: 'FAILED', comment: 'problemId required' });
    const problem = getProblem(localId, user.id);
    if (!problem) return reply.code(404).send({ status: 'FAILED', comment: 'Problem not found' });

    const pgId = (problem as unknown as Record<string, unknown>).polygon_problem_id as number | null;
    if (!pgId) return reply.code(400).send({ status: 'FAILED', comment: 'This problem is not linked to a Polygon problem. Use "Create on Polygon" first.' });

    let key: string, secret: string;
    try { ({ apiKey: key, apiSecret: secret } = resolveKeys(user.id, apiKey, apiSecret)); }
    catch (e: unknown) { return reply.code(400).send({ status: 'FAILED', comment: (e as Error).message }); }

    if (remember) {
      db.prepare('UPDATE users SET polygon_api_key = ?, polygon_api_secret = ? WHERE id = ?')
        .run(key, secret, user.id);
    }

    const result = await pushToPolygon(localId, pgId, key, secret);
    return ok({ polygonProblemId: pgId, ...result });
  });

  // polygon.createProblem - create a new problem on Polygon and link it to a local problem
  app.post('/api/polygon.createProblem', async (req, reply) => {
    const user = await auth(req, reply);
    const { localProblemId, name, apiKey, apiSecret, remember, pushAfter } = req.body as {
      localProblemId?: string | number;
      name?: string;
      apiKey?: string;
      apiSecret?: string;
      remember?: boolean;
      pushAfter?: boolean;
    };

    const localId = parseInt(String(localProblemId ?? ''));
    const pgName = name?.trim();
    if (!localId || !pgName) return reply.code(400).send({ status: 'FAILED', comment: 'localProblemId and name required' });
    if (!/^[a-zA-Z0-9_\-]+$/.test(pgName)) {
      return reply.code(400).send({ status: 'FAILED', comment: 'Invalid problem name (alphanumeric, _ and - only)' });
    }

    const problem = getProblem(localId, user.id);
    if (!problem) return reply.code(404).send({ status: 'FAILED', comment: 'Problem not found' });

    let key: string, secret: string;
    try { ({ apiKey: key, apiSecret: secret } = resolveKeys(user.id, apiKey, apiSecret)); }
    catch (e: unknown) { return reply.code(400).send({ status: 'FAILED', comment: (e as Error).message }); }

    if (remember) {
      db.prepare('UPDATE users SET polygon_api_key = ?, polygon_api_secret = ? WHERE id = ?')
        .run(key, secret, user.id);
    }

    // Create on Polygon
    let pgId: number;
    try {
      const created = await polygonPost('problem.create', { name: pgName }, key, secret) as { id?: number; problemId?: number };
      pgId = created.id ?? created.problemId ?? 0;
      if (!pgId) throw new Error('Polygon did not return a problem ID');
    } catch (e: unknown) {
      return reply.code(400).send({ status: 'FAILED', comment: `Failed to create on Polygon: ${(e as Error).message}` });
    }

    // Link to local problem
    db.prepare('UPDATE problems SET polygon_problem_id = ? WHERE id = ?').run(pgId, localId);

    let pushResult: { done: string[]; errors: string[] } | null = null;
    if (pushAfter) {
      try { pushResult = await pushToPolygon(localId, pgId, key, secret); }
      catch (e: unknown) { pushResult = { done: [], errors: [`Push failed: ${(e as Error).message}`] }; }
    }

    return ok({ polygonProblemId: pgId, polygonName: pgName, push: pushResult });
  });

  // polygon.linkProblem - manually link a local problem to an existing Polygon problem ID
  app.post('/api/polygon.linkProblem', async (req, reply) => {
    const user = await auth(req, reply);
    const { problemId, polygonProblemId } = req.body as {
      problemId?: string | number;
      polygonProblemId?: string | number;
    };
    const localId = parseInt(String(problemId ?? ''));
    const pgId = parseInt(String(polygonProblemId ?? ''));
    if (!localId || !pgId) return reply.code(400).send({ status: 'FAILED', comment: 'problemId and polygonProblemId required' });
    const problem = getProblem(localId, user.id);
    if (!problem) return reply.code(404).send({ status: 'FAILED', comment: 'Problem not found' });
    db.prepare('UPDATE problems SET polygon_problem_id = ? WHERE id = ?').run(pgId, localId);
    return ok({ polygonProblemId: pgId });
  });
}
