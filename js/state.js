// ═══════════════════════════════════════════════════════

var appData = {
  version: '2.0.0',
  currentConferenceId: null,
  conferences: [],
  templates: [],
  archives: [],
  backups: [],
  houseTemplates: [],
  peopleDb: { version: '1.0.0', people: [] },

};

// UI and editing state
var currentTab=0,editRoomId=null,editTransId=null,editSeatTransId=null,editSeatNum=null,editHouseId=null;
var settingsTab='general';
var selectedHouseTemplateId=null;
var templateFloorDialog = { houseId: null, floorId: null };
var templateRoomDialog = { houseId: null, floorId: null, roomId: null };
var importHouseDialog = { templateId: null, selectedRooms: {} };
var conferenceDraft = null;
var conferenceDialogMode = 'create';
var cardMode='person',selectedCards={};

// Constants
var SK='conf_v5';
