const API_BASE = window.location.origin;

const appDiv = document.getElementById('app');
let currentUser = null;
let currentTab = 'dashboard';
let accountId = localStorage.getItem('gwp_account_id');
let jobsPollingInterval = null;
let selectedDriveFiles = new Set();
let currentDrivePath = [{ id: 'root', name: 'My Drive' }];
let currentNextPageToken = null;

let selectedGmailIds = new Set();
let currentGmailNextPageToken = null;
let currentGmailQuery = "";
let usageChartInstance = null;

async function init() {
  // Initialize theme first
  applyTheme();

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
    try {
      const accsRes = await fetch(`${API_BASE}/accounts/`);
      const accs = await accsRes.json();
      currentUser = accs.find(a => a.id == accountId);
    } catch (e) {}
    renderAppShell();
  } else {
    // Show login page
    renderLogin();
  }
}

// Theme Management
function applyTheme(theme) {
  const currentTheme = theme || localStorage.getItem('gwp_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', currentTheme);
  localStorage.setItem('gwp_theme', currentTheme);
  
  const toggle = document.getElementById('theme-checkbox');
  if (toggle) {
    toggle.checked = currentTheme === 'light';
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
    <div class="login-view">
      <div class="login-card">
        <div class="sidebar-logo" style="justify-content: center;">
          <div class="logo-icon">G</div>
          <span>GWP Studio</span>
        </div>
        <h2 class="mb-1" style="font-size: 1.75rem;">Welcome back</h2>
        <p class="text-muted mb-2">Connect your Google Workspace to begin protection</p>
        
        <div class="input-group">
          <label>Email Address</label>
          <input type="email" id="emailInput" placeholder="name@company.com" required />
        </div>
        
        <button id="loginBtn" class="btn btn-primary" style="width: 100%; justify-content: center; padding: 1rem;">
          Connect with Google
        </button>
        <p class="text-muted" style="margin-top: 1.5rem; font-size: 0.8rem;">
          Secure local-only backup solution.
        </p>
      </div>
    </div>
  `;

  document.getElementById('loginBtn').addEventListener('click', async () => {
    const email = document.getElementById('emailInput').value;
    if (!email) {
      alert('Please enter your email.');
      return;
    }
    localStorage.setItem('gwp_auth_email', email);
    
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
  
  const userInitials = (currentUser?.name || 'U').charAt(0);
  const userAvatar = currentUser?.picture 
    ? `<img src="${currentUser.picture}" style="width:32px; height:32px; border-radius:50%; object-fit:cover;" />`
    : `<div class="user-avatar" style="width:32px; height:32px; font-size:12px;">${userInitials}</div>`;

  appDiv.innerHTML = `
    <div class="app-container">
      <aside class="sidebar">
        <!-- Narrow Rail -->
        <div class="sidebar-narrow">
          <div class="logo-icon" style="background:var(--accent-primary-light); color:var(--accent-primary);">G</div>
          <div class="nav-icon-strip" style="display:flex; flex-direction:column; gap:1.5rem; align-items:center; margin-top:2rem;">
            <i class="ri-dashboard-line" style="font-size:1.4rem; color:var(--accent-primary);"></i>
            <i class="ri-shield-check-line" style="font-size:1.4rem; color:var(--text-muted);"></i>
            <i class="ri-history-line" style="font-size:1.4rem; color:var(--text-muted);"></i>
            <i class="ri-settings-4-line" style="font-size:1.4rem; color:var(--text-muted); margin-top: auto;"></i>
          </div>
          <div style="margin-top:auto;">
             ${userAvatar}
          </div>
        </div>

        <!-- Expanded Menu -->
        <div class="sidebar-main">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:3rem;">
            <h2 style="font-family:'Outfit'; font-size:1.5rem; color:var(--accent-primary-dark);">GWP Studio</h2>
            <i class="ri-arrow-left-s-line" style="color:var(--text-muted); cursor:pointer;"></i>
          </div>

          <div class="sidebar-section">
            <div class="section-label">Synchronize</div>
            <a class="nav-item ${activeTab === 'dashboard' ? 'active' : ''}" onclick="showTab('dashboard')">
              <i class="ri-dashboard-line"></i> Dashboard
            </a>
            <a class="nav-item ${activeTab === 'backup' ? 'active' : ''}" onclick="showTab('backup')">
              <i class="ri-shield-check-line"></i> Backup Center
            </a>
            <a class="nav-item ${activeTab === 'restore' ? 'active' : ''}" onclick="showTab('restore')">
              <i class="ri-history-line"></i> Recovery Hub
            </a>
            <a class="nav-item ${activeTab === 'activity' ? 'active' : ''}" onclick="showTab('activity')">
              <i class="ri-list-check"></i> Activity Log
            </a>
          </div>

          <div class="sidebar-section" style="margin-top:2rem;">
            <div class="section-label">General</div>
            <a class="nav-item"><i class="ri-settings-3-line"></i> Settings</a>
            <a class="nav-item"><i class="ri-question-line"></i> Help Center</a>
          </div>

          <div class="sidebar-footer">
            <div style="display:flex; align-items:center; gap:1rem; margin-bottom:1.5rem;">
               ${userAvatar}
               <div style="overflow:hidden;">
                 <div class="font-bold" style="font-size:0.85rem; white-space:nowrap; text-overflow:ellipsis;">${currentUser?.name || 'User'}</div>
                 <div class="text-muted" style="font-size:0.7rem; white-space:nowrap; text-overflow:ellipsis;">Admin Manager</div>
               </div>
            </div>
            <a class="nav-item" onclick="logout()" style="color:var(--text-secondary);">
              <i class="ri-logout-box-r-line"></i> Log out
            </a>
          </div>
        </div>
      </aside>

      <main class="main-content">
        <header class="top-bar">
          <div class="search-container" style="width:300px;">
            <i class="ri-search-line search-icon"></i>
            <input type="text" class="search-input" placeholder="Search data...">
          </div>
          
          <div style="display:flex; align-items:center; gap:1.5rem;">
             <div style="background:white; padding:0.5rem 1rem; border-radius:100px; border:1px solid var(--border-color); font-size:0.85rem; display:flex; align-items:center; gap:0.5rem; cursor:pointer;">
               <i class="ri-calendar-line"></i>
               <span>Time period: <b>Last 30 days</b></span>
             </div>
             <i class="ri-notification-3-line" style="font-size:1.25rem; color:var(--text-muted); cursor:pointer;"></i>
          </div>
        </header>

        <div id="mainContentArea"></div>
      </main>
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
  // Clean up any existing chart instance before switching tabs
  if (usageChartInstance) {
    usageChartInstance.destroy();
    usageChartInstance = null;
  }
  
  if (tab === 'dashboard') {
    renderDashboardView(container);
  } else if (tab === 'backup') {
    renderBackupView(container);
  } else if (tab === 'restore') {
    renderRestoreView(container);
  } else if (tab === 'activity') {
    renderActivityView(container);
  } else if (tab === 'usage') {
    renderUsageView(container);
  }
}

function renderDashboardView(container) {
  container.innerHTML = `
    <div class="dashboard-header">
      <div>
        <h1 class="page-title">Dashboard</h1>
        <p class="page-subtitle">Monitor and manage your workspace protection status.</p>
      </div>
    </div>

    <div class="metrics-grid">
      <div class="metrics-card primary">
        <div class="metrics-label">
          <span>Total Protected</span>
          <i class="ri-folder-shield-2-line"></i>
        </div>
        <div class="metrics-value" id="stat-total-jobs">--</div>
        <div class="metrics-trend">
          <i class="ri-arrow-right-up-line"></i> 
          <span>Increased from last week</span>
        </div>
      </div>

      <div class="metrics-card">
        <div class="metrics-label">
          <span>Gmail Backups</span>
          <i class="ri-mail-check-line"></i>
        </div>
        <div class="metrics-value" id="stat-gmail-jobs">--</div>
        <div class="metrics-trend trend-up">
          <i class="ri-checkbox-circle-line"></i> 
          <span>Inbox secured</span>
        </div>
      </div>

      <div class="metrics-card">
        <div class="metrics-label">
          <span>Drive Backups</span>
          <i class="ri-cloud-line"></i>
        </div>
        <div class="metrics-value" id="stat-drive-jobs">--</div>
        <div class="metrics-trend trend-up">
          <i class="ri-refresh-line"></i> 
          <span>Docs synchronized</span>
        </div>
      </div>

      <div class="metrics-card">
        <div class="metrics-label">
          <span>Active Health</span>
          <i class="ri-shield-user-line"></i>
        </div>
        <div class="metrics-value">100%</div>
        <div class="metrics-trend trend-up">
          <i class="ri-check-double-line"></i> 
          <span>System operational</span>
        </div>
      </div>
    </div>

    <div class="main-dashboard-content">
      <div class="content-card">
        <div class="card-header">
          <h3>Recent Protection Jobs</h3>
          <button class="btn btn-outline" style="padding: 0.5rem 1rem; font-size: 0.8rem;" onclick="fetchJobsAndPopulateTable()">Refresh</button>
        </div>
        <div style="overflow-x: auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Type</th>
                <th>Status</th>
                <th>Completion</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="dashboardTableBody">
              <tr><td colspan="5" style="text-align:center;">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="content-card">
        <div class="card-header">
          <h3>Active Progress</h3>
        </div>
        <div class="progress-widget">
          <div class="font-bold">System Status</div>
          <div class="text-muted" style="color: rgba(255,255,255,0.7); font-size: 0.8rem;">Monitoring for new updates...</div>
          <div class="progress-circle">
             <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; font-weight: 700;">OK</div>
             <svg viewBox="0 0 36 36" style="width: 100%; height: 100%;">
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="3" />
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="white" stroke-width="3" stroke-dasharray="100, 100" />
             </svg>
          </div>
          <div style="text-align: center; font-size: 0.8rem;">All systems protected</div>
        </div>
        
        <div class="content-card" style="margin-top: 1.5rem; padding: 1.25rem; background: var(--accent-secondary-light); border-color: var(--accent-secondary);">
           <div class="font-bold" style="color: var(--accent-primary); font-size: 0.9rem;">Pro Tip</div>
           <p style="font-size: 0.8rem; color: var(--accent-primary); margin: 0.5rem 0 0;">Regularly expire old backups to free up local storage space.</p>
        </div>
      </div>
    </div>
  `;
  
  fetchJobsAndPopulateTable();
  if (jobsPollingInterval) clearInterval(jobsPollingInterval);
  jobsPollingInterval = setInterval(fetchJobsAndPopulateTable, 3000);
}

async function fetchJobsAndPopulateTable() {
  try {
    // Dashboard only shows the 5 most recent jobs
    const response = await fetch(`${API_BASE}/jobs/?limit=5`);
    if (response.ok) {
      const jobsData = await response.json();
      const tbody = document.getElementById('dashboardTableBody');
      if (!tbody) return; 
      
      // Update stats
      const totalEl = document.getElementById('stat-total-jobs');
      if (totalEl) totalEl.innerText = jobsData.length;
      
      const gmailEl = document.getElementById('stat-gmail-jobs');
      if (gmailEl) gmailEl.innerText = jobsData.filter(j => j.job_type === 'GMAIL').length;
      
      const driveEl = document.getElementById('stat-drive-jobs');
      if (driveEl) driveEl.innerText = jobsData.filter(j => j.job_type === 'GDRIVE').length;
      
      if (jobsData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 2rem; color: var(--text-secondary);">No jobs found. Navigate to Backup to start one.</td></tr>`;
        return;
      }
      
      tbody.innerHTML = jobsData.map(job => {
        const timeFinished = job.completed_at ? new Date(job.completed_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '-';
        const typeIcon = job.job_type === 'GMAIL' ? '📧' : '☁️';
        return `
          <tr>
            <td><div class="font-bold">#${job.id}</div></td>
            <td>
               <div style="display: flex; align-items: center; gap: 0.5rem;">
                 <div class="service-icon">${typeIcon}</div>
                 <span>${job.job_type}</span>
               </div>
            </td>
            <td><span class="status-pill ${job.status.toLowerCase()}">${job.status}</span></td>
            <td><span class="text-muted">${timeFinished}</span></td>
            <td>
              <div class="action-menu" onclick="event.stopPropagation(); toggleDropdown(${job.id})">
                <button class="action-btn">⋮</button>
                <div class="dropdown-content" id="dropdown-${job.id}">
                   ${job.status === 'COMPLETED' ? `
                     <button class="dropdown-item" onclick="startRestore(${job.id}, '${job.job_type}')">
                        <i class="ri-restart-line"></i> Restore Data
                     </button>
                     <button class="dropdown-item text-danger" onclick="expireBackup(${job.id})">
                       <i class="ri-delete-bin-line"></i> Expire Backup
                     </button>
                   ` : '<span class="dropdown-item disabled">No actions</span>'}
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
  if(!confirm("Are you sure you want to expire and delete this backup archive? This action will remove the local data files permanently.")) return;
  try {
    const res = await fetch(`${API_BASE}/jobs/${jobId}/expire`, { method: 'POST' });
    if(res.ok) {
      showTab('activity');
    }
  } catch (e) {
    alert("Error expiring backup.");
  }
}

function renderBackupView(container) {
  if (jobsPollingInterval) clearInterval(jobsPollingInterval);
  
  container.innerHTML = `
    <div class="dashboard-header">
      <div>
        <h1 class="page-title">Initiate Protection</h1>
        <p class="page-subtitle">Choose a service to begin a secure local synchronization.</p>
      </div>
    </div>

    <div class="service-grid">
      <div class="service-card">
        <i>☁️</i>
        <h3>Google Drive</h3>
        <p class="text-muted mb-2" style="font-size: 0.9rem;">Selectively backup Documents, Sheets, and full directory structures.</p>
        <button class="btn btn-primary" id="backupDriveBtn" style="width: 100%; justify-content: center;">Browse & Backup</button>
      </div>
      
      <div class="service-card">
        <i>📧</i>
        <h3>Gmail Protection</h3>
        <p class="text-muted mb-2" style="font-size: 0.9rem;">Preserve your communication history by backing up emails to .eml format.</p>
        <button class="btn btn-primary" id="backupGmailBtn" style="width: 100%; justify-content: center;">Browse & Backup</button>
      </div>
    </div>

    <div class="dashboard-header" style="margin-top: 3rem; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1 class="page-title">Automated Policies</h1>
        <p class="page-subtitle">Set up recurring schedules to automatically protect your data.</p>
      </div>
      <button class="btn btn-primary" onclick="openPolicyModal()">+ Create Policy</button>
    </div>

    <div class="content-card">
      <div style="overflow-x: auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Policy Name</th>
              <th>Service</th>
              <th>Frequency</th>
              <th>Start Time</th>
              <th>Last Run</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="policyTableBody">
            <tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--text-muted);">Loading policies...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="content-card" style="margin-top: 2rem;">
       <div class="card-header">
         <h3>System Prerequisites</h3>
       </div>
       <div style="display: flex; gap: 2rem;">
          <div style="flex: 1; padding: 1.5rem; background: #f8fafc; border-radius: var(--border-radius-md);">
             <div class="font-bold mb-1">Local Storage</div>
             <div class="text-muted" style="font-size: 0.85rem;">Ensure you have at least 10GB of free space on your host machine for large Drive archives.</div>
          </div>
          <div style="flex: 1; padding: 1.5rem; background: #f8fafc; border-radius: var(--border-radius-md);">
             <div class="font-bold mb-1">OAuth Tokens</div>
             <div class="text-muted" style="font-size: 0.85rem;">Your session tokens are stored securely and only used for read-only access to your data.</div>
          </div>
       </div>
    </div>
  `;
  
  document.getElementById('backupDriveBtn').addEventListener('click', openDriveBrowser);
  document.getElementById('backupGmailBtn').addEventListener('click', openGmailBrowser);
  fetchPolicies();
}

function renderActivityView(container) {
  container.innerHTML = `
    <div class="dashboard-header">
      <div>
        <h1 class="page-title">Job Activity</h1>
        <p class="page-subtitle">Historical record of all synchronization and protection tasks.</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-outline" onclick="fetchActivityJobs()">Refresh</button>
      </div>
    </div>

    <div class="content-card">
      <div class="filter-bar" style="margin-bottom: 2rem; display: flex; gap: 1rem; border-bottom: 1px solid var(--border-color); padding-bottom: 1rem;">
        <span class="filter-tab active" onclick="filterActivity('ALL', this)">All Jobs</span>
        <span class="filter-tab" onclick="filterActivity('RUNNING', this)">Running</span>
        <span class="filter-tab" onclick="filterActivity('COMPLETED', this)">Completed</span>
        <span class="filter-tab" onclick="filterActivity('FAILED', this)">Failed</span>
      </div>

      <div style="overflow-x: auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Service</th>
              <th>Status</th>
              <th>Started At</th>
              <th>Finished At</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="activityTableBody">
            <tr><td colspan="6" style="text-align:center; padding: 2rem;">Loading activity log...</td></tr>
          </tbody>
        </table>
      </div>
      <div id="activityLoadMoreContainer" style="text-align: center; margin-top: 1.5rem; display: none;">
        <button class="btn btn-outline" onclick="loadMoreActivity()" id="btnLoadMoreActivity">Load More History</button>
      </div>
    </div>
  `;

  activityOffset = 0;
  hasMoreActivity = true;
  fetchActivityJobs(false);
  if (jobsPollingInterval) clearInterval(jobsPollingInterval);
  jobsPollingInterval = setInterval(() => fetchActivityJobs(true), 3000);
}

function renderRestoreView(container) {
  container.innerHTML = `
    <div class="dashboard-header">
      <div>
        <h1 class="page-title">Recovery Center</h1>
        <p class="page-subtitle">Restore your archived data back to Google services.</p>
      </div>
    </div>

    <div class="content-card">
      <div class="card-header">
        <h3>Available Backups</h3>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Backup ID</th>
            <th>Source Service</th>
            <th>Archive Date</th>
            <th>Status</th>
            <th>Recovery</th>
          </tr>
        </thead>
        <tbody id="restoreTableBody">
          <tr><td colspan="5" style="text-align:center; padding: 3rem; color: var(--text-muted);">Scanning for completed backups...</td></tr>
        </tbody>
      </table>
    </div>
  `;
  
  fetchRestoreJobs();
}

async function fetchRestoreJobs() {
  const tbody = document.getElementById('restoreTableBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_BASE}/jobs/?limit=50`);
    if (res.ok) {
      const allJobs = await res.json();
      const completedBackups = allJobs.filter(j => 
        j.status === 'COMPLETED' && (j.job_type === 'GDRIVE' || j.job_type === 'GMAIL')
      );

      if (completedBackups.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 3rem; color: var(--text-muted);">No completed backups found. Run a backup first to enable recovery.</td></tr>`;
        return;
      }

      tbody.innerHTML = completedBackups.map(job => {
        const date = new Date(job.completed_at || job.created_at).toLocaleString();
        const icon = job.job_type === 'GMAIL' ? '📧' : '☁️';
        return `
          <tr>
            <td><div class="font-bold">#${job.id}</div></td>
            <td>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <div class="service-icon">${icon}</div>
                <span>${job.job_type}</span>
              </div>
            </td>
            <td><span class="text-muted">${date}</span></td>
            <td><span class="status-pill completed">READY</span></td>
            <td>
              <button class="btn btn-primary" style="padding: 0.5rem 1rem; font-size: 0.8rem;" onclick="startRestore(${job.id}, '${job.job_type}')">
                <i class="ri-restart-line"></i> Restore to ${job.job_type === 'GMAIL' ? 'Gmail' : 'Drive'}
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 2rem; color: var(--error-color);">Error loading backups. <a href="#" onclick="fetchRestoreJobs()">Retry</a></td></tr>`;
  }
}

window.startRestore = async function(jobId, type) {
  if (!confirm(`Are you sure you want to restore backup #${jobId} to your Google account? This will recreate the files/emails as they were at the time of backup.`)) {
    return;
  }

  const accountId = getSelectedAccountId();
  if (!accountId) {
    alert("Please select an account first.");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/jobs/${jobId}/restore?account_id=${accountId}`, { method: 'POST' });
    if (res.ok) {
      showTab('activity');
    } else {
      const err = await res.json();
      alert(`Restore failed: ${err.detail || 'Unknown error'}`);
    }
  } catch (e) {
    alert("Connection error while starting restoration.");
  }
}

let currentActivityFilter = 'ALL';
let activityOffset = 0;
let hasMoreActivity = true;
let isFetchingActivity = false;

window.filterActivity = function(status, el) {
  currentActivityFilter = status;
  activityOffset = 0;
  hasMoreActivity = true;
  document.querySelectorAll('.filter-tab').forEach(tab => tab.classList.remove('active'));
  el.classList.add('active');
  fetchActivityJobs(false);
}

window.loadMoreActivity = function() {
  if (isFetchingActivity || !hasMoreActivity) return;
  activityOffset += 20;
  fetchActivityJobs(false, true);
}

async function fetchActivityJobs(isPolling = false, isLoadMore = false) {
  const tbody = document.getElementById('activityTableBody');
  if (!tbody) return;
  
  // Prevent stacking requests
  if (isFetchingActivity) {
    console.log("Activity fetch already in progress, skipping...");
    return;
  }

  isFetchingActivity = true;
  
  try {
    const limit = isLoadMore ? 20 : (activityOffset + 20);
    const offset = isLoadMore ? activityOffset : 0;
    
    let url = `${API_BASE}/jobs/?limit=${limit}&offset=${offset}`;
    const response = await fetch(url);
    
    if (response.ok) {
      let jobsData = await response.json();
      
      if (currentActivityFilter !== 'ALL') {
        jobsData = jobsData.filter(j => j.status === currentActivityFilter);
      }

      if (!isLoadMore && jobsData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 3rem; color: var(--text-secondary);">No ${currentActivityFilter === 'ALL' ? '' : currentActivityFilter.toLowerCase()} jobs found.</td></tr>`;
        document.getElementById('activityLoadMoreContainer').style.display = 'none';
        return;
      }

      const rowsHtml = jobsData.map(job => {
        const timeStarted = new Date(job.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
        const timeFinished = job.completed_at ? new Date(job.completed_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'In Progress...';
        const typeIcon = job.job_type === 'GMAIL' ? '📧' : '☁️';
        
        return `
          <tr>
            <td><div class="font-bold">#${job.id}</div></td>
            <td>
               <div style="display: flex; align-items: center; gap: 0.5rem;">
                 <div class="service-icon">${typeIcon}</div>
                 <span>${job.job_type}</span>
               </div>
            </td>
            <td><span class="status-pill ${job.status.toLowerCase()}">${job.status}</span></td>
            <td><span class="text-muted">${timeStarted}</span></td>
            <td><span class="text-muted">${timeFinished}</span></td>
            <td>
              <div class="action-menu" onclick="event.stopPropagation(); toggleDropdown(${job.id})">
                <button class="action-btn">⋮</button>
                 <div class="dropdown-content" id="dropdown-${job.id}">
                    ${job.status === 'COMPLETED' ? `
                      <button class="dropdown-item" onclick="startRestore(${job.id}, '${job.job_type}')">
                        <i class="ri-restart-line"></i> Restore Data
                      </button>
                      <button class="dropdown-item text-danger" onclick="expireBackup(${job.id})">
                        <i class="ri-delete-bin-line"></i> Permanently Delete
                      </button>
                    ` : '<span class="dropdown-item disabled">In Progress...</span>'}
                 </div>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      if (isLoadMore) {
        tbody.innerHTML += rowsHtml;
      } else {
        tbody.innerHTML = rowsHtml;
      }

      hasMoreActivity = jobsData.length === limit;
      const loadMoreBtn = document.getElementById('activityLoadMoreContainer');
      if (loadMoreBtn) loadMoreBtn.style.display = hasMoreActivity ? 'block' : 'none';

    } else {
      console.error("Activity API error:", response.status);
      if (!isPolling && !isLoadMore) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--error-color);">Failed to load activity (Error ${response.status}). <a href="#" onclick="fetchActivityJobs()">Retry</a></td></tr>`;
      }
    }
  } catch (e) {
    console.error("Activity fetch exception:", e);
    if (!isPolling && !isLoadMore) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--error-color);">Connection error. Please check if the server is running. <a href="#" onclick="fetchActivityJobs()">Retry</a></td></tr>`;
    }
  } finally {
    isFetchingActivity = false;
  }
}

function renderUsageView(container) {
  if (jobsPollingInterval) clearInterval(jobsPollingInterval);
  
  container.innerHTML = `
    <div class="dashboard-header">
      <div>
        <h1 class="page-title">Storage Analytics</h1>
        <p class="page-subtitle">Monitor the growth of your local data fortress.</p>
      </div>
    </div>

    <div class="content-card">
      <div class="card-header">
        <h3>Protection History</h3>
        <div class="text-muted" style="font-size: 0.8rem;">Local storage usage over time (MB)</div>
      </div>
      <div style="height: 400px; position: relative; width: 100%;">
        <canvas id="usageChart"></canvas>
      </div>
    </div>
  `;
  
  setTimeout(loadUsageGraph, 0);
}

async function loadUsageGraph() {
  const canvas = document.getElementById('usageChart');
  if (!canvas) return;

  try {
    const res = await fetch(`${API_BASE}/usage/`);
    if (res.ok) {
      const data = await res.json();
      
      if (data.length === 0) {
        canvas.parentElement.innerHTML = '<div style="height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-muted);">No usage data recorded yet.</div>';
        return;
      }

      const labels = data.map(d => {
        const date = new Date(d.date + "T00:00:00");
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      });
      const values = data.map(d => d.mb);
      
      const styles = getComputedStyle(document.documentElement);
      const gridColor = 'rgba(0,0,0,0.05)';
      const textColor = styles.getPropertyValue('--text-secondary').trim() || '#64748b';
      const accentGreen = '#10B981';

      if (usageChartInstance) {
        usageChartInstance.destroy();
      }

      usageChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Total Usage (MB)',
            data: values,
            borderColor: accentGreen,
            backgroundColor: 'rgba(20, 83, 45, 0.08)',
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: accentGreen,
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { 
            legend: { 
              display: false 
            },
            tooltip: {
              backgroundColor: '#1e293b',
              padding: 12,
              titleFont: { family: 'Inter', size: 13 },
              bodyFont: { family: 'Inter', size: 13 },
              callbacks: {
                label: (context) => ` ${context.parsed.y} MB`
              }
            }
          },
          scales: {
            y: { 
              beginAtZero: true, 
              grid: { color: gridColor, drawBorder: false }, 
              ticks: { 
                color: textColor,
                font: { family: 'Inter', size: 11 },
                callback: (value) => value + ' MB'
              } 
            },
            x: { 
              grid: { display: false }, 
              ticks: { 
                color: textColor,
                font: { family: 'Inter', size: 11 }
              } 
            }
          }
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
          <h2 style="margin: 0; font-size: 1.5rem; font-family: 'Outfit';">Browse Google Drive</h2>
          <button class="btn btn-outline" style="padding: 0.5rem 1rem;" onclick="document.getElementById('driveBrowserModal').classList.remove('active')">✕</button>
        </div>
        <div class="modal-body">
          <div class="breadcrumb" id="driveBreadcrumbs" style="margin-bottom: 1.5rem; background: #f1f5f9; padding: 0.75rem 1rem; border-radius: 12px; font-weight: 600;"></div>
          <div id="driveFilesList">Loading files...</div>
        </div>
        <div class="modal-footer">
          <span style="color: var(--text-secondary); font-weight: 600;" id="selectionCount">0 items selected</span>
          <button class="btn btn-primary" id="confirmDriveBackupBtn">Start Sync Now</button>
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
          <h2 style="margin: 0; font-size: 1.5rem; font-family: 'Outfit';">Search Gmail</h2>
          <button class="btn btn-outline" style="padding: 0.5rem 1rem;" onclick="document.getElementById('gmailBrowserModal').classList.remove('active')">✕</button>
        </div>
        <div style="padding: 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; gap: 1rem; background: #f8fafc;">
          <input type="text" id="gmailFilterInput" placeholder="Filter by label (e.g. INBOX, important)" style="flex: 1; margin: 0; background: white; border: 1.5px solid var(--border-color); border-radius: 12px; padding: 0.75rem 1rem; font-family: inherit;" />
          <button class="btn btn-primary" id="applyGmailFilterBtn">Search</button>
        </div>
        <div class="modal-body" style="padding: 0;">
          <div id="gmailMessagesList" style="padding: 1rem;">Loading emails...</div>
        </div>
        <div class="modal-footer">
          <span style="color: var(--text-secondary); font-weight: 600;" id="gmailSelectionCount">0 emails selected</span>
          <button class="btn btn-primary" id="confirmGmailBackupBtn">Start Sync Now</button>
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
      div.className = `file-row ${isSelected ? 'selected' : ''}`;
      div.innerHTML = `
        <div class="checkbox-container">
          ${isSelected ? '<span class="check-mark">✓</span>' : ''}
        </div>
        <div class="file-info" style="flex:1; overflow:hidden; min-width: 0;">
          <div style="font-weight: 600; text-overflow: ellipsis; white-space: nowrap; overflow: hidden; margin-bottom: 0.2rem;">${msg.subject}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted); text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">From: ${msg.from}</div>
        </div>
        <div style="font-size: 0.75rem; color: var(--text-muted); white-space: nowrap; margin-left: 1rem; font-weight: 600;">
          ${msg.date ? new Date(msg.date).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}
        </div>
      `;
      
      div.addEventListener('click', (e) => {
        toggleGmailSelection(msg.id, div);
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

function toggleGmailSelection(fileId, itemDiv) {
  const checkbox = itemDiv.querySelector('.checkbox-container');
  if (selectedGmailIds.has(fileId)) {
    selectedGmailIds.delete(fileId);
    itemDiv.classList.remove('selected');
    checkbox.innerHTML = '';
  } else {
    selectedGmailIds.add(fileId);
    itemDiv.classList.add('selected');
    checkbox.innerHTML = '<span class="check-mark">✓</span>';
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
      div.className = `file-row ${isSelected ? 'selected' : ''}`;
      div.innerHTML = `
        <div class="checkbox-container">
          ${isSelected ? '<span class="check-mark">✓</span>' : ''}
        </div>
        <div class="service-icon" style="width: 32px; height: 32px; font-size: 1rem; border-radius: 8px;">${icon}</div>
        <div class="file-name">${file.name}</div>
      `;
      
      // Checkbox specific click
      div.querySelector('.checkbox-container').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSelection(file.id, div);
      });

      // Row click
      div.addEventListener('click', () => {
        if (isFolder) {
          currentDrivePath.push({ id: file.id, name: file.name });
          loadDriveFolder(file.id);
        } else {
          toggleSelection(file.id, div);
        }
      });
      
      listContainer.appendChild(div);
    });
    
    currentNextPageToken = data.nextPageToken;
    if (currentNextPageToken) {
      const loadBtn = document.createElement('div');
      loadBtn.id = 'loadMoreBtn';
      loadBtn.className = 'load-more-btn';
      loadBtn.innerText = 'Load More Files...';
      loadBtn.onclick = () => loadDriveFolder(folderId, true);
      listContainer.appendChild(loadBtn);
    }
    
  } catch (err) {
    if (!loadMore) listContainer.innerHTML = `<div style="color:#f85149; padding:1rem;">Error: ${err.message}</div>`;
  }
}

function toggleSelection(fileId, itemDiv) {
  const checkbox = itemDiv.querySelector('.checkbox-container');
  if (selectedDriveFiles.has(fileId)) {
    selectedDriveFiles.delete(fileId);
    itemDiv.classList.remove('selected');
    checkbox.innerHTML = '';
  } else {
    selectedDriveFiles.add(fileId);
    itemDiv.classList.add('selected');
    checkbox.innerHTML = '<span class="check-mark">✓</span>';
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

window.openPolicyModal = function() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'policyModal';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 850px; height: 600px;">
      <div class="modal-header">
        <h2>Create Backup Policy</h2>
        <button class="close-btn" onclick="closePolicyModal()">×</button>
      </div>
      <div style="display: flex; height: calc(100% - 70px);">
        <!-- Configuration Side -->
        <div style="flex: 0 0 320px; padding: 1.5rem; border-right: 1px solid var(--border-color); display: flex; flex-direction: column;">
          <div class="form-group">
            <label>Policy Name</label>
            <input type="text" id="policyName" placeholder="e.g. Daily Gmail Backup" class="form-input" style="width: 100%;">
          </div>
          
          <div class="form-group">
            <label>Service Type</label>
            <select id="policyType" class="form-input" onchange="togglePolicySelectionUI()" style="width: 100%; background: white;">
              <option value="GMAIL">Gmail Protection</option>
              <option value="GDRIVE">Google Drive</option>
            </select>
          </div>

          <div style="display: flex; gap: 1rem;">
            <div class="form-group" style="flex: 1;">
              <label>Frequency</label>
              <select id="policyFrequency" class="form-input" style="width: 100%; background: white;">
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            </div>
            <div class="form-group" style="flex: 1;">
              <label>Start Time</label>
              <input type="time" id="policyTime" value="02:00" class="form-input" style="width: 100%;">
            </div>
          </div>

          <div style="margin-top: auto; display: flex; flex-direction: column; gap: 0.75rem;">
            <button class="btn btn-primary" style="width: 100%; justify-content: center; height: 45px;" onclick="savePolicy()">Save Policy</button>
            <button class="btn btn-outline" style="width: 100%; justify-content: center; height: 45px;" onclick="closePolicyModal()">Cancel</button>
          </div>
        </div>

        <!-- Selection Side -->
        <div style="flex: 1; display: flex; flex-direction: column; background: #fbfbfb;">
           <div id="policySelectionUI" style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
              <!-- Dynamic Browser UI -->
           </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  setTimeout(() => {
    modal.classList.add('active');
    togglePolicySelectionUI();
  }, 10);
}

window.togglePolicySelectionUI = function() {
  const type = document.getElementById('policyType').value;
  const container = document.getElementById('policySelectionUI');
  
  if (type === 'GDRIVE') {
    container.innerHTML = `
      <div class="modal-header" style="background: white; border-bottom: 1px solid var(--border-color); padding: 0.75rem 1.25rem;">
        <div id="driveBreadcrumbs" class="breadcrumbs" style="font-size: 0.8rem;"></div>
        <div id="driveSelectionCount" style="font-size: 0.8rem; color: var(--accent-primary); font-weight: 600;">0 selected</div>
      </div>
      <div id="driveFilesList" style="flex: 1; overflow-y: auto; padding: 0.5rem;"></div>
    `;
    selectedDriveFiles.clear();
    currentDrivePath = [{ id: 'root', name: 'My Drive' }];
    loadDriveFolder('root');
  } else {
    container.innerHTML = `
      <div class="modal-header" style="background: white; border-bottom: 1px solid var(--border-color); padding: 0.75rem 1.25rem; display: flex; flex-direction: column; gap: 0.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <div class="font-bold" style="font-size: 0.85rem;">Select Filters</div>
          <div id="gmailSelectionCount" style="font-size: 0.8rem; color: var(--accent-primary); font-weight: 600;">0 selected</div>
        </div>
        <div class="search-container" style="width: 100%;">
          <i class="ri-search-line search-icon"></i>
          <input type="text" id="gmailFilterInput" class="search-input" placeholder="Search emails..." style="background: #f1f5f9; border: none; font-size: 0.8rem; padding: 0.6rem 1rem 0.6rem 2.75rem;">
          <button class="btn btn-primary" id="applyGmailFilterBtn" style="position: absolute; right: 4px; top: 4px; padding: 0.25rem 0.75rem; font-size: 0.7rem;">Filter</button>
        </div>
      </div>
      <div id="gmailMessagesList" style="flex: 1; overflow-y: auto; padding: 0.5rem;"></div>
    `;
    selectedGmailIds.clear();
    currentGmailQuery = "";
    loadGmailMessages("", false);
    
    document.getElementById('applyGmailFilterBtn').addEventListener('click', () => {
      currentGmailQuery = document.getElementById('gmailFilterInput').value;
      loadGmailMessages(currentGmailQuery, false);
    });
  }
}

window.closePolicyModal = function() {
  const modal = document.getElementById('policyModal');
  if (modal) modal.remove();
}

window.savePolicy = async function() {
  const name = document.getElementById('policyName').value;
  const type = document.getElementById('policyType').value;
  const frequency = document.getElementById('policyFrequency').value;
  const startTime = document.getElementById('policyTime').value;
  
  const selection = type === 'GDRIVE' ? Array.from(selectedDriveFiles) : Array.from(selectedGmailIds);

  if (!name) return alert("Please enter a policy name.");

  try {
    const res = await fetch(`${API_BASE}/policies/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: parseInt(accountId),
        name,
        job_type: type,
        frequency,
        start_time: startTime,
        selected_ids: selection.length > 0 ? selection : null,
        is_active: 1
      })
    });
    
    if (res.ok) {
      closePolicyModal();
      fetchPolicies();
    } else {
      const err = await res.json();
      alert("Failed to save policy: " + (err.detail || "Unknown error"));
    }
  } catch (e) {
    alert("Error: " + e.message);
  }
}

window.fetchPolicies = async function() {
  const tbody = document.getElementById('policyTableBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_BASE}/policies/?account_id=${accountId}`);
    if (res.ok) {
      const data = await res.json();
      if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--text-muted);">No automated policies found.</td></tr>';
        return;
      }

      tbody.innerHTML = data.map(p => {
        const lastRun = p.last_run ? new Date(p.last_run).toLocaleString() : 'Never';
        const typeIcon = p.job_type === 'GMAIL' ? '📧' : '☁️';
        return `
          <tr>
            <td><div class="font-bold">${p.name}</div></td>
            <td>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span>${typeIcon}</span>
                <span>${p.job_type}</span>
              </div>
            </td>
            <td><span class="status-pill completed">${p.frequency}</span></td>
            <td><code>${p.start_time}</code></td>
            <td><span class="text-muted">${lastRun}</span></td>
            <td>
              <button class="action-btn" style="color: var(--error-color);" onclick="deletePolicy(${p.id})">
                <i class="ri-delete-bin-line"></i>
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--error-color);">Failed to load policies.</td></tr>';
  }
}

window.deletePolicy = async function(id) {
  if (!confirm("Are you sure you want to delete this automated policy?")) return;
  
  try {
    const res = await fetch(`${API_BASE}/policies/${id}`, { method: 'DELETE' });
    if (res.ok) {
      fetchPolicies();
    }
  } catch (e) {
    alert("Error: " + e.message);
  }
}
