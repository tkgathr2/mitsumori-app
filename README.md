# mitsumori-app — 見積もり自動化システム

交通誘導警備の見積書を、会社・区分・人数・日数を入れるだけで作成できる Next.js アプリ。
フェーズ2で **MFクラウド請求書 公式API v3** と連携し、「MFに見積を作成」ボタン一発で
MFクラウド請求書に見積書を作成し、PDFを開けるようにした。

## MFクラウド請求書 連携（OAuth）の仕組み

- 事業者: **株式会社日本交通誘導（6683-7372）** ビジネスプラン契約済み（追加課金なし）
- API基底: `https://invoice.moneyforward.com/api/v3`
- 認可サーバー: `https://api.biz.moneyforward.com`（authorize / token）
- スコープ: `mfc/invoice/data.write`（見積書・取引先の作成に必要）
- 認証方式: **CLIENT_SECRET_BASIC**（client_id:client_secret を Basic 認証ヘッダで送る）

### OAuthアプリ登録値（アプリポータルで登録済み）

MFアプリポータル（`https://app-portal.moneyforward.com/apps/` → 株式会社日本交通誘導 →
アプリ開発）に「見積もり自動化システム mitsumori-app」を登録済み。

| 項目 | 値 |
|---|---|
| Client ID | `337171679680541` |
| Client Secret | アプリ詳細画面の「再発行」で確認（秘密。Vercel env に格納） |
| リダイレクトURI（本番） | `https://mitsumori-app-pied.vercel.app/api/mf-callback` |
| リダイレクトURI（ローカル） | `http://localhost:3000/api/mf-callback` |
| クライアント認証方式 | CLIENT_SECRET_BASIC |

> Client Secret は再表示できる（アプリ詳細の目アイコン）。漏れた場合は「再発行」で差し替え、
> Vercel env も更新すること。

## 必要な環境変数（Vercel）

| 変数 | 必須 | 説明 |
|---|---|---|
| `MF_CLIENT_ID` | ✅ | OAuthアプリの Client ID（`337171679680541`） |
| `MF_CLIENT_SECRET` | ✅ | OAuthアプリの Client Secret |
| `MF_REDIRECT_URI` | 任意 | 既定は本番URL。ローカルでは `http://localhost:3000/api/mf-callback` を設定 |
| `DATABASE_URL` | ✅ | 自前 Railway Postgres の接続URL。トークン永続化に使う（テーブル `mf_oauth_tokens` を自動作成） |
| `MF_REFRESH_TOKEN` | 代替 | DBが空のときの初回ブートストラップ用 refresh_token（以後はDBが正本） |

> トークンの保存先は **自前 Railway Postgres**（`DATABASE_URL`）。Vercel KV / Upstash は使わない
> （マーケットプレイスの規約同意・課金導線を避けるため）。`@vercel/kv` 依存は撤去済み。
> `DATABASE_URL` を渡すと初回アクセス時に `mf_oauth_tokens` テーブルを `CREATE TABLE IF NOT EXISTS`
> で自動作成し、refresh のたびに新トークンを1行 upsert する（MFのローテーションに追従）。
>
> 注意: `DATABASE_URL` には `?sslmode=...` を付けないこと。アプリ側は `ssl: { rejectUnauthorized: false }`
> を明示指定しており、URLに `sslmode` があると `pg`（pg-connection-string）がそれを優先して
> self-signed 証明書を弾く。

### 設定コマンド例

```bash
vercel env add MF_CLIENT_ID production   # 337171679680541
vercel env add MF_CLIENT_SECRET production
vercel env add DATABASE_URL production   # 自前 Railway Postgres の接続URL（sslmode は付けない）
```

## 初回の連携手順（1回だけ）

1. Vercel に `MF_CLIENT_ID` / `MF_CLIENT_SECRET`（と可能なら Vercel KV）を設定してデプロイ。
2. ブラウザで **`https://mitsumori-app-pied.vercel.app/api/mf-auth`** を開く。
   → MFの認可画面に飛ぶ（日本交通誘導でログイン済みのこと）。
3. 「許可」すると `/api/mf-callback` に戻り、`{"ok":true,...}` が表示される。
   - **`DATABASE_URL` を設定済み**なら access/refresh token は Postgres の `mf_oauth_tokens`
     テーブルに保存され、以後は自動（refresh のたびに新トークンで上書き＝MFローテーションに追従）。
   - DB未設定なら応答に `refresh_token` が表示されるので、`DATABASE_URL` を設定し直してから再連携する。
4. これで完了。アプリの「MFに見積を作成」ボタンが使えるようになる。

## トークンの更新と失効防止

- `access_token` は **1時間**有効。API呼び出し時に期限切れなら自動で `refresh_token` で更新する。
- `refresh_token` は **18か月**有効。ただし**使うたびに新しいものに置き換わる**ため、
  更新のたび Postgres へ書き戻す（`saveTokens` が1行 upsert）。これが永続化の肝。
- 長期間未使用だと失効するリスクがあるため、**月1回ヘルスチェックを叩いて access_token を
  更新**しておくこと（refresh_token も新しくなり実質失効しない）。

### 月次ヘルスチェック（scheduled-task）

`GET https://mitsumori-app-pied.vercel.app/api/mf-health` を月1回叩く。
`{ ok: true, linked: true, tokenRefreshedAt: ... }` が返れば正常。
`linked: false` なら再連携（上記「初回の連携手順」）が必要。

