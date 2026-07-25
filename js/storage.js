// ═══════════════════════════════════════════════════════
// STORAGE & PERSISTENCE FUNCTIONS
// ═══════════════════════════════════════════════════════

function syncCurrentConferenceRefs(){
  var current = getCurrentConference();
  if(!current){
    return;
  }
  var conf = current.conf || {name: current.name || 'المؤتمر', startDate: current.startDate || '', endDate: current.endDate || '', days: current.days || 1};
  DAYS = conf.days || 1;
  updateLogoText();
}

function updateCurrentConferenceData(){
  var current = getCurrentConference();
  if(!current) return;
  var confObj = current.conf || {name: current.name || 'المؤتمر', startDate: current.startDate || '', endDate: current.endDate || '', days: current.days || 1};
  current.name = confObj.name || current.name || 'المؤتمر';
  current.startDate = confObj.startDate || current.startDate || '';
  current.endDate = confObj.endDate || current.endDate || '';
  current.days = confObj.days || current.days || 1;
  current.conf = {
    name: current.name,
    startDate: current.startDate,
    endDate: current.endDate,
    days: current.days,
    place: confObj.place || '',
    houseTemplateId: confObj.houseTemplateId || ''
  };
  // rooms, transports, restaurant are now directly part of the conference object.
  current.updatedAt = new Date().toISOString();
}

function save(){
  try{
    updateCurrentConferenceData();
    localStorage.setItem(SK,JSON.stringify(appData));
    var b=ge('syncBar');if(b){b.textContent='✔ '+new Date().toLocaleTimeString('ar-EG');}
  }catch(e){console.warn(e)}
}

function load(){
  try{
    var r=localStorage.getItem(SK);
    if(r){
      var d=JSON.parse(r);
      if(d.appData) appData = d.appData;
      else if(d.conferences) appData = d;
      else appData = buildAppDataFromLegacy(d);
      normalizeAppData();
      updateLogoText();
      var current = getCurrentConference();
      if(current) setCurrentConference(current);
    } else {
      normalizeAppData();
    }
  }catch(e){console.warn(e)}
}
