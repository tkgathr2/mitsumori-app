import "server-only";
import { type Company, type PriceData, snapshotData } from "./prices";

// このモジュールはサーバ専用。
//
// 【単価の正は管理画面（price_companies）だけ】2026-07-17 社長決定により
// スプレッドシートとの通信は全経路を撤去した（SA直読み／price_cache／公開CSV／GAS受け口）。
// 単価が取れなかった場合はスナップショットへ落とさず「空」を返す。
// スナップショットの会社単価は残業単価が0円で、フォールバックに使うと
// 間違った金額が静かに客先へ出るため。出さない方が安全という設計判断。

// ---- メモリキャッシュ（60秒） ----
let cache: { data: PriceData; at: number } | null = null;
const CACHE_MS = 60_000;

// 管理画面の単価マスタ（price_companies）から会社を読む。
// DB未設定・接続失敗時は空配列（＝画面側で「取得できません」を出す）。
async function loadFromAdminDb(): Promise<Company[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const { loadCompaniesForPriceData } = await import("./price-admin-db");
    return await loadCompaniesForPriceData();
  } catch {
    return [];
  }
}

// 単価データを返す。会社は price_companies のみ、資器材等のメタは静的スナップショット。
export async function getPriceData(): Promise<PriceData> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  const companies = await loadFromAdminDb();
  const meta = snapshotData();
  const data: PriceData = {
    source:
      companies.length > 0
        ? "管理画面の単価マスタ (price_companies)"
        : "単価を取得できませんでした",
    capturedAt: meta.capturedAt,
    fetchedAt: new Date().toISOString(),
    equipment: meta.equipment,
    companies,
  };

  // 空（DB未設定・接続失敗）はキャッシュしない。
  // 一時的なDB断を60秒引きずらず、次のリクエストで復帰できるようにする。
  if (companies.length > 0) cache = { data, at: Date.now() };
  return data;
}
