package com.example.messenger.data.local.entities

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "chats")
data class ChatEntity(
    @PrimaryKey
    val id: Int,
    val type: String,
    val name: String? = null,
    val lastMessageText: String? = null,
    val lastMessageTime: Long? = null,
    val partnerId: Int? = null,
    val partnerUsername: String? = null,
    val partnerNickname: String? = null,
    val partnerAvatarUrl: String? = null,
    val unreadCount: Int = 0,
    val createdAt: String? = null
)