(function(global){
  'use strict';

  var LINK_STORAGE_KEY='conference_manager_sync_links';
  var ownerChoices=Object.create(null);
  var memberChoices=Object.create(null);
  var choiceCounter=0;

  function clone(value){
    return JSON.parse(JSON.stringify(value));
  }

  function result(ok,status,data){
    return {ok:ok,status:status,data:data||null};
  }

  function choiceToken(){
    choiceCounter++;
    return 'repair_choice_'+choiceCounter;
  }

  function snapshotCounts(conference){
    var rooms=0;
    (conference.houses||[]).forEach(function(house){
      (house.floors||[]).forEach(function(floor){
        rooms+=(floor.rooms||[]).length;
      });
    });
    return {
      people:conference.peopleDb&&Array.isArray(conference.peopleDb.people)
        ?conference.peopleDb.people.length:0,
      transports:Array.isArray(conference.transports)
        ?conference.transports.length:0,
      houses:Array.isArray(conference.houses)?conference.houses.length:0,
      rooms:rooms
    };
  }

  function dependencies(options){
    options=options||{};
    return {
      remote:options.remote||global.SupabaseSnapshotSync,
      members:options.members||global.ConferenceMembersService,
      organization:options.organization||global.OrganizationAdministrationService,
      links:options.links||global.ConferenceLinkStore,
      integration:options.integration||global.OfflineFirstIntegration,
      repository:options.repository||global.StorageRepository,
      repairStore:options.repairStore||global.WrongRemoteBindingRepairStore,
      backup:options.backup||global.FullBackupService,
      storage:options.storage||global.localStorage,
      getAppData:options.getAppData||function(){return global.appData;},
      setAppData:options.setAppData||function(value){global.appData=value;},
      activate:options.activate||global.activatePersistedConferenceById
    };
  }

  function readAllLinks(storage){
    try{
      var value=JSON.parse(storage.getItem(LINK_STORAGE_KEY)||'{}');
      return value&&typeof value==='object'&&!Array.isArray(value)?value:null;
    }catch(error){
      return null;
    }
  }

  function restoreAllLinks(storage,links){
    try{
      storage.setItem(LINK_STORAGE_KEY,JSON.stringify(links));
      return JSON.stringify(readAllLinks(storage))===JSON.stringify(links);
    }catch(error){
      return false;
    }
  }

  function restoreContext(integration,localConferenceId,contextState){
    var context=contextState&&contextState.context;
    var restored=context
      ?integration.configureConferenceSync(localConferenceId,context)
      :integration.removeConferenceSync(localConferenceId);
    return !!(restored&&restored.ok);
  }

  function listOwnerConferences(options){
    var deps=dependencies(options);
    return deps.remote.listAvailableConferences().then(function(response){
      if(!response||!response.ok)return result(false,'conference_list_unavailable');
      return Promise.all((response.data.conferences||[]).map(function(conference){
        return deps.members.getCurrentAccess({remoteConferenceId:conference.id})
          .then(function(access){
            if(!access||!access.ok||!access.data||
              access.data.role!=='owner'||!conference.organizationId){
              return null;
            }
            return deps.remote.downloadSnapshot(conference.id).then(function(download){
              if(!download||!download.ok||!download.data||!download.data.snapshot){
                return null;
              }
              var token=choiceToken();
              ownerChoices[token]={
                conferenceId:conference.id,
                organizationId:conference.organizationId
              };
              return {
                token:token,
                name:String(conference.name||''),
                revision:download.data.revision,
                counts:snapshotCounts(download.data.snapshot)
              };
            });
          });
      })).then(function(items){
        return result(true,'owner_conferences',{
          conferences:items.filter(Boolean)
        });
      });
    });
  }

  function listOrganizationMembers(targetToken,options){
    var deps=dependencies(options);
    var target=ownerChoices[targetToken];
    if(!target){
      return Promise.resolve(result(false,
        'target_conference_organization_unavailable'));
    }
    return deps.organization.getCurrentAccess({
      organizationId:target.organizationId
    }).then(function(access){
      if(!access||!access.ok||!access.data||!access.data.canManageMembers){
        return result(false,'organization_admin_access_required');
      }
      return deps.organization.listMembers({
        organizationId:target.organizationId
      }).then(function(response){
        if(!response||!response.ok){
          return result(false,'organization_members_unavailable');
        }
        var nameCounts=Object.create(null);
        (response.data.members||[]).forEach(function(member){
          var name=String(member.displayName||'');
          nameCounts[name]=(nameCounts[name]||0)+1;
        });
        var ambiguous=(response.data.members||[]).some(function(member){
          return nameCounts[String(member.displayName||'')]>1;
        });
        if(ambiguous)return result(false,'blocked_ambiguous_member');
        var members=(response.data.members||[])
          .filter(function(member){return !member.isCurrentUser;})
          .map(function(member){
            var token=choiceToken();
            memberChoices[token]={
              targetUserId:member.userId,
              conferenceId:target.conferenceId
            };
            return {
              token:token,
              displayName:String(member.displayName||''),
              role:String(member.role||'')
            };
          });
        return result(true,'organization_members',{members:members});
      });
    });
  }

  function addSelectedManager(memberToken,options){
    var deps=dependencies(options);
    var selected=memberChoices[memberToken];
    if(!selected)return Promise.resolve(result(false,'blocked_owner_selection'));
    return deps.members.addManager({
      remoteConferenceId:selected.conferenceId,
      targetUserId:selected.targetUserId
    }).then(function(response){
      if(!response||!response.ok||!response.data||
        response.data.role!=='manager'){
        return result(false,'membership_verification_failed');
      }
      delete memberChoices[memberToken];
      return result(true,'manager_added');
    });
  }

  function repairMemberLink(localConferenceId,targetToken,options){
    var deps=dependencies(options);
    var target=ownerChoices[targetToken];
    if(!target)return Promise.resolve(result(false,'target_unavailable'));

    var originalAppData=clone(deps.getAppData());
    var originalLink=deps.links.get(localConferenceId);
    var originalLinks=readAllLinks(deps.storage);
    var originalContext=deps.integration.getConferenceSyncState(localConferenceId);
    var originalManualRelink=deps.backup.getManualRelinkConferenceIds({
      storage:deps.storage
    });
    if(!originalLink)return Promise.resolve(result(false,'old_link_unavailable'));
    if(!originalLinks)return Promise.resolve(result(false,'link_store_unavailable'));

    var saved=deps.repairStore.create({
      appData:originalAppData,
      links:originalLinks,
      context:originalContext,
      manualRelink:originalManualRelink,
      localConferenceId:localConferenceId,
      oldLink:originalLink
    },{storage:deps.storage});
    if(!saved.ok)return Promise.resolve(result(false,'backup_failed'));

    var suspended=deps.backup.setManualRelinkConferenceIds(
      originalManualRelink.concat([String(localConferenceId)]),
      {storage:deps.storage}
    );
    if(!suspended||!suspended.ok){
      return Promise.resolve(result(false,'manual_relink_suspension_failed'));
    }

    return deps.members.getCurrentAccess({
      remoteConferenceId:target.conferenceId
    }).then(function(access){
      if(!access||!access.ok||!access.data||access.data.role!=='manager'){
        throw new Error('MEMBERSHIP');
      }
      return deps.remote.downloadSnapshot(target.conferenceId);
    }).then(function(download){
      if(!download||!download.ok||!download.data||!download.data.snapshot){
        throw new Error('DOWNLOAD');
      }
      var next=clone(originalAppData);
      var index=next.conferences.findIndex(function(conference){
        return conference&&String(conference.id)===String(localConferenceId);
      });
      if(index<0)throw new Error('LOCAL');
      var snapshot=clone(download.data.snapshot);
      snapshot.id=String(localConferenceId);
      if(!snapshot.peopleDb||!Array.isArray(snapshot.peopleDb.people)||
        !Array.isArray(snapshot.houses)||!Array.isArray(snapshot.transports)){
        throw new Error('VALIDATION');
      }
      next.conferences[index]=snapshot;
      return Promise.resolve(deps.repository.saveAppSnapshot(next,{
        skipSyncQueue:true
      })).then(function(){
        return deps.repository.getAppSnapshot();
      }).then(function(readResult){
        var verified=readResult.data||readResult;
        var verifiedConference=verified.conferences&&
          verified.conferences.find(function(conference){
            return conference&&String(conference.id)===String(localConferenceId);
          });
        if(!verifiedConference||JSON.stringify(snapshotCounts(verifiedConference))!==
          JSON.stringify(snapshotCounts(snapshot))){
          throw new Error('VERIFY');
        }
        var savedLink=deps.links.save(Object.assign({},originalLink,{
          localConferenceId:String(localConferenceId),
          remoteConferenceId:target.conferenceId,
          knownRevision:download.data.revision,
          linkStatus:'linked',
          pendingLocalApplication:false,
          syncState:{
            materializationStatus:'verified',
            materializationSource:'downloaded',
            materializedSnapshotRevision:download.data.revision
          }
        }),{storage:deps.storage});
        if(!savedLink.ok)throw new Error('LINK');
        var configured=deps.integration.configureConferenceSync(
          localConferenceId,{
            conferenceId:target.conferenceId,
            baseRevision:download.data.revision,
            schemaVersion:String(download.data.schemaVersion||'1'),
            appVersion:String(download.data.appVersion||'unknown')
          });
        if(!configured||!configured.ok)throw new Error('CONTEXT');
        deps.setAppData(verified);
        if(deps.activate&&deps.activate(localConferenceId,{
          alreadyPersisted:true
        })!==true){
          throw new Error('ACTIVATION');
        }
        var cleared=deps.backup.clearManualRelinkRequirement(
          localConferenceId,{storage:deps.storage}
        );
        if(!cleared||!cleared.ok||
          deps.backup.isManualRelinkRequired(localConferenceId,{
            storage:deps.storage
          })){
          throw new Error('MANUAL_RELINK_CLEAR');
        }
        deps.repairStore.clearActive({storage:deps.storage});
        return result(true,'repaired',{
          revision:download.data.revision,
          counts:snapshotCounts(verifiedConference)
        });
      });
    }).catch(function(error){
      return Promise.resolve(deps.repository.saveAppSnapshot(originalAppData,{
        skipSyncQueue:true
      })).then(function(){
        var linksRestored=restoreAllLinks(deps.storage,originalLinks);
        var contextRestored=restoreContext(
          deps.integration,localConferenceId,originalContext
        );
        var manualRestored=deps.backup.setManualRelinkConferenceIds(
          originalManualRelink,{storage:deps.storage}
        );
        deps.setAppData(originalAppData);
        if(!linksRestored||!contextRestored||!manualRestored||!manualRestored.ok){
          return result(false,'rollback_failed',{
            reason:String(error&&error.message||'FAILED')
          });
        }
        return result(false,'rolled_back',{
          reason:String(error&&error.message||'FAILED')
        });
      }).catch(function(rollbackError){
        return result(false,'rollback_failed',{
          reason:String(rollbackError&&rollbackError.message||'FAILED')
        });
      });
    });
  }

  var api=Object.freeze({
    listOwnerConferences:listOwnerConferences,
    listOrganizationMembers:listOrganizationMembers,
    addSelectedManager:addSelectedManager,
    repairMemberLink:repairMemberLink
  });
  global.WrongRemoteBindingRepairService=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
