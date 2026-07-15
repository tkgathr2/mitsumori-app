// 見積もり画面（トップページ）のステートレスな一般利用者セッション認証。
//   ・許可条件：Google認証済みメールのドメインが ALLOWED_EMAIL_DOMAINS に含まれること
//     （env 未設定時は既定で "takagi.bz,stepupnext.com" を許可）
//   ・ログイン成功時に cookie 値 = "<email>.<HMAC-SHA256("user:v1:"+email, secret)>" を発行。
//   ・検証は cookie 値を再計算して定数時間比較するだけ（DBセッション不要）。
// secret は USER_SESSION_SECRET があればそれ、無ければ GOOGLE_CLIENT_SECRET 由来
// （＝どちらも未設定なら発行不可＝ゲートは有効だが誰も入れない安全側に倒す）。
//
// Web Crypto（globalThis.crypto.subtle）で実装する。middleware.ts は Edge Runtime で
// 動き node:crypto を使えないため、admin-auth.ts と同じ方式に揃える。

export const USER_COOKIE = "mitsumori_user";
const SESSION_PAYLOAD_PREFIX = "user:v1:";

// 見積もり画面は「ドメインなら誰でも」ではなく、個別に許可されたメールのみ通す
// （2026-07-15社長指示：高木・西村さんのみ。他は申請フローへ）。
function allowedEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.ALLOWED_USER_EMAILS;
  const list = raw && raw.trim() ? raw.split(",") : [];
  return list.map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function isAllowedEmail(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return allowedEmails(env).includes(email.toLowerCase());
}

// セッションの有効期間（cookieのmaxAgeと揃える＝30日）。トークン自体にも
// 発行時刻を埋め込み、cookieを書き換えて延命されてもサーバ側で期限切れにできるようにする。
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

function userSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const s = env.USER_SESSION_SECRET;
  if (s && s.trim()) return s;
  const gs = env.GOOGLE_CLIENT_SECRET;
  if (gs && gs.trim()) return `user-session:${gs}`;
  return null;
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

export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// email は cookie 値にそのまま載せるため、区切り文字 "." を含まない形（base64url）に変換する。
// middleware.ts は Edge Runtime で動き Buffer が無いため、btoa/atob ベースで実装する。
function encodeEmail(email: string): string {
  const bytes = new TextEncoder().encode(email);
  const bin = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function decodeEmail(enc: string): string | null {
  try {
    const padded = enc.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export async function makeUserSessionToken(
  email: string,
  env: NodeJS.ProcessEnv = process.env,
  issuedAt: number = Date.now()
): Promise<string | null> {
  const secret = userSecret(env);
  if (!secret) return null;
  if (!isAllowedEmail(email, env)) return null;
  const encoded = encodeEmail(email.toLowerCase());
  const sig = await hmacHex(secret, `${SESSION_PAYLOAD_PREFIX}${email.toLowerCase()}:${issuedAt}`);
  return `${encoded}.${issuedAt}.${sig}`;
}

// cookie 値が正しく・期限内（発行から30日以内）であればメールアドレスを返し、無効/期限切れなら null。
export async function verifyUserSessionToken(
  token: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encoded, issuedAtStr, sig] = parts;
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt)) return null;
  if (Date.now() - issuedAt > SESSION_MAX_AGE_MS) return null;
  const email = decodeEmail(encoded);
  if (!email) return null;
  const expected = await makeUserSessionToken(email, env, issuedAt);
  if (!expected) return null;
  return timingSafeEqualStr(`${encoded}.${issuedAtStr}.${sig}`, expected) ? email : null;
}
