import { validateInput, MODEL } from "./policy.js";

export function makeHandler({verify,quota,integrity,apiKey,transport=fetch,now=Date.now}) {
  return async function handler(req,res) {
    res.setHeader("Cache-Control","no-store");
    res.setHeader("X-Content-Type-Options","nosniff");
    function fail(status,code) { return res.status(status).json({error:{code}}); }
    if (req.method !== "POST") { res.setHeader("Allow","POST"); return fail(405,"method_not_allowed"); }
    if (!apiKey || !verify || !quota) return fail(503,"service_unavailable");
    if (!String(req.headers?.["content-type"] ?? "").startsWith("application/json")) return fail(415,"invalid_input");
    if (Number(req.headers?.["content-length"] ?? 0) > 96000) return fail(413,"invalid_input");
    let body, envelope;
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (JSON.stringify(body).length > 96000) return fail(413,"invalid_input");
    } catch { return fail(400,"invalid_input"); }
    try {
      if (body?.integrity) { envelope=body; body=JSON.parse(Buffer.from(body.request,"base64").toString("utf8")); }
    } catch { return fail(400,"invalid_input"); }
    let input;
    try { input=validateInput(body); }
    catch (error) { return fail(error.message==="subscription_required"?401:400,error.message==="subscription_required"?"subscription_required":"invalid_input"); }
    // Vercel overwrites x-forwarded-for at the trusted edge. No caller-provided identity is used for account quota.
    const ip = String(req.headers?.["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "unknown").split(",")[0].trim();
    let account;
    try {
      if (await quota.reserveIP(ip,now()) < 0) return fail(429,"rate_limited");
      account=await verify(input.signed,now());
    } catch (error) { return fail(error.message==="subscription_required"?403:503,error.message==="subscription_required"?"subscription_required":"service_unavailable"); }
    try {
      if (!integrity) return fail(503,"service_unavailable");
      await integrity(envelope,account);
    } catch { return fail(403,"integrity_required"); }
    let remaining;
    try { remaining=await quota.reserveAccount(account.id,account.environment,now()); }
    catch { return fail(503,"service_unavailable"); }
    res.setHeader("X-GKPro-Credits-Remaining",String(Math.max(0,remaining)));
    if (remaining < 0) return fail(429,"quota_exceeded");
    // Reserve before upstream dispatch, including malformed AI answers and retries.
    // No body, question, JWS, key or raw provider error is logged.
    try {
      const response=await transport("https://api.openai.com/v1/chat/completions",{
        method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+apiKey},
        body:JSON.stringify({model:MODEL,messages:input.messages,max_tokens:input.maxTokens,temperature:0.5,store:false,
          ...(input.task==="workout"?{response_format:{type:"json_object"}}:{})}),
        signal:AbortSignal.timeout(30000)
      });
      if (!response.ok) return fail(502,"upstream_unavailable");
      const data=await response.json();
      const choice=data.choices?.[0],content=choice?.message?.content;
      if (choice?.finish_reason!=="stop" || typeof content!=="string" || !content.trim() || content.length>20000) return fail(502,"invalid_response");
      return res.status(200).json({choices:[{finish_reason:"stop",message:{role:"assistant",content:content.trim()}}]});
    } catch { return fail(502,"upstream_unavailable"); }
  };
}
