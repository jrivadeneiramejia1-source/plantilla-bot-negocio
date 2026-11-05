# Guía completa: grupo de las socias, hoja de Google y avisos a los clientes

**Qué vas a lograr, en simple**
1. Las **tres socias** reciben cada pedido en un **grupo de Telegram** y desde ahí pueden dar órdenes al bot.
2. Los **productos y precios** viven en una **hoja de Google** que se edita desde el celular; el bot los usa en unos 2 minutos.
3. Desde el grupo, una socia le dice al bot: «avísale al cliente del pedido 12 que demora 30 minutos», y **el bot le escribe al cliente**.

Hazlo primero con datos inventados (ensayo). Los comandos se escriben en el **Símbolo del sistema (`cmd`)** de Windows, dentro de la carpeta del proyecto: abajo, en «Antes de empezar», está cómo abrirlo.

---

## Antes de empezar: lo que necesitas y cómo se hace en Windows

**Cuentas:** Cloudflare (la del ensayo), Telegram (cada socia) y una cuenta de Google (la del negocio; en el ensayo, la tuya).

**El código (el «ZIP»):** es una carpeta comprimida con todo el programa.
- Enlace de descarga directo: `https://github.com/jrivadeneiramejia1-source/plantilla-bot-negocio/archive/refs/heads/main.zip` (pégalo en el navegador y se descarga solo; el repositorio es público, no pide cuenta). Termina en la carpeta `Descargas` (Downloads).
- **Descomprimirlo:** clic derecho sobre el archivo → **Extraer todo** (Extract all) → Extraer. Se crea una carpeta `plantilla-bot-negocio-main`; a veces tiene **otra igual adentro**: la buena es la que tiene `package.json`, `wrangler.toml` y la carpeta `src`.

**Ver o copiar un archivo sin descomprimir:** en GitHub abre el archivo (por ejemplo `apps-script/Codigo.gs`) y toca el icono de copiar, o abre el enlace «Raw», selecciona todo (Ctrl+A) y copia (Ctrl+C).

