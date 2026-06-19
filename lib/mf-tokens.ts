// MFクラウド請求書 OAuth トークンの保存・読み出し。
//
// 保存先は2層のフォールバック構成：
//   1) Vercel KV (@vercel/kv) … KV_REST_API_URL / KV_REST_API_TOKEN が設定されていれば使う。
//      access_token と refresh_token を1組だけ（事業者=日本交通誘導の共有トークン）保存する。
//   2) 環境変数 MF_REFRESH_TOKEN … KVが無い/壊れている場合のブートストラップ用。
//      初回のOAuth完了時に発行された refresh_token を Vercel env に入れておけば、
//      KVが空でもここから復元して access_token を再取得できる。
//
// refresh_token は18か月有効だが「使うと新しいトークンに置き換わる」ため、
// 更新のたびにKVへ書き戻す。月1回のヘルスチェックで失効を防ぐ（README参照）。

export interface MfTokenRecord {
  access_token: string;
  refresh_token: string;
  // access_token の失効時刻（epoch ミリ秒）
  access_expires_at: number;
  // 最後に更新した時刻（epoch ミリ秒）
  updated_at: number;
}

const KV_KEY = "mf:tokens:nihonkotsuyudo";

function kvConfigured(): boolean {
  return Boolean(
    process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
  );
}

// @vercel/kv を動的importする（KV未設定の環境でビルド/起動を壊さないため）。
async function getKv() {
  const mod = await import("@vercel/kv");
  return mod.kv;
}

export async function loadTokens(): Promise<MfTokenRecord | null> {
  if (kvConfigured()) {
    try {
      const kv = await getKv();
      const rec = (await kv.get<MfTokenRecord>(KV_KEY)) || null;
      if (rec && rec.refresh_token) return rec;
    } catch (e) {
      // KV読み出し失敗時は env フォールバックへ
      console.error("[mf-tokens] KV load failed:", e);
    }
  }
  // ブートストラップ：env の refresh_token から最小レコードを組む
  const envRefresh = process.env.MF_REFRESH_TOKEN;
  if (envRefresh) {
    return {
      access_token: "",
      refresh_token: envRefresh,
      access_expires_at: 0, // 期限切れ扱い → 必ずrefreshさせる
      updated_at: 0,
    };
  }
  return null;
}

export async function saveTokens(rec: MfTokenRecord): Promise<void> {
  if (kvConfigured()) {
    try {
      const kv = await getKv();
      await kv.set(KV_KEY, rec);
      return;
    } catch (e) {
      console.error("[mf-tokens] KV save failed:", e);
    }
  }
  // KVが無い場合は保存できない（envは実行時に書き換えられない）。
  // 初回のOAuth完了時はトークンを返り値でも返すので、運用者がenvに転記できる。
}

export function isKvConfigured(): boolean {
  return kvConfigured();
}
