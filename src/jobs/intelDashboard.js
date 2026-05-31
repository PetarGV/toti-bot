import cron from 'node-cron';
import { rebuildDashboard } from '../handlers/intel.js';
import { logger } from '../utils/logger.js';

export function startIntelDashboardJob(client) {
  cron.schedule('*/5 * * * *', () => {
    rebuildDashboard(client).catch(err => logger.warn('intel cron rebuild:', err.message));
  });
  logger.info('Intel dashboard job scheduled every 5 minutes');
}
