import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
const { channelSlug, normalizeChannelCapacity, normalizeChannelName, normalizeName, normalizeServerName, serverSlug } = await import('./index.mjs');

test('normalizeName limpa e limita apelidos', () => {
  assert.equal(normalizeName('  Ana   Maria  '), 'Ana Maria');
  assert.equal(normalizeName('<script>João</script>'), 'scriptJoãoscript');
  assert.equal(normalizeName('a'.repeat(40)).length, 32);
  assert.equal(normalizeName(null), '');
});

test('normalizeChannelName cria nomes e slugs seguros', () => {
  assert.equal(normalizeChannelName('  Café   com amigos!  '), 'Café com amigos');
  assert.equal(channelSlug('Café com amigos'), 'cafe-com-amigos');
  assert.equal(channelSlug('---'), '');
});

test('normalizeServerName limita a 10 caracteres e limpa símbolos', () => {
  assert.equal(normalizeServerName('  Sala   VIP  '), 'Sala VIP');
  assert.equal(normalizeServerName('Servidor Gigante!!!'), 'Servidor G');
  assert.equal(normalizeServerName('a'.repeat(20)).length, 10);
  assert.equal(normalizeServerName(null), '');
  assert.equal(serverSlug('Sala VIP'), 'sala-vip');
  assert.equal(serverSlug('---'), '');
});

test('normalizeChannelCapacity aceita somente limites inteiros entre 2 e 10', () => {
  assert.equal(normalizeChannelCapacity(2), 2);
  assert.equal(normalizeChannelCapacity('10'), 10);
  assert.equal(normalizeChannelCapacity(1), null);
  assert.equal(normalizeChannelCapacity(11), null);
  assert.equal(normalizeChannelCapacity(4.5), null);
  assert.equal(normalizeChannelCapacity('quatro'), null);
});
