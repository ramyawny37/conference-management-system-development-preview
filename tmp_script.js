
// ═══════════════════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════════════════
var conf = {
  name: 'المؤتمر',
  startDate: '',  // YYYY-MM-DD
  endDate: '',
  days: 1
};
var rooms = [
  {id:'r1',number:'101',floor:1,capacity:2,guests:[{id:'g1',name:'أحمد محمد علي',leftDay:null},{id:'g2',name:'خالد إبراهيم السيد',leftDay:null}],children:[],closed:false},
  {id:'r2',number:'102',floor:1,capacity:2,guests:[{id:'g3',name:'سارة عبدالله محمود',leftDay:null},{id:'g4',name:'نورا حسن الشريف',leftDay:null}],children:[{id:'c1',name:'لين سارة',guardian:'سارة عبدالله محمود',leftDay:null}],closed:false},
  {id:'r3',number:'201',floor:2,capacity:2,guests:[{id:'g5',name:'فاطمة سعيد الغامدي',leftDay:null},{id:'g6',name:'منى علي الزهراني',leftDay:null}],children:[],closed:false},
];
var transports = [];
var restaurant = {
  meals: {
    breakfast: {price:0, childPrice:0, enabled:true},
    lunch:     {price:0, childPrice:0, enabled:true},
    dinner:    {price:0, childPrice:0, enabled:true}
  }
};

var appData = {
  version: '2.0.0',
  currentConferenceId: null,
  conferences: [],
  templates: [],
  archives: [],
  backups: []
};

function createDefaultRestaurant(){
  return {
    meals: {
      breakfast: {price:0, childPrice:0, enabled:true},
      lunch:     {price:0, childPrice:0, enabled:true},
      dinner:    {price:0, childPrice:0, enabled:true}
    }
  };
}

function createDefaultConferenceData(){
  var now = new Date().toISOString();
  return {
    id: uid(),
    name: conf.name || 'المؤتمر',
    startDate: conf.startDate || '',
    endDate: conf.endDate || '',
    days: conf.days || 1,
    conf: {name: conf.name || 'المؤتمر', startDate: conf.startDate || '', endDate: conf.endDate || '', days: conf.days || 1},
    rooms: deepClone(rooms || []),
    transports: deepClone(transports || []),
    restaurant: deepClone(restaurant || createDefaultRestaurant()),
    createdAt: now,
    updatedAt: now
  };
}

function syncCurrentConferenceRefs(){
  var current = getCurrentConference();
  if(!current){
    conf = null;
    rooms = [];
    transports = [];
    restaurant = createDefaultRestaurant();
    return;
  }
  conf = current.conf || {name: current.name || 'المؤتمر', startDate: current.startDate || '', endDate: current.endDate || '', days: current.days || 1};
  rooms = current.rooms || [];
  transports = current.transports || [];
  restaurant = current.restaurant || createDefaultRestaurant();
}

// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════
var currentTab=0,editRoomId=null,editTransId=null,editSeatTransId=null,editSeatNum=null;
var cardMode='person',selectedCards={};
var currentHouseId=null;
var SK='conf_v5';
var DAYS=conf.days||1;

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════
function uuid(){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0,v=c==='x'?r:(r&0x3|0x8);return v.toString(16);});}
function uid(){return uuid();}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function ge(id){return document.getElementById(id)}
function showToast(msg,c){var t=ge('toast');t.textContent=msg;t.style.background=c||'#27AE60';t.style.display='block';setTimeout(function(){t.style.display='none'},2500)}
function gn(g){return typeof g==='string'?g:(g&&g.name||'')}
function gl(g,day){
  if(typeof g==='string')return false;
  if(!g.leftDay)return false;
  if(day===undefined)return true;
  return g.leftDay<=day;
}
function ensureGuestIds(item){
  if(!item) return;
  if(Array.isArray(item.guests)) item.guests.forEach(function(g){if(!g.id)g.id=uuid();if(g.leftDay===undefined)g.leftDay=null;});
  if(Array.isArray(item.children)) item.children.forEach(function(c){if(!c.id)c.id=uuid();if(c.leftDay===undefined)c.leftDay=null;if(!c.guardian)c.guardian=c.guardian||'';});
}
function normalizeConference(confObj){
  if(!confObj) return;
  confObj.conf = confObj.conf || {name:confObj.name||'المؤتمر',startDate:confObj.startDate||'',endDate:confObj.endDate||'',days:confObj.days||1};
  confObj.rooms = confObj.rooms || [];
  confObj.houses = confObj.houses || [];
  confObj.transports = confObj.transports || [];
  confObj.restaurant = confObj.restaurant || createDefaultRestaurant();
  if(!confObj.houses.length){
    var defaultHouseId = uid();
    confObj.houses.push({id:defaultHouseId,name:'البيت الافتراضي',description:'بيت تم تحويله من البيانات القديمة'});
  }
  confObj.houses.forEach(function(h){
    if(!h.id) h.id = uid();
    h.name = h.name || 'بيت '+h.id.slice(0,4);
    h.description = h.description || '';
  });
  var defaultHouse = confObj.houses[0].id;
  confObj.rooms.forEach(function(r){
    if(!r.id) r.id=uid();
    r.name = r.name || r.number || 'غرفة '+r.id.slice(0,4);
    if(!r.houseId || !confObj.houses.find(function(h){return h.id===r.houseId;})) r.houseId = defaultHouse;
    if(!r.number) r.number = r.name;
    r.guests = (r.guests||[]).map(function(g){
      if(typeof g==='string') return {id:uuid(),name:g,leftDay:null};
      return {id:g.id||uuid(),name:g.name||'',leftDay:g.leftDay||null};
    });
    r.children = (r.children||[]).map(function(c){
      if(typeof c==='string') return {id:uuid(),name:c,guardian:'',leftDay:null};
      return {id:c.id||uuid(),name:c.name||'',guardian:c.guardian||'',leftDay:c.leftDay||null};
    });
    r.closed = !!r.closed;
    if(!r.capacity || r.capacity<1) r.capacity = Math.max(r.guests.length + r.children.length, 1);
  });
  confObj.currentHouseId = confObj.currentHouseId || (confObj.rooms[0] && confObj.rooms[0].houseId) || defaultHouse;
  confObj.transports.forEach(function(t){
    if(!t.id) t.id=uid();
    t.capacity = t.capacity|| (t.seats ? t.seats.length : 0);
    if(!Array.isArray(t.seats)){
      t.seats=[];
      for(var i=1;i<=t.capacity;i++) t.seats.push({seat:i,name:'',room:'',type:'adult',note:''});
    } else {
      t.seats.forEach(function(s){ s.type = s.type || 'adult'; s.room = s.room || ''; s.note = s.note || ''; s.name = s.name || ''; });
    }
  });
  ensureGuestIds(confObj);
}
function normalizeAppData(){
  appData.version = appData.version || '2.0.0';
  appData.conferences = appData.conferences || [];
  appData.templates = appData.templates || [];
  appData.archives = appData.archives || [];
  appData.backups = appData.backups || [];
  if(!appData.conferences.length){
    var seededConference = createDefaultConferenceData();
    normalizeConference(seededConference);
    appData.conferences.push(seededConference);
  }
  appData.conferences.forEach(function(confObj){
    normalizeConference(confObj);
    if(!confObj.currentHouseId || !confObj.houses.find(function(h){return h.id===confObj.currentHouseId;})){
      confObj.currentHouseId = (confObj.houses[0] && confObj.houses[0].id) || null;
    }
  });
  if(!appData.currentConferenceId || !appData.conferences.find(function(c){return c.id===appData.currentConferenceId;})){
      appData.currentConferenceId = appData.conferences[0].id;
  }
  syncCurrentConferenceRefs();
}
function getCurrentConference(){
  if(!appData.conferences||!appData.conferences.length) return null;
  var cid = appData.currentConferenceId || appData.conferences[0].id;
  var current = appData.conferences.find(function(c){return c.id===cid});
  if(!current){ current = appData.conferences[0]; appData.currentConferenceId=current.id; }
  return current;
}
function getCurrentHouse(){
  var current = getCurrentConference();
  if(!current) return null;
  var hid = current.currentHouseId || (current.houses[0] && current.houses[0].id);
  var house = current.houses.find(function(h){return h.id===hid});
  if(!house){ house = current.houses[0]; if(house) current.currentHouseId = house.id; }
  currentHouseId = house ? house.id : null;
  return house;
}
function houseOptions(selectedId){
  var current = getCurrentConference();
  if(!current) return '<option value="">— لا يوجد بيوت —</option>';
  var opts = '<option value="">الكل</option>';
  current.houses.forEach(function(h){
    opts += '<option value="'+h.id+'"'+(h.id===selectedId?' selected':'')+'>'+esc(h.name)+'</option>';
  });
  return opts;
}
function setCurrentHouseById(id){
  var current = getCurrentConference();
  if(!current) return;
  if(id && current.houses.find(function(h){return h.id===id;})){
    current.currentHouseId = id;
    currentHouseId = id;
  } else {
    current.currentHouseId = null;
    currentHouseId = null;
  }
  save();
  renderRooms();
  renderSettings();
}
function openHouseModal(id){
  editHouseId = id;
  if(id){
    var current = getCurrentConference();
    var h = current.houses.find(function(x){return x.id===id});
    if(!h) return;
    ge('houseTitle').textContent = '✏️ تعديل البيت';
    ge('house_name').value = h.name;
    ge('house_desc').value = h.description || '';
    ge('delHouseBtn').style.display = 'block';
  } else {
    ge('houseTitle').textContent = '➕ بيت جديد';
    ge('house_name').value = '';
    ge('house_desc').value = '';
    ge('delHouseBtn').style.display = 'none';
  }
  ge('houseModal').style.display = 'flex';
}
function closeHouseModal(){ge('houseModal').style.display='none';}
function saveHouse(){
  var current = getCurrentConference(); if(!current) return;
  var name = ge('house_name').value.trim();
  if(!name){alert('أدخل اسم البيت');return;}
  var desc = ge('house_desc').value.trim();
  if(editHouseId){
    var h = current.houses.find(function(x){return x.id===editHouseId});
    if(!h) return;
    h.name = name; h.description = desc;
    showToast('✅ تم تعديل البيت');
  } else {
    current.houses.push({id:uid(),name:name,description:desc});
    showToast('✅ أُضيف البيت');
  }
  closeHouseModal();
  save();
  renderRooms();
  renderSettings();
}
function deleteHouse(){
  var current = getCurrentConference(); if(!current) return;
  if(!editHouseId) return;
  if(current.houses.length<=1){alert('يجب أن يبقى بيت واحد على الأقل');return;}
  var h = current.houses.find(function(x){return x.id===editHouseId});
  if(!h) return;
  if(!confirm('حذف البيت "'+h.name+'" سيعيد جميع غرفه إلى البيت الأول. متابعة؟')) return;
  var target = current.houses.find(function(x){return x.id!==editHouseId;});
  current.rooms.forEach(function(r){ if(r.houseId===editHouseId) r.houseId = target.id; });
  current.houses = current.houses.filter(function(x){return x.id!==editHouseId;});
  if(current.currentHouseId===editHouseId) current.currentHouseId = target.id;
  currentHouseId = current.currentHouseId;
  closeHouseModal();
  save();
  renderRooms();
  renderSettings();
}
var editHouseId = null;
function setCurrentConference(confObj){
  if(!confObj) return;
  normalizeConference(confObj);
  appData.currentConferenceId = confObj.id;
  conf = confObj.conf || conf || {name:'المؤتمر',startDate:'',endDate:'',days:1};
  rooms = confObj.rooms || [];
  transports = confObj.transports || [];
  restaurant = confObj.restaurant || createDefaultRestaurant();
  syncCurrentConferenceRefs();
  var house = getCurrentHouse();
  if(confObj.currentHouseId && confObj.houses && confObj.houses.find(function(h){return h.id===confObj.currentHouseId;})){
    currentHouseId = confObj.currentHouseId;
  } else if(confObj.houses && confObj.houses[0]){
    currentHouseId = confObj.houses[0].id;
  } else {
    currentHouseId = null;
  }
  DAYS = conf.days || 1;
}
function updateCurrentConferenceData(){
  var current = getCurrentConference();
  if(!current) return;
  if(!conf || typeof conf !== 'object'){
    conf = current.conf || {name: current.name || 'المؤتمر', startDate: current.startDate || '', endDate: current.endDate || '', days: current.days || 1};
  }
  current.name = conf.name || current.name || 'المؤتمر';
  current.startDate = conf.startDate || current.startDate || '';
  current.endDate = conf.endDate || current.endDate || '';
  current.days = conf.days || current.days || 1;
  current.conf = {name: conf.name || current.name || 'المؤتمر', startDate: conf.startDate || current.startDate || '', endDate: conf.endDate || current.endDate || '', days: conf.days || current.days || 1};
  conf = current.conf;
  current.rooms = deepClone(rooms || []);
  current.transports = deepClone(transports || []);
  current.restaurant = deepClone(restaurant || createDefaultRestaurant());
  current.currentHouseId = currentHouseId || current.currentHouseId || (current.houses[0] && current.houses[0].id);
  current.updatedAt = new Date().toISOString();
  syncCurrentConferenceRefs();
}
function deepClone(obj){
  return JSON.parse(JSON.stringify(obj));
}
function createNewConference(){
  var now = new Date().toISOString();
  var newConf = {
    id:uid(),
    name:'مؤتمر جديد',
    startDate:'',
    endDate:'',
    days:1,
    conf:{name:'مؤتمر جديد',startDate:'',endDate:'',days:1},
    rooms:[],
    transports:[],
    restaurant:{meals:{breakfast:{price:0,childPrice:0,enabled:true},lunch:{price:0,childPrice:0,enabled:true},dinner:{price:0,childPrice:0,enabled:true}}},
    createdAt:now,
    updatedAt:now
  };
  normalizeConference(newConf);
  appData.conferences.push(newConf);
  setCurrentConference(newConf);
  save();
  renderSettings();
  renderTab(currentTab);
  showToast('✅ أُضيف مؤتمر جديد');
}
function saveTemplate(){
  var name = prompt('أدخل اسم القالب:','قالب '+new Date().toISOString().slice(0,10));
  if(!name) return;
  updateCurrentConferenceData();
  appData.templates.push({id:uid(),name:name,createdAt:new Date().toISOString(),data:deepClone(getCurrentConference())});
  save();
  renderSettings();
  showToast('✅ تم حفظ القالب');
}
function applyTemplate(id){
  var template = appData.templates.find(function(t){return t.id===id});
  if(!template) return;
  var newConf = deepClone(template.data);
  newConf.id = uid();
  newConf.name = template.name + ' (من قالب)';
  newConf.createdAt = new Date().toISOString();
  newConf.updatedAt = newConf.createdAt;
  appData.conferences.push(newConf);
  normalizeConference(newConf);
  setCurrentConference(newConf);
  save();
  renderSettings();
  renderTab(currentTab);
  showToast('✅ تم إنشاء مؤتمر من القالب');
}
function archiveCurrentConference(){
  updateCurrentConferenceData();
  var current = getCurrentConference();
  if(!current) return;
  appData.archives.push({id:uid(),name:current.name,archivedAt:new Date().toISOString(),data:deepClone(current)});
  save();
  renderSettings();
  showToast('✅ أُرشف المؤتمر');
}
function backupAppData(){
  updateCurrentConferenceData();
  appData.backups.push({id:uid(),name:'نسخة احتياطية '+new Date().toISOString().slice(0,10)+' '+new Date().toISOString().slice(11,19),createdAt:new Date().toISOString(),data:deepClone(appData)});
  save();
  renderSettings();
  showToast('✅ تم إنشاء نسخة احتياطية');
}
function restoreBackup(id){
  var backup = appData.backups.find(function(b){return b.id===id});
  if(!backup) return;
  if(!confirm('استعادة النسخة الاحتياطية ستستبدل البيانات الحالية. متابعة؟')) return;
  appData = deepClone(backup.data);
  normalizeAppData();
  var current = getCurrentConference();
  if(current) setCurrentConference(current);
  save();
  renderSettings();
  renderTab(currentTab);
  showToast('✅ تم استعادة النسخة الاحتياطية');
}
function restoreArchive(id){
  var archive = appData.archives.find(function(a){return a.id===id});
  if(!archive) return;
  if(!confirm('استعادة الأرشيف ستنشئ نسخة جديدة من المؤتمر. متابعة؟')) return;
  var restored = deepClone(archive.data);
  restored.id = uid();
  restored.name = restored.name + ' (مستعاد)';
  restored.createdAt = new Date().toISOString();
  restored.updatedAt = restored.createdAt;
  appData.conferences.push(restored);
  normalizeConference(restored);
  setCurrentConference(restored);
  save();
  renderSettings();
  renderTab(currentTab);
  showToast('✅ تم استعادة مؤتمر من الأرشيف');
}
function setCurrentConferenceById(id){
  var next = appData.conferences.find(function(c){return c.id===id});
  if(!next) return;
  setCurrentConference(next);
  save();
  renderSettings();
  renderTab(currentTab);
  showToast('✅ تم تبديل المؤتمر');
}

