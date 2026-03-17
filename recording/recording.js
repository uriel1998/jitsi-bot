/**
 * Credit: Jimmi Music Bot for Jitsi https://github.com/Music-Bot-for-Jitsi/Jimmi
 */

const recordingLevelBar = document.querySelector('#recordingLevelBar')
const recordingLevelValue = document.querySelector('#recordingLevelValue')

let recordingContext = undefined
let recordingDestStream = undefined

let initDone = false

let recordingSessionStarted = false
let recorderTargetName = undefined
let mediaRecorder = undefined
let currentChunkBytes = 0
let recordingSegmentIndex = 0
let segmentFlushIntervalId = undefined
let segmentRecordingActive = false
let isStoppingSegmentRecorder = false
let segmentSaveChain = Promise.resolve()
const remoteAudioNodes = new WeakMap()
const pendingRemoteAudioTracks = new Set()
let connectedRemoteAudioTrackCount = 0
let recordingLevelAnalyser = undefined
let recordingLevelData = undefined
let recordingLevelRafId = undefined
let healthLogIntervalId = undefined
let lastMeterPercent = 0
let lastChunkTimestamp = 0
let localChunkServiceState = 'unknown'

const pingIntervalMs = 5 * 60 * 1000
const segmentDurationMs = 60 * 1000
const healthLogIntervalMs = 60 * 1000
const minTerminalChunkBytes = 2048
let pingIntervalId = undefined

function summarizeMemory() {
  const mem = performance?.memory
  if (!mem) {
    return { available: false }
  }
  return {
    available: true,
    usedJSHeapSize: mem.usedJSHeapSize,
    totalJSHeapSize: mem.totalJSHeapSize,
    jsHeapSizeLimit: mem.jsHeapSizeLimit,
  }
}

function summarizeDestStream() {
  const audioTrack = recordingDestStream?.stream?.getAudioTracks?.()?.[0]
  return {
    exists: Boolean(recordingDestStream?.stream),
    audioTrackCount: recordingDestStream?.stream?.getAudioTracks?.()?.length ?? 0,
    readyState: audioTrack?.readyState ?? null,
    enabled: audioTrack?.enabled ?? null,
    muted: audioTrack?.muted ?? null,
    label: audioTrack?.label || '',
  }
}

function summarizeRecorderState() {
  return {
    recordingSessionStarted,
    segmentRecordingActive,
    isStoppingSegmentRecorder,
    recorderState: mediaRecorder?.state || 'inactive',
    segmentIndex: recordingSegmentIndex,
    currentChunkBytes,
    remoteAudioNodeCount: connectedRemoteAudioTrackCount,
    pendingRemoteAudioTracks: pendingRemoteAudioTracks.size,
    audioContextState: recordingContext?.state || 'missing',
    lastMeterPercent,
    msSinceLastChunk: lastChunkTimestamp ? Date.now() - lastChunkTimestamp : null,
    destStream: summarizeDestStream(),
    memory: summarizeMemory(),
  }
}

async function persistClientLog(level, message, details = {}) {
  const payload = JSON.stringify({
    ts: new Date().toISOString(),
    page: window.location.pathname,
    level,
    message,
    details,
  })

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' })
      if (navigator.sendBeacon('/__client_log', blob)) {
        return
      }
    }
  } catch (error) {
    console.log('sendBeacon logging failed', error)
  }

  try {
    await fetch('/__client_log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    })
  } catch (error) {
    console.log('fetch logging failed', error)
  }
}

