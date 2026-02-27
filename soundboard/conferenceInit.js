// soundboard should already be defined

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
  return // we dont need remote audio and video tracks, so just do nothing here.
}

function initSoundboardTrack() {
  if (!initDone) {
    setTimeout(initSoundboardTrack, 2000)
    return
  }

  log('Initializing microphone audio track for bot.')
  log(
    'Mic constraints applied: echoCancellation=false, noiseSuppression=false, autoGainControl=false'
  )
  JitsiMeetJS.createLocalTracks({
    devices: ['audio'],
    constraints: {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    },
  })
    .then((tracks) => {
      onLocalTracks({ type: 'audio', tracks })
    })
    .catch((error) => {
      throw error
    })
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
  room.sendMessage(`Soundbot leaving.`)
  room.room.doLeave()
  window.close()
}

const help = (userId) => {
  const commands = ['Available Commands:', '/help', '/reload', '/quit']

  room.sendMessage(commands.join('\n'), userId)
}

/* -----------------------------
 * Command Handler Functions End
 * -----------------------------
 */

const commandHandler = {
  '/help': help,
  '/reload': reloadBot,
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

    setTimeout(initSoundboardTrack, 2000)

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
    printParticipants()
    log('USER JOINED EVENT ' + userId + ': ' + userObj._displayName)
  })

  room.on(JitsiMeetJS.events.conference.USER_LEFT, (userId, userObj) => {
    log('USER LEFT EVENT ' + userId + ': ' + userObj._displayName)
    printParticipants()
    if (!remoteTracks[userId]) {
      return
    }
    const tracks = remoteTracks[id]

    for (let i = 0; i < tracks.length; i++) {
      tracks[i].detach($(`#${id}${tracks[i].getType()}`))
    }
  })

  room.on(JitsiMeetJS.events.conference.TRACK_ADDED, onRemoteTrack)
  room.on(JitsiMeetJS.events.conference.TRACK_REMOVED, (track) => {
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

  room.setDisplayName(options.soundboardDisplayName)

  room.join()
}

function main() {
  if (bot_started) {
    return
  }

  document.title = 'Soundboard - ' + roomName

  conferenceInit()

  log('Target: ' + roomName)
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
