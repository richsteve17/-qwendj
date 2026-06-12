const fs = require('fs');
const path = require('path');

class AudioAnalyzer {
    constructor() {
        this.fftSize = 2048;
        this.sampleRate = 44100;
    }

    // Enhanced BPM detection using onset energy envelope autocorrelation
    detectBPM(audioBuffer) {
        const channelData = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const length = channelData.length;
        
        if (length === 0) {
            return 120;
        }

        const frameSize = 1024;
        const hopSize = 256;
        
        const frameRate = sampleRate / hopSize;
        const numFrames = Math.floor((length - frameSize) / hopSize) + 1;
        if (numFrames <= 1) {
            return 120;
        }

        const energies = new Float32Array(numFrames);
        for (let i = 0; i < numFrames; i++) {
            const start = i * hopSize;
            let sumAbs = 0;
            for (let j = 0; j < frameSize; j++) {
                sumAbs += Math.abs(channelData[start + j]);
            }
            energies[i] = sumAbs;
        }

        // Positive energy differences (onset envelope)
        const envelope = new Float32Array(numFrames);
        let sumEnv = 0;
        for (let i = 1; i < numFrames; i++) {
            const diff = energies[i] - energies[i - 1];
            envelope[i] = diff > 0 ? diff : 0;
            sumEnv += envelope[i];
        }

        // Return fallback BPM on silence/constant amplitude
        if (sumEnv < 0.0001) {
            return 120;
        }

        // Autocorrelation for lags corresponding to 60-200 BPM
        const lagMin = Math.floor(frameRate * 60 / 200);
        const lagMax = Math.ceil(frameRate * 60 / 60);

        let bestLag = -1;
        let maxCorrelation = -Infinity;

        for (let lag = lagMin; lag <= lagMax; lag++) {
            if (lag >= numFrames) break;
            
            let sum = 0;
            let count = 0;
            for (let i = 0; i < numFrames - lag; i++) {
                sum += envelope[i] * envelope[i + lag];
                count++;
            }
            
            const correlation = count > 0 ? sum / count : 0;
            if (correlation > maxCorrelation) {
                maxCorrelation = correlation;
                bestLag = lag;
            }
        }

        if (bestLag === -1 || maxCorrelation <= 0) {
            return 120;
        }

        const detectedBpm = Math.round(frameRate * 60 / bestLag);
        return (detectedBpm >= 60 && detectedBpm <= 200) ? detectedBpm : 120;
    }

    downsample(data, factor) {
        const result = [];
        for (let i = 0; i < data.length; i += factor) {
            let sum = 0;
            for (let j = 0; j < factor && i + j < data.length; j++) {
                sum += data[i + j];
            }
            result.push(sum / factor);
        }
        return result;
    }

    applyHanningWindow(data) {
        const windowed = new Float32Array(data.length);
        for (let i = 0; i < data.length; i++) {
            const windowValue = 0.5 * (1 - Math.cos(2 * Math.PI * i / (data.length - 1)));
            windowed[i] = data[i] * windowValue;
        }
        return windowed;
    }

    autocorrelation(data) {
        const result = new Float32Array(data.length);
        for (let lag = 0; lag < data.length; lag++) {
            let sum = 0;
            for (let i = 0; i < data.length - lag; i++) {
                sum += data[i] * data[i + lag];
            }
            result[lag] = sum / (data.length - lag);
        }
        return result;
    }

    findPeaks(data, threshold = 0.1) {
        const peaks = [];
        const minInterval = 44100 / 200; // Minimum interval (200 BPM)
        const maxInterval = 44100 / 60;  // Maximum interval (60 BPM)
        
        for (let i = Math.floor(minInterval); i < Math.min(maxInterval, data.length); i++) {
            const value = data[i];
            if (value > threshold) {
                // Check if it's a local maximum
                let isPeak = true;
                for (let j = Math.max(0, i - 10); j < Math.min(data.length, i + 10); j++) {
                    if (j !== i && data[j] >= value) {
                        isPeak = false;
                        break;
                    }
                }
                if (isPeak) peaks.push(i);
            }
        }
        return peaks;
    }

    getMostFrequent(array) {
        if (array.length === 0) return null;
        
        const counts = {};
        array.forEach(item => {
            counts[item] = (counts[item] || 0) + 1;
        });
        
        let maxCount = 0;
        let mostFrequent = null;
        
        for (const [num, count] of Object.entries(counts)) {
            if (count > maxCount) {
                maxCount = count;
                mostFrequent = parseInt(num);
            }
        }
        
        return mostFrequent;
    }

    // Key detection using chromagram analysis
    detectKey(audioBuffer) {
        const channelData = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const duration = audioBuffer.duration;
        
        let startSample = 0;
        let endSample = channelData.length;
        
        // Slice a 10-second segment from the middle of the track (e.g. 30s-40s) where the musical structure is established
        if (duration > 10) {
            const middle = duration / 2;
            const startSec = Math.max(0, middle - 5);
            const endSec = Math.min(duration, middle + 5);
            startSample = Math.floor(startSec * sampleRate);
            endSample = Math.floor(endSec * sampleRate);
        }
        
        const segmentData = channelData.slice(startSample, endSample);

        // Extract spectral features for key detection
        const chroma = this.computeChroma(segmentData, sampleRate);
        
        // Map chroma features to keys
        const keyConfidence = this.classifyKey(chroma);
        
        return {
            key: keyConfidence.key,
            confidence: keyConfidence.confidence,
            scale: keyConfidence.scale
        };
    }

