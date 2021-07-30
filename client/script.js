const servers = {
	iceServers: [
		{
			urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
		},
	],
}

const socketServerURL = location.host.match(/gustavo-shigueo.github.io/)
	? 'wss://webrtc-videochat-socket-server.herokuapp.com'
	: `wss://${location.host.replace('5500', '3001')}`

// Global State
const peer = new RTCPeerConnection(servers)
const socket = io(socketServerURL)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const callId = location.search
const callIdRegExp =
	/^\?callId=[0-9a-f]{8}\-[0-9a-f]{4}\-4[0-9a-f]{3}\-[89ab][0-9a-f]{3}\-[0-9a-f]{12}$/

if (!callId.match(callIdRegExp)) location.search = `callId=${uuidV4()}`

let localUserStream = new MediaStream()
let localDisplayStream = new MediaStream()
let remoteUserStreamID = ''
let remoteDisplayStreamID = ''
let isSharing = false

/**
 * @type {RTCDataChannel}
 */
let signallingChannel = null

// DOM Elements
const localVideoGroup = document.querySelector('.client').parentElement
const localUserVideo = document.querySelector('.client [data-user-stream]')
const localDisplayVideo = document.querySelector(
	'.client [data-display-stream]'
)
const remoteUserVideo = document.querySelector('.remote [data-user-stream]')
const remoteDisplayVideo = document.querySelector(
	'.remote [data-display-stream]'
)
const controls = document.querySelectorAll('.controls button')
const [cameraBtn, muteBtn, shareBtn, hangupBtn] = controls
const fullscreenToggles = document.querySelectorAll(
	'[data-function="fullscreen"]'
)

localUserVideo.muted = true
localDisplayVideo.muted = true
localUserVideo.parentElement.classList.add('hidden')
localDisplayVideo.parentElement.classList.add('hidden')

remoteUserVideo.parentElement.classList.add('hidden')
remoteDisplayVideo.parentElement.classList.add('hidden')

/**
 * A new remote track has benn added
 * @param {RTCTrackEvent} e RTCTrackEventObject: Created when the remote user calls addTrack on the RTCPeerConnection
 */
const handleRemoteTrack = e => {
	const [stream] = e.streams

	// The stream being handled is the screen share stream
	if (stream.id === remoteDisplayStreamID) {
		stream.addEventListener('removetrack', () => {
			remoteDisplayVideo.parentElement.classList.add('hidden')
		})

		remoteDisplayVideo.srcObject = stream
		remoteDisplayVideo.parentElement.classList.remove('hidden')
		return
	}

	// The stream being handled is the user stream
	stream.addEventListener('removetrack', ({ track: { kind } }) => {
		if (kind === 'video') remoteUserVideo.parentElement.classList.add('hidden')
	})

	remoteUserVideo.srcObject = stream

	if (stream.getVideoTracks().length > 0) {
		remoteUserVideo.parentElement.classList.remove('hidden')
	}
}

/**
 * When the peer connection is closed, refresh the page
 * @param {Event} e
 */
const disconnect = e => {
	if (!e || (e && peer.connectionState === 'disconnected'))
		location.href = `https://${location.host}`
}

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
 * Sets up the eventListeners on the signalling channel
 */
const initializeSignallingChannel = () => {
	signallingChannel.addEventListener('open', () =>
		signallingChannelConnection()
	)

	signallingChannel.onmessage = async e => {
		await sleep(0)
		const {
			sdp = null,
			candidate = null,
			userStreamID = '',
			displayStreamID = '',
			action,
		} = JSON.parse(e.data)

		if (action === 'disconnect') return disconnect()

		if (userStreamID && displayStreamID) {
			remoteUserStreamID = userStreamID
			remoteDisplayStreamID = displayStreamID
			return
		}

		if (!sdp && !candidate) return

		try {
			if (sdp) {
				const offerDescription = new RTCSessionDescription(sdp)

				if (offerDescription.type !== 'offer') {
					return await peer.setRemoteDescription(offerDescription)
				}

				await peer.setRemoteDescription(offerDescription)
				const answerDescription = await peer.createAnswer()

				await peer.setLocalDescription(answerDescription)
				signallingChannel.send(JSON.stringify({ sdp: peer.localDescription }))

				return
			}

			await peer.addIceCandidate(new RTCIceCandidate(candidate))
		} catch (error) {
			console.log(error)
		}
	}
}

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
 * @param {Object} settings Wether or not the local user wants to share their screen
 * @param {boolean} settings.sharing
 */
