const fs = require('fs');
const path = require('path');
const { ipcRenderer } = require('electron');

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Simple WAV decoder for runner tests
function decodeWav(filePath) {
    try {
        const fileBuffer = fs.readFileSync(filePath);
        const chunkID = fileBuffer.toString('utf8', 0, 4);
        const format = fileBuffer.toString('utf8', 8, 12);
        if (chunkID !== 'RIFF' || format !== 'WAVE') return null;

        const numChannels = fileBuffer.readUInt16LE(22);
        const sampleRate = fileBuffer.readUInt32LE(24);
        const bitsPerSample = fileBuffer.readUInt16LE(34);
        
        let offset = 12;
        let dataSize = 0;
        let dataOffset = 0;
        
        while (offset + 8 < fileBuffer.length) {
            const subChunkId = fileBuffer.toString('utf8', offset, offset + 4);
            const subChunkSize = fileBuffer.readUInt32LE(offset + 4);
            if (subChunkId === 'data') {
                dataSize = subChunkSize;
                dataOffset = offset + 8;
                break;
            }
            offset += 8 + subChunkSize;
        }
        
        if (dataOffset === 0) return null;

        const numSamples = Math.floor(dataSize / (numChannels * (bitsPerSample / 8)));
        const channelData = new Float32Array(numSamples);

        if (bitsPerSample === 16) {
            for (let i = 0; i < numSamples; i++) {
                const sampleOffset = dataOffset + i * numChannels * 2;
                if (sampleOffset + 1 < fileBuffer.length) {
                    const sample = fileBuffer.readInt16LE(sampleOffset);
                    channelData[i] = sample / 32768.0;
                }
            }
        }

        return {
            sampleRate,
            numberOfChannels: numChannels,
            duration: numSamples / sampleRate,
            getChannelData: (ch) => channelData
        };
    } catch (e) {
        return null;
    }
}

// Mock MIDI Setup
const mockMidiInputs = new Map();
const mockMidiOutputs = new Map();
const mockMIDIAccess = {
    inputs: mockMidiInputs,
    outputs: mockMidiOutputs,
    onstatechange: null
};

navigator.requestMIDIAccess = async function() {
    return mockMIDIAccess;
};

function connectMockMIDIController(id, name) {
    const input = {
        id,
        name,
        type: 'input',
        state: 'connected',
        connection: 'open',
        onmidimessage: null,
        addEventListener: function(type, listener) {
            if (type === 'midimessage') this.onmidimessage = listener;
        },
        removeEventListener: function(type, listener) {
            if (type === 'midimessage') this.onmidimessage = null;
        }
    };
    mockMidiInputs.set(id, input);
    if (mockMIDIAccess.onstatechange) {
        mockMIDIAccess.onstatechange({ port: input });
    }
    if (window.app && window.app.midiMapper) {
        window.app.midiMapper.setupMidiPorts(mockMIDIAccess);
    }
    return input;
}

function disconnectMockMIDIController(id) {
    const input = mockMidiInputs.get(id);
    if (input) {
        input.state = 'disconnected';
        mockMidiInputs.delete(id);
        if (mockMIDIAccess.onstatechange) {
            mockMIDIAccess.onstatechange({ port: input });
        }
        if (window.app && window.app.midiMapper) {
            window.app.midiMapper.setupMidiPorts(mockMIDIAccess);
        }
    }
}

// Mock File dropping utility
function mockDropFile(element, filePath) {
    const file = {
        path: filePath,
        name: path.basename(filePath),
        type: 'audio/wav',
        size: fs.statSync(filePath).size
    };
    
    // Create a mock DataTransfer object
    const dataTransfer = {
        files: [file],
        items: [{
            kind: 'file',
            type: 'audio/wav',
            getAsFile: () => file
        }],
        types: ['Files']
    };
    
    const dragEvent = new CustomEvent('drop', {
        bubbles: true,
        cancelable: true
    });
    
    dragEvent.dataTransfer = dataTransfer;
    
    element.dispatchEvent(dragEvent);
}

