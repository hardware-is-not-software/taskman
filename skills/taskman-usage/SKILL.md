---
name: taskman-usage
description: "Use when operating this Taskman project locally: set up Python environment, launch the Flask app, verify the UI/API, and use the built-in MCP endpoint to list tasks, create tasks, and change task status."
---

# Taskman Usage

Use this workflow to run Taskman consistently and interact with MCP safely.

## 1) Set Environment

1. Use this exact project activation flow:

```bash
conda activate taskman
```
if there is no such conda env, create:
```bash
conda create --name taskman python
```
then activate
```bash
conda activate taskman
```

2. If dependencies are missing in that Conda env, install:

```bash
pip install -r requirements.txt
```

## 2) Launch Taskman

1. Start server:

```bash
python server.py
```

2. Open:

- UI: `http://localhost:5050`
- MCP endpoint: `http://localhost:5050/mcp`
- MCP config: `http://localhost:5050/api/mcp-config`

3. Confirm startup log includes:
- app URL
- tasks file path
- notes path
- MCP server config JSON

## 3) View Data (UI and API)

Use UI for interactive view/edit, or call APIs directly:

- Tasks: `GET /api/tasks`
- Notes list: `GET /api/topics`
- Categories: `GET /api/categories`
- Snapshots: `GET /api/snapshots`

Example:

```bash
curl -s http://localhost:5050/api/tasks
```

## 4) Use MCP

Taskman exposes these MCP tools:

- `taskman.list_tasks` — list tasks with optional filters: status, category, overdue (boolean), priority, limit
- `taskman.create_task`
- `taskman.set_task_status`
- `taskman.close_task` — close a task (set status to closed); optional `closing_remarks` for extra context
- `taskman.create_note` — create a note in the notes folder (name, optional content, optional filepath)

## 5) Guardrails

1. Use MCP tools for task-only changes when integrating with external agents.
2. Do not modify storage settings through MCP workflows.
3. Do not perform delete/restore file operations when task updates are sufficient.
