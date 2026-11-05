import test from "node:test";
import assert from "node:assert/strict";
import { NEGOCIOS } from "../src/negocios/index.js";
import { MemoryStore } from "../src/store.js";
import { crearHoja, direccionValida, hojaConfigurada } from "../src/sheets.js";
import { telegramWebhook } from "../src/telegram.js";
import { cargarAppsScript, crearCtx, dice, toca, falsaHoja, falsoFetch, fetchHaciaAppsScript } from "./ayudas.js";

const TOKEN = "palabra-secreta";
const P = (extra = {}) => ({ id: 1, clave: "telegram:111", creado: "2026-11-05T15:00:00Z", canal: "telegram", nombre: "Ana", contacto: "@ana", productos: "2 × Gorra", total: 70000, nota: "Calle 1", ...extra });
const agregar = (s, pedido) => s.post({ token: TOKEN, accion: "agregar", pedido });

// ---------- Apps Script: pedidos y clientes ----------
test("Apps Script: agrega, no duplica y rechaza token malo", () => {
  const s = cargarAppsScript();
  assert.equal(s.doGet().ok, true);
  assert.equal(s.post({ token: "mala", accion: "agregar", pedido: P() }).error, "no autorizado");
  assert.equal(s.post({ accion: "agregar", pedido: P() }).error, "no autorizado");
  assert.deepEqual(s.filas("Pedidos"), []); // ni siquiera se creó la pestaña
  assert.equal(agregar(s, P()).ok, true);
  assert.equal(agregar(s, P()).repetido, true);
  const f = s.filas("Pedidos");
  assert.equal(f.length, 2); // encabezado + 1
  assert.deepEqual(f[1].slice(0, 4), [1, "2026-11-05T15:00:00Z", "telegram", "Ana"]);
  assert.equal(f[1][8], "nuevo");
});

test("Apps Script: sin TOKEN configurado rechaza todo; entradas malas", () => {
  const s = cargarAppsScript("");
  assert.equal(s.post({ token: "", accion: "agregar", pedido: P() }).error, "no autorizado");
  const t = cargarAppsScript();
  assert.equal(t.post("{no es json").error, "JSON ilegible");
  assert.equal(t.post({ token: TOKEN, accion: "hackear" }).error, "acción desconocida");
  assert.equal(agregar(t, { id: "uno" }).error, "pedido inválido");
  assert.equal(t.post({ token: TOKEN, accion: "borrar", ids: "1" }).error, "ids inválidos");
  assert.equal(t.post({ token: TOKEN, accion: "sembrar", productos: "x" }).error, "productos inválidos");
});

test("Apps Script: textos que parecen fórmulas quedan como texto", () => {
  const s = cargarAppsScript();
  agregar(s, P({ nombre: '=IMPORTXML("http://malo","//a")', nota: "+57 300", contacto: "@x", productos: "-1 × a" }));
  const f = s.filas("Pedidos")[1];
  assert.equal(f[3], "'=IMPORTXML(\"http://malo\",\"//a\")");
  assert.equal(f[7], "'+57 300");
  assert.equal(f[5], "'-1 × a");
  assert.equal(f[4], "'@x");
});

test("Apps Script: la pestaña Clientes cuenta pedidos y total de cada cliente", () => {
  const s = cargarAppsScript();
  agregar(s, P({ id: 1, total: 70000, nombre: "Ana" }));
  agregar(s, P({ id: 2, total: 30000, nombre: "Ana Maria", creado: "2026-11-06T10:00:00Z" }));
  agregar(s, P({ id: 3, clave: "whatsapp:573001112233", canal: "whatsapp", nombre: "Beto", contacto: "https://wa.me/573001112233", total: 5000 }));
  agregar(s, P({ id: 4, clave: "", nombre: "Sin clave" })); // pedidos anonimizados no crean cliente
  agregar(s, P({ id: 2, total: 99999 })); // repetido: no cuenta dos veces
  const c = s.filas("Clientes");
  assert.deepEqual(c[0], ["Clave", "Nombre", "Contacto", "Canal", "Pedidos", "Total comprado", "Primer pedido", "Último pedido"]);
  assert.equal(c.length, 3);
  // «@ana» se protege con una comilla delante (igual que las fórmulas); Google la oculta al mostrar la celda.
  assert.deepEqual(c[1], ["telegram:111", "Ana Maria", "'@ana", "telegram", 2, 100000, "2026-11-05T15:00:00Z", "2026-11-06T10:00:00Z"]);
  assert.deepEqual(c[2].slice(0, 6), ["whatsapp:573001112233", "Beto", "https://wa.me/573001112233", "whatsapp", 1, 5000]);
});

