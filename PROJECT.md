# Project: DJ Pro Trainer Features Implementation

## Architecture
The application is an Electron application.
- **Main Process (`main.js`)**: Handles file metadata extraction (via `music-metadata`) and file system access.
- **Renderer Process (`renderer.js`)**: Runs the UI, handles audio playback using `Tone.js`, renders waveforms using `wavesurfer.js`, and communicates with the main process.
- **Audio Analyzer (`audio-analyzer.js`)**: Performs DSP analysis (BPM, Key) on decoded `AudioBuffer` data.
- **MIDI Integration**: Listens to Web MIDI API inputs, processes them, and maps CC/Note values to app controls.
- **Recording & Dashboard**: Records Tone.js master output, stores transition metrics over time, and displays them on a dashboard.
- **AI playlist sequencer**: Reorders tracks in the set planner using Camelot Wheel rules and BPM alignment.

## Code Layout
- `index.html` - App HTML markup and style rules
- `renderer.js` - Core client-side audio player and UI logic
- `main.js` - Main Electron process handling IPC and metadata
- `audio-analyzer.js` - DSP analysis functions (BPM and Key)
- `tests/` - Directory for E2E and unit test suites

## Milestones
| # | Name | Scope | Dependencies | Status | Conversation ID |
|---|------|-------|-------------|--------|-----------------|
| 1 | E2E Test Suite & Infra | Setup E2E test harness and define 49+ tests across Tiers 1-4. | None | PLANNED | TBD |
| 2 | Real Web Audio Decoding (R1) | Optimize autocorrelation in `AudioAnalyzer`, integrate `decodeAudioData` in track load, update UI. | M1 | PLANNED | TBD |
| 3 | Web MIDI & Hercules Profile (R2) | Implement Web MIDI API, Hercules DJControl Mix mapping, custom MIDI mapping UI, and status badge. | M1 | PLANNED | TBD |
| 4 | Recording & Mix Dashboard (R3) | Record master output to filesystem, collect mix stats, display transition timeline dashboard. | M1, M2 | PLANNED | TBD |
| 5 | AI Playlist Sequencing (R4) | Auto-Sort button implementing Camelot key alignment and minimal BPM variance sorting. | M1 | PLANNED | TBD |
| 6 | E2E Verification & Adversarial Hardening (Tier 5) | Verify all tests pass, run Challenger with coverage audit, fix any gaps found. | M1-M5 | PLANNED | TBD |

## Interface Contracts
### 1. AudioAnalyzer (`audio-analyzer.js`)
- `detectBPM(audioBuffer)`: Returns `number` (BPM)
- `detectKey(audioBuffer)`: Returns `{ key: string, confidence: number, scale: string }`

### 2. Web MIDI API Custom Mapping (`midi-mapper.js` or inline)
- Config format (stored in `localStorage`):
  ```json
  {
    "cc_mappings": {
      "chA_volume": { "cc": 9, "channel": 1 },
      "chB_volume": { "cc": 10, "channel": 1 },
      "crossfader": { "cc": 11, "channel": 1 },
      "eqA_high": { "cc": 14, "channel": 1 },
      "eqA_mid": { "cc": 15, "channel": 1 },
      "eqA_low": { "cc": 16, "channel": 1 },
      "eqB_high": { "cc": 17, "channel": 1 },
      "eqB_mid": { "cc": 18, "channel": 1 },
      "eqB_low": { "cc": 19, "channel": 1 }
    },
    "note_mappings": {
      "playA": { "note": 1, "channel": 1 },
      "cueA": { "note": 2, "channel": 1 },
      "playB": { "note": 3, "channel": 1 },
      "cueB": { "note": 4, "channel": 1 }
    }
  }
  ```

### 3. Transition Analyzer Recording History
- Each transition step appends to `mixHistory`:
  ```json
  {
    "timestamp": 1718182684000,
    "timingAccuracy": 0.95,
    "harmonicCompatibility": 0.8,
    "volumeBalance": 0.9,
    "eqA": { "high": 0, "mid": 0, "low": 0 },
    "eqB": { "high": -6, "mid": -12, "low": -24 },
    "faderA": 0.8,
    "faderB": 0.4,
    "crossfader": -0.2
  }
  ```

### 4. AI Set Sequencing Sorter
- Input: Array of track objects `[ { title, artist, bpm, key }, ... ]`
- Output: Sorted array of track objects maximizing Camelot transition matches and minimizing BPM jumps.
