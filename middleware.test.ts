import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware, config } from "./middleware";

// middleware を素通り（NextResponse.next()）したかどうかは、x-middleware-next ヘッダの有無で判別できる。
// 遮断された場合は 401 JSON か 307 リダイレクトが返る。
function passedThrough(res: { headers: Headers; status: number }): boolean {
  return res.headers.get("x-middleware-next") === "1";
}

function req(path: string, method = "GET"): NextRequest {
  return new NextRequest(new URL(`https://mitsumori.takagi.bz${path}`), { method });
}

describe("middleware：ログインゲートの対象範囲", () => {
  it("未ログインで見積もりデータAPIを叩くと401（f67f443のセキュリティ修正が効いていること）", async () => {
    const res = await middleware(req("/api/prices"));
    expect(res.status).toBe(401);
    expect(passedThrough(res)).toBe(false);
  });

  it("未ログインで見積もり画面トップを開くと/loginへリダイレクト", async () => {
    const res = await middleware(req("/"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  // 【シート通信の全撤去・2026-07-17】GASの単価同期窓口(/api/prices/update)と
  // シードAPI(/api/admin/seed)は route ごと削除したため、cookieゲートの除外リストにも
  // 残っていてはいけない（消えた route への穴を開けっぱなしにしない）。
  it("削除した単価同期窓口(/api/prices/update)は除外されず、cookieゲートの対象になる", async () => {
    const res = await middleware(req("/api/prices/update", "POST"));
    expect(res.status).toBe(401);
    expect(passedThrough(res)).toBe(false);
  });

  it("削除したシードAPI(/api/admin/seed)は除外されず、cookieゲートの対象になる", async () => {
    const res = await middleware(req("/api/admin/seed", "POST"));
    expect(res.status).toBe(401);
    expect(passedThrough(res)).toBe(false);
  });

  // 【同型バグの再発防止】/api/mf-health は月1回のscheduled-taskがcookie無しで叩き、
  // MFのrefresh_token失効（6か月/18か月）を防ぐM2M窓口（app/api/mf-health/route.ts:7-8）。
  // 現状は matcher に載っていない＝ゲート対象外だから動いている。
  // 今回のバグと同じ反射（「APIも保護しよう」で接頭辞を足す）で matcher に載せると、
  // 401で弾かれ月次リフレッシュが無言で停止し、半年後にMF連携が切れる。
  it("MF延命用のscheduled-task窓口(/api/mf-health)はmiddlewareのゲート対象に入れない", () => {
    const covers = (m: string, p: string): boolean =>
      m === p || (m.endsWith("/:path*") && p.startsWith(m.slice(0, -"/:path*".length) + "/"));
    expect(config.matcher.some((m) => covers(m, "/api/mf-health"))).toBe(false);
  });
});