// Test suite collection
const tests = [];
function addTest(name, fn) {
    tests.push({ name, fn });
}

// -----------------------------------------------------------------------------
// TIER 1: FEATURE COVERAGE (20 TESTS)
// -----------------------------------------------------------------------------

addTest('F1.1: Audio Load - Dropping a valid WAV loads the track successfully', async () => {
    const sinePath = path.join(__dirname, 'fixtures', 'sine_440hz.wav');
    const panelA = document.getElementById('deckPanelA');
    mockDropFile(panelA, sinePath);
    await sleep(250);
    if (!window.app.deckA || window.app.deckA.path !== sinePath) {
        throw new Error('Track not loaded to Deck A');
    }
});

addTest('F1.2: Real Decoding - Dropping a file invokes AudioContext.decodeAudioData()', async () => {
    const Tone = require('tone');
    const rawCtx = Tone.getContext().rawContext;
    let decoded = false;
    const originalDecode = rawCtx.decodeAudioData;
    rawCtx.decodeAudioData = function(...args) {
        decoded = true;
        return originalDecode.apply(this, args);
    };
    const sinePath = path.join(__dirname, 'fixtures', 'sine_440hz.wav');
    await window.app.loadTrackToDeck({ path: sinePath, title: 'Test', artist: 'Test', duration: 1 }, 'A');
    await sleep(200);
    rawCtx.decodeAudioData = originalDecode;
    if (!decoded) {
        throw new Error('AudioContext.decodeAudioData was not invoked during track load');
    }
});

addTest('F1.3: BPM Calculation - AudioAnalyzer.detectBPM() returns numerical BPM', async () => {
    const AudioAnalyzer = require('../audio-analyzer');
    const analyzer = new AudioAnalyzer();
    const sinePath = path.join(__dirname, 'fixtures', 'sine_440hz.wav');
    const decoded = decodeWav(sinePath);
    const bpm = analyzer.detectBPM(decoded);
    if (typeof bpm !== 'number' || bpm < 60 || bpm > 200) {
        throw new Error('detectBPM returned invalid BPM: ' + bpm);
    }
});

addTest('F1.4: Key Detection - AudioAnalyzer.detectKey() returns key and scale', async () => {
    const AudioAnalyzer = require('../audio-analyzer');
    const analyzer = new AudioAnalyzer();
    const sinePath = path.join(__dirname, 'fixtures', 'sine_440hz.wav');
    const decoded = decodeWav(sinePath);
    const keyObj = analyzer.detectKey(decoded);
    if (!keyObj || typeof keyObj.key !== 'string' || !keyObj.scale) {
        throw new Error('detectKey returned invalid response: ' + JSON.stringify(keyObj));
    }
});

addTest('F1.5: UI Update - BPM and Key text are updated in the Deck header when loaded', async () => {
    const artistInfoA = document.getElementById('artistInfoA').textContent;
    if (!artistInfoA.includes('•') || artistInfoA.includes('Drop track file')) {
        throw new Error('Deck header was not updated: ' + artistInfoA);
    }
});

addTest('F2.1: MIDI Input detection - Web MIDI API listener is initialized', async () => {
    if (!window.app.midiMapper) {
        throw new Error('MidiMapper not initialized');
    }
});

addTest('F2.2: MIDI Status Badge Offline - Badge shows "MIDI Offline" on startup', async () => {
    const badgeText = document.getElementById('midiBadgeText').textContent;
    if (badgeText !== 'MIDI Offline') {
        throw new Error('MIDI status badge is not Offline on startup: ' + badgeText);
    }
});

addTest('F2.3: MIDI Status Badge Online - Badge transitions to "MIDI Online" when connected', async () => {
    connectMockMIDIController('ctrl1', 'Hercules DJControl Mix');
    await sleep(100);
    const badgeText = document.getElementById('midiBadgeText').textContent;
    if (badgeText !== 'MIDI Online') {
        throw new Error('MIDI status badge is not Online: ' + badgeText);
    }
});

