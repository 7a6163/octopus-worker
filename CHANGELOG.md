# Changelog

## [1.1.0] - 2026-03-15

### Added
- Admin SPA UI built with Preact + Vite + Tailwind CSS v4
  - Dashboard with usage stats, request counts, cost overview, and hourly charts
  - Channel management (CRUD upstream LLM providers and API keys)
  - Group management (configure model routing and load balancing)
  - API key management with cost limits and model restrictions
  - User management (admin/user roles)
  - System settings (circuit breaker, log retention, proxy)
  - Model pricing viewer with sync from models.dev
- Login page with Tailwind CSS redesign
- Biome linter/formatter integration
- Fetch Models button in channel form to discover upstream models
- Auto Sync indicator in channel form when enabled
- Model filter and bulk select/deselect in channel model picker

### Changed
- API key prefix changed from `sk-` to `oct-` for clearer identification
- All source code comments translated from Chinese to English
- UI interfaces aligned to camelCase matching backend API responses
- Channel edit form now shows existing API keys (previously hidden in edit mode)
- Removed copy button from masked API key column (copying masked keys is useless)
- `listChannels` now returns all channels (not just enabled) for admin panel

### Fixed
- Channel base URLs and settings not persisting during edit (snake_case/camelCase mismatch)
- API key creation returning `undefined` instead of generated key
- Group creation failing with 400 error (Zod schema mismatch with DB columns)
- `last_use_time_stamp` column name mismatch in channel queries
- `first_token_time_out` column name mismatch in group queries
- `match_regex` missing from channel SELECT queries
- Relay pipeline forwarding client `Authorization` header to upstream (causing 401)
- Relay pipeline forwarding `Accept-Encoding` header causing compressed response parse errors
- `relay_logs` migration schema aligned with application code (14 missing columns added)
- Stats dashboard interfaces aligned with backend response format
- Floating point comparison in pricing test (`toBe` -> `toBeCloseTo`)

### Removed
- Dead code: `src/utils/helpers.ts`, `src/utils/response.ts`, and associated test
- Unused `formatDuration` utility function

## [1.0.0] - 2026-03-14

### Added
- Initial Cloudflare Workers implementation (ported from Go)
- OpenAI Chat Completions, Responses API, and Embeddings relay
- Anthropic Messages relay
- Google Gemini outbound transformer
- Volcengine/Doubao outbound transformer
- Channel and group management with D1 database
- Load balancing: round-robin, random, failover, weighted
- Circuit breaker with exponential backoff
- API key authentication with cost limits and model restrictions
- KV-based caching for channels, groups, API keys, and pricing
- Rate limiting (login: 20/min, relay: 600/min)
- Durable Objects for stats aggregation and round-robin state
- Cron jobs: stats persistence, price sync, log cleanup
- Auto-sync models from upstream providers
- Auto-group models into groups by fuzzy/exact/regex matching
- JWT authentication for admin API
- Comprehensive README with tutorial
