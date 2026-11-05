// Dos almacenes con la misma forma: uno en memoria (pruebas) y uno en D1 (la base gratis de Cloudflare).

const VIDA_SESION_MS = 7 * 24 * 3600e3;
const VIDA_VISTOS_MS = 2 * 24 * 3600e3;
const iso = (ms) => new Date(ms).toISOString();

export class MemoryStore {
  constructor() {
    this.sesiones = new Map();
    this.pedidos = [];
    this.vistos = new Map();
    this.metricas = new Map();
    this.borradosPend = new Map();
    this.catalogos = new Map();
  }
  async getSesion(clave) {
    const v = this.sesiones.get(clave);
    return v ? JSON.parse(v.datos) : null;
  }
  async putSesion(clave, s, ahora) {
    this.sesiones.set(clave, { datos: JSON.stringify(s), actualizado: iso(ahora) });
  }
  async borrarSesion(clave) {
    this.sesiones.delete(clave);
  }
  async marcarVisto(id, ahora) {
    if (this.vistos.has(id)) return false;
    this.vistos.set(id, iso(ahora));
    return true;
  }
  async guardarPedido(p) {
    const id = this.pedidos.length + 1;
    this.pedidos.push({ id, ...JSON.parse(JSON.stringify(p)), hoja_ok: 0 });
    return id;
  }
  async pedidosDesde(negocio, desdeIso) {
    return this.pedidos.filter((p) => p.negocio === negocio && p.creado >= desdeIso);
  }
  async anonimizarPedidos(canal, usuario) {
    for (const p of this.pedidos) {
      if (p.canal === canal && p.usuario === String(usuario)) {
        p.usuario = "(borrado)";
        p.nombre = "(borrado)";
        p.nota = "(borrado)";
        p.contacto = "(borrado)";
      }
    }
  }
  async marcarCopiado(id) {
    const p = this.pedidos.find((x) => x.id === id);
    if (p) p.hoja_ok = 1;
  }
  async pedidosSinCopiar() {
    return this.pedidos.filter((p) => !p.hoja_ok).map((p) => ({ ...p }));
  }
  async idsCopiadosDe(canal, usuario) {
    return this.pedidos.filter((p) => p.canal === canal && p.usuario === String(usuario) && p.hoja_ok).map((p) => p.id);
  }
  async pendienteBorrarEnHoja(ids, clave) {
    for (const id of ids) this.borradosPend.set(id, clave);
  }
  async borradosPendientes() {
    return [...this.borradosPend].map(([pedido_id, clave]) => ({ pedido_id, clave }));
  }
  async quitarBorradosPendientes(ids) {
    for (const id of ids) this.borradosPend.delete(id);
  }
  async getPedido(id) {
    const p = this.pedidos.find((x) => x.id === Number(id));
    return p ? JSON.parse(JSON.stringify(p)) : null;
  }
  async getCatalogo(negocio) {
    const c = this.catalogos.get(negocio);
    return c ? { productos: JSON.parse(c.datos), actualizado: c.actualizado } : null;
  }
  async putCatalogo(negocio, productos, actualizadoMs) {
    this.catalogos.set(negocio, { datos: JSON.stringify(productos), actualizado: actualizadoMs });
  }
  async sumarMetrica(dia, negocio, canal, evento) {
    const k = [dia, negocio, canal, evento].join("|");
    this.metricas.set(k, (this.metricas.get(k) ?? 0) + 1);
  }
  async metricasDia(dia, negocio) {
    const r = [];
    for (const [k, n] of this.metricas) {
      const [d, neg, canal, evento] = k.split("|");
      if (d === dia && neg === negocio) r.push({ canal, evento, n });
    }
    return r;
  }
  async limpiar(ahora) {
    for (const [k, v] of this.sesiones) if (v.actualizado < iso(ahora - VIDA_SESION_MS)) this.sesiones.delete(k);
    for (const [k, v] of this.vistos) if (v < iso(ahora - VIDA_VISTOS_MS)) this.vistos.delete(k);
  }
}

