# 🎧 Qwen DJ — Electron DJ Pro Trainer

**Desktop DJ Practice Station with Web Audio DSP & Hardware MIDI Support**

An Electron desktop application for structured DJ practice, transition analysis, and intelligent set planning.

---

## ⚡ Key Capabilities
- **DSP Audio Analyzer (`audio-analyzer.js`)**: Real-time autocorrelation for precise BPM and musical key detection directly from decoded audio buffers.
- **Hardware MIDI Mapping**: Full Web MIDI API integration with dedicated mapping profile for the **Hercules DJControl Mix**.
- **Camelot Wheel Playlist Sequencer**: Automatic set re-ordering using harmonic mixing rules and minimal BPM variance.
- **Waveform Display & Playback**: Powered by Tone.js and WaveSurfer.js with master output recording.

---

## 🛠️ Architecture
- `main.js` — Electron main process with native file metadata extraction (`music-metadata`)
- `renderer.js` — Audio playback pipeline (Tone.js) and UI interaction
- `audio-analyzer.js` — DSP analysis functions (`detectBPM`, `detectKey`)
