/* ==========================================
   WT REMOVER — terintegrasi dengan panel AnaStudio
   ========================================== */
function initWtRemover() {
  const view = $('removerView');
  if (!view) return;
  
  // Cegah duplikasi event listener jika sudah diinisialisasi sebelumnya
  if (view.dataset.initialized === 'true') {
    // Cukup pastikan ukuran canvas disesuaikan ulang jika video sudah ada
    return;
  }
  view.dataset.initialized = 'true';

  const vctx = view.getContext('2d');
  const video = document.createElement('video'); 
  video.playsInline = true;
  
  const mk = () => { const c = document.createElement('canvas'); return [c, c.getContext('2d', { willReadFrequently: true })]; };
  const [mask, mctx] = mk(), [tint, tctx] = mk(), [small, sctx] = mk(), [small2, s2ctx] = mk(), [tmp, xctx] = mk();
  const P = 40, DOWN = 6;
  let W = 0, H = 0, tool = 'brush', drawing = false, last = null, dirty = true, recording = false, undoStack = [];

  function fmt(t){ t = Math.max(0, t|0); return Math.floor(t/60) + ':' + String(t%60).padStart(2,'0'); }
  function say(t){ if ($('removerStatus')) $('removerStatus').textContent = t; }

  let currentVideoUrl = null;

  video.preload = 'auto';

  if ($('removerFile')) {
    $('removerFile').onchange = e => {
      const f = e.target.files?.[0];
      if (!f) return;

      if (!f.type.startsWith('video/')) {
        say('File yang dipilih bukan video.');
        return;
      }

      if (currentVideoUrl) {
        URL.revokeObjectURL(currentVideoUrl);
      }

      video.pause();
      video.removeAttribute('src');
      video.load();

      currentVideoUrl = URL.createObjectURL(f);
      video.src = currentVideoUrl;
      video.load();

      say('Memuat video: ' + f.name);
    };
  }

  video.onloadedmetadata = () => {
    W = video.videoWidth;
    H = video.videoHeight;

    if (!W || !H) {
      say('Ukuran video tidak terbaca. Coba file video lain.');
      return;
    }

    for (const c of [view, mask, tint, tmp]) {
      c.width = W;
      c.height = H;
    }

    small.width = small2.width = Math.round(W / DOWN) + 2 * P;
    small.height = small2.height = Math.round(H / DOWN) + 2 * P;

    if ($('removerWrap')) {
      $('removerWrap').style.maxWidth = Math.round(innerHeight * 0.78 * W / H) + 'px';
    }

    undoStack = [];
    dirty = true;

    const saved = localStorage.getItem('anastudio_wt_mask_' + W + 'x' + H);
    if (saved) {
      const im = new Image();
      im.onload = () => {
        mctx.drawImage(im, 0, 0);
        dirty = true;
        say('Area tersimpan untuk ukuran ' + W + '×' + H + ' dimuat.');
      };
      im.src = saved;
    } else {
      say('Video ' + W + '×' + H + ' siap. Jeda di frame yang jelas, lalu brush area logo.');
    }

    if ($('removerPlay')) {
      $('removerPlay').disabled = false;
      $('removerPlay').textContent = '▶ Putar';
    }
    if ($('removerSeek')) {
      $('removerSeek').disabled = false;
      $('removerSeek').value = '0';
    }
    if ($('removerRender')) {
      $('removerRender').disabled = false;
    }
    if ($('removerTime')) {
      $('removerTime').textContent = '0:00 / ' + fmt(video.duration);
    }

    video.currentTime = 0;
  };

  video.ontimeupdate = () => {
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;

    if ($('removerSeek')) {
      $('removerSeek').value = String(Math.round(video.currentTime / video.duration * 1000));
    }

    if ($('removerTime')) {
      $('removerTime').textContent = fmt(video.currentTime) + ' / ' + fmt(video.duration);
    }

    if (recording) {
      say('Merender… ' + Math.round(video.currentTime / video.duration * 100) + '% (biarkan tab ini tetap terbuka)');
    }
  };

  video.onplay = () => { if ($('removerPlay')) $('removerPlay').textContent = '❚❚ Jeda'; };
  video.onpause = () => { if ($('removerPlay')) $('removerPlay').textContent = '▶ Putar'; };

  if ($('removerPlay')) {
    $('removerPlay').onclick = async () => {
      try {
        if (video.paused) { await video.play(); } else { video.pause(); }
      } catch (err) {
        console.error('Gagal memutar video:', err);
        say('Video gagal diputar. Coba pilih ulang file video.');
      }
    };
  }

  if ($('removerSeek')) {
    $('removerSeek').oninput = e => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = (Number(e.target.value) / 1000) * video.duration;
      }
    };
  }

  /* ---------- efek blur / kaca es di area mask ---------- */
  function applyFx() {
    const vw = W, vh = H, sw = small.width - 2*P, sh = small.height - 2*P;
    sctx.drawImage(video, P, P, sw, sh);
    sctx.drawImage(video, 0, 0, 1, vh, 0, P, P, sh);
    sctx.drawImage(video, vw-1, 0, 1, vh, P+sw, P, P, sh);
    sctx.drawImage(video, 0, 0, vw, 1, P, 0, sw, P);
    sctx.drawImage(video, 0, vh-1, vw, 1, P, P+sh, sw, P);
    
    const blurVal = $('removerBlur') ? +$('removerBlur').value : 25;
    s2ctx.filter = 'blur(' + (blurVal / DOWN) + 'px)';
    s2ctx.clearRect(0, 0, small2.width, small2.height);
    s2ctx.drawImage(small, 0, 0);
    s2ctx.filter = 'none';
    xctx.globalCompositeOperation = 'copy';
    xctx.imageSmoothingQuality = 'high';
    xctx.drawImage(small2, P, P, sw, sh, 0, 0, W, H);
    
    if ($('removerStyle') && $('removerStyle').value === 'frost') {
      xctx.globalCompositeOperation = 'source-over';
      xctx.fillStyle = 'rgba(255,255,255,.14)';
      xctx.fillRect(0, 0, W, H);
    }
    xctx.globalCompositeOperation = 'destination-in';
    xctx.drawImage(mask, 0, 0);
    xctx.globalCompositeOperation = 'source-over';
    vctx.drawImage(tmp, 0, 0);
  }

  function drawTint() {
    if (dirty) {
      tctx.globalCompositeOperation = 'copy'; tctx.drawImage(mask, 0, 0);
      tctx.globalCompositeOperation = 'source-in'; tctx.fillStyle = 'rgba(255,40,70,.55)'; tctx.fillRect(0, 0, W, H);
      tctx.globalCompositeOperation = 'source-over'; dirty = false;
    }
    vctx.drawImage(tint, 0, 0);
  }

  function frame() {
    if (W && video.readyState >= video.HAVE_CURRENT_DATA) {
      vctx.drawImage(video, 0, 0, W, H);
      const fxChecked = $('removerFx') ? $('removerFx').checked : true;
      if (fxChecked || recording) applyFx();
      const showMaskChecked = $('removerShowMask') ? $('removerShowMask').checked : true;
      if (!recording && showMaskChecked) drawTint();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ---------- brush ---------- */
  const pos = e => { const r = view.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  function stroke(a, b) {
    const s = $('removerSize') ? +$('removerSize').value : 40;
    mctx.globalCompositeOperation = tool === 'brush' ? 'source-over' : 'destination-out';
    mctx.strokeStyle = '#fff'; mctx.shadowColor = '#fff'; mctx.shadowBlur = s * 0.3;
    mctx.lineWidth = s; mctx.lineCap = 'round'; mctx.lineJoin = 'round';
    mctx.beginPath(); mctx.moveTo(a.x, a.y); mctx.lineTo(b.x + 0.01, b.y); mctx.stroke();
    mctx.shadowBlur = 0; dirty = true;
  }
  function pushUndo() { undoStack.push(mctx.getImageData(0, 0, W, H)); if (undoStack.length > 8) undoStack.shift(); }
  
  view.addEventListener('pointerdown', e => {
    if (!W || recording) return;
    view.setPointerCapture(e.pointerId); pushUndo(); drawing = true; last = pos(e); stroke(last, last);
  });
  view.addEventListener('pointermove', e => { if (drawing) { const p = pos(e); stroke(last, p); last = p; } });
  for (const ev of ['pointerup', 'pointercancel']) view.addEventListener(ev, () => drawing = false);

  if ($('removerTBrush')) $('removerTBrush').onclick = () => { tool = 'brush'; $('removerTBrush').classList.add('on'); if ($('removerTErase')) $('removerTErase').classList.remove('on'); };
  if ($('removerTErase')) $('removerTErase').onclick = () => { tool = 'erase'; $('removerTErase').classList.add('on'); if ($('removerTBrush')) $('removerTBrush').classList.remove('on'); };
  if ($('removerUndo')) $('removerUndo').onclick = () => { const d = undoStack.pop(); if (d) { mctx.putImageData(d, 0, 0); dirty = true; } };
  if ($('removerClear')) $('removerClear').onclick = () => { if (!W) return; pushUndo(); mctx.clearRect(0, 0, W, H); dirty = true; };
  if ($('removerSave')) $('removerSave').onclick = () => { if (!W) return; localStorage.setItem('anastudio_wt_mask_' + W + 'x' + H, mask.toDataURL()); say('Area disimpan. Akan dimuat otomatis untuk video ' + W + '×' + H + '.'); };

  /* ---------- render ---------- */
  const once = (el, ev) => new Promise(r => el.addEventListener(ev, r, { once: true }));
  if ($('removerRender')) {
    $('removerRender').onclick = async () => {
      if (!W || recording) return;
      const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
      const mime = window.MediaRecorder && types.find(t => MediaRecorder.isTypeSupported(t));
      if (!mime) { say('Browser ini belum mendukung perekaman video. Gunakan Chrome atau Edge.'); return; }
      recording = true; $('removerRender').disabled = true; if ($('removerOut')) $('removerOut').style.display = 'none';
      video.pause();
      if (video.currentTime > 0) { video.currentTime = 0; await once(video, 'seeked'); }
      const stream = view.captureStream(30);
      try { video.captureStream().getAudioTracks().forEach(t => stream.addTrack(t)); } catch (_) {}
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12e6 });
      const chunks = [];
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const ext = mime.includes('mp4') ? 'mp4' : 'webm';
        const url = URL.createObjectURL(new Blob(chunks, { type: mime.split(';')[0] }));
        if ($('removerResult')) $('removerResult').src = url;
        if ($('removerDl')) { $('removerDl').href = url; $('removerDl').download = 'video-bersih.' + ext; }
        if ($('removerOut')) $('removerOut').style.display = 'grid';
        recording = false; $('removerRender').disabled = false; dirty = true;
        say('Selesai. Periksa hasilnya, lalu unduh.');
      };
      video.onended = () => { video.onended = null; rec.stop(); };
      rec.start(); await video.play();
    };
  }
}
