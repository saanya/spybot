# Docker Deployment Guide for Synology DS220+

## Prerequisites

1. **Enable Docker on your NAS:**
   - Open DSM → Package Center
   - Install "Docker" or "Container Manager"
   - Launch the application

2. **Prepare your bot token:**
   - Get your bot token from [@BotFather](https://t.me/BotFather)
   - Note your bot's username

## Quick Deployment

### Method 1: Using Docker Compose (Recommended)

1. **Upload files to NAS:**
   ```bash
   # Create project directory on your NAS
   mkdir -p /volume1/docker/spybot
   
   # Upload all project files to this directory
   ```

2. **Create environment file:**
   ```bash
   # Copy the example and edit it
   cp .env.example .env
   
   # Edit .env file with your bot token:
   BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyZ
   BOT_USERNAME=your_bot_username
   ```

3. **Deploy with Docker Compose:**
   ```bash
   # Navigate to project directory
   cd /volume1/docker/spybot
   
   # Build and start the container
   docker-compose up -d
   ```

4. **Check logs:**
   ```bash
   # View logs
   docker-compose logs -f spybot
   
   # Check container status
   docker-compose ps
   ```

### Method 2: Using Synology Container Manager GUI

1. **Upload project to NAS** via File Station to `/docker/spybot/`

2. **Open Container Manager:**
   - Go to **Project** → **Create**
   - Choose "Create docker-compose.yml"
   - Select your project folder
   - Container Manager will detect the docker-compose.yml

3. **Configure environment:**
   - Before starting, go to **Environment** tab
   - Add: `BOT_TOKEN=your_actual_token`
   - Add: `BOT_USERNAME=your_bot_username`

4. **Start the project:**
   - Click **Build** then **Run**
   - Monitor in the **Container** tab

### Method 3: Manual Docker Build

1. **Build the image:**
   ```bash
   cd /volume1/docker/spybot
   docker build -t spybot:latest .
   ```

2. **Run the container:**
   ```bash
   docker run -d \
     --name spybot-telegram-bot \
     --restart unless-stopped \
     -e BOT_TOKEN="your_bot_token_here" \
     -e BOT_USERNAME="your_bot_username" \
     -v $(pwd)/logs:/app/logs \
     -v $(pwd)/data:/app/data \
     spybot:latest
   ```

## Directory Structure on NAS

```
/volume1/docker/spybot/
├── src/                 # Bot source code
├── package.json         # Dependencies
├── Dockerfile          # Docker configuration
├── docker-compose.yml  # Container orchestration
├── .env                # Environment variables (create this)
├── .env.example        # Environment template
├── logs/               # Container logs (auto-created)
└── data/               # Persistent data (auto-created)
```

## Management Commands

### Start/Stop/Restart
```bash
# Using docker-compose
docker-compose up -d        # Start
docker-compose down         # Stop
docker-compose restart      # Restart

# Using docker directly
docker start spybot-telegram-bot
docker stop spybot-telegram-bot
docker restart spybot-telegram-bot
```

### Monitoring
```bash
# View logs
docker-compose logs -f spybot

# Check resource usage
docker stats spybot-telegram-bot

# Access container shell (debugging)
docker exec -it spybot-telegram-bot sh
```

### Updates
```bash
# Pull latest code and rebuild
git pull                    # If using git
docker-compose down         # Stop current container
docker-compose build       # Rebuild image
docker-compose up -d        # Start updated container

# Or rebuild without cache
docker-compose build --no-cache
```

## Resource Limits

The docker-compose.yml includes resource limits suitable for DS220+:
- **Memory:** 256MB limit, 128MB reserved
- **CPU:** 0.5 core limit, 0.25 core reserved

These can be adjusted based on your usage:

```yaml
deploy:
  resources:
    limits:
      memory: 512M      # Increase if needed
      cpus: '1.0'       # Increase if needed
```

## Troubleshooting

### Container won't start
```bash
# Check logs for errors
docker-compose logs spybot

# Common issues:
# 1. Missing BOT_TOKEN in .env
# 2. Invalid bot token
# 3. Insufficient permissions
```

### Bot not responding
1. **Check bot token:** Verify it's correct in `.env`
2. **Check network:** Ensure NAS has internet access
3. **Check logs:** `docker-compose logs -f spybot`
4. **Restart container:** `docker-compose restart spybot`

### Permission issues
```bash
# Fix file permissions
sudo chown -R 1001:1001 /volume1/docker/spybot/logs
sudo chown -R 1001:1001 /volume1/docker/spybot/data
```

### Memory issues on DS220+
If you encounter memory issues:
1. Lower resource limits in docker-compose.yml
2. Monitor usage: `docker stats`
3. Consider running fewer concurrent services

## Security Notes

1. **Environment variables:** Never commit `.env` with real tokens
2. **Network:** Bot runs in isolated Docker network
3. **User:** Container runs as non-root user (UID 1001)
4. **Firewall:** No ports exposed externally (bot connects to Telegram)

## Backup

Important files to backup:
- `.env` (your configuration)
- `logs/` (if you want to keep logs)
- `data/` (any persistent data)

## Performance Optimization

For DS220+ optimization:
1. **Use Alpine Linux base image** (already configured)
2. **Limit resources** (already configured)
3. **Use multi-stage builds** if needed
4. **Regular cleanup:**
   ```bash
   # Remove unused images
   docker image prune
   
   # Remove unused containers
   docker container prune
   ```

## Support

If you encounter issues:
1. Check the logs first: `docker-compose logs spybot`
2. Verify your bot token with [@BotFather](https://t.me/BotFather)
3. Ensure your NAS has sufficient resources
4. Check Synology DSM system logs