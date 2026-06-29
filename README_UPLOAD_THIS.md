YellowstoneRP Backend Railway Dockerfile Fix

UPLOAD THESE FILES TO THE ROOT OF YOUR GITHUB REPO:
- Dockerfile
- package.json
- railway.json
- nixpacks.toml
- Procfile
- .dockerignore

Do NOT upload this folder itself. Upload the files inside it.

VERY IMPORTANT:
Your repo must still keep the existing dist folder:
- dist/index.js
- dist/db.js
- dist/middleware.js

DELETE OR IGNORE:
- package-lock.json

The Dockerfile intentionally ignores package-lock.json because your current GitHub package-lock appears broken/empty.
Railway should now show it is using Dockerfile, not Nixpacks.

Expected Railway build log:
- Using Dockerfile
- npm install --omit=dev --no-audit --no-fund --no-package-lock
- Runtime dependencies installed OK
- node dist/index.js

After deploy, test:
https://YOUR-RAILWAY-DOMAIN.up.railway.app/health

If you still see Express missing, Railway is not using the Dockerfile or the files were uploaded into a subfolder by mistake.
