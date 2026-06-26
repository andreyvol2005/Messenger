package com.example.messenger.data.models

import com.google.gson.annotations.SerializedName

data class LastMessageDto(
    val id: Int,
    val text: String? = null,
    @SerializedName("created_at")
    val createdAt: String? = null
)