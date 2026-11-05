import { manejar } from "./core.js";
import { igualesSeguro } from "./seguridad.js";
import { crearHoja } from "./sheets.js";
import { avisarDuenoPorTelegram, enviarTelegram } from "./envio.js";
import { comandoDueno } from "./dueno.js";

const API = "https://api.telegram.org";

export { enviarTelegram, avisarDuenoPorTelegram };

async function responderCallback(env, fetchFn, id) {
  try {
    await fetchFn(`${API}/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: id }),
    });
  } catch {
    /* solo quita el relojito del botón; no es grave */
  }
}

/** deps: { store, negocio, ahora(), fetch } */
export async function telegramWebhook(request, env, deps) {
  // Sin clave configurada o con una clave distinta: se rechaza todo (incluso GET).
  const clave = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!env.TELEGRAM_WEBHOOK_SECRET || !igualesSeguro(clave, env.TELEGRAM_WEBHOOK_SECRET)) {
    return new Response("No autorizado", { status: 401 });
  }
  if (request.method !== "POST") return new Response("ok");

  let update;
  try {
    update = await request.json();
  } catch {
    return new Response("ok"); // 200 para que Telegram no reintente algo ilegible
  }

  const cb = update.callback_query;
  const m = update.message;
  const de = cb?.from ?? m?.from;
  const chat = cb?.message?.chat ?? m?.chat;
  // Solo chats privados: el bot no atiende grupos.
  if (!de || !chat || chat.type !== "private" || de.is_bot) return new Response("ok");

  const primera = await deps.store.marcarVisto(`tg:${update.update_id}`, deps.ahora());
  if (!primera) return new Response("ok"); // reintento de Telegram: ya se atendió

  try {
    if (cb) await responderCallback(env, deps.fetch, cb.id);
    const texto = cb ? "" : m?.text;
    if (!cb && typeof texto !== "string") {
      await enviarTelegram(env, deps.fetch, chat.id, "Por ahora solo entiendo texto y botones.");
      return new Response("ok");
    }

    const esDueno = env.OWNER_TELEGRAM_ID && String(de.id) === String(env.OWNER_TELEGRAM_ID);
    if (esDueno) {
      const respuesta = await comandoDueno(texto, env, deps);
      if (respuesta !== null) {
        await enviarTelegram(env, deps.fetch, chat.id, respuesta);
        return new Response("ok");
      }
    }

    const hoja = crearHoja(env, deps.fetch, deps.store);
    const negocio = deps.negocioVigente ? await deps.negocioVigente() : deps.negocio; // con los productos de la hoja, si hay

    const { mensajes } = await manejar(
      {
        canal: "telegram",
        usuario: String(de.id),
        contacto: de.username ? `@${de.username}` : "",
        texto,
        opcion: cb?.data,
      },
      {
        negocio,
        store: deps.store,
        ahora: deps.ahora,
        notificarDueno: avisarDuenoPorTelegram(env, deps.fetch),
        hoja,
      },
    );
    for (const x of mensajes) await enviarTelegram(env, deps.fetch, chat.id, x.texto, x.opciones);
  } catch (e) {
    console.error("Error en Telegram:", e?.message ?? e);
  }
  return new Response("ok"); // siempre 200: si respondiéramos 500, Telegram reenviaría el mensaje
}
