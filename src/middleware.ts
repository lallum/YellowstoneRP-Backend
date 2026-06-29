import { Request, Response, NextFunction, RequestHandler } from 'express';

export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function nowMs() {
  return Date.now();
}

export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.YELLOWSTONERP_API_KEY;
  const got = req.header('x-yellowstonerp-key');
  const serverId = req.header('x-yellowstonerp-server-id');

  if (!expected || expected.length < 24 || expected.includes('change_this')) {
    return res.status(500).json({ error: 'Server API key not configured safely', code: 'unsafe_api_key' });
  }

  if (got !== expected) {
    return res.status(401).json({ error: 'Invalid API key', code: 'invalid_api_key' });
  }

  if (!serverId || serverId.length < 3) {
    return res.status(401).json({ error: 'Missing x-yellowstonerp-server-id header', code: 'missing_server_id' });
  }

  next();
}

export function rateLimit(windowMs: number, maxHits: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.header('x-yellowstonerp-key') ?? 'no-key';
    const serverId = req.header('x-yellowstonerp-server-id') ?? 'no-server';
    const key = `${serverId}:${apiKey.slice(-8)}:${req.method}:${req.path}`;
    const now = nowMs();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > maxHits) {
      return res.status(429).json({ error: 'Rate limit exceeded', code: 'rate_limited', retryAfterMs: bucket.resetAt - now });
    }

    next();
  };
}

export function asyncRoute(fn: (req: Request, res: Response, next: NextFunction) => Promise<any> | any): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = Number(err?.status ?? 400);
  const code = String(err?.code ?? 'bad_request');
  const message = String(err?.message ?? 'Bad request');

  if (status >= 500) console.error(err);
  else console.warn(`[YellowstoneRP] ${status} ${code}: ${message}`);

  res.status(status).json({ error: message, code });
}