test("Apps Script: borrar deja el pedido en blanco y quita al cliente", () => {
  const s = cargarAppsScript();
  agregar(s, P());
  agregar(s, P({ id: 2, clave: "telegram:222", nombre: "Bea" }));
  const r = s.post({ token: TOKEN, accion: "borrar", ids: [1, 99], clave: "telegram:111" });
  assert.deepEqual([r.borrados, r.clientes], [1, 1]);
  const f = s.filas("Pedidos");
  assert.deepEqual([f[1][3], f[1][4], f[1][7]], ["(borrado)", "(borrado)", "(borrado)"]);
  assert.equal(f[1][6], 70000); // el total se conserva
  assert.equal(f[2][3], "Bea");
  const c = s.filas("Clientes");
  assert.equal(c.length, 2);
  assert.equal(c[1][0], "telegram:222");
});

// ---------- Apps Script: productos ----------
const FILA = (codigo, nombre, precio, desc = "", activo = "Sí") => [codigo, nombre, precio, desc, activo, ""];
function conProductos(filas) {
  const s = cargarAppsScript();
  s.post({ token: TOKEN, accion: "catalogo" }); // crea la pestaña
  filas.forEach((f, i) => s.poner("Productos", i + 2, f));
  return s;
}
const catalogo = (s) => s.post({ token: TOKEN, accion: "catalogo" });

test("Apps Script: catálogo crea la pestaña con encabezado y lista Sí/No", () => {
  const s = cargarAppsScript();
  const r = catalogo(s);
  assert.deepEqual(r, { ok: true, productos: [], filas: 0, avisos: [] });
  assert.deepEqual(s.filas("Productos")[0], ["Código", "Nombre", "Precio", "Descripción", "Activo", "Estado"]);
  const v = s.hojas.Productos.validaciones[0];
  assert.deepEqual(v.regla.lista, ["Sí", "No"]);
  assert.equal(v.regla.permitirInvalido, false);
  assert.equal(v.col, 5);
  assert.equal(s.hojas.Productos.congeladas, 1);
});

test("Apps Script: catálogo devuelve activos válidos, genera códigos y escribe el Estado", () => {
  const s = conProductos([
    FILA("", "Rosa de foami", 4000, "Con tallo"),
    FILA("Girasol", "Girasol", "$ 6.000"),         // precio escrito como texto con puntos
    FILA("", "Ramo", "22.000", "", ""),             // Activo vacío = activo
    FILA("cajita", "Caja", 30000, "", "No"),        // oculto
    FILA("", "", ""),                              // fila vacía: se ignora
  ]);
  const r = catalogo(s);
  assert.deepEqual(r.productos.map((p) => [p.id, p.nombre, p.precio]), [["p1", "Rosa de foami", 4000], ["girasol", "Girasol", 6000], ["p2", "Ramo", 22000]]);
  assert.equal(r.filas, 4);
  assert.deepEqual(r.avisos, []); // «oculto» no es un problema
  const f = s.filas("Productos");
  assert.equal(f[1][0], "p1"); // el código nuevo se escribe en la hoja para que no cambie
  assert.equal(f[3][0], "p2");
  assert.deepEqual([f[1][5], f[2][5], f[4][5]], ["OK", "OK", "Oculto (Activo = No)"]);
  // Segunda lectura: los códigos no cambian.
  assert.deepEqual(catalogo(s).productos.map((p) => p.id), ["p1", "girasol", "p2"]);
});

