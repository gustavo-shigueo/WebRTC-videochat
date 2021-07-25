# WebRTC-videochat

A WebRTC based app for video-chatting with screen sharing capabilities that uses a vannila JS
frontend and a socket.io backend that handles the initial connection between the peers.  
  
  
## How it works:

When you head to https://gustavo-shigueo.github.io/WebRTC-videochat, you will be redirected to a URL that contains a call ID created by a
[UUID generator](https://gist.github.com/jed/982883) created by [@jed](https://github.com/jed), the only alterations to which I made were
renaming the function from `b` to `uuid` and allowing prettier to run when I saved the file. This ID is immediately used to query the socket.io
server, asking wether or not there is a call with that ID, if not, the frontend creates a call with it, sends its details to the server, which
saves it in an array of calls and waits for an answer, otherwise, the frontend creates an answer, sends it to the server, which sends it to the
caller, estabilshing the peer connection.  
  
Upon connection, both the caller and the callee disconnect from the server, which deletes this call from the calls array, and the two parties communicate
only through the peer connection and its data channel, which handles the end of the call, the addition and removal of MediaStreamTracks and renegotiations.
  
  
## How to use it:

Simply go to https://gustavo-shigueo.github.io/WebRTC-videochat and, when your call is created send the URL in your browser, which contains the call ID
to whoever you want to talk to. Once they open it, a peer connection will be estabilished and youur call will begin.
