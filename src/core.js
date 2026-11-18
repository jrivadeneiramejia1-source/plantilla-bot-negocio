// Motor de la conversación. No sabe nada de Telegram ni de WhatsApp:
// recibe un mensaje simple y devuelve mensajes simples con opciones.
// Así el mismo negocio funciona en los dos canales.

export const LIMITES = {
  nombre: 60,
  direccion: 150,
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
  SUGERENCIA: "sugerencia",
  NOMBRE: "nombre",
  TELEFONO: "telefono",
  DIRECCION: "direccion",
  NOTA: "nota",
  CONFIRMAR: "confirmar",
};
const PASOS_DE_TEXTO = new Set([PASOS.NOMBRE, PASOS.TELEFONO, PASOS.DIRECCION, PASOS.NOTA, PASOS.CANTIDAD]);
const SIN_CELULAR = new Set(["prefiero no darlo", "no", "no tengo", "no quiero", "omitir", "ninguno", "sin celular", "sin numero", "sin número"]);

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

/**
 * Celular de Colombia: 10 dígitos que empiezan por 3, con o sin 57 / +57 delante. Devuelve "300 123 4567" o null.
 * Con `abierto` también acepta números de otros países (8 a 15 dígitos) y los devuelve como "+dígitos";
 * se usa solo con el número de WhatsApp de la persona (viene con el mensaje, no lo escribe ella).
 */
