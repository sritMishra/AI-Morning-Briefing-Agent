import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { startScheduler } from './scheduler.js';

const app = createApp();

app.listen(env.PORT, () => {
  logger.info(`🚀 Morning-briefing server listening on http://localhost:${env.PORT}`);
  startScheduler();
});
