const express = require('express');
const http = require("http");
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const url = require('node:url');

const port = process.env.PORT || 3000;
const rooms = [];

function createRoom(name, maxUsers = 4) {
    let room = rooms.find(r => r.name === name);
    if(!room) {
        room = {
            name: name,
            maxUsers: maxUsers,
            users: []
        };
        rooms.push(room);
        console.log(`Room created: ${name}`);
    }
    return room;
}

function deleteRoom(name) {
    const index = rooms.findIndex(r => r.name === name);
    rooms.splice(index, 1);
    console.log(`Room deleted: ${name}`);
}

function addToRoom(name, user) {
    const room = createRoom(name);
    if(room.users.length < room.maxUsers) {
        room.users.push(user);
        console.log(`${user.name} joined room: ${name}`);
        return true;
    }
    return false;
}

function removeFromRoom(name, user) {
    const room = rooms.find(r => r.name === name);
    if(room) {
        const index = room.users.findIndex(u => u.uuid === user.uuid);
        room.users.splice(index, 1);
        console.log(`${user.name} left room: ${name}`);
        if(room.users.length < 1) deleteRoom(room.name);
    }
}

function getRoomUsers(name) {
    const room = rooms.find(r => r.name === name);
    if(room) {
        return room.users.map(u => ({ uuid: u.uuid, name: u.name, location: u.location }));
    }
    return [];
}

function broadcastToRoom(name, data) {
    const room = rooms.find(r => r.name === name);
    if(room) {
        for(user of room.users) {
            if(user.client.readyState === WebSocket.OPEN) user.client.send(JSON.stringify(data), { binary: false});
        }
    }
}

function broadcastToUser(user, data) {
    if(user.client.readyState === WebSocket.OPEN) user.client.send(JSON.stringify(data), { binary: false });
}

function disconnectUser(user) {
    broadcastToUser(user, {
        action: 'FORBIDDEN',
        notice: `Could not join`
    });
    user.client.close();
    console.log(`${user.name} disconnected`);
}

function updateUserLocation(user, location) {
    user.location = location;
}

const app = express();
const httpServer = http.createServer(app);
const wsServer = new WebSocket.Server({ server: httpServer });

app.get("/", (req, res) => { res.status(200).send('<h1>You have reached the Web service successfully!</h1><p>Please connect to WebSocket server from a WebSocket client for more features.</p>'); });

wsServer.on('error', err => console.log(err));

wsServer.on('listening', () => {
    console.log('WS Listening');
});

wsServer.on('connection', (clientConnection, req) => {
    console.log(`Client connected with ${req.url}`);
    const params = new URLSearchParams(url.parse(req.url).query);
    const user = {
        uuid: uuidv4(),
        name: params.get('name').trim() ?? 'Anonymous',
        location: {
            latitude: 0,
            longitude: 0
        },
        client: clientConnection
    }
    const room = params.get('room').trim();
    if(room) {
        if(addToRoom(room, user)) {

            // handle user dropping off
            user.client.on('close', () => {
                removeFromRoom(room, user);

                broadcastToRoom(room, {
                    action: 'UPDATE_PARTICIPANTS',
                    participants: getRoomUsers(room),
                    notice: `${user.name} left the room`
                });
            });

            // handle user typing a message, sending a message or manually leaving
            user.client.on('message', data => {

                const clientData = JSON.parse(data);

                switch(clientData.action) {
                    case 'MOVING': 
                        updateUserLocation(user, clientData.location);
                        broadcastToRoom(room, {
                            action: 'UPDATE_PARTICIPANTS',
                            participants: getRoomUsers(room),
                            notice: null
                        });
                        break;
                    case 'TYPING': 
                        broadcastToRoom(room, {
                            action: 'DISPLAY_CLIENT_ACTION',
                            notice: `${user.name} is typing a message`
                        });
                        break;
                    case 'MESSAGING':
                        broadcastToRoom(room, {
                            action: 'DISPLAY_CLIENT_MESSAGE',
                            message: clientData.message || false,
                            notice: false
                        });
                        break;
                    case 'DISCONNECTING':
                        broadcastToUser(user, {
                            action: 'GOODBYE',
                            notice: `Left ${room}`
                        });
                        
                        user.client.close();
                        break;
                }
            });

            broadcastToRoom(room, {
                action: 'UPDATE_PARTICIPANTS',
                participants: getRoomUsers(room),
                notice: `${user.name} joined the room`
            });

            broadcastToUser(user, {
                action: 'WELCOME',
                id: user.uuid,
                notice: `Welcome to ${room}`
            });
        }
        else disconnectUser(user);
    }
    else disconnectUser(user);
});

httpServer.listen(port, () => { console.log("Server started. Port: ", port); });

/* wsServer.on('connection', (client, req) => {
    console.log(`Client connected with ${req.url}`);
    const params = new Proxy(new URLSearchParams(req.url), {
        get: (searchParams, prop) => searchParams.get(prop),
    });
    if(!params.room) client.close();
    client.uuid = uuidv4();
    participants.push({
        uuid: client.uuid,
        name: params.name,
        room: params.room,
        client: client,
    });
    client.on('error', () => console.log('Error occured'));
    client.on('close', () => {
        console.log('Client disconnected')
        participants.splice(participants.findIndex(p => p.uuid === client.uuid), 1);
        wsServer.clients.forEach(connectedClient => {
            if(connectedClient.readyState === WebSocket.OPEN) connectedClient.send(JSON.stringify({ participants: participants.map(p => ({ uuid: p.uuid, name: p.name })), action: 'PARTICIPANT_UPDATE' }), { binary: false });
        });
    });
    client.on('message', data => {
        const message = {
            message: JSON.parse(data),
            action: 'MESSAGE'
        };
        console.log(message);
        wsServer.clients.forEach(connectedClient => {
            if(connectedClient.readyState === WebSocket.OPEN) connectedClient.send(JSON.stringify(message), { binary: false });
        });
    });
    wsServer.clients.forEach(connectedClient => {
        if(connectedClient.readyState === WebSocket.OPEN) connectedClient.send(JSON.stringify({ participants: participants.map(p => ({ uuid: p.uuid, name: p.name })), action: 'PARTICIPANT_UPDATE' }), { binary: false });
    });
    client.send(JSON.stringify({ id: client.uuid, action: 'REGISTER' }), { binary: false });
}) */
