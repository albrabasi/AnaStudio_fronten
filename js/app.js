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
  if (targetTab === 'videoConverterPanel') {
    initVideoConverter();
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
    
    const filename = ($('fileNameInput')?.value.trim() || 'AnaAudio_01').replace(/[^a-zA-Z0-9_-]/g, '_');$('downloadButton').download = `${filename}.mp3`;
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
    $('sttOutput').value = data.transcription || '';$('copySttButton').style.display = 'block';
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
      language: $('imageLanguage').value, voiceName:$('imageVoice').value,
      character: 'ramah', speed: '1.0'
    });
    $('promptOutput').value = data.narration || '';$('copyPromptButton').style.display = 'block';
    const blob = await audioBase64ToMp3(data.audioBase64, data.mimeType || 'audio/wav');
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = URL.createObjectURL(blob);
    $('audioPlayer').src = currentAudioUrl;
    $('audioPlayer').style.display = 'block';$('downloadButton').href = currentAudioUrl;
    $('downloadButton').download = (($('imageFileName')?.value.trim() || 'AnaImageVoiceover').replace(/[^a-zA-Z0-9_-]/g, '_')) + '.mp3';$('downloadButton').style.display = 'block';
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
    $('audioPlayer').style.display = 'block';$('downloadButton').href = currentAudioUrl;
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

  $('convertSourceBox').onclick = () => $('convertSourceInput').click();$('convertSourceInput').onchange = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) return showStatus('Ukuran file audio maksimal 25MB.');
    const b64 = await readFileAsBase64(file);
    convertSourceBase64 = b64;
    convertSourceMime = file.type || 'audio/webm';
    $('convertSourcePreview').src = URL.createObjectURL(file);$('convertSourcePreview').style.display = 'block';
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
      $('audioPlayer').style.display = 'block';$('downloadButton').href = currentAudioUrl;
      $('downloadButton').style.display = 'block';$('downloadButton').download = 'AnaStudio_VoiceConverted.mp3';
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
  fields.forEach(id => { if ($(id))$(id).value = ''; });
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
      $('customSubject').value = r.subject || '';$('customSubject').dispatchEvent(new Event('input'));
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
    if ($('customDescription'))$('customDescription').value = data.description || '';
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
  if ($('fighterDirectorForm'))$('fighterDirectorForm').style.display = directorMode === 'fighter' ? 'block' : 'none';
  if ($('customDirectorForm'))$('customDirectorForm').style.display = directorMode === 'custom' ? 'block' : 'none';
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
        name: $('char1Name').value, genderAge:$('char1Gender').value,
        appearance: $('char1Appearance').value, clothing:$('char1Clothing').value,
        fightingStyle: $('char1Style').value, refLock:$('char1Lock').checked,
        imageBase64: directorImages.char1.base64, mimeType: directorImages.char1.mimeType, fileName: directorImages.char1.fileName
      },
      character2: {
        name: $('char2Name').value, genderAge:$('char2Gender').value,
        appearance: $('char2Appearance').value, clothing:$('char2Clothing').value,
        fightingStyle: $('char2Style').value, refLock:$('char2Lock').checked,
        imageBase64: directorImages.char2.base64, mimeType: directorImages.char2.mimeType, fileName: directorImages.char2.fileName
      },
      environment: {
        location: $('fightLocation').value, atmosphere:$('fightAtmosphere').value,
        details: $('fightDetails').value, aspectRatio:$('fightRatio').value,
        cinematicStyle: $('fightCinematic').value
      },
      action: {
        duration: $('fightDuration').value, tempo:$('fightTempo').value,
        intensity: $('fightIntensity').value, camera:$('fightCamera').value,
        ending: $('fightEnding').value
      },
      choreography: {
        combination: $('fightCombination').value, attacks:$('fightAttacks').value,
        movement: $('fightMovement').value, impact:$('fightImpact').value,
        logic: $('fightLogic').value
      }
    };
  }
  return {
    mode: 'prompt_director', directorType: 'custom', language,
    scene: {
      type: $('customSceneType').value, description:$('customDescription').value,
      subject: $('customSubject').value, product:$('customProduct').value,
      subjectRefLock: $('customSubjectLock').checked,
      imageBase64: directorImages.custom.base64, mimeType: directorImages.custom.mimeType, fileName: directorImages.custom.fileName
    },
    environment: {
      location: $('customLocation').value, timeWeather:$('customTime').value,
      background: $('customBackground').value, lighting:$('customLighting').value
    },
    directing: {
      camera: $('customCamera').value, cinematicStyle:$('customCinematic').value,
      duration: $('customDuration').value, aspectRatio:$('customRatio').value,
      mood: $('customMood').value, instructions:$('customInstructions').value
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
  if ($('directorFinalOutput'))$('directorFinalOutput').value = '⏳ AI Prompt Director sedang menyusun hasil...';
  if ($('directorTimelineOutput'))$('directorTimelineOutput').value = '';
  if ($('directorSummaryOutput'))$('directorSummaryOutput').value = '';
  if ($('directorJsonOutput'))$('directorJsonOutput').value = '';
}

function displayDirectorResult(data) {
  openDirectorModal();
  $('directorFinalOutput').value = data.finalPrompt || '';$('directorTimelineOutput').value = data.timeline || '';
  $('directorSummaryOutput').value = data.summary || '';$('directorJsonOutput').value = JSON.stringify(data.json || data.input || {}, null, 2);
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
    if ($('directorFinalOutput'))$('directorFinalOutput').value = `❌ Gagal membuat prompt.\n\n${message}`;
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


/* ==========================================
   WT REMOVER — terintegrasi dengan panel AnaStudio (berdasarkan Wt_remover.html)
   ========================================== */
function initWtRemover() {
  const view = $('view');
  if (!view) return;
  
  if (view.dataset.initialized === 'true') return;
  view.dataset.initialized = 'true';

  const vctx = view.getContext('2d', { alpha: false });
  const video = document.createElement('video'); video.playsInline = true;
  video.preload = 'auto'; video.setAttribute('playsinline', '');
  video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.appendChild(video);
  video.onerror = () => say('Video tidak bisa dibaca browser ini. Coba Chrome/Edge di komputer, atau ubah videonya ke MP4 H.264.');
  video.onloadeddata = () => { dirty = boxDirty = true; };
  const mk = rd => { const c = document.createElement('canvas'); return [c, c.getContext('2d', rd ? { willReadFrequently: true } : undefined)]; };
  const [mask, mctx] = mk(true), [mini, mnctx] = mk(true), [tint, tctx] = mk(), [small, sctx] = mk(), [small2, s2ctx] = mk(), [tmp, xctx] = mk();
  let boxes = [], boxDirty = true;
  const P = 40, DOWN = 6;
  let W = 0, H = 0, tool = 'brush', drawing = false, last = null, dirty = boxDirty = true, recording = false, undoStack = [];

  function fmt(t){ t = Math.max(0, t|0); return Math.floor(t/60) + ':' + String(t%60).padStart(2,'0'); }
  function say(t){ const st = $('wtStatus'); if (st) st.textContent = t; }

  const fileInput = $('file');
  if (fileInput) {
    fileInput.onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      video.src = URL.createObjectURL(f);
      say('Memuat video…');
    };
  }

  video.onloadedmetadata = () => {
    W = video.videoWidth; H = video.videoHeight;
    for (const c of [view, mask, tint, tmp]) { c.width = W; c.height = H; }
    small.width = small2.width = Math.round(W / DOWN) + 2 * P;
    small.height = small2.height = Math.round(H / DOWN) + 2 * P;
    const wrapEl = $('wrap');
    if (wrapEl) wrapEl.style.maxWidth = Math.round(innerHeight * 0.78 * W / H) + 'px';
    undoStack = []; dirty = boxDirty = true;
    const saved = localStorage.getItem('anastudio_wt_mask_' + W + 'x' + H);
    if (saved) { const im = new Image(); im.onload = () => { mctx.drawImage(im, 0, 0); dirty = boxDirty = true; say('Area tersimpan untuk ukuran ' + W + '×' + H + ' dimuat.'); }; im.src = saved; }
    else say('Video ' + W + '×' + H + ' siap. Jeda di frame yang jelas, lalu brush area logo.');
    video.currentTime = 0.05;
    for (const id of ['play','seek','render']) { const el = $(id); if (el) el.disabled = false; }
  };

  video.ontimeupdate = () => {
    if (!video.duration) return;
    const seekEl = $('seek');
    if (seekEl) seekEl.value = Math.round(video.currentTime / video.duration * 1000);
    const timeEl = $('time');
    if (timeEl) timeEl.textContent = fmt(video.currentTime) + ' / ' + fmt(video.duration);
    if (recording) say('Merender… ' + Math.round(video.currentTime / video.duration * 100) + '% (biarkan tab ini tetap terbuka)');
  };
  video.onplay = () => { const p = $('play'); if (p) p.textContent = 'Jeda'; };
  video.onpause = () => { const p = $('play'); if (p) p.textContent = 'Putar'; };
  const playBtn = $('play');
  if (playBtn) playBtn.onclick = () => video.paused ? video.play() : video.pause();
  const seekEl = $('seek');
  if (seekEl) seekEl.oninput = e => { video.currentTime = e.target.value / 1000 * video.duration; };

  function computeBoxes() {
    const mw = Math.ceil(W / 8), mh = Math.ceil(H / 8);
    mini.width = mw; mini.height = mh;
    mnctx.clearRect(0, 0, mw, mh); mnctx.drawImage(mask, 0, 0, mw, mh);
    const d = mnctx.getImageData(0, 0, mw, mh).data, seen = new Uint8Array(mw * mh);
    const blurEl = $('blur');
    const pad = Math.ceil((blurEl ? +blurEl.value : 28) * 3 + 16);
    boxes = [];
    for (let i = 0; i < mw * mh; i++) {
      if (seen[i] || d[i * 4 + 3] < 6) continue;
      let x0 = mw, y0 = mh, x1 = 0, y1 = 0; const st = [i]; seen[i] = 1;
      while (st.length) {
        const j = st.pop(), x = j % mw, y = (j / mw) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (const n of [x > 0 ? j - 1 : -1, x < mw - 1 ? j + 1 : -1, y > 0 ? j - mw : -1, y < mh - 1 ? j + mw : -1])
          if (n >= 0 && !seen[n] && d[n * 4 + 3] >= 6) { seen[n] = 1; st.push(n); }
      }
      const bx0 = Math.max(0, x0 * 8 - pad), by0 = Math.max(0, y0 * 8 - pad);
      const bx1 = Math.min(W, (x1 + 1) * 8 + pad), by1 = Math.min(H, (y1 + 1) * 8 + pad);
      boxes.push([bx0, by0, bx1 - bx0, by1 - by0]);
    }
    boxDirty = false;
  }

  function fxBox([x, y, w, h]) {
    const sw = Math.max(1, Math.round(w / DOWN)), sh = Math.max(1, Math.round(h / DOWN)), tw = sw + 2 * P, th = sh + 2 * P;
    sctx.clearRect(0, 0, tw, th);
    sctx.drawImage(video, x, y, w, h, P, P, sw, sh);
    sctx.drawImage(video, x, y, 1, h, 0, P, P, sh);
    sctx.drawImage(video, x + w - 1, y, 1, h, P + sw, P, P, sh);
    sctx.drawImage(video, x, y, w, 1, P, 0, sw, P);
    sctx.drawImage(video, x, y + h - 1, w, 1, P, P + sh, sw, P);
    s2ctx.clearRect(0, 0, tw, th);
    const blurEl = $('blur');
    s2ctx.filter = 'blur(' + ((blurEl ? +blurEl.value : 28) / DOWN) + 'px)';
    s2ctx.drawImage(small, 0, 0, tw, th, 0, 0, tw, th);
    s2ctx.filter = 'none';
    xctx.save();
    xctx.beginPath(); xctx.rect(x, y, w, h); xctx.clip();
    xctx.clearRect(x, y, w, h);
    xctx.imageSmoothingQuality = 'high';
    xctx.drawImage(small2, P, P, sw, sh, x, y, w, h);
    const styleEl = $('style');
    if (styleEl && styleEl.value === 'frost') { xctx.fillStyle = 'rgba(255,255,255,.14)'; xctx.fillRect(x, y, w, h); }
    xctx.globalCompositeOperation = 'destination-in';
    xctx.drawImage(mask, 0, 0);
    xctx.restore();
    vctx.drawImage(tmp, x, y, w, h, x, y, w, h);
  }

  function applyFx() {
    if (boxDirty) computeBoxes();
    for (const b of boxes) fxBox(b);
  }

  function drawTint() {
    if (dirty) {
      tctx.globalCompositeOperation = 'copy'; tctx.drawImage(mask, 0, 0);
      tctx.globalCompositeOperation = 'source-in'; tctx.fillStyle = 'rgba(255,40,70,.55)'; tctx.fillRect(0, 0, W, H);
      tctx.globalCompositeOperation = 'source-over'; dirty = false;
    }
    vctx.drawImage(tint, 0, 0);
  }

  function paint() {
    if (!W) return;
    vctx.drawImage(video, 0, 0, W, H);
    const fxEl = $('fx');
    if ((fxEl && fxEl.checked) || recording) applyFx();
    const showMaskEl = $('showMask');
    if (!recording && (showMaskEl && showMaskEl.checked)) drawTint();
  }
  function frame() { if (!recording) paint(); requestAnimationFrame(frame); }
  requestAnimationFrame(frame);

  const blurEl = $('blur'), sizeEl = $('size');
  if (blurEl) blurEl.oninput = () => { boxDirty = true; };
  if (sizeEl) sizeEl.oninput = () => { boxDirty = true; };

  const pos = e => { const r = view.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  function stroke(a, b) {
    const s = sizeEl ? +sizeEl.value : 70;
    mctx.globalCompositeOperation = tool === 'brush' ? 'source-over' : 'destination-out';
    mctx.strokeStyle = '#fff'; mctx.shadowColor = '#fff'; mctx.shadowBlur = s * 0.3;
    mctx.lineWidth = s; mctx.lineCap = 'round'; mctx.lineJoin = 'round';
    mctx.beginPath(); mctx.moveTo(a.x, a.y); mctx.lineTo(b.x + 0.01, b.y); mctx.stroke();
    mctx.shadowBlur = 0; dirty = boxDirty = true;
  }
  function pushUndo() { undoStack.push(mctx.getImageData(0, 0, W, H)); if (undoStack.length > 8) undoStack.shift(); }
  
  view.addEventListener('pointerdown', e => {
    if (!W || recording) return;
    view.setPointerCapture(e.pointerId); pushUndo(); drawing = true; last = pos(e); stroke(last, last);
  });
  view.addEventListener('pointermove', e => { if (drawing) { const p = pos(e); stroke(last, p); last = p; } });
  for (const ev of ['pointerup', 'pointercancel']) view.addEventListener(ev, () => drawing = false);

  const tBrush = $('tBrush'), tErase = $('tErase'), undoBtn = $('undo'), clearBtn = $('clear'), saveBtn = $('save');
  if (tBrush) tBrush.onclick = () => { tool = 'brush'; tBrush.classList.add('on'); if (tErase) tErase.classList.remove('on'); };
  if (tErase) tErase.onclick = () => { tool = 'erase'; tErase.classList.add('on'); if (tBrush) tBrush.classList.remove('on'); };
  if (undoBtn) undoBtn.onclick = () => { const d = undoStack.pop(); if (d) { mctx.putImageData(d, 0, 0); dirty = boxDirty = true; } };
  if (clearBtn) clearBtn.onclick = () => { if (!W) return; pushUndo(); mctx.clearRect(0, 0, W, H); dirty = boxDirty = true; };
  if (saveBtn) saveBtn.onclick = () => { if (!W) return; localStorage.setItem('anastudio_wt_mask_' + W + 'x' + H, mask.toDataURL()); say('Area disimpan. Akan dimuat otomatis untuk video ' + W + '×' + H + '.'); };

  const renderBtn = $('render');
  const once = (el, ev) => new Promise(r => el.addEventListener(ev, r, { once: true }));
  if (renderBtn) {
    renderBtn.onclick = async () => {
      if (!W || recording) return;
      const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
      const mime = window.MediaRecorder && types.find(t => MediaRecorder.isTypeSupported(t));
      if (!mime) { say('Browser ini belum mendukung perekaman video. Gunakan Chrome atau Edge.'); return; }
      recording = true; renderBtn.disabled = true; 
      const outDiv = $('out');
      if (outDiv) outDiv.style.display = 'none';
      video.pause();
      if (video.currentTime > 0) { video.currentTime = 0; await once(video, 'seeked'); }
      const canReq = window.CanvasCaptureMediaStreamTrack && 'requestFrame' in CanvasCaptureMediaStreamTrack.prototype;
      const stream = view.captureStream(canReq ? 0 : 30);
      const vt = stream.getVideoTracks()[0];
      const step = () => {
        if (!recording) return;
        paint(); if (canReq) vt.requestFrame();
        if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(step); else requestAnimationFrame(step);
      };
      try { video.captureStream().getAudioTracks().forEach(t => stream.addTrack(t)); } catch (_) {}
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 });
      const chunks = [];
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const ext = mime.includes('mp4') ? 'mp4' : 'webm';
        const url = URL.createObjectURL(new Blob(chunks, { type: mime.split(';')[0] }));
        const resEl = $('result');
        if (resEl) resEl.src = url; 
        const dlEl = $('dl');
        if (dlEl) { dlEl.href = url; dlEl.download = 'video-bersih.' + ext; }
        if (outDiv) outDiv.style.display = 'grid';
        recording = false; renderBtn.disabled = false; dirty = boxDirty = true;
        say('Selesai. Periksa hasilnya, lalu unduh.');
      };
      video.onended = () => { video.onended = null; rec.stop(); };
      rec.start(); paint(); if (canReq) vt.requestFrame();
      await video.play(); step();
    };
  }

  setupTelegramIntegration('wtTgSend', 'wtTgStatus', () => $('result')?.src);
}

