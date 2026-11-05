// Copia de pedidos a una hoja de Google Sheets del CLIENTE, mediante un Apps Script pegado en su hoja.
// Sin archivos de claves: el Worker solo conoce la dirección del script y una palabra secreta compartida.

const HOSTS_PERMITIDOS = new Set(["script.google.com", "script.googleusercontent.com"]);

export function hojaConfigurada(env) {
  return Boolean(env.SHEETS_URL && env.SHEETS_TOKEN);
}

// Solo se manda el token a una dirección de Google Apps Script (si alguien se equivoca de dirección, no se filtra).
export function direccionValida(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && HOSTS_PERMITIDOS.has(u.hostname);
  } catch {
    return false;
  }
}

async function llamar(env, fetchFn, cuerpo) {
  if (!direccionValida(env.SHEETS_URL)) throw new Error("SHEETS_URL no es una dirección de Google Apps Script");
  const r = await fetchFn(env.SHEETS_URL, {
    method: "POST",
    headers: { "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token: env.SHEETS_TOKEN, ...cuerpo }),
    redirect: "follow", // Apps Script responde con una redirección
  });
  if (!r.ok) throw new Error(`La hoja respondió ${r.status}`); // sin mostrar la dirección
  let j;
  try {
    j = await r.json();
  } catch {
    throw new Error("La hoja respondió algo ilegible");
  }
  if (!j?.ok) throw new Error(`La hoja rechazó la petición: ${j?.error ?? "sin motivo"}`);
  return j;
}

const resumenProductos = (lineas) => lineas.map((l) => `${l.cant} × ${l.nombre}`).join("; ");

/** Devuelve { copiar, borrar, catalogo, sembrar, reintentar } o null si no hay hoja configurada. */
export function crearHoja(env, fetchFn, store) {
  if (!hojaConfigurada(env)) return null;

  async function copiar(id, p) {
    await llamar(env, fetchFn, {
      accion: "agregar",
      pedido: {
        id,
        clave: p.usuario && p.usuario !== "(borrado)" ? `${p.canal}:${p.usuario}` : "", // quién es el cliente (para la pestaña Clientes)
        creado: p.creado,
        canal: p.canal,
        nombre: p.nombre,
        contacto: p.contacto,
        productos: resumenProductos(p.lineas),
        total: p.total,
        nota: p.nota,
      },
    });
    await store.marcarCopiado(id);
  }

  async function borrar(ids, clave = "") {
    await llamar(env, fetchFn, { accion: "borrar", ids, clave });
  }

  // Productos activos y válidos de la pestaña «Productos» (la edita la dueña desde el celular).
  async function catalogo() {
    const j = await llamar(env, fetchFn, { accion: "catalogo" });
    return { productos: Array.isArray(j.productos) ? j.productos : [], filas: Number(j.filas) || 0, avisos: Array.isArray(j.avisos) ? j.avisos.map(String) : [] };
  }

  // Copia productos de ejemplo a la hoja, solo si la pestaña está vacía.
  async function sembrar(productos) {
    const j = await llamar(env, fetchFn, { accion: "sembrar", productos });
    return { sembrados: Number(j.sembrados) || 0, yaTenia: Boolean(j.yaTenia) };
  }

  async function reintentar() {
    const r = { copiados: 0, borrados: 0, fallaron: 0 };
    for (const p of await store.pedidosSinCopiar()) {
      try {
        await copiar(p.id, p);
        r.copiados++;
      } catch (e) {
        r.fallaron++;
        console.error("Reintento de copia falló:", e?.message ?? e);
      }
    }
    const pendientes = await store.borradosPendientes();
    const porClave = new Map();
    for (const x of pendientes) porClave.set(x.clave, [...(porClave.get(x.clave) ?? []), x.pedido_id]);
    for (const [clave, ids] of porClave) {
      try {
        await borrar(ids, clave);
        await store.quitarBorradosPendientes(ids);
        r.borrados += ids.length;
      } catch (e) {
        r.fallaron += ids.length;
        console.error("Reintento de borrado falló:", e?.message ?? e);
      }
    }
    return r;
  }

  return { copiar, borrar, catalogo, sembrar, reintentar };
}
