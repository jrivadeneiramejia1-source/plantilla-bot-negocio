import { manejar, resumenDelDia } from "./core.js";
import { igualesSeguro } from "./seguridad.js";
import { crearHoja } from "./sheets.js";

const API = "https://api.telegram.org";

export async function enviarTelegram(env, fetchFn, chatId, texto, opciones) {
  const cuerpo = { chat_id: chatId, text: String(texto).slice(0, 4000) };
  if (opciones?.length) {
    cuerpo.reply_markup = { inline_keyboard: opciones.map((o) => [{ text: o.titulo.slice(0, 60), callback_data: o.id }]) };
  }
  const r = await fetchFn(`${API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) throw new Error(`Telegram respondió ${r.status}`); // no se muestra la dirección: lleva el token
}

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

export function avisarDuenoPorTelegram(env, fetchFn) {
  return async (texto) => {
    if (!env.TELEGRAM_BOT_TOKEN || !env.OWNER_TELEGRAM_ID) return;
    await enviarTelegram(env, fetchFn, env.OWNER_TELEGRAM_ID, texto);
  };
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
    if (esDueno && texto?.trim().toLowerCase() === "/resumen") {
      await enviarTelegram(env, deps.fetch, chat.id, await resumenDelDia(deps.store, deps.negocio, deps.ahora()));
      return new Response("ok");
    }

    const hoja = crearHoja(env, deps.fetch, deps.store);
    if (esDueno && texto?.trim().toLowerCase() === "/reintentar") {
      const r = hoja ? await hoja.reintentar() : null;
      await enviarTelegram(
        env,
        deps.fetch,
        chat.id,
        r ? `Listo: ${r.copiados} copiados a la hoja, ${r.borrados} borrados allá, ${r.fallaron} con error.` : "La hoja no está configurada.",
      );
      return new Response("ok");
    }

    const { mensajes } = await manejar(
      {
        canal: "telegram",
        usuario: String(de.id),
        contacto: de.username ? `@${de.username}` : "",
        texto,
        opcion: cb?.data,
      },
      {
        negocio: deps.negocio,
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
