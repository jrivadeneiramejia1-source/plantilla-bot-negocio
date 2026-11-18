// Pedido más claro: una pregunta por mensaje, celular bien pedido y sugerencia antes de confirmar.
// Todo con negocios, personas y números INVENTADOS.
import test from "node:test";
import assert from "node:assert/strict";
import { NEGOCIOS } from "../src/negocios/index.js";
import { MemoryStore } from "../src/store.js";
import { manejar, normalizarCelular, validarNegocio } from "../src/core.js";
import { enviarTelegram } from "../src/envio.js";
import { telegramWebhook } from "../src/telegram.js";
import { armarMensajeWhatsApp } from "../src/whatsapp.js";
import { crearCtx, dice, toca } from "./ayudas.js";

const GORRAS = NEGOCIOS["gorras"]; // sin sugerencia
const FLORES = NEGOCIOS["flores-fomi"]; // sugiere un girasol

// ---------- celular ----------
test("normalizarCelular: celulares de Colombia en varias formas; lo demás, no", () => {
  for (const ok of ["3001234567", "300 123 4567", "300-123-4567", "+57 300 123 4567", "573001234567", "57 300 123 4567", "0057 3001234567", " (300) 123 4567 "]) {
    assert.equal(normalizarCelular(ok), "300 123 4567", ok);
  }
  for (const mal of ["", "123", "2001234567", "300123456", "30012345678", "abc", "6012345678", "5730012345", "999999999999999999"]) {
    assert.equal(normalizarCelular(mal), null, mal);
  }
  // Un número de otro país solo se acepta cuando el canal ya garantiza que es de la persona.
  assert.equal(normalizarCelular("+34 600 111 222"), null);
  assert.equal(normalizarCelular("+34 600 111 222", true), "+34600111222");
  assert.equal(normalizarCelular("1234567", true), null); // muy corto
  assert.equal(normalizarCelular("1234567890123456", true), null); // muy largo
});

// ---------- flujo en Telegram ----------
async function hastaCelular(ctx, usuario = "u", canal = "telegram") {
  await dice(ctx, usuario, "hola", canal);
  await toca(ctx, usuario, "ok", canal);
  await toca(ctx, usuario, "p:clasica", canal);
  await toca(ctx, usuario, "c:1", canal);
  await toca(ctx, usuario, "fin", canal);
  return dice(ctx, usuario, "Ana Inventada", canal);
}

