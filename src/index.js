const TelegramBot = require('node-telegram-bot-api');
const SpyfallGame = require('./game');
const { getTranslation } = require('./translations');
require('dotenv').config();

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Store active games by chat ID
const activeGames = new Map();

// Helper function to get or create game
function getGame(chatId) {
  console.log(`[GETGAME] Looking for game with chatId: ${chatId} (type: ${typeof chatId})`);
  console.log(`[GETGAME] Active games:`, Array.from(activeGames.keys()));
  
  if (!activeGames.has(chatId)) {
    console.log(`[GETGAME] Creating new game for chatId: ${chatId}`);
    activeGames.set(chatId, new SpyfallGame(chatId));
  } else {
    console.log(`[GETGAME] Found existing game for chatId: ${chatId}`);
  }
  return activeGames.get(chatId);
}

// Format time in MM:SS
function formatTime(milliseconds) {
  const minutes = Math.floor(milliseconds / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Helper function to get user display name (full name when possible, nickname if no real name)
function getDisplayName(user) {
  if (!user) return 'Player';
  
  // Build full name from first_name + last_name
  let fullName = '';
  if (user.first_name) fullName += user.first_name;
  if (user.last_name) fullName += ` ${user.last_name}`;
  fullName = fullName.trim();
  
  // Priority: full name > username (nickname) > fallback
  if (fullName) return fullName;
  if (user.username) return user.username;
  
  return 'Player';
}

// Helper function to generate voting message with current vote breakdown
function generateVotingMessage(game, lang) {
  const nominees = game.getNominees();
  const voteResults = game.getVoteResults();
  
  let message = `${getTranslation('voting_started', lang)}\n\n`;
  message += `${getTranslation('nominees_list', lang)}\n`;
  
  nominees.forEach((nominee, index) => {
    message += `${index + 1}. **${nominee.username}**\n`;
    
    // Show voting breakdown for this nominee
    const voterDetails = voteResults.voterDetails.get(nominee.id);
    if (voterDetails) {
      if (voterDetails.forVoters.length > 0) {
        const forText = lang === 'uk' ? 'За' : 'За';
        message += `   👍 ${forText}: ${voterDetails.forVoters.join(', ')}\n`;
      }
      if (voterDetails.againstVoters.length > 0) {
        const againstText = lang === 'uk' ? 'Проти' : 'Против';
        message += `   👎 ${againstText}: ${voterDetails.againstVoters.join(', ')}\n`;
      }
    }
    message += `\n`;
  });
  
  message += `${getTranslation('vote_by_buttons', lang)}\n`;
  message += `${getTranslation('voting_time_seconds', lang, {seconds: Math.ceil(game.getVotingTime() / 1000)})}`;
  
  return message;
}

// Helper function to clean up game messages
function cleanupGameMessages(chatId, game) {
  const messagesToDelete = game.getMessageIdsToDelete();
  const mainMessageId = game.getGameMessageId();
  
  // Unpin the main game message first
  if (mainMessageId) {
    bot.unpinChatMessage(chatId, { message_id: mainMessageId }).then(() => {
      console.log(`[CLEANUP] Game message unpinned successfully`);
    }).catch((unpinError) => {
      console.log(`[CLEANUP] Could not unpin message (bot may not have admin rights): ${unpinError.message}`);
    });
  }
  
  // Delete messages in batches to avoid rate limits
  messagesToDelete.forEach((messageId, index) => {
    setTimeout(() => {
      bot.deleteMessage(chatId, messageId).catch((error) => {
        // Ignore errors for messages that are already deleted or can't be deleted
        console.log(`Could not delete message ${messageId}:`, error.message);
      });
    }, index * 100); // 100ms delay between deletions
  });
  
  game.clearMessageIds();
}

// Helper function to track and send message
function sendAndTrackMessage(chatId, text, options = {}) {
  return bot.sendMessage(chatId, text, options).then((sentMessage) => {
    const game = getGame(chatId);
    game.addMessageToDelete(sentMessage.message_id);
    return sentMessage;
  });
}

// Helper function to generate role list for game end
function generateRoleList(game) {
  const gameLanguage = game.getLanguage();
  const spyWord = gameLanguage === 'uk' ? 'Шпигун' : 'Шпион';
  const agentWord = gameLanguage === 'uk' ? 'Агент' : 'Агент';
  
  let roleList = '\n\n' + getTranslation('player_roles', gameLanguage) + '\n';
  
  game.players.forEach((player) => {
    const role = game.isSpy(player.id) ? spyWord : agentWord;
    const spyIcon = game.isSpy(player.id) ? '🕵️' : '👤';
    roleList += `${spyIcon} ${player.username}: ${role}\n`;
  });
  
  return roleList;
}

// Helper function to end game due to timeout
function endGameDueToTimeout(chatId, game) {
  const playerCount = game.getPlayerCount();
  const lang = game.getLanguage();
  
  let message = `⏰ **GAME EXPIRED** ⏰\n\n`;
  message += `${getTranslation('game_expired_timeout', lang)}\n\n`;
  
  if (playerCount === 0) {
    message += `${getTranslation('no_players_joined', lang)}\n\n`;
  } else {
    message += `${getTranslation('players_who_joined', lang, {count: playerCount})}\n`;
    game.players.forEach((player, index) => {
      message += `${index + 1}. ${player.username}\n`;
    });
    message += `\n`;
  }
  
  message += `${getTranslation('minimum_players_required', lang)}\n`;
  message += `${getTranslation('time_limit_info', lang)}\n\n`;
  message += `${getTranslation('try_again_newgame', lang)}`;
  
  // Add main game message to cleanup list before final cleanup
  const mainMessageId = game.getGameMessageId();
  if (mainMessageId) {
    game.addMessageToDelete(mainMessageId);
    console.log(`[TIMEOUT] Adding main game message ${mainMessageId} to cleanup list`);
  }
  
  // Clean up all game messages before showing timeout message
  cleanupGameMessages(chatId, game);
  
  // Send timeout message after a brief delay
  setTimeout(() => {
    bot.sendMessage(chatId, message);
  }, 500);
  
  game.reset();
}

// Helper function to update game message
function updateGameMessage(chatId, game) {
  const messageId = game.getGameMessageId();
  console.log(`[UPDATE] updateGameMessage called: chatId=${chatId}, messageId=${messageId}, playerCount=${game.getPlayerCount()}`);
  console.log(`[UPDATE] Current players:`, game.players.map(p => p.username));
  console.log(`[UPDATE] Game object chatId: ${game.chatId}`);
  
  if (!messageId) {
    console.log('[UPDATE] No message ID to update - message might not have been sent yet or ID not stored');
    console.log(`[UPDATE] Checking game properties: chatId=${game.chatId}, creatorUsername=${game.getCreatorUsername()}`);
    return;
  }
  
  console.log(`Updating message ${messageId} for chat ${chatId} with ${game.getPlayerCount()} players`);
  
  const lang = game.getLanguage();
  const joinUrl = `https://t.me/${process.env.BOT_USERNAME}?start=join_${chatId}`;
  console.log(`[UPDATE] Join button URL: ${joinUrl}`);
  
  const joinKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: getTranslation('join_game_button', lang),
            url: joinUrl
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
  
  const gameMessage = game.generateGameMessage();
  console.log(`Updating message ${messageId} with ${game.getPlayerCount()} players:`, game.players.map(p => p.username));
  console.log('New message content:', gameMessage);
  
  // Add small delay to avoid rate limiting
  setTimeout(() => {
  
  bot.editMessageText(gameMessage, {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: joinKeyboard.reply_markup,
    parse_mode: 'Markdown'
  }).then(() => {
    console.log('Message updated successfully with buttons');
  }).catch((error) => {
    // Check if the error is because the message content is the same
    if (error.message.includes('message is not modified')) {
      console.log('Message content unchanged, skipping edit');
      return;
    }
    
    console.error('Failed to edit message with markup:', error.message);
    
    // If message editing fails completely, send a new message with buttons
    if (error.response?.body?.error_code === 400) {
      console.log('Message editing failed, sending new message with buttons');
      
      bot.sendMessage(chatId, gameMessage, {
        reply_markup: joinKeyboard.reply_markup,
        parse_mode: 'Markdown'
      }).then((sentMessage) => {
        // Update the stored message ID to the new message
        game.setGameMessageId(sentMessage.message_id);
        game.addMessageToDelete(sentMessage.message_id);
        console.log('New message sent with buttons, ID:', sentMessage.message_id);
      }).catch((sendError) => {
        console.error('Failed to send new message:', sendError.message);
      });
    } else {
      // Try again without reply_markup in case that's the issue
      bot.editMessageText(gameMessage, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
      }).then(() => {
        console.log('Message updated successfully without markup');
      }).catch((error2) => {
        // Check if the error is because the message content is the same
        if (error2.message.includes('message is not modified')) {
          console.log('Message content unchanged, skipping edit without markup');
          return;
        }
        console.error('Failed to edit message without markup:', error2.message);
        
        // Try again without parse_mode as final fallback
        bot.editMessageText(gameMessage, {
          chat_id: chatId,
          message_id: messageId
        }).catch((error3) => {
          // Check if the error is because the message content is the same
          if (error3.message.includes('message is not modified')) {
            console.log('Message content unchanged, skipping final fallback edit');
            return;
          }
          console.error('Final fallback failed:', error3.message);
        });
      });
    }
  });
  }, 100); // 100ms delay
}

// Helper function to start game
function startGameNow(chatId, game) {
  if (game.startGame()) {
    // Clean up all pre-game messages
    cleanupGameMessages(chatId, game);
    
    const gameDuration = game.getDuration();
    const lang = game.getLanguage();
    sendAndTrackMessage(chatId, `${getTranslation('game_started', lang)}${game.getLocation()}${getTranslation('game_duration_info', lang)}${gameDuration}${getTranslation('minutes_to_find', lang)}`);
    
    // Send roles to players privately
    game.players.forEach(player => {
      console.log(`Sending role to ${player.username}: ${player.role}, isSpy: ${game.isSpy(player.id)}`);
      let roleMessage;
      const gameLanguage = game.getLanguage();
      
      if (game.isSpy(player.id)) {
        const spyCount = game.getSpyCount();
        const spyTeam = game.getSpyPlayers().map(s => s.username).join(', ');
        const showLocation = game.getShowLocation();
        
        if (showLocation) {
          // Normal mode - spies get full instructions AND location
          roleMessage = `${getTranslation('you_are_spy', gameLanguage)}\n${getTranslation('location_label', gameLanguage)}${game.getLocation()}\n\n${getTranslation('spy_objective', gameLanguage)}\n${getTranslation('determine_location', gameLanguage)}\n${getTranslation('dont_show_ignorance', gameLanguage)}\n${getTranslation('ask_smart_questions', gameLanguage)}\n${getTranslation('use_word_command', gameLanguage)}\n\n${spyCount > 1 ? `${getTranslation('spy_team', gameLanguage)}${spyTeam}\n` : ''}${getTranslation('good_luck', gameLanguage)}`;
        } else {
          // Hard mode - spies get minimal instructions (no location)
          roleMessage = `${getTranslation('you_are_spy', gameLanguage)}\n${getTranslation('hard_mode', gameLanguage)}\n\n${getTranslation('spy_objective', gameLanguage)}\n${getTranslation('determine_location', gameLanguage)}\n${getTranslation('ask_smart_questions', gameLanguage)}\n\n${spyCount > 1 ? `${getTranslation('spy_team', gameLanguage)}${spyTeam}\n` : ''}${getTranslation('good_luck', gameLanguage)}`;
        }
      } else {
        // Agents ALWAYS see location and their role
        roleMessage = `${getTranslation('your_role', gameLanguage)}${player.role}\n${getTranslation('location_label', gameLanguage)}${game.getLocation()}\n\n${getTranslation('agent_objective', gameLanguage)}\n• ${getTranslation('ask_proving_questions', gameLanguage)}\n${getTranslation('ask_questions_about', gameLanguage)} "${player.role}" ${getTranslation('to_identify_spy', gameLanguage)}\n\n${getTranslation('good_luck', gameLanguage)}`;
      }
      
      bot.sendMessage(player.id, roleMessage).catch(() => {
        bot.sendMessage(chatId, `${getTranslation('cant_send_private', lang)}${player.username}${getTranslation('start_chat_with_bot', lang)}`);
      });
    });
    
    // Set timer to end game
    setTimeout(() => {
      if (game.isActive && game.isTimeUp()) {
        const spies = game.getSpyPlayers();
        const spyNames = spies.map(spy => spy.username).join(', ');
        const gameLanguage = game.getLanguage();
        
        let timeoutMessage;
        const lastGuess = game.getLastSpyGuess();
        if (gameLanguage === 'uk') {
          const spyText = spies.length === 1 ? 'шпигун був' : 'шпигуни були';
          timeoutMessage = `⏰ Час вийшов!\n\n📍 Локація була: **${game.getLocation()}**`;
          timeoutMessage += `\n🎭 Слово було: **${game.getAgentRole()}**`;
          timeoutMessage += `\n🕵️ ${spyText.charAt(0).toUpperCase() + spyText.slice(1)}: **${spyNames}**`;
        } else {
          const spyText = spies.length === 1 ? 'шпион был' : 'шпионы были';
          timeoutMessage = `⏰ Время вышло!\n\n📍 Локация была: **${game.getLocation()}**`;
          timeoutMessage += `\n🎭 Слово было: **${game.getAgentRole()}**`;
          timeoutMessage += `\n🕵️ ${spyText.charAt(0).toUpperCase() + spyText.slice(1)}: **${spyNames}**`;
        }
        
        // Add role list
        timeoutMessage += generateRoleList(game);
        timeoutMessage += gameLanguage === 'uk' ? '\n\nВикористовуйте /newgame щоб зіграти знову!' : '\n\nИспользуйте /newgame чтобы играть снова!';
        
        // Add main game message to cleanup list before final cleanup
        const mainMessageId = game.getGameMessageId();
        if (mainMessageId) {
          game.addMessageToDelete(mainMessageId);
        }
        
        // Clean up all game messages
        cleanupGameMessages(chatId, game);
        setTimeout(() => {
          bot.sendMessage(chatId, timeoutMessage);
        }, 500);
        
        // Fully reset the game state so new games can be created
        game.reset();
      }
    }, game.gameLength);
  }
}

// Start command
bot.onText(/^\/start(.*)/, (msg, match) => {
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;
  const startParam = match[1] ? match[1].trim() : '';
  
  // Handle join parameter from URL button click
  if (startParam.startsWith('join_') && chatType === 'private') {
    const groupChatId = parseInt(startParam.replace('join_', ''), 10); // Convert string to number
    const userId = msg.from.id;
    const username = getDisplayName(msg.from);
    
    console.log(`URL Join attempt: startParam="${startParam}", groupChatId="${groupChatId}", userId=${userId}, username=${username}`);
    
    // Get the game from the group chat
    const game = getGame(groupChatId);
    console.log(`[URL-JOIN] Retrieved game for chat ${groupChatId}:`, {
      exists: !!game,
      isActive: game?.isActive,
      playerCount: game?.getPlayerCount(),
      messageId: game?.getGameMessageId(),
      creator: game?.getCreatorUsername()
    });
    
    const lang = game.getLanguage();
    
    if (!game || game.isActive) {
      bot.sendMessage(chatId, getTranslation('game_not_available', lang));
      return;
    }
    
    // Check if game is full
    if (game.getPlayerCount() >= 8) {
      bot.sendMessage(chatId, getTranslation('too_many_players', lang));
      return;
    }
    
    // Try to join the game
    const addResult = game.addPlayer(userId, username);
    console.log(`URL addPlayer result: ${addResult}, playerCount: ${game.getPlayerCount()}`);
    
    if (addResult) {
      const playerCount = game.getPlayerCount();
      console.log(`Player ${username} successfully joined via URL! New count: ${playerCount}`);
      
      // Clear timeout if we reached minimum players
      if (playerCount >= 3) {
        game.clearGameTimeout();
      }
      
      // Send confirmation to user in private chat
      bot.sendMessage(chatId, getTranslation('joined_successfully_private', lang, {count: playerCount}));
      
      // Update game message in group
      console.log(`[URL-JOIN] About to update game message: groupChatId=${groupChatId}, messageId=${game.getGameMessageId()}`);
      updateGameMessage(groupChatId, game);
      
      // Send join notification to group
      sendAndTrackMessage(groupChatId, getTranslation('player_joined_game', lang, {username, count: playerCount}));
      
      // Auto-start logic if enough players
      if (game.canAutoStart()) {
        game.startWaiting();
        updateGameMessage(groupChatId, game);
        
        // Set auto-start timer
        setTimeout(() => {
          if (game.isWaitTimeUp() && !game.isActive) {
            startGameNow(groupChatId, game);
          }
        }, 60000);
      }
    } else {
      console.log(`Player ${username} failed to join via URL - already in game or other error`);
      bot.sendMessage(chatId, getTranslation('already_in_game', lang));
    }
    return;
  }
  
  // Get language from game settings if in group, otherwise use default
  const game = chatType === 'private' ? null : getGame(chatId);
  const lang = game ? game.getLanguage() : 'uk'; // Default to Ukrainian
  
  let welcomeMessage;
  
  if (chatType === 'private') {
    // Private chat message
    welcomeMessage = `${getTranslation('welcome_title', lang)}

${getTranslation('welcome_description', lang)}

${getTranslation('how_to_start', lang)}
${getTranslation('add_to_group', lang)}
${getTranslation('create_game', lang)}
${getTranslation('join_game', lang)}
${getTranslation('auto_start', lang)}

${getTranslation('why_groups', lang)}
${getTranslation('multiplayer_explanation', lang)}

${getTranslation('settings_commands', lang)}
• /help - ${getTranslation('help_title', lang)}
• /setlang [uk/ru] - ${getTranslation('language', lang)}
• /settime [1-20] - ${getTranslation('duration', lang)}

${getTranslation('game_rules', lang)}
${getTranslation('spy_count_rule', lang)}
${getTranslation('location_rule', lang)}
${getTranslation('spy_knowledge', lang)}
${getTranslation('objective', lang)}

${getTranslation('ready_to_play', lang)}`;
  } else {
    // Group chat message - but only if no game is active or waiting
    if (game && (game.isActive || game.waitingToStart || game.getPlayerCount() > 0)) {
      // Game is already active, waiting, or has players - don't send welcome message
      console.log(`[START] Skipping group welcome message - game exists in chat ${chatId} (active: ${game.isActive}, waiting: ${game.waitingToStart}, players: ${game.getPlayerCount()})`);
      return;
    }
    
    welcomeMessage = `${getTranslation('group_welcome', lang)}

${getTranslation('group_instructions', lang)}`;
  }

  bot.sendMessage(chatId, welcomeMessage);
});

// New game command
bot.onText(/^\/newgame/, (msg) => {
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;
  const username = getDisplayName(msg.from);
  
  // Check if command is used in private chat
  if (chatType === 'private') {
    bot.sendMessage(chatId, getTranslation('groups_only', 'uk'));
    return;
  }
  
  const game = getGame(chatId);
  const lang = game.getLanguage();
  
  // Prevent new game if there's already a game (active or waiting)
  if (game.isActive) {
    sendAndTrackMessage(chatId, getTranslation('game_in_progress', lang));
    return;
  }
  
  // Prevent new game if there's already a waiting game with players or creator
  if (game.getPlayerCount() > 0 || game.waitingToStart || game.getCreatorUsername()) {
    const existingCreator = game.getCreatorUsername() || 'Someone';
    sendAndTrackMessage(chatId, getTranslation('game_already_created', lang, {creator: existingCreator}));
    return;
  }
  
  game.reset();
  game.setCreatorUsername(username);
  
  // Create inline keyboard with URL join button
  const joinUrl = `https://t.me/${process.env.BOT_USERNAME}?start=join_${chatId}`;
  console.log(`[NEWGAME] Join button URL: ${joinUrl}`);
  console.log(`[NEWGAME] BOT_USERNAME: "${process.env.BOT_USERNAME}"`);
  
  const joinKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: getTranslation('join_game_button', lang),
            url: joinUrl
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
  
  const gameMessage = game.generateGameMessage(username);
  
  // Send the game message and store its ID for editing
  bot.sendMessage(chatId, gameMessage, joinKeyboard).then((sentMessage) => {
    console.log(`[NEWGAME] Game message sent successfully, storing message ID: ${sentMessage.message_id} for chat ${chatId}`);
    game.setGameMessageId(sentMessage.message_id);
    console.log(`[NEWGAME] Message ID stored: ${game.getGameMessageId()}`);
    
    // Pin the message for better visibility
    bot.pinChatMessage(chatId, sentMessage.message_id, { disable_notification: true }).then(() => {
      console.log(`[NEWGAME] Game message pinned successfully`);
    }).catch((pinError) => {
      console.log(`[NEWGAME] Could not pin message (bot may not have admin rights): ${pinError.message}`);
    });
    
    // Don't add main game message to delete list - let it stay visible during game
  }).catch((error) => {
    console.error('[NEWGAME] Failed to send game message:', error);
  });
  
  // Start the 2-minute timeout
  game.startGameTimeout();
  
  // Set 1-minute warning
  setTimeout(() => {
    if (game.gameTimeout && game.getPlayerCount() < 3 && !game.isActive) {
      const playerCount = game.getPlayerCount();
      const needed = 3 - playerCount;
      let warningMessage = `${getTranslation('one_minute_warning', lang)}\n\n`;
      warningMessage += `${getTranslation('game_expires_in_60', lang)}\n\n`;
      
      if (playerCount === 0) {
        warningMessage += `${getTranslation('no_players_joined', lang)}\n`;
      } else {
        warningMessage += `👥 **${getTranslation('current_players_warning', lang, {count: playerCount})}:** ${game.players.map(p => p.username).join(', ')}\n`;
      }
      
      warningMessage += `${getTranslation('need_more_players_quick', lang, {count: needed})}\n\n`;
      warningMessage += `${getTranslation('share_with_friends', lang)}`;
      
      sendAndTrackMessage(chatId, warningMessage);
      updateGameMessage(chatId, game);
    }
  }, 60000); // 1 minute (60 seconds)
  
  // Set timeout to end game if not enough players
  setTimeout(() => {
    if (game.isGameTimeoutExpired() && game.getPlayerCount() < 3 && !game.isActive) {
      endGameDueToTimeout(chatId, game);
    }
  }, game.gameTimeoutDuration);
  
  // Update message every 30 seconds to show countdown
  const timeoutUpdateInterval = setInterval(() => {
    if (game.gameTimeout && game.getPlayerCount() < 3 && !game.isActive) {
      if (game.isGameTimeoutExpired()) {
        clearInterval(timeoutUpdateInterval);
        endGameDueToTimeout(chatId, game);
      } else {
        updateGameMessage(chatId, game);
      }
    } else {
      clearInterval(timeoutUpdateInterval);
    }
  }, 30000);
  
});

// Join game command
bot.onText(/^\/join/, (msg) => {
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;
  const userId = msg.from.id;
  const username = getDisplayName(msg.from);
  
  // Check if command is used in private chat
  if (chatType === 'private') {
    bot.sendMessage(chatId, getTranslation('join_groups_only', 'uk'));
    return;
  }
  
  const game = getGame(chatId);
  const lang = game.getLanguage();
  
  if (game.isActive) {
    bot.sendMessage(chatId, getTranslation('game_in_progress', lang));
    return;
  }
  
  // Check if game is full (8 players max)
  if (game.getPlayerCount() >= 8) {
    bot.sendMessage(chatId, getTranslation('too_many_players', lang));
    return;
  }
  
  if (game.addPlayer(userId, username)) {
    const playerCount = game.getPlayerCount();
    console.log(`Player ${username} joined. Total players: ${playerCount}`);
    
    // Clear timeout if we reached minimum players
    if (playerCount >= 3) {
      game.clearGameTimeout();
    }
    
    // Update the game message with new player list
    updateGameMessage(chatId, game);
    
    // Send simple join confirmation
    sendAndTrackMessage(chatId, getTranslation('joined_game_broadcast', lang, {username, count: playerCount}));
    
    // Auto-start timer when we have enough players (and countdown not already started)
    if (game.canAutoStart()) {
      game.startWaiting();
      sendAndTrackMessage(chatId, getTranslation('auto_start_60_seconds', lang));
      
      // Set auto-start timer
      setTimeout(() => {
        if (game.isWaitTimeUp() && game.canStart()) {
          startGameNow(chatId, game);
        }
      }, 60000);
      
      // Update message every 10 seconds during countdown
      const updateInterval = setInterval(() => {
        if (game.waitingToStart && game.getWaitingTime() > 0) {
          updateGameMessage(chatId, game);
        } else {
          clearInterval(updateInterval);
        }
      }, 10000);
    }
  } else {
    bot.sendMessage(chatId, getTranslation('already_in_game', lang));
  }
});

// Leave game command
bot.onText(/^\/leave/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = getDisplayName(msg.from);
  const game = getGame(chatId);
  const lang = game.getLanguage();
  
  if (game.isActive) {
    bot.sendMessage(chatId, getTranslation('cannot_leave_active', lang));
    return;
  }
  
  if (game.removePlayer(userId)) {
    const playerCount = game.getPlayerCount();
    
    // Restart timeout if we drop below minimum players
    if (playerCount < 3) {
      game.startGameTimeout();
    }
    
    // Update the game message with updated player list
    updateGameMessage(chatId, game);
    sendAndTrackMessage(chatId, getTranslation('player_left_game', lang, {username, count: playerCount}));
  } else {
    bot.sendMessage(chatId, getTranslation('not_in_game', lang));
  }
});

