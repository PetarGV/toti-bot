import 'dotenv/config';
import { Client, GatewayIntentBits, InteractionType, Events } from 'discord.js';
import { initDb, prepare, flushDb } from './db/client.js';
import { restorePanels } from './panel/deploy.js';
import { startMapFetchJob } from './jobs/mapFetch.js';
import { startExpiryJob } from './jobs/expiry.js';
import { startBackupJob } from './jobs/backup.js';
import { startTimerTickJob } from './jobs/timerTick.js';
import { startHealthServer, stopHealthServer } from './server/health.js';
import { routeCommand, routeButton, routeModal, routeSelect } from './handlers/router.js';
import { refreshOpenCalls } from './handlers/calls.js';
import { logger, flushLogs } from './utils/logger.js';
import { recordError } from './utils/metrics.js';

// Side-effect imports: register renderers with the call registry
import './handlers/resourcePush.js';
import './handlers/combat.js';
import './handlers/scoutCall.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once('clientReady', async () => {
  logger.info(`Logged in as ${client.user.tag}`);
  await restorePanels(client);
  await refreshOpenCalls(client);
  const openCount = prepare("SELECT COUNT(*) as c FROM calls WHERE status = 'open'").get();
  logger.info(`Restored ${openCount.c} active calls.`);
  startMapFetchJob();
  startExpiryJob(client);
  startBackupJob();
  startTimerTickJob(client);
});

client.on(Events.ShardDisconnect, (event, shardId) => {
  logger.warn(`Shard ${shardId} disconnected (code ${event?.code})`);
});
client.on(Events.ShardReconnecting, (shardId) => {
  logger.info(`Shard ${shardId} reconnecting`);
});
client.on(Events.ShardResume, (shardId) => {
  logger.info(`Shard ${shardId} resumed`);
});
client.on(Events.Error, (err) => {
  logger.error('Discord client error:', err);
  recordError(err);
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand())     return routeCommand(interaction);
  if (interaction.isButton())               return routeButton(interaction);
  if (interaction.isStringSelectMenu?.())   return routeSelect(interaction);
  if (interaction.type === InteractionType.ModalSubmit) return routeModal(interaction);
});

let shuttingDown = false;
async function shutdown(reason, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Shutting down: ${reason}`);
  try { client.destroy(); } catch {}
  try { await stopHealthServer(); } catch {}
  try { flushDb(); } catch {}
  try { await flushLogs(); } catch {}
  process.exit(code);
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => shutdown(sig));
}

process.on('uncaughtException', (err) => {
  logger.error('uncaughtException:', err);
  recordError(err);
  shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection:', reason);
  recordError(reason);
  shutdown('unhandledRejection', 1);
});

// Init DB before logging in
await initDb();
startHealthServer(client);
client.login(process.env.DISCORD_TOKEN);