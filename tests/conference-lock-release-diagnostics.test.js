const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const source=fs.readFileSync(path.join(
  __dirname,'../js/sync/conference-locks.js'
),'utf8');
const conferenceId='11111111-1111-4111-8111-111111111111';
const deviceId='22222222-2222-4222-8222-222222222222';
const lockToken='33333333-3333-4333-8333-333333333333';

function environment(rpc){
  let calls=0;
  const client={rpc(name,args){calls++;return rpc(name,args);}};
  const sandbox={window:null,Promise,Date,JSON,Object,String,
    structuredClone:value=>JSON.parse(JSON.stringify(value)),
    SupabaseClientLayer:{getClient:()=>client},
    SupabaseAuth:{getSession:()=>({user:{id:'44444444-4444-4444-8444-444444444444'}})},
    SupabaseDeviceIdentity:{getOrCreate:()=>({id:deviceId})}};
  sandbox.window=sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source,sandbox,{filename:'conference-locks.js'});
  return {api:sandbox.ConferenceLocks,calls:()=>calls};
}

async function release(env){
  return env.api.releaseLock(conferenceId,{
    section:'accommodation',lockToken:lockToken
  });
}

(async function(){
  const supabaseError={code:'42501',message:'permission denied',
    details:'release detail',hint:'release hint',status:403,
    statusText:'Forbidden',name:'PostgrestError'};
  const responseFailure=environment(()=>Promise.resolve({
    data:null,error:supabaseError,status:403,statusText:'Forbidden'
  }));
  const responseResult=await release(responseFailure);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(responseResult)),{
    ok:false,status:'error',
    data:null,
    error:{code:'LOCK_REQUEST_FAILED',message:'The lock request failed.'}
  },'instrumentation preserves the existing response.error result');
  assert.strictEqual(responseFailure.calls(),1,'response.error performs one RPC');
  const responseDiagnostic=responseFailure.api.getState().lastReleaseDiagnostic;
  assert.strictEqual(responseDiagnostic.rpcName,'release_conference_section_lock');
  assert.strictEqual(responseDiagnostic.outcome,'response_error');
  assert.strictEqual(responseDiagnostic.conferenceId,'11111111...1111');
  assert.strictEqual(responseDiagnostic.deviceId,'22222222...2222');
  assert.strictEqual(responseDiagnostic.lockToken,'333333...3333');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(responseDiagnostic.error)),supabaseError);
  assert.strictEqual(responseDiagnostic.responseStatus,403);
  assert.strictEqual(responseDiagnostic.responseStatusText,'Forbidden');
  assert.ok(responseDiagnostic.startedAt&&responseDiagnostic.endedAt);
  assert.ok(Number.isInteger(responseDiagnostic.durationMs));
  assert.strictEqual(JSON.stringify(responseDiagnostic).includes(deviceId),false);
  assert.strictEqual(JSON.stringify(responseDiagnostic).includes(lockToken),false);

  const thrown=Object.assign(new Error('network release failed'),{
    code:'FETCH_FAILED',details:'connection closed',hint:'check network',
    status:0,statusText:'',name:'TypeError'
  });
  const exceptionFailure=environment(()=>Promise.reject(thrown));
  const exceptionResult=await release(exceptionFailure);
  assert.strictEqual(exceptionFailure.calls(),1,'exception performs one RPC');
  assert.strictEqual(exceptionResult.ok,false);
  assert.strictEqual(exceptionResult.error.code,'NETWORK_ERROR',
    'instrumentation preserves existing exception normalization');
  const exceptionDiagnostic=exceptionFailure.api.getState().lastReleaseDiagnostic;
  assert.strictEqual(exceptionDiagnostic.outcome,'exception');
  assert.strictEqual(exceptionDiagnostic.error.code,'FETCH_FAILED');
  assert.ok(exceptionDiagnostic.stack&&exceptionDiagnostic.stack.length>0);

  const success=environment(()=>Promise.resolve({data:{status:'released'},error:null}));
  const successResult=await release(success);
  assert.strictEqual(successResult.status,'released');
  assert.strictEqual(success.calls(),1,'normal response performs one RPC');
  assert.strictEqual(success.api.getState().lastReleaseDiagnostic.outcome,'response');
  assert.strictEqual(success.api.getState().lastReleaseDiagnostic.error,null);
  assert.strictEqual(/localStorage|indexedDB|AppIndexedDB|ConferenceLinkStore|SyncQueue/.test(source),false,
    'release diagnostics do not write synchronization stores');
  console.log('conference lock release diagnostics tests passed');
})().catch(error=>{console.error(error);process.exit(1);});
