import { type NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/admin-auth";
import { updateRate } from "@/lib/price-admin-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(idStr: string): number | null {
  const id = Number(idStr);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// 単価を1セル更新する。body = { rateKey, price }
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: idStr } = await ctx.params;
  const companyId = parseId(idStr);
  if (companyId === null) {
    return NextResponse.json({ error: "不正なIDです" }, { status: 400 });
  }
  let body: { rateKey?: string; price?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const rateKey = (body.rateKey ?? "").trim();
  const price = Number(body.price);
  if (!rateKey) {
    return NextResponse.json({ error: "rateKey は必須です" }, { status: 400 });
  }
  if (!Number.isFinite(price) || price < 0) {
    return NextResponse.json(
      { error: "price は0以上の数値で指定してください" },
      { status: 400 }
    );
  }
  // 変更履歴 changed_by 用にログインユーザー名を取る（認証自体は middleware 済み）。
  const changedBy =
    (await verifySessionToken(req.cookies.get(ADMIN_COOKIE)?.value)) ?? "admin";
  try {
    await updateRate(companyId, rateKey, Math.round(price), changedBy);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: "単価の更新に失敗しました", detail: String(e) },
      { status: 400 }
    );
  }
}
