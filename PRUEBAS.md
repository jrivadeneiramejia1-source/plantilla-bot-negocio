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

Total: 26 pruebas automáticas, todas pasan.

## Errores encontrados al probar
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
- Copia a Google Sheets: todavía no existe (siguiente ronda).
- `gitleaks`: no se pudo instalar en el entorno; se hizo búsqueda manual de patrones de claves y de comandos de riesgo (0 hallazgos). Falta correr `gitleaks`.
- Windows y macOS: solo se probó en Linux.
