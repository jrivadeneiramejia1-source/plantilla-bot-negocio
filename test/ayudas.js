import { MemoryStore } from "../src/store.js";
import { manejar } from "../src/core.js";

export function crearCtx(negocio, t0 = Date.UTC(2026, 10, 5, 15, 0, 0)) {
  const avisos = [];
  const reloj = { t: t0 };
  return {
    negocio,
    store: new MemoryStore(),
    ahora: () => reloj.t,
    reloj,
    avisos,
    notificarDueno: async (txt) => void avisos.push(txt),
  };
}

// Escribe como cliente y devuelve el último mensaje del bot.
export async function dice(ctx, usuario, texto, canal = "telegram") {
  const r = await manejar({ canal, usuario, contacto: "", texto }, ctx);
  return r.mensajes[r.mensajes.length - 1];
}
export async function toca(ctx, usuario, opcion, canal = "telegram") {
  const r = await manejar({ canal, usuario, contacto: "", opcion }, ctx);
  return r.mensajes[r.mensajes.length - 1];
}

// Falso fetch que anota las llamadas.
export function falsoFetch(estado = 200) {
  const llamadas = [];
  const f = async (url, init) => {
    llamadas.push({ url: String(url), cuerpo: init?.body ? JSON.parse(init.body) : null, init });
    return new Response("{}", { status: estado });
  };
  f.llamadas = llamadas;
  return f;
}

// ---------- D1 de mentira con SQLite real (node:sqlite) para probar el SQL de D1Store ----------
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export function crearD1Falsa() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  return {
    prepare(sql) {
      const st = db.prepare(sql);
      let args = [];
      const api = {
        bind(...a) {
          args = a;
          return api;
        },
        async first() {
          const r = st.get(...args);
          return r ? { ...r } : null;
        },
        async all() {
          return { results: st.all(...args).map((r) => ({ ...r })) };
        },
        async run() {
          const r = st.run(...args);
          return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
        },
      };
      return api;
    },
  };
}

// «Hoja de Google» de mentira: guarda lo que recibe y puede fallar a pedido.
export function falsaHoja() {
  const h = { agregados: [], borrados: [], falla: false };
  h.copiar = async (id, p) => {
    if (h.falla) throw new Error("hoja caída");
    h.agregados.push({ id, nombre: p.nombre });
    await h.store?.marcarCopiado(id);
  };
  h.borrar = async (ids, clave) => {
    if (h.falla) throw new Error("hoja caída");
    h.borrados.push(...ids);
    h.claves = [...(h.claves ?? []), clave];
  };
  return h;
}

// ---------- El Apps Script de verdad, ejecutado con una hoja de Google de mentira (varias pestañas) ----------
import vm from "node:vm";

export function cargarAppsScript(token = "palabra-secreta") {
  const hojas = {};
  const crear = (nombre) => (hojas[nombre] = { nombre, filas: [], validaciones: [], congeladas: 0 });
  const api = (h) => ({
    appendRow: (f) => h.filas.push(f.slice()),
    getLastRow: () => h.filas.length,
    setFrozenRows: (n) => (h.congeladas = n),
    deleteRow: (n) => h.filas.splice(n - 1, 1),
    getRange: (fila, col, nf = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nf }, (_, i) => Array.from({ length: nc }, (_, j) => h.filas[fila - 1 + i]?.[col - 1 + j] ?? "")),
      setValues: (v) => v.forEach((r, i) => r.forEach((x, j) => ((h.filas[fila - 1 + i] ??= [])[col - 1 + j] = x))),
      setValue: (x) => ((h.filas[fila - 1] ??= [])[col - 1] = x),
      setDataValidation: (r) => h.validaciones.push({ fila, col, nf, regla: r }),
    }),
  });
  const libro = { getSheetByName: (n) => (hojas[n] ? api(hojas[n]) : null), insertSheet: (n) => api(crear(n)) };
  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => libro,
      newDataValidation: () => {
        const r = {};
        const b = { requireValueInList: (l) => ((r.lista = [...l]), b), setAllowInvalid: (x) => ((r.permitirInvalido = x), b), build: () => r };
        return b;
      },
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === "TOKEN" ? token : null) }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (t) => ({ texto: t, setMimeType() { return this; } }) },
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL("../apps-script/Codigo.gs", import.meta.url), "utf8"), ctx);
  const post = (obj) => JSON.parse(ctx.doPost({ postData: { contents: typeof obj === "string" ? obj : JSON.stringify(obj) } }).texto);
  const filas = (nombre) => JSON.parse(JSON.stringify(hojas[nombre]?.filas ?? []));
  const poner = (nombre, fila, valores) => {
    (hojas[nombre] ??= crear(nombre));
    (hojas[nombre].filas[fila - 1] = valores.slice());
  };
  return { post, doGet: () => JSON.parse(ctx.doGet().texto), filas, hojas, poner, token };
}

// Un fetch que, en vez de ir a internet, le habla directo a ese Apps Script (prueba el Worker contra el script de verdad).
export function fetchHaciaAppsScript(script, registro = []) {
  const f = async (url, init) => {
    if (!/script\.google\.com/.test(String(url))) return new Response("{}", { status: 200 });
    const cuerpo = JSON.parse(init.body);
    registro.push(cuerpo);
    return new Response(JSON.stringify(script.post(cuerpo)), { status: 200 });
  };
  f.registro = registro;
  f.llamadas = [];
  return f;
}
