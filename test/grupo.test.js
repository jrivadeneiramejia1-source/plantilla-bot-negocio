import test from "node:test";
import assert from "node:assert/strict";
import { NEGOCIOS } from "../src/negocios/index.js";
import { MemoryStore } from "../src/store.js";
import { telegramWebhook } from "../src/telegram.js";
import { avisarDuenoPorTelegram, duenas, grupoDeAlertas } from "../src/envio.js";
import { falsoFetch } from "./ayudas.js";

const BASE = NEGOCIOS["gorras"];
const SOCIAS = [101, 102, 103];
const GRUPO = -1001234567890;
const ENV = { TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_WEBHOOK_SECRET: "s", OWNER_TELEGRAM_ID: "101, 102 ,103", ALERTAS_CHAT_ID: String(GRUPO) };

function mundo(envExtra = {}) {
  const store = new MemoryStore();
  const reloj = { t: Date.UTC(2026, 10, 5, 15) };
  const salidas = [];
  const fallan = new Set();
  const fetchF = async (url, init) => {
    const cuerpo = JSON.parse(init.body);
    salidas.push({ url: String(url), cuerpo });
    return new Response("{}", { status: fallan.has(String(cuerpo.chat_id)) ? 403 : 200 });
  };
  fetchF.llamadas = [];
  const env = { ...ENV, ...envExtra };
  let id = 1;
  const enviar = async (update) => {
    const antes = salidas.length;
    await telegramWebhook(new Request("https://x.test/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" }, body: JSON.stringify({ update_id: id++, ...update }) }), env, { store, negocio: BASE, ahora: () => reloj.t, fetch: fetchF });
    return salidas.slice(antes).filter((x) => !/answerCallbackQuery/.test(x.url));
  };
  const privado = (de, text) => enviar({ message: { from: { id: de, username: `u${de}` }, chat: { id: de, type: "private" }, text } });
  const boton = (de, data) => enviar({ callback_query: { id: "c" + id, from: { id: de, username: `u${de}` }, data, message: { chat: { id: de, type: "private" } } } });
  const grupo = (de, text, chatId = GRUPO, tipo = "supergroup") => enviar({ message: { from: { id: de, username: `u${de}` }, chat: { id: chatId, type: tipo }, ...(text === undefined ? { sticker: {} } : { text }) } });
  const pedido = () => store.guardarPedido({ negocio: "gorras", canal: "telegram", usuario: "555", contacto: "@ana", nombre: "Ana", nota: "", lineas: [{ id: "clasica", nombre: "Gorra clásica", cant: 1, precio: 35000 }], total: 35000, creado: new Date(reloj.t).toISOString() });
  return { store, salidas, fallan, privado, boton, grupo, pedido, env, reloj, enviar };
}
async function hacerPedido(m, cliente = 555) {
  await m.privado(cliente, "hola");
  await m.boton(cliente, "ok");
  await m.boton(cliente, "p:clasica");
  await m.boton(cliente, "c:1");
  await m.boton(cliente, "fin");
  await m.privado(cliente, "Ana Inventada");
  await m.boton(cliente, "sinnota");
  return m.boton(cliente, "enviar");
}

test("duenas: lee varios números separados por coma e ignora lo que no es número", () => {
  assert.deepEqual([...duenas({ OWNER_TELEGRAM_ID: "1, 2 ,3" })], ["1", "2", "3"]);
  assert.deepEqual([...duenas({ OWNER_TELEGRAM_ID: "abc,4,,-5, 6x, 7" })], ["4", "7"]);
  assert.equal(duenas({ OWNER_TELEGRAM_ID: "" }).size, 0);
  assert.equal(duenas({}).size, 0);
});

test("grupoDeAlertas: solo acepta números negativos de grupo", () => {
  assert.equal(grupoDeAlertas({ ALERTAS_CHAT_ID: "-1001234567890" }), "-1001234567890");
  assert.equal(grupoDeAlertas({ ALERTAS_CHAT_ID: " -987654321 " }), "-987654321");
  for (const mal of ["12345678", "abc", "", "-12", "--1234567", undefined]) assert.equal(grupoDeAlertas({ ALERTAS_CHAT_ID: mal }), "", String(mal));
});

test("/id le dice a cualquiera su número y el del chat, en privado y en cualquier grupo", async () => {
  const m = mundo();
  const a = await m.privado(777, "/id"); // alguien que no es socia
  assert.match(a[0].cuerpo.text, /Tu número de Telegram: 777/);
  assert.match(a[0].cuerpo.text, /Número de este chat: 777/);
  const g = await m.grupo(777, "/id@mi_bot", -1009998887776); // un grupo cualquiera (todavía sin configurar)
  assert.equal(g[0].cuerpo.chat_id, -1009998887776);
  assert.match(g[0].cuerpo.text, /Número de este chat: -1009998887776/);
});

test("cada socia puede dar órdenes en privado; otra persona no", async () => {
  const m = mundo();
  for (const s of SOCIAS) assert.match((await m.privado(s, "/resumen"))[0].cuerpo.text, /Resumen de hoy/, String(s));
  const extra = await m.privado(104, "/resumen");
  assert.doesNotMatch(extra[0].cuerpo.text, /Resumen de hoy/); // se trata como cliente: aviso de privacidad
});

