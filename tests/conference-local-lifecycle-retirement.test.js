'use strict';

var assert=require('assert');
var fs=require('fs');

var state=fs.readFileSync('state.js','utf8');
var index=fs.readFileSync('index.html','utf8');
var worker=fs.readFileSync('service-worker.js','utf8');

assert.doesNotMatch(state,/conferenceLifecycle|ConferenceRepository|recordLocalChange|addLocalConference/);
assert.doesNotMatch(index,/conference-repository\.js/);
assert.doesNotMatch(worker,/conference-repository\.js/);
assert.strictEqual(fs.existsSync('js/storage/conference-repository.js'),false);
assert.match(state,/CANONICAL_CONFERENCE_MUTATION_CONTRACT_REQUIRED/);

console.log('conference local lifecycle retirement tests: passed');
