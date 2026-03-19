const chromeTestConfig = {
  slug: 'unnamed_probe',
  name: 'Unnamed probe',
  description: '',
  attachAudioElements: false,
  analyzeOriginalStream: true,
  connectOriginalStreamToMix: false,
  analyzeAudioElement: false,
  connectAudioElementToMix: false,
  mirrorAudioElementToDestination: false,
  enableMediaRecorderProbe: false,
  exposeOutputRouting: false,
  probeChunkIntervalMs: 5000,
  startSilent: false,
  ...(window.chromeTestConfig || {}),
}

const rawLevelBar = document.querySelector('#rawLevelBar')
const rawLevelValue = document.querySelector('#rawLevelValue')
const elementLevelBar = document.querySelector('#elementLevelBar')
const elementLevelValue = document.querySelector('#elementLevelValue')
const mixLevelBar = document.querySelector('#mixLevelBar')
const mixLevelValue = document.querySelector('#mixLevelValue')
const diagnosticsElement = document.querySelector('#trackDiagnostics')
const hiddenAudioContainer = document.querySelector('#hiddenAudioContainer')

let probeAudioContext = undefined
let mixDestination = undefined
let mixMonitorSource = undefined
let mixMonitorAnalyser = undefined
let meterRafId = undefined
let probeActive = false
let mediaRecorderProbe = undefined
let recorderFlushIntervalId = undefined
let healthIntervalId = undefined
let selectedOutputSink = undefined
let lastRawPercent = 0
let lastElementPercent = 0
let lastMixPercent = 0
let recorderChunkCount = 0
let recorderByteCount = 0
let recorderLastChunkSize = 0

const trackedAudioEntries = new Map()
const pendingAudioTracks = new Set()
const rawAnalysers = []
const elementAnalysers = []

function setText(selector, value) {
  const element = document.querySelector(selector)
  if (element) {
    element.textContent = value
  }
}

function printParticipants() {
  const participants = room?.getParticipants?.() || []
  const htmlParticipantsInner = document.querySelector('#participantsInner')
  if (!htmlParticipantsInner) {
    return
  }

  htmlParticipantsInner.innerHTML = ''
  participants.forEach((participant) => {
    const partElement = document.createElement('div')
    partElement.className = 'participant'
    if (participant.isModerator?.()) {
      partElement.classList.add('isModerator')
    }
    partElement.textContent = `${participant.getStatsID?.() || ''}: ${
      participant._displayName?.replaceAll(/ +/g, ' ') || ''
    } ${participant.isModerator?.() ? '👑' : ''}`
    htmlParticipantsInner.appendChild(partElement)
  })
}

function setBar(bar, valueEl, percent) {
  if (bar) {
    bar.style.width = `${percent}%`
  }
  if (valueEl) {
    valueEl.textContent = `${percent}%`
  }
}

function logToUi(prefix, message, details = {}) {
  const detailText =
    details && Object.keys(details).length ? ` ${JSON.stringify(details)}` : ''
  log(`[${chromeTestConfig.slug}] ${prefix}${message}${detailText}`)
}

