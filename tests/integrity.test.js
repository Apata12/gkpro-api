import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyAttestation,verifyAssertion} from 'node-app-attest';
import {makeIntegrity} from '../lib/integrity.js';
import {makeHandler} from '../lib/handler.js';
const keyID=Buffer.alloc(32,7).toString('base64');
const account={id:'synthetic-account',environment:'Production'};
const env={GKPRO_REDIS_REST_URL:'https://redis.example.test',GKPRO_REDIS_REST_TOKEN:'test',GKPRO_QUOTA_HMAC_SECRET:'x'.repeat(32),GKPRO_APP_ATTEST_TEAM_ID:'ABCDEFGHIJ'};
function fixture(cryptography={verifyAttestation:()=>({publicKey:'fixture-public-key',environment:'production'}),verifyAssertion:({signCount})=>({signCount:signCount+1})}) {
 const db=new Map();
 const transport=async(_,options)=>{const c=JSON.parse(options.body);let result;
 if(c[0]==='GET')result=db.get(c[1])??null;
 else if(c[0]==='SET'){result=db.has(c[1])?null:'OK';if(result)db.set(c[1],c[2]);}
 else if(c[0]==='EVAL'){const [,script,,challenge,key,...args]=c;const registration=script.includes('EXISTS');
 const valid=db.get(challenge)===args[0]&&(registration?!db.has(key):db.get(key)===args[1]);result=valid?1:0;
 if(valid){db.set(key,args[registration?1:2]);db.delete(challenge);}}
 else throw Error('unexpected Redis command');return {ok:true,json:async()=>({result})};};
 const service=makeIntegrity(env,transport,cryptography);
 async function register(){const challenge=await service.issue({purpose:'attest',keyID},account);await service.register({keyID,challenge,attestation:Buffer.from('a16761747453746d74a16378356380','hex').toString('base64')},account);}
 async function envelope(){const challenge=await service.issue({purpose:'assert',keyID},account);const body=Buffer.from(JSON.stringify({task:'coach',question:'Footwork',signedTransaction:'synthetic.signed.transaction'}));return {request:body.toString('base64'),integrity:{keyID,assertion:Buffer.from('synthetic assertion').toString('base64'),clientData:Buffer.from(JSON.stringify({challenge,method:'POST',path:'/api/chat',bodySHA256:createHash('sha256').update(body).digest('base64')})).toString('base64')}};}
 return {service,register,envelope,db};
}
test('Unregistered or expired installation keys cannot receive assertion challenges',async()=>{const f=fixture();await assert.rejects(f.service.issue({purpose:'assert',keyID},account),/integrity_key_unknown/);});
test('App Attest requires server configuration',()=>assert.throws(()=>makeIntegrity({}),/unconfigured/));
test('A registered key consumes its challenge exactly once under concurrent replay',async()=>{const f=fixture();await f.register();const envelope=await f.envelope();const outcomes=await Promise.allSettled([f.service.verify(envelope,account),f.service.verify(envelope,account)]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);await assert.rejects(f.service.verify(envelope,account));});
test('Changing the protected request body invalidates its assertion',async()=>{const f=fixture();await f.register();const envelope=await f.envelope();envelope.request=Buffer.from('changed').toString('base64');await assert.rejects(f.service.verify(envelope,account),/integrity_required/);});
test('A challenge/key cannot be moved to another subscription account',async()=>{const f=fixture();await f.register();await assert.rejects(f.service.verify(await f.envelope(),{...account,id:'another-account'}),/integrity_required/);});
test('Expired/missing challenges and nonincreasing counters fail closed',async()=>{const f=fixture({verifyAttestation:()=>({publicKey:'fixture',environment:'production'}),verifyAssertion:({signCount})=>({signCount})});await f.register();await assert.rejects(f.service.verify(await f.envelope(),account),/integrity_required/);const e=await f.envelope();for(const k of f.db.keys())if(k.startsWith('gkpro:challenge:'))f.db.delete(k);await assert.rejects(f.service.verify(e,account),/integrity_required/);});
test('Real cryptography rejects synthetic attestation instead of registering its key',async()=>{const f=fixture({verifyAttestation,verifyAssertion});await assert.rejects(f.register());assert.equal([...f.db.keys()].filter(k=>k.startsWith('gkpro:attest:')).length,0);});
test('Missing or rejected device proof never spends account quota or calls OpenAI',async()=>{for(const integrity of [undefined,async()=>{throw Error('forged')}]){let calls=0;const handler=makeHandler({apiKey:'synthetic',verify:async()=>account,quota:{reserveIP:async()=>1,reserveAccount:async()=>{calls++;return 24}},integrity,transport:async()=>{calls++;throw Error('unexpected')}});const res={statusCode:0,setHeader(){},status(v){this.statusCode=v;return this},json(v){this.body=v}};await handler({method:'POST',headers:{'content-type':'application/json'},body:{task:'coach',question:'Footwork',signedTransaction:'synthetic.signed.transaction'}},res);assert.equal(calls,0);assert.equal(res.statusCode,integrity?403:503);}});
