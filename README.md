# plantilla-bot-negocio

Bot de pedidos para negocios pequeños. Atiende por **Telegram** y por **WhatsApp** con el mismo cerebro:
el cliente ve el menú, elige productos con botones, deja su nombre y su nota de entrega, y la dueña recibe el pedido por Telegram.
Corre gratis en Cloudflare Workers con una base D1. Los negocios de ejemplo son **inventados** (flores de foami, fresas con crema, gorras).

## Qué hace
- Aviso de privacidad al primer mensaje (Ley 1581): el cliente debe aceptar. Escribir **BORRAR** elimina sus datos.
- Menú con botones (también acepta escribir el número de la opción).
- Pedido con cantidades, resumen, nombre y nota de entrega. Los precios se toman siempre del catálogo, no de lo que mande el cliente.
- **Hoja de Google del cliente** (sin archivo de claves; ver más abajo): pedidos, lista de clientes y productos que la dueña edita desde el celular. BORRAR también borra los datos en la hoja.
- La dueña le escribe a un cliente desde Telegram (`/demora 12 30`, `/listo 12`, `/avisar 12 texto`).
- Aviso a las socias por Telegram (a un grupo de las tres, o a cada una). Ella escribe `/resumen` y ve los pedidos de hoy y **cuál canal funciona mejor** (conversaciones y pedidos de Telegram contra WhatsApp).
- Sin IA: son botones. Falla menos y no gasta cupos.
- Protecciones: clave secreta en Telegram, firma de cada mensaje en WhatsApp, mensajes repetidos no duplican pedidos, tope de 60 mensajes por hora por persona.

## Probar sin internet ni cuentas (cualquier computador con Node 20 o más)
```bash
npm install --ignore-scripts
npm test
```
Eso corre 107 pruebas con Telegram, WhatsApp y la hoja de Google simulados. (Las del almacén usan `node:sqlite`, que viene con Node 22.5 o más nuevo; saca un aviso de «experimental», es normal.)

## Probar el Worker completo en tu computador
```bash
cp .dev.vars.example .dev.vars        # valores inventados
npm run db:local                      # crea la base de pruebas
npm run dev                           # queda en http://localhost:8787
```
Si `wrangler` dice que falta `@cloudflare/workerd-...`, instálalo con `npm install --no-save --ignore-scripts @cloudflare/workerd-linux-64@VERSION` (cambia `linux-64` según tu sistema; la versión sale de `node_modules/workerd/package.json`).

## Primera vez: ensayo paso a paso
La guía completa, con comandos y qué hacer si algo falla, está en [`docs/GUIA-PILOTO-TELEGRAM.md`](docs/GUIA-PILOTO-TELEGRAM.md). El ayudante `scripts/telegram.mjs` conecta Telegram con tu bot sin dejar el token a la vista.

## Usarlo con un cliente real (lo haces tú, con las cuentas del cliente)
1. El cliente crea su cuenta de Cloudflare. Tú creas la base: `npx wrangler d1 create bot-negocio` y pegas su `database_id` en `wrangler.toml`; luego `npx wrangler d1 execute bot-negocio --remote --file=schema.sql`.
2. Copia `src/negocios/flores-fomi.js` con los datos del negocio (máximo 9 productos), regístralo en `src/negocios/index.js` y cambia `NEGOCIO` en `wrangler.toml`.
3. Telegram: crea el bot con @BotFather. Guarda `TELEGRAM_BOT_TOKEN` y `TELEGRAM_WEBHOOK_SECRET` con `npx wrangler secret put NOMBRE` (el valor lo escribes tú en tu terminal, nunca en un chat). Pon tu número de Telegram en `OWNER_TELEGRAM_ID` (`node scripts/telegram.mjs mi-id` lo muestra).
4. `npx wrangler deploy` y luego `node scripts/telegram.mjs registrar` (conecta Telegram con la dirección `/telegram` y la clave secreta).
5. WhatsApp (opcional): requiere una cuenta de Meta Business **a nombre del cliente**. Guarda `WA_TOKEN`, `WA_APP_SECRET` y `WA_VERIFY_TOKEN` como secretos, pon `WA_PHONE_NUMBER_ID` y registra la dirección `/whatsapp` en Meta. **Antes de prometer «gratis», revisa la tarifa vigente de Meta**: desde octubre de 2026 cobra pasado el tope mensual de mensajes de servicio (ver la skill `whatsapp-cloud-api` de `agent-skills-jeiler`).

