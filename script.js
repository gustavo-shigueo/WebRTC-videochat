const servers = {
	iceServers: [
		{
			urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
		},
	],
}

// Global State
const peer = new RTCPeerConnection(servers)
const socket = io(`wss://${location.host.replace('5500', '3001')}`)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let localUserStream = new MediaStream()
let localDisplayStream = new MediaStream()
let remoteUserStreamID = ''
let remoteDisplayStreamID = ''
let localStreamSettings = {
	video: false,
	audio: true,
	sharing: false,
}
/**
 * @type {RTCDataChannel}
 */
let signallingChannel = null

// DOM Elements
const clipboardPopup = document.querySelector('.copy-popup')
const createCallInput = document.querySelector('#call-id')
const answerCallInput = document.querySelector('#answer-id')
const createCallBtn = document.querySelector('[data-function="create-call"]')
const answerCallBtn = document.querySelector('[data-function="answer-call"]')
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
localUserVideo.parentElement.style.display = 'none'
localDisplayVideo.parentElement.style.display = 'none'

remoteUserVideo.parentElement.style.display = 'none'
remoteDisplayVideo.parentElement.style.display = 'none'

/**
 * A new remote track has benn added
 * @param {RTCTrackEvent} e RTCTrackEventObject: Created when the remote user calls addTrack on the RTCPeerConnection
 */
const handleRemoteTrack = e => {
	const [stream] = e.streams

	// The stream being handled is the screen share stream
	if (stream.id === remoteDisplayStreamID) {
		stream.addEventListener(
			'removetrack',
			() => (remoteDisplayVideo.parentElement.style.display = 'none')
		)
		remoteDisplayVideo.srcObject = stream
		remoteDisplayVideo.parentElement.removeAttribute('style')
		return
	}

	// The stream being handled is the user stream
	stream.addEventListener('addtrack', e => {
		if (e.track.kind === 'video')
			remoteUserVideo.parentElement.removeAttribute('style')
	})
	stream.addEventListener('removetrack', e => {
		if (e.track.kind === 'video')
			remoteUserVideo.parentElement.style.display = 'none'
	})

	remoteUserVideo.srcObject = stream
}

/**
 * When the peer connection is closed, refresh the page
 * @param {Event} [e]
 */
const disconnect = e => {
	if (!e || (e && peer.connectionState === 'disconnected'))
		location.pathname = '/'
}

/**
 * Handles the initial connection of the data channel that will handle renegotiations
 */
