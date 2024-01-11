//register-commands.js

require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');




const commands = [
    {
        name: 'search',
        description: 'Search for vehicles!',
        options: [
          {
            name: 'location',
            description: 'The location to search in',
            type: ApplicationCommandOptionType.String,
            choices: [
                {
                    name: 'Boise',
                    value: 'boise',
                    description: 'Search in Boise',
                    type: ApplicationCommandOptionType.Subcommand,
                },
                {
                    name: 'Garden City',
                    value: 'gardencity',
                    description: 'Search in Garden City',
                    type: ApplicationCommandOptionType.Subcommand,
                },
                {
                    name: 'Nampa',
                    value: 'nampa',
                    description: 'Search in Nampa',
                    type: ApplicationCommandOptionType.Subcommand,
                },
                {
                    name: 'Caldwell',
                    value: 'caldwell',
                    description: 'Search in Caldwell',
                    type: ApplicationCommandOptionType.Subcommand,
                },
                {
                    name: 'Twin Falls',
                    value: 'twinfalls',
                    description: 'Search in Twin Falls',
                    type: ApplicationCommandOptionType.Subcommand,
                }
            ],
                
            required: true,
          },
          {
            name: 'make',
            description: 'The make of the vehicle',
            type: ApplicationCommandOptionType.String,
            required: false,
          },
          {
            name: 'model',
            description: 'The model of the vehicle',
            type: ApplicationCommandOptionType.String,
            required: false,
          },
        ],
      },
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log('Slash commands were registered successfully!');
  } catch (error) {
    console.log(`There was an error: ${error}`);
  }
})();