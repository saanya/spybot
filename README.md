# 🕵️ Spyfall Telegram Bot

A feature-rich Telegram bot for playing the popular social deduction game Spyfall, inspired by @GoSpyBot.

## 🎮 About the Game

Spyfall is a social deduction game where players try to identify the spy among them without revealing the secret location. Everyone except the spy(ies) knows the location and has specific roles, while spies must figure out where they are by asking clever questions.

## ✨ Features

- **🎯 Complete Game Mechanics**: Full Spyfall implementation with 27 unique locations
- **🌐 Dual Language Support**: Ukrainian and Russian with easy switching
- **👥 Flexible Player Count**: 3-8 players with dynamic spy assignment
- **⏰ Smart Timing**: Configurable game duration (1-20 minutes) with auto-start
- **🎮 Interactive UI**: Inline keyboards for easy game joining
- **🕵️ Spy Features**: Location guessing with `/loc` command for instant wins
- **📱 Modern UX**: Real-time notifications and status updates

## 🚀 Quick Start

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Telegram Bot Token from [@BotFather](https://t.me/BotFather)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd spybot
   ```

2. **Install dependencies**
   ```bash
   npm install
   # or
   yarn install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env and add your bot token:
   # BOT_TOKEN=your_telegram_bot_token_here
   ```

4. **Start the bot**
   ```bash
   npm start
   # or for development with auto-reload:
   npm run dev
   ```

## 🎲 How to Play

### 🚀 Quick Start Guide

1. **Add the bot to your group chat** (games only work in groups!)
2. **Create a game** with `/newgame` in the group
3. **Players join** by clicking "🎮 Join Game" or using `/join`
4. **Game auto-starts** after 3+ players join (60-second countdown)
5. **Play the game** by asking questions to find the spy!

### Basic Commands

- `/start` - Welcome message and setup instructions
- `/newgame` - Create a new game with join buttons (groups only)
- `/join` - Join the current game (groups only)
- `/players` - Show current players
- `/startgame` - Start the game immediately
- `/help` - Show all available commands

> **Important:** All game commands only work in group chats! The bot will explain this if you try to use commands in private messages.

### Game Settings

- `/settings` - View current game settings
- `/settime [1-20]` - Set game duration in minutes
- `/setlang [uk/ru]` - Switch between Ukrainian/Russian

### During Game

- `/time` - Check remaining time
- `/vote` - Start voting to eliminate a suspected spy
- `/votes` - Check current voting status and results
- `/loc [location]` - (Spies only) Guess the location
- `/endgame` - End the current game

### Voting System

- **Start Voting**: Use `/vote` to begin a 60-second voting period
- **Cast Vote**: Type a number (1, 2, 3...) to vote for that player
- **Check Status**: Use `/votes` to see current vote counts
- **Results**: Player with most votes gets eliminated
- **Ties**: If there's a tie, no one is eliminated

### Game Flow

1. **Create Game**: Use `/newgame` to start
2. **Join Players**: Click "🎮 Join Game" button or use `/join`
3. **Auto-Start**: Game starts automatically 60 seconds after 3+ players join
4. **Play**: Ask questions to find spies without revealing the location
5. **Win Conditions**:
   - **Spies win**: Correctly guess location with `/loc`
   - **Agents win**: Identify all spies or time runs out

## 🏗️ Game Rules

### Player Count & Spies
- **1-4 players**: 1 spy
- **5-8 players**: 2 spies

### Roles
- **Agents**: Know the location and have specific roles
- **Spies**: Don't know location but know each other (if 2 spies)

### Locations
27 diverse locations including:
- Літак (Airplane)
- Банк (Bank)
- Пляж (Beach)
- Казино (Casino)
- Цирк (Circus)
- And many more...

## 🛠️ Technical Details

### Project Structure
```
spybot/
├── src/
│   ├── index.js      # Main bot logic and commands
│   ├── game.js       # Game state management
│   └── locations.js  # Game locations and roles
├── package.json      # Dependencies and scripts
├── CLAUDE.md         # Detailed project documentation
└── README.md         # This file
```

### Key Features Implementation

- **Game State Management**: In-memory storage with Map for multiple chat support
- **Auto-Start Timer**: 60-second countdown after minimum players join
- **Language System**: Dynamic location/role loading based on user preference
- **Interactive UI**: Telegram inline keyboards for better UX
- **Error Handling**: Comprehensive validation and user feedback

### Dependencies

- `node-telegram-bot-api`: Telegram Bot API wrapper
- `dotenv`: Environment variable management
- `nodemon`: Development auto-reload (dev dependency)

## 🔧 Development

### Running in Development Mode
```bash
npm run dev
```

### Environment Variables
- `BOT_TOKEN`: Your Telegram bot token from @BotFather

### Code Style
- ES6+ JavaScript
- Modular architecture
- Comprehensive error handling
- User-friendly error messages

## 📝 Commands Reference

| Command | Description | Usage |
|---------|-------------|-------|
| `/start` | Show welcome message | `/start` |
| `/newgame` | Create new game | `/newgame` |
| `/join` | Join current game | `/join` |
| `/leave` | Leave game (before start) | `/leave` |
| `/players` | Show player list | `/players` |
| `/startgame` | Start game manually | `/startgame` |
| `/endgame` | End current game | `/endgame` |
| `/time` | Check remaining time | `/time` |
| `/loc` | Spy location guess | `/loc Банк` |
| `/settings` | View game settings | `/settings` |
| `/settime` | Set game duration | `/settime 10` |
| `/setlang` | Set language | `/setlang uk` |
| `/help` | Show help message | `/help` |

## 🎯 Tips for Players

### For Agents (Non-Spies)
- Ask questions that show you know the location
- Be specific but don't make it obvious
- Watch for vague or evasive answers
- Work together to identify spies

### For Spies
- Ask general questions that could apply anywhere
- Give vague but plausible answers
- Listen carefully to gather location clues
- Use `/loc` when confident about the location
- If there are 2 spies, coordinate but don't make it obvious

## 🤝 Contributing

Feel free to contribute by:
- Adding new locations and roles
- Improving game mechanics
- Adding new languages
- Fixing bugs and improving code quality

## 📄 License

MIT License - see LICENSE file for details.

## 🙏 Acknowledgments

- Inspired by @GoSpyBot
- Based on the original Spyfall game
- Built with love for the Telegram community

---

**Ready to play?** Add the bot to your group and start with `/newgame`! 🕵️