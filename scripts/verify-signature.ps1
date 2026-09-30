<#
  校验 dist/ 下 Windows 产物的 Authenticode 签名,并打印 SHA-256。

  为什么必须有这个脚本:
  electron-builder 在“准备签名”时是无条件打 info 日志的
  (app-builder-lib/out/codeSign/windowsCodeSign.js → "signing with signtool.exe"),
  而真正“因为没有证书而跳过”只写 debug 日志
  (app-builder-lib/out/codeSign/windowsSignToolManager.js → "no signing info identified, signing is skipped")。
  所以构建日志里出现 "signing with signtool.exe" 完全不代表产物被签过名 —— 必须自己查。
  未签名的 EXE 会被 Microsoft Defender SmartScreen 判为“无法识别的应用”,弹出“Windows 已保护你的电脑”。

  判定规则:
  - 配了签名凭据(WIN_CSC_LINK / CSC_LINK / AZURE_CLIENT_ID / DSH_SIGN_SUBJECT_NAME)时 → 未签名直接失败(exit 1)
  - 没配凭据时 → 只告警,构建继续(本地无证书开发不受影响)
  - -RequireSigned 可强制要求,无论是否配置凭据
#>
param(
  [switch]$RequireSigned,
  [switch]$AllowMissing
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if ($env:DSH_MANAGER_DIST_DIR) {
  $distDir = $env:DSH_MANAGER_DIST_DIR
} else {
  $distDir = Join-Path $root 'dist'
}

# 分发件 + 解包目录里的主程序(后者才是用户从开始菜单启动、被 SmartScreen 拦的那个)
$targets = @()
$targets += @(Get-ChildItem -LiteralPath $distDir -Filter '*-setup.exe' -ErrorAction SilentlyContinue)
$targets += @(Get-ChildItem -LiteralPath $distDir -Filter '*-portable.exe' -ErrorAction SilentlyContinue)
$unpacked = Join-Path $distDir 'win-unpacked\DeepSeek-Harness-Manager.exe'
if (Test-Path -LiteralPath $unpacked) { $targets += @(Get-Item -LiteralPath $unpacked) }

if ($targets.Count -eq 0) {
  if ($AllowMissing) {
    Write-Host "· verify-signature: $distDir 下暂无产物,跳过"
    exit 0
  }
  Write-Host "x verify-signature: $distDir 下没有找到任何 EXE 产物" -ForegroundColor Red
  Write-Host '  先执行 npm run pack'
  exit 1
}

$hasPfx = [bool]$env:WIN_CSC_LINK -or [bool]$env:CSC_LINK
$hasAzure = [bool]$env:AZURE_CLIENT_ID -and [bool]$env:AZURE_TENANT_ID
$hasStoreCert = [bool]$env:DSH_SIGN_SUBJECT_NAME
$credentialsConfigured = $hasPfx -or $hasAzure -or $hasStoreCert
$mustSign = $RequireSigned -or $credentialsConfigured

$unsigned = @()
$signed = @()

Write-Host ''
Write-Host 'verify-signature:' -ForegroundColor Cyan
foreach ($f in $targets) {
  $sig = Get-AuthenticodeSignature -LiteralPath $f.FullName
  $sizeMb = [math]::Round($f.Length / 1MB, 1)
  $sha = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash

  if ($sig.Status -eq 'Valid') {
    $subject = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { '(unknown)' }
    $signed += $f
    Write-Host ("  [OK]   {0}  {1} MB" -f $f.Name, $sizeMb) -ForegroundColor Green
    Write-Host ("         签署者: {0}" -f $subject)
  } else {
    $unsigned += $f
    Write-Host ("  [未签] {0}  {1} MB  ({2})" -f $f.Name, $sizeMb, $sig.Status) -ForegroundColor Yellow
  }
  Write-Host ("         SHA256: {0}" -f $sha)
}

Write-Host ''
if ($unsigned.Count -eq 0) {
  Write-Host ("✔ verify-signature: {0}/{1} 个产物签名有效" -f $signed.Count, $targets.Count) -ForegroundColor Green
  exit 0
}

if ($mustSign) {
  $reason = if ($RequireSigned) { '指定了 -RequireSigned' } else { '已配置签名凭据,但产物未签名' }
  Write-Host ("x verify-signature: {0}/{1} 个产物未签名 —— {2}" -f $unsigned.Count, $targets.Count, $reason) -ForegroundColor Red
  Write-Host ''
  Write-Host '  这类产物发布后,用户运行时会看到 SmartScreen「Windows 已保护你的电脑」。' -ForegroundColor Red
  Write-Host '  常见原因:' -ForegroundColor Red
  Write-Host '    · 证书路径/密码不对:WIN_CSC_LINK 需要是 .pfx 的绝对路径、https URL 或 base64'
  Write-Host '    · 令牌/HSM 证书需要用 certificateSubjectName 指定(见 docs/DEVELOPMENT.md 的代码签名章节)'
  Write-Host '    · 注意:构建日志里的 "signing with signtool.exe" 是跳过签名前就打出的,不代表已签名'
  exit 1
}

Write-Host ("! verify-signature: {0}/{1} 个产物未签名。" -f $unsigned.Count, $targets.Count) -ForegroundColor Yellow
Write-Host '  当前未配置签名凭据,构建继续;但发布这些产物会让用户看到 SmartScreen 警告。' -ForegroundColor Yellow
Write-Host '  配置方式见 docs/DEVELOPMENT.md 的「代码签名」章节。' -ForegroundColor Yellow
exit 0
