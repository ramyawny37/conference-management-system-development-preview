(function(global){
  'use strict';
  var document=global.document;
  function ensureStyles(){
    if(!document)return;
    if(!document.getElementById('reservationsModuleStylesheet')){
      var link=document.createElement('link');
      link.id='reservationsModuleStylesheet';
      link.rel='stylesheet';
      link.href='modules/reservations/reservations-module.css?rev=mountable-bundle-v6';
      document.head.appendChild(link);
    }
    if(!document.getElementById('reservationsReconciliationStyles')){
      var style=document.createElement('style');
      style.id='reservationsReconciliationStyles';
      style.textContent='.platform-reservations-active .platform-home{display:none}.platform-reservations-active .platform-module-switcher{display:flex}.platform-reservations-active #reservationsWorkspace{display:block}';
      document.head.appendChild(style);
    }
  }
  function ensureWorkspace(){
    if(!document)return null;
    var workspace=document.getElementById('reservationsWorkspace');
    if(workspace)return workspace;
    workspace=document.createElement('div');
    workspace.id='reservationsWorkspace';
    workspace.className='conference-workspace';
    workspace.tabIndex=-1;
    var warehouse=document.getElementById('warehouseWorkspace');
    if(warehouse&&warehouse.parentNode)warehouse.parentNode.insertBefore(workspace,warehouse.nextSibling);
    return workspace;
  }
  function enableCard(){
    if(!document)return;
    var card=document.querySelector('[data-platform-module="reservations"]');
    if(!card)return;
    card.disabled=false;
    card.removeAttribute('aria-disabled');
    card.setAttribute('aria-label','فتح وحدة الحجوزات');
    card.classList.remove('platform-module-card-unavailable');
    card.classList.add('platform-module-card-available');
    var state=card.querySelector('.platform-module-state');
    if(state){state.textContent='متاحة';state.classList.add('platform-module-state-available');}
  }
  function reconcileWhenReady(){
    var attempts=0;
    function run(){
      attempts+=1;
      var integration=global.PlatformIntegration;
      if(integration&&typeof integration.reconcileRoute==='function'){
        var result=integration.reconcileRoute();
        if(result!==false)return;
      }
      if(attempts<12)global.setTimeout(run,Math.min(1000,attempts*100));
    }
    global.setTimeout(run,0);
  }
  function handleClick(event){
    var target=event&&event.target;
    if(!target||!target.closest)return;
    if(target.closest('.platform-module-switcher')){
      var shell=document.getElementById('startupScreen');
      if(shell)shell.classList.remove('platform-reservations-active');
    }
  }
  ensureStyles();
  ensureWorkspace();
  enableCard();
  if(document)document.addEventListener('click',handleClick);
  if(document&&document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){ensureWorkspace();enableCard();reconcileWhenReady();});
  else reconcileWhenReady();
})(window);
