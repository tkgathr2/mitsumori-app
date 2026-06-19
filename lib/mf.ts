// MFクラウド請求書 連携（フェーズ2で実装）
// フェーズ1ではインターフェイスのみ用意したstub。

import { QuoteLine, QuoteTotals } from "./quote";

export interface MfQuotePayload {
  companyName: string;
  lines: QuoteLine[];
  totals: QuoteTotals;
}

export interface MfQuoteResult {
  ok: boolean;
  stub: boolean;
  message: string;
}

// フェーズ2で MFクラウド請求書 公式API（見積書作成）に置き換える。
export async function createMfQuote(
  _payload: MfQuotePayload
): Promise<MfQuoteResult> {
  return {
    ok: false,
    stub: true,
    message:
      "MFクラウド請求書への見積書作成は フェーズ2で連携予定です（公式API・OAuth）。現在は金額計算まで動作します。",
  };
}
