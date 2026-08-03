const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const core=fs.readFileSync(path.join(__dirname,'../core.js'),'utf8');
const start=core.indexOf('function normalizeConferenceImportRecovery');
const end=core.indexOf('function normalizeAppDataCandidate',start);
assert.ok(start>=0&&end>start,'central recovery normalizer must exist');
const sandbox={};
vm.runInNewContext(core.slice(start,end),sandbox);

const remoteA='11111111-1111-4111-8111-111111111111';
const remoteB='22222222-2222-4222-8222-222222222222';
const account='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function record(remote,local,overrides){
  return Object.assign({
    remoteConferenceId:remote,
    localConferenceId:local,
    revision:1,
    schemaVersion:'1',
    authenticatedUserId:account,
    status:'normalized_persisted',
    snapshot:{id:local,name:'Conference',status:'active'}
  },overrides||{});
}

const valid={conferenceImportRecovery:{}};
valid.conferenceImportRecovery[remoteA]=record(remoteA,'local-a');
sandbox.normalizeConferenceImportRecovery(valid);
assert.strictEqual(Object.keys(valid.conferenceImportRecovery).length,1);

const malformed={conferenceImportRecovery:{bad:record(remoteA,'local-a')}};
malformed.conferenceImportRecovery[remoteA]=record(remoteA,'local-b',{
  authenticatedUserId:'not-an-account-id'
});
malformed.conferenceImportRecovery[remoteB]=record(remoteB,'local-c',{
  snapshot:{id:'different-local',status:'active'}
});
sandbox.normalizeConferenceImportRecovery(malformed);
assert.deepStrictEqual(Object.keys(malformed.conferenceImportRecovery),[]);

const duplicateReservation={conferenceImportRecovery:{}};
duplicateReservation.conferenceImportRecovery[remoteA]=record(remoteA,'reserved');
duplicateReservation.conferenceImportRecovery[remoteB]=record(remoteB,'reserved');
sandbox.normalizeConferenceImportRecovery(duplicateReservation);
assert.strictEqual(Object.keys(duplicateReservation.conferenceImportRecovery).length,1);

const unsupported={conferenceImportRecovery:{}};
unsupported.conferenceImportRecovery[remoteA]=record(remoteA,'local-a',{
  schemaVersion:'2'
});
sandbox.normalizeConferenceImportRecovery(unsupported);
assert.deepStrictEqual(Object.keys(unsupported.conferenceImportRecovery),[]);

const queue=fs.readFileSync(path.join(
  __dirname,'../js/sync/conference-queue-integration.js'),'utf8');
const resolver=fs.readFileSync(path.join(
  __dirname,'../js/sync/conference-sync-state-resolver.js'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../script.js'),'utf8');
assert.match(queue,/isConferenceImportRecoveryPending[\s\S]*import_recovery_pending/);
assert.match(resolver,
  /isConferenceImportRecoveryPending[\s\S]*pending_local_application/);
assert.match(script,
  /setCurrentConferenceById[\s\S]*isConferenceImportRecoveryPending/);

console.log('conference import recovery normalization tests passed');
