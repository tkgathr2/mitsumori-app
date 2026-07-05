// 管理画面 /admin のステートレスなセッション認証。
//   ・ログイン成功時に cookie 値 = HMAC-SHA256(固定payload, secret) を発行。
//   ・検証は cookie 値を再計算して定数時間比較するだけ（DBセッション不要）。
// secret は ADMIN_SESSION_SECRET があればそれ、無ければ ADMIN_PASSWORD 由来。
//
// Web Crypto（globalThis.crypto.subtle）で実装する。理由：middleware.ts は
// Edge Runtime で動き node:crypto を使えないため。Edge / Node / vitest すべてで
// 同じコードが動く（Node 20+ には global crypto がある）。

export const ADMIN_COOKIE = "mitsumori_admin";
// cookie に署名する固定ペイロード（バージョンを含める＝secret変更で自動失効）。
const SESSION_PAYLOAD = "admin:v1";

export function adminSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const s = env.ADMIN_SESSION_SECRET;
  if (s && s.trim()) return s;
  const pw = env.ADMIN_PASSWORD;
  if (pw && pw.trim()) return `session:${pw}`;
  return null;
}

// パスワードが設定済みか（未設定なら管理機能を無効＝誰も入れない）。
export function adminPasswordConfigured(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return Boolean(env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.trim());
}

// 定数時間比較（長さが違えば false）。分岐タイミングを値内容に依存させない。
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// 入力パスワードが一致するか（定数時間）。
export function verifyPassword(
  input: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const pw = env.ADMIN_PASSWORD;
  if (!pw || !pw.trim()) return false;
  return timingSafeEqualStr(String(input), pw);
}

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

// セッションcookieの署名値を作る（HMAC-SHA256 → hex）。
export async function makeSessionToken(
  env: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
  const secret = adminSecret(env);
  if (!secret) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(SESSION_PAYLOAD));
  return toHex(sig);
}

// cookie 値が正しい署名かどうか（定数時間）。
export async function verifySessionToken(
  token: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  if (!token) return false;
  const expected = await makeSessionToken(env);
  if (!expected) return false;
  return timingSafeEqualStr(token, expected);
}
