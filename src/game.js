const locations = require('./locations');
const { getTranslation } = require('./translations');

class SpyfallGame {
  constructor(chatId) {
    this.chatId = chatId;
    this.players = [];
    this.isActive = false;
    this.currentLocation = null;
    this.spyIds = [];
    this.startTime = null;
    this.gameLength = 8 * 60 * 1000; // 8 minutes (default)
    this.settings = {
      duration: 8, // minutes
      waitTime: 60, // seconds to wait before auto-start
      language: 'uk', // default language: 'uk' or 'ru'
      showLocation: true // whether to show location to agents (false = harder mode)
    };
    this.waitingToStart = false;
    this.waitStartTime = null;
    this.votingActive = false;
    this.votes = new Map(); // userId -> {targetId, voteType: 'for'/'against'}
    this.votingStartTime = null;
    this.votingDuration = 30000; // 30 seconds for voting
    this.nominees = new Set(); // Set of nominated player IDs
    this.gameMessageId = null; // Store message ID for editing
    this.creatorUsername = null; // Store game creator
    this.gameTimeout = null; // Store timeout for ending inactive games
    this.gameTimeoutDuration = 2 * 60 * 1000; // 2 minutes timeout
    this.messageIdsToDelete = new Set(); // Store all message IDs to delete when game ends
    this.votingMessageId = null; // Store voting message ID for updating
    this.votingUpdateInterval = null; // Store voting timer interval for cleanup
    this.lastSpyGuess = null; // Store the last guess made by a spy
  }

  addPlayer(userId, username) {
    if (this.players.find(p => p.id === userId)) {
      return false; // Player already in game
    }
    
    this.players.push({
      id: userId,
      username: username,
      role: null,
      isReady: false
    });
    return true;
  }

  removePlayer(userId) {
    const index = this.players.findIndex(p => p.id === userId);
    if (index !== -1) {
      this.players.splice(index, 1);
      return true;
    }
    return false;
  }

  getPlayerCount() {
    return this.players.length;
  }

  canStart() {
    return this.players.length >= 3 && this.players.length <= 8 && !this.isActive;
  }

  canAutoStart() {
    return this.canStart() && !this.waitingToStart;
  }

  startWaiting() {
    if (!this.canAutoStart()) {
      return false;
    }
    
    this.waitingToStart = true;
    this.waitStartTime = Date.now();
    return true;
  }

  getWaitingTime() {
    if (!this.waitingToStart || !this.waitStartTime) return 0;
    const elapsed = Date.now() - this.waitStartTime;
    return Math.max(0, this.settings.waitTime * 1000 - elapsed);
  }

  isWaitTimeUp() {
    return this.waitingToStart && this.getWaitingTime() <= 0;
  }


  startGame() {
    if (!this.canStart()) {
      return false;
    }

    // Cancel waiting timer if active
    this.waitingToStart = false;
    this.waitStartTime = null;

    // Select random location
    const locationIndex = Math.floor(Math.random() * locations.length);
    this.currentLocation = locations[locationIndex];
    console.log(`Selected location: ${this.currentLocation.name[this.settings.language]} (index: ${locationIndex})`);

    // Determine number of spies based on player count
    const spyCount = this.players.length <= 4 ? 1 : 2;
    
    // Select random spies using proper Fisher-Yates shuffle
    const indices = [...Array(this.players.length).keys()];
    
    // Fisher-Yates shuffle algorithm for proper randomization
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    
    const spyIndices = indices.slice(0, spyCount);
    this.spyIds = spyIndices.map(index => this.players[index].id);
    console.log(`Selected spies (indices: ${spyIndices}):`, this.spyIds);

    // Assign roles - ALL agents get the SAME role
    const availableRoles = [...this.currentLocation.roles[this.settings.language]];
    const spyRole = this.settings.language === 'uk' ? 'Шпигун' : 'Шпион';
    console.log(`Available roles for ${this.currentLocation.name[this.settings.language]}:`, availableRoles);
    console.log(`Total available roles: ${availableRoles.length}, Players: ${this.players.length}, Spies: ${spyCount}`)
    
    // Pick ONE random role for ALL agents
    const agentRole = availableRoles.length > 0 ? availableRoles[Math.floor(Math.random() * availableRoles.length)] : 'Агент';
    console.log(`Selected agent role for all non-spies: ${agentRole}`);
    
    this.players.forEach((player, index) => {
      if (spyIndices.includes(index)) {
        player.role = spyRole;
        console.log(`Assigned spy role to ${player.username}: ${player.role}`);
      } else {
        player.role = agentRole;
        console.log(`Assigned agent role to ${player.username}: ${player.role}`);
      }
    });

    // Final verification of role assignments
    console.log('Final role assignments:');
    this.players.forEach(player => {
      console.log(`${player.username}: ${player.role} (${this.isSpy(player.id) ? 'SPY' : 'AGENT'})`);
    });

    this.isActive = true;
    this.startTime = Date.now();
    this.gameLength = this.settings.duration * 60 * 1000; // Convert minutes to milliseconds
    console.log(`Game started for chat ${this.chatId}, duration: ${this.settings.duration} minutes, isActive: ${this.isActive}`);
    return true;
  }

