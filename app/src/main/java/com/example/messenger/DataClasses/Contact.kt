package com.example.messenger.Adapters

data class Contact(
    val displayName: String,
    val userId: String,
    val username: String,
    val avatarUrl: String = ""
)