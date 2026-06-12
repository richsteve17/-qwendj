const { ipcRenderer, webUtils } = require('electron');
// tone is ESM-only (even its UMD build inherits "type": "module"), so we vendor
// the UMD bundle as .cjs to keep it require()-able
const Tone = require('./vendor/Tone.cjs');
const WaveSurfer = require('wavesurfer.js');
const fs = require('fs');
const path = require('path');
const AudioAnalyzer = require('./audio-analyzer');

class MidiMapper {
    constructor(appInstance) {
        this.app = appInstance;
        this.ccMappings = {};
        this.noteMappings = {};
        this.loadMappings();
        this.initMidiAccess();
    }

    loadMappings() {
        // Hercules DJControl MIX hardware layout (per Mixxx mapping):
        // Deck A = MIDI ch 2, Deck B = ch 3, mixer/crossfader = ch 1,
        // pads = ch 7 (deck A) / ch 8 (deck B); pad mode is selected on the
        // hardware and encoded in the note range (hotcue 0-3, sampler 16-19,
        // FX 32-35, loop 48-51).
        const defaultMappings = {
            "version": 2,
            "cc_mappings": {
                "volumeA": { "cc": 0, "channel": 2 },
                "volumeB": { "cc": 0, "channel": 3 },
                "crossfader": { "cc": 0, "channel": 1 },
                "eqA_low": { "cc": 2, "channel": 2 },
                "eqB_low": { "cc": 2, "channel": 3 },
                "pitchA": { "cc": 8, "channel": 2 },
                "pitchB": { "cc": 8, "channel": 3 }
            },
            "note_mappings": {
                "playA": { "note": 7, "channel": 2 },
                "cueA": { "note": 6, "channel": 2 },
                "headphoneCueA": { "note": 12, "channel": 2 },
                "playB": { "note": 7, "channel": 3 },
                "cueB": { "note": 6, "channel": 3 },
                "headphoneCueB": { "note": 12, "channel": 3 },

                "padA1": { "note": 0, "channel": 7 },
                "padA2": { "note": 1, "channel": 7 },
                "padA3": { "note": 2, "channel": 7 },
                "padA4": { "note": 3, "channel": 7 },
                "samplerA1": { "note": 16, "channel": 7 },
                "samplerA2": { "note": 17, "channel": 7 },
                "samplerA3": { "note": 18, "channel": 7 },
                "samplerA4": { "note": 19, "channel": 7 },
                "fxA1": { "note": 32, "channel": 7 },
                "fxA2": { "note": 33, "channel": 7 },
                "fxA3": { "note": 34, "channel": 7 },
                "fxA4": { "note": 35, "channel": 7 },
                "loopA1": { "note": 48, "channel": 7 },
                "loopA2": { "note": 49, "channel": 7 },
                "loopA3": { "note": 50, "channel": 7 },
                "loopA4": { "note": 51, "channel": 7 },

                "padB1": { "note": 0, "channel": 8 },
                "padB2": { "note": 1, "channel": 8 },
                "padB3": { "note": 2, "channel": 8 },
                "padB4": { "note": 3, "channel": 8 },
                "samplerB1": { "note": 16, "channel": 8 },
                "samplerB2": { "note": 17, "channel": 8 },
                "samplerB3": { "note": 18, "channel": 8 },
                "samplerB4": { "note": 19, "channel": 8 },
                "fxB1": { "note": 32, "channel": 8 },
                "fxB2": { "note": 33, "channel": 8 },
                "fxB3": { "note": 34, "channel": 8 },
                "fxB4": { "note": 35, "channel": 8 },
                "loopB1": { "note": 48, "channel": 8 },
                "loopB2": { "note": 49, "channel": 8 },
                "loopB3": { "note": 50, "channel": 8 },
                "loopB4": { "note": 51, "channel": 8 }
            }
        };

        const stored = localStorage.getItem('midi_mappings');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                // Discard mappings saved before the layout was corrected
                if (parsed.version === defaultMappings.version) {
                    this.ccMappings = parsed.cc_mappings || defaultMappings.cc_mappings;
                    this.noteMappings = parsed.note_mappings || defaultMappings.note_mappings;
                    return;
                }
            } catch (e) {
                // fall through to defaults
            }
        }
        this.ccMappings = defaultMappings.cc_mappings;
        this.noteMappings = defaultMappings.note_mappings;
    }

    saveMappings() {
        localStorage.setItem('midi_mappings', JSON.stringify({
            version: 2,
            cc_mappings: this.ccMappings,
            note_mappings: this.noteMappings
        }));
    }

    async initMidiAccess() {
        const badge = document.getElementById('midiBadge');
        const badgeText = document.getElementById('midiBadgeText');
        
        if (!navigator.requestMIDIAccess) {
            console.log('Web MIDI API not supported in this browser.');
            return;
        }

        try {
            const midiAccess = await navigator.requestMIDIAccess({ sysex: true });
            console.log('MIDI access granted. Inputs:', midiAccess.inputs.size);
            this.setupMidiPorts(midiAccess);
            midiAccess.onstatechange = (e) => {
                console.log('MIDI state change:', e.port.name, e.port.state);
                this.setupMidiPorts(midiAccess);
            };
        } catch (error) {
            console.error('Failed to get MIDI access:', error);
            if (badge) badge.className = 'status-badge midi-offline';
            if (badgeText) badgeText.textContent = 'MIDI Offline';
        }
    }

    setupMidiPorts(midiAccess) {
        const badge = document.getElementById('midiBadge');
        const badgeText = document.getElementById('midiBadgeText');
        
        const inputs = Array.from(midiAccess.inputs.values());
        if (inputs.length > 0) {
            if (badge) badge.className = 'status-badge midi-online';
            if (badgeText) badgeText.textContent = 'MIDI Online';
            
            inputs.forEach(input => {
                input.onmidimessage = (event) => this.handleMidiMessage(event);
            });
        } else {
            if (badge) badge.className = 'status-badge midi-offline';
            if (badgeText) badgeText.textContent = 'MIDI Offline';
        }
    }

    handleMidiMessage(event) {
        const [status, d1, d2] = event.data;
        const msgType = status & 0xF0;
        const channel = (status & 0x0F) + 1;

        // CC Messages
        if (msgType === 0xB0) {
            const cc = d1;
            const value = d2;
            this.handleCC(cc, value, channel);
        }
        // Note On Messages
        else if (msgType === 0x90 && d2 > 0) {
            const note = d1;
            this.handleNote(note, channel);
        }
    }

    handleCC(cc, value, channel) {
        for (const [control, mapping] of Object.entries(this.ccMappings)) {
            if (mapping.cc === cc && mapping.channel === channel) {
                this.applyCCValue(control, value);
            }
        }
    }

    handleNote(note, channel) {
        for (const [control, mapping] of Object.entries(this.noteMappings)) {
            if (mapping.note === note && mapping.channel === channel) {
                this.applyNoteAction(control);
            }
        }
    }

    applyCCValue(control, value) {
        if (value < 0 || value > 127) return;

        const slider = document.getElementById(control);
        if (slider) {
            slider.value = this.scaleCCValue(control, value);
            slider.dispatchEvent(new Event('input'));
        }
    }

    scaleCCValue(control, value) {
        if (control.includes('eq')) {
            if (value === 0) return -24; // Handled by EventListener for Full Kill
            return (value / 127) * 30 - 24;
        } else if (control.includes('volume')) {
            return value / 127;
        } else if (control === 'crossfader') {
            return (value / 127) * 2 - 1;
        } else if (control.includes('pitch')) {
            return (value / 127) * 16 - 8;
        }
        return value;
    }

    applyNoteAction(control) {
        // Handle Deck A
        if (control === 'playA') this.app.togglePlay('A');
        if (control === 'cueA') this.app.setCuePoint('A');
        if (control === 'headphoneCueA') this.app.toggleCue('A');
        
        // Handle Deck B
        if (control === 'playB') this.app.togglePlay('B');
        if (control === 'cueB') this.app.setCuePoint('B');
        if (control === 'headphoneCueB') this.app.toggleCue('B');

        // Pads: the hardware mode selector changes which note range the pads
        // send, so the mode is implied by the mapping name
        const padMatch = control.match(/^(pad|loop|fx|sampler)([AB])(\d)$/);
        if (padMatch) {
            const modeForKind = { pad: 'HOT CUE', loop: 'LOOP', fx: 'FX', sampler: 'SAMPLER' };
            const deck = padMatch[2];
            this.app.setPadMode(deck, modeForKind[padMatch[1]]);
            this.app.handlePad(deck, parseInt(padMatch[3]));
        }
    }
}

