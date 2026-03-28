# Google Workspace Protection (GWP)

A premium, locally-hosted web application designed to securely backup and protect your Google Workspace data (Gmail and Google Drive) directly to your local machine.

## Architecture

This project is built using a modern separation-of-concerns architecture:

*   **Frontend**: A Vanilla JavaScript Single Page Application (SPA) scaffolded with Vite. It features a rich, dark-mode glassmorphism UI for interacting with Google APIs effortlessly.
*   **Backend**: A fast, asynchronous Python API built with `FastAPI`.
*   **Database**: A local `SQLite` database managed seamlessly through `SQLAlchemy` to track user profiles and backup job statuses.
*   **Authentication**: Secure Google OAuth 2.0 flow initiated locally using the `google-auth-oauthlib` library.

### Communication Flow

1.  **Authentication Handshake**:
    *   The frontend requests an OAuth consent URL from the backend.
    *   The user is redirected to Google, and upon grant, Google bounces the user back to the SPA with a security `code`.
    *   The frontend exchanges this `code` with the backend via a `POST /auth/exchange` request.
    *   The backend validates the token via Google's OAuth endpoints, securely stores the refreshed credentials inside SQLite, and assigns an `account_id` to the frontend `localStorage`.

2.  **File Browsing (Lazy Loading)**:
    *   When browsing Google Drive or Gmail, the frontend queries `GET /gdrive/files/` or `GET /gmail/messages/` endpoints.
    *   The backend retrieves up to 100 GDrive metadata files or 25 hydrated Gmail metadata headers at a time from the Google APIs.
    *   Pagination (`nextPageToken`) is passed back to the frontend to allow infinite scrolling.

3.  **Backup Trigger**:
    *   The user selects specific files or emails using checkboxes on the frontend UI and hits "Backup Now".
    *   The frontend makes a `POST /jobs/` request holding exactly which IDs to fetch.
    *   FastAPI intercepts the request and offloads the deep recursive download task to a background thread (`BackgroundTasks`).
    *   The frontend polls `GET /jobs/` every 3 seconds to report the `RUNNING` or `COMPLETED` local status back to the user intuitively.

## Important Components

*   **`backend/main.py`**: The central router for the application. Evaluates CORS middleware, configures the SQLite dependency injection, and contains HTTP routes for job creation, status polling, and API proxying.
*   **`backend/services.py`**: The core business logic engine. It manages OAuth flows using PKCE states, retrieves hierarchical structures from Google Drive and Gmail via `google-api-python-client`, handles `.eml` raw base64 decoding, automatically converts Google Docs/Sheets into Microsoft Office readable formats (`.docx`, `.xlsx`), and iteratively recreates the user's authentic Google folder hierarchy natively onto their hard drive via `os.makedirs`.
*   **`backend/models.py` & `schemas.py`**: Defines the database schema structures (using SQLAlchemy primitives) and API payload validation classes (using Pydantic models).
*   **`frontend/src/main.js`**: The brains of the UI view logic. Handles asynchronous Fetch API polling, builds isolated components (like the GDrive and Gmail browser modals) directly into the DOM, parses OAuth parameter injection, and keeps track of internal Checkbox selection sets (`Set()`).

## Folder Structure

```text
GWP/
├── backend/
│   ├── .env                   # Local credentials (Google Client ID & Secret)
│   ├── main.py                # FastAPI Application and Routers
│   ├── services.py            # Backup processing and Google API wrappers
│   ├── models.py              # SQLite Database Schema Definitions
│   ├── schemas.py             # Pydantic data validation schemas
│   ├── database.py            # SQLAlchemy setup config
│   ├── requirements.txt       # Python Dependencies
│   └── backups/               # Target folder where actual .eml and Drive files land
└── frontend/
    ├── index.html             # The application markup entry point
    ├── vite.config.js         # Build tooling configuration
    ├── package.json           # Node configuration mapping
    ├── src/
    │   ├── main.js            # Frontend Routing, DOM manipulation, State Management
    │   └── style.css          # Premium Dark Mode Glassmorphism UI tokens
```

## Local Development Setup

### Backend
1. Place your Google Application web credentials into `backend/.env`.
2. Ensure you have installed your virtual environment packages (`pip install -r requirements.txt`).
3. Run `uvicorn main:app --reload` from within the `/backend` folder.

### Frontend
1. Run `npm install` from within `/frontend`.
2. Run `npm run dev` to start the live web server on `http://localhost:5173`.
