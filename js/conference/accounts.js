function getDefaultConferenceAccounts(){
  return {
    version:'1.0',
    settings:{
      currency:'EGP',
      roundingPrecision:2,
      accommodationDefaults:{
        enabled:true,
        calculationMethod:'selected_rooms',
        timeUnit:'day',
        durationMode:'conference',
        includeClosedRooms:false,
        roomRate:null,
        personRate:null,
        extraBedRate:null,
        roomTypeRates:getDefaultAccommodationRoomTypeRates()
      },
      airConditioningDefaults:{
        enabled:false,
        calculationMethod:'per_room',
        timeUnit:'day',
        durationMode:'conference',
        includeClosedRooms:false,
        roomRate:null,
        unitRate:null,
        personRate:null
      },
      mealsDefaults:{
        enabled:true,
        calculationMode:'restaurant_prices',
        includeBreakfast:true,
        includeLunch:true,
        includeDinner:true,
        adultBreakfastPrice:null,
        childBreakfastPrice:null,
        adultLunchPrice:null,
        childLunchPrice:null,
        adultDinnerPrice:null,
        childDinnerPrice:null
      }
    },
    expenses:{
      accommodation:{
        enabled:true,
        houses:{}
      },
      airConditioning:{
        enabled:false,
        houses:{}
      },
      meals:{
        enabled:true,
        dayOverrides:{},
        manualTotal:null,
        notes:''
      },
      additional:[]
    },
    financialItems:{
      enabled:true,
      items:[]
    },
    incomeItems:{
      enabled:true,
      items:[]
    },
    settlements:{
      enabled:true,
      items:[]
    },
    adjustments:[],
    notes:''
  };
}

function normalizeConferenceAccounts(conference){
  if(!conference)return null;
  if(!conference.accounts||typeof conference.accounts!=='object'||Array.isArray(conference.accounts)){
    conference.accounts=getDefaultConferenceAccounts();
    return conference.accounts;
  }
  var accounts=conference.accounts;
  accounts.version=accounts.version||'1.0';
  accounts.settings=accounts.settings&&typeof accounts.settings==='object'&&!Array.isArray(accounts.settings)?accounts.settings:{};
  if(accounts.settings.currency===undefined||accounts.settings.currency===null)accounts.settings.currency='EGP';
  if(accounts.settings.roundingPrecision===undefined||accounts.settings.roundingPrecision===null)accounts.settings.roundingPrecision=2;
  var defaults=accounts.settings.accommodationDefaults;
  if(!defaults||typeof defaults!=='object'||Array.isArray(defaults)){
    defaults={};
    accounts.settings.accommodationDefaults=defaults;
  }
  if(defaults.enabled===undefined||defaults.enabled===null)defaults.enabled=true;
  if(defaults.calculationMethod===undefined||defaults.calculationMethod===null)defaults.calculationMethod='selected_rooms';
  if(defaults.timeUnit===undefined||defaults.timeUnit===null)defaults.timeUnit='day';
  if(defaults.durationMode===undefined||defaults.durationMode===null)defaults.durationMode='conference';
  if(defaults.includeClosedRooms===undefined||defaults.includeClosedRooms===null)defaults.includeClosedRooms=false;
  if(defaults.roomRate===undefined)defaults.roomRate=null;
  if(defaults.personRate===undefined)defaults.personRate=null;
  if(defaults.extraBedRate===undefined)defaults.extraBedRate=null;
  defaults.roomTypeRates=normalizeAccommodationRoomTypeRates(defaults.roomTypeRates);
  var airDefaults=accounts.settings.airConditioningDefaults;
  if(!airDefaults||typeof airDefaults!=='object'||Array.isArray(airDefaults)){
    airDefaults={};
    accounts.settings.airConditioningDefaults=airDefaults;
  }
  if(airDefaults.enabled===undefined||airDefaults.enabled===null)airDefaults.enabled=false;
  if(airDefaults.calculationMethod===undefined||airDefaults.calculationMethod===null)airDefaults.calculationMethod='per_room';
  if(airDefaults.timeUnit===undefined||airDefaults.timeUnit===null)airDefaults.timeUnit='day';
  if(airDefaults.durationMode===undefined||airDefaults.durationMode===null)airDefaults.durationMode='conference';
  if(airDefaults.includeClosedRooms===undefined||airDefaults.includeClosedRooms===null)airDefaults.includeClosedRooms=false;
  if(airDefaults.roomRate===undefined)airDefaults.roomRate=null;
  if(airDefaults.unitRate===undefined)airDefaults.unitRate=null;
  if(airDefaults.personRate===undefined)airDefaults.personRate=null;
  var mealsDefaults=accounts.settings.mealsDefaults;
  if(!mealsDefaults||typeof mealsDefaults!=='object'||Array.isArray(mealsDefaults)){
    mealsDefaults={};
    accounts.settings.mealsDefaults=mealsDefaults;
  }
  if(mealsDefaults.enabled===undefined||mealsDefaults.enabled===null)mealsDefaults.enabled=true;
  if(mealsDefaults.calculationMode===undefined||mealsDefaults.calculationMode===null)mealsDefaults.calculationMode='restaurant_prices';
  if(mealsDefaults.includeBreakfast===undefined||mealsDefaults.includeBreakfast===null)mealsDefaults.includeBreakfast=true;
  if(mealsDefaults.includeLunch===undefined||mealsDefaults.includeLunch===null)mealsDefaults.includeLunch=true;
  if(mealsDefaults.includeDinner===undefined||mealsDefaults.includeDinner===null)mealsDefaults.includeDinner=true;
  ['adultBreakfastPrice','childBreakfastPrice','adultLunchPrice','childLunchPrice','adultDinnerPrice','childDinnerPrice'].forEach(function(key){
    if(mealsDefaults[key]===undefined)mealsDefaults[key]=null;
  });
  accounts.expenses=accounts.expenses&&typeof accounts.expenses==='object'&&!Array.isArray(accounts.expenses)?accounts.expenses:{};
  accounts.expenses.accommodation=accounts.expenses.accommodation&&typeof accounts.expenses.accommodation==='object'&&!Array.isArray(accounts.expenses.accommodation)?accounts.expenses.accommodation:{};
  if(accounts.expenses.accommodation.enabled===undefined||accounts.expenses.accommodation.enabled===null)accounts.expenses.accommodation.enabled=true;
  if(!accounts.expenses.accommodation.houses||typeof accounts.expenses.accommodation.houses!=='object'||Array.isArray(accounts.expenses.accommodation.houses))accounts.expenses.accommodation.houses={};
  Object.keys(accounts.expenses.accommodation.houses).forEach(function(houseId){
    accounts.expenses.accommodation.houses[houseId]=normalizeAccommodationHouseSettings(accounts.expenses.accommodation.houses[houseId]);
  });
  accounts.expenses.airConditioning=accounts.expenses.airConditioning&&typeof accounts.expenses.airConditioning==='object'&&!Array.isArray(accounts.expenses.airConditioning)?accounts.expenses.airConditioning:{};
  if(accounts.expenses.airConditioning.enabled===undefined||accounts.expenses.airConditioning.enabled===null)accounts.expenses.airConditioning.enabled=false;
  if(!accounts.expenses.airConditioning.houses||typeof accounts.expenses.airConditioning.houses!=='object'||Array.isArray(accounts.expenses.airConditioning.houses))accounts.expenses.airConditioning.houses={};
  accounts.expenses.meals=accounts.expenses.meals&&typeof accounts.expenses.meals==='object'&&!Array.isArray(accounts.expenses.meals)?accounts.expenses.meals:{};
  if(accounts.expenses.meals.enabled===undefined||accounts.expenses.meals.enabled===null)accounts.expenses.meals.enabled=true;
  if(!accounts.expenses.meals.dayOverrides||typeof accounts.expenses.meals.dayOverrides!=='object'||Array.isArray(accounts.expenses.meals.dayOverrides))accounts.expenses.meals.dayOverrides={};
  if(accounts.expenses.meals.manualTotal===undefined)accounts.expenses.meals.manualTotal=null;
  if(accounts.expenses.meals.notes===undefined||accounts.expenses.meals.notes===null)accounts.expenses.meals.notes='';
  accounts.expenses.additional=Array.isArray(accounts.expenses.additional)?accounts.expenses.additional:[];
  accounts.financialItems=normalizeFinancialItems(accounts.financialItems);
  accounts.incomeItems=normalizeIncomeItems(accounts.incomeItems);
  accounts.settlements=normalizeSettlements(accounts.settlements);
  accounts.adjustments=Array.isArray(accounts.adjustments)?accounts.adjustments:[];
  accounts.notes=accounts.notes===undefined||accounts.notes===null?'':String(accounts.notes);
  return accounts;
}

function getDefaultFinancialItem(){
  return {
    id:'',
    type:'expense',
    category:'additional',
    name:'',
    enabled:true,
    calculationMethod:'fixed',
    quantity:null,
    unitPrice:null,
    amount:null,
    notes:''
  };
}

function getSupportedFinancialItemMethods(){
  return ['fixed','quantity_price','per_day','per_room','per_person','manual'];
}

function normalizeFinancialItemNumber(value){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  var number=Number(value);
  return isFinite(number)&&number>=0?number:null;
}

function normalizeFinancialItem(item){
  if(!item||typeof item!=='object'||Array.isArray(item))return null;
  var normalized=getDefaultFinancialItem();
  normalized.id=String(item.id||uid());
  normalized.type=item.type==='expense'?'expense':'expense';
  normalized.category=item.category==='additional'?'additional':'additional';
  normalized.name=item.name===undefined||item.name===null?'':String(item.name);
  normalized.enabled=item.enabled===false?false:true;
  normalized.calculationMethod=getSupportedFinancialItemMethods().indexOf(item.calculationMethod)!==-1
    ?item.calculationMethod
    :'fixed';
  normalized.quantity=normalizeFinancialItemNumber(item.quantity);
  normalized.unitPrice=normalizeFinancialItemNumber(item.unitPrice);
  normalized.amount=normalizeFinancialItemNumber(item.amount);
  normalized.notes=item.notes===undefined||item.notes===null?'':String(item.notes);
  return normalized;
}

function normalizeFinancialItems(settings){
  settings=settings&&typeof settings==='object'&&!Array.isArray(settings)?settings:{};
  var items=Array.isArray(settings.items)?settings.items:[];
  return {
    enabled:settings.enabled===false?false:true,
    items:items.map(normalizeFinancialItem).filter(function(item){return !!item})
  };
}

function getFinancialItemsSettings(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  if(!conference)return null;
  return normalizeConferenceAccounts(conference).financialItems;
}

function getDefaultIncomeItem(){
  return {
    id:'',
    type:'income',
    category:'general',
    name:'',
    enabled:true,
    calculationMethod:'fixed',
    quantity:null,
    unitPrice:null,
    amount:null,
    notes:''
  };
}

function normalizeIncomeItem(item){
  if(!item||typeof item!=='object'||Array.isArray(item))return null;
  var normalized=getDefaultIncomeItem();
  normalized.id=String(item.id||uid());
  normalized.type='income';
  normalized.category='general';
  normalized.name=item.name===undefined||item.name===null?'':String(item.name);
  normalized.enabled=item.enabled===false?false:true;
  normalized.calculationMethod=getSupportedFinancialItemMethods().indexOf(item.calculationMethod)!==-1
    ?item.calculationMethod
    :'fixed';
  normalized.quantity=normalizeFinancialItemNumber(item.quantity);
  normalized.unitPrice=normalizeFinancialItemNumber(item.unitPrice);
  normalized.amount=normalizeFinancialItemNumber(item.amount);
  normalized.notes=item.notes===undefined||item.notes===null?'':String(item.notes);
  return normalized;
}

function normalizeIncomeItems(settings){
  settings=settings&&typeof settings==='object'&&!Array.isArray(settings)?settings:{};
  var items=Array.isArray(settings.items)?settings.items:[];
  return {
    enabled:settings.enabled===false?false:true,
    items:items.map(normalizeIncomeItem).filter(function(item){return !!item})
  };
}

function getIncomeItemsSettings(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  if(!conference)return null;
  return normalizeConferenceAccounts(conference).incomeItems;
}

function getDefaultSettlementItem(){
  return {
    id:'',
    target:'expense',
    operation:'add',
    name:'',
    enabled:true,
    calculationMethod:'fixed',
    quantity:null,
    unitPrice:null,
    amount:null,
    notes:''
  };
}

function normalizeSettlementItem(item){
  if(!item||typeof item!=='object'||Array.isArray(item))return null;
  var normalized=getDefaultSettlementItem();
  normalized.id=String(item.id||uid());
  normalized.target=item.target==='income'?'income':'expense';
  normalized.operation=item.operation==='subtract'?'subtract':'add';
  normalized.name=item.name===undefined||item.name===null?'':String(item.name);
  normalized.enabled=item.enabled===false?false:true;
  normalized.calculationMethod=getSupportedFinancialItemMethods().indexOf(item.calculationMethod)!==-1
    ?item.calculationMethod
    :'fixed';
  normalized.quantity=normalized.calculationMethod==='quantity_price'
    ?normalizeFinancialItemNumber(item.quantity)
    :null;
  normalized.unitPrice=normalizeFinancialItemNumber(item.unitPrice);
  normalized.amount=normalizeFinancialItemNumber(item.amount);
  normalized.notes=item.notes===undefined||item.notes===null?'':String(item.notes);
  return normalized;
}

function normalizeSettlements(settings){
  settings=settings&&typeof settings==='object'&&!Array.isArray(settings)?settings:{};
  var items=Array.isArray(settings.items)?settings.items:[];
  return {
    enabled:settings.enabled===false?false:true,
    items:items.map(normalizeSettlementItem).filter(function(item){return !!item})
  };
}

function getSettlementsSettings(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  if(!conference)return null;
  return normalizeConferenceAccounts(conference).settlements;
}

function getAccommodationAccounts(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  if(!conference)return null;
  var accounts=normalizeConferenceAccounts(conference);
  return accounts&&accounts.expenses?accounts.expenses.accommodation:null;
}

function getAccommodationDefaults(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  if(!conference)return null;
  var accounts=normalizeConferenceAccounts(conference);
  return accounts&&accounts.settings?accounts.settings.accommodationDefaults:null;
}

function getAccommodationRoomTypeRateKeys(){
  return ['single','double','triple','quadruple','quintuple','sextuple','sevenPlus'];
}

function getAccommodationRoomTypeRateLabel(key){
  var labels={
    single:'سنجل',
    double:'دبل',
    triple:'ثلاثي',
    quadruple:'رباعي',
    quintuple:'خماسي',
    sextuple:'سداسي',
    sevenPlus:'سباعي فأكثر'
  };
  return labels[key]||key;
}

function toggleAccommodationRoomTypeRatesSection(sectionId,calculationMethod){
  var section=typeof ge==='function'?ge(sectionId):document.getElementById(sectionId);
  if(section)section.style.display=calculationMethod==='room_type'?'':'none';
}

function renderAccommodationRoomTypeRatesFields(options){
  options=options||{};
  var rates=options.rates||{};
  var resolvedRates=options.resolvedRates||rates;
  var rateSources=options.rateSources||{};
  var keys=options.keys||getAccommodationRoomTypeRateKeys();
  var html='<div id="'+options.sectionId+'" class="settings-section" style="margin:10px 0;'+(options.visible===false?'display:none;':'')+'">';
  html+='<div class="settings-section-title">'+(options.title||'أسعار أنواع الغرف')+'</div>';
  html+='<div class="settings-branding-grid">';
  keys.forEach(function(key){
    var inputId=options.inputPrefix+'_'+key;
    var label='سعر غرفة '+getAccommodationRoomTypeRateLabel(key);
    if(options.inherited){
      html+=renderInheritedAccountField({
        inputId:inputId,
        label:label,
        raw:rates[key],
        resolved:resolvedRates[key],
        displayValue:formatAccountMoney(resolvedRates[key]),
        source:rateSources[key],
        type:'number',
        inheritClass:options.inheritClass||'',
        inheritText:options.inheritText||'استخدام السعر الموروث'
      });
    }else{
      var value=rates[key]===null||rates[key]===undefined?'':rates[key];
      html+='<div class="settings-branding-field"><label class="lbl" for="'+inputId+'">'+label+'</label><input id="'+inputId+'" type="number" min="0" step="0.01" value="'+value+'" placeholder="غير محدد"></div>';
    }
  });
  html+='</div></div>';
  return html;
}

function readAccommodationRoomTypeRateInputs(inputPrefix,keys,useInheritance){
  var result={ok:true,values:{}};
  (keys||getAccommodationRoomTypeRateKeys()).forEach(function(key){
    var inputId=inputPrefix+'_'+key;
    var value=useInheritance
      ?readInheritedAccountValue(inputId,'number')
      :readNullableAccountNumber(inputId,'سعر غرفة '+getAccommodationRoomTypeRateLabel(key));
    if(!value.ok)result.ok=false;
    result.values[key]=value.value;
  });
  return result;
}

function getDefaultAccommodationRoomTypeRates(){
  return {
    single:null,
    double:null,
    triple:null,
    quadruple:null,
    quintuple:null,
    sextuple:null,
    sevenPlus:null
  };
}

function normalizeAccommodationRoomTypeRate(value){
  if(value===null||value===undefined||value==='')return null;
  if(typeof value==='string'&&!value.trim())return null;
  var number=Number(value);
  return isFinite(number)&&number>=0?number:null;
}

function normalizeAccommodationRoomTypeRates(rates){
  rates=rates&&typeof rates==='object'&&!Array.isArray(rates)?rates:{};
  var normalized=getDefaultAccommodationRoomTypeRates();
  getAccommodationRoomTypeRateKeys().forEach(function(key){
    normalized[key]=normalizeAccommodationRoomTypeRate(rates[key]);
  });
  return normalized;
}

function normalizeAccommodationRoomSettings(settings){
  settings=settings&&typeof settings==='object'&&!Array.isArray(settings)?settings:getDefaultAccommodationRoomSettings();
  settings.overrides=settings.overrides&&typeof settings.overrides==='object'&&!Array.isArray(settings.overrides)?settings.overrides:{};
  settings.overrides.roomTypeRates=normalizeAccommodationRoomTypeRates(settings.overrides.roomTypeRates);
  return settings;
}

function normalizeAccommodationHouseSettings(settings){
  settings=settings&&typeof settings==='object'&&!Array.isArray(settings)?settings:getDefaultAccommodationHouseSettings();
  settings.overrides=settings.overrides&&typeof settings.overrides==='object'&&!Array.isArray(settings.overrides)?settings.overrides:{};
  settings.overrides.roomTypeRates=normalizeAccommodationRoomTypeRates(settings.overrides.roomTypeRates);
  settings.rooms=settings.rooms&&typeof settings.rooms==='object'&&!Array.isArray(settings.rooms)?settings.rooms:{};
  Object.keys(settings.rooms).forEach(function(roomId){
    settings.rooms[roomId]=normalizeAccommodationRoomSettings(settings.rooms[roomId]);
  });
  return settings;
}

function getDefaultAccommodationHouseSettings(){
  return {
    enabled:null,
    overrides:{
      calculationMethod:null,
      timeUnit:null,
      durationMode:null,
      includeClosedRooms:null,
      roomRate:null,
      personRate:null,
      extraBedRate:null,
      roomTypeRates:getDefaultAccommodationRoomTypeRates()
    },
    fixedAmount:null,
    manualTotal:null,
    rooms:{},
    notes:''
  };
}

function getDefaultAccommodationRoomSettings(){
  return {
    included:null,
    overrides:{
      calculationMethod:null,
      timeUnit:null,
      durationMode:null,
      roomRate:null,
      personRate:null,
      extraBedRate:null,
      roomTypeRates:getDefaultAccommodationRoomTypeRates()
    },
    manualTotal:null,
    notes:''
  };
}

function getAccommodationHouseSettings(houseId,createIfMissing){
  var accommodation=getAccommodationAccounts();
  if(!accommodation||!houseId)return null;
  var existing=accommodation.houses[houseId];
  if(existing&&typeof existing==='object'&&!Array.isArray(existing))return normalizeAccommodationHouseSettings(existing);
  if(createIfMissing!==true)return null;
  accommodation.houses[houseId]=normalizeAccommodationHouseSettings(getDefaultAccommodationHouseSettings());
  return accommodation.houses[houseId];
}

function getAccommodationRoomSettings(houseId,roomId,createIfMissing){
  if(!houseId||!roomId)return null;
  var houseSettings=getAccommodationHouseSettings(houseId,createIfMissing===true);
  if(!houseSettings)return null;
  if(!houseSettings.rooms||typeof houseSettings.rooms!=='object'||Array.isArray(houseSettings.rooms)){
    if(createIfMissing!==true)return null;
    houseSettings.rooms={};
  }
  var existing=houseSettings.rooms[roomId];
  if(existing&&typeof existing==='object'&&!Array.isArray(existing))return normalizeAccommodationRoomSettings(existing);
  if(createIfMissing!==true)return null;
  houseSettings.rooms[roomId]=normalizeAccommodationRoomSettings(getDefaultAccommodationRoomSettings());
  return houseSettings.rooms[roomId];
}

function resolveAccountSetting(roomValue,houseValue,defaultValue,systemFallback){
  if(roomValue!==null&&roomValue!==undefined)return {value:roomValue,source:'room'};
  if(houseValue!==null&&houseValue!==undefined)return {value:houseValue,source:'house'};
  if(defaultValue!==null&&defaultValue!==undefined)return {value:defaultValue,source:'default'};
  return {value:systemFallback,source:'system'};
}

function resolveAccommodationRoomTypeRates(roomRates,houseRates,defaultRates){
  roomRates=normalizeAccommodationRoomTypeRates(roomRates);
  houseRates=normalizeAccommodationRoomTypeRates(houseRates);
  defaultRates=normalizeAccommodationRoomTypeRates(defaultRates);
  var values={};
  var sources={};
  getAccommodationRoomTypeRateKeys().forEach(function(key){
    var resolved=resolveAccountSetting(roomRates[key],houseRates[key],defaultRates[key],0);
    values[key]=resolved.value;
    sources[key]=resolved.source;
  });
  return {values:values,sources:sources};
}

function resolveAccommodationHouseSettings(houseId){
  var defaults=getAccommodationDefaults()||{};
  var house=getAccommodationHouseSettings(houseId,false)||{};
  var overrides=house.overrides&&typeof house.overrides==='object'?house.overrides:{};
  var system={
    enabled:true,
    calculationMethod:'selected_rooms',
    timeUnit:'day',
    durationMode:'conference',
    includeClosedRooms:false,
    roomRate:0,
    personRate:0,
    extraBedRate:0
  };
  var keys=['enabled','calculationMethod','timeUnit','durationMode','includeClosedRooms','roomRate','personRate','extraBedRate'];
  var values={};
  var sources={};
  keys.forEach(function(key){
    var houseValue=key==='enabled'?house.enabled:overrides[key];
    var resolved=resolveAccountSetting(undefined,houseValue,defaults[key],system[key]);
    values[key]=resolved.value;
    sources[key]=resolved.source;
  });
  var roomTypeRates=resolveAccommodationRoomTypeRates(
    null,
    overrides.roomTypeRates,
    defaults.roomTypeRates
  );
  values.roomTypeRates=roomTypeRates.values;
  sources.roomTypeRates=roomTypeRates.sources;
  return {values:values,sources:sources};
}

function resolveAccommodationRoomSettings(houseId,roomId){
  var defaults=getAccommodationDefaults()||{};
  var house=getAccommodationHouseSettings(houseId,false)||{};
  var houseOverrides=house.overrides&&typeof house.overrides==='object'?house.overrides:{};
  var room=getAccommodationRoomSettings(houseId,roomId,false)||{};
  var roomOverrides=room.overrides&&typeof room.overrides==='object'?room.overrides:{};
  var system={
    enabled:true,
    calculationMethod:'selected_rooms',
    timeUnit:'day',
    durationMode:'conference',
    includeClosedRooms:false,
    roomRate:0,
    personRate:0,
    extraBedRate:0
  };
  var keys=['enabled','calculationMethod','timeUnit','durationMode','includeClosedRooms','roomRate','personRate','extraBedRate'];
  var values={};
  var sources={};
  keys.forEach(function(key){
    var roomValue=key==='enabled'||key==='includeClosedRooms'?undefined:roomOverrides[key];
    var houseValue=key==='enabled'?house.enabled:houseOverrides[key];
    var resolved=resolveAccountSetting(roomValue,houseValue,defaults[key],system[key]);
    values[key]=resolved.value;
    sources[key]=resolved.source;
  });
  var roomTypeRates=resolveAccommodationRoomTypeRates(
    roomOverrides.roomTypeRates,
    houseOverrides.roomTypeRates,
    defaults.roomTypeRates
  );
  values.roomTypeRates=roomTypeRates.values;
  sources.roomTypeRates=roomTypeRates.sources;
  values.included=room.included===true?true:(room.included===false?false:null);
  sources.included=room.included===true||room.included===false?'room':'system';
  return {values:values,sources:sources};
}

function getAccountSettingSourceLabel(source){
  var labels={room:'خاص بالغرفة',house:'خاص بالبيت','default':'الإعداد العام',system:'افتراضي النظام'};
  return labels[source]||'افتراضي النظام';
}

function getAirConditioningAccounts(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  if(!conference)return null;
  return normalizeConferenceAccounts(conference).expenses.airConditioning;
}

function getAirConditioningDefaults(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  if(!conference)return null;
  return normalizeConferenceAccounts(conference).settings.airConditioningDefaults;
}

function getDefaultAirConditioningHouseSettings(){
  return {
    enabled:null,
    overrides:{
      calculationMethod:null,
      timeUnit:null,
      durationMode:null,
      includeClosedRooms:null,
      roomRate:null,
      unitRate:null,
      personRate:null
    },
    unitsCount:null,
    fixedAmount:null,
    manualTotal:null,
    rooms:{},
    notes:''
  };
}

function getDefaultAirConditioningRoomSettings(){
  return {
    included:null,
    overrides:{
      calculationMethod:null,
      timeUnit:null,
      durationMode:null,
      roomRate:null,
      unitRate:null,
      personRate:null
    },
    unitsCount:null,
    manualTotal:null,
    notes:''
  };
}

function getAirConditioningHouseSettings(houseId,createIfMissing){
  var airConditioning=getAirConditioningAccounts();
  if(!airConditioning||!houseId)return null;
  var existing=airConditioning.houses[houseId];
  if(existing&&typeof existing==='object'&&!Array.isArray(existing))return existing;
  if(createIfMissing!==true)return null;
  airConditioning.houses[houseId]=getDefaultAirConditioningHouseSettings();
  return airConditioning.houses[houseId];
}

function getAirConditioningRoomSettings(houseId,roomId,createIfMissing){
  if(!houseId||!roomId)return null;
  var houseSettings=getAirConditioningHouseSettings(houseId,createIfMissing===true);
  if(!houseSettings)return null;
  if(!houseSettings.rooms||typeof houseSettings.rooms!=='object'||Array.isArray(houseSettings.rooms)){
    if(createIfMissing!==true)return null;
    houseSettings.rooms={};
  }
  var existing=houseSettings.rooms[roomId];
  if(existing&&typeof existing==='object'&&!Array.isArray(existing))return existing;
  if(createIfMissing!==true)return null;
  houseSettings.rooms[roomId]=getDefaultAirConditioningRoomSettings();
  return houseSettings.rooms[roomId];
}

function resolveAirConditioningHouseSettings(houseId){
  var defaults=getAirConditioningDefaults()||{};
  var house=getAirConditioningHouseSettings(houseId,false)||{};
  var overrides=house.overrides&&typeof house.overrides==='object'?house.overrides:{};
  var system={
    enabled:false,
    calculationMethod:'per_room',
    timeUnit:'day',
    durationMode:'conference',
    includeClosedRooms:false,
    roomRate:0,
    unitRate:0,
    personRate:0
  };
  var keys=['enabled','calculationMethod','timeUnit','durationMode','includeClosedRooms','roomRate','unitRate','personRate'];
  var values={};
  var sources={};
  keys.forEach(function(key){
    var houseValue=key==='enabled'?house.enabled:overrides[key];
    var resolved=resolveAccountSetting(undefined,houseValue,defaults[key],system[key]);
    values[key]=resolved.value;
    sources[key]=resolved.source;
  });
  return {values:values,sources:sources};
}

function resolveAirConditioningRoomSettings(houseId,roomId){
  var defaults=getAirConditioningDefaults()||{};
  var house=getAirConditioningHouseSettings(houseId,false)||{};
  var houseOverrides=house.overrides&&typeof house.overrides==='object'?house.overrides:{};
  var room=getAirConditioningRoomSettings(houseId,roomId,false)||{};
  var roomOverrides=room.overrides&&typeof room.overrides==='object'?room.overrides:{};
  var system={
    enabled:false,
    calculationMethod:'per_room',
    timeUnit:'day',
    durationMode:'conference',
    includeClosedRooms:false,
    roomRate:0,
    unitRate:0,
    personRate:0
  };
  var keys=['enabled','calculationMethod','timeUnit','durationMode','includeClosedRooms','roomRate','unitRate','personRate'];
  var values={};
  var sources={};
  keys.forEach(function(key){
    var roomValue=key==='enabled'||key==='includeClosedRooms'?undefined:roomOverrides[key];
    var houseValue=key==='enabled'?house.enabled:houseOverrides[key];
    var resolved=resolveAccountSetting(roomValue,houseValue,defaults[key],system[key]);
    values[key]=resolved.value;
    sources[key]=resolved.source;
  });
  values.included=room.included===true?true:(room.included===false?false:null);
  sources.included=room.included===true||room.included===false?'room':'system';
  return {values:values,sources:sources};
}

function countUsedExtraBedsForAccounts(room){
  var used=0;
  (room&&room.guests||[]).forEach(function(guest){
    var hasLeft=typeof gl==='function'?gl(guest):!!(guest&&guest.leftDay);
    if(!hasLeft&&guest&&guest.bedType==='extra')used++;
  });
  (room&&room.children||[]).forEach(function(child){
    var hasLeft=typeof gl==='function'?gl(child):!!(child&&child.leftDay);
    if(!hasLeft&&child&&child.bedType==='extra')used++;
  });
  return used;
}

function getRoomResidentsForAccounts(room,day){
  var result={adultsCount:0,childrenCount:0,totalCount:0};
  room=room||{};
  (room.guests||[]).forEach(function(person){
    var hasLeft=typeof gl==='function'
      ?gl(person,day)
      :!!(person&&person.leftDay&&(day===undefined||person.leftDay<=day));
    if(hasLeft)return;
    if(person&&person.bedType==='extra'&&person.extraBedPersonType==='child')result.childrenCount++;
    else result.adultsCount++;
  });
  (room.children||[]).forEach(function(child){
    var hasLeft=typeof gl==='function'
      ?gl(child,day)
      :!!(child&&child.leftDay&&(day===undefined||child.leftDay<=day));
    if(!hasLeft)result.childrenCount++;
  });
  result.totalCount=result.adultsCount+result.childrenCount;
  return result;
}

function getAccountsRoomContext(house,floor,room){
  house=house||{};
  floor=floor||{};
  room=room||{};
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  var displayedIds=conference&&Array.isArray(conference.accommodationDisplayedRoomIds)?conference.accommodationDisplayedRoomIds:[];
  var displayed=!!room.id&&displayedIds.indexOf(room.id)!==-1;
  var residents=getRoomResidentsForAccounts(room);
  var adultsCount=residents.adultsCount;
  var childrenCount=residents.childrenCount;
  var occupancyCount=residents.totalCount;
  var occupied=occupancyCount>0;
  var statusLabel=!displayed?'غير مضافة للتسكين':room.closed?'مغلقة':occupied?'مشغولة':'فارغة';
  return {
    id:room.id||'',
    sourceRoom:room,
    houseId:house.id||'',
    houseName:house.name||'',
    floorId:floor.id||'',
    floorName:floor.name||'',
    number:room.number||'',
    closed:!!room.closed,
    displayed:displayed,
    baseBeds:parseInt(room.beds,10)||0,
    extraBeds:parseInt(room.extraBeds,10)||0,
    adultsCount:adultsCount,
    childrenCount:childrenCount,
    occupancyCount:occupancyCount,
    usedExtraBedsCount:countUsedExtraBedsForAccounts(room),
    occupied:occupied,
    statusLabel:statusLabel
  };
}

function getAccountsHouseContext(house){
  house=house||{};
  var rooms=[];
  (house.floors||[]).forEach(function(floor){
    (floor.rooms||[]).forEach(function(room){
      rooms.push(getAccountsRoomContext(house,floor,room));
    });
  });
  return {
    id:house.id||'',
    sourceHouse:house,
    name:house.name||'بيت غير مسمى',
    floorsCount:(house.floors||[]).length,
    roomsCount:rooms.length,
    displayedRoomsCount:rooms.filter(function(room){return room.displayed}).length,
    occupiedRoomsCount:rooms.filter(function(room){return room.occupied}).length,
    closedRoomsCount:rooms.filter(function(room){return room.closed}).length,
    baseBedsCount:rooms.reduce(function(total,room){return total+room.baseBeds},0),
    extraBedsCount:rooms.reduce(function(total,room){return total+room.extraBeds},0),
    rooms:rooms
  };
}

function getAccountsRestaurantContext(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  var restaurant=conference&&conference.restaurant?conference.restaurant:null;
  var available=!!(restaurant&&restaurant.meals);
  var daysCount=typeof getDays==='function'?getDays():parseInt(conference&&conference.conf&&conference.conf.days,10)||1;
  var result={available:available,days:[],grandTotal:0};
  if(!available)return result;
  var mealKeys=['breakfast','lunch','dinner'];
  for(var day=1;day<=daysCount;day++){
    var persons=typeof personsOnDay==='function'?personsOnDay(day):{adults:0,children:0};
    var dayEntry={
      day:day,
      adults:parseInt(persons.adults,10)||0,
      children:parseInt(persons.children,10)||0,
      meals:{},
      total:0
    };
    mealKeys.forEach(function(mealKey){
      var source=restaurant.meals[mealKey]||{};
      var enabled=source.enabled!==false;
      var adultPrice=parseFloat(source.price)||0;
      var childPrice=parseFloat(source.childPrice)||0;
      var adultsCost=enabled?dayEntry.adults*adultPrice:0;
      var childrenCost=enabled?dayEntry.children*childPrice:0;
      var total=adultsCost+childrenCost;
      dayEntry.meals[mealKey]={
        enabled:enabled,
        adultPrice:adultPrice,
        childPrice:childPrice,
        adultsCost:adultsCost,
        childrenCost:childrenCost,
        total:total
      };
      dayEntry.total+=total;
    });
    result.days.push(dayEntry);
    result.grandTotal+=dayEntry.total;
  }
  return result;
}

function getAccountsConferenceContext(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  if(!conference)return null;
  var days=typeof getDays==='function'?getDays():parseInt(conference.conf&&conference.conf.days,10)||1;
  var houses=(conference.houses||[]).map(function(house){return getAccountsHouseContext(house)});
  var rooms=[];
  houses.forEach(function(house){rooms=rooms.concat(house.rooms)});
  return {
    conferenceId:conference.id||'',
    conferenceName:(conference.conf&&conference.conf.name)||conference.name||'المؤتمر',
    days:days,
    nights:Math.max(0,days-1),
    houses:houses,
    rooms:rooms,
    displayedRoomIds:Array.isArray(conference.accommodationDisplayedRoomIds)?conference.accommodationDisplayedRoomIds.slice():[],
    restaurant:getAccountsRestaurantContext()
  };
}

function getSelectedAccommodationAccountsContext(context){
  context=context||getAccountsConferenceContext();
  if(!context)return null;
  var selectedRooms=typeof getSelectedAccommodationRooms==='function'
    ?getSelectedAccommodationRooms()
    :[];
  var selectedIds={};
  selectedRooms.forEach(function(room){
    if(room&&room.id)selectedIds[String(room.id)]=true;
  });
  var accommodationContext={};
  Object.keys(context).forEach(function(key){
    accommodationContext[key]=context[key];
  });
  accommodationContext.houses=(context.houses||[]).map(function(house){
    var selectedHouseRooms=(house.rooms||[]).filter(function(room){
      return !!selectedIds[String(room.id||'')];
    }).map(function(room){
      var selectedRoom={};
      Object.keys(room).forEach(function(key){selectedRoom[key]=room[key]});
      selectedRoom.displayed=true;
      return selectedRoom;
    });
    if(!selectedHouseRooms.length)return null;
    var selectedHouse={};
    Object.keys(house).forEach(function(key){
      selectedHouse[key]=house[key];
    });
    selectedHouse.rooms=selectedHouseRooms;
    selectedHouse.roomsCount=selectedHouseRooms.length;
    selectedHouse.displayedRoomsCount=selectedHouseRooms.length;
    selectedHouse.occupiedRoomsCount=selectedHouseRooms.filter(function(room){return room.occupied}).length;
    selectedHouse.closedRoomsCount=selectedHouseRooms.filter(function(room){return room.closed}).length;
    selectedHouse.baseBedsCount=selectedHouseRooms.reduce(function(total,room){return total+room.baseBeds},0);
    selectedHouse.extraBedsCount=selectedHouseRooms.reduce(function(total,room){return total+room.extraBeds},0);
    return selectedHouse;
  }).filter(function(house){return !!house});
  accommodationContext.rooms=[];
  accommodationContext.houses.forEach(function(house){
    accommodationContext.rooms=accommodationContext.rooms.concat(house.rooms);
  });
  accommodationContext.displayedRoomIds=Object.keys(selectedIds);
  return accommodationContext;
}

function getAccountNumber(value){
  var number=Number(value);
  return isFinite(number)&&number>=0?number:0;
}

function formatAccountMoney(value){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  var accounts=conference?normalizeConferenceAccounts(conference):getDefaultConferenceAccounts();
  var precision=parseInt(accounts.settings.roundingPrecision,10);
  if(!isFinite(precision)||precision<0)precision=2;
  if(precision>6)precision=6;
  var currency=accounts.settings.currency||'EGP';
  var fixed=getAccountNumber(value).toFixed(precision);
  var parts=fixed.split('.');
  parts[0]=parts[0].replace(/\B(?=(\d{3})+(?!\d))/g,',');
  return parts.join(precision?'.':'')+' '+currency;
}

function getRoomExtraBedAccountingQuantity(roomContext){
  if(!roomContext)return 0;
  if(roomContext.sourceRoom)return countUsedExtraBedsForAccounts(roomContext.sourceRoom);
  return getAccountNumber(roomContext.usedExtraBedsCount);
}

function getRoomActiveResidentsOnDay(roomContext,day){
  var room=roomContext&&roomContext.sourceRoom;
  return room?getRoomResidentsForAccounts(room,day).totalCount:0;
}

function getAccommodationPersonArrivalDay(person,conferenceDays){
  conferenceDays=Math.max(1,parseInt(conferenceDays,10)||1);
  var arrivalDay=parseInt(person&&person.arrivalDay,10);
  if(!isFinite(arrivalDay)||arrivalDay<1)arrivalDay=1;
  if(arrivalDay>conferenceDays)arrivalDay=conferenceDays;
  return arrivalDay;
}

function getAccommodationPersonLeftDay(person){
  if(!person||person.leftDay===null||person.leftDay===undefined||person.leftDay==='')return null;
  var leftDay=parseInt(person.leftDay,10);
  return isFinite(leftDay)?leftDay:null;
}

function isAccommodationPersonActiveOnDay(person,day,conferenceDays){
  var arrivalDay=getAccommodationPersonArrivalDay(person,conferenceDays);
  var leftDay=getAccommodationPersonLeftDay(person);
  return arrivalDay<=day&&(leftDay===null||leftDay>day);
}

function isAccommodationPersonActiveOnNight(person,night,conferenceDays){
  return isAccommodationPersonActiveOnDay(person,night,conferenceDays);
}

function getAccommodationRoomPeople(roomContext){
  var room=roomContext&&roomContext.sourceRoom||{};
  return (room.guests||[]).concat(room.children||[]);
}

function getAccommodationRoomActualOccupancy(roomContext){
  var conferenceDays=typeof getDays==='function'?getDays():1;
  conferenceDays=Math.max(1,parseInt(conferenceDays,10)||1);
  var room=roomContext&&roomContext.sourceRoom;
  var people=getAccommodationRoomPeople(roomContext);
  var activePeople={};
  var result={
    occupiedDays:0,
    occupiedNights:0,
    personDays:0,
    personNights:0,
    activePeopleCount:0
  };
  for(var day=1;day<=conferenceDays;day++){
    var roomActive=typeof isRoomActiveOnDay==='function'
      ?isRoomActiveOnDay(room,day)
      :!(roomContext&&roomContext.closed===true);
    if(!roomActive)continue;
    var hasResident=false;
    people.forEach(function(person,index){
      if(!isAccommodationPersonActiveOnDay(person,day,conferenceDays))return;
      hasResident=true;
      result.personDays++;
      activePeople[index]=true;
    });
    if(hasResident)result.occupiedDays++;
  }
  for(var night=1;night<conferenceDays;night++){
    var roomActiveAtNightStart=typeof isRoomActiveOnDay==='function'
      ?isRoomActiveOnDay(room,night)
      :!(roomContext&&roomContext.closed===true);
    if(!roomActiveAtNightStart)continue;
    var hasNightResident=false;
    people.forEach(function(person,index){
      if(!isAccommodationPersonActiveOnNight(person,night,conferenceDays))return;
      hasNightResident=true;
      result.personNights++;
      activePeople[index]=true;
    });
    if(hasNightResident)result.occupiedNights++;
  }
  result.activePeopleCount=Object.keys(activePeople).length;
  return result;
}

function getAccommodationActualDuration(actualOccupancy,timeUnit){
  if(timeUnit==='conference')return 1;
  if(timeUnit==='night')return actualOccupancy.occupiedNights;
  return actualOccupancy.occupiedDays;
}

function getAccommodationActualPersonTimeQuantity(actualOccupancy,timeUnit){
  if(timeUnit==='conference')return actualOccupancy.activePeopleCount;
  if(timeUnit==='night')return actualOccupancy.personNights;
  return actualOccupancy.personDays;
}

function getRoomAccountingDayDuration(roomContext,resolvedSettings){
  var conferenceDays=typeof getDays==='function'?getDays():1;
  conferenceDays=Math.max(0,parseInt(conferenceDays,10)||0);
  if(!resolvedSettings||resolvedSettings.values.durationMode!=='actual_occupancy')return conferenceDays;
  var activeDays=0;
  for(var day=1;day<=conferenceDays;day++){
    var roomActive=typeof isRoomActiveOnDay==='function'
      ?isRoomActiveOnDay(roomContext.sourceRoom,day)
      :!(roomContext.closed===true);
    if(roomActive&&getRoomActiveResidentsOnDay(roomContext,day)>0)activeDays++;
  }
  return activeDays;
}

function getRoomAccountingDuration(houseContext,roomContext,resolvedSettings){
  var dayDuration=getRoomAccountingDayDuration(roomContext,resolvedSettings);
  var timeUnit=resolvedSettings&&resolvedSettings.values.timeUnit||'day';
  if(timeUnit==='conference')return 1;
  if(timeUnit==='night')return Math.max(0,dayDuration-1);
  return dayDuration;
}

function getRoomAccountingQuantity(houseContext,roomContext,resolvedSettings){
  var method=resolvedSettings&&resolvedSettings.values.calculationMethod||'selected_rooms';
  if(method==='per_person')return getAccountNumber(roomContext&&roomContext.occupancyCount);
  if(method==='fixed_house'||method==='manual')return 0;
  return 1;
}

function getAccommodationRoomCalculationInput(houseContext,roomContext){
  var accommodation=getAccommodationAccounts();
  var houseResolved=resolveAccommodationHouseSettings(houseContext&&houseContext.id);
  var roomSettings=getAccommodationRoomSettings(houseContext&&houseContext.id,roomContext&&roomContext.id,false)||{};
  return {
    accommodationEnabled:!(accommodation&&accommodation.enabled===false),
    houseEnabled:houseResolved.values.enabled!==false,
    roomIncluded:roomSettings.included===true?true:(roomSettings.included===false?false:null),
    roomManualTotal:roomSettings.manualTotal!==null&&roomSettings.manualTotal!==undefined
      ?getAccountNumber(roomSettings.manualTotal)
      :null
  };
}

function getAccommodationRoomPricing(resolvedSettings,calculationMethod,roomContext){
  var usesPersonRate=calculationMethod==='per_person';
  var sourceRoom=roomContext&&roomContext.sourceRoom
    ?roomContext.sourceRoom
    :{beds:roomContext&&roomContext.baseBeds};
  var roomTypeKey=typeof getRoomTypeKey==='function'?getRoomTypeKey(sourceRoom):'unknown';
  var roomTypeLabel=typeof getRoomTypeLabel==='function'?getRoomTypeLabel(sourceRoom):'غير محدد';
  var roomTypeRates=resolvedSettings.values.roomTypeRates||{};
  var roomTypeRateSources=resolvedSettings.sources.roomTypeRates||{};
  var usesRoomTypeRate=calculationMethod==='room_type';
  return {
    unitRate:getAccountNumber(
      usesRoomTypeRate
        ?roomTypeRates[roomTypeKey]
        :(usesPersonRate?resolvedSettings.values.personRate:resolvedSettings.values.roomRate)
    ),
    unitRateSource:usesRoomTypeRate
      ?(roomTypeRateSources[roomTypeKey]||'system')
      :(usesPersonRate?resolvedSettings.sources.personRate:resolvedSettings.sources.roomRate),
    roomTypeKey:roomTypeKey,
    roomTypeLabel:roomTypeLabel,
    roomTypeRate:usesRoomTypeRate?getAccountNumber(roomTypeRates[roomTypeKey]):null,
    roomTypeRateSource:usesRoomTypeRate?(roomTypeRateSources[roomTypeKey]||'system'):'',
    extraBedRate:getAccountNumber(resolvedSettings.values.extraBedRate),
    extraBedRateSource:resolvedSettings.sources.extraBedRate
  };
}

function applyAccountExpenseEnvelope(target,input,resolvedSettings,calculation,result,display){
  target.input=input;
  target.resolvedSettings={
    values:resolvedSettings&&resolvedSettings.values||{},
    sources:resolvedSettings&&resolvedSettings.sources||{}
  };
  target.calculation=calculation||{};
  target.result=result||{};
  target.display=display||{};
  return target;
}

function isRoomIncludedInAccommodationAccounts(houseContext,roomContext,resolvedSettings,calculationInput,actualOccupancy){
  calculationInput=calculationInput||getAccommodationRoomCalculationInput(houseContext,roomContext);
  if(!calculationInput.accommodationEnabled)return {included:false,reason:'حساب الإقامة غير مفعّل'};
  if(!calculationInput.houseEnabled)return {included:false,reason:'البيت غير مفعّل'};
  if(!roomContext.displayed)return {included:false,reason:'غير مضافة للتسكين'};
  if(calculationInput.roomIncluded===false)return {included:false,reason:'مستبعدة يدويًا'};
  if(roomContext.closed&&resolvedSettings.values.includeClosedRooms===false&&calculationInput.roomIncluded!==true){
    return {included:false,reason:'الغرفة مغلقة'};
  }
  if(calculationInput.roomIncluded===true)return {included:true,reason:''};
  var method=resolvedSettings.values.calculationMethod;
  var usesActualOccupancy=resolvedSettings.values.durationMode==='actual_occupancy';
  if(method==='selected_rooms'&&!roomContext.displayed)return {included:false,reason:'غير مضافة للتسكين'};
  if(method==='occupied_rooms'&&(
    usesActualOccupancy
      ?!actualOccupancy||actualOccupancy.occupiedDays<=0
      :!roomContext.occupied
  ))return {included:false,reason:'الغرفة فارغة'};
  if(method==='per_person'&&(
    usesActualOccupancy
      ?!actualOccupancy||actualOccupancy.activePeopleCount<=0
      :getAccountNumber(roomContext.occupancyCount)<=0
  ))return {included:false,reason:'الغرفة فارغة'};
  return {included:true,reason:''};
}

function getAccountQuantityLabel(method,quantity){
  if(method==='per_person')return quantity+' '+(quantity===1?'شخص':'أشخاص');
  return quantity+' '+(quantity===1?'غرفة':'غرف');
}

function getAccountDurationLabel(timeUnit,duration){
  if(timeUnit==='conference')return 'المؤتمر';
  if(timeUnit==='night')return duration+' '+(duration===1?'ليلة':'ليالٍ');
  return duration+' '+(duration===1?'يوم':'أيام');
}

function buildAccommodationCalculationFormula(result){
  if(!result.included)return result.excludedReason||'مستبعدة من الحساب';
  if(result.calculationMethod==='fixed_house')return 'يُحسب المبلغ الثابت على مستوى البيت';
  if(result.calculationMethod==='manual'&&result.manualTotal===null)return 'يُحسب الإجمالي اليدوي على مستوى البيت';
  var lines=[];
  if(result.calculationMethod==='per_person'&&result.durationMode==='actual_occupancy'){
    var personTimeLabel=result.timeUnit==='night'
      ?'شخص-ليلة'
      :(result.timeUnit==='day'?'شخص-يوم':'شخص');
    lines.push(
      formatAccountMoney(result.rate)+' × '+
      result.personTimeQuantity+' '+personTimeLabel+' = '+
      formatAccountMoney(result.baseAmount)
    );
  }else if(result.calculationMethod==='room_type'){
    lines.push(
      'غرفة '+result.roomTypeLabel+': '+
      formatAccountMoney(result.roomTypeRate)+' × '+
      getAccountDurationLabel(result.timeUnit,result.duration)+' = '+
      formatAccountMoney(result.baseAmount)
    );
  }else{
    lines.push(
      getAccountQuantityLabel(result.calculationMethod,result.quantity)+' × '+
      formatAccountMoney(result.rate)+' × '+
      getAccountDurationLabel(result.timeUnit,result.duration)+' = '+
      formatAccountMoney(result.baseAmount)
    );
  }
  if(result.extraBedQuantity>0){
    lines.push(
      result.extraBedQuantity+' سرير إضافي × '+
      formatAccountMoney(result.extraBedRate)+' × '+
      getAccountDurationLabel(result.timeUnit,result.duration)+' = '+
      formatAccountMoney(result.extraBedsAmount)
    );
  }
  if(result.manualTotal!==null){
    lines.push('الإجمالي المحسوب = '+formatAccountMoney(result.calculatedTotal));
    lines.push('التجاوز اليدوي = '+formatAccountMoney(result.manualTotal));
  }else if(lines.length>1){
    lines.push('الإجمالي = '+formatAccountMoney(result.finalTotal));
  }
  return lines.join('\n');
}

// يحسب نتيجة غرفة واحدة من سياق القراءة والإعدادات المحلولة دون تخزينها.
function calculateAccommodationRoomExpense(houseContext,roomContext){
  var resolved=resolveAccommodationRoomSettings(houseContext.id,roomContext.id);
  var input=getAccommodationRoomCalculationInput(houseContext,roomContext);
  var method=resolved.values.calculationMethod;
  var usesActualOccupancy=resolved.values.durationMode==='actual_occupancy';
  var actualOccupancy=getAccommodationRoomActualOccupancy(roomContext);
  var inclusion=isRoomIncludedInAccommodationAccounts(
    houseContext,
    roomContext,
    resolved,
    input,
    actualOccupancy
  );
  var duration=usesActualOccupancy
    ?getAccommodationActualDuration(actualOccupancy,resolved.values.timeUnit)
    :getRoomAccountingDuration(houseContext,roomContext,resolved);
  var quantity=getRoomAccountingQuantity(houseContext,roomContext,resolved);
  var personQuantity=getAccountNumber(roomContext.occupancyCount);
  var personTimeQuantity=usesActualOccupancy&&method==='per_person'
    ?getAccommodationActualPersonTimeQuantity(actualOccupancy,resolved.values.timeUnit)
    :null;
  if(personTimeQuantity!==null)quantity=personTimeQuantity;
  var extraBedQuantity=getRoomExtraBedAccountingQuantity(roomContext);
  var pricing=getAccommodationRoomPricing(resolved,method,roomContext);
  var baseAmount=0;
  if(inclusion.included&&method!=='fixed_house'&&method!=='manual'){
    baseAmount=usesActualOccupancy&&method==='per_person'
      ?personTimeQuantity*pricing.unitRate
      :quantity*pricing.unitRate*duration;
  }
  var extraBedsAmount=inclusion.included&&method!=='fixed_house'&&method!=='manual'?extraBedQuantity*pricing.extraBedRate*duration:0;
  var calculatedTotal=baseAmount+extraBedsAmount;
  var manualTotal=input.roomManualTotal;
  var finalTotal=inclusion.included?(manualTotal!==null?manualTotal:calculatedTotal):0;
  var result={
    houseId:houseContext.id,
    roomId:roomContext.id,
    roomNumber:roomContext.number,
    included:inclusion.included,
    excludedReason:inclusion.reason,
    calculationMethod:method,
    timeUnit:resolved.values.timeUnit,
    durationMode:resolved.values.durationMode,
    quantity:quantity,
    duration:duration,
    rate:pricing.unitRate,
    rateSource:pricing.unitRateSource,
    roomTypeKey:method==='room_type'?pricing.roomTypeKey:'',
    roomTypeLabel:method==='room_type'?pricing.roomTypeLabel:'',
    roomTypeRate:method==='room_type'?pricing.roomTypeRate:null,
    roomTypeRateSource:method==='room_type'?pricing.roomTypeRateSource:'',
    personQuantity:personQuantity,
    personTimeQuantity:personTimeQuantity,
    actualOccupiedDays:actualOccupancy.occupiedDays,
    actualOccupiedNights:actualOccupancy.occupiedNights,
    personDayQuantity:actualOccupancy.personDays,
    personNightQuantity:actualOccupancy.personNights,
    extraBedQuantity:extraBedQuantity,
    extraBedRate:pricing.extraBedRate,
    extraBedRateSource:pricing.extraBedRateSource,
    baseAmount:baseAmount,
    extraBedsAmount:extraBedsAmount,
    calculatedTotal:calculatedTotal,
    manualTotal:manualTotal,
    finalTotal:finalTotal,
    formula:'',
    settings:resolved.values,
    sources:resolved.sources
  };
  result.formula=buildAccommodationCalculationFormula(result);
  return applyAccountExpenseEnvelope(
    result,
    {
      houseId:houseContext.id,
      roomId:roomContext.id,
      accommodationEnabled:input.accommodationEnabled,
      houseEnabled:input.houseEnabled,
      roomIncluded:input.roomIncluded
    },
    resolved,
    {
      method:method,
      timeUnit:result.timeUnit,
      durationMode:result.durationMode,
      quantity:quantity,
      duration:duration,
      unitRate:pricing.unitRate,
      unitRateSource:pricing.unitRateSource,
      roomTypeKey:result.roomTypeKey,
      roomTypeLabel:result.roomTypeLabel,
      roomTypeRate:result.roomTypeRate,
      roomTypeRateSource:result.roomTypeRateSource,
      personQuantity:personQuantity,
      personTimeQuantity:personTimeQuantity,
      actualOccupiedDays:actualOccupancy.occupiedDays,
      actualOccupiedNights:actualOccupancy.occupiedNights,
      personDayQuantity:actualOccupancy.personDays,
      personNightQuantity:actualOccupancy.personNights,
      extraBedQuantity:extraBedQuantity,
      extraBedRate:pricing.extraBedRate,
      extraBedRateSource:pricing.extraBedRateSource,
      baseAmount:baseAmount,
      extraBedsAmount:extraBedsAmount
    },
    {
      calculatedTotal:calculatedTotal,
      manualTotal:manualTotal,
      finalTotal:finalTotal
    },
    {formula:result.formula}
  );
}

// يجمع نتائج الغرف ويطبق طريقة البيت والتجاوز اليدوي النهائي.
function calculateAccommodationHouseExpense(houseContext){
  var accommodation=getAccommodationAccounts();
  var resolved=resolveAccommodationHouseSettings(houseContext.id);
  var stored=getAccommodationHouseSettings(houseContext.id,false)||{};
  var selectedRooms=(houseContext.rooms||[]).filter(function(room){return room.displayed});
  var rooms=selectedRooms.map(function(room){
    return calculateAccommodationRoomExpense(houseContext,room);
  });
  var enabled=selectedRooms.length>0&&!(accommodation&&accommodation.enabled===false)&&resolved.values.enabled!==false;
  var roomsCalculatedTotal=rooms.reduce(function(total,room){
    return total+(room.included?room.finalTotal:0);
  },0);
  var method=resolved.values.calculationMethod;
  var fixedAmount=stored.fixedAmount!==null&&stored.fixedAmount!==undefined?getAccountNumber(stored.fixedAmount):null;
  var manualTotal=stored.manualTotal!==null&&stored.manualTotal!==undefined?getAccountNumber(stored.manualTotal):null;
  var calculatedTotal=roomsCalculatedTotal;
  var formula='مجموع الغرف الداخلة = '+formatAccountMoney(roomsCalculatedTotal);
  if(method==='fixed_house'){
    calculatedTotal=fixedAmount===null?0:fixedAmount;
    formula='مبلغ ثابت للبيت = '+formatAccountMoney(calculatedTotal);
  }else if(method==='manual'){
    calculatedTotal=manualTotal===null?0:manualTotal;
    formula='إجمالي يدوي للبيت = '+formatAccountMoney(calculatedTotal);
  }
  var finalTotal=manualTotal!==null?manualTotal:calculatedTotal;
  if(!enabled)finalTotal=0;
  if(manualTotal!==null&&method!=='manual')formula+='\nتجاوز إجمالي البيت = '+formatAccountMoney(manualTotal);
  var result={
    houseId:houseContext.id,
    houseName:houseContext.name,
    enabled:enabled,
    calculationMethod:method,
    rooms:rooms,
    includedRoomsCount:rooms.filter(function(room){return room.included}).length,
    excludedRoomsCount:rooms.filter(function(room){return !room.included}).length,
    roomsCalculatedTotal:roomsCalculatedTotal,
    fixedAmount:fixedAmount,
    manualTotal:manualTotal,
    calculatedTotal:calculatedTotal,
    finalTotal:finalTotal,
    formula:enabled?formula:'البيت غير مفعّل',
    settings:resolved.values,
    sources:resolved.sources
  };
  return applyAccountExpenseEnvelope(
    result,
    {houseId:houseContext.id,accommodationEnabled:!(accommodation&&accommodation.enabled===false)},
    resolved,
    {
      method:method,
      roomsCalculatedTotal:roomsCalculatedTotal,
      fixedAmount:fixedAmount
    },
    {
      calculatedTotal:calculatedTotal,
      manualTotal:manualTotal,
      finalTotal:finalTotal
    },
    {formula:result.formula}
  );
}

// يجمع نتائج البيوت في نتيجة إقامة لحظية واحدة.
function calculateAccommodationExpense(context){
  context=getSelectedAccommodationAccountsContext(context||getAccountsConferenceContext());
  var accommodation=getAccommodationAccounts();
  var enabled=!!context&&!(accommodation&&accommodation.enabled===false);
  var houses=context?(context.houses||[]).map(function(house){
    return calculateAccommodationHouseExpense(house);
  }):[];
  var calculatedTotal=enabled?houses.reduce(function(total,house){
    return total+(house.enabled?house.calculatedTotal:0);
  },0):0;
  var finalTotal=enabled?houses.reduce(function(total,house){
    return total+(house.enabled?house.finalTotal:0);
  },0):0;
  var result={
    enabled:enabled,
    houses:houses,
    housesCount:houses.length,
    includedHousesCount:houses.filter(function(house){return house.enabled}).length,
    includedRoomsCount:houses.reduce(function(total,house){return total+house.includedRoomsCount},0),
    excludedRoomsCount:houses.reduce(function(total,house){return total+house.excludedRoomsCount},0),
    calculatedTotal:calculatedTotal,
    finalTotal:finalTotal
  };
  return applyAccountExpenseEnvelope(
    result,
    {
      conferenceId:context&&context.conferenceId||'',
      housesCount:houses.length
    },
    {
      values:{enabled:enabled},
      sources:{enabled:'default'}
    },
    {
      includedHousesCount:result.includedHousesCount,
      includedRoomsCount:result.includedRoomsCount,
      excludedRoomsCount:result.excludedRoomsCount
    },
    {
      calculatedTotal:calculatedTotal,
      manualTotal:null,
      finalTotal:finalTotal
    },
    {formula:'إجمالي الإقامة = '+formatAccountMoney(finalTotal)}
  );
}

function getAirConditioningRoomCalculationInput(houseContext,roomContext){
  var airConditioning=getAirConditioningAccounts();
  var houseResolved=resolveAirConditioningHouseSettings(houseContext&&houseContext.id);
  var houseSettings=getAirConditioningHouseSettings(houseContext&&houseContext.id,false)||{};
  var roomSettings=getAirConditioningRoomSettings(houseContext&&houseContext.id,roomContext&&roomContext.id,false)||{};
  return {
    airConditioningEnabled:!(airConditioning&&airConditioning.enabled===false),
    houseEnabled:houseResolved.values.enabled!==false,
    roomIncluded:roomSettings.included===true?true:(roomSettings.included===false?false:null),
    houseUnitsCount:houseSettings.unitsCount!==null&&houseSettings.unitsCount!==undefined
      ?getAccountNumber(houseSettings.unitsCount)
      :null,
    roomUnitsCount:roomSettings.unitsCount!==null&&roomSettings.unitsCount!==undefined
      ?getAccountNumber(roomSettings.unitsCount)
      :null,
    roomManualTotal:roomSettings.manualTotal!==null&&roomSettings.manualTotal!==undefined
      ?getAccountNumber(roomSettings.manualTotal)
      :null
  };
}

function getAirConditioningRoomPricing(resolvedSettings,calculationMethod){
  var rateKey=calculationMethod==='per_unit'
    ?'unitRate'
    :(calculationMethod==='per_person'?'personRate':'roomRate');
  return {
    rate:getAccountNumber(resolvedSettings.values[rateKey]),
    rateSource:resolvedSettings.sources[rateKey],
    rateKey:rateKey
  };
}

function getAirConditioningUnitsCount(calculationInput){
  if(calculationInput.roomUnitsCount!==null)return {
    value:calculationInput.roomUnitsCount,
    source:'room'
  };
  if(calculationInput.houseUnitsCount!==null)return {
    value:calculationInput.houseUnitsCount,
    source:'house'
  };
  return {value:1,source:'system'};
}

function isRoomIncludedInAirConditioningAccounts(houseContext,roomContext,resolvedSettings,calculationInput){
  calculationInput=calculationInput||getAirConditioningRoomCalculationInput(houseContext,roomContext);
  if(!calculationInput.airConditioningEnabled)return {included:false,reason:'حساب التكييف غير مفعّل'};
  if(!calculationInput.houseEnabled)return {included:false,reason:'البيت غير مفعّل'};
  if(calculationInput.roomIncluded===false)return {included:false,reason:'مستبعدة يدويًا'};
  if(roomContext.closed&&resolvedSettings.values.includeClosedRooms===false&&calculationInput.roomIncluded!==true){
    return {included:false,reason:'الغرفة مغلقة'};
  }
  if(calculationInput.roomIncluded===true)return {included:true,reason:''};
  if(!roomContext.displayed)return {included:false,reason:'غير مضافة للتسكين'};
  if(resolvedSettings.values.calculationMethod==='per_person'&&getAccountNumber(roomContext.occupancyCount)<=0){
    return {included:false,reason:'الغرفة فارغة'};
  }
  return {included:true,reason:''};
}

function getAirConditioningRoomQuantity(roomContext,resolvedSettings,units){
  var method=resolvedSettings.values.calculationMethod;
  if(method==='per_unit')return units.value;
  if(method==='per_person')return getAccountNumber(roomContext.occupancyCount);
  if(method==='fixed_house'||method==='manual')return 0;
  return 1;
}

function buildAirConditioningCalculationFormula(result){
  if(!result.included)return result.excludedReason||'مستبعدة من الحساب';
  if(result.calculationMethod==='fixed_house')return 'يُحسب المبلغ الثابت على مستوى البيت';
  if(result.calculationMethod==='manual'&&result.manualTotal===null)return 'يُحسب الإجمالي اليدوي على مستوى البيت';
  var quantityLabel=result.calculationMethod==='per_unit'
    ?result.quantity+' '+(result.quantity===1?'وحدة تكييف':'وحدات تكييف')
    :(result.calculationMethod==='per_person'
      ?getAccountQuantityLabel('per_person',result.quantity)
      :getAccountQuantityLabel('per_room',result.quantity));
  var lines=[
    quantityLabel+' × '+formatAccountMoney(result.rate)+' × '+
    getAccountDurationLabel(result.timeUnit,result.duration)+' = '+
    formatAccountMoney(result.calculatedTotal)
  ];
  if(result.manualTotal!==null){
    lines.push('الإجمالي المحسوب = '+formatAccountMoney(result.calculatedTotal));
    lines.push('التجاوز اليدوي = '+formatAccountMoney(result.manualTotal));
  }
  return lines.join('\n');
}

// يحسب تكلفة تكييف غرفة واحدة لحظيًا من الإعدادات المحلولة.
function calculateAirConditioningRoomExpense(houseContext,roomContext){
  var resolved=resolveAirConditioningRoomSettings(houseContext.id,roomContext.id);
  var input=getAirConditioningRoomCalculationInput(houseContext,roomContext);
  var inclusion=isRoomIncludedInAirConditioningAccounts(houseContext,roomContext,resolved,input);
  var units=getAirConditioningUnitsCount(input);
  var quantity=getAirConditioningRoomQuantity(roomContext,resolved,units);
  var duration=getRoomAccountingDuration(houseContext,roomContext,resolved);
  var pricing=getAirConditioningRoomPricing(resolved,resolved.values.calculationMethod);
  var calculatedTotal=inclusion.included&&resolved.values.calculationMethod!=='fixed_house'&&resolved.values.calculationMethod!=='manual'
    ?quantity*pricing.rate*duration
    :0;
  var manualTotal=input.roomManualTotal;
  var finalTotal=inclusion.included?(manualTotal!==null?manualTotal:calculatedTotal):0;
  var result={
    houseId:houseContext.id,
    roomId:roomContext.id,
    roomNumber:roomContext.number,
    included:inclusion.included,
    excludedReason:inclusion.reason,
    calculationMethod:resolved.values.calculationMethod,
    timeUnit:resolved.values.timeUnit,
    durationMode:resolved.values.durationMode,
    quantity:quantity,
    duration:duration,
    rate:pricing.rate,
    rateSource:pricing.rateSource,
    unitsCount:units.value,
    unitsCountSource:units.source,
    personQuantity:getAccountNumber(roomContext.occupancyCount),
    calculatedTotal:calculatedTotal,
    manualTotal:manualTotal,
    finalTotal:finalTotal,
    formula:'',
    settings:resolved.values,
    sources:resolved.sources
  };
  result.formula=buildAirConditioningCalculationFormula(result);
  return applyAccountExpenseEnvelope(
    result,
    {
      houseId:houseContext.id,
      roomId:roomContext.id,
      airConditioningEnabled:input.airConditioningEnabled,
      houseEnabled:input.houseEnabled,
      roomIncluded:input.roomIncluded
    },
    resolved,
    {
      included:inclusion.included,
      excludedReason:inclusion.reason,
      method:result.calculationMethod,
      timeUnit:result.timeUnit,
      durationMode:result.durationMode,
      quantity:quantity,
      duration:duration,
      rate:pricing.rate,
      rateSource:pricing.rateSource,
      unitsCount:units.value,
      unitsCountSource:units.source
    },
    {
      calculatedTotal:calculatedTotal,
      manualTotal:manualTotal,
      finalTotal:finalTotal
    },
    {formula:result.formula}
  );
}

// يجمع تكلفة تكييف غرف البيت ويطبق المبلغ الثابت أو التجاوز اليدوي.
function calculateAirConditioningHouseExpense(houseContext){
  var airConditioning=getAirConditioningAccounts();
  var resolved=resolveAirConditioningHouseSettings(houseContext.id);
  var stored=getAirConditioningHouseSettings(houseContext.id,false)||{};
  var rooms=(houseContext.rooms||[]).map(function(room){
    return calculateAirConditioningRoomExpense(houseContext,room);
  });
  var enabled=!(airConditioning&&airConditioning.enabled===false)&&resolved.values.enabled!==false;
  var roomsCalculatedTotal=rooms.reduce(function(total,room){
    return total+(room.included?room.finalTotal:0);
  },0);
  var method=resolved.values.calculationMethod;
  var fixedAmount=stored.fixedAmount!==null&&stored.fixedAmount!==undefined?getAccountNumber(stored.fixedAmount):null;
  var manualTotal=stored.manualTotal!==null&&stored.manualTotal!==undefined?getAccountNumber(stored.manualTotal):null;
  var calculatedTotal=roomsCalculatedTotal;
  var formula='مجموع تكييف الغرف الداخلة = '+formatAccountMoney(roomsCalculatedTotal);
  if(method==='fixed_house'){
    calculatedTotal=fixedAmount===null?0:fixedAmount;
    formula='مبلغ ثابت لتكييف البيت = '+formatAccountMoney(calculatedTotal);
  }else if(method==='manual'){
    calculatedTotal=manualTotal===null?0:manualTotal;
    formula='إجمالي يدوي لتكييف البيت = '+formatAccountMoney(calculatedTotal);
  }
  var finalTotal=manualTotal!==null?manualTotal:calculatedTotal;
  if(!enabled)finalTotal=0;
  if(manualTotal!==null&&method!=='manual')formula+='\nتجاوز إجمالي تكييف البيت = '+formatAccountMoney(manualTotal);
  var result={
    houseId:houseContext.id,
    houseName:houseContext.name,
    enabled:enabled,
    calculationMethod:method,
    rooms:rooms,
    includedRoomsCount:rooms.filter(function(room){return room.included}).length,
    excludedRoomsCount:rooms.filter(function(room){return !room.included}).length,
    roomsCalculatedTotal:roomsCalculatedTotal,
    fixedAmount:fixedAmount,
    manualTotal:manualTotal,
    calculatedTotal:calculatedTotal,
    finalTotal:finalTotal,
    formula:enabled?formula:'البيت غير مفعّل',
    settings:resolved.values,
    sources:resolved.sources
  };
  return applyAccountExpenseEnvelope(
    result,
    {houseId:houseContext.id,airConditioningEnabled:!(airConditioning&&airConditioning.enabled===false)},
    resolved,
    {method:method,roomsCalculatedTotal:roomsCalculatedTotal,fixedAmount:fixedAmount},
    {calculatedTotal:calculatedTotal,manualTotal:manualTotal,finalTotal:finalTotal},
    {formula:result.formula}
  );
}

// يجمع نتائج تكييف البيوت دون تخزين أي نتيجة محسوبة.
function calculateAirConditioningExpense(context){
  context=context||getAccountsConferenceContext();
  var airConditioning=getAirConditioningAccounts();
  var enabled=!!context&&!(airConditioning&&airConditioning.enabled===false);
  var houses=context?(context.houses||[]).map(function(house){
    return calculateAirConditioningHouseExpense(house);
  }):[];
  var calculatedTotal=enabled?houses.reduce(function(total,house){
    return total+(house.enabled?house.calculatedTotal:0);
  },0):0;
  var finalTotal=enabled?houses.reduce(function(total,house){
    return total+(house.enabled?house.finalTotal:0);
  },0):0;
  var result={
    enabled:enabled,
    houses:houses,
    housesCount:houses.length,
    includedHousesCount:houses.filter(function(house){return house.enabled}).length,
    includedRoomsCount:houses.reduce(function(total,house){return total+house.includedRoomsCount},0),
    excludedRoomsCount:houses.reduce(function(total,house){return total+house.excludedRoomsCount},0),
    calculatedTotal:calculatedTotal,
    finalTotal:finalTotal
  };
  return applyAccountExpenseEnvelope(
    result,
    {conferenceId:context&&context.conferenceId||'',housesCount:houses.length},
    {values:{enabled:enabled},sources:{enabled:'default'}},
    {
      includedHousesCount:result.includedHousesCount,
      includedRoomsCount:result.includedRoomsCount,
      excludedRoomsCount:result.excludedRoomsCount
    },
    {calculatedTotal:calculatedTotal,manualTotal:null,finalTotal:finalTotal},
    {formula:'إجمالي التكييف = '+formatAccountMoney(finalTotal)}
  );
}

