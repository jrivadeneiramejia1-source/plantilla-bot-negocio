CREATE TABLE IF NOT EXISTS sesiones (
  clave TEXT PRIMARY KEY,
  datos TEXT NOT NULL,
  actualizado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio TEXT NOT NULL,
  canal TEXT NOT NULL,
  usuario TEXT NOT NULL,
  contacto TEXT,
  nombre TEXT,
  nota TEXT,
  lineas TEXT NOT NULL,
  total INTEGER NOT NULL,
  creado TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pedidos_por_negocio ON pedidos (negocio, creado);
CREATE TABLE IF NOT EXISTS vistos (
  id TEXT PRIMARY KEY,
  creado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS metricas (
  dia TEXT NOT NULL,
  negocio TEXT NOT NULL,
  canal TEXT NOT NULL,
  evento TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (dia, negocio, canal, evento)
);
