// The editor's toolbar must keep every button visible on a phone: a sideways-scrolling row once hid Check table off-screen.
// Run: node tests/pinball_editor_toolbar.js (needs the jsdom test dependency).
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');

const root = join(__dirname, '..', 'static');
const { document } = new JSDOM(readFileSync(join(root, 'pinball-editor.html'), 'utf8')).window;
const css = readFileSync(join(root, 'pinball-editor.css'), 'utf8');

const bar = document.querySelector('.pe-actions');
for (const id of ['peCheck', 'peFeature', 'peTables', 'pePlay', 'peLights']) {
  const button = document.getElementById(id);
  assert.ok(button && bar.contains(button), `${id} is in the toolbar`);
  assert.equal(button.hidden, false, `${id} is not hidden`);
  assert.ok(button.textContent.trim(), `${id} has a label`);
}
const phone = css.slice(css.indexOf('@media (max-width: 820px)'));
const rule = phone.match(/\.pe-actions \{[^}]*\}/)[0];
assert.match(rule, /flex-wrap:\s*wrap/, 'the phone toolbar wraps');
assert.doesNotMatch(rule, /overflow-x:\s*(auto|scroll)/, 'the phone toolbar does not scroll sideways');
assert.doesNotMatch(phone.match(/\.pe-actions button \{[^}]*\}/)[0], /display:\s*none/, 'no toolbar button is hidden on a phone');
console.log('pinball editor toolbar ok');
