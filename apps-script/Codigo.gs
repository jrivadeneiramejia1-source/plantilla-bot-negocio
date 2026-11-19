/**
 * Hoja de Google del negocio: pedidos, clientes y productos.
 * Se pega dentro de la hoja DEL CLIENTE (Extensiones → Apps Script), así los datos quedan en su cuenta
 * y no hace falta ningún archivo de claves. Ver README.
 *
 * Pestañas (se crean solas):
 *   Pedidos   : una fila por pedido (la escribe el bot): fecha en hora de Colombia, celular, dirección, nota y total en pesos.
 *   Clientes  : una fila por cliente (nombre, celular, contacto, cuántos pedidos y cuánto ha comprado).
 *   Productos : el catálogo. LO EDITA LA DUEÑA desde el celular; el bot lo lee cada par de minutos.
 *
 * Acciones que recibe el bot (POST con JSON y una palabra secreta «token»):
 *   agregar  {pedido:{id, clave, creado, canal, nombre, contacto, productos, total, nota,
 *                     telefono?, direccion?, notaLibre?, contactoCanal?}}  // los 4 últimos vienen separados si el bot los tiene;
 *                                                                          // si no, se separan de «contacto» y «nota»
 *   borrar   {ids:[1,2], clave}   // deja en blanco los datos personales y quita al cliente de «Clientes»
 *   catalogo {}                   // devuelve los productos activos y válidos, y escribe «Estado» en cada fila
 *   sembrar  {productos:[...]}    // copia productos de ejemplo SOLO si la pestaña Productos está vacía
 */
var HOJA_PEDIDOS = "Pedidos";
var HOJA_CLIENTES = "Clientes";
var HOJA_PRODUCTOS = "Productos";
var COLS_PEDIDOS = ["Pedido", "Fecha", "Canal", "Nombre", "Celular", "Contacto", "Productos", "Total", "Dirección", "Nota", "Estado"];
var COLS_CLIENTES = ["Clave", "Nombre", "Celular", "Contacto", "Canal", "Pedidos", "Total comprado", "Primer pedido", "Último pedido"];
// Formato anterior: si la hoja ya lo tiene, se convierte sola al formato nuevo (sin perder filas).
var COLS_PEDIDOS_V1 = ["Pedido", "Fecha", "Canal", "Nombre", "Contacto", "Productos", "Total", "Nota", "Estado"];
var COLS_CLIENTES_V1 = ["Clave", "Nombre", "Contacto", "Canal", "Pedidos", "Total comprado", "Primer pedido", "Último pedido"];
var FORMATO_PESOS = '"$"#,##0';
var FILAS_FORMATO = 2000;
var COLS_PRODUCTOS = ["Código", "Nombre", "Precio", "Descripción", "Activo", "Estado"];
var MAX_PRODUCTOS = 9; // la lista de WhatsApp admite 10 filas y una es «Ver mi pedido»
var MAX_NOMBRE = 24;
var MAX_DESCRIPCION = 80;
var MAX_PRECIO = 100000000;
var FILAS_LISTA = 500;

function doGet() {
  return salida_({ ok: true, mensaje: "Hoja del negocio activa" });
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
    if (cuerpo.accion === "agregar") return agregar_(cuerpo.pedido);
    if (cuerpo.accion === "borrar") return borrar_(cuerpo.ids, cuerpo.clave);
    if (cuerpo.accion === "catalogo") return catalogo_();
    if (cuerpo.accion === "sembrar") return sembrar_(cuerpo.productos);
    return salida_({ ok: false, error: "acción desconocida" });
  } finally {
    lock.releaseLock();
  }
}

// ---------- pedidos y clientes ----------
function agregar_(p) {
  if (!p || typeof p.id !== "number") return salida_({ ok: false, error: "pedido inválido" });
  var hoja = hojaPedidos_();
  if (buscarFila_(hoja, 1, p.id) > 0) return salida_({ ok: true, repetido: true }); // ya estaba: no duplicar
  var d = separar_(p);
  hoja.appendRow([
    p.id,
    fechaCO_(p.creado),
    celda_(p.canal),
    celda_(p.nombre),
    celda_(d.telefono),
    celda_(d.contacto),
    celda_(p.productos),
    typeof p.total === "number" ? p.total : 0,
    celda_(d.direccion),
    celda_(d.nota),
    "nuevo",
  ]);
  if (p.clave) actualizarCliente_(p, d);
  return salida_({ ok: true });
}

