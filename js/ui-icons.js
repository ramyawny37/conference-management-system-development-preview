(function(global){
  'use strict';

  var paths={
    home:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/>',
    bed:'<path d="M3 5v15M21 20v-8a3 3 0 0 0-3-3H9v11M3 15h18"/><path d="M7 9V6h4a2 2 0 0 1 2 2v1"/>',
    building:'<path d="M5 21V4l7-2v19M12 7h7v14M3 21h18"/><path d="M8 6v2m0 3v2m0 3v2m7-7v2m0 3v2"/>',
    users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    bus:'<rect x="4" y="3" width="16" height="16" rx="3"/><path d="M4 12h16M8 7h8M7 19v2m10-2v2"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/>',
    food:'<path d="M7 3v8m-3-8v5a3 3 0 0 0 6 0V3M7 11v10M17 3v18M17 3c-3 3-3 8 0 10"/>',
    money:'<path d="M12 2v20M17 6.5A4 4 0 0 0 13.5 5h-3a3.5 3.5 0 0 0 0 7h3a3.5 3.5 0 0 1 0 7h-3A4 4 0 0 1 7 17.5"/>',
    chart:'<path d="M4 20V10m6 10V4m6 16v-7m4 7H2"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1v.1h-4v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    key:'<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-3 3 3 3m-6 0 3 3"/>',
    chevronDown:'<path d="m6 9 6 6 6-6"/>',chevronUp:'<path d="m18 15-6-6-6 6"/>',
    checkCircle:'<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',circle:'<circle cx="12" cy="12" r="8"/>',
    eye:'<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',
    door:'<path d="M5 21V3h12v18M5 21h14M13 12h.01"/>',
    note:'<path d="M5 3h14v18H5zM8 8h8M8 12h8M8 16h5"/>',
    lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    boxes:'<path d="m12 2 8 4.5v9L12 20l-8-4.5v-9L12 2Z"/><path d="m4 6.5 8 4.5 8-4.5M12 11v9M8 4.3l8 4.5"/>',
    warehouse:'<path d="M3 21V8l9-5 9 5v13M7 21v-8h10v8M7 16h10"/>',
    receipt:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    packageOpen:'<path d="m3 8 9 5 9-5M12 13v9M4 8l8-5 8 5v9l-8 5-8-5V8Z"/><path d="m8 5 8 5"/>',
    transfer:'<path d="M4 7h15m0 0-3-3m3 3-3 3M20 17H5m0 0 3 3m-3-3 3-3"/>',
    approval:'<path d="M9 5H6a2 2 0 0 0-2 2v12h16V7a2 2 0 0 0-2-2h-3M9 3h6v4H9z"/><path d="m8 13 2.5 2.5L16 10"/>',
    adjustment:'<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    history:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    balance:'<path d="M4 19h16M6 16V9m4 7V5m4 11v-4m4 4V7"/>',
    report:'<path d="M5 3h14v18H5z"/><path d="M9 16v-3m3 3V8m3 8v-5"/>',
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
    panelClose:'<path d="M4 4h16v16H4zM10 4v16m4-11-3 3 3 3"/>',
    modules:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>'
  };

  function icon(name,className,title){
    var body=paths[name]||paths.circle;
    return '<svg class="app-icon '+String(className||'')+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"'+(title?' data-icon-title="'+String(title).replace(/"/g,'&quot;')+'"':'')+'>'+body+'</svg>';
  }

  function hydrate(root){
    var scope=root&&root.querySelectorAll?root:document;
    Array.prototype.forEach.call(scope.querySelectorAll('[data-app-icon]'),function(target){
      target.innerHTML=icon(target.getAttribute('data-app-icon'),'','');
    });
  }

  global.AppIcons=Object.freeze({icon:icon,hydrate:hydrate});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){hydrate(document);});
  else hydrate(document);
})(window);
