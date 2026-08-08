(function(global){
  'use strict';

  var actorCapabilities=null;
  var actorCapabilitiesActorId=null;
  var actorCapabilitiesFlight=null;

  function result(ok,status,data,error){
    return {ok:ok,status:status,data:data||null,error:error||null};
  }
  function isUuid(value){
    return typeof value==='string'&&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value);
  }
  function dependencies(options){
    options=options||{};
    return {clientLayer:options.clientLayer||global.SupabaseClientLayer,
      auth:options.auth||global.SupabaseAuth,
      deviceIdentity:options.deviceIdentity||global.SupabaseDeviceIdentity,
      organizations:options.organizations||global.OrganizationAdministrationService,
      organizationManagement:options.organizationManagement||global.OrganizationManagementService,
      devices:options.devices||global.DeviceAuthorizationAdministrationService};
  }
  function context(options){
    var d=dependencies(options),client,session,identity;
    try{
      client=d.clientLayer&&d.clientLayer.getClient();
      session=d.auth&&d.auth.getSession();
      identity=d.deviceIdentity&&d.deviceIdentity.getOrCreate();
    }catch(error){return {error:'UNAVAILABLE'};}
    if(!client||typeof client.rpc!=='function'||
      !isUuid(String(session&&session.user&&session.user.id||''))||
      !isUuid(String(identity&&identity.id||''))){
      return {error:'UNAVAILABLE'};
    }
    return {client:client,actorUserId:String(session.user.id),
      actorDeviceId:String(identity.id),organizations:d.organizations,
      organizationManagement:d.organizationManagement,devices:d.devices};
  }
  function rpc(ctx,name,args){
    return Promise.resolve(ctx.client.rpc(name,args)).then(function(response){
      if(response&&response.error){
        return result(false,'rpc_error',null,{
          code:String(response.error.code||'READ_FAILED')});
      }
      return result(true,'received',response&&response.data);
    }).catch(function(){
      return result(false,'network_error',null,{code:'NETWORK_ERROR'});
    });
  }
  function normalizeUser(row){
    if(!row||!isUuid(String(row.userId||''))||
      ['pending','approved','blocked'].indexOf(row.accountStatus)<0){
      return null;
    }
    return {userId:String(row.userId),
      displayName:row.displayName==null?null:String(row.displayName),
      email:String(row.email||''),accountStatus:String(row.accountStatus),
      conferenceCount:Number(row.conferenceCount||0),
      deviceCount:Number(row.deviceCount||0)};
  }
  function normalizeCapabilities(value){
    value=value||{};
    var legacy=!Object.prototype.hasOwnProperty.call(value,'canOpenUserManagement')&&
      !Object.prototype.hasOwnProperty.call(value,'canViewAccount');
    return {canOpenUserManagement:legacy||value.canOpenUserManagement===true,
      canViewAccount:legacy||value.canViewAccount===true,
      canManageAccount:legacy||value.canManageAccount===true,
      canViewOrganization:legacy||value.canViewOrganization===true,
      canManageOrganizationMembers:legacy||value.canManageOrganizationMembers===true,
      canManageOrganizationRoles:legacy||value.canManageOrganizationRoles===true,
      canViewConferences:legacy||value.canViewConferences===true,
      canManageConferenceMembership:legacy||value.canManageConferenceMembership===true,
      canViewDevices:legacy||value.canViewDevices===true,
      canManageDevices:legacy||value.canManageDevices===true};
  }
  function getCachedActorCapabilities(){return actorCapabilities;}
  function getActorCapabilities(options){
    var ctx=context(options);
    if(ctx.error)return Promise.resolve(result(false,'unavailable'));
    if(actorCapabilities&&actorCapabilitiesActorId===ctx.actorUserId)return Promise.resolve(result(true,'loaded',
      {capabilities:actorCapabilities}));
    if(actorCapabilitiesFlight)return actorCapabilitiesFlight;
    actorCapabilitiesFlight=rpc(ctx,'get_user_management_actor_capabilities',{
      p_actor_device_id:ctx.actorDeviceId
    }).then(function(response){
      if(!response.ok||!response.data||response.data.status!=='success')return response;
      actorCapabilities=normalizeCapabilities(response.data);
      actorCapabilitiesActorId=ctx.actorUserId;
      return result(true,'loaded',{capabilities:actorCapabilities});
    }).then(function(response){actorCapabilitiesFlight=null;return response;},
      function(error){actorCapabilitiesFlight=null;throw error;});
    return actorCapabilitiesFlight;
  }
  function listUsers(input,options){
    input=input||{};
    var ctx=context(options);
    if(ctx.error)return Promise.resolve(result(false,'unavailable'));
    var status=input.accountStatus==null?null:String(input.accountStatus);
    if(status!==null&&['pending','approved','blocked'].indexOf(status)<0){
      return Promise.resolve(result(false,'invalid_input'));
    }
    return rpc(ctx,'search_user_management_users',{
      p_actor_device_id:ctx.actorDeviceId,
      p_query:String(input.query||''),
      p_account_status:status,p_limit:50
    }).then(function(response){
      var data=response.data||{};
      if(!response.ok||data.status!=='success'||!Array.isArray(data.users)){
        return result(false,response.status);
      }
      var users=data.users.map(normalizeUser);
      if(users.some(function(user){return !user;})){
        return result(false,'malformed_response');
      }
      actorCapabilities=normalizeCapabilities(data.capabilities);
      actorCapabilitiesActorId=ctx.actorUserId;
      return result(true,'listed',{users:users,capabilities:actorCapabilities});
    });
  }
  function normalizeOverview(data,targetUserId){
    if(!data||data.status!=='success'||!data.user||
      String(data.user.userId||'')!==targetUserId){
      return null;
    }
    return {selectedUser:{userId:targetUserId,
      displayName:data.user.displayName==null?null:String(data.user.displayName),
      email:String(data.user.email||'')},
      account:data.account?{status:'loaded',data:{accountStatus:data.account.accountStatus,
        canCreateConferences:data.account.canCreateConferences===true,
        systemRoles:Array.isArray(data.account.systemRoles)
          ?data.account.systemRoles.slice():[]}}:{status:'hidden',data:null},
      organization:Array.isArray(data.organizations)?
        {status:'loaded',data:{memberships:data.organizations.slice()}}:
        {status:'error',data:null},
      conferences:Array.isArray(data.conferences)?
        {status:'loaded',data:{items:data.conferences.slice()}}:
        {status:'error',data:null},
      devices:{status:'idle',data:{items:[]}},
      capabilities:normalizeCapabilities(data.capabilities),
      deviceOrganizationId:data.deviceOrganizationId||null};
  }
  function getOverview(input,options){
    input=input||{};
    var targetUserId=String(input.targetUserId||''),ctx=context(options);
    if(!isUuid(targetUserId))return Promise.resolve(result(false,'invalid_input'));
    if(ctx.error)return Promise.resolve(result(false,'unavailable'));
    return rpc(ctx,'get_user_management_overview',{
      p_actor_device_id:ctx.actorDeviceId,p_target_user_id:targetUserId
    }).then(function(response){
      if(!response.ok)return response;
      var view=normalizeOverview(response.data,targetUserId);
      if(!view)return result(false,'malformed_response');
      actorCapabilities=view.capabilities;
      if(!view.capabilities.canViewDevices){
        view.devices={status:'hidden',data:{items:[]}};
      }else view.devices.status='loading';
      var devicesRead=view.capabilities.canViewDevices?rpc(ctx,'get_user_management_devices',{
        p_actor_device_id:ctx.actorDeviceId,p_target_user_id:targetUserId
      }):Promise.resolve(result(true,'received',{status:'success',devices:[]}));
      return devicesRead.then(function(devices){
        if(!view.capabilities.canViewDevices){
          view.devices={status:'hidden',data:{items:[]}};
        }else if(devices.ok&&devices.data&&devices.data.status==='success'&&
          Array.isArray(devices.data.devices)){
          view.devices={status:devices.data.devices.length?'loaded':'empty',
            data:{items:devices.data.devices.slice()}};
        }else{
          view.devices={status:'error',data:{items:[]},
            error:{code:String(devices&&devices.status||'DEVICE_READ_FAILED')}};
        }
        var accountRead=view.capabilities.canViewAccount
          ?getAccount({targetUserId:targetUserId},options)
          :Promise.resolve(result(true,'hidden'));
        return accountRead.then(function(account){
          if(view.capabilities.canViewAccount){
            if(account.ok)view.account=account.data.account;
            else view.account={status:'error',data:null};
          }
          return enrichOrganizationStatuses(view,ctx,options).then(function(){
            return enrichOrganizations(view,targetUserId,ctx,options);
          }).then(function(){
            return enrichDevices(view,targetUserId,ctx,options);
          }).then(function(){return result(true,'loaded',{overview:view});
          });
        });
      }).catch(function(){
        view.devices={status:'error',data:{items:[]},
          error:{code:'DEVICE_READ_FAILED'}};
        return result(true,'loaded',{overview:view});
      });
    });
  }
  function enrichOrganizationStatuses(view,ctx,options){
    var items=view.organization&&view.organization.data&&view.organization.data.memberships;
    if(!Array.isArray(items)||!ctx.organizationManagement||
      typeof ctx.organizationManagement.list!=='function')return Promise.resolve(view);
    return ctx.organizationManagement.list(options&&options.organizationManagementOptions)
      .then(function(response){
        if(!response.ok||!response.data||!Array.isArray(response.data.organizations)){
          items.forEach(function(item){item.organizationStatus='unknown';});
          return view;
        }
        var statuses=Object.create(null);
        response.data.organizations.forEach(function(item){statuses[item.organizationId]=item.status;});
        items.forEach(function(item){item.organizationStatus=statuses[item.organizationId]||'unknown';});
        return view;
      }).catch(function(){items.forEach(function(item){item.organizationStatus='unknown';});return view;});
  }
  function enrichOrganizations(view,targetUserId,ctx,options){
    var items=view.organization&&view.organization.data&&
      view.organization.data.memberships;
    if(!Array.isArray(items)||!ctx.organizations||
      typeof ctx.organizations.refresh!=='function')return Promise.resolve(view);
    return Promise.all(items.map(function(item){
      return ctx.organizations.refresh({organizationId:item.organizationId},
        Object.assign({},options&&options.organizationOptions,{deviceGuarded:true}))
        .then(function(response){
          if(!response.ok||!response.data){item.readStatus='error';item.capabilities={canAdd:false,canChangeRole:false,canRemove:false};return;}
          var members=response.data.members||[],access=response.data.access||{};
          var member=members.find(function(row){return row.userId===targetUserId;});
          var ownerCount=members.filter(function(row){return row.role==='organization_owner';}).length;
          item.isMember=!!member;item.role=member?member.role:null;item.readStatus='loaded';
          var active=item.organizationStatus!=='archived'&&item.organizationStatus!=='unknown';
          item.capabilities={canAdd:active&&!member&&access.canManageMembers===true,
            canChangeRole:active&&!!member&&!member.isCurrentUser&&access.canManageOwners===true&&
              !(member.role==='organization_owner'&&ownerCount<=1),
            canRemove:!!member&&!member.isCurrentUser&&
              (access.canManageOwners===true||member.role==='member')&&
              !(member.role==='organization_owner'&&ownerCount<=1)};
        }).catch(function(){item.readStatus='error';item.capabilities={canAdd:false,canChangeRole:false,canRemove:false};});
    })).then(function(){return view;});
  }
  function enrichDevices(view,targetUserId,ctx,options){
    if(!view.capabilities.canViewDevices)return Promise.resolve(view);
    if(!view.deviceOrganizationId||!ctx.devices||
      typeof ctx.devices.listMemberDevices!=='function'){
      view.devices.managementStatus='membership_required';
      return Promise.resolve(view);
    }
    return ctx.devices.listMemberDevices({organizationId:view.deviceOrganizationId,
      targetUserId:targetUserId},options&&options.deviceOptions).then(function(response){
      if(!response.ok||!response.data||!Array.isArray(response.data.devices)){
        view.devices.managementStatus='error';return view;
      }
      var devices=response.data.devices,approved=devices.filter(function(device){
        return device.authorizationStatus==='approved';
      }),pending=devices.filter(function(device){return device.authorizationStatus==='pending';});
      view.devices={status:devices.length?'loaded':'empty',managementStatus:'available',
        organizationId:view.deviceOrganizationId,targetRole:response.data.targetRole,
        data:{items:devices.map(function(device){var copy=Object.assign({},device),sole=copy.isSoleApprovedDevice===true||approved.length===1&&copy.authorizationStatus==='approved';copy.isCurrentDevice=copy.deviceId===ctx.actorDeviceId;copy.capabilities={canApprove:copy.authorizationStatus==='pending',canReject:copy.authorizationStatus==='pending',canRevoke:copy.authorizationStatus==='approved'&&!sole,canReplace:copy.authorizationStatus==='approved'&&sole&&pending.length>0};return copy;})}};
      return view;
    }).catch(function(){view.devices.managementStatus='error';return view;});
  }
  function getAccount(input,options){
    input=input||{};
    var targetUserId=String(input.targetUserId||''),ctx=context(options);
    if(!isUuid(targetUserId))return Promise.resolve(result(false,'invalid_input'));
    if(ctx.error)return Promise.resolve(result(false,'unavailable'));
    return rpc(ctx,'get_user_management_account',{
      p_actor_device_id:ctx.actorDeviceId,p_target_user_id:targetUserId
    }).then(function(response){
      var data=response.data||{},account=data.account;
      if(!response.ok||data.status!=='success'||!account||
        ['pending','approved','blocked'].indexOf(account.accountStatus)<0){
        return result(false,response.status);
      }
      return result(true,'loaded',{account:{status:'loaded',data:{
        accountStatus:account.accountStatus,
        canCreateConferences:account.canCreateConferences===true,
        systemRoles:Array.isArray(account.systemRoles)?account.systemRoles.slice():[],
        capabilities:account.capabilities||{}
      }}});
    });
  }

  global.UserManagementReadService=Object.freeze({
    listUsers:listUsers,getOverview:getOverview,getAccount:getAccount,
    getActorCapabilities:getActorCapabilities,
    getCachedActorCapabilities:getCachedActorCapabilities
  });
})(window);
