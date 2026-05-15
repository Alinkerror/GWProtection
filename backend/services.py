import os
import json
import base64
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaFileUpload, MediaIoBaseUpload
import aiofiles
import io

SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
    'openid'
]

def get_client_config(redirect_uri: str = "http://localhost:5173"):
    client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip().strip('"').strip("'")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "").strip().strip('"').strip("'")
    
    return {
        "web": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [redirect_uri, redirect_uri + "/"]
        }
    }

_auth_flows = {}

def get_auth_url(redirect_uri: str):
    flow = Flow.from_client_config(
        get_client_config(redirect_uri),
        scopes=SCOPES,
        redirect_uri=redirect_uri
    )
    # Changed prompt to 'select_account' to avoid re-consenting every time
    auth_url, _ = flow.authorization_url(prompt='select_account', access_type='offline')
    _auth_flows['latest'] = flow
    return auth_url

def exchange_code(code: str, redirect_uri: str) -> str:
    flow = _auth_flows.get('latest')
    if not flow:
        flow = Flow.from_client_config(
            get_client_config(redirect_uri),
            scopes=SCOPES,
            redirect_uri=redirect_uri
        )
    flow.fetch_token(code=code)
    credentials = flow.credentials
    return credentials.to_json()

def build_creds(credentials_json: str):
    data = json.loads(credentials_json)
    return Credentials(
        token=data.get('token'),
        refresh_token=data.get('refresh_token'),
        token_uri=data.get('token_uri'),
        client_id=data.get('client_id'),
        client_secret=data.get('client_secret'),
        scopes=SCOPES
    )

def refresh_credentials(credentials_json: str):
    """Refreshes credentials if expired and returns (creds, new_creds_json)"""
    creds = build_creds(credentials_json)
    from google.auth.transport.requests import Request
    
    new_creds_json = None
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            new_creds_json = creds.to_json()
        else:
            raise Exception("Credentials expired and no refresh token available. Please login again.")
            
    return creds, new_creds_json

def get_user_info(credentials_json: str):
    creds, new_creds = refresh_credentials(credentials_json)
    service = build('oauth2', 'v2', credentials=creds)
    user_info = service.userinfo().get().execute()
    return user_info, new_creds

def list_gdrive_files(credentials_json: str, parent_id: str = "root", page_token: str = None):
    creds, new_creds = refresh_credentials(credentials_json)
    service = build('drive', 'v3', credentials=creds)
    
    query = f"'{parent_id}' in parents and trashed=false"
    results = service.files().list(
        q=query,
        pageSize=100,
        fields="nextPageToken, files(id, name, mimeType)",
        pageToken=page_token
    ).execute()
    
    return results, new_creds

