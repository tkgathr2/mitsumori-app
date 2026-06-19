// MFクラウド請求書 公式API v3 クライアント（見積書・取引先）。
// API仕様: https://invoice.moneyforward.com/docs/api/v3/
// 基底URL: https://invoice.moneyforward.com/api/v3/
// 認証: Bearer access_token（スコープ mfc/invoice/data.write）

import { getValidAccessToken } from "./mf-oauth";

export const MF_API_BASE = "https://invoice.moneyforward.com/api/v3";

// 消費税区分（excise）。当アプリは10%固定（交通誘導警備の役務）。
export type MfExcise =
  | "untaxable"
  | "non_taxable"
  | "tax_exemption"
  | "five_percent"
  | "eight_percent"
  | "eight_percent_as_reduced_tax_rate"
  | "ten_percent";

export interface MfDepartment {
  id: string;
  name?: string;
}

export interface MfPartner {
  id: string;
  name: string;
  code?: string;
  departments?: MfDepartment[];
}

export interface MfQuoteItemInput {
  name: string;
  detail?: string;
  unit?: string;
  price: number;
  quantity: number;
  excise: MfExcise;
}

export interface MfQuoteCreateInput {
  department_id: string;
  quote_date: string; // YYYY-MM-DD
  expired_date: string; // YYYY-MM-DD
  title?: string;
  memo?: string;
  note?: string;
  items: MfQuoteItemInput[];
}

export interface MfQuote {
  id: string;
  pdf_url?: string;
  quote_number?: string;
  partner_name?: string;
  title?: string;
  quote_date?: string;
  expired_date?: string;
  // その他のフィールドは省略
  [k: string]: unknown;
}

async function mfFetch(
  path: string,
  init: RequestInit & { accessToken?: string } = {}
): Promise<Response> {
  const token = init.accessToken || (await getValidAccessToken());
  if (!token) {
    throw new Error(
      "MF未連携です。/api/mf-auth から認可（OAuth）を完了してください。"
    );
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body) headers["Content-Type"] = "application/json";
  return fetch(`${MF_API_BASE}${path}`, { ...init, headers });
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return `${res.status} ${text.slice(0, 500)}`;
}

// 取引先を名前で検索（完全一致優先）
export async function findPartnerByName(
  name: string,
  accessToken?: string
): Promise<MfPartner | null> {
  const res = await mfFetch(
    `/partners?name=${encodeURIComponent(name)}`,
    { method: "GET", accessToken }
  );
  if (!res.ok) {
    throw new Error(`取引先検索に失敗: ${await readError(res)}`);
  }
  const json = (await res.json()) as { data?: MfPartner[] };
  const list = json.data || [];
  if (list.length === 0) return null;
  const exact = list.find((p) => p.name === name);
  return exact || list[0];
}

// 取引先を作成（部門を1つ持たせる。部門IDが見積書のdepartment_idになる）
export async function createPartner(
  name: string,
  accessToken?: string
): Promise<MfPartner> {
  const body = {
    name,
    // 部門は最低1つ。住所等は任意（後でMF画面から補完可能）。
    departments: [{ person_name: name }],
  };
  const res = await mfFetch(`/partners`, {
    method: "POST",
    body: JSON.stringify(body),
    accessToken,
  });
  if (!res.ok) {
    throw new Error(`取引先作成に失敗: ${await readError(res)}`);
  }
  return (await res.json()) as MfPartner;
}

// 取引先を「検索 → 無ければ作成」して、見積書に使う department_id を返す。
export async function ensurePartnerDepartment(
  name: string,
  accessToken?: string
): Promise<{ partner: MfPartner; departmentId: string }> {
  let partner = await findPartnerByName(name, accessToken);
  if (!partner) {
    partner = await createPartner(name, accessToken);
  }
  const dept = partner.departments?.[0];
  if (!dept?.id) {
    throw new Error(
      `取引先「${name}」に部門IDがありません（department_idを特定できません）`
    );
  }
  return { partner, departmentId: dept.id };
}

// 見積書を作成。レスポンスに pdf_url と quote_number が含まれる。
export async function createQuote(
  input: MfQuoteCreateInput,
  accessToken?: string
): Promise<MfQuote> {
  const res = await mfFetch(`/quotes`, {
    method: "POST",
    body: JSON.stringify(input),
    accessToken,
  });
  if (!res.ok) {
    throw new Error(`見積書作成に失敗: ${await readError(res)}`);
  }
  return (await res.json()) as MfQuote;
}

// 見積書を取得（pdf_url等の確認用）
export async function getQuote(
  quoteId: string,
  accessToken?: string
): Promise<MfQuote> {
  const res = await mfFetch(`/quotes/${encodeURIComponent(quoteId)}`, {
    method: "GET",
    accessToken,
  });
  if (!res.ok) {
    throw new Error(`見積書取得に失敗: ${await readError(res)}`);
  }
  return (await res.json()) as MfQuote;
}

// 見積書のPDF URL。作成レスポンスの pdf_url をそのまま使えるが、
// 明示的に組み立てる場合はこの形式: /api/v3/quotes/{id}.pdf
export function quotePdfUrl(quoteId: string): string {
  return `${MF_API_BASE}/quotes/${encodeURIComponent(quoteId)}.pdf`;
}

// 見積書を削除（テスト用クリーンアップ）
export async function deleteQuote(
  quoteId: string,
  accessToken?: string
): Promise<void> {
  const res = await mfFetch(`/quotes/${encodeURIComponent(quoteId)}`, {
    method: "DELETE",
    accessToken,
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`見積書削除に失敗: ${await readError(res)}`);
  }
}
