// Las socias le hablan al bot como hablan: con o sin tildes, con sinónimos, con «#12», con errores de dedo.
// Todo con negocios, personas y números INVENTADOS.
import test from "node:test";
import assert from "node:assert/strict";
import { NEGOCIOS } from "../src/negocios/index.js";
import { MemoryStore } from "../src/store.js";
import { telegramWebhook } from "../src/telegram.js";

const BASE = NEGOCIOS["gorras"];
const SOCIA = 101;
const CLIENTE = 555;
const GRUPO = -1001234567890;
const ENV = { TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_WEBHOOK_SECRET: "s", OWNER_TELEGRAM_ID: String(SOCIA), ALERTAS_CHAT_ID: String(GRUPO) };

function mundo({ vigente } = {}) {
  const store = new MemoryStore();
  const reloj = { t: Date.UTC(2026, 10, 5, 15) }; // 10:00 en Colombia
  const salidas = [];
  const fetchF = async (url, init) => {
    salidas.push({ url: String(url), cuerpo: JSON.parse(init.body) });
    return new Response("{}", { status: 200 });
  };
  let id = 1;
  const enviar = async (update) => {
    const antes = salidas.length;
    const deps = { store, negocio: BASE, ahora: () => reloj.t, fetch: fetchF };
    if (vigente) deps.negocioVigente = async () => vigente;
    await telegramWebhook(new Request("https://x.test/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" }, body: JSON.stringify({ update_id: id++, ...update }) }), ENV, deps);
    return salidas.slice(antes).filter((x) => !/answerCallbackQuery/.test(x.url));
  };
  const priv = (de, text) => enviar({ message: { from: { id: de, username: `u${de}` }, chat: { id: de, type: "private" }, text } });
  const grupo = (de, text) => enviar({ message: { from: { id: de, username: `u${de}` }, chat: { id: GRUPO, type: "supergroup" }, text } });
  const pedido = (extra = {}) => store.guardarPedido({ negocio: "gorras", canal: "telegram", usuario: String(CLIENTE), contacto: "@ana", nombre: "Ana", nota: "", lineas: [{ id: "clasica", nombre: "Gorra clásica", cant: 1, precio: 35000 }], total: 35000, creado: new Date(reloj.t).toISOString(), ...extra });
  const textoA = (s, chat) => s.filter((x) => String(x.cuerpo.chat_id) === String(chat)).map((x) => x.cuerpo.text);
  return { store, reloj, salidas, priv, grupo, pedido, textoA };
}

test("las órdenes se entienden con tildes, mayúsculas y sinónimos", async () => {
  const m = mundo();
  for (const [orden, esperado] of [
    ["/Resumen", /Resumen de hoy/], ["/HOY", /Resumen de hoy/], ["/ventas", /Resumen de hoy/],
    ["/cuales", /Esto es lo que el bot muestra ahora/], ["/Productos", /Esto es lo que el bot muestra ahora/], ["/precios", /Esto es lo que el bot muestra ahora/],
    ["/catálogo", /hace falta conectar la hoja/], ["/CATALOGO", /hace falta conectar la hoja/],
    ["/ayuda", /Comandos de las socias/], ["/help", /Comandos de las socias/], ["/comandos", /Comandos de las socias/],
    ["/pedidos", /todavía no hay pedidos/],
  ]) {
    const r = await m.priv(SOCIA, orden);
    assert.equal(r.length, 1, orden);
    assert.match(r[0].cuerpo.text, esperado, orden);
    assert.equal(String(r[0].cuerpo.chat_id), String(SOCIA), orden);
  }
});

test("/productos muestra el menú vigente (el de la hoja), no el del código", async () => {
  const vigente = { ...BASE, productos: [{ id: "x", nombre: "Gorra de hoja", precio: 12500, descripcion: "Solo en la hoja" }] };
  const m = mundo({ vigente });
  const r = await m.priv(SOCIA, "/cuales");
  assert.match(r[0].cuerpo.text, /1\. Gorra de hoja — \$12\.500 \(Solo en la hoja\)/);
  assert.doesNotMatch(r[0].cuerpo.text, /Gorra clásica/);
  assert.match(r[0].cuerpo.text, /1 productos/);
});

