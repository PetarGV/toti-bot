// One-shot local-dev bootstrap.
// Run with: npm run dev:setup
//
// What it does:
// - Prompts for your dev Discord bot credentials
// - Writes a local .env tuned for dev (localhost picker URL, dev secret)
// - Installs dependencies if node_modules is missing
// - Optionally registers slash commands for the dev bot
//
// After this runs, start the bot with: npm run dev

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { createInterface } from 'readline';
import { randomBytes } from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENV_PATH = join(ROOT, '.env');
const ENV_EXAMPLE_PATH = join(ROOT, '.env.example');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));

function header(text) {
  console.log(`\n\x1b[1;36m▸ ${text}\x1b[0m`);
}
function info(text)  { console.log(`  ${text}`); }
function warn(text)  { console.log(`  \x1b[33m! ${text}\x1b[0m`); }
function ok(text)    { console.log(`  \x1b[32m✓ ${text}\x1b[0m`); }
function error(text) { console.log(`  \x1b[31m✗ ${text}\x1b[0m`); }

async function confirm(prompt, defaultYes = true) {
  const suffix = defaultYes ? '[Y/n]' : '[y/N]';
  const ans = (await ask(`  ${prompt} ${suffix} `)).toLowerCase();
  if (!ans) return defaultYes;
  return ans === 'y' || ans === 'yes';
}

async function main() {
  console.log('\n\x1b[1mtoti-bot · local dev setup\x1b[0m');
  console.log('─'.repeat(40));

  // Step 1: .env
  header('1. Discord credentials');

  if (existsSync(ENV_PATH)) {
    warn('.env already exists.');
    const overwrite = await confirm('Overwrite with new dev credentials?', false);
    if (!overwrite) {
      info('Keeping existing .env. Skipping to dependency check.');
    } else {
      await writeEnv();
    }
  } else {
    await writeEnv();
  }

  // Step 2: dependencies
  header('2. Dependencies');
  if (existsSync(join(ROOT, 'node_modules'))) {
    ok('node_modules present, skipping npm install.');
  } else {
    info('Running npm install...');
    const result = spawnSync('npm', ['install'], { cwd: ROOT, stdio: 'inherit', shell: true });
    if (result.status !== 0) {
      error('npm install failed.');
      rl.close();
      process.exit(1);
    }
    ok('Dependencies installed.');
  }

  // Step 3: register commands
  header('3. Slash commands');
  const wantsDeploy = await confirm('Register slash commands for the dev bot now?', true);
  if (wantsDeploy) {
    info('Running npm run deploy-commands...');
    const result = spawnSync('npm', ['run', 'deploy-commands'], { cwd: ROOT, stdio: 'inherit', shell: true });
    if (result.status !== 0) {
      warn('deploy-commands exited non-zero. Check the output above.');
    } else {
      ok('Slash commands registered.');
    }
  } else {
    info('Skipped. Run `npm run deploy-commands` later if commands are missing.');
  }

  // Done
  header('Done');
  ok('Start the bot with:  npm run dev');
  info('It will auto-restart on file save (--watch).');
  info('Web picker will be reachable at http://localhost:8080/picker');

  rl.close();
}

async function writeEnv() {
  info('Get these from https://discord.com/developers/applications:');
  info('  • DISCORD_TOKEN   → your bot\'s token (Bot tab → Reset Token)');
  info('  • CLIENT_ID       → Application ID (General Information)');
  info('  • GUILD_ID        → right-click your server → Copy Server ID');
  info('                      (enable Developer Mode in Discord settings first)');
  console.log('');

  const token   = await ask('  DISCORD_TOKEN: ');
  const client  = await ask('  CLIENT_ID    : ');
  const guild   = await ask('  GUILD_ID     : ');

  if (!token || !client || !guild) {
    error('All three are required. Aborting.');
    rl.close();
    process.exit(1);
  }

  const secret = randomBytes(32).toString('hex');

  // Start from .env.example so we keep all the optional knobs documented.
  let template = '';
  if (existsSync(ENV_EXAMPLE_PATH)) {
    template = readFileSync(ENV_EXAMPLE_PATH, 'utf8');
    template = template
      .replace(/^DISCORD_TOKEN=.*/m, `DISCORD_TOKEN=${token}`)
      .replace(/^CLIENT_ID=.*/m,    `CLIENT_ID=${client}`)
      .replace(/^GUILD_ID=.*/m,     `GUILD_ID=${guild}`)
      .replace(/^# BASE_URL=.*/m,         'BASE_URL=http://localhost:8080')
      .replace(/^# WEB_PICKER_SECRET=.*/m, `WEB_PICKER_SECRET=${secret}`);
  } else {
    template = [
      `DISCORD_TOKEN=${token}`,
      `CLIENT_ID=${client}`,
      `GUILD_ID=${guild}`,
      'TRAVIAN_SERVER_URL=https://ts2.x1.international.travian.com',
      'DEF_ROLE_NAME=def-crew',
      'LOCALE=en',
      'HEALTH_PORT=8080',
      'BASE_URL=http://localhost:8080',
      `WEB_PICKER_SECRET=${secret}`,
      '',
    ].join('\n');
  }

  writeFileSync(ENV_PATH, template);
  ok(`Wrote .env (BASE_URL=http://localhost:8080, fresh WEB_PICKER_SECRET).`);
}

main().catch((err) => {
  error(err.message);
  rl.close();
  process.exit(1);
});
