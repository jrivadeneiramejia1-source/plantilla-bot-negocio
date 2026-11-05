# Guía: publicar el primer bot de prueba en Telegram (ensayo con datos inventados)

Este es un **ensayo con tus propias cuentas y datos inventados**, antes de usarlo con una clienta. Nadie más escribe al bot. Cuando salga bien, se repite con las cuentas de la clienta (ver el final).

Lo que hace cada paso, en una frase, va entre paréntesis. Los comandos son iguales en Windows, Mac y Linux; los pasos de abajo están pensados para **Windows**.

## Lo que necesitas
- **Node 20 o más nuevo** (programa para correr el código). Si no lo tienes, mira «Instalar Node en Windows» más abajo.
- Tu cuenta de **Cloudflare** y la app de **Telegram**.
- Una terminal abierta **dentro de la carpeta del proyecto**.

## Instalar Node en Windows (si `node -v` no muestra un número)
1. Entra a **nodejs.org** y baja la versión **LTS** para Windows. Con permiso de administrador, el instalador `.msi` es lo más fácil: siguiente, siguiente, y deja marcada la opción de agregarlo al PATH (así las terminales lo encuentran).
2. Si el computador **no te deja instalar programas** (es del trabajo o compartido): en la misma página busca «Windows Binary (.zip)», descomprímelo en una carpeta tuya (por ejemplo `C:\Users\TU-USUARIO\node`) y en cada terminal escribe `set PATH=C:\Users\TU-USUARIO\node;%PATH%` antes de los demás comandos.
3. **Cierra y abre la terminal** y comprueba: `node -v` debe mostrar un número como `v22...` (mínimo 20).

## Cómo abrir la terminal en Windows (usa «Símbolo del sistema», no PowerShell)
1. Abre la carpeta del proyecto en el Explorador de archivos.
2. Haz clic en la barra de la dirección (arriba), borra lo que dice, escribe `cmd` y Enter. Se abre una ventana negra **ya dentro de esa carpeta**.
3. **Por qué cmd:** PowerShell suele bloquear `npm` y `npx` con un mensaje de «la ejecución de scripts está deshabilitada». En `cmd` eso no pasa. Si te sale ese mensaje, cierra y abre `cmd`.
4. Para **pegar** en cmd: clic derecho en la ventana (o Ctrl+V en Windows 10/11 recientes). Al pegar el token o la clave **no se ve nada, es normal**; presiona Enter.

## 1. Bajar el código
En GitHub, en `plantilla-bot-negocio`, botón verde **Code → Download ZIP**; descomprímelo y abre la terminal en esa carpeta (o `git clone` si ya usas git). Luego:
```bash
npm install --ignore-scripts
```
(instala las herramientas del proyecto; `--ignore-scripts` evita que corran programas extra.)

## 2. Entrar a Cloudflare
```bash
npx wrangler login
```
(se abre el navegador para que autorices tu cuenta. Nada de claves en la terminal.)

## 3. Crear la base de datos
```bash
npx wrangler d1 create bot-negocio
```
Copia el `database_id` que muestra y pégalo en `wrangler.toml`, reemplazando `REEMPLAZAR-con-el-id-de-tu-base-D1`. Luego crea las tablas:
```bash
npx wrangler d1 execute bot-negocio --remote --file=schema.sql
```

## 4. Crear el bot en Telegram
En Telegram busca **@BotFather** (el bot oficial que crea bots) → escribe `/newbot` → elige un nombre y un usuario que termine en `bot`. Te entrega un **token** (una clave larga con dos puntos en medio). **Es secreto: no lo pegues en ningún chat**, solo en la terminal cuando el programa te lo pida.

## 5. Saber tu número de Telegram
Abre tu bot nuevo y escríbele «hola» (todavía no contestará). Luego:
```bash
node scripts/telegram.mjs mi-id
```
Pega el token cuando lo pida (no se ve al escribir: es normal). Te muestra tu número. En `wrangler.toml` pon: `OWNER_TELEGRAM_ID = "ese número"` (con comillas). Así el bot te avisa de cada pedido y solo tú puedes usar `/resumen`.

