import { createServer } from 'http';
import { prepare } from '../db/client.js';
import { snapshot } from '../utils/metrics.js';
import { logger } from '../utils/logger.js';

let server;

export function startHealthServer(client) {
  const port = parseInt(process.env.HEALTH_PORT || '8080', 10);

  server = createServer((req, res) => {
    if (req.url === '/health') {
      const ready = client?.isReady?.() === true;
      let openCalls = 0;
      try {
        openCalls = prepare("SELECT COUNT(*) c FROM calls WHERE status = 'open'").get()?.c ?? 0;
      } catch {}
      const body = {
        status: ready ? 'ok' : 'starting',
        uptimeSec: snapshot().uptimeSec,
        callsOpen: openCalls,
      };
      res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }
    if (req.url === '/metrics') {
      const data = snapshot();
      try {
        data.callsOpen = prepare("SELECT COUNT(*) c FROM calls WHERE status = 'open'").get()?.c ?? 0;
        data.callsTotal = prepare('SELECT COUNT(*) c FROM calls').get()?.c ?? 0;
        data.pledgesTotal = prepare('SELECT COUNT(*) c FROM pledges').get()?.c ?? 0;
        data.usersTotal = prepare('SELECT COUNT(*) c FROM users').get()?.c ?? 0;
      } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(port, '0.0.0.0', () => {
    logger.info(`Health server listening on :${port}`);
  });

  server.on('error', (err) => logger.error('Health server error:', err));
}

export function stopHealthServer() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
}