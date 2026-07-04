// 見積計算エンジン（消費税10%）

export interface QuoteLine {
  // 表示用の品目名
  name: string;
  // 単価（円）
  unitPrice: number;
  // 単位（人日 / 時間 / 式 / 日 など）
  unit: string;
  // 数量＝人数 × 日数（人日の場合）。自由入力行は qty を直接使う。
  // 警備行: people × days、自由行: qty
  people?: number;
  days?: number;
  qty?: number;
}

export interface QuoteTotals {
  subtotal: number; // 小計（税抜）
  tax: number; // 消費税（10%）
  total: number; // 合計（税込）
}

export const TAX_RATE = 0.1;

// 手動上書き単価があればそれを優先し、なければ自動計算単価を使う。
// overridePrice が undefined/null/NaN の場合は自動単価にフォールバックする。
export function resolveUnitPrice(
  autoPrice: number,
  overridePrice?: number | null
): number {
  if (overridePrice != null && !Number.isNaN(overridePrice)) {
    return overridePrice;
  }
  return autoPrice;
}

// 1行の数量を求める
export function lineQuantity(line: QuoteLine): number {
  if (line.people != null || line.days != null) {
    const p = Number(line.people) || 0;
    const d = Number(line.days) || 0;
    return p * d;
  }
  return Number(line.qty) || 0;
}

// 1行の金額（税抜）
export function lineAmount(line: QuoteLine): number {
  const qty = lineQuantity(line);
  const price = Number(line.unitPrice) || 0;
  return Math.round(qty * price);
}

// 合計を計算（小計・消費税・合計）
export function calcTotals(lines: QuoteLine[]): QuoteTotals {
  const subtotal = lines.reduce((sum, l) => sum + lineAmount(l), 0);
  const tax = Math.floor(subtotal * TAX_RATE);
  const total = subtotal + tax;
  return { subtotal, tax, total };
}

// 金額を「¥1,234」形式に
export function yen(n: number): string {
  return "¥" + (Math.round(n) || 0).toLocaleString("ja-JP");
}
