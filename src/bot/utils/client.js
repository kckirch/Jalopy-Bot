const { Client, IntentsBitField } = require('discord.js');

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent,
    ]
});

client.on('error', (error) => {
    console.error('WebSocket encountered an error:', error);
});

client.on('shardError', (error) => {
    console.error('A websocket connection encountered an error:', error);
});

client.on('disconnect', (event) => {
    console.warn(`Disconnected from Discord with code ${event.code}.`);
});

client.on('reconnecting', () => {
    console.log('Attempting to reconnect to Discord...');
});

client.on('shardDisconnect', (event, id) => {
    console.warn(`Shard ${id} disconnected with code ${event.code}.`);
});

module.exports = { client };
