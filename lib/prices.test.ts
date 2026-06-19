import { describe, it, expect } from "vitest";
import {
  readSaCreds,
  sortCompanies,
  RATE_DEFS,
  type Company,
} from "./prices";

describe("readSaCreds", () => {
  it("GOOGLE_SA_JSON 全文から client_email/private_key を取り出す", () => {
    const env = {
      GOOGLE_SA_JSON: JSON.stringify({
        client_email: "svc@proj.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n",
        type: "service_account",
      }),
    } as unknown as NodeJS.ProcessEnv;
    const creds = readSaCreds(env);
    expect(creds).not.toBeNull();
    expect(creds!.client_email).toBe("svc@proj.iam.gserviceaccount.com");
    // \n が実改行に戻っていること
    expect(creds!.private_key).toContain("\n");
    expect(creds!.private_key).not.toContain("\\n");
  });

  it("GOOGLE_SA_EMAIL ＋ GOOGLE_SA_PRIVATE_KEY からも取り出す", () => {
    const env = {
      GOOGLE_SA_EMAIL: "svc@proj.iam.gserviceaccount.com",
      GOOGLE_SA_PRIVATE_KEY: "-----BEGIN-----\\nXYZ\\n-----END-----",
    } as unknown as NodeJS.ProcessEnv;
    const creds = readSaCreds(env);
    expect(creds).not.toBeNull();
    expect(creds!.client_email).toBe("svc@proj.iam.gserviceaccount.com");
    expect(creds!.private_key).toBe("-----BEGIN-----\nXYZ\n-----END-----");
  });

  it("鍵が無ければ null（＝スナップショットへフォールバック）", () => {
    expect(readSaCreds({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("壊れたJSONは個別envへフォールバック（無ければnull）", () => {
    const env = { GOOGLE_SA_JSON: "{not json" } as unknown as NodeJS.ProcessEnv;
    expect(readSaCreds(env)).toBeNull();
  });
});

describe("sortCompanies", () => {
  const mk = (name: string, hasPrice: boolean): Company => ({
    code: name,
    name,
    prices: RATE_DEFS.reduce(
      (acc, d) => ({ ...acc, [d.key]: hasPrice ? 18000 : 0 }),
      {} as Company["prices"]
    ),
    hasPrice,
  });

  it("単価ありの会社が先頭、その中は名前順", () => {
    const list = [
      mk("あ社（無）", false),
      mk("う社（有）", true),
      mk("い社（有）", true),
    ];
    const sorted = sortCompanies(list).map((c) => c.name);
    expect(sorted[0]).toBe("い社（有）");
    expect(sorted[1]).toBe("う社（有）");
    expect(sorted[2]).toBe("あ社（無）");
  });
});
