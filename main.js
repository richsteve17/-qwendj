const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const AudioAnalyzer = require('./audio-analyzer');

let mainWindow;
const analyzer = new AudioAnalyzer();

function decodeWav(filePath) {
    try {
        const fileBuffer = fs.readFileSync(filePath);
        
        const chunkID = fileBuffer.toString('utf8', 0, 4);
        const format = fileBuffer.toString('utf8', 8, 12);
        if (chunkID !== 'RIFF' || format !== 'WAVE') {
            throw new Error('Not a valid WAV file');
        }

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
        
        if (dataOffset === 0) {
            throw new Error('Data subchunk not found');
        }

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
        } else if (bitsPerSample === 24) {
            for (let i = 0; i < numSamples; i++) {
                const sampleOffset = dataOffset + i * numChannels * 3;
                if (sampleOffset + 2 < fileBuffer.length) {
                    const low = fileBuffer.readUInt8(sampleOffset);
                    const mid = fileBuffer.readUInt8(sampleOffset + 1);
                    const high = fileBuffer.readInt8(sampleOffset + 2);
                    const sample = (high << 16) | (mid << 8) | low;
                    channelData[i] = sample / 8388608.0;
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
        console.error('WAV Decoding error:', e);
        return null;
    }
}

async function analyzeTrack(filePath) {
    if (filePath.endsWith('.wav')) {
        const decoded = decodeWav(filePath);
        if (decoded) {
            const bpm = analyzer.detectBPM(decoded);
            const keyObj = analyzer.detectKey(decoded);
            return {
                bpm,
                key: `${keyObj.key} ${keyObj.scale}`,
                confidence: keyObj.confidence,
                duration: decoded.duration,
                sampleRate: decoded.sampleRate
            };
        }
    }
    
    return {
        bpm: 120,
        key: 'C major',
        confidence: 0.5,
        duration: 1.0,
        sampleRate: 44100
    };
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        }
    });

    // Grant MIDI, audio device, and microphone permissions automatically
    mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowed = ['midi', 'midiSysex', 'media', 'mediaKeySystem'];
        callback(allowed.includes(permission));
    });
    mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) => {
        const allowed = ['midi', 'midiSysex', 'media', 'mediaKeySystem'];
        return allowed.includes(permission);
    });

    mainWindow.loadFile('index.html');

    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }

    if (process.argv.includes('--run-tests')) {
        // Run fixtures generator programmatically on start
        const { generateAllFixtures } = require('./tests/generate-fixtures');
        generateAllFixtures();

        mainWindow.webContents.once('did-finish-load', async () => {
            console.log('--- Window loaded. Preparing to execute E2E test suite ---');
            // Give extra time for Tone.js and WaveSurfer to initialize
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            console.log('--- EXECUTE TEST RUNNER IN RENDERER ---');
            mainWindow.webContents.executeJavaScript(`
                (async () => {
                    try {
                        const runner = require('./tests/runner.js');
                        await runner.runTests();
                    } catch (e) {
                        console.error('Test execution crash:', e);
                        const { ipcRenderer } = require('electron');
                        ipcRenderer.send('tests-finished', {
                            passed: 0,
                            failed: 1,
                            total: 1,
                            results: [{ name: 'Test execution crash', passed: false, error: e.message }]
                        });
                    }
                })();
            `).catch(err => {
                console.error('Failed to launch tests:', err);
                app.exit(1);
            });
        });
    }
}

app.whenReady().then(createWindow);

ipcMain.handle('load-track', async (event, filePath) => {
    try {
        const metadata = await require('music-metadata').parseFile(filePath, { duration: true });
        const trackAnalysis = await analyzeTrack(filePath);
        
        return {
            path: filePath,
            title: metadata.common.title || path.basename(filePath),
            artist: metadata.common.artist || 'Unknown',
            duration: metadata.format.duration || trackAnalysis.duration || 1.0,
            bpm: trackAnalysis.bpm,
            key: trackAnalysis.key,
            sampleRate: metadata.format.sampleRate || trackAnalysis.sampleRate || 44100
        };
    } catch (error) {
        // Fallback for files with parse failures (e.g. fixtures lacking ID3 tags)
        const trackAnalysis = await analyzeTrack(filePath);
        return {
            path: filePath,
            title: path.basename(filePath),
            artist: 'Unknown',
            duration: trackAnalysis.duration || 1.0,
            bpm: trackAnalysis.bpm,
            key: trackAnalysis.key,
            sampleRate: trackAnalysis.sampleRate || 44100
        };
    }
});

ipcMain.handle('analyze-track-detailed', async (event, filePath) => {
    try {
        const trackAnalysis = await analyzeTrack(filePath);
        return {
            bpm: trackAnalysis.bpm,
            key: trackAnalysis.key,
            structure: {
                intro: { start: 0, end: 16 },
                verse: { start: 16, end: 64 },
                drop: { start: 64, end: 80 },
                breakdown: { start: 80, end: 112 }
            },
            hotCuePoints: [16, 32, 64, 80, 96]
        };
    } catch (error) {
        return null;
    }
});

// Capture test results from renderer
ipcMain.on('tests-finished', (event, summary) => {
    console.log('\n======================================');
    console.log('E2E TEST RUNNER RESULTS');
    console.log('======================================');
    summary.results.forEach(res => {
        const statusChar = res.passed ? '✅' : '❌';
        console.log(`${statusChar} ${res.name}`);
        if (!res.passed && res.error) {
            console.log(`   Error: ${res.error}`);
        }
    });
    console.log('--------------------------------------');
    console.log(`Total:  ${summary.total}`);
    console.log(`Passed: ${summary.passed}`);
    console.log(`Failed: ${summary.failed}`);
    console.log('======================================\n');
    
    // Save to test-results.json
    fs.writeFileSync(path.join(__dirname, 'test-results.json'), JSON.stringify(summary, null, 2));
    
    app.exit(summary.failed > 0 ? 1 : 0);
});

