/**
 * @author Gustavo Shigueo<gustavo.gsmn@gmail.com>
 * NOTE Install the comment anchors extension on VSCode to navigate through the sections easily
 * ======================= TABLE OF CONTENTS ======================= *
 *                                                                   *
 *    Global state                                                   *
 *    DOM Elements                                                   *
 *    Signalling channel event handlers                              *
 *    Managing local MediaStream objects                             *
 *    Remote MediaStreamTrackEvent handlers                          *
 *    Call negotiation                                               *
 *    Local call controls                                            *
 *    UI changes                                                     *
 *    UI eventListeners                                              *
 *    Document eventListeners                                        *
 *    RTCPeerConnection eventListeners                               *
 *    Initial socket.io interactions                                 *
 *                                                                   *
 * ================================================================= *
 */

// SECTION Global state
const servers = {
	iceServers: [
		{
			urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
		},
	],
}
const peer = new RTCPeerConnection(servers)
const socketServerURL = location.host.match(/gustavo-shigueo\.github\.io/)
	? 'wss://webrtc-videochat-socket-server.herokuapp.com'
	: `wss://${location.host.replace('5500', '3001')}`

const localUserStream = new MediaStream()
const localDisplayStream = new MediaStream()
const socket = io(socketServerURL)
const callId = location.search
const regExp = /^\?callId=[0-9a-f]{8}\-[0-9a-f]{4}\-4[0-9a-f]{3}\-[89ab][0-9a-f]{3}\-[0-9a-f]{12}$/

// NOTE Ensures the call has an ID
if (!callId.match(regExp)) location.search = `callId=${uuidV4()}`

/** @type {RTCDataChannel} */
let signallingChannel = null
let remoteUserStreamID = ''
let remoteDisplayStreamID = ''
let isSharing = false
// !SECTION

// SECTION DOM Elements
const localUserVideo = document.querySelector('.client [data-user-stream]')
const localDisplayVideo = document.querySelector('.client [data-display-stream]')
const remoteUserVideo = document.querySelector('.remote [data-user-stream]')
const remoteDisplayVideo = document.querySelector('.remote [data-display-stream]')
const controls = document.querySelectorAll('.controls button')
const [cameraBtn, muteBtn, shareBtn, hangupBtn] = controls
const fullscreenToggles = document.querySelectorAll('[data-function="fullscreen"]')
const { parentElement: localUserContainer } = localUserVideo
const { parentElement: localDisplayContainer } = localDisplayVideo
const { parentElement: remoteUserContainer } = remoteUserVideo
const { parentElement: remoteDisplayContainer } = remoteDisplayVideo
// !SECTION

// NOTE This function is declared at the top because it's called by line 104
/**
 * When the peer connection is closed, refresh the page
 * @param {Event} e
 */
const refreshPage = e => {
	if (e && peer.connectionState !== 'disconnected') return
	location.href = `https://${location.host}${location.pathname}`
}

// SECTION Signalling channel event handlers
/**
 * Handles the initial connection of the data channel that will handle renegotiations
 */
const signallingChannelConnection = () => {
	// Socket.io will no longer handle messaging since
	// the peers already have a way to communicate
	socket.emit('remove-call', callId)
	socket.disconnect()

	// Sends the local MediaStreams' IDs to the remote peer
	signallingChannel.send(
		JSON.stringify({
			userStreamID: localUserStream.id,
			displayStreamID: localDisplayStream.id,
		})
	)

	controls.forEach(el => el.removeAttribute('disabled'))
}

/**
 * Receives a message through the signalling server and decides what to do with it
 * @param {MessageEvent<RTCDataChannel>} e
 */
const handleSignallingMessage = async e => {
	const {
		sdp = null,
		candidate = null,
		userStreamID = '',
		displayStreamID = '',
		action,
	} = JSON.parse(e.data)

	if (action === 'disconnect') return refreshPage()

	if (userStreamID && displayStreamID) {
		remoteUserStreamID = userStreamID
		remoteDisplayStreamID = displayStreamID
		return
	}

	if (!sdp && !candidate) return

	try {
		if (!sdp) return await peer.addIceCandidate(new RTCIceCandidate(candidate))

		const offerDescription = new RTCSessionDescription(sdp)

		if (offerDescription.type !== 'offer') return await peer.setRemoteDescription(offerDescription)

		await peer.setRemoteDescription(offerDescription)
		const answerDescription = await peer.createAnswer()

		await peer.setLocalDescription(answerDescription)
		signallingChannel.send(JSON.stringify({ sdp: peer.localDescription }))

		return
	} catch (error) {
		console.log(error)
	}
}

