package com.example.messenger.data.local.entities

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "users")
data class UserEntity(
    @PrimaryKey
    val id: Int,
    val username: String,
    val nickname: String = "user",
    val bio: String? = null,
    val birthDate: String? = null,
    val avatarUrl: String? = null,
    val createdAt: String? = null
)