**Abrir una terminal en la carpeta buena:** abre la carpeta en el Explorador de archivos, haz clic en la barra de direcciones (arriba), borra lo que dice, escribe `powershell` y Enter. Se abre una ventana azul **ya dentro de esa carpeta**. Ahí activa Node (se hace **cada vez que abres una ventana nueva**):
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
fnm use 22
node -v
```
Debe salir `v22...`. Después escribe `cmd` y Enter: pasa a «Símbolo del sistema», donde `npm` y `npx` no se bloquean. Todos los comandos de esta guía se escriben ahí.

**Editar un archivo (por ejemplo `wrangler.toml`):** clic derecho sobre el archivo → **Abrir con** → **Bloc de notas** (Notepad). Cambia lo que diga la guía y guarda con **Archivo → Guardar** (no uses «Guardar como»: se le pondría `.txt` al final y dejaría de funcionar). No cambies nada más.

**Pegar en la terminal:** clic derecho dentro de la ventana, o Ctrl+V. Cuando pide un secreto no se ve nada al pegar: es normal; presiona Enter.

**Si te sale un error:** copia el mensaje (sin tokens ni claves) y mándamelo con el número del paso.

---

## Parte 1. Actualizar el bot que ya publicaste (una sola vez, en el computador)
*Por qué:* el bot publicado tiene el código viejo; el nuevo trae la hoja, el grupo y los avisos.

1. Baja el ZIP con el enlace de «Antes de empezar» y **descomprímelo en una carpeta nueva** (no encima de la vieja; si tienes una carpeta anterior con el mismo nombre, cámbiale el nombre a la vieja primero).
2. Esa carpeta nueva trae `wrangler.toml` «en blanco». Necesitas dos datos de la vieja:
   - El `database_id`: en `cmd`, dentro de la carpeta nueva, `npx wrangler login` (si pide entrar) y luego `npx wrangler d1 list`. Copia el número de la base `bot-negocio`.
   - Pega ese número en `wrangler.toml` (nuevo), en lugar de `REEMPLAZAR-con-el-id-de-tu-base-D1`.
3. `npm install --ignore-scripts` (instala las herramientas).
4. **Migración, una sola vez** (agrega las tablas nuevas a tu base ya publicada):
   `npx wrangler d1 execute bot-negocio --remote --file=migraciones/2026-11-05-catalogo-y-avisos.sql`
   Si sale un error que dice `duplicate column name: clave`, ya estaba hecha: sigue.
5. `npx wrangler deploy`. Los secretos que ya guardaste (token del bot y clave) **se conservan**; no hay que ponerlos otra vez.
6. Prueba que sigue vivo: escríbele «hola» al bot desde otro Telegram.

## Parte 2. Las socias y su grupo de Telegram
*Por qué un grupo:* así las tres ven cada pedido y cada aviso al cliente, y no depende de una sola persona.

1. Cada socia instala **Telegram**, abre el bot y le escribe **`/id`**. El bot contesta «Tu número de Telegram: 123456789». Anota los tres números.
2. Una de ustedes crea el grupo: en Telegram, **Nuevo grupo** (New Group), agrega a las otras dos socias y ponle un nombre (por ejemplo «Pedidos»).
3. Agrega el bot al grupo: dentro del grupo, tocar el nombre del grupo → **Agregar miembros** (Add members) → buscar el usuario del bot.
4. En el grupo escribe **`/id`**. El bot contesta «Número de este chat: -100...» (es **negativo**, empieza con `-`). Anótalo.
   *(Si algún día conviertes el grupo en «supergrupo» o lo recreas, el número cambia: vuelve a escribir `/id`.)*
5. En `wrangler.toml` (en la carpeta nueva) pon:
   ```
   OWNER_TELEGRAM_ID = "111111111,222222222,333333333"   # los tres números de las socias, separados por coma
   ALERTAS_CHAT_ID = "-1001234567890"                    # el número del grupo
   ```
   Luego `npx wrangler deploy` otra vez.
6. Prueba: en el grupo escribe `/ayuda`. El bot debe contestar la lista de comandos. Solo las tres socias y solo en ese grupo les obedece; a cualquier otra persona o grupo no le hace caso (salvo `/id`).
7. Si el grupo falla por algún motivo, el bot manda el aviso a cada socia por privado: no se pierde.

## Parte 3. La hoja de Google (productos, pedidos y clientes)
*Por qué:* para que las socias cambien precios desde el celular, sin tocar archivos del computador.

La hoja debe estar en la **cuenta de Google del negocio** (en el ensayo, en la tuya).
1. En Google Sheets crea una hoja nueva (ponle «Bot de pedidos»).
2. Menú **Extensiones → Apps Script** (Extensions → Apps Script). Es un editor de código dentro de la hoja. Borra lo que haya y pega **todo** el contenido del archivo `apps-script/Codigo.gs`. Guarda (icono del disquete).
3. A la izquierda, **Configuración del proyecto** (el engranaje) → **Propiedades de la secuencia de comandos** (Script properties) → **Agregar propiedad**: nombre `TOKEN`, valor una **palabra larga inventada** por ustedes (letras y números, 20 o más; no la manden por chat). Guarda.
4. Arriba a la derecha **Implementar → Nueva implementación** (Deploy → New deployment) → rueda de «tipo» → **Aplicación web** (Web app).
   - *Ejecutar como:* **Yo** (Me).
   - *Quién tiene acceso:* **Cualquier persona** (Anyone).
   - Toca **Implementar**. Google pide permisos: acepta. Puede salir un aviso de «Google no verificó esta aplicación»: es normal porque el programa es de ustedes; toca **Configuración avanzada → Ir a (nombre del proyecto)**.
   - Copia la **dirección** que termina en `/exec`.
5. En `cmd`: `npx wrangler secret put SHEETS_URL` (pega la dirección) y `npx wrangler secret put SHEETS_TOKEN` (la misma palabra del paso 3). Luego `npx wrangler deploy`.
6. En el grupo de las socias escribe **`/catalogo`**. Como la pestaña «Productos» está vacía, el bot la llena con los productos de ejemplo. Abre la hoja: ya existe la pestaña **Productos**.
7. **Compartir la hoja:** botón **Compartir** (Share), con el correo de cada socia, como «Editor». Solo gente de confianza: quien edita ve los teléfonos de los compradores y puede cambiar precios.
8. Si luego cambias el código del Apps Script: **Implementar → Administrar implementaciones → lápiz → Versión: Nueva versión → Implementar** (la dirección no cambia).

## Parte 4. Cómo se usa (para las socias, desde el celular)

### Cambiar productos y precios
1. Abrir la app **Google Sheets** → la hoja del negocio → pestaña **Productos**.
2. Cada fila es un producto:
   - **Código:** en un producto nuevo déjalo vacío; el bot le pone uno y ya no cambia.
   - **Nombre:** hasta 24 letras (es lo que se ve en el botón).
   - **Precio:** solo el número, por ejemplo `4000` (si escribes `$4.000` también lo entiende).
   - **Descripción:** opcional, hasta 80 letras.
   - **Activo:** tocar la celda y elegir **Sí** o **No**. «No» esconde el producto sin borrarlo (por ejemplo, si se acabó).
   - **Estado:** lo escribe el bot («OK» o qué está mal en esa fila). **No lo escribas.**
3. Máximo **9 productos activos**. Google guarda solo. En unos 2 minutos el bot muestra los cambios; para verlos ya, escribe `/catalogo` en el grupo.
4. Si alguien borra todo sin querer, el bot sigue con el último menú bueno.

### Pedidos y clientes
- **Pedidos:** una fila por pedido (nombre, contacto, productos, total, nota). La columna «Estado» queda en «nuevo»; pueden escribirle «entregado» para su control.
- **Clientes:** una fila por cliente con su nombre, contacto (usuario de Telegram), cuántos pedidos y cuánto ha comprado. **No editen estas dos pestañas** (las llena el bot).

### Escribirle al cliente (desde el grupo de las socias)
Cada aviso de pedido trae su número (`#12`). En el grupo escriban:
- `/demora 12 30` → al cliente del pedido 12: «va a demorar unos 30 minutos».
- `/listo 12` → «está listo».
- `/avisar 12 Ya salió el domiciliario` → le manda ese texto.
- `/resumen` → pedidos de hoy. `/catalogo` → revisa la hoja. `/ayuda` → todos los comandos.

