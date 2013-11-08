var RTCtest = {

	config: {},

	master: null,
	notify: null,
	pcSettings: {
		server: {
			iceServers: [
				{url: "stun:23.21.150.121"}, // Mozilla public server
				{url: "stun:stun.l.google.com:19302"} // Google Public server 1
			]
		},
		options: {
			optional: [
				{DtlsSrtpKeyAgreement: true},
				{RtpDataChannels: true}
			]
		},
		constraints: {
			mandatory: {
				OfferToReceiveAudio: true,
				OfferToReceiveVideo: true
			}
		}
	},
	users: {},
	user: null,

	init: function () {
		console.log('Initalising...')
		// selfconfig
		RTCtest.config = $(document.body).data()

		// configure toastr
		toastr.options.positionClass = 'toast-bottom-right'
		toastr.options.timeOut = 3500

		// Connect to master server
		var connectingToast = toastr.info('connecting...', null, {timeOut: 0, extendedTimeOut: 0, tapToDismiss: false})

		RTCtest.master = ab.connect(RTCtest.config.master,
			// WAMP session was established
			function (session) {
				RTCtest.master = session;
				sess = session;
				console.log("Connected to " + RTCtest.config.master);
				toastr.clear(connectingToast)
				toastr.success("Connected!")

				RTCtest.startup();
			},
			
			// WAMP session is gone
			function (code, reason) {
				RTCtest.master = null;
				console.log("Connection lost (" + reason + ")");
				toastr.error(reason, null, {timeOut: 5000})
			}
		);

		// Chat enter listener
		$("#chat-input").keypress(function(e) {
			if(e.which == 13) {
				RTCtest.doChat($(this).val())
				$(this).val('')
			}
		});

		// Video button bindings
		$("#video-button").click(RTCtest.onVideoBtnClick)
	},

	startup: function () {
		RTCtest.master.subscribe('users', function (channel, data) {
			if(data.type == 'join') {
				var user = RTCtest.users[data.userid] = new User(data.userid, data.username);
				if(data.userid == RTCtest.master.sessionid()) {
					user.status = 3
					user.self = 1
					user.video.permission = false
					RTCtest.user = user
					return
				} else {
					user.createPeerConnection()
				}
				if(data.masstxt) {
					// New user is responsible for starting new connection
					user.initiator()
				} else {
					toastr.info(user.username, 'User Join')
				}
			} else if(data.type == 'leave') {
				var user = RTCtest.users[data.userid]
				toastr.info(user.username, 'User Leave')
				user.leaving()
				delete RTCtest.users[data.userid]
			}
			console.log(arguments)
		});

		RTCtest.master.subscribe('candidate', RTCtest.onMatchmaker);
		RTCtest.master.subscribe('offer', RTCtest.onMatchmaker);
		RTCtest.master.subscribe('answer', RTCtest.onMatchmaker);
		RTCtest.master.subscribe('renegotiate', RTCtest.onMatchmaker);

		// Backup line for chrome-firefox
		RTCtest.master.subscribe('chat', function (channel, data) {
			RTCtest.onChat(RTCtest.users[data.from], data.payload)
		});
	},

	onMatchmaker: function (channel, data) {
		if(RTCtest.users[data.from]) {
			var user = RTCtest.users[data.from]
			var payload = JSON.parse(data.payload)

			console.log(channel)

			if (channel === 'offer') {
				console.log('Got offer from '+data.from)
				user.pc.setRemoteDescription(new SessionDescription(payload));
				user.status = 1
				user.responder()
			} else if (channel == 'answer') {
				console.log('Got answer from '+data.from)
				user.pc.setRemoteDescription(new SessionDescription(payload));
			} else if (channel == 'candidate') {
				console.log('Got candidate from '+data.from)
				user.pc.addIceCandidate(new IceCandidate(payload))
			} else if (channel == 'renegotiate') {
				console.log('renegotiate from '+data.from)
				user.closePeerConnection()
				user.createPeerConnection()
			}
		}
		console.log('matchmaker', channel, data)
	},
	// chat
	doChat: function (text) {
		if(RTCtest.master) { // If not loaded dump the rice into the thing
			for (user in RTCtest.users) {
				RTCtest.users[user].chat(text)
			}
		}
	},
	onChat: function (user, text) {
		if(!user) return;
		$('<li>').text(user.username+': '+text).appendTo('#chat')
		$('#chat').animate({
			scrollTop: $('#chat').get(0).scrollHeight
		}, 500);
	},
	// video
	onVideoBtnClick: function () {
		if(!RTCtest.user) return;

		// Need permission?
		if(!RTCtest.user.video.permission) {
			navigator.getUserMedia({audio: true, video: true}, RTCtest.onUserMediaSuccess, function (reason) {
				toastr.error(reason, null, {timeOut: 5000})
			}); 
		} else {
			// Turn video on/off
			if(!RTCtest.user.video.active) {
				RTCtest.user.video.active = true
				RTCtest.distributeVideo()
				$("#video-button").text("On").removeClass('btn-danger').addClass('btn-success')
			} else {
				RTCtest.user.video.active = false
				RTCtest.stopVideo()
				$("#video-button").text("Off").removeClass('btn-success').addClass('btn-danger')
			}
		}
	},
	onUserMediaSuccess: function (stream) {
		RTCtest.user.video.stream = stream
		RTCtest.user.video.permission = true

		$("#video-button").text("Off").removeClass('btn-warning').addClass('btn-danger')
	},
	distributeVideo: function (user) {
		if(!user) {
			for (user in RTCtest.users) {
				RTCtest.distributeVideo(RTCtest.users[user])
			}
			return;
		}

		user.sendVideo(RTCtest.user)
	},
	stopVideo: function (user) {
		if(!user) {
			for (user in RTCtest.users) {
				RTCtest.stopVideo(RTCtest.users[user])
			}
			return;
		}

		user.stopVideo(RTCtest.user)
	}

};

