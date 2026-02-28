/**
 * In-memory rate limit: per IP and optional per account (maker).
 * For production with multiple instances use Redis.
 */
const windowMs = 60 * 1000; // 1 minute
const maxPerWindow = 200;   // requests per IP per minute
const perMakerLimit = 50;   // orders per maker per minute (for POST /orders)

const ipCounts = new Map();
const makerCounts = new Map();
let lastClean = Date.now();

function clean() {
  const now = Date.now();
  if (now - lastClean < 60000) return;
  lastClean = now;
  for (const [k, v] of ipCounts.entries()) {
    if (v.expiry < now) ipCounts.delete(k);
  }
  for (const [k, v] of makerCounts.entries()) {
    if (v.expiry < now) makerCounts.delete(k);
  }
}

function getIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}

/**
 * Rate limit by IP (all endpoints).
 */
export function rateLimitByIp(req, res, next) {
  clean();
  const ip = getIp(req);
  const now = Date.now();
  let entry = ipCounts.get(ip);
  if (!entry || entry.expiry < now) {
    entry = { count: 0, expiry: now + windowMs };
    ipCounts.set(ip, entry);
  }
  entry.count++;
  if (entry.count > maxPerWindow) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  next();
}

/**
 * Rate limit by maker (for POST /orders). Call after body is parsed.
 */
export function rateLimitByMaker(req, res, next) {
  const maker = req.body?.maker;
  if (!maker || typeof maker !== 'string') return next();
  clean();
  const key = maker.toLowerCase();
  const now = Date.now();
  let entry = makerCounts.get(key);
  if (!entry || entry.expiry < now) {
    entry = { count: 0, expiry: now + windowMs };
    makerCounts.set(key, entry);
  }
  entry.count++;
  if (entry.count > perMakerLimit) {
    return res.status(429).json({ error: 'Too many orders from this maker' });
  }
  next();
}
