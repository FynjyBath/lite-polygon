"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRoutes = authRoutes;
exports.getAuthUser = getAuthUser;
exports.requireAuth = requireAuth;
const auth_1 = require("../services/auth");
async function authRoutes(app) {
    // POST /api/auth/login
    app.post('/api/auth/login', async (req, reply) => {
        const { username, password } = req.body;
        if (!username || !password) {
            return reply.code(400).send({ status: 'FAILED', comment: 'Missing credentials' });
        }
        const user = (0, auth_1.findUserByUsername)(username);
        if (!user || !(0, auth_1.verifyPassword)(user, password)) {
            return reply.code(401).send({ status: 'FAILED', comment: 'Invalid credentials' });
        }
        const sessionId = (0, auth_1.createSession)(user.id);
        reply.setCookie('session', sessionId, {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            maxAge: 30 * 24 * 60 * 60,
        });
        return { status: 'OK', result: { id: user.id, username: user.username, mustChangePassword: user.must_change_password === 1 } };
    });
    // POST /api/auth/logout
    app.post('/api/auth/logout', async (req, reply) => {
        const sessionId = req.cookies?.['session'];
        if (sessionId)
            (0, auth_1.deleteSession)(sessionId);
        reply.clearCookie('session', { path: '/' });
        return { status: 'OK' };
    });
    // POST /api/auth/register
    app.post('/api/auth/register', async (req, reply) => {
        const { username, password } = req.body;
        if (!username || !password) {
            return reply.code(400).send({ status: 'FAILED', comment: 'Missing fields' });
        }
        if (username.length < 3 || password.length < 6) {
            return reply.code(400).send({ status: 'FAILED', comment: 'Username >= 3 chars, password >= 6 chars' });
        }
        const existing = (0, auth_1.findUserByUsername)(username);
        if (existing) {
            return reply.code(409).send({ status: 'FAILED', comment: 'Username already taken' });
        }
        const user = (0, auth_1.createUser)(username, password);
        const sessionId = (0, auth_1.createSession)(user.id);
        reply.setCookie('session', sessionId, {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            maxAge: 30 * 24 * 60 * 60,
        });
        return { status: 'OK', result: { id: user.id, username: user.username } };
    });
    // GET /api/auth/me
    app.get('/api/auth/me', async (req, reply) => {
        const user = await getAuthUser(req);
        if (!user)
            return reply.code(401).send({ status: 'FAILED', comment: 'Not authenticated' });
        return { status: 'OK', result: { id: user.id, username: user.username, mustChangePassword: user.must_change_password === 1, hasApiKey: !!user.api_key } };
    });
    // POST /api/auth/changePassword
    app.post('/api/auth/changePassword', async (req, reply) => {
        const user = await getAuthUser(req);
        if (!user)
            return reply.code(401).send({ status: 'FAILED', comment: 'Not authenticated' });
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return reply.code(400).send({ status: 'FAILED', comment: 'Missing fields' });
        }
        if (!(0, auth_1.verifyPassword)(user, currentPassword)) {
            return reply.code(403).send({ status: 'FAILED', comment: 'Wrong current password' });
        }
        if (newPassword.length < 6) {
            return reply.code(400).send({ status: 'FAILED', comment: 'New password >= 6 chars' });
        }
        (0, auth_1.changePassword)(user.id, newPassword);
        return { status: 'OK' };
    });
    // POST /api/auth/generateApiKey
    app.post('/api/auth/generateApiKey', async (req, reply) => {
        const user = await getAuthUser(req);
        if (!user)
            return reply.code(401).send({ status: 'FAILED', comment: 'Not authenticated' });
        const { apiKey, apiSecret } = (0, auth_1.generateApiCredentials)(user.id);
        return { status: 'OK', result: { apiKey, apiSecret } };
    });
}
async function getAuthUser(req) {
    // 1. Try session cookie
    const sessionId = req.cookies?.['session'];
    if (sessionId) {
        const session = (0, auth_1.getSession)(sessionId);
        if (session)
            return (0, auth_1.findUserById)(session.userId);
    }
    // 2. Try API key + apiSig
    const params = { ...req.query, ...(req.body || {}) };
    const apiKey = params['apiKey'];
    if (apiKey) {
        const user = (0, auth_1.findUserByApiKey)(apiKey);
        if (!user || !user.api_secret_hash)
            return undefined;
        // Get method name from URL
        const url = req.url;
        const methodMatch = url.match(/\/api\/([^?]+)/);
        const methodName = methodMatch ? methodMatch[1] : '';
        // Reconstruct flat params from query + body
        const flatParams = {};
        for (const [k, v] of Object.entries(params)) {
            if (typeof v === 'string')
                flatParams[k] = v;
        }
        // We need to verify apiSig using the raw API secret (not hash)
        // Since we store hashed secret, we must check with bcrypt
        // But verifyApiSig needs the plain secret...
        // For local API, allow direct apiKey + apiSecret params as alternative
        const directSecret = params['apiSecret'];
        if (directSecret && (0, auth_1.verifyApiSecret)(user, directSecret)) {
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
function requireAuth(app) {
    app.addHook('onRequest', async (req, reply) => {
        const user = await getAuthUser(req);
        if (!user) {
            reply.code(401).send({ status: 'FAILED', comment: 'Authentication required' });
        }
        req.user = user;
    });
}
