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

// Tabs (Desktop & Mobile Bottom Nav)
document.querySelectorAll('.tab, .mobile-nav-item').forEach(btn => btn.addEventListener('click', () => {
  const targetTab = btn.dataset.tab;
  document.querySelectorAll('.tab, .mobile-nav-item').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === targetTab);
  });
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  $(targetTab)?.classList.add('active');
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
  try {
    showStatus('Menyiapkan gambar produk...');
    const compressed = await compressImageForUpload(file);
    imageBase64 = compressed.base64;
    imageMimeType = compressed.mimeType;
    $('imagePreview').src = URL.createObjectURL(file);
    $('imagePreview').style.display = 'block';
    showStatus('Gambar siap diproses. Versi terkompresi akan dikirim ke AI.');
  } catch (error) {
    imageBase64 = ''; imageMimeType = '';
    showStatus('Gagal menyiapkan gambar: ' + error.message);
  }
});
$('generateImageButton')?.addEventListener('click', generateImagePrompt);
$('copyPromptButton')?.addEventListener('click', async () => { await navigator.clipboard.writeText($('promptOutput').value); showStatus('Prompt berhasil disalin.'); });
$('generateHookBtn')?.addEventListener('click', () => generateHookOrCta('hook'));
$('generateCtaBtn')?.addEventListener('click', () => generateHookOrCta('cta'));

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
      videoType: $('imageStyle').value, duration: $('videoDuration').value,
      narrationStyle: $('videoStyle').value, description: $('imageDescription')?.value.trim() || '', hook: $('hookInput').value, cta: $('ctaInput').value,
      language: $('imageLanguage').value, voiceName: $('imageVoice').value,
      character: 'ramah', speed: '1.0'
    });
    $('promptOutput').value = data.narration || '';
    $('copyPromptButton').style.display = 'block';
    const blob = await audioBase64ToMp3(data.audioBase64, data.mimeType || 'audio/wav');
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = URL.createObjectURL(blob);
    $('audioPlayer').src = currentAudioUrl;
    $('audioPlayer').style.display = 'block';
    $('downloadButton').href = currentAudioUrl;
    $('downloadButton').download = (($('imageFileName')?.value.trim() || 'AnaImageVoiceover').replace(/[^a-zA-Z0-9_-]/g, '_')) + '.mp3';
    $('downloadButton').style.display = 'block';
    showStatus('Voice-over berhasil dibuat dari analisis gambar.');
  } catch (e) { showStatus('Terjadi kesalahan: ' + e.message); }
  finally { setBusy(button, false, '▶ Buat Voice-over dari Gambar'); }
}

$('generateAudioFromPromptButton')?.addEventListener('click', async () => {
  const promptText = $('promptOutput')?.value.trim();
  if (!promptText) return showStatus('Prompt video belum tersedia.');
  const button = $('generateAudioFromPromptButton');
  setBusy(button, true, '▶ Buat Suara Narasi dari Prompt');
  showStatus('Membuat suara narasi dari prompt...');
  try {
    const data = await callBackend({
      mode: 'tts',
      text: promptText,
      voiceName: $('imageVoice')?.value || 'Kore',
      style: 'natural, jelas, ramah',
      speed: '1.0',
      character: 'ramah'
    });
    const blob = await audioBase64ToMp3(data.audioBase64, data.mimeType || 'audio/wav');
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = URL.createObjectURL(blob);
    $('audioPlayer').src = currentAudioUrl;
    $('audioPlayer').style.display = 'block';
    $('downloadButton').href = currentAudioUrl;
    $('downloadButton').style.display = 'block';
    $('downloadButton').download = ($('imageFileName')?.value.trim() || 'AnaPromptVoice') + '.mp3';
    showStatus('Suara narasi berhasil dibuat dari prompt!');
  } catch (e) {
    showStatus('Gagal membuat suara narasi: ' + e.message);
  } finally {
    setBusy(button, false, '▶ Buat Suara Narasi dari Prompt');
  }
});

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

console.info('AnaStudio Prompt Director v2026.10.08.3 loaded');

// ---------------- AI PROMPT DIRECTOR ----------------
let directorMode = 'fighter';
const directorImages = {
  char1: { base64: '', mimeType: '', fileName: '' },
  char2: { base64: '', mimeType: '', fileName: '' },
  custom: { base64: '', mimeType: '', fileName: '' }
};

