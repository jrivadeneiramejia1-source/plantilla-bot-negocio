import test from "node:test";
import assert from "node:assert/strict";
import { NEGOCIOS } from "../src/negocios/index.js";
import { MemoryStore } from "../src/store.js";
import { telegramWebhook } from "../src/telegram.js";
import { crearNegocioVigente, TTL_CATALOGO_MS } from "../src/catalogo.js";
import { cargarAppsScript, fetchHaciaAppsScript } from "./ayudas.js";

const BASE = NEGOCIOS["gorras"];
const DUENA = 999;
const ENV = { TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_WEBHOOK_SECRET: "s", OWNER_TELEGRAM_ID: String(DUENA), WA_TOKEN: "wa", WA_PHONE_NUMBER_ID: "123" };
const ENVH = { ...ENV, SHEETS_URL: "https://script.google.com/macros/s/ABC/exec", SHEETS_TOKEN: "palabra-secreta" };

// Un mundo de mentira: Telegram y WhatsApp anotan lo que reciben; la hoja es el Apps Script de verdad.
function mundo({ conHoja = false } = {}) {
  const script = cargarAppsScript();
  const store = new MemoryStore();
  const reloj = { t: Date.UTC(2026, 10, 5, 15) };
  const salidas = []; // todo lo que el bot manda a Telegram o WhatsApp
  const fallan = new Set(); // chat_id a los que Telegram responde con error
  const haciaScript = fetchHaciaAppsScript(script);
  const fetchF = async (url, init) => {
    if (/script\.google\.com/.test(String(url))) return haciaScript(url, init);
    const cuerpo = JSON.parse(init.body);
    salidas.push({ url: String(url), cuerpo });
    if (fallan.has(String(cuerpo.chat_id))) return new Response("{}", { status: 403 });
    return new Response("{}", { status: 200 });
  };
  fetchF.llamadas = [];
  const env = conHoja ? { ...ENVH } : { ...ENV }; // copia: una prueba que la cambie no debe afectar a las otras
  let id = 1;
  const deps = () => {
    const d = { store, negocio: BASE, ahora: () => reloj.t, fetch: fetchF };
    d.negocioVigente = crearNegocioVigente(BASE, env, fetchF, store, d.ahora);
    return d;
  };
  const tg = async (de, texto) => {
    const antes = salidas.length;
    await telegramWebhook(
      new Request("https://x.test/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" }, body: JSON.stringify({ update_id: id++, message: { from: { id: de, username: `u${de}` }, chat: { id: de, type: "private" }, text: texto } }) }),
      env, deps(),
    );
    return salidas.slice(antes).filter((x) => !/answerCallbackQuery/.test(x.url));
  };
  const boton = async (de, data) => {
    const antes = salidas.length;
    await telegramWebhook(
      new Request("https://x.test/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" }, body: JSON.stringify({ update_id: id++, callback_query: { id: "c" + id, from: { id: de, username: `u${de}` }, data, message: { chat: { id: de, type: "private" } } } }) }),
      env, deps(),
    );
    return salidas.slice(antes).filter((x) => !/answerCallbackQuery/.test(x.url));
  };
  const pedido = (extra = {}) => store.guardarPedido({ negocio: "gorras", canal: "telegram", usuario: "555", contacto: "@ana", nombre: "Ana", nota: "", lineas: [{ id: "clasica", nombre: "Gorra clásica", cant: 1, precio: 35000 }], total: 35000, creado: new Date(reloj.t).toISOString(), ...extra });
  const aLaDuena = (s) => s.filter((x) => String(x.cuerpo.chat_id) === String(DUENA));
  return { script, store, reloj, salidas, fallan, tg, boton, pedido, aLaDuena, env };
}

