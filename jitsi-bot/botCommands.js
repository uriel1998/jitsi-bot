/* -------------------------
 * Command Handler Functions
 * -------------------------
 */

const grantAdmin = (userId, argument) => {
  if (!roomBotOptions.adminPass) {
    room.sendMessage(
      'Admin Pass not yet set for room, please use "/setAdminPass [pass]" first!',
      userId
    )
    return
  }
  if (argument !== roomBotOptions.adminPass) {
    room.sendMessage('Wrong Password.', userId)
    return
  }

  if (!room.isModerator()) {
    room.sendMessage('Cannot grant Moderator, I am not a moderator.', userId)
    return
  }

  room.grantOwner(userId)
  room.sendMessage('Command Executed, you should have admin now.', userId)

  // grab user Stat ID for Permanent Storage

  let user = room.getParticipantById(userId)
  if (!moderatorWhitelist.has(user.getStatsID())) {
    moderatorWhitelist.add(user.getStatsID())
    saveAdminIDs()
    room.sendMessage(
      "You've been added to the channel persistant Whitelist and will be granted moderator Automatically.",
      userId
    )
  }
}

const reloadBot = (userId = 'system') => {
  // FIXME Needs fix for node ?

  if (userId === 'system') {
    log(`Reload Forced by system.`)
    log(`Temporarily disabled reload command.`)
    //location.reload()
    return
  }

  if (room.getParticipantById(userId).isModerator()) {
    room.sendMessage('Reloading Bot, see ya in a second. ')
    location.reload()
  }
}

const muteAll = (userId) => {
  room.getParticipants().forEach((user) => {
    log('Muting ' + user._displayName)
    room.muteParticipant(user._id)
  })
}

const unknownCommand = (userId) => {
  room.sendMessage('Command not found', userId)
}

const setSubject = (userId, argument) => {
  room.setSubject(argument)
  room.sendMessage('Room Title Adjusted.', userId)
}

const ban = (userId, argument) => {
  const displayNameNormalized = argument.replaceAll(' ', '').toLowerCase()

  let statUserName = getStatUserByName(displayNameNormalized)

  if (!statUserName) {
    statUserName = 'randomasd123+' + bannedStatUsers.length + Date.now()
  }

  console.log(displayNameNormalized)
  console.log(statUserName)

  if (!room.getParticipantById(userId).isModerator()) {
    room.sendMessage('You are not allowed to ban a Person.', userId)
    return
  }

  if (
    bannedUsers.includes(displayNameNormalized) ||
    bannedStatUsers.includes(statUserName)
  ) {
    room.sendMessage('Already banned. See /banlist', userId)
  } else {
    bannedUsers.push(displayNameNormalized)
    bannedStatUsers.push(statUserName)
    room.sendMessage('User ' + argument.replace(' ', '') + ' banned.', userId)
  }
  saveBanlist()
}

const banlist = (userId) => {
  room.sendMessage('Banned Users: \n' + bannedUsers.join('\n'), userId)
}

const unban = (userId, argument) => {
  const displayNameNormalized = argument.replaceAll(' ', '').toLowerCase()

  const statUserName = getStatUserByName(displayNameNormalized)

  console.log(displayNameNormalized)
  console.log(statUserName)

  if (!room.getParticipantById(userId).isModerator()) {
    room.sendMessage('You are not allowed to unban a Person.', userId)
    return
  }

  let indexStatuser = bannedStatUsers.indexOf(statUserName)
  let indexBanneduser = bannedUsers.indexOf(displayNameNormalized)

  if (indexStatuser !== indexBanneduser) {
    console.log(
      'IndexStatuser could not be identified, deleting same index as bannedUser'
    )
    indexStatuser = indexBanneduser
  }

  bannedStatUsers.splice(indexStatuser, 1)
  bannedUsers.splice(indexBanneduser, 1)

  room.sendMessage('User ' + argument.replace(' ', '') + ' unbanned.', userId)

  saveBanlist()
}

const quitConferenceAfterTimeout = (userId, timeout) => {
  if (!room.isModerator()) {
    room.sendMessage("Cannot start Timeout, I'm not a moderator!", userId)
  }

  const timeoutInMS = timeout * 60 * 1000 // in ms
  let remainingTime = timeoutInMS

  let interval = 2

  if (quitConferenceTimeout) {
    room.sendMessage('There is already a forced Timeout. Cannot set.', userId)
  }

  const endConference = () => {
    room.end() // room 1 is "Conference Object", room 2 is "Room Object"
  }

  const sendTimeoutWarning = (isLast) => {
    remainingTime = Math.floor(remainingTime / interval)
    room.sendMessage(
      'Der Raum wird in ' +
        Math.floor(remainingTime / 60 / 1000) +
        ' Minuten geschlossen.'
    )

    if (isLast) {
      room.sendMessage(
        'Dies ist der Letzte Reminder. Der Raum wird in Kürze geschlossen.'
      )
      quitConferenceTimeout = setTimeout(endConference, remainingTime)
      return
    }

    quitConferenceTimeout = setTimeout(
      sendTimeoutWarning,
      Math.floor(remainingTime / interval),
      Math.floor(remainingTime / interval) < 60000
    )
  }

  room.sendMessage('Timer Started, you have ' + timeout + ' minutes.')

  quitConferenceTimeout = setTimeout(
    sendTimeoutWarning,
    Math.floor(remainingTime / interval),
    false
  )
}

const quit = (userId) => {
  if (room.getParticipantById(userId).isModerator()) {
    room.sendMessage("I'm leaving, bye.")
    room.room.doLeave()
    window.close()
  } else {
    room.sendMessage(
      'Sorry, you are not a Moderator. You need Moderator in this room to make me leave.'
    )
  }
}

const getBreakoutIDs = (userId) => {
  let breakoutIds = Object.keys(breakout._rooms)
  let breakoutNames = Object.values(breakout._rooms).map((room) => room.name)

  let merged = breakoutIds.map((id, index) => id + ': ' + breakoutNames[index])

  room.sendMessage('BreakoutRooms: \n' + merged.join('\n'), userId)
}

