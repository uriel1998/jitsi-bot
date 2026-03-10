$ErrorActionPreference = "Stop"

$pattern = '^recording_(\d{8}_\d{6})(?:_(.*))?_part(\d{4})\.webm$'

if ($args.Count -gt 0 -and ($args[0] -eq "--help" -or $args[0] -eq "-h")) {
    @"
Usage: .\merge_recordings.ps1 [--help]

Merge recording chunk files in the current directory.

Accepted input names:
  recording_YYYYMMDD_HHMMSS_partNNNN.webm
  recording_YYYYMMDD_HHMMSS_<participant>_partNNNN.webm
  recording_YYYYMMDD_HHMMSS__<participant>_partNNNN.webm

Output layout:
  .\recording\YYYYMMDD_HHMMSS\recording.webm
  .\recording\YYYYMMDD_HHMMSS\<participant>.webm

Examples:
  recording_20260310_185513_part0001.webm
  recording_20260310_185513_part0002.webm
    -> .\recording\20260310_185513\recording.webm

  recording_20260310_185513_Steven_58170157_part0001.webm
  recording_20260310_185513_Steven_58170157_part0002.webm
    -> .\recording\20260310_185513\Steven_58170157.webm

  recording_20260310_185513__Ponpoko_cf8c3192_part0001.webm
  recording_20260310_185513__Ponpoko_cf8c3192_part0002.webm
    -> .\recording\20260310_185513\Ponpoko_cf8c3192.webm
"@ | Write-Host
    exit 0
}

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Error "ffmpeg is not available in PATH."
}

$matches = Get-ChildItem -File -Filter "*.webm" | Where-Object { $_.Name -match $pattern }

if (-not $matches) {
    Write-Error "No files found matching recording_YYYYMMDD_HHMMSS[_participant]_partNNNN.webm in the current directory."
}

$groups = @{}

foreach ($file in $matches) {
    if ($file.Name -match $pattern) {
        $timestamp = $Matches[1]
        $rawName = $Matches[2]
        $part = [int]$Matches[3]

        if ($null -eq $rawName) {
            $rawName = ""
        }

        $normalizedName = $rawName -replace '^_+', ''
        if ([string]::IsNullOrEmpty($normalizedName)) {
            $outputName = "recording"
        } else {
            $outputName = $normalizedName
        }

        $key = "$timestamp|$outputName"
        if (-not $groups.ContainsKey($key)) {
            $groups[$key] = [System.Collections.Generic.List[object]]::new()
        }

        $groups[$key].Add([PSCustomObject]@{
            Name = $file.Name
            Part = $part
            Timestamp = $timestamp
            OutputName = $outputName
        })
    }
}

foreach ($key in ($groups.Keys | Sort-Object)) {
    $entries = $groups[$key] | Sort-Object Part
    $timestamp = $entries[0].Timestamp
    $outputName = $entries[0].OutputName
    $outputDir = Join-Path -Path "recording" -ChildPath $timestamp
    $null = New-Item -ItemType Directory -Path $outputDir -Force

    $chunkList = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ("merge_recordings_{0}_{1}_{2}.txt" -f $timestamp, $outputName, [System.Guid]::NewGuid().ToString("N"))
    try {
        $entries |
            ForEach-Object {
                if ($_.PSObject.Properties["FullName"]) {
                    $sourcePath = $_.FullName
                } else {
                    $sourcePath = Join-Path -Path (Get-Location) -ChildPath $_.Name
                }
                $escaped = $sourcePath.Replace("'", "'\''")
                "file '$escaped'"
            } |
            Set-Content -LiteralPath $chunkList -Encoding ascii

        $outputPath = Join-Path -Path $outputDir -ChildPath "$outputName.webm"
        ffmpeg -f concat -safe 0 -i $chunkList -c copy $outputPath
        Write-Host "Created $outputPath"
    }
    finally {
        if (Test-Path -LiteralPath $chunkList) {
            Remove-Item -LiteralPath $chunkList -Force
        }
    }
}
