const servers = {
	iceServers: [
		{
			urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
		},
	],
}

// Global State
const peer = new RTCPeerConnection(servers)
const socket = io('wss://3001-chocolate-fox-weyzytiv.ws-us10.gitpod.io')
// const mediaDevices = await navigator.mediaDevices.enumerateDevices()
let localUserStream = new MediaStream()
let localDisplayStream = new MediaStream()
let remoteUserStream = new MediaStream()
let remoteDisplayStream = new MediaStream()
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
const remoteVideoGroup = document.querySelector('.remote')
const localUserVideo = document.querySelector('.client [data-user-stream]')
const localDisplayVideo = document.querySelector(
	'.client [data-display-stream]'
)
const remoteUserVideo = document.querySelector('.remote [data-user-stream]')
const remoteDisplayVideo = document.querySelector(
	'.remote [data-remote-stream]'
)
const [cameraBtn, muteBtn, shareBtn, hangupBtn] =
	document.querySelectorAll('.controls button')
const fullscreenToggles = document.querySelectorAll(
	'[data-function="fullscreen"]'
)

localUserVideo.muted = true
localDisplayVideo.muted = true
remoteVideoGroup.style.display = 'none'

peer.addEventListener('track', e => {
	// e.streams[0].getTracks().forEach(track => {
	// remoteUserStream.addTrack(track)
	// })

	console.group('Track event')
	console.log('New track: ', e.track)
	console.log('New receiver: ', e.receiver)
	console.log('New transceiver: ', e.transceiver)
	// const tracks = peer.getReceivers().map(r => r.track)
	// const stream = new MediaStream(tracks)
	// remoteUserVideo.srcObject = stream
	console.groupEnd()

	// const tracks = e.streams[0].getTracks()
	// tracks.forEach(console.log)
	// console.log('--------------------------------------')
	// remoteUserVideo.srcObject = e.streams[0]
	remoteVideoGroup.style = ''
	remoteUserVideo.srcObject = peer.getRemoteStreams()[0]
})

localUserStream.addEventListener('addtrack', e => {
	peer.addTrack(e.track, localUserStream)
})

localUserStream.addEventListener('removetrack', e => {
	const { id } = e.track.id
	const [sender] = peer.getSenders().filter(s => {
		s.track.id === id
	})
	peer.removeTrack(sender)
})

// Update the MediaStream object that contains the local user's
// microphone and webcam
const updateLocalUserStream = async ({ video, audio }) => {
	// peer.getSenders().forEach(sender => peer.removeTrack(sender))
	localUserVideo.parentElement.style.display = video ? 'block' : 'none'

	if (!video && !audio) return (localUserVideo.srcObject = null)
	localUserStream = await navigator.mediaDevices.getUserMedia({
		audio: true,
		video: true,
	})
	const [videoTrack] = localUserStream.getVideoTracks()
	const [audioTrack] = localUserStream.getAudioTracks()

	videoTrack.enabled = video
	audioTrack.enabled = audio

	localUserVideo.srcObject = localUserStream
	localUserStream.getTracks().forEach(track => {
		peer.addTrack(track, localUserStream)
		peer.addTransceiver(track)
	})
}

// Update the MediaStream object that contains the local user's
// screen share
const updateLocalDisplayStream = async ({ sharing }) => {
	peer
		.getSenders()
		.filter(({ track: { label } }) => {
			label && (label === 'System Audio' || label.startsWith('screen'))
		})
		.forEach(sender => peer.removeTrack(sender))
	localDisplayVideo.parentElement.style.display = sharing ? 'block' : 'none'
	if (!sharing) return (localDisplayVideo.srcObject = null)

	localDisplayStream = await navigator.mediaDevices.getDisplayMedia({
		audio: true,
		video: true,
	})

	localDisplayVideo.srcObject = localDisplayStream
	localDisplayStream.getTracks().forEach(track => {
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

	track.enabled = !track.enabled

	if (device === 'audio') return
	localUserVideo.parentElement.style.display = track.enabled ? 'block' : 'none'
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

	e.target.style = ''
	video.style = ''
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
			peer.getSenders().forEach(peer.removeTrack)
			track.stop()
			stream.removeTrack(track)
		})
	)

	window.location.href = '/'
}

// * Creates a call
const createCall = async () => {
	const callId = uuidV4()
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

updateLocalUserStream(localStreamSettings)
updateLocalDisplayStream(localStreamSettings)

createCallBtn.addEventListener('click', createCall)
answerCallBtn.addEventListener('click', answerCall)

createCallInput.addEventListener('click', copyToClipboard)

clipboardPopup.addEventListener('transitionend', removePopup)

// localUserStream

// remoteUserStream.onaddtrack = () =>
// (remoteUserVideo.srcObject = remoteUserStream)
