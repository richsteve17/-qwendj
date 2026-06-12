# E2E Test Infra: DJ Pro Trainer Features

## Test Philosophy
- **Opaque-box and requirement-driven**: Tests verify features from the user perspective.
- **Self-contained execution**: Since there is no internet access to download external testing dependencies (like Playwright browsers), tests run directly inside the Electron app context using a `--run-tests` flag.
- **Automated Verification**: When run with `--run-tests`, a test runner executes in the app, runs 49+ test cases, outputs results to `test-results.json`, and exits the app.

## Feature Inventory
We map the 4 core features to verify:
1. **F1: Web Audio Decoding**: Real audio buffer decoding to calculate correct BPM and Key.
2. **F2: Web MIDI & Hercules Controller**: MIDI device detection, physical control mapping, customizable settings modal, status badge.
3. **F3: Mix Recording & Dashboard**: Recording Master output to local filesystem, timeline graph rendering with transition logs (timing, EQ, fader).
4. **F4: AI Sequencing Planner**: Reordering tracks using Camelot Wheel rules and BPM variance optimization.

## Test Case Inventory (49+ Tests)

### Tier 1: Feature Coverage (20 test cases, 5 per feature)
- **F1.1: Audio Load**: Dropping a valid WAV/MP3 file loads the track successfully.
- **F1.2: Real Decoding**: Dropping a file invokes `AudioContext.decodeAudioData()`.
- **F1.3: BPM Calculation**: Verify `AudioAnalyzer.detectBPM()` returns a correct numerical BPM for a known sample.
- **F1.4: Key Detection**: Verify `AudioAnalyzer.detectKey()` returns a key and scale.
- **F1.5: UI Update**: BPM and Key text are updated in the Deck header when loaded.
- **F2.1: MIDI Input detection**: Web MIDI API listener is initialized.
- **F2.2: MIDI Status Badge Offline**: Badge shows "MIDI Offline" on startup.
- **F2.3: MIDI Status Badge Online**: Badge transitions to "MIDI Online" when a mock MIDI controller is connected.
- **F2.4: Default Hercules Mapping**: Moving volume faders or EQ sliders on a mock Hercules MIDI controller triggers corresponding slider movements in Deck A/B.
- **F2.5: Custom Mapping UI**: Custom mapping modal opens and registers new CC/Note inputs.
- **F3.1: Start/Stop Recording**: Clicking record starts the Tone.js recorder, and stopping it creates an audio file.
- **F3.2: Record File Preservation**: Verify the recorded file is written to the local disk and is non-empty.
- **F3.3: Dashboard Rendering**: Opening the dashboard displays the mix history graphs.
- **F3.4: Timing Graph Data**: Timeline graph plots timing accuracy percentages from `TransitionAnalyzer`.
- **F3.5: EQ and Volume Graph Data**: Timeline graph plots EQ crossovers and fader level graphs.
- **F4.1: Auto-Sort Trigger**: Clicking the "Auto-Sort" button triggers the sequence algorithm.
- **F4.2: Camelot Key Reordering**: Sorting reorders tracks to match adjacent Camelot keys (e.g. 8A -> 9A -> 10A).
- **F4.3: BPM Variance Reordering**: Sorting groups tracks with minimal BPM differences together.
- **F4.4: UI Playlist Refresh**: The sidebar playlist updates visually to reflect the sorted order.
- **F4.5: Sorted Track Loading**: Loading a track from the sorted playlist to Deck A/B loads the correct track.