function buildMealCalculationFormula(result){
  if(!result.enabled)return getAccountMealLabel(result.mealKey)+' غير مفعّل = '+formatAccountMoney(0);
  if(result.manualTotal!==null)return 'إجمالي يدوي لـ'+getAccountMealLabel(result.mealKey)+' = '+formatAccountMoney(result.manualTotal);
  var lines=[];
  if(result.adults>0){
    lines.push(result.adults+' بالغ × '+formatAccountMoney(result.adultPrice)+' = '+formatAccountMoney(result.adultsAmount));
  }
  if(result.children>0){
    lines.push(result.children+' أطفال × '+formatAccountMoney(result.childPrice)+' = '+formatAccountMoney(result.childrenAmount));
  }
  if(!lines.length)lines.push('لا توجد أعداد محتسبة = '+formatAccountMoney(0));
  if(lines.length>1)lines.push('الإجمالي = '+formatAccountMoney(result.finalTotal));
  return lines.join('\n');
}

// يحسب وجبة واحدة من مصدر المطعم وتخصيصات الحسابات دون تعديل المصدر.
function calculateMealExpense(day,mealKey){
  var resolved=resolveMealsMealSettings(day,mealKey);
  var stored=getMealsDayMealSettings(day,mealKey,false)||{};
  var adultsAmount=resolved.values.adults*resolved.values.adultPrice;
  var childrenAmount=resolved.values.children*resolved.values.childPrice;
  var calculatedTotal=adultsAmount+childrenAmount;
  var manualTotal=stored.manualTotal!==null&&stored.manualTotal!==undefined?getAccountNumber(stored.manualTotal):null;
  var finalTotal=resolved.values.enabled?(manualTotal!==null?manualTotal:calculatedTotal):0;
  var result={
    day:day,
    mealKey:mealKey,
    enabled:resolved.values.enabled,
    adults:resolved.values.adults,
    children:resolved.values.children,
    adultPrice:resolved.values.adultPrice,
    childPrice:resolved.values.childPrice,
    adultsAmount:adultsAmount,
    childrenAmount:childrenAmount,
    calculatedTotal:calculatedTotal,
    manualTotal:manualTotal,
    finalTotal:finalTotal,
    formula:'',
    settings:resolved.values,
    sources:resolved.sources
  };
  result.formula=buildMealCalculationFormula(result);
  return applyAccountExpenseEnvelope(
    result,
    {day:day,mealKey:mealKey,calculationMode:resolved.calculationMode},
    resolved,
    {
      enabled:result.enabled,
      adults:result.adults,
      children:result.children,
      adultPrice:result.adultPrice,
      childPrice:result.childPrice,
      adultsAmount:adultsAmount,
      childrenAmount:childrenAmount
    },
    {calculatedTotal:calculatedTotal,manualTotal:manualTotal,finalTotal:finalTotal},
    {formula:result.formula}
  );
}

// يجمع الوجبات الثلاث لليوم ويطبق تجاوز اليوم عند وجوده.
function calculateMealsDayExpense(day){
  var resolved=resolveMealsDaySettings(day);
  var stored=getMealsDaySettings(day,false)||{};
  var meals={
    breakfast:calculateMealExpense(day,'breakfast'),
    lunch:calculateMealExpense(day,'lunch'),
    dinner:calculateMealExpense(day,'dinner')
  };
  var calculatedTotal=['breakfast','lunch','dinner'].reduce(function(total,key){
    return total+(meals[key].enabled?meals[key].finalTotal:0);
  },0);
  var manualTotal=stored.manualTotal!==null&&stored.manualTotal!==undefined?getAccountNumber(stored.manualTotal):null;
  var finalTotal=resolved.values.enabled?(manualTotal!==null?manualTotal:calculatedTotal):0;
  var formula=!resolved.values.enabled
    ?'اليوم '+day+' غير مفعّل = '+formatAccountMoney(0)
    :(manualTotal!==null
      ?'إجمالي يدوي لليوم '+day+' = '+formatAccountMoney(manualTotal)
      :'مجموع وجبات اليوم '+day+' = '+formatAccountMoney(finalTotal));
  var result={
    day:day,
    enabled:resolved.values.enabled,
    adults:resolved.values.adults,
    children:resolved.values.children,
    meals:meals,
    calculatedTotal:calculatedTotal,
    manualTotal:manualTotal,
    finalTotal:finalTotal,
    formula:formula,
    settings:resolved.values,
    sources:resolved.sources
  };
  return applyAccountExpenseEnvelope(
    result,
    {day:day},
    resolved,
    {
      enabled:result.enabled,
      adults:result.adults,
      children:result.children
    },
    {calculatedTotal:calculatedTotal,manualTotal:manualTotal,finalTotal:finalTotal},
    {formula:formula}
  );
}

// يجمع أيام المؤتمر الحالية فقط ويتجاهل تخصيصات الأيام الأقدم من المدة الحالية.
function calculateMealsExpense(context){
  context=context||getAccountsConferenceContext();
  var mealsSettings=getMealsAccounts()||{};
  var defaults=getMealsDefaults()||{};
  var daysCount=context?Math.max(0,parseInt(context.days,10)||0):0;
  var days=[];
  for(var day=1;day<=daysCount;day++)days.push(calculateMealsDayExpense(day));
  var enabled=mealsSettings.enabled!==false;
  var calculatedTotal=enabled?days.reduce(function(total,item){
    return total+(item.enabled?item.finalTotal:0);
  },0):0;
  var manualTotal=mealsSettings.manualTotal!==null&&mealsSettings.manualTotal!==undefined
    ?getAccountNumber(mealsSettings.manualTotal)
    :null;
  var finalTotal=enabled?(manualTotal!==null?manualTotal:calculatedTotal):0;
  if(defaults.calculationMode==='manual')finalTotal=enabled?(manualTotal===null?0:manualTotal):0;
  var formula=!enabled
    ?'حساب الوجبات غير مفعّل = '+formatAccountMoney(0)
    :(manualTotal!==null
      ?'الإجمالي اليدوي العام للوجبات = '+formatAccountMoney(manualTotal)
      :'إجمالي الوجبات = '+formatAccountMoney(finalTotal));
  var result={
    enabled:enabled,
    calculationMode:defaults.calculationMode||'restaurant_prices',
    days:days,
    daysCount:daysCount,
    enabledDaysCount:days.filter(function(item){return item.enabled}).length,
    calculatedTotal:calculatedTotal,
    manualTotal:manualTotal,
    finalTotal:finalTotal,
    formula:formula
  };
  return applyAccountExpenseEnvelope(
    result,
    {conferenceId:context&&context.conferenceId||'',daysCount:daysCount},
    {values:{enabled:enabled,calculationMode:result.calculationMode},sources:{enabled:'accounts',calculationMode:'accounts'}},
    {enabledDaysCount:result.enabledDaysCount},
    {calculatedTotal:calculatedTotal,manualTotal:manualTotal,finalTotal:finalTotal},
    {formula:formula}
  );
}

function getFinancialItemsCalculationContext(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  var daysCount=typeof getDays==='function'?Math.max(0,parseInt(getDays(),10)||0):0;
  var rooms=typeof getAllRooms==='function'?getAllRooms():[];
  var persons=typeof personsOnDay==='function'?personsOnDay(1):{adults:0,children:0};
  return {
    conference:conference,
    daysCount:daysCount,
    roomsCount:Array.isArray(rooms)?rooms.length:0,
    personsCount:getAccountNumber(persons&&persons.adults)+getAccountNumber(persons&&persons.children),
    daysSource:'أيام المؤتمر',
    roomsSource:'غرف المؤتمر',
    personsSource:'أشخاص المؤتمر'
  };
}

function buildFinancialItemFormula(method,result){
  if(method==='fixed')return 'مبلغ ثابت: '+formatAccountMoney(result.amount)+' = '+formatAccountMoney(result.total);
  if(method==='manual')return 'إجمالي يدوي: '+formatAccountMoney(result.total);
  if(method==='per_day')return result.quantity+' أيام × '+formatAccountMoney(result.unitPrice)+' = '+formatAccountMoney(result.total);
  if(method==='per_room')return result.quantity+' غرفة × '+formatAccountMoney(result.unitPrice)+' = '+formatAccountMoney(result.total);
  if(method==='per_person')return result.quantity+' شخصًا × '+formatAccountMoney(result.unitPrice)+' = '+formatAccountMoney(result.total);
  return result.quantity+' × '+formatAccountMoney(result.unitPrice)+' = '+formatAccountMoney(result.total);
}

function calculateFinancialItemByMethod(method,context){
  context=context||{};
  if(getSupportedFinancialItemMethods().indexOf(method)===-1)method='fixed';
  var amount=getAccountNumber(context.amount);
  var unitPrice=getAccountNumber(context.unitPrice);
  var quantity=0;
  var quantitySource='إدخال المستخدم';
  var priceSource=method==='fixed'||method==='manual'?'إدخال المستخدم':'سعر الوحدة المدخل';
  if(method==='quantity_price')quantity=getAccountNumber(context.quantity);
  else if(method==='per_day'){
    quantity=getAccountNumber(context.daysCount);
    quantitySource=context.daysSource||'أيام المؤتمر';
  }else if(method==='per_room'){
    quantity=getAccountNumber(context.roomsCount);
    quantitySource=context.roomsSource||'غرف المؤتمر';
  }else if(method==='per_person'){
    quantity=getAccountNumber(context.personsCount);
    quantitySource=context.personsSource||'أشخاص المؤتمر';
  }
  var total=method==='fixed'||method==='manual'?amount:quantity*unitPrice;
  if(!isFinite(total))total=0;
  var result={
    method:method,
    quantity:quantity,
    unitPrice:unitPrice,
    amount:amount,
    total:total,
    formula:'',
    quantitySource:quantitySource,
    priceSource:priceSource
  };
  result.formula=buildFinancialItemFormula(method,result);
  return result;
}

function calculateFinancialItem(item,context){
  var normalized=normalizeFinancialItem(item)||getDefaultFinancialItem();
  var calculationContext={
    amount:normalized.amount,
    quantity:normalized.quantity,
    unitPrice:normalized.unitPrice,
    daysCount:context.daysCount,
    roomsCount:context.roomsCount,
    personsCount:context.personsCount,
    daysSource:context.daysSource,
    roomsSource:context.roomsSource,
    personsSource:context.personsSource
  };
  var calculation=calculateFinancialItemByMethod(normalized.calculationMethod,calculationContext);
  return {
    id:normalized.id,
    type:normalized.type,
    category:normalized.category,
    name:normalized.name||'بند بدون اسم',
    enabled:normalized.enabled,
    calculationMethod:normalized.calculationMethod,
    quantity:calculation.quantity,
    unitPrice:calculation.unitPrice,
    amount:calculation.amount,
    total:normalized.enabled?calculation.total:0,
    formula:normalized.enabled?calculation.formula:'البند معطل = '+formatAccountMoney(0),
    quantitySource:calculation.quantitySource,
    priceSource:calculation.priceSource,
    notes:normalized.notes
  };
}

function calculateFinancialItems(){
  var settings=getFinancialItemsSettings()||{enabled:true,items:[]};
  var context=getFinancialItemsCalculationContext();
  var items=(settings.items||[]).map(function(item){
    return calculateFinancialItem(item,context);
  });
  var total=settings.enabled?items.reduce(function(sum,item){
    return sum+(item.enabled?item.total:0);
  },0):0;
  return {
    enabled:settings.enabled!==false,
    itemsCount:items.length,
    enabledItemsCount:items.filter(function(item){return item.enabled}).length,
    disabledItemsCount:items.filter(function(item){return !item.enabled}).length,
    items:items,
    total:total
  };
}

function calculateIncomeItem(item,context){
  var normalized=normalizeIncomeItem(item)||getDefaultIncomeItem();
  var calculation=calculateFinancialItemByMethod(normalized.calculationMethod,{
    amount:normalized.amount,
    quantity:normalized.quantity,
    unitPrice:normalized.unitPrice,
    daysCount:context.daysCount,
    roomsCount:context.roomsCount,
    personsCount:context.personsCount,
    daysSource:context.daysSource,
    roomsSource:context.roomsSource,
    personsSource:context.personsSource
  });
  return {
    id:normalized.id,
    type:'income',
    category:'general',
    name:normalized.name||'بند بدون اسم',
    enabled:normalized.enabled,
    calculationMethod:normalized.calculationMethod,
    quantity:calculation.quantity,
    unitPrice:calculation.unitPrice,
    amount:calculation.amount,
    total:normalized.enabled?calculation.total:0,
    formula:normalized.enabled?calculation.formula:'البند معطل = '+formatAccountMoney(0),
    quantitySource:calculation.quantitySource,
    priceSource:calculation.priceSource,
    notes:normalized.notes
  };
}

function calculateIncomeItems(){
  var settings=getIncomeItemsSettings()||{enabled:true,items:[]};
  var context=getFinancialItemsCalculationContext();
  var items=(settings.items||[]).map(function(item){
    return calculateIncomeItem(item,context);
  });
  var total=settings.enabled?items.reduce(function(sum,item){
    return sum+(item.enabled?item.total:0);
  },0):0;
  return {
    enabled:settings.enabled!==false,
    itemsCount:items.length,
    enabledItemsCount:items.filter(function(item){return item.enabled}).length,
    disabledItemsCount:items.filter(function(item){return !item.enabled}).length,
    items:items,
    total:total
  };
}

function getSettlementTypeLabel(target,operation){
  if(target==='income')return operation==='subtract'?'خصم إيراد':'إضافة إيراد';
  return operation==='subtract'?'خصم مصروف':'إضافة مصروف';
}

function getSettlementSign(operation){
  return operation==='subtract'?-1:1;
}

function formatSettlementSignedAmount(value){
  value=Number(value);
  if(!isFinite(value))value=0;
  return (value<0?'-':'')+formatAccountMoney(Math.abs(value));
}

function calculateSettlementItem(item,context){
  var normalized=normalizeSettlementItem(item)||getDefaultSettlementItem();
  var calculation=calculateFinancialItemByMethod(normalized.calculationMethod,{
    amount:normalized.amount,
    quantity:normalized.quantity,
    unitPrice:normalized.unitPrice,
    daysCount:context.daysCount,
    roomsCount:context.roomsCount,
    personsCount:context.personsCount,
    daysSource:context.daysSource,
    roomsSource:context.roomsSource,
    personsSource:context.personsSource
  });
  var unsignedTotal=calculation.total;
  var signedAmount=normalized.enabled?unsignedTotal*getSettlementSign(normalized.operation):0;
  var formula=getSettlementTypeLabel(normalized.target,normalized.operation)+'\n'+calculation.formula+
    '\nالتأثير: '+formatSettlementSignedAmount(signedAmount);
  if(!normalized.enabled)formula='التسوية معطلة\nالتأثير: '+formatSettlementSignedAmount(0);
  return {
    id:normalized.id,
    target:normalized.target,
    operation:normalized.operation,
    name:normalized.name||'تسوية بدون اسم',
    enabled:normalized.enabled,
    calculationMethod:normalized.calculationMethod,
    quantity:calculation.quantity,
    unitPrice:calculation.unitPrice,
    amount:calculation.amount,
    unsignedTotal:unsignedTotal,
    signedAmount:signedAmount,
    formula:formula,
    quantitySource:calculation.quantitySource,
    priceSource:calculation.priceSource,
    notes:normalized.notes
  };
}

function calculateSettlements(settingsOverride){
  var settings=settingsOverride?normalizeSettlements(settingsOverride):(getSettlementsSettings()||{enabled:true,items:[]});
  var context=getFinancialItemsCalculationContext();
  var sectionEnabled=settings.enabled!==false;
  var items=(settings.items||[]).map(function(item){
    var result=calculateSettlementItem(item,context);
    if(!sectionEnabled){
      result.signedAmount=0;
      var formulaLines=result.formula.split('\n');
      formulaLines[formulaLines.length-1]='قسم التسويات معطل — التأثير الفعلي: '+formatSettlementSignedAmount(0);
      result.formula=formulaLines.join('\n');
    }
    return result;
  });
  var expense={additions:0,deductions:0,netAdjustment:0};
  var income={additions:0,deductions:0,netAdjustment:0};
  if(sectionEnabled){
    items.forEach(function(item){
      if(!item.enabled)return;
      var target=item.target==='income'?income:expense;
      if(item.operation==='subtract')target.deductions+=item.unsignedTotal;
      else target.additions+=item.unsignedTotal;
    });
  }
  expense.netAdjustment=expense.additions-expense.deductions;
  income.netAdjustment=income.additions-income.deductions;
  return {
    enabled:sectionEnabled,
    itemsCount:items.length,
    enabledItemsCount:items.filter(function(item){return item.enabled}).length,
    disabledItemsCount:items.filter(function(item){return !item.enabled}).length,
    items:items,
    expense:expense,
    income:income
  };
}

function getSafeFinancialEngineTotal(engine,fieldName){
  if(!engine||engine.enabled===false)return 0;
  var value=Number(engine[fieldName]);
  return isFinite(value)?value:0;
}

// المرجع المالي الموحد مستقبلًا للتقارير والطباعة وPDF وExcel وDashboard.
function calculateConferenceFinancialSummary(){
  var context=getAccountsConferenceContext();
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  var accommodation=calculateAccommodationExpense(context);
  var airConditioning=calculateAirConditioningExpense(context);
  var meals=calculateMealsExpense(context);
  var additionalExpenses=calculateFinancialItems();
  var income=calculateIncomeItems();
  var settlements=calculateSettlements();
  var accommodationTotal=getSafeFinancialEngineTotal(accommodation,'finalTotal');
  var airConditioningTotal=getSafeFinancialEngineTotal(airConditioning,'finalTotal');
  var mealsTotal=getSafeFinancialEngineTotal(meals,'finalTotal');
  var additionalExpensesTotal=getSafeFinancialEngineTotal(additionalExpenses,'total');
  var incomeItemsTotal=getSafeFinancialEngineTotal(income,'total');
  var expenseSettlements=settlements&&settlements.expense||{};
  var incomeSettlements=settlements&&settlements.income||{};
  options=options&&typeof options==='object'?options:{};
  var normalized={
    reportType:options.reportType==='detailed'?'detailed':'summary'
  };
  Object.keys(defaults).forEach(function(key){
    if(key==='reportType')return;
    normalized[key]=typeof options[key]==='boolean'?options[key]:defaults[key];
  });
  return normalized;
}

function createFinancialReportSection(config){
  config=config||{};
  return {
    id:config.id||'',
    title:config.title||'',
    type:config.type||'table',
    enabled:config.enabled!==false,
    visible:config.visible!==false,
    columns:Array.isArray(config.columns)?config.columns:[],
    excelColumns:Array.isArray(config.excelColumns)?config.excelColumns:null,
    rows:Array.isArray(config.rows)?config.rows:[],
    totals:Array.isArray(config.totals)?config.totals:[],
    notes:Array.isArray(config.notes)?config.notes:[],
    warnings:Array.isArray(config.warnings)?config.warnings:[]
  };
}

function getAccommodationReportRoomContextMap(){
  var context=typeof getAccountsConferenceContext==='function'?getAccountsConferenceContext():null;
  var map={};
  (context&&context.rooms||[]).forEach(function(room){
    map[String(room.houseId)+'|'+String(room.id)]=room;
  });
  return map;
}

function getAccommodationReportDurationDisplay(room){
  if(room.durationMode==='actual_occupancy'){
    if(room.calculationMethod==='per_person'){
      if(room.timeUnit==='night'){
        return room.personNightQuantity===null||room.personNightQuantity===undefined
          ?null
          :room.personNightQuantity+' شخص-ليلة';
      }
      if(room.timeUnit==='day'){
        return room.personDayQuantity===null||room.personDayQuantity===undefined
          ?null
          :room.personDayQuantity+' شخص-يوم';
      }
    }
    if(room.timeUnit==='night'){
      return room.actualOccupiedNights===null||room.actualOccupiedNights===undefined
        ?null
        :room.actualOccupiedNights+' ليلة';
    }
    if(room.timeUnit==='day'){
      return room.actualOccupiedDays===null||room.actualOccupiedDays===undefined
        ?null
        :room.actualOccupiedDays+' يوم';
    }
  }
  if(room.duration===null||room.duration===undefined)return null;
  return getAccountDurationLabel(room.timeUnit,room.duration);
}

function getAccommodationReportActualOccupancyDisplay(room){
  if(room.durationMode!=='actual_occupancy')return null;
  if(room.calculationMethod==='per_person'){
    if(room.personDayQuantity===null||room.personDayQuantity===undefined||
       room.personNightQuantity===null||room.personNightQuantity===undefined)return null;
    return room.personDayQuantity+' شخص-يوم • '+room.personNightQuantity+' شخص-ليلة';
  }
  if(room.actualOccupiedDays===null||room.actualOccupiedDays===undefined||
     room.actualOccupiedNights===null||room.actualOccupiedNights===undefined)return null;
  return room.actualOccupiedDays+' أيام • '+room.actualOccupiedNights+' ليالٍ';
}

function getFinancialReportNumber(value){
  return typeof value==='number'&&isFinite(value)?value:null;
}

function getFinancialReportSectionNotes(enabled,rows){
  if(!enabled)return ['القسم غير مفعّل'];
  return rows.length?[]:['لا توجد بيانات'];
}

function copyFinancialReportObject(source){
  var copy={};
  Object.keys(source||{}).forEach(function(key){
    copy[key]=source[key];
  });
  return copy;
}

function buildFinancialReportSummarySection(summary){
  var expenses=summary.expenses||{};
  var income=summary.incomeSummary||{};
  var balance=summary.balance||{};
  var rows=[
    {label:'إجمالي الإقامة',value:getFinancialReportNumber(expenses.accommodationTotal),dataType:'money'},
    {label:'إجمالي التكييف',value:getFinancialReportNumber(expenses.airConditioningTotal),dataType:'money'},
    {label:'إجمالي الوجبات',value:getFinancialReportNumber(expenses.mealsTotal),dataType:'money'},
    {label:'إجمالي المصروفات الإضافية',value:getFinancialReportNumber(expenses.additionalExpensesTotal),dataType:'money'},
    {label:'المصروفات قبل التسويات',value:getFinancialReportNumber(expenses.beforeSettlement),dataType:'money'},
    {label:'إضافات المصروفات',value:getFinancialReportNumber(expenses.settlementAdditions),dataType:'money'},
    {label:'خصومات المصروفات',value:getFinancialReportNumber(expenses.settlementDeductions),dataType:'money'},
    {label:'المصروفات النهائية',value:getFinancialReportNumber(expenses.finalTotal),dataType:'money'},
    {label:'الإيرادات قبل التسويات',value:getFinancialReportNumber(income.beforeSettlement),dataType:'money'},
    {label:'إضافات الإيرادات',value:getFinancialReportNumber(income.settlementAdditions),dataType:'money'},
    {label:'خصومات الإيرادات',value:getFinancialReportNumber(income.settlementDeductions),dataType:'money'},
    {label:'الإيرادات النهائية',value:getFinancialReportNumber(income.finalTotal),dataType:'money'},
    {label:'إجمالي المصروفات',value:getFinancialReportNumber(balance.totalExpenses),dataType:'money'},
    {label:'إجمالي الإيرادات',value:getFinancialReportNumber(balance.totalIncome),dataType:'money'},
    {label:'الرصيد النهائي',value:getFinancialReportNumber(balance.net),dataType:'money'},
    {label:'حالة الرصيد',value:balance.status||'balanced',dataType:'text'}
  ];
  return createFinancialReportSection({
    id:'summary',
    title:'الملخص المالي',
    type:'summary',
    columns:[
      {key:'label',label:'البيان',dataType:'text'},
      {key:'value',label:'القيمة',dataType:'money'},
      {key:'dataType',label:'نوع البيانات',dataType:'text'}
    ],
    rows:rows
  });
}

function buildAccommodationReportSection(expense,options){
  expense=expense||{};
  var enabled=expense.enabled!==false;
  var columns=[
    {key:'houseName',label:'البيت',dataType:'text'},
    {key:'floorName',label:'الدور',dataType:'text'},
    {key:'roomNumber',label:'الغرفة',dataType:'text'},
    {key:'roomTypeLabel',label:'نوع الغرفة',dataType:'text'},
    {key:'calculationMethod',label:'طريقة الحساب',dataType:'text'},
    {key:'rate',label:'السعر',dataType:'money'},
    {key:'durationDisplay',label:'المدة',dataType:'text'},
    {key:'actualOccupancyDisplay',label:'الإقامة الفعلية',dataType:'text'},
    {key:'quantity',label:'الكمية',dataType:'number'},
    {key:'extraBedQuantity',label:'الأسرة الإضافية',dataType:'number'},
    {key:'finalTotal',label:'الإجمالي النهائي',dataType:'money'}
  ];
  if(options.includeFormulas)columns.push({key:'formula',label:'المعادلة',dataType:'formula'});
  var excelColumns=[
    {key:'houseName',label:'البيت',dataType:'text'},
    {key:'floorName',label:'الدور',dataType:'text'},
    {key:'roomNumber',label:'رقم الغرفة',dataType:'text'},
    {key:'roomTypeLabel',label:'نوع الغرفة',dataType:'text'},
    {key:'calculationMethod',label:'طريقة الحساب',dataType:'text'},
    {key:'timeUnit',label:'وحدة الوقت',dataType:'text'},
    {key:'roomTypeRate',label:'سعر النوع',dataType:'money'},
    {key:'rate',label:'السعر المستخدم',dataType:'money'},
    {key:'rateSource',label:'مصدر السعر',dataType:'text'},
    {key:'actualOccupiedDays',label:'الأيام الفعلية',dataType:'number'},
    {key:'actualOccupiedNights',label:'الليالي الفعلية',dataType:'number'},
    {key:'personDayQuantity',label:'شخص-يوم',dataType:'number'},
    {key:'personNightQuantity',label:'شخص-ليلة',dataType:'number'},
    {key:'quantity',label:'الكمية',dataType:'number'},
    {key:'duration',label:'المدة',dataType:'number'},
    {key:'baseAmount',label:'التكلفة الأساسية',dataType:'money'},
    {key:'extraBedQuantity',label:'عدد الأسرة الإضافية',dataType:'number'},
    {key:'extraBedRate',label:'سعر السرير الإضافي',dataType:'money'},
    {key:'extraBedsAmount',label:'تكلفة الأسرة الإضافية',dataType:'money'},
    {key:'finalTotal',label:'الإجمالي النهائي',dataType:'money'}
  ];
  if(options.includeFormulas)excelColumns.push({key:'formula',label:'صيغة الحساب',dataType:'formula'});
  var rows=[];
  var roomContextMap=getAccommodationReportRoomContextMap();
  (expense.houses||[]).forEach(function(house){
    if(!options.includeDisabledItems&&house.enabled===false)return;
    (house.rooms||[]).forEach(function(room){
      if(!options.includeDisabledItems&&!room.included)return;
      var roomContext=roomContextMap[String(house.houseId)+'|'+String(room.roomId)]||{};
      var isRoomType=room.calculationMethod==='room_type';
      var isActual=room.durationMode==='actual_occupancy';
      var effectiveRate=isRoomType?room.roomTypeRate:room.rate;
      var effectiveRateSource=isRoomType?room.roomTypeRateSource:room.rateSource;
      var roomTypeLabel=room.roomTypeLabel||(
        roomContext.sourceRoom&&typeof getRoomTypeLabel==='function'
          ?getRoomTypeLabel(roomContext.sourceRoom)
          :null
      );
      var row={
        houseName:house.houseName||'',
        floorName:roomContext.floorName||null,
        roomNumber:room.roomNumber||'',
        roomTypeLabel:roomTypeLabel,
        status:house.enabled===false
          ?'غير مفعّل — غير محتسب'
          :(room.included?'محتسب':(room.excludedReason||'غير مفعّل — غير محتسب')),
        calculationMethod:getAccountCalculationMethodLabel(room.calculationMethod),
        timeUnit:getAccountTimeUnitLabel(room.timeUnit),
        durationMode:room.durationMode||'',
        quantity:getFinancialReportNumber(room.quantity),
        duration:getFinancialReportNumber(room.duration),
        durationDisplay:getAccommodationReportDurationDisplay(room),
        actualOccupancyDisplay:getAccommodationReportActualOccupancyDisplay(room),
        rate:getFinancialReportNumber(effectiveRate),
        rateSource:effectiveRateSource?getAccountSettingSourceLabel(effectiveRateSource):null,
        roomTypeRate:isRoomType?getFinancialReportNumber(room.roomTypeRate):null,
        personQuantity:getFinancialReportNumber(room.personQuantity),
        personTimeQuantity:isActual?getFinancialReportNumber(room.personTimeQuantity):null,
        actualOccupiedDays:isActual?getFinancialReportNumber(room.actualOccupiedDays):null,
        actualOccupiedNights:isActual?getFinancialReportNumber(room.actualOccupiedNights):null,
        personDayQuantity:isActual?getFinancialReportNumber(room.personDayQuantity):null,
        personNightQuantity:isActual?getFinancialReportNumber(room.personNightQuantity):null,
        extraBedQuantity:getFinancialReportNumber(room.extraBedQuantity),
        extraBedRate:getFinancialReportNumber(room.extraBedRate),
        baseAmount:getFinancialReportNumber(room.baseAmount),
        extraBedsAmount:getFinancialReportNumber(room.extraBedsAmount),
        calculatedTotal:getFinancialReportNumber(room.calculatedTotal),
        manualTotal:getFinancialReportNumber(room.manualTotal),
        finalTotal:getFinancialReportNumber(room.finalTotal),
        formula:room.formula||''
      };
      rows.push(row);
    });
  });
  return createFinancialReportSection({
    id:'accommodation',
    title:'الإقامة',
    type:'grouped-table',
    enabled:enabled,
    columns:columns,
    excelColumns:excelColumns,
    rows:rows,
    totals:[{label:'إجمالي الإقامة',value:getFinancialReportNumber(expense.finalTotal),dataType:'money'}],
    notes:getFinancialReportSectionNotes(enabled,rows)
  });
}

function buildAirConditioningReportSection(expense,options){
  expense=expense||{};
  var enabled=expense.enabled!==false;
  var columns=[
    {key:'houseName',label:'البيت',dataType:'text'},
    {key:'roomNumber',label:'الغرفة',dataType:'text'},
    {key:'status',label:'الحالة',dataType:'text'},
    {key:'calculationMethod',label:'طريقة الحساب',dataType:'text'},
    {key:'unitsCount',label:'عدد الوحدات',dataType:'number'},
    {key:'unitsCountSource',label:'مصدر عدد الوحدات',dataType:'text'},
    {key:'personQuantity',label:'عدد الأشخاص',dataType:'number'},
    {key:'quantity',label:'الكمية',dataType:'number'},
    {key:'duration',label:'المدة',dataType:'number'},
    {key:'rate',label:'السعر',dataType:'money'},
    {key:'rateSource',label:'مصدر السعر',dataType:'text'},
    {key:'calculatedTotal',label:'الإجمالي المحسوب',dataType:'money'},
    {key:'manualTotal',label:'الإجمالي اليدوي',dataType:'money'},
    {key:'finalTotal',label:'الإجمالي النهائي',dataType:'money'}
  ];
  if(options.includeFormulas)columns.push({key:'formula',label:'المعادلة',dataType:'formula'});
  var rows=[];
  (expense.houses||[]).forEach(function(house){
    if(!options.includeDisabledItems&&house.enabled===false)return;
    (house.rooms||[]).forEach(function(room){
      if(!options.includeDisabledItems&&!room.included)return;
      var row={
        houseName:house.houseName||'',
        roomNumber:room.roomNumber||'',
        status:house.enabled===false
          ?'غير مفعّل — غير محتسب'
          :(room.included?'محتسب':(room.excludedReason||'غير مفعّل — غير محتسب')),
        calculationMethod:room.calculationMethod||'',
        unitsCount:getFinancialReportNumber(room.unitsCount),
        unitsCountSource:room.unitsCountSource||'',
        personQuantity:getFinancialReportNumber(room.personQuantity),
        quantity:getFinancialReportNumber(room.quantity),
        duration:getFinancialReportNumber(room.duration),
        rate:getFinancialReportNumber(room.rate),
        rateSource:room.rateSource||'',
        calculatedTotal:getFinancialReportNumber(room.calculatedTotal),
        manualTotal:getFinancialReportNumber(room.manualTotal),
        finalTotal:getFinancialReportNumber(room.finalTotal)
      };
      if(options.includeFormulas)row.formula=room.formula||'';
      rows.push(row);
    });
  });
  return createFinancialReportSection({
    id:'air_conditioning',
    title:'التكييف',
    type:'grouped-table',
    enabled:enabled,
    columns:columns,
    rows:rows,
    totals:[{label:'إجمالي التكييف',value:getFinancialReportNumber(expense.finalTotal),dataType:'money'}],
    notes:getFinancialReportSectionNotes(enabled,rows)
  });
}

function buildMealsReportSection(expense,options){
  expense=expense||{};
  var enabled=expense.enabled!==false;
  var columns=[
    {key:'day',label:'اليوم',dataType:'number'},
    {key:'meal',label:'الوجبة',dataType:'text'},
    {key:'status',label:'الحالة',dataType:'text'},
    {key:'adults',label:'البالغون',dataType:'number'},
    {key:'children',label:'الأطفال',dataType:'number'},
    {key:'adultPrice',label:'سعر البالغ',dataType:'money'},
    {key:'childPrice',label:'سعر الطفل',dataType:'money'},
    {key:'adultsAmount',label:'إجمالي البالغين',dataType:'money'},
    {key:'childrenAmount',label:'إجمالي الأطفال',dataType:'money'},
    {key:'calculatedTotal',label:'الإجمالي المحسوب',dataType:'money'},
    {key:'manualTotal',label:'الإجمالي اليدوي',dataType:'money'},
    {key:'finalTotal',label:'الإجمالي النهائي',dataType:'money'}
  ];
  if(options.includeFormulas)columns.push({key:'formula',label:'المعادلة',dataType:'formula'});
  var rows=[];
  (expense.days||[]).forEach(function(day){
    ['breakfast','lunch','dinner'].forEach(function(mealKey){
      var meal=day.meals&&day.meals[mealKey];
      if(!meal)return;
      var itemEnabled=enabled&&day.enabled!==false&&meal.enabled!==false;
      if(!options.includeDisabledItems&&!itemEnabled)return;
      var row={
        day:getFinancialReportNumber(day.day),
        meal:typeof getAccountMealLabel==='function'?getAccountMealLabel(mealKey):mealKey,
        status:itemEnabled?'محتسب':'غير مفعّل — غير محتسب',
        adults:getFinancialReportNumber(meal.adults),
        children:getFinancialReportNumber(meal.children),
        adultPrice:getFinancialReportNumber(meal.adultPrice),
        childPrice:getFinancialReportNumber(meal.childPrice),
        adultsAmount:getFinancialReportNumber(meal.adultsAmount),
        childrenAmount:getFinancialReportNumber(meal.childrenAmount),
        calculatedTotal:getFinancialReportNumber(meal.calculatedTotal),
        manualTotal:getFinancialReportNumber(meal.manualTotal),
        finalTotal:getFinancialReportNumber(meal.finalTotal)
      };
      if(options.includeFormulas)row.formula=meal.formula||'';
      rows.push(row);
    });
  });
  return createFinancialReportSection({
    id:'meals',
    title:'الوجبات',
    type:'table',
    enabled:enabled,
    columns:columns,
    rows:rows,
    totals:[{label:'إجمالي الوجبات',value:getFinancialReportNumber(expense.finalTotal),dataType:'money'}],
    notes:getFinancialReportSectionNotes(enabled,rows)
  });
}

