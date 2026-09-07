param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 8765
)

$rootPath = ([IO.Path]::GetFullPath($PSScriptRoot)).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$listener = [Net.HttpListener]::new()
$prefix = "http://127.0.0.1:$Port/"
$listener.Prefixes.Add($prefix)

function Get-ContentType([string]$path) {
  switch ([IO.Path]::GetExtension($path).ToLowerInvariant()) {
    ".html" { return "text/html; charset=utf-8" }
    ".js" { return "text/javascript; charset=utf-8" }
    ".css" { return "text/css; charset=utf-8" }
    ".json" { return "application/json; charset=utf-8" }
    ".svg" { return "image/svg+xml" }
    ".png" { return "image/png" }
    ".txt" { return "text/plain; charset=utf-8" }
    default { return "application/octet-stream" }
  }
}

try {
  $listener.Start()
} catch {
  Write-Error "无法启动 $prefix。端口可能已被占用；可在 PowerShell 执行 .\Start-Offline.ps1 -Port 8766 后重试。"
  exit 1
}

Write-Host "离线工具正在运行：$prefix"
Write-Host "正在打开浏览器。关闭此窗口即可停止本机服务。"
Start-Process $prefix

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $requestPath = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath).TrimStart("/")
      if ([string]::IsNullOrWhiteSpace($requestPath)) { $requestPath = "index.html" }
      $filePath = [IO.Path]::GetFullPath((Join-Path $rootPath $requestPath))
      if (!$filePath.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $filePath -PathType Leaf)) {
        $context.Response.StatusCode = 404
        continue
      }
      $bytes = [IO.File]::ReadAllBytes($filePath)
      $context.Response.ContentType = Get-ContentType $filePath
      $context.Response.ContentLength64 = $bytes.Length
      $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } finally {
      $context.Response.Close()
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
