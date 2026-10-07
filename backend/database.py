from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

SQLALCHEMY_DATABASE_URL = "postgresql+psycopg2://messenger_user:pass@localhost:5432/messenger_db"

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Зависимость для FastAPI: открывает сессию БД на время запроса
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()