/**
 * Task Manager - Frontend Application
 */

// State
let tasks = [];
let topics = [];
let storageConfig = null;
let snapshots = [];
let categories = [];
let selectedStatuses = new Set(['created', 'active']);
let selectedCategories = new Set();
const STATUS_OPTIONS = ['created', 'active', 'closed', 'deleted'];
const STATUS_SORT_ORDER = {
    active: 0,
    created: 1,
    closed: 2,
    deleted: 3
};
const RECOVERY_PROVIDER_LABELS = {
    local: 'Local folder',
    onedrive: 'OneDrive',
    sharepoint: 'SharePoint drive',
    icloud: 'iCloud Drive'
};

// DOM Elements
const taskList = document.getElementById('task-list');
const topicList = document.getElementById('topic-list');
const statusFilters = document.getElementById('status-filters');
const categoryFilters = document.getElementById('category-filters');
const sortBy = document.getElementById('sort-by');
const formStorage = document.getElementById('form-storage');
const snapshotList = document.getElementById('snapshot-list');
const storageMessage = document.getElementById('storage-message');
const appShell = document.querySelector('.app-shell');
const storageToggleBtn = document.getElementById('btn-storage-toggle');
const taskCategoriesSelect = document.getElementById('task-categories');
const modalCategories = document.getElementById('modal-categories');
const categoryManageList = document.getElementById('category-manage-list');
const mcpBtn = document.getElementById('btn-mcp');
const modalMcp = document.getElementById('modal-mcp');
const mcpDialogJson = document.getElementById('mcp-dialog-json');
const mcpDialogStatus = document.getElementById('mcp-dialog-status');
const mcpCopyBtn = document.getElementById('btn-mcp-copy');

// Modals
const modalTask = document.getElementById('modal-task');
const modalTopic = document.getElementById('modal-topic');
const modalTopicEdit = document.getElementById('modal-topic-edit');
const formTask = document.getElementById('form-task');
const formTopic = document.getElementById('form-topic');
const formTopicEdit = document.getElementById('form-topic-edit');
const formCategoryAdd = document.getElementById('form-category-add');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setStoragePanelCollapsed(false);
    loadCategories();
    loadStorageConfig();
    loadSnapshots();
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
    if (mcpBtn) {
        mcpBtn.addEventListener('click', openMcpDialog);
    }
    if (mcpCopyBtn) {
        mcpCopyBtn.addEventListener('click', copyMcpDialogConfig);
    }
    
    // New topic button
    document.getElementById('btn-new-topic').addEventListener('click', () => {
        updateTopicDatePrefix();
        document.getElementById('topic-path').value = '';
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
    [modalTask, modalTopic, modalCategories, modalMcp].forEach(modal => {
        if (!modal) return;
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });
    });
    // Edit Note modal: don't close on backdrop click when in edit mode
    if (modalTopicEdit) {
        modalTopicEdit.addEventListener('click', (e) => {
            if (e.target !== modalTopicEdit) return;
            const textarea = document.getElementById('topic-edit-content');
            if (textarea && !textarea.readOnly) return; // edit mode: ignore backdrop click
            modalTopicEdit.classList.add('hidden');
        });
    }
    
    // Task form submit
    formTask.addEventListener('submit', handleTaskSubmit);
    document.getElementById('task-status').addEventListener('change', updateClosingRemarksVisibility);
    
    // Topic form submit
    formTopic.addEventListener('submit', handleTopicSubmit);
    formTopicEdit.addEventListener('submit', handleTopicEditSubmit);
    formCategoryAdd.addEventListener('submit', handleCategoryCreate);
    
    // Filter and sort changes
    sortBy.addEventListener('change', renderTasks);

    // Storage config submit
    formStorage.addEventListener('submit', handleStorageSubmit);

    // Snapshot actions
    document.getElementById('btn-create-snapshot').addEventListener('click', createSnapshot);
    snapshotList.addEventListener('click', handleSnapshotAction);
    storageToggleBtn.addEventListener('click', () => {
        const collapsed = appShell.classList.contains('storage-collapsed');
        setStoragePanelCollapsed(!collapsed);
    });

    document.querySelectorAll('.btn-native-picker').forEach(button => {
        button.addEventListener('click', () => {
            const target = button.dataset.nativeTarget;
            const mode = button.dataset.nativeMode || 'dir';
            openNativePicker(target, mode);
        });
    });
    document.getElementById('btn-manage-categories').addEventListener('click', () => {
        modalCategories.classList.remove('hidden');
        renderCategoryManager();
    });
    categoryManageList.addEventListener('click', handleCategoryManagerAction);
    
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

