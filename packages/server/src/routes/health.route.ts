import { Router } from 'express';

export const healthRouter = Router();

/** Liveness check — used by Railway and by the client dashboard. */
healthRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'morning-briefing-server', time: new Date().toISOString() });
});
