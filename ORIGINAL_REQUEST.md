# Original User Request

## Initial Request — 2026-06-12T10:57:47Z

Complete the remaining features of the DJ Pro Trainer Electron app: integrate real Web Audio file decoding for DSP analysis, implement Web MIDI for the Hercules DJControl Mix (preset + custom mapping), build a live recording and post-mix feedback dashboard, and create an AI playlist sequencing assistant.

Working directory: /Users/stephencoleman/~qwendj
Integrity mode: development

## Requirements

### R1. Real Web Audio Decoding
The `AudioAnalyzer` must process actual decoded `AudioBuffer` data from dropped audio files (via `AudioContext.decodeAudioData()`) to calculate true BPM and Key, replacing the current `Math.random()` mock implementation.

### R2. Hercules DJControl Mix Web MIDI Integration
The app must detect the Bluetooth MIDI controller using the Web MIDI API. It must include a pre-mapped profile for its physical controls (jog wheels, faders, EQs, pads) bound to the Tone.js deck equivalents, and provide a visual MIDI mapping customization screen.

### R3. Live Recording & Post-Mix Feedback Dashboard
The application must record the user's master mix output locally. After recording, it must display a post-mix dashboard with a timeline graph visualizing timing alignment deviation, EQ crossovers, and fader levels over the course of the mix.

### R4. AI Sequencing Assistant
The sidebar set planner must feature an "Auto-Sort" capability that reorders the imported tracks to maximize harmonic compatibility (using Camelot Wheel rules) and minimize BPM variance between adjacent tracks.

## Acceptance Criteria

### Real Web Audio Decoding
- [ ] Dropping a track into the deck processes the file through `AudioContext.decodeAudioData()` without blocking the UI thread indefinitely.
- [ ] The `AudioAnalyzer` outputs a calculated BPM and Key based on the actual audio data, and these values update the UI (replacing the mock 100-140 random BPM).

### Web MIDI Integration
- [ ] A Web MIDI API listener is established and correctly identifies incoming MIDI messages from connected devices.
- [ ] A settings modal or screen exists allowing the user to map specific MIDI CC/Note values to specific app functions (e.g., crossfader, volume, play/pause).
- [ ] The `index.html` MIDI badge updates to "MIDI Online" when a device is successfully connected.

### Live Recording & Dashboard
- [ ] The app can record the Tone.js master destination output to a standard audio format (e.g., WAV or WebM) and save it to the local filesystem.
- [ ] A visual dashboard successfully renders a timeline representing the mix history data collected by the `TransitionAnalyzer`.

### AI Sequencing
- [ ] Clicking an "Auto-Sort" button reorders the playlist array such that tracks with compatible Camelot keys and close BPMs are grouped together.