test("/ayuda lista los comandos y solo la dueña los tiene", async () => {
  const m = mundo();
  const r = await m.tg(DUENA, "/ayuda");
  assert.match(r[0].cuerpo.text, /\/avisar 12/);
  assert.match(r[0].cuerpo.text, /\/demora/);
  const c = await m.tg(111, "/ayuda"); // un cliente: no es comando; se trata como cualquier mensaje
  assert.doesNotMatch(c[0].cuerpo.text, /Comandos de la dueña/);
});

test("/avisar: le escribe al cliente de Telegram del pedido y le confirma a la dueña", async () => {
  const m = mundo();
  const id = await m.pedido();
  const r = await m.tg(DUENA, `/avisar ${id} Tu pedido ya salió para tu casa`);
  const alCliente = r.find((x) => String(x.cuerpo.chat_id) === "555");
  assert.equal(alCliente.cuerpo.text, `${BASE.nombre}: Tu pedido ya salió para tu casa`);
  assert.match(m.aLaDuena(r)[0].cuerpo.text, /Enviado a Ana \(pedido #1\)/);
});

test("/demora y /listo mandan textos listos", async () => {
  const m = mundo();
  const id = await m.pedido();
  const d = await m.tg(DUENA, `/demora ${id} 30`);
  assert.match(d.find((x) => String(x.cuerpo.chat_id) === "555").cuerpo.text, /Tu pedido #1 va a demorar unos 30 minutos/);
  const l = await m.tg(DUENA, `/listo ${id}`);
  assert.match(l.find((x) => String(x.cuerpo.chat_id) === "555").cuerpo.text, /Tu pedido #1 está listo/);
});

test("uso mal escrito: explica cómo y no manda nada al cliente", async () => {
  const m = mundo();
  await m.pedido();
  for (const [texto, esperado] of [["/avisar", /\/avisar 12/], ["/avisar 1", /\/avisar 12/], ["/avisar uno hola", /\/avisar 12/], ["/demora 1", /\/demora 12 30/], ["/demora 1 0", /\/demora 12 30/], ["/demora 1 601", /\/demora 12 30/], ["/demora 1 treinta", /\/demora 12 30/], ["/listo", /\/listo 12/], ["/listo abc", /\/listo 12/]]) {
    const r = await m.tg(DUENA, texto);
    assert.equal(r.length, 1, texto);
    assert.equal(String(r[0].cuerpo.chat_id), String(DUENA), texto);
    assert.match(r[0].cuerpo.text, esperado, texto);
  }
});

test("pedido que no existe, de otro negocio o de alguien que pidió borrar sus datos", async () => {
  const m = mundo();
  const otro = await m.pedido({ negocio: "otro-negocio" });
  const borrado = await m.pedido({ usuario: "777", nombre: "Carla" });
  await m.store.anonimizarPedidos("telegram", "777");
  const a = await m.tg(DUENA, "/avisar 99 hola");
  assert.match(a[0].cuerpo.text, /No encuentro el pedido #99/);
  const b = await m.tg(DUENA, `/avisar ${otro} hola`);
  assert.match(b[0].cuerpo.text, /No encuentro/);
  const c = await m.tg(DUENA, `/avisar ${borrado} hola`);
  assert.match(c[0].cuerpo.text, /pidió borrar sus datos/);
  assert.equal(c.length, 1);
});

test("el mensaje se limpia y se recorta; Telegram caído o bot bloqueado se le explica a la dueña", async () => {
  const m = mundo();
  const id = await m.pedido();
  const r = await m.tg(DUENA, `/avisar ${id} hola\n\n\u0000${"x".repeat(900)}`);
  const texto = r.find((x) => String(x.cuerpo.chat_id) === "555").cuerpo.text;
  assert.ok(!/[\u0000-\u001f]/.test(texto));
  assert.ok(texto.length <= BASE.nombre.length + 2 + 500);
  m.fallan.add("555");
  const f = await m.tg(DUENA, `/avisar ${id} hola`);
  assert.match(m.aLaDuena(f).at(-1).cuerpo.text, /No se pudo enviar el mensaje a Ana/);
  assert.match(m.aLaDuena(f).at(-1).cuerpo.text, /@ana/);
});

test("un cliente no puede usar los comandos de la dueña", async () => {
  const m = mundo();
  const id = await m.pedido();
  const r = await m.tg(111, `/avisar ${id} soy un impostor`);
  assert.ok(!r.some((x) => String(x.cuerpo.chat_id) === "555"));
  assert.ok(!JSON.stringify(r).includes("impostor") || r.every((x) => String(x.cuerpo.chat_id) === "111"));
});

test("WhatsApp: se puede escribir dentro de las 24 horas; pasado ese tiempo se le da el enlace a la dueña", async () => {
  const m = mundo();
  const dentro = await m.pedido({ canal: "whatsapp", usuario: "573001112233", contacto: "https://wa.me/573001112233", nombre: "Beto" });
  await m.store.putSesion("whatsapp:573001112233", { ultimo: m.reloj.t - 3600e3 }, m.reloj.t);
  const ok = await m.tg(DUENA, `/avisar ${dentro} Estamos preparando tu pedido`);
  const wa = ok.find((x) => /graph\.facebook\.com/.test(x.url));
  assert.equal(wa.cuerpo.to, "573001112233");
  assert.equal(wa.cuerpo.text.body, `${BASE.nombre}: Estamos preparando tu pedido`);
  assert.match(m.aLaDuena(ok)[0].cuerpo.text, /Enviado a Beto/);

  const fuera = await m.pedido({ canal: "whatsapp", usuario: "573009998877", contacto: "https://wa.me/573009998877", nombre: "Dora" });
  await m.store.putSesion("whatsapp:573009998877", { ultimo: m.reloj.t - 25 * 3600e3 }, m.reloj.t);
  const no = await m.tg(DUENA, `/avisar ${fuera} hola`);
  assert.ok(!no.some((x) => /graph\.facebook\.com/.test(x.url)));
  assert.match(no[0].cuerpo.text, /Pasaron más de 24 horas/);
  assert.match(no[0].cuerpo.text, /https:\/\/wa\.me\/573009998877/);

  const sinSesion = await m.pedido({ canal: "whatsapp", usuario: "573005556677", contacto: "https://wa.me/573005556677", nombre: "Eva" });
  const sin = await m.tg(DUENA, `/avisar ${sinSesion} hola`);
  assert.ok(!sin.some((x) => /graph\.facebook\.com/.test(x.url)));
  assert.match(sin[0].cuerpo.text, /wa\.me\/573005556677/);
});

test("el motor anota cuándo escribió el cliente por última vez (para la regla de 24 horas)", async () => {
  const m = mundo();
  await m.tg(111, "hola");
  const s = await m.store.getSesion("telegram:111");
  assert.equal(s.ultimo, m.reloj.t);
});

test("/catalogo sin hoja explica qué falta", async () => {
  const m = mundo();
  const r = await m.tg(DUENA, "/catalogo");
  assert.match(r[0].cuerpo.text, /conectar la hoja de Google/);
});

test("/catalogo con hoja vacía la llena con los ejemplos; la dueña edita y el bot usa los precios nuevos", async () => {
  const m = mundo({ conHoja: true });
  const r = await m.tg(DUENA, "/catalogo");
  assert.match(r[0].cuerpo.text, new RegExp(`Copié ${BASE.productos.length} productos de ejemplo`));
  assert.equal(m.script.filas("Productos").length, BASE.productos.length + 1);

  // La dueña, desde el celular, cambia el precio de la primera gorra y esconde la última.
  m.script.poner("Productos", 2, ["clasica", "Gorra clásica", 38000, "Visera curva", "Sí", ""]);
  m.script.poner("Productos", 4, ["nino", "Gorra para niño", 30000, "", "No", ""]);
  const r2 = await m.tg(DUENA, "/catalogo");
  assert.match(r2[0].cuerpo.text, /Catálogo: 2 productos activos/);

  // Un cliente acepta el aviso y ve el menú nuevo.
  await m.tg(111, "hola");
  const menu = await m.boton(111, "ok");
  assert.match(menu[0].cuerpo.text, /\$38\.000/);
  assert.doesNotMatch(menu[0].cuerpo.text, /Gorra para niño/);
  assert.equal(menu[0].cuerpo.reply_markup.inline_keyboard.length, 2);
});

test("cambios en la hoja sin avisar al bot se ven pasados 2 minutos", async () => {
  const m = mundo({ conHoja: true });
  await m.tg(DUENA, "/catalogo");
  m.script.poner("Productos", 2, ["clasica", "Gorra clásica", 41000, "", "Sí", ""]);
  m.reloj.t += TTL_CATALOGO_MS + 1000;
  await m.tg(111, "hola");
  const menu = await m.boton(111, "ok");
  assert.match(menu[0].cuerpo.text, /\$41\.000/);
});

test("/catalogo avisa lo que está mal en la hoja y si la hoja no responde", async () => {
  const m = mundo({ conHoja: true });
  await m.tg(DUENA, "/catalogo");
  m.script.poner("Productos", 3, ["bordada", "Gorra bordada", "mucho", "", "Sí", ""]);
  const r = await m.tg(DUENA, "/catalogo");
  assert.match(r[0].cuerpo.text, /Para arreglar en la hoja/);
  assert.match(r[0].cuerpo.text, /Fila 3: Precio inválido/);
  const roto = mundo({ conHoja: true });
  roto.env.SHEETS_TOKEN = "otra-palabra"; // no coincide con la del script
  const e = await roto.tg(DUENA, "/catalogo");
  assert.match(e[0].cuerpo.text, /No pude leer la hoja/);
});

test("de punta a punta: pedido de un cliente con precios de la hoja, registro del cliente y aviso de demora", async () => {
  const m = mundo({ conHoja: true });
  await m.tg(DUENA, "/catalogo");
  m.script.poner("Productos", 2, ["clasica", "Gorra clásica", 38000, "", "Sí", ""]);
  m.reloj.t += TTL_CATALOGO_MS + 1000;
  await m.tg(555, "hola");
  await m.boton(555, "ok");
  await m.boton(555, "p:clasica");
  await m.boton(555, "c:2");
  await m.boton(555, "fin");
  await m.tg(555, "Ana Inventada");
  await m.boton(555, "sinnota");
  const fin = await m.boton(555, "enviar");
  assert.match(fin.find((x) => String(x.cuerpo.chat_id) === "555").cuerpo.text, /#1 recibido/);
  assert.equal((await m.store.getPedido(1)).total, 76000); // 2 × 38.000, el precio de la hoja
  assert.match(m.aLaDuena(fin)[0].cuerpo.text, /Pedido nuevo #1/);
  assert.equal(m.script.filas("Pedidos")[1][6], 76000);
  const clientes = m.script.filas("Clientes");
  assert.deepEqual([clientes[1][0], clientes[1][1], clientes[1][4], clientes[1][5]], ["telegram:555", "Ana Inventada", 1, 76000]);
  // La dueña le avisa que demora.
  const d = await m.tg(DUENA, "/demora 1 20");
  assert.match(d.find((x) => String(x.cuerpo.chat_id) === "555").cuerpo.text, /va a demorar unos 20 minutos/);
});

test("/resumen y /reintentar siguen funcionando", async () => {
  const m = mundo({ conHoja: true });
  await m.pedido();
  assert.match((await m.tg(DUENA, "/resumen"))[0].cuerpo.text, /Resumen de hoy/);
  const r = await m.tg(DUENA, "/reintentar");
  assert.match(r[0].cuerpo.text, /1 copiados a la hoja/);
  assert.equal(m.script.filas("Pedidos").length, 2);
});
