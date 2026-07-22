[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$MobileWanRepository,
  [Parameter(Mandatory)]
  [string]$MobileWanModelSnapshot,
  [Parameter(Mandatory)]
  [string]$WanBaseModelSnapshot,
  [Parameter(Mandatory)]
  [string]$SnapshotProvenance,
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

function Assert-SnapshotProvenance([string]$Snapshot, $Entry, [string]$Revision, [string]$Label) {
  if ($null -eq $Entry -or $Entry.revision -cne $Revision) {
    throw "$Label provenance must contain the exact immutable revision $Revision"
  }
  if ($null -eq $Entry.files -or $Entry.files.Count -eq 0) {
    throw "$Label provenance must contain SHA-256 entries for snapshot files"
  }
  $snapshotFiles = @(
    Get-ChildItem -LiteralPath $Snapshot -Recurse -File | ForEach-Object {
      [PSCustomObject]@{
        relative_path = $_.FullName.Substring($Snapshot.Length).TrimStart([char[]]@([char]92, [char]47)).Replace([string][char]92, '/')
        full_path = $_.FullName
      }
    }
  )
  if ($snapshotFiles.Count -eq 0) { throw "$Label snapshot contains no files" }

  $manifestByPath = [System.Collections.Generic.Dictionary[string, object]]::new([System.StringComparer]::Ordinal)
  foreach ($file in @($Entry.files)) {
    if ([string]::IsNullOrWhiteSpace($file.path) -or [string]::IsNullOrWhiteSpace($file.sha256)) {
      throw "$Label provenance file entries require path and sha256"
    }
    if ([IO.Path]::IsPathRooted($file.path) -or $file.path -match '(^|[\\/])\.\.([\\/]|$)' -or $file.path -notmatch '^[^\\/].*') {
      throw "$Label provenance contains an unsafe relative path: $($file.path)"
    }
    if ($file.sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw "$Label provenance has an invalid SHA-256 for $($file.path)" }
    $relativePath = $file.path.Replace([string][char]92, '/')
    if (-not $manifestByPath.TryAdd($relativePath, $file)) { throw "$Label provenance has a duplicate file entry: $relativePath" }
  }
  if ($manifestByPath.Count -ne $snapshotFiles.Count) { throw "$Label provenance must contain exactly one entry for every snapshot file" }

  $snapshotByPath = [System.Collections.Generic.Dictionary[string, object]]::new([System.StringComparer]::Ordinal)
  foreach ($snapshotFile in $snapshotFiles) {
    if (-not $snapshotByPath.TryAdd($snapshotFile.relative_path, $snapshotFile)) { throw "$Label snapshot has a duplicate relative path" }
    if (-not $manifestByPath.ContainsKey($snapshotFile.relative_path)) { throw "$Label provenance is missing snapshot file: $($snapshotFile.relative_path)" }
    $file = $manifestByPath[$snapshotFile.relative_path]
    if ((Get-FileHash -LiteralPath $snapshotFile.full_path -Algorithm SHA256).Hash -cne $file.sha256.ToUpperInvariant()) {
      throw "$Label provenance hash mismatch: $($snapshotFile.relative_path)"
    }
  }
  foreach ($relativePath in $manifestByPath.Keys) {
    if (-not $snapshotByPath.ContainsKey($relativePath)) { throw "$Label provenance references an absent snapshot file: $relativePath" }
  }
}

function Get-GpuQualification([string[]]$GpuRecords) {
  if ($GpuRecords.Count -ne 1) { return "non_qualifying" }
  $record = $GpuRecords[0]
  if ($record -match '^(?<name>.+?),\s*(?<memory>\d+)\s*$') {
    $gpuName = $Matches.name
    $gpuMemoryMiB = [int]$Matches.memory
    if ($gpuName -match '(?i)\bA100\b' -and $gpuMemoryMiB -ge 81920) {
      return "qualifying_a100_80gb"
    }
  }
  return "non_qualifying"
}

function Get-CommandText([string]$Name, [string[]]$Arguments) {
  return "$Name " + (($Arguments | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join " ")
}

$repo = Require-Path $MobileWanRepository "MobileWAN repository"
$mobileWanSnapshot = Require-SnapshotRevision $MobileWanModelSnapshot $mobileWanRevision "MobileWAN model snapshot"
$wanBaseSnapshot = Require-SnapshotRevision $WanBaseModelSnapshot $wanBaseRevision "Wan2.2 base snapshot"
$provenancePath = Require-Path $SnapshotProvenance "Snapshot provenance"
$manifestPath = Require-Path $PromptManifest "Prompt manifest"

$actualSourceRevision = (& git -C $repo rev-parse HEAD).Trim()
if ($actualSourceRevision -ne $sourceRevision) { throw "MobileWAN source revision must be $sourceRevision; got $actualSourceRevision" }
if ((& git -C $repo status --porcelain)) { throw "MobileWAN repository must be clean before a benchmark run" }
if (-not (Test-Path -LiteralPath (Join-Path $repo "scripts/sample.py"))) { throw "Pinned repository is missing scripts/sample.py" }
if (-not (Test-Path -LiteralPath (Join-Path $mobileWanSnapshot "diffusion_pytorch_model.safetensors.index.json"))) { throw "MobileWAN snapshot is incomplete" }
if (-not (Test-Path -LiteralPath (Join-Path $wanBaseSnapshot "model_index.json"))) { throw "Wan2.2 base snapshot is incomplete" }

$provenance = Get-Content -Raw -LiteralPath $provenancePath | ConvertFrom-Json
Assert-SnapshotProvenance $mobileWanSnapshot $provenance.mobilewan $mobileWanRevision "MobileWAN model snapshot"
Assert-SnapshotProvenance $wanBaseSnapshot $provenance.wan22 $wanBaseRevision "Wan2.2 base snapshot"

$prompts = @(Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json)
if ($prompts.Count -lt 10) { throw "Prompt manifest must contain at least ten representative promotional prompts" }
$promptIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($prompt in $prompts) {
  if ([string]::IsNullOrWhiteSpace($prompt.id) -or $prompt.id -notmatch '^[a-z0-9][a-z0-9-]{0,63}$') {
    throw "Each prompt id must be unique, lowercase, and safe for an output filename"
  }
  if (-not $promptIds.Add($prompt.id)) { throw "Prompt ids must be unique: $($prompt.id)" }
  if ([string]::IsNullOrWhiteSpace($prompt.prompt) -or ($prompt.seed -isnot [int] -and $prompt.seed -isnot [long])) {
    throw "Each prompt requires a non-empty prompt and fixed integer seed"
  }
  if ($prompt.sample_args -isnot [System.Array] -or $prompt.sample_args.Count -eq 0 -or @($prompt.sample_args | Where-Object { $_ -isnot [string] -or [string]::IsNullOrWhiteSpace($_) }).Count -gt 0) {
    throw "Each prompt requires a non-empty string sample_args array for the official scripts/sample.py CLI"
  }
  $argumentsTemplate = $prompt.sample_args -join "`n"
  foreach ($placeholder in @("{prompt}", "{seed}", "{output}")) {
    if (-not $argumentsTemplate.Contains($placeholder)) { throw "Prompt $($prompt.id) sample_args must contain $placeholder" }
  }
}

$gpuRecords = @(& nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>&1 | ForEach-Object { $_.ToString().Trim() })
$gpuQualification = Get-GpuQualification $gpuRecords

$environment = [ordered]@{
  timestamp_utc = (Get-Date).ToUniversalTime().ToString("o")
  source_revision = $actualSourceRevision
  mobilewan_model_revision = $mobileWanRevision
  wan22_base_revision = $wanBaseRevision
  python = (& python --version 2>&1 | Out-String).Trim()
  packages = (& python -m pip freeze 2>&1 | Out-String).Trim().Split([Environment]::NewLine)
  gpu = $gpuRecords
  gpu_qualification = $gpuQualification
  cuda = (& nvidia-smi 2>&1 | Select-String -Pattern "CUDA Version" | ForEach-Object { $_.Line.Trim() })
}

if (-not $Run) {
  $environment | ConvertTo-Json -Depth 5
  Write-Host "BLOCKED: this wrapper did not download weights or invoke a GPU. Supply approved managed-GPU inputs, then re-run with -Run and a non-zero -GpuHourlyRateUsd."
  exit 0
}

if ($GpuHourlyRateUsd -le 0) { throw "-GpuHourlyRateUsd must be supplied for a cost-per-valid-clip result" }
if ($gpuQualification -ne "qualifying_a100_80gb") {
  throw "A qualifying benchmark requires an NVIDIA A100 with at least 80 GB (81920 MiB) VRAM; no authoritative artifact will be written"
}
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
