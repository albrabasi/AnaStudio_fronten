/**
 * AnaStudio Frontend - Application Logic
 */

const BACKEND_URL = "https://backend-gamma-liart-yfgzfi9y5j.vercel.app/api/generate";

// Helper untuk mengambil elemen berdasarkan ID
const $ = (id) => document.getElementById(id);

let currentAudioUrl = null;
let imageBase64 = "";
let imageMimeType = "";

// 1. Initial Setup: Tab Navigation
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));

        tab.classList.add('active');
        $(tab.dataset.tab).classList.add('active');
    });
});

// 2. UI Event Listeners
$('textInput')?.addEventListener('input', () => {
    $('characterCount').textContent = $('textInput').value.length;
});

$('generateButton')?.addEventListener('click', generateVoice);

$('uploadBox')?.addEventListener('click', () => $('imageInput').click());

$('imageInput')?.addEventListener('change', handleImageUpload);

$('generateImageButton')?.addEventListener('click', generateImagePrompt);

$('copyPromptButton')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText($('promptOutput').value);
    showStatus('Prompt berhasil disalin.');
});

// STT Variables & Event Listeners
let mediaRecorder = null;
let audioChunks = [];
let sttAudioBase64 = "";
let sttAudioMimeType = "";

$('recordButton')?.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) audioChunks.push(event.data);
        };

        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            sttAudioMimeType = 'audio/webm';
            sttAudioBase64 = '';

            const reader = new FileReader();
            reader.onload = () => {
                sttAudioBase64 = reader.result.split(',')[1];
                $('sttAudioPreview').src = reader.result;
                $('sttAudioPreview').style.display = 'block';
                showStatus('Rekaman audio siap ditranskrip.');
            };
            reader.readAsDataURL(audioBlob);

            stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        $('recordButton').style.display = 'none';
        $('stopRecordButton').style.display = 'block';
        $('stopRecordButton').disabled = false;
        showStatus('Sedang merekam suara...');
    } catch (e) {
        showStatus('Gagal mengakses mikrofon: ' + e.message);
    }
});

$('stopRecordButton')?.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        $('stopRecordButton').style.display = 'none';
        $('recordButton').style.display = 'block';
        $('stopRecordButton').disabled = true;
    }
});

$('sttUploadBox')?.addEventListener('click', () => $('audioFileInput').click());

$('audioFileInput')?.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) return showStatus('Ukuran file audio maksimal 25MB.');

    sttAudioMimeType = f.type || 'audio/mp3';
    const reader = new FileReader();
    reader.onload = () => {
        sttAudioBase64 = reader.result.split(',')[1];
        $('sttAudioPreview').src = reader.result;
        $('sttAudioPreview').style.display = 'block';
        showStatus('File audio siap ditranskrip.');
    };
    reader.readAsDataURL(f);
});

$('generateSttButton')?.addEventListener('click', generateStt);

$('copySttButton')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText($('sttOutput').value);
    showStatus('Hasil transkripsi berhasil disalin.');
});

// 3. Helper Functions
function showStatus(m) {
    $('status').textContent = m;
}

function setBusy(b, el, label) {
    el.disabled = b;
    el.textContent = b ? 'Sedang memproses...' : label;
}

function handleImageUpload(e) {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return showStatus('Ukuran gambar maksimal 10MB.');

    imageMimeType = f.type;
    const r = new FileReader();
    r.onload = () => {
        imageBase64 = r.result.split(',')[1];
        $('imagePreview').src = r.result;
        $('imagePreview').style.display = 'block';
        showStatus('Gambar siap diproses.');
    };
    r.readAsDataURL(f);
}

