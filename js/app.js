/**
 * AnaStudio - Gemini 3.8 TTS + STT + Voice Replication + Image Prompt
 */
const BACKEND_URL = 'https://backend-gamma-liart-yfgzfi9y5j.vercel.app/api/generate';
const TTS_MODEL = 'gemini-3.8-flash-tts';
const $ = id => document.getElementById(id);
let currentAudioUrl = null;
let imageBase64 = '', imageMimeType = '';
let mediaRecorder = null, audioChunks = [], sttAudioBase64 = '', sttAudioMimeType = '';
let voiceSourceBase64 = '', voiceSourceMime = '', voiceConsentBase64 = '', voiceConsentMime = '';

async function callBackend(payload) {
  const response = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || `HTTP ${response.status}` }; }
  if (!response.ok || !data.success) throw new Error(data.error || `Server HTTP ${response.status}`);
  return data;
}

function showStatus(message) { if ($('status')) $('status').textContent = message; }
function setBusy(button, busy, label) { if (!button) return; button.disabled = busy; button.textContent = busy ? '⏳ Sedang memproses...' : label; }
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Tabs
 document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  tab.classList.add('active');
  $(tab.dataset.tab)?.classList.add('active');
  showStatus('');
}));

// TTS
$('textInput')?.addEventListener('input', () => { $('characterCount').textContent = $('textInput').value.length; });
$('generateButton')?.addEventListener('click', generateVoice);
$('textInput')?.dispatchEvent(new Event('input'));

async function generateVoice() {
  const text = $('textInput')?.value.trim();
  if (!text) return showStatus('Teks narasi belum diisi.');
  const button = $('generateButton');
  setBusy(button, true, '▶ Generate Audio');
  showStatus('Menghasilkan suara dengan Gemini 3.8 TTS...');
  try {
    const data = await callBackend({
      mode: 'tts', text,
      style: $('styleInput')?.value.trim() || 'natural, jelas, ramah',
      voiceName: $('voiceSelect')?.value || 'Kore',
      speed: $('speedSelect')?.value || '1.0',
      character: $('characterSelect')?.value || 'ramah',
      model: TTS_MODEL
    });

    const blob = await audioBase64ToMp3(data.audioBase64, data.mimeType || 'audio/wav');
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = URL.createObjectURL(blob);
    $('audioPlayer').src = currentAudioUrl;
    $('audioPlayer').style.display = 'block';
    $('downloadButton').href = currentAudioUrl;
    const filename = ($('fileNameInput')?.value.trim() || 'AnaAudio_01').replace(/[^a-zA-Z0-9_-]/g, '_');
    $('downloadButton').download = `${filename}.mp3`;
    $('downloadButton').style.display = 'block';
    showStatus('Audio berhasil dibuat dengan Gemini 3.8 TTS.');
  } catch (e) { showStatus('Terjadi kesalahan: ' + e.message); }
  finally { setBusy(button, false, '▶ Generate MP3'); }
}

// STT
$('recordButton')?.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferred = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    mediaRecorder = new MediaRecorder(stream, { mimeType: preferred });
    audioChunks = [];
    mediaRecorder.ondataavailable = e => { if (e.data.size) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      sttAudioMimeType = blob.type;
      sttAudioBase64 = await readFileAsBase64(blob);
      $('sttAudioPreview').src = URL.createObjectURL(blob);
      $('sttAudioPreview').style.display = 'block';
      showStatus('Rekaman siap ditranskrip.');
      stream.getTracks().forEach(t => t.stop());
    };
    mediaRecorder.start();
    $('recordButton').style.display = 'none';
    $('stopRecordButton').style.display = 'block';
    $('stopRecordButton').disabled = false;
    showStatus('Sedang merekam suara...');
  } catch (e) { showStatus('Gagal mengakses mikrofon: ' + e.message); }
});
$('stopRecordButton')?.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  $('stopRecordButton').style.display = 'none';
  $('recordButton').style.display = 'block';
  $('stopRecordButton').disabled = true;
});
$('sttUploadBox')?.addEventListener('click', () => $('audioFileInput').click());
$('audioFileInput')?.addEventListener('change', async e => {
  const file = e.target.files?.[0]; if (!file) return;
  if (file.size > 25 * 1024 * 1024) return showStatus('Ukuran file audio maksimal 25MB.');
  sttAudioMimeType = file.type || 'audio/wav';
  sttAudioBase64 = await readFileAsBase64(file);
  $('sttAudioPreview').src = URL.createObjectURL(file);
  $('sttAudioPreview').style.display = 'block';
  showStatus('File audio siap ditranskrip.');
});
$('generateSttButton')?.addEventListener('click', generateStt);
$('copySttButton')?.addEventListener('click', async () => { await navigator.clipboard.writeText($('sttOutput').value); showStatus('Hasil transkripsi berhasil disalin.'); });
async function generateStt() {
  if (!sttAudioBase64) return showStatus('Silakan rekam atau upload audio terlebih dahulu.');
  const button = $('generateSttButton'); setBusy(button, true, '▶ Transkrip Audio ke Teks'); showStatus('Gemini 3.5 Transcribe sedang bekerja...');
  try {
    const data = await callBackend({ mode: 'stt', audioBase64: sttAudioBase64, mimeType: sttAudioMimeType, language: $('sttLanguage')?.value || 'Indonesia' });
    $('sttOutput').value = data.transcription || '';
    $('copySttButton').style.display = 'block';
    showStatus('Transkripsi berhasil.');
  } catch (e) { showStatus('Terjadi kesalahan: ' + e.message); }
  finally { setBusy(button, false, '▶ Transkrip Audio ke Teks'); }
}

