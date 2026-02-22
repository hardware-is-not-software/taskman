#!/usr/bin/env python3
"""
Task Manager - Flask API Server
Manages tasks in markdown and note files with configurable storage and snapshots.
MCP tools are served via FastMCP on port 5051 (streamable-HTTP transport).
"""

from flask import Flask, jsonify, request, send_from_directory
from datetime import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import threading

from mcp.server.fastmcp import FastMCP

app = Flask(__name__, static_folder='static', static_url_path='')

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_TASKS_FILE = os.path.join(BASE_DIR, 'tasks', 'tasks.md')
DEFAULT_TOPICS_DIR = os.path.join(BASE_DIR, 'topics')
DEFAULT_RECOVERY_DIR = os.path.join(BASE_DIR, 'recovery')
STORAGE_CONFIG_FILE = os.path.join(BASE_DIR, 'storage_config.json')
LEGACY_STORAGE_CONFIG_FILE = os.path.join(BASE_DIR, 'tasks', 'storage_config.json')
CATEGORIES_FILE = os.path.join(BASE_DIR, 'categories.json')
STARTUP_LOG_FILE = os.path.join(BASE_DIR, 'server.log')
DEFAULT_CATEGORY = 'default'
ALLOWED_PROVIDERS = {'local', 'onedrive', 'sharepoint', 'icloud'}
SNAPSHOT_NAME_PATTERN = re.compile(r'^[A-Za-z0-9_-]+$')
MCP_SERVER_NAME = 'taskman-mcp'
MCP_SERVER_VERSION = '1.0.0'
MCP_PORT = 5051

STATUS_OPTIONS = ['created', 'active', 'closed', 'deleted']

# Task format regex: (status|priority|date|due|categories) description
TASK_PATTERN = re.compile(r'^\(([^)]+)\)\s+(.+)$')
# Legacy format: (status)   description
LEGACY_PATTERN = re.compile(r'^\((\w+)\)\s+(.+)$')

# FastMCP instance — serves MCP streamable-HTTP transport on MCP_PORT
mcp = FastMCP(
    MCP_SERVER_NAME,
    host='127.0.0.1',
    port=MCP_PORT,
)


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

def normalize_path(value):
    if not isinstance(value, str):
        return ''
    trimmed = value.strip()
    if not trimmed:
        return ''
    return os.path.abspath(os.path.expanduser(trimmed))


def default_browse_path():
    return os.path.expanduser('~')


def nearest_existing_directory(path_value):
    if not path_value:
        return default_browse_path()

    current = normalize_path(path_value)
    if not current:
        return default_browse_path()

    if os.path.isdir(current):
        return current
    if os.path.isfile(current):
        return os.path.dirname(current)

    probe = current
    while True:
        parent = os.path.dirname(probe)
        if os.path.exists(probe):
            return probe if os.path.isdir(probe) else os.path.dirname(probe)
        if parent == probe:
            return default_browse_path()
        probe = parent


def normalize_provider(value):
    provider = (value or 'local').strip().lower()
    return provider if provider in ALLOWED_PROVIDERS else 'local'


def normalize_bool(value, default=True):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {'true', '1', 'yes', 'on'}:
            return True
        if lowered in {'false', '0', 'no', 'off'}:
            return False
    return default


def normalize_int(value, default, minimum=None, maximum=None):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    if minimum is not None:
        parsed = max(minimum, parsed)
    if maximum is not None:
        parsed = min(maximum, parsed)
    return parsed


def default_storage_config():
    return {
        'tasks_file': DEFAULT_TASKS_FILE,
        'topics_dir': DEFAULT_TOPICS_DIR,
        'recovery_provider': 'local',
        'recovery_dir': DEFAULT_RECOVERY_DIR,
        'auto_snapshot_enabled': True,
        'auto_snapshot_interval_seconds': 30,
        'snapshot_retention_count': 200,
    }


def normalized_storage_config(data):
    defaults = default_storage_config()
    config = {
        'tasks_file': normalize_path(data.get('tasks_file')) or defaults['tasks_file'],
        'topics_dir': normalize_path(data.get('topics_dir')) or defaults['topics_dir'],
        'recovery_provider': normalize_provider(data.get('recovery_provider')),
        'recovery_dir': normalize_path(data.get('recovery_dir')) or defaults['recovery_dir'],
        'auto_snapshot_enabled': normalize_bool(
            data.get('auto_snapshot_enabled'),
            defaults['auto_snapshot_enabled']
        ),
        'auto_snapshot_interval_seconds': normalize_int(
            data.get('auto_snapshot_interval_seconds'),
            defaults['auto_snapshot_interval_seconds'],
            minimum=0,
            maximum=86400
        ),
        'snapshot_retention_count': normalize_int(
            data.get('snapshot_retention_count'),
            defaults['snapshot_retention_count'],
            minimum=10,
            maximum=5000
        ),
    }
    return config


def load_storage_config():
    defaults = default_storage_config()
    config_path = STORAGE_CONFIG_FILE

    if not os.path.exists(config_path) and not os.path.exists(LEGACY_STORAGE_CONFIG_FILE):
        config = normalized_storage_config(defaults)
        try:
            ensure_storage_targets(config)
            save_storage_config(config)
        except OSError:
            pass
        return config

    if not os.path.exists(config_path) and os.path.exists(LEGACY_STORAGE_CONFIG_FILE):
        config_path = LEGACY_STORAGE_CONFIG_FILE

    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            raw = json.load(f)
        if not isinstance(raw, dict):
            return normalized_storage_config(defaults)
        config = normalized_storage_config(raw)
        if config_path == LEGACY_STORAGE_CONFIG_FILE:
            try:
                save_storage_config(config)
            except OSError:
                pass
        return config
    except (OSError, ValueError):
        return normalized_storage_config(defaults)


def save_storage_config(config):
    os.makedirs(os.path.dirname(STORAGE_CONFIG_FILE), exist_ok=True)
    with open(STORAGE_CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2)


def normalize_category_name(value):
    if not isinstance(value, str):
        return ''
    name = value.strip()
    if not name:
        return ''
    name = re.sub(r'[|()]+', '-', name)
    name = name.lstrip('-').strip()
    return name


def normalize_category_list(values):
    items = []
    if isinstance(values, str):
        items = values.split(',')
    elif isinstance(values, list):
        items = values

    cleaned = []
    seen = set()
    for item in items:
        name = normalize_category_name(item)
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(name)

    if not cleaned:
        cleaned = [DEFAULT_CATEGORY]
    return cleaned


def ensure_categories_file():
    if os.path.exists(CATEGORIES_FILE):
        return
    with open(CATEGORIES_FILE, 'w', encoding='utf-8') as f:
        json.dump([DEFAULT_CATEGORY], f, indent=2)


def save_categories(categories):
    normalized = normalize_category_list(categories)
    ordered = [DEFAULT_CATEGORY] + [
        cat for cat in normalized if cat.lower() != DEFAULT_CATEGORY
    ]
    os.makedirs(os.path.dirname(CATEGORIES_FILE), exist_ok=True)
    with open(CATEGORIES_FILE, 'w', encoding='utf-8') as f:
        json.dump(ordered, f, indent=2)
    return ordered


def load_categories():
    ensure_categories_file()
    try:
        with open(CATEGORIES_FILE, 'r', encoding='utf-8') as f:
            raw = json.load(f)
    except (OSError, ValueError):
        raw = [DEFAULT_CATEGORY]
    if not isinstance(raw, list):
        raw = [DEFAULT_CATEGORY]
    categories = save_categories(raw)
    return categories


def get_default_category(category_list):
    for category in category_list:
        if category.lower() == DEFAULT_CATEGORY:
            return category
    return DEFAULT_CATEGORY


def normalize_task_categories(value, allowed_categories=None):
    normalized = normalize_category_list(value)
    if not allowed_categories:
        return normalized
    allowed_lookup = {cat.lower(): cat for cat in allowed_categories}
    resolved = []
    seen = set()
    for name in normalized:
        match = allowed_lookup.get(name.lower())
        if not match:
            continue
        key = match.lower()
        if key in seen:
            continue
        seen.add(key)
        resolved.append(match)
    if not resolved:
        resolved = [allowed_lookup.get(DEFAULT_CATEGORY, DEFAULT_CATEGORY)]
    return resolved


def normalize_categories(value):
    return normalize_category_list(value)


def sync_categories_from_tasks(tasks):
    categories = load_categories()
    lookup = {cat.lower() for cat in categories}
    changed = False
    for task in tasks:
        for category in task.get('categories', []):
            name = normalize_category_name(category)
            if not name:
                continue
            key = name.lower()
            if key not in lookup:
                categories.append(name)
                lookup.add(key)
                changed = True
    if changed:
        categories = save_categories(categories)
    return categories


def ensure_storage_targets(config):
    os.makedirs(os.path.dirname(config['tasks_file']), exist_ok=True)
    os.makedirs(config['topics_dir'], exist_ok=True)
    os.makedirs(config['recovery_dir'], exist_ok=True)
    if not os.path.exists(config['tasks_file']):
        with open(config['tasks_file'], 'w', encoding='utf-8') as f:
            f.write('')


def snapshot_root(config):
    return os.path.join(config['recovery_dir'], 'snapshots')


def list_fs_entries(path_value, mode):
    browse_mode = mode if mode in {'file', 'dir'} else 'dir'
    current_path = nearest_existing_directory(path_value)
    if not os.path.isdir(current_path):
        raise NotADirectoryError('Path is not a directory')

    entries = []
    try:
        with os.scandir(current_path) as it:
            for entry in it:
                name = entry.name
                if name in {'.', '..'}:
                    continue
                entry_path = os.path.abspath(entry.path)
                if entry.is_dir(follow_symlinks=False):
                    entries.append({
                        'name': name,
                        'path': entry_path,
                        'type': 'dir',
                    })
                elif browse_mode == 'file' and entry.is_file(follow_symlinks=False):
                    entries.append({
                        'name': name,
                        'path': entry_path,
                        'type': 'file',
                    })
    except PermissionError:
        raise PermissionError('Permission denied for this path')

    entries.sort(key=lambda item: (item['type'] != 'dir', item['name'].lower()))
    parent_path = os.path.dirname(current_path) if os.path.dirname(current_path) != current_path else ''
    return {
        'current_path': current_path,
        'parent_path': parent_path,
        'entries': entries,
        'mode': browse_mode
    }


def native_pick_path(mode, initial_path):
    picker_mode = mode if mode in {'dir', 'file', 'save_file'} else 'dir'
    if sys.platform != 'darwin':
        raise RuntimeError('System picker currently supported on macOS only')

    start_dir = nearest_existing_directory(initial_path)
    initial_name = 'runnning.md'
    if initial_path:
        normalized = normalize_path(initial_path)
        if normalized and not os.path.isdir(normalized):
            initial_name = os.path.basename(normalized) or initial_name

    if picker_mode == 'dir':
        script = (
            'set startFolder to POSIX file "{}"\n'
            'POSIX path of (choose folder with prompt "Select folder" default location startFolder)'
        ).format(start_dir.replace('"', '\\"'))
    elif picker_mode == 'file':
        script = (
            'set startFolder to POSIX file "{}"\n'
            'POSIX path of (choose file with prompt "Select file" default location startFolder)'
        ).format(start_dir.replace('"', '\\"'))
    else:
        script = (
            'set startFolder to POSIX file "{}"\n'
            'POSIX path of (choose file name with prompt "Select file location" '
            'default location startFolder default name "{}")'
        ).format(
            start_dir.replace('"', '\\"'),
            initial_name.replace('"', '\\"')
        )

    result = subprocess.run(
        ['osascript', '-e', script],
        capture_output=True,
        text=True
    )

    if result.returncode != 0:
        if '(-128)' in (result.stderr or ''):
            return {'cancelled': True, 'path': ''}
        raise RuntimeError((result.stderr or 'System picker failed').strip())

    selected = (result.stdout or '').strip()
    if not selected:
        return {'cancelled': True, 'path': ''}
    return {'cancelled': False, 'path': normalize_path(selected)}


