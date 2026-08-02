(function(global){
  'use strict';
  // P0.3C staged only. This timer does not create a realtime channel; P0.3E may
  // compose it into active runtime after the guarded surface is activated.
  function create(reads,intervalMs){
    var timer=null;
    function stop(){if(timer!==null){global.clearInterval(timer);timer=null;}}
    function start(conferenceId,onResult){
      stop();
      function refresh(){return reads.snapshotMetadata(conferenceId).then(onResult);}
      timer=global.setInterval(refresh,Math.max(5000,Number(intervalMs)||15000));
      return refresh();
    }
    return Object.freeze({start:start,stop:stop});
  }
  global.P03CStagedRealtimePolling=Object.freeze({create:create});
})(window);
