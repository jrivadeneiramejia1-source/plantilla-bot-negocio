import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore, D1Store } from "../src/store.js";
import { crearD1Falsa } from "./ayudas.js";

// Las mismas pruebas para los dos almacenes: así el SQL de D1 se prueba con SQLite real.
const ALMACENES = { memoria: () => new MemoryStore(), "D1 (SQLite real)": () => new D1Store(crearD1Falsa()) };
const T0 = Date.UTC(2026, 10, 5, 15);
const pedido = (extra = {}) => ({
  negocio: "gorras", canal: "telegram", usuario: "u1", contacto: "@u1", nombre: "Ana", nota: "Calle 1",
  lineas: [{ id: "a", nombre: "Gorra", cant: 2, precio: 35000 }], total: 70000, creado: new Date(T0).toISOString(), ...extra,
});

for (const [nombre, crear] of Object.entries(ALMACENES)) {
  test(`${nombre}: sesiones`, async () => {
    const s = crear();
    assert.equal(await s.getSesion("k"), null);
    await s.putSesion("k", { a: 1 }, T0);
    await s.putSesion("k", { a: 2 }, T0);
    assert.deepEqual(await s.getSesion("k"), { a: 2 });
    await s.borrarSesion("k");
    assert.equal(await s.getSesion("k"), null);
  });

  test(`${nombre}: vistos (duplicados)`, async () => {
    const s = crear();
    assert.equal(await s.marcarVisto("x", T0), true);
    assert.equal(await s.marcarVisto("x", T0), false);
  });

  test(`${nombre}: pedidos, anonimizar y metricas`, async () => {
    const s = crear();
    const id1 = await s.guardarPedido(pedido());
    const id2 = await s.guardarPedido(pedido({ usuario: "u2", nombre: "Bea" }));
    assert.equal(id2, id1 + 1);
    assert.equal((await s.pedidosDesde("gorras", new Date(T0 - 1000).toISOString())).length, 2);
    assert.equal((await s.pedidosDesde("gorras", new Date(T0 + 1000).toISOString())).length, 0);
    assert.equal((await s.pedidosDesde("otro", "2000-01-01")).length, 0);
    await s.anonimizarPedidos("telegram", "u1");
    const todos = await s.pedidosDesde("gorras", "2000-01-01");
    assert.equal(todos.find((p) => p.id === id1).nombre, "(borrado)");
    assert.equal(todos.find((p) => p.id === id2).nombre, "Bea");
    assert.equal(todos.find((p) => p.id === id1).total, 70000);
    await s.sumarMetrica("2026-11-05", "gorras", "telegram", "inicio");
    await s.sumarMetrica("2026-11-05", "gorras", "telegram", "inicio");
    assert.deepEqual(await s.metricasDia("2026-11-05", "gorras"), [{ canal: "telegram", evento: "inicio", n: 2 }]);
  });

  test(`${nombre}: copia a la hoja y borrados pendientes`, async () => {
    const s = crear();
    const id1 = await s.guardarPedido(pedido());
    const id2 = await s.guardarPedido(pedido({ usuario: "u2" }));
    assert.deepEqual((await s.pedidosSinCopiar()).map((p) => p.id), [id1, id2]);
    assert.deepEqual((await s.pedidosSinCopiar())[0].lineas[0].nombre, "Gorra");
    await s.marcarCopiado(id1);
    assert.deepEqual((await s.pedidosSinCopiar()).map((p) => p.id), [id2]);
    assert.deepEqual(await s.idsCopiadosDe("telegram", "u1"), [id1]);
    assert.deepEqual(await s.idsCopiadosDe("telegram", "u2"), []);
    await s.pendienteBorrarEnHoja([id1], "telegram:u1");
    await s.pendienteBorrarEnHoja([id1], "telegram:u1"); // repetido: no duplica
    assert.deepEqual(await s.borradosPendientes(), [{ pedido_id: id1, clave: "telegram:u1" }]);
    await s.quitarBorradosPendientes([id1]);
    assert.deepEqual(await s.borradosPendientes(), []);
  });

  test(`${nombre}: getPedido`, async () => {
    const s = crear();
    const id = await s.guardarPedido(pedido());
    const p = await s.getPedido(id);
    assert.equal(p.nombre, "Ana");
    assert.equal(p.canal, "telegram");
    assert.equal(p.usuario, "u1");
    assert.equal(p.lineas[0].nombre, "Gorra");
    assert.equal((await s.getPedido(String(id))).id, id); // también acepta el número escrito como texto
    assert.equal(await s.getPedido(999), null);
  });

  test(`${nombre}: catálogo guardado`, async () => {
    const s = crear();
    assert.equal(await s.getCatalogo("g"), null);
    await s.putCatalogo("g", [{ id: "a", nombre: "Uno", precio: 1000, descripcion: "" }], T0);
    await s.putCatalogo("g", [{ id: "b", nombre: "Dos", precio: 2000, descripcion: "x" }], T0 + 5000);
    const c = await s.getCatalogo("g");
    assert.deepEqual(c.productos, [{ id: "b", nombre: "Dos", precio: 2000, descripcion: "x" }]);
    assert.equal(c.actualizado, T0 + 5000);
    assert.equal(await s.getCatalogo("otro"), null);
    await s.putCatalogo("g", [], T0);
    assert.deepEqual((await s.getCatalogo("g")).productos, []);
  });

  test(`${nombre}: limpiar borra sesiones y vistos viejos`, async () => {
    const s = crear();
    const viejo = T0 - 8 * 24 * 3600e3;
    await s.putSesion("viejo", { a: 1 }, viejo);
    await s.putSesion("nuevo", { a: 1 }, T0);
    await s.marcarVisto("v-viejo", T0 - 3 * 24 * 3600e3);
    await s.limpiar(T0);
    assert.equal(await s.getSesion("viejo"), null);
    assert.notEqual(await s.getSesion("nuevo"), null);
    assert.equal(await s.marcarVisto("v-viejo", T0), true); // ya no estaba
  });
}
