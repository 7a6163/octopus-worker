# Octopus Workers

Octopus LLM API 聚合服務的 Cloudflare Workers 版本。

## 快速開始

### 1. 安裝依賴

```bash
npm install
# 或
pnpm install
```

### 2. 建立 D1 資料庫

```bash
wrangler d1 create octopus-db
```

將返回的 `database_id` 填入 `wrangler.toml` 的 `database_id` 欄位。

### 3. 建立 KV Namespace

```bash
wrangler kv:namespace create CACHE
```

將返回的 `id` 填入 `wrangler.toml` 的 KV `id` 欄位。

### 4. 執行資料庫遷移

```bash
wrangler d1 migrations apply octopus-db --local
wrangler d1 migrations apply octopus-db --remote
```

### 5. 本地開發

```bash
npm run dev
```

訪問 http://localhost:8787

### 6. 部署

```bash
npm run deploy
```

## 專案結構

```
octopus-workers/
├── src/
│   ├── index.ts              # Worker 入口
│   ├── routes/               # API 路由
│   ├── services/             # 業務邏輯
│   ├── db/                   # 資料庫操作
│   ├── middleware/           # 中間件
│   ├── types/                # TypeScript 類型
│   └── utils/                # 工具函數
├── migrations/               # D1 遷移檔案
├── tests/                    # 測試
├── wrangler.toml             # Workers 配置
└── package.json
```

## 開發指令

- `npm run dev` - 本地開發
- `npm run deploy` - 部署到 Cloudflare
- `npm run test` - 執行測試
- `npm run test:watch` - 監聽模式測試
- `npm run test:coverage` - 測試覆蓋率
- `npm run tail` - 查看線上日誌

## 環境變數

在 `.dev.vars` 檔案中設定本地環境變數（不會提交到 Git）：

```
# 範例
JWT_SECRET=your-secret-key
```

## 架構

### 資料層
- **D1**: 主資料庫（SQLite）
- **Workers KV**: 配置快取
- **Durable Objects**: 統計聚合

### API 層
- `/v1/*` - LLM API 端點（OpenAI, Anthropic 格式）
- `/api/v1/*` - 管理 API 端點

## 參考文件

- [Cloudflare Workers 文件](https://developers.cloudflare.com/workers/)
- [Hono 文件](https://hono.dev/)
- [D1 文件](https://developers.cloudflare.com/d1/)