function actualizarCliente_(p, d) {
  var hoja = hojaClientes_();
  var fila = buscarFilaTexto_(hoja, 1, String(p.clave));
  var total = typeof p.total === "number" ? p.total : 0;
  if (fila > 0) {
    var v = hoja.getRange(fila, 3, 1, 5).getValues()[0]; // celular, contacto, canal, pedidos, total
    // Si en este pedido no dio celular o contacto, se conserva el que ya teníamos.
    hoja.getRange(fila, 2, 1, 4).setValues([[celda_(p.nombre), celda_(d.telefono || v[0]), celda_(d.contacto || v[1]), celda_(p.canal)]]);
    hoja.getRange(fila, 6, 1, 2).setValues([[Number(v[3]) + 1, Number(v[4]) + total]]);
    hoja.getRange(fila, 9).setValue(fechaCO_(p.creado));
  } else {
    hoja.appendRow([celda_(p.clave), celda_(p.nombre), celda_(d.telefono), celda_(d.contacto), celda_(p.canal), 1, total, fechaCO_(p.creado), fechaCO_(p.creado)]);
  }
}

function borrar_(ids, clave) {
  if (!Array.isArray(ids)) return salida_({ ok: false, error: "ids inválidos" });
  var hoja = hojaPedidos_();
  var borrados = 0;
  for (var i = 0; i < ids.length; i++) {
    var fila = buscarFila_(hoja, 1, ids[i]);
    if (fila > 0) {
      hoja.getRange(fila, 4, 1, 3).setValues([["(borrado)", "(borrado)", "(borrado)"]]); // Nombre, Celular y Contacto
      hoja.getRange(fila, 9, 1, 2).setValues([["(borrado)", "(borrado)"]]); // Dirección y Nota
      borrados++;
    }
  }
  var clientes = 0;
  if (clave) {
    var hc = hojaClientes_();
    var f;
    while ((f = buscarFilaTexto_(hc, 1, String(clave))) > 0) {
      hc.deleteRow(f);
      clientes++;
    }
  }
  return salida_({ ok: true, borrados: borrados, clientes: clientes });
}

// ---------- catálogo ----------
function sinTildes_(t) {
  return String(t).toLowerCase().replace(/á/g, "a").replace(/é/g, "e").replace(/í/g, "i").replace(/ó/g, "o").replace(/ú/g, "u").replace(/\s+/g, " ").trim();
}

function precio_(v) {
  if (typeof v === "number") return isFinite(v) && v === Math.floor(v) ? v : NaN;
  var t = String(v === null || v === undefined ? "" : v).replace(/[$\s.,]/g, ""); // «$ 4.000» → 4000 (en Colombia el punto separa miles)
  return /^\d{1,12}$/.test(t) ? Number(t) : NaN;
}

function codigoDe_(texto) {
  return sinTildes_(texto).replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
}

function activo_(v) {
  var t = sinTildes_(v === null || v === undefined ? "" : v);
  if (t === "" || t === "si" || t === "s" || t === "x" || t === "true" || t === "1") return true;
  return false; // «No», «0», «false» y cualquier otra cosa: oculto (más seguro que mostrar algo por error)
}

function catalogo_() {
  var hoja = hojaProductos_();
  var ultima = hoja.getLastRow();
  var filas = ultima < 2 ? [] : hoja.getRange(2, 1, ultima - 1, 6).getValues();
  var usados = {};
  var mayor = 0;
  for (var i = 0; i < filas.length; i++) {
    var m = /^p(\d+)$/.exec(codigoDe_(filas[i][0]));
    if (m) mayor = Math.max(mayor, Number(m[1]));
  }
  var productos = [];
  var avisos = [];
  var cambios = false;
  var contadas = 0;
  for (var j = 0; j < filas.length; j++) {
    var f = filas[j];
    var vacia = String(f[0]) === "" && String(f[1]) === "" && String(f[2]) === "" && String(f[3]) === "";
    if (vacia) {
      if (String(f[5]) !== "") {
        f[5] = "";
        cambios = true;
      }
      continue;
    }
    contadas++;
    var nombre = String(f[1]).replace(/\s+/g, " ").trim();
    var desc = String(f[3]).replace(/\s+/g, " ").trim();
    var p = precio_(f[2]);
    var cod = codigoDe_(f[0]);
    var estado = "OK";
    if (!nombre) estado = "Falta el nombre";
    else if (nombre.length > MAX_NOMBRE) estado = "Nombre muy largo (máximo " + MAX_NOMBRE + " letras)";
    else if (isNaN(p) || p <= 0 || p > MAX_PRECIO) estado = "Precio inválido (escribe solo el número, por ejemplo 4000)";
    else if (desc.length > MAX_DESCRIPCION) estado = "Descripción muy larga (máximo " + MAX_DESCRIPCION + " letras)";
    if (estado === "OK") {
      if (!cod) {
        mayor++;
        cod = "p" + mayor;
      }
      if (usados[cod]) estado = "Código repetido";
    }
    if (estado === "OK" && !activo_(f[4])) estado = "Oculto (Activo = No)";
    else if (estado === "OK" && productos.length >= MAX_PRODUCTOS) estado = "Sobra: ya hay " + MAX_PRODUCTOS + " productos activos (es el máximo)";
    else if (estado === "OK") {
      usados[cod] = true;
      productos.push({ id: cod, nombre: nombre, precio: p, descripcion: desc });
    }
    if (estado !== "OK" && estado.indexOf("Oculto") !== 0) avisos.push("Fila " + (j + 2) + ": " + estado);
    if (f[0] !== cod && cod && estado.indexOf("Código repetido") !== 0 && nombre) {
      f[0] = cod;
      cambios = true;
    }
    if (f[5] !== estado) {
      f[5] = estado;
      cambios = true;
    }
  }
  if (cambios) {
    for (var k = 0; k < filas.length; k++) {
      hoja.getRange(k + 2, 1).setValue(filas[k][0]);
      hoja.getRange(k + 2, 6).setValue(filas[k][5]);
    }
  }
  return salida_({ ok: true, productos: productos, filas: contadas, avisos: avisos.slice(0, 10) });
}