// 4. Core Logic: Generate Voice (TTS)
async function generateVoice() {
    const text = $('textInput').value.trim();
    if (!text) return showStatus('Teks narasi belum diisi.');

    setBusy(true, $('generateButton'), '▶ Generate MP3');
    showStatus('Menghubungi Gemini TTS...');

    try {
        const payload = {
            mode: 'tts',
            text: text,
            style: $('styleInput').value.trim(),
            voiceName: $('voiceSelect').value,
            speed: $('speedSelect').value,
            character: $('characterSelect').value,
            model: $('modelSelect')?.value || 'gemini-2.5-flash-preview-tts'
        };

        const response = await fetch(BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok || !data.success) throw Error(data.error || 'Gagal membuat audio');

        const blob = convertBase64PcmToMp3(data.audioBase64, 24000, 1);

        if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
        currentAudioUrl = URL.createObjectURL(blob);

        $('audioPlayer').src = currentAudioUrl;
        $('audioPlayer').style.display = 'block';

        $('downloadButton').href = currentAudioUrl;
        $('downloadButton').download = 'AnaAudio.mp3';
        $('downloadButton').style.display = 'inline-block';

        showStatus('MP3 berhasil dibuat.');
    } catch (e) {
        showStatus('Terjadi kesalahan: ' + e.message);
    } finally {
        setBusy(false, $('generateButton'), '▶ Generate MP3');
    }
}

// 5. Core Logic: Generate Image Prompt
async function generateImagePrompt() {
    if (!imageBase64) return showStatus('Silakan upload gambar terlebih dahulu.');

    const btn = $('generateImageButton');
    setBusy(true, btn, '▶ Generate Prompt Video Flow');
    showStatus('AI sedang membaca gambar...');

    try {
        const payload = {
            mode: 'image_prompt',
            imageBase64,
            mimeType: imageMimeType,
            videoType: $('imageStyle').value,
            duration: $('videoDuration').value,
            visualStyle: $('videoStyle').value,
            hook: $('hookInput').value,
            cta: $('ctaInput').value,
            language: $('imageLanguage').value,
            voiceName: $('imageVoice').value
        };

        const response = await fetch(BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok || !data.success) throw Error(data.error || 'Gagal membuat prompt');

        $('promptOutput').value = data.prompt || '';
        $('copyPromptButton').style.display = 'block';
        showStatus('Prompt video berhasil dibuat.');
    } catch (e) {
        showStatus('Terjadi kesalahan: ' + e.message);
    } finally {
        setBusy(false, btn, '▶ Generate Prompt Video Flow');
    }
}

// 6. Core Logic: Generate Speech to Text (STT)
async function generateStt() {
    if (!sttAudioBase64) return showStatus('Silakan rekam suara atau upload file audio terlebih dahulu.');

    const btn = $('generateSttButton');
    setBusy(true, btn, '▶ Transkrip Audio ke Teks');
    showStatus('AI sedang mentranskripsi audio...');

    try {
        const payload = {
            mode: 'stt',
            audioBase64: sttAudioBase64,
            mimeType: sttAudioMimeType,
            language: $('sttLanguage').value
        };

        const response = await fetch(BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok || !data.success) throw Error(data.error || 'Gagal mentranskripsi audio');

        $('sttOutput').value = data.transcription || '';
        $('copySttButton').style.display = 'block';
        showStatus('Transkripsi berhasil diselesaikan.');
    } catch (e) {
        showStatus('Terjadi kesalahan: ' + e.message);
    } finally {
        setBusy(false, btn, '▶ Transkrip Audio ke Teks');
    }
}

// 7. Utility: Base64 to MP3 Conversion
function convertBase64PcmToMp3(base64, sampleRate, channels) {
    const b = atob(base64);
    const u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);

    const pcm = new Int16Array(u.buffer);
    const enc = new lamejs.Mp3Encoder(channels, sampleRate, 128);
    const out = [];

    for (let i = 0; i < pcm.length; i += 1152) {
        const x = enc.encodeBuffer(pcm.subarray(i, i + 1152));
        if (x.length) out.push(new Int8Array(x));
    }

    const f = enc.flush();
    if (f.length) out.push(new Int8Array(f));

    return new Blob(out, { type: 'audio/mpeg' });
}
