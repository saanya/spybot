require('dotenv').config();
const SpyfallGame = require('./src/game');
const { getTranslation } = require('./src/translations');

// Check environment variables
console.log('BOT_USERNAME:', process.env.BOT_USERNAME);
console.log('BOT_TOKEN:', process.env.BOT_TOKEN ? 'SET' : 'NOT SET');

// Create a test game
const game = new SpyfallGame('-123456');
game.setCreatorUsername('TestUser');

// Generate the message
const message = game.generateGameMessage();
console.log('\nGenerated message:');
console.log(message);
console.log('\n=== CHECKING FOR MARKDOWN ISSUES ===');

// Check for unmatched ** markers
const doubleStars = message.match(/\*\*/g);
if (doubleStars) {
  console.log(`Found ${doubleStars.length} ** markers`);
  if (doubleStars.length % 2 !== 0) {
    console.log('ERROR: Unmatched ** markers! Found odd number of ** markers.');
  } else {
    console.log('OK: Even number of ** markers found.');
  }
} else {
  console.log('No ** markers found.');
}

// Look for specific problematic patterns
const lines = message.split('\n');
lines.forEach((line, index) => {
  const starCount = (line.match(/\*\*/g) || []).length;
  if (starCount % 2 !== 0) {
    console.log(`Line ${index + 1} has unmatched ** markers: "${line}"`);
  }
});

// Test button generation
const lang = game.getLanguage();
const chatId = '-123456';

console.log('\n=== TESTING BUTTON GENERATION ===');
const joinKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        {
          text: getTranslation('join_game_button', lang),
          url: `https://t.me/${process.env.BOT_USERNAME}?start=join_${chatId}`
        }
      ],
      [
        {
          text: getTranslation('view_players_button', lang),
          callback_data: "view_players"
        }
      ]
    ]
  }
};

console.log('Join button text:', getTranslation('join_game_button', lang));
console.log('View players button text:', getTranslation('view_players_button', lang));
console.log('Join URL:', `https://t.me/${process.env.BOT_USERNAME}?start=join_${chatId}`);
console.log('Full keyboard object:', JSON.stringify(joinKeyboard, null, 2));