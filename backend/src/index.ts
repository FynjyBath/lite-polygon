import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { initSchema } from './db/schema';
import { authRoutes } from './routes/auth';
import { problemRoutes } from './routes/problems';

const PORT = parseInt(process.env.PORT ?? '5000');
const HOST = process.env.HOST ?? '0.0.0.0';
const FRONTEND_DIST = process.env.FRONTEND_DIST || path.join(__dirname, '..', '..', 'frontend', 'dist');

async function main() {
  // Initialize DB
  initSchema();

  const app = Fastify({
    logger: { level: process.env.NODE_ENV === 'production' ? 'warn' : 'info' },
    bodyLimit: 50 * 1024 * 1024, // 50MB
  });

  // Plugins
  await app.register(fastifyCookie);
  await app.register(fastifyCors, {
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
  });
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 200 * 1024 * 1024, // 200MB
      files: 1,
    },
  });

  // Serve frontend static files if dist exists
  if (fs.existsSync(FRONTEND_DIST)) {
    await app.register(fastifyStatic, {
      root: FRONTEND_DIST,
      prefix: '/',
    });

    // SPA fallback
    app.setNotFoundHandler((req, reply) => {
      if (!req.url.startsWith('/api/')) {
        const indexPath = path.join(FRONTEND_DIST, 'index.html');
        if (fs.existsSync(indexPath)) {
          reply.header('Content-Type', 'text/html; charset=utf-8');
          return reply.send(fs.readFileSync(indexPath));
        }
      }
      reply.code(404).send({ status: 'FAILED', comment: 'Not found' });
    });
  }

  // Routes
  await app.register(authRoutes);
  await app.register(problemRoutes);

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