const addBreakout = (userId, argument) => {
  if (!room.isModerator()) {
    room.sendMessage('I am not moderator, cannot add Breakout.', userId)
    return
  }
  breakout.createBreakoutRoom(argument)
  room.sendMessage('Breakout created with specified name.', userId)
}

const joinExternalRoom = (userId, argument) => {
  window.open('/jitsi-bot/jitsi.html?room=' + argument, '_blank')

  room.sendMessage(
    'Started bot in Room ' +
      argument +
      '\nPlease check:\nhttps://meet.jit.si/' +
      argument,
    userId
  )
}

const broadcastMessage = (userId, argument) => {
  // set lastUserWhoExecutedCommand as this is a worker function.
  lastUserWhoExecutedCommand = userId
  postMessageToWorker(workerMessages.BROADCAST_MESSAGE, {
    message: argument,
    sourceRoomName: roomName,
  })
}

const sendMessage = (userId, argument) => {
  // set lastUserWhoExecutedCommand as this is a worker function.
  lastUserWhoExecutedCommand = userId
  const splitArg = argument.split(' ')
  const toRoom = splitArg.shift().toLowerCase()
  const message = splitArg.join(' ')
  postMessageToWorker(workerMessages.SEND_MESSAGE, {
    message: message,
    roomName: toRoom,
    sourceRoomName: roomName,
  })
}

const joinSoundBot = (userId) => {
  const url = new URL(window.location.href)
  window.open('../soundboard/soundboard.html' + url.search, '_blank')
}

const joinStreamingBot = (userId) => {
  const url = new URL(window.location.href)
  window.open('../streaming/streaming_effect.html' + url.search, '_blank')
}

const joinChatBot = (userId) => {
  const url = new URL(window.location.href)
  window.open('../chatbot/chatbot.html' + url.search, '_blank')
}

const joinRecordingBot = (userId) => {
  const url = new URL(window.location.href)
  window.open('../recording/recording.html' + url.search, '_blank')
}

const setAdminPass = (userId, argument) => {
  const [oldPass, newPass] = argument.split(' ')
  if (!roomBotOptions.adminPass) {
    // only one parameter since new room.
    roomBotOptions.adminPass = oldPass
  } else {
    if (roomBotOptions.adminPass !== oldPass) {
      room.sendMessage('Incorrect old Admin Pass, cannot change.', userId)
      return
    }
    roomBotOptions.adminPass = newPass
  }
  saveRoomOptions()
  room.sendMessage('Admin password set.', userId)
}

const addMattermostNotificationOnJoin = (userId, argument) => {
  if (argument.length < 25) {
    room.sendMessage(
      'Webhook ID probably malformed or none entered, keeping old config.',
      userId
    )
    return
  }

  roomBotOptions.onJoin = {
    mattermostNotification: true,
    mattermostNotificationWebhook: argument,
  }

  saveRoomOptions()

  room.sendMessage('Enabled Mattermost Notification on UserJoin.', userId)
}

const toggleMattermostNotificationOnJoin = (userId) => {
  if (roomBotOptions.onJoin) {
    roomBotOptions.onJoin.mattermostNotification =
      !roomBotOptions.onJoin.mattermostNotification || false
  }
  saveRoomOptions()

  room.sendMessage(
    `Toggled Mattermost Notification on UserJoin. --> now ${
      roomBotOptions.onJoin?.mattermostNotification ? 'Enabled' : 'Disabled'
    }`,
    userId
  )
}

const rollRandomParticipant = (userId) => {
  const randomIndex = Math.floor(room.getParticipants().length * Math.random())
  const participant = room.getParticipants()[randomIndex]

  const requestingUser = room.getParticipantById(userId)

  room.sendMessage(
    `${requestingUser._displayName?.replace(
      ' ',
      ''
    )} requested a random participant roll: \nCongratulations to\n${participant._displayName?.replace(
      ' ',
      ''
    )}`
  )
}

const identifyNumber = (userId, argument) => {
  let split = argument.split(' ')
  const phoneNumber = split.shift()
  const name = split.join(' ')

  if (!phoneNumber.match(/^\+?\d+$/g)) {
    room.sendMessage(`Error: 1st Argument is not a phone Number.`, userId)
    help(userId, '/identifyNumber')
    return
  }

  if (name.length < 1) {
    room.sendMessage(`Error: 2nd Argument is an invalid name.`, userId)
    help(userId, '/identifyNumber')
    return
  }

  phoneNumberNamesMap[phoneNumber] = name
  room.sendMessage(
    `Phone Number ${phoneNumber} has been identified as name ${name}. If this is wrong, use /identifyNumber again.`
  )
  savePhoneNumberNameMap()
}

const about = (userId, argument) => {
  room.sendMessage(
    `Created by Bloodiko\nGithub: https://github.com/bloodiko/jitsi-bot\n`,
    userId
  )
}

const help = (userId, argument) => {
  if (argument) {
    if (!argument.startsWith('/')) {
      argument = `/${argument}` // prepend slash to be commandHandler list conform
    }

    if ((!argument) in commandHandler) {
      room.sendMessage(
        'Command does not exist, no help available. Try /help',
        userId
      )
      return
    }

    room.sendMessage(
      `\
      Description: \n${commandHandler[argument].helptext}\n\
      Syntax: \n${commandHandler[argument].syntax}\n\
      Reqirements: \n${commandHandler[argument].requirements}\n\
      Example(s): \n${commandHandler[argument].example}`,
      userId
    )
    return
  }

  const generalHelptext = `Available Commands: \n${Object.keys(
    commandHandler
  ).join('\n')}\n\n\
  To get more info about any command use /help COMMAND`

  room.sendMessage(generalHelptext, userId)
}

/* -----------------------------
 * Command Handler Functions End
 * -----------------------------
 */

