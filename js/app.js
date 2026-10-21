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
  if (!response.ok || !data.success) {
    if (response.status === 413) throw new Error('Request terlalu besar (413). Pastikan aplikasi memakai app.js versi terbaru dan gambar sudah terkompresi.');
    throw new Error(data.error || `Server HTTP ${response.status}`);
  }
  return data;
}

function showStatus(message) { if ($('status'))$('status').textContent = message; }
function setBusy(button, busy, label) { if (!button) return; button.disabled = busy; button.textContent = busy ? '⏳ Sedang memproses...' : label; }
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Tabs (Desktop & Mobile Bottom Nav)
document.querySelectorAll('.tab, .mobile-nav-item').forEach(btn => btn.addEventListener('click', () => {
  const targetTab = btn.dataset.tab;
  document.querySelectorAll('.tab, .mobile-nav-item').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === targetTab);
  });
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  $(targetTab)?.classList.add('active');
  if (targetTab === 'wtRemoverPanel') {
    initWtRemover();
  }
  showStatus('');
}));

// TTS
$('textInput')?.addEventListener('input', () => { $('characterCount').textContent =$('textInput').value.length; });
$('generateButton')?.addEventListener('click', generateVoice);$('textInput')?.dispatchEvent(new Event('input'));

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
    $('audioPlayer').style.display = 'block';$('downloadButton').href = currentAudioUrl;
    const filename = ($('fileNameInput')?.value.trim() \vert{}\vert{} 'AnaAudio_01').replace(/[^a-zA-Z0-9_-]/g, '_');$('downloadButton').download = `${filename}.mp3`;
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
      $('sttAudioPreview').src = URL.createObjectURL(blob);$('sttAudioPreview').style.display = 'block';
      showStatus('Rekaman siap ditranskrip.');
      stream.getTracks().forEach(t => t.stop());
    };
    mediaRecorder.start();
    $('recordButton').style.display = 'none';
    $('stopRecordButton').style.display = 'block';$('stopRecordButton').disabled = false;
    showStatus('Sedang merekam suara...');
  } catch (e) { showStatus('Gagal mengakses mikrofon: ' + e.message); }
});
$('stopRecordButton')?.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  $('stopRecordButton').style.display = 'none';
  $('recordButton').style.display = 'block';$('stopRecordButton').disabled = true;
});
$('sttUploadBox')?.addEventListener('click', () => $('audioFileInput').click());$('audioFileInput')?.addEventListener('change', async e => {
  const file = e.target.files?.[0]; if (!file) return;
  if (file.size > 25 * 1024 * 1024) return showStatus('Ukuran file audio maksimal 25MB.');
  sttAudioMimeType = file.type || 'audio/wav';
  sttAudioBase64 = await readFileAsBase64(file);
  $('sttAudioPreview').src = URL.createObjectURL(file);$('sttAudioPreview').style.display = 'block';
  showStatus('File audio siap ditranskrip.');
});
$('generateSttButton')?.addEventListener('click', generateStt);
$('copySttButton')?.addEventListener('click', async () => { await navigator.clipboard.writeText($('sttOutput').value); showStatus('Hasil transkripsi berhasil disalin.'); });
async function generateStt() {
  if (!sttAudioBase64) return showStatus('Silakan rekam atau upload audio terlebih dahulu.');
  const button = $('generateSttButton'); setBusy(button, true, '▶ Transkrip Audio ke Teks'); showStatus('Gemini 3.5 Transcribe sedang bekerja...');
  try {
    const data = await callBackend({ mode: 'stt', audioBase64: sttAudioBase64, mimeType: sttAudioMimeType, language: $('sttLanguage')?.value || 'Indonesia' });
    $('sttOutput').value = data.transcription \vert{}\vert{} '';$('copySttButton').style.display = 'block';
    showStatus('Transkripsi berhasil.');
  } catch (e) { showStatus('Terjadi kesalahan: ' + e.message); }
  finally { setBusy(button, false, '▶ Transkrip Audio ke Teks'); }
}

// Image Prompt
$('uploadBox')?.addEventListener('click', () => $('imageInput').click());$('imageInput')?.addEventListener('change', async e => {
  const file = e.target.files?.[0]; if (!file) return;
  if (file.size > 10 * 1024 * 1024) return showStatus('Ukuran gambar maksimal 10MB.');
  try {
    showStatus('Menyiapkan gambar produk...');
    const compressed = await compressImageForUpload(file);
    imageBase64 = compressed.base64;
    imageMimeType = compressed.mimeType;
    $('imagePreview').src = URL.createObjectURL(file);$('imagePreview').style.display = 'block';
    showStatus('Gambar siap diproses. Versi terkompresi akan dikirim ke AI.');
  } catch (error) {
    imageBase64 = ''; imageMimeType = '';
    showStatus('Gagal menyiapkan gambar: ' + error.message);
  }
});
$('generateImageButton')?.addEventListener('click', generateImagePrompt);
$('copyPromptButton')?.addEventListener('click', async () => { await navigator.clipboard.writeText($('promptOutput').value); showStatus('Prompt berhasil disalin.'); });
$('generateHookBtn')?.addEventListener('click', () => generateHookOrCta('hook'));$('generateCtaBtn')?.addEventListener('click', () => generateHookOrCta('cta'));

async function generateHookOrCta(type) {
  if (!imageBase64) return showStatus('Silakan upload gambar produk terlebih dahulu.');
  const btnId = type === 'hook' ? 'generateHookBtn' : 'generateCtaBtn';
  const button = $(btnId);
  const originalText = button.textContent;
  setBusy(button, true, originalText);
  showStatus(`AI sedang membuat ${type.toUpperCase()}...`);
  try {
    const data = await callBackend({
      mode: 'generate_hook_cta',
      type,
      imageBase64,
      mimeType: imageMimeType,
      videoType: $('imageStyle').value
    });
    if (type === 'hook') {
      $('hookInput').value = data.result || '';
    } else {
      $('ctaInput').value = data.result || '';
    }
    showStatus(`AI ${type.toUpperCase()} berhasil dibuat!`);
  } catch (e) {
    showStatus(`Gagal membuat ${type}: ` + e.message);
  } finally {
    setBusy(button, false, originalText);
  }
}
async function generateImagePrompt() {
  if (!imageBase64) return showStatus('Silakan upload gambar terlebih dahulu.');
  const button = $('generateImageButton'); setBusy(button, true, '▶ Buat Voice-over dari Gambar'); showStatus('AI sedang menganalisis gambar dan menulis voice-over...');
  try {
    const data = await callBackend({
      mode: 'image_voiceover', imageBase64, mimeType: imageMimeType,
      videoType: $('imageStyle').value, duration:$('videoDuration').value,
      narrationStyle: $('videoStyle').value, description:$('imageDescription')?.value.trim() || '', hook: $('hookInput').value, cta:$('ctaInput').value,
      language: $('imageLanguage').value, voiceName:
