# GKPro secure AI proxy

This directory contains the replacement `/api/chat` implementation. Its presence in the iOS repository does **not** mean it is deployed to `gkpro-api.vercel.app`.

The updated iOS client sends a base64 envelope of `task`, structured task input and an Apple-signed `signedTransaction`, bound to a one-time Apple App Attest assertion. `/api/integrity` issues challenges and registers Apple-attested installation keys. The server selects the model, system policy and token budget. The previous client-provided `messages` contract is incompatible with the updated client.

## Required deployment configuration

Use Node 22 or later and install the locked dependencies with `npm ci`. Set the server-only variables listed in `.env.example`:

- OpenAI API key.
- Numeric Apple app ID, In-App Purchase private key, key ID and issuer ID.
- HTTPS Redis REST endpoint and token, and a random HMAC secret of at least 32 characters.
- Apple team ID for the `com.gkpro.app` App Attest RP identity. Enable the App Attest capability in the app provisioning profile; debug uses development and release uses production.
- Keep Sandbox disabled in production unless actual App Review/TestFlight subscription verification requires it. Xcode-local StoreKit test signatures are not production Apple-signed subscriptions.

Never put these values in Swift, commit them or include them in logs. Missing configuration fails closed with HTTP 503.

The Upstash Vercel integration with custom prefix `GKPRO_REDIS` creates `GKPRO_REDIS_KV_REST_API_URL` and `GKPRO_REDIS_KV_REST_API_TOKEN`. Both quota and App Attest accept this managed pair automatically. Keep the integration scoped to Preview during validation. Do not use its read-only token or TCP Redis URL. The original `GKPRO_REDIS_REST_URL`/`GKPRO_REDIS_REST_TOKEN` pair is still supported and takes precedence; remove incomplete overrides rather than mixing providers. The HMAC secret and Apple settings remain separate required variables.

Merge `api`, `lib`, `certs` and the dependency/function settings into the existing Vercel project. Preserve its privacy page and other routes. Do not replace the whole existing website with this directory without inspecting that project.

## Verification before releasing the updated iOS client

Run `npm test` locally. These tests mock upstream transport and quotas; they do not prove the live Vercel or Redis configuration works.

In a controlled deployed environment, verify that unsigned and forged requests never reach OpenAI, actual Apple-signed subscriptions are checked against current Apple status, and an exhausted daily quota returns HTTP 429. Use synthetic training input. Check revocation/refund, expiry and billing grace behavior. Quotas reserve before the upstream call, including failed or malformed responses. Redis reservations are atomic; keys contain HMAC identities and expire. App Attest challenges expire after five minutes; verified public-key/counter records expire one year after last use. Atomic comparison and challenge consumption reject replays, counter rollback and concurrent reuse. The assertion binds the exact original request bytes, HTTP method and path.

Update the public privacy page before release to explain Apple-signed proof sent to GKPro/Apple, exclusion of that proof from OpenAI, and HMAC quota/IP records with expiry. The current iOS consent and privacy screens describe this flow and require renewed consent version v3. Private device keys never leave the device.

## Remaining limits

- App Attest is implemented; real Apple attestation and provisioning still require a physical-device verification after deployment. Debug development attestation is accepted only when Sandbox verification is explicitly enabled and the subscription is Sandbox. There is no unsigned simulator bypass in production.
- Live deployment, credentials, durable Redis behavior and real Apple subscription responses remain unverified in this checkout.
- The local 25-credit counter is only a client-side reservation/display; it is not the security boundary.
- Update and verify the server before shipping the new client. Do not remove signature or quota checks to make the old proxy contract appear compatible.
