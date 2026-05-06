// Run once: node src/commands/deploy.js
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commandDefinitions } from './definitions.js';

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

console.log('Registering slash commands...');
await rest.put(
  Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
  { body: commandDefinitions },
);
console.log('Done.');