const commandHandler = {
  '/help': {
    handler: help,
    helptext:
      'Shows this help. To get more info about any command.\nArguments in brackets - example [COMMAND] - are optional.\nArguments without are mandatory. Do not write [] as argument, only the actual content.',
    syntax: '/help [COMMAND]',
    requirements: 'None',
    example: '/help\n/help admin',
  },
  '/admin': {
    handler: grantAdmin,
    helptext:
      'This will attempt to grant the requesting Person Moderator/Admin privileges within the current room.\n If successful, the Person will be granted moderator and will be automatically granted moderator/admin on joining the room.',
    syntax: '/admin PASSWORD',
    requirements: 'Bot must be moderator/admin',
    example: '/admin admin',
  },
  '/reload': {
    handler: reloadBot,
    helptext:
      'Will restart current bot. You are requested to provide the Bot Moderator again after re-join.',
    syntax: '/reload',
    requirements: 'User must be moderator',
    example: '/reload',
  },
  '/muteAll': {
    handler: muteAll,
    helptext: '',
    syntax: '/muteAll',
    requirements: 'None',
    example: '/muteAll',
  },
  '/setSubject': {
    handler: setSubject,
    helptext: 'Sets the Room Name (will not change the URL)',
    syntax: '/setSubject SUBJECT',
    requirements: 'None',
    example: '/setSubject Hallo Welt!',
  },
  '/ban': {
    handler: ban,
    helptext:
      'Bans the specified user. Banned users will be blocked from joining the the current conference - other rooms will still work. Symbols must be included. Spaces are ignored.',
    syntax: '/ban DISPLAYNAME',
    requirements: 'You must be Moderator',
    example: '/ban Benutzer1',
  },
  '/unban': {
    handler: unban,
    helptext: 'Unbans the specified user. The user can join again.',
    syntax: '/unban DISPLAYNAME',
    requirements: 'You must be Moderator',
    example: '/unban Benutzer1',
  },
  '/banlist': {
    handler: banlist,
    helptext: 'Views currently banned users for the current room.',
    syntax: '/banlist',
    requirements: 'None',
    example: '/banlist',
  },
  '/timeoutConf': {
    handler: quitConferenceAfterTimeout,
    helptext:
      'This will start a set countdown. At the end of the Timeout, the conference will be closed forcefully. Several warnings will be sent before termination.',
    syntax: '/timeoutConf MINUTES',
    requirements: 'Bot must be moderator.',
    example: '/timeoutConf 60',
  },
  '/quit': {
    handler: quit,
    helptext:
      'Disconnects the Bot from the current room. It will not rejoin unless invited again.',
    syntax: '/quit',
    requirements: 'You must be moderator.',
    example: '/quit',
  },
  '/addBreakout': {
    handler: addBreakout,
    helptext: 'Creates a breakout room with the specified name.',
    syntax: '/addBreakout NAME',
    requirements: 'Bot must be moderator.',
    example: '/addBreakout Kaffeeküche',
  },
  '/joinExternalRoom': {
    handler: joinExternalRoom,
    helptext: 'Attempts to join another conference.',
    syntax: '/joinExternalRoom ROOMNAME',
    requirements: 'None',
    example: '/joinExternalRoom konferenz1',
  },
  '/joinSoundBot': {
    handler: joinSoundBot,
    helptext: 'Attempts to spawn a SoundBot in the current room.',
    syntax: '/joinSoundBot',
    requirements: 'None',
    example: '/joinSoundBot',
  },
  '/joinStreamingBot': {
    handler: joinStreamingBot,
    helptext: 'Attempts to spawn a Streaming Bot in the current room.',
    syntax: '/joinStreamingBot',
    requirements: 'None',
    example: '/joinStreamingBot',
  },
  '/joinChatBot': {
    handler: joinChatBot,
    helptext: 'Attempts to spawn a Chatbot in the current room.',
    syntax: '/joinChatBot',
    requirements: 'None',
    example: '/joinChatBot',
  },
  '/joinRecordingBot': {
    handler: joinRecordingBot,
    helptext: 'Attempts to spawn a Recording Bot in the current room.',
    syntax: '/joinRecordingBot',
    requirements: 'None',
    example: '/joinRecordingBot',
  },
  '/sendMessage': {
    handler: sendMessage,
    helptext: 'Allows sending a specified message to another jitsi room.',
    syntax: '/sendMessage ROOMNAME MESSAGE',
    requirements:
      'Both Rooms must have a bot started on the same instance. The message will be passed by the bot to the chat. It will include Source Room Name.',
    example: '/sendMessage conference1 Hallo Conference 1.',
  },
  '/sendBroadcast': {
    handler: broadcastMessage,
    helptext:
      'sends a Broadcast Message to all bots connected on the same instance.',
    syntax: '/sendBroadcast MESSAGE',
    requirements: 'None',
    example: '/sendBroadcast Mittagessen ist angekommen.',
  },
  '/enableMMNotificationOnJoin': {
    handler: addMattermostNotificationOnJoin,
    helptext:
      'This will send a custom Mattermost notification whenever a non-moderator-user joins the room.',
    syntax: '/enableMMNotificationOnJoin MATTERMOST_WEBHOOK_ID',
    requirements: 'Mattermost Webhook must exist.',
    example: '/enableMMNotificationOnJoin assmfaf8hbbu3rahk6wrm3u3ya',
  },
  '/toggleMMNotificationOnJoin': {
    handler: toggleMattermostNotificationOnJoin,
    helptext:
      'Toggle the Mattermost Notification on User Join on or off. Will print current setting.',
    syntax: '/toggleMMNotificationOnJoin',
    requirements: 'None',
    example: '/toggleMMNotificationOnJoin',
  },
  '/setAdminPass': {
    handler: setAdminPass,
    helptext:
      'Set or Edit the current admin password for this room. The admin password will be saved per Room. Please do not include spaces in your password. Anything else works.',
    syntax: '/setAdminPass [OLD_PASSWORD] NEW_PASSWORD',
    requirements: 'None',
    example: '/setAdminPass admin admin_new\n/setAdminPass initialPassword',
  },
  '/randomParticipant': {
    handler: rollRandomParticipant,
    helptext:
      'Rolls a random user from all currently connected users. Will print out in public chat.',
    syntax: '/randomParticipant',
    requirements: 'None',
    example: '/randomParticipant',
  },
  '/identifyNumber': {
    handler: identifyNumber,
    helptext:
      'Allows identifying a phone number as known. If known, the name will be published on join.',
    syntax: '/identifyNumber NUMBER NAME',
    example: '/identifyNumber 30757 Bastian Jesuiter DI42 ...',
  },
  '/about': {
    handler: about,
    helptext: 'View Meta-Information about this bot',
    syntax: '/about',
    example: '/about',
  },
}

