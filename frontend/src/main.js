const API_BASE = 'http://localhost:8000';

const appDiv = document.getElementById('app');
let accountId = localStorage.getItem('gwp_account_id');
let jobsPollingInterval = null;
let selectedDriveFiles = new Set();
let currentDrivePath = [{ id: 'root', name: 'My Drive' }];
let currentNextPageToken = null;

let selectedGmailIds = new Set();
let currentGmailNextPageToken = null;
let currentGmailQuery = "";

async function init() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const error = urlParams.get('error');

  if (code) {
    // If OAuth code is in URL, exchange it
    await handleAuthExchange(code);
  } else if (error) {
    alert('Authentication failed: ' + error);
    renderLogin();
  } else if (accountId) {
    renderAppShell();
  } else {
    // Show login page
    renderLogin();
  }
}

async function handleAuthExchange(code) {
  renderLoading('Authenticating with Google...');
  try {
    const email = localStorage.getItem('gwp_auth_email') || 'user@example.com';
    const redirectUri = window.location.origin + window.location.pathname;
    
    const response = await fetch(`${API_BASE}/auth/exchange?code=${encodeURIComponent(code)}&email=${encodeURIComponent(email)}&redirect_uri=${encodeURIComponent(redirectUri)}`, {
      method: 'POST'
    });
    const data = await response.json();
    
    if (response.ok) {
      accountId = data.account_id;
      localStorage.setItem('gwp_account_id', accountId);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
      renderAppShell();
    } else {
      throw new Error(data.detail || data.error || 'Authentication failed');
    }
  } catch (err) {
    alert(err.message);
    renderLogin();
  }
}

function renderLoading(message) {
  appDiv.innerHTML = `
    <div class="panel" style="text-align: center;">
      <h2>${message}</h2>
      <p class="subtitle">Please wait...</p>
    </div>
  `;
}

function renderLogin() {
  appDiv.innerHTML = `
    <div class="panel" style="text-align: center;">
      <h1>Workspace Protection</h1>
      <p class="subtitle">Securely backup your Google Drive and Gmail data to your local disk.</p>
      
      <div style="margin: 2rem 0;">
        <input type="email" id="emailInput" placeholder="Enter your email" required />
      </div>
      
      <button id="loginBtn" class="btn">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
        Connect with Google
      </button>
    </div>
  `;

  document.getElementById('loginBtn').addEventListener('click', async () => {
    const email = document.getElementById('emailInput').value;
    if (!email) {
      alert('Please enter your email.');
      return;
    }
    localStorage.setItem('gwp_auth_email', email);
    
    // Redirect to backend auth URL generator
    const redirectUri = window.location.origin + window.location.pathname;
    try {
      const res = await fetch(`${API_BASE}/auth/url?redirect_uri=${encodeURIComponent(redirectUri)}`);
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Error getting Auth URL');
      }
    } catch (e) {
      alert('Could not reach backend API at ' + API_BASE);
    }
  });
}

function renderAppShell(activeTab = 'dashboard') {
  document.body.classList.add('app-mode');
  
  appDiv.innerHTML = `
    <div class="app-container">
      <nav class="sidebar">
        <div class="sidebar-title">GWP Studio</div>
        <div class="sidebar-nav">
          <div class="nav-item ${activeTab === 'dashboard' ? 'active' : ''}" onclick="showTab('dashboard')">
            📊 Dashboard
          </div>
          <div class="nav-item ${activeTab === 'backup' ? 'active' : ''}" onclick="showTab('backup')">
            ☁️ Backup
          </div>
          <div class="nav-item ${activeTab === 'usage' ? 'active' : ''}" onclick="showTab('usage')">
            📈 Usage
          </div>
          <div class="nav-item logout-nav-item" onclick="logout()">
            🚪 Log out
          </div>
        </div>
      </nav>
      <main class="main-content" id="mainContentArea"></main>
    </div>
  `;
  
  showTabContent(activeTab);
}

window.showTab = function(tab) {
  renderAppShell(tab);
}

window.logout = function() {
  localStorage.removeItem('gwp_account_id');
  accountId = null;
  document.body.classList.remove('app-mode');
  if (jobsPollingInterval) clearInterval(jobsPollingInterval);
  renderLogin();
}