async function persistSuiteLog(level, message, details = {}) {
  const payload = JSON.stringify({
    ts: new Date().toISOString(),
    page: window.location.pathname,
    suiteTest: chromeTestConfig.slug,
    suiteName: chromeTestConfig.name,
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

function suiteLog(message, details = {}) {
  logToUi('', message, details)
  void persistSuiteLog('info', message, details)
}

function suiteWarn(message, details = {}) {
  logToUi('WARN: ', message, details)
  void persistSuiteLog('warning', message, details)
}

function summarizeTrack(track) {
  if (!track) {
    return {}
  }

  const originalStream = track.getOriginalStream?.()
  const originalAudioTrack = originalStream?.getAudioTracks?.()?.[0]
  return {
    participantId: track.getParticipantId?.() || '',
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

function summarizeCapabilities() {
  return {
    userAgent: navigator.userAgent,
    brands: navigator.userAgentData?.brands || [],
    mediaRecorder: Boolean(window.MediaRecorder),
    audioOutputSelection:
      typeof navigator.mediaDevices?.selectAudioOutput === 'function',
    setSinkId:
      typeof HTMLMediaElement !== 'undefined' &&
      typeof HTMLMediaElement.prototype?.setSinkId === 'function',
    audioContextState: probeAudioContext?.state || 'missing',
  }
}

function summarizeProbeState() {
  return {
    probeActive,
    test: chromeTestConfig.slug,
    audioContextState: probeAudioContext?.state || 'missing',
    trackedEntries: trackedAudioEntries.size,
    pendingTracks: pendingAudioTracks.size,
    recorderState: mediaRecorderProbe?.state || 'inactive',
    recorderChunkCount,
    recorderByteCount,
    recorderLastChunkSize,
    selectedOutputSink: selectedOutputSink?.deviceId || '',
    lastRawPercent,
    lastElementPercent,
    lastMixPercent,
  }
}

function meterPercentFromAnalyser(analyser) {
  const buffer = new Float32Array(analyser.fftSize)
  analyser.getFloatTimeDomainData(buffer)
  let sumSquares = 0
  for (let i = 0; i < buffer.length; i++) {
    sumSquares += buffer[i] * buffer[i]
  }
  return Math.min(100, Math.round(Math.sqrt(sumSquares / buffer.length) * 250))
}

function maxMeterPercent(analysers) {
  if (!analysers.length) {
    return 0
  }
  let maxPercent = 0
  for (const analyser of analysers) {
    maxPercent = Math.max(maxPercent, meterPercentFromAnalyser(analyser))
  }
  return maxPercent
}

function updateMeters() {
  lastRawPercent = maxMeterPercent(rawAnalysers)
  lastElementPercent = maxMeterPercent(elementAnalysers)
  lastMixPercent = mixMonitorAnalyser ? meterPercentFromAnalyser(mixMonitorAnalyser) : 0

  setBar(rawLevelBar, rawLevelValue, lastRawPercent)
  setBar(elementLevelBar, elementLevelValue, lastElementPercent)
  setBar(mixLevelBar, mixLevelValue, lastMixPercent)

  setText('#rawStatus', rawAnalysers.length ? 'active' : 'inactive')
  setText('#elementStatus', elementAnalysers.length ? 'active' : 'inactive')
  setText('#mixStatus', mixMonitorAnalyser ? 'active' : 'inactive')

  meterRafId = window.requestAnimationFrame(updateMeters)
}

function makeAnalyser(node, bucket) {
  const analyser = probeAudioContext.createAnalyser()
  analyser.fftSize = 2048
  node.connect(analyser)
  bucket.push(analyser)
  return analyser
}

function removeAnalyser(bucket, analyser) {
  const index = bucket.indexOf(analyser)
  if (index >= 0) {
    bucket.splice(index, 1)
  }
}

function renderDiagnostics() {
  if (!diagnosticsElement) {
    return
  }

  diagnosticsElement.innerHTML = ''
  for (const entry of trackedAudioEntries.values()) {
    const item = document.createElement('div')
    item.className = 'participant'
    const states = [
      `participant=${entry.participantId}`,
      `raw=${entry.rawConnected ? 'yes' : 'no'}`,
      `audioEl=${entry.audioElement ? 'yes' : 'no'}`,
      `elementSource=${entry.elementSourceNode ? 'yes' : 'no'}`,
      `sink=${entry.audioElement?.sinkId || selectedOutputSink?.deviceId || 'default'}`,
      `play=${entry.lastPlaybackEvent || 'none'}`,
    ]
    item.textContent = states.join(' | ')
    diagnosticsElement.appendChild(item)
  }
}

function ensureAudioContext() {
  if (probeAudioContext) {
    return
  }

  probeAudioContext = new AudioContext()
  probeAudioContext.addEventListener('statechange', () => {
    suiteLog('AudioContext state changed', summarizeProbeState())
  })

  if (
    chromeTestConfig.connectOriginalStreamToMix ||
    chromeTestConfig.connectAudioElementToMix ||
    chromeTestConfig.enableMediaRecorderProbe
  ) {
    mixDestination = probeAudioContext.createMediaStreamDestination()
    mixMonitorSource = probeAudioContext.createMediaStreamSource(mixDestination.stream)
    mixMonitorAnalyser = probeAudioContext.createAnalyser()
    mixMonitorAnalyser.fftSize = 2048
    mixMonitorSource.connect(mixMonitorAnalyser)
  }

  if (!meterRafId) {
    updateMeters()
  }
}

function attachMediaElementListeners(entry, audioElement) {
  const events = [
    'play',
    'playing',
    'pause',
    'waiting',
    'stalled',
    'suspend',
    'ended',
    'loadedmetadata',
    'loadeddata',
    'canplay',
    'canplaythrough',
    'error',
    'volumechange',
  ]

  for (const eventName of events) {
    audioElement.addEventListener(eventName, () => {
      entry.lastPlaybackEvent = eventName
      renderDiagnostics()
      suiteLog('Audio element event', {
        eventName,
        participantId: entry.participantId,
        readyState: audioElement.readyState,
        paused: audioElement.paused,
        muted: audioElement.muted,
        currentTime: audioElement.currentTime,
        sinkId: audioElement.sinkId || '',
      })
    })
  }
}

async function applySinkToAudioElement(audioElement) {
  if (!audioElement || !selectedOutputSink?.deviceId) {
    return
  }
  if (typeof audioElement.setSinkId !== 'function') {
    suiteWarn('setSinkId is not available on this audio element.')
    return
  }

  try {
    await audioElement.setSinkId(selectedOutputSink.deviceId)
    setText('#selectedSinkStatus', selectedOutputSink.label || selectedOutputSink.deviceId)
    suiteLog('Applied output sink to audio element', {
      sinkId: selectedOutputSink.deviceId,
      sinkLabel: selectedOutputSink.label || '',
    })
  } catch (error) {
    suiteWarn('Failed to apply output sink to audio element', {
      sinkId: selectedOutputSink.deviceId,
      error: error?.message || String(error),
    })
  }
}

async function ensureAudioElement(entry) {
  if (entry.audioElement) {
    return entry.audioElement
  }

  const audioElement = document.createElement('audio')
  audioElement.autoplay = true
  audioElement.playsInline = true
  audioElement.controls = false
  audioElement.dataset.participantId = entry.participantId
  audioElement.style.display = 'none'
  hiddenAudioContainer?.appendChild(audioElement)

  attachMediaElementListeners(entry, audioElement)

  try {
    entry.track.attach(audioElement)
    suiteLog('Attached remote track to audio element', {
      participantId: entry.participantId,
      track: summarizeTrack(entry.track),
    })
  } catch (error) {
    suiteWarn('Failed to attach remote track to audio element', {
      participantId: entry.participantId,
      error: error?.message || String(error),
    })
  }

  entry.audioElement = audioElement
  await applySinkToAudioElement(audioElement)

  try {
    await audioElement.play()
    suiteLog('Audio element play() resolved', {
      participantId: entry.participantId,
      readyState: audioElement.readyState,
      paused: audioElement.paused,
    })
  } catch (error) {
    suiteWarn('Audio element play() rejected', {
      participantId: entry.participantId,
      error: error?.message || String(error),
    })
  }

  return audioElement
}

function ensureElementSource(entry) {
  if (!entry.audioElement || entry.elementSourceNode) {
    return
  }

  try {
    entry.elementSourceNode = probeAudioContext.createMediaElementSource(entry.audioElement)
    entry.elementAnalyser = makeAnalyser(entry.elementSourceNode, elementAnalysers)

    if (chromeTestConfig.connectAudioElementToMix && mixDestination) {
      entry.elementGainNode = probeAudioContext.createGain()
      entry.elementGainNode.gain.value = 1
      entry.elementSourceNode.connect(entry.elementGainNode)
      entry.elementGainNode.connect(mixDestination)
    }

    if (chromeTestConfig.mirrorAudioElementToDestination) {
      const speakerGain = probeAudioContext.createGain()
      speakerGain.gain.value = 1
      entry.elementSourceNode.connect(speakerGain)
      speakerGain.connect(probeAudioContext.destination)
      entry.elementSpeakerNode = speakerGain
    }

    suiteLog('Created MediaElementSource for audio element', {
      participantId: entry.participantId,
      connectAudioElementToMix: chromeTestConfig.connectAudioElementToMix,
      mirrorAudioElementToDestination: chromeTestConfig.mirrorAudioElementToDestination,
    })
  } catch (error) {
    suiteWarn('Failed to create MediaElementSource for audio element', {
      participantId: entry.participantId,
      error: error?.message || String(error),
    })
  }
}

function ensureOriginalStreamConnections(entry) {
  if (entry.rawConnected) {
    return
  }

  const originalStream = entry.track.getOriginalStream?.()
  if (!originalStream || originalStream.getAudioTracks().length === 0) {
    suiteWarn('Remote audio track has no original audio stream', {
      participantId: entry.participantId,
      track: summarizeTrack(entry.track),
    })
    return
  }

  try {
    entry.originalStream = originalStream
    entry.rawSourceNode = probeAudioContext.createMediaStreamSource(originalStream)
    if (chromeTestConfig.analyzeOriginalStream) {
      entry.rawAnalyser = makeAnalyser(entry.rawSourceNode, rawAnalysers)
    }
    if (chromeTestConfig.connectOriginalStreamToMix && mixDestination) {
      entry.rawGainNode = probeAudioContext.createGain()
      entry.rawGainNode.gain.value = 1
      entry.rawSourceNode.connect(entry.rawGainNode)
      entry.rawGainNode.connect(mixDestination)
    }
    entry.rawConnected = true
    suiteLog('Connected original remote stream into probe graph', {
      participantId: entry.participantId,
      track: summarizeTrack(entry.track),
      connectOriginalStreamToMix: chromeTestConfig.connectOriginalStreamToMix,
    })
  } catch (error) {
    suiteWarn('Failed to connect original remote stream', {
      participantId: entry.participantId,
      error: error?.message || String(error),
      track: summarizeTrack(entry.track),
    })
  }
}

async function activateEntry(entry) {
  ensureAudioContext()
  ensureOriginalStreamConnections(entry)

  if (chromeTestConfig.attachAudioElements) {
    await ensureAudioElement(entry)
  }
  if (chromeTestConfig.analyzeAudioElement || chromeTestConfig.connectAudioElementToMix) {
    ensureElementSource(entry)
  }

  renderDiagnostics()
}

function startRecorderProbe() {
  if (!chromeTestConfig.enableMediaRecorderProbe) {
    setText('#recorderStatus', 'disabled for this test')
    return
  }
  if (!mixDestination?.stream) {
    suiteWarn('Recorder probe requested but mix destination is unavailable.')
    setText('#recorderStatus', 'unavailable')
    return
  }
  if (!window.MediaRecorder) {
    suiteWarn('MediaRecorder is not supported in this browser.')
    setText('#recorderStatus', 'unsupported')
    return
  }
  if (mediaRecorderProbe?.state === 'recording') {
    return
  }

  const mimeType = MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported?.('audio/webm')
      ? 'audio/webm'
      : ''
  const options = mimeType ? { mimeType } : undefined

  recorderChunkCount = 0
  recorderByteCount = 0
  recorderLastChunkSize = 0
  mediaRecorderProbe = new MediaRecorder(mixDestination.stream, options)

  mediaRecorderProbe.addEventListener('start', () => {
    setText('#recorderStatus', `recording (${mimeType || 'default'})`)
    suiteLog('MediaRecorder probe started', summarizeProbeState())
  })
  mediaRecorderProbe.addEventListener('stop', () => {
    setText('#recorderStatus', 'stopped')
    suiteLog('MediaRecorder probe stopped', summarizeProbeState())
  })
  mediaRecorderProbe.addEventListener('error', (event) => {
    setText('#recorderStatus', 'error')
    suiteWarn('MediaRecorder probe error', {
      error: event.error?.message || String(event.error || 'unknown'),
      probe: summarizeProbeState(),
    })
  })
  mediaRecorderProbe.addEventListener('dataavailable', (event) => {
    recorderChunkCount += 1
    recorderLastChunkSize = event.data?.size || 0
    recorderByteCount += recorderLastChunkSize
    setText(
      '#chunkStatus',
      `${recorderChunkCount} chunks / ${recorderByteCount} bytes / last ${recorderLastChunkSize}`
    )
    suiteLog('MediaRecorder probe chunk', {
      size: recorderLastChunkSize,
      type: event.data?.type || '',
      probe: summarizeProbeState(),
    })
  })

  mediaRecorderProbe.start()
  recorderFlushIntervalId = setInterval(() => {
    if (mediaRecorderProbe?.state === 'recording') {
      try {
        mediaRecorderProbe.requestData()
      } catch (error) {
        suiteWarn('MediaRecorder.requestData failed', {
          error: error?.message || String(error),
          probe: summarizeProbeState(),
        })
      }
    }
  }, chromeTestConfig.probeChunkIntervalMs)
}

async function stopRecorderProbe() {
  if (recorderFlushIntervalId) {
    clearInterval(recorderFlushIntervalId)
    recorderFlushIntervalId = undefined
  }
  if (!mediaRecorderProbe || mediaRecorderProbe.state === 'inactive') {
    return
  }
  await new Promise((resolve) => {
    mediaRecorderProbe.addEventListener('stop', resolve, { once: true })
    try {
      mediaRecorderProbe.requestData()
    } catch (error) {
      suiteWarn('Final MediaRecorder.requestData failed', {
        error: error?.message || String(error),
      })
    }
    mediaRecorderProbe.stop()
  })
}

function startHealthLogging() {
  if (healthIntervalId) {
    clearInterval(healthIntervalId)
  }
  healthIntervalId = setInterval(() => {
    suiteLog('Probe heartbeat', summarizeProbeState())
  }, 15000)
}

function stopHealthLogging() {
  if (!healthIntervalId) {
    return
  }
  clearInterval(healthIntervalId)
  healthIntervalId = undefined
}

function createTrackedEntry(track) {
  return {
    track,
    participantId: track.getParticipantId?.() || 'unknownParticipant',
    rawConnected: false,
    rawSourceNode: undefined,
    rawGainNode: undefined,
    rawAnalyser: undefined,
    originalStream: undefined,
    audioElement: undefined,
    elementSourceNode: undefined,
    elementGainNode: undefined,
    elementAnalyser: undefined,
    elementSpeakerNode: undefined,
    lastPlaybackEvent: '',
  }
}

window.registerRemoteAudioTrackForRecording = (track) => {
  if (!track || track.getType?.() !== 'audio') {
    return
  }

  if (trackedAudioEntries.has(track)) {
    return
  }

  const entry = createTrackedEntry(track)
  trackedAudioEntries.set(track, entry)
  pendingAudioTracks.add(track)
  suiteLog('Registered remote audio track for probe', {
    track: summarizeTrack(track),
    probe: summarizeProbeState(),
  })
  renderDiagnostics()

  if (probeActive) {
    pendingAudioTracks.delete(track)
    void activateEntry(entry)
  }
}

window.unregisterRemoteAudioTrackForRecording = (track) => {
  if (!track) {
    return
  }

  pendingAudioTracks.delete(track)
  const entry = trackedAudioEntries.get(track)
  if (!entry) {
    return
  }

  try {
    entry.rawSourceNode?.disconnect()
  } catch (error) {
    console.log('rawSourceNode disconnect failed', error)
  }
  try {
    entry.rawGainNode?.disconnect()
  } catch (error) {
    console.log('rawGainNode disconnect failed', error)
  }
  try {
    entry.elementSourceNode?.disconnect()
  } catch (error) {
    console.log('elementSourceNode disconnect failed', error)
  }
  try {
    entry.elementGainNode?.disconnect()
  } catch (error) {
    console.log('elementGainNode disconnect failed', error)
  }
  try {
    entry.elementSpeakerNode?.disconnect()
  } catch (error) {
    console.log('elementSpeakerNode disconnect failed', error)
  }

  if (entry.rawAnalyser) {
    removeAnalyser(rawAnalysers, entry.rawAnalyser)
  }
  if (entry.elementAnalyser) {
    removeAnalyser(elementAnalysers, entry.elementAnalyser)
  }

  try {
    if (entry.audioElement) {
      entry.track.detach?.(entry.audioElement)
      entry.audioElement.remove()
    }
  } catch (error) {
    console.log('audio element detach failed', error)
  }

  trackedAudioEntries.delete(track)
  suiteLog('Unregistered remote audio track from probe', {
    participantId: entry.participantId,
    probe: summarizeProbeState(),
  })
  renderDiagnostics()
}

async function startAutomatedRecordingFlow() {
  ensureAudioContext()
  if (probeActive) {
    suiteWarn('Probe start ignored because the probe is already active.', summarizeProbeState())
    return false
  }

  probeActive = true
  if (probeAudioContext.state === 'suspended') {
    await probeAudioContext.resume()
  }

  suiteLog('Starting probe', {
    config: chromeTestConfig,
    capabilities: summarizeCapabilities(),
  })

  for (const track of [...pendingAudioTracks]) {
    pendingAudioTracks.delete(track)
    const entry = trackedAudioEntries.get(track)
    if (entry) {
      await activateEntry(entry)
    }
  }

  startRecorderProbe()
  startHealthLogging()
  setText('#probeStatus', 'active')
  return true
}

async function stopAutomatedRecordingFlow() {
  probeActive = false
  stopHealthLogging()
  await stopRecorderProbe()
  setText('#probeStatus', 'inactive')
  suiteLog('Stopped probe', summarizeProbeState())
}

async function chooseOutputDevice() {
  if (typeof navigator.mediaDevices?.selectAudioOutput !== 'function') {
    suiteWarn('MediaDevices.selectAudioOutput is not available.', summarizeCapabilities())
    return
  }

  try {
    selectedOutputSink = await navigator.mediaDevices.selectAudioOutput()
    setText(
      '#selectedSinkStatus',
      selectedOutputSink.label || selectedOutputSink.deviceId || 'selected'
    )
    suiteLog('Selected output sink', {
      sinkId: selectedOutputSink.deviceId,
      sinkLabel: selectedOutputSink.label || '',
    })

    for (const entry of trackedAudioEntries.values()) {
      await applySinkToAudioElement(entry.audioElement)
    }
    renderDiagnostics()
  } catch (error) {
    suiteWarn('Output sink selection failed or was cancelled', {
      error: error?.message || String(error),
    })
  }
}

function initUi() {
  setText('#testSlug', chromeTestConfig.slug)
  setText('#testName', chromeTestConfig.name)
  setText('#testDescription', chromeTestConfig.description)
  setText('#testMode', JSON.stringify(chromeTestConfig))
  setText('#connectionStatus', 'not connected')
  setText('#probeStatus', 'inactive')
  setText('#recorderStatus', chromeTestConfig.enableMediaRecorderProbe ? 'ready' : 'disabled')
  setText('#chunkStatus', '0 chunks / 0 bytes / last 0')
  setText(
    '#sinkSupportStatus',
    chromeTestConfig.exposeOutputRouting
      ? typeof navigator.mediaDevices?.selectAudioOutput === 'function' &&
        typeof HTMLMediaElement !== 'undefined' &&
        typeof HTMLMediaElement.prototype?.setSinkId === 'function'
        ? 'available'
        : 'partial or unavailable'
      : 'not used in this test'
  )
  setText('#selectedSinkStatus', 'default')

  if (!chromeTestConfig.analyzeAudioElement && !chromeTestConfig.connectAudioElementToMix) {
    document.querySelector('#elementMeterOuter')?.setAttribute('hidden', 'hidden')
  }
  if (!chromeTestConfig.connectOriginalStreamToMix && !chromeTestConfig.connectAudioElementToMix) {
    document.querySelector('#mixMeterOuter')?.setAttribute('hidden', 'hidden')
  }
  if (!chromeTestConfig.exposeOutputRouting) {
    document.querySelector('#select_output_button')?.setAttribute('hidden', 'hidden')
  }
}

window.startAutomatedRecordingFlow = startAutomatedRecordingFlow
window.stopAutomatedRecordingFlow = stopAutomatedRecordingFlow
window.chooseChromeTestOutputDevice = chooseOutputDevice
window.getChromeProbeState = summarizeProbeState
window.persistRecordingLog = persistSuiteLog
window.printParticipants = printParticipants

window.addEventListener('error', (event) => {
  void persistSuiteLog('error', 'window.error', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error?.stack || String(event.error || ''),
    probe: summarizeProbeState(),
  })
})

window.addEventListener('unhandledrejection', (event) => {
  void persistSuiteLog('error', 'window.unhandledrejection', {
    reason: event.reason?.stack || String(event.reason || ''),
    probe: summarizeProbeState(),
  })
})

document.querySelector('#select_output_button')?.addEventListener('click', chooseOutputDevice)

initUi()
suiteLog('Chrome recording probe harness loaded', {
  config: chromeTestConfig,
  capabilities: summarizeCapabilities(),
})
