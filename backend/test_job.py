import urllib.request
import json
req = urllib.request.Request(
    'http://127.0.0.1:8000/jobs/?account_id=1',
    data=json.dumps({"job_type": "GDRIVE"}).encode('utf-8'),
    headers={'Content-Type': 'application/json'}
)
try:
    with urllib.request.urlopen(req) as response:
        print(response.read().decode())
except Exception as e:
    print(e.read().decode() if hasattr(e, 'read') else str(e))
