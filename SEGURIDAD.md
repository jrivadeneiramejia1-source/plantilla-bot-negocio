# Seguridad y privacidad

## Claves
- El repo no trae ninguna clave. Los valores de `.dev.vars.example` son inventados y `.dev.vars` está en `.gitignore`.
- Los secretos reales (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `WA_TOKEN`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`) se guardan con `wrangler secret put`. Nadie los pega en un chat.
- El código no escribe en los registros ni la dirección de Telegram (lleva el token) ni el contenido de los mensajes.

## Protecciones del Worker
- Telegram: sin la clave secreta del webhook, o con una distinta, responde 401. Si la clave no está configurada, rechaza todo.
- WhatsApp: cada mensaje se acepta solo si la firma `X-Hub-Signature-256` coincide con el HMAC-SHA256 de los bytes exactos recibidos. Sin `WA_APP_SECRET` se rechaza todo. La verificación inicial exige `WA_VERIFY_TOKEN`.
- Las comparaciones de claves tardan lo mismo aunque difieran pronto.
- Mensajes repetidos (reintentos de Telegram o Meta) se detectan y no duplican pedidos ni avisos.
- Los textos del cliente se limpian (sin saltos ni caracteres de control) y se recortan; los avisos a la dueña van como texto plano, sin formato.
- Los precios se calculan en el servidor con el catálogo; lo guardado en la sesión no cambia el total.
- El bot solo atiende chats privados de Telegram, no grupos.
- Tope de 60 mensajes por hora por persona (cada respuesta de WhatsApp puede costar plata).

## Datos personales de los compradores (Ley 1581 de 2012, habeas data)
- Qué se guarda: nombre, nota de entrega, contacto (teléfono de WhatsApp o usuario de Telegram) y el pedido. Solo para entregarlo.
- Se pide aceptación antes de guardar nada. **BORRAR** elimina la sesión y deja los pedidos sin nombre, nota ni contacto (se conserva el valor para la contabilidad).
- Las sesiones se borran solas pasados 7 días sin uso.
- Los datos pasan por Cloudflare, Telegram y Meta (servidores fuera de Colombia). El aviso al cliente final debe decirlo.
- Cada negocio debe usar sus propias cuentas, para que los datos de sus compradores sean suyos y no de Jeiler.
- Este texto no es asesoría legal: lo revisa un abogado antes de venderlo.

## Dependencias
- Cero dependencias de ejecución. Solo `wrangler` para desarrollo, instalado con `--ignore-scripts`.
- Sin código de terceros copiado.

## Resultado de la revisión
- `gitleaks` **no se pudo instalar** en el entorno de la nube; se hizo una búsqueda manual de patrones de claves (ver `PRUEBAS.md`). Pendiente: correr `gitleaks` en un computador que lo tenga.
