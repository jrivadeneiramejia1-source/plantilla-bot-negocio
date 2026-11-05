-- Para una base D1 que YA existe (creada antes de esta versión). Córrela UNA sola vez:
--   npx wrangler d1 execute bot-negocio --remote --file=migraciones/2026-11-05-catalogo-y-avisos.sql
-- Si creas la base desde cero con schema.sql, NO la necesitas (schema.sql ya lo trae todo).
ALTER TABLE borrados_pendientes ADD COLUMN clave TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS catalogo (
  negocio TEXT PRIMARY KEY,
  datos TEXT NOT NULL,
  actualizado TEXT NOT NULL
);
