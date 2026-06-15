import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import { getAuthUser } from './auth';
import {
  listContests, getContest, createContest, updateContest, deleteContest,
  listContestProblems, addContestProblem, removeContestProblem, reorderContestProblems,
  indexToLetter, Contest, canAccessContest, shareContestWith, unshareContest, listContestShares,
} from '../services/contests';
import { canAccessProblem } from '../services/problems';
import { findUserByUsername } from '../services/auth';
import { compileContest, contestPdfPath } from '../services/tex';
import { getContestDir } from '../db/schema';

async function auth(req: FastifyRequest, reply: FastifyReply) {
  const user = await getAuthUser(req);
  if (!user) { reply.code(401).send({ status: 'FAILED', comment: 'Not authenticated' }); throw new Error('Not authenticated'); }
  return user;
}
function ok(result: unknown) { return { status: 'OK', result }; }

function getContestForUser(id: number, user: { id: number; username: string }, reply: FastifyReply): Contest | null {
  const contest = getContest(id);
  if (!contest || (user.username !== 'admin' && !canAccessContest(id, user.id))) {
    reply.code(404).send({ status: 'FAILED', comment: 'Contest not found or access denied' });
    return null;
  }
  return contest;
}

// Only the owner (or admin) may manage a contest's shares.
function canManageContest(id: number, user: { id: number; username: string }): boolean {
  if (user.username === 'admin') return true;
  const c = getContest(id);
  return !!c && c.owner_id === user.id;
}

function problemsWithLetters(contestId: number) {
  return listContestProblems(contestId).map((p, i) => ({
    problemId: p.problem_id, index: indexToLetter(i),
    shortName: p.short_name, revision: p.revision,
  }));
}