El bot confirma en el grupo («Enviado a Ana (pedido #12)») para que las tres sepan que ya se avisó. Solo se le puede escribir a quien hizo un pedido y no pidió borrar sus datos.
*Cuando se use WhatsApp:* a esos clientes solo se les puede escribir dentro de las 24 horas siguientes a su último mensaje; pasado ese tiempo el bot da el enlace para que la socia escriba ella. A los clientes de Telegram no les aplica.

## Parte 5. Probar que todo funciona (con datos inventados)
1. Desde **otro** Telegram (no el de una socia) abre el bot, escribe «hola», acepta y haz un pedido con un nombre inventado.
2. En el **grupo** debe llegar «Pedido nuevo #1».
3. En el grupo escribe `/demora 1 20`. El cliente de prueba debe recibir el mensaje.
4. En la hoja deben aparecer el pedido en **Pedidos** y el cliente en **Clientes**.
5. Cambia un precio en **Productos** y escribe `/catalogo`: el menú del bot muestra el precio nuevo.
6. Como cliente de prueba, escribe `BORRAR`: los datos desaparecen de la hoja.

## Si algo falla
| Síntoma | Qué hacer |
|---|---|
| El bot no contesta `/id` o `/ayuda` en el grupo | `/id` debe funcionar siempre; si no, el bot no está publicado con el código nuevo: repite la Parte 1. `/ayuda` solo contesta a las socias, en el grupo cuyo número está en `ALERTAS_CHAT_ID` |
| `/ayuda` en el grupo no contesta pero `/id` sí | Revisa `OWNER_TELEGRAM_ID` (los tres números, con comillas y comas) y `ALERTAS_CHAT_ID` (con el `-`), y vuelve a `npx wrangler deploy` |
| Los avisos llegan por privado y no al grupo | El número del grupo está mal o el bot no está en el grupo: repite el paso 4 de la Parte 2 |
| `/catalogo` dice «No pude leer la hoja» | `SHEETS_URL` y `SHEETS_TOKEN` mal, la palabra no es igual a la del Apps Script, o la implementación no dice «Cualquier persona». Tras cambiar el Apps Script hay que publicar una **Nueva versión** |
| Un producto no aparece | Mira su «Estado» y que «Activo» diga **Sí** |
| El precio no cambió | Esperar 2 minutos o escribir `/catalogo` |
| «Sobra» en el Estado | Más de 9 productos activos: poner «No» en alguno |
| `/demora` dice «No encuentro el pedido» | El número del pedido está mal; usa el que trae el aviso |

## Privacidad
La hoja guarda nombres y contactos de los compradores: es del negocio y debe estar en **su** cuenta. Quien tenga acceso de edición los ve. Si un cliente escribe **BORRAR**, el bot deja sus datos en blanco en la hoja y lo quita de «Clientes».

## Palabras que salen en esta guía
- **Bot:** el programa que contesta en Telegram.
- **Worker:** el lugar de Cloudflare donde vive el bot (publicarlo = `npx wrangler deploy`).
- **Base de datos (D1):** donde el bot guarda pedidos y conversaciones.
- **Migración:** cambiar la base ya existente para que acepte lo nuevo (se hace una sola vez).
- **Secreto:** una clave que se guarda en Cloudflare y que nunca se escribe en un chat ni en un archivo.
- **Token de Telegram:** la clave que te dio @BotFather para manejar el bot. **Token de la hoja:** la palabra inventada que une el bot con la hoja de Google.
- **Apps Script:** el programita que vive dentro de la hoja de Google y recibe los pedidos del bot.
- **Webhook:** la dirección a la que Telegram entrega los mensajes (ya la registraste en el ensayo).

## Qué NO está probado en esta guía
Todo se probó con servicios simulados (Telegram, WhatsApp y Google de mentira) y con el Worker local; **nada con tu Telegram, tu grupo ni un Google reales**: ni la implementación del Apps Script, ni la lista Sí/No, ni la edición desde el celular, ni que Telegram entregue al bot los comandos del grupo, ni que `wrangler deploy` conserve los secretos. Los nombres de los menús de Telegram, Google y Windows están escritos de memoria y pueden variar. Tampoco se probó nada en Windows (todo se probó en Linux).
