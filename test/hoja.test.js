import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { NEGOCIOS } from "../src/negocios/index.js";
import { MemoryStore } from "../src/store.js";
import { crearHoja, direccionValida, hojaConfigurada } from "../src/sheets.js";
import { telegramWebhook } from "../src/telegram.js";
import { crearCtx, dice, toca, falsaHoja, falsoFetch } from "./ayudas.js";

// ---------- el Apps Script, ejecutado con un «Google» de mentira ----------
function cargarAppsScript(token = "palabra-secreta") {
  const filas = [["Pedido", "Fecha", "Canal", "Nombre", "Contacto", "Productos", "Total", "Nota", "Estado"]];
  const hoja = {
    appendRow: (f) => filas.push(f),
    getLastRow: () => filas.length,
    getRange: (fila, col, nf = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nf }, (_, i) => Array.from({ length: nc }, (_, j) => filas[fila - 1 + i][col - 1 + j])),
      setValues: (v) => v.forEach((r, i) => r.forEach((x, j) => (filas[fila - 1 + i][col - 1 + j] = x))),
      setValue: (x) => (filas[fila - 1][col - 1] = x),
    }),
    setFrozenRows() {},
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => hoja, insertSheet: () => hoja }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === "TOKEN" ? token : null) }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (t) => ({ texto: t, setMimeType() { return this; } }) },
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL("../apps-script/Codigo.gs", import.meta.url), "utf8"), ctx);
  const post = (obj) => JSON.parse(ctx.doPost({ postData: { contents: typeof obj === "string" ? obj : JSON.stringify(obj) } }).texto);
  return { filas, post, doGet: () => JSON.parse(ctx.doGet().texto) };
}
const P = (extra = {}) => ({ id: 1, creado: "2026-11-05T15:00:00Z", canal: "telegram", nombre: "Ana", contacto: "@ana", productos: "2 × Gorra", total: 70000, nota: "Calle 1", ...extra });

test("Apps Script: agrega, no duplica y rechaza token malo", () => {
  const s = cargarAppsScript();
  assert.equal(s.doGet().ok, true);
  assert.equal(s.post({ token: "mala", accion: "agregar", pedido: P() }).error, "no autorizado");
  assert.equal(s.post({ accion: "agregar", pedido: P() }).error, "no autorizado");
  assert.equal(s.filas.length, 1); // solo el encabezado
  assert.equal(s.post({ token: "palabra-secreta", accion: "agregar", pedido: P() }).ok, true);
  assert.equal(s.post({ token: "palabra-secreta", accion: "agregar", pedido: P() }).repetido, true);
  assert.equal(s.filas.length, 2);
  assert.deepEqual([...s.filas[1].slice(0, 4)], [1, "2026-11-05T15:00:00Z", "telegram", "Ana"]);
  assert.equal(s.filas[1][8], "nuevo");
});

test("Apps Script: sin TOKEN configurado rechaza todo; entradas malas", () => {
  const s = cargarAppsScript("");
  assert.equal(s.post({ token: "", accion: "agregar", pedido: P() }).error, "no autorizado");
  const t = cargarAppsScript();
  assert.equal(t.post("{no es json").error, "JSON ilegible");
  assert.equal(t.post({ token: "palabra-secreta", accion: "hackear" }).error, "acción desconocida");
  assert.equal(t.post({ token: "palabra-secreta", accion: "agregar", pedido: { id: "uno" } }).error, "pedido inválido");
  assert.equal(t.post({ token: "palabra-secreta", accion: "borrar", ids: "1" }).error, "ids inválidos");
});

test("Apps Script: textos que parecen fórmulas quedan como texto", () => {
  const s = cargarAppsScript();
  s.post({ token: "palabra-secreta", accion: "agregar", pedido: P({ nombre: '=IMPORTXML("http://malo","//a")', nota: "+57 300", contacto: "@x", productos: "-1 × a" }) });
  assert.equal(s.filas[1][3], "'=IMPORTXML(\"http://malo\",\"//a\")");
  assert.equal(s.filas[1][7], "'+57 300");
  assert.equal(s.filas[1][5], "'-1 × a");
  assert.equal(s.filas[1][4], "@x".replace("@", "'@"));
});

