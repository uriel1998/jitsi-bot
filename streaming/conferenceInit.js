// streaming should already be defined

JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.ERROR)

// Soundboard should publish audio by default on join.
options.startAudioMuted = 0
options.startWithAudioMuted = false

JitsiMeetJS.init(options)
const publishedLocalTracks = new WeakSet()

const connectionRetryConfig = {
  intervalMs: 10000,
  maxAttempts: 6,
}
const boshFallbackAttempt = 3
let connectionAttemptCount = 0
let retryTimeoutId = undefined
let waitingForConnectionLogged = false
let usingBoshFallback = false

function getStreamingConferenceState() {
  return {
    connectionAttemptCount,
    waitingForConnectionLogged,
    usingBoshFallback,
    roomJoined: window.roomJoined ?? null,
    connectionEstablished: window.connectionEstablished ?? null,
    roomName,
    targetJitsi: options.targetJitsi?.origin || '',
    serviceUrl: options.serviceUrl || '',
  }
}

function streamingConferenceLog(message, details = {}) {
  log(message)
  void window.persistStreamingLog?.('info', message, {
    conference: getStreamingConferenceState(),
    ...details,
  })
}

function streamingConferenceWarn(message, details = {}) {
  log(message)
  void window.persistStreamingLog?.('warning', message, {
    conference: getStreamingConferenceState(),
    ...details,
  })
}

const publishLocalTrack = async (track) => {
  if (!room || !roomJoined || !track || publishedLocalTracks.has(track)) {
    return
  }
  try {
    if (track.getType() === 'audio' && track.isMuted()) {
      await track.unmute()
    }
    await room.addTrack(track)
    publishedLocalTracks.add(track)
    streamingConferenceLog(`Published local ${track.getType()} track.`, {
      trackType: track.getType?.() || 'unknown',
      muted: track.isMuted?.() ?? null,
    })
  } catch (error) {
    const details = String(error?.message || error?.name || error || 'unknown')
    streamingConferenceWarn(`Failed to publish ${track.getType()} track: ${details}`, {
      error: details,
      trackType: track.getType?.() || 'unknown',
    })
    streamingConferenceWarn(
      'If room AV moderation is enabled, a moderator must allow participant media to publish audio.'
    )
    console.error('Failed to publish local track:', error)
  }
}

/**
 * Handles local tracks.
 * @param tracks Array with JitsiTrack objects
 */
function onLocalTracks({ type, tracks }) {
  localTracks[type] = tracks
  console.log(tracks)
  for (let i = 0; i < localTracks[type].length; i++) {
    localTracks[type][i].addEventListener(
      JitsiMeetJS.events.track.TRACK_MUTE_CHANGED,
      () => {
        console.log(`local ${localTracks[type][i].getType()} track muted`)
      }
    )
    localTracks[type][i].addEventListener(
      JitsiMeetJS.events.track.LOCAL_TRACK_STOPPED,
      () => {
        console.log(
          `local ${localTracks[type][i].getType()} track stopped - disposing...`
        )
        publishedLocalTracks.delete(localTracks[type][i])
        localTracks[type][i].dispose()
      }
    )
    localTracks[type][i].addEventListener(
      JitsiMeetJS.events.track.TRACK_AUDIO_OUTPUT_CHANGED,
      (deviceId) =>
        console.log(`track audio output device was changed to ${deviceId}`)
    )
    if (roomJoined) {
      publishLocalTrack(localTracks[type][i])
    }
  }
}

/**
 * Handles remote tracks
 * @param track JitsiTrack object
 */
function onRemoteTrack(track) {
  if (!track || track.isLocal?.()) {
    return
  }

  // Streaming bot is send-only; dispose all incoming A/V tracks immediately.
  const trackType = track.getType?.()
  if (trackType !== 'audio' && trackType !== 'video') {
    return
  }
  try {
    track.dispose?.()
  } catch (error) {
    streamingConferenceWarn('Failed to dispose remote track', {
      error: error?.message || String(error),
      trackType,
      participantId: track.getParticipantId?.() || '',
    })
    console.error('Failed to dispose remote track:', error)
  }
}

