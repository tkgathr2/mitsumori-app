import { type NextRequest, NextResponse } from "next/server";
import { softDeleteCompany, updateCompany } from "@/lib/price-admin-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(idStr: string): number | null {
  const id = Number(idStr);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: idStr } = await ctx.params;
  const id = parseId(idStr);
  if (id === null) {
    return NextResponse.json({ error: "不正なIDです" }, { status: 400 });
  }
  let body: { code?: string; name?: string; note?: string; sortOrder?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    await updateCompany(id, {
      code: body.code,
      name: body.name,
      note: body.note,
      sortOrder: body.sortOrder,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: "会社の更新に失敗しました", detail: String(e) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: idStr } = await ctx.params;
  const id = parseId(idStr);
  if (id === null) {
    return NextResponse.json({ error: "不正なIDです" }, { status: 400 });
  }
  try {
    await softDeleteCompany(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: "会社の削除に失敗しました", detail: String(e) },
      { status: 500 }
    );
  }
}
