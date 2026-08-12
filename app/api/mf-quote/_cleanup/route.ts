import { NextResponse } from "next/server";
import { deleteQuote } from "@/lib/mf-client";

export const dynamic = "force-dynamic";

// KZ-122検証で本番MFへ作成したテスト見積2件の削除専用・一時エンドポイント。
// 使用後にこのファイルごと削除する（恒久機能ではない）。
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const quoteId = searchParams.get("quoteId");
  if (!quoteId) {
    return NextResponse.json({ ok: false, message: "quoteIdが必要です" }, { status: 400 });
  }
  try {
    await deleteQuote(quoteId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
