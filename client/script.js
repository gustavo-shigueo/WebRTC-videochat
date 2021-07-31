/**
 * @author Gustavo Shigueo<gustavo.gsmn@gmail.com>
 *
 * ======================= TABLE OF CONTENTS ======================= *
 *                                                                   *
 *    Global State.......................................line 21     *
 *    DOM Elements.......................................line 50     *
 *    Signalling channel event handlers..................line 69     *
 *    Managing local MediaStream objects.................line 152    *
 *    Remote MediaStreamTrackEvent handlers..............line 242    *
 *    Call negotiation...................................line 295    *
 *    Local call controls................................line 346    *
 *    UI changes.........................................line 450    *
 *    UI eventListeners..................................line 523    *
 *    Document eventListeners............................line 532    *
 *    RTCPeerConnection eventListeners...................line 537    *
 *    Initial socket.io interactions.....................line 543    *
 *                                                                   *
 * ================================================================= *
 */

// ? Global State
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

// Ensures the call has an ID
if (!callId.match(regExp)) location.search = `callId=${uuidV4()}`

/** @type {RTCDataChannel} */
let signallingChannel = null
let remoteUserStreamID = ''
let remoteDisplayStreamID = ''
let isSharing = false

// ? DOM Elements
const localUserVideo = document.querySelector('.client [data-user-stream]')
const localDisplayVideo = document.querySelector('.client [data-display-stream]')
const remoteUserVideo = document.querySelector('.remote [data-user-stream]')
const remoteDisplayVideo = document.querySelector('.remote [data-display-stream]')
const controls = document.querySelectorAll('.controls button')
const [cameraBtn, muteBtn, shareBtn, hangupBtn] = controls
const fullscreenToggles = document.querySelectorAll('[data-function="fullscreen"]')

// This function is declared at the top because it's called by handleSignallingMessage
/**
 * When the peer connection is closed, refresh the page
 * @param {Event} e
 */
const refreshPage = e => {
	if (e && peer.connectionState !== 'disconnected') return
	location.href = `https://${location.host}${location.pathname}`
}

// ? Signalling channel event handlers

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

// ? Managing local MediaStream objects

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
	localDisplayVideo.parentElement.classList.toggle('hidden', !sharing)

	if (!sharing) {
		localDisplayVideo.srcObject = null

		// Exit fullscreen if necessary
		if (!localDisplayVideo.parentElement.classList.contains('fullscreen')) return
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

// ? Remote MediaStreamTrackEvent handlers

/**
 * Makes changes to the UI when the remote peer disbales one of their video tracks
 * @param {'user'|'display'} streamName
 * @param {'video'|'audio'} kind
 */
const removeRemoteTrack = async (streamName, kind) => {
	/**
	 * Get references to the DOM Elements that will change
	 */
	const video = streamName === 'user' ? remoteUserVideo : remoteDisplayVideo
	const container = video.parentElement

	/**
	 * Only change if handling a video track
	 */
	if (kind !== 'video') return

	/**
	 * Hide the video feed and if needed, exit fullscree
	 */
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
		stream.addEventListener('removetrack', () => removeRemoteTrack('display', 'video'))

		remoteDisplayVideo.srcObject = stream
		remoteDisplayVideo.parentElement.classList.remove('hidden')
		return
	}

	// The stream being handled is the user stream
	stream.addEventListener('removetrack', e => removeRemoteTrack('user', e.track.kind))

	remoteUserVideo.srcObject = stream

	if (stream.getVideoTracks().length === 0) return
	remoteUserVideo.parentElement.classList.remove('hidden')
}

// ? Call negotiation

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

// Local call controls

/**
 * Toggles the local user's webcam or microphone when the respective
 * button is pressed on the UI
 * @param {MouseEvent} e The click event
 * @param {string} device Which media source the use wants to toggle
 */