function showTabContent(tab) {
  const container = document.getElementById('mainContentArea');
  if (tab === 'dashboard') {
    renderDashboardView(container);
  } else if (tab === 'backup') {
    renderBackupView(container);
  } else if (tab === 'usage') {
    renderUsageView(container);
  }
}

function renderDashboardView(container) {
  container.innerHTML = `
    <div class="panel">
      <h1>Dashboard</h1>
      <div class="subtitle">Connected Account ID: ${accountId}</div>
      <h3>Recent Jobs</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>Job ID</th>
            <th>Type</th>
            <th>Status</th>
            <th>Finished At</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="dashboardTableBody">
          <tr><td colspan="5" style="text-align:center;">Loading...</td></tr>
        </tbody>
      </table>
    </div>
  `;
  
  fetchJobsAndPopulateTable();
  if (jobsPollingInterval) clearInterval(jobsPollingInterval);
  jobsPollingInterval = setInterval(fetchJobsAndPopulateTable, 3000);
}

async function fetchJobsAndPopulateTable() {
  try {
    const response = await fetch(`${API_BASE}/jobs/`);
    if (response.ok) {
      const jobsData = await response.json();
      const tbody = document.getElementById('dashboardTableBody');
      if (!tbody) return; 
      
      if (jobsData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 2rem; color: var(--text-secondary);">No jobs found. Navigate to Backup to start one.</td></tr>`;
        return;
      }
      
      tbody.innerHTML = jobsData.map(job => {
        const timeFinished = job.completed_at ? new Date(job.completed_at).toLocaleString() : '-';
        return `
          <tr>
            <td>#${job.id}</td>
            <td>${job.job_type}</td>
            <td><span class="status-badge status-${job.status.toLowerCase()}">${job.status}</span></td>
            <td>${timeFinished}</td>
            <td>
              <div class="action-menu" onclick="event.stopPropagation(); toggleDropdown(${job.id})">
                <button class="action-btn">⋮</button>
                <div class="dropdown-content" id="dropdown-${job.id}">
                  <button class="dropdown-item" onclick="expireBackup(${job.id})">Expire Backup</button>
                </div>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }
  } catch (e) {
    console.error(e);
  }
}

window.toggleDropdown = function(id) {
  document.querySelectorAll('.dropdown-content').forEach(el => el.classList.remove('show'));
  const el = document.getElementById(`dropdown-${id}`);
  if (el) el.classList.toggle('show');
}

document.addEventListener('click', () => {
  document.querySelectorAll('.dropdown-content').forEach(el => el.classList.remove('show'));
});

window.expireBackup = async function(jobId) {
  if(!confirm("Are you sure you want to expire and delete this backup entirely from local storage?")) return;
  try {
    const res = await fetch(`${API_BASE}/jobs/${jobId}`, { method: 'DELETE' });
    if(res.ok) fetchJobsAndPopulateTable();
  } catch (e) {
    alert("Error deleting job.");
  }
}

function renderBackupView(container) {
  if (jobsPollingInterval) clearInterval(jobsPollingInterval);
  
  container.innerHTML = `
    <div class="panel">
      <h1>New Backup</h1>
      <div class="subtitle">Select a service to start an interactive backup session</div>
      <div class="dashboard-grid" style="margin-top: 0;">
        <div class="panel" style="background: rgba(0,0,0,0.2);">
          <h3>Google Drive</h3>
          <p style="color:var(--text-secondary); margin-bottom: 1.5rem;">Backup selective Google Docs, Sheets, and hierarchical folders natively.</p>
          <button class="btn" id="backupDriveBtn">Browse GDrive & Backup</button>
        </div>
        <div class="panel" style="background: rgba(0,0,0,0.2);">
          <h3>Gmail</h3>
          <p style="color:var(--text-secondary); margin-bottom: 1.5rem;">Backup raw .eml emails preserving native attachments spanning your inbox.</p>
          <button class="btn" id="backupGmailBtn">Browse Gmail & Backup</button>
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('backupDriveBtn').addEventListener('click', openDriveBrowser);
  document.getElementById('backupGmailBtn').addEventListener('click', openGmailBrowser);
}

function renderUsageView(container) {
  if (jobsPollingInterval) clearInterval(jobsPollingInterval);
  
  container.innerHTML = `
    <div class="panel">
      <h1>Storage Usage</h1>
      <div class="subtitle">Track your historical backup footprint over time</div>
      <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 1rem; border: 1px solid var(--border-color);">
        <canvas id="usageChart" height="100"></canvas>
      </div>
    </div>
  `;
  
  loadUsageGraph();
}

async function loadUsageGraph() {
  try {
    const res = await fetch(`${API_BASE}/usage/`);
    if (res.ok) {
      const data = await res.json();
      const labels = data.map(d => new Date(d.date + "T00:00:00").toLocaleDateString());
      const values = data.map(d => d.mb);
      
      new Chart(document.getElementById('usageChart'), {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: 'Local Storage Used (MB)',
            data: values,
            backgroundColor: '#58a6ff',
            borderRadius: 4
          }]
        },
        options: {
          scales: {
            y: { beginAtZero: true, grid: { color: '#30363d' }, ticks: { color: '#8b949e' } },
            x: { grid: { display: false }, ticks: { color: '#8b949e' } }
          },
          plugins: { legend: { labels: { color: '#c9d1d9' } } }
        }
      });
    }
  } catch (e) {
    console.error(e);
  }
}

function openDriveBrowser() {
  let modal = document.getElementById('driveBrowserModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'driveBrowserModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2 style="margin: 0; font-size: 1.5rem;">Select Files to Backup</h2>
          <button class="btn btn-secondary" onclick="document.getElementById('driveBrowserModal').classList.remove('active')">Close</button>
        </div>
        <div class="modal-body">
          <div class="breadcrumb" id="driveBreadcrumbs"></div>
          <div id="driveFilesList">Loading files...</div>
        </div>
        <div class="modal-footer">
          <span style="color: var(--text-secondary); font-size: 0.9rem;" id="selectionCount">0 items selected</span>
          <button class="btn" id="confirmDriveBackupBtn">Backup Selected Now</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    document.getElementById('confirmDriveBackupBtn').addEventListener('click', () => {
      startBackup('GDRIVE', Array.from(selectedDriveFiles));
      modal.classList.remove('active');
    });
  }
  
  selectedDriveFiles.clear();
  currentDrivePath = [{ id: 'root', name: 'My Drive' }];
  updateSelectionCount();
  modal.classList.add('active');
  loadDriveFolder('root');
}

function updateSelectionCount() {
  const el = document.getElementById('selectionCount');
  if (el) el.innerText = `${selectedDriveFiles.size} item(s) selected`;
}

function openGmailBrowser() {
  let modal = document.getElementById('gmailBrowserModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'gmailBrowserModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2 style="margin: 0; font-size: 1.5rem;">Select Emails to Backup</h2>
          <button class="btn btn-secondary" onclick="document.getElementById('gmailBrowserModal').classList.remove('active')">Close</button>
        </div>
        <div style="padding: 1rem; border-bottom: 1px solid var(--border-color); display: flex; gap: 1rem;">
          <input type="text" id="gmailFilterInput" placeholder="Filter by label (e.g. INBOX, important)" style="flex: 1; margin: 0; background: var(--bg-color); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 4px; padding: 0.5rem;" />
          <button class="btn btn-secondary" id="applyGmailFilterBtn">Search</button>
        </div>
        <div class="modal-body" style="padding: 0;">
          <div id="gmailMessagesList" style="padding: 1rem;">Loading emails...</div>
        </div>
        <div class="modal-footer">
          <span style="color: var(--text-secondary); font-size: 0.9rem;" id="gmailSelectionCount">0 emails selected</span>
          <button class="btn" id="confirmGmailBackupBtn">Backup Selected Now</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    document.getElementById('confirmGmailBackupBtn').addEventListener('click', () => {
      startBackup('GMAIL', Array.from(selectedGmailIds));
      modal.classList.remove('active');
    });

    document.getElementById('applyGmailFilterBtn').addEventListener('click', () => {
      const q = document.getElementById('gmailFilterInput').value;
      currentGmailQuery = q;
      loadGmailMessages(currentGmailQuery, false);
    });
  }
  
  selectedGmailIds.clear();
  currentGmailQuery = "";
  if(document.getElementById('gmailFilterInput')) {
    document.getElementById('gmailFilterInput').value = "";
  }
  updateGmailSelectionCount();
  modal.classList.add('active');
  loadGmailMessages("", false);
}

function updateGmailSelectionCount() {
  const el = document.getElementById('gmailSelectionCount');
  if (el) el.innerText = `${selectedGmailIds.size} email(s) selected`;
}

async function loadGmailMessages(queryStr = "", loadMore = false) {
  const listContainer = document.getElementById('gmailMessagesList');
  if (!loadMore) {
    listContainer.innerHTML = '<div style="text-align:center; padding: 2rem;">Loading emails...</div>';
    currentGmailNextPageToken = null;
  } else {
    const btn = document.getElementById('gmailLoadMoreBtn');
    if (btn) btn.innerText = 'Loading...';
  }

  try {
    let url = `${API_BASE}/gmail/messages/?account_id=${accountId}`;
    if (queryStr) url += `&query=${encodeURIComponent(queryStr)}`;
    if (loadMore && currentGmailNextPageToken) url += `&page_token=${currentGmailNextPageToken}`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch messages');
    const data = await response.json();
    
    if (!loadMore) listContainer.innerHTML = '';
    
    const oldBtn = document.getElementById('gmailLoadMoreBtn');
    if (oldBtn) oldBtn.remove();

    if (!loadMore && (!data.messages || data.messages.length === 0)) {
       listContainer.innerHTML = '<div style="text-align:center; padding: 2rem; color: var(--text-secondary)">No emails found.</div>';
       return;
    }

    data.messages.forEach(msg => {
      const isSelected = selectedGmailIds.has(msg.id);
      
      const div = document.createElement('div');
      div.className = `file-item ${isSelected ? 'selected' : ''}`;
      div.innerHTML = `
        <input type="checkbox" style="margin-right: 1rem; transform: scale(1.2);" ${isSelected ? 'checked' : ''}>
        <div style="flex:1; overflow:hidden; min-width: 0;">
          <div style="font-weight: 600; text-overflow: ellipsis; white-space: nowrap; overflow: hidden; margin-bottom: 0.2rem;">${msg.subject}</div>
          <div style="font-size: 0.8rem; color: var(--text-secondary); text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">From: ${msg.from}</div>
        </div>
        <div style="font-size: 0.8rem; color: var(--text-secondary); white-space: nowrap; margin-left: 1rem;">
          ${msg.date ? new Date(msg.date).toLocaleDateString() : ''}
        </div>
      `;
      
      const checkbox = div.querySelector('input');
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleGmailSelection(msg.id, div, checkbox);
      });

      div.addEventListener('click', () => {
        toggleGmailSelection(msg.id, div, checkbox);
      });
      
      listContainer.appendChild(div);
    });
    
    currentGmailNextPageToken = data.nextPageToken;
    if (currentGmailNextPageToken) {
      const loadBtn = document.createElement('div');
      loadBtn.id = 'gmailLoadMoreBtn';
      loadBtn.className = 'load-more-btn';
      loadBtn.innerText = 'Load More Emails...';
      loadBtn.onclick = () => loadGmailMessages(queryStr, true);
      listContainer.appendChild(loadBtn);
    }
    
  } catch (err) {
    if (!loadMore) listContainer.innerHTML = `<div style="color:#f85149; padding:1rem;">Error: ${err.message}</div>`;
  }
}

