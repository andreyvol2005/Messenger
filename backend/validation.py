"""Проверка username и nickname.

В базе username хранится вместе с ведущим «@» (например, "@ivan"), а во всех
полях ввода пользователь пишет его без «@».  Никнейм — отдельное, неуникальное
отображаемое имя, тоже без «@».
"""
from fastapi import HTTPException

USERNAME_MAX = 15
NICKNAME_MAX = 15


def _has_only_allowed_chars(value: str) -> bool:
    """Латиница, кириллица, цифры и подчёркивание — больше ничего."""
    for char in value:
        if "a" <= char <= "z" or "A" <= char <= "Z":
            continue
        if "0" <= char <= "9":
            continue
        if char == "_":
            continue
        # U+0400–U+04FF — основной блок кириллицы. isalpha() отсекает
        # служебные знаки, которые тоже входят в этот диапазон.
        if "\u0400" <= char <= "\u04ff" and char.isalpha():
            continue
        return False
    return True


def normalize_username(raw: str | None) -> str:
    """Проверяет username без «@» и возвращает его в формате хранения."""
    value = (raw or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="Введите username")
    if "@" in value:
        raise HTTPException(status_code=400, detail="Пишите username без символа @")
    if len(value) > USERNAME_MAX:
        raise HTTPException(
            status_code=400,
            detail=f"Username не может быть длиннее {USERNAME_MAX} символов",
        )
    if not _has_only_allowed_chars(value):
        raise HTTPException(
            status_code=400,
            detail="Username: только латиница, кириллица, цифры и _",
        )
    return "@" + value


def validate_nickname(raw: str | None) -> str:
    """Проверяет nickname (без «@») и возвращает его в нормальном виде."""
    value = (raw or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="Введите nickname")
    if "@" in value:
        raise HTTPException(status_code=400, detail="Пишите nickname без символа @")
    if len(value) > NICKNAME_MAX:
        raise HTTPException(
            status_code=400,
            detail=f"Nickname не может быть длиннее {NICKNAME_MAX} символов",
        )
    if not _has_only_allowed_chars(value):
        raise HTTPException(
            status_code=400,
            detail="Nickname: только латиница, кириллица, цифры и _",
        )
    return value
