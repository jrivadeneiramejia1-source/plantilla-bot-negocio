#!/usr/bin/env node
// Ayudante para conectar el bot con Telegram. Funciona igual en Windows, Mac y Linux (necesita Node 20 o más).
// Pide el token escondido (no se ve en pantalla ni queda en el historial) y nunca lo imprime.
//
//   node scripts/telegram.mjs clave       inventa una clave secreta para el webhook
//   node scripts/telegram.mjs mi-id       muestra TU número de Telegram (escríbele "hola" al bot antes)
//   node scripts/telegram.mjs registrar   conecta Telegram con tu Worker publicado
//   node scripts/telegram.mjs estado      muestra si Telegram está entregando los mensajes
//   node scripts/telegram.mjs quitar      desconecta el webhook (necesario antes de "mi-id" si ya lo registraste)
import { randomBytes } from "node:crypto";

const BASE = process.env.TELEGRAM_API_BASE || "https://api.telegram.org";
// Solo para pruebas locales se permite otra dirección, y únicamente la de este computador.
if (BASE !== "https://api.telegram.org" && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  console.error("TELEGRAM_API_BASE solo puede apuntar a este computador.");
  process.exit(2);
}

class Aviso extends Error {}

// ---------- preguntas ----------
let lineasEntrada = null; // cuando no hay teclado (pruebas o tubería), se leen todas las líneas de una vez
async function preguntar(texto, { oculto = false } = {}) {
  if (!process.stdin.isTTY) {
    if (lineasEntrada === null) {
      let todo = "";
      for await (const trozo of process.stdin) todo += trozo;
      lineasEntrada = todo.split(/\r?\n/);
    }
    process.stdout.write(texto + "\n");
    return (lineasEntrada.shift() ?? "").trim();
  }
  return new Promise((resolver) => {
    process.stdout.write(texto);
    const stdin = process.stdin;
    let s = "";
    stdin.setEncoding("utf8");
    if (oculto) stdin.setRawMode(true);
    stdin.resume();
    const alRecibir = (trozo) => {
      for (const c of trozo) {
        if (c === "\u0003") process.exit(130); // Ctrl+C
        if (c === "\r" || c === "\n") {
          if (oculto) stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", alRecibir);
          process.stdout.write("\n");
          return resolver(s.trim());
        }
        if (oculto) {
          if (c === "\u007f" || c === "\b") s = s.slice(0, -1);
          else s += c;
        } else s += c;
      }
    };
    stdin.on("data", alRecibir);
  });
}

// ---------- Telegram ----------
const FORMA_TOKEN = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;
async function pedirToken() {
  const token = await preguntar("Pega el token del bot (no se verá) y presiona Enter: ", { oculto: true });
  if (!FORMA_TOKEN.test(token)) throw new Aviso("Eso no parece un token de BotFather (se ve como 123456789:ABC...). No lo escribas en un chat.");
  return token;
}

async function api(token, metodo, cuerpo = {}) {
  let r;
  try {
    r = await fetch(`${BASE}/bot${token}/${metodo}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
  } catch {
    throw new Aviso("No pude conectar con Telegram. Revisa tu internet.");
  }
  let j = null;
  try {
    j = await r.json();
  } catch {
    /* respuesta ilegible */
  }
  if (!j?.ok) throw new Aviso(`Telegram dijo: ${j?.description ?? `error ${r.status}`}`);
  return j.result;
}

const FORMA_CLAVE = /^[A-Za-z0-9_-]{16,256}$/;

const ordenes = {
  async clave() {
    console.log(randomBytes(24).toString("hex"));
    console.log("\nEsa es tu clave secreta del webhook. Úsala dos veces:");
    console.log("  1) npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   (pégala cuando te la pida)");
    console.log("  2) node scripts/telegram.mjs registrar               (pégala cuando te la pida)");
    console.log("Guárdala en tu gestor de claves; no la mandes por chat.");
  },

  async "mi-id"() {
    const token = await pedirToken();
    const info = await api(token, "getWebhookInfo");
    if (info.url) throw new Aviso("El bot ya tiene un webhook registrado y así Telegram no deja leer los mensajes. Corre primero: node scripts/telegram.mjs quitar");
    const novedades = await api(token, "getUpdates", { allowed_updates: ["message"], limit: 20 });
    const mios = novedades.map((u) => u.message).filter((m) => m?.chat?.type === "private" && m.from && !m.from.is_bot);
    if (!mios.length) throw new Aviso("No hay mensajes. Abre tu bot en Telegram, escríbele «hola» y vuelve a correr este comando.");
    const ids = [...new Set(mios.map((m) => m.from.id))];
    if (ids.length > 1) console.log("Ojo: le escribió más de una persona. Usa el número de TU cuenta.");
    console.log(`Número de Telegram de quien escribió: ${ids.join(", ")}`);
    console.log('Ponlo en wrangler.toml, en OWNER_TELEGRAM_ID = "ese número".');
  },

  async registrar() {
    const token = await pedirToken();
    const yo = await api(token, "getMe");
    console.log(`Bot encontrado: @${yo.username}`);
    const clave = await preguntar("Pega la clave secreta del webhook (la que inventó el comando «clave»; no se verá): ", { oculto: true });
    if (!FORMA_CLAVE.test(clave)) throw new Aviso("La clave debe tener 16 a 256 letras, números, guiones o guion bajo. Inventa una con: node scripts/telegram.mjs clave");
    let direccion = await preguntar("Dirección de tu Worker (por ejemplo https://bot-negocio.tu-usuario.workers.dev): ");
    direccion = direccion.replace(/\/+$/, "");
    if (!/^https:\/\/[^\s/]+/.test(direccion)) throw new Aviso("La dirección debe empezar con https://");
    const url = direccion.endsWith("/telegram") ? direccion : `${direccion}/telegram`;
    await api(token, "setWebhook", { url, secret_token: clave, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
    console.log(`Listo: Telegram enviará los mensajes de @${yo.username} a ${url}`);
    console.log("Pruébalo escribiéndole «hola» al bot. Si no contesta, corre: node scripts/telegram.mjs estado");
  },

  async estado() {
    const token = await pedirToken();
    const i = await api(token, "getWebhookInfo");
    console.log(i.url ? `Webhook: ${i.url}` : "No hay webhook registrado.");
    console.log(`Mensajes esperando entrega: ${i.pending_update_count ?? 0}`);
    if (i.last_error_message) {
      const cuando = i.last_error_date ? new Date(i.last_error_date * 1000).toISOString() : "?";
      console.log(`Último error de entrega (${cuando}): ${i.last_error_message}`);
    } else console.log("Sin errores de entrega.");
  },

  async quitar() {
    const token = await pedirToken();
    await api(token, "deleteWebhook", { drop_pending_updates: false });
    console.log("Webhook quitado. El bot ya no entrega mensajes a tu Worker hasta que lo registres otra vez.");
  },
};

const orden = process.argv[2];
if (!ordenes[orden]) {
  console.error("Uso: node scripts/telegram.mjs clave | mi-id | registrar | estado | quitar");
  process.exit(2);
}
try {
  await ordenes[orden]();
} catch (e) {
  console.error(e instanceof Aviso ? `Error: ${e.message}` : "Error inesperado: no se pudo completar.");
  process.exit(1);
}