// Show players command
bot.onText(/^\/players/, (msg) => {
  const chatId = msg.chat.id;
  const game = getGame(chatId);
  const lang = game.getLanguage();
  const status = game.getGameStatus();
  
  if (status.playerCount === 0) {
    sendAndTrackMessage(chatId, getTranslation('no_players_yet', lang));
    return;
  }
  
  let message = `👥 Players (${status.playerCount}/8):\n`;
  status.players.forEach((player, index) => {
    message += `${index + 1}. ${player.username}\n`;
  });
  
  if (status.isActive) {
    message += `\n⏰ Time remaining: ${formatTime(status.remainingTime)}`;
    message += `\n📍 Location: ${game.getLocation()}`;
  } else if (status.waitingToStart) {
    message += `\n⏰ Auto-starting in: ${Math.ceil(status.waitingTime / 1000)} seconds`;
    message += `\nUse /startgame to start now`;
  }
  
  sendAndTrackMessage(chatId, message);
});

// Start game command
bot.onText(/^\/startgame/, (msg) => {
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;
  
  // Check if command is used in private chat
  if (chatType === 'private') {
    bot.sendMessage(chatId, getTranslation('start_groups_only', 'uk'));
    return;
  }
  
  const game = getGame(chatId);
  const lang = game.getLanguage();
  
  if (!game.canStart()) {
    if (game.isActive) {
      bot.sendMessage(chatId, getTranslation('game_already_active', lang));
    } else if (game.getPlayerCount() < 3) {
      bot.sendMessage(chatId, getTranslation('need_min_players', lang));
    } else if (game.getPlayerCount() > 8) {
      bot.sendMessage(chatId, getTranslation('too_many_players', lang));
    }
    return;
  }
  
  startGameNow(chatId, game);
});


// End game command
bot.onText(/^\/endgame/, (msg) => {
  const chatId = msg.chat.id;
  const game = getGame(chatId);
  
  if (!game.isActive) {
    const gameLanguage = game.getLanguage();
    const message = gameLanguage === 'uk' 
      ? "❌ Немає активної гри для завершення!"
      : "❌ Нет активной игры для завершения!";
    sendAndTrackMessage(chatId, message);
    return;
  }
  
  const spies = game.getSpyPlayers();
  const spyNames = spies.map(spy => spy.username).join(', ');
  const gameLanguage = game.getLanguage();
  
  let endMessage;
  const lastGuess = game.getLastSpyGuess();
  if (gameLanguage === 'uk') {
    const spyText = spies.length === 1 ? 'шпигун був' : 'шпигуни були';
    endMessage = `🛑 Гра завершена!\n\n📍 Локація була: **${game.getLocation()}**\n🎭 Слово було: **${game.getAgentRole()}**`;
    endMessage += `\n🕵️ ${spyText.charAt(0).toUpperCase() + spyText.slice(1)}: **${spyNames}**`;
  } else {
    const spyText = spies.length === 1 ? 'шпион был' : 'шпионы были';
    endMessage = `🛑 Игра завершена!\n\n📍 Локация была: **${game.getLocation()}**\n🎭 Слово было: **${game.getAgentRole()}**`;
    endMessage += `\n🕵️ ${spyText.charAt(0).toUpperCase() + spyText.slice(1)}: **${spyNames}**`;
  }
  
  // Add role list
  endMessage += generateRoleList(game);
  endMessage += gameLanguage === 'uk' ? '\n\nВикористовуйте /newgame щоб зіграти знову!' : '\n\nИспользуйте /newgame чтобы играть снова!';
  
  // Add main game message to cleanup list before final cleanup
  const mainMessageId = game.getGameMessageId();
  if (mainMessageId) {
    game.addMessageToDelete(mainMessageId);
  }
  
  // Clean up all game messages
  cleanupGameMessages(chatId, game);
  setTimeout(() => {
    bot.sendMessage(chatId, endMessage);
  }, 500);
  
  // Fully reset the game state so new games can be created
  game.reset();
});


// Vote command with player number - IMMEDIATELY starts voting
bot.onText(/^\/vote (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;
  const userId = msg.from.id;
  const username = getDisplayName(msg.from);
  const playerNumber = parseInt(match[1]);
  
  console.log(`[VOTE-CMD] ${username} initiated vote on player ${playerNumber} in chat ${chatId}`);
  
  // Check if command is used in private chat
  if (chatType === 'private') {
    bot.sendMessage(chatId, getTranslation('voting_groups_only', 'uk'));
    return;
  }
  
  const game = getGame(chatId);
  const lang = game.getLanguage();
  
  if (!game.isActive) {
    sendAndTrackMessage(chatId, getTranslation('no_active_game_vote', lang));
    return;
  }
  
  // Check if user is an active player and delete message if not
  const isActivePlayer = game.players.find(p => p.id === userId);
  if (!isActivePlayer) {
    console.log(`[VOTE-CMD] DELETED: ${username} is not an active player - deleting message`);
    bot.deleteMessage(chatId, msg.message_id).catch((error) => {
      console.log(`[VOTE-CMD] Could not delete message:`, error.message);
    });
    return;
  }
  
  // Don't allow nomination during active voting
  if (game.votingActive) {
    bot.sendMessage(chatId, getTranslation('voting_in_progress_wait', lang));
    return;
  }
  
  // Check if player number is valid
  if (playerNumber < 1 || playerNumber > game.players.length) {
    bot.sendMessage(chatId, getTranslation('invalid_player_number', lang, {max: game.players.length}));
    return;
  }
  
  const targetPlayer = game.players[playerNumber - 1];
  
  // Can't nominate yourself
  if (targetPlayer.id === userId) {
    console.log(`[VOTE-CMD] REJECTED: ${username} tried to vote for themselves (player ${playerNumber})`);
    bot.sendMessage(chatId, getTranslation('cannot_vote_self', lang));
    return;
  }
  
  // Clear any existing nominees and nominate only this player
  game.clearNominations();
  if (game.nominatePlayer(targetPlayer.id)) {
    sendAndTrackMessage(chatId, getTranslation('nominated_player', lang, {nominator: username, nominee: targetPlayer.username}));
    
    // Immediately start voting with this single nominee
    const nominees = game.getNominees();
    if (game.startVoting()) {
      console.log(`[VOTE-CMD] Voting started successfully for ${targetPlayer.username}. Total voters: ${game.getPlayerCount()}`);
      
      // Automatically cast a "for" vote for the nominator
      const autoVoteResult = game.vote(userId, targetPlayer.id, 'for');
      if (autoVoteResult.success) {
        console.log(`[VOTE-CMD] Auto-voted: ${username} automatically voted FOR ${targetPlayer.username}`);
      } else {
        console.log(`[VOTE-CMD] Auto-vote failed: ${autoVoteResult.reason}`);
      }
      
      // Create inline keyboard with voting buttons for nominees only
      const keyboard = [];
      nominees.forEach((nominee) => {
        keyboard.push([
          { text: `👍 ${nominee.username}`, callback_data: `vote_for_${nominee.id}` },
          { text: `👎 ${nominee.username}`, callback_data: `vote_against_${nominee.id}` }
        ]);
      });
      
      const message = generateVotingMessage(game, lang);
      
      bot.sendMessage(chatId, message, {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'Markdown'
      }).then((sentMessage) => {
        game.setVotingMessageId(sentMessage.message_id);
        game.addMessageToDelete(sentMessage.message_id);
        console.log(`[VOTE-CMD] Voting message sent, ID: ${sentMessage.message_id}`);
      }).catch((error) => {
        console.error('[VOTE-CMD] Failed to send voting message:', error);
      });
      
      // Set up periodic timer updates every 10 seconds
      game.votingUpdateInterval = setInterval(() => {
        if (!game.votingActive) {
          clearInterval(game.votingUpdateInterval);
          game.votingUpdateInterval = null;
          return;
        }
        
        const votingMessageId = game.getVotingMessageId();
        if (votingMessageId) {
          const nominees = game.getNominees();
          const keyboard = [];
          nominees.forEach((nominee) => {
            keyboard.push([
              { text: `👍 ${nominee.username}`, callback_data: `vote_for_${nominee.id}` },
              { text: `👎 ${nominee.username}`, callback_data: `vote_against_${nominee.id}` }
            ]);
          });
          
          const updatedMessage = generateVotingMessage(game, lang);
          bot.editMessageText(updatedMessage, {
            chat_id: chatId,
            message_id: votingMessageId,
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'Markdown'
          }).catch((error) => {
            console.log(`[VOTE-TIMER] Could not update voting message:`, error.message);
          });
        }
      }, 10000); // Update every 10 seconds
      
      // Set voting timeout
      setTimeout(() => {
        if (game.votingUpdateInterval) {
          clearInterval(game.votingUpdateInterval);
          game.votingUpdateInterval = null;
        }
        if (game.votingActive) {
          processVoteResults(chatId, game);
        }
      }, game.votingDuration);
    }
  } else {
    bot.sendMessage(chatId, getTranslation('could_not_nominate', lang, {username: targetPlayer.username}));
  }
});

