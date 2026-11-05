// Catálogo de productos: viene de la pestaña «Productos» de la hoja de Google del negocio (la edita la dueña
// desde el celular). El Worker lo guarda unos minutos para no preguntarle a Google en cada mensaje.
import { limpiar } from "./core.js";
import { crearHoja } from "./sheets.js";

export const TTL_CATALOGO_MS = 120_000; // los cambios de la hoja se ven en el bot en unos 2 minutos
const REINTENTO_TRAS_FALLA_MS = 15_000;
const MAX_PRODUCTOS = 9; // la lista de WhatsApp admite 10 filas y una es «Ver mi pedido»

/** La hoja la puede editar mucha gente: se revisa todo otra vez antes de usarlo. */
export function normalizarProductos(lista) {
  const productos = [];
  const avisos = [];
  const ids = new Set();
  for (const p of Array.isArray(lista) ? lista : []) {
    const id = String(p?.id ?? "");
    const nombre = limpiar(p?.nombre, 200);
    const precio = p?.precio;
    if (!/^[a-z0-9-]{1,30}$/.test(id)) avisos.push("un producto con código inválido");
    else if (ids.has(id)) avisos.push(`código repetido: ${id}`);
    else if (!nombre || nombre.length > 24) avisos.push(`nombre vacío o de más de 24 letras: ${id}`);
    else if (!Number.isInteger(precio) || precio <= 0 || precio > 100_000_000) avisos.push(`precio inválido: ${id}`);
    else if (productos.length >= MAX_PRODUCTOS) avisos.push(`sobra: máximo ${MAX_PRODUCTOS} productos`);
    else {
      ids.add(id);
      productos.push({ id, nombre, precio, descripcion: limpiar(p.descripcion, 80) });
    }
  }
  return { productos, avisos };
}

/** Pide el catálogo a la hoja ahora mismo (comando /catalogo). Si la pestaña está vacía, copia los productos de ejemplo. */
export async function refrescarCatalogo(base, hoja, store, ahora) {
  let r = await hoja.catalogo();
  let sembrados = 0;
  if (r.filas === 0) {
    sembrados = (await hoja.sembrar(base.productos)).sembrados;
    if (sembrados) r = await hoja.catalogo();
  }
  const n = normalizarProductos(r.productos);
  if (n.productos.length) await store.putCatalogo(base.id, n.productos, ahora());
  return { productos: n.productos, avisos: [...r.avisos, ...n.avisos], filas: r.filas, sembrados };
}

/**
 * Devuelve una función que da el negocio con el catálogo vigente (el de la hoja, o el del código si no hay hoja).
 * Si la hoja falla o queda sin productos válidos, se conserva el último catálogo bueno: el bot nunca se queda sin menú.
 */
export function crearNegocioVigente(base, env, fetchFn, store, ahora) {
  let memo = null; // dentro de una misma petición se resuelve una sola vez
  async function resolver() {
    const hoja = crearHoja(env, fetchFn, store);
    if (!hoja) return base;
    let c = await store.getCatalogo(base.id);
    if (!c || ahora() - c.actualizado > TTL_CATALOGO_MS) {
      try {
        const n = normalizarProductos((await hoja.catalogo()).productos);
        if (n.productos.length) c = { productos: n.productos, actualizado: ahora() };
        else c = { productos: c?.productos ?? [], actualizado: ahora() }; // vacía o toda inválida: se conserva lo anterior
        await store.putCatalogo(base.id, c.productos, c.actualizado);
      } catch (e) {
        console.error("No se pudo leer el catálogo de la hoja:", e?.message ?? e);
        c = { productos: c?.productos ?? [], actualizado: ahora() - TTL_CATALOGO_MS + REINTENTO_TRAS_FALLA_MS };
        await store.putCatalogo(base.id, c.productos, c.actualizado); // reintento pronto, pero no en cada mensaje
      }
    }
    return c.productos.length ? { ...base, productos: c.productos } : base;
  }
  return async () => (memo ??= await resolver());
}