/**
 * Sets up the eventListeners on the signalling channel
 */
const initializeSignallingChannel = () => {
	signallingChannel.addEventListener('open', signallingChannelConnection)
	signallingChannel.addEventListener('message', handleSignallingMessage)
}

/**
 * Handles renegotiation between the peers through the signalling channel
 * after the socket.io connection is shut down
 */
const renegotiate = async () => {
	if (!signallingChannel || signallingChannel?.readyState !== 'open') return
	const offer = await peer.createOffer()
	await peer.setLocalDescription(offer)
	signallingChannel.send(JSON.stringify({ sdp: peer.localDescription }))
}
// !SECTION

// SECTION Managing local MediaStream objects
/**
 * Creates the MediaStream object that contains the local user's
 * microphone and webcam.
 * By default, the webcam is off and the microphone is on
 */
const createLocalUserStream = async () => {
	// Webcam is off, so the webcam feed is hidden
	localUserVideo.parentElement.classList.add('hidden')

	// Creates a MediaStream
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: true,
		video: false,
	})

	// Adds the tracks from the MediaStream to the stream that will be sent
	// to the remote user
	stream.getTracks().forEach(track => localUserStream.addTrack(track))

	// Connects the stream to the webcam feed
	localUserVideo.srcObject = localUserStream

	// Adds tracks to the peer connection and binds them to the local MediaStream
	localUserStream.getTracks().forEach(track => {
		track.source = `User ${track.kind}`
		peer.addTrack(track, localUserStream)
	})
}

const toggleLocalUserAudio = active => {
	const [track] = localUserStream.getAudioTracks()
	track.enabled = active
}

const toggleLocalUserVideo = async active => {
	if (active) {
		// Creates a new video track from the webcam
		const stream = await navigator.mediaDevices.getUserMedia({ video: true })
		const [videoTrack] = stream.getVideoTracks()
		const { aspectRatio } = videoTrack.getSettings()

		const otherVideoFullscreen = remoteUserContainer.classList.contains('fullscreen')
		localUserContainer.classList.toggle('corner', otherVideoFullscreen)
		localUserContainer.classList.toggle('cover', aspectRatio >= 1.25)
		videoTrack.source = 'User video'

		// Adds the new track to the local MediaStream and to the peer connection
		localUserStream.addTrack(videoTrack)
		peer.addTrack(videoTrack, localUserStream)

		// Displays the webcam feed
		localUserVideo.parentElement.classList.remove('hidden')
		return
	}

	const [track] = localUserStream.getVideoTracks()

	// Remove the track from both the local MediaStream and the peer connection
	track.stop()
	const [sender] = peer.getSenders().filter(sender => sender?.track?.id === track?.id)
	peer.removeTrack(sender)

	localUserStream.removeTrack(track)

	// Hides the webcam feed and returns
	localUserContainer.classList.add('hidden')
	localUserContainer.classList.remove('cover')

	// Exit fullscreen if necessary
	if (!localUserContainer.classList.contains('fullscreen')) return
	await document.exitFullscreen()
}

/**
 * Updates the MediaStream object that contains the local user's
 * screen share
 * @param {boolean} sharing Wether or not the local user wants to share their screen
 */