function initTelegramModal() {
  const modal = $('telegramModal');
  const openBtn = $('openTelegramModalBtn');
  const closeBtn = $('closeTelegramModal');
  const saveBtn = $('saveTelegramModalBtn');
  const tokenInput = $('modalTgToken');
  const chatIdInput = $('modalTgChatId');
  const statusEl = $('modalTgStatus');

  if (tokenInput) tokenInput.value = localStorage.getItem('telegram_bot_token') || '';
  if (chatIdInput) chatIdInput.value = localStorage.getItem('telegram_chat_id') || '';

  if (openBtn) {
    openBtn.onclick = () => {
      if (modal) {
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('director-modal-open');
      }
      if (tokenInput) tokenInput.value = localStorage.getItem('telegram_bot_token') || '';
      if (chatIdInput) chatIdInput.value = localStorage.getItem('telegram_chat_id') || '';
      if (statusEl) statusEl.textContent = '';
    };
  }

  const closeModal = () => {
    if (modal) {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('director-modal-open');
    }
  };

  if (closeBtn) closeBtn.onclick = closeModal;
  if (modal) modal.onclick = e => { if (e.target === modal) closeModal(); };

  if (saveBtn) {
    saveBtn.onclick = () => {
      const token = tokenInput ? tokenInput.value.trim() : '';
      const chatId = chatIdInput ? chatIdInput.value.trim() : '';
      if (!token || !chatId) {
        if (statusEl) { statusEl.textContent = '❌ Bot Token & Chat ID wajib diisi.'; statusEl.style.color = '#f87171'; }
        return;
      }
      localStorage.setItem('telegram_bot_token', token);
      localStorage.setItem('telegram_chat_id', chatId);
      if (statusEl) {
        statusEl.textContent = '✅ Berhasil disimpan ke browser (localStorage)!';
        statusEl.style.color = '#2dd4bf';
      }
      setTimeout(closeModal, 1000);
    };
  }
}

