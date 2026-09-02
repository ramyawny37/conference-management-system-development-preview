(function(global){
  'use strict';
  var status=global.document.getElementById('device-session-status');
  var button=global.document.getElementById('device-session-start');
  function show(value){status.textContent=String(value||'');}
  function code(error){return String(error&&error.code||error&&error.message||'DEVICE_SESSION_DENIED').slice(0,120);}
  function run(){button.disabled=true;show('Proving possession of the existing bound key…');return global.PlatformDeviceSession.establish().then(function(result){return result.replay().then(function(replay){if(!replay.rejected)throw new Error('REPLAY_ACCEPTED');show('Supabase device session established and verified; establishment replay was rejected.');});}).catch(function(error){show('Device session stopped: '+code(error));button.disabled=false;});}
  function initialize(){if(!global.crypto||!global.crypto.subtle||!global.indexedDB){show('Required browser cryptography or protected key storage is unavailable.');return;}return global.SupabaseAuth.initialize().then(function(auth){if(!auth||!auth.authenticated)throw new Error('AUTH_REQUIRED');button.disabled=false;show('Ready to establish one short-lived Supabase device session.');}).catch(function(error){show('Device session unavailable: '+code(error));});}
  button.addEventListener('click',run);initialize();
})(window);