async function uploadChunkToLocalService(blob, fileName, chunkIndex) {
  const response = await fetch('/__recording_chunk', {
    method: 'POST',
    headers: {
      'Content-Type': blob.type || 'application/octet-stream',
      'X-Filename': encodeURIComponent(fileName),
      'X-Chunk-Index': String(chunkIndex),
      'X-Append': 'true',
    },
    body: blob,
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return response.json()
}

function verboseLog(message, details = {}) {
  const detailText =
    details && Object.keys(details).length ? ` ${JSON.stringify(details)}` : ''
  log(`${message}${detailText}`)
  void persistClientLog('info', message, details)
}

function warningLog(message, details = {}) {
  const detailText =
    details && Object.keys(details).length ? ` ${JSON.stringify(details)}` : ''
  log(`${message}${detailText}`)
  void persistClientLog('warning', message, details)
}

window.persistRecordingLog = persistClientLog
window.recordingVerboseLog = verboseLog
window.recordingWarningLog = warningLog
window.getRecordingRuntimeState = summarizeRecorderState

function attachCrashSignalLogging() {
  window.addEventListener('error', (event) => {
    void persistClientLog('error', 'window.error', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error?.stack || String(event.error || ''),
      recorder: summarizeRecorderState(),
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    void persistClientLog('error', 'window.unhandledrejection', {
      reason: event.reason?.stack || String(event.reason || ''),
      recorder: summarizeRecorderState(),
    })
  })

  window.addEventListener('visibilitychange', () => {
    void persistClientLog('info', 'document.visibilitychange', {
      visibilityState: document.visibilityState,
      recorder: summarizeRecorderState(),
    })
  })

  window.addEventListener('pagehide', () => {
    void persistClientLog('warning', 'window.pagehide', {
      recorder: summarizeRecorderState(),
    })
  })

  window.addEventListener('beforeunload', () => {
    void persistClientLog('warning', 'window.beforeunload', {
      recorder: summarizeRecorderState(),
    })
  })
}

function makeTimestamp() {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`
}

function getDefaultRecordingFilename() {
  return `recording_${makeTimestamp()}.webm`
}

async function promptForRecordingTarget() {
  const suggestedName = getDefaultRecordingFilename()
  const userName = window.prompt('Recording filename (.webm):', suggestedName)
  if (userName === null) {
    verboseLog('Recording setup was cancelled.')
    return undefined
  }
  const safeName = userName.trim().endsWith('.webm')
    ? userName.trim()
    : `${userName.trim() || 'recording'}.webm`
  recorderTargetName = safeName
  return { mode: 'download', filename: safeName }
}

function stopPeriodicPing() {
  if (!pingIntervalId) {
    return
  }
  clearInterval(pingIntervalId)
  pingIntervalId = undefined
}

function startPeriodicPing() {
  stopPeriodicPing()
  pingIntervalId = setInterval(() => {
    if (!recordingSessionStarted) {
      return
    }
    room?.sendMessage?.('🎤 recording ongoing.')
  }, pingIntervalMs)
}

function stopHealthLogging() {
  if (!healthLogIntervalId) {
    return
  }
  clearInterval(healthLogIntervalId)
  healthLogIntervalId = undefined
}

function startHealthLogging() {
  stopHealthLogging()
  healthLogIntervalId = setInterval(() => {
    verboseLog('Recorder health heartbeat', summarizeRecorderState())
    if (
      recordingSessionStarted &&
      mediaRecorder?.state === 'recording' &&
      lastChunkTimestamp &&
      Date.now() - lastChunkTimestamp > segmentDurationMs * 2
    ) {
      warningLog('No recorder chunk received within expected interval', summarizeRecorderState())
    }
    if (recordingSessionStarted && lastMeterPercent === 0) {
      warningLog('Recording level meter is pinned at 0%', summarizeRecorderState())
    }
  }, healthLogIntervalMs)
}

function getRecorderMimeType() {
  if (window.MediaRecorder?.isTypeSupported('audio/webm;codecs=opus')) {
    return 'audio/webm;codecs=opus'
  }
  if (window.MediaRecorder?.isTypeSupported('audio/webm')) {
    return 'audio/webm'
  }
  return ''
}

function stopSegmentFlushTimer() {
  if (!segmentFlushIntervalId) {
    return
  }
  clearInterval(segmentFlushIntervalId)
  segmentFlushIntervalId = undefined
}

function startSegmentFlushTimer() {
  stopSegmentFlushTimer()
  segmentFlushIntervalId = setInterval(() => {
    if (!segmentRecordingActive || mediaRecorder?.state !== 'recording') {
      return
    }
    verboseLog('Requesting recorder data flush', summarizeRecorderState())
    try {
      mediaRecorder.requestData()
    } catch (error) {
      warningLog('MediaRecorder.requestData failed', {
        error: error?.message || String(error),
        recorder: summarizeRecorderState(),
      })
    }
  }, segmentDurationMs)
}

function handleRecordedChunk(event) {
  lastChunkTimestamp = Date.now()
  const size = event.data?.size || 0
  currentChunkBytes = size

  verboseLog('Recorder dataavailable event fired', {
    size,
    type: event.data?.type || '',
    recorder: summarizeRecorderState(),
  })

  if (!size) {
    warningLog('Recorder emitted empty chunk', summarizeRecorderState())
    return
  }

  if (isStoppingSegmentRecorder && size < minTerminalChunkBytes) {
    verboseLog('Dropping tiny terminal recorder chunk', {
      size,
      minTerminalChunkBytes,
      recorder: summarizeRecorderState(),
    })
    return
  }

  recordingSegmentIndex += 1
  const finalizedIndex = recordingSegmentIndex
  const finalizedChunk = event.data

  segmentSaveChain = segmentSaveChain
    .then(async () => {
      if (!recordingTarget) {
        warningLog('Skipping chunk save because recording target is missing.', {
          segmentIndex: finalizedIndex,
        })
        return
      }
      const savedAs = await saveRecordedChunks(
        recordingTarget,
        [finalizedChunk],
        finalizedIndex
      )
      verboseLog('Saved recording segment', {
        segmentIndex: finalizedIndex,
        fileName: savedAs,
        size,
      })
    })
    .catch((error) => {
      warningLog('Failed to save recording segment', {
        segmentIndex: finalizedIndex,
        error: error?.message || String(error),
      })
    })
}

function startMediaRecorder() {
  if (!recordingDestStream?.stream) {
    warningLog('Cannot start recording: destination stream not ready.', {
      recorder: summarizeRecorderState(),
    })
    return false
  }
  if (!window.MediaRecorder) {
    warningLog('Cannot start recording: MediaRecorder is not supported.')
    return false
  }

  currentChunkBytes = 0
  recordingSegmentIndex = 0
  lastChunkTimestamp = Date.now()

  const mimeType = getRecorderMimeType()
  const recorderOptions = mimeType ? { mimeType } : undefined
  mediaRecorder = new MediaRecorder(recordingDestStream.stream, recorderOptions)

  mediaRecorder.addEventListener('start', () => {
    verboseLog('MediaRecorder started', summarizeRecorderState())
  })
  mediaRecorder.addEventListener('dataavailable', handleRecordedChunk)
  mediaRecorder.addEventListener('stop', () => {
    verboseLog('MediaRecorder stopped', summarizeRecorderState())
    stopSegmentFlushTimer()
  })
  mediaRecorder.addEventListener('error', (event) => {
    warningLog('MediaRecorder error event', {
      error: event.error?.message || String(event.error || 'unknown'),
      recorder: summarizeRecorderState(),
    })
  })

  mediaRecorder.start()
  startSegmentFlushTimer()

  verboseLog('Recording session started with periodic requestData flush', {
    segmentDurationMs,
    mimeType: mimeType || 'default',
    recorder: summarizeRecorderState(),
  })
  return true
}

async function saveRecordedChunks(target, chunks, segmentIndex) {
  const mimeType = getRecorderMimeType() || 'audio/webm'
  const blob = new Blob(chunks, { type: mimeType })
  const rawName = target.filename || recorderTargetName || getDefaultRecordingFilename()
  const baseName = rawName.replace(/\.webm$/i, '')
  const uploadFileName = `${baseName}.webm`
  const fallbackFileName = `${baseName}_part${String(segmentIndex).padStart(4, '0')}.webm`

  if (localChunkServiceState !== 'unavailable') {
    try {
      const uploadResult = await uploadChunkToLocalService(
        blob,
        uploadFileName,
        segmentIndex
      )
      localChunkServiceState = 'available'
      verboseLog('Saved recording segment via local service', {
        fileName: uploadFileName,
        path: uploadResult?.path || '',
        size: blob.size,
        chunkIndex: segmentIndex,
      })
      return uploadResult?.savedAs || uploadFileName
    } catch (error) {
      if (localChunkServiceState !== 'unavailable') {
        warningLog('Local recording chunk service unavailable; falling back to browser download', {
          fileName: uploadFileName,
          error: error?.message || String(error),
        })
      }
      localChunkServiceState = 'unavailable'
    }
  }

  const downloadUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = downloadUrl
  a.download = fallbackFileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
  return fallbackFileName
}

let recordingTarget = undefined

async function startAutomatedRecordingFlow() {
  if (recordingSessionStarted) {
    warningLog('Recording start ignored because a session is already active.', {
      recorder: summarizeRecorderState(),
    })
    return false
  }
  recordingSessionStarted = true
  segmentRecordingActive = true
  isStoppingSegmentRecorder = false
  segmentSaveChain = Promise.resolve()

  try {
    if (recordingContext?.state === 'suspended') {
      verboseLog('Resuming suspended AudioContext before recording start.')
      await recordingContext.resume()
    }
    recordingTarget = await promptForRecordingTarget()
    if (!recordingTarget) {
      recordingSessionStarted = false
      segmentRecordingActive = false
      return false
    }
    const started = startMediaRecorder()
    if (!started) {
      recordingSessionStarted = false
      segmentRecordingActive = false
      return false
    }
    room?.sendMessage?.('🎤 recording started.')
    startPeriodicPing()
    startHealthLogging()
    return true
  } catch (error) {
    recordingSessionStarted = false
    segmentRecordingActive = false
    warningLog('Failed to start automated recording flow', {
      error: error?.message || String(error),
      recorder: summarizeRecorderState(),
    })
    return false
  }
}

function stopMediaRecorder() {
  return new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      resolve(false)
      return
    }
    segmentRecordingActive = false
    isStoppingSegmentRecorder = true
    stopSegmentFlushTimer()
    mediaRecorder.addEventListener(
      'stop',
      () => {
        resolve(true)
      },
      { once: true }
    )
    try {
      mediaRecorder.requestData()
    } catch (error) {
      warningLog('Final MediaRecorder.requestData failed before stop', {
        error: error?.message || String(error),
      })
    }
    mediaRecorder.stop()
  })
}

function updateRecordingLevelMeter() {
  if (!recordingLevelAnalyser || !recordingLevelData) {
    return
  }

  recordingLevelAnalyser.getFloatTimeDomainData(recordingLevelData)
  let sumSquares = 0
  for (let i = 0; i < recordingLevelData.length; i++) {
    const sample = recordingLevelData[i]
    sumSquares += sample * sample
  }
  const rms = Math.sqrt(sumSquares / recordingLevelData.length)
  const meterPercent = Math.min(100, Math.round(rms * 250))
  lastMeterPercent = meterPercent

  if (recordingLevelBar) {
    recordingLevelBar.style.width = `${meterPercent}%`
  }
  if (recordingLevelValue) {
    recordingLevelValue.textContent = `${meterPercent}%`
  }

  recordingLevelRafId = window.requestAnimationFrame(updateRecordingLevelMeter)
}

function initRecordingLevelMeter(audioContext) {
  if (!audioContext || !recordingDestStream?.stream || !recordingLevelBar) {
    return
  }

  if (recordingLevelRafId) {
    window.cancelAnimationFrame(recordingLevelRafId)
    recordingLevelRafId = undefined
  }

  const meterSource = audioContext.createMediaStreamSource(recordingDestStream.stream)
  recordingLevelAnalyser = audioContext.createAnalyser()
  recordingLevelAnalyser.fftSize = 2048
  recordingLevelData = new Float32Array(recordingLevelAnalyser.fftSize)
  meterSource.connect(recordingLevelAnalyser)
  updateRecordingLevelMeter()
}

async function stopAutomatedRecordingFlow() {
  stopPeriodicPing()
  stopHealthLogging()
  const stopped = await stopMediaRecorder()
  await segmentSaveChain
  if (!stopped) {
    verboseLog('No active recording to stop.')
  }

  room?.sendMessage?.('🛑 recording stopped.')
  recordingSessionStarted = false
  segmentRecordingActive = false
  isStoppingSegmentRecorder = false
}

function initAudio() {
  const audioContext = new AudioContext()
  recordingContext = audioContext
  recordingDestStream = audioContext.createMediaStreamDestination()
  initRecordingLevelMeter(audioContext)

  verboseLog('InitAudio - Preparing conference audio recording stream.', {
    audioContextState: audioContext.state,
    destStream: summarizeDestStream(),
  })

  audioContext.addEventListener('statechange', () => {
    verboseLog('AudioContext state changed', {
      audioContextState: audioContext.state,
      recorder: summarizeRecorderState(),
    })
  })

  const destTrack = recordingDestStream.stream.getAudioTracks()[0]
  if (destTrack) {
    destTrack.addEventListener('ended', () => {
      warningLog('Recording destination audio track ended', summarizeRecorderState())
    })
    destTrack.addEventListener('mute', () => {
      warningLog('Recording destination audio track muted', summarizeRecorderState())
    })
    destTrack.addEventListener('unmute', () => {
      verboseLog('Recording destination audio track unmuted', summarizeRecorderState())
    })
  }

  initDone = true
  flushPendingRemoteAudioTracks()
}

function printParticipants() {
  const participants = room.getParticipants()
  const html_participantsInner = document.querySelector('#participantsInner')

  html_participantsInner.innerHTML = ''

  participants.forEach((participant) => {
    const part_element = document.createElement('div')
    part_element.textContent = `${participant.getStatsID()}: ${participant._displayName.replaceAll(
      / +/g,
      ' '
    )} ${participant.isModerator() ? '👑' : ''}`
    participant.isModerator() && part_element.classList.add('isModerator')
    part_element.classList.add('participant')
    html_participantsInner.append(part_element)
  })
}

window.startAutomatedRecordingFlow = startAutomatedRecordingFlow
window.stopAutomatedRecordingFlow = stopAutomatedRecordingFlow

function connectRemoteAudioTrack(track) {
  if (!recordingContext || !recordingDestStream?.stream || !track) {
    return false
  }
  if (track.getType?.() !== 'audio') {
    return false
  }

  if (remoteAudioNodes.has(track)) {
    return true
  }

  const originalStream = track.getOriginalStream?.()
  if (!originalStream || originalStream.getAudioTracks().length === 0) {
    warningLog('Remote audio track has no original audio stream.', {
      participantId: track.getParticipantId?.() || 'unknownParticipant',
    })
    return false
  }

  try {
    const sourceNode = recordingContext.createMediaStreamSource(originalStream)
    const gainNode = recordingContext.createGain()
    const participantId = track.getParticipantId?.() || 'unknownParticipant'
    gainNode.gain.value = 1

    sourceNode.connect(gainNode)
    gainNode.connect(recordingDestStream)
    remoteAudioNodes.set(track, {
      sourceNode,
      gainNode,
    })
    connectedRemoteAudioTrackCount += 1
    verboseLog('Connected remote audio track to recording mix', {
      participantId,
      trackId: track.getTrackId?.() || '',
      recorder: summarizeRecorderState(),
    })
    return true
  } catch (error) {
    warningLog('Failed to connect remote audio track', {
      error: error?.message || String(error),
      participantId: track.getParticipantId?.() || 'unknownParticipant',
    })
    return false
  }
}

function flushPendingRemoteAudioTracks() {
  if (!recordingContext || !recordingDestStream?.stream || pendingRemoteAudioTracks.size === 0) {
    return
  }

  for (const track of [...pendingRemoteAudioTracks]) {
    if (connectRemoteAudioTrack(track)) {
      pendingRemoteAudioTracks.delete(track)
    }
  }
}

window.registerRemoteAudioTrackForRecording = (track) => {
  if (!track || track.getType?.() !== 'audio') {
    return
  }
  if (!initDone || !recordingContext || !recordingDestStream?.stream) {
    pendingRemoteAudioTracks.add(track)
    warningLog('Queued remote audio track because recording audio is not ready yet.', {
      participantId: track.getParticipantId?.() || 'unknownParticipant',
      pendingRemoteAudioTracks: pendingRemoteAudioTracks.size,
    })
    return
  }
  connectRemoteAudioTrack(track)
}

window.unregisterRemoteAudioTrackForRecording = (track) => {
  if (!track || track.getType?.() !== 'audio') {
    return
  }
  pendingRemoteAudioTracks.delete(track)
  const nodes = remoteAudioNodes.get(track)
  if (!nodes) {
    return
  }
  try {
    nodes.sourceNode.disconnect()
  } catch (error) {
    console.log('Failed to disconnect remote source node', error)
  }
  try {
    nodes.gainNode.disconnect()
  } catch (error) {
    console.log('Failed to disconnect remote gain node', error)
  }
  remoteAudioNodes.delete(track)
  connectedRemoteAudioTrackCount = Math.max(0, connectedRemoteAudioTrackCount - 1)
  verboseLog('Disconnected remote audio track from recording mix', {
    participantId: track.getParticipantId?.() || 'unknownParticipant',
    recorder: summarizeRecorderState(),
  })
}

attachCrashSignalLogging()
initAudio()
