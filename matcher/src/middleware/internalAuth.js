/**
 * Protect internal endpoints (apply-fill, invalidate-nonce) with shared secret or API key.
 * Set MATCHER_INTERNAL_SECRET or MATCHER_API_KEY in env; optional - if unset, internal routes are open (dev only).
 */
export function internalAuth(req, res, next) {
  const secret = process.env.MATCHER_INTERNAL_SECRET || process.env.MATCHER_API_KEY;
  if (!secret) {
    return next(); // no secret configured: allow (dev mode)
  }
  const header = req.headers['x-internal-secret'] || req.headers['authorization'];
  const token = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice(7)
    : header;
  if (token !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