  getPlayerRole(userId) {
    const player = this.players.find(p => p.id === userId);
    return player ? player.role : null;
  }

  getLocation() {
    if (!this.currentLocation) return null;
    return this.currentLocation.name[this.settings.language];
  }

  isSpy(userId) {
    return this.spyIds.includes(userId);
  }

  getSpyCount() {
    return this.spyIds.length;
  }

  getSpies() {
    return this.players.filter(p => this.spyIds.includes(p.id));
  }

  getRemainingTime() {
    if (!this.isActive || !this.startTime) return 0;
    const elapsed = Date.now() - this.startTime;
    return Math.max(0, this.gameLength - elapsed);
  }

  isTimeUp() {
    return this.getRemainingTime() <= 0;
  }

  endGame() {
    console.log(`Game ended for chat ${this.chatId}`);
    this.isActive = false;
    this.startTime = null;
  }

  reset() {
    this.players = [];
    this.isActive = false;
    this.currentLocation = null;
    this.spyIds = [];
    this.startTime = null;
    this.waitingToStart = false;
    this.waitStartTime = null;
    this.votingActive = false;
    this.votes.clear();
    this.votingStartTime = null;
    this.nominees.clear();
    this.gameMessageId = null;
    this.creatorUsername = null;
    this.messageIdsToDelete.clear();
    this.votingMessageId = null;
    this.votingUpdateInterval = null;
    this.lastSpyGuess = null;
    this.clearGameTimeout();
  }

  checkSpyGuess(guess) {
    console.log(`checkSpyGuess - Active: ${this.isActive}, Agent Role: ${this.getAgentRole()}, Guess: "${guess}"`);
    
    if (!this.isActive) {
      return { success: false, reason: 'no_active_game' };
    }
    
    // Store the guess for final message display
    this.lastSpyGuess = guess.trim();
    
    const normalizedGuess = guess.toLowerCase().trim();
    const agentRole = this.getAgentRole();
    
    if (!agentRole) {
      return { success: false, reason: 'no_agent_role' };
    }
    
    const normalizedAgentRole = agentRole.toLowerCase().trim();
    
    console.log(`Comparing "${normalizedGuess}" with agent role "${normalizedAgentRole}"`);
    
    if (normalizedGuess === normalizedAgentRole) {
      return { success: true, correct: true };
    }
    
    return { success: true, correct: false };
  }

  getAgentRole() {
    // Find the first non-spy player to get the agent role
    const agent = this.players.find(p => !this.spyIds.includes(p.id));
    return agent ? agent.role : null;
  }

  getSpyPlayers() {
    return this.players.filter(p => this.spyIds.includes(p.id));
  }

  setDuration(minutes) {
    if (this.isActive) {
      return { success: false, reason: 'game_active' };
    }
    
    if (minutes < 1 || minutes > 20) {
      return { success: false, reason: 'invalid_range' };
    }
    
    this.settings.duration = minutes;
    return { success: true };
  }

  getDuration() {
    return this.settings.duration;
  }

  setLanguage(language) {
    if (this.isActive) {
      return { success: false, reason: 'game_active' };
    }
    
    if (!['uk', 'ru'].includes(language)) {
      return { success: false, reason: 'invalid_language' };
    }
    
    this.settings.language = language;
    return { success: true };
  }

  getLanguage() {
    return this.settings.language;
  }

  setShowLocation(showLocation) {
    if (this.isActive) {
      return { success: false, reason: 'game_active' };
    }
    
    this.settings.showLocation = Boolean(showLocation);
    return { success: true };
  }

  getShowLocation() {
    return this.settings.showLocation;
  }

  getGameStatus() {
    return {
      isActive: this.isActive,
      playerCount: this.players.length,
      players: this.players.map(p => ({ username: p.username, isReady: p.isReady })),
      remainingTime: this.getRemainingTime(),
      location: this.isActive ? this.currentLocation.name : null,
      waitingToStart: this.waitingToStart,
      waitingTime: this.getWaitingTime(),
      votingActive: this.votingActive,
      votingTime: this.getVotingTime()
    };
  }