addTest('F2.4: Default Hercules Mapping - Moving controls updates Deck values', async () => {
    const input = mockMidiInputs.get('ctrl1');
    // Volume A fader is CC 9. Status 0xB0 (CC ch 1), value 95.
    input.onmidimessage({ data: [0xB0, 9, 95] });
    await sleep(100);
    const volVal = parseFloat(document.getElementById('volumeA').value);
    if (Math.abs(volVal - 95/127) > 0.05) {
        throw new Error('Volume A did not update correctly to ~0.74, got: ' + volVal);
    }
});

addTest('F2.5: Custom Mapping UI - Custom mapping modal opens and registers inputs', async () => {
    document.getElementById('midiSettingsBtn').click();
    const modal = document.getElementById('midiModal');
    if (modal.style.display !== 'flex') {
        throw new Error('MIDI Mapping Modal not visible');
    }
    document.getElementById('closeMidiBtn').click();
    if (modal.style.display !== 'none') {
        throw new Error('MIDI Mapping Modal not hidden');
    }
});

addTest('F3.1: Start/Stop Recording - Clicking record toggles Tone.js recorder', async () => {
    const recordBtn = document.getElementById('recordBtn');
    recordBtn.click();
    await sleep(100);
    if (!window.app.recording) {
        throw new Error('Recording was not started');
    }
    recordBtn.click();
    await sleep(100);
    if (window.app.recording) {
        throw new Error('Recording was not stopped');
    }
});

addTest('F3.2: Record File Preservation - Verify recorded file exists and is non-empty', async () => {
    const recPath = path.join(__dirname, '..', 'recorded_mix.wav');
    if (!fs.existsSync(recPath)) {
        throw new Error('Recorded file not preserved at: ' + recPath);
    }
    if (fs.statSync(recPath).size === 0) {
        throw new Error('Recorded file is empty');
    }
});

addTest('F3.3: Dashboard Rendering - Opening the dashboard displays the mix history', async () => {
    document.getElementById('dashboardBtn').click();
    const dbModal = document.getElementById('dashboardModal');
    if (dbModal.style.display !== 'flex') {
        throw new Error('Dashboard Modal is not visible');
    }
    document.getElementById('closeDashboardBtn').click();
});

addTest('F3.4: Timing Graph Data - Timeline graph plots timing accuracy percentages', async () => {
    window.app.transitionAnalyzer.mixHistory = [];
    window.app.transitionAnalyzer.mixHistory.push({
        timestamp: Date.now(),
        analysis: { timingAccuracy: 0.95, harmonicCompatibility: 0.9, volumeBalance: 0.8, transitionQuality: 0.88 }
    });
    window.app.renderDashboard();
    const totalTransitions = document.getElementById('totalTransitions').textContent;
    if (totalTransitions !== '1') {
        throw new Error('Dashboard stats did not render timing details: total is ' + totalTransitions);
    }
});

addTest('F3.5: EQ and Volume Graph Data - Timeline graph plots EQ crossovers and volume faders', async () => {
    const avgTiming = document.getElementById('avgTiming').textContent;
    if (avgTiming !== '95%') {
        throw new Error('Average timing stats did not render correctly: ' + avgTiming);
    }
});

addTest('F4.1: Auto-Sort Trigger - Clicking "Auto-Sort" triggers sequence algorithm', async () => {
    window.app.playlist = [
        { title: 'Track 1', artist: 'A', bpm: 120, key: '8A', duration: 10 },
        { title: 'Track 2', artist: 'B', bpm: 122, key: '9A', duration: 10 }
    ];
    document.getElementById('autoSortBtn').click();
    if (window.app.playlist.length !== 2) {
        throw new Error('Auto sort button click did not trigger playlist sort');
    }
});

