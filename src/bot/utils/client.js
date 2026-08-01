const { Client, Events, IntentsBitField } = require('discord.js');

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent,
    ]
});

client.on(Events.Error, (error) => {
    console.error('WebSocket encountered an error:', error);
});

client.on(Events.ShardError, (error) => {
    console.error('A websocket connection encountered an error:', error);
});

client.on(Events.ShardReconnecting, (id) => {
    console.log(`Shard ${id} is attempting to reconnect.`);
});

client.on(Events.ShardDisconnect, (event, id) => {
    console.warn(`Shard ${id} disconnected with code ${event.code}.`);
});

module.exports = { client };
