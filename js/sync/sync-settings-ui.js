(function(global){
  'use strict';
  var RUNTIME_BUILD_REVISION='member-runtime-trace-v1';

  var busy=false;
  var explicitConnectivity='unknown';
  var orchestratorSubscribed=false;
  var lastRenderedSyncFingerprint=null;
  var RENDERED_CONFERENCE_STATES=Object.freeze([
    'needs_resolution',
    'finalizing_conflict',
    'pending_local_application',
    'linked',
    'error'
  ]);

  function currentConference(){
    return typeof global.getCurrentConference==='function'
      ?global.getCurrentConference()
      :null;
  }

  function storedConferenceState(link){
    if(!link)return 'local_only';
    if(link.linkStatus==='needs_resolution'||
      ['active','pending','reviewed','changed'].indexOf(
        link.conflictStatus
      )>=0){
      return 'needs_resolution';
    }
    if(link.pendingLocalApplication===true||
      link.linkStatus==='server_selected_pending_local_apply'){
      return 'pending_local_application';
    }
    return link.linkStatus==='linked'?'linked':'local_only';
  }

  function syncStateFingerprint(state,localConferenceId){
    var store=global.ConferenceLinkStore;
    var link=store&&typeof store.get==='function'
      ?store.get(localConferenceId)
      :null;
    link=link||{};
    return [
      String(localConferenceId),
      String(state&&state.conferenceState||''),
      String(link.remoteConferenceId||''),
      String(link.linkStatus||''),
      String(link.conflictStatus||''),
      String(link.pendingLocalApplication===true),
      String(link.knownRevision==null?'':link.knownRevision),
      String(link.actualRevision==null?'':link.actualRevision)
    ].join('|');
  }

  function handleOrchestratorState(state){
    if(!state||RENDERED_CONFERENCE_STATES.indexOf(
      state.conferenceState
    )<0)return;
    var conference=currentConference();
    if(!conference)return;
    var localConferenceId=String(conference.id||'');
    if(!localConferenceId)return;
    var scopedConferenceId=state.linkedConferenceId||
      state.activeConferenceId||null;
    if(scopedConferenceId&&String(scopedConferenceId)!==
      localConferenceId)return;
    var store=global.ConferenceLinkStore;
    var link=store&&typeof store.get==='function'
      ?store.get(localConferenceId)
      :null;
    var storedState=storedConferenceState(link);
    if(!scopedConferenceId&&state.conferenceState!=='error'&&
      state.conferenceState!=='finalizing_conflict'&&
      state.conferenceState!==storedState){
      return;
    }
    var fingerprint=syncStateFingerprint(
      state,localConferenceId
    );
    if(fingerprint===lastRenderedSyncFingerprint)return;
    lastRenderedSyncFingerprint=fingerprint;
    rerender();
  }

  function ensureOrchestratorSubscription(){
    if(orchestratorSubscribed)return;
    var orchestrator=global.AutomaticSyncOrchestrator;
    if(!orchestrator||typeof orchestrator.subscribe!=='function')return;
    orchestratorSubscribed=true;
    orchestrator.subscribe(handleOrchestratorState);
  }

  function escapeHtml(value){
    return String(value==null?'':value)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

  function getConfigState(){
    var api=global.SupabaseRuntimeConfig;
    return api&&typeof api.getPublicState==='function'
      ?api.getPublicState()
      :{configured:false,url:'',maskedKey:''};
  }

  function getAuthState(){
    var api=global.SupabaseAuth;
    return api&&typeof api.getState==='function'
      ?api.getState()
      :{initialized:false,authenticated:false,user:null};
  }

  function getAutomaticSyncPreferences(){
    var api=global.AutomaticSyncPreferences;
    return api&&typeof api.get==='function'
      ?api.get()
      :{
        cloudSyncEnabled:false,
        automaticLinkingEnabled:true,
        automaticSyncEnabled:true
      };
  }

  function getDevice(){
    var api=global.SupabaseDeviceIdentity;
    try{
      return api&&typeof api.getOrCreate==='function'
        ?api.getOrCreate()
        :null;
    }catch(error){
      return null;
    }
  }

  function shortDeviceId(value){
    var id=String(value||'');
    return id?id.slice(0,8)+'…'+id.slice(-4):'غير متاح';
  }

  function statusBadge(text,positive){
    return '<span class="sync-settings-badge '+
      (positive?'sync-settings-ok':'sync-settings-muted')+'">'+
      escapeHtml(text)+'</span>';
  }
  function renderMemberRuntimeDiagnostics(){
    var service=global.MemberRuntimeDiagnostics;
    var state=service&&typeof service.read==='function'?service.read():{};
    var fields=service&&Array.isArray(service.fields)?service.fields:[];
    var html='<section class="settings-section sync-settings-section" '+
      'data-runtime-build="'+RUNTIME_BUILD_REVISION+'">';
    html+='<div class="settings-section-title">تشخيص مزامنة هذا الجهاز</div>';
    html+='<div class="sync-settings-panel"><table class="settings-table"><tbody>';
    fields.forEach(function(field){
      var value=state[field];
      if(value&&typeof value==='object')value=JSON.stringify(value);
      if(value===null||value===undefined||value==='')value='—';
      html+='<tr><td dir="ltr">'+escapeHtml(field)+'</td><td dir="ltr">'+
        escapeHtml(String(value))+'</td></tr>';
    });
    html+='</tbody></table></div></section>';
    return html;
  }

  function renderSection(){
    ensureOrchestratorSubscription();
    var config=getConfigState();
    var auth=getAuthState();
    var device=getDevice();
    var preferences=getAutomaticSyncPreferences();
    var email=auth.user&&auth.user.email?auth.user.email:'';
    var html=renderMemberRuntimeDiagnostics();
    html+='<section class="settings-section sync-settings-section">';
    html+='<div class="settings-section-title">المزامنة والأجهزة</div>';
    html+='<div class="sync-settings-status">';
    html+=statusBadge('الوضع المحلي متاح دائمًا',true);
    html+=statusBadge(config.configured?'Supabase مهيأ':'Supabase غير مهيأ',
      config.configured);
    html+=statusBadge(auth.authenticated?'تم تسجيل الدخول':'غير مسجل',
      auth.authenticated);
    html+=statusBadge(
      explicitConnectivity==='online'?'متصل بالإنترنت':
      explicitConnectivity==='offline'?'غير متصل بالإنترنت':
      'حالة الإنترنت غير محددة',
      explicitConnectivity==='online'
    );
    html+='</div>';
    html+='<div class="sync-settings-grid">';
    html+='<div class="sync-settings-panel"><h3>إعداد الاتصال</h3>';
    html+='<label class="lbl" for="sync_supabase_url">Supabase URL</label>';
    html+='<input id="sync_supabase_url" type="url" dir="ltr" autocomplete="off" value="'+
      escapeHtml(config.url)+'" placeholder="https://project.supabase.co">';
    html+='<label class="lbl" for="sync_supabase_key">Supabase Anon Key</label>';
    html+='<input id="sync_supabase_key" type="password" dir="ltr" autocomplete="new-password" value="" placeholder="'+
      escapeHtml(config.maskedKey||'أدخل المفتاح العام')+'">';
    html+='<label class="lbl" for="sync_auth_redirect_url">Email Redirect URL</label>';
    html+='<input id="sync_auth_redirect_url" type="url" dir="ltr" autocomplete="off" value="'+
      escapeHtml(config.emailRedirectTo||'')+'" placeholder="'+
      escapeHtml(global.location&&global.location.origin||'https://example.com')+'">';
    html+='<div class="sync-settings-actions"><button class="btn btn-green btn-sm" onclick="SyncSettingsUI.saveRuntimeConfig()">حفظ الإعداد</button>';
    html+='<button class="btn btn-gray btn-sm" onclick="SyncSettingsUI.clearRuntimeConfig()">إزالة الإعداد</button></div>';
    html+='<div id="sync_config_message" class="sync-settings-message"></div></div>';
    html+='<div class="sync-settings-panel"><h3>الحساب</h3>';
    if(auth.authenticated){
      html+='<div class="sync-settings-user">المستخدم: <strong>'+
        escapeHtml(email)+'</strong></div>';
      html+='<button class="btn btn-red btn-sm" onclick="SyncSettingsUI.signOut()">تسجيل الخروج</button>';
    }else{
      html+='<label class="lbl" for="sync_auth_email">Email</label>';
      html+='<input id="sync_auth_email" type="email" dir="ltr" autocomplete="username">';
      html+='<label class="lbl" for="sync_auth_password">Password</label>';
      html+='<input id="sync_auth_password" type="password" dir="ltr" autocomplete="current-password">';
      html+='<div class="sync-settings-actions"><button class="btn btn-blue btn-sm" onclick="SyncSettingsUI.signIn()">تسجيل الدخول</button>';
      html+='<button class="btn btn-purple btn-sm" onclick="SyncSettingsUI.signUp()">إنشاء حساب</button>';
      html+='<button class="btn btn-gray btn-sm" onclick="SyncSettingsUI.refreshAuthState()">قراءة حالة الحساب</button></div>';
    }
    html+='<div id="sync_auth_message" class="sync-settings-message"></div></div>';
    html+='<div class="sync-settings-panel"><h3>هذا الجهاز</h3>';
    html+='<div class="sync-settings-device-id">Device ID: <strong dir="ltr">'+
      escapeHtml(shortDeviceId(device&&device.id))+'</strong></div>';
    html+='<label class="lbl" for="sync_device_name">اسم الجهاز المحلي</label>';
    html+='<input id="sync_device_name" type="text" maxlength="80" value="'+
      escapeHtml(device&&device.deviceName||'')+'" placeholder="جهاز المكتب">';
    html+='<button class="btn btn-green btn-sm" onclick="SyncSettingsUI.saveDeviceName()">حفظ اسم الجهاز</button>';
    html+='<div id="sync_device_message" class="sync-settings-message"></div></div>';
    html+='<div class="sync-settings-panel"><h3>خيارات المزامنة</h3>';
    html+='<label class="lbl"><input id="sync_cloud_enabled" type="checkbox" '+
      (preferences.cloudSyncEnabled?'checked ':'')+
      'onchange="SyncSettingsUI.saveAutomaticSyncPreferences()"> تفعيل المزامنة السحابية</label>';
    html+='<label class="lbl"><input id="sync_automatic_linking_enabled" type="checkbox" '+
      (preferences.automaticLinkingEnabled?'checked ':'')+
      'onchange="SyncSettingsUI.saveAutomaticSyncPreferences()"> تفعيل الربط التلقائي</label>';
    html+='<label class="lbl"><input id="sync_automatic_sync_enabled" type="checkbox" '+
      (preferences.automaticSyncEnabled?'checked ':'')+
      'onchange="SyncSettingsUI.saveAutomaticSyncPreferences()"> تفعيل المزامنة التلقائية</label>';
    html+='<div id="sync_preferences_message" class="sync-settings-message"></div></div>';
    html+='</div></section>';
    return html;
  }

  function element(id){
    return global.document?global.document.getElementById(id):null;
  }

  function message(id,text,isError){
    var target=element(id);
    if(!target)return;
    target.textContent=text||'';
    target.className='sync-settings-message'+
      (isError?' sync-settings-error':' sync-settings-success');
  }

  function rerender(){
    if(typeof global.renderSettings==='function')global.renderSettings();
  }
  function scheduleAuthChanged(){
    if(global.AutomaticSyncOrchestrator&&
      typeof global.AutomaticSyncOrchestrator.schedule==='function'){
      global.AutomaticSyncOrchestrator.schedule('auth_changed');
    }
  }

  function setBusy(value){
    busy=!!value;
    if(!global.document||
      typeof global.document.querySelectorAll!=='function')return;
    var buttons=global.document.querySelectorAll(
      '.sync-settings-section button'
    );
    Array.prototype.forEach.call(buttons,function(button){
      button.disabled=busy;
    });
  }

  function saveRuntimeConfig(){
    var url=element('sync_supabase_url');
    var key=element('sync_supabase_key');
    var redirect=element('sync_auth_redirect_url');
    var api=global.SupabaseRuntimeConfig;
    if(!api||busy)return;
    var result=api.save({
      url:url&&url.value,
      publishableKey:key&&key.value,
      emailRedirectTo:redirect&&redirect.value
    });
    if(!result.ok){
      message('sync_config_message',
        result.errors.indexOf('SUPABASE_SERVICE_ROLE_KEY_REJECTED')>=0
          ?'تم رفض المفتاح السري. استخدم Anon Key فقط.'
          :'إعداد الاتصال غير صالح.',
        true);
      return;
    }
    api.configureClient();
    if(key)key.value='';
    rerender();
  }

  function clearRuntimeConfig(){
    if(busy||!global.SupabaseRuntimeConfig)return;
    global.SupabaseRuntimeConfig.clear();
    rerender();
  }

  function authFields(){
    return {
      email:String(element('sync_auth_email')&&
        element('sync_auth_email').value||'').trim(),
      password:String(element('sync_auth_password')&&
        element('sync_auth_password').value||'')
    };
  }

  function safeAuthMessage(result,successText){
    if(result&&result.success)return successText;
    var code=result&&result.error&&result.error.code;
    if(code==='SUPABASE_AUTH_UNAVAILABLE'){
      return 'خدمة تسجيل الدخول غير مهيأة.';
    }
    return 'تعذر إكمال الطلب. تحقق من البيانات والاتصال.';
  }

  function prepareAuth(){
    var config=global.SupabaseRuntimeConfig;
    if(!config)return Promise.resolve(false);
    var configured=config.configureClient();
    if(!configured.available)return Promise.resolve(false);
    return global.SupabaseAuth.initialize().then(function(){return true;});
  }

  function runAuth(action,successText){
    if(busy)return;
    setBusy(true);
    var fields=authFields();
    var passwordElement=element('sync_auth_password');
    prepareAuth().then(function(ready){
      if(!ready)return {success:false,error:{code:'SUPABASE_AUTH_UNAVAILABLE'}};
      return action(fields.email,fields.password);
    }).then(function(result){
      if(passwordElement)passwordElement.value='';
      if(result&&result.success){
        scheduleAuthChanged();
        rerender();
      }else{
        message('sync_auth_message',safeAuthMessage(result,successText),true);
      }
    }).catch(function(){
      message('sync_auth_message','تعذر إكمال الطلب بأمان.',true);
    }).then(function(){setBusy(false);});
  }

  function signIn(){
    runAuth(function(email,password){
      return global.SupabaseAuth.signInWithPassword(email,password);
    },'تم تسجيل الدخول.');
  }

  function signUp(){
    if(busy)return;
    setBusy(true);
    var fields=authFields();
    var passwordElement=element('sync_auth_password');
    prepareAuth().then(function(ready){
      if(!ready)return {success:false,error:{code:'SUPABASE_AUTH_UNAVAILABLE'}};
      return global.SupabaseAuth.signUp(fields.email,fields.password);
    }).then(function(result){
      if(passwordElement)passwordElement.value='';
      if(!result||!result.success){
        message('sync_auth_message',safeAuthMessage(result,''),true);
        return;
      }
      var session=result.data&&result.data.session;
      if(session){
        scheduleAuthChanged();
        rerender();
        return;
      }
      message(
        'sync_auth_message',
        'تم إنشاء الحساب، راجع بريدك لتأكيده ثم سجل الدخول.',
        false
      );
    }).catch(function(){
      message('sync_auth_message','تعذر إكمال الطلب بأمان.',true);
    }).then(function(){setBusy(false);});
  }

  function signOut(){
    if(busy||!global.SupabaseAuth)return;
    if(global.RealtimeLocksUI&&
      typeof global.RealtimeLocksUI.hasOwnedLock==='function'&&
      global.RealtimeLocksUI.hasOwnedLock()&&global.confirm&&
      !global.confirm(
        'هذا الجهاز يملك قفلًا ساريًا. تسجيل الخروج لن يحرره تلقائيًا. هل تريد المتابعة؟'
      ))return;
    setBusy(true);
    var cleanup=global.ConferenceOperationalUI&&
      typeof global.ConferenceOperationalUI.logoutCleanup==='function'
      ?global.ConferenceOperationalUI.logoutCleanup()
      :Promise.resolve();
    Promise.resolve(cleanup).then(function(){
      return global.SupabaseAuth.signOut();
    }).then(function(result){
      if(result&&result.success){
        scheduleAuthChanged();
        rerender();
      }
      else message('sync_auth_message','تعذر تسجيل الخروج.',true);
    }).catch(function(){
      message('sync_auth_message','تعذر تسجيل الخروج بأمان.',true);
    }).then(function(){setBusy(false);});
  }

  function refreshAuthState(){
    if(busy)return;
    setBusy(true);
    prepareAuth().then(function(ready){
      if(ready)rerender();
      else message('sync_auth_message','خدمة تسجيل الدخول غير مهيأة.',true);
    }).catch(function(){
      message('sync_auth_message','تعذر قراءة حالة الحساب بأمان.',true);
    }).then(function(){setBusy(false);});
  }

  function saveDeviceName(){
    var input=element('sync_device_name');
    var api=global.SupabaseDeviceIdentity;
    if(!api||typeof api.setDeviceName!=='function')return;
    var result=api.setDeviceName(input&&input.value);
    message('sync_device_message',
      result.success?'تم حفظ اسم الجهاز محليًا.':'تعذر حفظ اسم الجهاز.',
      !result.success);
  }

  function saveAutomaticSyncPreferences(){
    var api=global.AutomaticSyncPreferences;
    if(!api||typeof api.set!=='function')return;
    var current=getAutomaticSyncPreferences();
    var cloud=element('sync_cloud_enabled');
    var linking=element('sync_automatic_linking_enabled');
    var automatic=element('sync_automatic_sync_enabled');
    var saved=api.set({
      cloudSyncEnabled:cloud?cloud.checked:current.cloudSyncEnabled,
      automaticLinkingEnabled:linking
        ?linking.checked
        :current.automaticLinkingEnabled,
      automaticSyncEnabled:automatic
        ?automatic.checked
        :current.automaticSyncEnabled
    });
    message(
      'sync_preferences_message',
      saved&&saved.ok
        ?'تم حفظ خيارات المزامنة.'
        :'تعذر حفظ خيارات المزامنة.',
      !(saved&&saved.ok)
    );
    return saved;
  }

  function setConnectivity(value){
    explicitConnectivity=value==='online'||value==='offline'
      ?value
      :'unknown';
    rerender();
  }

  function getState(){
    return {
      busy:busy,
      connectivity:explicitConnectivity,
      configured:getConfigState().configured,
      authenticated:getAuthState().authenticated
    };
  }

  global.SyncSettingsUI=Object.freeze({
    renderSection:renderSection,
    saveRuntimeConfig:saveRuntimeConfig,
    clearRuntimeConfig:clearRuntimeConfig,
    signIn:signIn,
    signUp:signUp,
    signOut:signOut,
    refreshAuthState:refreshAuthState,
    saveDeviceName:saveDeviceName,
    saveAutomaticSyncPreferences:saveAutomaticSyncPreferences,
    setConnectivity:setConnectivity,
    getState:getState
  });
})(window);
