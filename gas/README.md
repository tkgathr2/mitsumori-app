# gas/ — みつもりくんの単価同期スクリプト

## 現行（正）: sync-v3-to-mitsumori.gs

西村さんのv3単価表(xlsx) → 本番DB `price_companies` を毎時同期する。

- Apps Script プロジェクト「みつもりくん 単価同期（西村さんv3シート→本番DB・毎時）」
  https://script.google.com/home/projects/1ts-r7K0fkMeGPdi8FVHWompKq0cEBTOZcC3FiAgnOMBHA8EPujbQzpqN/edit
- **このファイルはgit管理用の写し。GAS側を直したらここも更新すること。**
- 単価の正 ＝ 西村さんのv3シート（2026-07-16 西村さん確認済み）

## 旧（死んだ経路）: sync-to-vercel.gs

**使われていない。参考のため残置。**

- 送信先が旧Vercel URL・書き込み先が `price_cache`
- `price_cache` は `lib/prices-server.ts` の getPriceData() で
  「price_companies にactiveな会社が無いときだけ」読まれるフォールバック。
  本番には30社あるので**永久に読まれない**＝この経路は動いても見積画面に反映されない
- 毎時トリガー未設定・実行履歴0件で、一度も動いていなかった（2026-07-16 実測）
