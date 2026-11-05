import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";

const SCRIPT = new URL("../scripts/telegram.mjs", import.meta.url).pathname;
const TOKEN = "000000000:INVENTADO_SOLO_PARA_PRUEBAS_00000"; // claramente falso
const CLAVE = "clave_inventada_para_pruebas_1234567890abcdef";

// Telegram de mentira: guarda cada llamada y responde lo que diga `respuestas[metodo]`.
async function conTelegram(respuestas, fn) {
  const llamadas = [];
  const srv = http.createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (d) => (cuerpo += d));
    req.on("end", () => {
      const [, token, metodo] = req.url.match(/^\/bot([^/]+)\/(\w+)$/) ?? [];
      llamadas.push({ token, metodo, cuerpo: cuerpo ? JSON.parse(cuerpo) : null });
      const r = respuestas[metodo] ?? { ok: true, result: true };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(r));
    });
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  try {
    return await fn(`http://127.0.0.1:${srv.address().port}`, llamadas);
  } finally {
    srv.close();
  }
}

function correr(orden, entrada, base, extraEnv = {}) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [SCRIPT, ...(orden ? [orden] : [])], { env: { ...process.env, TELEGRAM_API_BASE: base, ...extraEnv } });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => ok({ code, out, err, todo: out + err }));
    p.stdin.end(entrada.join("\n") + "\n");
  });
}
const sinSecretos = (r) => {
  assert.ok(!r.todo.includes(TOKEN), "el token apareció en pantalla");
  assert.ok(!r.todo.includes(TOKEN.split(":")[1]), "parte del token apareció en pantalla");
  assert.ok(!r.todo.includes(CLAVE), "la clave apareció en pantalla");
};

test("clave: inventa una clave distinta cada vez, de 48 letras y números", async () => {
  const a = await correr("clave", [], "https://api.telegram.org");
  const b = await correr("clave", [], "https://api.telegram.org");
  const ca = a.out.split("\n")[0], cb = b.out.split("\n")[0];
  assert.match(ca, /^[0-9a-f]{48}$/);
  assert.notEqual(ca, cb);
  assert.equal(a.code, 0);
});

test("registrar: conecta con la dirección /telegram, la clave y los tipos de mensajes, sin mostrar secretos", async () => {
  await conTelegram({ getMe: { ok: true, result: { username: "bot_inventado" } } }, async (base, llamadas) => {
    const r = await correr("registrar", [TOKEN, CLAVE, "https://bot-negocio.ejemplo.workers.dev/"], base);
    assert.equal(r.code, 0, r.todo);
    assert.match(r.out, /@bot_inventado/);
    assert.match(r.out, /bot-negocio\.ejemplo\.workers\.dev\/telegram/);
    const set = llamadas.find((l) => l.metodo === "setWebhook");
    assert.equal(set.token, TOKEN);
    assert.deepEqual(set.cuerpo, {
      url: "https://bot-negocio.ejemplo.workers.dev/telegram",
      secret_token: CLAVE,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    });
    sinSecretos(r);
  });
});

test("registrar: no repite /telegram si ya viene en la dirección", async () => {
  await conTelegram({ getMe: { ok: true, result: { username: "b" } } }, async (base, llamadas) => {
    await correr("registrar", [TOKEN, CLAVE, "https://x.ejemplo.dev/telegram"], base);
    assert.equal(llamadas.find((l) => l.metodo === "setWebhook").cuerpo.url, "https://x.ejemplo.dev/telegram");
  });
});

test("registrar: rechaza token mal escrito, clave mala y direcciones sin https, sin tocar el webhook", async () => {
  await conTelegram({ getMe: { ok: true, result: { username: "b" } } }, async (base, llamadas) => {
    const casos = [
      [["no-es-un-token", CLAVE, "https://x.dev"], /no parece un token/],
      [[TOKEN, "corta", "https://x.dev"], /16 a 256/],
      [[TOKEN, "tiene espacios y ñ ñ ñ ñ ñ ñ ñ", "https://x.dev"], /16 a 256/],
      [[TOKEN, CLAVE, "http://x.dev"], /https/],
      [[TOKEN, CLAVE, "x.dev"], /https/],
    ];
    for (const [entrada, texto] of casos) {
      const r = await correr("registrar", entrada, base);
      assert.equal(r.code, 1);
      assert.match(r.err, texto);
      sinSecretos(r);
    }
    assert.ok(!llamadas.some((l) => l.metodo === "setWebhook"));
  });
});

