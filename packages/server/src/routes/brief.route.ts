import { Router } from 'express';

import { runBriefNow } from '../controllers/brief.controller.js';

export const briefRouter = Router();

/** POST /brief/run — manually trigger a briefing run (read-only analyser). */
briefRouter.post('/brief/run', runBriefNow);
