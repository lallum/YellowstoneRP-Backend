export class HttpError extends Error {
  constructor(status, message, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const buckets = new Map();

function expectedApiKey() {
  return process.env.STONEPINERP_API_KEY ?? process.env.YELLOWSTONERP_API_KEY;
}

function providedApiKey(req) {
  return req.header('x-stonepinerp-key')
    ?? req.header('x-yellowstonerp-key')
    ?? req.body?.apiKey;
}

function providedServerId(req) {
  return req.header('x-stonepinerp-server-id')
    ?? req.header('x-yellowstonerp-server-id')
    ?? req.body?.serverId;
}

export function requireApiKey(req, res, next) {
  const expected = expectedApiKey();
  const provided = providedApiKey(req);
  const serverId = providedServerId(req);

  if (!expected || expected.length < 24 || expected.includes('change_this') || expected.includes('REPLACE_ME')) {
    return res.status(500).json({
      ok: false,
      error: 'STONEPINERP_API_KEY or YELLOWSTONERP_API_KEY is not configured safely',
      code: 'unsafe_api_key'
    });
  }

  if (provided !== expected) {
    return res.status(401).json({ ok: false, error: 'Invalid API key', code: 'invalid_api_key' });
  }

  if (!serverId || String(serverId).length < 3) {
    return res.status(401).json({ ok: false, error: 'Missing StonePine server ID', code: 'missing_server_id' });
  }

  req.stonePineServerId = String(serverId);
  next();
}

export function rateLimit(windowMs, maxHits) {
  return (req, res, next) => {
    const serverId = providedServerId(req) ?? 'public';
    const identity = `${serverId}:${req.ip}:${req.method}:${req.path}`;
    const now = Date.now();
    const existing = buckets.get(identity);

    if (!existing || existing.resetAt <= now) {
      buckets.set(identity, { count: 1, resetAt: now + windowMs });
      return next();
    }

    existing.count += 1;
    if (existing.count > maxHits) {
      return res.status(429).json({
        ok: false,
        error: 'Rate limit exceeded',
        code: 'rate_limited',
        retryAfterMs: existing.resetAt - now
      });
    }

    next();
  };
}

export function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function errorHandler(err, _req, res, _next) {
  const isValidationError = err?.name === 'ZodError';
  const status = Number(err?.status ?? (isValidationError ? 400 : 500));
  const code = String(err?.code ?? (isValidationError ? 'validation_error' : 'internal_error'));
  const message = isValidationError
    ? err.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ')
    : String(err?.message ?? 'Internal server error');

  if (status >= 500) console.error('[StonePineRP]', err);
  else console.warn(`[StonePineRP] ${status} ${code}: ${message}`);

  res.status(status).json({ ok: false, error: message, code });
}
