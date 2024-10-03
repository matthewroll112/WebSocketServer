//Example client, sends request to create game and to add player to lobby
const WebSocket = require('ws');

const socket = new WebSocket('ws://localhost:8080');

socket.onopen = () => {
    console.log('Connected to web server');

    //Sending remove player
    command = {command : 'removePlayer', data : {id : "6618", player : "player"}
    };
    socket.send(JSON.stringify(command));
};

socket.onmessage = (event) => {
    console.log('From server:', event.data);
}

socket.onclose = () => {
    console.log('Disconnected from server');
}