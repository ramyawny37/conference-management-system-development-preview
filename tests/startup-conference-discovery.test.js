const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const source=fs.readFileSync(
  require('path').join(__dirname,'../js/sync/startup-conference-discovery.js'),
  'utf8'
);
const scriptSource=fs.readFileSync(
  require('path').join(__dirname,'../script.js'),'utf8'
);

function environment(options={}){
  let userId=options.userId||'user-a';
  let clientValue;
  let renders=0;
  let activeDownloads=0;
  let maxActiveDownloads=0;
  const client={};
  clientValue=client;
  const downloads=[];
  const remote={
    listAvailableConferences(){
      return Promise.resolve(options.listResult||{
        ok:true,
        data:{conferences:[
          {id:'remote-1',name:'One',role:'accommodation_viewer'},
          {id:'remote-2',name:'Two',role:'transport_viewer'},
          null,
          {id:'',name:'Malformed'},
          {id:'remote-1',name:'Duplicate',role:'owner'}
        ]}
      });
    },
    downloadSnapshot(id){
      downloads.push(id);
      activeDownloads++;
      maxActiveDownloads=Math.max(maxActiveDownloads,activeDownloads);
      const response=options.download?options.download(id):Promise.resolve({
        ok:true,status:'downloaded',
        data:{snapshot:{id:'local-'+id,name:id,status:'active',peopleDb:{people:[]}}}
      });
      return Promise.resolve(response).finally(()=>{activeDownloads--;});
    }
  };
  const sandbox={
    window:null,
    structuredClone:value=>JSON.parse(JSON.stringify(value)),
    SupabaseClientLayer:{getClient:()=>clientValue},
    SupabaseAuth:{getState:()=>({user:userId?{id:userId}:null})},
    SupabaseSnapshotSync:remote,
    showStartupConferenceList(){renders++;}
  };
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox);
  return {
    api:sandbox.StartupConferenceDiscovery,
    remote,client,downloads,
    maxActiveDownloads:()=>maxActiveDownloads,
    renders:()=>renders,
    setUser(value){userId=value;},
    replaceClient(value){clientValue=value;}
  };
}

function startupCards(options={}){
  const start=scriptSource.indexOf('function conferenceStatusText');
  const end=scriptSource.indexOf('function showStartupConferenceList');
  const localOpens=[];
  const remoteOpens=[];
  let renders=0;
  const sandbox={
    window:null,
    appData:{conferences:options.localConferences||[]},
    structuredClone:value=>JSON.parse(JSON.stringify(value)),
    JSON,Object,Array,String,
    ConferenceLinkStore:{get:id=>options.links&&options.links[id]||null},
    StartupConferenceDiscovery:{getRecords:()=>options.discovered||[]},
    DiscoveredConferenceOpenService:{open:(id,openOptions)=>{
      remoteOpens.push({id,options:JSON.parse(JSON.stringify(openOptions))});
      return Promise.resolve(options.remoteResult||{ok:true,status:'opened'});
    }},
    openConferenceFromStartup:id=>{localOpens.push(id);return true;},
    accommodationIcon:()=>'',esc:value=>String(value),
    showStartupConferenceList(){renders++;},showToast(){},console
  };
  sandbox.window=sandbox;
  vm.runInNewContext(scriptSource.slice(start,end),sandbox);
  return {
    viewModel:()=>sandbox.getStartupConferenceViewModel(),
    render:items=>sandbox.renderStartupConferenceCards(items,'active'),
    async click(html){
      const match=/onclick="(open(?:Discovered)?ConferenceFromStartup)\('([^']+)'\)"/.exec(html);
      assert.ok(match,'startup card must expose an existing open route');
      return sandbox[match[1]](match[2]);
    },
    localOpens,remoteOpens,renders:()=>renders
  };
}

