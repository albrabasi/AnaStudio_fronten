/**
 * AnaStudio Frontend
 * Compatible with the existing index.html.
 * Features: TTS, STT, Image Prompt, Voice Replication.
 */

const BACKEND_URL = "https://backend-gamma-liart-yfgzfi9y5j.vercel.app/api/generate";
const $ = (id) => document.getElementById(id);

let currentAudioUrl = null;
let imageBase64 = "";
let imageMimeType = "";
let mediaRecorder = null;
let audioChunks = [];
let sttAudioBase64 = "";
let sttAudioMimeType = "";
let voiceSourceBase64 = "";
let voiceSourceMime = "";
let voiceConsentBase64 = "";
let voiceConsentMime = "";
let selectedVoiceId = localStorage.getItem("anastudio_voice_id") || "";

// ------------------------------------------------------------
// Common helpers
// ------------------------------------------------------------
function showStatus(message, type = "") {
    const el = $("status");
    if (!el) return;
    el.textContent = message;
    el.className = `status ${type}`;
}

function setBusy(button, busy, normalLabel) {
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? "⏳ Sedang memproses..." : normalLabel;
}

async function callBackend(payload) {
    let response;
    try {
        response = await fetch(BACKEND_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
    } catch (error) {
        throw new Error("Tidak dapat terhubung ke backend Vercel: " + error.message);
    }

    const contentType = response.headers.get("content-type") || "";
    let data;

    if (contentType.includes("application/json")) {
        data = await response.json();
    } else {
        const raw = await response.text();
        throw new Error(`Backend HTTP ${response.status}: ${raw.slice(0, 500)}`);
    }

    if (!response.ok || data.success === false) {
        throw new Error(data.error || `Backend HTTP ${response.status}`);
    }

    return data;
}

function base64ToBlob(base64, mimeType) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType || "audio/wav" });
}

function downloadAudio(base64, mimeType, fileName) {
    const blob = base64ToBlob(base64, mimeType);
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = URL.createObjectURL(blob);

    $("audioPlayer").src = currentAudioUrl;
    $("audioPlayer").style.display = "block";
    $("downloadButton").href = currentAudioUrl;
    $("downloadButton").download = fileName || "AnaAudio.wav";
    $("downloadButton").style.display = "inline-block";
}

async function copyText(text) {
    await navigator.clipboard.writeText(text);
    showStatus("Berhasil disalin.");
}

// ------------------------------------------------------------
// Tabs
// ------------------------------------------------------------
document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
        tab.classList.add("active");
        const panel = $(tab.dataset.tab);
        if (panel) panel.classList.add("active");
        if (tab.dataset.tab === "voicePanel") loadVoiceList();
    });
});

// ------------------------------------------------------------
// TTS
// ------------------------------------------------------------
$("textInput")?.addEventListener("input", () => {
    $("characterCount").textContent = $("textInput").value.length;
});
$("characterCount").textContent = $("textInput")?.value.length || 0;

$("generateButton")?.addEventListener("click", generateVoice);

async function generateVoice() {
    const text = $("textInput").value.trim();
    if (!text) return showStatus("Teks narasi belum diisi.");

    const button = $("generateButton");
    setBusy(button, true, "▶ Generate MP3");
    showStatus("Gemini sedang membuat suara...");

    try {
        const voice = selectedVoiceId || $("voiceSelect")?.value || "Kore";
        const data = await callBackend({
            mode: "tts",
            text,
            style: $("styleInput")?.value.trim() || "natural, jelas, ramah",
            voiceName: voice,
            voiceId: selectedVoiceId || undefined,
            speed: $("speedSelect")?.value || "1.0",
            character: $("characterSelect")?.value || "ramah",
            model: selectedVoiceId ? "gemini-3.8-flash-tts" : "gemini-3.8-flash-tts"
        });

        downloadAudio(
            data.audioBase64,
            data.mimeType,
            `${$("fileNameInput")?.value.trim() || "AnaAudio_01"}.wav`
        );
        showStatus("Audio berhasil dibuat.", "success");
    } catch (error) {
        showStatus("Gagal membuat audio: " + error.message, "error");
    } finally {
        setBusy(button, false, "▶ Generate MP3");
    }
}

