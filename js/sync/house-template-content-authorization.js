(function(global){
  'use strict';
  var DENIED_MESSAGE='لا يمكنك تعديل هذا القالب لأنه مشترك معك للعرض والاستخدام فقط.';
  var COPY_DENIED_MESSAGE='لا يمكنك نسخ هذا القالب لأنه مشترك معك للعرض والاستخدام فقط.';
  function template(id){var rows=Array.isArray(global.appData&&global.appData.houseTemplates)?global.appData.houseTemplates:[];return rows.find(function(item){return String(item&&item.id||'')===String(id||'');})||null;}
  function canEdit(id){var item=typeof id==='object'?id:template(id),sync=global.OrganizationTemplateSync;return !!item&&!!sync&&typeof sync.canEditHouseTemplate==='function'&&sync.canEditHouseTemplate(item.id);}
  function requireEdit(id,options){if(canEdit(id))return true;options=options||{};if(options.silent!==true&&typeof global.showToast==='function')global.showToast(DENIED_MESSAGE,'#E74C3C');return false;}
  function requireCopy(id,options){if(canEdit(id))return true;options=options||{};if(options.silent!==true&&typeof global.showToast==='function')global.showToast(COPY_DENIED_MESSAGE,'#E74C3C');return false;}
  global.HouseTemplateContentAuthorization=Object.freeze({canEdit:canEdit,requireEdit:requireEdit,canCopy:canEdit,requireCopy:requireCopy,deniedMessage:DENIED_MESSAGE,copyDeniedMessage:COPY_DENIED_MESSAGE});
})(window);
