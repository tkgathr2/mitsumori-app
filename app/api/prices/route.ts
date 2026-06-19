import { NextResponse } from "next/server";
import { sortCompanies } from "@/lib/prices";
import { getPriceData } from "@/lib/prices-server";

export const dynamic = "force-dynamic";

// 単価データを返すAPI。ライブ取得（Googleシート公開CSV）を試し、
// 失敗時はリポ同梱のスナップショットにフォールバック。
export async function GET() {
  try {
    const data = await getPriceData();
    return NextResponse.json({
      ...data,
      companies: sortCompanies(data.companies),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "単価データの取得に失敗しました", detail: String(e) },
      { status: 500 }
    );
  }
}
