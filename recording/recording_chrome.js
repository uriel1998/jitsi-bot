/**
 * Credit: Jimmi Music Bot for Jitsi https://github.com/Music-Bot-for-Jitsi/Jimmi
 */

window.recordingVariant = 'chrome'
window.recordingChromeCaptureMode = 'hidden_audio_recapture'

const recordingLevelBar = document.querySelector('#recordingLevelBar')
const recordingLevelValue = document.querySelector('#recordingLevelValue')
const hiddenAudioContainer = document.querySelector('#hiddenAudioContainer')

let recordingContext = undefined
let recordingDestStream = undefined

let initDone = false

let recordingSessionStarted = false
let recordingSessionStartMs = 0
let recorderTargetName = undefined
let mediaRecorder = undefined
let currentChunkBytes = 0
let recordingSegmentIndex = 0
let segmentFlushIntervalId = undefined
let segmentRecordingActive = false
let isStoppingSegmentRecorder = false
let segmentSaveChain = Promise.resolve()
const remoteAudioNodes = new Map()
const pendingRemoteAudioTracks = new Set()
const connectingRemoteAudioTracks = new Map()
let connectedRemoteAudioTrackCount = 0
let activePerSpeakerRecorderCount = 0
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
    recordingVariant: window.recordingVariant || 'default',
    captureMode: window.recordingChromeCaptureMode || 'unknown',
    recordingSessionStarted,
    segmentRecordingActive,
    isStoppingSegmentRecorder,
    recorderState: mediaRecorder?.state || 'inactive',
    segmentIndex: recordingSegmentIndex,
    recordingSessionStartMs,
    currentChunkBytes,
    remoteAudioNodeCount: connectedRemoteAudioTrackCount,
    pendingRemoteAudioTracks: pendingRemoteAudioTracks.size,
    activePerSpeakerRecorderCount,
    audioContextState: recordingContext?.state || 'missing',
    lastMeterPercent,
    msSinceLastChunk: lastChunkTimestamp ? Date.now() - lastChunkTimestamp : null,
    destStream: summarizeDestStream(),
    memory: summarizeMemory(),
  }
}

function summarizeRemoteAudioTrack(track) {
  if (!track) {
    return {}
  }

  const originalStream = track.getOriginalStream?.()
  const originalAudioTrack = originalStream?.getAudioTracks?.()?.[0]
  return {
    participantId: track.getParticipantId?.() || 'unknownParticipant',
    trackId: track.getTrackId?.() || '',
    type: track.getType?.() || '',
    isMuted: track.isMuted?.() ?? null,
    isLocal: track.isLocal?.() ?? null,
    hasOriginalStream: Boolean(originalStream),
    originalAudioTrackCount: originalStream?.getAudioTracks?.()?.length ?? 0,
    originalReadyState: originalAudioTrack?.readyState ?? null,
    originalMuted: originalAudioTrack?.muted ?? null,
    originalEnabled: originalAudioTrack?.enabled ?? null,
    originalLabel: originalAudioTrack?.label || '',
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

function sanitizeFilenamePart(value, fallback = 'speaker') {
  const normalized = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\.+$/g, '')
  return normalized || fallback
}

function getRecordingBaseName() {
  const rawName = recordingTarget?.filename || recorderTargetName || getDefaultRecordingFilename()
  return rawName.replace(/\.webm$/i, '')
}

function buildSpeakerRecordingFilename(label, startedAtMs) {
  const baseName = getRecordingBaseName()
  const safeLabel = sanitizeFilenamePart(label, 'speaker')
  const offsetSeconds = Math.max(
    0,
    Math.floor((startedAtMs - recordingSessionStartMs) / 1000)
  )
  if (offsetSeconds > 0) {
    return `${baseName}_${safeLabel}_${offsetSeconds}.webm`
  }
  return `${baseName}_${safeLabel}.webm`
}

function getParticipantRecordingLabel(track) {
  const participantId = track?.getParticipantId?.()
  const participant =
    participantId && typeof room?.getParticipantById === 'function'
      ? room.getParticipantById(participantId)
      : undefined

  return sanitizeFilenamePart(
    participant?._displayName ||
      participant?.getDisplayName?.() ||
      participant?._statsID ||
      participant?.getStatsID?.() ||
      participantId ||
      track?.getTrackId?.(),
    'speaker'
  )
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
    if (!segmentRecordingActive) {
      return
    }
    verboseLog('Requesting recorder data flush', summarizeRecorderState())

    const activeRecorders = []
    if (mediaRecorder?.state === 'recording') {
      activeRecorders.push({
        recorder: mediaRecorder,
        kind: 'mix',
      })
    }
    for (const entry of remoteAudioNodes.values()) {
      if (entry?.recorder?.state === 'recording') {
        activeRecorders.push({
          recorder: entry.recorder,
          kind: 'speaker',
          participantId: entry.participantId,
          fileName: entry.target?.filename || '',
        })
      }
    }

    for (const activeRecorder of activeRecorders) {
      try {
        activeRecorder.recorder.requestData()
      } catch (error) {
        warningLog('MediaRecorder.requestData failed', {
          kind: activeRecorder.kind,
          participantId: activeRecorder.participantId || '',
          fileName: activeRecorder.fileName || '',
          error: error?.message || String(error),
          recorder: summarizeRecorderState(),
        })
      }
    }
  }, segmentDurationMs)
}