function buildFinancialItemsReportSection(engine,options,config){
  engine=engine||{};
  var enabled=engine.enabled!==false;
  var columns=[
    {key:'name',label:'الاسم',dataType:'text'},
    {key:'status',label:'الحالة',dataType:'text'},
    {key:'category',label:'التصنيف',dataType:'text'},
    {key:'calculationMethod',label:'طريقة الحساب',dataType:'text'},
    {key:'quantity',label:'الكمية',dataType:'number'},
    {key:'unitPrice',label:'السعر',dataType:'money'},
    {key:'amount',label:'المبلغ',dataType:'money'},
    {key:'total',label:'الإجمالي',dataType:'money'},
    {key:'quantitySource',label:'مصدر الكمية',dataType:'text'},
    {key:'priceSource',label:'مصدر السعر',dataType:'text'}
  ];
  if(options.includeFormulas)columns.push({key:'formula',label:'المعادلة',dataType:'formula'});
  if(options.includeNotes)columns.push({key:'notes',label:'الملاحظات',dataType:'text'});
  var rows=[];
  (engine.items||[]).forEach(function(item){
    var itemEnabled=enabled&&item.enabled!==false;
    if(!options.includeDisabledItems&&!itemEnabled)return;
    var row={
      name:item.name||'',
      status:itemEnabled?'محتسب':'غير مفعّل — غير محتسب',
      category:item.category||'',
      calculationMethod:item.calculationMethod||'',
      quantity:getFinancialReportNumber(item.quantity),
      unitPrice:getFinancialReportNumber(item.unitPrice),
      amount:getFinancialReportNumber(item.amount),
      total:getFinancialReportNumber(item.total),
      quantitySource:item.quantitySource||'',
      priceSource:item.priceSource||''
    };
    if(options.includeFormulas)row.formula=item.formula||'';
    if(options.includeNotes)row.notes=item.notes||'';
    rows.push(row);
  });
  return createFinancialReportSection({
    id:config.id,
    title:config.title,
    type:'table',
    enabled:enabled,
    columns:columns,
    rows:rows,
    totals:[{label:config.totalLabel,value:getFinancialReportNumber(engine.total),dataType:'money'}],
    notes:getFinancialReportSectionNotes(enabled,rows)
  });
}

function buildAdditionalExpensesReportSection(expense,options){
  return buildFinancialItemsReportSection(expense,options,{
    id:'additional_expenses',
    title:'المصروفات الإضافية',
    totalLabel:'إجمالي المصروفات الإضافية'
  });
}

function buildIncomeReportSection(income,options){
  return buildFinancialItemsReportSection(income,options,{
    id:'income',
    title:'الإيرادات',
    totalLabel:'إجمالي الإيرادات'
  });
}

function buildSettlementsReportSection(settlements,options){
  settlements=settlements||{};
  var enabled=settlements.enabled!==false;
  var columns=[
    {key:'name',label:'الاسم',dataType:'text'},
    {key:'target',label:'الهدف',dataType:'text'},
    {key:'operation',label:'العملية',dataType:'text'},
    {key:'settlementType',label:'نوع التسوية',dataType:'text'},
    {key:'status',label:'الحالة',dataType:'text'},
    {key:'calculationMethod',label:'طريقة الحساب',dataType:'text'},
    {key:'quantity',label:'الكمية',dataType:'number'},
    {key:'unitPrice',label:'السعر',dataType:'money'},
    {key:'amount',label:'المبلغ',dataType:'money'},
    {key:'unsignedTotal',label:'القيمة دون إشارة',dataType:'money'},
    {key:'signedAmount',label:'التأثير الموقّع',dataType:'money'},
    {key:'quantitySource',label:'مصدر الكمية',dataType:'text'},
    {key:'priceSource',label:'مصدر السعر',dataType:'text'}
  ];
  if(options.includeFormulas)columns.push({key:'formula',label:'المعادلة',dataType:'formula'});
  if(options.includeNotes)columns.push({key:'notes',label:'الملاحظات',dataType:'text'});
  var rows=[];
  (settlements.items||[]).forEach(function(item){
    var itemEnabled=enabled&&item.enabled!==false;
    if(!options.includeDisabledItems&&!itemEnabled)return;
    var row={
      name:item.name||'',
      target:item.target||'',
      operation:item.operation||'',
      settlementType:typeof getSettlementTypeLabel==='function'
        ?getSettlementTypeLabel(item.target,item.operation)
        :'',
      status:itemEnabled?'محتسب':'غير مفعّل — غير محتسب',
      calculationMethod:item.calculationMethod||'',
      quantity:getFinancialReportNumber(item.quantity),
      unitPrice:getFinancialReportNumber(item.unitPrice),
      amount:getFinancialReportNumber(item.amount),
      unsignedTotal:getFinancialReportNumber(item.unsignedTotal),
      signedAmount:getFinancialReportNumber(item.signedAmount),
      quantitySource:item.quantitySource||'',
      priceSource:item.priceSource||''
    };
    if(options.includeFormulas)row.formula=item.formula||'';
    if(options.includeNotes)row.notes=item.notes||'';
    rows.push(row);
  });
  return createFinancialReportSection({
    id:'settlements',
    title:'التسويات النهائية',
    type:'table',
    enabled:enabled,
    columns:columns,
    rows:rows,
    totals:[
      {label:'صافي تسويات المصروفات',value:getFinancialReportNumber(settlements.expense&&settlements.expense.netAdjustment),dataType:'money'},
      {label:'صافي تسويات الإيرادات',value:getFinancialReportNumber(settlements.income&&settlements.income.netAdjustment),dataType:'money'}
    ],
    notes:getFinancialReportSectionNotes(enabled,rows)
  });
}

function buildFinancialReportWarningsSection(warnings){
  var rows=(warnings||[]).map(function(warning){
    return {
      code:warning&&warning.code||'',
      message:warning&&warning.message||''
    };
  });
  return createFinancialReportSection({
    id:'warnings',
    title:'التحذيرات',
    type:'warnings',
    columns:[
      {key:'code',label:'الرمز',dataType:'text'},
      {key:'message',label:'التحذير',dataType:'text'}
    ],
    rows:rows,
    notes:rows.length?[]:['لا توجد تحذيرات']
  });
}

function buildConferenceFinancialReportModel(options){
  var normalizedOptions=normalizeFinancialReportOptions(options);
  var financialSummary=calculateConferenceFinancialSummary();
  var conference=financialSummary.conference||{};
  var sections=[buildFinancialReportSummarySection(financialSummary)];
  if(normalizedOptions.reportType==='detailed'){
    if(normalizedOptions.includeAccommodationDetails){
      sections.push(buildAccommodationReportSection(financialSummary.accommodation,normalizedOptions));
    }
    if(normalizedOptions.includeAirConditioningDetails){
      sections.push(buildAirConditioningReportSection(financialSummary.airConditioning,normalizedOptions));
    }
    if(normalizedOptions.includeMealsDetails){
      sections.push(buildMealsReportSection(financialSummary.meals,normalizedOptions));
    }
    if(normalizedOptions.includeAdditionalExpensesDetails){
      sections.push(buildAdditionalExpensesReportSection(financialSummary.additionalExpenses,normalizedOptions));
    }
    if(normalizedOptions.includeIncomeDetails){
      sections.push(buildIncomeReportSection(financialSummary.income,normalizedOptions));
    }
    if(normalizedOptions.includeSettlementsDetails){
      sections.push(buildSettlementsReportSection(financialSummary.settlements,normalizedOptions));
    }
  }
  if(normalizedOptions.includeWarnings){
    sections.push(buildFinancialReportWarningsSection(financialSummary.warnings));
  }
  return {
    metadata:{
      conferenceId:conference.id||'',
      conferenceName:conference.name||'',
      // يحتاج التاريخان إلى إضافتهما مستقبلًا داخل الملخص المالي الموحد إذا تقرر عرضهما.
      startDate:'',
      endDate:'',
      daysCount:getFinancialReportNumber(conference.daysCount),
      currency:conference.currency||'EGP',
      generatedAt:normalizedOptions.showGeneratedAt?(financialSummary.generatedAt||''):''
    },
    options:normalizedOptions,
    summary:{
      expenses:copyFinancialReportObject(financialSummary.expenses),
      income:copyFinancialReportObject(financialSummary.incomeSummary),
      balance:copyFinancialReportObject(financialSummary.balance)
    },
    sections:sections,
    warnings:(financialSummary.warnings||[]).map(function(warning){
      return {
        code:warning&&warning.code||'',
        message:warning&&warning.message||''
      };
    })
  };
}

var financialReportOptionsDraft=null;
var financialReportOptionsDraftConferenceId='';

function resetFinancialReportOptionsDraft(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  financialReportOptionsDraft=getDefaultFinancialReportOptions();
  financialReportOptionsDraftConferenceId=conference&&conference.id||'';
  return financialReportOptionsDraft;
}

function getFinancialReportOptionsDraft(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  var conferenceId=conference&&conference.id||'';
  if(!financialReportOptionsDraft||financialReportOptionsDraftConferenceId!==conferenceId){
    resetFinancialReportOptionsDraft();
  }
  return financialReportOptionsDraft;
}

function refreshFinancialReportsPanel(){
  var panel=typeof ge==='function'?ge('financialReportsPanel'):document.getElementById('financialReportsPanel');
  if(panel)panel.outerHTML=renderFinancialReportsSettings();
}

function updateFinancialReportOption(optionName,value){
  var defaults=getDefaultFinancialReportOptions();
  if(!Object.prototype.hasOwnProperty.call(defaults,optionName))return;
  var draft=getFinancialReportOptionsDraft();
  if(optionName==='reportType'){
    draft.reportType=value==='detailed'?'detailed':'summary';
  }else if(typeof value==='boolean'){
    draft[optionName]=value;
  }
  refreshFinancialReportsPanel();
}

function resetFinancialReportOptions(){
  resetFinancialReportOptionsDraft();
  refreshFinancialReportsPanel();
}

function getFinancialReportOptionLabel(optionName){
  var labels={
    includeAccommodationDetails:'تفاصيل الإقامة',
    includeAirConditioningDetails:'تفاصيل التكييف',
    includeMealsDetails:'تفاصيل الوجبات',
    includeAdditionalExpensesDetails:'تفاصيل المصروفات الإضافية',
    includeIncomeDetails:'تفاصيل الإيرادات',
    includeSettlementsDetails:'تفاصيل التسويات',
    includeDisabledItems:'إظهار البنود المعطلة وغير المحتسبة',
    includeFormulas:'إظهار المعادلات',
    includeNotes:'إظهار الملاحظات',
    includeWarnings:'إظهار التحذيرات',
    showGeneratedAt:'إظهار وقت إنشاء التقرير'
  };
  return labels[optionName]||optionName;
}

function formatFinancialReportDateValue(value,includeTime){
  if(!value)return '—';
  var date=new Date(value);
  if(isNaN(date.getTime()))return '—';
  try{
    return includeTime
      ?date.toLocaleString('ar-EG')
      :date.toLocaleDateString('ar-EG');
  }catch(error){
    return includeTime?date.toLocaleString():date.toLocaleDateString();
  }
}

function formatFinancialReportCellValue(value,dataType){
  if(value===null||value===undefined||(typeof value==='number'&&!isFinite(value)))return '—';
  if(dataType==='money'){
    var money=Number(value);
    if(!isFinite(money))return '—';
    return esc(money<0?formatSettlementSignedAmount(money):formatAccountMoney(money));
  }
  if(dataType==='number'){
    var number=Number(value);
    return isFinite(number)?esc(number.toLocaleString('ar-EG')):'—';
  }
  if(dataType==='boolean')return value?'نعم':'لا';
  if(dataType==='date')return esc(formatFinancialReportDateValue(value,false));
  if(dataType==='datetime')return esc(formatFinancialReportDateValue(value,true));
  if(dataType==='formula')return '<span style="white-space:pre-line">'+esc(String(value))+'</span>';
  return esc(String(value));
}

function getFinancialReportBalanceStatusLabel(status){
  if(status==='surplus')return 'فائض';
  if(status==='deficit')return 'عجز';
  return 'متعادل';
}

function renderFinancialReportSummary(section){
  var html='<div class="settings-summary-grid">';
  (section.rows||[]).forEach(function(row){
    var value=row.label==='حالة الرصيد'
      ?esc(getFinancialReportBalanceStatusLabel(row.value))
      :formatFinancialReportCellValue(row.value,row.dataType);
    html+='<div class="settings-summary-card"><span>'+esc(row.label||'')+'</span><strong>'+value+'</strong></div>';
  });
  html+='</div>';
  return html;
}

function renderFinancialReportTable(section){
  if(!section.rows||!section.rows.length)return '';
  var html='<div style="overflow-x:auto"><table><thead><tr>';
  (section.columns||[]).forEach(function(column){
    html+='<th>'+esc(column.label||'')+'</th>';
  });
  html+='</tr></thead><tbody>';
  section.rows.forEach(function(row){
    html+='<tr>';
    (section.columns||[]).forEach(function(column){
      html+='<td>'+formatFinancialReportCellValue(row[column.key],column.dataType)+'</td>';
    });
    html+='</tr>';
  });
  html+='</tbody></table></div>';
  return html;
}

function renderFinancialReportWarnings(section){
  if(!section.rows||!section.rows.length)return '';
  var html='<div class="settings-empty-state">';
  section.rows.forEach(function(warning){
    html+='<div style="margin-bottom:6px"><b>⚠️ '+esc(warning.message||'')+'</b>';
    if(warning.code)html+='<div class="settings-branding-file-name">'+esc(warning.code)+'</div>';
    html+='</div>';
  });
  html+='</div>';
  return html;
}

function renderFinancialReportSection(section){
  if(!section||section.visible===false)return '';
  if(section.id==='warnings'&&(!section.rows||!section.rows.length))return '';
  var html='<section class="settings-section" style="margin-top:10px">';
  html+='<div class="settings-section-title"><b>'+esc(section.title||'')+'</b>';
  if(section.enabled===false){
    html+='<span class="settings-branding-file-name" style="margin-right:8px">القسم غير مفعّل</span>';
  }
  html+='</div>';
  if(section.id==='summary')html+=renderFinancialReportSummary(section);
  else if(section.id==='warnings')html+=renderFinancialReportWarnings(section);
  else if(section.rows&&section.rows.length)html+=renderFinancialReportTable(section);
  (section.notes||[]).forEach(function(note){
    html+='<div class="settings-empty-state" style="margin-top:8px">'+esc(note)+'</div>';
  });
  if(section.enabled!==false&&(!section.rows||!section.rows.length)&&!(section.notes||[]).length){
    html+='<div class="settings-empty-state">لا توجد بيانات</div>';
  }
  if(section.totals&&section.totals.length){
    html+='<div class="settings-summary-grid" style="margin-top:10px">';
    section.totals.forEach(function(total){
      html+='<div class="settings-summary-card"><span>'+esc(total.label||'')+'</span><strong>'+
        formatFinancialReportCellValue(total.value,total.dataType)+'</strong></div>';
    });
    html+='</div>';
  }
  (section.warnings||[]).forEach(function(warning){
    html+='<div class="settings-empty-state" style="margin-top:8px">⚠️ '+esc(warning.message||warning)+'</div>';
  });
  html+='</section>';
  return html;
}

function renderFinancialReportPreview(){
  var model=buildConferenceFinancialReportModel(getFinancialReportOptionsDraft());
  var metadata=model.metadata||{};
  var html='<div class="settings-section financial-report-preview">';
  html+='<div class="settings-section-title"><b>معاينة التقرير المالي</b></div>';
  html+='<div class="settings-summary-grid">';
  html+='<div class="settings-summary-card"><span>المؤتمر</span><strong>'+esc(metadata.conferenceName||'—')+'</strong></div>';
  html+='<div class="settings-summary-card"><span>عدد الأيام</span><strong>'+
    formatFinancialReportCellValue(metadata.daysCount,'number')+'</strong></div>';
  html+='<div class="settings-summary-card"><span>العملة</span><strong>'+esc(metadata.currency||'EGP')+'</strong></div>';
  html+='<div class="settings-summary-card"><span>نوع التقرير</span><strong>'+
    (model.options.reportType==='detailed'?'تقرير تفصيلي':'تقرير مختصر')+'</strong></div>';
  if(model.options.showGeneratedAt&&metadata.generatedAt){
    html+='<div class="settings-summary-card"><span>وقت إنشاء التقرير</span><strong>'+
      formatFinancialReportCellValue(metadata.generatedAt,'datetime')+'</strong></div>';
  }
  html+='</div>';
  model.sections.forEach(function(section){
    html+=renderFinancialReportSection(section);
  });
  html+='</div>';
  return html;
}

function renderFinancialReportsSettings(){
  var draft=getFinancialReportOptionsDraft();
  var detailOptions=[
    'includeAccommodationDetails',
    'includeAirConditioningDetails',
    'includeMealsDetails',
    'includeAdditionalExpensesDetails',
    'includeIncomeDetails',
    'includeSettlementsDetails'
  ];
  var generalOptions=[
    'includeDisabledItems',
    'includeFormulas',
    'includeNotes',
    'includeWarnings',
    'showGeneratedAt'
  ];
  var html='<div id="financialReportsPanel" class="financial-report-panel">';
  html+='<style>'+
    '#financialReportsPanel{direction:rtl;color:#173b5f;min-width:0;overflow:visible;padding-top:12px}'+
    '#financialReportsPanel *{box-sizing:border-box}'+
    '#financialReportsPanel .financial-report-type{max-width:420px;min-width:0;padding:12px;border:1px solid #dce7f0;border-radius:10px;background:#fbfdff;color:#173b5f}'+
    '#financialReportsPanel .financial-report-type label{display:block;margin-bottom:7px;color:#173b5f;font-weight:800;white-space:normal}'+
    '#financialReportsPanel .financial-report-type select{width:100%;min-height:40px;color:#173b5f;background:#fff}'+
    '#financialReportsPanel .financial-report-options-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;width:100%;min-width:0;margin-top:10px;overflow:visible}'+
    '#financialReportsPanel .financial-report-option{display:flex;align-items:center;justify-content:flex-start;gap:8px;direction:rtl;min-width:0;min-height:48px;padding:11px 12px;border:1px solid #dce7f0;border-radius:10px;background:#fbfdff;color:#173b5f;overflow:visible;cursor:pointer}'+
    '#financialReportsPanel .financial-report-option input{flex:0 0 auto;width:18px;height:18px;margin:0;position:static}'+
    '#financialReportsPanel .financial-report-option span{display:block;flex:1 1 auto;min-width:0;color:#173b5f;font-size:12px;font-weight:700;line-height:1.5;white-space:normal;word-break:normal;overflow:visible}'+
    '#financialReportsPanel .financial-report-options-disabled{opacity:.65}'+
    '#financialReportsPanel .financial-report-options-disabled .financial-report-option{color:#173b5f;background:#f3f6f9;cursor:not-allowed}'+
    '#financialReportsPanel .financial-report-help{margin:10px 0 2px;padding:8px 10px;color:#425f78;background:#f4f8fb;border-radius:8px;white-space:normal}'+
    '#financialReportsPanel .financial-report-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;width:100%;min-width:0;margin-top:14px;padding:10px 0;position:static;overflow:visible;clear:both}'+
    '#financialReportsPanel .financial-report-actions .btn{position:static;flex:1 1 150px;min-width:130px;max-width:100%;min-height:38px;margin:0}'+
    '#financialReportsPanel .financial-report-note{display:block;margin:2px 0 12px;color:#425f78;font-size:10px;white-space:normal}'+
    '#financialReportsPanel .financial-report-preview{clear:both;min-width:0;margin-top:12px;overflow:visible;color:#173b5f}'+
    '#financialReportsPanel .financial-report-preview .settings-section-title,'+
    '#financialReportsPanel .financial-report-preview .settings-summary-card span,'+
    '#financialReportsPanel .financial-report-preview .settings-summary-card strong{color:#173b5f}'+
    '#financialReportsPanel .financial-report-preview table{min-width:max-content}'+
    '@media(max-width:600px){#financialReportsPanel .financial-report-options-grid{grid-template-columns:1fr}#financialReportsPanel .financial-report-actions .btn{flex-basis:100%}}'+
    '</style>';
  html+='<div class="financial-report-type"><label for="financial_report_type">نوع التقرير</label>';
  html+='<select id="financial_report_type" onchange="updateFinancialReportOption(\'reportType\',this.value)">';
  html+='<option value="summary"'+(draft.reportType==='summary'?' selected':'')+'>تقرير مختصر</option>';
  html+='<option value="detailed"'+(draft.reportType==='detailed'?' selected':'')+'>تقرير تفصيلي</option>';
  html+='</select></div>';
  html+='<div class="financial-report-help">خيارات الأقسام التالية تعمل عند اختيار التقرير التفصيلي.</div>';
  html+='<div class="financial-report-options-grid'+(draft.reportType==='summary'?' financial-report-options-disabled':'')+'">';
  detailOptions.forEach(function(optionName){
    html+='<label class="financial-report-option"><input type="checkbox" '+(draft[optionName]?'checked ':'')+
      (draft.reportType==='summary'?'disabled ':'')+
      'onchange="updateFinancialReportOption(\''+optionName+'\',this.checked)"><span>'+
      esc(getFinancialReportOptionLabel(optionName))+'</span></label>';
  });
  html+='</div><div class="financial-report-options-grid">';
  generalOptions.forEach(function(optionName){
    html+='<label class="financial-report-option"><input type="checkbox" '+(draft[optionName]?'checked ':'')+
      'onchange="updateFinancialReportOption(\''+optionName+'\',this.checked)"><span>'+
      esc(getFinancialReportOptionLabel(optionName))+'</span></label>';
  });
  html+='</div>';
  html+='<div class="financial-report-actions">';
  html+='<button type="button" class="btn" onclick="refreshFinancialReportsPanel()">تحديث المعاينة</button>';
  html+='<button type="button" class="btn" onclick="resetFinancialReportOptions()">إعادة ضبط الإعدادات</button>';
  html+='<button type="button" class="btn" onclick="printConferenceFinancialReport()">طباعة</button>';
  html+='<button type="button" class="btn" onclick="saveConferenceFinancialReportAsPdf()">حفظ PDF</button>';
  html+='<button type="button" class="btn" onclick="exportConferenceFinancialReportToExcel()">تصدير Excel</button>';
  html+='</div>';
  html+='<div class="financial-report-note">يتم حفظ PDF من نافذة الطباعة.</div>';
  html+=renderFinancialReportPreview();
  html+='</div>';
  return html;
}

function buildFinancialReportPrintStyles(){
  return [
    '@page{size:A4;margin:12mm}',
    '*{box-sizing:border-box}',
    'html,body{margin:0;padding:0;background:#fff;color:#1A2A3A;direction:rtl}',
    'body{font-family:Tahoma,\"Segoe UI\",Arial,sans-serif;font-size:11px;line-height:1.55}',
    '.report-document{width:100%}',
    '.report-header{border:1px solid #cfd8e3;border-top:5px solid #6C3483;border-radius:8px;padding:14px;margin-bottom:12px;break-inside:avoid;page-break-inside:avoid}',
    '.report-header h1{font-size:22px;margin:0 0 8px;color:#6C3483}',
    '.report-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}',
    '.report-meta div{border:1px solid #dde4ec;border-radius:6px;padding:6px 8px;background:#f8fafc}',
    '.report-meta span{display:block;color:#64748b;font-size:9px}',
    '.report-meta strong{display:block;font-size:11px}',
    '.report-section{margin:0 0 12px;break-inside:avoid-page;page-break-inside:avoid}',
    '.report-section.report-table-section{break-inside:auto;page-break-inside:auto}',
    '.report-section-title{display:flex;align-items:center;gap:8px;margin:0 0 6px;padding:6px 8px;background:#eef2f7;border-right:4px solid #6C3483;font-size:15px}',
    '.status-badge{display:inline-block;padding:2px 7px;border-radius:999px;background:#f3e8ff;color:#6C3483;font-size:9px}',
    '.summary-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}',
    '.summary-card{display:flex;justify-content:space-between;align-items:center;gap:8px;border:1px solid #dce3eb;border-radius:6px;padding:6px 8px;break-inside:avoid;page-break-inside:avoid}',
    '.summary-card strong{white-space:nowrap}',
    '.summary-card.summary-emphasis{border-color:#8E44AD;background:#faf5ff;font-weight:700}',
    '.summary-card.status-surplus{border-color:#16a34a;background:#f0fdf4}',
    '.summary-card.status-deficit{border-color:#dc2626;background:#fef2f2}',
    '.summary-card.status-balanced{border-color:#64748b;background:#f8fafc}',
    'table{width:100%;border-collapse:collapse;table-layout:auto;font-size:8.5px}',
    'thead{display:table-header-group}',
    'tfoot{display:table-footer-group}',
    'th,td{border:1px solid #cfd8e3;padding:4px 5px;text-align:right;vertical-align:top;word-break:normal;overflow-wrap:anywhere}',
    'th{background:#e9eef5;font-weight:700;white-space:nowrap}',
    'tr{break-inside:avoid;page-break-inside:avoid}',
    '.report-section-accommodation table{font-size:7px;table-layout:fixed}',
    '.report-section-accommodation th,.report-section-accommodation td{padding:3px;overflow-wrap:anywhere}',
    '.report-note,.report-warning{border-radius:6px;padding:6px 8px;margin-top:5px;break-inside:avoid;page-break-inside:avoid}',
    '.report-note{background:#f8fafc;border:1px solid #dce3eb}',
    '.report-warning{background:#fff7ed;border:1px solid #fdba74;color:#9a3412}',
    '.report-totals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin-top:7px}',
    '.report-total{display:flex;justify-content:space-between;border:1px solid #cfd8e3;border-radius:6px;padding:5px 7px;font-weight:700;break-inside:avoid;page-break-inside:avoid}',
    '.no-print{display:none!important}',
    '@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.report-document{margin:0}.report-section:first-child{margin-top:0}}'
  ].join('');
}

function buildFinancialReportPrintHeader(model){
  var metadata=model.metadata||{};
  var options=model.options||{};
  var html='<header class="report-header">';
  html+='<h1>التقرير المالي للمؤتمر</h1>';
  html+='<div class="report-meta">';
  html+='<div><span>اسم المؤتمر</span><strong>'+esc(metadata.conferenceName||'—')+'</strong></div>';
  html+='<div><span>نوع التقرير</span><strong>'+
    (options.reportType==='detailed'?'تقرير تفصيلي':'تقرير مختصر')+'</strong></div>';
  html+='<div><span>عدد الأيام</span><strong>'+formatFinancialReportCellValue(metadata.daysCount,'number')+'</strong></div>';
  html+='<div><span>العملة</span><strong>'+esc(metadata.currency||'EGP')+'</strong></div>';
  if(metadata.startDate){
    html+='<div><span>تاريخ البداية</span><strong>'+formatFinancialReportCellValue(metadata.startDate,'date')+'</strong></div>';
  }
  if(metadata.endDate){
    html+='<div><span>تاريخ النهاية</span><strong>'+formatFinancialReportCellValue(metadata.endDate,'date')+'</strong></div>';
  }
  if(options.showGeneratedAt&&metadata.generatedAt){
    html+='<div><span>وقت إنشاء التقرير</span><strong>'+
      formatFinancialReportCellValue(metadata.generatedAt,'datetime')+'</strong></div>';
  }
  html+='</div></header>';
  return html;
}

function buildFinancialReportPrintSummary(section,model){
  var balance=model.summary&&model.summary.balance||{};
  var html='<div class="summary-grid">';
  (section.rows||[]).forEach(function(row){
    var className='summary-card';
    if(row.label==='المصروفات النهائية'||row.label==='الإيرادات النهائية'||row.label==='الرصيد النهائي'){
      className+=' summary-emphasis';
    }
    if(row.label==='حالة الرصيد')className+=' status-'+(balance.status||'balanced');
    var value=row.label==='حالة الرصيد'
      ?esc(getFinancialReportBalanceStatusLabel(row.value))
      :formatFinancialReportCellValue(row.value,row.dataType);
    html+='<div class="'+className+'"><span>'+esc(row.label||'')+'</span><strong>'+value+'</strong></div>';
  });
  html+='</div>';
  return html;
}

function buildFinancialReportPrintTable(section){
  if(!section.rows||!section.rows.length)return '';
  var html='<table><thead><tr>';
  (section.columns||[]).forEach(function(column){
    html+='<th>'+esc(column.label||'')+'</th>';
  });
  html+='</tr></thead><tbody>';
  section.rows.forEach(function(row){
    html+='<tr>';
    (section.columns||[]).forEach(function(column){
      html+='<td>'+formatFinancialReportCellValue(row[column.key],column.dataType)+'</td>';
    });
    html+='</tr>';
  });
  html+='</tbody></table>';
  return html;
}

function buildFinancialReportPrintSection(section,model){
  if(!section||section.visible===false)return '';
  if(section.id==='warnings'&&(!section.rows||!section.rows.length))return '';
  var tableSection=section.id!=='summary'&&section.id!=='warnings'&&section.rows&&section.rows.length;
  var html='<section class="report-section'+(tableSection?' report-table-section':'')+' report-section-'+esc(section.id||'general')+'">';
  html+='<h2 class="report-section-title">'+esc(section.title||'');
  if(section.enabled===false)html+='<span class="status-badge">القسم غير مفعّل</span>';
  html+='</h2>';
  if(section.id==='summary'){
    html+=buildFinancialReportPrintSummary(section,model);
  }else if(section.id==='warnings'){
    (section.rows||[]).forEach(function(warning){
      html+='<div class="report-warning"><b>⚠️ '+esc(warning.message||'')+'</b>';
      if(warning.code)html+='<div>'+esc(warning.code)+'</div>';
      html+='</div>';
    });
  }else if(section.rows&&section.rows.length){
    html+=buildFinancialReportPrintTable(section);
  }
  (section.notes||[]).forEach(function(note){
    html+='<div class="report-note">'+esc(note)+'</div>';
  });
  if(section.enabled!==false&&(!section.rows||!section.rows.length)&&!(section.notes||[]).length){
    html+='<div class="report-note">لا توجد بيانات</div>';
  }
  if(section.totals&&section.totals.length){
    html+='<div class="report-totals">';
    section.totals.forEach(function(total){
      html+='<div class="report-total"><span>'+esc(total.label||'')+'</span><strong>'+
        formatFinancialReportCellValue(total.value,total.dataType)+'</strong></div>';
    });
    html+='</div>';
  }
  (section.warnings||[]).forEach(function(warning){
    html+='<div class="report-warning">⚠️ '+esc(warning&&warning.message||warning||'')+'</div>';
  });
  html+='</section>';
  return html;
}

function buildFinancialReportPrintHtml(model){
  var metadata=model&&model.metadata||{};
  var title='التقرير المالي - '+(metadata.conferenceName||'المؤتمر');
  var html='<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">';
  html+='<title>'+esc(title)+'</title>';
  html+='<style>'+buildFinancialReportPrintStyles()+'</style></head><body>';
  html+='<main class="report-document">';
  html+=buildFinancialReportPrintHeader(model);
  (model.sections||[]).forEach(function(section){
    html+=buildFinancialReportPrintSection(section,model);
  });
  html+='</main></body></html>';
  return html;
}

function printConferenceFinancialReport(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('printConferenceFinancialReport',null))return false;
  var options=normalizeFinancialReportOptions(getFinancialReportOptionsDraft());
  var model=buildConferenceFinancialReportModel(options);
  var printHtml=buildFinancialReportPrintHtml(model);
  var printWindow=window.open('','_blank');
  if(!printWindow){
    if(typeof showToast==='function')showToast('تعذر فتح نافذة الطباعة. يرجى السماح بالنوافذ المنبثقة.','#E67E22');
    return false;
  }
  var printStarted=false;
  var startPrint=function(){
    if(printStarted)return;
    printStarted=true;
    printWindow.focus();
    printWindow.print();
  };
  printWindow.document.open();
  printWindow.document.write(printHtml);
  printWindow.onload=startPrint;
  printWindow.document.close();
  if(printWindow.document.readyState==='complete')startPrint();
  return true;
}

function saveConferenceFinancialReportAsPdf(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveConferenceFinancialReportAsPdf',null))return false;
  if(typeof showToast==='function'){
    showToast('اختر «حفظ بتنسيق PDF» من نافذة الطباعة.','#6C3483');
  }
  return printConferenceFinancialReport();
}

function sanitizeFinancialReportExcelText(value){
  if(value===null||value===undefined)return '';
  var text=String(value);
  if(/^[=+\-@]/.test(text.replace(/^\s+/,'')))return '\''+text;
  return text;
}

function getFinancialReportExcelCellValue(value,dataType){
  if(value===null||value===undefined)return '';
  if(dataType==='money'||dataType==='number'){
    var number=Number(value);
    return isFinite(number)?number:'';
  }
  if(dataType==='boolean')return value?'نعم':'لا';
  if(dataType==='date'||dataType==='datetime'){
    var date=value instanceof Date?new Date(value.getTime()):new Date(value);
    if(!isNaN(date.getTime()))return date;
    return sanitizeFinancialReportExcelText(value);
  }
  return sanitizeFinancialReportExcelText(value);
}