function sembrar_(productos) {
  if (!Array.isArray(productos) || productos.length > 50) return salida_({ ok: false, error: "productos inválidos" });
  var hoja = hojaProductos_();
  var ultima = hoja.getLastRow();
  if (ultima >= 2) {
    var datos = hoja.getRange(2, 1, ultima - 1, 4).getValues();
    for (var i = 0; i < datos.length; i++) for (var j = 0; j < 4; j++) if (String(datos[i][j]) !== "") return salida_({ ok: true, sembrados: 0, yaTenia: true });
  }
  var n = 0;
  for (var k = 0; k < productos.length; k++) {
    var p = productos[k];
    if (!p || typeof p.precio !== "number") continue;
    hoja.appendRow([celda_(p.id), celda_(p.nombre), p.precio, celda_(p.descripcion), "Sí", ""]);
    n++;
  }
  return salida_({ ok: true, sembrados: n });
}

// ---------- ayudas ----------
function hoja_(nombre, columnas) {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = libro.getSheetByName(nombre);
  if (!hoja) {
    hoja = libro.insertSheet(nombre);
    hoja.appendRow(columnas);
    hoja.setFrozenRows(1);
  }
  return hoja;
}

// ---------- fechas, celular, dirección y nota ----------
function dos_(n) {
  return (n < 10 ? "0" : "") + n;
}

// «2026-11-18T22:39:12.738Z» → «18/11/2026 17:39» (hora de Colombia, UTC-5 todo el año). Lo que no sea una fecha ISO se deja igual.
function fechaCO_(v) {
  var t = new Date(String(v === null || v === undefined ? "" : v));
  if (isNaN(t.getTime())) return celda_(v);
  var c = new Date(t.getTime() - 5 * 3600000);
  return dos_(c.getUTCDate()) + "/" + dos_(c.getUTCMonth() + 1) + "/" + c.getUTCFullYear() + " " + dos_(c.getUTCHours()) + ":" + dos_(c.getUTCMinutes());
}

// El bot guarda el celular junto al contacto («300 123 4567 · @ana») y la dirección junto a la nota («Dirección: X | Nota: Y»).
// Aquí se separan para la hoja.
function desempacar_(contacto, nota) {
  var c = String(contacto === null || contacto === undefined ? "" : contacto);
  var telefono = "";
  var partes = c.split(" · ");
  if (/^(\d{3} \d{3} \d{4}|\+\d{8,15})$/.test(partes[0])) {
    telefono = partes.shift();
    c = partes.join(" · ");
  }
  var n = String(nota === null || nota === undefined ? "" : nota);
  var direccion = "";
  var m = n.match(/^Dirección: ([\s\S]*?)(?: \| Nota: ([\s\S]*))?$/);
  if (m) {
    direccion = m[1];
    n = m[2] === undefined ? "" : m[2];
  } else {
    var k = n.match(/^Nota: ([\s\S]*)$/);
    if (k) n = k[1];
  }
  return { telefono: telefono, contacto: c, direccion: direccion, nota: n };
}