test("Telegram: el celular se pide aparte, la persona lo escribe (sin botón de compartir), y se guarda bien", async () => {
  const ctx = crearCtx(GORRAS);
  const pide = await hastaCelular(ctx);
  assert.match(pide.texto, /celular/);
  assert.match(pide.texto, /10 dígitos/);
  assert.doesNotMatch(pide.texto, /Compartir/);
  assert.deepEqual(pide.opciones.map((o) => o.id), ["tel:no"]); // solo «Prefiero no darlo»

  const dir = await dice(ctx, "u", "+57 300 123 4567");
  assert.match(dir.texto, /dirección/);
  assert.equal(dir.quitarTeclado, true); // se esconde el botón de compartir número
  const nota = await dice(ctx, "u", "Barrio Inventado, Calle 1 # 2-3");
  assert.match(nota.texto, /color y talla/); // pregunta propia del negocio
  const res = await toca(ctx, "u", "sinnota");
  assert.match(res.texto, /Celular: 300 123 4567/);
  assert.match(res.texto, /Dirección: Barrio Inventado, Calle 1 # 2-3/);
  await toca(ctx, "u", "enviar");

  const p = ctx.store.pedidos[0];
  assert.equal(p.contacto, "300 123 4567"); // msg.contacto venía vacío
  assert.equal(p.nota, "Dirección: Barrio Inventado, Calle 1 # 2-3");
  assert.match(ctx.avisos[0], /Celular: 300 123 4567\nDirección: Barrio Inventado, Calle 1 # 2-3\n/);
});

test("Telegram: un número mal escrito se pide una vez más; si falla otra vez, el pedido sigue sin celular", async () => {
  const ctx = crearCtx(GORRAS);
  await hastaCelular(ctx);
  const otra = await dice(ctx, "u", "mi numero es ese");
  assert.match(otra.texto, /No pude leer ese número/);
  assert.deepEqual(otra.opciones.map((o) => o.id), ["tel:no"]);
  const sigue = await dice(ctx, "u", "123");
  assert.match(sigue.texto, /sigo sin él/);
  assert.match(sigue.texto, /dirección/);
  await dice(ctx, "u", "Calle Inventada 1");
  const res = await toca(ctx, "u", "sinnota");
  assert.match(res.texto, /Celular: \(no lo diste\)/);
  await toca(ctx, "u", "enviar");
  assert.equal(ctx.store.pedidos[0].contacto, "");
  assert.match(ctx.avisos[0], /Celular: \(no lo dio\)/);
  assert.match(ctx.avisos[0], /Contacto: \(escribirle por el mismo canal\)/);
});

test("Telegram: «Prefiero no darlo» (botón o escrito) salta el celular sin insistir", async () => {
  for (const paso of [(ctx) => toca(ctx, "u", "tel:no"), (ctx) => dice(ctx, "u", "Prefiero no darlo"), (ctx) => dice(ctx, "u", "no")]) {
    const ctx = crearCtx(GORRAS);
    await hastaCelular(ctx);
    const dir = await paso(ctx);
    assert.match(dir.texto, /dirección/);
    assert.doesNotMatch(dir.texto, /No pude leer/);
    assert.equal((await ctx.store.getSesion("telegram:u")).telefono, "");
  }
});

test("la dirección no puede quedar vacía, y un @usuario de Telegram se conserva como contacto", async () => {
  const ctx = crearCtx(GORRAS);
  await hastaCelular(ctx);
  await dice(ctx, "u", "3001234567");
  assert.match((await dice(ctx, "u", "  ")).texto, /Necesito la dirección/);
  assert.match((await dice(ctx, "u", "a")).texto, /Necesito la dirección/);
  assert.match((await dice(ctx, "u", "Recojo")).texto, /color y talla/);
  // Con @usuario: el pedido guarda celular + usuario.
  const r = await manejar({ canal: "telegram", usuario: "w", contacto: "@ana_inventada", texto: "hola" }, ctx);
  assert.ok(r.mensajes.length);
  for (const paso of [{ opcion: "ok" }, { opcion: "p:nino" }, { opcion: "c:1" }, { opcion: "fin" }, { texto: "Beto" }, { texto: "3009998877" }, { texto: "Calle Inventada 9" }, { opcion: "sinnota" }, { opcion: "enviar" }]) {
    await manejar({ canal: "telegram", usuario: "w", contacto: "@ana_inventada", ...paso }, ctx);
  }
  assert.equal(ctx.store.pedidos.at(-1).contacto, "300 999 8877 · @ana_inventada");
  assert.match(ctx.avisos.at(-1), /Contacto: @ana_inventada/);
});

// ---------- Telegram de punta a punta por el webhook ----------
function mundoTelegram() {
  const store = new MemoryStore();
  const salidas = [];
  let t = Date.UTC(2026, 10, 5, 15);
  const fetchF = async (url, init) => {
    salidas.push({ url: String(url), cuerpo: JSON.parse(init.body) });
    return new Response("{}", { status: 200 });
  };
  const env = { TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_WEBHOOK_SECRET: "s", OWNER_TELEGRAM_ID: "900" };
  let id = 1;
  const enviar = async (update) => {
    const antes = salidas.length;
    await telegramWebhook(new Request("https://x.test/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s" }, body: JSON.stringify({ update_id: id++, ...update }) }), env, { store, negocio: GORRAS, ahora: () => t, fetch: fetchF });
    return salidas.slice(antes).filter((x) => !/answerCallbackQuery/.test(x.url));
  };
  const texto = (de, text, chat = { id: de, type: "private" }) => enviar({ message: { from: { id: de, username: `u${de}` }, chat, text } });
  const boton = (de, data) => enviar({ callback_query: { id: "c" + id, from: { id: de, username: `u${de}` }, data, message: { chat: { id: de, type: "private" } } } });
  const contacto = (de, c, chat = { id: de, type: "private" }) => enviar({ message: { from: { id: de, username: `u${de}` }, chat, contact: c } });
  return { store, salidas, texto, boton, contacto };
}
async function aCelular(m, de) {
  await m.texto(de, "hola");
  await m.boton(de, "ok");
  await m.boton(de, "p:clasica");
  await m.boton(de, "c:1");
  await m.boton(de, "fin");
  return m.texto(de, "Ana Inventada");
}

