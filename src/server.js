const WebSocket = require('ws');
const {createGame, addPlayer, removePlayer, removeGame} = require('./database');

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
        lobbies.get(id).forEach(({playerName}) => {
            players.push(playerName);
        })
        const message = {
            status : 'playerUpdate',
            host : players[0],
            players: players
        }

        //Send message to all sockets in lobby
        lobbies.get(id).forEach(({socket}) => {
            socket.send(JSON.stringify(message));
        })
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

                //Store socket in map for later use
                const id = result._id;
                if(!lobbies.has(id)){
                    lobbies.set(id, new Set());
                }
                const playerName = host.name
                lobbies.get(id).add({socket, playerName});

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
        if(data.command === 'addPlayer'){
            //Get player data
            const gameId = data.data.id;
            const player = data.data.player;

            try{
                await addPlayer(gameId, player);

                //Store socket in map for later use
                if(!lobbies.has(gameId)){
                    lobbies.set(gameId, new Set());
                }
                const playerName = player.name
                lobbies.get(gameId).add({socket, playerName});

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
        if(data.command === 'removePlayer'){
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
                let removedPlayer = null;
                lobby.forEach(({socket, playerName: name}) => {
                    if (name === playerName) {
                        removedPlayer = socket;
                    }
                });
        
                if (removedPlayer) {
                    //Notify player that they've been kicked
                    removedPlayer.send(JSON.stringify({status: "kicked"}));
                    
                    //Remove player
                    lobby.forEach((entry) => {
                        if (entry.playerName === playerName) {
                            lobby.delete(entry);
                        }
                    });
        
                    //If the lobby is now empty, clean it up
                    if (lobby.size === 0) {
                        console.log(`Game ${gameId} empty. Removing from db.`)
                        await removeGame(gameId);
                        lobbies.delete(gameId);
                    }
        
                    // Notify the player who sent the remove command
                    socket.send(JSON.stringify({status: 'success', message: `${playerName} removed from lobby`}));
        
                    // Send lobby update to all remaining players
                    sendLobbyPlayerUpdate(gameId);
                } else {
                    socket.send(JSON.stringify({status: 'error', message: 'Player not found in lobby'}));
                }
        
            } catch (error) {
                console.log('Error removing player:', error);
                socket.send(JSON.stringify({status: 'error', message: 'Failed to remove player'}));
            }
        }
    });

    //Handling socket disconnection
    socket.on('close', async () => {
        console.log('Client disconnected, removing from game');

        //Find lobby player was a part of
        for(const [gameId, players] of lobbies.entries()){
            let disconnectedPlayer = null;

            //Find disconnected player
            for (const {playerName, socket : playerSocket} of players){
                if(playerSocket === socket){
                    disconnectedPlayer = playerName;
                    break;
                }
            }

            if(disconnectedPlayer){
                //REmove player from db
                try{
                    await removePlayer(gameId, disconnectedPlayer);
                }
                catch(error){
                    console.error(`Error removing ${disconnectedPlayer} from game ${gameId}`);
                }

                // Remove player from the map
                players.forEach((entry) => {
                    if (entry.socket === socket) {
                        players.delete(entry);
                    }
                });

                //If no players left, remove game from db
                if(players.size === 0){
                    try{
                        console.log(`Game ${gameId} is empty. Removing from db`);
                        await removeGame(gameId);
                        lobbies.delete(gameId);
                    }
                    catch(error){
                        console.error(`Error removing game ${gameId} from db`);
                    }
                }
                else{
                    //Update remaining players on changes
                    await sendLobbyPlayerUpdate(gameId);
                }
            }
        }
        
    });
});