test("Apps Script: catálogo marca lo que está mal, sin ocultarlo en silencio", () => {
  const s = conProductos([
    FILA("a", "", 1000),
    FILA("b", "N".repeat(25), 1000),
    FILA("c", "Precio malo", "abc"),
    FILA("d", "Precio cero", 0),
    FILA("e", "Precio decimal", 10.5),
    FILA("f", "Muy caro", 1e9),
    FILA("g", "Desc larga", 1000, "D".repeat(81)),
    FILA("h", "Bueno", 1000),
    FILA("h", "Repetido", 2000),
  ]);
  const r = catalogo(s);
  assert.deepEqual(r.productos.map((p) => p.id), ["h"]);
  assert.equal(r.avisos.length, 8);
  const f = s.filas("Productos");
  assert.match(f[1][5], /Falta el nombre/);
  assert.match(f[2][5], /Nombre muy largo/);
  assert.match(f[3][5], /Precio inválido/);
  assert.match(f[4][5], /Precio inválido/);
  assert.match(f[5][5], /Precio inválido/);
  assert.match(f[6][5], /Precio inválido/);
  assert.match(f[7][5], /Descripción muy larga/);
  assert.equal(f[8][5], "OK");
  assert.match(f[9][5], /Código repetido/);
  assert.match(r.avisos[0], /^Fila 2: /);
});

test("Apps Script: «No», «0» y cualquier cosa rara en Activo ocultan el producto (más seguro)", () => {
  const s = conProductos([FILA("a", "A", 1000, "", "No"), FILA("b", "B", 1000, "", "no"), FILA("c", "C", 1000, "", "0"), FILA("d", "D", 1000, "", "quizás"), FILA("e", "E", 1000, "", "sí"), FILA("f", "F", 1000, "", "SI")]);
  assert.deepEqual(catalogo(s).productos.map((p) => p.id), ["e", "f"]);
});

test("Apps Script: más de 9 productos activos: los que sobran se avisan", () => {
  const s = conProductos(Array.from({ length: 11 }, (_, i) => FILA(`p${i + 1}`, `Producto ${i + 1}`, 1000 + i)));
  const r = catalogo(s);
  assert.equal(r.productos.length, 9);
  assert.equal(r.avisos.length, 2);
  assert.match(r.avisos[0], /Sobra/);
  assert.match(s.filas("Productos")[10][5], /Sobra/);
});

test("Apps Script: sembrar copia ejemplos solo si la pestaña está vacía y escapa fórmulas", () => {
  const s = cargarAppsScript();
  const ejemplos = [{ id: "rosa", nombre: "Rosa", precio: 4000, descripcion: "Con tallo" }, { id: "x", nombre: "=SUMA(1)", precio: 5, descripcion: "" }];
  assert.deepEqual(s.post({ token: TOKEN, accion: "sembrar", productos: ejemplos }), { ok: true, sembrados: 2 });
  const f = s.filas("Productos");
  assert.deepEqual(f[1], ["rosa", "Rosa", 4000, "Con tallo", "Sí", ""]);
  assert.equal(f[2][1], "'=SUMA(1)");
  assert.deepEqual(s.post({ token: TOKEN, accion: "sembrar", productos: [{ id: "otro", nombre: "Otro", precio: 1 }] }), { ok: true, sembrados: 0, yaTenia: true });
  assert.equal(s.filas("Productos").length, 3); // no se tocó
  assert.deepEqual(catalogo(s).productos.map((p) => p.id), ["rosa", "x"]); // y se pueden leer de vuelta
});

// ---------- el lado del Worker ----------
test("direccionValida: solo Google Apps Script por https", () => {
  assert.equal(direccionValida("https://script.google.com/macros/s/ABC/exec"), true);
  for (const mala of ["http://script.google.com/x", "https://evil.com/x", "https://script.google.com.evil.com/x", "https://localhost/x", "no es url", "", undefined]) {
    assert.equal(direccionValida(mala), false, String(mala));
  }
  assert.equal(hojaConfigurada({}), false);
  assert.equal(hojaConfigurada({ SHEETS_URL: "x", SHEETS_TOKEN: "y" }), true);
});

const ENVH = { SHEETS_URL: "https://script.google.com/macros/s/ABC/exec", SHEETS_TOKEN: TOKEN };
const respuestaHoja = (cuerpo, status = 200) => async () => new Response(JSON.stringify(cuerpo), { status });

