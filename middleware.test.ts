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

  // 【再現テスト・現在RED】
  // /api/prices/update は GAS（毎時トリガー）が x-api-key ヘッダで叩く M2M 窓口で、cookie を持たない。
  // route 本体（app/api/prices/update/route.ts:26-29）が PRICE_SYNC_SECRET を検証するため、
  // middleware の cookie ゲートからは /api/admin/seed と同様に除外しなければならない。
  // 現状は "/api/prices/:path*" が update まで巻き込み、route 到達前に 401 を返す＝毎時同期が恒久停止する。
  // 本番実測（2026-07-15）:
  //   GET https://mitsumori-app-pied.vercel.app/api/prices/update  -> 401 {"error":"Unauthorized"}（middlewareが遮断）
  //   GET https://mitsumori-app-pied.vercel.app/api/admin/seed     -> 405（middleware通過→route到達＝対照群）
  it("GASの単価同期(/api/prices/update)はcookie無しでもmiddlewareを通過し、route側のx-api-key認証に委ねる", async () => {
    const res = await middleware(req("/api/prices/update", "POST"));
    expect(passedThrough(res)).toBe(true);
    expect(res.status).not.toBe(401);
  });

  // 除外は update だけ＝親の /api/prices は cookie ゲート対象のまま、という境界を固定する。
  // （「M2Mを通す」対応で /api/prices ごと素通しにする過剰修正への歯止め）
  it("除外されるのは /api/prices/update だけで、単価取得API(/api/prices)のゲートは維持される", async () => {
    const res = await middleware(req("/api/prices"));
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
