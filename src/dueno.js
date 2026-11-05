// Comandos de la dueña (solo por Telegram, solo desde el número en OWNER_TELEGRAM_ID).
import { limpiar, resumenDelDia } from "./core.js";
import { enviarTelegram, enviarWhatsApp } from "./envio.js";
import { crearHoja } from "./sheets.js";
import { refrescarCatalogo } from "./catalogo.js";

const VENTANA_WHATSAPP_MS = 24 * 3600e3; // WhatsApp solo deja escribir mensajes libres 24 horas después del último mensaje del cliente

const AYUDA =
  "Comandos de la dueña:\n" +
  "/resumen — pedidos de hoy y qué canal vende más\n" +
  "/avisar 12 texto — le escribo al cliente del pedido 12\n" +
  "/demora 12 30 — le aviso que su pedido 12 demora 30 minutos\n" +
  "/listo 12 — le aviso que su pedido 12 está listo\n" +
  "/catalogo — reviso la hoja de productos (si está vacía, la lleno con ejemplos)\n" +
  "/reintentar — copio a la hoja lo que no se pudo copiar";

async function avisarCliente(env, deps, negocio, id, texto) {
  const p = await deps.store.getPedido(id);
  if (!p || p.negocio !== negocio.id) return `No encuentro el pedido #${id}.`;
  if (p.usuario === "(borrado)") return "Esa persona pidió borrar sus datos: ya no se le puede escribir.";
  const mensaje = `${negocio.nombre}: ${texto}`;
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

/** Devuelve el texto a contestarle a la dueña, o null si el mensaje no es un comando suyo. */
export async function comandoDueno(texto, env, deps) {
  const m = String(texto ?? "").trim().match(/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  const args = (m[2] ?? "").trim();
  const negocio = deps.negocio; // el nombre del negocio no cambia con el catálogo

  switch (cmd) {
    case "ayuda":
      return AYUDA;
    case "resumen":
      return resumenDelDia(deps.store, negocio, deps.ahora());
    case "reintentar": {
      const hoja = crearHoja(env, deps.fetch, deps.store);
      if (!hoja) return "La hoja no está configurada.";
      const r = await hoja.reintentar();
      return `Listo: ${r.copiados} copiados a la hoja, ${r.borrados} borrados allá, ${r.fallaron} con error.`;
    }
    case "catalogo":
      return comandoCatalogo(env, deps);
    case "avisar": {
      const a = args.match(/^(\d{1,9})\s+([\s\S]+)$/);
      const msg = a ? limpiar(a[2], 500) : "";
      if (!a || !msg) return "Escríbelo así: /avisar 12 Tu pedido ya salió para tu casa";
      return avisarCliente(env, deps, negocio, a[1], msg);
    }
    case "demora": {
      const a = args.match(/^(\d{1,9})\s+(\d{1,3})$/);
      const min = a ? Number(a[2]) : 0;
      if (!a || min < 1 || min > 600) return "Escríbelo así: /demora 12 30 (el pedido 12 demora 30 minutos; entre 1 y 600)";
      return avisarCliente(env, deps, negocio, a[1], `Tu pedido #${a[1]} va a demorar unos ${min} minutos. ¡Gracias por tu paciencia!`);
    }
    case "listo": {
      const a = args.match(/^(\d{1,9})$/);
      if (!a) return "Escríbelo así: /listo 12";
      return avisarCliente(env, deps, negocio, a[1], `Tu pedido #${a[1]} está listo. ¡Gracias por tu compra!`);
    }
    default:
      return null; // /start, /menu y demás: se tratan como un cliente más
  }
}