  // Nomination methods
  nominatePlayer(playerId) {
    if (!this.isActive || !this.players.find(p => p.id === playerId)) {
      return false;
    }
    this.nominees.add(playerId);
    return true;
  }

  getNominees() {
    return this.players.filter(p => this.nominees.has(p.id));
  }

  isNominated(playerId) {
    return this.nominees.has(playerId);
  }

  clearNominations() {
    this.nominees.clear();
  }

  // Voting system methods
  startVoting() {
    if (!this.isActive || this.votingActive) {
      return false;
    }
    
    this.votingActive = true;
    this.votingStartTime = Date.now();
    this.votes.clear();
    // Keep nominees from nomination phase
    return true;
  }

  vote(voterId, targetId, voteType = 'for') {
    if (!this.votingActive || !this.isActive) {
      return { success: false, reason: 'no_voting' };
    }

    // Check if voter is in game
    const voter = this.players.find(p => p.id === voterId);
    if (!voter) {
      return { success: false, reason: 'not_player' };
    }

    // Check if target is in game and is nominated
    const target = this.players.find(p => p.id === targetId);
    if (!target) {
      return { success: false, reason: 'invalid_target' };
    }
    
    if (!this.isNominated(targetId)) {
      return { success: false, reason: 'not_nominated' };
    }

    // Can't vote for yourself
    if (voterId === targetId) {
      return { success: false, reason: 'self_vote' };
    }

    this.votes.set(voterId, { targetId, voteType });
    return { success: true, target: target.username, voteType };
  }

  getVotingTime() {
    if (!this.votingActive || !this.votingStartTime) return 0;
    const elapsed = Date.now() - this.votingStartTime;
    return Math.max(0, this.votingDuration - elapsed);
  }

  isVotingTimeUp() {
    return this.votingActive && this.getVotingTime() <= 0;
  }

  getVoteResults() {
    const forVotes = new Map(); // playerId -> count of 'for' votes
    const againstVotes = new Map(); // playerId -> count of 'against' votes
    const netVotes = new Map(); // playerId -> (for votes - against votes)
    const voterDetails = new Map(); // playerId -> {forVoters: [], againstVoters: []}
    
    // Count votes for each player
    for (const [voterId, voteData] of this.votes) {
      const voter = this.players.find(p => p.id === voterId);
      const { targetId, voteType } = voteData;
      
      // Initialize maps if needed
      if (!forVotes.has(targetId)) {
        forVotes.set(targetId, 0);
        againstVotes.set(targetId, 0);
        voterDetails.set(targetId, { forVoters: [], againstVoters: [] });
      }
      
      if (voteType === 'for') {
        forVotes.set(targetId, forVotes.get(targetId) + 1);
        voterDetails.get(targetId).forVoters.push(voter.username);
      } else {
        againstVotes.set(targetId, againstVotes.get(targetId) + 1);
        voterDetails.get(targetId).againstVoters.push(voter.username);
      }
    }
    
    // Calculate net votes (for - against) for each player
    const allPlayerIds = new Set([...forVotes.keys(), ...againstVotes.keys()]);
    for (const playerId of allPlayerIds) {
      const forCount = forVotes.get(playerId) || 0;
      const againstCount = againstVotes.get(playerId) || 0;
      netVotes.set(playerId, forCount - againstCount);
    }

    // Find player(s) with most net votes (only positive counts)
    let maxNetVotes = 0;
    let mostVoted = [];
    
    for (const [playerId, netCount] of netVotes) {
      if (netCount > 0 && netCount > maxNetVotes) {
        maxNetVotes = netCount;
        mostVoted = [playerId];
      } else if (netCount > 0 && netCount === maxNetVotes) {
        mostVoted.push(playerId);
      }
    }

    return {
      forVotes,
      againstVotes,
      netVotes,
      voterDetails,
      mostVoted,
      maxVotes: maxNetVotes,
      totalVotes: this.votes.size,
      totalPlayers: this.players.length
    };
  }

  eliminatePlayer(playerId) {
    const playerIndex = this.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return null;
    
    const eliminatedPlayer = this.players[playerIndex];
    this.players.splice(playerIndex, 1);
    
    // Remove from spies if they were a spy
    const spyIndex = this.spyIds.indexOf(playerId);
    if (spyIndex !== -1) {
      this.spyIds.splice(spyIndex, 1);
    }
    
    return eliminatedPlayer;
  }