function getFinancialReportExcelFileName(model){
  var metadata=model&&model.metadata||{};
  var conferenceName=String(metadata.conferenceName||'مؤتمر')
    .replace(/[\\\/:*?"<>|]/g,' ')
    .replace(/\s+/g,' ')
    .trim()||'مؤتمر';
  var generatedDate=new Date(metadata.generatedAt||'');
  if(isNaN(generatedDate.getTime()))generatedDate=new Date();
  var year=generatedDate.getFullYear();
  var month=String(generatedDate.getMonth()+1);
  var day=String(generatedDate.getDate());
  if(month.length<2)month='0'+month;
  if(day.length<2)day='0'+day;
  return 'التقرير-المالي-'+conferenceName.replace(/\s+/g,'-')+'-'+year+'-'+month+'-'+day+'.xlsx';
}

function getFinancialReportExcelSheetName(name,usedNames){
  var base=String(name||'ورقة')
    .replace(/[:\\\/?*\[\]]/g,' ')
    .replace(/\s+/g,' ')
    .trim()||'ورقة';
  if(base.length>31)base=base.substring(0,31);
  var candidate=base;
  var suffix=2;
  while(usedNames[candidate]){
    var suffixText=' ('+suffix+')';
    candidate=base.substring(0,31-suffixText.length)+suffixText;
    suffix++;
  }
  usedNames[candidate]=true;
  return candidate;
}

function getFinancialReportExcelSectionSheetTitle(section){
  var titles={
    accommodation:'الإقامة',
    air_conditioning:'التكييف',
    meals:'الوجبات',
    additional_expenses:'المصروفات الإضافية',
    income:'الإيرادات',
    settlements:'التسويات',
    warnings:'التحذيرات'
  };
  return titles[section&&section.id]||section&&section.title||'بيانات';
}

function buildFinancialReportSummarySheet(model,usedNames){
  var metadata=model.metadata||{};
  var summarySection=(model.sections||[]).filter(function(section){return section.id==='summary'})[0]||{rows:[]};
  var rows=[['البيان','القيمة','الملاحظات']];
  var cellTypes=[['text','text','text']];
  var boldRows=[0];
  function addRow(label,value,dataType,note){
    rows.push([
      sanitizeFinancialReportExcelText(label),
      getFinancialReportExcelCellValue(value,dataType),
      sanitizeFinancialReportExcelText(note||'')
    ]);
    cellTypes.push(['text',dataType||'text','text']);
  }
  addRow('اسم المؤتمر',metadata.conferenceName,'text','');
  addRow('نوع التقرير',model.options.reportType==='detailed'?'تقرير تفصيلي':'تقرير مختصر','text','');
  addRow('عدد الأيام',metadata.daysCount,'number','');
  addRow('العملة',metadata.currency,'text','');
  if(model.options.showGeneratedAt&&metadata.generatedAt){
    addRow('وقت إنشاء التقرير',metadata.generatedAt,'datetime','');
  }
  rows.push(['','','']);
  cellTypes.push(['text','text','text']);
  (summarySection.rows||[]).forEach(function(row){
    var value=row.label==='حالة الرصيد'
      ?getFinancialReportBalanceStatusLabel(row.value)
      :row.value;
    addRow(row.label,value,row.dataType,'');
  });
  if(model.warnings&&model.warnings.length){
    rows.push(['التحذيرات','','']);
    cellTypes.push(['text','text','text']);
    boldRows.push(rows.length-1);
    model.warnings.forEach(function(warning){
      addRow('تحذير',warning.message,'text',warning.code||'');
    });
  }
  return {
    name:getFinancialReportExcelSheetName('الملخص المالي',usedNames),
    rows:rows,
    cellTypes:cellTypes,
    columnWidths:[30,24,42],
    boldRows:boldRows,
    rtl:true
  };
}

function buildFinancialReportSectionSheet(section,usedNames){
  var rows=[];
  var cellTypes=[];
  var boldRows=[];
  var columns=section.excelColumns||section.columns||[];
  rows.push([sanitizeFinancialReportExcelText(section.title||'')]);
  cellTypes.push(['text']);
  boldRows.push(0);
  rows.push(['حالة القسم',section.enabled===false?'القسم غير مفعّل':'مفعّل']);
  cellTypes.push(['text','text']);
  if(section.rows&&section.rows.length){
    rows.push([]);
    cellTypes.push([]);
    rows.push(columns.map(function(column){
      return sanitizeFinancialReportExcelText(column.label||'');
    }));
    cellTypes.push(columns.map(function(){return 'text'}));
    boldRows.push(rows.length-1);
    section.rows.forEach(function(row){
      rows.push(columns.map(function(column){
        return getFinancialReportExcelCellValue(row[column.key],column.dataType);
      }));
      cellTypes.push(columns.map(function(column){return column.dataType||'text'}));
    });
  }else{
    rows.push(['لا توجد بيانات']);
    cellTypes.push(['text']);
  }
  if(section.totals&&section.totals.length){
    rows.push([]);
    cellTypes.push([]);
    section.totals.forEach(function(total){
      rows.push([
        sanitizeFinancialReportExcelText(total.label||''),
        getFinancialReportExcelCellValue(total.value,total.dataType)
      ]);
      cellTypes.push(['text',total.dataType||'text']);
      boldRows.push(rows.length-1);
    });
  }
  (section.notes||[]).forEach(function(note){
    rows.push(['ملاحظة',sanitizeFinancialReportExcelText(note)]);
    cellTypes.push(['text','text']);
  });
  (section.warnings||[]).forEach(function(warning){
    rows.push(['تحذير',sanitizeFinancialReportExcelText(warning&&warning.message||warning||'')]);
    cellTypes.push(['text','text']);
  });
  var columnWidths=columns.map(function(column){
    if(column.dataType==='formula'||column.key==='notes')return 42;
    if(column.dataType==='money'||column.dataType==='number')return 16;
    return Math.max(14,Math.min(28,String(column.label||'').length+8));
  });
  if(!columnWidths.length)columnWidths=[24,42];
  return {
    name:getFinancialReportExcelSheetName(getFinancialReportExcelSectionSheetTitle(section),usedNames),
    rows:rows,
    cellTypes:cellTypes,
    columnWidths:columnWidths,
    boldRows:boldRows,
    rtl:true
  };
}

function buildFinancialReportWorkbookData(model){
  var usedNames={};
  var sheets=[buildFinancialReportSummarySheet(model,usedNames)];
  (model.sections||[]).forEach(function(section){
    if(section.id==='summary')return;
    if(section.id==='warnings'&&(!section.rows||!section.rows.length))return;
    sheets.push(buildFinancialReportSectionSheet(section,usedNames));
  });
  return {
    fileName:getFinancialReportExcelFileName(model),
    sheets:sheets
  };
}

function createFinancialReportWorksheet(sheetData){
  var worksheet=XLSX.utils.aoa_to_sheet(sheetData.rows,{cellDates:true});
  worksheet['!views']=[{RTL:sheetData.rtl!==false}];
  worksheet['!cols']=(sheetData.columnWidths||[]).map(function(width){return {wch:width}});
  var boldRows={};
  (sheetData.boldRows||[]).forEach(function(rowIndex){boldRows[rowIndex]=true});
  (sheetData.rows||[]).forEach(function(row,rowIndex){
    row.forEach(function(value,columnIndex){
      var address=XLSX.utils.encode_cell({r:rowIndex,c:columnIndex});
      var cell=worksheet[address];
      if(!cell)return;
      var dataType=sheetData.cellTypes&&sheetData.cellTypes[rowIndex]
        ?sheetData.cellTypes[rowIndex][columnIndex]
        :'text';
      if(dataType==='money')cell.z='#,##0.00';
      else if(dataType==='number')cell.z='#,##0.##';
      else if(dataType==='date'&&cell.t==='d')cell.z='yyyy-mm-dd';
      else if(dataType==='datetime'&&cell.t==='d')cell.z='yyyy-mm-dd hh:mm';
      cell.s=cell.s||{};
      cell.s.alignment={vertical:'top',wrapText:dataType==='formula'||dataType==='text'};
      if(boldRows[rowIndex])cell.s.font={bold:true};
    });
  });
  return worksheet;
}

function exportConferenceFinancialReportToExcel(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('exportConferenceFinancialReportToExcel',null))return false;
  if(typeof XLSX==='undefined'||!XLSX.utils){
    if(typeof showToast==='function')showToast('مكتبة تصدير Excel غير متاحة محليًا.','#E74C3C');
    return false;
  }
  try{
    var model=buildConferenceFinancialReportModel(getFinancialReportOptionsDraft());
    var workbookData=buildFinancialReportWorkbookData(model);
    var workbook=XLSX.utils.book_new();
    workbookData.sheets.forEach(function(sheetData){
      var worksheet=createFinancialReportWorksheet(sheetData);
      XLSX.utils.book_append_sheet(workbook,worksheet,sheetData.name);
    });
    XLSX.writeFile(workbook,workbookData.fileName,{compression:true});
    if(typeof showToast==='function')showToast('✅ تم إنشاء ملف Excel المالي.');
    return true;
  }catch(error){
    if(typeof console!=='undefined'&&console.error)console.error('تعذر تصدير التقرير المالي إلى Excel:',error);
    if(typeof showToast==='function')showToast('تعذر إنشاء ملف Excel المالي.','#E74C3C');
    return false;
  }
}

var financialItemsDraft=null;
var financialItemsDraftConferenceId='';

function copyFinancialItemForDraft(item){
  var normalized=normalizeFinancialItem(item)||getDefaultFinancialItem();
  return {
    id:normalized.id||uid(),
    type:normalized.type,
    category:normalized.category,
    name:normalized.name,
    enabled:normalized.enabled,
    calculationMethod:normalized.calculationMethod,
    quantity:normalized.quantity,
    unitPrice:normalized.unitPrice,
    amount:normalized.amount,
    notes:normalized.notes
  };
}

function resetFinancialItemsDraftFromSaved(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  var settings=getFinancialItemsSettings()||{enabled:true,items:[]};
  financialItemsDraft={
    enabled:settings.enabled!==false,
    items:(settings.items||[]).map(copyFinancialItemForDraft)
  };
  financialItemsDraftConferenceId=conference&&conference.id||'';
  return financialItemsDraft;
}

function getFinancialItemsDraft(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  var conferenceId=conference&&conference.id||'';
  if(!financialItemsDraft||financialItemsDraftConferenceId!==conferenceId)return resetFinancialItemsDraftFromSaved();
  return financialItemsDraft;
}

function addFinancialItemDraft(){
  var draft=getFinancialItemsDraft();
  var item=getDefaultFinancialItem();
  item.id=uid();
  draft.items.push(item);
  renderAccounts();
}

function updateFinancialItemDraft(itemId,field,value,rerender){
  var draft=getFinancialItemsDraft();
  var item=null;
  draft.items.forEach(function(candidate){if(candidate.id===itemId)item=candidate});
  if(!item)return;
  if(field==='enabled')item.enabled=value===true||value==='true';
  else if(field==='quantity'||field==='unitPrice'||field==='amount')item[field]=value===''?null:normalizeFinancialItemNumber(value);
  else if(field==='calculationMethod'){
    item.calculationMethod=getSupportedFinancialItemMethods().indexOf(value)!==-1?value:'fixed';
  }else if(field==='name'||field==='notes')item[field]=String(value||'');
  if(rerender===true)renderAccounts();
}

function updateFinancialItemsDraftEnabled(enabled){
  getFinancialItemsDraft().enabled=!!enabled;
  renderAccounts();
}

function removeFinancialItemDraft(itemId){
  if(!confirm('هل أنت متأكد من حذف هذا البند من المسودة؟ لن يتغير الحفظ الحالي قبل الضغط على حفظ.'))return;
  var draft=getFinancialItemsDraft();
  draft.items=draft.items.filter(function(item){return item.id!==itemId});
  renderAccounts();
}

function saveFinancialItemsSettings(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveFinancialItemsSettings',null))return false;
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  if(!conference)return;
  var draft=getFinancialItemsDraft();
  var normalized=normalizeFinancialItems(draft);
  var accounts=normalizeConferenceAccounts(conference);
  accounts.financialItems={
    enabled:normalized.enabled,
    items:normalized.items.map(copyFinancialItemForDraft)
  };
  accounts.updatedAt=new Date().toISOString();
  if(save()===false){showToast('تعذر حفظ المصروفات الإضافية.','#E74C3C');return}
  resetFinancialItemsDraftFromSaved();
  renderAccounts();
  showToast('✅ تم حفظ المصروفات الإضافية');
}

function cancelFinancialItemsSettings(){
  resetFinancialItemsDraftFromSaved();
  renderAccounts();
  showToast('تم إلغاء التعديلات غير المحفوظة.','#607D8B');
}

function resetFinancialItemsSettings(){
  if(!confirm('هل تريد مسح جميع البنود من المسودة؟ لن تتغير البيانات المحفوظة قبل الضغط على حفظ.'))return;
  financialItemsDraft={enabled:true,items:[]};
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  financialItemsDraftConferenceId=conference&&conference.id||'';
  renderAccounts();
}

function getFinancialItemMethodLabel(method){
  var labels={
    fixed:'مبلغ ثابت',
    quantity_price:'كمية × سعر',
    per_day:'حسب عدد الأيام',
    per_room:'حسب عدد الغرف',
    per_person:'حسب عدد الأشخاص',
    manual:'إجمالي يدوي'
  };
  return labels[method]||labels.fixed;
}

function getFinancialItemJsKey(value){
  return String(value||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r/g,'\\r').replace(/\n/g,'\\n');
}

function renderFinancialItemDraft(item,context){
  var result=calculateFinancialItem(item,context);
  var key=getFinancialItemJsKey(item.id);
  var method=item.calculationMethod;
  var html='<div class="settings-section" style="margin:8px 0"><div class="settings-branding-grid">';
  html+='<div class="settings-branding-field"><label class="settings-branding-auto-toggle"><input type="checkbox" '+(item.enabled?'checked':'')+' onchange="updateFinancialItemDraft(\''+key+'\',\'enabled\',this.checked,true)"><span>تفعيل البند</span></label></div>';
  html+='<div class="settings-branding-field"><label class="lbl">اسم البند</label><input type="text" value="'+esc(item.name)+'" oninput="updateFinancialItemDraft(\''+key+'\',\'name\',this.value,false)"></div>';
  html+='<div class="settings-branding-field"><label class="lbl">طريقة الحساب</label><select onchange="updateFinancialItemDraft(\''+key+'\',\'calculationMethod\',this.value,true)">';
  getSupportedFinancialItemMethods().forEach(function(value){
    html+='<option value="'+value+'" '+(method===value?'selected':'')+'>'+getFinancialItemMethodLabel(value)+'</option>';
  });
  html+='</select></div>';
  if(method==='fixed'||method==='manual'){
    html+='<div class="settings-branding-field"><label class="lbl">'+(method==='manual'?'الإجمالي اليدوي':'المبلغ')+'</label><input type="number" min="0" step="0.01" value="'+(item.amount===null?'':item.amount)+'" onchange="updateFinancialItemDraft(\''+key+'\',\'amount\',this.value,true)"></div>';
  }else{
    if(method==='quantity_price'){
      html+='<div class="settings-branding-field"><label class="lbl">الكمية</label><input type="number" min="0" step="0.01" value="'+(item.quantity===null?'':item.quantity)+'" onchange="updateFinancialItemDraft(\''+key+'\',\'quantity\',this.value,true)"></div>';
    }else{
      html+='<div class="settings-branding-field"><label class="lbl">الكمية للمعاينة</label><input type="text" disabled value="'+result.quantity+' — '+esc(result.quantitySource)+'"></div>';
    }
    html+='<div class="settings-branding-field"><label class="lbl">'+(method==='per_day'?'سعر اليوم':method==='per_room'?'سعر الغرفة':method==='per_person'?'سعر الشخص':'سعر الوحدة')+'</label><input type="number" min="0" step="0.01" value="'+(item.unitPrice===null?'':item.unitPrice)+'" onchange="updateFinancialItemDraft(\''+key+'\',\'unitPrice\',this.value,true)"></div>';
  }
  html+='<div class="settings-branding-field"><label class="lbl">الملاحظات</label><textarea rows="2" oninput="updateFinancialItemDraft(\''+key+'\',\'notes\',this.value,false)">'+esc(item.notes)+'</textarea></div>';
  html+='</div><div class="settings-empty-state" style="white-space:pre-line"><b>'+esc(result.formula)+'</b><br>الناتج: '+formatAccountMoney(result.total)+'</div>';
  html+='<div class="settings-branding-actions"><button class="btn btn-red" onclick="removeFinancialItemDraft(\''+key+'\')">حذف البند</button></div></div>';
  return html;
}

function renderFinancialItemsSettings(){
  var draft=getFinancialItemsDraft();
  var context=getFinancialItemsCalculationContext();
  var results=draft.items.map(function(item){return calculateFinancialItem(item,context)});
  var total=draft.enabled?results.reduce(function(sum,item){return sum+(item.enabled?item.total:0)},0):0;
  var html='<div class="settings-branding-actions" style="justify-content:space-between">';
  html+='<label class="settings-branding-auto-toggle"><input type="checkbox" '+(draft.enabled?'checked':'')+' onchange="updateFinancialItemsDraftEnabled(this.checked)"><span>تفعيل المصروفات الإضافية</span></label>';
  html+='<button class="btn btn-blue" onclick="addFinancialItemDraft()">➕ إضافة بند</button></div>';
  if(!draft.items.length)html+='<div class="settings-empty-state">لا توجد بنود مالية إضافية في المسودة.</div>';
  draft.items.forEach(function(item){html+=renderFinancialItemDraft(item,context)});
  html+='<div class="settings-summary-card" style="margin-top:10px"><span>إجمالي المصروفات الإضافية</span><strong>'+formatAccountMoney(total)+'</strong></div>';
  html+='<div class="settings-branding-actions"><button class="btn btn-green" onclick="saveFinancialItemsSettings()">💾 حفظ البنود</button><button class="btn btn-gray" onclick="cancelFinancialItemsSettings()">إلغاء التعديلات</button><button class="btn btn-red" onclick="resetFinancialItemsSettings()">مسح المسودة</button></div>';
  return html;
}

var incomeItemsDraft=null;
var incomeItemsDraftConferenceId='';

function copyIncomeItemForDraft(item){
  var normalized=normalizeIncomeItem(item)||getDefaultIncomeItem();
  return {
    id:normalized.id||uid(),
    type:'income',
    category:'general',
    name:normalized.name,
    enabled:normalized.enabled,
    calculationMethod:normalized.calculationMethod,
    quantity:normalized.quantity,
    unitPrice:normalized.unitPrice,
    amount:normalized.amount,
    notes:normalized.notes
  };
}

function resetIncomeItemsDraftFromSaved(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  var settings=getIncomeItemsSettings()||{enabled:true,items:[]};
  incomeItemsDraft={
    enabled:settings.enabled!==false,
    items:(settings.items||[]).map(copyIncomeItemForDraft)
  };
  incomeItemsDraftConferenceId=conference&&conference.id||'';
  return incomeItemsDraft;
}

function getIncomeItemsDraft(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  var conferenceId=conference&&conference.id||'';
  if(!incomeItemsDraft||incomeItemsDraftConferenceId!==conferenceId)return resetIncomeItemsDraftFromSaved();
  return incomeItemsDraft;
}

function addIncomeItemDraft(){
  var draft=getIncomeItemsDraft();
  var item=getDefaultIncomeItem();
  item.id=uid();
  draft.items.push(item);
  renderAccounts();
}

function updateIncomeItemDraft(itemId,field,value,rerender){
  var draft=getIncomeItemsDraft();
  var item=null;
  draft.items.forEach(function(candidate){if(candidate.id===itemId)item=candidate});
  if(!item)return;
  if(field==='enabled')item.enabled=value===true||value==='true';
  else if(field==='quantity'||field==='unitPrice'||field==='amount')item[field]=value===''?null:normalizeFinancialItemNumber(value);
  else if(field==='calculationMethod'){
    item.calculationMethod=getSupportedFinancialItemMethods().indexOf(value)!==-1?value:'fixed';
  }else if(field==='name'||field==='notes')item[field]=String(value||'');
  if(rerender===true)renderAccounts();
}

function updateIncomeItemsDraftEnabled(enabled){
  getIncomeItemsDraft().enabled=!!enabled;
  renderAccounts();
}

function removeIncomeItemDraft(itemId){
  if(!confirm('هل أنت متأكد من حذف بند الإيراد من المسودة؟ لن يتغير الحفظ الحالي قبل الضغط على حفظ.'))return;
  var draft=getIncomeItemsDraft();
  draft.items=draft.items.filter(function(item){return item.id!==itemId});
  renderAccounts();
}

function saveIncomeItemsSettings(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveIncomeItemsSettings',null))return false;
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  if(!conference)return;
  var normalized=normalizeIncomeItems(getIncomeItemsDraft());
  var accounts=normalizeConferenceAccounts(conference);
  accounts.incomeItems={
    enabled:normalized.enabled,
    items:normalized.items.map(copyIncomeItemForDraft)
  };
  accounts.updatedAt=new Date().toISOString();
  if(save()===false){showToast('تعذر حفظ الإيرادات.','#E74C3C');return}
  resetIncomeItemsDraftFromSaved();
  renderAccounts();
  showToast('✅ تم حفظ الإيرادات');
}

function cancelIncomeItemsSettings(){
  resetIncomeItemsDraftFromSaved();
  renderAccounts();
  showToast('تم إلغاء تعديلات الإيرادات غير المحفوظة.','#607D8B');
}

function resetIncomeItemsSettings(){
  if(!confirm('هل تريد مسح جميع بنود الإيرادات من المسودة؟ لن تتغير البيانات المحفوظة قبل الضغط على حفظ.'))return;
  incomeItemsDraft={enabled:true,items:[]};
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  incomeItemsDraftConferenceId=conference&&conference.id||'';
  renderAccounts();
}

function getIncomeItemCategoryLabel(){
  return 'إيراد عام';
}

function renderIncomeItemDraft(item,context){
  var result=calculateIncomeItem(item,context);
  var key=getFinancialItemJsKey(item.id);
  var method=item.calculationMethod;
  var html='<div class="settings-section" style="margin:8px 0"><div class="settings-branding-grid">';
  html+='<div class="settings-branding-field"><label class="settings-branding-auto-toggle"><input type="checkbox" '+(item.enabled?'checked':'')+' onchange="updateIncomeItemDraft(\''+key+'\',\'enabled\',this.checked,true)"><span>تفعيل بند الإيراد</span></label></div>';
  html+='<div class="settings-branding-field"><label class="lbl">اسم الإيراد</label><input type="text" value="'+esc(item.name)+'" oninput="updateIncomeItemDraft(\''+key+'\',\'name\',this.value,false)"></div>';
  html+='<div class="settings-branding-field"><label class="lbl">التصنيف</label><input type="text" disabled value="'+getIncomeItemCategoryLabel()+'"></div>';
  html+='<div class="settings-branding-field"><label class="lbl">طريقة الحساب</label><select onchange="updateIncomeItemDraft(\''+key+'\',\'calculationMethod\',this.value,true)">';
  getSupportedFinancialItemMethods().forEach(function(value){
    html+='<option value="'+value+'" '+(method===value?'selected':'')+'>'+getFinancialItemMethodLabel(value)+'</option>';
  });
  html+='</select></div>';
  if(method==='fixed'||method==='manual'){
    html+='<div class="settings-branding-field"><label class="lbl">'+(method==='manual'?'الإجمالي اليدوي':'المبلغ')+'</label><input type="number" min="0" step="0.01" value="'+(item.amount===null?'':item.amount)+'" onchange="updateIncomeItemDraft(\''+key+'\',\'amount\',this.value,true)"></div>';
  }else{
    if(method==='quantity_price'){
      html+='<div class="settings-branding-field"><label class="lbl">الكمية</label><input type="number" min="0" step="0.01" value="'+(item.quantity===null?'':item.quantity)+'" onchange="updateIncomeItemDraft(\''+key+'\',\'quantity\',this.value,true)"></div>';
    }else{
      html+='<div class="settings-branding-field"><label class="lbl">الكمية للمعاينة</label><input type="text" disabled value="'+result.quantity+' — '+esc(result.quantitySource)+'"></div>';
    }
    html+='<div class="settings-branding-field"><label class="lbl">'+(method==='per_day'?'سعر اليوم':method==='per_room'?'سعر الغرفة':method==='per_person'?'سعر الشخص':'سعر الوحدة')+'</label><input type="number" min="0" step="0.01" value="'+(item.unitPrice===null?'':item.unitPrice)+'" onchange="updateIncomeItemDraft(\''+key+'\',\'unitPrice\',this.value,true)"></div>';
  }
  html+='<div class="settings-branding-field"><label class="lbl">الملاحظات</label><textarea rows="2" oninput="updateIncomeItemDraft(\''+key+'\',\'notes\',this.value,false)">'+esc(item.notes)+'</textarea></div>';
  html+='</div><div class="settings-empty-state" style="white-space:pre-line"><b>'+esc(result.formula)+'</b><br>الإيراد: '+formatAccountMoney(result.total)+'</div>';
  html+='<div class="settings-branding-actions"><button class="btn btn-red" onclick="removeIncomeItemDraft(\''+key+'\')">حذف بند الإيراد</button></div></div>';
  return html;
}

function renderIncomeItemsSettings(){
  var draft=getIncomeItemsDraft();
  var context=getFinancialItemsCalculationContext();
  var results=draft.items.map(function(item){return calculateIncomeItem(item,context)});
  var total=draft.enabled?results.reduce(function(sum,item){return sum+(item.enabled?item.total:0)},0):0;
  var html='<div class="settings-branding-actions" style="justify-content:space-between">';
  html+='<label class="settings-branding-auto-toggle"><input type="checkbox" '+(draft.enabled?'checked':'')+' onchange="updateIncomeItemsDraftEnabled(this.checked)"><span>تفعيل الإيرادات</span></label>';
  html+='<button class="btn btn-blue" onclick="addIncomeItemDraft()">➕ إضافة إيراد</button></div>';
  if(!draft.items.length)html+='<div class="settings-empty-state">لا توجد بنود إيرادات في المسودة.</div>';
  draft.items.forEach(function(item){html+=renderIncomeItemDraft(item,context)});
  html+='<div class="settings-summary-card" style="margin-top:10px"><span>إجمالي الإيرادات</span><strong>'+formatAccountMoney(total)+'</strong></div>';
  html+='<div class="settings-branding-actions"><button class="btn btn-green" onclick="saveIncomeItemsSettings()">💾 حفظ الإيرادات</button><button class="btn btn-gray" onclick="cancelIncomeItemsSettings()">إلغاء التعديلات</button><button class="btn btn-red" onclick="resetIncomeItemsSettings()">مسح المسودة</button></div>';
  return html;
}

var settlementsDraft=null;
var settlementsDraftConferenceId='';

function copySettlementItemForDraft(item){
  var normalized=normalizeSettlementItem(item)||getDefaultSettlementItem();
  return {
    id:normalized.id||uid(),
    target:normalized.target,
    operation:normalized.operation,
    name:normalized.name,
    enabled:normalized.enabled,
    calculationMethod:normalized.calculationMethod,
    quantity:normalized.quantity,
    unitPrice:normalized.unitPrice,
    amount:normalized.amount,
    notes:normalized.notes
  };
}

function resetSettlementsDraftFromSaved(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  var settings=getSettlementsSettings()||{enabled:true,items:[]};
  settlementsDraft={
    enabled:settings.enabled!==false,
    items:(settings.items||[]).map(copySettlementItemForDraft)
  };
  settlementsDraftConferenceId=conference&&conference.id||'';
  return settlementsDraft;
}

function getSettlementsDraft(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  var conferenceId=conference&&conference.id||'';
  if(!settlementsDraft||settlementsDraftConferenceId!==conferenceId)return resetSettlementsDraftFromSaved();
  return settlementsDraft;
}

function addSettlementDraft(){
  var draft=getSettlementsDraft();
  var item=getDefaultSettlementItem();
  item.id=uid();
  draft.items.push(item);
  renderAccounts();
}

function updateSettlementDraft(itemId,field,value,rerender){
  var draft=getSettlementsDraft();
  var item=null;
  draft.items.forEach(function(candidate){if(candidate.id===itemId)item=candidate});
  if(!item)return;
  if(field==='enabled')item.enabled=value===true||value==='true';
  else if(field==='target')item.target=value==='income'?'income':'expense';
  else if(field==='operation')item.operation=value==='subtract'?'subtract':'add';
  else if(field==='quantity'||field==='unitPrice'||field==='amount')item[field]=value===''?null:normalizeFinancialItemNumber(value);
  else if(field==='calculationMethod')item.calculationMethod=getSupportedFinancialItemMethods().indexOf(value)!==-1?value:'fixed';
  else if(field==='name'||field==='notes')item[field]=String(value||'');
  if(rerender===true)renderAccounts();
}

function updateSettlementsDraftEnabled(enabled){
  getSettlementsDraft().enabled=!!enabled;
  renderAccounts();
}

function removeSettlementDraft(itemId){
  if(!confirm('هل أنت متأكد من حذف التسوية من المسودة؟ لن يتغير الحفظ الحالي قبل الضغط على حفظ.'))return;
  var draft=getSettlementsDraft();
  draft.items=draft.items.filter(function(item){return item.id!==itemId});
  renderAccounts();
}

function saveSettlementsSettings(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveSettlementsSettings',null))return false;
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  if(!conference)return;
  var normalized=normalizeSettlements(getSettlementsDraft());
  var accounts=normalizeConferenceAccounts(conference);
  accounts.settlements={
    enabled:normalized.enabled,
    items:normalized.items.map(copySettlementItemForDraft)
  };
  accounts.updatedAt=new Date().toISOString();
  if(save()===false){showToast('تعذر حفظ التسويات النهائية.','#E74C3C');return}
  resetSettlementsDraftFromSaved();
  renderAccounts();
  showToast('✅ تم حفظ التسويات النهائية');
}

function cancelSettlementsSettings(){
  resetSettlementsDraftFromSaved();
  renderAccounts();
  showToast('تم إلغاء تعديلات التسويات غير المحفوظة.','#607D8B');
}

function resetSettlementsSettings(){
  if(!confirm('هل تريد مسح جميع التسويات من المسودة؟ لن تتغير البيانات المحفوظة قبل الضغط على حفظ.'))return;
  settlementsDraft={enabled:true,items:[]};
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  settlementsDraftConferenceId=conference&&conference.id||'';
  renderAccounts();
}

function renderSettlementDraft(item,context){
  var result=calculateSettlementItem(item,context);
  var key=getFinancialItemJsKey(item.id);
  var method=item.calculationMethod;
  var html='<div class="settings-section" style="margin:8px 0"><div class="settings-branding-grid">';
  html+='<div class="settings-branding-field"><label class="settings-branding-auto-toggle"><input type="checkbox" '+(item.enabled?'checked':'')+' onchange="updateSettlementDraft(\''+key+'\',\'enabled\',this.checked,true)"><span>تفعيل التسوية</span></label></div>';
  html+='<div class="settings-branding-field"><label class="lbl">الهدف</label><select onchange="updateSettlementDraft(\''+key+'\',\'target\',this.value,true)"><option value="expense" '+(item.target==='expense'?'selected':'')+'>مصروف</option><option value="income" '+(item.target==='income'?'selected':'')+'>إيراد</option></select></div>';
  html+='<div class="settings-branding-field"><label class="lbl">العملية</label><select onchange="updateSettlementDraft(\''+key+'\',\'operation\',this.value,true)"><option value="add" '+(item.operation==='add'?'selected':'')+'>إضافة</option><option value="subtract" '+(item.operation==='subtract'?'selected':'')+'>خصم</option></select></div>';
  html+='<div class="settings-branding-field"><label class="lbl">اسم التسوية</label><input type="text" value="'+esc(item.name)+'" oninput="updateSettlementDraft(\''+key+'\',\'name\',this.value,false)"></div>';
  html+='<div class="settings-branding-field"><label class="lbl">طريقة الحساب</label><select onchange="updateSettlementDraft(\''+key+'\',\'calculationMethod\',this.value,true)">';
  getSupportedFinancialItemMethods().forEach(function(value){
    html+='<option value="'+value+'" '+(method===value?'selected':'')+'>'+getFinancialItemMethodLabel(value)+'</option>';
  });
  html+='</select></div>';
  if(method==='fixed'||method==='manual'){
    html+='<div class="settings-branding-field"><label class="lbl">'+(method==='manual'?'الإجمالي اليدوي':'المبلغ')+'</label><input type="number" min="0" step="0.01" value="'+(item.amount===null?'':item.amount)+'" onchange="updateSettlementDraft(\''+key+'\',\'amount\',this.value,true)"></div>';
  }else{
    if(method==='quantity_price'){
      html+='<div class="settings-branding-field"><label class="lbl">الكمية</label><input type="number" min="0" step="0.01" value="'+(item.quantity===null?'':item.quantity)+'" onchange="updateSettlementDraft(\''+key+'\',\'quantity\',this.value,true)"></div>';
    }else{
      html+='<div class="settings-branding-field"><label class="lbl">الكمية للمعاينة</label><input type="text" disabled value="'+result.quantity+' — '+esc(result.quantitySource)+'"></div>';
    }
    html+='<div class="settings-branding-field"><label class="lbl">'+(method==='per_day'?'سعر اليوم':method==='per_room'?'سعر الغرفة':method==='per_person'?'سعر الشخص':'سعر الوحدة')+'</label><input type="number" min="0" step="0.01" value="'+(item.unitPrice===null?'':item.unitPrice)+'" onchange="updateSettlementDraft(\''+key+'\',\'unitPrice\',this.value,true)"></div>';
  }
  html+='<div class="settings-branding-field"><label class="lbl">الملاحظات</label><textarea rows="2" oninput="updateSettlementDraft(\''+key+'\',\'notes\',this.value,false)">'+esc(item.notes)+'</textarea></div>';
  html+='</div><div class="settings-empty-state" style="white-space:pre-line"><b>'+esc(result.formula)+'</b><br>القيمة دون إشارة: '+formatAccountMoney(result.unsignedTotal)+'<br>قيمة التأثير: '+formatSettlementSignedAmount(result.signedAmount)+'</div>';
  html+='<div class="settings-branding-actions"><button class="btn btn-red" onclick="removeSettlementDraft(\''+key+'\')">حذف التسوية</button></div></div>';
  return html;
}

function renderSettlementsSettings(){
  var draft=getSettlementsDraft();
  var context=getFinancialItemsCalculationContext();
  var summary=calculateSettlements(draft);
  var html='<div class="settings-branding-actions" style="justify-content:space-between">';
  html+='<label class="settings-branding-auto-toggle"><input type="checkbox" '+(draft.enabled?'checked':'')+' onchange="updateSettlementsDraftEnabled(this.checked)"><span>تفعيل التسويات النهائية</span></label>';
  html+='<button class="btn btn-blue" onclick="addSettlementDraft()">➕ إضافة تسوية</button></div>';
  if(!draft.items.length)html+='<div class="settings-empty-state">لا توجد تسويات في المسودة.</div>';
  draft.items.forEach(function(item){html+=renderSettlementDraft(item,context)});
  html+='<div class="settings-summary-grid">';
  html+='<div class="settings-summary-card"><span>إضافات المصروفات</span><strong>'+formatAccountMoney(summary.expense.additions)+'</strong></div>';
  html+='<div class="settings-summary-card"><span>خصومات المصروفات</span><strong>'+formatAccountMoney(summary.expense.deductions)+'</strong></div>';
  html+='<div class="settings-summary-card"><span>صافي تعديل المصروفات</span><strong>'+formatSettlementSignedAmount(summary.expense.netAdjustment)+'</strong></div>';
  html+='<div class="settings-summary-card"><span>إضافات الإيرادات</span><strong>'+formatAccountMoney(summary.income.additions)+'</strong></div>';
  html+='<div class="settings-summary-card"><span>خصومات الإيرادات</span><strong>'+formatAccountMoney(summary.income.deductions)+'</strong></div>';
  html+='<div class="settings-summary-card"><span>صافي تعديل الإيرادات</span><strong>'+formatSettlementSignedAmount(summary.income.netAdjustment)+'</strong></div>';
  html+='</div><div class="settings-branding-actions"><button class="btn btn-green" onclick="saveSettlementsSettings()">💾 حفظ التسويات</button><button class="btn btn-gray" onclick="cancelSettlementsSettings()">إلغاء التعديلات</button><button class="btn btn-red" onclick="resetSettlementsSettings()">مسح المسودة</button></div>';
  return html;
}

function renderAirConditioningExpenseSummary(expense){
  return '<div class="settings-summary-grid">'+
    '<div class="settings-summary-card"><span>❄️ إجمالي التكييف</span><strong>'+formatAccountMoney(expense.finalTotal)+'</strong></div>'+
    '<div class="settings-summary-card"><span>البيوت الداخلة في التكييف</span><strong>'+expense.includedHousesCount+'</strong></div>'+
    '<div class="settings-summary-card"><span>الغرف الداخلة في التكييف</span><strong>'+expense.includedRoomsCount+'</strong></div>'+
    '<div class="settings-summary-card"><span>الغرف المستبعدة من التكييف</span><strong>'+expense.excludedRoomsCount+'</strong></div>'+
    '</div>';
}

function renderAccommodationExpenseSummary(expense,airConditioningExpense,mealsExpense,financialItemsExpense){
  airConditioningExpense=airConditioningExpense||{finalTotal:0,includedHousesCount:0,includedRoomsCount:0,excludedRoomsCount:0};
  mealsExpense=mealsExpense||{finalTotal:0};
  financialItemsExpense=financialItemsExpense||{total:0};
  var cards=[
    ['🏨','إجمالي الإقامة',formatAccountMoney(expense.finalTotal)],
    ['❄️','إجمالي التكييف',formatAccountMoney(airConditioningExpense.finalTotal)],
    ['🍽️','إجمالي الوجبات',formatAccountMoney(mealsExpense.finalTotal)],
    ['🧾','المصروفات الإضافية',formatAccountMoney(financialItemsExpense.total)],
    ['💰','إجمالي المصروفات المنفذة',formatAccountMoney(expense.finalTotal+airConditioningExpense.finalTotal+mealsExpense.finalTotal+financialItemsExpense.total)],
    ['🏠','البيوت الداخلة في الإقامة',expense.includedHousesCount],
    ['🚪','الغرف الداخلة في الإقامة',expense.includedRoomsCount],
    ['⛔','الغرف المستبعدة من الإقامة',expense.excludedRoomsCount]
  ];
  var html='<div class="settings-summary-grid">';
  cards.forEach(function(card){
    html+='<div class="settings-summary-card"><span>'+card[0]+' '+card[1]+'</span><strong>'+card[2]+'</strong></div>';
  });
  html+='</div>';
  html+='<div class="settings-empty-state" style="margin-top:10px">تم تنفيذ حساب الإقامة والتكييف والوجبات فقط. المصروفات الإضافية والتسويات لم تُنفذ بعد.</div>';
  return html;
}

function renderAccountsOverview(context,accommodationExpense,airConditioningExpense,mealsExpense,financialItemsExpense){
  if(accommodationExpense)return renderAccommodationExpenseSummary(accommodationExpense,airConditioningExpense,mealsExpense,financialItemsExpense);
  var rooms=context.rooms||[];
  var displayedRooms=rooms.filter(function(room){return room.displayed}).length;
  var occupiedRooms=rooms.filter(function(room){return room.occupied}).length;
  var residents=rooms.reduce(function(total,room){return total+room.occupancyCount},0);
  var restaurantTotal=context.restaurant&&context.restaurant.available?context.restaurant.grandTotal:0;
  var cards=[
    ['🏠','عدد البيوت',context.houses.length],
    ['🚪','عدد الغرف',rooms.length],
    ['➕','الغرف المضافة للتسكين',displayedRooms],
    ['👁️','الغرف المشغولة',occupiedRooms],
    ['👥','عدد المقيمين الحالي',residents],
    ['📅','مدة المؤتمر بالأيام',context.days],
    ['🌙','عدد الليالي التقديري',context.nights],
    ['🍽️','إجمالي المطعم الحالي',formatAccountMoney(restaurantTotal)]
  ];
  var html='<div class="settings-summary-grid">';
  cards.forEach(function(card){
    html+='<div class="settings-summary-card"><span>'+card[0]+' '+card[1]+'</span><strong>'+card[2]+'</strong></div>';
  });
  html+='</div>';
  html+='<div class="settings-empty-state" style="margin-top:10px">هذه معاينة للبيانات الحالية فقط. لم يتم تفعيل أسعار أو قواعد حساب المصروفات بعد.</div>';
  return html;
}

function getAccountsDomKey(value){
  return String(value||'').replace(/[^A-Za-z0-9_-]/g,'_');
}

function getAccountCalculationMethodLabel(value){
  var labels={selected_rooms:'الغرف المختارة في التسكين',occupied_rooms:'الغرف المشغولة فقط',per_person:'حسب عدد الأشخاص',room_type:'حسب نوع الغرفة',fixed_house:'مبلغ ثابت للبيت',manual:'حساب يدوي'};
  return labels[value]||labels.selected_rooms;
}

function getAccountTimeUnitLabel(value){
  var labels={day:'لكل يوم',night:'لكل ليلة',conference:'مبلغ ثابت للمؤتمر'};
  return labels[value]||labels.day;
}

function getAccountDurationModeLabel(value){
  return value==='actual_occupancy'?'مدة الإشغال الفعلية':'مدة المؤتمر كاملة';
}

function getAirConditioningCalculationMethodLabel(value){
  var labels={
    per_room:'لكل غرفة',
    per_unit:'لكل وحدة تكييف',
    per_person:'لكل شخص',
    fixed_house:'مبلغ ثابت للبيت',
    manual:'حساب يدوي'
  };
  return labels[value]||labels.per_room;
}

function renderAccommodationAccountsSettings(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  if(!conference)return '<div class="settings-empty-state">لا يوجد مؤتمر حالي.</div>';
  var accounts=normalizeConferenceAccounts(conference);
  var defaults=accounts.settings.accommodationDefaults;
  var accommodation=accounts.expenses.accommodation;
  function numericValue(value){return value===null||value===undefined?'':value}
  var html='<div class="settings-branding-grid">';
  html+='<div class="settings-branding-field"><label class="settings-branding-auto-toggle"><input id="accounts_accommodation_enabled" type="checkbox" '+(accommodation.enabled!==false&&defaults.enabled!==false?'checked':'')+'><span>تفعيل حساب الإقامة</span></label></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="accounts_default_method">طريقة الحساب الافتراضية</label><select id="accounts_default_method" onchange="toggleAccommodationRoomTypeRatesSection(\'accounts_default_room_type_rates\',this.value)"><option value="selected_rooms" '+(defaults.calculationMethod==='selected_rooms'?'selected':'')+'>الغرف المختارة في التسكين</option><option value="occupied_rooms" '+(defaults.calculationMethod==='occupied_rooms'?'selected':'')+'>الغرف المشغولة فقط</option><option value="per_person" '+(defaults.calculationMethod==='per_person'?'selected':'')+'>حسب عدد الأشخاص</option><option value="room_type" '+(defaults.calculationMethod==='room_type'?'selected':'')+'>حسب نوع الغرفة</option><option value="fixed_house" '+(defaults.calculationMethod==='fixed_house'?'selected':'')+'>مبلغ ثابت للبيت</option><option value="manual" '+(defaults.calculationMethod==='manual'?'selected':'')+'>حساب يدوي</option></select></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="accounts_default_time_unit">وحدة الزمن</label><select id="accounts_default_time_unit"><option value="day" '+(defaults.timeUnit==='day'?'selected':'')+'>لكل يوم</option><option value="night" '+(defaults.timeUnit==='night'?'selected':'')+'>لكل ليلة</option><option value="conference" '+(defaults.timeUnit==='conference'?'selected':'')+'>مبلغ ثابت للمؤتمر</option></select></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="accounts_default_duration">مدة الحساب</label><select id="accounts_default_duration"><option value="conference" '+(defaults.durationMode==='conference'?'selected':'')+'>مدة المؤتمر كاملة</option><option value="actual_occupancy" '+(defaults.durationMode==='actual_occupancy'?'selected':'')+'>مدة الإشغال الفعلية</option></select></div>';
  html+='<div class="settings-branding-field"><label class="settings-branding-auto-toggle"><input id="accounts_default_include_closed" type="checkbox" '+(defaults.includeClosedRooms===true?'checked':'')+'><span>تضمين الغرف المغلقة</span></label></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="accounts_default_room_rate">سعر الغرفة الافتراضي</label><input id="accounts_default_room_rate" type="number" min="0" step="0.01" value="'+numericValue(defaults.roomRate)+'" placeholder="غير محدد"></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="accounts_default_person_rate">سعر الشخص الافتراضي</label><input id="accounts_default_person_rate" type="number" min="0" step="0.01" value="'+numericValue(defaults.personRate)+'" placeholder="غير محدد"></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="accounts_default_extra_bed_rate">سعر السرير الإضافي الافتراضي</label><input id="accounts_default_extra_bed_rate" type="number" min="0" step="0.01" value="'+numericValue(defaults.extraBedRate)+'" placeholder="غير محدد"></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="accounts_currency">العملة</label><input id="accounts_currency" type="text" value="'+esc(accounts.settings.currency||'EGP')+'"></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="accounts_rounding_precision">عدد المنازل العشرية للعرض</label><input id="accounts_rounding_precision" type="number" min="0" max="6" step="1" value="'+(parseInt(accounts.settings.roundingPrecision,10)||0)+'"></div>';
  html+='</div>';
  html+=renderAccommodationRoomTypeRatesFields({
    sectionId:'accounts_default_room_type_rates',
    inputPrefix:'accounts_default_room_type_rate',
    rates:defaults.roomTypeRates,
    visible:defaults.calculationMethod==='room_type',
    title:'أسعار أنواع الغرف'
  });
  html+='<div class="settings-branding-actions"><button class="btn btn-green" onclick="saveAccommodationDefaults()">💾 حفظ إعدادات الإقامة العامة</button></div>';
  return html;
}

function readNullableAccountNumber(inputId,label){
  var input=typeof ge==='function'?ge(inputId):document.getElementById(inputId);
  var raw=input?String(input.value).trim():'';
  if(raw==='')return {ok:true,value:null};
  var value=Number(raw);
  if(!isFinite(value)||value<0){
    showToast('قيمة '+label+' غير صحيحة. أدخل رقمًا صفرًا أو أكبر.','#E74C3C');
    if(input)input.focus();
    return {ok:false,value:null};
  }
  return {ok:true,value:value};
}

function readNullableAccountInteger(inputId,label){
  var result=readNullableAccountNumber(inputId,label);
  if(!result.ok||result.value===null)return result;
  if(Math.floor(result.value)!==result.value){
    var input=typeof ge==='function'?ge(inputId):document.getElementById(inputId);
    showToast('قيمة '+label+' يجب أن تكون عددًا صحيحًا.','#E74C3C');
    if(input)input.focus();
    return {ok:false,value:null};
  }
  return result;
}

function saveAccommodationDefaults(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveAccommodationDefaults',null))return false;
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  if(!conference)return;
  var roomRate=readNullableAccountNumber('accounts_default_room_rate','سعر الغرفة');
  var personRate=readNullableAccountNumber('accounts_default_person_rate','سعر الشخص');
  var extraBedRate=readNullableAccountNumber('accounts_default_extra_bed_rate','سعر السرير الإضافي');
  var roomTypeRates=readAccommodationRoomTypeRateInputs('accounts_default_room_type_rate');
  if(!roomRate.ok||!personRate.ok||!extraBedRate.ok||!roomTypeRates.ok)return;
  var precisionInput=ge('accounts_rounding_precision');
  var precision=Number(precisionInput?precisionInput.value:2);
  if(!Number.isInteger(precision)||precision<0||precision>6){
    showToast('عدد المنازل العشرية يجب أن يكون رقمًا صحيحًا من 0 إلى 6.','#E74C3C');
    if(precisionInput)precisionInput.focus();
    return;
  }
  var accounts=normalizeConferenceAccounts(conference);
  var defaults=accounts.settings.accommodationDefaults;
  var enabled=!!ge('accounts_accommodation_enabled').checked;
  accounts.expenses.accommodation.enabled=enabled;
  defaults.enabled=enabled;
  defaults.calculationMethod=ge('accounts_default_method').value;
  defaults.timeUnit=ge('accounts_default_time_unit').value;
  defaults.durationMode=ge('accounts_default_duration').value;
  defaults.includeClosedRooms=!!ge('accounts_default_include_closed').checked;
  defaults.roomRate=roomRate.value;
  defaults.personRate=personRate.value;
  defaults.extraBedRate=extraBedRate.value;
  defaults.roomTypeRates=roomTypeRates.values;
  accounts.settings.currency=ge('accounts_currency').value.trim()||'EGP';
  accounts.settings.roundingPrecision=precision;
  accounts.updatedAt=new Date().toISOString();
  if(typeof save==='function'&&save()===false){
    showToast('تعذر حفظ إعدادات الإقامة.','#E74C3C');
    return;
  }
  renderAccounts();
  showToast('✅ تم حفظ إعدادات الإقامة العامة');
}

function renderAirConditioningAccountsSettings(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  if(!conference)return '<div class="settings-empty-state">لا يوجد مؤتمر حالي.</div>';
  var accounts=normalizeConferenceAccounts(conference);
  var defaults=accounts.settings.airConditioningDefaults;
  var airConditioning=accounts.expenses.airConditioning;
  function numericValue(value){return value===null||value===undefined?'':value}
  var html='<div class="settings-branding-grid">';
  html+='<div class="settings-branding-field"><label class="settings-branding-auto-toggle"><input id="accounts_air_enabled" type="checkbox" '+(airConditioning.enabled!==false&&defaults.enabled!==false?'checked':'')+'><span>تفعيل حساب التكييف</span></label></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="accounts_air_method">طريقة الحساب الافتراضية</label><select id="accounts_air_method"><option value="per_room" '+(defaults.calculationMethod==='per_room'?'selected':'')+'>لكل غرفة</option><option value="per_unit" '+(defaults.calculationMethod==='per_unit'?'selected':'')+'>لكل وحدة تكييف</option><option value="per_person" '+(defaults.calculationMethod==='per_person'?'selected':'')+'>لكل شخص</option><option value="fixed_house" '+(defaults.calculationMethod==='fixed_house'?'selected':'')+'>مبلغ ثابت للبيت</option><option value="manual" '+(defaults.calculationMethod==='manual'?'selected':'')+'>حساب يدوي</option></select></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="accounts_air_time">وحدة الزمن</label><select id="accounts_air_time"><option value="day" '+(defaults.timeUnit==='day'?'selected':'')+'>لكل يوم</option><option value="night" '+(defaults.timeUnit==='night'?'selected':'')+'>لكل ليلة</option><option value="conference" '+(defaults.timeUnit==='conference'?'selected':'')+'>مبلغ ثابت للمؤتمر</option></select></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="accounts_air_duration">مدة الحساب</label><select id="accounts_air_duration"><option value="conference" '+(defaults.durationMode==='conference'?'selected':'')+'>مدة المؤتمر كاملة</option><option value="actual_occupancy" '+(defaults.durationMode==='actual_occupancy'?'selected':'')+'>مدة الإشغال الفعلية</option></select></div>';
  html+='<div class="settings-branding-field"><label class="settings-branding-auto-toggle"><input id="accounts_air_closed" type="checkbox" '+(defaults.includeClosedRooms===true?'checked':'')+'><span>تضمين الغرف المغلقة</span></label></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="accounts_air_room_rate">سعر الغرفة</label><input id="accounts_air_room_rate" type="number" min="0" step="0.01" value="'+numericValue(defaults.roomRate)+'" placeholder="غير محدد"></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="accounts_air_unit_rate">سعر وحدة التكييف</label><input id="accounts_air_unit_rate" type="number" min="0" step="0.01" value="'+numericValue(defaults.unitRate)+'" placeholder="غير محدد"></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="accounts_air_person_rate">سعر الشخص</label><input id="accounts_air_person_rate" type="number" min="0" step="0.01" value="'+numericValue(defaults.personRate)+'" placeholder="غير محدد"></div>';
  html+='</div><div class="settings-branding-actions"><button class="btn btn-green" onclick="saveAirConditioningDefaults()">💾 حفظ إعدادات التكييف العامة</button></div>';
  return html;
}

function saveAirConditioningDefaults(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveAirConditioningDefaults',null))return false;
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  if(!conference)return;
  var roomRate=readNullableAccountNumber('accounts_air_room_rate','سعر الغرفة');
  var unitRate=readNullableAccountNumber('accounts_air_unit_rate','سعر وحدة التكييف');
  var personRate=readNullableAccountNumber('accounts_air_person_rate','سعر الشخص');
  if(!roomRate.ok||!unitRate.ok||!personRate.ok)return;
  var accounts=normalizeConferenceAccounts(conference);
  var defaults=accounts.settings.airConditioningDefaults;
  var enabled=!!ge('accounts_air_enabled').checked;
  accounts.expenses.airConditioning.enabled=enabled;
  defaults.enabled=enabled;
  defaults.calculationMethod=ge('accounts_air_method').value;
  defaults.timeUnit=ge('accounts_air_time').value;
  defaults.durationMode=ge('accounts_air_duration').value;
  defaults.includeClosedRooms=!!ge('accounts_air_closed').checked;
  defaults.roomRate=roomRate.value;
  defaults.unitRate=unitRate.value;
  defaults.personRate=personRate.value;
  accounts.updatedAt=new Date().toISOString();
  if(typeof save==='function'&&save()===false){
    showToast('تعذر حفظ إعدادات التكييف.','#E74C3C');
    return;
  }
  renderAccounts();
  showToast('✅ تم حفظ إعدادات التكييف العامة');
}

function renderMealsAccountsSettings(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  if(!conference)return '<div class="settings-empty-state">لا يوجد مؤتمر حالي.</div>';
  var accounts=normalizeConferenceAccounts(conference);
  var defaults=accounts.settings.mealsDefaults;
  var meals=accounts.expenses.meals;
  function value(number){return number===null||number===undefined?'':number}
  var html='<div class="settings-branding-grid">';
  html+='<div class="settings-branding-field"><label class="settings-branding-auto-toggle"><input id="accounts_meals_enabled" type="checkbox" '+(meals.enabled!==false?'checked':'')+'><span>تفعيل حساب الوجبات</span></label></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="accounts_meals_mode">وضع الحساب</label><select id="accounts_meals_mode"><option value="restaurant_prices" '+(defaults.calculationMode==='restaurant_prices'?'selected':'')+'>أسعار تبويب المطعم</option><option value="accounts_prices" '+(defaults.calculationMode==='accounts_prices'?'selected':'')+'>أسعار الحسابات</option><option value="manual" '+(defaults.calculationMode==='manual'?'selected':'')+'>إجمالي يدوي</option></select><div class="settings-branding-file-name">في وضع أسعار المطعم يكون تبويب المطعم هو المصدر الأساسي. أسعار الحسابات تُستخدم في وضع أسعار الحسابات.</div></div>';
  [['breakfast','الإفطار'],['lunch','الغداء'],['dinner','العشاء']].forEach(function(item){
    var key=item[0];
    var cap=key.charAt(0).toUpperCase()+key.slice(1);
    html+='<div class="settings-branding-field"><label class="settings-branding-auto-toggle"><input id="accounts_meals_include_'+key+'" type="checkbox" '+(defaults['include'+cap]!==false?'checked':'')+'><span>تضمين '+item[1]+'</span></label></div>';
    html+='<div class="settings-branding-field"><label class="lbl" for="accounts_meals_adult_'+key+'">سعر بالغ '+item[1]+'</label><input id="accounts_meals_adult_'+key+'" type="number" min="0" step="0.01" value="'+value(defaults['adult'+cap+'Price'])+'" placeholder="غير محدد"></div>';
    html+='<div class="settings-branding-field"><label class="lbl" for="accounts_meals_child_'+key+'">سعر طفل '+item[1]+'</label><input id="accounts_meals_child_'+key+'" type="number" min="0" step="0.01" value="'+value(defaults['child'+cap+'Price'])+'" placeholder="غير محدد"></div>';
  });
  html+='<div class="settings-branding-field"><label class="lbl" for="accounts_meals_manual">إجمالي يدوي عام للوجبات</label><input id="accounts_meals_manual" type="number" min="0" step="0.01" value="'+value(meals.manualTotal)+'" placeholder="غير محدد"></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="accounts_meals_notes">ملاحظات</label><textarea id="accounts_meals_notes" rows="3">'+esc(meals.notes||'')+'</textarea></div>';
  html+='</div><div class="settings-branding-actions"><button class="btn btn-green" onclick="saveMealsDefaults()">💾 حفظ إعدادات الوجبات</button></div>';
  if(defaults.calculationMode==='manual')html+='<div class="settings-empty-state">في الوضع اليدوي تكون تفاصيل الأيام للمعاينة، والإجمالي اليدوي العام هو المعتمد.</div>';
  return html;
}

function saveMealsDefaults(){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveMealsDefaults',null))return false;
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  if(!conference)return;
  var prices={};
  var ok=true;
  ['breakfast','lunch','dinner'].forEach(function(key){
    prices['adult_'+key]=readNullableAccountNumber('accounts_meals_adult_'+key,'سعر البالغ');
    prices['child_'+key]=readNullableAccountNumber('accounts_meals_child_'+key,'سعر الطفل');
    if(!prices['adult_'+key].ok||!prices['child_'+key].ok)ok=false;
  });
  var manual=readNullableAccountNumber('accounts_meals_manual','الإجمالي اليدوي العام');
  if(!ok||!manual.ok)return;
  var accounts=normalizeConferenceAccounts(conference);
  var defaults=accounts.settings.mealsDefaults;
  var meals=accounts.expenses.meals;
  meals.enabled=!!ge('accounts_meals_enabled').checked;
  defaults.enabled=meals.enabled;
  defaults.calculationMode=ge('accounts_meals_mode').value;
  ['breakfast','lunch','dinner'].forEach(function(key){
    var cap=key.charAt(0).toUpperCase()+key.slice(1);
    defaults['include'+cap]=!!ge('accounts_meals_include_'+key).checked;
    defaults['adult'+cap+'Price']=prices['adult_'+key].value;
    defaults['child'+cap+'Price']=prices['child_'+key].value;
  });
  meals.manualTotal=manual.value;
  meals.notes=ge('accounts_meals_notes').value.trim();
  accounts.updatedAt=new Date().toISOString();
  if(save()===false){showToast('تعذر حفظ إعدادات الوجبات.','#E74C3C');return}
  renderAccounts();
  showToast('✅ تم حفظ إعدادات الوجبات');
}

function renderInheritedAccountField(options){
  var inherited=options.raw===null||options.raw===undefined;
  var inputId=options.inputId;
  var inheritId=inputId+'_inherit';
  var onchange=options.onchange?' onchange="'+options.onchange+'"':'';
  var html='<div class="settings-branding-field"><label class="lbl" for="'+inputId+'">'+options.label+'</label>';
  html+='<label class="settings-branding-auto-toggle" style="margin-bottom:6px"><input id="'+inheritId+'" class="'+options.inheritClass+'" type="checkbox" '+(inherited?'checked':'')+' onchange="ge(\''+inputId+'\').disabled=this.checked"><span>'+options.inheritText+'</span></label>';
  if(options.type==='select'){
    html+='<select id="'+inputId+'" '+(inherited?'disabled':'')+onchange+'>'+options.options+'</select>';
  }else if(options.type==='boolean'){
    var current=inherited?options.resolved:options.raw;
    html+='<select id="'+inputId+'" '+(inherited?'disabled':'')+'><option value="true" '+(current===true?'selected':'')+'>نعم</option><option value="false" '+(current===false?'selected':'')+'>لا</option></select>';
  }else{
    var value=inherited?options.resolved:options.raw;
    html+='<input id="'+inputId+'" type="number" min="0" step="0.01" value="'+(value===null||value===undefined?'':value)+'" '+(inherited?'disabled':'')+'>';
  }
  html+='<div class="settings-branding-file-name">القيمة النهائية: '+esc(String(options.displayValue))+' — المصدر: '+getAccountSettingSourceLabel(options.source)+'</div></div>';
  return html;
}

function toggleAccommodationHouseDefaults(houseId,useDefaults){
  var domKey=getAccountsDomKey(houseId);
  document.querySelectorAll('.account-house-inherit-'+domKey).forEach(function(checkbox){
    checkbox.checked=!!useDefaults;
    var inputId=checkbox.id.replace(/_inherit$/,'');
    var input=ge(inputId);
    if(input)input.disabled=!!useDefaults;
  });
}

function renderAccommodationHouseSettings(houseContext){
  var houseId=houseContext.id;
  var domKey=getAccountsDomKey(houseId);
  var jsHouse=String(houseId).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  var stored=getAccommodationHouseSettings(houseId,false)||{};
  var overrides=stored.overrides&&typeof stored.overrides==='object'?stored.overrides:{};
  var resolved=resolveAccommodationHouseSettings(houseId);
  var inheritClass='account-house-inherit-'+domKey;
  var inheritedKeys=['enabled','calculationMethod','timeUnit','durationMode','includeClosedRooms','roomRate','personRate','extraBedRate'];
  var usesDefaults=inheritedKeys.every(function(key){return (key==='enabled'?stored.enabled:overrides[key])===null||(key==='enabled'?stored.enabled:overrides[key])===undefined})&&
    getAccommodationRoomTypeRateKeys().every(function(key){
      return !overrides.roomTypeRates||overrides.roomTypeRates[key]===null||overrides.roomTypeRates[key]===undefined;
    });
  function selectOptions(values,current){
    return values.map(function(item){return '<option value="'+item[0]+'" '+(current===item[0]?'selected':'')+'>'+item[1]+'</option>'}).join('');
  }
  var html='<div class="settings-section" style="margin:10px 0"><div class="settings-section-title">إعدادات حساب البيت</div>';
  html+='<label class="settings-branding-auto-toggle" style="margin-bottom:10px"><input type="checkbox" '+(usesDefaults?'checked':'')+' onchange="toggleAccommodationHouseDefaults(\''+jsHouse+'\',this.checked)"><span>استخدام الإعدادات العامة</span></label>';
  html+='<div class="settings-branding-grid">';
  html+=renderInheritedAccountField({inputId:'account_house_enabled_'+domKey,label:'إدخال البيت في الحساب',raw:stored.enabled,resolved:resolved.values.enabled,displayValue:resolved.values.enabled?'نعم':'لا',source:resolved.sources.enabled,type:'boolean',inheritClass:inheritClass,inheritText:'استخدام الإعداد العام'});
  html+=renderInheritedAccountField({inputId:'account_house_method_'+domKey,label:'طريقة الحساب',raw:overrides.calculationMethod,resolved:resolved.values.calculationMethod,displayValue:getAccountCalculationMethodLabel(resolved.values.calculationMethod),source:resolved.sources.calculationMethod,type:'select',options:selectOptions([['selected_rooms','الغرف المختارة في التسكين'],['occupied_rooms','الغرف المشغولة فقط'],['per_person','حسب عدد الأشخاص'],['room_type','حسب نوع الغرفة'],['fixed_house','مبلغ ثابت للبيت'],['manual','حساب يدوي']],overrides.calculationMethod===null||overrides.calculationMethod===undefined?resolved.values.calculationMethod:overrides.calculationMethod),inheritClass:inheritClass,inheritText:'استخدام الإعداد العام'});
  html+=renderInheritedAccountField({inputId:'account_house_time_'+domKey,label:'وحدة الزمن',raw:overrides.timeUnit,resolved:resolved.values.timeUnit,displayValue:getAccountTimeUnitLabel(resolved.values.timeUnit),source:resolved.sources.timeUnit,type:'select',options:selectOptions([['day','لكل يوم'],['night','لكل ليلة'],['conference','مبلغ ثابت للمؤتمر']],overrides.timeUnit===null||overrides.timeUnit===undefined?resolved.values.timeUnit:overrides.timeUnit),inheritClass:inheritClass,inheritText:'استخدام الإعداد العام'});
  html+=renderInheritedAccountField({inputId:'account_house_duration_'+domKey,label:'مدة الحساب',raw:overrides.durationMode,resolved:resolved.values.durationMode,displayValue:getAccountDurationModeLabel(resolved.values.durationMode),source:resolved.sources.durationMode,type:'select',options:selectOptions([['conference','مدة المؤتمر كاملة'],['actual_occupancy','مدة الإشغال الفعلية']],overrides.durationMode===null||overrides.durationMode===undefined?resolved.values.durationMode:overrides.durationMode),inheritClass:inheritClass,inheritText:'استخدام الإعداد العام'});
  html+=renderInheritedAccountField({inputId:'account_house_closed_'+domKey,label:'تضمين الغرف المغلقة',raw:overrides.includeClosedRooms,resolved:resolved.values.includeClosedRooms,displayValue:resolved.values.includeClosedRooms?'نعم':'لا',source:resolved.sources.includeClosedRooms,type:'boolean',inheritClass:inheritClass,inheritText:'استخدام الإعداد العام'});
  html+=renderInheritedAccountField({inputId:'account_house_room_rate_'+domKey,label:'سعر الغرفة',raw:overrides.roomRate,resolved:resolved.values.roomRate,displayValue:resolved.values.roomRate,source:resolved.sources.roomRate,type:'number',inheritClass:inheritClass,inheritText:'استخدام الإعداد العام'});
  html+=renderInheritedAccountField({inputId:'account_house_person_rate_'+domKey,label:'سعر الشخص',raw:overrides.personRate,resolved:resolved.values.personRate,displayValue:resolved.values.personRate,source:resolved.sources.personRate,type:'number',inheritClass:inheritClass,inheritText:'استخدام الإعداد العام'});
  html+=renderInheritedAccountField({inputId:'account_house_extra_rate_'+domKey,label:'سعر السرير الإضافي',raw:overrides.extraBedRate,resolved:resolved.values.extraBedRate,displayValue:resolved.values.extraBedRate,source:resolved.sources.extraBedRate,type:'number',inheritClass:inheritClass,inheritText:'استخدام الإعداد العام'});
  html+='<div class="settings-branding-field"><label class="lbl" for="account_house_fixed_'+domKey+'">مبلغ ثابت للبيت</label><input id="account_house_fixed_'+domKey+'" type="number" min="0" step="0.01" value="'+(stored.fixedAmount===null||stored.fixedAmount===undefined?'':stored.fixedAmount)+'" placeholder="غير محدد"></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="account_house_manual_'+domKey+'">إجمالي يدوي للبيت</label><input id="account_house_manual_'+domKey+'" type="number" min="0" step="0.01" value="'+(stored.manualTotal===null||stored.manualTotal===undefined?'':stored.manualTotal)+'" placeholder="غير محدد"></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="account_house_notes_'+domKey+'">ملاحظات</label><textarea id="account_house_notes_'+domKey+'" rows="3">'+esc(stored.notes||'')+'</textarea></div>';
  html+='</div>';
  html+=renderAccommodationRoomTypeRatesFields({
    sectionId:'account_house_room_type_rates_'+domKey,
    inputPrefix:'account_house_room_type_rate_'+domKey,
    rates:overrides.roomTypeRates,
    resolvedRates:resolved.values.roomTypeRates,
    rateSources:resolved.sources.roomTypeRates,
    inherited:true,
    inheritClass:inheritClass,
    inheritText:'استخدام السعر العام',
    title:'أسعار أنواع الغرف للبيت'
  });
  html+='<div class="settings-branding-actions"><button class="btn btn-green" onclick="saveAccommodationHouseSettings(\''+jsHouse+'\')">💾 حفظ إعدادات البيت</button><button class="btn btn-gray" onclick="resetAccommodationHouseSettings(\''+jsHouse+'\')">إعادة إعدادات البيت إلى الإعداد العام</button><button class="btn btn-red" onclick="resetAccommodationHouseAndRoomsSettings(\''+jsHouse+'\')">إعادة إعدادات البيت والغرف إلى الإعداد العام</button></div></div>';
  return html;
}

function readInheritedAccountValue(inputId,type){
  var inherit=ge(inputId+'_inherit');
  if(inherit&&inherit.checked)return {ok:true,value:null};
  var input=ge(inputId);
  if(type==='boolean')return {ok:true,value:input&&input.value==='true'};
  if(type==='number')return readNullableAccountNumber(inputId,input&&input.previousElementSibling?input.previousElementSibling.textContent:'القيمة');
  return {ok:true,value:input?input.value:null};
}

function saveAccommodationHouseSettings(houseId){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveAccommodationHouseSettings',null))return false;
  var conference=getCurrentConference();
  if(!conference)return;
  var domKey=getAccountsDomKey(houseId);
  var enabled=readInheritedAccountValue('account_house_enabled_'+domKey,'boolean');
  var method=readInheritedAccountValue('account_house_method_'+domKey,'select');
  var timeUnit=readInheritedAccountValue('account_house_time_'+domKey,'select');
  var duration=readInheritedAccountValue('account_house_duration_'+domKey,'select');
  var includeClosed=readInheritedAccountValue('account_house_closed_'+domKey,'boolean');
  var roomRate=readInheritedAccountValue('account_house_room_rate_'+domKey,'number');
  var personRate=readInheritedAccountValue('account_house_person_rate_'+domKey,'number');
  var extraRate=readInheritedAccountValue('account_house_extra_rate_'+domKey,'number');
  var roomTypeRates=readAccommodationRoomTypeRateInputs('account_house_room_type_rate_'+domKey,null,true);
  var fixedAmount=readNullableAccountNumber('account_house_fixed_'+domKey,'المبلغ الثابت للبيت');
  var manualTotal=readNullableAccountNumber('account_house_manual_'+domKey,'الإجمالي اليدوي للبيت');
  if(!roomRate.ok||!personRate.ok||!extraRate.ok||!roomTypeRates.ok||!fixedAmount.ok||!manualTotal.ok)return;
  var settings=getAccommodationHouseSettings(houseId,true);
  settings.enabled=enabled.value;
  settings.overrides=settings.overrides&&typeof settings.overrides==='object'?settings.overrides:{};
  settings.overrides.calculationMethod=method.value;
  settings.overrides.timeUnit=timeUnit.value;
  settings.overrides.durationMode=duration.value;
  settings.overrides.includeClosedRooms=includeClosed.value;
  settings.overrides.roomRate=roomRate.value;
  settings.overrides.personRate=personRate.value;
  settings.overrides.extraBedRate=extraRate.value;
  settings.overrides.roomTypeRates=roomTypeRates.values;
  settings.fixedAmount=fixedAmount.value;
  settings.manualTotal=manualTotal.value;
  settings.rooms=settings.rooms&&typeof settings.rooms==='object'?settings.rooms:{};
  settings.notes=ge('account_house_notes_'+domKey).value.trim();
  conference.accounts.updatedAt=new Date().toISOString();
  if(save()===false){showToast('تعذر حفظ إعدادات البيت.','#E74C3C');return}
  renderAccounts();
  showToast('✅ تم حفظ إعدادات البيت');
}

function resetAccommodationHouseSettings(houseId){
  if(!confirm('هل تريد إعادة إعدادات هذا البيت إلى الإعداد العام؟ ستظل تخصيصات الغرف محفوظة.'))return;
  var conference=getCurrentConference();
  var settings=getAccommodationHouseSettings(houseId,false);
  if(!conference||!settings){showToast('لا توجد إعدادات مخصصة لهذا البيت.','#E67E22');return}
  settings.enabled=null;
  settings.overrides={
    calculationMethod:null,
    timeUnit:null,
    durationMode:null,
    includeClosedRooms:null,
    roomRate:null,
    personRate:null,
    extraBedRate:null,
    roomTypeRates:getDefaultAccommodationRoomTypeRates()
  };
  settings.fixedAmount=null;
  settings.manualTotal=null;
  conference.accounts.updatedAt=new Date().toISOString();
  if(save()===false){showToast('تعذر إعادة إعدادات البيت.','#E74C3C');return}
  renderAccounts();
  showToast('✅ عادت إعدادات البيت إلى الإعداد العام');
}

function resetAccommodationHouseAndRoomsSettings(houseId){
  if(!confirm('هل تريد حذف جميع تخصيصات الحساب لهذا البيت وغرفه؟ لن تتغير بيانات البيت أو الغرف الأصلية.'))return;
  var conference=getCurrentConference();
  var accommodation=getAccommodationAccounts();
  if(!conference||!accommodation)return;
  if(Object.prototype.hasOwnProperty.call(accommodation.houses,houseId))delete accommodation.houses[houseId];
  conference.accounts.updatedAt=new Date().toISOString();
  if(save()===false){showToast('تعذر إعادة إعدادات البيت والغرف.','#E74C3C');return}
  renderAccounts();
  showToast('✅ تم حذف تخصيصات حساب البيت والغرف');
}

function toggleAirConditioningHouseDefaults(houseId,useDefaults){
  var domKey=getAccountsDomKey(houseId);
  document.querySelectorAll('.account-air-house-inherit-'+domKey).forEach(function(checkbox){
    checkbox.checked=!!useDefaults;
    var input=ge(checkbox.id.replace(/_inherit$/,''));
    if(input)input.disabled=!!useDefaults;
  });
}

function renderAirConditioningHouseSettings(houseContext){
  var houseId=houseContext.id;
  var domKey=getAccountsDomKey(houseId);
  var jsHouse=String(houseId).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  var stored=getAirConditioningHouseSettings(houseId,false)||{};
  var overrides=stored.overrides&&typeof stored.overrides==='object'?stored.overrides:{};
  var resolved=resolveAirConditioningHouseSettings(houseId);
  var inheritClass='account-air-house-inherit-'+domKey;
  var keys=['enabled','calculationMethod','timeUnit','durationMode','includeClosedRooms','roomRate','unitRate','personRate'];
  var usesDefaults=keys.every(function(key){
    return (key==='enabled'?stored.enabled:overrides[key])===null||
      (key==='enabled'?stored.enabled:overrides[key])===undefined;
  });
  function options(values,current){
    return values.map(function(item){
      return '<option value="'+item[0]+'" '+(current===item[0]?'selected':'')+'>'+item[1]+'</option>';
    }).join('');
  }
  var html='<div class="settings-section" style="margin:10px 0"><div class="settings-section-title">إعدادات تكييف البيت</div>';
  html+='<label class="settings-branding-auto-toggle" style="margin-bottom:10px"><input type="checkbox" '+(usesDefaults?'checked':'')+' onchange="toggleAirConditioningHouseDefaults(\''+jsHouse+'\',this.checked)"><span>استخدام الإعدادات العامة</span></label>';
  html+='<div class="settings-branding-grid">';
  html+=renderInheritedAccountField({inputId:'air_house_enabled_'+domKey,label:'إدخال البيت في حساب التكييف',raw:stored.enabled,resolved:resolved.values.enabled,displayValue:resolved.values.enabled?'نعم':'لا',source:resolved.sources.enabled,type:'boolean',inheritClass:inheritClass,inheritText:'استخدام الإعداد العام'});
  html+=renderInheritedAccountField({inputId:'air_house_method_'+domKey,label:'طريقة الحساب',raw:overrides.calculationMethod,resolved:resolved.values.calculationMethod,displayValue:getAirConditioningCalculationMethodLabel(resolved.values.calculationMethod),source:resolved.sources.calculationMethod,type:'select',options:options([['per_room','لكل غرفة'],['per_unit','لكل وحدة تكييف'],['per_person','لكل شخص'],['fixed_house','مبلغ ثابت للبيت'],['manual','حساب يدوي']],overrides.calculationMethod===null||overrides.calculationMethod===undefined?resolved.values.calculationMethod:overrides.calculationMethod),inheritClass:inheritClass,inheritText:'استخدام الإعداد العام'});
  html+=renderInheritedAccountField({inputId:'air_house_time_'+domKey,label:'وحدة الزمن',raw:overrides.timeUnit,resolved:resolved.values.timeUnit,displayValue:getAccountTimeUnitLabel(resolved.values.timeUnit),source:resolved.sources.timeUnit,type:'select',options:options([['day','لكل يوم'],['night','لكل ليلة'],['conference','مبلغ ثابت للمؤتمر']],overrides.timeUnit===null||overrides.timeUnit===undefined?resolved.values.timeUnit:overrides.timeUnit),inheritClass:inheritClass,inheritText:'استخدام الإعداد العام'});
  html+=renderInheritedAccountField({inputId:'air_house_duration_'+domKey,label:'مدة الحساب',raw:overrides.durationMode,resolved:resolved.values.durationMode,displayValue:getAccountDurationModeLabel(resolved.values.durationMode),source:resolved.sources.durationMode,type:'select',options:options([['conference','مدة المؤتمر كاملة'],['actual_occupancy','مدة الإشغال الفعلية']],overrides.durationMode===null||overrides.durationMode===undefined?resolved.values.durationMode:overrides.durationMode),inheritClass:inheritClass,inheritText:'استخدام الإعداد العام'});
  html+=renderInheritedAccountField({inputId:'air_house_closed_'+domKey,label:'تضمين الغرف المغلقة',raw:overrides.includeClosedRooms,resolved:resolved.values.includeClosedRooms,displayValue:resolved.values.includeClosedRooms?'نعم':'لا',source:resolved.sources.includeClosedRooms,type:'boolean',inheritClass:inheritClass,inheritText:'استخدام الإعداد العام'});
  html+=renderInheritedAccountField({inputId:'air_house_room_rate_'+domKey,label:'سعر الغرفة',raw:overrides.roomRate,resolved:resolved.values.roomRate,displayValue:resolved.values.roomRate,source:resolved.sources.roomRate,type:'number',inheritClass:inheritClass,inheritText:'استخدام الإعداد العام'});
  html+=renderInheritedAccountField({inputId:'air_house_unit_rate_'+domKey,label:'سعر الوحدة',raw:overrides.unitRate,resolved:resolved.values.unitRate,displayValue:resolved.values.unitRate,source:resolved.sources.unitRate,type:'number',inheritClass:inheritClass,inheritText:'استخدام الإعداد العام'});
  html+=renderInheritedAccountField({inputId:'air_house_person_rate_'+domKey,label:'سعر الشخص',raw:overrides.personRate,resolved:resolved.values.personRate,displayValue:resolved.values.personRate,source:resolved.sources.personRate,type:'number',inheritClass:inheritClass,inheritText:'استخدام الإعداد العام'});
  html+='<div class="settings-branding-field"><label class="lbl" for="air_house_units_'+domKey+'">عدد الوحدات الافتراضي لكل غرفة</label><input id="air_house_units_'+domKey+'" type="number" min="0" step="1" value="'+(stored.unitsCount===null||stored.unitsCount===undefined?'':stored.unitsCount)+'" placeholder="الافتراضي 1"></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="air_house_fixed_'+domKey+'">مبلغ ثابت</label><input id="air_house_fixed_'+domKey+'" type="number" min="0" step="0.01" value="'+(stored.fixedAmount===null||stored.fixedAmount===undefined?'':stored.fixedAmount)+'" placeholder="غير محدد"></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="air_house_manual_'+domKey+'">إجمالي يدوي</label><input id="air_house_manual_'+domKey+'" type="number" min="0" step="0.01" value="'+(stored.manualTotal===null||stored.manualTotal===undefined?'':stored.manualTotal)+'" placeholder="غير محدد"></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="air_house_notes_'+domKey+'">ملاحظات</label><textarea id="air_house_notes_'+domKey+'" rows="3">'+esc(stored.notes||'')+'</textarea></div>';
  html+='</div><div class="settings-branding-actions"><button class="btn btn-green" onclick="saveAirConditioningHouseSettings(\''+jsHouse+'\')">💾 حفظ إعدادات تكييف البيت</button><button class="btn btn-gray" onclick="resetAirConditioningHouseSettings(\''+jsHouse+'\')">إعادة إعدادات البيت للإعداد العام</button><button class="btn btn-red" onclick="resetAirConditioningHouseAndRoomsSettings(\''+jsHouse+'\')">إعادة إعدادات البيت والغرف للإعداد العام</button></div></div>';
  return html;
}

function saveAirConditioningHouseSettings(houseId){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveAirConditioningHouseSettings',null))return false;
  var conference=getCurrentConference();
  if(!conference)return;
  var key=getAccountsDomKey(houseId);
  var values={
    enabled:readInheritedAccountValue('air_house_enabled_'+key,'boolean'),
    method:readInheritedAccountValue('air_house_method_'+key,'select'),
    time:readInheritedAccountValue('air_house_time_'+key,'select'),
    duration:readInheritedAccountValue('air_house_duration_'+key,'select'),
    closed:readInheritedAccountValue('air_house_closed_'+key,'boolean'),
    roomRate:readInheritedAccountValue('air_house_room_rate_'+key,'number'),
    unitRate:readInheritedAccountValue('air_house_unit_rate_'+key,'number'),
    personRate:readInheritedAccountValue('air_house_person_rate_'+key,'number'),
    units:readNullableAccountInteger('air_house_units_'+key,'عدد وحدات التكييف'),
    fixed:readNullableAccountNumber('air_house_fixed_'+key,'المبلغ الثابت'),
    manual:readNullableAccountNumber('air_house_manual_'+key,'الإجمالي اليدوي')
  };
  if(!values.roomRate.ok||!values.unitRate.ok||!values.personRate.ok||!values.units.ok||!values.fixed.ok||!values.manual.ok)return;
  var settings=getAirConditioningHouseSettings(houseId,true);
  settings.enabled=values.enabled.value;
  settings.overrides=settings.overrides&&typeof settings.overrides==='object'?settings.overrides:{};
  settings.overrides.calculationMethod=values.method.value;
  settings.overrides.timeUnit=values.time.value;
  settings.overrides.durationMode=values.duration.value;
  settings.overrides.includeClosedRooms=values.closed.value;
  settings.overrides.roomRate=values.roomRate.value;
  settings.overrides.unitRate=values.unitRate.value;
  settings.overrides.personRate=values.personRate.value;
  settings.unitsCount=values.units.value;
  settings.fixedAmount=values.fixed.value;
  settings.manualTotal=values.manual.value;
  settings.rooms=settings.rooms&&typeof settings.rooms==='object'?settings.rooms:{};
  settings.notes=ge('air_house_notes_'+key).value.trim();
  conference.accounts.updatedAt=new Date().toISOString();
  if(save()===false){showToast('تعذر حفظ إعدادات تكييف البيت.','#E74C3C');return}
  renderAccounts();
  showToast('✅ تم حفظ إعدادات تكييف البيت');
}

function resetAirConditioningHouseSettings(houseId){
  if(!confirm('هل تريد إعادة إعدادات تكييف هذا البيت إلى الإعداد العام؟ ستظل تخصيصات تكييف الغرف محفوظة.'))return;
  var conference=getCurrentConference();
  var settings=getAirConditioningHouseSettings(houseId,false);
  if(!conference||!settings){showToast('لا توجد إعدادات تكييف مخصصة لهذا البيت.','#E67E22');return}
  settings.enabled=null;
  settings.overrides={calculationMethod:null,timeUnit:null,durationMode:null,includeClosedRooms:null,roomRate:null,unitRate:null,personRate:null};
  settings.unitsCount=null;
  settings.fixedAmount=null;
  settings.manualTotal=null;
  conference.accounts.updatedAt=new Date().toISOString();
  if(save()===false){showToast('تعذر إعادة إعدادات تكييف البيت.','#E74C3C');return}
  renderAccounts();
  showToast('✅ عادت إعدادات تكييف البيت إلى الإعداد العام');
}

function resetAirConditioningHouseAndRoomsSettings(houseId){
  if(!confirm('هل تريد حذف جميع تخصيصات التكييف لهذا البيت وغرفه؟ لن تتغير إعدادات الإقامة أو بيانات الغرف.'))return;
  var conference=getCurrentConference();
  var airConditioning=getAirConditioningAccounts();
  if(!conference||!airConditioning)return;
  if(Object.prototype.hasOwnProperty.call(airConditioning.houses,houseId))delete airConditioning.houses[houseId];
  conference.accounts.updatedAt=new Date().toISOString();
  if(save()===false){showToast('تعذر إعادة إعدادات تكييف البيت والغرف.','#E74C3C');return}
  renderAccounts();
  showToast('✅ تم حذف تخصيصات تكييف البيت والغرف');
}

function closeAccommodationRoomSettings(){
  var modal=ge('accommodationRoomAccountsModal');
  if(modal&&modal.parentNode)modal.parentNode.removeChild(modal);
}

function openAccommodationRoomSettings(houseId,roomId){
  var context=getAccountsConferenceContext();
  if(!context)return;
  var roomContext=null;
  (context.rooms||[]).forEach(function(room){
    if(!roomContext&&room.houseId===houseId&&room.id===roomId)roomContext=room;
  });
  if(!roomContext){showToast('تعذر العثور على الغرفة.','#E74C3C');return}
  closeAccommodationRoomSettings();
  var overlay=document.createElement('div');
  overlay.id='accommodationRoomAccountsModal';
  overlay.className='overlay app-modal';
  overlay.onclick=function(event){if(event.target===overlay)closeAccommodationRoomSettings()};
  overlay.innerHTML=renderAccommodationRoomSettings(roomContext);
  document.body.appendChild(overlay);
  overlay.style.display='flex';
}

function renderAccommodationRoomSettings(roomContext){
  var houseId=roomContext.houseId;
  var roomId=roomContext.id;
  var domKey=getAccountsDomKey(houseId+'_'+roomId);
  var stored=getAccommodationRoomSettings(houseId,roomId,false)||{};
  var overrides=stored.overrides&&typeof stored.overrides==='object'?stored.overrides:{};
  var resolved=resolveAccommodationRoomSettings(houseId,roomId);
  var sourceRoom=roomContext.sourceRoom||{beds:roomContext.baseBeds};
  var roomTypeKey=typeof getRoomTypeKey==='function'?getRoomTypeKey(sourceRoom):'single';
  var roomTypeLabel=typeof getRoomTypeLabel==='function'
    ?getRoomTypeLabel(sourceRoom)
    :getAccommodationRoomTypeRateLabel(roomTypeKey);
  function selectOptions(values,current){
    return values.map(function(item){return '<option value="'+item[0]+'" '+(current===item[0]?'selected':'')+'>'+item[1]+'</option>'}).join('');
  }
  var jsHouse=String(houseId).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  var jsRoom=String(roomId).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  var html='<div class="modal" style="max-width:760px" role="dialog" aria-modal="true"><div class="mhead"><span>تخصيص حساب الغرفة '+esc(roomContext.number||'')+'</span><span style="cursor:pointer" onclick="closeAccommodationRoomSettings()">✕</span></div><div class="mbody">';
  html+='<div class="settings-branding-grid">';
  html+='<div class="settings-branding-field"><label class="lbl" for="account_room_included">تضمين الغرفة</label><select id="account_room_included"><option value="auto" '+(stored.included!==true&&stored.included!==false?'selected':'')+'>تلقائي حسب طريقة الحساب</option><option value="true" '+(stored.included===true?'selected':'')+'>تضمين صريح</option><option value="false" '+(stored.included===false?'selected':'')+'>استبعاد صريح</option></select></div>';
  html+=renderInheritedAccountField({inputId:'account_room_method',label:'طريقة الحساب',raw:overrides.calculationMethod,resolved:resolved.values.calculationMethod,displayValue:getAccountCalculationMethodLabel(resolved.values.calculationMethod),source:resolved.sources.calculationMethod,type:'select',options:selectOptions([['selected_rooms','الغرف المختارة في التسكين'],['occupied_rooms','الغرف المشغولة فقط'],['per_person','حسب عدد الأشخاص'],['room_type','حسب نوع الغرفة'],['fixed_house','مبلغ ثابت للبيت'],['manual','حساب يدوي']],overrides.calculationMethod===null||overrides.calculationMethod===undefined?resolved.values.calculationMethod:overrides.calculationMethod),inheritClass:'account-room-inherit',inheritText:'استخدام إعداد البيت'});
  html+=renderInheritedAccountField({inputId:'account_room_time',label:'وحدة الزمن',raw:overrides.timeUnit,resolved:resolved.values.timeUnit,displayValue:getAccountTimeUnitLabel(resolved.values.timeUnit),source:resolved.sources.timeUnit,type:'select',options:selectOptions([['day','لكل يوم'],['night','لكل ليلة'],['conference','مبلغ ثابت للمؤتمر']],overrides.timeUnit===null||overrides.timeUnit===undefined?resolved.values.timeUnit:overrides.timeUnit),inheritClass:'account-room-inherit',inheritText:'استخدام إعداد البيت'});
  html+=renderInheritedAccountField({inputId:'account_room_duration',label:'مدة الحساب',raw:overrides.durationMode,resolved:resolved.values.durationMode,displayValue:getAccountDurationModeLabel(resolved.values.durationMode),source:resolved.sources.durationMode,type:'select',options:selectOptions([['conference','مدة المؤتمر كاملة'],['actual_occupancy','مدة الإشغال الفعلية']],overrides.durationMode===null||overrides.durationMode===undefined?resolved.values.durationMode:overrides.durationMode),inheritClass:'account-room-inherit',inheritText:'استخدام إعداد البيت'});
  html+=renderInheritedAccountField({inputId:'account_room_room_rate',label:'سعر الغرفة',raw:overrides.roomRate,resolved:resolved.values.roomRate,displayValue:resolved.values.roomRate,source:resolved.sources.roomRate,type:'number',inheritClass:'account-room-inherit',inheritText:'استخدام إعداد البيت'});
  html+=renderInheritedAccountField({inputId:'account_room_person_rate',label:'سعر الشخص',raw:overrides.personRate,resolved:resolved.values.personRate,displayValue:resolved.values.personRate,source:resolved.sources.personRate,type:'number',inheritClass:'account-room-inherit',inheritText:'استخدام إعداد البيت'});
  html+=renderInheritedAccountField({inputId:'account_room_extra_rate',label:'سعر السرير الإضافي',raw:overrides.extraBedRate,resolved:resolved.values.extraBedRate,displayValue:resolved.values.extraBedRate,source:resolved.sources.extraBedRate,type:'number',inheritClass:'account-room-inherit',inheritText:'استخدام إعداد البيت'});
  html+='<div class="settings-branding-field"><label class="lbl" for="account_room_manual">إجمالي يدوي للغرفة</label><input id="account_room_manual" type="number" min="0" step="0.01" value="'+(stored.manualTotal===null||stored.manualTotal===undefined?'':stored.manualTotal)+'" placeholder="غير محدد"></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="account_room_notes">ملاحظات</label><textarea id="account_room_notes" rows="3">'+esc(stored.notes||'')+'</textarea></div>';
  html+='</div>';
  html+='<div class="settings-empty-state" style="margin-top:10px">نوع الغرفة الحالي: '+esc(roomTypeLabel)+'</div>';
  html+=renderAccommodationRoomTypeRatesFields({
    sectionId:'account_room_type_rates',
    inputPrefix:'account_room_type_rate',
    rates:overrides.roomTypeRates,
    resolvedRates:resolved.values.roomTypeRates,
    rateSources:resolved.sources.roomTypeRates,
    keys:[roomTypeKey],
    inherited:true,
    inheritClass:'account-room-inherit',
    inheritText:'استخدام سعر البيت',
    title:'سعر نوع الغرفة الحالية'
  });
  html+='<div class="settings-branding-actions"><button class="btn btn-green" onclick="saveAccommodationRoomSettings(\''+jsHouse+'\',\''+jsRoom+'\')">💾 حفظ تخصيص الغرفة</button><button class="btn btn-red" onclick="clearAccommodationRoomSettings(\''+jsHouse+'\',\''+jsRoom+'\')">إلغاء التخصيص</button><button class="btn btn-gray" onclick="closeAccommodationRoomSettings()">إغلاق</button></div></div></div>';
  return html;
}

function isAccommodationRoomSettingsEmpty(settings){
  if(!settings)return true;
  var overrides=settings.overrides&&typeof settings.overrides==='object'?settings.overrides:{};
  var keys=['calculationMethod','timeUnit','durationMode','roomRate','personRate','extraBedRate'];
  return settings.included!==true&&settings.included!==false&&
    keys.every(function(key){return overrides[key]===null||overrides[key]===undefined})&&
    getAccommodationRoomTypeRateKeys().every(function(key){
      return !overrides.roomTypeRates||overrides.roomTypeRates[key]===null||overrides.roomTypeRates[key]===undefined;
    })&&
    (settings.manualTotal===null||settings.manualTotal===undefined)&&
    !String(settings.notes||'').trim();
}

function saveAccommodationRoomSettings(houseId,roomId){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveAccommodationRoomSettings',null))return false;
  var conference=getCurrentConference();
  if(!conference)return;
  var method=readInheritedAccountValue('account_room_method','select');
  var timeUnit=readInheritedAccountValue('account_room_time','select');
  var duration=readInheritedAccountValue('account_room_duration','select');
  var roomRate=readInheritedAccountValue('account_room_room_rate','number');
  var personRate=readInheritedAccountValue('account_room_person_rate','number');
  var extraRate=readInheritedAccountValue('account_room_extra_rate','number');
  var context=getAccountsConferenceContext();
  var roomContext=null;
  (context&&context.rooms||[]).forEach(function(room){
    if(!roomContext&&room.houseId===houseId&&room.id===roomId)roomContext=room;
  });
  var sourceRoom=roomContext&&roomContext.sourceRoom||{beds:roomContext&&roomContext.baseBeds};
  var roomTypeKey=typeof getRoomTypeKey==='function'?getRoomTypeKey(sourceRoom):'single';
  var roomTypeRate=readAccommodationRoomTypeRateInputs('account_room_type_rate',[roomTypeKey],true);
  var manualTotal=readNullableAccountNumber('account_room_manual','الإجمالي اليدوي للغرفة');
  if(!roomRate.ok||!personRate.ok||!extraRate.ok||!roomTypeRate.ok||!manualTotal.ok)return;
  var settings=getAccommodationRoomSettings(houseId,roomId,true);
  var includedValue=ge('account_room_included').value;
  settings.included=includedValue==='true'?true:(includedValue==='false'?false:null);
  settings.overrides=settings.overrides&&typeof settings.overrides==='object'?settings.overrides:{};
  settings.overrides.calculationMethod=method.value;
  settings.overrides.timeUnit=timeUnit.value;
  settings.overrides.durationMode=duration.value;
  settings.overrides.roomRate=roomRate.value;
  settings.overrides.personRate=personRate.value;
  settings.overrides.extraBedRate=extraRate.value;
  settings.overrides.roomTypeRates=normalizeAccommodationRoomTypeRates(settings.overrides.roomTypeRates);
  settings.overrides.roomTypeRates[roomTypeKey]=roomTypeRate.values[roomTypeKey];
  settings.manualTotal=manualTotal.value;
  settings.notes=ge('account_room_notes').value.trim();
  if(isAccommodationRoomSettingsEmpty(settings)){
    var houseSettings=getAccommodationHouseSettings(houseId,false);
    if(houseSettings&&houseSettings.rooms)delete houseSettings.rooms[roomId];
  }
  conference.accounts.updatedAt=new Date().toISOString();
  if(save()===false){showToast('تعذر حفظ تخصيص الغرفة.','#E74C3C');return}
  closeAccommodationRoomSettings();
  renderAccounts();
  showToast('✅ تم حفظ تخصيص الغرفة');
}

function clearAccommodationRoomSettings(houseId,roomId){
  if(!confirm('هل تريد إلغاء تخصيص حساب هذه الغرفة؟ لن تتغير بيانات الغرفة أو التسكين.'))return;
  var conference=getCurrentConference();
  var houseSettings=getAccommodationHouseSettings(houseId,false);
  if(!conference||!houseSettings||!houseSettings.rooms||!Object.prototype.hasOwnProperty.call(houseSettings.rooms,roomId)){
    closeAccommodationRoomSettings();
    showToast('لا يوجد تخصيص محفوظ لهذه الغرفة.','#E67E22');
    return;
  }
  delete houseSettings.rooms[roomId];
  conference.accounts.updatedAt=new Date().toISOString();
  if(save()===false){showToast('تعذر إلغاء تخصيص الغرفة.','#E74C3C');return}
  closeAccommodationRoomSettings();
  renderAccounts();
  showToast('✅ تم إلغاء تخصيص الغرفة');
}

function closeAirConditioningRoomSettings(){
  var modal=ge('airConditioningRoomAccountsModal');
  if(modal&&modal.parentNode)modal.parentNode.removeChild(modal);
}

function openAirConditioningRoomSettings(houseId,roomId){
  var context=getAccountsConferenceContext();
  if(!context)return;
  var roomContext=null;
  (context.rooms||[]).forEach(function(room){
    if(!roomContext&&room.houseId===houseId&&room.id===roomId)roomContext=room;
  });
  if(!roomContext){showToast('تعذر العثور على الغرفة.','#E74C3C');return}
  closeAirConditioningRoomSettings();
  var overlay=document.createElement('div');
  overlay.id='airConditioningRoomAccountsModal';
  overlay.className='overlay app-modal';
  overlay.onclick=function(event){if(event.target===overlay)closeAirConditioningRoomSettings()};
  overlay.innerHTML=renderAirConditioningRoomSettings(roomContext);
  document.body.appendChild(overlay);
  overlay.style.display='flex';
}

function renderAirConditioningRoomSettings(roomContext){
  var houseId=roomContext.houseId;
  var roomId=roomContext.id;
  var stored=getAirConditioningRoomSettings(houseId,roomId,false)||{};
  var overrides=stored.overrides&&typeof stored.overrides==='object'?stored.overrides:{};
  var resolved=resolveAirConditioningRoomSettings(houseId,roomId);
  function options(values,current){
    return values.map(function(item){
      return '<option value="'+item[0]+'" '+(current===item[0]?'selected':'')+'>'+item[1]+'</option>';
    }).join('');
  }
  var jsHouse=String(houseId).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  var jsRoom=String(roomId).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  var html='<div class="modal" style="max-width:760px" role="dialog" aria-modal="true"><div class="mhead"><span>تخصيص تكييف الغرفة '+esc(roomContext.number||'')+'</span><span style="cursor:pointer" onclick="closeAirConditioningRoomSettings()">✕</span></div><div class="mbody">';
  html+='<div class="settings-branding-grid">';
  html+='<div class="settings-branding-field"><label class="lbl" for="air_room_included">تضمين الغرفة</label><select id="air_room_included"><option value="auto" '+(stored.included!==true&&stored.included!==false?'selected':'')+'>تلقائي</option><option value="true" '+(stored.included===true?'selected':'')+'>تضمين صريح</option><option value="false" '+(stored.included===false?'selected':'')+'>استبعاد صريح</option></select></div>';
  html+=renderInheritedAccountField({inputId:'air_room_method',label:'طريقة الحساب',raw:overrides.calculationMethod,resolved:resolved.values.calculationMethod,displayValue:getAirConditioningCalculationMethodLabel(resolved.values.calculationMethod),source:resolved.sources.calculationMethod,type:'select',options:options([['per_room','لكل غرفة'],['per_unit','لكل وحدة تكييف'],['per_person','لكل شخص'],['fixed_house','مبلغ ثابت للبيت'],['manual','حساب يدوي']],overrides.calculationMethod===null||overrides.calculationMethod===undefined?resolved.values.calculationMethod:overrides.calculationMethod),inheritClass:'account-air-room-inherit',inheritText:'استخدام إعداد البيت'});
  html+=renderInheritedAccountField({inputId:'air_room_time',label:'وحدة الزمن',raw:overrides.timeUnit,resolved:resolved.values.timeUnit,displayValue:getAccountTimeUnitLabel(resolved.values.timeUnit),source:resolved.sources.timeUnit,type:'select',options:options([['day','لكل يوم'],['night','لكل ليلة'],['conference','مبلغ ثابت للمؤتمر']],overrides.timeUnit===null||overrides.timeUnit===undefined?resolved.values.timeUnit:overrides.timeUnit),inheritClass:'account-air-room-inherit',inheritText:'استخدام إعداد البيت'});
  html+=renderInheritedAccountField({inputId:'air_room_duration',label:'مدة الحساب',raw:overrides.durationMode,resolved:resolved.values.durationMode,displayValue:getAccountDurationModeLabel(resolved.values.durationMode),source:resolved.sources.durationMode,type:'select',options:options([['conference','مدة المؤتمر كاملة'],['actual_occupancy','مدة الإشغال الفعلية']],overrides.durationMode===null||overrides.durationMode===undefined?resolved.values.durationMode:overrides.durationMode),inheritClass:'account-air-room-inherit',inheritText:'استخدام إعداد البيت'});
  html+=renderInheritedAccountField({inputId:'air_room_room_rate',label:'سعر الغرفة',raw:overrides.roomRate,resolved:resolved.values.roomRate,displayValue:resolved.values.roomRate,source:resolved.sources.roomRate,type:'number',inheritClass:'account-air-room-inherit',inheritText:'استخدام إعداد البيت'});
  html+=renderInheritedAccountField({inputId:'air_room_unit_rate',label:'سعر الوحدة',raw:overrides.unitRate,resolved:resolved.values.unitRate,displayValue:resolved.values.unitRate,source:resolved.sources.unitRate,type:'number',inheritClass:'account-air-room-inherit',inheritText:'استخدام إعداد البيت'});
  html+=renderInheritedAccountField({inputId:'air_room_person_rate',label:'سعر الشخص',raw:overrides.personRate,resolved:resolved.values.personRate,displayValue:resolved.values.personRate,source:resolved.sources.personRate,type:'number',inheritClass:'account-air-room-inherit',inheritText:'استخدام إعداد البيت'});
  html+='<div class="settings-branding-field"><label class="lbl" for="air_room_units">عدد وحدات التكييف</label><input id="air_room_units" type="number" min="0" step="1" value="'+(stored.unitsCount===null||stored.unitsCount===undefined?'':stored.unitsCount)+'" placeholder="موروث من البيت أو 1"></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="air_room_manual">إجمالي يدوي</label><input id="air_room_manual" type="number" min="0" step="0.01" value="'+(stored.manualTotal===null||stored.manualTotal===undefined?'':stored.manualTotal)+'" placeholder="غير محدد"></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="air_room_notes">ملاحظات</label><textarea id="air_room_notes" rows="3">'+esc(stored.notes||'')+'</textarea></div>';
  html+='</div><div class="settings-branding-actions"><button class="btn btn-green" onclick="saveAirConditioningRoomSettings(\''+jsHouse+'\',\''+jsRoom+'\')">💾 حفظ تخصيص التكييف</button><button class="btn btn-red" onclick="clearAirConditioningRoomSettings(\''+jsHouse+'\',\''+jsRoom+'\')">إلغاء تخصيص التكييف</button><button class="btn btn-gray" onclick="closeAirConditioningRoomSettings()">إغلاق</button></div></div></div>';
  return html;
}

function isAirConditioningRoomSettingsEmpty(settings){
  if(!settings)return true;
  var overrides=settings.overrides&&typeof settings.overrides==='object'?settings.overrides:{};
  var keys=['calculationMethod','timeUnit','durationMode','roomRate','unitRate','personRate'];
  return settings.included!==true&&settings.included!==false&&
    keys.every(function(key){return overrides[key]===null||overrides[key]===undefined})&&
    (settings.unitsCount===null||settings.unitsCount===undefined)&&
    (settings.manualTotal===null||settings.manualTotal===undefined)&&
    !String(settings.notes||'').trim();
}

function saveAirConditioningRoomSettings(houseId,roomId){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveAirConditioningRoomSettings',null))return false;
  var conference=getCurrentConference();
  if(!conference)return;
  var values={
    method:readInheritedAccountValue('air_room_method','select'),
    time:readInheritedAccountValue('air_room_time','select'),
    duration:readInheritedAccountValue('air_room_duration','select'),
    roomRate:readInheritedAccountValue('air_room_room_rate','number'),
    unitRate:readInheritedAccountValue('air_room_unit_rate','number'),
    personRate:readInheritedAccountValue('air_room_person_rate','number'),
    units:readNullableAccountInteger('air_room_units','عدد وحدات التكييف'),
    manual:readNullableAccountNumber('air_room_manual','الإجمالي اليدوي')
  };
  if(!values.roomRate.ok||!values.unitRate.ok||!values.personRate.ok||!values.units.ok||!values.manual.ok)return;
  var settings=getAirConditioningRoomSettings(houseId,roomId,true);
  var included=ge('air_room_included').value;
  settings.included=included==='true'?true:(included==='false'?false:null);
  settings.overrides=settings.overrides&&typeof settings.overrides==='object'?settings.overrides:{};
  settings.overrides.calculationMethod=values.method.value;
  settings.overrides.timeUnit=values.time.value;
  settings.overrides.durationMode=values.duration.value;
  settings.overrides.roomRate=values.roomRate.value;
  settings.overrides.unitRate=values.unitRate.value;
  settings.overrides.personRate=values.personRate.value;
  settings.unitsCount=values.units.value;
  settings.manualTotal=values.manual.value;
  settings.notes=ge('air_room_notes').value.trim();
  if(isAirConditioningRoomSettingsEmpty(settings)){
    var houseSettings=getAirConditioningHouseSettings(houseId,false);
    if(houseSettings&&houseSettings.rooms)delete houseSettings.rooms[roomId];
  }
  conference.accounts.updatedAt=new Date().toISOString();
  if(save()===false){showToast('تعذر حفظ تخصيص تكييف الغرفة.','#E74C3C');return}
  closeAirConditioningRoomSettings();
  renderAccounts();
  showToast('✅ تم حفظ تخصيص تكييف الغرفة');
}

function clearAirConditioningRoomSettings(houseId,roomId){
  if(!confirm('هل تريد إلغاء تخصيص تكييف هذه الغرفة؟ لن تتغير إعدادات الإقامة أو بيانات الغرفة.'))return;
  var conference=getCurrentConference();
  var houseSettings=getAirConditioningHouseSettings(houseId,false);
  if(!conference||!houseSettings||!houseSettings.rooms||!Object.prototype.hasOwnProperty.call(houseSettings.rooms,roomId)){
    closeAirConditioningRoomSettings();
    showToast('لا يوجد تخصيص تكييف محفوظ لهذه الغرفة.','#E67E22');
    return;
  }
  delete houseSettings.rooms[roomId];
  conference.accounts.updatedAt=new Date().toISOString();
  if(save()===false){showToast('تعذر إلغاء تخصيص تكييف الغرفة.','#E74C3C');return}
  closeAirConditioningRoomSettings();
  renderAccounts();
  showToast('✅ تم إلغاء تخصيص تكييف الغرفة');
}

function renderAccommodationRoomExpense(roomExpense){
  if(!roomExpense)return '';
  return '<td>'+(roomExpense.included?'نعم':'لا')+'</td>'+
    '<td>'+esc(roomExpense.excludedReason||'—')+'</td>'+
    '<td>'+esc(getAccountCalculationMethodLabel(roomExpense.calculationMethod))+'</td>'+
    '<td>'+roomExpense.quantity+'</td>'+
    '<td>'+roomExpense.duration+' ('+esc(getAccountTimeUnitLabel(roomExpense.timeUnit))+')</td>'+
    '<td>'+formatAccountMoney(roomExpense.rate)+'</td>'+
    '<td>'+esc(getAccountSettingSourceLabel(roomExpense.rateSource))+'</td>'+
    '<td>'+formatAccountMoney(roomExpense.extraBedsAmount)+'</td>'+
    '<td>'+formatAccountMoney(roomExpense.calculatedTotal)+'</td>'+
    '<td><b>'+formatAccountMoney(roomExpense.finalTotal)+'</b></td>'+
    '<td style="white-space:pre-line;min-width:240px">'+esc(roomExpense.formula)+'</td>';
}

function renderAirConditioningRoomExpense(roomExpense){
  if(!roomExpense)return '<span>—</span>';
  var html='<details><summary>تفاصيل التكييف</summary><div style="min-width:260px;padding:8px">';
  html+='<div><b>الحالة:</b> '+(roomExpense.included?'داخلة':'مستبعدة')+'</div>';
  if(roomExpense.excludedReason)html+='<div><b>السبب:</b> '+esc(roomExpense.excludedReason)+'</div>';
  html+='<div><b>الطريقة:</b> '+esc(getAirConditioningCalculationMethodLabel(roomExpense.calculationMethod))+'</div>';
  html+='<div><b>الكمية:</b> '+roomExpense.quantity+'</div>';
  html+='<div><b>المدة:</b> '+roomExpense.duration+' ('+esc(getAccountTimeUnitLabel(roomExpense.timeUnit))+')</div>';
  html+='<div><b>السعر:</b> '+formatAccountMoney(roomExpense.rate)+' — '+esc(getAccountSettingSourceLabel(roomExpense.rateSource))+'</div>';
  html+='<div><b>الوحدات:</b> '+roomExpense.unitsCount+' — '+esc(getAccountSettingSourceLabel(roomExpense.unitsCountSource))+'</div>';
  html+='<div><b>المحسوب:</b> '+formatAccountMoney(roomExpense.calculatedTotal)+'</div>';
  html+='<div><b>النهائي:</b> '+formatAccountMoney(roomExpense.finalTotal)+'</div>';
  html+='<div style="white-space:pre-line"><b>المعادلة:</b> '+esc(roomExpense.formula)+'</div>';
  html+='</div></details>';
  return html;
}

function renderAccountsRoomsTable(houseContext,houseExpense,airConditioningHouseExpense){
  if(!houseContext.rooms.length)return '<div class="settings-empty-state">لا توجد غرف داخل هذا البيت.</div>';
  var roomExpenses=houseExpense&&houseExpense.rooms||[];
  var airRoomExpenses=airConditioningHouseExpense&&airConditioningHouseExpense.rooms||[];
  var html='<div style="overflow-x:auto"><table><thead><tr><th>الغرفة</th><th>الدور</th><th>الحالة</th><th>مضافة للتسكين</th><th>الأسرة الأساسية</th><th>الأسرة الإضافية</th><th>المستخدم من الإضافي</th><th>البالغون</th><th>الأطفال</th><th>الإشغال</th><th>داخلة في الحساب</th><th>سبب الاستبعاد</th><th>طريقة الحساب</th><th>الكمية</th><th>المدة</th><th>السعر</th><th>مصدر السعر</th><th>تكلفة الأسرة الإضافية</th><th>الإجمالي المحسوب</th><th>الإجمالي النهائي</th><th>المعادلة</th><th>تفاصيل التكييف</th><th>الحساب</th></tr></thead><tbody>';
  houseContext.rooms.forEach(function(room,index){
    var jsHouse=String(room.houseId).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    var jsRoom=String(room.id).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    html+='<tr><td><b>'+esc(room.number||'—')+'</b></td><td>'+esc(room.floorName||'—')+'</td><td>'+esc(room.statusLabel)+'</td><td>'+(room.displayed?'نعم':'لا')+'</td><td>'+room.baseBeds+'</td><td>'+room.extraBeds+'</td><td>'+room.usedExtraBedsCount+'</td><td>'+room.adultsCount+'</td><td>'+room.childrenCount+'</td><td>'+room.occupancyCount+'</td>'+renderAccommodationRoomExpense(roomExpenses[index])+'<td>'+renderAirConditioningRoomExpense(airRoomExpenses[index])+'</td><td><button class="btn btn-gray" onclick="openAccommodationRoomSettings(\''+jsHouse+'\',\''+jsRoom+'\')">تخصيص الإقامة</button><button class="btn btn-blue" onclick="openAirConditioningRoomSettings(\''+jsHouse+'\',\''+jsRoom+'\')" style="margin-top:4px">تخصيص التكييف</button></td></tr>';
  });
  html+='</tbody></table></div>';
  return html;
}

function renderAccommodationHouseExpense(houseExpense){
  if(!houseExpense)return '';
  return '<div class="settings-summary-grid" style="margin:10px 0">'+
    '<div class="settings-summary-card"><span>الغرف الداخلة</span><strong>'+houseExpense.includedRoomsCount+'</strong></div>'+
    '<div class="settings-summary-card"><span>الغرف المستبعدة</span><strong>'+houseExpense.excludedRoomsCount+'</strong></div>'+
    '<div class="settings-summary-card"><span>إجمالي الإقامة</span><strong>'+formatAccountMoney(houseExpense.finalTotal)+'</strong></div>'+
    '</div><div class="settings-empty-state" style="white-space:pre-line">'+esc(houseExpense.formula)+'</div>';
}

function renderAirConditioningHouseExpense(houseExpense){
  if(!houseExpense)return '';
  return '<div class="settings-summary-grid" style="margin:10px 0">'+
    '<div class="settings-summary-card"><span>غرف التكييف الداخلة</span><strong>'+houseExpense.includedRoomsCount+'</strong></div>'+
    '<div class="settings-summary-card"><span>غرف التكييف المستبعدة</span><strong>'+houseExpense.excludedRoomsCount+'</strong></div>'+
    '<div class="settings-summary-card"><span>إجمالي التكييف</span><strong>'+formatAccountMoney(houseExpense.finalTotal)+'</strong></div>'+
    '</div><div class="settings-empty-state" style="white-space:pre-line">'+esc(houseExpense.formula)+'</div>';
}

function renderAccountsHouseCard(houseContext,houseExpense,airConditioningHouseExpense){
  var accommodationTotal=houseExpense?houseExpense.finalTotal:0;
  var airTotal=airConditioningHouseExpense?airConditioningHouseExpense.finalTotal:0;
  var html='<section class="settings-section settings-branding-section settings-ui-accordion" style="margin-top:8px">';
  html+='<button type="button" class="settings-branding-toggle" aria-expanded="false" onclick="var content=this.nextElementSibling;var isOpen=content.classList.toggle(\'settings-branding-content-open\');content.setAttribute(\'aria-hidden\',isOpen?\'false\':\'true\');this.setAttribute(\'aria-expanded\',isOpen?\'true\':\'false\');this.querySelector(\'.settings-branding-toggle-arrow\').textContent=isOpen?\'▲\':\'▼\'"><span>🏠 '+esc(houseContext.name)+' — الإقامة '+formatAccountMoney(accommodationTotal)+' — التكييف '+formatAccountMoney(airTotal)+' — المجموع '+formatAccountMoney(accommodationTotal+airTotal)+'</span><span class="settings-branding-toggle-arrow" aria-hidden="true">▼</span></button>';
  html+='<div class="settings-branding-content settings-ui-accordion-content" aria-hidden="true">';
  html+='<div class="settings-summary-grid">';
  html+='<div class="settings-summary-card"><span>الأدوار</span><strong>'+houseContext.floorsCount+'</strong></div>';
  html+='<div class="settings-summary-card"><span>الغرف</span><strong>'+houseContext.roomsCount+'</strong></div>';
  html+='<div class="settings-summary-card"><span>المضافة للتسكين</span><strong>'+houseContext.displayedRoomsCount+'</strong></div>';
  html+='<div class="settings-summary-card"><span>المشغولة</span><strong>'+houseContext.occupiedRoomsCount+'</strong></div>';
  html+='<div class="settings-summary-card"><span>المغلقة</span><strong>'+houseContext.closedRoomsCount+'</strong></div>';
  html+='<div class="settings-summary-card"><span>الأسرة الأساسية</span><strong>'+houseContext.baseBedsCount+'</strong></div>';
  html+='<div class="settings-summary-card"><span>الأسرة الإضافية</span><strong>'+houseContext.extraBedsCount+'</strong></div>';
  html+='</div>';
  html+=renderAccommodationHouseExpense(houseExpense);
  html+=renderAirConditioningHouseExpense(airConditioningHouseExpense);
  html+=renderAccommodationHouseSettings(houseContext);
  html+=renderAirConditioningHouseSettings(houseContext);
  html+=renderAccountsRoomsTable(houseContext,houseExpense,airConditioningHouseExpense);
  html+='</div></section>';
  return html;
}

function renderAccountsHouses(context,accommodationExpense,airConditioningExpense){
  if(!context.houses.length)return '<div class="settings-empty-state">لا توجد بيوت مرتبطة بالمؤتمر الحالي.</div>';
  var html='';
  context.houses.forEach(function(house,index){
    html+=renderAccountsHouseCard(
      house,
      accommodationExpense&&accommodationExpense.houses[index],
      airConditioningExpense&&airConditioningExpense.houses[index]
    );
  });
  return html;
}

function renderMealsExpenseSummary(expense){
  return '<div class="settings-summary-grid">'+
    '<div class="settings-summary-card"><span>🍽️ إجمالي الوجبات</span><strong>'+formatAccountMoney(expense.finalTotal)+'</strong></div>'+
    '<div class="settings-summary-card"><span>الأيام المحتسبة</span><strong>'+expense.enabledDaysCount+'</strong></div>'+
    '<div class="settings-summary-card"><span>وضع الحساب</span><strong>'+(expense.calculationMode==='restaurant_prices'?'أسعار المطعم':expense.calculationMode==='accounts_prices'?'أسعار الحسابات':'يدوي')+'</strong></div>'+
    '</div>';
}

function renderMealExpenseDetails(meal){
  var html='<div style="margin:6px 0;padding:8px;border:1px solid #e5e7eb;border-radius:8px">';
  html+='<b>'+getAccountMealLabel(meal.mealKey)+'</b> — '+(meal.enabled?'مفعّلة':'غير مفعّلة');
  html+='<div>البالغون: '+meal.adults+' — المصدر: '+getMealsSettingSourceLabel(meal.sources.adults)+'</div>';
  html+='<div>الأطفال: '+meal.children+' — المصدر: '+getMealsSettingSourceLabel(meal.sources.children)+'</div>';
  html+='<div>سعر البالغ: '+formatAccountMoney(meal.adultPrice)+' — المصدر: '+getMealsSettingSourceLabel(meal.sources.adultPrice)+'</div>';
  html+='<div>سعر الطفل: '+formatAccountMoney(meal.childPrice)+' — المصدر: '+getMealsSettingSourceLabel(meal.sources.childPrice)+'</div>';
  html+='<div style="white-space:pre-line">'+esc(meal.formula)+'</div></div>';
  return html;
}

function renderMealsExpenseTable(expense){
  if(!expense.days.length)return '<div class="settings-empty-state">لا توجد أيام مؤتمر متاحة لحساب الوجبات.</div>';
  var html='<div style="overflow-x:auto"><table><thead><tr><th>اليوم</th><th>البالغون</th><th>الأطفال</th><th>الإفطار</th><th>الغداء</th><th>العشاء</th><th>الإجمالي المحسوب</th><th>الإجمالي النهائي</th><th>التفاصيل</th></tr></thead><tbody>';
  expense.days.forEach(function(day){
    html+='<tr><td><b>اليوم '+day.day+'</b></td><td>'+day.adults+'</td><td>'+day.children+'</td>';
    ['breakfast','lunch','dinner'].forEach(function(key){
      html+='<td>'+formatAccountMoney(day.meals[key].finalTotal)+'</td>';
    });
    html+='<td>'+formatAccountMoney(day.calculatedTotal)+'</td><td><b>'+formatAccountMoney(day.finalTotal)+'</b></td>';
    html+='<td><details><summary>تفاصيل اليوم</summary><div style="min-width:300px;padding:8px">';
    html+='<div>مصدر عدد البالغين: '+getMealsSettingSourceLabel(day.sources.adults)+'</div>';
    html+='<div>مصدر عدد الأطفال: '+getMealsSettingSourceLabel(day.sources.children)+'</div>';
    html+=renderMealExpenseDetails(day.meals.breakfast);
    html+=renderMealExpenseDetails(day.meals.lunch);
    html+=renderMealExpenseDetails(day.meals.dinner);
    html+='<div style="white-space:pre-line"><b>'+esc(day.formula)+'</b></div></div></details></td></tr>';
  });
  html+='</tbody></table></div>';
  return html;
}

function renderMealsDaySettings(dayExpense){
  var day=dayExpense.day;
  var stored=getMealsDaySettings(day,false)||{};
  var html='<section class="settings-section settings-branding-section settings-ui-accordion" style="margin-top:8px">';
  html+='<button type="button" class="settings-branding-toggle" aria-expanded="false" onclick="var content=this.nextElementSibling;var isOpen=content.classList.toggle(\'settings-branding-content-open\');content.setAttribute(\'aria-hidden\',isOpen?\'false\':\'true\');this.setAttribute(\'aria-expanded\',isOpen?\'true\':\'false\');this.querySelector(\'.settings-branding-toggle-arrow\').textContent=isOpen?\'▲\':\'▼\'"><span>اليوم '+day+' — '+dayExpense.adults+' بالغ — '+dayExpense.children+' طفل — '+formatAccountMoney(dayExpense.finalTotal)+'</span><span class="settings-branding-toggle-arrow">▼</span></button>';
  html+='<div class="settings-branding-content settings-ui-accordion-content" aria-hidden="true"><div class="settings-branding-grid">';
  html+='<div class="settings-branding-field"><label class="lbl" for="meals_day_enabled_'+day+'">تفعيل اليوم</label><select id="meals_day_enabled_'+day+'"><option value="auto" '+(stored.enabled!==true&&stored.enabled!==false?'selected':'')+'>استخدام الإعداد العام</option><option value="true" '+(stored.enabled===true?'selected':'')+'>مفعّل</option><option value="false" '+(stored.enabled===false?'selected':'')+'>معطّل</option></select></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="meals_day_adults_'+day+'">عدد بالغين مخصص</label><input id="meals_day_adults_'+day+'" type="number" min="0" step="1" value="'+(stored.adults===null||stored.adults===undefined?'':stored.adults)+'" placeholder="من المطعم/الأشخاص"></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="meals_day_children_'+day+'">عدد أطفال مخصص</label><input id="meals_day_children_'+day+'" type="number" min="0" step="1" value="'+(stored.children===null||stored.children===undefined?'':stored.children)+'" placeholder="من المطعم/الأشخاص"></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="meals_day_manual_'+day+'">إجمالي يدوي لليوم</label><input id="meals_day_manual_'+day+'" type="number" min="0" step="0.01" value="'+(stored.manualTotal===null||stored.manualTotal===undefined?'':stored.manualTotal)+'" placeholder="غير محدد"></div>';
  html+='<div class="settings-branding-field"><label class="lbl" for="meals_day_notes_'+day+'">ملاحظات</label><textarea id="meals_day_notes_'+day+'" rows="3">'+esc(stored.notes||'')+'</textarea></div>';
  ['breakfast','lunch','dinner'].forEach(function(mealKey){
    var mealStored=stored.meals&&stored.meals[mealKey]||{};
    var mealExpense=dayExpense.meals[mealKey];
    html+='<div class="settings-section" style="margin:4px"><div class="settings-section-title">'+getAccountMealLabel(mealKey)+'</div>';
    html+='<label class="lbl" for="meals_day_'+mealKey+'_enabled_'+day+'">تفعيل الوجبة</label><select id="meals_day_'+mealKey+'_enabled_'+day+'"><option value="auto" '+(mealStored.enabled!==true&&mealStored.enabled!==false?'selected':'')+'>استخدام الإعداد العام</option><option value="true" '+(mealStored.enabled===true?'selected':'')+'>مفعّلة</option><option value="false" '+(mealStored.enabled===false?'selected':'')+'>معطّلة</option></select>';
    html+='<label class="lbl" for="meals_day_'+mealKey+'_adult_'+day+'">سعر البالغ</label><input id="meals_day_'+mealKey+'_adult_'+day+'" type="number" min="0" step="0.01" value="'+(mealStored.adultPrice===null||mealStored.adultPrice===undefined?'':mealStored.adultPrice)+'" placeholder="موروث">';
    html+='<label class="lbl" for="meals_day_'+mealKey+'_child_'+day+'">سعر الطفل</label><input id="meals_day_'+mealKey+'_child_'+day+'" type="number" min="0" step="0.01" value="'+(mealStored.childPrice===null||mealStored.childPrice===undefined?'':mealStored.childPrice)+'" placeholder="موروث">';
    html+='<label class="lbl" for="meals_day_'+mealKey+'_manual_'+day+'">إجمالي يدوي للوجبة</label><input id="meals_day_'+mealKey+'_manual_'+day+'" type="number" min="0" step="0.01" value="'+(mealStored.manualTotal===null||mealStored.manualTotal===undefined?'':mealStored.manualTotal)+'" placeholder="غير محدد">';
    html+='<div class="settings-branding-file-name">سعر البالغ النهائي: '+formatAccountMoney(mealExpense.adultPrice)+' — '+getMealsSettingSourceLabel(mealExpense.sources.adultPrice)+'<br>سعر الطفل النهائي: '+formatAccountMoney(mealExpense.childPrice)+' — '+getMealsSettingSourceLabel(mealExpense.sources.childPrice)+'<br>الإجمالي: '+formatAccountMoney(mealExpense.finalTotal)+'</div></div>';
  });
  html+='</div><div class="settings-branding-actions"><button class="btn btn-green" onclick="saveMealsDaySettings('+day+')">💾 حفظ تخصيص اليوم</button><button class="btn btn-red" onclick="clearMealsDaySettings('+day+')">إلغاء تخصيص اليوم</button></div></div></section>';
  return html;
}

function isMealsDaySettingsEmpty(settings){
  if(!settings)return true;
  var meals=settings.meals&&typeof settings.meals==='object'?settings.meals:{};
  var mealsEmpty=['breakfast','lunch','dinner'].every(function(key){
    var meal=meals[key]||{};
    return meal.enabled!==true&&meal.enabled!==false&&
      (meal.adultPrice===null||meal.adultPrice===undefined)&&
      (meal.childPrice===null||meal.childPrice===undefined)&&
      (meal.manualTotal===null||meal.manualTotal===undefined);
  });
  return settings.enabled!==true&&settings.enabled!==false&&
    (settings.adults===null||settings.adults===undefined)&&
    (settings.children===null||settings.children===undefined)&&
    (settings.manualTotal===null||settings.manualTotal===undefined)&&
    !String(settings.notes||'').trim()&&mealsEmpty;
}

function saveMealsDaySettings(day){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveMealsDaySettings',null))return false;
  var conference=getCurrentConference();
  if(!conference)return;
  var adults=readNullableAccountInteger('meals_day_adults_'+day,'عدد البالغين');
  var children=readNullableAccountInteger('meals_day_children_'+day,'عدد الأطفال');
  var manual=readNullableAccountNumber('meals_day_manual_'+day,'الإجمالي اليدوي لليوم');
  var mealValues={};
  var ok=adults.ok&&children.ok&&manual.ok;
  ['breakfast','lunch','dinner'].forEach(function(key){
    mealValues[key]={
      adult:readNullableAccountNumber('meals_day_'+key+'_adult_'+day,'سعر البالغ'),
      child:readNullableAccountNumber('meals_day_'+key+'_child_'+day,'سعر الطفل'),
      manual:readNullableAccountNumber('meals_day_'+key+'_manual_'+day,'الإجمالي اليدوي للوجبة')
    };
    if(!mealValues[key].adult.ok||!mealValues[key].child.ok||!mealValues[key].manual.ok)ok=false;
  });
  if(!ok)return;
  var settings=getMealsDaySettings(day,true);
  var enabled=ge('meals_day_enabled_'+day).value;
  settings.enabled=enabled==='true'?true:(enabled==='false'?false:null);
  settings.adults=adults.value;
  settings.children=children.value;
  settings.manualTotal=manual.value;
  settings.notes=ge('meals_day_notes_'+day).value.trim();
  ['breakfast','lunch','dinner'].forEach(function(key){
    var meal=getMealsDayMealSettings(day,key,true);
    var mealEnabled=ge('meals_day_'+key+'_enabled_'+day).value;
    meal.enabled=mealEnabled==='true'?true:(mealEnabled==='false'?false:null);
    meal.adultPrice=mealValues[key].adult.value;
    meal.childPrice=mealValues[key].child.value;
    meal.manualTotal=mealValues[key].manual.value;
  });
  if(isMealsDaySettingsEmpty(settings))delete getMealsAccounts().dayOverrides[String(day)];
  conference.accounts.updatedAt=new Date().toISOString();
  if(save()===false){showToast('تعذر حفظ تخصيص يوم الوجبات.','#E74C3C');return}
  renderAccounts();
  showToast('✅ تم حفظ تخصيص يوم الوجبات');
}

function clearMealsDaySettings(day){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('clearMealsDaySettings',null))return false;
  if(!confirm('هل تريد إلغاء تخصيص وجبات هذا اليوم؟ لن تتغير بيانات المطعم أو الأشخاص.'))return;
  var conference=getCurrentConference();
  var meals=getMealsAccounts();
  if(!conference||!meals||!Object.prototype.hasOwnProperty.call(meals.dayOverrides,String(day))){
    showToast('لا يوجد تخصيص محفوظ لهذا اليوم.','#E67E22');
    return;
  }
  delete meals.dayOverrides[String(day)];
  conference.accounts.updatedAt=new Date().toISOString();
  if(save()===false){showToast('تعذر إلغاء تخصيص يوم الوجبات.','#E74C3C');return}
  renderAccounts();
  showToast('✅ تم إلغاء تخصيص يوم الوجبات');
}

