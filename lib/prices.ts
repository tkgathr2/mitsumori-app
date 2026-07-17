import snapshot from "@/data/prices-snapshot.json";

// ---- 型定義 ----
// 区分キー（昼/夜/法定休日 × 一般/有資格 ＋ それぞれの残業）
export type RateKey =
  | "ippan_day"
  | "ippan_day_ot"
  | "ippan_night"
  | "ippan_night_ot"
  | "ippan_holiday"
  | "ippan_holiday_ot"
  | "yushi_day"
  | "yushi_day_ot"
  | "yushi_night"
  | "yushi_night_ot"
  | "yushi_holiday"
  | "yushi_holiday_ot";

export interface RateMeta {
  key: RateKey;
  label: string; // 画面表示用の区分名
  unit: string; // 人日 / 時間
}

// 区分の表示順とラベル（人日＝1名×1日、残業＝時間）
export const RATE_DEFS: RateMeta[] = [
  { key: "ippan_day", label: "一般警備員（昼・基本）", unit: "人日" },
  { key: "ippan_day_ot", label: "一般警備員（昼・残業/時）", unit: "時間" },
  { key: "ippan_night", label: "一般警備員（夜勤）", unit: "人日" },
  { key: "ippan_night_ot", label: "一般警備員（夜勤・残業/時）", unit: "時間" },
  { key: "ippan_holiday", label: "一般警備員（法定休日）", unit: "人日" },
  { key: "ippan_holiday_ot", label: "一般警備員（法定休日・残業/時）", unit: "時間" },
  { key: "yushi_day", label: "有資格警備員（昼・基本）", unit: "人日" },
  { key: "yushi_day_ot", label: "有資格警備員（昼・残業/時）", unit: "時間" },
  { key: "yushi_night", label: "有資格警備員（夜勤）", unit: "人日" },
  { key: "yushi_night_ot", label: "有資格警備員（夜勤・残業/時）", unit: "時間" },
  { key: "yushi_holiday", label: "有資格警備員（法定休日）", unit: "人日" },
  { key: "yushi_holiday_ot", label: "有資格警備員（法定休日・残業/時）", unit: "時間" },
];

export interface Company {
  code: string;
  name: string;
  prices: Record<RateKey, number>;
  hasPrice: boolean;
}

export interface EquipmentItem {
  name: string;
  unit: string;
  price: number;
}

export interface PriceData {
  // 単価の出どころ（画面表示用）。単価の正は管理画面（price_companies）のみ。
  source: string;
  // 資器材スナップショット（data/prices-snapshot.json）の取得日
  capturedAt: string;
  fetchedAt: string;
  equipment: EquipmentItem[];
  companies: Company[];
}

// 静的ファイル（data/prices-snapshot.json）由来のメタ情報。
// 資器材（カラーコーン等）はここが供給元＝シート通信ではない。
//
// 【companies を返さない理由】スナップショットの会社単価は残業単価が0円で、
// フォールバックとして使うと「間違った金額が静かに客先へ出る」。
// 単価の正は管理画面（price_companies）だけなので、型の時点で会社を持たせない。
export interface SnapshotMeta {
  capturedAt: string;
  equipment: EquipmentItem[];
}

export function snapshotData(): SnapshotMeta {
  const s = snapshot as unknown as {
    capturedAt: string;
    equipment: EquipmentItem[];
  };
  return {
    capturedAt: s.capturedAt,
    equipment: s.equipment,
  };
}

// 会社一覧（単価が入っている会社を先頭に）
export function sortCompanies(companies: Company[]): Company[] {
  return [...companies].sort((a, b) => {
    if (a.hasPrice !== b.hasPrice) return a.hasPrice ? -1 : 1;
    return a.name.localeCompare(b.name, "ja");
  });
}
