'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');

const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'style.css'),'utf8');
const tokens=fs.readFileSync(path.join(root,'shared-design-tokens.css'),'utf8');

assert.match(css,/\.platform-module-grid\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
assert.match(css,/@media\(max-width:1100px\)[\s\S]*?\.platform-module-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
assert.match(css,/@media\(max-width:600px\)[\s\S]*?\.platform-module-grid\{grid-template-columns:1fr\}/);
assert.match(css,/@media\(max-width:420px\)[\s\S]*?\.platform-module-card\{grid-template-columns:44px minmax\(0,1fr\)/);
assert.match(css,/@media\(max-width:600px\)[\s\S]*?\.startup-date-card\{display:none\}/);
assert.match(css,/@media\(max-width:600px\)[\s\S]*?\.platform-module-switcher\{width:100%;min-height:var\(--platform-touch-target\)/);
assert.match(css,/@media\(max-width:600px\)[\s\S]*?\.startup-auth-actions button\{min-width:0;min-height:var\(--platform-touch-target\)/);
assert.match(css,/\.platform-conference-active \.platform-home\{display:none\}/);
assert.match(css,/\.platform-conference-active \.platform-module-switcher\{display:flex\}/);
assert.match(css,/\.platform-conference-active \.conference-workspace\{display:flex\}/);
assert.match(tokens,/--platform-touch-target:44px/);
assert.match(html,/<button[^>]+platform-module-card-available[^>]+onclick="openConferenceWorkspace\(\)"[^>]+aria-label="فتح وحدة إدارة المؤتمرات"/);
assert.strictEqual((html.match(/platform-module-card-unavailable/g)||[]).length,3);
assert.doesNotMatch(html,/platform-module-card-unavailable[^>]+onclick=/);
assert.match(html,/data-startup-auth-account-name/);
assert.match(html,/SyncSettingsUI\.signOut\(\)/);
assert.match(html,/class="platform-module-switcher" onclick="showPlatformModules\(\)"/);

console.log('platform shell responsive contract tests passed');
