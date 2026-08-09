(function(global){
  'use strict';

  var requestCounter=0;
  var context=null;
  var activeRequests=Object.create(null);
  var refreshFlight=null;
  var lookupFlight=null;
  var targetFlights=Object.create(null);
  var autoRefreshedContextKey=null;
  var state=createState();

  function createState(){
    return {
      accessStatus:'idle',
      role:null,
      canManageMembers:false,
      membersStatus:'idle',
      members:[],
      lookupStatus:'idle',
      lookupResult:null,
      mutationStatus:'idle',
      mutationTargetUserId:null,
      message:'',
      messageKind:'info',
      staleMembers:false
    };
  }

  function escapeHtml(value){
    return String(value==null?'':value)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

  function currentConference(){
    return typeof global.getCurrentConference==='function'
      ?global.getCurrentConference()
      :null;
  }

  function currentRemoteConferenceId(localConferenceId){
    var store=global.ConferenceLinkStore;
    var link=store&&typeof store.get==='function'
      ?store.get(localConferenceId)
      :null;
    return String(link&&link.remoteConferenceId||'');
  }

  function normalizeContext(options){
    options=options||{};
    var local=options.localConference||null;
    return {
      localConferenceId:String(local&&local.id||''),
      remoteConferenceId:String(options.remoteConferenceId||'')
    };
  }

  function contextKey(value){
    return [
      String(value&&value.localConferenceId||''),
      String(value&&value.remoteConferenceId||'')
    ].join('|');
  }

  function setContext(options){
    var next=normalizeContext(options);
    if(contextKey(next)!==contextKey(context)){
      context=next;
      state=createState();
      activeRequests=Object.create(null);
      refreshFlight=null;
      lookupFlight=null;
      targetFlights=Object.create(null);
      autoRefreshedContextKey=null;
    }
    return context;
  }

  function isContextCurrent(scope){
    if(!scope||!context)return false;
    if(scope.localConferenceId!==context.localConferenceId||
      scope.remoteConferenceId!==context.remoteConferenceId){
      return false;
    }
    var local=currentConference();
    if(String(local&&local.id||'')!==scope.localConferenceId){
      return false;
    }
    return currentRemoteConferenceId(scope.localConferenceId)===
      scope.remoteConferenceId;
  }

  function requestKey(type,targetUserId){
    return type+'|'+String(targetUserId||'');
  }

  function createRequestScope(type,targetUserId){
    requestCounter++;
    var scope={
      localConferenceId:String(context&&context.localConferenceId||''),
      remoteConferenceId:String(context&&context.remoteConferenceId||''),
      requestId:'membership-ui-'+requestCounter
    };
    activeRequests[requestKey(type,targetUserId)]=scope.requestId;
    return scope;
  }

  function isActive(scope,type,targetUserId){
    return isContextCurrent(scope)&&
      activeRequests[requestKey(type,targetUserId)]===scope.requestId;
  }

  function element(id){
    return global.document&&
      typeof global.document.getElementById==='function'
      ?global.document.getElementById(id)
      :null;
  }

  function setMessage(text,kind){
    state.message=String(text||'');
    state.messageKind=kind||'info';
  }

  function errorMessage(result){
    var status=String(result&&result.status||'');
    if(status==='auth_required'){
      return 'انتهت جلسة تسجيل الدخول. سجّل الدخول مرة أخرى.';
    }
    if(status==='access_denied'){
      return 'لا يملك هذا الحساب صلاحية الوصول إلى أعضاء المؤتمر.';
    }
    if(status==='network_error'){
      return 'تعذر الاتصال بالخادم. تحقق من الاتصال ثم أعد المحاولة.';
    }
    if(status==='unknown_completion_state'){
      return 'تعذر تأكيد نتيجة العملية. قد تكون نُفذت على الخادم، ويمكن إعادة المحاولة بأمان.';
    }
    if(status==='target_not_found'||status==='not_found'){
      return 'لم يتم العثور على مستخدم متاح بهذه البيانات.';
    }
    if(status==='operation_mismatch'){
      return 'تعذر استكمال العملية السابقة بأمان.';
    }
    return 'تعذر إكمال طلب إدارة الأعضاء بأمان.';
  }

  function statusClass(){
    if(state.messageKind==='error')return ' sync-settings-error';
    if(state.messageKind==='success')return ' sync-settings-success';
    return '';
  }

  function roleText(role){
    if(role==='owner')return 'المالك';
    if(role==='manager')return 'مدير';
    if(role==='accommodation_viewer')return 'مشاهد التسكين';
    if(role==='transport_viewer')return 'مشاهد النقل';
    return 'مشاهد';
  }

  function roleOptions(selected){
    return ['manager','viewer','accommodation_viewer',
      'transport_viewer'].map(function(role){
      return '<option value="'+role+'" '+
        (role===selected?'selected ':'')+'>'+escapeHtml(roleText(role))+
        '</option>';
    }).join('');
  }

  function renderMembers(){
    if(state.membersStatus==='loading'){
      return '<div class="settings-empty-state">جارٍ تحميل أعضاء المؤتمر…</div>';
    }
    if(state.membersStatus==='error'&&!state.members.length){
      return '<div class="settings-empty-state">تعذر تحميل قائمة الأعضاء.</div>';
    }
    if(!state.members.length){
      return '<div class="settings-empty-state">لا يوجد أعضاء متاحون لهذا المؤتمر.</div>';
    }
    var html='<div class="settings-list">';
    state.members.forEach(function(member){
      var targetId=String(member.userId||'');
      var busy=!!targetFlights[targetId];
      html+='<div class="settings-list-item"><div><strong>'+
        escapeHtml(member.displayName||'مستخدم بدون اسم')+
        '</strong><div class="sync-settings-message">'+
        escapeHtml(roleText(member.role))+
        (member.isCurrentUser?' — الحساب الحالي':'')+
        '</div></div>';
      if(state.canManageMembers&&member.role!=='owner'){
        html+='<div class="sync-settings-actions">'+
          '<select aria-label="Member role" '+(busy?'disabled ':'')+
          'onchange="ConferenceMembersUI.changeRole(\''+
          escapeHtml(targetId)+'\',this.value)">'+
          roleOptions(member.role)+'</select>'+
          '<button type="button" class="btn btn-red btn-sm" '+
          (busy?'disabled ':'')+
          'onclick="ConferenceMembersUI.removeMember(\''+
          escapeHtml(targetId)+'\')">'+
          (busy?'جارٍ التنفيذ…':'إزالة العضو')+'</button>';
        html+='</div>';
      }
      html+='</div>';
    });
    return html+'</div>';
  }

  function renderManagement(){
    if(!state.canManageMembers)return '';
    var html='<div class="sync-settings-panel">'+
      '<h3>إضافة عضو</h3>'+
      '<label class="lbl" for="conference_member_lookup_email">البريد الإلكتروني</label>'+
      '<input id="conference_member_lookup_email" type="email" dir="ltr" '+
      'autocomplete="off" placeholder="manager@example.com">'+
      '<div class="sync-settings-actions">'+
      '<button type="button" class="btn btn-blue btn-sm" '+
      (state.lookupStatus==='loading'?'disabled ':'')+
      'onclick="ConferenceMembersUI.lookup()">'+
      (state.lookupStatus==='loading'?'جارٍ البحث…':'بحث')+
      '</button>';
    if(state.lookupResult){
      var targetId=String(state.lookupResult.targetUserId||'');
      var owner=state.members.some(function(member){
        return member.userId===targetId&&member.role==='owner';
      });
      if(owner){
        html+='<span class="sync-settings-message">هذا المستخدم هو مالك المؤتمر.</span>';
      }else{
        html+='<select id="conference_member_role" aria-label="Member role">'+
          roleOptions('manager')+'</select>'+
          '<button type="button" class="btn btn-green btn-sm" '+
          (targetFlights[targetId]?'disabled ':'')+
          'onclick="ConferenceMembersUI.addMember()">'+
          (targetFlights[targetId]?'جارٍ التنفيذ…':'إضافة العضو')+
          '</button>';
      }
      html+='</div><div class="sync-settings-message">المستخدم: <strong>'+
        escapeHtml(state.lookupResult.displayName||'مستخدم بدون اسم')+
        '</strong></div>';
    }else{
      html+='</div>';
    }
    return html+'</div>';
  }

  function renderBody(){
    if(!context||!context.localConferenceId){
      return '<div class="settings-empty-state">اختر مؤتمرًا محليًا أولًا.</div>';
    }
    if(!context.remoteConferenceId){
      return '<div class="settings-empty-state">اربط المؤتمر بنسخة سحابية لإدارة الأعضاء.</div>';
    }
    if(state.accessStatus==='idle'||state.accessStatus==='loading'){
      return '<div class="settings-empty-state">جارٍ قراءة صلاحيات المؤتمر…</div>';
    }
    if(state.accessStatus==='auth_required'){
      return '<div class="sync-settings-message sync-settings-error">'+
        escapeHtml(errorMessage({status:'auth_required'}))+'</div>';
    }
    if(state.accessStatus!=='available'){
      return '<div class="sync-settings-message sync-settings-error">'+
        escapeHtml(state.message||errorMessage({
          status:state.accessStatus
        }))+'</div><div class="sync-settings-actions">'+
        '<button type="button" class="btn btn-gray btn-sm" '+
        'onclick="ConferenceMembersUI.refresh(true)">إعادة المحاولة</button>'+
        '</div>';
    }
    var html='<div class="sync-settings-message">صلاحيتك: <strong>'+
      escapeHtml(roleText(state.role))+'</strong></div>';
    if(state.staleMembers){
      html+='<div class="sync-settings-message sync-settings-error">'+
        'تعذر تحديث القائمة؛ قد تكون البيانات المعروضة قديمة.</div>';
    }
    html+='<div class="sync-settings-actions">'+
      '<button type="button" class="btn btn-gray btn-sm" '+
      (state.membersStatus==='loading'?'disabled ':'')+
      'onclick="ConferenceMembersUI.refresh(true)">تحديث القائمة</button>'+
      '</div>';
    html+=renderMembers();
    html+=renderManagement();
    if(state.message){
      html+='<div class="sync-settings-message'+statusClass()+'">'+
        escapeHtml(state.message)+'</div>';
    }
    return html;
  }

  function renderSection(options){
    setContext(options);
    return '<section id="conference_members_section" '+
      'class="settings-section sync-settings-section conference-members-section">'+
      '<div class="settings-section-title">إدارة أعضاء المؤتمر</div>'+
      '<div id="conference_members_content">'+renderBody()+'</div>'+
      '</section>';
  }

  function paint(scope){
    if(!scope||!isContextCurrent(scope))return;
    var target=element('conference_members_content');
    if(target)target.innerHTML=renderBody();
  }

  function currentScope(){
    return {
      localConferenceId:String(context&&context.localConferenceId||''),
      remoteConferenceId:String(context&&context.remoteConferenceId||'')
    };
  }

  function service(){
    return global.ConferenceMembersService;
  }

  function runRefresh(preserveMessage){
    if(!context||!context.localConferenceId||
      !context.remoteConferenceId){
      return Promise.resolve({
        ok:false,status:'conference_not_linked'
      });
    }
    if(refreshFlight)return refreshFlight;
    var api=service();
    if(!api){
      state.accessStatus='error';
      setMessage('خدمة إدارة الأعضاء غير متاحة.','error');
      paint(currentScope());
      return Promise.resolve({ok:false,status:'unavailable'});
    }
    var scope=createRequestScope('refresh');
    state.accessStatus='loading';
    state.membersStatus=state.members.length?'loaded':'loading';
    if(!preserveMessage)setMessage('', 'info');
    paint(scope);
    var flight=Promise.resolve().then(function(){
      return api.getCurrentAccess({
        remoteConferenceId:scope.remoteConferenceId
      });
    }).then(function(access){
      if(!isActive(scope,'refresh'))return {status:'stale'};
      if(!access||!access.ok){
        state.accessStatus=String(access&&access.status||'error');
        setMessage(errorMessage(access),'error');
        paint(scope);
        return access;
      }
      state.accessStatus='available';
      state.role=access.data.role;
      state.canManageMembers=access.data.canManageMembers===true;
      state.membersStatus='loading';
      paint(scope);
      return api.listMembers({
        remoteConferenceId:scope.remoteConferenceId
      }).then(function(listResult){
        if(!isActive(scope,'refresh'))return {status:'stale'};
        if(!listResult||!listResult.ok){
          state.membersStatus='error';
          state.staleMembers=preserveMessage||
            state.members.length>0;
          if(!preserveMessage){
            setMessage(errorMessage(listResult),'error');
          }
          paint(scope);
          return listResult;
        }
        state.members=Array.isArray(listResult.data.members)
          ?listResult.data.members.slice()
          :[];
        state.membersStatus=state.members.length?'loaded':'empty';
        state.staleMembers=false;
        paint(scope);
        return listResult;
      });
    }).catch(function(){
      if(isActive(scope,'refresh')){
        state.accessStatus=state.accessStatus==='loading'
          ?'error':state.accessStatus;
        state.membersStatus=state.members.length?'loaded':'error';
        state.staleMembers=preserveMessage||
          state.members.length>0;
        if(!preserveMessage){
          setMessage('تعذر تحميل أعضاء المؤتمر بأمان.','error');
        }
        paint(scope);
      }
      return {ok:false,status:'error'};
    });
    refreshFlight=flight;
    flight.finally(function(){
      if(refreshFlight===flight)refreshFlight=null;
    }).catch(function(){return null;});
    return flight;
  }

  function refresh(force){
    var key=contextKey(context);
    if(refreshFlight)return refreshFlight;
    if(!force&&autoRefreshedContextKey===key){
      return Promise.resolve({
        ok:true,status:'already_refreshed'
      });
    }
    var flight=runRefresh(false);
    if(!force){
      flight.then(function(result){
        if(result&&result.ok&&contextKey(context)===key){
          autoRefreshedContextKey=key;
        }
      },function(){return null;});
    }
    return flight;
  }

  function lookup(){
    if(!context||!state.canManageMembers){
      return Promise.resolve({ok:false,status:'access_denied'});
    }
    if(lookupFlight)return lookupFlight;
    var input=element('conference_member_lookup_email');
    var email=String(input&&input.value||'').trim();
    if(!email){
      state.lookupStatus='error';
      state.lookupResult=null;
      setMessage('أدخل بريدًا إلكترونيًا صالحًا للبحث.','error');
      paint(currentScope());
      return Promise.resolve({ok:false,status:'invalid_input'});
    }
    var scope=createRequestScope('lookup');
    state.lookupStatus='loading';
    state.lookupResult=null;
    setMessage('', 'info');
    paint(scope);
    var flight=Promise.resolve().then(function(){
      return service().lookupUser({
        remoteConferenceId:scope.remoteConferenceId,
        email:email
      });
    }).then(function(result){
      email='';
      if(!isActive(scope,'lookup'))return {status:'stale'};
      if(result&&result.ok&&result.status==='found'){
        state.lookupStatus='found';
        state.lookupResult={
          targetUserId:String(result.data.targetUserId||''),
          displayName:result.data.displayName||null
        };
        setMessage('تم العثور على المستخدم.','success');
      }else{
        state.lookupStatus=result&&result.status==='not_found'
          ?'not_found':'error';
        state.lookupResult=null;
        setMessage(errorMessage(result),'error');
      }
      paint(scope);
      return result;
    }).catch(function(){
      email='';
      if(isActive(scope,'lookup')){
        state.lookupStatus='error';
        state.lookupResult=null;
        setMessage('تعذر إكمال البحث بأمان.','error');
        paint(scope);
      }
      return {ok:false,status:'error'};
    });
    lookupFlight=flight;
    flight.finally(function(){
      if(lookupFlight===flight)lookupFlight=null;
    }).catch(function(){return null;});
    return flight;
  }

  function mutationSuccessMessage(result,action){
    if(result&&result.data&&result.data.replayed===true){
      return '\u062a\u0645 \u062a\u0623\u0643\u064a\u062f \u0646\u062a\u064a\u062c\u0629 \u0627\u0644\u0639\u0645\u0644\u064a\u0629 \u0627\u0644\u0633\u0627\u0628\u0642\u0629.';
    }
    if(result.status==='added')return action==='add_manager'
      ?'\u062a\u0645\u062a \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0645\u062f\u064a\u0631.'
      :'\u062a\u0645\u062a \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0639\u0636\u0648.';
    if(result.status==='role_changed')return '\u062a\u0645 \u062a\u063a\u064a\u064a\u0631 \u062f\u0648\u0631 \u0627\u0644\u0639\u0636\u0648.';
    if(result.status==='removed')return action==='remove_manager'
      ?'\u062a\u0645\u062a \u0625\u0632\u0627\u0644\u0629 \u0627\u0644\u0645\u062f\u064a\u0631.'
      :'\u062a\u0645\u062a \u0625\u0632\u0627\u0644\u0629 \u0627\u0644\u0639\u0636\u0648.';
    if(result.status==='already_removed')return '\u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u0644\u0645 \u064a\u0639\u062f \u0645\u062f\u064a\u0631\u064b\u0627.';
    if(result.status==='already_manager')return '\u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u0645\u062f\u064a\u0631 \u0628\u0627\u0644\u0641\u0639\u0644.';
    return '\u0644\u0645 \u064a\u062a\u063a\u064a\u0631 \u062f\u0648\u0631 \u0627\u0644\u0639\u0636\u0648.';
  }

  function mutationFailureMessage(result){
    if(result&&result.status==='role_conflict'){
      return '\u0644\u0644\u0639\u0636\u0648 \u062f\u0648\u0631 \u0645\u062e\u062a\u0644\u0641 \u062d\u0627\u0644\u064a\u064b\u0627.';
    }
    if(result&&result.status==='not_member'){
      return '\u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u0644\u064a\u0633 \u0639\u0636\u0648\u064b\u0627 \u0641\u064a \u0627\u0644\u0645\u0624\u062a\u0645\u0631.';
    }
    return errorMessage(result);
  }

  function mutation(action,targetUserId,requestedRole){
    targetUserId=String(targetUserId||'');
    if(!context||!state.canManageMembers||!targetUserId){
      return Promise.resolve({ok:false,status:'invalid_input'});
    }
    if(targetFlights[targetUserId])return targetFlights[targetUserId];
    var scope=createRequestScope('mutation',targetUserId);
    state.mutationStatus='running';
    state.mutationTargetUserId=targetUserId;
    setMessage('', 'info');
    paint(scope);
    var api=service();
    var method=action==='add_manager'?'addManager':
      action==='remove_manager'?'removeManager':
      action==='add'?'addMember':
      action==='change_role'?'changeRole':'removeMember';
    var flight=Promise.resolve().then(function(){
      var input={
        remoteConferenceId:scope.remoteConferenceId,
        targetUserId:targetUserId
      };
      return action==='remove'||action==='add_manager'||
        action==='remove_manager'
        ?api[method](input)
        :api[method](input,requestedRole);
    }).then(function(result){
      if(!isActive(scope,'mutation',targetUserId)){
        return {status:'stale'};
      }
      var trustedStatuses=['added','unchanged','role_changed',
        'removed','already_removed','already_manager'];
      if(result&&result.ok&&trustedStatuses.indexOf(result.status)>=0){
        state.mutationStatus='success';
        state.lookupStatus='idle';
        state.lookupResult=null;
        setMessage(
          result.data&&result.data.replayed===true
            ?'تم تأكيد نتيجة العملية السابقة.'
            :result.status==='added'
              ?'تمت إضافة المدير.'
              :result.status==='removed'
                ?'تمت إزالة المدير.'
                :result.status==='already_manager'
                  ?'المستخدم مدير بالفعل.'
                  :'المستخدم لم يعد مديرًا.',
          'success'
        );
        setMessage(mutationSuccessMessage(result,action),'success');
        paint(scope);
        return runRefresh(true).then(function(){return result;});
      }
      state.mutationStatus=result&&
        result.status==='unknown_completion_state'
        ?'unknown_completion_state':'error';
      if(result&&result.status==='target_not_found'){
        state.lookupResult=null;
        state.lookupStatus='not_found';
      }
      setMessage(mutationFailureMessage(result),
        result&&result.status==='unknown_completion_state'
          ?'info':'error');
      paint(scope);
      return result;
    }).catch(function(){
      if(isActive(scope,'mutation',targetUserId)){
        state.mutationStatus='error';
        setMessage('تعذر تنفيذ عملية العضوية بأمان.','error');
        paint(scope);
      }
      return {ok:false,status:'error'};
    });
    targetFlights[targetUserId]=flight;
    flight.finally(function(){
      if(targetFlights[targetUserId]===flight){
        delete targetFlights[targetUserId];
      }
      if(isActive(scope,'mutation',targetUserId))paint(scope);
    }).catch(function(){return null;});
    return flight;
  }

  function addManager(){
    var target=state.lookupResult&&state.lookupResult.targetUserId;
    return mutation('add_manager',target,'manager');
  }

  function removeManager(targetUserId){
    targetUserId=String(targetUserId||'');
    var member=state.members.find(function(item){
      return item.userId===targetUserId;
    });
    if(member&&member.role==='owner'){
      return Promise.resolve({ok:false,status:'invalid_input'});
    }
    if(targetFlights[targetUserId]){
      return targetFlights[targetUserId];
    }
    if(global.confirm&&
      !global.confirm('هل تريد إزالة هذا المدير من المؤتمر؟')){
      return Promise.resolve({ok:false,status:'cancelled'});
    }
    return mutation('remove_manager',targetUserId,null);
  }

  function addMember(){
    var target=state.lookupResult&&state.lookupResult.targetUserId;
    var selector=element('conference_member_role');
    return mutation('add',target,
      String(selector&&selector.value||'manager'));
  }

  function changeRole(targetUserId,role){
    var member=state.members.find(function(item){
      return item.userId===String(targetUserId||'');
    });
    if(!member||member.role==='owner'){
      return Promise.resolve({ok:false,status:'invalid_input'});
    }
    return mutation('change_role',targetUserId,String(role||''));
  }

  function removeMember(targetUserId){
    var member=state.members.find(function(item){
      return item.userId===String(targetUserId||'');
    });
    if(!member||member.role==='owner'){
      return Promise.resolve({ok:false,status:'invalid_input'});
    }
    if(targetFlights[targetUserId]){
      return targetFlights[targetUserId];
    }
    if(global.confirm&&
      !global.confirm('\u0647\u0644 \u062a\u0631\u064a\u062f \u0625\u0632\u0627\u0644\u0629 \u0647\u0630\u0627 \u0627\u0644\u0639\u0636\u0648 \u0645\u0646 \u0627\u0644\u0645\u0624\u062a\u0645\u0631\u061f')){
      return Promise.resolve({ok:false,status:'cancelled'});
    }
    return mutation('remove',targetUserId,null);
  }

  function resetForTests(){
    requestCounter=0;
    context=null;
    activeRequests=Object.create(null);
    refreshFlight=null;
    lookupFlight=null;
    targetFlights=Object.create(null);
    autoRefreshedContextKey=null;
    state=createState();
    return {ok:true,status:'reset'};
  }

  global.ConferenceMembersUI=Object.freeze({
    renderSection:renderSection,
    refresh:refresh,
    lookup:lookup,
    addMember:addMember,
    changeRole:changeRole,
    removeMember:removeMember,
    addManager:addManager,
    removeManager:removeManager,
    getAccessState:function(){
      return {accessStatus:state.accessStatus,role:state.role,
        canManageMembers:state.canManageMembers===true};
    },
    resetForTests:resetForTests
  });
})(window);
