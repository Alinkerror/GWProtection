import sqlite3

def migrate():
    conn = sqlite3.connect('gwp.db')
    cursor = conn.cursor()

    print("Checking for account_id in jobs table...")
    cursor.execute("PRAGMA table_info(jobs)")
    columns = [col[1] for col in cursor.fetchall()]
    
    if 'account_id' not in columns:
        print("Adding account_id to jobs table...")
        cursor.execute("ALTER TABLE jobs ADD COLUMN account_id INTEGER REFERENCES accounts(id)")
    else:
        print("account_id already exists in jobs table.")

    print("Creating policies table...")
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS policies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER REFERENCES accounts(id),
        name VARCHAR,
        job_type VARCHAR,
        frequency VARCHAR,
        start_time VARCHAR,
        is_active INTEGER DEFAULT 1,
        last_run DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """)

    conn.commit()
    conn.close()
    print("Migration completed successfully!")

if __name__ == "__main__":
    migrate()
