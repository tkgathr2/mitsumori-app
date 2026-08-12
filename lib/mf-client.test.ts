import { describe, it, expect, vi, beforeEach } from "vitest";

// getValidAccessToken をモックし、findPartnerByName が実際に
// fetch する際の Authorization ヘッダ・401リトライ挙動を検証する。
const mocks = vi.hoisted(() => ({
  getValidAccessToken: vi.fn(),
}));

vi.mock("./mf-oauth", () => ({
  getValidAccessToken: mocks.getValidAccessToken,
}));

import { findPartnerByName, fetchQuotePdf } from "./mf-client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.getValidAccessToken.mockReset();
});

describe("mfFetch トークン失効時の自動リトライ（KZ-122）", () => {
  it("MFがtoken_missingで401を返したら、強制refreshした新トークンで1回だけ再試行する", async () => {
    mocks.getValidAccessToken.mockResolvedValueOnce("stale_token"); // 通常取得
    mocks.getValidAccessToken.mockResolvedValueOnce("fresh_token"); // force:true での再取得

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse(401, {
          error: "token_missing",
          error_description: "Access token is missing. Please check your request authorization and try again.",
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }));

    const result = await findPartnerByName("株式会社日本交通誘導");

    expect(result).toBeNull(); // data:[] なので該当なし＝正常系
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer stale_token",
    });
    expect(fetchSpy.mock.calls[1][1]?.headers).toMatchObject({
      Authorization: "Bearer fresh_token",
    });
    // force:true で強制refreshを要求している
    expect(mocks.getValidAccessToken).toHaveBeenCalledWith({ force: true });
  });

  it("token_missing以外の401（権限不足等）はリトライせずそのままエラーにする", async () => {
    mocks.getValidAccessToken.mockResolvedValueOnce("tok");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse(401, { error: "insufficient_scope" })
      );

    await expect(findPartnerByName("X")).rejects.toThrow("取引先検索に失敗");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("再試行後も失敗するなら、その結果をそのままエラーにする", async () => {
    mocks.getValidAccessToken.mockResolvedValueOnce("stale_token");
    mocks.getValidAccessToken.mockResolvedValueOnce("still_bad_token");

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(401, { error: "token_missing" }))
      .mockResolvedValueOnce(jsonResponse(401, { error: "token_missing" }));

    await expect(findPartnerByName("X")).rejects.toThrow("取引先検索に失敗");
  });
});

describe("fetchQuotePdf（KZ-122：PDFをブラウザへ直接渡さずサーバー側で認証して中継）", () => {
  it("access_tokenを付けてPDFバイナリを取得できる", async () => {
    mocks.getValidAccessToken.mockResolvedValueOnce("stale_token");

    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(pdfBytes, {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      })
    );

    const result = await fetchQuotePdf("quote-1");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      `${"https://invoice.moneyforward.com/api/v3"}/quotes/quote-1.pdf`
    );
    expect(fetchSpy.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer stale_token",
    });
    expect(result.contentType).toBe("application/pdf");
    expect(new Uint8Array(result.body)).toEqual(pdfBytes);
  });

  it("token_missingで401ならmfFetch同様に強制refreshして1回だけ再試行する", async () => {
    mocks.getValidAccessToken.mockResolvedValueOnce("stale_token");
    mocks.getValidAccessToken.mockResolvedValueOnce("fresh_token");

    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse(401, { error: "token_missing" })
      )
      .mockResolvedValueOnce(
        new Response(pdfBytes, {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        })
      );

    const result = await fetchQuotePdf("quote-1");
    expect(new Uint8Array(result.body)).toEqual(pdfBytes);
    expect(mocks.getValidAccessToken).toHaveBeenCalledWith({ force: true });
  });

  it("取得に失敗したらエラーを投げる", async () => {
    mocks.getValidAccessToken.mockResolvedValueOnce("tok");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(404, { error: "not_found" })
    );

    await expect(fetchQuotePdf("missing")).rejects.toThrow(
      "見積書PDF取得に失敗"
    );
  });
});
