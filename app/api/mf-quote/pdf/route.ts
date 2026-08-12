import { NextResponse } from "next/server";
import { fetchQuotePdf } from "@/lib/mf-client";

export const dynamic = "force-dynamic";

// MF見積書PDFのプロキシ。pdf_urlをブラウザへそのまま渡すと認証(Bearer)が
// 通らずtoken_missingになるため（KZ-122）、ここでサーバー側の access_token を
// 使って取得したバイナリをそのまま中継する。
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const quoteId = searchParams.get("quoteId");
  if (!quoteId) {
    return NextResponse.json(
      { ok: false, message: "quoteIdが必要です" },
      { status: 400 }
    );
  }
  try {
    const { body, contentType } = await fetchQuotePdf(quoteId);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="quote-${quoteId}.pdf"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
