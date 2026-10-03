import {diagnosticFailure} from '../lib/diagnostics.js';
import {makeVerifier} from '../lib/verify.js';
import {makeQuota} from '../lib/quota.js';
import {makeIntegrity} from '../lib/integrity.js';
let dependencies;
export default async function handler(req,res){res.setHeader('Cache-Control','no-store');const fail=(status,code)=>res.status(status).json({error:{code}});if(req.method!=='POST'){res.setHeader('Allow','POST');return fail(405,'method_not_allowed');}
 if(!String(req.headers?.['content-type']??'').startsWith('application/json'))return fail(415,'invalid_input');
 if(Number(req.headers?.['content-length']??0)>48000)return fail(413,'invalid_input');
 try{dependencies??={verify:makeVerifier(),quota:makeQuota(),integrity:makeIntegrity()};}catch(error){diagnosticFailure('configuration',error);return fail(503,'service_unavailable');}
 let stage='quota_ip';
 try{const body=typeof req.body==='string'?JSON.parse(req.body):req.body;if(!body||JSON.stringify(body).length>48000||typeof body.signedTransaction!=='string'||body.signedTransaction.length<20||body.signedTransaction.length>20000)return fail(400,'invalid_input');
 const ip=String(req.headers?.['x-forwarded-for']??req.socket?.remoteAddress??'unknown').split(',')[0].trim();if(await dependencies.quota.reserveIP(ip)<0)return fail(429,'rate_limited');stage='subscription';const account=await dependencies.verify(body.signedTransaction);
 if(body.operation==='challenge'){stage='challenge';return res.status(200).json({challenge:await dependencies.integrity.issue(body,account)});}
 if(body.operation==='attest'){stage='attest';await dependencies.integrity.register(body,account);return res.status(200).json({verified:true});}return fail(400,'invalid_input');
 }catch(error){diagnosticFailure(stage,error);const known=['integrity_required','integrity_key_unknown','subscription_required'].includes(error.message);return fail(known?403:503,known?error.message:'verification_failed');}
}