test("los avisos de pedido llegan UNA vez al grupo de las socias (no a cada una)", async () => {
  const m = mundo();
  const r = await hacerPedido(m);
  const avisos = m.salidas.filter((x) => /Pedido nuevo #1/.test(x.cuerpo.text ?? ""));
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].cuerpo.chat_id, String(GRUPO));
  assert.ok(r.some((x) => /recibido/.test(x.cuerpo.text)), "el cliente igual recibe su confirmación");
});

test("si no hay grupo, el aviso llega a cada socia; si el grupo falla, también (respaldo)", async () => {
  const sin = mundo({ ALERTAS_CHAT_ID: "" });
  await hacerPedido(sin);
  assert.deepEqual(sin.salidas.filter((x) => /Pedido nuevo/.test(x.cuerpo.text ?? "")).map((x) => String(x.cuerpo.chat_id)).sort(), ["101", "102", "103"]);

  const falla = mundo();
  falla.fallan.add(String(GRUPO));
  await hacerPedido(falla);
  assert.deepEqual(falla.salidas.filter((x) => /Pedido nuevo/.test(x.cuerpo.text ?? "") && String(x.cuerpo.chat_id) !== String(GRUPO)).map((x) => String(x.cuerpo.chat_id)).sort(), ["101", "102", "103"]);

  const invalido = mundo({ ALERTAS_CHAT_ID: "12345678" }); // positivo: no es un grupo
  await hacerPedido(invalido);
  assert.equal(invalido.salidas.filter((x) => /Pedido nuevo/.test(x.cuerpo.text ?? "")).length, 3);
});

test("si no se puede avisar a nadie, se nota (error) y el pedido igual se guarda", async () => {
  const f = falsoFetch(500);
  await assert.rejects(avisarDuenoPorTelegram(ENV, f)("hola"), /Telegram respondió 500/);
  assert.equal(await avisarDuenoPorTelegram({ TELEGRAM_BOT_TOKEN: "t" }, f)("hola"), undefined); // nadie configurado: no hace nada
  assert.equal(await avisarDuenoPorTelegram({ OWNER_TELEGRAM_ID: "1" }, f)("hola"), undefined); // sin token: no hace nada
  const m = mundo();
  for (const id of ["101", "102", "103", String(GRUPO)]) m.fallan.add(id);
  const r = await hacerPedido(m);
  assert.ok(r.some((x) => /recibido/.test(x.cuerpo.text)));
  assert.equal(await m.store.getPedido(1).then((p) => p.nombre), "Ana Inventada");
});

test("en el grupo de alertas las socias dan órdenes y todas ven la respuesta", async () => {
  const m = mundo();
  const id = await m.pedido();
  const r = await m.grupo(102, `/demora ${id} 30`);
  const alCliente = r.find((x) => String(x.cuerpo.chat_id) === "555");
  assert.match(alCliente.cuerpo.text, /va a demorar unos 30 minutos/);
  const alGrupo = r.find((x) => String(x.cuerpo.chat_id) === String(GRUPO));
  assert.match(alGrupo.cuerpo.text, /Enviado a Ana \(pedido #1\)/);
  assert.match((await m.grupo(103, "/ayuda"))[0].cuerpo.text, /Comandos de las socias[\s\S]*\/id/);
});

test("en el grupo el bot ignora a quien no es socia, otros grupos, mensajes normales, fotos y botones", async () => {
  const m = mundo();
  const id = await m.pedido();
  assert.equal((await m.grupo(555, `/avisar ${id} impostor`)).length, 0); // un miembro que no es socia
  assert.equal((await m.grupo(101, `/avisar ${id} hola`, -1005550001111)).length, 0); // socia, pero en otro grupo
  assert.equal((await m.grupo(101, "hola buenas")).length, 0); // conversación normal: no hay menú de clientes en el grupo
  assert.equal((await m.grupo(101, "/start")).length, 0);
  assert.equal((await m.grupo(101, undefined)).length, 0); // sticker o foto
  const boton = await m.enviar({ callback_query: { id: "cbg", from: { id: 101 }, data: "ok", message: { chat: { id: GRUPO, type: "supergroup" } } } });
  assert.equal(boton.length, 0); // los botones de clientes no funcionan en un grupo
  const comun = await m.grupo(101, `/avisar ${id} desde un grupo común`, GRUPO, "group"); // «group» (no «supergroup») del grupo configurado también vale
  assert.match(comun.find((x) => String(x.cuerpo.chat_id) === String(GRUPO)).cuerpo.text, /Enviado a Ana/);
});

test("los clientes siguen igual en privado: ven el aviso y no pueden usar comandos de socias", async () => {
  const m = mundo();
  const id = await m.pedido();
  const hola = await m.privado(555, "hola");
  assert.match(hola[0].cuerpo.text, /BORRAR/);
  const imp = await m.privado(555, `/demora ${id} 5`);
  assert.ok(!imp.some((x) => /va a demorar/.test(x.cuerpo.text)));
});
