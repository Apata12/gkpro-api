// Never log error objects, messages, request bodies, headers or transaction identifiers.
export function diagnosticFailure(stage, error, output = console.error) {
  const stages = new Set(['configuration','quota_ip','subscription','challenge','attest','apple_subscription_status','transaction_production','transaction_sandbox','current_entitlement']);
  const event = {event: 'gkpro_verification_failure', stage: stages.has(stage) ? stage : 'unknown'};
  if (Number.isInteger(error?.httpStatusCode) && error.httpStatusCode >= 100 && error.httpStatusCode <= 599) event.httpStatus = error.httpStatusCode;
  if (Number.isSafeInteger(error?.apiError) && error.apiError >= 0) event.appleErrorCode = error.apiError;
  if (['transaction_production','transaction_sandbox'].includes(stage) && Number.isInteger(error?.status) && error.status >= 0 && error.status <= 7) event.verificationStatus = error.status;
  const codes = new Set(['unconfigured','quota_unavailable','verification_unavailable','integrity_unavailable','integrity_required','integrity_key_unknown','subscription_required']);
  if (codes.has(error?.message)) event.code = error.message;
  const reasons = new Map([
    ['secretOrPrivateKey must be an asymmetric key when using ES256', 'apple_signing_key_invalid'],
    ['secretOrPrivateKey is not valid key material', 'apple_signing_key_invalid'],
    ['fetch failed', 'apple_network_failed'],
    ['Unexpected response body format', 'apple_response_format_invalid']
  ]);
  if (stage === 'apple_subscription_status' && reasons.has(error?.message)) event.reason = reasons.get(error.message);
  output(JSON.stringify(event));
}