function initStreamingTrack() {
  if (!initDone) {
    setTimeout(initStreamingTrack, 2000)
    return
  }

  const streamingAudioConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  }
  streamingConferenceLog('Initializing local audio track(s).', {
    constraints: streamingAudioConstraints,
  })
  if (typeof window.logStreamingDiagnostics === 'function') {
    window.logStreamingDiagnostics('Before JitsiMeetJS.createLocalTracks')
  }
  // we also dont need local video stream, we just want the audio stream transmitted from the "audio streaming" html element
  JitsiMeetJS.createLocalTracks({
    devices: ['audio'],
    constraints: {
      audio: streamingAudioConstraints,
    },
  })
    .then((tracks) => {
      streamingConferenceLog(`createLocalTracks resolved with ${tracks.length} track(s).`, {
        trackCount: tracks.length,
      })
      tracks.forEach((track, index) => {
        streamingConferenceLog(`Local track[${index}] ready`, {
          index,
          type: track.getType?.() || 'unknown',
          muted: track.isMuted?.() ?? 'unknown',
        })
      })
      if (typeof window.logStreamingDiagnostics === 'function') {
        window.logStreamingDiagnostics('After JitsiMeetJS.createLocalTracks')
      }
      onLocalTracks({ type: 'audio', tracks })
    })
    .catch((error) => {
      if (typeof window.logStreamingDiagnostics === 'function') {
        window.logStreamingDiagnostics('createLocalTracks rejected')
      }
      streamingConferenceWarn('createLocalTracks failed', {
        error: error?.message || String(error),
      })
      throw error
    })
}

function startStreamPlaybackWithRetry() {
  const maxAttempts = 5
  const attemptDelayMs = 1000
  let attempt = 0

  const tryPlay = () => {
    attempt += 1
    if (typeof window.logStreamingDiagnostics === 'function') {
      window.logStreamingDiagnostics(`Retry play attempt ${attempt}/${maxAttempts}`)
    }
    const playPromise = streaming.play()
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise.then(() => {
        if (typeof window.logStreamingDiagnostics === 'function') {
          window.logStreamingDiagnostics(
            `Retry play attempt ${attempt}/${maxAttempts} resolved`
          )
        }
      })
    }
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((error) => {
        if (attempt < maxAttempts) {
          streamingConferenceWarn(`Retry play attempt ${attempt}/${maxAttempts} failed`, {
            attempt,
            maxAttempts,
            error: error?.message || String(error),
          })
          setTimeout(tryPlay, attemptDelayMs)
          return
        }
        streamingConferenceWarn(`Auto-play failed after ${maxAttempts} attempts`, {
          attempt,
          maxAttempts,
          error: error?.message || String(error),
        })
      })
    }
  }

  tryPlay()
}

streaming.addEventListener('play', () => {
  room.setDisplayName(
    `▶ ${getStreamingCurrentTrackName()} - ${options.streamingDisplayName}`
  )
})

streaming.addEventListener('ended', () => {
  room.setDisplayName(
    `⏹ ${getStreamingCurrentTrackName()} - ${options.streamingDisplayName}`
  )
})

streaming.addEventListener('pause', () => {
  room.setDisplayName(
    `⏸ ${getStreamingCurrentTrackName()} - ${options.streamingDisplayName}`
  )
})

/* -------------------------
 * Command Handler Functions
 * -------------------------
 */

const reloadBot = (userId) => {
  // FIXME Needs fix for node ?
  streamingConferenceWarn('Reload bot command invoked', { userId: userId || '' })
  room.sendMessage('Reloading Bot, see ya in a second. ')
  location.reload()
}

const unknownCommand = (userId) => {
  room.sendMessage('Command not found', userId)
}

const quit = (userId) => {
  streamingConferenceWarn('Quit command invoked', { userId: userId || '' })
  room.sendMessage(`Streaming bot leaving.`)
  room.room.doLeave()
  window.close()
}

const currentTrack = (userId) => {
  const track = streaming.src
  room.sendMessage(`Currently loaded: ${track}`, userId)
}

const loadTrack = (userId, url) => {
  const mp3Reg = new RegExp('.*//.*.mp3')

  if (!mp3Reg.test(url)) {
    room.sendMessage('Invalid URL.', userId)
    return
  }

  try {
    streaming.src = url
    window.playStreamingIfConnected?.()
    room.sendMessage(`Source set.`, userId)
  } catch (error) {
    log(`Error on loading new source "${url}", check url.`)
  }
}

const play = () => {
  streaming.play()
}

const pause = () => {
  streaming.pause()
}

const toggleLoop = (userId) => {
  room.sendMessage(`Track Repeating set to ${!streaming.loop}`, userId)
  streaming.loop = !streaming.loop
}

