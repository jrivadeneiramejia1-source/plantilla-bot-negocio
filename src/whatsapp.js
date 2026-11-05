import { manejar } from "./core.js";
import { avisarDuenoPorTelegram } from "./telegram.js";
import { hmacSha256Hex, igualesSeguro } from "./seguridad.js";

const corto = (t, max) => (t.length > max ? t.slice(0, max - 1) + "…" : t);

// WhatsApp admite: 3 botones, o una lista de hasta 10 filas, o texto simple.
export function armarMensajeWhatsApp(para, texto, opciones = []) {
  const base = { messaging_product: "whatsapp", to: para };
  if (!opciones.length || opciones.length > 10) {
    const numeradas = opciones.length ? "\n\n" + opciones.map((o, i) => `${i + 1}. ${o.titulo}`).join("\n") + "\n(escribe el número)" : "";
    return [{ ...base, type: "text", text: { body: corto(texto + numeradas, 4000) } }];
  }
  const previos = [];
  let cuerpo = texto;
  if (texto.length > 1000) {
    previos.push({ ...base, type: "text", text: { body: corto(texto, 4000) } });
    cuerpo = "Elige una opción:";
  }
  if (opciones.length <= 3) {
    return [
      ...previos,
      {
        ...base,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: cuerpo },
          action: { buttons: opciones.map((o) => ({ type: "reply", reply: { id: o.id, title: corto(o.titulo, 20) } })) },
        },
      },
    ];
  }
  return [
    ...previos,
    {
      ...base,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: cuerpo },
        action: {
          button: "Ver opciones",
          sections: [
            {
              title: "Opciones",
              rows: opciones.map((o) => ({
                id: o.id,
                title: corto(o.titulo, 24),
                ...(o.descripcion ? { description: corto(o.descripcion, 72) } : {}),
              })),
            },
          ],
        },
      },
    },
  ];
}

async function enviarWhatsApp(env, fetchFn, cuerpo) {
  const version = env.WA_API_VERSION || "v21.0";
  const r = await fetchFn(`https://graph.facebook.com/${version}/${env.WA_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.WA_TOKEN}` },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) throw new Error(`WhatsApp respondió ${r.status}`);
}

/** deps: { store, negocio, ahora(), fetch, esperar(promesa) } */
export async function whatsappWebhook(request, env, deps) {
  if (request.method === "GET") {
    // Verificación que hace Meta una sola vez al registrar la dirección.
    const q = new URL(request.url).searchParams;
    if (
      env.WA_VERIFY_TOKEN &&
      q.get("hub.mode") === "subscribe" &&
      igualesSeguro(q.get("hub.verify_token"), env.WA_VERIFY_TOKEN)
    ) {
      return new Response(q.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("Prohibido", { status: 403 });
  }
  if (request.method !== "POST") return new Response("No permitido", { status: 405 });

  // La firma se calcula sobre los bytes EXACTOS que llegaron (sin volver a escribir el JSON).
  const crudo = await request.arrayBuffer();
  const firma = request.headers.get("X-Hub-Signature-256") ?? "";
  const esperada = env.WA_APP_SECRET ? "sha256=" + (await hmacSha256Hex(env.WA_APP_SECRET, crudo)) : null;
  if (!esperada || !igualesSeguro(firma, esperada)) return new Response("Firma inválida", { status: 401 });

  let cuerpo;
  try {
    cuerpo = JSON.parse(new TextDecoder().decode(crudo));
  } catch {
    return new Response("ok");
  }

  const trabajo = procesar(cuerpo, env, deps).catch((e) => console.error("Error en WhatsApp:", e?.message ?? e));
  if (deps.esperar) deps.esperar(trabajo); // responder 200 rápido y seguir trabajando
  else await trabajo;
  return new Response("ok");
}

async function procesar(cuerpo, env, deps) {
  for (const entrada of cuerpo.entry ?? []) {
    for (const cambio of entrada.changes ?? []) {
      for (const m of cambio.value?.messages ?? []) {
        if (!m.id || !m.from) continue;
        if (!(await deps.store.marcarVisto(`wa:${m.id}`, deps.ahora()))) continue; // Meta reintenta: no atender dos veces

        let texto;
        let opcion;
        if (m.type === "text") texto = m.text?.body ?? "";
        else if (m.type === "interactive") opcion = m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id;
        else {
          await enviar(env, deps, m.from, "Por ahora solo entiendo texto y botones.");
          continue;
        }

        const { mensajes } = await manejar(
          { canal: "whatsapp", usuario: m.from, contacto: `https://wa.me/${m.from}`, texto, opcion },
          {
            negocio: deps.negocio,
            store: deps.store,
            ahora: deps.ahora,
            notificarDueno: avisarDuenoPorTelegram(env, deps.fetch),
          },
        );
        for (const x of mensajes) await enviar(env, deps, m.from, x.texto, x.opciones);
      }
    }
  }
}

async function enviar(env, deps, para, texto, opciones) {
  for (const cuerpo of armarMensajeWhatsApp(para, texto, opciones)) await enviarWhatsApp(env, deps.fetch, cuerpo);
}
