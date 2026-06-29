export class HttpError extends Error {
  constructor(status, message, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const buckets = new Map();

export function requireApiKey(req, res, next) {
  const expected = process.env.YELLOWSTONERP_API_KEY;
  const provided = req.header('x-yellowstonerp-key');
  const serverId = req.header('x-yellowstonerp-server-id');

  if (!expected || expected.length < 16 || expected.includes('change_this')) {
    return res.status(500).json({ ok: false, error: 'YELLOWSTONERP_API_KEY is not configured safely', code: 'unsafe_api_key' });
  }

  if (provided !== expected) {
    return res.status(401).json({ ok: false, error: 'Invalid API key', code: 'invalid_api_key' });
  }

  if (!serverId || serverId.length < 3) {
    return res.status(401).json({ ok: false, error: 'Missing x-yellowstonerp-server-id header', code: 'missing_server_id' });
  }

  next();
}

export function rateLimit(windowMs, maxHits) {
  return (req, res, next) => {
    const identity = `${req.header('x-yellowstonerp-server-id') ?? 'public'}:${req.ip}:${req.method}:${req.path}`;
    const now = Date.now();
    const existing = buckets.get(identity);

    if (!existing || existing.resetAt <= now) {
      buckets.set(identity, { count: 1, resetAt: now + windowMs });
      return next();
    }

    existing.count += 1;
    if (existing.count > maxHits) {
      return res.status(429).json({ ok: false, error: 'Rate limit exceeded', code: 'rate_limited', retryAfterMs: existing.resetAt - now });
    }

    next();
  };
}

export function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function errorHandler(err, _req, res, _next) {
  const status = Number(err?.status ?? 500);
  const code = String(err?.code ?? 'internal_error');
  const message = String(err?.message ?? 'Internal server error');

  if (status >= 500) console.error('[YellowstoneRP]', err);
  else console.warn(`[YellowstoneRP] ${status} ${code}: ${message}`);

  res.status(status).json({ ok: false, error: message, code });
}
