import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../db/schema';

export interface User {
  id: number;
  username: string;
  password_hash: string;
  api_key: string | null;
  api_secret_hash: string | null;
  must_change_password: number;
}

export function findUserByUsername(username: string): User | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;
}

export function findUserById(id: number): User | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
}

export function findUserByApiKey(apiKey: string): User | undefined {
  return db.prepare('SELECT * FROM users WHERE api_key = ?').get(apiKey) as User | undefined;
}

export function createUser(username: string, password: string): User {
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO users (username, password_hash) VALUES (?, ?)'
  ).run(username, hash);
  return findUserById(result.lastInsertRowid as number)!;
}

export function verifyPassword(user: User, password: string): boolean {
  return bcrypt.compareSync(password, user.password_hash);
}

export function changePassword(userId: number, newPassword: string): void {
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(hash, userId);
}

export function generateApiCredentials(userId: number): { apiKey: string; apiSecret: string } {
  const apiKey = crypto.randomBytes(16).toString('hex');
  const apiSecret = crypto.randomBytes(32).toString('hex');
  const secretHash = bcrypt.hashSync(apiSecret, 10);
  db.prepare('UPDATE users SET api_key = ?, api_secret_hash = ? WHERE id = ?')
    .run(apiKey, secretHash, userId);
  return { apiKey, apiSecret };
}

export function verifyApiSecret(user: User, secret: string): boolean {
  if (!user.api_secret_hash) return false;
  return bcrypt.compareSync(secret, user.api_secret_hash);
}

// Session management (simple DB-backed sessions)
export function createSession(userId: number): string {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(sessionId, userId, expiresAt);
  return sessionId;
}

export function getSession(sessionId: string): { userId: number } | undefined {
  const row = db.prepare(
    "SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime('now')"
  ).get(sessionId) as { user_id: number } | undefined;
  return row ? { userId: row.user_id } : undefined;
}

export function deleteSession(sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}
