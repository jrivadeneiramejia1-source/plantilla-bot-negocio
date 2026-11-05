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

export function avisarDuenoPorTelegram(env, fetchFn) {
  return async (texto) => {
    if (!env.TELEGRAM_BOT_TOKEN || !env.OWNER_TELEGRAM_ID) return;
    await enviarTelegram(env, fetchFn, env.OWNER_TELEGRAM_ID, texto);
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
