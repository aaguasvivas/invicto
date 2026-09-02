# INVICTO

Baseball streak game: can you run the table? Mobile-first web game.

## Stack
TypeScript + Vite, Cloudflare Worker backend (wrangler.jsonc, dev config in wrangler.dev.jsonc).

## Commands
- Dev: `npm run dev`
- Test: `npm test` (i18n parity covered by src/i18n/i18n.test.ts)
- Build: `npm run build` (typechecks app + worker, then postbuild-locales.ts step)
- Deploy: `npx wrangler deploy` after build

## Languages
Four locales: en, es, ja, ko as JSON in src/i18n/. Every new string needs all four files updated. Cross-check: `node ~/.claude/scripts/i18n-parity.mjs .`

## Rules
- No em dashes in any user-facing string (all four locales).
- Verify fixes on the deployed URL, not just locally.