async function loadCategories() {
    try {
        const response = await fetch('/api/categories');
        if (!response.ok) {
            throw new Error('Failed to load categories');
        }
        categories = await response.json();
        if (!categories.length) {
            categories = ['default'];
        }
        sanitizeSelectedCategories();
        renderCategoryFilters();
        renderTaskCategorySelect();
        renderCategoryManager();
        if (tasks.length > 0) {
            renderTasks();
        }
    } catch (error) {
        console.error('Failed to load categories:', error);
    }
}

async function openNativePicker(targetInputId, mode) {
    const input = document.getElementById(targetInputId);
    if (!input) return;
    let initialPath = (input.value || '').trim();
    if (!initialPath && targetInputId === 'topic-path' && storageConfig?.topics_dir) {
        const noteName = (document.getElementById('topic-name')?.value || 'note').trim() || 'note';
        const safeName = noteName.replace(/[^\w\-]/g, '_');
        const now = new Date();
        const suggested = `${now.getFullYear()}_${now.getMonth() + 1}_${now.getDate()}_${safeName}.md`;
        initialPath = `${storageConfig.topics_dir}/${suggested}`;
    }

    try {
        const response = await fetch('/api/fs/native-picker', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mode,
                initial_path: initialPath
            })
        });
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error || 'Native picker failed');
        }
        if (!payload.cancelled && payload.path) {
            input.value = payload.path;
            setStorageMessage('Location selected from system dialog', 'success');
        }
    } catch (error) {
        console.error('Native picker failed:', error);
        setStorageMessage(error.message || 'Native picker unavailable. Use Browse…', 'error');
    }
}

function setStoragePanelCollapsed(collapsed) {
    appShell.classList.toggle('storage-collapsed', collapsed);
    if (collapsed) {
        storageToggleBtn.textContent = '▶';
        storageToggleBtn.dataset.tooltip = 'Maximize storage panel';
        storageToggleBtn.setAttribute('aria-label', 'Maximize storage panel');
    } else {
        storageToggleBtn.textContent = '◀';
        storageToggleBtn.dataset.tooltip = 'Minimize storage panel';
        storageToggleBtn.setAttribute('aria-label', 'Minimize storage panel');
    }
}

function setStorageMessage(text, type = '') {
    storageMessage.textContent = text || '';
    storageMessage.classList.remove('success', 'error');
    if (type) {
        storageMessage.classList.add(type);
    }
}

async function openMcpDialog() {
    if (!modalMcp || !mcpDialogJson || !mcpDialogStatus || !mcpCopyBtn) return;
    mcpDialogJson.textContent = 'Loading...';
    mcpDialogStatus.textContent = '';
    mcpCopyBtn.disabled = true;
    modalMcp.classList.remove('hidden');
    try {
        const response = await fetch('/api/mcp-config');
        if (!response.ok) {
            throw new Error('Failed to load MCP config');
        }
        const config = await response.json();
        mcpDialogJson.textContent = JSON.stringify(config, null, 2);
        mcpCopyBtn.disabled = false;
    } catch (error) {
        console.error('Failed to load MCP config:', error);
        const fallbackConfig = {
            mcpServers: {
                'taskman-mcp': {
                    url: `${window.location.origin}/mcp`,
                    type: 'http'
                }
            }
        };
        mcpDialogJson.textContent = JSON.stringify(fallbackConfig, null, 2);
        mcpDialogStatus.textContent = 'Using fallback config';
        mcpCopyBtn.disabled = false;
    }
}

async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const success = document.execCommand('copy');
    document.body.removeChild(input);
    if (!success) {
        throw new Error('Legacy copy failed');
    }
}

async function copyMcpDialogConfig() {
    if (!mcpDialogJson || !mcpDialogStatus) return;
    try {
        await copyText(mcpDialogJson.textContent || '{}');
        mcpDialogStatus.textContent = 'Copied to clipboard';
    } catch (error) {
        console.error('Failed to copy MCP config:', error);
        mcpDialogStatus.textContent = 'Copy failed';
    }
}