(async function(){
  const env=environment();
  const result=await env.api.refresh();
  assert.strictEqual(result.ok,true);
  assert.deepStrictEqual(env.downloads,['remote-1','remote-2']);
  assert.strictEqual(env.maxActiveDownloads(),1);
  const records=env.api.getRecords();
  assert.strictEqual(records.length,2);
  assert.strictEqual(records[0].role,'accommodation_viewer');
  assert.strictEqual(records[1].role,'transport_viewer');
  assert.strictEqual(env.renders(),1);

  let firstRelease;
  let secondStarted=false;
  const firstGate=new Promise(resolve=>{firstRelease=resolve;});
  const overlap=environment({download:id=>{
    if(id==='remote-1')return firstGate;
    secondStarted=true;
    return Promise.resolve({
      ok:true,status:'downloaded',data:{snapshot:{status:'active',name:id}}
    });
  }});
  const firstRun=overlap.api.refresh();
  while(overlap.downloads.length===0)await Promise.resolve();
  const secondRun=overlap.api.refresh();
  await Promise.resolve();
  assert.strictEqual(overlap.maxActiveDownloads(),1);
  assert.strictEqual(secondStarted,false);
  firstRelease({ok:true,status:'downloaded',data:{snapshot:{status:'active'}}});
  await firstRun;
  await secondRun;
  assert.strictEqual(overlap.maxActiveDownloads(),1);

  let release;
  const downloadGate=new Promise(resolve=>{release=resolve;});
  const stale=environment({download:()=>downloadGate});
  const pending=stale.api.refresh();
  while(stale.downloads.length===0)await Promise.resolve();
  stale.replaceClient({});
  stale.api.clear();
  release({ok:true,status:'downloaded',data:{snapshot:{status:'active'}}});
  await pending;
  assert.strictEqual(stale.api.getRecords().length,0);

  const partial=environment({download:id=>Promise.resolve(id==='remote-1'
    ?{ok:false,status:'error'}
    :{ok:true,status:'downloaded',data:{snapshot:{status:'active',name:'Two'}}}
  )});
  await partial.api.refresh();
  assert.strictEqual(partial.api.getRecords().length,1);
  assert.strictEqual(partial.api.getRecords()[0].remoteConferenceId,'remote-2');

  const failed=environment({listResult:{ok:false,status:'error'}});
  const failure=await failed.api.refresh();
  assert.strictEqual(failure.status,'list_failed');
  assert.strictEqual(failed.api.getRecords().length,0);

  const retained=environment();
  await retained.api.refresh();
  retained.remote.listAvailableConferences=()=>Promise.resolve({ok:false});
  await retained.api.refresh();
  assert.strictEqual(retained.api.getRecords().length,2);

  const sameName=environment({
    listResult:{ok:true,data:{conferences:[
      {id:'remote-a',name:'Same',role:'viewer'},
      {id:'remote-b',name:'Same',role:'viewer'}
    ]}},
    download:()=>Promise.resolve({
      ok:true,status:'downloaded',
      data:{snapshot:{status:'active',name:'Same'}}
    })
  });
  await sameName.api.refresh();
  assert.deepStrictEqual(
    sameName.api.getRecords().map(item=>item.remoteConferenceId),
    ['remote-a','remote-b']
  );

  const unlinkedCards=startupCards({
    localConferences:[{id:'local-new',name:'Local',status:'active'}]
  });
  const unlinkedView=unlinkedCards.viewModel();
  assert.strictEqual(unlinkedView.length,1);
  await unlinkedCards.click(unlinkedCards.render(unlinkedView));
  assert.deepStrictEqual(unlinkedCards.localOpens,['local-new']);
  assert.deepStrictEqual(unlinkedCards.remoteOpens,[]);

  const linkedCards=startupCards({
    localConferences:[{id:'local-old',name:'Linked',status:'active'}],
    links:{'local-old':{
      localConferenceId:'local-old',remoteConferenceId:'remote-linked',
      linkStatus:'cloud_linked',knownRevision:1
    }},
    discovered:[{
      remoteConferenceId:'remote-linked',
      conference:{id:'remote-copy',name:'Linked',status:'active'}
    }]
  });
  const linkedView=linkedCards.viewModel();
  assert.strictEqual(linkedView.length,1);
  assert.strictEqual(linkedView[0].id,'local-old');
  assert.strictEqual(
    linkedView[0].__startupDiscoveredRemoteId,'remote-linked'
  );
  await linkedCards.click(linkedCards.render(linkedView));
  assert.deepStrictEqual(linkedCards.localOpens,[]);
  assert.deepStrictEqual(linkedCards.remoteOpens,[{
    id:'remote-linked',options:{enterApplication:true}
  }]);
  assert.strictEqual(linkedCards.renders(),1,
    'successful linked entry must not redraw startup after completion');

  const failedLinkedCards=startupCards({remoteResult:{
    ok:false,status:'membership_unavailable'
  }});
  await failedLinkedCards.click(
    '<article onclick="openDiscoveredConferenceFromStartup(\'remote-failed\')"></article>'
  );
  assert.strictEqual(failedLinkedCards.renders(),2,
    'failed linked entry restores the startup card state');

  const discoveredCards=startupCards({
    discovered:[{
      remoteConferenceId:'remote-only',
      conference:{id:'downloaded-copy',name:'Remote',status:'active'}
    }]
  });
  const discoveredView=discoveredCards.viewModel();
  assert.strictEqual(discoveredView.length,1);
  await discoveredCards.click(discoveredCards.render(discoveredView));
  assert.deepStrictEqual(discoveredCards.remoteOpens,[{
    id:'remote-only',options:{enterApplication:true}
  }]);

  assert.match(scriptSource,
    /openDiscoveredConferenceFromStartup\(\\''\+conf\.__startupDiscoveredRemoteId/);
  assert.match(scriptSource,
    /else\{\s*html \+= '<article class="startup-conference-card '\+cardClass\+'" onclick="openConferenceFromStartup\(\\''\+conf\.id/);
  assert.match(scriptSource,
    /ConferenceLinkStore\.get\(localId\)[\s\S]*remoteConferenceId/);
  assert.match(scriptSource,
    /if\(!remoteId\|\|remoteIds\[remoteId\]\|\|!conference\)return;/);

  console.log('startup conference discovery tests passed');
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