function setupTelegramIntegration(sendBtnId, statusId, getFileBlobOrUrlFunc) {
  const sendBtn = $(sendBtnId);
  const statusEl = $(statusId);

  if (sendBtn) {
    sendBtn.onclick = async () => {
      const token = localStorage.getItem('telegram_bot_token');
      const chatId = localStorage.getItem('telegram_chat_id');
      if (!token || !chatId) {
        if (statusEl) {
          statusEl.textContent = '⚠️ Konfigurasi Telegram belum diisi! Klik tombol "🤖 Telegram Bot" di atas.';
          statusEl.style.color = '#facc15';
        }
        const modal = $('telegramModal');
        if (modal) {
          modal.classList.add('open');
          modal.setAttribute('aria-hidden', 'false');
          document.body.classList.add('director-modal-open');
        }
        return;
      }
      const source = typeof getFileBlobOrUrlFunc === 'function' ? getFileBlobOrUrlFunc() : null;
      if (!source) {
        if (statusEl) {
          statusEl.textContent = '❌ Belum ada file video hasil proses.';
          statusEl.style.color = '#f87171';
        }
        return;
      }

      sendBtn.disabled = true;
      if (statusEl) {
        statusEl.textContent = '⏳ Mengirim video ke Telegram...';
        statusEl.style.color = '#facc15';
      }

      try {
        let blob = source;
        if (typeof source === 'string') {
          const resp = await fetch(source);
          blob = await resp.blob();
        }

        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('video', blob, 'AnaStudio_Result.mp4');
        formData.append('caption', '🎬 Video berhasil diproses via AnaStudio Pro');

        const tgResp = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
          method: 'POST',
          body: formData
        });
        const tgData = await tgResp.json();

        if (tgData.ok) {
          if (statusEl) {
            statusEl.textContent = '✅ Berhasil! Video terkirim ke Telegram.';
            statusEl.style.color = '#2dd4bf';
          }
        } else {
          throw new Error(tgData.description || 'Gagal mengirim video.');
        }
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = '❌ Gagal: ' + err.message;
          statusEl.style.color = '#f87171';
        }
      } finally {
        sendBtn.disabled = false;
      }
    };
  }
}

