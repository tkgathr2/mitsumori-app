import { NextResponse, type NextRequest } from "next/server";
import { USER_COOKIE, verifyUserSessionToken } from "@/lib/user-auth";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/admin-auth";

// カイゼンくんウィジェット（別オリジンiframe）へログイン中ユーザーを引き継ぐための
// 軽量エンドポイント。ウィジェットはこの窓の中でGoogleログインができないため、
// ホスト（みつもりくん）側の既存セッションを window.kaizenUser として渡す入口になる。
// 見積もり画面ログイン(mitsumori_user)・管理画面ログイン(mitsumori_admin)のどちらか
// 有効な方を返す。未ログインでも 200 + user:null（ウィジェット側は手入力等にフォールバック）。
export const dynamic = "force-dynamic";

function jsonNoStore(body: { user: string | null }): NextResponse {
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const userToken = req.cookies.get(USER_COOKIE)?.value;
  const userEmail = await verifyUserSessionToken(userToken);
  if (userEmail) {
    return jsonNoStore({ user: userEmail });
  }

  const adminToken = req.cookies.get(ADMIN_COOKIE)?.value;
  const adminUser = await verifySessionToken(adminToken);
  if (adminUser) {
    // admin経路はメールでなくユーザー名（環境によっては "admin" 固定）を返すため、
    // user経路のメールと形式が混ざらないよう出所を明示する。
    return jsonNoStore({ user: `${adminUser}（管理画面）` });
  }

  return jsonNoStore({ user: null });
}
