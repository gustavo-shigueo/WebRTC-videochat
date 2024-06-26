const corsOrigin = process?.env?.GITPOD_WORKSPACE_URL?.replace('//', '//5500-') ?? 'https://gustavo-shigueo.github.io'

const httpServer = require('http').createServer((req, res) => {
	res.writeHead(200, { 'Access-Control-Allow-Origin': corsOrigin })
})
const io = require('socket.io')(httpServer, {
	cors: {
		origin: corsOrigin,
		methods: ['GET', 'POST'],
	},
})

/**
 * @typedef {Object} Call Stores a call created by the frontend
 * @property {string} id
 * @property {RTCSessionDescription[]} [offerDescription]
 */

/** @type {Call[]} */
const calls = []

io.on('connection', socket => {
	socket.on('join', socket.join)

	socket.on('check-for-call', callId => {
		const [call] = calls.filter(({ id }) => callId === id)
		io.to(socket.id).emit('check-result', !!call)
	})

	socket.on('send-local-description-offer', (offerDescription, callId) => {
		/** @type {Call} */
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
		socket.broadcast.to(callId).emit('receive-candidate', candidate)
	})

	socket.on('remove-call', callId => {
		const index = calls.findIndex(({ id }) => id === callId)
		calls.splice(index, 1)
	})
})

httpServer.listen(process.env.PORT ?? 3001)
