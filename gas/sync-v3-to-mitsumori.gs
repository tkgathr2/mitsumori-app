/**
 * みつもりくん 単価同期：西村さんのv3単価表(xlsx) → 本番DB(price_companies)
 *
 * 【正本】Apps Script プロジェクト「みつもりくん 単価同期（西村さんv3シート→本番DB・毎時）」
 *   https://script.google.com/home/projects/1ts-r7K0fkMeGPdi8FVHWompKq0cEBTOZcC3FiAgnOMBHA8EPujbQzpqN/edit
 *   ※このファイルはgit管理用の写し。GAS側を直したらここも更新すること。
 *
 * 【なぜGASなのか】
 *   対象ファイルはGoogleスプレッドシートではなく **xlsx**（西村さんがSlackに添付したもの）。
 *   アプリのサービスアカウント(junkai-sheets@…)には共有されておらず、SAでは読めない（File not found 実測）。
 *   GASは社長アカウントの権限で動くため、共有依頼で人を待たずに読める。
 *
 * 【なぜ price_cache ではなく price_companies なのか】
 *   lib/prices-server.ts の getPriceData() は
 *     ①price_companies にactiveな会社があれば即return
 *     ②price_cache は①が空のときだけ読むフォールバック
 *   本番の①には30社あるため②は永久に読まれない。旧 gas/sync-to-vercel.gs は②に書いており、
 *   仮に動いても見積画面には一切反映されなかった（トリガー未設定・実行履歴0件で表面化せず）。
 *
 * 【設定】
 *   ・スクリプトプロパティ PRICE_SYNC_SECRET（値は ~/.claude/.secrets/mitsumori-price-sync.txt）
 *   ・サービス: Drive API v2（Drive.Files.copy を使うため）
 *   ・トリガー: syncToMitsumori 実行時に ensureHourlyTrigger_() が自己修復で張る
 *
 * 2026-07-16 西村さん確認済み「シートの金額が正しいのでシートに合わせて修正してください」
 */

var SRC_FILE_ID = '1_yO9wq5e-hng5LNdOX7tadDnFtKw-CfE';  // 見積単価_会社別_v3_備考付き.xlsx
var SHEET_NAME  = '一覧';                                 // gid=1307328336（西村さん指定 2026-07-14）
var ENDPOINT    = 'https://mitsumori.takagi.bz/api/prices/update';

var RATE_KEYS = ['ippan_day','ippan_day_ot','ippan_night','ippan_night_ot','ippan_holiday','ippan_holiday_ot',
                 'yushi_day','yushi_day_ot','yushi_night','yushi_night_ot','yushi_holiday','yushi_holiday_ot'];

/** xlsxはそのまま読めないのでGoogle形式へ変換コピーして読む。原本は変更しない（コピーは最後に破棄）。 */
function readV3Rows_() {
  var tmp = null;
  try {
    var res = Drive.Files.copy({ title: '_tmp_mitsumori_' + new Date().getTime(), mimeType: MimeType.GOOGLE_SHEETS },
                               SRC_FILE_ID, { supportsAllDrives: true });
    tmp = res.id;
    var sh = SpreadsheetApp.openById(tmp).getSheetByName(SHEET_NAME);
    if (!sh) throw new Error('シート「' + SHEET_NAME + '」なし');
    return sh.getDataRange().getValues();
  } finally {
    if (tmp) { try { DriveApp.getFileById(tmp).setTrashed(true); } catch (e) {} }
  }
}

// シートの生値は小数を含む（例：法定休日残業 =B13/8 → 24300/8 = 3037.5）。
// parseInt だと 3037 に切り捨てられ、シート表示の 3,038 と1円ズレる。
// 円単位の単価なので四捨五入で取る（＝シートの表示と一致させる）。
function toNum_(v) {
  var n = parseFloat(String(v == null ? '' : v).replace(/[,\s円]/g, '').trim());
  return isNaN(n) ? 0 : Math.round(n);
}

/** 一覧を {code,name,prices,hasPrice} の配列にする。A列が数字の行だけ拾う（ヘッダ4行を自動で除外）。 */
function parseV3_() {
  var rows = readV3Rows_(), out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!/^\d+$/.test(String(r[0] || '').trim())) continue;
    var code = String(r[1] || '').trim(), name = String(r[2] || '').trim();
    if (!name) continue;
    var prices = {}, has = false;
    for (var k = 0; k < RATE_KEYS.length; k++) {
      var v = toNum_(r[3 + k]);
      prices[RATE_KEYS[k]] = v;
      if (v > 0) has = true;
    }
    out.push({ code: code, name: name, prices: prices, hasPrice: has });
  }
  return out;
}

/** 毎時トリガーが無ければ張る（実行のたびに自己修復＝設定忘れで無言停止しない）。 */
function ensureHourlyTrigger_() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'syncToMitsumori'; });
  if (has) return;
  ScriptApp.newTrigger('syncToMitsumori').timeBased().everyHours(1).create();
  Logger.log('毎時トリガーを新規作成しました');
}

/** シートの単価を みつもりくん本番へ送る。route側が hasPrice:false をスキップし、差分のある区分だけ更新する。 */
function syncToMitsumori() {
  ensureHourlyTrigger_();
  var list = parseV3_();
  var withPrice = list.filter(function (c) { return c.hasPrice; });
  var secret = PropertiesService.getScriptProperties().getProperty('PRICE_SYNC_SECRET');
  if (!secret) throw new Error('スクリプトプロパティ PRICE_SYNC_SECRET が未設定です');
  var res = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-API-Key': secret },
    payload: JSON.stringify({ companies: list, source: 'GAS v3 sync ' + new Date().toISOString() }),
    muteHttpExceptions: true
  });
  Logger.log('会社数=' + list.length + ' 単価入り=' + withPrice.length);
  Logger.log('レスポンス ' + res.getResponseCode() + ': ' + res.getContentText());
  if (res.getResponseCode() !== 200) throw new Error('sync failed: ' + res.getResponseCode() + ' ' + res.getContentText());
}