function handleRecordedChunk(event, options = {}) {
  lastChunkTimestamp = Date.now()
  const size = event.data?.size || 0
  const {
    target = recordingTarget,
    setChunkBytes = (value) => {
      currentChunkBytes = value
    },
    getSegmentIndex = () => recordingSegmentIndex,
    setSegmentIndex = (value) => {
      recordingSegmentIndex = value
    },
    getSaveChain = () => segmentSaveChain,
    setSaveChain = (chain) => {
      segmentSaveChain = chain
    },
    logContext = {},
  } = options
  setChunkBytes(size)

  verboseLog('Recorder dataavailable event fired', {
    size,
    type: event.data?.type || '',
    ...logContext,
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

  const finalizedIndex = getSegmentIndex() + 1
  setSegmentIndex(finalizedIndex)
  const finalizedChunk = event.data

  const nextSaveChain = getSaveChain()
    .then(async () => {
      if (!target) {
        warningLog('Skipping chunk save because recording target is missing.', {
          segmentIndex: finalizedIndex,
          ...logContext,
        })
        return
      }
      const savedAs = await saveRecordedChunks(target, [finalizedChunk], finalizedIndex)
      verboseLog('Saved recording segment', {
        segmentIndex: finalizedIndex,
        fileName: savedAs,
        size,
        ...logContext,
      })
    })
    .catch((error) => {
      warningLog('Failed to save recording segment', {
        segmentIndex: finalizedIndex,
        ...logContext,
        error: error?.message || String(error),
      })
    })
  setSaveChain(nextSaveChain)
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
  mediaRecorder.addEventListener('dataavailable', (event) => handleRecordedChunk(event))
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

function createPerSpeakerRecorderEntry(track, sourceNode, gainNode) {
  return {
    track,
    participantId: track.getParticipantId?.() || 'unknownParticipant',
    label: getParticipantRecordingLabel(track),
    sourceNode,
    gainNode,
    audioElement: undefined,
    individualDest: undefined,
    recorder: undefined,
    target: undefined,
    segmentIndex: 0,
    currentChunkBytes: 0,
    saveChain: Promise.resolve(),
    startedAtMs: 0,
  }
}

function attachAudioElementListeners(audioElement, track) {
  const eventNames = [
    'play',
    'playing',
    'pause',
    'waiting',
    'stalled',
    'suspend',
    'loadedmetadata',
    'loadeddata',
    'canplay',
    'canplaythrough',
    'ended',
    'error',
  ]

  for (const eventName of eventNames) {
    audioElement.addEventListener(eventName, () => {
      verboseLog('Chrome hidden audio element event', {
        eventName,
        participantId: track.getParticipantId?.() || 'unknownParticipant',
        readyState: audioElement.readyState,
        paused: audioElement.paused,
        currentTime: audioElement.currentTime,
      })
    })
  }
}

async function ensureHiddenAudioElement(track) {
  const audioElement = document.createElement('audio')
  audioElement.autoplay = true
  audioElement.playsInline = true
  audioElement.controls = false
  audioElement.muted = true
  audioElement.defaultMuted = true
  audioElement.volume = 0
  audioElement.dataset.participantId = track.getParticipantId?.() || 'unknownParticipant'
  audioElement.style.display = 'none'
  hiddenAudioContainer?.appendChild(audioElement)
  attachAudioElementListeners(audioElement, track)

  track.attach(audioElement)
  verboseLog('Attached remote track to hidden audio element', {
    participantId: track.getParticipantId?.() || 'unknownParticipant',
    track: summarizeRemoteAudioTrack(track),
  })

  await audioElement.play()
  verboseLog('Hidden audio element play() resolved', {
    participantId: track.getParticipantId?.() || 'unknownParticipant',
    readyState: audioElement.readyState,
    paused: audioElement.paused,
    muted: audioElement.muted,
    volume: audioElement.volume,
  })

  return audioElement
}

function getAudioElementCaptureStream(audioElement) {
  if (typeof audioElement.captureStream === 'function') {
    return audioElement.captureStream()
  }
  if (typeof audioElement.mozCaptureStream === 'function') {
    return audioElement.mozCaptureStream()
  }
  return undefined
}

function startPerSpeakerRecorder(entry) {
  if (
    !entry ||
    entry.recorder ||
    !recordingSessionStarted ||
    !recordingContext ||
    !recordingTarget ||
    mediaRecorder?.state !== 'recording'
  ) {
    return false
  }

  const originalStream = entry.track?.getOriginalStream?.()
  if (!originalStream || originalStream.getAudioTracks().length === 0) {
    warningLog('Cannot start per-speaker recorder: no source stream.', {
      participantId: entry.participantId,
      label: entry.label,
    })
    return false
  }

  entry.label = getParticipantRecordingLabel(entry.track)
  const startedAtMs = Date.now()
  const target = {
    mode: 'download',
    filename: buildSpeakerRecordingFilename(entry.label, startedAtMs),
  }
  const individualDest = recordingContext.createMediaStreamDestination()
  const mimeType = getRecorderMimeType()
  const recorderOptions = mimeType ? { mimeType } : undefined
  const recorder = new MediaRecorder(individualDest.stream, recorderOptions)

  entry.gainNode.connect(individualDest)
  entry.individualDest = individualDest
  entry.recorder = recorder
  entry.target = target
  entry.segmentIndex = 0
  entry.currentChunkBytes = 0
  entry.saveChain = Promise.resolve()
  entry.startedAtMs = startedAtMs
  activePerSpeakerRecorderCount += 1

  recorder.addEventListener('start', () => {
    verboseLog('Per-speaker MediaRecorder started', {
      participantId: entry.participantId,
      label: entry.label,
      fileName: target.filename,
    })
  })
  recorder.addEventListener('dataavailable', (event) =>
    handleRecordedChunk(event, {
      target: entry.target,
      setChunkBytes: (value) => {
        entry.currentChunkBytes = value
      },
      getSegmentIndex: () => entry.segmentIndex,
      setSegmentIndex: (value) => {
        entry.segmentIndex = value
      },
      getSaveChain: () => entry.saveChain,
      setSaveChain: (chain) => {
        entry.saveChain = chain
      },
      logContext: {
        kind: 'speaker',
        participantId: entry.participantId,
        label: entry.label,
        fileName: entry.target?.filename || '',
      },
    })
  )
  recorder.addEventListener('stop', () => {
    verboseLog('Per-speaker MediaRecorder stopped', {
      participantId: entry.participantId,
      label: entry.label,
      fileName: entry.target?.filename || '',
    })
  })
  recorder.addEventListener('error', (event) => {
    warningLog('Per-speaker MediaRecorder error event', {
      participantId: entry.participantId,
      label: entry.label,
      fileName: entry.target?.filename || '',
      error: event.error?.message || String(event.error || 'unknown'),
    })
  })

  recorder.start()
  return true
}

async function stopPerSpeakerRecorder(entry) {
  if (!entry?.recorder || entry.recorder.state === 'inactive') {
    return false
  }

  const recorder = entry.recorder
  await new Promise((resolve) => {
    recorder.addEventListener(
      'stop',
      () => {
        resolve()
      },
      { once: true }
    )
    try {
      recorder.requestData()
    } catch (error) {
      warningLog('Final per-speaker MediaRecorder.requestData failed before stop', {
        participantId: entry.participantId,
        label: entry.label,
        fileName: entry.target?.filename || '',
        error: error?.message || String(error),
      })
    }
    recorder.stop()
  })

  await entry.saveChain
  if (entry.individualDest) {
    try {
      entry.gainNode.disconnect(entry.individualDest)
    } catch (error) {
      console.log('Failed to disconnect per-speaker destination', error)
    }
  }
  entry.recorder = undefined
  entry.target = undefined
  entry.segmentIndex = 0
  entry.currentChunkBytes = 0
  entry.startedAtMs = 0
  entry.individualDest = undefined
  activePerSpeakerRecorderCount = Math.max(0, activePerSpeakerRecorderCount - 1)
  return true
}

async function startAutomatedRecordingFlow() {
  if (recordingSessionStarted) {
    warningLog('Recording start ignored because a session is already active.', {
      recorder: summarizeRecorderState(),
    })
    return false
  }
  recordingSessionStarted = true
  recordingSessionStartMs = Date.now()
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
      recordingSessionStartMs = 0
      segmentRecordingActive = false
      return false
    }
    await flushPendingRemoteAudioTracks()
    const started = startMediaRecorder()
    if (!started) {
      recordingSessionStarted = false
      recordingSessionStartMs = 0
      segmentRecordingActive = false
      return false
    }
    for (const entry of remoteAudioNodes.values()) {
      startPerSpeakerRecorder(entry)
    }
    room?.sendMessage?.('🎤 recording started.')
    startPeriodicPing()
    startHealthLogging()
    return true
  } catch (error) {
    recordingSessionStarted = false
    recordingSessionStartMs = 0
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
  await Promise.all(
    [...remoteAudioNodes.values()].map((entry) => stopPerSpeakerRecorder(entry))
  )
  await segmentSaveChain
  if (!stopped) {
    verboseLog('No active recording to stop.')
  }

  room?.sendMessage?.('🛑 recording stopped.')
  recordingSessionStarted = false
  recordingSessionStartMs = 0
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

async function connectRemoteAudioTrack(track) {
  if (!recordingContext || !recordingDestStream?.stream || !track) {
    return false
  }
  if (track.getType?.() !== 'audio') {
    return false
  }

  if (remoteAudioNodes.has(track)) {
    return true
  }
  if (connectingRemoteAudioTracks.has(track)) {
    return connectingRemoteAudioTracks.get(track)
  }

  const originalStream = track.getOriginalStream?.()
  if (!originalStream || originalStream.getAudioTracks().length === 0) {
    warningLog('Remote audio track has no original audio stream.', {
      track: summarizeRemoteAudioTrack(track),
      recorder: summarizeRecorderState(),
    })
    return false
  }

  const connectPromise = (async () => {
    const originalAudioTrack = originalStream.getAudioTracks()[0]
    const audioElement = await ensureHiddenAudioElement(track)
    const capturedElementStream = getAudioElementCaptureStream(audioElement)
    const capturedAudioTracks = capturedElementStream?.getAudioTracks?.() || []
    if (!capturedElementStream || capturedAudioTracks.length === 0) {
      warningLog('Hidden audio element captureStream produced no audio tracks.', {
        participantId: track.getParticipantId?.() || 'unknownParticipant',
        track: summarizeRemoteAudioTrack(track),
        recorder: summarizeRecorderState(),
      })
      return false
    }

    const sourceNode = recordingContext.createMediaStreamSource(capturedElementStream)
    const gainNode = recordingContext.createGain()
    const participantId = track.getParticipantId?.() || 'unknownParticipant'
    gainNode.gain.value = 1

    originalAudioTrack?.addEventListener?.('ended', () => {
      warningLog('Original remote audio track ended', {
        track: summarizeRemoteAudioTrack(track),
        recorder: summarizeRecorderState(),
      })
    })
    originalAudioTrack?.addEventListener?.('mute', () => {
      warningLog('Original remote audio track muted', {
        track: summarizeRemoteAudioTrack(track),
        recorder: summarizeRecorderState(),
      })
    })
    originalAudioTrack?.addEventListener?.('unmute', () => {
      verboseLog('Original remote audio track unmuted', {
        track: summarizeRemoteAudioTrack(track),
        recorder: summarizeRecorderState(),
      })
    })

    sourceNode.connect(gainNode)
    gainNode.connect(recordingDestStream)
    const entry = createPerSpeakerRecorderEntry(track, sourceNode, gainNode)
    entry.audioElement = audioElement
    remoteAudioNodes.set(track, entry)
    connectedRemoteAudioTrackCount += 1
    if (recordingSessionStarted) {
      startPerSpeakerRecorder(entry)
    }
    verboseLog('Connected remote audio track to recording mix', {
      captureMode: window.recordingChromeCaptureMode,
      participantId,
      label: entry.label,
      capturedAudioTrackCount: capturedAudioTracks.length,
      track: summarizeRemoteAudioTrack(track),
      recorder: summarizeRecorderState(),
    })
    return true
  })()
    .catch((error) => {
    warningLog('Failed to connect remote audio track', {
      error: error?.message || String(error),
      track: summarizeRemoteAudioTrack(track),
      recorder: summarizeRecorderState(),
    })
    return false
    })
    .finally(() => {
      connectingRemoteAudioTracks.delete(track)
    })

  connectingRemoteAudioTracks.set(track, connectPromise)
  return connectPromise
}

async function flushPendingRemoteAudioTracks() {
  if (!recordingContext || !recordingDestStream?.stream || pendingRemoteAudioTracks.size === 0) {
    return
  }

  const tracks = [...pendingRemoteAudioTracks]
  for (const track of tracks) {
    const connected = await connectRemoteAudioTrack(track)
    if (connected) {
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
      track: summarizeRemoteAudioTrack(track),
      pendingRemoteAudioTracks: pendingRemoteAudioTracks.size,
      recorder: summarizeRecorderState(),
    })
    return
  }
  void connectRemoteAudioTrack(track)
}

window.unregisterRemoteAudioTrackForRecording = (track) => {
  if (!track || track.getType?.() !== 'audio') {
    return
  }
  pendingRemoteAudioTracks.delete(track)
  connectingRemoteAudioTracks.delete(track)
  const entry = remoteAudioNodes.get(track)
  if (!entry) {
    return
  }
  Promise.resolve()
    .then(() => stopPerSpeakerRecorder(entry))
    .catch((error) => {
      warningLog('Failed to stop per-speaker recorder during track removal', {
        participantId: entry.participantId,
        label: entry.label,
        error: error?.message || String(error),
      })
    })
    .finally(() => {
      try {
        entry.sourceNode.disconnect()
      } catch (error) {
        console.log('Failed to disconnect remote source node', error)
      }
      try {
        if (entry.audioElement) {
          entry.track.detach?.(entry.audioElement)
          entry.audioElement.remove()
        }
      } catch (error) {
        console.log('Failed to detach hidden audio element', error)
      }
      try {
        entry.gainNode.disconnect()
      } catch (error) {
        console.log('Failed to disconnect remote gain node', error)
      }
      remoteAudioNodes.delete(track)
      connectedRemoteAudioTrackCount = Math.max(0, connectedRemoteAudioTrackCount - 1)
      verboseLog('Disconnected remote audio track from recording mix', {
        participantId: track.getParticipantId?.() || 'unknownParticipant',
        label: entry.label,
        recorder: summarizeRecorderState(),
      })
    })
}

attachCrashSignalLogging()
initAudio()
warningLog(
  'Chrome/Chromium recording variant loaded. Using hidden audio element recapture into the standard recording mix.'
)