class DJTrainerApp {
    constructor() {
        this.playlist = [];
        this.deckA = null;
        this.deckB = null;
        this.coachMode = false;
        
        // Track current playback positions in seconds
        this.positionA = 0;
        this.positionB = 0;
        this.startTimeA = 0;
        this.startTimeB = 0;
        
        this.recording = false;
        this.coachInterval = null;
        
        this.initDecks();
        this.bindEvents();
        
        this.midiMapper = new MidiMapper(this);
        this.initMidiUI();
        this.initRecording();
        this.initDashboard();
        this.initAutoSort();
        
        this.startVUMetersLoop();
    }

    initDecks() {
        // Initialize WaveSurfer instances for visualizations
        this.waveformA = WaveSurfer.create({
            container: '#waveformA',
            waveColor: '#00f0ff',
            progressColor: '#0066aa',
            height: 100,
            barWidth: 2,
            interact: true
        });

        this.waveformB = WaveSurfer.create({
            container: '#waveformB',
            waveColor: '#ff007f',
            progressColor: '#99004d',
            height: 100,
            barWidth: 2,
            interact: true
        });

        // Initialize Tone.js players
        this.playerA = new Tone.Player();
        this.playerB = new Tone.Player();
        
        // Allow looping on players
        this.playerA.loop = false;
        this.playerB.loop = false;

        // Initialize EQs
        this.eqA = new Tone.EQ3(0, 0, 0);
        this.eqB = new Tone.EQ3(0, 0, 0);

        // Initialize Channels/Volumes
        this.volumeNodeA = new Tone.Volume(0); // in decibels
        this.volumeNodeB = new Tone.Volume(0);

        // Initialize VU Meters
        this.meterA = new Tone.Meter();
        this.meterB = new Tone.Meter();

        // Initialize Crossfader Node
        this.crossfadeNode = new Tone.CrossFade(0.5); // 0 = fully A, 1 = fully B

        // Audio Routing: Main Output
        this.playerA.connect(this.eqA);
        this.eqA.connect(this.volumeNodeA);
        this.volumeNodeA.connect(this.meterA);
        this.volumeNodeA.connect(this.crossfadeNode.a);

        this.playerB.connect(this.eqB);
        this.eqB.connect(this.volumeNodeB);
        this.volumeNodeB.connect(this.meterB);
        this.volumeNodeB.connect(this.crossfadeNode.b);

        this.crossfadeNode.toDestination();

        // Audio Routing: Headphone Cue
        this.cueVolumeA = new Tone.Volume(-Infinity);
        this.cueVolumeB = new Tone.Volume(-Infinity);
        
        this.eqA.connect(this.cueVolumeA);
        this.eqB.connect(this.cueVolumeB);

        this.cueDestination = Tone.getContext().createMediaStreamDestination();
        this.cueVolumeA.connect(this.cueDestination);
        this.cueVolumeB.connect(this.cueDestination);

        // Attach to hidden audio element for SinkId routing
        const cueAudioEl = document.getElementById('cueAudioElement');
        if (cueAudioEl) {
            cueAudioEl.srcObject = this.cueDestination.stream;
        }

        // Set initial volumes based on default slider values (0.8)
        this.volumeNodeA.volume.value = Tone.gainToDb(0.8);
        this.volumeNodeB.volume.value = Tone.gainToDb(0.8);

        // Cue point storage
        this.cuePoints = {
            deckA: { main: 0, hotCues: [null, null, null, null] },
            deckB: { main: 0, hotCues: [null, null, null, null] }
        };
    }

