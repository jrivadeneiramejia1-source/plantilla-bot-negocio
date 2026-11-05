import test from "node:test";
import assert from "node:assert/strict";
import { NEGOCIOS } from "../src/negocios/index.js";
import { MemoryStore } from "../src/store.js";
import { telegramWebhook } from "../src/telegram.js";
import { whatsappWebhook, armarMensajeWhatsApp } from "../src/whatsapp.js";
import { hmacSha256Hex } from "../src/seguridad.js";
import { falsoFetch } from "./ayudas.js";

const ENV = {
  TELEGRAM_BOT_TOKEN: "tok-prueba",
  TELEGRAM_WEBHOOK_SECRET: "secreto-tg-inventado",
  OWNER_TELEGRAM_ID: "999",
  WA_TOKEN: "wa-prueba",
  WA_APP_SECRET: "app-secret-inventado",
  WA_VERIFY_TOKEN: "verificacion-inventada",
  WA_PHONE_NUMBER_ID: "12345",
};
const nuevoDeps = () => ({ store: new MemoryStore(), negocio: NEGOCIOS["gorras"], ahora: () => Date.UTC(2026, 10, 5, 15), fetch: falsoFetch() });

const tgReq = (update, secreto = ENV.TELEGRAM_WEBHOOK_SECRET, metodo = "POST") =>
  new Request("https://x.test/telegram", {
    method: metodo,
    headers: { "content-type": "application/json", ...(secreto === null ? {} : { "X-Telegram-Bot-Api-Secret-Token": secreto }) },
    body: metodo === "POST" ? JSON.stringify(update) : undefined,
  });
const tgMsg = (id, texto, de = 111) => ({ update_id: id, message: { message_id: id, from: { id: de, username: "ana_inv" }, chat: { id: de, type: "private" }, text: texto } });
const tgBtn = (id, data, de = 111) => ({ update_id: id, callback_query: { id: "cb" + id, from: { id: de, username: "ana_inv" }, data, message: { chat: { id: de, type: "private" } } } });

test("Telegram: sin clave, con clave mala o sin configurar → 401 y no responde nada", async () => {
  const d = nuevoDeps();
  for (const s of [null, "mala", ""]) assert.equal((await telegramWebhook(tgReq(tgMsg(1, "hola"), s), ENV, d)).status, 401);
  assert.equal((await telegramWebhook(tgReq(null, null, "GET"), ENV, d)).status, 401);
  assert.equal((await telegramWebhook(tgReq(tgMsg(1, "hola")), { ...ENV, TELEGRAM_WEBHOOK_SECRET: "" }, d)).status, 401);
  assert.equal(d.fetch.llamadas.length, 0);
});

test("Telegram: conversación con botones, duplicados y aviso a la dueña", async () => {
  const d = nuevoDeps();
  let id = 1;
  const enviar = (u) => telegramWebhook(tgReq(u), ENV, d);
  await enviar(tgMsg(id++, "/start"));
  const aviso = d.fetch.llamadas.at(-1);
  assert.match(aviso.url, /sendMessage/);
  assert.equal(aviso.cuerpo.reply_markup.inline_keyboard[0][0].callback_data, "ok");
  assert.ok(!aviso.url.includes("undefined"));

  await enviar(tgBtn(id++, "ok"));
  assert.ok(d.fetch.llamadas.some((l) => /answerCallbackQuery/.test(l.url)));
  await enviar(tgBtn(id++, "p:clasica"));
  await enviar(tgBtn(id++, "c:2"));
  await enviar(tgBtn(id++, "fin"));
  await enviar(tgMsg(id++, "Ana Inventada"));
  await enviar(tgBtn(id++, "sinnota"));
  const idEnviar = id++;
  await enviar(tgBtn(idEnviar, "enviar"));
  assert.equal(d.store.pedidos.length, 1);
  const alDueno = d.fetch.llamadas.filter((l) => l.cuerpo?.chat_id === "999");
  assert.equal(alDueno.length, 1);
  assert.match(alDueno[0].cuerpo.text, /@ana_inv/);
  assert.equal(alDueno[0].cuerpo.parse_mode, undefined); // texto plano: nada de formato inyectado

  // Telegram reenvía la misma actualización: no se duplica el pedido ni los avisos.
  const antes = d.fetch.llamadas.length;
  await enviar(tgBtn(idEnviar, "enviar"));
  assert.equal(d.store.pedidos.length, 1);
  assert.equal(d.fetch.llamadas.length, antes);
});

