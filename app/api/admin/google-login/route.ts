import { type NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!adminConfigured()) {
    return NextResponse.json(
      { error: "管理機能が未設定です" },
      { status: 503 }
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.NEXT_PUBLIC_GOOGLE_CALLBACK_URL;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "Google OAuth が未設定です（GOOGLE_CLIENT_ID, NEXT_PUBLIC_GOOGLE_CALLBACK_URL）" },
      { status: 503 }
    );
  }

  // PKCE: code_challenge 生成
  const codeVerifier = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(codeVerifier));
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  // state: CSRF 対策（session/cookie に保存）
  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });

  const redirectUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  // codeVerifier と state を session cookie に保存（httpOnly）
  const res = NextResponse.json({ redirectUrl });
  res.cookies.set("oauth_code_verifier", codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10, // 10分有効
  });
  res.cookies.set("oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10, // 10分有効
  });

  return res;
}