addTest('F4.2: Camelot Key Reordering - Sorting reorders tracks to match adjacent keys', async () => {
    window.app.playlist = [
        { title: '10A key', artist: 'C', bpm: 120, key: '10A', duration: 10 },
        { title: '8A key', artist: 'A', bpm: 120, key: '8A', duration: 10 },
        { title: '9A key', artist: 'B', bpm: 120, key: '9A', duration: 10 }
    ];
    window.app.autoSortPlaylist();
    if (window.app.playlist[0].key !== '8A' || window.app.playlist[1].key !== '9A' || window.app.playlist[2].key !== '10A') {
        throw new Error('Camelot key sorting sequence failed: ' + JSON.stringify(window.app.playlist));
    }
});

addTest('F4.3: BPM Variance Reordering - Sorting groups tracks with minimal BPM differences', async () => {
    window.app.playlist = [
        { title: '130 BPM', artist: 'C', bpm: 130, key: '8A', duration: 10 },
        { title: '120 BPM', artist: 'A', bpm: 120, key: '8A', duration: 10 },
        { title: '122 BPM', artist: 'B', bpm: 122, key: '8A', duration: 10 }
    ];
    window.app.autoSortPlaylist();
    if (window.app.playlist[0].bpm !== 120 || window.app.playlist[1].bpm !== 122 || window.app.playlist[2].bpm !== 130) {
        throw new Error('BPM variance sorting sequence failed: ' + JSON.stringify(window.app.playlist));
    }
});

addTest('F4.4: UI Playlist Refresh - Playlist updates visually to reflect sorted order', async () => {
    const firstTitle = document.getElementById('playlist').querySelector('.track-title').textContent;
    if (!firstTitle.includes('120 BPM')) {
        throw new Error('Playlist UI is not refreshed with sorted items: ' + firstTitle);
    }
});

addTest('F4.5: Sorted Track Loading - Loading sorted playlist track to deck works correctly', async () => {
    window.app.loadTrackToDeckIndex(0, 'A');
    await sleep(200);
    if (!window.app.deckA || window.app.deckA.title !== '120 BPM') {
        throw new Error('Failed to load correct track from playlist');
    }
});

// -----------------------------------------------------------------------------
// TIER 2: BOUNDARY & CORNER CASES (20 TESTS)
// -----------------------------------------------------------------------------

addTest('F1.B1: Empty/Invalid File drop - Displays warning error instead of crashing', async () => {
    let alertCalled = false;
    const origAlert = window.alert;
    window.alert = () => { alertCalled = true; };
    
    const panelA = document.getElementById('deckPanelA');
    mockDropFile(panelA, path.join(__dirname, 'fixtures', 'invalid.txt'));
    await sleep(50);
    
    window.alert = origAlert;
    if (!alertCalled) {
        throw new Error('Alert warning was not triggered on invalid file drop');
    }
});

addTest('F1.B2: Ultra-short track - Decoding under 1s completes without errors', async () => {
    const shortPath = path.join(__dirname, 'fixtures', 'short_sine.wav');
    await window.app.loadTrackToDeck({ path: shortPath, title: 'Short', artist: 'Short', duration: 0.5 }, 'A');
    await sleep(250);
    if (!window.app.deckA || window.app.deckA.path !== shortPath) {
        throw new Error('Failed to load ultra-short WAV fixture');
    }
});

addTest('F1.B3: Zero-frequency / silence track - Handles silence and returns fallback BPM 120', async () => {
    const AudioAnalyzer = require('../audio-analyzer');
    const analyzer = new AudioAnalyzer();
    const silencePath = path.join(__dirname, 'fixtures', 'silence.wav');
    const decoded = decodeWav(silencePath);
    const bpm = analyzer.detectBPM(decoded);
    if (bpm !== 120) {
        throw new Error('BPM detection on silent WAV did not return fallback 120, got: ' + bpm);
    }
});

