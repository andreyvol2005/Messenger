package com.example.messenger.data.models

data class UserDto(
    val id: Int,
    val username: String,
    val nickname: String = "user",
    val bio: String? = null,
    val birthDate: String? = null,
    val avatarUrl: String? = null,
    val createdAt: String? = null
)