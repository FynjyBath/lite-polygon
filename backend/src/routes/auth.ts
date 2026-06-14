import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  findUserByUsername, findUserById, createUser, verifyPassword,
  createSession, deleteSession, getSession, changePassword, generateApiCredentials,
  findUserByApiKey, verifyApiSecret,
} from '../services/auth';
import { verifyApiSig } from '../utils/apiSig';

// Simple in-memory login throttle to slow down brute-force attempts. Keyed by
// client IP; counts consecutive failures and blocks for a cooldown once a
// threshold is hit. Resets on success or after the window elapses.
const MAX_FAILS = 8;
const BLOCK_MS = 5 * 60 * 1000;
const loginFails = new Map<string, { count: number; blockedUntil: number }>();

function loginThrottle(ip: string): { allowed: boolean; retryAfterSec: number } {
  const e = loginFails.get(ip);
  if (e && e.blockedUntil > Date.now()) {
    return { allowed: false, retryAfterSec: Math.ceil((e.blockedUntil - Date.now()) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

function recordLoginFail(ip: string): void {
  const e = loginFails.get(ip) ?? { count: 0, blockedUntil: 0 };
  e.count++;
  if (e.count >= MAX_FAILS) { e.blockedUntil = Date.now() + BLOCK_MS; e.count = 0; }
  loginFails.set(ip, e);
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/auth/login
  app.post('/api/auth/login', async (req: FastifyRequest, reply: FastifyReply) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      return reply.code(400).send({ status: 'FAILED', comment: 'Missing credentials' });
    }
    const throttle = loginThrottle(req.ip);
    if (!throttle.allowed) {
      reply.header('Retry-After', String(throttle.retryAfterSec));
      return reply.code(429).send({ status: 'FAILED', comment: `Too many failed attempts. Try again in ${throttle.retryAfterSec}s.` });
    }
    const user = findUserByUsername(username);
    if (!user || !verifyPassword(user, password)) {
      recordLoginFail(req.ip);
      return reply.code(401).send({ status: 'FAILED', comment: 'Invalid credentials' });
    }
    loginFails.delete(req.ip);
    const sessionId = createSession(user.id);
    reply.setCookie('session', sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });
    return { status: 'OK', result: { id: user.id, username: user.username, mustChangePassword: user.must_change_password === 1 } };
  });

  // POST /api/auth/logout
  app.post('/api/auth/logout', async (req: FastifyRequest, reply: FastifyReply) => {
    const sessionId = req.cookies?.['session'];
    if (sessionId) deleteSession(sessionId);
    reply.clearCookie('session', { path: '/' });
    return { status: 'OK' };
  });

  // POST /api/auth/register
  app.post('/api/auth/register', async (req: FastifyRequest, reply: FastifyReply) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      return reply.code(400).send({ status: 'FAILED', comment: 'Missing fields' });
    }
    if (username.length < 3 || password.length < 6) {
      return reply.code(400).send({ status: 'FAILED', comment: 'Username >= 3 chars, password >= 6 chars' });
    }
    const existing = findUserByUsername(username);
    if (existing) {
      return reply.code(409).send({ status: 'FAILED', comment: 'Username already taken' });
    }
    const user = createUser(username, password);
    const sessionId = createSession(user.id);
    reply.setCookie('session', sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });
    return { status: 'OK', result: { id: user.id, username: user.username } };
  });

  // GET /api/auth/me
  app.get('/api/auth/me', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(req);
    if (!user) return reply.code(401).send({ status: 'FAILED', comment: 'Not authenticated' });
    return { status: 'OK', result: { id: user.id, username: user.username, mustChangePassword: user.must_change_password === 1, hasApiKey: !!user.api_key } };
  });

  // POST /api/auth/changePassword
  app.post('/api/auth/changePassword', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(req);
    if (!user) return reply.code(401).send({ status: 'FAILED', comment: 'Not authenticated' });
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
    if (!currentPassword || !newPassword) {
      return reply.code(400).send({ status: 'FAILED', comment: 'Missing fields' });
    }
    if (!verifyPassword(user, currentPassword)) {
      return reply.code(403).send({ status: 'FAILED', comment: 'Wrong current password' });
    }
    if (newPassword.length < 6) {
      return reply.code(400).send({ status: 'FAILED', comment: 'New password >= 6 chars' });
    }
    changePassword(user.id, newPassword);
    return { status: 'OK' };
  });

  // POST /api/auth/generateApiKey
  app.post('/api/auth/generateApiKey', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(req);
    if (!user) return reply.code(401).send({ status: 'FAILED', comment: 'Not authenticated' });
    const { apiKey, apiSecret } = generateApiCredentials(user.id);
    return { status: 'OK', result: { apiKey, apiSecret } };
  });
}

export async function getAuthUser(req: FastifyRequest): Promise<ReturnType<typeof findUserById>> {
  // 1. Try session cookie
  const sessionId = req.cookies?.['session'];
  if (sessionId) {
    const session = getSession(sessionId);
    if (session) return findUserById(session.userId);
  }

  // 2. Try API key + apiSig
  const params = { ...(req.query as Record<string, string>), ...(req.body as Record<string, string> || {}) };
  const apiKey = params['apiKey'];
  if (apiKey) {
    const user = findUserByApiKey(apiKey);
    if (!user || !user.api_secret_hash) return undefined;

    // Get method name from URL
    const url = req.url;
    const methodMatch = url.match(/\/api\/([^?]+)/);
    const methodName = methodMatch ? methodMatch[1] : '';

    // Reconstruct flat params from query + body
    const flatParams: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === 'string') flatParams[k] = v;
    }

    // We need to verify apiSig using the raw API secret (not hash)
    // Since we store hashed secret, we must check with bcrypt
    // But verifyApiSig needs the plain secret...
    // For local API, allow direct apiKey + apiSecret params as alternative
    const directSecret = params['apiSecret'];
    if (directSecret && verifyApiSecret(user, directSecret)) {
      return user;
    }

    // Verify apiSig if provided - we can't do this without storing plain secret
    // So apiSig-based auth requires storing the secret (security tradeoff for local use)
    const apiSig = params['apiSig'];
    if (apiSig) {
      // Try to get stored plain secret - not available since we hash it
      // For compatibility, allow if apiKey matches and apiSecret is correct
    }
  }

  return undefined;
}

export function requireAuth(app: FastifyInstance): void {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(req);
    if (!user) {
      reply.code(401).send({ status: 'FAILED', comment: 'Authentication required' });
    }
    (req as FastifyRequest & { user: unknown }).user = user;
  });
}