function User (userid, username) {
	this.userid = userid
	this.username = username
	this.self = 0
	this.video = {
		active: false,
		stream: null,
	}
	this.$el = $('<li class="user"><span class="status label">&nbsp;</span> <span class="username"></span></li>').appendTo("#userlist")
	this.$el.find('.username').text(username)
	this.$videoel = null

	this.status = 0
	this.channels = {}
}

User.prototype = {
	// status
	// 0 - Not connected
	// 1 - handshaking
	// 2 - connected
	// 3 - self
	get status() {
		return this._status
	},
	set status(val) {
		this._status = val
		var $state = this.$el.find('.status')
		$state.removeClass('label-danger label-warning label-success label-primary')
		if(this._status == 0) {
			$state.addClass('label-danger')
			$state.get(0).title = "Not connected"
		} else if (this._status == 1) {
			$state.addClass('label-warning')
			$state.get(0).title = "Connected (proxy text chat)"
		} else if (this._status == 2) {
			$state.addClass('label-success')
			$state.get(0).title = "Connected (direct text chat)"
		} else if (this._status == 3) {
			$state.addClass('label-primary')
			$state.get(0).title = "It's-a you!"
		}
	},	

	leaving: function () {
		this.$el.remove()
		if(this.video.active) {
			this.removeVideo()
		}
	},
	createPeerConnection: function () {
		if(this.pc) {
			this.closePeerConnection()
			RTCtest.master.publish("renegotiate", null, [], [this.userid])
		}

		this.pc = new PeerConnection(RTCtest.pcSettings.server, RTCtest.pcSettings.options)
		this.pc.onicecandidate = this.onIceCandidate.bind(this)
		this.pc.ondatachannel = this.onChannel.bind(this)
		this.pc.onaddstream = this.onStream.bind(this)
		this.pc.onremovestream = this.onRemoveStream.bind(this)
		if(RTCtest.user && RTCtest.user.video.active) {
			// Must add it before negotiations
			console.log("adding stream")
			this.pc.addStream(RTCtest.user.video.stream)
		}
	},
	closePeerConnection: function () {
		this.pc.close()
		this.status = 0
		this.pc = null

		if(this.video.active) {
			this.onRemoveStream()
		}
	},
	// Connection creators
	initiator: function () {
		// Thanks chrombama-care!
	//	this.channels['chat'] = this.pc.createDataChannel('chat');
	//	this.bindChatChannel()
		this.pc.createOffer(this.onCreateOffer.bind(this), this.onPcError.bind(this), RTCtest.pcSettings.constraints);
	},
	responder: function () {
		this.pc.createAnswer(this.onCreateAnswer.bind(this), this.onPcError.bind(this), RTCtest.pcSettings.constraints);
	},
	// On connection updates
	onIceCandidate: function (event) {
		if (event.candidate == null) { return }
		RTCtest.master.publish("candidate", JSON.stringify(event.candidate), [], [this.userid])
		this.pc.onicecandidate = null;
	},
	onCreateOffer: function (offer) {
		this.pc.setLocalDescription(offer);
		RTCtest.master.publish("offer", JSON.stringify(offer), [], [this.userid])

		this.status = 1
		console.log("offer", offer)
	},
	onCreateAnswer: function (answer) {
		this.pc.setLocalDescription(answer)
		RTCtest.master.publish("answer", JSON.stringify(answer), [], [this.userid])
	},
	onPcError: function (err) {
		console.log(err)
		toastr.error(err, "Error connecting to "+this.username)
	},
	// On channel
	onChannel: function (event) {
		this.channels[event.channel.label] = event.channel
		if(event.channel.label == 'chat') {
			this.bindChatChannel()
		}
		console.log('channel', this.userid, event)
	},
	onStream: function (event) {
		this.status = 2
		console.log("stream", event)
		if(event.stream.getVideoTracks().length > 0) {
			this.video.active = true
			this.video.stream = event.stream
			this.addVideo()
		}
	},
	onRemoveStream: function () {
		this.video.active = false
		this.video.stream = null;
		this.removeVideo()
	},
	bindChatChannel: function () {
		var user = this
		this.channels['chat'].onopen = function () {
			user.status = 2
			console.log('chat', 'onopen', arguments)
		};
		this.channels['chat'].onmessage = function (event) {
			RTCtest.onChat(user, event.data)
			console.log('chat', 'onmessage', arguments)
		};
		this.channels['chat'].onclose = function () {
			console.log('chat', 'onclose', arguments)
		};
	},
	// chat
	chat: function (text) {
		if(this.self) {
			// Just output
			RTCtest.onChat(this, text)
		} else if(this.channels['chat'] && this.channels['chat'].readyState == 'open') {
			// Send over datachannel
			this.channels['chat'].send(text)
		} else {
			// fallback: Send over websocket
			RTCtest.master.publish("chat", text, [], [this.userid])
		}
	},
	// video
	sendVideo: function (from) {
		if(this.self) {
			this.addVideo()
			return
		}
		// Create a new peer connection
		this.createPeerConnection()
		this.initiator();
	},
	stopVideo: function (from) {
		if(this.self) {
			this.removeVideo()
			return
		}
		// Create a new peer connection
		this.createPeerConnection()
		this.initiator();
	},
	addVideo: function () {
		this.$videoel = this.$videoel || $('<video class="video" autoplay>').attr({"data-id": this.userid}).appendTo('#videos')
		var videoel = this.$videoel.get(0)
		videoel.src = window.URL.createObjectURL(this.video.stream)
		if(this.self) {
			videoel.muted = true
		}
	},
	removeVideo: function () {
		this.$videoel.remove();
		this.$videoel = null
	}
};

// webrtc shims
var PeerConnection = window.mozRTCPeerConnection || window.webkitRTCPeerConnection;
var IceCandidate = window.mozRTCIceCandidate || window.RTCIceCandidate;
var SessionDescription = window.mozRTCSessionDescription || window.RTCSessionDescription;
navigator.getUserMedia = navigator.getUserMedia || navigator.mozGetUserMedia || navigator.webkitGetUserMedia;

// Avoid `console` errors in browsers that lack a console.
(function() {
    var method;
    var noop = function () {};
    var methods = [
        'assert', 'clear', 'count', 'debug', 'dir', 'dirxml', 'error',
        'exception', 'group', 'groupCollapsed', 'groupEnd', 'info', 'log',
        'markTimeline', 'profile', 'profileEnd', 'table', 'time', 'timeEnd',
        'timeStamp', 'trace', 'warn'
    ];
    var length = methods.length;
    var console = (window.console = window.console || {});

    while (length--) {
        method = methods[length];

        // Only stub undefined methods.
        if (!console[method]) {
            console[method] = noop;
        }
    }
}());

$(function () {
	RTCtest.init();
});