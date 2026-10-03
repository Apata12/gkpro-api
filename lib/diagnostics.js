// Never log error objects, messages, request bodies, headers or transaction identifiers.
export function diagnosticFailure(stage, error, output = console.error) {
  const stages = new Set(['configuration','quota_ip','subscription','challenge','attest','apple_subscription_status']);
  const event = {event: 'gkpro_verification_failure', stage: stages.has(stage) ? stage : 'unknown'};
  if (Number.isInteger(error?.httpStatusCode) && error.httpStatusCode >= 100 && error.httpStatusCode <= 599) event.httpStatus = error.httpStatusCode;
  if (Number.isSafeInteger(error?.apiError) && error.apiError >= 0) event.appleErrorCode = error.apiError;
  const codes = new Set(['unconfigured','quota_unavailable','verification_unavailable','integrity_unavailable','integrity_required','integrity_key_unknown','subscription_required']);
  if (codes.has(error?.message)) event.code = error.message;
  output(JSON.stringify(event));
}