### Tier 2: Boundary & Corner Cases (20 test cases, 5 per feature)
- **F1.B1: Empty/Invalid File drop**: Dropping a non-audio file displays an error and does not crash the app.
- **F1.B2: Ultra-short track**: Decoding an ultra-short track (under 1 second) completes without throwing an error.
- **F1.B3: Zero-frequency / silence track**: Analyzing silent audio handles it gracefully (returns fallback BPM 120).
- **F1.B4: Non-blocking decoding**: Large track decoding runs asynchronously and keeps UI responsive.
- **F1.B5: High-resolution audio**: Decodes high sample rate (e.g. 96kHz, 24-bit) files correctly.
- **F2.B1: Dual MIDI Controllers**: App handles messages from multiple MIDI inputs simultaneously.
- **F2.B2: Out of Bound MIDI CC**: Incoming CC values outside 0-127 are ignored safely.
- **F2.B3: Device Disconnection**: MIDI status badge goes back to offline if device disconnects mid-session.
- **F2.B4: Custom Mapping Collision**: Attempting to map the same CC to multiple controls highlights warning.
- **F2.B5: Custom Mapping Reset**: Resetting mappings restores default Hercules profiles.
- **F3.B1: Out of Disk Space Simulation**: App fails gracefully if saving recording fails.
- **F3.B2: Empty Mix History**: Dashboard handles rendering when zero transitions have occurred.
- **F3.B3: Long Mix Recording**: Recorder handles continuous recording over 10 minutes without memory leaks.
- **F3.B4: Overlapping Transitions**: Rapid starting/stopping of coach mode doesn't corrupt history logs.
- **F3.B5: Dashboard Resize**: Dashboard timeline graph resizes properly without breaking layout.
- **F4.B1: Single Track Sorter**: Auto-sort with 1 track in playlist does nothing and doesn't crash.
- **F4.B2: Empty Playlist Sorter**: Auto-sort with 0 tracks is handled gracefully.
- **F4.B3: Disjoint Keys**: Playlist with completely incompatible keys sorts primarily by BPM variance.
- **F4.B4: Duplicate Tracks**: Sorting playlist containing duplicate tracks handles duplicates correctly.
- **F4.B5: Large Playlist Sorter**: Sorting a 100-track playlist executes in under 50ms.

### Tier 3: Cross-Feature Combinations (4 test cases)
- **F-CF.1: Loaded Sorted Track & Analyze**: Auto-sorted playlist tracks are loaded into decks and decoded properly.
- **F-CF.2: MIDI Control during Recording**: Using Hercules MIDI faders while recording correctly saves the audio levels and logs volume crossovers in the timeline.
- **F-CF.3: MIDI Mapping Modal UI & Active Decks**: Customizing MIDI mapping while decks are playing does not interrupt audio or UI responsiveness.
- **F-CF.4: Coach Mode + Recording**: Transition Coach runs concurrently with active master recording, rendering accurate feedback on the dashboard after recording stops.

### Tier 4: Real-World Workload Testing (5 test cases)
- **F-RW.1: Standard 3-Track Mix Session**: Import 3 tracks, auto-sort them, load tracks to Deck A/B, start recording, mix them using EQs/crossfader, stop recording, and view dashboard.
- **F-RW.2: Stress Mix Session**: Import 10 tracks, sort them, load, quickly transition using MIDI controls, verify the timeline graph contains all 10 transition logs.
- **F-RW.3: Long Set Recording Validation**: Simulate a 5-minute set with multiple transitions, verify WAV output file exists and is playable, and dashboard matches fader histories.
- **F-RW.4: Quick Re-mapping and Performance Test**: Map MIDI, load track, trigger hot cues rapidly via MIDI notes while analyzing a new dropped track in the other deck.
- **F-RW.5: Full User Acceptance Flow**: Validate drag-and-drop playlist, AI sorting, deck drop, Web Audio analysis, MIDI mapping modifications, live mixing, recording, and dashboard presentation.

## Test Harness Implementation Plan
1. Add a `--run-tests` handler in `main.js` which loads `index.html` and signals the renderer to execute `tests/runner.js`.
2. Mock Web MIDI API inside the runner (since physical devices won't be plugged in on headless runners).
3. Mock File Drop events programmatically to feed actual test audio files to the system.
4. Execute tests sequentially, writing results to `/Users/stephencoleman/~qwendj/test-results.json`.
5. Read results in `main.js`, output formatting to console, and call `app.exit(failures > 0 ? 1 : 0)`.