const CHATBOT_REFERENCE_INDEX_PATH = './data/reference-index.json'
const CHATBOT_CUSTOM_INDEX_PATH = './data/custom-index.json'
const CHATBOT_TAROT_BASE_PATH = '../lib/Tarot'
const CHATBOT_BANG_COMMANDS_KEY = 'chatbotBangCommands'
const CHATBOT_BANG_DECKS_KEY = 'chatbotBangDecks'

const TAROT_JOIN_PHRASES = [
  'is about',
  'pertains to',
  'refers to',
  'is related to',
  'is regarding',
  'relates to',
]

const TAROT_LIGHT_PHRASES = [
  'considering',
  'exploring',
  'looking into',
  'contemplating',
  'deliberating on',
  'reflecting on',
]

const TAROT_SHADOW_PHRASES = [
  'being wary of',
  'avoiding',
  'steering clear of',
  'forgoing',
  'resisting',
  'being suspicious of',
]

const TAROT_NARRATIVE_0 = [
  'The influence that is affecting you or the matter of inquiry generally',
  'The nature of the obstacle in front of you',
  'The aim or ideal of the matter',
  'The foundation or basis of the subject that has already happened',
  'The influence that has just passed or has passed away',
  'The influence that is coming into action and will operating in the near future',
  'The position or attitude you have in the circumstances',
  'The environment or situation that have an effect on the matter',
  'The hopes or fears of the matter',
  'The culmination which is brought about by the influence shown by the other cards',
]

const TAROT_NARRATIVE_1 = [
  'The heart of the issue or influence affecting the matter of inquiry',
  'The obstacle that stands in the way',
  'Either the goal or the best potential result in the current situation',
  'The foundation of the issue which has passed into reality',
  'The past or influence that is departing',
  'The future or influence that is approaching',
  'You, either as you are, could be or are presenting yourself to be',
  'Your house or environment',
  'Your hopes and fears',
  'The ultimate result or cumulation about the influences from the other cards in the divination',
]

const TAROT_NARRATIVE_2 = [
  'Your situation',
  'An influence now coming into play',
  'Your hope or goal',
  'The issue at the root of your question',
  'An influence that will soon have an impact',
  'Your history',
  'The obstacle',
  'The possible course of action',
  'The current future if you do nothing',
  'The possible future',
]

const TAROT_NARRATIVE_3 = [
  'To resolve your situation',
  'To help clear the obstacle',
  'To help achieve your hope or goal',
  'To get at the root of your question',
  'To help see an influence that will soon have an impact',
  'To help see how you have gotten to this point',
  'To help interpret your feelings about the situation',
  'To help you understand the moods of those closest to you',
  'To help understand your fear',
  'To help see the outcome',
]

let chatbotReferenceIndex = undefined
let chatbotCustomIndex = undefined
let chatbotFileCache = {}
let chatbotJsonCache = {}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function sendBangResponse(userId, isPrivate, message) {
  if (isPrivate) {
    room.sendMessage(message, userId)
    return
  }
  room.sendMessage(message)
}

function sendBangThumbDown(userId, isPrivate) {
  sendBangResponse(userId, isPrivate, '👎')
}

function getMessageSender(userId) {
  const sender = room.getParticipantById(userId)
  if (!sender?._displayName) {
    return '@"unknown"'
  }
  return '@"' + sender._displayName + '"'
}

function getBangState(key) {
  const state = JSON.parse(window.localStorage.getItem(key) || '{}')
  if (!state[roomName]) {
    state[roomName] = {}
  }
  return state
}

function saveBangState(key, state) {
  window.localStorage.setItem(key, JSON.stringify(state))
}

function getRoomBangCommands() {
  const state = getBangState(CHATBOT_BANG_COMMANDS_KEY)
  return state[roomName]
}

function saveRoomBangCommands(commands) {
  const state = getBangState(CHATBOT_BANG_COMMANDS_KEY)
  state[roomName] = commands
  saveBangState(CHATBOT_BANG_COMMANDS_KEY, state)
}

function getRoomDeck() {
  const state = getBangState(CHATBOT_BANG_DECKS_KEY)
  return state[roomName]
}

function saveRoomDeck(deck) {
  const state = getBangState(CHATBOT_BANG_DECKS_KEY)
  state[roomName] = deck
  saveBangState(CHATBOT_BANG_DECKS_KEY, state)
}

async function fetchTextCached(path) {
  if (chatbotFileCache[path] !== undefined) {
    return chatbotFileCache[path]
  }

  const response = await fetch(path)
  if (!response.ok) {
    throw new Error('Cannot read file: ' + path)
  }

  const text = await response.text()
  chatbotFileCache[path] = text
  return text
}

async function fetchJsonCached(path) {
  if (chatbotJsonCache[path] !== undefined) {
    return chatbotJsonCache[path]
  }

  const response = await fetch(path)
  if (!response.ok) {
    throw new Error('Cannot read json: ' + path)
  }

  const json = await response.json()
  chatbotJsonCache[path] = json
  return json
}

async function loadReferenceIndex() {
  if (chatbotReferenceIndex) {
    return chatbotReferenceIndex
  }

  chatbotReferenceIndex = await fetchJsonCached(CHATBOT_REFERENCE_INDEX_PATH)
  return chatbotReferenceIndex
}

async function loadCustomIndex() {
  if (chatbotCustomIndex) {
    return chatbotCustomIndex
  }

  chatbotCustomIndex = await fetchJsonCached(CHATBOT_CUSTOM_INDEX_PATH)
  return chatbotCustomIndex
}

