'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {verifyReleaseEvidence}=require('./verify-release-evidence.cjs');
const MIGRATION_READ_ONLY_SQL='BEGIN READ ONLY; SELECT name FROM supabase_migrations.schema_migrations ORDER BY name; COMMIT;';
function redact(message){return String(message).replace(/(?:postgres(?:ql)?:\/\/)[^\s@]+@/gi,'postgresql://[REDACTED]@').replace(/(?:bearer\s+|password[=:]\s*|token[=:]\s*)[^\s,;]+/gi,'[REDACTED]');}
function fail(message){process.stderr.write('release preflight failed: '+redact(message)+'\n');process.exitCode=1;}
function run(argv){
  const evidenceFlag=argv.indexOf('--evidence');const shaFlag=argv.indexOf('--release-sha');
  if(evidenceFlag<0||shaFlag<0||!argv[evidenceFlag+1]||!argv[shaFlag+1])throw new Error('EXPLICIT_EVIDENCE_AND_RELEASE_SHA_REQUIRED');
  const evidence=JSON.parse(fs.readFileSync(path.resolve(argv[evidenceFlag+1]),'utf8'));
  if(evidence.environment!=='development')throw new Error('DEVELOPMENT_TARGET_REQUIRED');
  if(evidence.releaseSha!==argv[shaFlag+1])throw new Error('EXPLICIT_RELEASE_SHA_MISMATCH');
  evidence.repositorySourceSha=execFileSync('git',['rev-parse','HEAD'],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8'}).trim();
  const repositoryEdgeFiles={'index.ts':fs.readFileSync(path.resolve(__dirname,'../../supabase/functions/platform-device-operation/index.ts'),'utf8')};
  const result=verifyReleaseEvidence(evidence,{repositoryEdgeFiles});
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(require.main===module){try{run(process.argv.slice(2));}catch(error){fail(error&&error.code||error&&error.message||'PREFLIGHT_FAILED');}}
module.exports={MIGRATION_READ_ONLY_SQL,redact,run};