async function compressImageForUpload(file, maxSize = 800, quality = 0.55) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        let scale = Math.min(1, maxSize / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
        let width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
        let height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
        let dataUrl = '';
        // Keep the JSON request lightweight for fast upload and inference.
        for (let attempt = 0; attempt < 5; attempt++) {
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d', { alpha: false });
          if (!ctx) throw new Error('Browser tidak mendukung pemrosesan gambar.');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          dataUrl = canvas.toDataURL('image/jpeg', quality);
          const estimatedBytes = Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
          if (estimatedBytes <= 350 * 1024) break;
          if (quality > 0.4) quality -= 0.08;
          else { width = Math.max(400, Math.round(width * 0.75)); height = Math.max(400, Math.round(height * 0.75)); }
        }
        const base64 = dataUrl.split(',')[1] || '';
        const estimatedBytes = Math.floor(base64.length * 0.75);
        URL.revokeObjectURL(url);
        if (!base64 || estimatedBytes > 600 * 1024) throw new Error('Gambar masih terlalu besar setelah kompresi.');
        resolve({ base64, mimeType: 'image/jpeg' });
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Gagal membaca gambar.')); };
    img.src = url;
  });
}

function ensureDirectorPreviewClearButton(slot) {
  const preview = $(`fighterChar${slot}Preview`);
  if (!preview) return null;
  let wrap = preview.parentElement;
  if (!wrap?.classList.contains('director-preview-wrap')) {
    wrap = document.createElement('div');
    wrap.className = 'director-preview-wrap';
    preview.parentNode.insertBefore(wrap, preview);
    wrap.appendChild(preview);
  }
  let clear = $(`clearChar${slot}Btn`);
  if (!clear) {
    clear = document.createElement('button');
    clear.type = 'button';
    clear.id = `clearChar${slot}Btn`;
    clear.className = 'preview-clear';
    clear.setAttribute('aria-label', `Hapus referensi karakter ${slot}`);
    clear.textContent = '×';
    wrap.appendChild(clear);
  }
  clear.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearDirectorImage(slot);
  };
  return clear;
}

function clearDirectorImage(slot) {
  directorImages[`char${slot}`] = { base64: '', mimeType: '', fileName: '' };
  const input = $(`fighterChar${slot}Input`);
  const preview = $(`fighterChar${slot}Preview`);
  if (input) input.value = '';
  if (preview) {
    preview.src = '';
    preview.style.display = 'none';
  }
  const fields = [`char${slot}Name`, `char${slot}Gender`, `char${slot}Appearance`, `char${slot}Clothing`];
  fields.forEach(id => { if ($(id)) $(id).value = ''; });
  showStatus(`Referensi karakter ${slot} dihapus. Silakan pilih gambar baru.`);
}

function setupDirectorImage(slot) {
  const input = $(`fighterChar${slot}Input`);
  const box = $(`fighterChar${slot}Box`);
  const preview = $(`fighterChar${slot}Preview`);
  if (!input || !box || !preview) return;
  ensureDirectorPreviewClearButton(slot);

  box.onclick = (event) => {
    if (event.target === input) return;
    input.click();
  };

  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return showStatus('File referensi harus berupa gambar.');
    if (file.size > 10 * 1024 * 1024) return showStatus('Ukuran gambar karakter maksimal 10MB.');
    try {
      showStatus(`Menyiapkan referensi karakter ${slot}...`);
      const compressed = await compressImageForUpload(file);
      directorImages[`char${slot}`] = { ...compressed, fileName: file.name };
      preview.src = URL.createObjectURL(file);
      preview.style.display = 'block';
      showStatus(`Referensi karakter ${slot} siap. Gambar sudah dikompres untuk server.`);
    } catch (err) {
      input.value = '';
      showStatus('Gagal menyiapkan gambar: ' + err.message);
    }
  };
}

function ensureCustomPreviewClearButton() {
  const preview = $('customImagePreview');
  if (!preview) return null;
  let wrap = preview.parentElement;
  if (!wrap?.classList.contains('director-preview-wrap')) {
    wrap = document.createElement('div');
    wrap.className = 'director-preview-wrap';
    preview.parentNode.insertBefore(wrap, preview);
    wrap.appendChild(preview);
  }
  let clear = $('clearCustomBtn');
  if (!clear) {
    clear = document.createElement('button');
    clear.type = 'button';
    clear.id = 'clearCustomBtn';
    clear.className = 'preview-clear';
    clear.setAttribute('aria-label', 'Hapus referensi kustom');
    clear.textContent = '×';
    wrap.appendChild(clear);
  }
  clear.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearCustomImage();
  };
  return clear;
}

