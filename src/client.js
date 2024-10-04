//Example client, sends request to create game and to add player to lobby
const WebSocket = require('ws');

const socket = new WebSocket('ws://localhost:8080');

socket.onopen = () => {
    console.log('Connected to web server');

    //Sending add player
    command = {command : 'addPlayer', data : {id : "3619", player : {
        name : "player",
        data : {
            score : 0,
            difficulty : "medium",
            category : "verbs"
        }
    }}};
    socket.send(JSON.stringify(command));
};

socket.onmessage = (event) => {
    console.log('From server:', event.data);
}

socket.onclose = () => {
    console.log('Disconnected from server');
}