const increaseVol = (userId) => {
  streaming.volume += 0.1
  room.sendMessage(`Volume set to ${streaming.volume * 100}%`, userId)
}

const reduceVol = (userId) => {
  streaming.volume -= 0.1
  room.sendMessage(`Volume set to ${streaming.volume * 100}%`, userId)
}

const setVol = (userId, argument) => {
  const vol = parseFloat(argument)
  if (isNaN(vol)) {
    room.sendMessage(`Argument is NaN`, userId)
  }
  if (vol < 0 || vol > 100) {
    room.sendMessage(
      `Argument invalid. Please write Number between 0 and 100.`,
      userId
    )
  }

  streaming.volume = vol / 100
  room.sendMessage(`Volume set to ${streaming.volume * 100}%`, userId)
}

const togglePlayOnJoin = (userId) => {
  playJoinSound = !playJoinSound
  if (playJoinSound) {
    room.sendMessage(
      `OnJoinSound enabled (-Tea.mp3 needs to be set from host.)`,
      userId
    )
  } else {
    room.sendMessage(`OnJoinSound disabled.`, userId)
  }
}

const help = (userId) => {
  const commands = [
    'Available Commands:',
    '/currentTrack',
    '/help',
    '/loadTrack URL',
    '/pause',
    '/play',
    '/reload',
    '/toggleLoop',
    '/vol+',
    '/vol-',
    '/setVol x # x: vol between 0 .. 100',
    '/quit',
    '/togglePlayOnJoin',
  ]

  room.sendMessage(commands.join('\n'), userId)
}

/* -----------------------------
 * Command Handler Functions End
 * -----------------------------
 */

const commandHandler = {
  '/currentTrack': currentTrack,
  '/help': help,
  '/loadTrack': loadTrack,
  '/pause': pause,
  '/play': play,
  '/reload': reloadBot,
  '/toggleLoop': toggleLoop,
  '/togglePlayOnJoin': togglePlayOnJoin,
  '/vol+': increaseVol,
  '/vol-': reduceVol,
  '/setVol': setVol,
  '/quit': quit,
}

function conferenceInit() {
  function scheduleReconnect(reason) {
    if (connectionAttemptCount >= connectionRetryConfig.maxAttempts) {
      log(
        `Connection retry limit reached (${connectionRetryConfig.maxAttempts}). Giving up.`
      )
      return
    }

    connectionAttemptCount += 1
    const attemptLabel = `${connectionAttemptCount}/${connectionRetryConfig.maxAttempts}`
      log(
        `Connection failed (${reason}). Retrying in ${
          connectionRetryConfig.intervalMs / 1000
        }s (${attemptLabel})...`
      )
      window.streamingWarningLog?.('Scheduling streaming reconnect', {
        reason,
        attemptLabel,
        conference: getStreamingConferenceState(),
      })

    if (retryTimeoutId) {
      clearTimeout(retryTimeoutId)
    }
    retryTimeoutId = setTimeout(() => {
      startConnection(`retry ${attemptLabel}`)
    }, connectionRetryConfig.intervalMs)
  }

  function startConnection(reason) {
    if (con) {
      try {
        con.disconnect()
      } catch (error) {
        console.log('Error while disconnecting previous connection', error)
      }
    }

    if (!usingBoshFallback && connectionAttemptCount >= boshFallbackAttempt) {
      const fallbackBosh =
        options.bosh ||
        (options.targetJitsi?.origin
          ? `${options.targetJitsi.origin}/http-bind`
          : undefined)
      if (fallbackBosh) {
        options.serviceUrl = fallbackBosh
        usingBoshFallback = true
        streamingConferenceWarn(`Switching to BOSH: ${fallbackBosh}`, {
          fallbackBosh,
        })
      } else {
        streamingConferenceWarn('BOSH fallback requested but no endpoint is available.')
      }
    }

    connectionEstablished = false
    window.setTargetJitsiConnectedUi?.(false)
    streamingConferenceLog(
      reason ? `Connecting to Jitsi (${reason})...` : 'Connecting to Jitsi...'
    )

    con = new JitsiMeetJS.JitsiConnection(null, null, options)

    const onConnectionSuccess = (ev) => {
      console.log('Connection Success')
      streamingConferenceLog('Connection established.')
      connectionEstablished = true
      waitingForConnectionLogged = false
      connectionAttemptCount = 0
      if (retryTimeoutId) {
        clearTimeout(retryTimeoutId)
        retryTimeoutId = undefined
      }
    }
    const onConnectionFailed = (ev) => {
      console.log('Connection Failed')
      streamingConferenceWarn('Connection failed.', {
        error: ev?.message || ev?.type || 'unknown',
      })
      window.setTargetJitsiConnectedUi?.(false)
      scheduleReconnect('failed')
    }

    /**
     * This function is called when we disconnect.
     */
    function disconnect() {
      console.log('disconnect!')
      streamingConferenceWarn('Connection disconnected.', {
        conference: getStreamingConferenceState(),
      })
      window.setTargetJitsiConnectedUi?.(false)
      con.removeEventListener(
        JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
        onConnectionSuccess
      )
      con.removeEventListener(
        JitsiMeetJS.events.connection.CONNECTION_FAILED,
        onConnectionFailed
      )
      con.removeEventListener(
        JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED,
        disconnect
      )
      scheduleReconnect('disconnected')
    }

    con.addEventListener(
      JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
      onConnectionSuccess
    )
    con.addEventListener(
      JitsiMeetJS.events.connection.CONNECTION_FAILED,
      onConnectionFailed
    )
    con.addEventListener(
      JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED,
      disconnect
    )

    con.connect()
  }

  startConnection()
}