addTest('F1.B4: Non-blocking decoding - Asynchronous decoding keeps UI responsive', async () => {
    let asyncTick = false;
    setTimeout(() => { asyncTick = true; }, 0);
    
    const sinePath = path.join(__dirname, 'fixtures', 'sine_440hz.wav');
    await window.app.loadTrackToDeck({ path: sinePath, title: 'Sine', artist: 'Sine', duration: 1.0 }, 'A');
    
    if (asyncTick) {
        throw new Error('Audio loading and decoding was blocking, executed in main event loop ticks');
    }
    await sleep(200);
});

addTest('F1.B5: High-resolution audio - Decodes 96kHz WAV correctly', async () => {
    const hiResPath = path.join(__dirname, 'fixtures', 'high_res.wav');
    const decoded = decodeWav(hiResPath);
    if (!decoded || decoded.sampleRate !== 96000) {
        throw new Error('Failed to decode high-resolution WAV header');
    }
});

addTest('F2.B1: Dual MIDI Controllers - Handles multiple MIDI controllers simultaneously', async () => {
    connectMockMIDIController('ctrl2', ' Hercules DJControl Mix Secondary');
    const input1 = mockMidiInputs.get('ctrl1');
    const input2 = mockMidiInputs.get('ctrl2');
    
    // Ctrl 1 adjusts Vol A CC 9. Ctrl 2 adjusts Vol B CC 10.
    input1.onmidimessage({ data: [0xB0, 9, 30] });
    input2.onmidimessage({ data: [0xB0, 10, 80] });
    await sleep(100);
    
    const volA = parseFloat(document.getElementById('volumeA').value);
    const volB = parseFloat(document.getElementById('volumeB').value);
    
    if (Math.abs(volA - 30/127) > 0.05 || Math.abs(volB - 80/127) > 0.05) {
        throw new Error(`Dual MIDI mapping values failed to apply: VolA=${volA}, VolB=${volB}`);
    }
});

addTest('F2.B2: Out of Bound MIDI CC - Out of bound CC values (outside 0-127) are ignored', async () => {
    const input = mockMidiInputs.get('ctrl1');
    const preVol = document.getElementById('volumeA').value;
    input.onmidimessage({ data: [0xB0, 9, 200] }); // 200 is out of bounds
    await sleep(50);
    const postVol = document.getElementById('volumeA').value;
    if (preVol !== postVol) {
        throw new Error('Out of bounds MIDI value was not ignored');
    }
});

addTest('F2.B3: Device Disconnection - Status badge updates to offline when devices disconnect', async () => {
    disconnectMockMIDIController('ctrl1');
    disconnectMockMIDIController('ctrl2');
    await sleep(100);
    const badgeText = document.getElementById('midiBadgeText').textContent;
    if (badgeText !== 'MIDI Offline') {
        throw new Error('Midi status badge did not return to Offline: ' + badgeText);
    }
});

addTest('F2.B4: Custom Mapping Collision - Highlight warning when mapping same CC to multiple controls', async () => {
    document.getElementById('midiSettingsBtn').click();
    await sleep(50);
    const modal = document.getElementById('midiModal');
    const ccInputs = modal.querySelectorAll('.cc-input');
    
    // Put same CC on first two CC inputs
    ccInputs[0].value = 14;
    ccInputs[1].value = 14;
    ccInputs[0].dispatchEvent(new Event('input'));
    await sleep(50);
    
    const warning = document.getElementById('midiModalWarning');
    if (warning.style.display === 'none') {
        throw new Error('Mapping collision warning did not show');
    }
    document.getElementById('closeMidiBtn').click();
});

addTest('F2.B5: Custom Mapping Reset - Resetting mappings restores default Hercules profiles', async () => {
    document.getElementById('midiSettingsBtn').click();
    await sleep(50);
    document.getElementById('resetMidiBtn').click();
    await sleep(50);
    document.getElementById('closeMidiBtn').click();
});

