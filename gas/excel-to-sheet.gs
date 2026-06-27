/**
 * GASスクリプト: v3 Excel（Driveフォルダ）→ Googleスプレッドシート 自動インポート
 *
 * 【設定手順】
 * 1. sync-to-vercel.gs と同じGASプロジェクトに追加
 * 2. スクリプトプロパティに「EXCEL_FOLDER_ID」を追加（共有フォルダのID）
 * 3. setupExcelImportTrigger() を一度だけ手動実行
 *
 * 【動作フロー】
 * 毎時実行 → Driveフォルダを監視 → 新しいExcelを検出 → Google Sheetsに変換
 * → マスタシートに書き込み → syncToVercel() でVercelに送信
 */

function importExcelAndSync() {
  var folderId = PropertiesService.getScriptProperties().getProperty('EXCEL_FOLDER_ID');
  if (!folderId) {
    Logger.log('ERROR: EXCEL_FOLDER_ID が設定されていません');
    return;
  }

  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFiles();
  var newestFile = null;
  var newestTime = 0;

  while (files.hasNext()) {
    var f = files.next();
    var mime = f.getMimeType();
    if (mime !== MimeType.MICROSOFT_EXCEL && mime !== MimeType.MICROSOFT_EXCEL_LEGACY) {
      continue;
    }
    var modTime = f.getLastUpdated().getTime();
    if (modTime > newestTime) {
      newestTime = modTime;
      newestFile = f;
    }
  }

  if (!newestFile) {
    Logger.log('Excelファイルが見つかりません');
    return;
  }

  // 前回インポート済みなら何もしない
  var props = PropertiesService.getScriptProperties();
  var lastImport = parseInt(props.getProperty('LAST_EXCEL_IMPORT') || '0', 10);
  if (newestTime <= lastImport) {
    Logger.log('変更なし（最終更新: ' + new Date(newestTime).toISOString() + '）');
    return;
  }

  Logger.log('新しいExcel検出: ' + newestFile.getName());

  // Drive REST API で Excel → Google Sheets に変換コピー
  var token = ScriptApp.getOAuthToken();
  var copyRes = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + newestFile.getId() + '/copy',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({
        name: '__mitsumori_tmp_import__',
        mimeType: 'application/vnd.google-apps.spreadsheet'
      }),
      muteHttpExceptions: true
    }
  );

  if (copyRes.getResponseCode() !== 200) {
    Logger.log('ERROR: Excel変換失敗: ' + copyRes.getContentText());
    return;
  }

  var tempId = JSON.parse(copyRes.getContentText()).id;
  Logger.log('変換完了（一時シートID: ' + tempId + '）');

  try {
    // 変換シートのデータを読む
    var tempSs = SpreadsheetApp.openById(tempId);
    var importedData = tempSs.getSheets()[0].getDataRange().getValues();

    // マスタシートに上書き
    var masterSs = SpreadsheetApp.openById(SPREADSHEET_ID);
    var masterSheet = masterSs.getSheets()[0];
    masterSheet.clearContents();
    if (importedData.length > 0 && importedData[0].length > 0) {
      masterSheet.getRange(1, 1, importedData.length, importedData[0].length).setValues(importedData);
    }
    Logger.log('マスタシート更新完了: ' + importedData.length + '行');

    props.setProperty('LAST_EXCEL_IMPORT', String(newestTime));

  } finally {
    // 一時ファイルを削除
    UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + tempId,
      {
        method: 'delete',
        headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
        muteHttpExceptions: true
      }
    );
    Logger.log('一時ファイル削除完了');
  }

  // Vercelに同期
  syncToVercel();
}

/** 毎時トリガー設定（初回1回だけ実行） */
function setupExcelImportTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'importExcelAndSync') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('importExcelAndSync')
    .timeBased()
    .everyHours(1)
    .create();
  Logger.log('毎時トリガー（importExcelAndSync）を設定しました。');
}
