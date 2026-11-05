import { elegirNegocio } from "./negocios/index.js";
import { D1Store } from "./store.js";
import { crearNegocioVigente } from "./catalogo.js";
import { telegramWebhook } from "./telegram.js";
import { whatsappWebhook } from "./whatsapp.js";

export default {
  async fetch(request, env, execCtx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/") return new Response("Bot de pedidos activo");

    const negocio = elegirNegocio(env.NEGOCIO);
    if (!negocio) return new Response("Configuración incompleta: NEGOCIO no existe", { status: 500 });
    if (!env.DB) return new Response("Configuración incompleta: falta la base D1", { status: 500 });

    const store = new D1Store(env.DB);
    const deps = {
      store,
      negocio,
      ahora: () => Date.now(),
      fetch: (...a) => fetch(...a),
      esperar: execCtx?.waitUntil ? (p) => execCtx.waitUntil(p) : null,
    };
    deps.negocioVigente = crearNegocioVigente(negocio, env, deps.fetch, store, deps.ahora);

    // De vez en cuando se borran sesiones viejas (datos personales que ya no hacen falta).
    if (Math.random() < 0.02) {
      const tarea = store.limpiar(deps.ahora()).catch((e) => console.error("limpieza:", e?.message ?? e));
      deps.esperar ? deps.esperar(tarea) : await tarea;
    }

    if (pathname === "/telegram") return telegramWebhook(request, env, deps);
    if (pathname === "/whatsapp") return whatsappWebhook(request, env, deps);
    return new Response("No encontrado", { status: 404 });
  },
};