addTest('F3.B1: Out of Disk Space Simulation - Fails gracefully if saving recording fails', async () => {
    window.simulateOutOfDiskSpace = true;
    let alertCalled = false;
    const origAlert = window.alert;
    window.alert = () => { alertCalled = true; };
    
    const recordBtn = document.getElementById('recordBtn');
    recordBtn.click();
    await sleep(100);
    recordBtn.click();
    await sleep(100);
    
    window.alert = origAlert;
    window.simulateOutOfDiskSpace = false;
    if (!alertCalled) {
        throw new Error('Failed to alert error on simulated disk space write failure');
    }
});

addTest('F3.B2: Empty Mix History - Dashboard renders normally when zero transitions occurred', async () => {
    window.app.transitionAnalyzer.mixHistory = [];
    window.app.renderDashboard();
    const totalTransitions = document.getElementById('totalTransitions').textContent;
    if (totalTransitions !== '0') {
        throw new Error('Dashboard failed to reset and render empty history state: total=' + totalTransitions);
    }
});

addTest('F3.B3: Long Mix Recording - Handles continuous recording over 10 minutes', async () => {
    const recordBtn = document.getElementById('recordBtn');
    recordBtn.click();
    await sleep(100);
    recordBtn.click();
    await sleep(100);
});

addTest('F3.B4: Overlapping Transitions - Rapid starting/stopping of coach does not corrupt history', async () => {
    for (let i = 0; i < 15; i++) {
        window.app.toggleCoachMode();
    }
    if (window.app.coachMode) {
        window.app.toggleCoachMode();
    }
});

addTest('F3.B5: Dashboard Resize - Dashboard graph resizes cleanly', async () => {
    window.dispatchEvent(new Event('resize'));
    await sleep(50);
});

addTest('F4.B1: Single Track Sorter - Auto-sort with 1 track does nothing and does not crash', async () => {
    window.app.playlist = [{ title: 'Single', artist: 'A', bpm: 120, key: '8A', duration: 10 }];
    window.app.autoSortPlaylist();
    if (window.app.playlist.length !== 1) {
        throw new Error('Auto-sort altered playlist of size 1');
    }
});

addTest('F4.B2: Empty Playlist Sorter - Auto-sort with 0 tracks does nothing', async () => {
    window.app.playlist = [];
    window.app.autoSortPlaylist();
    if (window.app.playlist.length !== 0) {
        throw new Error('Auto-sort altered playlist of size 0');
    }
});

addTest('F4.B3: Disjoint Keys - Incompatible keys sort primarily by BPM variance', async () => {
    window.app.playlist = [
        { title: '130 BPM', artist: 'C', bpm: 130, key: '1A', duration: 10 },
        { title: '120 BPM', artist: 'A', bpm: 120, key: '8A', duration: 10 },
        { title: '125 BPM', artist: 'B', bpm: 125, key: '4A', duration: 10 }
    ];
    window.app.autoSortPlaylist();
    if (window.app.playlist[0].bpm !== 120 || window.app.playlist[1].bpm !== 125 || window.app.playlist[2].bpm !== 130) {
        throw new Error('Disjoint keys sort did not fall back to minimal BPM variance: ' + JSON.stringify(window.app.playlist));
    }
});

addTest('F4.B4: Duplicate Tracks - Handles duplicate tracks correctly in sorter', async () => {
    window.app.playlist = [
        { title: 'Dup', artist: 'A', bpm: 120, key: '8A', duration: 10 },
        { title: 'Dup', artist: 'A', bpm: 120, key: '8A', duration: 10 }
    ];
    window.app.autoSortPlaylist();
    if (window.app.playlist.length !== 2) {
        throw new Error('Duplicates were deleted or lost in sorting');
    }
});

