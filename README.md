# plantilla-bot-negocio

Bot de pedidos para negocios pequeños. Atiende por **Telegram** y por **WhatsApp** con el mismo cerebro:
el cliente ve el menú, elige productos con botones, deja su nombre y su nota de entrega, y la dueña recibe el pedido por Telegram.
Corre gratis en Cloudflare Workers con una base D1. Los negocios de ejemplo son **inventados** (flores de foami, fresas con crema, gorras).

## Qué hace
- Aviso de privacidad al primer mensaje (Ley 1581): el cliente debe aceptar. Escribir **BORRAR** elimina sus datos.
- Menú con botones (también acepta escribir el número de la opción).
- Pedido con cantidades, resumen, nombre y nota de entrega. Los precios se toman siempre del catálogo, no de lo que mande el cliente.
- Aviso a la dueña por Telegram. Ella escribe `/resumen` y ve los pedidos de hoy y **cuál canal funciona mejor** (conversaciones y pedidos de Telegram contra WhatsApp).
- Sin IA: son botones. Falla menos y no gasta cupos.
- Protecciones: clave secreta en Telegram, firma de cada mensaje en WhatsApp, mensajes repetidos no duplican pedidos, tope de 60 mensajes por hora por persona.

## Probar sin internet ni cuentas (cualquier computador con Node 20 o más)
```bash
npm install --ignore-scripts
npm test
```
Eso corre 26 pruebas con Telegram y WhatsApp simulados.

## Probar el Worker completo en tu computador
```bash
cp .dev.vars.example .dev.vars        # valores inventados
npm run db:local                      # crea la base de pruebas
npm run dev                           # queda en http://localhost:8787
```
Si `wrangler` dice que falta `@cloudflare/workerd-...`, instálalo con `npm install --no-save --ignore-scripts @cloudflare/workerd-linux-64@VERSION` (cambia `linux-64` según tu sistema; la versión sale de `node_modules/workerd/package.json`).

## Usarlo con un cliente real (lo haces tú, con las cuentas del cliente)
1. El cliente crea su cuenta de Cloudflare. Tú creas la base: `npx wrangler d1 create bot-negocio` y pegas su `database_id` en `wrangler.toml`; luego `npx wrangler d1 execute bot-negocio --remote --file=schema.sql`.
2. Copia `src/negocios/flores-fomi.js` con los datos del negocio (máximo 9 productos), regístralo en `src/negocios/index.js` y cambia `NEGOCIO` en `wrangler.toml`.
3. Telegram: crea el bot con @BotFather. Guarda `TELEGRAM_BOT_TOKEN` y `TELEGRAM_WEBHOOK_SECRET` con `npx wrangler secret put NOMBRE` (el valor lo escribes tú en tu terminal, nunca en un chat). Pon tu número de Telegram en `OWNER_TELEGRAM_ID`.
4. `npx wrangler deploy` y registra el webhook de Telegram (`setWebhook`) con la dirección `/telegram` y el mismo `secret_token`.
5. WhatsApp (opcional): requiere una cuenta de Meta Business **a nombre del cliente**. Guarda `WA_TOKEN`, `WA_APP_SECRET` y `WA_VERIFY_TOKEN` como secretos, pon `WA_PHONE_NUMBER_ID` y registra la dirección `/whatsapp` en Meta. **Antes de prometer «gratis», revisa la tarifa vigente de Meta**: desde octubre de 2026 cobra pasado el tope mensual de mensajes de servicio (ver la skill `whatsapp-cloud-api` de `agent-skills-jeiler`).

## Límites que debes decirle al cliente
- WhatsApp: gratis solo hasta el tope mensual de Meta; después, él paga directo a Meta.
- Cloudflare: el nivel gratis tiene topes diarios. Si el negocio crece, se pasa al plan de pago de Cloudflare, que paga el cliente.
- Los datos viven en Cloudflare, Telegram y Meta (fuera de Colombia). Hay que decirlo en el aviso de privacidad.

## Estructura
`src/core.js` conversación · `src/telegram.js` y `src/whatsapp.js` canales · `src/store.js` base de datos · `src/negocios/` catálogos · `test/` pruebas · `schema.sql` tablas.

Licencia MIT. Ver `PRUEBAS.md` (qué se probó y qué no) y `SEGURIDAD.md`.
