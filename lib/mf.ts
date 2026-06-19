// MFクラウド請求書 連携（フェーズ2・実装済み）。
// UIから来た見積データ（会社名・明細）を MFクラウド請求書 公式API v3 の
// 見積書（quotes）に変換して作成する。

import { QuoteLine, QuoteTotals, lineQuantity, lineAmount } from "./quote";
import {
  createQuote,
  ensurePartnerDepartment,
  type MfQuoteItemInput,
} from "./mf-client";
import { getValidAccessToken, oauthConfigured } from "./mf-oauth";

export interface MfQuotePayload {
  companyName: string;
  lines: QuoteLine[];
  totals: QuoteTotals;
  // 任意：件名・取引先名。未指定なら companyName を取引先名に使う。
  title?: string;
  partnerName?: string;
}

export interface MfQuoteResult {
  ok: boolean;
  stub?: boolean;
  message: string;
  // 成功時
  quoteId?: string;
  quoteNumber?: string;
  pdfUrl?: string;
  partnerName?: string;
}

// YYYY-MM-DD（ローカルではなくJST固定で日付を作る）
function ymd(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

// UIの1行 → MFの見積明細1件。数量は people×days もしくは qty。
function toMfItem(line: QuoteLine): MfQuoteItemInput {
  const quantity = lineQuantity(line);
  // price×quantity が金額。MF側でも price×quantity で計算されるため、
  // 1行=単価×数量で素直に渡す。
  return {
    name: line.name || "（明細）",
    unit: line.unit || undefined,
    price: Number(line.unitPrice) || 0,
    quantity,
    excise: "ten_percent", // 交通誘導警備の役務 → 10%
  };
}

export async function createMfQuote(
  payload: MfQuotePayload
): Promise<MfQuoteResult> {
  // 設定チェック（OAuthアプリの鍵が無ければstub応答で安全に返す）
  if (!oauthConfigured()) {
    return {
      ok: false,
      stub: true,
      message:
        "MF連携の設定（MF_CLIENT_ID / MF_CLIENT_SECRET）が未設定です。金額計算までは動作します。",
    };
  }

  // 連携トークンの有無（未連携ならOAuthへ誘導）
  const token = await getValidAccessToken();
  if (!token) {
    return {
      ok: false,
      stub: true,
      message:
        "MFとの連携（認可）が未完了です。/api/mf-auth を開いて連携を完了してください。",
    };
  }

  const items = (payload.lines || [])
    .filter((l) => lineAmount(l) !== 0 || lineQuantity(l) !== 0)
    .map(toMfItem);

  if (items.length === 0) {
    return { ok: false, message: "明細が空です。金額のある行を入れてください。" };
  }

  const partnerName =
    (payload.partnerName || payload.companyName || "").trim() || "（取引先未設定）";

  try {
    // 取引先（部門）を用意して department_id を得る
    const { departmentId } = await ensurePartnerDepartment(partnerName, token);

    const today = new Date();
    const expired = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000); // 有効期限30日

    const quote = await createQuote(
      {
        department_id: departmentId,
        quote_date: ymd(today),
        expired_date: ymd(expired),
        title: payload.title || "御見積書",
        items,
      },
      token
    );

    return {
      ok: true,
      message: `見積書を作成しました（番号: ${quote.quote_number ?? quote.id}）`,
      quoteId: quote.id,
      quoteNumber: quote.quote_number,
      pdfUrl: quote.pdf_url,
      partnerName,
    };
  } catch (e) {
    return {
      ok: false,
      message: `MF見積書の作成に失敗しました: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
}