def is_date(value):
    return bool(re.match(r'^\d{4}-\d{2}-\d{2}$', value))


def mcp_server_config(web_url='http://localhost:5050'):
    mcp_url = f'http://localhost:{MCP_PORT}/mcp'
    return {
        'mcpServers': {
            MCP_SERVER_NAME: {
                'url': mcp_url,
                'type': 'http',
            }
        }
    }


def write_startup_log(web_url, config):
    timestamp = datetime.now().isoformat(timespec='seconds')
    mcp_config = mcp_server_config(web_url)
    lines = [
        f"[{timestamp}] Task Manager running at {web_url}",
        f"Tasks file: {config['tasks_file']}",
        f"Notes: {config['topics_dir']}",
        f"Recovery snapshots: {snapshot_root(config)}",
        f"MCP server: http://localhost:{MCP_PORT}/mcp",
        f"MCP server config: {json.dumps(mcp_config, ensure_ascii=True)}",
        ""
    ]
    try:
        with open(STARTUP_LOG_FILE, 'a', encoding='utf-8') as f:
            f.write('\n'.join(lines))
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Task file I/O
# ---------------------------------------------------------------------------

def parse_tasks(tasks_file=None):
    """Parse tasks from running.md file."""
    config = load_storage_config()
    tasks_file = tasks_file or config['tasks_file']
    tasks = []
    if not os.path.exists(tasks_file):
        return tasks

    with open(tasks_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    current_task = None
    task_id = 0
    in_closing_remarks = False

    for line in lines:
        line = line.rstrip('\n')

        if not line.strip() and current_task is None:
            continue

        match = TASK_PATTERN.match(line)
        if match:
            in_closing_remarks = False
            if current_task:
                tasks.append(current_task)
            header, description = match.groups()
            parts = header.split('|')
            if len(parts) >= 3:
                status = parts[0]
                priority = parts[1]
                date = parts[2]
                due_date = None
                categories_raw = None
                if len(parts) >= 4:
                    candidate = parts[3].strip()
                    if candidate == '':
                        if len(parts) >= 5:
                            categories_raw = '|'.join(parts[4:])
                    elif is_date(candidate):
                        due_date = candidate
                        if len(parts) >= 5:
                            categories_raw = '|'.join(parts[4:])
                    else:
                        categories_raw = '|'.join(parts[3:])
                current_task = {
                    'id': task_id,
                    'status': status,
                    'priority': priority,
                    'date': date,
                    'due_date': due_date,
                    'description': description,
                    'categories': normalize_task_categories(categories_raw)
                }
                task_id += 1
                continue

        legacy_match = LEGACY_PATTERN.match(line)
        if legacy_match:
            in_closing_remarks = False
            if current_task:
                tasks.append(current_task)
            status, description = legacy_match.groups()
            current_task = {
                'id': task_id,
                'status': status,
                'priority': 'normal',
                'date': datetime.now().strftime('%Y-%m-%d'),
                'due_date': None,
                'description': description.strip(),
                'categories': [DEFAULT_CATEGORY]
            }
            task_id += 1
            continue

        if line.startswith('    ') and current_task:
            if line.startswith('    [closing_remarks] '):
                in_closing_remarks = True
                current_task['closing_remarks'] = line[22:]
                continue
            if in_closing_remarks:
                current_task['closing_remarks'] += '\n' + line[4:]
                continue
            current_task['description'] += '\n' + line[4:]
            continue

        in_closing_remarks = False

    if current_task:
        tasks.append(current_task)

    return tasks


def save_tasks(tasks, tasks_file=None):
    """Save tasks to running.md file."""
    config = load_storage_config()
    tasks_file = tasks_file or config['tasks_file']
    os.makedirs(os.path.dirname(tasks_file), exist_ok=True)

    with open(tasks_file, 'w', encoding='utf-8') as f:
        for task in tasks:
            categories = normalize_task_categories(task.get('categories', []))
            due_date = task.get('due_date')
            if categories or due_date:
                due_segment = due_date or ''
                cat_segment = f"|{','.join(categories)}" if categories else ""
                header = f"({task['status']}|{task['priority']}|{task['date']}|{due_segment}{cat_segment})"
            else:
                header = f"({task['status']}|{task['priority']}|{task['date']})"
            f.write(f"{header} {task['description'].split(chr(10))[0]}\n")
            desc_lines = task['description'].split('\n')
            for extra_line in desc_lines[1:]:
                f.write(f"    {extra_line}\n")
            closing_remarks = task.get('closing_remarks') or ''
            if closing_remarks:
                rem_lines = closing_remarks.split('\n')
                f.write(f"    [closing_remarks] {rem_lines[0]}\n")
                for rem_line in rem_lines[1:]:
                    f.write(f"    {rem_line}\n")


# ---------------------------------------------------------------------------
# Note file I/O
# ---------------------------------------------------------------------------

def _create_note_internal(name, content='', filepath=None):
    """Create a note file in the configured notes folder."""
    config = load_storage_config()
    topics_dir = config['topics_dir']
    safe_name = re.sub(r'[^\w\-]', '_', (name or 'untitled').strip()) or 'untitled'
    today = datetime.now()
    requested_filepath = normalize_path(filepath) if filepath else None

    if requested_filepath:
        topics_dir_abs = os.path.abspath(topics_dir)
        requested_abs = os.path.abspath(requested_filepath)
        try:
            same_root = os.path.commonpath([topics_dir_abs, requested_abs]) == topics_dir_abs
        except ValueError:
            same_root = False
        if not same_root:
            raise ValueError('Note file must be inside the configured notes folder')
        filepath = requested_abs
        if not filepath.lower().endswith('.md'):
            filepath = f"{filepath}.md"
        filename = os.path.basename(filepath)
        safe_name = os.path.splitext(filename)[0]
    else:
        filename = f"{today.year}_{today.month}_{today.day}_{safe_name}.md"
        filepath = os.path.join(topics_dir, filename)

    if os.path.exists(filepath):
        raise ValueError('Note with this name already exists')

    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content or '')

    return {
        'filename': filename,
        'name': safe_name,
        'date': today.strftime('%Y-%m-%d'),
        'path': filepath
    }


