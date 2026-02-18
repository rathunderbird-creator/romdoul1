-- Reset Admin PIN to 1234
INSERT INTO users (id, name, email, role_id, pin)
VALUES ('admin', 'Admin', 'admin@example.com', 'admin', '1234')
ON CONFLICT (id) DO UPDATE SET pin = '1234';

-- Ensure Admin role exists
INSERT INTO app_config (id, data)
VALUES (1, '{"roles": [{"id": "admin", "name": "Administrator", "permissions": []}]}')
ON CONFLICT (id) DO NOTHING;