    computeChroma(data, sampleRate) {
        // Simplified chroma calculation - would use proper STFT in production
        const chroma = new Array(12).fill(0);
        
        // FFT size for frequency analysis
        const fftSize = 4096;
        const hopSize = 1024;
        
        for (let i = 0; i < data.length - fftSize; i += hopSize) {
            const segment = data.slice(i, i + fftSize);
            const spectrum = this.fft(segment);
            const real = spectrum.real;
            const imag = spectrum.imag;
            
            // Map frequencies to chroma bins (C, C#, D, etc.)
            for (let bin = 0; bin < real.length; bin++) {
                const freq = (bin * sampleRate) / fftSize;
                if (freq > 80 && freq < 2000) { // Musical range
                    const midiNote = 12 * Math.log2(freq / 261.63) + 60; // Relative to middle C
                    const chromaIndex = Math.round(midiNote) % 12;
                    if (chromaIndex >= 0 && chromaIndex < 12) {
                        const mag = Math.sqrt(real[bin] * real[bin] + imag[bin] * imag[bin]);
                        chroma[chromaIndex] += mag;
                    }
                }
            }
        }
        
        // Normalize chroma vector
        const norm = Math.sqrt(chroma.reduce((sum, val) => sum + val * val, 0));
        if (norm === 0) {
            return chroma;
        }
        return chroma.map(val => val / norm);
    }

    classifyKey(chroma) {
        // Major and minor key templates (simplified)
        const majorTemplates = [
            [1,0,0,0,1,0,0,1,0,0,0,0], // C
            [0,1,0,0,0,1,0,0,1,0,0,0], // C#
            [0,0,1,0,0,0,1,0,0,1,0,0], // D
            [0,0,0,1,0,0,0,1,0,0,1,0], // Eb
            [0,0,0,0,1,0,0,0,1,0,0,1], // E
            [1,0,0,0,0,1,0,0,0,1,0,0], // F
            [0,1,0,0,0,0,1,0,0,0,1,0], // F#
            [0,0,1,0,0,0,0,1,0,0,0,1], // G
            [1,0,0,1,0,0,0,0,1,0,0,0], // Ab
            [0,1,0,0,1,0,0,0,0,1,0,0], // A
            [0,0,1,0,0,1,0,0,0,0,1,0], // Bb
            [0,0,0,1,0,0,1,0,0,0,0,1]  // B
        ];
        
        const minorTemplates = [
            [1,0,0,1,0,0,0,1,0,0,0,0], // Cm
            [0,1,0,0,1,0,0,0,1,0,0,0], // C#m
            [0,0,1,0,0,1,0,0,0,1,0,0], // Dm
            [0,0,0,1,0,0,1,0,0,0,1,0], // Ebm
            [0,0,0,0,1,0,0,1,0,0,0,1], // Em
            [1,0,0,0,0,1,0,0,1,0,0,0], // Fm
            [0,1,0,0,0,0,1,0,0,1,0,0], // F#m
            [0,0,1,0,0,0,0,1,0,0,1,0], // Gm
            [0,0,0,1,0,0,0,0,1,0,0,1], // Abm
            [1,0,0,0,1,0,0,0,0,1,0,0], // Am
            [0,1,0,0,0,1,0,0,0,0,1,0], // Bbm
            [0,0,1,0,0,0,1,0,0,0,0,1]  // Bm
        ];

        let bestMatch = { key: 'C', confidence: 0, scale: 'major' };
        
        // Test major keys
        for (let i = 0; i < majorTemplates.length; i++) {
            const correlation = this.dotProduct(chroma, majorTemplates[i]);
            if (correlation > bestMatch.confidence) {
                bestMatch = {
                    key: this.midiNoteToKey(i),
                    confidence: correlation,
                    scale: 'major'
                };
            }
        }
        
        // Test minor keys
        for (let i = 0; i < minorTemplates.length; i++) {
            const correlation = this.dotProduct(chroma, minorTemplates[i]);
            if (correlation > bestMatch.confidence) {
                bestMatch = {
                    key: this.midiNoteToKey(i),
                    confidence: correlation,
                    scale: 'minor'
                };
            }
        }
        
        return bestMatch;
    }

    dotProduct(a, b) {
        let sum = 0;
        for (let i = 0; i < a.length; i++) {
            sum += a[i] * b[i];
        }
        return sum;
    }

    midiNoteToKey(noteNumber) {
        const keys = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
        return keys[noteNumber % 12];
    }

    // Basic FFT implementation (simplified)
    fft(real, imag = null) {
        if (!imag) {
            imag = new Float32Array(real.length);
        }
        
        const n = real.length;
        if (n <= 1) return { real, imag };
        
        // Bit-reversal permutation
        this.bitReverse(real, imag);
        
        // Cooley-Tukey FFT
        for (let len = 2; len <= n; len *= 2) {
            const halfLen = len / 2;
            const angle = -2 * Math.PI / len;
            
            for (let i = 0; i < n; i += len) {
                for (let j = 0; j < halfLen; j++) {
                    const k = i + j;
                    const l = i + j + halfLen;
                    
                    const tReal = Math.cos(angle * j) * real[l] - Math.sin(angle * j) * imag[l];
                    const tImag = Math.sin(angle * j) * real[l] + Math.cos(angle * j) * imag[l];
                    
                    real[l] = real[k] - tReal;
                    imag[l] = imag[k] - tImag;
                    real[k] = real[k] + tReal;
                    imag[k] = imag[k] + tImag;
                }
            }
        }
        
        return { real, imag };
    }

    bitReverse(real, imag) {
        const n = real.length;
        let j = 0;
        for (let i = 0; i < n; i++) {
            if (i > j) {
                [real[i], real[j]] = [real[j], real[i]];
                [imag[i], imag[j]] = [imag[j], imag[i]];
            }
            let m = n >> 1;
            while (j & m) {
                j ^= m;
                m >>= 1;
            }
            j |= m;
        }
    }
}

module.exports = AudioAnalyzer;
