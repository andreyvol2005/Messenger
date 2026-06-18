package com.example.messenger.network

import com.google.gson.annotations.SerializedName

data class AddContactRequest(
    @SerializedName("contact_user_id")
    val contactUserId: Int
)

data class ContactResponse(
    val message: String
)