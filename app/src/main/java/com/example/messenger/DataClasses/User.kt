package com.example.messenger.DataClasses

data class User(
    val username: String = "",
    val nickname: String = "",
    val password: String = "",
    val bio: String = "",
    val birthDate: String = "",
    val avatarUrl: String = "",
    val chats: List<String> = emptyList(),
    val contacts: List<String> = emptyList()
)