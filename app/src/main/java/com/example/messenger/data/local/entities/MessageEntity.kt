package com.example.messenger.data.local.entities

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "messages")
data class MessageEntity(
    @PrimaryKey
    val id: Int,
    val chatId: Int,
    val senderId: Int,
    val text: String? = null,
    val mediaUrl: String? = null,
    val createdAt: String? = null,
    val replyToId: Int? = null,
    val isDeleted: Boolean = false,
    val isRead: Boolean = false
)