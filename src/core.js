// Motor de la conversación. No sabe nada de Telegram ni de WhatsApp:
// recibe un mensaje simple y devuelve mensajes simples con opciones.
// Así el mismo negocio funciona en los dos canales.

export const LIMITES = {
  nombre: 60,
  nota: 300,
  maxCantidad: 99,
  mensajesPorHora: 60,
  lineasMax: 20,
};

const HORA_MS = 3600e3;
const BOGOTA_MS = 5 * HORA_MS; // Colombia es UTC-5 todo el año (sin horario de verano)

const PASOS = {
  CONSENTIMIENTO: "consentimiento",
  MENU: "menu",
  CANTIDAD: "cantidad",
  NOMBRE: "nombre",
  NOTA: "nota",
  CONFIRMAR: "confirmar",
};
const PASOS_DE_TEXTO = new Set([PASOS.NOMBRE, PASOS.NOTA, PASOS.CANTIDAD]);

const ATAJOS_MENU = new Set(["hola", "menu", "menú", "inicio", "buenas", "buenos dias", "buenos días", "buenas tardes", "buenas noches", "/start", "/menu"]);
const ATAJOS_VER = new Set(["pedido", "mi pedido", "/pedido"]);
const ATAJOS_VACIAR = new Set(["cancelar", "/cancelar"]);
const ATAJOS_BORRAR = new Set(["borrar", "/borrar"]);

