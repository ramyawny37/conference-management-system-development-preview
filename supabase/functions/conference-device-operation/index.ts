import { createClient } from '@supabase/supabase-js';
const ORIGIN='https://ramyawny37.github.io';
const cors={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
const allowed=new Set([
  'create_canonical_conference','mutate_conference_core','get_conference_core','list_conference_participations','create_conference_participation','set_conference_participation_status','set_conference_participation_guardian','delete_conference_participation','list_conference_houses','mutate_conference_house_directory','assign_conference_house','list_conference_house_room_options','assign_conference_room','get_conference_accommodation','assign_conference_accommodation','move_conference_accommodation','remove_conference_accommodation',
  'acquire_conference_lock','renew_conference_lock','release_conference_lock','get_conference_lock','acquire_conference_section_lock','renew_conference_section_lock','release_conference_section_lock','get_conference_section_lock'
]);
allowed.add('list_accessible_conferences');
allowed.add('create_conference_participation_with_person');
allowed.add('get_conference_transport');
allowed.add('mutate_conference_transport_vehicle');
allowed.add('set_conference_transport_assignment');
allowed.add('remove_conference_transport_assignment');
allowed.add('get_conference_restaurant');
allowed.add('mutate_conference_restaurant');
allowed.add('mutate_conference_accommodation_pricing');
allowed.add('get_conference_air_conditioning');
allowed.add('mutate_conference_air_conditioning');
allowed.add('get_conference_finance');
allowed.add('mutate_conference_finance');
allowed.add('get_conference_branding');
allowed.add('mutate_conference_branding');
allowed.add('list_conference_activity');
allowed.add('record_conference_output_event');
function required(name:string){const value=String(Deno.env.get(name)||'');if(!value)throw new Error(`MISSING_${name}`);return value;}
function response(status:number,body:unknown){return new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});}
function bytes(value:unknown){const text=String(value||'');if(!/^[A-Za-z0-9_-]{43}$/.test(text))throw new Error('DEVICE_SESSION_TOKEN_INVALID');const normalized=text.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(normalized+'='.repeat((4-normalized.length%4)%4)),c=>c.charCodeAt(0));}
function bytea(value:Uint8Array){return `\\x${Array.from(value).map(x=>x.toString(16).padStart(2,'0')).join('')}`;}
Deno.serve(async request=>{if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});if(request.method!=='POST'||request.headers.get('Origin')!==ORIGIN)return response(403,{ok:false,error:{code:'ORIGIN_DENIED'}});try{const authorization=request.headers.get('Authorization')||'';if(!/^Bearer\s+\S+$/.test(authorization))throw new Error('AUTH_REQUIRED');const authClient=createClient(required('SUPABASE_URL'),required('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});const userResult=await authClient.auth.getUser();if(userResult.error||!userResult.data.user)throw new Error('AUTH_REQUIRED');const text=await request.text();if(text.length>8*1024*1024)throw new Error('PAYLOAD_TOO_LARGE');const body=JSON.parse(text),operation=String(body.operation||''),args=body.args;if(!allowed.has(operation))throw new Error('CONFERENCE_OPERATION_NOT_ALLOWED');if(!args||typeof args!=='object'||Array.isArray(args)||Object.hasOwn(args,'p_actor_device_id')||(Object.hasOwn(args,'p_device_id')&&operation!=='approve_pending_device_authorization'))throw new Error('CONFERENCE_OPERATION_ARGUMENTS_INVALID');const token=bytes(body.token);const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',token));const service=createClient(required('SUPABASE_URL'),required('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false}});const result=await service.schema('platform').rpc('execute_conference_device_operation',{p_user_id:userResult.data.user.id,p_session_id:String(body.sessionId||''),p_token_hash:bytea(hash),p_operation:operation,p_args:args});if(result.error)throw result.error;return response(200,{ok:true,data:result.data});}catch(error){const message=String((error as {message?:unknown})?.message||'CONFERENCE_DEVICE_OPERATION_DENIED');const safe=/^[A-Z][A-Z0-9_]{1,95}$/.test(message)?message:'CONFERENCE_DEVICE_OPERATION_DENIED';console.error(JSON.stringify({code:safe,stage:'conference-device-operation',timestamp:new Date().toISOString()}));return response(safe==='AUTH_REQUIRED'?401:403,{ok:false,error:{code:safe}});}});
