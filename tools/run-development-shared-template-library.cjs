'use strict';
const fs=require('node:fs'),path=require('node:path');
const DEV_REF='gppwltrifgfxrkzvvxoe';
const DEV_NAME='conference-management-system-development';
const BLOCKED=['mpezfbvcdfxp'+'gflehuot','zentpxnyccbk'+'zgrkkkms'];
function fail(message){throw new Error(message);}
function read(file){return fs.readFileSync(file,'utf8').trim();}
async function main(){
  const root=path.resolve(__dirname,'..'),temp=path.join(root,'supabase','.temp');
  const ref=read(path.join(temp,'project-ref'));
  const linked=JSON.parse(read(path.join(temp,'linked-project.json')));
  const poolText=read(path.join(temp,'pooler-url')),pool=new URL(poolText);
  const identity=[ref,linked.ref,linked.name,poolText].join('|');
  if(BLOCKED.some(value=>identity.includes(value)))fail('Production/Staging target rejected');
  if(ref!==DEV_REF||linked.ref!==DEV_REF||linked.name!==DEV_NAME||decodeURIComponent(pool.username)!==`postgres.${DEV_REF}`||pool.pathname!=='/postgres'||pool.password)fail('Development identity mismatch');
  const password=process.env.SUPABASE_DB_PASSWORD_DEV;
  const modules=process.env.CMS_MIGRATION_RUNNER_MODULES;
  if(!password||!modules||!path.isAbsolute(modules))fail('Development credentials/modules unavailable');
  const {Client}=require(path.join(modules,'pg'));
  const client=new Client({host:pool.hostname,port:Number(pool.port||5432),database:'postgres',user:decodeURIComponent(pool.username),password,ssl:{rejectUnauthorized:false},application_name:'cms-development-shared-template-library'});
  await client.connect();
  try{
    const preflight=(await client.query(`select current_database() database,current_user db_user,
      (select count(*)::int from public.organization_templates) legacy_rows,
      (select count(*)::int from (select template_type,template_id from public.organization_templates group by 1,2 having count(distinct md5(coalesce(payload::text,'null')||'|'||(deleted_at is not null)::text))>1) conflicting_templates) conflicts,
      to_regclass('public.library_templates')::text library_table`)).rows[0];
    if(preflight.database!=='postgres'||preflight.db_user!=='postgres')fail('Runtime database identity mismatch');
    if(preflight.conflicts)fail('Legacy identity/content conflict detected');
    console.log('Development identity/preflight: PASS '+JSON.stringify(preflight));
    if(!process.argv.includes('--apply')&&!preflight.library_table)return;
    if(process.argv.includes('--apply')){
      if(preflight.library_table)fail('Shared template migration already present');
      const sql=fs.readFileSync(path.join(root,'supabase','migrations','20260813_6_9_0_shared_template_library.sql'),'utf8');
      await client.query(sql);
      console.log('Migration apply: PASS');
    }
    const verification=(await client.query(`select
      to_regclass('public.library_templates')::text library_table,
      to_regclass('public.organization_template_access')::text access_table,
      to_regclass('public.organization_template_events')::text events_table,
      to_regprocedure('public.list_shared_organization_templates(uuid)')::text list_rpc,
      to_regprocedure('public.apply_library_template_content_operation(uuid,uuid,text,text,text,bigint,jsonb)')::text content_rpc,
      to_regprocedure('public.apply_organization_template_access_operation(uuid,uuid,text,text,uuid,text)')::text access_rpc,
      exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='organization_template_events') realtime,
      (select bool_and(relrowsecurity) from pg_class where oid in ('public.library_templates'::regclass,'public.organization_template_access'::regclass,'public.organization_template_events'::regclass)) rls_enabled,
      not has_table_privilege('authenticated','public.library_templates','select,insert,update,delete') content_direct_access_denied,
      not has_table_privilege('authenticated','public.organization_template_access','select,insert,update,delete') association_direct_access_denied,
      has_table_privilege('authenticated','public.organization_template_events','select') event_select_allowed,
      not exists(select 1 from information_schema.columns where table_schema='public' and table_name='organization_template_events' and column_name='payload') event_payload_absent,
      (select count(*)::int from public.library_templates) template_count,
      (select count(*)::int from public.organization_template_access where revoked_at is null) active_access_count`)).rows[0];
    console.log('Runtime verification: '+JSON.stringify(verification));
  }finally{await client.end().catch(()=>{});}
}
main().catch(error=>{console.error(String(error&&error.message||error).replace(/postgres(?:ql)?:\/\/\S+/gi,'[REDACTED_DATABASE_URL]'));process.exitCode=1;});
