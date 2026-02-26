// recording audio element should already be defined

JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.ERROR)

// Recording bot should publish audio by default on join.
options.startAudioMuted = 0
options.startWithAudioMuted = false
options.startSilent = false
options.startVideoMuted = 1
options.startWithVideoMuted = true

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
    log(`Published local ${track.getType()} track.`)
  } catch (error) {
    const details = String(error?.message || error?.name || error || 'unknown')
    log(`Failed to publish ${track.getType()} track: ${details}`)
    log(
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

  const participantId = track.getParticipantId?.()
  if (!remoteTracks[participantId]) {
    remoteTracks[participantId] = []
  }
  remoteTracks[participantId].push(track)

  if (track.getType() === 'audio') {
    window.registerRemoteAudioTrackForRecording?.(track)
    log(`Remote audio track added from ${participantId || 'unknown participant'}.`)
  }
}

function initRecordingTrack() {
  if (!initDone) {
    setTimeout(initRecordingTrack, 2000)
    return
  }

  log('Initializing local audio Track(s).')
  // we also dont need local video stream, we just want the audio stream transmitted from the "audio recording" html element
  JitsiMeetJS.createLocalTracks({ devices: ['audio'] })
    .then((tracks) => {
      onLocalTracks({ type: 'audio', tracks })
    })
    .catch((error) => {
      throw error
    })
}

function initVideoboardTrack() {
  console.log('Initializing local video Track(s).')
  JitsiMeetJS.createLocalTracks({ devices: ['video'] })
    .then((tracks) => {
      onLocalTracks({ type: 'video', tracks })
    })
    .catch((error) => {
      throw error
    })
}

recording.addEventListener('play', () => {
  room.setDisplayName(
    `▶ ${getRecordingCurrentTrackName()} - ${options.recordingbotDisplayName}`
  )
})

recording.addEventListener('ended', () => {
  room.setDisplayName(
    `⏹ ${getRecordingCurrentTrackName()} - ${options.recordingbotDisplayName}`
  )
})

recording.addEventListener('pause', () => {
  room.setDisplayName(
    `⏸ ${getRecordingCurrentTrackName()} - ${options.recordingbotDisplayName}`
  )
})

// Video Related setup Stuff

function playVideo() {
  initVideoboardTrack()
  videoboard.play()
}

/* -------------------------
 * Command Handler Functions
 * -------------------------
 */

const reloadBot = (userId) => {
  // FIXME Needs fix for node ?
  room.sendMessage('Reloading Bot, see ya in a second. ')
  location.reload()
}

const unknownCommand = (userId) => {
  room.sendMessage('Command not found', userId)
}

const quit = (userId) => {
  room.sendMessage(`Recording bot leaving.`)
  room.room.doLeave()
  window.close()
}

const stopRecording = async (userId) => {
  const sender = room.getParticipantById(userId)
  if (!sender?.isModerator?.()) {
    room.sendMessage(
      'Only moderators can stop the recording with /stop.',
      userId
    )
    return
  }

  try {
    await window.stopAutomatedRecordingFlow?.()
    room.sendMessage('Recording stopped.', userId)
    disconnectBotFromConference()
  } catch (error) {
    room.sendMessage('Failed to stop recording.', userId)
    console.error('Failed to stop automated recording flow:', error)
  }
}

const disconnectBotFromConference = () => {
  try {
    room?.room?.doLeave()
  } catch (error) {
    console.error('Error while leaving conference room:', error)
  }
  try {
    con?.disconnect()
  } catch (error) {
    console.error('Error while disconnecting conference connection:', error)
  }
}

const stopRecordingFromUi = async () => {
  try {
    await window.stopAutomatedRecordingFlow?.()
    room?.sendMessage('Recording stopped from bot UI.')
    disconnectBotFromConference()
  } catch (error) {
    log(`Failed to stop recording from UI: ${error?.message || error}`)
    console.error('Failed to stop automated recording flow from UI:', error)
  }
}

const currentTrack = (userId) => {
  const track = recording.src
  room.sendMessage(`Currently loaded: ${track}`, userId)
}

const loadTrack = (userId, url) => {
  const mp3Reg = new RegExp('.*//.*.mp3')

  if (!mp3Reg.test(url)) {
    room.sendMessage('Invalid URL.', userId)
    return
  }

  try {
    recording.src = url
    room.sendMessage(`Source set.`, userId)
  } catch (error) {
    log(`Error on loading new source "${url}", check url.`)
  }
}

const play = () => {
  recording.play()
}

const pause = () => {
  recording.pause()
}

const toggleLoop = (userId) => {
  room.sendMessage(`Track Repeating set to ${!recording.loop}`, userId)
  recording.loop = !recording.loop
}

const increaseVol = (userId) => {
  recording.volume += 0.1
  room.sendMessage(`Volume set to ${recording.volume * 100}%`, userId)
}

const reduceVol = (userId) => {
  recording.volume -= 0.1
  room.sendMessage(`Volume set to ${recording.volume * 100}%`, userId)
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

  recording.volume = vol / 100
  room.sendMessage(`Volume set to ${recording.volume * 100}%`, userId)
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
    '/playVideo',
    '/reload',
    '/toggleLoop',
    '/vol+',
    '/vol-',
    '/setVol x # x: vol between 0 .. 100',
    '/stop # moderator only',
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
  '/playVideo': playVideo,
  '/reload': reloadBot,
  '/toggleLoop': toggleLoop,
  '/togglePlayOnJoin': togglePlayOnJoin,
  '/vol+': increaseVol,
  '/vol-': reduceVol,
  '/setVol': setVol,
  '/stop': stopRecording,
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
        log(`Switching to BOSH: ${fallbackBosh}`)
      } else {
        log('BOSH fallback requested but no endpoint is available.')
      }
    }

    connectionEstablished = false
    log(
      reason ? `Connecting to Jitsi (${reason})...` : 'Connecting to Jitsi...'
    )

    con = new JitsiMeetJS.JitsiConnection(null, null, options)

    const onConnectionSuccess = (ev) => {
      console.log('Connection Success')
      log('Connection established.')
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
      log('Connection failed.')
      scheduleReconnect('failed')
    }

    /**
     * This function is called when we disconnect.
     */
    function disconnect() {
      console.log('disconnect!')
      log('Connection disconnected.')
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
      log('Waiting for connection to establish...')
      waitingForConnectionLogged = true
    }
    setTimeout(roomInit, 1000)
    return
  }

  const onConferenceJoined = (ev) => {
    console.log('Conference Joined')
    log('Conference joined.')

    bot_started = true
    roomJoined = true

    setTimeout(initRecordingTrack, 2000)
    setTimeout(async () => {
      const started = await window.startAutomatedRecordingFlow?.()
      if (started) {
        room.sendMessage('Recording started from bot UI.')
      }
    }, 500)

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
  })

  room.on(JitsiMeetJS.events.conference.MESSAGE_RECEIVED, (userId, message) => {
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
      if (recording.src == `${window.location.host}/audio/-Tea.mp3`) {
        play()
      }
    }
    printParticipants()
    log('USER JOINED EVENT ' + userId + ': ' + userObj._displayName)
  })

  room.on(JitsiMeetJS.events.conference.USER_LEFT, (userId, userObj) => {
    log('USER LEFT EVENT ' + userId + ': ' + userObj._displayName)
    printParticipants()
    const tracks = remoteTracks[userId]
    if (!tracks?.length) {
      return
    }

    for (let i = 0; i < tracks.length; i++) {
      if (tracks[i].getType?.() === 'audio') {
        window.unregisterRemoteAudioTrackForRecording?.(tracks[i])
      }
    }
    delete remoteTracks[userId]
  })

  room.on(JitsiMeetJS.events.conference.TRACK_ADDED, onRemoteTrack)
  room.on(JitsiMeetJS.events.conference.TRACK_REMOVED, (track) => {
    if (!track || track.isLocal?.()) {
      return
    }
    if (track.getType?.() === 'audio') {
      window.unregisterRemoteAudioTrackForRecording?.(track)
    }
    const participantId = track.getParticipantId?.()
    if (remoteTracks[participantId]) {
      remoteTracks[participantId] = remoteTracks[participantId].filter(
        (remoteTrack) => remoteTrack !== track
      )
      if (remoteTracks[participantId].length === 0) {
        delete remoteTracks[participantId]
      }
    }
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
    log(
      `\tI got kicked by ${kickedByUser._displayName}. \n\tReason: ${message}`,
      LOGCLASSES.MYSELF_KICKED
    )
  })

  room.setDisplayName(options.recordingbotDisplayName)

  room.join()
}

function main() {
  if (bot_started) {
    return
  }

  document.title = 'Recording - ' + roomName

  conferenceInit()

  log('Target: ' + roomName)
  roomInit()
}

document.querySelector('#start_bot_button')?.addEventListener('click', openBot)
document
  .querySelector('#stop_bot_button')
  ?.addEventListener('click', stopRecordingFromUi)
document
  .querySelector('#clearLog')
  ?.addEventListener(
    'click',
    () => (document.querySelector('#log').textContent = '')
  )

main()