// Handle /vote without number - return error
bot.onText(/^\/vote$/, (msg) => {
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;
  
  // Check if command is used in private chat
  if (chatType === 'private') {
    bot.sendMessage(chatId, getTranslation('voting_groups_only', 'uk'));
    return;
  }
  
  const game = getGame(chatId);
  const lang = game.getLanguage();
  
  // Check if game is active
  if (!game.isActive) {
    bot.sendMessage(chatId, getTranslation('no_active_game_vote', lang));
    return;
  }
  
  // Check if user is an active player and delete message if not
  const userId = msg.from.id;
  const username = getDisplayName(msg.from);
  const isActivePlayer = game.players.find(p => p.id === userId);
  if (!isActivePlayer) {
    console.log(`[VOTE-CMD] DELETED: ${username} is not an active player - deleting message`);
    bot.deleteMessage(chatId, msg.message_id).catch((error) => {
      console.log(`[VOTE-CMD] Could not delete message:`, error.message);
    });
    return;
  }
  
  bot.sendMessage(chatId, getTranslation('vote_needs_player_number', lang));
});

// Handle /vote with non-numeric arguments - return error
bot.onText(/^\/vote (.+)$/, (msg, match) => {
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;
  const argument = match[1];
  
  // Skip if it's already a number (handled by previous handler)
  if (/^\d+$/.test(argument)) {
    return;
  }
  
  // Check if command is used in private chat
  if (chatType === 'private') {
    bot.sendMessage(chatId, getTranslation('voting_groups_only', 'uk'));
    return;
  }
  
  const game = getGame(chatId);
  const lang = game.getLanguage();
  
  // Check if game is active
  if (!game.isActive) {
    bot.sendMessage(chatId, getTranslation('no_active_game_vote', lang));
    return;
  }
  
  // Check if user is an active player and delete message if not
  const userId = msg.from.id;
  const username = getDisplayName(msg.from);
  const isActivePlayer = game.players.find(p => p.id === userId);
  if (!isActivePlayer) {
    console.log(`[VOTE-CMD] DELETED: ${username} is not an active player - deleting message`);
    bot.deleteMessage(chatId, msg.message_id).catch((error) => {
      console.log(`[VOTE-CMD] Could not delete message:`, error.message);
    });
    return;
  }
  
  bot.sendMessage(chatId, getTranslation('vote_needs_player_number', lang));
});

// Check voting status command

// Function to process vote results
function processVoteResults(chatId, game) {
  const results = game.getVoteResults();
  const lang = game.getLanguage();
  
  let message = `${getTranslation('voting_results', lang)}\n\n`;
  message += `${getTranslation('total_votes_results', lang, {total: results.totalVotes, players: results.totalPlayers})}\n\n`;
  
  if (results.totalVotes === 0) {
    message += `${getTranslation('no_votes_cast', lang)}\n\n`;
    message += `${getTranslation('time_remaining', lang, {time: formatTime(game.getRemainingTime())})}`;
    sendAndTrackMessage(chatId, message);
    game.endVoting();
    return;
  }
  
  // Show vote breakdown
  message += `${getTranslation('final_votes', lang)}\n`;
  const allPlayerIds = new Set([...results.forVotes.keys(), ...results.againstVotes.keys()]);
  
  for (const playerId of allPlayerIds) {
    const player = game.players.find(p => p.id === playerId);
    const forCount = results.forVotes.get(playerId) || 0;
    const againstCount = results.againstVotes.get(playerId) || 0;
    
    const forHands = '👍'.repeat(forCount);
    const againstHands = '👎'.repeat(againstCount);
    
    message += `${player.username}: ${forHands}${againstHands}\n`;
  }
  
  // Check if there's a valid elimination (clear winner with enough votes)
  const totalPlayers = game.players.length;
  const minimumVotes = Math.max(2, Math.ceil(totalPlayers * 0.3)); // At least 2 votes or 30% of players
  
  // Get the raw "for" votes for the most voted player
  const mostVotedPlayerId = results.mostVoted.length === 1 ? results.mostVoted[0] : null;
  const forVotesCount = mostVotedPlayerId ? (results.forVotes.get(mostVotedPlayerId) || 0) : 0;
  
  if (results.mostVoted.length === 1 && results.maxVotes > 0 && forVotesCount >= minimumVotes) {
    // Clear winner with enough votes - eliminate player
    const eliminatedPlayerId = results.mostVoted[0];
    const wasSpy = game.isSpy(eliminatedPlayerId); // Check before elimination
    const eliminatedPlayer = game.eliminatePlayer(eliminatedPlayerId);
    const spyWord = lang === 'uk' ? 'Шпигун' : 'Шпион';
    const agentWord = lang === 'uk' ? 'Агент' : 'Агент';
    const wordLabel = lang === 'uk' ? 'Слово' : 'Слово';
    const playerRole = eliminatedPlayer.role;
    const wasSpySymbol = wasSpy ? `🕵️ ${spyWord}` : `👤 ${agentWord}, ${wordLabel}: ${playerRole}`;
    
    // Check win condition
    const winCheck = game.checkWinCondition();
    if (winCheck.gameEnded) {
      const remainingSpies = game.getSpyPlayers();
      const spyNames = remainingSpies.map(spy => spy.username).join(', ');
      
      // Add main game message to cleanup list before final cleanup
      const mainMessageId = game.getGameMessageId();
      if (mainMessageId) {
        game.addMessageToDelete(mainMessageId);
      }
      
      // Create clean final message without voting header
      let finalMessage = `${getTranslation('eliminated_player', lang, {username: eliminatedPlayer.username, symbol: wasSpySymbol})}\n`;
      finalMessage += `${getTranslation('votes_received', lang, {votes: results.maxVotes, total: totalPlayers, required: minimumVotes})}\n\n`;
      
      if (winCheck.winner === 'agents') {
        finalMessage += `${getTranslation('agents_win_all_spies', lang)}\n\n`;
      } else {
        finalMessage += `${getTranslation('spies_win_majority', lang)}\n\n`;
      }
      
      finalMessage += `${getTranslation('location_was', lang, {location: game.getLocation()})}\n`;
      finalMessage += lang === 'uk' ? `🎭 Слово було: **${game.getAgentRole()}**\n` : `🎭 Слово было: **${game.getAgentRole()}**\n`;
      if (remainingSpies.length > 0) {
        finalMessage += `${getTranslation('remaining_spies', lang, {spies: spyNames})}\n`;
      }
      
      // Add role list
      finalMessage += generateRoleList(game);
      finalMessage += `\n${getTranslation('play_again', lang)}`;
      
      // Clean up all game messages before showing result
      cleanupGameMessages(chatId, game);
      setTimeout(() => {
        bot.sendMessage(chatId, finalMessage);
      }, 500);
      
      // Fully reset the game state so new games can be created
      game.reset();
    } else {
      message += `${getTranslation('game_continues', lang)}\n`;
      message += `${getTranslation('time_remaining', lang, {time: formatTime(game.getRemainingTime())})}\n`;
      
      // Add numbered player list
      message += `👥 ${lang === 'uk' ? 'Залишилися гравці' : 'Остались игроки'} (${game.players.length}/8):\n`;
      game.players.forEach((player, index) => {
        message += `${index + 1}. ${player.username}\n`;
      });
      
      sendAndTrackMessage(chatId, message);
      
      // Update the main game message with new player list
      updateGameMessage(chatId, game);
    }
  } else if (results.mostVoted.length === 1 && (results.maxVotes <= 0 || forVotesCount < minimumVotes)) {
    // Clear winner but not enough votes
    const targetPlayer = game.players.find(p => p.id === results.mostVoted[0]);
    message += `\n${getTranslation('not_enough_votes', lang)}\n`;
    message += `🎯 ${targetPlayer.username} received ${forVotesCount} "for" vote${forVotesCount > 1 ? 's' : ''} (required: ${minimumVotes})\n\n`;
    message += `${getTranslation('tip_need_votes', lang, {needed: minimumVotes})}\n\n`;
    message += `${getTranslation('game_continues', lang)}\n`;
    message += `${getTranslation('time_remaining', lang, {time: formatTime(game.getRemainingTime())})}`;
    
    sendAndTrackMessage(chatId, message);
  } else if (results.mostVoted.length > 1) {
    // Tie - no elimination
    const tiedPlayers = results.mostVoted.map(id => game.players.find(p => p.id === id).username);
    const maxVotes = results.maxVotes;
    message += `\n${getTranslation('tie_no_elimination', lang)}\n`;
    message += `${getTranslation('tied_players', lang, {players: tiedPlayers.join(', '), votes: maxVotes})}\n`;
    if (maxVotes >= minimumVotes) {
      message += `${getTranslation('enough_votes_but_tied', lang)}\n\n`;
    } else {
      message += `${getTranslation('not_enough_anyway', lang, {required: minimumVotes})}\n\n`;
    }
    message += `${getTranslation('game_continues', lang)}\n`;
    message += `${getTranslation('time_remaining', lang, {time: formatTime(game.getRemainingTime())})}`;
    
    sendAndTrackMessage(chatId, message);
  } else {
    // No winners (all votes were tied at 0 or negative net votes)
    message += `\n${getTranslation('no_clear_winner', lang)}\n`;
    message += `${getTranslation('all_votes_tied', lang)}\n\n`;
    message += `${getTranslation('game_continues', lang)}\n`;
    message += `${getTranslation('time_remaining', lang, {time: formatTime(game.getRemainingTime())})}`;
    
    sendAndTrackMessage(chatId, message);
  }
  
  game.endVoting();
}

