# Changelog

This changelog is a human-readable summary of notable work in this repo, based on git history plus the Chrome recording investigation notes in `notes_for_recording_chrome.txt` and `recording_chrome_test_suite/result_findings.txt`.

It is backdated through commit `8d1c2939ce7bcdbb6ccc5635144e718f8d415bfd`.

## Unreleased

### Chrome recording re-integration
- The recording launcher now keeps the same loader UI across browsers and only switches destination when its buttons are clicked.
- Chromium-based browsers are sent to `recording/recording_chrome.html`.
- Firefox and other non-Chromium browsers are sent to `recording/recording.html`.
- The recording iframe in `index.html` no longer auto-loads the Chrome page.

### Chrome recording capture path
- The Chrome recording page remains isolated from the Firefox-oriented recorder.
- The current Chrome-specific work moved from direct `getOriginalStream()` capture toward hidden-audio playback recapture.
- The latest active experiment uses a hidden `<audio>` element plus `captureStream()` as the recording tap.
- Local playback from that hidden Chrome path was then muted so the page can keep meter activity and recording without audible speaker output.

### Documentation
- Added current-state notes for the Chrome recording investigation to `notes_for_recording_chrome.txt`.
- Updated `README.md` to describe the separate Chrome recording variant, loader behavior, and diagnostic notes.
- Added this human-readable changelog and backdated it through `8d1c2939ce7bcdbb6ccc5635144e718f8d415bfd`.

## 2026-03-19

### Chrome-specific recording path
- Added Chromium detection helpers in `recording/browserDetection.js`.
- Added a parallel Chrome recording page and script path:
  - `recording/recording_chrome.html`
  - `recording/recording_chrome.js`
  - `recording/conferenceInit_chrome.js`
- Updated `jitsi-bot/pageParams.js` so the page can select a browser-specific conference init script.

### Recording test suite
- Added `recording_chrome_test_suite/` to retest assumptions about Chrome recording behavior in isolation.
- Added test pages for:
  - raw stream capture
  - hidden audio playback
  - hidden audio recapture
  - startSilent behavior
  - output sink routing
- Added a shared harness and suite-specific conference bootstrap:
  - `recording_chrome_test_suite/test_harness.js`
  - `recording_chrome_test_suite/conferenceInit.js`

### Test suite refinements
- Standardized test terminology:
  - `Load Bot` means join the conference
  - `Start Test` means begin the recording-condition test
  - `Stop Test` means stop the test / stop-recording condition
- Added a suite entry page that can pass one conference URL to all iframes.
- Added bulk controls to load all bots, start all tests, and stop all tests together.
- Removed the `start_silent` test from the suite index after it consistently failed.
- Hardcoded the virtual-device names used during routing tests:
  - `virt_ritson_playback_sink`
  - `virt_ritson_record_source`

### Findings capture
- Added `recording_chrome_test_suite/result_findings.txt` to preserve sequential timestamped findings.
- Logged the main Chrome test-suite conclusions:
  - `startSilent` is a hard failure mode in this setup
  - hidden audio playback works in Chromium
  - non-empty MediaRecorder chunks do not guarantee meaningful audio
  - output sink routing remains separate from in-page recording success

### Re-integration learning
- Applied the test-suite learning back into the real Chrome recorder path.
- Confirmed that direct-stream Chrome recordings could produce non-empty saved files while still behaving as silent output.
- Documented that the real validation target must be audible recorded output or a non-zero real recording meter, not chunk size alone.

## 2026-03-18

### Firefox extension
- Added `firefox-protect-tabs/`, a Firefox extension intended to protect specific tabs from automatic unload behavior.

### Recording documentation and server behavior
- Clarified recording bot behavior in `README.md`, including:
  - when uploads go to the local helper server
  - when the browser falls back to downloads
  - where appended files are written
- Added instructions for enabling HTTP request logging in `start_server.py`.
- Removed outdated README notes about bot disconnection issues.

## 2026-03-17

### Firefox recording stabilization
- Reworked Firefox recording around a long-lived MediaRecorder plus periodic `requestData()` flushes.
- Moved away from treating each flushed chunk as a standalone valid recording.
- Improved the preferred local-service path so chunks are appended into one server-side output file instead of forcing a later merge step.
- Restored working Firefox audio capture after earlier breakage.

### Structured recording diagnostics
- Added structured logging around recording conference state and events.
- Improved `recording/conferenceInit.js` diagnostics for connection state, remote track handling, and automated recording actions.
- Added extra logging across the recording flow to diagnose the Firefox/Chrome divergence.

### Chrome recording investigation begins
- Confirmed the default recording path can work in Firefox while remaining broken in Chrome/Chromium.
- Started active diagnosis of why Chromium appeared structurally connected while failing to capture useful recorder input.

## 2026-03-12

### Merge-script prerequisites
- Added README instructions for installing `ffmpeg` so the merge scripts can be used successfully.
- This is the baseline commit requested for the backdated changelog:
  - `8d1c2939ce7bcdbb6ccc5635144e718f8d415bfd`
