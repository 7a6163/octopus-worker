<p align="center">
  <img src="ui/public/logo.svg" width="120" alt="Octopus Workers" />
</p>

<h1 align="center">Octopus Workers</h1>

<p align="center">
  LLM API aggregation and load balancing service running on Cloudflare Workers.<br/>
  Acts as a reverse proxy that accepts requests in OpenAI/Anthropic formats, routes them through configurable channels (upstream LLM providers), and returns responses in the client's expected format.
</p>

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Admin UI](#admin-ui)
- [Tutorial](#tutorial)
  - [Step 1: Login](#step-1-login)
  - [Step 2: Create Channels](#step-2-create-channels)
  - [Step 3: Create Groups](#step-3-create-groups)
  - [Step 4: Create API Keys](#step-4-create-api-keys)
  - [Step 5: Send LLM Requests](#step-5-send-llm-requests)
  - [Step 6: Enable Auto-Sync](#step-6-enable-auto-sync)
  - [Step 7: Monitor Usage](#step-7-monitor-usage)
- [Using with SDKs and Tools](#using-with-sdks-and-tools)
- [Deployment](#deployment)
- [API Reference](#api-reference)
- [Architecture](#architecture)
- [Commands](#commands)
- [Inspired By](#inspired-by)

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- A [Cloudflare](https://dash.cloudflare.com/) account (free tier works)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (included as dev dependency)

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/7a6163/octopus-worker.git
cd octopus-worker
npm install
```

### 2. Create Cloudflare Resources

If you're forking or deploying to your own account, create the required D1 database and KV namespace:

```bash
# Login to Cloudflare (if not already)
npx wrangler login

# Create D1 database
npx wrangler d1 create octopus-db

# Create KV namespace
npx wrangler kv namespace create CACHE
```

Copy the returned `database_id` and KV `id` into the corresponding fields in `wrangler.toml`.

### 3. Configure Local Environment

```bash
# Copy the environment template
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` and set a JWT secret:

```
JWT_SECRET=any-secret-string-for-local-dev
```

### 4. Run Database Migrations

```bash
# Apply migrations to local D1
npx wrangler d1 migrations apply octopus-db --local
```

### 5. Start Development Server

```bash
# Start the Worker backend (port 8787)
npm run dev
```

Verify it's running:

```bash
curl http://localhost:8787/health
```

### 6. Set Production Secrets

```bash
# Generate and set JWT secret for production
openssl rand -base64 32 | npx wrangler secret put JWT_SECRET

# Apply migrations to remote D1
npx wrangler d1 migrations apply octopus-db --remote
```

---

## Admin UI

The project includes a web-based admin panel built with [Preact](https://preactjs.com/) + [Vite](https://vite.dev/) + [Tailwind CSS](https://tailwindcss.com/). It provides a visual interface for all management tasks.

### UI Features

| Page | Path | Description |
|------|------|-------------|
| Dashboard | `/` | Usage stats, request counts, cost overview, hourly charts |
| Channels | `/channels` | CRUD upstream LLM providers and API keys |
| Groups | `/groups` | Configure model routing and load balancing |
| API Keys | `/apikeys` | Manage client-facing API keys with cost limits |
| Users | `/users` | User management (admin/user roles) |
| Settings | `/settings` | Circuit breaker, log retention, proxy config |
| Model Prices | `/model-prices` | View/sync LLM pricing from models.dev |

### Local Development

Run the Worker backend and the UI dev server simultaneously:

```bash
# Terminal 1: Start the Worker backend
npm run dev

# Terminal 2: Start the UI dev server (port 5173)
npm run ui:dev
```

Open `http://localhost:5173` in your browser. The Vite dev server proxies `/api/*` and `/v1/*` requests to the Worker at `localhost:8787`.

Default login: `admin` / `admin`

### Build and Deploy UI

The UI is deployed as a static site on [Cloudflare Pages](https://pages.cloudflare.com/), separate from the Worker.

```bash
# Build only
npm run ui:build

# Build and deploy to Cloudflare Pages
npm run ui:deploy
```

After deploying, configure the Pages project's custom domain or environment variables so the UI points to your Worker's production URL.

### Tech Stack

- **Preact** (~3KB) -- lightweight React alternative
- **Vite** -- fast build tooling with HMR
- **Tailwind CSS v4** -- utility-first CSS via `@tailwindcss/vite` plugin
- **preact-router** -- client-side routing
- **No component library** -- custom UI components (`ui/src/components/ui/`)

---

## Tutorial

This walkthrough takes you from a fresh install to a fully working LLM proxy with load balancing.

### Step 1: Login

The default admin credentials are `admin` / `admin`.

```bash
curl -X POST http://localhost:8787/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin"}'
```

Response:

```json
{
  "code": 200,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": { "id": 1, "username": "admin", "role": "admin" }
  }
}
```

Save the token for subsequent requests. Change the default password after first login.

All admin API calls require the JWT token:

```bash
-H "Authorization: Bearer <jwt-token>"
```

**Token management:**

```bash
# Check current user info
curl http://localhost:8787/api/v1/auth/me \
  -H "Authorization: Bearer <jwt-token>"

# Refresh token (before it expires, valid for 24 hours)
curl -X POST http://localhost:8787/api/v1/auth/refresh \
  -H "Authorization: Bearer <jwt-token>"
```

### Step 2: Create Channels

A **channel** represents a connection to an upstream LLM provider. Each channel has a type, base URL, and one or more API keys.

#### Channel Types

| Type | Name | Description |
|------|------|-------------|
| `0` | OpenAI Chat | `/chat/completions` endpoint |
| `1` | OpenAI Response | `/responses` endpoint (reasoning models) |
| `2` | Anthropic | `/messages` endpoint |
| `3` | Gemini | Google Generative AI endpoint |
| `4` | Volcengine | Volcengine/Doubao (uses Responses API format) |
| `5` | OpenAI Embedding | `/embeddings` endpoint |

#### Example: Add an OpenAI Channel

```bash
curl -X POST http://localhost:8787/api/v1/channels \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "openai-primary",
    "type": 0,
    "enabled": true,
    "base_urls": [{"url": "https://api.openai.com/v1", "delay": 0}],
    "model": "gpt-4o,gpt-4o-mini,o3-mini,o4-mini",
    "keys_to_add": [
      {"enabled": true, "channel_key": "sk-your-openai-key-1", "remark": "main account"},
      {"enabled": true, "channel_key": "sk-your-openai-key-2", "remark": "backup account"}
    ]
  }'
```

#### Example: Add an Anthropic Channel

```bash
curl -X POST http://localhost:8787/api/v1/channels \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "anthropic-primary",
    "type": 2,
    "enabled": true,
    "base_urls": [{"url": "https://api.anthropic.com/v1", "delay": 0}],
    "model": "claude-sonnet-4-20250514,claude-haiku-4-5-20251001",
    "keys_to_add": [
      {"enabled": true, "channel_key": "sk-ant-your-key", "remark": "main"}
    ]
  }'
```

#### Example: Add a Gemini Channel

```bash
curl -X POST http://localhost:8787/api/v1/channels \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "gemini",
    "type": 3,
    "enabled": true,
    "base_urls": [{"url": "https://generativelanguage.googleapis.com/v1beta", "delay": 0}],
    "model": "gemini-2.5-pro,gemini-2.5-flash",
    "keys_to_add": [
      {"enabled": true, "channel_key": "your-google-api-key", "remark": "main"}
    ]
  }'
```

#### Example: Add an OpenAI-Compatible Provider

Many providers (DeepSeek, Groq, Together, etc.) use the OpenAI API format. Just use type `0` with their base URL:

```bash
curl -X POST http://localhost:8787/api/v1/channels \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "deepseek",
    "type": 0,
    "enabled": true,
    "base_urls": [{"url": "https://api.deepseek.com/v1", "delay": 0}],
    "model": "deepseek-chat,deepseek-reasoner",
    "keys_to_add": [
      {"enabled": true, "channel_key": "sk-your-deepseek-key", "remark": "main"}
    ]
  }'
```

#### Managing Channels

```bash
# List all channels
curl http://localhost:8787/api/v1/channels \
  -H "Authorization: Bearer <jwt-token>"

# Get a specific channel
curl http://localhost:8787/api/v1/channels/1 \
  -H "Authorization: Bearer <jwt-token>"

# Update a channel
curl -X PUT http://localhost:8787/api/v1/channels/1 \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'

# Delete a channel (also removes associated keys and group items)
curl -X DELETE http://localhost:8787/api/v1/channels/1 \
  -H "Authorization: Bearer <jwt-token>"

# Test fetching models from upstream (verify your key works)
curl -X POST http://localhost:8787/api/v1/channels/fetch-model \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "base_url": "https://api.openai.com/v1",
    "key": "sk-your-key",
    "type": 0
  }'
```

### Step 3: Create Groups

A **group** maps a virtual model name to one or more channels. When a client requests model `gpt-4o`, the proxy looks up the `gpt-4o` group and selects a channel using the configured load balancing strategy.

#### Load Balancing Modes

| Mode | Name | Behavior |
|------|------|----------|
| `1` | Round Robin | Rotates through channels sequentially |
| `2` | Random | Picks a random channel each request |
| `3` | Failover | Uses the highest-priority channel; falls back on failure |
| `4` | Weighted | Selects channels based on assigned weights |

#### Create a Group with Multiple Channels

Scenario: You have two OpenAI accounts and want to load-balance `gpt-4o` across them.

```bash
# 1. Create the group
curl -X POST http://localhost:8787/api/v1/groups \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "gpt-4o",
    "model": "gpt-4o",
    "mode": 1,
    "enabled": true
  }'
```

Then add items to bind channels and models to this group. Each item specifies which channel and which upstream model name to use:

```bash
# 2. Add channel 1 (openai-primary) to the group
curl -X POST http://localhost:8787/api/v1/groups/1/items \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "channel_id": 1,
    "model_name": "gpt-4o",
    "weight": 50,
    "priority": 1
  }'

# 3. Add channel 2 (openai-backup) to the group
curl -X POST http://localhost:8787/api/v1/groups/1/items \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "channel_id": 2,
    "model_name": "gpt-4o",
    "weight": 50,
    "priority": 1
  }'
```

#### Failover Example

Use failover mode for high availability. The proxy uses channel with the highest priority first and only falls back to lower-priority channels on failure:

```bash
curl -X POST http://localhost:8787/api/v1/groups \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "claude-sonnet",
    "model": "claude-sonnet-4-20250514",
    "mode": 3,
    "enabled": true
  }'
```

Add items with different priorities:

```bash
# Primary (priority 1 = highest)
curl -X POST http://localhost:8787/api/v1/groups/2/items \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"channel_id": 3, "model_name": "claude-sonnet-4-20250514", "priority": 1, "weight": 1}'

# Fallback (priority 2)
curl -X POST http://localhost:8787/api/v1/groups/2/items \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"channel_id": 4, "model_name": "claude-sonnet-4-20250514", "priority": 2, "weight": 1}'
```

#### Model Aliasing

You can map a custom model name to a different upstream model. For example, let clients request `my-smart-model` and route it to `gpt-4o`:

```bash
curl -X POST http://localhost:8787/api/v1/groups \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-smart-model", "model": "my-smart-model", "mode": 1, "enabled": true}'

# The group is "my-smart-model" but the upstream model_name is "gpt-4o"
curl -X POST http://localhost:8787/api/v1/groups/3/items \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"channel_id": 1, "model_name": "gpt-4o", "weight": 1, "priority": 1}'
```

Now `POST /v1/chat/completions` with `"model": "my-smart-model"` will be routed to OpenAI's `gpt-4o`.

#### Managing Groups

```bash
# List all groups
curl http://localhost:8787/api/v1/groups \
  -H "Authorization: Bearer <jwt-token>"

# Get group by model name
curl http://localhost:8787/api/v1/groups/by-model/gpt-4o \
  -H "Authorization: Bearer <jwt-token>"

# Delete a group
curl -X DELETE http://localhost:8787/api/v1/groups/1 \
  -H "Authorization: Bearer <jwt-token>"
```

### Step 4: Create API Keys

**API keys** are what your clients use to authenticate with the relay endpoints. Each key can have cost limits and model restrictions.

```bash
curl -X POST http://localhost:8787/api/v1/apikeys \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "production-app",
    "enabled": true,
    "expireAt": 0,
    "maxCost": 100,
    "supportedModels": "gpt-4o,claude-sonnet-4-20250514"
  }'
```

Response includes the API key in `oct-...` format. **Save it now** -- it will be masked in future GET requests.

| Field | Description |
|-------|-------------|
| `name` | Descriptive label |
| `expireAt` | Unix timestamp, `0` = never expires |
| `maxCost` | Maximum total cost in USD, `0` = unlimited |
| `supportedModels` | Comma-separated model whitelist, empty = all models allowed |

```bash
# List all API keys (keys are masked)
curl http://localhost:8787/api/v1/apikeys \
  -H "Authorization: Bearer <jwt-token>"

# Update an API key
curl -X PUT http://localhost:8787/api/v1/apikeys/1 \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"maxCost": 200}'

# Delete an API key
curl -X DELETE http://localhost:8787/api/v1/apikeys/1 \
  -H "Authorization: Bearer <jwt-token>"
```

### Step 5: Send LLM Requests

With channels, groups, and an API key set up, you can now send requests. The proxy accepts requests in standard OpenAI/Anthropic formats.

#### OpenAI Chat Completions

```bash
curl http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer oct-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "What is Cloudflare Workers?"}
    ]
  }'
```

#### Streaming

Add `"stream": true` to any request:

```bash
curl -N http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer oct-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "stream": true,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

#### OpenAI Responses API

```bash
curl http://localhost:8787/v1/responses \
  -H "Authorization: Bearer oct-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "o4-mini",
    "input": "Explain quantum computing in simple terms."
  }'
```

#### Anthropic Messages

```bash
curl http://localhost:8787/v1/messages \
  -H "Authorization: Bearer oct-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello Claude!"}]
  }'
```

#### Embeddings

```bash
curl http://localhost:8787/v1/embeddings \
  -H "Authorization: Bearer oct-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "text-embedding-3-small",
    "input": "Hello world"
  }'
```

#### List Available Models

```bash
curl http://localhost:8787/v1/models \
  -H "Authorization: Bearer oct-your-api-key"
```

### Step 6: Enable Auto-Sync

Channels can automatically discover models from upstream providers and optionally create group mappings.

#### Enable Auto-Sync on a Channel

```bash
curl -X PUT http://localhost:8787/api/v1/channels/1 \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "auto_sync": true,
    "auto_group": 1,
    "match_regex": "^gpt-|^o[0-9]"
  }'
```

| Field | Description |
|-------|-------------|
| `auto_sync` | `true` to fetch models from upstream automatically |
| `auto_group` | `0` = disabled, `1` = fuzzy match, `2` = exact match, `3` = regex match |
| `match_regex` | Only sync models matching this regex pattern (optional) |

**Auto-group strategies:**

- **Fuzzy** (`1`): Matches model names that contain the group name as a substring (e.g., model `gpt-4o-2024-08-06` matches group `gpt-4o`)
- **Exact** (`2`): Only matches when the model name exactly equals the group name
- **Regex** (`3`): Matches model names against the group's regex pattern

#### Trigger Sync Manually

```bash
# Sync all auto-sync channels
curl -X POST http://localhost:8787/api/v1/channels/sync \
  -H "Authorization: Bearer <jwt-token>"
```

Auto-sync also runs automatically via cron every hour.

#### Sync Model Pricing

Model pricing data is synced from [models.dev](https://models.dev) and used for cost tracking:

```bash
curl -X POST http://localhost:8787/api/v1/stats/price-sync \
  -H "Authorization: Bearer <jwt-token>"
```

### Step 7: Monitor Usage

#### Statistics

```bash
# Today's total stats
curl http://localhost:8787/api/v1/stats/today \
  -H "Authorization: Bearer <jwt-token>"

# Hourly breakdown
curl http://localhost:8787/api/v1/stats/hourly \
  -H "Authorization: Bearer <jwt-token>"

# Per-channel stats
curl http://localhost:8787/api/v1/stats/channels \
  -H "Authorization: Bearer <jwt-token>"

# Per-API-key stats
curl http://localhost:8787/api/v1/stats/apikeys \
  -H "Authorization: Bearer <jwt-token>"

# Model pricing list
curl http://localhost:8787/api/v1/stats/model-list \
  -H "Authorization: Bearer <jwt-token>"
```

#### System Settings

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

| Setting | Default | Description |
|---------|---------|-------------|
| `circuit_breaker_threshold` | `5` | Failures before circuit opens |
| `circuit_breaker_cooldown` | `60` | Cooldown period in seconds |
| `circuit_breaker_max_cooldown` | `600` | Max cooldown with exponential backoff |
| `relay_log_keep_period` | `7` | Log retention in days |
| `proxy_url` | -- | System-wide proxy URL |

#### User Management

```bash
# Create a new user
curl -X POST http://localhost:8787/api/v1/users \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"username": "operator", "password": "secure-pass", "role": "user"}'

# List users
curl http://localhost:8787/api/v1/users \
  -H "Authorization: Bearer <jwt-token>"
```

---

## Using with SDKs and Tools

Since the proxy is OpenAI/Anthropic-compatible, you can use it as a drop-in replacement by changing the base URL.

### OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    api_key="oct-your-octopus-api-key",
    base_url="https://your-worker.workers.dev/v1"
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

### OpenAI Node.js SDK

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'oct-your-octopus-api-key',
  baseURL: 'https://your-worker.workers.dev/v1',
});

const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

### Anthropic Python SDK

```python
import anthropic

client = anthropic.Anthropic(
    api_key="oct-your-octopus-api-key",
    base_url="https://your-worker.workers.dev/v1"
)

message = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}]
)
```

### Cursor / VS Code AI Extensions

In your editor settings, set:

- **API Base URL**: `https://your-worker.workers.dev/v1`
- **API Key**: `oct-your-octopus-api-key`

---

## Deployment

### Deploy the Worker

```bash
npm run deploy
```

This deploys to Cloudflare Workers. Make sure you've set production secrets first:

```bash
npx wrangler secret put JWT_SECRET
npx wrangler d1 migrations apply octopus-db --remote
```

### Deploy the Admin UI

The UI is deployed separately to Cloudflare Pages:

```bash
npm run ui:deploy
```

On first deploy, Wrangler creates a Pages project named `octopus-ui`. You can then:

1. Set a custom domain in the [Cloudflare Dashboard](https://dash.cloudflare.com/) under Pages
2. Configure the API endpoint by pointing the UI to your Worker URL

For production, the UI needs to reach the Worker API. Options:
- Deploy both under the same domain with [Pages Functions](https://developers.cloudflare.com/pages/functions/) routing
- Use a custom domain for the Worker and configure CORS in settings

---

## API Reference

### Relay Endpoints (API Key Auth)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions |
| `POST` | `/v1/responses` | OpenAI Responses API |
| `POST` | `/v1/messages` | Anthropic Messages |
| `POST` | `/v1/embeddings` | OpenAI Embeddings |
| `GET` | `/v1/models` | List available models |

### Admin Endpoints (JWT Auth)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/auth/login` | Login |
| `POST` | `/api/v1/auth/logout` | Logout |
| `POST` | `/api/v1/auth/refresh` | Refresh JWT token |
| `GET` | `/api/v1/auth/me` | Current user info |
| `GET/POST/PUT/DELETE` | `/api/v1/channels` | Channel CRUD |
| `POST` | `/api/v1/channels/fetch-model` | Test upstream model fetch |
| `POST` | `/api/v1/channels/sync` | Trigger model sync |
| `GET/POST/PUT/DELETE` | `/api/v1/groups` | Group CRUD |
| `GET` | `/api/v1/groups/by-model/:model` | Lookup group by model name |
| `GET/POST/PUT/DELETE` | `/api/v1/apikeys` | API Key CRUD |
| `GET/POST/PUT/DELETE` | `/api/v1/users` | User CRUD |
| `GET/PUT` | `/api/v1/settings` | System settings |
| `GET` | `/api/v1/stats/today` | Today's usage stats |
| `GET` | `/api/v1/stats/hourly` | Hourly breakdown |
| `GET` | `/api/v1/stats/channels` | Per-channel stats |
| `GET` | `/api/v1/stats/apikeys` | Per-API-key stats |
| `GET` | `/api/v1/stats/model-list` | Model pricing list |
| `POST` | `/api/v1/stats/price-sync` | Trigger price sync |

### Rate Limiting

| Endpoint | Limit | Key |
|----------|-------|-----|
| `POST /api/v1/auth/login` | 20 req/min | Client IP |
| `/v1/*` (all relay) | 600 req/min | API Key |

Rate limiting uses KV-based sliding window counters. When exceeded, returns `429` with:

```json
{"error": {"message": "Rate limit exceeded. Please retry later.", "type": "rate_limit_error"}}
```

Best-effort enforcement (KV is eventually consistent). Fails open if KV is unreachable.

---

## Architecture

### Request Flow

```
Client Request
  -> API Key Auth
  -> Rate Limit Check
  -> Inbound Transformer (parse client format -> internal)
  -> Group Lookup (model name -> group with channel items)
  -> Load Balancer (round-robin / random / failover / weighted)
  -> Circuit Breaker Check
  -> Outbound Transformer (internal -> upstream API format)
  -> Upstream API Call
  -> Response Transformer (upstream -> internal -> client format)
  -> Stats Recording
```

Retry logic: up to 3 rounds across available channels. Failed channels are excluded from subsequent attempts within the same request.

### Project Structure

```
octopus-workers/
├── src/                    # Worker source code
│   ├── index.ts            # Entry point, Hono app setup
│   ├── routes/
│   │   ├── admin/          # Admin API routes (JWT auth)
│   │   └── relay/          # LLM relay routes (API key auth)
│   ├── services/
│   │   ├── balancer/       # Load balancing strategies
│   │   └── transformer/    # Request/response format conversion
│   │       ├── inbound/    # Client -> internal format
│   │       └── outbound/   # Internal -> upstream format
│   └── durable-objects/    # StatsAggregator, RoundRobinCounter
├── ui/                     # Admin SPA (Preact + Vite)
│   ├── src/
│   │   ├── pages/          # Route pages (dashboard, channels, etc.)
│   │   ├── components/     # Reusable UI components
│   │   ├── hooks/          # Custom hooks (auth, API, toast)
│   │   └── api/            # HTTP client with JWT injection
│   └── vite.config.ts      # Vite config with API proxy
├── migrations/             # D1 SQL migrations
├── wrangler.toml           # Cloudflare Worker configuration
└── .dev.vars.example       # Local environment template
```

### Supported Formats

| Format | Inbound (client -> proxy) | Outbound (proxy -> upstream) |
|--------|--------------------------|------------------------------|
| OpenAI Chat Completions | Yes | Yes |
| OpenAI Responses API | Yes | Yes |
| OpenAI Embeddings | Yes | Yes |
| Anthropic Messages | Yes | Yes |
| Google Gemini | -- | Yes |
| Volcengine | -- | Yes |

Gemini and Volcengine are outbound-only: clients send requests in OpenAI/Anthropic format, and the proxy translates to the provider's native API.

### Data Layer

- **D1** (SQLite) -- Primary database: channels, groups, API keys, users, settings, logs, pricing
- **Workers KV** -- Cache for channels, groups, API keys, pricing lookups, and rate limiting
- **Durable Objects** -- `StatsAggregator` for usage metrics, `RoundRobinCounter` for distributed round-robin state

### Cron Jobs

| Schedule | Task |
|----------|------|
| Every 10 minutes | Persist in-memory stats to D1 |
| Every hour | Sync model pricing from models.dev + channel model auto-sync |
| Daily at midnight | Clean up expired relay logs |

### Circuit Breaker

Each channel+key+model combination has an independent circuit breaker:

- **Closed** (normal): Requests flow through. Opens after `threshold` consecutive failures.
- **Open** (tripped): Requests are rejected immediately. Transitions to half-open after `cooldown` period.
- **Half-Open** (probing): Allows one probe request. Success closes the circuit; failure re-opens it with exponential backoff on the cooldown.

---

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Worker dev server (localhost:8787) |
| `npm run deploy` | Deploy Worker to Cloudflare |
| `npm run test` | Run tests (vitest) |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | Lint with Biome |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run ui:dev` | Start UI dev server (localhost:5173) |
| `npm run ui:build` | Build UI for production |
| `npm run ui:deploy` | Build and deploy UI to Cloudflare Pages |
| `npm run db:migrate:dev` | Apply D1 migrations locally |
| `npm run db:migrate:remote` | Apply D1 migrations to production |

## Comparison with Octopus (Go)

This project is a Cloudflare Workers rewrite of [Octopus](https://github.com/bestruirui/octopus/). Here's how they compare:

### Tech Stack

| | Octopus (Go) | Octopus Workers |
|---|---|---|
| **Language** | Go 1.24 | TypeScript |
| **Runtime** | Self-hosted binary / Docker | Cloudflare Workers (edge) |
| **Frontend** | Next.js (embedded in binary) | Preact + Vite + Tailwind CSS v4 |
| **Database** | SQLite / MySQL / PostgreSQL | Cloudflare D1 (SQLite) |
| **Cache** | In-memory | Workers KV |
| **State** | In-process memory | Durable Objects |
| **Deployment** | Docker / binary / source | `wrangler deploy` (serverless) |
| **UI Hosting** | Embedded in backend binary | Cloudflare Pages (separate) |
| **Linter** | — | Biome |

### Features

| Feature | Octopus (Go) | Octopus Workers |
|---|:---:|:---:|
| OpenAI Chat Completions | ✅ | ✅ |
| OpenAI Responses API | ✅ | ✅ |
| OpenAI Embeddings | — | ✅ |
| Anthropic Messages | ✅ | ✅ |
| Google Gemini | ✅ | ✅ |
| Volcengine / Doubao | — | ✅ |
| Streaming (SSE) | ✅ | ✅ |
| Load Balancing (4 modes) | ✅ | ✅ |
| Circuit Breaker | ✅ | ✅ |
| Retry with Failover | ✅ | ✅ |
| Auto Model Sync | ✅ | ✅ |
| Auto Group Assignment | ✅ | ✅ |
| Price Sync (models.dev) | ✅ | ✅ |
| Cost Tracking | ✅ | ✅ |
| API Key Quota (maxCost) | ✅ | ✅ |
| Rate Limiting | — | ✅ (KV-based) |
| RBAC (admin/user roles) | ✅ | ✅ |
| Request Logging | ✅ | ✅ |
| Admin Dashboard | ✅ | ✅ |
| Cron Jobs | ✅ (in-process) | ✅ (Workers Cron Triggers) |
| Multi-DB Support | ✅ (SQLite/MySQL/PG) | — (D1 only) |
| Docker Support | ✅ | — (serverless) |
| Mobile Responsive UI | ✅ | ✅ |
| SSRF Protection | — | ✅ |
| Security Headers | — | ✅ |
| Constant-time Auth | — | ✅ |

### Architecture

| Aspect | Octopus (Go) | Octopus Workers |
|---|---|---|
| **Scaling** | Vertical (single process) | Horizontal (edge, auto-scale) |
| **Cold Start** | None (long-running) | ~0ms (Workers isolate) |
| **Global Latency** | Single region | 300+ edge locations |
| **Stats Persistence** | In-memory → periodic DB flush | Durable Objects → periodic D1 flush |
| **Round-Robin State** | In-process counter | Durable Objects (distributed) |
| **Cost** | Server/VPS hosting | Cloudflare free tier eligible |
| **Graceful Shutdown** | Required (`SIGTERM`) | Not needed (stateless) |

### When to Use Which

**Choose Octopus (Go) if you:**
- Need MySQL or PostgreSQL support
- Prefer self-hosted / on-premises deployment
- Want a single binary with embedded UI
- Need Docker-based orchestration

**Choose Octopus Workers if you:**
- Want zero-ops serverless deployment
- Need global edge distribution with low latency
- Prefer Cloudflare's free tier pricing
- Want built-in security hardening (SSRF, rate limiting, constant-time auth)
- Need Embeddings or Volcengine support

## Inspired By

[Octopus](https://github.com/bestruirui/octopus/) -- the original Go implementation.
