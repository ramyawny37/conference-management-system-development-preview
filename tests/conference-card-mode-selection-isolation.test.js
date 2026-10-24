const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('switching person and room card modes clears stale selections before printing or sharing', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
  const match = source.match(/function setCardMode\(m\)\{[\s\S]*?\n\}(?=\nfunction toggleCard)/);
  assert.ok(match, 'canonical card mode handler exists');
  const state = {
    cardMode: 'person', selectedCards: { 'person:1': true }, cardsSelectionMode: true,
    CARDS_VIEW_MODE_KEY: 'cards-view-mode', renderCards() { this.rendered = true; },
    localStorage: { setItem() {} }, rendered: false
  };
  vm.createContext(state);
  vm.runInContext(match[0] + '\nsetCardMode("room")', state);
  assert.equal(state.cardMode, 'room');
  assert.deepEqual(Object.keys(state.selectedCards), []);
  assert.equal(state.cardsSelectionMode, false);
  assert.equal(state.rendered, true);
});