initTelegramModal();

/* ==========================================
   VIDEO CONVERTER — terintegrasi dengan server lokal (berdasarkan konverter-h265-ke-h264.html)
   ========================================== */
function initVideoConverter() {
  const panel = $('videoConverterPanel');
  if (!panel || panel.dataset.initialized === 'true') return;
  panel.dataset.initialized = 'true';

  const API = 'http://localhost:8765';
  let file = null, poll = null, t0 = 0;

  function fmt(s) { return Math.floor(s/60) + ':' + String(Math.floor(s%60)).padStart(2,'0'); }
  function pick(f) {
    if (!f) return;
    file = f;
    const info = $('convInfo');
    if (info) info.textContent = f.name + ' - ' + (f.size/1048576).toFixed(1) + ' MB';
    const go = $('convGo');
    if (go) go.disabled = false;
    const out = $('convOut');
    if (out) out.hidden = true;
    const log = $('convLog');
    if (log) log.textContent = '';
  }

  const fInput = $('convF');
  if (fInput) {
    fInput.onchange = function(e) { pick(e.target.files[0]); };
  }

  const dropZone = $('convDrop');
  if (dropZone) {
    ['dragenter','dragover'].forEach(function(ev){ dropZone.addEventListener(ev, function(e){ e.preventDefault(); dropZone.classList.add('on'); }); });
    ['dragleave','drop'].forEach(function(ev){ dropZone.addEventListener(ev, function(e){ e.preventDefault(); dropZone.classList.remove('on'); }); });
    dropZone.addEventListener('drop', function(e){ pick(e.dataTransfer.files[0]); });
  }

  function finish() {
    clearInterval(poll);
    const go = $('convGo'); if (go) go.disabled = false;
    const stop = $('convStop'); if (stop) stop.hidden = true;
  }

  async function checkServerConnection() {
    const statusEl = $('convServerStatus');
    if (statusEl) statusEl.textContent = 'Status Server: Mengecek koneksi ke http://localhost:8765...';
    try {
      const res = await fetch(API + '/status', { method: 'GET' });
      if (res.ok || res.status < 500) {
        if (statusEl) {
          statusEl.textContent = 'Status Server: ✅ Terhubung ke server lokal (Port 8765)';
          statusEl.style.color = '#2dd4bf';
        }
        return true;
      }
    } catch {
      try {
        await fetch(API + '/status', { mode: 'no-cors' });
        if (statusEl) {
          statusEl.textContent = 'Status Server: ✅ Terhubung ke server lokal (Port 8765)';
          statusEl.style.color = '#2dd4bf';
        }
        return true;
      } catch {
        if (statusEl) {
          statusEl.textContent = 'Status Server: ❌ Belum terhubung. Jalankan jalankan-konverter.bat terlebih dahulu!';
          statusEl.style.color = '#f87171';
        }
        return false;
      }
    }
  }

  const checkBtn = $('convCheckBtn');
  if (checkBtn) {
    checkBtn.onclick = checkServerConnection;
  }

  const copyCmdBtn = $('convCopyCmdBtn');
  if (copyCmdBtn) {
    copyCmdBtn.onclick = async () => {
      const cmdText = 'cmd.exe /c jalankan-konverter.bat';
      try {
        await navigator.clipboard.writeText(cmdText);
        showStatus('Perintah CMD berhasil disalin ke clipboard: ' + cmdText);
      } catch {
        showStatus('Gagal menyalin otomatis. Silakan jalankan jalankan-konverter.bat secara manual.');
      }
    };
  }

  function check() {
    fetch(API+'/status').then(function(r){return r.json()}).then(function(s){
      const el = (Date.now()-t0)/1000;
      let txt;
      const pBar = $('convP');
      const logDiv = $('convLog');
      if (s.state==='running'){
        if (s.dur>0){
          const pct = Math.min(99, s.sec/s.dur*100);
          if (pBar) { pBar.value = pct; pBar.hidden = false; }
          txt = 'Mengonversi... '+Math.round(pct)+'% - video '+fmt(s.sec)+' / '+fmt(s.dur);
          if (s.sec>0.5) txt += ' - sisa sekitar '+fmt(el*(s.dur-s.sec)/s.sec);
        } else {
          if (pBar) pBar.removeAttribute('value');
          txt = 'Mengonversi...';
        }
        if (logDiv) logDiv.textContent = txt + ' - berjalan ' + fmt(el);
      } else if (s.state==='done'){
        finish();
        if (pBar) pBar.value = 100;
        if (logDiv) logDiv.textContent = 'Selesai. Ukuran hasil: '+(s.size/1048576).toFixed(1)+' MB';
        const vEl = $('convV');
        if (vEl) { vEl.src = API+'/video?'+Date.now(); }
        const outDiv = $('convOut');
        if (outDiv) outDiv.hidden = false;
      } else if (s.state==='error'){
        finish();
        if (pBar) pBar.hidden = true;
        if (logDiv) logDiv.textContent = 'Gagal:\n'+s.msg;
      }
    }).catch(function(){});
  }

  const goBtn = $('convGo');
  if (goBtn) {
    goBtn.onclick = function(){
      if (!file) return;
      goBtn.disabled = true;
      const outDiv = $('convOut'); if (outDiv) outDiv.hidden = true;
      const pBar = $('convP'); if (pBar) { pBar.hidden = false; pBar.removeAttribute('value'); }
      const logDiv = $('convLog');

      const x = new XMLHttpRequest();
      const resSel = $('convRes');
      const crfSel = $('convCrf');
      const resVal = resSel ? resSel.value : '720';
      const crfVal = crfSel ? crfSel.value : '24';

      x.open('POST', API+'/upload?name='+encodeURIComponent(file.name)+'&res='+resVal+'&crf='+crfVal);
      x.upload.onprogress = function(e){
        if (e.lengthComputable && logDiv) logDiv.textContent = 'Menyiapkan file... '+Math.round(e.loaded/e.total*100)+'%';
      };
      x.onload = function(){
        if (x.status!==200){
          finish();
          if (pBar) pBar.hidden = true;
          if (logDiv) logDiv.textContent = 'Gagal: '+x.responseText;
          return;
        }
        t0 = Date.now();
        const stopBtn = $('convStop'); if (stopBtn) stopBtn.hidden = false;
        clearInterval(poll);
        poll = setInterval(check, 500);
        check();
      };
      x.onerror = function(){
        finish();
        if (pBar) pBar.hidden = true;
        if (logDiv) logDiv.textContent = 'Gagal menghubungi server lokal. Pastikan jalankan-konverter.bat sudah dijalankan dan jendela PowerShell terbuka (http://localhost:8765/).';
      };
      x.send(file);
    };
  }

  const stopBtn = $('convStop');
  if (stopBtn) {
    stopBtn.onclick = function(){ fetch(API+'/cancel',{method:'POST'}); };
  }

  checkServerConnection();
  setupTelegramIntegration('convTgSend', 'convTgStatus', () => $('convV')?.src);
}