function renderMealsSection(expense){
  var html=renderMealsAccountsSettings();
  html+=renderMealsExpenseSummary(expense);
  html+=renderMealsExpenseTable(expense);
  expense.days.forEach(function(day){html+=renderMealsDaySettings(day)});
  return html;
}

function renderAccountsRestaurant(restaurantContext){
  if(!restaurantContext||!restaurantContext.available)return '<div class="settings-empty-state">لا توجد بيانات مطعم متاحة للمؤتمر الحالي.</div>';
  var html='<div class="settings-empty-state" style="margin-bottom:10px">الأسعار والأعداد مقروءة مباشرة من تبويب المطعم.</div>';
  html+='<div style="overflow-x:auto"><table><thead><tr><th>اليوم</th><th>البالغون</th><th>الأطفال</th><th>الإفطار</th><th>الغداء</th><th>العشاء</th><th>إجمالي اليوم</th></tr></thead><tbody>';
  restaurantContext.days.forEach(function(day){
    html+='<tr><td><b>اليوم '+day.day+'</b></td><td>'+day.adults+'</td><td>'+day.children+'</td>';
    ['breakfast','lunch','dinner'].forEach(function(mealKey){
      var meal=day.meals[mealKey];
      html+='<td>'+(meal.enabled?formatAccountMoney(meal.total):'غير مفعلة')+'</td>';
    });
    html+='<td><b>'+formatAccountMoney(day.total)+'</b></td></tr>';
  });
  html+='</tbody></table></div>';
  html+='<div class="settings-summary-card" style="margin-top:10px"><span>إجمالي المطعم الحالي</span><strong>'+formatAccountMoney(restaurantContext.grandTotal)+'</strong></div>';
  return html;
}

