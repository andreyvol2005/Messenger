package com.example.messenger.data.models

data class ContactDto(
    val id: Int,
    val username: String,
    val nickname: String,
    val avatarUrl: String? = null
)