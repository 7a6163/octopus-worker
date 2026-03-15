# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Octopus Workers is an LLM API aggregation and load balancing service running on Cloudflare Workers. It acts as a reverse proxy that accepts requests in OpenAI/Anthropic formats, routes them through configurable channels (upstream LLM providers), and returns responses in the client's expected format. Ported from a Go project.

## Commands

```bash
npm run dev              # Local dev server (wrangler dev) at localhost:8787
npm run test             # Run tests (vitest)
npm run test -- --run tests/unit/helpers.test.ts  # Run single test file
npm run typecheck        # TypeScript type checking (tsc --noEmit)
npm run db:migrate:dev   # Apply D1 migrations locally
npm run deploy           # Deploy to Cloudflare production
```

## Architecture

### Request Flow (Relay Pipeline)

```
Client Request → Inbound Transformer → Internal LLM Format → Group/Channel Selection
→ Load Balancer → Outbound Transformer → Upstream API → Response back through pipeline
```

1. **Inbound Transformers** (`src/services/transformer/inbound/`) parse client requests (OpenAI chat, Anthropic) into `InternalLLMRequest`
2. **Groups** (`groups` + `group_items` tables) map model names to one or more channels with balancing config
3. **Load Balancers** (`src/services/balancer/`) select which channel to use: round-robin, random, failover, weighted
4. **Outbound Transformers** (`src/services/transformer/outbound/`) convert internal format to upstream API format
5. **Retry logic** in `src/routes/relay/handler.ts` tries up to 3 rounds across available channels

### Key Concepts

- **Channel**: An upstream LLM provider endpoint (e.g., OpenAI, Anthropic) with keys and base URLs
- **Group**: Maps a virtual model name to multiple channel+model combinations for load balancing
- **API Key**: Client-facing keys with cost limits and model restrictions
- **ChannelKey**: Upstream provider API keys with 429 cooldown tracking and cost accounting

### Cloudflare Bindings

- **D1** (`DB`): SQLite database for all persistent data
- **KV** (`CACHE`): Caching layer for channels, groups, API keys, and LLM pricing
- **Durable Objects**: `StatsAggregator` (usage metrics), `RoundRobinCounter` (distributed round-robin state)
- **Cron Triggers**: Stats persistence (10min), model price sync (hourly), log cleanup (daily)

### API Routes

- `/v1/*` — LLM relay endpoints (OpenAI/Anthropic compatible)
- `/api/v1/*` — Admin API (JWT-authenticated): users, channels, groups, API keys, stats

### Path Alias

`@/*` maps to `src/*` (configured in both `tsconfig.json` and `vitest.config.ts`).

### Secrets

Set via `wrangler secret put`. Local dev uses `.dev.vars` file. Required: `JWT_SECRET`.
