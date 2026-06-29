import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { z } from 'zod';
import { tx, one, many } from './db.js';
import { requireApiKey, rateLimit, asyncRoute, errorHandler, HttpError } from './middleware.js';
dotenv.config();
const app = express();
app.use(helmet());
app.use(cors({ origin: false }));
app.use(express.json({ limit: '1mb' }));
const uuid = z.string().uuid();
const money = z.number().int().positive().max(100_000_000);
const optionalActor = z.object({ actorCharacterId: uuid.optional() });
const serverWindowSeconds = Number(process.env.ONLINE_HEARTBEAT_WINDOW_SECONDS ?? 90);
const maxSpawnedVehiclesPerCharacter = Number(process.env.MAX_SPAWNED_VEHICLES_PER_CHARACTER ?? 2);
const maxActiveFires = Number(process.env.MAX_ACTIVE_FIRES ?? 30);
const robberyCooldownSeconds = Number(process.env.ROBBERY_COOLDOWN_SECONDS ?? 1800);
const prisonJobCooldownSeconds = Number(process.env.PRISON_JOB_COOLDOWN_SECONDS ?? 90);
const panicCooldownSeconds = Number(process.env.POLICE_PANIC_COOLDOWN_SECONDS ?? 180);
const whitelistPaycheckIntervalSeconds = Number(process.env.WHITELIST_PAYCHECK_INTERVAL_SECONDS ?? 1800);
const propertyDoorCodeSecret = process.env.PROPERTY_DOOR_CODE_SECRET ?? process.env.YELLOWSTONERP_API_KEY ?? 'change_this_property_door_secret';
const twitterPostCooldownSeconds = Number(process.env.PHONE_TWITTER_POST_COOLDOWN_SECONDS ?? 30);
const whitelistPayRates = {
    police: Number(process.env.PAYCHECK_POLICE_CENTS ?? 85000),
    fire: Number(process.env.PAYCHECK_FIRE_CENTS ?? 80000),
    ems: Number(process.env.PAYCHECK_EMS_CENTS ?? 80000),
    prison: Number(process.env.PAYCHECK_PRISON_CENTS ?? 75000)
};
const injuryKindSchema = z.enum(['minor_injury', 'major_injury', 'concussion', 'open_wound', 'broken_bone', 'sprain']);
const bodyPartSchema = z.enum(['head', 'torso', 'left_arm', 'right_arm', 'left_leg', 'right_leg', 'full_body', 'unknown']).default('unknown');
const whitelistDutyRoleSchema = z.enum(['police', 'fire', 'ems', 'prison']);
const STAFF_ROLES = ['admin', 'gm'];
function serverId(req) {
    return req.header('x-yellowstonerp-server-id') ?? 'unknown-server';
}
function requestHash(req) {
    return crypto.createHash('sha256').update(JSON.stringify(req.body ?? {})).digest('hex');
}
async function audit(client, action, actorCharacterId, targetCharacterId, metadata = {}) {
    await client.query('INSERT INTO audit_logs(action, actor_character_id, target_character_id, metadata) VALUES($1,$2,$3,$4)', [action, actorCharacterId, targetCharacterId, metadata]);
}
async function roleRows(client, characterId) {
    const result = await client.query(`SELECT role_key, rank_key FROM role_assignments
     WHERE character_id=$1 AND active=true`, [characterId]);
    return result.rows;
}
async function hasAnyRole(client, characterId, allowed) {
    const roles = await roleRows(client, characterId);
    return roles.some((r) => allowed.includes(r.role_key));
}
async function requireActorRole(client, actorCharacterId, allowed, action) {
    if (!actorCharacterId)
        throw new HttpError(403, `${action} requires an actor character`, 'missing_actor');
    if (!(await hasAnyRole(client, actorCharacterId, allowed))) {
        throw new HttpError(403, `${action} requires one of: ${allowed.join(', ')}`, 'forbidden_role');
    }
}
async function requireSelfOrAdmin(client, actorCharacterId, targetCharacterId, action) {
    if (!actorCharacterId)
        throw new HttpError(403, `${action} requires an actor character`, 'missing_actor');
    if (actorCharacterId === targetCharacterId)
        return;
    if (!(await hasAnyRole(client, actorCharacterId, STAFF_ROLES))) {
        throw new HttpError(403, `${action} must be requested by the same character or an admin`, 'forbidden_self');
    }
}
async function requireOnDutyRole(client, req, actorCharacterId, role, action) {
    if (!actorCharacterId)
        throw new HttpError(403, `${action} requires an actor character`, 'missing_actor');
    if (await hasAnyRole(client, actorCharacterId, STAFF_ROLES))
        return;
    await requireActorRole(client, actorCharacterId, [role], action);
    const online = await client.query(`SELECT 1 FROM online_players
     WHERE character_id=$1 AND server_id=$2 AND online=true AND is_on_duty=true AND role_on_duty=$3
       AND last_seen > now() - ($4::text)::interval
     LIMIT 1`, [actorCharacterId, serverId(req), role, `${serverWindowSeconds} seconds`]);
    if (!online.rows[0])
        throw new HttpError(403, `${action} requires active ${role} duty`, 'not_on_duty');
}
function hashPropertyDoorCode(code, salt) {
    return crypto.createHmac('sha256', propertyDoorCodeSecret).update(`${salt}:${code}`).digest('hex');
}
function newSalt() {
    return crypto.randomBytes(16).toString('hex');
}
function hashVehicleEntryCode(code, salt) {
    return crypto.createHmac('sha256', propertyDoorCodeSecret).update(`vehicle:${salt}:${code}`).digest('hex');
}
async function requireVehicleOwnerOrStaff(client, actorCharacterId, vehicleId, action) {
    if (!actorCharacterId)
        throw new HttpError(403, `${action} requires an actor character`, 'missing_actor');
    const v = await client.query('SELECT id, owner_character_id, registered_owner_character_id FROM vehicles WHERE id=$1', [vehicleId]);
    if (!v.rows[0])
        throw new HttpError(404, 'Vehicle not found', 'vehicle_not_found');
    const ownerId = v.rows[0].registered_owner_character_id ?? v.rows[0].owner_character_id;
    if (actorCharacterId === ownerId)
        return v.rows[0];
    if (await hasAnyRole(client, actorCharacterId, STAFF_ROLES))
        return v.rows[0];
    throw new HttpError(403, 'Only the registered owner can do that with this vehicle', 'vehicle_owner_required');
}
async function hasVehicleEntryAccess(client, characterId, vehicleId) {
    const v = await client.query('SELECT owner_character_id, registered_owner_character_id, locked FROM vehicles WHERE id=$1', [vehicleId]);
    if (!v.rows[0])
        throw new HttpError(404, 'Vehicle not found', 'vehicle_not_found');
    const ownerId = v.rows[0].registered_owner_character_id ?? v.rows[0].owner_character_id;
    if (ownerId === characterId)
        return true;
    const grant = await client.query('SELECT id FROM vehicle_access_grants WHERE vehicle_id=$1 AND character_id=$2 AND (expires_at IS NULL OR expires_at>now()) LIMIT 1', [vehicleId, characterId]);
    return Boolean(grant.rows[0]);
}
async function activeDutyCount(role) {
    const row = await one(`SELECT count(*)::int AS count
     FROM online_players
     WHERE online=true AND is_on_duty=true AND role_on_duty=$1
       AND last_seen > now() - ($2::text)::interval`, [role, `${serverWindowSeconds} seconds`]);
    return Number(row?.count ?? 0);
}
async function ensureIdempotent(client, req, endpoint) {
    const key = req.header('idempotency-key');
    if (!key)
        return;
    const hash = requestHash(req);
    try {
        await client.query('INSERT INTO api_idempotency(server_id, endpoint, idempotency_key, request_hash) VALUES($1,$2,$3,$4)', [serverId(req), endpoint, key, hash]);
    }
    catch {
        throw new HttpError(409, 'Duplicate idempotency key. Do not replay economy/jail/payment actions.', 'duplicate_request');
    }
}
function roleFromString(value) {
    if (value === 'police' || value === 'fire' || value === 'ems' || value === 'prison' || value === 'admin' || value === 'gm')
        return value;
    return 'civilian';
}
async function hasInventoryItem(client, characterId, itemKey, minQty = 1) {
    const result = await client.query('SELECT quantity FROM inventory_items WHERE character_id=$1 AND item_key=$2 LIMIT 1', [characterId, itemKey]);
    return Number(result.rows[0]?.quantity ?? 0) >= minQty;
}
async function addCharacterInventoryItem(client, characterId, itemKey, quantity, metadata = {}) {
    await client.query(`INSERT INTO inventory_items(character_id, item_key, quantity, metadata)
     VALUES($1,$2,$3,$4::jsonb)
     ON CONFLICT(character_id, item_key, metadata) DO UPDATE SET quantity=inventory_items.quantity+EXCLUDED.quantity`, [characterId, itemKey, quantity, JSON.stringify(metadata)]);
}
async function removeCharacterInventoryItem(client, characterId, itemKey, quantity) {
    const current = await client.query(`SELECT id, quantity FROM inventory_items
     WHERE character_id=$1 AND item_key=$2 AND quantity > 0
     ORDER BY created_at ASC FOR UPDATE`, [characterId, itemKey]);
    let remaining = quantity;
    for (const row of current.rows) {
        if (remaining <= 0)
            break;
        const take = Math.min(remaining, Number(row.quantity));
        await client.query('UPDATE inventory_items SET quantity=quantity-$1 WHERE id=$2', [take, row.id]);
        remaining -= take;
    }
    if (remaining > 0)
        throw new HttpError(400, `Not enough ${itemKey}`, 'not_enough_items');
}
async function getItemWeightProfile(client, itemKey) {
    const item = await client.query('SELECT item_key, display_name, weight_grams, stack_limit, inventory_slot_size FROM item_catalog WHERE item_key=$1', [itemKey]);
    if (item.rows[0])
        return {
            itemKey,
            displayName: item.rows[0].display_name,
            weightGrams: Number(item.rows[0].weight_grams ?? 500),
            stackLimit: Math.max(1, Number(item.rows[0].stack_limit ?? 20)),
            slotSize: Math.max(1, Number(item.rows[0].inventory_slot_size ?? 1))
        };
    return { itemKey, displayName: itemKey, weightGrams: 500, stackLimit: 20, slotSize: 1 };
}
async function ensureInventoryContainer(client, args) {
    const ownerId = args.ownerId ?? null;
    const ownerKey = args.ownerKey ?? null;
    const existing = ownerId
        ? await client.query('SELECT * FROM inventory_containers WHERE owner_type=$1 AND owner_id=$2 LIMIT 1', [args.ownerType, ownerId])
        : await client.query('SELECT * FROM inventory_containers WHERE owner_type=$1 AND owner_key=$2 LIMIT 1', [args.ownerType, ownerKey]);
    if (existing.rows[0]) {
        const upd = await client.query(`UPDATE inventory_containers
       SET label=$1, slot_cap=$2, weight_limit_grams=$3, active=true, updated_at=now(), metadata=metadata || $4::jsonb
       WHERE id=$5 RETURNING *`, [args.label, args.slotCap, args.weightLimitGrams, JSON.stringify(args.metadata ?? {}), existing.rows[0].id]);
        return upd.rows[0];
    }
    const inserted = await client.query(`INSERT INTO inventory_containers(owner_type, owner_id, owner_key, character_id, vehicle_id, clothing_instance_id, label, slot_cap, weight_limit_grams, metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING *`, [args.ownerType, ownerId, ownerKey, args.characterId ?? null, args.vehicleId ?? null, args.clothingInstanceId ?? null, args.label, args.slotCap, args.weightLimitGrams, JSON.stringify(args.metadata ?? {})]);
    return inserted.rows[0];
}
async function getContainerStats(client, containerId) {
    const container = await client.query('SELECT * FROM inventory_containers WHERE id=$1 AND active=true', [containerId]);
    if (!container.rows[0])
        throw new HttpError(404, 'Inventory container not found', 'container_not_found');
    const stats = await client.query(`SELECT
       COALESCE(SUM(i.quantity * COALESCE(c.weight_grams, 500)),0)::int AS used_weight_grams,
       COALESCE(SUM(CEIL(i.quantity::numeric / COALESCE(NULLIF(c.stack_limit,0),20)) * COALESCE(c.inventory_slot_size,1)),0)::int AS used_slots
     FROM inventory_container_items i
     LEFT JOIN item_catalog c ON c.item_key=i.item_key
     WHERE i.container_id=$1 AND i.quantity > 0`, [containerId]);
    return {
        container: container.rows[0],
        usedWeightGrams: Number(stats.rows[0]?.used_weight_grams ?? 0),
        usedSlots: Number(stats.rows[0]?.used_slots ?? 0)
    };
}
async function assertContainerCanFit(client, containerId, itemKey, quantity) {
    const profile = await getItemWeightProfile(client, itemKey);
    const stats = await getContainerStats(client, containerId);
    const existing = await client.query('SELECT quantity FROM inventory_container_items WHERE container_id=$1 AND item_key=$2 AND metadata=$3::jsonb LIMIT 1', [containerId, itemKey, '{}']);
    const existingQty = Number(existing.rows[0]?.quantity ?? 0);
    const oldSlots = existingQty > 0 ? Math.ceil(existingQty / profile.stackLimit) * profile.slotSize : 0;
    const newSlots = Math.ceil((existingQty + quantity) / profile.stackLimit) * profile.slotSize;
    const extraSlots = newSlots - oldSlots;
    const extraWeight = quantity * profile.weightGrams;
    if (stats.usedSlots + extraSlots > Number(stats.container.slot_cap)) {
        throw new HttpError(400, `Container slot cap exceeded: ${stats.usedSlots + extraSlots}/${stats.container.slot_cap}`, 'container_slots_full');
    }
    if (stats.usedWeightGrams + extraWeight > Number(stats.container.weight_limit_grams)) {
        throw new HttpError(400, `Container weight limit exceeded: ${stats.usedWeightGrams + extraWeight}/${stats.container.weight_limit_grams}g`, 'container_too_heavy');
    }
    return { profile, stats, extraSlots, extraWeight };
}
async function addContainerItem(client, containerId, itemKey, quantity, metadata = {}) {
    await assertContainerCanFit(client, containerId, itemKey, quantity);
    await client.query(`INSERT INTO inventory_container_items(container_id, item_key, quantity, metadata)
     VALUES($1,$2,$3,$4::jsonb)
     ON CONFLICT(container_id, item_key, metadata) DO UPDATE SET quantity=inventory_container_items.quantity+EXCLUDED.quantity, updated_at=now()`, [containerId, itemKey, quantity, JSON.stringify(metadata)]);
}
async function removeContainerItem(client, containerId, itemKey, quantity) {
    const item = await client.query(`SELECT id, quantity FROM inventory_container_items
     WHERE container_id=$1 AND item_key=$2 AND quantity > 0
     ORDER BY created_at ASC FOR UPDATE`, [containerId, itemKey]);
    let remaining = quantity;
    for (const row of item.rows) {
        if (remaining <= 0)
            break;
        const take = Math.min(remaining, Number(row.quantity));
        await client.query('UPDATE inventory_container_items SET quantity=quantity-$1, updated_at=now() WHERE id=$2', [take, row.id]);
        remaining -= take;
    }
    if (remaining > 0)
        throw new HttpError(400, `Container does not have enough ${itemKey}`, 'container_missing_item');
}
async function listContainer(client, containerId) {
    const stats = await getContainerStats(client, containerId);
    const items = await client.query(`SELECT i.item_key, i.quantity, i.metadata, COALESCE(c.display_name, i.item_key) AS display_name,
            COALESCE(c.weight_grams, 500) AS weight_grams,
            COALESCE(c.stack_limit, 20) AS stack_limit,
            COALESCE(c.inventory_slot_size, 1) AS inventory_slot_size
     FROM inventory_container_items i
     LEFT JOIN item_catalog c ON c.item_key=i.item_key
     WHERE i.container_id=$1 AND i.quantity > 0
     ORDER BY display_name`, [containerId]);
    return { ...stats, items: items.rows };
}
async function characterHasFreshOnlineRow(client, req, characterId) {
    const online = await client.query(`SELECT 1 FROM online_players
     WHERE server_id=$1 AND character_id=$2 AND online=true
       AND last_seen > now() - ($3::text)::interval
     LIMIT 1`, [serverId(req), characterId, `${serverWindowSeconds} seconds`]);
    return Boolean(online.rows[0]);
}
function generatePlate(prefix = 'RP') {
    const n = Math.floor(100000 + Math.random() * 899999);
    return `${prefix}${n}`.slice(0, 12).toUpperCase();
}
async function postDiscordWebhook(url, payload) {
    if (!url || url.includes('replace_') || url.trim().length < 20)
        return { posted: false, skipped: true };
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return { posted: response.ok, status: response.status };
    }
    catch (err) {
        console.warn('[YellowstoneRP] Discord webhook failed:', err?.message ?? err);
        return { posted: false, error: String(err?.message ?? err) };
    }
}
async function characterDisplayName(client, characterId) {
    if (!characterId)
        return 'Unknown';
    const result = await client.query('SELECT first_name, last_name, character_code FROM characters WHERE id=$1', [characterId]);
    const row = result.rows[0];
    if (!row)
        return 'Unknown';
    return `${row.first_name} ${row.last_name} (${row.character_code})`;
}
function buildDiscordEmbed(title, description, fields = [], color = 0xd6a536) {
    return { embeds: [{ title, description, color, fields, timestamp: new Date().toISOString(), footer: { text: 'Yellowstone RP' } }] };
}
function adminPasswordMatches(password) {
    const expected = process.env.ADMIN_PANEL_PASSWORD ?? 'RedBull1';
    return password === expected;
}
function newAdminToken() {
    return crypto.randomBytes(32).toString('hex');
}
async function requireAdminPanelSession(client, token) {
    const result = await client.query(`SELECT s.*, c.character_code, c.first_name, c.last_name
     FROM admin_panel_sessions s
     LEFT JOIN characters c ON c.id=s.character_id
     WHERE s.session_token=$1 AND s.active=true AND s.expires_at > now()
     LIMIT 1`, [token]);
    if (!result.rows[0])
        throw new HttpError(401, 'Admin panel session expired or invalid', 'admin_session_invalid');
    return result.rows[0];
}
function isInsideFarmZone(plantX, plantY, zone) {
    return plantX >= Number(zone.min_x) && plantX <= Number(zone.max_x) && plantY >= Number(zone.min_y) && plantY <= Number(zone.max_y);
}
app.get('/health', asyncRoute(async (_req, res) => {
    const db = await one('SELECT now() AS now');
    res.json({ ok: true, db });
}));
app.use('/v1', requireApiKey, rateLimit(10_000, 250));
app.post('/v1/server/heartbeat', asyncRoute(async (req, res) => {
    const body = z.object({
        uptimeSeconds: z.number().int().nonnegative().optional(),
        players: z.array(z.object({
            platformUid: z.string().min(3),
            displayName: z.string().min(1).max(64),
            characterId: uuid.optional(),
            roleOnDuty: z.enum(['civilian', 'police', 'fire', 'ems', 'prison', 'admin', 'gm']).default('civilian'),
            isOnDuty: z.boolean().default(false)
        })).max(256).default([])
    }).parse(req.body);
    const sid = serverId(req);
    const result = await tx(async (client) => {
        await client.query(`INSERT INTO server_heartbeats(server_id, uptime_seconds, player_count)
       VALUES($1,$2,$3)
       ON CONFLICT(server_id) DO UPDATE SET uptime_seconds=EXCLUDED.uptime_seconds, player_count=EXCLUDED.player_count, last_seen=now()`, [sid, body.uptimeSeconds ?? 0, body.players.length]);
        for (const p of body.players) {
            await client.query(`INSERT INTO players(platform_uid, display_name)
         VALUES($1,$2)
         ON CONFLICT(platform_uid) DO UPDATE SET display_name=EXCLUDED.display_name, last_seen=now()`, [p.platformUid, p.displayName]);
            await client.query(`INSERT INTO online_players(server_id, platform_uid, character_id, display_name, role_on_duty, is_on_duty, online)
         VALUES($1,$2,$3,$4,$5,$6,true)
         ON CONFLICT(server_id, platform_uid) DO UPDATE SET
           character_id=EXCLUDED.character_id,
           display_name=EXCLUDED.display_name,
           role_on_duty=EXCLUDED.role_on_duty,
           is_on_duty=EXCLUDED.is_on_duty,
           online=true,
           last_seen=now()`, [sid, p.platformUid, p.characterId ?? null, p.displayName, p.roleOnDuty, p.isOnDuty]);
        }
        await audit(client, 'server_heartbeat', null, null, { serverId: sid, playerCount: body.players.length });
        return { serverId: sid, playerCount: body.players.length };
    });
    res.json(result);
}));
app.post('/v1/server/player-offline', asyncRoute(async (req, res) => {
    const body = z.object({ platformUid: z.string().min(3) }).parse(req.body);
    const row = await one('UPDATE online_players SET online=false, is_on_duty=false, last_seen=now() WHERE server_id=$1 AND platform_uid=$2 RETURNING *', [serverId(req), body.platformUid]);
    res.json({ ok: true, player: row });
}));
app.post('/v1/players/upsert', asyncRoute(async (req, res) => {
    const body = z.object({ platformUid: z.string().min(3), displayName: z.string().min(1).max(64) }).parse(req.body);
    const row = await one(`INSERT INTO players(platform_uid, display_name)
     VALUES ($1, $2)
     ON CONFLICT(platform_uid) DO UPDATE SET display_name = EXCLUDED.display_name, last_seen = now()
     RETURNING *`, [body.platformUid, body.displayName]);
    res.json(row);
}));
app.post('/v1/characters/upsert', asyncRoute(async (req, res) => {
    const body = z.object({
        platformUid: z.string().min(3),
        firstName: z.string().min(1).max(32).regex(/^[A-Za-z][A-Za-z '\-]*$/),
        lastName: z.string().min(1).max(32).regex(/^[A-Za-z][A-Za-z '\-]*$/),
        age: z.number().int().min(16).max(100),
        gender: z.enum(['male', 'female']),
        modelKey: z.enum(['yellowstone_male_01', 'yellowstone_female_01'])
    }).parse(req.body);
    const row = await tx(async (client) => {
        const player = await client.query('SELECT id FROM players WHERE platform_uid=$1', [body.platformUid]);
        if (!player.rows[0])
            throw new HttpError(404, 'Player not registered', 'player_not_found');
        const existingForPlayer = await client.query(`SELECT * FROM characters WHERE player_id=$1 ORDER BY created_at ASC LIMIT 1`, [player.rows[0].id]);
        if (existingForPlayer.rows[0])
            return existingForPlayer.rows[0];
        const duplicateName = await client.query(`SELECT id FROM characters WHERE lower(first_name)=lower($1) AND lower(last_name)=lower($2) LIMIT 1`, [body.firstName.trim(), body.lastName.trim()]);
        if (duplicateName.rows[0]) {
            throw new HttpError(409, 'This name is already taken, please try again.', 'character_name_taken');
        }
        const code = `YRP-${Math.floor(100000 + Math.random() * 899999)}`;
        const result = await client.query(`INSERT INTO characters(player_id, character_code, first_name, last_name, age, gender, model_key, bank_cents, has_received_welcome_bonus)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1000000, true)
       RETURNING *`, [player.rows[0].id, code, body.firstName.trim(), body.lastName.trim(), body.age, body.gender, body.modelKey]);
        await client.query('INSERT INTO role_assignments(character_id, role_key, rank_key, active) VALUES($1,$2,$3,true) ON CONFLICT(character_id, role_key) DO NOTHING', [result.rows[0].id, 'civilian', 'citizen']);
        await audit(client, 'character_create', null, result.rows[0].id, { platformUid: body.platformUid, welcomeMessage: 'Welcome to Yellowstone', startingBankCents: 1000000, gender: body.gender, modelKey: body.modelKey, age: body.age });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/characters/register', asyncRoute(async (req, res) => {
    // Alias for the first-join UI flow. Keeps old systems compatible with /characters/upsert.
    req.url = '/v1/characters/upsert';
    res.status(307).json({ redirect: '/v1/characters/upsert', note: 'Use /v1/characters/upsert with platformUid, firstName, lastName, age, gender and modelKey.' });
}));
app.get('/v1/characters/by-platform/:platformUid', asyncRoute(async (req, res) => {
    const row = await one(`SELECT c.*, p.platform_uid, p.display_name
     FROM characters c JOIN players p ON p.id=c.player_id
     WHERE p.platform_uid=$1
     ORDER BY c.created_at DESC LIMIT 1`, [req.params.platformUid]);
    res.json(row ?? null);
}));
app.post('/v1/roles/set', asyncRoute(async (req, res) => {
    const body = z.object({
        actorCharacterId: uuid.optional(),
        bootstrapSecret: z.string().optional(),
        characterId: uuid,
        roleKey: z.enum(['civilian', 'police', 'fire', 'ems', 'prison', 'admin', 'gm']),
        rankKey: z.string().min(1).max(32).default('recruit')
    }).parse(req.body);
    const row = await tx(async (client) => {
        const bootstrapOk = process.env.BOOTSTRAP_ADMIN_SECRET && body.bootstrapSecret === process.env.BOOTSTRAP_ADMIN_SECRET;
        if (!bootstrapOk)
            await requireActorRole(client, body.actorCharacterId, ['admin'], 'Set role');
        await ensureIdempotent(client, req, 'roles/set');
        const result = await client.query(`INSERT INTO role_assignments(character_id, role_key, rank_key)
       VALUES ($1,$2,$3)
       ON CONFLICT(character_id, role_key) DO UPDATE SET rank_key=EXCLUDED.rank_key, active=true
       RETURNING *`, [body.characterId, body.roleKey, body.rankKey]);
        await audit(client, 'role_set', body.actorCharacterId ?? null, body.characterId, { roleKey: body.roleKey, rankKey: body.rankKey, bootstrap: !!bootstrapOk });
        return result.rows[0];
    });
    res.json(row);
}));
app.get('/v1/roles/online-counts', asyncRoute(async (_req, res) => {
    const rows = await many(`SELECT role_on_duty AS role_key, count(*)::int AS count
     FROM online_players
     WHERE online=true AND is_on_duty=true AND role_on_duty IN ('police','fire','ems','prison')
       AND last_seen > now() - ($1::text)::interval
     GROUP BY role_on_duty`, [`${serverWindowSeconds} seconds`]);
    res.json(rows);
}));
app.get('/v1/cad/search', asyncRoute(async (req, res) => {
    const actorCharacterId = String(req.query.actorCharacterId ?? '');
    const qRaw = String(req.query.q ?? '').trim();
    if (qRaw.length < 2)
        throw new HttpError(400, 'Search needs at least 2 characters', 'query_too_short');
    const q = `%${qRaw}%`;
    const result = await tx(async (client) => {
        await requireActorRole(client, actorCharacterId, ['police', 'ems', 'fire', 'prison', 'admin'], 'CAD search');
        const chars = await client.query(`SELECT id, character_code, first_name, last_name, job_key, whitelist_role
       FROM characters
       WHERE character_code ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1
       LIMIT 25`, [q]);
        const vehicles = await client.query('SELECT id, owner_character_id, plate, display_name, stored, garage_key FROM vehicles WHERE plate ILIKE $1 LIMIT 25', [q]);
        await audit(client, 'cad_search', actorCharacterId, null, { q: qRaw });
        return { characters: chars.rows, vehicles: vehicles.rows };
    });
    res.json(result);
}));
app.post('/v1/cad/fines', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ characterId: uuid, reason: z.string().min(2).max(200), amountCents: money }).parse(req.body);
    const row = await tx(async (client) => {
        await requireActorRole(client, body.actorCharacterId, ['police', 'admin'], 'Issue fine');
        await ensureIdempotent(client, req, 'cad/fines');
        const result = await client.query('INSERT INTO fines(character_id, issued_by, reason, amount_cents) VALUES ($1,$2,$3,$4) RETURNING *', [body.characterId, body.actorCharacterId ?? null, body.reason, body.amountCents]);
        await audit(client, 'fine_issue', body.actorCharacterId ?? null, body.characterId, { amountCents: body.amountCents, reason: body.reason });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/cad/wanted', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ characterId: uuid, reason: z.string().min(2).max(240), threatLevel: z.number().int().min(1).max(5).default(1) }).parse(req.body);
    const row = await tx(async (client) => {
        await requireActorRole(client, body.actorCharacterId, ['police', 'admin'], 'Create wanted record');
        await ensureIdempotent(client, req, 'cad/wanted');
        const result = await client.query('INSERT INTO wanted_records(character_id, created_by, reason, threat_level) VALUES ($1,$2,$3,$4) RETURNING *', [body.characterId, body.actorCharacterId ?? null, body.reason, body.threatLevel]);
        await audit(client, 'wanted_create', body.actorCharacterId ?? null, body.characterId, { threatLevel: body.threatLevel, reason: body.reason });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/licences/set', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({
        characterId: uuid,
        licenceType: z.enum(['driving', 'business', 'firearms', 'taxi', 'mechanic']),
        status: z.enum(['valid', 'suspended', 'revoked', 'expired']).default('valid')
    }).parse(req.body);
    const row = await tx(async (client) => {
        await requireActorRole(client, body.actorCharacterId, ['police', 'admin'], 'Set licence');
        await ensureIdempotent(client, req, 'licences/set');
        const result = await client.query(`INSERT INTO licences(character_id, licence_type, status, issued_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT(character_id, licence_type) DO UPDATE SET status=EXCLUDED.status, issued_by=EXCLUDED.issued_by, issued_at=now()
       RETURNING *`, [body.characterId, body.licenceType, body.status, body.actorCharacterId ?? null]);
        await audit(client, 'licence_set', body.actorCharacterId ?? null, body.characterId, { licenceType: body.licenceType, status: body.status });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/bank/transfer', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ fromCharacterId: uuid, toCharacterId: uuid, amountCents: money, note: z.string().max(120).optional() }).parse(req.body);
    if (body.fromCharacterId === body.toCharacterId)
        throw new HttpError(400, 'Cannot transfer to yourself', 'same_account');
    const result = await tx(async (client) => {
        await requireSelfOrAdmin(client, body.actorCharacterId, body.fromCharacterId, 'Bank transfer');
        await ensureIdempotent(client, req, 'bank/transfer');
        const from = await client.query('SELECT bank_cents FROM characters WHERE id=$1 FOR UPDATE', [body.fromCharacterId]);
        const to = await client.query('SELECT id FROM characters WHERE id=$1 FOR UPDATE', [body.toCharacterId]);
        if (!from.rows[0] || !to.rows[0])
            throw new HttpError(404, 'Bank character not found', 'character_not_found');
        if (Number(from.rows[0].bank_cents) < body.amountCents)
            throw new HttpError(400, 'Insufficient bank balance', 'insufficient_funds');
        await client.query('UPDATE characters SET bank_cents=bank_cents-$1, updated_at=now() WHERE id=$2', [body.amountCents, body.fromCharacterId]);
        await client.query('UPDATE characters SET bank_cents=bank_cents+$1, updated_at=now() WHERE id=$2', [body.amountCents, body.toCharacterId]);
        const txRow = await client.query(`INSERT INTO transactions(from_character_id,to_character_id,tx_type,amount_cents,note)
       VALUES($1,$2,'bank_transfer',$3,$4) RETURNING *`, [body.fromCharacterId, body.toCharacterId, body.amountCents, body.note ?? null]);
        await audit(client, 'bank_transfer', body.actorCharacterId ?? null, body.toCharacterId, { fromCharacterId: body.fromCharacterId, amountCents: body.amountCents });
        return txRow.rows[0];
    });
    res.json(result);
}));
app.post('/v1/shop/purchase', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ characterId: uuid, shopKey: z.string().min(2).max(64), itemKey: z.string().min(2).max(64), quantity: z.number().int().min(1).max(100), payWith: z.enum(['cash', 'bank']) }).parse(req.body);
    const result = await tx(async (client) => {
        await requireSelfOrAdmin(client, body.actorCharacterId, body.characterId, 'Shop purchase');
        await ensureIdempotent(client, req, 'shop/purchase');
        const itemRes = await client.query('SELECT * FROM shop_items WHERE shop_key=$1 AND item_key=$2 AND active=true', [body.shopKey, body.itemKey]);
        const item = itemRes.rows[0];
        if (!item)
            throw new HttpError(404, 'Item not sold here', 'item_not_sold');
        if ((!item.legal || item.cash_only) && body.payWith !== 'cash')
            throw new HttpError(400, 'This item must be bought with cash', 'cash_only');
        if (item.requires_licence) {
            const lic = await client.query('SELECT id FROM licences WHERE character_id=$1 AND licence_type=$2 AND status=$3', [body.characterId, item.requires_licence, 'valid']);
            if (!lic.rows[0])
                throw new HttpError(403, `Missing required licence: ${item.requires_licence}`, 'missing_licence');
        }
        const total = Number(item.price_cents) * body.quantity;
        const col = body.payWith === 'cash' ? 'cash_cents' : 'bank_cents';
        const bal = await client.query(`SELECT ${col} AS balance FROM characters WHERE id=$1 FOR UPDATE`, [body.characterId]);
        if (!bal.rows[0])
            throw new HttpError(404, 'Character not found', 'character_not_found');
        if (Number(bal.rows[0].balance) < total)
            throw new HttpError(400, 'Insufficient funds', 'insufficient_funds');
        await client.query(`UPDATE characters SET ${col}=${col}-$1, updated_at=now() WHERE id=$2`, [total, body.characterId]);
        await client.query(`INSERT INTO inventory_items(character_id,item_key,quantity,metadata)
       VALUES($1,$2,$3,'{}')
       ON CONFLICT(character_id,item_key,metadata) DO UPDATE SET quantity=inventory_items.quantity+EXCLUDED.quantity`, [body.characterId, body.itemKey, body.quantity]);
        const txRow = await client.query(`INSERT INTO transactions(from_character_id,tx_type,amount_cents,note) VALUES($1,'shop_purchase',$2,$3) RETURNING *`, [body.characterId, total, `${body.shopKey}:${body.itemKey}`]);
        await audit(client, 'shop_purchase', body.actorCharacterId ?? null, body.characterId, { shopKey: body.shopKey, itemKey: body.itemKey, quantity: body.quantity, payWith: body.payWith });
        return { transaction: txRow.rows[0], item, quantity: body.quantity };
    });
    res.json(result);
}));
app.post('/v1/scratchcards/play', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ characterId: uuid }).parse(req.body);
    const result = await tx(async (client) => {
        await requireSelfOrAdmin(client, body.actorCharacterId, body.characterId, 'Scratch card');
        await ensureIdempotent(client, req, 'scratchcards/play');
        const inv = await client.query(`SELECT id, quantity FROM inventory_items WHERE character_id=$1 AND item_key='scratch_card' FOR UPDATE`, [body.characterId]);
        if (!inv.rows[0] || Number(inv.rows[0].quantity) < 1)
            throw new HttpError(400, 'No scratch card', 'no_scratch_card');
        await client.query('UPDATE inventory_items SET quantity=quantity-1 WHERE id=$1', [inv.rows[0].id]);
        const roll = Math.random();
        let payout = 0;
        if (roll > 0.9975)
            payout = 1_000_000;
        else if (roll > 0.975)
            payout = 100_000;
        else if (roll > 0.90)
            payout = 10_000;
        else if (roll > 0.70)
            payout = 1_000;
        if (payout > 0)
            await client.query('UPDATE characters SET cash_cents=cash_cents+$1, updated_at=now() WHERE id=$2', [payout, body.characterId]);
        const log = await client.query('INSERT INTO scratch_card_logs(character_id,cost_cents,payout_cents,roll) VALUES($1,500,$2,$3) RETURNING *', [body.characterId, payout, roll]);
        await audit(client, 'scratchcard_play', body.actorCharacterId ?? null, body.characterId, { payoutCents: payout });
        return { payoutCents: payout, log: log.rows[0] };
    });
    res.json(result);
}));
app.post('/v1/jail/sentence', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ characterId: uuid, reason: z.string().min(2).max(240), seconds: z.number().int().min(60).max(86400) }).parse(req.body);
    const row = await tx(async (client) => {
        await requireActorRole(client, body.actorCharacterId, ['police', 'admin'], 'Jail sentence');
        await ensureIdempotent(client, req, 'jail/sentence');
        await client.query('UPDATE jail_sentences SET active=false, released_at=now() WHERE character_id=$1 AND active=true', [body.characterId]);
        const result = await client.query(`INSERT INTO jail_sentences(character_id, issued_by, reason, sentence_seconds, remaining_seconds)
       VALUES($1,$2,$3,$4,$4) RETURNING *`, [body.characterId, body.actorCharacterId ?? null, body.reason, body.seconds]);
        const jailedName = await characterDisplayName(client, body.characterId);
        const officerName = await characterDisplayName(client, body.actorCharacterId ?? null);
        await audit(client, 'jail_sentence', body.actorCharacterId ?? null, body.characterId, { seconds: body.seconds, reason: body.reason, discordWebhook: Boolean(process.env.DISCORD_JAIL_WEBHOOK_URL) });
        await client.query('INSERT INTO discord_event_queue(event_type, payload, status) VALUES($1,$2,$3)', ['jail_log', { jailedName, officerName, reason: body.reason, seconds: body.seconds, sentenceId: result.rows[0].id }, 'queued']);
        return { ...result.rows[0], jailedName, officerName };
    });
    await postDiscordWebhook(process.env.DISCORD_JAIL_WEBHOOK_URL, buildDiscordEmbed('Jail Log', 'A player has been jailed on Yellowstone RP.', [
        { name: 'Player', value: row.jailedName ?? String(body.characterId), inline: true },
        { name: 'Officer/Admin', value: row.officerName ?? 'Unknown', inline: true },
        { name: 'Time', value: `${body.seconds} seconds`, inline: true },
        { name: 'Reason', value: body.reason, inline: false }
    ], 0xcc3333));
    res.json(row);
}));
app.get('/v1/jail/active/:characterId', asyncRoute(async (req, res) => {
    const row = await one('SELECT * FROM jail_sentences WHERE character_id=$1 AND active=true ORDER BY created_at DESC LIMIT 1', [req.params.characterId]);
    res.json(row ?? null);
}));
async function handleJailOnlineTick(req, res) {
    const body = z.object({ characterId: uuid, elapsedSeconds: z.number().int().min(1).max(120) }).parse(req.body);
    const row = await tx(async (client) => {
        const sentence = await client.query('SELECT * FROM jail_sentences WHERE character_id=$1 AND active=true ORDER BY created_at DESC LIMIT 1 FOR UPDATE', [body.characterId]);
        if (!sentence.rows[0])
            return { active: false, remainingSeconds: 0, paused: false };
        const online = await characterHasFreshOnlineRow(client, req, body.characterId);
        if (!online) {
            await client.query('INSERT INTO jail_tick_logs(sentence_id, character_id, server_id, requested_elapsed_seconds, applied_elapsed_seconds, was_online, remaining_seconds) VALUES($1,$2,$3,$4,0,false,$5)', [sentence.rows[0].id, body.characterId, serverId(req), body.elapsedSeconds, sentence.rows[0].remaining_seconds]);
            return { ...sentence.rows[0], paused: true, message: 'Prison timer paused because the player is offline.' };
        }
        const applied = Math.min(body.elapsedSeconds, Number(sentence.rows[0].remaining_seconds));
        const updated = await client.query(`UPDATE jail_sentences
       SET remaining_seconds=GREATEST(0, remaining_seconds-$1),
           active=(remaining_seconds-$1 > 0),
           released_at=CASE WHEN remaining_seconds-$1 <= 0 THEN now() ELSE released_at END,
           last_tick_at=now(),
           last_online_tick_at=now()
       WHERE id=$2
       RETURNING *`, [applied, sentence.rows[0].id]);
        await client.query('INSERT INTO jail_tick_logs(sentence_id, character_id, server_id, requested_elapsed_seconds, applied_elapsed_seconds, was_online, remaining_seconds) VALUES($1,$2,$3,$4,$5,true,$6)', [sentence.rows[0].id, body.characterId, serverId(req), body.elapsedSeconds, applied, updated.rows[0].remaining_seconds]);
        return { ...updated.rows[0], paused: false, appliedElapsedSeconds: applied };
    });
    res.json(row);
}
app.post('/v1/jail/tick', asyncRoute(handleJailOnlineTick));
app.post('/v1/jail/tick-online', asyncRoute(handleJailOnlineTick));
app.post('/v1/jail/reduce', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ characterId: uuid, jobKey: z.enum(['laundry', 'kitchen', 'yard', 'cleaning']), workUnits: z.number().int().min(1).max(5).default(1) }).parse(req.body);
    const row = await tx(async (client) => {
        await requireSelfOrAdmin(client, body.actorCharacterId, body.characterId, 'Prison job');
        const sentence = await client.query('SELECT * FROM jail_sentences WHERE character_id=$1 AND active=true FOR UPDATE', [body.characterId]);
        if (!sentence.rows[0])
            throw new HttpError(404, 'No active sentence', 'no_active_sentence');
        const recent = await client.query(`SELECT id FROM prison_job_logs WHERE character_id=$1 AND job_key=$2 AND created_at > now() - ($3::text)::interval LIMIT 1`, [body.characterId, body.jobKey, `${prisonJobCooldownSeconds} seconds`]);
        if (recent.rows[0])
            throw new HttpError(429, 'Prison job cooldown active', 'job_cooldown');
        const reductionMap = { laundry: 120, kitchen: 180, yard: 90, cleaning: 150 };
        const reduction = reductionMap[body.jobKey] * body.workUnits;
        const upd = await client.query(`UPDATE jail_sentences SET remaining_seconds=GREATEST(0, remaining_seconds-$1), active=(remaining_seconds-$1 > 0), released_at=CASE WHEN remaining_seconds-$1 <= 0 THEN now() ELSE released_at END WHERE id=$2 RETURNING *`, [reduction, sentence.rows[0].id]);
        await client.query('INSERT INTO prison_job_logs(sentence_id, character_id, job_key, reduction_seconds) VALUES($1,$2,$3,$4)', [sentence.rows[0].id, body.characterId, body.jobKey, reduction]);
        await audit(client, 'prison_job_reduce', body.actorCharacterId ?? null, body.characterId, { jobKey: body.jobKey, reductionSeconds: reduction });
        return upd.rows[0];
    });
    res.json(row);
}));
app.post('/v1/ems/injury', asyncRoute(async (req, res) => {
    const body = z.object({
        characterId: uuid,
        injuryType: z.string().min(2).max(64).optional(),
        injuryKind: injuryKindSchema.default('minor_injury'),
        bodyPart: bodyPartSchema,
        severity: z.number().int().min(1).max(5),
        bleedingLevel: z.number().int().min(0).max(5).default(0),
        painLevel: z.number().int().min(0).max(10).default(3),
        mobilityImpact: z.number().int().min(0).max(5).default(0),
        consciousnessImpact: z.number().int().min(0).max(5).default(0)
    }).parse(req.body);
    const kind = body.injuryType ?? body.injuryKind;
    const row = await one(`INSERT INTO injuries(character_id, injury_type, injury_kind, body_part, severity, bleeding_level, pain_level, mobility_impact, consciousness_impact, active)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true) RETURNING *`, [body.characterId, kind, body.injuryKind, body.bodyPart, body.severity, body.bleedingLevel, body.painLevel, body.mobilityImpact, body.consciousnessImpact]);
    res.json(row);
}));
app.post('/v1/ems/injuries/add-multiple', asyncRoute(async (req, res) => {
    const body = z.object({
        actorCharacterId: uuid.optional(),
        characterId: uuid,
        cause: z.string().min(2).max(120).default('unknown'),
        injuries: z.array(z.object({
            injuryKind: injuryKindSchema,
            bodyPart: bodyPartSchema,
            severity: z.number().int().min(1).max(5),
            bleedingLevel: z.number().int().min(0).max(5).default(0),
            painLevel: z.number().int().min(0).max(10).default(3),
            mobilityImpact: z.number().int().min(0).max(5).default(0),
            consciousnessImpact: z.number().int().min(0).max(5).default(0),
            notes: z.string().max(240).optional()
        })).min(1).max(8)
    }).parse(req.body);
    const result = await tx(async (client) => {
        const rows = [];
        for (const i of body.injuries) {
            const inserted = await client.query(`INSERT INTO injuries(character_id, injury_type, injury_kind, body_part, severity, bleeding_level, pain_level, mobility_impact, consciousness_impact, notes, active)
         VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,true) RETURNING *`, [body.characterId, i.injuryKind, i.bodyPart, i.severity, i.bleedingLevel, i.painLevel, i.mobilityImpact, i.consciousnessImpact, i.notes ?? null]);
            rows.push(inserted.rows[0]);
        }
        await audit(client, 'injury_layers_added', body.actorCharacterId ?? null, body.characterId, { cause: body.cause, count: rows.length });
        return { characterId: body.characterId, activeInjuries: rows };
    });
    res.json(result);
}));
app.get('/v1/ems/injuries/active/:characterId', asyncRoute(async (req, res) => {
    const rows = await many(`SELECT * FROM injuries
     WHERE character_id=$1 AND active=true AND treated=false
     ORDER BY severity DESC, created_at DESC`, [req.params.characterId]);
    const summary = {
        total: rows.length,
        hasOpenWounds: rows.some((r) => r.injury_kind === 'open_wound'),
        hasBrokenBones: rows.some((r) => r.injury_kind === 'broken_bone'),
        hasConcussion: rows.some((r) => r.injury_kind === 'concussion'),
        maxSeverity: rows.reduce((m, r) => Math.max(m, Number(r.severity ?? 0)), 0),
        bleedingLevel: rows.reduce((m, r) => m + Number(r.bleeding_level ?? 0), 0)
    };
    res.json({ characterId: req.params.characterId, summary, injuries: rows });
}));
app.post('/v1/ems/injuries/treat-layer', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({
        injuryId: uuid,
        treatmentType: z.enum(['bandage', 'splint', 'pain_relief', 'concussion_check', 'stitch', 'full_treatment']).default('full_treatment')
    }).parse(req.body);
    const row = await tx(async (client) => {
        await requireOnDutyRole(client, req, body.actorCharacterId, 'ems', 'Treat layered injury');
        const injury = await client.query('SELECT * FROM injuries WHERE id=$1 FOR UPDATE', [body.injuryId]);
        if (!injury.rows[0])
            throw new HttpError(404, 'Injury not found', 'injury_not_found');
        const i = injury.rows[0];
        const treatmentMatches = body.treatmentType === 'full_treatment' ||
            (body.treatmentType === 'bandage' && i.injury_kind === 'open_wound') ||
            (body.treatmentType === 'splint' && (i.injury_kind === 'broken_bone' || i.injury_kind === 'sprain')) ||
            (body.treatmentType === 'concussion_check' && i.injury_kind === 'concussion') ||
            (body.treatmentType === 'stitch' && i.injury_kind === 'open_wound') ||
            (body.treatmentType === 'pain_relief');
        const treated = treatmentMatches || Number(i.severity) <= 2;
        const result = await client.query(`UPDATE injuries SET
         treated=$1,
         active=NOT $1,
         treated_by=$2,
         treated_at=CASE WHEN $1 THEN now() ELSE treated_at END,
         severity=CASE WHEN $1 THEN severity ELSE GREATEST(1, severity - 1) END,
         bleeding_level=GREATEST(0, bleeding_level - CASE WHEN $3 IN ('bandage','stitch','full_treatment') THEN 3 ELSE 1 END),
         pain_level=GREATEST(0, pain_level - CASE WHEN $3 IN ('pain_relief','full_treatment') THEN 4 ELSE 1 END),
         treatment_log=treatment_log || jsonb_build_array(jsonb_build_object('at', now(), 'by', $2, 'type', $3))
       WHERE id=$4 RETURNING *`, [treated, body.actorCharacterId ?? null, body.treatmentType, body.injuryId]);
        await audit(client, 'injury_layer_treated', body.actorCharacterId ?? null, result.rows[0].character_id, { injuryId: body.injuryId, treatmentType: body.treatmentType, fullyTreated: treated });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/ems/treat', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ injuryId: uuid }).parse(req.body);
    const row = await tx(async (client) => {
        await requireOnDutyRole(client, req, body.actorCharacterId, 'ems', 'Treat injury');
        const result = await client.query('UPDATE injuries SET treated=true, treated_by=$1, treated_at=now() WHERE id=$2 RETURNING *', [body.actorCharacterId ?? null, body.injuryId]);
        if (!result.rows[0])
            throw new HttpError(404, 'Injury not found', 'injury_not_found');
        await audit(client, 'ems_treat', body.actorCharacterId ?? null, result.rows[0].character_id, { injuryId: body.injuryId });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/ems/admit', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ characterId: uuid, reason: z.string().min(2).max(200) }).parse(req.body);
    const row = await tx(async (client) => {
        await requireOnDutyRole(client, req, body.actorCharacterId, 'ems', 'Hospital admission');
        await ensureIdempotent(client, req, 'ems/admit');
        const result = await client.query('INSERT INTO hospital_admissions(character_id, admitted_by, reason) VALUES($1,$2,$3) RETURNING *', [body.characterId, body.actorCharacterId ?? null, body.reason]);
        await audit(client, 'hospital_admit', body.actorCharacterId ?? null, body.characterId, { reason: body.reason });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/fire/start', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ incidentKey: z.string().min(3).max(80), x: z.number(), y: z.number(), z: z.number(), heat: z.number().min(10).max(1000).default(100) }).parse(req.body);
    const row = await tx(async (client) => {
        if (body.actorCharacterId)
            await requireActorRole(client, body.actorCharacterId, ['fire', 'admin'], 'Start fire incident');
        const active = await client.query('SELECT count(*)::int AS count FROM fire_incidents WHERE active=true');
        if (Number(active.rows[0]?.count ?? 0) >= maxActiveFires)
            throw new HttpError(429, 'Too many active fires for console-safe performance', 'too_many_fires');
        const result = await client.query(`INSERT INTO fire_incidents(incident_key, world_x, world_y, world_z, heat)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(incident_key) DO UPDATE SET active=true, heat=EXCLUDED.heat, started_at=now(), extinguished_at=NULL
       RETURNING *`, [body.incidentKey, body.x, body.y, body.z, body.heat]);
        await audit(client, 'fire_start', body.actorCharacterId ?? null, null, { incidentKey: body.incidentKey, heat: body.heat });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/fire/apply-water', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ incidentKey: z.string().min(3).max(80), waterLitres: z.number().min(0.1).max(250), foamMultiplier: z.number().min(1).max(3).default(1) }).parse(req.body);
    const row = await tx(async (client) => {
        if (body.actorCharacterId)
            await requireActorRole(client, body.actorCharacterId, ['fire', 'admin'], 'Apply water');
        const delta = body.waterLitres * 0.8 * body.foamMultiplier;
        const result = await client.query(`UPDATE fire_incidents
       SET heat=GREATEST(0, heat-$1), active=(heat-$1 > 0), extinguished_at=CASE WHEN heat-$1 <= 0 THEN now() ELSE extinguished_at END
       WHERE incident_key=$2 AND active=true
       RETURNING *`, [delta, body.incidentKey]);
        if (!result.rows[0])
            return { active: false, incidentKey: body.incidentKey };
        await client.query('INSERT INTO fire_water_logs(incident_key, actor_character_id, water_litres, foam_multiplier, heat_removed) VALUES($1,$2,$3,$4,$5)', [body.incidentKey, body.actorCharacterId ?? null, body.waterLitres, body.foamMultiplier, delta]);
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/property/buy', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ characterId: uuid, propertyKey: z.string().min(2).max(64) }).parse(req.body);
    const row = await tx(async (client) => {
        await requireSelfOrAdmin(client, body.actorCharacterId, body.characterId, 'Buy property');
        await ensureIdempotent(client, req, 'property/buy');
        const prop = await client.query('SELECT * FROM properties WHERE property_key=$1 FOR UPDATE', [body.propertyKey]);
        if (!prop.rows[0])
            throw new HttpError(404, 'Property not found', 'property_not_found');
        if (prop.rows[0].owner_character_id)
            throw new HttpError(409, 'Already owned', 'property_owned');
        const bal = await client.query('SELECT bank_cents FROM characters WHERE id=$1 FOR UPDATE', [body.characterId]);
        if (!bal.rows[0] || Number(bal.rows[0].bank_cents) < Number(prop.rows[0].price_cents))
            throw new HttpError(400, 'Insufficient bank', 'insufficient_funds');
        await client.query('UPDATE characters SET bank_cents=bank_cents-$1, updated_at=now() WHERE id=$2', [prop.rows[0].price_cents, body.characterId]);
        const upd = await client.query('UPDATE properties SET owner_character_id=$1 WHERE property_key=$2 RETURNING *', [body.characterId, body.propertyKey]);
        if (upd.rows[0].property_type === 'shop') {
            await client.query('INSERT INTO business_accounts(property_id, owner_character_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [upd.rows[0].id, body.characterId]);
        }
        await audit(client, 'property_buy', body.actorCharacterId ?? null, body.characterId, { propertyKey: body.propertyKey, priceCents: prop.rows[0].price_cents });
        return upd.rows[0];
    });
    res.json(row);
}));
app.post('/v1/vehicles/register', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ ownerCharacterId: uuid, plate: z.string().min(2).max(12), prefabResource: z.string().min(3).max(240), displayName: z.string().min(1).max(80), isTowTruck: z.boolean().default(false), isTaxi: z.boolean().default(false) }).parse(req.body);
    const row = await tx(async (client) => {
        await requireSelfOrAdmin(client, body.actorCharacterId, body.ownerCharacterId, 'Register vehicle');
        const result = await client.query('INSERT INTO vehicles(owner_character_id, plate, prefab_resource, display_name, is_tow_truck, is_taxi) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [body.ownerCharacterId, body.plate.toUpperCase(), body.prefabResource, body.displayName, body.isTowTruck, body.isTaxi]);
        await audit(client, 'vehicle_register', body.actorCharacterId ?? null, body.ownerCharacterId, { plate: body.plate.toUpperCase() });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/vehicles/garage/store', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ vehicleId: uuid, garageKey: z.string().min(2).max(64), fuelLitres: z.number().min(0).max(500).optional(), damagePercent: z.number().min(0).max(100).optional() }).parse(req.body);
    const row = await tx(async (client) => {
        const v = await client.query('SELECT owner_character_id FROM vehicles WHERE id=$1 FOR UPDATE', [body.vehicleId]);
        if (!v.rows[0])
            throw new HttpError(404, 'Vehicle not found', 'vehicle_not_found');
        await requireSelfOrAdmin(client, body.actorCharacterId, v.rows[0].owner_character_id, 'Store vehicle');
        const result = await client.query('UPDATE vehicles SET stored=true, garage_key=$1, last_garage_key=$1, loaded_on_vehicle_id=NULL, fuel_litres=COALESCE($2,fuel_litres), damage_percent=COALESCE($3,damage_percent), updated_at=now() WHERE id=$4 RETURNING *', [body.garageKey, body.fuelLitres ?? null, body.damagePercent ?? null, body.vehicleId]);
        await audit(client, 'vehicle_store', body.actorCharacterId ?? null, v.rows[0].owner_character_id, { vehicleId: body.vehicleId, garageKey: body.garageKey });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/vehicles/garage/spawn', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ vehicleId: uuid, x: z.number(), y: z.number(), z: z.number() }).parse(req.body);
    const row = await tx(async (client) => {
        const v = await client.query('SELECT owner_character_id, stored FROM vehicles WHERE id=$1 FOR UPDATE', [body.vehicleId]);
        if (!v.rows[0])
            throw new HttpError(404, 'Vehicle not found', 'vehicle_not_found');
        await requireSelfOrAdmin(client, body.actorCharacterId, v.rows[0].owner_character_id, 'Spawn vehicle');
        const spawned = await client.query('SELECT count(*)::int AS count FROM vehicles WHERE owner_character_id=$1 AND stored=false', [v.rows[0].owner_character_id]);
        if (Number(spawned.rows[0]?.count ?? 0) >= maxSpawnedVehiclesPerCharacter)
            throw new HttpError(429, 'Spawned vehicle limit reached', 'vehicle_spawn_limit');
        const result = await client.query('UPDATE vehicles SET stored=false, garage_key=NULL, world_x=$1, world_y=$2, world_z=$3, updated_at=now() WHERE id=$4 RETURNING *', [body.x, body.y, body.z, body.vehicleId]);
        await audit(client, 'vehicle_spawn', body.actorCharacterId ?? null, v.rows[0].owner_character_id, { vehicleId: body.vehicleId });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/vehicles/state-sync', asyncRoute(async (req, res) => {
    const body = z.object({
        states: z.array(z.object({
            vehicleId: uuid,
            fuelLitres: z.number().min(0).max(500).optional(),
            damagePercent: z.number().min(0).max(100).optional(),
            x: z.number().optional(), y: z.number().optional(), z: z.number().optional()
        })).min(1).max(64)
    }).parse(req.body);
    const result = await tx(async (client) => {
        const updated = [];
        for (const s of body.states) {
            const row = await client.query(`UPDATE vehicles SET
           fuel_litres=COALESCE($1,fuel_litres),
           damage_percent=COALESCE($2,damage_percent),
           world_x=COALESCE($3,world_x), world_y=COALESCE($4,world_y), world_z=COALESCE($5,world_z),
           updated_at=now()
         WHERE id=$6 RETURNING id, fuel_litres, damage_percent`, [s.fuelLitres ?? null, s.damagePercent ?? null, s.x ?? null, s.y ?? null, s.z ?? null, s.vehicleId]);
            if (row.rows[0])
                updated.push(row.rows[0]);
        }
        await audit(client, 'vehicle_state_sync', null, null, { count: updated.length });
        return { updated };
    });
    res.json(result);
}));
app.post('/v1/vehicles/refuel', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ characterId: uuid, vehicleId: uuid, gasStationKey: z.string().min(2).max(64), litres: z.number().min(1).max(120), payWith: z.enum(['cash', 'bank']).default('bank') }).parse(req.body);
    const row = await tx(async (client) => {
        await requireSelfOrAdmin(client, body.actorCharacterId, body.characterId, 'Refuel vehicle');
        await ensureIdempotent(client, req, 'vehicles/refuel');
        const station = await client.query('SELECT * FROM gas_station_locations WHERE station_key=$1 AND active=true', [body.gasStationKey]);
        if (!station.rows[0])
            throw new HttpError(404, 'Gas station not found or inactive', 'gas_station_not_found');
        const price = Number(station.rows[0].price_per_litre_cents ?? 220);
        const total = Math.round(price * body.litres);
        const col = body.payWith === 'cash' ? 'cash_cents' : 'bank_cents';
        const bal = await client.query(`SELECT ${col} AS balance FROM characters WHERE id=$1 FOR UPDATE`, [body.characterId]);
        if (!bal.rows[0] || Number(bal.rows[0].balance) < total)
            throw new HttpError(400, 'Insufficient funds', 'insufficient_funds');
        await client.query(`UPDATE characters SET ${col}=${col}-$1, updated_at=now() WHERE id=$2`, [total, body.characterId]);
        const vehicle = await client.query('UPDATE vehicles SET fuel_litres=LEAST(max_fuel_litres, fuel_litres+$1), updated_at=now() WHERE id=$2 RETURNING *', [body.litres, body.vehicleId]);
        await client.query('INSERT INTO transactions(from_character_id,tx_type,amount_cents,note) VALUES($1,$2,$3,$4)', [body.characterId, 'fuel_purchase', total, `${body.gasStationKey}:${body.vehicleId}`]);
        await audit(client, 'vehicle_refuel_at_gas_station', body.actorCharacterId ?? null, body.characterId, { vehicleId: body.vehicleId, gasStationKey: body.gasStationKey, litres: body.litres, total });
        return { vehicle: vehicle.rows[0], station: station.rows[0], litres: body.litres, totalCents: total, paidWith: body.payWith };
    });
    res.json(row);
}));
app.post('/v1/mechanic/repair', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({
        mechanicCharacterId: uuid,
        vehicleId: uuid,
        repairStationKey: z.string().min(2).max(64),
        repairPercent: z.number().min(1).max(100),
        chargeCents: z.number().int().min(0).max(500000).default(0),
        paidByCharacterId: uuid.optional()
    }).parse(req.body);
    const row = await tx(async (client) => {
        await requireSelfOrAdmin(client, body.actorCharacterId, body.mechanicCharacterId, 'Mechanic repair');
        await ensureIdempotent(client, req, 'mechanic/repair');
        const station = await client.query('SELECT * FROM vehicle_repair_stations WHERE station_key=$1 AND active=true', [body.repairStationKey]);
        if (!station.rows[0])
            throw new HttpError(404, 'Vehicle repair station not found or inactive', 'repair_station_not_found');
        const canRepair = await client.query("SELECT id FROM licences WHERE character_id=$1 AND licence_type='mechanic' AND status='valid'", [body.mechanicCharacterId]);
        const character = await client.query('SELECT job_key FROM characters WHERE id=$1', [body.mechanicCharacterId]);
        if (!canRepair.rows[0] && character.rows[0]?.job_key !== 'mechanic') {
            throw new HttpError(403, 'Mechanic licence or mechanic job required', 'missing_mechanic_permission');
        }
        if (!(await hasInventoryItem(client, body.mechanicCharacterId, 'wrench', 1))) {
            throw new HttpError(403, 'A wrench is required to repair vehicles', 'missing_wrench');
        }
        if (body.chargeCents > 0 && body.paidByCharacterId) {
            const bal = await client.query('SELECT bank_cents FROM characters WHERE id=$1 FOR UPDATE', [body.paidByCharacterId]);
            if (!bal.rows[0] || Number(bal.rows[0].bank_cents) < body.chargeCents)
                throw new HttpError(400, 'Customer has insufficient bank', 'insufficient_funds');
            await client.query('UPDATE characters SET bank_cents=bank_cents-$1, updated_at=now() WHERE id=$2', [body.chargeCents, body.paidByCharacterId]);
            await client.query('UPDATE characters SET bank_cents=bank_cents+$1, updated_at=now() WHERE id=$2', [body.chargeCents, body.mechanicCharacterId]);
            await client.query('INSERT INTO transactions(from_character_id,to_character_id,tx_type,amount_cents,note) VALUES($1,$2,$3,$4,$5)', [body.paidByCharacterId, body.mechanicCharacterId, 'mechanic_repair', body.chargeCents, body.vehicleId]);
        }
        const vehicle = await client.query('UPDATE vehicles SET damage_percent=GREATEST(0, damage_percent-$1), updated_at=now() WHERE id=$2 RETURNING *', [body.repairPercent, body.vehicleId]);
        if (!vehicle.rows[0])
            throw new HttpError(404, 'Vehicle not found', 'vehicle_not_found');
        await audit(client, 'mechanic_repair_at_station', body.actorCharacterId ?? null, body.mechanicCharacterId, { vehicleId: body.vehicleId, stationKey: body.repairStationKey, repairPercent: body.repairPercent, chargeCents: body.chargeCents });
        return { vehicle: vehicle.rows[0], station: station.rows[0], chargedCents: body.chargeCents, requiredItem: 'wrench' };
    });
    res.json(row);
}));
app.post('/v1/tow/load', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({
        actorCharacterId: uuid,
        towTruckVehicleId: uuid,
        targetVehicleId: uuid
    }).parse(req.body);
    const row = await tx(async (client) => {
        await ensureIdempotent(client, req, 'tow/load');
        const staffTow = await hasAnyRole(client, body.actorCharacterId, STAFF_ROLES);
        const actor = await client.query('SELECT job_key FROM characters WHERE id=$1', [body.actorCharacterId]);
        const towLicence = await client.query("SELECT id FROM licences WHERE character_id=$1 AND licence_type='mechanic' AND status='valid'", [body.actorCharacterId]);
        if (!staffTow && actor.rows[0]?.job_key !== 'tow' && actor.rows[0]?.job_key !== 'mechanic' && !towLicence.rows[0]) {
            throw new HttpError(403, 'Tow or mechanic job/licence required to load vehicles', 'missing_tow_permission');
        }
        const towTruck = await client.query('SELECT * FROM vehicles WHERE id=$1 FOR UPDATE', [body.towTruckVehicleId]);
        const target = await client.query('SELECT * FROM vehicles WHERE id=$1 FOR UPDATE', [body.targetVehicleId]);
        if (!towTruck.rows[0])
            throw new HttpError(404, 'Tow truck not found', 'tow_truck_not_found');
        if (!target.rows[0])
            throw new HttpError(404, 'Target vehicle not found', 'target_vehicle_not_found');
        if (!towTruck.rows[0].is_tow_truck)
            throw new HttpError(400, 'Selected vehicle is not a tow truck', 'not_tow_truck');
        if (body.towTruckVehicleId === body.targetVehicleId)
            throw new HttpError(400, 'Cannot tow-load the same vehicle', 'same_vehicle');
        if (target.rows[0].loaded_on_vehicle_id)
            throw new HttpError(409, 'Target vehicle is already loaded', 'vehicle_already_loaded');
        const updated = await client.query(`UPDATE vehicles SET loaded_on_vehicle_id=$1, loaded_by_character_id=$2, loaded_at=now(), stored=false, updated_at=now()
       WHERE id=$3 RETURNING *`, [body.towTruckVehicleId, body.actorCharacterId, body.targetVehicleId]);
        await client.query('INSERT INTO tow_events(tow_truck_vehicle_id,target_vehicle_id,actor_character_id,event_type,metadata) VALUES($1,$2,$3,$4,$5)', [body.towTruckVehicleId, body.targetVehicleId, body.actorCharacterId, 'load', {}]);
        await audit(client, 'tow_vehicle_load', body.actorCharacterId, target.rows[0].owner_character_id ?? null, { towTruckVehicleId: body.towTruckVehicleId, targetVehicleId: body.targetVehicleId });
        return updated.rows[0];
    });
    res.json(row);
}));
app.post('/v1/tow/unload', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({
        actorCharacterId: uuid,
        targetVehicleId: uuid,
        x: z.number(),
        y: z.number(),
        z: z.number()
    }).parse(req.body);
    const row = await tx(async (client) => {
        await ensureIdempotent(client, req, 'tow/unload');
        const staffTow = await hasAnyRole(client, body.actorCharacterId, STAFF_ROLES);
        const actor = await client.query('SELECT job_key FROM characters WHERE id=$1', [body.actorCharacterId]);
        const towLicence = await client.query("SELECT id FROM licences WHERE character_id=$1 AND licence_type='mechanic' AND status='valid'", [body.actorCharacterId]);
        if (!staffTow && actor.rows[0]?.job_key !== 'tow' && actor.rows[0]?.job_key !== 'mechanic' && !towLicence.rows[0]) {
            throw new HttpError(403, 'Tow or mechanic job/licence required to unload vehicles', 'missing_tow_permission');
        }
        const target = await client.query('SELECT * FROM vehicles WHERE id=$1 FOR UPDATE', [body.targetVehicleId]);
        if (!target.rows[0])
            throw new HttpError(404, 'Target vehicle not found', 'target_vehicle_not_found');
        if (!target.rows[0].loaded_on_vehicle_id)
            throw new HttpError(409, 'Vehicle is not loaded on a tow truck', 'vehicle_not_loaded');
        const towTruckId = target.rows[0].loaded_on_vehicle_id;
        const updated = await client.query(`UPDATE vehicles SET loaded_on_vehicle_id=NULL, loaded_by_character_id=NULL, loaded_at=NULL,
        world_x=$1, world_y=$2, world_z=$3, stored=false, updated_at=now()
       WHERE id=$4 RETURNING *`, [body.x, body.y, body.z, body.targetVehicleId]);
        await client.query('INSERT INTO tow_events(tow_truck_vehicle_id,target_vehicle_id,actor_character_id,event_type,metadata) VALUES($1,$2,$3,$4,$5)', [towTruckId, body.targetVehicleId, body.actorCharacterId, 'unload', { x: body.x, y: body.y, z: body.z }]);
        await audit(client, 'tow_vehicle_unload', body.actorCharacterId, target.rows[0].owner_character_id ?? null, { towTruckVehicleId: towTruckId, targetVehicleId: body.targetVehicleId });
        return updated.rows[0];
    });
    res.json(row);
}));
app.post('/v1/robberies/can-start', asyncRoute(async (req, res) => {
    const body = z.object({ robberyType: z.enum(['bank', 'store']) }).parse(req.body);
    const min = body.robberyType === 'bank' ? Number(process.env.MIN_POLICE_BANK_ROBBERY ?? 4) : Number(process.env.MIN_POLICE_STORE_ROBBERY ?? 2);
    const policeOnline = await activeDutyCount('police');
    res.json({ canStart: policeOnline >= min, policeOnline, minimumRequired: min });
}));
app.post('/v1/robberies/start', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ robberyKey: z.string().min(2).max(64), robberyType: z.enum(['bank', 'store']), startedBy: uuid }).parse(req.body);
    const row = await tx(async (client) => {
        await requireSelfOrAdmin(client, body.actorCharacterId, body.startedBy, 'Start robbery');
        await ensureIdempotent(client, req, 'robberies/start');
        const min = body.robberyType === 'bank' ? Number(process.env.MIN_POLICE_BANK_ROBBERY ?? 4) : Number(process.env.MIN_POLICE_STORE_ROBBERY ?? 2);
        const policeOnline = await activeDutyCount('police');
        if (policeOnline < min)
            throw new HttpError(403, 'Not enough police online', 'not_enough_police');
        const recent = await client.query(`SELECT id FROM robberies WHERE robbery_key=$1 AND started_at > now() - ($2::text)::interval AND status IN ('active','completed') LIMIT 1`, [body.robberyKey, `${robberyCooldownSeconds} seconds`]);
        if (recent.rows[0])
            throw new HttpError(429, 'Robbery cooldown active', 'robbery_cooldown');
        const result = await client.query('INSERT INTO robberies(robbery_key, robbery_type, started_by, min_police_required, police_online_at_start) VALUES($1,$2,$3,$4,$5) RETURNING *', [body.robberyKey, body.robberyType, body.startedBy, min, policeOnline]);
        await client.query('INSERT INTO cad_reports(report_type, subject_character_id, created_by, title, body) VALUES($1,$2,$3,$4,$5)', ['incident', body.startedBy, null, `Active ${body.robberyType} robbery`, `Alarm triggered at ${body.robberyKey}. Police online: ${policeOnline}`]);
        await audit(client, 'robbery_start', body.actorCharacterId ?? null, body.startedBy, { robberyKey: body.robberyKey, robberyType: body.robberyType, policeOnline, min });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/robberies/complete', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ robberyId: uuid }).parse(req.body);
    const row = await tx(async (client) => {
        const r = await client.query('SELECT * FROM robberies WHERE id=$1 AND status=$2 FOR UPDATE', [body.robberyId, 'active']);
        if (!r.rows[0])
            throw new HttpError(404, 'Active robbery not found', 'robbery_not_found');
        await requireSelfOrAdmin(client, body.actorCharacterId, r.rows[0].started_by, 'Complete robbery');
        const payout = r.rows[0].robbery_type === 'bank' ? Number(process.env.BANK_ROBBERY_PAYOUT_CENTS ?? 500000) : Number(process.env.STORE_ROBBERY_PAYOUT_CENTS ?? 75000);
        await client.query('UPDATE characters SET cash_cents=cash_cents+$1 WHERE id=$2', [payout, r.rows[0].started_by]);
        const result = await client.query('UPDATE robberies SET status=$1, payout_cents=$2, finished_at=now() WHERE id=$3 RETURNING *', ['completed', payout, body.robberyId]);
        await audit(client, 'robbery_complete', body.actorCharacterId ?? null, r.rows[0].started_by, { payout });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/jobs/paycheck', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ characterId: uuid, jobKey: z.string().min(2).max(64), workUnits: z.number().int().min(1).max(50).default(1) }).parse(req.body);
    const row = await tx(async (client) => {
        await requireSelfOrAdmin(client, body.actorCharacterId, body.characterId, 'Job paycheck');
        await ensureIdempotent(client, req, 'jobs/paycheck');
        const def = await client.query('SELECT * FROM job_definitions WHERE job_key=$1 AND whitelisted=false AND active=true', [body.jobKey]);
        if (!def.rows[0])
            throw new HttpError(404, 'Civilian job not available', 'job_not_available');
        const payout = Math.min(Number(def.rows[0].max_payout_cents), Number(def.rows[0].payout_per_unit_cents) * body.workUnits);
        await client.query('UPDATE characters SET bank_cents=bank_cents+$1, job_key=$2, updated_at=now() WHERE id=$3', [payout, body.jobKey, body.characterId]);
        const job = await client.query('INSERT INTO job_sessions(character_id, job_key, status, payout_cents, finished_at, work_units) VALUES($1,$2,$3,$4,now(),$5) RETURNING *', [body.characterId, body.jobKey, 'completed', payout, body.workUnits]);
        await client.query('INSERT INTO transactions(to_character_id,tx_type,amount_cents,note) VALUES($1,$2,$3,$4)', [body.characterId, 'job_paycheck', payout, body.jobKey]);
        await audit(client, 'job_paycheck', body.actorCharacterId ?? null, body.characterId, { jobKey: body.jobKey, workUnits: body.workUnits, payout });
        return job.rows[0];
    });
    res.json(row);
}));
app.post('/v1/taxi/start', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ driverCharacterId: uuid, passengerCharacterId: uuid.optional(), vehicleId: uuid, x: z.number(), y: z.number(), z: z.number() }).parse(req.body);
    const row = await tx(async (client) => {
        await requireSelfOrAdmin(client, body.actorCharacterId, body.driverCharacterId, 'Start taxi fare');
        await ensureIdempotent(client, req, 'taxi/start');
        const lic = await client.query("SELECT id FROM licences WHERE character_id=$1 AND licence_type='taxi' AND status='valid'", [body.driverCharacterId]);
        const ch = await client.query('SELECT job_key FROM characters WHERE id=$1', [body.driverCharacterId]);
        if (!lic.rows[0] && ch.rows[0]?.job_key !== 'taxi')
            throw new HttpError(403, 'Taxi licence or taxi job required', 'missing_taxi_permission');
        const taxiVehicle = await client.query('SELECT id, is_taxi, display_name FROM vehicles WHERE id=$1', [body.vehicleId]);
        if (!taxiVehicle.rows[0])
            throw new HttpError(404, 'Taxi vehicle not found', 'vehicle_not_found');
        if (!taxiVehicle.rows[0].is_taxi)
            throw new HttpError(403, 'Taxi meter can only be started inside a vehicle marked as a taxi', 'not_taxi_vehicle');
        const result = await client.query('INSERT INTO taxi_sessions(driver_character_id, passenger_character_id, vehicle_id, start_x, start_y, start_z, last_sync_at) VALUES($1,$2,$3,$4,$5,$6,now()) RETURNING *', [body.driverCharacterId, body.passengerCharacterId ?? null, body.vehicleId, body.x, body.y, body.z]);
        await audit(client, 'taxi_start_in_taxi_vehicle', body.actorCharacterId ?? null, body.driverCharacterId, { passengerCharacterId: body.passengerCharacterId, vehicleId: body.vehicleId });
        return { session: result.rows[0], vehicle: taxiVehicle.rows[0] };
    });
    res.json(row);
}));
app.post('/v1/taxi/sync', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ sessionId: uuid, addedMetres: z.number().min(0).max(5000) }).parse(req.body);
    const fareAdd = Math.round(body.addedMetres * Number(process.env.TAXI_CENTS_PER_METRE ?? 6));
    const row = await tx(async (client) => {
        const s = await client.query('SELECT * FROM taxi_sessions WHERE id=$1 AND active=true FOR UPDATE', [body.sessionId]);
        if (!s.rows[0])
            throw new HttpError(404, 'Taxi session not active', 'taxi_not_active');
        await requireSelfOrAdmin(client, body.actorCharacterId, s.rows[0].driver_character_id, 'Sync taxi fare');
        const result = await client.query('UPDATE taxi_sessions SET distance_metres=distance_metres+$1, fare_cents=fare_cents+$2, last_sync_at=now() WHERE id=$3 AND active=true RETURNING *', [body.addedMetres, fareAdd, body.sessionId]);
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/taxi/end', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ sessionId: uuid, paidByCharacterId: uuid.optional(), payWith: z.enum(['cash', 'bank']).default('bank') }).parse(req.body);
    const row = await tx(async (client) => {
        const s = await client.query('SELECT * FROM taxi_sessions WHERE id=$1 AND active=true FOR UPDATE', [body.sessionId]);
        if (!s.rows[0])
            throw new HttpError(404, 'Taxi session not active', 'taxi_not_active');
        await requireSelfOrAdmin(client, body.actorCharacterId, s.rows[0].driver_character_id, 'End taxi fare');
        if (body.paidByCharacterId) {
            const col = body.payWith === 'cash' ? 'cash_cents' : 'bank_cents';
            const bal = await client.query(`SELECT ${col} AS balance FROM characters WHERE id=$1 FOR UPDATE`, [body.paidByCharacterId]);
            if (!bal.rows[0] || Number(bal.rows[0].balance) < Number(s.rows[0].fare_cents))
                throw new HttpError(400, 'Passenger has insufficient funds', 'insufficient_funds');
            await client.query(`UPDATE characters SET ${col}=${col}-$1 WHERE id=$2`, [s.rows[0].fare_cents, body.paidByCharacterId]);
            await client.query('UPDATE characters SET bank_cents=bank_cents+$1 WHERE id=$2', [s.rows[0].fare_cents, s.rows[0].driver_character_id]);
        }
        const upd = await client.query('UPDATE taxi_sessions SET active=false, ended_at=now() WHERE id=$1 RETURNING *', [body.sessionId]);
        await audit(client, 'taxi_end', body.actorCharacterId ?? null, s.rows[0].driver_character_id, { fareCents: s.rows[0].fare_cents, paidByCharacterId: body.paidByCharacterId });
        return upd.rows[0];
    });
    res.json(row);
}));
// -----------------------------------------------------------------------------
// V3 placeable map systems
// These endpoints let admins/GMs register Workbench-placed items by key. The in-game
// components call these keys from prompts; no player text commands are required.
// -----------------------------------------------------------------------------
app.post('/v1/world/repair-stations/upsert', asyncRoute(async (req, res) => {
    const body = z.object({ actorCharacterId: uuid, stationKey: z.string().min(2).max(64), displayName: z.string().min(1).max(80), x: z.number(), y: z.number(), z: z.number(), radiusMetres: z.number().min(1).max(50).default(8), active: z.boolean().default(true) }).parse(req.body);
    const row = await tx(async (client) => {
        await requireActorRole(client, body.actorCharacterId, STAFF_ROLES, 'Place repair station');
        const result = await client.query(`INSERT INTO vehicle_repair_stations(station_key, display_name, world_x, world_y, world_z, radius_metres, active)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(station_key) DO UPDATE SET display_name=EXCLUDED.display_name, world_x=EXCLUDED.world_x, world_y=EXCLUDED.world_y, world_z=EXCLUDED.world_z, radius_metres=EXCLUDED.radius_metres, active=EXCLUDED.active, updated_at=now()
       RETURNING *`, [body.stationKey, body.displayName, body.x, body.y, body.z, body.radiusMetres, body.active]);
        await audit(client, 'repair_station_upsert', body.actorCharacterId, null, { stationKey: body.stationKey });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/world/gas-stations/upsert', asyncRoute(async (req, res) => {
    const body = z.object({ actorCharacterId: uuid, stationKey: z.string().min(2).max(64), displayName: z.string().min(1).max(80), pricePerLitreCents: z.number().int().min(1).max(100000).default(220), x: z.number(), y: z.number(), z: z.number(), radiusMetres: z.number().min(1).max(50).default(6), active: z.boolean().default(true) }).parse(req.body);
    const row = await tx(async (client) => {
        await requireActorRole(client, body.actorCharacterId, STAFF_ROLES, 'Place gas station');
        const result = await client.query(`INSERT INTO gas_station_locations(station_key, display_name, price_per_litre_cents, world_x, world_y, world_z, radius_metres, active)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(station_key) DO UPDATE SET display_name=EXCLUDED.display_name, price_per_litre_cents=EXCLUDED.price_per_litre_cents, world_x=EXCLUDED.world_x, world_y=EXCLUDED.world_y, world_z=EXCLUDED.world_z, radius_metres=EXCLUDED.radius_metres, active=EXCLUDED.active, updated_at=now()
       RETURNING *`, [body.stationKey, body.displayName, body.pricePerLitreCents, body.x, body.y, body.z, body.radiusMetres, body.active]);
        await audit(client, 'gas_station_upsert', body.actorCharacterId, null, { stationKey: body.stationKey, pricePerLitreCents: body.pricePerLitreCents });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/world/black-market-dealers/upsert', asyncRoute(async (req, res) => {
    const body = z.object({ actorCharacterId: uuid, dealerKey: z.string().min(2).max(64), displayName: z.string().min(1).max(80), shopKey: z.string().min(2).max(64), x: z.number(), y: z.number(), z: z.number(), radiusMetres: z.number().min(1).max(25).default(3), active: z.boolean().default(true) }).parse(req.body);
    const row = await tx(async (client) => {
        await requireActorRole(client, body.actorCharacterId, STAFF_ROLES, 'Place black market dealer');
        const result = await client.query(`INSERT INTO black_market_dealers(dealer_key, display_name, shop_key, world_x, world_y, world_z, radius_metres, active)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(dealer_key) DO UPDATE SET display_name=EXCLUDED.display_name, shop_key=EXCLUDED.shop_key, world_x=EXCLUDED.world_x, world_y=EXCLUDED.world_y, world_z=EXCLUDED.world_z, radius_metres=EXCLUDED.radius_metres, active=EXCLUDED.active, updated_at=now()
       RETURNING *`, [body.dealerKey, body.displayName, body.shopKey, body.x, body.y, body.z, body.radiusMetres, body.active]);
        await audit(client, 'black_market_dealer_upsert', body.actorCharacterId, null, { dealerKey: body.dealerKey, shopKey: body.shopKey });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/blackmarket/purchase', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ characterId: uuid, dealerKey: z.string().min(2).max(64), itemKey: z.string().min(2).max(64), quantity: z.number().int().min(1).max(25) }).parse(req.body);
    const result = await tx(async (client) => {
        await requireSelfOrAdmin(client, body.actorCharacterId, body.characterId, 'Black market purchase');
        await ensureIdempotent(client, req, 'blackmarket/purchase');
        const dealer = await client.query('SELECT * FROM black_market_dealers WHERE dealer_key=$1 AND active=true', [body.dealerKey]);
        if (!dealer.rows[0])
            throw new HttpError(404, 'Black market dealer not found or inactive', 'dealer_not_found');
        const itemRes = await client.query('SELECT * FROM shop_items WHERE shop_key=$1 AND item_key=$2 AND active=true', [dealer.rows[0].shop_key, body.itemKey]);
        const item = itemRes.rows[0];
        if (!item)
            throw new HttpError(404, 'Item not sold by this dealer', 'item_not_sold');
        if (item.legal && !item.cash_only)
            throw new HttpError(400, 'This endpoint is for illegal/cash-only dealer items only', 'not_black_market_item');
        const total = Number(item.price_cents) * body.quantity;
        const bal = await client.query('SELECT cash_cents FROM characters WHERE id=$1 FOR UPDATE', [body.characterId]);
        if (!bal.rows[0] || Number(bal.rows[0].cash_cents) < total)
            throw new HttpError(400, 'Insufficient cash', 'insufficient_cash');
        await client.query('UPDATE characters SET cash_cents=cash_cents-$1, updated_at=now() WHERE id=$2', [total, body.characterId]);
        await client.query(`INSERT INTO inventory_items(character_id,item_key,quantity,metadata)
       VALUES($1,$2,$3,'{}')
       ON CONFLICT(character_id,item_key,metadata) DO UPDATE SET quantity=inventory_items.quantity+EXCLUDED.quantity`, [body.characterId, body.itemKey, body.quantity]);
        await client.query('INSERT INTO transactions(from_character_id,tx_type,amount_cents,note) VALUES($1,$2,$3,$4)', [body.characterId, 'blackmarket_cash_purchase', total, `${body.dealerKey}:${body.itemKey}`]);
        await audit(client, 'blackmarket_purchase', body.actorCharacterId ?? null, body.characterId, { dealerKey: body.dealerKey, itemKey: body.itemKey, quantity: body.quantity });
        return { dealer: dealer.rows[0], item, quantity: body.quantity, paidWith: 'cash', totalCents: total };
    });
    res.json(result);
}));
app.post('/v1/world/vehicle-shops/upsert', asyncRoute(async (req, res) => {
    const body = z.object({ actorCharacterId: uuid, shopKey: z.string().min(2).max(64), displayName: z.string().min(1).max(80), x: z.number(), y: z.number(), z: z.number(), radiusMetres: z.number().min(1).max(50).default(5), active: z.boolean().default(true) }).parse(req.body);
    const row = await tx(async (client) => {
        await requireActorRole(client, body.actorCharacterId, STAFF_ROLES, 'Place vehicle shop');
        const result = await client.query(`INSERT INTO vehicle_shop_locations(shop_key, display_name, world_x, world_y, world_z, radius_metres, active)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(shop_key) DO UPDATE SET display_name=EXCLUDED.display_name, world_x=EXCLUDED.world_x, world_y=EXCLUDED.world_y, world_z=EXCLUDED.world_z, radius_metres=EXCLUDED.radius_metres, active=EXCLUDED.active, updated_at=now()
       RETURNING *`, [body.shopKey, body.displayName, body.x, body.y, body.z, body.radiusMetres, body.active]);
        await audit(client, 'vehicle_shop_upsert', body.actorCharacterId, null, { shopKey: body.shopKey });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/world/vehicle-shops/spawn-points/upsert', asyncRoute(async (req, res) => {
    const body = z.object({ actorCharacterId: uuid, shopKey: z.string().min(2).max(64), spawnKey: z.string().min(2).max(64), displayName: z.string().min(1).max(80), x: z.number(), y: z.number(), z: z.number(), headingDegrees: z.number().min(0).max(360).default(0), radiusMetres: z.number().min(1).max(30).default(6), maxOccupiedVehicles: z.number().int().min(1).max(5).default(1), active: z.boolean().default(true) }).parse(req.body);
    const row = await tx(async (client) => {
        await requireActorRole(client, body.actorCharacterId, STAFF_ROLES, 'Place vehicle shop spawn point');
        const shop = await client.query('SELECT shop_key FROM vehicle_shop_locations WHERE shop_key=$1', [body.shopKey]);
        if (!shop.rows[0])
            throw new HttpError(404, 'Vehicle shop must exist before adding a spawn point', 'vehicle_shop_not_found');
        const result = await client.query(`INSERT INTO vehicle_shop_spawn_points(spawn_key, shop_key, display_name, world_x, world_y, world_z, heading_degrees, radius_metres, max_occupied_vehicles, active)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT(spawn_key) DO UPDATE SET shop_key=EXCLUDED.shop_key, display_name=EXCLUDED.display_name, world_x=EXCLUDED.world_x, world_y=EXCLUDED.world_y, world_z=EXCLUDED.world_z, heading_degrees=EXCLUDED.heading_degrees, radius_metres=EXCLUDED.radius_metres, max_occupied_vehicles=EXCLUDED.max_occupied_vehicles, active=EXCLUDED.active, updated_at=now()
       RETURNING *`, [body.spawnKey, body.shopKey, body.displayName, body.x, body.y, body.z, body.headingDegrees, body.radiusMetres, body.maxOccupiedVehicles, body.active]);
        await audit(client, 'vehicle_shop_spawn_point_upsert', body.actorCharacterId, null, { shopKey: body.shopKey, spawnKey: body.spawnKey });
        return result.rows[0];
    });
    res.json(row);
}));
app.get('/v1/world/vehicle-shops/:shopKey/spawn-points', asyncRoute(async (req, res) => {
    const rows = await many('SELECT * FROM vehicle_shop_spawn_points WHERE shop_key=$1 AND active=true ORDER BY spawn_key ASC', [req.params.shopKey]);
    res.json({ shopKey: req.params.shopKey, spawnPoints: rows });
}));
app.post('/v1/world/vehicle-shops/stock/upsert', asyncRoute(async (req, res) => {
    const body = z.object({ actorCharacterId: uuid, shopKey: z.string().min(2).max(64), stockKey: z.string().min(2).max(64), displayName: z.string().min(1).max(80), prefabResource: z.string().min(3).max(240), priceCents: z.number().int().min(0).max(100000000), isTowTruck: z.boolean().default(false), isTaxi: z.boolean().default(false), requiresLicence: z.string().min(2).max(32).optional(), active: z.boolean().default(true) }).parse(req.body);
    const row = await tx(async (client) => {
        await requireActorRole(client, body.actorCharacterId, STAFF_ROLES, 'Set vehicle shop stock');
        const result = await client.query(`INSERT INTO vehicle_shop_stock(shop_key, stock_key, display_name, prefab_resource, price_cents, is_tow_truck, is_taxi, requires_licence, active)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(shop_key, stock_key) DO UPDATE SET display_name=EXCLUDED.display_name, prefab_resource=EXCLUDED.prefab_resource, price_cents=EXCLUDED.price_cents, is_tow_truck=EXCLUDED.is_tow_truck, is_taxi=EXCLUDED.is_taxi, requires_licence=EXCLUDED.requires_licence, active=EXCLUDED.active
       RETURNING *`, [body.shopKey, body.stockKey, body.displayName, body.prefabResource, body.priceCents, body.isTowTruck, body.isTaxi, body.requiresLicence ?? null, body.active]);
        await audit(client, 'vehicle_shop_stock_upsert', body.actorCharacterId, null, { shopKey: body.shopKey, stockKey: body.stockKey });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/vehicle-shop/buy', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ characterId: uuid, shopKey: z.string().min(2).max(64), stockKey: z.string().min(2).max(64), spawnKey: z.string().min(2).max(64).optional(), requestedPlate: z.string().min(2).max(12).optional() }).parse(req.body);
    const row = await tx(async (client) => {
        await requireSelfOrAdmin(client, body.actorCharacterId, body.characterId, 'Buy vehicle');
        await ensureIdempotent(client, req, 'vehicle-shop/buy');
        const shop = await client.query('SELECT * FROM vehicle_shop_locations WHERE shop_key=$1 AND active=true', [body.shopKey]);
        if (!shop.rows[0])
            throw new HttpError(404, 'Vehicle shop not found or inactive', 'vehicle_shop_not_found');
        const stock = await client.query('SELECT * FROM vehicle_shop_stock WHERE shop_key=$1 AND stock_key=$2 AND active=true', [body.shopKey, body.stockKey]);
        if (!stock.rows[0])
            throw new HttpError(404, 'Vehicle not sold here', 'vehicle_stock_not_found');
        const spawn = body.spawnKey
            ? await client.query('SELECT * FROM vehicle_shop_spawn_points WHERE shop_key=$1 AND spawn_key=$2 AND active=true', [body.shopKey, body.spawnKey])
            : await client.query('SELECT * FROM vehicle_shop_spawn_points WHERE shop_key=$1 AND active=true ORDER BY spawn_key ASC LIMIT 1', [body.shopKey]);
        if (!spawn.rows[0])
            throw new HttpError(409, 'No active vehicle spawn point has been placed for this dealership', 'vehicle_shop_spawn_missing');
        if (stock.rows[0].requires_licence) {
            const lic = await client.query('SELECT id FROM licences WHERE character_id=$1 AND licence_type=$2 AND status=$3', [body.characterId, stock.rows[0].requires_licence, 'valid']);
            if (!lic.rows[0])
                throw new HttpError(403, `Missing required licence: ${stock.rows[0].requires_licence}`, 'missing_licence');
        }
        const bal = await client.query('SELECT bank_cents FROM characters WHERE id=$1 FOR UPDATE', [body.characterId]);
        if (!bal.rows[0] || Number(bal.rows[0].bank_cents) < Number(stock.rows[0].price_cents))
            throw new HttpError(400, 'Insufficient bank balance', 'insufficient_funds');
        let plate = (body.requestedPlate ?? generatePlate()).toUpperCase();
        for (let i = 0; i < 5; i++) {
            const existing = await client.query('SELECT id FROM vehicles WHERE plate=$1', [plate]);
            if (!existing.rows[0])
                break;
            plate = generatePlate();
        }
        await client.query('UPDATE characters SET bank_cents=bank_cents-$1, updated_at=now() WHERE id=$2', [stock.rows[0].price_cents, body.characterId]);
        const vehicle = await client.query(`INSERT INTO vehicles(owner_character_id, registered_owner_character_id, plate, prefab_resource, display_name, is_tow_truck, is_taxi, stored, garage_key, last_garage_key, purchase_shop_key, purchase_spawn_key, world_x, world_y, world_z, locked)
       VALUES($1,$1,$2,$3,$4,$5,$6,false,NULL,NULL,$7,$8,$9,$10,$11,true) RETURNING *`, [body.characterId, plate, stock.rows[0].prefab_resource, stock.rows[0].display_name, stock.rows[0].is_tow_truck, stock.rows[0].is_taxi, body.shopKey, spawn.rows[0].spawn_key, spawn.rows[0].world_x, spawn.rows[0].world_y, spawn.rows[0].world_z]);
        await ensureInventoryContainer(client, { ownerType: 'vehicle_trunk', ownerId: vehicle.rows[0].id, vehicleId: vehicle.rows[0].id, label: `${stock.rows[0].display_name} Trunk`, slotCap: Number(vehicle.rows[0].trunk_slot_cap ?? 20), weightLimitGrams: Number(vehicle.rows[0].trunk_weight_limit_grams ?? 100000), metadata: { plate } });
        await client.query('INSERT INTO transactions(from_character_id,tx_type,amount_cents,note) VALUES($1,$2,$3,$4)', [body.characterId, 'vehicle_purchase_bank', stock.rows[0].price_cents, `${body.shopKey}:${body.stockKey}:${plate}`]);
        await audit(client, 'vehicle_shop_buy_registered_spawned', body.actorCharacterId ?? null, body.characterId, { shopKey: body.shopKey, stockKey: body.stockKey, spawnKey: spawn.rows[0].spawn_key, plate });
        return { vehicle: vehicle.rows[0], shop: shop.rows[0], stock: stock.rows[0], spawnPoint: spawn.rows[0], registeredTo: body.characterId, paidWith: 'bank' };
    });
    res.json(row);
}));
app.get('/v1/vehicles/garage/list', asyncRoute(async (req, res) => {
    const characterId = z.string().uuid().parse(req.query.characterId);
    const garageKey = z.string().min(2).max(64).parse(req.query.garageKey);
    const rows = await many(`SELECT id, plate, display_name, prefab_resource, fuel_litres, max_fuel_litres, damage_percent, stored, garage_key, last_garage_key, locked, updated_at
     FROM vehicles
     WHERE owner_character_id=$1 AND stored=true AND garage_key=$2
     ORDER BY updated_at DESC`, [characterId, garageKey]);
    res.json({ characterId, garageKey, vehicles: rows });
}));
app.post('/v1/vehicles/lock', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ vehicleId: uuid, locked: z.boolean() }).parse(req.body);
    const row = await tx(async (client) => {
        await requireVehicleOwnerOrStaff(client, body.actorCharacterId, body.vehicleId, body.locked ? 'Lock vehicle' : 'Unlock vehicle');
        const result = await client.query('UPDATE vehicles SET locked=$1, updated_at=now() WHERE id=$2 RETURNING id, plate, display_name, locked', [body.locked, body.vehicleId]);
        await audit(client, body.locked ? 'vehicle_locked' : 'vehicle_unlocked', body.actorCharacterId ?? null, null, { vehicleId: body.vehicleId });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/vehicles/entry-code/set', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ vehicleId: uuid, code: z.string().regex(/^[0-9]{4,8}$/) }).parse(req.body);
    const row = await tx(async (client) => {
        await requireVehicleOwnerOrStaff(client, body.actorCharacterId, body.vehicleId, 'Set vehicle entry code');
        const salt = newSalt();
        const hash = hashVehicleEntryCode(body.code, salt);
        const result = await client.query('UPDATE vehicles SET vehicle_code_salt=$1, vehicle_code_hash=$2, updated_at=now() WHERE id=$3 RETURNING id, plate, display_name, locked', [salt, hash, body.vehicleId]);
        await audit(client, 'vehicle_entry_code_set', body.actorCharacterId ?? null, null, { vehicleId: body.vehicleId });
        return { ...result.rows[0], codeStoredAsHash: true };
    });
    res.json(row);
}));
app.post('/v1/vehicles/entry-code/use', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ characterId: uuid, vehicleId: uuid, code: z.string().regex(/^[0-9]{4,8}$/) }).parse(req.body);
    const row = await tx(async (client) => {
        await requireSelfOrAdmin(client, body.actorCharacterId, body.characterId, 'Use vehicle entry code');
        const v = await client.query('SELECT id, plate, display_name, vehicle_code_salt, vehicle_code_hash, registered_owner_character_id, owner_character_id FROM vehicles WHERE id=$1', [body.vehicleId]);
        if (!v.rows[0])
            throw new HttpError(404, 'Vehicle not found', 'vehicle_not_found');
        if (!v.rows[0].vehicle_code_salt || !v.rows[0].vehicle_code_hash)
            throw new HttpError(403, 'This vehicle has no entry code set', 'vehicle_code_not_set');
        const expected = hashVehicleEntryCode(body.code, v.rows[0].vehicle_code_salt);
        if (expected !== v.rows[0].vehicle_code_hash)
            throw new HttpError(403, 'Incorrect vehicle entry code', 'bad_vehicle_code');
        await client.query(`INSERT INTO vehicle_access_grants(vehicle_id, character_id, granted_by_code) VALUES($1,$2,true)
       ON CONFLICT(vehicle_id, character_id) DO UPDATE SET granted_by_code=true, expires_at=NULL, created_at=now()`, [body.vehicleId, body.characterId]);
        await audit(client, 'vehicle_entry_code_granted', body.characterId, v.rows[0].registered_owner_character_id ?? v.rows[0].owner_character_id ?? null, { vehicleId: body.vehicleId });
        return { vehicleId: body.vehicleId, characterId: body.characterId, canEnter: true, note: 'Code grants entry access only; it does not transfer ownership or lock/unlock rights.' };
    });
    res.json(row);
}));
app.get('/v1/vehicles/can-enter', asyncRoute(async (req, res) => {
    const characterId = z.string().uuid().parse(req.query.characterId);
    const vehicleId = z.string().uuid().parse(req.query.vehicleId);
    const result = await tx(async (client) => {
        const allowed = await hasVehicleEntryAccess(client, characterId, vehicleId);
        const v = await client.query('SELECT id, plate, display_name, locked FROM vehicles WHERE id=$1', [vehicleId]);
        return { vehicle: v.rows[0], characterId, canEnter: allowed, locked: v.rows[0]?.locked ?? true };
    });
    res.json(result);
}));
app.post('/v1/vehicles/dashboard/action', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({
        characterId: uuid,
        vehicleId: uuid,
        action: z.enum(['engine_toggle', 'headlights_off', 'headlights_low', 'headlights_high', 'hazards_toggle', 'left_indicator_toggle', 'right_indicator_toggle', 'radio_toggle', 'radio_next', 'radio_previous', 'radio_set_channel']),
        radioChannelKey: z.string().min(1).max(64).optional(),
        speedKph: z.number().min(0).max(500).optional(),
        rpm: z.number().min(0).max(12000).optional()
    }).parse(req.body);
    const row = await tx(async (client) => {
        await requireSelfOrAdmin(client, body.actorCharacterId, body.characterId, 'Use vehicle dashboard controls');
        if (!(await hasVehicleEntryAccess(client, body.characterId, body.vehicleId)))
            throw new HttpError(403, 'You do not have access to this vehicle', 'vehicle_access_required');
        const current = await client.query('SELECT * FROM vehicles WHERE id=$1 FOR UPDATE', [body.vehicleId]);
        if (!current.rows[0])
            throw new HttpError(404, 'Vehicle not found', 'vehicle_not_found');
        let q = '';
        let params = [];
        switch (body.action) {
            case 'engine_toggle':
                q = 'engine_on=NOT engine_on';
                break;
            case 'headlights_off':
                q = `headlights_mode='off'`;
                break;
            case 'headlights_low':
                q = `headlights_mode='low'`;
                break;
            case 'headlights_high':
                q = `headlights_mode='high'`;
                break;
            case 'hazards_toggle':
                q = 'hazards_on=NOT hazards_on';
                break;
            case 'left_indicator_toggle':
                q = 'left_indicator_on=NOT left_indicator_on, right_indicator_on=false';
                break;
            case 'right_indicator_toggle':
                q = 'right_indicator_on=NOT right_indicator_on, left_indicator_on=false';
                break;
            case 'radio_toggle':
                q = 'radio_on=NOT radio_on';
                break;
            case 'radio_next':
                q = 'radio_on=true';
                break;
            case 'radio_previous':
                q = 'radio_on=true';
                break;
            case 'radio_set_channel':
                q = 'radio_on=true, radio_channel_key=$1';
                params = [body.radioChannelKey ?? 'country_roads'];
                break;
        }
        const result = await client.query(`UPDATE vehicles SET ${q}, dashboard_speed_kph=COALESCE($${params.length + 1}, dashboard_speed_kph), dashboard_rpm=COALESCE($${params.length + 2}, dashboard_rpm), updated_at=now() WHERE id=$${params.length + 3} RETURNING id, plate, engine_on, headlights_mode, hazards_on, left_indicator_on, right_indicator_on, radio_on, radio_channel_key, dashboard_speed_kph, dashboard_rpm`, [...params, body.speedKph ?? null, body.rpm ?? null, body.vehicleId]);
        await client.query('INSERT INTO vehicle_dashboard_events(vehicle_id, actor_character_id, action_key, metadata) VALUES($1,$2,$3,$4::jsonb)', [body.vehicleId, body.characterId, body.action, JSON.stringify({ radioChannelKey: body.radioChannelKey })]);
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/vehicles/dashboard/sync', asyncRoute(async (req, res) => {
    const body = z.object({ vehicleId: uuid, speedKph: z.number().min(0).max(500), rpm: z.number().min(0).max(12000), odometerKm: z.number().min(0).max(10000000).optional() }).parse(req.body);
    const row = await tx(async (client) => {
        const result = await client.query('UPDATE vehicles SET dashboard_speed_kph=$1, dashboard_rpm=$2, odometer_km=GREATEST(odometer_km, COALESCE($3, odometer_km)), updated_at=now() WHERE id=$4 RETURNING id, dashboard_speed_kph, dashboard_rpm, odometer_km', [body.speedKph, body.rpm, body.odometerKm ?? null, body.vehicleId]);
        if (!result.rows[0])
            throw new HttpError(404, 'Vehicle not found', 'vehicle_not_found');
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/slot-machines/play', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ characterId: uuid, machineKey: z.string().min(2).max(64), betCents: z.number().int().min(100).max(5000) }).parse(req.body);
    const row = await tx(async (client) => {
        await requireSelfOrAdmin(client, body.actorCharacterId, body.characterId, 'Play slot machine');
        await ensureIdempotent(client, req, 'slot-machines/play');
        const machine = await client.query('SELECT * FROM slot_machines WHERE machine_key=$1 AND active=true', [body.machineKey]);
        if (!machine.rows[0])
            throw new HttpError(404, 'Slot machine not found', 'slot_machine_not_found');
        if (body.betCents < Number(machine.rows[0].min_bet_cents) || body.betCents > Number(machine.rows[0].max_bet_cents))
            throw new HttpError(400, 'Bet outside machine limits', 'slot_bet_limit');
        const bal = await client.query('SELECT cash_cents FROM characters WHERE id=$1 FOR UPDATE', [body.characterId]);
        if (!bal.rows[0] || Number(bal.rows[0].cash_cents) < body.betCents)
            throw new HttpError(400, 'Insufficient cash', 'insufficient_cash');
        const roll = Math.random();
        let payout = 0;
        let outcome = 'lose';
        if (roll < 0.002) {
            payout = body.betCents * 50;
            outcome = 'jackpot';
        }
        else if (roll < 0.022) {
            payout = body.betCents * 8;
            outcome = 'big_win';
        }
        else if (roll < 0.202) {
            payout = body.betCents * 2;
            outcome = 'small_win';
        }
        await client.query('UPDATE characters SET cash_cents=cash_cents-$1+$2, updated_at=now() WHERE id=$3', [body.betCents, payout, body.characterId]);
        const play = await client.query('INSERT INTO slot_machine_plays(machine_key, character_id, bet_cents, payout_cents, outcome_key) VALUES($1,$2,$3,$4,$5) RETURNING *', [body.machineKey, body.characterId, body.betCents, payout, outcome]);
        await audit(client, 'slot_machine_play', body.actorCharacterId ?? null, body.characterId, { machineKey: body.machineKey, betCents: body.betCents, payoutCents: payout, outcome });
        return { play: play.rows[0], machine: machine.rows[0], newCashDeltaCents: payout - body.betCents };
    });
    res.json(row);
}));
app.post('/v1/world/duty-stations/upsert', asyncRoute(async (req, res) => {
    const body = z.object({ actorCharacterId: uuid, stationKey: z.string().min(2).max(64), displayName: z.string().min(1).max(80), dutyRole: z.enum(['police', 'fire', 'ems', 'prison']), x: z.number(), y: z.number(), z: z.number(), radiusMetres: z.number().min(1).max(25).default(4), active: z.boolean().default(true) }).parse(req.body);
    const row = await tx(async (client) => {
        await requireActorRole(client, body.actorCharacterId, STAFF_ROLES, 'Place duty station');
        const result = await client.query(`INSERT INTO duty_stations(station_key, display_name, duty_role, world_x, world_y, world_z, radius_metres, active)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(station_key) DO UPDATE SET display_name=EXCLUDED.display_name, duty_role=EXCLUDED.duty_role, world_x=EXCLUDED.world_x, world_y=EXCLUDED.world_y, world_z=EXCLUDED.world_z, radius_metres=EXCLUDED.radius_metres, active=EXCLUDED.active, updated_at=now()
       RETURNING *`, [body.stationKey, body.displayName, body.dutyRole, body.x, body.y, body.z, body.radiusMetres, body.active]);
        await audit(client, 'duty_station_upsert', body.actorCharacterId, null, { stationKey: body.stationKey, dutyRole: body.dutyRole });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/duty/set', asyncRoute(async (req, res) => {
    const body = z.object({ actorCharacterId: uuid, characterId: uuid, stationKey: z.string().min(2).max(64), dutyRole: z.enum(['police', 'fire', 'ems', 'prison']), onDuty: z.boolean() }).parse(req.body);
    const row = await tx(async (client) => {
        await requireSelfOrAdmin(client, body.actorCharacterId, body.characterId, 'Clock duty');
        const station = await client.query('SELECT * FROM duty_stations WHERE station_key=$1 AND duty_role=$2 AND active=true', [body.stationKey, body.dutyRole]);
        if (!station.rows[0])
            throw new HttpError(404, 'Duty station not found or inactive for this role', 'duty_station_not_found');
        const assignment = await client.query('SELECT id FROM role_assignments WHERE character_id=$1 AND role_key=$2 AND active=true', [body.characterId, body.dutyRole]);
        if (!assignment.rows[0])
            throw new HttpError(403, `You are not whitelisted for ${body.dutyRole}`, 'not_whitelisted_for_duty');
        await client.query(`UPDATE online_players SET is_on_duty=$1, role_on_duty=CASE WHEN $1 THEN $2 ELSE 'civilian' END, last_seen=now()
       WHERE character_id=$3 AND server_id=$4`, [body.onDuty, body.dutyRole, body.characterId, serverId(req)]);
        await client.query('UPDATE characters SET whitelist_role=$1, updated_at=now() WHERE id=$2', [body.onDuty ? body.dutyRole : 'civilian', body.characterId]);
        await audit(client, body.onDuty ? 'duty_clock_in' : 'duty_clock_out', body.actorCharacterId, body.characterId, { stationKey: body.stationKey, dutyRole: body.dutyRole });
        return { characterId: body.characterId, dutyRole: body.onDuty ? body.dutyRole : 'civilian', onDuty: body.onDuty, station: station.rows[0] };
    });
    res.json(row);
}));
// -----------------------------------------------------------------------------
// V4: panic alerts, prison staff, payroll, prison cell doors and property door codes
// -----------------------------------------------------------------------------
app.post('/v1/police/panic', asyncRoute(async (req, res) => {
    const body = z.object({
        actorCharacterId: uuid,
        x: z.number(),
        y: z.number(),
        z: z.number(),
        message: z.string().max(160).default('Officer panic button activated')
    }).parse(req.body);
    const row = await tx(async (client) => {
        await requireOnDutyRole(client, req, body.actorCharacterId, 'police', 'Police panic button');
        const recent = await client.query(`SELECT id, created_at FROM panic_alerts
       WHERE officer_character_id=$1 AND created_at > now() - ($2::text)::interval
       ORDER BY created_at DESC LIMIT 1`, [body.actorCharacterId, `${panicCooldownSeconds} seconds`]);
        if (recent.rows[0])
            throw new HttpError(429, 'Panic button cooldown active', 'panic_cooldown');
        const result = await client.query(`INSERT INTO panic_alerts(server_id, officer_character_id, world_x, world_y, world_z, message)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [serverId(req), body.actorCharacterId, body.x, body.y, body.z, body.message]);
        await audit(client, 'police_panic_alert', body.actorCharacterId, body.actorCharacterId, { x: body.x, y: body.y, z: body.z });
        return { alert: result.rows[0], cooldownSeconds: panicCooldownSeconds };
    });
    res.json(row);
}));
app.get('/v1/police/panic/active', asyncRoute(async (req, res) => {
    const actorCharacterId = String(req.query.actorCharacterId ?? '');
    const rows = await tx(async (client) => {
        await requireOnDutyRole(client, req, actorCharacterId, 'police', 'View panic alerts');
        return await client.query(`SELECT pa.*, c.character_code, c.first_name, c.last_name
       FROM panic_alerts pa
       LEFT JOIN characters c ON c.id=pa.officer_character_id
       WHERE pa.server_id=$1 AND pa.active=true
       ORDER BY pa.created_at DESC LIMIT 25`, [serverId(req)]);
    });
    res.json(rows.rows);
}));
app.post('/v1/police/panic/resolve', asyncRoute(async (req, res) => {
    const body = z.object({ actorCharacterId: uuid, alertId: uuid }).parse(req.body);
    const row = await tx(async (client) => {
        await requireOnDutyRole(client, req, body.actorCharacterId, 'police', 'Resolve panic alert');
        const result = await client.query(`UPDATE panic_alerts SET active=false, resolved_by=$1, resolved_at=now()
       WHERE id=$2 AND server_id=$3 RETURNING *`, [body.actorCharacterId, body.alertId, serverId(req)]);
        if (!result.rows[0])
            throw new HttpError(404, 'Panic alert not found', 'panic_not_found');
        await audit(client, 'police_panic_resolved', body.actorCharacterId, result.rows[0].officer_character_id, { alertId: body.alertId });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/jobs/whitelist-paycheck', asyncRoute(async (req, res) => {
    const body = z.object({ actorCharacterId: uuid, characterId: uuid, roleKey: whitelistDutyRoleSchema }).parse(req.body);
    const row = await tx(async (client) => {
        await requireSelfOrAdmin(client, body.actorCharacterId, body.characterId, 'Claim whitelisted paycheck');
        await requireOnDutyRole(client, req, body.actorCharacterId, body.roleKey, 'Claim whitelisted paycheck');
        const assignment = await client.query('SELECT id FROM role_assignments WHERE character_id=$1 AND role_key=$2 AND active=true', [body.characterId, body.roleKey]);
        if (!assignment.rows[0])
            throw new HttpError(403, `You are not whitelisted for ${body.roleKey}`, 'not_whitelisted');
        const recent = await client.query(`SELECT id, created_at FROM job_paycheck_claims
       WHERE character_id=$1 AND role_key=$2 AND server_id=$3 AND created_at > now() - ($4::text)::interval
       ORDER BY created_at DESC LIMIT 1`, [body.characterId, body.roleKey, serverId(req), `${whitelistPaycheckIntervalSeconds} seconds`]);
        if (recent.rows[0])
            throw new HttpError(429, 'Paycheck is not ready yet', 'paycheck_cooldown');
        const payout = whitelistPayRates[body.roleKey];
        await client.query('UPDATE characters SET bank_cents=bank_cents+$1, updated_at=now() WHERE id=$2', [payout, body.characterId]);
        const claim = await client.query(`INSERT INTO job_paycheck_claims(server_id, character_id, role_key, amount_cents)
       VALUES($1,$2,$3,$4) RETURNING *`, [serverId(req), body.characterId, body.roleKey, payout]);
        await client.query('INSERT INTO transactions(to_character_id,tx_type,amount_cents,note) VALUES($1,$2,$3,$4)', [body.characterId, 'whitelist_paycheck', payout, body.roleKey]);
        await audit(client, 'whitelist_paycheck', body.actorCharacterId, body.characterId, { roleKey: body.roleKey, payout });
        return { paid: payout, roleKey: body.roleKey, intervalSeconds: whitelistPaycheckIntervalSeconds, claim: claim.rows[0] };
    });
    res.json(row);
}));
app.post('/v1/jobs/payroll/tick', asyncRoute(async (req, res) => {
    const body = z.object({ maxPlayers: z.number().int().min(1).max(256).default(128) }).parse(req.body ?? {});
    const result = await tx(async (client) => {
        const online = await client.query(`SELECT DISTINCT character_id, role_on_duty
       FROM online_players
       WHERE server_id=$1 AND online=true AND is_on_duty=true
         AND role_on_duty IN ('police','fire','ems','prison')
         AND character_id IS NOT NULL
         AND last_seen > now() - ($2::text)::interval
       LIMIT $3`, [serverId(req), `${serverWindowSeconds} seconds`, body.maxPlayers]);
        const paid = [];
        for (const p of online.rows) {
            const role = p.role_on_duty;
            const assignment = await client.query('SELECT id FROM role_assignments WHERE character_id=$1 AND role_key=$2 AND active=true', [p.character_id, role]);
            if (!assignment.rows[0])
                continue;
            const recent = await client.query(`SELECT id FROM job_paycheck_claims
         WHERE character_id=$1 AND role_key=$2 AND server_id=$3 AND created_at > now() - ($4::text)::interval
         LIMIT 1`, [p.character_id, role, serverId(req), `${whitelistPaycheckIntervalSeconds} seconds`]);
            if (recent.rows[0])
                continue;
            const payout = whitelistPayRates[role];
            await client.query('UPDATE characters SET bank_cents=bank_cents+$1, updated_at=now() WHERE id=$2', [payout, p.character_id]);
            const claim = await client.query(`INSERT INTO job_paycheck_claims(server_id, character_id, role_key, amount_cents)
         VALUES($1,$2,$3,$4) RETURNING *`, [serverId(req), p.character_id, role, payout]);
            await client.query('INSERT INTO transactions(to_character_id,tx_type,amount_cents,note) VALUES($1,$2,$3,$4)', [p.character_id, 'whitelist_paycheck_auto', payout, role]);
            await audit(client, 'whitelist_payroll_tick_paid', null, p.character_id, { roleKey: role, payout });
            paid.push(claim.rows[0]);
        }
        return { checked: online.rows.length, paidCount: paid.length, paid };
    });
    res.json(result);
}));
app.post('/v1/world/prison-cell-door/upsert', asyncRoute(async (req, res) => {
    const body = z.object({
        actorCharacterId: uuid,
        doorKey: z.string().min(2).max(80),
        displayName: z.string().min(1).max(80),
        facilityKey: z.string().min(2).max(64).default('main_prison'),
        x: z.number().optional(), y: z.number().optional(), z: z.number().optional(),
        active: z.boolean().default(true)
    }).parse(req.body);
    const row = await tx(async (client) => {
        await requireActorRole(client, body.actorCharacterId, STAFF_ROLES, 'Place prison cell door');
        const result = await client.query(`INSERT INTO prison_cell_doors(door_key, display_name, facility_key, world_x, world_y, world_z, active)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(door_key) DO UPDATE SET display_name=EXCLUDED.display_name, facility_key=EXCLUDED.facility_key, world_x=EXCLUDED.world_x, world_y=EXCLUDED.world_y, world_z=EXCLUDED.world_z, active=EXCLUDED.active, updated_at=now()
       RETURNING *`, [body.doorKey, body.displayName, body.facilityKey, body.x ?? null, body.y ?? null, body.z ?? null, body.active]);
        await audit(client, 'prison_cell_door_upsert', body.actorCharacterId, null, { doorKey: body.doorKey });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/prison/cell-door/toggle', asyncRoute(async (req, res) => {
    const body = z.object({ actorCharacterId: uuid, doorKey: z.string().min(2).max(80), locked: z.boolean().optional() }).parse(req.body);
    const row = await tx(async (client) => {
        await requireOnDutyRole(client, req, body.actorCharacterId, 'prison', 'Toggle prison cell door');
        const result = await client.query(`UPDATE prison_cell_doors SET locked=COALESCE($1, NOT locked), updated_at=now()
       WHERE door_key=$2 AND active=true RETURNING *`, [body.locked ?? null, body.doorKey]);
        if (!result.rows[0])
            throw new HttpError(404, 'Prison cell door not found', 'cell_door_not_found');
        await audit(client, 'prison_cell_door_toggle', body.actorCharacterId, null, { doorKey: body.doorKey, locked: result.rows[0].locked });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/world/property-door/upsert', asyncRoute(async (req, res) => {
    const body = z.object({
        actorCharacterId: uuid,
        doorKey: z.string().min(2).max(80),
        propertyKey: z.string().min(2).max(64),
        displayName: z.string().min(1).max(80),
        x: z.number().optional(), y: z.number().optional(), z: z.number().optional(),
        active: z.boolean().default(true)
    }).parse(req.body);
    const row = await tx(async (client) => {
        await requireActorRole(client, body.actorCharacterId, STAFF_ROLES, 'Place property door');
        const prop = await client.query('SELECT id FROM properties WHERE property_key=$1', [body.propertyKey]);
        if (!prop.rows[0])
            throw new HttpError(404, 'Property not found', 'property_not_found');
        const result = await client.query(`INSERT INTO property_doors(door_key, property_key, display_name, world_x, world_y, world_z, active)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(door_key) DO UPDATE SET property_key=EXCLUDED.property_key, display_name=EXCLUDED.display_name, world_x=EXCLUDED.world_x, world_y=EXCLUDED.world_y, world_z=EXCLUDED.world_z, active=EXCLUDED.active, updated_at=now()
       RETURNING *`, [body.doorKey, body.propertyKey, body.displayName, body.x ?? null, body.y ?? null, body.z ?? null, body.active]);
        await audit(client, 'property_door_upsert', body.actorCharacterId, null, { doorKey: body.doorKey, propertyKey: body.propertyKey });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/property/door/set-code', asyncRoute(async (req, res) => {
    const body = z.object({ actorCharacterId: uuid, doorKey: z.string().min(2).max(80), code: z.string().regex(/^\d{4,8}$/) }).parse(req.body);
    const row = await tx(async (client) => {
        const door = await client.query(`SELECT pd.*, p.owner_character_id FROM property_doors pd JOIN properties p ON p.property_key=pd.property_key WHERE pd.door_key=$1 FOR UPDATE`, [body.doorKey]);
        if (!door.rows[0])
            throw new HttpError(404, 'Property door not found', 'property_door_not_found');
        const isStaff = await hasAnyRole(client, body.actorCharacterId, STAFF_ROLES);
        if (!isStaff && door.rows[0].owner_character_id !== body.actorCharacterId)
            throw new HttpError(403, 'Only the property owner or staff can set the door code', 'not_property_owner');
        const salt = newSalt();
        const hash = hashPropertyDoorCode(body.code, salt);
        const result = await client.query(`UPDATE property_doors SET code_salt=$1, code_hash=$2, updated_at=now() WHERE door_key=$3 RETURNING door_key, property_key, display_name, locked, active, updated_at`, [salt, hash, body.doorKey]);
        await audit(client, 'property_door_code_set', body.actorCharacterId, door.rows[0].owner_character_id, { doorKey: body.doorKey });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/property/door/toggle', asyncRoute(async (req, res) => {
    const body = z.object({ actorCharacterId: uuid.optional(), doorKey: z.string().min(2).max(80), locked: z.boolean().optional(), code: z.string().regex(/^\d{4,8}$/).optional() }).parse(req.body);
    const row = await tx(async (client) => {
        const door = await client.query(`SELECT pd.*, p.owner_character_id FROM property_doors pd JOIN properties p ON p.property_key=pd.property_key WHERE pd.door_key=$1 AND pd.active=true FOR UPDATE`, [body.doorKey]);
        if (!door.rows[0])
            throw new HttpError(404, 'Property door not found', 'property_door_not_found');
        const d = door.rows[0];
        const isStaff = body.actorCharacterId ? await hasAnyRole(client, body.actorCharacterId, STAFF_ROLES) : false;
        const isOwner = body.actorCharacterId && d.owner_character_id === body.actorCharacterId;
        const hasCode = body.code && d.code_salt && d.code_hash && hashPropertyDoorCode(body.code, d.code_salt) === d.code_hash;
        if (!isStaff && !isOwner && !hasCode)
            throw new HttpError(403, 'Door code or property ownership required', 'door_access_denied');
        const result = await client.query(`UPDATE property_doors SET locked=COALESCE($1, NOT locked), updated_at=now() WHERE door_key=$2 RETURNING door_key, property_key, display_name, locked, active, updated_at`, [body.locked ?? null, body.doorKey]);
        await client.query(`INSERT INTO property_door_access_logs(door_key, actor_character_id, access_type, allowed)
       VALUES($1,$2,$3,true)`, [body.doorKey, body.actorCharacterId ?? null, isOwner ? 'owner' : isStaff ? 'staff' : 'code']);
        await audit(client, 'property_door_toggle', body.actorCharacterId ?? null, d.owner_character_id, { doorKey: body.doorKey, locked: result.rows[0].locked });
        return result.rows[0];
    });
    res.json(row);
}));
// -----------------------------------------------------------------------------
// No-chat / prompt-driven interaction layer
// Normal player text chat is blocked in the addon. These endpoints let the server
// audit blocked messages and allow only Admin/GM staff chat when the mod UI calls it.
// Gameplay actions should use prompts/keybinds and server-authoritative endpoints,
// not slash commands in chat.
// -----------------------------------------------------------------------------
app.post('/v1/chat/can-speak', asyncRoute(async (req, res) => {
    const body = z.object({ characterId: uuid.optional() }).parse(req.body);
    if (!body.characterId)
        return res.json({ canSpeak: false, reason: 'chat_disabled_use_prompts' });
    const row = await tx(async (client) => {
        const isStaff = await hasAnyRole(client, body.characterId, STAFF_ROLES);
        await audit(client, 'chat_permission_check', body.characterId ?? null, body.characterId ?? null, { canSpeak: isStaff });
        return { canSpeak: isStaff, reason: isStaff ? 'staff_chat_allowed' : 'chat_disabled_use_prompts' };
    });
    res.json(row);
}));
app.post('/v1/chat/message', asyncRoute(async (req, res) => {
    const body = z.object({
        characterId: uuid.optional(),
        displayName: z.string().min(1).max(64).default('Unknown'),
        message: z.string().min(1).max(300)
    }).parse(req.body);
    const row = await tx(async (client) => {
        const isStaff = body.characterId ? await hasAnyRole(client, body.characterId, STAFF_ROLES) : false;
        const result = await client.query(`INSERT INTO chat_messages(server_id, character_id, display_name, message, allowed, blocked_reason)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [serverId(req), body.characterId ?? null, body.displayName, body.message, isStaff, isStaff ? null : 'chat_disabled_use_prompts']);
        await audit(client, isStaff ? 'staff_chat_message' : 'blocked_chat_message', body.characterId ?? null, body.characterId ?? null, { messageLength: body.message.length });
        if (!isStaff)
            throw new HttpError(403, 'In-game text chat is disabled. Use action prompts, keybinds, radio/voice, CAD and menus.', 'chat_disabled_use_prompts');
        return result.rows[0];
    });
    res.json(row);
}));
// -----------------------------------------------------------------------------
// V5 phone/player-list/bank/Twitter systems
// ----------------------------------------------------------------------------
app.get('/v1/phone/overview/:characterId', asyncRoute(async (req, res) => {
    const actorCharacterId = String(req.query.actorCharacterId ?? req.params.characterId);
    const characterId = String(req.params.characterId);
    const row = await tx(async (client) => {
        await requireSelfOrAdmin(client, actorCharacterId, characterId, 'Phone overview');
        const character = await client.query('SELECT id, character_code, first_name, last_name, cash_cents, bank_cents, job_key, whitelist_role FROM characters WHERE id=$1', [characterId]);
        if (!character.rows[0])
            throw new HttpError(404, 'Character not found', 'character_not_found');
        const unreadAlerts = await client.query('SELECT count(*)::int AS count FROM panic_alerts WHERE server_id=$1 AND active=true', [serverId(req)]);
        return { character: character.rows[0], activePanicAlerts: Number(unreadAlerts.rows[0]?.count ?? 0) };
    });
    res.json(row);
}));
app.get('/v1/phone/player-list', asyncRoute(async (req, res) => {
    const actorCharacterId = String(req.query.actorCharacterId ?? '');
    const rows = await tx(async (client) => {
        if (actorCharacterId)
            await requireActorRole(client, actorCharacterId, ['civilian', 'police', 'fire', 'ems', 'prison', 'admin', 'gm'], 'Phone player list');
        const result = await client.query(`SELECT op.character_id, op.display_name, op.role_on_duty, op.is_on_duty, c.character_code, c.first_name, c.last_name
       FROM online_players op
       LEFT JOIN characters c ON c.id=op.character_id
       WHERE op.server_id=$1 AND op.online=true AND op.character_id IS NOT NULL
         AND op.last_seen > now() - ($2::text)::interval
       ORDER BY c.first_name NULLS LAST, c.last_name NULLS LAST, op.display_name
       LIMIT 256`, [serverId(req), `${serverWindowSeconds} seconds`]);
        return result.rows;
    });
    res.json(rows);
}));
app.get('/v1/phone/twitter/feed', asyncRoute(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 100);
    const rows = await many(`SELECT tp.*, c.character_code, c.first_name, c.last_name
     FROM phone_twitter_posts tp
     LEFT JOIN characters c ON c.id=tp.character_id
     WHERE tp.server_id=$1 AND tp.deleted=false
     ORDER BY tp.created_at DESC
     LIMIT $2`, [serverId(req), limit]);
    res.json(rows);
}));
app.post('/v1/phone/twitter/post', asyncRoute(async (req, res) => {
    const body = optionalActor.extend({ characterId: uuid, handle: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_]+$/).optional(), message: z.string().min(1).max(240) }).parse(req.body);
    const row = await tx(async (client) => {
        await requireSelfOrAdmin(client, body.actorCharacterId, body.characterId, 'Phone Twitter post');
        const recent = await client.query('SELECT id FROM phone_twitter_posts WHERE character_id=$1 AND created_at > now() - ($2::text)::interval LIMIT 1', [body.characterId, `${twitterPostCooldownSeconds} seconds`]);
        if (recent.rows[0])
            throw new HttpError(429, 'Twitter app cooldown active', 'twitter_cooldown');
        const result = await client.query('INSERT INTO phone_twitter_posts(server_id, character_id, handle, message) VALUES($1,$2,$3,$4) RETURNING *', [serverId(req), body.characterId, body.handle ?? null, body.message]);
        await audit(client, 'phone_twitter_post', body.actorCharacterId ?? null, body.characterId, { messageLength: body.message.length });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/interaction/action-request', asyncRoute(async (req, res) => {
    const body = z.object({
        actorCharacterId: uuid,
        targetCharacterId: uuid.optional(),
        actionKey: z.enum([
            'open_cad', 'fine', 'wanted', 'arrest', 'jail', 'taser', 'frisk', 'breathalyser', 'speed_radar', 'heal', 'admit_hospital',
            'start_fire_response', 'spray_hose', 'repair_vehicle', 'tow_load', 'tow_unload', 'refuel_vehicle',
            'open_shop', 'open_blackmarket', 'open_vehicle_shop', 'buy_vehicle', 'buy_property', 'store_vehicle', 'spawn_vehicle', 'open_phone', 'phone_player_list', 'phone_bank', 'phone_map', 'phone_twitter', 'open_vehicle_radio', 'drink_beer', 'plant_weed', 'harvest_weed', 'use_ziptie', 'release_ziptie', 'open_clothing_store', 'open_uniform_locker', 'use_stretcher', 'load_stretcher_patient', 'unload_stretcher_patient', 'clock_in_police', 'clock_in_fire', 'clock_in_ems', 'clock_out_duty', 'start_taxi', 'end_taxi',
            'start_robbery', 'prison_job', 'scratch_card', 'panic_button', 'clock_in_prison', 'lock_prison_cell', 'unlock_prison_cell', 'property_lock', 'property_unlock', 'property_set_code', 'claim_whitelist_paycheck', 'admin_menu', 'gm_menu', 'staff_chat'
        ]),
        metadata: z.record(z.any()).default({})
    }).parse(req.body);
    const row = await tx(async (client) => {
        const policeActions = ['open_cad', 'fine', 'wanted', 'arrest', 'jail', 'taser', 'frisk', 'breathalyser', 'speed_radar', 'panic_button'];
        const emsActions = ['heal', 'admit_hospital', 'use_stretcher', 'load_stretcher_patient', 'unload_stretcher_patient'];
        const fireActions = ['start_fire_response', 'spray_hose'];
        const dutyActions = ['clock_in_police', 'clock_in_fire', 'clock_in_ems', 'clock_in_prison', 'clock_out_duty'];
        const prisonActions = ['lock_prison_cell', 'unlock_prison_cell'];
        const propertyActions = ['property_lock', 'property_unlock', 'property_set_code'];
        const paycheckActions = ['claim_whitelist_paycheck'];
        const staffActions = ['admin_menu', 'gm_menu', 'staff_chat'];
        if (policeActions.includes(body.actionKey))
            await requireActorRole(client, body.actorCharacterId, ['police', 'admin'], body.actionKey);
        if (emsActions.includes(body.actionKey))
            await requireActorRole(client, body.actorCharacterId, ['ems', 'admin'], body.actionKey);
        if (fireActions.includes(body.actionKey))
            await requireActorRole(client, body.actorCharacterId, ['fire', 'admin'], body.actionKey);
        if (prisonActions.includes(body.actionKey))
            await requireActorRole(client, body.actorCharacterId, ['prison', 'admin'], body.actionKey);
        // Property ownership/code is validated by the property door endpoints themselves.
        if (propertyActions.includes(body.actionKey)) { /* prompt allowed; endpoint performs owner/code check */ }
        if (paycheckActions.includes(body.actionKey))
            await requireActorRole(client, body.actorCharacterId, ['police', 'fire', 'ems', 'prison', 'admin'], body.actionKey);
        if (dutyActions.includes(body.actionKey)) {
            const requiredRole = body.actionKey === 'clock_in_police' ? 'police' : body.actionKey === 'clock_in_fire' ? 'fire' : body.actionKey === 'clock_in_ems' ? 'ems' : body.actionKey === 'clock_in_prison' ? 'prison' : null;
            if (requiredRole)
                await requireActorRole(client, body.actorCharacterId, [requiredRole, 'admin'], body.actionKey);
        }
        if (staffActions.includes(body.actionKey))
            await requireActorRole(client, body.actorCharacterId, STAFF_ROLES, body.actionKey);
        const result = await client.query(`INSERT INTO interaction_audits(server_id, actor_character_id, target_character_id, action_key, metadata, allowed)
       VALUES($1,$2,$3,$4,$5,true) RETURNING *`, [serverId(req), body.actorCharacterId, body.targetCharacterId ?? null, body.actionKey, body.metadata]);
        await audit(client, 'interaction_action_request', body.actorCharacterId, body.targetCharacterId ?? null, { actionKey: body.actionKey });
        return { allowed: true, action: result.rows[0] };
    });
    res.json(row);
}));
app.post('/v1/admin/ui-command', asyncRoute(async (req, res) => {
    const body = z.object({
        actorCharacterId: uuid,
        commandKey: z.enum(['kick_notice', 'server_announcement', 'toggle_event', 'spectate_note', 'grant_job', 'clear_stuck_vehicle']),
        targetCharacterId: uuid.optional(),
        payload: z.record(z.any()).default({})
    }).parse(req.body);
    const row = await tx(async (client) => {
        await requireActorRole(client, body.actorCharacterId, STAFF_ROLES, 'Admin/GM UI command');
        await ensureIdempotent(client, req, 'admin/ui-command');
        await audit(client, 'admin_ui_command', body.actorCharacterId, body.targetCharacterId ?? null, { commandKey: body.commandKey, payload: body.payload });
        return { ok: true, commandKey: body.commandKey };
    });
    res.json(row);
}));
// V8 gameplay systems and asset pack APIs
app.get('/v1/assets/vehicles/catalog', asyncRoute(async (_req, res) => {
    const rows = await many('SELECT * FROM vehicle_asset_catalog ORDER BY category, display_name');
    res.json(rows);
}));
app.get('/v1/assets/uniforms/:roleKey', asyncRoute(async (req, res) => {
    const rows = await many('SELECT * FROM uniform_catalog WHERE role_key=$1 ORDER BY display_name', [req.params.roleKey]);
    res.json(rows);
}));
app.get('/v1/assets/clothing/catalog', asyncRoute(async (_req, res) => {
    const rows = await many('SELECT * FROM clothing_catalog ORDER BY category, display_name');
    res.json(rows);
}));
app.get('/v1/items/catalog', asyncRoute(async (_req, res) => {
    const rows = await many('SELECT * FROM item_catalog ORDER BY category, display_name');
    res.json(rows);
}));
app.get('/v1/spawn/resolve', asyncRoute(async (req, res) => {
    const characterId = String(req.query.characterId ?? '');
    const death = String(req.query.afterDeath ?? 'false') === 'true';
    if (!characterId)
        throw new HttpError(400, 'characterId is required', 'missing_character');
    const row = await tx(async (client) => {
        const character = await client.query('SELECT id, death_count FROM characters WHERE id=$1', [characterId]);
        if (!character.rows[0])
            throw new HttpError(404, 'Character not found', 'character_not_found');
        const sentence = await client.query('SELECT id, remaining_seconds, prison_spawn_key FROM jail_sentences WHERE character_id=$1 AND active=true AND remaining_seconds > 0 ORDER BY created_at DESC LIMIT 1', [characterId]);
        if (sentence.rows[0]) {
            const spawnKey = sentence.rows[0].prison_spawn_key ?? 'spawn_prisoner';
            await client.query('INSERT INTO spawn_logs(server_id, character_id, spawn_type, spawn_key, reason) VALUES($1,$2,$3,$4,$5)', [serverId(req), characterId, 'prison', spawnKey, death ? 'death_while_jailed' : 'login_while_jailed']);
            await client.query('UPDATE characters SET last_spawn_type=$1 WHERE id=$2', ['prison', characterId]);
            return { spawnType: 'prison', spawnKey, jailed: true, remainingSeconds: Number(sentence.rows[0].remaining_seconds) };
        }
        const spawnType = death || Number(character.rows[0].death_count ?? 0) > 0 ? 'hospital' : 'first_join';
        const spawnKey = spawnType === 'hospital' ? 'spawn_hospital' : 'spawn_civilian';
        await client.query('INSERT INTO spawn_logs(server_id, character_id, spawn_type, spawn_key, reason) VALUES($1,$2,$3,$4,$5)', [serverId(req), characterId, spawnType, spawnKey, death ? 'death_respawn' : 'login']);
        await client.query('UPDATE characters SET last_spawn_type=$1 WHERE id=$2', [spawnType, characterId]);
        return { spawnType, spawnKey, jailed: false };
    });
    res.json(row);
}));
app.post('/v1/spawn/death', asyncRoute(async (req, res) => {
    const body = z.object({ characterId: uuid, reason: z.string().max(120).optional() }).parse(req.body);
    const row = await tx(async (client) => {
        const sentence = await client.query('SELECT id, remaining_seconds, prison_spawn_key FROM jail_sentences WHERE character_id=$1 AND active=true AND remaining_seconds > 0 ORDER BY created_at DESC LIMIT 1', [body.characterId]);
        const spawnType = sentence.rows[0] ? 'prison' : 'hospital';
        const spawnKey = sentence.rows[0]?.prison_spawn_key ?? 'spawn_hospital';
        const character = await client.query('UPDATE characters SET death_count=death_count+1, last_spawn_type=$1 WHERE id=$2 RETURNING id, death_count, last_spawn_type', [spawnType, body.characterId]);
        await audit(client, 'player_death_spawn_rule', body.characterId, body.characterId, { reason: body.reason ?? null, jailed: Boolean(sentence.rows[0]), nextSpawnKey: spawnKey });
        return { character: character.rows[0], nextSpawnKey: spawnKey, jailed: Boolean(sentence.rows[0]), remainingSeconds: sentence.rows[0] ? Number(sentence.rows[0].remaining_seconds) : 0 };
    });
    res.json({ ok: true, ...row });
}));
app.post('/v1/police/frisk', asyncRoute(async (req, res) => {
    const body = z.object({ officerCharacterId: uuid, targetCharacterId: uuid }).parse(req.body);
    const row = await tx(async (client) => {
        await requireOnDutyRole(client, req, body.officerCharacterId, 'police', 'Police frisk/search');
        const inv = await client.query('SELECT item_key, quantity, metadata FROM inventory_items WHERE character_id=$1 AND quantity > 0 ORDER BY item_key LIMIT 100', [body.targetCharacterId]);
        const cash = await client.query('SELECT cash_cents FROM characters WHERE id=$1', [body.targetCharacterId]);
        const result = await client.query('INSERT INTO police_search_logs(server_id, officer_character_id, target_character_id, search_type, found_items, found_cash_cents) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [serverId(req), body.officerCharacterId, body.targetCharacterId, 'frisk', JSON.stringify(inv.rows), Number(cash.rows[0]?.cash_cents ?? 0)]);
        await audit(client, 'police_frisk', body.officerCharacterId, body.targetCharacterId, { itemCount: inv.rows.length });
        return { search: result.rows[0], items: inv.rows, cashCents: Number(cash.rows[0]?.cash_cents ?? 0) };
    });
    res.json(row);
}));
app.post('/v1/alcohol/drink', asyncRoute(async (req, res) => {
    const body = z.object({ characterId: uuid, itemKey: z.string().default('beer_can') }).parse(req.body);
    const row = await tx(async (client) => {
        if (!(await hasInventoryItem(client, body.characterId, body.itemKey, 1)))
            throw new HttpError(400, 'Player does not have this drink item', 'missing_item');
        const item = await client.query('SELECT metadata FROM item_catalog WHERE item_key=$1', [body.itemKey]);
        const bacAdd = Number(item.rows[0]?.metadata?.bacAdd ?? 0.025);
        await client.query('UPDATE inventory_items SET quantity=quantity-1 WHERE character_id=$1 AND item_key=$2', [body.characterId, body.itemKey]);
        const ch = await client.query('UPDATE characters SET blood_alcohol_level=LEAST(0.400, blood_alcohol_level + $1), alcohol_updated_at=now() WHERE id=$2 RETURNING id, blood_alcohol_level', [bacAdd, body.characterId]);
        await client.query('INSERT INTO alcohol_events(character_id, item_key, bac_added) VALUES($1,$2,$3)', [body.characterId, body.itemKey, bacAdd]);
        return { ok: true, character: ch.rows[0], effect: { impairedControls: true, screenBlur: true, stumbleChance: Math.min(0.75, bacAdd * 10) } };
    });
    res.json(row);
}));
app.post('/v1/police/breathalyse', asyncRoute(async (req, res) => {
    const body = z.object({ officerCharacterId: uuid, targetCharacterId: uuid }).parse(req.body);
    const row = await tx(async (client) => {
        await requireOnDutyRole(client, req, body.officerCharacterId, 'police', 'Police breathalyser');
        const ch = await client.query('SELECT blood_alcohol_level FROM characters WHERE id=$1', [body.targetCharacterId]);
        const bac = Number(ch.rows[0]?.blood_alcohol_level ?? 0);
        const resultText = bac >= 0.08 ? 'positive' : bac > 0.0 ? 'trace' : 'clear';
        const result = await client.query('INSERT INTO breathalyser_logs(server_id, officer_character_id, target_character_id, bac, result) VALUES($1,$2,$3,$4,$5) RETURNING *', [serverId(req), body.officerCharacterId, body.targetCharacterId, bac, resultText]);
        await audit(client, 'police_breathalyser', body.officerCharacterId, body.targetCharacterId, { bac, result: resultText });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/police/radar', asyncRoute(async (req, res) => {
    const body = z.object({ officerCharacterId: uuid, vehicleId: uuid.optional(), plate: z.string().max(16).optional(), speedKph: z.number().int().min(0).max(400), limitKph: z.number().int().min(5).max(200), location: z.record(z.any()).default({}) }).parse(req.body);
    const row = await tx(async (client) => {
        await requireOnDutyRole(client, req, body.officerCharacterId, 'police', 'Police speed radar');
        const result = await client.query('INSERT INTO speed_radar_logs(server_id, officer_character_id, target_vehicle_id, plate, speed_kph, limit_kph, location) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *', [serverId(req), body.officerCharacterId, body.vehicleId ?? null, body.plate ?? null, body.speedKph, body.limitKph, body.location]);
        await audit(client, 'police_speed_radar', body.officerCharacterId, null, { speedKph: body.speedKph, limitKph: body.limitKph, plate: body.plate ?? null });
        return { reading: result.rows[0], overLimit: body.speedKph > body.limitKph };
    });
    res.json(row);
}));
app.get('/v1/radio/channels', asyncRoute(async (_req, res) => {
    const rows = await many('SELECT * FROM radio_channels WHERE enabled=true ORDER BY display_name');
    res.json(rows);
}));
app.post('/v1/radio/select', asyncRoute(async (req, res) => {
    const body = z.object({ characterId: uuid, vehicleId: uuid.optional(), channelKey: z.string().min(1).max(64) }).parse(req.body);
    const row = await tx(async (client) => {
        const channel = await client.query('SELECT * FROM radio_channels WHERE channel_key=$1 AND enabled=true', [body.channelKey]);
        if (!channel.rows[0])
            throw new HttpError(404, 'Radio channel not found', 'radio_not_found');
        await client.query('INSERT INTO radio_play_logs(server_id, character_id, vehicle_id, channel_key) VALUES($1,$2,$3,$4)', [serverId(req), body.characterId, body.vehicleId ?? null, body.channelKey]);
        return channel.rows[0];
    });
    res.json(row);
}));
app.get('/v1/weather/current', asyncRoute(async (req, res) => {
    let row = await one('SELECT * FROM weather_states WHERE server_id=$1', [serverId(req)]);
    if (!row)
        row = await one('INSERT INTO weather_states(server_id, weather_key, intensity, fog, wind) VALUES($1,$2,$3,$4,$5) RETURNING *', [serverId(req), 'clear', 0, 0, 3]);
    res.json(row);
}));
app.post('/v1/weather/tick', asyncRoute(async (req, res) => {
    const body = z.object({ actorCharacterId: uuid.optional(), weatherKey: z.enum(['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow']).optional(), intensity: z.number().min(0).max(1).optional(), fog: z.number().min(0).max(1).optional(), wind: z.number().min(0).max(60).optional() }).parse(req.body);
    const states = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow'];
    const chosen = body.weatherKey ?? states[Math.floor(Math.random() * states.length)];
    const row = await tx(async (client) => {
        if (body.actorCharacterId)
            await requireActorRole(client, body.actorCharacterId, STAFF_ROLES, 'Manual weather change');
        const result = await client.query(`INSERT INTO weather_states(server_id, weather_key, intensity, fog, wind, next_change_at)
      VALUES($1,$2,$3,$4,$5, now() + interval '30 minutes')
      ON CONFLICT(server_id) DO UPDATE SET weather_key=EXCLUDED.weather_key, intensity=EXCLUDED.intensity, fog=EXCLUDED.fog, wind=EXCLUDED.wind, next_change_at=EXCLUDED.next_change_at, updated_at=now()
      RETURNING *`, [serverId(req), chosen, body.intensity ?? (chosen === 'clear' ? 0 : 0.5), body.fog ?? (chosen === 'fog' ? 0.8 : 0.1), body.wind ?? (chosen === 'storm' ? 25 : 6)]);
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/cannabis/plant', asyncRoute(async (req, res) => {
    const body = z.object({ characterId: uuid, plantKey: z.string().min(3).max(80), x: z.number(), y: z.number(), z: z.number(), farmZoneKey: z.string().min(2).max(80).optional() }).parse(req.body);
    const row = await tx(async (client) => {
        if (!(await hasInventoryItem(client, body.characterId, 'weed_seed', 1)))
            throw new HttpError(400, 'Cannabis seed required', 'missing_seed');
        const zones = await client.query('SELECT * FROM cannabis_farm_zones WHERE server_id=$1 AND active=true', [serverId(req)]);
        const zone = zones.rows.find((z) => (!body.farmZoneKey || z.zone_key === body.farmZoneKey) && isInsideFarmZone(body.x, body.y, z));
        if (!zone)
            throw new HttpError(403, 'Weed seeds can only be planted in the designated farmland grow zones.', 'not_in_farm_zone');
        await client.query('UPDATE inventory_items SET quantity=quantity-1 WHERE character_id=$1 AND item_key=$2', [body.characterId, 'weed_seed']);
        const result = await client.query('INSERT INTO cannabis_plants(server_id, owner_character_id, plant_key, x, y, z, metadata) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *', [serverId(req), body.characterId, body.plantKey, body.x, body.y, body.z, JSON.stringify({ farmZoneKey: zone.zone_key })]);
        await audit(client, 'cannabis_plant', body.characterId, null, { plantKey: body.plantKey, farmZoneKey: zone.zone_key });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/cannabis/harvest', asyncRoute(async (req, res) => {
    const body = z.object({ characterId: uuid, plantKey: z.string().min(3).max(80) }).parse(req.body);
    const row = await tx(async (client) => {
        const plant = await client.query('SELECT * FROM cannabis_plants WHERE plant_key=$1 AND harvested=false AND destroyed_at IS NULL FOR UPDATE', [body.plantKey]);
        if (!plant.rows[0])
            throw new HttpError(404, 'Plant not found, destroyed or already harvested', 'plant_not_found');
        if (await hasAnyRole(client, body.characterId, ['police']))
            throw new HttpError(403, 'Police must gather evidence or destroy the plant, not harvest it.', 'police_use_evidence_action');
        if (new Date(plant.rows[0].ready_at).getTime() > Date.now())
            throw new HttpError(400, 'Plant is not ready yet', 'plant_not_ready');
        const yieldQty = 4 + Math.floor(Math.random() * 5);
        await client.query('UPDATE cannabis_plants SET harvested=true, growth_stage=4 WHERE id=$1', [plant.rows[0].id]);
        await client.query(`INSERT INTO inventory_items(character_id, item_key, quantity, metadata) VALUES($1,'weed_bag',$2,'{}'::jsonb)
      ON CONFLICT(character_id, item_key, metadata) DO UPDATE SET quantity=inventory_items.quantity+EXCLUDED.quantity`, [body.characterId, yieldQty]);
        await audit(client, 'cannabis_harvest', body.characterId, null, { plantKey: body.plantKey, yieldQty });
        return { ok: true, itemKey: 'weed_bag', quantity: yieldQty };
    });
    res.json(row);
}));
app.post('/v1/cannabis/police-action', asyncRoute(async (req, res) => {
    const body = z.object({ officerCharacterId: uuid, plantKey: z.string().min(3).max(80), action: z.enum(['gather_evidence', 'destroy']) }).parse(req.body);
    const row = await tx(async (client) => {
        await requireOnDutyRole(client, req, body.officerCharacterId, 'police', 'Cannabis evidence/destruction');
        const plant = await client.query('SELECT * FROM cannabis_plants WHERE plant_key=$1 AND harvested=false AND destroyed_at IS NULL FOR UPDATE', [body.plantKey]);
        if (!plant.rows[0])
            throw new HttpError(404, 'Plant not found, harvested or already destroyed', 'plant_not_found');
        if (body.action === 'gather_evidence') {
            await addCharacterInventoryItem(client, body.officerCharacterId, 'cannabis_evidence_bag', 1, { plantKey: body.plantKey });
            await client.query('UPDATE cannabis_plants SET evidence_collected=true WHERE id=$1', [plant.rows[0].id]);
        }
        else {
            await client.query('UPDATE cannabis_plants SET destroyed_by=$1, destroyed_at=now(), harvested=true WHERE id=$2', [body.officerCharacterId, plant.rows[0].id]);
        }
        const log = await client.query('INSERT INTO cannabis_evidence_logs(server_id, officer_character_id, plant_id, action, metadata) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING *', [serverId(req), body.officerCharacterId, plant.rows[0].id, body.action, JSON.stringify({ plantKey: body.plantKey })]);
        await audit(client, `cannabis_${body.action}`, body.officerCharacterId, plant.rows[0].owner_character_id, { plantKey: body.plantKey });
        return log.rows[0];
    });
    res.json(row);
}));
app.post('/v1/cannabis/sell', asyncRoute(async (req, res) => {
    const body = z.object({ characterId: uuid, dealerKey: z.string().min(2).max(80), quantity: z.number().int().min(1).max(100) }).parse(req.body);
    const row = await tx(async (client) => {
        if (!(await hasInventoryItem(client, body.characterId, 'weed_bag', body.quantity)))
            throw new HttpError(400, 'Not enough weed bags', 'missing_weed');
        const payout = body.quantity * 3500;
        await client.query('UPDATE inventory_items SET quantity=quantity-$1 WHERE character_id=$2 AND item_key=$3', [body.quantity, body.characterId, 'weed_bag']);
        await client.query('UPDATE characters SET cash_cents=cash_cents+$1 WHERE id=$2', [payout, body.characterId]);
        await audit(client, 'cannabis_sell_blackmarket', body.characterId, null, { dealerKey: body.dealerKey, quantity: body.quantity, payout });
        return { ok: true, payoutCents: payout };
    });
    res.json(row);
}));
app.post('/v1/restraints/ziptie', asyncRoute(async (req, res) => {
    const body = z.object({ actorCharacterId: uuid, targetCharacterId: uuid }).parse(req.body);
    const row = await tx(async (client) => {
        if (!(await hasInventoryItem(client, body.actorCharacterId, 'zip_ties', 1)))
            throw new HttpError(400, 'Zip ties required', 'missing_zip_ties');
        await client.query('UPDATE inventory_items SET quantity=quantity-1 WHERE character_id=$1 AND item_key=$2', [body.actorCharacterId, 'zip_ties']);
        const result = await client.query('INSERT INTO restraint_logs(server_id, actor_character_id, target_character_id, restraint_type, action) VALUES($1,$2,$3,$4,$5) RETURNING *', [serverId(req), body.actorCharacterId, body.targetCharacterId, 'zip_tie', 'apply']);
        await audit(client, 'ziptie_apply', body.actorCharacterId, body.targetCharacterId, {});
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/restraints/release', asyncRoute(async (req, res) => {
    const body = z.object({ actorCharacterId: uuid, targetCharacterId: uuid, restraintType: z.enum(['zip_tie', 'handcuff']).default('zip_tie') }).parse(req.body);
    const row = await tx(async (client) => {
        const result = await client.query('INSERT INTO restraint_logs(server_id, actor_character_id, target_character_id, restraint_type, action) VALUES($1,$2,$3,$4,$5) RETURNING *', [serverId(req), body.actorCharacterId, body.targetCharacterId, body.restraintType, 'release']);
        await audit(client, 'restraint_release', body.actorCharacterId, body.targetCharacterId, { restraintType: body.restraintType });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/ems/stretcher', asyncRoute(async (req, res) => {
    const body = z.object({ emsCharacterId: uuid, patientCharacterId: uuid, ambulanceVehicleId: uuid.optional(), action: z.enum(['deploy', 'load_patient', 'unload_patient', 'stow']) }).parse(req.body);
    const row = await tx(async (client) => {
        await requireOnDutyRole(client, req, body.emsCharacterId, 'ems', 'EMS stretcher');
        const result = await client.query('INSERT INTO stretcher_events(server_id, ems_character_id, patient_character_id, ambulance_vehicle_id, action) VALUES($1,$2,$3,$4,$5) RETURNING *', [serverId(req), body.emsCharacterId, body.patientCharacterId, body.ambulanceVehicleId ?? null, body.action]);
        await audit(client, 'ems_stretcher', body.emsCharacterId, body.patientCharacterId, { action: body.action });
        return result.rows[0];
    });
    res.json(row);
}));
// V9: persistent inventory containers, vehicle trunks, wearable clothing storage and online-only prison helper APIs.
app.get('/v1/inventory/loadout/:characterId', asyncRoute(async (req, res) => {
    const characterId = req.params.characterId;
    const result = await tx(async (client) => {
        const personal = await client.query('SELECT item_key, quantity, metadata FROM inventory_items WHERE character_id=$1 AND quantity > 0 ORDER BY item_key', [characterId]);
        const clothing = await client.query(`SELECT cc.*, c.display_name, c.has_inventory, c.slot_cap, c.weight_limit_grams
       FROM character_clothing cc JOIN clothing_catalog c ON c.clothing_key=cc.clothing_key
       WHERE cc.character_id=$1 AND cc.equipped=true ORDER BY cc.created_at`, [characterId]);
        const clothingContainers = [];
        for (const c of clothing.rows) {
            if (c.container_id)
                clothingContainers.push(await listContainer(client, c.container_id));
        }
        return { characterId, personalInventory: personal.rows, equippedClothing: clothing.rows, clothingContainers };
    });
    res.json(result);
}));
app.get('/v1/inventory/vehicle/:vehicleId/trunk', asyncRoute(async (req, res) => {
    const vehicleId = String(req.params.vehicleId);
    const result = await tx(async (client) => {
        const vehicle = await client.query('SELECT * FROM vehicles WHERE id=$1', [vehicleId]);
        if (!vehicle.rows[0])
            throw new HttpError(404, 'Vehicle not found', 'vehicle_not_found');
        const v = vehicle.rows[0];
        if (v.trunk_enabled === false)
            throw new HttpError(400, 'This vehicle has no trunk storage', 'trunk_disabled');
        const container = await ensureInventoryContainer(client, {
            ownerType: 'vehicle_trunk', ownerId: vehicleId, vehicleId,
            label: `${v.display_name} Trunk`, slotCap: Number(v.trunk_slot_cap ?? 20), weightLimitGrams: Number(v.trunk_weight_limit_grams ?? 100000),
            metadata: { plate: v.plate }
        });
        return await listContainer(client, container.id);
    });
    res.json(result);
}));
app.post('/v1/inventory/vehicle/trunk/deposit', asyncRoute(async (req, res) => {
    const body = z.object({ actorCharacterId: uuid, vehicleId: uuid, itemKey: z.string().min(1).max(80), quantity: z.number().int().min(1).max(100) }).parse(req.body);
    const result = await tx(async (client) => {
        const vehicle = await client.query('SELECT * FROM vehicles WHERE id=$1 FOR UPDATE', [body.vehicleId]);
        if (!vehicle.rows[0])
            throw new HttpError(404, 'Vehicle not found', 'vehicle_not_found');
        if (vehicle.rows[0].owner_character_id && vehicle.rows[0].owner_character_id !== body.actorCharacterId && !(await hasAnyRole(client, body.actorCharacterId, STAFF_ROLES))) {
            throw new HttpError(403, 'Only the owner or staff can use this persistent trunk from the backend. Use Workbench proximity/keys for shared access.', 'not_vehicle_owner');
        }
        const container = await ensureInventoryContainer(client, {
            ownerType: 'vehicle_trunk', ownerId: body.vehicleId, vehicleId: body.vehicleId,
            label: `${vehicle.rows[0].display_name} Trunk`, slotCap: Number(vehicle.rows[0].trunk_slot_cap ?? 20), weightLimitGrams: Number(vehicle.rows[0].trunk_weight_limit_grams ?? 100000),
            metadata: { plate: vehicle.rows[0].plate }
        });
        await assertContainerCanFit(client, container.id, body.itemKey, body.quantity);
        await removeCharacterInventoryItem(client, body.actorCharacterId, body.itemKey, body.quantity);
        await addContainerItem(client, container.id, body.itemKey, body.quantity);
        await audit(client, 'vehicle_trunk_deposit', body.actorCharacterId, vehicle.rows[0].owner_character_id ?? null, { vehicleId: body.vehicleId, itemKey: body.itemKey, quantity: body.quantity });
        return await listContainer(client, container.id);
    });
    res.json(result);
}));
app.post('/v1/inventory/vehicle/trunk/withdraw', asyncRoute(async (req, res) => {
    const body = z.object({ actorCharacterId: uuid, vehicleId: uuid, itemKey: z.string().min(1).max(80), quantity: z.number().int().min(1).max(100) }).parse(req.body);
    const result = await tx(async (client) => {
        const vehicle = await client.query('SELECT * FROM vehicles WHERE id=$1 FOR UPDATE', [body.vehicleId]);
        if (!vehicle.rows[0])
            throw new HttpError(404, 'Vehicle not found', 'vehicle_not_found');
        if (vehicle.rows[0].owner_character_id && vehicle.rows[0].owner_character_id !== body.actorCharacterId && !(await hasAnyRole(client, body.actorCharacterId, STAFF_ROLES))) {
            throw new HttpError(403, 'Only the owner or staff can use this persistent trunk from the backend. Use Workbench proximity/keys for shared access.', 'not_vehicle_owner');
        }
        const container = await ensureInventoryContainer(client, {
            ownerType: 'vehicle_trunk', ownerId: body.vehicleId, vehicleId: body.vehicleId,
            label: `${vehicle.rows[0].display_name} Trunk`, slotCap: Number(vehicle.rows[0].trunk_slot_cap ?? 20), weightLimitGrams: Number(vehicle.rows[0].trunk_weight_limit_grams ?? 100000),
            metadata: { plate: vehicle.rows[0].plate }
        });
        await removeContainerItem(client, container.id, body.itemKey, body.quantity);
        await addCharacterInventoryItem(client, body.actorCharacterId, body.itemKey, body.quantity);
        await audit(client, 'vehicle_trunk_withdraw', body.actorCharacterId, vehicle.rows[0].owner_character_id ?? null, { vehicleId: body.vehicleId, itemKey: body.itemKey, quantity: body.quantity });
        return await listContainer(client, container.id);
    });
    res.json(result);
}));
app.post('/v1/inventory/clothing/equip', asyncRoute(async (req, res) => {
    const body = z.object({ characterId: uuid, clothingKey: z.string().min(2).max(80), variant: z.string().max(40).optional() }).parse(req.body);
    const result = await tx(async (client) => {
        const catalog = await client.query('SELECT * FROM clothing_catalog WHERE clothing_key=$1', [body.clothingKey]);
        if (!catalog.rows[0])
            throw new HttpError(404, 'Clothing item not found', 'clothing_not_found');
        const c = catalog.rows[0];
        const item = await client.query('INSERT INTO character_clothing(character_id, clothing_key, clothing_category, variant, equipped) VALUES($1,$2,$3,$4,true) RETURNING *', [body.characterId, body.clothingKey, c.category, body.variant ?? null]);
        let container = null;
        if (c.has_inventory === true) {
            container = await ensureInventoryContainer(client, {
                ownerType: 'clothing', ownerId: item.rows[0].id, characterId: body.characterId, clothingInstanceId: item.rows[0].id,
                label: `${c.display_name} Storage`, slotCap: Number(c.slot_cap ?? 0), weightLimitGrams: Number(c.weight_limit_grams ?? 0),
                metadata: { clothingKey: body.clothingKey, category: c.category, variant: body.variant ?? null }
            });
            await client.query('UPDATE character_clothing SET container_id=$1 WHERE id=$2', [container.id, item.rows[0].id]);
        }
        await audit(client, 'clothing_equip', body.characterId, body.characterId, { clothingKey: body.clothingKey, hasInventory: c.has_inventory === true });
        return { clothing: { ...item.rows[0], container_id: container?.id ?? null }, container, hasInventory: c.has_inventory === true };
    });
    res.json(result);
}));
app.get('/v1/inventory/clothing/:clothingInstanceId', asyncRoute(async (req, res) => {
    const clothingInstanceId = String(req.params.clothingInstanceId);
    const result = await tx(async (client) => {
        const clothing = await client.query(`SELECT cc.*, c.display_name, c.has_inventory, c.slot_cap, c.weight_limit_grams
       FROM character_clothing cc JOIN clothing_catalog c ON c.clothing_key=cc.clothing_key
       WHERE cc.id=$1`, [clothingInstanceId]);
        if (!clothing.rows[0])
            throw new HttpError(404, 'Clothing instance not found', 'clothing_instance_not_found');
        if (clothing.rows[0].has_inventory !== true || !clothing.rows[0].container_id) {
            return { clothing: clothing.rows[0], container: null, items: [], message: 'This clothing item does not provide inventory storage.' };
        }
        return { clothing: clothing.rows[0], ...(await listContainer(client, clothing.rows[0].container_id)) };
    });
    res.json(result);
}));
app.post('/v1/inventory/clothing/deposit', asyncRoute(async (req, res) => {
    const body = z.object({ characterId: uuid, clothingInstanceId: uuid, itemKey: z.string().min(1).max(80), quantity: z.number().int().min(1).max(100) }).parse(req.body);
    const result = await tx(async (client) => {
        const clothing = await client.query('SELECT * FROM character_clothing WHERE id=$1 AND character_id=$2 AND equipped=true FOR UPDATE', [body.clothingInstanceId, body.characterId]);
        if (!clothing.rows[0] || !clothing.rows[0].container_id)
            throw new HttpError(404, 'Clothing storage not found', 'clothing_storage_not_found');
        await assertContainerCanFit(client, clothing.rows[0].container_id, body.itemKey, body.quantity);
        await removeCharacterInventoryItem(client, body.characterId, body.itemKey, body.quantity);
        await addContainerItem(client, clothing.rows[0].container_id, body.itemKey, body.quantity);
        await audit(client, 'clothing_storage_deposit', body.characterId, body.characterId, { clothingInstanceId: body.clothingInstanceId, itemKey: body.itemKey, quantity: body.quantity });
        return await listContainer(client, clothing.rows[0].container_id);
    });
    res.json(result);
}));
app.post('/v1/inventory/clothing/withdraw', asyncRoute(async (req, res) => {
    const body = z.object({ characterId: uuid, clothingInstanceId: uuid, itemKey: z.string().min(1).max(80), quantity: z.number().int().min(1).max(100) }).parse(req.body);
    const result = await tx(async (client) => {
        const clothing = await client.query('SELECT * FROM character_clothing WHERE id=$1 AND character_id=$2 AND equipped=true FOR UPDATE', [body.clothingInstanceId, body.characterId]);
        if (!clothing.rows[0] || !clothing.rows[0].container_id)
            throw new HttpError(404, 'Clothing storage not found', 'clothing_storage_not_found');
        await removeContainerItem(client, clothing.rows[0].container_id, body.itemKey, body.quantity);
        await addCharacterInventoryItem(client, body.characterId, body.itemKey, body.quantity);
        await audit(client, 'clothing_storage_withdraw', body.characterId, body.characterId, { clothingInstanceId: body.clothingInstanceId, itemKey: body.itemKey, quantity: body.quantity });
        return await listContainer(client, clothing.rows[0].container_id);
    });
    res.json(result);
}));
// V12 Yellowstone RP court, admin panel, model selection, farm zones and server metadata
app.get('/v1/server/settings', asyncRoute(async (_req, res) => {
    res.json({
        serverName: 'Yellowstone RP',
        projectName: 'YellowstoneRP',
        mapName: 'Yellowstone County, Montana',
        consoleProfile: 'Xbox Series S friendly',
        loadingScreen: '{YellowstoneRP}UI/LoadingScreens/YellowstoneDrift.png',
        loadingMusic: '{YellowstoneRP}Sounds/Music/YellowstoneDrift.mp3'
    });
}));
app.get('/v1/characters/models', asyncRoute(async (_req, res) => {
    const rows = await many('SELECT * FROM character_model_catalog WHERE active=true ORDER BY gender, display_name');
    res.json(rows);
}));
app.post('/v1/court/date', asyncRoute(async (req, res) => {
    const body = z.object({
        officerCharacterId: uuid,
        targetCharacterId: uuid,
        charges: z.array(z.string().min(2).max(120)).min(1).max(12),
        scheduledAt: z.string().datetime(),
        locationKey: z.string().min(2).max(80).default('yellowstone_courthouse'),
        notes: z.string().max(500).optional()
    }).parse(req.body);
    const row = await tx(async (client) => {
        await requireOnDutyRole(client, req, body.officerCharacterId, 'police', 'Court date issue');
        const defendantName = await characterDisplayName(client, body.targetCharacterId);
        const officerName = await characterDisplayName(client, body.officerCharacterId);
        const result = await client.query(`INSERT INTO court_cases(server_id, defendant_character_id, issued_by_character_id, location_key, scheduled_at, charges, notes)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *`, [serverId(req), body.targetCharacterId, body.officerCharacterId, body.locationKey, body.scheduledAt, JSON.stringify(body.charges), body.notes ?? null]);
        await audit(client, 'court_date_issue', body.officerCharacterId, body.targetCharacterId, { scheduledAt: body.scheduledAt, charges: body.charges });
        await client.query('INSERT INTO discord_event_queue(event_type, payload, status) VALUES($1,$2,$3)', ['court_date', { defendantName, officerName, scheduledAt: body.scheduledAt, charges: body.charges, locationKey: body.locationKey }, 'queued']);
        return { ...result.rows[0], defendantName, officerName };
    });
    await postDiscordWebhook(process.env.DISCORD_COURT_WEBHOOK_URL, buildDiscordEmbed('Court Date Issued', 'A court date has been created for Yellowstone RP.', [
        { name: 'Player', value: row.defendantName ?? String(body.targetCharacterId), inline: true },
        { name: 'Officer', value: row.officerName ?? String(body.officerCharacterId), inline: true },
        { name: 'Date / Time', value: new Date(body.scheduledAt).toLocaleString('en-GB'), inline: true },
        { name: 'Location', value: 'Yellowstone Courthouse', inline: true },
        { name: 'Charges', value: body.charges.join('\n'), inline: false }
    ], 0x2f80ed));
    res.json(row);
}));
app.get('/v1/court/upcoming', asyncRoute(async (req, res) => {
    const status = z.enum(['scheduled', 'attended', 'missed', 'cancelled', 'resolved']).optional().parse(req.query.status ?? undefined);
    const rows = await many(`SELECT cc.*, c.first_name, c.last_name, c.character_code
     FROM court_cases cc
     LEFT JOIN characters c ON c.id=cc.defendant_character_id
     WHERE cc.server_id=$1 AND ($2::text IS NULL OR cc.status=$2)
     ORDER BY cc.scheduled_at ASC LIMIT 100`, [serverId(req), status ?? null]);
    res.json(rows);
}));
app.post('/v1/court/resolve', asyncRoute(async (req, res) => {
    const body = z.object({ actorCharacterId: uuid, caseId: uuid, status: z.enum(['attended', 'missed', 'cancelled', 'resolved']), resultNotes: z.string().max(1000).optional() }).parse(req.body);
    const row = await tx(async (client) => {
        await requireActorRole(client, body.actorCharacterId, ['police', 'admin', 'gm'], 'Court case update');
        const result = await client.query('UPDATE court_cases SET status=$1, result_notes=$2, updated_at=now() WHERE id=$3 RETURNING *', [body.status, body.resultNotes ?? null, body.caseId]);
        if (!result.rows[0])
            throw new HttpError(404, 'Court case not found', 'court_case_not_found');
        await audit(client, 'court_case_update', body.actorCharacterId, result.rows[0].defendant_character_id, { caseId: body.caseId, status: body.status });
        return result.rows[0];
    });
    res.json(row);
}));
app.get('/v1/world/farm-zones', asyncRoute(async (req, res) => {
    const rows = await many('SELECT * FROM cannabis_farm_zones WHERE server_id=$1 AND active=true ORDER BY zone_key', [serverId(req)]);
    res.json(rows);
}));
app.post('/v1/admin/login', asyncRoute(async (req, res) => {
    const body = z.object({ password: z.string().min(1), characterId: uuid.optional(), platformUid: z.string().optional() }).parse(req.body);
    if (!adminPasswordMatches(body.password))
        throw new HttpError(401, 'Wrong admin password', 'bad_admin_password');
    const row = await tx(async (client) => {
        const token = newAdminToken();
        const minutes = Number(process.env.ADMIN_SESSION_MINUTES ?? 120);
        const result = await client.query(`INSERT INTO admin_panel_sessions(session_token, character_id, platform_uid, expires_at)
       VALUES($1,$2,$3, now() + ($4::text)::interval) RETURNING id, character_id, platform_uid, active, created_at, expires_at`, [token, body.characterId ?? null, body.platformUid ?? null, `${minutes} minutes`]);
        if (body.characterId)
            await client.query('INSERT INTO role_assignments(character_id, role_key, rank_key, active) VALUES($1,$2,$3,true) ON CONFLICT(character_id, role_key) DO UPDATE SET active=true', [body.characterId, 'admin', 'owner']);
        await audit(client, 'admin_panel_login', body.characterId ?? null, null, { platformUid: body.platformUid ?? null });
        return { ...result.rows[0], token };
    });
    res.json(row);
}));
app.post('/v1/admin/panel-command', asyncRoute(async (req, res) => {
    const body = z.object({
        token: z.string().min(20),
        commandKey: z.enum(['god_on', 'god_off', 'invisibility_on', 'invisibility_off', 'tp_me_to_player', 'tp_player_to_me', 'lightning_strike', 'pit', 'ban', 'give_money', 'take_money', 'spawn_unclaimed_vehicle', 'delete_vehicle_front']),
        actorCharacterId: uuid.optional(),
        targetCharacterId: uuid.optional(),
        vehicleId: uuid.optional(),
        amountCents: z.number().int().min(1).max(100000000).optional(),
        account: z.enum(['cash', 'bank']).optional(),
        vehicleStockKey: z.string().max(80).optional(),
        location: z.object({ x: z.number(), y: z.number(), z: z.number(), heading: z.number().optional() }).optional(),
        reason: z.string().max(240).optional()
    }).parse(req.body);
    const row = await tx(async (client) => {
        const session = await requireAdminPanelSession(client, body.token);
        const actorId = body.actorCharacterId ?? session.character_id ?? null;
        const command = body.commandKey;
        let result = { ok: true, commandKey: command };
        if (command === 'god_on' || command === 'god_off' || command === 'invisibility_on' || command === 'invisibility_off') {
            if (!actorId)
                throw new HttpError(400, 'This command needs the admin character id', 'missing_admin_character');
            const updates = {};
            if (command.startsWith('god_'))
                updates.godMode = command === 'god_on';
            if (command.startsWith('invisibility_'))
                updates.invisible = command === 'invisibility_on';
            await client.query(`INSERT INTO admin_character_state(character_id, god_mode, invisible)
         VALUES($1,$2,$3)
         ON CONFLICT(character_id) DO UPDATE SET god_mode=COALESCE($2, admin_character_state.god_mode), invisible=COALESCE($3, admin_character_state.invisible), updated_at=now()`, [actorId, updates.godMode ?? null, updates.invisible ?? null]);
            result.state = updates;
        }
        if (command === 'give_money' || command === 'take_money') {
            if (!body.targetCharacterId || !body.amountCents || !body.account)
                throw new HttpError(400, 'Money command needs target, amount and account', 'missing_money_args');
            const column = body.account === 'cash' ? 'cash_cents' : 'bank_cents';
            const sign = command === 'give_money' ? '+' : '-';
            if (command === 'take_money') {
                const bal = await client.query(`SELECT ${column} FROM characters WHERE id=$1 FOR UPDATE`, [body.targetCharacterId]);
                if (!bal.rows[0])
                    throw new HttpError(404, 'Target not found', 'target_not_found');
                if (Number(bal.rows[0][column]) < body.amountCents)
                    throw new HttpError(400, 'Target does not have enough money', 'not_enough_money');
            }
            await client.query(`UPDATE characters SET ${column}=${column}${sign}$1, updated_at=now() WHERE id=$2`, [body.amountCents, body.targetCharacterId]);
            result.amountCents = body.amountCents;
        }
        if (command === 'ban') {
            if (!body.targetCharacterId)
                throw new HttpError(400, 'Ban needs target', 'missing_target');
            await client.query(`UPDATE players SET is_banned=true, notes=COALESCE(notes,'') || $1 WHERE id=(SELECT player_id FROM characters WHERE id=$2)`, [`\nAdmin ban: ${body.reason ?? 'No reason provided'}`, body.targetCharacterId]);
        }
        if (command === 'pit') {
            if (!body.targetCharacterId)
                throw new HttpError(400, 'PIT needs target', 'missing_target');
            const pitX = Number(process.env.PIT_LOCATION_X ?? 3600), pitY = Number(process.env.PIT_LOCATION_Y ?? -3200), pitZ = Number(process.env.PIT_LOCATION_Z ?? 0);
            await client.query(`INSERT INTO pit_states(character_id, pit_x, pit_y, pit_z, reason, active) VALUES($1,$2,$3,$4,$5,true)
        ON CONFLICT(character_id) DO UPDATE SET pit_x=EXCLUDED.pit_x, pit_y=EXCLUDED.pit_y, pit_z=EXCLUDED.pit_z, reason=EXCLUDED.reason, active=true, updated_at=now()`, [body.targetCharacterId, pitX, pitY, pitZ, body.reason ?? 'Admin PIT']);
            result.location = { x: pitX, y: pitY, z: pitZ };
        }
        if (command === 'spawn_unclaimed_vehicle') {
            if (!body.vehicleStockKey || !body.location)
                throw new HttpError(400, 'Spawn vehicle needs stock key and location', 'missing_spawn_args');
            const stock = await client.query('SELECT * FROM vehicle_shop_stock WHERE stock_key=$1 AND active=true LIMIT 1', [body.vehicleStockKey]);
            if (!stock.rows[0])
                throw new HttpError(404, 'Vehicle stock not found', 'vehicle_stock_not_found');
            const plate = `ADM${Math.floor(1000 + Math.random() * 8999)}`;
            const resultVehicle = await client.query(`INSERT INTO vehicles(plate, prefab_resource, display_name, stored, world_x, world_y, world_z, admin_spawned, claimable)
        VALUES($1,$2,$3,false,$4,$5,$6,true,true) RETURNING *`, [plate, stock.rows[0].prefab_resource, stock.rows[0].display_name, body.location.x, body.location.y, body.location.z]);
            result.vehicle = resultVehicle.rows[0];
        }
        if (command === 'delete_vehicle_front') {
            if (!body.vehicleId)
                throw new HttpError(400, 'Delete vehicle needs vehicleId', 'missing_vehicle');
            await client.query('UPDATE vehicles SET admin_deleted=true, stored=true, updated_at=now() WHERE id=$1', [body.vehicleId]);
        }
        if (command === 'tp_me_to_player' || command === 'tp_player_to_me' || command === 'lightning_strike') {
            if (!body.targetCharacterId)
                throw new HttpError(400, 'Command needs selected player', 'missing_target');
            result.requiresClientAction = true;
        }
        await client.query('INSERT INTO admin_action_logs(session_id, actor_character_id, target_character_id, command_key, payload) VALUES($1,$2,$3,$4,$5::jsonb)', [session.id, actorId, body.targetCharacterId ?? null, command, JSON.stringify(body)]);
        await audit(client, 'admin_panel_command', actorId, body.targetCharacterId ?? null, { commandKey: command });
        return result;
    });
    res.json(row);
}));
app.get('/v1/admin/pit-state/:characterId', asyncRoute(async (req, res) => {
    const row = await one('SELECT * FROM pit_states WHERE character_id=$1 AND active=true', [req.params.characterId]);
    res.json(row ?? null);
}));
app.post('/v1/admin/claim-spawned-vehicle', asyncRoute(async (req, res) => {
    const body = z.object({ characterId: uuid, vehicleId: uuid }).parse(req.body);
    const row = await tx(async (client) => {
        const vehicle = await client.query('SELECT * FROM vehicles WHERE id=$1 AND admin_spawned=true AND claimable=true AND owner_character_id IS NULL FOR UPDATE', [body.vehicleId]);
        if (!vehicle.rows[0])
            throw new HttpError(404, 'Claimable vehicle not found', 'claimable_vehicle_not_found');
        const result = await client.query('UPDATE vehicles SET owner_character_id=$1, registered_owner_character_id=$1, claimable=false, updated_at=now() WHERE id=$2 RETURNING *', [body.characterId, body.vehicleId]);
        await audit(client, 'admin_spawned_vehicle_claimed', body.characterId, body.characterId, { vehicleId: body.vehicleId });
        return result.rows[0];
    });
    res.json(row);
}));
app.post('/v1/police/loadout/claim', asyncRoute(async (req, res) => {
    const body = z.object({ officerCharacterId: uuid, loadoutKey: z.enum(['standard_patrol', 'rifle_authorised']).default('standard_patrol') }).parse(req.body);
    const row = await tx(async (client) => {
        await requireOnDutyRole(client, req, body.officerCharacterId, 'police', 'Police loadout');
        const items = body.loadoutKey === 'rifle_authorised' ? ['m9_service_pistol', 'm4_service_rifle'] : ['m9_service_pistol', 'taser', 'baton'];
        for (const item of items)
            await addCharacterInventoryItem(client, body.officerCharacterId, item, 1);
        await audit(client, 'police_loadout_claim', body.officerCharacterId, body.officerCharacterId, { loadoutKey: body.loadoutKey, items });
        return { ok: true, items };
    });
    res.json(row);
}));
app.use(errorHandler);
const port = Number(process.env.PORT ?? 3100);
app.listen(port, () => console.log(`YellowstoneRP backend v12 running on :${port}`));
