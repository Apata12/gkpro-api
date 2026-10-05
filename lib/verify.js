import { diagnosticFailure } from './diagnostics.js';
import { readFileSync } from "node:fs";
import { SignedDataVerifier, Environment, AppStoreServerAPIClient, Status, VerificationStatus } from "@apple/app-store-server-library";
import { BUNDLE_ID, PRODUCTS } from "./policy.js";

// This function consumes only payloads already verified by Apple's verifier.
export function validateCurrentEntitlement(transaction, renewal, status, originalId, now) {
  if (transaction.bundleId !== BUNDLE_ID || !PRODUCTS.has(transaction.productId) ||
      transaction.originalTransactionId !== originalId || transaction.revocationDate != null || transaction.isUpgraded)
    throw new Error("subscription_required");
  const paid = status === Status.ACTIVE && typeof transaction.expiresDate === "number" && transaction.expiresDate > now;
  const grace = status === Status.BILLING_GRACE_PERIOD && renewal?.originalTransactionId === originalId &&
    renewal.environment === transaction.environment && PRODUCTS.has(renewal.productId) &&
    typeof renewal.gracePeriodExpiresDate === "number" && renewal.gracePeriodExpiresDate > now;
  if (!paid && !grace) throw new Error("subscription_required");
  return {id:originalId,environment:transaction.environment};
}

export function makeVerifier(env = process.env) {
  const appId = Number(env.GKPRO_APP_APPLE_ID);
  if (!Number.isSafeInteger(appId) || appId <= 0 || !env.GKPRO_APPSTORE_PRIVATE_KEY ||
      !env.GKPRO_APPSTORE_KEY_ID || !env.GKPRO_APPSTORE_ISSUER_ID) throw new Error("unconfigured");
  const roots = ["AppleRootCA-G2.cer","AppleRootCA-G3.cer"].map(name => readFileSync(new URL("../certs/"+name,import.meta.url)));
  function environment(value) {
    return {verifier:new SignedDataVerifier(roots,true,value,BUNDLE_ID,value===Environment.PRODUCTION?appId:undefined),
      client:new AppStoreServerAPIClient(env.GKPRO_APPSTORE_PRIVATE_KEY.replace(/\\n/g,"\n"),env.GKPRO_APPSTORE_KEY_ID,env.GKPRO_APPSTORE_ISSUER_ID,BUNDLE_ID,value)};
  }
  const production = environment(Environment.PRODUCTION);
  const sandbox = env.GKPRO_ALLOW_SANDBOX === "true" ? environment(Environment.SANDBOX) : null;
  return async function verify(signed, now = Date.now()) {
    let presented,selected=production;
    try { presented = await selected.verifier.verifyAndDecodeTransaction(signed); }
    catch (productionError) {
      if (!sandbox) { diagnosticFailure("transaction_production", productionError); }
      if (!sandbox) throw new Error("subscription_required");
      selected=sandbox;
      try { presented = await selected.verifier.verifyAndDecodeTransaction(signed); }
      catch (sandboxError) {
        diagnosticFailure("transaction_production", productionError);
        diagnosticFailure("transaction_sandbox", sandboxError);
        if ([productionError, sandboxError].some(error => error?.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE)) throw new Error("verification_unavailable");
        throw new Error("subscription_required");
      }
    }
    if (presented.bundleId !== BUNDLE_ID || !PRODUCTS.has(presented.productId) ||
        typeof presented.originalTransactionId !== "string" || !presented.originalTransactionId || presented.revocationDate != null)
      throw new Error("subscription_required");
    // A signed historical transaction alone is not proof of a currently active subscription.
    // Query Apple to reject refunded/revoked annual receipts and honor billing grace periods.
    let current;
    try { current=await selected.client.getAllSubscriptionStatuses(presented.originalTransactionId); }
    catch (error) { diagnosticFailure("apple_subscription_status", error); throw new Error("verification_unavailable"); }
    for (const group of current.data ?? []) for (const item of group.lastTransactions ?? []) {
      if (item.originalTransactionId !== presented.originalTransactionId || !item.signedTransactionInfo) continue;
      let transaction,renewal;
      try {
        transaction=await selected.verifier.verifyAndDecodeTransaction(item.signedTransactionInfo);
        if (item.status===Status.BILLING_GRACE_PERIOD && item.signedRenewalInfo)
          renewal=await selected.verifier.verifyAndDecodeRenewalInfo(item.signedRenewalInfo);
      } catch { throw new Error("verification_unavailable"); }
      try { return validateCurrentEntitlement(transaction,renewal,item.status,presented.originalTransactionId,now); }
      catch (error) { diagnosticFailure("current_entitlement", error); throw error; }
    }
    throw new Error("subscription_required");
  };
}
