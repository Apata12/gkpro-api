import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnosticFailure} from '../lib/diagnostics.js';
test('Diagnostics retain only allowlisted stage and numeric Apple status', () => {
  let line;
  diagnosticFailure('apple_subscription_status', {httpStatusCode:401,apiError:4000001,message:'private-token',response:{signedTransaction:'private-receipt'},headers:{authorization:'private-key'}}, value => line=value);
  assert.deepEqual(JSON.parse(line), {event:'gkpro_verification_failure',stage:'apple_subscription_status',httpStatus:401,appleErrorCode:4000001});
  assert.equal(line.includes('private'),false);
});
test('Unknown stage and invalid status cannot inject sensitive strings', () => {
  let line;
  diagnosticFailure('private-question', {httpStatusCode:'private-token',apiError:-1,message:'private-key'}, value => line=value);
  assert.deepEqual(JSON.parse(line),{event:'gkpro_verification_failure',stage:'unknown'});
});
test('Known internal failures are classified without raw errors', () => {
  let line;
  diagnosticFailure('quota_ip',new Error('quota_unavailable'),value=>line=value);
  assert.equal(JSON.parse(line).code,'quota_unavailable');
});
