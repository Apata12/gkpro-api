import test from 'node:test';
import assert from 'node:assert/strict';
import {redisConfig} from '../lib/redis-config.js';
import {makeQuota} from '../lib/quota.js';
import {makeIntegrity} from '../lib/integrity.js';

const managed = {
  GKPRO_REDIS_KV_REST_API_URL: 'https://managed-redis.example.test',
  GKPRO_REDIS_KV_REST_API_TOKEN: 'test-write-token',
  GKPRO_REDIS_KV_REST_API_READ_ONLY_TOKEN: 'test-read-only-token',
  GKPRO_QUOTA_HMAC_SECRET: 'x'.repeat(32),
  GKPRO_APP_ATTEST_TEAM_ID: 'TESTTEAM01'
};

test('Managed Upstash variables support both quota and attestation writes', async () => {
  const calls = [];
  const transport = async (url, options) => {
    const command = JSON.parse(options.body);
    calls.push({url, authorization: options.headers.Authorization, command});
    return {ok: true, json: async () => ({result: command[0] === 'EVAL' ? 24 : 'OK'})};
  };
  assert.equal(await makeQuota(managed, transport).reserveAccount('synthetic-id', 'Production'), 24);
  const challenge = await makeIntegrity(managed, transport).issue(
    {purpose: 'attest', keyID: Buffer.alloc(32).toString('base64')},
    {id: 'synthetic-id', environment: 'Production'}
  );
  assert.match(challenge, /^[0-9a-f]{64}$/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command[0], 'EVAL');
  assert.equal(calls[1].command[0], 'SET');
  for (const call of calls) {
    assert.equal(call.url, managed.GKPRO_REDIS_KV_REST_API_URL);
    assert.equal(call.authorization, 'Bearer test-write-token');
  }
});

test('Explicit Redis configuration wins without mixing providers', () => {
  assert.deepEqual(redisConfig({...managed,
    GKPRO_REDIS_REST_URL: 'https://explicit.example.test', GKPRO_REDIS_REST_TOKEN: 'explicit-token'
  }), {url: 'https://explicit.example.test', token: 'explicit-token'});
  for (const incomplete of [
    {GKPRO_REDIS_REST_URL: 'https://explicit.example.test'},
    {GKPRO_REDIS_REST_TOKEN: 'explicit-token'},
    {GKPRO_REDIS_REST_URL: '', GKPRO_REDIS_REST_TOKEN: ''}
  ]) assert.throws(() => redisConfig({...managed, ...incomplete}), /unconfigured/);
});

test('Read-only and non-HTTPS Redis configuration fail closed', () => {
  const readOnly = {...managed}; delete readOnly.GKPRO_REDIS_KV_REST_API_TOKEN;
  for (const invalid of [readOnly, {...managed, GKPRO_REDIS_KV_REST_API_URL: 'redis://local'}, {}]) {
    assert.throws(() => makeQuota(invalid), /unconfigured/);
    assert.throws(() => makeIntegrity(invalid), /unconfigured/);
  }
});