function applyStorageConfigToForm(config) {
    document.getElementById('storage-tasks-file').value = config.tasks_file || '';
    document.getElementById('storage-topics-dir').value = config.topics_dir || '';
    document.getElementById('storage-provider').value = config.recovery_provider || 'local';
    document.getElementById('storage-recovery-dir').value = config.recovery_dir || '';
    document.getElementById('storage-auto-snapshot').checked = config.auto_snapshot_enabled !== false;
    document.getElementById('storage-auto-interval').value = Number(config.auto_snapshot_interval_seconds ?? 30);
    document.getElementById('storage-retention-count').value = Number(config.snapshot_retention_count ?? 200);
}

async function loadStorageConfig() {
    try {
        const response = await fetch('/api/storage');
        if (!response.ok) {
            throw new Error('Failed to load storage configuration');
        }
        storageConfig = await response.json();
        applyStorageConfigToForm(storageConfig);
        setStorageMessage('');
    } catch (error) {
        console.error('Failed to load storage config:', error);
        setStorageMessage('Failed to load storage settings', 'error');
    }
}

async function handleStorageSubmit(e) {
    e.preventDefault();
    const payload = {
        tasks_file: document.getElementById('storage-tasks-file').value.trim(),
        topics_dir: document.getElementById('storage-topics-dir').value.trim(),
        recovery_provider: document.getElementById('storage-provider').value,
        recovery_dir: document.getElementById('storage-recovery-dir').value.trim(),
        auto_snapshot_enabled: document.getElementById('storage-auto-snapshot').checked,
        auto_snapshot_interval_seconds: parseInt(document.getElementById('storage-auto-interval').value, 10),
        snapshot_retention_count: parseInt(document.getElementById('storage-retention-count').value, 10)
    };

    try {
        const response = await fetch('/api/storage', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save storage settings');
        }
        storageConfig = await response.json();
        applyStorageConfigToForm(storageConfig);
        setStorageMessage('Storage settings saved', 'success');
        await Promise.all([loadTasks(), loadTopics(), loadSnapshots()]);
    } catch (error) {
        console.error('Failed to save storage settings:', error);
        setStorageMessage(error.message || 'Failed to save storage settings', 'error');
    }
}

async function loadSnapshots() {
    try {
        const response = await fetch('/api/snapshots');
        if (!response.ok) {
            throw new Error('Failed to load snapshots');
        }
        snapshots = await response.json();
        renderSnapshots();
    } catch (error) {
        console.error('Failed to load snapshots:', error);
        snapshotList.innerHTML = '<div class="empty-state">Failed to load snapshots</div>';
    }
}

function renderSnapshots() {
    if (!snapshots.length) {
        snapshotList.innerHTML = '<div class="empty-state">No snapshots yet</div>';
        return;
    }

    snapshotList.innerHTML = snapshots.map(snapshot => `
        <div class="snapshot-item">
            <span class="snapshot-id">${escapeHtml(snapshot.id)}</span>
            <div class="snapshot-meta">${formatDateTime(snapshot.created_at)} • ${escapeHtml(snapshot.mode || 'manual')} • ${escapeHtml(RECOVERY_PROVIDER_LABELS[snapshot.provider] || snapshot.provider)}</div>
            <div class="snapshot-actions">
                <button type="button" class="btn btn-secondary btn-small" data-action="revert" data-id="${escapeAttribute(snapshot.id)}">Revert Tasks</button>
                <button type="button" class="btn btn-primary btn-small" data-action="full" data-id="${escapeAttribute(snapshot.id)}">Full Recovery</button>
            </div>
        </div>
    `).join('');
}

async function createSnapshot() {
    setStorageMessage('Creating snapshot...');
    try {
        const response = await fetch('/api/snapshots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create snapshot');
        }
        const snapshot = await response.json();
        setStorageMessage(`Snapshot created: ${snapshot.id}`, 'success');
        await loadSnapshots();
    } catch (error) {
        console.error('Failed to create snapshot:', error);
        setStorageMessage(error.message || 'Failed to create snapshot', 'error');
    }
}

