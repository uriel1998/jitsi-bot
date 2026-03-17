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
let currentSegmentChunks = []
let recordingSegmentIndex = 0
let segmentStopTimerId = undefined
let segmentRecordingActive = false
let isStoppingSegmentRecorder = false
let segmentSaveChain = Promise.resolve()
const remoteAudioNodes = new WeakMap()
const pendingRemoteAudioTracks = new Set()
let recordingLevelAnalyser = undefined
let recordingLevelData = undefined
let recordingLevelRafId = undefined

const pingIntervalMs = 5 * 60 * 1000
const segmentDurationMs = 5 * 60 * 1000
let pingIntervalId = undefined

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
    log('Recording setup was cancelled.')
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

function getRecorderMimeType() {
  if (window.MediaRecorder?.isTypeSupported('audio/webm;codecs=opus')) {
    return 'audio/webm;codecs=opus'
  }
  if (window.MediaRecorder?.isTypeSupported('audio/webm')) {
    return 'audio/webm'
  }
  return ''
}

function startMediaRecorder() {
  if (!recordingDestStream?.stream) {
    log('Cannot start recording: destination stream not ready.')
    return false
  }
  if (!window.MediaRecorder) {
    log('Cannot start recording: MediaRecorder is not supported.')
    return false
  }

  currentSegmentChunks = []
  recordingSegmentIndex += 1
  const mimeType = getRecorderMimeType()
  const recorderOptions = mimeType ? { mimeType } : undefined
  mediaRecorder = new MediaRecorder(recordingDestStream.stream, recorderOptions)

  mediaRecorder.addEventListener('dataavailable', (event) => {
    if (event.data && event.data.size > 0) {
      currentSegmentChunks.push(event.data)
    }
  })

  mediaRecorder.addEventListener(
    'stop',
    () => {
      const finalizedChunks = currentSegmentChunks
      currentSegmentChunks = []
      const finalizedIndex = recordingSegmentIndex

      segmentSaveChain = segmentSaveChain
        .then(async () => {
          if (!finalizedChunks.length || !recordingTarget) {
            return
          }
          const savedAs = await saveRecordedChunks(
            recordingTarget,
            finalizedChunks,
            finalizedIndex
          )
          log(`Saved recording segment ${finalizedIndex}: ${savedAs}`)
        })
        .catch((error) => {
          log(`Failed to save recording segment: ${error?.message || error}`)
        })
        .finally(() => {
          if (segmentRecordingActive) {
            startMediaRecorder()
          }
        })
    },
    { once: true }
  )

  mediaRecorder.start()
  clearTimeout(segmentStopTimerId)
  segmentStopTimerId = setTimeout(() => {
    if (
      mediaRecorder &&
      mediaRecorder.state === 'recording' &&
      !isStoppingSegmentRecorder
    ) {
      mediaRecorder.stop()
    }
  }, segmentDurationMs)

  log(
    `Recording segment ${recordingSegmentIndex} started: ${
      recorderTargetName || getDefaultRecordingFilename()
    }`
  )
  return true
}

async function saveRecordedChunks(target, chunks, segmentIndex) {
  const mimeType = getRecorderMimeType() || 'audio/webm'
  const blob = new Blob(chunks, { type: mimeType })
  const rawName = target.filename || recorderTargetName || getDefaultRecordingFilename()
  const baseName = rawName.replace(/\.webm$/i, '')
  const fileName = `${baseName}_part${String(segmentIndex).padStart(4, '0')}.webm`
  const downloadUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = downloadUrl
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
  return fileName
}

let recordingTarget = undefined

async function startAutomatedRecordingFlow() {
  if (recordingSessionStarted) {
    return false
  }
  recordingSessionStarted = true
  recordingSegmentIndex = 0
  segmentRecordingActive = true
  isStoppingSegmentRecorder = false
  segmentSaveChain = Promise.resolve()

  try {
    if (recordingContext?.state === 'suspended') {
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
    return true
  } catch (error) {
    recordingSessionStarted = false
    log(`Failed to start automated recording flow: ${error?.message || error}`)
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
    clearTimeout(segmentStopTimerId)
    mediaRecorder.addEventListener(
      'stop',
      () => {
        resolve(true)
      },
      { once: true }
    )
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
  const stopped = await stopMediaRecorder()
  await segmentSaveChain
  if (!stopped) {
    log('No active recording to stop.')
  }

  room?.sendMessage?.('🛑 recording stopped.')
  recordingSessionStarted = false
  segmentRecordingActive = false
  isStoppingSegmentRecorder = false
  clearTimeout(segmentStopTimerId)
}

function initAudio() {
  const audioContext = new AudioContext()
  recordingContext = audioContext
  recordingDestStream = audioContext.createMediaStreamDestination()
  initRecordingLevelMeter(audioContext)

  log('InitAudio - Preparing conference audio recording stream.')
  log(`AudioContext allowed: ${audioContext.state !== 'suspended'}`)

  initDone = true
  flushPendingRemoteAudioTracks()
}

initAudio()

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
    log('Remote audio track has no original audio stream.')
    return false
  }

  try {
    const sourceNode = recordingContext.createMediaStreamSource(originalStream)
    const gainNode = recordingContext.createGain()
    gainNode.gain.value = 1

    sourceNode.connect(gainNode)
    gainNode.connect(recordingDestStream)
    remoteAudioNodes.set(track, {
      sourceNode,
      gainNode,
    })
    return true
  } catch (error) {
    log(`Failed to connect remote audio track: ${error?.message || error}`)
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
}
