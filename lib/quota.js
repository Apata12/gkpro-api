import { createHmac } from "node:crypto";

export const DAILY_LIMIT = 25;
export const RESERVE_LUA = [
  "local count = tonumber(redis.call('GET', KEYS[1]) or '0')",
  "local limit = tonumber(ARGV[1])",
  "if count >= limit then return -1 end",
  "count = redis.call('INCR', KEYS[1])",
  "if count == 1 then redis.call('EXPIREAT', KEYS[1], ARGV[2]) end",
  "return limit - count"
].join("\n");

export function hashIdentity(value, secret) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("unconfigured");
  return createHmac("sha256",secret).update(value).digest("hex");
}
export function dailyBucket(now = Date.now()) {
  const date = new Date(now);
  const key = date.toISOString().slice(0,10);
  const expires = Math.floor(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()+1)/1000) + 3600;
  return {key,expires};
}
export function makeQuota(env = process.env, transport = fetch) {
  const url = env.GKPRO_REDIS_REST_URL;
  const token = env.GKPRO_REDIS_REST_TOKEN;
  const secret = env.GKPRO_QUOTA_HMAC_SECRET;
  if (!url || !token || !url.startsWith("https://") || !secret || secret.length < 32) throw new Error("unconfigured");
  async function reserve(key, limit, expires) {
    const response = await transport(url,{
      method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
      body:JSON.stringify(["EVAL",RESERVE_LUA,"1",key,String(limit),String(expires)]),
      signal:AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error("quota_unavailable");
    const json = await response.json();
    if (json.error || !Number.isInteger(json.result) || json.result < -1 || json.result >= limit) throw new Error("quota_unavailable");
    return json.result;
  }
  return {
    async reserveIP(ip, now = Date.now()) {
      const minute = Math.floor(now/60000);
      return reserve("gkpro:ip:"+hashIdentity(ip,secret)+":"+minute,60,Math.floor(now/1000)+120);
    },
    async reserveAccount(id, environment, now = Date.now()) {
      const day = dailyBucket(now);
      return reserve("gkpro:ai:"+environment+":"+hashIdentity(id,secret)+":"+day.key,DAILY_LIMIT,day.expires);
    }
  };
}
