package com.example.messenger.data.models

import com.google.gson.annotations.SerializedName

data class ChatDto(
    val id: Int,
    val type: String,
    val name: String? = null,
    @SerializedName("last_message")
    val lastMessage: LastMessageDto? = null,
    val partner: UserDto? = null,
    @SerializedName("unread_count")
    val unreadCount: Int = 0,
    val message: String? = null
)