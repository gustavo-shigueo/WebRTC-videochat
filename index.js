const httpServer = require('http').createServer()
const io = require('socket.io')(httpServer, {
	cors: {
		origin: '*',
		methods: ['GET', 'POST'],
	},
})

const calls = [
	// {
	//  id: '',
	// 	offerCandidates: [{}],
	// 	answerCandidates: [{}],
	//  offer: {}
	//  answer: {}
	// }
]

io.on('connection', socket => {
	socket.on('join', socket.join)

	socket.on('send-local-description-offer', (offerDescription, callId) => {
		const call = calls.filter(({ id }) => callId === id)?.[0] ?? {
			id: callId,
			offerDescription: [],
		}
		calls.push(call)

		call.offerDescription.unshift(offerDescription)

		socket.broadcast
			.to(callId)
			.emit('receive-remote-description-offer', offerDescription)
	})

	socket.on('answer-call', callId => {
		const [call] = calls.filter(({ id }) => callId === id)
		if (!call) return

		// console.log(call)
		socket.join(callId)
		io.to(socket.id).emit(
			'receive-remote-description-offer',
			call.offerDescription[0]
		)
	})

	socket.on('send-local-description-answer', (answerDescription, callId) => {
		socket.broadcast
			.to(callId)
			.emit('receive-remote-description-answer', answerDescription)
	})

	socket.onAny((event, ...args) => console.log({ event, args }))
})

httpServer.listen(3001)
