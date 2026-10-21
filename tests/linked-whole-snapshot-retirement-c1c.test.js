'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const read=file=>fs.readFileSync(file,'utf8');
const migration=read('supabase/migrations/20261009120000_retire_linked_whole_snapshot_infrastructure.sql');
const runtime=[read('index.html'),read('service-worker.js'),read('state.js'),read('script.js'),read('js/sync/discovered-conference-open-service.js'),read('js/sync/startup-conference-discovery.js'),read('js/supabase/conference-device-operation-contract.js')].join('\n');
test('C1C destructive migration retires the complete database snapshot ledger',()=>{
  for(const name of ['conference_snapshots','sync_operations','sync_conflicts','conference_snapshot_guard_intents'])assert.match(migration,new RegExp(`drop table if exists public\\.${name}`,'i'));
  for(const name of ['apply_conference_snapshot','resolve_sync_conflict','device_guarded_apply_conference_snapshot','device_guarded_download_conference_snapshot','device_guarded_get_conference_snapshot_metadata','device_guarded_get_sync_conflict','device_guarded_list_sync_conflicts','device_guarded_resolve_sync_conflict'])assert.match(migration,new RegExp(`drop function if exists public\\.${name}`,'i'));
});
test('active runtime has no snapshot database, queue, realtime, conflict, recovery or dispatcher path',()=>{
  assert.doesNotMatch(runtime,/conference_snapshots|sync_operations|SupabaseSnapshotSync|OfflineSyncQueue|OfflineFirstIntegration|operationType\s*[:=]\s*['"]snapshot|device_guarded_(?:apply|download|get)_conference_snapshot|device_guarded_(?:get|list|resolve)_sync_conflict|needs_resolution|snapshotRevision|baseRevision/i);
});
test('retired snapshot-only files and cache entries are absent',()=>{
  const retired=['js/supabase/snapshot-sync.js','js/sync/sync-queue.js','js/sync/sync-processor.js','js/sync/realtime.js','js/sync/offline-first-integration.js','js/sync/conference-realtime-manager.js','js/sync/automatic-sync-orchestrator.js','js/sync/conflict-resolution.js','js/sync/conflict-resolution-ui.js','js/storage/conference-publishing-engine.js','js/storage/conference-publish-recovery.js'];
  for(const file of retired){assert.equal(fs.existsSync(file),false,file);assert.equal(runtime.includes(file),false,file);}
});
test('artifact persistence remains while canonical conference save fails before persistence',()=>{
  const repository=read('js/storage/storage-repository.js');
  assert.match(repository,/persistence\.saveAppData/);
  assert.doesNotMatch(repository,/OfflineFirstIntegration|AutomaticSyncOrchestrator|operationType/);
  const state=read('state.js');
  assert.match(state,/currentConference&&String\(currentConference\.id[\s\S]*?CANONICAL_CONFERENCE_MUTATION_CONTRACT_REQUIRED[\s\S]*?return false;[\s\S]*?StorageRepository\.saveAppData/);
});
test('canonical link records carry identity only, without whole-document conflict authority',()=>{
  const links=read('js/sync/conference-link-store.js');
  assert.match(links,/conference_manager_canonical_links_v2/);
  assert.doesNotMatch(links,/knownRevision|actualRevision|conflict|syncState|pendingLocalApplication|needs_resolution/);
});
