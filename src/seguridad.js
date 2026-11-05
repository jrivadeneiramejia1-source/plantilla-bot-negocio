const enc = new TextEncoder();

// Comparación que tarda lo mismo aunque el texto difiera pronto (evita adivinar la clave letra por letra).
export function igualesSeguro(a, b) {
  const x = enc.encode(String(a ?? ""));
  const y = enc.encode(String(b ?? ""));
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

export async function hmacSha256Hex(secreto, bytes) {
  const llave = await crypto.subtle.importKey("raw", enc.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign("HMAC", llave, bytes);
  return [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
