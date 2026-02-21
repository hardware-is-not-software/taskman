# Task Manager

A lightweight task manager PWA built with Python/Flask and vanilla JavaScript.

## Features

- **Task Management**: Create, edit, delete tasks with status and priority
- **Inline Editing**: Click any task to edit directly (no modal popups)
- **Status**: Created, Active, Closed
- **Priority**: Urgent, Normal, Low
- **Filtering & Sorting**: Filter by status, sort by date or priority
- **Open Topics**: Create detailed topic files from tasks
- **Storage Panel**: Configure local live file paths and recovery destination
- **Path Browser**: Browse and pick file/folder locations directly from the storage panel
- **Automatic Cloud Sync Snapshots**: Auto-create protection snapshots before task/topic changes and write them to your configured synced folder
- **Snapshots & Recovery**: Create snapshots and restore with task-only revert or full recovery
- **Dark Mode**: Toggle between light and dark themes
- **PWA Support**: Install as a standalone app on macOS/Windows
- **Text Editor Compatible**: Data stored in human-readable markdown format

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Run the server
python server.py

# Open in browser
# http://localhost:5050
```

## Data Format

Tasks are stored in `tasks/runnning.md` in a human-readable format:

```
(status|priority|YYYY-MM-DD) task description
```

Example:
```
(active|urgent|2026-02-04) Review Q1 budget proposal
(created|normal|2026-02-04) Update team documentation
```

Storage locations are configurable in the app:

- **Live files**: local paths for task and topic files
- **Recovery snapshots**: folder path for snapshot storage (can be a OneDrive, SharePoint sync folder, or iCloud Drive folder)
- **Auto protection**: optional auto snapshots before changes, with configurable interval and retention count

## File Structure

```
├── server.py           # Flask API server
├── requirements.txt    # Python dependencies
├── static/
│   ├── index.html      # Main UI
│   ├── style.css       # Styling (with dark mode)
│   ├── app.js          # Frontend logic
│   ├── manifest.json   # PWA manifest
│   └── sw.js           # Service worker
├── tasks/              # Task data (not in repo)
└── topics/             # Topic files (not in repo)
```

## Usage

### Keyboard Shortcuts

- **Escape**: Cancel editing
- **Ctrl/Cmd + Enter**: Save while editing

### PWA Installation

- **Chrome/Edge**: Click install icon in address bar
- **Safari**: Share → Add to Dock

## License

MIT
