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

## Architecture

### Request Flow

```
Client → Inbound Transformer → Internal Format → Group/Channel Selection
→ Load Balancer → Outbound Transformer → Upstream LLM API → Response back through pipeline
```

### Data Layer

- **D1** — Primary database (SQLite)
- **Workers KV** — Configuration cache
- **Durable Objects** — Stats aggregation, distributed round-robin counter

### API Endpoints

- `/v1/*` — LLM relay endpoints (OpenAI / Anthropic compatible)
- `/api/v1/*` — Admin API (JWT-authenticated)

### Supported Formats

| Format | Inbound | Outbound |
|--------|---------|----------|
| OpenAI Chat Completions | Yes | Yes |
| OpenAI Responses API | Yes | Yes |
| OpenAI Embeddings | Yes | Yes |
| Anthropic Messages | Yes | Yes |

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Local dev server |
| `npm run deploy` | Deploy to Cloudflare |
| `npm run test` | Run tests |
| `npm run typecheck` | TypeScript type checking |
| `npm run db:migrate:dev` | Apply D1 migrations locally |

## References

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Hono](https://hono.dev/)
- [D1](https://developers.cloudflare.com/d1/)
