(function(global){
  'use strict';
  var MODAL_ID='conferenceTemplateHousesEditorModal';
  var BODY_ID='conferenceTemplateHousesEditorBody';
  global.editingConferenceTemplateId=null;

  function clone(value){
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function esc(value){
    return String(value==null?'':value).replace(/&/g,'&amp;')
      .replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function uid(){
    return typeof global.uid==='function'?global.uid():
      'cthe-'+Date.now()+'-'+Math.random().toString(16).slice(2);
  }
  function findTemplate(templateId){
    var values=global.appData&&Array.isArray(global.appData.templates)
      ?global.appData.templates:[];
    return values.find(function(template){
      return template&&String(template.id)===String(templateId);
    })||null;
  }
  function close(){
    global.editingConferenceTemplateId=null;
    var modal=global.document&&global.document.getElementById(MODAL_ID);
    if(modal)modal.style.display='none';
    return true;
  }
  function currentTemplate(){
    var template=findTemplate(global.editingConferenceTemplateId);
    if(!template)close();
    return template;
  }
  function templateHouses(template){
    return template&&template.data&&Array.isArray(template.data.houses)
      ?template.data.houses:[];
  }
  function findHouse(template,houseId){
    return templateHouses(template).find(function(house){
      return house&&String(house.id)===String(houseId);
    })||null;
  }
  function findFloor(house,floorId){
    return (house&&Array.isArray(house.floors)?house.floors:[])
      .find(function(floor){return floor&&String(floor.id)===String(floorId);})||null;
  }
  function findRoom(floor,roomId){
    return (floor&&Array.isArray(floor.rooms)?floor.rooms:[])
      .find(function(room){return room&&String(room.id)===String(roomId);})||null;
  }
  function ensureHouses(template){
    if(!template||!template.data||typeof template.data!=='object'||
      Array.isArray(template.data))return false;
    if(!Array.isArray(template.data.houses))template.data.houses=[];
    return true;
  }
  function persist(){
    return typeof global.save==='function'&&
      global.save({skipCurrentConferenceUpdate:true,
        skipConferenceTracking:true,skipSyncQueue:true})!==false;
  }
  function mutate(operation){
    var template=currentTemplate();
    if(!template||!ensureHouses(template))return false;
    var before=clone(template.data.houses);
    if(operation(template)===false)return false;
    if(!persist()){
      template.data.houses=before;
      return false;
    }
    render();
    return true;
  }
  function normalizeRoom(input,existing){
    input=input||{};
    var beds=parseInt(input.beds,10);
    var extraBeds=parseInt(input.extraBeds,10);
    var closed=input.closed===true;
    var closedDay=input.closedDay===''||input.closedDay==null
      ?null:parseInt(input.closedDay,10);
    if(!String(input.number||'').trim()||!Number.isInteger(beds)||beds<1||
      !Number.isInteger(extraBeds)||extraBeds<0||
      (closed&&closedDay!==null&&(!Number.isInteger(closedDay)||closedDay<1))){
      return null;
    }
    var value={id:existing&&existing.id||uid(),number:String(input.number).trim(),
      beds:beds,extraBeds:extraBeds,notes:String(input.notes||'').trim(),
      closed:closed,closedDay:closed?closedDay:null};
    if(!existing){value.guests=[];value.children=[];}
    return value;
  }
  function ensureModal(){
    if(!global.document||!global.document.body)return null;
    var modal=global.document.getElementById(MODAL_ID);
    if(modal)return modal;
    modal=global.document.createElement('div');
    modal.id=MODAL_ID;
    modal.className='overlay app-modal';
    modal.style.display='none';
    modal.innerHTML='<div class="modal" style="max-width:900px">'+
      '<div class="mhead"><span>إدارة بيوت وغرف القالب</span>'+
      '<span style="cursor:pointer" onclick="ConferenceTemplateHousesEditor.close()">✕</span></div>'+
      '<div class="mbody"><div id="'+BODY_ID+'"></div>'+
      '<button class="btn btn-gray" style="margin-top:12px" '+
      'onclick="ConferenceTemplateHousesEditor.close()">إغلاق</button></div></div>';
    modal.onclick=function(event){if(event.target===modal)close();};
    global.document.body.appendChild(modal);
    return modal;
  }
  function open(templateId){
    var template=findTemplate(templateId);
    if(!template||!template.data||typeof template.data!=='object'){
      close();return false;
    }
    global.editingConferenceTemplateId=template.id;
    var modal=ensureModal();
    if(!modal){close();return false;}
    render();
    modal.style.display='flex';
    return true;
  }
  function handleTemplateDeleted(templateId){
    if(String(global.editingConferenceTemplateId||'')===String(templateId||''))close();
  }
  function addHouse(input){
    var name=String(input&&input.name||'').trim();
    if(!name)return false;
    return mutate(function(template){template.data.houses.push({
      id:uid(),name:name,description:String(input.description||'').trim(),floors:[]
    });});
  }
  function updateHouse(houseId,input){
    var name=String(input&&input.name||'').trim();
    if(!name)return false;
    return mutate(function(template){
      var house=findHouse(template,houseId);if(!house)return false;
      house.name=name;house.description=String(input.description||'').trim();
    });
  }
  function removeHouse(houseId,confirmed){
    if(confirmed!==true&&!global.confirm('حذف البيت بكل أدواره وغرفه من القالب فقط؟'))return false;
    return mutate(function(template){
      var count=template.data.houses.length;
      template.data.houses=template.data.houses.filter(function(house){
        return String(house.id)!==String(houseId);
      });
      return template.data.houses.length!==count;
    });
  }
  function addFloor(houseId,input){
    var name=String(input&&input.name||'').trim();if(!name)return false;
    return mutate(function(template){
      var house=findHouse(template,houseId);if(!house)return false;
      house.floors=Array.isArray(house.floors)?house.floors:[];
      house.floors.push({id:uid(),name:name,rooms:[]});
    });
  }
  function updateFloor(houseId,floorId,input){
    var name=String(input&&input.name||'').trim();if(!name)return false;
    return mutate(function(template){
      var floor=findFloor(findHouse(template,houseId),floorId);
      if(!floor)return false;floor.name=name;
    });
  }
  function removeFloor(houseId,floorId,confirmed){
    if(confirmed!==true&&!global.confirm('حذف الدور بكل غرفه من القالب فقط؟'))return false;
    return mutate(function(template){
      var house=findHouse(template,houseId);
      if(!house||!Array.isArray(house.floors))return false;
      var count=house.floors.length;
      house.floors=house.floors.filter(function(floor){
        return String(floor.id)!==String(floorId);
      });
      return house.floors.length!==count;
    });
  }
  function addRoom(houseId,floorId,input){
    var room=normalizeRoom(input,null);if(!room)return false;
    return mutate(function(template){
      var floor=findFloor(findHouse(template,houseId),floorId);
      if(!floor)return false;
      floor.rooms=Array.isArray(floor.rooms)?floor.rooms:[];floor.rooms.push(room);
    });
  }
  function updateRoom(houseId,floorId,roomId,input){
    return mutate(function(template){
      var floor=findFloor(findHouse(template,houseId),floorId);
      var room=findRoom(floor,roomId),value=normalizeRoom(input,room);
      if(!room||!value)return false;
      Object.keys(value).forEach(function(key){room[key]=value[key];});
    });
  }
  function removeRoom(houseId,floorId,roomId,confirmed){
    if(confirmed!==true&&!global.confirm('حذف الغرفة من القالب فقط؟'))return false;
    return mutate(function(template){
      var floor=findFloor(findHouse(template,houseId),floorId);
      if(!floor||!Array.isArray(floor.rooms))return false;
      var count=floor.rooms.length;
      floor.rooms=floor.rooms.filter(function(room){
        return String(room.id)!==String(roomId);
      });
      return floor.rooms.length!==count;
    });
  }
  function ask(message,value){return global.prompt?global.prompt(message,value||''):null;}
  function promptAddHouse(){
    var name=ask('اسم البيت:','');if(name===null)return false;
    var description=ask('وصف البيت:','');
    return description===null?false:addHouse({name:name,description:description});
  }
  function promptEditHouse(houseId){
    var house=findHouse(currentTemplate(),houseId);if(!house)return false;
    var name=ask('اسم البيت:',house.name||'');if(name===null)return false;
    var description=ask('وصف البيت:',house.description||'');
    return description===null?false:updateHouse(houseId,{name:name,description:description});
  }
  function promptAddFloor(houseId){var name=ask('اسم الدور:','');return name===null?false:addFloor(houseId,{name:name});}
  function promptEditFloor(houseId,floorId){
    var floor=findFloor(findHouse(currentTemplate(),houseId),floorId);if(!floor)return false;
    var name=ask('اسم الدور:',floor.name||'');return name===null?false:updateFloor(houseId,floorId,{name:name});
  }
  function roomInput(room){
    room=room||{};
    var number=ask('رقم الغرفة:',room.number||'');if(number===null)return null;
    var beds=ask('عدد الأسرة:',room.beds||1);if(beds===null)return null;
    var extraBeds=ask('الأسرة الإضافية:',room.extraBeds||0);if(extraBeds===null)return null;
    var notes=ask('الملاحظات:',room.notes||'');if(notes===null)return null;
    var closed=global.confirm('هل الغرفة مغلقة؟');
    var closedDay=closed?ask('مغلقة من يوم:',room.closedDay||''):null;
    return closed&&closedDay===null?null:{number:number,beds:beds,
      extraBeds:extraBeds,notes:notes,closed:closed,closedDay:closedDay};
  }
  function promptAddRoom(houseId,floorId){var input=roomInput(null);return input?addRoom(houseId,floorId,input):false;}
  function promptEditRoom(houseId,floorId,roomId){
    var room=findRoom(findFloor(findHouse(currentTemplate(),houseId),floorId),roomId);
    var input=room&&roomInput(room);return input?updateRoom(houseId,floorId,roomId,input):false;
  }
  function render(){
    var template=currentTemplate();
    var container=global.document&&global.document.getElementById(BODY_ID);
    if(!template||!container)return '';
    var html='<strong>'+esc(template.name||'قالب مؤتمر')+'</strong> '+
      '<button class="btn btn-purple btn-sm" onclick="ConferenceTemplateHousesEditor.promptAddHouse()">إضافة بيت</button>';
    var values=templateHouses(template);
    if(!values.length)html+='<div class="settings-empty-state">لا توجد بيوت في القالب.</div>';
    values.forEach(function(house){
      html+='<div class="card" style="margin-top:10px"><div class="card-title">🏠 '+esc(house.name)+'</div>'+
        '<div>'+esc(house.description||'')+'</div><div class="row" style="gap:6px">'+
        '<button class="btn btn-gray btn-sm" onclick="ConferenceTemplateHousesEditor.promptEditHouse(\''+esc(house.id)+'\')">تعديل البيت</button>'+
        '<button class="btn btn-purple btn-sm" onclick="ConferenceTemplateHousesEditor.promptAddFloor(\''+esc(house.id)+'\')">إضافة دور</button>'+
        '<button class="btn btn-red btn-sm" onclick="ConferenceTemplateHousesEditor.removeHouse(\''+esc(house.id)+'\')">حذف البيت</button></div>';
      var floors=Array.isArray(house.floors)?house.floors:[];
      if(!floors.length)html+='<div class="settings-empty-state">لا توجد أدوار داخل البيت.</div>';
      floors.forEach(function(floor){
        html+='<div style="border:1px solid #E5EEF7;border-radius:10px;padding:8px;margin-top:8px"><strong>'+esc(floor.name)+'</strong><div class="row" style="gap:6px">'+
          '<button class="btn btn-gray btn-sm" onclick="ConferenceTemplateHousesEditor.promptEditFloor(\''+esc(house.id)+'\',\''+esc(floor.id)+'\')">تعديل الدور</button>'+
          '<button class="btn btn-blue btn-sm" onclick="ConferenceTemplateHousesEditor.promptAddRoom(\''+esc(house.id)+'\',\''+esc(floor.id)+'\')">إضافة غرفة</button>'+
          '<button class="btn btn-red btn-sm" onclick="ConferenceTemplateHousesEditor.removeFloor(\''+esc(house.id)+'\',\''+esc(floor.id)+'\')">حذف الدور</button></div>';
        var rooms=Array.isArray(floor.rooms)?floor.rooms:[];
        if(!rooms.length)html+='<div class="settings-empty-state">لا توجد غرف داخل الدور.</div>';
        rooms.forEach(function(room){
          html+='<div class="settings-list-item"><div><strong>غرفة '+esc(room.number)+'</strong><div style="font-size:10px">'+esc(room.beds||1)+' سرير، إضافي '+esc(room.extraBeds||0)+(room.closed?'، مغلقة'+(room.closedDay?' من يوم '+esc(room.closedDay):''):'')+'</div></div><div class="row" style="gap:6px">'+
            '<button class="btn btn-gray btn-sm" onclick="ConferenceTemplateHousesEditor.promptEditRoom(\''+esc(house.id)+'\',\''+esc(floor.id)+'\',\''+esc(room.id)+'\')">تعديل</button>'+
            '<button class="btn btn-red btn-sm" onclick="ConferenceTemplateHousesEditor.removeRoom(\''+esc(house.id)+'\',\''+esc(floor.id)+'\',\''+esc(room.id)+'\')">حذف</button></div></div>';
        });
        html+='</div>';
      });
      html+='</div>';
    });
    container.innerHTML=html;return html;
  }

  global.ConferenceTemplateHousesEditor=Object.freeze({
    open:open,close:close,render:render,handleTemplateDeleted:handleTemplateDeleted,
    addHouse:addHouse,updateHouse:updateHouse,removeHouse:removeHouse,
    addFloor:addFloor,updateFloor:updateFloor,removeFloor:removeFloor,
    addRoom:addRoom,updateRoom:updateRoom,removeRoom:removeRoom,
    promptAddHouse:promptAddHouse,promptEditHouse:promptEditHouse,
    promptAddFloor:promptAddFloor,promptEditFloor:promptEditFloor,
    promptAddRoom:promptAddRoom,promptEditRoom:promptEditRoom,
    getState:function(){return {editingConferenceTemplateId:global.editingConferenceTemplateId};}
  });
})(window);
