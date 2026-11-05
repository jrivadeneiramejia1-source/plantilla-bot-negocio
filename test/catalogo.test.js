import test from "node:test";
import assert from "node:assert/strict";
import { NEGOCIOS } from "../src/negocios/index.js";
import { MemoryStore } from "../src/store.js";
import { crearHoja } from "../src/sheets.js";
import { crearNegocioVigente, normalizarProductos, refrescarCatalogo, TTL_CATALOGO_MS } from "../src/catalogo.js";
import { cargarAppsScript, fetchHaciaAppsScript } from "./ayudas.js";

const ENVH = { SHEETS_URL: "https://script.google.com/macros/s/ABC/exec", SHEETS_TOKEN: "palabra-secreta" };
const BASE = NEGOCIOS["gorras"];
const F = (codigo, nombre, precio, desc = "", activo = "Sí") => [codigo, nombre, precio, desc, activo, ""];

function entorno() {
  const script = cargarAppsScript();
  const store = new MemoryStore();
  const reloj = { t: Date.UTC(2026, 10, 5, 15) };
  const estado = { falla: false, consultas: 0 };
  const ir = fetchHaciaAppsScript(script);
  const fetchF = async (url, init) => {
    if (estado.falla) throw new Error("sin internet");
    if (JSON.parse(init.body).accion === "catalogo") estado.consultas++;
    return ir(url, init);
  };
  fetchF.llamadas = [];
  script.post({ token: script.token, accion: "catalogo" }); // crea la pestaña
  const poner = (filas) => filas.forEach((f, i) => script.poner("Productos", i + 2, f));
  const nuevoPedido = () => crearNegocioVigente(BASE, ENVH, fetchF, store, () => reloj.t); // cada mensaje nuevo = una petición nueva
  return { script, store, reloj, estado, poner, nuevoPedido, fetchF };
}

test("normalizarProductos: revisa todo otra vez (la hoja la editan varias personas)", () => {
  const bueno = { id: "a", nombre: "  Rosa  de   foami ", precio: 4000, descripcion: "Con\ntallo" };
  const lista = [
    bueno,
    { id: "a", nombre: "Repetido", precio: 1 },
    { id: "Mayus", nombre: "Código malo", precio: 1 },
    { id: "b", nombre: "N".repeat(25), precio: 1 },
    { id: "c", nombre: "", precio: 1 },
    { id: "d", nombre: "Decimal", precio: 1.5 },
    { id: "e", nombre: "Cero", precio: 0 },
    { id: "f", nombre: "Texto", precio: "4000" },
    { id: "g", nombre: "Caro", precio: 2e8 },
    null,
    "no soy un objeto",
  ];
  const r = normalizarProductos(lista);
  assert.deepEqual(r.productos, [{ id: "a", nombre: "Rosa de foami", precio: 4000, descripcion: "Con tallo" }]);
  assert.equal(r.avisos.length, 10); // los 8 productos malos y los 2 elementos que ni siquiera son productos
  assert.deepEqual(normalizarProductos("x"), { productos: [], avisos: [] });
  const muchos = normalizarProductos(Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, nombre: `P${i}`, precio: 100 })));
  assert.equal(muchos.productos.length, 9);
  assert.match(muchos.avisos[0], /sobra/);
  assert.ok(normalizarProductos([{ id: "x", nombre: "N", precio: 1, descripcion: "D".repeat(200) }]).productos[0].descripcion.length <= 80);
});

test("sin hoja configurada se usa el catálogo del código", async () => {
  const store = new MemoryStore();
  const v = crearNegocioVigente(BASE, {}, async () => assert.fail("no debe llamar a nadie"), store, () => 1);
  assert.equal(await v(), BASE);
});

test("con la hoja vacía (nunca llenada) se usa el catálogo del código", async () => {
  const e = entorno();
  assert.equal((await e.nuevoPedido()()).productos, BASE.productos);
});

test("con productos en la hoja se usan esos, y el resto del negocio no cambia", async () => {
  const e = entorno();
  e.poner([F("rosa", "Rosa de foami", 4000, "Con tallo"), F("", "Girasol", "$ 6.000")]);
  const n = await e.nuevoPedido()();
  assert.deepEqual(n.productos.map((p) => [p.id, p.nombre, p.precio]), [["rosa", "Rosa de foami", 4000], ["p1", "Girasol", 6000]]);
  assert.equal(n.nombre, BASE.nombre);
  assert.equal(n.cierre, BASE.cierre);
});

