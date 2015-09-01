var Chatroom = {
    init: function(api_key, roomid) {
        this.API_KEY = api_key;
        this.ROOMID = roomid;
        this.MSG_TYPE = {
            CHAT: 1,
            NEW_MEMBER: 2,
            DEPARTURE: 5,
            BROADCAST: 6,
            PING: 7,
            ACK: 8,
            MEMBERS_REQ: 9,
            MEMBERS_REP: 10,
        };
        this.PING_INTERVAL_SECONDS = 20;
        this.PING_TIMEOUT = 5;
        this.REFRESH_MEMBERS_INTERVAL_SECONDS = 30;
        this.peerIdToName = {};

        this.$log = $('#log');
        this.$sendButton = $('#sendButton');
        this.$message = $('#message');
        this.$myname = $('#myname');
        this.$members = $('#members');

        return this;
    },

    createServer: function() {
        var _this = this;
        this.clearPendingChecks();
        this.emptyConnToClients();

        this.server = new Peer(this.ROOMID, {key: this.API_KEY});
        this.server.on('error', function(e) {
            if (e.toString().match(/ID.*is taken/)) {
                _this.log('info', 'Server already exists');

                _this.server = null;
                _this.createClient();
            } else {
                console.log(e);
            }
        });

        this.server.on('open', function() {
            _this.log('info', 'Server has been created');

            _this.createClient();
            _this.server.on('connection', function(conn) {
                _this.connToClients[conn.peer] = conn;
                _this.handleConnToClient(conn.peer);
            });
        });
    },

    clearPendingChecks: function() {
        if (this._pingTimeoutId) clearTimeout(this._pingTimeoutId);
        if (this._pingIntervalId) clearInterval(this._pingIntervalId);
        this._lastAckTimestamp = null;
    },

    emptyConnToClients: function() {
        if (this.connToClients) {
            for (var id in this.connToClients) {
                this.closeClientConnection(this.connToClients[id]);
            }
        }

        this.connToClients = {};
    },

    handleConnToClient: function(peerid) {
        var _this = this;

        this.connToClients[peerid].on('open', function() {
            _this.broadcast({
                type: _this.MSG_TYPE.NEW_MEMBER,
                peerid: peerid,
                peername: _this.connToClients[peerid].peername,
            });

            _this.connToClients[peerid].on('error', function(e) {
                console.log(e);
            });
        });

        this.connToClients[peerid].on('data', function(data) {
            //console.log('server got', data);
            switch(data.type) {
                case _this.MSG_TYPE.CHAT:
                    _this.connToClients[data.peerid].peername = data.peername;
                    _this.broadcast({
                        type: _this.MSG_TYPE.BROADCAST,
                        peerid: data.peerid,
                        peername: data.peername,
                        data: data.data,
                    });
                break;
                case _this.MSG_TYPE.PING:
                    _this.connToClients[data.peerid]._lastPingTimestamp = (new Date()).getTime();
                    _this.connToClients[data.peerid].send({
                        type: _this.MSG_TYPE.ACK,
                        timestamp: (new Date()).getTime(),
                    });
                break;
                case _this.MSG_TYPE.MEMBERS_REQ:
                    var members = [];
                    for (var id in _this.connToClients) {
                        var conn = _this.connToClients[id];
                        members.push({ peerid: id, peername: conn.peername });
                    }

                    _this.connToClients[data.peerid].send({
                        type: _this.MSG_TYPE.MEMBERS_REP,
                        members: members
                    });
                break;
            }
        });

        this.broadcastDepartureOnClose(this.connToClients[peerid]);
    },

    broadcastDepartureOnClose: function(conn) {
        var _this = this;

        conn.on('close', function() {
            _this.closeClientConnection(conn);
        });

        // var interval = (this.PING_INTERVAL_SECONDS+this.PING_TIMEOUT)*1000;
        // conn._pingInterval = setInterval(function() {
        //     if (!conn._lastPingTimestamp || conn._lastPingTimestamp < (new Date()).getTime()-interval) {
        //         console.log('connection to client assumed lost b/c');
        //         console.log('lastPingTimestamp', conn._lastPingTimestamp);
        //         console.log('threshold', conn._lastPingTimestamp < (new Date()).getTime()-interval);
        //         _this.closeClientConnection(conn);
        //     }
        // }, interval);
    },

    closeClientConnection: function(conn) {
        conn.close();
        delete this.connToClients[conn.peer];
        if (conn._pingInterval) clearInterval(conn._pingInterval);
        this.broadcast({ type: this.MSG_TYPE.DEPARTURE, peerid: conn.peer, peername: conn.peername });
    },

    broadcast: function(data) {
        for (var id in this.connToClients) {
            var conn = this.connToClients[id];
            conn.send({
                type: data.type,
                peerid: data.peerid,
                peername: data.peername,
                data: data.data
            });
        };
    },

    log: function(tag, msg) {
        this.$log.append('<div>['+(new Date()).toLocaleString()+']['+tag+']: '+msg+'</div>');
        $('html, body').scrollTop($(document).height());
    },

    createClient: function() {
        var _this = this;

        this.client = new Peer({key: this.API_KEY});

        this.client.on('error', function(e) {
            console.log(e);
        });

        this.client.on('open', function() {
            _this.connToServer = _this.client.connect(_this.ROOMID);

            _this.connToServer.on('open', function() {
                _this.log('info', 'Client has been created');
                _this.$sendButton.prop('disabled', false);

                _this.handleConnToServer();

                _this.$sendButton.off('click');
                _this.$sendButton.click(function() {
                    _this.sendMessage();
                });

                _this.$message.off('keypress');
                _this.$message.keypress(function(e) {
                    if (e.which == 13) {
                        _this.sendMessage();
                    }
                });

                // once p2p connection is established, client no longer needs to be connected to peerjs server
                _this.client.disconnect();

                if (_this.refreshMembersInterval) clearInterval(_this.refreshMembersInterval);
                _this.refreshMembers(_this);
                _this.refreshMembersInterval = setInterval(_this.refreshMembers, _this.REFRESH_MEMBERS_INTERVAL_SECONDS*1000, _this);
            });
        });
    },

    sendMessage: function() {
        if (this.$sendButton.prop('disabled')) {
            return;
        }

        var peername = null;
        if (this.$myname.val().length) peername = this.$myname.val();
        var data = {
            type: this.MSG_TYPE.CHAT, 
            peerid: this.client.id || this.client._lastServerId,
            peername: peername,
            data: this.$message.val(),
        };
        this.connToServer.send(data);

        this.$message.val('');
        this.$message.focus();
    },

    handleConnToServer: function() {
        var _this = this;

        this.connToServer.on('error', function(e) {
            console.log(e);
        });

        this.connToServer.on('data', function(data) {
            //console.log('client got', data);
            switch(data.type) {
                case _this.MSG_TYPE.NEW_MEMBER:
                    var displayName = data.peername || data.peerid;
                    _this.peerIdToName[data.peerid] = displayName;
                    _this.log('info', displayName + ' has joined the room');
                break;
                case _this.MSG_TYPE.BROADCAST:
                    var displayName = data.peername || data.peerid;
                    _this.peerIdToName[data.peerid] = displayName;
                    _this.log(displayName, data.data);
                break;
                case _this.MSG_TYPE.DEPARTURE:
                    var displayName = data.peername || data.peerid;
                    delete _this.peerIdToName[data.peerid];
                    _this.log('info', displayName + ' has left the room');
                break;
                case _this.MSG_TYPE.ACK:
                    if (!_this._lastAckTimestamp || _this._lastAckTimestamp < data.timestamp) {
                        _this._lastAckTimestamp = data.timestamp;
                    }
                break;
                case _this.MSG_TYPE.MEMBERS_REP:
                    _this.peerIdToName = {};
                    for (var i = 0; i < data.members.length; i++) {
                        var m = data.members[i];
                        var displayName = m.peername || m.peerid;
                        _this.peerIdToName[m.peerid] = displayName;
                    }
                break;
            }

            _this.$members.empty();
            for (var id in _this.peerIdToName) {
                var displayName = _this.peerIdToName[id];
                $('<div>['+displayName+']</div>').appendTo(_this.$members);
            }
        });

        this.reestablishConnectionOnClose();
    },

    reestablishConnectionOnClose: function() {
        var _this = this;

        this.connToServer.on('close', function() {
            _this.createServer();
        });

        // // firefox does not support close event, so we imitate it with ping/ack
        // if (this._pingIntervalId) {
        //     clearInterval(this._pingIntervalId);
        // }
        // this._pingIntervalId = setInterval(function() {
        //     _this.connToServer.send({
        //         type: _this.MSG_TYPE.PING
        //     });

        //     _this._pingTimeoutId = setTimeout(function() {
        //         if (!_this._lastAckTimestamp || _this._lastAckTimestamp < (new Date()).getTime()-_this.PING_TIMEOUT*1000) {
        //             console.log('connection to server assumed lost b/c');
        //             console.log('lastAckTimestamp', _this._lastAckTimestamp);
        //             console.log('threshold', (new Date()).getTime()-_this.PING_TIMEOUT*1000);
        //             _this.createServer();
        //         }
        //     }, _this.PING_TIMEOUT*1000);
        // }, this.PING_INTERVAL_SECONDS*1000);
    },

    refreshMembers: function(_this) {
        _this.connToServer.send({ 
            type: _this.MSG_TYPE.MEMBERS_REQ,
            peerid: _this.client.id || _this.client._lastServerId,
        });
    },
};

var m = window.location.search.match(/[?&]room=([a-zA-Z0-9]+)/);
if (m) {
    var roomid = m[1];
    var chatroom = Chatroom.init('pfdzt21q4ytu766r', roomid);
    chatroom.createServer();
} else {
    window.location.search = '?room=general';
}

$('#createRoomButton').click(function() {
    var loc = window.location.search = '?room=' + $('#roomName').val();
});
