#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  AUDIO_BACKENDS,
  resolveDeviceTarget,
  routingForBackend,
  selectAudioBackend,
} from "../scripts/audio-backend.mjs";

const customDevices = [
  { name: AUDIO_BACKENDS.custom.meetingToAI.name, uid: AUDIO_BACKENDS.custom.meetingToAI.uid },
  { name: AUDIO_BACKENDS.custom.aiToMeeting.name, uid: AUDIO_BACKENDS.custom.aiToMeeting.uid },
];
const blackHoleDevices = [
  { name: AUDIO_BACKENDS.blackhole.meetingToAI.name, uid: AUDIO_BACKENDS.blackhole.meetingToAI.uid },
  { name: AUDIO_BACKENDS.blackhole.aiToMeeting.name, uid: AUDIO_BACKENDS.blackhole.aiToMeeting.uid },
];
const legacyCustomDevices = [
  { name: AUDIO_BACKENDS.legacyCustom.meetingToAI.name, uid: AUDIO_BACKENDS.legacyCustom.meetingToAI.uid },
  { name: AUDIO_BACKENDS.legacyCustom.aiToMeeting.name, uid: AUDIO_BACKENDS.legacyCustom.aiToMeeting.uid },
];

assert.equal(selectAudioBackend([...blackHoleDevices, ...customDevices], "auto").id, "custom");
assert.equal(selectAudioBackend([...blackHoleDevices, ...legacyCustomDevices], "auto").id, "legacy-custom");
assert.equal(selectAudioBackend(blackHoleDevices, "auto").id, "blackhole");
assert.equal(selectAudioBackend([], "custom").id, "custom");
assert.equal(resolveDeviceTarget(customDevices, {
  name: AUDIO_BACKENDS.custom.meetingToAI.name,
  uid: "wrong.uid",
}), undefined);
assert.equal(resolveDeviceTarget(customDevices, {
  name: AUDIO_BACKENDS.custom.meetingToAI.name,
  uid: "",
})?.uid, AUDIO_BACKENDS.custom.meetingToAI.uid);

const routing = routingForBackend(AUDIO_BACKENDS.custom);
assert.equal(routing.chatgptInput.uid, routing.meetingSpeaker.uid);
assert.equal(routing.chatgptOutput.uid, routing.meetingMicrophone.uid);
assert.notEqual(routing.chatgptInput.uid, routing.chatgptOutput.uid);

process.stdout.write("Audio backend selection passed.\n");
