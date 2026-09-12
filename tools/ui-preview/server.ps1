$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = (Resolve-Path (Join-Path $root '..\..\src')).Path
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add('http://localhost:5178/')
$listener.Start()
Write-Output "listening on 5178"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($path -eq '/') { $path = '/index.html' }
    if ($path.StartsWith('/src/')) { $file = Join-Path $src $path.Substring(5) } else { $file = Join-Path $root $path.TrimStart('/') }
    if (Test-Path -LiteralPath $file -PathType Leaf) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file)
      $type = switch ($ext) { '.html' { 'text/html' } '.js' { 'text/javascript' } '.css' { 'text/css' } default { 'text/plain' } }
      $ctx.Response.ContentType = "$type; charset=utf-8"
      $ctx.Response.Headers.Add('Cache-Control', 'no-store')
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
  } catch {
    $ctx.Response.StatusCode = 500
  }
  $ctx.Response.Close()
}

