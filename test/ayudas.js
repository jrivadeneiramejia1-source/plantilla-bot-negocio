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