async function handleSnapshotAction(e) {
    const action = e.target.dataset.action;
    const snapshotId = e.target.dataset.id;
    if (!action || !snapshotId) return;

    let mode = '';
    let promptText = '';
    if (action === 'revert') {
        mode = 'revert';
        promptText = 'Revert tasks file to this snapshot?';
    } else if (action === 'full') {
        mode = 'full';
        promptText = 'Run full recovery? This restores both tasks and notes from the snapshot.';
    } else {
        return;
    }

    if (!confirm(promptText)) return;

    setStorageMessage('Restoring snapshot...');
    try {
        const response = await fetch(`/api/snapshots/${encodeURIComponent(snapshotId)}/restore`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode })
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Recovery failed');
        }
        setStorageMessage(`Recovery complete (${mode})`, 'success');
        await Promise.all([loadTasks(), loadTopics(), loadSnapshots()]);
    } catch (error) {
        console.error('Failed to restore snapshot:', error);
        setStorageMessage(error.message || 'Recovery failed', 'error');
    }
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
        tasks = tasks.map(task => ({
            ...task,
            categories: Array.isArray(task.categories) ? task.categories : []
        }));
        updateDueTaskBadge(tasks);
        renderStatusFilters();
        renderCategoryFilters();
        renderTasks();
    } catch (error) {
        console.error('Failed to load tasks:', error);
        taskList.innerHTML = '<div class="empty-state">Failed to load tasks</div>';
    }
}

async function updateDueTaskBadge(taskItems) {
    if (!('setAppBadge' in navigator) || !('clearAppBadge' in navigator)) {
        return;
    }

    const count = getDueTaskCount(taskItems);
    try {
        if (count > 0) {
            await navigator.setAppBadge(count);
        } else {
            await navigator.clearAppBadge();
        }
    } catch (error) {
        // Best effort only; badging support depends on platform/browser install mode.
        console.debug('App badge update failed:', error);
    }
}

function getDueTaskCount(taskItems) {
    const today = startOfToday();
    return (taskItems || []).filter(task => {
        if (!task) return false;
        if (task.status === 'closed' || task.status === 'deleted') return false;
        const due = parseDate(task.due_date);
        return !!due && due <= today;
    }).length;
}

// API: Load topics
async function loadTopics() {
    try {
        const response = await fetch('/api/topics');
        topics = await response.json();
        renderTopics();
    } catch (error) {
        console.error('Failed to load notes:', error);
    }
}

