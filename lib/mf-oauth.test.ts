import { describe, it, expect } from "vitest";
import { buildAuthorizeUrl, MF_AUTHORIZE_URL, MF_SCOPE } from "./mf-oauth";

describe("buildAuthorizeUrl", () => {
  it("認可URLに必要なパラメータを全て含む", () => {
    const url = buildAuthorizeUrl({
      clientId: "337171679680541",
      redirectUri: "https://mitsumori-app-pied.vercel.app/api/mf-callback",
      state: "abc123",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(MF_AUTHORIZE_URL);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("337171679680541");
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://mitsumori-app-pied.vercel.app/api/mf-callback"
    );
    expect(u.searchParams.get("scope")).toBe(MF_SCOPE);
    expect(u.searchParams.get("state")).toBe("abc123");
  });

  it("scope は見積書作成に必要な data.write", () => {
    expect(MF_SCOPE).toBe("mfc/invoice/data.write");
  });
});