test("Apps Script: borrar deja nombre, contacto y nota en blanco", () => {
  const s = cargarAppsScript();
  s.post({ token: "palabra-secreta", accion: "agregar", pedido: P() });
  s.post({ token: "palabra-secreta", accion: "agregar", pedido: P({ id: 2, nombre: "Bea" }) });
  const r = s.post({ token: "palabra-secreta", accion: "borrar", ids: [1, 99] });
  assert.equal(r.borrados, 1);
  assert.deepEqual([s.filas[1][3], s.filas[1][4], s.filas[1][7]], ["(borrado)", "(borrado)", "(borrado)"]);
  assert.equal(s.filas[1][6], 70000); // el total se conserva
  assert.equal(s.filas[2][3], "Bea");
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

const ENVH = { SHEETS_URL: "https://script.google.com/macros/s/ABC/exec", SHEETS_TOKEN: "palabra-secreta" };
const respuestaHoja = (cuerpo, status = 200) => async () => new Response(JSON.stringify(cuerpo), { status });

test("crearHoja: sin configurar devuelve null; manda token y datos; falla con error claro", async () => {
  assert.equal(crearHoja({}, falsoFetch(), new MemoryStore()), null);
  const store = new MemoryStore();
  const id = await store.guardarPedido({ negocio: "g", canal: "whatsapp", usuario: "57", contacto: "https://wa.me/57", nombre: "Ana", nota: "", lineas: [{ nombre: "Gorra", cant: 2 }], total: 10, creado: "x" });
  const llamadas = [];
  const f = async (url, init) => (llamadas.push({ url, init, cuerpo: JSON.parse(init.body) }), new Response('{"ok":true}'));
  await crearHoja(ENVH, f, store).copiar(id, (await store.pedidosSinCopiar())[0]);
  assert.equal(llamadas[0].cuerpo.token, "palabra-secreta");
  assert.equal(llamadas[0].cuerpo.pedido.productos, "2 × Gorra");
  assert.equal(llamadas[0].init.redirect, "follow");
  assert.deepEqual(await store.pedidosSinCopiar(), []);
  for (const [f2, texto] of [
    [respuestaHoja({}, 500), /respondió 500/],
    [respuestaHoja({ ok: false, error: "no autorizado" }), /no autorizado/],
    [async () => new Response("<html>login</html>"), /ilegible/],
  ]) await assert.rejects(() => crearHoja(ENVH, f2, store).borrar([1]), texto);
  await assert.rejects(() => crearHoja({ SHEETS_URL: "https://evil.com/x", SHEETS_TOKEN: "t" }, falsoFetch(), store).borrar([1]), /no es una dirección/);
  // El token nunca aparece en los mensajes de error.
  await assert.rejects(() => crearHoja(ENVH, respuestaHoja({}, 500), store).borrar([1]), (e) => !e.message.includes("palabra-secreta") && !e.message.includes("ABC"));
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
  assert.deepEqual(await ctx.store.borradosPendientes(), [1]);
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
  assert.deepEqual(await ctx2.store.borradosPendientes(), []);
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
  const deps = { store: new MemoryStore(), negocio: NEGOCIOS["gorras"], ahora: () => T, fetch: falsoFetch() };
  const T = Date.UTC(2026, 10, 5, 15);
  const req = (id, de) => new Request("https://x.test/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" }, body: JSON.stringify({ update_id: id, message: { from: { id: de }, chat: { id: de, type: "private" }, text: "/reintentar" } }) });
  await telegramWebhook(req(1, 111), env, deps); // cliente: se trata como texto normal (aviso de privacidad)
  assert.ok(!deps.fetch.llamadas.some((l) => /hoja/i.test(l.cuerpo?.text ?? "")));
  await telegramWebhook(req(2, 999), env, deps);
  assert.match(deps.fetch.llamadas.at(-1).cuerpo.text, /no está configurada/);
  const llamadasHoja = [];
  const f = async (url, init) => (/script\.google\.com/.test(url) ? (llamadasHoja.push(1), new Response('{"ok":true}')) : new Response("{}"));
  f.llamadas = [];
  const id = await deps.store.guardarPedido({ negocio: "gorras", canal: "telegram", usuario: "1", contacto: "", nombre: "A", nota: "", lineas: [{ nombre: "G", cant: 1 }], total: 1, creado: "x" });
  await telegramWebhook(req(3, 999), { ...env, ...ENVH }, { ...deps, fetch: f });
  assert.equal(llamadasHoja.length, 1);
  assert.deepEqual(await deps.store.pedidosSinCopiar(), []);
  assert.equal(id, 1);
});
