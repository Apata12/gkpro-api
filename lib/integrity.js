import {randomBytes,createHash,X509Certificate} from 'node:crypto';
import cbor from 'cbor';
import {verifyAttestation,verifyAssertion} from 'node-app-attest';
import {hashIdentity} from './quota.js';
import {BUNDLE_ID} from './policy.js';
import {redisConfig} from './redis-config.js';
const COMMIT_ATTEST="if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end if redis.call('EXISTS',KEYS[2]) == 1 then return 0 end redis.call('SET',KEYS[2],ARGV[2],'EX',31536000) redis.call('DEL',KEYS[1]) return 1";
const COMMIT_ASSERT="if redis.call('GET',KEYS[1]) ~= ARGV[1] or redis.call('GET',KEYS[2]) ~= ARGV[2] then return 0 end redis.call('SET',KEYS[2],ARGV[3],'EX',31536000) redis.call('DEL',KEYS[1]) return 1";
export function makeIntegrity(env=process.env,transport=fetch,crypto={verifyAttestation,verifyAssertion}) {
 const {url,token}=redisConfig(env);
 const {GKPRO_QUOTA_HMAC_SECRET:secret,GKPRO_APP_ATTEST_TEAM_ID:team}=env;
 if(!url?.startsWith('https://')||!token||!secret||secret.length<32||!team||!/^[A-Z0-9]{10}$/.test(team))throw Error('unconfigured');
 const hash=v=>hashIdentity(v,secret),ck=v=>'gkpro:challenge:'+hash(v),kk=v=>'gkpro:attest:'+hash(v);
 async function redis(command){const r=await transport(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('integrity_unavailable');const j=await r.json();if(j.error)throw Error('integrity_unavailable');return j.result;}
 function key(v){if(typeof v!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(v))throw Error('integrity_required');return v;}
 function challenge(v){if(typeof v!=='string'||!/^[0-9a-f]{64}$/.test(v))throw Error('integrity_required');return v;}
 function identity(account){return hash(account.environment+':'+account.id);}
 async function loadChallenge(value,purpose,keyID,account){const raw=await redis(['GET',ck(challenge(value))]);if(typeof raw!=='string')throw Error('integrity_required');const c=JSON.parse(raw);if(c.purpose!==purpose||c.keyID!==keyID||c.account!==identity(account))throw Error('integrity_required');return raw;}
 return {
  async issue({purpose,keyID},account){key(keyID);if(!['attest','assert'].includes(purpose))throw Error('integrity_required');if(purpose==='assert'){const previous=await redis(['GET',kk(keyID)]);if(typeof previous!=='string')throw Error('integrity_key_unknown');if(JSON.parse(previous).account!==identity(account))throw Error('integrity_key_unknown');}const value=randomBytes(32).toString('hex');const raw=JSON.stringify({purpose,keyID,account:identity(account)});if(await redis(['SET',ck(value),raw,'EX',300,'NX'])!=='OK')throw Error('integrity_unavailable');return value;},
  async register(body,account){const keyID=key(body.keyID),raw=await loadChallenge(body.challenge,'attest',keyID,account);if(typeof body.attestation!=='string'||body.attestation.length>24000)throw Error('integrity_required');const attestation=Buffer.from(body.attestation,'base64');
   // The library validates the pinned chain/nonce/RP ID/key/environment. Also enforce certificate validity dates.
   const decoded=cbor.decodeFirstSync(attestation);for(const der of decoded.attStmt?.x5c??[]){const cert=new X509Certificate(der);if(Date.now()<Date.parse(cert.validFrom)||Date.now()>Date.parse(cert.validTo))throw Error('integrity_required');}
   const result=crypto.verifyAttestation({attestation,challenge:body.challenge,keyId:keyID,bundleIdentifier:BUNDLE_ID,teamIdentifier:team,allowDevelopmentEnvironment:env.GKPRO_ALLOW_SANDBOX==='true'&&account.environment==='Sandbox'});
   const state=JSON.stringify({publicKey:result.publicKey,signCount:0,account:identity(account),environment:result.environment});if(await redis(['EVAL',COMMIT_ATTEST,'2',ck(body.challenge),kk(keyID),raw,state])!==1)throw Error('integrity_required');},
  async verify(envelope,account){const keyID=key(envelope.integrity?.keyID);if(typeof envelope.request!=='string'||envelope.request.length>64000||typeof envelope.integrity?.clientData!=='string'||envelope.integrity.clientData.length>4000||typeof envelope.integrity.assertion!=='string'||envelope.integrity.assertion.length>4000)throw Error('integrity_required');
   const bytes=Buffer.from(envelope.request,'base64'),dataBytes=Buffer.from(envelope.integrity.clientData,'base64'),client=JSON.parse(dataBytes.toString('utf8'));
   if(client.method!=='POST'||client.path!=='/api/chat'||client.bodySHA256!==createHash('sha256').update(bytes).digest('base64'))throw Error('integrity_required');
   const raw=await loadChallenge(client.challenge,'assert',keyID,account),previous=await redis(['GET',kk(keyID)]);if(typeof previous!=='string')throw Error('integrity_required');const state=JSON.parse(previous);if(state.account!==identity(account))throw Error('integrity_required');
   const result=crypto.verifyAssertion({assertion:Buffer.from(envelope.integrity.assertion,'base64'),payload:dataBytes,publicKey:state.publicKey,bundleIdentifier:BUNDLE_ID,teamIdentifier:team,signCount:state.signCount});
   if(!Number.isSafeInteger(result.signCount)||result.signCount<=state.signCount)throw Error('integrity_required');const next=JSON.stringify({...state,signCount:result.signCount});if(await redis(['EVAL',COMMIT_ASSERT,'2',ck(client.challenge),kk(keyID),raw,previous,next])!==1)throw Error('integrity_required');
  }
 };
}
