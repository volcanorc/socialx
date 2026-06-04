# SocialX

SocialX is a static GitHub Pages frontend for an identity and account relationship manager backed by Neon Auth and Neon Postgres.

## What is implemented

- Google-only sign-in through Neon Auth
- Static GitHub Pages-friendly SPA
- Global search across accounts, relationships, notes, and custom fields
- Add/edit/archive/delete account flows
- Parent-child relationship graph
- Dynamic custom fields
- Activity log and export/import UI
- Neon schema file with RLS and indexes
- Neon-backed persistence adapter with local fallback cache
- Client-side encrypted secret storage

## Files

- `index.html` bootstraps the app and inline config
- `styles.css` contains the full visual system
- `src/main.js` renders the SPA and handles auth, search, forms, and routing
- `src/store.js` contains the normalized account graph state layer and Neon sync
- `src/auth.js` connects to Neon Auth
- `src/neon.js` loads the Neon SDK in the browser
- `sql/schema.sql` is the Neon migration/schema source of truth

## Runtime model

The frontend is a static app and uses Neon Auth for Google login. The account graph is hydrated from Neon Postgres through the Neon Data API when `neonDataApiUrl` is provided in `window.SOCIALX_CONFIG`. If the Data API URL is missing or unavailable, the store falls back to the local browser cache so import/export and draft work can still continue.

## Neon setup reminder

- Trusted domains:
  - `http://127.0.0.1:3001`
  - `https://volcanorc.github.io`
- Google authorized redirect URIs:
  - `http://127.0.0.1:3001/api/auth/callback/google`
  - `https://ep-nameless-bar-ao306hfx.neonauth.c-2.ap-southeast-1.aws.neon.tech/neondb/auth/callback/google`
- Neon Data API URL:
  - `https://br-falling-wind-ao9pabrj.data-api.neon.tech`

## Next step

Paste the Neon Data API URL into `window.SOCIALX_CONFIG.neonDataApiUrl`, then reload the app. Once that is set, SocialX will use Neon Postgres as the primary storage layer and keep the local browser cache as a fallback only.