test("Telegram: /resumen solo para la dueña", async () => {
  const d = nuevoDeps();
  await telegramWebhook(tgReq(tgMsg(1, "/resumen", 111)), ENV, d);
  assert.ok(!/Resumen de hoy/.test(JSON.stringify(d.fetch.llamadas.map((l) => l.cuerpo))));
  await telegramWebhook(tgReq(tgMsg(2, "/resumen", 999)), ENV, d);
  assert.match(d.fetch.llamadas.at(-1).cuerpo.text, /Resumen de hoy/);
  assert.equal(d.fetch.llamadas.at(-1).cuerpo.chat_id, 999);
});

test("Telegram: ignora grupos y bots; Telegram caído no rompe (200)", async () => {
  const d = nuevoDeps();
  const grupo = tgMsg(1, "hola");
  grupo.message.chat.type = "group";
  assert.equal((await telegramWebhook(tgReq(grupo), ENV, d)).status, 200);
  assert.equal(d.fetch.llamadas.length, 0);
  d.fetch = falsoFetch(500);
  const r = await telegramWebhook(tgReq(tgMsg(2, "hola")), ENV, d);
  assert.equal(r.status, 200);
});

// ---------- WhatsApp ----------
async function waReq(cuerpoObj, { firma = true, secreto = ENV.WA_APP_SECRET } = {}) {
  const crudo = JSON.stringify(cuerpoObj);
  const headers = { "content-type": "application/json" };
  if (firma) headers["X-Hub-Signature-256"] = "sha256=" + (await hmacSha256Hex(secreto, new TextEncoder().encode(crudo)));
  return new Request("https://x.test/whatsapp", { method: "POST", headers, body: crudo });
}
const waTexto = (id, texto, de = "573001112233") => ({ entry: [{ changes: [{ value: { messages: [{ id, from: de, type: "text", text: { body: texto } }] } }] }] });
const waOpcion = (id, opcionId, de = "573001112233") => ({ entry: [{ changes: [{ value: { messages: [{ id, from: de, type: "interactive", interactive: { type: "button_reply", button_reply: { id: opcionId, title: "x" } } }] } }] }] });

test("WhatsApp: verificación del webhook", async () => {
  const d = nuevoDeps();
  const u = (t) => new Request(`https://x.test/whatsapp?hub.mode=subscribe&hub.verify_token=${t}&hub.challenge=reto123`);
  const bien = await whatsappWebhook(u(ENV.WA_VERIFY_TOKEN), ENV, d);
  assert.equal(bien.status, 200);
  assert.equal(await bien.text(), "reto123");
  assert.equal((await whatsappWebhook(u("mala"), ENV, d)).status, 403);
  assert.equal((await whatsappWebhook(u("x"), { ...ENV, WA_VERIFY_TOKEN: "" }, d)).status, 403);
});

test("WhatsApp: firma incorrecta, ausente o sin secreto → 401 y no hace nada", async () => {
  const d = nuevoDeps();
  assert.equal((await whatsappWebhook(await waReq(waTexto("m1", "hola"), { firma: false }), ENV, d)).status, 401);
  assert.equal((await whatsappWebhook(await waReq(waTexto("m1", "hola"), { secreto: "otro" }), ENV, d)).status, 401);
  assert.equal((await whatsappWebhook(await waReq(waTexto("m1", "hola")), { ...ENV, WA_APP_SECRET: "" }, d)).status, 401);
  assert.equal(d.fetch.llamadas.length, 0);
  assert.equal(d.store.vistos.size, 0);
});

test("WhatsApp: firma sobre los bytes exactos (un espacio de más rompe la firma)", async () => {
  const d = nuevoDeps();
  const crudo = JSON.stringify(waTexto("m1", "hola"));
  const firma = "sha256=" + (await hmacSha256Hex(ENV.WA_APP_SECRET, new TextEncoder().encode(crudo)));
  const alterado = new Request("https://x.test/whatsapp", { method: "POST", headers: { "X-Hub-Signature-256": firma }, body: crudo + " " });
  assert.equal((await whatsappWebhook(alterado, ENV, d)).status, 401);
});

