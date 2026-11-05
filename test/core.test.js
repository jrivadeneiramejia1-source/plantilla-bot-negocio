import test from "node:test";
import assert from "node:assert/strict";
import { NEGOCIOS } from "../src/negocios/index.js";
import { validarNegocio, pesos, limpiar, resumenDelDia, manejar, LIMITES } from "../src/core.js";
import { crearCtx, dice, toca } from "./ayudas.js";

test("los 3 negocios inventados son válidos", () => {
  for (const n of Object.values(NEGOCIOS)) assert.deepEqual(validarNegocio(n), [], n.id);
});

test("validarNegocio detecta errores", () => {
  const malo = { id: "X Y", nombre: "", productos: [{ id: "a", nombre: "a", precio: -1 }, { id: "a", nombre: "a", precio: 1.5 }] };
  assert.ok(validarNegocio(malo).length >= 5);
});

test("pesos y limpiar", () => {
  assert.equal(pesos(1234567), "$1.234.567");
  assert.equal(pesos(4000), "$4.000");
  assert.equal(limpiar("  hola\n\n\tmundo\u0000 ", 60), "hola mundo");
  assert.equal(limpiar("x".repeat(100), 10).length, 10);
});

for (const negocio of Object.values(NEGOCIOS)) {
  test(`flujo completo de pedido: ${negocio.id}`, async () => {
    const ctx = crearCtx(negocio);
    const primero = await dice(ctx, "u1", "hola");
    assert.match(primero.texto, /BORRAR/);
    assert.deepEqual(primero.opciones.map((o) => o.id), ["ok", "no"]);

    // Sin aceptar el aviso no avanza.
    const sinAceptar = await dice(ctx, "u1", "quiero pedir");
    assert.match(sinAceptar.texto, /Aceptas/);

    const menu = await toca(ctx, "u1", "ok");
    assert.ok(menu.opciones.length >= negocio.productos.length);
    const p0 = negocio.productos[0];
    const cant = await toca(ctx, "u1", `p:${p0.id}`);
    assert.match(cant.texto, /Cuántas/);
    const tras = await toca(ctx, "u1", "c:2");
    assert.match(tras.texto, new RegExp(pesos(p0.precio * 2).replace("$", "\\$")));
    const ver = await toca(ctx, "u1", "ver");
    assert.match(ver.texto, /Total/);
    const nombre = await toca(ctx, "u1", "fin");
    assert.match(nombre.texto, /nombre/);
    const nota = await dice(ctx, "u1", "Ana Prueba");
    assert.match(nota.texto, /dirección/);
    const resumen = await dice(ctx, "u1", "Calle falsa 123, tel 3000000000");
    assert.match(resumen.texto, /Calle falsa 123/);
    const fin = await toca(ctx, "u1", "enviar");
    assert.match(fin.texto, /#1 recibido/);

    assert.equal(ctx.store.pedidos.length, 1);
    assert.equal(ctx.store.pedidos[0].total, p0.precio * 2);
    assert.equal(ctx.avisos.length, 1);
    assert.match(ctx.avisos[0], /Pedido nuevo #1/);
    // El carrito queda vacío.
    assert.equal((await ctx.store.getSesion("telegram:u1")).carrito.length, 0);
  });
}

test("cantidad escrita a mano: válida, inválida y fuera de rango", async () => {
  const ctx = crearCtx(NEGOCIOS["gorras"]);
  await dice(ctx, "u", "hola");
  await toca(ctx, "u", "ok");
  await toca(ctx, "u", "p:clasica");
  assert.match((await dice(ctx, "u", "muchas")).texto, /número del 1 al 99/);
  assert.match((await dice(ctx, "u", "0")).texto, /número del 1 al 99/);
  assert.match((await dice(ctx, "u", "100")).texto, /número del 1 al 99/);
  const ok = await dice(ctx, "u", "12");
  assert.match(ok.texto, /\$420\.000/);
});

test("el precio sale del catálogo, no de la sesión (sesión manipulada)", async () => {
  const ctx = crearCtx(NEGOCIOS["gorras"]);
  await dice(ctx, "u", "hola");
  await toca(ctx, "u", "ok");
  await toca(ctx, "u", "p:clasica");
  await toca(ctx, "u", "c:1");
  const s = await ctx.store.getSesion("telegram:u");
  s.carrito.push({ id: "no-existe", cant: 50, precio: 1 });
  s.carrito[0].precio = 1;
  await ctx.store.putSesion("telegram:u", s, ctx.ahora());
  await toca(ctx, "u", "fin");
  await dice(ctx, "u", "Beto");
  await toca(ctx, "u", "sinnota");
  await toca(ctx, "u", "enviar");
  assert.equal(ctx.store.pedidos[0].total, 35000);
  assert.equal(ctx.store.pedidos[0].lineas.length, 1);
});

test("botones viejos o inventados no hacen nada peligroso", async () => {
  const ctx = crearCtx(NEGOCIOS["gorras"]);
  await dice(ctx, "u", "hola");
  await toca(ctx, "u", "ok");
  await toca(ctx, "u", "p:clasica");
  await toca(ctx, "u", "c:1");
  await toca(ctx, "u", "fin");
  await dice(ctx, "u", "Beto");
  await toca(ctx, "u", "sinnota");
  await toca(ctx, "u", "enviar");
  const n = ctx.store.pedidos.length;
  // Repetir el botón «Enviar pedido» (doble toque o botón viejo) no crea otro pedido.
  const r = await toca(ctx, "u", "enviar");
  assert.equal(ctx.store.pedidos.length, n);
  assert.ok(r.texto.length > 0);
  await toca(ctx, "u", "p:../../etc");
  await toca(ctx, "u", "c:999999");
  assert.equal(ctx.store.pedidos.length, n);
});

test("BORRAR elimina la sesión y deja los pedidos sin datos personales", async () => {
  const ctx = crearCtx(NEGOCIOS["fresas-crema"]);
  await dice(ctx, "u", "hola");
  await toca(ctx, "u", "ok");
  await toca(ctx, "u", "p:vaso-p");
  await toca(ctx, "u", "c:1");
  await toca(ctx, "u", "fin");
  await dice(ctx, "u", "Carla Inventada");
  await dice(ctx, "u", "Dirección inventada 1");
  await toca(ctx, "u", "enviar");
  const r = await dice(ctx, "u", "BORRAR");
  assert.match(r.texto, /borré/);
  assert.equal(await ctx.store.getSesion("telegram:u"), null);
  const p = ctx.store.pedidos[0];
  assert.equal(p.nombre, "(borrado)");
  assert.equal(p.nota, "(borrado)");
  assert.equal(p.usuario, "(borrado)");
  assert.equal(p.total, 8000); // el valor contable se conserva
  // BORRAR también funciona en medio de pedir el nombre.
  await dice(ctx, "u2", "hola");
  await toca(ctx, "u2", "ok");
  await toca(ctx, "u2", "p:vaso-p");
  await toca(ctx, "u2", "c:1");
  await toca(ctx, "u2", "fin");
  await dice(ctx, "u2", "borrar");
  assert.equal(await ctx.store.getSesion("telegram:u2"), null);
});

test("no acepto el aviso: no se guarda nada", async () => {
  const ctx = crearCtx(NEGOCIOS["gorras"]);
  await dice(ctx, "u", "hola");
  const r = await toca(ctx, "u", "no");
  assert.match(r.texto, /no guardé nada/);
  assert.equal(await ctx.store.getSesion("telegram:u"), null);
});

test("opciones por número y texto libre sin sentido", async () => {
  const ctx = crearCtx(NEGOCIOS["gorras"]);
  await dice(ctx, "u", "hola");
  const menu = await dice(ctx, "u", "1"); // «1» = Acepto
  assert.match(menu.texto, /Gorra clásica/);
  const cant = await dice(ctx, "u", "2"); // segundo producto
  assert.match(cant.texto, /Gorra bordada/);
  await dice(ctx, "u", "menu");
  const raro = await dice(ctx, "u", "¿tienen envío a Bogotá?");
  assert.match(raro.texto, /No entendí/);
});

test("el nombre y la nota se limpian y se recortan", async () => {
  const ctx = crearCtx(NEGOCIOS["gorras"]);
  await dice(ctx, "u", "hola");
  await toca(ctx, "u", "ok");
  await toca(ctx, "u", "p:nino");
  await toca(ctx, "u", "c:1");
  await toca(ctx, "u", "fin");
  await dice(ctx, "u", "<b>X</b>\n".repeat(50));
  await dice(ctx, "u", "n".repeat(2000));
  await toca(ctx, "u", "enviar");
  const p = ctx.store.pedidos[0];
  assert.ok(p.nombre.length <= LIMITES.nombre);
  assert.ok(p.nota.length <= LIMITES.nota);
  assert.ok(!/\n/.test(p.nombre));
});

test("tope de mensajes por hora", async () => {
  const ctx = crearCtx(NEGOCIOS["gorras"]);
  let ultimo;
  for (let i = 0; i < LIMITES.mensajesPorHora + 3; i++) {
    const r = await manejar({ canal: "telegram", usuario: "spam", texto: "hola" }, ctx);
    ultimo = r.mensajes;
    if (i === LIMITES.mensajesPorHora) assert.match(ultimo[0].texto, /muchos mensajes/);
  }
  assert.deepEqual(ultimo, []); // después del aviso, silencio
  ctx.reloj.t += 3600e3 + 1; // una hora después, vuelve a atender
  const r = await manejar({ canal: "telegram", usuario: "spam", texto: "hola" }, ctx);
  assert.ok(r.mensajes.length > 0);
});

test("resumen del día cuenta por canal y usa hora de Colombia", async () => {
  const ctx = crearCtx(NEGOCIOS["flores-fomi"]);
  for (const [canal, u] of [["telegram", "a"], ["whatsapp", "b"], ["whatsapp", "c"]]) {
    await dice(ctx, u, "hola", canal);
    await toca(ctx, u, "ok", canal);
    if (u !== "c") {
      await toca(ctx, u, "p:rosa", canal);
      await toca(ctx, u, "c:3", canal);
      await toca(ctx, u, "fin", canal);
      await dice(ctx, u, `Cliente ${u}`, canal);
      await toca(ctx, u, "sinnota", canal);
      await toca(ctx, u, "enviar", canal);
    }
  }
  const txt = await resumenDelDia(ctx.store, ctx.negocio, ctx.ahora());
  assert.match(txt, /2 pedidos, \$24\.000/);
  assert.match(txt, /Telegram: 1 conversaciones, 1 pedidos \(100%\)/);
  assert.match(txt, /WhatsApp: 2 conversaciones, 1 pedidos \(50%\)/);
  // A las 23:30 en Colombia (04:30 UTC del día siguiente) sigue siendo «hoy».
  const tarde = Date.UTC(2026, 10, 6, 4, 30);
  const ctx2 = crearCtx(NEGOCIOS["flores-fomi"], Date.UTC(2026, 10, 5, 22, 0));
  await dice(ctx2, "z", "hola"); await toca(ctx2, "z", "ok"); await toca(ctx2, "z", "p:rosa"); await toca(ctx2, "z", "c:1");
  await toca(ctx2, "z", "fin"); await dice(ctx2, "z", "Z"); await toca(ctx2, "z", "sinnota");
  ctx2.reloj.t = Date.UTC(2026, 10, 5, 23, 59);
  await toca(ctx2, "z", "enviar");
  ctx2.reloj.t = tarde;
  assert.match(await resumenDelDia(ctx2.store, ctx2.negocio, tarde), /1 pedidos/);
});
