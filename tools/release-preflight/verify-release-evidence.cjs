'use strict';
const crypto=require('node:crypto');

const ENVIRONMENTS=Object.freeze({
  development:Object.freeze({ref:'gppwltrifgfxrkzvvxoe',name:'conference-management-system-development'}),
  production:Object.freeze({ref:'mpezfbvcdfxpgflehuot',name:'conference-manager-dev Project'})
});
const REQUIRED_MIGRATIONS=Object.freeze([
  'system_access_platform_profile_reconciliation','system_owner_platform_owner_reconciliation',
  'inventory_authority_retirement','module_access_delegation_enforcement',
  'module_permission_administration_backend_surface'
]);
const REQUIRED_EDGE_OPERATIONS=Object.freeze([
  'search_module_permission_candidates','list_module_permission_catalog_for_administration',
  'manage_catalog_module_grant','list_permission_administration_stores',
  'list_module_permission_grants','manage_foundation_module_grant',
  'recover_revoke_final_module_manager'
]);
const SECRET_KEY=/(?:password|database_url|service.?role|access.?token|refresh.?token|authorization|api.?key|secret)/i;
const SHA=/^[0-9a-f]{40}$/;
class PreflightError extends Error{constructor(code){super(code);this.name='PreflightError';this.code=code;}}
function fail(code){throw new PreflightError(code);}
function object(value,code){if(!value||typeof value!=='object'||Array.isArray(value))fail(code);return value;}
function rejectSecrets(value,path){
  if(!value||typeof value!=='object')return;
  for(const [key,child] of Object.entries(value)){
    if(SECRET_KEY.test(key))fail('SECRET_FIELD_PROHIBITED');
    rejectSecrets(child,(path||'evidence')+'.'+key);
  }
}
function sourceDigest(files){
  object(files,'EDGE_SOURCE_MISSING');
  const names=Object.keys(files).sort();if(!names.length)fail('EDGE_SOURCE_MISSING');
  const hash=crypto.createHash('sha256');
  for(const name of names){if(typeof files[name]!=='string')fail('EDGE_SOURCE_MALFORMED');hash.update(name);hash.update('\0');hash.update(files[name]);hash.update('\0');}
  return hash.digest('hex');
}
function verifyReleaseEvidence(evidence,options){
  object(evidence,'EVIDENCE_MALFORMED');object(options,'OPTIONS_MALFORMED');rejectSecrets(evidence);
  const environment=evidence.environment;if(typeof environment!=='string'||!environment)fail('ENVIRONMENT_REQUIRED');
  const expected=ENVIRONMENTS[environment];if(!expected)fail('ENVIRONMENT_UNKNOWN');
  for(const field of ['releaseSha','publishedSourceSha','repositorySourceSha'])if(!SHA.test(evidence[field]||''))fail(field.toUpperCase()+'_INVALID');
  if(evidence.publishedSourceSha!==evidence.releaseSha)fail('PUBLISHED_SOURCE_SHA_MISMATCH');
  if(evidence.repositorySourceSha!==evidence.releaseSha)fail('REPOSITORY_SOURCE_SHA_MISMATCH');
  const project=object(evidence.project,'PROJECT_EVIDENCE_REQUIRED');
  if(!project.ref)fail('PROJECT_REF_REQUIRED');if(!project.name)fail('PROJECT_NAME_REQUIRED');if(!project.status)fail('PROJECT_STATUS_REQUIRED');
  if(project.ref!==expected.ref)fail('PROJECT_REF_MISMATCH');if(project.name!==expected.name)fail('PROJECT_NAME_MISMATCH');if(project.status!=='ACTIVE_HEALTHY')fail('PROJECT_NOT_HEALTHY');
  if(!Array.isArray(evidence.migrations))fail('MIGRATION_EVIDENCE_MALFORMED');
  const migrations=new Set(evidence.migrations.map(row=>{if(!row||typeof row.name!=='string'||!row.name.trim())fail('MIGRATION_EVIDENCE_MALFORMED');return row.name;}));
  for(const name of REQUIRED_MIGRATIONS)if(!migrations.has(name))fail('REQUIRED_MIGRATION_MISSING');
  const edge=object(evidence.edge,'EDGE_FUNCTION_MISSING');
  if(edge.slug!=='platform-device-operation')fail('EDGE_SLUG_MISMATCH');if(edge.status!=='ACTIVE')fail('EDGE_NOT_ACTIVE');if(edge.verifyJwt!==true)fail('EDGE_VERIFY_JWT_REQUIRED');
  const deployedDigest=sourceDigest(edge.sourceFiles),repositoryDigest=sourceDigest(options.repositoryEdgeFiles);
  if(deployedDigest!==repositoryDigest)fail('EDGE_SOURCE_MISMATCH');
  const deployedSource=Object.values(edge.sourceFiles).join('\n');
  for(const operation of REQUIRED_EDGE_OPERATIONS)if(!new RegExp("['\"]"+operation+"['\"]").test(deployedSource))fail('EDGE_REQUIRED_OPERATION_MISSING');
  return Object.freeze({ok:true,environment:environment,releaseSha:evidence.releaseSha,edgeSourceSha256:deployedDigest});
}
module.exports={ENVIRONMENTS,REQUIRED_MIGRATIONS,REQUIRED_EDGE_OPERATIONS,PreflightError,sourceDigest,verifyReleaseEvidence};
