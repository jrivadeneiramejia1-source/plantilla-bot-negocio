# Qué se probó de verdad (2026-11-05)

Todo con datos **inventados** y sin cuentas reales. Claude no vio ni usó ninguna cuenta de Telegram, WhatsApp o Cloudflare.

## Probado
| Qué | Cómo | Resultado |
|---|---|---|
| Conversación completa en los 3 negocios inventados | `npm test` (node:test) | Pasa: aviso, menú, cantidad, nombre, nota, resumen, pedido, aviso a la dueña |
| Casos raros del motor | `npm test` | Pasa: cantidad escrita (válida, vacía, 100), botón repetido o inventado, texto sin sentido, número como opción, recorte de textos, tope de mensajes por hora, sesión manipulada (el total sale del catálogo) |
| BORRAR y «No acepto» | `npm test` | Pasa: sesión eliminada, pedidos sin nombre, nota, usuario ni contacto |
| Resumen del día | `npm test` | Pasa: cuenta por canal y usa la hora de Colombia (a las 23:59 sigue siendo «hoy») |
| Telegram: clave secreta, duplicados, solo la dueña ve `/resumen`, grupos ignorados, Telegram caído | `npm test` con Telegram simulado | Pasa |
| WhatsApp: verificación, firma (incluida la firma sobre bytes exactos), duplicados, tipos no soportados, límites de botones y listas | `npm test` con WhatsApp simulado | Pasa |
| Worker real en el motor local de Cloudflare (`wrangler dev --local`, base D1 local) | Peticiones HTTP con firmas calculadas: una conversación por canal | Pasa: 2 pedidos guardados (uno por canal), conteos correctos, 401 o 403 con claves malas, el segundo envío del mismo mensaje no duplica |
| Las pruebas detectan fallas | Se rompió a propósito la comparación de claves | 4 pruebas fallaron (bien) |
| **— Copia a Google Sheets —** | | |
| El Apps Script, ejecutado con un «Google» de mentira | `npm test` | Pasa: agrega, no duplica, rechaza token malo o ausente, JSON ilegible, acción desconocida, fórmulas quedan como texto, borrar deja en blanco |
| Lado del Worker | `npm test` | Pasa: solo direcciones de Google, el token viaja en el cuerpo y no aparece en errores, respuestas malas o ilegibles dan error claro, la falla de la hoja no afecta al cliente, `/reintentar` copia y completa borrados, solo para la dueña |
| El SQL de D1 | las mismas pruebas del almacén corren con memoria y con SQLite real (`node:sqlite`) | Pasan en los dos |
| Camino de falla en el Worker local con D1 | `wrangler dev --local`, hoja inalcanzable | Pedido guardado, marcado como no copiado, `/reintentar` responde, BORRAR anonimiza; la dirección y la clave no salen en los registros |
| Las pruebas nuevas detectan fallas | Se quitó la protección de fórmulas y, aparte, el borrado en la hoja | En cada caso 1 prueba falló (bien) |

| **— Guía del ensayo en Telegram —** | | |
| Ayudante `scripts/telegram.mjs` con un Telegram de mentira en este computador | 10 pruebas: `clave` distinta cada vez; `registrar` manda la dirección `/telegram`, la clave y los tipos de mensaje; rechaza token mal escrito, clave mala y direcciones sin https sin tocar el webhook; error de Telegram o sin internet con mensaje claro; `mi-id` ignora grupos y bots y se niega si hay webhook; `estado` y `quitar`; no acepta otra dirección de Telegram que este computador | Pasan; **ni el token ni la clave aparecen nunca en la pantalla** |
| Entrada con teclado real (terminal simulada) | `registrar` con token y clave escondidos mientras se escriben | Ni el token ni la clave se ven; llamadas correctas |
| Instalación desde cero y empaquetado | copia limpia de `main`: `npm install --ignore-scripts`, `wrangler --version`, `wrangler deploy --dry-run` | Funcionan; el archivo de versiones incluye Windows, Mac y Linux |
| Falla provocada | Se hizo que `registrar` imprimiera la clave | 1 prueba falló (bien) |

Total: 58 pruebas automáticas, todas pasan (26 de la base, 22 de la hoja y el almacén, 10 del ayudante de Telegram).

## Errores encontrados al probar
- (Hoja) Dos pruebas fallaron al principio por cosas de la propia prueba (SQLite devuelve objetos sin prototipo; el Apps Script corre en otro «reino» de JavaScript); se ajustaron las pruebas, no el código.
- Al pedir «ver mi pedido» desde el paso de la nota, el botón «Confirmar pedido» no hacía nada (el paso no volvía al menú). Corregido.
- Una de las pruebas de WhatsApp afirmaba una lista donde correspondían 3 botones. Corregida la prueba.
- Prueba rota a propósito del chequeo de «botón viejo» en `core.js`: ninguna prueba la detectó porque cada paso ya valida su estado. Queda como segunda defensa sin prueba propia.

## NO probado
- **Ninguna conversación real** con Telegram ni con WhatsApp (necesitan tokens y cuentas del cliente). En el Worker local las llamadas de salida fallaron a propósito (sin internet) y el bot siguió respondiendo 200 y guardando el pedido.
- Que el formato de los mensajes de WhatsApp (botones y listas) lo acepte Meta tal cual: se armó según la documentación conocida, sin comprobarla contra la página oficial hoy. La versión de la API (`WA_API_VERSION`) hay que confirmarla.
- El Worker **publicado** en Cloudflare, `wrangler deploy`, la base D1 remota y el registro real de los webhooks.
- Si Cloudflare pide tarjeta para D1 en cuenta gratis, y los topes diarios con tráfico real.
- La tarifa de WhatsApp en Colombia y si Meta pide tarjeta o verificación del negocio.
- Que una persona lea los textos y los encuentre claros (solo se probó que funcionen).
- **La guía del ensayo** (`docs/GUIA-PILOTO-TELEGRAM.md`): los pasos con Cloudflare (`login`, `d1 create`, `deploy`, `secret put`) y con BotFather no se ejecutaron en una cuenta real; están escritos de memoria. **No se probó en Windows** (el computador del ensayo): ni la instalación de Node (con instalador o con el zip sin permisos), ni `cmd`, ni la entrada escondida del token, ni el bloqueo de PowerShell que se menciona; tampoco en Mac.
- **La hoja de verdad:** no se desplegó el Apps Script en Google ni se llamó desde el Worker. Se probó con un Google de mentira. No se comprobó que `fetch` siga bien la redirección que responde Apps Script a un POST, ni que los pasos del README coincidan con la pantalla de Google de hoy (se escribieron de memoria).
- Los topes de Apps Script con tráfico real (tiempo por ejecución, bloqueo) y qué pasa con una hoja de miles de filas (se busca el pedido recorriendo la columna).
- `gitleaks`: no se pudo instalar en el entorno; se hizo búsqueda manual de patrones de claves y de comandos de riesgo (0 hallazgos). Falta correr `gitleaks`.
- Windows y macOS: solo se probó en Linux.
