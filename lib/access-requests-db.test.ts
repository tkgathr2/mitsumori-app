import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// pg.Pool をモックし、access_requests テーブルを「時計を手で進められるインメモリDB」として
// 忠実に再現する。実DBには一切つながない。
//
// fakeQuery は「コードが投げたSQLの形」に素直に従う（NOT EXISTS ガードがあれば条件付き挿入、
// 無ければ無条件挿入）ので、無条件INSERTに戻したら重複排除のテストは落ちる＝退行を検知できる。

interface QueryCall {
  sql: string;
  params: unknown[];
}
interface Row {
  id: number;
  email: string;
  flow: string;
  created_at: number; // ms（fake clock）
}

const calls: QueryCall[] = [];
const rows: Row[] = [];
let now = 0;
let nextId = 1;
// CREATE 文を n 回だけ失敗させる（ensureSchema の毒キャッシュ検証用）。
let failCreateTimes = 0;

const MIN = 60 * 1000;

function fakeQuery(sql: string, params: unknown[]): { rows: unknown[]; rowCount: number } {
  if (/^\s*CREATE /.test(sql)) {
    if (failCreateTimes > 0) {
      failCreateTimes--;
      throw new Error("boom: schema failed");
    }
    return { rows: [], rowCount: 0 };
  }

  const [email, flow, windowMs] = params as [string, string, number];
  const existsInWindow = () =>
    rows.some(
      (r) => r.email === email && r.flow === flow && r.created_at > now - Number(windowMs)
    );

  if (sql.includes("INSERT INTO access_requests")) {
    // NOT EXISTS ガード付き＝「直近ウィンドウ内に通知済みが無いときだけ入れる」単一文
    if (sql.includes("NOT EXISTS") && existsInWindow()) {
      return { rows: [], rowCount: 0 };
    }
    const id = nextId++;
    rows.push({ id, email, flow, created_at: now });
    return { rows: [{ id }], rowCount: 1 };
  }

  // 旧実装の「SELECT で判定してから無条件INSERT」形も再現できるようにしておく
  if (sql.includes("SELECT 1 FROM access_requests")) {
    return existsInWindow() ? { rows: [{ n: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  return { rows: [], rowCount: 0 };
}

vi.mock("pg", () => {
  class Pool {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      return fakeQuery(sql, params);
    }
  }
  return { Pool };
});

// モジュールスコープの _schemaReady / _pool をテストごとにリセットするため動的 import。
async function freshModule() {
  vi.resetModules();
  return import("./access-requests-db");
}

function createCalls(): QueryCall[] {
  return calls.filter((c) => /^\s*CREATE TABLE/.test(c.sql));
}

beforeEach(() => {
  calls.length = 0;
  rows.length = 0;
  now = 0;
  nextId = 1;
  failCreateTimes = 0;
  process.env.DATABASE_URL = "postgres://mock";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ensureSchema", () => {
  it("テーブルと重複排除用インデックスを作る", async () => {
    const { recordAccessRequest } = await freshModule();
    await recordAccessRequest("test@example.com", "general");
    expect(calls.some((c) => c.sql.includes("CREATE TABLE IF NOT EXISTS access_requests"))).toBe(
      true
    );
    const idx = calls.find((c) => c.sql.includes("CREATE INDEX"));
    expect(idx).toBeDefined();
    expect(idx!.sql).toContain("access_requests(email, flow, created_at DESC)");
  });

  it("失敗しても毒キャッシュせず、次の呼び出しで再試行する", async () => {
    const { recordAccessRequest } = await freshModule();

    // 1回目：スキーマ作成が落ちる → 例外は投げず true（通知する側に倒す）
    failCreateTimes = 1;
    await expect(recordAccessRequest("test@example.com", "general")).resolves.toBe(true);
    expect(createCalls().length).toBe(1);
    // 失敗したので行は入っていない
    expect(rows.length).toBe(0);

    // 2回目：rejected Promise を握り続けていたら CREATE は再発行されない。
    // リセットされていれば作り直しに行く＝CREATE が2回目。
    await expect(recordAccessRequest("test@example.com", "general")).resolves.toBe(true);
    expect(createCalls().length).toBe(2);
    // 今度は成功しているので実際に記録されている＝申請機能が生き返った
    expect(rows.length).toBe(1);
  });
});

describe("recordAccessRequest（重複排除）", () => {
  it("初回は true（＝通知すべき）", async () => {
    const { recordAccessRequest } = await freshModule();
    expect(await recordAccessRequest("test@example.com", "general")).toBe(true);
    expect(rows.length).toBe(1);
  });

  it("ウィンドウは「最後に通知した時刻」起点＝連打しても1時間後には再通知される", async () => {
    const { recordAccessRequest } = await freshModule();
    const email = "test@example.com";

    // t=0 通知
    now = 0;
    expect(await recordAccessRequest(email, "general")).toBe(true);

    // t=50分 抑止（60分未満）。ここで行を足してしまうと起点が前進してバグる。
    now = 50 * MIN;
    expect(await recordAccessRequest(email, "general")).toBe(false);
    expect(rows.length).toBe(1); // 抑止時は行を増やさない

    // t=100分：最後に「通知した」のは t=0 なので 60分超え → 再通知される。
    // 旧実装は t=50 の行が残って抑止し続け、永久に初回1件しか通知されなかった。
    now = 100 * MIN;
    expect(await recordAccessRequest(email, "general")).toBe(true);
    expect(rows.length).toBe(2);

    // 直近通知（t=100）から60分未満は再び抑止
    now = 110 * MIN;
    expect(await recordAccessRequest(email, "general")).toBe(false);

    // さらに1時間後は再通知
    now = 165 * MIN;
    expect(await recordAccessRequest(email, "general")).toBe(true);
  });

  it("連打し続けても抑止は最大1時間で解ける（10分おきに3時間）", async () => {
    const { recordAccessRequest } = await freshModule();
    const notified: number[] = [];
    for (let t = 0; t <= 180 * MIN; t += 10 * MIN) {
      now = t;
      if (await recordAccessRequest("test@example.com", "general")) notified.push(t / MIN);
    }
    // ちょうど60分ごとに1回だけ通知される（ウィンドウ判定は strict `>` なので
    // 60分ちょうどの行はウィンドウ外＝再通知される）。旧実装だと [0] だけになる。
    expect(notified).toEqual([0, 60, 120, 180]);
  });

  it("判定と記録は単一文（同時実行で二重通知しない形）", async () => {
    const { recordAccessRequest } = await freshModule();
    await recordAccessRequest("test@example.com", "general");
    const dml = calls.filter((c) => !/^\s*CREATE /.test(c.sql));
    expect(dml.length).toBe(1);
    expect(dml[0].sql).toContain("INSERT INTO access_requests");
    expect(dml[0].sql).toContain("NOT EXISTS");
    expect(dml[0].sql).toContain("RETURNING id");
  });

  it("メール・フローが違えば独立して通知される", async () => {
    const { recordAccessRequest } = await freshModule();
    expect(await recordAccessRequest("a@example.com", "general")).toBe(true);
    expect(await recordAccessRequest("a@example.com", "general")).toBe(false);
    // 同じメールでも画面が違えば別枠
    expect(await recordAccessRequest("a@example.com", "admin")).toBe(true);
    // 別のメールも別枠
    expect(await recordAccessRequest("b@example.com", "general")).toBe(true);
  });
});

describe("recordAccessRequest（DB使用不可時のフォールバック）", () => {
  it("DATABASE_URL 未設定なら throw せず true（通知する側に倒す）", async () => {
    delete process.env.DATABASE_URL;
    const { recordAccessRequest, isDbConfigured } = await freshModule();
    expect(isDbConfigured()).toBe(false);
    await expect(recordAccessRequest("test@example.com", "general")).resolves.toBe(true);
    // DBには一切触らない
    expect(calls.length).toBe(0);
  });

  it("DBが落ちていても throw せず true（申請の取りこぼしより通知重複を選ぶ）", async () => {
    failCreateTimes = 99;
    const { recordAccessRequest } = await freshModule();
    await expect(recordAccessRequest("test@example.com", "admin")).resolves.toBe(true);
  });
});

describe("notifyAccessRequest", () => {
  const relayEnv = {
    PERSONA_RELAY_URL: "https://relay.example.com",
    PERSONA_RELAY_SECRET: "s3cret",
    ACCESS_REQUEST_SLACK_CHANNEL: "C0TEST",
  };

  beforeEach(() => {
    Object.assign(process.env, relayEnv);
  });

  afterEach(() => {
    for (const k of Object.keys(relayEnv)) delete process.env[k];
  });

  it("タイムアウト付きで送る（relay無応答でコールバックをハングさせない）", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const { notifyAccessRequest } = await freshModule();

    await notifyAccessRequest("test@example.com", "general");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal!.aborted).toBe(false);
    vi.unstubAllGlobals();
  });

  it("relayが落ちていても例外を投げない", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const { notifyAccessRequest } = await freshModule();
    await expect(notifyAccessRequest("test@example.com", "admin")).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("relay設定が無ければ何もしない", async () => {
    delete process.env.PERSONA_RELAY_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { notifyAccessRequest } = await freshModule();
    await notifyAccessRequest("test@example.com", "general");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
