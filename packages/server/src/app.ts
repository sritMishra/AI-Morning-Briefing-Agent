import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import { logger } from './lib/logger.js';
import { briefRouter } from './routes/brief.route.js';
import { healthRouter } from './routes/health.route.js';

/** Builds the Express app (kept separate from index.ts so tests can import it). */
export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  app.use(healthRouter);
  app.use(briefRouter);

  return app;
}