test("crearHoja: sin configurar devuelve null; manda token, clave y datos; falla con error claro", async () => {
  assert.equal(crearHoja({}, falsoFetch(), new MemoryStore()), null);
  const store = new MemoryStore();
  const id = await store.guardarPedido({ negocio: "g", canal: "whatsapp", usuario: "57", contacto: "https://wa.me/57", nombre: "Ana", nota: "", lineas: [{ nombre: "Gorra", cant: 2 }], total: 10, creado: "x" });
  const llamadas = [];
  const f = async (url, init) => (llamadas.push({ url, init, cuerpo: JSON.parse(init.body) }), new Response('{"ok":true}'));
  await crearHoja(ENVH, f, store).copiar(id, (await store.pedidosSinCopiar())[0]);
  assert.equal(llamadas[0].cuerpo.token, TOKEN);
  assert.equal(llamadas[0].cuerpo.pedido.productos, "2 × Gorra");
  assert.equal(llamadas[0].cuerpo.pedido.clave, "whatsapp:57");
  assert.equal(llamadas[0].init.redirect, "follow");
  assert.deepEqual(await store.pedidosSinCopiar(), []);
  for (const [f2, texto] of [
    [respuestaHoja({}, 500), /respondió 500/],
    [respuestaHoja({ ok: false, error: "no autorizado" }), /no autorizado/],
    [async () => new Response("<html>login</html>"), /ilegible/],
  ]) await assert.rejects(() => crearHoja(ENVH, f2, store).borrar([1]), texto);
  await assert.rejects(() => crearHoja({ SHEETS_URL: "https://evil.com/x", SHEETS_TOKEN: "t" }, falsoFetch(), store).borrar([1]), /no es una dirección/);
  // El token nunca aparece en los mensajes de error.
  await assert.rejects(() => crearHoja(ENVH, respuestaHoja({}, 500), store).borrar([1]), (e) => !e.message.includes(TOKEN) && !e.message.includes("ABC"));
});

test("crearHoja: un pedido anonimizado se copia sin clave (no crea un «cliente» falso)", async () => {
  const store = new MemoryStore();
  const id = await store.guardarPedido({ negocio: "g", canal: "telegram", usuario: "9", contacto: "@x", nombre: "A", nota: "", lineas: [{ nombre: "G", cant: 1 }], total: 1, creado: "x" });
  await store.anonimizarPedidos("telegram", "9");
  const script = cargarAppsScript();
  await crearHoja(ENVH, fetchHaciaAppsScript(script), store).copiar(id, (await store.pedidosSinCopiar())[0]);
  assert.equal(script.filas("Pedidos")[1][3], "(borrado)");
  assert.equal(script.filas("Clientes").length, 0);
});

// ---------- el motor con la hoja ----------
async function pedirUno(ctx, usuario = "u", canal = "telegram") {
  await dice(ctx, usuario, "hola", canal);
  await toca(ctx, usuario, "ok", canal);
  await toca(ctx, usuario, "p:clasica", canal);
  await toca(ctx, usuario, "c:1", canal);
  await toca(ctx, usuario, "fin", canal);
  await dice(ctx, usuario, "Carla Inventada", canal);
  await toca(ctx, usuario, "sinnota", canal);
  return toca(ctx, usuario, "enviar", canal);
}
function ctxConHoja() {
  const ctx = crearCtx(NEGOCIOS["gorras"]);
  ctx.hoja = falsaHoja();
  ctx.hoja.store = ctx.store;
  return ctx;
}

test("pedido: se copia a la hoja y queda marcado", async () => {
  const ctx = ctxConHoja();
  await pedirUno(ctx);
  assert.deepEqual(ctx.hoja.agregados, [{ id: 1, nombre: "Carla Inventada" }]);
  assert.deepEqual(await ctx.store.pedidosSinCopiar(), []);
  assert.doesNotMatch(ctx.avisos[0], /reintentar/);
});

test("pedido: si la hoja falla, el pedido se guarda, la dueña se entera y /reintentar lo copia", async () => {
  const ctx = ctxConHoja();
  ctx.hoja.falla = true;
  const r = await pedirUno(ctx);
  assert.match(r.texto, /recibido/); // al cliente no le afecta
  assert.equal(ctx.store.pedidos.length, 1);
  assert.match(ctx.avisos[0], /No se pudo copiar a la hoja/);
  assert.equal((await ctx.store.pedidosSinCopiar()).length, 1);
  ctx.hoja.falla = false;
  const rec = crearHoja(ENVH, async () => new Response('{"ok":true}'), ctx.store);
  assert.deepEqual(await rec.reintentar(), { copiados: 1, borrados: 0, fallaron: 0 });
  assert.deepEqual(await ctx.store.pedidosSinCopiar(), []);
});

