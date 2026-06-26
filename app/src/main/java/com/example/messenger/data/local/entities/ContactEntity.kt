package com.example.messenger.data.local.entities

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "contacts")
data class ContactEntity(
    @PrimaryKey
    val id: Int,
    val username: String,
    val nickname: String,
    val avatarUrl: String? = null
)