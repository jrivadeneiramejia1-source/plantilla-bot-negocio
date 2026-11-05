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

## Copia a Google Sheets
- El Worker solo manda `SHEETS_TOKEN` a direcciones `https://script.google.com` o `script.googleusercontent.com`; con cualquier otra, no envía nada.
- El Apps Script rechaza todo si no coincide el `TOKEN` (guardado en las propiedades del script) o si no hay `TOKEN` configurado.
- Los textos que empiezan con `=`, `+`, `-` o `@` se guardan como texto (con una comilla delante) para que nadie meta fórmulas en la hoja (inyección de fórmulas).
- BORRAR deja nombre, contacto y nota en blanco también en la hoja; si la hoja no responde, queda pendiente y la dueña recibe un aviso (`/reintentar`).
- La dirección del script y el token son secretos de Cloudflare; no se escriben en los registros ni en los mensajes de error.
- La hoja y Google Apps Script son de la cuenta del cliente; los datos pasan además por Google (servidores fuera de Colombia): decirlo en el aviso.

## Productos desde la hoja y comandos de la dueña
- Los productos de la pestaña «Productos» los puede editar **cualquiera con acceso de edición a la hoja**: la hoja debe compartirse solo con gente de confianza del negocio. El Worker vuelve a revisar todo lo que lee (código, nombre de hasta 24 letras, precio entero entre 1 y 100.000.000, descripción de hasta 80, máximo 9 productos) y el total de cada pedido se calcula siempre con el catálogo vigente, no con lo que mande el cliente.
- Si la hoja se vacía o queda mal escrita, el bot conserva el último catálogo bueno; los cambios de la hoja tardan hasta 2 minutos en verse.
- Los comandos de las socias (`/avisar`, `/demora`, `/listo`, `/catalogo`, `/reintentar`, `/resumen`) solo se aceptan de los números de Telegram en `OWNER_TELEGRAM_ID` (varios, separados por coma); si no hay números, nadie es socia. Quien controle una de esas cuentas de Telegram puede escribirle a los clientes: protegerlas con verificación en dos pasos.
- **Grupo de las socias:** el bot solo obedece en el grupo cuyo número está en `ALERTAS_CHAT_ID`, y solo a las socias; en otros grupos, o a otras personas del grupo, no responde (salvo `/id`, que solo dice el número de quien lo escribe y del chat). Los clientes se atienden únicamente en chat privado. Todo el que esté en el grupo ve los avisos de pedido (nombres y contactos): el grupo debe tener solo a las socias. Si el grupo falla, el aviso va a cada socia por privado.
- Los mensajes que la dueña manda a un cliente se limpian (sin saltos ni caracteres de control), se recortan a 500 letras, van como texto plano y solo se envían a personas que hicieron un pedido; nunca a quien pidió borrar sus datos.
- WhatsApp solo permite mensajes libres 24 horas después del último mensaje del cliente; pasado ese tiempo el bot no manda nada y entrega el enlace para que la dueña escriba ella.
- La pestaña «Clientes» guarda nombre y contacto de los compradores (datos personales): vive en la cuenta del negocio, y BORRAR la deja sin esa fila.

## Datos personales de los compradores (Ley 1581 de 2012, habeas data)
- Qué se guarda: nombre, nota de entrega, contacto (teléfono de WhatsApp o usuario de Telegram) y el pedido. Solo para entregarlo.
- Se pide aceptación antes de guardar nada. **BORRAR** elimina la sesión y deja los pedidos sin nombre, nota ni contacto (se conserva el valor para la contabilidad).
- Las sesiones se borran solas pasados 7 días sin uso.
- Los datos pasan por Cloudflare, Telegram, Meta y (si se activa la hoja) Google (servidores fuera de Colombia). El aviso al cliente final debe decirlo.
- Cada negocio debe usar sus propias cuentas, para que los datos de sus compradores sean suyos y no de Jeiler.
- Este texto no es asesoría legal: lo revisa un abogado antes de venderlo.

## Dependencias
- Cero dependencias de ejecución. Solo `wrangler` para desarrollo, instalado con `--ignore-scripts`.
- Sin código de terceros copiado.

## Resultado de la revisión
- `gitleaks` **no se pudo instalar** en el entorno de la nube; se hizo una búsqueda manual de patrones de claves (ver `PRUEBAS.md`). Pendiente: correr `gitleaks` en un computador que lo tenga.