function activeGuests(day){ // day=undefined means current/total
  var adults=[],children=[];
  rooms.filter(function(r){return !r.closed}).forEach(function(r){
    r.guests.forEach(function(g){if(!gl(g,day))adults.push({name:gn(g),room:r.number,rid:r.id})});
    r.children.forEach(function(c){if(!gl(c,day))children.push({name:c.name,room:r.number,rid:r.id,guardian:c.guardian})});
  });
  return {adults:adults,children:children};
}

function assignedNames(){
  var n={};
  transports.forEach(function(t){
    t.seats.forEach(function(s){if(s.name&&s.type!=='child_shared'&&s.type!=='infant')n[s.name]=true});
  });
  return n;
}
function unassigned(curName){
  var assigned=assignedNames();
  var ag=activeGuests();
  return ag.adults.concat(ag.children).filter(function(g){return !assigned[g.name]||g.name===curName});
}

function getDays(){return parseInt(conf.days)||1}

// ═══════════════════════════════════════════════════════
// PERSIST
// ═══════════════════════════════════════════════════════
function save(){
  try{
    syncCurrentConferenceRefs();
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
      var current = getCurrentConference();
      if(current) setCurrentConference(current);
    } else {
      // If no data in localStorage, initialize with default data
      normalizeAppData();
    }
  }catch(e){console.warn(e)}
}
function saveToFile(){
  syncCurrentConferenceRefs();
  updateCurrentConferenceData();
  var data=JSON.stringify({appData:appData},null,2);
  var orig=document.documentElement.outerHTML;
  var upd=orig.replace(/\/\/__S__[\s\S]*?\/\/__E__/, '\/\/__S__\nvar _d='+data+';\nappData=_d.appData;setCurrentConference(getCurrentConference());\n\/\/__E__');
  var a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([upd],{type:'text/html;charset=utf-8'}));
  a.download='المؤتمر_'+new Date().toISOString().slice(0,10)+'.html';
  a.click();showToast('✅ تم حفظ الملف');
}
function exportJsonFile(){
  updateCurrentConferenceData();
  var data=JSON.stringify(appData,null,2);
  var a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([data],{type:'application/json;charset=utf-8'}));
  a.download='conference_'+new Date().toISOString().slice(0,10)+'.json';
  a.click();showToast('✅ تم تصدير JSON');
}
function createConferenceFromObject(data, name){
  var confObj = {
    id: data.id || uid(),
    name: name || (data.conf && data.conf.name) || 'المؤتمر',
    startDate: (data.conf && data.conf.startDate) || '',
    endDate: (data.conf && data.conf.endDate) || '',
    days: (data.conf && data.conf.days) || 1,
    conf: data.conf || {name:name||'المؤتمر',startDate:'',endDate:'',days:1},
    rooms: data.rooms || [],
    transports: data.transports || [],
    restaurant: data.restaurant || createDefaultRestaurant(),
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: data.updatedAt || new Date().toISOString()
  };
  normalizeConference(confObj);
  return confObj;
}
function buildAppDataFromLegacy(raw){
  var legacy = {
    conf: raw.conf || raw,
    rooms: raw.rooms || [],
    transports: raw.transports || [],
    restaurant: raw.restaurant || createDefaultRestaurant()
  };
  return {
    version: '2.0.0',
    currentConferenceId: null,
    conferences: [createConferenceFromObject(legacy)],
    templates: [],
    archives: [],
    backups: []
  };
}
function loadFromFile(e){
  var f=e.target.files[0];if(!f)return;
  var r=new FileReader();
  r.onload=function(ev){
    var text=ev.target.result;
    var loaded=false;
    var rawData=null;

    if(f.name.toLowerCase().endsWith('.json')){
      try{rawData=JSON.parse(text);loaded=true;}catch(er){loaded=false;}
    }

    if(!loaded){
      var m1=text.match(/\/\/__S__\nvar _d=([\s\S]*?);\n(appData|conf)=/);
      if(m1){try{rawData=JSON.parse(m1[1]);loaded=true;}catch(er){loaded=false;}}
    }

    if(!loaded){
      var m2=text.match(/\/\/__SEED_START__\nvar _s=([\s\S]*?);\nrooms=/);
      if(m2){try{var d=JSON.parse(m2[1]);rawData={conf:d.conf||{name:'المؤتمر',startDate:'',endDate:'',days:1},rooms:d.rooms||[],transports:d.transports||d.extraTransports||[],restaurant:d.restaurant||{meals:{breakfast:{price:0,childPrice:0,enabled:true},lunch:{price:0,childPrice:0,enabled:true},dinner:{price:0,childPrice:0,enabled:true}}}};loaded=true;}catch(er){loaded=false;}}
    }

    if(!loaded){
      var m3=text.match(/\/ __DATA_SEED_START__\nvar _s=([\s\S]*?);\nrooms=/);
      if(m3){try{var d=JSON.parse(m3[1]);var trans=[];if(d.busSeats&&d.busSeats.some(function(s){return s.name})){trans=[{id:'bus_main',name:'أتوبيس 1',icon:'🚌',capacity:50,seats:d.busSeats}];}if(d.extraTransports)trans=trans.concat(d.extraTransports);rawData={conf:d.conf||{name:'المؤتمر',startDate:'',endDate:'',days:1},rooms:d.rooms||[],transports:trans,restaurant:d.restaurant||{meals:{breakfast:{price:0,childPrice:0,enabled:true},lunch:{price:0,childPrice:0,enabled:true},dinner:{price:0,childPrice:0,enabled:true}}}};loaded=true;}catch(er){loaded=false;}}
    }

    if(!loaded){
      var m4=text.match(/var rooms\s*=\s*(\[[\s\S]*?\]);/);
      if(m4){try{rawData={conf:{name:'المؤتمر',startDate:'',endDate:'',days:1},rooms:JSON.parse(m4[1]),transports:[],restaurant:restaurant};loaded=true;}catch(er){loaded=false;}}
    }

    if(!loaded){
      var m5=text.match(/"conf_v[0-9]+"[^{]*(\{[\s\S]*?\})\s*[,;]/);
      if(m5){try{var d=JSON.parse(m5[1]);rawData={conf:d.conf||{name:'المؤتمر',startDate:'',endDate:'',days:1},rooms:d.rooms||[],transports:d.transports||[],restaurant:d.restaurant||restaurant};loaded=true;}catch(er){loaded=false;}}
    }

    if(loaded && rawData){
      if(rawData.appData) appData=rawData.appData;
      else if(rawData.conferences) appData=rawData;
      else appData = buildAppDataFromLegacy(rawData);
      normalizeAppData();
      var current = getCurrentConference();
      if(current) setCurrentConference(current);
      renderTab(currentTab);
      showToast('✅ تم تحميل البيانات ('+rooms.length+' غرفة)');
    } else {
      alert('❌ لم يتم التعرف على صيغة الملف\nجرب "💾 حفظ ملف" من النسخة القديمة أولاً');
    }
  };
  r.readAsText(f,'utf-8');e.target.value='';
}

// ═══════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════
function switchTab(n){
  currentTab=n;
  document.querySelectorAll('.tab').forEach(function(t,i){t.className='tab'+(i===n?' active':'')});
  for(var i=0;i<6;i++)ge('tab'+i).style.display=i===n?'':'none';
  renderTab(n);
}
function renderTab(n){
  syncCurrentConferenceRefs();
  if(n===0)renderRooms();
  else if(n===1)renderTransports();
  else if(n===2)renderRestaurant();
  else if(n===3)renderSearch();
  else if(n===4)renderCards();
  else if(n===5)renderSettings();
}

// ═══════════════════════════════════════════════════════
// STATS BAR
// ═══════════════════════════════════════════════════════
function statsHtml(){
  var ag=activeGuests();
  var closedC=rooms.filter(function(r){return r.closed}).length;
  var activeC=rooms.length-closedC;
  var beds=rooms.filter(function(r){return !r.closed}).reduce(function(a,r){return a+r.capacity},0);
  var tSeats=0,tUsed=0;
  transports.forEach(function(t){
    tSeats+=t.capacity;
    tUsed+=t.seats.filter(function(s){return s.name&&s.type!=='child_shared'&&s.type!=='infant'}).length;
  });
  var h='<div class="stats">';
  h+='<div class="stat-card" style="border-top:4px solid #1F4E79"><div class="stat-val" style="color:#1F4E79">'+activeC+'<span style="font-size:10px;color:#95A5A6">'+(closedC?' +'+closedC+'🔒':'')+'</span></div><div class="stat-lbl">🏨 غرف</div></div>';
  h+='<div class="stat-card" style="border-top:4px solid #27AE60"><div class="stat-val" style="color:#27AE60">'+ag.adults.length+'</div><div class="stat-lbl">👤 بالغون</div></div>';
  h+='<div class="stat-card" style="border-top:4px solid #F39C12"><div class="stat-val" style="color:#F39C12">'+ag.children.length+'</div><div class="stat-lbl">🧒 أطفال</div></div>';
  h+='<div class="stat-card" style="border-top:4px solid #8E44AD"><div class="stat-val" style="color:#8E44AD">'+(ag.adults.length+ag.children.length)+'</div><div class="stat-lbl">👥 إجمالي</div></div>';
  h+='<div class="stat-card" style="border-top:4px solid #2E86C1"><div class="stat-val" style="color:#2E86C1">'+beds+'</div><div class="stat-lbl">🛏️ سراير</div></div>';
  h+='<div class="stat-card" style="border-top:4px solid #E67E22"><div class="stat-val" style="color:#E67E22">'+tUsed+'/'+tSeats+'</div><div class="stat-lbl">🚌 كراسي</div></div>';
  h+='</div>';
  return h;
}

// ═══════════════════════════════════════════════════════
// TAB 0: ROOMS
// ═══════════════════════════════════════════════════════
function renderRooms(){
  var currentHouse = getCurrentHouse();
  var selectedHouseLabel = currentHouse ? currentHouse.name : 'الكل';
  var houseRooms = currentHouse ? rooms.filter(function(r){return r.houseId===currentHouse.id;}) : rooms.slice();
  var active=houseRooms.filter(function(r){return !r.closed});
  var closed=houseRooms.filter(function(r){return r.closed});
  var h=statsHtml();
  h+='<div class="card" style="margin-bottom:12px"><div class="row" style="justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px">';
  h+='<div style="flex:1"><label class="lbl">اختر البيت</label><select onchange="setCurrentHouseById(this.value)" style="width:100%">'+houseOptions(currentHouse?currentHouse.id:null)+'</select></div>';
  h+='<div style="display:flex;gap:8px;align-items:flex-end"><button class="btn btn-green" onclick="openRM(null)">➕ غرفة</button><button class="btn btn-purple" onclick="openHouseModal(null)">➕ بيت</button></div>';
  h+='</div></div>';
  h+='<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px"><div class="card-title">🏨 الغرف في '+esc(selectedHouseLabel)+' ('+active.length+')</div><button class="btn btn-green" onclick="openRM(null)">➕ غرفة</button></div><div class="grid3">';
  active.forEach(function(r){
    var ag=r.guests.filter(function(g){return !gl(g)});
    var ac=r.children.filter(function(c){return !c.leftDay});
    var lg=r.guests.filter(function(g){return gl(g)});
    var tot=ag.length+ac.length;
    var col=tot>=r.capacity?'#27AE60':tot>0?'#E67E22':'#95A5A6';
    h+='<div class="rcard" style="border:2px solid '+col+'">';
    h+='<div class="rcard-head" style="background:'+col+'"><span>غرفة '+esc(r.number)+' — دور '+esc(r.floor)+'</span><span style="font-size:9px;opacity:.9">'+tot+'/'+r.capacity+'</span></div>';
    h+='<div class="rcard-body">';
    ag.forEach(function(g){h+='<div class="guest-row"><span>👤 '+esc(gn(g))+'</span><span class="pill p-adult">بالغ</span></div>'});
    ac.forEach(function(c){h+='<div class="guest-row"><span>🧒 '+esc(c.name)+'</span><span class="pill p-child">مع '+esc(c.guardian)+'</span></div>'});
    if(lg.length)h+='<div style="font-size:9px;color:#E74C3C;margin-top:3px">غادر: '+lg.map(function(g){return esc(gn(g))}).join('، ')+'</div>';
    if(!tot&&!lg.length)h+='<div style="color:#AAB5C0;font-size:10px;text-align:center;padding:4px">لا يوجد نزلاء</div>';
    h+='<div class="row" style="margin-top:6px;gap:3px">';
    h+='<button class="btn btn-blue btn-sm" style="flex:1" onclick="openRM(\''+r.id+'\')">✏️ تعديل</button>';
    h+='<button class="btn btn-teal btn-sm" onclick="askClearRoom(\''+r.id+'\',\''+esc(r.number)+'\')" title="تفريغ الأسماء">🧹</button>';
    h+='<button class="btn btn-gray btn-sm" onclick="toggleClose(\''+r.id+'\')" title="إيقاف">🔒</button>';
    h+='<button class="btn btn-red btn-sm" onclick="askDeleteRoom(\''+r.id+'\',\''+esc(r.number)+'\')" title="حذف">🗑️</button>';
    h+='<div id="confirm_'+r.id+'" style="display:none;margin-top:5px;background:#FEF0F0;border:1px solid #E74C3C;border-radius:7px;padding:6px 8px;font-size:10px">';
    h+='<div id="confirm_msg_'+r.id+'" style="margin-bottom:5px;font-weight:700;color:#E74C3C"></div>';
    h+='<div class="row" style="gap:4px"><button class="btn btn-red btn-sm" id="confirm_yes_'+r.id+'">✅ تأكيد</button><button class="btn btn-gray btn-sm" onclick="hideConfirm(\''+r.id+'\')">إلغاء</button></div>';
    h+='</div>';
    h+='</div></div></div>';
  });
  if(!active.length)h+='<div style="color:#AAB5C0;padding:14px;text-align:center;font-size:11px">لا توجد غرف نشطة</div>';
  h+='</div></div>';
  if(closed.length){
    h+='<div class="card"><div class="card-title" style="color:#95A5A6">🔒 موقوفة ('+closed.length+')</div><div class="grid3">';
    closed.forEach(function(r){
      var tot=r.guests.length+r.children.length;
      h+='<div class="rcard" style="border:2px solid #BDC3C7;opacity:.7"><div class="rcard-head" style="background:#95A5A6"><span>🔒 غرفة '+esc(r.number)+'</span><span style="font-size:9px">'+tot+'</span></div>';
      h+='<div class="rcard-body"><div class="row" style="margin-top:5px;gap:3px"><button class="btn btn-green btn-sm" style="flex:1" onclick="toggleClose(\''+r.id+'\')">🔓 تفعيل</button><button class="btn btn-red btn-sm" onclick="delRoom2(\''+r.id+'\')">🗑️</button></div></div></div>';
    });
    h+='</div></div>';
  }
  ge('tab0').innerHTML=h;
}
function toggleClose(id){var r=rooms.find(function(x){return x.id===id});if(!r)return;r.closed=!r.closed;save();renderRooms();showToast(r.closed?'🔒 موقوف':'🔓 مفعّل',r.closed?'#95A5A6':'#27AE60')}
function askClearRoom(id,num){
  var box=ge('confirm_'+id);var msg=ge('confirm_msg_'+id);var yes=ge('confirm_yes_'+id);
  if(!box)return;
  msg.textContent='تفريغ كل أسماء غرفة '+num+'؟';
  yes.onclick=function(){hideConfirm(id);clearRoomG(id);};
  box.style.display='block';
}
function askDeleteRoom(id,num){
  var box=ge('confirm_'+id);var msg=ge('confirm_msg_'+id);var yes=ge('confirm_yes_'+id);
  if(!box)return;
  msg.textContent='حذف غرفة '+num+' نهائياً؟';
  yes.onclick=function(){hideConfirm(id);delRoom2(id);};
  box.style.display='block';
}
function hideConfirm(id){var box=ge('confirm_'+id);if(box)box.style.display='none';}
function clearRoomG(id) {
  var current = getCurrentConference(); if (!current) return;
  var r = current.rooms.find(function(x) { return x.id === id });
  if (!r) return;
  r.guests = []; r.children = [];
  save(); renderRooms(); showToast('🧹 تم تفريغ غرفة ' + r.number, '#16A085');
}
function delRoom2(id) {
  var current = getCurrentConference(); if (!current) return;
  var r = current.rooms.find(function(x) { return x.id === id });
  if (!r) return;
  current.rooms = current.rooms.filter(function(x) { return x.id !== id });
  save(); renderRooms(); showToast('🗑️ تم حذف غرفة ' + r.number, '#E74C3C');
}

// ── Room Modal ──────────────────────────────────────────
function openRM(id){
  editRoomId=id;
  ge('m_children').innerHTML='';ge('m_guests').innerHTML='';ge('m_guests_sec').style.display='none';
  ge('delRoomBtn').style.display=id?'block':'none';
  if(id){
    var r=rooms.find(function(x){return x.id===id});
    ge('rmTitle').textContent='✏️ غرفة '+r.number;
    ge('m_num').value=r.number;ge('m_floor').value=r.floor;ge('m_house').innerHTML=houseOptions(r.houseId);ge('m_cap').value=r.capacity;
    ge('m_guests_sec').style.display='block';
    var days=getDays();
    r.guests.forEach(function(g,i){
      var div=document.createElement('div');div.style.cssText='display:flex;gap:5px;margin-bottom:5px;align-items:center;flex-wrap:wrap';
      var leftVal=g.leftDay||'';
      div.innerHTML='<input style="flex:2;min-width:100px;border-color:'+(gn(g)?'#27AE60':'#BDD7EE')+'" placeholder="الفرد '+(i+1)+'" value="'+esc(gn(g))+'" oninput="this.style.borderColor=this.value?\'#27AE60\':\'#BDD7EE\'">'
        +'<div style="display:flex;align-items:center;gap:3px;font-size:10px;white-space:nowrap"><label class="lbl" style="margin:0">غادر يوم:</label>'
        +'<select style="width:70px;font-size:10px">'+dayOptions(days,leftVal)+'</select></div>';
      ge('m_guests').appendChild(div);
    });
    r.children.forEach(function(c){addCI(c.name,c.guardian,c.leftDay)});
  } else {
    ge('rmTitle').textContent='➕ غرفة جديدة';
    ge('m_num').value='';ge('m_floor').value=1;ge('m_house').innerHTML=houseOptions(getCurrentHouse()?getCurrentHouse().id:null);ge('m_cap').value='';
  }
  ge('roomModal').style.display='flex';
}
function dayOptions(days,selected){
  var h='<option value="">—</option>';
  for(var i=1;i<=days;i++)h+='<option value="'+i+'" '+(selected==i?'selected':'')+'>يوم '+i+'</option>';
  return h;
}
function closeRM(){ge('roomModal').style.display='none'}
function clearGInputs(){ge('m_guests').querySelectorAll('input').forEach(function(inp){inp.value='';inp.style.borderColor='#BDD7EE'})}
function applyCapacity(){
  var n=parseInt(ge('m_cap').value);if(!n||n<1||n>20){alert('1-20');return}
  ge('m_guests_sec').style.display='block';
  var existing=[];
  ge('m_guests').querySelectorAll('div').forEach(function(d){
    var inp=d.querySelector('input');var sel=d.querySelector('select');
    if(inp)existing.push({name:inp.value,leftDay:sel?sel.value:''});
  });
  ge('m_guests').innerHTML='';
  var days=getDays();
  for(var i=0;i<n;i++){
    var ex=existing[i]||{name:'',leftDay:''};
    var div=document.createElement('div');div.style.cssText='display:flex;gap:5px;margin-bottom:5px;align-items:center;flex-wrap:wrap';
    div.innerHTML='<input style="flex:2;min-width:100px;border-color:'+(ex.name?'#27AE60':'#BDD7EE')+'" placeholder="الفرد '+(i+1)+'" value="'+esc(ex.name)+'" oninput="this.style.borderColor=this.value?\'#27AE60\':\'#BDD7EE\'">'
      +'<div style="display:flex;align-items:center;gap:3px;font-size:10px;white-space:nowrap"><label class="lbl" style="margin:0">غادر يوم:</label>'
      +'<select style="width:70px;font-size:10px">'+dayOptions(days,ex.leftDay)+'</select></div>';
    ge('m_guests').appendChild(div);
  }
}
function addCI(name,guardian,leftDay){
  name=name||'';guardian=guardian||'';leftDay=leftDay||'';
  var id='ci_'+uid();var days=getDays();
  var div=document.createElement('div');div.className='child-box';div.id=id;
  div.innerHTML='<div class="row"><div style="flex:2"><label class="lbl">اسم الطفل</label><input placeholder="الاسم" value="'+esc(name)+'"></div>'
    +'<div style="flex:2"><label class="lbl">ولي الأمر</label><input placeholder="ولي الأمر" value="'+esc(guardian)+'"></div>'
    +'<button class="btn btn-red btn-sm" style="align-self:flex-end;padding:6px 8px" onclick="document.getElementById(\''+id+'\').remove()">✕</button></div>'
    +'<div style="display:flex;align-items:center;gap:5px;margin-top:5px;font-size:10px"><label class="lbl" style="margin:0">غادر يوم:</label><select style="width:80px;font-size:10px">'+dayOptions(days,leftDay)+'</select></div>';
  ge('m_children').appendChild(div);
}
function saveRoom(){
  var num=ge('m_num').value.trim();var floor=ge('m_floor').value;
  if(!num){alert('أدخل رقم الغرفة');return}
  var guests=[];
  ge('m_guests').querySelectorAll('div').forEach(function(d){
    var inp=d.querySelector('input');var sel=d.querySelector('select');
    if(inp&&inp.value.trim())guests.push({name:inp.value.trim(),leftDay:sel&&sel.value?parseInt(sel.value):null});
  });
  var children=[];
  ge('m_children').querySelectorAll('.child-box').forEach(function(box){
    var ins=box.querySelectorAll('input');var sel=box.querySelector('select');
    if(ins[0]&&ins[0].value.trim())children.push({name:ins[0].value.trim(),guardian:(ins[1]?ins[1].value.trim():''),leftDay:sel&&sel.value?parseInt(sel.value):null});
  });
  var houseId = ge('m_house').value || (getCurrentHouse() ? getCurrentHouse().id : null);
  var cap=parseInt(ge('m_cap').value)||guests.length||2;
  if(!houseId){alert('اختر البيت');return;}
  var current = getCurrentConference(); if (!current) return;
  if(editRoomId){
    current.rooms=current.rooms.map(function(r){return r.id===editRoomId?{id:r.id,number:num,floor:parseInt(floor),houseId:houseId,capacity:cap,guests:guests,children:children,closed:r.closed||false}:r});
    showToast('✅ تم تعديل غرفة '+num);
  } else {
    current.rooms.push({id:uid(),number:num,floor:parseInt(floor),houseId:houseId,capacity:cap,guests:guests,children:children,closed:false});
    showToast('✅ غرفة '+num+' أُضيفت');
  }
  closeRM();save();renderRooms();
}
function deleteRoom(){
  var current = getCurrentConference(); if (!current) return;
  var r=current.rooms.find(function(x){return x.id===editRoomId});
  if(!r||!confirm('حذف غرفة '+r.number+'؟'))return;
  current.rooms=current.rooms.filter(function(x){return x.id!==editRoomId});
  closeRM();save();renderRooms();showToast('🗑️ تم','#E74C3C');
}

// ═══════════════════════════════════════════════════════
// TAB 1: TRANSPORTS
// ═══════════════════════════════════════════════════════
function renderTransports(){
  var h='<div class="card no-print"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px"><div class="card-title">🚌 وسائل المواصلات ('+transports.length+')</div>';
  h+='<div class="row" style="gap:5px">';
  if(transports.length)h+='<button class="btn btn-dark" onclick="openBulkAssign()">⚡ تسكين جماعي</button>';
  h+='<button class="btn btn-green" onclick="openTM(null)">➕ إضافة</button>';
  h+='</div></div>';
  if(!transports.length)h+='<div style="text-align:center;padding:16px;color:#AAB5C0;font-size:11px">لا توجد وسائل — اضغط ➕</div>';
  h+='</div>';
  transports.forEach(function(t){
    var realSeats=t.seats.filter(function(s){return s.name&&s.type!=='child_shared'&&s.type!=='infant'});
    var sharedKids=t.seats.filter(function(s){return s.name&&(s.type==='child_shared'||s.type==='infant')});
    // also collect riders stored on parent seats
    var riderList=[];
    t.seats.forEach(function(s){if(s.riders&&s.riders.length)s.riders.forEach(function(r){riderList.push({r:r,parentSeat:s.seat,parentName:s.name})})});
    var used=realSeats.length;
    h+='<div class="card">';
    h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
    h+='<div class="card-title" style="margin:0">'+esc(t.icon)+' '+esc(t.name)+' <span style="font-size:10px;color:#E67E22;font-weight:normal">('+used+'/'+t.capacity+' كرسي'+(sharedKids.length+riderList.length?' + '+(sharedKids.length+riderList.length)+' طفل مشترك':'')+')</span></div>';
    h+='<button class="btn btn-blue btn-sm" onclick="openTM(\''+t.id+'\')">✏️</button></div>';
    h+='<div style="font-size:9px;color:#5a7a9a;margin-bottom:6px">🟩 مشغول  🟨 طفل كرسي  🟪 مع والده  ⬜ فارغ — اضغط للتعيين</div>';
    h+='<div class="seat-grid">';
    t.seats.forEach(function(s){
      var riders=s.riders&&s.riders.length?s.riders:[];
      var cls='seat'+(s.name?s.type==='child_seat'?' ch':s.type==='child_shared'||s.type==='infant'?' shared':' occ':'');
      var show=s.type==='child_shared'||s.type==='infant'?'👶':s.name?s.name.split(' ')[0]:'';
      h+='<div class="'+cls+'" onclick="openSM(\''+t.id+'\','+s.seat+')" title="'+(s.name||'فارغ')+(riders.length?' + '+riders.map(function(r){return r.r.name}).join(', '):'')+'">';
      h+='<div style="font-size:10px;font-weight:800">'+s.seat+(riders.length?'<span style="font-size:7px;color:#8E44AD"> +'+riders.length+'👶</span>':'')+'</div>';
      if(show)h+='<div style="font-size:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(show)+'</div>';
      h+='</div>';
    });
    h+='</div>';
    if(sharedKids.length||riderList.length){
      h+='<div style="margin-top:8px;font-size:10px;color:#7D4E00;font-weight:700">👶 أطفال مع أولياء الأمور (لا يُحتسب لهم كرسي)</div>';
      h+='<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">';
      sharedKids.forEach(function(s){h+='<span style="background:#EDE7F6;border:1px solid #8E44AD;border-radius:8px;padding:2px 7px;font-size:10px">'+esc(s.name)+'<span style="color:#7A9AB8"> — مع '+esc(s.note||'ولي أمره')+'</span></span>'});
      riderList.forEach(function(x){h+='<span style="background:#EDE7F6;border:1px solid #8E44AD;border-radius:8px;padding:2px 7px;font-size:10px">'+esc(x.r.name)+'<span style="color:#7A9AB8"> — مع '+esc(x.parentName)+' (كرسي '+x.parentSeat+')</span></span>'});
      h+='</div>';
    }
    if(used>0){
      h+='<div style="margin-top:8px"><table><thead><tr><th>الكرسي</th><th>الاسم</th><th>الغرفة</th><th>النوع</th><th></th></tr></thead><tbody>';
      t.seats.filter(function(s){return s.name&&s.type!=='child_shared'&&s.type!=='infant'}).forEach(function(s){
        h+='<tr><td><b style="color:#E67E22">'+s.seat+'</b></td><td>'+esc(s.name)+'</td><td>'+esc(s.room)+'</td>';
        h+='<td>'+(s.type==='child_seat'?'<span class="pill p-child">🧒 كرسي</span>':'<span class="pill p-adult">👤</span>')+'</td>';
        h+='<td><button class="btn btn-blue btn-sm" onclick="openSM(\''+t.id+'\','+s.seat+')">✏️</button></td></tr>';
      });
      h+='</tbody></table></div>';
    }
    h+='</div>';
  });
  ge('tab1').innerHTML=h;
}

// ── Transport Modal ──────────────────────────────────────
function openTM(id){
  editTransId=id;ge('delTransBtn').style.display=id?'block':'none';
  if(id){var t=transports.find(function(x){return x.id===id});ge('tmTitle').textContent='✏️ '+t.name;ge('t_name').value=t.name;ge('t_icon').value=t.icon;ge('t_cap').value=t.capacity;}
  else{ge('tmTitle').textContent='➕ وسيلة جديدة';ge('t_name').value='';ge('t_icon').value='🚌';ge('t_cap').value='';}
  ge('transportModal').style.display='flex';
}
function closeTM(){ge('transportModal').style.display='none'}
function saveTransport(){
  var name=ge('t_name').value.trim();var icon=ge('t_icon').value;var cap=parseInt(ge('t_cap').value);
  if(!name){alert('أدخل الاسم');return}if(!cap||cap<1||cap>300){alert('العدد 1-300');return}
  var current = getCurrentConference(); if (!current) return;
  if(editTransId){
    var t=current.transports.find(function(x){return x.id===editTransId});
    if(t){t.name=name;t.icon=icon;
      if(cap!==t.capacity){var old=t.seats;t.seats=[];for(var i=1;i<=cap;i++){var ex=old.find(function(s){return s.seat===i});t.seats.push(ex||{seat:i,name:'',room:'',type:'adult',note:''});}t.capacity=cap;}
    }showToast('✅ تم التعديل');
  } else {
    var seats=[];for(var i=1;i<=cap;i++)seats.push({seat:i,name:'',room:'',type:'adult',note:''});
    current.transports.push({id:uid(),name:name,icon:icon,capacity:cap,seats:seats});showToast('✅ أُضيفت '+name);
  }
  closeTM();save();renderTransports();
}
function deleteTransport(){
  var current = getCurrentConference(); if (!current) return;
  var t=current.transports.find(function(x){return x.id===editTransId});
  if(!t||!confirm('حذف '+t.name+'؟'))return;
  current.transports=current.transports.filter(function(x){return x.id!==editTransId});
  closeTM();save();renderTransports();showToast('🗑️ تم','#E74C3C');
}

// ── Seat Modal ───────────────────────────────────────────
function openSM(transId,seatNum){
  editSeatTransId=transId;editSeatNum=seatNum;
  var t=transports.find(function(x){return x.id===transId});
  var s=t.seats.find(function(x){return x.seat===seatNum});
  ge('smTitle').textContent=t.icon+' '+t.name+' — كرسي '+seatNum;
  var sel=ge('s_pick');sel.innerHTML='<option value="">— اختر —</option>';
  // for child_shared/infant show ALL guests (including assigned) since they share a seat
  var isSharedSeat=s.type==='child_shared'||s.type==='infant';
  var list=isSharedSeat?allGuestsForPick():unassigned(s.name);
  list.forEach(function(g){
    var opt=document.createElement('option');opt.value=g.name;opt.textContent=g.name+' (غرفة '+g.room+')';
    opt.dataset.room=g.room;opt.dataset.child=g.guardian?'1':'0';
    if(s.name===g.name)opt.selected=true;sel.appendChild(opt);
  });
  ge('s_name').value=s.name||'';ge('s_room').value=s.room||'';ge('s_type').value=s.type||'adult';ge('s_note').value=s.note||'';
  toggleSeatNote();ge('clearSeatBtn').style.display=s.name?'block':'none';
  ge('seatModal').style.display='flex';
}
function allGuestsForPick(){
  var l=[];
  rooms.filter(function(r){return !r.closed}).forEach(function(r){
    r.guests.forEach(function(g){if(!gl(g))l.push({name:gn(g),room:r.number,guardian:null})});
    r.children.forEach(function(c){if(!c.leftDay)l.push({name:c.name,room:r.number,guardian:c.guardian})});
  });
  return l;
}
function closeSM(){ge('seatModal').style.display='none'}
function pickGuest(){
  var sel=ge('s_pick');var opt=sel.options[sel.selectedIndex];if(!opt||!opt.value)return;
  ge('s_name').value=opt.value;ge('s_room').value=opt.dataset.room||'';
  // auto-set type: child from room children → child_seat by default
  ge('s_type').value=opt.dataset.child==='1'?'child_seat':'adult';
  toggleSeatNote();
}
function toggleSeatNote(){
  var tp=ge('s_type').value;
  var noteRow=ge('s_note_row');
  noteRow.style.display=(tp==='child_seat'||tp==='child_shared'||tp==='infant')?'block':'none';
  // update label based on type
  var lbl=noteRow.querySelector('label');
  if(lbl){
    if(tp==='child_shared'||tp==='infant') lbl.textContent='اسم ولي الأمر + رقم كرسيه (الطفل يجلس معه — لا يُحتسب كرسي)';
    else lbl.textContent='اسم ولي الأمر / رقم كرسيه';
  }
  // change note placeholder
  var noteInp=ge('s_note');
  if(noteInp){
    if(tp==='child_shared'||tp==='infant') noteInp.placeholder='مثال: مع والده — كرسي 5';
    else noteInp.placeholder='اسم ولي الأمر / رقم كرسيه';
  }
}
function saveSeat(){
  var name=ge('s_name').value.trim();var room=ge('s_room').value.trim();var type=ge('s_type').value;var note=ge('s_note').value.trim();
  var t=transports.find(function(x){return x.id===editSeatTransId});if(!t)return;
  // child_shared / infant: attach to parent's seat, don't consume a new seat number
  if(type==='child_shared'||type==='infant'){
    if(!name){alert('أدخل اسم الطفل');return}
    // find parent seat from note (e.g. "مع والده — كرسي 5")
    var parentSeatMatch=note.match(/كرسي\s*(\d+)/);
    if(parentSeatMatch){
      var pSeatNum=parseInt(parentSeatMatch[1]);
      var pSeat=t.seats.find(function(x){return x.seat===pSeatNum});
      if(pSeat&&pSeat.name){
        // store child on the parent seat as a "rider"
        if(!pSeat.riders)pSeat.riders=[];
        // remove from old seat if editing
        var oldSeat=t.seats.find(function(x){return x.seat===editSeatNum});
        if(oldSeat&&oldSeat.name===name){oldSeat.name='';oldSeat.room='';oldSeat.type='adult';oldSeat.note='';oldSeat.riders=[];}
        // add as rider
        var already=pSeat.riders.find(function(r){return r.name===name});
        if(!already)pSeat.riders.push({name:name,room:room,type:type,note:note});
        closeSM();save();renderTransports();showToast('✅ '+name+' أُضيف مع '+pSeat.name+' (كرسي '+pSeatNum+')');
        return;
      }
    }
    // no parent seat found — just save on current seat as shared marker
    var s=t.seats.find(function(x){return x.seat===editSeatNum});
    s.name=name;s.room=room;s.type=type;s.note=note;
    closeSM();save();renderTransports();showToast('✅ '+name+' — مع ولي أمره');
    return;
  }
  // regular seat (adult / child_seat / special)
  if(name){
    var dup=null;
    transports.forEach(function(tr){tr.seats.forEach(function(sx){if(sx.name===name&&sx.type!=='child_shared'&&sx.type!=='infant'&&!(tr.id===editSeatTransId&&sx.seat===editSeatNum))dup=tr.name+' كرسي '+sx.seat})});
    if(dup&&!confirm('⚠️ "'+name+'" في '+dup+'. تأكيد؟'))return;
  }
  var s=t.seats.find(function(x){return x.seat===editSeatNum});
  s.name=name;s.room=room;s.type=type;s.note=note;
  closeSM();save();renderTransports();showToast('✅ كرسي '+editSeatNum+' — '+name);
}
function clearSeat(){
  var t=transports.find(function(x){return x.id===editSeatTransId});if(!t)return;
  var s=t.seats.find(function(x){return x.seat===editSeatNum});
  s.name='';s.room='';s.type='adult';s.note='';
  closeSM();save();renderTransports();showToast('🗑️ تم الإفراغ','#E74C3C');
}

// ═══════════════════════════════════════════════════════
// TAB 2: RESTAURANT
// ═══════════════════════════════════════════════════════
var MEALS={breakfast:{label:'🌅 فطار',key:'breakfast'},lunch:{label:'🍽️ غداء',key:'lunch'},dinner:{label:'🌙 عشاء',key:'dinner'}};
var MKEYS=['breakfast','lunch','dinner'];

function personsOnDay(day){
  var adults=0,children=0;
  rooms.filter(function(r){return !r.closed}).forEach(function(r){
    r.guests.forEach(function(g){if(!gl(g,day))adults++});
    r.children.forEach(function(c){if(!c.leftDay||c.leftDay>day)children++});
  });
  return {adults:adults,children:children};
}

function renderRestaurant(){
  var days=getDays();
  if(!restaurant.meals)restaurant.meals={breakfast:{price:0,childPrice:0,enabled:true},lunch:{price:0,childPrice:0,enabled:true},dinner:{price:0,childPrice:0,enabled:true}};

  // ── Prices card ──
  var h='<div class="card"><div class="card-title">💰 أسعار الوجبات</div>';
  h+='<div style="overflow-x:auto"><table><thead><tr><th>الوجبة</th><th>مفعّلة</th><th>سعر البالغ (ر.س)</th><th>سعر الطفل (ر.س)</th></tr></thead><tbody>';
  MKEYS.forEach(function(mk){
    var m=restaurant.meals[mk]||{price:0,childPrice:0,enabled:true};
    h+='<tr><td><b>'+MEALS[mk].label+'</b></td>';
    h+='<td style="text-align:center"><input type="checkbox" '+(m.enabled!==false?'checked':'')+' onchange="toggleMeal(\''+mk+'\',this.checked)" style="width:auto"></td>';
    h+='<td><input type="number" min="0" step="0.5" style="width:90px;border-color:#E67E22" value="'+(m.price||0)+'" onchange="setMealPrice(\''+mk+'\',\'price\',this.value)"></td>';
    h+='<td><input type="number" min="0" step="0.5" style="width:90px;border-color:#F39C12" value="'+(m.childPrice||0)+'" onchange="setMealPrice(\''+mk+'\',\'childPrice\',this.value)"></td>';
    h+='</tr>';
  });
  h+='</tbody></table></div></div>';

  // ── Daily report ──
  h+='<div class="card"><div class="card-title">📅 التقرير اليومي</div>';
  var grandTotal=0;
  var mealTotals={breakfast:0,lunch:0,dinner:0};
  h+='<div style="overflow-x:auto"><table><thead><tr><th>اليوم</th><th>بالغون</th><th>أطفال</th>';
  MKEYS.forEach(function(mk){if(restaurant.meals[mk].enabled!==false)h+='<th>'+MEALS[mk].label+'</th>';});
  h+='<th>تكلفة اليوم</th></tr></thead><tbody>';
  for(var d=1;d<=days;d++){
    var p=personsOnDay(d);
    var dayTotal=0;
    h+='<tr><td><b>يوم '+d+'</b></td><td>'+p.adults+'</td><td>'+p.children+'</td>';
    MKEYS.forEach(function(mk){
      var m=restaurant.meals[mk];
      if(m.enabled===false)return;
      var cost=p.adults*(m.price||0)+p.children*(m.childPrice||0);
      dayTotal+=cost;mealTotals[mk]+=cost;
      h+='<td style="color:#27AE60;font-size:10px">'+cost.toFixed(0)+' ر.س<br><span style="color:#95A5A6">'+p.adults+'+'+p.children+'</span></td>';
    });
    grandTotal+=dayTotal;
    h+='<td style="font-weight:700;color:#E67E22">'+dayTotal.toFixed(2)+' ر.س</td></tr>';
  }
  h+='</tbody></table></div></div>';

  // ── Summary dashboard ──
  h+='<div class="stats">';
  MKEYS.forEach(function(mk){
    if(restaurant.meals[mk].enabled===false)return;
    h+='<div class="stat-card" style="border-top:4px solid #E67E22"><div class="stat-val" style="color:#E67E22;font-size:14px">'+mealTotals[mk].toFixed(0)+'<span style="font-size:10px"> ر.س</span></div><div class="stat-lbl">'+MEALS[mk].label+'</div></div>';
  });
  h+='<div class="stat-card" style="border-top:4px solid #8E44AD"><div class="stat-val" style="color:#8E44AD;font-size:14px">'+grandTotal.toFixed(2)+'<span style="font-size:9px"> ر.س</span></div><div class="stat-lbl">💰 الإجمالي الكلي</div></div>';
  h+='</div>';

  // ── Per-room invoices ──
  h+='<div class="card"><div class="card-title">🧾 فواتير الغرف</div>';
  h+='<div style="overflow-x:auto"><table><thead><tr><th>الغرفة</th><th>بالغون</th><th>أطفال</th><th>ليالي</th>';
  MKEYS.forEach(function(mk){if(restaurant.meals[mk].enabled!==false)h+='<th>'+MEALS[mk].label+'</th>';});
  h+='<th>الإجمالي</th></tr></thead><tbody>';
  rooms.filter(function(r){return !r.closed}).forEach(function(r){
    var rTotal=0;
    var adults=r.guests.filter(function(g){return !gl(g)}).length;
    var children=r.children.filter(function(c){return !c.leftDay}).length;
    // nights = days the room is active (per person considering leftDay)
    var nights=getDays();
    h+='<tr><td><b style="color:#1F4E79">غرفة '+esc(r.number)+'</b></td><td>'+adults+'</td><td>'+children+'</td><td>'+nights+'</td>';
    MKEYS.forEach(function(mk){
      var m=restaurant.meals[mk];if(m.enabled===false)return;
      // count how many days each adult/child is present
      var aCost=0,cCost=0;
      for(var d=1;d<=nights;d++){
        var pa=r.guests.filter(function(g){return !gl(g,d)}).length;
        var pc=r.children.filter(function(c){return !c.leftDay||c.leftDay>d}).length;
        aCost+=pa*(m.price||0);cCost+=pc*(m.childPrice||0);
      }
      rTotal+=aCost+cCost;
      h+='<td style="font-size:10px">'+(aCost+cCost).toFixed(0)+'</td>';
    });
    h+='<td style="font-weight:700;color:#8E44AD">'+rTotal.toFixed(2)+' ر.س</td></tr>';
  });
  h+='</tbody></table></div></div>';

  ge('tab2').innerHTML=h;
}
function toggleMeal(mk,val){if(!restaurant.meals[mk])restaurant.meals[mk]={price:0,childPrice:0};restaurant.meals[mk].enabled=val;save();renderRestaurant();}
function setMealPrice(mk,field,val){if(!restaurant.meals[mk])restaurant.meals[mk]={price:0,childPrice:0};restaurant.meals[mk][field]=parseFloat(val)||0;save();}

// ═══════════════════════════════════════════════════════
// TAB 3: SEARCH
// ═══════════════════════════════════════════════════════
function renderSearch(){
  var h='<div class="card"><div class="card-title">🔍 بحث — رقم الغرفة أو اسم الشخص</div>';
  h+='<div class="row" style="margin-bottom:8px"><input id="sInput" style="flex:1;font-size:12px;border-color:#2E75B6" placeholder="اكتب رقم الغرفة أو اسم الشخص..." onkeyup="liveSearch(this.value)"><button class="btn btn-gray btn-sm" onclick="ge(\'sInput\').value=\'\';ge(\'sRes\').innerHTML=\'\'">مسح</button></div>';
  h+='<div id="sRes"></div><div style="margin-top:7px"><div style="font-size:10px;color:#5a7a9a;margin-bottom:4px">الغرف:</div><div>';
  rooms.forEach(function(r){h+='<span class="chip" onclick="ge(\'sInput\').value=\''+esc(r.number)+'\';liveSearch(\''+esc(r.number)+'\')">'+esc(r.number)+'</span>'});
  h+='</div></div></div>';ge('tab3').innerHTML=h;
}
function liveSearch(q){
  q=(q||'').trim();var el=ge('sRes');if(!q){el.innerHTML='';return}
  var h='';
  rooms.filter(function(r){return r.number===q}).forEach(function(r){
    var ag=r.guests.filter(function(g){return !gl(g)});var lg=r.guests.filter(function(g){return gl(g)});var ac=r.children.filter(function(c){return !c.leftDay});
    var tSeats=[];transports.forEach(function(t){t.seats.filter(function(s){return s.room===r.number&&s.name}).forEach(function(s){tSeats.push({t:t,s:s})})});
    h+='<div style="border:2px solid #2E75B6;border-radius:11px;overflow:hidden;margin-bottom:8px">';
    h+='<div style="background:linear-gradient(135deg,#1F4E79,#2E75B6);color:#fff;padding:8px 12px;font-weight:700;display:flex;justify-content:space-between;font-size:12px"><span>🏨 غرفة '+esc(r.number)+' — دور '+esc(r.floor)+'</span><span style="opacity:.9">'+(ag.length+ac.length)+'/'+r.capacity+(r.closed?' 🔒':'')+'</span></div>';
    h+='<div style="padding:10px">';
    ag.forEach(function(g,i){h+='<div style="display:flex;justify-content:space-between;padding:4px 7px;background:'+(i%2===0?'#EAF4FC':'#fff')+';border-radius:5px;margin-bottom:2px;font-size:11px"><span>👤 '+esc(gn(g))+'</span><span class="pill p-adult">بالغ</span></div>'});
    ac.forEach(function(c){h+='<div style="background:#FFF9EC;border:1px solid #F9D57A;border-radius:5px;padding:4px 7px;margin-bottom:2px;display:flex;justify-content:space-between;font-size:11px"><span>🧒 '+esc(c.name)+'</span><span style="color:#7D4E00;font-size:9px">'+esc(c.guardian)+'</span></div>'});
    if(lg.length)h+='<div style="font-size:9px;color:#E74C3C;margin-top:3px">غادر: '+lg.map(function(g){return esc(gn(g))}).join('، ')+'</div>';
    if(tSeats.length){h+='<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:3px">';tSeats.forEach(function(x){h+='<span style="background:#D5F5E3;border:1.5px solid #27AE60;border-radius:5px;padding:2px 7px;font-size:9px;font-weight:700">'+esc(x.t.icon)+' كرسي '+x.s.seat+': '+esc(x.s.name)+'</span>'});h+='</div>';}
    h+='<div class="row" style="margin-top:7px;gap:4px"><button class="btn btn-blue btn-sm" onclick="openRM(\''+r.id+'\')">✏️</button><button class="btn btn-teal btn-sm" onclick="clearRoomG(\''+r.id+'\');renderSearch()">🧹</button><button class="btn btn-gray btn-sm" onclick="toggleClose(\''+r.id+'\');renderSearch()">🔒</button></div>';
    h+='</div></div>';
  });
  var nRes=[],tRes=[];
  (rooms || []).forEach(function(r){
    r.guests.forEach(function(g){if(gn(g).indexOf(q)>=0)nRes.push({name:gn(g),room:r.number,floor:r.floor,type:'بالغ',left:gl(g),rid:r.id})});
    r.children.forEach(function(c){if(c.name.indexOf(q)>=0)nRes.push({name:c.name,room:r.number,floor:r.floor,type:'طفل',left:!!c.leftDay,rid:r.id})});
  });
  (transports || []).forEach(function(t){t.seats.filter(function(s){return s.name&&s.name.indexOf(q)>=0}).forEach(function(s){tRes.push({t:t,s:s})})});
  if(!nRes.length&&!tRes.length&&!rooms.find(function(r){return r.number===q})){el.innerHTML='<div style="text-align:center;padding:14px;color:#E74C3C;font-size:12px">❌ لا نتائج لـ "'+esc(q)+'"</div>';return}
  if(nRes.length){
    h+='<div style="font-weight:700;color:#1F4E79;margin:7px 0 4px;font-size:11px">👤 نتائج الاسم</div>';
    nRes.forEach(function(p){
      var tSeat=null;(transports || []).forEach(function(t){var sx=t.seats.find(function(s){return s.name===p.name});if(sx)tSeat={t:t,s:sx}});
      h+='<div style="background:#EAF4FC;border:1.5px solid #BDD7EE;border-radius:9px;padding:8px 11px;margin-bottom:5px;display:flex;justify-content:space-between;align-items:center;gap:5px">';
      h+='<div><div style="font-weight:700;font-size:12px">'+(p.left?'<s style="opacity:.5">'+esc(p.name)+'</s> <span class="pill p-left">غادر</span>':esc(p.name))+'</div>';
      h+='<div style="font-size:10px;color:#5a7a9a">غرفة '+esc(p.room)+' — دور '+esc(p.floor)+'</div>';
      if(tSeat)h+='<div style="font-size:10px;color:#27AE60">'+esc(tSeat.t.icon)+' كرسي '+tSeat.s.seat+'</div>';
      h+='</div><span class="pill '+(p.type==='بالغ'?'p-adult':'p-child')+'">'+esc(p.type)+'</span></div>';
    });
  }
  if(tRes.length){
    h+='<div style="font-weight:700;color:#27AE60;margin:7px 0 4px;font-size:11px">🚌 في المواصلات</div>';
    tRes.forEach(function(x){
      h+='<div style="background:#D5F5E3;border:1.5px solid #27AE60;border-radius:9px;padding:8px 11px;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center">';
      h+='<div><div style="font-weight:700;font-size:12px">'+esc(x.s.name)+'</div><div style="font-size:10px;color:#1B5E20">'+esc(x.t.icon)+' '+esc(x.t.name)+' — كرسي '+x.s.seat+'</div></div>';
      h+='<button class="btn btn-blue btn-sm" onclick="openSM(\''+x.t.id+'\','+x.s.seat+')">✏️</button></div>';
    });
  }
  el.innerHTML=h;
}

// ═══════════════════════════════════════════════════════
// TAB 4: CARDS
// ═══════════════════════════════════════════════════════
function renderCards(){
  var h='<div class="card no-print"><div class="card-title">🪪 كروت الضيوف</div>';
  h+='<div class="row" style="margin-bottom:8px"><button class="btn '+(cardMode==='person'?'btn-purple':'btn-gray')+'" onclick="setCardMode(\'person\')">👤 لكل فرد</button><button class="btn '+(cardMode==='room'?'btn-purple':'btn-gray')+'" onclick="setCardMode(\'room\')">🏨 لكل غرفة</button></div>';
  var selC=Object.keys(selectedCards).filter(function(k){return selectedCards[k]}).length;
  h+='<div class="row" style="margin-bottom:5px"><button class="btn btn-blue btn-sm" onclick="selAll(true)">✔️ كل</button><button class="btn btn-gray btn-sm" onclick="selAll(false)">✖️</button><button class="btn btn-green" onclick="printSel()">🖨️ طباعة ('+selC+')</button></div></div>';
  var items=[];
  if(cardMode==='person'){
    rooms.forEach(function(r){
      r.guests.filter(function(g){return !gl(g)}).forEach(function(g){items.push({key:'p_'+r.id+'_'+gn(g),name:gn(g),room:r.number,floor:r.floor,type:'بالغ',note:'',members:null})});
      r.children.filter(function(c){return !c.leftDay}).forEach(function(c){items.push({key:'p_'+r.id+'_'+c.name,name:c.name,room:r.number,floor:r.floor,type:'🧒 طفل',note:'ولي الأمر: '+c.guardian,members:null})});
    });
  } else {
    rooms.filter(function(r){return !r.closed}).forEach(function(r){
      var m=r.guests.filter(function(g){return !gl(g)}).map(function(g){return{name:gn(g),type:'بالغ'}}).concat(r.children.filter(function(c){return !c.leftDay}).map(function(c){return{name:c.name,type:'🧒 '+c.guardian}}));
      items.push({key:'r_'+r.id,name:'غرفة '+r.number,room:r.number,floor:r.floor,type:'غرفة',note:'',members:m});
    });
  }
  h+='<div class="grid3" id="cardsGrid">';
  items.forEach(function(it){
    var tSeat=null;
    if(!it.members){transports.forEach(function(t){var sx=t.seats.find(function(s){return s.name===it.name&&s.room===it.room});if(sx)tSeat={t:t,s:sx}})}
    else{var rs=[];transports.forEach(function(t){t.seats.filter(function(s){return s.room===it.room&&s.name}).forEach(function(s){rs.push(t.icon+' كرسي '+s.seat+': '+s.name)})});if(rs.length)tSeat={combined:rs.join(' | ')}}
    var checked=!!selectedCards[it.key];
    h+='<div class="guest-card" data-key="'+it.key+'" style="'+(checked?'box-shadow:0 0 0 3px #27AE60':'')+';position:relative">';
    h+='<label class="no-print" style="position:absolute;top:5px;left:5px;background:#fff;border-radius:4px;padding:1px 5px;font-size:9px;display:flex;align-items:center;gap:2px;z-index:2;cursor:pointer"><input type="checkbox" '+(checked?'checked':'')+' onchange="toggleCard(\''+it.key+'\')" style="width:auto"> تحديد</label>';
    h+='<div class="gc-head">🪪 '+(it.members?'بطاقة غرفة':'بطاقة ضيف')+'</div>';
    h+='<div class="gc-body">';
    h+='<div class="gc-row"><span style="color:#6C3483;font-weight:700;font-size:10px">'+(it.members?'الغرفة':'الاسم')+'</span><span style="font-weight:700">'+esc(it.name)+'</span></div>';
    h+='<div class="gc-row"><span style="color:#6C3483;font-weight:700;font-size:10px">الغرفة/الدور</span><span>غرفة '+esc(it.room)+' — دور '+esc(it.floor)+'</span></div>';
    if(!it.members)h+='<div class="gc-row"><span style="color:#6C3483;font-weight:700;font-size:10px">النوع</span><span>'+esc(it.type)+'</span></div>';
    else{h+='<div style="margin-top:4px">';it.members.forEach(function(m){h+='<div class="gc-row" style="font-size:10px"><span>'+(m.type.indexOf('طفل')>=0?'🧒':'👤')+' '+esc(m.name)+'</span></div>'});h+='</div>';}
    if(it.note)h+='<div class="gc-row"><span style="color:#6C3483;font-weight:700;font-size:10px">ملاحظة</span><span style="font-size:10px;color:#7D4E00">'+esc(it.note)+'</span></div>';
    if(tSeat){var st=tSeat.combined||(tSeat.t.icon+' '+tSeat.t.name+' كرسي '+tSeat.s.seat);h+='<div class="gc-row"><span style="color:#6C3483;font-weight:700;font-size:10px">المواصلة</span><span style="font-size:10px">'+esc(st)+'</span></div>';}
    h+='</div><div class="gc-foot">أهلاً وسهلاً 🌟</div>';
    h+='<div class="no-print" style="display:flex;gap:4px;padding:6px;background:#FAF5FF"><button class="btn btn-blue btn-sm" style="flex:1" onclick="shareCard(\''+it.key+'\')">🔗</button><button class="btn btn-purple btn-sm" style="flex:1" onclick="printOne(\''+it.key+'\')">🖨️</button></div>';
    h+='</div>';
  });
  h+='</div>';
  ge('tab4').innerHTML=h;
}
function setCardMode(m){cardMode=m;selectedCards={};renderCards()}
function toggleCard(k){selectedCards[k]=!selectedCards[k];renderCards()}
function selAll(v){document.querySelectorAll('#cardsGrid .guest-card').forEach(function(el){selectedCards[el.dataset.key]=v});renderCards()}
function cardText(k){var c=document.querySelector('.guest-card[data-key="'+k+'"]');if(!c)return'';var l=[];c.querySelectorAll('.gc-row').forEach(function(r){var s=r.querySelectorAll('span');if(s.length>=2)l.push(s[0].textContent+': '+s[1].textContent)});return'🪪 بطاقة ضيف\n'+l.join('\n')+'\nأهلاً وسهلاً 🌟'}
function shareCard(k){var t=cardText(k);if(navigator.share)navigator.share({title:'بطاقة ضيف',text:t}).catch(function(){});else if(navigator.clipboard)navigator.clipboard.writeText(t).then(function(){showToast('✅ تم النسخ')});else alert(t)}
function printOne(k){document.querySelectorAll('.guest-card').forEach(function(el){el.style.display=el.dataset.key===k?'':'none'});window.print();setTimeout(function(){document.querySelectorAll('.guest-card').forEach(function(el){el.style.display=''})},500)}
function printSel(){var ks=Object.keys(selectedCards).filter(function(k){return selectedCards[k]});if(!ks.length){alert('اختر كارت واحد على الأقل');return}document.querySelectorAll('.guest-card').forEach(function(el){el.style.display=selectedCards[el.dataset.key]?'':'none'});window.print();setTimeout(function(){document.querySelectorAll('.guest-card').forEach(function(el){el.style.display=''})},500)}

// ═══════════════════════════════════════════════════════
// TAB 5: SETTINGS
// ═══════════════════════════════════════════════════════
function renderSettings(){
  var current = getCurrentConference();
  var h='<div class="card"><div class="card-title">⚙️ إعدادات الحدث</div>';
  h+='<div class="row" style="margin-bottom:10px">';
  h+='<div style="flex:2"><label class="lbl">اسم الحدث / المؤتمر</label><input id="cfg_name" value="'+esc(conf.name||'')+'" placeholder="اسم المؤتمر"></div>';
  h+='<div style="flex:1"><label class="lbl">عدد أيام الإقامة</label><input id="cfg_days" type="number" min="1" max="30" value="'+(conf.days||1)+'"></div>';
  h+='</div>';
  h+='<div class="row" style="margin-bottom:10px">';
  h+='<div style="flex:1"><label class="lbl">تاريخ البداية</label><input id="cfg_start" type="date" value="'+(conf.startDate||'')+'"></div>';
  h+='<div style="flex:1"><label class="lbl">تاريخ النهاية</label><input id="cfg_end" type="date" value="'+(conf.endDate||'')+'"></div>';
  h+='</div>';
  h+='<div class="row" style="margin-bottom:10px;gap:8px">';
  h+='<button class="btn btn-green" onclick="saveSettings()">💾 حفظ الإعدادات</button>';
  h+='<button class="btn btn-blue" onclick="createNewConference()">➕ مؤتمر جديد</button>';
  h+='<button class="btn btn-purple" onclick="saveTemplate()">✳️ حفظ قالب</button>';
  h+='<button class="btn btn-orange" onclick="archiveCurrentConference()">🗄️ أرشفة</button>';
  h+='<button class="btn btn-gray" onclick="backupAppData()">🔁 نسخة احتياطية</button>';
  h+='</div>';
  h+='</div>';
  h+=renderHouseSettings();
  h+='<div class="card"><div class="card-title">📌 المؤتمر الحالي</div>';
  h+='<div class="row" style="margin-bottom:10px;gap:8px">';
  h+='<div style="flex:1"><label class="lbl">اختر مؤتمر</label><select id="conf_select" onchange="setCurrentConferenceById(this.value)">';
  appData.conferences.forEach(function(c){
    h+='<option value="'+c.id+'"'+(current&&c.id===current.id?' selected':'')+'>'+esc(c.name)+'</option>';
  });
  h+='</select></div>';
  h+='<div style="flex:1"><label class="lbl">المؤتمر الحالي</label><input readonly value="'+esc(current?current.name:'')+'" style="background:#F7FBFF"></div>';
  h+='</div>';
  h+='</div>';
  h+='<div class="card"><div class="card-title">🧾 القوالب</div>';
  if(appData.templates.length){
    h+='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">';
    appData.templates.forEach(function(t){
      h+='<button class="chip" onclick="applyTemplate(\''+t.id+'\')">'+esc(t.name)+'</button>';
    });
    h+='</div>';
  } else {
    h+='<div style="color:#AAB5C0;padding:12px;font-size:11px">لا توجد قوالب محفوظة</div>';
  }
  h+='</div>';
  h+='<div class="card"><div class="card-title">📦 الأرشيف</div>';
  if(appData.archives.length){
    h+='<div style="display:flex;flex-direction:column;gap:6px">';
    appData.archives.slice().reverse().forEach(function(a){
      h+='<div class="row" style="justify-content:space-between;padding:6px 8px;border:1px solid #EEF3F8;border-radius:9px">';
      h+='<div><div style="font-weight:700">'+esc(a.name)+'</div><div style="font-size:10px;color:#5a7a9a">'+esc(a.archivedAt)+'</div></div>';
      h+='<button class="btn btn-blue btn-sm" onclick="restoreArchive(\''+a.id+'\')">استعادة</button>';
      h+='</div>';
    });
    h+='</div>';
  } else {
    h+='<div style="color:#AAB5C0;padding:12px;font-size:11px">لا توجد محتويات في الأرشيف</div>';
  }
  h+='</div>';
  h+='<div class="card"><div class="card-title">💾 النسخ الاحتياطية</div>';
  if(appData.backups.length){
    h+='<div style="display:flex;flex-direction:column;gap:6px">';
    appData.backups.slice().reverse().forEach(function(b){
      h+='<div class="row" style="justify-content:space-between;padding:6px 8px;border:1px solid #EEF3F8;border-radius:9px">';
      h+='<div><div style="font-weight:700">'+esc(b.name)+'</div><div style="font-size:10px;color:#5a7a9a">'+esc(b.createdAt)+'</div></div>';
      h+='<button class="btn btn-blue btn-sm" onclick="restoreBackup(\''+b.id+'\')">استعادة</button>';
      h+='</div>';
    });
    h+='</div>';
  } else {
    h+='<div style="color:#AAB5C0;padding:12px;font-size:11px">لا توجد نسخ احتياطية بعد</div>';
  }
  h+='</div>';
  h+='<div class="card"><div class="card-title">📊 ملخص الحدث</div>';
  var ag=activeGuests();var days=getDays();
  h+='<div class="stats">';
  h+='<div class="stat-card" style="border-top:4px solid #1F4E79"><div class="stat-val" style="color:#1F4E79">'+days+'</div><div class="stat-lbl">📅 الأيام</div></div>';
  h+='<div class="stat-card" style="border-top:4px solid #27AE60"><div class="stat-val" style="color:#27AE60">'+(ag.adults.length+ag.children.length)+'</div><div class="stat-lbl">👥 إجمالي الأفراد</div></div>';
  h+='<div class="stat-card" style="border-top:4px solid #E67E22"><div class="stat-val" style="color:#E67E22">'+transports.length+'</div><div class="stat-lbl">🚌 وسائل مواصلات</div></div>';
  h+='</div>';
  // per-day attendance
  h+='<div style="margin-top:10px"><div style="font-size:12px;font-weight:700;color:#1F4E79;margin-bottom:6px">📈 الحضور اليومي</div>';
  for(var d=1;d<=days;d++){
    var p=personsOnDay(d);var total=p.adults+p.children;
    var pct=ag.adults.length+ag.children.length>0?Math.round(total/(ag.adults.length+ag.children.length)*100):0;
    h+='<div class="day-report-row" style="background:#EAF4FC">';
    h+='<div style="font-weight:700;min-width:50px">يوم '+d+'</div>';
    h+='<div style="flex:1;background:#BDD7EE;border-radius:6px;height:10px;overflow:hidden"><div style="background:#2E75B6;width:'+pct+'%;height:100%"></div></div>';
    h+='<div style="min-width:80px;text-align:left">'+total+' شخص ('+p.adults+' بالغ + '+p.children+' طفل)</div>';
    h+='</div>';
  }
  h+='</div></div>';
  ge('tab5').innerHTML=h;
}
function renderHouseSettings(){
  var current = getCurrentConference();
  if(!current) return '';
  var h = '<div class="card"><div class="card-title">🏠 إدارة البيوت</div>';
  if(current.houses.length){
    h += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">';
    current.houses.forEach(function(house){
      h += '<button class="chip" onclick="openHouseModal(\''+house.id+'\')">'+esc(house.name)+'</button>';
    });
    h += '</div>';
  } else {
    h += '<div style="color:#AAB5C0;padding:12px;font-size:11px">لا توجد بيوت</div>';
  }
  h += '<button class="btn btn-purple" onclick="openHouseModal(null)">➕ إضافة بيت</button>';
  h += '</div>';
  return h;
}

function saveSettings(){
  conf.name=ge('cfg_name').value.trim()||'المؤتمر';
  conf.days=parseInt(ge('cfg_days').value)||1;
  conf.startDate=ge('cfg_start').value;
  conf.endDate=ge('cfg_end').value;
  document.querySelector('.logo').textContent='🏨 '+conf.name;
  save();renderSettings();showToast('✅ تم حفظ الإعدادات');
}

// ═══════════════════════════════════════════════════════
// BULK ASSIGN
// ═══════════════════════════════════════════════════════
var bulkSelected = {}; // name -> true/false

function openBulkAssign(){
  bulkSelected = {};
  // populate transport select
  var sel = ge('bulk_trans');
  sel.innerHTML = '<option value="">— اختر —</option>';
  transports.forEach(function(t){
    var freeSeats = t.seats.filter(function(s){return !s.name}).length;
    var opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.icon + ' ' + t.name + ' (' + freeSeats + ' كرسي فارغ)';
    sel.appendChild(opt);
  });
  ge('bulk_guests').innerHTML = '<div style="color:#AAB5C0;text-align:center;padding:14px;font-size:11px">اختر وسيلة المواصلات أولاً</div>';
  ge('bulk_info').textContent = '';
  ge('bulk_count').textContent = '';
  ge('bulkModal').style.display = 'flex';
}
function closeBulk(){ ge('bulkModal').style.display = 'none'; }

function renderBulkGuests(){
  var tid = ge('bulk_trans').value;
  if(!tid){ ge('bulk_guests').innerHTML = ''; return; }
  var t = transports.find(function(x){ return x.id === tid; });
  if(!t) { ge('bulk_guests').innerHTML = ''; return; }
  var freeSeats = t.seats.filter(function(s){ return !s.name; }).length;
  var guests = unassigned(''); // all unassigned across all transports
  ge('bulk_info').textContent = 'كراسي فارغة: ' + freeSeats + ' | أفراد لم يُسكَّنوا: ' + guests.length;

  if(!guests.length){
    ge('bulk_guests').innerHTML = '<div style="color:#27AE60;text-align:center;padding:14px;font-size:11px">✅ كل الأفراد تم تسكينهم في مواصلات</div>';
    return;
  }
  // group by room
  var byRoom = {};
  guests.forEach(function(g){
    if(!byRoom[g.room]) byRoom[g.room] = [];
    byRoom[g.room].push(g);
  });
  var h = '';
  Object.keys(byRoom).sort().forEach(function(roomNum){
    h += '<div style="font-size:10px;font-weight:700;color:#1F4E79;margin:6px 0 3px;padding:3px 5px;background:#EAF4FC;border-radius:5px">🏨 غرفة ' + esc(roomNum) + '</div>';
    byRoom[roomNum].forEach(function(g){
      var checked = bulkSelected[g.name] !== false; // default selected
      if(bulkSelected[g.name] === undefined) bulkSelected[g.name] = true;
      h += '<label style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;cursor:pointer;margin-bottom:2px;background:'+(checked?'#D5F5E3':'#F8F9FA')+';border:1px solid '+(checked?'#27AE60':'#E0E0E0')+'" id="blbl_'+esc(g.name.replace(/\s/g,'_'))+'">';
      h += '<input type="checkbox" '+(checked?'checked':'')+' style="width:auto" onchange="toggleBulk(\''+esc(g.name)+'\',this.checked)">';
      h += '<span style="font-size:12px;font-weight:'+(checked?'700':'400')+'">'+(g.guardian?'🧒':'👤')+' '+esc(g.name)+'</span>';
      if(g.guardian) h += '<span style="font-size:9px;color:#7D4E00">مع '+esc(g.guardian)+'</span>';
      h += '</label>';
    });
  });
  ge('bulk_guests').innerHTML = h;
  updateBulkCount();
}

function toggleBulk(name, val){
  bulkSelected[name] = val;
  updateBulkCount();
}
function bulkSelectAll(val){
  Object.keys(bulkSelected).forEach(function(k){ bulkSelected[k] = val; });
  // re-render list preserving structure
  renderBulkGuests();
  // restore selection state
  Object.keys(bulkSelected).forEach(function(k){ bulkSelected[k] = val; });
  ge('bulk_guests').querySelectorAll('input[type="checkbox"]').forEach(function(cb){ cb.checked = val; });
  ge('bulk_guests').querySelectorAll('label').forEach(function(lbl){
    lbl.style.background = val ? '#D5F5E3' : '#F8F9FA';
    lbl.style.border = '1px solid ' + (val ? '#27AE60' : '#E0E0E0');
    var sp = lbl.querySelector('span');
    if(sp) sp.style.fontWeight = val ? '700' : '400';
  });
  updateBulkCount();
}
function updateBulkCount(){
  var n = Object.keys(bulkSelected).filter(function(k){ return bulkSelected[k]; }).length;
  ge('bulk_count').textContent = n + ' محدد';
}

function doBulkAssign(){
  var tid = ge('bulk_trans').value;
  if(!tid){ alert('اختر وسيلة مواصلات'); return; }
  var t = transports.find(function(x){ return x.id === tid; });
  if(!t) return;
  var toAssign = unassigned('').filter(function(g){ return bulkSelected[g.name]; });
  if(!toAssign.length){ alert('لم تحدد أي أسماء'); return; }
  var freeSeats = t.seats.filter(function(s){ return !s.name; });
  if(freeSeats.length < toAssign.length){
    if(!window.confirm('الكراسي الفارغة ('+freeSeats.length+') أقل من المحدد ('+toAssign.length+'). سيُسكَّن أول '+freeSeats.length+' فقط. تأكيد؟')) return;
    toAssign = toAssign.slice(0, freeSeats.length);
  }
  var assigned = 0;
  toAssign.forEach(function(g){
    var seat = freeSeats[assigned];
    if(!seat) return;
    seat.name = g.name;
    seat.room = g.room;
    seat.type = g.guardian ? 'child_seat' : 'adult';
    seat.note = '';
    assigned++;
  });
  closeBulk();
  save();
  renderTransports();
  showToast('⚡ تم تسكين ' + assigned + ' شخص تلقائياً', '#1F4E79');
}

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
//__S__
//__E__
try{load();renderRooms();}catch(e){alert('خطأ: '+e.message)}
