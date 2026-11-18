// Envío de mensajes a Telegram y WhatsApp (compartido por los canales y por los comandos de la dueña).
const API_TELEGRAM = "https://api.telegram.org";

export async function enviarTelegram(env, fetchFn, chatId, texto, opciones) {
  const cuerpo = { chat_id: chatId, text: String(texto).slice(0, 4000) };
  if (opciones?.length) {
    cuerpo.reply_markup = { inline_keyboard: opciones.map((o) => [{ text: o.titulo.slice(0, 60), callback_data: o.id }]) };
  }
  const r = await fetchFn(`${API_TELEGRAM}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) throw new Error(`Telegram respondió ${r.status}`); // no se muestra la dirección: lleva el token
}

/** Números de Telegram de las socias (OWNER_TELEGRAM_ID, separados por coma). Lo que no sea un número se ignora. */
export function duenas(env) {
  return new Set(
    String(env.OWNER_TELEGRAM_ID ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^\d{1,15}$/.test(s)),
  );
}

/** Número del grupo de Telegram de las socias (ALERTAS_CHAT_ID); los grupos tienen número negativo. */
export function grupoDeAlertas(env) {
  const g = String(env.ALERTAS_CHAT_ID ?? "").trim();
  return /^-\d{5,20}$/.test(g) ? g : "";
}

/** Avisa al grupo de las socias; si no hay grupo o falla, le escribe a cada socia por privado (así no se pierde el aviso). */
export function avisarDuenoPorTelegram(env, fetchFn) {
  return async (texto) => {
    if (!env.TELEGRAM_BOT_TOKEN) return;
    let ultimoError = null;
    const grupo = grupoDeAlertas(env);
    if (grupo) {
      try {
        await enviarTelegram(env, fetchFn, grupo, texto);
        return;
      } catch (e) {
        ultimoError = e;
        console.error("No se pudo avisar al grupo:", e?.message ?? e);
      }
    }
    let alguna = false;
    for (const id of duenas(env)) {
      try {
        await enviarTelegram(env, fetchFn, id, texto);
        alguna = true;
      } catch (e) {
        ultimoError = e;
      }
    }
    if (!alguna && ultimoError) throw ultimoError;
  };
}

export async function enviarWhatsApp(env, fetchFn, cuerpo) {
  const version = env.WA_API_VERSION || "v21.0";
  const r = await fetchFn(`https://graph.facebook.com/${version}/${env.WA_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.WA_TOKEN}` },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) throw new Error(`WhatsApp respondió ${r.status}`);
}
