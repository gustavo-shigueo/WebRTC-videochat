const httpServer = require('http').createServer((req, res) => {
	res.writeHead(200, { 'Access-Control-Allow-Origin': '*' })
})
const io = require('socket.io')(httpServer, {
	cors: {
		origin: 'https://gustavo-shigueo.github.io',
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

	socket.on('check-for-call', callId => {
		const [call] = calls.filter(({ id }) => callId === id)
		io.to(socket.id).emit('check-result', !!call)
	})

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

	socket.on('send-candidate', (candidate, callId) => {
		socket.broadcast
			.to(callId)
			.emit('receive-candidate', candidate)
	})

	socket.on('remove-call', callId => {
		const index = calls.findIndex(({ id }) => id === callId)
		calls.splice(index, 1)
	})

	socket.onAny((event, ...args) => console.log({ event, args }))
})

httpServer.listen(3001)