// Image Prompt
$('uploadBox')?.addEventListener('click', () => $('imageInput').click());
$('imageInput')?.addEventListener('change', async e => {
  const file = e.target.files?.[0]; if (!file) return;
  if (file.size > 10 * 1024 * 1024) return showStatus('Ukuran gambar maksimal 10MB.');
  imageMimeType = file.type; imageBase64 = await readFileAsBase64(file);
  $('imagePreview').src = URL.createObjectURL(file); $('imagePreview').style.display = 'block'; showStatus('Gambar siap diproses.');
});
$('generateImageButton')?.addEventListener('click', generateImagePrompt);
$('copyPromptButton')?.addEventListener('click', async () => { await navigator.clipboard.writeText($('promptOutput').value); showStatus('Prompt berhasil disalin.'); });
async function generateImagePrompt() {
  if (!imageBase64) return showStatus('Silakan upload gambar terlebih dahulu.');
  const button = $('generateImageButton'); setBusy(button, true, '▶ Generate Prompt Video Flow'); showStatus('AI sedang membaca gambar...');
  try {
    const data = await callBackend({
      mode: 'image_prompt', imageBase64, mimeType: imageMimeType,
      videoType: $('imageStyle').value, duration: $('videoDuration').value,
      visualStyle: $('videoStyle').value, hook: $('hookInput').value, cta: $('ctaInput').value,
      language: $('imageLanguage').value, voiceName: $('imageVoice').value
    });
    $('promptOutput').value = data.prompt || ''; $('copyPromptButton').style.display = 'block'; showStatus('Prompt video berhasil dibuat.');
  } catch (e) { showStatus('Terjadi kesalahan: ' + e.message); }
  finally { setBusy(button, false, '▶ Generate Prompt Video Flow'); }
}

// Voice Conversion UI (Speech-to-Speech)
let convertSourceBase64 = '', convertSourceMime = '';

function buildVoicePanel() {
  const panel = $('voicePanel'); if (!panel || panel.dataset.ready) return;
  panel.dataset.ready = '1';

  $('convertSourceBox').onclick = () => $('convertSourceInput').click();
  $('convertSourceInput').onchange = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) return showStatus('Ukuran file audio maksimal 25MB.');
    const b64 = await readFileAsBase64(file);
    convertSourceBase64 = b64;
    convertSourceMime = file.type || 'audio/webm';
    $('convertSourcePreview').src = URL.createObjectURL(file);
    $('convertSourcePreview').style.display = 'block';
    showStatus('Audio sumber siap dikonversi.');
  };

  $('convertVoiceButton').onclick = async () => {
    if (!convertSourceBase64) return showStatus('Silakan upload audio sumber terlebih dahulu.');
    const button = $('convertVoiceButton');
    setBusy(button, true, '▶ Konversi Suara');
    showStatus('Memproses konversi suara (STT ➔ TTS)...');
    try {
      const data = await callBackend({
        mode: 'convert_voice',
        audioBase64: convertSourceBase64,
        mimeType: convertSourceMime,
        voiceName: $('convertVoiceSelect')?.value || 'Kore',
        language: $('convertLanguage')?.value || 'Indonesia'
      });

      $('convertTranscriptionOutput').value = data.transcription || '';
      const blob = await audioBase64ToMp3(data.audioBase64, data.mimeType || 'audio/wav');
      if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
      currentAudioUrl = URL.createObjectURL(blob);
      $('audioPlayer').src = currentAudioUrl;
      $('audioPlayer').style.display = 'block';
      $('downloadButton').href = currentAudioUrl;
      $('downloadButton').style.display = 'block';
      $('downloadButton').download = 'AnaStudio_VoiceConverted.mp3';
      showStatus('Konversi suara berhasil dibuat!');
    } catch (e) {
      showStatus('Konversi suara gagal: ' + e.message);
    } finally {
      setBusy(button, false, '▶ Konversi Suara');
    }
  };
}

async function audioBase64ToMp3(base64, mimeType) {
  const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  if (!mimeType.includes('wav') && !mimeType.includes('audio')) return new Blob([raw], { type: mimeType || 'audio/wav' });
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await ctx.decodeAudioData(raw.buffer.slice(0));
    const channels = Math.min(audioBuffer.numberOfChannels, 2), sampleRate = audioBuffer.sampleRate;
    const encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128), block = 1152, chunks = [];
    const left = audioBuffer.getChannelData(0), right = channels > 1 ? audioBuffer.getChannelData(1) : null;
    const l = new Int16Array(block), r = channels > 1 ? new Int16Array(block) : null;
    for (let i = 0; i < left.length; i += block) {
      const n = Math.min(block, left.length - i);
      for (let j = 0; j < n; j++) { l[j] = Math.max(-32768, Math.min(32767, left[i+j] * 32767)); if (r) r[j] = Math.max(-32768, Math.min(32767, right[i+j] * 32767)); }
      const mp3buf = r ? encoder.encodeBuffer(l, r) : encoder.encodeBuffer(l);
      if (mp3buf.length) chunks.push(new Int8Array(mp3buf));
    }
    const end = encoder.flush(); if (end.length) chunks.push(new Int8Array(end));
    await ctx.close();
    return new Blob(chunks, { type: 'audio/mpeg' });
  } catch {
    return new Blob([raw], { type: mimeType || 'audio/wav' });
  }
}

buildVoicePanel();