## 単価のライブ同期（Googleスプレッドシート → アプリ）

単価の**正本は Googleスプレッドシート**（西村さんが書き換える）。アプリはこのシートを
**ライブで読み取り**、「シート書換 → アプリに即反映（最大60秒キャッシュ）」を実現する。

- シートID: `1LPgDarhRJJU_j7vywFI6kSOH8d6kvTPjsGkz--kkiCY`（1枚目 gid=0）
- 列構成（`A:O`）: `No, 会社コード, 会社名, 一般[基本,残業,夜勤,残業,法休,残業], 有資格[基本,残業,夜勤,残業,法休,残業]`
- 取得の優先順位（`lib/prices-server.ts`）:
  1. **サービスアカウント＋Sheets API**（推奨。シートを全公開せず、SAにだけ閲覧共有）
  2. 公開CSV（シートを公開している場合のみ成功）
  3. **リポ同梱スナップショット**（`data/prices-snapshot.json`）へフォールバック（落ちても動く）
- `GET /api/prices` のレスポンスに `live`（シートから取れたか）/`fetchedAt` を含む。

### シートを安全にライブ化する手順（全公開しない）

> **方式＝Googleサービスアカウント（SA）＋Sheets API 読み取り。**
> シート自体は非公開のまま、SAのメールアドレスにだけ「閲覧者」で共有する。

**① SAを作って鍵JSONを発行（GCPプロジェクトで1回。`gcloud` でもコンソールでも可）**

```bash
# 例（gcloud。PROJECT は既存の任意プロジェクトでよい）
gcloud config set project <PROJECT_ID>
gcloud services enable sheets.googleapis.com
gcloud iam service-accounts create mitsumori-sheets \
  --display-name "mitsumori prices reader"
# SAのメール（= <name>@<PROJECT_ID>.iam.gserviceaccount.com）を控える
gcloud iam service-accounts keys create sa-key.json \
  --iam-account mitsumori-sheets@<PROJECT_ID>.iam.gserviceaccount.com
```

**② シートをそのSAメールに「閲覧者」で共有**
スプレッドシートの「共有」→ SAのメール（`...iam.gserviceaccount.com`）を**閲覧者**で追加。
（編集権限は不要。これでシートは非公開のまま、アプリだけが読める。）

**③ 鍵を Vercel env に格納**（いずれか一方）

```bash
# (A) 鍵JSON全文を1つの env に（推奨。改行はそのままで可）
vercel env add GOOGLE_SA_JSON production   # sa-key.json の中身を貼る

# (B) メールと秘密鍵を分けて
vercel env add GOOGLE_SA_EMAIL production         # SAのメール
vercel env add GOOGLE_SA_PRIVATE_KEY production   # private_key（"\n" 改行のままでOK）
```

> private_key 内の `\n` はアプリ側（`readSaCreds`）で実改行へ自動変換する。
> env を入れて再デプロイすると `/api/prices` の `live` が `true` になる。

**未設定でも安全**: SA鍵が無ければ自動でスナップショット（10社分の単価入り）にフォールバックし、
アプリは止まらない。鍵を入れた瞬間にライブ読み取りへ切り替わる。

| 変数 | 必須 | 説明 |
|---|---|---|
| `GOOGLE_SA_JSON` | 任意 | SA鍵JSON全文（`client_email`/`private_key` を含む）。これがあれば下2つは不要 |
| `GOOGLE_SA_EMAIL` | 任意 | SAのメール（`GOOGLE_SA_JSON` を使わない場合） |
| `GOOGLE_SA_PRIVATE_KEY` | 任意 | SAの秘密鍵（同上） |
| `PRICES_SHEET_ID` | 任意 | 既定はマスタのシートID |
| `PRICES_SHEET_RANGE` | 任意 | 既定 `A1:O100` |

## API エンドポイント

| ルート | 用途 |
|---|---|
| `GET /api/mf-auth` | OAuth認可フロー開始（MF認可画面へリダイレクト） |
| `GET /api/mf-callback` | 認可コード→トークン交換・保存 |
| `POST /api/mf-quote` | UIの見積データ→MF見積書を作成。`{quoteId, quoteNumber, pdfUrl}` を返す |
| `GET /api/mf-health` | 連携ヘルスチェック＋トークン更新（月次タスク用） |
| `GET /api/prices` | 単価データ（Googleシートからライブ取得／失敗時スナップショット。`live`/`fetchedAt` 付き） |

## 見積書作成のデータフロー

1. UI（`app/page.tsx`）が会社名＋明細（`lines`）を `POST /api/mf-quote` へ送る。
2. `lib/mf.ts` が会社名で**取引先を検索→無ければ作成**し、その部門の `department_id` を取得。
3. 明細を MF の `items[]`（`name`/`unit`/`price`/`quantity`/`excise: ten_percent`）に変換。
4. `POST /api/v3/quotes` で見積書を作成。発行日=当日、有効期限=+30日。
5. レスポンスの `pdf_url` をUIが新しいタブで開く。

## 開発

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm test
npm run build
```

## 注意

- 消費税は **10%固定**（`excise: "ten_percent"`）。交通誘導警備の役務を前提とする。
- 取引先は会社名で名寄せ。同名取引先が複数ある場合は完全一致を優先、無ければ先頭を使う。
- Client Secret 等の秘密はコードに直書きせず、必ず Vercel env / KV に置く。