test("sin la barra, una socia puede escribir palabras sueltas en privado; el resto sigue siendo conversación", async () => {
  const m = mundo();
  for (const [texto, esperado] of [["ayuda", /Comandos de las socias/], ["Resumen", /Resumen de hoy/], ["¿Productos?", /Esto es lo que el bot muestra/], ["pedidos", /todavía no hay pedidos/], ["Catálogo", /hace falta conectar la hoja/]]) {
    const r = await m.priv(SOCIA, texto);
    assert.match(r[0].cuerpo.text, esperado, texto);
  }
  // Conversación normal de una socia: la atiende el motor de clientes (así puede probar el bot).
  const hola = await m.priv(SOCIA, "hola");
  assert.match(hola[0].cuerpo.text, /Aceptas/);
  // Un cliente que escribe «ayuda» o «resumen» NO recibe nada de las socias.
  for (const t of ["ayuda", "resumen", "/resumen", "/pedidos", "/productos"]) {
    const r = await m.priv(CLIENTE, t);
    assert.ok(r.every((x) => !/Comandos de las socias|Resumen de hoy|Pedidos de hoy|Esto es lo que el bot/.test(x.cuerpo.text)), t);
  }
});

test("una orden desconocida recibe ayuda (no el menú de clientes) y sugiere la más parecida", async () => {
  const m = mundo();
  const a = await m.priv(SOCIA, "/xyz");
  assert.match(a[0].cuerpo.text, /No conozco «\/xyz»/);
  assert.match(a[0].cuerpo.text, /Comandos de las socias/);
  assert.doesNotMatch(a[0].cuerpo.text, /¿Quisiste decir/);

  const b = await m.priv(SOCIA, "/resumne");
  assert.match(b[0].cuerpo.text, /¿Quisiste decir \/resumen\?/);
  assert.doesNotMatch(b[0].cuerpo.text, /Resumen de hoy/); // solo sugiere: no ejecuta

  // Una orden mal escrita que avisa a clientes jamás se ejecuta sola.
  const id = await m.pedido();
  const c = await m.priv(SOCIA, `/avisr ${id} hola`);
  assert.match(c[0].cuerpo.text, /¿Quisiste decir \/avisar\?/);
  assert.equal(m.textoA(c, CLIENTE).length, 0);
});

test("las órdenes de cliente (/start, /menu…) siguen siendo del motor de clientes, también para una socia", async () => {
  const m = mundo();
  const s = await m.priv(SOCIA, "/start");
  assert.match(s[0].cuerpo.text, /Aceptas/);
  assert.doesNotMatch(s[0].cuerpo.text, /No conozco/);
  const g = await m.grupo(SOCIA, "/start"); // en el grupo no se atiende a clientes: se ignora
  assert.deepEqual(g, []);
});

