import test from "node:test";
import assert from "node:assert/strict";
import { kittyCtrlShiftLetterRegex } from "../src/utils/keybind";

test("kittyCtrlShiftLetterRegex matches the raw kitty encoding of ctrl+shift+r", () => {
  const re = kittyCtrlShiftLetterRegex("ctrl+shift+r");
  assert.ok(re);
  assert.equal(re.test("\u001b[114;5u"), true); // lowercase r, modifier 5 (shift+ctrl)
  assert.equal(re.test("\u001b[82;5u"), true); // uppercase R
  assert.equal(re.test("\u001b[114;4u"), false); // ctrl only
  assert.equal(re.test("\u001b[114;6u"), false); // ctrl+alt
  assert.equal(re.test("\u001b[112;5u"), false); // ctrl+shift+p (different key)
  assert.equal(re.test("\u0012"), false); // legacy ctrl+r
  assert.equal(re.test("r"), false);
});

test("kittyCtrlShiftLetterRegex accepts the shift+ctrl modifier order", () => {
  const re = kittyCtrlShiftLetterRegex("shift+ctrl+p");
  assert.ok(re);
  assert.equal(re.test("\u001b[112;5u"), true);
  assert.equal(re.test("\u001b[114;5u"), false);
});

test("kittyCtrlShiftLetterRegex returns undefined for non ctrl+shift letter binds", () => {
  assert.equal(kittyCtrlShiftLetterRegex("alt+r"), undefined);
  assert.equal(kittyCtrlShiftLetterRegex("ctrl+r"), undefined);
  assert.equal(kittyCtrlShiftLetterRegex("ctrl+shift+enter"), undefined);
  assert.equal(kittyCtrlShiftLetterRegex(""), undefined);
});