// ---------- utilidades ----------
export function pesos(n) {
  return "$" + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function limpiar(texto, max) {
  return String(texto ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function diaBogota(ahoraMs) {
  return new Date(ahoraMs - BOGOTA_MS).toISOString().slice(0, 10);
}

export function validarNegocio(n) {
  const errores = [];
  if (!n || typeof n !== "object") return ["negocio vacío"];
  if (!/^[a-z0-9-]+$/.test(n.id ?? "")) errores.push("id inválido (solo minúsculas, números y guiones)");
  for (const campo of ["nombre", "saludo", "entrega", "cierre"]) {
    if (typeof n[campo] !== "string" || !n[campo].trim()) errores.push(`falta ${campo}`);
  }
  const ps = n.productos;
  if (!Array.isArray(ps) || ps.length < 1) errores.push("sin productos");
  else {
    if (ps.length > 9) errores.push("máximo 9 productos (la lista de WhatsApp admite 10 filas y una es «Ver mi pedido»)");
    const ids = new Set();
    for (const p of ps) {
      if (!/^[a-z0-9-]+$/.test(p.id ?? "")) errores.push(`producto con id inválido: ${p.id}`);
      if (ids.has(p.id)) errores.push(`id repetido: ${p.id}`);
      ids.add(p.id);
      if (typeof p.nombre !== "string" || !p.nombre.trim() || p.nombre.length > 24) errores.push(`nombre vacío o de más de 24 letras: ${p.id}`);
      if (!Number.isInteger(p.precio) || p.precio <= 0) errores.push(`precio inválido: ${p.id}`);
    }
  }
  return errores;
}

function sesionNueva(ahora) {
  return {
    paso: PASOS.CONSENTIMIENTO,
    consentimiento: false,
    carrito: [],
    pendiente: null,
    nombre: "",
    nota: "",
    opciones: [],
    ventanaInicio: ahora,
    ventanaN: 0,
  };
}

// ---------- mensajes ----------
function mAviso(negocio) {
  return {
    texto:
      `Hola, soy el asistente de ${negocio.nombre}. Para tomar tu pedido guardaré tu nombre, tus notas de entrega y tu contacto, ` +
      `solo para entregártelo; no los comparto con nadie más. Escribe BORRAR en cualquier momento y los elimino. ¿Aceptas?`,
    opciones: [
      { id: "ok", titulo: "Acepto" },
      { id: "no", titulo: "No acepto" },
    ],
  };
}

function mMenu(s, negocio) {
  const lista = negocio.productos
    .map((p, i) => `${i + 1}. ${p.nombre} — ${pesos(p.precio)}${p.descripcion ? `\n   ${p.descripcion}` : ""}`)
    .join("\n");
  const opciones = negocio.productos.map((p) => ({ id: `p:${p.id}`, titulo: p.nombre, descripcion: pesos(p.precio) }));
  if (s.carrito.length) opciones.push({ id: "ver", titulo: "Ver mi pedido" });
  return { texto: `${negocio.saludo}\n\n${lista}\n\nToca lo que quieras pedir.`, opciones };
}

function mCantidad(s, negocio) {
  const p = producto(negocio, s.pendiente);
  const opciones = [1, 2, 3, 4, 5].map((n) => ({ id: `c:${n}`, titulo: String(n) }));
  opciones.push({ id: "menu", titulo: "Volver al menú" });
  return { texto: `¿Cuántas «${p.nombre}» quieres? (${pesos(p.precio)} c/u)\nToca un número o escribe otro (máximo ${LIMITES.maxCantidad}).`, opciones };
}

function mLineas(s, negocio) {
  const filas = lineasValidas(s, negocio);
  const total = filas.reduce((a, l) => a + l.cant * l.precio, 0);
  const texto = filas.map((l) => `• ${l.cant} × ${l.nombre} — ${pesos(l.cant * l.precio)}`).join("\n");
  return { filas, total, texto };
}

function mVer(s, negocio) {
  const { texto, total } = mLineas(s, negocio);
  return {
    texto: `Tu pedido:\n${texto}\nTotal: ${pesos(total)}`,
    opciones: [
      { id: "fin", titulo: "Confirmar pedido" },
      { id: "mas", titulo: "Agregar otro" },
      { id: "vaciar", titulo: "Vaciar pedido" },
    ],
  };
}

function mNombre() {
  return { texto: "¿A nombre de quién va el pedido?", opciones: [] };
}

function mNota(negocio) {
  return {
    texto: `${negocio.entrega}\nEscribe la dirección de entrega y un teléfono de contacto, o cualquier nota. Si no tienes nada que agregar, toca «Sin nota».`,
    opciones: [{ id: "sinnota", titulo: "Sin nota" }],
  };
}

function mResumen(s, negocio) {
  const { texto, total } = mLineas(s, negocio);
  return {
    texto: `Revisa tu pedido:\n${texto}\nTotal: ${pesos(total)}\nA nombre de: ${s.nombre}\nNota: ${s.nota || "(ninguna)"}`,
    opciones: [
      { id: "enviar", titulo: "Enviar pedido" },
      { id: "cancelar", titulo: "Cancelar" },
    ],
  };
}

function pregunta(s, negocio) {
  switch (s.paso) {
    case PASOS.CONSENTIMIENTO: return mAviso(negocio);
    case PASOS.CANTIDAD: return producto(negocio, s.pendiente) ? mCantidad(s, negocio) : mMenu(s, negocio);
    case PASOS.NOMBRE: return mNombre();
    case PASOS.NOTA: return mNota(negocio);
    case PASOS.CONFIRMAR: return s.carrito.length ? mResumen(s, negocio) : mMenu(s, negocio);
    default: return mMenu(s, negocio);
  }
}

// ---------- ayudas del carrito ----------
function producto(negocio, id) {
  return negocio.productos.find((p) => p.id === id);
}

// Los precios se toman SIEMPRE del catálogo actual, no de lo que haya guardado la sesión.
function lineasValidas(s, negocio) {
  const filas = [];
  for (const l of s.carrito) {
    const p = producto(negocio, l.id);
    if (p) filas.push({ id: p.id, nombre: p.nombre, cant: l.cant, precio: p.precio });
  }
  return filas;
}

function agregar(s, id, cant) {
  const ya = s.carrito.find((l) => l.id === id);
  if (ya) ya.cant = Math.min(LIMITES.maxCantidad, ya.cant + cant);
  else if (s.carrito.length < LIMITES.lineasMax) s.carrito.push({ id, cant });
  else return false;
  return true;
}

function reiniciarPedido(s) {
  s.carrito = [];
  s.pendiente = null;
  s.nombre = "";
  s.nota = "";
}

function textoDueno(canal, pedidoId, p) {
  const etiqueta = canal === "whatsapp" ? "WhatsApp" : "Telegram";
  const lineas = p.lineas.map((l) => `- ${l.cant} × ${l.nombre} (${pesos(l.precio)} c/u)`).join("\n");
  return (
    `Pedido nuevo #${pedidoId} (${etiqueta})\n` +
    `Cliente: ${p.nombre}\nContacto: ${p.contacto || "(sin contacto: escribirle por el mismo canal)"}\n` +
    `${lineas}\nTotal: ${pesos(p.total)}\nNota: ${p.nota || "(ninguna)"}`
  );
}

// ---------- motor ----------
/**
 * msg: { canal, usuario, contacto?, texto?, opcion? }
 * ctx: { negocio, store, ahora(), notificarDueno(texto) }
 * devuelve: { mensajes: [{ texto, opciones?: [{ id, titulo, descripcion? }] }] }
 */
export async function manejar(msg, ctx) {
  const { negocio, store } = ctx;
  const ahora = ctx.ahora();
  const clave = `${msg.canal}:${msg.usuario}`;

  const texto = limpiar(msg.texto ?? "", 500);
  const bajo = texto.toLowerCase();

  // Derecho a borrar los datos: siempre funciona.
  if (ATAJOS_BORRAR.has(bajo)) {
    await store.borrarSesion(clave);
    await store.anonimizarPedidos(msg.canal, msg.usuario);
    return { mensajes: [{ texto: "Listo, borré tus datos. Si quieres pedir de nuevo, escribe HOLA." }] };
  }

  const existente = await store.getSesion(clave);
  const s = existente ?? sesionNueva(ahora);
  if (!existente) await store.sumarMetrica(diaBogota(ahora), negocio.id, msg.canal, "inicio");

  // Tope de mensajes por hora (cada respuesta de WhatsApp puede costar plata al negocio).
  if (ahora - s.ventanaInicio > HORA_MS) {
    s.ventanaInicio = ahora;
    s.ventanaN = 0;
  }
  s.ventanaN += 1;
  if (s.ventanaN > LIMITES.mensajesPorHora) {
    await store.putSesion(clave, s, ahora);
    const primera = s.ventanaN === LIMITES.mensajesPorHora + 1;
    return { mensajes: primera ? [{ texto: "Has escrito muchos mensajes seguidos. Intenta de nuevo en un rato." }] : [] };
  }

  const esTexto = PASOS_DE_TEXTO.has(s.paso);
  let accion = null;
  let dato = null;
  let aviso = "";

  if (msg.opcion) {
    // Solo se aceptan botones del último mensaje (evita botones viejos o inventados).
    if (s.opciones.includes(msg.opcion)) accion = msg.opcion;
    else accion = "__repetir";
  } else if (ATAJOS_MENU.has(bajo)) accion = "menu";
  else if (ATAJOS_VER.has(bajo)) accion = "ver";
  else if (ATAJOS_VACIAR.has(bajo) && !(s.paso === PASOS.NOTA || s.paso === PASOS.NOMBRE)) accion = "vaciar";
  else if (bajo === "/cancelar") accion = "vaciar";
  else if (esTexto) dato = texto;
  else if (/^\d{1,2}$/.test(bajo) && s.opciones[Number(bajo) - 1]) accion = s.opciones[Number(bajo) - 1];
  else {
    accion = "__repetir";
    aviso = "No entendí. Toca una opción o escribe su número.\n\n";
  }

  const out = [];
  const decir = (m) => out.push(m);

  if (!s.consentimiento) {
    if (accion === "ok") {
      s.consentimiento = true;
      s.paso = PASOS.MENU;
      decir(mMenu(s, negocio));
    } else if (accion === "no") {
      await store.borrarSesion(clave);
      return { mensajes: [{ texto: "Sin problema, no guardé nada. Si cambias de opinión, escribe HOLA." }] };
    } else {
      s.paso = PASOS.CONSENTIMIENTO;
      decir(mAviso(negocio));
    }
  } else if (dato !== null) {
    if (s.paso === PASOS.CANTIDAD) {
      const n = /^\d{1,2}$/.test(dato) ? Number(dato) : 0;
      if (n < 1 || n > LIMITES.maxCantidad) decir({ ...mCantidad(s, negocio), texto: `Escribe un número del 1 al ${LIMITES.maxCantidad}.` });
      else {
        const p = producto(negocio, s.pendiente);
        agregar(s, p.id, n);
        s.pendiente = null;
        s.paso = PASOS.MENU;
        decir(otroMas(s, negocio));
      }
    } else if (s.paso === PASOS.NOMBRE) {
      const nombre = limpiar(dato, LIMITES.nombre);
      if (!nombre) decir(mNombre());
      else {
        s.nombre = nombre;
        s.paso = PASOS.NOTA;
        decir(mNota(negocio));
      }
    } else {
      s.nota = limpiar(dato, LIMITES.nota);
      s.paso = PASOS.CONFIRMAR;
      decir(mResumen(s, negocio));
    }
  } else if (accion === "menu" || accion === "mas") {
    s.paso = PASOS.MENU;
    s.pendiente = null;
    decir(mMenu(s, negocio));
  } else if (accion === "ver") {
    s.paso = PASOS.MENU;
    if (!lineasValidas(s, negocio).length) {
      decir({ ...mMenu(s, negocio), texto: "Tu pedido está vacío.\n\n" + mMenu(s, negocio).texto });
    } else decir(mVer(s, negocio));
  } else if (accion === "vaciar" || accion === "cancelar") {
    reiniciarPedido(s);
    s.paso = PASOS.MENU;
    decir({ ...mMenu(s, negocio), texto: "Pedido cancelado.\n\n" + mMenu(s, negocio).texto });
  } else if (accion?.startsWith("p:") && s.paso === PASOS.MENU) {
    const p = producto(negocio, accion.slice(2));
    if (!p) decir(mMenu(s, negocio));
    else {
      s.pendiente = p.id;
      s.paso = PASOS.CANTIDAD;
      decir(mCantidad(s, negocio));
    }
  } else if (accion?.startsWith("c:") && s.paso === PASOS.CANTIDAD) {
    const n = Number(accion.slice(2));
    const p = producto(negocio, s.pendiente);
    if (p && Number.isInteger(n) && n >= 1 && n <= 5) {
      agregar(s, p.id, n);
      s.pendiente = null;
      s.paso = PASOS.MENU;
      decir(otroMas(s, negocio));
    } else decir(pregunta(s, negocio));
  } else if (accion === "fin" && s.paso === PASOS.MENU) {
    if (!lineasValidas(s, negocio).length) decir({ ...mMenu(s, negocio), texto: "Tu pedido está vacío.\n\n" + mMenu(s, negocio).texto });
    else {
      s.paso = PASOS.NOMBRE;
      decir(mNombre());
    }
  } else if (accion === "sinnota" && s.paso === PASOS.NOTA) {
    s.nota = "";
    s.paso = PASOS.CONFIRMAR;
    decir(mResumen(s, negocio));
  } else if (accion === "enviar" && s.paso === PASOS.CONFIRMAR) {
    const { filas, total } = mLineas(s, negocio);
    if (!filas.length) {
      s.paso = PASOS.MENU;
      decir(mMenu(s, negocio));
    } else {
      const pedido = {
        negocio: negocio.id,
        canal: msg.canal,
        usuario: msg.usuario,
        contacto: msg.contacto ?? "",
        nombre: s.nombre,
        nota: s.nota,
        lineas: filas,
        total,
        creado: new Date(ahora).toISOString(),
      };
      const id = await store.guardarPedido(pedido);
      await store.sumarMetrica(diaBogota(ahora), negocio.id, msg.canal, "pedido");
      try {
        await ctx.notificarDueno(textoDueno(msg.canal, id, pedido));
      } catch (e) {
        console.error("No se pudo avisar a la dueña:", e?.message ?? e);
      }
      reiniciarPedido(s);
      s.paso = PASOS.MENU;
      decir({
        texto: `¡Pedido #${id} recibido! ${negocio.cierre}`,
        opciones: [{ id: "menu", titulo: "Hacer otro pedido" }],
      });
    }
  } else {
    const p = pregunta(s, negocio);
    decir(aviso ? { ...p, texto: aviso + p.texto } : p);
  }

  const ultimo = out[out.length - 1];
  s.opciones = (ultimo?.opciones ?? []).map((o) => o.id);
  await store.putSesion(clave, s, ahora);
  return { mensajes: out };
}

function otroMas(s, negocio) {
  const { filas, total } = mLineas(s, negocio);
  const ultima = filas[filas.length - 1];
  return {
    texto: `Listo. Llevas ${filas.length} producto${filas.length === 1 ? "" : "s"} por ${pesos(total)}${ultima ? ` (último: ${ultima.nombre})` : ""}. ¿Algo más?`,
    opciones: [
      { id: "mas", titulo: "Agregar otro" },
      { id: "ver", titulo: "Ver mi pedido" },
      { id: "fin", titulo: "Confirmar pedido" },
    ],
  };
}

// Para la dueña: pedidos de hoy y comparación de canales.
export async function resumenDelDia(store, negocio, ahora) {
  const dia = diaBogota(ahora);
  const pedidos = await store.pedidosDesde(negocio.id, `${dia}T05:00:00.000Z`);
  const metricas = await store.metricasDia(dia, negocio.id);
  const n = (canal, evento) => metricas.find((m) => m.canal === canal && m.evento === evento)?.n ?? 0;
  const total = pedidos.reduce((a, p) => a + p.total, 0);
  const linea = (canal, etiqueta) => {
    const i = n(canal, "inicio");
    const p = n(canal, "pedido");
    return `${etiqueta}: ${i} conversaciones, ${p} pedidos${i ? ` (${Math.round((p / i) * 100)}%)` : ""}`;
  };
  const ultimos = pedidos
    .slice(-5)
    .map((p) => `#${p.id} ${p.nombre} — ${pesos(p.total)} (${p.canal === "whatsapp" ? "WhatsApp" : "Telegram"})`)
    .join("\n");
  return (
    `Resumen de hoy (${dia}) — ${negocio.nombre}\n` +
    `${pedidos.length} pedidos, ${pesos(total)} en total\n\n` +
    `${linea("telegram", "Telegram")}\n${linea("whatsapp", "WhatsApp")}\n` +
    (ultimos ? `\nÚltimos pedidos:\n${ultimos}` : "\nTodavía no hay pedidos hoy.")
  );
}