# ---------------------------------------------------------------------------
# Snapshot helpers
# ---------------------------------------------------------------------------

def next_snapshot_id(root_dir, prefix='snapshot'):
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    candidate = f"{prefix}_{ts}"
    path = os.path.join(root_dir, candidate)
    if not os.path.exists(path):
        return candidate

    suffix = 1
    while True:
        candidate = f"{prefix}_{ts}_{suffix}"
        path = os.path.join(root_dir, candidate)
        if not os.path.exists(path):
            return candidate
        suffix += 1


def parse_iso_datetime(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def enforce_snapshot_retention(config, snapshots_dir):
    retain = config.get('snapshot_retention_count', 200)
    entries = []
    for name in os.listdir(snapshots_dir):
        path = os.path.join(snapshots_dir, name)
        if not os.path.isdir(path):
            continue
        entries.append((os.path.getmtime(path), path))
    entries.sort(key=lambda item: item[0], reverse=True)
    for _, stale_path in entries[retain:]:
        shutil.rmtree(stale_path, ignore_errors=True)


def should_create_auto_snapshot(config, snapshots_dir):
    if not config.get('auto_snapshot_enabled', True):
        return False
    min_interval = config.get('auto_snapshot_interval_seconds', 30)
    if min_interval <= 0:
        return True

    latest_auto = None
    for name in os.listdir(snapshots_dir):
        metadata_file = os.path.join(snapshots_dir, name, 'metadata.json')
        if not os.path.exists(metadata_file):
            continue
        try:
            with open(metadata_file, 'r', encoding='utf-8') as f:
                metadata = json.load(f)
        except (OSError, ValueError):
            continue
        if metadata.get('mode') != 'auto':
            continue
        created_at = parse_iso_datetime(metadata.get('created_at'))
        if created_at and (latest_auto is None or created_at > latest_auto):
            latest_auto = created_at

    if latest_auto is None:
        return True

    return (datetime.now() - latest_auto).total_seconds() >= min_interval


def write_snapshot(snapshot_id, mode='manual', trigger='manual'):
    config = load_storage_config()
    snapshots_dir = snapshot_root(config)
    os.makedirs(snapshots_dir, exist_ok=True)

    snapshot_dir = os.path.join(snapshots_dir, snapshot_id)
    os.makedirs(snapshot_dir, exist_ok=False)

    tasks_file = config['tasks_file']
    topics_dir = config['topics_dir']

    if os.path.exists(tasks_file):
        shutil.copy2(tasks_file, os.path.join(snapshot_dir, 'tasks.md'))
    if os.path.exists(STORAGE_CONFIG_FILE):
        shutil.copy2(STORAGE_CONFIG_FILE, os.path.join(snapshot_dir, 'storage_config.json'))
    if os.path.exists(CATEGORIES_FILE):
        shutil.copy2(CATEGORIES_FILE, os.path.join(snapshot_dir, 'categories.json'))

    topics_snapshot_dir = os.path.join(snapshot_dir, 'topics')
    if os.path.isdir(topics_dir):
        shutil.copytree(topics_dir, topics_snapshot_dir)
    else:
        os.makedirs(topics_snapshot_dir, exist_ok=True)

    metadata = {
        'id': snapshot_id,
        'created_at': datetime.now().isoformat(),
        'mode': mode,
        'trigger': trigger,
        'provider': config['recovery_provider'],
        'recovery_dir': config['recovery_dir'],
        'tasks_file': tasks_file,
        'topics_dir': topics_dir,
        'includes_storage_config': os.path.exists(STORAGE_CONFIG_FILE),
        'includes_categories': os.path.exists(CATEGORIES_FILE),
    }
    with open(os.path.join(snapshot_dir, 'metadata.json'), 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2)

    enforce_snapshot_retention(config, snapshots_dir)
    return metadata


def list_snapshots():
    config = load_storage_config()
    snapshots_dir = snapshot_root(config)
    if not os.path.isdir(snapshots_dir):
        return []

    results = []
    for name in os.listdir(snapshots_dir):
        snap_dir = os.path.join(snapshots_dir, name)
        if not os.path.isdir(snap_dir):
            continue

        metadata_file = os.path.join(snap_dir, 'metadata.json')
        metadata = {
            'id': name,
            'created_at': datetime.fromtimestamp(os.path.getmtime(snap_dir)).isoformat(),
            'mode': 'unknown',
            'provider': config['recovery_provider'],
            'recovery_dir': config['recovery_dir'],
        }
        if os.path.exists(metadata_file):
            try:
                with open(metadata_file, 'r', encoding='utf-8') as f:
                    loaded = json.load(f)
                if isinstance(loaded, dict):
                    metadata.update(loaded)
            except (OSError, ValueError):
                pass
        results.append(metadata)

    results.sort(key=lambda s: s.get('created_at', ''), reverse=True)
    return results


def create_auto_snapshot_if_needed(trigger):
    config = load_storage_config()
    snapshots_dir = snapshot_root(config)
    os.makedirs(snapshots_dir, exist_ok=True)
    if not should_create_auto_snapshot(config, snapshots_dir):
        return None
    snapshot_id = next_snapshot_id(snapshots_dir, prefix='auto')
    return write_snapshot(snapshot_id, mode='auto', trigger=trigger)


def restore_snapshot(snapshot_id, mode):
    if not SNAPSHOT_NAME_PATTERN.match(snapshot_id):
        raise ValueError('Invalid snapshot id')

    if mode not in {'revert', 'full'}:
        raise ValueError('Invalid restore mode')

    config = load_storage_config()
    snapshots_dir = snapshot_root(config)
    snapshot_dir = os.path.join(snapshots_dir, snapshot_id)
    if not os.path.isdir(snapshot_dir):
        raise FileNotFoundError('Snapshot not found')

    os.makedirs(snapshots_dir, exist_ok=True)
    backup_id = next_snapshot_id(snapshots_dir, prefix='pre_restore')
    write_snapshot(backup_id, mode='pre-restore', trigger='before-restore')

    # Support both current ('tasks.md'/'topics') and legacy ('runnning.md'/'open') snapshot layouts.
    source_tasks = os.path.join(snapshot_dir, 'tasks.md')
    if not os.path.exists(source_tasks):
        source_tasks = os.path.join(snapshot_dir, 'runnning.md')
    source_topics = os.path.join(snapshot_dir, 'topics')
    if not os.path.isdir(source_topics):
        source_topics = os.path.join(snapshot_dir, 'open')
    source_storage_config = os.path.join(snapshot_dir, 'storage_config.json')
    source_categories = os.path.join(snapshot_dir, 'categories.json')

    if os.path.exists(source_tasks):
        os.makedirs(os.path.dirname(config['tasks_file']), exist_ok=True)
        shutil.copy2(source_tasks, config['tasks_file'])

    if mode == 'full':
        if os.path.isdir(config['topics_dir']):
            shutil.rmtree(config['topics_dir'])
        os.makedirs(os.path.dirname(config['topics_dir']), exist_ok=True)
        if os.path.isdir(source_topics):
            shutil.copytree(source_topics, config['topics_dir'])
        else:
            os.makedirs(config['topics_dir'], exist_ok=True)
        if os.path.exists(source_storage_config):
            shutil.copy2(source_storage_config, STORAGE_CONFIG_FILE)
        if os.path.exists(source_categories):
            shutil.copy2(source_categories, CATEGORIES_FILE)


# ---------------------------------------------------------------------------
# MCP tools (FastMCP)
# ---------------------------------------------------------------------------

def _compute_is_due(task, today: str) -> bool:
    """Return True if the task has a due_date on or before today and is not closed/deleted."""
    due = task.get('due_date')
    if not due:
        return False
    status = (task.get('status') or '').lower()
    return due <= today and status not in ('closed', 'deleted')


@mcp.tool()
def list_tasks(
    status: str | None = None,
    category: str | None = None,
    overdue: bool = False,
    priority: str | None = None,
    limit: int = 200,
) -> dict:
    """List tasks with optional filters.

    Args:
        status: Filter by status: created, active, closed, deleted.
        category: Filter by category name (exact match).
        overdue: If true, only return tasks with due_date on or before today that are not closed/deleted.
        priority: Filter by priority: urgent, normal, low.
        limit: Max tasks to return (1-500, default 200).

    Each returned task includes an `is_due` boolean computed from its due_date vs today.
    """
    tasks = parse_tasks()
    limit = max(1, min(500, limit))
    today = datetime.now().strftime('%Y-%m-%d')

    if status:
        tasks = [t for t in tasks if (t.get('status') or '').lower() == status.strip().lower()]
    if category:
        wanted = normalize_category_name(category).lower()
        tasks = [
            t for t in tasks
            if any(normalize_category_name(cat).lower() == wanted for cat in (t.get('categories') or []))
        ]
    if overdue:
        tasks = [t for t in tasks if _compute_is_due(t, today)]
    if priority and priority.lower() in {'urgent', 'normal', 'low'}:
        tasks = [t for t in tasks if (t.get('priority') or 'normal').lower() == priority.lower()]

    tasks = tasks[:limit]
    for task in tasks:
        task['is_due'] = _compute_is_due(task, today)
    return {'tasks': tasks, 'count': len(tasks)}


@mcp.tool()
def list_categories() -> dict:
    """List all available task categories."""
    categories = load_categories()
    return {'categories': categories, 'count': len(categories)}


@mcp.tool()
def create_task(
    description: str,
    status: str = 'created',
    priority: str = 'normal',
    due_date: str | None = None,
    category: str | None = None,
) -> dict:
    """Create a new task.

    Args:
        description: Task description text.
        status: Initial status: created, active, closed, deleted. Default: created.
        priority: Priority: urgent, normal, low. Default: normal.
        due_date: Optional due date in YYYY-MM-DD format.
        category: Optional category name. Must be an existing category (use list_categories to see options).
    """
    description = description.strip()
    if not description:
        raise ValueError('description is required')

    status = status.strip().lower()
    if status not in STATUS_OPTIONS:
        raise ValueError(f'Invalid status: {status}')

    priority = priority.strip().lower()
    if priority not in {'urgent', 'normal', 'low'}:
        raise ValueError(f'Invalid priority: {priority}')

    if due_date:
        due_date = due_date.strip()
        if not is_date(due_date):
            raise ValueError('due_date must use YYYY-MM-DD')

    try:
        create_auto_snapshot_if_needed('task-create')
    except OSError as exc:
        raise RuntimeError(f'Automatic snapshot failed: {exc}') from exc

    categories = load_categories()
    chosen_category = normalize_category_name(category) if category else get_default_category(categories)
    if chosen_category.lower() not in {c.lower() for c in categories}:
        raise ValueError(f'Category "{chosen_category}" does not exist. Use list_categories to see available categories.')

    tasks = parse_tasks()
    new_task = {
        'id': max([t['id'] for t in tasks], default=-1) + 1,
        'status': status,
        'priority': priority,
        'date': datetime.now().strftime('%Y-%m-%d'),
        'due_date': due_date,
        'description': description,
        'categories': normalize_task_categories([chosen_category], categories),
    }
    tasks.append(new_task)
    save_tasks(tasks)
    return {'task': new_task}


@mcp.tool()
def set_task_status(task_id: int, status: str) -> dict:
    """Update status for an existing task.

    Args:
        task_id: Integer task ID.
        status: New status: created, active, closed, deleted.
    """
    status = status.strip().lower()
    if status not in STATUS_OPTIONS:
        raise ValueError(f'Invalid status: {status}')

    tasks = parse_tasks()
    target = next((t for t in tasks if t.get('id') == task_id), None)
    if target is None:
        raise ValueError('task not found')

    try:
        create_auto_snapshot_if_needed('task-update')
    except OSError as exc:
        raise RuntimeError(f'Automatic snapshot failed: {exc}') from exc

    target['status'] = status
    save_tasks(tasks)
    return {'task': target}


@mcp.tool()
def close_task(task_id: int, closing_remarks: str | None = None) -> dict:
    """Close a task (set status to closed).

    Args:
        task_id: Integer task ID.
        closing_remarks: Optional note or summary when closing the task.
    """
    tasks = parse_tasks()
    target = next((t for t in tasks if t.get('id') == task_id), None)
    if target is None:
        raise ValueError('task not found')

    try:
        create_auto_snapshot_if_needed('task-close')
    except OSError as exc:
        raise RuntimeError(f'Automatic snapshot failed: {exc}') from exc

    target['status'] = 'closed'
    if closing_remarks and closing_remarks.strip():
        target['closing_remarks'] = closing_remarks.strip()
    save_tasks(tasks)
    return {'task': target}


@mcp.tool()
def create_note(
    name: str,
    content: str = '',
    filepath: str | None = None,
) -> dict:
    """Create a new note file in the configured notes folder.

    Args:
        name: Note name (used for filename if filepath not set).
        content: Initial note content.
        filepath: Optional path relative to or absolute inside the notes folder.
    """
    name = name.strip()
    if not name:
        raise ValueError('name is required')
    try:
        create_auto_snapshot_if_needed('topic-create')
    except OSError as exc:
        raise RuntimeError(f'Automatic snapshot failed: {exc}') from exc
    topic = _create_note_internal(name=name, content=content.strip(), filepath=filepath or None)
    return {'note': topic}


def _list_notes_internal():
    """List all notes from the configured topics directory (no Flask dependency)."""
    config = load_storage_config()
    topics_dir = config['topics_dir']
    topics = []
    if os.path.exists(topics_dir):
        for filename in os.listdir(topics_dir):
            if filename.endswith('.md') and not filename.startswith('.'):
                filepath = os.path.join(topics_dir, filename)
                date_match = re.match(r'(\d{4}_\d{1,2}_\d{1,2})_(.+)\.md', filename)
                if date_match:
                    date_str, name = date_match.groups()
                    topic_date = date_str.replace('_', '-')
                else:
                    stat = os.stat(filepath)
                    topic_date = datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d')
                    name = os.path.splitext(filename)[0]
                topics.append({
                    'filename': filename,
                    'name': name,
                    'date': topic_date,
                    'path': filepath,
                })
    topics.sort(key=lambda x: x['date'], reverse=True)
    return topics


@mcp.tool()
def search_notes(
    query: str,
    limit: int = 50,
) -> dict:
    """Search notes by filename/name or content.

    Args:
        query: Search string (case-insensitive). Matches note filenames and file contents.
        limit: Max notes to return (1-100, default 50).

    Returns matching notes with filename, name, date, and optionally a content snippet where the query was found.
    """
    query = query.strip()
    if not query:
        return {'notes': [], 'count': 0}

    limit = max(1, min(100, limit))
    config = load_storage_config()
    topics_dir = config['topics_dir']
    query_lower = query.lower()
    results = []

    if not os.path.exists(topics_dir):
        return {'notes': [], 'count': 0}

    for filename in os.listdir(topics_dir):
        if not filename.endswith('.md') or filename.startswith('.'):
            continue
        filepath = os.path.join(topics_dir, filename)
        if not os.path.isfile(filepath):
            continue

        date_match = re.match(r'(\d{4}_\d{1,2}_\d{1,2})_(.+)\.md', filename)
        if date_match:
            date_str, name = date_match.groups()
            topic_date = date_str.replace('_', '-')
        else:
            stat = os.stat(filepath)
            topic_date = datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d')
            name = os.path.splitext(filename)[0]

        match_in_name = query_lower in name.lower() or query_lower in filename.lower()
        snippet = None

        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
        except OSError:
            content = ''

        match_in_content = query_lower in content.lower()
        if match_in_content:
            lines = content.splitlines()
            for i, line in enumerate(lines):
                if query_lower in line.lower():
                    snippet = line.strip()[:200]
                    if len(line.strip()) > 200:
                        snippet += '...'
                    break

        if match_in_name or match_in_content:
            results.append({
                'filename': filename,
                'name': name,
                'date': topic_date,
                'snippet': snippet,
            })

    results = results[:limit]
    return {'notes': results, 'count': len(results)}


@mcp.tool()
def get_note(filename: str) -> dict:
    """Get the full content of a note by filename.

    Args:
        filename: The note filename (e.g. 2026_2_22_AI_levels.md). Use search_notes to find filenames.
    """
    filename = filename.strip()
    if not filename:
        raise ValueError('filename is required')
    if not filename.endswith('.md'):
        filename = f'{filename}.md'

    config = load_storage_config()
    try:
        filepath = resolve_topic_path(filename, config['topics_dir'])
    except ValueError as exc:
        raise ValueError(f'Invalid note path: {exc}') from exc

    if not os.path.exists(filepath):
        raise FileNotFoundError('Note not found')

    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    date_match = re.match(r'(\d{4}_\d{1,2}_\d{1,2})_(.+)\.md', filename)
    if date_match:
        date_str, name = date_match.groups()
        topic_date = date_str.replace('_', '-')
    else:
        stat = os.stat(filepath)
        topic_date = datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d')
        name = os.path.splitext(filename)[0]

    return {
        'filename': filename,
        'name': name,
        'date': topic_date,
        'content': content,
    }


# ---------------------------------------------------------------------------
# Flask web UI routes
# ---------------------------------------------------------------------------

def current_web_url():
    return request.host_url.rstrip('/')


def resolve_topic_path(filename, topics_dir):
    base = os.path.abspath(topics_dir)
    candidate = os.path.abspath(os.path.join(base, filename))
    try:
        in_base = os.path.commonpath([base, candidate]) == base
    except ValueError:
        in_base = False
    if not in_base:
        raise ValueError('Invalid note path')
    return candidate


@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/api/storage', methods=['GET'])
def get_storage():
    return jsonify(load_storage_config())


@app.route('/api/fs/list', methods=['GET'])
def fs_list():
    path_value = request.args.get('path', '')
    mode = request.args.get('mode', 'dir')
    try:
        return jsonify(list_fs_entries(path_value, mode))
    except FileNotFoundError as exc:
        return jsonify({'error': str(exc)}), 404
    except NotADirectoryError as exc:
        return jsonify({'error': str(exc)}), 400
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403


@app.route('/api/fs/native-picker', methods=['POST'])
def fs_native_picker():
    data = request.json or {}
    mode = data.get('mode', 'dir')
    initial_path = data.get('initial_path', '')
    try:
        return jsonify(native_pick_path(mode, initial_path))
    except RuntimeError as exc:
        return jsonify({'error': str(exc)}), 501
    except Exception as exc:
        return jsonify({'error': f'Native picker failed: {exc}'}), 500


@app.route('/api/storage', methods=['PUT'])
def update_storage():
    data = request.json or {}
    existing = load_storage_config()
    merged = {
        'tasks_file': data.get('tasks_file', existing['tasks_file']),
        'topics_dir': data.get('topics_dir', existing['topics_dir']),
        'recovery_provider': data.get('recovery_provider', existing['recovery_provider']),
        'recovery_dir': data.get('recovery_dir', existing['recovery_dir']),
        'auto_snapshot_enabled': data.get('auto_snapshot_enabled', existing['auto_snapshot_enabled']),
        'auto_snapshot_interval_seconds': data.get(
            'auto_snapshot_interval_seconds',
            existing['auto_snapshot_interval_seconds']
        ),
        'snapshot_retention_count': data.get(
            'snapshot_retention_count',
            existing['snapshot_retention_count']
        ),
    }
    config = normalized_storage_config(merged)

    if not config['tasks_file'] or not config['topics_dir'] or not config['recovery_dir']:
        return jsonify({'error': 'tasks_file, topics_dir, and recovery_dir are required'}), 400

    try:
        ensure_storage_targets(config)
        save_storage_config(config)
    except OSError as exc:
        return jsonify({'error': f'Failed to initialize storage locations: {exc}'}), 500
    return jsonify(config)


@app.route('/api/snapshots', methods=['GET'])
def get_snapshots():
    return jsonify(list_snapshots())


@app.route('/api/snapshots', methods=['POST'])
def create_snapshot():
    config = load_storage_config()
    snapshots_dir = snapshot_root(config)
    os.makedirs(snapshots_dir, exist_ok=True)

    snapshot_id = next_snapshot_id(snapshots_dir, prefix='snapshot')
    metadata = write_snapshot(snapshot_id, mode='manual', trigger='manual')
    return jsonify(metadata), 201


@app.route('/api/snapshots/<snapshot_id>/restore', methods=['POST'])
def restore_snapshot_api(snapshot_id):
    data = request.json or {}
    mode = data.get('mode', 'revert')

    try:
        restore_snapshot(snapshot_id, mode)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except FileNotFoundError as exc:
        return jsonify({'error': str(exc)}), 404
    except OSError as exc:
        return jsonify({'error': f'Restore failed: {exc}'}), 500

    return jsonify({'success': True, 'id': snapshot_id, 'mode': mode})


@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    tasks = parse_tasks()
    sync_categories_from_tasks(tasks)
    return jsonify(tasks)


@app.route('/api/categories', methods=['GET'])
def get_categories():
    tasks = parse_tasks()
    categories = sync_categories_from_tasks(tasks)
    return jsonify(categories)


@app.route('/api/mcp-config', methods=['GET'])
def get_mcp_config():
    return jsonify(mcp_server_config(current_web_url()))


@app.route('/api/categories', methods=['POST'])
def create_category():
    data = request.json or {}
    name = normalize_category_name(data.get('name'))
    if not name:
        return jsonify({'error': 'Category name is required'}), 400

    categories = load_categories()
    lookup = {cat.lower() for cat in categories}
    if name.lower() in lookup:
        return jsonify({'error': 'Category already exists'}), 409
    categories.append(name)
    categories = save_categories(categories)
    return jsonify({'name': name, 'categories': categories}), 201


@app.route('/api/categories/<path:category_name>', methods=['PUT'])
def rename_category(category_name):
    old_name = normalize_category_name(category_name)
    new_name = normalize_category_name((request.json or {}).get('name'))
    if not old_name or not new_name:
        return jsonify({'error': 'Both old and new category names are required'}), 400
    if old_name.lower() == DEFAULT_CATEGORY:
        return jsonify({'error': 'Default category cannot be edited'}), 400
    if new_name.lower() == DEFAULT_CATEGORY:
        return jsonify({'error': 'Default category cannot be used as rename target'}), 400

    categories = load_categories()
    category_lookup = {cat.lower(): cat for cat in categories}
    if old_name.lower() not in category_lookup:
        return jsonify({'error': 'Category not found'}), 404
    if new_name.lower() in category_lookup and new_name.lower() != old_name.lower():
        return jsonify({'error': 'Category already exists'}), 409

    tasks = parse_tasks()
    for task in tasks:
        replaced = []
        for cat in task.get('categories', []):
            if normalize_category_name(cat).lower() == old_name.lower():
                replaced.append(new_name)
            else:
                replaced.append(cat)
        task['categories'] = normalize_task_categories(replaced)

    categories = [new_name if cat.lower() == old_name.lower() else cat for cat in categories]
    categories = save_categories(categories)
    save_tasks(tasks)
    return jsonify({'categories': categories})


@app.route('/api/categories/<path:category_name>', methods=['DELETE'])
def delete_category(category_name):
    target = normalize_category_name(category_name)
    if not target:
        return jsonify({'error': 'Category name is required'}), 400
    if target.lower() == DEFAULT_CATEGORY:
        return jsonify({'error': 'Default category cannot be deleted'}), 400

    categories = load_categories()
    if target.lower() not in {cat.lower() for cat in categories}:
        return jsonify({'error': 'Category not found'}), 404

    tasks = parse_tasks()
    for task in tasks:
        remaining = [cat for cat in task.get('categories', []) if normalize_category_name(cat).lower() != target.lower()]
        task['categories'] = normalize_task_categories(remaining)

    categories = [cat for cat in categories if cat.lower() != target.lower()]
    categories = save_categories(categories)
    save_tasks(tasks)
    return jsonify({'categories': categories})


@app.route('/api/tasks', methods=['POST'])
def create_task_api():
    data = request.json or {}
    tasks = parse_tasks()
    try:
        create_auto_snapshot_if_needed('task-create')
    except OSError as exc:
        return jsonify({'error': f'Automatic snapshot failed: {exc}'}), 500

    categories = load_categories()
    new_task = {
        'id': max([t['id'] for t in tasks], default=-1) + 1,
        'status': data.get('status', 'created'),
        'priority': data.get('priority', 'normal'),
        'date': datetime.now().strftime('%Y-%m-%d'),
        'due_date': data.get('due_date'),
        'description': data.get('description', ''),
        'categories': normalize_task_categories(data.get('categories', []), categories)
    }

    tasks.append(new_task)
    save_tasks(tasks)

    return jsonify(new_task), 201


@app.route('/api/tasks/<int:task_id>', methods=['PUT'])
def update_task(task_id):
    data = request.json or {}
    tasks = parse_tasks()
    categories = load_categories()

    for task in tasks:
        if task['id'] == task_id:
            try:
                create_auto_snapshot_if_needed('task-update')
            except OSError as exc:
                return jsonify({'error': f'Automatic snapshot failed: {exc}'}), 500
            task['status'] = data.get('status', task['status'])
            task['priority'] = data.get('priority', task['priority'])
            task['description'] = data.get('description', task['description'])
            if 'due_date' in data:
                task['due_date'] = data.get('due_date')
            if 'categories' in data:
                task['categories'] = normalize_task_categories(data.get('categories', []), categories)
            if 'closing_remarks' in data:
                val = (data.get('closing_remarks') or '').strip()
                task['closing_remarks'] = val if val else None
            save_tasks(tasks)
            return jsonify(task)

    return jsonify({'error': 'Task not found'}), 404


@app.route('/api/tasks/<int:task_id>', methods=['DELETE'])
def delete_task(task_id):
    tasks = parse_tasks()
    target_task = next((t for t in tasks if t['id'] == task_id), None)
    if target_task is None:
        return jsonify({'error': 'Task not found'}), 404
    try:
        create_auto_snapshot_if_needed('task-delete')
    except OSError as exc:
        return jsonify({'error': f'Automatic snapshot failed: {exc}'}), 500
    target_task['status'] = 'deleted'
    save_tasks(tasks)
    return jsonify(target_task)


@app.route('/api/topics', methods=['GET'])
def get_topics():
    topics = _list_notes_internal()
    return jsonify(topics)


@app.route('/api/topics', methods=['POST'])
def create_topic():
    data = request.json or {}
    try:
        create_auto_snapshot_if_needed('topic-create')
    except OSError as exc:
        return jsonify({'error': f'Automatic snapshot failed: {exc}'}), 500
    name = data.get('name', 'untitled')
    content = data.get('content', '')
    requested_filepath = data.get('filepath')
    if requested_filepath:
        requested_filepath = normalize_path(requested_filepath)
    try:
        topic = _create_note_internal(name=name, content=content, filepath=requested_filepath)
    except ValueError as exc:
        msg = str(exc)
        if 'inside the configured notes folder' in msg:
            return jsonify({'error': msg}), 400
        if 'already exists' in msg:
            return jsonify({'error': msg}), 409
        return jsonify({'error': msg}), 400
    return jsonify(topic), 201


@app.route('/api/topics/<path:filename>', methods=['GET', 'PUT'])
def get_topic_content(filename):
    config = load_storage_config()
    try:
        filepath = resolve_topic_path(filename, config['topics_dir'])
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    if not os.path.exists(filepath):
        return jsonify({'error': 'Note not found'}), 404

    if request.method == 'PUT':
        data = request.json or {}
        content = data.get('content', '')
        try:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
        except OSError as exc:
            return jsonify({'error': f'Failed to save note: {exc}'}), 500
        return jsonify({'success': True, 'filename': filename})

    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    return jsonify({'filename': filename, 'content': content})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    web_url = 'http://localhost:5050'
    config = load_storage_config()

    print(f"Task Manager web UI:  {web_url}")
    print(f"MCP server:           http://localhost:{MCP_PORT}/mcp")
    print(f"Tasks file:           {config['tasks_file']}")
    print(f"Notes:                {config['topics_dir']}")
    print(f"Recovery snapshots:   {snapshot_root(config)}")
    write_startup_log(web_url, config)

    # Run FastMCP (streamable-HTTP) in a background daemon thread
    mcp_thread = threading.Thread(
        target=lambda: mcp.run(transport='streamable-http'),
        daemon=True,
        name='mcp-server',
    )
    mcp_thread.start()

    app.run(host='127.0.0.1', port=5050, debug=False, use_reloader=False)
