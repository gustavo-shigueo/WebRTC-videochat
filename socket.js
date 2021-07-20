const room = window.location.search

if (
	!room.match(
		/^\?roomId=[0-9a-f]{8}\-[0-9a-f]{4}\-4[0-9a-f]{3}\-[89ab][0-9a-f]{3}\-[0-9a-f]{12}$/
	)
) {
	window.location.href = `/?roomId=${uuidV4()}`
}

peer.ontrack = e => {
	console.log(e)
}

const roomId = window.location.search.substr(8)
const socket = io('ws://localhost:3001')

const DOMChangesOnConnection = () => {
	const videoElement = template

	const videoContainers = [...videoElement.querySelectorAll('.video-container')]
	videoContainers.forEach(v => (v.style.display = 'none'))

	peer.addEventListener('track', e => {
		e.streams.forEach((stream, i) => {
			stream.getTracks().forEach(track => {
				remoteStreams[i === 0 ? 'userStream' : 'displayStream'].addTrack(track)
			})
		})
	})

	const videos = [...videoElement.querySelectorAll('video')]
	videos[0].srcObject = remoteStreams.userStream
	videos[1].srcObject = remoteStreams.displayStream
}

socket.on('connect', () => {
	socket.emit('join-room', roomId, userId)
	DOMChangesOnConnection()

	socket.on('create-call', async _ => {
		peer.onicecandidate = event => {
			event.candidate &&
				socket.emit('save-offer-candidate', roomId, event.candidate.toJSON())
		}

		const offerDescription = await peer.createOffer()
		await peer.setLocalDescription(offerDescription)

		const offer = {
			sdp: offerDescription.sdp,
			type: offerDescription.type,
		}

		await socket.emit('call-created', roomId, offer)

		socket.on('call-answered', call => {
			console.log(call)
			if (!peer.currentRemoteDescription && call?.answer) {
				const answerDescription = new RTCSessionDescription(call.answer)
				peer.setRemoteDescription(answerDescription)
			}
		})

		socket.on('add-answer-candidate', candidate => {
			peer.addIceCandidate(new RTCIceCandidate(candidate))
		})
	})

	socket.on('answer-call', async call => {
		peer.onicecandidate = event => {
			event.candidate &&
				socket.emit('save-answer-candidate', call.id, event.candidate.toJSON())
		}

		const offerDescription = call.offer
		await peer.setRemoteDescription(new RTCSessionDescription(offerDescription))

		const answerDescription = await peer.createAnswer()
		await peer.setLocalDescription(answerDescription)

		const answer = {
			type: answerDescription.type,
			sdp: answerDescription.sdp,
		}

		await socket.emit('answer-created', call.id, answer)

		socket.on('add-offer-candidate', candidate => {
			peer.addIceCandidate(new RTCIceCandidate(candidate))
		})
	})
})
