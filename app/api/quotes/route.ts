import { type NextRequest, NextResponse } from "next/server";
import { saveQuote, listQuotesByCompany } from "@/lib/price-admin-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/quotes?company=<code> … その会社の過去見積（直近5種類）
export async function GET(req: NextRequest): Promise<NextResponse> {
  const company = req.nextUrl.searchParams.get("company");
  if (!company) {
    return NextResponse.json({ error: "company is required" }, { status: 400 });
  }
  try {
    const quotes = await listQuotesByCompany(company, 5);
    return NextResponse.json({ quotes });
  } catch (e) {
    return NextResponse.json(
      { error: "見積履歴の取得に失敗しました", detail: String(e) },
      { status: 500 }
    );
  }
}

// POST /api/quotes { companyCode, name, quoteData } … 見積を保存
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { companyCode?: string; name?: string; quoteData?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.companyCode || body.quoteData === undefined) {
    return NextResponse.json(
      { error: "companyCode and quoteData are required" },
      { status: 400 }
    );
  }
  try {
    const quote = await saveQuote(body.companyCode, body.name ?? "", body.quoteData);
    return NextResponse.json({ ok: true, quote });
  } catch (e) {
    return NextResponse.json(
      { error: "見積の保存に失敗しました", detail: String(e) },
      { status: 500 }
    );
  }
}