export function normalizarCelular(texto, abierto = false) {
  let d = String(texto ?? "").replace(/\D/g, "");
  if (d.startsWith("0057")) d = d.slice(2);
  if (d.length === 12 && d.startsWith("57")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("3")) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  if (abierto && d.length >= 8 && d.length <= 15) return `+${d}`;
  return null;
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
  if (n.preguntaNota !== undefined && (typeof n.preguntaNota !== "string" || !n.preguntaNota.trim() || n.preguntaNota.length > 200)) {
    errores.push("preguntaNota debe ser un texto de hasta 200 letras");
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
  if (n.sugerencia !== undefined) {
    if (!n.sugerencia || typeof n.sugerencia.producto !== "string" || !(ps ?? []).some((p) => p.id === n.sugerencia.producto)) {
      errores.push("sugerencia.producto debe ser el id de un producto del negocio");
    }
    const t = n.sugerencia?.texto;
    if (t !== undefined && (typeof t !== "string" || !t.trim() || t.length > 120)) errores.push("sugerencia.texto debe ser un texto de hasta 120 letras");
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
    telefono: "",
    telIntentos: 0,
    direccion: "",
    nota: "",
    sugeridoYa: false,
    opciones: [],
    ventanaInicio: ahora,
    ventanaN: 0,
  };
}

// ---------- mensajes ----------
function mAviso(negocio) {
  return {
    texto:
      `Hola, soy el asistente de ${negocio.nombre}. Para tomar tu pedido guardaré tu nombre, tu celular (si quieres darlo), tu dirección de entrega y tus notas, ` +
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

// Una sola pregunta. En Telegram la persona escribe su celular (el bot no lo conoce); en WhatsApp el número ya llega
// con el mensaje: solo se confirma. En los dos canales se puede elegir no darlo.
function mTelefono(s, repetir = false) {
  const intro = repetir ? "No pude leer ese número. Escríbelo con 10 dígitos, por ejemplo 300 123 4567.\n" : "";
  if (s.canal === "whatsapp") {
    return {
      texto: `${intro}¿Te escribimos a este mismo número si hay algo del pedido?`,
      opciones: [
        { id: "tel:mismo", titulo: "Sí, este número" },
        { id: "tel:otro", titulo: "Otro número" },
        { id: "tel:no", titulo: "Prefiero no darlo" },
      ],
    };
  }
  return {
    texto: `${intro}¿A qué celular te escribimos si hay algo del pedido?\nEscríbelo:`,
    opciones: [{ id: "tel:no", titulo: "Prefiero no darlo" }],
  };
}

function mDireccion(negocio) {
  return { texto: `${negocio.entrega}\n¿A qué dirección lo llevamos? Escribe barrio, calle y algún detalle. Si lo recoges tú, escribe «Recojo».`, opciones: [] };
}

function mNota(negocio) {
  const pregunta = negocio.preguntaNota ?? "¿Algo más que debamos saber de tu pedido?";
  return {
    texto: `${pregunta}\nSi no tienes nada que agregar, toca «Sin nota».`,
    opciones: [{ id: "sinnota", titulo: "Sin nota" }],
  };
}

// Producto que el negocio sugiere antes de pedir los datos. Solo si existe hoy en el catálogo y todavía no está en el pedido.
function sugerido(s, negocio) {
  const id = negocio.sugerencia?.producto;
  const p = id ? producto(negocio, id) : null;
  if (!p || s.sugeridoYa || s.carrito.some((l) => l.id === p.id)) return null;
  return p;
}

function mSugerencia(negocio, p) {
  const texto = negocio.sugerencia.texto || `¿Le agregas ${p.nombre}?`;
  return {
    texto: `${texto} (${pesos(p.precio)})`,
    opciones: [
      { id: "sug:si", titulo: "Sí, agregar" },
      { id: "sug:no", titulo: "No, gracias" },
    ],
  };
}

function mResumen(s, negocio) {
  const { texto, total } = mLineas(s, negocio);
  return {
    texto:
      `Revisa tu pedido:\n${texto}\nTotal: ${pesos(total)}\nA nombre de: ${s.nombre}\n` +
      `Celular: ${s.telefono || "(no lo diste)"}\nDirección: ${s.direccion || "(no la diste)"}\nNota: ${s.nota || "(ninguna)"}`,
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
    case PASOS.SUGERENCIA: {
      const p = negocio.sugerencia ? producto(negocio, negocio.sugerencia.producto) : null;
      return p ? mSugerencia(negocio, p) : mNombre();
    }
    case PASOS.NOMBRE: return mNombre();
    case PASOS.TELEFONO: return mTelefono(s);
    case PASOS.DIRECCION: return mDireccion(negocio);
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
  s.telefono = "";
  s.telIntentos = 0;
  s.direccion = "";
  s.nota = "";
  s.sugeridoYa = false;
}

function textoDueno(canal, pedidoId, p) {
  const etiqueta = canal === "whatsapp" ? "WhatsApp" : "Telegram";
  const lineas = p.lineas.map((l) => `- ${l.cant} × ${l.nombre} (${pesos(l.precio)} c/u)`).join("\n");
  return (
    `Pedido nuevo #${pedidoId} (${etiqueta})\n` +
    `Cliente: ${p.nombre}\nCelular: ${p.telefono || "(no lo dio)"}\nDirección: ${p.direccion || "(no la dio)"}\n` +
    (p.contacto ? `Contacto: ${p.contacto}\n` : "Contacto: (escribirle por el mismo canal)\n") +
    `${lineas}\nTotal: ${pesos(p.total)}\nNota: ${p.nota || "(ninguna)"}`
  );
}

// ---------- motor ----------
/**
 * msg: { canal, usuario, contacto?, texto?, opcion? }
 * ctx: { negocio, store, ahora(), notificarDueno(texto), hoja? }  (hoja: copia a Google Sheets, opcional)
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
    const idsEnHoja = ctx.hoja ? await store.idsCopiadosDe(msg.canal, msg.usuario) : [];
    await store.borrarSesion(clave);
    await store.anonimizarPedidos(msg.canal, msg.usuario);
    if (idsEnHoja.length) {
      // Los datos también están en la hoja del negocio: hay que borrarlos allá. Si falla, queda pendiente.
      try {
        await ctx.hoja.borrar(idsEnHoja, clave);
      } catch (e) {
        console.error("No se pudo borrar en la hoja:", e?.message ?? e);
        await store.pendienteBorrarEnHoja(idsEnHoja, clave);
        try {
          await ctx.notificarDueno("Una persona pidió borrar sus datos y no se pudo borrar en la hoja. Escribe /reintentar para completarlo.");
        } catch {
          /* el pendiente queda guardado de todos modos */
        }
      }
    }
    return { mensajes: [{ texto: "Listo, borré tus datos. Si quieres pedir de nuevo, escribe HOLA." }] };
  }

  const existente = await store.getSesion(clave);
  const s = existente ?? sesionNueva(ahora);
  if (!existente) await store.sumarMetrica(diaBogota(ahora), negocio.id, msg.canal, "inicio");

  s.canal = msg.canal; // para saber qué preguntar (en WhatsApp ya tenemos el número; en Telegram no)
  s.ultimo = ahora; // cuándo escribió por última vez (WhatsApp solo deja contestarle libremente 24 horas después)

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
  else if (s.paso === PASOS.TELEFONO && /^[1-3]$/.test(bajo) && s.opciones[Number(bajo) - 1]) accion = s.opciones[Number(bajo) - 1];
  else if (esTexto) dato = texto;
  else if (/^\d{1,2}$/.test(bajo) && s.opciones[Number(bajo) - 1]) accion = s.opciones[Number(bajo) - 1];
  else {
    accion = "__repetir";
    aviso = "No entendí. Toca una opción o escribe su número.\n\n";
  }

  const out = [];
  const decir = (m) => out.push(m);
  const aDireccion = (prefijo = "") => {
    s.paso = PASOS.DIRECCION;
    const m = mDireccion(negocio);
    decir({ ...m, texto: prefijo + m.texto, quitarTeclado: true }); // quitarTeclado: esconde un teclado de botones que haya quedado de versiones anteriores
  };
  const aNombre = (prefijo = "") => {
    s.paso = PASOS.NOMBRE;
    const m = mNombre();
    decir({ ...m, texto: prefijo + m.texto });
  };

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
        s.telIntentos = 0;
        s.paso = PASOS.TELEFONO;
        decir(mTelefono(s));
      }
    } else if (s.paso === PASOS.TELEFONO) {
      const tel = normalizarCelular(dato);
      if (tel) {
        s.telefono = tel;
        aDireccion();
      } else if (SIN_CELULAR.has(bajo)) {
        s.telefono = "";
        aDireccion();
      } else {
        s.telIntentos += 1;
        if (s.telIntentos >= 2) {
          s.telefono = "";
          aDireccion("No pude leer el número, sigo sin él.\n");
        } else decir(mTelefono(s, true));
      }
    } else if (s.paso === PASOS.DIRECCION) {
      const d = limpiar(dato, LIMITES.direccion);
      if (d.length < 3) decir({ ...mDireccion(negocio), texto: "Necesito la dirección para llevártelo (o escribe «Recojo»).\n" + mDireccion(negocio).texto });
      else {
        s.direccion = d;
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
    else if (sugerido(s, negocio)) {
      const p = sugerido(s, negocio);
      s.sugeridoYa = true; // se ofrece una sola vez por pedido
      s.paso = PASOS.SUGERENCIA;
      decir(mSugerencia(negocio, p));
    } else aNombre();
  } else if (accion === "sug:si" && s.paso === PASOS.SUGERENCIA) {
    const p = negocio.sugerencia ? producto(negocio, negocio.sugerencia.producto) : null;
    if (p) agregar(s, p.id, 1);
    aNombre(p ? `Listo, agregué ${p.nombre}.\n` : "");
  } else if (accion === "sug:no" && s.paso === PASOS.SUGERENCIA) {
    aNombre();
  } else if (accion === "tel:mismo" && s.paso === PASOS.TELEFONO && s.canal === "whatsapp") {
    const tel = normalizarCelular(msg.usuario, true);
    if (tel) {
      s.telefono = tel;
      aDireccion();
    } else decir({ texto: "Escribe el número con 10 dígitos, por ejemplo 300 123 4567.", opciones: [{ id: "tel:no", titulo: "Prefiero no darlo" }] });
  } else if (accion === "tel:otro" && s.paso === PASOS.TELEFONO && s.canal === "whatsapp") {
    decir({ texto: "Escribe el número con 10 dígitos, por ejemplo 300 123 4567.", opciones: [{ id: "tel:no", titulo: "Prefiero no darlo" }] });
  } else if (accion === "tel:no" && s.paso === PASOS.TELEFONO) {
    s.telefono = "";
    aDireccion();
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
      // La base guarda un solo campo de nota y uno de contacto: ahí van juntos la dirección y el celular.
      const pedido = {
        negocio: negocio.id,
        canal: msg.canal,
        usuario: msg.usuario,
        contacto: [s.telefono, msg.contacto].filter(Boolean).join(" · "),
        nombre: s.nombre,
        nota: [s.direccion ? `Dirección: ${s.direccion}` : "", s.nota ? `Nota: ${s.nota}` : ""].filter(Boolean).join(" | "),
        lineas: filas,
        total,
        creado: new Date(ahora).toISOString(),
        // Separados, para la hoja de Google (la base de datos guarda solo los campos de arriba, ya combinados).
        telefono: s.telefono,
        direccion: s.direccion,
        notaLibre: s.nota,
        contactoCanal: msg.contacto ?? "",
      };
      const id = await store.guardarPedido(pedido);
      await store.sumarMetrica(diaBogota(ahora), negocio.id, msg.canal, "pedido");
      let avisoHoja = "";
      if (ctx.hoja) {
        try {
          await ctx.hoja.copiar(id, pedido);
        } catch (e) {
          console.error("No se pudo copiar a la hoja:", e?.message ?? e);
          avisoHoja = "\n(No se pudo copiar a la hoja. Escribe /reintentar.)";
        }
      }
      try {
        await ctx.notificarDueno(textoDueno(msg.canal, id, { ...pedido, telefono: s.telefono, direccion: s.direccion, nota: s.nota, contacto: msg.contacto ?? "" }) + avisoHoja);
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