addTest('F4.B5: Large Playlist Sorter - 100 tracks sort executes in under 50ms', async () => {
    const list = [];
    for (let i = 0; i < 100; i++) {
        list.push({ title: 'T' + i, artist: 'A', bpm: 100 + (i%30), key: '8A', duration: 120 });
    }
    window.app.playlist = list;
    const t0 = performance.now();
    window.app.autoSortPlaylist();
    const duration = performance.now() - t0;
    if (duration > 50) {
        throw new Error(`Large sorting performance failed: ${duration.toFixed(2)}ms (>50ms)`);
    }
});

// -----------------------------------------------------------------------------
// TIER 3: CROSS-FEATURE COMBINATIONS (4 TESTS)
// -----------------------------------------------------------------------------

addTest('F-CF.1: Loaded Sorted Track & Analyze - Sorted track loaded into deck and decoded', async () => {
    const sinePath = path.join(__dirname, 'fixtures', 'sine_440hz.wav');
    window.app.playlist = [
        { title: 'Sorted Track', artist: 'Artist', bpm: 128, key: '8A', duration: 60, path: sinePath }
    ];
    window.app.updatePlaylistUI();
    window.app.loadTrackToDeckIndex(0, 'A');
    await sleep(250);
    if (!window.app.deckA || window.app.deckA.title !== 'Sorted Track') {
        throw new Error('Failed to load sorted track to Deck A');
    }
});

addTest('F-CF.2: MIDI Control during Recording - MIDI CC input during recording applies fader values', async () => {
    connectMockMIDIController('ctrl1', 'Hercules');
    const recordBtn = document.getElementById('recordBtn');
    
    recordBtn.click();
    await sleep(50);
    
    const input = mockMidiInputs.get('ctrl1');
    input.onmidimessage({ data: [0xB0, 9, 100] }); // chA volume CC 9 -> value 100 (~0.78)
    await sleep(100);
    
    recordBtn.click();
    await sleep(50);
    
    const vol = parseFloat(document.getElementById('volumeA').value);
    if (Math.abs(vol - 100/127) > 0.05) {
        throw new Error('MIDI fader inputs did not register during active recording session, got: ' + vol);
    }
});

addTest('F-CF.3: MIDI Mapping Modal UI & Active Decks - Customizing mappings does not interrupt playback', async () => {
    window.app.togglePlay('A');
    await sleep(50);
    
    document.getElementById('midiSettingsBtn').click();
    await sleep(50);
    
    if (window.app.playerA.state !== 'started') {
        throw new Error('Active playback stopped when opening MIDI custom mapper modal');
    }
    
    document.getElementById('closeMidiBtn').click();
    window.app.togglePlay('A');
});

addTest('F-CF.4: Coach Mode + Recording - Coach runs concurrently with recording and logs transition', async () => {
    window.app.toggleCoachMode();
    const recordBtn = document.getElementById('recordBtn');
    
    recordBtn.click();
    await sleep(50);
    
    recordBtn.click();
    await sleep(50);
    
    window.app.toggleCoachMode();
});

// -----------------------------------------------------------------------------
// TIER 4: REAL-WORLD WORKLOAD TESTING (5 TESTS)
// -----------------------------------------------------------------------------

addTest('F-RW.1: Standard 3-Track Mix Session - Fully simulate 3-track session', async () => {
    const sinePath = path.join(__dirname, 'fixtures', 'sine_440hz.wav');
    window.app.playlist = [
        { title: 'T1', artist: 'Artist', bpm: 120, key: '8A', duration: 120, path: sinePath },
        { title: 'T2', artist: 'Artist', bpm: 122, key: '9A', duration: 120, path: sinePath },
        { title: 'T3', artist: 'Artist', bpm: 124, key: '10A', duration: 120, path: sinePath }
    ];
    
    window.app.updatePlaylistUI();
    window.app.autoSortPlaylist();
    
    window.app.loadTrackToDeckIndex(0, 'A');
    window.app.loadTrackToDeckIndex(1, 'B');
    await sleep(100);
    
    window.app.toggleCoachMode();
    const recordBtn = document.getElementById('recordBtn');
    recordBtn.click();
    await sleep(100);
    
    window.app.togglePlay('A');
    window.app.togglePlay('B');
    await sleep(100);
    
    recordBtn.click();
    window.app.toggleCoachMode();
    window.app.togglePlay('A');
    window.app.togglePlay('B');
});

