import { NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/mf-oauth";
import { isKvConfigured } from "@/lib/mf-tokens";

export const dynamic = "force-dynamic";

// MF OAuth コールバック。code を access/refresh token に交換して保存する。
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");

  if (error) {
    return NextResponse.json(
      { ok: false, message: `認可エラー: ${error}` },
      { status: 400 }
    );
  }
  if (!code) {
    return NextResponse.json(
      { ok: false, message: "認可コード(code)がありません。" },
      { status: 400 }
    );
  }

  // state 照合（CSRF対策）
  const cookieState = req.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("mf_oauth_state="))
    ?.split("=")[1];
  if (cookieState && state && cookieState !== state) {
    return NextResponse.json(
      { ok: false, message: "stateが一致しません（CSRFの可能性）。" },
      { status: 400 }
    );
  }

  try {
    const rec = await exchangeCodeForTokens(code);

    // KVが無い環境では refresh_token を画面に出して運用者がenvへ転記できるようにする。
    // KVがある場合は保存済みなので秘密は出さない。
    const kv = isKvConfigured();
    const body: Record<string, unknown> = {
      ok: true,
      message:
        "MF連携が完了しました。これでアプリから見積書を作成できます。",
      stored_in: kv ? "vercel-kv" : "memory-only",
    };
    if (!kv) {
      body.note =
        "Vercel KV が未設定のため、トークンを永続化できていません。下記 refresh_token を Vercel 環境変数 MF_REFRESH_TOKEN に登録してください（再デプロイで有効）。";
      body.refresh_token = rec.refresh_token;
    }
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        message: `トークン交換に失敗しました: ${
          e instanceof Error ? e.message : String(e)
        }`,
      },
      { status: 500 }
    );
  }
}