const updateLocalDisplayStream = async sharing => {
	// Removes all the screen sharing related tracks from the peer connection
	peer
		.getSenders()
		.filter(({ track }) => {
			return track?.source === 'Display video' || track?.source === 'Display audio'
		})
		.forEach(sender => peer.removeTrack(sender))

	// Removes all of the old tracks from the local MediaStream
	// and disconnects it from its source to remove the browser's
	// screen share warning
	localDisplayStream.getTracks().forEach(track => {
		track.stop()
		localDisplayStream.removeTrack(track)
	})

	// Hides the screen share preview when the screen is not being shared
	localDisplayContainer.classList.toggle('hidden', !sharing)

	if (!sharing) {
		localDisplayVideo.srcObject = null

		// Exit fullscreen if necessary
		if (!localDisplayContainer.classList.contains('fullscreen')) return
		return await document.exitFullscreen()
	}

	/**
	 * The process below is done to preserve the local MediaStream's ID
	 * This is important because the signalling channel sends the ID
	 * to help the remote peer with separating the user stream (webcam + mic)
	 * and the display stream (screen sharing)
	 */

	/** @type {MediaStream} */
	const stream = await navigator.mediaDevices.getDisplayMedia({
		audio: true,
		video: true,
	})

	// Adds all the tracks from the new MediaStream into the local
	// MediaStream object
	stream.getTracks().forEach(track => localDisplayStream.addTrack(track))

	localDisplayVideo.srcObject = localDisplayStream

	// Adds the tracks to the peer connection
	localDisplayStream.getTracks().forEach(async track => {
		track.source = `Display ${track.kind}`
		peer.addTrack(track, localDisplayStream)
	})
}
// !SECTION

// SECTION Remote MediaStreamTrackEvent handlers
/**
 * Makes changes to the UI when the remote peer disbales one of their video tracks
 * @param {'user'|'display'} streamName
 * @param {'video'|'audio'} kind
 */
const removeRemoteTrack = async (streamName, kind) => {
	// Get references to the DOM Elements that will change
	const video = streamName === 'user' ? remoteUserVideo : remoteDisplayVideo
	const container = video.parentElement

	// Only change UI if handling a video track
	if (kind !== 'video') return

	// Hide the video feed and if needed, exit fullscreen
	container.classList.add('hidden')

	if (!container.classList.contains('fullscreen')) return
	await document.exitFullscreen()
}

/**
 * A new remote track has benn added
 * @param {RTCTrackEvent} e RTCTrackEventObject: Created when the remote user calls addTrack on the RTCPeerConnection
 */
const handleRemoteTrack = e => {
	const [stream] = e.streams

	// The stream being handled is the screen share stream
	if (stream.id === remoteDisplayStreamID) {
		stream.addEventListener('removetrack', event => removeRemoteTrack('display', event.track.kind))

		remoteDisplayVideo.srcObject = stream
		remoteDisplayContainer.classList.remove('hidden')
		return
	}

	// The stream being handled is the user stream
	stream.addEventListener('removetrack', event => removeRemoteTrack('user', event.track.kind))

	remoteUserVideo.srcObject = stream

	if (stream.getVideoTracks().length === 0) return
	const otherVideoFullscreen = localUserContainer.classList.contains('fullscreen')
	remoteUserContainer.classList.toggle('corner', otherVideoFullscreen)
	remoteUserContainer.classList.remove('hidden')
}
// !SECTION

// SECTION Call negotiation
/**
 * Creates a call
 */
const createCall = async () => {
	signallingChannel = peer.createDataChannel('signalling')
	await createLocalUserStream()
	initializeSignallingChannel()

	socket.emit('join', callId)

	peer.onicecandidate = e => {
		socket.emit('send-local-description-offer', peer.localDescription, callId)
		e.candidate && socket.emit('send-candidate', e.candidate, callId)
	}

	const offerDescription = await peer.createOffer()
	await peer.setLocalDescription(offerDescription)

	socket.on('receive-remote-description-answer', async answer => {
		if (peer.remoteDescription || peer.signalingState === 'stable') return
		await peer.setRemoteDescription(answer)
	})
}

/**
 * Answers a call created by another user
 */
const answerCall = async () => {
	await createLocalUserStream()

	peer.addEventListener('datachannel', e => {
		signallingChannel = e.channel
		initializeSignallingChannel()
	})

	socket.emit('answer-call', callId)
	socket.on('receive-remote-description-offer', async offer => {
		peer.onicecandidate = e => {
			socket.emit('send-local-description-answer', peer.localDescription, callId)
			e.candidate && socket.emit('send-candidate', e.candidate, callId)
		}

		await peer.setRemoteDescription(offer)

		const answerDescription = await peer.createAnswer()
		await peer.setLocalDescription(answerDescription)
	})
}
// !SECTION

// SECTION Local call controls
/**
 * Toggles the local user's webcam or microphone when the respective
 * button is pressed on the UI
 * @param {MouseEvent} e The click event
 * @param {string} device Which media source the use wants to toggle
 */
