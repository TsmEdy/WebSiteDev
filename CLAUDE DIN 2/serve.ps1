# Minimal static file server for local preview (no Node/Python needed).
# Usage:  powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 5173]
param(
  [int]$Port = 5180,
  [string]$Root = $PSScriptRoot
)

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
  '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'
  '.webp' = 'image/webp'; '.avif' = 'image/avif'; '.gif' = 'image/gif'; '.ico' = 'image/x-icon'
  '.glb' = 'model/gltf-binary'; '.gltf' = 'model/gltf+json'; '.hdr' = 'application/octet-stream'
  '.mp3' = 'audio/mpeg'; '.ogg' = 'audio/ogg'; '.wav' = 'audio/wav'; '.mp4' = 'video/mp4'; '.webm' = 'video/webm'
  '.woff' = 'font/woff'; '.woff2' = 'font/woff2'; '.txt' = 'text/plain; charset=utf-8'; '.xml' = 'application/xml'
  '.webmanifest' = 'application/manifest+json'
}

$rootFull = [System.IO.Path]::GetFullPath($Root)
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $rootFull at http://localhost:$Port/"

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  try {
    # dev-only CORS so tooling pages can hand data back to the workspace
    if ($req.HttpMethod -eq 'OPTIONS') {
      $res.Headers.Add('Access-Control-Allow-Origin', '*')
      $res.Headers.Add('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
      $res.Headers.Add('Access-Control-Allow-Headers', '*')
      $res.Headers.Add('Access-Control-Allow-Private-Network', 'true')
      $res.StatusCode = 204
      continue
    }
    # dev-only: POST /__save/<relative/path.ext> writes the body inside the workspace
    if ($req.HttpMethod -eq 'POST' -and $req.Url.AbsolutePath -like '/__save/*') {
      $res.Headers.Add('Access-Control-Allow-Origin', '*')
      $relSave = [Uri]::UnescapeDataString($req.Url.AbsolutePath.Substring(8))
      if ($relSave -match '^[\w\-/\.]+\.(webp|jpg|png|json|txt|mp4)$' -and $relSave -notmatch '\.\.') {
        $target = [System.IO.Path]::GetFullPath((Join-Path $rootFull ($relSave -replace '/', '\')))
        if ($target.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
          $dir = Split-Path $target -Parent
          if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
          $ms = New-Object System.IO.MemoryStream
          $req.InputStream.CopyTo($ms)
          [System.IO.File]::WriteAllBytes($target, $ms.ToArray())
          $res.StatusCode = 201
        } else { $res.StatusCode = 403 }
      } else { $res.StatusCode = 400 }
      Write-Host "$($res.StatusCode) SAVE $relSave"
      continue
    }
    # dev-only: POST /__snap/<name>.jpg saves the request body under assets/shots/
    if ($req.HttpMethod -eq 'POST' -and $req.Url.AbsolutePath -like '/__snap/*') {
      $name = [System.IO.Path]::GetFileName($req.Url.AbsolutePath)
      if ($name -match '^[\w\-]+\.(jpg|png|webp|mp4|webm)$') {
        $sub = if ($name -match '\.(mp4|webm)$') { 'assets\videos' } else { 'assets\shots' }
        $dir = Join-Path $rootFull $sub
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
        $ms = New-Object System.IO.MemoryStream
        $req.InputStream.CopyTo($ms)
        [System.IO.File]::WriteAllBytes((Join-Path $dir $name), $ms.ToArray())
        $res.StatusCode = 201
      } else { $res.StatusCode = 400 }
      Write-Host "$($res.StatusCode) POST $($req.Url.AbsolutePath)"
      continue
    }
    $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/') -replace '/', '\'
    $file = [System.IO.Path]::GetFullPath((Join-Path $rootFull $rel))
    if (-not $file.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
      $res.StatusCode = 403
    }
    elseif (Test-Path -LiteralPath $file -PathType Container) {
      if (-not $req.Url.AbsolutePath.EndsWith('/')) {
        $res.StatusCode = 301
        $res.RedirectLocation = $req.Url.AbsolutePath + '/' + $req.Url.Query
      }
      else {
        $file = Join-Path $file 'index.html'
      }
    }
    if ($res.StatusCode -eq 200) {
      if (Test-Path -LiteralPath $file -PathType Leaf) {
        $ext = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
        $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $res.Headers.Add('Cache-Control', 'no-store')
        $res.Headers.Add('Accept-Ranges', 'bytes')
        $fs = [System.IO.File]::Open($file, 'Open', 'Read', 'ReadWrite')
        try {
          $len = $fs.Length
          $range = $req.Headers['Range']
          if ($range -and $range -match '^bytes=(\d*)-(\d*)$') {
            # partial content so <video> can seek (streamed, never the whole file in memory)
            $start = if ($Matches[1] -ne '') { [int64]$Matches[1] } else { $len - [int64]$Matches[2] }
            $end = if ($Matches[1] -ne '' -and $Matches[2] -ne '') { [int64]$Matches[2] } else { $len - 1 }
            if ($end -ge $len) { $end = $len - 1 }
            $count = $end - $start + 1
            $res.StatusCode = 206
            $res.Headers.Add('Content-Range', "bytes $start-$end/$len")
          }
          else { $start = 0; $count = $len }
          $res.ContentLength64 = $count
          if ($req.HttpMethod -ne 'HEAD') {
            [void]$fs.Seek($start, 'Begin')
            $buf = New-Object byte[] 262144
            $left = $count
            while ($left -gt 0) {
              $n = $fs.Read($buf, 0, [int][Math]::Min($buf.Length, $left))
              if ($n -le 0) { break }
              $res.OutputStream.Write($buf, 0, $n)
              $left -= $n
            }
          }
        }
        finally { $fs.Dispose() }
      }
      else {
        $res.StatusCode = 404
        $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $($req.Url.AbsolutePath)")
        $res.OutputStream.Write($msg, 0, $msg.Length)
      }
    }
    Write-Host "$($res.StatusCode) $($req.Url.AbsolutePath)"
  }
  catch {
    Write-Host "ERR $($req.Url.AbsolutePath): $_"
    try { $res.StatusCode = 500 } catch {}
  }
  finally {
    try { $res.OutputStream.Close() } catch {}
  }
}
