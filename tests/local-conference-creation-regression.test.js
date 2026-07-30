const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const scriptSource=fs.readFileSync(path.join(
  __dirname,'..','script.js'
),'utf8');
const start=scriptSource.indexOf(
  'function createConferenceFromSelection()'
);
const end=scriptSource.indexOf(
  'function collectConferenceSelection()',start
);
assert.ok(start>=0&&end>start);
const creationSource=scriptSource.slice(start,end);

function repository(){
  const sandbox={
    console,JSON,Object,Array,String,Number,Date,
    structuredClone:value=>structuredClone(value)
  };
  sandbox.window=sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(
    __dirname,'..','js','storage','conference-repository.js'
  ),'utf8'),sandbox,{filename:'conference-repository.js'});
  return sandbox.ConferenceRepository;
}

function formEnvironment(overrides={}){
  const fields={
    cfg_name:{value:'مؤتمر الاختبار الكامل'},
    cfg_start:{value:'2026-08-10'},
    cfg_end:{value:'2026-08-12'},
    cfg_days:{value:'3'},
    cfg_place:{value:'القاهرة'}
  };
  const legacy={
    id:'legacy-local-conference',
    name:'مؤتمر محلي قديم',
    status:'active'
  };
  const logs=[];
  const toasts=[];
  const saved=[];
  const sandbox={
    console:{
      error(...args){logs.push(args);},
      warn(){},
      log(){}
    },
    Error,Date,JSON,Object,Array,String,Number,Math,RegExp,
    parseInt,
    appData:{
      version:'2.0.0',
      currentConferenceId:null,
      conferences:[legacy],
      templates:[],archives:[],backups:[],
      houseTemplates:[],
      peopleDb:{version:'1.0.0',people:[]}
    },
    conferenceDialogMode:'create',
    window:null,
    ge(id){return fields[id]||null;},
    calculateConferencePeriod(startDate,endDate){
      assert.strictEqual(startDate,'2026-08-10');
      assert.strictEqual(endDate,'2026-08-12');
      return {valid:true,days:3,nights:2};
    },
    buildConferenceSchedule(){
      return [
        {dayNumber:1,date:'2026-08-10'},
        {dayNumber:2,date:'2026-08-11'},
        {dayNumber:3,date:'2026-08-12'}
      ];
    },
    uid(){return 'new-local-conference';},
    createDefaultRestaurant(){return {meals:[]};},
    createDefaultRestaurantV3(){return {days:[]};},
    normalizeConference(value){
      value.conf=value.conf||{};
      value.houses=value.houses||[];
    },
    setCurrentConferenceById(id){
      assert.strictEqual(id,'new-local-conference');
      sandbox.appData.currentConferenceId=id;
      const tracked=sandbox.ConferenceRepository.recordLocalChange(
        sandbox.appData,id
      );
      assert.strictEqual(tracked.ok,true);
      sandbox.appData=tracked.data;
      saved.push(structuredClone(sandbox.appData));
    },
    addActivityLog(){},
    closeNewConferenceModal(){},
    showToast(message){toasts.push(message);}
  };
  sandbox.window=sandbox;
  sandbox.ConferenceRepository=repository();
  Object.assign(sandbox,overrides);
  sandbox.window=sandbox;
  vm.runInNewContext(creationSource,sandbox,{
    filename:'createConferenceFromSelection.js'
  });
  return {sandbox,fields,logs,toasts,saved};
}

(function(){
  const repositorySource=fs.readFileSync(path.join(
    __dirname,'..','js','storage','conference-repository.js'
  ),'utf8');
  const addStart=repositorySource.indexOf(
    'function addLocalConference('
  );
  const addEnd=repositorySource.indexOf(
    'function getContract()',addStart
  );
  assert.doesNotMatch(
    repositorySource.slice(addStart,addEnd),
    /recordLocalChange\s*\(/
  );

  const env=formEnvironment();
  env.sandbox.createConferenceFromSelection();

  assert.strictEqual(env.logs.length,0);
  assert.strictEqual(env.saved.length,1);
  const snapshot=env.saved[0];
  assert.doesNotThrow(()=>structuredClone(snapshot));
  assert.doesNotThrow(()=>JSON.stringify(snapshot));
  const created=snapshot.conferences.find(item=>
    item.id==='new-local-conference'
  );
  assert.ok(created);
  assert.strictEqual(created.name,'مؤتمر الاختبار الكامل');
  assert.strictEqual(created.conf.place,'القاهرة');
  assert.strictEqual(created.startDate,'2026-08-10');
  assert.strictEqual(created.endDate,'2026-08-12');
  assert.strictEqual(created.days,3);
  assert.strictEqual(created.nights,2);
  assert.strictEqual(created.conf.days,3);
  assert.strictEqual(created.conf.nights,2);
  assert.ok(Array.isArray(created.schedule));
  assert.strictEqual(created.schedule.length,3);

  const lifecycle=snapshot.conferenceLifecycle.records[
    'new-local-conference'
  ];
  assert.strictEqual(lifecycle.localConferenceId,
    'new-local-conference');
  assert.strictEqual(lifecycle.localLifecycle,'active');
  assert.strictEqual(lifecycle.cloudLifecycle,'unpublished');
  assert.strictEqual(lifecycle.localContentVersion,1);
  assert.strictEqual(lifecycle.publishMetadata,null);
  assert.strictEqual(
    snapshot.conferenceLifecycle.records[
      'legacy-local-conference'
    ].cloudLifecycle,
    'local_only'
  );

  Object.keys(created).forEach(key=>{
    assert.notStrictEqual(typeof created[key],'function',key);
  });
  assert.ok(!Object.values(created).some(value=>
    value&&typeof value==='object'&&value.nodeType
  ));

  const failure=formEnvironment({
    ConferenceRepository:{
      addLocalConference(){
        return {
          ok:false,
          status:'classification_required',
          issues:[{
            code:'LIFECYCLE_CLASSIFICATION_REQUIRED',
            path:'conferenceLifecycle'
          }]
        };
      }
    }
  });
  failure.sandbox.window=failure.sandbox;
  failure.sandbox.createConferenceFromSelection();
  assert.strictEqual(failure.logs.length,0);
  assert.strictEqual(failure.saved.length,0);
  assert.ok(failure.toasts.includes(
    'تعذر إنشاء المؤتمر المحلي بأمان.'
  ));

  console.log('local conference creation regression tests: passed');
})();
