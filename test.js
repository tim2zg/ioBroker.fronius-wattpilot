let socket

$(document).ready(function(){
	socket = io("ws://10.0.1.214/ws");

	socket.onAny(function (data) {
		console.log(data);
	});

	socket.on('disconnect_data', function() {
		if (fertig !== true) {
			alert("Session verlohren")
			window.location.replace("/");
		}
	});
});