// Force UTC for all Date operations (deadline parsing, formatting, logs).
// Must run before any Date is constructed, so it stays at the top of the file.
process.env.TZ = 'UTC';

import 'dotenv/config';
import { Client, GatewayIntentBits, InteractionType, Events, Partials } from 'discord.js';
import { initDb, prepare, flushDb, getConfig } from './db/client.js';
import { restorePanels } from './panel/deploy.js';
import { startMapFetchJob, fetchMapWithRetry } from './jobs/mapFetch.js';
import { startExpiryJob } from './jobs/expiry.js';
import { startBackupJob } from './jobs/backup.js';
import { startTimerTickJob } from './jobs/timerTick.js';
import { startMemberSyncJob, runMemberSync } from './jobs/memberSync.js';
import { unixNow } from './utils/time.js';
import { startHealthServer, stopHealthServer } from './server/health.js';
import { routeCommand, routeButton, routeModal, routeSelect } from './handlers/router.js';
import { handleGuildMemberAdd, handleGuildMemberRemove } from './handlers/onboarding.js';
import { handleTranslateReaction } from './handlers/translateReaction.js';
import { refreshOpenCalls } from './handlers/calls.js';
import { logger, flushLogs } from './utils/logger.js';
import { recordError } from './utils/metrics.js';

// Side-effect imports: register renderers with the call registry
import './handlers/resourcePush.js';
import './handlers/combat.js';
import './handlers/scoutCall.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
  ],
});

client.once('clientReady', async () => {
  logger.info(`Logged in as ${client.user.tag}`);
  if (!process.env.DEEPL_API_KEY) {
    logger.warn('DEEPL_API_KEY not set - /translate and flag-reaction translation will be disabled');
  }
  await restorePanels(client);
  await refreshOpenCalls(client);
  const openCount = prepare("SELECT COUNT(*) as c FROM calls WHERE status = 'open'").get();
  logger.info(`Restored ${openCount.c} active calls.`);
  startMapFetchJob(client);
  startExpiryJob(client);
  startBackupJob(client);
  startTimerTickJob(client);
  startMemberSyncJob(client);
  catchUpStaleJobs(client).catch(err => logger.error('Startup catch-up failed:', err));
});

const STALE_MAP_FETCH_SEC = 25 * 3600; // 25h — covers the daily 24h gap plus jitter
const STALE_MEMBER_SYNC_SEC = 13 * 3600; // 13h — sync runs every 12h

async function catchUpStaleJobs(client) {
  const now = unixNow();
  const lastFetch = parseInt(getConfig('last_fetch_at') ?? '0', 10);
  if (now - lastFetch > STALE_MAP_FETCH_SEC) {
    logger.info(`Startup: map data is stale (last fetch ${lastFetch || 'never'}) — fetching now`);
    try {
      await fetchMapWithRetry();
    } catch (err) {
      logger.warn('Startup map fetch failed:', err.message);
      return; // skip sync if fetch failed — would run against stale data
    }
  }
  const lastSync = parseInt(getConfig('last_sync_at') ?? '0', 10);
  if (now - lastSync > STALE_MEMBER_SYNC_SEC) {
    logger.info(`Startup: member sync is stale (last sync ${lastSync || 'never'}) — running now`);
    try {
      await runMemberSync(client);
    } catch (err) {
      logger.warn('Startup member sync failed:', err.message);
    }
  }
}

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

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    await handleGuildMemberAdd(member);
  } catch (err) {
    logger.error('guildMemberAdd handler crashed:', err);
    recordError(err);
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  try {
    await handleGuildMemberRemove(member);
  } catch (err) {
    logger.error('guildMemberRemove handler crashed:', err);
    recordError(err);
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    await handleTranslateReaction(reaction, user);
  } catch (err) {
    logger.error('messageReactionAdd handler crashed:', err);
    recordError(err);
  }
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
