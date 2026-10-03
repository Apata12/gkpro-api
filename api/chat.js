import { makeHandler } from "../lib/handler.js";
import { makeVerifier } from "../lib/verify.js";
import { makeQuota } from "../lib/quota.js";

import { makeIntegrity } from "../lib/integrity.js";

let handler;
export default async function chat(req,res) {
  if (!handler) {
    try {
      handler=makeHandler({verify:makeVerifier(),quota:makeQuota(),integrity:makeIntegrity().verify,apiKey:process.env.OPENAI_API_KEY});
    } catch {
      res.setHeader("Cache-Control","no-store");
      return res.status(503).json({error:{code:"service_unavailable"}});
    }
  }
  return handler(req,res);
}
