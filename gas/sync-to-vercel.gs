/**
 * GASスクリプト: Googleスプレッドシート → mitsumori-app 単価同期
 *
 * 【設定手順】
 * 1. このスクリプトを単価マスタスプレッドシートのスクリプトエディタに貼り付け
 * 2. プロジェクトの設定 → スクリプトのプロパティ → 「PRICE_SYNC_SECRET」を追加
 *    値は ~/.claude/.secrets/mitsumori-price-sync.txt を参照
 * 3. setupHourlyTrigger() を一度だけ手動実行してタイマー設定
 *
 * 【スプレッドシートの列構成 (A〜O)】
 *   A=No, B=会社コード, C=会社名
 *   D=一般昼基本, E=一般昼残業, F=一般夜勤, G=一般夜勤残業, H=一般法定休日, I=一般法定休日残業
 *   J=有資格昼基本, K=有資格昼残業, L=有資格夜勤, M=有資格夜勤残業, N=有資格法定休日, O=有資格法定休日残業
 */

var VERCEL_ENDPOINT = 'https://mitsumori-app-pied.vercel.app/api/prices/update';
var SPREADSHEET_ID = '1LPgDarhRJJU_j7vywFI6kSOH8d6kvTPjsGkz--kkiCY';

var RATE_KEYS = [
  'ippan_day', 'ippan_day_ot',
  'ippan_night', 'ippan_night_ot',
  'ippan_holiday', 'ippan_holiday_ot',
  'yushi_day', 'yushi_day_ot',
  'yushi_night', 'yushi_night_ot',
  'yushi_holiday', 'yushi_holiday_ot'
];

function toNum(val) {
  var n = parseInt(String(val || '').replace(/[,\s]/g, '').trim(), 10);
  return isNaN(n) ? 0 : n;
}

function parseCompanies(rows) {
  var companies = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var no = String(r[0] || '').trim();
    if (!/^\d+$/.test(no)) continue; // A列が数字のみ＝データ行
    var code = String(r[1] || '').trim();
    var name = String(r[2] || '').trim();
    if (!name) continue;
    var prices = {};
    for (var j = 0; j < RATE_KEYS.length; j++) {
      prices[RATE_KEYS[j]] = toNum(r[3 + j]);
    }
    var hasPrice = Object.keys(prices).some(function(k) { return prices[k] > 0; });
    companies.push({ code: code, name: name, prices: prices, hasPrice: hasPrice });
  }
  return companies;
}

function syncToVercel() {
  var secret = PropertiesService.getScriptProperties().getProperty('PRICE_SYNC_SECRET');
  if (!secret) {
    Logger.log('ERROR: スクリプトプロパティに PRICE_SYNC_SECRET が設定されていません');
    return;
  }

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();

  var companies = parseCompanies(data);
  Logger.log('パース完了: ' + companies.length + '社');

  if (companies.length === 0) {
    Logger.log('ERROR: 会社データが見つかりませんでした。シート構成を確認してください。');
    return;
  }

  var now = new Date();
  var payload = {
    companies: companies,
    source: 'GAS sync ' + now.toISOString()
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-API-Key': secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(VERCEL_ENDPOINT, options);
  var code = response.getResponseCode();
  var body = response.getContentText();
  Logger.log('レスポンス ' + code + ': ' + body);

  if (code !== 200) {
    throw new Error('sync failed: ' + code + ' ' + body);
  }
  Logger.log('同期完了: ' + companies.length + '社');
}

/** 毎時トリガー設定（初回1回だけ実行） */
function setupHourlyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncToVercel') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('syncToVercel')
    .timeBased()
    .everyHours(1)
    .create();
  Logger.log('毎時トリガーを設定しました。');
}
