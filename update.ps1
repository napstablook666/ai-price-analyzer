<#
  扩展自更新脚本（bat 通道的执行端）。

  由 update.bat 从 %TEMP% 调起，扩展目录用 -TargetDir 传进来。
  原则：验签不过、摘要不对、目录不对，一律不动任何文件。

  签名口径与 src/core/self-update.js 的 manifestSigningPayload 完全一致：
    v<version>\n<minShell>\n<zip.sha256>\n<files 摘要>\n<deleted 摘要>
  其中 files 摘要是对 "路径\nsha256\n" 按路径排序拼接后的 UTF-8 文本取 sha256 十六进制。
#>
param(
  [Parameter(Mandatory = $true)][string]$TargetDir,
  [string]$Repo = 'napstablook666/ai-price-analyzer',
  [string]$ManifestUrl
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 } catch { }

# 公钥硬编码，不从网络取。改动它等于换一套发版密钥。
# 格式是 BCRYPT_ECCKEY_BLOB 的 base64：4 字节魔数 ECS1 + 4 字节密钥长度 + X + Y。
# 不用 SPKI 是因为 Windows PowerShell 5.1（.NET Framework）的 ECDsa 没有 ImportSubjectPublicKeyInfo。
$PublicKeyB64 = 'RUNTMSAAAADCZVNeka3LaE3C1ovDbGlYWHyiXJWF4cv7ZQJ6DS2Ubr713+AdZTYo5deqNRBmVOvWdtsIwLTeluVVlbwswbZr'
if (-not $ManifestUrl) { $ManifestUrl = "https://github.com/$Repo/releases/latest/download/update.json" }
$ZipMaxBytes = 64MB

function Write-Step([string]$Message) { Write-Host "  $Message" }
function Fail([string]$Message) {
  Write-Host ''
  Write-Host "更新失败：$Message" -ForegroundColor Red
  exit 1
}

function Get-RemoteText([string]$Url, [int]$Retries = 2) {
  for ($attempt = 0; $attempt -le $Retries; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 60
      return [string]$response.Content
    } catch {
      if ($attempt -eq $Retries) { throw }
      Start-Sleep -Seconds 2
    }
  }
}

function Get-RemoteFile([string]$Url, [string]$Path) {
  Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 300 -OutFile $Path
}

function Get-Sha256Hex([string]$Path) {
  return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-TextSha256Hex([string]$Text) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($Text)
    $digest = $sha.ComputeHash($bytes)
    return (($digest | ForEach-Object { $_.ToString('x2') }) -join '')
  } finally { $sha.Dispose() }
}

function Compare-Version([string]$Left, [string]$Right) {
  $parse = {
    param($value)
    $clean = ($value -replace '^v', '').Split('-')[0]
    return @($clean.Split('.') | ForEach-Object { [int]($_ -replace '\D', '0') })
  }
  $a = & $parse $Left
  $b = & $parse $Right
  for ($i = 0; $i -lt [Math]::Max($a.Count, $b.Count); $i++) {
    $x = if ($i -lt $a.Count) { $a[$i] } else { 0 }
    $y = if ($i -lt $b.Count) { $b[$i] } else { 0 }
    if ($x -ne $y) { return [Math]::Sign($x - $y) }
  }
  return 0
}

function Get-OrdinalSortedNames($Names) {
  # JS 那边是按代码点排序的，PowerShell 的 Sort-Object 默认走区域设置，这里必须显式指定序数比较。
  $list = [System.Collections.Generic.List[string]]::new()
  foreach ($name in @($Names)) { $list.Add([string]$name) }
  $list.Sort([StringComparer]::Ordinal)
  return $list
}

function Test-ManifestSignature($Manifest) {
  $fileNames = Get-OrdinalSortedNames ($Manifest.files.PSObject.Properties | ForEach-Object { $_.Name })
  $filesText = ($fileNames | ForEach-Object { "$_`n$($Manifest.files.$_)`n" }) -join ''

  $deletedNames = Get-OrdinalSortedNames $Manifest.deleted
  $deletedText = ($deletedNames | ForEach-Object { "$_`n" }) -join ''

  $minShell = if ([string]::IsNullOrWhiteSpace([string]$Manifest.minShell)) { [string]$Manifest.version } else { ([string]$Manifest.minShell).Trim() }
  $payload = "v$($Manifest.version)`n$minShell`n$($Manifest.zip.sha256)`n$(Get-TextSha256Hex $filesText)`n$(Get-TextSha256Hex $deletedText)"

  $ecdsa = $null
  try {
    # CngKey.Import 在 Framework 与 Core 上都可用；SPKI 导入只有 Core 有，5.1 上会直接报方法不存在。
    $cng = [Security.Cryptography.CngKey]::Import([Convert]::FromBase64String($PublicKeyB64), [Security.Cryptography.CngKeyBlobFormat]::EccPublicBlob)
    $ecdsa = New-Object Security.Cryptography.ECDsaCng($cng)
    $data = (New-Object Text.UTF8Encoding($false)).GetBytes($payload)
    $signature = [Convert]::FromBase64String([string]$Manifest.signature)
    # 三参重载在 Framework 与 Core 上都按 R||S 定长拼接解释，和 WebCrypto 一致。
    return $ecdsa.VerifyData($data, $signature, [Security.Cryptography.HashAlgorithmName]::SHA256)
  } catch {
    return $false
  } finally { if ($ecdsa) { $ecdsa.Dispose() } }
}