const updateLocalDisplayStream = async sharing => {
	// Removes all the screen sharing related tracks from the peer connection
	peer
		.getSenders()
		.filter(({ track }) => {
			return (
				track?.source === 'Display video' || track?.source === 'Display audio'
			)
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
		return
	}

	/**
	 * The process below is done to preserve the local MediaStream's ID
	 * This is important because the signalling channel sends the ID
	 * to help the remote peer with separating the user stream (webcam + mic)
	 * and the display stream (screen sharing)
	 */

	/**
	 * Initializes a new MediaStream object for the screen share
	 * @type {MediaStream}
	 */
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
		device === 'audio'
			? localUserStream.getAudioTracks()
			: localUserStream.getVideoTracks()

	// If the track exists
	if (track) {
		// Toggle the track
		track.enabled = !track.enabled

		// If it's an audio track, return
		if (device === 'audio') return

		// Remove the track from both the local MediaStream and the peer connection
		track.stop()
		const [sender] = peer
			.getSenders()
			.filter(sender => sender?.track?.id === track?.id)
		peer.removeTrack(sender)

		localUserStream.removeTrack(track)

		// Hides the webcam feed and returns
		localUserVideo.parentElement.classList.add('hidden')
		return
	}

	// Creates a new video track from the webcam
	const stream = await navigator.mediaDevices.getUserMedia({ video: true })
	const [videoTrack] = stream.getVideoTracks()
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
 * Toggles a specific video element's fullscreen mode
 * @param {MouseEvent} e The click event
 */
const toggleFullscreen = async e => {
	/**
	 * @type {HTMLElement}
	 */
	const video = e.target.closest('.video-container').querySelector('video')
	const active = e.target.classList.toggle('active')
	video.parentElement.classList.toggle('fullscreen')

	if (active) {
		document
			.querySelectorAll('video')
			.forEach(({ parentElement: p }) => p.classList.toggle('hidden', !p.classList.contains('fullscreen')))
		await document.body.requestFullscreen()

		if (video.hasAttribute('data-user-stream')) {
			const cornerVideo = video.parentElement.classList.contains('client')
				? remoteUserVideo
				: localUserVideo

			cornerVideo.parentElement.classList.add('corner')
			cornerVideo.parentElement.classList.remove('hidden')
		}
		return
	}

	document
		.querySelectorAll('video')
		.forEach(e => {
			if (e.srcObject?.getVideoTracks()?.length === 0 || !e.srcObject) return
			e.parentElement.classList.remove('hidden', 'corner')
		})
	await document.exitFullscreen()
}

/**
 * Leaves the call
 */
const hangup = () => {
	signallingChannel.send(JSON.stringify({ action: 'disconnect' }))
	peer.close()
	disconnect()
	location.href = 'https://gustavo-shigueo.github.io/WebRTC-videochat'
}

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
		if (peer.remoteDescription) return
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
			socket.emit(
				'send-local-description-answer',
				peer.localDescription,
				callId
			)
			e.candidate && socket.emit('send-candidate', e.candidate, callId)
		}

		await peer.setRemoteDescription(offer)

		const answerDescription = await peer.createAnswer()
		await peer.setLocalDescription(answerDescription)
	})
}

socket.on('receive-candidate', candidate => peer.addIceCandidate(candidate))

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

// Setting up the event listeners
shareBtn.addEventListener('click', toggleSharing)

cameraBtn.addEventListener('click', e => toggleCameraOrMic(e, 'video'))
muteBtn.addEventListener('click', e => toggleCameraOrMic(e, 'audio'))
hangupBtn.addEventListener('click', hangup)

fullscreenToggles.forEach(elem =>
	elem.addEventListener('click', toggleFullscreen)
)

document
	.querySelectorAll('button')
	.forEach(btn => btn.addEventListener('click', e => e.target.blur()))

document.addEventListener('fullscreenchange', () => {
	if (document.fullscreenElement) return
	document.querySelectorAll('video').forEach(e => {
		/**
		 * @type {CSSStyleDeclaration}
		 */
		e.parentElement.classList.remove('corner', 'fullscreen')
	})
	document
		.querySelectorAll('[data-function="fullscreen"]')
		.forEach(e => e.removeAttribute('style'))
	fullscreenToggles.forEach(toggle => toggle.classList.remove('active'))
})

peer.addEventListener('negotiationneeded', renegotiate)
peer.addEventListener('track', handleRemoteTrack)
peer.addEventListener('connectionstatechange', disconnect)

// Initial socket.io interactions to start a call
socket.on('connect', () => {
	socket.emit('check-for-call', callId)
	socket.on('check-result', result => (result ? answerCall() : createCall()))
})