## 6. Publicar
```bash
npx wrangler deploy
```
Al final muestra la dirección de tu bot, algo como `https://bot-negocio.TU-USUARIO.workers.dev`. Cópiala. (Si te pregunta por un «subdominio workers.dev», elige uno; es la parte `TU-USUARIO`.)

## 7. Guardar las claves en Cloudflare
```bash
node scripts/telegram.mjs clave
```
(inventa una clave secreta; cópiala). Ahora guarda dos secretos; cada comando te pide el valor:
```bash
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET     # pega la clave inventada
npx wrangler secret put TELEGRAM_BOT_TOKEN          # pega el token de BotFather
```

## 8. Conectar Telegram con tu bot
```bash
node scripts/telegram.mjs registrar
```
Te pide el token, la misma clave inventada y la dirección del paso 6. (Le dice a Telegram dónde entregar los mensajes.)

## 9. Probarlo (con datos inventados)
1. Escríbele «hola»: debe mostrar el **aviso de privacidad** con «Acepto».
2. Acepta, pide algo del menú (flores de foami de ejemplo), pon un nombre inventado y una nota inventada, y envía el pedido.
3. A ti te debe llegar el aviso «Pedido nuevo #1».
4. Escribe `/resumen`: cuenta de hoy. Escribe `BORRAR`: borra tus datos.
5. Anota: ¿contestó rápido? ¿se entendieron los textos? ¿algo te confundió?

## Si algo falla
| Síntoma | Qué hacer |
|---|---|
| El bot no contesta | `node scripts/telegram.mjs estado`: muestra el último error de entrega |
| «401» en `estado` | La clave del paso 7 no es la misma que pusiste en `registrar`: repite 7 y 8 con la misma clave |
| No te llega el aviso de pedido | Revisa `OWNER_TELEGRAM_ID` (con comillas) y vuelve a correr `npx wrangler deploy` |
| `mi-id` dice que ya hay webhook | `node scripts/telegram.mjs quitar` y repite el paso 5 |
| Ver qué pasa por dentro | `npx wrangler tail` (muestra los mensajes de error en vivo; no contiene mensajes de clientes) |

## Al terminar el ensayo
- **Si usaste un computador compartido o del trabajo:** corre `npx wrangler logout` (cierra tu sesión de Cloudflare en ese computador), borra la carpeta del proyecto y vacía el portapapeles (copia cualquier texto cualquiera). Así no quedan tu sesión ni las claves ahí.
- Si no lo vas a dejar corriendo: `node scripts/telegram.mjs quitar`.
- Anota lo que viste y dime: yo arreglo lo que haya fallado antes de ir con la clienta.

## Con la clienta real (después del ensayo)
1. Ella crea **su** cuenta de Cloudflare y **su** bot en BotFather (los datos de sus compradores deben quedar en sus cuentas). Tú la acompañas.
2. Cambia el catálogo (`src/negocios/`) con sus productos y precios reales, y `NEGOCIO` en `wrangler.toml`.
3. Antes de empezar: briefing, cotización con descuento de piloto y alcance por escrito (repo `servicios-skills-jeiler`), y el aviso de privacidad adaptado.
4. Repite los pasos 1 a 9 con sus cuentas. Las claves las escribe ella.
5. Si quiere copia a Google Sheets, ver el README.

## Qué NO está probado en esta guía
**Nada se probó en Windows** (todo se probó en Linux): ni la instalación de Node, ni `cmd`, ni la entrada escondida del token en la ventana de Windows. Si algo se ve distinto, dímelo y lo corrijo.

Los pasos con Cloudflare (`login`, `d1 create`, `deploy`, `secret put`) y con BotFather se escribieron de memoria y **no se ejecutaron en tu cuenta**: los textos de las pantallas pueden variar. Sí se probó con un Telegram de mentira el ayudante `scripts/telegram.mjs` y que el Worker se empaqueta bien (`wrangler deploy --dry-run`). Nunca se ha hablado con el Telegram real.
