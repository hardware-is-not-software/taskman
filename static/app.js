/**
 * Task Manager - Frontend Application
 */

// State
let tasks = [];
let topics = [];

// DOM Elements
const taskList = document.getElementById('task-list');
const topicList = document.getElementById('topic-list');
const filterStatus = document.getElementById('filter-status');
const sortBy = document.getElementById('sort-by');

// Modals
const modalTask = document.getElementById('modal-task');
const modalTopic = document.getElementById('modal-topic');
const formTask = document.getElementById('form-task');
const formTopic = document.getElementById('form-topic');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadTasks();
    loadTopics();
    setupEventListeners();
    updateTopicDatePrefix();
    initDarkMode();
});

// Dark mode
function initDarkMode() {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (saved === 'dark' || (!saved && prefersDark)) {
        document.documentElement.setAttribute('data-theme', 'dark');
        updateDarkModeIcons(true);
    }
}

function toggleDarkMode() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    
    if (isDark) {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
    } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    }
    
    updateDarkModeIcons(!isDark);
}

function updateDarkModeIcons(isDark) {
    const sunIcon = document.getElementById('icon-sun');
    const moonIcon = document.getElementById('icon-moon');
    
    if (isDark) {
        sunIcon.classList.add('hidden');
        moonIcon.classList.remove('hidden');
    } else {
        sunIcon.classList.remove('hidden');
        moonIcon.classList.add('hidden');
    }
}

// Event Listeners
function setupEventListeners() {
    // Dark mode toggle
    document.getElementById('btn-dark-mode').addEventListener('click', toggleDarkMode);
    
    // New task button
    document.getElementById('btn-new-task').addEventListener('click', () => {
        openTaskModal();
    });
    
    // New topic button
    document.getElementById('btn-new-topic').addEventListener('click', () => {
        updateTopicDatePrefix();
        document.getElementById('topic-name').value = '';
        document.getElementById('topic-content').value = '';
        modalTopic.classList.remove('hidden');
        document.getElementById('topic-name').focus();
    });
    
    // Close modal buttons
    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.dataset.close;
            document.getElementById(modalId).classList.add('hidden');
        });
    });
    
    // Close modal on backdrop click
    [modalTask, modalTopic].forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });
    });
    
    // Task form submit
    formTask.addEventListener('submit', handleTaskSubmit);
    
    // Topic form submit
    formTopic.addEventListener('submit', handleTopicSubmit);
    
    // Filter and sort changes
    filterStatus.addEventListener('change', renderTasks);
    sortBy.addEventListener('change', renderTasks);
    
    // Click outside to close inline edit
    document.addEventListener('click', (e) => {
        const editingItem = document.querySelector('.task-item.editing');
        if (editingItem && !editingItem.contains(e.target)) {
            const id = editingItem.dataset.id;
            cancelInlineEdit(parseInt(id));
        }
    });
    
    // Auto-resize textarea
    document.getElementById('task-description').addEventListener('input', autoResize);
    document.getElementById('topic-content').addEventListener('input', autoResize);
}

// Auto-resize textarea
function autoResize(e) {
    e.target.style.height = 'auto';
    e.target.style.height = e.target.scrollHeight + 'px';
}

// Update topic date prefix
function updateTopicDatePrefix() {
    const now = new Date();
    document.getElementById('topic-date-prefix').textContent = 
        `${now.getFullYear()}_${now.getMonth() + 1}_${now.getDate()}_`;
}

// API: Load tasks
async function loadTasks() {
    try {
        const response = await fetch('/api/tasks');
        tasks = await response.json();
        renderTasks();
    } catch (error) {
        console.error('Failed to load tasks:', error);
        taskList.innerHTML = '<div class="empty-state">Failed to load tasks</div>';
    }
}

// API: Load topics
async function loadTopics() {
    try {
        const response = await fetch('/api/topics');
        topics = await response.json();
        renderTopics();
    } catch (error) {
        console.error('Failed to load topics:', error);
    }
}