test("BORRAR también borra en la hoja; si falla queda pendiente y /reintentar lo completa", async () => {
  const ctx = ctxConHoja();
  await pedirUno(ctx);
  ctx.hoja.falla = true;
  await dice(ctx, "u", "BORRAR");
  assert.deepEqual(await ctx.store.borradosPendientes(), [{ pedido_id: 1, clave: "telegram:u" }]);
  assert.match(ctx.avisos.at(-1), /no se pudo borrar en la hoja/);
  assert.equal(ctx.store.pedidos[0].nombre, "(borrado)");
  ctx.hoja.falla = false;
  const rec = crearHoja(ENVH, async () => new Response('{"ok":true}'), ctx.store);
  assert.deepEqual(await rec.reintentar(), { copiados: 0, borrados: 1, fallaron: 0 });
  assert.deepEqual(await ctx.store.borradosPendientes(), []);
  // Y cuando todo funciona a la primera:
  const ctx2 = ctxConHoja();
  await pedirUno(ctx2);
  await dice(ctx2, "u", "borrar");
  assert.deepEqual(ctx2.hoja.borrados, [1]);
  assert.deepEqual(ctx2.hoja.claves, ["telegram:u"]);
  assert.deepEqual(await ctx2.store.borradosPendientes(), []);
});

test("de punta a punta: el motor y el Apps Script de verdad: pedido, cliente y BORRAR", async () => {
  const script = cargarAppsScript();
  const ctx = crearCtx(NEGOCIOS["gorras"]);
  ctx.hoja = crearHoja(ENVH, fetchHaciaAppsScript(script), ctx.store);
  await pedirUno(ctx, "321");
  await pedirUno(ctx, "321"); // el mismo cliente pide otra vez
  assert.equal(script.filas("Pedidos").length, 3);
  const c = script.filas("Clientes");
  assert.deepEqual([c[1][0], c[1][1], c[1][4], c[1][5]], ["telegram:321", "Carla Inventada", 2, 70000]);
  await dice(ctx, "321", "BORRAR");
  assert.equal(script.filas("Clientes").length, 1); // solo el encabezado
  assert.deepEqual(script.filas("Pedidos").slice(1).map((f) => f[3]), ["(borrado)", "(borrado)"]);
});

test("BORRAR de alguien sin pedidos no llama a la hoja", async () => {
  const ctx = ctxConHoja();
  await dice(ctx, "nuevo", "hola");
  await dice(ctx, "nuevo", "borrar");
  assert.deepEqual(ctx.hoja.borrados, []);
});

test("sin hoja configurada todo sigue igual", async () => {
  const ctx = crearCtx(NEGOCIOS["gorras"]);
  const r = await pedirUno(ctx);
  assert.match(r.texto, /recibido/);
  await dice(ctx, "u", "borrar");
});

// ---------- /reintentar por Telegram ----------
test("Telegram: /reintentar solo para la dueña, y avisa si no hay hoja", async () => {
  const env = { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_WEBHOOK_SECRET: "s", OWNER_TELEGRAM_ID: "999" };
  const T = Date.UTC(2026, 10, 5, 15);
  const deps = { store: new MemoryStore(), negocio: NEGOCIOS["gorras"], ahora: () => T, fetch: falsoFetch() };
  const req = (id, de) => new Request("https://x.test/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" }, body: JSON.stringify({ update_id: id, message: { from: { id: de }, chat: { id: de, type: "private" }, text: "/reintentar" } }) });
  await telegramWebhook(req(1, 111), env, deps); // cliente: se trata como texto normal (aviso de privacidad)
  assert.ok(!deps.fetch.llamadas.some((l) => /hoja/i.test(l.cuerpo?.text ?? "")));
  await telegramWebhook(req(2, 999), env, deps);
  assert.match(deps.fetch.llamadas.at(-1).cuerpo.text, /no está configurada/);
  const llamadasHoja = [];
  const f = async (url) => (/script\.google\.com/.test(url) ? (llamadasHoja.push(1), new Response('{"ok":true}')) : new Response("{}"));
  f.llamadas = [];
  await deps.store.guardarPedido({ negocio: "gorras", canal: "telegram", usuario: "1", contacto: "", nombre: "A", nota: "", lineas: [{ nombre: "G", cant: 1 }], total: 1, creado: "x" });
  await telegramWebhook(req(3, 999), { ...env, ...ENVH }, { ...deps, fetch: f });
  assert.equal(llamadasHoja.length, 1);
  assert.deepEqual(await deps.store.pedidosSinCopiar(), []);
});