function getTarotNarrative(position) {
  const chooser = randomInt(0, 3)
  const source =
    chooser === 0
      ? TAROT_NARRATIVE_0
      : chooser === 1
      ? TAROT_NARRATIVE_1
      : chooser === 2
      ? TAROT_NARRATIVE_2
      : TAROT_NARRATIVE_3

  return source[position] || TAROT_NARRATIVE_0[0]
}

async function getTarotCardData(number) {
  const cardsData = await fetchTextCached(CHATBOT_TAROT_BASE_PATH + '/number_cards.dat')
  const lines = cardsData.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith(String(number) + '=')) {
      continue
    }

    const split = trimmed.split('=')
    if (split.length < 3) {
      return null
    }

    const cardName = split[1].trim()
    const orientation = split[2].trim()
    if (!cardName || !orientation) {
      return null
    }
    return [cardName, orientation]
  }
  return null
}

async function getTarotMeaning(cardName, orientation) {
  const data = await fetchJsonCached(CHATBOT_TAROT_BASE_PATH + '/interpretations.json')
  const interpretations = data?.tarot_interpretations
  if (!Array.isArray(interpretations)) {
    return null
  }

  for (const entry of interpretations) {
    if (entry?.name !== cardName) {
      continue
    }
    const meanings = entry?.meanings?.[orientation]
    if (!Array.isArray(meanings) || meanings.length === 0) {
      return null
    }
    return String(meanings[randomInt(0, meanings.length - 1)]).toLowerCase()
  }

  return null
}

async function getTarotReading(number) {
  const cardData = await getTarotCardData(number)
  if (!cardData) {
    return null
  }

  const cardName = cardData[0]
  const orientation = cardData[1]
  const meaning = await getTarotMeaning(cardName, orientation)
  if (!meaning) {
    return null
  }

  const preface = getTarotNarrative(0)
  const joiner = TAROT_JOIN_PHRASES[randomInt(0, TAROT_JOIN_PHRASES.length - 1)]
  const join2 =
    orientation === 'shadow'
      ? TAROT_SHADOW_PHRASES[randomInt(0, TAROT_SHADOW_PHRASES.length - 1)]
      : TAROT_LIGHT_PHRASES[randomInt(0, TAROT_LIGHT_PHRASES.length - 1)]

  return `#${cardName} in ${orientation}: ${preface} ${joiner} ${join2} ${meaning}`
}

async function getLargeTarotReading(number) {
  const orientation = number > 78 ? 'shadow' : 'light'
  const cardNumber = number > 78 ? number - 78 : number
  const cardData = await getTarotCardData(cardNumber)
  if (!cardData) {
    return null
  }
  const cardName = cardData[0]

  const data = await fetchJsonCached(
    CHATBOT_TAROT_BASE_PATH + '/interpretations_large.json'
  )
  const interpretations = data?.tarot_interpretations
  if (!Array.isArray(interpretations)) {
    return null
  }

  for (const entry of interpretations) {
    if (entry?.name !== cardName) {
      continue
    }
    const meanings = entry?.meanings?.[orientation]
    if (!Array.isArray(meanings) || meanings.length === 0) {
      return null
    }
    return String(meanings[0])
  }
  return null
}

async function shuffleDeck() {
  const cardsData = await fetchTextCached(CHATBOT_TAROT_BASE_PATH + '/playing_cards.dat')
  const cards = cardsData
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('='))
    .map((line) => line.split('=').slice(1).join('=').trim())
    .filter(Boolean)

  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(0, i)
    const temp = cards[i]
    cards[i] = cards[j]
    cards[j] = temp
  }

  saveRoomDeck(cards)
  return cards
}

function parseBangCommand(rawMessage) {
  const message = String(rawMessage || '')
  const firstSpaceIndex = message.indexOf(' ')
  if (firstSpaceIndex === -1) {
    return { command: message.trim(), argument: '' }
  }
  return {
    command: message.substring(0, firstSpaceIndex).trim(),
    argument: message.substring(firstSpaceIndex + 1),
  }
}

function parseCustomLookupArgument(rawArgument) {
  const arg = rawArgument.trim()
  if (!arg) {
    return { collection: '', rest: '' }
  }

  if (arg[0] === '"' || arg[0] === "'") {
    const quote = arg[0]
    const end = arg.indexOf(quote, 1)
    if (end !== -1) {
      return {
        collection: arg.substring(1, end),
        rest: arg.substring(end + 1).trim(),
      }
    }
    return { collection: arg.substring(1), rest: '' }
  }

  const firstSpace = arg.indexOf(' ')
  if (firstSpace === -1) {
    return { collection: arg, rest: '' }
  }
  return {
    collection: arg.substring(0, firstSpace),
    rest: arg.substring(firstSpace + 1).trim(),
  }
}

function parseSearchTerms(rest) {
  const trimmed = rest.trim()
  if (!trimmed) {
    return []
  }

  if (trimmed[0] === '"' || trimmed[0] === "'") {
    const quote = trimmed[0]
    const end = trimmed.indexOf(quote, 1)
    if (end !== -1) {
      return [trimmed.substring(1, end)]
    }
    return [trimmed.substring(1)]
  }

  return trimmed.split(/\s+/).filter(Boolean)
}

function normalizeLookupArg(value) {
  return String(value || '')
    .trim()
    .replace(/\.(txt|md)$/i, '')
}

function findLookupMatches(names, arg) {
  const normalizedArg = normalizeLookupArg(arg)
  const exactMatch = names.find(
    (name) => normalizeLookupArg(name).toLowerCase() === normalizedArg.toLowerCase()
  )
  if (exactMatch) {
    return { type: 'exact', values: [exactMatch] }
  }

  if (/^[a-z]$/i.test(normalizedArg)) {
    const filtered = names.filter((name) =>
      normalizeLookupArg(name).toLowerCase().startsWith(normalizedArg.toLowerCase())
    )
    filtered.sort((a, b) => a.localeCompare(b))
    return { type: 'letter', values: filtered }
  }

  const partial = names.filter((name) =>
    normalizeLookupArg(name)
      .toLowerCase()
      .includes(normalizedArg.toLowerCase())
  )
  partial.sort((a, b) => a.localeCompare(b))
  if (partial.length === 1) {
    return { type: 'unique', values: partial }
  }
  if (partial.length > 1) {
    return { type: 'multiple', values: partial }
  }
  return { type: 'none', values: [] }
}

