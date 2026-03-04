/**
 * Credit: Jimmi Music Bot for Jitsi https://github.com/Music-Bot-for-Jitsi/Jimmi
 */

function ensureHiddenMediaElement(selector, tagName, defaults = {}) {
  let element = document.querySelector(selector)
  if (element) {
    return element
  }

  element = document.createElement(tagName)
  if (selector.startsWith('#')) {
    element.id = selector.slice(1)
  }
  element.crossOrigin = 'anonymous'
  element.preload = 'auto'
  element.style.display = 'none'
  if (defaults.src) {
    element.src = defaults.src
  }
  if (tagName === 'video') {
    element.playsInline = true
  }
  document.body.appendChild(element)
  return element
}

const recording = ensureHiddenMediaElement('#recording', 'audio', {
  src: '../audio/nggyu.mp3',
})
const videoboard = ensureHiddenMediaElement('#videoboard', 'video', {
  src: '../video/big-buck-bunny-sample.mp4',
})
const recordingLevelBar = document.querySelector('#recordingLevelBar')
const recordingLevelValue = document.querySelector('#recordingLevelValue')

recording.volume = 0.1
videoboard.volume = 0.1

let gainNode = undefined
let recordingContext = undefined

let recordingDestStream = undefined
let serverDestStream = undefined
let serverOutputGainNode = undefined
let recordingInputGainNode = undefined

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

function getRecorderMimeType() {
  if (window.MediaRecorder?.isTypeSupported('audio/webm;codecs=opus')) {
    return 'audio/webm;codecs=opus'
  }
  if (window.MediaRecorder?.isTypeSupported('audio/webm')) {
    return 'audio/webm'
  }
  return ''
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
  if (!recording) {
    console.error('Error with Recording Audio Element.')
  }

  const audioContext = new AudioContext()
  recordingContext = audioContext
  const videoAudio = audioContext.createMediaElementSource(videoboard)
  const track = audioContext.createMediaElementSource(recording)
  recordingDestStream = audioContext.createMediaStreamDestination()
  serverDestStream = audioContext.createMediaStreamDestination()
  serverOutputGainNode = audioContext.createGain()
  recordingInputGainNode = audioContext.createGain()
  serverOutputGainNode.gain.value = 1
  recordingInputGainNode.gain.value = 1
  initRecordingLevelMeter(audioContext)

  videoAudio.connect(recordingInputGainNode)
  track.connect(recordingInputGainNode)
  recordingInputGainNode.connect(recordingDestStream)
  videoAudio.connect(serverOutputGainNode)
  track.connect(serverOutputGainNode)
  serverOutputGainNode.connect(serverDestStream)

  log('InitAudio - Preparing Audio Stream')
  log(`AudioContext allowed: ${audioContext.state !== 'suspended'}`)
  navigator.mediaDevices.getUserMedia = async function ({ audio, video }) {
    console.log({ audio, video })
    log(
      'UserMedia is being Accessed. - Returning corresponding context stream.'
    )

    await audioContext.resume()
    if (audio) {
      return serverDestStream.stream
    }
    if (video) {
      const videoStream = new MediaStream()
      videoStream.addTrack(videoboard.captureStream().getVideoTracks()[0])
      return videoStream
    }
    return serverDestStream.stream
  }

  initDone = true
  flushPendingRemoteAudioTracks()
}

document
  .querySelector('#recordingInputForm')
  ?.addEventListener('submit', (ev) => {
    ev.preventDefault()
    ev.stopPropagation()
    const recordingSourceInput = document.querySelector('#recordingSourceInput')
    if (!recordingSourceInput.validity.valid) {
      return false
    }
    try {
      log(`Trying to load URL ${recordingSourceInput.value}`)
      recording.src = recordingSourceInput.value
      recordingSourceInput.value = ''
    } catch (error) {
      console.log(error)
      log(`Error Loading Audiofile.`)
    }
  })

initAudio()

function getRecordingCurrentTrackName() {
  let splittedPath = new URL(recording.src).pathname.split('/')

  return splittedPath[splittedPath.length - 1].split('.')[0]
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
  if (
    !recordingContext ||
    !recordingDestStream?.stream ||
    !serverOutputGainNode ||
    !recordingInputGainNode ||
    !track
  ) {
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
    const recordingGainNode = recordingContext.createGain()
    recordingGainNode.gain.value = 1
    sourceNode.connect(recordingGainNode)
    recordingGainNode.connect(recordingInputGainNode)
    remoteAudioNodes.set(track, { sourceNode, recordingGainNode })
    return true
  } catch (error) {
    log(`Failed to connect remote audio track: ${error?.message || error}`)
    return false
  }
}

function flushPendingRemoteAudioTracks() {
  if (
    !recordingContext ||
    !recordingDestStream?.stream ||
    !serverOutputGainNode ||
    !recordingInputGainNode ||
    pendingRemoteAudioTracks.size === 0
  ) {
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
  if (
    !initDone ||
    !recordingContext ||
    !recordingDestStream?.stream ||
    !serverOutputGainNode ||
    !recordingInputGainNode
  ) {
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
    nodes.recordingGainNode.disconnect()
  } catch (error) {
    console.log('Failed to disconnect remote gain node', error)
  }
  remoteAudioNodes.delete(track)
}

window.setRecordingBotOutputVolume = (value = 0) => {
  if (!serverOutputGainNode || !recordingContext) {
    return
  }

  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const normalized = numeric > 1 ? numeric / 100 : numeric
  const clamped = Math.min(1, Math.max(0, normalized))
  serverOutputGainNode.gain.setValueAtTime(clamped, recordingContext.currentTime)
}

window.setRecordingBotInputVolume = (value = 100) => {
  if (!recordingInputGainNode || !recordingContext) {
    return
  }

  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const normalized = numeric > 1 ? numeric / 100 : numeric
  const clamped = Math.min(1, Math.max(0, normalized))
  recordingInputGainNode.gain.setValueAtTime(clamped, recordingContext.currentTime)
}