const toggleCameraOrMic = async (e, device) => {
	// Handles the UI changes that happen when the camera or mute buttons are clicked
	const active = e.target.classList.toggle('active')
	const tooltips = {
		audio: ['Unmute', 'Mute'],
		video: ['Disable camera', 'Enable camera'],
	}

	e.target.setAttribute('aria-label', tooltips[device][active ? 0 : 1])

	// Gets the track that will be toggled
	const [track] =
		device === 'audio' ? localUserStream.getAudioTracks() : localUserStream.getVideoTracks()

	// If the track exists
	if (track) {
		// Toggle the track
		track.enabled = !track.enabled

		// If it's an audio track, return
		if (device === 'audio') return

		// Remove the track from both the local MediaStream and the peer connection
		track.stop()
		const [sender] = peer.getSenders().filter(sender => sender?.track?.id === track?.id)
		peer.removeTrack(sender)

		localUserStream.removeTrack(track)

		// Hides the webcam feed and returns
		localUserVideo.parentElement.classList.add('hidden')
		localUserVideo.parentElement.classList.remove('cover')

		// Exit fullscreen if necessary
		if (!localUserVideo.parentElement.classList.contains('fullscreen')) return
		await document.exitFullscreen()

		return
	}

	// Creates a new video track from the webcam
	const stream = await navigator.mediaDevices.getUserMedia({ video: true })
	const [videoTrack] = stream.getVideoTracks()
	const { aspectRatio } = videoTrack.getSettings()

	localUserVideo.parentElement.classList.toggle('cover', aspectRatio >= 1.25)
	videoTrack.source = 'User video'

	// Adds the new track to the local MediaStream and to the peer connection
	localUserStream.addTrack(videoTrack)
	peer.addTrack(videoTrack, localUserStream)

	// Displays the webcam feed
	localUserVideo.parentElement.classList.remove('hidden')
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

// ? UI changes

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

	element.parentElement.classList.toggle('cover', aspectRatio >= 1.25)
}

/**
 * Makes UI changes when exiting fullscreen mode
 */
const exitFullscreen = () => {
	if (document.fullscreenElement) return

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
	const video = e.target.closest('.video-container').querySelector('video')
	const active = e.target.classList.toggle('active')
	video.parentElement.classList.toggle('fullscreen')

	if (!active) {
		document.querySelectorAll('video').forEach(e => {
			if (e.srcObject?.getVideoTracks()?.length === 0 || !e.srcObject) return
			e.parentElement.classList.remove('hidden')
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

	const cornerVideo = video.parentElement.classList.contains('client')
		? remoteUserVideo
		: localUserVideo

	/** @type {MediaStream} */
	const cornerStream = cornerVideo.srcObject
	const [videoTrack] = cornerStream.getVideoTracks()

	if (!videoTrack) return

	cornerVideo.parentElement.classList.add('corner')
	cornerVideo.parentElement.classList.remove('hidden')
}

// ? UI eventListeners

shareBtn.addEventListener('click', toggleSharing)
cameraBtn.addEventListener('click', e => toggleCameraOrMic(e, 'video'))
muteBtn.addEventListener('click', e => toggleCameraOrMic(e, 'audio'))
hangupBtn.addEventListener('click', hangup)
fullscreenToggles.forEach(el => el.addEventListener('click', toggleFullscreen))
remoteUserVideo.addEventListener('loadedmetadata', setObjectFit)

// ? Document eventListeners

document.addEventListener('fullscreenchange', exitFullscreen)
document.addEventListener('beforeunload', hangup)

// ? RTCPeerConnection eventListeners

peer.addEventListener('negotiationneeded', renegotiate)
peer.addEventListener('track', handleRemoteTrack)
peer.addEventListener('connectionstatechange', refreshPage)

// ? Initial socket.io interactions

socket.on('connect', () => {
	socket.emit('check-for-call', callId)
	socket.on('check-result', result => (result ? answerCall() : createCall()))
})

socket.on('receive-candidate', candidate => peer.addIceCandidate(candidate))