// Render tasks
function renderTasks() {
    const sort = sortBy.value;
    
    // Filter
    let filtered = tasks;
    if (selectedStatuses.size === 0) {
        filtered = [];
    } else {
        filtered = tasks.filter(t => selectedStatuses.has(t.status));
    }
    if (selectedCategories.size > 0) {
        filtered = filtered.filter(task => (task.categories || []).some(cat => selectedCategories.has(cat)));
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
        } else if (sort === 'status') {
            const statusDelta = (STATUS_SORT_ORDER[a.status] ?? 999) - (STATUS_SORT_ORDER[b.status] ?? 999);
            if (statusDelta !== 0) return statusDelta;
            return b.date.localeCompare(a.date);
        } else if (sort === 'due-date') {
            const aHas = !!a.due_date;
            const bHas = !!b.due_date;
            if (aHas && bHas) return a.due_date.localeCompare(b.due_date);
            if (aHas) return -1;
            if (bHas) return 1;
            return b.date.localeCompare(a.date);
        } else if (sort === 'category-status') {
            const aCategory = getTaskPrimaryCategory(a).toLowerCase();
            const bCategory = getTaskPrimaryCategory(b).toLowerCase();
            const categoryDelta = aCategory.localeCompare(bCategory);
            if (categoryDelta !== 0) return categoryDelta;
            const statusDelta = (STATUS_SORT_ORDER[a.status] ?? 999) - (STATUS_SORT_ORDER[b.status] ?? 999);
            if (statusDelta !== 0) return statusDelta;
            return b.date.localeCompare(a.date);
        }
        return 0;
    });
    
    if (filtered.length === 0) {
        taskList.innerHTML = '<div class="empty-state">No tasks found</div>';
        return;
    }
    
    taskList.innerHTML = filtered.map(task => `
        <div class="task-item ${getDueClass(task)}" data-id="${task.id}" data-status="${task.status}" data-priority="${task.priority}">
            <div class="task-content">
                <div class="task-meta">
                    <span class="status-badge ${task.status}">${task.status}</span>
                    <span class="priority-badge ${task.priority}">${task.priority}</span>
                    <span class="task-date">${formatDate(task.date)}</span>
                    ${renderDueBadge(task)}
                    ${renderCategoryBadges(task.categories)}
                </div>
                <div class="task-description ${task.status === 'closed' || task.status === 'deleted' ? 'closed' : ''}" onclick="startInlineEdit(${task.id})" data-tooltip="${escapeHtml(task.description).replace(/"/g, '&quot;')}">${escapeHtml(task.description)}</div>
                ${task.closing_remarks ? `<div class="task-closing-remarks">${escapeHtml(task.closing_remarks)}</div>` : ''}
                <div class="close-task-prompt" id="close-prompt-${task.id}" style="display: none;">
                    <textarea id="close-remarks-${task.id}" rows="2" placeholder="Closing remarks (optional)..."></textarea>
                    <div class="close-prompt-actions">
                        <button type="button" class="btn btn-secondary" onclick="closeTaskSkip(${task.id})">Skip</button>
                        <button type="button" class="btn btn-primary" onclick="closeTaskWithRemarks(${task.id})">Save</button>
                    </div>
                </div>
                <div class="inline-edit">
                    <textarea id="edit-desc-${task.id}">${escapeHtml(task.description)}</textarea>
                    <div class="inline-edit-row">
                        <select id="edit-status-${task.id}">
                            <option value="created" ${task.status === 'created' ? 'selected' : ''}>Created</option>
                            <option value="active" ${task.status === 'active' ? 'selected' : ''}>Active</option>
                            <option value="closed" ${task.status === 'closed' ? 'selected' : ''}>Closed</option>
                            <option value="deleted" ${task.status === 'deleted' ? 'selected' : ''}>Deleted</option>
                        </select>
                        <select id="edit-priority-${task.id}">
                            <option value="urgent" ${task.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
                            <option value="normal" ${task.priority === 'normal' ? 'selected' : ''}>Normal</option>
                            <option value="low" ${task.priority === 'low' ? 'selected' : ''}>Low</option>
                        </select>
                        <input type="date" id="edit-due-date-${task.id}" value="${escapeAttribute(task.due_date || '')}">
                        <select id="edit-categories-${task.id}">
                            ${renderCategoryOptions(getTaskPrimaryCategory(task))}
                        </select>
                        <textarea id="edit-closing-remarks-${task.id}" rows="2" placeholder="Closing remarks (optional)...">${escapeHtml(task.closing_remarks || '')}</textarea>
                        <div class="inline-edit-actions">
                            <button class="btn btn-secondary" onclick="cancelInlineEdit(${task.id})">Cancel</button>
                            <button class="btn btn-primary" onclick="saveInlineEdit(${task.id})">Save</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="task-actions">
                ${task.status !== 'active' && task.status !== 'deleted' ? `
                    <button onclick="setTaskStatus(${task.id}, 'active')" aria-label="Set Active" data-tooltip="Set Active">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <polygon points="10 8 16 12 10 16 10 8"/>
                        </svg>
                    </button>
                ` : ''}
                ${task.status !== 'closed' && task.status !== 'deleted' ? `
                    <button onclick="openCloseTaskPrompt(${task.id})" aria-label="Close" data-tooltip="Close">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                    </button>
                ` : ''}
                ${task.status !== 'deleted' ? `
                <button onclick="deleteTask(${task.id})" class="delete" aria-label="Mark Deleted" data-tooltip="Mark Deleted">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
                ` : ''}
            </div>
        </div>
    `).join('');
}

function renderCategoryOptions(selectedCategory) {
    const fallback = categories.find(c => c.toLowerCase() === 'default') || categories[0] || 'default';
    const selected = selectedCategory || fallback;
    return categories.map(category => `
        <option value="${escapeAttribute(category)}" ${category === selected ? 'selected' : ''}>${escapeHtml(category)}</option>
    `).join('');
}

function getTaskPrimaryCategory(task) {
    const taskCategories = task?.categories || [];
    if (taskCategories.length > 0) {
        const value = taskCategories[0];
        if (categories.includes(value)) return value;
    }
    return categories.find(c => c.toLowerCase() === 'default') || categories[0] || 'default';
}

function renderTaskCategorySelect() {
    if (!taskCategoriesSelect) return;
    taskCategoriesSelect.innerHTML = renderCategoryOptions(getDefaultCategory());
}

// Render topics
function renderTopics() {
    if (topics.length === 0) {
        topicList.innerHTML = '<div class="empty-state">No notes</div>';
        return;
    }
    
    topicList.innerHTML = topics.map(topic => `
        <div class="topic-item">
            <span class="topic-name">${escapeHtml(topic.name)}</span>
            <div class="topic-actions">
                <span class="topic-date">${topic.date}</span>
                <button type="button" class="btn btn-secondary btn-small" onclick="openTopicViewer('${escapeAttribute(topic.filename)}')">View</button>
                <button type="button" class="btn btn-secondary btn-small" onclick="openTopicEditor('${escapeAttribute(topic.filename)}')">Edit</button>
            </div>
        </div>
    `).join('');
}

