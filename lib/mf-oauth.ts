// MFクラウド請求書 OAuth2（認可コードフロー）ヘルパ。
// 認可サーバー API: https://developers.biz.moneyforward.com/docs/api/auth
//
// - 認可エンドポイント: https://api.biz.moneyforward.com/authorize
// - トークンエンドポイント: https://api.biz.moneyforward.com/token (application/x-www-form-urlencoded)
// - access_token 有効期間: 1時間 / refresh_token 有効期間: 18か月
// - スコープ: mfc/invoice/data.write（見積書の作成に必要）
// - クライアント認証方式: CLIENT_SECRET_BASIC（Basic認証ヘッダで client_id:client_secret を送る）

import {
  loadTokens,
  saveTokens,
  type MfTokenRecord,
} from "./mf-tokens";

export const MF_AUTH_BASE = "https://api.biz.moneyforward.com";
export const MF_AUTHORIZE_URL = `${MF_AUTH_BASE}/authorize`;
export const MF_TOKEN_URL = `${MF_AUTH_BASE}/token`;
export const MF_SCOPE = "mfc/invoice/data.write";

// access_token を更新する余裕（失効60秒前には更新する）
const EXPIRY_SKEW_MS = 60 * 1000;

export interface MfOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getOAuthConfig(): MfOAuthConfig {
  const clientId = process.env.MF_CLIENT_ID || "";
  const clientSecret = process.env.MF_CLIENT_SECRET || "";
  // 明示設定が無ければ実行中のホストから推測（本番/localhost両対応）
  const redirectUri =
    process.env.MF_REDIRECT_URI ||
    "https://mitsumori.takagi.bz/api/mf-callback";
  return { clientId, clientSecret, redirectUri };
}

export function oauthConfigured(): boolean {
  const { clientId, clientSecret } = getOAuthConfig();
  return Boolean(clientId && clientSecret);
}

// 認可画面へ飛ばすURLを組み立てる
export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const u = new URL(MF_AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("scope", MF_SCOPE);
  u.searchParams.set("state", opts.state);
  return u.toString();
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  const raw = `${clientId}:${clientSecret}`;
  const b64 =
    typeof btoa === "function"
      ? btoa(raw)
      : Buffer.from(raw, "utf-8").toString("base64");
  return `Basic ${b64}`;
}

interface MfTokenResponse {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  token_type: string;
  expires_in?: number;
}

function toRecord(
  res: MfTokenResponse,
  prevRefresh?: string
): MfTokenRecord {
  const expiresInMs = (res.expires_in ?? 3600) * 1000;
  return {
    access_token: res.access_token,
    // refresh_token が返らない場合は前の値を維持
    refresh_token: res.refresh_token || prevRefresh || "",
    access_expires_at: Date.now() + expiresInMs,
    updated_at: Date.now(),
  };
}

// 認可コード → トークン交換。成功時はトークンを保存し、レコードを返す。
export async function exchangeCodeForTokens(
  code: string
): Promise<MfTokenRecord> {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch(MF_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: basicAuthHeader(clientId, clientSecret),
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `MF token exchange failed: ${res.status} ${text.slice(0, 300)}`
    );
  }
  const json = (await res.json()) as MfTokenResponse;
  const rec = toRecord(json);
  await saveTokens(rec);
  return rec;
}

// refresh_token で access_token を再発行。新しいトークン組を保存する。
export async function refreshTokens(
  refreshToken: string
): Promise<MfTokenRecord> {
  const { clientId, clientSecret } = getOAuthConfig();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch(MF_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: basicAuthHeader(clientId, clientSecret),
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `MF token refresh failed: ${res.status} ${text.slice(0, 300)}`
    );
  }
  const json = (await res.json()) as MfTokenResponse;
  const rec = toRecord(json, refreshToken);
  await saveTokens(rec);
  return rec;
}

// 有効な access_token を返す。期限切れなら自動でrefreshする。
// トークンが1つも無い場合は null（=未連携。OAuthを最初に通す必要あり）。
export async function getValidAccessToken(): Promise<string | null> {
  const rec = await loadTokens();
  if (!rec || !rec.refresh_token) return null;

  const stillValid =
    rec.access_token &&
    rec.access_expires_at - EXPIRY_SKEW_MS > Date.now();
  if (stillValid) return rec.access_token;

  // access_token が無い/期限切れ → refresh
  const refreshed = await refreshTokens(rec.refresh_token);
  return refreshed.access_token || null;
}