async function lookupFromReferenceIndex(items, settings, arg) {
  const trimmedArg = normalizeLookupArg(arg)
  const names = items.map((item) => item.name)

  if (!trimmedArg) {
    if (!settings.listAllOnEmpty) {
      return `${settings.icon}Please give at least the first letter of the ${settings.itemLabel}.`
    }
    const sorted = [...names].sort((a, b) => a.localeCompare(b))
    if (sorted.length === 0) {
      return null
    }
    return sorted.map((name) => '- ' + name).join('\n')
  }

  const matches = findLookupMatches(names, trimmedArg)
  if (matches.type === 'none' || matches.values.length === 0) {
    return null
  }

  if (matches.type === 'letter') {
    return matches.values.map((name) => '- ' + name).join('\n')
  }

  if (matches.type === 'multiple') {
    return (
      settings.icon +
      'Choose from these ' +
      settings.itemsLabel +
      ':\n' +
      matches.values.map((name) => '- ' + name).join('\n')
    )
  }

  const selectedName = matches.values[0]
  const selected = items.find((item) => item.name === selectedName)
  if (!selected) {
    return null
  }
  return await fetchTextCached(selected.path)
}

function replaceCustomPlaceholders(template, argument, userId, commandEntry) {
  let answer = template
  const searches = []
  const replacements = []

  if (answer.includes('{mention}')) {
    const mentionMatch = argument.match(/@\S+/)
    if (!mentionMatch) {
      return null
    }
    searches.push('{mention}')
    replacements.push(mentionMatch[0])
  }

  if (answer.includes('{text}')) {
    searches.push('{text}')
    replacements.push(argument)
  }

  if (answer.includes('{sender}')) {
    searches.push('{sender}')
    replacements.push(getMessageSender(userId))
  }

  if (answer.includes('{count}')) {
    commandEntry.count = (commandEntry.count || 0) + 1
    searches.push('{count}')
    replacements.push(String(commandEntry.count))
  }

  for (let i = 0; i < searches.length; i++) {
    answer = answer.split(searches[i]).join(replacements[i])
  }

  return answer
}

