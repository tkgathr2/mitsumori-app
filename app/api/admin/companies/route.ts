import { type NextRequest, NextResponse } from "next/server";
import { createCompany, listCompanies } from "@/lib/price-admin-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 認証は middleware.ts が担う（/api/admin/* を保護）。
export async function GET(): Promise<NextResponse> {
  try {
    const companies = await listCompanies();
    return NextResponse.json({ companies });
  } catch (e) {
    return NextResponse.json(
      { error: "会社一覧の取得に失敗しました", detail: String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { code?: string; name?: string; note?: string; sortOrder?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "会社名は必須です" }, { status: 400 });
  }
  try {
    const company = await createCompany({
      code: body.code?.trim(),
      name,
      note: body.note?.trim(),
      sortOrder: body.sortOrder,
    });
    return NextResponse.json({ company }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: "会社の作成に失敗しました", detail: String(e) },
      { status: 500 }
    );
  }
}