// ------------------------------------------------------------
// STT
// ------------------------------------------------------------
$("recordButton")?.addEventListener("click", startSttRecording);
$("stopRecordButton")?.addEventListener("click", stopSttRecording);
$("sttUploadBox")?.addEventListener("click", () => $("audioFileInput")?.click());
$("audioFileInput")?.addEventListener("change", handleSttFile);
$("generateSttButton")?.addEventListener("click", generateStt);
$("copySttButton")?.addEventListener("click", () => copyText($("sttOutput").value));

async function startSttRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const preferred = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus"
            : "audio/webm";
        mediaRecorder = new MediaRecorder(stream, { mimeType: preferred });
        audioChunks = [];

        mediaRecorder.ondataavailable = e => {
            if (e.data.size) audioChunks.push(e.data);
        };
        mediaRecorder.onstop = async () => {
            const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
            await loadBlobAsBase64(blob, (base64, mime) => {
                sttAudioBase64 = base64;
                sttAudioMimeType = mime;
            });
            $("sttAudioPreview").src = URL.createObjectURL(blob);
            $("sttAudioPreview").style.display = "block";
            stream.getTracks().forEach(t => t.stop());
            showStatus("Rekaman siap ditranskrip.");
        };

        mediaRecorder.start();
        $("recordButton").style.display = "none";
        $("stopRecordButton").style.display = "block";
        $("stopRecordButton").disabled = false;
        showStatus("Sedang merekam...");
    } catch (error) {
        showStatus("Mikrofon tidak dapat digunakan: " + error.message, "error");
    }
}

function stopSttRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
        $("stopRecordButton").style.display = "none";
        $("recordButton").style.display = "block";
        $("stopRecordButton").disabled = true;
    }
}

function handleSttFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
        return showStatus("Untuk Vercel, gunakan audio maksimal sekitar 4MB. File besar dapat melebihi batas request.", "error");
    }
    loadBlobAsBase64(file, (base64, mime) => {
        sttAudioBase64 = base64;
        sttAudioMimeType = mime || "audio/mpeg";
    }).then(() => {
        $("sttAudioPreview").src = URL.createObjectURL(file);
        $("sttAudioPreview").style.display = "block";
        showStatus("File audio siap ditranskrip.");
    });
}

async function generateStt() {
    if (!sttAudioBase64) return showStatus("Silakan rekam atau upload audio terlebih dahulu.");
    const button = $("generateSttButton");
    setBusy(button, true, "▶ Transkrip Audio ke Teks");
    showStatus("Gemini 3.5 Transcribe sedang bekerja...");

    try {
        const data = await callBackend({
            mode: "stt",
            audioBase64: sttAudioBase64,
            mimeType: sttAudioMimeType || "audio/webm",
            language: $("sttLanguage")?.value || "Indonesia"
        });
        $("sttOutput").value = data.transcription || "";
        $("copySttButton").style.display = "block";
        showStatus("Transkripsi selesai.", "success");
    } catch (error) {
        showStatus("Gagal transkripsi: " + error.message, "error");
    } finally {
        setBusy(button, false, "▶ Transkrip Audio ke Teks");
    }
}

// ------------------------------------------------------------
// Image prompt
// ------------------------------------------------------------
$("uploadBox")?.addEventListener("click", () => $("imageInput")?.click());
$("imageInput")?.addEventListener("change", handleImageUpload);
$("generateImageButton")?.addEventListener("click", generateImagePrompt);
$("copyPromptButton")?.addEventListener("click", () => copyText($("promptOutput").value));

function handleImageUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return showStatus("Ukuran gambar maksimal 10MB.", "error");
    imageMimeType = file.type || "image/jpeg";
    loadBlobAsBase64(file, (base64) => imageBase64 = base64).then(() => {
        $("imagePreview").src = URL.createObjectURL(file);
        $("imagePreview").style.display = "block";
        showStatus("Gambar siap diproses.");
    });
}

