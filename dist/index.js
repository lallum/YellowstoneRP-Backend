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
const SERVER_ID = process.env.STONEPINERP_SERVER_ID
  ?? process.env.YELLOWSTONERP_SERVER_ID
  ?? 'stonepine-rp-glenwood-main';
const SERVICE_VERSION = '2.0.0-stonepine-integration';

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: false }));
app.use(express.json({ limit: '1mb' }));

const uuid = z.string().uuid();
const platformUid = z.string().trim().min(1).max(160);
const personName = z.string().trim().min(2).max(32).regex(/^[a-zA-Z][a-zA-Z' -]*$/, 'Use letters, spaces, apostrophes or hyphens only');
const jobKey = z.string().trim().min(2).max(64).regex(/^[a-z0-9_]+$/);
const stationKey = z.string().trim().min(2).max(96).regex(/^[A-Za-z0-9_:-]+$/);

const characterCreateSchema = z.object({
  platformUid: platformUid.optional(),
  platformId: platformUid.optional(), // legacy alias
  displayName: z.string().trim().min(1).max(96).default('StonePine Resident'),
  firstName: personName,
  lastName: personName,
  dateOfBirth: z.string().trim().min(8).max(10),
  gender: z.string().trim().min(1).max(16),
  modelKey: z.string().trim().min(1).max(64).optional(),
  biography: z.string().trim().max(1000).default(''),
  age: z.number().int().min(16).max(100).optional()
});

function normalisePlatformUid(body) {
  return body.platformUid ?? body.platformId ?? '';
}

function normaliseGender(value) {
  const normalised = String(value ?? '').trim().toLowerCase();
  if (['m', 'man', 'male'].includes(normalised)) return 'male';
  if (['f', 'woman', 'female'].includes(normalised)) return 'female';
  throw new HttpError(400, 'Gender must be male or female', 'invalid_gender');
}

function parseDateOfBirth(value) {
  const text = String(value ?? '').trim();
  let year;
  let month;
  let day;

  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = text.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
    if (!match) throw new HttpError(400, 'Date of birth must use DD/MM/YYYY or YYYY-MM-DD', 'invalid_date_of_birth');
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new HttpError(400, 'Date of birth is not a valid calendar date', 'invalid_date_of_birth');
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function calculateAge(dateOfBirth) {
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

function cents(value) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

async function tableExists(tableName, client = null) {
  const sql = `select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = $1
  ) as exists`;
  if (client) {
    const result = await client.query(sql, [tableName]);
    return Boolean(result.rows[0]?.exists);
  }
  const row = await one(sql, [tableName]);
  return Boolean(row?.exists);
}

async function columnExists(tableName, columnName, client = null) {
  const sql = `select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name=$1 and column_name=$2
  ) as exists`;
  if (client) {
    const result = await client.query(sql, [tableName, columnName]);
    return Boolean(result.rows[0]?.exists);
  }
  const row = await one(sql, [tableName, columnName]);
  return Boolean(row?.exists);
}

async function assertCoreSchema() {
  for (const table of ['players', 'characters', 'job_definitions', 'job_sessions', 'online_players']) {
    if (!(await tableExists(table))) {
      throw new HttpError(500, `${table} table is missing. Run the YellowstoneRP base schema and StonePine migration.`, `missing_${table}_table`);
    }
  }
}

function characterCode() {
  return `SP-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function formatDateOnly(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value);
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return isoMatch ? isoMatch[1] : text.slice(0, 10);
}

function publicCharacter(row) {
  if (!row) return null;
  return {
    id: row.id,
    playerId: row.player_id,
    characterCode: row.character_code,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: `${row.first_name} ${row.last_name}`,
    dateOfBirth: row.date_of_birth,
    age: row.age,
    gender: row.gender,
    modelKey: row.model_key,
    biography: row.biography ?? '',
    jobKey: row.job_key,
    whitelistRole: row.whitelist_role,
    cashCents: cents(row.cash_cents),
    bankCents: cents(row.bank_cents),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function upsertPlayer(client, uid, displayName) {
  const result = await client.query(
    `insert into players(platform_uid, display_name, first_seen, last_seen)
     values($1,$2,now(),now())
     on conflict(platform_uid) do update
       set display_name=excluded.display_name, last_seen=now()
     returning *`,
    [uid, displayName]
  );
  if (result.rows[0]?.is_banned) throw new HttpError(403, 'This player is banned', 'player_banned');
  return result.rows[0];
}

async function resolveCharacter(client, body, { lock = false } = {}) {
  const suffix = lock ? ' for update' : '';
  if (body.characterId) {
    const result = await client.query(`select * from characters where id=$1${suffix}`, [body.characterId]);
    if (!result.rows[0]) throw new HttpError(404, 'Character not found', 'character_not_found');
    return result.rows[0];
  }

  const uid = normalisePlatformUid(body);
  if (!uid) throw new HttpError(400, 'characterId or platformUid is required', 'missing_character_identity');
  const result = await client.query(
    `select c.*
     from characters c
     join players p on p.id=c.player_id
     where p.platform_uid=$1
     order by c.updated_at desc, c.created_at desc
     limit 1${suffix}`,
    [uid]
  );
  if (!result.rows[0]) throw new HttpError(404, 'Character not found', 'character_not_found');
  return result.rows[0];
}

async function hasActiveRole(client, characterId, roleKey) {
  if (!(await tableExists('role_assignments', client))) return false;
  const result = await client.query(
    `select 1 from role_assignments
     where character_id=$1 and role_key=$2 and active=true
     limit 1`,
    [characterId, roleKey]
  );
  return Boolean(result.rows[0]);
}

function isWhitelistedRole(key) {
  return ['police', 'fire', 'ems', 'prison', 'admin', 'gm'].includes(key);
}

async function upsertOnlinePlayer(client, {
  platformUid: uid,
  character,
  displayName,
  job,
  isOnDuty
}) {
  const roleOnDuty = isWhitelistedRole(job) ? job : 'civilian';
  const hasCurrentJobColumn = await columnExists('online_players', 'current_job_key', client);
  if (hasCurrentJobColumn) {
    await client.query(
      `insert into online_players(server_id, platform_uid, character_id, display_name, role_on_duty, is_on_duty, online, last_seen, current_job_key)
       values($1,$2,$3,$4,$5,$6,true,now(),$7)
       on conflict(server_id,platform_uid) do update set
         character_id=excluded.character_id,
         display_name=excluded.display_name,
         role_on_duty=excluded.role_on_duty,
         is_on_duty=excluded.is_on_duty,
         online=true,
         last_seen=now(),
         current_job_key=excluded.current_job_key`,
      [SERVER_ID, uid, character.id, displayName, roleOnDuty, isOnDuty, job]
    );
  } else {
    await client.query(
      `insert into online_players(server_id, platform_uid, character_id, display_name, role_on_duty, is_on_duty, online, last_seen)
       values($1,$2,$3,$4,$5,$6,true,now())
       on conflict(server_id,platform_uid) do update set
         character_id=excluded.character_id,
         display_name=excluded.display_name,
         role_on_duty=excluded.role_on_duty,
         is_on_duty=excluded.is_on_duty,
         online=true,
         last_seen=now()`,
      [SERVER_ID, uid, character.id, displayName, roleOnDuty, isOnDuty]
    );
  }
}

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'StonePineRP Backend',
    legacyProject: 'YellowstoneRP',
    version: SERVICE_VERSION,
    health: '/health',
    api: '/v2'
  });
});

// Railway's web-process healthcheck stays independent of database availability.
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'StonePineRP Backend', serverId: SERVER_ID, version: SERVICE_VERSION, time: new Date().toISOString() });
});

app.get('/health/db', asyncRoute(async (_req, res) => {
  const db = await dbHealth();
  res.status(db.ok ? 200 : 503).json({ ok: db.ok, database: db });
}));

app.get(['/v1/status', '/v2/status'], asyncRoute(async (_req, res) => {
  const db = await dbHealth();
  res.json({
    ok: true,
    service: 'StonePineRP Backend',
    legacyProject: 'YellowstoneRP',
    version: SERVICE_VERSION,
    serverId: SERVER_ID,
    database: db.ok ? 'connected' : 'not_connected',
    time: new Date().toISOString()
  });
}));

app.post(['/v1/characters/register', '/v2/characters/register'], rateLimit(60_000, 12), requireApiKey, asyncRoute(async (req, res) => {
  await assertCoreSchema();
  const body = characterCreateSchema.parse(req.body);
  const uid = normalisePlatformUid(body);
  if (!uid) throw new HttpError(400, 'platformUid is required', 'missing_platform_uid');

  const firstName = body.firstName.trim();
  const lastName = body.lastName.trim();
  const dateOfBirth = parseDateOfBirth(body.dateOfBirth);
  const age = body.age ?? calculateAge(dateOfBirth);
  if (age < 16 || age > 100) throw new HttpError(400, 'Character age must be between 16 and 100', 'invalid_age');
  const gender = normaliseGender(body.gender);

  const result = await tx(async (client) => {
    const player = await upsertPlayer(client, uid, body.displayName);
    const duplicate = await client.query(
      `select * from characters
       where player_id=$1 and lower(first_name)=lower($2) and lower(last_name)=lower($3)
         and date_of_birth=$4::date
       limit 1`,
      [player.id, firstName, lastName, dateOfBirth]
    );
    if (duplicate.rows[0]) {
      return { created: false, character: duplicate.rows[0] };
    }

    const hasBiography = await columnExists('characters', 'biography', client);
    let inserted;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const code = characterCode();
        const query = hasBiography
          ? `insert into characters(player_id, character_code, first_name, last_name, date_of_birth, age, gender, model_key, biography, created_at, updated_at)
             values($1,$2,$3,$4,$5::date,$6,$7,$8,$9,now(),now()) returning *`
          : `insert into characters(player_id, character_code, first_name, last_name, date_of_birth, age, gender, model_key, created_at, updated_at)
             values($1,$2,$3,$4,$5::date,$6,$7,$8,now(),now()) returning *`;
        const params = hasBiography
          ? [player.id, code, firstName, lastName, dateOfBirth, age, gender, body.modelKey ?? gender, body.biography]
          : [player.id, code, firstName, lastName, dateOfBirth, age, gender, body.modelKey ?? gender];
        inserted = await client.query(query, params);
        break;
      } catch (error) {
        if (error?.code !== '23505' || attempt === 4) throw error;
      }
    }

    const character = inserted.rows[0];
    await upsertOnlinePlayer(client, {
      platformUid: uid,
      character,
      displayName: body.displayName,
      job: character.job_key,
      isOnDuty: false
    });
    return { created: true, character };
  });

  res.status(result.created ? 201 : 200).json({
    ok: true,
    created: result.created,
    character: publicCharacter(result.character),
    message: result.created ? 'Welcome to StonePineRP Glenwood' : 'Existing StonePine character loaded'
  });
}));

app.post('/v2/game/character-bootstrap', rateLimit(60_000, 30), requireApiKey, asyncRoute(async (req, res) => {
  await assertCoreSchema();
  const body = z.object({
    platformUid: platformUid.optional(),
    platformId: platformUid.optional(),
    displayName: z.string().trim().min(1).max(128).default('StonePine Resident')
  }).parse(req.body);
  const uid = normalisePlatformUid(body);
  if (!uid) throw new HttpError(400, 'platformUid is required', 'missing_platform_uid');

  const result = await tx(async (client) => {
    await upsertPlayer(client, uid, body.displayName);
    const characterResult = await client.query(
      `select c.* from characters c
       join players p on p.id=c.player_id
       where p.platform_uid=$1
       order by c.updated_at desc, c.created_at desc limit 1`,
      [uid]
    );
    const character = characterResult.rows[0] ?? null;
    if (character) {
      await upsertOnlinePlayer(client, {
        platformUid: uid,
        character,
        displayName: body.displayName,
        job: character.job_key,
        isOnDuty: false
      });
    }
    return character;
  });

  if (!result) {
    return res.json({
      ok: true,
      found: false,
      backendAvailable: true,
      characterCode: '',
      firstName: '',
      lastName: '',
      dateOfBirth: '',
      gender: '',
      biography: '',
      jobKey: 'unemployed',
      whitelistRole: ''
    });
  }

  const character = publicCharacter(result);
  res.json({
    ok: true,
    found: true,
    backendAvailable: true,
    characterCode: character.characterCode ?? '',
    firstName: character.firstName ?? '',
    lastName: character.lastName ?? '',
    dateOfBirth: formatDateOnly(character.dateOfBirth),
    gender: character.gender ?? '',
    biography: character.biography ?? '',
    jobKey: character.jobKey ?? 'unemployed',
    whitelistRole: character.whitelistRole ?? ''
  });
}));

app.post('/v2/characters/get-or-create', rateLimit(60_000, 20), requireApiKey, asyncRoute(async (req, res) => {
  await assertCoreSchema();
  const uid = normalisePlatformUid(req.body);
  if (!uid) throw new HttpError(400, 'platformUid is required', 'missing_platform_uid');

  const existing = await one(
    `select c.* from characters c
     join players p on p.id=c.player_id
     where p.platform_uid=$1
     order by c.updated_at desc, c.created_at desc limit 1`,
    [uid]
  );
  if (existing) return res.json({ ok: true, created: false, character: publicCharacter(existing) });

  throw new HttpError(404, 'No character exists. Submit the character creation form to /v2/characters/register.', 'character_creation_required');
}));

app.get(['/v1/characters/by-platform/:platformUid', '/v2/characters/by-platform/:platformUid'], requireApiKey, asyncRoute(async (req, res) => {
  await assertCoreSchema();
  const rows = await many(
    `select c.* from characters c
     join players p on p.id=c.player_id
     where p.platform_uid=$1
     order by c.created_at asc`,
    [req.params.platformUid]
  );
  res.json({ ok: true, characters: rows.map(publicCharacter) });
}));

app.get('/v2/characters/:characterId', requireApiKey, asyncRoute(async (req, res) => {
  const id = uuid.parse(req.params.characterId);
  const row = await one('select * from characters where id=$1', [id]);
  if (!row) throw new HttpError(404, 'Character not found', 'character_not_found');
  res.json({ ok: true, character: publicCharacter(row) });
}));

app.post('/v2/characters/update-profile', rateLimit(60_000, 15), requireApiKey, asyncRoute(async (req, res) => {
  const body = z.object({
    characterId: uuid.optional(),
    platformUid: platformUid.optional(),
    platformId: platformUid.optional(),
    dateOfBirth: z.string().trim().min(8).max(10),
    gender: z.string().trim().min(1).max(16),
    modelKey: z.string().trim().min(1).max(64).optional(),
    biography: z.string().trim().max(1000).default('')
  }).parse(req.body);

  const dateOfBirth = parseDateOfBirth(body.dateOfBirth);
  const age = calculateAge(dateOfBirth);
  if (age < 16 || age > 100) throw new HttpError(400, 'Character age must be between 16 and 100', 'invalid_age');
  const gender = normaliseGender(body.gender);

  const character = await tx(async (client) => {
    const existing = await resolveCharacter(client, body, { lock: true });
    const hasBiography = await columnExists('characters', 'biography', client);
    const updated = hasBiography
      ? await client.query(
        `update characters set date_of_birth=$1::date, age=$2, gender=$3, model_key=$4, biography=$5, updated_at=now()
         where id=$6 returning *`,
        [dateOfBirth, age, gender, body.modelKey ?? gender, body.biography, existing.id]
      )
      : await client.query(
        `update characters set date_of_birth=$1::date, age=$2, gender=$3, model_key=$4, updated_at=now()
         where id=$5 returning *`,
        [dateOfBirth, age, gender, body.modelKey ?? gender, existing.id]
      );
    return updated.rows[0];
  });

  res.json({ ok: true, character: publicCharacter(character) });
}));

app.post('/v2/characters/name-change/request', rateLimit(60_000, 5), requireApiKey, asyncRoute(async (req, res) => {
  if (!(await tableExists('character_name_change_requests'))) {
    throw new HttpError(500, 'Run the StonePine identity/jobs migration first', 'missing_name_change_table');
  }
  const body = z.object({
    characterId: uuid.optional(),
    platformUid: platformUid.optional(),
    platformId: platformUid.optional(),
    newFirstName: personName,
    newLastName: personName,
    reason: z.string().trim().min(3).max(500)
  }).parse(req.body);

  const request = await tx(async (client) => {
    const character = await resolveCharacter(client, body, { lock: true });
    const existing = await client.query(
      `select id from character_name_change_requests
       where character_id=$1 and status='pending' limit 1`,
      [character.id]
    );
    if (existing.rows[0]) throw new HttpError(409, 'A name-change request is already pending', 'name_change_pending');

    const inserted = await client.query(
      `insert into character_name_change_requests(
         character_id, old_first_name, old_last_name, requested_first_name, requested_last_name, reason, status, requested_at
       ) values($1,$2,$3,$4,$5,$6,'pending',now()) returning *`,
      [character.id, character.first_name, character.last_name, body.newFirstName, body.newLastName, body.reason]
    );
    return inserted.rows[0];
  });

  res.status(201).json({ ok: true, request, message: 'Name-change request submitted for staff approval' });
}));

app.post('/v2/admin/name-change/approve', requireApiKey, asyncRoute(async (req, res) => {
  const body = z.object({
    requestId: uuid,
    approved: z.boolean().default(true),
    reviewedBy: z.string().trim().min(1).max(128).default('StonePine staff'),
    reviewNote: z.string().trim().max(500).default('')
  }).parse(req.body);

  const result = await tx(async (client) => {
    const requestResult = await client.query(
      `select * from character_name_change_requests where id=$1 for update`,
      [body.requestId]
    );
    const request = requestResult.rows[0];
    if (!request) throw new HttpError(404, 'Name-change request not found', 'name_change_request_not_found');
    if (request.status !== 'pending') throw new HttpError(409, 'This request has already been reviewed', 'name_change_already_reviewed');

    const status = body.approved ? 'approved' : 'rejected';
    let character = null;
    if (body.approved) {
      const updated = await client.query(
        `update characters set first_name=$1, last_name=$2, updated_at=now()
         where id=$3 returning *`,
        [request.requested_first_name, request.requested_last_name, request.character_id]
      );
      character = updated.rows[0];
    }

    await client.query(
      `update character_name_change_requests
       set status=$1, reviewed_at=now(), reviewed_by=$2, review_note=$3
       where id=$4`,
      [status, body.reviewedBy, body.reviewNote, body.requestId]
    );
    return { status, character };
  });

  res.json({ ok: true, ...result, character: publicCharacter(result.character) });
}));

app.get('/v2/jobs', requireApiKey, asyncRoute(async (_req, res) => {
  const rows = await many('select * from job_definitions where active=true order by whitelisted asc, display_name asc');
  res.json({ ok: true, jobs: rows });
}));

app.post('/v2/jobs/select', rateLimit(60_000, 20), requireApiKey, asyncRoute(async (req, res) => {
  const body = z.object({
    characterId: uuid.optional(),
    platformUid: platformUid.optional(),
    platformId: platformUid.optional(),
    jobKey
  }).parse(req.body);

  const result = await tx(async (client) => {
    const character = await resolveCharacter(client, body, { lock: true });
    const active = await client.query(
      `select id from job_sessions where character_id=$1 and status='active' limit 1`,
      [character.id]
    );
    if (active.rows[0]) throw new HttpError(409, 'Clock out before changing jobs', 'active_shift_exists');

    const definitionResult = await client.query('select * from job_definitions where job_key=$1 and active=true', [body.jobKey]);
    const definition = definitionResult.rows[0];
    if (!definition) throw new HttpError(404, 'Job is not available', 'job_not_found');

    const testWhitelistBypass = String(process.env.STONEPINERP_ALLOW_TEST_WHITELIST_BYPASS ?? '').toLowerCase() === 'true';
    if (definition.whitelisted && !testWhitelistBypass && !(await hasActiveRole(client, character.id, body.jobKey))) {
      throw new HttpError(403, `${definition.display_name} is whitelisted`, 'job_not_whitelisted');
    }

    const updated = await client.query(
      `update characters set job_key=$1, updated_at=now() where id=$2 returning *`,
      [body.jobKey, character.id]
    );
    return { character: updated.rows[0], job: definition };
  });

  res.json({ ok: true, character: publicCharacter(result.character), job: result.job });
}));

app.post('/v2/duty/clock-in', rateLimit(60_000, 20), requireApiKey, asyncRoute(async (req, res) => {
  const body = z.object({
    characterId: uuid.optional(),
    platformUid: platformUid.optional(),
    platformId: platformUid.optional(),
    displayName: z.string().trim().min(1).max(96).default('StonePine Resident'),
    jobKey,
    stationKey: stationKey.optional()
  }).parse(req.body);
  const uid = normalisePlatformUid(body);

  const result = await tx(async (client) => {
    const character = await resolveCharacter(client, body, { lock: true });
    const definitionResult = await client.query('select * from job_definitions where job_key=$1 and active=true', [body.jobKey]);
    const definition = definitionResult.rows[0];
    if (!definition) throw new HttpError(404, 'Job is not available', 'job_not_found');

    const testWhitelistBypass = String(process.env.STONEPINERP_ALLOW_TEST_WHITELIST_BYPASS ?? '').toLowerCase() === 'true';
    if (definition.whitelisted && !testWhitelistBypass && !(await hasActiveRole(client, character.id, body.jobKey))) {
      throw new HttpError(403, `${definition.display_name} is whitelisted`, 'job_not_whitelisted');
    }

    if (body.stationKey) {
      const stationResult = await client.query('select * from duty_stations where station_key=$1 and active=true', [body.stationKey]);
      const station = stationResult.rows[0];
      if (!station) throw new HttpError(404, 'Duty station is not available', 'duty_station_not_found');
      if (isWhitelistedRole(body.jobKey) && station.duty_role !== body.jobKey) {
        throw new HttpError(400, 'This terminal is not assigned to that department', 'wrong_duty_station');
      }
    }

    const active = await client.query(
      `select * from job_sessions where character_id=$1 and status='active' order by started_at desc limit 1`,
      [character.id]
    );
    if (active.rows[0]) throw new HttpError(409, 'Character is already clocked in', 'already_clocked_in');

    const hasServerId = await columnExists('job_sessions', 'server_id', client);
    const insert = hasServerId
      ? await client.query(
        `insert into job_sessions(character_id, job_key, status, started_at, server_id, station_key)
         values($1,$2,'active',now(),$3,$4) returning *`,
        [character.id, body.jobKey, req.stonePineServerId ?? SERVER_ID, body.stationKey ?? null]
      )
      : await client.query(
        `insert into job_sessions(character_id, job_key, status, started_at)
         values($1,$2,'active',now()) returning *`,
        [character.id, body.jobKey]
      );

    const updated = await client.query(
      `update characters set job_key=$1, whitelist_role=$2, updated_at=now() where id=$3 returning *`,
      [body.jobKey, isWhitelistedRole(body.jobKey) ? body.jobKey : character.whitelist_role, character.id]
    );

    if (uid) {
      await upsertOnlinePlayer(client, {
        platformUid: uid,
        character: updated.rows[0],
        displayName: body.displayName,
        job: body.jobKey,
        isOnDuty: true
      });
    }
    return { session: insert.rows[0], character: updated.rows[0], job: definition };
  });

  res.status(201).json({ ok: true, ...result, character: publicCharacter(result.character) });
}));

app.post('/v2/duty/clock-out', rateLimit(60_000, 20), requireApiKey, asyncRoute(async (req, res) => {
  const body = z.object({
    characterId: uuid.optional(),
    platformUid: platformUid.optional(),
    platformId: platformUid.optional(),
    displayName: z.string().trim().min(1).max(96).default('StonePine Resident'),
    reason: z.string().trim().min(1).max(128).default('manual')
  }).parse(req.body);
  const uid = normalisePlatformUid(body);

  const result = await tx(async (client) => {
    const character = await resolveCharacter(client, body, { lock: true });
    const activeResult = await client.query(
      `select * from job_sessions where character_id=$1 and status='active'
       order by started_at desc limit 1 for update`,
      [character.id]
    );
    const active = activeResult.rows[0];
    if (!active) throw new HttpError(409, 'Character is not clocked in', 'not_clocked_in');

    const hasReason = await columnExists('job_sessions', 'clock_out_reason', client);
    const finished = hasReason
      ? await client.query(
        `update job_sessions set status='completed', finished_at=now(), clock_out_reason=$1 where id=$2 returning *`,
        [body.reason, active.id]
      )
      : await client.query(
        `update job_sessions set status='completed', finished_at=now() where id=$1 returning *`,
        [active.id]
      );

    if (uid) {
      await upsertOnlinePlayer(client, {
        platformUid: uid,
        character,
        displayName: body.displayName,
        job: character.job_key,
        isOnDuty: false
      });
    }
    return { session: finished.rows[0], character };
  });

  res.json({ ok: true, ...result, character: publicCharacter(result.character) });
}));

app.post('/v2/duty/status', requireApiKey, asyncRoute(async (req, res) => {
  const body = z.object({
    characterId: uuid.optional(),
    platformUid: platformUid.optional(),
    platformId: platformUid.optional()
  }).parse(req.body);

  const result = await tx(async (client) => {
    const character = await resolveCharacter(client, body);
    const sessionResult = await client.query(
      `select * from job_sessions where character_id=$1 and status='active'
       order by started_at desc limit 1`,
      [character.id]
    );
    return { character, session: sessionResult.rows[0] ?? null };
  });

  res.json({ ok: true, onDuty: Boolean(result.session), session: result.session, character: publicCharacter(result.character) });
}));

app.post('/v2/players/offline', requireApiKey, asyncRoute(async (req, res) => {
  const body = z.object({
    platformUid,
    reason: z.string().trim().min(1).max(128).default('disconnect')
  }).parse(req.body);

  const result = await tx(async (client) => {
    const characterResult = await client.query(
      `select c.* from characters c join players p on p.id=c.player_id
       where p.platform_uid=$1 order by c.updated_at desc limit 1`,
      [body.platformUid]
    );
    const character = characterResult.rows[0] ?? null;
    let closedSessions = 0;
    if (character) {
      const hasReason = await columnExists('job_sessions', 'clock_out_reason', client);
      const update = hasReason
        ? await client.query(
          `update job_sessions set status='completed', finished_at=now(), clock_out_reason=$1
           where character_id=$2 and status='active'`,
          [body.reason, character.id]
        )
        : await client.query(
          `update job_sessions set status='completed', finished_at=now()
           where character_id=$1 and status='active'`,
          [character.id]
        );
      closedSessions = update.rowCount;
    }
    await client.query(
      `update online_players set online=false, is_on_duty=false, role_on_duty='civilian', last_seen=now()
       where server_id=$1 and platform_uid=$2`,
      [req.stonePineServerId ?? SERVER_ID, body.platformUid]
    );
    return { closedSessions };
  });

  res.json({ ok: true, ...result });
}));

app.post(['/v1/money/transfer', '/v2/money/transfer'], rateLimit(60_000, 20), requireApiKey, asyncRoute(async (req, res) => {
  const body = z.object({
    fromCharacterId: uuid,
    toCharacterId: uuid,
    amountCents: z.number().int().positive().max(100_000_000),
    note: z.string().trim().max(250).default('StonePine bank transfer')
  }).parse(req.body);
  if (body.fromCharacterId === body.toCharacterId) throw new HttpError(400, 'Cannot transfer to the same character', 'same_character');

  const result = await tx(async (client) => {
    const from = await client.query('select id, bank_cents from characters where id=$1 for update', [body.fromCharacterId]);
    const to = await client.query('select id, bank_cents from characters where id=$1 for update', [body.toCharacterId]);
    if (!from.rows[0] || !to.rows[0]) throw new HttpError(404, 'Character not found', 'character_not_found');
    if (cents(from.rows[0].bank_cents) < body.amountCents) throw new HttpError(400, 'Insufficient bank balance', 'insufficient_funds');

    await client.query('update characters set bank_cents=bank_cents-$1, updated_at=now() where id=$2', [body.amountCents, body.fromCharacterId]);
    await client.query('update characters set bank_cents=bank_cents+$1, updated_at=now() where id=$2', [body.amountCents, body.toCharacterId]);
    await client.query(
      `insert into transactions(from_character_id,to_character_id,tx_type,amount_cents,note)
       values($1,$2,'bank_transfer',$3,$4)`,
      [body.fromCharacterId, body.toCharacterId, body.amountCents, body.note]
    );
    return { amountCents: body.amountCents };
  });

  res.json({ ok: true, transfer: result });
}));

app.post(['/v1/discord/court-date', '/v2/discord/court-date'], requireApiKey, asyncRoute(async (req, res) => {
  const webhook = process.env.COURT_DISCORD_WEBHOOK_URL;
  if (!webhook) return res.json({ ok: true, skipped: true, reason: 'COURT_DISCORD_WEBHOOK_URL is not set' });
  const body = z.object({ playerName: z.string().min(1), courtDateTime: z.string().min(1), reason: z.string().min(1).max(500) }).parse(req.body);
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: `📅 **StonePineRP Court Date**\nPlayer: ${body.playerName}\nDate/Time: ${body.courtDateTime}\nReason: ${body.reason}` })
  });
  res.json({ ok: response.ok, discordStatus: response.status });
}));

app.post(['/v1/discord/jail-log', '/v2/discord/jail-log'], requireApiKey, asyncRoute(async (req, res) => {
  const webhook = process.env.JAIL_DISCORD_WEBHOOK_URL;
  if (!webhook) return res.json({ ok: true, skipped: true, reason: 'JAIL_DISCORD_WEBHOOK_URL is not set' });
  const body = z.object({ playerName: z.string().min(1), timeMinutes: z.number().int().min(1).max(10080), reason: z.string().min(1).max(500) }).parse(req.body);
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: `🚔 **StonePineRP Jail Log**\nPlayer: ${body.playerName}\nTime: ${body.timeMinutes} minutes\nReason: ${body.reason}` })
  });
  res.json({ ok: response.ok, discordStatus: response.status });
}));

app.use((req, res) => {
  res.status(404).json({ ok: false, error: `Route not found: ${req.method} ${req.path}`, code: 'not_found' });
});

app.use(errorHandler);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[StonePineRP] Backend listening on 0.0.0.0:${PORT} (legacy project: YellowstoneRP)`);
});