const signallingChannelConnection = () => {
	// Socket.io will no longer handle messaging since
	// the peers already have a way to communicate
	socket.disconnect()

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
 * microphone and webcam
 * @param {Object} setting Wether or not the local user wants their microphone and webcam on
 * @param {boolean} settings.video
 * @param {boolean} settings.audio
 */
const createLocalUserStream = async ({ video = false, audio = true }) => {
	localUserVideo.parentElement.style.display = video ? 'block' : 'none'

	if (!video && !audio) {
		localUserVideo.srcObject = null
		return
	}

	const stream = await navigator.mediaDevices.getUserMedia({
		audio,
		video,
	})

	stream.getTracks().forEach(track => localUserStream.addTrack(track))

	localUserVideo.srcObject = localUserStream
	localUserStream.getTracks().forEach(track => {
		track.source = `User ${track.kind}`
		peer.addTrack(track, localUserStream)
	})
}

/**
 * Update the MediaStream object that contains the local user's
 * screen share
 * @param {Object} settings Wether or not the local user wants to share their screen
 * @param {boolean} settings.sharing
 */
const updateLocalDisplayStream = async ({ sharing }) => {
	peer
		.getSenders()
		.filter(({ track }) => {
			return (
				track?.source === 'Display video' || track?.source === 'Display audio'
			)
		})
		.forEach(sender => peer.removeTrack(sender))
	localDisplayVideo.parentElement.style.display = sharing ? 'block' : 'none'

	if (!sharing) {
		localDisplayVideo.srcObject = null
		return
	}

	/**
	 * @type {MediaStream}
	 */
	const stream = await navigator.mediaDevices.getDisplayMedia({
		audio: true,
		video: true,
	})

	localDisplayStream
		.getTracks()
		.forEach(track => localDisplayStream.removeTrack(track))

	stream.getTracks().forEach(track => localDisplayStream.addTrack(track))

	localDisplayVideo.srcObject = localDisplayStream
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
	const active = e.target.classList.toggle('active')
	const tooltips = {
		audio: ['Unmute', 'Mute'],
		video: ['Disable camera', 'Enable camera'],
	}

	e.target.setAttribute('aria-label', tooltips[device][active ? 0 : 1])

	localStreamSettings = {
		...localStreamSettings,
		[device]: !localStreamSettings[device],
	}

	const [track] =
		device === 'audio'
			? localUserStream.getAudioTracks()
			: localUserStream.getVideoTracks()

	if (device === 'audio') {
		track.enabled = !track.enabled
		return
	}

	if (track) {
		track.stop()
		const [sender] = peer
			.getSenders()
			.filter(sender => sender?.track?.id === track?.id)
		peer.removeTrack(sender)

		localUserStream.removeTrack(track)
		localUserVideo.parentElement.style.display = 'none'
		return
	}

	const stream = await navigator.mediaDevices.getUserMedia({ video: true })
	const [videoTrack] = stream.getVideoTracks()
	videoTrack.source = 'User video'
	localUserStream.addTrack(videoTrack)
	peer.addTrack(videoTrack, localUserStream)
	localUserVideo.parentElement.style.display = 'block'
}

/**
 * Toggles the local user's screen sharing
 */
const toggleSharing = async () => {
	const active = shareBtn.classList.toggle('active')
	shareBtn.setAttribute('aria-label', active ? 'Stop sharing' : 'Share screen')

	localStreamSettings = {
		...localStreamSettings,
		sharing: !localStreamSettings.sharing,
	}

	try {
		await updateLocalDisplayStream(localStreamSettings)
	} catch (error) {
		if (localDisplayStream.getVideoTracks().length === 0) {
			localStreamSettings = {
				...localStreamSettings,
				sharing: false,
			}

			shareBtn.classList.remove('active')
			cameraBtn.removeAttribute('disabled')
			shareBtn.setAttribute('aria-label', 'Share screen')
			await updateLocalDisplayStream(localStreamSettings)
		}
	}
}

/**
 * Toggles a specific video element's fullscreen mode
 * @param {MouseEvent} e The click event
 */
const toggleFullscreen = async e => {
	const video = e.target.closest('.video-container').querySelector('video')
	const active = e.target.classList.toggle('active')

	if (active) {
		await document.body.requestFullscreen()
		video.style = 'position: fixed; inset: 0'
		e.target.style = 'z-index: 2147483647; position: fixed;'
		return
	}

	e.target.removeAttribute('style')
	video.removeAttribute('style')
	await document.exitFullscreen()
}

/**
 * Leaves the call
 */
const hangup = () => {
	signallingChannel.send(JSON.stringify({ action: 'disconnect' }))
	peer.close()
	disconnect()
	location.pathname = '/'
}

/**
 * Creates a call
 */
const createCall = async () => {
	const callId = uuidV4()
	signallingChannel = peer.createDataChannel('signalling')
	await createLocalUserStream(localStreamSettings)
	initializeSignallingChannel()
	createCallInput.value = callId

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
	const callId = answerCallInput.value
	await createLocalUserStream(localStreamSettings)

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
 * Copies the call ID to the clipboard
 * @param {Object} event The click event on the 'Create a call' input
 * @param {Object} event.target
 * @param {string} event.target.value
 */
const copyToClipboard = async ({ target: { value } }) => {
	if (!value) return

	const { state } = await navigator.permissions.query({
		name: 'clipboard-write',
	})

	if (state !== 'granted') return

	await navigator.clipboard.writeText(value)

	clipboardPopup.classList.add('active')
}

/**
 * Removes the popup that indicated the ID has been copied
 */
const removePopup = () => {
	if (!clipboardPopup.classList.contains('active')) return
	setTimeout(() => clipboardPopup.classList.remove('active'), 1000)
}

/**
 * Handles renegotiation
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

document.addEventListener('fullscreenchange', e => {
	if (!document.fullscreenElement)
		fullscreenToggles.forEach(toggle => toggle.classList.remove('active'))
})

createCallBtn.addEventListener('click', createCall)
answerCallBtn.addEventListener('click', answerCall)

createCallInput.addEventListener('click', copyToClipboard)

clipboardPopup.addEventListener('transitionend', removePopup)

peer.addEventListener('negotiationneeded', renegotiate)
peer.addEventListener('track', handleRemoteTrack)
peer.addEventListener('connectionstatechange', disconnect)