function toggleGmailSelection(fileId, itemDiv, checkboxEl) {
  if (selectedGmailIds.has(fileId)) {
    selectedGmailIds.delete(fileId);
    itemDiv.classList.remove('selected');
    checkboxEl.checked = false;
  } else {
    selectedGmailIds.add(fileId);
    itemDiv.classList.add('selected');
    checkboxEl.checked = true;
  }
  updateGmailSelectionCount();
}

function renderBreadcrumbs() {
  const container = document.getElementById('driveBreadcrumbs');
  container.innerHTML = currentDrivePath.map((folder, index) => {
    return `<span onclick="navigateToBreadcrumb(${index})">${folder.name}</span>${index < currentDrivePath.length - 1 ? ' / ' : ''}`;
  }).join('');
}

window.navigateToBreadcrumb = function(index) {
  currentDrivePath = currentDrivePath.slice(0, index + 1);
  const targetId = currentDrivePath[currentDrivePath.length - 1].id;
  loadDriveFolder(targetId);
}

async function loadDriveFolder(folderId, loadMore = false) {
  const listContainer = document.getElementById('driveFilesList');
  if (!loadMore) {
    listContainer.innerHTML = '<div style="text-align:center; padding: 2rem;">Loading...</div>';
    currentNextPageToken = null;
    renderBreadcrumbs();
  } else {
    const btn = document.getElementById('loadMoreBtn');
    if (btn) btn.innerText = 'Loading...';
  }

  try {
    let url = `${API_BASE}/gdrive/files/?account_id=${accountId}&parent_id=${folderId}`;
    if (loadMore && currentNextPageToken) url += `&page_token=${currentNextPageToken}`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch files');
    const data = await response.json();
    
    if (!loadMore) listContainer.innerHTML = '';
    
    const oldBtn = document.getElementById('loadMoreBtn');
    if (oldBtn) oldBtn.remove();

    if (!loadMore && (!data.files || data.files.length === 0)) {
       listContainer.innerHTML = '<div style="text-align:center; padding: 2rem; color: var(--text-secondary)">This folder is empty.</div>';
       return;
    }

    data.files.forEach(file => {
      const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
      const icon = isFolder ? '📁' : '📄';
      const isSelected = selectedDriveFiles.has(file.id);
      
      const div = document.createElement('div');
      div.className = `file-item ${isSelected ? 'selected' : ''}`;
      div.innerHTML = `
        <input type="checkbox" style="margin-right: 1rem; transform: scale(1.2);" ${isSelected ? 'checked' : ''}>
        <div class="file-icon">${icon}</div>
        <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${file.name}</div>
      `;
      
      const checkbox = div.querySelector('input');
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSelection(file.id, div, checkbox);
      });

      div.addEventListener('click', () => {
        if (isFolder) {
          currentDrivePath.push({ id: file.id, name: file.name });
          loadDriveFolder(file.id);
        } else {
          toggleSelection(file.id, div, checkbox);
        }
      });
      
      listContainer.appendChild(div);
    });
    
    currentNextPageToken = data.nextPageToken;
    if (currentNextPageToken) {
      const loadBtn = document.createElement('div');
      loadBtn.id = 'loadMoreBtn';
      loadBtn.className = 'load-more-btn';
      loadBtn.innerText = 'Load More Responses...';
      loadBtn.onclick = () => loadDriveFolder(folderId, true);
      listContainer.appendChild(loadBtn);
    }
    
  } catch (err) {
    if (!loadMore) listContainer.innerHTML = `<div style="color:#f85149; padding:1rem;">Error: ${err.message}</div>`;
  }
}

function toggleSelection(fileId, itemDiv, checkboxEl) {
  if (selectedDriveFiles.has(fileId)) {
    selectedDriveFiles.delete(fileId);
    itemDiv.classList.remove('selected');
    checkboxEl.checked = false;
  } else {
    selectedDriveFiles.add(fileId);
    itemDiv.classList.add('selected');
    checkboxEl.checked = true;
  }
  updateSelectionCount();
}

async function startBackup(jobType, selectedIds = null) {
  try {
    const payload = { job_type: jobType };
    if (selectedIds && selectedIds.length > 0) {
      payload.selected_ids = selectedIds;
    }
    const response = await fetch(`${API_BASE}/jobs/?account_id=` + accountId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (response.ok) {
      showTab('dashboard');
    } else {
      const err = await response.json();
      alert(err.detail || 'Failed to start backup');
    }
  } catch(e) {
    alert('Network error connecting to backend API');
  }
}


// Start application
init();
