const WebSocket = require('ws');
const {createGame, addPlayer, removePlayer, removeGame, updateScore, getPlayerScores} = require('./database');

const PORT = 8080;
const ws = new WebSocket.Server({port: PORT});
console.log(`Server started listening on port ${PORT}`);

//Store lobbies and connected sockets for players in lobby
const lobbies = new Map();

//Function to send players in lobby to each person in lobby
async function sendLobbyPlayerUpdate(id){
    if(lobbies.has(id)){

        //Get player names, format message
        const players = [];
        const sockets = [];

        lobbies.get(id).players.forEach(({playerName, socket}) => {
            players.push(playerName);
            sockets.push(socket);
        });
        const message = {
            status : 'playerUpdate',
            host : players[0],
            players: players
        }

        //Send message to all sockets in lobby
        sockets.forEach((socket) => {
            socket.send(JSON.stringify(message));
        });
    }
}

async function sendLobbyScoreUpdate(id) {
    if (lobbies.has(id)) {
        try {
            // Get scores from db
            const result = await getPlayerScores(id);

            if (!result) {
                return;
            }

            // Add all player names and scores to different lists
            const players = [];
            const scores = [];
            result.forEach(({ playerName, score }) => {
                players.push(playerName);
                scores.push(score);
            });

            //Get current lobby
            const lobby = lobbies.get(id);

            //Get next player to spin
            if(lobby.turnIndex >= lobby.players.length){
                lobby.turnIndex = 0;
            }
            const nextPlayer = lobby.players[lobby.turnIndex];

            // Ensure player is defined
            if (!nextPlayer) {
                console.log("No player to spin.");
                return;
            }

            // Format message
            const message = {
                status: 'gameUpdate',
                turn: nextPlayer.playerName,
                players: players,
                scores: scores
            };

            lobby.players.forEach(({ socket }) => {
                socket.send(JSON.stringify(message));
            });

            //Set all players to have not answered
            lobby.players.forEach(player => {
                player.hasAnswered = false;
            });

            // Increment turn index for the next player
            lobby.turnIndex += 1;

        } catch (error) {
            console.log('Error sending lobby score update:', error);
        }
    }
}