// Spy word guess command
bot.onText(/^\/word (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;
  const userId = msg.from.id;
  const username = getDisplayName(msg.from);
  const guess = match[1];
  
  let game;
  let groupChatId;
  
  // If used in private chat, find the group game where this user is playing
  if (chatType === 'private') {
    for (const [gChatId, gGame] of activeGames) {
      if (gGame.isActive && gGame.players.find(p => p.id === userId)) {
        game = gGame;
        groupChatId = gChatId;
        break;
      }
    }
    
    if (!game) {
      bot.sendMessage(chatId, getTranslation('not_in_active_game', 'uk'));
      return;
    }
  } else {
    // Used in group chat
    game = getGame(chatId);
    groupChatId = chatId;
    
    // Check if user is an active player and delete message if not
    const isActivePlayer = game.players.find(p => p.id === userId);
    if (!isActivePlayer) {
      console.log(`[WORD-CMD] DELETED: ${username} is not an active player - deleting message`);
      bot.deleteMessage(chatId, msg.message_id).catch((error) => {
        console.log(`[WORD-CMD] Could not delete message:`, error.message);
      });
      return;
    }
  }
  
  const lang = game.getLanguage();
  
  console.log(`/word command - Game active: ${game.isActive}, User: ${username}, Guess: "${guess}", Players: ${game.getPlayerCount()}`);
  
  if (!game.isActive) {
    sendAndTrackMessage(chatId, getTranslation('no_active_game', lang));
    return;
  }
  
  if (!game.isSpy(userId)) {
    bot.sendMessage(chatId, getTranslation('only_spy_can_guess', lang));
    return;
  }
  
  const result = game.checkSpyGuess(guess);
  
  if (!result.success) {
    bot.sendMessage(chatId, getTranslation('cannot_guess_now', lang));
    return;
  }
  
  // Send confirmation to spy if used in private
  if (chatType === 'private') {
    const confirmMsg = result.correct ? 
      getTranslation('guess_correct_private', lang, {guess}) : 
      getTranslation('guess_wrong_private', lang, {guess});
    bot.sendMessage(chatId, confirmMsg);
  }
  
  const gameLanguage = game.getLanguage();
  
  if (result.correct) {
    const spies = game.getSpyPlayers();
    const spyText = spies.length === 1 ? getTranslation('spy_won_singular', gameLanguage) : getTranslation('spy_won_plural', gameLanguage);
    const spiesText = spies.length === 1 ? getTranslation('spy_understood', gameLanguage, {spies: 'Шпигун'}) : getTranslation('spies_understood', gameLanguage, {spies: 'Шпигуни'});
    
    let winMessage = `🏆 **${spyText}!** 🏆\n\n${getTranslation('spy_guessed_correctly', gameLanguage, {username, role: game.getAgentRole()})}\n\n📍 ${gameLanguage === 'uk' ? 'Локація була' : 'Локация была'}: **${game.getLocation()}**\n🎭 ${gameLanguage === 'uk' ? 'Слово було' : 'Слово было'}: **${game.getAgentRole()}**\n\n${spiesText}`;
    
    // Add role list
    winMessage += generateRoleList(game);
    winMessage += gameLanguage === 'uk' ? '\n\nВикористовуйте /newgame щоб зіграти знову!' : '\n\nИспользуйте /newgame чтобы играть снова!';
    
    // Add main game message to cleanup list before final cleanup
    const mainMessageId = game.getGameMessageId();
    if (mainMessageId) {
      game.addMessageToDelete(mainMessageId);
    }
    
    // Clean up game messages and show result
    cleanupGameMessages(groupChatId, game);
    setTimeout(() => {
      bot.sendMessage(groupChatId, winMessage);
    }, 500);
  } else {
    // Wrong guess - check if multiple spies or last spy
    const spies = game.getSpyPlayers();
    const spyCount = spies.length;
    
    if (spyCount > 1) {
      // Multiple spies - eliminate the wrong guesser, game continues
      const eliminatedSpy = game.eliminatePlayer(userId);
      
      let eliminationMessage = `${getTranslation('wrong_answer_uk', gameLanguage)}\n\n`;
      eliminationMessage += `${getTranslation('spy_guessed', gameLanguage, {username, guess})}\n\n`;
      eliminationMessage += `⚖️ **${gameLanguage === 'uk' ? 'ВИКЛЮЧЕНО' : 'ИСКЛЮЧЕН'}:** ${eliminatedSpy.username} (🕵️ ${gameLanguage === 'uk' ? 'Шпигун' : 'Шпион'})!\n\n`;
      eliminationMessage += `🎮 **${getTranslation('game_continues', gameLanguage)}**\n`;
      eliminationMessage += `${getTranslation('time_remaining', gameLanguage, {time: formatTime(game.getRemainingTime())})}\n\n`;
      
      // Add updated player list with new positions
      eliminationMessage += `👥 **${getTranslation('players_count', gameLanguage)} (${game.players.length}/8):**\n`;
      game.players.forEach((player, index) => {
        eliminationMessage += `${index + 1}. ${player.username}\n`;
      });
      
      sendAndTrackMessage(groupChatId, eliminationMessage);
      
      // Update the main game message with new player list
      updateGameMessage(groupChatId, game);
    } else {
      // Last spy wrong guess - agents win and game ends
      const spyFailText = getTranslation('spy_failed_singular', gameLanguage);
      
      let loseMessage = `${getTranslation('wrong_answer_uk', gameLanguage)}\n\n${getTranslation('spy_guessed', gameLanguage, {username, guess})}\n${getTranslation('but_role_was', gameLanguage, {role: game.getAgentRole()})}\n\n📍 ${gameLanguage === 'uk' ? 'Локація була' : 'Локация была'}: **${game.getLocation()}**\n🎭 ${gameLanguage === 'uk' ? 'Слово було' : 'Слово было'}: **${game.getAgentRole()}**\n\n${getTranslation('agents_won', gameLanguage)}\n${spyFailText}`;
      
      // Add role list
      loseMessage += generateRoleList(game);
      loseMessage += gameLanguage === 'uk' ? '\n\nВикористовуйте /newgame щоб зіграти знову!' : '\n\nИспользуйте /newgame чтобы играть снова!';
      
      // Add main game message to cleanup list before final cleanup
      const mainMessageId = game.getGameMessageId();
      if (mainMessageId) {
        game.addMessageToDelete(mainMessageId);
      }
      
      // Clean up game messages and show result
      cleanupGameMessages(groupChatId, game);
      setTimeout(() => {
        bot.sendMessage(groupChatId, loseMessage);
      }, 500);
      
      // Fully reset the game state so new games can be created
      game.reset();
    }
  }
});

