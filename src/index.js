import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { z } from 'zod';
import { dbHealth, one, many, tx } from './db.js';
import { requireApiKey, rateLimit, asyncRoute, errorHandler, HttpError } from './middleware.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT ?? 3100);
const SERVER_ID = process.env.YELLOWSTONERP_SERVER_ID ?? 'yellowstone-rp-main';

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: false }));
app.use(express.json({ limit: '1mb' }));

const uuid = z.string().uuid();
const characterNameSchema = z.object({
  platformId: z.string().min(1).max(128),
  firstName: z.string().trim().min(2).max(32).regex(/^[a-zA-Z][a-zA-Z'-]*$/),
  lastName: z.string().trim().min(2).max(32).regex(/^[a-zA-Z][a-zA-Z'-]*$/),
  age: z.number().int().min(16).max(100),
  model: z.enum(['male', 'female']).default('male')
});

function cents(value) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

async function tableExists(tableName) {
  const row = await one(
    `select exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = $1
    ) as exists`,
    [tableName]
  );
  return Boolean(row?.exists);
}

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'YellowstoneRP Backend', version: 'railway-fixed-v1', health: '/health' });
});

// Railway healthcheck. This intentionally returns 200 if the web server is alive.
// Use /health/db to verify Supabase/PostgreSQL separately.
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'YellowstoneRP Backend', serverId: SERVER_ID, time: new Date().toISOString() });
});

app.get('/health/db', asyncRoute(async (_req, res) => {
  const db = await dbHealth();
  res.status(db.ok ? 200 : 503).json({ ok: db.ok, database: db });
}));

app.get('/v1/status', asyncRoute(async (_req, res) => {
  const db = await dbHealth();
  res.json({ ok: true, service: 'YellowstoneRP Backend', database: db.ok ? 'connected' : 'not_connected', time: new Date().toISOString() });
}));

app.post('/v1/characters/register', rateLimit(60_000, 10), requireApiKey, asyncRoute(async (req, res) => {
  const body = characterNameSchema.parse(req.body);
  const firstName = body.firstName.trim();
  const lastName = body.lastName.trim();
  const fullName = `${firstName} ${lastName}`;

  if (!(await tableExists('characters'))) {
    throw new HttpError(500, 'characters table is missing. Run the Supabase schema SQL first.', 'missing_characters_table');
  }

  const result = await tx(async (client) => {
    const duplicate = await client.query(
      `select id from characters where lower(first_name)=lower($1) and lower(last_name)=lower($2) limit 1`,
      [firstName, lastName]
    );
    if (duplicate.rows[0]) {
      throw new HttpError(409, 'This name is already taken, please try again.', 'character_name_taken');
    }

    // This insert supports the schema generated for the YellowstoneRP package.
    // If your table has extra nullable columns, PostgreSQL will use defaults.
    const characterId = crypto.randomUUID();
    const insert = await client.query(
      `insert into characters(id, platform_id, first_name, last_name, full_name, age, model, bank_balance_cents, cash_cents, created_at, updated_at)
       values($1,$2,$3,$4,$5,$6,$7,1000000,0,now(),now())
       returning *`,
      [characterId, body.platformId, firstName, lastName, fullName, body.age, body.model]
    );
    return insert.rows[0];
  });

  res.status(201).json({ ok: true, character: result, message: 'Welcome to Yellowstone' });
}));

app.get('/v1/characters/by-platform/:platformId', requireApiKey, asyncRoute(async (req, res) => {
  if (!(await tableExists('characters'))) {
    throw new HttpError(500, 'characters table is missing. Run the Supabase schema SQL first.', 'missing_characters_table');
  }
  const rows = await many('select * from characters where platform_id=$1 order by created_at asc', [req.params.platformId]);
  res.json({ ok: true, characters: rows });
}));

app.post('/v1/money/transfer', rateLimit(60_000, 20), requireApiKey, asyncRoute(async (req, res) => {
  const body = z.object({ fromCharacterId: uuid, toCharacterId: uuid, amountCents: z.number().int().positive().max(100_000_000) }).parse(req.body);
  if (body.fromCharacterId === body.toCharacterId) throw new HttpError(400, 'Cannot transfer to the same character', 'same_character');

  const result = await tx(async (client) => {
    const from = await client.query('select id, bank_balance_cents from characters where id=$1 for update', [body.fromCharacterId]);
    const to = await client.query('select id from characters where id=$1 for update', [body.toCharacterId]);
    if (!from.rows[0] || !to.rows[0]) throw new HttpError(404, 'Character not found', 'character_not_found');
    if (cents(from.rows[0].bank_balance_cents) < body.amountCents) throw new HttpError(400, 'Insufficient bank balance', 'insufficient_funds');
    await client.query('update characters set bank_balance_cents=bank_balance_cents-$1, updated_at=now() where id=$2', [body.amountCents, body.fromCharacterId]);
    await client.query('update characters set bank_balance_cents=bank_balance_cents+$1, updated_at=now() where id=$2', [body.amountCents, body.toCharacterId]);
    return { amountCents: body.amountCents };
  });

  res.json({ ok: true, transfer: result });
}));

app.post('/v1/discord/court-date', requireApiKey, asyncRoute(async (req, res) => {
  const webhook = process.env.COURT_DISCORD_WEBHOOK_URL;
  if (!webhook) return res.json({ ok: true, skipped: true, reason: 'COURT_DISCORD_WEBHOOK_URL is not set' });
  const body = z.object({ playerName: z.string().min(1), courtDateTime: z.string().min(1), reason: z.string().min(1).max(500) }).parse(req.body);
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: `📅 **Yellowstone RP Court Date**\nPlayer: ${body.playerName}\nDate/Time: ${body.courtDateTime}\nReason: ${body.reason}` })
  });
  res.json({ ok: response.ok, discordStatus: response.status });
}));

app.post('/v1/discord/jail-log', requireApiKey, asyncRoute(async (req, res) => {
  const webhook = process.env.JAIL_DISCORD_WEBHOOK_URL;
  if (!webhook) return res.json({ ok: true, skipped: true, reason: 'JAIL_DISCORD_WEBHOOK_URL is not set' });
  const body = z.object({ playerName: z.string().min(1), timeMinutes: z.number().int().min(1).max(10080), reason: z.string().min(1).max(500) }).parse(req.body);
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: `🚔 **Yellowstone RP Jail Log**\nPlayer: ${body.playerName}\nTime: ${body.timeMinutes} minutes\nReason: ${body.reason}` })
  });
  res.json({ ok: response.ok, discordStatus: response.status });
}));

app.use((req, res) => {
  res.status(404).json({ ok: false, error: `Route not found: ${req.method} ${req.path}`, code: 'not_found' });
});

app.use(errorHandler);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[YellowstoneRP] Backend listening on 0.0.0.0:${PORT}`);
});