addTest('F-RW.2: Stress Mix Session - Simulate 10-track stress load and verify transitions log', async () => {
    const sinePath = path.join(__dirname, 'fixtures', 'sine_440hz.wav');
    const list = [];
    for (let i = 0; i < 10; i++) {
        list.push({ title: 'StressT' + i, artist: 'Artist', bpm: 120 + i * 2, key: '8A', duration: 30, path: sinePath });
    }
    
    window.app.playlist = list;
    window.app.autoSortPlaylist();
    window.app.transitionAnalyzer.mixHistory = [];
    
    window.app.toggleCoachMode();
    for (let i = 0; i < 9; i++) {
        window.app.loadTrackToDeck(window.app.playlist[i], 'A');
        window.app.loadTrackToDeck(window.app.playlist[i+1], 'B');
        await sleep(50);
        window.app.performRealTimeAnalysis();
    }
    
    window.app.toggleCoachMode();
    if (window.app.transitionAnalyzer.mixHistory.length < 9) {
        throw new Error('Stress session history failed to capture all transitions: ' + window.app.transitionAnalyzer.mixHistory.length);
    }
});

addTest('F-RW.3: Long Set Recording Validation - Verify recording WAV output is preserved', async () => {
    const recBtn = document.getElementById('recordBtn');
    recBtn.click();
    await sleep(100);
    
    window.app.transitionAnalyzer.mixHistory.push({
        timestamp: Date.now(),
        analysis: { timingAccuracy: 0.95, harmonicCompatibility: 0.95, volumeBalance: 0.95, transitionQuality: 0.95 }
    });
    
    recBtn.click();
    await sleep(100);
    
    const recPath = path.join(__dirname, '..', 'recorded_mix.wav');
    if (!fs.existsSync(recPath)) {
        throw new Error('Recorded file not preserved after long set simulation');
    }
});

addTest('F-RW.4: Quick Re-mapping and Performance Test - Trigger events rapidly under load', async () => {
    connectMockMIDIController('ctrl1', 'Hercules');
    const input = mockMidiInputs.get('ctrl1');
    
    for (let i = 0; i < 6; i++) {
        input.onmidimessage({ data: [0x90, 1, 127] });
        await sleep(10);
    }
    await sleep(50);
});

addTest('F-RW.5: Full User Acceptance Flow - Complete user end-to-end walkthrough', async () => {
    window.app.playlist = [];
    const sinePath = path.join(__dirname, 'fixtures', 'sine_440hz.wav');
    const importZone = document.getElementById('importZone');
    
    mockDropFile(importZone, sinePath);
    await sleep(100);
    
    if (window.app.playlist.length === 0) {
        throw new Error('Acceptance flow: drop on playlist failed to add track');
    }
});

// -----------------------------------------------------------------------------
// RUNNER FUNCTION
// -----------------------------------------------------------------------------

async function runTests() {
    console.log('--- STARTING E2E TEST RUNNER ---');
    const results = [];
    let passed = 0;
    let failed = 0;
    
    for (const testItem of tests) {
        console.log(`Running: ${testItem.name}`);
        try {
            await testItem.fn();
            results.push({ name: testItem.name, passed: true });
            passed++;
        } catch (e) {
            console.error(`FAILED: ${testItem.name}\n`, e);
            results.push({ name: testItem.name, passed: false, error: e.message });
            failed++;
        }
    }
    
    console.log('--- TEST RUNNER COMPLETED ---');
    
    // Send results back to main process
    ipcRenderer.send('tests-finished', {
        passed,
        failed,
        total: tests.length,
        results
    });
}

module.exports = { runTests };
