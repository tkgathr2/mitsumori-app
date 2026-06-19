import { NextResponse } from "next/server";
import { createMfQuote, MfQuotePayload } from "@/lib/mf";

export const dynamic = "force-dynamic";

// MFクラウド見積書作成（フェーズ1ではstub）
export async function POST(req: Request) {
  let payload: MfQuotePayload;
  try {
    payload = (await req.json()) as MfQuotePayload;
  } catch {
    return NextResponse.json({ ok: false, message: "不正なリクエストです" }, { status: 400 });
  }
  const result = await createMfQuote(payload);
  return NextResponse.json(result);
}