Write-Host ''
Write-Host 'AI 比价扩展 - 自更新' -ForegroundColor Cyan
Write-Host ''

$TargetDir = $TargetDir.TrimEnd('\')
$localManifestPath = Join-Path $TargetDir 'manifest.json'
if (-not (Test-Path -LiteralPath $localManifestPath)) {
  Fail "这个目录里没有 manifest.json，不是扩展目录：$TargetDir"
}

$localVersion = (Get-Content -LiteralPath $localManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json).version
Write-Step "当前版本 v$localVersion"

Write-Step '下载版本清单…'
try {
  $rawManifest = Get-RemoteText $ManifestUrl
} catch {
  Fail "下载 update.json 失败：$($_.Exception.Message)"
}

try { $manifest = $rawManifest | ConvertFrom-Json } catch { Fail 'update.json 不是合法 JSON' }
if (-not $manifest.version -or -not $manifest.zip -or -not $manifest.signature) { Fail 'update.json 结构不对' }

Write-Step "线上版本 v$($manifest.version)"

if (-not (Test-ManifestSignature $manifest)) {
  Fail 'update.json 签名校验失败。要么发版密钥换过，要么这个文件被人改过'
}

if ((Compare-Version $manifest.version $localVersion) -le 0) {
  Write-Host ''
  Write-Host "已经是最新版本（v$localVersion），无需更新。" -ForegroundColor Green
  exit 0
}

if ($manifest.minShell -and (Compare-Version $manifest.minShell $localVersion) -gt 0) {
  Fail "这一版要求先升级到 v$($manifest.minShell)，只能去 GitHub 手动下载"
}

$workDir = Join-Path ([IO.Path]::GetTempPath()) ("apa-update-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$zipPath = Join-Path $workDir 'package.zip'
$newDir = Join-Path $workDir 'new'
New-Item -ItemType Directory -Path $workDir -Force | Out-Null
New-Item -ItemType Directory -Path $newDir -Force | Out-Null

try {
  Write-Step '下载更新包…'
  try {
    Get-RemoteFile ([string]$manifest.zip.url) $zipPath
  } catch {
    Fail "下载更新包失败：$($_.Exception.Message)"
  }

  $size = (Get-Item -LiteralPath $zipPath).Length
  if ($size -ne [int64]$manifest.zip.size) { Fail "更新包大小不对：拿到 $size 字节，清单写的是 $($manifest.zip.size)" }
  if ($size -gt $ZipMaxBytes) { Fail '更新包体积异常' }
  if ((Get-Sha256Hex $zipPath) -ne ([string]$manifest.zip.sha256).ToLowerInvariant()) { Fail '更新包摘要不符，可能下载不完整' }

  Write-Step '解压…'
  try {
    Expand-Archive -LiteralPath $zipPath -DestinationPath $newDir -Force
  } catch {
    Fail "解压失败：$($_.Exception.Message)"
  }

  Write-Step '逐个校验文件…'
  foreach ($property in $manifest.files.PSObject.Properties) {
    $relative = $property.Name -replace '/', '\'
    $filePath = Join-Path $newDir $relative
    if (-not (Test-Path -LiteralPath $filePath)) { Fail "更新包里缺少 $($property.Name)" }
    if ((Get-Sha256Hex $filePath) -ne ([string]$property.Value).ToLowerInvariant()) { Fail "更新包里 $($property.Name) 的摘要对不上" }
  }

  Write-Step '写入扩展目录（浏览器占用会重试三次）…'
  # 用 /E 而不是 /MIR：目标目录里可能有 .git、日志之类的东西，不能一把清掉。
  $roboArgs = @($newDir, $TargetDir, '/E', '/R:3', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP',
    '/XF', 'update.bat', 'update.ps1', 'update-marker.json')
  & robocopy @roboArgs | Out-Null
  if ($LASTEXITCODE -ge 8) {
    Fail '写入文件时出错。最可能是浏览器的扩展目录里还有文件被占用，关掉浏览器再双击一次这个脚本'
  }

  $marker = [ordered]@{
    version = [string]$manifest.version
    previous = [string]$localVersion
    appliedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    channel = 'bat'
  } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText((Join-Path $TargetDir 'update-marker.json'), $marker, (New-Object Text.UTF8Encoding($false)))

  Write-Host ''
  Write-Host "已更新到 v$($manifest.version)。" -ForegroundColor Green
  Write-Host '浏览器会在 1 分钟内自动刷新扩展。没反应就打开 chrome://extensions 点一下这个扩展的刷新按钮。'
  exit 0
} finally {
  Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
}
