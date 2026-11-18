// Comandos de las socias (solo por Telegram: en privado o en el grupo de alertas, y solo desde los números de OWNER_TELEGRAM_ID).
import { diaBogota, limpiar, pesos, resumenDelDia } from "./core.js";
import { enviarTelegram, enviarWhatsApp } from "./envio.js";
import { crearHoja } from "./sheets.js";
import { refrescarCatalogo } from "./catalogo.js";

const VENTANA_WHATSAPP_MS = 24 * 3600e3; // WhatsApp solo deja escribir mensajes libres 24 horas después del último mensaje del cliente

const AYUDA =
  "Comandos de las socias (con o sin tildes, en mayúsculas o minúsculas):\n" +
  "/resumen — pedidos de hoy y qué canal vende más\n" +
  "/pedidos — los pedidos de hoy con su número\n" +
  "/productos — qué productos y precios muestra el bot ahora\n" +
  "/avisar 12 texto — le escribo al cliente del pedido 12 (el mensaje lleva su pedido)\n" +
  "/demora 12 30 — le aviso que su pedido 12 demora 30 minutos (también «1 hora»)\n" +
  "/listo 12 — le aviso que su pedido 12 está listo\n" +
  "/catalogo — reviso la hoja de productos (si está vacía, la lleno con ejemplos)\n" +
  "/reintentar — copio a la hoja lo que no se pudo copiar\n" +
  "/id — te digo tu número de Telegram y el del chat (sirve para cualquiera)";

// Otras formas de pedir lo mismo. Todo se compara sin tildes ni mayúsculas.
const SINONIMOS = {
  ayuda: ["ayuda", "help", "comandos", "ayudame"],
  resumen: ["resumen", "hoy", "ventas", "reporte"],
  pedidos: ["pedidos", "ordenes"],
  productos: ["productos", "producto", "precios", "cuales", "menu del bot"],
  catalogo: ["catalogo", "actualizar", "refrescar"],
  reintentar: ["reintentar", "reenviar"],
  avisar: ["avisar", "avisa", "mensaje", "escribir", "escribele"],
  demora: ["demora", "demorar", "retraso", "retrasar"],
  listo: ["listo", "lista", "terminado"],
};
const COMANDO_DE = new Map(Object.entries(SINONIMOS).flatMap(([cmd, alias]) => alias.map((a) => [a, cmd])));
// Estos los entiende el motor de clientes (una socia puede probar el bot como cliente): no se tocan.
const COMANDOS_DE_CLIENTE = new Set(["start", "menu", "pedido", "cancelar", "borrar", "hola", "inicio"]);
// Sin la barra «/», una socia puede escribir estas palabras solas (en chat privado).
const PALABRAS_SOLAS = new Set(["ayuda", "resumen", "pedidos", "productos", "precios", "catalogo", "reintentar", "comandos"]);

