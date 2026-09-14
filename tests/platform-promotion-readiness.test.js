'use strict';
const assert=require('node:assert/strict');
const childProcess=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const readiness=require('../tools/release-preflight/verify-promotion-readiness.cjs');
const manifest=require('../tools/production-release/controlled-production-manifest.json');
const root=path.resolve(__dirname,'..');
const git=(args,options={})=>childProcess.execFileSync('git',args,{cwd:root,encoding:'utf8',...options}).trim();
function candidateCommit(base,replacements={}){
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'promotion-readiness-')),indexFile=path.join(temporary,'index'),env={...process.env,GIT_INDEX_FILE:indexFile,GIT_AUTHOR_NAME:'Promotion Readiness Test',GIT_AUTHOR_EMAIL:'promotion-readiness@example.invalid',GIT_COMMITTER_NAME:'Promotion Readiness Test',GIT_COMMITTER_EMAIL:'promotion-readiness@example.invalid'};
  try{
    git(['read-tree',base],{env});
    for(const [file,transform] of Object.entries(replacements)){
      const source=childProcess.execFileSync('git',['show',`${base}:${file}`],{cwd:root,encoding:'utf8'});
      const object=git(['hash-object','-w','--stdin'],{input:transform(source)});
      git(['update-index','--add','--cacheinfo','100644',object,file],{env});
    }
    const tree=git(['write-tree'],{env});
    return git(['commit-tree',tree,'-p',base],{input:'test: promotion marker guard fixture\n',env});
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
const releaseBase=()=>candidateCommit(git(['rev-parse','HEAD']),{'tools/production-release/controlled-production-manifest.json':()=>fs.readFileSync(path.join(root,'tools/production-release/controlled-production-manifest.json'),'utf8')});
const nextPatch=version=>{const parts=version.split('.').map(Number);return `${parts[0]}.${parts[1]}.${parts[2]+1}`;};

test('controlled Production requirements include approved Reservations and Platform sources',()=>{
  for(const name of ['20260908153405_reservations_v1_foundation.sql','20260909120555_production_validated_phase1c_variable_disambiguation.sql','20260912192000_platform_module_entry_access_gate.sql','20260913173000_module_permission_catalog_arabic_labels.sql'])assert.ok(manifest.releaseRequirements.requiredMigrationFiles.includes(`supabase/migrations/${name}`));
  assert.ok(manifest.releaseRequirements.developmentOnlyMigrationFiles.includes('supabase/migrations/20260913141000_platform_private_recovery_rls_hardening.sql'));
  assert.equal(manifest.releaseRequirements.requiredMigrationFiles.includes('supabase/migrations/20260913141000_platform_private_recovery_rls_hardening.sql'),false);
  assert.equal(readiness.verifyManifest(),undefined);
});
test('controlled package separates bootstrap replay, established Production history, and future promotion',()=>{
  assert.deepEqual(manifest.packageModel.historicalBootstrapReplay,{entryCount:57,applyCount:43,supersededCount:14,terminalVersion:'20260907150000',executionSource:'entries'});
  assert.equal(manifest.packageModel.establishedProductionHistory.length,14);
  assert.deepEqual(manifest.packageModel.futureIncrementalPromotion.entries,[]);
  for(const entry of manifest.packageModel.establishedProductionHistory){assert.equal(entry.executable,false);assert.equal(manifest.entries.some(controlled=>controlled.version===entry.version),false);}
  const recovery=manifest.packageModel.establishedProductionHistory.find(entry=>entry.version==='20260913141000');
  assert.equal(recovery.representation,'ESTABLISHED_PRODUCTION_CONDITIONAL_RECONCILIATION');
  assert.match(recovery.sourcePolicy,/Development body remains excluded and is not replayable/);
});
test('canonical version markers remain internally consistent',()=>{
  const worker=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
  const version=fs.readFileSync(path.join(root,'version.js'),'utf8');
  const appVersion=(worker.match(/const APP_VERSION = '([^']+)'/)||[])[1];
  const releaseVersion=(version.match(/version: '([^']+)'/)||[])[1];
  assert.match(appVersion,/^\d+\.\d+\.\d+$/);assert.equal(appVersion,releaseVersion);
  assert.equal(readiness.isGreater('3.4.1','3.4.0'),true);assert.equal(readiness.isGreater('3.4.0','3.4.0'),false);assert.equal(readiness.isGreater('3.3.9','3.4.0'),false);
});
test('verifyRepository rejects an application version that was not advanced',()=>{
  const base=releaseBase(),candidate=candidateCommit(base);
  assert.throws(()=>readiness.verifyRepository(candidate,base,true),/PROMOTION_APPLICATION_VERSION_NOT_ADVANCED/);
});
test('verifyRepository rejects an unchanged Production cache revision',()=>{
  const base=releaseBase(),markers=readiness.extractMarkers(base),next=nextPatch(markers.appVersion);
  const candidate=candidateCommit(base,{
    'service-worker.js':source=>source.replace(`const APP_VERSION = '${markers.appVersion}';`,`const APP_VERSION = '${next}';`),
    'version.js':source=>source.replace(`version: '${markers.appVersion}'`,`version: '${next}'`)
  });
  assert.throws(()=>readiness.verifyRepository(candidate,base,true),/PROMOTION_CACHE_REVISION_NOT_ADVANCED/);
});
test('verifyRepository rejects an unchanged shell revision',()=>{
  const base=releaseBase(),markers=readiness.extractMarkers(base),next=nextPatch(markers.appVersion),nextCache=`${markers.productionCacheRevision}-next`;
  const candidate=candidateCommit(base,{
    'service-worker.js':source=>source.replace(`const APP_VERSION = '${markers.appVersion}';`,`const APP_VERSION = '${next}';`).replace(`: '${markers.productionCacheRevision}';\nconst CACHE_NAME`,`: '${nextCache}';\nconst CACHE_NAME`),
    'version.js':source=>source.replace(`version: '${markers.appVersion}'`,`version: '${next}'`)
  });
  assert.throws(()=>readiness.verifyRepository(candidate,base,true),/PROMOTION_SHELL_REVISION_NOT_ADVANCED/);
});
test('preflight has no network, credential, or deployment path',()=>{
  const source=fs.readFileSync(path.join(root,'tools/release-preflight/verify-promotion-readiness.cjs'),'utf8');
  assert.doesNotMatch(source,/fetch\s*\(|https?:|process\.env|supabase db push|deploy/i);
  assert.match(source,/PROMOTION_APPLICATION_VERSION_NOT_ADVANCED/);
  assert.match(source,/BASE_NOT_ANCESTOR_OF_CANDIDATE/);
  assert.match(source,/npm',\['run','check'\]/);
  assert.match(source,/reservations-reconciliation-rejected-architecture-guard/);
});
