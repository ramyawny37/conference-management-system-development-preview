import { createClient } from '@supabase/supabase-js';

const ORIGIN='https://ramyawny37.github.io';
const encoder=new TextEncoder();
const cors={'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Origin':ORIGIN,'Vary':'Origin'};
function json(status:number,body:unknown){return new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});}
function required(name:string){const value=String(Deno.env.get(name)||'').trim();if(!value)throw new Error(`MISSING_${name}`);return value;}
function bytes(value:unknown){const text=String(value||'');if(!/^[A-Za-z0-9_-]+$/.test(text))throw new Error('SIGNATURE_FORMAT_INVALID');const normalized=text.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(normalized+'='.repeat((4-normalized.length%4)%4)),c=>c.charCodeAt(0));}
function hex(value:Uint8Array){return Array.from(value).map(item=>item.toString(16).padStart(2,'0')).join('');}
async function digest(value:string){return new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)));}
async function thumbprint(jwk:JsonWebKey){if(jwk.kty!=='EC'||jwk.crv!=='P-256'||!jwk.x||!jwk.y||jwk.d)throw new Error('PUBLIC_KEY_INVALID');return hex(await digest(JSON.stringify({crv:'P-256',kty:'EC',x:jwk.x,y:jwk.y})));}
function clean(value:unknown,max:number){return String(value||'').trim().slice(0,max);}

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(request.method!=='POST')return json(405,{ok:false,error:{code:'METHOD_NOT_ALLOWED'}});
  if(request.headers.get('Origin')!==ORIGIN)return json(403,{ok:false,error:{code:'DEVICE_ENROLLMENT_ORIGIN_DENIED'}});
  try{
    const authorization=request.headers.get('Authorization')||'';
    if(!/^Bearer\s+\S+$/.test(authorization))throw new Error('AUTH_REQUIRED');
    const userClient=createClient(required('SUPABASE_URL'),required('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
    const userResult=await userClient.auth.getUser();if(userResult.error||!userResult.data.user)throw new Error('AUTH_REQUIRED');
    const body=await request.json(),action=String(body&&body.action||'');
    const service=createClient(required('SUPABASE_URL'),required('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
    if(action==='status'){
      const bindingId=String(body.bindingId||'');if(!/^[0-9a-f-]{36}$/i.test(bindingId))throw new Error('BINDING_ID_INVALID');
      const result=await service.schema('platform').rpc('get_device_key_enrollment_status',{p_user_id:userResult.data.user.id,p_binding_id:bindingId});
      if(result.error)throw result.error;return json(200,{ok:true,data:result.data});
    }
    if(action!=='enroll')throw new Error('ACTION_NOT_SUPPORTED');
    const jwk=body.publicKeyJwk as JsonWebKey,computed=await thumbprint(jwk),claimed=String(body.publicKeyThumbprint||'');
    if(computed!==claimed)throw new Error('PUBLIC_KEY_THUMBPRINT_MISMATCH');
    const nonce=String(body.nonce||''),issuedAt=String(body.issuedAt||''),issued=Date.parse(issuedAt);
    if(!/^[A-Za-z0-9_-]{43}$/.test(nonce)||!Number.isFinite(issued)||Math.abs(Date.now()-issued)>120000)throw new Error('DEVICE_ENROLLMENT_CHALLENGE_INVALID');
    const payload=['PLATFORM_NATIVE_DEVICE_ENROLLMENT','v1',userResult.data.user.id,computed,nonce,issuedAt].join('\n');
    if(String(body.signingPayload||'')!==payload)throw new Error('DEVICE_ENROLLMENT_PAYLOAD_INVALID');
    const signature=bytes(body.signature);if(signature.length!==64)throw new Error('SIGNATURE_FORMAT_INVALID');
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,signature,encoder.encode(payload)))throw new Error('DEVICE_ENROLLMENT_SIGNATURE_INVALID');
    const secret=crypto.getRandomValues(new Uint8Array(32));
    const result=await service.schema('platform').rpc('enroll_new_device_key',{p_user_id:userResult.data.user.id,p_device_id:crypto.randomUUID(),p_device_secret_hash:hex(new Uint8Array(await crypto.subtle.digest('SHA-256',secret))),p_public_key_thumbprint:computed,p_public_key_jwk:jwk,p_nonce:nonce,p_display_name:clean(body.displayName,120),p_platform:clean(body.platform,120),p_browser:clean(body.browser,120)});
    if(result.error||!result.data)throw result.error||new Error('DEVICE_ENROLLMENT_FAILED');
    return json(200,{ok:true,data:result.data});
  }catch(error){const raw=String(error instanceof Error?error.message:'DEVICE_ENROLLMENT_DENIED'),code=/^[A-Z][A-Z0-9_]{0,95}$/.test(raw)?raw:'DEVICE_ENROLLMENT_DENIED';console.error(JSON.stringify({code,timestamp:new Date().toISOString()}));return json(code==='AUTH_REQUIRED'?401:403,{ok:false,error:{code}});}
});