async function generateImagePrompt() {
    if (!imageBase64) return showStatus("Silakan upload gambar terlebih dahulu.");
    const button = $("generateImageButton");
    setBusy(button, true, "▶ Generate Prompt Video Flow");
    showStatus("Gemini sedang menganalisis gambar...");
    try {
        const data = await callBackend({
            mode: "image_prompt",
            imageBase64,
            mimeType: imageMimeType,
            videoType: $("imageStyle").value,
            duration: $("videoDuration").value,
            visualStyle: $("videoStyle").value,
            hook: $("hookInput").value,
            cta: $("ctaInput").value,
            language: $("imageLanguage").value,
            voiceName: selectedVoiceId || $("imageVoice").value
        });
        $("promptOutput").value = data.prompt || "";
        $("copyPromptButton").style.display = "block";
        showStatus("Prompt video berhasil dibuat.", "success");
    } catch (error) {
        showStatus("Gagal membuat prompt: " + error.message, "error");
    } finally {
        setBusy(button, false, "▶ Generate Prompt Video Flow");
    }
}

// ------------------------------------------------------------
// Voice Replication UI - injected into the existing #voicePanel
// ------------------------------------------------------------
function buildVoicePanel() {
    const panel = $("voicePanel");
    if (!panel || panel.dataset.ready === "1") return;
    panel.dataset.ready = "1";
    panel.innerHTML = `
      <div class="notice" style="margin-bottom:15px">
        <strong>Voice Clone Gemini</strong><br>
        Gunakan suara milik Anda sendiri. Gemini memerlukan audio referensi 10–30 detik dan rekaman consent dari orang dewasa yang sama.
      </div>
      <label>Nama Voice</label>
      <input id="cloneVoiceName" value="Suara Saya" maxlength="80" placeholder="Contoh: Suara Putra">

      <label>Audio Referensi</label>
      <div class="upload" id="cloneSourceBox">
        <strong>🎙 Upload / Rekam Audio Referensi</strong>
        <small>Disarankan WAV 24 kHz mono, 10–30 detik.</small>
        <input id="cloneSourceInput" type="file" accept="audio/wav,audio/mpeg,audio/mp3,audio/webm,audio/ogg" hidden>
      </div>
      <audio id="cloneSourcePreview" controls style="display:none;width:100%;margin:10px 0"></audio>

      <label>Audio Consent</label>
      <div class="upload" id="cloneConsentBox">
        <strong>🔐 Upload / Rekam Consent</strong>
        <small>Harus suara orang yang sama. Rekam persetujuan pemilik suara.</small>
        <input id="cloneConsentInput" type="file" accept="audio/wav,audio/mpeg,audio/mp3,audio/webm,audio/ogg" hidden>
      </div>
      <audio id="cloneConsentPreview" controls style="display:none;width:100%;margin:10px 0"></audio>
      <div class="notice" style="font-size:13px;margin:10px 0">
        Contoh kalimat consent: “I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model.”
      </div>

      <button class="primary" id="createVoiceButton">🎙 Buat Voice Clone</button>
      <button class="primary" id="refreshVoiceButton" style="background:#263548">↻ Muat Voice Saya</button>

      <label>Voice tersimpan</label>
      <select id="customVoiceSelect"><option value="">Pilih voice hasil clone</option></select>
      <button class="primary" id="deleteVoiceButton" style="background:#7b2d2d">🗑 Hapus Voice Terpilih</button>
      <div id="voiceCloneResult" class="notice" style="margin-top:12px">Belum ada voice clone dipilih.</div>
    `;

    $("cloneSourceBox").addEventListener("click", () => $("cloneSourceInput").click());
    $("cloneConsentBox").addEventListener("click", () => $("cloneConsentInput").click());
    $("cloneSourceInput").addEventListener("change", e => readVoiceFile(e.target.files?.[0], "source"));
    $("cloneConsentInput").addEventListener("change", e => readVoiceFile(e.target.files?.[0], "consent"));
    $("createVoiceButton").addEventListener("click", createVoiceClone);
    $("refreshVoiceButton").addEventListener("click", loadVoiceList);
    $("customVoiceSelect").addEventListener("change", () => {
        selectedVoiceId = $("customVoiceSelect").value;
        if (selectedVoiceId) {
            localStorage.setItem("anastudio_voice_id", selectedVoiceId);
            $("voiceCloneResult").textContent = `Voice aktif: ${selectedVoiceId}`;
        }
    });
    $("deleteVoiceButton").addEventListener("click", deleteSelectedVoice);
}

