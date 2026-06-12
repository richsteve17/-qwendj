const fs = require('fs');
const path = require('path');

function writeWavFile(filePath, duration, frequency = 440, sampleRate = 44100) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const numSamples = Math.floor(sampleRate * duration);
    const subChunk2Size = numSamples * numChannels * (bitsPerSample / 8);
    const chunkSize = 36 + subChunk2Size;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);

    const buffer = Buffer.alloc(44 + subChunk2Size);

    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(chunkSize, 4);
    buffer.write('WAVE', 8);

    // fmt subchunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // Subchunk1Size
    buffer.writeUInt16LE(1, 20);  // AudioFormat (PCM = 1)
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);

    // data subchunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(subChunk2Size, 40);

    // Generate sine wave or silence
    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        const sample = frequency > 0 ? Math.sin(2 * Math.PI * frequency * t) : 0;
        // Scale to 16-bit signed integer range (-32768 to 32767)
        const intSample = Math.floor(sample * 32767);
        buffer.writeInt16LE(intSample, offset);
        offset += 2;
    }

    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);
}

function generateAllFixtures() {
    const fixturesDir = path.join(__dirname, 'fixtures');
    
    // 1. Standard 1-second 440Hz sine wave
    writeWavFile(path.join(fixturesDir, 'sine_440hz.wav'), 1.0, 440, 44100);
    
    // 2. Short 0.5-second sine wave (under 1 second)
    writeWavFile(path.join(fixturesDir, 'short_sine.wav'), 0.5, 440, 44100);
    
    // 3. Silent track
    writeWavFile(path.join(fixturesDir, 'silence.wav'), 1.0, 0, 44100);
    
    // 4. High-resolution audio (96kHz)
    writeWavFile(path.join(fixturesDir, 'high_res.wav'), 1.0, 440, 96000);
    
    console.log('Successfully generated all audio fixtures in tests/fixtures/');
}

if (require.main === module) {
    generateAllFixtures();
}

module.exports = { writeWavFile, generateAllFixtures };