// Render tasks
function renderTasks() {
    const status = filterStatus.value;
    const sort = sortBy.value;
    
    // Filter
    let filtered = tasks;
    if (status !== 'all') {
        filtered = tasks.filter(t => t.status === status);
    }
    
    // Sort
    filtered = [...filtered].sort((a, b) => {
        if (sort === 'date-desc') {
            return b.date.localeCompare(a.date);
        } else if (sort === 'date-asc') {
            return a.date.localeCompare(b.date);
        } else if (sort === 'priority') {
            const priorityOrder = { urgent: 0, normal: 1, low: 2 };
            return priorityOrder[a.priority] - priorityOrder[b.priority];
        }
        return 0;
    });
    
    if (filtered.length === 0) {
        taskList.innerHTML = '<div class="empty-state">No tasks found</div>';
        return;
    }
    
    taskList.innerHTML = filtered.map(task => `
        <div class="task-item" data-id="${task.id}" data-status="${task.status}" data-priority="${task.priority}">
            <div class="task-content">
                <div class="task-meta">
                    <span class="status-badge ${task.status}">${task.status}</span>
                    <span class="priority-badge ${task.priority}">${task.priority}</span>
                    <span class="task-date">${formatDate(task.date)}</span>
                </div>
                <div class="task-description ${task.status === 'closed' ? 'closed' : ''}" onclick="startInlineEdit(${task.id})" title="${escapeHtml(task.description).replace(/"/g, '&quot;')}">${escapeHtml(task.description)}</div>
                <div class="inline-edit">
                    <textarea id="edit-desc-${task.id}">${escapeHtml(task.description)}</textarea>
                    <div class="inline-edit-row">
                        <select id="edit-status-${task.id}">
                            <option value="created" ${task.status === 'created' ? 'selected' : ''}>Created</option>
                            <option value="active" ${task.status === 'active' ? 'selected' : ''}>Active</option>
                            <option value="closed" ${task.status === 'closed' ? 'selected' : ''}>Closed</option>
                        </select>
                        <select id="edit-priority-${task.id}">
                            <option value="urgent" ${task.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
                            <option value="normal" ${task.priority === 'normal' ? 'selected' : ''}>Normal</option>
                            <option value="low" ${task.priority === 'low' ? 'selected' : ''}>Low</option>
                        </select>
                        <div class="inline-edit-actions">
                            <button class="btn btn-secondary" onclick="cancelInlineEdit(${task.id})">Cancel</button>
                            <button class="btn btn-primary" onclick="saveInlineEdit(${task.id})">Save</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="task-actions">
                ${task.status !== 'active' ? `
                    <button onclick="setTaskStatus(${task.id}, 'active')" title="Set Active">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <polygon points="10 8 16 12 10 16 10 8"/>
                        </svg>
                    </button>
                ` : ''}
                ${task.status !== 'closed' ? `
                    <button onclick="setTaskStatus(${task.id}, 'closed')" title="Close">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                    </button>
                ` : ''}
                <button onclick="createTopicFromTask(${task.id})" title="Create Open Topic">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="12" y1="18" x2="12" y2="12"/>
                        <line x1="9" y1="15" x2="15" y2="15"/>
                    </svg>
                </button>
                <button onclick="deleteTask(${task.id})" class="delete" title="Delete">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}

// Render topics
function renderTopics() {
    if (topics.length === 0) {
        topicList.innerHTML = '<div class="empty-state">No open topics</div>';
        return;
    }
    
    topicList.innerHTML = topics.map(topic => `
        <div class="topic-item">
            <span class="topic-name">${escapeHtml(topic.name)}</span>
            <span class="topic-date">${topic.date}</span>
        </div>
    `).join('');
}

// Open task modal (for new tasks only now)
function openTaskModal() {
    const title = document.getElementById('modal-task-title');
    const idField = document.getElementById('task-id');
    const descField = document.getElementById('task-description');
    const statusField = document.getElementById('task-status');
    const priorityField = document.getElementById('task-priority');
    
    title.textContent = 'New Task';
    idField.value = '';
    descField.value = '';
    statusField.value = 'created';
    priorityField.value = 'normal';
    
    modalTask.classList.remove('hidden');
    descField.focus();
}

// Inline editing
function startInlineEdit(id) {
    // Close any other open edits first
    document.querySelectorAll('.task-item.editing').forEach(el => {
        el.classList.remove('editing');
    });
    
    const taskEl = document.querySelector(`.task-item[data-id="${id}"]`);
    if (taskEl) {
        taskEl.classList.add('editing');
        const textarea = document.getElementById(`edit-desc-${id}`);
        if (textarea) {
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            // Auto-resize
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
            
            // Keyboard shortcuts
            textarea.onkeydown = (e) => {
                if (e.key === 'Escape') {
                    cancelInlineEdit(id);
                } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    saveInlineEdit(id);
                }
            };
        }
    }
}

function cancelInlineEdit(id) {
    const taskEl = document.querySelector(`.task-item[data-id="${id}"]`);
    if (taskEl) {
        taskEl.classList.remove('editing');
        // Reset values
        const task = tasks.find(t => t.id === id);
        if (task) {
            document.getElementById(`edit-desc-${id}`).value = task.description;
            document.getElementById(`edit-status-${id}`).value = task.status;
            document.getElementById(`edit-priority-${id}`).value = task.priority;
        }
    }
}

async function saveInlineEdit(id) {
    const description = document.getElementById(`edit-desc-${id}`).value;
    const status = document.getElementById(`edit-status-${id}`).value;
    const priority = document.getElementById(`edit-priority-${id}`).value;
    
    try {
        const response = await fetch(`/api/tasks/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description, status, priority })
        });
        
        if (response.ok) {
            await loadTasks();
        } else {
            const error = await response.json();
            alert(error.error || 'Failed to save task');
        }
    } catch (error) {
        console.error('Failed to save task:', error);
        alert('Failed to save task');
    }
}