  endVoting() {
    this.votingActive = false;
    this.votingStartTime = null;
    this.votes.clear();
    this.nominees.clear();
    if (this.votingUpdateInterval) {
      clearInterval(this.votingUpdateInterval);
      this.votingUpdateInterval = null;
    }
  }

  checkWinCondition() {
    const remainingSpies = this.spyIds.length;
    const remainingAgents = this.players.length - remainingSpies;
    
    if (remainingSpies === 0) {
      return { gameEnded: true, winner: 'agents', reason: 'all_spies_eliminated' };
    }
    
    if (remainingSpies > remainingAgents) {
      return { gameEnded: true, winner: 'spies', reason: 'spies_majority' };
    }
    
    return { gameEnded: false };
  }

  // Helper methods for message content
  setGameMessageId(messageId) {
    this.gameMessageId = messageId;
  }

  getGameMessageId() {
    return this.gameMessageId;
  }

  setCreatorUsername(username) {
    this.creatorUsername = username;
  }

  getCreatorUsername() {
    return this.creatorUsername;
  }

  // Message management methods
  addMessageToDelete(messageId) {
    if (messageId) {
      this.messageIdsToDelete.add(messageId);
    }
  }

  getMessageIdsToDelete() {
    return Array.from(this.messageIdsToDelete);
  }

  clearMessageIds() {
    this.messageIdsToDelete.clear();
  }

  setVotingMessageId(messageId) {
    this.votingMessageId = messageId;
  }

  getVotingMessageId() {
    return this.votingMessageId;
  }

  getLastSpyGuess() {
    return this.lastSpyGuess;
  }

  // Timeout management methods
  startGameTimeout() {
    this.clearGameTimeout();
    this.gameTimeout = Date.now();
  }

  clearGameTimeout() {
    if (this.gameTimeout) {
      this.gameTimeout = null;
    }
  }

  getGameTimeoutRemaining() {
    if (!this.gameTimeout) return 0;
    const elapsed = Date.now() - this.gameTimeout;
    return Math.max(0, this.gameTimeoutDuration - elapsed);
  }

  isGameTimeoutExpired() {
    return this.gameTimeout && this.getGameTimeoutRemaining() <= 0;
  }

  generateGameMessage(creatorUsername = null) {
    const creator = creatorUsername || this.creatorUsername;
    const playerCount = this.players.length;
    const lang = this.settings.language;
    const languageName = getTranslation(lang === 'uk' ? 'ukrainian' : 'russian', lang);
    
    let message = `${getTranslation('game_created', lang)}\n\n`;
    message += `${getTranslation('started_by', lang)}${creator}\n\n`;
    
    // Player list
    if (playerCount > 0) {
      message += `${getTranslation('players_count', lang)} (${playerCount}/8):\n`;
      this.players.forEach((player, index) => {
        message += `${index + 1}. ${player.username}\n`;
      });
      message += `\n`;
    } else {
      message += `${getTranslation('no_players_yet', lang)}\n\n`;
    }
    
    // Game status
    if (this.waitingToStart) {
      const waitTime = Math.ceil(this.getWaitingTime() / 1000);
      message += `${getTranslation('auto_starting_in', lang)}${waitTime}${getTranslation('seconds', lang)}\n`;
      message += `${getTranslation('start_immediately', lang)}\n\n`;
    } else if (playerCount >= 3) {
      message += `${getTranslation('ready_to_start', lang)}\n`;
      message += `${getTranslation('auto_start_timer', lang)}\n\n`;
    } else {
      const needed = 3 - playerCount;
      const playerText = needed > 1 ? getTranslation('more_players', lang) : getTranslation('more_player', lang);
      message += `${getTranslation('need_more_players', lang)}${needed}${playerText}\n`;
      
      // Show timeout remaining if active
      if (this.gameTimeout) {
        const timeoutRemaining = Math.ceil(this.getGameTimeoutRemaining() / 1000);
        message += `${getTranslation('game_expires_in', lang)}${Math.floor(timeoutRemaining / 60)}:${(timeoutRemaining % 60).toString().padStart(2, '0')}\n`;
      }
      message += `\n`;
    }
    
    // Game info
    message += `${getTranslation('game_info', lang)}\n`;
    message += `${getTranslation('spy_info', lang)}\n`;
    message += `${getTranslation('duration', lang)}${this.getDuration()}${getTranslation('minutes', lang)}\n`;
    message += `${getTranslation('language', lang)}${languageName}\n`;
    message += `• ${this.settings.showLocation ? getTranslation('location_shown', lang) : getTranslation('location_hidden', lang)}\n\n`;
    message += `${getTranslation('click_to_join', lang)}`;
    
    return message;
  }
}

module.exports = SpyfallGame;