function separar_(p) {
  if (typeof p.telefono === "string" || typeof p.direccion === "string") {
    return {
      telefono: p.telefono || "",
      contacto: typeof p.contactoCanal === "string" ? p.contactoCanal : "",
      direccion: p.direccion || "",
      nota: p.notaLibre || "",
    };
  }
  return desempacar_(p.contacto, p.nota);
}

// ---------- pestañas con su formato (y conversión del formato anterior) ----------
function hojaPedidos_() {
  return hojaConFormato_(HOJA_PEDIDOS, COLS_PEDIDOS, COLS_PEDIDOS_V1, 8, function (f) {
    // formato anterior: Pedido, Fecha, Canal, Nombre, Contacto, Productos, Total, Nota, Estado
    var d = desempacar_(f[4], f[7]);
    var borrado = String(f[3]) === "(borrado)";
    return [f[0], fechaCO_(f[1]), f[2], f[3], borrado ? "(borrado)" : d.telefono, f[4] === "(borrado)" ? "(borrado)" : d.contacto, f[5], f[6], borrado ? "(borrado)" : d.direccion, borrado ? "(borrado)" : d.nota, f[8]];
  });
}

function hojaClientes_() {
  return hojaConFormato_(HOJA_CLIENTES, COLS_CLIENTES, COLS_CLIENTES_V1, 7, function (f) {
    // formato anterior: Clave, Nombre, Contacto, Canal, Pedidos, Total comprado, Primer pedido, Último pedido
    var d = desempacar_(f[2], "");
    return [f[0], f[1], d.telefono, d.contacto, f[3], f[4], f[5], fechaCO_(f[6]), fechaCO_(f[7])];
  });
}

function hojaConFormato_(nombre, columnas, columnasViejas, colTotal, convertir) {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var existia = !!libro.getSheetByName(nombre);
  var hoja = hoja_(nombre, columnas);
  if (existia) migrar_(hoja, columnas, columnasViejas, convertir);
  hoja.getRange(2, colTotal, FILAS_FORMATO, 1).setNumberFormat(FORMATO_PESOS); // Total en pesos: $9.000
  return hoja;
}

// Si la pestaña tiene exactamente las columnas del formato anterior, se reescribe en el nuevo (sin borrar filas).
// Si alguien cambió los encabezados o agregó columnas, no se toca.
function migrar_(hoja, columnas, columnasViejas, convertir) {
  var n = columnasViejas.length;
  if (hoja.getLastColumn() !== n) return;
  var encabezado = hoja.getRange(1, 1, 1, n).getValues()[0];
  for (var i = 0; i < n; i++) if (String(encabezado[i]) !== columnasViejas[i]) return;
  var ultima = hoja.getLastRow();
  var filas = ultima > 1 ? hoja.getRange(2, 1, ultima - 1, n).getValues() : [];
  var nuevas = [];
  for (var j = 0; j < filas.length; j++) {
    // Al leer una celda, Google no devuelve la comilla que la protegía: se vuelve a proteger todo texto antes de escribirlo
    // (si no, un nombre como «=IMPORTXML(...)» se activaría como fórmula).
    nuevas.push(convertir(filas[j]).map(function (x) { return typeof x === "string" ? celda_(x) : x; }));
  }
  // El formato nuevo tiene más columnas: al escribir encima se cubren todas las celdas viejas.
  hoja.getRange(1, 1, 1, columnas.length).setValues([columnas]);
  if (nuevas.length) hoja.getRange(2, 1, nuevas.length, columnas.length).setValues(nuevas);
}

function hojaProductos_() {
  var libro = SpreadsheetApp.getActiveSpreadsheet();
  var existia = !!libro.getSheetByName(HOJA_PRODUCTOS);
  var hoja = hoja_(HOJA_PRODUCTOS, COLS_PRODUCTOS);
  if (!existia) {
    // Lista desplegable Sí / No para que desde el celular solo se toque una opción.
    var regla = SpreadsheetApp.newDataValidation().requireValueInList(["Sí", "No"], true).setAllowInvalid(false).build();
    hoja.getRange(2, 5, FILAS_LISTA, 1).setDataValidation(regla);
  }
  return hoja;
}

function buscarFila_(hoja, col, id) {
  var ultima = hoja.getLastRow();
  if (ultima < 2) return -1;
  var ids = hoja.getRange(2, col, ultima - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (Number(ids[i][0]) === Number(id)) return i + 2;
  return -1;
}

function buscarFilaTexto_(hoja, col, texto) {
  var ultima = hoja.getLastRow();
  if (ultima < 2) return -1;
  var v = hoja.getRange(2, col, ultima - 1, 1).getValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][0]) === texto) return i + 2;
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