test("Telegram real (simulado): el celular se pide por escrito, sin botón de compartir contacto", async () => {
  const m = mundoTelegram();
  const [pide] = await aCelular(m, 55);
  assert.match(pide.cuerpo.text, /Escríbelo con 10 dígitos/);
  assert.deepEqual(pide.cuerpo.reply_markup.inline_keyboard, [[{ text: "Prefiero no darlo", callback_data: "tel:no" }]]);
  assert.ok(!JSON.stringify(pide.cuerpo).includes("request_contact"));
  const [dir] = await m.texto(55, "311 616 9213");
  assert.match(dir.cuerpo.text, /dirección/);
  assert.deepEqual(dir.cuerpo.reply_markup, { remove_keyboard: true }); // limpia un teclado viejo si había quedado
  assert.equal((await m.store.getSesion("telegram:55")).telefono, "311 616 9213");
});

test("Telegram real (simulado): una tarjeta de contacto no se usa como celular; el bot sigue esperando el número escrito", async () => {
  const m = mundoTelegram();
  await aCelular(m, 55);
  const [r] = await m.contacto(55, { phone_number: "573001112222", first_name: "Otra", user_id: 56 });
  assert.match(r.cuerpo.text, /solo entiendo texto y botones/);
  const s = await m.store.getSesion("telegram:55");
  assert.equal(s.paso, "telefono");
  assert.equal(s.telefono, "");
  const grupo = await m.contacto(55, { phone_number: "573001112222", first_name: "X" }, { id: -1001234567890, type: "supergroup" });
  assert.deepEqual(grupo, []); // en un grupo se ignora en silencio
});

test("Telegram real (simulado): el botón «Prefiero no darlo» sigue sin celular", async () => {
  const m = mundoTelegram();
  await aCelular(m, 55);
  const [dir] = await m.boton(55, "tel:no");
  assert.match(dir.cuerpo.text, /dirección/);
  assert.equal((await m.store.getSesion("telegram:55")).telefono, "");
});

test("enviarTelegram: con botones usa botones; sin botones, solo esconde un teclado viejo si se pide", async () => {
  const llamadas = [];
  const f = async (u, init) => (llamadas.push(JSON.parse(init.body)), new Response("{}", { status: 200 }));
  const env = { TELEGRAM_BOT_TOKEN: "tok" };
  await enviarTelegram(env, f, 1, "a", [{ id: "x", titulo: "X" }], { quitarTeclado: true });
  await enviarTelegram(env, f, 1, "c", [], { quitarTeclado: true });
  await enviarTelegram(env, f, 1, "d");
  assert.ok(llamadas[0].reply_markup.inline_keyboard);
  assert.deepEqual(llamadas[1].reply_markup, { remove_keyboard: true });
  assert.equal(llamadas[2].reply_markup, undefined);
});

// ---------- WhatsApp ----------
const wa = (usuario, paso) => ({ canal: "whatsapp", usuario, contacto: `https://wa.me/${usuario}`, ...paso });
async function waHastaCelular(ctx, usuario) {
  for (const paso of [{ texto: "hola" }, { opcion: "ok" }, { opcion: "p:clasica" }, { opcion: "c:1" }, { opcion: "fin" }]) await manejar(wa(usuario, paso), ctx);
  return (await manejar(wa(usuario, { texto: "Beto Inventado" }), ctx)).mensajes.at(-1);
}

test("WhatsApp: se confirma el mismo número en vez de pedirlo (3 botones que caben en WhatsApp)", async () => {
  const ctx = crearCtx(GORRAS);
  const pide = await waHastaCelular(ctx, "573001112233");
  assert.deepEqual(pide.opciones.map((o) => o.id), ["tel:mismo", "tel:otro", "tel:no"]);
  assert.ok(pide.opciones.every((o) => o.titulo.length <= 20));
  const msg = armarMensajeWhatsApp("573001112233", pide.texto, pide.opciones)[0];
  assert.equal(msg.interactive.type, "button");

  const dir = (await manejar(wa("573001112233", { opcion: "tel:mismo" }), ctx)).mensajes.at(-1);
  assert.match(dir.texto, /dirección/);
  assert.equal((await ctx.store.getSesion("whatsapp:573001112233")).telefono, "300 111 2233");
});

