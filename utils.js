// ═══════════════════════════════════════════════════════
// GENERAL UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function uid() { return uuid(); }

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function ge(id) { return document.getElementById(id); }

function showToast(msg, c) { var t = ge('toast'); t.textContent = msg; t.style.background = c || '#27AE60'; t.style.display = 'block'; setTimeout(function() { t.style.display = 'none'; }, 2500); }

function gn(g) {
  if (typeof g === 'string') return g;
  if (g && g.personId && typeof getPersonById === 'function') {
    var person = getPersonById(g.personId);
    if (person && person.fullName) return person.fullName;
  }
  return (g && g.name) || '';
}

function gl(g, day) {
  if (typeof g === 'string') return false;
  if (!g.leftDay) return false;
  if (day === undefined) return true;
  return g.leftDay <= day;
}

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function dayOptions(days, selected) { var h = '<option value="">—</option>'; for (var i = 1; i <= days; i++)h += '<option value="' + i + '" ' + (selected == i ? 'selected' : '') + '>يوم ' + i + '</option>'; return h; }