function updateClosingRemarksVisibility() {
    const statusField = document.getElementById('task-status');
    const group = document.getElementById('task-closing-remarks-group');
    if (statusField && group) {
        group.style.display = statusField.value === 'closed' ? '' : 'none';
    }
}

// Open task modal (for new tasks only)
function openTaskModal() {
    const idField = document.getElementById('task-id');
    const descField = document.getElementById('task-description');
    const statusField = document.getElementById('task-status');
    const priorityField = document.getElementById('task-priority');
    const dueDateField = document.getElementById('task-due-date');
    
    idField.value = '';
    descField.value = '';
    statusField.value = 'created';
    priorityField.value = 'normal';
    dueDateField.value = '';
    document.getElementById('task-closing-remarks').value = '';
    renderTaskCategorySelect();
    updateClosingRemarksVisibility();
    
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
            document.getElementById(`edit-due-date-${id}`).value = task.due_date || '';
            document.getElementById(`edit-categories-${id}`).value = getTaskPrimaryCategory(task);
            const closingRemarksEl = document.getElementById(`edit-closing-remarks-${id}`);
            if (closingRemarksEl) closingRemarksEl.value = task.closing_remarks || '';
        }
    }
}

async function saveInlineEdit(id) {
    const description = document.getElementById(`edit-desc-${id}`).value;
    const status = document.getElementById(`edit-status-${id}`).value;
    const priority = document.getElementById(`edit-priority-${id}`).value;
    const due_date = document.getElementById(`edit-due-date-${id}`).value || null;
    const selectedCategory = document.getElementById(`edit-categories-${id}`).value;
    const categories = [selectedCategory || getDefaultCategory()];
    const closingRemarksEl = document.getElementById(`edit-closing-remarks-${id}`);
    const closing_remarks = closingRemarksEl ? closingRemarksEl.value.trim() : '';
    
    try {
        const response = await fetch(`/api/tasks/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description, status, priority, due_date, categories, closing_remarks: closing_remarks || null })
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

// Close task: show remarks prompt with Save / Skip
function openCloseTaskPrompt(id) {
    document.querySelectorAll('.close-task-prompt').forEach(el => { el.style.display = 'none'; });
    const prompt = document.getElementById(`close-prompt-${id}`);
    const textarea = document.getElementById(`close-remarks-${id}`);
    if (prompt && textarea) {
        textarea.value = '';
        prompt.style.display = 'block';
        textarea.focus();
    }
}

async function closeTaskWithRemarks(id) {
    const textarea = document.getElementById(`close-remarks-${id}`);
    const remarks = textarea ? textarea.value.trim() : '';
    try {
        const body = { status: 'closed' };
        if (remarks) body.closing_remarks = remarks;
        const response = await fetch(`/api/tasks/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (response.ok) {
            await loadTasks();
        }
    } catch (error) {
        console.error('Failed to close task:', error);
        alert('Failed to close task');
    }
}

async function closeTaskSkip(id) {
    try {
        const response = await fetch(`/api/tasks/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'closed' })
        });
        if (response.ok) {
            await loadTasks();
        }
    } catch (error) {
        console.error('Failed to close task:', error);
        alert('Failed to close task');
    }
}

// Delete task
async function deleteTask(id) {
    if (!confirm('Mark this task as deleted?')) return;
    
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
    const status = document.getElementById('task-status').value;
    const data = {
        description: document.getElementById('task-description').value,
        status,
        priority: document.getElementById('task-priority').value,
        due_date: document.getElementById('task-due-date').value || null,
        categories: [document.getElementById('task-categories').value || getDefaultCategory()]
    };
    if (status === 'closed') {
        const remarks = (document.getElementById('task-closing-remarks').value || '').trim();
        if (remarks) data.closing_remarks = remarks;
    }
    
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
    document.getElementById('topic-path').value = '';
    document.getElementById('topic-content').value = task.description;
    
    modalTopic.classList.remove('hidden');
    document.getElementById('topic-name').focus();
    document.getElementById('topic-name').select();
}

// Handle topic form submit
async function handleTopicSubmit(e) {
    e.preventDefault();
    
    const filepath = document.getElementById('topic-path').value.trim();
    const name = document.getElementById('topic-name').value;
    const content = document.getElementById('topic-content').value;
    
    try {
        const response = await fetch('/api/topics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, content, filepath })
        });
        
        if (response.ok) {
            modalTopic.classList.add('hidden');
            formTopic.reset();
            await loadTopics();
        } else {
            const error = await response.json();
            alert(error.error || 'Failed to create note');
        }
    } catch (error) {
        console.error('Failed to create note:', error);
        alert('Failed to create note');
    }
}

async function openTopicEditor(filename) {
    try {
        const response = await fetch(`/api/topics/${encodeURIComponent(filename)}`);
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to load note');
        }
        const topic = await response.json();
        setTopicEditMode(true);
        document.getElementById('topic-edit-filename').value = topic.filename;
        document.getElementById('topic-edit-name').value = topic.filename;
        document.getElementById('topic-edit-content').value = topic.content || '';
        modalTopicEdit.classList.remove('hidden');
        document.getElementById('topic-edit-content').focus();
    } catch (error) {
        console.error('Failed to open note editor:', error);
        alert(error.message || 'Failed to open note');
    }
}

async function openTopicViewer(filename) {
    try {
        const response = await fetch(`/api/topics/${encodeURIComponent(filename)}`);
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to load note');
        }
        const topic = await response.json();
        setTopicEditMode(false);
        document.getElementById('topic-edit-filename').value = topic.filename;
        document.getElementById('topic-edit-name').value = topic.filename;
        document.getElementById('topic-edit-content').value = topic.content || '';
        modalTopicEdit.classList.remove('hidden');
    } catch (error) {
        console.error('Failed to open note viewer:', error);
        alert(error.message || 'Failed to open note');
    }
}

async function handleTopicEditSubmit(e) {
    e.preventDefault();
    await saveTopicEditAndClose();
}

async function saveTopicEditAndClose() {
    const filename = document.getElementById('topic-edit-filename').value;
    const content = document.getElementById('topic-edit-content').value;
    if (!filename) return;

    try {
        const response = await fetch(`/api/topics/${encodeURIComponent(filename)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });

        if (response.ok) {
            modalTopicEdit.classList.add('hidden');
            await loadTopics();
        } else {
            const error = await response.json();
            alert(error.error || 'Failed to save note');
        }
    } catch (error) {
        console.error('Failed to save note:', error);
        alert('Failed to save note');
    }
}

function setTopicEditMode(isEditable) {
    const title = document.getElementById('topic-edit-modal-title');
    const textarea = document.getElementById('topic-edit-content');
    const saveBtn = document.getElementById('btn-topic-save');
    title.textContent = isEditable ? 'Edit Note' : 'View Note';
    textarea.readOnly = !isEditable;
    saveBtn.style.display = isEditable ? 'inline-flex' : 'none';
}

function renderStatusFilters() {
    if (!statusFilters) return;
    statusFilters.innerHTML = '';

    STATUS_OPTIONS.forEach(status => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `status-chip ${selectedStatuses.has(status) ? 'active' : ''}`;
        btn.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        btn.addEventListener('click', () => {
            if (selectedStatuses.has(status)) {
                selectedStatuses.delete(status);
            } else {
                selectedStatuses.add(status);
            }
            renderStatusFilters();
            renderTasks();
        });
        statusFilters.appendChild(btn);
    });
}

