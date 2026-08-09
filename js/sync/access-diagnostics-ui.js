(function(global){
  'use strict';
  var DEVICE_FIELDS=['stage','rpc','errorCode','sqlstate','httpStatus','sanitizedMessage','deviceIdPresent','authenticatedUserPresent','accountApproved','serverDeviceRowPresent','timestamp'];
  var ORGANIZATION_FIELDS=['stage','rpc','errorCode','sqlstate','sanitizedMessage','actorDevicePresent','actorDeviceApproved','targetAccountApproved','organizationIdPresent','timestamp'];
  var lastDiagnostic=null;
  function escapeHtml(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function clean(value){if(value===true||value===false||typeof value==='number')return value;if(value==null)return null;return String(value).slice(0,160);}
  function sanitize(diagnostic,type){var fields=type==='organization'?ORGANIZATION_FIELDS:DEVICE_FIELDS,output={};fields.forEach(function(field){output[field]=clean(diagnostic&&diagnostic[field]);});return output;}
  function render(diagnostic,type){if(!diagnostic)return '';lastDiagnostic=sanitize(diagnostic,type);var rows=Object.keys(lastDiagnostic).map(function(key){return '<div><strong>'+escapeHtml(key)+':</strong> <span dir="ltr">'+escapeHtml(lastDiagnostic[key])+'</span></div>';}).join('');return '<section class="access-diagnostics"><div class="settings-section-title">تشخيص آخر عملية وصول</div><div class="sync-settings-message">'+rows+'</div><button type="button" class="btn btn-gray btn-sm" onclick="AccessDiagnosticsUI.copyLast()">نسخ التشخيص</button></section>';}
  function copyLast(){var text=lastDiagnostic?JSON.stringify(lastDiagnostic,null,2):'';if(!text)return Promise.resolve(false);if(global.navigator&&global.navigator.clipboard&&typeof global.navigator.clipboard.writeText==='function')return global.navigator.clipboard.writeText(text).then(function(){return true;});return Promise.resolve(false);}
  global.AccessDiagnosticsUI=Object.freeze({render:render,copyLast:copyLast,sanitize:sanitize});
})(window);
