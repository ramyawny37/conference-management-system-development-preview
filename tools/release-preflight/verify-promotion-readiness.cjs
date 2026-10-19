'use strict';
const childProcess=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const manifest=require('../production-release/controlled-production-manifest.json');

const root=path.resolve(__dirname,'../..');
const sha=/^[0-9a-f]{40}$/;
const forbiddenArchitecture=[/document\.write\s*\(/, /platform-integration-core\.js/, /reservations-reconciliation-bootstrap\.js/];
class ReadinessError extends Error{constructor(code){super(code);this.code=code;}}
function fail(code){throw new ReadinessError(code);}
function git(args){return childProcess.execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();}
function gitRaw(args){return childProcess.execFileSync('git',args,{cwd:root});}
function sourceAt(revision,file){try{return git(['show',`${revision}:${file}`]);}catch(error){fail(`SOURCE_UNAVAILABLE:${file}`);}}
function sourceBytesAt(revision,file){try{return gitRaw(['show',`${revision}:${file}`]);}catch(error){fail(`SOURCE_UNAVAILABLE:${file}`);}}
function extractMarkers(revision){
  const worker=sourceAt(revision,'service-worker.js');
  const version=sourceAt(revision,'version.js');
  const index=sourceAt(revision,'index.html');
  const appVersion=(worker.match(/const APP_VERSION = '([^']+)'/)||[])[1];
  const releaseVersion=(version.match(/version: '([^']+)'/)||[])[1];
  const productionCacheRevision=(worker.match(/: '([^']+)';\nconst CACHE_NAME/)||[])[1];
  const shellRevision=(index.match(/: '([^']+)';\n<\/script>\n<script src="pwa\.js/)||[])[1];
  if(!appVersion||!releaseVersion||!productionCacheRevision||!shellRevision)fail('CANONICAL_VERSION_MARKER_MISSING');
  if(appVersion!==releaseVersion)fail('APPLICATION_VERSION_MARKER_MISMATCH');
  return {appVersion,productionCacheRevision,shellRevision};
}
function semver(value){const match=value.match(/^(\d+)\.(\d+)\.(\d+)$/);if(!match)fail('APPLICATION_VERSION_NOT_SEMVER');return match.slice(1).map(Number);}
function isGreater(left,right){const a=semver(left),b=semver(right);for(let index=0;index<a.length;index++){if(a[index]!==b[index])return a[index]>b[index];}return false;}
function parseArgs(argv){const options={promotion:false};for(let index=0;index<argv.length;index++){
  const argument=argv[index];
  if(argument==='--promotion')options.promotion=true;
  else if(argument==='--candidate-sha')options.candidate=argv[++index];
  else if(argument==='--base-sha')options.base=argv[++index];
  else fail(`UNSUPPORTED_ARGUMENT:${argument}`);
}if(!options.candidate)fail('CANDIDATE_SHA_REQUIRED');return options;}
function verifyManifest(revision){
  const controlled=revision?JSON.parse(sourceAt(revision,'tools/production-release/controlled-production-manifest.json')):manifest;
  const requirements=controlled.releaseRequirements;
  if(!requirements||!Array.isArray(requirements.requiredMigrationFiles)||!Array.isArray(requirements.developmentOnlyMigrationFiles))fail('RELEASE_REQUIREMENTS_MISSING');
  for(const file of requirements.requiredMigrationFiles){if(!file.startsWith('supabase/migrations/'))fail(`REQUIRED_PRODUCTION_MIGRATION_MISSING:${file}`);if(revision)sourceAt(revision,file);else if(!fs.existsSync(path.join(root,file)))fail(`REQUIRED_PRODUCTION_MIGRATION_MISSING:${file}`);}
  for(const file of requirements.developmentOnlyMigrationFiles){if(!file.startsWith('supabase/migrations/'))fail(`DEVELOPMENT_ONLY_MIGRATION_MISSING:${file}`);if(revision)sourceAt(revision,file);else if(!fs.existsSync(path.join(root,file)))fail(`DEVELOPMENT_ONLY_MIGRATION_MISSING:${file}`);if(requirements.requiredMigrationFiles.includes(file))fail(`DEVELOPMENT_ONLY_MIGRATION_INCLUDED:${file}`);}
  if(!requirements.edge||requirements.edge.slug!=='platform-device-operation'||requirements.edge.verifyJwt!==true)fail('EDGE_RELEASE_CONTRACT_MISSING');
  if(revision)sourceAt(revision,requirements.edge.sourceFile);else if(!fs.existsSync(path.join(root,requirements.edge.sourceFile)))fail('EDGE_RELEASE_CONTRACT_MISSING');
  const model=controlled.packageModel;
  if(!model||model.purpose!=='HISTORICAL_BOOTSTRAP_REPLAY_AND_INCREMENTAL_PROMOTION'||!Array.isArray(model.establishedProductionHistory)||!Array.isArray(model.futureIncrementalPromotion?.entries))fail('CONTROLLED_PACKAGE_MODEL_MISSING');
  const establishedSources=model.establishedProductionHistory.filter(entry=>entry.sourceFile).map(entry=>entry.sourceFile);
  for(const file of requirements.requiredMigrationFiles)if(!establishedSources.includes(file))fail(`APPROVED_PRODUCTION_HISTORY_UNREPRESENTED:${file}`);
  for(const entry of model.establishedProductionHistory){if(entry.executable!==false)fail(`ESTABLISHED_PRODUCTION_HISTORY_MUST_NOT_EXECUTE:${entry.version}`);if(entry.sourceFile){const body=revision?sourceBytesAt(revision,entry.sourceFile):fs.readFileSync(path.join(root,entry.sourceFile));const digest=require('node:crypto').createHash('sha256').update(body).digest('hex');if(digest!==entry.sourceSha256)fail(`ESTABLISHED_PRODUCTION_SOURCE_HASH_MISMATCH:${entry.version}`);}}
  const incrementalFiles=model.futureIncrementalPromotion.entries.map(entry=>entry.sourceFile);
  for(const file of requirements.developmentOnlyMigrationFiles)if(incrementalFiles.includes(file))fail(`DEVELOPMENT_ONLY_MIGRATION_INCLUDED:${file}`);
  const incrementalKeys=new Set();
  for(const [index,entry] of model.futureIncrementalPromotion.entries.entries()){
    if(entry.order!==index+1||entry.action!=='APPLY_ONCE'||entry.executable!==true||!entry.idempotencyKey||incrementalKeys.has(entry.idempotencyKey))fail(`INCREMENTAL_EXECUTION_CONTRACT_INVALID:${entry.sourceFile}`);
    incrementalKeys.add(entry.idempotencyKey);
    const body=revision?sourceBytesAt(revision,entry.sourceFile):fs.readFileSync(path.join(root,entry.sourceFile));
    const digest=require('node:crypto').createHash('sha256').update(body).digest('hex');
    if(digest!==entry.sourceSha256)fail(`INCREMENTAL_SOURCE_HASH_MISMATCH:${entry.sourceFile}`);
  }
  const edge=model.futureIncrementalPromotion.edgeRelease;
  if(!edge||edge.slug!=='platform-device-operation'||edge.verifyJwt!==true||edge.releaseSha!==model.futureIncrementalPromotion.releaseSha||edge.currentProductionVersion!==3||edge.approvedDevelopmentVersion!==16)fail('INCREMENTAL_EDGE_CONTRACT_INVALID');
  const edgeBody=revision?sourceBytesAt(revision,edge.sourceFile):fs.readFileSync(path.join(root,edge.sourceFile));
  if(require('node:crypto').createHash('sha256').update(edgeBody).digest('hex')!==edge.sourceSha256)fail('INCREMENTAL_EDGE_SOURCE_HASH_MISMATCH');
}
function verifyArchitecture(revision){for(const file of ['index.html','js/platform-integration.js','js/sync/module-permission-administration-service.js','modules/reservations/reservations-module.js']){const source=sourceAt(revision,file);for(const pattern of forbiddenArchitecture)if(pattern.test(source))fail(`REJECTED_ARCHITECTURE_PRESENT:${file}`);}}
function verifyPublicConfigIsolation(revision){
  const config=sourceAt(revision,'js/supabase/public-config.js');
  const worker=sourceAt(revision,'service-worker.js');
  if(!config.includes("const DEVELOPMENT_PATH='/conference-management-system-development-preview/';")||
    !config.includes("url:'https://gppwltrifgfxrkzvvxoe.supabase.co'")||
    !config.includes("url:'https://mpezfbvcdfxpgflehuot.supabase.co'")||
    !config.includes("'sb_publishable_Ibnpk0i0faZMUCoFOr8MTQ_G-iujGEp'")||
    !config.includes("'sb_publishable_lWUuYqgGiez3RB_Kh5hhyA_PylfyAlC'")||
    !/global\.location\.pathname\.includes\(DEVELOPMENT_PATH\)/.test(config)||
    !/global\.SUPABASE_RUNTIME_CONFIG=IS_DEVELOPMENT\s*\? DEVELOPMENT_CONFIG\s*:\s*PRODUCTION_CONFIG;/.test(config))fail('PROMOTION_PUBLIC_CONFIG_ENVIRONMENT_ISOLATION_REQUIRED');
  if(/service[_-]?role|sb_secret_/i.test(config))fail('PROMOTION_PUBLIC_CONFIG_SECRET_PRESENT');
  const revisions=worker.match(/const CACHE_REVISION = IS_DEVELOPMENT\s*\? '([^']+)'\s*:\s*'([^']+)'/);
  if(!revisions||revisions[1]===revisions[2])fail('PROMOTION_CACHE_ENVIRONMENT_ISOLATION_REQUIRED');
  const networkOnly=worker.slice(worker.indexOf('function productionPublicConfigNetworkOnly'),worker.indexOf("self.addEventListener('fetch'"));
  const fetchHandler=worker.slice(worker.indexOf("self.addEventListener('fetch'"));
  const configGate=fetchHandler.indexOf("requestUrl.pathname.endsWith('/js/supabase/public-config.js')");
  const cacheFirst=fetchHandler.indexOf('caches.open(CACHE_NAME)',configGate);
  if(!/fetch\(new Request\(request,\{cache:'no-store'\}\)\)/.test(networkOnly)||/caches\.|cache\.match/.test(networkOnly)||!/status:503/.test(networkOnly)||configGate<0||cacheFirst<=configGate||!/respondWith\(productionPublicConfigNetworkOnly\(request\)\)/.test(fetchHandler.slice(configGate,cacheFirst)))fail('PROMOTION_PUBLIC_CONFIG_CACHE_ISOLATION_REQUIRED');
}
function verifyRepository(candidate,base,promotion){
  if(!sha.test(candidate)||!sha.test(base))fail('EXPLICIT_FULL_SHA_REQUIRED');
  if(git(['merge-base',base,candidate])!==base)fail('BASE_NOT_ANCESTOR_OF_CANDIDATE');
  if(git(['rev-list','--count',`${candidate}..${base}`])!=='0')fail('CANDIDATE_BEHIND_BASE');
  verifyManifest(candidate);verifyArchitecture(candidate);
  if(promotion)verifyPublicConfigIsolation(candidate);
  const candidateMarkers=extractMarkers(candidate),baseMarkers=extractMarkers(base);
  if(promotion){
    if(!isGreater(candidateMarkers.appVersion,baseMarkers.appVersion))fail('PROMOTION_APPLICATION_VERSION_NOT_ADVANCED');
    if(candidateMarkers.productionCacheRevision===baseMarkers.productionCacheRevision)fail('PROMOTION_CACHE_REVISION_NOT_ADVANCED');
    if(candidateMarkers.shellRevision===baseMarkers.shellRevision)fail('PROMOTION_SHELL_REVISION_NOT_ADVANCED');
    if(candidateMarkers.productionCacheRevision!==candidateMarkers.shellRevision)fail('PRODUCTION_SHELL_REVISION_MISMATCH');
  }else if(candidateMarkers.productionCacheRevision!==candidateMarkers.shellRevision)fail('PRODUCTION_SHELL_REVISION_MISMATCH');
  return {candidate,base,promotion,markers:candidateMarkers,versionAdvanced:promotion};
}
function runReleaseChecks(){
  childProcess.execFileSync('npm',['run','check'],{cwd:root,stdio:'inherit'});
  childProcess.execFileSync(process.execPath,['--test',
    'tests/reservations-reconciliation-rejected-architecture-guard.test.js',
    'tests/platform-promotion-readiness.test.js',
    'tests/platform-release-preflight-round3i2.test.js',
    'tests/controlled-production-package-static.test.js',
    'tests/controlled-production-transport.test.js',
    'tests/controlled-production-sql-transport.test.js'
  ],{cwd:root,stdio:'inherit'});
}
function run(argv=process.argv.slice(2)){const options=parseArgs(argv),candidate=git(['rev-parse',options.candidate]),base=git(['rev-parse',options.base||'origin/main']);const result=verifyRepository(candidate,base,options.promotion);runReleaseChecks();process.stdout.write(`${JSON.stringify({status:'READY',...result})}\n`);return result;}
if(require.main===module){try{run();}catch(error){process.stderr.write(`release promotion preflight refused: ${error.code||error.message}\n`);process.exitCode=1;}}
module.exports={ReadinessError,extractMarkers,isGreater,parseArgs,verifyManifest,verifyPublicConfigIsolation,verifyRepository,runReleaseChecks,run};