const sinTildes = (t) => String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function distancia(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** «¿Quisiste decir…?»: el comando conocido más parecido (a 2 letras o menos). Solo sugiere, nunca ejecuta. */
function parecido(palabra) {
  let mejor = null;
  for (const [alias, cmd] of COMANDO_DE) {
    if (alias.length < 4 || alias.includes(" ")) continue;
    const d = distancia(palabra, alias);
    if (d <= 2 && (!mejor || d < mejor.d)) mejor = { d, cmd };
  }
  return mejor?.cmd ?? null;
}

// «2 × Rosa de foami, 1 × Girasol de foami — Total $16.000». Con más de 5 productos, los demás se cuentan.
function detallePedido(p) {
  const lineas = Array.isArray(p.lineas) ? p.lineas : [];
  const vistas = lineas.slice(0, 5).map((l) => `${l.cant} × ${l.nombre}`);
  if (lineas.length > 5) vistas.push(`y ${lineas.length - 5} más`);
  return `${vistas.join(", ")} — Total ${pesos(p.total)}`;
}

/** `hacer(detalle)` arma el texto que se le manda al cliente; así cada aviso dice qué pidió y cuál es su número. */
async function avisarCliente(env, deps, negocio, id, hacer) {
  const p = await deps.store.getPedido(id);
  if (!p || p.negocio !== negocio.id) return `No encuentro el pedido #${id}.`;
  if (p.usuario === "(borrado)") return "Esa persona pidió borrar sus datos: ya no se le puede escribir.";
  // El cliente lo lee como un mensaje directo del negocio: saludo con su primer nombre y el texto, sin etiquetas.
  const primerNombre = String(p.nombre ?? "").trim().split(/\s+/)[0].slice(0, 30);
  const texto = hacer(detallePedido(p));
  const mensaje = `${primerNombre ? `Hola ${primerNombre},` : "Hola,"}\n${texto}`;
  try {
    if (p.canal === "telegram") {
      await enviarTelegram(env, deps.fetch, p.usuario, mensaje);
    } else {
      const s = await deps.store.getSesion(`whatsapp:${p.usuario}`);
      if (!s?.ultimo || deps.ahora() - s.ultimo > VENTANA_WHATSAPP_MS) {
        return (
          `Pasaron más de 24 horas desde que ${p.nombre} te escribió, y WhatsApp no deja mandarle mensajes libres desde el bot. ` +
          `Escríbele tú directamente: ${p.contacto}`
        );
      }
      await enviarWhatsApp(env, deps.fetch, { messaging_product: "whatsapp", to: p.usuario, type: "text", text: { body: mensaje.slice(0, 4000) } });
    }
  } catch (e) {
    console.error("No se pudo avisar al cliente:", e?.message ?? e);
    return `No se pudo enviar el mensaje a ${p.nombre}. Puede que la persona haya bloqueado el bot o que ${p.canal === "whatsapp" ? "WhatsApp" : "Telegram"} no responda. Contacto: ${p.contacto}`;
  }
  return `Enviado a ${p.nombre} (pedido #${id}): «${texto}»`;
}

async function comandoCatalogo(env, deps) {
  const hoja = crearHoja(env, deps.fetch, deps.store);
  if (!hoja) return "Para editar los productos desde el celular hace falta conectar la hoja de Google (README, sección «Copia a Google Sheets»).";
  try {
    const r = await refrescarCatalogo(deps.negocio, hoja, deps.store, deps.ahora);
    if (r.sembrados) {
      return (
        `Copié ${r.sembrados} productos de ejemplo a la pestaña «Productos» de tu hoja. Ábrela en el celular, cambia nombres y precios, ` +
        `y el bot los usa en unos 2 minutos. Con la columna «Activo» (Sí/No) escondes un producto sin borrarlo.`
      );
    }
    const lineas = [`Catálogo: ${r.productos.length} productos activos (de ${r.filas} filas con datos). Ya está aplicado en el bot.`];
    if (!r.productos.length) lineas.push("Ojo: no hay ningún producto válido. El bot sigue usando el último catálogo bueno.");
    if (r.avisos.length) lineas.push("Para arreglar en la hoja (mira también la columna «Estado»):", ...r.avisos.slice(0, 6).map((a) => `• ${a}`));
    return lineas.join("\n");
  } catch (e) {
    console.error("/catalogo falló:", e?.message ?? e);
    return "No pude leer la hoja. Revisa que el Apps Script esté publicado como aplicación web y que SHEETS_URL y SHEETS_TOKEN estén bien. Prueba con /reintentar o mira el README.";
  }
}

function hora(creado) {
  const t = new Date(new Date(creado).getTime() - 5 * 3600e3); // Colombia es UTC-5
  return `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
}

async function comandoPedidos(deps, negocio) {
  const dia = diaBogota(deps.ahora());
  const pedidos = await deps.store.pedidosDesde(negocio.id, `${dia}T05:00:00.000Z`);
  if (!pedidos.length) return `Hoy (${dia}) todavía no hay pedidos.`;
  const filas = pedidos
    .slice(-15)
    .map((p) => `#${p.id} ${p.nombre} — ${pesos(p.total)} — ${p.canal === "whatsapp" ? "WhatsApp" : "Telegram"} — ${hora(p.creado)}`)
    .join("\n");
  return `Pedidos de hoy (${dia}), ${pedidos.length} en total${pedidos.length > 15 ? " (los últimos 15)" : ""}:\n${filas}\n\nPara avisarle a un cliente usa el número: /demora 12 30, /listo 12 o /avisar 12 texto.`;
}

async function comandoProductos(deps) {
  const negocio = deps.negocioVigente ? await deps.negocioVigente() : deps.negocio;
  const filas = negocio.productos.map((p, i) => `${i + 1}. ${p.nombre} — ${pesos(p.precio)}${p.descripcion ? ` (${p.descripcion})` : ""}`).join("\n");
  return `Esto es lo que el bot muestra ahora (${negocio.productos.length} productos):\n${filas}\n\nPara cambiar precios o esconder uno, edita la hoja «Productos» (columna Activo: Sí/No). El bot lo ve en unos 2 minutos.`;
}

// «30», «30 min», «30 minutos», «1 hora», «2 h»: devuelve los minutos (1 a 600) o 0 si no se entiende.
function minutosDe(num, unidad) {
  const n = Number(num);
  const u = sinTildes(unidad);
  const min = /^(h|hr|hrs|hora|horas)$/.test(u) ? n * 60 : n;
  return Number.isInteger(min) && min >= 1 && min <= 600 ? min : 0;
}

/**
 * Devuelve el texto a contestarle a la dueña, o null si el mensaje no es un comando suyo
 * (entonces el motor lo trata como a un cliente más). Entiende tildes, mayúsculas, sinónimos, «#12» y, en chat privado,
 * algunas palabras sin la barra (no en el grupo: ahí solo con «/», para no responder a la conversación normal). Una orden desconocida con «/» recibe una respuesta con ayuda, en vez del menú de clientes.
 */
export async function comandoDueno(texto, env, deps, { soloConBarra = false } = {}) {
  const crudo = String(texto ?? "").trim();
  let m = crudo.match(/^\/([^\s@]+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  if (!m) {
    const sola = sinTildes(crudo).replace(/[^a-z0-9 ]/g, "").trim();
    if (soloConBarra || !PALABRAS_SOLAS.has(sola)) return null; // conversación normal
    m = [crudo, sola, ""];
  }
  const palabra = sinTildes(m[1]);
  if (COMANDOS_DE_CLIENTE.has(palabra)) return null;
  const args = (m[2] ?? "").trim();
  const negocio = deps.negocio; // el nombre del negocio no cambia con el catálogo
  const cmd = COMANDO_DE.get(palabra);

  switch (cmd) {
    case "ayuda":
      return AYUDA;
    case "resumen":
      return resumenDelDia(deps.store, negocio, deps.ahora());
    case "pedidos":
      return comandoPedidos(deps, negocio);
    case "productos":
      return comandoProductos(deps);
    case "reintentar": {
      const hoja = crearHoja(env, deps.fetch, deps.store);
      if (!hoja) return "La hoja no está configurada.";
      const r = await hoja.reintentar();
      return `Listo: ${r.copiados} copiados a la hoja, ${r.borrados} borrados allá, ${r.fallaron} con error.`;
    }
    case "catalogo":
      return comandoCatalogo(env, deps);
    case "avisar": {
      const a = args.match(/^#?(\d{1,9})\s+([\s\S]+)$/);
      const msg = a ? limpiar(a[2], 500) : "";
      if (!a || !msg) return "Escríbelo así: /avisar 12 Tu pedido ya salió para tu casa";
      return avisarCliente(env, deps, negocio, a[1], (detalle) => `${msg}\nTu pedido #${a[1]}: ${detalle}`);
    }
    case "demora": {
      const a = args.match(/^#?(\d{1,9})\s+(\d{1,3})\s*([a-zA-Zá-ú]*)\.?$/);
      const min = a ? minutosDe(a[2], a[3]) : 0;
      if (!a || !min || (a[3] && !/^(m|min|mins|minuto|minutos|h|hr|hrs|hora|horas)$/.test(sinTildes(a[3])))) {
        return "Escríbelo así: /demora 12 30 (el pedido 12 demora 30 minutos; también «/demora 12 1 hora»; entre 1 minuto y 10 horas)";
      }
      const horas = min >= 60 && min % 60 === 0 ? min / 60 : 0;
      const tiempo = horas ? `aproximadamente ${horas} hora${horas === 1 ? "" : "s"}` : `unos ${min} minutos`;
      return avisarCliente(env, deps, negocio, a[1], (detalle) => `Tu pedido #${a[1]} (${detalle}) va a demorar ${tiempo}. ¡Gracias por tu paciencia!`);
    }
    case "listo": {
      const a = args.match(/^#?(\d{1,9})$/);
      if (!a) return "Escríbelo así: /listo 12";
      return avisarCliente(env, deps, negocio, a[1], (detalle) => `Tu pedido #${a[1]} (${detalle}) está listo. ¡Gracias por tu compra!`);
    }
    default: {
      // Una orden con «/» que no conocemos: se explica, en vez de tratarla como a un cliente.
      const sugerido = parecido(palabra);
      return `No conozco «/${m[1].slice(0, 30)}».${sugerido ? ` ¿Quisiste decir /${sugerido}?` : ""}\n\n${AYUDA}`;
    }
  }
}
