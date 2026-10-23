# Konverter H.265 -> H.264 + AAC (memakai ffmpeg lokal)
# Jalankan lewat jalankan-konverter.bat, atau:
#   powershell -ExecutionPolicy Bypass -File konverter.ps1
$ErrorActionPreference = 'Stop'
$port = 8765
$work = Join-Path $env:TEMP 'konverter-h265'
New-Item -ItemType Directory -Force $work | Out-Null

$ff = $null
$cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($cmd) { $ff = $cmd.Source }
if (-not $ff -and $PSScriptRoot) {
  $loc = Join-Path $PSScriptRoot 'ffmpeg.exe'
  if (Test-Path $loc) { $ff = $loc }
}
if (-not $ff) {
  Write-Host 'ffmpeg tidak ditemukan. Pastikan ffmpeg ada di PATH, atau taruh ffmpeg.exe satu folder dengan skrip ini.' -ForegroundColor Red
  Read-Host 'Tekan Enter untuk keluar'
  exit
}

$html = @'
<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Konverter H.265 &rarr; H.264 + AAC</title>
<style>
:root{--bg:#f6f5f1;--card:#fff;--tx:#1d1d1b;--mut:#6b6b66;--ac:#0f6e56;--bd:#dcdad2}
@media(prefers-color-scheme:dark){:root{--bg:#161614;--card:#21211e;--tx:#ecebe5;--mut:#9a9990;--ac:#3fbf98;--bd:#383833}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.5 system-ui,Segoe UI,Roboto,sans-serif;padding:24px 16px}
main{max-width:640px;margin:0 auto;background:var(--card);border:1px solid var(--bd);border-radius:16px;padding:24px}
h1{font-size:1.35rem;margin:0 0 4px}
.sub{color:var(--mut);margin:0 0 20px;font-size:.9rem}
#drop{display:block;border:2px dashed var(--bd);border-radius:12px;padding:28px 12px;text-align:center;cursor:pointer;color:var(--mut)}
#drop.on,#drop:hover{border-color:var(--ac);color:var(--ac)}
#f{display:none}
#info{margin:10px 0;font-size:.9rem;color:var(--mut);word-break:break-all}
.row{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}
.row label{flex:1;min-width:150px;font-size:.85rem;color:var(--mut)}
select{width:100%;margin-top:4px;padding:9px;border-radius:8px;border:1px solid var(--bd);background:var(--card);color:var(--tx);font-size:1rem}
button,.btn{display:inline-block;background:var(--ac);color:#fff;border:0;border-radius:10px;padding:12px 20px;font-size:1rem;cursor:pointer;text-decoration:none;margin-right:8px}
button.sec{background:transparent;color:var(--tx);border:1px solid var(--bd)}
button:disabled{opacity:.45;cursor:not-allowed}
progress{width:100%;height:12px;margin-top:16px}
#log{margin-top:8px;font-size:.85rem;color:var(--mut);white-space:pre-wrap;min-height:1.3em}
#out{margin-top:18px}
video{width:100%;border-radius:10px;background:#000;margin-bottom:12px;max-height:60vh}
</style></head>
<body><main>
<h1>Konverter H.265 &rarr; H.264 + AAC</h1>
<p class="sub">Memakai ffmpeg yang terpasang di laptopmu. Semua diproses lokal, tidak ada yang diunggah ke internet.</p>
<label id="drop" for="f">Klik atau seret video ke sini<input type="file" id="f" accept="video/*,.mp4,.mov,.mkv"></label>
<div id="info"></div>
<div class="row">
<label>Resolusi maksimal<select id="res">
<option value="0">Sama seperti asli</option><option value="1080">1080p</option>
<option value="720" selected>720p (disarankan untuk WA)</option><option value="480">480p</option></select></label>
<label>Kualitas<select id="crf">
<option value="20">Tinggi (file lebih besar)</option><option value="24" selected>Seimbang</option>
<option value="28">Hemat ukuran</option></select></label>
</div>
<button id="go" disabled>Konversi</button><button id="stop" class="sec" hidden>Batalkan</button>
<progress id="p" value="0" max="100" hidden></progress>
<div id="log"></div>
<div id="out" hidden><video id="v" controls playsinline></video>
<a id="dl" class="btn" href="/download">Unduh MP4</a></div>
</main>
<script>
var $=function(i){return document.getElementById(i)};
var file=null,poll=null,t0=0;
function fmt(s){return Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0')}
function pick(f){if(!f)return;file=f;$('info').textContent=f.name+' - '+(f.size/1048576).toFixed(1)+' MB';$('go').disabled=false;$('out').hidden=true;$('log').textContent=''}
$('f').onchange=function(e){pick(e.target.files[0])};
var d=$('drop');
['dragenter','dragover'].forEach(function(ev){d.addEventListener(ev,function(e){e.preventDefault();d.classList.add('on')})});
['dragleave','drop'].forEach(function(ev){d.addEventListener(ev,function(e){e.preventDefault();d.classList.remove('on')})});
d.addEventListener('drop',function(e){pick(e.dataTransfer.files[0])});

function finish(){clearInterval(poll);$('go').disabled=false;$('stop').hidden=true}
function check(){
  fetch('/status').then(function(r){return r.json()}).then(function(s){
    var el=(Date.now()-t0)/1000,txt;
    if(s.state==='running'){
      if(s.dur>0){
        var pct=Math.min(99,s.sec/s.dur*100);
        $('p').value=pct;
        txt='Mengonversi... '+Math.round(pct)+'% - video '+fmt(s.sec)+' / '+fmt(s.dur);
        if(s.sec>0.5)txt+=' - sisa sekitar '+fmt(el*(s.dur-s.sec)/s.sec);
      }else{$('p').removeAttribute('value');txt='Mengonversi...'}
      $('log').textContent=txt+' - berjalan '+fmt(el);
    }else if(s.state==='done'){
      finish();$('p').value=100;
      $('log').textContent='Selesai. Ukuran hasil: '+(s.size/1048576).toFixed(1)+' MB';
      $('v').src='/video?'+Date.now();$('out').hidden=false;
    }else if(s.state==='error'){
      finish();$('p').hidden=true;$('log').textContent='Gagal:\n'+s.msg;
    }
  }).catch(function(){});
}
$('go').onclick=function(){
  if(!file)return;
  $('go').disabled=true;$('out').hidden=true;$('p').hidden=false;$('p').removeAttribute('value');
  var x=new XMLHttpRequest();
  x.open('POST','/upload?name='+encodeURIComponent(file.name)+'&res='+$('res').value+'&crf='+$('crf').value);
  x.upload.onprogress=function(e){if(e.lengthComputable)$('log').textContent='Menyiapkan file... '+Math.round(e.loaded/e.total*100)+'%'};
  x.onload=function(){
    if(x.status!==200){finish();$('p').hidden=true;$('log').textContent='Gagal: '+x.responseText;return}
    t0=Date.now();$('stop').hidden=false;
    clearInterval(poll);poll=setInterval(check,500);check();
  };
  x.onerror=function(){finish();$('p').hidden=true;$('log').textContent='Gagal menghubungi server lokal. Pastikan jendela PowerShell masih terbuka, lalu buka halaman ini lewat http://localhost:8765/'};
  x.send(file);
};
$('stop').onclick=function(){fetch('/cancel',{method:'POST'})};
</script></body></html>
'@

function Send($res, $body, $type) {
  if (-not $type) { $type = 'text/plain; charset=utf-8' }
  $b = [Text.Encoding]::UTF8.GetBytes($body)
  $res.ContentType = $type
  $res.ContentLength64 = $b.Length
  $res.OutputStream.Write($b, 0, $b.Length)
  $res.Close()
}
function ReadShared($p) {
  if (-not (Test-Path $p)) { return '' }
  try {
    $s = [IO.File]::Open($p, 'Open', 'Read', 'ReadWrite')
    $r = New-Object IO.StreamReader($s)
    $t = $r.ReadToEnd(); $r.Close()
    return $t
  } catch { return '' }
}

$prog = Join-Path $work 'prog.txt'
$log  = Join-Path $work 'log.txt'
$out  = Join-Path $work 'output.mp4'
$proc = $null
$cancelled = $false
$base = 'video'

$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$port/")
$l.Start()
Write-Host "Konverter berjalan di http://localhost:$port/" -ForegroundColor Green
Write-Host "ffmpeg: $ff"
Write-Host 'Biarkan jendela ini terbuka selama dipakai. Tekan Ctrl+C untuk berhenti.'
Start-Process "http://localhost:$port/"

try {
  while ($l.IsListening) {
    $task = $l.GetContextAsync()
    while (-not $task.AsyncWaitHandle.WaitOne(300)) { }
    $ctx = $task.Result
    $req = $ctx.Request; $res = $ctx.Response
    $res.AddHeader('Access-Control-Allow-Origin', '*')
    $res.AddHeader('Access-Control-Allow-Headers', '*')
    $res.AddHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    $res.AddHeader('Access-Control-Allow-Private-Network', 'true')
    if ($req.HttpMethod -eq 'OPTIONS') { $res.StatusCode = 204; $res.Close(); continue }
    try {
      $path = $req.Url.AbsolutePath
      if ($path -eq '/') {
        Send $res $html 'text/html; charset=utf-8'
      }
      elseif ($path -eq '/upload' -and $req.HttpMethod -eq 'POST') {
        if ($proc -and -not $proc.HasExited) { $res.StatusCode = 409; Send $res 'Masih ada proses berjalan.'; continue }
        $q = $req.QueryString
        $ext = [IO.Path]::GetExtension($q['name'])
        if ($ext -notmatch '^\.[A-Za-z0-9]{1,5}$') { $ext = '.mp4' }
        $base = ([IO.Path]::GetFileNameWithoutExtension($q['name']) -replace '[^A-Za-z0-9_-]', '_')
        if (-not $base) { $base = 'video' }
        $inp = Join-Path $work ('input' + $ext)
        foreach ($f in @($inp, $out, $prog, $log)) { Remove-Item $f -ErrorAction SilentlyContinue }
        $fs = [IO.File]::Create($inp)
        $req.InputStream.CopyTo($fs)
        $fs.Close()
        $h = [int]$q['res']; $crf = [int]$q['crf']
        if ($crf -lt 15 -or $crf -gt 35) { $crf = 24 }
        if ($h -gt 0) { $vf = "scale=-2:'min($h,ih)'" } else { $vf = 'scale=trunc(iw/2)*2:trunc(ih/2)*2' }
        $a = '-y -i "{0}" -map 0:v:0 -map 0:a:0? -vf "{1}" -c:v libx264 -preset veryfast -crf {2} -profile:v high -level 4.1 -pix_fmt yuv420p -c:a aac -b:a 128k -ar 44100 -ac 2 -movflags +faststart -progress "{3}" -nostats "{4}"' -f $inp, $vf, $crf, $prog, $out
        $cancelled = $false
        $proc = Start-Process -FilePath $ff -ArgumentList $a -WindowStyle Hidden -PassThru -RedirectStandardError $log
        $null = $proc.Handle
        Write-Host "Mulai konversi: $($q['name'])"
        Send $res 'ok'
      }
      elseif ($path -eq '/status') {
        $o = @{ state = 'idle'; sec = 0; dur = 0; msg = ''; size = 0 }
        if ($proc) {
          $lg = ReadShared $log
          $m = [regex]::Match($lg, 'Duration:\s*(\d+):(\d+):(\d+\.?\d*)')
          if ($m.Success) { $o.dur = [int]$m.Groups[1].Value * 3600 + [int]$m.Groups[2].Value * 60 + [double]$m.Groups[3].Value }
          $ms = [regex]::Matches((ReadShared $prog), 'out_time_us=(\d+)')
          if ($ms.Count -gt 0) { $o.sec = [double]$ms[$ms.Count - 1].Groups[1].Value / 1000000 }
          if ($proc.HasExited) {
            if ($cancelled) { $o.state = 'error'; $o.msg = 'Dibatalkan.' }
            elseif ($proc.ExitCode -eq 0 -and (Test-Path $out)) { $o.state = 'done'; $o.size = (Get-Item $out).Length }
            else { $o.state = 'error'; $o.msg = (($lg -split "`n") | Select-Object -Last 6) -join "`n" }
          } else { $o.state = 'running' }
        }
        Send $res ($o | ConvertTo-Json -Compress) 'application/json'
      }
      elseif ($path -eq '/cancel') {
        if ($proc -and -not $proc.HasExited) { $cancelled = $true; $proc.Kill() }
        Send $res 'ok'
      }
      elseif (($path -eq '/video' -or $path -eq '/download') -and (Test-Path $out)) {
        $res.ContentType = 'video/mp4'
        if ($path -eq '/download') { $res.AddHeader('Content-Disposition', 'attachment; filename="' + $base + '_h264.mp4"') }
        $res.ContentLength64 = (Get-Item $out).Length
        $src = [IO.File]::OpenRead($out)
        $src.CopyTo($res.OutputStream)
        $src.Close(); $res.Close()
      }
      else { $res.StatusCode = 404; Send $res 'Tidak ditemukan' }
    }
    catch {
      Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Yellow
      try { $res.StatusCode = 500; Send $res $_.Exception.Message } catch { }
    }
  }
}
finally {
  if ($proc -and -not $proc.HasExited) { $proc.Kill() }
  $l.Stop()
}
