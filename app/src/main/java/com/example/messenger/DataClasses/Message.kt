package com.example.messenger.DataClasses

data class Message(
    val id: String = "",
    val from: Int = 0,
    val text: String = "",
    val time: String = "",
    val read: Int = 0,
    val replyToId: String = ""
)
