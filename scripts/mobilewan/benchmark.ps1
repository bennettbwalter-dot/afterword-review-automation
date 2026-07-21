[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$MobileWanRepository,
  [Parameter(Mandatory)]
  [string]$MobileWanModelSnapshot,
  [Parameter(Mandatory)]
  [string]$WanBaseModelSnapshot,
  [Parameter(Mandatory)]
  [string]$PromptManifest,
  [Parameter(Mandatory)]
  [string]$OutputDirectory,
  [double]$GpuHourlyRateUsd,
  [switch]$Run
)

$ErrorActionPreference = "Stop"

$sourceRevision = "71149a052364f7346c40c8f2d88311f457f1a46b"
$mobileWanRevision = "3f5d75a27582161295dfb0b4e3d39cc7bef04fc4"
$wanBaseRevision = "b8fff7315c768468a5333511427288870b2e9635"

function Require-Path([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "$Label does not exist: $Path" }
  return (Resolve-Path -LiteralPath $Path).Path
}

function Require-SnapshotRevision([string]$Path, [string]$Revision, [string]$Label) {
  $resolved = Require-Path $Path $Label
  if ((Split-Path -Leaf $resolved) -ne $Revision) {
    throw "$Label must be an immutable Hugging Face snapshot directory named $Revision; received $resolved"
  }
  return $resolved
}

function Get-CommandText([string]$Name, [string[]]$Arguments) {
  return "$Name " + (($Arguments | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join " ")
}

$repo = Require-Path $MobileWanRepository "MobileWAN repository"
$mobileWanSnapshot = Require-SnapshotRevision $MobileWanModelSnapshot $mobileWanRevision "MobileWAN model snapshot"
$wanBaseSnapshot = Require-SnapshotRevision $WanBaseModelSnapshot $wanBaseRevision "Wan2.2 base snapshot"
$manifestPath = Require-Path $PromptManifest "Prompt manifest"

$actualSourceRevision = (& git -C $repo rev-parse HEAD).Trim()
if ($actualSourceRevision -ne $sourceRevision) { throw "MobileWAN source revision must be $sourceRevision; got $actualSourceRevision" }
if ((& git -C $repo status --porcelain)) { throw "MobileWAN repository must be clean before a benchmark run" }
if (-not (Test-Path -LiteralPath (Join-Path $repo "scripts/sample.py"))) { throw "Pinned repository is missing scripts/sample.py" }
if (-not (Test-Path -LiteralPath (Join-Path $mobileWanSnapshot "diffusion_pytorch_model.safetensors.index.json"))) { throw "MobileWAN snapshot is incomplete" }
if (-not (Test-Path -LiteralPath (Join-Path $wanBaseSnapshot "model_index.json"))) { throw "Wan2.2 base snapshot is incomplete" }

$prompts = @(Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json)
if ($prompts.Count -lt 10) { throw "Prompt manifest must contain at least ten representative promotional prompts" }
foreach ($prompt in $prompts) {
  if ([string]::IsNullOrWhiteSpace($prompt.id) -or [string]::IsNullOrWhiteSpace($prompt.prompt) -or $null -eq $prompt.seed) {
    throw "Each prompt requires id, prompt, and fixed seed"
  }
  if ($null -eq $prompt.sample_args -or $prompt.sample_args.Count -eq 0) {
    throw "Each prompt requires sample_args for the official scripts/sample.py CLI with {prompt}, {seed}, and {output} placeholders"
  }
}

$environment = [ordered]@{
  timestamp_utc = (Get-Date).ToUniversalTime().ToString("o")
  source_revision = $actualSourceRevision
  mobilewan_model_revision = $mobileWanRevision
  wan22_base_revision = $wanBaseRevision
  python = (& python --version 2>&1 | Out-String).Trim()
  packages = (& python -m pip freeze 2>&1 | Out-String).Trim().Split([Environment]::NewLine)
  gpu = (& nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader 2>&1 | Out-String).Trim()
  cuda = (& nvidia-smi 2>&1 | Select-String -Pattern "CUDA Version" | ForEach-Object { $_.Line.Trim() })
}

if (-not $Run) {
  $environment | ConvertTo-Json -Depth 5
  Write-Host "BLOCKED: this wrapper did not download weights or invoke a GPU. Supply approved managed-GPU inputs, then re-run with -Run and a non-zero -GpuHourlyRateUsd."
  exit 0
}

if ($GpuHourlyRateUsd -le 0) { throw "-GpuHourlyRateUsd must be supplied for a cost-per-valid-clip result" }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$runDirectory = Join-Path (Resolve-Path -LiteralPath $OutputDirectory).Path ("run-" + (Get-Date -Format "yyyyMMddTHHmmssZ"))
New-Item -ItemType Directory -Force -Path $runDirectory | Out-Null
$vramLog = Join-Path $runDirectory "vram-samples.csv"
$sampler = Start-Job -ScriptBlock {
  param($Path)
  while ($true) {
    "$(Get-Date -Format o),$(& nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits)" | Add-Content -LiteralPath $Path
    Start-Sleep -Seconds 1
  }
} -ArgumentList $vramLog

try {
  $results = @()
  foreach ($prompt in $prompts) {
    $output = Join-Path $runDirectory ("{0}.mp4" -f $prompt.id)
    $arguments = @($prompt.sample_args | ForEach-Object {
      $_.Replace("{prompt}", [string]$prompt.prompt).Replace("{seed}", [string]$prompt.seed).Replace("{output}", $output)
    })
    $started = Get-Date
    & python (Join-Path $repo "scripts/sample.py") @arguments
    $elapsedSeconds = ((Get-Date) - $started).TotalSeconds
    $probe = & ffprobe -v error -show_entries format=duration -show_entries stream=codec_type -of json $output 2>&1
    $valid = $LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $output) -and ((Get-Item -LiteralPath $output).Length -gt 0)
    $results += [ordered]@{
      id = $prompt.id
      seed = $prompt.seed
      prompt = $prompt.prompt
      phase = if ($results.Count -eq 0) { "cold" } else { "warm" }
      seconds = [Math]::Round($elapsedSeconds, 3)
      valid_output = $valid
      sha256 = if ($valid) { (Get-FileHash -Algorithm SHA256 -LiteralPath $output).Hash } else { $null }
      ffprobe = $probe
      command = Get-CommandText "python scripts/sample.py" $arguments
    }
  }
} finally {
  Stop-Job $sampler -ErrorAction SilentlyContinue
  Receive-Job $sampler -ErrorAction SilentlyContinue | Out-Null
  Remove-Job $sampler -Force -ErrorAction SilentlyContinue
}

$peakVramMiB = (Get-Content -LiteralPath $vramLog | ForEach-Object { [int](($_ -split ",")[-1].Trim()) } | Measure-Object -Maximum).Maximum
$validResults = @($results | Where-Object valid_output)
$summary = [ordered]@{
  environment = $environment
  peak_vram_mib = $peakVramMiB
  valid_output_rate = $validResults.Count / $results.Count
  gpu_hourly_rate_usd = $GpuHourlyRateUsd
  cost_per_technically_valid_clip_usd = if ($validResults.Count) { [Math]::Round((($results | Measure-Object seconds -Sum).Sum / 3600 * $GpuHourlyRateUsd) / $validResults.Count, 6) } else { $null }
  results = $results
}
$summary | ConvertTo-Json -Depth 8 | Set-Content -NoNewline -LiteralPath (Join-Path $runDirectory "benchmark.json")
Write-Host "Wrote $(Join-Path $runDirectory "benchmark.json")"