//When client connects
ws.on('connection', (socket) => {
    console.log('Client connected');

    //Listen for messages
    socket.on('message', async (message) => {
        console.log(`Message received: ${message}`);

        //Parse message (JSON)
        let data;
        try{
            data = JSON.parse(message);
        }
        catch (error){
            console.error("Invalid JSON:",error);
            return;
        }

        //Handling create game command
        if(data.command === 'createGame'){
            //Get host data
            const host = data.data;
            try{
                //Use database method to create game
                const result = await createGame(host);

                const id = result._id
                //Store socket in map for later use
                if(!lobbies.has(id)){
                    lobbies.set(id, {
                        players : [],
                        turnIndex : 0
                });
                }
                const playerName = host.name
                lobbies.get(id).players.push({socket, playerName, hasAnswered : false});

                //Send back response
                socket.send(JSON.stringify({status : 'success', gameId: id}));

                //Send player update
                sendLobbyPlayerUpdate(id);
            }
            catch(error){
                console.error('Error creating game:', error);
                socket.send(JSON.stringify({status:'error', message : "failed to create game"}));
            }
        }
        //Handling add player command
        else if(data.command === 'addPlayer'){
            //Get player data
            const gameId = data.data.id;
            const player = data.data.player;

            try{
                await addPlayer(gameId, player);

                //Store socket in map for later use
                if(!lobbies.has(gameId)){
                    lobbies.set(gameId, {
                        players : [],
                        turnIndex : 0
                });
                }
                const playerName = player.name
                lobbies.get(gameId).players.push({socket, playerName, hasAnswered : false});

                //Send back response
                socket.send(JSON.stringify({status : 'success', playerAdded : gameId}));

                //Send lobby update to all players
                sendLobbyPlayerUpdate(gameId);
            }
            catch(error){
                console.log('Error adding player', error);
                socket.send(JSON.stringify({status: 'error', message: "Failed to add player"}));
            }
        }
        //Handling remove player command
        else if(data.command === 'removePlayer'){
            const gameId = data.data.id;
            const playerName = data.data.player;

            try {
                await removePlayer(gameId, playerName);

                //Find lobby
                const lobby = lobbies.get(gameId);
                if (!lobby) {
                    socket.send(JSON.stringify({status: 'error', message: 'Lobby not found'}));
                    return;
                }

                //Find player to be removed
                const playerIndex = lobby.players.findIndex(entry => entry.playerName === playerName);
                if (playerIndex !== -1) {
                    const removedPlayer = lobby.players[playerIndex].socket;

                    //Notify the player that they've been kicked
                    removedPlayer.send(JSON.stringify({status: "kicked"}));

                    //Remove player from the array
                    lobby.players.splice(playerIndex, 1);

                    //Adjust current turn index if necessary
                    if (playerIndex === lobby.currentTurnIndex) {
                        lobby.currentTurnIndex = (lobby.currentTurnIndex - 1 + lobby.players.length) % lobby.players.length;
                    }

                    //If the lobby is now empty, remove it
                    if (lobby.players.length === 0) {
                        console.log(`Game ${gameId} empty. Removing from db.`);
                        await removeGame(gameId);
                        lobbies.delete(gameId);
                    }

                    //Notify the player who sent the remove command
                    socket.send(JSON.stringify({status: 'success', message: `${playerName} removed from lobby`}));

                    //Send lobby update to all remaining players
                    sendLobbyPlayerUpdate(gameId);
                    sendLobbyScoreUpdate(gameId);
                } else {
                    socket.send(JSON.stringify({status: 'error', message: 'Player not found in lobby'}));
                }

            } 
            catch (error) {
                console.log('Error removing player:', error);
                socket.send(JSON.stringify({status: 'error', message: 'Failed to remove player'}));
            }
        }
        //Handling score updates
        else if(data.command === "scoreUpdate"){
            const gameId = data.data.id;
            const playerName = data.data.player;
            
            //Find lobby player is in
            const players = lobbies.get(gameId);
            if(!players){
                //Lobby not found, send error
                socket.send(JSON.stringify({status : "error", message : "Lobby not found"}));
                return;
            }

            //If score has been updated, make change in database
            if(data?.data?.score){
                const score = data.data.score;
                await updateScore(gameId, playerName, score);
            }

            //Set player to has answered in map
            players.players.forEach(player => {
                if(player.playerName === playerName){
                    player.hasAnswered = true;
                }
            });

            //Check if all players have answered
            const allAnswered = players.players.every(player => player.hasAnswered);
            if(allAnswered){
                //All players have answered, broadcast scoreUpdate to all players
                sendLobbyScoreUpdate(gameId);
            }
        }
        //Handling broadcast of letter to all players in game
        else if(data.command === "broadcastLetter"){
            const gameId = data.data.id;
            const letter = data.data.letter;
            const isLast = data.data.lastQuestion;
            const index = data.data.index;

            //Broadcast letter to all players in game
            if(lobbies.has(gameId)){
                //Format message
                const message = {
                    status : 'letter',
                    letter : letter,
                    lastQuestion: isLast,
                    index : index
                }
        
                lobbies.get(gameId).players.forEach(({socket}) => {
                    socket.send(JSON.stringify(message));
                });
            }
        }
        //Handling of starting game
        else if(data.command === "startGame"){
            const gameId = data.data.id;

            //Broadcast game start to all players in game
            if(lobbies.has(gameId)){
                lobbies.get(gameId).players.forEach(({socket}) => {
                    socket.send(JSON.stringify({status : "startGame"}));
                })
            }

            //Broadcast score update
            sendLobbyScoreUpdate(gameId);
        }
    });

    //Handling socket disconnection
    socket.on('close', async () => {
        console.log('Client disconnected, removing from game');

        //Find lobby player was a part of
        for (const [gameId, lobby] of lobbies.entries()) {
            let disconnectedPlayer = null;

            //Find disconnected player
            for (const { playerName, socket: playerSocket } of lobby.players) {
                if (playerSocket === socket) {
                    disconnectedPlayer = playerName;
                    break;
                }
            }

            if (disconnectedPlayer) {
                //REmove player from DB
                try {
                    await removePlayer(gameId, disconnectedPlayer);
                } catch (error) {
                    console.error(`Error removing ${disconnectedPlayer} from game ${gameId}`);
                }

                //Remove player from the array
                const playerIndex = lobby.players.findIndex(entry => entry.socket === socket);
                if (playerIndex !== -1) {
                    //Check if the removed player was the current turn player
                    if (playerIndex === lobby.currentTurnIndex) {
                        //Adjust current turn index
                        lobby.currentTurnIndex = (lobby.currentTurnIndex - 1 + lobby.players.length) % lobby.players.length;
                    }
                    lobby.players.splice(playerIndex, 1);
                }

                //If no players left, remove game from db
                if (lobby.players.length === 0) {
                    try {
                        console.log(`Game ${gameId} is empty. Removing from db`);
                        await removeGame(gameId);
                        lobbies.delete(gameId);
                    } catch (error) {
                        console.error(`Error removing game ${gameId} from db`);
                    }
                } 
                else{
                    //Update remaining players on changes
                    await sendLobbyPlayerUpdate(gameId);
                    await sendLobbyScoreUpdate(gameId);
                }
            }
        }
    });
});