test("registrar: si Telegram rechaza el token, lo dice sin mostrarlo", async () => {
  await conTelegram({ getMe: { ok: false, description: "Unauthorized" } }, async (base) => {
    const r = await correr("registrar", [TOKEN, CLAVE, "https://x.dev"], base);
    assert.equal(r.code, 1);
    assert.match(r.err, /Telegram dijo: Unauthorized/);
    sinSecretos(r);
  });
});

test("mi-id: muestra el número de quien escribió e ignora grupos y bots", async () => {
  const mensajes = [
    { message: { chat: { type: "group" }, from: { id: 1111 } } },
    { message: { chat: { type: "private" }, from: { id: 2222, is_bot: true } } },
    { message: { chat: { type: "private" }, from: { id: 5551234 } } },
  ];
  await conTelegram({ getWebhookInfo: { ok: true, result: { url: "" } }, getUpdates: { ok: true, result: mensajes } }, async (base) => {
    const r = await correr("mi-id", [TOKEN], base);
    assert.equal(r.code, 0, r.todo);
    assert.match(r.out, /5551234/);
    assert.ok(!r.out.includes("1111") && !r.out.includes("2222"));
    sinSecretos(r);
  });
});

test("mi-id: avisa si no hay mensajes o si el webhook ya está registrado", async () => {
  await conTelegram({ getWebhookInfo: { ok: true, result: { url: "" } }, getUpdates: { ok: true, result: [] } }, async (base) => {
    const r = await correr("mi-id", [TOKEN], base);
    assert.equal(r.code, 1);
    assert.match(r.err, /escríbele «hola»/);
  });
  await conTelegram({ getWebhookInfo: { ok: true, result: { url: "https://x.dev/telegram" } } }, async (base, llamadas) => {
    const r = await correr("mi-id", [TOKEN], base);
    assert.equal(r.code, 1);
    assert.match(r.err, /quitar/);
    assert.ok(!llamadas.some((l) => l.metodo === "getUpdates"), "no debe leer mensajes con webhook activo");
  });
});

test("estado: muestra pendientes y último error; quitar borra el webhook", async () => {
  const info = { url: "https://x.dev/telegram", pending_update_count: 3, last_error_message: "Wrong response from the webhook: 401 Unauthorized", last_error_date: 1793900000 };
  await conTelegram({ getWebhookInfo: { ok: true, result: info } }, async (base) => {
    const r = await correr("estado", [TOKEN], base);
    assert.equal(r.code, 0);
    assert.match(r.out, /esperando entrega: 3/);
    assert.match(r.out, /401 Unauthorized/);
    sinSecretos(r);
  });
  await conTelegram({}, async (base, llamadas) => {
    const r = await correr("quitar", [TOKEN], base);
    assert.equal(r.code, 0);
    assert.equal(llamadas.at(-1).metodo, "deleteWebhook");
  });
});

test("no acepta direcciones de Telegram que no sean este computador, ni órdenes desconocidas", async () => {
  const r = await correr("estado", [TOKEN], "https://evil.example.com");
  assert.equal(r.code, 2);
  assert.match(r.err, /este computador/);
  const s = await correr("inventada", [], "http://127.0.0.1:9");
  assert.equal(s.code, 2);
  assert.match(s.err, /Uso:/);
  const t = await correr("", [], "http://127.0.0.1:9");
  assert.equal(t.code, 2);
});

test("sin internet: mensaje claro, sin mostrar secretos", async () => {
  const r = await correr("estado", [TOKEN], "http://127.0.0.1:9"); // nadie escucha
  assert.equal(r.code, 1);
  assert.match(r.err, /No pude conectar/);
  sinSecretos(r);
});
