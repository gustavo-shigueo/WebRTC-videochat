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
// const mediaDevices = await navigator.mediaDevices.enumerateDevices()
let localUserStream = new MediaStream()
let localDisplayStream = new MediaStream()
let remoteUserStreamID = ''
let remoteDisplayStreamID = ''
let signallingChannel = null
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let localStreamSettings = {
	video: false,
	audio: true,
	sharing: false,
}

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
const [cameraBtn, muteBtn, shareBtn, hangupBtn] =
	document.querySelectorAll('.controls button')
const fullscreenToggles = document.querySelectorAll(
	'[data-function="fullscreen"]'
)

localUserVideo.muted = true
localDisplayVideo.muted = true
// localUserVideo.parentElement.style.display = 'none'
// localDisplayVideo.parentElement.style.display = 'none'

// remoteUserVideo.parentElement.style.display = 'none'
// remoteDisplayVideo.parentElement.style.display = 'none'

// A new remote track has benn added
peer.addEventListener('track', e => {
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
})

peer.addEventListener('connectionstatechange', () => {
	if (peer.connectionState === 'disconnected') location.pathname = '/'
})

const initializeSignallingChannel = () => {
	signallingChannel.onopen = async () => {
		socket.disconnect()

		signallingChannel.send(
			JSON.stringify({
				userStreamID: localUserStream.id,
				displayStreamID: localDisplayStream.id,
			})
		)
		document
			.querySelectorAll('.controls button')
			.forEach(el => el.removeAttribute('disabled'))
	}

	signallingChannel.onmessage = async e => {
		await sleep(0)
		const {
			sdp = null,
			candidate = null,
			userStreamID = '',
			displayStreamID = '',
		} = JSON.parse(e.data)

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

// Update the MediaStream object that contains the local user's
// microphone and webcam
const updateLocalUserStream = async ({ video, audio }) => {
	localUserVideo.parentElement.style.display = video ? 'block' : 'none'

	if (!video && !audio) return (localUserVideo.srcObject = null)
	localUserStream = await navigator.mediaDevices.getUserMedia({
		audio,
		video,
	})

	localUserVideo.srcObject = localUserStream
	localUserStream.getTracks().forEach(async track => {
		track.source = `User ${track.kind}`
		peer.addTrack(track, localUserStream)
	})
}

// Update the MediaStream object that contains the local user's
// screen share
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

	if (!sharing) return (localDisplayVideo.srcObject = null)

	const stream = await navigator.mediaDevices.getDisplayMedia({
		audio: true,
		video: true,
	})

	localDisplayStream.getTracks().forEach(track => localDisplayStream.removeTrack(track))

	stream.getTracks().forEach(track => localDisplayStream.addTrack(track))

	localDisplayVideo.srcObject = localDisplayStream
	localDisplayStream.getTracks().forEach(async track => {
		track.source = `Display ${track.kind}`
		peer.addTrack(track, localDisplayStream)
	})
}

// Toggles the local user's webcam or microphone when the respective
// button is pressed on the UI
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

	if (device === 'audio') return (track.enabled = !track.enabled)

	if (track) {
		track.stop()
		const [sender] = peer.getSenders().filter(sender => sender?.track?.id === track?.id)
		peer.removeTrack(sender)

		localUserStream.removeTrack(track)
		localUserVideo.parentElement.style.display = 'none'
		console.log({ sender, track })
		return
	}

	const stream = await navigator.mediaDevices.getUserMedia({ video: true })
	const [videoTrack] = stream.getVideoTracks()
	videoTrack.source = 'User video'
	localUserStream.addTrack(videoTrack)
	peer.addTrack(videoTrack, localUserStream)
	localUserVideo.parentElement.style.display = 'block'
}

// Toggles the local user's screen sharing
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

// Toggles a specific video element's fullscreen mode
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

// Leaves the call
const hangup = () => {
	if (
		[localUserStream, localDisplayStream].some(
			stream => stream.getVideoTracks().length > 0
		)
	) {
		if (cameraBtn.classList.contains('active')) cameraBtn.click()
		if (shareBtn.classList.contains('active')) shareBtn.click()
	}

	if (muteBtn.classList.contains('active')) muteBtn.click()

	document.querySelectorAll('[data-function="fullscreen"]').forEach(btn => {
		if (btn.classList.contains('active')) btn.click()
	})
	;[localUserStream, localDisplayStream].forEach(stream =>
		stream.getTracks().forEach(track => {
			track.stop()
			stream.removeTrack(track)
			peer.getSenders().forEach(sender => peer.removeTrack(sender))
		})
	)

	peer.close()

	location.pathname = '/'
}

// * Creates a call
const createCall = async () => {
	const callId = uuidV4()
	signallingChannel = peer.createDataChannel('signalling')
	await updateLocalUserStream(localStreamSettings)
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

// * Answers a call
const answerCall = async () => {
	const callId = answerCallInput.value

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

// Copies the call ID to the clipboard
const copyToClipboard = async ({ target: { value } }) => {
	if (!value) return

	const { state } = await navigator.permissions.query({
		name: 'clipboard-write',
	})

	if (state !== 'granted') return

	await navigator.clipboard.writeText(value)

	clipboardPopup.classList.add('active')
}

// Removes the popup that indicated the ID has been copied
const removePopup = () => {
	if (!clipboardPopup.classList.contains('active')) return
	setTimeout(() => clipboardPopup.classList.remove('active'), 1000)
}

// Handles renegotiation
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
	if (!document.fullscreenElement) fullscreenToggles.forEach(toggle => toggle.classList.remove('active'))
})

createCallBtn.addEventListener('click', createCall)
answerCallBtn.addEventListener('click', answerCall)

createCallInput.addEventListener('click', copyToClipboard)

clipboardPopup.addEventListener('transitionend', removePopup)

peer.addEventListener('negotiationneeded', renegotiate)