function renderCategoryFilters() {
    if (!categoryFilters) return;
    categoryFilters.innerHTML = '';

    const allCategories = [...categories];
    if (allCategories.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'empty-inline';
        empty.textContent = 'No categories';
        categoryFilters.appendChild(empty);
        return;
    }

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = `category-chip ${selectedCategories.size === 0 ? 'active' : ''}`;
    allBtn.textContent = 'Any';
    allBtn.addEventListener('click', () => {
        selectedCategories = new Set();
        renderCategoryFilters();
        renderTasks();
    });
    categoryFilters.appendChild(allBtn);

    allCategories.forEach(category => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `category-chip ${selectedCategories.has(category) ? 'active' : ''}`;
        btn.textContent = category;
        btn.addEventListener('click', () => {
            if (selectedCategories.has(category)) {
                selectedCategories.delete(category);
            } else {
                selectedCategories.add(category);
            }
            renderCategoryFilters();
            renderTasks();
        });
        categoryFilters.appendChild(btn);
    });
}

function renderCategoryBadges(categories = []) {
    if (!categories || categories.length === 0) return '';
    return categories.map(c => `<span class="category-badge">${escapeHtml(c)}</span>`).join('');
}

function getDefaultCategory() {
    return categories.find(cat => cat.toLowerCase() === 'default') || categories[0] || 'default';
}

