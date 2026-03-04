$ErrorActionPreference = "Stop"

$pattern = '^recording_(\d{8}_\d{6})_part(\d{4})\.webm$'
$matches = Get-ChildItem -File -Filter "*.webm" | Where-Object { $_.Name -match $pattern }

if (-not $matches) {
    Write-Error "No files found matching recording_YYYYMMDD_HHMMSS_partNNNN.webm in the current directory."
}

$groups = @{}
foreach ($file in $matches) {
    if ($file.Name -match $pattern) {
        $timestamp = $Matches[1]
        $part = [int]$Matches[2]
        if (-not $groups.ContainsKey($timestamp)) {
            $groups[$timestamp] = @()
        }
        $groups[$timestamp] += [PSCustomObject]@{
            Name = $file.Name
            Part = $part
        }
    }
}

if ($groups.Count -gt 1) {
    $timestamps = ($groups.Keys | Sort-Object) -join ", "
    Write-Error "Multiple timestamps found: $timestamps. Keep only one timestamp set in this directory."
}

$timestampKey = ($groups.Keys | Select-Object -First 1)
$ordered = $groups[$timestampKey] | Sort-Object Part

$chunkList = "chunk_list.txt"
$ordered | ForEach-Object { "file '$($_.Name)'" } | Set-Content -LiteralPath $chunkList -Encoding ascii
Write-Host "Created .\$chunkList"

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Error "ffmpeg is not available in PATH."
}

$output = "recording_${timestampKey}_merged.webm"
ffmpeg -f concat -safe 0 -i .\chunk_list.txt -c copy ".\$output"
