-- Add circuit breaker settings with defaults matching Go version
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('circuit_breaker_threshold', '5'),
  ('circuit_breaker_cooldown', '60'),
  ('circuit_breaker_max_cooldown', '600');