test("WhatsApp: conversación completa, botones y lista, duplicados y aviso a la dueña por Telegram", async () => {
  const d = nuevoDeps();
  const enviar = (o) => whatsappWebhook(o, ENV, d);
  const waLlamadas = () => d.fetch.llamadas.filter((l) => l.url.includes("graph.facebook.com"));

  assert.equal((await enviar(await waReq(waTexto("m1", "hola")))).status, 200);
  const aviso = waLlamadas().at(-1);
  assert.match(aviso.url, /\/v21\.0\/12345\/messages$/);
  assert.equal(aviso.init.headers.authorization, "Bearer wa-prueba");
  assert.equal(aviso.cuerpo.interactive.type, "button"); // 2 opciones → botones

  await enviar(await waReq(waOpcion("m2", "ok")));
  const menu = waLlamadas().at(-1);
  assert.equal(menu.cuerpo.interactive.type, "button"); // gorras tiene 3 productos → 3 botones
});

test("WhatsApp: pedido completo y no duplicar", async () => {
  const d = nuevoDeps();
  const enviar = (o) => whatsappWebhook(o, ENV, d);
  let n = 0;
  await (async () => {
    await enviar(await waReq(waTexto("w" + n++, "hola")));
    await enviar(await waReq(waOpcion("w" + n++, "ok")));
    await enviar(await waReq(waOpcion("w" + n++, "p:bordada")));
    await enviar(await waReq(waOpcion("w" + n++, "c:1")));
    await enviar(await waReq(waOpcion("w" + n++, "fin")));
    await enviar(await waReq(waTexto("w" + n++, "Beto Inventado")));
    await enviar(await waReq(waOpcion("w" + n++, "sinnota")));
    await enviar(await waReq(waOpcion("wfinal", "enviar")));
  })();
  assert.equal(d.store.pedidos.length, 1);
  assert.equal(d.store.pedidos[0].contacto, "https://wa.me/573001112233");
  const alDueno = d.fetch.llamadas.filter((l) => l.cuerpo?.chat_id === "999");
  assert.equal(alDueno.length, 1);
  assert.match(alDueno[0].cuerpo.text, /WhatsApp/);
  assert.match(alDueno[0].cuerpo.text, /wa\.me\/573001112233/);
  const antes = d.fetch.llamadas.length;
  await enviar(await waReq(waOpcion("wfinal", "enviar"))); // Meta reintenta el mismo mensaje
  assert.equal(d.store.pedidos.length, 1);
  assert.equal(d.fetch.llamadas.length, antes);
});

test("WhatsApp: tipos no soportados reciben un aviso corto", async () => {
  const d = nuevoDeps();
  const imagen = { entry: [{ changes: [{ value: { messages: [{ id: "i1", from: "57300", type: "image" }] } }] }] };
  await whatsappWebhook(await waReq(imagen), ENV, d);
  assert.match(d.fetch.llamadas.at(-1).cuerpo.text.body, /solo entiendo texto/);
});

test("armarMensajeWhatsApp respeta los límites de WhatsApp", () => {
  const op = (n) => Array.from({ length: n }, (_, i) => ({ id: "o" + i, titulo: "T".repeat(40), descripcion: "D".repeat(200) }));
  const b = armarMensajeWhatsApp("57", "hola", op(2));
  assert.equal(b[0].interactive.type, "button");
  assert.ok(b[0].interactive.action.buttons.every((x) => x.reply.title.length <= 20));
  const l = armarMensajeWhatsApp("57", "hola", op(7));
  assert.equal(l[0].interactive.type, "list");
  assert.ok(l[0].interactive.action.sections[0].rows.every((r) => r.title.length <= 24 && r.description.length <= 72));
  const muchas = armarMensajeWhatsApp("57", "hola", op(11));
  assert.equal(muchas[0].type, "text");
  assert.match(muchas[0].text.body, /escribe el número/);
  const largo = armarMensajeWhatsApp("57", "x".repeat(1500), op(3));
  assert.equal(largo.length, 2); // texto largo aparte + botones con cuerpo corto
  assert.ok(largo[1].interactive.body.text.length <= 1024);
  const sin = armarMensajeWhatsApp("57", "solo texto");
  assert.equal(sin[0].text.body, "solo texto");
});