async function handleBangCommand(userId, rawMessage, isPrivate) {
  if (!rawMessage || !String(rawMessage).startsWith('!')) {
    return false
  }

  const parsed = parseBangCommand(rawMessage)
  const command = parsed.command
  const argument = parsed.argument || ''
  const trimmedArgument = argument.trim()
  const isModerator = room.getParticipantById(userId)?.isModerator?.() || false

  try {
    if (command === '!set') {
      if (!isModerator) {
        return true
      }

      const message = trimmedArgument
      if (!message.includes(' ')) {
        sendBangThumbDown(userId, isPrivate)
        return true
      }

      const splitIndex = message.indexOf(' ')
      const customCommand = message.substring(0, splitIndex).toLowerCase()
      const customMessage = message.substring(splitIndex + 1)

      if (
        !customMessage ||
        customCommand.length < 2 ||
        (customCommand[0] !== '!' && customCommand[0] !== '?')
      ) {
        sendBangThumbDown(userId, isPrivate)
        return true
      }

      const commands = getRoomBangCommands()
      const previousCount = commands[customCommand]?.count || 0
      commands[customCommand] = {
        message: customMessage,
        count: previousCount,
      }
      saveRoomBangCommands(commands)
      sendBangResponse(userId, isPrivate, '👍')
      return true
    }

    if (command === '!unset') {
      if (!isModerator) {
        return true
      }

      const customCommand = trimmedArgument.toLowerCase()
      if (!customCommand) {
        sendBangThumbDown(userId, isPrivate)
        return true
      }

      const commands = getRoomBangCommands()
      if (!commands[customCommand]) {
        sendBangThumbDown(userId, isPrivate)
        return true
      }

      delete commands[customCommand]
      saveRoomBangCommands(commands)
      sendBangResponse(userId, isPrivate, '👍')
      return true
    }

    if (command === '!command' || command === '!commands') {
      const commands = getRoomBangCommands()
      const customNames = Object.keys(commands).sort((a, b) => a.localeCompare(b))

      if (!isModerator && customNames.length === 0) {
        sendBangResponse(userId, isPrivate, '*No commands configured*')
        return true
      }

      let response = '### 💬 Available commands\n'
      response += '- **!command** - List all commands\n'
      response += '- **!roll** - Roll dice in standard notation\n'
      response += '- **!tarot** - Draw a tarot card with a narrative interpretation\n'
      response += '- **!ltarot** - Draw a tarot card with a longer, detailed interpretation\n'
      response += '- **!fortune** - Display a random fortune\n'
      response +=
        '- **!spelllist** - List available spell lists, or show spells for a given class (e.g. `!spelllist Druid`)\n'
      response +=
        '- **!spells** - Look up a spell by name or partial name (e.g. `!spells Fireball`)\n'
      response +=
        '- **!class** - Look up a class by name or partial name (e.g. `!class Druid`)\n'
      response +=
        '- **!monsters** - Look up a monster by name or partial name (e.g. `!monsters Beholder`)\n'
      response +=
        '- **!magicitems** - Look up a magic item by name or partial name (e.g. `!magicitems Bag of Holding`)\n'
      response +=
        '- **!nimble** - Look up a Nimble rule by name or partial name (e.g. `!nimble Conditions`)\n'
      response +=
        '- **!rules** - Look up an SRD rule by name or partial name (e.g. `!rules Combat`)\n'
      response +=
        '- **!!** - Browse custom content collections (e.g. `!! speeches` or `!! speeches "Harvest Speech"`)\n'
      response += '- **!shuffle** - Shuffle a standard 52-card playing deck for this room\n'
      response +=
        '- **!draw** - Draw the top card from the deck; auto-shuffles if needed\n'
      response += '- **!remain** - Show how many cards are left in the current deck\n'

      for (const customName of customNames) {
        response += `- **${customName}** - ${commands[customName].message}`
        if (commands[customName].count) {
          response += ` - *Current count: ${commands[customName].count}*`
        }
        response += '\n'
      }

      if (isModerator) {
        response += '\n---\n'
        response += '### ⭐ Commands for moderators only\n'
        response += '- **!set** - Create or update a command\n'
        response += '  ```\n'
        response += '  !set !counter The counter was used {count} times\n'
        response += '  ```\n'
        response += '- **!unset** - Remove a command\n'
        response += '  ```\n'
        response += '  !unset !counter\n'
        response += '  ```\n'
        response += '\n'
        response += '---\n'
        response += '### 💱 Placeholders\n'
        response += '- **{sender}** - Replaced with a mention of the sender\n'
        response += '- **{mention}** - Replaced with the first mention in the command\n'
        response += '- **{text}** - All text that was provided after the command\n'
        response += '- **{count}** - A counter how often the command was triggered already\n'
      }

      sendBangResponse(userId, isPrivate, response)
      return true
    }

    if (command === '!roll') {
      let parsedMessage = trimmedArgument
      const hasAdv = /\badv\b/i.test(parsedMessage)
      const hasDis = /\bdis\b/i.test(parsedMessage)
      let rollMode = null

      if ((hasAdv || hasDis) && !(hasAdv && hasDis)) {
        rollMode = hasAdv ? 'adv' : 'dis'
        parsedMessage = parsedMessage.replace(/\b(adv|dis)\b/gi, '').trim()
      }

      const matches = parsedMessage.match(
        /^\s*(\d+)\s*[dD]\s*(\d+)(?:\s*([+-])\s*(\d+))?\s*$/
      )

      if (!matches) {
        sendBangThumbDown(userId, isPrivate)
        return true
      }

      const diceCount = Number(matches[1])
      const diceSides = Number(matches[2])
      const modifierSign = matches[3]
      const modifierValue = matches[4] ? Number(matches[4]) : null

      if (diceCount <= 0 || diceSides <= 0) {
        sendBangThumbDown(userId, isPrivate)
        return true
      }

      const rollOnce = () => {
        const rolls = []
        for (let i = 0; i < diceCount; i++) {
          rolls.push(randomInt(1, diceSides))
        }

        let total = rolls.reduce((sum, value) => sum + value, 0)
        if (modifierValue !== null) {
          total = modifierSign === '+' ? total + modifierValue : total - modifierValue
        }
        return { rolls, total }
      }

      let answer = ''
      if (rollMode === null) {
        const result = rollOnce()
        answer = 'Rolled ' + result.rolls.join(', ')
        if (modifierValue !== null) {
          answer += ` ${modifierSign} (${modifierValue})`
        }
        answer += '\nFor a total of ' + result.total
      } else {
        const rollA = rollOnce()
        const rollB = rollOnce()

        answer = 'Roll 1: Rolled ' + rollA.rolls.join(', ')
        if (modifierValue !== null) {
          answer += ` ${modifierSign} (${modifierValue})`
        }
        answer += '\nFor a total of ' + rollA.total
        answer += '\nRoll 2: Rolled ' + rollB.rolls.join(', ')
        if (modifierValue !== null) {
          answer += ` ${modifierSign} (${modifierValue})`
        }
        answer += '\nFor a total of ' + rollB.total

        const finalRoll =
          rollMode === 'adv'
            ? Math.max(rollA.total, rollB.total)
            : Math.min(rollA.total, rollB.total)
        answer += '\nFINAL ROLL: ' + finalRoll
      }

      sendBangResponse(userId, isPrivate, answer)
      return true
    }

    if (command === '!ltarot') {
      const reading = await getLargeTarotReading(randomInt(1, 156))
      if (!reading) {
        sendBangThumbDown(userId, isPrivate)
        return true
      }
      sendBangResponse(userId, isPrivate, reading)
      return true
    }

    if (command === '!tarot') {
      const reading = await getTarotReading(randomInt(1, 156))
      if (!reading) {
        sendBangThumbDown(userId, isPrivate)
        return true
      }
      sendBangResponse(userId, isPrivate, reading)
      return true
    }

    if (command === '!fortune') {
      const fortunesRaw = await fetchTextCached(CHATBOT_TAROT_BASE_PATH + '/fortunes')
      const fortunes = fortunesRaw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('%'))

      if (fortunes.length === 0) {
        sendBangThumbDown(userId, isPrivate)
        return true
      }

      const fortune = fortunes[randomInt(0, fortunes.length - 1)]
      sendBangResponse(userId, isPrivate, '🔮 ' + fortune + '\n')
      return true
    }

    if (command === '!spelllist') {
      const index = await loadReferenceIndex()
      const spellLists = index?.spellLists || []
      if (!trimmedArgument) {
        const names = spellLists.map((item) => item.name).sort((a, b) => a.localeCompare(b))
        if (names.length === 0) {
          sendBangThumbDown(userId, isPrivate)
          return true
        }
        sendBangResponse(
          userId,
          isPrivate,
          '📖 Which spell list would you like?\n' +
            names.map((name) => '- ' + name).join('\n')
        )
        return true
      }

      const matched = spellLists.find((entry) => {
        return (
          normalizeLookupArg(entry.name).toLowerCase() ===
          normalizeLookupArg(trimmedArgument).toLowerCase()
        )
      })
      if (!matched) {
        sendBangThumbDown(userId, isPrivate)
        return true
      }

      const contents = await fetchTextCached(matched.path)
      sendBangResponse(userId, isPrivate, contents)
      return true
    }

    if (command === '!spells') {
      const index = await loadReferenceIndex()
      const result = await lookupFromReferenceIndex(
        index?.spells || [],
        {
          icon: '🧙',
          itemLabel: 'spell',
          itemsLabel: 'spells',
          listAllOnEmpty: false,
        },
        trimmedArgument
      )
      if (!result) {
        sendBangThumbDown(userId, isPrivate)
      } else {
        sendBangResponse(userId, isPrivate, result)
      }
      return true
    }

    if (command === '!class') {
      const index = await loadReferenceIndex()
      const result = await lookupFromReferenceIndex(
        index?.classes || [],
        {
          icon: '⚔️',
          itemLabel: 'class',
          itemsLabel: 'classes',
          listAllOnEmpty: true,
        },
        trimmedArgument
      )
      if (!result) {
        sendBangThumbDown(userId, isPrivate)
      } else {
        sendBangResponse(userId, isPrivate, result)
      }
      return true
    }

    if (command === '!monsters') {
      const index = await loadReferenceIndex()
      const result = await lookupFromReferenceIndex(
        index?.monsters || [],
        {
          icon: '🧌',
          itemLabel: 'monster',
          itemsLabel: 'monsters',
          listAllOnEmpty: false,
        },
        trimmedArgument
      )
      if (!result) {
        sendBangThumbDown(userId, isPrivate)
      } else {
        sendBangResponse(userId, isPrivate, result)
      }
      return true
    }

    if (command === '!magicitems') {
      const index = await loadReferenceIndex()
      const result = await lookupFromReferenceIndex(
        index?.magicItems || [],
        {
          icon: '🪄',
          itemLabel: 'magic item',
          itemsLabel: 'magic items',
          listAllOnEmpty: false,
        },
        trimmedArgument
      )
      if (!result) {
        sendBangThumbDown(userId, isPrivate)
      } else {
        sendBangResponse(userId, isPrivate, result)
      }
      return true
    }

    if (command === '!nimble') {
      const index = await loadReferenceIndex()
      const result = await lookupFromReferenceIndex(
        index?.nimble || [],
        {
          icon: '📑',
          itemLabel: 'nimble rule',
          itemsLabel: 'nimble rules',
          listAllOnEmpty: true,
        },
        trimmedArgument
      )
      if (!result) {
        sendBangThumbDown(userId, isPrivate)
      } else {
        sendBangResponse(userId, isPrivate, result)
      }
      return true
    }

    if (command === '!rules') {
      const index = await loadReferenceIndex()
      const result = await lookupFromReferenceIndex(
        index?.rules || [],
        {
          icon: '📜',
          itemLabel: 'rule',
          itemsLabel: 'rules',
          listAllOnEmpty: true,
        },
        trimmedArgument
      )
      if (!result) {
        sendBangThumbDown(userId, isPrivate)
      } else {
        sendBangResponse(userId, isPrivate, result)
      }
      return true
    }

    if (command === '!!') {
      const custom = await loadCustomIndex()
      const collections = custom?.collections || []

      if (!trimmedArgument) {
        if (collections.length === 0) {
          sendBangThumbDown(userId, isPrivate)
          return true
        }
        const names = collections.map((collection) => collection.name).sort((a, b) =>
          a.localeCompare(b)
        )
        sendBangResponse(
          userId,
          isPrivate,
          '📖 Which collection would you like?\n' +
            names.map((name) => '- ' + name).join('\n')
        )
        return true
      }

      const parsedLookup = parseCustomLookupArgument(trimmedArgument)
      const collection = collections.find(
        (item) =>
          item.name.toLowerCase() === parsedLookup.collection.toLowerCase()
      )
      if (!collection) {
        sendBangThumbDown(userId, isPrivate)
        return true
      }

      const entries = Array.isArray(collection.entries) ? collection.entries : []

      if (!parsedLookup.rest) {
        if (entries.length === 0) {
          sendBangThumbDown(userId, isPrivate)
          return true
        }
        const names = entries.map((entry) => entry.name).sort((a, b) => a.localeCompare(b))
        sendBangResponse(
          userId,
          isPrivate,
          '📖 Choose from:\n' + names.map((name) => '- ' + name).join('\n')
        )
        return true
      }

      const searchTerms = parseSearchTerms(parsedLookup.rest)
      const matches = entries.filter((entry) =>
        searchTerms.some((term) =>
          entry.name.toLowerCase().includes(term.toLowerCase())
        )
      )

      if (matches.length === 0) {
        sendBangThumbDown(userId, isPrivate)
        return true
      }

      if (matches.length === 1) {
        const contents = await fetchTextCached(matches[0].path)
        sendBangResponse(userId, isPrivate, contents)
        return true
      }

      const names = matches.map((entry) => entry.name).sort((a, b) => a.localeCompare(b))
      sendBangResponse(
        userId,
        isPrivate,
        '📖 Choose from these:\n' + names.map((name) => '- ' + name).join('\n')
      )
      return true
    }

    if (command === '!shuffle') {
      const cards = await shuffleDeck()
      sendBangResponse(
        userId,
        isPrivate,
        `🃏 The deck has been shuffled. ${cards.length} cards remain.`
      )
      return true
    }

    if (command === '!draw') {
      let cards = getRoomDeck()
      let autoShuffled = false

      if (!Array.isArray(cards) || cards.length === 0) {
        cards = await shuffleDeck()
        autoShuffled = true
      }

      const drawn = cards.shift()
      saveRoomDeck(cards)

      let answer = ''
      if (autoShuffled) {
        answer += '🃏 The deck has been shuffled. Drawing first card...\n'
      }
      answer += '🃏 ' + drawn

      sendBangResponse(userId, isPrivate, answer)
      return true
    }

    if (command === '!remain') {
      const cards = getRoomDeck()
      const count = Array.isArray(cards) ? cards.length : 0
      sendBangResponse(
        userId,
        isPrivate,
        `🃏 ${count} card${count === 1 ? '' : 's'} remain${
          count === 1 ? 's' : ''
        } in the deck.`
      )
      return true
    }

    const customCommands = getRoomBangCommands()
    if (customCommands[command]) {
      const entry = customCommands[command]
      const answer = replaceCustomPlaceholders(
        entry.message,
        argument,
        userId,
        entry
      )
      saveRoomBangCommands(customCommands)
      if (answer) {
        sendBangResponse(userId, isPrivate, answer)
      }
      return true
    }

    sendBangThumbDown(userId, isPrivate)
    return true
  } catch (error) {
    console.error(error)
    sendBangThumbDown(userId, isPrivate)
    return true
  }
}
