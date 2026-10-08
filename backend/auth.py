import bcrypt
from jose import jwt
from datetime import datetime, timedelta

SECRET_KEY = "your-super-secret-key-change-me"

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(
            plain_password.encode('utf-8'),
            hashed_password.encode('utf-8')
        )
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    password_bytes = password.encode('utf-8')[:72]
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password_bytes, salt).decode('utf-8')

def create_token(data: dict):
    to_encode = data.copy()
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
