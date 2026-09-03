'use strict';

const fs=require('node:fs');
const path=require('node:path');

const DEV_REF='gppwltrifgfxrkzvvxoe';
const DEV_NAME='conference-management-system-development';
const BLOCKED_REFS=['mpezfbvcdfxpgflehuot','zentpxnyccbkzgrkkkms'];

function fail(message){throw new Error(message);}

async function main(){
  const root=path.resolve(__dirname,'..');
  const temp=path.join(root,'supabase','.temp');
  const ref=fs.readFileSync(path.join(temp,'project-ref'),'utf8').trim();
  const linked=JSON.parse(fs.readFileSync(path.join(temp,'linked-project.json'),'utf8'));
  const poolText=fs.readFileSync(path.join(temp,'pooler-url'),'utf8').trim();
  const pool=new URL(poolText);
  const identity=[ref,linked.ref,linked.name,poolText].join('|');
  if(BLOCKED_REFS.some(function(value){return identity.includes(value);})){
    fail('Production/Staging target rejected');
  }
  if(ref!==DEV_REF||linked.ref!==DEV_REF||linked.name!==DEV_NAME||
    decodeURIComponent(pool.username)!=='postgres.'+DEV_REF||
    pool.pathname!=='/postgres'||pool.password){
    fail('Development identity mismatch');
  }
  const password=process.env.SUPABASE_DB_PASSWORD_DEV;
  if(!password)fail('SUPABASE_DB_PASSWORD_DEV is unavailable');
  const modules=process.env.CMS_MIGRATION_RUNNER_MODULES;
  if(!modules||!path.isAbsolute(modules)){
    fail('CMS_MIGRATION_RUNNER_MODULES must be absolute');
  }
  const {Client}=require(path.join(modules,'pg'));
  console.log('Development identity gate: PASS');
  const client=new Client({host:pool.hostname,port:Number(pool.port||5432),
    database:'postgres',user:decodeURIComponent(pool.username),password:password,
    ssl:{rejectUnauthorized:false},
    application_name:'cms-development-template-realtime-verification'});
  try{
    await client.connect();
    const response=await client.query(`select current_database() database,
      current_user db_user,
      to_regclass('public.organization_templates') is not null table_exists,
      exists(select 1 from pg_publication_tables
        where pubname='supabase_realtime' and schemaname='public'
          and tablename='organization_templates') publication_member`);
    const state=response.rows[0];
    if(state.database!=='postgres'||state.db_user!=='postgres'){
      fail('Database runtime identity mismatch');
    }
    console.log(JSON.stringify(state));
  }finally{
    await client.end().catch(function(){});
  }
}

main().catch(function(error){
  console.error(String(error&&error.message||error)
    .replace(/postgres(?:ql)?:\/\/\S+/gi,'[REDACTED_DATABASE_URL]'));
  process.exitCode=1;
});