function sanitizeSelectedCategories() {
    const allowed = new Set(categories);
    selectedCategories = new Set(Array.from(selectedCategories).filter(cat => allowed.has(cat)));
}

function renderCategoryManager() {
    if (!categoryManageList) return;
    if (!categories.length) {
        categoryManageList.innerHTML = '<div class="empty-state">No categories</div>';
        return;
    }
    categoryManageList.innerHTML = categories.map(category => {
        const isDefault = category.toLowerCase() === 'default';
        return `
            <div class="category-manage-item">
                <span class="category-name">${escapeHtml(category)}${isDefault ? ' (default)' : ''}</span>
                <div class="category-manage-actions">
                    ${isDefault ? '' : `<button type="button" class="btn btn-secondary btn-small" data-action="rename" data-category="${escapeAttribute(category)}">Edit</button>`}
                    ${isDefault ? '' : `<button type="button" class="btn btn-secondary btn-small" data-action="delete" data-category="${escapeAttribute(category)}">Delete</button>`}
                </div>
            </div>
        `;
    }).join('');
}

async function handleCategoryCreate(e) {
    e.preventDefault();
    const input = document.getElementById('new-category-name');
    const name = input.value.trim();
    if (!name) return;
    try {
        const response = await fetch('/api/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error || 'Failed to create category');
        }
        input.value = '';
        await Promise.all([loadCategories(), loadTasks()]);
    } catch (error) {
        alert(error.message || 'Failed to create category');
    }
}

async function handleCategoryManagerAction(e) {
    const action = e.target.dataset.action;
    const category = e.target.dataset.category;
    if (!action || !category) return;

    if (action === 'rename') {
        const nextName = prompt('Rename category', category);
        if (!nextName || nextName.trim() === category) return;
        try {
            const response = await fetch(`/api/categories/${encodeURIComponent(category)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: nextName.trim() })
            });
            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error || 'Failed to edit category');
            }
            await Promise.all([loadCategories(), loadTasks()]);
        } catch (error) {
            alert(error.message || 'Failed to edit category');
        }
        return;
    }

    if (action === 'delete') {
        if (!confirm(`Delete category "${category}"? Tasks using it will fall back to default.`)) return;
        try {
            const response = await fetch(`/api/categories/${encodeURIComponent(category)}`, {
                method: 'DELETE'
            });
            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error || 'Failed to delete category');
            }
            await Promise.all([loadCategories(), loadTasks()]);
        } catch (error) {
            alert(error.message || 'Failed to delete category');
        }
    }
}

function getDueClass(task) {
    if (!task || task.status === 'closed' || task.status === 'deleted') return '';
    const due = parseDate(task.due_date);
    if (!due) return '';
    const today = startOfToday();
    return due <= today ? 'due' : '';
}

function renderDueBadge(task) {
    const due = parseDate(task.due_date);
    if (!due) return '';
    const today = startOfToday();
    let state = 'upcoming';
    if (due < today) {
        state = 'overdue';
    } else if (due.getTime() === today.getTime()) {
        state = 'due';
    }
    return `<span class="due-badge ${state}">Due ${formatDate(task.due_date)}</span>`;
}

function parseDate(dateStr) {
    if (!dateStr) return null;
    const date = new Date(`${dateStr}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function startOfToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
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

function formatDateTime(dateTimeStr) {
    const date = new Date(dateTimeStr);
    if (Number.isNaN(date.getTime())) {
        return dateTimeStr;
    }
    return date.toLocaleString();
}

// Utility: Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeAttribute(text) {
    return escapeHtml(text).replace(/"/g, '&quot;');
}

// Register service worker
if ('serviceWorker' in navigator) {
    let reloadingForSw = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadingForSw) return;
        reloadingForSw = true;
        window.location.reload();
    });

    navigator.serviceWorker.register('/sw.js')
        .then(registration => {
            registration.update();
            registration.addEventListener('updatefound', () => {
                const installing = registration.installing;
                if (!installing) return;
                installing.addEventListener('statechange', () => {
                    if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                        console.log('New app version available. Reload to update.');
                    }
                });
            });
        })
        .catch(err => {
            console.log('SW registration failed:', err);
        });
}
