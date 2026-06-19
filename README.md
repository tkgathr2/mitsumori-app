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
| `KV_REST_API_URL` | 推奨 | Vercel KV（Upstash Redis）。トークン永続化に使う |
| `KV_REST_API_TOKEN` | 推奨 | 同上 |
| `MF_REFRESH_TOKEN` | 代替 | KVが無い場合のブートストラップ用 refresh_token |

### 設定コマンド例

```bash
vercel env add MF_CLIENT_ID production   # 337171679680541
vercel env add MF_CLIENT_SECRET production
# Vercel KV を作成して接続すると KV_REST_API_URL / KV_REST_API_TOKEN は自動付与される
```

## 初回の連携手順（1回だけ）

1. Vercel に `MF_CLIENT_ID` / `MF_CLIENT_SECRET`（と可能なら Vercel KV）を設定してデプロイ。
2. ブラウザで **`https://mitsumori-app-pied.vercel.app/api/mf-auth`** を開く。
   → MFの認可画面に飛ぶ（日本交通誘導でログイン済みのこと）。
3. 「許可」すると `/api/mf-callback` に戻り、`{"ok":true,...}` が表示される。
   - **Vercel KV を設定済み**なら access/refresh token はKVに保存され、以後は自動。
   - **KV未設定**なら応答に `refresh_token` が表示されるので、それを
     Vercel env `MF_REFRESH_TOKEN` に登録して再デプロイ（永続化）。
4. これで完了。アプリの「MFに見積を作成」ボタンが使えるようになる。

## トークンの更新と失効防止

- `access_token` は **1時間**有効。API呼び出し時に期限切れなら自動で `refresh_token` で更新する。
- `refresh_token` は **18か月**有効。ただし**使うたびに新しいものに置き換わる**ため、
  更新のたびKVへ書き戻す。
- 長期間未使用だと失効するリスクがあるため、**月1回ヘルスチェックを叩いて access_token を
  更新**しておくこと（refresh_token も新しくなり実質失効しない）。

### 月次ヘルスチェック（scheduled-task）

`GET https://mitsumori-app-pied.vercel.app/api/mf-health` を月1回叩く。
`{ ok: true, linked: true, tokenRefreshedAt: ... }` が返れば正常。
`linked: false` なら再連携（上記「初回の連携手順」）が必要。

## API エンドポイント

| ルート | 用途 |
|---|---|
| `GET /api/mf-auth` | OAuth認可フロー開始（MF認可画面へリダイレクト） |
| `GET /api/mf-callback` | 認可コード→トークン交換・保存 |
| `POST /api/mf-quote` | UIの見積データ→MF見積書を作成。`{quoteId, quoteNumber, pdfUrl}` を返す |
| `GET /api/mf-health` | 連携ヘルスチェック＋トークン更新（月次タスク用） |
| `GET /api/prices` | 単価データ（別担当） |

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
