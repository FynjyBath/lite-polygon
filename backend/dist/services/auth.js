"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findUserByUsername = findUserByUsername;
exports.findUserById = findUserById;
exports.findUserByApiKey = findUserByApiKey;
exports.createUser = createUser;
exports.verifyPassword = verifyPassword;
exports.changePassword = changePassword;
exports.generateApiCredentials = generateApiCredentials;
exports.verifyApiSecret = verifyApiSecret;
exports.createSession = createSession;
exports.getSession = getSession;
exports.deleteSession = deleteSession;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const schema_1 = require("../db/schema");
function findUserByUsername(username) {
    return schema_1.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}
function findUserById(id) {
    return schema_1.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
function findUserByApiKey(apiKey) {
    return schema_1.db.prepare('SELECT * FROM users WHERE api_key = ?').get(apiKey);
}
function createUser(username, password) {
    const hash = bcryptjs_1.default.hashSync(password, 10);
    const result = schema_1.db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
    return findUserById(result.lastInsertRowid);
}
function verifyPassword(user, password) {
    return bcryptjs_1.default.compareSync(password, user.password_hash);
}
function changePassword(userId, newPassword) {
    const hash = bcryptjs_1.default.hashSync(newPassword, 10);
    schema_1.db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
        .run(hash, userId);
}
function generateApiCredentials(userId) {
    const apiKey = crypto_1.default.randomBytes(16).toString('hex');
    const apiSecret = crypto_1.default.randomBytes(32).toString('hex');
    const secretHash = bcryptjs_1.default.hashSync(apiSecret, 10);
    schema_1.db.prepare('UPDATE users SET api_key = ?, api_secret_hash = ? WHERE id = ?')
        .run(apiKey, secretHash, userId);
    return { apiKey, apiSecret };
}
function verifyApiSecret(user, secret) {
    if (!user.api_secret_hash)
        return false;
    return bcryptjs_1.default.compareSync(secret, user.api_secret_hash);
}
// Session management (simple DB-backed sessions)
function createSession(userId) {
    const sessionId = crypto_1.default.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    schema_1.db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(sessionId, userId, expiresAt);
    return sessionId;
}
function getSession(sessionId) {
    const row = schema_1.db.prepare("SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime('now')").get(sessionId);
    return row ? { userId: row.user_id } : undefined;
}
function deleteSession(sessionId) {
    schema_1.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}
