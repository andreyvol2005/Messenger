package com.example.messenger.DataClasses

data class GroupChat(
    val id: String = "",
    val name: String = "",
    val members: List<String> = emptyList(),
    val lastMsg: String = "",
    val lastread: Int = 0,
    val time: Long = 0L
)