const toggleCameraOrMic = (e, device) => {
	// Handles the UI changes that happen when the camera or mute buttons are clicked
	const active = e.target.classList.toggle('active')
	const tooltips = {
		audio: ['Unmute', 'Mute'],
		video: ['Disable camera', 'Enable camera'],
	}

	e.target.setAttribute('disabled', 'true')
	e.target.setAttribute('aria-label', tooltips[device][active ? 0 : 1])

	if (device === 'audio') {
		toggleLocalUserAudio(!active)
		e.target.removeAttribute('disabled')
		return
	}

	toggleLocalUserVideo(active).then(() => e.target.removeAttribute('disabled'))
}

/**
 * Toggles the local user's screen sharing
 */
const toggleSharing = async () => {
	// UI updates on the click event
	const active = shareBtn.classList.toggle('active')
	shareBtn.setAttribute('aria-label', active ? 'Stop sharing' : 'Share screen')

	// Updates the isSharing state
	isSharing = !isSharing

	try {
		// Toggles the screen sharing
		await updateLocalDisplayStream(isSharing)
	} catch (error) {
		// An error will be thrown if the user selects 'cancel' when prompted
		// to select a window to share (there may be other cases, but they will be handled
		// the same way)

		// In this situation, isSharing will always be false
		isSharing = false

		// Undoes the changes to the UI and runs updateLocalDisplayStream to ensure there are
		// no tracks running
		shareBtn.classList.remove('active')
		cameraBtn.removeAttribute('disabled')
		shareBtn.setAttribute('aria-label', 'Share screen')
		await updateLocalDisplayStream(isSharing)
	}
}

/**
 * Leaves the call
 */
const hangup = () => {
	signallingChannel.send(JSON.stringify({ action: 'disconnect' }))
	peer.close()
	refreshPage()
}
// !SECTION

// SECTION UI changes
// TODO Allows the user to drag the corner video feed around
/**
 * @param {MouseEvent} e
 */
const dragStartHandler = e => {
	/** @type {HTMLDivElement} */
	const target = e.target.tagName === 'VIDEO' ? e.target.parentElement : e.target

	if (!target.classList.contains('corner')) return
	let { clientX: initialX, clientY: initialY } = e

	/**
	 * @param {DragEvent} event
	 */
	const dragCornerVideo = event => {
		const { clientX, clientY } = event

		const left = target.offsetLeft - (initialX - clientX)
		const top = target.offsetTop - (initialY - clientY)

		initialX = event.clientX
		initialY = event.clientY

		target.style = `--top: ${top}px; --left: ${left}px;`
	}

	/**
	 * Removes the eventListeners from the document
	 */
	const dropCornerVideo = () => {
		const { innerWidth, innerHeight } = window
		const { offsetLeft, offsetTop } = target
		const { width, height } = target.getBoundingClientRect()

		const isTop = offsetTop < innerHeight - (height + offsetTop)
		const isLeft = offsetLeft < innerWidth - (width + offsetLeft)

		const left = isLeft ? '2rem' : `calc(75vw - 2rem)`
		const top = isTop ? '2rem' : `calc(100vh - ${height}px - 5rem)`

		target.style = `--top: ${top}; --left: ${left};`
		target.classList.add('drag-transition')

		document.removeEventListener('mousemove', dragCornerVideo)
		document.removeEventListener('mouseup', dropCornerVideo)
	}

	// Adding event listeners to the document
	document.addEventListener('mousemove', dragCornerVideo)
	document.addEventListener('mouseup', dropCornerVideo)
}

/**
 * Removes the transition style from the corner video
 * @param {TransitionEvent} e
 */
const removeTransition = e => e.target.classList.remove('drag-transition')

/**
 * Decides wether the video's object-fit should be contain or cover
 * @param {Event} e
 */
const setObjectFit = e => {
	/** @type {HTMLVideoElement} */
	const element = e.target

	/** @type {MediaStreamTrack[]} */
	const [track] = element.srcObject?.getVideoTracks()

	const { aspectRatio } = track?.getSettings?.() ?? { aspectRatio: 0 }

	const cover = element.parentElement.classList.toggle('cover', aspectRatio >= 1.25)
	if (cover) return
	element.parentElement.style === `--aspect-ratio: ${aspectRatio}`
}

