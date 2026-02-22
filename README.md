# Task Manager

A lightweight task manager PWA built with Python/Flask and vanilla JavaScript.

## Features

- **Task Management**: Create, edit, delete tasks with status and priority
- **Inline Editing**: Click any task to edit directly (no modal popups)
- **Status**: Created, Active, Due, Closed, Deleted
- **Priority**: Urgent, Normal, Low
- **Filtering & Sorting**:
  - Filter by status and category chips
  - Sort by Newest, Oldest, Priority, Status, or Category
  - Status sort order: Due, Active, Created, Closed, Deleted
  - Category sort: A-Z, then status order within each category
- **Notes**: Create detailed note files from tasks
- **Category Management**: Add, rename, and delete categories (default is protected)
- **Storage Panel**: Configure local live file paths and recovery destination
- **Path Browser**: Browse and pick file/folder locations directly from the storage panel
- **Automatic Cloud Sync Snapshots**: Auto-create protection snapshots before task/note changes and write them to your configured synced folder
- **Snapshots & Recovery**: Create snapshots and restore with task-only revert or full recovery (includes backup of `storage_config.json` and `categories.json`; restored in full recovery)
- **Dark Mode**: Toggle between light and dark themes
- **PWA Support**: Install as a standalone app on macOS/Windows
- **Fast Tooltips**: Immediate hover/focus tooltips for action buttons
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

## MCP Server (for Cursor/Codex)

MCP is served by the same web server process.

```bash
python server.py
```

Exposed MCP tools are intentionally restricted to task-safe operations only:

- `taskman.list_tasks` (read tasks; filter by status, category, overdue, priority)
- `taskman.create_task` (create task)
- `taskman.set_task_status` (change task status)
- `taskman.close_task` (close task; optional closing_remarks)
- `taskman.create_note` (create a note in the notes folder)
- `taskman.search_notes` (search notes by query; matches filename and content)
- `taskman.get_note` (get full content of a note by filename)

Not exposed via MCP:

- storage configuration changes
- file/note deletion flows
- snapshot restore/storage mutation endpoints

Connection details are available at `/api/mcp-config`, and MCP JSON-RPC requests are handled at `/mcp`.
When the web server starts, the MCP config is printed to console and appended to `server.log`.
The GUI includes an `MCP` button that opens a dialog with copy-ready config JSON.

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

- **Live files**: local paths for task and note files
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
│   ├── sw.js           # Service worker
│   ├── offline.html    # Offline fallback page
│   └── icons/          # PWA icons
├── tasks/              # Task data (not in repo)
└── topics/             # Note files (not in repo)
```

## Usage

### Keyboard Shortcuts

- **Escape**: Cancel editing
- **Ctrl/Cmd + Enter**: Save while editing

### PWA Installation

- **Chrome/Edge**: Click install icon in address bar
- **Safari**: Share → Add to Dock

### PWA Troubleshooting (Chrome)

If installability or recent UI updates seem stuck:

1. Open DevTools → Application → Service Workers → **Unregister**
2. Open DevTools → Application → Storage → **Clear site data**
3. Hard refresh the page (`Cmd/Ctrl+Shift+R`)

## License

MIT
