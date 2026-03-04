#!/usr/bin/env bash
set -euo pipefail

shopt -s nullglob

pattern='^recording_([0-9]{8}_[0-9]{6})_part([0-9]{4})\.webm$'

declare -a files=()
for f in *.webm; do
  [[ -f "$f" ]] || continue
  if [[ "$f" =~ $pattern ]]; then
    files+=("$f")
  fi
done

if ((${#files[@]} == 0)); then
  echo "No files found matching recording_YYYYMMDD_HHMMSS_partNNNN.webm in the current directory." >&2
  exit 1
fi

declare -A timestamps=()
declare -a sortable=()

for f in "${files[@]}"; do
  [[ "$f" =~ $pattern ]]
  ts="${BASH_REMATCH[1]}"
  part="${BASH_REMATCH[2]}"
  timestamps["$ts"]=1
  sortable+=("${ts}|${part}|${f}")
done

if ((${#timestamps[@]} > 1)); then
  printf 'Multiple timestamps found: ' >&2
  printf '%s\n' "${!timestamps[@]}" | sort | paste -sd ', ' - >&2
  echo "Keep only one timestamp set in this directory." >&2
  exit 1
fi

timestamp="$(printf '%s\n' "${!timestamps[@]}")"
mapfile -t sorted_files < <(printf '%s\n' "${sortable[@]}" | sort -t'|' -k2,2 | cut -d'|' -f3-)

: > chunk_list.txt
for f in "${sorted_files[@]}"; do
  printf "file '%s'\n" "$f" >> chunk_list.txt
done
echo "Created ./chunk_list.txt"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is not available in PATH." >&2
  exit 1
fi

ffmpeg -f concat -safe 0 -i ./chunk_list.txt -c copy "./recording_${timestamp}_merged.webm"
