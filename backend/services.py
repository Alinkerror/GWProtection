import os
import json
import base64
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
import aiofiles

SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/drive.readonly'
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
    auth_url, _ = flow.authorization_url(prompt='consent', access_type='offline')
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

def list_gdrive_files(credentials_json: str, parent_id: str = "root", page_token: str = None):
    creds = Credentials.from_authorized_user_info(json.loads(credentials_json), SCOPES)
    service = build('drive', 'v3', credentials=creds)
    
    query = f"'{parent_id}' in parents and trashed=false"
    results = service.files().list(
        q=query,
        pageSize=100,
        fields="nextPageToken, files(id, name, mimeType)",
        pageToken=page_token
    ).execute()
    return results

async def backup_gdrive(credentials_json: str, destination_dir: str, selected_ids: list = None):
    creds = Credentials.from_authorized_user_info(json.loads(credentials_json), SCOPES)
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
                
    for item in items_to_process:
        await download_item(item['id'], item['name'], item['mimeType'], destination_dir)
        
    return f"Backed up structure to {destination_dir}"

def list_gmail_messages(credentials_json: str, query_str: str = None, page_token: str = None):
    creds = Credentials.from_authorized_user_info(json.loads(credentials_json), SCOPES)
    service = build('gmail', 'v1', credentials=creds)
    
    q = ""
    if query_str:
        q = f"label:{query_str}"
        
    results = service.users().messages().list(
        userId='me',
        q=q,
        maxResults=25,
        pageToken=page_token
    ).execute()
    
    messages = results.get('messages', [])
    next_page_token = results.get('nextPageToken')
    
    hydrated_messages = []
    for msg in messages:
        try:
            msg_full = service.users().messages().get(
                userId='me', 
                id=msg['id'], 
                format='metadata',
                metadataHeaders=['Subject', 'From', 'Date']
            ).execute()
            
            headers = msg_full.get('payload', {}).get('headers', [])
            subject = next((h['value'] for h in headers if h['name'] == 'Subject'), '(No Subject)')
            sender = next((h['value'] for h in headers if h['name'] == 'From'), '(Unknown)')
            date = next((h['value'] for h in headers if h['name'] == 'Date'), '')
            
            hydrated_messages.append({
                'id': msg['id'],
                'threadId': msg['threadId'],
                'subject': subject,
                'from': sender,
                'date': date
            })
        except Exception:
            pass
            
    return {"messages": hydrated_messages, "nextPageToken": next_page_token}

async def backup_gmail(credentials_json: str, destination_dir: str, selected_ids: list = None):
    creds = Credentials.from_authorized_user_info(json.loads(credentials_json), SCOPES)
    service = build('gmail', 'v1', credentials=creds)
    
    os.makedirs(destination_dir, exist_ok=True)
    
    async def download_email(msg_id):
        try:
            msg_raw = service.users().messages().get(userId='me', id=msg_id, format='raw').execute()
            msg_bytes = base64.urlsafe_b64decode(msg_raw['raw'].encode('ASCII'))
            
            file_path = os.path.join(destination_dir, f"{msg_id}.eml")
            async with aiofiles.open(file_path, "wb") as f:
                await f.write(msg_bytes)
        except Exception:
            pass
            
    items_to_process = []
    
    if selected_ids:
        items_to_process = selected_ids
    else:
        page_token = None
        while True:
            results = service.users().messages().list(userId='me', pageToken=page_token).execute()
            for msg in results.get('messages', []):
                items_to_process.append(msg['id'])
            page_token = results.get('nextPageToken')
            if not page_token:
                break
                
    for msg_id in items_to_process:
        await download_email(msg_id)
        
    return f"Backed up {len(items_to_process)} emails structure to {destination_dir}"
