#!/usr/bin/env bash
set -euo pipefail

shopt -s nullglob

pattern='^recording_([0-9]{8}_[0-9]{6})(_(.*))?_part([0-9]{4})\.webm$'
working_dir="$(pwd -P)"

show_help() {
  cat <<'EOF'
Usage: ./merge_recordings_linux.sh [--help]

Merge recording chunk files in the current directory.

Accepted input names:
  recording_YYYYMMDD_HHMMSS_partNNNN.webm
  recording_YYYYMMDD_HHMMSS_<participant>_partNNNN.webm
  recording_YYYYMMDD_HHMMSS__<participant>_partNNNN.webm

Output layout:
  ./recording/YYYYMMDD_HHMMSS/recording.webm
  ./recording/YYYYMMDD_HHMMSS/<participant>.webm

Examples:
  recording_20260310_185513_part0001.webm
  recording_20260310_185513_part0002.webm
    -> ./recording/20260310_185513/recording.webm

  recording_20260310_185513_Steven_58170157_part0001.webm
  recording_20260310_185513_Steven_58170157_part0002.webm
    -> ./recording/20260310_185513/Steven_58170157.webm

  recording_20260310_185513__Ponpoko_cf8c3192_part0001.webm
  recording_20260310_185513__Ponpoko_cf8c3192_part0002.webm
    -> ./recording/20260310_185513/Ponpoko_cf8c3192.webm
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  show_help
  exit 0
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is not available in PATH." >&2
  exit 1
fi

declare -a files=()
for f in *.webm; do
  [[ -f "$f" ]] || continue
  if [[ "$f" =~ $pattern ]]; then
    files+=("$f")
  fi
done

if ((${#files[@]} == 0)); then
  echo "No files found matching recording_YYYYMMDD_HHMMSS[_participant]_partNNNN.webm in the current directory." >&2
  exit 1
fi

declare -A groups=()
declare -A outputs=()

for f in "${files[@]}"; do
  [[ "$f" =~ $pattern ]]
  ts="${BASH_REMATCH[1]}"
  raw_name="${BASH_REMATCH[3]:-}"
  part="${BASH_REMATCH[4]}"

  normalized_name="${raw_name#_}"
  if [[ -z "$normalized_name" ]]; then
    output_name="recording"
  else
    output_name="$normalized_name"
  fi

  key="${ts}|${output_name}"
  outputs["$key"]="./recording/${ts}/${output_name}.webm"
  groups["$key"]+="${part}|${f}"$'\n'
done

declare -a keys=("${!groups[@]}")
mapfile -t sorted_keys < <(printf '%s\n' "${keys[@]}" | sort)

for key in "${sorted_keys[@]}"; do
  timestamp="${key%%|*}"
  output_name="${key#*|}"
  output_path="${outputs[$key]}"
  output_dir="$(dirname "$output_path")"

  mkdir -p "$output_dir"

  chunk_list="$(mktemp "${TMPDIR:-/tmp}/merge_recordings_${timestamp}_${output_name}_XXXXXX.txt")"
  trap 'rm -f "$chunk_list"' EXIT

  while IFS='|' read -r part filename; do
    [[ -n "$filename" ]] || continue
    source_path="${working_dir}/${filename}"
    escaped_filename=${source_path//\'/\'\\\'\'}
    printf "file '%s'\n" "$escaped_filename"
  done < <(printf '%s' "${groups[$key]}" | sort -t'|' -k1,1) > "$chunk_list"

  ffmpeg -f concat -safe 0 -i "$chunk_list" -c copy "$output_path"
  echo "Created $output_path"

  rm -f "$chunk_list"
  trap - EXIT
done
