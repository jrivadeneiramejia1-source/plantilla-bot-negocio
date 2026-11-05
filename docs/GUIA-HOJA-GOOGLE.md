# Guía: productos y clientes en una hoja de Google (para editar desde el celular)

**Qué logra:** la dueña cambia nombres, precios y productos desde el celular (app de Google Sheets) y el bot los usa en unos 2 minutos. Además la hoja guarda los pedidos y una lista de clientes. Y desde Telegram ella le puede escribir a un cliente: «tu pedido demora 30 minutos».

Usa la hoja **de la dueña** (en su cuenta de Google). En el ensayo, usa una hoja tuya con datos inventados.

## Parte 1: lo haces tú, una vez (computador)
1. **Si ya tenías la base D1 publicada** (la del ensayo), corre una sola vez: `npx wrangler d1 execute bot-negocio --remote --file=migraciones/2026-11-05-catalogo-y-avisos.sql` (agrega lo nuevo). Si la creas de cero con `schema.sql`, no hace falta.
2. En Google Sheets crea una hoja nueva. Menú **Extensiones → Apps Script** (Extensions → Apps Script). Borra lo que haya y pega **todo** el contenido de `apps-script/Codigo.gs` (si ya habías pegado una versión anterior, reemplázala).
3. **Configuración del proyecto → Propiedades de la secuencia de comandos** (Project Settings → Script properties): crea `TOKEN` con una palabra larga inventada (que la escriba la dueña; no se manda por chat).
4. **Implementar → Nueva implementación → Aplicación web** (Deploy → New deployment → Web app). *Ejecutar como:* yo (Me). *Quién tiene acceso:* cualquier persona (Anyone). Autoriza los permisos que pide. Copia la dirección que termina en `/exec`.
   - Si ya tenías una implementación: **Implementar → Administrar implementaciones → lápiz → Versión: Nueva versión → Implementar**. La dirección sigue igual.
5. En la terminal (`cmd`): `npx wrangler secret put SHEETS_URL` (pega la dirección) y `npx wrangler secret put SHEETS_TOKEN` (la misma palabra del paso 3). Luego `npx wrangler deploy`.
6. En Telegram, con tu cuenta de dueña, escríbele al bot **`/catalogo`**. Si la pestaña «Productos» está vacía, el bot la llena con los productos de ejemplo. Abre la hoja: debes ver las pestañas **Productos**, y más tarde **Pedidos** y **Clientes**.
7. Comparte la hoja con quien deba editar (botón **Compartir**, con su correo, como «Editor»). Solo debe poder entrar la gente de confianza del negocio.

## Parte 2: lo que hace la dueña desde el celular
1. Abre la app **Google Sheets** y la hoja del negocio; toca la pestaña **Productos**.
2. Cada fila es un producto. Columnas:
   - **Código:** déjalo en blanco en un producto nuevo; el bot le pone uno y no se vuelve a cambiar.
   - **Nombre:** hasta 24 letras (es lo que se ve en el botón).
   - **Precio:** solo el número, por ejemplo `4000`. (Si escribes `$4.000` también lo entiende.)
   - **Descripción:** opcional, hasta 80 letras.
   - **Activo:** toca la celda y elige **Sí** o **No**. «No» esconde el producto sin borrarlo (por ejemplo, cuando se acabó).
   - **Estado:** lo escribe el bot; dice «OK» o qué está mal en esa fila (por ejemplo «Precio inválido»). **No lo borres ni lo escribas.**
3. Máximo **9 productos activos** (es el límite de la lista de WhatsApp). Los que sobren aparecen en «Estado» como «Sobra».
4. Guarda sin hacer nada más: Google Sheets guarda solo. En unos 2 minutos el bot muestra los cambios. Si quieres que se vean ya, escríbele al bot `/catalogo` desde Telegram.
5. Si borras todo por accidente o deja de funcionar, **el bot sigue con el último menú bueno**; no se queda sin vender.

## Pestañas que llena el bot (no las edites)
- **Pedidos:** una fila por pedido (nombre, contacto, productos, total, nota). La columna «Estado» queda en «nuevo»; puedes escribirle «entregado» para llevar tu control.
- **Clientes:** una fila por cliente con su nombre, contacto (número de WhatsApp o usuario de Telegram), cuántos pedidos ha hecho y cuánto ha comprado.

## Escribirle a un cliente (desde Telegram, solo la dueña)
Cada aviso de pedido trae su número (`#12`). Escríbele al bot:
- `/demora 12 30` → le dice al cliente que su pedido 12 demora 30 minutos.
- `/listo 12` → le dice que su pedido 12 está listo.
- `/avisar 12 Ya salió el domiciliario` → le manda ese texto.
- `/ayuda` → la lista de comandos.

**Límite de WhatsApp (importante):** a un cliente de WhatsApp solo se le puede escribir **dentro de las 24 horas siguientes a su último mensaje**. Pasado ese tiempo, el bot no manda nada y te da el enlace (`wa.me`) para que le escribas tú desde tu WhatsApp. A los clientes de Telegram no les aplica ese límite.
Los comandos de la dueña solo funcionan desde el número de Telegram que está en `OWNER_TELEGRAM_ID`.

## Privacidad
La hoja guarda nombres y contactos de los compradores: es de la dueña y debe estar en **su** cuenta. Quien tenga acceso de edición a la hoja ve esos datos. Si un cliente escribe **BORRAR**, el bot deja sus datos en blanco en la hoja y lo quita de «Clientes».

## Si algo falla
| Síntoma | Qué hacer |
|---|---|
| `/catalogo` dice «No pude leer la hoja» | Revisa `SHEETS_URL` y `SHEETS_TOKEN` (la palabra debe ser igual a la del Apps Script) y que la implementación diga «Cualquier persona». Tras cambiar el código del Apps Script, hay que publicar una **Nueva versión** |
| Un producto no aparece | Mira su columna «Estado» y que «Activo» diga **Sí** |
| El precio no cambió | Espera 2 minutos o escribe `/catalogo` |
| «Sobra» en el Estado | Hay más de 9 productos activos: pon «No» en alguno |

## Qué NO está probado en esta guía
Todo se probó con un Apps Script «de mentira» (el código real corre contra una hoja simulada) y con el Worker local; **nada contra un Google real**: ni la implementación, ni la lista desplegable Sí/No, ni la edición desde la app del celular, ni que el bot siga bien la redirección que responde Google. Los nombres de los menús están escritos de memoria.
