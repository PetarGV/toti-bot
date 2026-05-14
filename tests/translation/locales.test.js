import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORTED_LANGS,
  FALLBACK_LANG,
  discordLocaleToDeepl,
  flagToDeepl,
  flagForLang,
  langChoices,
} from '../../src/utils/translation/locales.js';

test('SUPPORTED_LANGS contains the configured DeepL target codes', () => {
  assert.equal(SUPPORTED_LANGS.length, 12);
  for (const code of ['EN-GB', 'EN-US', 'DE', 'FR', 'ES', 'RU', 'BG', 'PL', 'IT', 'NL', 'PT-PT', 'PT-BR']) {
    assert.ok(SUPPORTED_LANGS.includes(code), `missing ${code}`);
  }
});

test('FALLBACK_LANG is EN-GB', () => {
  assert.equal(FALLBACK_LANG, 'EN-GB');
});

test('discordLocaleToDeepl maps known Discord locales', () => {
  assert.equal(discordLocaleToDeepl('en-US'), 'EN-US');
  assert.equal(discordLocaleToDeepl('en-GB'), 'EN-GB');
  assert.equal(discordLocaleToDeepl('de'), 'DE');
  assert.equal(discordLocaleToDeepl('pt-BR'), 'PT-BR');
  assert.equal(discordLocaleToDeepl('pt-PT'), 'PT-PT');
  assert.equal(discordLocaleToDeepl('bg'), 'BG');
});

test('discordLocaleToDeepl returns null for unsupported locale', () => {
  assert.equal(discordLocaleToDeepl('ja'), null);
  assert.equal(discordLocaleToDeepl('zh-CN'), null);
  assert.equal(discordLocaleToDeepl(''), null);
  assert.equal(discordLocaleToDeepl(undefined), null);
});

test('flagToDeepl maps known flag emojis', () => {
  assert.equal(flagToDeepl('🇬🇧'), 'EN-GB');
  assert.equal(flagToDeepl('🇺🇸'), 'EN-US');
  assert.equal(flagToDeepl('🇩🇪'), 'DE');
  assert.equal(flagToDeepl('🇫🇷'), 'FR');
  assert.equal(flagToDeepl('🇪🇸'), 'ES');
  assert.equal(flagToDeepl('🇷🇺'), 'RU');
  assert.equal(flagToDeepl('🇧🇬'), 'BG');
  assert.equal(flagToDeepl('🇵🇱'), 'PL');
  assert.equal(flagToDeepl('🇮🇹'), 'IT');
  assert.equal(flagToDeepl('🇳🇱'), 'NL');
  assert.equal(flagToDeepl('🇵🇹'), 'PT-PT');
  assert.equal(flagToDeepl('🇧🇷'), 'PT-BR');
});

test('flagToDeepl returns null for non-flag emojis and unknown flags', () => {
  assert.equal(flagToDeepl('👍'), null);
  assert.equal(flagToDeepl('🇯🇵'), null);
  assert.equal(flagToDeepl(''), null);
  assert.equal(flagToDeepl(undefined), null);
});

test('flagForLang returns the primary flag for supported languages', () => {
  assert.equal(flagForLang('DE'), '🇩🇪');
  assert.equal(flagForLang('PT-BR'), '🇧🇷');
  assert.equal(flagForLang('ja'), '');
  assert.equal(flagForLang(undefined), '');
});

test('langChoices produces Discord-shaped choice objects for all supported languages', () => {
  const choices = langChoices();
  assert.equal(choices.length, SUPPORTED_LANGS.length);
  for (const choice of choices) {
    assert.ok(typeof choice.name === 'string' && choice.name.length > 0);
    assert.ok(SUPPORTED_LANGS.includes(choice.value));
  }
});
