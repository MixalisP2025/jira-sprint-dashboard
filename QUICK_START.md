# 🚀 Quick Start Guide - Jira Sprint Dashboard

## Start the Dashboard (Easiest Way)

### Windows Users:
Double-click one of these files:
- `start-dashboard.bat` (Command Prompt)
- `start-dashboard.ps1` (PowerShell)

### Or use npm:
```bash
npm start
```

This starts both servers:
- **Backend**: http://localhost:4001
- **Frontend**: http://localhost:5174

## Stop the Dashboard
Press `Ctrl+C` in the terminal

---

## First Time Setup

### 1. Install Dependencies
```bash
npm install
cd server
npm install
cd ..
```

### 2. Create Jira Credentials
Create `server/.env` file:
```env
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token-here
```

Get your API token: https://id.atlassian.com/manage-profile/security/api-tokens

### 3. Start the Dashboard
```bash
npm start
```

### 4. Open in Browser
Navigate to: http://localhost:5174

---

## Troubleshooting

**Port already in use?**
```bash
# Windows - Kill process on port 4001
netstat -ano | findstr :4001
taskkill /PID <PID> /F

# Kill process on port 5174
netstat -ano | findstr :5174
taskkill /PID <PID> /F
```

**No data showing?**
1. Click "Refresh from Jira" button
2. Check browser console (F12) for errors
3. Verify `.env` file exists in `server` directory

**Connection refused?**
- Make sure both servers are running
- Check that backend is on port 4001
- Check that frontend is on port 5174

---

## Daily Usage

1. **Start**: Run `npm start` or double-click `start-dashboard.bat`
2. **Open**: Go to http://localhost:5174
3. **Refresh Data**: Click "Refresh from Jira" button
4. **Stop**: Press `Ctrl+C` in terminal

---

## Available Commands

| Command | What it does |
|---------|--------------|
| `npm start` | Start both servers together ⭐ |
| `npm run start:backend` | Start only backend |
| `npm run start:frontend` | Start only frontend |
| `npm run build` | Build for production |

---

## Need Help?

Check the full README.md for detailed documentation.