const getNameById = (userId) => {
  return room.getParticipantById(userId)?._displayName
}

const getStatsIDById = (userId) => {
  return room.getParticipantById(userId)?._statsID
}

function roomInit() {
  if (!connectionEstablished) {
    if (!waitingForConnectionLogged) {
      streamingConferenceLog('Waiting for connection to establish...')
      waitingForConnectionLogged = true
    }
    setTimeout(roomInit, 1000)
    return
  }

  const onConferenceJoined = (ev) => {
    console.log('Conference Joined')
    streamingConferenceLog('Conference joined.')

    bot_started = true
    roomJoined = true
    window.setTargetJitsiConnectedUi?.(true)

    const avatarUrl = new URL(
      '/images/streaming_icon.png',
      window.location.href
    ).toString()
    room.setLocalParticipantProperty('avatarUrl', avatarUrl)

    setTimeout(initStreamingTrack, 2000)
    setTimeout(startStreamPlaybackWithRetry, 800)

    Object.values(localTracks).forEach((tracks) => {
      tracks.forEach((track) => publishLocalTrack(track))
    })
  }

  room = con.initJitsiConference(roomName, options)

  room.addEventListener(
    JitsiMeetJS.events.conference.CONFERENCE_JOINED,
    onConferenceJoined
  )

  room.on(JitsiMeetJS.events.conference.CONFERENCE_LEFT, () => {
    roomJoined = false
    window.setTargetJitsiConnectedUi?.(false)
    streamingConferenceWarn('Conference left.')
  })

  room.on(JitsiMeetJS.events.conference.MESSAGE_RECEIVED, (userId, message) => {
    if (!roomJoined || !bot_started) {
      return
    }

    log(
      'Message received: \n' +
        (getNameById(userId) || getStatsIDById(userId) || userId) +
        ': ' +
        message,
      LOGCLASSES.PUBLIC_MESSAGE
    )
  })
  room.on(
    JitsiMeetJS.events.conference.PRIVATE_MESSAGE_RECEIVED,
    (userId, message) => {
      if (!roomJoined || !bot_started) {
        return
      }

      log(
        'Private Message recieved: \n' +
          (getNameById(userId) || getStatsIDById(userId) || userId) +
          ': ' +
          message,
        LOGCLASSES.PRIVATE_MESSAGE
      )

      const firstSpaceIndex = message.indexOf(' ')
      function getCommand() {
        if (firstSpaceIndex !== -1) {
          return message.substring(0, firstSpaceIndex) // before first space is command
        } else {
          return message
        }
      }
      function getArgument() {
        if (firstSpaceIndex !== -1) {
          return message.substring(firstSpaceIndex + 1) // after first space is arguments
        } else return undefined
      }
      const command = getCommand()
      const argument = getArgument()

      console.log(command, argument)

      try {
        commandHandler[command](userId, argument) // Executing corresponding function in commandHandler List.
      } catch (error) {
        if (message.startsWith('/')) {
          if (command in commandHandler) {
            room.sendMessage('Error while Executing Command.', userId)
          } else {
            room.sendMessage('Command not found. Try /help', userId)
          }
        } else {
          room.sendMessage(
            'I wont talk back, try commands with / like /help.',
            userId
          )
        }
        console.error(error)
      }
    }
  )
  // onJoin
  room.on(JitsiMeetJS.events.conference.USER_JOINED, (userId, userObj) => {
    if (playJoinSound) {
      if (streaming.src == `${window.location.host}/audio/-Tea.mp3`) {
        play()
      }
    }
    printParticipants()
    streamingConferenceLog('USER JOINED EVENT ' + userId + ': ' + userObj._displayName, {
      participantId: userId,
      displayName: userObj?._displayName || '',
    })
  })

  room.on(JitsiMeetJS.events.conference.USER_LEFT, (userId, userObj) => {
    streamingConferenceWarn('USER LEFT EVENT ' + userId + ': ' + userObj._displayName, {
      participantId: userId,
      displayName: userObj?._displayName || '',
    })
    printParticipants()
    if (!remoteTracks[userId]) {
      return
    }
    const tracks = remoteTracks[userId]

    for (let i = 0; i < tracks.length; i++) {
      tracks[i].detach($(`#${userId}${tracks[i].getType()}`))
    }
  })

  room.on(JitsiMeetJS.events.conference.TRACK_ADDED, onRemoteTrack)
  room.on(JitsiMeetJS.events.conference.TRACK_REMOVED, (track) => {
    streamingConferenceWarn('Remote track removed', {
      participantId: track?.getParticipantId?.() || '',
      trackType: track?.getType?.() || '',
      isLocal: track?.isLocal?.() ?? null,
    })
    console.log(`track removed!!!${track}`)
  })

  room.on(JitsiMeetJS.events.conference.USER_ROLE_CHANGED, (userId, role) => {
    console.log(userId, ' Role Change: ', role)
    printParticipants()
    if (userId === room.myUserId()) {
      Object.values(localTracks).forEach((tracks) => {
        tracks.forEach((track) => publishLocalTrack(track))
      })
    }
  })

  room.on(
    JitsiMeetJS.events.conference.PARTICIPANT_PROPERTY_CHANGED,
    (userObj, propertyKey, oldValue, newValue) => {
      console.log(
        'PARTICIPANT PROPERTY CHANGE EVENT: \n',
        userObj._displayName,
        '\n',
        propertyKey,
        ': ',
        oldValue,
        ' --> ',
        newValue
      )
    }
  )

  room.on(
    JitsiMeetJS.events.conference.USER_STATUS_CHANGED,
    (userId, newStatus) => {
      console.log('USER STATUS CHANGE EVENT \n', userId, ': ', newStatus)
    }
  )

  room.on(JitsiMeetJS.events.conference.TRACK_MUTE_CHANGED, (track) => {
    console.log(`${track}: ${track.getType()} - set to ${track.isMuted()}`)
  })
  room.on(
    JitsiMeetJS.events.conference.DISPLAY_NAME_CHANGED,
    (userID, displayName) => console.log(`${userID} - ${displayName}`)
  )
  room.on(JitsiMeetJS.events.conference.PHONE_NUMBER_CHANGED, () =>
    console.log(`${room.getPhoneNumber()} - ${room.getPhonePin()}`)
  )

  room.on(
    JitsiMeetJS.events.conference._MEDIA_SESSION_ACTIVE_CHANGED,
    (jingle_session) => {
      if (jingle_session.peerconnection.localTracks.size === 0) {
        // add local track to peerconnection as its not being added yet.
        console.log('Adding local tracks to peerconnection. #jvbFix')
        Object.values(localTracks).forEach((tracks) => {
          tracks.forEach((track) => publishLocalTrack(track))
        })
      }
    }
  )

  room.on(JitsiMeetJS.events.conference.KICKED, (kickedByUser, message) => {
    streamingConferenceWarn(
      `\tI got kicked by ${kickedByUser._displayName}. \n\tReason: ${message}`,
      {
        kickedBy: kickedByUser?._displayName || '',
        message,
      }
    )
  })

  room.setDisplayName(options.streamingDisplayName)

  room.join()
}

function main() {
  if (bot_started) {
    return
  }

  document.title = 'Streaming - ' + roomName

  conferenceInit()

  streamingConferenceLog('Target: ' + roomName, { roomName })
  roomInit()
}

document.querySelector('#start_bot_button')?.addEventListener('click', openBot)
document
  .querySelector('#clearLog')
  ?.addEventListener(
    'click',
    () => (document.querySelector('#log').textContent = '')
  )

main()
