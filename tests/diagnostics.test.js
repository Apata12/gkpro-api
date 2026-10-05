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

test('Apple signing and transport errors are classified without logging messages', () => {
  for (const [message,reason] of [['secretOrPrivateKey must be an asymmetric key when using ES256','apple_signing_key_invalid'],['secretOrPrivateKey is not valid key material','apple_signing_key_invalid'],['fetch failed','apple_network_failed'],['Unexpected response body format','apple_response_format_invalid']]) {
    let line; diagnosticFailure('apple_subscription_status',new Error(message),value=>line=value);
    assert.equal(JSON.parse(line).reason,reason);
    assert.equal(line.includes(message),false);
  }
});


test('Transaction diagnostics expose only the fixed verification status code', () => {
  for (const stage of ['transaction_production','transaction_sandbox']) {
    let line;
    diagnosticFailure(stage,{status:6,cause:new Error('private-receipt'),message:'private-token'},value=>line=value);
    assert.deepEqual(JSON.parse(line),{event:'gkpro_verification_failure',stage,verificationStatus:6});
    assert.equal(line.includes('private'),false);
    diagnosticFailure(stage,{status:'private-status'},value=>line=value);
    assert.equal(JSON.parse(line).verificationStatus,undefined);
  }
});