export class D1Store {
  constructor(db) {
    this.db = db;
  }
  async getSesion(clave) {
    const r = await this.db.prepare("SELECT datos FROM sesiones WHERE clave = ?").bind(clave).first();
    return r ? JSON.parse(r.datos) : null;
  }
  async putSesion(clave, s, ahora) {
    await this.db
      .prepare(
        "INSERT INTO sesiones (clave, datos, actualizado) VALUES (?, ?, ?) " +
          "ON CONFLICT(clave) DO UPDATE SET datos = excluded.datos, actualizado = excluded.actualizado",
      )
      .bind(clave, JSON.stringify(s), iso(ahora))
      .run();
  }
  async borrarSesion(clave) {
    await this.db.prepare("DELETE FROM sesiones WHERE clave = ?").bind(clave).run();
  }
  async marcarVisto(id, ahora) {
    const r = await this.db.prepare("INSERT OR IGNORE INTO vistos (id, creado) VALUES (?, ?)").bind(id, iso(ahora)).run();
    return r.meta.changes === 1;
  }
  async guardarPedido(p) {
    const r = await this.db
      .prepare(
        "INSERT INTO pedidos (negocio, canal, usuario, contacto, nombre, nota, lineas, total, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(p.negocio, p.canal, String(p.usuario), p.contacto ?? "", p.nombre, p.nota, JSON.stringify(p.lineas), p.total, p.creado)
      .run();
    return r.meta.last_row_id;
  }
  async pedidosDesde(negocio, desdeIso) {
    const r = await this.db
      .prepare("SELECT id, negocio, canal, nombre, nota, lineas, total, creado FROM pedidos WHERE negocio = ? AND creado >= ? ORDER BY id")
      .bind(negocio, desdeIso)
      .all();
    return r.results.map((p) => ({ ...p, lineas: JSON.parse(p.lineas) }));
  }
  async anonimizarPedidos(canal, usuario) {
    await this.db
      .prepare(
        "UPDATE pedidos SET usuario = '(borrado)', nombre = '(borrado)', nota = '(borrado)', contacto = '(borrado)' WHERE canal = ? AND usuario = ?",
      )
      .bind(canal, String(usuario))
      .run();
  }
  async marcarCopiado(id) {
    await this.db.prepare("UPDATE pedidos SET hoja_ok = 1 WHERE id = ?").bind(id).run();
  }
  async pedidosSinCopiar() {
    const r = await this.db
      .prepare("SELECT id, negocio, canal, usuario, contacto, nombre, nota, lineas, total, creado FROM pedidos WHERE hoja_ok = 0 ORDER BY id LIMIT 50")
      .all();
    return r.results.map((p) => ({ ...p, lineas: JSON.parse(p.lineas) }));
  }
  async idsCopiadosDe(canal, usuario) {
    const r = await this.db.prepare("SELECT id FROM pedidos WHERE canal = ? AND usuario = ? AND hoja_ok = 1").bind(canal, String(usuario)).all();
    return r.results.map((x) => x.id);
  }
  async pendienteBorrarEnHoja(ids, clave) {
    for (const id of ids) await this.db.prepare("INSERT OR REPLACE INTO borrados_pendientes (pedido_id, clave) VALUES (?, ?)").bind(id, clave).run();
  }
  async borradosPendientes() {
    const r = await this.db.prepare("SELECT pedido_id, clave FROM borrados_pendientes ORDER BY pedido_id LIMIT 100").all();
    return r.results.map((x) => ({ pedido_id: x.pedido_id, clave: x.clave }));
  }
  async getPedido(id) {
    const p = await this.db
      .prepare("SELECT id, negocio, canal, usuario, contacto, nombre, nota, lineas, total, creado FROM pedidos WHERE id = ?")
      .bind(Number(id))
      .first();
    return p ? { ...p, lineas: JSON.parse(p.lineas) } : null;
  }
  async getCatalogo(negocio) {
    const r = await this.db.prepare("SELECT datos, actualizado FROM catalogo WHERE negocio = ?").bind(negocio).first();
    return r ? { productos: JSON.parse(r.datos), actualizado: Date.parse(r.actualizado) } : null;
  }
  async putCatalogo(negocio, productos, actualizadoMs) {
    await this.db
      .prepare(
        "INSERT INTO catalogo (negocio, datos, actualizado) VALUES (?, ?, ?) " +
          "ON CONFLICT(negocio) DO UPDATE SET datos = excluded.datos, actualizado = excluded.actualizado",
      )
      .bind(negocio, JSON.stringify(productos), iso(actualizadoMs))
      .run();
  }
  async quitarBorradosPendientes(ids) {
    for (const id of ids) await this.db.prepare("DELETE FROM borrados_pendientes WHERE pedido_id = ?").bind(id).run();
  }
  async sumarMetrica(dia, negocio, canal, evento) {
    await this.db
      .prepare(
        "INSERT INTO metricas (dia, negocio, canal, evento, n) VALUES (?, ?, ?, ?, 1) " +
          "ON CONFLICT(dia, negocio, canal, evento) DO UPDATE SET n = n + 1",
      )
      .bind(dia, negocio, canal, evento)
      .run();
  }
  async metricasDia(dia, negocio) {
    const r = await this.db.prepare("SELECT canal, evento, n FROM metricas WHERE dia = ? AND negocio = ?").bind(dia, negocio).all();
    return r.results;
  }
  async limpiar(ahora) {
    await this.db.prepare("DELETE FROM sesiones WHERE actualizado < ?").bind(iso(ahora - VIDA_SESION_MS)).run();
    await this.db.prepare("DELETE FROM vistos WHERE creado < ?").bind(iso(ahora - VIDA_VISTOS_MS)).run();
  }
}