function clearCustomImage() {
  directorImages.custom = { base64: '', mimeType: '', fileName: '' };
  const input = $('customImageInput');
  const preview = $('customImagePreview');
  if (input) input.value = '';
  if (preview) {
    preview.src = '';
    preview.style.display = 'none';
  }
  showStatus('Referensi gambar kustom dihapus.');
}

function setupCustomImage() {
  const input = $('customImageInput');
  const box = $('customImageBox');
  const preview = $('customImagePreview');
  if (!input || !box || !preview) return;
  ensureCustomPreviewClearButton();

  box.onclick = (event) => {
    if (event.target === input) return;
    input.click();
  };

  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return showStatus('File referensi harus berupa gambar.');
    if (file.size > 10 * 1024 * 1024) return showStatus('Ukuran gambar maksimal 10MB.');
    try {
      showStatus('Menyiapkan referensi gambar kustom...');
      const compressed = await compressImageForUpload(file);
      directorImages.custom = { ...compressed, fileName: file.name };
      preview.src = URL.createObjectURL(file);
      preview.style.display = 'block';
      showStatus('Referensi gambar kustom siap.');
    } catch (err) {
      input.value = '';
      showStatus('Gagal menyiapkan gambar: ' + err.message);
    }
  };
}

async function analyzeCustomImage() {
  const img = directorImages.custom;
  if (!img.base64) return showStatus('Upload referensi gambar kustom terlebih dahulu.');
  const btn = $('analyzeCustomBtn');
  if (!btn) return;
  const original = btn.dataset.originalText || btn.textContent;
  btn.dataset.originalText = original;
  setBusy(btn, true, original);
  showStatus('AI sedang menganalisis gambar referensi subjek...');
  try {
    const data = await callBackend({
      mode: 'analyze_custom_image',
      imageBase64: img.base64,
      mimeType: img.mimeType
    });
    const r = data.customAnalysis || {};
    if ($('customSubject')) {
      $('customSubject').value = r.subject || '';
      $('customSubject').dispatchEvent(new Event('input'));
    }
    showStatus('Analisis gambar selesai! Subjek / Karakter berhasil diisi.');
  } catch (e) {
    showStatus('Gagal menganalisis gambar: ' + e.message);
  } finally {
    setBusy(btn, false, original);
  }
}

// Custom Scene AI Suggestion Handler
$('customSubject')?.addEventListener('input', () => {
  const val = $('customSubject').value.trim();
  const btn = $('generateCustomSceneBtn');
  if (btn) btn.disabled = !val;
});

$('generateCustomSceneBtn')?.addEventListener('click', async () => {
  const subject = $('customSubject')?.value.trim();
  if (!subject) return showStatus('Subjek / Karakter belum diisi.');
  const btn = $('generateCustomSceneBtn');
  const original = btn.dataset.originalText || btn.textContent;
  btn.dataset.originalText = original;
  setBusy(btn, true, original);
  showStatus('AI sedang membuat saran deskripsi adegan...');
  try {
    const data = await callBackend({
      mode: 'generate_custom_scene',
      sceneType: $('customSceneType')?.value || 'Influencer',
      subject
    });
    if ($('customDescription')) $('customDescription').value = data.description || '';
    showStatus('Saran deskripsi adegan berhasil dibuat!');
  } catch (e) {
    showStatus('Gagal membuat saran adegan: ' + e.message);
  } finally {
    setBusy(btn, false, original);
  }
});

