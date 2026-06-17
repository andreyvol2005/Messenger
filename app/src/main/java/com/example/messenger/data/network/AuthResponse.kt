package com.example.messenger.data.network

import com.google.gson.annotations.SerializedName

data class AuthResponse(
    @SerializedName("user_id")
    val userId: Int,
    val username: String? = null,
    val message: String? = null
)