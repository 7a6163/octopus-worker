# Octopus Workers

LLM API aggregation and load balancing service running on Cloudflare Workers. Acts as a reverse proxy that accepts requests in OpenAI/Anthropic formats, routes them through configurable channels (upstream LLM providers), and returns responses in the client's expected format.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Create D1 Database

```bash
wrangler d1 create octopus-db
```

Copy the returned `database_id` into `wrangler.toml`.

### 3. Create KV Namespace

```bash
wrangler kv:namespace create CACHE
```

Copy the returned `id` into the KV `id` field in `wrangler.toml`.

### 4. Run Database Migrations

```bash
# Local
wrangler d1 migrations apply octopus-db --local

# Remote
wrangler d1 migrations apply octopus-db --remote
```

### 5. Set Secrets

```bash
wrangler secret put JWT_SECRET
```

For local dev, create a `.dev.vars` file (not committed to git):

```
JWT_SECRET=your-secret-key
```

### 6. Local Development

```bash
npm run dev
```

Server runs at http://localhost:8787

### 7. Deploy

```bash
npm run deploy
```

## Usage Guide

### Authentication

**Admin API** uses JWT tokens. Login to get a token:

```bash
curl -X POST http://localhost:8787/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin"}'
```

The default credentials are `admin` / `admin`. Change the password after first login.

Use the returned token for all admin API calls:

```bash
curl http://localhost:8787/api/v1/channels \
  -H "Authorization: Bearer <jwt-token>"
```

**Relay API** uses API keys. Create one via the admin API:

```bash
curl -X POST http://localhost:8787/api/v1/apikeys \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-key"}'
```

This returns an API key in `sk-...` format.

### Adding a Channel

A channel represents an upstream LLM provider endpoint:

```bash
curl -X POST http://localhost:8787/api/v1/channels \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "openai-main",
    "type": 0,
    "enabled": true,
    "base_urls": [{"url": "https://api.openai.com/v1", "delay": 0}],
    "model": "gpt-4o,gpt-4o-mini,o3-mini",
    "keys_to_add": [{"enabled": true, "channel_key": "sk-your-openai-key", "remark": "main"}]
  }'
```

**Channel types:**

| Type | Provider | Description |
|------|----------|-------------|
| 0 | OpenAI Chat | Chat Completions API |
| 1 | OpenAI Response | Responses API (reasoning models) |
| 2 | Anthropic | Messages API |
| 3 | Gemini | Google Generative AI API |
| 4 | Volcengine | Volcengine/Doubao (uses Responses API format) |
| 5 | OpenAI Embedding | Embeddings API |

### Creating a Group

A group maps a virtual model name to one or more channel+model combinations for load balancing:

```bash
curl -X POST http://localhost:8787/api/v1/groups \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "gpt-4o", "mode": 1}'
```

**Group modes:** `1` = round-robin, `2` = random, `3` = failover, `4` = weighted

Then add items (channel + model bindings) to the group. When a client requests model `gpt-4o`, the load balancer picks from available items in the group.

### Sending Requests

Use the API key to send LLM requests in OpenAI or Anthropic format:

```bash
# OpenAI Chat Completions
curl http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# OpenAI Responses API
curl http://localhost:8787/v1/responses \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "input": "Hello!"
  }'

# Anthropic Messages
curl http://localhost:8787/v1/messages \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Embeddings
curl http://localhost:8787/v1/embeddings \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "text-embedding-3-small",
    "input": "Hello world"
  }'
```

Streaming is supported — add `"stream": true` to the request body.

### Auto-Sync & Auto-Group

Channels can automatically discover models from upstream:

```bash
curl -X PUT http://localhost:8787/api/v1/channels/1 \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"auto_sync": true, "auto_group": 1}'
```

**Auto-group types:** `0` = disabled, `1` = fuzzy match, `2` = exact match, `3` = regex match

When auto-sync runs (hourly via cron or manually via `POST /api/v1/channels/sync`), it fetches available models from the upstream API and optionally creates group items based on the auto-group strategy.

### Settings

View and update system settings:

```bash
# List all settings
curl http://localhost:8787/api/v1/settings \
  -H "Authorization: Bearer <jwt-token>"

# Update a setting
curl -X PUT http://localhost:8787/api/v1/settings/circuit_breaker_threshold \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"value": "10"}'
```

**Available settings:**

| Key | Default | Description |
|-----|---------|-------------|
| `circuit_breaker_threshold` | 5 | Failures before circuit opens |
| `circuit_breaker_cooldown` | 60 | Cooldown period (seconds) |
| `circuit_breaker_max_cooldown` | 600 | Max cooldown with backoff (seconds) |
| `relay_log_keep_period` | 7 | Log retention (days) |
| `proxy_url` | — | System proxy URL |

### Statistics

```bash
# Today's stats
curl http://localhost:8787/api/v1/stats/today \
  -H "Authorization: Bearer <jwt-token>"

# Hourly breakdown
curl http://localhost:8787/api/v1/stats/hourly \
  -H "Authorization: Bearer <jwt-token>"

# Per-channel stats
curl http://localhost:8787/api/v1/stats/channels \
  -H "Authorization: Bearer <jwt-token>"

# Model pricing list
curl http://localhost:8787/api/v1/stats/model-list \
  -H "Authorization: Bearer <jwt-token>"

# Manually trigger price sync
curl -X POST http://localhost:8787/api/v1/stats/price-sync \
  -H "Authorization: Bearer <jwt-token>"
```

## Architecture

### Request Flow

```
Client Request
  → API Key Auth
  → Inbound Transformer (parse client format → internal)
  → Group Lookup (model name → group with channel items)
  → Load Balancer (round-robin / random / failover / weighted)
  → Circuit Breaker Check
  → Outbound Transformer (internal → upstream API format)
  → Custom Headers Applied
  → Upstream API Call
  → Response Transformer (upstream → internal → client format)
  → Stats Recording
```

Retry logic: up to 3 rounds across available channels. Failed channels are excluded from subsequent attempts within the same request.

### Supported Formats

| Format | Inbound (client→proxy) | Outbound (proxy→upstream) |
|--------|------------------------|---------------------------|
| OpenAI Chat Completions | Yes | Yes |
| OpenAI Responses API | Yes | Yes |
| OpenAI Embeddings | Yes | Yes |
| Anthropic Messages | Yes | Yes |
| Google Gemini | — | Yes |
| Volcengine | — | Yes |

Gemini and Volcengine are outbound-only: clients send requests in OpenAI/Anthropic format, and the proxy translates to the provider's native API.

### Data Layer

- **D1** — Primary database (SQLite): channels, groups, API keys, settings, logs, pricing
- **Workers KV** — Cache for channels, groups, API keys, and pricing lookups
- **Durable Objects** — `StatsAggregator` for usage metrics, `RoundRobinCounter` for distributed round-robin state

### Cron Jobs

| Schedule | Task |
|----------|------|
| Every 10 minutes | Persist in-memory stats to D1 |
| Every hour | Sync model pricing from models.dev + channel model auto-sync |
| Daily at midnight | Clean up expired relay logs |

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Local dev server |
| `npm run deploy` | Deploy to Cloudflare |
| `npm run test` | Run tests |
| `npm run typecheck` | TypeScript type checking |
| `npm run db:migrate:dev` | Apply D1 migrations locally |

## Inspired By

[Octopus](https://github.com/bestruirui/octopus/) — the original Go implementation.