function updateDirectorModeUI() {
  document.querySelectorAll('.mode-tab').forEach(b => {
    const active = b.dataset.mode === directorMode;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
  if ($('fighterDirectorForm')) $('fighterDirectorForm').style.display = directorMode === 'fighter' ? 'block' : 'none';
  if ($('customDirectorForm')) $('customDirectorForm').style.display = directorMode === 'custom' ? 'block' : 'none';
  const marker = $('directorModeMarker');
  if (marker) marker.textContent = `MODE AKTIF: ${directorMode === 'fighter' ? '⚔️ FIGHTER' : '🎬 UMUM / CUSTOM'}`;
}

setupDirectorImage(1);
setupDirectorImage(2);
setupCustomImage();
updateDirectorModeUI();

document.querySelectorAll('.mode-tab').forEach(btn => btn.addEventListener('click', () => {
  directorMode = btn.dataset.mode || 'fighter';
  updateDirectorModeUI();
  closeDirectorModal();
  showStatus('');
}));

async function analyzeDirectorCharacter(slot) {
  const img = directorImages[`char${slot}`];
  if (!img.base64) return showStatus(`Upload referensi karakter ${slot} terlebih dahulu.`);
  const btn = $(`analyzeChar${slot}Btn`);
  if (!btn) return showStatus(`Tombol analisis karakter ${slot} tidak ditemukan.`);
  const original = btn.dataset.originalText || btn.textContent;
  btn.dataset.originalText = original;
  setBusy(btn, true, original);
  showStatus(`AI sedang menganalisis karakter ${slot}...`);
  try {
    const data = await callBackend({
      mode: 'analyze_character',
      imageBase64: img.base64,
      mimeType: img.mimeType
    });
    const r = data.character || {};
    if ($(`char${slot}Name`)) $('char' + slot + 'Name').value = r.name || '';
    if ($(`char${slot}Gender`)) $('char' + slot + 'Gender').value = r.gender_age || '';
    if ($(`char${slot}Appearance`)) $('char' + slot + 'Appearance').value = r.appearance || '';
    if ($(`char${slot}Clothing`)) $('char' + slot + 'Clothing').value = r.clothing || '';
    showStatus(`Analisis karakter ${slot} selesai. Silakan koreksi jika diperlukan.`);
  } catch (e) {
    showStatus('Gagal menganalisis karakter: ' + e.message);
  } finally {
    setBusy(btn, false, original);
  }
}

// Explicit bindings untuk memastikan tombol aktif.
const analyze1 = $('analyzeChar1Btn');
const analyze2 = $('analyzeChar2Btn');
const analyzeCustom = $('analyzeCustomBtn');
if (analyze1) analyze1.onclick = (e) => { e.preventDefault(); analyzeDirectorCharacter(1); };
if (analyze2) analyze2.onclick = (e) => { e.preventDefault(); analyzeDirectorCharacter(2); };
if (analyzeCustom) analyzeCustom.onclick = (e) => { e.preventDefault(); analyzeCustomImage(); };

function directorPayload() {
  const language = $('directorLanguage')?.value || 'Indonesia';
  if (directorMode === 'fighter') {
    return {
      mode: 'prompt_director', directorType: 'fighter', language,
      character1: {
        name: $('char1Name').value, genderAge: $('char1Gender').value,
        appearance: $('char1Appearance').value, clothing: $('char1Clothing').value,
        fightingStyle: $('char1Style').value, refLock: $('char1Lock').checked,
        imageBase64: directorImages.char1.base64, mimeType: directorImages.char1.mimeType, fileName: directorImages.char1.fileName
      },
      character2: {
        name: $('char2Name').value, genderAge: $('char2Gender').value,
        appearance: $('char2Appearance').value, clothing: $('char2Clothing').value,
        fightingStyle: $('char2Style').value, refLock: $('char2Lock').checked,
        imageBase64: directorImages.char2.base64, mimeType: directorImages.char2.mimeType, fileName: directorImages.char2.fileName
      },
      environment: {
        location: $('fightLocation').value, atmosphere: $('fightAtmosphere').value,
        details: $('fightDetails').value, aspectRatio: $('fightRatio').value,
        cinematicStyle: $('fightCinematic').value
      },
      action: {
        duration: $('fightDuration').value, tempo: $('fightTempo').value,
        intensity: $('fightIntensity').value, camera: $('fightCamera').value,
        ending: $('fightEnding').value
      },
      choreography: {
        combination: $('fightCombination').value, attacks: $('fightAttacks').value,
        movement: $('fightMovement').value, impact: $('fightImpact').value,
        logic: $('fightLogic').value
      }
    };
  }
  return {
    mode: 'prompt_director', directorType: 'custom', language,
    scene: {
      type: $('customSceneType').value, description: $('customDescription').value,
      subject: $('customSubject').value, product: $('customProduct').value,
      subjectRefLock: $('customSubjectLock').checked,
      imageBase64: directorImages.custom.base64, mimeType: directorImages.custom.mimeType, fileName: directorImages.custom.fileName
    },
    environment: {
      location: $('customLocation').value, timeWeather: $('customTime').value,
      background: $('customBackground').value, lighting: $('customLighting').value
    },
    directing: {
      camera: $('customCamera').value, cinematicStyle: $('customCinematic').value,
      duration: $('customDuration').value, aspectRatio: $('customRatio').value,
      mood: $('customMood').value, instructions: $('customInstructions').value
    }
  };
}

function openDirectorModal() {
  const modal = $('directorResultModal');
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('director-modal-open');
}
function closeDirectorModal() {
  const modal = $('directorResultModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('director-modal-open');
}
function showDirectorModalLoading() {
  openDirectorModal();
  if ($('directorFinalOutput')) $('directorFinalOutput').value = '⏳ AI Prompt Director sedang menyusun hasil...';
  if ($('directorTimelineOutput')) $('directorTimelineOutput').value = '';
  if ($('directorSummaryOutput')) $('directorSummaryOutput').value = '';
  if ($('directorJsonOutput')) $('directorJsonOutput').value = '';
}

function displayDirectorResult(data) {
  openDirectorModal();
  $('directorFinalOutput').value = data.finalPrompt || '';
  $('directorTimelineOutput').value = data.timeline || '';
  $('directorSummaryOutput').value = data.summary || '';
  $('directorJsonOutput').value = JSON.stringify(data.json || data.input || {}, null, 2);
  document.querySelectorAll('.result-tab').forEach(b => b.classList.toggle('active', b.dataset.result === 'final'));
  document.querySelectorAll('.director-output').forEach(el => el.style.display = 'none');
  $('directorFinalOutput').style.display = 'block';
}

$('generateDirectorButton')?.addEventListener('click', async () => {
  const payload = directorPayload();
  if (directorMode === 'custom' && !payload.scene.description.trim()) return showStatus('Deskripsi adegan belum diisi.');
  const btn = $('generateDirectorButton');
  setBusy(btn, true, '✨ Generate Prompt');
  showDirectorModalLoading();
  showStatus('AI Prompt Director sedang menyusun adegan, timeline, dan prompt...');
  try {
    const data = await callBackend(payload);
    displayDirectorResult(data);
    showStatus('Prompt Director berhasil dibuat.');
  } catch (e) {
    const message = e.message || 'Kesalahan tidak diketahui.';
    if ($('directorFinalOutput')) $('directorFinalOutput').value = `❌ Gagal membuat prompt.\n\n${message}`;
    showStatus('Terjadi kesalahan: ' + message);
  } finally {
    setBusy(btn, false, '✨ Generate Prompt');
  }
});

document.querySelectorAll('.result-tab').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.result-tab').forEach(b => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.director-output').forEach(el => el.style.display = 'none');
  const map = { final: 'directorFinalOutput', timeline: 'directorTimelineOutput', summary: 'directorSummaryOutput', json: 'directorJsonOutput' };
  if ($(map[btn.dataset.result])) $(map[btn.dataset.result]).style.display = 'block';
}));

