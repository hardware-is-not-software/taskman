#!/usr/bin/env python3
"""
Task Manager - Flask API Server
Manages tasks in tasks/running.md and open topic files in open/
"""

from flask import Flask, jsonify, request, send_from_directory
from datetime import datetime
import os
import re

app = Flask(__name__, static_folder='static', static_url_path='')

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TASKS_FILE = os.path.join(BASE_DIR, 'tasks', 'runnning.md')
OPEN_DIR = os.path.join(BASE_DIR, 'open')

# Task format regex: (status|priority|date) description
TASK_PATTERN = re.compile(r'^\((\w+)\|(\w+)\|(\d{4}-\d{2}-\d{2})\)\s+(.+)$')
# Legacy format: (status)   description
LEGACY_PATTERN = re.compile(r'^\((\w+)\)\s+(.+)$')


def parse_tasks():
    """Parse tasks from running.md file."""
    tasks = []
    if not os.path.exists(TASKS_FILE):
        return tasks
    
    with open(TASKS_FILE, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    current_task = None
    task_id = 0
    
    for line in lines:
        line = line.rstrip('\n')
        
        # Skip empty lines between tasks
        if not line.strip() and current_task is None:
            continue
        
        # Try new format first
        match = TASK_PATTERN.match(line)
        if match:
            if current_task:
                tasks.append(current_task)
            status, priority, date, description = match.groups()
            current_task = {
                'id': task_id,
                'status': status,
                'priority': priority,
                'date': date,
                'description': description
            }
            task_id += 1
            continue
        
        # Try legacy format
        legacy_match = LEGACY_PATTERN.match(line)
        if legacy_match:
            if current_task:
                tasks.append(current_task)
            status, description = legacy_match.groups()
            current_task = {
                'id': task_id,
                'status': status,
                'priority': 'normal',
                'date': datetime.now().strftime('%Y-%m-%d'),
                'description': description.strip()
            }
            task_id += 1
            continue
        
        # Continuation line (indented)
        if line.startswith('    ') and current_task:
            current_task['description'] += '\n' + line[4:]
            continue
    
    if current_task:
        tasks.append(current_task)
    
    return tasks


def save_tasks(tasks):
    """Save tasks to running.md file."""
    os.makedirs(os.path.dirname(TASKS_FILE), exist_ok=True)
    
    with open(TASKS_FILE, 'w', encoding='utf-8') as f:
        for task in tasks:
            # Write main task line
            f.write(f"({task['status']}|{task['priority']}|{task['date']}) {task['description'].split(chr(10))[0]}\n")
            # Write continuation lines if multi-line description
            desc_lines = task['description'].split('\n')
            for extra_line in desc_lines[1:]:
                f.write(f"    {extra_line}\n")


# Serve index.html at root
@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')


# API: Get all tasks
@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    tasks = parse_tasks()
    return jsonify(tasks)


# API: Create new task
@app.route('/api/tasks', methods=['POST'])
def create_task():
    data = request.json
    tasks = parse_tasks()
    
    new_task = {
        'id': max([t['id'] for t in tasks], default=-1) + 1,
        'status': data.get('status', 'created'),
        'priority': data.get('priority', 'normal'),
        'date': datetime.now().strftime('%Y-%m-%d'),
        'description': data.get('description', '')
    }
    
    tasks.append(new_task)
    save_tasks(tasks)
    
    return jsonify(new_task), 201


# API: Update task
@app.route('/api/tasks/<int:task_id>', methods=['PUT'])
def update_task(task_id):
    data = request.json
    tasks = parse_tasks()
    
    for task in tasks:
        if task['id'] == task_id:
            task['status'] = data.get('status', task['status'])
            task['priority'] = data.get('priority', task['priority'])
            task['description'] = data.get('description', task['description'])
            save_tasks(tasks)
            return jsonify(task)
    
    return jsonify({'error': 'Task not found'}), 404


# API: Delete task
@app.route('/api/tasks/<int:task_id>', methods=['DELETE'])
def delete_task(task_id):
    tasks = parse_tasks()
    tasks = [t for t in tasks if t['id'] != task_id]
    save_tasks(tasks)
    return jsonify({'success': True})


# API: Get open topics
@app.route('/api/topics', methods=['GET'])
def get_topics():
    topics = []
    if os.path.exists(OPEN_DIR):
        for filename in os.listdir(OPEN_DIR):
            if filename.endswith('.md') and not filename.startswith('.'):
                filepath = os.path.join(OPEN_DIR, filename)
                # Extract date from filename (format: YYYY_M_D_name.md)
                date_match = re.match(r'(\d{4}_\d{1,2}_\d{1,2})_(.+)\.md', filename)
                if date_match:
                    date_str, name = date_match.groups()
                    topics.append({
                        'filename': filename,
                        'name': name,
                        'date': date_str.replace('_', '-'),
                        'path': filepath
                    })
    
    # Sort by date descending
    topics.sort(key=lambda x: x['date'], reverse=True)
    return jsonify(topics)


# API: Create open topic
@app.route('/api/topics', methods=['POST'])
def create_topic():
    data = request.json
    name = data.get('name', 'untitled')
    content = data.get('content', '')
    
    # Sanitize filename
    safe_name = re.sub(r'[^\w\-]', '_', name)
    
    # Generate filename with date
    today = datetime.now()
    filename = f"{today.year}_{today.month}_{today.day}_{safe_name}.md"
    filepath = os.path.join(OPEN_DIR, filename)
    
    # Check if file already exists
    if os.path.exists(filepath):
        return jsonify({'error': 'Topic with this name already exists'}), 409
    
    # Create the file
    os.makedirs(OPEN_DIR, exist_ok=True)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    
    return jsonify({
        'filename': filename,
        'name': safe_name,
        'date': today.strftime('%Y-%m-%d'),
        'path': filepath
    }), 201


# API: Get topic content
@app.route('/api/topics/<path:filename>', methods=['GET'])
def get_topic_content(filename):
    filepath = os.path.join(OPEN_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({'error': 'Topic not found'}), 404
    
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    return jsonify({'filename': filename, 'content': content})


if __name__ == '__main__':
    print(f"Task Manager running at http://localhost:5050")
    print(f"Tasks file: {TASKS_FILE}")
    print(f"Open topics: {OPEN_DIR}")
    app.run(host='0.0.0.0', port=5050, debug=True)
