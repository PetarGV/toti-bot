import test from 'node:test';
import assert from 'node:assert/strict';
import { commandDefinitions } from '../src/commands/definitions.js';

test('/admin exposes link, unlink, and set-primary subcommands', () => {
  const admin = commandDefinitions.find(c => c.name === 'admin');
  const subs = admin.options.map(o => o.name);
  for (const expected of ['link', 'unlink', 'set-primary']) {
    assert.ok(subs.includes(expected), `missing /admin ${expected}`);
  }
});

test('/admin link requires discord user and ign options', () => {
  const admin = commandDefinitions.find(c => c.name === 'admin');
  const link = admin.options.find(o => o.name === 'link');
  const optNames = link.options.map(o => o.name).sort();
  assert.deepEqual(optNames, ['discord', 'ign']);
});

test('/admin exposes set-welcome-channel with a channel option', () => {
  const admin = commandDefinitions.find(c => c.name === 'admin');
  const sub = admin.options.find(o => o.name === 'set-welcome-channel');
  assert.ok(sub, 'set-welcome-channel subcommand exists');
  const opt = sub.options.find(o => o.name === 'channel');
  assert.ok(opt, 'channel option exists');
  assert.equal(opt.type, 7); // ApplicationCommandOptionType.Channel
});

test('/admin exposes set-coords with discord and coords options', () => {
  const admin = commandDefinitions.find(c => c.name === 'admin');
  const sub = admin.options.find(o => o.name === 'set-coords');
  assert.ok(sub, 'set-coords subcommand exists');
  const optNames = sub.options.map(o => o.name).sort();
  assert.deepEqual(optNames, ['coords', 'discord']);
});
