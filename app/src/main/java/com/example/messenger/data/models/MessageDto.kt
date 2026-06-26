package com.example.messenger.data.models

import com.google.gson.annotations.SerializedName

data class MessageDto(
    val id: Int,
    @SerializedName("chat_id")
    val chatId: Int,
    @SerializedName("sender_id")
    val senderId: Int,
    val text: String? = null,
    @SerializedName("media_url")
    val mediaUrl: String? = null,
    @SerializedName("created_at")
    val createdAt: String? = null,
    @SerializedName("reply_to_id")
    val replyToId: Int? = null,
    @SerializedName("is_deleted")
    val isDeleted: Boolean = false,
    @SerializedName("is_read")
    val isRead: Boolean = false
)

data class SendMessageRequest(
    @SerializedName("chat_id")
    val chatId: Int,
    @SerializedName("sender_id")
    val senderId: Int,
    val text: String? = null,
    @SerializedName("media_url")
    val mediaUrl: String? = null,
    @SerializedName("reply_to_id")
    val replyToId: Int? = null
)

data class MessageResponse(
    @SerializedName("message_id")
    val messageId: Int
)