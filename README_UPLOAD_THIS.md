UPLOAD THIS FOLDER TO RAILWAY
=============================

This is the StonePineRP-compatible backend that keeps the existing YellowstoneRP
PostgreSQL schema internally.

Before deployment:
1. Back up Supabase.
2. Run database/YellowstoneRP_Database_Schema.sql only for a NEW empty database.
3. For an existing database, run migrations/20260719_stonepine_identity_jobs_duty.sql.
4. Configure Railway Variables from .env.example.
5. Deploy with the included Dockerfile.
6. Check /health and /health/db.

Do not upload a real .env file or place database secrets in the Arma Workshop addon.