test("WhatsApp: «Otro número» pide escribirlo; también se puede contestar con el número de la opción", async () => {
  const ctx = crearCtx(GORRAS);
  await waHastaCelular(ctx, "573001112233");
  const otro = (await manejar(wa("573001112233", { texto: "2" }), ctx)).mensajes.at(-1); // «2» = Otro número, no un celular
  assert.match(otro.texto, /Escribe el número/);
  const dir = (await manejar(wa("573001112233", { texto: "310 555 6677" }), ctx)).mensajes.at(-1);
  assert.match(dir.texto, /dirección/);
  assert.equal((await ctx.store.getSesion("whatsapp:573001112233")).telefono, "310 555 6677");
});

test("WhatsApp: «Prefiero no darlo» y un número extranjero de WhatsApp", async () => {
  const ctx = crearCtx(GORRAS);
  await waHastaCelular(ctx, "573001112233");
  await manejar(wa("573001112233", { opcion: "tel:no" }), ctx);
  assert.equal((await ctx.store.getSesion("whatsapp:573001112233")).telefono, "");

  await waHastaCelular(ctx, "34600111222"); // alguien con WhatsApp de otro país
  await manejar(wa("34600111222", { opcion: "tel:mismo" }), ctx);
  assert.equal((await ctx.store.getSesion("whatsapp:34600111222")).telefono, "+34600111222");
});

test("Los botones del celular de WhatsApp no funcionan en Telegram ni fuera de su paso", async () => {
  const ctx = crearCtx(GORRAS);
  await hastaCelular(ctx, "t"); // Telegram
  const r = await toca(ctx, "t", "tel:mismo");
  assert.equal((await ctx.store.getSesion("telegram:t")).paso, "telefono"); // botón viejo o inventado: no pasa nada
  assert.ok(r.texto);
});

// ---------- sugerencia antes de confirmar ----------
async function aMenuConRosa(ctx, u = "s") {
  await dice(ctx, u, "hola");
  await toca(ctx, u, "ok");
  await toca(ctx, u, "p:rosa");
  await toca(ctx, u, "c:1");
}

test("sugerencia: se ofrece una sola vez; «Sí» agrega 1 y sigue; el precio sale del catálogo", async () => {
  const ctx = crearCtx(FLORES);
  await aMenuConRosa(ctx);
  const sug = await toca(ctx, "s", "fin");
  assert.match(sug.texto, /girasol/);
  assert.match(sug.texto, /\$6\.000/);
  assert.deepEqual(sug.opciones.map((o) => o.id), ["sug:si", "sug:no"]);

  const nombre = await toca(ctx, "s", "sug:si");
  assert.match(nombre.texto, /Listo, agregué Girasol de foami/);
  assert.match(nombre.texto, /nombre/);
  const s = await ctx.store.getSesion("telegram:s");
  assert.deepEqual(s.carrito.map((l) => `${l.id}x${l.cant}`).sort(), ["girasolx1", "rosax1"]);
  for (const paso of ["Ana Inventada", "3001234567", "Calle Inventada 1"]) await dice(ctx, "s", paso);
  await dice(ctx, "s", "Es para mi mamá");
  await toca(ctx, "s", "enviar");
  assert.equal(ctx.store.pedidos[0].total, 4000 + 6000);
});

