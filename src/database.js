const {MongoClient} = require('mongodb');

//db consts
const uri = 'mongodb+srv://keme_reo_app:6aVHagyBMuCI04Ee@kemureo.tvclk.mongodb.net/?retryWrites=true&w=majority&appName=kemureo'
const dbName = 'kemureo';

//Function to get players in a lobby
async function getPlayers(id){
    const client = new MongoClient(uri)
    let playerNames = []

    try{
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(dbName);

        //Find game by id
        const game = await collection.findOne({_id : id});

        //Check if game has players
        if(game && game.players){
            //Extract player names
            playerNames = Object.keys(game.players);
        }
    }
    catch(error){
        console.error('Error retrieving players:', error);
    }
    finally{
        await client.close();
    }

    return playerNames;
}

//Function to create game
async function createGame(host){
    const client = new MongoClient(uri);

    try{
        //Connect to collection
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('games');

        //Generate ID
        const id = await genGameId(collection);
        const playerName = host.name;
        const data = host.data;

        const newGame = {
            _id: id,
            players : { 
                [`${playerName}`] : data
            },
            settings : {
                host_plays : true,
                easy_time : 20,
                med_time : 10,
                hard_time : 5
            }
        };

        //Insert game, display id of insert
        const result = await collection.insertOne(newGame);
        console.log("Game inserted:", result.insertedId);
        //Return game object
        return newGame;
    }
    catch(error){
        console.log("Error inserting game:", error);
        throw error
    }
    finally{
        await client.close();
    }
}

//Helper func to generate random id
//Messy, but gets the job done
const genGameId = async (collection) => {
    let id;
    let exists = true;

    while(exists){
        //Gen random id
        id = Math.floor(1000 + Math.random() * 9000).toString();
        //Count all games with same id
        const count = await collection.countDocuments({_id: id});
        //Continue looping if id exists
        exists = count > 0;
    }

    return id;
}

//Function to add player to game
async function addPlayer(id, player){
    const client = new MongoClient(uri);

    try{
        //Connect to collection
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('games');

        //Form update for db
        const update = {
            $set : {
                [`players.${player.name}`] : player.data
            }
        }

        //Update game
        await collection.updateOne({_id:id}, update);
        console.log(`${player.name} added in game ${id}`);
    }
    catch(error){
        console.log('Error adding player to game:', error);
        throw error;
    }
    finally{
        await client.close();
    }
}

//Function to remove player from game
async function removePlayer(id, player){
    const client = new MongoClient(uri);

    try{
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('games');

        //Form update for db
        const update = {
            $unset : {
                [`players.${player}`] : ""
            }
        }

        await collection.updateOne({_id:id}, update);
        console.log(`${player} removed from game ${id}`);
    }
    catch(error){
        console.log('Error removing player from game:', error);
        throw error;
    }
    finally{
        await client.close();
    }
}

//Function to remove a game from collection
async function removeGame(id){
    const client = new MongoClient(uri);

    try{
        client.connect();
        const db = client.db(dbName);
        const collection = db.collection('games');

        await collection.deleteOne({_id : id});
    }
    catch(error){
        console.log('Error removing game from database', error);
        throw error;
    }
    finally{
        await client.close();
    }
}

//Function to update player scores
async function updateScore(id, name, score){
    const client = new MongoClient(uri);

    try{
        client.connect();
        const db = client.db(dbName);
        const collection = db.collection('games');

        const update = {$set: {[`players.${name}.score`]: score}};

        await collection.updateOne({_id : id}, update);
        console.log(`${name} score updated to ${score}`);
    }
    catch(error){
        console.log('Error updating score:', error);
        throw error;
    }
    finally{
        await client.close();
    }
}

async function getPlayerScores(id){
    const client = new MongoClient(uri);

    try{
        client.connect();
        const db = client.db(dbName);
        const collection = db.collection('games');

        const game = await collection.findOne({_id : id});

        if(!game){
            console.log(`Game ${id} not found`);
            return null;
        }

        //Get player scores and return
        const playerScores = [];
        for(const [playerName, playerData] of Object.entries(game.players)) {
            playerScores.push({
                playerName : playerName,
                score : playerData.score
            });
        }

        return playerScores;
    }
    catch(error){
        console.log('Error retrieving scores', error);
        throw error;
    }
    finally{
        await client.close();
    }
}

module.exports = {
    createGame,
    addPlayer,
    getPlayers,
    removePlayer,
    removeGame,
    updateScore,
    getPlayerScores
};