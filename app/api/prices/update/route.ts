import { type NextRequest, NextResponse } from "next/server";
import { savePriceCache } from "@/lib/price-cache-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const payload = {
    companies: body.companies,
    equipment: body.equipment ?? [],
    source: body.source ?? "GAS sync",
    syncedAt: new Date().toISOString(),
  };

  await savePriceCache(payload);

  return NextResponse.json({
    ok: true,
    count: body.companies.length,
    syncedAt: payload.syncedAt,
  });
}
