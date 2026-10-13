import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DB_USER = os.getenv("DB_USER", "messenger_user")
DB_PASSWORD = os.getenv("DB_PASSWORD", "pass")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "messenger_db")

SQLALCHEMY_DATABASE_URL = f"postgresql+psycopg2://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# pool_pre_ping проверяет соединение перед использованием: без него после
# DROP DATABASE (например, после scripts/db.sh reset) сервер держал бы в пуле
# мёртвые подключения и отдавал бы ошибки вместо нормальных ответов
engine = create_engine(SQLALCHEMY_DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Таблицы создаются через init.sql, он же — единственный источник схемы


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()