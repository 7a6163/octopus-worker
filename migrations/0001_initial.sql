-- ==================== Octopus Workers 初始 Schema ====================
-- 對應原始 Go 專案的資料表結構

-- ==================== 用戶表 ====================
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL
);

-- 初始管理員帳號 (用戶名: admin, 密碼: admin)
-- 密碼已使用 bcrypt hash
INSERT OR IGNORE INTO users (id, username, password)
VALUES (
  1,
  'admin',
  '$2a$10$N.KqZ9j1gWvTHoB1m2V8V.LYD9ZqN8Vb5VY7Qq9K0bKvF5n5b0Z7i'
);

-- ==================== 渠道表 ====================
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  type INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  base_urls TEXT DEFAULT '[]',
  model TEXT DEFAULT '',
  custom_model TEXT DEFAULT '',
  proxy INTEGER DEFAULT 0,
  auto_sync INTEGER DEFAULT 0,
  auto_group INTEGER DEFAULT 0,
  custom_header TEXT DEFAULT '[]',
  param_override TEXT,
  channel_proxy TEXT,
  match_regex TEXT
);

CREATE INDEX IF NOT EXISTS idx_channels_enabled ON channels(enabled);
CREATE INDEX IF NOT EXISTS idx_channels_name ON channels(name);

-- ==================== 渠道 Key 表 ====================
CREATE TABLE IF NOT EXISTS channel_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  channel_key TEXT NOT NULL,
  status_code INTEGER DEFAULT 0,
  last_use_time_stamp INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0,
  remark TEXT DEFAULT '',
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_channel_keys_channel_id ON channel_keys(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_keys_enabled ON channel_keys(enabled);

-- ==================== 分組表 ====================
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  mode INTEGER NOT NULL DEFAULT 1,
  match_regex TEXT DEFAULT '',
  first_token_time_out INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_groups_name ON groups(name);

-- ==================== 分組項目表 ====================
CREATE TABLE IF NOT EXISTS group_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  channel_id INTEGER NOT NULL,
  model_name TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  weight INTEGER DEFAULT 1,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_group_items_unique ON group_items(group_id, channel_id, model_name);
CREATE INDEX IF NOT EXISTS idx_group_items_group_id ON group_items(group_id);

-- ==================== API Key 表 ====================
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  api_key TEXT UNIQUE NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  expire_at INTEGER DEFAULT 0,
  max_cost REAL DEFAULT 0,
  supported_models TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_api_keys_api_key ON api_keys(api_key);
CREATE INDEX IF NOT EXISTS idx_api_keys_enabled ON api_keys(enabled);

-- ==================== 設定表 ====================
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 初始設定
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('proxy_url', ''),
  ('stats_save_interval', '10'),
  ('cors_allow_origins', ''),
  ('model_info_update_interval', '24'),
  ('sync_llm_interval', '24'),
  ('relay_log_keep_period', '7'),
  ('relay_log_keep_enabled', 'true');

-- ==================== LLM 價格表 ====================
CREATE TABLE IF NOT EXISTS llm_infos (
  name TEXT PRIMARY KEY,
  input REAL DEFAULT 0,
  output REAL DEFAULT 0,
  cache_read REAL DEFAULT 0,
  cache_write REAL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_llm_infos_name ON llm_infos(name);

-- ==================== 請求日誌表 ====================
CREATE TABLE IF NOT EXISTS relay_logs (
  id INTEGER PRIMARY KEY,
  time INTEGER NOT NULL,
  request_model_name TEXT NOT NULL,
  channel_id INTEGER,
  channel_name TEXT,
  actual_model_name TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  ftut INTEGER DEFAULT 0,
  use_time INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  request_content TEXT,
  response_content TEXT,
  error TEXT,
  attempts TEXT DEFAULT '[]',
  total_attempts INTEGER DEFAULT 0,
  successful_round INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_relay_logs_time ON relay_logs(time);
CREATE INDEX IF NOT EXISTS idx_relay_logs_channel_id ON relay_logs(channel_id);
CREATE INDEX IF NOT EXISTS idx_relay_logs_request_model ON relay_logs(request_model_name);

-- ==================== 統計表 ====================

-- 總體統計
CREATE TABLE IF NOT EXISTS stats_total (
  id INTEGER PRIMARY KEY DEFAULT 1,
  input_token INTEGER DEFAULT 0,
  output_token INTEGER DEFAULT 0,
  input_cost REAL DEFAULT 0,
  output_cost REAL DEFAULT 0,
  wait_time INTEGER DEFAULT 0,
  request_success INTEGER DEFAULT 0,
  request_failed INTEGER DEFAULT 0
);

-- 插入初始統計記錄
INSERT OR IGNORE INTO stats_total (id) VALUES (1);

-- 每日統計
CREATE TABLE IF NOT EXISTS stats_daily (
  date TEXT PRIMARY KEY,
  input_token INTEGER DEFAULT 0,
  output_token INTEGER DEFAULT 0,
  input_cost REAL DEFAULT 0,
  output_cost REAL DEFAULT 0,
  wait_time INTEGER DEFAULT 0,
  request_success INTEGER DEFAULT 0,
  request_failed INTEGER DEFAULT 0
);

-- 每小時統計
CREATE TABLE IF NOT EXISTS stats_hourly (
  hour INTEGER NOT NULL,
  date TEXT NOT NULL,
  input_token INTEGER DEFAULT 0,
  output_token INTEGER DEFAULT 0,
  input_cost REAL DEFAULT 0,
  output_cost REAL DEFAULT 0,
  wait_time INTEGER DEFAULT 0,
  request_success INTEGER DEFAULT 0,
  request_failed INTEGER DEFAULT 0,
  PRIMARY KEY (date, hour)
);

CREATE INDEX IF NOT EXISTS idx_stats_hourly_date ON stats_hourly(date);

-- 渠道統計
CREATE TABLE IF NOT EXISTS stats_channel (
  channel_id INTEGER PRIMARY KEY,
  input_token INTEGER DEFAULT 0,
  output_token INTEGER DEFAULT 0,
  input_cost REAL DEFAULT 0,
  output_cost REAL DEFAULT 0,
  wait_time INTEGER DEFAULT 0,
  request_success INTEGER DEFAULT 0,
  request_failed INTEGER DEFAULT 0,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
);

-- 模型統計
CREATE TABLE IF NOT EXISTS stats_model (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  channel_id INTEGER NOT NULL,
  input_token INTEGER DEFAULT 0,
  output_token INTEGER DEFAULT 0,
  input_cost REAL DEFAULT 0,
  output_cost REAL DEFAULT 0,
  wait_time INTEGER DEFAULT 0,
  request_success INTEGER DEFAULT 0,
  request_failed INTEGER DEFAULT 0,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stats_model_unique ON stats_model(name, channel_id);

-- API Key 統計
CREATE TABLE IF NOT EXISTS stats_api_key (
  api_key_id INTEGER PRIMARY KEY,
  input_token INTEGER DEFAULT 0,
  output_token INTEGER DEFAULT 0,
  input_cost REAL DEFAULT 0,
  output_cost REAL DEFAULT 0,
  wait_time INTEGER DEFAULT 0,
  request_success INTEGER DEFAULT 0,
  request_failed INTEGER DEFAULT 0,
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
);

-- ==================== 完成 ====================
-- Schema 版本：1.0.0
-- 建立時間：2026-02-05