test("/pedidos lista los de hoy con su número y su hora de Colombia, y avisa si son muchos", async () => {
  const m = mundo();
  const id1 = await m.pedido({ nombre: "Ana" });
  m.reloj.t += 90 * 60e3;
  const id2 = await m.pedido({ nombre: "Beto", canal: "whatsapp", usuario: "573001112233", total: 70000, creado: new Date(m.reloj.t).toISOString() });
  const r = await m.priv(SOCIA, "/pedidos");
  assert.match(r[0].cuerpo.text, new RegExp(`#${id1} Ana — \\$35\\.000 — Telegram — 10:00`));
  assert.match(r[0].cuerpo.text, new RegExp(`#${id2} Beto — \\$70\\.000 — WhatsApp — 11:30`));
  assert.match(r[0].cuerpo.text, /2 en total/);
  for (let i = 0; i < 16; i++) await m.pedido({ nombre: `P${i}`, creado: new Date(m.reloj.t).toISOString() });
  const muchos = await m.priv(SOCIA, "/pedidos");
  assert.match(muchos[0].cuerpo.text, /18 en total \(los últimos 15\)/);
  assert.equal(muchos[0].cuerpo.text.split("\n").filter((l) => /^#\d+ /.test(l)).length, 15);
});

test("/demora, /listo y /avisar aceptan «#12», minutos escritos y horas", async () => {
  const m = mundo();
  const id = await m.pedido();
  const alCliente = async (orden) => m.textoA(await m.priv(SOCIA, orden), CLIENTE);
  assert.deepEqual(await alCliente(`/demora ${id} 30`), ["Hola Ana,\nTu pedido #1 (1 × Gorra clásica — Total $35.000) va a demorar unos 30 minutos. ¡Gracias por tu paciencia!"]);
  assert.match((await alCliente(`/Demora #${id} 45 min`))[0], /unos 45 minutos/);
  assert.match((await alCliente(`/demora ${id} 20 minutos`))[0], /unos 20 minutos/);
  assert.match((await alCliente(`/demorar ${id} 1 hora`))[0], /aproximadamente 1 hora\./);
  assert.match((await alCliente(`/demora ${id} 2 horas`))[0], /aproximadamente 2 horas\./);
  assert.match((await alCliente(`/demora ${id} 90`))[0], /unos 90 minutos/);
  assert.match((await alCliente(`/Listo #${id}`))[0], /Tu pedido #1 \(1 × Gorra clásica — Total \$35\.000\) está listo/);
  assert.match((await alCliente(`/terminado ${id}`))[0], /está listo/);
  assert.equal((await alCliente(`/avisa #${id} Ya salió el domiciliario`))[0], "Hola Ana,\nYa salió el domiciliario\nTu pedido #1: 1 × Gorra clásica — Total $35.000");
  assert.equal((await alCliente(`/mensaje ${id} Gracias`))[0], "Hola Ana,\nGracias\nTu pedido #1: 1 × Gorra clásica — Total $35.000");
});

test("el aviso dice qué pidió el cliente, con el número del pedido y el total", async () => {
  const m = mundo();
  const lineas = [{ id: "clasica", nombre: "Gorra clásica", cant: 2, precio: 35000 }, { id: "nino", nombre: "Gorra para niño", cant: 1, precio: 30000 }];
  const id = await m.pedido({ lineas, total: 100000 });
  const t = async (orden) => m.textoA(await m.priv(SOCIA, orden), CLIENTE)[0];
  assert.equal(await t(`/listo ${id}`), `Hola Ana,\nTu pedido #${id} (2 × Gorra clásica, 1 × Gorra para niño — Total $100.000) está listo. ¡Gracias por tu compra!`);
  assert.match(await t(`/demora ${id} 15`), new RegExp(`Tu pedido #${id} \\(2 × Gorra clásica, 1 × Gorra para niño — Total \\$100\\.000\\) va a demorar unos 15 minutos`));
  assert.match(await t(`/avisar ${id} Estamos en camino`), new RegExp(`^Hola Ana,\\nEstamos en camino\\nTu pedido #${id}: 2 × Gorra clásica, 1 × Gorra para niño — Total \\$100\\.000$`));

  // Con muchos productos, los demás se cuentan en vez de llenar el mensaje.
  const siete = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, nombre: `Gorra ${i}`, cant: 1, precio: 1000 }));
  const idGrande = await m.pedido({ lineas: siete, total: 7000 });
  const grande = await t(`/listo ${idGrande}`);
  assert.match(grande, /1 × Gorra 0, 1 × Gorra 1, 1 × Gorra 2, 1 × Gorra 3, 1 × Gorra 4, y 2 más — Total \$7\.000/);
  assert.doesNotMatch(grande, /Gorra 5/);
});

test("/demora mal escrita explica cómo y no le manda nada al cliente", async () => {
  const m = mundo();
  const id = await m.pedido();
  for (const orden of [`/demora ${id}`, `/demora ${id} 0`, `/demora ${id} 601`, `/demora ${id} 11 horas`, `/demora ${id} 30 dias`, `/demora ${id} abc`, `/demora ${id} 30 minutos mas`, "/listo", "/listo abc"]) {
    const r = await m.priv(SOCIA, orden);
    assert.equal(r.length, 1, orden);
    assert.equal(String(r[0].cuerpo.chat_id), String(SOCIA), orden);
    assert.match(r[0].cuerpo.text, /Escríbelo así/, orden);
  }
});

test("en el grupo de las socias pasa lo mismo, y solo las socias", async () => {
  const m = mundo();
  const g = await m.grupo(SOCIA, "/cuales");
  assert.match(g[0].cuerpo.text, /Esto es lo que el bot muestra ahora/);
  assert.equal(String(g[0].cuerpo.chat_id), String(GRUPO));
  const x = await m.grupo(SOCIA, "/xyz");
  assert.match(x[0].cuerpo.text, /No conozco/);
  assert.deepEqual(await m.grupo(SOCIA, "buenas tardes a todas"), []); // conversación normal del grupo: se ignora
  assert.deepEqual(await m.grupo(SOCIA, "resumen"), []); // en el grupo solo con «/»
  assert.deepEqual(await m.grupo(777, "/cuales"), []); // quien no es socia: nada
  assert.deepEqual(await m.grupo(777, "/xyz"), []);
});