// Set task status
async function setTaskStatus(id, status) {
    try {
        const response = await fetch(`/api/tasks/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        
        if (response.ok) {
            await loadTasks();
        }
    } catch (error) {
        console.error('Failed to update task:', error);
        alert('Failed to update task');
    }
}

// Delete task
async function deleteTask(id) {
    if (!confirm('Delete this task?')) return;
    
    try {
        const response = await fetch(`/api/tasks/${id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            await loadTasks();
        }
    } catch (error) {
        console.error('Failed to delete task:', error);
        alert('Failed to delete task');
    }
}

// Handle task form submit
async function handleTaskSubmit(e) {
    e.preventDefault();
    
    const id = document.getElementById('task-id').value;
    const data = {
        description: document.getElementById('task-description').value,
        status: document.getElementById('task-status').value,
        priority: document.getElementById('task-priority').value
    };
    
    try {
        let response;
        if (id) {
            // Update existing
            response = await fetch(`/api/tasks/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        } else {
            // Create new
            response = await fetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        }
        
        if (response.ok) {
            modalTask.classList.add('hidden');
            formTask.reset();
            await loadTasks();
        } else {
            const error = await response.json();
            alert(error.error || 'Failed to save task');
        }
    } catch (error) {
        console.error('Failed to save task:', error);
        alert('Failed to save task');
    }
}

// Create topic from task
function createTopicFromTask(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    updateTopicDatePrefix();
    
    // Generate a suggested filename from the task description
    // Take first few words, remove special chars, use underscores
    const words = task.description.split(/\s+/).slice(0, 4);
    const suggestedName = words.join('_').replace(/[^\w\-]/g, '').substring(0, 30);
    
    document.getElementById('topic-name').value = suggestedName;
    document.getElementById('topic-content').value = task.description;
    
    modalTopic.classList.remove('hidden');
    document.getElementById('topic-name').focus();
    document.getElementById('topic-name').select();
}

// Handle topic form submit
async function handleTopicSubmit(e) {
    e.preventDefault();
    
    const name = document.getElementById('topic-name').value;
    const content = document.getElementById('topic-content').value;
    
    try {
        const response = await fetch('/api/topics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, content })
        });
        
        if (response.ok) {
            modalTopic.classList.add('hidden');
            formTopic.reset();
            await loadTopics();
        } else {
            const error = await response.json();
            alert(error.error || 'Failed to create topic');
        }
    } catch (error) {
        console.error('Failed to create topic:', error);
        alert('Failed to create topic');
    }
}

// Utility: Format date
function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
    });
}

// Utility: Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Register service worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => {
        console.log('SW registration failed:', err);
    });
}
