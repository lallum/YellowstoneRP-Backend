# StonePineRP Glenwood backend integration

This package keeps the existing YellowstoneRP database/project identity internally while exposing StonePineRP-branded `/v2` endpoints.

## Deployment order

1. Back up the Supabase database.
2. Run the existing `YellowstoneRP_Database_Schema.sql` only for a new/empty database.
3. Run `migrations/20260719_stonepine_identity_jobs_duty.sql` against the existing database.
4. In Railway Variables, set `DATABASE_URL`, `STONEPINERP_API_KEY`, and `STONEPINERP_SERVER_ID`.
5. Deploy this package. Railway starts `node dist/index.js`.
6. Confirm `/health` and `/health/db` return `ok: true`.

## Core StonePine endpoints

- `POST /v2/game/character-bootstrap` (flat game-client bootstrap response)
- `POST /v2/characters/register`
- `GET /v2/characters/by-platform/:platformUid`
- `GET /v2/characters/:characterId`
- `POST /v2/characters/update-profile`
- `POST /v2/characters/name-change/request`
- `POST /v2/admin/name-change/approve`
- `GET /v2/jobs`
- `POST /v2/jobs/select`
- `POST /v2/duty/clock-in`
- `POST /v2/duty/clock-out`
- `POST /v2/duty/status`
- `POST /v2/players/offline`
- `POST /v2/money/transfer`

Authenticated requests can send the secret and server ID as headers or JSON body fields:

```json
{
  "apiKey": "YOUR_PRIVATE_KEY",
  "serverId": "stonepine-rp-glenwood-main"
}
```

Never put the database password or Supabase service-role key inside a client-distributed Arma addon. The dedicated server should call this API.

## Game bridge flow

The StonePine addon sends a player-owned reliable RPC to the authoritative game server. The game server reads `$profile:StonePineRP/BackendRuntime.json` and calls this API. The client addon never receives the private API key or database connection string.

The `/v2/game/character-bootstrap` endpoint returns a flat response so Enfusion can load the resident profile, StonePine ID, job and whitelist role during first spawn.
