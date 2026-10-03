// Keep each URL/token pair together; an incomplete explicit configuration fails closed.
export function redisConfig(env = process.env) {
  const explicit = env.GKPRO_REDIS_REST_URL !== undefined || env.GKPRO_REDIS_REST_TOKEN !== undefined;
  const url = explicit ? env.GKPRO_REDIS_REST_URL : env.GKPRO_REDIS_KV_REST_API_URL;
  const token = explicit ? env.GKPRO_REDIS_REST_TOKEN : env.GKPRO_REDIS_KV_REST_API_TOKEN;
  if (typeof url !== "string" || !url.startsWith("https://") || typeof token !== "string" || !token) {
    throw new Error("unconfigured");
  }
  return {url, token};
}
