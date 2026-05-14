# Google Workspace Protection (GWP)

A premium, locally-hosted web application designed to securely backup and protect your Google Workspace data (Gmail and Google Drive) directly to your local machine.

## Architecture

This project is built using a modern separation-of-concerns architecture:

*   **Frontend**: A Vanilla JavaScript Single Page Application (SPA) featuring a persistent Sidebar App Shell. It features a rich, dark-mode glassmorphism UI using `Chart.js` for storage analytics.
*   **Backend**: A multi-threaded Python API built with `FastAPI` (using standard `def` background tasks for non-blocking I/O).
*   **Database**: A local `SQLite` database managed seamlessly through `SQLAlchemy` to track user profiles, unique backup job identifiers, and storage metadata.
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
    *   The frontend automatically navigates to the **Dashboard** and polls `GET /jobs/` every 3 seconds to report status.

4.  **Usage & Analytics**:
    *   Data sizes are calculated on-the-fly by the backend walking the local `backups/` directory.
    *   `GET /usage/` returns a chronological series of storage footprints (MB) rendered as a premium line graph on the frontend.

5.  **Job Expiration**:
    *   Users can "Expire" backups from the Dashboard action menu.
    *   `DELETE /jobs/{id}` triggers a recursive `shutil.rmtree` on the backend, purging physical files and database rows simultaneously.

## Important Components

*   **`backend/main.py`**: The central router for the application. Evaluates CORS middleware, configures the SQLite dependency injection, and contains HTTP routes for job creation, status polling, and API proxying. Now includes robust `DELETE` hooks for job expiration and `GET /usage` for analytics.
*   **`backend/services.py`**: The core business logic engine. It manages OAuth flows using PKCE states, retrieves hierarchical structures from Google Drive and Gmail via `google-api-python-client`.
*   **`backend/models.py` & `schemas.py`**: Defines the database schema structures (using SQLAlchemy primitives) and API payload validation classes (using Pydantic models). Upgraded for Pydantic V2 compatibility (`from_attributes`).
*   **`frontend/src/main.js`**: The brains of the UI view logic. Handles SPA routing for the Sidebar, Chart.js rendering for the Usage graph, and modal-based file browsing.

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

## Running the Application

### 🐳 Docker Setup (Recommended)
The easiest way to run the application is using Docker Compose. This runs both the frontend and backend in a single container on port **9500**.

1.  **Credentials**: Place your Google Application web credentials into `backend/.env`.
2.  **Launch**: From the root directory, run:
    ```bash
    docker-compose up --build
    ```
3.  **Access**: Open [http://localhost:9500](http://localhost:9500) in your browser.

---

### Local Development Setup (Manual)

If you prefer to run the components separately for development:

#### Backend
1. Ensure you have installed your virtual environment packages (`pip install -r requirements.txt`).
2. Run `uvicorn main:app --reload --port 9500` from within the `/backend` folder.

#### Frontend
1. Run `npm install` from within `/frontend`.
2. Run `npm run dev` to start the live web server.
   > **Note**: Since the application is now configured for a unified origin, you may need to update the `API_BASE` in `src/main.js` if running the frontend on a different port than the backend.
