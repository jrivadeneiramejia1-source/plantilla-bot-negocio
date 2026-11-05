import { MemoryStore } from "../src/store.js";
import { manejar } from "../src/core.js";

export function crearCtx(negocio, t0 = Date.UTC(2026, 10, 5, 15, 0, 0)) {
  const avisos = [];
  const reloj = { t: t0 };
  return {
    negocio,
    store: new MemoryStore(),
    ahora: () => reloj.t,
    reloj,
    avisos,
    notificarDueno: async (txt) => void avisos.push(txt),
  };
}

// Escribe como cliente y devuelve el último mensaje del bot.
export async function dice(ctx, usuario, texto, canal = "telegram") {
  const r = await manejar({ canal, usuario, contacto: "", texto }, ctx);
  return r.mensajes[r.mensajes.length - 1];
}
export async function toca(ctx, usuario, opcion, canal = "telegram") {
  const r = await manejar({ canal, usuario, contacto: "", opcion }, ctx);
  return r.mensajes[r.mensajes.length - 1];
}

// Falso fetch que anota las llamadas.
export function falsoFetch(estado = 200) {
  const llamadas = [];
  const f = async (url, init) => {
    llamadas.push({ url: String(url), cuerpo: init?.body ? JSON.parse(init.body) : null, init });
    return new Response("{}", { status: estado });
  };
  f.llamadas = llamadas;
  return f;
}

// ---------- D1 de mentira con SQLite real (node:sqlite) para probar el SQL de D1Store ----------
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export function crearD1Falsa() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  return {
    prepare(sql) {
      const st = db.prepare(sql);
      let args = [];
      const api = {
        bind(...a) {
          args = a;
          return api;
        },
        async first() {
          const r = st.get(...args);
          return r ? { ...r } : null;
        },
        async all() {
          return { results: st.all(...args).map((r) => ({ ...r })) };
        },
        async run() {
          const r = st.run(...args);
          return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
        },
      };
      return api;
    },
  };
}

// «Hoja de Google» de mentira: guarda lo que recibe y puede fallar a pedido.
export function falsaHoja() {
  const h = { agregados: [], borrados: [], falla: false };
  h.copiar = async (id, p) => {
    if (h.falla) throw new Error("hoja caída");
    h.agregados.push({ id, nombre: p.nombre });
    await h.store?.marcarCopiado(id);
  };
  h.borrar = async (ids) => {
    if (h.falla) throw new Error("hoja caída");
    h.borrados.push(...ids);
  };
  return h;
}
