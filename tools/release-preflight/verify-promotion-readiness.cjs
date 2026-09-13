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
function sourceAt(revision,file){try{return git(['show',`${revision}:${file}`]);}catch(error){fail(`SOURCE_UNAVAILABLE:${file}`);}}
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
  if(productionCacheRevision!==shellRevision)fail('PRODUCTION_SHELL_REVISION_MISMATCH');
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
  const requirements=revision?JSON.parse(sourceAt(revision,'tools/production-release/controlled-production-manifest.json')).releaseRequirements:manifest.releaseRequirements;
  if(!requirements||!Array.isArray(requirements.requiredMigrationFiles)||!Array.isArray(requirements.developmentOnlyMigrationFiles))fail('RELEASE_REQUIREMENTS_MISSING');
  for(const file of requirements.requiredMigrationFiles){if(!file.startsWith('supabase/migrations/'))fail(`REQUIRED_PRODUCTION_MIGRATION_MISSING:${file}`);if(revision)sourceAt(revision,file);else if(!fs.existsSync(path.join(root,file)))fail(`REQUIRED_PRODUCTION_MIGRATION_MISSING:${file}`);}
  for(const file of requirements.developmentOnlyMigrationFiles){if(!file.startsWith('supabase/migrations/'))fail(`DEVELOPMENT_ONLY_MIGRATION_MISSING:${file}`);if(revision)sourceAt(revision,file);else if(!fs.existsSync(path.join(root,file)))fail(`DEVELOPMENT_ONLY_MIGRATION_MISSING:${file}`);if(requirements.requiredMigrationFiles.includes(file))fail(`DEVELOPMENT_ONLY_MIGRATION_INCLUDED:${file}`);}
  if(!requirements.edge||requirements.edge.slug!=='platform-device-operation'||requirements.edge.verifyJwt!==true)fail('EDGE_RELEASE_CONTRACT_MISSING');
  if(revision)sourceAt(revision,requirements.edge.sourceFile);else if(!fs.existsSync(path.join(root,requirements.edge.sourceFile)))fail('EDGE_RELEASE_CONTRACT_MISSING');
}
function verifyArchitecture(revision){for(const file of ['index.html','js/platform-integration.js','js/sync/module-permission-administration-service.js','modules/reservations/reservations-module.js']){const source=sourceAt(revision,file);for(const pattern of forbiddenArchitecture)if(pattern.test(source))fail(`REJECTED_ARCHITECTURE_PRESENT:${file}`);}}
function verifyRepository(candidate,base,promotion){
  if(!sha.test(candidate)||!sha.test(base))fail('EXPLICIT_FULL_SHA_REQUIRED');
  if(git(['merge-base',base,candidate])!==base)fail('BASE_NOT_ANCESTOR_OF_CANDIDATE');
  if(git(['rev-list','--count',`${candidate}..${base}`])!=='0')fail('CANDIDATE_BEHIND_BASE');
  verifyManifest(candidate);verifyArchitecture(candidate);
  const candidateMarkers=extractMarkers(candidate),baseMarkers=extractMarkers(base);
  if(promotion){
    if(!isGreater(candidateMarkers.appVersion,baseMarkers.appVersion))fail('PROMOTION_APPLICATION_VERSION_NOT_ADVANCED');
    if(candidateMarkers.productionCacheRevision===baseMarkers.productionCacheRevision)fail('PROMOTION_CACHE_REVISION_NOT_ADVANCED');
    if(candidateMarkers.shellRevision===baseMarkers.shellRevision)fail('PROMOTION_SHELL_REVISION_NOT_ADVANCED');
  }
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
module.exports={ReadinessError,extractMarkers,isGreater,parseArgs,verifyManifest,verifyRepository,runReleaseChecks,run};
