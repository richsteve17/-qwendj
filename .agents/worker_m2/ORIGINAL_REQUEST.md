## 2026-06-12T11:07:49Z
You are the DSP Audio Analyzer Optimizer. Your working directory is `/Users/stephencoleman/~qwendj/.agents/worker_m2/`.
Your task is to fix and optimize the DSP logic in `/Users/stephencoleman/~qwendj/audio-analyzer.js`.

Issues to address:
1. The current `detectBPM` performs autocorrelation on the raw downsampled waveform. This is computationally expensive (takes minutes and freezes the app for standard tracks) and mathematically incorrect for BPM detection (detects pitch frequency instead of beat tempo).
2. The current `detectKey` runs an FFT on the entire audio track. For a 3-minute track, this runs thousands of FFTs and blocks the UI thread for 15-20 seconds.

Instructions:
1. Implement a fast, energy-envelope-based BPM detector in `detectBPM`:
   - Compute the energy/onset envelope of the audio buffer (e.g., divide into frames of 1024 samples, calculate the energy or absolute value, and compute frame-to-frame positive energy differences).
   - Perform autocorrelation on the envelope for lag values corresponding to a DJ BPM range of 60 to 200 BPM.
   - Return the calculated BPM.
2. Optimize `detectKey`:
   - Instead of analyzing the entire audio buffer, slice a 10-second segment from the middle of the track (e.g., around 30s to 40s) where the musical structure is established.
   - Compute chroma vectors only on this representative segment.
3. Ensure that your changes to `audio-analyzer.js` are fully compatible with `renderer.js` and that all 49 E2E tests in `tests/runner.js` continue to pass.
4. Run `npm test` to execute the E2E tests and verify your changes. If the command fails because of user permission prompts, retry and let the user approve.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
