import { type NextRequest, NextResponse } from "next/server";
import { RATE_DEFS, type RateKey } from "@/lib/prices";
import {
  listCompanies,
  updateRate,
  upsertCompanyWithRates,
} from "@/lib/price-admin-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GAS（単価シート）からの定期pushの受け口。
//
// 以前は price_cache に書いていたが、getPriceData() は price_companies に
// 生きている会社が1社でもあれば即returnする（lib/prices-server.ts）。本番には
// 30社入っているため price_cache は永久に読まれず、この経路は無効化していた。
// そのため見積画面が実際に読む price_companies / price_rates を直接更新する。

// シート同期による変更を、人間の管理者（takagi / nishimura / admin）と
// 区別するための識別子。app/admin/page.tsx の USER_LABEL に対応表がある。
const SYNC_ACTOR = "gas-sync";

const RATE_KEYS: RateKey[] = RATE_DEFS.map((d) => d.key);

interface Company {
  code: string;
  name: string;
  prices: Record<string, number>;
  hasPrice: boolean;
}

interface EquipmentItem {
  name: string;
  unit: string;
  price: number;
}

interface UpdateBody {
  companies: Company[];
  equipment?: EquipmentItem[];
  source?: string;
}

// 12区分ぶんを必ず埋めた単価表にする。数値でない／負の値は0に倒す。
function normalizePrices(src: Record<string, number> | undefined): Record<RateKey, number> {
  const out = {} as Record<RateKey, number>;
  for (const k of RATE_KEYS) {
    const v = Number(src?.[k]);
    out[k] = Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
  }
  return out;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.PRICE_SYNC_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: UpdateBody;
  try {
    body = (await req.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.companies) || body.companies.length === 0) {
    return NextResponse.json({ error: "companies required" }, { status: 400 });
  }

  // 既存の生きている会社を code で引けるようにする（会社名は表記ゆれがあるため
  // 同定には使わない）。ここで現在値も取れるので、差分のある区分だけを更新できる。
  const existing = await listCompanies();
  const byCode = new Map(existing.filter((c) => c.code).map((c) => [c.code, c]));

  let created = 0;
  let updated = 0;
  let changedRates = 0;
  const skipped: string[] = [];

  for (const c of body.companies) {
    const code = (c.code ?? "").trim();

    // ・hasPrice:false（シート上で単価が空欄の会社。約15社ある）は完全にスキップする。
    //   0で上書きすると既存のDB値を破壊するため、新規作成もしない。
    // ・code が無い会社は同定できず、毎回新規作成されて冪等性が壊れるためスキップする。
    if (!code || c.hasPrice !== true) {
      skipped.push(code || c.name || "(no code)");
      continue;
    }

    const prices = normalizePrices(c.prices);
    const found = byCode.get(code);

    if (!found) {
      await upsertCompanyWithRates({ code, name: c.name, prices });
      created++;
      changedRates += RATE_KEYS.filter((k) => prices[k] > 0).length;
      continue;
    }

    // 既存会社は updateRate 経由で「差分のある区分だけ」更新する。
    // これで price_history に旧→新が changed_by=gas-sync で残り、かつ
    // 同じペイロードの2回目は差分ゼロ＝1行も書かないので冪等になる。
    let n = 0;
    for (const k of RATE_KEYS) {
      if (found.prices[k] === prices[k]) continue;
      await updateRate(found.id, k, prices[k], SYNC_ACTOR);
      n++;
    }
    if (n > 0) {
      updated++;
      changedRates += n;
    }
  }

  return NextResponse.json({
    ok: true,
    received: body.companies.length,
    created,
    updated,
    skipped: skipped.length,
    skippedCodes: skipped,
    changedRates,
    source: body.source ?? "GAS sync",
    syncedAt: new Date().toISOString(),
  });
}