function renderConferenceFinancialSummary(summary){
  var expenses=summary.expenses;
  var income=summary.incomeSummary;
  var balance=summary.balance;
  var statusLabel=balance.status==='surplus'?'فائض':(balance.status==='deficit'?'عجز':'تعادل');
  var html='<div class="settings-summary-grid">';
  [
    ['🏨','إجمالي الإقامة',expenses.accommodationTotal],
    ['❄️','إجمالي التكييف',expenses.airConditioningTotal],
    ['🍽️','إجمالي الوجبات',expenses.mealsTotal],
    ['🧾','إجمالي المصروفات الإضافية',expenses.additionalExpensesTotal],
    ['📊','المصروفات قبل التسويات',expenses.beforeSettlement],
    ['➕','إضافات المصروفات',expenses.settlementAdditions],
    ['➖','خصومات المصروفات',expenses.settlementDeductions],
    ['💸','المصروفات النهائية',expenses.finalTotal],
    ['💰','الإيرادات قبل التسويات',income.beforeSettlement],
    ['➕','إضافات الإيرادات',income.settlementAdditions],
    ['➖','خصومات الإيرادات',income.settlementDeductions],
    ['💵','الإيرادات النهائية',income.finalTotal],
    ['⚖️',statusLabel+' — الرصيد النهائي',balance.net]
  ].forEach(function(item){
    html+='<div class="settings-summary-card"><span>'+item[0]+' '+item[1]+'</span><strong>'+formatSettlementSignedAmount(item[2])+'</strong></div>';
  });
  html+='</div>';
  if(summary.warnings.length){
    html+='<div class="settings-empty-state" style="margin-top:10px">';
    summary.warnings.forEach(function(warning){
      html+='<div>⚠️ '+warning.message+'</div>';
    });
    html+='</div>';
  }
  return html;
}

