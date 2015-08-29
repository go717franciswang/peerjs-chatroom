var config = {
    API_KEY: 'pfdzt21q4ytu766r',
    roomid: null,
    peer: null,
    connections: {}
};

var $myname = $('#myname');
$myname.val(Math.round(Math.random()*1e10));

var $log = $('#log');
var $sendButton = $('#sendButton');
var $message = $('#message');
var MSG_TYPE = {
    CHAT: 1,
    NEW_MEMBER: 2,
    NAME_REQ: 3,
    NAME_REP: 4,
    DEPARTURE: 5
}

$('#createRoomButton').click(function() {
    var loc = window.location.search = '?room=' + $('#roomName').val();
});

var createRoom = function() {
    config.peer = new Peer(config.roomid, {key: config.API_KEY});

    config.peer.on('error', function(e) {
        if (e.toString().match(/ID.*is taken/)) {
            joinRoom();
        }
    });

    config.peer.on('open', function(id) {
        log('info', 'Created room: ' + id);
        $sendButton.prop('disabled', false);

        // empty existing connections
        config.connections = {};

        config.peer.on('connection', function(conn) {
            handleConnection(conn);
            getName(conn);
        });
    });
};

var getName = function(conn) {
    setTimeout(function() {
        conn.send({
            type: MSG_TYPE.NAME_REQ,
            peername: $myname.val(),
            members_count: Object.keys(config.connections).length+1
        });
    }, 1000);
};

var broadcastNewMember = function(peerid) {
    for (var id in config.connections) {
        var conn = config.connections[id];
        conn.send({
            type: MSG_TYPE.NEW_MEMBER,
            peername: conn.peername,
            peerid: id
        });
    }
};

var joinRoom = function() {
    config.peer = new Peer({key: config.API_KEY});
    conn = config.peer.connect(config.roomid);
    handleConnection(conn);

    config.peer.on('open', function(id) {
        log('info', 'Entered room: ' + config.roomid);
    });
};

var handleConnection = function(conn) {
    conn.on('open', function() {
        $sendButton.prop('disabled', false);
    });

    conn.on('data', function(data) {
        switch (data.type) {
            case MSG_TYPE.NAME_REQ:
                conn.peername = data.peername;
                log('info', data.members_count+1 + ' people in this room');
                conn.send({
                    type: MSG_TYPE.NAME_REP,
                    peername: $myname.val()
                });
                break;
            case MSG_TYPE.NAME_REP:
                log('info', data.peername + ' entered the room');
                conn.peername = data.peername;
                broadcastNewMember(data.peername);
                config.connections[conn.peer] = conn;
                break;
            case MSG_TYPE.CHAT:
                log(data.peername, data.data);
                if (config.peer.id == config.roomid) {
                    broadcastMessage(data);
                }
                break;
            case MSG_TYPE.NEW_MEMBER:
                    log('log', data.peername + ' entered the room');
                break;
            case MSG_TYPE.DEPARTURE:
                    log('log', data.peername + ' left the room');
                break;
        }
    });

    $sendButton.off('click');
    $sendButton.click(function() {
        sendMessage(conn);
    });

    $message.off('keypress');
    $message.keypress(function(e) {
        if (e.which == 13) {
            sendMessage(conn);
        }
    });

    conn.on('close', function() {
        log('info', conn.peername + ' left the room');

        // if lost connection to the room, recreate it
        if (conn.peer == config.roomid) {
            createRoom();
        }

        if (config.peer.id == config.roomid) {
            delete config.connections[conn.peer];
            broadcastDeparture(conn.peername);
        }
    });
};

var broadcastMessage = function(data) {
    for (var id in config.connections) {
        // don't send message back to original author
        if (id == data.peerid) {
            continue;
        }

        var conn = config.connections[id];
        conn.send({
            type: MSG_TYPE.CHAT,
            peerid: data.peerid,
            peername: data.peername,
            data: data.data
        });
    };
};

var broadcastDeparture = function(peername) {
    for (var id in config.connections) {
        // don't send message back to original author
        if (id == data.peerid) {
            continue;
        }

        var conn = config.connections[id];
        conn.send({
            type: MSG_TYPE.DEPARTURE,
            peername: peername
        });
    };
};

var sendMessage = function(conn) {
    var data = $message.val();
    if (data.length == 0) return;
    log($myname.val(), data);

    var data = {type: MSG_TYPE.CHAT, peerid: config.peer.id, peername: $myname.val(), data: data};
    if (config.peer.id == config.roomid) {
        broadcastMessage(data);
    } else {
        conn.send(data);
    }

    $message.val('');
    $message.focus();
}

var log = function(name, message) {
    $log.append('<div>['+name+']: '+message+'</div>');
    $('html, body').animate({ scrollTop: $(document).height() }, "slow");
};

var m = window.location.search.match(/[?&]room=([a-zA-Z0-9]+)/);
if (m) {
    config.roomid = m[1];
    createRoom();
} else {
    window.location.search = '?room=general';
}