export async function contestRoutes(app: FastifyInstance): Promise<void> {
  // contest.list
  app.get('/api/contest.list', async (req, reply) => {
    const user = await auth(req, reply);
    return ok(listContests(user.id));
  });

  // contest.create
  app.post('/api/contest.create', async (req, reply) => {
    const user = await auth(req, reply);
    const { name } = req.body as { name?: string };
    if (!name?.trim()) return reply.code(400).send({ status: 'FAILED', comment: 'name required' });
    return ok(createContest(user.id, name.trim()));
  });

  // contest.info — contest fields + ordered problems with letters
  app.get('/api/contest.info', async (req, reply) => {
    const user = await auth(req, reply);
    const id = parseInt((req.query as { contestId?: string }).contestId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'contestId required' });
    const contest = getContestForUser(id, user, reply);
    if (!contest) return;
    return ok({ ...contest, problems: problemsWithLetters(id), isOwner: canManageContest(id, user) });
  });

  // contest.problems — ordered problems with letters
  app.get('/api/contest.problems', async (req, reply) => {
    const user = await auth(req, reply);
    const id = parseInt((req.query as { contestId?: string }).contestId ?? '');
    if (!id) return ok([]);
    if (!getContestForUser(id, user, reply)) return;
    return ok(problemsWithLetters(id));
  });

  // contest.update
  app.post('/api/contest.update', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { contestId?: number | string; name?: string; location?: string; date?: string; language?: string };
    const id = parseInt(String(body.contestId ?? ''));
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'contestId required' });
    if (!getContestForUser(id, user, reply)) return;
    updateContest(id, { name: body.name, location: body.location, date: body.date, language: body.language });
    return ok(null);
  });

  // contest.delete — owner (or admin) only
  app.post('/api/contest.delete', async (req, reply) => {
    const user = await auth(req, reply);
    const id = parseInt(String((req.body as { contestId?: number | string }).contestId ?? ''));
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'contestId required' });
    if (!getContest(id)) return reply.code(404).send({ status: 'FAILED', comment: 'Contest not found' });
    if (!canManageContest(id, user)) return reply.code(403).send({ status: 'FAILED', comment: 'Only the owner can delete this contest' });
    deleteContest(id);
    const dir = getContestDir(id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    return ok(null);
  });

  // contest.addProblem
  app.post('/api/contest.addProblem', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { contestId?: number | string; problemId?: number | string };
    const id = parseInt(String(body.contestId ?? ''));
    const pid = parseInt(String(body.problemId ?? ''));
    if (!id || !pid) return reply.code(400).send({ status: 'FAILED', comment: 'contestId and problemId required' });
    if (!getContestForUser(id, user, reply)) return;
    // Only allow adding problems the user can access (owned or shared).
    if (user.username !== 'admin' && !canAccessProblem(pid, user.id)) {
      return reply.code(404).send({ status: 'FAILED', comment: 'Problem not found or access denied' });
    }
    addContestProblem(id, pid);
    return ok(problemsWithLetters(id));
  });

  // contest.removeProblem
  app.post('/api/contest.removeProblem', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { contestId?: number | string; problemId?: number | string };
    const id = parseInt(String(body.contestId ?? ''));
    const pid = parseInt(String(body.problemId ?? ''));
    if (!id || !pid) return reply.code(400).send({ status: 'FAILED', comment: 'contestId and problemId required' });
    if (!getContestForUser(id, user, reply)) return;
    removeContestProblem(id, pid);
    return ok(problemsWithLetters(id));
  });

  // contest.reorderProblems — full A/B/C order from an ordered list of problem ids
  app.post('/api/contest.reorderProblems', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { contestId?: number | string; problemIds?: number[] };
    const id = parseInt(String(body.contestId ?? ''));
    if (!id || !Array.isArray(body.problemIds)) return reply.code(400).send({ status: 'FAILED', comment: 'contestId and problemIds required' });
    if (!getContestForUser(id, user, reply)) return;
    reorderContestProblems(id, body.problemIds.map(Number));
    return ok(problemsWithLetters(id));
  });

  // contest.compileStatements — build combined statements/tutorials PDF
  app.post('/api/contest.compileStatements', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { contestId?: number | string; lang?: string; kind?: 'statements' | 'tutorials' };
    const id = parseInt(String(body.contestId ?? ''));
    const lang = body.lang || 'russian';
    const kind = body.kind === 'tutorials' ? 'tutorials' : 'statements';
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'contestId required' });
    const contest = getContestForUser(id, user, reply);
    if (!contest) return;
    const problems = problemsWithLetters(id).map(p => ({ problemId: p.problemId, index: p.index }));
    if (problems.length === 0) return reply.code(400).send({ status: 'FAILED', comment: 'Contest has no problems' });
    try {
      const result = await compileContest(contest, problems, kind, lang);
      return ok(result);
    } catch (e: unknown) {
      return reply.code(400).send({ status: 'FAILED', comment: (e as Error).message });
    }
  });

  // contest.statementsPdf — stream the compiled PDF
  app.get('/api/contest.statementsPdf', async (req, reply) => {
    const user = await auth(req, reply);
    const { contestId, lang, kind, download } = req.query as { contestId?: string; lang?: string; kind?: string; download?: string };
    const id = parseInt(contestId ?? '');
    const language = lang || 'russian';
    const k = kind === 'tutorials' ? 'tutorials' : 'statements';
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'contestId required' });
    const contest = getContestForUser(id, user, reply);
    if (!contest) return;
    const pdf = contestPdfPath(id, k, language);
    if (!fs.existsSync(pdf)) return reply.code(404).send({ status: 'FAILED', comment: 'No compiled PDF — compile first' });
    reply.header('Content-Type', 'application/pdf');
    const fname = `${contest.name || 'contest'}-${k}-${language}.pdf`.replace(/[^\w.\- ]+/g, '_');
    reply.header('Content-Disposition', `${download === 'true' ? 'attachment' : 'inline'}; filename="${fname}"`);
    return reply.send(fs.createReadStream(pdf));
  });

  // contest.shares — list users the contest is shared with (owner/admin only)
  app.get('/api/contest.shares', async (req, reply) => {
    const user = await auth(req, reply);
    const id = parseInt((req.query as { contestId?: string }).contestId ?? '');
    if (!id) return reply.code(400).send({ status: 'FAILED', comment: 'contestId required' });
    if (!canManageContest(id, user)) return reply.code(403).send({ status: 'FAILED', comment: 'Only the owner can manage sharing' });
    return ok(listContestShares(id));
  });

  // contest.share — grant a user access to the contest AND all its problems
  app.post('/api/contest.share', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { contestId?: number | string; username?: string };
    const id = parseInt(String(body.contestId ?? ''));
    const username = (body.username ?? '').trim();
    if (!id || !username) return reply.code(400).send({ status: 'FAILED', comment: 'contestId and username required' });
    if (!canManageContest(id, user)) return reply.code(403).send({ status: 'FAILED', comment: 'Only the owner can manage sharing' });
    const target = findUserByUsername(username);
    if (!target) return reply.code(404).send({ status: 'FAILED', comment: `User "${username}" not found` });
    const contest = getContest(id)!;
    if (target.id === contest.owner_id) return reply.code(400).send({ status: 'FAILED', comment: 'That user already owns this contest' });
    shareContestWith(id, target.id);
    return ok(listContestShares(id));
  });

  // contest.unshare — revoke a user's access to the contest and its problems
  app.post('/api/contest.unshare', async (req, reply) => {
    const user = await auth(req, reply);
    const body = req.body as { contestId?: number | string; username?: string };
    const id = parseInt(String(body.contestId ?? ''));
    const username = (body.username ?? '').trim();
    if (!id || !username) return reply.code(400).send({ status: 'FAILED', comment: 'contestId and username required' });
    if (!canManageContest(id, user)) return reply.code(403).send({ status: 'FAILED', comment: 'Only the owner can manage sharing' });
    const target = findUserByUsername(username);
    if (target) unshareContest(id, target.id);
    return ok(listContestShares(id));
  });
}