// Settings command to adjust game duration
bot.onText(/^\/settings/, (msg) => {
  const chatId = msg.chat.id;
  const game = getGame(chatId);
  
  const currentDuration = game.getDuration();
  const currentLanguage = game.getLanguage();
  const languageName = currentLanguage === 'uk' ? 'Ukrainian' : 'Russian';
  const showLocation = game.getShowLocation();
  const locationMode = showLocation ? 'Normal (full spy instructions)' : 'Hard (minimal spy instructions)';
  
  const settingsMessage = `⚙️ **Game Settings** ⚙️

**Current Duration:** ${currentDuration} minutes
**Current Language:** ${languageName} (${currentLanguage})
**Location Mode:** ${locationMode}

**Commands:**
• /settime [1-20] - Set game duration (e.g., /settime 10)
• /setlang [uk/ru] - Set language (e.g., /setlang ru)
• /setlocation [on/off] - Set spy instruction level (e.g., /setlocation off for hard mode)
• /settings - Show current settings

**Examples:**
• /settime 5 - Short game (5 minutes)
• /setlang uk - Ukrainian language
• /setlocation off - Hard mode (spies get minimal instructions)
• /setlocation on - Normal mode (spies get full instructions)

**Note:** Settings can only be changed before starting a game.`;

  bot.sendMessage(chatId, settingsMessage);
});

// Set game duration command
bot.onText(/^\/settime (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const minutes = parseInt(match[1]);
  const game = getGame(chatId);
  
  const result = game.setDuration(minutes);
  
  if (result.success) {
    sendAndTrackMessage(chatId, `✅ Game duration set to ${minutes} minutes!`);
  } else {
    if (result.reason === 'game_active') {
      sendAndTrackMessage(chatId, getTranslation('cannot_change_during_game', game.getLanguage()));
    } else if (result.reason === 'invalid_range') {
      sendAndTrackMessage(chatId, getTranslation('duration_range_error', game.getLanguage()));
    }
  }
});

// Set language command
bot.onText(/^\/setlang (uk|ru)/, (msg, match) => {
  const chatId = msg.chat.id;
  const language = match[1];
  const game = getGame(chatId);
  
  const result = game.setLanguage(language);
  
  if (result.success) {
    const languageName = language === 'uk' ? 'Ukrainian' : 'Russian';
    sendAndTrackMessage(chatId, `✅ Language set to ${languageName}!`);
    
    // Update the game message if game is waiting
    if (!game.isActive && game.getPlayerCount() > 0) {
      updateGameMessage(chatId, game);
    }
  } else {
    if (result.reason === 'game_active') {
      sendAndTrackMessage(chatId, getTranslation('cannot_change_during_game', game.getLanguage()));
    } else if (result.reason === 'invalid_language') {
      sendAndTrackMessage(chatId, getTranslation('language_error', game.getLanguage()));
    }
  }
});

// Set location visibility command
bot.onText(/^\/setlocation (on|off)/, (msg, match) => {
  const chatId = msg.chat.id;
  const setting = match[1];
  const game = getGame(chatId);
  
  const showLocation = setting === 'on';
  const result = game.setShowLocation(showLocation);
  
  if (result.success) {
    const lang = game.getLanguage();
    const mode = showLocation ? getTranslation('normal_mode_desc', lang) : getTranslation('hard_mode_desc', lang);
    sendAndTrackMessage(chatId, getTranslation('location_setting_updated', lang, {mode}));
    
    // Update the game message if game is waiting
    if (!game.isActive && game.getPlayerCount() > 0) {
      updateGameMessage(chatId, game);
    }
  } else {
    if (result.reason === 'game_active') {
      sendAndTrackMessage(chatId, getTranslation('cannot_change_during_game', game.getLanguage()));
    }
  }
});

// Time command
bot.onText(/^\/time/, (msg) => {
  const chatId = msg.chat.id;
  const game = getGame(chatId);
  const lang = game.getLanguage();
  
  if (!game.isActive) {
    sendAndTrackMessage(chatId, getTranslation('no_active_game', lang));
    return;
  }
  
  const remainingTime = game.getRemainingTime();
  if (remainingTime > 0) {
    bot.sendMessage(chatId, `⏰ Time remaining: ${formatTime(remainingTime)}`);
  } else {
    bot.sendMessage(chatId, getTranslation('time_up', lang));
  }
});

// Help command
bot.onText(/^\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpMessage = `🕵️ **"Шпигун виродок" Bot Commands** 🕵️

**Game Setup:**
/newgame - Create a new game with join buttons
/join - Join the current game (or use the button)
/leave - Leave the game (before it starts)
/players - Show current players
/startgame - Start the game (3-8 players needed)

**During Game:**
/time - Check remaining time
/vote - Show player list and voting instructions
/vote [number] - Start voting on a player immediately (e.g., /vote 1)
/word [word] - Spy can guess the agent word (e.g., /word Касир)
/endgame - End the current game

**Voting:**
• Use /vote [number] to immediately start voting on a player (e.g., /vote 3)
• Use /vote (without number) to show player list and voting instructions
• 👍 = Vote to eliminate, 👎 = Vote to protect
• Voting lasts 60 seconds once started
• Need minimum NET votes to eliminate (at least 2 or 30% of players)
• Net votes = 👍 votes minus 👎 votes
• Player with most net votes AND enough net votes gets eliminated

**Settings:**
/settings - Show current game settings
/settime [1-20] - Set game duration in minutes (e.g., /settime 10)
/setlang [uk/ru] - Set language Ukrainian/Russian (e.g., /setlang ru)
/setlocation [on/off] - Set spy instruction level (e.g., /setlocation off)

**Game Rules:**
• 1-4 players: 1 spy, 5-8 players: 2 spies
• Everyone else gets the same location and different roles
• Spies don't know the location but know each other (if 2 spies)
• Ask questions to find the spies without revealing the location
• Game auto-starts 60 seconds after 3+ players join

**Tips:**
• Ask questions that show you know the location
• Be suspicious of vague answers
• Don't make it too obvious what the location is!
• **Spies**: Use /role [role] when you think you know what role the agents have!
• **With 2 spies**: Work together but don't make it obvious!

Good luck, and have fun! 🎮`;

  bot.sendMessage(chatId, helpMessage);
});

// Handle unknown commands
bot.on('message', (msg) => {
  if (msg.text && msg.text.startsWith('/') && !msg.text.match(/\/(start|newgame|join|leave|players|startgame|endgame|time|help|settings|settime|setlang|setlocation|word|vote)/)) {
    const game = getGame(msg.chat.id);
    const lang = game.getLanguage();
    bot.sendMessage(msg.chat.id, getTranslation('unknown_command', lang));
  }
});

// Set bot commands menu for different chat types
// Private chat - full commands menu
bot.setMyCommands([
  { command: 'start', description: 'Welcome message and setup instructions' },
  { command: 'settings', description: 'View and configure game settings' },
  { command: 'settime', description: 'Set game duration (e.g., /settime 10)' },
  { command: 'setlang', description: 'Set language (e.g., /setlang uk)' },
  { command: 'setlocation', description: 'Set spy instruction level (e.g., /setlocation off)' },
  { command: 'help', description: 'Show all commands and game rules' }
], { scope: { type: 'default' } }).catch(console.error);