async def backup_gdrive(credentials_json: str, destination_dir: str, selected_ids: list = None):
    creds, _ = refresh_credentials(credentials_json)
    service = build('drive', 'v3', credentials=creds)
    
    async def download_item(item_id, item_name, item_mime, current_dir):
        if item_mime == 'application/vnd.google-apps.folder':
            folder_dir = os.path.join(current_dir, item_name)
            os.makedirs(folder_dir, exist_ok=True)
            page_token = None
            while True:
                results = service.files().list(
                    q=f"'{item_id}' in parents and trashed=false",
                    fields="nextPageToken, files(id, name, mimeType)",
                    pageToken=page_token
                ).execute()
                for child in results.get('files', []):
                    await download_item(child['id'], child['name'], child['mimeType'], folder_dir)
                page_token = results.get('nextPageToken')
                if not page_token:
                    break
        else:
            try:
                request = None
                file_path = os.path.join(current_dir, item_name)
                
                if item_mime == 'application/vnd.google-apps.document':
                    request = service.files().export_media(fileId=item_id, mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document')
                    file_path += ".docx"
                elif item_mime == 'application/vnd.google-apps.spreadsheet':
                    request = service.files().export_media(fileId=item_id, mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                    file_path += ".xlsx"
                elif item_mime == 'application/vnd.google-apps.presentation':
                    request = service.files().export_media(fileId=item_id, mimeType='application/vnd.openxmlformats-officedocument.presentationml.presentation')
                    file_path += ".pptx"
                elif item_mime.startswith('application/vnd.google-apps'):
                    return # skip other google suite formats
                else:
                    request = service.files().get_media(fileId=item_id)
                
                if request:
                    os.makedirs(os.path.dirname(file_path), exist_ok=True)
                    with open(file_path, 'wb') as fh:
                        downloader = MediaIoBaseDownload(fh, request)
                        done = False
                        while done is False:
                            status, done = downloader.next_chunk()
            except Exception as e:
                pass # log errors gracefully

    os.makedirs(destination_dir, exist_ok=True)
    items_to_process = []
    
    if selected_ids:
        for t_id in selected_ids:
            try:
                meta = service.files().get(fileId=t_id, fields="id, name, mimeType").execute()
                items_to_process.append(meta)
            except Exception:
                pass
    else:
        page_token = None
        while True:
            results = service.files().list(
                q="'root' in parents and trashed=false",
                fields="nextPageToken, files(id, name, mimeType)",
                pageToken=page_token
            ).execute()
            items_to_process.extend(results.get('files', []))
            page_token = results.get('nextPageToken')
            if not page_token:
                break
                
    new_creds_json = creds.to_json() if creds.valid else None

    for item in items_to_process:
        await download_item(item['id'], item['name'], item['mimeType'], destination_dir)
        
    return f"Backed up structure to {destination_dir}", new_creds_json

def list_gmail_messages(credentials_json: str, query_str: str = None, page_token: str = None):
    creds, new_creds = refresh_credentials(credentials_json)
    service = build('gmail', 'v1', credentials=creds)
    
    q = query_str if query_str else ""
        
    results = service.users().messages().list(
        userId='me',
        q=q,
        maxResults=30,
        pageToken=page_token
    ).execute()
    
    messages = results.get('messages', [])
    next_page_token = results.get('nextPageToken')
    
    hydrated_messages = [None] * len(messages)
    
    def callback(request_id, response, exception):
        if exception is not None:
            print(f"Gmail hydration error for ID {request_id}: {exception}")
            return
        
        idx = int(request_id)
        headers = response.get('payload', {}).get('headers', [])
        subject = next((h['value'] for h in headers if h['name'] == 'Subject'), '(No Subject)')
        sender = next((h['value'] for h in headers if h['name'] == 'From'), '(Unknown)')
        date = next((h['value'] for h in headers if h['name'] == 'Date'), '')
        
        hydrated_messages[idx] = {
            'id': response['id'],
            'threadId': response['threadId'],
            'subject': subject,
            'from': sender,
            'date': date
        }

    batch = service.new_batch_http_request(callback=callback)
    for i, msg in enumerate(messages):
        batch.add(service.users().messages().get(
            userId='me', 
            id=msg['id'], 
            format='metadata',
            metadataHeaders=['Subject', 'From', 'Date']
        ), request_id=str(i))
    
    batch.execute()
            
    return {"messages": [m for m in hydrated_messages if m is not None], "nextPageToken": next_page_token}, new_creds

def get_gmail_labels(credentials_json: str):
    creds, new_creds = refresh_credentials(credentials_json)
    service = build('gmail', 'v1', credentials=creds)
    results = service.users().labels().list(userId='me').execute()
    labels = results.get('labels', [])
    
    # Filter for useful labels (System and User)
    return [{"id": l['id'], "name": l['name'], "type": l['type']} for l in labels], new_creds

async def backup_gmail(credentials_json: str, destination_dir: str, selected_ids: list = None, query: str = None, on_progress: callable = None):
    creds, _ = refresh_credentials(credentials_json)
    service = build('gmail', 'v1', credentials=creds)
    
    ids_to_backup = selected_ids or []
    
    if query:
        # If a query is provided, search for messages first
        results = service.users().messages().list(userId='me', q=query, maxResults=500).execute()
        messages = results.get('messages', [])
        ids_to_backup = [m['id'] for m in messages]
        
    if not ids_to_backup:
        return 0

    if on_progress:
        on_progress(total=len(ids_to_backup))

    os.makedirs(destination_dir, exist_ok=True)
    count = 0
    
    import base64
    for msg_id in ids_to_backup:
        try:
            msg = service.users().messages().get(userId='me', id=msg_id, format='raw').execute()
            msg_bytes = base64.urlsafe_b64decode(msg['raw'].encode('ASCII'))
            
            with open(os.path.join(destination_dir, f"{msg_id}.eml"), 'wb') as f:
                f.write(msg_bytes)
            count += 1
            if on_progress:
                on_progress(current=count)
        except Exception:
            pass
            
    return count

async def backup_gdrive(credentials_json: str, destination_dir: str, selected_ids: list = None, on_progress: callable = None):
    creds = build_creds(credentials_json)
    service = build('drive', 'v3', credentials=creds)
    
    if not selected_ids:
        return 0

    if on_progress:
        on_progress(total=len(selected_ids))

    os.makedirs(destination_dir, exist_ok=True)
    count = 0
    
    for file_id in selected_ids:
        try:
            file_meta = service.files().get(fileId=file_id).execute()
            request = service.files().get_media(fileId=file_id)
            
            file_path = os.path.join(destination_dir, file_meta['name'])
            with open(file_path, 'wb') as f:
                f.write(request.execute())
            count += 1
            if on_progress:
                on_progress(current=count)
        except Exception:
            pass
            
    return count
async def restore_gdrive(credentials_json: str, source_dir: str):
    creds = build_creds(credentials_json)
    from google.auth.transport.requests import Request
    if not creds.valid and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    
    service = build('drive', 'v3', credentials=creds)
    
    # Create root restore folder
    folder_name = f"[Restored] {os.path.basename(source_dir)}"
    file_metadata = {'name': folder_name, 'mimeType': 'application/vnd.google-apps.folder'}
    root_folder = service.files().create(body=file_metadata, fields='id').execute()
    root_id = root_folder.get('id')

    async def upload_recursive(local_path, drive_parent_id):
        for item in os.listdir(local_path):
            full_path = os.path.join(local_path, item)
            if os.path.isdir(full_path):
                # Create folder on drive
                meta = {'name': item, 'mimeType': 'application/vnd.google-apps.folder', 'parents': [drive_parent_id]}
                folder = service.files().create(body=meta, fields='id').execute()
                await upload_recursive(full_path, folder.get('id'))
            else:
                # Upload file
                meta = {'name': item, 'parents': [drive_parent_id]}
                media = MediaFileUpload(full_path, resumable=True)
                service.files().create(body=meta, media_body=media, fields='id').execute()

    await upload_recursive(source_dir, root_id)
    return f"Restored all files to Google Drive folder: {folder_name}", creds.to_json()

async def restore_gmail(credentials_json: str, source_dir: str):
    creds = build_creds(credentials_json)
    from google.auth.transport.requests import Request
    if not creds.valid and creds.expired and creds.refresh_token:
        creds.refresh(Request())
        
    service = build('gmail', 'v1', credentials=creds)
    
    count = 0
    for filename in os.listdir(source_dir):
        if filename.endswith(".eml"):
            file_path = os.path.join(source_dir, filename)
            with open(file_path, 'rb') as f:
                raw_content = f.read()
                # Gmail insert API expects a media body for raw RFC822 content
                media = MediaIoBaseUpload(io.BytesIO(raw_content), mimetype='message/rfc822')
                service.users().messages().insert(userId='me', body={'labelIds': ['INBOX']}, media_body=media).execute()
                count += 1
                
    return f"Restored {count} emails to your Inbox.", creds.to_json()
