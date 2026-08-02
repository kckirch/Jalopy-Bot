const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const { Events } = require('discord.js');

const { client } = require('./utils/client.js');
const { setupDatabase } = require('../database/database');
const { startScheduledTasks } = require('../notifications/scheduler');
const { handleInteraction } = require('./handlers/interactionHandler');
let readyHandled = false;

// Initialize database
setupDatabase().then(() => {
  console.log('Database setup completed successfully.');
}).catch((error) => {
  console.error('Failed to set up database:', error);
});

client.on(Events.ClientReady, async (c) => {
  console.log(`✅   ${c.user.tag} is online.  ✅`);
  if (!readyHandled) {
    readyHandled = true;
    try {
      startScheduledTasks();
      console.log('Scheduled tasks started.');
      console.log("Current server time:", new Date().toLocaleString());
    } catch (error) {
      console.error('Failed to start scheduled tasks:', error);
    }
  } else {
    console.log('Ready event received again; scheduled tasks already initialized.');
  }
});

client.on(Events.InteractionCreate, handleInteraction);

client.login(process.env.TOKEN).catch((error) => {
  console.error('Failed to login:', error);
});