test("guarda el catálogo unos minutos y luego vuelve a preguntar (cambios de precio se ven)", async () => {
  const e = entorno();
  e.poner([F("rosa", "Rosa", 4000)]);
  assert.equal((await e.nuevoPedido()()).productos[0].precio, 4000);
  assert.equal(e.estado.consultas, 1);
  e.script.poner("Productos", 2, F("rosa", "Rosa", 4500));
  e.reloj.t += TTL_CATALOGO_MS - 1000;
  assert.equal((await e.nuevoPedido()()).productos[0].precio, 4000); // todavía vale lo guardado
  assert.equal(e.estado.consultas, 1);
  e.reloj.t += 2000;
  assert.equal((await e.nuevoPedido()()).productos[0].precio, 4500);
  assert.equal(e.estado.consultas, 2);
});

test("dentro de una misma petición se pregunta una sola vez", async () => {
  const e = entorno();
  e.poner([F("rosa", "Rosa", 4000)]);
  const v = e.nuevoPedido();
  await v();
  await v();
  await v();
  assert.equal(e.estado.consultas, 1);
});

test("si la hoja no responde, se conserva el último catálogo y no se insiste en cada mensaje", async () => {
  const e = entorno();
  e.poner([F("rosa", "Rosa", 4000)]);
  await e.nuevoPedido()();
  e.reloj.t += TTL_CATALOGO_MS + 1;
  e.estado.falla = true;
  assert.equal((await e.nuevoPedido()()).productos[0].precio, 4000); // sigue vendiendo con lo último bueno
  e.estado.falla = false;
  e.script.poner("Productos", 2, F("rosa", "Rosa", 9999));
  assert.equal((await e.nuevoPedido()()).productos[0].precio, 4000); // en los próximos 15 s no vuelve a intentar
  assert.equal(e.estado.consultas, 1);
  e.reloj.t += 16000;
  assert.equal((await e.nuevoPedido()()).productos[0].precio, 9999); // ya se recuperó
});

test("primera lectura fallida: se usa el catálogo del código", async () => {
  const e = entorno();
  e.poner([F("rosa", "Rosa", 4000)]);
  e.estado.falla = true;
  assert.equal((await e.nuevoPedido()()).productos, BASE.productos);
});

test("si alguien vacía la hoja o la deja toda mal, el bot conserva el último catálogo bueno", async () => {
  const e = entorno();
  e.poner([F("rosa", "Rosa", 4000), F("giro", "Girasol", 6000)]);
  await e.nuevoPedido()();
  e.script.poner("Productos", 2, F("rosa", "", "abc"));
  e.script.poner("Productos", 3, F("giro", "", -1));
  e.reloj.t += TTL_CATALOGO_MS + 1;
  assert.deepEqual((await e.nuevoPedido()()).productos.map((p) => p.id), ["rosa", "giro"]);
  e.script.hojas.Productos.filas.length = 1; // borró todo
  e.reloj.t += TTL_CATALOGO_MS + 1;
  assert.deepEqual((await e.nuevoPedido()()).productos.map((p) => p.id), ["rosa", "giro"]);
});

test("un producto en «No» desaparece del menú", async () => {
  const e = entorno();
  e.poner([F("rosa", "Rosa", 4000), F("giro", "Girasol", 6000)]);
  await e.nuevoPedido()();
  e.script.poner("Productos", 3, F("giro", "Girasol", 6000, "", "No"));
  e.reloj.t += TTL_CATALOGO_MS + 1;
  assert.deepEqual((await e.nuevoPedido()()).productos.map((p) => p.id), ["rosa"]);
});

test("refrescarCatalogo: hoja vacía se llena con los ejemplos; después solo informa", async () => {
  const e = entorno();
  const hoja = crearHoja(ENVH, e.fetchF, e.store);
  const r1 = await refrescarCatalogo(BASE, hoja, e.store, () => e.reloj.t);
  assert.equal(r1.sembrados, BASE.productos.length);
  assert.deepEqual(r1.productos.map((p) => p.nombre), BASE.productos.map((p) => p.nombre));
  assert.equal(e.script.filas("Productos").length, BASE.productos.length + 1);
  assert.equal((await e.store.getCatalogo(BASE.id)).productos.length, BASE.productos.length);
  e.script.poner("Productos", 2, F("clasica", "", 35000));
  const r2 = await refrescarCatalogo(BASE, hoja, e.store, () => e.reloj.t);
  assert.equal(r2.sembrados, 0);
  assert.equal(r2.productos.length, BASE.productos.length - 1);
  assert.match(r2.avisos[0], /Falta el nombre/);
});
