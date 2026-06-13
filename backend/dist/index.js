"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const cookie_1 = __importDefault(require("@fastify/cookie"));
const cors_1 = __importDefault(require("@fastify/cors"));
const multipart_1 = __importDefault(require("@fastify/multipart"));
const static_1 = __importDefault(require("@fastify/static"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const schema_1 = require("./db/schema");
const auth_1 = require("./routes/auth");
const problems_1 = require("./routes/problems");
const PORT = parseInt(process.env.PORT ?? '5000');
const HOST = process.env.HOST ?? '0.0.0.0';
const FRONTEND_DIST = process.env.FRONTEND_DIST || path_1.default.join(__dirname, '..', '..', 'frontend', 'dist');
async function main() {
    // Initialize DB
    (0, schema_1.initSchema)();
    // Clean up any invocations that were left in RUNNING state by a previous crash
    schema_1.db.prepare("UPDATE invocations SET state = 'FAILED' WHERE state = 'RUNNING'").run();
    const app = (0, fastify_1.default)({
        logger: { level: process.env.NODE_ENV === 'production' ? 'warn' : 'info' },
        bodyLimit: 50 * 1024 * 1024, // 50MB
    });
    // Plugins
    await app.register(cookie_1.default);
    await app.register(cors_1.default, {
        origin: process.env.CORS_ORIGIN || true,
        credentials: true,
    });
    await app.register(multipart_1.default, {
        limits: {
            fileSize: 200 * 1024 * 1024, // 200MB
            files: 1,
        },
    });
    // Serve frontend static files if dist exists
    if (fs_1.default.existsSync(FRONTEND_DIST)) {
        await app.register(static_1.default, {
            root: FRONTEND_DIST,
            prefix: '/',
        });
        // SPA fallback
        app.setNotFoundHandler((req, reply) => {
            if (!req.url.startsWith('/api/')) {
                const indexPath = path_1.default.join(FRONTEND_DIST, 'index.html');
                if (fs_1.default.existsSync(indexPath)) {
                    reply.header('Content-Type', 'text/html; charset=utf-8');
                    return reply.send(fs_1.default.readFileSync(indexPath));
                }
            }
            reply.code(404).send({ status: 'FAILED', comment: 'Not found' });
        });
    }
    // Routes
    await app.register(auth_1.authRoutes);
    await app.register(problems_1.problemRoutes);
    // Health check
    app.get('/api/health', async () => ({ status: 'OK', time: new Date().toISOString() }));
    // Error handler
    app.setErrorHandler((error, req, reply) => {
        app.log.error(error);
        if (error.validation) {
            return reply.code(400).send({ status: 'FAILED', comment: error.message });
        }
        if (!reply.sent) {
            reply.code(500).send({ status: 'FAILED', comment: 'Internal server error' });
        }
    });
    await app.listen({ port: PORT, host: HOST });
    console.log(`\nlite-polygon backend running at http://localhost:${PORT}`);
    console.log(`API: http://localhost:${PORT}/api/`);
}
main().catch(e => {
    console.error(e);
    process.exit(1);
});
