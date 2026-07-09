// 管理画面 /admin のステートレスなセッション認証（ユーザー別）。
//   ・ユーザー定義は env ADMIN_USERS_JSON = {"takagi":"pw1","nishimura":"pw2"}
//     （未設定時は旧 ADMIN_PASSWORD を user="admin" として扱う後方互換）
//   ・ログイン成功時に cookie 値 = "<user>.<HMAC-SHA256("admin:v2:"+user, secret)>" を発行。
//   ・検証は cookie 値を再計算して定数時間比較するだけ（DBセッション不要）。
//     ユーザー名が取れるので変更履歴 changed_by に誰が変えたかを記録できる。
// secret は ADMIN_SESSION_SECRET があればそれ、無ければユーザー定義由来
// （＝パスワード変更で既存セッションが自動失効する）。
//
// Web Crypto（globalThis.crypto.subtle）で実装する。理由：middleware.ts は
// Edge Runtime で動き node:crypto を使えないため。Edge / Node / vitest すべてで
// 同じコードが動く（Node 20+ には global crypto がある）。

export const ADMIN_COOKIE = "mitsumori_admin";
// cookie 署名ペイロードの接頭辞（バージョンを含める＝形式変更で自動失効）。
const SESSION_PAYLOAD_PREFIX = "admin:v2:";

// cookie 値のパースを安全にするため、ユーザー名は英小文字・数字・-_ のみ。
const USERNAME_RE = /^[a-z0-9_-]{1,32}$/;

// 管理ユーザー一覧 { user: password }。
export function adminUsers(
  env: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const raw = env.ADMIN_USERS_JSON;
  if (raw && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const users: Record<string, string> = {};
      for (const [user, pw] of Object.entries(parsed)) {
        if (USERNAME_RE.test(user) && typeof pw === "string" && pw.trim()) {
          users[user] = pw;
        }
      }
      return users;
    } catch {
      // 壊れた JSON は「管理機能停止（誰も入れない）」に倒す。
      return {};
    }
  }
  const pw = env.ADMIN_PASSWORD;
  if (pw && pw.trim()) return { admin: pw };
  return {};
}

// 管理ユーザーが1人でも設定済みか（未設定なら管理機能を無効＝誰も入れない）。
export function adminConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Object.keys(adminUsers(env)).length > 0;
}

export function adminSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const s = env.ADMIN_SESSION_SECRET;
  if (s && s.trim()) return s;
  const usersJson = env.ADMIN_USERS_JSON;
  if (usersJson && usersJson.trim()) return `session:${usersJson}`;
  const pw = env.ADMIN_PASSWORD;
  if (pw && pw.trim()) return `session:${pw}`;
  return null;
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

// 指定ユーザーのパスワードが一致するか（定数時間）。
export function verifyPassword(
  user: string,
  input: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const pw = adminUsers(env)[user];
  if (!pw) return false;
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

async function hmacHex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return toHex(sig);
}

// セッションcookie値を作る： "<user>.<HMAC-SHA256 hex>"。
export async function makeSessionToken(
  user: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
  const secret = adminSecret(env);
  if (!secret) return null;
  if (!USERNAME_RE.test(user) || !adminUsers(env)[user]) return null;
  const sig = await hmacHex(secret, SESSION_PAYLOAD_PREFIX + user);
  return `${user}.${sig}`;
}

// cookie 値が正しければユーザー名を返し、無効なら null（定数時間比較）。
export async function verifySessionToken(
  token: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const user = token.slice(0, dot);
  if (!USERNAME_RE.test(user)) return null;
  const expected = await makeSessionToken(user, env);
  if (!expected) return null;
  return timingSafeEqualStr(token, expected) ? user : null;
}