var financialV3Draft=null;
var financialV3DraftConferenceId='';
var v3AccordionOpenSection='';

function toggleV3AccordionSection(sectionKey){
  v3AccordionOpenSection=v3AccordionOpenSection===sectionKey?'':sectionKey;
  renderAccounts();
}

function renderV3AccordionSection(sectionKey,title,content){
  var isOpen=v3AccordionOpenSection===sectionKey;
  var html='<section class="settings-section settings-branding-section settings-ui-accordion">';
  html+='<button type="button" class="settings-branding-toggle" aria-expanded="'+(isOpen?'true':'false')+'" onclick="toggleV3AccordionSection(\''+sectionKey+'\')"><span>'+title+'</span><span class="settings-branding-toggle-arrow" aria-hidden="true">'+(isOpen?'▲':'▼')+'</span></button>';
  html+='<div class="settings-branding-content settings-ui-accordion-content" aria-hidden="'+(isOpen?'false':'true')+'">'+content+'</div>';
  html+='</section>';
  return html;
}

function getFinancialV3TypeLabel(value){
  return value==='deduction'?'خصم':'إضافة';
}

function getFinancialV3CategoryLabel(value){
  var labels={
    accommodation:'إقامة',
    restaurant:'مطعم',
    air_conditioning:'تكييف',
    other:'أخرى'
  };
  return labels[value]||labels.other;
}

function getDefaultFinancialV3Draft(){
  return {
    editingId:'',
    type:'addition',
    category:'other',
    amount:'',
    note:''
  };
}

function resetFinancialV3DraftFromSaved(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  if(conference&&typeof normalizeFinancialV3==='function')conference.financialV3=normalizeFinancialV3(conference.financialV3);
  financialV3Draft=getDefaultFinancialV3Draft();
  financialV3DraftConferenceId=conference&&conference.id||'';
  return financialV3Draft;
}

function getFinancialV3Draft(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  var conferenceId=conference&&conference.id||'';
  if(!financialV3Draft||financialV3DraftConferenceId!==conferenceId)return resetFinancialV3DraftFromSaved();
  return financialV3Draft;
}

function updateFinancialV3Draft(field,value){
  var draft=getFinancialV3Draft();
  if(field==='editingId')draft.editingId=String(value||'');
  else if(field==='type')draft.type=value==='deduction'?'deduction':'addition';
  else if(field==='category')draft.category=value==='accommodation'||value==='restaurant'||value==='air_conditioning'||value==='other'?value:'other';
  else if(field==='amount')draft.amount=String(value||'');
  else if(field==='note')draft.note=String(value||'');
}

function startEditingFinancialV3Adjustment(adjustmentId){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  if(!conference)return;
  var summary=typeof calculateFinancialV3Summary==='function'?calculateFinancialV3Summary(conference):null;
  var adjustment=null;
  (summary&&summary.adjustments||[]).forEach(function(item){
    if(item.id===adjustmentId)adjustment=item;
  });
  if(!adjustment)return;
  financialV3Draft={
    editingId:adjustment.id,
    type:adjustment.type==='deduction'?'deduction':'addition',
    category:adjustment.category==='accommodation'||adjustment.category==='restaurant'||adjustment.category==='air_conditioning'||adjustment.category==='other'
      ?adjustment.category
      :'other',
    amount:String(adjustment.amount===undefined||adjustment.amount===null?'':adjustment.amount),
    note:adjustment.note||''
  };
  financialV3DraftConferenceId=conference.id||'';
  renderAccounts();
}

function saveFinancialV3Adjustment(){
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  if(!conference)return;
  if(typeof normalizeFinancialV3==='function')conference.financialV3=normalizeFinancialV3(conference.financialV3);
  conference.financialV3=conference.financialV3||{enabled:true,adjustments:[],invoiceComparison:{enabled:false,accommodation:null,restaurant:null,airConditioning:null,other:null,total:null,note:''}};
  var draft=getFinancialV3Draft();
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('saveFinancialV3Adjustment',draft.editingId?'update':'create'))return false;
  var amount=Number(draft.amount);
  if(!isFinite(amount)||amount<0){
    showToast('يرجى إدخال مبلغ صحيح.','#E74C3C');
    return;
  }
  if(amount===0){
    showToast('لا يمكن حفظ تعديل بقيمة صفر.','#E74C3C');
    return;
  }
  var normalized={
    id:draft.editingId||uid(),
    type:draft.type==='deduction'?'deduction':'addition',
    category:draft.category==='accommodation'||draft.category==='restaurant'||draft.category==='air_conditioning'||draft.category==='other'?draft.category:'other',
    amount:amount,
    note:String(draft.note||'').trim()
  };
  var adjustments=Array.isArray(conference.financialV3.adjustments)?conference.financialV3.adjustments.slice():[];
  var replaced=false;
  for(var index=0;index<adjustments.length;index++){
    if(adjustments[index]&&adjustments[index].id===normalized.id){
      adjustments[index]=normalized;
      replaced=true;
      break;
    }
  }
  if(!replaced)adjustments.push(normalized);
  conference.financialV3.adjustments=adjustments;
  if(save()===false){
    showToast('تعذر حفظ التعديل المالي.','#E74C3C');
    return;
  }
  resetFinancialV3DraftFromSaved();
  renderAccounts();
  showToast('تم حفظ التعديل المالي.');
}

function deleteFinancialV3Adjustment(adjustmentId){
  if(window.ConferencePermissionShadowGate&&!window.ConferencePermissionShadowGate('deleteFinancialV3Adjustment',null))return false;
  if(!confirm('هل تريد حذف هذا التعديل المالي؟'))return;
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  if(!conference)return;
  if(typeof normalizeFinancialV3==='function')conference.financialV3=normalizeFinancialV3(conference.financialV3);
  conference.financialV3=conference.financialV3||{enabled:true,adjustments:[],invoiceComparison:{enabled:false,accommodation:null,restaurant:null,airConditioning:null,other:null,total:null,note:''}};
  conference.financialV3.adjustments=(conference.financialV3.adjustments||[]).filter(function(adjustment){return adjustment.id!==adjustmentId});
  if(financialV3Draft&&financialV3Draft.editingId===adjustmentId){
    resetFinancialV3DraftFromSaved();
  }
  if(save()===false){
    showToast('تعذر حذف التعديل المالي.','#E74C3C');
    return;
  }
  renderAccounts();
  showToast('تم حذف التعديل المالي.');
}

function renderFinancialV3AdjustmentEditor(summary){
  var draft=getFinancialV3Draft();
  var editing=!!draft.editingId;
  var saveIcon=window.AppIcons&&typeof window.AppIcons.icon==='function'?window.AppIcons.icon('checkCircle','',''):'';
  var html='<div class="settings-section" style="margin-top:10px">';
  html+='<div class="settings-section-title"><b>'+(editing?'تعديل مالي':'إضافة تعديل مالي')+'</b></div>';
  html+='<div class="settings-branding-grid">';
  html+='<div class="settings-branding-field"><label class="lbl">نوع التعديل</label><select onchange="updateFinancialV3Draft(\'type\',this.value)">';
  html+='<option value="addition" '+(draft.type==='addition'?'selected':'')+'>إضافة</option>';
  html+='<option value="deduction" '+(draft.type==='deduction'?'selected':'')+'>خصم</option>';
  html+='</select></div>';
  html+='<div class="settings-branding-field"><label class="lbl">التصنيف</label><select onchange="updateFinancialV3Draft(\'category\',this.value)">';
  ['accommodation','restaurant','air_conditioning','other'].forEach(function(value){
    html+='<option value="'+value+'" '+(draft.category===value?'selected':'')+'>'+getFinancialV3CategoryLabel(value)+'</option>';
  });
  html+='</select></div>';
  html+='<div class="settings-branding-field"><label class="lbl">المبلغ</label><input type="number" min="0" step="0.01" value="'+esc(draft.amount)+'" oninput="updateFinancialV3Draft(\'amount\',this.value)"></div>';
  html+='<div class="settings-branding-field"><label class="lbl">الملاحظة</label><textarea rows="2" oninput="updateFinancialV3Draft(\'note\',this.value)">'+esc(draft.note)+'</textarea></div>';
  html+='</div>';
  html+='<div class="settings-branding-actions">';
  html+='<button class="btn btn-green" onclick="saveFinancialV3Adjustment()">'+saveIcon+' حفظ</button>';
  if(editing)html+='<button class="btn btn-gray" onclick="resetFinancialV3DraftFromSaved();renderAccounts()">إلغاء التعديل</button>';
  html+='</div>';
  if(summary&&summary.enabled===false){
    html+='<div class="settings-empty-state" style="margin-top:10px">الملخص المالي معطل حاليًا، لكن التعديلات محفوظة وسيبقى الإجمالي النهائي صفرًا.</div>';
  }
  return html;
}

function renderFinancialV3AdjustmentsList(summary){
  var adjustments=summary&&Array.isArray(summary.adjustments)?summary.adjustments:[];
  var html='';
  if(!adjustments.length){
    html+='<div class="settings-empty-state" style="margin-top:10px">لا توجد تعديلات مالية محفوظة.</div>';
    return html;
  }
  html+='<div style="overflow-x:auto;margin-top:10px"><table><thead><tr><th>النوع</th><th>التصنيف</th><th>المبلغ</th><th>الملاحظة</th><th>الإجراءات</th></tr></thead><tbody>';
  adjustments.forEach(function(adjustment){
    html+='<tr>';
    html+='<td>'+esc(getFinancialV3TypeLabel(adjustment.type))+'</td>';
    html+='<td>'+esc(getFinancialV3CategoryLabel(adjustment.category))+'</td>';
    html+='<td>'+formatAccountMoney(adjustment.amount)+'</td>';
    html+='<td>'+esc(adjustment.note||'')+'</td>';
    html+='<td><div class="settings-branding-actions" style="justify-content:flex-start"><button class="btn btn-blue" onclick="startEditingFinancialV3Adjustment(\''+esc(adjustment.id).replace(/'/g,"\\'")+'\')">تعديل</button><button class="btn btn-red" onclick="deleteFinancialV3Adjustment(\''+esc(adjustment.id).replace(/'/g,"\\'")+'\')">حذف</button></div></td>';
    html+='</tr>';
  });
  html+='</tbody></table></div>';
  return html;
}

function renderAccountsV3PrimarySummary(summary){
  var cards=[
    {label:'الإجمالي النهائي',value:summary.grandTotal,tone:'primary',icon:'money'},
    {label:'إجمالي الإقامة',value:summary.accommodationTotal,tone:'accommodation',icon:'bed'},
    {label:'إجمالي المطعم',value:summary.restaurantTotal,tone:'restaurant',icon:'food'},
    {label:'إجمالي التكييف',value:summary.airConditioningTotal,tone:'air',icon:'settings'}
  ];
  var html='<section class="accounts-summary-section" aria-label="الملخص المالي الأساسي"><div class="accounts-primary-summary">';
  cards.forEach(function(card){
    var icon=window.AppIcons&&typeof window.AppIcons.icon==='function'?window.AppIcons.icon(card.icon,'',''):'';
    html+='<article class="accounts-primary-stat accounts-primary-stat-'+card.tone+'">';
    html+='<span class="accounts-primary-stat-icon">'+icon+'</span><div><span>'+card.label+'</span><strong>'+formatAccountMoney(card.value)+'</strong></div>';
    html+='</article>';
  });
  html+='</div></section>';
  return html;
}

function renderAccountsV3SecondarySummary(summary){
  return '<div class="accounts-secondary-summary" aria-label="الملخص المالي الثانوي">'+
    '<div class="accounts-secondary-item accounts-secondary-before"><span>المجموع قبل التعديلات</span><strong>'+formatAccountMoney(summary.subtotal)+'</strong></div>'+
    '<div class="accounts-secondary-item accounts-secondary-addition"><span>الإضافات</span><strong>'+formatAccountMoney(summary.additionsTotal)+'</strong></div>'+
    '<div class="accounts-secondary-item accounts-secondary-deduction"><span>الخصومات</span><strong>'+formatAccountMoney(summary.deductionsTotal)+'</strong></div>'+
    '</div>';
}

function renderFinancialV3Section(summary){
  summary=summary||calculateFinancialV3Summary();
  var html='';
  html+=renderFinancialV3AdjustmentEditor(summary);
  html+=renderFinancialV3AdjustmentsList(summary);
  return html;
}

function renderAccounts(){
  var container=typeof ge==='function'?ge('tab2'):document.getElementById('tab2');
  if(!container)return;
  var conference=typeof getCurrentConference==='function'?getCurrentConference():null;
  if(!conference){
    container.innerHTML='<div class="settings-dashboard"><div class="settings-empty-state">لا توجد بيانات مؤتمر جاهزة حاليًا.</div></div>';
    return;
  }
  normalizeConferenceAccounts(conference);
  var financialV3Summary=calculateFinancialV3Summary();
  var sections=[
    {key:'accommodation',title:'الإقامة',subtitle:'طريقة التسعير والإعدادات والنتيجة الحالية',icon:'bed',content:renderAccommodationV3Settings(conference)},
    {key:'restaurant',title:'المطعم',subtitle:'التسعير والاستثناءات وجدول الوجبات التفصيلي',icon:'food',content:renderRestaurantV3Settings(conference)},
    {key:'air-conditioning',title:'التكييف',subtitle:'طريقة الحساب والأسعار والمدة والنتيجة الحالية',icon:'settings',content:renderAirConditioningV3Settings(conference)}
  ];
  var html='<div class="settings-dashboard settings-accounts-dashboard">';
  html+='<div class="accounts-dashboard-heading"><div><span>Accounts Dashboard</span><h2>الحسابات</h2></div></div>';
  html+=renderAccountsV3PrimarySummary(financialV3Summary);
  html+=renderAccountsV3SecondarySummary(financialV3Summary);
  html+='<div class="accounts-workspace-heading"><span>Cost Engines Workspace</span><strong>محركات التكلفة</strong></div>';
  html+='<div class="accounts-cost-workspace">';
  sections.forEach(function(section){
    var icon=window.AppIcons&&typeof window.AppIcons.icon==='function'?window.AppIcons.icon(section.icon,'',''):'';
    html+='<section class="settings-section settings-accounts-panel accounts-engine-panel accounts-engine-'+section.key+'">';
    html+='<div class="settings-section-title settings-accounts-panel-title"><span class="accounts-panel-icon">'+icon+'</span><div><strong>'+section.title+'</strong><small>'+section.subtitle+'</small></div></div>';
    html+='<div class="settings-accounts-panel-body">'+section.content+'</div>';
    html+='</section>';
  });
  html+='</div>';
  html+='<section class="settings-section settings-accounts-panel accounts-adjustments-panel">';
  html+='<div class="settings-section-title settings-accounts-panel-title"><span class="accounts-panel-icon">'+(window.AppIcons&&typeof window.AppIcons.icon==='function'?window.AppIcons.icon('money','',''):'')+'</span><div><strong>التعديلات المالية</strong><small>الإضافات والخصومات والتصنيفات والملاحظات</small></div></div>';
  html+='<div class="settings-accounts-panel-body">'+renderFinancialV3Section(financialV3Summary)+'</div></section>';
  html+='</div>';
  container.innerHTML=html;
}