$('copyDirectorButton')?.addEventListener('click', async () => {
  const active = document.querySelector('.result-tab.active')?.dataset.result || 'final';
  const map = { final: 'directorFinalOutput', timeline: 'directorTimelineOutput', summary: 'directorSummaryOutput', json: 'directorJsonOutput' };
  const value = $(map[active])?.value || '';
  try {
    await navigator.clipboard.writeText(value);
    showStatus('Hasil berhasil disalin.');
  } catch {
    showStatus('Gagal menyalin otomatis. Silakan copy manual dari panel.');
  }
});

$('closeDirectorModal')?.addEventListener('click', closeDirectorModal);
$('directorResultModal')?.addEventListener('click', e => {
  if (e.target.id === 'directorResultModal') closeDirectorModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDirectorModal(); });

$('resetDirectorButton')?.addEventListener('click', () => {
  const ids = ['char1Name','char1Gender','char1Appearance','char1Clothing','char2Name','char2Gender','char2Appearance','char2Clothing','fightDetails','fightAttacks','customDescription','customSubject','customProduct','customLocation','customTime','customBackground','customLighting','customMood','customInstructions'];
  ids.forEach(id => { if ($(id)) $(id).value = ''; });
  directorImages.char1 = {base64:'',mimeType:'',fileName:''};
  directorImages.char2 = {base64:'',mimeType:'',fileName:''};
  directorImages.custom = {base64:'',mimeType:'',fileName:''};
  ['fighterChar1Input','fighterChar2Input','customImageInput'].forEach(id => { if ($(id)) $(id).value = ''; });
  ['fighterChar1Preview','fighterChar2Preview','customImagePreview'].forEach(id => { if ($(id)) { $(id).src=''; $(id).style.display='none'; }});
  ['char1Lock','char2Lock','customSubjectLock'].forEach(id => { if ($(id)) $(id).checked = true; });
  const genBtn = $('generateCustomSceneBtn');
  if (genBtn) genBtn.disabled = true;
  if ($('directorLanguage')) $('directorLanguage').value = 'Indonesia';
  directorMode = 'fighter';
  updateDirectorModeUI();
  closeDirectorModal();
  showStatus('Prompt Director telah di-reset ke mode FIGHTER.');
});