async function readVoiceFile(file, target) {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) return showStatus("Gunakan file audio maksimal sekitar 4MB.", "error");
    await loadBlobAsBase64(file, (base64, mime) => {
        if (target === "source") {
            voiceSourceBase64 = base64;
            voiceSourceMime = mime || "audio/wav";
            $("cloneSourcePreview").src = URL.createObjectURL(file);
            $("cloneSourcePreview").style.display = "block";
        } else {
            voiceConsentBase64 = base64;
            voiceConsentMime = mime || "audio/wav";
            $("cloneConsentPreview").src = URL.createObjectURL(file);
            $("cloneConsentPreview").style.display = "block";
        }
    });
    showStatus(`${target === "source" ? "Audio referensi" : "Audio consent"} siap.`);
}

async function createVoiceClone() {
    if (!voiceSourceBase64) return showStatus("Upload audio referensi terlebih dahulu.");
    if (!voiceConsentBase64) return showStatus("Upload audio consent terlebih dahulu.");

    const button = $("createVoiceButton");
    setBusy(button, true, "🎙 Buat Voice Clone");
    showStatus("Membuat voice clone dan memverifikasi consent...");
    try {
        const data = await callBackend({
            mode: "voice_create",
            displayName: $("cloneVoiceName").value.trim() || "AnaStudio Voice",
            sourceAudioBase64: voiceSourceBase64,
            sourceMimeType: voiceSourceMime || "audio/wav",
            consentAudioBase64: voiceConsentBase64,
            consentMimeType: voiceConsentMime || "audio/wav"
        });

        if (!data.voiceId) throw new Error("Gemini tidak mengembalikan voice ID.");
        selectedVoiceId = data.voiceId;
        localStorage.setItem("anastudio_voice_id", selectedVoiceId);
        $("voiceCloneResult").textContent = `Voice berhasil dibuat: ${selectedVoiceId}`;
        await loadVoiceList();
        showStatus("Voice clone berhasil dibuat. Voice tersebut sekarang dapat dipakai di TTS.", "success");
    } catch (error) {
        showStatus("Gagal membuat voice clone: " + error.message, "error");
    } finally {
        setBusy(button, false, "🎙 Buat Voice Clone");
    }
}

async function loadVoiceList() {
    buildVoicePanel();
    try {
        const data = await callBackend({ mode: "voice_list" });
        const select = $("customVoiceSelect");
        if (!select) return;
        select.innerHTML = `<option value="">Pilih voice hasil clone</option>`;
        for (const voice of data.voices || []) {
            const option = document.createElement("option");
            option.value = voice.id || "";
            option.textContent = `${voice.display_name || "Voice"} — ${voice.id || ""}`;
            select.appendChild(option);
        }
        if (selectedVoiceId && [...select.options].some(o => o.value === selectedVoiceId)) {
            select.value = selectedVoiceId;
        }
    } catch (error) {
        // Do not break the rest of the app if Voice API is temporarily unavailable.
        console.warn("Voice list:", error.message);
    }
}

async function deleteSelectedVoice() {
    const voiceId = $("customVoiceSelect")?.value || selectedVoiceId;
    if (!voiceId) return showStatus("Pilih voice yang akan dihapus.");
    if (!confirm("Hapus voice clone ini dari project Gemini?")) return;

    try {
        await callBackend({ mode: "voice_delete", voiceId });
        if (selectedVoiceId === voiceId) {
            selectedVoiceId = "";
            localStorage.removeItem("anastudio_voice_id");
        }
        await loadVoiceList();
        showStatus("Voice berhasil dihapus.", "success");
    } catch (error) {
        showStatus("Gagal menghapus voice: " + error.message, "error");
    }
}

// ------------------------------------------------------------
// File helper
// ------------------------------------------------------------
function loadBlobAsBase64(blob, callback) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                callback(reader.result.split(",")[1], blob.type);
                resolve();
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// Build Voice UI immediately; it uses the existing empty #voicePanel.
buildVoicePanel();
