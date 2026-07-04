import { NextResponse } from "next/server";
import { listHistory } from "@/lib/price-admin-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const history = await listHistory(100);
    return NextResponse.json({ history });
  } catch (e) {
    return NextResponse.json(
      { error: "変更履歴の取得に失敗しました", detail: String(e) },
      { status: 500 }
    );
  }
}