/**
 * Shows the call controls when you mmove the mouse or click in fullscreen mode
 */
const showControlsFullscreen = () => {
	const e = document.querySelector('.controls')
	e.classList.remove('hide-controls')
	setTimeout(() => !!document.fullscreenElement && e.classList.add('hide-controls'), 500)
}

/**
 * Makes UI changes when exiting fullscreen mode
 */
const fullscreenChangeHandler = () => {
	const isFullscreen = !!document.fullscreenElement
	const controlsContainer = document.querySelector('.controls')
	controlsContainer.classList.toggle('hide-controls', isFullscreen)

	if (isFullscreen) {
		document.addEventListener('mousemove', showControlsFullscreen)
		document.addEventListener('click', showControlsFullscreen)
		return
	}
	
	document.removeEventListener('mousemove', showControlsFullscreen)
	document.removeEventListener('click', showControlsFullscreen)

	document.querySelectorAll('video').forEach(e => {
		e.parentElement.classList.remove('corner', 'fullscreen')
	})

	fullscreenToggles.forEach(toggle => toggle.classList.remove('active'))
}

/**
 * Toggles a specific video element's fullscreen mode
 * @param {MouseEvent} e The click event
 */
const toggleFullscreen = async e => {
	/** @type {HTMLElement} */
	const targetIsContainer = e.target.classList.contains('.video-container')

	const container = targetIsContainer ? e.target : e.target.closest('.video-container')

	if (container.classList.contains('corner')) return

	const video = container.querySelector('video')
	const active = e.target.classList.toggle('active')
	container.classList.toggle('fullscreen')

	if (!active) {
		document.querySelectorAll('video').forEach(e => {
			if (e.srcObject?.getVideoTracks()?.length === 0 || !e.srcObject) return
			e.parentElement.classList.remove('hidden', 'corner')
		})

		return await document.exitFullscreen()
	}

	document
		.querySelectorAll('video')
		.forEach(({ parentElement: p }) =>
			p.classList.toggle('hidden', !p.classList.contains('fullscreen'))
		)
	await document.body.requestFullscreen()

	if (!video.hasAttribute('data-user-stream')) return

	const cornerVideo = container.classList.contains('client') ? remoteUserVideo : localUserVideo

	/** @type {MediaStream} */
	const cornerStream = cornerVideo.srcObject
	const [videoTrack] = cornerStream.getVideoTracks()

	if (!videoTrack) return

	cornerVideo.parentElement.classList.add('corner')
	cornerVideo.parentElement.classList.remove('hidden')
}
// !SECTION

// SECTION UI eventListeners
shareBtn.addEventListener('click', toggleSharing)
cameraBtn.addEventListener('click', e => toggleCameraOrMic(e, 'video'))
muteBtn.addEventListener('click', e => toggleCameraOrMic(e, 'audio'))
hangupBtn.addEventListener('click', hangup)
fullscreenToggles.forEach(el => el.addEventListener('click', toggleFullscreen))
remoteUserVideo.addEventListener('loadedmetadata', setObjectFit)
localUserContainer.addEventListener('mousedown', dragStartHandler)
remoteUserContainer.addEventListener('mousedown', dragStartHandler)
localUserContainer.addEventListener('transitionend', removeTransition)
remoteUserContainer.addEventListener('transitionend', removeTransition)
localUserContainer.addEventListener('dblclick', toggleFullscreen)
remoteUserContainer.addEventListener('dblclick', toggleFullscreen)
// !SECTION

// SECTION Document eventListeners
document.addEventListener('fullscreenchange', fullscreenChangeHandler)
document.addEventListener('beforeunload', hangup)
document.addEventListener('resize', console.log)
// !SECTION

// SECTION RTCPeerConnection eventListeners
peer.addEventListener('negotiationneeded', renegotiate)
peer.addEventListener('track', handleRemoteTrack)
peer.addEventListener('connectionstatechange', refreshPage)
// !SECTION

// SECTION Initial socket.io interactions
socket.on('connect', () => {
	socket.emit('check-for-call', callId)
	socket.on('check-result', result => (result ? answerCall() : createCall()))
})

socket.on('receive-candidate', candidate => peer.addIceCandidate(candidate))
// !SECTION
