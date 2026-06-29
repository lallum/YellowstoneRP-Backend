# YellowstoneRP Backend Railway Fix

Upload every file and folder in this ZIP to the root of your GitHub repo:

`lallum/YellowstoneRP-Backend`

Replace the existing files when GitHub asks.

## What this fixes

- Adds a valid `package-lock.json` so Railway can use `npm ci`.
- Uses Node 20.
- Uses the uploaded `dist` folder, so Railway does not need TypeScript/tsc to build.
- Ensures `express`, `cors`, `helmet`, `dotenv`, `pg`, and `zod` install as production dependencies.
- Makes `/health` return HTTP 200 as long as the server is alive, so Railway healthcheck will not fail just because Supabase is temporarily unreachable.
- Adds `/health/db` for checking Supabase separately.

## Railway variables needed

Set these in Railway > YellowstoneRP-Backend > Variables:

```env
NODE_ENV=production
PORT=3100
DATABASE_URL=your_supabase_postgres_connection_string_with_sslmode_require
YELLOWSTONERP_API_KEY=make_a_long_private_key
YELLOWSTONERP_SERVER_ID=yellowstone-rp-main
ADMIN_PASSWORD=RedBull1
PROPERTY_DOOR_CODE_SECRET=make_a_long_private_secret
VEHICLE_ENTRY_CODE_SECRET=make_a_long_private_secret
COURT_DISCORD_WEBHOOK_URL=optional_discord_webhook
JAIL_DISCORD_WEBHOOK_URL=optional_discord_webhook
```

## After upload

1. Commit changes to the `main` branch.
2. Redeploy on Railway.
3. Test:
   - `https://your-railway-domain/health`
   - `https://your-railway-domain/health/db`

`/health` should be used for Railway healthcheck.
`/health/db` is for checking Supabase/PostgreSQL.
