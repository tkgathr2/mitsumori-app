import { NextResponse } from "next/server";
import { oauthConfigured, getValidAccessToken } from "@/lib/mf-oauth";
import { isKvConfigured, loadTokens } from "@/lib/mf-tokens";

export const dynamic = "force-dynamic";

// MF連携のヘルスチェック。月1回のscheduled-taskから叩いて
// access_token を実際に更新し、refresh_token の失効（6か月/18か月）を防ぐ。
// 秘密情報は返さない。
export async function GET() {
  const configured = oauthConfigured();
  const kv = isKvConfigured();

  if (!configured) {
    return NextResponse.json({
      ok: false,
      configured: false,
      kv,
      linked: false,
      message: "MF_CLIENT_ID / MF_CLIENT_SECRET が未設定です。",
    });
  }

  const rec = await loadTokens();
  if (!rec || !rec.refresh_token) {
    return NextResponse.json({
      ok: false,
      configured: true,
      kv,
      linked: false,
      message: "未連携です。/api/mf-auth で認可を完了してください。",
    });
  }

  try {
    // 実際にrefreshを走らせてトークンを最新化（=失効防止）
    const token = await getValidAccessToken();
    return NextResponse.json({
      ok: Boolean(token),
      configured: true,
      kv,
      linked: true,
      tokenRefreshedAt: new Date().toISOString(),
      message: token
        ? "MF連携は正常です（access_tokenを更新しました）。"
        : "access_tokenを取得できませんでした。",
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        kv,
        linked: true,
        message: `トークン更新に失敗: ${
          e instanceof Error ? e.message : String(e)
        }`,
      },
      { status: 500 }
    );
  }
}