// Group chats - limited to game commands only
bot.setMyCommands([
  { command: 'newgame', description: 'Create a new "Шпигун виродок" game' },
  { command: 'join', description: 'Join the current game' },
  { command: 'vote', description: 'Nominate or vote to eliminate suspected spies' }
], { scope: { type: 'all_group_chats' } }).catch(console.error);

console.log('🕵️ "Шпигун виродок" Bot is running...');

// General message filter - delete messages from non-active players during active games
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;
  const userId = msg.from.id;
  const username = getDisplayName(msg.from);
  
  // Only apply filter to group chats
  if (chatType === 'private') {
    return;
  }
  
  // Skip if it's a bot command (they have their own handling)
  if (msg.text && msg.text.startsWith('/')) {
    return;
  }
  
  const game = getGame(chatId);
  
  // Only filter during active games
  if (!game.isActive) {
    return;
  }
  
  // Check if user is an active player
  const isActivePlayer = game.players.find(p => p.id === userId);
  if (!isActivePlayer) {
    console.log(`[MESSAGE-FILTER] DELETED: ${username} is not an active player - deleting message during active game`);
    bot.deleteMessage(chatId, msg.message_id).catch((error) => {
      console.log(`[MESSAGE-FILTER] Could not delete message:`, error.message);
    });
    return;
  }
});

// Handle inline keyboard callbacks
bot.on('callback_query', (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;
  const userId = callbackQuery.from.id;
  const username = getDisplayName(callbackQuery.from);
  const data = callbackQuery.data;
  
  // Check if callback is from private chat
  if (chatType === 'private') {
    bot.answerCallbackQuery(callbackQuery.id, {
      text: getTranslation('groups_only', 'uk'),
      show_alert: true
    });
    return;
  }
  
  const game = getGame(chatId);
  const lang = game.getLanguage();

  if (data === 'view_players') {
    // Handle view players button
    const status = game.getGameStatus();
    
    if (status.playerCount === 0) {
      bot.answerCallbackQuery(callbackQuery.id, {
        text: getTranslation('no_players_yet_button', lang),
        show_alert: true
      });
      return;
    }
    
    let message = `👥 Players (${status.playerCount}/8):\n`;
    status.players.forEach((player, index) => {
      message += `${index + 1}. ${player.username}\n`;
    });
    
    if (status.waitingToStart) {
      message += `\n⏰ Auto-starting in: ${Math.ceil(status.waitingTime / 1000)} seconds`;
    }
    
    bot.answerCallbackQuery(callbackQuery.id, {
      text: message,
      show_alert: true
    });
  } else if (data.startsWith('vote_')) {
    // Handle voting button clicks
    const parts = data.split('_');
    const voteType = parts[1]; // 'for' or 'against'  
    const targetId = parseInt(parts.slice(2).join('_'), 10); // rejoin in case targetId has underscores and convert to number
    const targetPlayer = game.players.find(p => p.id == targetId);
    const targetName = targetPlayer ? targetPlayer.username : 'Unknown';
    
    console.log(`[VOTE-BUTTON] User ${username} (${userId}) pressed ${voteType === 'for' ? '👍' : '👎'} button for ${targetName} (${targetId})`);
    console.log(`[VOTE-BUTTON] Game state: active=${game.isActive}, votingActive=${game.votingActive}, playerCount=${game.getPlayerCount()}`);
    console.log(`[VOTE-BUTTON] All players:`, game.players.map(p => `${p.username} (${p.id}, type: ${typeof p.id})`));
    console.log(`[VOTE-BUTTON] Target ID: ${targetId} (type: ${typeof targetId})`);
    
    if (!game.isActive) {
      console.log(`[VOTE-BUTTON] REJECTED: Game not active`);
      bot.answerCallbackQuery(callbackQuery.id, {
        text: getTranslation('no_active_game', lang),
        show_alert: true
      });
      return;
    }
    
    if (!game.votingActive) {
      console.log(`[VOTE-BUTTON] REJECTED: No voting in progress`);
      bot.answerCallbackQuery(callbackQuery.id, {
        text: getTranslation('no_voting_in_progress', lang),
        show_alert: true
      });
      return;
    }
    
    // Check if user is an active player in the game
    const isActivePlayer = game.players.find(p => p.id === userId);
    if (!isActivePlayer) {
      console.log(`[VOTE-BUTTON] REJECTED: ${username} is not an active player`);
      bot.answerCallbackQuery(callbackQuery.id, {
        text: lang === 'uk' ? '❌ Ви не берете участь в грі!' : '❌ Вы не участвуете в игре!',
        show_alert: true
      });
      return;
    }
    
    const voteResult = game.vote(userId, targetId, voteType);
    console.log(`[VOTE-BUTTON] Vote result:`, voteResult);
    
    if (voteResult.success) {
      const voteEmoji = voteType === 'for' ? '👍' : '👎';
      const actionText = voteType === 'for' ? 'eliminate' : 'protect';
      console.log(`[VOTE-BUTTON] SUCCESS: ${username} voted ${voteEmoji} to ${actionText} ${voteResult.target}`);
      bot.answerCallbackQuery(callbackQuery.id, {
        text: `${voteEmoji} Voted to ${actionText} ${voteResult.target}!`,
        show_alert: false
      });
      
      // Update the voting message to show current vote breakdown
      const votingMessageId = game.getVotingMessageId();
      if (votingMessageId) {
        const nominees = game.getNominees();
        const keyboard = [];
        nominees.forEach((nominee) => {
          keyboard.push([
            { text: `👍 ${nominee.username}`, callback_data: `vote_for_${nominee.id}` },
            { text: `👎 ${nominee.username}`, callback_data: `vote_against_${nominee.id}` }
          ]);
        });
        
        const updatedMessage = generateVotingMessage(game, lang);
        bot.editMessageText(updatedMessage, {
          chat_id: chatId,
          message_id: votingMessageId,
          reply_markup: { inline_keyboard: keyboard },
          parse_mode: 'Markdown'
        }).then(() => {
          console.log(`[VOTE-BUTTON] Updated voting message with new vote breakdown`);
        }).catch((error) => {
          console.log(`[VOTE-BUTTON] Could not update voting message:`, error.message);
        });
      }
      
      // Check if all players have voted - if so, end voting immediately
      const totalPlayers = game.players.length;
      const voteResults = game.getVoteResults();
      const totalVotes = voteResults.totalVotes;
      
      if (totalVotes >= totalPlayers) {
        console.log(`[VOTE-BUTTON] All players have voted (${totalVotes}/${totalPlayers}) - ending voting immediately`);
        // Clear the voting timer
        if (game.votingUpdateInterval) {
          clearInterval(game.votingUpdateInterval);
          game.votingUpdateInterval = null;
        }
        // Process vote results immediately
        setTimeout(() => {
          if (game.votingActive) {
            processVoteResults(chatId, game);
          }
        }, 1000); // Small delay to let the message update finish
      }
    } else {
      console.log(`[VOTE-BUTTON] FAILED: ${username} vote rejected - ${voteResult.reason}`);
      let errorText = getTranslation('could_not_process_vote', lang);
      switch (voteResult.reason) {
        case 'not_player':
          errorText = getTranslation('not_in_game_vote', lang);
          console.log(`[VOTE-BUTTON] ERROR: User ${username} is not in the game`);
          break;
        case 'self_vote':
          errorText = getTranslation('cannot_vote_self', lang);
          console.log(`[VOTE-BUTTON] ERROR: User ${username} tried to vote for themselves`);
          break;
        case 'no_voting':
          errorText = getTranslation('no_voting_in_progress', lang);
          console.log(`[VOTE-BUTTON] ERROR: No voting session active`);
          break;
        case 'not_nominated':
          errorText = getTranslation('not_nominated', lang);
          console.log(`[VOTE-BUTTON] ERROR: Target ${targetName} is not nominated`);
          break;
        default:
          console.log(`[VOTE-BUTTON] ERROR: Unknown reason - ${voteResult.reason}`);
      }
      bot.answerCallbackQuery(callbackQuery.id, {
        text: errorText,
        show_alert: true
      });
    }
  }
});

// Handle shutdown gracefully
process.once('SIGINT', () => bot.stopPolling());
process.once('SIGTERM', () => bot.stopPolling());