## Hoja de Google: pedidos, clientes y productos que se editan desde el celular
Un **Apps Script** (programita de Google) vive **dentro de la hoja del cliente**. Así los datos quedan en su cuenta y no hace falta ningún archivo de claves. Tres pestañas:
- **Productos:** el catálogo. La dueña cambia nombres, precios y «Activo (Sí/No)» desde la app de Google Sheets; el bot lo usa en unos 2 minutos. Si la hoja falla o queda vacía, el bot conserva el último menú bueno.
- **Pedidos:** una fila por pedido.
- **Clientes:** una fila por cliente (nombre, contacto, cuántos pedidos y cuánto ha comprado).

Guía paso a paso (y la parte para la dueña): [`docs/GUIA-HOJA-GOOGLE.md`](docs/GUIA-HOJA-GOOGLE.md).
- Si la copia de un pedido falla, el pedido igual se guarda y la dueña recibe un aviso; `/reintentar` copia los que faltan y completa los borrados pendientes.
- BORRAR también borra en la hoja (pedidos en blanco y cliente fuera de «Clientes»).
- El bot solo manda la clave a direcciones de `script.google.com`; trata la dirección del script como secreta.
- Base ya publicada antes de esta versión: corre una vez `migraciones/2026-11-05-catalogo-y-avisos.sql`.
- **Estos pasos están escritos de memoria y no se verificaron en la pantalla de Google hoy**: los nombres de los menús pueden variar.

## Comandos de las socias (por Telegram: en privado o en el grupo de alertas)
`/resumen` pedidos de hoy y qué canal vende más · `/demora 12 30` y `/listo 12` avisan al cliente · `/avisar 12 texto` le escribe lo que quieras · `/catalogo` revisa la hoja de productos · `/reintentar` copia a la hoja lo pendiente · `/ayuda` la lista · `/id` dice tu número de Telegram y el del chat (sirve para cualquiera).
Varias socias: `OWNER_TELEGRAM_ID = "111,222,333"`. Grupo de Telegram de las socias: `ALERTAS_CHAT_ID = "-100..."` (el bot manda ahí cada aviso de pedido y solo obedece a las socias en ese grupo; si el grupo falla, avisa a cada una por privado). Guía completa: [`docs/GUIA-HOJA-GOOGLE.md`](docs/GUIA-HOJA-GOOGLE.md).
**WhatsApp:** solo se le puede escribir a un cliente dentro de las 24 horas siguientes a su último mensaje; pasado ese tiempo el bot te da el enlace para que le escribas tú.

## Límites que debes decirle al cliente
- WhatsApp: gratis solo hasta el tope mensual de Meta; después, él paga directo a Meta.
- Cloudflare: el nivel gratis tiene topes diarios (por ejemplo, D1 permite 100.000 filas escritas por día según su documentación de 2026-10; el bot escribe unas 2 a 4 por mensaje, cuenta aproximada y sin medir). Si el negocio crece, se pasa al plan de pago de Cloudflare, que paga el cliente.
- Los datos viven en Cloudflare, Telegram y Meta (fuera de Colombia). Hay que decirlo en el aviso de privacidad.

## Estructura
`src/core.js` conversación · `src/telegram.js` y `src/whatsapp.js` canales · `src/sheets.js` hoja de Google · `src/catalogo.js` productos desde la hoja · `src/dueno.js` comandos de la dueña · `src/envio.js` envío de mensajes · `apps-script/Codigo.gs` lo que se pega en la hoja · `src/store.js` base de datos · `src/negocios/` catálogos · `test/` pruebas · `schema.sql` tablas.

Licencia MIT. Ver `PRUEBAS.md` (qué se probó y qué no) y `SEGURIDAD.md`.