test("sugerencia: «No, gracias» sigue, y no vuelve a ofrecerse en el mismo pedido", async () => {
  const ctx = crearCtx(FLORES);
  await aMenuConRosa(ctx);
  await toca(ctx, "s", "fin");
  assert.match((await toca(ctx, "s", "sug:no")).texto, /nombre/);
  // Vuelve al menú y confirma otra vez: ya se ofreció.
  await dice(ctx, "s", "menu");
  await toca(ctx, "s", "ver");
  assert.match((await toca(ctx, "s", "fin")).texto, /nombre/);
  // Después de enviar el pedido, el siguiente la vuelve a ofrecer.
  for (const paso of ["Ana Inventada", "3001234567", "Calle Inventada 1"]) await dice(ctx, "s", paso);
  await toca(ctx, "s", "sinnota");
  await toca(ctx, "s", "enviar");
  await toca(ctx, "s", "menu");
  await toca(ctx, "s", "p:rosa");
  await toca(ctx, "s", "c:1");
  assert.match((await toca(ctx, "s", "fin")).texto, /girasol/);
});

test("sugerencia: no se ofrece si ese producto ya está en el pedido, o si ya no está en el catálogo", async () => {
  const ctx = crearCtx(FLORES);
  await dice(ctx, "s", "hola");
  await toca(ctx, "s", "ok");
  await toca(ctx, "s", "p:girasol");
  await toca(ctx, "s", "c:2");
  assert.match((await toca(ctx, "s", "fin")).texto, /nombre/); // ya lleva girasoles

  // Catálogo de la hoja sin el girasol: nada que sugerir, sin errores.
  const sinGirasol = { ...FLORES, productos: FLORES.productos.filter((p) => p.id !== "girasol") };
  const ctx2 = { ...crearCtx(sinGirasol) };
  await aMenuConRosa(ctx2, "t");
  assert.match((await toca(ctx2, "t", "fin")).texto, /nombre/);
});

test("sugerencia: texto suelto o botón viejo mientras se decide no rompe nada", async () => {
  const ctx = crearCtx(FLORES);
  await aMenuConRosa(ctx);
  await toca(ctx, "s", "fin");
  const otra = await dice(ctx, "s", "quién sabe");
  assert.match(otra.texto, /No entendí/);
  assert.match(otra.texto, /girasol/); // vuelve a mostrar la misma pregunta
  assert.match((await dice(ctx, "s", "2")).texto, /nombre/); // «2» = No, gracias
});

// ---------- negocios y datos personales ----------
test("validarNegocio: preguntaNota y sugerencia opcionales, pero bien escritas", () => {
  for (const n of Object.values(NEGOCIOS)) assert.deepEqual(validarNegocio(n), [], n.id);
  const base = NEGOCIOS["gorras"];
  assert.match(validarNegocio({ ...base, preguntaNota: "" }).join(), /preguntaNota/);
  assert.match(validarNegocio({ ...base, preguntaNota: "x".repeat(201) }).join(), /preguntaNota/);
  assert.match(validarNegocio({ ...base, sugerencia: { producto: "no-existe" } }).join(), /sugerencia\.producto/);
  assert.match(validarNegocio({ ...base, sugerencia: { producto: "nino", texto: "" } }).join(), /sugerencia\.texto/);
  assert.deepEqual(validarNegocio({ ...base, sugerencia: { producto: "nino" } }), []);
});

test("BORRAR también quita el celular y la dirección de los pedidos", async () => {
  const ctx = crearCtx(GORRAS);
  await hastaCelular(ctx, "b");
  await dice(ctx, "b", "3001234567");
  await dice(ctx, "b", "Calle Inventada 1");
  await toca(ctx, "b", "sinnota");
  await toca(ctx, "b", "enviar");
  assert.match(ctx.store.pedidos[0].nota, /Calle Inventada 1/);
  await dice(ctx, "b", "borrar");
  const p = ctx.store.pedidos[0];
  assert.equal(p.nota, "(borrado)");
  assert.equal(p.contacto, "(borrado)");
  assert.equal(await ctx.store.getSesion("telegram:b"), null);
});

test("el resumen de una sesión vieja (sin dirección) no se rompe", async () => {
  const ctx = crearCtx(GORRAS);
  await hastaCelular(ctx);
  const s = await ctx.store.getSesion("telegram:u");
  s.paso = "confirmar"; // como una sesión empezada antes de este cambio
  delete s.direccion;
  delete s.telefono;
  await ctx.store.putSesion("telegram:u", s, ctx.ahora());
  const r = await toca(ctx, "u", "ver");
  assert.ok(r.texto);
  const res = await dice(ctx, "u", "pedido");
  assert.ok(res.texto);
});
