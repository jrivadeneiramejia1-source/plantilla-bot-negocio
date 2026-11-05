/**
 * Copia de los pedidos a una hoja de Google Sheets.
 * Se pega dentro de la hoja DEL CLIENTE (Extensiones → Apps Script), así los datos quedan en su cuenta
 * y no hace falta ningún archivo de claves. Ver README.
 *
 * Acciones que recibe el bot (POST con JSON):
 *   {token, accion:"agregar", pedido:{id, creado, canal, nombre, contacto, productos, total, nota}}
 *   {token, accion:"borrar", ids:[1,2]}   // deja en blanco nombre, contacto y nota de esos pedidos
 */
var NOMBRE_HOJA = "Pedidos";
var COLUMNAS = ["Pedido", "Fecha", "Canal", "Nombre", "Contacto", "Productos", "Total", "Nota", "Estado"];

function doGet() {
  return salida_({ ok: true, mensaje: "Copia de pedidos activa" });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var cuerpo;
    try {
      cuerpo = JSON.parse(e.postData.contents);
    } catch (err) {
      return salida_({ ok: false, error: "JSON ilegible" });
    }
    var token = PropertiesService.getScriptProperties().getProperty("TOKEN");
    if (!token || !iguales_(String(cuerpo.token || ""), token)) {
      return salida_({ ok: false, error: "no autorizado" });
    }
    var hoja = hoja_();
    if (cuerpo.accion === "agregar") return agregar_(hoja, cuerpo.pedido);
    if (cuerpo.accion === "borrar") return borrar_(hoja, cuerpo.ids);
    return salida_({ ok: false, error: "acción desconocida" });
  } finally {
    lock.releaseLock();
  }
}

function agregar_(hoja, p) {
  if (!p || typeof p.id !== "number") return salida_({ ok: false, error: "pedido inválido" });
  if (buscarFila_(hoja, p.id) > 0) return salida_({ ok: true, repetido: true }); // ya estaba: no duplicar
  hoja.appendRow([
    p.id,
    celda_(p.creado),
    celda_(p.canal),
    celda_(p.nombre),
    celda_(p.contacto),
    celda_(p.productos),
    typeof p.total === "number" ? p.total : 0,
    celda_(p.nota),
    "nuevo",
  ]);
  return salida_({ ok: true });
}

function borrar_(hoja, ids) {
  if (!Array.isArray(ids)) return salida_({ ok: false, error: "ids inválidos" });
  var borrados = 0;
  for (var i = 0; i < ids.length; i++) {
    var fila = buscarFila_(hoja, ids[i]);
    if (fila > 0) {
      hoja.getRange(fila, 4, 1, 2).setValues([["(borrado)", "(borrado)"]]); // Nombre y Contacto
      hoja.getRange(fila, 8).setValue("(borrado)"); // Nota
      borrados++;
    }
  }
  return salida_({ ok: true, borrados: borrados });
}

function hoja_() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = libro.getSheetByName(NOMBRE_HOJA);
  if (!hoja) {
    hoja = libro.insertSheet(NOMBRE_HOJA);
    hoja.appendRow(COLUMNAS);
    hoja.setFrozenRows(1);
  }
  return hoja;
}

function buscarFila_(hoja, id) {
  var ultima = hoja.getLastRow();
  if (ultima < 2) return -1;
  var ids = hoja.getRange(2, 1, ultima - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (Number(ids[i][0]) === Number(id)) return i + 2;
  return -1;
}

// Un texto que empieza con = + - @ se convertiría en fórmula (inyección). Se antepone una comilla.
function celda_(v) {
  var t = v === null || v === undefined ? "" : String(v);
  return /^[=+\-@\t\r]/.test(t) ? "'" + t : t;
}

function iguales_(a, b) {
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function salida_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