    bindEvents() {
        const activateAudio = async () => {
            if (Tone.context.state !== 'running') {
                await Tone.start();
                console.log('Audio Context Running');
            }
        };
        document.body.addEventListener('click', activateAudio, { once: true });

        document.getElementById('playA').addEventListener('click', () => this.togglePlay('A'));
        document.getElementById('cueA').addEventListener('click', () => this.setCuePoint('A'));
        document.getElementById('playB').addEventListener('click', () => this.togglePlay('B'));
        document.getElementById('cueB').addEventListener('click', () => this.setCuePoint('B'));

        document.getElementById('audioSettingsBtn').addEventListener('click', () => {
            this.populateAudioDevices();
            document.getElementById('audioModal').style.display = 'flex';
        });
        document.getElementById('closeAudioBtn').addEventListener('click', () => {
            document.getElementById('audioModal').style.display = 'none';
        });
        
        document.getElementById('mainOutputSelect').addEventListener('change', async (e) => {
            const deviceId = e.target.value;
            if (Tone.getContext().rawContext.setSinkId) {
                await Tone.getContext().rawContext.setSinkId(deviceId);
            }
        });
        
        document.getElementById('cueOutputSelect').addEventListener('change', async (e) => {
            const deviceId = e.target.value;
            const cueAudioEl = document.getElementById('cueAudioElement');
            if (cueAudioEl && cueAudioEl.setSinkId) {
                await cueAudioEl.setSinkId(deviceId);
            }
        });

        document.getElementById('headphoneCueA').addEventListener('click', () => this.toggleCue('A'));
        document.getElementById('headphoneCueB').addEventListener('click', () => this.toggleCue('B'));

        // Pad Mode Tracking
        this.padModeA = 'HOT CUE';
        this.padModeB = 'HOT CUE';

        for (let i = 1; i <= 4; i++) {
            document.getElementById(`padA${i}`).addEventListener('click', () => this.handlePad('A', i));
        }

        for (let i = 1; i <= 4; i++) {
            document.getElementById(`padB${i}`).addEventListener('click', () => this.handlePad('B', i));
        }

        document.getElementById('eqA_high').addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.eqA.high.value = val === -24 ? -60 : val; // Full kill Isolator
        });
        document.getElementById('eqA_mid').addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.eqA.mid.value = val === -24 ? -60 : val;
        });
        document.getElementById('eqA_low').addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.eqA.low.value = val === -24 ? -60 : val;
        });

        document.getElementById('eqB_high').addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.eqB.high.value = val === -24 ? -60 : val;
        });
        document.getElementById('eqB_mid').addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.eqB.mid.value = val === -24 ? -60 : val;
        });
        document.getElementById('eqB_low').addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.eqB.low.value = val === -24 ? -60 : val;
        });

        document.getElementById('volumeA').addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.volumeNodeA.volume.value = Tone.gainToDb(val);
        });
        document.getElementById('volumeB').addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.volumeNodeB.volume.value = Tone.gainToDb(val);
        });

        document.getElementById('crossfader').addEventListener('input', (e) => {
            const val = parseFloat(e.target.value); // -1 to 1
            const fade = (val + 1) / 2; // Map to 0 to 1
            this.crossfadeNode.fade.value = fade;
        });

        document.getElementById('pitchA').addEventListener('input', (e) => {
            const val = parseFloat(e.target.value); // -8 to 8
            const rate = 1 + (val / 100);
            this.playerA.playbackRate = rate;
            this.updateTempoDisplay('A');
        });
        document.getElementById('pitchB').addEventListener('input', (e) => {
            const val = parseFloat(e.target.value); // -8 to 8
            const rate = 1 + (val / 100);
            this.playerB.playbackRate = rate;
            this.updateTempoDisplay('B');
        });

        const panelA = document.getElementById('deckPanelA');
        panelA.addEventListener('dragover', (e) => { e.preventDefault(); panelA.style.borderColor = 'var(--deck-a-color)'; });
        panelA.addEventListener('dragleave', () => { panelA.style.borderColor = 'var(--panel-border)'; });
        panelA.addEventListener('drop', (e) => {
            panelA.style.borderColor = 'var(--panel-border)';
            this.handleFileDrop(e, 'A');
        });

        const panelB = document.getElementById('deckPanelB');
        panelB.addEventListener('dragover', (e) => { e.preventDefault(); panelB.style.borderColor = 'var(--deck-b-color)'; });
        panelB.addEventListener('dragleave', () => { panelB.style.borderColor = 'var(--panel-border)'; });
        panelB.addEventListener('drop', (e) => {
            panelB.style.borderColor = 'var(--panel-border)';
            this.handleFileDrop(e, 'B');
        });

        const importZone = document.getElementById('importZone');
        importZone.addEventListener('dragover', (e) => e.preventDefault());
        importZone.addEventListener('drop', (e) => this.handlePlaylistDrop(e));

        document.getElementById('startCoach').addEventListener('click', () => this.toggleCoachMode());
    }

    getDroppedFilePath(file) {
        // Real File objects lost .path in Electron 32; test mocks still provide it
        if (file.path) return file.path;
        return webUtils.getPathForFile(file);
    }

    async handleFileDrop(event, deckId) {
        event.preventDefault();
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) {
            const file = files[0];
            if (!file.name.endsWith('.wav') && !file.name.endsWith('.mp3') && !file.name.endsWith('.m4a')) {
                alert('Invalid file format. Please drop a valid audio WAV/MP3 file.');
                return;
            }
            const trackData = await ipcRenderer.invoke('load-track', this.getDroppedFilePath(file));
            this.loadTrackToDeck(trackData, deckId);
        }
    }

    async handlePlaylistDrop(event) {
        event.preventDefault();
        const files = Array.from(event.dataTransfer.files);
        let validFileFound = false;
        for (const file of files) {
            if (file.name.endsWith('.wav') || file.name.endsWith('.mp3') || file.name.endsWith('.m4a')) {
                validFileFound = true;
                const trackData = await ipcRenderer.invoke('load-track', this.getDroppedFilePath(file));
                if (trackData) {
                    this.addTrackToPlaylist(trackData);
                }
            }
        }
        if (!validFileFound && files.length > 0) {
            alert('Invalid file format. Please drop valid audio WAV/MP3 files.');
        }
    }

    addTrackToPlaylist(trackData) {
        this.playlist.push(trackData);
        this.updatePlaylistUI();
    }

    updatePlaylistUI() {
        const listContainer = document.getElementById('playlist');
        listContainer.innerHTML = '';
        document.getElementById('playlistCount').textContent = `${this.playlist.length} Songs`;

        this.playlist.forEach((track, index) => {
            const item = document.createElement('div');
            item.className = 'track-row';
            
            const min = Math.floor(track.duration / 60);
            const sec = Math.floor(track.duration % 60).toString().padStart(2, '0');

            item.innerHTML = `
                <div style="color:var(--text-muted);">${index + 1}</div>
                <div style="font-weight:600; color:#fff; display:flex; justify-content:space-between; align-items:center;">
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${track.title}</span>
                    <span class="load-btns" style="display:flex; gap:4px; opacity:0.8;">
                        <button class="btn-top" style="padding:2px 6px; font-size:9px;" onclick="window.app.loadTrackToDeckIndex(${index}, 'A')">A</button>
                        <button class="btn-top" style="padding:2px 6px; font-size:9px;" onclick="window.app.loadTrackToDeckIndex(${index}, 'B')">B</button>
                    </span>
                </div>
                <div style="color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${track.artist}</div>
                <div style="color:var(--text-muted);">${min}:${sec}</div>
                <div style="color:var(--text-muted);">${track.bpm} <span style="font-size:10px; margin-left:4px;">${track.key}</span></div>
            `;
            listContainer.appendChild(item);
        });
    }

    loadTrackToDeckIndex(index, deckId) {
        if (index >= 0 && index < this.playlist.length) {
            this.loadTrackToDeck(this.playlist[index], deckId);
        }
    }

    async loadTrackToDeck(trackData, deckId) {
        if (!trackData) return;

        const player = deckId === 'A' ? this.playerA : this.playerB;
        const waveform = deckId === 'A' ? this.waveformA : this.waveformB;
        const titleElement = document.getElementById(`trackInfo${deckId}`);
        const artistElement = document.getElementById(`artistInfo${deckId}`);

        if (deckId === 'A') {
            this.deckA = trackData;
            this.positionA = 0;
        } else {
            this.deckB = trackData;
            this.positionB = 0;
        }

        const fileUrl = `file://${trackData.path}`;
        await player.load(fileUrl);
        waveform.load(fileUrl);

        titleElement.textContent = trackData.title;
        artistElement.textContent = `${trackData.artist} • ${trackData.key}`;
        
        this.updateTempoDisplay(deckId);

        console.log(`Loaded track to deck ${deckId}:`, trackData);

        // Non-blocking asynchronous decoding and analysis (F1.2, F1.3, F1.4, F1.5, F1.B4)
        setTimeout(async () => {
            try {
                const fileData = fs.readFileSync(trackData.path);
                const arrayBuffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength);
                
                const audioContext = Tone.getContext().rawContext;
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                
                const analyzer = new AudioAnalyzer();
                const bpmVal = analyzer.detectBPM(audioBuffer);
                const keyValObj = analyzer.detectKey(audioBuffer);
                
                trackData.bpm = bpmVal;
                trackData.key = `${keyValObj.key} ${keyValObj.scale}`;
                
                artistElement.textContent = `${trackData.artist} • ${trackData.key}`;
                this.updateTempoDisplay(deckId);
                
                console.log(`Analyzed track asynchronously. Detected BPM: ${bpmVal}, Key: ${trackData.key}`);
            } catch (err) {
                console.error("Non-blocking decoding/analysis failed:", err);
            }
        }, 0);
    }

    updateTempoDisplay(deckId) {
        const track = deckId === 'A' ? this.deckA : this.deckB;
        const player = deckId === 'A' ? this.playerA : this.playerB;
        const display = document.getElementById(`tempo${deckId}`);
        
        if (!track) return;

        const currentBpm = (track.bpm * player.playbackRate).toFixed(1);
        const pitchPercent = ((player.playbackRate - 1) * 100).toFixed(2);
        display.textContent = `BPM: ${currentBpm} (${pitchPercent >= 0 ? '+' : ''}${pitchPercent}%)`;
    }

    async populateAudioDevices() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            console.log("enumerateDevices() not supported.");
            return;
        }
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true }); // Request permissions if needed
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioOutputs = devices.filter(device => device.kind === 'audiooutput');
            
            const mainSelect = document.getElementById('mainOutputSelect');
            const cueSelect = document.getElementById('cueOutputSelect');
            
            mainSelect.innerHTML = '';
            cueSelect.innerHTML = '';
            
            audioOutputs.forEach(device => {
                const optMain = document.createElement('option');
                optMain.value = device.deviceId;
                optMain.text = device.label || `Device ${device.deviceId}`;
                mainSelect.appendChild(optMain);
                
                const optCue = document.createElement('option');
                optCue.value = device.deviceId;
                optCue.text = device.label || `Device ${device.deviceId}`;
                cueSelect.appendChild(optCue);
            });
        } catch (err) {
            console.error(err.name + ": " + err.message);
        }
    }

    toggleCue(deckId) {
        const btn = document.getElementById(`headphoneCue${deckId}`);
        const cueVolume = deckId === 'A' ? this.cueVolumeA : this.cueVolumeB;
        
        if (btn.style.background === 'var(--deck-a-color)' || btn.style.background === 'var(--deck-b-color)') {
            // Disable cue
            btn.style.background = '#111';
            cueVolume.volume.value = -Infinity;
        } else {
            // Enable cue
            btn.style.background = deckId === 'A' ? 'var(--deck-a-color)' : 'var(--deck-b-color)';
            cueVolume.volume.value = Tone.gainToDb(0.8);
        }
    }

    setPadMode(deckId, mode) {
        if (deckId === 'A') {
            this.padModeA = mode;
            document.getElementById('padModeA').textContent = mode;
        } else {
            this.padModeB = mode;
            document.getElementById('padModeB').textContent = mode;
        }
    }

    handlePad(deckId, padNum) {
        const mode = deckId === 'A' ? this.padModeA : this.padModeB;
        console.log(`Deck ${deckId} Pad ${padNum} pressed in ${mode} mode`);
        
        if (mode === 'HOT CUE') {
            this.triggerHotCue(deckId, padNum - 1);
        } else if (mode === 'LOOP') {
            // Simulated Auto Loop lengths: 1/16, 1/8, 1/4, 1/2
            const loopLengths = ['16n', '8n', '4n', '2n'];
            const player = deckId === 'A' ? this.playerA : this.playerB;
            player.loop = !player.loop; // Toggle loop
            if (player.loop) {
                // In a real app we'd set loopStart and loopEnd based on current time
                console.log(`Enabled ${loopLengths[padNum-1]} loop on Deck ${deckId}`);
            } else {
                console.log(`Disabled loop on Deck ${deckId}`);
            }
        } else if (mode === 'FX') {
            console.log(`Triggered Instant FX ${padNum} on Deck ${deckId}`);
        } else if (mode === 'SAMPLER') {
            console.log(`Triggered Sampler ${padNum} on Deck ${deckId}`);
        }
    }

    togglePlay(deckId) {
        const player = deckId === 'A' ? this.playerA : this.playerB;
        const playBtn = document.getElementById(`play${deckId}`);

        if (!player.loaded) {
            console.log(`Deck ${deckId}: no track loaded, ignoring play`);
            return;
        }

        if (player.state === 'started') {
            player.stop();
            playBtn.classList.remove('active');
            playBtn.textContent = '▶ PLAY';
            
            if (deckId === 'A') {
                this.positionA = Tone.now() - this.startTimeA;
            } else {
                this.positionB = Tone.now() - this.startTimeB;
            }
        } else {
            if (deckId === 'A') {
                this.startTimeA = Tone.now() - this.positionA;
                player.start(0, this.positionA);
            } else {
                this.startTimeB = Tone.now() - this.positionB;
                player.start(0, this.positionB);
            }
            playBtn.classList.add('active');
            playBtn.textContent = '⏸ PAUSE';
        }
    }

    setCuePoint(deckId) {
        const player = deckId === 'A' ? this.playerA : this.playerB;
        const elapsed = deckId === 'A' ? 
            (player.state === 'started' ? Tone.now() - this.startTimeA : this.positionA) :
            (player.state === 'started' ? Tone.now() - this.startTimeB : this.positionB);
            
        this.cuePoints[`deck${deckId}`].main = elapsed;
        console.log(`Set Cue Point on Deck ${deckId} at ${elapsed.toFixed(2)}s`);
        
        const cueBtn = document.getElementById(`cue${deckId}`);
        cueBtn.classList.add('active');
        setTimeout(() => cueBtn.classList.remove('active'), 250);
        
        if (player.state === 'started') {
            player.stop();
            if (deckId === 'A') {
                this.positionA = elapsed;
                this.startTimeA = Tone.now() - this.positionA;
                player.start(0, this.positionA);
            } else {
                this.positionB = elapsed;
                this.startTimeB = Tone.now() - this.positionB;
                player.start(0, this.positionB);
            }
        } else {
            if (deckId === 'A') {
                this.positionA = elapsed;
            } else {
                this.positionB = elapsed;
            }
        }
    }

    triggerHotCue(deckId, cueIndex) {
        const player = deckId === 'A' ? this.playerA : this.playerB;
        const currentElapsed = deckId === 'A' ? 
            (player.state === 'started' ? Tone.now() - this.startTimeA : this.positionA) :
            (player.state === 'started' ? Tone.now() - this.startTimeB : this.positionB);

        if (this.cuePoints[`deck${deckId}`].hotCues[cueIndex] === null) {
            this.cuePoints[`deck${deckId}`].hotCues[cueIndex] = currentElapsed;
            document.getElementById(`hotCue${deckId}${cueIndex + 1}`).classList.add('active');
            console.log(`Set Hot Cue ${cueIndex + 1} on Deck ${deckId} at ${currentElapsed.toFixed(2)}s`);
        } else {
            const cueTime = this.cuePoints[`deck${deckId}`].hotCues[cueIndex];
            if (deckId === 'A') {
                this.positionA = cueTime;
                if (player.state === 'started') {
                    player.stop();
                    this.startTimeA = Tone.now() - this.positionA;
                    player.start(0, this.positionA);
                }
            } else {
                this.positionB = cueTime;
                if (player.state === 'started') {
                    player.stop();
                    this.startTimeB = Tone.now() - this.positionB;
                    player.start(0, this.positionB);
                }
            }
        }
    }

    toggleCoachMode() {
        const coachBtn = document.getElementById('startCoach');
        if (this.coachMode) {
            this.coachMode = false;
            coachBtn.classList.remove('active');
            coachBtn.textContent = 'Coach Mode Offline';
            document.getElementById('coachTipText').textContent = 'Enable Transition Coach Mode to get real-time mixing feedback and suggestions for your set.';
        } else {
            this.coachMode = true;
            coachBtn.classList.add('active');
            coachBtn.textContent = 'Coach Mode Active';
            document.getElementById('coachTipText').textContent = 'Live evaluation running. Match BPM, line up phrases, and balance volume faders!';
            this.runCoachAnalysis();
        }
    }

    startVUMetersLoop() {
        const update = () => {
            if (this.meterA && this.meterB) {
                const valA = this.meterA.getValue();
                const valB = this.meterB.getValue();
                
                const levelA = Math.min(100, Math.max(0, ((valA + 50) / 50) * 100));
                const levelB = Math.min(100, Math.max(0, ((valB + 50) / 50) * 100));
                
                const heightA = this.playerA.state === 'started' ? levelA : 0;
                const heightB = this.playerB.state === 'started' ? levelB : 0;
                
                document.getElementById('vuA').style.height = `${heightA}%`;
                document.getElementById('vuB').style.height = `${heightB}%`;
            }

            if (this.playerA.state === 'started') {
                const current = Tone.now() - this.startTimeA;
                document.getElementById('timeA').textContent = this.formatTime(current);
            } else {
                document.getElementById('timeA').textContent = this.formatTime(this.positionA);
            }

            if (this.playerB.state === 'started') {
                const current = Tone.now() - this.startTimeB;
                document.getElementById('timeB').textContent = this.formatTime(current);
            } else {
                document.getElementById('timeB').textContent = this.formatTime(this.positionB);
            }

            requestAnimationFrame(update);
        };
        requestAnimationFrame(update);
    }

    formatTime(seconds) {
        if (isNaN(seconds) || seconds < 0) return '00:00.00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        const c = Math.floor((seconds % 1) * 100);
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${c.toString().padStart(2, '0')}`;
    }

    initMidiUI() {
        const midiSettingsBtn = document.getElementById('midiSettingsBtn');
        const closeMidiBtn = document.getElementById('closeMidiBtn');
        const resetMidiBtn = document.getElementById('resetMidiBtn');
        const midiModal = document.getElementById('midiModal');
        const midiModalWarning = document.getElementById('midiModalWarning');

        if (midiSettingsBtn) {
            midiSettingsBtn.addEventListener('click', () => {
                this.renderMidiMappings();
                midiModal.style.display = 'flex';
            });
        }

        if (closeMidiBtn) {
            closeMidiBtn.addEventListener('click', () => {
                midiModal.style.display = 'none';
            });
        }

        if (resetMidiBtn) {
            resetMidiBtn.addEventListener('click', () => {
                localStorage.removeItem('midi_mappings');
                this.midiMapper.loadMappings();
                this.renderMidiMappings();
                midiModalWarning.style.display = 'none';
                console.log('MIDI mappings reset to default Hercules profile.');
            });
        }
    }

    renderMidiMappings() {
        const list = document.getElementById('midiMappingList');
        const warning = document.getElementById('midiModalWarning');
        if (!list) return;
        list.innerHTML = '';
        
        const checkCollisions = () => {
            const ccMap = {};
            const noteMap = {};
            let collision = false;

            const ccInputs = list.querySelectorAll('.cc-input');
            ccInputs.forEach(input => {
                const control = input.dataset.control;
                const cc = parseInt(input.value);
                const channel = parseInt(list.querySelector(`.cc-chan[data-control="${control}"]`).value);
                
                const key = `${channel}:${cc}`;
                if (ccMap[key]) {
                    collision = true;
                }
                ccMap[key] = control;
            });

            const noteInputs = list.querySelectorAll('.note-input');
            noteInputs.forEach(input => {
                const control = input.dataset.control;
                const note = parseInt(input.value);
                const channel = parseInt(list.querySelector(`.note-chan[data-control="${control}"]`).value);
                
                const key = `${channel}:${note}`;
                if (noteMap[key]) {
                    collision = true;
                }
                noteMap[key] = control;
            });

            if (collision) {
                if (warning) warning.style.display = 'block';
            } else {
                if (warning) warning.style.display = 'none';
                // Save mappings
                ccInputs.forEach(input => {
                    const control = input.dataset.control;
                    this.midiMapper.ccMappings[control].cc = parseInt(input.value);
                });
                list.querySelectorAll('.cc-chan').forEach(input => {
                    const control = input.dataset.control;
                    this.midiMapper.ccMappings[control].channel = parseInt(input.value);
                });
                noteInputs.forEach(input => {
                    const control = input.dataset.control;
                    this.midiMapper.noteMappings[control].note = parseInt(input.value);
                });
                list.querySelectorAll('.note-chan').forEach(input => {
                    const control = input.dataset.control;
                    this.midiMapper.noteMappings[control].channel = parseInt(input.value);
                });
                this.midiMapper.saveMappings();
            }
        };

        // Render CCs
        const ccHeader = document.createElement('h3');
        ccHeader.textContent = 'CC Controls (Faders & EQ)';
        ccHeader.style.margin = '10px 0 5px 0';
        list.appendChild(ccHeader);

        for (const [control, mapping] of Object.entries(this.midiMapper.ccMappings)) {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.alignItems = 'center';
            row.style.marginBottom = '6px';
            
            row.innerHTML = `
                <span>${control}</span>
                <div style="display: flex; gap: 5px;">
                    <label style="font-size:10px;">Ch: <input type="number" class="cc-chan" data-control="${control}" value="${mapping.channel}" min="1" max="16" style="width: 40px; background:#1e293b; color:#fff; border:1px solid #475569; padding:2px; border-radius:4px;"></label>
                    <label style="font-size:10px;">CC: <input type="number" class="cc-input" data-control="${control}" value="${mapping.cc}" min="0" max="127" style="width: 50px; background:#1e293b; color:#fff; border:1px solid #475569; padding:2px; border-radius:4px;"></label>
                </div>
            `;
            list.appendChild(row);
        }

        // Render Notes
        const noteHeader = document.createElement('h3');
        noteHeader.textContent = 'Note Controls (Play & Cue)';
        noteHeader.style.margin = '15px 0 5px 0';
        list.appendChild(noteHeader);

        for (const [control, mapping] of Object.entries(this.midiMapper.noteMappings)) {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.alignItems = 'center';
            row.style.marginBottom = '6px';
            
            row.innerHTML = `
                <span>${control}</span>
                <div style="display: flex; gap: 5px;">
                    <label style="font-size:10px;">Ch: <input type="number" class="note-chan" data-control="${control}" value="${mapping.channel}" min="1" max="16" style="width: 40px; background:#1e293b; color:#fff; border:1px solid #475569; padding:2px; border-radius:4px;"></label>
                    <label style="font-size:10px;">Note: <input type="number" class="note-input" data-control="${control}" value="${mapping.note}" min="0" max="127" style="width: 50px; background:#1e293b; color:#fff; border:1px solid #475569; padding:2px; border-radius:4px;"></label>
                </div>
            `;
            list.appendChild(row);
        }

        list.querySelectorAll('input').forEach(input => {
            input.addEventListener('input', checkCollisions);
        });
    }

    initRecording() {
        const recordBtn = document.getElementById('recordBtn');
        if (!recordBtn) return;
        
        try {
            this.recorder = new Tone.Recorder();
            Tone.Destination.connect(this.recorder);
        } catch (e) {
            console.error('Failed to init Tone.Recorder:', e);
        }

        recordBtn.addEventListener('click', async () => {
            if (!this.recording) {
                try {
                    await this.recorder.start();
                    this.recording = true;
                    recordBtn.textContent = '⏹ Stop Rec';
                    recordBtn.style.background = 'rgba(239, 68, 68, 0.4)';
                    console.log('Master recording started.');
                } catch (err) {
                    console.error('Failed to start recording:', err);
                }
            } else {
                try {
                    const recordingBlob = await this.recorder.stop();
                    this.recording = false;
                    recordBtn.textContent = '● Record Set';
                    recordBtn.style.background = 'rgba(239, 68, 68, 0.1)';
                    
                    const arrayBuffer = await recordingBlob.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    const recordingPath = path.join(__dirname, 'recorded_mix.wav');
                    
                    if (window.simulateOutOfDiskSpace) {
                        throw new Error("No space left on device");
                    }
                    
                    fs.writeFileSync(recordingPath, buffer);
                    console.log(`Saved recorded mix to: ${recordingPath}`);
                    this.lastRecordingPath = recordingPath;
                } catch (err) {
                    console.error('Failed to save recording:', err);
                    alert('Recording failed: ' + err.message);
                }
            }
        });
    }

    initDashboard() {
        const dashboardBtn = document.getElementById('dashboardBtn');
        const closeDashboardBtn = document.getElementById('closeDashboardBtn');
        const dashboardModal = document.getElementById('dashboardModal');

        if (dashboardBtn) {
            dashboardBtn.addEventListener('click', () => {
                this.renderDashboard();
                dashboardModal.style.display = 'flex';
            });
        }

        if (closeDashboardBtn) {
            closeDashboardBtn.addEventListener('click', () => {
                dashboardModal.style.display = 'none';
            });
        }

        window.addEventListener('resize', () => {
            if (dashboardModal && dashboardModal.style.display === 'flex') {
                this.renderDashboard();
            }
        });
    }

    renderDashboard() {
        const canvas = document.getElementById('dashboardCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.parentElement.clientHeight;
        
        const history = this.transitionAnalyzer.mixHistory;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        for (let i = 50; i < canvas.height; i += 50) {
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(canvas.width, i);
            ctx.stroke();
        }
        for (let i = 100; i < canvas.width; i += 100) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, canvas.height);
            ctx.stroke();
        }

        if (history.length === 0) {
            ctx.fillStyle = '#9ca3af';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No transitions recorded yet. Mix some tracks with Coach Mode active!', canvas.width / 2, canvas.height / 2);
            
            document.getElementById('avgTiming').textContent = '--%';
            document.getElementById('avgHarmony').textContent = '--%';
            document.getElementById('totalTransitions').textContent = '0';
            document.getElementById('transitionLog').innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:10px;">Log is empty.</div>';
            return;
        }

        const margin = 30;
        const graphWidth = canvas.width - margin * 2;
        const graphHeight = canvas.height - margin * 2;
        
        const drawLine = (metricName, color) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            
            history.forEach((entry, index) => {
                const x = margin + (index / Math.max(1, history.length - 1)) * graphWidth;
                const value = entry.analysis[metricName];
                const y = canvas.height - (margin + value * graphHeight);
                
                if (index === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
                
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(x, y, 4, 0, Math.PI * 2);
                ctx.fill();
            });
            
            ctx.stroke();
        };

        drawLine('timingAccuracy', '#00f0ff');
        drawLine('volumeBalance', '#39ff14');
        drawLine('transitionQuality', '#ff007f');

        let totalTiming = 0;
        let totalHarmony = 0;
        history.forEach(entry => {
            totalTiming += entry.analysis.timingAccuracy;
            totalHarmony += entry.analysis.harmonicCompatibility;
        });

        const avgTimingVal = (totalTiming / history.length * 100).toFixed(0);
        const avgHarmonyVal = (totalHarmony / history.length * 100).toFixed(0);
        
        document.getElementById('avgTiming').textContent = `${avgTimingVal}%`;
        document.getElementById('avgHarmony').textContent = `${avgHarmonyVal}%`;
        document.getElementById('totalTransitions').textContent = history.length.toString();

        const logList = document.getElementById('transitionLog');
        logList.innerHTML = '';
        
        history.forEach((entry, index) => {
            const item = document.createElement('div');
            item.style.background = 'rgba(255, 255, 255, 0.02)';
            item.style.padding = '8px 12px';
            item.style.borderRadius = '4px';
            item.style.border = '1px solid rgba(255, 255, 255, 0.05)';
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            
            const dateStr = new Date(entry.timestamp).toLocaleTimeString();
            item.innerHTML = `
                <span><strong>Transition #${index + 1}</strong> (${dateStr})</span>
                <span>Timing: ${(entry.analysis.timingAccuracy*100).toFixed(0)}% | Harmony: ${(entry.analysis.harmonicCompatibility*100).toFixed(0)}% | Volume: ${(entry.analysis.volumeBalance*100).toFixed(0)}% | Score: ${(entry.analysis.transitionQuality*100).toFixed(0)}%</span>
            `;
            logList.appendChild(item);
        });
    }

    initAutoSort() {
        const autoSortBtn = document.getElementById('autoSortBtn');
        if (autoSortBtn) {
            autoSortBtn.addEventListener('click', () => {
                this.autoSortPlaylist();
            });
        }
    }

    autoSortPlaylist() {
        if (this.playlist.length === 0) {
            console.log('Playlist is empty, nothing to sort.');
            return;
        }
        
        if (this.playlist.length === 1) {
            console.log('Playlist contains only one track, sorting not needed.');
            return;
        }

        const t0 = performance.now();

        const keyToCamelot = (key, scale) => {
            if (!key) return '8A';
            const k = key.trim().replace(' minor', '').replace(' major', '').replace('m', '');
            
            if (/^\d{1,2}[AB]$/.test(k)) {
                return k;
            }

            const map = {
                'C': { 'major': '8B', 'minor': '5A' },
                'C#': { 'major': '3B', 'minor': '12A' },
                'Db': { 'major': '3B', 'minor': '12A' },
                'D': { 'major': '10B', 'minor': '7A' },
                'Eb': { 'major': '5B', 'minor': '2A' },
                'E': { 'major': '12B', 'minor': '9A' },
                'F': { 'major': '7B', 'minor': '4A' },
                'F#': { 'major': '2B', 'minor': '11A' },
                'Gb': { 'major': '2B', 'minor': '11A' },
                'G': { 'major': '9B', 'minor': '6A' },
                'Ab': { 'major': '4B', 'minor': '1A' },
                'A': { 'major': '11B', 'minor': '8A' },
                'Bb': { 'major': '6B', 'minor': '3A' },
                'B': { 'major': '1B', 'minor': '10A' }
            };

            const sc = scale ? scale.toLowerCase() : 'minor';
            if (map[k]) {
                return map[k][sc] || map[k]['minor'];
            }
            return '8A';
        };

        const isCamelotCompatible = (cam1, cam2) => {
            if (cam1 === cam2) return true;
            const num1 = parseInt(cam1.slice(0, -1));
            const letter1 = cam1.slice(-1);
            const num2 = parseInt(cam2.slice(0, -1));
            const letter2 = cam2.slice(-1);

            if (num1 === num2 && letter1 !== letter2) return true;

            if (letter1 === letter2) {
                const diff = Math.abs(num1 - num2);
                if (diff === 1 || diff === 11) return true;
            }

            return false;
        };

        const remaining = [...this.playlist];
        const sorted = [];
        
        sorted.push(remaining.shift());
        
        while (remaining.length > 0) {
            const last = sorted[sorted.length - 1];
            const lastCamelot = keyToCamelot(last.key, last.scale || 'minor');
            
            let bestIndex = 0;
            let bestScore = -Infinity;
            
            for (let i = 0; i < remaining.length; i++) {
                const track = remaining[i];
                const trackCamelot = keyToCamelot(track.key, track.scale || 'minor');
                
                const bpmDiff = Math.abs(track.bpm - last.bpm);
                const compatible = isCamelotCompatible(lastCamelot, trackCamelot);
                
                let score = compatible ? 100 : 0;
                score -= bpmDiff * 10;
                
                if (score > bestScore) {
                    bestScore = score;
                    bestIndex = i;
                }
            }
            
            sorted.push(remaining.splice(bestIndex, 1)[0]);
        }

        const t1 = performance.now();
        console.log(`Auto-sorted ${sorted.length} tracks in ${(t1 - t0).toFixed(2)}ms`);

        this.playlist = sorted;
        this.updatePlaylistUI();
    }
}

class TransitionAnalyzer {
    constructor() {
        this.mixHistory = [];
        this.currentAnalysis = null;
    }

    analyzeTransition(deckAState, deckBState) {
        const analysis = {
            timingAccuracy: this.calculateTimingAccuracy(deckAState, deckBState),
            harmonicCompatibility: this.checkHarmonicCompatibility(deckAState, deckBState),
            volumeBalance: this.calculateVolumeBalance(deckAState, deckBState),
            transitionQuality: 0
        };

        analysis.transitionQuality = (
            analysis.timingAccuracy * 0.4 +
            analysis.harmonicCompatibility * 0.3 +
            analysis.volumeBalance * 0.3
        );

        this.mixHistory.push({
            timestamp: Date.now(),
            analysis: analysis
        });

        return analysis;
    }

    calculateTimingAccuracy(deckA, deckB) {
        if (!deckA.playing || !deckB.playing) return 0.0;
        if (!deckA.bpm || !deckB.bpm) return 0.5;
        
        const bpmDiff = Math.abs(deckA.bpm - deckB.bpm);
        const maxAcceptableDiff = 2;
        
        if (bpmDiff <= maxAcceptableDiff) {
            return 1.0;
        } else if (bpmDiff <= maxAcceptableDiff * 2) {
            return 0.7;
        } else {
            return 0.3;
        }
    }

    checkHarmonicCompatibility(deckA, deckB) {
        if (!deckA.playing || !deckB.playing) return 0.0;
        if (!deckA.key || !deckB.key) return 0.5;
        
        const compatibility = this.getHarmonicCompatibility(deckA.key, deckB.key);
        return compatibility;
    }

    getHarmonicCompatibility(key1, key2) {
        if (key1 === key2) return 1.0;
        
        const keyToCamelot = (keyStr) => {
            if (!keyStr) return '8A';
            const k = keyStr.trim().replace(' minor', '').replace(' major', '').replace('m', '');
            if (/^\d{1,2}[AB]$/.test(k)) return k;
            
            const map = {
                'C': '8B', 'C#': '3B', 'Db': '3B', 'D': '10B', 'Eb': '5B', 'E': '12B',
                'F': '7B', 'F#': '2B', 'Gb': '2B', 'G': '9B', 'Ab': '4B', 'A': '11B', 'Bb': '6B', 'B': '1B'
            };
            return map[k] || '8A';
        };

        const cam1 = keyToCamelot(key1);
        const cam2 = keyToCamelot(key2);

        if (cam1 === cam2) return 1.0;
        const num1 = parseInt(cam1.slice(0, -1));
        const letter1 = cam1.slice(-1);
        const num2 = parseInt(cam2.slice(0, -1));
        const letter2 = cam2.slice(-1);

        if (num1 === num2 && letter1 !== letter2) return 0.9; // Relative key

        if (letter1 === letter2) {
            const diff = Math.abs(num1 - num2);
            if (diff === 1 || diff === 11) return 0.8; // Adjacent key
        }

        return 0.3; // Disjoint
    }

    calculateVolumeBalance(deckA, deckB) {
        if (!deckA.playing && !deckB.playing) return 0.0;
        const volDiff = Math.abs(deckA.volume - deckB.volume);
        return Math.max(0, 1 - volDiff);
    }
}

DJTrainerApp.prototype.transitionAnalyzer = new TransitionAnalyzer();

DJTrainerApp.prototype.runCoachAnalysis = function() {
    if (this.coachInterval) {
        clearInterval(this.coachInterval);
    }
    this.coachInterval = setInterval(() => {
        if (this.coachMode) {
            this.performRealTimeAnalysis();
        } else {
            clearInterval(this.coachInterval);
            this.coachInterval = null;
        }
    }, 200);
};

DJTrainerApp.prototype.performRealTimeAnalysis = function() {
    const deckAState = {
        playing: this.playerA.state === 'started',
        bpm: this.deckA ? this.deckA.bpm * this.playerA.playbackRate : 0,
        volume: Tone.dbToGain(this.volumeNodeA.volume.value),
        key: this.deckA ? this.deckA.key : null
    };

    const deckBState = {
        playing: this.playerB.state === 'started',
        bpm: this.deckB ? this.deckB.bpm * this.playerB.playbackRate : 0,
        volume: Tone.dbToGain(this.volumeNodeB.volume.value),
        key: this.deckB ? this.deckB.key : null
    };

    const analysis = this.transitionAnalyzer.analyzeTransition(deckAState, deckBState);
    this.updateCoachFeedback(analysis);
};

DJTrainerApp.prototype.updateCoachFeedback = function(analysis) {
    const timingEl = document.getElementById('coachMetricTiming');
    const harmonyEl = document.getElementById('coachMetricHarmony');
    const balanceEl = document.getElementById('coachMetricBalance');
    const overallEl = document.getElementById('coachMetricOverall');
    
    if (timingEl) timingEl.textContent = `${(analysis.timingAccuracy * 100).toFixed(0)}%`;
    if (harmonyEl) harmonyEl.textContent = `${(analysis.harmonicCompatibility * 100).toFixed(0)}%`;
    if (balanceEl) balanceEl.textContent = `${(analysis.volumeBalance * 100).toFixed(0)}%`;
    if (overallEl) overallEl.textContent = `${(analysis.transitionQuality * 100).toFixed(0)}%`;

    const label = this.getQualityLabel(analysis.transitionQuality);
    const startCoachBtn = document.getElementById('startCoach');
    if (startCoachBtn) startCoachBtn.textContent = `Coach: ${label}`;

    const tipText = document.getElementById('coachTipText');
    if (tipText) {
        if (analysis.transitionQuality === 0) {
            tipText.textContent = "Start playing both decks to analyze your transition quality!";
        } else if (analysis.timingAccuracy < 0.7) {
            tipText.textContent = "Sync Warning: Adjust the pitch sliders on your decks to match the BPMs.";
        } else if (analysis.volumeBalance < 0.6) {
            tipText.textContent = "EQ / Volume Warning: Adjust volume faders or EQs to avoid sound clashes.";
        } else {
            tipText.textContent = "Great mix flow! Keep monitoring the energy levels.";
        }
    }
};

DJTrainerApp.prototype.getQualityLabel = function(score) {
    if (score >= 0.8) return 'Excellent';
    if (score >= 0.6) return 'Good';
    if (score >= 0.4) return 'Fair';
    return 'Needs Work';
};

document.addEventListener('DOMContentLoaded', () => {
    window.app = new DJTrainerApp();
});

